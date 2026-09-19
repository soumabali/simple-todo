# E2E Test Report — FlowBoard Production (2026-09-19, full re-test)

**Date:** 2026-09-19
**Method:** Live end-to-end terhadap `https://todo.nexigo.my.id` (Cloudflare Workers + Neon Postgres), diuji via HTTP API (authoritative) **dan** browser sungguhan (login → board → kanban → gantt → list → notifications → admin → sign out, tanpa JS error).
**Scope:** Auth, boards, status, tasks, subtasks, labels, Gantt, notifications, push, settings, admin, otorisasi/isolas‌i, change-password, logout.
**Credential test:** dibuat user E2E langsung di DB production (pola seed), lalu dihapus bersih setelah tes. Tidak ada data produksi yang tersentuh.

---

## 1. Ringkasan hasil

| Area | Hasil |
|---|---|
| Auth (login/logout/session/change-password/role) | ✅ Semua lulus |
| Boards (CRUD + status default + rename) | ✅ Semua lulus |
| Status (create/move/patch/validation) | ✅ Semua lulus |
| Tasks (CRUD + move + schedule + reminders + date validation) | ✅ Semua lulus |
| Subtasks (add/toggle/recompute progress) | ✅ Semua lulus |
| Labels (create) | ⚠️ 1 bug (duplikat → 500 bukan 400) |
| Gantt (endpoint) | ✅ Lulus |
| Notifications (list) | ✅ Lulus; **"mark all read" rusak (404)** |
| Settings | ✅ Lulus (catatan: format waktu `09:00:00`) |
| Push (public-key/subscribe/validate) | ⚠️ public-key diblokir untuk anon (307) |
| Admin (user CRUD/reset/logs/safeguards) | ✅ Semua lulus |
| Otorisasi/isolas‌i (cross-user, non-admin) | ✅ Semua lulus |
| UI/UX browser | ✅ Render + navigasi + drawer + sign out OK; 0 JS error |

**Kesimpulan:** Fungsionalitas inti FlowBoard **sehat** — seluruh CRUD, drag & drop, jadwal, otorisasi, dan admin bekerja benar di production. Yang tersisa adalah **4 bug nyata** (2 di antaranya P0/P1 yang terlihat langsung oleh user) + **sekumpulan peluang perbaikan UI/UX**.

---

## 2. Bug list (diprioritaskan)

### BUG-8 — P1 — Tombol "Mark all as read" di Notifications selalu gagal (404)

**Gejala:** Di halaman `/notifications`, tombol "Mark all as read" memanggil `/api/notifications/read`, tapi route tersebut **tidak ada**. Backend mendefinisikan endpoint read di `POST /api/notifications` (route `src/app/api/notifications/route.ts`), bukan `/api/notifications/read`.

**Bukti:** `curl POST /api/notifications/read` → **404** (HTML not-found); `curl POST /api/notifications` dengan `{"all":true}` → **200 `{"ok":true}`**.

**Akar:** Mismatch path antara frontend (`src/app/(app)/notifications/page.tsx` baris `markAll` → `api("/api/notifications/read", ...)`) dan backend (route di `/api/notifications`).

**Fix:** Ubah `markAll` (dan kalau ada) untuk memanggil `/api/notifications` (POST), **atau** tambahkan route `/api/notifications/read` alias. Pilih salah satu; pastikan keduanya sinkron.

---

### BUG-9 — P1 — Progress task tidak reset saat keluar dari kolom "Done"

**Gejala:** Pindahkan task ke kolom "Done" → `progress=100` & `completedAt` di-set (benar). Tapi pindahkan **keluar** dari "Done" → `completedAt` di-null (benar) **namun `progress` tetap 100** (salah). Task yang belum selesai tampil sebagai "100% selesai" di UI.

**Bukti:** `moveTask` di `src/lib/domain.ts` — saat keluar dari done (`else if (!isDone && task.completedAt)`), hanya `completedAt=null`; `progress` tidak di-reset. Komentar di kode bahkan mengakui: `// progress recomputed if there are subtasks, else keep as-is`.

**Akar:** `src/lib/domain.ts` `moveTask()` baris `else if (!isDone && task.completedAt)`.

**Fix:** Saat keluar dari Done tanpa subtask, reset `progress` ke `0` (atau nilai yang wajar). Jika ada subtask, biarkan `recomputeProgressFromSubtasks` yang menghitung.

---

### BUG-10 — P2 — Duplikat label menghasilkan 500 (bukan 400 yang ramah)

