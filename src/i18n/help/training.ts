import type { Lesson, Track } from './types'
import { START } from './training/start'
import { CASHIER, RESTAURANT } from './training/shop'
import { APPOINTMENTS, HOTEL } from './training/hospitality'
import { PURCHASING, WAREHOUSE } from './training/stock'
import { PRODUCTION, SALES } from './training/sales'
import { ACCOUNTANT, HR, OWNER } from './training/office'

export type { Check, Lesson, Track } from './types'

/** Every training path, in the order they are shown */
export const TRACKS: Track[] = [START, CASHIER, RESTAURANT, HOTEL, APPOINTMENTS, WAREHOUSE, PURCHASING, SALES, PRODUCTION, HR, ACCOUNTANT, OWNER]
export const ALL_LESSONS: Lesson[] = TRACKS.flatMap((tr) => tr.lessons)

/**
 * The paths for a person: the ones for their roles (and "Getting started" for everyone), with only the
 * lessons `allowed` lets through (the page the licence opens, the permission, the module). Someone whose roles match no path sees them all.
 */
export function tracksFor(roleKeys: string[], allowed: (l: Lesson) => boolean = () => true, all = false) {
  const open = TRACKS.map((tr) => ({ ...tr, lessons: tr.lessons.filter(allowed) })).filter((tr) => tr.lessons.length)
  if (all) return open
  const mine = open.filter((tr) => tr.roles.some((r) => r === '*' || roleKeys.includes(r)))
  return mine.some((tr) => !tr.roles.includes('*')) ? mine : open
}

/** the lesson to do after this one: the next one not done in the same path, else the first not done anywhere */
export function nextLesson(tracks: Track[], done: Set<string>, after?: string): Lesson | null {
  const tr = after ? tracks.find((x) => x.lessons.some((l) => l.key === after)) : undefined
  if (tr) {
    const i = tr.lessons.findIndex((l) => l.key === after)
    const rest = tr.lessons.slice(i + 1).find((l) => !done.has(l.key))
    if (rest) return rest
  }
  return tracks.flatMap((x) => x.lessons).find((l) => !done.has(l.key) && l.key !== after) ?? null
}

/** the address that opens a lesson on its page */
export const lessonHref = (l: Lesson) => `${l.href}${l.href.includes('?') ? '&' : '?'}learn=${encodeURIComponent(l.key)}`
