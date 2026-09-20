# Changelog

## [Unreleased]

### Added (Kontrol reminder per task + jam jatuh tempo)

- **Setelan reminder per task di panel task detail**: task kini punya tiga override yang selama ini hanya ada di API — *Mute reminders for this task*, *Remind me when the start date arrives*, dan *Lead time override (minutes)* (`PATCH /api/tasks/:id/reminders`). Sebelumnya tidak ada satu pun pemanggil dari UI, sehingga semua task terkunci pada setelan board: reminder task yang tidak penting tidak bisa dimatikan, dan lead time khusus task penting tidak bisa diatur. Kontrol dinonaktifkan bila task belum punya tanggal, dan tombol **Use default** mengembalikan override ke nilai board.
- **Jam jatuh tempo (due time) di panel task detail**: input `type="time"` menyimpan `dueTime` lewat `PATCH /api/tasks/:id/schedule`. Sebelumnya field ini hanya bisa diisi lewat API, jadi reminder `due_soon` selalu jatuh pada jam default board (08:00) dan deadline "besok 14:00" tidak pernah dihormati. Nonaktif sampai ada due date, dengan tombol Clear.
- **Tandai satu notifikasi sebagai dibaca** di halaman notifikasi (`POST /api/notifications { ids }` — sebelumnya hanya "Mark all as read"), lengkap dengan tombol per item yang disabled saat proses.
- **Judul task di inbox notifikasi kini tautan ke task-nya** (`/boards/:id?task=:taskId`). `GET /api/notifications` ikut mengembalikan `boardId`; task yang sudah dihapus tidak ditautkan.

### Fixed

- **Override lead time terhapus setiap kali hanya toggle lain yang diubah**: `PATCH /api/tasks/:id/reminders` memaksa `leadMinutes: body.leadMinutes ?? null`, jadi menyalakan *Mute* atau *Remind on start* tanpa menyertakan `leadMinutes` selalu menulis `NULL` dan membuang override. Kini field diteruskan apa adanya (`undefined` = jangan diubah, `null` eksplisit = hapus override).
- **`PATCH /api/tasks/:id/schedule` menghapus tanggal pada update sebagian**: `body.startDate ?? null` membuat request yang hanya membawa `dueTime` (atau hanya `dueDate`) menulis `NULL` ke field yang tidak dikirim. Kini `undefined` tidak mengubah apa pun.
- **`leadMinutes` negatif diterima**: nilai seperti `-90` menjadwalkan reminder *setelah* deadline. Kini ditolak `400` bila bukan bilangan bulat non-negatif.
- **Hapus kolom yang berisi task selalu gagal dari UI**: menu kolom memanggil `DELETE /api/statuses/:id` tanpa `?moveTo=`, sehingga API menolak dengan `409 This column holds N tasks` dan tidak ada cara menempuh jalan keluar — kolom berisi task praktis tidak bisa dihapus. Dialog hapus kini menampilkan dropdown kolom tujuan, tombol konfirmasi tetap disabled sampai tujuan dipilih, task dipindahkan (tidak pernah dihapus bersama kolom), dan bila board hanya punya satu kolom muncul pesan agar menambah kolom dulu.

### Tests

- **`reminders.test.ts` +4**: override lead time per task diutamakan atas setelan board, `0` diperlakukan sebagai override (bukan "belum diatur"), override berlaku juga untuk `start_soon`, dan tetap utuh ketika task di-mute. Sebelumnya tidak ada satu pun test untuk jalur override padahal itu inti setelan per task. Total **56 test**.

### Docs

