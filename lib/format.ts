const pad = (n: number, width = 4) => String(n).padStart(width, '0')

export const smCode = (id: number) => `SM-${pad(id)}`
export const transferCode = (id: number) => `TRF-${pad(id)}`

const qtyFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 })

export const formatQty = (n: number | null | undefined) => qtyFormatter.format(n ?? 0)

export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000

export function formatDate(value: string | null | undefined) {
  if (!value) return ''
  const [y, m, d] = value.split('-')
  if (!y || !m || !d) return value
  return `${d}-${m}-${y}`
}

export function monthLabel(value: string) {
  const [y, m] = value.split('-').map(Number)
  if (!y || !m) return value
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' })
}

export const todayISO = () => {
  const d = new Date()
  const offsetMs = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10)
}
