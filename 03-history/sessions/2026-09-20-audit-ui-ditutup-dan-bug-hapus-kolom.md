# Sesi 2026-09-20 (lanjutan 2) — Audit UI ditutup + bug hapus kolom

## Tujuan

Menindaklanjuti sisa task yang tercatat di `03-history/e2e-report.md`. Rencana awal
adalah mengerjakan U3 (edit/arsip/hapus board) dan U4 (kelola kolom), karena laporan
menyebut keduanya belum ada UI-nya.

## Temuan: laporan stale

U3 dan U4 **sudah terimplementasi** — commit `b480c2b` mengerjakan U1–U7 + U10, tapi
tabel temuan di `e2e-report.md` §4 tidak pernah diperbarui. Dibuktikan dengan membaca
kode dan menjalankannya di browser:

- U1: chip label tampil di kartu (`urgent`) dan di drawer.
- U2: autosave menampilkan `Saving…` → `Saved ✓` via `aria-live="polite"`, dibungkus
  helper `withFeedback` yang juga menangkap error.
- U3: menu ⋯ board → Edit board (rename), Archive, Delete board dengan
  type-to-confirm (nama salah → tombol disabled).
- U4: menu ⋯ kolom → Move left/right, Rename, Color, Delete column.

Jadi tidak ada yang perlu ditambahkan untuk U3/U4. Yang benar-benar kurang hanya U8/U9
(dikerjakan di sesi sebelumnya) — dan satu bug yang belum tercatat.

## Bug yang diperbaiki: hapus kolom berisi task selalu gagal

Menu kolom memanggil `DELETE /api/statuses/:id` **tanpa** `?moveTo=`. API menolak dengan
`409 {"message":"This column holds 2 tasks"}`. Karena UI tidak pernah menyediakan cara
mengirim `moveTo`, kolom berisi task **praktis tidak bisa dihapus** — pesan errornya
muncul di dialog, tapi tidak ada jalan keluar.

Perbaikan di `src/components/board-view.tsx`:

- Prop baru `otherStatuses` pada `Column` (semua kolom lain di board).
- `removeColumn` menerima `moveTo` opsional dan menambahkannya ke query string.
- Dialog hapus menampilkan dropdown "Move N task(s) to" bila kolom berisi task;
  tombol konfirmasi (`Move tasks & delete`) **disabled** sampai tujuan dipilih.
- Bila board hanya punya satu kolom, muncul pesan bahwa tidak ada tujuan pemindahan
  dan tombol tetap disabled.
- Task dipindahkan, tidak pernah dihapus bersama kolom.

## Perbaikan aksesibilitas dialog

`EditBoardDialog` (boards) dan panel `TaskDetail` hanya punya `<div>` tanpa
`role="dialog"` dan hanya bisa ditutup dengan klik mouse. Keduanya kini:

- `role="dialog"` + `aria-modal="true"` + `aria-label`
- Escape menutup dialog, lewat `window.addEventListener("keydown")` — pola yang sama
  dengan `ConfirmDialog`, bukan `onKeyDown` pada div (yang hanya jalan bila fokus ada
  di dalam elemen). Pada `TaskDetail` hook diletakkan **sebelum** early return
  `if (!task) return null` agar urutan hook stabil.

## Verifikasi

API (`06-temp/u34-api.tmp.sh`, sudah dihapus):

- `DELETE /api/statuses/:id` tanpa `moveTo` → `409 This column holds 2 tasks`
- dengan `moveTo` → `200`, kedua task pindah ke kolom tujuan, **jumlah task tetap 2**
  (tidak ada yang hilang), kolom sumber hilang
- `moveTo` ke kolom board lain → `404`

Browser (fixture akun sementara, sudah dibersihkan):

- dropdown hanya memuat kolom lain; tombol konfirmasi disabled sebelum memilih
- hapus kolom kosong: tidak ada dropdown, langsung konfirmasi
- board satu kolom berisi task: pesan muncul, tombol tetap disabled, task utuh
- U3: rename board live, Archive + filter "Archived", delete dengan type-to-confirm
- U4: rename kolom (`Reviewed` → `QA Passed`), Move left benar-benar menukar urutan
- U1/U2 dikonfirmasi ada (chip label; `Saving…` → `Saved ✓`)
- Escape menutup dialog "Edit board" dan drawer "Task detail"
  (`role=dialog` terdeteksi, setelah Escape hilang)

Gates: `typecheck`, `typecheck:worker`, `eslint` (0 warning), **52/52** unit test,
`next build`.

## Deploy

Commit `f743630` → push → CI `35483672014` hijau (`verify: success`, `deploy: success`).
Log deploy memuat `Uploaded flowboard-web` + `Current Version ID: b854839e-…`.
Production `/login` → `200` dalam 0.57s.

Catatan: verifikasi chunk production lewat HTTP tidak bisa dilakukan karena halaman
board butuh sesi login dan kredensial production tidak tersimpan. Bukti deploy =
log CI (upload + version ID baru) dan verifikasi fungsional pada build produksi lokal
(`next start` dari `next build` yang sama).

## Catatan kebersihan

- Tabel temuan `e2e-report.md` §4 kini punya kolom Status dan ditandai ✅, dengan
  catatan bahwa bagian itu adalah temuan awal audit, bukan daftar tugas terbuka.
- Data uji dev: **0 user tersisa**; `06-temp/` kosong; tidak ada listener di port 3000;
  working tree bersih.
