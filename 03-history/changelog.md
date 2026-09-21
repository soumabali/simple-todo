# Changelog

## [Unreleased]

### Added (identitas visual FlowBoard)

Ikon lama: satu kotak ungu rata dengan garis monoline, dan header aplikasi tidak
punya logo sama sekali — hanya teks. Ikon baru memakai gradasi, kilau, bayangan
dalam, tiga kolom kanban bertingkat, dan tanda "selesai" hijau.

Dua cacat teknis yang ikut diperbaiki:

- **Aset tidak konsisten dengan sumbernya.** `src/app/favicon.ico` (29.331 B)
  berbeda isinya dari `public/favicon.ico` (293 B) — dua favicon berbeda untuk
  aplikasi yang sama. Sekarang semuanya dirender dari `public/icon.svg` oleh
  `scripts/build-icons.mjs`.
- **Aset penting hilang.** Tidak ada `apple-touch-icon.png` (iOS) maupun ukuran
  16/48. `favicon.ico` kini memuat 4 ukuran (16/32/48/256) sebagai PNG.

`make icons:check` **gagal** kalau ada aset yang tidak lagi cocok dengan
`public/icon.svg`, jadi penyimpangan seperti itu tidak bisa diam-diam kembali.

### Added (jalan kembali untuk deploy — #5)

`scripts/rollback-deploy.py`. Sebelumnya tidak ada cara kembali selain
men-deploy ulang dari git — dan itu tidak cukup, karena build ulang belum tentu
identik, dan kalau bug-nya ada di `main` maka men-deploy ulang akan
mengembalikannya.

Empat hal yang ketemu saat mengujinya dengan rollback sungguhan:

- `/deployments` mengembalikan `{"result": {"deployments": [...]}}` dan
  `/versions` mengembalikan `{"result": {"items": [...]}}` — bukan list
  langsung seperti dugaan awal.
- `wrangler rollback` menerima id secara **posisional**, bukan `--version-id`.
  Flag yang salah memberi error menyesatkan: "version could not be found",
  bukan "flag tidak dikenal".
- **`?force=true` wajib** kalau ada secret yang berubah sejak versi itu
  (code 10220). Rollback memang dimaksudkan memakai environment saat ini.
- Id 8 karakter (format yang ditampilkan UI Cloudflare) ditolak; pencocokan
  sekarang menerima awalan dengan ambang minimum 8 karakter.

### Fixed (advisory npm — #6)

`wrangler` 4.130.0 → 4.136.1, menutup `wrangler`, `miniflare`, `sharp`.
**11 advisory (4 high) → 8 (1 high).** Sisa `high` = postcss, ada di PR #23.
Sisanya (`drizzle-kit`, `next`, `vitest`) hanya bisa ditutup dengan
semver-major dan sengaja tidak disentuh. Semuanya build tooling:
`npm audit --omit=dev` menunjukkan angka yang sama.

### Added (Lisensi MIT)

- **`LICENSE` (MIT)** dan `license: "MIT"` pada `02-application/package.json`. Repo ini publik dan menerima PR, tetapi tidak punya lisensi — sehingga hak cipta default berlaku (*all rights reserved*) dan kontribusi dari luar masuk tanpa izin yang jelas (*inbound=outbound*). Keputusan dicatat sebagai **ADR-001**, termasuk alasan menolak AGPL-3.0: ini aplikasi self-hosted, bukan layanan jaringan, jadi kewajiban "perubahan harus tetap terbuka" tidak memberi manfaat yang sepadan.
- **`CONTRIBUTING.md`** — alur kerja, pemeriksaan lokal yang sama dengan CI, dan dua hal yang paling sering membuat PR tertahan di repo ini: satu perubahan satu tujuan, dan tidak butuh secret untuk membuat CI hijau. Sebelumnya berkas ini tertahan oleh lisensi, dan kini bisa ditulis.
- **`scripts/check-repo-files.py`** — penjaga invarian tingkat repo: `LICENSE` ada dan teksnya MIT, `package.json` menyebut lisensi yang sama, `CONTRIBUTING.md`/`SECURITY.md` ada dan ditautkan dari README. Alasannya konkret: repo yang mengaku MIT di `package.json` sementara tidak punya berkas `LICENSE` tampak sudah beres padahal belum — dan itu justru lebih buruk daripada tidak menyebut apa pun. Fixture-nya diuji dengan 5 mutasi; masing-masing membuat pemeriksaan gagal.

### Added (Triage otonom — Fase 1)

Tahap kedua menuju pengelolaan repo yang mandiri: issue dari luar kini
diklasifikasi, dilabeli, dan yang mencurigakan dieskalasi ke maintainer. Bukti
dan angka lengkapnya ada di `01-documents/maintainer-automation-roadmap.md` §6b.

