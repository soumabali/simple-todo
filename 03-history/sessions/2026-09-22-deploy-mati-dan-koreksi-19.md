# 2026-09-22 — Deploy produksi mati 30 jam, dan koreksi atas #19

Sesi ini dimulai sebagai "pakai token Cloudflare di `.hermes/.env`". Berakhir
dengan dua temuan yang saling bertentangan dengan catatan sebelumnya.

## Ringkas

| | |
|---|---|
| Durasi produksi beku | ~30 jam (`2026-09-20T08:10Z` → `2026-09-21T15:59Z`) |
| Cacat pada jalur deploy | 2 (dua-duanya harus diperbaiki) |
| Kegagalan senyap di skrip baru | 3 |
| Issue ditutup | #22 |
| PR dibuka | #25, #24, #23 |

## 1. Deploy tidak pernah jalan (#22)

Gejalanya: kredensial Cloudflare di `.hermes/.env` salah/kedaluwarsa, jadi
`wrangler deploy` gagal. Tapi memperbaiki token saja **tidak cukup** — ada dua
cacat terpisah di `.github/workflows/deploy.yml`:

1. **Job `deploy` di-skip pada `pull_request`.** Run-nya tetap `success`,
   jadi **semua PR terlihat hijau di jalur yang tidak pernah men-deploy
   apa pun**. Kegagalannya hanya muncul saat push ke `main`.
2. **Tidak ada cara menjalankan deploy atas permintaan.** Setelah menambahkan
   `workflow_dispatch`, ternyata **masih belum cukup**: guard
   `if: github.event_name == 'push'` juga men-SKIP run manual. Terbukti dari
   run `35620508523` — tombolnya ada, tapi tetap tidak men-deploy.

Verifikasi: dua run manual, **12/12 langkah sukses** (migrasi, 2 Worker,
secrets, smoke test). Produksi bergerak dari `2026-09-20T08:10:29Z` ke
**`2026-09-21T15:59:16Z`**.

**Pelajaran:** "CI hijau" **bukan** bukti rilis jalan. Selalu sebutkan status
job deploy secara eksplisit, atau lebih baik lagi buktikan versi yang benar-benar
tayang (`wrangler deployments status`).

## 2. Koreksi: "500 intermiten" ternyata DUA hal berbeda

Catatan sesi sebelumnya (`2026-09-21-e2e-produksi-dan-500-intermiten.md`)
menyimpulkan 500 intermiten berasal dari `neon-http`. Saat verifikasi, aku
mengukur ulang dan menemukan pola yang mencurigakan:

```
/favicon.ico dari mesin ini : 11x200, 5xtimeout   <- aset STATIS, tanpa DB
jaringan lain               : 12/12 @ 12-16ms
Cloudflare Workers analytics: 296 request, 0 error
```

Yang menentukan — korelasi sempurna, 14 dari 14:

```
code=000  cf-ray=NO
code=200  cf-ray=YES
```

Tanpa `cf-ray` = permintaan **tidak pernah sampai ke edge Cloudflare**. Dan
`router.nexigo.my.id` (Worker lain) juga gagal 6/10 dari mesin ini, sementara
host Cloudflare di luar zone kita 8/8 bersih dengan 0% packet loss.

Aku hampir menyimpulkan semuanya artefak pengukuran. **Itu salah.**

Setelah membersihkan proses `wrangler tail` yang tertinggal, log-nya ternyata
menyimpan **14 baris `Failed query` nyata** pada `13:02`–`13:11Z`:

```
Unhandled error: Error: Failed query: select ... from "tasks"
ERROR [Better Auth]: INTERNAL_SERVER_ERROR
```

Jadi yang benar: ada **dua fenomena terpisah** yang tercampur.

- **Kegagalan Neon nyata** — sebelum perbaikan tayang. #18 sudah merged tapi
  **belum pernah live**, karena deploy-nya mati. Error terakhir `13:11:27Z`.
- **Timeout jalur penguji** dari mesin ini — sampai sekarang, tidak
  berhubungan dengan aplikasi.

Setelah deploy `15:59:16Z`, log terakhir `18:57:57Z`: **nol error** dalam ~3 jam.

#19 **belum ditutup**. Kriterianya sekarang: nol `Failed query` selama >= 24 jam
sejak `15:59Z`.

## 3. Alat baru: `scripts/check-production-health.py` (PR #24)

Cara memeriksa produksi tadinya cuma potongan perintah ad-hoc di sesi — dan itu
persis yang membuat kesimpulan mudah salah. Tiga mode, sengaja dipisah:

```
edge       Apakah permintaan sampai Cloudflare?  -> header cf-ray, BUKAN berapa yg 200
analytics  Apakah ada error?                     -> Workers analytics (sumber kebenaran)
errors     Kegagalan DB seperti apa?             -> Failed query dari log Worker
```

### Tiga kegagalan senyap yang ketemu saat menulisnya

Ketiganya jenis yang sama seperti bug asli: **output normal = kosong, jadi
"mati" dan "sehat" terlihat identik.**

1. `wrangler tail --format json` mengeluarkan objek **pretty-printed
   multi-baris**, bukan satu objek per baris. Parser per-baris menolak **semua**
   event lalu melaporkan "0 event". Parser sekarang menghitung kedalaman kurawal
   + melacak status kutip.
2. `readline()` memblokir tanpa batas → `while time < deadline` tidak pernah
   dievaluasi lagi → skrip menggantung lewat jendelanya. **Terukur: 172s untuk
   jendela 50s.** Diperbaiki dengan watchdog thread.
3. `npx` menjalankan wrangler sebagai anak → `terminate()` pada parent
   meninggalkan cucu yang tetap memegang pipe. Diperbaiki dengan
   `start_new_session` + `killpg`.

Tambahan terukur: `wrangler tail` butuh **~11.3s** untuk terhubung, jadi jendela
pendek habis untuk handshake. Bawaan `--watch` dinaikkan ke 120s, dan "0 event"
sekarang mencetak peringatan eksplisit bahwa itu **bukan** bukti aplikasi sehat.

## Yang masih memblokir

Token GitHub (fine-grained) **kurang `Administration`**. Akibatnya 403 pada merge
PR, metadata repo, dan branch protection. Bisa: baca repo, issue/komentar, buat
PR, push branch, tulis secrets.

Memblokir: #11, #2, #3, dan merge PR #25/#24/#23.

## Verifikasi sesi ini

- 3 self-test lulus (`check-production-health`, `notify-issues`, `triage-issues`)
- `errors --watch 90`: 15 event, berhenti 91s, **0 proses tertinggal**
- `analytics`: 0 error · `edge`: 3/6 tidak sampai edge + exit 1 (sesuai harapan)
- Produksi: `/login` → `200` dengan `cf-ray` (kombinasi yang bisa dipercaya)
- 0 proses `wrangler` tertinggal · working tree bersih · tiap branch = 1 PR
