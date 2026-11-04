import { Check, Filter, Plus, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t } from '@/i18n'
import { normalize } from '@/lib/fuzzy'
import { cn } from '@/lib/utils'
import { COLOURS, NO_VALUE, OPS, TWO_VALUES, type Colour, type ColumnStyle, type Getter, type Kind, type Op, type Rule } from './rules'

export const opLabel = (op: Op): string => ({
  contains: t('contains'), not_contains: t('does not contain'), equals: t('is exactly'), not_equals: t('is not'), starts: t('starts with'), ends: t('ends with'),
  in: t('is one of'), empty: t('is empty'), not_empty: t('is not empty'),
  eq: '=', ne: '≠', gt: '>', ge: '≥', lt: '<', le: '≤', between: t('between'),
  today: t('today'), yesterday: t('yesterday'), this_week: t('this week'), this_month: t('this month'), last_month: t('last month'), this_year: t('this year'),
  last_days: t('in the last … days'), on: t('on the day'), before: t('before'), after: t('after'), range: t('from … to'),
}[op])
const colourLabel = (c: Colour) => ({ red: t('Red'), orange: t('Orange'), yellow: t('Yellow'), green: t('Green'), teal: t('Teal'), blue: t('Blue'), violet: t('Violet'), grey: t('Grey') }[c])

/** the boxes for the value(s) of a comparison */
function ValueBoxes({ rule, kind, onChange, values }: { rule: Rule; kind: Kind; onChange: (r: Rule) => void; values: string[] }) {
  const [q, setQ] = React.useState('')
  if (NO_VALUE.includes(rule.op)) return null
  if (rule.op === 'in') {
    const nq = normalize(q)
    const list = values.filter((v) => !nq || normalize(v).includes(nq)).slice(0, 200)
    const chosen = new Set(rule.values ?? [])
    return (
      <div className="grid gap-1.5">
        <Input className="h-8 text-[13px]" placeholder={t('Search…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-48 overflow-y-auto rounded-md border p-1">
          {list.map((v) => (
            <label key={v} className="flex cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-[13px] hover:bg-accent">
              <input type="checkbox" className="size-4" checked={chosen.has(v)}
                onChange={(e) => { const s = new Set(chosen); if (e.target.checked) s.add(v); else s.delete(v); onChange({ ...rule, values: [...s] }) }} />
              <span className="truncate">{v || t('(empty)')}</span>
            </label>
          ))}
          {!list.length && <p className="px-1.5 py-1 text-[12px] text-muted-foreground">{t('Nothing found')}</p>}
        </div>
      </div>
    )
  }
  const type = kind === 'date' && rule.op !== 'last_days' ? 'date' : 'text'
  const mode = kind === 'number' || rule.op === 'last_days' ? 'decimal' : undefined
  return (
    <div className={cn('grid gap-1.5', TWO_VALUES.includes(rule.op) && 'grid-cols-2')}>
      <Input autoFocus className="h-8 text-[13px]" type={type} inputMode={mode} value={rule.value ?? ''} aria-label={t('Value')}
        placeholder={rule.op === 'last_days' ? '7' : TWO_VALUES.includes(rule.op) ? t('from') : ''} onChange={(e) => onChange({ ...rule, value: e.target.value })} />
      {TWO_VALUES.includes(rule.op) && <Input className="h-8 text-[13px]" type={type} inputMode={mode} value={rule.value2 ?? ''} aria-label={t('Second value')}
        placeholder={t('to')} onChange={(e) => onChange({ ...rule, value2: e.target.value })} />}
    </div>
  )
}

function OpSelect({ kind, op, onChange }: { kind: Kind; op: Op; onChange: (o: Op) => void }) {
  return (
    <Select value={op} onValueChange={(v) => onChange(v as Op)}>
      <SelectTrigger className="h-8 text-[13px]" aria-label={t('How to compare')}><SelectValue /></SelectTrigger>
      <SelectContent>{OPS[kind].map((o) => <SelectItem key={o} value={o}>{opLabel(o)}</SelectItem>)}</SelectContent>
    </Select>
  )
}

function ColourDots({ value, onChange, none }: { value?: Colour; onChange: (c: Colour | undefined) => void; none?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {none && <button type="button" onClick={() => onChange(undefined)} title={t('No colour')} aria-label={t('No colour')}
        className={cn('grid size-6 place-items-center rounded-full border text-muted-foreground', !value && 'ring-2 ring-primary ring-offset-1 ring-offset-background')}><X className="size-3" /></button>}
      {(Object.keys(COLOURS) as Colour[]).map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} title={colourLabel(c)} aria-label={colourLabel(c)} aria-pressed={value === c}
          className={cn('grid size-6 place-items-center rounded-full', COLOURS[c].dot, value === c && 'ring-2 ring-primary ring-offset-1 ring-offset-background')}>
          {value === c && <Check className="size-3 text-white" />}
        </button>
      ))}
    </div>
  )
}

/**
 * The funnel beside a column's name: filter by it (every kind of comparison for its kind of values) and
 * colour it — always, or by what it holds.
 */
