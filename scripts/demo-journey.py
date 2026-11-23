#!/usr/bin/env python3
"""Slow scripted journey for the demo video.

Drives the simulator's automation API with long holds per screen so a
viewer can read each one. Run while ffmpeg records the X display:
  ffmpeg -f x11grab -draw_mouse 0 -s 1280x900 -i :99 ... (see demo/RECORDING.md)
"""
import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:9898"
READY_MARKER = "PerpWatch: startup page created: success"


def get_json(path: str):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=30) as r:
        return json.loads(r.read())


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
    raise TimeoutError("app did not start in the simulator")


def do(action: str, hold: float, note: str) -> None:
    post_json("/api/input", {"action": action})
    print(f"[{time.strftime('%H:%M:%S')}] {action} -> {note} (hold {hold}s)", flush=True)
    time.sleep(hold)


def hold(seconds: float, note: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] hold {seconds}s: {note}", flush=True)
    time.sleep(seconds)


def main() -> int:
    wait_ready()
    time.sleep(3)  # first fetch lands, home page rebuilds
    hold(8, "HOME: positions list, distance to liquidation as the hero number")
    do("click", 8, "DETAIL: ETH position — entry, mark, liq, margin, PnL, ROE")
    do("context_menu", 2, "detail menu opens (Chart / Positions / Refresh)")
    do("click", 4, "CHART: candles loading")
    hold(9, "CHART: 24h sparkline + dashed entry line")
    do("click", 3, "back to detail")
    do("click", 3, "back home")
    do("down", 1, "focus 2nd row (LIT)")
    do("click", 8, "DETAIL: LIT position — no liq price, cross margin")
    do("click", 2, "back home")
    do("context_menu", 2, "home menu opens")
    do("down", 1, "focus Prices")
    do("click", 8, "PRICES: mark + 24h change")
    do("click", 2, "back home")
    do("context_menu", 2, "home menu opens")
    do("click", 8, "FUNDING: 8h rates — pay or receive per position")
    do("click", 6, "back home — end of demo")
    print("demo journey done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
