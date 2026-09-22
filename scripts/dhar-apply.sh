#!/usr/bin/env bash
# Dhar-only: hal-hal yang token GitHub Ame tidak boleh lakukan (semua 403
# "Resource not accessible by personal access token").
#
# Jalankan:  bash scripts/dhar-apply.sh
# Butuh:     gh CLI sudah login sebagai owner repo (soumabali)
#
# Semua perintah di bawah idempoten — aman dijalankan dua kali.

set -uo pipefail
REPO="soumabali/simple-todo"
DOMAIN="https://todo.nexigo.my.id"

hr() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }

# ---------------------------------------------------------------- 1. #22 BLOCKER
hr "1. Perbarui CLOUDFLARE_API_TOKEN (#22) — deploy produksi mati tanpa ini"
cat <<'EOF'
Ambil token baru: Cloudflare Dashboard -> My Profile -> API Tokens -> Create Token
  - Workers Scripts        : Edit
  - Account Settings       : Read     <- WAJIB; wrangler memanggil GET /accounts
  - Account Resources      : Include -> akun "Sudhar.journey@gmail.com's Account"

Lalu salah satu:
  gh secret set CLOUDFLARE_API_TOKEN --repo soumabali/simple-todo --body "<token>"
  # atau interaktif (tidak masuk shell history):
  gh secret set CLOUDFLARE_API_TOKEN --repo soumabali/simple-todo

Verifikasi (jalankan setelah set):
  gh workflow run deploy.yml --repo soumabali/simple-todo --ref main
  gh run watch --repo soumabali/simple-todo
EOF

# ------------------------------------------------------- 2. #2 metadata repo
hr "2. Metadata repo (#2)"
gh api -X PATCH "repos/$REPO" \
  -f description="Simple TODO — Next.js 15 + Drizzle + better-auth di Cloudflare Workers (OpenNext), Neon Postgres. Live: $DOMAIN" \
  -f homepage="$DOMAIN" >/dev/null && echo "  description + homepage: OK"

# Topics butuh endpoint terpisah + header khusus
gh api -X PUT "repos/$REPO/topics" \
  -H "Accept: application/vnd.github.mercy-preview+json" \
  -f names[]="nextjs" -f names[]="cloudflare-workers" -f names[]="opennext" \
  -f names[]="drizzle-orm" -f names[]="neon" -f names[]="better-auth" \
  -f names[]="typescript" -f names[]="tailwindcss" -f names[]="pwa" >/dev/null \
  && echo "  topics: OK"

# ---------------------------------------------------- 3. #3 branch protection
hr "3. Branch protection pada main (#3)"
if gh api -X PUT "repos/$REPO/branches/main/protection" \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["verify"] },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
then echo "  protection: OK"; else echo "  protection: GAGAL (lihat pesan di atas)"; fi
# Catatan: count=0 disengaja. "verify" sebagai required check sudah menahan merge
# yang gagal; menuntut approval manusia akan memblokir alur otonom (#7).
# "deploy" TIDAK dimasukkan: ia di-skip pada event pull_request, jadi ia tidak
# akan pernah muncul sebagai check yang lolos di PR -> merge jadi mustahil.
# Justru itu isi #22 butir 3: bikin jalur deploy terlihat dari PR dulu.

# ------------------------------------------------------------ 4. #4 identitas
hr "4. Identitas komentar otomasi (#4) — MASIH PERLU KEPUTUSANMU"
cat <<'EOF'
Tiga opsi, pilih satu (aku belum memutuskan karena ini soal akunmu):

 (a) Bot account terpisah (paling bersih)
     - bikin akun GitHub baru, undang sebagai collaborator (role: Write)
     - bikin PAT untuk akun itu, taruh sebagai secret AUTOMATION_TOKEN
     - ganti `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` -> AUTOMATION_TOKEN di workflow
     - komentar jadi milik akun bot, "ame-bot" dihapus dari footer
     - KOMENTAR LAMA (milikmu) tetap perlu ditandai manual

 (b) Tetap akunmu, tapi label jelas (termurah)
     - pertahankan footer <!-- ame-bot -->; hapus kata "ame-bot" dari teks publik
     - tambah baris: "Komentar ini diposting oleh otomasi atas nama @soumabali."
     - tidak ada akun baru; jejak audit tetap di akunmu

 (c) GitHub App
     - app dgn izin Issues:Write + Pull requests:Write, install ke repo
     - perlu server untuk menandatangani JWT — paling berat, paling rapi

Setelah kamu pilih, aku kerjakan implementasinya.
EOF

hr "SELESAI"
echo "  Setelah langkah 1, deploy jalan kembali dan produksi memuat perbaikan 500 (#19)."
