# 2026-09-20 — Reminder per task, jam jatuh tempo, dan dokumen yang hilang

Melanjutkan dari audit "masih ada task/fitur yang belum selesai?". Semua item di
`e2e-report.md` sudah ✅, jadi yang dikerjakan di sesi ini adalah hal-hal yang
**tidak pernah masuk daftar itu**.

## Yang dikerjakan

### 1. Kontrol reminder per task (backend lama, UI tidak ada)

`tasks.remind_on_start`, `tasks.remind_lead_minutes`, dan `tasks.reminders_muted`
sudah berfungsi sejak lama — `src/lib/reminders.ts` benar-benar membacanya:

```
reminders.ts:103   const lead = task.remindLeadMinutes ?? settings.leadMinutesStart;
reminders.ts:95    if (task.completedAt || task.remindersMuted || ...) return [];
```

Tapi grep di seluruh `.tsx` menemukan **nol pemanggil** `PATCH /api/tasks/:id/reminders`.
Data bahkan sudah dikirim ke browser (`boards/[id]/page.tsx`), hanya tidak
pernah dirender. Akibatnya user tidak bisa mematikan reminder untuk satu task
yang mengganggu, atau memberi lead berbeda untuk task penting.

Ditambahkan seksi **Reminders** di panel task detail: *Mute reminders for this
task*, *Remind me when the start date arrives*, dan *Lead time override
(minutes)* + tombol **Use default**.

### 2. Jam jatuh tempo (`dueTime`)

`PATCH /api/tasks/:id/schedule` menerima `dueTime`, dan `reminders.ts:111`
memakainya (`const dueTime = task.dueTime ?? defaultTime`), tapi input
`type="time"` hanya ada di halaman setelan. Jadi `dueTime` selalu null dan
setiap reminder jatuh pada jam default 08:00 — deadline "besok 14:00" tidak
pernah dihormati. Ditambahkan input jam di panel task detail, nonaktif sampai
ada due date, dengan tombol Clear.

### 3. Notifikasi: tandai satu per satu + deep link

Backend sudah menerima `{ids}` (`inArray` sudah ditulis), UI hanya punya "Mark
all as read". Ditambah tombol **Mark read** per item, dan judul task kini
tautan ke `/boards/:id?task=:taskId` (route `GET /api/notifications` ikut
mengembalikan `boardId`).

## Dua bug nyata yang ditemukan saat mengerjakan ini

Keduanya di route, bukan di UI, dan keduanya merusak data tanpa error:

1. **`PATCH /api/tasks/:id/reminders` membuang override lead time.** Route
   memaksa `leadMinutes: body.leadMinutes ?? null`, jadi menyalakan *Mute* saja
   (tanpa menyertakan `leadMinutes`) menulis `NULL` dan menghapus override.
   Ironisnya ini baru terasa setelah UI-nya ada. Kini field diteruskan apa
   adanya: `undefined` = jangan diubah, `null` eksplisit = hapus.
2. **`PATCH /api/tasks/:id/schedule` menghapus tanggal pada update sebagian.**
   `body.startDate ?? null` membuat request yang hanya membawa `dueTime`
   menulis `NULL` ke `start_date` dan `due_date`. Kini `undefined` tidak
   mengubah apa pun.

Plus validasi `leadMinutes`: nilai negatif menjadwalkan reminder *setelah*
deadline; sekarang ditolak `400`.

## Verifikasi

Dijalankan terhadap **build produksi lokal** (`next build` + `next start`),
bukan `npm run dev`, karena better-auth menolak origin non-3000.

- **UI**: input jam muncul dan tersimpan (`due_time = 15:30:00` dibaca ulang
  dari database).
- **Mute + lead**: menyalakan Mute **tidak lagi** menghapus lead override —
  ini yang dulu rusak (`mute=true, lead=90` tetap utuh; sebelumnya jadi `null`).
- **Rantai penuh**: mengubah lead lewat UI benar-benar menggeser jadwal di
  `notification_queue` — dibuktikan dengan menghitung ulang reminder sebelum
  dan sesudah.
- **Konsistensi**: untuk task tanpa tanggal, ketiga kontrol dinonaktifkan
  seragam (sebelumnya lead override tetap aktif sendirian).
