import { Calculator as CalcIcon, Copy, Delete, History } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumberWith, t } from '@/i18n'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ the arithmetic (no eval) */
/**
 * + − × ÷ with the usual order, brackets, a minus in front of a number, and the percent as on a
 * shop calculator: 200 + 10% = 220, 200 − 10% = 180, 200 × 10% = 20, 10% alone = 0.1.
 */
export function calculate(src: string): number | null {
  const s = src.replace(/\s+/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '.')
  if (!s) return null
  let i = 0
  const peek = () => s[i]
  type V = { v: number; pct: boolean }
  const number = (): V => {
    if (peek() === '(') { i++; const v = expr(); if (peek() === ')') i++; return pctOf({ v, pct: false }) }
    const m = /^\d*\.?\d+|^\d+\./.exec(s.slice(i))
    if (!m) throw new Error('number')
    i += m[0].length
    return pctOf({ v: Number(m[0]), pct: false })
  }
  const pctOf = (x: V): V => (peek() === '%' ? (i++, { v: x.v / 100, pct: true }) : x)
  const unary = (): V => {
    if (peek() === '-') { i++; const x = unary(); return { v: -x.v, pct: x.pct } }
    if (peek() === '+') { i++; return unary() }
    return number()
  }
  const term = (): V => {
    let left = unary()
    while (peek() === '*' || peek() === '/') {
      const op = s[i++]
      const right = unary()
      left = { v: op === '*' ? left.v * right.v : right.v === 0 ? NaN : left.v / right.v, pct: false }
    }
    return left
  }
  function expr(): number {
    let left = term().v
    while (peek() === '+' || peek() === '-') {
      const op = s[i++]
      const right = term()
      // a percent added or taken away is a percent of what is there
      const r = right.pct ? left * right.v : right.v
      left = op === '+' ? left + r : left - r
    }
    return left
  }
  try {
    const v = expr()
    if (i < s.length || !Number.isFinite(v)) return null
    return Math.round(v * 1e10) / 1e10
  } catch { return null }
}

const HISTORY_KEY = 'drispro.calculator.history'
type Line = { expr: string; result: number }
const readHistory = (): Line[] => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as Line[] } catch { return [] } }
const saveHistory = (h: Line[]) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 12))) } catch { /* private window */ } }

const show = (n: number) => formatNumberWith(n, { maximumFractionDigits: 6 })
/** a typed number back to the way it is written in the line (a dot inside, the locale's comma shown) */
const pretty = (e: string) => e.replace(/\*/g, '×').replace(/\//g, '÷').replace(/(\d)-/g, '$1−').replace(/\./g, formatNumberWith(1.5).includes(',') ? ',' : '.')

/* ------------------------------------------------------------------ the calculator */
export function CalculatorButton() {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t('Calculator')}><CalcIcon /></Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('Calculator')}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[300px] p-3" onOpenAutoFocus={(e) => e.preventDefault()}>
        <CalculatorPad onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

