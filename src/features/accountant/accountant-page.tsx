import { useQuery } from '@tanstack/react-query'
import { AlertCircle, ArrowRight, Banknote, CalendarClock, CheckCircle2, FilePen, FileText, HandCoins, ReceiptText, ScanText, Search } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { t, tn, tServer } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney } from '@/lib/utils'

type Client = {
  id: string; name: string; country: string; currency: string; outside: boolean
  bank_lines: number; expenses: number; supplier_reads: number; draft_bills: number; draft_invoices: number; overdue: number
  last_entry: string | null; open_periods: string | null; todo: number
  deadline: { obligation: 'vat' | 'payroll'; period: string; due: string; status: string; days: number } | null
}

export function useAccountantClients(enabled = true) {
  return useQuery({ queryKey: ['accountant-overview'], enabled, staleTime: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('accountant_overview')) as unknown as Client[] })
}

/** An accountant's companies on one page: what waits in each, one click to the right place. */
export function AccountantPage() {
  const q = useAccountantClients()
  const { switchCompany, companyId } = useCompany()
  const navigate = useNavigate()
  const [search, setSearch] = React.useState('')
  const open = async (id: string, href: string) => { if (id !== companyId) await switchCompany(id); navigate(href) }
  const rows = (q.data ?? []).filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.todo - a.todo || a.name.localeCompare(b.name))
  const total = (q.data ?? []).reduce((s, c) => s + c.todo, 0)
  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <PageHeader title={t('My clients')} description={t('Every company you keep the books of, with what waits in each one. Click a line to open that company at the right page.')} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Find a client')} aria-label={t('Find a client')} /></div>
        {q.data && <span className="text-[13px] text-muted-foreground">{tn(q.data.length, '{n} company', '{n} companies')} · {total ? tn(total, '{n} thing waits for you', '{n} things wait for you') : t('nothing waits for you')}</span>}
      </div>
      {q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !rows.length ? <EmptyState title={t('No companies yet')} description={t('When a company invites you as their accountant, it appears here.')} />
        : <div className="grid gap-3">{rows.map((c) => <ClientCard key={c.id} c={c} current={c.id === companyId} open={(href) => void open(c.id, href)} />)}</div>}
    </div>
  )
}

function ClientCard({ c, current, open }: { c: Client; current: boolean; open: (href: string) => void }) {
  const items: { show: boolean; icon: typeof Banknote; text: string; href: string; tone?: 'warn' | 'bad' }[] = [
    { show: c.bank_lines > 0, icon: Banknote, text: tn(c.bank_lines, '{n} bank line to match', '{n} bank lines to match'), href: '/finance/bank' },
    { show: c.expenses > 0, icon: ReceiptText, text: tn(c.expenses, '{n} receipt to book', '{n} receipts to book'), href: '/finance/expenses' },
    { show: c.supplier_reads > 0, icon: ScanText, text: tn(c.supplier_reads, '{n} supplier invoice read, not received', '{n} supplier invoices read, not received'), href: '/inventory/read-invoice' },
    { show: c.draft_bills > 0, icon: FilePen, text: tn(c.draft_bills, '{n} vendor bill in draft', '{n} vendor bills in draft'), href: '/procurement/bills' },
    { show: c.draft_invoices > 0, icon: FileText, text: tn(c.draft_invoices, '{n} sales invoice in draft', '{n} sales invoices in draft'), href: '/sales/invoices' },
    { show: c.overdue > 0, icon: HandCoins, text: t('{amount} overdue from customers, with VAT', { amount: `${formatMoney(c.overdue)} ${c.currency}` }), href: '/finance/receivables', tone: 'warn' },
  ]
  const d = c.deadline
  return (
    <Card className={cn(current && 'ring-1 ring-primary/40')}>
      <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><span className="truncate font-semibold">{c.name}</span>{c.outside && <Badge variant="outline" className="shrink-0">{t('outside accountant')}</Badge>}</div>
          <div className="text-xs text-muted-foreground">{c.country === 'AL' ? t('Albania') : t('Kosovo')} · {c.currency}{c.last_entry ? ` · ${t('last entry {date}', { date: formatDate(c.last_entry) })}` : ''}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {d && <button type="button" onClick={() => open('/tax')}
            className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px]', d.days < 0 ? 'border-destructive/40 bg-destructive/5 text-destructive' : d.days <= 7 ? 'border-warning/40 bg-warning/10' : 'hover:bg-muted')}>
            <CalendarClock className="size-3.5" />
            {d.days < 0 ? t('{what} {period} is overdue', { what: d.obligation === 'vat' ? t('VAT') : t('Payroll declaration'), period: d.period })
              : t('{what} {period} due {date}', { what: d.obligation === 'vat' ? t('VAT') : t('Payroll declaration'), period: d.period, date: formatDate(d.due) })}
          </button>}
          {items.filter((i) => i.show).map((i) => (
            <button key={i.href} type="button" onClick={() => open(i.href)}
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] hover:bg-muted', i.tone === 'warn' && 'border-warning/40')}>
              <i.icon className="size-3.5 text-muted-foreground" />{i.text}</button>
          ))}
          {!d && !items.some((i) => i.show) && <span className="inline-flex items-center gap-1.5 text-[13px] text-success"><CheckCircle2 className="size-4" />{t('Nothing waits here')}</span>}
          {c.open_periods && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><AlertCircle className="size-3.5" />{t('Not closed: {periods}', { periods: c.open_periods.split(', ').map((x) => tServer(x)).join(', ') })}</span>}
        </div>
        <Button variant={current ? 'secondary' : 'outline'} onClick={() => open('/finance')}>{current ? t('Open now') : t('Open')} <ArrowRight /></Button>
      </CardContent>
    </Card>
  )
}
