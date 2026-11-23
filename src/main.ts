// PerpWatch — Hyperliquid liquidation-risk monitor for Even G2 glasses.
//
// READ-ONLY by design: the app fetches public Hyperliquid data (any address's
// positions are public) and never signs, trades, or holds funds. It reports
// facts — prices, distances, funding — never buy/sell advice.
//
// Interaction model:
//   Home (positions list): tap a row -> detail. Menu -> Funding / Prices / Refresh.
//   Detail: tap anywhere -> back home. Menu -> Chart / Positions / Refresh.
//   Chart: 24h sparkline + entry/liq reference lines. Tap -> back to detail.
//   Funding / Prices: tap anywhere -> back home. Menu -> Positions / Refresh.
//   Double-tap anywhere -> exit (root-level check, always available).
//   Data refreshes every 30s while the app is open; the page rebuilds only
//   when the displayed content actually changes.

import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  ImageRawDataUpdate,
  OsEventTypeList,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import {
  fetchSnapshot,
  fetchCandles,
  DEFAULT_ADDRESS,
  type HlSnapshot,
  type HlCandle,
} from './hyperliquid'
import {
  buildHome,
  buildDetail,
  buildFunding,
  buildPrices,
  buildChart,
  buildMessage,
  MENU,
  type BuiltPage,
  type ChartInfo,
  type ScreenName,
} from './screens'
import { drawSparkline } from './sparkline'
import { evaluateAlerts, formatAlertMessage, newAlertState } from './alerts'
import { sendTelegramMessage, fetchTelegramChatId } from './telegram'
import { fmtClock, fmtPx, fmtUsd } from './format'

const POLL_MS = 30_000
const BRIDGE_WAIT_MS = 5_000
const CHART_CACHE_MS = 5 * 60_000 // candles re-fetched at most every 5 min

const KEY_ADDRESS = 'perpwatch.address'
const KEY_THRESHOLD = 'perpwatch.alertThreshold'
const KEY_TG_TOKEN = 'perpwatch.telegram.token'
const KEY_TG_CHAT = 'perpwatch.telegram.chatId'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let bridge: EvenAppBridge | null = null
let pageCreated = false
let createFailures = 0
const MAX_CREATE_FAILURES = 3
let lastSignature = ''
let screen: ScreenName = 'home'
let backScreen: ScreenName = 'home' // where a tap takes you from a sub-screen
let selectedIndex = 0
let snapshot: HlSnapshot | null = null
let address = DEFAULT_ADDRESS
let alertThreshold = 5 // percent; Telegram alerts fire below this
let pollTimer: ReturnType<typeof setInterval> | undefined

// Telegram: token + chat id live only in on-device storage (bridge KV or
// localStorage). They are never in the repo, the bundle, or any other request.
let tgToken: string | null = null
let tgChatId: string | null = null
const alertState = newAlertState()

// Chart state: candles are cached 5 min; the rendered frame bytes are kept
// so a poll-triggered rebuild can re-push the image (rebuild clears it).
let chartState: ChartInfo['state'] = 'loading'
let chartCandles: HlCandle[] | null = null
let chartCoin = ''
let chartFetchedAt = 0
let chartFrameBytes: Uint8Array | null = null
let chartLoadToken = 0
let frameChain: Promise<unknown> = Promise.resolve()

// ---------------------------------------------------------------------------
// Storage shim: Even key-value storage when the bridge is present, otherwise
// the WebView's own localStorage (companion-only mode).
// ---------------------------------------------------------------------------

async function storageGet(key: string): Promise<string | null> {
  try {
    if (bridge) {
      const v = await bridge.getLocalStorage(key)
      return v === undefined || v === null || v === '' ? null : String(v)
    }
  } catch {
    // fall through to localStorage
  }
  return window.localStorage.getItem(key)
}

async function storageSet(key: string, value: string): Promise<void> {
  try {
    if (bridge) {
      await bridge.setLocalStorage(key, value)
      return
    }
  } catch {
    // fall through to localStorage
  }
  window.localStorage.setItem(key, value)
}

// ---------------------------------------------------------------------------
// Companion page (phone WebView) helpers
// ---------------------------------------------------------------------------

function el(id: string): HTMLElement | null {
  return document.getElementById(id)
}

function setStatus(text: string): void {
  const s = el('status')
  if (s) s.textContent = text
}

