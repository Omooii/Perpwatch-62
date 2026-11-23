// Hyperliquid public Info API — READ-ONLY. No keys, no signing, no writes.
// All account data on Hyperliquid is public: clearinghouseState works for any
// address. PerpWatch only ever reads; it never places orders or holds funds.
//
// Endpoints used:
//   POST /info {"type":"metaAndAssetCtxs"}  -> mark prices, funding, prev-day px
//   POST /info {"type":"clearinghouseState","user":addr} -> positions + margin
//   POST /info {"type":"candleSnapshot",...} -> OHLCV for sparklines (Wed)
// Rate limit: 1,200 weight/min per IP. Our 30s poll costs ~4 weight/min.

export const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'

/** Default watched address: a public Hyperliquid leaderboard wallet with open
 *  positions (found 23 Nov 2026). The user can change it in the companion
 *  page settings; nothing private is shown — leaderboard data is public. */
export const DEFAULT_ADDRESS = '0x1ee7a73cb5b0b6b056d8138085b2009e6a6bedf5'
/** Fallback: a large public wallet that almost always holds positions. */
export const FALLBACK_ADDRESS = '0xf5d81a135f756ca16544e53c20fc20643ec3ad53'

export interface HlPosition {
  coin: string
  side: 'LONG' | 'SHORT'
  size: number // signed size (szi)
  entryPx: number
  markPx: number
  liqPx: number | null // null = cross-margin position with no computable liq px
  leverage: number
  levType: 'cross' | 'isolated'
  marginUsed: number
  positionValue: number
  unrealizedPnl: number
  roe: number
  cumFundingSinceOpen: number
}

export interface HlCandle {
  time: number // open time, ms
  open: number
  close: number
  high: number
  low: number
}

export interface HlMarket {
  coin: string
  markPx: number
  funding: number // current hourly funding rate (fraction, e.g. 0.0000125)
  prevDayPx: number
}

export interface HlAccount {
  address: string
  accountValue: number
  totalMarginUsed: number
  withdrawable: number
  positions: HlPosition[]
}

export interface HlSnapshot {
  account: HlAccount
  markets: Map<string, HlMarket>
  fetchedAt: Date
}

// --- raw response shapes (subset of the real payloads) ---

interface RawAssetCtx {
  markPx: string
  funding: string
  prevDayPx: string
}

type RawMetaAndAssetCtxs = [{ universe: { name: string }[] }, RawAssetCtx[]]

interface RawPosition {
  coin: string
  cumFunding: { sinceOpen: string }
  entryPx: string
  leverage: { type: string; value: number }
  liquidationPx: string | null
  marginUsed: string
  positionValue: string
  returnOnEquity: string
  szi: string
  unrealizedPnl: string
}

interface RawClearinghouseState {
  assetPositions: { position: RawPosition }[]
  marginSummary: { accountValue: string; totalMarginUsed: string }
  withdrawable: string
}

interface RawCandle {
  t: number // open time, ms
  T: number // close time, ms
  o: string
  c: string
  h: string
  l: string
}

