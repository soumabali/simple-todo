# 2026-09-22 — "Kenapa saya tidak bisa akses admin?"

Pertanyaan Dhar. Jawabannya **dua bagian**: satu bukan bug, satu bug nyata.

## Bagian 1 — bukan bug: akunnya memang `role=user`

Status di produksi:

- `admin@flowboard.local` -> `admin` (satu-satunya)
- `sudhar.denpasar@gmail.com` -> `user`
- `sadia@timedoor.net` -> `user`

`requireAdmin` (`src/lib/session.ts`) mengembalikan **404** untuk non-admin —
sesuai PRD, bukan 403, supaya keberadaan area admin tidak terungkap. Jadi API-nya
benar dan tidak ada data yang bocor.

Diverifikasi dengan user tes sungguhan:

```
role=user  -> /api/admin/users 404, /api/admin/logs 404
role=admin -> /api/admin/users 200, /api/admin/logs 200
```

**Solusinya:** naikkan `sudhar.denpasar@gmail.com` ke `role=admin`.

**Sudah dikerjakan** (setelah Dhar mengonfirmasi — ini mengubah hak akses akun
asli, jadi tidak dilakukan atas inisiatif sendiri):

```
PATCH /api/admin/users/UUdZdI3I6ZuF9UPoiEYXnpy0IMMSHAtY  {"role":"admin"}
-> 200 {"user":{"email":"sudhar.denpasar@gmail.com","role":"admin",...}}
```

Diverifikasi dengan membaca ulang dari DB (bukan hanya mempercayai respons):

```
admin@flowboard.local        admin
sudhar.denpasar@gmail.com    admin   <-- dinaikkan
sadia@timedoor.net           user
```


## Bagian 2 — bug: gate halaman admin tidak pernah ada

`(app)/layout.tsx` berisi ini, dan **hanya** ini:

```ts
// Admin-only routes: non-admins are sent to /boards (the middleware
// already gates, but double-check here for the 404 semantics).
```

Deskripsi niat, tanpa satu baris kode. Komentar itu menyebut middleware "already
gates" — **itu tidak benar**: middleware-nya Edge-safe, jadi tidak boleh
mengimpor better-auth untuk membaca sesi, dan hanya memeriksa *keberadaan* cookie
(`SESSION_COOKIES.some(name => req.cookies.has(name))`).

Akibatnya user non-admin yang sudah login menerima **HTTP 200** dan shell admin
ter-render penuh — judul "Users", tombol "+ Add user" — dengan tabel kosong karena
API di belakangnya menjawab 404.

Itu terbaca sebagai **aplikasi rusak**, bukan sebagai batas izin. Persis yang
membuat Dhar bertanya.

### Perbaikan (PR #31)

- aturan dipindah ke `src/lib/access.ts` sebagai fungsi murni `decideShell`,
  supaya bisa diuji tanpa HTTP
- `(app)/layout.tsx` hanya menyambungkannya; non-admin di `/admin/*` -> `notFound()`
- middleware meneruskan `x-pathname`; **tanpa ini layout tidak punya cara membaca
  path dan gate-nya tidak akan pernah aktif** — inilah sebab kegagalannya

Urutan gate: tanpa sesi -> `/login`; wajib ganti password -> `/change-password`;
lalu cek admin. Tanpa urutan itu, admin yang wajib ganti password bisa lolos ke
`/admin`.

## Pola yang berulang — layak diwaspadai

Ini **kedua kalinya hari ini** menemukan bug yang tidak terlihat saat membaca kode:

1. `e(a) && e(b)` di Drizzle `where` — terlihat benar, tapi JS short-circuit
   membuang kondisi pertama (#28)
2. komentar yang menjelaskan guard, di mana guard-nya tidak ada (#31)

Keduanya lolos dari `tsc`, lint, dan build karena tidak ada yang salah secara
sintaks. Pelajarannya: **assert perilaku yang bisa diamati, bukan teks sumber.**
`access.test.ts` menguji keputusan yang dikembalikan; `drizzle-where.test.ts`
menguji bentuk query yang dihasilkan.

Komentar yang mengklaim sebuah jaminan ("the middleware already gates") adalah
kandidat kuat untuk sudah basi — ia memberi rasa aman tanpa kode.

## Catatan proses

- Akun tes dibuat lewat `scripts/e2e-provision.ts`, password acak ke file `0600`,
  **tidak pernah dicetak**, dan dihapus setelah selesai. Tidak ada password yang
  ditanyakan atau diketk di chat.
- `scripts/e2e-provision.ts` sengaja **menolak** argumen di luar dua akun
  fixture-nya (`assertManaged`). Percobaan pertama memakai flag `--admin-email`
  dan diabaikan — itu desain yang benar, bukan bug.
- Kesalahan sendiri: `git reset --hard origin/main` menghapus file baru yang belum
  di-commit (`access.ts`, `access.test.ts`, perubahan `layout.tsx`). Ditulis ulang,
  dan commit diamend supaya PR-nya utuh. Pelajarannya: jangan `reset --hard`
  dengan perubahan yang belum di-commit di working tree.