function renderCompanionAlerts(): void {
  const box = el('alerts')
  if (!box) return
  if (alertState.active.size === 0) {
    box.textContent = 'No positions are below the alert threshold.'
    return
  }
  const lines = [...alertState.active.entries()].map(
    ([key, a]) => `${key.replace(':', ' ')} — ${a.level.toUpperCase()} (alerted ${new Date(a.sentAt).toLocaleTimeString()})`,
  )
  box.textContent = lines.join('\n')
}

function renderCompanionPositions(): void {
  const box = el('positions')
  if (!box) return
  if (!snapshot) {
    box.textContent = 'No data yet.'
    return
  }
  const rows = snapshot.account.positions.map(
    (p) =>
      `${p.coin} ${p.side} ${p.leverage}x — entry ${fmtPx(p.entryPx)}, liq ${p.liqPx === null ? '--' : fmtPx(p.liqPx)}, PnL ${fmtUsd(p.unrealizedPnl)}`,
  )
  box.textContent =
    rows.length > 0
      ? rows.join('\n')
      : `No open positions for ${snapshot.account.address.slice(0, 10)}…`
}

// ---------------------------------------------------------------------------
// Lens pages
// ---------------------------------------------------------------------------

function chartInfo(): ChartInfo | null {
  if (!snapshot) return null
  const pos = snapshot.account.positions[selectedIndex]
  if (!pos) return null
  const market = snapshot.markets.get(pos.coin)
  const chg24h =
    market && market.prevDayPx > 0
      ? ((market.markPx - market.prevDayPx) / market.prevDayPx) * 100
      : null
  let low24h: number | null = null
  let high24h: number | null = null
  if (chartCandles) {
    for (const c of chartCandles) {
      if (low24h === null || c.low < low24h) low24h = c.low
      if (high24h === null || c.high > high24h) high24h = c.high
    }
  }
  return { coin: pos.coin, markPx: pos.markPx, chg24h, low24h, high24h, state: chartState }
}

function currentPage(): BuiltPage | null {
  if (!snapshot) return null
  switch (screen) {
    case 'home':
      return buildHome(snapshot, alertThreshold)
    case 'detail': {
      const pos = snapshot.account.positions[selectedIndex]
      return pos ? buildDetail(pos) : buildHome(snapshot, alertThreshold)
    }
    case 'funding':
      return buildFunding(snapshot)
    case 'prices':
      return buildPrices(snapshot)
    case 'chart': {
      const info = chartInfo()
      return info ? buildChart(info) : buildHome(snapshot, alertThreshold)
    }
  }
}

async function showPage(page: BuiltPage): Promise<void> {
  if (!bridge) return
  const total =
    page.textObject.length + page.listObject.length + (page.imageObject?.length ?? 0)
  if (!pageCreated) {
    const result = await bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: total,
        textObject: page.textObject,
        listObject: page.listObject.length > 0 ? page.listObject : undefined,
        imageObject: page.imageObject?.length ? page.imageObject : undefined,
        menuObject: page.menuObject,
      }),
    )
    console.log('PerpWatch: startup page created:', result === 0 ? 'success' : `failed (${result})`)
    if (result === 0) {
      pageCreated = true
      createFailures = 0
      lastSignature = page.signature
    } else {
      // The SDK's waitForEvenAppBridge resolves even in a plain browser
      // (no Flutter host), so the first create failure is the real signal.
      // After 3 consecutive failures, drop to companion-only mode instead
      // of retrying the lens page on every poll forever.
      createFailures++
      if (createFailures >= MAX_CREATE_FAILURES) {
        console.log('PerpWatch: no glasses bridge after 3 failed creates — companion-only mode')
        bridge = null
        setStatus(
          'No glasses connected — companion view only. Open this app in the Even Hub simulator (or on G2 glasses) to see the lens display.',
        )
      }
    }
  } else {
    const ok = await bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: total,
        textObject: page.textObject,
        listObject: page.listObject.length > 0 ? page.listObject : undefined,
        imageObject: page.imageObject?.length ? page.imageObject : undefined,
        menuObject: page.menuObject,
      }),
    )
    if (ok) lastSignature = page.signature
  }
}

/** Push the sparkline PNG to the lens. Serial: one update in flight at a time. */
async function pushChartFrame(bytes: Uint8Array): Promise<void> {
  if (!bridge || screen !== 'chart') return
  frameChain = frameChain.then(async () => {
    if (!bridge || screen !== 'chart') return
    const result = await bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: 52,
        containerName: 'sparkline',
        imageData: bytes,
      }),
    )
    if (result !== 'success') {
      console.error('PerpWatch: updateImageRawData failed:', result)
    }
  })
  await frameChain
}

