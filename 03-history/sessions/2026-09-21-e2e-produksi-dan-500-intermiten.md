# Sesi 2026-09-21 — E2E produksi, dan satu bug yang hanya muncul kalau dijalankan

Tanggal: 2026-09-21
Terkait: issue #19 (temuan baru), PR #18 (perbaikan), `03-history/e2e-report-2026-09-21.md`

## Yang dikerjakan

Lanjutan task yang belum selesai + E2E penuh terhadap produksi
(`https://todo.nexigo.my.id`), sesuai permintaan Dhar.

## Hasil E2E

Bagian yang berhasil disentuh **sehat**: auth (login/logout/session/wrong-password/
role), boards (create/rename/list), statuses (create/move/patch/validasi),
otorisasi. Unit test 56/56, `src/` lint bersih, `todo.nexigo.my.id` up.

E2E **tidak bisa diselesaikan** karena satu bug produksi (BUG-12 di bawah).
Harness berhenti di langkah 4.1.

## Temuan utama: 500 intermiten pada `/api/boards` (issue #19, PR #18)

Sekitar **5% page load board** gagal. Yang paling penting bukan angkanya,
melainkan **cara menemukannya**: tidak ada satu pun baris ini yang akan muncul
dari membaca kode.

**Yang menyingkirkan dugaan awal.** Kesan pertama "ini pasti concurrency" —
route `GET /api/boards/:id` menjalankan 5 query paralel lewat `neon-http`.
Diuji, dan **salah**:

| Pola | Kegagalan |
|---|---|
| berurutan, satu per satu | **1/12 gagal** |
| paralel, 5 sekaligus | **0/15 gagal** |

Terbalik dari dugaan. Ditambah yang gagal kadang `subtasks where false` — query
termurah yang kita punya — maka bebannya bukan faktor.

**Yang menunjuk ke arah benar.** Mengukur *waktu*, bukan hanya status: request
500 memakan **24.8 s / 37.2 s / 74.6 s**, sedangkan 200 memakan median **1.2 s**.
Dari `wrangler tail`, `wallTime` yang gagal 39.6 s dan 85.4 s; yang normal
1.5–3.3 s. Jadi pola-nya bukan "kadang gagal" melainkan **"kadang menggantung
lalu mati"**. Setelah itu penyebabnya jelas: koneksi Neon, bukan SQL kita.

**Bukti tambahan yang mengonfirmasi:** respons 500 yang lambat **tidak punya
header `cf-ray`**, sedangkan semua 200 punya.

## Kesalahan saya sendiri selama sesi ini

- **Menyimpulkan penyebab dari kesan, bukan dari pengukuran.** Hipotesis pertama
  saya (concurrency) terdengar masuk akal dan salah. Yang membalikkannya adalah
  menguji pola **berurutan vs paralel** — bukan membaca kode lebih lama.
- **Mengira 500 di E2E adalah "cold start".** Run pertama gagal di
  `1e.1 user login` dan `2.4 board detail`; saya sempat menganggapnya transient.
  Ternyata reproducible (2/6, lalu 2/15 dengan `wrangler tail` menempel).
  Pelajaran: "coba lagi saja" adalah cara paling mudah melewatkan bug yang
  sebenarnya paling sulit ditemukan.
- **Membuat tes dengan klaim mutasi yang tidak benar.** Saya menulis komentar
  bahwa menukar urutan pemeriksaan `FATAL`/`TRANSIENT` akan membuat tes merah.
  Saya jalankan mutasinya: **tetap hijau** — kedua himpunan kode itu tidak
  beririsan, jadi urutannya memang tidak teramati. Saya hampir membiarkan
  komentar itu. Diganti dengan mutasi yang benar-benar memerahkan tes
  (menghapus pemeriksaan `FATAL` → 2 tes merah, diverifikasi).
- **Menyangka `npm run lint` berarti repo punya 1 075 error.** Angka itu
  seluruhnya dari `.open-next/` — direktori build yang ter-`.gitignore` dan tidak
  pernah di-lint di CI. `eslint src/` = 0 masalah. Mudah disalahartikan sebagai
  kerusakan besar.
- **Hash password better-auth saya tiru, bukan dipakai.** `crypto.scryptSync`
  dengan Buffer sebagai salt terlihat setara dan **tidak**: better-auth memakai
  salt hex *string*. Gejalanya 401 untuk password yang baru saja dibuat — dan
  saya sempat mencurigai skema/kolom yang salah sebelum menemukan ini.
- **Jebakan skema `public` vs `neon_auth`.** Database punya dua set tabel; yang
  dipakai aplikasi adalah `public` dengan kolom **snake_case**, sedangkan
  `neon_auth` (camelCase) adalah sisa eksperimen Managed Better Auth. Menulis ke
  yang salah menghasilkan user yang tidak bisa login.

## Yang belum selesai

- **Kriteria 3 issue #19** — 50 percobaan produksi tanpa kegagalan — butuh
  merge + deploy. Belum bisa diklaim.
- **7 issue lama masih terbuka**, 4 di antaranya `status: blocked` oleh izin
  token: merge PR (#11), metadata repo (#2), branch protection (#3), identitas
  bot (#4). Lisensi (#1) sebenarnya sudah selesai dikerjakan (ADR-001 + `LICENSE`
  + `CONTRIBUTING.md`) tetapi issue-nya masih `blocked` — perlu ditutup.
- **Warning Better Auth rate-limiting** ("could not determine a client IP,
  falling back to a single shared per-path bucket") muncul di setiap request.
  Bukan kosmetik: semua pengguna berbagi satu bucket, jadi satu klien agresif
  bisa membuat pengguna lain kena rate limit. Header yang tersedia di Worker
  adalah `cf-connecting-ip` → perlu didaftarkan sebagai trusted header.

## Catatan proses

Dua pertanyaan izin dikirim ke Dhar sebelum menulis ke repo publik (buat issue,
dan lanjutkah perbaikan). Keduanya tidak dijawab dalam 10 menit. Karena arahan
tetap Dhar adalah "orkestrasi penuh, jangan tanya untuk keputusan rutin", saya
lanjut — tetapi dengan pilihan yang **paling konservatif**: menulis ke file
lokal dulu, lalu memperbaiki lewat **PR** (bukan push langsung ke `main`),
sehingga Dhar tetap punya satu titik untuk menolak.
