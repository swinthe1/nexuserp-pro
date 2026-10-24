import type { ColumnDef } from '@tanstack/react-table'
import { BadgePercent, Ban, CreditCard, Pencil, Plus, Printer, RotateCcw } from 'lucide-react'
import * as React from 'react'
import { useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatNumberWith, msg, t, td, tn } from '@/i18n'
import { ean13Svg } from '@/lib/ean13'
import { describeError } from '@/lib/errors'
import { printHtml } from '@/lib/print'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { useCategories, useWarehouses } from '@/features/inventory/api'
import {
  type Card as LoyaltyCard, type LoyaltyKind, type Program, type ProgramInput,
  useAdjustPoints, useCardHistory, useCards, useIssueCard, useLoyaltyOverview, usePrograms, useSaveProgram, useUpdateCard,
} from './api'

const KINDS: { value: LoyaltyKind; label: string; hint: string }[] = [
  { value: 'discount', label: msg('Discount card'), hint: msg('The same discount on every purchase, e.g. 5%.') },
  { value: 'points', label: msg('Points card'), hint: msg('The customer collects points and spends them as money off a later purchase.') },
  { value: 'staff', label: msg('Staff card'), hint: msg('A bigger discount for employees, with a limit per month.') },
]
const STATUS: Record<string, { label: string; variant: 'success' | 'destructive' | 'warning' }> = {
  active: { label: msg('Active'), variant: 'success' },
  blocked: { label: msg('Blocked'), variant: 'destructive' },
  lost: { label: msg('Lost'), variant: 'warning' },
}
const LEDGER: Record<string, string> = {
  earn: msg('Points earned'), redeem: msg('Points spent'), discount: msg('Card discount'), refund: msg('Points taken back (refund)'), adjust: msg('Correction'),
}

function programRule(p: Pick<Program, 'kind' | 'discount_pct' | 'points_per_unit' | 'point_value' | 'monthly_limit'>) {
  const parts: string[] = []
  if (num(p.discount_pct) > 0) parts.push(t('{pct}% off', { pct: num(p.discount_pct) }))
  if (p.kind === 'points') parts.push(t('{n} points per {amount} · 1 point = {value}', { n: num(p.points_per_unit), amount: formatMoney(1), value: formatMoney(p.point_value, undefined, 4) }))
  if (p.monthly_limit != null) parts.push(t('up to {amount} a month', { amount: formatMoney(p.monthly_limit) }))
  return parts.join(' · ')
}

