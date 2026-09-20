# 2026-09-20 — Reminder per task, jam jatuh tempo, dan dokumen yang hilang

Melanjutkan dari audit "masih ada task/fitur yang belum selesai?". Semua item di
`e2e-report.md` sudah ✅, jadi yang dikerjakan di sesi ini adalah hal-hal yang
**tidak pernah masuk daftar itu**.

## Yang dikerjakan

### 1. Kontrol reminder per task (backend lama, UI tidak ada)

`tasks.remind_on_start`, `tasks.remind_lead_minutes`, dan `tasks.reminders_muted`
sudah berfungsi sejak lama — `src/lib/reminders.ts` benar-benar membacanya:

```
reminders.ts:103   const lead = task.remindLeadMinutes ?? settings.leadMinutesStart;
reminders.ts:95    if (task.completedAt || task.remindersMuted || ...) return [];
```

Tapi grep di seluruh `.tsx` menemukan **nol pemanggil** `PATCH /api/tasks/:id/reminders`.
Data bahkan sudah dikirim ke browser (`boards/[id]/page.tsx`), hanya tidak
pernah dirender. Akibatnya user tidak bisa mematikan reminder untuk satu task
yang mengganggu, atau memberi lead berbeda untuk task penting.

Ditambahkan seksi **Reminders** di panel task detail: *Mute reminders for this
task*, *Remind me when the start date arrives*, dan *Lead time override
(minutes)* + tombol **Use default**.

### 2. Jam jatuh tempo (`dueTime`)

`PATCH /api/tasks/:id/schedule` menerima `dueTime`, dan `reminders.ts:111`
memakainya (`const dueTime = task.dueTime ?? defaultTime`), tapi input
`type="time"` hanya ada di halaman setelan. Jadi `dueTime` selalu null dan
setiap reminder jatuh pada jam default 08:00 — deadline "besok 14:00" tidak
pernah dihormati. Ditambahkan input jam di panel task detail, nonaktif sampai
ada due date, dengan tombol Clear.

### 3. Notifikasi: tandai satu per satu + deep link

Backend sudah menerima `{ids}` (`inArray` sudah ditulis), UI hanya punya "Mark
all as read". Ditambah tombol **Mark read** per item, dan judul task kini
tautan ke `/boards/:id?task=:taskId` (route `GET /api/notifications` ikut
mengembalikan `boardId`).

## Dua bug nyata yang ditemukan saat mengerjakan ini

Keduanya di route, bukan di UI, dan keduanya merusak data tanpa error:

1. **`PATCH /api/tasks/:id/reminders` membuang override lead time.** Route
   memaksa `leadMinutes: body.leadMinutes ?? null`, jadi menyalakan *Mute* saja
   (tanpa menyertakan `leadMinutes`) menulis `NULL` dan menghapus override.
   Ironisnya ini baru terasa setelah UI-nya ada. Kini field diteruskan apa
   adanya: `undefined` = jangan diubah, `null` eksplisit = hapus.
2. **`PATCH /api/tasks/:id/schedule` menghapus tanggal pada update sebagian.**
   `body.startDate ?? null` membuat request yang hanya membawa `dueTime`
   menulis `NULL` ke `start_date` dan `due_date`. Kini `undefined` tidak
   mengubah apa pun.

Plus validasi `leadMinutes`: nilai negatif menjadwalkan reminder *setelah*
deadline; sekarang ditolak `400`.

## Verifikasi

Dijalankan terhadap **build produksi lokal** (`next build` + `next start`),
bukan `npm run dev`, karena better-auth menolak origin non-3000.

- **UI**: input jam muncul dan tersimpan (`due_time = 15:30:00` dibaca ulang
  dari database).
- **Mute + lead**: menyalakan Mute **tidak lagi** menghapus lead override —
  ini yang dulu rusak (`mute=true, lead=90` tetap utuh; sebelumnya jadi `null`).
- **Rantai penuh**: mengubah lead lewat UI benar-benar menggeser jadwal di
  `notification_queue` — dibuktikan dengan menghitung ulang reminder sebelum
  dan sesudah.
- **Konsistensi**: untuk task tanpa tanggal, ketiga kontrol dinonaktifkan
  seragam (sebelumnya lead override tetap aktif sendirian).
- **Notifikasi**: "Mark read" mengubah satu baris saja (id 28 → read, counter
  2 → 1, item lain tak tersentuh); klik judul membuka drawer task yang benar
  di papan yang benar.
- **Tes**: `reminders.test.ts` +4 tes untuk jalur override (sebelumnya nol test
  untuk ini). Total **56/56 hijau**, typecheck + lint bersih.