- **Notifikasi**: "Mark read" mengubah satu baris saja (id 28 → read, counter
  2 → 1, item lain tak tersentuh); klik judul membuka drawer task yang benar
  di papan yang benar.
- **Tes**: `reminders.test.ts` +4 tes untuk jalur override (sebelumnya nol test
  untuk ini). Total **56/56 hijau**, typecheck + lint bersih.

Satu catatan proses: tes pertama yang saya tulis untuk jalur override cacat —
ia membandingkan nilai dengan dirinya sendiri sehingga lolos apa pun. Saya
perbaiki jadi dua pemanggilan terpisah yang benar-benar menguji klaimnya.

## Dokumen: dari stub kosong ke peta yang bisa ditelusuri

- `requirements.md` (9 baris) dan `architecture.md` (16 baris) masih kerangka
  kosong sejak commit awal `1e2388b`. Keduanya kini memetakan sistem yang
  benar-benar ada; setiap klaim punya rujukan berkas, dan klaim-klaim itu
  **diverifikasi ulang** (rate limit 5/20 per 15 menit, `disableSignUp: true`,
  validasi tanggal, `uniqueIndex uq_queue_task_kind`, quiet hours 22:00–07:00)
  — bukan ditulis dari ingatan.
- **PRD tidak pernah ada.** README menyebut "PRD v1.2
  (`01-documents/PRD-todo-gantt.md`)" dan ~35 baris komentar kode merujuk `PRD §6.3`,
  `PRD F-4.3`, dst. Berkas itu tidak ada di filesystem **maupun di riwayat git**.
  Alih-alih membiarkan rujukan menggantung atau mengarang PRD lalu menamainya
  "v1.2", `requirements.md` menyatakan asal-usulnya secara terbuka:
  direkonstruksi dari kode dan tes, nomor requirement dipertahankan agar
  rujukan di kode tetap bisa ditelusuri. README diberi catatan yang sama.
- `runbooks/deployment.md` **menyesatkan**: menyuruh `make deploy`, padahal
  target itu hanya mencetak `Deploy to 43.156.128.55...` — dan aplikasi ini
  tidak berjalan di server itu (deploy sebenarnya ke Cloudflare Workers lewat
  CI). Kini menjelaskan alur nyata: CI → migrate → deploy, cara memeriksa
  rilis, dan rollback.
- `02-application/Makefile`: target `dev/test/lint/deploy` hanya `echo`,
  sehingga selalu "berhasil" tanpa melakukan apa pun. Kini meneruskan ke script
  npm, ditambah `make check`; `make deploy` sengaja gagal dengan pesan yang
  mengarahkan ke CI (diuji: `make check` hijau, `make deploy` exit ≠ 0).
- `runbooks/troubleshooting.md` diisi masalah nyata + penyebab + solusi.

## Lanjutan: `03-history/deployment-logs/` diisi

Direktori itu kosong sejak awal (hanya `.gitkeep`), jadi item terakhir dari
daftar "belum selesai" adalah mengisinya dengan sesuatu yang berguna — bukan
sekadar log deploy rutin yang sudah bisa dilihat di GitHub Actions.

Yang ditemukan saat menggali `gh run list`: **dua deploy produksi pertama
(19 Sep) gagal**, dan penyebabnya hanya tersimpan sebagai pesan commit:

1. `Apply Neon policy` → `HTTP 422 "maximum number of protected branches"`.
   `neon.ts` menandai branch default `protected: true`, sementara plan free
   membatasi jumlah branch yang boleh diproteksi. Diperbaiki di `18270a2`.
2. `Deploy web Worker` → CI memakai Node 20, `wrangler` 4.130 butuh ≥22.
   Diperbaiki di `40f6d26`.

Dibuat `2026-09-19-ci-launch-blockers.md` + `README.md` (konvensi + cara
memeriksa status deploy). Dua pelajaran yang layak diingat:

- **Step pertama yang merah adalah satu-satunya yang informatif.** Kegagalan
  pertama hanya muncul sebagai satu step merah diikuti enam step `skipped`;
  membaca pesan error saja tidak cukup, urutan step-nya yang menuntun.
- **Urutan CI penting: `migrate` berjalan sebelum `deploy`.** Kegagalan kedua
  terjadi *setelah* migrasi sukses — skema database sudah berubah sementara
  kode aplikasinya belum. Itu keadaan setengah jalan, bukan sekadar "deploy
  gagal". Runbook deployment kini menyebut hal ini.

