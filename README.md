# simple-todo

> Status: `draft` | Tipe: `web` | Dibuat: 2026-09-10

**FlowBoard** — aplikasi TODO berbasis kanban (gaya Trello) dengan Gantt chart interaktif dan pengingat push browser. Requirement dan arsitektur ada di `01-documents/requirements.md` dan `01-documents/architecture.md`.

> **Catatan:** PRD asli ("v1.2") tidak pernah ada di repositori ini, sementara
> ~35 baris komentar kode masih merujuk nomornya (`PRD §6.3`, `PRD F-4.3`, …).
> `requirements.md` merekonstruksi requirement tersebut dari kode dan tes,
> dengan nomor yang dipertahankan agar rujukan tetap bisa ditelusuri.

## Ringkasan

- **Board privat per user**: buat/edit/arsipkan/hapus board, kolom (status) CRUD + urutan drag, task CRUD + drag antar kolom/posisi, prioritas, progres, label, checklist subtask.
- **Jadwal**: setiap task punya `start_date` + `due_date` (inilah "target"-nya), menggerakkan bar Gantt dan penjadwalan pengingat.
- **Pengingat browser push** (4 jenis: `start_soon`, `due_soon`, `due_today`, `overdue`) + PWA ter-install + pusat notifikasi in-app.
- **Public REST API v1** dengan API key per user (scope `r` / `rw`) — untuk script, n8n, atau agent. Dokumentasi: `01-documents/api.md`.
- **Dua peran**: `user` (board/task/jadwal/notifikasi) dan `admin` (kelola akun login, reset password, aktif/nonaktif, lihat activity log). Tanpa self sign-up.

## Arsitektur

- **Framework:** Next.js 15 (App Router) + TypeScript + Tailwind CSS v4
- **Auth:** self-hosted **better-auth** (PRD §6.3 Opsi B) — email + password, role/ban/timezone/must-change-password sebagai `additionalFields`
- **Database:** Neon Postgres (dev lokal: Docker Postgres `simple-todo-postgres` port `5433`)
- **DB access:** Drizzle ORM (`drizzle-orm/node-postgres` untuk Node, `drizzle-orm/neon-http` untuk Workers runtime)
- **State:** TanStack Query (optimistic updates) + Server Actions
- **Drag & drop:** `@dnd-kit` (pointer/touch/keyboard sensors)
- **Push:** `@pushforge/builder` (Web Crypto, zero-dep, Workers-safe) + Service Worker (`public/sw.js`)
- **Gantt:** komponen custom (CSS grid + SVG)
- **Pengirim pengingat:** Worker `flowboard-reminder` (`workers/reminder/`) dengan Cron Trigger `*/5 * * * *`

## Entry Points

| Komponen | Path | Catatan |
|----------|------|---------|
| Web app | `02-application/` | Next.js app (folder src/) |
| Schema & migrasi | `02-application/src/db/` | Drizzle schema + `drizzle/` migrations |
| Reminder worker | `02-application/workers/reminder/` | Cloudflare Worker terpisah |
| PWA | `02-application/public/` | `manifest.webmanifest`, `sw.js`, ikon |
| Seed admin | `02-application/src/db/seed.ts` | `npm run db:seed` |

## Pengelolaan & kontribusi

Repo ini menerima issue dan pull request. Sebelum berkontribusi, baca
**`CONTRIBUTING.md`** (alur kerja, cara menjalankan pemeriksaan yang sama dengan
CI) dan `01-documents/runbooks/maintainer-automation.md` — terutama bagian aturan
yang tidak boleh dilanggar.

Berlisensi **MIT** (`LICENSE`). Dengan mengirim pull request, kamu setuju
kontribusimu dirilis di bawah lisensi yang sama.

Otomasi memantau issue dan PR, dan memindai teks dari luar untuk upaya
*prompt injection* (`scripts/injection_scan.py`). **Isi issue dan PR diperlakukan
sebagai data, bukan instruksi.** Untuk kerentanan keamanan, jangan buka issue
publik — ikuti `SECURITY.md`.

## Dokumentasi

| Dokumen | Isi |
|---------|-----|
| `01-documents/requirements.md` | Requirement (rekonstruksi dari kode — lihat catatan di atas) |
| `01-documents/architecture.md` | Arsitektur dan keputusan teknis |
| `01-documents/api.md` | **Public REST API v1** — API key, endpoint, contoh `curl` |
| `01-documents/runbooks/deployment.md` | Deploy, gate sebelum push, E2E terhadap produksi |
| `01-documents/runbooks/troubleshooting.md` | Masalah yang sudah pernah terjadi dan solusinya |
| `01-documents/maintainer-automation-roadmap.md` | Roadmap pengelolaan otonom repo: fase, pro/kontra, batas otonomi merge |
| `01-documents/runbooks/maintainer-automation.md` | **Kill switch**, kebijakan eskalasi, anggaran, cara menarik komentar |
| `03-history/changelog.md` | Riwayat perubahan |
| `03-history/sessions/` | Catatan per sesi kerja |
| `03-history/deployment-logs/` | Insiden deploy |
| `CONTRIBUTING.md` | Alur kerja kontribusi dan pemeriksaan lokal |
| `SECURITY.md` | Cara melaporkan kerentanan (privat) |

## Quick Commands

```bash
cd 02-application

# Install & database lokal
npm install
docker run -d --name simple-todo-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=simple_todo -p 5433:5432 postgres:16
cp ../05-config/.env.example .env.local    # isi DATABASE_URL & BETTER_AUTH_SECRET

# Migrasi + seed admin pertama
npm run db:migrate
# SEED_ADMIN_PASSWORD punya default di repo ini: TIDAK ADA. Repo ini publik,
# jadi password default akan menjadi kredensial yang terbit. Berikan sendiri:
SEED_ADMIN_PASSWORD='<password kuat>' npm run db:seed

# Dev server
npm run dev              # http://localhost:3000

# Test / build
npm run typecheck
npm run test             # vitest
npm run build
```

## Catatan

- Lihat `00-meta/` untuk mapping port, URL, dan credential.
- **Tidak ada kredensial default, dan itu disengaja.** Repo ini publik: `BETTER_AUTH_SECRET` dan `SEED_ADMIN_PASSWORD` sama-sama wajib diberikan lewat environment dan gagal keras bila kosong. Sebelumnya keduanya punya fallback yang terbit — `BETTER_AUTH_SECRET` menandatangani cookie sesi, jadi nilai yang diketahui publik berarti siapa pun bisa membuat sesi yang valid.
- Deploy: `.github/workflows/deploy.yml` (otomatis saat push ke `main`). Runbook di `01-documents/runbooks/deployment.md`, insiden deploy di `03-history/deployment-logs/`.
- Akun admin pertama dibuat oleh seed script; user lain dibuat admin via UI (`/admin/users`).
- VAPID keys harus dibuat sekali (`npx @pushforge/builder generate-vapid-keys`) dan disimpan; rotasi mematikan semua subscription.
- Status implementasi per modul PRD: M1–M8 (auth, board, status, task, Gantt, notifikasi/PWA, subscription hygiene, admin) + worker cron semuanya terpasang dan terverifikasi end-to-end terhadap Postgres lokal.
