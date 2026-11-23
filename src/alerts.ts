// Telegram alert engine — pure logic, no I/O, unit-testable in Node.
//
// Rules:
//   * A position crosses INTO danger when its liquidation distance falls
//     below the user's threshold -> one "warning" alert per episode.
//   * It escalates to "critical" if the distance falls below half the
//     threshold -> one "critical" alert per episode.
//   * It recovers when the distance rises above threshold + 2% hysteresis
//     -> one "recovered" notice. The hysteresis band stops alert flapping
//     when the price hovers right at the threshold.
//   * A closed position leaves the alert state silently (no message).
//   * No re-alerts inside one episode: the lens already shows the live
//     state continuously, so Telegram stays quiet until something changes.
//
// All messages are facts only — prices and distances, never advice.

import { HlSnapshot, liqDistancePct } from './hyperliquid'
import { fmtPx } from './format'

export const HYSTERESIS_PCT = 2

export type AlertKind = 'warning' | 'critical' | 'recovered'

export interface AlertEvent {
  kind: AlertKind
  coin: string
  side: 'LONG' | 'SHORT'
  distancePct: number
  leverage: number
  markPx: number
  liqPx: number | null
}

export interface AlertState {
  /** key "COIN:SIDE" -> level currently alerting + when its alert was sent */
  active: Map<string, { level: 'warning' | 'critical'; sentAt: number }>
}

export function newAlertState(): AlertState {
  return { active: new Map() }
}

function keyOf(coin: string, side: string): string {
  return `${coin}:${side}`
}

function levelOf(distancePct: number, threshold: number): 'warning' | 'critical' | null {
  if (distancePct < threshold / 2) return 'critical'
  if (distancePct < threshold) return 'warning'
  return null
}

/**
 * Evaluate one fresh snapshot against the alert state. Returns the alert
 * events to send (possibly empty) and mutates `state` in place.
 */
export function evaluateAlerts(
  snap: HlSnapshot,
  threshold: number,
  state: AlertState,
  nowMs: number,
): AlertEvent[] {
  const events: AlertEvent[] = []
  const seen = new Set<string>()

  for (const pos of snap.account.positions) {
    const key = keyOf(pos.coin, pos.side)
    seen.add(key)
    const dist = liqDistancePct(pos)
    const level = dist === null ? null : levelOf(dist, threshold)
    const prev = state.active.get(key)

    if (level !== null && dist !== null) {
      if (!prev) {
        // New episode: warning or straight to critical.
        state.active.set(key, { level, sentAt: nowMs })
        events.push({
          kind: level,
          coin: pos.coin,
          side: pos.side,
          distancePct: dist,
          leverage: pos.leverage,
          markPx: pos.markPx,
          liqPx: pos.liqPx,
        })
      } else if (prev.level === 'warning' && level === 'critical') {
        // Escalation: warning -> critical.
        state.active.set(key, { level: 'critical', sentAt: nowMs })
        events.push({
          kind: 'critical',
          coin: pos.coin,
          side: pos.side,
          distancePct: dist,
          leverage: pos.leverage,
          markPx: pos.markPx,
          liqPx: pos.liqPx,
        })
      }
      // Same level as before: stay quiet (one alert per episode).
    } else if (prev) {
      // No longer in danger. Only call it recovered past the hysteresis
      // band; inside the band the episode stays open (no flapping).
      if (dist === null || dist >= threshold + HYSTERESIS_PCT) {
        state.active.delete(key)
        if (dist !== null) {
          events.push({
            kind: 'recovered',
            coin: pos.coin,
            side: pos.side,
            distancePct: dist,
            leverage: pos.leverage,
            markPx: pos.markPx,
            liqPx: pos.liqPx,
          })
        }
      }
    }
  }

  // Positions that closed: drop them silently.
  for (const key of [...state.active.keys()]) {
    if (!seen.has(key)) state.active.delete(key)
  }

  return events
}

export function formatAlertMessage(ev: AlertEvent, threshold: number): string {
  const head = `${ev.coin} ${ev.side} ${ev.leverage}x`
  const liq = ev.liqPx === null ? '--' : `$${fmtPx(ev.liqPx)}`
  const dist = ev.distancePct.toFixed(1)
  switch (ev.kind) {
    case 'warning':
      return `PerpWatch ALERT: ${head} is ${dist}% from liquidation (mark $${fmtPx(ev.markPx)}, liq ${liq}). Threshold: ${threshold}%.`
    case 'critical':
      return `PerpWatch CRITICAL: ${head} is ${dist}% from liquidation (mark $${fmtPx(ev.markPx)}, liq ${liq}). Liquidation is very close.`
    case 'recovered':
      return `PerpWatch: ${head} recovered — now ${dist}% from liquidation (mark $${fmtPx(ev.markPx)}).`
  }
}
