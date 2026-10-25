#!/usr/bin/env node
// Finds UI text that is not translated and translation keys missing from the Albanian dictionary.
//
//   node scripts/i18n-check.mjs                 summary per file
//   node scripts/i18n-check.mjs -v src/features/hr   details (line numbers) for files under a path
//   node scripts/i18n-check.mjs --keys          also list dictionary keys no code uses
//
// What counts as untranslated: JSX text with letters, string literals in user-facing JSX attributes
// (title, label, description, placeholder, aria-label, …), toast messages, and object properties named
// label / title / description / header / … in module-level data, unless wrapped in t()/msg()/tn()/tr()/td().
// Skip a line deliberately with a trailing `// i18n-ignore` comment.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const esbuild = require('esbuild')

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const args = process.argv.slice(2)
const verbose = args.includes('-v')
const listUnused = args.includes('--keys')
const filter = args.find((a) => !a.startsWith('-'))

const ATTRS = new Set(['title', 'label', 'description', 'placeholder', 'aria-label', 'confirmLabel', 'cancelLabel', 'emptyText', 'emptyMessage',
  'alt', 'tooltip', 'hint', 'subtitle', 'heading', 'text', 'question', 'caption', 'helper', 'helpText', 'noResults', 'searchPlaceholder', 'filterLabel', 'unit', 'suffix', 'prefixLabel', 'action', 'actionLabel', 'loadingText'])
const PROPS = new Set(['label', 'title', 'description', 'header', 'placeholder', 'hint', 'question', 'help', 'emptyText', 'subtitle', 'caption', 'tooltip', 'confirmLabel', 'text', 'message', 'body', 'heading', 'unitLabel', 'short', 'long', 'area', 'success', 'error'])
const KEY_FNS = new Set(['t', 'msg', 'tr'])
const SKIP_PARENT_FNS = new Set(['t', 'msg', 'tr', 'tn', 'td', 'tEnum', 'tServer', 'cn', 'clsx', 'twMerge', 'cva', 'console', 'require', 'import', 'useQuery', 'eq', 'select', 'order', 'from', 'rpc', 'invalidateQueries', 'setItem', 'getItem', 'querySelector', 'addEventListener', 'Error'])

const hasLetters = (s) => /\p{L}{2,}/u.test(s)
const KEEP = /^(Excel|CSV|PDF|XLSX|NexusERP( Pro)?|DrisPRO|Ctrl|Shqip|English|SQ|EN|OK|Email|NIPT|NUI|TVSH|IBAN|SWIFT|QR|TCR|NIVF|NSLF|IIC|FIC|DUD|EUR|ALL|USD|kg|km|m³|h)$/
const looksLikeCode = (s) => KEEP.test(s.trim()) || /^[A-Z0-9_./%:#-]{1,6}$/.test(s.trim()) || /^[a-z0-9_.:/-]+$/.test(s.trim()) || /^(https?:|mailto:|\/)/.test(s.trim()) || /^[\s\p{P}\p{S}\d]*$/u.test(s)

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(tsx?|mts)$/.test(e.name)) out.push(p)
  }
  return out
}

async function loadDict() {
  const dir = path.join(ROOT, 'src/i18n/sq/dict')
  const merged = {}; const origin = {}; const conflicts = []
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).sort()) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    const { code } = await esbuild.transform(src, { loader: 'ts', format: 'esm' })
    const tmp = path.join(ROOT, 'node_modules/.cache', `i18n-${f}.mjs`)
    fs.mkdirSync(path.dirname(tmp), { recursive: true })
    fs.writeFileSync(tmp, code.replace(/^import .*$/gm, ''))
    const mod = await import(pathToFileURL(tmp).href + `?v=${Date.now()}`)
    for (const [k, v] of Object.entries(mod.default)) {
      if (k in merged && merged[k] !== v) conflicts.push(`${JSON.stringify(k)}: ${origin[k]} → ${JSON.stringify(merged[k])} vs ${f} → ${JSON.stringify(v)}`)
      if (typeof v !== 'string' || !v.trim()) conflicts.push(`${JSON.stringify(k)} in ${f} has an empty translation`)
      const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join()
      if (typeof v === 'string' && ph(k.replace(/\|[\w-]+$/, '')) !== ph(v)) conflicts.push(`${JSON.stringify(k)} in ${f}: placeholders differ in ${JSON.stringify(v)}`)
      merged[k] = v; origin[k] = f
    }
  }
  return { merged, conflicts }
}

function calleeName(node) {
  const e = node.expression
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return ''
}

function insideKeyCall(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && SKIP_PARENT_FNS.has(calleeName(p))) return true
    if (ts.isJsxAttribute(p) && ['className', 'href', 'to', 'type', 'variant', 'size', 'id', 'htmlFor', 'name', 'value', 'key', 'side', 'align', 'role', 'autoComplete', 'inputMode', 'pattern', 'accept', 'target', 'rel', 'src', 'method', 'tone', 'icon', 'status', 'perm', 'orientation', 'mode', 'format', 'dataKey', 'stroke', 'fill', 'stackId', 'layout', 'position', 'anchor'].includes(p.name.getText())) return true
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return true
    if (ts.isTypeNode?.(p)) return true
    if (ts.isElementAccessExpression(p) || ts.isCaseClause(p)) return true
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return true
    if (ts.isBlock(p) || ts.isSourceFile(p)) return false
  }
  return false
}

