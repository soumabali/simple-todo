# Requirements

> **Asal-usul dokumen ini.** PRD asli (`PRD-todo-gantt.md`, "v1.2") **tidak ada
> di repositori ini** dan tidak pernah ada di riwayat git — README dan ~35
> komentar kode masih merujuk nomor requirement di dalamnya (`PRD §6.3`,
> `PRD F-4.3`, …). Isi di bawah **direkonstruksi dari kode dan tes yang berjalan**,
> bukan dari dokumen sumber. Nomor requirement dipertahankan apa adanya agar
> rujukan di kode tetap bisa ditelusuri. Kalau PRD asli ditemukan, dokumen ini
> harus diganti, bukan digabung.

## 1. Lingkup

**FlowBoard** — aplikasi TODO pribadi berbasis kanban dengan Gantt chart dan
pengingat push browser. Satu instance melayani banyak user; **setiap user hanya
melihat board miliknya sendiri**.

**Bukan tujuan v1:** pendaftaran mandiri (self sign-up), kolaborasi/sharing
board antar user, aplikasi mobile native, langganan berbayar.

## 2. Functional Requirements

### Autentikasi & akun

| ID | Requirement | Bukti |
|---|---|---|
| F-1.1 | Login email+password; 5 kegagalan/email/15 menit dan 20/IP/15 menit dikunci. Pesan gagal bersifat generik (tidak membocorkan email mana yang ada). | `src/lib/rate-limit.ts`, `login_attempts` |
| F-1.2 | Password minimal 8 karakter, mengandung huruf dan angka. | `src/lib/auth.ts` |
| F-1.3 | Admin dapat memaksa user ganti password; sesi dicabut saat password direset. | `must_change_password`, `/api/admin/users/:id/reset-password` |
| F-1.4 | Tidak ada self sign-up. Akun dibuat oleh admin. | `src/lib/auth.ts` (`disableSignUp`) |

### Board

| ID | Requirement | Bukti |
|---|---|---|
| F-2.1 | User dapat membuat, mengganti nama, dan menghapus board. | `boards/page.tsx`, `/api/boards` |
| F-2.2 | Board dapat diarsipkan dan disembunyikan dari daftar aktif. | `/api/boards/:id` |
| F-2.3 | Hapus board menghapus seluruh isinya (cascade). | `/api/boards/:id` |
| F-2.4 | Board milik user lain mengembalikan **404, bukan 403**. | `src/lib/domain.ts` (`getOwnedBoard`) |

### Kolom (status)

| ID | Requirement | Bukti |
|---|---|---|
| F-3.1 | Kolom dapat ditambah, diganti nama, diwarnai, dan diurutkan ulang. | `board-view.tsx`, `/api/statuses/:id/move` |
| F-3.2 | Hanya boleh ada satu kolom bertipe "done" per board. | `src/lib/domain.ts` |
| F-3.3 | Menghapus kolom yang berisi task **ditolak** (`409`) kecuali pemanggil menyebut kolom tujuan lewat `?moveTo=`; task dipindahkan, tidak dihapus. | `/api/statuses/:id` |
| F-3.4 | Urutan kolom disimpan dengan aritmetika midpoint (`position`) dan di-rebalance bila celah terlalu kecil. | `src/lib/ordering.ts` |

### Task

| ID | Requirement | Bukti |
|---|---|---|
| F-4.1 | Task dapat dibuat dalam sebuah kolom, dengan judul dan deskripsi. | `/api/boards/:id/tasks` |
| F-4.2 | Task dapat dipindah antar kolom dan diurutkan ulang (drag & drop, plus tombol untuk aksesibilitas keyboard). | `board-view.tsx`, `/api/tasks/:id/move` |
| F-4.3 | Setiap task punya override reminder sendiri: aktif/tidaknya reminder saat mulai, lead time khusus (menit), dan mute total. Override mengalahkan setelan user. | `tasks.remind_on_start`, `remind_lead_minutes`, `reminders_muted` |
| F-4.4 | Field task (judul, deskripsi, prioritas, progres) tersimpan otomatis saat fokus berpindah. | `task-detail.tsx`, `PATCH /api/tasks/:id` |
| F-4.5 | Task punya prioritas, progres, label, dan checklist subtask. | `subtasks`, `labels`, `task_labels` |
| F-4.6 | Menandai task selesai mencatat `completed_at` dan menghentikan reminder-nya. | `src/lib/domain.ts` |

### Jadwal & Gantt

