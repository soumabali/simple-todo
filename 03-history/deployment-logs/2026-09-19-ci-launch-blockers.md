# 2026-09-19 — Dua kegagalan deploy pertama (plan Neon + versi Node)

Dua deploy produksi pertama gagal berturut-turut, masing-masing karena hal yang
berbeda. Keduanya sudah diperbaiki di hari yang sama dan 26 deploy setelahnya
hijau.

Run: `35422426419` (gagal 04:51 UTC) → `35422597970` (gagal 04:56 UTC) →
`35422816415` (hijau 05:01 UTC, commit `40f6d26`).

---

## Kegagalan 1 — `Apply Neon policy` ditolak (HTTP 422)

**Run** `35422426419` · commit `4614698` · 2026-09-19 04:51 UTC (12:51 WITA)

### Gejala

Job `verify` hijau penuh (lint, typecheck, test, build). Job `deploy` gagal di
**step kelima**, sebelum menyentuh database atau Cloudflare sama sekali:

```
Apply Neon policy        -> failure
Run database migrations  -> skipped
Deploy web Worker        -> skipped
Configure web Worker secrets -> skipped
Deploy reminder Worker   -> skipped
```

Semua step sesudahnya `skipped`, jadi tidak ada aplikasi yang ter-deploy.

### Penyebab

`02-application/neon.ts` menandai branch default sebagai *protected*:

```ts
if (branch.isDefault) {
  return { protected: true }; // production cannot be applied to casually
}
```

Neon menolak ini dengan `HTTP 422 "maximum number of protected branches"` —
plan free/launch membatasi jumlah branch yang boleh diproteksi, dan kuotanya
sudah terpakai.

### Perbaikan

Commit **`18270a2`** — `fix(neon): drop protected:true — free plan caps protected branches (HTTP 422)`:

```ts
// NOTE: `protected: true` on the default branch is deliberately NOT set.
// ... protection is a safety nicety, not a launch requirement.
// Re-enable it when the plan allows.
if (branch.isDefault) {
  return { protected: false };
}
```

### Pelajaran

**Kegagalan paling awal di pipeline menyembunyikan seluruh sisa pipeline.**
Step ke-5 gagal → 6 step sesudahnya `skipped`, jadi tidak ada satu pun sinyal
tentang apakah migrasi atau Worker-nya sendiri bermasalah. Saat deploy merah,
**baca urutan step-nya lebih dulu sebelum membaca pesan error** — step pertama
yang merah adalah satu-satunya yang informasinya nyata.

Lebih spesifik: fitur Neon yang bergantung pada plan (protected branches,
jumlah branch, TTL) tidak boleh menjadi blocker launch. Kalau sebuah kebijakan
keamanan opsional menolak dijalankan, nonaktifkan dengan komentar yang
menjelaskan alasannya — jangan hapus diam-diam.

---

## Kegagalan 2 — `Deploy web Worker` gagal (Node 20 vs wrangler 4.130)

**Run** `35422597970` · commit `18270a2` · 2026-09-19 04:56 UTC (12:56 WITA)

### Gejala

Perbaikan sebelumnya berhasil — step `Apply Neon policy` dan `Run database
migrations` kini **sukses** — tapi pipeline berhenti satu langkah lebih jauh:

```
Apply Neon policy        -> success
Run database migrations  -> success
Deploy web Worker        -> failure
Configure web Worker secrets -> skipped
```

Perhatikan: migrasi database **sudah jalan** sebelum kegagalan ini. Skema
production sudah ter-update, tapi kode aplikasinya belum ter-deploy — keadaan
setengah jalan, dan itu yang membuat kegagalan ini lebih tidak nyaman daripada
yang pertama.

### Penyebab

CI memakai `node-version: "20"`, sedangkan `wrangler` yang dipin di
`02-application/package.json` adalah `4.130.0`, yang mensyaratkan **Node >= 22**.

### Perbaikan

Commit **`40f6d26`** — `fix(ci): bump node-version 20 -> 22 (wrangler 4.130 requires >=22)`, dua baris di `.github/workflows/deploy.yml` (job `verify` dan `deploy`).

### Pelajaran

**Versi runtime di CI harus mengikuti persyaratan dependensi, bukan sebaliknya.**
`20` adalah default yang mudah ditulis dan terlihat benar; kegagalannya baru
muncul di step paling akhir. Bila sebuah tool CLI dipin versinya di
`package.json` (`wrangler: "4.130.0"`), Node yang dipakai CI adalah bagian dari
kontrak itu — kunci keduanya bersamaan, dan lebih baik lagi dengan `.nvmrc`
(proyek ini belum punya).

**Juga:** dua kegagalan berturut-turut di step yang berbeda itu normal saat
pertama kali menyalakan pipeline. Yang penting, setiap perbaikan harus
memindahkan batas kegagalan ke depan, bukan sekadar membuat step yang sama
berhenti merah — dan itulah yang terjadi di sini (422 → versi Node → hijau).

---

## Setelahnya

Setelah `40f6d26`, seluruh deploy berikutnya **hijau** — 26 dari 28 run di
riwayat repo (per 2026-09-20, `gh run list --workflow=Deploy`), termasuk rilis
terakhir commit `9740753`:

```
Uploaded flowboard-web (4.83 sec)
Deployed flowboard-web triggers (0.37 sec)
Current Version ID: 0fa8dca0-4bf9-4aac-af5f-92e8407cf42f
Uploaded flowboard-reminder (1.40 sec)
Current Version ID: a5c058e5-0c13-4318-99f1-60dd64c3ad3d
```
