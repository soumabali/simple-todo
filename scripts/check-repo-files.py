#!/usr/bin/env python3
"""Check a few repo-level invariants that nothing else would catch.

These are the promises in issue #1 (license) and the README's document index.
They are cheap to check and embarrassing to get wrong: a repo that declares MIT
in `package.json` while shipping no `LICENSE` file is worse than one that
declares nothing, because it looks settled.

Run: `python3 scripts/check-repo-files.py`       (exit 1 on any problem)
     `python3 scripts/check-repo-files.py --self-test`
"""

from __future__ import annotations

import json
import re
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def check(root: Path) -> list[str]:
    """Return a list of problems. Empty list means the invariants hold."""
    problems: list[str] = []

    license_file = root / "LICENSE"
    if not license_file.exists():
        problems.append("LICENSE is missing (issue #1: the repo must declare a license)")
    else:
        text = read(license_file)
        if "MIT License" not in text:
            problems.append("LICENSE exists but does not look like the MIT text")
        if "Copyright (c)" not in text:
            problems.append("LICENSE has no copyright line")

    pkg_path = root / "02-application" / "package.json"
    if not pkg_path.exists():
        problems.append("02-application/package.json is missing")
    else:
        declared = json.loads(read(pkg_path)).get("license")
        if not declared:
            problems.append("package.json has no `license` field")
        elif license_file.exists():
            # The two must agree. `mit` from package.json should name the same
            # license as the LICENSE file's heading.
            if declared.lower() not in read(license_file).lower():
                problems.append(
                    f"package.json declares {declared!r} but LICENSE says otherwise"
                )

    for name in ("CONTRIBUTING.md", "SECURITY.md"):
        if not (root / name).exists():
            problems.append(f"{name} is missing")

    readme = root / "README.md"
    if readme.exists():
        body = read(readme)
        for name in ("CONTRIBUTING.md", "SECURITY.md"):
            if (root / name).exists() and not re.search(re.escape(name), body):
                problems.append(f"README.md never points to {name}")

    return problems


def self_test() -> int:
    """Prove the checks can fail. A guard that cannot fail guards nothing."""
    failures: list[str] = []
    base = {
        "LICENSE": "MIT License\n\nCopyright (c) 2026 soumabali\n",
        "README.md": "See CONTRIBUTING.md and SECURITY.md.\n",
        "CONTRIBUTING.md": "# Contributing\n",
        "SECURITY.md": "# Security\n",
        "02-application/package.json": json.dumps({"name": "x", "license": "MIT"}),
    }

    def materialise(files: dict[str, str]) -> Path:
        tmp = Path(tempfile.mkdtemp(prefix="repo-files-selftest-"))
        for rel, content in files.items():
            p = tmp / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding="utf-8")
        return tmp

    tmp_ok = materialise(base)
    if check(tmp_ok) != []:
        failures.append(f"clean fixture reported problems: {check(tmp_ok)}")

    mutations = {
        "missing LICENSE": {**base, "LICENSE": None},
        "package.json disagrees with LICENSE": {
            **base,
            "02-application/package.json": json.dumps({"name": "x", "license": "Apache-2.0"}),
        },
        "package.json has no license": {
            **base,
            "02-application/package.json": json.dumps({"name": "x"}),
        },
        "README stops linking SECURITY.md": {
            **base,
            "README.md": "See CONTRIBUTING.md only.\n",
        },
        "CONTRIBUTING.md removed": {**base, "CONTRIBUTING.md": None},
    }
    for label, files in mutations.items():
        variant = {k: v for k, v in files.items() if v is not None}
        tmp = materialise(variant)
        if not check(tmp):
            failures.append(f"mutation not detected: {label}")

    if failures:
        for line in failures:
            print(f"  {line}")
        print(f"FAIL: {len(failures)} repo-file fixtures failed")
        return 1
    print("OK: repo-file invariants hold, and each check fails when broken")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()
    problems = check(ROOT)
    if problems:
        print("❌ check-repo-files: repo invariants broken\n")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("✅ check-repo-files: LICENSE, package.json, CONTRIBUTING, SECURITY all consistent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