**Gejala:** Membuat label dengan nama yang sudah ada di board yang sama memicu **500 Internal Server Error** (unik constraint `uq_labels_board_name`), bukan 400 dengan pesan jelas.

**Bukti:** `POST /api/boards/:id/labels` dengan nama duplikat → 500. `src/app/api/boards/[id]/labels/route.ts` tidak menangkap unique-violation.

**Akar:** `src/app/api/boards/[id]/labels/route.ts` — insert tanpa `onConflictDoUpdate`/pre-check, dan error mapping tidak memetakan `23505` (unique_violation) ke 400.

**Fix:** Pre-check duplikat (atau tangkap `23505`) → return 400 `"Label already exists"`.

---

### BUG-11 — P2 — `/api/push/public-key` diblokir middleware untuk anon

**Gejala:** `GET /api/push/public-key` (yang **dirancang publik** — route handler-nya tidak memanggil `requireUser`) di-redirect 307 ke `/login` oleh middleware, karena `PUBLIC_PATHS` di middleware hanya berisi `/login` dan `/api/auth`.

**Dampak:** Service worker yang mendaftar push subscription perlu membaca public key. Meskipun di aplikasi nyata pengguna sudah login (jadi jarang bermasalah), endpoint publik ini semestinya bisa diakses tanpa sesi (mis. saat SW berjalan di latar belakang setelah sesi berakhir).

**Akar:** `src/middleware.ts` `PUBLIC_PATHS` tidak menyertakan `/api/push/public-key`.

**Fix:** Tambah `/api/push/public-key` ke `PUBLIC_PATHS` (aman, karena tidak bocorkan data sensitif — hanya VAPID public key).

---

## 3. UI/UX improvement (mempermudah pengguna)

Ini bukan bug (fitur jalan), tapi peluang untuk membuat aplikasi lebih mudah & nyaman dipakai:

| # | Area | Masalah saat ini | Saran perbaikan |
|---|---|---|---|
| U1 | **Label tidak bisa dipakai** | Label sudah bisa dibuat via API, tapi **tidak ada UI** untuk menambah/menampilkan label di task detail maupun board. `taskLabels` di-query tapi tidak dirender. Fitur "label" setengah jadi. | Tambahkan UI label di task detail (chip + picker), dan tampilkan chip label di kartu task. |
| U2 | **Tidak ada feedback saat save task detail** | Autosave (`onBlur`/`onChange`) tidak menampilkan indikator "saved". User tidak tahu apakah perubahan tersimpan (apalagi saat gagal). | Tambahkan indikator "Saving… / Saved ✓ / Failed" kecil di drawer, dan tampilkan error bila mutation gagal. |
| U3 | **Board tidak bisa di-edit/di-arsipkan/dihapus dari UI** | API mendukung PATCH (rename/archive) & DELETE board, tapi UI boards list hanya bisa **membuat** board. Tidak ada cara mengubah nama, deskripsi, warna, arsip, atau hapus board. | Tambahkan menu aksi di kartu board (rename, arsip, hapus dengan konfirmasi) — API sudah siap. |
| U4 | **Kolom (status) tidak bisa di-rename/di-hapus/di-reorder dari UI** | API mendukung PATCH/DELETE/move status, tapi UI hanya bisa "+ Add column". | Tambahkan menu di header kolom: rename, hapus (dengan moveTo), geser urutan (drag header). |
| U5 | **Tidak ada empty-state yang memandu di board** | Board kosong hanya menampilkan kolom kosong tanpa petunjuk. | Tambahkan hint di kolom kosong ("Drag tasks here" / "Add your first task"). |
| U6 | **Search tidak punya keyboard shortcut nyata** | Placeholder menulis "Search tasks… (/ to focus)" tapi tidak ada listener untuk tombol `/`. | Implementasi global keydown `/` → fokus input search (1 baris). |
| U7 | **Warna board/kolom terbatas & mapping rapuh** | Pilihan warna board hanya 7; mapping warna `sky`/`violet`/`slate` di UI board-view **tidak punya** var CSS (`--sky`, `--violet` dll tidak didefinisikan di `globals.css`), jadi warna selain 4 dasar akan jatuh ke fallback `var(--accent)` (indigo). | Definisikan var warna lengkap di `globals.css` (`--sky`, `--violet`, `--slate`, dst) atau batasi pilihan ke warna yang sudah ada var-nya. |
| U8 | **Detail akun pengguna tidak bisa diedit sendiri** | Tidak ada halaman profil untuk ganti nama/email/timezone; user hanya bisa ganti password. | Tambah halaman profil sederhana (ganti nama, timezone) via endpoint `PATCH /api/auth/update-user` (better-auth) — opsional. |
| U9 | **Notifikasi "Mark all as read" disabled saat 0 unread, tapi tidak ada indikator loading** | Minor. | (Tercakup di BUG-8; perbaiki path dulu.) |
| U10 | **Konfirmasi destructive action tidak konsisten** | Delete task pakai `confirm()` native; delete board/kolom/user belum ada (karena belum ada UI). | Standarkan modal konfirmasi yang rapi (bukan `confirm()` browser). |

