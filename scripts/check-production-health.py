#!/usr/bin/env python3
"""Periksa kesehatan produksi dari sumber yang bisa dipercaya.

Masalah yang script ini selesaikan: mengukur produksi dengan `curl` dari mesin
ini menghasilkan **false positive**. Host `*.nexigo.my.id` gagal 20-60% dari
sana sementara dari jaringan lain 12/12 @ ~14ms, dan Worker mencatat 0 error.
Pembeda yang pasti: **ada/tidaknya header `cf-ray`**.

    code=000  cf-ray=NO    <- tidak sampai edge Cloudflare; masalah jalur penguji
    code=200  cf-ray=YES   <- sampai edge; angka ini sah

Jadi ada dua mode, dan keduanya sengaja dipisah:

  --edge    Cek apakah permintaan kita sampai ke Cloudflare. Laporan utama
            adalah berapa yang punya `cf-ray`, BUKAN berapa yang 200.
  --errors  Sumber kebenaran sebenarnya: cari `Failed query` /
            INTERNAL_SERVER_ERROR di log Worker. Ini yang menentukan sehat
            tidaknya aplikasi, bukan status HTTP dari mesin ini.

Contoh:

    python3 scripts/check-production-health.py --errors --since 2026-09-21T15:59:00Z
    python3 scripts/check-production-health.py --edge --n 20

Untuk issue #19, kriteria penerimaannya adalah: `--errors` melaporkan nol
`Failed query` selama >= 24 jam sejak deploy perbaikan.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ENV_FILE = Path("/home/ubuntu/.hermes/.env")
SITE = "https://todo.nexigo.my.id"
SCRIPT = "flowboard-web"

# String yang menandakan kegagalan nyata di sisi aplikasi/DB — bukan sekadar
# status HTTP. `Failed query` berasal dari driver Neon; INTERNAL_SERVER_ERROR
# dari better-auth ketika query-nya gagal.
FAILURE_PATTERNS = (
    "Failed query",
    "INTERNAL_SERVER_ERROR",
    "Unhandled error",
    "Failed to get session",
)


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


def graphql(query: str, variables: dict, token: str) -> dict:
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/graphql",
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        return json.loads(resp.read().decode())


INVOCATIONS_QUERY = """
query($acct:String!, $from:String!, $to:String!) {
  viewer {
    accounts(filter:{accountTag:$acct}) {
      workersInvocationsAdaptive(limit:50, filter:{datetime_geq:$from, datetime_leq:$to}) {
        dimensions { scriptName status }
        sum { requests errors }
      }
    }
  }
}
"""


def cmd_analytics(args: argparse.Namespace, env: dict[str, str]) -> int:
    """Angka error dari Cloudflare — sumber kebenaran, bukan pengukuran klien."""
    token = env.get("CLOUDFLARE_API_TOKEN")
    acct = env.get("CLOUDFLARE_ACCOUNT_ID")
    if not token or not acct:
        print("GAGAL: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID tidak ada di .env")
        return 2

    now = datetime.now(timezone.utc)
    frm = args.since or (now - timedelta(hours=args.hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    to = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    data = graphql(INVOCATIONS_QUERY, {"acct": acct, "from": frm, "to": to}, token)
    if data.get("errors"):
        for e in data["errors"]:
            print("GraphQL:", e.get("message", "")[:200])
        return 2

    rows = (
        (data.get("data", {}).get("viewer", {}).get("accounts") or [{}])[0].get(
            "workersInvocationsAdaptive", []
        )
        or []
    )
    print(f"Workers analytics {frm} -> {to}")
    print()
    total_err = 0
    found = False
    for row in rows:
        dim = row.get("dimensions", {})
        name = dim.get("scriptName") or ""
        if SCRIPT not in name:
            continue
        found = True
        s = row.get("sum", {})
        total_err += s.get("errors", 0)
        print(f"  {name:20} {dim.get('status'):16} requests={s.get('requests'):>6} errors={s.get('errors')}")
    if not found:
        print(f"  (tidak ada invokasi untuk {SCRIPT} di jendela ini)")
    print()
    if total_err == 0:
        print("HASIL: 0 error pada sisi Worker.")
        print("Catatan: analytics Cloudflare hanya melaporkan *exception* yang lolos.")
        print("Untuk `Failed query` yang ditangani, pakai --errors (log Worker).")
        return 0
    print(f"HASIL: {total_err} error. Periksa log Worker.")
    return 1


def cmd_errors(args: argparse.Namespace, env: dict[str, str]) -> int:
    """Cari kegagalan nyata di log Worker.

    `wrangler tail` bersifat streaming dan hanya menangkap permintaan **selagi
    menempel**, jadi ia tidak bisa menjawab "apakah ada error sejak X". Karena
    itu script ini jujur soal batasnya: ia menempel selama `--watch` detik dan
    melaporkan apa yang lewat, bukan menghitung ulang masa lalu.

    Untuk jendela panjang, jalankan berulang atau pakai Workers Logs di
    dashboard. Klaim "nol error 24 jam" tidak boleh dibangun dari satu tail.
    """
    app_dir = Path(__file__).resolve().parent.parent / "02-application"
    if not app_dir.exists():
        print(f"GAGAL: {app_dir} tidak ada")
        return 2

    print(f"Menempel ke {SCRIPT} selama {args.watch}s (streaming, bukan kueri historis)...")
    if args.since:
        print(f"  (argumen --since={args.since} dicatat untuk laporan; tail tidak bisa")
        print("   membaca masa lalu — jendela ini hanya mencakup saat menempel.)")
    print()

    # PENTING (dua jebakan yang sudah memakan waktu):
    #
    # 1. `wrangler tail` adalah stream. `subprocess.run(timeout=...)` menunggu
    #    proses selesai lalu mematikan buffernya, dan kill-nya membuang apa pun
    #    yang belum ditulis -> lapor "0 event" padahal ada trafik.
    # 2. Meski `--format json`, keluarannya **pretty-printed dan multi-baris**
    #    (`{\n  "wallTime": 23,\n ...`), BUKAN satu objek per baris. Parser
    #    per-baris menolak semuanya secara diam-diam -> lagi-lagi "0 event".
    #
    # Jadi: baca selagi mengalir, lalu susun ulang objeknya dengan menghitung
    # kurung kurawal. Kegagalan senyap di sini persis jenis yang script ini
    # ada untuk mencegah, jadi jangan diganti dengan parser per-baris.
    # 3. `npx` menjalankan wrangler sebagai ANAK (`npx` -> node .bin/wrangler ->
    #    node wrangler-dist/cli.js). `terminate()` pada parent-nya meninggalkan
    #    cucu-cucunya hidup, dan mereka tetap memegang ujung pipe sehingga
    #    `readline()` tidak pernah EOF -> script menggantung melewati jendelanya.
    #    Karena itu prosesnya dimulai di **process group** sendiri dan yang
    #    dihentikan adalah seluruh grup (`killpg`).
    # `events: list[dict] = []` dihapus; objeknya disusun setelah proses berhenti.
    proc = subprocess.Popen(
        ["npx", "wrangler", "tail", SCRIPT, "--format", "json"],
        cwd=app_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
        start_new_session=True,
    )

    def _stop_tree() -> None:
        """Hentikan seluruh process group, bukan hanya npx."""
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            try:
                proc.terminate()
            except Exception:
                pass

    assert proc.stdout is not None

    # Akumulasi teks mentahnya, lalu susun objeknya dengan `_parse_stream` yang
    # punya fixture sendiri. Versi _feed yang ditulis di sini dulu adalah salinan
    # tak-teruji dari logika yang sama -- dua implementasi berarti satu di
    # antaranya bisa rusak tanpa ketahuan.
    raw: list[str] = []

    # `readline()` memblokir tanpa batas ketika tidak ada output, sehingga
    # `while time.monotonic() < deadline` tidak pernah dievaluasi lagi dan script
    # menggantung melewati jendelanya. Watchdog ini yang menghentikan prosesnya,
    # jadi loop di bawah selalu berakhir tepat waktu.
    stop_at = time.monotonic() + args.watch

    def _watchdog() -> None:
        while time.monotonic() < stop_at:
            time.sleep(0.5)
        _stop_tree()

    watcher = threading.Thread(target=_watchdog, daemon=True)
    watcher.start()

    try:
        while True:
            chunk = proc.stdout.readline()
            if not chunk:
                if proc.poll() is not None:
                    break
                continue
            raw.append(chunk)
            if time.monotonic() >= stop_at:
                break
    finally:
        _stop_tree()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                proc.kill()

    events = _parse_stream("".join(raw))
    print(f"  {len(events)} event tertangkap dari {len(''.join(raw))} byte keluaran")
    # Bedakan "tidak ada error" dari "tidak pernah terhubung". Tanpa ini, nol
    # event mudah dibaca sebagai sehat -- padahal bisa berarti tail-nya tidak
    # sempat tersambung sama sekali.
    if len(events) == 0:
        print()
        print("  PERINGATAN: 0 event. `wrangler tail` butuh ~11s untuk terhubung;")
        print("  jendela yang terlalu pendek bisa berakhir sebelum satu pun masuk.")
        print("  Ini BUKAN bukti aplikasi sehat. Pakai --watch lebih lama, atau")
        print("  andalkan `analytics` untuk angka error.")
    hits = []
    for ev in events:
        blob = json.dumps(ev)
        for pat in FAILURE_PATTERNS:
            if pat in blob:
                stamp = ev.get("eventTimestamp") or ev.get("timestamp") or "?"
                url = ((ev.get("event") or {}).get("request") or {}).get("url", "")
                hits.append((stamp, pat, url))
                break

    if not hits:
        print("  tidak ada pola kegagalan terlihat selama menempel.")
        if len(events) == 0:
            print()
            print("  PERINGATAN: 0 event berarti tidak ada trafik yang teramati,")
            print("  BUKAN berarti aplikasi sehat. Jangan jadikan ini bukti.")
        return 0

    print(f"  {len(hits)} baris mengandung pola kegagalan:")
    for stamp, pat, url in hits[:40]:
        print(f"    {stamp}  {pat:22}  {url[:70]}")
    return 1


def cmd_edge(args: argparse.Namespace, env: dict[str, str]) -> int:
    """Apakah permintaan kita sampai ke edge? Yang dihitung: `cf-ray`."""
    print(f"{SITE} — {args.n} permintaan, fokus pada header cf-ray")
    print()
    reached = 0
    blocked = 0
    for i in range(1, args.n + 1):
        hdr = Path(f"/tmp/.health-hdr-{os.getpid()}")
        code = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
             "--max-time", str(args.timeout), "-D", str(hdr),
             "-A", "Mozilla/5.0", f"{SITE}{args.path}"],
            capture_output=True, text=True,
        ).stdout.strip()
        ray = "NO"
        if hdr.exists():
            ray = "YES" if "cf-ray" in hdr.read_text(errors="replace").lower() else "NO"
            hdr.unlink()
        reached += ray == "YES"
        blocked += ray == "NO"
        print(f"  {i:>3}. code={code:<4} cf-ray={ray}")
    print()
    print(f"sampai edge : {reached}/{args.n}")
    print(f"tidak sampai: {blocked}/{args.n}   <- ini masalah jalur penguji, bukan aplikasi")
    print()
    if blocked == 0:
        print("HASIL: jalur penguji bersih; angka HTTP di sini bisa dipercaya.")
        return 0
    print("HASIL: jalur penguji TIDAK bisa dipercaya. Jangan simpulkan status")
    print("produksi dari mesin ini — pakai --errors atau Workers analytics.")
    return 1


def _self_test() -> int:
    """Fixture untuk jebakan yang sudah terbukti memakan waktu.

    Yang dijaga di sini bukan "apakah kode jalan", tapi tiga kegagalan senyap
    yang persis jenis yang script ini ada untuk mencegah:

      1. Parser per-baris atas keluaran `wrangler tail`. Keluarannya
         pretty-printed multi-baris, jadi parser per-baris menolak SEMUA event
         dan melaporkan "0 event" -- yang gampang dibaca sebagai "sehat".
      2. String JSON yang mengandung kurung kurawal di dalam nilai, yang bisa
         memecah penghitung kedalaman kalau tidak dikutip dengan benar.
      3. Beberapa objek berurutan dalam satu aliran, tanpa pemisah.
    """
    failures: list[str] = []

    def check(label: str, got: object, want: object) -> None:
        if got != want:
            failures.append(f"  {label}: expected {want!r}, got {got!r}")

    # Keluaran nyata wrangler (dipotong), sengaja diberi jeda antar-objek seperti
    # yang keluar dari stream.
    stream = (
        '{\n  "wallTime": 23,\n  "event": {"request": {"url": "https://x/login"}},\n'
        '  "outcome": "ok"\n}\n'
        '{\n  "wallTime": 41,\n  "event": {"request": {"url": "https://x/api/boards"}},\n'
        '  "logs": [{"message": ["teks dengan { kurung } di dalamnya"]}]\n}\n'
        'ruang-isi yang harus diabaikan sepenuhnya\n'
    )
    objs = _parse_stream(stream)
    check("dua objek tersusun dari stream multi-baris", len(objs), 2)
    check(
        "url objek pertama terbaca",
        (objs[0].get("event") or {}).get("request", {}).get("url"),
        "https://x/login",
    )
    check(
        "kurung di dalam string tidak memecah penghitung",
        bool(objs[1].get("logs")),
        True,
    )

    # Objek yang cacat harus dilewati, bukan menggagalkan seluruh aliran.
    check("objek cacat dilewati", len(_parse_stream('{"a": }\n{"b": 1}\n')), 1)

    # Keluaran kosong -> nol objek. Ini yang harus dibedakan pemanggil dari
    # "tidak ada error", dan itu tanggung jawab cmd_errors (lihat peringatannya).
    check("stream kosong", len(_parse_stream("")), 0)

    if failures:
        print(f"FAIL: {len(failures)} fixture check-production-health gagal")
        print("\n".join(failures))
        return 1
    print("OK: fixture check-production-health lulus (stream multi-baris tersusun, kurung dalam string aman, objek cacat dilewati, stream kosong = 0)")
    return 0


def _parse_stream(text: str) -> list[dict]:
    """Susun objek JSON dari aliran berisi beberapa objek.

    `wrangler tail --format json` mengeluarkan objek **pretty-printed
    multi-baris** (`{\\n  "wallTime": 23,\\n ...`), **bukan** satu objek per
    baris, dan beberapa objek datang berurutan tanpa pemisah. Parser per-baris
    menolak semuanya secara diam-diam dan melaporkan "0 event" -- yang mudah
    disalahartikan sebagai "tidak ada error".

    Jadi objek disusun dengan menghitung kedalaman kurawal. Kurung di dalam
    string ditangani dengan melacak status kutip dan escape, karena tanpanya
    sebuah `{` di dalam pesan log akan memecah penghitungan.
    """
    out: list[dict] = []
    buf: list[str] = []
    depth = 0
    started = False
    in_str = False
    escaped = False

    for ch in text:
        if not started:
            if ch == "{":
                started, depth, buf = True, 1, ["{"]
                in_str, escaped = False, False
            continue

        buf.append(ch)
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    out.append(json.loads("".join(buf)))
                except json.JSONDecodeError:
                    pass
                started, buf = False, []

    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd")

    t = sub.add_parser("self-test", help="jalankan fixture parser")
    t.set_defaults(func=lambda a, e: _self_test())

    a = sub.add_parser("analytics", help="error dari Workers analytics (default: 24 jam)")
    a.add_argument("--hours", type=int, default=24)
    a.add_argument("--since", help="awal jendela ISO, mis. 2026-09-21T15:59:00Z")
    a.set_defaults(func=cmd_analytics)

    e = sub.add_parser("errors", help="pola kegagalan dari log Worker (streaming)")
    e.add_argument("--watch", type=int, default=120,
                   help="lama menempel, detik. Bawaannya 120 karena `wrangler tail` "
                        "butuh ~11s untuk terhubung; jendela pendek menghabiskan "
                        "sebagian besar waktunya untuk handshake dan akan melihat "
                        "sedikit/0 event.")
    e.add_argument("--since", help="hanya untuk catatan laporan")
    e.set_defaults(func=cmd_errors)

    g = sub.add_parser("edge", help="apakah permintaan sampai edge (cf-ray)")
    g.add_argument("--n", type=int, default=20)
    g.add_argument("--path", default="/login")
    g.add_argument("--timeout", type=int, default=10)
    g.set_defaults(func=cmd_edge)

    args = ap.parse_args()
    if not getattr(args, "func", None):
        ap.print_help()
        return 2
    env = load_env()
    return args.func(args, env)


if __name__ == "__main__":
    sys.exit(main())
