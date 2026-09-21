#!/usr/bin/env python3
"""Assert that the runtime-tooling boundary is real, not asserted.

`npm audit` reports vulnerabilities in packages that never reach a deployed
Worker. That claim was made once in prose and was partly wrong: `--omit=dev`
still reports 11 findings, because `postcss` enters through `next` (a production
dependency) and npm marks transitive children by the graph, not by where they
end up.

The question that actually matters is not "is it a devDependency" but
**"does it ship"**. That is answerable, and this script answers it against the
build artifact instead of the manifest:

    npx opennextjs-cloudflare build    # produces .open-next/worker.js
    python3 scripts/check-bundle-boundary.py

If a package below ever appears in the bundle, the bundler started including it
and every "it is only tooling" statement in the docs became false -- including
the ones used to defer an upgrade. Failing here is the point.

Exit codes: 0 = boundary intact, 1 = a package crossed it (or artifact missing).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
APP_DIR = REPO_DIR / "02-application"

# Packages carrying the npm advisories we have chosen to defer. Each is used at
# build/dev time only; none is reachable from a request handled by the Worker.
TOOLING_ONLY = ("postcss", "sharp", "miniflare", "esbuild")

# Bundles OpenNext emits. `worker.js` is the entry; the server-functions bundle
# is where app code and its real imports land, so both must be clean.
BUNDLES = (
    ".open-next/worker.js",
    ".open-next/server-functions/default/index.mjs",
)


def scan(text: str, package: str) -> int:
    """Count occurrences of *package* as a module/path token in *text*.

    A bare substring count is wrong in both directions: `postcss` appears inside
    legitimate prose, and would also match `postcss-value-parser`. Anchoring on
    package boundaries keeps the signal tied to actual module resolution.

    The first version of this missed `require("postcss/lib/parse")` -- the most
    likely shape of a *real* bundled reference, since bundlers rewrite bare
    specifiers to their subpath. It only matched `'postcss'` exactly, so the
    check passed while the thing it exists to catch was present. Every pattern
    below is a shape that was observed or is trivially constructible.

    Known false-negative, accepted and documented: a minifier that renames the
    specifier entirely (e.g. inlining the module and dropping its name) produces
    no match. This check catches the bundler *deciding to include* a package,
    which is the realistic regression; it is not a proof of absence.
    """
    esc = package
    needles = (
        f"/{esc}/",             # node_modules/postcss/... , postcss/lib/parse
        f"'{esc}'",             # import x from 'postcss'
        f'"{esc}"',
        f"'{esc}/",             # require('postcss/lib/parse')
        f'"{esc}/',
        f"node_modules/{esc}",  # explicit vendored path
    )
    return sum(text.count(n) for n in needles)


def main() -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n")[0])
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="check the detector against known-good and known-bad samples",
    )
    args = parser.parse_args()

    if args.self_test:
        return _self_test()

    missing = [b for b in BUNDLES if not (APP_DIR / b).exists()]
    if missing:
        print(
            "bundle-boundary: missing build artifact(s): "
            + ", ".join(missing)
            + "\n  run `npx opennextjs-cloudflare build` first "
            "(the check is meaningless without the artifact)",
            file=sys.stderr,
        )
        return 1

    failures: list[str] = []
    for bundle in BUNDLES:
        text = (APP_DIR / bundle).read_text(encoding="utf-8", errors="replace")
        for package in TOOLING_ONLY:
            hits = scan(text, package)
            if hits:
                failures.append(f"  {bundle}: {package} appears {hits}x")

    if failures:
        print(
            "FAIL: bundle-boundary: tooling packages reached the deployed bundle",
            file=sys.stderr,
        )
        print("\n".join(failures), file=sys.stderr)
        print(
            "\n  These packages carry deferred npm advisories, which were deferred on\n"
            "  the grounds that they do not ship. Re-run `npm audit` and treat the\n"
            "  advisories as production issues before shipping this.",
            file=sys.stderr,
        )
        return 1

    # Report size so a passing run still says something verifiable.
    detail = ", ".join(
        f"{b}={len((APP_DIR / b).read_text(encoding='utf-8', errors='replace')) // 1024}KB"
        for b in BUNDLES
    )
    print(
        f"OK: bundle-boundary: none of {', '.join(TOOLING_ONLY)} reached the deployed "
        f"bundle ({detail})"
    )
    return 0


def _self_test() -> int:
    """Fixtures. A detector that cannot fail is worse than no detector."""
    failures: list[str] = []

    def expect(name: str, text: str, package: str, want_hit: bool) -> None:
        got = scan(text, package) > 0
        if got != want_hit:
            failures.append(f"  {name}: expected hit={want_hit}, got {got}")

    # Positive: the shapes a real bundle would use.
    expect("require path", "require('/app/node_modules/postcss/lib')", "postcss", True)
    expect("esm import", 'import x from "miniflare";', "miniflare", True)
    expect("bare specifier", "from 'sharp'", "sharp", True)
    expect("vendored dir", ".../node_modules/esbuild/bin", "esbuild", True)
    # The case the first version of this detector MISSED, while reporting OK.
    # A bundler rewrites a bare specifier to its subpath, so this -- not the bare
    # `'postcss'` -- is the realistic shape of inclusion. Kept as a fixture so the
    # gap cannot silently return.
    expect("subpath require", 'require("postcss/lib/parse")', "postcss", True)
    expect("subpath import", 'from "sharp/index.js"', "sharp", True)

    # Negative: these are the false positives that would make the check noisy
    # and then ignored -- the failure mode that matters for a guard like this.
    expect("prose mention", "we do not ship postcss", "postcss", False)
    expect("unrelated package", "postcss-value-parser", "postcss", False)
    expect("different package", "sharpener", "sharp", False)
    expect("substring of longer name", "not-miniflare-here", "miniflare", False)

    if failures:
        print(f"FAIL: {len(failures)} bundle-boundary fixtures failed", file=sys.stderr)
        print("\n".join(failures), file=sys.stderr)
        return 1
    print("OK: bundle-boundary fixtures passed (real paths caught, prose and near-misses left alone)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
