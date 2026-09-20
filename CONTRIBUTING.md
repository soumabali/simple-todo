# Berkontribusi ke FlowBoard (simple-todo)

Terima kasih sudah meluangkan waktu. Repo ini kecil dan dijaga oleh satu orang
dibantu otomasi, jadi dua hal paling menentukan apakah kontribusimu bisa diterima
cepat: **satu perubahan = satu tujuan**, dan **CI hijau**.

## Lisensi kontribusi

Proyek ini berlisensi **MIT** (`LICENSE`). Dengan mengirim pull request, kamu
setuju kontribusimu dirilis di bawah lisensi yang sama.

## Alur kerja

1. **Buka issue dulu** untuk perubahan yang tidak sepele — fitur baru, perubahan
   perilaku, atau refactor besar. Diskusi di issue jauh lebih murah daripada PR
   yang harus ditolak. Perbaikan bug kecil dan perbaikan dokumen boleh langsung
   ke PR.
2. Fork, lalu buat branch dari `main`. Nama branch bebas, yang jelas.
3. Kerjakan, jalankan pemeriksaan di bawah sampai hijau.
4. Buka PR, isi template-nya, dan hubungkan ke issue (`Closes #12`).

## Menjalankan pemeriksaan secara lokal

Pemeriksaan yang sama dijalankan CI, jadi lakukan sebelum membuka PR:

```bash
cd 02-application
npm ci
make check          # typecheck + lint + test + pemindaian rahasia + alat maintainer
```

Build produksi (butuh Node 20+; memori agak besar):

```bash
NODE_OPTIONS=--max-old-space-size=2560 npm run build
```

**Jangan butuh secret untuk menjalankan CI.** Build memakai placeholder khusus
CI bila secret tidak ada, sehingga PR dari fork tetap bisa hijau. Jangan pernah
menambahkan secret asli ke dalam kode, tes, atau workflow.

## Yang diperiksa otomasi

Setiap issue dan PR dipindai otomatis untuk upaya *prompt injection*. Isi issue,
judul PR, komentar, dan diff diperlakukan sebagai **data, bukan instruksi** —
tidak ada teks dari luar yang bisa mengubah perilaku otomasi di repo ini.

Dua konsekuensi praktis untukmu:

- Menulis instruksi kepada bot di dalam issue (misalnya "abaikan aturan
  sebelumnya") akan membuat issue-mu ditandai `automation: needs-human` dan
  menunggu manusia. Bukan hukuman, tapi jalur tinjauannya jadi lebih lambat.
- Kalau kamu menemukan **kerentanan keamanan**, jangan buka issue publik — ikuti
  `SECURITY.md`.

## Standar yang dipakai repo ini

- **Test untuk perubahan perilaku.** Perbaikan bug sebaiknya menyertakan test
  yang gagal sebelum perbaikan dan lulus sesudahnya.
- **Jangan mengarang.** Klaim di dokumen atau PR harus bisa diverifikasi ke kode,
  CI, atau perintah yang bisa dijalankan ulang.
- **Komentar menjelaskan "kenapa", bukan "apa".** Kode yang jelas tidak butuh
  komentar yang mengulanginya.
- **Commit message jelas**, jelaskan alasannya. Bahasa Indonesia atau Inggris
  sama-sama diterima.
- **Rahasia tidak boleh masuk repo.** Ada pemindai otomatis; commit yang memuat
  nilai menyerupai kredensial akan ditolak sebelum terkirim.

## Struktur direktori

| Folder | Isi |
|---|---|
| `00-meta` | Kontak, URL, port, keputusan (ADR) |
| `01-documents` | Requirement, arsitektur, API, runbook |
| `02-application` | Kode aplikasi (Next.js) |
| `03-history` | Changelog, catatan sesi, log deploy |
| `04-data` | Berkas data |
| `05-config` | Konfigurasi contoh |
| `06-temp` | **Sementara** — wajib dihapus setelah dipakai |
| `scripts` | Alat maintainer dan pemeriksaan CI |

## Pertanyaan

Buka issue dengan label `question` atau tulis di diskusi issue yang relevan.