- **`03-history/deployment-logs/` terisi** — direktori ini kosong sejak awal. Kini berisi catatan dua kegagalan deploy produksi pertama (19 Sep) yang sebelumnya hanya tersimpan sebagai pesan commit: `Apply Neon policy` ditolak `HTTP 422` karena plan free membatasi branch yang boleh diproteksi, lalu `Deploy web Worker` gagal karena CI memakai Node 20 sementara `wrangler` 4.130 butuh ≥22. Masing-masing dengan gejala per-step, akar masalah, commit perbaikan, dan pelajarannya. Ada `README.md` yang menjelaskan konvensi + cara memeriksa status deploy.
- **Runbook deployment kini menjelaskan cara membaca kegagalan**, bukan hanya alur sukses: step pertama yang merah adalah satu-satunya yang informasinya nyata (sisanya `skipped`), dan karena `migrate` berjalan sebelum `deploy`, kegagalan di tahap deploy meninggalkan skema yang sudah berubah dengan kode yang belum — keadaan setengah jalan, bukan sekadar "deploy gagal".
- **`requirements.md` dan `architecture.md` tidak lagi kerangka kosong.** Keduanya berhenti di stub sejak commit awal `1e2388b`: tabel komponen tanpa isi dan daftar requirement kosong. Kini keduanya memetakan sistem yang benar-benar ada (17 tabel, 33 route API, alur reminder end-to-end), masing-masing dengan rujukan berkas sebagai bukti.
- **PRD yang dirujuk puluhan titik di kode dinyatakan hilang, bukan dibiarkan menggantung.** README menyebut "PRD v1.2 (`01-documents/PRD-todo-gantt.md`)" padahal berkas itu tidak ada di filesystem maupun riwayat git. `requirements.md` sekarang menyatakan asal-usulnya secara terbuka — direkonstruksi dari kode dan tes, nomor requirement (`F-4.3`, `§6.3`) dipertahankan agar rujukan di kode tetap bisa ditelusuri — dan menegaskan bahwa temuan PRD asli harus **menggantikan**, bukan digabung.
- **`runbooks/deployment.md` diperbaiki: sebelumnya menyesatkan.** Runbook lama menyuruh `make deploy`, padahal target itu hanya mencetak alamat server yang salah (aplikasi ini tidak berjalan di server itu; deploy sebenarnya ke Cloudflare Workers lewat CI). Kini menjelaskan alur sebenarnya (CI → migrate → deploy), cara memeriksa rilis, dan rollback.
- **`Makefile` tidak lagi berisi target palsu.** `make dev/test/lint/deploy` hanya `echo` sehingga selalu "berhasil" tanpa melakukan apa pun. Kini meneruskan ke script npm yang sebenarnya, ditambah `make check` (typecheck + lint + test), dan `make deploy` sengaja gagal dengan pesan yang mengarahkan ke CI.
- **`runbooks/troubleshooting.md` diisi** dengan masalah nyata yang pernah terjadi (origin better-auth, hapus kolom berisi task, OOM lint) beserta penyebab dan solusinya.

### Changed
- **Dialog "Edit board" dan panel "Task detail" kini bisa ditutup dengan Escape** dan ditandai `role="dialog"` / `aria-modal` — sebelumnya hanya `ConfirmDialog` yang punya, sehingga dua dialog terbesar tidak terbaca sebagai dialog oleh screen reader dan mengharuskan klik mouse.

### Added (Profil, notifikasi, modal konfirmasi)
- **Halaman profil** (`/settings/profile`, U8): user dapat mengganti nama tampilan dan timezone sendiri. Timezone divalidasi lewat `Intl` — bukan kosmetik, karena seluruh perhitungan reminder (jam default, quiet hours, "due today") memakai zona ini. Ada saran otomatis dari zona browser, tombol Reset, dan tautan cepat ke ganti password / setelan notifikasi / API keys. Email dan role tetap dikelola admin.
- **`GET`/`PATCH /api/settings/profile`**: endpoint sesi untuk membaca dan memperbarui nama + timezone; menolak timezone tak dikenal (`400`), nama kosong/terlalu panjang, dan body tanpa field yang bisa diubah.
- **Indikator loading "Mark all as read"** (U9): tombol menampilkan `Marking…`, disabled, dan `aria-busy` selama request berjalan.

