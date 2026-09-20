# Deployment Runbook

Aplikasi ini adalah Next.js yang di-deploy ke **Cloudflare Workers** (via
OpenNext) dengan database **Neon Postgres**. Deploy berjalan otomatis di CI;
tidak ada langkah manual ke server.

## Alur deploy

Push ke `main` → GitHub Actions (`.github/workflows/deploy.yml`) menjalankan:

1. **verify** — typecheck, `typecheck:worker`, eslint, unit test, `next build`
2. **migrate** — `drizzle-kit migrate` ke database Neon
3. **deploy** — `opennextjs-cloudflare build` + `wrangler deploy` ke Cloudflare

Bila salah satu tahap gagal, tahap berikutnya tidak berjalan dan versi lama
tetap melayani trafik.

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

- `make deploy` — target di `02-application/Makefile` hanya `echo`; ini sisa
  template dan tidak mendeploy apa pun.
- SSH ke server — tidak relevan; aplikasi tidak dilayani dari VM mana pun.
