# Sesi — E2E Testing Production + Perbaikan Bug & UI/UX (Fase 1 & 2)

**Tanggal:** 2026-09-19
**Target:** https://todo.nexigo.my.id (produksi)
**Commit akhir:** `051ae69`

---

## Yang dikerjakan

### 1. E2E testing penuh di URL produksi
- Reachability, auth (login/logout/session/forgot-reset), boards, kolom, task,
  subtask, label, komentar, notifikasi, push, admin → 15+ area diuji.
- Ditemukan **4 bug** (BUG-8..BUG-11) → semuanya diperbaiki & diverifikasi ulang.

### 2. Fase 1 — Perbaikan bug (commit `845037f`)

| Bug | Gejala | Fix |
|---|---|---|
| BUG-8 (P1) | "Mark all as read" selalu 404 | frontend memanggil `/api/notifications/read` (tidak ada); diarahkan ke `POST /api/notifications` |
| BUG-9 (P1) | Task keluar dari kolom Done → masih 100% | `moveTask()` reset `progress=0` bila pindah keluar dari status `isDone` |
| BUG-10 (P2) | Attach label duplikat → 500 | precheck duplikat + fallback kode Postgres `23505` → 400 "Label already exists" |
| BUG-11 (P2) | `/api/push/public-key` diblokir utk anon | ditambahkan ke `PUBLIC_PATHS` di `middleware.ts` |

### 3. Fase 2 — UI/UX (commit `b480c2b`, `2a7e852`)

| Item | Perubahan |
|---|---|
| U1 | Label UI: picker + form buat label baru (auto-attach) di task drawer; chip label di kartu. Endpoint baru `GET/POST/DELETE /api/tasks/[id]/labels` |
| U2 | Feedback autosave: "Saving… / Saved ✓ / Save failed" dengan `aria-live` |
| U3 | Menu board: edit (nama/deskripsi/warna), arsip, hapus + konfirmasi ketik nama |
| U4 | Menu kolom: rename inline, ganti warna, geser kiri/kanan, hapus |
| U5 | Empty state kolom ("Drop tasks here" / "No matching tasks") |
| U6 | Shortcut `/` memfokuskan input search |
| U7 | Palet warna lengkap (`--sky`, `--violet`, `--slate`) — sebelumnya jatuh ke indigo |
| U10 | `ConfirmDialog` reusable menggantikan `confirm()` native |

## Verifikasi

- **API produksi:** 15/15 assertion PASS (skrip sekali pakai; cakupannya kini ada di `e2e-live.py` §2/§3/§6).
- **Browser produksi:** login → edit board live → rename kolom live → buat label dari drawer →
  auto-attach → chip muncul di kartu. **0 JS error**.
- **Gate lokal:** `typecheck` ✅, `eslint src/` ✅, `npm test` 22/22 ✅, `npm run build` ✅.
- **Deploy:** poll via bundle CSS produksi (`--violet` terkonfirmasi live).

## Catatan operasional (penting untuk sesi berikutnya)

1. **Verifikasi deploy paling andal = cek bundle CSS**, bukan poll endpoint.
   Poll `/api/tasks/<uuid>/labels` memberi 404 palsu karena UUID dummy → "task not found".
   UUID nyata baru bisa didapat setelah login + buat board.
2. **`NEON_PRODUCTION_URL` di `~/.hermes/.env` dibungkus tanda kutip** → wajib `tr -d '"'`.
3. **`npm run lint` bisa OOM.** Jalankan `NODE_OPTIONS="--max-old-space-size=4096" npx eslint src/`
   (targetkan `src/` saja; `.open-next/` mengotori hasil).
4. **Deploy CI ~3–4 menit** dari push sampai live.
5. **Jangan commit secret.** Kredensial test di-generate runtime dari `~/.hermes/.env`.

## Sisa (Fase 3 — opsional, belum dikerjakan)

- **U8** Halaman profil pengguna (ganti nama / timezone).
- **U9** Indikator loading notifikasi (sebagian tercakup oleh fix BUG-8).

## Kebersihan

- Data & user test (`*@flowboard.test`) + board hasil uji **sudah dihapus** dari DB produksi.
- DB produksi bersih: 2 user nyata (admin + 1 akun pemilik proyek), 1 board.
- Working tree git bersih, semua commit ter-push ke `main`.