### Changed
- **Modal konfirmasi hapus user** (U10): `confirm()` native di halaman admin diganti `ConfirmDialog` yang bisa diakses (Escape, klik luar, tombol Cancel/Delete, state busy saat proses), menutup sisa terakhir pemakaian dialog bawaan browser.
- Header aplikasi kini menautkan ke halaman profil (sebelumnya ke ganti password, yang sekarang dijangkau dari halaman profil).

### Added (Public API + API key per user)
- **API key per user** (`/settings/api-keys`): setiap user dapat membuat key sendiri untuk integrasi eksternal (script, n8n, asisten seperti Hermes). Key berformat `fbk_<64 hex>`, **hanya hash SHA-256 yang disimpan**, ditampilkan sekali saat dibuat, mendukung scope `read`/`write` dan masa berlaku opsional. Daftar key menampilkan `lastUsedAt`, dan revoke berlaku seketika.
- **Public REST API v1** (`/api/v1`), diautentikasi lewat `Authorization: Bearer <key>` atau `x-api-key`:
  - `GET /me` — verifikasi key + profil pemilik
  - `GET /boards` — board + kolom (status) + hitungan task
  - `GET /todos` — daftar todo dengan filter `boardId`, `statusId`, `state`, `due` (overdue/today/week/soon), `within`, `q`, `limit`
  - `POST /todos`, `GET/PATCH/DELETE /todos/:id` — CRUD penuh, termasuk `completed: true/false` untuk selesai/reopen
  - `GET /todos/expiring` — bucket `overdue` / `today` / `soon` dalam satu panggilan
  - `GET /reminders` — agenda (`upcoming`, `inbox`, `kinds`), `POST /reminders` — tandai dibaca
- **Isolasi data per key**: setiap query dibatasi ke user pemilik key; board/task milik user lain mengembalikan 404 (bukan 403) agar keberadaannya tidak bocor.
- **Rate limit** 120 request/menit per key, dengan header `X-RateLimit-Limit`/`Remaining`/`Reset` dan `Retry-After` saat 429.
- **CORS + preflight** untuk seluruh permukaan `/api/v1`, sehingga dapat dipanggil dari browser maupun server.
- **Dokumentasi integrasi** `01-documents/api.md` — referensi endpoint, contoh `curl` siap pakai, dan pola aman (key read-only untuk pelaporan, `rw` hanya bila perlu menulis).

### Fixed
- `POST /api/v1/todos` tidak menegakkan scope `write` — key read-only sebelumnya dapat membuat task. Kini mengembalikan 403.
- `PATCH /api/v1/todos/:id` dengan `completed: false` tidak memindahkan task keluar kolom Done — status tetap `done` dan progress tetap 100. Kini dipindah ke kolom terbuka pertama dengan `completedAt` dikosongkan.
- `assertDate()` menerima tanggal mustahil (mis. `2026-02-30`) karena `Date.parse` meroll-over. Kini divalidasi round-trip.

### Added (Gantt view + kontrol kolom)
- **Gantt view** (tab ketiga di board, `/boards/:id?view=gantt`): timeline bulan+harian, shading weekend, bar berwarna per status, milestone (diamond), progress fill, drag-to-move + drag-edge-to-resize, tooltip hover, tray *unscheduled*, dan grup per status yang bisa dilipat.
- **Today-centring**: hari ini selalu berada di tengah viewport; otomatis re-center saat preset (`1M/3M/6M/1Y/All`), zoom, atau tombol `◎ Today` berubah, dan tetap stabil saat ukuran jendela berubah. Kolom hari ini diberi tint + pill + marker gradien agar langsung tertangkap mata.
- **Sort timeline**: `Nearest to today` / `Start date` / `Priority`; toggle `Show completed` dengan lencana jumlah task tersembunyi.
- **Sembunyikan kolom status** (`src/lib/status-visibility.ts`): dropdown `Columns` di header board untuk show/hide kolom status; preferensi per-browser (localStorage) dan diterapkan konsisten di view **board, list, dan gantt**.

### Fixed
- Label `done` palsu pada header kolom Done (kini ikon `✓` dengan tooltip).
- Comparator sort menghasilkan `NaN` untuk task tanpa tanggal.
- Tinggi kontainer baris Gantt diperbaiki agar marker "today" membentang penuh di seluruh grid.

