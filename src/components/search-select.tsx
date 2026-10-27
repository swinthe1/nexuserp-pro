import { Check, ChevronsUpDown, X } from 'lucide-react'
import * as React from 'react'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

export interface SearchOption { value: string; label: string; hint?: string; keywords?: string[] }

/** Searchable single-select (combobox). Keyboard: type to filter, ↑↓, Enter. */
export const SearchSelect = React.forwardRef<HTMLButtonElement, {
  value: string | null | undefined
  onChange: (v: string | null) => void
  options: SearchOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  clearable?: boolean
  className?: string
  /** handle Enter on a query that matches nothing (e.g. a scanned barcode) */
  onUnmatchedEnter?: (query: string) => void
  /** more results searched elsewhere as the person types (e.g. the business register); shown under their own heading */
  remote?: { heading: string; search: (query: string) => Promise<SearchOption[]>; onSelect: (option: SearchOption) => void }
  'aria-invalid'?: boolean
  id?: string
}>(function SearchSelect({ value, onChange, options, placeholder, searchPlaceholder, emptyText, disabled, clearable, className, onUnmatchedEnter, remote, ...rest }, ref) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [found, setFound] = React.useState<SearchOption[]>([])
  const searchRef = React.useRef(remote?.search)
  searchRef.current = remote?.search
  React.useEffect(() => {
    const q = query.trim()
    if (!open || !searchRef.current || q.length < 3) { setFound([]); return }
    let live = true
    const h = setTimeout(() => { void searchRef.current!(q).then((r) => { if (live) setFound(r) }).catch(() => { if (live) setFound([]) }) }, 250)
    return () => { live = false; clearTimeout(h) }
  }, [query, open])
  const selected = options.find((o) => o.value === value)
  const q = query.trim().toLowerCase()
  const filtered = q
    ? options.filter((o) => [o.label, o.hint, ...(o.keywords ?? [])].some((s) => s?.toLowerCase().includes(q))).slice(0, 100)
    : options.slice(0, 100)

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }}>
      <PopoverTrigger asChild>
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          aria-expanded={open}
          role="combobox"
          {...rest}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-left text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive',
            className,
          )}
        >
          <span className={cn('w-0 flex-1 truncate', !selected && 'text-muted-foreground/70')}>
            {selected ? <>{selected.label}{selected.hint && <span className="ml-1.5 text-muted-foreground">{selected.hint}</span>}</> : (placeholder ?? t('Choose…'))}
          </span>
          {clearable && selected && !disabled ? (
            <X className="size-3.5 shrink-0 opacity-60 hover:opacity-100" onClick={(e) => { e.stopPropagation(); onChange(null) }} />
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder ?? t('Search…')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered.length === 0 && found.length === 0 && query.trim() && onUnmatchedEnter) {
                e.preventDefault()
                onUnmatchedEnter(query.trim())
                setOpen(false)
                setQuery('')
              }
            }}
          />
          <CommandList>
            {!found.length && <CommandEmpty>{emptyText ?? t('No match.')}</CommandEmpty>}
            <CommandGroup>
              {filtered.map((o) => (
                <CommandItem key={o.value} value={o.value} onSelect={() => { onChange(o.value); setOpen(false); setQuery('') }}>
                  <Check className={cn('!size-3.5', o.value === value ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="ml-auto truncate text-xs text-muted-foreground">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
            {remote && found.length > 0 && (
              <CommandGroup heading={remote.heading}>
                {found.map((o) => (
                  <CommandItem key={`r:${o.value}`} value={`r:${o.value}`} onSelect={() => { remote.onSelect(o); setOpen(false); setQuery('') }}>
                    <span className="truncate">{o.label}</span>
                    {o.hint && <span className="ml-auto truncate text-xs text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
})
