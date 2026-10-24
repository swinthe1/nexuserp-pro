import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { t } from '@/i18n'
import { cn, initials, currencyLabel } from '@/lib/utils'

export function CompanyMark({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground', className)}>
      {initials(name)}
    </span>
  )
}

export function CompanySwitcher({ collapsed }: { collapsed?: boolean }) {
  const { companies, company, switchCompany } = useCompany()
  const navigate = useNavigate()
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
              <span className="block text-xs text-muted-foreground">{company.country_code === 'XK' ? t('Kosovo') : company.country_code === 'AL' ? t('Albania') : company.country_code} · {currencyLabel(company.base_currency)}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start">
        <DropdownMenuLabel>{t('Companies')}</DropdownMenuLabel>
        {companies.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => { void switchCompany(c.id); navigate('/') }}>
            <CompanyMark name={c.name} className="size-6 text-[10px]" />
            <span className="flex-1 truncate">{c.name}</span>
            {c.id === company.id && <Check className="!text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/onboarding')}>
          <Plus /> {t('Create a company')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