function CalculatorPad({ onClose }: { onClose: () => void }) {
  const { company } = useCompany()
  const vat = company?.country_code === 'AL' ? 20 : 18
  const [e, setE] = React.useState('')
  const [done, setDone] = React.useState<Line | null>(null)
  const [history, setHistory] = React.useState<Line[]>(readHistory)
  const [showHistory, setShowHistory] = React.useState(false)
  const box = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { box.current?.focus() }, [])

  const live = calculate(e)
  const value = done && !e ? done.result : live

  const type = (k: string) => {
    setShowHistory(false)
    // after "=", a number starts again, an operation goes on from the result
    const base = done && !e ? (/[\d.(]/.test(k) ? '' : String(done.result)) : e
    if (done && !e) setDone(null)
    if (/[+\-*/]/.test(k) && /[+\-*/]$/.test(base)) { setE(base.slice(0, -1) + k); return }
    if (k === '.' && /\.\d*$/.test(base)) { setE(base); return }
    setE(base + k)
  }
  const equals = () => {
    const r = calculate(e)
    if (r === null || !e) return
    const line = { expr: e, result: r }
    setDone(line); setE('')
    const h = [line, ...history.filter((x) => x.expr !== e)]
    setHistory(h); saveHistory(h)
  }
  const back = () => { if (done && !e) { setDone(null); return } setE((x) => x.slice(0, -1)) }
  const clear = () => { setE(''); setDone(null) }
  const withVat = (add: boolean) => {
    const v = value
    if (v === null) return
    const r = Math.round((add ? v * (1 + vat / 100) : v / (1 + vat / 100)) * 1e6) / 1e6
    const line = { expr: `${pretty(String(v))} ${add ? '+' : '−'} ${t('VAT')} ${vat}%`, result: r }
    setDone(line); setE('')
    const h = [line, ...history]; setHistory(h); saveHistory(h)
  }
  const copy = async () => {
    if (value === null) return
    const text = formatNumberWith(value, { maximumFractionDigits: 6, useGrouping: false })
    try { await navigator.clipboard.writeText(text); toast.success(t('Copied {value}', { value: text })) } catch { toast.error(t('Could not copy')) }
  }

  const onKey = (ev: React.KeyboardEvent) => {
    const k = ev.key
    if (/^[\d+\-*/().%]$/.test(k)) { ev.preventDefault(); type(k); return }
    if (k === ',') { ev.preventDefault(); type('.'); return }
    if (k === 'Enter' || k === '=') { ev.preventDefault(); equals(); return }
    if (k === 'Backspace') { ev.preventDefault(); back(); return }
    if (k === 'Delete') { ev.preventDefault(); clear(); return }
    if (k === 'Escape') { ev.preventDefault(); onClose() }
    if ((ev.ctrlKey || ev.metaKey) && k.toLowerCase() === 'c') { ev.preventDefault(); void copy() }
  }

  const keys: { k: string; label?: React.ReactNode; tone?: 'op' | 'eq' | 'muted'; span?: boolean; aria?: string }[] = [
    { k: 'C', tone: 'muted', aria: t('Clear') }, { k: 'back', label: <Delete className="size-4" />, tone: 'muted', aria: t('Delete the last digit') }, { k: '%', tone: 'muted' }, { k: '/', label: '÷', tone: 'op' },
    { k: '7' }, { k: '8' }, { k: '9' }, { k: '*', label: '×', tone: 'op' },
    { k: '4' }, { k: '5' }, { k: '6' }, { k: '-', label: '−', tone: 'op' },
    { k: '1' }, { k: '2' }, { k: '3' }, { k: '+', label: '+', tone: 'op' },
    { k: '0', span: true }, { k: '.', label: formatNumberWith(1.5).includes(',') ? ',' : '.' }, { k: '=', tone: 'eq' },
  ]
  const press = (k: string) => (k === 'C' ? clear() : k === 'back' ? back() : k === '=' ? equals() : type(k))

  return (
    <div ref={box} tabIndex={-1} onKeyDown={onKey} className="outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0" aria-label={t('Calculator')}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold">{t('Calculator')}</span>
        <div className="flex gap-0.5">
          <Button variant="ghost" size="icon-sm" aria-label={t('Earlier calculations')} aria-pressed={showHistory} onClick={() => setShowHistory((x) => !x)} disabled={!history.length}><History /></Button>
          <Button variant="ghost" size="icon-sm" aria-label={t('Copy the result')} onClick={() => void copy()} disabled={value === null}><Copy /></Button>
        </div>
      </div>
      <div className="mb-2 rounded-md border bg-muted/40 px-3 py-2 text-right" aria-live="polite">
        <div className="h-4 truncate text-xs text-muted-foreground">{done && !e ? `${pretty(done.expr)} =` : pretty(e) || ' '}</div>
        <div className={cn('truncate text-2xl font-semibold tabular', value === null && e && 'text-muted-foreground')}>{value === null ? (e ? '…' : '0') : show(value)}</div>
      </div>
      {showHistory ? (
        <div className="max-h-[260px] overflow-y-auto rounded-md border">
          {history.map((h, idx) => (
            <button key={idx} type="button" className="flex w-full flex-col items-end border-b px-3 py-1.5 text-right last:border-0 hover:bg-muted"
              onClick={() => { setDone(h); setE(''); setShowHistory(false); box.current?.focus() }}>
              <span className="text-xs text-muted-foreground">{pretty(h.expr)} =</span>
              <span className="font-medium tabular">{show(h.result)}</span>
            </button>
          ))}
          <button type="button" className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive" onClick={() => { setHistory([]); saveHistory([]); setShowHistory(false) }}>{t('Clear the list')}</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-1.5">
            {keys.map((x) => (
              <button key={x.k} type="button" aria-label={x.aria ?? (typeof x.label === 'string' ? x.label : x.k)} onClick={() => { press(x.k); box.current?.focus() }}
                className={cn('flex h-10 items-center justify-center rounded-md border text-base font-medium shadow-sm transition-colors active:scale-[.97]',
                  x.span && 'col-span-2',
                  x.tone === 'op' ? 'bg-primary/10 text-primary hover:bg-primary/20' : x.tone === 'eq' ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                    : x.tone === 'muted' ? 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground' : 'bg-card hover:bg-muted')}>
                {x.label ?? x.k}
              </button>
            ))}
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => { withVat(true); box.current?.focus() }} disabled={value === null}>{t('+ VAT {pct}%', { pct: vat })}</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => { withVat(false); box.current?.focus() }} disabled={value === null}>{t('Without VAT {pct}%', { pct: vat })}</Button>
          </div>
        </>
      )}
      <p className="mt-2 text-2xs text-muted-foreground">{t('Type with the keyboard; Enter gives the result, Esc closes.')}</p>
    </div>
  )
}
