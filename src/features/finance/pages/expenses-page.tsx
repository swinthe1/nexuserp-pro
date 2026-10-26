import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Check, FileText, Loader2, PenLine, Plus, ReceiptText, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { VendorPicker } from '@/features/inventory/components/pickers'
import { useTaxCodes } from '@/features/tax/api'
import { msg, t, td, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { shrink } from '@/lib/shrink-image'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { useAccounts } from '../api'

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'fuel', label: msg('Fuel') }, { key: 'utilities', label: msg('Electricity, water, heating') }, { key: 'telecom', label: msg('Phone and internet') },
  { key: 'rent', label: msg('Rent') }, { key: 'supplies', label: msg('Supplies and materials') }, { key: 'repairs', label: msg('Repairs and maintenance') },
  { key: 'meals', label: msg('Meals and hospitality') }, { key: 'transport', label: msg('Transport, taxi, parking') }, { key: 'bank_fees', label: msg('Bank fees') },
  { key: 'advertising', label: msg('Advertising') }, { key: 'insurance', label: msg('Insurance') }, { key: 'professional', label: msg('Accountant, lawyer, consulting') },
  { key: 'other', label: msg('Other') },
]
const catLabel = (k: string | null | undefined) => { const c = CATEGORIES.find((x) => x.key === k); return c ? t(c.label) : '' }

type VatLine = { rate: number; net: number; vat: number; tax_code_id: string | null }
type Result = {
  vendor_name?: string; vendor_tax_number?: string; number?: string; date?: string; due_date?: string; total?: number; description?: string; category?: string
  paid?: 'cash' | 'card' | 'bank' | 'unpaid'; vendor_id: string | null; vendor_match_name: string | null; account_id: string | null
  account_how: 'learned' | 'history' | 'category'; cost_center_id: string | null; lines: VatLine[]; already: { id: string; number: string } | null
}
type Read = { id: string; status: 'queued' | 'reading' | 'done' | 'failed'; error: string | null; file_name: string | null; bill_id: string | null; bill_number: string | null
  image: string | null; result: Result | null }
type Row = { id: string; file_name: string | null; status: string; error: string | null; vendor: string | null; number: string | null; date: string | null; total: number | null
  category: string | null; bill_id: string | null; bill_number: string | null; created_at: string }
type PayAccount = { id: string; name: string; kind: 'cash' | 'bank' }

