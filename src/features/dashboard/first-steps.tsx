import { useQuery } from '@tanstack/react-query'
import { Check, ChevronRight, Rocket, X } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { msg, t } from '@/i18n'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

type Step = { key: string; done: boolean }
const STEPS: Record<string, { label: string; hint: string; href: string; perm: string }> = {
  company: { label: msg('Fill in the company data'), hint: msg('NUI, address, town and phone: they go on every invoice'), href: '/settings', perm: 'admin.write' },
  logo: { label: msg('Add the logo'), hint: msg('It goes on invoices and offers'), href: '/settings', perm: 'admin.write' },
  item: { label: msg('Add the first item'), hint: msg('Or bring them all from Excel'), href: '/inventory/products/new', perm: 'inventory.write' },
  customer: { label: msg('Add a customer'), hint: msg('Search by name or NUI in the business register'), href: '/partners/new', perm: 'partners.write' },
  sale: { label: msg('Make the first sale'), hint: msg('An invoice, or a sale at the till'), href: '/sales/invoices/new', perm: 'invoicing.write' },
  purchase: { label: msg('Record a purchase'), hint: msg('The supplier\'s invoice brings the goods into stock'), href: '/procurement/invoice/new', perm: 'invoicing.write' },
  colleague: { label: msg('Add a colleague'), hint: msg('With a username and PIN, and only the rights they need'), href: '/settings/users', perm: 'admin.write' },
  bank: { label: msg('Add the bank account'), hint: msg('Its IBAN is printed on the invoice'), href: '/finance/bank', perm: 'finance.write' },
}

/**
 * "First steps": what a new company does to reach its first invoice. Each step is ticked from the data, by
 * anyone; the list goes away when all are done or the person hides it.
 */
export function FirstSteps() {
  const { companyId, can } = useCompany()
  const key = `drispro.first-steps.hidden:${companyId ?? ''}`
  const [hidden, setHidden] = React.useState(() => { try { return localStorage.getItem(key) === '1' } catch { return false } })
  const q = useQuery({
    queryKey: ['first-steps', companyId], enabled: !!companyId && !hidden, staleTime: 30_000,
    queryFn: async () => {
      const r = await supabase.rpc('company_first_steps' as never, { p_company: companyId } as never)
      return r.error ? null : (r.data as unknown as Step[])   // a server not updated yet: no list
    },
  })
  const steps = (q.data ?? []).filter((s) => STEPS[s.key] && can(STEPS[s.key]!.perm))
  const done = steps.filter((s) => s.done).length
  if (hidden || !steps.length || done === steps.length) return null
  const hide = () => { try { localStorage.setItem(key, '1') } catch { /* private window */ } setHidden(true) }
  const next = steps.find((s) => !s.done)
  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-3">
          <Rocket className="size-4 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">{t('First steps')}</div>
            <div className="text-[12.5px] text-muted-foreground">{t('{done} of {n} done', { done, n: steps.length })}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={hide}><X /> {t('Hide')}</Button>
        </div>
        <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
        <ul className="grid gap-1 sm:grid-cols-2">
          {steps.map((s) => { const d = STEPS[s.key]!
            return (
              <li key={s.key}>
                <Link to={d.href} className={cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted', s === next && 'bg-primary/5')}>
                  <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full border', s.done ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
                    {s.done && <Check className="size-3" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13px]', s.done ? 'text-muted-foreground line-through' : 'font-medium')}>{t(d.label)}</span>
                    {!s.done && <span className="block truncate text-[12px] text-muted-foreground">{t(d.hint)}</span>}
                  </span>
                  {!s.done && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                </Link>
              </li>
            ) })}
        </ul>
      </CardContent>
    </Card>
  )
}
