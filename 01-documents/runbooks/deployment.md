# Deployment Runbook

Aplikasi ini adalah Next.js yang di-deploy ke **Cloudflare Workers** (via
OpenNext) dengan database **Neon Postgres**. Deploy berjalan otomatis di CI;
tidak ada langkah manual ke server.

## Alur deploy

Push ke `main` → GitHub Actions (`.github/workflows/deploy.yml`) menjalankan:

1. **verify** — typecheck, `typecheck:worker`, eslint, unit test, `next build`
2. **migrate** — `drizzle-kit migrate` ke database Neon
3. **deploy** — `opennextjs-cloudflare build` + `wrangler deploy` ke Cloudflare

Bila salah satu tahap gagal, tahap berikutnya tidak berjalan. **Baca urutan
step-nya lebih dulu sebelum membaca pesan error** — step pertama yang merah
adalah satu-satunya yang informasinya nyata, sisanya `skipped` dan tidak
mengungkap apa pun. Perhatikan juga bahwa `migrate` berjalan **sebelum**
`deploy`: bila deploy gagal setelah migrasi sukses, skema database sudah
berubah sementara kode aplikasinya belum — keadaan setengah jalan yang perlu
ditangani, bukan sekadar "deploy gagal".

Insiden nyata dan penyebabnya: `03-history/deployment-logs/`.

## Pre-deploy (cek lokal)

```bash
cd 02-application
npm run typecheck && npm run typecheck:worker
npx next lint --dir src
npm test
npm run build
```

Catatan lingkungan: mesin dev hanya punya ~3.6 GB RAM, jadi perintah yang
memori-berat perlu `NODE_OPTIONS="--max-old-space-size=2560"` (mis. `npm run lint`).

## Memantau deploy

```bash
gh run list --limit 5
gh run watch <run-id> --exit-status
gh run view <run-id> --json status,conclusion,jobs
```

Tahap `verify` dan `deploy` harus keduanya `success`.

## Post-deploy

```bash
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" https://todo.nexigo.my.id/login
```

Harus `200`. `/boards` dan `/settings/*` mengembalikan `307` ke `/login` bila
belum ada sesi — itu perilaku benar, bukan kegagalan.

Verifikasi fitur yang butuh sesi tidak bisa dilakukan tanpa kredensial
production; pakai build produksi lokal (`npx next start -p 3000`) dengan
database dev, bukan `npm run dev`, agar yang diuji adalah bundle yang sebenarnya.

## Gate sebelum push

Repo ini publik, jadi gate utamanya adalah scanner rahasia (`scripts/check-secrets.py`).
Jalankan seluruh gate sekaligus:

```bash
cd 02-application && make check    # typecheck + lint + test + secret scan
```

CI menjalankan hal yang sama di job `verify`, tetapi **commit tetap bisa ter-push
sebelum CI selesai**. Aktifkan penjaga lokal sekali per clone:

```bash
git config core.hooksPath .githooks
```

`core.hooksPath` tidak ikut ter-version, jadi langkah ini perlu diulang di setiap
clone baru. Setelah aktif, commit yang memuat bentuk kredensial ditolak di lokal;
`git commit --no-verify` melewatinya bila yakin itu alarm palsu.

## Menjalankan E2E terhadap produksi

`03-history/e2e-live.py` menguji produksi lewat HTTP API. **Skrip ini mengubah
data** (membuat/menghapus user, reset password, mengedit board/task), jadi
arahkan ke akun buangan — bukan data pengguna nyata.

```bash
cd 03-history
E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... \
E2E_USER_EMAIL=...  E2E_USER_PASSWORD=... \
E2E_USER_NEW_PASSWORD=... \
E2E_CONFIRM=yes python3 e2e-live.py
```

Tanpa `E2E_CONFIRM=yes` skrip berhenti, dan itu disengaja: gerbang ini ada agar
skrip tidak jalan karena salah tekan. Kredensial **hanya** dari environment —
repo ini publik, jadi jangan pernah menuliskan nilai apa pun ke dalam berkasnya.

## Rollback

Tidak ada rollback perintah tunggal. Cara tercepat: revert commit yang bermasalah
lalu push, sehingga CI membangun ulang versi sebelumnya.

```bash
git revert <sha> && git push origin main
```

Cloudflare menyimpan versi sebelumnya, tetapi rollback lewat dashboard tidak
disarankan karena migrasi database tidak ikut kembali — periksa dulu apakah
commit tersebut membawa migrasi di `drizzle/`.

## Yang TIDAK dipakai untuk deploy

- `make deploy` — sengaja gagal dengan pesan yang mengarahkan ke CI (lihat
  `02-application/Makefile`); deploy tidak pernah dijalankan dari mesin lokal.
- SSH ke server — tidak relevan; aplikasi tidak dilayani dari VM mana pun.
