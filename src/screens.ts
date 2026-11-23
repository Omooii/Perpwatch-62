// Lens screen builders — pure functions over a Hyperliquid snapshot.
// Layout budget: 576 x 288 px, line height ~27px (~9 rows), no font-size
// control, no bold/italic. Keep every line under ~48 chars so the firmware
// never wraps mid-number.
//
// Container IDs:
//   home:    1 header, 2 list, 3 footer
//   detail: 11 title, 12 body, 13 footer
//   funding: 21 title, 22 body, 23 footer
//   prices: 31 title, 32 body, 33 footer
//   chart:  50 event layer, 51 title, 52 image, 53 info, 54 footer
// Exactly one container per page carries isEventCapture: 1.
// (Image containers cannot capture input, so the chart page uses a
// full-screen blank text container as its event layer, per the image
// template.)

import {
  TextContainerProperty,
  ListContainerProperty,
  ListItemContainerProperty,
  ImageContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
} from '@evenrealities/even_hub_sdk'
import {
  HlSnapshot,
  HlPosition,
  liqDistancePct,
  riskLevel,
  riskBrightness,
  riskGlyph,
} from './hyperliquid'
import { fmtPx, fmtUsd, fmtUsdPlain, fmtPct, fmtFundingRate, fmtSize, fmtClock } from './format'

export type ScreenName = 'home' | 'detail' | 'funding' | 'prices' | 'chart'

export interface BuiltPage {
  textObject: TextContainerProperty[]
  listObject: ListContainerProperty[]
  imageObject?: ImageContainerProperty[]
  /** Omitted on message pages: the host keeps the system menu. */
  menuObject?: MenuContainerProperty
  /** Content signature: rebuild only when this changes. */
  signature: string
}

const W = 576
const H = 288

export const MENU = {
  FUNDING: 1,
  PRICES: 2,
  REFRESH: 3,
  HOME: 4,
  CHART: 5,
} as const

function homeMenu(): MenuContainerProperty {
  return new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({ itemName: 'Funding', itemID: MENU.FUNDING }),
      new MenuItemProperty({ itemName: 'Prices', itemID: MENU.PRICES }),
      new MenuItemProperty({ itemName: 'Refresh', itemID: MENU.REFRESH }),
    ],
  })
}

function subMenu(): MenuContainerProperty {
  return new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({ itemName: 'Positions', itemID: MENU.HOME }),
      new MenuItemProperty({ itemName: 'Refresh', itemID: MENU.REFRESH }),
    ],
  })
}

/** Detail screen menu: the chart is a child of the detail view. */
function detailMenu(): MenuContainerProperty {
  return new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({ itemName: 'Chart', itemID: MENU.CHART }),
      new MenuItemProperty({ itemName: 'Positions', itemID: MENU.HOME }),
      new MenuItemProperty({ itemName: 'Refresh', itemID: MENU.REFRESH }),
    ],
  })
}

function header(content: string, brightness = 4): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: W,
    height: 27,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 1,
    containerName: 'header',
    content,
    textColor: brightness,
  })
}

function footer(id: number, name: string, content: string, brightness = 3): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: H - 27,
    width: W,
    height: 27,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: id,
    containerName: name,
    content,
    textColor: brightness,
  })
}

function bodyText(
  id: number,
  name: string,
  content: string,
  brightness = 4,
  isEventCapture = 0,
): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: 30,
    width: W,
    height: H - 60,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: id,
    containerName: name,
    content,
    textColor: brightness,
    isEventCapture,
  })
}

/** One list row per position, max 64 chars. */
export function positionRow(p: HlPosition): string {
  const dist = liqDistancePct(p)
  const level = riskLevel(dist)
  const distStr = dist === null ? '--' : fmtPct(dist)
  return `${riskGlyph(level)}${p.coin} ${p.side} ${p.leverage}x liq ${distStr} ${fmtUsd(p.unrealizedPnl)}`
}

function tickerLine(snap: HlSnapshot): string {
  // Keep under ~48 chars so the firmware never wraps mid-number.
  const parts: string[] = ['PerpWatch']
  for (const coin of ['BTC', 'ETH']) {
    const m = snap.markets.get(coin)
    if (m) parts.push(`${coin} $${fmtPx(m.markPx)}`)
  }
  return parts.join('  ')
}

/** Home: ticker header + position list + account footer.
 *  Alert-state layout: when the nearest position is inside the alert
 *  threshold, the footer becomes a bright alert line naming that position. */
