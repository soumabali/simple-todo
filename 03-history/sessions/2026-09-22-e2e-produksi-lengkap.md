# 2026-09-22 — E2E produksi penuh (user + admin + API)

Permintaan Dhar: "coba lakukan end 2 end testing fungsionalitas semuanya di domain
url, baik itu user maupun admin".

Dijalankan **terhadap produksi** (`todo.nexigo.my.id`), bukan lokal — produksi
satu-satunya lingkungan dengan Worker + Neon sungguhan.

## Hasil

```
70 tes, 70 PASS, 0 FAIL
```

14 bagian: AUTH, BOARDS, STATUSES, TASKS, SUBTASKS, LABELS, GANTT,
NOTIFICATIONS, SETTINGS, PUSH, ADMIN, ISOLATION, CHANGE-PASSWORD, LOGOUT.

Setelah perbaikan bug (#28) di-merge dan deploy hijau, run ketiga bersih 70/70.

## Dua belas jam lebih cepat ini: akun tes

`02-application/scripts/e2e-provision.ts` sudah ada dan menangani hal yang paling
mudah salah: hash password **wajib** dari `@better-auth/utils/password`'s
`hashPassword`. Reimplementasi dengan `crypto.scryptSync` "terlihat sama" dan
tidak sama — better-auth memberi salt 16-byte sebagai **string hex**, jadi
meneruskan Buffer mentah menghasilkan hash yang tidak pernah terverifikasi.
Gejalanya `401 INVALID_EMAIL_OR_PASSWORD` untuk password yang baru saja diset.

Akun (`e2e-admin@` / `e2e-user@flowboard.test`) dibuat dengan password acak,
ditulis ke JSON `0600`, dan **tidak pernah dicetak**. Dihapus setelah selesai.

Tidak ada password yang ditanyakan atau diketk di chat. Itu sebabnya Dhar memilih
opsi "buat user tes baru" dari opsi yang ditawarkan.

## Bug yang ketemu: #28 — label unik lintas board

Ditemukan oleh tes 6.1, bukan oleh pembacaan kode.

```ts
where: (l, { eq: e }) => e(l.boardId, id) && e(l.name, name)
```

`eq()` mengembalikan objek, jadi operand kiri `&&` **selalu truthy** dan JS
short-circuit ke operand kanan saja. Hanya satu kondisi sampai ke query, dan yang
hilang justru `board_id`. Akibatnya nama label unik lintas board, padahal unique
index-nya sudah benar: `uq_labels_board_name (board_id, name)`.

Gejala yang terlihat pengguna: board yang belum punya label sama sekali menolak
nama yang sudah dipakai board lain, dengan pesan "Label already exists".

**Kenapa ini penting dicatat:** barisnya terlihat benar saat dibaca, dan
`tsc`/lint/build semuanya lewat. Hanya SQL yang dihasilkan yang menunjukkan
masalahnya. Karena itu regression test-nya (`drizzle-where.test.ts`) meng-assert
**bentuk query**, bukan teks sumber.

Perbaikannya (`and()` eksplisit) diverifikasi dengan uji pembeda di produksi.

## Tiga bug di harness E2E, bukan di aplikasi

Penting dibedakan supaya tidak salah lapor sebagai cacat produk:

1. **tes 8.2** memanggil `/api/notifications/read` — rute yang **tidak pernah ada**.
   Komentar doc di handler menulis path itu, dan harness menyalinnya. Rute yang
   benar `POST /api/notifications`. Komentarnya sekalian diperbaiki.
2. **tes 9.3** membandingkan `defaultTime` dengan `"09:00"` padahal kolom `time`
   Postgres mengembalikan `"09:00:00"`. Datanya selalu benar, asersinya salah.
3. **tes 14.2** crash (`None.get`) saat sesi habis → ringkasan tidak pernah
   tercetak dan tes setelahnya tidak jalan. Ini yang membuat run pertama tampak
   "hampir lulus" padahal belum selesai.

Run pertama: 67 PASS / 2 FAIL / 1 crash → 69/70 (1 bug asli) → 70/70.

## Verifikasi

- E2E produksi penuh: **70/70**
- `tsc` bersih · **96/96** tes unit (93 + 3 regression) · `next build` sukses
- CI `verify: pass` · deploy `verify: success` + `deploy: success`
- DB produksi: 3 akun asli utuh, **0** sisa data tes (board/task/label)

## Catatan proses

- Prinsip yang dipakai: **bedakan bug aplikasi dari bug tes sebelum melaporkan.**
  Dua dari tiga kegagalan run pertama ternyata bug harness. Melaporkannya sebagai
  bug produk akan mengirim orang memperbaiki kode yang sudah benar.
- Harness dan skrip provisioning ini sudah ada sebelumnya dan berkualitas — yang
  kurang hanya dijalankan. Pelajaran: sebelum menulis alat baru, cari dulu.
