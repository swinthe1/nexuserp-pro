import { Check, ChevronsUpDown, Factory, Layers, Store, Truck, Warehouse } from 'lucide-react'
import { useActiveUnit } from '@/app/active-unit'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { t, td } from '@/i18n'
import { cn } from '@/lib/utils'

export const unitIcon = (type: string | null | undefined) =>
  type === 'store' ? Store : type === 'production' ? Factory : type === 'transit' ? Truck : Warehouse

/** "Njësia: Të gjitha / Lider Market 2": under the company, the unit one works in now */
export function UnitPicker({ className }: { className?: string }) {
  const { unit, units, fixed, multi, set } = useActiveUnit()
  if (!multi || (units.length < 2 && !fixed)) return null
  const Icon = unit ? unitIcon(unit.warehouse_type) : Layers
  const label = unit ? td(unit.name) : t('All units')
  if (fixed) {
    return (
      <div className={cn('flex h-8 items-center gap-2 rounded-md border border-dashed px-2 text-[13px]', className)} title={t('You work in this unit')}>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-muted-foreground">{t('Unit|store')}:</span><span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      </div>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={t('Choose the unit')}
        className={cn('flex h-8 w-full items-center gap-2 rounded-md border px-2 text-left text-[13px] outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring',
          unit ? 'border-primary/40 bg-primary/5' : 'border-border bg-background/60', className)}>
        <Icon className={cn('size-4 shrink-0', unit ? 'text-primary' : 'text-muted-foreground')} />
        <span className="text-muted-foreground">{t('Unit|store')}:</span>
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-[11.5px] font-normal leading-snug text-muted-foreground">{t('The lists show this unit, and new documents take it. All units: the whole company.')}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => set(null)}>
          <Layers /> <span className="flex-1">{t('All units')}</span>{!unit && <Check className="!text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="max-h-72 overflow-y-auto">
          {units.map((w) => {
            const I = unitIcon(w.warehouse_type)
            return (
              <DropdownMenuItem key={w.id} onSelect={() => set(w.id)}>
                <I /> <span className="min-w-0 flex-1 truncate">{td(w.name)}</span>
                {w.city && <span className="text-[11px] text-muted-foreground">{w.city}</span>}
                {unit?.id === w.id && <Check className="!text-primary" />}
              </DropdownMenuItem>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