Catatan metode: `gh run view <id> --log` mengembalikan output **kosong** untuk
run 19 Sep di mesin ini; yang bekerja adalah
`gh api .../actions/runs/<id>/jobs`, yang memberi status per step.

## Lanjutan: audit keamanan repo publik

Setelah `deployment-logs` selesai, saya berhenti sebentar dan bertanya apa yang
belum diperiksa. Jawabannya: **visibilitas repo**. Hasilnya `PUBLIC` — dan itu
mengubah arti beberapa hal yang sebelumnya terlihat tidak berbahaya.

**Temuan: kredensial akun uji production ter-commit di repo publik.**
`03-history/e2e-live.py` dan `verify-phase2.py` menyimpan email + password
akun E2E dalam bentuk literal. Karena repo publik, nilai itu **terbit ke
internet**, bukan cuma tersimpan di riwayat git. Saya uji apakah masih hidup:
login ke produksi → `401` untuk kedua akun, jadi **tidak ada kebocoran aktif**.
Tetap diperbaiki karena skripnya dipakai berulang:

- `e2e-live.py` → kredensial dari environment (`E2E_ADMIN_*`, `E2E_USER_*`,
  `E2E_USER_NEW_PASSWORD`), tanpa nilai default.
- Gerbang `E2E_CONFIRM=yes` ditambahkan, karena skrip ini **memutasi data
  produksi** (buat/hapus user, reset password). Sebelumnya satu perintah saja
  sudah cukup untuk menjalankannya. Diuji: tanpa gate → `exit 1`; dengan gate
  tapi env kosong → melaporkan nama variabel yang kurang (bukan nilainya).
- `verify-phase2.py` dihapus — 15 assertion-nya sudah tercakup di `e2e-live.py`
  §2/§3/§6. Satu session note yang menyebut namanya diperbarui.

**Pencegah, bukan cuma bersih-bersih:** `scripts/check-secrets.py` memindai
berkas yang ter-track dan gagal `exit 1` bila menemukan bentuk kredensial.
Terpasang di `make check` dan di job `verify` CI. Satu pelajaran penting di
sini: **versi pertama scanner-nya cacat dan saya baru tahu setelah menguji
dengan berkas tiruan** — ia melewatkan bentuk JSON seperti
`{"password": "<nilai>"}` (tanda kutip sebelum titik dua mematahkan pola) dan
bentuk `ADMIN_PASSWORD = "<nilai>"` (`\b` tidak cocok setelah `_`). Scanner
yang melewatkan bentuk yang justru sudah pernah ter-commit lebih buruk
daripada tidak ada.

**Dua temuan lain saat menyisir:**

- `02-application/cleanup-dev.tmp.ts` — skrip sekali pakai, ter-commit di
  `3115441`, tidak direferensikan apa pun. Dihapus.
- **Tidak ada `.gitignore` di root.** Jadi `06-temp/README.md` yang berbunyi
  "selalu boleh dihapus" tidak ditegakkan apa pun: file scratch di situ ikut
  ter-commit pada `git add -A` pertama. Root `.gitignore` dibuat; diuji dengan
  menanam berkas scratch lalu `git check-ignore`.
- Email pribadi di `deploy-guide.md` + satu session note diganti deskripsi peran.

### Gelombang kedua: kredensial *default* yang terbit

Setelah scanner dan `.gitignore` beres, saya menyisir lagi untuk pertanyaan yang
belum diajukan: **apakah ada kredensial default yang diterbitkan repo ini?**
Jawabannya ya — dua, dan yang satu serius:

- `src/lib/auth.ts`: `process.env.BETTER_AUTH_SECRET ?? <literal>`.
  Ini bukan kemudahan, melainkan kredensial terbit: secret itu **menandatangani
  cookie sesi**, jadi siapa pun yang membaca repo bisa membuat sesi admin yang
  valid untuk deployment mana pun yang lupa menetapkan environment-nya. Kini
  `requireEnv` melempar bila kosong.
  **Yang sengaja TIDAK saya lakukan:** melempar bila panjangnya <32. better-auth
  sendiri hanya *memperingatkan* di bawah 32 (`create-context.mjs:44`), jadi
  secret produksi bisa saja 8–31 karakter dan tetap bekerja — melempar di situ
  akan mengunci semua user dari deployment yang sedang jalan, dan saya tidak
  punya cara memverifikasi nilai produksi dari sini. Keberadaan = wajib,
  panjang = peringatan.
