#!/usr/bin/env python3
"""Fail if a tracked file looks like it carries a real secret.

This repo is PUBLIC. Two files once shipped a production test account's email
and password in plaintext, which meant the values were published to the
internet, not merely kept in git history. A linter cannot tell intent, so this
scanner is deliberately narrow: it looks for shapes that are never legitimate
in a public repository, and it honours inline `# allow-secret` when the match
is a documented placeholder.

Two rounds of this scanner were written before it was trustworthy. The first
missed `{"password": "..."}` and `ADMIN_PASSWORD = "..."`; the second missed
`process.env.X ?? "literal"`, which is the shape that actually leaked a live
BETTER_AUTH_SECRET. Each fix came from writing a probe file and watching the
scanner fail to catch it — not from reading the regex.

Usage:  python3 scripts/check-secrets.py [--root DIR]
Exit:   0 clean, 1 findings.
"""
import argparse
import os
import re
import subprocess
import sys

# (label, regex, why) — ordered roughly by severity.
RULES = [
    ("neon api key", r"napi_[A-Za-z0-9_]{16,}"),
    ("github token", r"\b(?:github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,})"),
    ("openai key", r"\bsk-[A-Za-z0-9]{32,}"),
    ("cloudflare token", r"\b(?:v1\.0-[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{40}\b(?=[^\n]*cloudflare))"),
    ("private key block", r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----"),
    ("vapid jwk private", r'"d"\s*:\s*"[A-Za-z0-9_\-]{30,}"'),
    # `?? "..."` / `|| "..."` on a secret-named variable: the value becomes the
    # live credential of any deployment that forgets to set the env var. This
    # exact shape (a published BETTER_AUTH_SECRET) shipped once and the scanner
    # missed it, so it gets its own rule.
    ("insecure secret fallback", r"""(?<![A-Za-z0-9])(?:secret|password|passwd|pwd|api_?key|token|credential)s?\w*\s*(?:\?\?|\|\|)\s*['"]([^'"\n]{6,})['"]"""),
    ("hardcoded password", r"""(?<![A-Za-z0-9])(?:password|passwd|pwd)s?['"]?\s*[:=]\s*['"]([^'"\n]{8,})['"]"""),
    ("hardcoded secret literal", r"""(?:secret|api_?key|token|credential)s?['"]?\s*[:=]\s*['"]([^'"\n]{8,})['"]"""),
    ("credentialed url", r"\bpostgres(?:ql)?://[^\s:@/'\"]+:([^\s@'\"]{4,})@"),
]

# The captured group can be a placeholder; these never count as secrets.
PLACEHOLDER = re.compile(
    r"^(?:\$\{?[A-Z_]+\}?|<[^>]+>|\*\*\*|xxx+|your[-_ ]?\w*|change[-_]?me|placeholder|example\w*|"
    r"test|dummy|fake|todo|password|passwd|postgres|root|admin|secret|token|api[-_]?key|"
    r"process\.env|\S*env\.\S*)$",
    re.IGNORECASE,
)

# Local development hosts are never a leak, whatever the credentials look like.
LOCAL_HOST = re.compile(r"://[^@/]*@(?:localhost|127\.0\.0\.1|0\.0\.0\.0|db|postgres)[:/]")

# A literal worth flagging mixes cases or cases+digits and carries real entropy;
# "abc", "test-token" and "value" are fixtures. Keeps generic keyword matches
# from drowning the report in noise.
SECRETISH = re.compile(r"(?=.*[a-z])(?=.*[A-Z])(?=.*\d)|(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9])")

# Files whose whole point is to show the shape of a secret.
SKIP_PATH = re.compile(r"(^|/)(package-lock\.json|drizzle/meta/|node_modules/|\.next/)")
ALLOW = "# allow-secret"


def tracked_files(root: str) -> list[str]:
    out = subprocess.run(
        ["git", "-C", root, "ls-files"], capture_output=True, text=True, check=True
    ).stdout
    return [f for f in out.split("\n") if f]


def scan(root: str) -> list[tuple[str, int, str, str]]:
    findings = []
    for rel in tracked_files(root):
        if SKIP_PATH.search(rel):
            continue
        path = os.path.join(root, rel)
        try:
            lines = open(path, encoding="utf-8", errors="ignore").read().split("\n")
        except OSError:
            continue
        for lineno, line in enumerate(lines, 1):
            if ALLOW in line:
                continue
            if LOCAL_HOST.search(line):
                continue
            for label, pattern in RULES:
                m = re.search(pattern, line, re.IGNORECASE)
                if not m:
                    continue
                captured = m.group(1) if m.groups() else m.group(0)
                if PLACEHOLDER.match(captured.strip()):
                    continue
                # A generic keyword match is only a finding if the value itself
                # looks secret-ish; `token: "abc"` is a fixture, not a leak.
                if label == "hardcoded secret literal" and not SECRETISH.search(captured):
                    continue
                findings.append((rel, lineno, label, captured[:24]))
                break
    return findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    args = ap.parse_args()

    findings = scan(args.root)
    if not findings:
        print("✅ check-secrets: no credential-shaped values in tracked files")
        return 0

    print("❌ check-secrets: possible secrets in tracked files\n")
    for rel, lineno, label, sample in findings:
        print(f"  {rel}:{lineno}  [{label}]  {sample}...")
    print(
        "\nThis repository is public. Move the value to an environment variable or a\n"
        "secret store, and add `# allow-secret` on the line if it is a placeholder."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
