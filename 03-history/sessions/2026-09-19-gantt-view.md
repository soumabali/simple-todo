# Sesi — Gantt View + Kontrol Kolom

**Tanggal:** 2026-09-19
**Target:** https://todo.nexigo.my.id (produksi)
**Commit:** `c1ed2d0` — CI run `35442781125` (verify ✅ + deploy ✅)

---

## Yang dikerjakan

### 1. Gantt view (baru)
Tab ketiga di board (`?view=gantt`), dibangun dari nol:

- Timeline header dua tingkat: band bulan + band hari (nama hari muncul saat zoom cukup lebar).
- Weekend shading, grid lines, dan marker "today" setinggi penuh grid.
- Bar per task: warna dari warna status, gradient halus, **stripe status** di tepi kiri,
  progress fill, task overdue merah, task selesai 40% opacity + strikethrough.
- Milestone sebagai diamond; task tanpa due date tapi punya start date memakai bar "open" (dashed).
- Interaksi: drag body untuk pindah tanggal, drag tepi untuk resize, hover lift + accent ring,
  tooltip, dan klik untuk membuka drawer task.
- Sektioner: **group by status** (bisa dilipat) + tray **Unscheduled** yang juga bisa dilipat.

### 2. Today-centring
Inti permintaan: hari ini harus **di tengah** layar, bukan di ujung kiri.

- Menghitung offset hari ini, lalu `scrollLeft = todayX - (viewportTimelineWidth / 2)`.
- Re-center otomatis ketika: preset rentang (`1M/3M/6M/1Y/All`), zoom slider, tombol `◎ Today`,
  dan `ResizeObserver` saat lebar viewport berubah.
- Tidak re-center paksa saat user sedang scroll manual (hanya sekali per perubahan konfigurasi).
- Visibilitas: kolom "today" diberi tint tipis + hari ini ditebalkan di band hari + pill "Today" + marker gradien.

### 3. Hide kolom status
- `src/lib/status-visibility.ts` — hook `useHiddenStatuses()` berbasis localStorage,
  reaktif via custom event sehingga beberapa view ikut ter-update.
- Dropdown `Columns` di header board: checkbox per kolom status, tombol reset, lencana "N hidden".
- Kolom tersembunyi difilter di **board, list, dan gantt** secara konsisten.

### 4. Perbaikan kecil
- Label `done` ganda pada header kolom Done → diganti ikon `✓` + tooltip.
- Comparator sort `NaN` untuk task tanpa tanggal.
- Tinggi kontainer baris Gantt (marker today sebelumnya tidak membentang penuh).

## Verifikasi

| Gate | Hasil |
|---|---|
| `npm run typecheck` | ✅ |
| `npm run typecheck:worker` | ✅ |
| `npx next lint` | ✅ 0 warning (butuh `--max-old-space-size=2560`) |
| `npm test` | ✅ 22/22 |
| `npm run build` | ✅ |
| CI GitHub Actions | ✅ verify 1m20s + deploy 1m56s |
| Produksi | ✅ `/login` 200, CSS bundle memuat token baru |

Verifikasi browser dijalankan pada build produksi lokal (`next start`, port 3000 —
port 3100 ditolak better-auth karena `BETTER_AUTH_URL` hanya mempercayai `localhost:3000`).

Diukur langsung di DOM: **today offset dari pusat timeline = 4px** pada preset 1M/3M/6M,
dan tombol `◎ Today` mengembalikan posisi setelah di-scroll ke 0.

## Catatan operasional

1. **`gh` CLI token invalid** → ambil `GITHUB_FINE_GRAINED_TOKENS` dari `~/.hermes/.env`
   lalu `gh auth login --with-token`.
2. **better-auth menolak origin non-trusted** (`INVALID_ORIGIN`) — jalankan preview di port 3000.
3. **`next lint` OOM** di server ini → `NODE_OPTIONS="--max-old-space-size=2560"`.
4. Skema nyata: `boards.user_id` (bukan `owner_id`), status ada di tabel `statuses`,
   `"user"` singular (better-auth) — jangan asumsi `users`.
5. Verifikasi deploy = cek bundle CSS produksi (pola dari sesi sebelumnya).

## Kebersihan

- Data uji dev-branch (`gantt-dev@example.test` + board-nya) **sudah dihapus** — 0 user tersisa.
- Tidak ada kredensial test yang ditulis ke repo; skrip sementara hanya di `06-temp/`.
- Tidak ada server dev yang tertinggal berjalan.

## Sisa (belum dikerjakan)

- **Fase 3**: U8 halaman profil, U9 indikator loading notifikasi.
