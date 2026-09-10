# Deployment Runbook

## Pre-deploy

- [ ] Semua tests pass
- [ ] Backup database (jika ada)
- [ ] Cek environment variables

## Deploy Steps

```bash
make deploy
```

## Post-deploy

- [ ] Smoke test health endpoint
- [ ] Monitor logs