export function ColumnTools({ getter, kind, rule, onRule, style, onStyle, values, filterable = true }: {
  getter: Getter; kind: Kind; rule: Rule | null; onRule: (r: Rule | null) => void; filterable?: boolean
  style: ColumnStyle | undefined; onStyle: (s: ColumnStyle | undefined) => void; values: () => string[]
}) {
  const [open, setOpen] = React.useState(false)
  const first = OPS[kind][0]!
  const [draft, setDraft] = React.useState<Rule>(rule ?? { col: getter.id, op: first })
  React.useEffect(() => { if (open) setDraft(rule ?? { col: getter.id, op: kind === 'text' ? 'contains' : kind === 'number' ? 'ge' : 'this_month' }) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const vals = React.useMemo(() => (open ? values() : []), [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const when = style?.when ?? []
  const setWhen = (w: NonNullable<ColumnStyle['when']>) => onStyle({ ...style, when: w.length ? w : undefined })
  const active = !!rule
  const coloured = !!style?.colour || when.length > 0
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={t('Filter or colour {column}', { column: getter.label })} title={t('Filter or colour')}
          onClick={(e) => e.stopPropagation()}
          className={cn('relative grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 group-hover/th:opacity-100 data-[state=open]:opacity-100',
            (active || coloured) && 'opacity-100', active && 'text-primary')}>
          <Filter className={cn('size-3.5', active && 'fill-primary/30')} />
          {coloured && !active && <span className={cn('absolute -right-0.5 -top-0.5 size-1.5 rounded-full', style?.colour ? COLOURS[style.colour].dot : 'bg-primary')} />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3" onClick={(e) => e.stopPropagation()}>
        {filterable && <div className="grid gap-2">
          <p className="text-[13px] font-medium">{t('Filter: {column}', { column: getter.label })}</p>
          <OpSelect kind={kind} op={draft.op} onChange={(op) => setDraft((d) => ({ ...d, op, ...(op === 'in' ? { value: undefined } : {}) }))} />
          <ValueBoxes rule={draft} kind={kind} values={vals} onChange={setDraft} />
          <div className="flex items-center justify-end gap-1.5">
            {active && <Button size="sm" variant="ghost" onClick={() => { onRule(null); setOpen(false) }}><X /> {t('Remove the filter')}</Button>}
            <Button size="sm" onClick={() => { onRule(draft); setOpen(false) }}>{t('Filter')}</Button>
          </div>
        </div>}
        <div className={cn('grid gap-2', filterable && 'mt-3 border-t pt-3')}>
          <p className="text-[13px] font-medium">{t('Colour of the column')}</p>
          <ColourDots none value={style?.colour} onChange={(c) => onStyle({ ...style, colour: c })} />
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="size-4" checked={!!style?.bold} onChange={(e) => onStyle({ ...style, bold: e.target.checked || undefined })} /> {t('Bold')}</label>
          <p className="mt-1 text-[13px] font-medium">{t('Colour by what it holds')}</p>
          {when.map((w, i) => (
            <div key={i} className="grid gap-1.5 rounded-md border p-2">
              <div className="flex items-center gap-1.5">
                <div className="flex-1"><OpSelect kind={kind} op={w.op} onChange={(op) => setWhen(when.map((x, j) => j === i ? { ...x, op } : x))} /></div>
                <Button size="icon" variant="ghost" className="size-8" aria-label={t('Remove')} onClick={() => setWhen(when.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
              <ValueBoxes rule={w} kind={kind} values={vals} onChange={(r) => setWhen(when.map((x, j) => j === i ? { ...x, ...r } : x))} />
              <ColourDots value={w.colour} onChange={(c) => c && setWhen(when.map((x, j) => j === i ? { ...x, colour: c } : x))} />
              <label className="flex items-center gap-2 text-[12px] text-muted-foreground"><input type="checkbox" className="size-3.5" checked={!!w.row}
                onChange={(e) => setWhen(when.map((x, j) => j === i ? { ...x, row: e.target.checked || undefined } : x))} /> {t('Colour the whole row')}</label>
            </div>
          ))}
          <Button size="sm" variant="outline" className="justify-self-start" onClick={() => setWhen([...when, { col: getter.id, op: kind === 'number' ? 'gt' : kind === 'date' ? 'before' : 'contains', colour: 'red' }])}>
            <Plus /> {t('Add a colour rule')}</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** the filters that are on, as chips over the list: what they are, and an × to take each off */
export function RuleChips({ rules, getters, onRemove, onClear }: { rules: Rule[]; getters: Map<string, Getter>; onRemove: (col: string) => void; onClear: () => void }) {
  if (!rules.length) return null
  const say = (r: Rule) => {
    if (r.op === 'in') return `${opLabel(r.op)} ${(r.values ?? []).slice(0, 3).join(', ')}${(r.values?.length ?? 0) > 3 ? ` +${r.values!.length - 3}` : ''}`
    if (NO_VALUE.includes(r.op)) return opLabel(r.op)
    if (r.op === 'last_days') return t('in the last {n} days', { n: r.value ?? '' })
    if (TWO_VALUES.includes(r.op)) return `${r.value || '…'} – ${r.value2 || '…'}`
    return `${opLabel(r.op)} ${r.value ?? ''}`
  }
  return (
    <div className="-mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
      {rules.map((r) => (
        <span key={r.col} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-accent/60 py-0.5 pl-2.5 pr-1">
          <Filter className="size-3 text-primary" />
          <span className="font-medium">{getters.get(r.col)?.label ?? r.col}</span> <span className="text-muted-foreground">{say(r)}</span>
          <button type="button" className="rounded-full p-0.5 hover:bg-background" aria-label={t('Remove the filter')} onClick={() => onRemove(r.col)}><X className="size-3" /></button>
        </span>
      ))}
      <button type="button" className="font-medium text-primary hover:underline" onClick={onClear}>{t('Remove all filters')}</button>
    </div>
  )
}