/** Fetch candles (cached 5 min), render the sparkline, show it. */
async function loadChart(): Promise<void> {
  const pos = snapshot?.account.positions[selectedIndex]
  if (!pos) return
  const token = ++chartLoadToken
  const coin = pos.coin
  const freshCache =
    chartCoin === coin && chartCandles && Date.now() - chartFetchedAt < CHART_CACHE_MS
  try {
    let candles = freshCache ? chartCandles : null
    if (!candles) {
      const end = Date.now()
      candles = await fetchCandles(coin, '15m', end - 24 * 60 * 60 * 1000, end)
      if (candles.length === 0) throw new Error('no candles returned')
    }
    if (token !== chartLoadToken || screen !== 'chart') return
    chartCandles = candles
    chartCoin = coin
    chartFetchedAt = Date.now()
    const bytes = await drawSparkline(candles, pos.entryPx, pos.liqPx)
    if (token !== chartLoadToken || screen !== 'chart') return
    chartFrameBytes = bytes
    chartState = 'ready'
    const page = currentPage()
    if (page) await showPage(page) // rebuild first: the info text changed
    await pushChartFrame(bytes) // then fill the (fresh, empty) image container
  } catch (err) {
    if (token !== chartLoadToken || screen !== 'chart') return
    console.error('PerpWatch: chart load failed:', err)
    chartState = 'error'
    chartFrameBytes = null
    const page = currentPage()
    if (page) await showPage(page)
  }
}

async function navigate(next: ScreenName, index = 0): Promise<void> {
  screen = next
  selectedIndex = index
  backScreen = next === 'chart' ? 'detail' : 'home'
  if (next === 'chart') {
    const pos = snapshot?.account.positions[selectedIndex]
    const freshCache =
      pos && chartCoin === pos.coin && chartCandles && Date.now() - chartFetchedAt < CHART_CACHE_MS
    chartState = freshCache ? 'ready' : 'loading'
  }
  const page = currentPage()
  if (page) await showPage(page)
  if (next === 'chart') {
    // Cached frame: re-push immediately; fresh candles: load then push.
    if (chartState === 'ready' && chartFrameBytes) {
      await pushChartFrame(chartFrameBytes)
    } else {
      await loadChart()
    }
  }
}

// ---------------------------------------------------------------------------
// Data refresh
// ---------------------------------------------------------------------------

async function refresh(): Promise<void> {
  try {
    const snap = await fetchSnapshot(address)
    snapshot = snap
    setStatus(
      `Watching ${address.slice(0, 10)}… — ${snap.account.positions.length} open position(s), updated ${fmtClock(snap.fetchedAt)}`,
    )
    renderCompanionPositions()
    // Alert engine: one Telegram message per episode (warning / critical /
    // recovered). Lens-only when no bot token + chat are linked.
    const events = evaluateAlerts(snap, alertThreshold, alertState, Date.now())
    renderCompanionAlerts()
    for (const ev of events) {
      if (!tgToken || !tgChatId) continue
      const text = formatAlertMessage(ev, alertThreshold)
      void sendTelegramMessage(tgToken, tgChatId, text).catch((err) => {
        console.error('PerpWatch: Telegram send failed:', err)
        setStatus(`Alert fired but Telegram send failed (${err instanceof Error ? err.message : String(err)}). Check the bot token / chat link.`)
      })
    }
    const page = currentPage()
    if (page && page.signature !== lastSignature) {
      await showPage(page)
      // A rebuild clears the image container: re-push the sparkline.
      if (screen === 'chart' && chartFrameBytes) {
        await pushChartFrame(chartFrameBytes)
      }
    }
  } catch (err) {
    console.error('PerpWatch: fetch failed:', err)
    setStatus(`Couldn't reach Hyperliquid — retrying. (${err instanceof Error ? err.message : String(err)})`)
    if (!snapshot) {
      await showPage(
        buildMessage('PerpWatch', [
          "Couldn't reach Hyperliquid.",
          'Check the connection.',
          'Retrying every 30s…',
        ]),
      )
    }
    // If we have a previous snapshot, keep showing it (stale but useful).
  }
}

