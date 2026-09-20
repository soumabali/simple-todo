# Sesi 2026-09-20 — Public API + API key per user

## Tujuan

Menambah fitur agar **setiap user dapat membuat API key sendiri**, dan key tersebut
dapat dipakai untuk aktivitas todo miliknya: list todo, cek todo yang akan
kedaluwarsa, update status, reminder, dan CRUD penuh. Tujuan akhirnya: integrasi
dengan sistem lain — termasuk **Hermes** — cukup memakai API ini sebagai
penghubung, tanpa cookie sesi browser.

## Yang dibangun

### 1. Skema database

- `api_keys` — `id`, `user_id`, `name`, `prefix`, `key_hash` (SHA-256), `scopes`,
  `expires_at`, `last_used_at`, `revoked_at`, `created_at`
- `api_rate_limits` — `key_id` + `window_start` (PK gabungan), `count`; untuk
  rate limit per menit dengan GC oportunistik
- Migrasi: `drizzle/0002_safe_frog_thor.sql` (di-apply ke Neon **dev** branch)

### 2. Library

- `src/lib/api-key.ts` — `generateApiKey`, `sha256Hex`, `extractApiKey`,
  `verifyApiKey`, `enforceRateLimit`, `parseScopes`, `isKeyActive`,
  `looksLikeApiKey`, `listApiKeys`, `createApiKey`, `revokeApiKey`
- `src/lib/api-v1.ts` — `withApi` wrapper, `authenticate`, `serializeTask`,
  `todayIn`, `assertDate`, `parseLimit`, `daysUntil`, CORS + preflight,
  `rateLimitHeaders`
- `src/lib/api-error.ts` — **dipisah dari `session.ts`** agar helper murni dan
  unit test tidak perlu `DATABASE_URL`/better-auth. `session.ts` me-re-export
  `ApiError` sehingga import lama tetap jalan.

### 3. Endpoint `/api/v1`

`me`, `boards`, `todos` (GET/POST), `todos/:id` (GET/PATCH/DELETE),
`todos/expiring`, `reminders` (GET/POST) — plus `OPTIONS` preflight di semuanya.

### 4. Manajemen key (sesi login)

`GET/POST/DELETE /api/api-keys` + halaman UI `/settings/api-keys` dengan
generate (label, scope, expiry), panel key sekali-tampil + Copy, daftar key
dengan `lastUsedAt`, revoke via `ConfirmDialog`, dan referensi endpoint.
Middleware diperbarui: `/api/v1` masuk `PUBLIC_PATHS` (auth internal handler).

## Temuan penting saat pengujian

Tiga bug nyata ditemukan **hanya karena diuji end-to-end dengan data asli**, bukan
dari typecheck:

1. **Scope tidak ditegakkan di `POST /todos`** — handler dipanggil tanpa argumen
   `"write"`, jadi key read-only bisa membuat task. Diperbaiki → 403.
2. **Reopen tidak benar-benar membuka** — `completed: false` hanya mengosongkan
   `completedAt`; task tetap di kolom Done dengan progress 100. Diperbaiki:
   dipindah ke kolom terbuka pertama, `progress = 0`.
3. **`assertDate` meloloskan tanggal mustahil** (`2026-02-30`) karena
   `Date.parse` meroll-over ke bulan berikutnya. Diperbaiki dengan round-trip.

Selain itu `view=kinds` awalnya mengembalikan baris queue, bukan katalog jenis
reminder seperti yang didokumentasikan — diperbaiki menjadi katalog + setelan
notifikasi user.

## Verifikasi

- **18/18** skenario E2E lulus (login → generate key → semua endpoint → revoke)
- **13** edge case lulus: validasi body/tanggal, header salah, board user lain
  → 404, rate limit 429 + `Retry-After` (tepat di request ke-121)
- **Isolasi lintas-akun terbukti**: key user B → `GET`/`PATCH`/`DELETE` task
  user A semuanya **404**, dan task user A tetap utuh
- **UI diuji di browser**: generate → key langsung bekerja → revoke → key mati (401)
- Unit test **48/48** (15 untuk `api-key`, 11 untuk helper `api-v1`)
- `tsc --noEmit`, eslint, dan `next build` bersih

## Catatan operasional

- Rate limit: **120 request/menit per key**; header `X-RateLimit-*` di setiap
  respons sukses, `Retry-After` saat 429.
- Key hanya disimpan sebagai hash — nilai asli tidak bisa ditampilkan lagi.
- Board/task milik user lain mengembalikan **404**, bukan 403, agar keberadaan
  resource user lain tidak bocor.

## Belum dikerjakan

- U8 halaman profil user (ganti nama/timezone)
- U9 indikator loading "Mark all as read"
- U10 sisa `confirm()` native di `admin/users/page.tsx`
- `01-documents/requirements.md` & `architecture.md` masih stub;
  `01-documents/PRD-todo-gantt.md` yang dirujuk README tidak ada di repo
