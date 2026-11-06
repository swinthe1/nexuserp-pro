import { CalendarDays } from 'lucide-react'
import * as React from 'react'
import { cn, phoneField } from '@/lib/utils'

const BASE = 'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground/70 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive'

type Props = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, Props>(({ className, type, ...props }, ref) => {
  // dates are written and shown the way people here write them (28.10.2026), whatever language the browser has
  if (type === 'date') return <DateField ref={ref} className={className} {...props} />
  return <input type={type} className={cn(BASE, phoneField(className), className)} ref={ref} {...props} />
})
Input.displayName = 'Input'

const pad = (n: number) => String(n).padStart(2, '0')
/** 2026-10-28 → 28.10.2026 */
function show(iso: string | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}
/** 28.10.2026, 28/10/26, 28-10-2026 or 28102026 → 2026-10-28; null while not a whole date */
function parse(text: string): string | null {
  const t = text.trim()
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(t)
  if (!m) { const d = /^(\d{2})(\d{2})(\d{4})$/.exec(t); if (d) m = d }
  if (!m) return null
  const day = Number(m[1]), month = Number(m[2]), year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * A date field: typed as 28.10.2026 (dots come by themselves), with the calendar one click away.
 * It speaks like the browser's date field to the code around it: value and onChange carry 2026-10-28.
 */
const DateField = React.forwardRef<HTMLInputElement, Omit<Props, 'type'>>(({ className, value, defaultValue, onChange, onBlur, min, max, disabled, name, id, required, ...rest }, ref) => {
  const iso = String(value ?? defaultValue ?? '')
  const [text, setText] = React.useState(show(iso))
  const editing = React.useRef(false)
  const picker = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => { if (!editing.current) setText(show(iso)) }, [iso])

  // the code around reads e.target.value (and react-hook-form e.target.name), as from a real date field
  const emit = (v: string) => onChange?.({ target: { value: v, name: name ?? '', type: 'date' }, currentTarget: { value: v, name: name ?? '' } } as unknown as React.ChangeEvent<HTMLInputElement>)
  const type = (raw: string) => {
    // only digits and separators; dots after the day and the month while typing
    let t = raw.replace(/[^\d./-]/g, '').slice(0, 10)
    if (/^\d{3}$/.test(t)) t = `${t.slice(0, 2)}.${t.slice(2)}`
    else if (/^\d{2}[./-]\d{3}$/.test(t)) t = `${t.slice(0, 5)}.${t.slice(5)}`
    setText(t)
    if (!t) { emit(''); return }
    const p = parse(t)
    if (p && (!min || p >= String(min)) && (!max || p <= String(max))) emit(p)
  }
  const openCalendar = () => {
    const el = picker.current
    if (!el || disabled) return
    try { el.showPicker() } catch { el.focus(); el.click() }
  }
  return (
    <div className={cn('relative', /(^|\s)(w-|max-w-|min-w-|col-span|basis-|flex-)/.test(className ?? '') ? '' : 'w-full', className)}>
      <input
        ref={ref} id={id} name={name} required={required} disabled={disabled} inputMode="numeric" autoComplete="off"
        className={cn(BASE, phoneField(className), 'pr-9 tabular-nums', /(^|\s)h-8/.test(className ?? '') && 'h-8', /(^|\s)text-xs/.test(className ?? '') && 'text-xs')}
        value={text}
        onFocus={() => { editing.current = true }}
        onChange={(e) => type(e.target.value)}
        onBlur={(e) => {
          editing.current = false
          // a half-typed date goes back to the last whole one
          const p = parse(text)
          setText(p ? show(p) : show(iso))
          onBlur?.(e)
        }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); openCalendar() } }}
        {...rest}
        // a date given as the hint (the date it takes when left empty) reads like the dates around it
        placeholder={rest.placeholder && show(String(rest.placeholder)) ? show(String(rest.placeholder)) : (rest.placeholder ?? 'dd.mm.vvvv')}
      />
      <button type="button" tabIndex={-1} disabled={disabled} onClick={openCalendar} aria-hidden
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50">
        <CalendarDays className="size-4" />
      </button>
      {/* the browser's own calendar, opened by the button; it never shows itself */}
      <input ref={picker} type="date" tabIndex={-1} aria-hidden className="pointer-events-none absolute bottom-0 right-0 size-px opacity-0"
        value={iso} min={min} max={max} onChange={(e) => { emit(e.target.value); setText(show(e.target.value)) }} />
    </div>
  )
})
DateField.displayName = 'DateField'

export { Input }
