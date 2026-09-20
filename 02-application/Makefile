# Thin wrapper around the npm scripts — the npm scripts are the source of truth.
# Deploy happens in CI (GitHub Actions → Cloudflare), not from this Makefile.
.PHONY: dev build start test lint typecheck check deploy

dev:
	npm run dev

build:
	npm run build

start:
	npm run start

test:
	npm test

lint:
	npx next lint --dir src

typecheck:
	npm run typecheck && npm run typecheck:worker

check: typecheck lint test maintainer-tools
	@echo "✅ typecheck + lint + tests + secret scan + maintainer tools passed"

# Fails if a tracked file carries a credential-shaped value. This repo is
# PUBLIC and once shipped a live test password; see 03-history/changelog.md.
secrets:
	@python3 ../scripts/check-secrets.py

# The maintainer tooling is Python under ../scripts/. Its fixtures are the gate:
# the injection scanner must keep catching the payload corpus while leaving
# benign text alone, and the issue watcher must keep rejecting a forged
# ownership marker. Both encode real bugs, so a regression fails the build
# instead of quietly weakening the defence.
maintainer-tools: secrets
	@python3 ../scripts/injection_scan.py --self-test
	@python3 ../scripts/notify-issues.py --self-test

# Manual deploy is intentionally NOT provided: CI runs verify → migrate → deploy
# on every push to main. See 01-documents/runbooks/deployment.md.
deploy:
	@echo "Deploy runs in CI on push to main — see 01-documents/runbooks/deployment.md"
	@echo "To preview the production bundle locally: npm run preview"
	@exit 1
