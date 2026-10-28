import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Printer, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { PhotoCard, ReadsList, usePhotoSubmit } from '@/components/photo-reads'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTaxCodes } from '@/features/tax/api'
import { t, td, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, num, todayISO } from '@/lib/utils'

type Line = { rate: number; net: number; vat: number; tax_code_id: string | null }
type Result = { z_number?: string; device?: string; date?: string; total?: number; receipts?: number; cash?: number; card?: number; other?: number
  lines: Line[]; already: { id: string; number: string } | null }
type Read = { id: string; status: 'queued' | 'reading' | 'done' | 'failed'; error: string | null; invoice_id: string | null; invoice_number: string | null
  image: string | null; result: Result | null }
type Row = { id: string; file_name: string | null; status: string; error: string | null; z_number: string | null; device: string | null; date: string | null
  total: number | null; invoice_id: string | null; invoice_number: string | null; created_at: string }
type PayAccount = { id: string; name: string; kind: 'cash' | 'bank' }

/** The Z report of a client's own fiscal register: photographed, read, booked as the day's sales. */
export function ZReportsPage() {
  const { companyId } = useCompany()
  const [params, setParams] = useSearchParams()
  const id = params.get('id')
  const list = useQuery({
    queryKey: ['zreport-reads', companyId], enabled: !!companyId,
    refetchInterval: (q) => ((q.state.data as Row[] | undefined)?.some((r) => r.status === 'queued' || r.status === 'reading') ? 3000 : false),
    queryFn: async () => unwrap(await supabase.rpc('zreport_reads', { p_company: companyId! })) as unknown as Row[],
  })
  const { send, pick } = usePhotoSubmit({ kind: 'z_report', invalidate: [['zreport-reads', companyId]], onOne: (x) => setParams({ id: x }),
    manyMessage: (n) => t('{n} Z reports are being read', { n }) })
  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <PageHeader title={t('Z reports')} description={t('For a business with its own fiscal cash register: photograph the Z report of the day and DrisPRO books the sales by VAT rate, with the cash and the card amounts. It goes into the sales book.')} />
      <PhotoCard icon={Printer} busy={send.isPending} onPick={pick} onManual={() => setParams({ id: 'new' })} title={t('A new Z report')}
        hint={t('The whole report in the photo, flat and with light. Several days at once from the gallery.')} />
      {id ? <Review key={id} id={id === 'new' ? null : id} onDone={() => setParams({})} /> : <ReadsList bookedLabel={t('Booked|expense')} onOpen={(x) => setParams({ id: x })}
        items={(list.data ?? []).map((r) => ({ ...r, booked: !!r.invoice_id,
          title: <>{r.z_number ? t('Z report {number}', { number: r.z_number }) : r.file_name ?? t('Z report')}{r.device ? <span className="font-normal text-muted-foreground"> · {r.device}</span> : null}</> }))} />}
    </div>
  )
}

