# 2026-09-22 — #5 rollback, #6 advisory, dan identitas visual

Lanjutan dari sesi `2026-09-22-deploy-mati-dan-koreksi-19.md`. Sesi itu menutup
#22; sesi ini mengerjakan tiga hal yang tidak butuh token `Administration`.

## Ringkas

| | |
|---|---|
| Issue dikerjakan | #5 (rollback), #6 (advisory), + favicon/logo (permintaan Dhar) |
| PR dibuka | #26 (brand + rollback), #27 (wrangler) |
| Bug ketemu saat menguji skrip baru | 4 |
| Advisory | 11 → 8 (high 4 → 1) |

## 1. #5 — jalan kembali untuk deploy

Sebelumnya tidak ada cara kembali selain men-deploy ulang dari git. Itu tidak
cukup: build ulang belum tentu identik, dan kalau bug-nya di `main` maka
men-deploy ulang akan mengembalikannya.

`scripts/rollback-deploy.py` memakai **versi tersimpan Cloudflare**, bukan git.

### Empat bug yang ketemu saat mengujinya

Skrip ini baru berguna kalau benar-benar dipakai, jadi aku mengujinya dengan
rollback sungguhan (produksi diturunkan ke build 20 Sep, lalu dikembalikan).

1. **Bentuk respons API salah ditebak.** `/deployments` mengembalikan
   `{"result": {"deployments": [...]}}` — objek berisi kunci, bukan list.
   `/versions` mengembalikan `{"result": {"items": [...]}}`. Menebaknya sebagai
   list membuat `d.get` dipanggil pada `str`.
2. **`wrangler rollback` menerima id secara POSISIONAL**, bukan lewat
   `--version-id`. Yang salah memberi error menyesatkan: "version could not be
   found" alih-alih "flag tidak dikenal" — jenis error yang mengarahkan ke
   tempat yang salah.
3. **`?force=true` wajib.** Cloudflare menolak rollback kalau ada secret yang
   berubah sejak versi itu (di sini `DATABASE_URL`), code 10220. Pesan itu
   berguna dan tetap ditampilkan; `force` dipakai karena rollback memang
   dimaksudkan memakai environment saat ini.
4. **Id 8 karakter ditolak.** Id di UI Cloudflare ditampilkan 8 karakter, tapi
   pencocokan hanya menerima id penuh. Diganti jadi pencocokan awalan dengan
   ambang minimum 8 karakter (supaya salah ketik pendek tidak ambigu).

Satu kelemahan desain yang **tidak** kuperbaiki, karena lebih jujur dibiarkan
terlihat: `previous` menunjuk ke deployment terakhir yang berbeda, dan satu
deploy menghasilkan 3 versi berurutan (secret, aset, worker) — jadi `previous`
bisa berarti langkah antara, bukan rilis stabil. Untuk rollback insiden,
pakai id eksplisit.

### Bukti

```
rollback d3387b9e  -> aktif: d3387b9e  (produksi 20 Sep)
rollback 8a00401b  -> aktif: 8a00401b  (kembali ke build fix #22)
produksi           -> /login 200 + cf-ray, 3/3
```

## 2. #6 — advisory

Satu-satunya upgrade tanpa lompatan mayor: `wrangler` 4.130.0 → 4.136.1,
menutup `wrangler`, `miniflare`, `sharp`.

```
11 advisory (7 moderate, 4 high)  ->  8 advisory (7 moderate, 1 high)
```

Sisa `high` = postcss, sudah ditangani PR #23. Sisanya (`drizzle-kit`, `next`,
`vitest`) hanya bisa ditutup dengan semver-major — sengaja tidak disentuh.

Catatan: `npm audit --omit=dev` menunjukkan angka yang **sama**, artinya
semuanya build tooling dan tidak ada yang terkirim ke pengguna.

## 3. Identitas visual

Ikon lama: satu kotak ungu rata + garis monoline. Header aplikasi tidak punya
logo sama sekali, hanya teks.

Yang ikut diperbaiki selain gambarnya:

- **Sumber tunggal.** Dulu tiap ukuran file terpisah, dan `src/app/favicon.ico`
  (29.331 B) **berbeda** dari `public/favicon.ico` (293 B) — dua favicon
  berbeda untuk aplikasi yang sama. Sekarang semua dirender dari
  `public/icon.svg` oleh `scripts/build-icons.mjs`, dan `make icons:check`
  **gagal** kalau ada yang menyimpang.
- **Aset hilang ditambahkan:** `apple-touch-icon.png` (180px), `icon-48.png`.
  `favicon.ico` kini 4 ukuran (16/32/48/256).
- **Metadata ikon** dipindah dari tag `<link>` manual ke `metadata.icons`,
  supaya Next yang menyusun urutan dan tidak ada tag ganda.

Ikon header inline SVG, bukan `<img>`: tanpa permintaan tambahan, dan
bentuknya dijamin sama dengan sumber favicon.

## Catatan proses

**CI tidak jalan untuk push ke branch fitur.** `.github/workflows/deploy.yml`
hanya ter-trigger oleh `push` ke `main`/`develop` atau `pull_request`. Push ke
`feat/*` tidak memicu apa pun — jadi "tidak ada run" setelah push itu normal,
bukan tanda CI rusak.

Konvensi repo (`projects/AGENTS.md`) minta catatan sesi + changelog. Keduanya
ditulis di sesi ini.

## Verifikasi

- `rollback-deploy.py self-test` lulus · rollback sungguhan dua arah terbukti
- tiap PNG diperiksa dari byte-nya (signature + dimensi); isi `.ico` per-entri
- `icons:check` diuji tiga arah: sinkron lulus / dirusak gagal / pulih lulus
- `tsc --noEmit` bersih · `vitest run` **93/93** · `next build` sukses
- produksi: `/login` `200` + `cf-ray`
