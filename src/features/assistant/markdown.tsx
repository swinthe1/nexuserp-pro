import * as React from 'react'
import { Link } from 'react-router-dom'

/**
 * The few pieces of markdown the assistant writes: paragraphs, **bold**, *italic*, `code`,
 * lists, small tables and links. Links only ever go to pages inside DrisPRO (they start with "/");
 * anything else stays plain text, so an answer can never send someone to another site.
 */
export function Markdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const blocks = React.useMemo(() => parse(text), [text])
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        if (b.kind === 'table') {
          return (
            <div key={i} className="-mx-1 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead><tr>{b.head.map((h, j) => <th key={j} className="border-b px-1.5 py-1 text-left font-medium text-muted-foreground">{inline(h, onNavigate)}</th>)}</tr></thead>
                <tbody>{b.rows.map((r, k) => <tr key={k} className="border-b last:border-0">{r.map((c, j) => <td key={j} className="px-1.5 py-1 align-top tabular-nums">{inline(c, onNavigate)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )
        }
        if (b.kind === 'ul' || b.kind === 'ol') {
          const L = b.kind === 'ul' ? 'ul' : 'ol'
          return <L key={i} className={b.kind === 'ul' ? 'list-disc space-y-0.5 pl-5' : 'list-decimal space-y-0.5 pl-5'}>{b.items.map((it, j) => <li key={j}>{inline(it, onNavigate)}</li>)}</L>
        }
        if (b.kind === 'h') return <p key={i} className="font-semibold">{inline(b.text, onNavigate)}</p>
        return <p key={i} className="whitespace-pre-wrap">{inline(b.text, onNavigate)}</p>
      })}
    </div>
  )
}

type Block = { kind: 'p'; text: string } | { kind: 'h'; text: string } | { kind: 'ul'; items: string[] } | { kind: 'ol'; items: string[] } | { kind: 'table'; head: string[]; rows: string[][] }

function parse(src: string): Block[] {
  const lines = src.replace(/\r/g, '').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => { if (para.length) { out.push({ kind: 'p', text: para.join('\n') }); para = [] } }
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!
    if (!l.trim()) { flush(); continue }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]!)) {
      flush()
      const head = cells(l); const rows: string[][] = []
      i += 2
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) { rows.push(cells(lines[i]!)); i++ }
      i--
      out.push({ kind: 'table', head, rows }); continue
    }
    const ul = /^\s*[-*•]\s+(.*)$/.exec(l), ol = /^\s*\d+[.)]\s+(.*)$/.exec(l)
    if (ul || ol) {
      flush()
      const kind = ul ? 'ul' : 'ol'
      const prev = out[out.length - 1]
      const item = (ul ?? ol)![1]!
      if (prev && prev.kind === kind) prev.items.push(item); else out.push({ kind, items: [item] })
      continue
    }
    const h = /^#{1,4}\s+(.*)$/.exec(l)
    if (h) { flush(); out.push({ kind: 'h', text: h[1]! }); continue }
    para.push(l)
  }
  flush()
  return out
}

function inline(s: string, onNavigate?: () => void): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*/g
  let last = 0, m: RegExpExecArray | null, k = 0
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index))
    if (m[1] != null) {
      const href = m[2]!
      out.push(href.startsWith('/') && !href.startsWith('//')
        ? <Link key={k++} to={href} onClick={onNavigate} className="font-medium text-primary underline-offset-2 hover:underline">{m[1]}</Link>
        : m[1])
    } else if (m[3] != null) out.push(<strong key={k++} className="font-semibold">{m[3]}</strong>)
    else if (m[4] != null) out.push(<code key={k++} className="rounded bg-muted px-1 text-xs">{m[4]}</code>)
    else if (m[5] != null) out.push(<em key={k++}>{m[5]}</em>)
    last = re.lastIndex
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}
