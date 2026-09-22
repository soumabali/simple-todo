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
- **`deploy` di-SKIP pada PR, dan run-nya tetap `success`.** Job `deploy` hanya
  berjalan pada `push` ke `main`/`develop` (atau `workflow_dispatch`). Pada
  `pull_request` ia **skipped** — dan GitHub melaporkan run-nya **hijau**. Jadi
  "CI hijau di PR" **tidak** berarti rilisnya jalan; itu hanya membuktikan job
  `verify`. Sebelum menyatakan sesuatu "sudah tayang", jalankan
  `gh pr checks <n>` dan **baca kolomnya**: `deploy  skipping` adalah jalur yang
  tidak pernah dieksekusi.
  Inilah yang membuat produksi beku ~30 jam tanpa ada yang tahu (issue #22):
  secret `CLOUDFLARE_API_TOKEN` ditolak `9109`, tapi kegagalannya hanya muncul
  pada push ke `main` — dan semua PR hari itu terlihat hijau.
- **Memperbaiki trigger saja tidak cukup.** Menambahkan `workflow_dispatch` tanpa
  melonggarkan guard `if: github.event_name == 'push'` menghasilkan tombol yang
  **tidak men-deploy apa pun** (run 35620508589: `verify success`, `deploy
  skipped`). Keduanya harus diubah bersama.
- **`9109 Invalid access token` = token Cloudflare dicabut/di-rotate.** Perbarui
  dari `/home/ubuntu/.hermes/.env`; nilainya juga dicatat di
  `credentials/simple-todo Credentials.md`. Butuh **Workers Scripts: Edit**
  **dan Account Settings: Read** — tanpa yang terakhir, `wrangler` gagal saat
  `GET /accounts` walaupun izin Workers benar.
- **Secret Actions tidak bisa dibaca kembali.** Ia *write-only*; kalau ragu,
  `gh secret list` hanya menunjukkan tanggal, bukan nilainya. Jangan buang waktu
  mencoba membaca secret lama untuk membandingkan — pasang ulang saja.
- **Jangan ukur produksi dari server Tencent ini.** Host `*.nexigo.my.id`
  gagal 20-60% dari sana, **tanpa header `cf-ray`** — artinya permintaan tidak
  pernah sampai ke edge Cloudflare. `router.nexigo.my.id` yang selama ini
  dianggap "sehat" pun ikut gagal, sementara host CF di luar zone kita bersih dan
  `ping` 0% loss. Ini pernah terbaca sebagai "500 intermiten" di produksi
  (issue #19) padahal Worker mencatat **0 error** dan jaringan lain 12/12 @ ~14ms.
  **Pembeda yang benar: ada/tidaknya `cf-ray` pada respons.** Tidak ada `cf-ray`
  = masalah jalur penguji, bukan aplikasi. Untuk angka error yang bisa dipercaya,
  pakai Workers analytics, bukan pengukuran dari mesin ini.

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
