import { Check, ChevronDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

export type PickOption = { value: string; label: string; hint?: string; indent?: boolean }

/** A filter that takes several values: "All" when nothing is chosen, else the names (or how many). */
export function MultiPick({ label, options, value, onChange, className }: {
  label: string; options: PickOption[]; value: string[]; onChange: (v: string[]) => void; className?: string
}) {
  const chosen = options.filter((o) => value.includes(o.value))
  const text = !chosen.length ? t('All') : chosen.length <= 2 ? chosen.map((o) => o.label).join(', ') : t('{n} chosen', { n: chosen.length })
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn('h-9 max-w-[260px] justify-between gap-1.5 font-normal', chosen.length && 'border-primary/50', className)}>
          <span className="text-muted-foreground">{label}:</span><span className="truncate">{text}</span>
          {chosen.length ? <X className="size-3.5 shrink-0 opacity-60" onClick={(e) => { e.stopPropagation(); onChange([]) }} /> : <ChevronDown className="size-3.5 shrink-0 opacity-60" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder={t('Search')} />
          <CommandList>
            <CommandEmpty>{t('Nothing found')}</CommandEmpty>
            {options.map((o) => {
              const on = value.includes(o.value)
              return (
                <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ''} ${o.value}`} onSelect={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}>
                  <span className={cn('grid size-4 shrink-0 place-items-center rounded border', on && 'border-primary bg-primary text-primary-foreground')}>{on && <Check className="size-3" />}</span>
                  <span className={cn('truncate', o.indent && 'pl-3 text-muted-foreground')}>{o.label}</span>
                  {o.hint && <span className="ml-auto truncate text-[11px] text-muted-foreground">{o.hint}</span>}
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