### Added (UI/UX — Fase 2)
- **U1 — Label UI**: task detail kini punya picker label (toggle chip) + form buat label baru (auto-attach), dan kartu task menampilkan chip label. Endpoint baru `GET/POST/DELETE /api/tasks/:id/labels` (validasi label satu board, idempoten).
- **U2 — Feedback autosave**: drawer task menampilkan "Saving… / Saved ✓ / Save failed" (aria-live) untuk setiap perubahan.
- **U3 — Kelola board**: menu aksi di kartu board (edit nama/deskripsi/warna, arsipkan/unarsipkan, hapus dengan konfirmasi ketik nama).
- **U4 — Kelola kolom**: menu header kolom (rename, ganti warna, geser kiri/kanan, hapus dengan konfirmasi).
- **U5 — Empty state kolom**: petunjuk "Drop tasks here" / "No matching tasks".
- **U6 — Shortcut `/`** memfokuskan input pencarian (sesuai placeholder).
- **U10 — ConfirmDialog** komponen modal yang dapat dipakai ulang; menggantikan `confirm()` native pada hapus task dan dipakai untuk hapus board/kolom.

### Fixed
- **U7 — Warna lengkap**: `globals.css` kini mendefinisikan `--indigo/--emerald/--amber/--rose/--sky/--violet/--slate`; mapping warna board/kolom tidak lagi jatuh ke indigo.
- **BUG-8 (P1):** "Mark all as read" di Notifications selalu gagal 404 — frontend memanggil `/api/notifications/read` (tidak ada), backend mendefinisikan read di `POST /api/notifications`. Diperbaiki dengan mengarahkan `markAll` ke `/api/notifications`.
- **BUG-9 (P1):** progress task tidak di-reset saat dipindah keluar kolom "Done" (tetap 100% padahal `completedAt` sudah null). Diperbaiki di `moveTask()` — keluar dari Done kini `progress=0` (bila ada subtask, `recomputeProgressFromSubtasks` menimpanya dengan rasio benar).
- **BUG-10 (P2):** duplikat label memicu 500 (unique constraint) — kini di-precheck dan mengembalikan 400 "Label already exists", dengan fallback `23505` race-safe.
- **BUG-11 (P2):** `/api/push/public-key` (endpoint publik) diblokir middleware untuk anon — ditambahkan ke `PUBLIC_PATHS`.

- **BUG-7 (P0):** change-password stuck in a redirect loop. Two causes: (1) `mustChangePassword` was never cleared after a self-service change — fixed with an `account.update.after` hook (clears only when `context != null`); (2) the session `cookieCache` kept the stale `mustChangePassword=true` in a cookie for up to 5 min — fixed by disabling `cookieCache`. Also added a "✓ Password updated" success state and friendlier error copy. Verified end-to-end: login → change → flag clears immediately → `/boards` returns 200 (no loop) → login with new password works.
- **BUG-6 (P0):** blank white page in real browsers. CSP `script-src 'self'` blocked Next.js App Router's inline RSC bootstrap scripts, so React never hydrated. Added `'unsafe-inline'` to `script-src` (nonce-based CSP is the proper follow-up). Verified: login form renders and full login flow works in a real browser.
- **BUG-1 (P0):** middleware now accepts both `__Secure-better-auth.session_token` (HTTPS) and `better-auth.session_token` (HTTP dev). Previously every authenticated route 307-redirected back to `/login` in production because better-auth prefixes the cookie with `__Secure-` over HTTPS.
- **BUG-2 (P1):** `lastLoginAt` now populates on login via `databaseHooks.session.create.after`.
- **BUG-3 (P1):** `VAPID_SUBJECT` fallback corrected to `mailto:admin@nexigo.my.id`.
- **P2 hardening:** `/api/push/subscribe` now validates `p256dh`/`auth` are unpadded base64url before storing, so the reminder worker never signs/encrypts against a malformed key.

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
