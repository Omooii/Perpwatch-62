// Number formatting for the 576x288 monochrome lens display.
// Everything here is display-only: no rounding is ever fed back into logic.

/** Price with adaptive precision: BTC 61,479.5 / ETH 1,724.05 / LIT 3.3115 / kPEPE 0.003428 */
export function fmtPx(px: number): string {
  if (!isFinite(px)) return '--'
  const abs = Math.abs(px)
  let decimals: number
  if (abs >= 1000) decimals = 1
  else if (abs >= 100) decimals = 2
  else if (abs >= 1) decimals = 3
  else if (abs >= 0.01) decimals = 4
  else decimals = 6
  return px.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Signed USD amount: -$2,930 / +$4,024.64 / $0.00 */
export function fmtUsd(v: number, showSign = true): string {
  if (!isFinite(v)) return '--'
  const abs = Math.abs(v)
  const decimals = abs >= 1000 ? 0 : 2
  const body = abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  const sign = showSign ? (v < 0 ? '-' : v > 0 ? '+' : '') : v < 0 ? '-' : ''
  return `${sign}$${body}`
}

/** Unsigned USD amount with commas: $704,943 */
export function fmtUsdPlain(v: number): string {
  if (!isFinite(v)) return '--'
  return `$${Math.round(v).toLocaleString('en-US')}`
}

/** Percent with one decimal: 37.3% / -7.6% */
export function fmtPct(v: number): string {
  if (!isFinite(v)) return '--'
  return `${v.toFixed(1)}%`
}

/** Funding rate as a percent with 4 decimals: +0.0013% */
export function fmtFundingRate(r: number): string {
  if (!isFinite(r)) return '--'
  return `${r >= 0 ? '+' : ''}${(r * 100).toFixed(4)}%`
}

/** Compact size: 25 / 2,500 / 100,014 / 0.2678 */
export function fmtSize(sz: number): string {
  if (!isFinite(sz)) return '--'
  const abs = Math.abs(sz)
  const decimals = abs >= 1000 ? 0 : abs >= 10 ? 1 : 4
  return sz.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** HH:MM 24h clock for the footer. */
export function fmtClock(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}