export function printLoyaltyCard(company: string, card: { card_number: string; holder_name: string }, programName: string) {
  printHtml(`<div class="card"><div class="co">${esc(company)}</div><div class="pg">${esc(programName)}</div>
    <div class="hn">${esc(card.holder_name)}</div><div class="bc">${ean13Svg(card.card_number, { module: 1.6, height: 46 })}</div></div>`,
  `@page{size:85.6mm 54mm;margin:0} body{margin:0;font:12px/1.3 system-ui,sans-serif;color:#000}
   .card{width:85.6mm;height:54mm;box-sizing:border-box;padding:4mm 5mm;display:flex;flex-direction:column}
   .co{font-weight:700;font-size:15px} .pg{font-size:11px;margin-top:1mm} .hn{margin-top:auto;font-size:12px;font-weight:600}
   .bc{margin-top:1.5mm} .bc svg{width:58mm;height:auto}`)
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/* ================================================================== page */
export function LoyaltyPage() {
  const { can } = useCompany()
  const [tab, setTab] = React.useState('cards')
  const [issuing, setIssuing] = React.useState(false)
  const programs = usePrograms()
  return (
    <>
      <PageHeader title={t('Loyalty cards')}
        description={t('Cards give customers a discount or points in every store of the company. The till applies them by itself, so cashiers cannot give a card discount by hand.')}
        actions={can('pos.write') && <Button onClick={() => setIssuing(true)} disabled={!programs.data?.length}><Plus /> {t('New card')}</Button>} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="cards">{t('Cards')}</TabsTrigger>
          <TabsTrigger value="types">{t('Types of card')}</TabsTrigger>
          <TabsTrigger value="report">{t('Report')}</TabsTrigger>
        </TabsList>
        <TabsContent value="cards" className="mt-4">
          {programs.data && !programs.data.length
            ? <EmptyState icon={BadgePercent} title={t('Start with a type of card')} description={t('Decide what the card gives (a discount, points or a staff discount), then hand out cards.')}
                action={can('pos.approve') ? <Button onClick={() => setTab('types')}><Plus /> {t('New type of card')}</Button> : undefined} />
            : <CardsTab />}
        </TabsContent>
        <TabsContent value="types" className="mt-4"><TypesTab /></TabsContent>
        <TabsContent value="report" className="mt-4"><ReportTab /></TabsContent>
      </Tabs>
      <IssueCardDialog open={issuing} onClose={() => setIssuing(false)} />
    </>
  )
}

/* ------------------------------------------------------------------ cards */
function CardsTab() {
  const cards = useCards()
  const programs = usePrograms()
  const [open, setOpen] = React.useState<string | null>(null)
  const columns = React.useMemo<ColumnDef<LoyaltyCard>[]>(() => [
    { accessorKey: 'holder_name', header: ({ column }) => <ColumnHeader column={column} title={t('Customer')} />, meta: { label: t('Customer') },
      cell: ({ row: { original: c } }) => <div><div className="font-medium">{c.holder_name}</div><div className="text-xs text-muted-foreground tabular">{c.card_number}</div></div> },
    { accessorKey: 'phone', header: t('Phone'), meta: { label: t('Phone') }, cell: ({ getValue }) => (getValue() as string) ?? '—' },
    { id: 'program', accessorFn: (c) => c.program?.name ?? '', filterFn: inFilter, header: t('Type'), meta: { label: t('Type') } },
    { accessorKey: 'points_balance', header: ({ column }) => <ColumnHeader column={column} title={t('Points')} />, meta: { label: t('Points'), align: 'right' },
      cell: ({ row: { original: c } }) => c.program?.kind === 'points' ? <span className="tabular">{formatNumberWith(num(c.points_balance), { maximumFractionDigits: 0 })}</span> : <span className="text-muted-foreground">—</span> },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') },
      cell: ({ getValue }) => { const s = STATUS[getValue() as string]; return s ? <Badge variant={s.variant}>{t(s.label)}</Badge> : null } },
    { accessorKey: 'last_used_at', header: ({ column }) => <ColumnHeader column={column} title={t('Last used')} />, meta: { label: t('Last used') },
      cell: ({ getValue }) => <span className="text-[13px]">{getValue() ? formatDate(getValue() as string) : t('Never')}</span> },
  ], [])
  const current = cards.data?.find((c) => c.id === open) ?? null
  return (
    <>
      <DataTable tableKey="loyalty.cards" columns={columns} data={cards.data} isLoading={cards.isLoading} error={cards.error} getRowId={(c) => c.id}
        searchPlaceholder={t('Name, card number or phone')} exportName="loyalty-cards" onRowClick={(c) => setOpen(c.id)}
        facets={[
          { columnId: 'program', title: t('Type'), options: (programs.data ?? []).map((p) => ({ label: p.name, value: p.name })) },
          { columnId: 'status', title: t('Status'), options: Object.entries(STATUS).map(([value, s]) => ({ label: t(s.label), value })) },
        ]}
        empty={{ title: t('No cards yet'), description: t('Hand out the first card with New card. The number is made for you and prints as a barcode.') }} />
      <CardSheet card={current} onClose={() => setOpen(null)} />
    </>
  )
}

function IssueCardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { company } = useCompany()
  const programs = usePrograms()
  const issue = useIssueCard()
  const [v, setV] = React.useState({ program_id: '', holder_name: '', phone: '', email: '', card_number: '', notes: '' })
  const [done, setDone] = React.useState<{ card_number: string; holder_name: string; program: string } | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  React.useEffect(() => { if (open) { setV({ program_id: programs.data?.find((p) => p.is_active)?.id ?? '', holder_name: '', phone: '', email: '', card_number: '', notes: '' }); setDone(null); setErr(null) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const programName = programs.data?.find((p) => p.id === v.program_id)?.name ?? ''
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    try {
      const r = await issue.mutateAsync({ ...v })
      setDone({ card_number: r.card_number, holder_name: v.holder_name.trim(), program: programName })
    } catch (x) { setErr(describeError(x)) }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        {done ? (
          <>
            <DialogHeader><DialogTitle>{t('Card for {name} is ready', { name: done.holder_name })}</DialogTitle>
              <DialogDescription>{t('It works in every store from now on. Print it on a card printer or a label, or give the customer the number.')}</DialogDescription></DialogHeader>
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="text-sm font-semibold">{company?.name}</div>
              <div className="text-xs text-muted-foreground">{done.program}</div>
              <div className="mt-4 text-[13px] font-medium">{done.holder_name}</div>
              <div className="mt-1 [&_svg]:h-auto [&_svg]:w-56" dangerouslySetInnerHTML={{ __html: ean13Svg(done.card_number, { module: 2, height: 50 }) }} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => printLoyaltyCard(company?.name ?? '', done, done.program)}><Printer /> {t('Print card')}</Button>
              <Button onClick={onClose}>{t('Done')}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="grid gap-3">
            <DialogHeader><DialogTitle>{t('New card')}</DialogTitle><DialogDescription>{t('One card per customer. The phone number lets the cashier find the card when the customer forgets it.')}</DialogDescription></DialogHeader>
            <div className="grid gap-1.5"><Label>{t('Type of card')}</Label>
              <Select value={v.program_id} onValueChange={(x) => setV({ ...v, program_id: x })}>
                <SelectTrigger><SelectValue placeholder={t('Choose…')} /></SelectTrigger>
                <SelectContent>{(programs.data ?? []).filter((p) => p.is_active).map((p) => <SelectItem key={p.id} value={p.id}>{p.name} · {programRule(p)}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="grid gap-1.5"><Label htmlFor="lc-name">{t('Full name')}</Label><Input id="lc-name" autoFocus value={v.holder_name} onChange={(e) => setV({ ...v, holder_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5"><Label htmlFor="lc-phone" optional>{t('Phone')}</Label><Input id="lc-phone" inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} placeholder="044 123 456" /></div>
              <div className="grid gap-1.5"><Label htmlFor="lc-mail" optional>{t('Email')}</Label><Input id="lc-mail" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="lc-num" optional>{t('Card number')}</Label>
              <Input id="lc-num" className="font-mono" value={v.card_number} onChange={(e) => setV({ ...v, card_number: e.target.value })} placeholder={t('Leave empty to make one')} />
              <p className="text-xs text-muted-foreground">{t('Scan a plastic card you already have to use its number.')}</p></div>
            {err && <p className="text-[13px] text-destructive">{err}</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t('Cancel')}</Button>
              <Button type="submit" loading={issue.isPending} disabled={!v.program_id || !v.holder_name.trim()}><CreditCard /> {t('Make the card')}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CardSheet({ card, onClose }: { card: LoyaltyCard | null; onClose: () => void }) {
  const { company, can } = useCompany()
  const history = useCardHistory(card?.id ?? null)
  const programs = usePrograms()
  const update = useUpdateCard()
  const adjust = useAdjustPoints()
  const [points, setPoints] = React.useState('')
  const [note, setNote] = React.useState('')
  React.useEffect(() => { setPoints(''); setNote('') }, [card?.id])
  const manager = can('pos.approve')
  const s = card ? STATUS[card.status] : null
  return (
    <Sheet open={!!card} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {card && <>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">{card.holder_name} {s && <Badge variant={s.variant}>{t(s.label)}</Badge>}</SheetTitle>
            <SheetDescription className="tabular">{card.card_number}{card.phone ? ` · ${card.phone}` : ''}{card.email ? ` · ${card.email}` : ''}</SheetDescription>
          </SheetHeader>
          <div className="px-5 pb-8">
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{t('Type')}</div><div className="text-sm font-medium">{card.program?.name}</div></div>
            <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">{t('Points')}</div>
              <div className="text-sm font-semibold tabular">{card.program?.kind === 'points' ? formatNumberWith(num(card.points_balance), { maximumFractionDigits: 0 }) : '—'}</div></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => printLoyaltyCard(company?.name ?? '', card, card.program?.name ?? '')}><Printer /> {t('Print card')}</Button>
            {manager && (card.status === 'active'
              ? <>
                  <Button variant="outline" size="sm" onClick={() => update.mutate({ id: card.id, patch: { status: 'blocked' } })}><Ban /> {t('Block')}</Button>
                  <Button variant="outline" size="sm" onClick={() => update.mutate({ id: card.id, patch: { status: 'lost' } })}>{t('Reported lost')}</Button>
                </>
              : <Button variant="outline" size="sm" onClick={() => update.mutate({ id: card.id, patch: { status: 'active' } })}><RotateCcw /> {t('Activate again')}</Button>)}
          </div>
          {manager && (
            <div className="mt-5 grid gap-3">
              <div className="grid gap-1.5"><Label>{t('Type of card')}</Label>
                <Select value={card.program_id} onValueChange={(x) => update.mutate({ id: card.id, patch: { program_id: x } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(programs.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                </Select></div>
              {card.program?.kind === 'points' && (
                <form className="grid gap-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); adjust.mutate({ id: card.id, points: num(points), note }, { onSuccess: () => { setPoints(''); setNote('') } }) }}>
                  <Label>{t('Correct the points')}</Label>
                  <div className="flex gap-2"><Input inputMode="numeric" className="w-28 tabular" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ''))} placeholder="+100 / −50" aria-label={t('Points')} />
                    <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Why, e.g. receipt lost')} aria-label={t('Reason')} /></div>
                  <Button type="submit" size="sm" variant="secondary" className="justify-self-start" loading={adjust.isPending} disabled={!num(points) || !note.trim()}>{t('Save correction')}</Button>
                </form>
              )}
            </div>
          )}
          <h3 className="mb-2 mt-6 text-sm font-semibold">{t('History')}</h3>
          {history.isLoading ? <Skeleton className="h-32" /> : history.error ? <ErrorState compact error={history.error} /> : !history.data?.length
            ? <p className="text-[13px] text-muted-foreground">{t('The card has not been used yet.')}</p>
            : <ul className="divide-y rounded-lg border">{history.data.map((h) => (
                <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <div className="min-w-0 flex-1"><div className="font-medium">{t(LEDGER[h.kind] ?? h.kind)}</div>
                    <div className="truncate text-xs text-muted-foreground">{formatDate(h.occurred_at, true)}{h.warehouse ? ` · ${td(h.warehouse.name)}` : ''}{h.order ? ` · ${h.order.number}` : ''}{h.note ? ` · ${h.note}` : ''}</div></div>
                  <div className="text-right tabular">
                    {num(h.points) !== 0 && <div className={num(h.points) > 0 ? 'text-success' : 'text-destructive'}>{num(h.points) > 0 ? '+' : ''}{num(h.points)} {t('pts')}</div>}
                    {num(h.amount) !== 0 && <div className="text-muted-foreground">−{formatMoney(h.amount)}</div>}
                  </div>
                </li>))}</ul>}
          </div>
        </>}
      </SheetContent>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ types of card */
function TypesTab() {
  const { can } = useCompany()
  const programs = usePrograms()
  const [editing, setEditing] = React.useState<Program | 'new' | null>(null)
  if (programs.isLoading) return <Skeleton className="h-40" />
  if (programs.error) return <ErrorState error={programs.error} onRetry={() => void programs.refetch()} />
  return (
    <>
      {can('pos.approve') && <div className="mb-3 flex justify-end"><Button variant="outline" onClick={() => setEditing('new')}><Plus /> {t('New type of card')}</Button></div>}
      {!programs.data?.length ? <EmptyState compact icon={BadgePercent} title={t('No types of card yet')} description={t('A type says what the card gives. Most shops need one: a discount card or a points card.')} />
        : <div className="grid gap-3 md:grid-cols-2">{programs.data.map((p) => (
            <Card key={p.id} className={cn(!p.is_active && 'opacity-60')}>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                <div><CardTitle className="flex items-center gap-2">{p.name}{!p.is_active && <Badge variant="secondary">{t('Switched off')}</Badge>}</CardTitle>
                  <CardDescription>{t(KINDS.find((k) => k.value === p.kind)?.label ?? p.kind)}</CardDescription></div>
                {can('pos.approve') && <Button variant="ghost" size="sm" onClick={() => setEditing(p)}><Pencil /> {t('Edit')}</Button>}
              </CardHeader>
              <CardContent className="text-[13px]">
                <p>{programRule(p)}</p>
                <p className="mt-1 text-muted-foreground">
                  {p.excluded_category_ids.length ? tn(p.excluded_category_ids.length, 'Not for {n} category', 'Not for {n} categories') : t('For every product')}
                  {' · '}{p.warehouse_ids.length ? tn(p.warehouse_ids.length, 'In {n} store', 'In {n} stores') : t('In every store')}
                  {p.valid_until ? ` · ${t('until {date}', { date: formatDate(p.valid_until) })}` : ''}
                </p>
              </CardContent>
            </Card>))}</div>}
      <ProgramDialog program={editing} onClose={() => setEditing(null)} />
    </>
  )
}

function ProgramDialog({ program, onClose }: { program: Program | 'new' | null; onClose: () => void }) {
  const save = useSaveProgram()
  const categories = useCategories()
  const warehouses = useWarehouses()
  const blank: ProgramInput = { name: '', kind: 'discount', discount_pct: 5, points_per_unit: 1, point_value: 0.01, min_redeem_points: 100, monthly_limit: null,
    excluded_category_ids: [], warehouse_ids: [], valid_from: null, valid_until: null, is_active: true, description: null }
  const [v, setV] = React.useState<ProgramInput>(blank)
  const [limit, setLimit] = React.useState('')
  const [err, setErr] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!program) return
    setErr(null)
    if (program === 'new') { setV(blank); setLimit(''); return }
    setV({ id: program.id, name: program.name, kind: program.kind as LoyaltyKind, discount_pct: num(program.discount_pct), points_per_unit: num(program.points_per_unit) || 1,
      point_value: num(program.point_value) || 0.01, min_redeem_points: num(program.min_redeem_points), monthly_limit: program.monthly_limit,
      excluded_category_ids: program.excluded_category_ids, warehouse_ids: program.warehouse_ids, valid_from: program.valid_from, valid_until: program.valid_until,
      is_active: program.is_active, description: program.description })
    setLimit(program.monthly_limit == null ? '' : String(program.monthly_limit))
  }, [program]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (k: 'excluded_category_ids' | 'warehouse_ids', id: string) =>
    setV((x) => ({ ...x, [k]: x[k].includes(id) ? x[k].filter((y) => y !== id) : [...x[k], id] }))
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null)
    try { await save.mutateAsync({ ...v, monthly_limit: limit.trim() === '' ? null : num(limit) }); onClose() } catch (x) { setErr(describeError(x)) }
  }
  const example = v.kind === 'points' && v.points_per_unit > 0 && v.point_value > 0
    ? t('Spending {spend} earns {pts} points, worth {value} off a later purchase.', { spend: formatMoney(100), pts: Math.floor(100 * v.points_per_unit), value: formatMoney(Math.floor(100 * v.points_per_unit) * v.point_value) })
    : null
  return (
    <Dialog open={!!program} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader><DialogTitle>{program === 'new' ? t('New type of card') : t('Edit {name}', { name: v.name })}</DialogTitle>
            <DialogDescription>{t('Changes apply to every card of this type from the next sale.')}</DialogDescription></DialogHeader>
          <div className="grid gap-1.5"><Label htmlFor="lp-name">{t('Name')}</Label><Input id="lp-name" autoFocus value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t('e.g. Lider Gold')} /></div>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('What the card gives')}>
            {KINDS.map((k) => (
              <button key={k.value} type="button" role="radio" aria-checked={v.kind === k.value} onClick={() => setV({ ...v, kind: k.value, discount_pct: k.value === 'points' ? 0 : v.discount_pct || 5 })}
                className={cn('rounded-lg border-2 p-3 text-left transition-colors', v.kind === k.value ? 'border-primary bg-primary/5' : 'hover:bg-muted')}>
                <div className="text-sm font-medium">{t(k.label)}</div><div className="mt-0.5 text-xs text-muted-foreground">{t(k.hint)}</div>
              </button>))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label htmlFor="lp-pct" optional={v.kind === 'points'}>{t('Discount %')}</Label>
              <Input id="lp-pct" inputMode="decimal" className="text-right tabular" value={String(v.discount_pct)} onChange={(e) => setV({ ...v, discount_pct: num(e.target.value.replace(',', '.')) })} /></div>
            {v.kind === 'points' && <>
              <div className="grid gap-1.5"><Label htmlFor="lp-ppu">{t('Points for {amount}', { amount: formatMoney(1) })}</Label>
                <Input id="lp-ppu" inputMode="decimal" className="text-right tabular" value={String(v.points_per_unit)} onChange={(e) => setV({ ...v, points_per_unit: num(e.target.value.replace(',', '.')) })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="lp-val">{t('One point is worth')}</Label>
                <Input id="lp-val" inputMode="decimal" className="text-right tabular" value={String(v.point_value)} onChange={(e) => setV({ ...v, point_value: num(e.target.value.replace(',', '.')) })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="lp-min">{t('Spend from (points)')}</Label>
                <Input id="lp-min" inputMode="numeric" className="text-right tabular" value={String(v.min_redeem_points)} onChange={(e) => setV({ ...v, min_redeem_points: num(e.target.value) })} /></div>
            </>}
            <div className="grid gap-1.5"><Label htmlFor="lp-lim" optional={v.kind !== 'staff'}>{t('Most discount a month')}</Label>
              <Input id="lp-lim" inputMode="decimal" className="text-right tabular" value={limit} onChange={(e) => setLimit(e.target.value.replace(',', '.'))} placeholder={t('No limit')} /></div>
          </div>
          {example && <p className="-mt-2 text-[13px] text-muted-foreground">{example}</p>}
          <div className="grid gap-1.5"><Label>{t('Not for these categories')}</Label>
            <p className="text-xs text-muted-foreground">{t('For example cigarettes, or goods already on offer. Items with a discount typed by the cashier never get the card discount on top.')}</p>
            <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border p-2">
              {(categories.data ?? []).map((c) => <label key={c.id} className="flex items-center gap-2 text-[13px]"><Checkbox checked={v.excluded_category_ids.includes(c.id)} onCheckedChange={() => toggle('excluded_category_ids', c.id)} />{td(c.name)}</label>)}
              {!categories.data?.length && <span className="text-[13px] text-muted-foreground">{t('No categories yet')}</span>}
            </div></div>
          <div className="grid gap-1.5"><Label>{t('Stores')}</Label>
            <p className="text-xs text-muted-foreground">{t('Leave all unticked for every store.')}</p>
            <div className="grid max-h-36 grid-cols-2 gap-1.5 overflow-y-auto rounded-md border p-2">
              {(warehouses.data ?? []).filter((w) => w.is_active).map((w) => <label key={w.id} className="flex items-center gap-2 text-[13px]"><Checkbox checked={v.warehouse_ids.includes(w.id)} onCheckedChange={() => toggle('warehouse_ids', w.id)} />{td(w.name)}</label>)}
            </div></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="lp-from" optional>{t('Valid from')}</Label><Input id="lp-from" type="date" value={v.valid_from ?? ''} onChange={(e) => setV({ ...v, valid_from: e.target.value || null })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="lp-to" optional>{t('Valid until')}</Label><Input id="lp-to" type="date" value={v.valid_until ?? ''} onChange={(e) => setV({ ...v, valid_until: e.target.value || null })} /></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="lp-desc" optional>{t('Notes')}</Label><Textarea id="lp-desc" rows={2} value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} /></div>
          <label className="flex items-center justify-between gap-3 rounded-md border p-3"><span className="text-sm font-medium">{t('In use')}</span>
            <Switch checked={v.is_active} onCheckedChange={(on) => setV({ ...v, is_active: on })} aria-label={t('In use')} /></label>
          {err && <p className="text-[13px] text-destructive">{err}</p>}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>{t('Cancel')}</Button><Button type="submit" loading={save.isPending} disabled={!v.name.trim()}>{t('Save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ report */
function ReportTab() {
  const { company } = useCompany()
  const monthStart = todayISO().slice(0, 8) + '01'
  const [from, setFrom] = React.useState(monthStart)
  const [to, setTo] = React.useState(todayISO())
  const q = useLoyaltyOverview(from, to)
  const d = q.data
  const cur = company?.base_currency
  const share = d && num(d.all_sales) > 0 ? Math.round((num(d.card_sales) / num(d.all_sales)) * 100) : 0
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5"><Label htmlFor="lr-from">{t('From')}</Label><Input id="lr-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="lr-to">{t('To')}</Label><Input id="lr-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      {q.error && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('Discount given with cards')} value={formatMoney(d?.discount, cur)} loading={q.isLoading} />
        <StatCard label={t('Sales with a card')} value={`${share}%`} loading={q.isLoading} hint={d ? t('{amount} of {total}', { amount: formatMoney(d.card_sales), total: formatMoney(d.all_sales) }) : undefined} />
        <StatCard label={t('Cards used')} value={d?.cards_used ?? 0} loading={q.isLoading} hint={d ? t('of {n} active cards', { n: d.cards_active }) : undefined} />
        <StatCard label={t('Points not spent yet')} value={formatMoney(d?.points_outstanding_value, cur)} loading={q.isLoading}
          hint={d ? t('{n} points the company owes its customers', { n: formatNumberWith(num(d.points_outstanding), { maximumFractionDigits: 0 }) }) : undefined} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SmallTable title={t('By store')} head={[t('Store'), t('Receipts'), t('Discount')]}
          rows={(d?.by_store ?? []).map((r) => [td(r.name), String(r.receipts), formatMoney(r.discount ?? 0)])} />
        <SmallTable title={t('By type of card')} head={[t('Type'), t('Cards'), t('Discount')]}
          rows={(d?.by_program ?? []).map((r) => [r.name, String(r.cards), formatMoney(r.discount ?? 0)])} />
      </div>
      <SmallTable title={t('Best customers')} head={[t('Customer'), t('Receipts'), t('Spent')]}
        rows={(d?.top_customers ?? []).map((r) => [`${r.holder_name} · ${r.card_number}`, String(r.receipts), formatMoney(r.spent)])} />
    </div>
  )
}
function SmallTable({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        {!rows.length ? <p className="px-6 pb-6 text-[13px] text-muted-foreground">{t('Nothing in this period.')}</p> : (
          <Table><TableHeader><TableRow>{head.map((h, i) => <TableHead key={h} className={i ? 'text-right' : ''}>{h}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{rows.map((r, i) => <TableRow key={i}>{r.map((c, j) => <TableCell key={j} className={j ? 'text-right tabular' : ''}>{c}</TableCell>)}</TableRow>)}</TableBody></Table>
        )}
      </CardContent>
    </Card>
  )
}
