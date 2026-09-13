# Sesi 2026-09-10 — Implementasi FlowBoard (PRD v1.2)

## Hasil

Project `simple-todo` (FlowBoard) selesai dibangun dan **terverifikasi end-to-end** terhadap Postgres lokal:

- **Backend**: 14 tabel Drizzle (better-auth + domain), migrasi `0000` ter-applied, seed admin.
- **API**: 24 route handler (auth, boards, statuses, tasks, subtasks, labels, gantt, notifications, push, settings, admin) — semuanya lolos `tsc --noEmit` dan `next build`.
- **Frontend**: login, change-password, boards list, board view (kanban dnd-kit), Gantt (day/week/month), list view, task detail drawer, notifications centre, settings, admin users + logs.
- **PWA**: manifest + service worker + ikon + favicon; SW registrasi di providers.
- **Worker cron**: `workers/reminder/` untuk pengiriman push.

## Verifikasi smoke test (curl + browser)

1. Login admin → 200, cookie session OK.
2. Create board → 3 status default (To Do / In Progress / Done, `is_done`).
3. Create task (start 15 Sep, due 18 Sep) → 4 reminder terjadwal dengan tz Asia/Makassar benar (08:00 lokal = 00:00 UTC).
4. Move → Done: `progress=100`, `completed_at` set, semua reminder `cancelled`.
5. Move keluar Done: `completed_at` NULL, reminder reaktif `pending` (upsert fix).
6. Date validation: start > due → 400.
7. Schedule change → semua `scheduled_for` direschedule benar.
8. Admin create user → password generated, `mustChangePassword=true`.
9. Non-admin akses `/api/admin/users` → 404; akses board orang lain → 404.
10. Unauth `/boards` → redirect `/login`.
11. Browser: login → boards → board (kanban) → gantt → admin users, semua render tanpa error JS.

## Bug yang diperbaiki saat sesi

- `rescheduleTaskReminders` insert → upsert (unique key `(task_id, kind)`).
- Admin `reset-password` kirim hash, bukan plaintext.
- Middleware edge-safe (cookie presence only) + validasi pindah ke server layout.

## Langkah selanjutnya (di luar sesi ini)

- Jalankan spike Managed Better Auth di workerd (PRD §2.7.2) — saat ini pakai Opsi B self-hosted.
- Siapkan VAPID keys, `wrangler.jsonc`, dan GitHub Actions (deploy belum dilakukan).
- Unit test Vitest untuk `ordering` dan `reminders` sudah ditulis & lolos (16 test); tinggal tambah integration/E2E Playwright (§13).

## Tambahan sesi lanjutan

- Menulis `vitest.config.ts` + unit test `ordering.test.ts` dan `reminders.test.ts` (16 test, semua hijau). Mengonfirmasi perilaku `TZDate` (@date-fns/tz) yang merender offset `+08:00` — assertion dinormalisasi ke UTC.

## Tambahan sesi 2 — audit & penutupan celah fungsional

Audit lint/typecheck menemukan **4 celah fungsional** (bukan sekadar warning) yang langsung diperbaiki:

1. **Drag & drop task** (`board-view.tsx`): `onDragEnd` sebelumnya mengirim `prevPosition`/`nextPosition` = `null` selalu → task selalu di-append, bukan di-insert di posisi yang benar. Kini dihitung dari tetangga terdekat di kolom target (PRD §8.2/F-4.6).
2. **Gantt bar drag/resize** (`gantt-view.tsx`): `scheduleMutation` mati — bar Gantt hanya bisa diklik, tidak bisa di-drag/resize. Kini diimplementasi penuh (pointer events, snap per hari, resize dari ujung, validasi start≤due) sesuai PRD F-5.2.
3. **View toggle & task deep link** (`boards/[id]/page.tsx`): `?view=gantt|list` dan `?task=<id>` (deep link notifikasi, F-6.6) kini dibaca dan diteruskan ke `BoardView`.
4. **Notifications cursor pagination** (`api/notifications/route.ts`): `cursor` dibaca tapi diabaikan; kini implementasi `id < cursor` (BIGSERIAL monotonik) yang benar.
5. **Rebalance kolom server-side** (`lib/domain.ts` `moveTask`): saat gap posisi < EPSILON, kolom di-rebalance ke 1000/2000/3000… (PRD §6.2).

Pembersihan 50 warning lint → 0 warning. Semua route memakai `ApiError` statis (bukan dynamic import `await import("@/lib/session")`).

**Verifikasi (dev server + curl terhadap Postgres lokal):**
- Login admin → 200, create board → 3 status default, create 3 task.
- Move task antara pos 3000–4000 → `position=3500` (midpoint benar).
- Move ke Done → `progress=100`, `completed_at` set; move keluar → `completed_at` NULL, reminder `pending` kembali (12 baris = 3 task × 4 jenis).
- Notifications endpoint (no cursor / cursor besar / cursor invalid) → 200, struktur benar.
- Delete board → cascade bersih (0 task, 0 notification_queue).
- `npm run lint` (0 warning), `typecheck` (bersih), `test` (16 passed), `build` (sukses, semua route ter-compile).

## Tambahan sesi 3 — worker cron & cakupan CI

Menutup celah keandalan di worker cron dan cakupan verifikasi:

- **Double-send protection (PRD §15).** Komentar lama mengklaim `FOR UPDATE SKIP LOCKED`, tapi driver Neon **HTTP** tidak punya transaksi (`transaction()` melempar "No transactions support"). Cron Trigger Cloudflare sebenarnya single-flight (tidak overlap), tapi worker tetap diperkuat: setiap transisi status kini **conditional update** (`UPDATE ... WHERE status='pending'`), jadi kalaupun dua invocation overlap, hanya satu yang bisa menggeser baris keluar dari `pending`. Yang kalah UPDATE 0 baris → skip.
- **Quiet-hours stub dihapus** — pergeseran quiet-hours sudah dilakukan di `src/lib/reminders.ts` saat penjadwalan; cron hanya re-check toggle `pushEnabled` global.
- **Logika keputusan diekstrak** ke `src/lib/push-delivery.ts` (murni, tanpa dependensi runtime/DB/fetch): `classifyDeliveryStatus` (2xx/404/410/429/5xx), `backoffMinutes` (5/20/60), konstanta `MAX_DELIVERY_ATTEMPTS=3` & `MAX_SUBSCRIPTION_FAILURES=5`.
- **Cakupan CI** — worker sebelumnya **di-exclude** dari `tsconfig.json` (`"exclude": ["workers"]`) dan `eslint.config.mjs` (`"workers/**"`), jadi `npm run typecheck`/`lint` CI tidak pernah mengeceknya. Ditambahkan script `typecheck:worker` dan dipasang di `deploy.yml`.

**Verifikasi:** `typecheck:worker` bersih, `test` 22 passed (3 file), `lint` 0 warning, `typecheck` bersih, `build` sukses.
