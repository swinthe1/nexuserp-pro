/**
 * One line becomes a task: "Porosit kafe nesër @Ilir !lartë #Vitrina"
 *   a day word (sot, nesër, pasnesër, a weekday, 15.11) → the due date
 *   @name → the person (matched against the people one may give tasks to)
 *   !urgjent / !lartë / !ulët → the priority, #word → a tag
 * English words work too (today, tomorrow, monday, !high…).
 */
import type { Person } from './api'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const plus = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d }
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
// ISO weekday 1 = Monday
const WEEKDAYS: [RegExp, number][] = [
  [/^(e\s+)?hene$|^monday$|^mon$/, 1], [/^(e\s+)?marte$|^tuesday$|^tue$/, 2], [/^(e\s+)?merkure$|^wednesday$|^wed$/, 3],
  [/^(e\s+)?enjte$|^thursday$|^thu$/, 4], [/^(e\s+)?premte$|^friday$|^fri$/, 5], [/^(e\s+)?shtune$|^saturday$|^sat$/, 6], [/^(e\s+)?diel$|^sunday$|^sun$/, 7],
]
const PRIO: Record<string, number> = { urgjent: 3, urgent: 3, larte: 2, high: 2, normal: 1, ulet: 0, low: 0 }

export type Parsed = { title: string; due_date: string | null; assignee_id: string | null; priority: number | null; tags: string[]; hints: string[]; unknown: string | null }

export function parseQuick(line: string, people: Person[]): Parsed {
  const out: Parsed = { title: '', due_date: null, assignee_id: null, priority: null, tags: [], hints: [], unknown: null }
  let words = line.trim().split(/\s+/)
  const keep: string[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!, f = fold(w)
    if (w.startsWith('@') && w.length > 1) {
      const name = fold(w.slice(1))
      const hit = people.find((p) => p.assignable && fold(p.name).split(/\s+/).some((part) => part.startsWith(name)))
      if (hit) { out.assignee_id = hit.user_id; out.hints.push(`@${hit.name}`); continue }
      out.unknown = w.slice(1)
    }
    if (w.startsWith('!') && PRIO[fold(w.slice(1))] != null) { out.priority = PRIO[fold(w.slice(1))]!; continue }
    if (w.startsWith('#') && w.length > 1) { out.tags.push(w.slice(1)); continue }
    if (!out.due_date) {
      if (f === 'sot' || f === 'today') { out.due_date = iso(plus(0)); continue }
      if (f === 'neser' || f === 'tomorrow') { out.due_date = iso(plus(1)); continue }
      if (f === 'pasneser') { out.due_date = iso(plus(2)); continue }
      // "e hënë" is two words
      const two = f === 'e' && i + 1 < words.length ? `e ${fold(words[i + 1]!)}` : null
      const day = WEEKDAYS.find(([re]) => re.test(two ?? f))
      if (day) {
        const today = (new Date().getDay() + 6) % 7 + 1
        out.due_date = iso(plus(((day[1] - today + 7) % 7) || 7)); if (two) i++; continue
      }
      const dm = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/.exec(w)
      if (dm) {
        const now = new Date(), y = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : now.getFullYear()
        const d = new Date(y, Number(dm[2]) - 1, Number(dm[1]))
        if (!dm[3] && d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d.setFullYear(y + 1)
        if (!Number.isNaN(d.getTime())) { out.due_date = iso(d); continue }
      }
    }
    keep.push(w)
  }
  words = keep
  out.title = words.join(' ').trim()
  return out
}
