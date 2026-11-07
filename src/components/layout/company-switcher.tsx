import { Building2, Check, ChevronsUpDown, Factory, Plus, ServerCog, Settings2, Store, Truck, Warehouse } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { startSupportVisit } from '@/components/license-banner'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useWarehouses } from '@/features/inventory/api'
import { useActiveUnit } from '@/app/active-unit'
import { t, td, tn } from '@/i18n'
import { cn, initials, currencyLabel } from '@/lib/utils'

export function CompanyMark({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#11A06E] to-[#1583C8] text-[11px] font-bold text-white shadow-[inset_0_1px_0_hsl(0_0%_100%/0.2)]', className)}>
      {initials(name)}
    </span>
  )
}

export function CompanySwitcher({ collapsed }: { collapsed?: boolean }) {
  const { companies, company, switchCompany, isSuperAdmin, selfService, can } = useCompany()
  const navigate = useNavigate()
  // the units of the company (its shops, warehouses, kitchens): what is inside the company, not other companies
  const units = (useWarehouses({ all: true }).data ?? []).filter((w) => w.is_active)
  const { multi } = useActiveUnit()
  if (!company) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring',
          collapsed && 'justify-center',
        )}
        aria-label={t('Switch company')}
      >
        <CompanyMark name={company.name} />
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold leading-tight">{company.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{company.country_code === 'XK' ? t('Kosovo') : company.country_code === 'AL' ? t('Albania') : company.country_code} · {currencyLabel(company.base_currency)}{multi && <> · {tn(units.length, '{n} unit', '{n} units')}</>}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="start">
        <DropdownMenuLabel className="flex items-center gap-1.5"><Building2 className="size-3.5" />{t('Companies')}</DropdownMenuLabel>
        <p className="px-2 pb-1.5 text-[11.5px] leading-snug text-muted-foreground">{t('A company is the business with its own NUI and its own books. Each one has its units inside: the shops, the warehouses, the restaurants.')}</p>
        {companies.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => { startSupportVisit(c.id); void switchCompany(c.id); navigate('/') }}>
            <CompanyMark name={c.name} className="size-6 text-[10px]" />
            <span className="flex-1 truncate">{c.name}</span>
            {c.id === company.id && <Check className="!text-primary" />}
          </DropdownMenuItem>
        ))}
        {/* the units of the company open now: shown under it, so the two are not taken for one another */}
        {multi && <>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-1.5"><Store className="size-3.5" />{t('Units of {name}', { name: company.name })}</DropdownMenuLabel>
        <div className="max-h-56 overflow-y-auto">
          {units.map((w) => {
            const Icon = w.warehouse_type === 'store' ? Store : w.warehouse_type === 'production' ? Factory : w.warehouse_type === 'transit' ? Truck : Warehouse
            return (
              <div key={w.id} className="flex items-center gap-2 py-1 pl-4 pr-2 text-[13px]">
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{td(w.name)}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{w.city || w.code}</span>
              </div>
            )
          })}
          {!units.length && <p className="py-1 pl-4 pr-2 text-[12px] text-muted-foreground">{t('No units yet')}</p>}
        </div>
        {can('inventory.read') && (
          <DropdownMenuItem onSelect={() => navigate('/inventory/warehouses')}><Settings2 /> {t('Add or change the units')}</DropdownMenuItem>
        )}
        </>}
        {(isSuperAdmin || selfService) && <DropdownMenuSeparator />}
        {isSuperAdmin && (
          <DropdownMenuItem onSelect={() => navigate('/platform')}>
            <ServerCog /> {t('Clients and licences')}
          </DropdownMenuItem>
        )}
        {selfService && !isSuperAdmin && (
          <DropdownMenuItem onSelect={() => navigate('/onboarding')}>
            <Plus /> {t('Create a company')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