/** Fuel, electricity, a restaurant bill…: photographed, read, booked with one click. */
export function ExpensesPage() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const id = params.get('id')
  const list = useQuery({
    queryKey: ['expense-reads', companyId], enabled: !!companyId,
    refetchInterval: (q) => ((q.state.data as Row[] | undefined)?.some((r) => r.status === 'queued' || r.status === 'reading') ? 3000 : false),
    queryFn: async () => unwrap(await supabase.rpc('expense_reads', { p_company: companyId! })) as unknown as Row[],
  })
  const send = useMutation({
    mutationFn: async (files: File[]) => {
      let last = ''
      for (const file of files) {
        if (!/^(image\/|application\/pdf)/.test(file.type)) throw new Error(t('Choose a photo or a PDF'))
        const f = await shrink(file)
        last = unwrap(await supabase.rpc('doc_read_submit', { p_company: companyId!, p_file: f.data, p_mime: f.mime, p_name: file.name, p_kind: 'expense' })) as string
      }
      return { last, n: files.length }
    },
    onSuccess: (r) => { if (r.n === 1) setParams({ id: r.last }); else toast.success(t('{n} receipts are being read', { n: r.n })); void qc.invalidateQueries({ queryKey: ['expense-reads', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  const pick = (capture: boolean) => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = 'image/*,application/pdf'
    if (capture) inp.setAttribute('capture', 'environment'); else inp.multiple = true
    inp.onchange = () => { const f = Array.from(inp.files ?? []); if (f.length) send.mutate(f) }
    inp.click()
  }
  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <PageHeader title={t('Expenses')} description={t('Fuel, electricity, phone, a meal with a client: photograph the receipt and DrisPRO reads it, proposes where it goes and books it. It learns from what you choose.')} />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-5 text-center sm:flex-row sm:text-left">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><ReceiptText className="size-6" /></span>
          <div className="flex-1"><div className="font-medium">{t('A new expense')}</div>
            <div className="text-[13px] text-muted-foreground">{t('The whole receipt in the photo, flat and with light. Several at once from the gallery.')}</div></div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button size="lg" loading={send.isPending} onClick={() => pick(true)}><Camera /> {t('Take a photo')}</Button>
            <Button size="lg" variant="outline" disabled={send.isPending} onClick={() => pick(false)}><FileText /> {t('Choose files')}</Button>
            <Button size="lg" variant="ghost" onClick={() => setParams({ id: 'new' })}><PenLine /> {t('Without a photo')}</Button>
          </div>
        </CardContent>
      </Card>
      {id ? <Review key={id} id={id === 'new' ? null : id} onDone={() => setParams({})} /> : <Recent rows={list.data ?? []} onOpen={(x) => setParams({ id: x })} />}
    </div>
  )
}

function Recent({ rows, onOpen }: { rows: Row[]; onOpen: (id: string) => void }) {
  if (!rows.length) return null
  const waiting = rows.filter((r) => r.status === 'done' && !r.bill_id).length
  const label: Record<string, string> = { queued: t('Waiting'), reading: t('Reading'), done: t('To check'), failed: t('Not read') }
  return (
    <Card><CardContent className="p-0">
      {waiting > 0 && <div className="border-b bg-info/5 px-4 py-2 text-[13px] font-medium text-info">{t('{n} read and waiting for you to book them', { n: waiting })}</div>}
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.vendor ?? r.file_name ?? t('Receipt')}{r.category ? <span className="font-normal text-muted-foreground"> · {catLabel(r.category)}</span> : null}</div>
                <div className="truncate text-xs text-muted-foreground">{r.date ? formatDate(r.date) : formatDate(r.created_at, true)}{r.number ? ` · ${r.number}` : ''}{r.error ? ` · ${tServer(r.error)}` : ''}</div>
              </div>
              {r.total != null && <span className="text-sm font-semibold tabular">{formatMoney(r.total)}</span>}
              {r.bill_id ? <Badge variant="outline" className="border-success/40 text-success">{t('Booked|expense')}</Badge>
                : <span className={cn('w-20 text-right text-xs font-medium', r.status === 'failed' ? 'text-destructive' : r.status === 'done' ? 'text-info' : 'text-muted-foreground')}>{label[r.status] ?? r.status}</span>}
            </button>
          </li>
        ))}
      </ul>
    </CardContent></Card>
  )
}