---

## 4. Plan & task untuk pengerjaan selanjutnya

### Fase 1 — Perbaikan bug (wajib, kecil & cepat)

**Task A (P1) — Fix "Mark all as read" 404**
- Ubah `src/app/(app)/notifications/page.tsx` `markAll` → panggil `POST /api/notifications` (atau tambah route alias `/api/notifications/read`).
- Deploy, verifikasi: buat notifikasi sent → klik "Mark all as read" → 200 & unread jadi 0.

**Task B (P1) — Reset progress saat keluar "Done"**
- Edit `src/lib/domain.ts` `moveTask()`: pada cabang `else if (!isDone && task.completedAt)`, set `progress` ke 0 (bila tanpa subtask).
- Tambah unit test di `ordering`/`domain` test (atau vitest baru).
- Deploy, verifikasi via API: move ke Done → 100; move keluar → 0.

**Task C (P2) — Duplikat label → 400 ramah**
- Edit `src/app/api/boards/[id]/labels/route.ts`: pre-check nama atau tangkap `23505` → 400 "Label already exists".
- Deploy, verifikasi.

**Task D (P2) — Buka `/api/push/public-key` untuk anon**
- Tambah `/api/push/public-key` ke `PUBLIC_PATHS` di `src/middleware.ts`.
- Deploy, verifikasi anon 200.

### Fase 2 — UI/UX (prioritas berdampak tinggi)

**Task E — UI Label (U1)**
- Render chip label di kartu task + picker label di task detail.
- Endpoint sudah ada (`GET /api/boards/:id` mengembalikan `labels` & `taskLabels`; `POST /api/boards/:id/labels` untuk buat).

**Task F — Feedback autosave + error handling (U2)**
- Tambah state `saving/saved/error` di `TaskDetail`; tampilkan indikator.

**Task G — Edit/archive/delete board (U3)**
- Menu aksi kartu board (rename via PATCH, archive toggle, delete dengan konfirmasi).

**Task H — Kelola kolom (rename/hapus/reorder) (U4)**
- Menu header kolom: rename, hapus (dengan `moveTo`), reorder via drag.

### Fase 3 — Polesan (opsional)

**Task I — Empty states & keyboard shortcut (U5, U6)**
**Task J — Warna lengkap di globals.css (U7)**
**Task K — Profil pengguna (U8) + modal konfirmasi standar (U10)**

---

## 5. Bukti verifikasi (redacted)

- Login admin → 200, role `admin`, cookie `__Secure-better-auth.session_token` ✅
- `lastLoginAt` ter-populate (`2026-09-19T09:31:08Z`) ✅
- Create board → 201, 3 status default (To Do/In Progress/Done, `isDone` benar) ✅
- Task: create 201, date validation 400, move→Done `progress=100`+`completedAt` set, move→keluar `completedAt=null` **tapi `progress=100` (BUG-9)** ⚠️
- Subtask toggle → progress recompute 50% ✅
- Label duplikat → **500 (BUG-10)** ⚠️
- Gantt → 200, task berjadwal ter-return ✅
- Notifications list 200; **`POST /api/notifications/read` → 404 (BUG-8)** ⚠️
- Settings PATCH → 200 (defaultTime tersimpan sebagai `09:00:00`) ✅
- Push: public-key authed 200 (len 87); anon → **307 (BUG-11)** ⚠️; subscribe valid 201; endpoint non-push 400 ✅
- Admin: list 200, create user 201 (password generated), reset-password 200, delete 200, self-delete/demote diblokir 400 ✅
- Non-admin `/api/admin/users` → 404; cross-user board/task → 404 ✅
- Change-password: 200, old pass 401, new pass 200 ✅
- Browser: login → boards → kanban → task drawer → gantt → list → notifications → admin → sign out, **0 JS error** ✅
