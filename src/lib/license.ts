import { todayISO } from '@/lib/utils'

function dayNumber(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** Whole days from today until an ISO date: 0 today, negative once it has passed. */
export function daysUntil(isoDate: string) {
  return Math.round(dayNumber(isoDate) - dayNumber(todayISO()))
}

/** A warning is shown this many days before a licence ends */
export const LICENSE_WARNING_DAYS = 14
