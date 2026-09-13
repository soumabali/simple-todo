# FlowBoard — Deploy Guide (production)

> Status: **kode siap deploy**, tertahan 2 blocker kredensial (lihat §2 & §4).
> Domain: `todo.nexigo.my.id` · Repo: `github.com/soumabali/simple-todo` · Neon project: `wandering-band-92657113`

## Yang sudah selesai (verified)

- ✅ Seluruh kode (M1–M8 + worker cron + PWA + unit test 22 passed) ter-commit lokal di `main` (commit `6b9d1b4`).
- ✅ Semua kredensial di `~/.hermes/.env` valid: CF account/token, Neon API key + 2 URL (production & develop, keduanya connect OK, Postgres 18.6), VAPID keypair (public & private cocok).
- ✅ Repo GitHub `soumabali/simple-todo` ada (public), token GitHub punya admin atas repo.
- ✅ Zone Cloudflare `nexigo.my.id` aktif, DNS dikelola Cloudflare.
- ✅ Pipeline CI (`deploy.yml`), `wrangler.jsonc`, `neon.ts`, OpenNext config — semua siap.

## Blocker 1 — Token Cloudflare tidak bisa deploy Workers

Token `CLOUDFLARE_API_TOKEN` di `.env` **hanya berizin DNS** (bisa tambah record), tapi **403** saat akses `/accounts/<id>/workers/scripts`. Deploy Workers butuh token baru.

### Cara buat token baru (2 menit)

1. Login [dash.cloudflare.com](https://dash.cloudflare.com).
2. Ikon akun (kanan atas) → **My Profile → API Tokens → Create Token**.
3. Pilih template **"Edit Cloudflare Workers"**.
4. Pada **Account Resources**: pilih akun `nexigo` (id `81e5bd15a7810cb281f887efa5f0f4d0`).
5. Pada **Zone Resources**: pilih `All zones from an account` (atau `nexigo.my.id`).
6. Create → **salin token sekali** (tidak bisa dilihat lagi).

> Token ini dipakai untuk: deploy `flowboard-web` + `flowboard-reminder` via Wrangler di GitHub Actions.

## Blocker 2 — GitHub token tidak bisa set Actions secrets

Token `GITHUB_FINE_GRAINED_TOKENS` punya admin atas repo, tapi **403** saat akses `actions/secrets` (fine-grained PAT tanpa permission "Secrets", atau tidak di-scope ke repo ini untuk Actions).

### Cara set secrets (via UI)

Repo → **Settings → Secrets and variables → Actions → New repository secret**, tambahkan:

| Secret name | Nilai (dari `~/.hermes/.env`) |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token **BARU** dari §1 |
| `CLOUDFLARE_ACCOUNT_ID` | `81e5bd15a7810cb281f887efa5f0f4d0` |
| `NEON_API_KEY` | `NEON_API_KEY` |
| `NEON_PRODUCTION_URL` | `NEON_PRODUCTION_URL` |
| `NEON_DEVELOP_URL` | `NEON_DEVELOP_URL` |
| `VAPID_PUBLIC_KEY` | `VAPID_PUBLIC_KEY` |
| `VAPID_PRIVATE_KEY` | `VAPID_PRIVATE_KEY` (JWK JSON string) |
| `BETTER_AUTH_SECRET` | **generate baru**: `openssl rand -base64 48` |

**Variables** (bukan secret, karena memang publik):

| Variable | Nilai |
|---|---|
| `BETTER_AUTH_URL` | `https://todo.nexigo.my.id` |
| `VAPID_SUBJECT` | `mailto:admin@nexigo.my.id` |

## Blocker 3 (opsional) — DNS record + push

Setelah token baru siap, dua langkah infra ini bisa saya kerjakan via API:

1. **DNS**: tambah record `CNAME todo.nexigo.my.id → flowboard-web.<workers-subdomain>.workers.dev` (atau pakai custom domain Workers route).
2. **Workers custom domain**: daftarkan `todo.nexigo.my.id` ke Worker `flowboard-web`.

> Token DNS saat ini (`CLOUDFLARE_API_TOKEN`) SUDAH cukup untuk langkah DNS ini. Hanya deploy Worker yang butuh token baru.

## Urutan setelah blocker beres

1. Set semua secrets + variables di GitHub (tabel di atas).
2. `git push` commit `6b9d1b4` ke `main` (memicu `deploy.yml`).
3. CI: verify (lint+typecheck+test+build) → apply Neon policy → migrate → deploy web Worker → deploy reminder Worker.
4. Tambah DNS `todo.nexigo.my.id` → Worker.
5. `npm run db:seed` (atau jalankan sekali) untuk admin pertama.
6. Smoke test: buka `https://todo.nexigo.my.id` → login → buat board/task → cek Gantt → daftarkan device push → kirim test notification.

## Catatan arsitektur

- **Opsi B (self-hosted better-auth)** — sudah terimplementasi, `neon.ts` memakai `auth: false`. Managed Better Auth (Opsi A) masih pending spike workerd, tapi TIDAK menghalangi launch.
- `VAPID_PUBLIC_KEY` + `VAPID_SUBJECT` + `BETTER_AUTH_URL` = **Worker vars** (publik, bisa di wrangler.jsonc atau `--var`).
- `VAPID_PRIVATE_KEY` + `DATABASE_URL` + `BETTER_AUTH_SECRET` = **Worker secrets** (via `wrangler secret put`).
- Rotasi VAPID keys = mematikan semua subscription (PRD §12.3).
