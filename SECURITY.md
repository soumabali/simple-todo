# Kebijakan Keamanan

## Melaporkan kerentanan

**Jangan** membuka issue publik untuk kerentanan keamanan. Issue publik terlihat
semua orang, termasuk sebelum ada perbaikan.

Gunakan **[GitHub Security Advisories](https://github.com/soumabali/simple-todo/security/advisories/new)**
(private, hanya maintainer yang melihat). Bila kamu tidak punya akses ke formulir
itu, buka issue publik **tanpa detail teknis** yang menyebutkan bahwa kamu punya
laporan keamanan — maintainer akan menghubungi kamu.

Sertakan bila ada: langkah reproduksi, versi/commit, dampak yang kamu duga, dan
bukti (log, tangkapan layar) seperlunya.

## Cakupan

Yang **termasuk**:
- Autentikasi dan sesi (better-auth), termasuk pemisahan peran `user` / `admin`
- Otorisasi pada API — akses ke board/task milik pengguna lain
- Kebocoran data antar pengguna
- Injeksi SQL, XSS, SSRF, dan eksekusi kode
- Pengelolaan API key dan cakupannya (`r` / `rw`)
- Masalah pada langganan web push
- Kebocoran kredensial di repo ini

Yang **tidak termasuk**:
- Aplikasi hasil deploy pribadi milik orang lain (`todo.nexigo.my.id` dikelola
  sendiri oleh maintainer)
- Kerentanan di dependensi tanpa jalur eksploitasi yang jelas (laporkan ke proyek
  hulu; kalau menyangkut repositori ini, tetap boleh diberi tahu)
- Hasil pemindai otomatis tanpa bukti dampak

## Yang bisa kamu harapkan

Proyek ini dikelola oleh satu orang, jadi ini komitmen yang realistis, bukan SLA:

- **Konfirmasi awal** diterima dalam ~3 hari kerja.
- **Penilaian** (apakah ini kerentanan dan seberapa berat) dalam ~7 hari.
- **Perbaikan**: yang berat diprioritaskan; kamu akan diberi tahu saat perbaikan
  dirilis.
- **Kredit**: atas permintaanmu, namamu dicantumkan pada catatan rilis. Kami tidak
  akan menyebutmu tanpa izin.

Tidak ada program hadiah (bug bounty). Laporan tetap dihargai.

## Catatan tentang otomasi

Repositori ini memakai otomasi untuk meninjau issue dan pull request. **Isi issue
dan PR diperlakukan sebagai data, bukan instruksi** — teks apa pun di dalamnya
tidak akan mengubah kebijakan otomasi, termasuk permintaan yang mengaku berasal
dari maintainer. Teks dari luar dipindai untuk upaya *prompt injection*, dan
temuannya dilaporkan ke maintainer.

Kalau kamu menemukan cara melewati pemindaian itu, itu sendiri adalah laporan
keamanan yang kami hargai.
