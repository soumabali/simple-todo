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

### PR yang hijau TIDAK berarti jalur deploy sehat

Job `deploy` memakai `if: github.event_name == 'push'`. Pada PR ia **di-skip**,
dan run-nya tetap `success`. Jadi:

- "CI hijau" pada PR adalah pernyataan tentang `verify`, **bukan** tentang rilis.
- Satu-satunya cara menguji jalur deploy adalah push ke `main` — dan begitu
  branch protection menyala, itu berarti merge.

Ini pernah menutupi kegagalan selama ~30 jam: delapan jam kerja dengan beberapa
PR hijau, lalu merge pertama langsung gagal di `deploy` karena
`CLOUDFLARE_API_TOKEN` ditolak (`Invalid access token [code: 9109]`). Tidak ada
satu pun sinyal sebelumnya, karena tidak ada yang menjalankan langkah itu.

**Jangan pernah melaporkan "CI hijau" tanpa menyebut `deploy` di-skip.** Selisih
antara keduanya pernah menahan perbaikan bug produksi tanpa ada yang tahu.

**Cara memeriksa jalur deploy yang sebenarnya:**

```bash
# Deploy sungguhan terakhir — event=push, bukan pull_request
gh run list --workflow=deploy.yml --event=push --limit 5 \
  --json conclusion,headBranch,createdAt \
  --jq '.[] | "\(.conclusion)  \(.headBranch)  \(.createdAt)"'

# Versi yang BENAR-BENAR berjalan di produksi (bukan yang ada di main)
cd 02-application && npx wrangler deployments status --name flowboard-web
```

Bandingkan `Created` pada versi aktif dengan tanggal merge terakhir. Kalau versi
aktif lebih tua, **perbaikan yang sudah di-merge belum tayang** — apa pun status
run-nya.


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

Karena produksi adalah satu-satunya lingkungan dengan Worker + Neon yang
sebenarnya, akun buangan itu dibuat **di database produksi**. Pakai
`scripts/e2e-provision.ts` — jangan buat manual, dan jangan pakai akun asli:

```bash
cd 02-application
export DATABASE_URL_UNPOOLED="$(grep NEON_PRODUCTION_URL ~/.hermes/.env | cut -d= -f2- | tr -d '"' | sed 's/-pooler\././')"

# 1) buat dua akun throwaway (admin + user), password acak, ditulis ke file 0600
npx tsx scripts/e2e-provision.ts /tmp/e2e-creds.json

# 2) jalankan harness — password dibaca dari file, bukan ditulis di baris perintah
cd ../03-history
E2E_ADMIN_EMAIL=e2e-admin@flowboard.test \
E2E_USER_EMAIL=e2e-user@flowboard.test \
E2E_USER_NEW_PASSWORD_SUFFIX=X9z \
E2E_CREDS_FILE=/tmp/e2e-creds.json \
E2E_CONFIRM=yes python3 e2e-live.py

# 3) bersihkan (wajib — jangan tinggalkan akun di produksi)
cd ../02-application
npx tsx scripts/e2e-provision.ts --delete /tmp/e2e-creds.json
```

Password tidak pernah dicetak oleh skrip mana pun. Tanpa `E2E_CONFIRM=yes`
harness berhenti, dan itu disengaja: gerbang ini ada agar skrip tidak jalan
karena salah tekan. Kredensial **hanya** dari environment — repo ini publik,
jadi jangan pernah menuliskan nilai apa pun ke dalam berkas yang ter-track.

`e2e-provision.ts` menolak menyentuh email di luar dua akun fixture-nya, jadi
salah ketik argumen tidak bisa menghapus user nyata. Verifikasi:
`--delete` dengan email asli → keluar dengan pesan penolakan.

### Jebakan yang sudah memakan waktu (jangan diulang)

- **Skema `public` memakai snake_case** (`email_verified`,
  `must_change_password`, `user_id`, `created_at`). Database yang sama juga
  punya skema `neon_auth` (camelCase) — sisa eksperimen Managed Better Auth yang
  **tidak** dipakai aplikasi. Menulis ke tabel yang salah menghasilkan user yang
  tidak bisa login.
- **Hash password wajib dari `@better-auth/utils/password`.** Meniru dengan
  `crypto.scryptSync` terlihat setara tapi **tidak**: better-auth memakai salt
  16 byte sebagai **string hex**, bukan Buffer. Hasilnya `401
  INVALID_EMAIL_OR_PASSWORD` untuk password yang baru saja kamu set.

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
