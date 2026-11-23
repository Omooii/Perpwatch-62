# PerpWatch — DoraHacks submission pack

Even Realities "Heads Up" Hackathon · **Crypto & DeFi track** · Solo entry by Abi Tatang
Build week 23–29 Nov 2026 · **Deadline: Mon 30 Nov 2026, 02:59 WIB**

## Status

- [x] App built, tested in the Even Hub simulator, packaged as `.ehpk`
- [x] Demo video recorded (91s, ≤3 min) — `demo/demo-video.mp4`
- [ ] Public GitHub repo — **Tatang creates it** (GitHub App cannot create repos)
- [ ] Push this tree to the repo (after Tatang creates it)
- [ ] Upload `demo/demo-video.mp4` to YouTube (public) — **Tatang's account**
- [ ] Submit on DoraHacks with the texts below

## Short description (for the submission form)

PerpWatch is a liquidation-risk monitor for Hyperliquid perpetuals on Even G2 glasses: one glance shows every open position, its distance to liquidation as the hero number, funding costs, and a 24h sparkline — plus Telegram push alerts when a position drifts toward liquidation. Read-only, no wallet, no keys, no advice.

## Long description

Perpetual futures traders live or die by one number: how far price is from their liquidation. Checking it means pulling out a phone, opening an app, and reading a dense table — too slow when the market moves fast, and impossible while driving, working, or walking.

PerpWatch puts that number on your glasses. It watches any Hyperliquid address (account data is public, so no wallet connection or keys are needed) and shows, on the 576×288 monochrome lens:

- **Positions** — every open position with side, leverage, and distance to liquidation. Brightness encodes risk: bright = safe, dim + `!`/`!!` = close to liquidation.
- **Detail** — tap a position for entry, mark, liquidation price, margin, PnL, ROE, and cumulative funding.
- **Chart** — a 24h sparkline with dashed lines for the position's entry price and liquidation price.
- **Funding** — the 8h funding rate per position and what you pay (or receive) every 8 hours.
- **Prices** — mark price + 24h change for watched coins.
- **Alert state** — when the nearest position falls inside the user's threshold, the home footer becomes a bright `!! ALERT` line, and a companion Telegram bot sends a push alert (warning below the threshold, critical below half of it, recovered once the price moves back — one message per episode, no spam).

Data refreshes every 30s. Double-tap exits from anywhere.

**Safety by design:** the app only reads Hyperliquid's public Info API. It never places orders, signs transactions, holds funds, or asks for a seed phrase or private key. It reports facts — never buy/sell advice. The optional Telegram bot token is entered by the user in the companion page and stored only on their device; it is never committed or sent anywhere except `api.telegram.org`.

**Demo data:** the video shows a public Hyperliquid leaderboard wallet with open positions. No private account data appears anywhere.

## How to run

```bash
git clone <repo-url>
cd perpwatch
npm install
npm run dev        # Vite dev server on http://localhost:5173
npm run simulate   # Even Hub simulator (no glasses needed)
```

On real G2 glasses: `npx evenhub qr --url http://<your-ip>:5173`, scan with the Even Realities app. Packaged build: `npm run pack` → `perpwatch-0.1.0.ehpk`.

## Tech

TypeScript + Vite, Even Hub SDK 0.0.16, Hyperliquid public Info API (`metaAndAssetCtxs`, `clearinghouseState`, `candleSnapshot`), Telegram Bot API (optional alerts). Tested with the simulator's automation API (scripted journey + screenshots), Node unit tests for the alert engine and sparkline geometry, and Playwright for the companion page. See the README's Testing section.

## Links

- Repo: https://github.com/Omooii/Perpwatch-62
- Demo video: https://youtu.be/VQGLBMEkRKs
- Packaged app: `perpwatch-0.1.0.ehpk` (45 KB, in the repo root after packing)

## Feature requests for the Even Hub platform (5)

Real issues found while building PerpWatch:

1. **List click events should always carry the selected index.** A tap on the first row (index 0) arrives with `currentSelectItemIndex` missing, because protobuf omits zero-valued fields. Apps must guess that "missing index" means row 0. Please send the index explicitly (or document the omission in the SDK reference).
2. **Document which envelope taps arrive in.** Taps on text containers arrive via `sysEvent`, not `textEvent` (scroll gestures use `textEvent`). The docs don't state this; every developer discovers it by debugging. One line in the events reference would save hours.
3. **Let image containers capture input.** Image containers cannot set `isEventCapture`, so any screen with an image needs a full-screen invisible text layer just to catch taps. Allowing event capture on image containers would remove that workaround.
4. **Simulator automation API: add WebView interaction.** The API can screenshot the companion WebView but cannot click or type in it, so companion-page flows (settings, bot linking) can't be tested headlessly. Even a simple `POST /api/webview/click` + `type` would unlock full end-to-end tests.
5. **Simulator: add a hardware-accurate 4-bit greyscale preview.** The simulator renders images noticeably brighter and flatter than the real 16-shade panel, so contrast and dithering choices can't be validated without hardware. A "hardware-accurate" rendering toggle would close that gap.

**Bug found (not a feature request):** the `@evenrealities/evenhub-simulator` npm package declares an `evenhub-simulator` bin, but no link is created in `node_modules/.bin` on install, so `npx evenhub-simulator` fails — the entry must be invoked directly as `node node_modules/@evenrealities/evenhub-simulator/bin/index.js`.