function Review({ id, onDone }: { id: string | null; onDone: () => void }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const accounts = useAccounts()
  const taxes = useTaxCodes()
  const q = useQuery({
    queryKey: ['expense-read', id], enabled: !!id,
    refetchInterval: (x) => (['queued', 'reading'].includes((x.state.data as Read | undefined)?.status ?? 'queued') ? 2500 : false),
    queryFn: async () => unwrap(await supabase.rpc('expense_read_get', { p_id: id! })) as unknown as Read,
  })
  const pay = useQuery({ queryKey: ['expense-pay', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('expense_pay_accounts', { p_company: companyId! })) as unknown as PayAccount[] })
  const r = q.data?.result ?? null
  const [f, setF] = React.useState<{ vendor: string | null; vendorName: string; taxNo: string; number: string; date: string; category: string; account: string | null
    description: string; lines: VatLine[]; payFrom: string | null } | null>(null)
  React.useEffect(() => {
    if (f || (id && !r) || !pay.data) return
    const cash = pay.data.find((a) => a.kind === 'cash')?.id ?? null
    const bank = pay.data.find((a) => a.kind === 'bank')?.id ?? null
    setF({
      vendor: r?.vendor_id ?? null, vendorName: r?.vendor_name ?? '', taxNo: r?.vendor_tax_number ?? '', number: r?.number ?? '', date: r?.date ?? todayISO(),
      category: r?.category ?? 'other', account: r && r.account_how !== 'category' ? r.account_id : null, description: r?.description ?? '',
      lines: r?.lines?.length ? r.lines : [{ rate: 0, net: 0, vat: 0, tax_code_id: null }],
      payFrom: !r ? cash : r.paid === 'unpaid' ? null : r.paid === 'card' || r.paid === 'bank' ? (bank ?? cash) : cash,
    })
  }, [f, id, r, pay.data])
  const purchaseTaxes = (taxes.data ?? []).filter((x) => x.is_active && (x.scope === 'both' || x.scope === 'purchase') && !x.is_reverse_charge && x.tax_type === 'vat')
  const expenseAccounts = (accounts.data ?? []).filter((a) => a.is_postable && a.is_active && a.account_type === 'expense')
  const book = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('expense_book', { p_read: id as string, p: {
      company_id: companyId, vendor_id: f!.vendor, vendor_name: f!.vendor ? null : f!.vendorName, vendor_tax_number: f!.taxNo || null, read_vendor_name: r?.vendor_name ?? null,
      number: f!.number || null, date: f!.date, due_date: r?.due_date ?? null, category: f!.category, account_id: f!.account, description: f!.description || null,
      lines: f!.lines.map((l) => ({ net: l.net, tax_code_id: l.tax_code_id })),
      pay: f!.payFrom ? { bank_account_id: f!.payFrom, method: pay.data?.find((a) => a.id === f!.payFrom)?.kind === 'bank' ? 'bank_transfer' : 'cash' } : null,
    } as never })) as unknown as { bill_id: string; number: string; total: number; paid: boolean },
    onSuccess: (x) => {
      toast.success(x.paid ? t('Booked as {number} and paid', { number: x.number }) : t('Booked as {number}; it waits among the bills to pay', { number: x.number }))
      void qc.invalidateQueries({ queryKey: ['expense-reads', companyId] }); onDone()
    },
    onError: (e) => toast.error(describeError(e)),
  })

  if (id && (!q.data || q.data.status === 'queued' || q.data.status === 'reading')) {
    return <Card><CardContent className="flex items-center justify-center gap-3 p-10 text-sm text-muted-foreground"><Loader2 className="size-5 animate-spin" /> {t('Reading the receipt… it takes about half a minute.')}</CardContent></Card>
  }
  if (id && (q.data?.status === 'failed' || !r)) {
    return <Card><CardContent className="grid justify-items-center gap-2 p-8 text-center"><TriangleAlert className="size-6 text-destructive" />
      <div className="font-medium">{t('The receipt could not be read')}</div><div className="text-[13px] text-muted-foreground">{tServer(q.data?.error)}</div>
      <Button variant="outline" onClick={onDone}>{t('Back')}</Button></CardContent></Card>
  }
  if (!f) return null
  const set = (p: Partial<typeof f>) => setF((x) => (x ? { ...x, ...p } : x))
  const setLine = (i: number, p: Partial<VatLine>) => set({ lines: f.lines.map((l, j) => {
    if (j !== i) return l
    const n = { ...l, ...p }
    if ('tax_code_id' in p) n.rate = num(purchaseTaxes.find((x) => x.id === p.tax_code_id)?.rate)
    n.vat = Math.round(num(n.net) * num(n.rate)) / 100
    return n
  }) })
  const net = f.lines.reduce((s, l) => s + num(l.net), 0)
  const vat = f.lines.reduce((s, l) => s + num(l.vat), 0)
  const accountHint = f.account
    ? (r?.account_how === 'learned' && f.account === r.account_id ? t('as you booked this seller last time') : r?.account_how === 'history' && f.account === r.account_id ? t('as in your books for this vendor') : '')
    : t('the account for {category}', { category: catLabel(f.category).toLowerCase() })
  const booked = !!q.data?.bill_id
  const ready = (f.vendor || f.vendorName.trim()) && net > 0 && f.lines.every((l) => l.tax_code_id)
  return (
    <div className={cn('grid gap-4', q.data?.image && 'lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]')}>
      {q.data?.image && <Card className="h-fit overflow-hidden"><img src={q.data.image} alt={t('The receipt')} className="max-h-[70vh] w-full object-contain" /></Card>}
      <div className="grid gap-4">
        {booked && <div className="rounded-md border border-success/40 bg-success/5 px-4 py-3 text-[13px]">{t('Booked as {number}.', { number: q.data!.bill_number })} <Link className="font-medium text-primary hover:underline" to={`/procurement/bills/${q.data!.bill_id}`}>{t('Open it')}</Link></div>}
        {r?.already && !booked && <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-[13px]">{t('This receipt seems booked already as {number}.', { number: r.already.number })} <Link className="font-medium text-primary hover:underline" to={`/procurement/bills/${r.already.id}`}>{t('Open it')}</Link></div>}
        <Card><CardContent className="grid gap-4 p-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Seller')}</Label>
            <VendorPicker value={f.vendor} onChange={(v) => set({ vendor: v })} />
            {!f.vendor && <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
              <Input value={f.vendorName} onChange={(e) => set({ vendorName: e.target.value })} placeholder={t('Name of a new vendor')} aria-label={t('Name of a new vendor')} />
              <Input value={f.taxNo} onChange={(e) => set({ taxNo: e.target.value })} placeholder={t('NUI / NIPT')} aria-label={t('NUI / NIPT')} />
              <span className="text-xs text-muted-foreground sm:col-span-2">{t('Not among your vendors: it is added when you book.')}</span>
            </div>}
          </div>
          <div className="grid gap-1.5"><Label htmlFor="en">{t('Receipt number')}</Label><Input id="en" value={f.number} onChange={(e) => set({ number: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ed">{t('Date')}</Label><Input id="ed" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label>{t('What it was for')}</Label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button key={c.key} type="button" onClick={() => set({ category: c.key, account: null })}
                  className={cn('rounded-full border px-3 py-1 text-[13px] transition-colors', f.category === c.key && !f.account ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>{t(c.label)}</button>
              ))}
            </div>
            <div className="mt-1 grid gap-1 sm:grid-cols-[1fr_auto] sm:items-center">
              <SearchSelect value={f.account} onChange={(v) => set({ account: v })} clearable placeholder={t('Account (optional)')}
                options={expenseAccounts.map((a) => ({ value: a.id, label: `${a.code} · ${td(a.name)}` }))} />
              <span className="flex items-center gap-1 text-xs text-success">{(f.account || r) && <Check className="size-3" />}{accountHint}</span>
            </div>
          </div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="edesc">{t('Description')}</Label><Input id="edesc" value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder={t('e.g. Diesel 40 L')} /></div>
        </CardContent></Card>

        <Card><CardContent className="grid gap-2 p-4">
          <div className="grid grid-cols-[minmax(0,1fr)_110px_90px_36px] gap-2 text-xs text-muted-foreground"><span>{t('VAT')}</span><span className="text-right">{t('Without VAT')}</span><span className="text-right">{t('VAT')}</span><span /></div>
          {f.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px_90px_36px] items-center gap-2">
              <SearchSelect value={l.tax_code_id} onChange={(v) => setLine(i, { tax_code_id: v })} options={purchaseTaxes.map((x) => ({ value: x.id, label: td(x.name) }))} aria-invalid={!l.tax_code_id} />
              <Input type="number" step="0.01" className="text-right tabular" value={l.net} onChange={(e) => setLine(i, { net: num(e.target.value) })} aria-label={t('Without VAT')} />
              <span className="text-right text-sm tabular">{formatMoney(l.vat)}</span>
              <Button variant="ghost" size="icon" aria-label={t('Remove')} disabled={f.lines.length === 1} onClick={() => set({ lines: f.lines.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => set({ lines: [...f.lines, { rate: 0, net: 0, vat: 0, tax_code_id: null }] })}><Plus /> {t('Another VAT rate')}</Button>
            <div className="text-right text-[13px] text-muted-foreground">{t('Total')} <span className="block text-xl font-semibold text-foreground tabular">{formatMoney(net + vat)}</span>
              {r?.total != null && Math.abs(num(r.total) - (net + vat)) > 0.05 && <span className="text-warning">{t('The receipt says {amount}', { amount: formatMoney(r.total) })}</span>}</div>
          </div>
        </CardContent></Card>

        <Card><CardContent className="grid gap-2 p-4">
          <Label>{t('Paid?')}</Label>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => set({ payFrom: null })} className={cn('rounded-full border px-3 py-1 text-[13px]', !f.payFrom ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>{t('Not yet: goes to bills to pay')}</button>
            {(pay.data ?? []).map((a) => (
              <button key={a.id} type="button" onClick={() => set({ payFrom: a.id })} className={cn('rounded-full border px-3 py-1 text-[13px]', f.payFrom === a.id ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                {t('Paid from {account}', { account: a.name })}</button>
            ))}
          </div>
        </CardContent></Card>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {r && <span className="flex items-center gap-1 text-[13px] text-muted-foreground"><Sparkles className="size-4 text-primary" />{t('Read from the photo; check before booking.')}</span>}
          <Button variant="ghost" onClick={onDone}>{t('Back')}</Button>
          <Button size="lg" loading={book.isPending} disabled={!ready || booked} onClick={() => book.mutate()}>{t('Book the expense')}</Button>
        </div>
      </div>
    </div>
  )
}
