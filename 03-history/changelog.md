# Changelog

## [Unreleased]

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