- `src/db/seed.ts`, `05-config/.env.example`, `README.md`: password admin default
  password admin default, terbit di tiga tempat. Seeding pertama tanpa override membuat
  akun admin dengan password yang bisa dibaca siapa saja. `SEED_ADMIN_PASSWORD`
  kini wajib dan dibaca **sebelum** menyentuh database (gagal cepat, bukan
  setengah jalan). Saya cek produksi: `admin@flowboard.local` + default itu →
  `401`, jadi tidak ada kebocoran aktif.
- `seed.ts` juga **mencetak** password ke stdout (`Admin login: … / …`). Output
  `npm run db:seed` mudah tersalin ke issue atau chat; sekarang hanya nama
  akunnya yang dicetak.

**Scanner saya sendiri masih bocor untuk pola ini.** Versi sebelumnya bersih
untuk `process.env.X ?? "literal"` — persis bentuk yang membuat
`BETTER_AUTH_SECRET` terbit. Rule `insecure secret fallback` ditambahkan, lalu
diuji dengan enam probe: dua bentuk bocor tertangkap, satu fallback non-secret
(`process.env.X || "some-fallback-value"`) sengaja **tidak** ditandai supaya
tidak jadi alarm palsu. Sekali lagi: ditemukan dengan menanam probe, bukan
dengan membaca ulang regex.

Efek sampingnya terasa: scanner lalu menandai **prosa changelog saya sendiri**
yang mengutip nilai lama. Itu benar — prosa tidak perlu menyalin literal
kredensial, jadi kutipannya diganti `<literal>`.

### Kegagalan CI yang saya sebabkan sendiri

Commit `36234d5` **membuat CI merah** (`35493001348`): gate `check-secrets`
menolak `03-history/sessions/2026-09-20-reminder-per-task-dan-dokumen.md:189`,
karena prosa session note ini **mengutip** literal password/secret lama. Ironis
dan instruktif: teks yang menjelaskan sebuah kebocoran ikut dianggap kebocoran.

Akarnya bukan regex, tapi **proses**: saya menjalankan scan, lalu menulis lebih
banyak prosa, lalu commit tanpa menjalankan scan lagi. Dua hal yang saya
perbaiki:

1. Semua literal lama di prosa diganti `<literal>` / deskripsi. Menyalin nilai
   kredensial ke dalam dokumen tidak memberi nilai apa pun — pembaca hanya perlu
   tahu *bentuk* polanya.
2. **`.githooks/pre-commit`** menjalankan scanner yang sama dan menolak commit.
   Diuji dengan menanam pelanggaran: commit ditolak (`exit 1`) dan `HEAD` tidak
   bergerak. Ini menutup celah yang sebenarnya: CI memindai, tapi commit sudah
   ter-push sebelum CI selesai.

## Rencana otonomi repo + audit plan

Dhar membuka repo ini untuk issue dan PR publik, dan meminta saya mengelolanya
otonom: notifikasi tiap ada issue baru, review semua yang masuk (termasuk
memastikan tidak ada prompt injection), lalu integrasi → test → deploy sendiri.
Semua catatan dan task harus hidup sebagai issue GitHub.

Rencana + riset pro/kontra ada di `01-documents/maintainer-automation-roadmap.md`.
Ringkas hasilnya:

**Rating kondisi saat ini: 2/10.** Bukan karena aplikasinya buruk — gate test-nya
8/10. Yang rendah adalah lapisan operasional publikasi: belum ada tempat untuk
issue, tidak ada notifikasi, tidak ada pertahanan terhadap konten luar, karena
repo memang belum pernah dibuka.