- **`scripts/triage-issues.py`** — cron tiap 15 menit (menit :07,:22,:37,:52), berselang-seling dengan notifier agar tidak bertabrakan. Mengklasifikasi judul + isi tiap issue terbuka terhadap pola tipe dan prioritas, memberi label, dan mendeteksi duplikat lewat kemiripan judul.
- **Triage hanya menulis label.** Tidak berkomentar, tidak menutup, tidak meng-*merge*. Batas ini bukan janji di dokumentasi melainkan **diuji**: satu fixture menjalankan seluruh pipeline di atas 10 issue sintetis dan gagal bila ada operasi tulis selain penambahan label, atau label di luar namespace `type:`/`priority:`/`automation:`.
- **Eskalasi ke Telegram, bukan ke thread publik.** Sampai identitas bot dipisahkan dari akun maintainer (issue #4), komentar otomatis terbit atas nama Dhar — kalimat yang lolos dari injeksi akan terbaca sebagai pernyataan maintainer, bukan kesalahan bot.
- **Issue mencurigakan tidak diberi label tipe.** Otomasi tidak menebak tipe issue yang isinya sedang ia curigai; ia menandainya `automation: needs-human` dan berhenti di situ.
- **Ledger keputusan** di `~/.hermes/cron/simple-todo-triage-ledger.jsonl`: tiap keputusan tercatat, termasuk `dry_run` dan alasan klasifikasi.
- **Eskalasi dilaporkan sekali.** State di `simple-todo-triage-state.json` mencegah alert yang sama terulang tiap 15 menit; isi issue yang berubah memicu alert baru.
- **`scripts/gh_util.py`** — helper bersama notifier + triager (pemindaian injeksi, uji kepemilikan, escaping). Dua salinan aturan keamanan cepat atau lambat akan berbeda, dan perbedaannya adalah lubang.

### Fixed (Triage otonom — Fase 1)

- **Label yang berhasil dipasang dilaporkan gagal.** `gh issue edit` membalas dengan URL, bukan JSON, sedangkan helper `gh()` memaksa `json.loads` untuk semua subperintah — sehingga setiap penulisan label yang sukses melempar `JSONDecodeError` dan tercatat sebagai kegagalan. Hanya ketahuan dengan menjalankannya terhadap GitHub. Fixture versi pertama tidak bisa menangkapnya karena mengganti seluruh fungsi `gh`, sehingga kode parsing di dalamnya tak pernah dieksekusi; kini ada fixture yang menjalankan biner `gh` tiruan lewat subprocess. Diuji dengan mutasi: menghapus cabang `expect_json` membuat suite merah.
- **Ledger mencatat label yang tidak pernah terpasang.** Jejak audit yang berbohong lebih buruk daripada tidak ada jejak, karena ia dipercaya. Kini `labels_attempted` dan `labels_added` dicatat terpisah, beserta `error`-nya.
- **Satu label yang hilang menghentikan seluruh triage.** `automation: needs-human` belum ada di repo, dan kegagalan pertama membatalkan sisa antrean. Kini kegagalan per-issue dihitung di `failed=`, dilaporkan, dan antrean berlanjut.
- **`NameError` pada setiap run terjadwal.** Baris ringkasan memakai `len(escalations)` — variabel lokal `run()` yang tidak ada di scope pemanggilnya — sehingga cron gagal setiap kali sementara self-test tetap hijau. Baris itu diekstrak jadi `summary_line()` dan kini diuji; mutasi yang mengembalikan bug-nya membuat suite merah.
- **Self-test menulis ke ledger asli**, mengisi jejak audit dengan issue palsu #108–#110. Semua berkas state kini dialihkan ke direktori sementara selama pengujian.

### Added (Fondasi pengelolaan otonom repo)

Repo ini bersiap dibuka untuk issue dan pull request publik. Tahap ini membangun
lapisan yang membuat itu aman — rencana lengkap dan auditnya ada di
`01-documents/maintainer-automation-roadmap.md`, cara menghentikan otomasi ada di
`01-documents/runbooks/maintainer-automation.md`.

- **Pemindai prompt injection** (`scripts/injection_scan.py`) dengan 12 fixture payload. Teks dari luar (judul, isi, komentar) diklasifikasi sebelum dibaca agent. Payload disusun mengikuti pola yang **nyata berhasil** di "*Comment and Control*" (CSA, Apr 2026) dan Black Hat USA 2026 — di mana issue body dan PR title dipakai membuat agent GitHub membocorkan secret CI. Dua dari dua belas fixture adalah **uji negatif**: laporan bug wajar dan payload yang dikutip di dalam backtick tidak boleh ditandai. Gate yang menandai segalanya akan dimatikan orang, lalu tidak menjaga apa pun.
- **Notifier issue & PR** (`scripts/notify-issues.py`) sebagai cron Hermes tiap 15 menit. Berjalan **tanpa model** — satu-satunya jalur yang tidak bisa dipengaruhi oleh teks yang dilaporkannya. Tidak membaca secret (memakai `gh` sendiri), tidak pernah menulis ke GitHub, dan mencetak laporan hanya bila ada hal baru. Teks yang ditampilkan dinetralkan: komentar HTML dibuang, markdown di-escape, `@mention` dipatahkan agar judul tidak bisa menandai orang.
- **Label taksonomi** (status, tipe, prioritas) dan **template issue/PR**. Semua template memuat pemberitahuan bahwa isinya adalah data, bukan instruksi — dan frasa itu dikenali pemindai sebagai boilerplate kita, sehingga template tidak menandai dirinya sendiri.
- **`SECURITY.md`** dengan jalur pelaporan privat (GitHub Security Advisories, tanpa email pribadi).
- **Kill switch terdokumentasi dan teruji**: `hermes cron pause 03853873fed3` untuk notifikasi, `gh workflow disable "Deploy"` untuk deploy.
- **Uji kontrak API pemindai** (`--contract-test`): corpus fixture menguji *mutu deteksi* — ia memanggil `scan()` dengan satu argumen lalu membaca satu kunci. Itu tidak melindungi pemanggilnya: penggantian nama kunci `severity` atau perubahan tanda tangan akan tetap membuat semua fixture hijau, sementara alat maintainer yang membacanya berhenti melaporkan injeksi tanpa ada yang menyadari. Kontrak ini menahan bentuk API-nya. Ditemukan karena fixture 12 sendiri memintanya.

### Fixed (Fondasi pengelolaan otonom repo)

- **Setiap PR dari fork akan selalu merah tanpa ini.** `npm run build` memuat `src/lib/auth.ts`, yang memanggil `requireEnv("BETTER_AUTH_SECRET")` di *module scope*, sehingga build tanpa secret gagal di `Failed to collect page data for /api/admin/logs` (diverifikasi dengan `BETTER_AUTH_SECRET=''`). Karena PR dari fork **tidak menerima secret repo**, setiap kontribusi dari luar akan gagal CI karena alasan yang tidak ada hubungannya dengan kodenya. Kini ada placeholder build-only, dan secret asli tetap menang bila ada (`secrets.X || placeholder`). Placeholder itu bukan kredensial.
- **`deploy.yml` tidak punya blok `permissions:`** — `GITHUB_TOKEN` mendapat scope default. Kini `contents: read` di tingkat workflow; setiap job menaikkan hanya yang benar-benar dibutuhkan.
- **Actions dipasang pada tag mengambang** (`@v4`). Tag bisa digerakkan ke kode lain setelah review — persis mekanisme yang membuat `tj-actions/changed-files` dikompromikan (Maret 2025). Kini dipin ke SHA commit, diverifikasi lewat `git ls-remote`, bukan disalin dari tutorial.
- **Langkah *Smoke test* deploy hanya `echo`** — selalu sukses, termasuk untuk Worker yang mengembalikan 500, dan rollback jadi tidak punya pemicu. Kini `GET /login` dan gagal bila statusnya bukan 200.
- **Aturan `concurrency`**: satu run per ref; run yang tersalip dibatalkan alih-alih dibiarkan selesai dan berlomba dengan yang lebih baru.
- **Lubang pada penanda kepemilikan bot**: kepemilikan ditentukan hanya dari penanda di body, sehingga kontributor bisa menyalin penanda itu ke issue mereka agar tidak dilaporkan. Kini memerlukan penanda **dan** penulisnya pemilik repo — bagian kedua tidak bisa dipalsukan. Ada fixture regresinya, dan fixture itu diuji dengan mengembalikan bug-nya untuk memastikan ia benar-benar bisa gagal.
- **`gh` tidak selalu ada di PATH saat dijalankan dari cron** (`PATH=/usr/bin:/bin`, sedangkan `gh` di `/usr/local/bin`) → traceback. Kini diresolusi eksplisit, dan kegagalan dilaporkan satu baris, bukan traceback.

### Added (Kontrol reminder per task + jam jatuh tempo)

- **Setelan reminder per task di panel task detail**: task kini punya tiga override yang selama ini hanya ada di API — *Mute reminders for this task*, *Remind me when the start date arrives*, dan *Lead time override (minutes)* (`PATCH /api/tasks/:id/reminders`). Sebelumnya tidak ada satu pun pemanggil dari UI, sehingga semua task terkunci pada setelan board: reminder task yang tidak penting tidak bisa dimatikan, dan lead time khusus task penting tidak bisa diatur. Kontrol dinonaktifkan bila task belum punya tanggal, dan tombol **Use default** mengembalikan override ke nilai board.
- **Jam jatuh tempo (due time) di panel task detail**: input `type="time"` menyimpan `dueTime` lewat `PATCH /api/tasks/:id/schedule`. Sebelumnya field ini hanya bisa diisi lewat API, jadi reminder `due_soon` selalu jatuh pada jam default board (08:00) dan deadline "besok 14:00" tidak pernah dihormati. Nonaktif sampai ada due date, dengan tombol Clear.
- **Tandai satu notifikasi sebagai dibaca** di halaman notifikasi (`POST /api/notifications { ids }` — sebelumnya hanya "Mark all as read"), lengkap dengan tombol per item yang disabled saat proses.
- **Judul task di inbox notifikasi kini tautan ke task-nya** (`/boards/:id?task=:taskId`). `GET /api/notifications` ikut mengembalikan `boardId`; task yang sudah dihapus tidak ditautkan.

### Fixed

- **Override lead time terhapus setiap kali hanya toggle lain yang diubah**: `PATCH /api/tasks/:id/reminders` memaksa `leadMinutes: body.leadMinutes ?? null`, jadi menyalakan *Mute* atau *Remind on start* tanpa menyertakan `leadMinutes` selalu menulis `NULL` dan membuang override. Kini field diteruskan apa adanya (`undefined` = jangan diubah, `null` eksplisit = hapus override).
- **`PATCH /api/tasks/:id/schedule` menghapus tanggal pada update sebagian**: `body.startDate ?? null` membuat request yang hanya membawa `dueTime` (atau hanya `dueDate`) menulis `NULL` ke field yang tidak dikirim. Kini `undefined` tidak mengubah apa pun.
- **`leadMinutes` negatif diterima**: nilai seperti `-90` menjadwalkan reminder *setelah* deadline. Kini ditolak `400` bila bukan bilangan bulat non-negatif.
- **Hapus kolom yang berisi task selalu gagal dari UI**: menu kolom memanggil `DELETE /api/statuses/:id` tanpa `?moveTo=`, sehingga API menolak dengan `409 This column holds N tasks` dan tidak ada cara menempuh jalan keluar — kolom berisi task praktis tidak bisa dihapus. Dialog hapus kini menampilkan dropdown kolom tujuan, tombol konfirmasi tetap disabled sampai tujuan dipilih, task dipindahkan (tidak pernah dihapus bersama kolom), dan bila board hanya punya satu kolom muncul pesan agar menambah kolom dulu.

### Tests

- **`reminders.test.ts` +4**: override lead time per task diutamakan atas setelan board, `0` diperlakukan sebagai override (bukan "belum diatur"), override berlaku juga untuk `start_soon`, dan tetap utuh ketika task di-mute. Sebelumnya tidak ada satu pun test untuk jalur override padahal itu inti setelan per task. Total **56 test**.

### Security

- **Kredensial akun uji production tertanam di berkas repo publik.** `03-history/e2e-live.py` dan `verify-phase2.py` menyimpan email + **password** akun E2E production, dan repo `soumabali/simple-todo` bersifat **public** — jadi nilainya ikut terbit ke internet, bukan sekadar ada di riwayat git. Akun terkait sudah tidak ada lagi di produksi (login `401`), sehingga tidak ada kebocoran yang masih hidup; tetapi pola ini berbahaya karena skrip yang sama dipakai berulang. `e2e-live.py` kini membaca kredensial dari environment (`E2E_ADMIN_*`, `E2E_USER_*`, `E2E_USER_NEW_PASSWORD`) tanpa nilai default. `verify-phase2.py` dihapus — 15 assertion-nya sudah tercakup di `e2e-live.py` §2/§3/§6.
- **Skrip E2E sekarang menolak berjalan tanpa konfirmasi.** Skrip ini **mengubah data database tujuan** (membuat dan menghapus user, reset password, mengubah board/task). Sebelumnya tidak ada apa pun yang mencegahnya dijalankan dengan satu perintah. Kini wajib `E2E_CONFIRM=yes`; tanpa itu skrip berhenti dengan `exit 1`, dan variabel environment yang kurang dilaporkan namanya (bukan nilainya). Peringatan bahwa skrip memutasi data ditulis di docstring.
- **Alamat email pribadi dihapus dari repo publik** (`03-history/deploy-guide.md` dan satu session note), diganti deskripsi peran.
- **Scanner rahasia otomatis** (`scripts/check-secrets.py`) mencegah kelas kesalahan ini terulang: memindai **berkas yang ter-track** untuk bentuk kunci Neon/GitHub/OpenAI, blok private key, JWK VAPID privat, password literal, dan URL Postgres ber-kredensial — lalu gagal dengan `exit 1`. Dijalankan otomatis oleh `make check` dan sebagai step tersendiri di job `verify` CI, jadi satu commit berisi rahasia tidak akan lolos ke `main`. Placeholder (`${VAR}`, `<...>`, `***`, `changeme`), host lokal (`@localhost`, `@db`) dan baris ber-`# allow-secret` diabaikan supaya tidak jadi alarm palsu. Salah satu tesnya adalah menanam berkas tiruan di `06-temp/` untuk membuktikan scanner benar-benar menangkap — versi pertamanya diam-diam melewatkan `{"password": "..."}` dan `ADMIN_PASSWORD = "..."`.
- **Sisa file dev dihapus, dan celah yang meloloskannya ditutup.** `02-application/cleanup-dev.tmp.ts` (skrip sekali pakai untuk membersihkan akun dev, ter-commit di `3115441`) terhapus — tidak direferensikan apa pun lagi. Folder `02-application/06-temp/` yang kosong dan duplikatif juga dihapus (konvensinya hanya di root). Yang lebih penting: **tidak ada `.gitignore` di root**, jadi aturan "`06-temp/` selalu boleh dihapus" tidak ditegakkan apa pun — sekali menjalankan `git add -A` dengan file scratch di situ, file itu ikut ter-commit. Root `.gitignore` kini ada dan meng-ignore isi `06-temp/` (kecuali `.gitkeep` dan `README.md`), `.env*`, `__pycache__/`, `*.pem`, `*.key`, serta state lokal agen (`.claude/`, `.hermes/`).
- **`BETTER_AUTH_SECRET` tidak lagi punya fallback yang terbit.** `src/lib/auth.ts` memakai `process.env.BETTER_AUTH_SECRET ?? <literal>`. Karena repo ini publik, nilai itu bukan kemudahan — ia kredensial yang terbit, dan secret ini **menandatangani cookie sesi**, jadi siapa pun yang membacanya bisa membuat sesi admin yang valid untuk deployment mana pun yang lupa menetapkan environment-nya. Sekarang secret **wajib** ada (`requireEnv` melempar bila kosong); panjang <32 hanya memperingatkan, karena better-auth sendiri memperlakukan itu sebagai peringatan dan melempar akan mengunci semua user dari deployment yang sudah berjalan.
- **Password admin default dihapus.** Password itu terbit di tiga tempat: `src/db/seed.ts`, `05-config/.env.example`, dan `README.md`. Seeding pertama tanpa override menciptakan akun admin dengan password yang bisa dibaca siapa saja di internet. `SEED_ADMIN_PASSWORD` kini **wajib** dan dibaca sebelum menyentuh database (gagal cepat, tidak setengah jalan). Akun `admin@flowboard.local` di produksi sudah tidak memakai default ini (login `401`).
- **`seed.ts` tidak lagi mencetak password ke stdout.** Baris terakhirnya menulis `Admin login: <email> / <password>`, dan output `npm run db:seed` mudah tersalin ke issue atau chat. Kini hanya nama akunnya yang dicetak.
- **Pre-commit hook menolak commit yang memuat kredensial.** CI sudah memindai, tapi commit tetap bisa ter-push sebelum CI selesai — dan itu benar-benar terjadi: satu session note yang sekadar **mengutip** password default lama membuat CI merah, karena kutipan itu tetap cocok dengan scanner. `.githooks/pre-commit` menjalankan scanner yang sama (≈0,3 detik) dan menolak commit; diaktifkan per-clone lewat `git config core.hooksPath .githooks`. Direktori `.husky/` yang kosong (husky tidak pernah terpasang) dihapus — direktori itu menyesatkan, seolah ada hook padahal tidak.
- **Scanner melewatkan bentuk yang justru bocor.** Rule `insecure secret fallback` ditambahkan untuk pola `process.env.X ?? "literal"` dan `|| "literal"` pada variabel ber-nama secret (secret/password/token/api_key/credential) — persis bentuk yang membuat `BETTER_AUTH_SECRET` terbit. Versi sebelumnya bersih untuk pola itu; ditemukan dengan menanam berkas probe, bukan dengan membaca ulang regex.

### Docs

- **README tidak lagi menyembunyikan dua hal**: API publik v1 (API key per user, scope `r`/`rw` — tidak disebut sama sekali di Ringkasan padahal sudah dipakai produksi dan punya dokumen 420 baris), dan peta dokumennya sendiri. Kini ada daftar fitur API dan tabel "Dokumentasi" yang menautkan requirement, arsitektur, `api.md`, runbook, changelog, dan deployment-logs.
- **`06-temp/README.md` tidak lagi bertentangan dengan git.** Isinya "selalu boleh dihapus", padahal tanpa `.gitignore` di root isi folder itu justru bisa ter-commit. Sekarang aturannya ditegakkan oleh `.gitignore`, dan klaim itu benar.
- **`03-history/deployment-logs/` terisi** — direktori ini kosong sejak awal. Kini berisi catatan dua kegagalan deploy produksi pertama (19 Sep) yang sebelumnya hanya tersimpan sebagai pesan commit: `Apply Neon policy` ditolak `HTTP 422` karena plan free membatasi branch yang boleh diproteksi, lalu `Deploy web Worker` gagal karena CI memakai Node 20 sementara `wrangler` 4.130 butuh ≥22. Masing-masing dengan gejala per-step, akar masalah, commit perbaikan, dan pelajarannya. Ada `README.md` yang menjelaskan konvensi + cara memeriksa status deploy.
- **Runbook deployment kini menjelaskan cara membaca kegagalan**, bukan hanya alur sukses: step pertama yang merah adalah satu-satunya yang informasinya nyata (sisanya `skipped`), dan karena `migrate` berjalan sebelum `deploy`, kegagalan di tahap deploy meninggalkan skema yang sudah berubah dengan kode yang belum — keadaan setengah jalan, bukan sekadar "deploy gagal".
- **`requirements.md` dan `architecture.md` tidak lagi kerangka kosong.** Keduanya berhenti di stub sejak commit awal `1e2388b`: tabel komponen tanpa isi dan daftar requirement kosong. Kini keduanya memetakan sistem yang benar-benar ada (17 tabel, 33 route API, alur reminder end-to-end), masing-masing dengan rujukan berkas sebagai bukti.
- **PRD yang dirujuk puluhan titik di kode dinyatakan hilang, bukan dibiarkan menggantung.** README menyebut "PRD v1.2 (`01-documents/PRD-todo-gantt.md`)" padahal berkas itu tidak ada di filesystem maupun riwayat git. `requirements.md` sekarang menyatakan asal-usulnya secara terbuka — direkonstruksi dari kode dan tes, nomor requirement (`F-4.3`, `§6.3`) dipertahankan agar rujukan di kode tetap bisa ditelusuri — dan menegaskan bahwa temuan PRD asli harus **menggantikan**, bukan digabung.
- **`runbooks/deployment.md` diperbaiki: sebelumnya menyesatkan.** Runbook lama menyuruh `make deploy`, padahal target itu hanya mencetak alamat server yang salah (aplikasi ini tidak berjalan di server itu; deploy sebenarnya ke Cloudflare Workers lewat CI). Kini menjelaskan alur sebenarnya (CI → migrate → deploy), cara memeriksa rilis, dan rollback.
- **`Makefile` tidak lagi berisi target palsu.** `make dev/test/lint/deploy` hanya `echo` sehingga selalu "berhasil" tanpa melakukan apa pun. Kini meneruskan ke script npm yang sebenarnya, ditambah `make check` (typecheck + lint + test), dan `make deploy` sengaja gagal dengan pesan yang mengarahkan ke CI.
- **`runbooks/troubleshooting.md` diisi** dengan masalah nyata yang pernah terjadi (origin better-auth, hapus kolom berisi task, OOM lint) beserta penyebab dan solusinya.

### Changed
- **Dialog "Edit board" dan panel "Task detail" kini bisa ditutup dengan Escape** dan ditandai `role="dialog"` / `aria-modal` — sebelumnya hanya `ConfirmDialog` yang punya, sehingga dua dialog terbesar tidak terbaca sebagai dialog oleh screen reader dan mengharuskan klik mouse.

### Added (Profil, notifikasi, modal konfirmasi)
- **Halaman profil** (`/settings/profile`, U8): user dapat mengganti nama tampilan dan timezone sendiri. Timezone divalidasi lewat `Intl` — bukan kosmetik, karena seluruh perhitungan reminder (jam default, quiet hours, "due today") memakai zona ini. Ada saran otomatis dari zona browser, tombol Reset, dan tautan cepat ke ganti password / setelan notifikasi / API keys. Email dan role tetap dikelola admin.
- **`GET`/`PATCH /api/settings/profile`**: endpoint sesi untuk membaca dan memperbarui nama + timezone; menolak timezone tak dikenal (`400`), nama kosong/terlalu panjang, dan body tanpa field yang bisa diubah.
- **Indikator loading "Mark all as read"** (U9): tombol menampilkan `Marking…`, disabled, dan `aria-busy` selama request berjalan.

### Changed
- **Modal konfirmasi hapus user** (U10): `confirm()` native di halaman admin diganti `ConfirmDialog` yang bisa diakses (Escape, klik luar, tombol Cancel/Delete, state busy saat proses), menutup sisa terakhir pemakaian dialog bawaan browser.
- Header aplikasi kini menautkan ke halaman profil (sebelumnya ke ganti password, yang sekarang dijangkau dari halaman profil).

### Added (Public API + API key per user)
- **API key per user** (`/settings/api-keys`): setiap user dapat membuat key sendiri untuk integrasi eksternal (script, n8n, asisten seperti Hermes). Key berformat `fbk_<64 hex>`, **hanya hash SHA-256 yang disimpan**, ditampilkan sekali saat dibuat, mendukung scope `read`/`write` dan masa berlaku opsional. Daftar key menampilkan `lastUsedAt`, dan revoke berlaku seketika.
- **Public REST API v1** (`/api/v1`), diautentikasi lewat `Authorization: Bearer <key>` atau `x-api-key`:
  - `GET /me` — verifikasi key + profil pemilik
  - `GET /boards` — board + kolom (status) + hitungan task
  - `GET /todos` — daftar todo dengan filter `boardId`, `statusId`, `state`, `due` (overdue/today/week/soon), `within`, `q`, `limit`
  - `POST /todos`, `GET/PATCH/DELETE /todos/:id` — CRUD penuh, termasuk `completed: true/false` untuk selesai/reopen
  - `GET /todos/expiring` — bucket `overdue` / `today` / `soon` dalam satu panggilan
  - `GET /reminders` — agenda (`upcoming`, `inbox`, `kinds`), `POST /reminders` — tandai dibaca
- **Isolasi data per key**: setiap query dibatasi ke user pemilik key; board/task milik user lain mengembalikan 404 (bukan 403) agar keberadaannya tidak bocor.
- **Rate limit** 120 request/menit per key, dengan header `X-RateLimit-Limit`/`Remaining`/`Reset` dan `Retry-After` saat 429.
- **CORS + preflight** untuk seluruh permukaan `/api/v1`, sehingga dapat dipanggil dari browser maupun server.
- **Dokumentasi integrasi** `01-documents/api.md` — referensi endpoint, contoh `curl` siap pakai, dan pola aman (key read-only untuk pelaporan, `rw` hanya bila perlu menulis).

### Fixed
- `POST /api/v1/todos` tidak menegakkan scope `write` — key read-only sebelumnya dapat membuat task. Kini mengembalikan 403.
- `PATCH /api/v1/todos/:id` dengan `completed: false` tidak memindahkan task keluar kolom Done — status tetap `done` dan progress tetap 100. Kini dipindah ke kolom terbuka pertama dengan `completedAt` dikosongkan.
- `assertDate()` menerima tanggal mustahil (mis. `2026-02-30`) karena `Date.parse` meroll-over. Kini divalidasi round-trip.

### Added (Gantt view + kontrol kolom)
- **Gantt view** (tab ketiga di board, `/boards/:id?view=gantt`): timeline bulan+harian, shading weekend, bar berwarna per status, milestone (diamond), progress fill, drag-to-move + drag-edge-to-resize, tooltip hover, tray *unscheduled*, dan grup per status yang bisa dilipat.
- **Today-centring**: hari ini selalu berada di tengah viewport; otomatis re-center saat preset (`1M/3M/6M/1Y/All`), zoom, atau tombol `◎ Today` berubah, dan tetap stabil saat ukuran jendela berubah. Kolom hari ini diberi tint + pill + marker gradien agar langsung tertangkap mata.
- **Sort timeline**: `Nearest to today` / `Start date` / `Priority`; toggle `Show completed` dengan lencana jumlah task tersembunyi.
- **Sembunyikan kolom status** (`src/lib/status-visibility.ts`): dropdown `Columns` di header board untuk show/hide kolom status; preferensi per-browser (localStorage) dan diterapkan konsisten di view **board, list, dan gantt**.

### Fixed
- Label `done` palsu pada header kolom Done (kini ikon `✓` dengan tooltip).
- Comparator sort menghasilkan `NaN` untuk task tanpa tanggal.
- Tinggi kontainer baris Gantt diperbaiki agar marker "today" membentang penuh di seluruh grid.

### Added (UI/UX — Fase 2)
- **U1 — Label UI**: task detail kini punya picker label (toggle chip) + form buat label baru (auto-attach), dan kartu task menampilkan chip label. Endpoint baru `GET/POST/DELETE /api/tasks/:id/labels` (validasi label satu board, idempoten).
- **U2 — Feedback autosave**: drawer task menampilkan "Saving… / Saved ✓ / Save failed" (aria-live) untuk setiap perubahan.
- **U3 — Kelola board**: menu aksi di kartu board (edit nama/deskripsi/warna, arsipkan/unarsipkan, hapus dengan konfirmasi ketik nama).
- **U4 — Kelola kolom**: menu header kolom (rename, ganti warna, geser kiri/kanan, hapus dengan konfirmasi).
- **U5 — Empty state kolom**: petunjuk "Drop tasks here" / "No matching tasks".
- **U6 — Shortcut `/`** memfokuskan input pencarian (sesuai placeholder).
- **U10 — ConfirmDialog** komponen modal yang dapat dipakai ulang; menggantikan `confirm()` native pada hapus task dan dipakai untuk hapus board/kolom.

### Fixed
- **U7 — Warna lengkap**: `globals.css` kini mendefinisikan `--indigo/--emerald/--amber/--rose/--sky/--violet/--slate`; mapping warna board/kolom tidak lagi jatuh ke indigo.
- **BUG-8 (P1):** "Mark all as read" di Notifications selalu gagal 404 — frontend memanggil `/api/notifications/read` (tidak ada), backend mendefinisikan read di `POST /api/notifications`. Diperbaiki dengan mengarahkan `markAll` ke `/api/notifications`.
- **BUG-9 (P1):** progress task tidak di-reset saat dipindah keluar kolom "Done" (tetap 100% padahal `completedAt` sudah null). Diperbaiki di `moveTask()` — keluar dari Done kini `progress=0` (bila ada subtask, `recomputeProgressFromSubtasks` menimpanya dengan rasio benar).
- **BUG-10 (P2):** duplikat label memicu 500 (unique constraint) — kini di-precheck dan mengembalikan 400 "Label already exists", dengan fallback `23505` race-safe.
- **BUG-11 (P2):** `/api/push/public-key` (endpoint publik) diblokir middleware untuk anon — ditambahkan ke `PUBLIC_PATHS`.

- **BUG-7 (P0):** change-password stuck in a redirect loop. Two causes: (1) `mustChangePassword` was never cleared after a self-service change — fixed with an `account.update.after` hook (clears only when `context != null`); (2) the session `cookieCache` kept the stale `mustChangePassword=true` in a cookie for up to 5 min — fixed by disabling `cookieCache`. Also added a "✓ Password updated" success state and friendlier error copy. Verified end-to-end: login → change → flag clears immediately → `/boards` returns 200 (no loop) → login with new password works.
- **BUG-6 (P0):** blank white page in real browsers. CSP `script-src 'self'` blocked Next.js App Router's inline RSC bootstrap scripts, so React never hydrated. Added `'unsafe-inline'` to `script-src` (nonce-based CSP is the proper follow-up). Verified: login form renders and full login flow works in a real browser.
- **BUG-1 (P0):** middleware now accepts both `__Secure-better-auth.session_token` (HTTPS) and `better-auth.session_token` (HTTP dev). Previously every authenticated route 307-redirected back to `/login` in production because better-auth prefixes the cookie with `__Secure-` over HTTPS.
- **BUG-2 (P1):** `lastLoginAt` now populates on login via `databaseHooks.session.create.after`.
- **BUG-3 (P1):** `VAPID_SUBJECT` fallback corrected to `mailto:admin@nexigo.my.id`.
- **P2 hardening:** `/api/push/subscribe` now validates `p256dh`/`auth` are unpadded base64url before storing, so the reminder worker never signs/encrypts against a malformed key.

### Added
- Implementasi penuh FlowBoard (PRD v1.2): Next.js 15 App Router + better-auth (self-hosted), Drizzle ORM, Postgres.
- Modul M1–M8: auth (login, ganti password, forced change, logout), board privat, status CRUD + urutan, task CRUD + jadwal (start/due date), Gantt custom (day/week/month), notifikasi push + PWA, subscription hygiene, admin user CRUD + activity log.
- Worker `flowboard-reminder` (cron `*/5`) untuk pengiriman pengingat Web Push.
- PWA: `manifest.webmanifest`, `sw.js` (push + notificationclick), ikon PNG/SVG, favicon.
- Seed script admin pertama (`npm run db:seed`).

### Changed
- Auth pakai Opsi B (self-hosted better-auth), bukan Managed Better Auth (spike workerd belum dijalankan).

### Fixed
- `rescheduleTaskReminders`: ganti insert jadi upsert `ON CONFLICT (task_id, kind)` agar reaktivasi reminder setelah task keluar dari kolom "Done" tidak melanggar unique key.
- `reset-password` admin: kirim hash password (bukan plaintext) ke `internalAdapter.updatePassword`.
- Middleware diubah menjadi edge-safe (cek keberadaan cookie saja); validasi sesi penuh + forced-password-change dipindah ke server layout Node runtime.
- Drag & drop task (`board-view.tsx`): `prevPosition`/`nextPosition` dihitung dari tetangga kolom target (sebelumnya selalu `null` → task selalu append).
- Gantt bar drag/resize (`gantt-view.tsx`): diimplementasi penuh (pointer events + snap hari + resize edge), sebelumnya hanya klik.
- View toggle `?view=` + task deep link `?task=` (`boards/[id]/page.tsx`).
- Notifications cursor pagination (`id < cursor`) di `api/notifications/route.ts`.
- Rebalance kolom server-side saat gap posisi < EPSILON (`lib/domain.ts`).
- 50 warning lint → 0 warning; dynamic import `ApiError` → import statis di semua route.
- Worker cron (`workers/reminder`): klaim baris dibuat **conditional update** (`UPDATE ... WHERE status='pending'`) sebagai pengganti `FOR UPDATE SKIP LOCKED` yang tidak didukung driver Neon HTTP — mencegah double-send (PRD §15). Logika keputusan dikeluarkan ke `src/lib/push-delivery.ts` (murni & ter-test).
- CI kini mengecek worker (`npm run typecheck:worker`) yang sebelumnya di-exclude dari `tsconfig`/`eslint`.

### Tests
- Unit test Vitest untuk `ordering` (midpoint/rebalance) dan `reminders` (keempat jenis reminder, quiet hours, timezone) — 16 test, semua lolos (`npm run test`).
- Unit test `push-delivery` (klasifikasi status 2xx/404/410/429/5xx, backoff 5/20/60, konstanta) — total **22 test**, semua lolos.


## [Deploy — 2026-09-19]

### Deployed
- Produksi live di https://todo.nexigo.my.id (Cloudflare Workers + Neon Postgres).
- Worker flowboard-web (Next.js via OpenNext) + flowboard-reminder (cron */5) ter-deploy, secrets/vars terpasang.
- Custom domain todo.nexigo.my.id -> flowboard-web (cert SSL auto, DNS proxied).
- Migrasi Drizzle dijalankan terhadap branch production (15 tabel + 2 enum + login_attempts).
- Admin pertama di-seed: admin@flowboard.local (role admin, login terverifikasi).

### Infra fixes
- .github/workflows/deploy.yml dipindah ke root repo.
- Neon project id dikoreksi: cold-brook-93438292.
- neon.ts: protected:true di-drop (Neon free plan HTTP 422).
- CI node-version 20 -> 22 (wrangler 4.130 butuh Node >=22).
- Registrasi workers.dev subdomain (sudharmika.workers.dev).
- DATABASE_URL_UNPOOLED ditambahkan untuk drizzle-kit migrate.
- Web Worker dapat secret VAPID_PRIVATE_KEY.
