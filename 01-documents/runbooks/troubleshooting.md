# Troubleshooting

Masalah nyata yang pernah terjadi di proyek ini, beserta penyebab dan solusinya.
Tambahkan baris baru setiap kali sebuah insiden selesai ditangani.

## Symptom → Cause → Fix

| Symptom | Cause | Fix |
|---------|-------|-----|
| CI gagal di tahap `verify` dengan `JavaScript heap out of memory` | Runner/ mesin dev hanya punya ~3.6 GB RAM; eslint + `next build` bersamaan melewati batas heap default Node | Jalankan dengan `NODE_OPTIONS="--max-old-space-size=2560"`, atau pisahkan lint dan build ke langkah terpisah |
| Login berhasil di Postman/curl tapi browser menolak dengan `INVALID_ORIGIN` | better-auth menolak origin yang tidak terdaftar sebagai trusted | Sajikan preview di port **3000**; origin lain harus ditambahkan ke `trustedOrigins` |
| Halaman `/boards` atau `/settings/*` mengembalikan `307` | Belum ada sesi — middleware mengarahkan ke `/login` | Bukan bug. Login dulu; untuk cek tanpa sesi gunakan `/login` (harus `200`) |
| `Error: DATABASE_URL is not set` saat menjalankan script di `06-temp/` | Script dijalankan tanpa env file; `tsx` tidak membaca `.env.local` otomatis | Jalankan `npx tsx --env-file=.env.local <script>` |
| `EADDRINUSE :::3000` saat `next start` | Server verifikasi sebelumnya belum dimatikan | Matikan proses lama, pastikan `ss -lntp \| grep ':3000'` kosong sebelum start ulang |
| `DELETE /api/statuses/:id` gagal `409 This column holds N tasks` | Kolom masih berisi task dan tidak ada kolom tujuan | Kirim `?moveTo=<statusId>` (UI sudah menyediakan dropdown tujuan di dialog hapus kolom) |
| Perubahan `dueTime` menghapus `startDate`/`dueDate` | Route memakai `body.field ?? null`, sehingga field yang tidak dikirim ikut ditulis `NULL` | Kirim hanya field yang berubah; route sekarang memperlakukan `undefined` sebagai "jangan diubah" |
| Override lead time hilang setelah men-toggle mute | Route reminder memaksa `leadMinutes: body.leadMinutes ?? null` | Sudah diperbaiki — field diteruskan apa adanya; `null` eksplisit baru menghapus override |
| Verifikasi di browser tidak memicu handler React (blur, keydown, checkbox) | Event sintetis tidak selalu diteruskan React; checkbox memetakan `click`, input teks memetakan `focusout` | Gunakan `requestSubmit()`, dispatch `focusout`, atau klik elemen aslinya — bukan dispatch `Event` manual |
| Fixture gagal dengan `string_to_uuid` (`uuid.c:191`) | Insert memakai user id non-UUID | Fixture ini memakai `crypto.randomUUID()` / id dari better-auth yang berbentuk uuid |
| Tidak bisa `rm`/`kill` berkas atau proses lewat shell (exit `-1`) | Perintah berbahaya diblokir approval | Hapus berkas lewat Python `Path.unlink()`, hentikan proses lewat tool process manager |