**Rating plan versi pertama: 6/10 → direvisi ke 9/10.** Yang menahan versi pertama:
saya mengabaikan identitas token (token ini milik `soumabali`, jadi setiap
komentar otonom terbit **atas nama Dhar** — kalau injeksi berhasil, hasilnya
bukan "bot salah", tapi "maintainer menyatakan"); lisensi tidak diperlakukan
sebagai *prasyarat*; fixture injeksi tidak konkret; kill switch salah urutan
(ditaruh di Fase 4 padahal otomasi pertama sudah menyala); tidak ada anggaran;
tidak ada cara menarik komentar. Sisa 1 poin tidak saya berikan ke diri sendiri
karena **belum ada satu pun bagian rencana itu yang teruji di dunia nyata**.

**Yang dibangun di sesi ini (Fase 0, sebagian):**

- `scripts/injection_scan.py` — 10 aturan, 12 fixture (10 jahat + 2 negatif).
  Downgrade: payload yang hanya muncul di dalam backtick/*code fence* diturunkan
  ke `low`, karena mengutip payload bukan mengeluarkan perintah. Terbukti
  bekerja: memindai 19 dokumen repo sendiri hanya menghasilkan `low` (semua di
  dalam code block), dan `<script>` di dalam backtick di `troubleshooting.md`
  ikut tertangkap sebagai `quoted: True`.
- `scripts/notify-issues.py` + cron tiap 15 menit (`03853873fed3`), **tanpa model**:
  jalur deteksi yang tidak bisa dipengaruhi teks yang dilaporkannya.
- Label taksonomi, template issue/PR, `SECURITY.md`, runbook maintainer.

**Temuan yang paling penting:** `npm run build` **gagal tanpa
`BETTER_AUTH_SECRET`** — dipicu `requireEnv` di module scope lewat
`/api/admin/logs`. Karena PR dari fork tidak menerima secret repo, **setiap
kontribusi dari luar akan selalu merah** tanpa placeholder. Ini mengejutkan:
keamanan yang saya tambahkan di sesi sebelumnya hampir mematikan tujuan Dhar.
Diperbaiki dengan placeholder build-only (`secrets.X || placeholder`).

**Kesalahan saya di sesi ini:** saya menulis issue #8 mengklaim `.gitignore`
menutup `00-meta/` dan tiga dokumen jadi tidak ter-track. **Salah.** Root
`.gitignore` tidak pernah memuat aturan itu, dan kelima berkas ter-track
(`git ls-files 00-meta/` menampilkan semuanya). Saya menulis dari ingatan tentang
isi file, bukan dari membacanya — persis yang saya peringatkan ke diri sendiri di
roadmap. Dikoreksi sebagai komentar di issue #8 dan ditutup sebagai *not planned*.
Yang benar-benar ditemukan saat memverifikasi: `00-meta/credentials.md` ter-track
tapi **tidak memuat secret apa pun** (328 byte, hanya penunjuk ke Obsidian Vault
dengan tabel kosong) — aman, dan memang begitu desainnya.

**Lubang yang saya temukan di kode sendiri:** penanda kepemilikan bot
(`<!-- ame-bot -->`) hanya diperiksa dari body, sehingga kontributor bisa
menyalinnya ke issue mereka agar tidak dilaporkan. Kini butuh penanda **dan**
penulis = pemilik repo. Fixture regresinya diuji dengan mengembalikan bug-nya
untuk memastikan ia benar-benar bisa gagal (mutasi → FAIL, pulih → OK).

**Yang menunggu keputusan Dhar:** lisensi (menghalangi penerimaan PR),
branch protection, metadata repo, dan identitas komentar otomasi. Semuanya
terlacak sebagai issue #1–#4.

## Audit: apa yang belum dibuat

Setelah gelombang keamanan selesai, saya mengaudit repo terhadap checklist rilis
open-source (`open-source-project-cleanup/references/open-source-release-prep-checklist.md`)
supaya pertanyaan "apakah masih ada yang kurang" dijawab dengan bukti, bukan
perasaan. Hasilnya, dan ini penting: **repo ini sehat untuk aplikasinya, yang
kurang adalah lapisan publikasinya.**

**Sudah dikerjakan di sesi ini:**

- README tidak menyebut **Public REST API v1** sama sekali di Ringkasan —
  padahal fitur itu ada, sudah dipakai produksi, dan punya dokumen 420 baris
  (`01-documents/api.md`). Fitur yang tidak bisa ditemukan dari README praktis
  tidak ada. Ditambahkan ke daftar fitur + tabel "Dokumentasi".

**Belum ada, dan sengaja TIDAK saya buat sendiri** (lihat alasan di bawah):

| Berkas | Kenapa belum |
|---|---|
| `LICENSE` | **Ini keputusan, bukan kelalaian** — dari 19 repo `soumabali` (termasuk `vexa`, `mochi`, `timebook`, `membership`), **tidak satu pun** punya LICENSE (`license=NONE` di API GitHub). Menambahkannya mengubah status hukum repo secara sepihak. |
| `SECURITY.md` | Tidak ada di repo mana pun Dhar. Butuh keputusan: ke mana laporan kerentanan dikirim (email pribadi? tidak?), dan berapa SLA respons. |
| `CONTRIBUTING.md` | Repo ini **tanpa self sign-up** dan satu pengguna; belum ada kontributor. Menulis panduan kontribusi untuk kontributor yang tidak ada adalah dokumen kosong. |
| `CODE_OF_CONDUCT.md` | Sama — hanya relevan kalau ada komunitas. |
| Template issue/PR | Belum ada `.github/ISSUE_TEMPLATE/`. Berguna hanya kalau repo dibuka untuk kontribusi. |
| Tag + GitHub Release | `package.json` masih `0.1.0` dan belum pernah di-tag. Release pertama harus diputuskan Dhar (versi + apakah repo ini memang untuk dipublikasikan). |

**Terblokir (bukan belum dikerjakan):**

- **Metadata repo kosong**: deskripsi, homepage, dan topics (`desc=null
  topics=[] homepage=null`), padahal repo publik. `gh api -X PATCH` ditolak
  `403 Resource not accessible by personal access token` — token fine-grained
  tidak punya izin Administration. Hanya bisa diisi lewat UI GitHub Settings.

**Diperiksa dan ternyata beres** (supaya tidak perlu diulang):

- `api.md` **akurat**: 10 endpoint didokumentasikan = 10 handler di
  `src/app/api/v1/` (`me` GET, `boards` GET, `todos` GET/POST, `todos/[id]`
  GET/PATCH/DELETE, `todos/expiring` GET, `reminders` GET/POST). Tidak ada drift.
- Semua env var yang dibaca kode ada di `.env.example` / `.env.production.example`.
- Tidak ada `TODO`/`FIXME`/`HACK` di `src` atau `workers`.
- Tidak ada requirement yang berstatus belum diimplementasi; `requirements.md`
  tidak punya bagian "deferred".

**`npm audit` menemukan 11 kerentanan (7 moderate, 4 high) — tapi tidak satu pun
di jalur runtime.** Semuanya lewat tooling build: `wrangler` → `miniflare` →
`sharp` (libheif), `drizzle-kit` → `esbuild`, dan `postcss` (yang masuk lewat
`next`). Yang penting: `next` sendiri **tidak punya advisory** — ia "moderate"
hanya karena membawa `postcss`; dan `wrangler` adalah devDependency yang tidak
pernah ikut ter-bundle ke Worker. `npm audit fix` menawarkan `next@16.3.5`
(breaking major) dan `wrangler@4.135`, jadi **tidak saya jalankan** — memperbaiki
tooling rentan dengan upgrade major sebelum ada release itu tukar risiko tanpa
manfaat. Dicatat untuk ditinjau saat naik versi.

## Kebersihan

Fixture (user, board, task, dua notifikasi) dibuat lewat script `06-temp/*.tmp.ts`
dan **dihapus seluruhnya** setelah verifikasi — `06-temp/` kosong, port 3000
bebas, working tree bersih sebelum commit.

## Berikutnya (belum dikerjakan)

- Tidak ada item terbuka dari daftar ini. Audit fitur/UI (`e2e-report.md`) dan
  hygiene dokumen sudah tuntas.
- **Catatan untuk sesi berikutnya:** `admin@flowboard.local` masih ada di
  produksi dengan password yang tidak diketahui (default publik itu sudah
  ditolak `401`). Kalau perlu masuk sebagai admin, gunakan alur reset password
  admin alih-alih menebak.
- Rotasi `BETTER_AUTH_SECRET` produksi bersifat opsional: nilainya **tidak
  pernah** terbit (yang terbit adalah *fallback* di kode, bukan secret yang
  dipakai produksi). Rotasi akan mematikan semua sesi aktif.
