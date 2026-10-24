import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { CalendarClock, FileText, Kanban, List, Plus, Trophy, XCircle } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatCompact, formatDate, formatMoney, humanize, initials, todayISO } from '@/lib/utils'
import { useCustomers, useMembers, useMoveOpportunity, useOpportunities, useSaveRecord, useStages, type OpportunityRow } from '../api'
import { opportunitySchema, type OpportunityValues } from '../schemas'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t, td, tr } from '@/i18n'

type Stage = { id: string; name: string; sort_order: number; probability: number; is_won: boolean; is_lost: boolean }

export function PipelinePage() {
  const [params, setParams] = useSearchParams()
  const [view, setView] = React.useState<'board' | 'list'>(() => {
    try { return (localStorage.getItem('nexus.pipeline.view') as 'board' | 'list') ?? 'board' } catch { return 'board' }
  })
  const [mine, setMine] = React.useState(false)
  const { user } = useAuth()
  const { companyId } = useCompany()
  const stages = useStages()
  const opps = useOpportunities()
  // live: deals moved by colleagues show up without reloading
  useRealtimeInvalidate('opportunities', companyId, [['sales', companyId, 'list', 'opportunities']])
  const openId = params.get('open')
  const setOpen = (id: string | null) => setParams((p) => { if (id) p.set('open', id); else p.delete('open'); return p }, { replace: true })
  const changeView = (v: 'board' | 'list') => { setView(v); try { localStorage.setItem('nexus.pipeline.view', v) } catch { /* private mode */ } }

  const rows = React.useMemo(() => (opps.data ?? []).filter((o) => !mine || o.owner_id === user?.id), [opps.data, mine, user?.id])
  const openRows = rows.filter((o) => o.status === 'open')
  const weighted = openRows.reduce((s, o) => s + Number(o.weighted_value ?? 0), 0)
  const total = openRows.reduce((s, o) => s + Number(o.expected_value), 0)

  return (
    <>
      <PageHeader
        title={t('Pipeline')}
        description={opps.data ? tr('{n} open deals worth {total}, {weighted} expected by probability.', { n: openRows.length, total: <span className="tabular font-medium text-foreground">{formatMoney(total)}</span>, weighted: <span className="tabular font-medium text-foreground">{formatMoney(weighted)}</span> }) : t('Deals in progress, by stage.')}
        actions={<>
          <Button variant={mine ? 'secondary' : 'ghost'} size="sm" onClick={() => setMine((m) => !m)} aria-pressed={mine}>{t('My deals')}</Button>
          <div className="flex rounded-md border p-0.5" role="group" aria-label={t('View|mode')}>
            <Button size="sm" variant={view === 'board' ? 'secondary' : 'ghost'} className="h-7" onClick={() => changeView('board')} aria-pressed={view === 'board'}><Kanban /> {t('Board')}</Button>
            <Button size="sm" variant={view === 'list' ? 'secondary' : 'ghost'} className="h-7" onClick={() => changeView('list')} aria-pressed={view === 'list'}><List /> {t('List')}</Button>
          </div>
          <Can perm="crm.write"><Button onClick={() => setOpen('new')}><Plus /> {t('New deal')}</Button></Can>
        </>}
      />
      {stages.isLoading || opps.isLoading ? (
        <div className="flex gap-3 overflow-hidden">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[420px] w-72 shrink-0" />)}</div>
      ) : opps.isError || stages.isError ? (
        <ErrorState error={opps.error ?? stages.error} onRetry={() => { void opps.refetch(); void stages.refetch() }} />
      ) : view === 'board' ? (
        <Board stages={(stages.data ?? []) as Stage[]} rows={rows} onOpen={setOpen} />
      ) : (
        <OpportunityList stages={(stages.data ?? []) as Stage[]} rows={rows} onOpen={setOpen} />
      )}
      <OpportunitySheet id={openId} stages={(stages.data ?? []) as Stage[]} rows={opps.data ?? []} onClose={() => setOpen(null)} />
    </>
  )
}

