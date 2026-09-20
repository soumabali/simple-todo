# Architecture Decision Records (ADR)

## ADR-001: Lisensi MIT

- **Status:** accepted (2026-09-20)
- **Konteks:** Repo `soumabali/simple-todo` dibuka untuk issue dan pull request
  publik, tetapi tidak punya berkas `LICENSE`. Tanpa lisensi, hak cipta default
  berlaku: *all rights reserved* — orang luar tidak punya izin memakai atau
  menyalin kode. Lebih penting, menerima PR ke repo tanpa lisensi membuat
  kontribusi itu masuk tanpa izin yang jelas (masalah *inbound=outbound*).
  Diperiksa juga: dari 19 repo `soumabali`, tidak satu pun punya LICENSE, jadi
  ini keputusan yang belum pernah diambil, bukan berkas yang terlupa.
- **Keputusan:** MIT. Alternatif AGPL-3.0 ditolak karena proyek ini aplikasi
  self-hosted, bukan layanan jaringan — syarat "perubahan harus tetap terbuka"
  pada AGPL tidak memberi manfaat yang sepadan dengan tambahan kerumitannya.
- **Konsekuensi:** Kontribusi dari luar dapat diterima dengan aman. Pemegang hak
  cipta ditulis `soumabali` (login GitHub, publik dan terverifikasi); ganti bila
  kelak perlu nama legal. Berkas `LICENSE` di root, dan `license: "MIT"` pada
  `package.json` harus tetap sinkron.

## ADR-900: Judul Keputusan

- **Status:** proposed | accepted | deprecated
- **Konteks:**
- **Keputusan:**
- **Konsekuensi:**