export function buildHome(snap: HlSnapshot, alertThreshold = 5): BuiltPage {
  const { account } = snap
  const items =
    account.positions.length > 0
      ? account.positions.slice(0, 20).map(positionRow)
      : ['No open positions']
  let worst: number | null = null
  let worstPos: HlPosition | null = null
  for (const p of account.positions) {
    const d = liqDistancePct(p)
    if (d !== null && (worst === null || d < worst)) {
      worst = d
      worstPos = p
    }
  }
  const head = header(tickerLine(snap))
  const list = new ListContainerProperty({
    xPosition: 0,
    yPosition: 28,
    width: W,
    height: H - 56,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 2,
    containerName: 'positions',
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemWidth: W - 8,
      isItemSelectBorderEn: 1,
      itemName: items,
    }),
    isEventCapture: 1,
  })
  let foot: TextContainerProperty
  if (worst !== null && worstPos !== null && worst < alertThreshold) {
    foot = footer(
      3,
      'homeFooter',
      `!! ALERT ${worstPos.coin} liq ${fmtPct(worst)} · ${fmtClock(snap.fetchedAt)}`,
      4,
    )
  } else {
    foot = footer(
      3,
      'homeFooter',
      `Acct ${fmtUsdPlain(account.accountValue)}${worst === null ? '' : ` · Nearest liq ${fmtPct(worst)}`} · ${fmtClock(snap.fetchedAt)}`,
    )
  }
  return {
    textObject: [head, foot],
    listObject: [list],
    menuObject: homeMenu(),
    signature: JSON.stringify({ t: head.content, items, f: foot.content }),
  }
}

/** Detail: one position, full numbers. Tap anywhere to go back. */
export function buildDetail(pos: HlPosition): BuiltPage {
  const dist = liqDistancePct(pos)
  const level = riskLevel(dist)
  const bright = riskBrightness(level)
  const distLine =
    dist === null
      ? 'Liq   -- (no liq price)'
      : `Liq   ${fmtPx(pos.liqPx as number)} (${fmtPct(dist)} away)`
  const title = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: W,
    height: 27,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 11,
    containerName: 'detailTitle',
    content: `${riskGlyph(level)}${pos.coin} ${pos.side} ${pos.leverage}x ${pos.levType}`,
    textColor: bright,
  })
  const body = bodyText(
    12,
    'detailBody',
    [
      `Entry ${fmtPx(pos.entryPx)}`,
      `Mark  ${fmtPx(pos.markPx)}`,
      distLine,
      `Size ${fmtSize(pos.size)} · Value ${fmtUsdPlain(pos.positionValue)}`,
      `Margin ${fmtUsdPlain(pos.marginUsed)} · PnL ${fmtUsd(pos.unrealizedPnl)}`,
      `ROE ${fmtPct(pos.roe * 100)} · Funding ${fmtUsd(pos.cumFundingSinceOpen)}`,
    ].join('\n'),
    bright,
    1, // tap anywhere in the body goes back home
  )
  const foot = footer(13, 'detailFooter', 'Tap: back to positions · 2x tap: exit')
  return {
    textObject: [title, body, foot],
    listObject: [],
    menuObject: detailMenu(),
    signature: JSON.stringify({ t: title.content, b: body.content }),
  }
}

/** Chart: 24h sparkline image + price info. The image starts empty and is
 *  filled by bridge.updateImageRawData once the candles load. */
export interface ChartInfo {
  coin: string
  markPx: number
  chg24h: number | null
  low24h: number | null
  high24h: number | null
  state: 'loading' | 'ready' | 'error'
}

