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

check: typecheck lint test secrets
	@echo "✅ typecheck + lint + tests + secret scan passed"

# Fails if a tracked file carries a credential-shaped value. This repo is
# PUBLIC and once shipped a live test password; see 03-history/changelog.md.
secrets:
	@python3 ../scripts/check-secrets.py

# Manual deploy is intentionally NOT provided: CI runs verify → migrate → deploy
# on every push to main. See 01-documents/runbooks/deployment.md.
deploy:
	@echo "Deploy runs in CI on push to main — see 01-documents/runbooks/deployment.md"
	@echo "To preview the production bundle locally: npm run preview"
	@exit 1