const { merged: dict, conflicts } = await loadDict()
const used = new Set()
const files = walk(path.join(ROOT, 'src')).filter((f) => !f.includes('/components/ui/') && !f.endsWith('database.types.ts') && !f.includes('/i18n/') && !f.endsWith('.d.ts'))
const report = []
let totalUntr = 0, totalMissing = 0

for (const file of files) {
  const rel = path.relative(ROOT, file)
  const src = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lines = src.split('\n')
  const ignored = (pos) => /i18n-ignore/.test(lines[sf.getLineAndCharacterOfPosition(pos).line] ?? '')
  const untr = []; const missing = []
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
  const flag = (n, text) => { text = text.replace(/\$\{[^}]*\}/g, ' '); if (!ignored(n.getStart()) && hasLetters(text) && !looksLikeCode(text.replace(/^[`'"]|[`'"]$/g, ''))) untr.push(`${lineOf(n)}: ${text.trim().slice(0, 90)}`) }

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node)
      const strArgs = name === 'tn' ? node.arguments.slice(1, 3) : KEY_FNS.has(name) ? node.arguments.slice(0, 1) : []
      for (const a of strArgs) {
        if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) {
          used.add(a.text)
          if (!(a.text in dict)) missing.push(`${lineOf(a)}: ${a.text.slice(0, 90)}`)
        } else if (ts.isTemplateExpression(a)) untr.push(`${lineOf(a)}: t() with a template literal — use {params} instead`)
      }
      if (/^(success|error|info|warning|message|loading)$/.test(name) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText() === 'toast') {
        const a = node.arguments[0]
        if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a) || ts.isTemplateExpression(a))) flag(a, a.getText())
      }
    }
    if (ts.isJsxText(node)) {
      const text = node.getText().replace(/\s+/g, ' ')
      flag(node, text)
    }
    if (ts.isJsxAttribute(node) && node.initializer && ATTRS.has(node.name.getText())) {
      const i = node.initializer
      if (ts.isStringLiteral(i)) flag(i, i.text)
      if (ts.isJsxExpression(i) && i.expression && (ts.isStringLiteral(i.expression) || ts.isTemplateExpression(i.expression) || ts.isNoSubstitutionTemplateLiteral(i.expression))) flag(i.expression, i.expression.getText())
    }
    if (ts.isPropertyAssignment(node) && PROPS.has(node.name.getText().replace(/['"]/g, ''))) {
      const i = node.initializer
      if ((ts.isStringLiteral(i) || ts.isNoSubstitutionTemplateLiteral(i)) && !insideKeyCall(i)) flag(i, i.text)
      if (ts.isTemplateExpression(i) && !insideKeyCall(i)) flag(i, i.getText())
    }
    // string literals rendered as JSX children: {cond ? 'Yes' : 'No'}
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.parent && (ts.isConditionalExpression(node.parent) || (ts.isBinaryExpression(node.parent) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.parent.operatorToken.kind)))) {
      let p = node.parent
      while (p && (ts.isConditionalExpression(p) || ts.isBinaryExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent
      if (p && ts.isJsxExpression(p) && !(p.parent && ts.isJsxAttribute(p.parent) && !ATTRS.has(p.parent.name.getText()))) flag(node, node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  totalUntr += untr.length; totalMissing += missing.length
  if ((untr.length || missing.length) && (!filter || rel.startsWith(filter))) report.push({ rel, untr, missing })
}

report.sort((a, b) => a.rel.localeCompare(b.rel))
for (const r of report) {
  console.log(`${r.rel}  untranslated ${r.untr.length}  missing ${r.missing.length}`)
  if (verbose) {
    for (const u of r.untr) console.log(`   text  ${u}`)
    for (const m of r.missing) console.log(`   key   ${m}`)
  }
}
if (conflicts.length) { console.log(`\nDictionary problems (${conflicts.length}):`); for (const c of conflicts.slice(0, verbose ? 500 : 30)) console.log('  ' + c) }
if (listUnused) { const unused = Object.keys(dict).filter((k) => !used.has(k) && !k.startsWith('enum:') && !k.startsWith('data:')); console.log(`\nUnused keys (${unused.length}) — fine for data/server text:`); if (verbose) unused.forEach((k) => console.log('  ' + k)) }
console.log(`\nTotal: ${totalUntr} untranslated, ${totalMissing} missing keys, ${Object.keys(dict).length} dictionary entries, ${conflicts.length} dictionary problems`)
process.exitCode = totalUntr || totalMissing || conflicts.length ? 1 : 0
