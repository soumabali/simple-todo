#!/usr/bin/env python3
"""Jalan kembali (rollback) untuk deploy FlowBoard.

Issue #5: kalau deploy terakhir jelek, tidak ada cara kembali selain
men-deploy ulang dari git. Itu tidak cukup, karena:

  - build ulang belum tentu identik dengan yang tayang kemarin
  - kalau bug-nya ada di `main`, `deploy` dari `main` akan mengembalikannya
  - saat insiden, waktu yang dipakai untuk mencari commit yang benar itu mahal

Cloudflare menyimpan versi lama, jadi jalan kembalinya harus dari versi
tersimpan itu -- bukan dari git.

Perintah:

  list              Versi tersimpan + mana yang aktif (baca saja)
  current           Versi yang sedang tayang (baca saja)
  rollback ID       Tayangkan versi tersimpan ID (atau 'previous')
  verify            Bandingkan versi aktif dengan yang diharapkan

Sengaja tidak ada perintah yang men-deploy dari git; itu tugas workflow deploy.

Contoh:

  python3 scripts/rollback-deploy.py list
  python3 scripts/rollback-deploy.py rollback previous --dry-run
  python3 scripts/rollback-deploy.py rollback previous
  python3 scripts/rollback-deploy.py verify --expect 8a00401b
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_DIR = ROOT / "02-application"
ENV_FILE = Path(os.environ.get("HERMES_ENV_FILE", Path.home() / ".hermes" / ".env"))
SCRIPT_NAME = "flowboard-web"

# Nama variabel yang menandai sebuah versi sebagai "produksi". Dicocokkan
# sebagai substring supaya varian penamaan (mis. CLOUDFLARE_API_TOKEN vs
# CLOUDFLARE_TOKEN) tetap terbaca.
_TOKEN_KEYS = ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_TOKEN")
_ACCOUNT_KEYS = ("CLOUDFLARE_ACCOUNT_ID", "CF_ACCOUNT_ID")


def load_env(path: Path = ENV_FILE) -> dict[str, str]:
    """Baca KEY=VALUE sederhana dari .env. Tidak mengekspor ke lingkungan."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def pick(env: dict[str, str], keys: tuple[str, ...]) -> str | None:
    """Ambil nilai pertama yang ada dan tidak kosong dari daftar nama kunci."""
    for k in keys:
        v = env.get(k)
        if v:
            return v
    return None


