# PerpWatch

A liquidation-risk monitor for perpetual futures traders, on Even G2 smart glasses. One glance tells you whether your Hyperliquid positions are safe, how far price is from your liquidation, and what funding is costing you — without pulling your phone out.

Built for the **Even Realities "Heads Up" Hackathon** (DoraHacks, 23–29 Nov 2026), **Crypto & DeFi** track. Solo entry by Abi Tatang.

## What it shows (576×288 monochrome lens)

- **Positions** — every open position: side, leverage, entry, mark, unrealised PnL, and **distance to liquidation as the hero number**. Brightness encodes risk: bright = safe, dim + `!` glyph = close to liquidation.
- **Detail** — tap a position for margin used, liquidation price, ROE, and cumulative funding.
- **Chart** — 24h sparkline (15m candles) with dashed reference lines for the position's entry price and liquidation price, plus the 24h range.
- **Funding** — 8h funding rate per position and what you pay (or receive) per 8h.
- **Prices** — mark price + 24h change for watched coins.
- **Alert state** — when the nearest position falls inside the alert threshold, the home footer becomes a bright `!! ALERT {coin} liq {dist}%` line, and the companion Telegram bot sends a push alert (warning below the threshold, critical below half of it, recovered past threshold + 2% hysteresis — one message per episode, no spam).

Data refreshes every 30s while the app is open. Double-tap exits from anywhere.

## Read-only and safe by design

- The app only **reads** Hyperliquid's public Info API (`api.hyperliquid.xyz/info`). Any address's positions are public on Hyperliquid, so watching an address needs no wallet connection, no signing, and no keys.
- It **never** places orders, signs transactions, holds funds, or asks for a seed phrase or private key.
- It reports **facts** (prices, distances, funding) — never buy/sell advice.
- The optional Telegram bot token is stored only in on-device key-value storage, never committed, and only ever sent to `api.telegram.org`.

## Setup

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173
```

Then either:

- **Simulator (no glasses needed):** `npm run simulate`
- **Real G2 glasses:** `npx evenhub qr --url http://<your-ip>:5173` and scan the QR code with the Even Realities app.

On first run the app watches a public demo address (a Hyperliquid leaderboard wallet with open positions). Change it in the companion page on your phone: paste any `0x…` Hyperliquid address and tap **Watch this address**. The alert threshold and Telegram bot token are set there too.

## Pack for distribution

```bash
npm run pack
```

Produces a `.ehpk` file (built web assets + `app.json` manifest).

## Project layout

| File | Purpose |
|---|---|
| `index.html` | WebView host + companion settings page (watched address, alert threshold, Telegram token + chat link, active alerts). |
| `src/main.ts` | App entry: bridge setup, screen navigation, event routing, 30s polling loop, Telegram alert dispatch. |
| `src/hyperliquid.ts` | Read-only Hyperliquid Info API client (markets, positions, candles) + liquidation-distance / risk math. |
| `src/screens.ts` | Lens screen builders (positions list, detail, chart, funding, prices). Pure functions over a snapshot. |
| `src/sparkline.ts` | 24h sparkline geometry (pure, unit-tested) + canvas PNG renderer for the lens image container. |
| `src/alerts.ts` | Telegram alert engine (warning / critical / recovered, hysteresis, one alert per episode). Pure, unit-tested. |
| `src/telegram.ts` | Telegram Bot API client (sendMessage, getUpdates chat linking). Token from on-device storage only. |
| `src/format.ts` | Number formatting for the lens display. |
| `scripts/sim-test.py` | Simulator automation harness: scripted journey with screenshots, console dump, screenshot viewer. |
| `app.json` | Even Hub manifest. Network whitelist: `api.hyperliquid.xyz`, `api.telegram.org`. |

## Testing

- **Simulator journey** (`python3 scripts/sim-test.py journey`): drives the real Even Hub simulator over its automation API — home → detail → chart → funding → prices → menu, with a screenshot at every step (see `screenshots/`). All screens verified rendering with live Hyperliquid data.
- **Unit tests (Node, no DOM needed):** alert engine (11 checks: crossing, escalation, hysteresis, recovery, re-cross, closed position, null liq), sparkline geometry (real 24h ETH candles: bounds, monotonic x, in/out-of-range reference lines, flat input), home footer states (alert / safe / no positions).
- **Companion page (Playwright):** settings validation paths, Telegram link/test guidance, companion-only fallback (3 failed lens creates → companion view, positions still shown).
- **Telegram client:** request construction verified against the live Bot API (dummy token → `401 Unauthorized` surfaced correctly). A live success test needs a real bot token, entered by the user in the companion page.
- **Packaging:** `npm run pack` produces `perpwatch-0.1.0.ehpk` (45 KB, no warnings, min_app_version 2.2.10).

## What existed before 23 Nov 2026 (hackathon disclosure)

Per the hackathon rules, everything below predates the build week and was **not** written for this entry:

- The **Even Hub `minimal` template** (`even-realities/evenhub-templates`, MIT) — the Vite + TypeScript scaffold this project started from.
- The **Even Hub SDK / CLI / simulator** (`@evenrealities/even_hub_sdk`, `@evenrealities/evenhub-cli`, `@evenrealities/evenhub-simulator`) and their dependencies (Vite, TypeScript).
- The **Hyperliquid public Info API** and the **Telegram Bot API** — third-party services the app reads / calls; no code from them is included.
- All application code in `src/`, the lens layouts, the risk math, and this README were written during the hackathon (23–29 Nov 2026).

## Demo data

The demo video shows a public Hyperliquid leaderboard address. No private account data appears anywhere in the app, video, or screenshots.
