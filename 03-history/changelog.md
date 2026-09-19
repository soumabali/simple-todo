# Changelog

## [Unreleased]

### Fixed
- **BUG-1 (P0):** middleware now accepts both `__Secure-better-auth.session_token` (HTTPS) and `better-auth.session_token` (HTTP dev). Previously every authenticated route 307-redirected back to `/login` in production because better-auth prefixes the cookie with `__Secure-` over HTTPS.
- **BUG-2 (P1):** `lastLoginAt` now populates on login via `databaseHooks.session.create.after`.
- **BUG-3 (P1):** `VAPID_SUBJECT` fallback corrected to `mailto:admin@nexigo.my.id`.

### Added
- Implementasi penuh FlowBoard (PRD v1.2): Next.js 15 App Router + better-auth (self-hosted), Drizzle ORM, Postgres.
- Modul M1–M8: auth (login, ganti password, forced change, logout), board privat, status CRUD + urutan, task CRUD + jadwal (start/due date), Gantt custom (day/week/month), notifikasi push + PWA, subscription hygiene, admin user CRUD + activity log.
- Worker `flowboard-reminder` (cron `*/5`) untuk pengiriman pengingat Web Push.
- PWA: `manifest.webmanifest`, `sw.js` (push + notificationclick), ikon PNG/SVG, favicon.
- Seed script admin pertama (`npm run db:seed`).

### Changed
- Auth pakai Opsi B (self-hosted better-auth), bukan Managed Better Auth (spike workerd belum dijalankan).

### Fixed
- `rescheduleTaskReminders`: ganti insert jadi upsert `ON CONFLICT (task_id, kind)` agar reaktivasi reminder setelah task keluar dari kolom "Done" tidak melanggar unique key.
- `reset-password` admin: kirim hash password (bukan plaintext) ke `internalAdapter.updatePassword`.
- Middleware diubah menjadi edge-safe (cek keberadaan cookie saja); validasi sesi penuh + forced-password-change dipindah ke server layout Node runtime.
- Drag & drop task (`board-view.tsx`): `prevPosition`/`nextPosition` dihitung dari tetangga kolom target (sebelumnya selalu `null` → task selalu append).
- Gantt bar drag/resize (`gantt-view.tsx`): diimplementasi penuh (pointer events + snap hari + resize edge), sebelumnya hanya klik.
- View toggle `?view=` + task deep link `?task=` (`boards/[id]/page.tsx`).
- Notifications cursor pagination (`id < cursor`) di `api/notifications/route.ts`.
- Rebalance kolom server-side saat gap posisi < EPSILON (`lib/domain.ts`).
- 50 warning lint → 0 warning; dynamic import `ApiError` → import statis di semua route.
- Worker cron (`workers/reminder`): klaim baris dibuat **conditional update** (`UPDATE ... WHERE status='pending'`) sebagai pengganti `FOR UPDATE SKIP LOCKED` yang tidak didukung driver Neon HTTP — mencegah double-send (PRD §15). Logika keputusan dikeluarkan ke `src/lib/push-delivery.ts` (murni & ter-test).
- CI kini mengecek worker (`npm run typecheck:worker`) yang sebelumnya di-exclude dari `tsconfig`/`eslint`.

### Tests
- Unit test Vitest untuk `ordering` (midpoint/rebalance) dan `reminders` (keempat jenis reminder, quiet hours, timezone) — 16 test, semua lolos (`npm run test`).
- Unit test `push-delivery` (klasifikasi status 2xx/404/410/429/5xx, backoff 5/20/60, konstanta) — total **22 test**, semua lolos.


## [Deploy — 2026-09-19]

### Deployed
- Produksi live di https://todo.nexigo.my.id (Cloudflare Workers + Neon Postgres).
- Worker flowboard-web (Next.js via OpenNext) + flowboard-reminder (cron */5) ter-deploy, secrets/vars terpasang.
- Custom domain todo.nexigo.my.id -> flowboard-web (cert SSL auto, DNS proxied).
- Migrasi Drizzle dijalankan terhadap branch production (15 tabel + 2 enum + login_attempts).
- Admin pertama di-seed: admin@flowboard.local (role admin, login terverifikasi).

### Infra fixes
- .github/workflows/deploy.yml dipindah ke root repo.
- Neon project id dikoreksi: cold-brook-93438292.
- neon.ts: protected:true di-drop (Neon free plan HTTP 422).
- CI node-version 20 -> 22 (wrangler 4.130 butuh Node >=22).
- Registrasi workers.dev subdomain (sudharmika.workers.dev).
- DATABASE_URL_UNPOOLED ditambahkan untuk drizzle-kit migrate.
- Web Worker dapat secret VAPID_PRIVATE_KEY.
