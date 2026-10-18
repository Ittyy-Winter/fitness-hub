import { config } from './config.ts'

// Calendar days as 'YYYY-MM-DD' strings in Asia/Bangkok, the hub's only notion of a day.

export const today = (): string => new Date().toLocaleDateString('en-CA', { timeZone: config.timeZone })

export const addDays = (day: string, n: number): string => {
  const d = new Date(day + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000)
