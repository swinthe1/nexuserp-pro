// Money and quantities are written with their currency and unit ("1 250,50 €", "22 copë").
// formatMoney adds the company's currency by itself; formatQty needs the unit (or formatQtyOf the item).
// This check counts the quantities still written without a unit, file by file, against
// scripts/format-baseline.json: a file may only go down. `node scripts/format-check.mjs --update` rewrites the baseline.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = 'src'
const files = []
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(n)) files.push(p) } }
walk(root)

const bare = (s) => {
  let n = 0, i = 0
  for (;;) {
    const j = s.indexOf('formatQty(', i)
    if (j < 0) return n
    if (j > 0 && /[\w.]/.test(s[j - 1])) { i = j + 10; continue }
    let k = j + 10, d = 1, top = false
    while (k < s.length && d) { const c = s[k]; if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--; else if (c === ',' && d === 1) top = true; k++ }
    if (!top) n++
    i = k
  }
}
const now = Object.fromEntries(files.map((f) => [f, bare(readFileSync(f, 'utf8'))]).filter(([, n]) => n > 0))
const basePath = 'scripts/format-baseline.json'
if (process.argv.includes('--update')) {
  writeFileSync(basePath, JSON.stringify(now, null, 1) + '\n')
  console.log(`baseline: ${Object.values(now).reduce((a, b) => a + b, 0)} quantities without a unit in ${Object.keys(now).length} files`)
  process.exit(0)
}
const base = JSON.parse(readFileSync(basePath, 'utf8'))
const worse = Object.entries(now).filter(([f, n]) => n > (base[f] ?? 0))
const total = Object.values(now).reduce((a, b) => a + b, 0)
for (const [f, n] of worse) console.log(`${f}: ${n} quantities without a unit (was ${base[f] ?? 0}) — use formatQty(value, unit) or formatQtyOf(value, variantId)`)
console.log(`${total} quantities without a unit left (percentages, days and counts of things are fine)`)
process.exit(worse.length ? 1 : 0)
