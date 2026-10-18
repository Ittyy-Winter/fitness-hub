// Formatting in the hub's time zone. Days are 'YYYY-MM-DD' strings in Asia/Bangkok.

const TZ = 'Asia/Bangkok'
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const one = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

export const n0 = (v: number | null | undefined) => (v == null ? '–' : int.format(Math.round(v)))
export const n1 = (v: number | null | undefined) => (v == null ? '–' : one.format(v))

const dayAt = (day: string) => new Date(day + 'T12:00:00Z')

export const dayLong = (day: string) =>
  dayAt(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
export const dayShort = (day: string) =>
  dayAt(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
export const dayMonth = (day: string) =>
  dayAt(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ })

export const bangkokDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })

export const addDays = (day: string, k: number) => {
  const d = dayAt(day)
  d.setUTCDate(d.getUTCDate() + k)
  return d.toISOString().slice(0, 10)
}

/** "08:12" today, "yesterday 21:04", or "Thu 16 Oct 21:04". */
export function when(iso: string, today: string): string {
  const day = bangkokDay(iso)
  if (day === today) return clock(iso)
  if (day === addDays(today, -1)) return `yesterday ${clock(iso)}`
  return `${dayShort(day)} ${clock(iso)}`
}

export const minutes = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} m`

export const duration = (s: number) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.round(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export const pace = (sPerKm: number | null) =>
  sPerKm == null ? '–' : `${Math.floor(sPerKm / 60)}:${String(Math.round(sPerKm % 60)).padStart(2, '0')}`

export const km = (m: number | null) => (m == null ? '–' : (m / 1000).toFixed(2))

export const SOURCE_NAMES: Record<string, string> = { google_health: 'Google Health', opengym: 'openGym' }
