# FlowBoard — Deploy Guide (production)

> Status: **ready to deploy** — semua blocker kredensial sudah beres.
> Domain: `todo.nexigo.my.id` · Repo: `github.com/soumabali/simple-todo` · Neon project: `cold-brook-93438292`

## Kredensial (verified ✅)

| Item | Nilai / status |
|---|---|
| Cloudflare account | `81e5bd15a7810cb281f887efa5f0f4d0` (Sudhar.journey@gmail.com) |
| Cloudflare API token | ✅ Workers write access (verified `wrangler whoami`) |
| Neon project | `cold-brook-93438292` ("cursor", ap-southeast-1) — **bukan** `wandering-band-92657113` (project lama "Dhar" dari PRD) |
| Neon branches | `production` (`br-tiny-star-azkz0uxw`) + `develop` (`br-holy-glade-azgslwww`) |
| GitHub repo | `soumabali/simple-todo` (public) |
| GitHub secrets | ✅ 10 secrets sudah di-set via API |
| VAPID keypair | ✅ public (87) + private (JWK EC P-256, 220) cocok |
| BETTER_AUTH_SECRET | ✅ 44 char (≥32) |

> **Catatan penting:** `.env` menunjuk ke project Neon `cold-brook-93438292` (punya branch `production` + `develop`), BUKAN project lama `wandering-band-92657113` dari PRD. Semua konfigurasi deploy sudah memakai `cold-brook-93438292`.

## GitHub Secrets (10, sudah di-set)

| Secret | Sumber |
|---|---|
| `CLOUDFLARE_API_TOKEN` | `.env` (token Workers) |
| `CLOUDFLARE_ACCOUNT_ID` | `.env` |
| `NEON_API_KEY` | `.env` |
| `NEON_PRODUCTION_URL` | `.env` (pooled) |
| `NEON_DEVELOP_URL` | `.env` (pooled) |
| `NEON_PRODUCTION_URL_UNPOOLED` | derived (`-pooler` dihapus) |
| `NEON_DEVELOP_URL_UNPOOLED` | derived |
| `VAPID_PUBLIC_KEY` | `.env` |
| `VAPID_PRIVATE_KEY` | `.env` (JWK JSON) |
| `BETTER_AUTH_SECRET` | `.env` |

## GitHub Variables (fallback via `vars.X || default` di deploy.yml)

| Variable | Nilai (fallback sudah di-hardcode) |
|---|---|
| `BETTER_AUTH_URL` | `https://todo.nexigo.my.id` |
| `VAPID_SUBJECT` | `mailto:admin@nexigo.my.id` |

> Token fine-grained PAT tidak bisa set **variables** via API (403), tapi deploy.yml memakai `vars.X || 'default'` sehingga tetap jalan tanpa variable.

## Struktur CI/CD (diperbaiki)

- `.github/workflows/deploy.yml` **dipindah ke root repo** (sebelumnya salah di `02-application/.github/` — GitHub Actions hanya membaca root).
- Semua step memakai `working-directory: 02-application`.
- Migrasi memakai **unpooled** URL (`DATABASE_URL_UNPOOLED`) untuk keamanan DDL di pgbouncer.
- Web Worker mendapat secret `VAPID_PRIVATE_KEY` juga (route `/api/push/test` + subscribe flow butuh `sendPush`).
- `.gitignore` menambahkan `/.open-next/` dan `/.wrangler/`.

## Urutan deploy

1. `git push` commit ke `main` → trigger `deploy.yml`.
2. CI: verify (lint+typecheck+test+build) → apply Neon policy (`neon deploy --project-id cold-brook-93438292`) → migrate (unpooled) → deploy web Worker (OpenNext) → deploy reminder Worker.
3. Tambah DNS `todo.nexigo.my.id` → custom domain Worker `flowboard-web`.
4. Seed admin pertama (`npm run db:seed` dengan `DATABASE_URL` = production unpooled).
5. Smoke test `https://todo.nexigo.my.id`.

## Yang sudah diverifikasi lokal (semua hijau)

- `npm run typecheck` ✅
- `npm run typecheck:worker` ✅
- `npm run build` ✅
- `npx opennextjs-cloudflare build` ✅ (Worker bundle `.open-next/worker.js` generated)
- `npx drizzle-kit migrate` terhadap Neon develop ✅ (15 tabel + 2 enum)
- `neon config plan` terhadap `cold-brook-93438292` ✅

## Catatan arsitektur

- **Opsi B (self-hosted better-auth)** — `neon.ts` memakai `auth: false`. Managed Better Auth (Opsi A) pending spike workerd, tidak menghalangi launch.
- Rotasi VAPID keys = mematikan semua subscription (PRD §12.3).