async function hlPost<T>(body: unknown, timeoutMs = 10000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(HL_INFO_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`Hyperliquid HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/** All perps: mark price, funding, prev-day price. One call, whole universe. */
export async function fetchMarkets(): Promise<Map<string, HlMarket>> {
  const [meta, ctxs] = (await hlPost({ type: 'metaAndAssetCtxs' })) as RawMetaAndAssetCtxs
  const out = new Map<string, HlMarket>()
  meta.universe.forEach((u, i) => {
    const ctx = ctxs[i]
    if (!ctx) return
    out.set(u.name, {
      coin: u.name,
      markPx: parseFloat(ctx.markPx),
      funding: parseFloat(ctx.funding),
      prevDayPx: parseFloat(ctx.prevDayPx),
    })
  })
  return out
}

/** Positions + margin for any address. Returns positions sorted by margin used (largest first). */
export async function fetchAccount(
  address: string,
  markets: Map<string, HlMarket>,
): Promise<HlAccount> {
  const raw = await hlPost<RawClearinghouseState>({ type: 'clearinghouseState', user: address })
  const positions: HlPosition[] = raw.assetPositions.map((ap) => {
    const p = ap.position
    const size = parseFloat(p.szi)
    const market = markets.get(p.coin)
    return {
      coin: p.coin,
      side: size >= 0 ? 'LONG' : 'SHORT',
      size,
      entryPx: parseFloat(p.entryPx),
      markPx: market ? market.markPx : parseFloat(p.entryPx),
      liqPx: p.liquidationPx === null ? null : parseFloat(p.liquidationPx),
      leverage: p.leverage.value,
      levType: p.leverage.type === 'isolated' ? 'isolated' : 'cross',
      marginUsed: parseFloat(p.marginUsed),
      positionValue: parseFloat(p.positionValue),
      unrealizedPnl: parseFloat(p.unrealizedPnl),
      roe: parseFloat(p.returnOnEquity),
      cumFundingSinceOpen: parseFloat(p.cumFunding.sinceOpen),
    }
  })
  positions.sort((a, b) => b.marginUsed - a.marginUsed)
  return {
    address,
    accountValue: parseFloat(raw.marginSummary.accountValue),
    totalMarginUsed: parseFloat(raw.marginSummary.totalMarginUsed),
    withdrawable: parseFloat(raw.withdrawable),
    positions,
  }
}

/** One poll: markets + account. Throws on any failure; caller shows the error state. */
export async function fetchSnapshot(address: string): Promise<HlSnapshot> {
  const markets = await fetchMarkets()
  const account = await fetchAccount(address, markets)
  return { account, markets, fetchedAt: new Date() }
}

/** OHLCV candles for one coin (sparkline). Interval e.g. "15m", "1h". */
export async function fetchCandles(
  coin: string,
  interval: string,
  startTimeMs: number,
  endTimeMs: number,
): Promise<HlCandle[]> {
  const raw = await hlPost<RawCandle[]>({
    type: 'candleSnapshot',
    req: { coin, interval, startTime: startTimeMs, endTime: endTimeMs },
  })
  return raw.map((c) => ({
    time: c.t,
    open: parseFloat(c.o),
    close: parseFloat(c.c),
    high: parseFloat(c.h),
    low: parseFloat(c.l),
  }))
}

// --- liquidation distance & risk ---

/**
 * Distance from mark price to liquidation, as a percent of mark price.
 * LONG: price must FALL to liq -> (mark - liq) / mark.
 * SHORT: price must RISE to liq -> (liq - mark) / mark.
 * Returns null when there is no liquidation price (cross-margin, unliquidatable
 * at current equity) or the numbers are unusable.
 */
export function liqDistancePct(pos: HlPosition): number | null {
  if (pos.liqPx === null || pos.markPx <= 0) return null
  const dist =
    pos.side === 'LONG'
      ? (pos.markPx - pos.liqPx) / pos.markPx
      : (pos.liqPx - pos.markPx) / pos.markPx
  if (!isFinite(dist)) return null
  return dist * 100
}

export type RiskLevel = 'safe' | 'watch' | 'risk' | 'danger' | 'none'

export function riskLevel(distPct: number | null): RiskLevel {
  if (distPct === null) return 'none'
  if (distPct < 5) return 'danger'
  if (distPct < 10) return 'risk'
  if (distPct < 20) return 'watch'
  return 'safe'
}

/** Lens brightness (0-4) per risk level: bright = safe, dim + glyph = danger. */
export function riskBrightness(level: RiskLevel): number {
  switch (level) {
    case 'danger':
      return 1
    case 'risk':
      return 2
    case 'watch':
      return 3
    default:
      return 4
  }
}

/** Warning glyph prefix for at-risk positions (no emoji on the lens). */
export function riskGlyph(level: RiskLevel): string {
  switch (level) {
    case 'danger':
      return '!! '
    case 'risk':
      return '! '
    default:
      return ''
  }
}

/** Worst (smallest) liquidation distance across positions, or null. */
export function worstDistance(positions: HlPosition[]): number | null {
  let worst: number | null = null
  for (const p of positions) {
    const d = liqDistancePct(p)
    if (d === null) continue
    if (worst === null || d < worst) worst = d
  }
  return worst
}
