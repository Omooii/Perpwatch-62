// Sparkline chart for the lens: 24h of closes drawn on a canvas, shipped to
// the glasses as PNG bytes via bridge.updateImageRawData (the SDK decodes and
// converts to 4-bit greyscale itself — see the image template). The geometry
// is pure (no DOM) so it can be unit-tested in Node.
//
// Design: white close line + dark area fill on black; dashed reference lines
// for the position's entry price and liquidation price when they fall inside
// the 24h range; dots on the min/max closes. No text on the canvas — small
// canvas text turns to mush in 4-bit greyscale; labels live in text
// containers next to the image.

import type { HlCandle } from './hyperliquid'

export const SPARK_W = 288
export const SPARK_H = 120
const PAD = 4

export interface SparklineGeometry {
  points: { x: number; y: number }[]
  minPx: number
  maxPx: number
  entryY: number | null // null when the entry price is outside the range
  liqY: number | null
  minIdx: number // index of the lowest close
  maxIdx: number // index of the highest close
}

export function computeSparkline(
  candles: HlCandle[],
  width: number,
  height: number,
  entryPx?: number | null,
  liqPx?: number | null,
): SparklineGeometry {
  const closes = candles.map((c) => c.close)
  let minPx = Infinity
  let maxPx = -Infinity
  let minIdx = 0
  let maxIdx = 0
  closes.forEach((c, i) => {
    if (c < minPx) {
      minPx = c
      minIdx = i
    }
    if (c > maxPx) {
      maxPx = c
      maxIdx = i
    }
  })
  // Degenerate input (empty or flat): keep a usable range.
  if (!isFinite(minPx) || !isFinite(maxPx) || maxPx === minPx) {
    const mid = isFinite(minPx) ? minPx : 0
    minPx = mid - 1
    maxPx = mid + 1
  }
  const range = maxPx - minPx
  const innerW = width - PAD * 2
  const innerH = height - PAD * 2
  const yOf = (px: number) => PAD + ((maxPx - px) / range) * innerH
  const points = closes.map((c, i) => ({
    x: PAD + (closes.length <= 1 ? innerW / 2 : (i / (closes.length - 1)) * innerW),
    y: yOf(c),
  }))
  const inRange = (px: number | null | undefined) =>
    px !== null && px !== undefined && px >= minPx && px <= maxPx ? yOf(px) : null
  return {
    points,
    minPx,
    maxPx,
    entryY: inRange(entryPx),
    liqY: inRange(liqPx),
    minIdx,
    maxIdx,
  }
}

/** Render the sparkline to PNG bytes (288x120). Throws if canvas is unavailable. */
export async function drawSparkline(
  candles: HlCandle[],
  entryPx?: number | null,
  liqPx?: number | null,
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = SPARK_W
  canvas.height = SPARK_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas context unavailable')

  const g = computeSparkline(candles, SPARK_W, SPARK_H, entryPx, liqPx)

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, SPARK_W, SPARK_H)

  if (g.points.length > 1) {
    // Area fill under the close line.
    ctx.beginPath()
    ctx.moveTo(g.points[0].x, SPARK_H - PAD)
    for (const p of g.points) ctx.lineTo(p.x, p.y)
    ctx.lineTo(g.points[g.points.length - 1].x, SPARK_H - PAD)
    ctx.closePath()
    ctx.fillStyle = '#2a2a2a'
    ctx.fill()

    // Close line.
    ctx.beginPath()
    ctx.moveTo(g.points[0].x, g.points[0].y)
    for (const p of g.points.slice(1)) ctx.lineTo(p.x, p.y)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  // Reference lines: entry (long dashes, mid grey), liq (short dashes, light).
  const dash = (y: number | null, color: string, pattern: number[]) => {
    if (y === null) return
    ctx.beginPath()
    ctx.setLineDash(pattern)
    ctx.moveTo(PAD, y)
    ctx.lineTo(SPARK_W - PAD, y)
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])
  }
  dash(g.entryY, '#888888', [6, 4])
  dash(g.liqY, '#cccccc', [2, 3])

  // Min/max dots.
  for (const idx of [g.minIdx, g.maxIdx]) {
    const p = g.points[idx]
    if (!p) continue
    ctx.beginPath()
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
  return new Uint8Array(await blob.arrayBuffer())
}
