import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Ban, CheckCircle2, FileQuestion, IdCard, PackageMinus, PackageX, ShieldAlert, TrendingDown, Users, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { msg, t, tn } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney } from '@/lib/utils'

type Item = { label: string; detail?: string | number | null; href?: string }
export type Check = { code: string; count: number; items: Item[]; href?: string }

/** what each check says: the title by count, why it matters, and how a detail reads */
const LOOK: Record<string, { icon: LucideIcon; one: string; many: string; why: string; detail?: (d: string | number) => string; fix?: string }> = {
  negative_stock: { icon: PackageMinus, one: msg('{n} item is below zero'), many: msg('{n} items are below zero'),
    why: msg('They were sold before the goods were received. Enter the receipt or the supplier’s invoice, so the stock and the cost are right.'),
    detail: (d) => String(d) },
  receipts_no_bill: { icon: FileQuestion, one: msg('{n} delivery from a supplier has no invoice'), many: msg('{n} deliveries from suppliers have no invoice'),
    why: msg('The goods came in more than a week ago, but the supplier’s invoice is not entered: the purchase book and the debt to the supplier are short.'),
    detail: (d) => formatDate(String(d)), fix: msg('Enter the invoice') },
  deliveries_no_invoice: { icon: PackageX, one: msg('{n} delivery to a customer is not invoiced'), many: msg('{n} deliveries to customers are not invoiced'),
    why: msg('The goods left, but no invoice was made: the money is not asked for and the sale is missing from the sales book.'),
    detail: (d) => formatDate(String(d)), fix: msg('Make the invoice') },
  partners_no_nui: { icon: IdCard, one: msg('{n} business on this year’s invoices has no NUI'), many: msg('{n} businesses on this year’s invoices have no NUI'),
    why: msg('The sales and purchase books need the NUI of a business. Open the card and find it in the register by name.'), fix: msg('Add the NUI') },
  duplicate_nui: { icon: Users, one: msg('{n} NUI belongs to two partners'), many: msg('{n} NUIs belong to two partners'),
    why: msg('The same business was entered twice: its invoices and its debt are split over two cards. Keep one and move the other’s documents to it.'),
    detail: (d) => `NUI ${d}` },
  below_cost: { icon: TrendingDown, one: msg('{n} sale this week was under cost'), many: msg('{n} sales this week were under cost'),
    why: msg('Every piece sold under cost is a loss. Check the prices and discounts on these invoices.'),
    detail: (d) => formatMoney(Number(d)) },
  guard_waved: { icon: ShieldAlert, one: msg('{n} warning was waved through this week'), many: msg('{n} warnings were waved through this week'),
    why: msg('Before posting, the guard warned and the person went on. Often that is right; when one person does it often, a few minutes together with them saves mistakes.'),
    detail: (d) => tn(Number(d), '{n} time', '{n} times') },
}

export function useBooksCheck() {
  const { companyId, can } = useCompany()
  return useQuery({ queryKey: ['books-check', companyId], enabled: !!companyId && can('invoicing.read'), staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc('books_check', { p_company: companyId! })) as unknown as Check[] })
}

/** Company › Books check: the mistakes that slipped through, each with the place to fix it. */
export function BooksCheckPage() {
  const q = useBooksCheck()
  const list = (q.data ?? []).filter((c) => LOOK[c.code])
  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <PageHeader title={t('Books check')} description={t('What slipped through, found every morning: each with why it matters and where to fix it.')} />
      {q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !list.length ? (
          <Card><CardContent className="grid justify-items-center gap-2 p-10 text-center">
            <CheckCircle2 className="size-8 text-success" />
            <p className="font-medium">{t('Nothing to check. The books look clean.')}</p>
          </CardContent></Card>
        ) : list.map((c) => {
          const look = LOOK[c.code]!
          const Icon = look.icon
          return (
            <Card key={c.code}>
              <CardContent className="grid gap-3 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-warning/10 text-warning"><Icon className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{tn(c.count, look.one, look.many)}</div>
                    <p className="text-[13px] text-muted-foreground">{t(look.why)}</p>
                  </div>
                  {c.href && <Button variant="outline" size="sm" asChild className="shrink-0"><Link to={c.href}>{t('See all')} <ArrowRight /></Link></Button>}
                </div>
                {c.items.length > 0 && (
                  <ul className="divide-y rounded-md border">
                    {c.items.map((i, k) => (
                      <li key={k} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                        <span className="min-w-0 flex-1 truncate">{i.label}</span>
                        {i.detail != null && look.detail && <span className="shrink-0 tabular-nums text-muted-foreground">{look.detail(i.detail)}</span>}
                        {i.href && <Button variant="ghost" size="xs" asChild><Link to={i.href}>{look.fix ? t(look.fix) : t('Fix it')}</Link></Button>}
                      </li>
                    ))}
                  </ul>
                )}
                {c.count > c.items.length && <p className="text-xs text-muted-foreground">{t('and {n} more', { n: c.count - c.items.length })}</p>}
              </CardContent>
            </Card>
          )
        })}
      {list.length > 0 && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Ban className="size-3.5" />{t('Nothing here is changed by itself: you decide each one.')}</p>}
    </div>
  )
}
