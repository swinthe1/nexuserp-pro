#!/usr/bin/env node
/**
 * Checks the training and the page guides against the program:
 *   - every lesson opens a page that has a guide, has a unique key, steps, a goal and a valid question
 *   - every text has both languages
 *   - every "Show me" step that points at a button by its text names a text the screens still use
 * Run: node scripts/training-check.mjs   (exit 1 when something is wrong)
 */
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'training-check-'))
const entry = path.join(tmp, 'entry.ts')
fs.writeFileSync(entry, `export { GUIDES } from ${JSON.stringify(path.join(root, 'src/i18n/help/guides'))}\nexport { TRACKS } from ${JSON.stringify(path.join(root, 'src/i18n/help/training'))}\n`)
const out = path.join(tmp, 'bundle.mjs')
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' })
const { GUIDES, TRACKS } = await import(pathToFileURL(out).href)

const problems = []
const warn = []
const both = (x, where) => { if (!x || !String(x.sq ?? '').trim() || !String(x.en ?? '').trim()) problems.push(`${where}: missing sq or en`) }
const guideKeys = Object.keys(GUIDES)
const toRe = (k) => new RegExp('^' + k.replace(/:[^/]+/g, '[^/]+') + '$')
const guideFor = (href) => guideKeys.find((k) => toRe(k).test(href.split('?')[0]))

const seen = new Set()
for (const tr of TRACKS) {
  both(tr.title, `track ${tr.key} title`); both(tr.who, `track ${tr.key} who`)
  if (!tr.roles?.length) problems.push(`track ${tr.key}: no roles`)
  for (const l of tr.lessons) {
    const w = `lesson ${l.key}`
    if (seen.has(l.key)) problems.push(`${w}: key used twice`)
    seen.add(l.key)
    if (l.href.includes(':')) problems.push(`${w}: href ${l.href} must be a real address`)
    if (!guideFor(l.href)) warn.push(`${w}: page ${l.href} has no ⓘ guide`)
    both(l.title, `${w} title`); both(l.why, `${w} why`); both(l.goal, `${w} goal`)
    if (!l.steps?.length) problems.push(`${w}: no steps`)
    l.steps?.forEach((s, i) => both(s, `${w} step ${i + 1}`))
    if (l.practice) both(l.practice, `${w} practice`)
    if (!(l.minutes > 0)) problems.push(`${w}: minutes`)
    if (l.check) {
      both(l.check.q, `${w} question`); both(l.check.explain, `${w} explanation`)
      if (l.check.options?.length !== 3) problems.push(`${w}: the question needs three answers`)
      l.check.options?.forEach((o, i) => both(o, `${w} answer ${i + 1}`))
      if (!(l.check.answer >= 0 && l.check.answer < (l.check.options?.length ?? 0))) problems.push(`${w}: the right answer is out of range`)
    } else warn.push(`${w}: no question`)
  }
}

// the texts the screens use: t('…') and msg('…') outside the dictionaries
const src = []
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (!p.includes(`${path.sep}i18n`)) walk(p) } else if (/\.tsx?$/.test(f.name)) src.push(fs.readFileSync(p, 'utf8')) } }
walk(path.join(root, 'src'))
const all = src.join('\n')
const used = new Set([...all.matchAll(/\b(?:t|msg)\(\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\'/g, "'").split('|')[0]))
for (const [k, g] of Object.entries(GUIDES)) {
  both(g.what, `guide ${k} what`)
  g.steps.forEach((s, i) => both(s, `guide ${k} step ${i + 1}`))
  for (const s of g.tour ?? []) {
    both(s.say, `guide ${k} tour`)
    const tg = s.target
    if (!tg || /[[\]#.=>]/.test(tg) || /^(input|button|textarea|table|select)\b/.test(tg)) continue
    if (!used.has(tg)) problems.push(`guide ${k}: "Show me" points at "${tg}", which no screen shows`)
  }
}

fs.rmSync(tmp, { recursive: true, force: true })
const lessons = TRACKS.reduce((n, tr) => n + tr.lessons.length, 0)
for (const w of warn) console.log(`  note  ${w}`)
for (const p of problems) console.log(`  ERROR ${p}`)
console.log(`\n${TRACKS.length} paths, ${lessons} lessons, ${guideKeys.length} page guides: ${problems.length} problems, ${warn.length} notes`)
process.exit(problems.length ? 1 : 0)
