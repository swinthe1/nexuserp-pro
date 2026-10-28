import type { Column } from '@tanstack/react-table'
import { Check, PlusCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { FacetOption } from './types'
import { t } from '@/i18n'

/** Multi-select filter; the column must use filterFn: 'arrIncludesSome' or the shared `inFilter` */
export function FacetedFilter<TData, TValue>({ column, title, options }: { column: Column<TData, TValue>; title: string; options: FacetOption[] }) {
  const facets = column.getFacetedUniqueValues()
  const selected = new Set((column.getFilterValue() as string[] | undefined) ?? [])
  const set = (next: Set<string>) => column.setFilterValue(next.size ? Array.from(next) : undefined)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <PlusCircle />
          {title}
          {selected.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-1 h-4" />
              {selected.size > 2 ? (
                <Badge variant="secondary" className="rounded-sm">{t('{n} selected', { n: selected.size })}</Badge>
              ) : (
                options.filter((o) => selected.has(o.value)).map((o) => <Badge key={o.value} variant="secondary" className="rounded-sm">{o.label}</Badge>)
              )}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>{t('No match.')}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const on = selected.has(o.value)
                return (
                  <CommandItem
                    key={o.value}
                    onSelect={() => {
                      const next = new Set(selected)
                      if (on) next.delete(o.value)
                      else next.add(o.value)
                      set(next)
                    }}
                  >
                    <span className={cn('flex size-4 items-center justify-center rounded-[4px] border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                      {on && <Check className="!size-3 !text-primary-foreground" strokeWidth={3} />}
                    </span>
                    {o.icon && <o.icon className="size-4 text-muted-foreground" />}
                    <span className="flex-1">{o.label}</span>
                    {facets.get(o.value) !== undefined && <span className="text-xs tabular text-muted-foreground">{facets.get(o.value)}</span>}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => set(new Set())} className="justify-center">{t('Clear filter')}</CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