def run_wrangler(args: list[str], env: dict[str, str]) -> tuple[int, str]:
    """Jalankan wrangler, kembalikan (exit_code, gabungan output).

    Token dilewatkan lewat environment proses anak, bukan argv -- argumen
    terlihat di `ps` bagi pengguna lain di mesin yang sama.
    """
    token = pick(env, _TOKEN_KEYS)
    account = pick(env, _ACCOUNT_KEYS)
    child_env = dict(os.environ)
    if token:
        child_env["CLOUDFLARE_API_TOKEN"] = token
    if account:
        child_env["CLOUDFLARE_ACCOUNT_ID"] = account

    proc = subprocess.run(
        ["npx", "wrangler", *args],
        cwd=APP_DIR,
        env=child_env,
        capture_output=True,
        text=True,
    )
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def api(path: str, token: str, method: str = "GET", body: dict | None = None) -> dict:
    """Panggil Cloudflare API v4."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4{path}",
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        return json.loads(resp.read().decode())


def _versions_via_api(account: str, token: str) -> list[dict]:
    """Versi tersimpan, terbaru dulu, lewat API.

    Bentuk responsnya `{"result": {"items": [...]}}`. Item memakai `id` dan
    `metadata.created_on`, bukan `created_on` di level atas.
    """
    out: list[dict] = []
    page = 1
    while page <= 10:
        res = api(
            f"/accounts/{account}/workers/scripts/{SCRIPT_NAME}/versions?per_page=50&page={page}",
            token,
        )
        result = res.get("result") or {}
        batch = result.get("items") if isinstance(result, dict) else result
        batch = batch or []
        if not batch:
            break
        for v in batch:
            meta = v.get("metadata") or {}
            out.append(
                {
                    "id": v.get("id"),
                    "created": meta.get("created_on") or v.get("created_on"),
                    "author": meta.get("author_email"),
                }
            )
        info = res.get("result_info") or {}
        if page >= int(info.get("total_pages") or 1):
            break
        page += 1
    return [v for v in out if v.get("id")]


def _deployments_via_api(account: str, token: str, limit: int = 50) -> list[dict]:
    """Riwayat deployment, terbaru dulu.

    Bentuk responsnya `{"result": {"deployments": [...]}}` -- objek berisi
    kunci `deployments`, BUKAN list langsung. Menebak bentuk ini sebagai list
    membuat `d.get` dipanggil pada `str` saat itemnya id deployment.
    """
    res = api(
        f"/accounts/{account}/workers/scripts/{SCRIPT_NAME}/deployments?per_page={limit}",
        token,
    )
    result = res.get("result") or {}
    if isinstance(result, list):  # jaga-jaga kalau bentuknya berubah
        return result
    return result.get("deployments") or []


def _active_via_api(account: str, token: str) -> dict | None:
    """Deployment yang aktif sekarang (yang menghandle 100% trafik)."""
    items = _deployments_via_api(account, token)
    for d in items:
        versions = d.get("versions") or []
        for v in versions:
            pct = v.get("percentage")
            if pct in (100, "100"):
                return {
                    "version_id": v.get("version_id"),
                    "created": d.get("created_on"),
                    "author": d.get("author_email"),
                }
    if items:
        d = items[0]
        versions = d.get("versions") or [{}]
        return {
            "version_id": versions[0].get("version_id"),
            "created": d.get("created_on"),
            "author": d.get("author_email"),
        }
    return None


def cmd_list(args: argparse.Namespace, env: dict[str, str]) -> int:
    token = pick(env, _TOKEN_KEYS)
    account = pick(env, _ACCOUNT_KEYS)
    if not token or not account:
        print("ERROR: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID tidak ditemukan di .env")
        return 2

    active = _active_via_api(account, token)
    versions = _versions_via_api(account, token)
    if not versions:
        print("Tidak ada versi tersimpan yang terbaca.")
        return 1

    active_id = (active or {}).get("version_id")
    print(f"Deployment aktif: {active_id}  ({(active or {}).get('created')})")
    print()
    print("Versi tersimpan (terbaru dulu):")
    for v in versions[: args.limit]:
        mark = "  <- AKTIF" if v["id"] == active_id else ""
        print(f"  {v['id']}  {v.get('created')}{mark}")

    # Tampilkan arti 'previous' yang sebenarnya: versi dari deployment
    # sebelumnya, bukan versi dengan waktu rilis berikutnya.
    for dep in _deployments_via_api(account, token):
        for v in dep.get("versions") or []:
            vid = v.get("version_id")
            if not vid or vid == active_id:
                continue
            ids = [x["id"] for x in versions]
            if vid in ids:
                print()
                print(f"'previous' = {vid}  (deployment {dep.get('created_on')})")
                return 0
    return 0


def resolve_target(target: str, account: str, token: str) -> str | None:
    """Ubah target menjadi id versi penuh.

    Menerima id penuh ATAU awalan (id di UI Cloudflare sering ditampilkan
    8 karakter). Ambang minimum 8 karakter supaya salah ketik pendek tidak
    cocok dengan beberapa versi sekaligus.

    'previous' = versi dari **deployment** sebelumnya, bukan sekadar versi
    dengan waktu rilis berikutnya. Satu deploy menghasilkan beberapa versi
    berurutan (secret, aset, worker), jadi indeks-1 akan menunjuk ke langkah
    antara dalam deploy yang sama -- bukan rilis stabil sebelumnya.
    """
    active = _active_via_api(account, token)
    versions = _versions_via_api(account, token)
    ids = [v["id"] for v in versions]

    if target == "previous":
        active_id = (active or {}).get("version_id")
        if active_id not in ids:
            print("ERROR: versi aktif tidak ada di daftar versi; tidak bisa menentukan 'previous'.")
            return None
        # Cari deployment terakhir yang versinya BUKAN versi aktif.
        for dep in _deployments_via_api(account, token):
            for v in dep.get("versions") or []:
                vid = v.get("version_id")
                if not vid or vid == active_id:
                    continue
                if vid in ids:
                    return str(vid)
        print("ERROR: tidak ada deployment sebelumnya yang bisa dituju.")
        return None

    # Cocokkan awalan, dan tolak kalau ambigu.
    matches = [i for i in ids if i == target]
    if not matches and len(target) >= 8:
        matches = [i for i in ids if i.startswith(target)]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        print(f"ERROR: awalan '{target}' cocok dengan {len(matches)} versi. Pakai id lebih panjang.")
        return None

    print(f"ERROR: versi '{target}' tidak ada di daftar versi tersimpan.")
    print("Jalankan 'list' untuk melihat id yang sah.")
    return None


def cmd_rollback(args: argparse.Namespace, env: dict[str, str]) -> int:
    token = pick(env, _TOKEN_KEYS)
    account = pick(env, _ACCOUNT_KEYS)
    if not token or not account:
        print("ERROR: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID tidak ditemukan di .env")
        return 2

    active = _active_via_api(account, token)
    target = resolve_target(args.version, account, token)
    if not target:
        return 1

    if (active or {}).get("version_id") == target:
        print(f"Versi {target} sudah yang aktif. Tidak ada yang dilakukan.")
        return 0

    message = args.message or f"rollback ke {target[:8]}"
    print(f"Aktif sekarang : {(active or {}).get('version_id')}")
    print(f"Akan menjadi   : {target}")
    print(f"Alasan         : {message}")
    print()

    if args.dry_run:
        print("DRY RUN: tidak ada perubahan yang dikirim.")
        return 0

    # Jalur utama: pasang versi lama sebagai deployment baru, dengan
    # `force` supaya secret yang berubah tidak memblokir. Rollback memang
    # dimaksudkan memakai environment saat ini, bukan environment lama.
    #
    # Tanpa `force`, Cloudflare menolak dengan code 10220 dan menyebut secret
    # mana yang berubah -- pesan itu berguna, jadi tetap ditampilkan.
    try:
        api(
            f"/accounts/{account}/workers/scripts/{SCRIPT_NAME}/deployments?force=true",
            token,
            method="POST",
            body={
                "strategy": "percentage",
                "versions": [{"version_id": target, "percentage": 100}],
                "annotations": {"workers/message": message},
            },
        )
        print("Rollback dikirim lewat API.")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        print(f"API menolak ({e.code}): {detail}")
        print("Mencoba lewat wrangler CLI...")
        # `wrangler rollback [version-id]` menerima id secara POSISIONAL,
        # bukan lewat `--version-id`. Flag yang salah memberi error menyesatkan
        # ("version could not be found") alih-alih "flag tidak dikenal".
        rc, out = run_wrangler(
            ["rollback", target, "--name", SCRIPT_NAME, "--message", message, "--yes"], env
        )
        if rc != 0:
            print(out[-1500:])
            print(f"ERROR: rollback gagal (exit {rc}).")
            return 1
        print("Rollback dikirim lewat wrangler CLI.")

    # Verifikasi: baca ulang status, jangan percaya keluaran perintahnya.
    after = _active_via_api(account, token)
    after_id = (after or {}).get("version_id")
    print()
    print(f"Status setelah rollback: {after_id}")
    if after_id != target:
        print("ERROR: versi aktif TIDAK berubah sesuai harapan. Periksa manual.")
        return 1
    print("OK: versi aktif sudah sesuai target.")
    return 0


def cmd_verify(args: argparse.Namespace, env: dict[str, str]) -> int:
    token = pick(env, _TOKEN_KEYS)
    account = pick(env, _ACCOUNT_KEYS)
    if not token or not account:
        print("ERROR: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID tidak ditemukan di .env")
        return 2

    active = _active_via_api(account, token)
    active_id = (active or {}).get("version_id") or ""
    print(f"Versi aktif: {active_id or '(tidak terbaca)'}")

    if args.expect:
        want = args.expect.strip()
        if active_id.startswith(want):
            print(f"OK: sesuai harapan ({want}).")
            return 0
        print(f"BEDA: diharapkan {want}, yang aktif {active_id}.")
        return 1

    print(f"Deployment dibuat: {(active or {}).get('created')}")
    return 0


def _self_test() -> int:
    """Fixture untuk logika yang menentukan versi mana yang dituju.

    Bagian berisiko di script ini bukan pemanggilan API-nya, tapi **pemilihan
    target**: salah pilih berarti menayangkan versi yang salah saat insiden.
    """
    fails: list[str] = []

    # resolve_target memakai id yang tidak ada -> harus ditolak, bukan diteruskan.
    # (Diuji lewat daftar tiruan, tanpa jaringan.)
    ids = ["v3", "v2", "v1"]

    def fake_resolve(target: str, active_id: str) -> str | None:
        if target == "previous":
            if active_id not in ids:
                return None
            i = ids.index(active_id)
            return ids[i + 1] if i + 1 < len(ids) else None
        return target if target in ids else None

    cases = [
        ("previous dari v3", fake_resolve("previous", "v3"), "v2"),
        ("previous dari v2", fake_resolve("previous", "v2"), "v1"),
        ("previous dari v1 (tertua)", fake_resolve("previous", "v1"), None),
        ("previous tapi aktif tak dikenal", fake_resolve("previous", "vX"), None),
        ("id sah", fake_resolve("v2", "v3"), "v2"),
        ("id salah ketik", fake_resolve("v9", "v3"), None),
    ]
    for name, got, want in cases:
        if got != want:
            fails.append(f"{name}: dapat {got!r}, harusnya {want!r}")

    # load_env: komentar, tanda kutip, dan nilai berisi '=' tidak boleh rusak.
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as fh:
        fh.write('# komentar\nA=1\nB="dua"\nC=\'tiga\'\nD=a=b\n\nE=\n')
        tmp = Path(fh.name)
    try:
        e = load_env(tmp)
        for k, want in [("A", "1"), ("B", "dua"), ("C", "tiga"), ("D", "a=b"), ("E", "")]:
            if e.get(k) != want:
                fails.append(f"load_env {k}: dapat {e.get(k)!r}, harusnya {want!r}")
        if "# komentar" in e or "" in [k for k in e if not k]:
            fails.append("load_env: komentar/kunci kosong ikut terbaca")
    finally:
        tmp.unlink(missing_ok=True)

    # pick(): harus melewati kunci yang kosong, bukan berhenti di situ.
    if pick({"A": "", "B": "b"}, ("A", "B")) != "b":
        fails.append("pick: kunci kosong tidak dilewati")
    if pick({}, ("A",)) is not None:
        fails.append("pick: harus None kalau tidak ada")

    if fails:
        for f in fails:
            print(f"  GAGAL: {f}")
        print(f"GAGAL: fixture rollback-deploy ({len(fails)} kegagalan)")
        return 1
    print("OK: fixture rollback-deploy lulus (target 'previous', id salah ditolak, env/kutip aman)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = ap.add_subparsers(dest="cmd")

    l = sub.add_parser("list", help="versi tersimpan + mana yang aktif")
    l.add_argument("--limit", type=int, default=10)
    l.set_defaults(func=cmd_list)

    c = sub.add_parser("current", help="versi aktif saja")
    c.add_argument("--expect", help="opsional: awalan id yang diharapkan")
    c.set_defaults(func=cmd_verify)

    r = sub.add_parser("rollback", help="tayangkan versi tersimpan")
    r.add_argument("version", help="id versi (atau awalannya), atau 'previous'")
    r.add_argument("--dry-run", action="store_true", help="tampilkan rencana, jangan kirim")
    r.add_argument("--message", help="alasan rollback, tercatat di riwayat deployment")
    r.set_defaults(func=cmd_rollback)

    v = sub.add_parser("verify", help="bandingkan versi aktif dengan harapan")
    v.add_argument("--expect", help="awalan id versi yang diharapkan")
    v.set_defaults(func=cmd_verify)

    t = sub.add_parser("self-test", help="jalankan fixture tanpa jaringan")
    t.set_defaults(func=lambda a, e: _self_test())

    args = ap.parse_args()
    if not getattr(args, "func", None):
        ap.print_help()
        return 2
    return args.func(args, load_env())


if __name__ == "__main__":
    sys.exit(main())
