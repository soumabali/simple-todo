"""Shared helpers for the maintainer tools.

Everything here is used by more than one script. The security-sensitive parts are
the reason this module exists: the injection scan and the ownership test are used
by both the watcher and the triager, and two copies of a security rule eventually
disagree -- and the disagreement is a hole, not a style issue.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = "soumabali/simple-todo"
REPO_DIR = Path(__file__).resolve().parent.parent
SCANNER = REPO_DIR / "scripts" / "injection_scan.py"

# Marker on every comment this automation writes. It is a *hint* for humans and
# for the watcher; on its own it proves nothing, because anyone can paste it.
BOT_MARKER = "<!-- ame-bot -->"
REPO_OWNER = "soumabali"

MAX_SNIPPET = 220

# Ordering used to pick the worst finding. `unknown` sits above `low`: a scan
# that could not run is more worrying than a scan that ran and found something
# minor. Ranking it below `low` would let a broken scanner read as a soft pass.
SEVERITY_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3, "unknown": 2}

# `gh` is not on PATH when this runs from cron (PATH=/usr/bin:/bin there), which
# surfaced as a traceback instead of an alert. Resolve it explicitly.
GH_BIN = (
    shutil.which("gh")
    or shutil.which("gh", path="/usr/local/bin:/usr/bin:/bin")
    or "gh"
)


def gh(args: list[str], expect_json: bool = True) -> Any:
    """Run a `gh` subcommand and return its output.

    ``expect_json`` defaults to True because most of what this automation reads
    comes from `gh api`. It must be False for the mutating subcommands: they are
    not JSON at all -- `gh issue edit` answers with a URL. Assuming JSON there
    made a *successful* label write raise, which the triager then reported as a
    failure. Reading the wrong shape is a bug in the caller, but only the caller
    knows which shape to expect, so it has to say.
    """
    proc = subprocess.run(
        [GH_BIN, *args], capture_output=True, text=True, timeout=120
    )
    if proc.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)} failed: {proc.stderr.strip()[:300]}")
    if not proc.stdout.strip():
        return None
    if not expect_json:
        return proc.stdout.strip()
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        # Name the command and show the payload: a bare JSONDecodeError is
        # indistinguishable from any other and cost a round of guessing.
        raise RuntimeError(
            f"gh {' '.join(args)} did not return JSON: {proc.stdout.strip()[:200]!r}"
        ) from None


def telegram_escape(s: str) -> str:
    for ch in ("\\", "_", "*", "[", "]", "`"):
        s = s.replace(ch, "\\" + ch)
    return s


def sanitize(text: str | None, limit: int = MAX_SNIPPET) -> str:
    """Neutralise a hostile string for safe display in a Telegram message.

    Registration order matters: `telegram_escape` must run before the mention
    defang. The other way round, escaping mangles the NUL used to defang @.
    """
    if not text:
        return ""
    # Strip HTML comments (an injection favourite), collapse whitespace.
    text = re.sub(r"<!--[\s\S]*?-->", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    text = telegram_escape(text)
    # Defang mentions so a title cannot notify a third party.
    text = re.sub(r"@(?=[A-Za-z0-9])", "@\u200b", text)
    # Escape leading '#' so an injection cannot forge a Telegram heading.
    text = re.sub(r"(^|\s)(#{1,6}\s)", r"\1\\\2", text)
    if len(text) > limit:
        text = text[:limit].rstrip() + "..."
    return text


def scan(text: str) -> dict:
    """Classify one blob of untrusted text.

    Falls back to ``unknown`` on any failure, because silently treating a failed
    scan as clean is the one outcome that would make the gate worthless.
    """
    if not text or not text.strip():
        return {"severity": "none", "hits": []}
    try:
        proc = subprocess.run(
            [sys.executable, str(SCANNER), "--text", text],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return {"severity": "unknown", "hits": [], "error": repr(exc)[:200]}
    if proc.returncode != 0 or not proc.stdout.strip():
        return {"severity": "unknown", "hits": [], "error": proc.stderr.strip()[:200]}
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        return {"severity": "unknown", "hits": [], "error": "scanner output was not JSON"}


def is_ours(body: str | None, author: str | None) -> bool:
    """True only when *we* wrote this.

    The marker alone is forgeable: a contributor can paste it into their own
    issue to suppress being reported. The author cannot be forged, so both are
    required. The author half is what makes this a check rather than a courtesy.
    """
    if not body or BOT_MARKER not in body:
        return False
    return (author or "").lower() == REPO_OWNER.lower()


def load_state(path: Path) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"seen_items": [], "seen_comments": [], "last_check": None}


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Deterministic ordering keeps the file diffable and stops unbounded growth
    # on every run.
    state["seen_items"] = sorted(set(state["seen_items"]))[-400:]
    state["seen_comments"] = sorted(set(state["seen_comments"]))[-800:]
    state["last_check"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    path.write_text(json.dumps(state, indent=1), encoding="utf-8")
