# Embed FlowBoard di iframe — keputusan & temuan

**Tanggal:** 2026-10-01
**PR:** #34 (merged `ae9a6bb`), branch `feat/embed-iframe`
**Status:** tayang di produksi, fitur **belum dinyalakan** (default tetap terkunci)

## Permintaan

Dhar ingin FlowBoard bisa dipanggil dari iframe: "iframe bisa memanggil url
https://todo.nexigo.my.id/". Konteksnya: parent adalah halaman lokal di browser
Firefox ("aku akan embed di broser mozilla ... jadi bukan dari web lain").

## Temuan yang membentuk desain

Dua-duanya **diukur di browser**, bukan disimpulkan dari dokumentasi. Ini
penting karena keduanya berlawanan dengan jawaban yang "kelihatannya benar".

### 1. `frame-ancestors *` tidak melayani halaman lokal

Diuji dengan server uji + 5 varian header, parent dari `file://`:

| nilai | dari `file://` | dari `http://` |
|---|---|---|
| `'none'` | diblokir | diblokir |
| `'self'` | diblokir | lolos |
| `*` | **diblokir** | lolos |
| `file:` | lolos | diblokir |
| (tanpa CSP) | lolos | lolos |

Konsekuensi: "izinkan semua orang" **bukan** jawaban untuk embed dari berkas
lokal. Nilai yang dibutuhkan adalah literal `file:` — sempit, tapi itu satu-satunya
yang bekerja, dan lebih baik daripada alternatifnya (mematikan CSP sepenuhnya).

Ini juga alasan permintaan Dhar ("bisa siapa saja") diterjemahkan ke daftar
origin, bukan wildcard: wildcard pun tidak akan menyelesaikan kasusnya.

### 2. Membuka header saja membuat papan bisa dilihat tapi tidak bisa dipakai

Cookie sesi `SameSite=Lax` **ditahan** browser pada request di dalam iframe
pihak ketiga. Diuji dengan nama cookie unik per varian supaya tidak saling
mencemari (percobaan pertama terkontaminasi dan hasilnya menyesatkan):

| cookie | dikirim ulang di iframe |
|---|---|
| `SameSite=Lax` | **tidak** |
| `SameSite=None; Secure` | ya |
| `+ Partitioned` | ya |

Konsekuensi: POST login **berhasil**, request berikutnya tidak terautentikasi,
user memutar balik ke halaman login. Ini persis keluhan "login tidak nyangkut"
yang akan muncul kalau hanya header yang dibuka.

Karena itu, saat allowlist diisi, cookie memakai
`SameSite=None; Secure; Partitioned` (CHIPS).

## Keputusan

1. **Opt-in per origin**, bukan wildcard. `EMBED_ALLOWED_ANCESTORS` berisi
   daftar origin dipisah koma; kosong = tidak bisa di-embed (default lama).
2. **`*`, `https:`, `http:` ditolak dengan build error**, bukan dibersihkan.
   Masing-masing mengembalikan persis serangan yang dicegah default
   (clickjacking: halaman jahat membingkai papan + UI palsu di atas kontrol
   admin).
3. **`file:` diterima sebagai literal** — dengan konsekuensinya dinyatakan
   (berkas HTML apa pun di mesin itu boleh membingkai; jauh lebih sempit dari
   `*`, tapi bukan nol).
4. **`X-Frame-Options` hanya dikirim selama embedding mati.** Ia tidak bisa
   menyatakan daftar origin, dan `DENY` akan mengalahkan `frame-ancestors`.
5. **`SameSite=None` adalah trade-off yang dinyatakan**, bukan disembunyikan:
   proteksi CSRF berbasis Lax hilang. Pertahanan yang tersisa: origin check
   better-auth pada setiap request non-GET (diverifikasi:
   `isTrustedOrigin("https://evil.example.com") === false`), `HttpOnly`, dan
   `Secure`. Hanya aktif kalau allowlist diisi.

## Kesalahan saya sendiri, ditemukan dari uji ini

Versi pertama menolak `file:` di parser, padahal deploy-guide saya sendiri
menyuruh memakainya — **mengikuti dokumentasi akan melempar error**. Ketahuan
saat menguji header dengan nilai `file:`. Diperbaiki di `7a0045f` + tes.

Pelajaran: dokumentasi yang tidak dijalankan sebagai tes adalah klaim, bukan
verifikasi.

## Verifikasi

- **16 tes unit**; membuktikan tesnya bermakna dengan 3 mutasi
  (wildcard dibiarkan / `frameAncestorsValue` kosong / XFO selalu dipasang →
  masing-masing 1–3 tes gagal), lalu dipulihkan ke 16/16.
- Header dikonfirmasi pada **respons HTTP nyata** di kedua mode.
- Atribut cookie dikonfirmasi per mode lewat konteks better-auth.
- **Bukti browser (definitif):** harness perbandingan dari `file://` — server
  dengan `file:` merender halaman login FlowBoard yang nyata; server default
  diblokir dan menampilkan ikon halaman rusak.
- Gate penuh hijau: 119 → **124 tes**, lint + typecheck bersih.
- Produksi setelah deploy: HTTP 200, header tetap `DENY` + `'none'`.

## Batasan yang belum ditutup

- **Belum diuji di Firefox.** Hanya Chrome tersedia di lingkungan ini. Dhar
  memakai Firefox — perlu dicek manual sebelum dipakai.
- Nilai dibaca saat **build** (OpenNext mengubah `headers()` menjadi route
  manifest statis), jadi mengubahnya butuh rebuild, bukan ganti var Worker.

## Cara menyalakan (kalau Dhar memutuskan)

Set variabel repo `EMBED_ALLOWED_ANCESTORS`, lalu rebuild:

```
file:                                   # halaman lokal saja
https://dash.example.com                # satu situs tertentu
file:,https://dash.example.com          # keduanya
```

`*` akan menggagalkan build — itu disengaja.
