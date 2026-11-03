#!/usr/bin/env node
// Lists the translation keys used by the given files (t/msg/tr first argument, tn second and third), one JSON array.
//   node scripts/i18n-keys-of.mjs src/features/pos src/features/tax/pages/fiscal-page.tsx
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const KEY_FNS = new Set(['t', 'msg', 'tr'])
const walk = (p, out = []) => { if (fs.statSync(p).isDirectory()) { for (const e of fs.readdirSync(p)) walk(path.join(p, e), out) } else if (/\.(tsx?|mts)$/.test(p)) out.push(p); return out }
export function keysOf(paths) {
  const keys = new Set()
  for (const file of paths.flatMap((p) => walk(p))) {
    const src = fs.readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const e = node.expression
        const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ''
        const args = name === 'tn' ? node.arguments.slice(1, 3) : KEY_FNS.has(name) ? node.arguments.slice(0, 1) : []
        for (const a of args) if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) keys.add(a.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return [...keys]
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(keysOf(process.argv.slice(2)), null, 1))
