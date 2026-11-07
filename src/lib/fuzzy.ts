/**
 * Search that forgives: "qumesht fresket 1l" finds "Qumësht i freskët 2,8% 1 L", "kokakola" finds
 * "Coca-Cola 0,5 L", "detergjent enesh" finds "Detergjent enësh 1 L".
 *   · ë/e, ç/c and the case do not matter; punctuation is a space; "1l" is "1 l", "2,8" is "2.8"
 *   · the words may come in any order, and each may be the start of a word ("kac" → "Kaçkavall")
 *   · a word longer than three letters may have a typo (one wrong letter; two in long words), or be
 *     written the way it sounds (c/k/q, x/ks, sh/s, dh/d, double letters)
 *   · a code or barcode typed whole wins over everything
 *   · numbers match only as numbers: "1" is not a typo of "2"
 * All words must match; when nothing matches them all, the items that match most of them come back.
 * Runs on the device (the till works offline), fast enough for tens of thousands of items.
 */

export function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/(^|\s)\.+|\.+(?=\s|$)/g, ' ')
    .trim()
}

/** how a word sounds, for typing it the way it is said */
export function sound(w: string): string {
  return w
    .replace(/sh/g, 's').replace(/zh/g, 'z').replace(/dh/g, 'd').replace(/th/g, 't').replace(/gj/g, 'g').replace(/nj/g, 'n').replace(/xh/g, 'x')
    .replace(/ck|q|c/g, 'k').replace(/x/g, 'ks').replace(/y/g, 'i').replace(/w/g, 'v').replace(/ph/g, 'f')
    .replace(/(.)\1+/g, '$1')
}

const isNum = (w: string) => /^\d+(\.\d+)?$/.test(w)

/** Damerau–Levenshtein distance, stopping early once it passes max */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const n = a.length, m = b.length
  let prev2: number[] = [], prev = Array.from({ length: m + 1 }, (_, j) => j)
  for (let i = 1; i <= n; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1)
      cur.push(v)
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev2 = prev; prev = cur
  }
  return prev[m]!
}

export interface Indexed { words: string[]; sounds: string[]; pairs: string[]; codes: Set<string> }

/** the searchable form of a thing: its text and its codes (sku, barcodes, supplier codes) */
export function indexOf(text: string, codes: (string | null | undefined)[] = []): Indexed {
  const words = normalize(text).split(' ').filter(Boolean)
  const all = [...words, ...codes.flatMap((c) => normalize(c).split(' ')).filter(Boolean)]
  const pairs: string[] = []
  for (let i = 0; i + 1 < words.length; i++) pairs.push(words[i]! + words[i + 1]!)
  return { words: all, sounds: all.map(sound), pairs: pairs.map(sound), codes: new Set(codes.filter(Boolean).map((c) => String(c).trim().toLowerCase())) }
}

export interface Query { raw: string; words: string[]; sounds: string[] }
export function queryOf(q: string): Query {
  const words = normalize(q).split(' ').filter(Boolean)
  return { raw: q.trim().toLowerCase(), words, sounds: words.map(sound) }
}

/** how well one word of the question fits one word of a thing: 0 = not at all */
function termScore(w: string, ws: string, num: boolean, t: string, ts: string): number {
  if (t === w) return 10
  if (t.startsWith(w)) return w.length >= 2 || num ? 8 : 6
  // the end of a document number: "12" finds FAT-2026-00012
  if (num) return w.length >= 2 && t.includes(w) ? 5 : 0
  if (w.length >= 3 && t.includes(w)) return 5
  if (w.length >= 3) {
    if (ts === ws || ts.startsWith(ws)) return 6
    // a typo keeps the word's start most of the time: only then is the distance worth measuring
    if (w.length >= 4 && !isNum(t) && (ts[0] === ws[0] || ts[1] === ws[1])) {
      const max = w.length >= 8 ? 2 : 1
      // the whole word, or its start as long as what was typed (a word typed half, with a typo)
      if (distance(ws, ts, max) <= max || (ts.length > ws.length && distance(ws, ts.slice(0, ws.length), max) <= max)) return 4
    }
  }
  return 0
}

/** a question word with what it already knows of the words it met (most words repeat across items) */
interface Term { w: string; ws: string; num: boolean; seen: Map<string, number>; pairs: Map<string, number> }
const termOf = (w: string, ws: string): Term => ({ w, ws, num: isNum(w), seen: new Map(), pairs: new Map() })

function wordScore(q: Term, x: Indexed): number {
  let best = 0, at = -1
  for (let i = 0; i < x.words.length && best < 10; i++) {
    const t = x.words[i]!
    let s = q.seen.get(t)
    if (s === undefined) { s = termScore(q.w, q.ws, q.num, t, x.sounds[i]!); q.seen.set(t, s) }
    if (s > best) { best = s; at = i }
  }
  // the name's first word is what it is ("Qumësht i freskët" before "Çokollatë qumështi"): a half point, only to order equals
  if (best > 0 && at === 0) return best + 0.5
  // two words written as one: "cocacola", "kokakola"
  if (best < 4 && !q.num && q.w.length >= 6) {
    const max = q.w.length >= 8 ? 2 : 1
    for (const p of x.pairs) {
      let s = q.pairs.get(p)
      if (s === undefined) { s = p === q.ws || (p[0] === q.ws[0] && distance(q.ws, p, max) <= max) ? 5 : 0; q.pairs.set(p, s) }
      if (s > best) { best = s; break }
    }
  }
  return best
}

export interface Match { score: number; matched: number }
export function score(q: Query, x: Indexed, terms: Term[] = q.words.map((w, i) => termOf(w, q.sounds[i]!))): Match {
  if (!q.words.length) return { score: 1, matched: 0 }
  if (q.raw && x.codes.has(q.raw)) return { score: 1000, matched: q.words.length }
  let total = 0, matched = 0
  for (const term of terms) {
    const s = wordScore(term, x)
    if (s > 0) { matched++; total += s }
  }
  return { score: total, matched }
}

const cache = new WeakMap<object, Indexed>()
/**
 * The things that fit the question, best first. key gives each thing's text and codes; things are
 * indexed once (by object) and kept while they live.
 */
export function fuzzyFind<T extends object>(items: readonly T[], question: string, key: (t: T) => { text: string; codes?: (string | null | undefined)[] }, limit = Infinity): T[] {
  const q = queryOf(question)
  if (!q.words.length) return limit === Infinity ? items.slice() : items.slice(0, limit)
  const full: [number, number, T][] = [], part: [number, number, T][] = []
  const need = Math.max(1, Math.ceil(q.words.length * 0.6))
  const terms = q.words.map((w, i) => termOf(w, q.sounds[i]!))
  items.forEach((it, i) => {
    let x = cache.get(it)
    if (!x) { const k = key(it); x = indexOf(k.text, k.codes); cache.set(it, x) }
    const m = score(q, x, terms)
    if (m.matched === q.words.length) full.push([m.score, i, it])
    else if (m.matched >= need && q.words.length > 1) part.push([m.score + m.matched * 100, i, it])
  })
  const list = full.length ? full : part
  list.sort((a, b) => b[0] - a[0] || a[1] - b[1])
  return (limit === Infinity ? list : list.slice(0, limit)).map((x) => x[2])
}
