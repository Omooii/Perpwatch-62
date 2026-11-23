#!/usr/bin/env python3
"""Drive the Even Hub simulator's headless automation API.

Usage (simulator must be running with --automation-port 9898):
  sim-test.py ping                  health check
  sim-test.py console               dump webview console entries
  sim-test.py shot <name>           save glasses framebuffer to screenshots/<name>.png
  sim-test.py webview <name>        save webview screenshot to screenshots/<name>.png
  sim-test.py input <action>        up|down|click|double_click|long_press|long_press_release|context_menu
  sim-test.py journey               scripted Day-1 journey with screenshots at each step
  sim-test.py view                  composite all shots onto black (view-*.png) —
                                    framebuffer PNGs are RGBA with the text in the alpha channel,
                                    so raw shots look solid green

Requires the simulator to have loaded the app (vite dev server on :5173).
"""
import io
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:9898"
SHOTS = Path(__file__).resolve().parent.parent / "screenshots"
SHOTS.mkdir(exist_ok=True)

READY_MARKER = "PerpWatch: startup page created: success"


def get_json(path: str):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=30) as r:
        return json.loads(r.read())


def get_bytes(path: str) -> bytes:
    with urllib.request.urlopen(f"{BASE}{path}", timeout=30) as r:
        return r.read()


def post_json(path: str, body: dict):
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def wait_ready(timeout: float = 60.0) -> None:
    deadline = time.time() + timeout
    since_id = 0
    while time.time() < deadline:
        data = get_json(f"/api/console?since_id={since_id}")
        for entry in data.get("entries", []):
            since_id = max(since_id, entry.get("id", 0))
            if READY_MARKER in entry.get("message", ""):
                return
        time.sleep(0.5)
    raise TimeoutError(f"app did not log {READY_MARKER!r} within {timeout}s")


def shot(name: str, kind: str = "glasses") -> Path:
    data = get_bytes(f"/api/screenshot/{kind}")
    path = SHOTS / f"{name}.png"
    path.write_bytes(data)
    print(f"{kind} screenshot -> {path} ({len(data)} bytes)")
    return path


def do_input(action: str, settle: float = 1.0) -> None:
    post_json("/api/input", {"action": action})
    print(f"input: {action}")
    time.sleep(settle)


def console_dump() -> None:
    data = get_json("/api/console")
    print(f"console entries: {data.get('total')}")
    for e in data.get("entries", []):
        print(f"  [{e.get('id')}] {e.get('level', '?')}: {e.get('message', '')}")


def journey() -> None:
    wait_ready()
    time.sleep(2)  # let the first fetch land and the home page rebuild
    shot("01-home")
    do_input("click")  # select first position -> detail
    shot("02-detail")
    do_input("context_menu")  # detail menu: Chart, Positions, Refresh
    shot("02b-menu-detail")
    do_input("click")  # first item = Chart
    time.sleep(3)  # candle fetch + sparkline render
    shot("09-chart")
    do_input("click")  # back to detail
    shot("10-detail-again")
    do_input("click")  # back home
    shot("03-home-again")
    do_input("down")  # focus 2nd row
    do_input("click")  # detail of 2nd position (tests non-zero index)
    shot("03b-detail-2nd")
    do_input("click")  # back home
    do_input("context_menu")
    shot("04-menu")
    do_input("down")  # focus "Prices" (menu: Funding, Prices, Refresh)
    do_input("click")  # open Prices
    shot("05-prices")
    do_input("click")  # back home
    do_input("context_menu")
    shot("06-menu-again")
    do_input("click")  # first item = Funding
    shot("07-funding")
    do_input("click")  # back home
    shot("08-home-final")
    print("journey done")


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1]
    if cmd == "ping":
        print(get_json("/api/ping"))
    elif cmd == "console":
        console_dump()
    elif cmd == "shot":
        wait_ready()
        shot(sys.argv[2] if len(sys.argv) > 2 else "shot")
    elif cmd == "webview":
        wait_ready()
        shot(sys.argv[2] if len(sys.argv) > 2 else "webview", kind="webview")
    elif cmd == "input":
        post_json("/api/input", {"action": sys.argv[2]})
        print(f"input: {sys.argv[2]}")
    elif cmd == "journey":
        journey()
    elif cmd == "view":
        for p in sorted(SHOTS.glob("*.png")):
            if p.name.startswith("view-"):
                continue
            out = SHOTS / f"view-{p.name}"
            subprocess.run(
                [
                    "ffmpeg", "-y", "-v", "error",
                    "-f", "lavfi", "-i", "color=c=black:s=576x288",
                    "-i", str(p),
                    "-filter_complex", "[0:v][1:v]overlay=0:0",
                    "-frames:v", "1", str(out),
                ],
                check=True,
            )
            print(f"view -> {out}")
    else:
        print(f"unknown command: {cmd}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