| ID | Requirement | Bukti |
|---|---|---|
| F-5.1 | Setiap task punya `start_date` dan `due_date`; keduanya menggerakkan bar Gantt. | `src/lib/reminders.ts` |
| F-5.2 | Task juga punya `due_time` (jam jatuh tempo). Bila kosong, reminder memakai jam default dari setelan user. | `tasks.due_time` |
| F-5.3 | Tanggal divalidasi di server: `start_date` tidak boleh melewati `due_date`. | `src/lib/domain.ts` |
| F-5.4 | Tampilan papan dan Gantt dapat ditukar lewat URL, sehingga bisa di-bookmark. | `?view=`, `board-view.tsx` |
| F-5.5 | Perubahan jadwal menjadwalkan ulang reminder secara idempoten (kunci unik `(task_id, kind)`). | `rescheduleTaskReminders` |

### Notifikasi

| ID | Requirement | Bukti |
|---|---|---|
| F-6.1 | Service worker terdaftar agar PWA dapat menerima push. | `src/components/service-worker.tsx`, `public/sw.js` |
| F-6.2 | User dapat mengirim notifikasi uji ke perangkatnya (membuktikan izin + subscription bekerja). | `POST /api/push/test` |
| F-6.3 | Empat jenis reminder: `start_soon`, `due_soon`, `due_today`, `overdue`. | `src/lib/reminders.ts` |
| F-6.4 | Setelan user mencakup pengaktifan per jenis, lead time, jam default, quiet hours, dan timezone. | `notification_settings`, `/settings/notifications` |
| F-6.5 | Pusat notifikasi in-app menampilkan riwayat, menandai satu per satu atau semua sebagai dibaca, dan menautkan ke task asalnya. | `/notifications` |
| F-6.6 | Deep link `?task=<id>` membuka task langsung di papan. | `board-view.tsx` |
| F-6.7 | Push yang gagal diulang dengan backoff 5/20/60 menit; respons `410` langsung menghapus subscription. | `src/lib/push-delivery.ts` |

### Admin

| ID | Requirement | Bukti |
|---|---|---|
| F-8.3 | Admin dapat mengubah nama, email, dan peran user; mengubah email mencabut sesi user tersebut. | `/api/admin/users/:id` |
| F-8.4 | Admin dapat mereset password user (password baru dibuat server, sesi dicabut). | `/api/admin/users/:id/reset-password` |
| F-8.6 | Menghapus user mensyaratkan konfirmasi email yang diketik ulang. | `/api/admin/users/:id` |
| F-8.7 | Rute admin mengembalikan 404 untuk non-admin (bukan 403). | `src/lib/session.ts` |

### Profil, API key, dan integrasi

| ID | Requirement | Bukti |
|---|---|---|
| F-9 | User dapat mengubah nama dan timezone-nya. Timezone memengaruhi semua perhitungan jam reminder, jadi diubah eksplisit, bukan menebak dari browser. | `/settings/profile`, `src/lib/timezones.ts` |
| F-11 | User dapat membuat API key (ditampilkan sekali, disimpan hanya sebagai hash SHA-256) untuk mengakses public API v1. Kepemilikan tetap diverifikasi per user. | `src/lib/api-key.ts`, `01-documents/api.md` |

## 3. Non-Functional Requirements

| ID | Requirement | Bukti |
|---|---|---|
| M2 | Kontrol kepemilikan terpusat; objek milik user lain → 404. | `src/lib/domain.ts` |
| M4 | Validasi tanggal di satu tempat (server), bukan hanya di UI. | `src/lib/domain.ts` |
| M7 | Pengiriman push idempoten dengan backoff dan pembersihan subscription mati. | `src/lib/push-delivery.ts` (+ 6 tes) |
| M8 | Pengamanan operasi destruktif: konfirmasi ketik-ulang untuk hapus permanen. | `board-view.tsx`, `admin/users` |
| §9 | Bentuk galat seragam: `{ error: { code, message } }`. | `src/lib/api-error.ts` |
| §11 | Endpoint push divalidasi berasal dari layanan push yang dikenal. | `/api/push/subscribe` |
| §12.3 | Rotasi VAPID key mematikan semua subscription — didokumentasikan sebagai konsekuensi yang diketahui. | `src/lib/push.ts` |
| §13 | Beban tersebar: penghitungan jadwal murni dan teruji unit; cron hanya I/O. | `src/lib/reminders.ts` (56 tes hijau) |

## 4. Batasan teknis

- Runtime Worker tidak punya transaksi interaktif (driver HTTP Neon) → operasi
  multi-tabel harus idempoten.
- Cron Trigger Cloudflare *single-flight* dan minimum 1 menit; proyek ini
  memakai `*/5 * * * *`.
- Reminder dihitung terhadap `user.timezone`, bukan waktu server.

Lihat `architecture.md` untuk peta komponen dan alur datanya.
