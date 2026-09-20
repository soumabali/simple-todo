# Deployment Logs

Catatan deploy ke production (`https://todo.nexigo.my.id`). Satu berkas per
insiden atau tonggak, dinamai `YYYY-MM-DD-<judul>.md`.

## Konvensi

Berkas di sini ditulis saat sesuatu **gagal**, atau saat sebuah tonggak rilis
layak dikenang. Deploy rutin yang hijau tidak perlu dicatat — riwayatnya sudah
ada di GitHub Actions (`gh run list`).

Setiap catatan berisi:

- **Gejala** — apa yang terlihat dari luar (step mana yang merah).
- **Penyebab** — akar masalahnya, dengan bukti (commit, diff, pesan error).
- **Perbaikan** — apa yang diubah, dan commit mana yang membawanya.
- **Pelajaran** — aturan yang mencegah kejadian yang sama terulang.

## Cara memeriksa status deploy

```bash
gh run list --workflow=Deploy --limit 10          # riwayat
gh run view <run-id>                              # ringkasan + job
gh api repos/soumabali/simple-todo/actions/runs/<run-id>/jobs \
  | python3 -c "import json,sys;d=json.load(sys.stdin);[print(j['name'],'|',s['name'],'->',s['conclusion']) for j in d['jobs'] for s in j['steps']]"
```

`gh run view <id> --log` **tidak andal untuk run yang sangat lama** — pernah
mengembalikan output kosong untuk run 19 Sep di mesin ini. Endpoint API
`/jobs` tetap memberi status per step, dan itu biasanya sudah cukup untuk
menemukan step yang gagal.

## Daftar

| Tanggal | Berkas | Ringkas |
|---|---|---|
| 2026-09-19 | [ci-launch-blockers.md](2026-09-19-ci-launch-blockers.md) | Dua deploy pertama gagal: batas plan Neon (`HTTP 422`) lalu Node 20 vs wrangler 4.130 |