export function buildChart(info: ChartInfo): BuiltPage {
  const eventLayer = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: W,
    height: H,
    borderWidth: 0,
    borderColor: 0,
    paddingLength: 0,
    containerID: 50,
    containerName: 'chartEvents',
    content: ' ',
    isEventCapture: 1,
  })
  const title = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: W,
    height: 27,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 51,
    containerName: 'chartTitle',
    content: `${info.coin} · 24h chart`,
    textColor: 4,
  })
  const image = new ImageContainerProperty({
    xPosition: (W - 288) / 2,
    yPosition: 34,
    width: 288,
    height: 120,
    containerID: 52,
    containerName: 'sparkline',
  })
  let infoLines: string[]
  if (info.state === 'loading') {
    infoLines = ['Loading 24h chart…']
  } else if (info.state === 'error') {
    infoLines = ['Chart failed to load.', 'Tap back and try again.']
  } else {
    const chg = info.chg24h === null ? '' : `  ${info.chg24h >= 0 ? '+' : ''}${info.chg24h.toFixed(1)}% 24h`
    infoLines = [
      `${info.coin} $${fmtPx(info.markPx)}${chg}`,
      info.low24h !== null && info.high24h !== null
        ? `24h $${fmtPx(info.low24h)} – $${fmtPx(info.high24h)}`
        : '',
      'Dashed: entry price · dotted: liq',
    ].filter((l) => l !== '')
  }
  const infoBox = new TextContainerProperty({
    xPosition: 0,
    yPosition: 160,
    width: W,
    height: 96,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 53,
    containerName: 'chartInfo',
    content: infoLines.join('\n'),
    textColor: 4,
  })
  const foot = footer(54, 'chartFooter', 'Tap: back to detail · 2x tap: exit')
  return {
    textObject: [eventLayer, title, infoBox, foot],
    listObject: [],
    imageObject: [image],
    menuObject: subMenu(),
    signature: JSON.stringify({ t: title.content, i: infoBox.content }),
  }
}

/** Funding: 8h funding rate + cost per open position. */
export function buildFunding(snap: HlSnapshot): BuiltPage {
  const title = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: W,
    height: 27,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 21,
    containerName: 'fundingTitle',
    content: 'Funding · 8h rates',
    textColor: 4,
  })
  const lines: string[] = []
  for (const p of snap.account.positions.slice(0, 7)) {
    const m = snap.markets.get(p.coin)
    if (!m) continue
    // Positive funding: longs pay shorts. 8h cost for THIS position:
    const cost8h = p.positionValue * m.funding * 8 * (p.side === 'LONG' ? 1 : -1)
    const verb = cost8h >= 0 ? 'pay' : 'get'
    lines.push(`${p.coin} ${fmtFundingRate(m.funding)} ${verb} ${fmtUsdPlain(Math.abs(cost8h))}/8h`)
  }
  if (lines.length === 0) lines.push('No open positions')
  lines.push('Positive rate: longs pay shorts.')
  const body = bodyText(22, 'fundingBody', lines.join('\n'), 4, 1)
  const foot = footer(23, 'fundingFooter', 'Tap: back to positions · 2x tap: exit')
  return {
    textObject: [title, body, foot],
    listObject: [],
    menuObject: subMenu(),
    signature: JSON.stringify({ b: body.content }),
  }
}

/** Prices: mark price + 24h change for watched coins. */
export function buildPrices(snap: HlSnapshot): BuiltPage {
  const title = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: W,
    height: 27,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 31,
    containerName: 'pricesTitle',
    content: 'Prices · 24h change',
    textColor: 4,
  })
  const coins: string[] = []
  for (const p of snap.account.positions) {
    if (!coins.includes(p.coin)) coins.push(p.coin)
  }
  for (const major of ['BTC', 'ETH', 'SOL']) {
    if (!coins.includes(major)) coins.push(major)
  }
  const lines: string[] = []
  for (const coin of coins.slice(0, 7)) {
    const m = snap.markets.get(coin)
    if (!m || m.prevDayPx <= 0) continue
    const chg = ((m.markPx - m.prevDayPx) / m.prevDayPx) * 100
    const sign = chg >= 0 ? '+' : ''
    lines.push(`${coin} $${fmtPx(m.markPx)}  ${sign}${chg.toFixed(1)}%`)
  }
  if (lines.length === 0) lines.push('No market data')
  const body = bodyText(32, 'pricesBody', lines.join('\n'), 4, 1)
  const foot = footer(33, 'pricesFooter', 'Tap: back to positions · 2x tap: exit')
  return {
    textObject: [title, body, foot],
    listObject: [],
    menuObject: subMenu(),
    signature: JSON.stringify({ b: body.content }),
  }
}

/** Loading / error single-screen pages. */
export function buildMessage(title: string, lines: string[]): BuiltPage {
  const titleBox = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: W,
    height: 27,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 41,
    containerName: 'msgTitle',
    content: title,
    textColor: 4,
  })
  const body = bodyText(42, 'msgBody', lines.join('\n'), 4, 1)
  const foot = footer(43, 'msgFooter', 'Double-tap: exit')
  return {
    textObject: [titleBox, body, foot],
    listObject: [],
    signature: JSON.stringify({ t: title, b: body.content }),
  }
}