// ---------------------------------------------------------------------------
// Event routing (see the minimal template's notes on the CLICK_EVENT=0 trap:
// a tap arrives as an envelope whose eventType is undefined, and the default
// must be resolved INSIDE the envelope check).
// ---------------------------------------------------------------------------

function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

function handleEvent(event: EvenHubEvent): void {
  const sysType = eventTypeOf(event.sysEvent)
  const textType = eventTypeOf(event.textEvent)
  const listType = eventTypeOf(event.listEvent)

  // Double-tap exits from anywhere — root-level check, first.
  if (
    sysType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    textType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    listType === OsEventTypeList.DOUBLE_CLICK_EVENT
  ) {
    void bridge?.shutDownPageContainer(1)
    return
  }

  // Contextual menu selections.
  const menuId = event.menuItemClickEvent?.itemID
  if (menuId !== undefined) {
    if (menuId === MENU.FUNDING) void navigate('funding')
    else if (menuId === MENU.PRICES) void navigate('prices')
    else if (menuId === MENU.HOME) void navigate('home')
    else if (menuId === MENU.CHART) void navigate('chart', selectedIndex)
    else if (menuId === MENU.REFRESH) void refresh()
    return
  }

  // Tap on a position row -> detail view.
  // NOTE: protobuf omits zero-value fields on the wire, so a tap on the FIRST
  // row (index 0) arrives with currentSelectItemIndex UNDEFINED. Default to 0:
  // a list tap always means "open the focused row", and focus starts at 0.
  if (event.listEvent && listType === OsEventTypeList.CLICK_EVENT) {
    const idx = event.listEvent.currentSelectItemIndex ?? 0
    if (snapshot && idx < snapshot.account.positions.length) {
      void navigate('detail', idx)
    }
    return
  }

  // Tap on a sub-screen -> back (chart goes back to detail, the rest home).
  // Taps arrive via sysEvent (with eventSource) on text containers, not via
  // textEvent — scroll gestures use textEvent. Accept a CLICK from either
  // envelope while off the home screen.
  if (
    (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) &&
    screen !== 'home'
  ) {
    void navigate(backScreen, selectedIndex)
    return
  }

  // App returns to the foreground -> refresh immediately.
  if (sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT) {
    void refresh()
    return
  }

  if (
    sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
  ) {
    if (pollTimer) clearInterval(pollTimer)
  }
}

// ---------------------------------------------------------------------------
// Companion settings wiring
// ---------------------------------------------------------------------------