Satu catatan proses: tes pertama yang saya tulis untuk jalur override cacat —
ia membandingkan nilai dengan dirinya sendiri sehingga lolos apa pun. Saya
perbaiki jadi dua pemanggilan terpisah yang benar-benar menguji klaimnya.

## Dokumen: dari stub kosong ke peta yang bisa ditelusuri

- `requirements.md` (9 baris) dan `architecture.md` (16 baris) masih kerangka
  kosong sejak commit awal `1e2388b`. Keduanya kini memetakan sistem yang
  benar-benar ada; setiap klaim punya rujukan berkas, dan klaim-klaim itu
  **diverifikasi ulang** (rate limit 5/20 per 15 menit, `disableSignUp: true`,
  validasi tanggal, `uniqueIndex uq_queue_task_kind`, quiet hours 22:00–07:00)
  — bukan ditulis dari ingatan.
- **PRD tidak pernah ada.** README menyebut "PRD v1.2
  (`01-documents/PRD-todo-gantt.md`)" dan ~35 baris komentar kode merujuk `PRD §6.3`,
  `PRD F-4.3`, dst. Berkas itu tidak ada di filesystem **maupun di riwayat git**.
  Alih-alih membiarkan rujukan menggantung atau mengarang PRD lalu menamainya
  "v1.2", `requirements.md` menyatakan asal-usulnya secara terbuka:
  direkonstruksi dari kode dan tes, nomor requirement dipertahankan agar
  rujukan di kode tetap bisa ditelusuri. README diberi catatan yang sama.
- `runbooks/deployment.md` **menyesatkan**: menyuruh `make deploy`, padahal
  target itu hanya mencetak `Deploy to 43.156.128.55...` — dan aplikasi ini
  tidak berjalan di server itu (deploy sebenarnya ke Cloudflare Workers lewat
  CI). Kini menjelaskan alur nyata: CI → migrate → deploy, cara memeriksa
  rilis, dan rollback.
- `02-application/Makefile`: target `dev/test/lint/deploy` hanya `echo`,
  sehingga selalu "berhasil" tanpa melakukan apa pun. Kini meneruskan ke script
  npm, ditambah `make check`; `make deploy` sengaja gagal dengan pesan yang
  mengarahkan ke CI (diuji: `make check` hijau, `make deploy` exit ≠ 0).
- `runbooks/troubleshooting.md` diisi masalah nyata + penyebab + solusi.

## Lanjutan: `03-history/deployment-logs/` diisi

Direktori itu kosong sejak awal (hanya `.gitkeep`), jadi item terakhir dari
daftar "belum selesai" adalah mengisinya dengan sesuatu yang berguna — bukan
sekadar log deploy rutin yang sudah bisa dilihat di GitHub Actions.

Yang ditemukan saat menggali `gh run list`: **dua deploy produksi pertama
(19 Sep) gagal**, dan penyebabnya hanya tersimpan sebagai pesan commit:

1. `Apply Neon policy` → `HTTP 422 "maximum number of protected branches"`.
   `neon.ts` menandai branch default `protected: true`, sementara plan free
   membatasi jumlah branch yang boleh diproteksi. Diperbaiki di `18270a2`.
2. `Deploy web Worker` → CI memakai Node 20, `wrangler` 4.130 butuh ≥22.
   Diperbaiki di `40f6d26`.

Dibuat `2026-09-19-ci-launch-blockers.md` + `README.md` (konvensi + cara
memeriksa status deploy). Dua pelajaran yang layak diingat:

- **Step pertama yang merah adalah satu-satunya yang informatif.** Kegagalan
  pertama hanya muncul sebagai satu step merah diikuti enam step `skipped`;
  membaca pesan error saja tidak cukup, urutan step-nya yang menuntun.
- **Urutan CI penting: `migrate` berjalan sebelum `deploy`.** Kegagalan kedua
  terjadi *setelah* migrasi sukses — skema database sudah berubah sementara
  kode aplikasinya belum. Itu keadaan setengah jalan, bukan sekadar "deploy
  gagal". Runbook deployment kini menyebut hal ini.

Catatan metode: `gh run view <id> --log` mengembalikan output **kosong** untuk
run 19 Sep di mesin ini; yang bekerja adalah
`gh api .../actions/runs/<id>/jobs`, yang memberi status per step.

## Kebersihan

Fixture (user, board, task, dua notifikasi) dibuat lewat script `06-temp/*.tmp.ts`
dan **dihapus seluruhnya** setelah verifikasi — `06-temp/` kosong, port 3000
bebas, working tree bersih sebelum commit.

## Berikutnya (belum dikerjakan)

- Tidak ada item terbuka dari daftar ini. Audit fitur/UI (`e2e-report.md`) dan
  hygiene dokumen sudah tuntas.