function Review({ id, onDone }: { id: string | null; onDone: () => void }) {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  const taxes = useTaxCodes()
  const q = useQuery({
    queryKey: ['zreport-read', id], enabled: !!id,
    refetchInterval: (x) => (['queued', 'reading'].includes((x.state.data as Read | undefined)?.status ?? 'queued') ? 2500 : false),
    queryFn: async () => unwrap(await supabase.rpc('zreport_read_get', { p_id: id! })) as unknown as Read,
  })
  const pay = useQuery({ queryKey: ['expense-pay', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('expense_pay_accounts', { p_company: companyId! })) as unknown as PayAccount[] })
  const r = q.data?.result ?? null
  const [f, setF] = React.useState<{ z: string; device: string; date: string; lines: Line[]; cash: string; card: string; cashAcc: string | null; cardAcc: string | null } | null>(null)
  React.useEffect(() => {
    if (f || (id && !r) || !pay.data) return
    setF({
      z: r?.z_number ?? '', device: r?.device ?? '', date: r?.date ?? todayISO(),
      lines: r?.lines?.length ? r.lines : [{ rate: 0, net: 0, vat: 0, tax_code_id: null }],
      cash: r?.cash != null ? String(r.cash) : '', card: r?.card != null ? String(r.card) : '',
      cashAcc: pay.data.find((a) => a.kind === 'cash')?.id ?? null, cardAcc: pay.data.find((a) => a.kind === 'bank')?.id ?? null,
    })
  }, [f, id, r, pay.data])
  const salesTaxes = (taxes.data ?? []).filter((x) => x.is_active && (x.scope === 'both' || x.scope === 'sales') && !x.is_reverse_charge && x.tax_type === 'vat')
  const book = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('zreport_book', { p_read: id as string, p: {
      company_id: companyId, z_number: f!.z, device: f!.device || null, date: f!.date, lines: f!.lines.map((l) => ({ net: l.net, tax_code_id: l.tax_code_id })),
      cash: num(f!.cash), cash_account_id: f!.cashAcc, card: num(f!.card), card_account_id: f!.cardAcc,
    } as never })) as unknown as { invoice_id: string; number: string; total: number; paid: number },
    onSuccess: (x) => {
      toast.success(t('Booked as {number}', { number: x.number }))
      void qc.invalidateQueries({ queryKey: ['zreport-reads', companyId] }); onDone()
    },
    onError: (e) => toast.error(describeError(e)),
  })

  if (id && (!q.data || q.data.status === 'queued' || q.data.status === 'reading')) {
    return <Card><CardContent className="flex items-center justify-center gap-3 p-10 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" /> {t('Reading the Z report… it takes about half a minute.')}</CardContent></Card>
  }
  if (id && (q.data?.status === 'failed' || !r)) {
    return <Card><CardContent className="grid justify-items-center gap-2 p-8 text-center"><TriangleAlert className="size-6 text-destructive" />
      <div className="font-medium">{t('The Z report could not be read')}</div><div className="text-[13px] text-muted-foreground">{tServer(q.data?.error)}</div>
      <Button variant="outline" onClick={onDone}>{t('Back')}</Button></CardContent></Card>
  }
  if (!f) return null
  const set = (p: Partial<typeof f>) => setF((x) => (x ? { ...x, ...p } : x))
  const setLine = (i: number, p: Partial<Line>) => set({ lines: f.lines.map((l, j) => {
    if (j !== i) return l
    const n = { ...l, ...p }
    if ('tax_code_id' in p) n.rate = num(salesTaxes.find((x) => x.id === p.tax_code_id)?.rate)
    n.vat = Math.round(num(n.net) * num(n.rate)) / 100
    return n
  }) })
  const net = f.lines.reduce((s, l) => s + num(l.net), 0)
  const vat = f.lines.reduce((s, l) => s + num(l.vat), 0)
  const total = net + vat
  const open = Math.max(0, Math.round((total - num(f.cash) - num(f.card)) * 100) / 100)
  const booked = !!q.data?.invoice_id
  const ready = f.z.trim() && net > 0 && f.lines.every((l) => l.tax_code_id) && num(f.cash) + num(f.card) <= total + 0.05
  return (
    <div className={cn('grid gap-4', q.data?.image && 'lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]')}>
      {q.data?.image && <Card className="h-fit overflow-hidden"><img src={q.data.image} alt={t('The Z report')} className="max-h-[70vh] w-full object-contain" /></Card>}
      <div className="grid gap-4">
        {booked && <div className="rounded-md border border-success/40 bg-success/5 px-4 py-3 text-[13px]">{t('Booked as {number}.', { number: q.data!.invoice_number })} <Link className="font-medium text-primary hover:underline" to={`/sales/invoices/${q.data!.invoice_id}`}>{t('Open it')}</Link></div>}
        {r?.already && !booked && <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-[13px]">{t('This Z report seems booked already as {number}.', { number: r.already.number })} <Link className="font-medium text-primary hover:underline" to={`/sales/invoices/${r.already.id}`}>{t('Open it')}</Link></div>}
        <Card><CardContent className="grid gap-4 p-4 sm:grid-cols-3">
          <div className="grid gap-1.5"><Label htmlFor="zn">{t('Z report number')}</Label><Input id="zn" value={f.z} onChange={(e) => set({ z: e.target.value })} aria-invalid={!f.z.trim()} /></div>
          <div className="grid gap-1.5"><Label htmlFor="zd">{t('Fiscal register')}</Label><Input id="zd" value={f.device} onChange={(e) => set({ device: e.target.value })} placeholder={t('Fiscal number of the register')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="zdate">{t('Date')}</Label><Input id="zdate" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></div>
          {r?.receipts != null && <p className="text-xs text-muted-foreground sm:col-span-3">{t('{n} receipts on the report', { n: r.receipts })}</p>}
        </CardContent></Card>

        <Card><CardContent className="grid gap-2 p-4">
          <div className="grid grid-cols-[minmax(0,1fr)_110px_90px_36px] gap-2 text-xs text-muted-foreground"><span>{t('VAT')}</span><span className="text-right">{t('Without VAT')}</span><span className="text-right">{t('VAT')}</span><span /></div>
          {f.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_90px_36px] items-center gap-2">
              <SearchSelect value={l.tax_code_id} onChange={(v) => setLine(i, { tax_code_id: v })} options={salesTaxes.map((x) => ({ value: x.id, label: td(x.name) }))} aria-invalid={!l.tax_code_id} />
              <Input type="number" step="0.01" className="text-right tabular" value={l.net} onChange={(e) => setLine(i, { net: num(e.target.value) })} aria-label={t('Without VAT')} />
              <span className="text-right text-sm tabular">{formatMoney(l.vat)}</span>
              <Button variant="ghost" size="icon" aria-label={t('Remove')} disabled={f.lines.length === 1} onClick={() => set({ lines: f.lines.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => set({ lines: [...f.lines, { rate: 0, net: 0, vat: 0, tax_code_id: null }] })}><Plus /> {t('Another VAT rate')}</Button>
            <div className="text-right text-[13px] text-muted-foreground">{t('Sales of the day, with VAT')} <span className="block text-xl font-semibold text-foreground tabular">{formatMoney(total)}</span>
              {r?.total != null && Math.abs(num(r.total) - total) > 0.05 && <span className="text-warning">{t('The report says {amount} with VAT', { amount: formatMoney(r.total) })}</span>}</div>
          </div>
        </CardContent></Card>

        <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="zcash">{t('In cash')}</Label>
            <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
              <Input id="zcash" type="number" step="0.01" className="text-right tabular" value={f.cash} onChange={(e) => set({ cash: e.target.value })} />
              <SearchSelect value={f.cashAcc} onChange={(v) => set({ cashAcc: v })} options={(pay.data ?? []).filter((a) => a.kind === 'cash').map((a) => ({ value: a.id, label: a.name }))} placeholder={t('Till')} />
            </div></div>
          <div className="grid gap-1.5"><Label htmlFor="zcard">{t('By card')}</Label>
            <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
              <Input id="zcard" type="number" step="0.01" className="text-right tabular" value={f.card} onChange={(e) => set({ card: e.target.value })} />
              <SearchSelect value={f.cardAcc} onChange={(v) => set({ cardAcc: v })} options={(pay.data ?? []).filter((a) => a.kind === 'bank').map((a) => ({ value: a.id, label: a.name }))} placeholder={t('Bank account')} />
            </div></div>
          {open > 0 && <p className="text-xs text-muted-foreground sm:col-span-2">{t("{amount} stays open on the register's customer (on credit, vouchers).", { amount: formatMoney(open) })}</p>}
          {num(f.cash) + num(f.card) > total + 0.05 && <p className="text-xs text-destructive sm:col-span-2">{t('Cash and card are more than the sales of the day.')}</p>}
        </CardContent></Card>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {r && <span className="flex items-center gap-1 text-[13px] text-muted-foreground"><Sparkles className="size-4 text-primary" />{t('Read from the photo; check before booking.')}</span>}
          <Button variant="ghost" onClick={onDone}>{t('Back')}</Button>
          <Button size="lg" loading={book.isPending} disabled={!ready || booked} onClick={() => book.mutate()}>{t('Book the sales')}</Button>
        </div>
      </div>
    </div>
  )
}