function wireCompanion(): void {
  const addrInput = el('addr-input') as HTMLInputElement | null
  const addrSave = el('addr-save')
  const addrCurrent = el('addr-current')
  if (addrInput) addrInput.value = address
  if (addrCurrent) addrCurrent.textContent = address
  addrSave?.addEventListener('click', () => {
    const v = addrInput?.value.trim() ?? ''
    if (!ADDRESS_RE.test(v)) {
      setStatus('That is not a valid 0x address (42 hex characters). Nothing changed.')
      return
    }
    address = v
    void storageSet(KEY_ADDRESS, v).then(() => {
      if (addrCurrent) addrCurrent.textContent = v
      setStatus(`Watching ${v.slice(0, 10)}… — fetching…`)
      screen = 'home'
      void refresh()
    })
  })

  const thInput = el('threshold-input') as HTMLInputElement | null
  const thSave = el('threshold-save')
  if (thInput) thInput.value = String(alertThreshold)
  thSave?.addEventListener('click', () => {
    const v = Number(thInput?.value)
    if (!isFinite(v) || v < 1 || v > 50) {
      setStatus('Alert threshold must be a number between 1 and 50 (percent). Nothing changed.')
      return
    }
    alertThreshold = v
    void storageSet(KEY_THRESHOLD, String(v)).then(() => {
      setStatus(`Alert threshold saved: warn when liquidation distance falls below ${v}%.`)
    })
  })

  const tgInput = el('tg-token-input') as HTMLInputElement | null
  const tgSave = el('tg-save')
  const tgStatus = el('tg-status')
  tgSave?.addEventListener('click', () => {
    const v = tgInput?.value.trim() ?? ''
    if (v.length < 20 || !v.includes(':')) {
      setStatus('That does not look like a Telegram bot token. Nothing changed.')
      return
    }
    tgToken = v
    void storageSet(KEY_TG_TOKEN, v).then(() => {
      if (tgInput) tgInput.value = ''
      if (tgStatus) tgStatus.textContent = 'Bot token saved on this device.'
      setStatus(
        tgChatId
          ? 'Telegram bot token saved. Alerts are live.'
          : 'Telegram bot token saved. Now link a chat below to receive alerts.',
      )
    })
  })

  const tgChatInput = el('tg-chat-input') as HTMLInputElement | null
  const tgChatSave = el('tg-chat-save')
  const tgChatStatus = el('tg-chat-status')
  if (tgChatInput && tgChatId) tgChatInput.value = tgChatId
  tgChatSave?.addEventListener('click', () => {
    const v = tgChatInput?.value.trim() ?? ''
    if (!/^-?\d{5,20}$/.test(v)) {
      setStatus('That does not look like a Telegram chat id (digits, e.g. 2062309328). Nothing changed.')
      return
    }
    tgChatId = v
    void storageSet(KEY_TG_CHAT, v).then(() => {
      if (tgChatStatus) tgChatStatus.textContent = `Chat linked: ${v}.`
      setStatus(
        tgToken ? 'Telegram alerts are live.' : 'Chat id saved. Add a bot token above to activate alerts.',
      )
    })
  })

  el('tg-link')?.addEventListener('click', () => {
    if (!tgToken) {
      setStatus('Save a bot token first, then link the chat.')
      return
    }
    setStatus('Looking for your chat — make sure you tapped Start on the bot…')
    void fetchTelegramChatId(tgToken)
      .then((found) => {
        tgChatId = found.chatId
        return storageSet(KEY_TG_CHAT, found.chatId).then(() => {
          if (tgChatInput) tgChatInput.value = found.chatId
          if (tgChatStatus) tgChatStatus.textContent = `Chat linked: ${found.label} (${found.chatId}).`
          setStatus(`Telegram linked (${found.label}). Alerts are live.`)
        })
      })
      .catch((err) => {
        setStatus(`Could not link chat: ${err instanceof Error ? err.message : String(err)}`)
      })
  })

  el('tg-test')?.addEventListener('click', () => {
    if (!tgToken || !tgChatId) {
      setStatus('Save a bot token and link a chat first, then send a test.')
      return
    }
    void sendTelegramMessage(tgToken, tgChatId, 'PerpWatch test alert — Telegram is linked. Liquidation warnings will arrive here.')
      .then(() => setStatus('Test alert sent — check your Telegram.'))
      .catch((err) => {
        setStatus(`Test alert failed: ${err instanceof Error ? err.message : String(err)}`)
      })
  })

  el('refresh-btn')?.addEventListener('click', () => void refresh())
  el('reload-btn')?.addEventListener('click', () => window.location.reload())
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  // Wait for the glasses bridge first (max 5s) so settings load from the
  // device's key-value storage when it is available; in a plain browser we
  // fall back to companion-only mode with window.localStorage.
  try {
    bridge = await Promise.race([
      waitForEvenAppBridge(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), BRIDGE_WAIT_MS)),
    ])
  } catch {
    bridge = null
  }

  // Load settings (bridge storage if available, else localStorage).
  const savedAddress = await storageGet(KEY_ADDRESS)
  if (savedAddress && ADDRESS_RE.test(savedAddress)) address = savedAddress
  const savedThreshold = await storageGet(KEY_THRESHOLD)
  if (savedThreshold && isFinite(Number(savedThreshold))) {
    alertThreshold = Number(savedThreshold)
  }
  const savedTg = await storageGet(KEY_TG_TOKEN)
  const tgStatus = el('tg-status')
  if (savedTg) {
    tgToken = savedTg
    if (tgStatus) tgStatus.textContent = 'Bot token saved on this device.'
  }
  const savedChat = await storageGet(KEY_TG_CHAT)
  const tgChatStatus = el('tg-chat-status')
  if (savedChat) {
    tgChatId = savedChat
    if (tgChatStatus) tgChatStatus.textContent = `Chat linked: ${savedChat}.`
  }

  wireCompanion()

  if (!bridge) {
    setStatus('No glasses bridge found — open this app in the Even Hub simulator (or on G2) to see the lens display. Settings below still work.')
    await refresh() // companion-only: fetch data for the phone view
    pollTimer = setInterval(() => void refresh(), POLL_MS)
    return
  }

  bridge.onEvenHubEvent(handleEvent)

  await showPage(buildMessage('PerpWatch', ['Loading positions…', 'Reading Hyperliquid…']))
  await refresh()
  pollTimer = setInterval(() => void refresh(), POLL_MS)
}

void init()