/* --------------------------------------------------------------- board */
function Board({ stages, rows, onOpen }: { stages: Stage[]; rows: OpportunityRow[]; onOpen: (id: string) => void }) {
  const { can } = useCompany()
  const move = useMoveOpportunity()
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [overStage, setOverStage] = React.useState<string | null>(null)
  const [lostFor, setLostFor] = React.useState<{ id: string; stageId: string } | null>(null)
  const writable = can('crm.write')

  const drop = (stage: Stage, id: string) => {
    const opp = rows.find((r) => r.id === id)
    if (!opp || opp.stage_id === stage.id) return
    if (stage.is_lost) { setLostFor({ id, stageId: stage.id }); return }
    move.mutate({ id, stageId: stage.id }, { onSuccess: () => { if (stage.is_won) toast.success(t('{name} won', { name: opp.name })) } })
  }

  return (
    <>
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-3">
        {stages.map((stage) => {
          const cards = rows.filter((r) => r.stage_id === stage.id)
          const value = cards.reduce((s, r) => s + Number(r.expected_value), 0)
          return (
            <section
              key={stage.id}
              aria-label={td(stage.name)}
              className={cn('flex w-[272px] shrink-0 snap-start flex-col rounded-lg border bg-muted/40 transition-colors',
                overStage === stage.id && 'border-primary/50 bg-primary/5', (stage.is_won || stage.is_lost) && 'bg-transparent')}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverStage(stage.id) } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage(null) }}
              onDrop={(e) => { e.preventDefault(); setOverStage(null); const id = e.dataTransfer.getData('text/plain'); if (id) drop(stage, id) }}
            >
              <header className="flex items-baseline justify-between gap-2 px-3 pb-2 pt-3">
                <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
                  {stage.is_won && <Trophy className="size-3.5 text-success" />}
                  {stage.is_lost && <XCircle className="size-3.5 text-muted-foreground" />}
                  {td(stage.name)}
                  <span className="font-normal text-muted-foreground">{cards.length}</span>
                </h2>
                <span className="tabular text-xs text-muted-foreground">{formatCompact(value)}{!stage.is_won && !stage.is_lost && ` · ${Number(stage.probability)}%`}</span>
              </header>
              <ol className="flex min-h-24 flex-col gap-2 px-2 pb-2">
                {cards.map((o) => (
                  <li
                    key={o.id}
                    draggable={writable}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', o.id); e.dataTransfer.effectAllowed = 'move'; setDragId(o.id) }}
                    onDragEnd={() => { setDragId(null); setOverStage(null) }}
                    className={cn('group rounded-md border bg-card shadow-sm', writable && 'cursor-grab active:cursor-grabbing', dragId === o.id && 'opacity-50')}
                  >
                    <button type="button" onClick={() => onOpen(o.id)} className="block w-full rounded-md p-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <div className="text-[13px] font-medium leading-snug">{o.name}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">{o.partner?.name ?? t('No customer yet')}</div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="tabular text-[13px] font-semibold">{formatMoney(o.expected_value)} <span className="text-2xs font-normal text-muted-foreground">{o.currency_code}</span></span>
                        <span className="flex items-center gap-1.5">
                          {o.expected_close_date && (
                            <span className={cn('inline-flex items-center gap-0.5 text-2xs text-muted-foreground', o.status === 'open' && o.expected_close_date < todayISO() && 'text-destructive')}>
                              <CalendarClock className="size-3" />{formatDate(o.expected_close_date).replace(/\s\d{4}$/, '')}
                            </span>
                          )}
                          {o.owner?.full_name && <Avatar className="size-5" title={o.owner.full_name}><AvatarFallback className="text-[9px]">{initials(o.owner.full_name)}</AvatarFallback></Avatar>}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
                {!cards.length && <li className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{writable ? t('Drag a deal here') : t('No deals')}</li>}
              </ol>
            </section>
          )
        })}
      </div>
      <LostReasonDialog
        open={!!lostFor}
        onClose={() => setLostFor(null)}
        onConfirm={async (reason) => { if (lostFor) await move.mutateAsync({ ...lostFor, lostReason: reason }); setLostFor(null) }}
      />
    </>
  )
}

function LostReasonDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (open) setReason('') }, [open])
  const reasons = [t('Price too high'), t('Chose a competitor'), t('No budget'), t('No response'), t('Not the right time')]
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Why was this deal lost?')}</DialogTitle><DialogDescription>{t('The reason shows in the won and lost reports.')}</DialogDescription></DialogHeader>
        <div className="flex flex-wrap gap-1.5">{reasons.map((r) => <Button key={r} type="button" size="sm" variant={reason === r ? 'secondary' : 'outline'} onClick={() => setReason(r)}>{r}</Button>)}</div>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Or describe it')} aria-label={t('Lost reason')} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="destructive" disabled={!reason.trim()} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(reason.trim()) } catch { /* toast by mutation */ } finally { setBusy(false) } }}>{t('Mark as lost')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- list */
function OpportunityList({ stages, rows, onOpen }: { stages: Stage[]; rows: OpportunityRow[]; onOpen: (id: string) => void }) {
  const stageName = React.useMemo(() => new Map(stages.map((s) => [s.id, td(s.name)])), [stages])
  const columns = React.useMemo<ColumnDef<OpportunityRow>[]>(() => [
    { accessorKey: 'number', header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') }, cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() as string}</span> },
    { accessorKey: 'name', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Deal')} />, meta: { label: t('Deal') }, cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { id: 'customer', accessorFn: (r) => r.partner?.name ?? '', header: ({ column }) => <ColumnHeader column={column} title={t('Customer')} />, meta: { label: t('Customer') } },
    { id: 'stage', accessorFn: (r) => stageName.get(r.stage_id) ?? '', filterFn: inFilter, header: t('Stage'), meta: { label: t('Stage') } },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status'), exportValue: (r) => humanize(r.status) }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { id: 'owner', accessorFn: (r) => r.owner?.full_name ?? '', filterFn: inFilter, header: t('Owner'), meta: { label: t('Owner') } },
    { accessorKey: 'expected_close_date', header: ({ column }) => <ColumnHeader column={column} title={t('Close date')} />, meta: { label: t('Expected close') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'probability', header: ({ column }) => <ColumnHeader column={column} title={t('Prob.')} />, meta: { label: t('Probability %'), align: 'right' }, cell: ({ getValue }) => `${Number(getValue())}%` },
    { accessorKey: 'expected_value', header: ({ column }) => <ColumnHeader column={column} title={t('Value')} />, meta: { label: t('Value'), align: 'right' }, cell: ({ row: { original: r } }) => <span className="tabular">{formatMoney(r.expected_value)} <span className="text-muted-foreground">{r.currency_code}</span></span> },
    { accessorKey: 'weighted_value', header: ({ column }) => <ColumnHeader column={column} title={t('Expected|value')} />, meta: { label: t('Expected by probability'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatMoney(getValue() as number)}</span> },
  ], [stageName])
  const owners = [...new Set(rows.map((r) => r.owner?.full_name).filter(Boolean))] as string[]
  return (
    <DataTable
      tableKey="crm.opportunities" columns={columns} data={rows} getRowId={(r) => r.id} exportName="opportunities"
      searchPlaceholder={t('Deal, customer…')} onRowClick={(r) => onOpen(r.id)} initialHidden={['number']}
      facets={[
        { columnId: 'status', title: t('Status'), options: ['open', 'won', 'lost'].map((v) => ({ value: v, label: humanize(v) })) },
        { columnId: 'stage', title: t('Stage'), options: stages.map((s) => ({ value: td(s.name), label: td(s.name) })) },
        { columnId: 'owner', title: t('Owner'), options: owners.map((o) => ({ value: o, label: o })) },
      ]}
      footer={(tbl) => {
        const r = tbl.getFilteredRowModel().rows.map((x) => x.original)
        return <span className="tabular">{t('{n} deals · {total} total · {weighted} expected', { n: r.length, total: formatMoney(r.reduce((s, o) => s + Number(o.expected_value), 0)), weighted: formatMoney(r.reduce((s, o) => s + Number(o.weighted_value ?? 0), 0)) })}</span>
      }}
      empty={{ title: t('No deals yet'), description: t('Convert a qualified lead, or add a deal directly.') }}
    />
  )
}

/* --------------------------------------------------------------- sheet */
function OpportunitySheet({ id, stages, rows, onClose }: { id: string | null; stages: Stage[]; rows: OpportunityRow[]; onClose: () => void }) {
  const opp = id && id !== 'new' ? rows.find((r) => r.id === id) : undefined
  const open = id === 'new' || !!opp
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg">
        {open && <OpportunityForm key={opp?.id ?? 'new'} opp={opp} stages={stages} onDone={onClose} />}
      </SheetContent>
    </Sheet>
  )
}

function OpportunityForm({ opp, stages, onDone }: { opp?: OpportunityRow; stages: Stage[]; onDone: () => void }) {
  const navigate = useNavigate()
  const { company, can } = useCompany()
  const { user } = useAuth()
  const customers = useCustomers()
  const members = useMembers()
  const save = useSaveRecord('opportunities')
  const move = useMoveOpportunity()
  const [lostOpen, setLostOpen] = React.useState(false)
  const writable = can('crm.write')
  const quotes = useQuery({
    queryKey: ['sales', company?.id, 'opp-quotes', opp?.id],
    enabled: !!opp,
    queryFn: async () => unwrap(await supabase.from('sales_quotes').select('id, number, status, total, currency_code, quote_date').eq('opportunity_id', opp!.id).is('deleted_at', null).order('quote_date', { ascending: false })),
  })
  const firstOpen = stages.find((s) => !s.is_won && !s.is_lost)
  const form = useForm<OpportunityValues>({
    resolver: zodResolver(opportunitySchema),
    defaultValues: {
      name: opp?.name ?? '', partner_id: opp?.partner_id ?? null, stage_id: opp?.stage_id ?? firstOpen?.id, owner_id: opp?.owner_id ?? user?.id ?? null,
      expected_value: opp?.expected_value ?? 0, expected_close_date: opp?.expected_close_date ?? '', lost_reason: opp?.lost_reason ?? '',
    },
  })
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        id: opp?.id, name: v.name, partner_id: v.partner_id ?? null, stage_id: v.stage_id, owner_id: v.owner_id ?? null,
        expected_value: v.expected_value, expected_close_date: v.expected_close_date || null,
        ...(opp ? {} : { currency_code: company?.base_currency ?? 'ALL' }),
      })
      toast.success(opp ? t('Deal updated') : t('Deal added'))
      onDone()
    } catch (e) { toast.error(describeError(e)) }
  })
  const won = stages.find((s) => s.is_won)
  const lost = stages.find((s) => s.is_lost)
  const quoteHref = `/sales/quotes/new?${new URLSearchParams({ ...(opp?.partner_id ? { customer: opp.partner_id } : {}), ...(opp ? { opportunity: opp.id } : {}) })}`

  return (
    <>
      <SheetHeader>
        <SheetTitle>{opp ? opp.name : t('New deal')}</SheetTitle>
        {opp && <SheetDescription className="flex items-center gap-2">{opp.number} <StatusBadge status={opp.status} />{opp.lost_reason && <span>· {opp.lost_reason}</span>}</SheetDescription>}
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <Form {...form}>
          <form id="opp-form" onSubmit={submit} className="grid gap-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>{t('Deal name')}</FormLabel><FormControl><Input placeholder={t('Coffee machines for 3 branches')} disabled={!writable} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="partner_id" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Customer')}</FormLabel>
                <FormControl><SearchSelect value={field.value} onChange={field.onChange} clearable disabled={!writable} placeholder={t('Choose a customer')}
                  options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code }))} /></FormControl></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="stage_id" render={({ field }) => (
                <FormItem><FormLabel>{t('Stage')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={!writable || opp?.status !== undefined && opp.status !== 'open'}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{stages.filter((s) => !s.is_lost && (!s.is_won || !!opp)).map((s) => <SelectItem key={s.id} value={s.id}>{td(s.name)} · {Number(s.probability)}%</SelectItem>)}</SelectContent>
                  </Select><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="owner_id" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Owner')}</FormLabel>
                  <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!writable}>
                    <FormControl><SelectTrigger><SelectValue placeholder={t('Unassigned')} /></SelectTrigger></FormControl>
                    <SelectContent>{(members.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name ?? m.email}</SelectItem>)}</SelectContent>
                  </Select></FormItem>
              )} />
              <FormField control={form.control} name="expected_value" render={({ field }) => (
                <FormItem><FormLabel>{t('Value ({currency})', { currency: opp?.currency_code ?? company?.base_currency ?? '' })}</FormLabel><FormControl><Input type="number" step="any" className="tabular" disabled={!writable} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="expected_close_date" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Expected close')}</FormLabel><FormControl><Input type="date" disabled={!writable} {...field} /></FormControl></FormItem>
              )} />
            </div>
          </form>
        </Form>

        {opp && (
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">{t('Quotes')}</h3>
              <Can perm="sales.write">{opp.status === 'open' && <Button size="sm" variant="outline" asChild><Link to={quoteHref}><FileText /> {t('New quote')}</Link></Button>}</Can>
            </div>
            {quotes.data?.length ? (
              <ul className="divide-y rounded-md border">
                {quotes.data.map((q) => (
                  <li key={q.id}><Link to={`/sales/quotes/${q.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px] hover:bg-secondary">
                    <span className="font-medium">{q.number}</span><span className="text-muted-foreground">{formatDate(q.quote_date)}</span>
                    <StatusBadge status={q.status} /><span className="tabular">{formatMoney(q.total)} {q.currency_code}</span>
                  </Link></li>
                ))}
              </ul>
            ) : <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">{t('No quotes yet. When a quote becomes an order, this deal is marked as won.')}</p>}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
        <div className="flex gap-1.5">
          {opp?.status === 'open' && writable && won && <Button variant="outline" size="sm" onClick={() => move.mutate({ id: opp.id, stageId: won.id }, { onSuccess: () => { toast.success(t('Deal won')); onDone() } })}><Trophy /> {t('Won')}</Button>}
          {opp?.status === 'open' && writable && lost && <Button variant="ghost" size="sm" onClick={() => setLostOpen(true)}><XCircle /> {t('Lost')}</Button>}
          {opp?.status === 'lost' && writable && firstOpen && <Button variant="outline" size="sm" onClick={() => move.mutate({ id: opp.id, stageId: firstOpen.id })}>{t('Reopen')}</Button>}
          {opp?.status === 'won' && <Button variant="ghost" size="sm" onClick={() => navigate(`/sales/orders?customer=${opp.partner_id ?? ''}`)}>{t('View orders')}</Button>}
        </div>
        {writable && <Button type="submit" form="opp-form" loading={save.isPending}>{opp ? t('Save') : t('Add deal')}</Button>}
      </div>
      {opp && lost && (
        <LostReasonDialog open={lostOpen} onClose={() => setLostOpen(false)}
          onConfirm={async (reason) => { await move.mutateAsync({ id: opp.id, stageId: lost.id, lostReason: reason }); setLostOpen(false); onDone() }} />
      )}
    </>
  )
}
