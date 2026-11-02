import type { ColumnDef } from '@tanstack/react-table'
import { CalendarPlus, CircleCheck, FilePen, FileSignature, FileText, FileUp, PenLine, Plus, Printer, RotateCcw, Trash2, UserX } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ActivityTimeline } from '@/components/activity-timeline'
import { LinkedTasks } from '@/features/tasks/components/linked-tasks'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { Hint } from '@/components/help'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/i18n'
import { LAW, legalNoticeDays, type Country } from '@/i18n/contracts/models'
import { cn, formatDate, formatMoney, formatQty, humanize, num, todayISO } from '@/lib/utils'
import { useCompanyProfile, useCompanySettings } from '@/features/settings/api'
import {
  openSignedCopy, useAnnexContract, useContract, useContractChain, useContractList, useContractTemplates, useCreateContract, useDeleteContract,
  useEmployee, useEmployees, useEndContract, useSignContract, useUpdateContract, useUploadSignedCopy, type ContractFull,
} from '../api'
import { contractPaper, CONTRACT_CSS, contractValues, countryOf, defaultModel, fillModel, printContract, probationEnd, type ContractFacts } from '../contract-doc'

export const CONTRACT_TYPES = ['indefinite', 'fixed_term', 'seasonal', 'service'] as const
export const END_REASONS = ['resigned', 'dismissed', 'mutual', 'expired', 'probation', 'retired', 'other'] as const
const addDays = (iso: string, n: number) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)

/** what a contract needs to be shown or printed */
function useFacts(c: ContractFull | null | undefined): ContractFacts | null {
  const profile = useCompanyProfile()
  const settings = useCompanySettings()
  const chain = useContractChain(c)
  if (!c || !profile.data) return null
  const parent = c.parent_id ? (chain.data ?? []).find((x) => x.id === c.parent_id) : null
  return {
    contract: c, company: profile.data, settings: settings.data ?? null, today: todayISO(),
    parent: parent ? { ...(parent as unknown as ContractFull) } : null,
  }
}

/* ================================================================== the list */
type View = 'all' | 'active' | 'draft' | 'ending' | 'probation' | 'ended'
export function ContractsPage() {
  const list = useContractList()
  const navigate = useNavigate()
  const [view, setView] = React.useState<View>('active')
  const [newOpen, setNewOpen] = React.useState(false)
  const today = todayISO()
  const rows = list.data ?? []
  const is = {
    active: (c: ContractFull) => c.status === 'active',
    draft: (c: ContractFull) => !c.signed_on && c.status !== 'ended',
    ending: (c: ContractFull) => c.status === 'active' && !!c.end_date && c.end_date <= addDays(today, 60),
    probation: (c: ContractFull) => { const pe = c.status === 'active' ? probationEnd(c) : null; return !!pe && pe >= today },
    ended: (c: ContractFull) => c.status === 'ended',
  }
  const count = (k: Exclude<View, 'all'>) => rows.filter(is[k]).length
  const data = view === 'all' ? rows : rows.filter(is[view])
  const cols = React.useMemo<ColumnDef<ContractFull>[]>(() => [
    { accessorKey: 'number', header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') },
      cell: ({ row }) => <span className="font-medium">{row.original.number}{row.original.kind === 'annex' && <Badge variant="secondary" className="ml-1.5">{t('Annex')}</Badge>}</span> },
    { id: 'employee', accessorFn: (c) => c.employee?.full_name ?? '', header: ({ column }) => <ColumnHeader column={column} title={t('Employee')} />, meta: { label: t('Employee') } },
    { id: 'job', accessorFn: (c) => c.job_title ?? c.employee?.position?.title ?? '', header: t('Position'), meta: { label: t('Position') }, cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() as string}</span> },
    { accessorKey: 'contract_type', filterFn: inFilter, header: t('Type'), meta: { label: t('Type') }, cell: ({ getValue }) => humanize(getValue() as string) },
    { accessorKey: 'start_date', header: ({ column }) => <ColumnHeader column={column} title={t('From')} />, meta: { label: t('From') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'end_date', header: ({ column }) => <ColumnHeader column={column} title={t('To')} />, meta: { label: t('To') },
      cell: ({ getValue }) => getValue() ? formatDate(getValue() as string) : <span className="text-muted-foreground">{t('No end date')}</span> },
    { accessorKey: 'gross_salary', header: t('Gross per month'), meta: { label: t('Gross per month'), align: 'right' },
      cell: ({ row }) => <span className="tabular">{formatMoney(row.original.gross_salary, row.original.currency_code)}</span> },
    { id: 'signed', accessorFn: (c) => c.signed_on ?? '', header: t('Signed'), meta: { label: t('Signed') },
      cell: ({ row }) => row.original.signed_on ? <span className="inline-flex items-center gap-1 text-success"><CircleCheck className="size-3.5" /> {formatDate(row.original.signed_on)}</span>
        : <span className="text-muted-foreground">{t('Not signed')}</span> },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
  ], [])
  const views: [View, string, number | null][] = [
    ['active', t('In force'), count('active')], ['draft', t('Not signed yet'), count('draft')], ['ending', t('Ending in 60 days'), count('ending')],
    ['probation', t('On probation'), count('probation')], ['ended', t('Ended|contracts'), count('ended')], ['all', t('All'), null],
  ]
  return (
    <>
      <PageHeader title={t('Employment contracts')} description={t('Every contract and annex: the written text, signing, raises and changes, and how each one ended.')}
        actions={<Can perm="payroll.write"><Button onClick={() => setNewOpen(true)}><Plus /> {t('New contract')}</Button></Can>} />
      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label={t('Show')}>
        {views.map(([k, label, n]) => (
          <Button key={k} role="tab" aria-selected={view === k} size="sm" variant={view === k ? 'default' : 'outline'} onClick={() => setView(k)}>
            {label}{n != null && <span className={cn('tabular rounded-full px-1.5 text-xs', view === k ? 'bg-primary-foreground/20' : 'bg-muted')}>{n}</span>}
          </Button>))}
      </div>
      <DataTable key={view} tableKey="hr.contracts" columns={cols} data={data} isLoading={list.isLoading} error={list.error} getRowId={(r) => r.id}
        exportName="employment-contracts" searchPlaceholder={t('Employee, number, position…')} onRowClick={(r) => navigate(`/hr/contracts/${r.id}`)}
        facets={[{ columnId: 'contract_type', title: t('Type'), options: CONTRACT_TYPES.map((s) => ({ value: s, label: humanize(s) })) }]}
        empty={{ title: t('No contracts here'), description: t('Write a contract from a model, print it, sign it, and payroll uses it from its first day.'),
          action: <Can perm="payroll.write"><Button size="sm" onClick={() => setNewOpen(true)}><Plus /> {t('New contract')}</Button></Can> }} />
      {newOpen && <NewContractDialog onClose={() => setNewOpen(false)} />}
    </>
  )
}

/* ================================================================== a new contract: the terms, then the text from a model */
export function NewContractDialog({ employeeId, onClose }: { employeeId?: string; onClose: () => void }) {
  const { company } = useCompany()
  const country: Country = countryOf(company?.country_code ?? 'AL')
  const law = LAW[country]
  const employees = useEmployees()
  const templates = useContractTemplates()
  const create = useCreateContract()
  const navigate = useNavigate()
  const [emp, setEmp] = React.useState<string | null>(employeeId ?? null)
  const person = useEmployee(emp ?? undefined)
  const [v, setV] = React.useState({
    contract_type: 'indefinite', start_date: todayISO(), end_date: '', gross_salary: '', working_hours_per_week: String(law.hoursPerWeek),
    job_title: '', job_description: '', workplace: '', work_schedule: '', probation_months: String(law.probationDefault),
    annual_leave_days: String(law.leaveDays), notice_days: '', pay_day: '15', is_primary_employer: true, template: 'default',
  })
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  React.useEffect(() => { if (person.data?.position?.title) setV((s) => s.job_title ? s : { ...s, job_title: person.data!.position!.title }) }, [person.data])
  const fixed = v.contract_type === 'fixed_term' || v.contract_type === 'seasonal'
  const custom = (templates.data ?? []).filter((x) => x.kind === 'contract' && (!x.contract_type || x.contract_type === v.contract_type))
  const notice = v.notice_days === '' ? legalNoticeDays(country, v.start_date, v.start_date) : num(v.notice_days)
  const problems = [
    !emp && t('Choose the employee'),
    !v.job_title.trim() && t('Enter the position'),
    num(v.gross_salary) <= 0 && v.contract_type !== 'service' && t('Enter the gross pay'),
    fixed && !v.end_date && t('A fixed-term contract needs an end date'),
    v.end_date && v.end_date < v.start_date && t('The end date is before the start'),
    num(v.probation_months) > law.probationMax && t('Probation is at most {n} months', { n: law.probationMax }),
    num(v.annual_leave_days) < law.leaveDays && t('Annual leave is at least {n} working days', { n: law.leaveDays }),
    num(v.working_hours_per_week) > law.hoursPerWeek && t('Full time is at most {n} hours a week', { n: law.hoursPerWeek }),
  ].filter(Boolean) as string[]
  const body = v.template === 'default' ? defaultModel(country, 'contract', v.contract_type) : custom.find((x) => x.id === v.template)?.body ?? defaultModel(country, 'contract', v.contract_type)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{t('New contract')}</DialogTitle>
          <DialogDescription>{t('The terms of the contract. The text comes from the model and you can still change it before signing.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {!employeeId && <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Employee')}</Label>
            <SearchSelect value={emp} onChange={setEmp} placeholder={t('Choose the employee')}
              options={(employees.data ?? []).filter((e) => e.employment_status !== 'terminated').map((e) => ({ value: e.id, label: e.full_name, hint: e.position?.title ?? e.number ?? undefined }))} /></div>}
          <div className="grid gap-1.5"><Label>{t('Type')}</Label>
            <Select value={v.contract_type} onValueChange={(x) => setV((s) => ({ ...s, contract_type: x, template: 'default' }))}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>{t('Model')}</Label>
            <Select value={v.template} onValueChange={set('template')}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="default">{t('DrisPRO model ({country})', { country: country === 'XK' ? 'Kosovë' : 'Shqipëri' })}</SelectItem>
                {custom.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="nc-from">{t('Starts on')}</Label><Input id="nc-from" type="date" value={v.start_date} onChange={(e) => set('start_date')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="nc-to">{t('Ends on')}{!fixed && <span className="ml-1 font-normal text-muted-foreground">({t('optional')})</span>}</Label>
            <Input id="nc-to" type="date" value={v.end_date} onChange={(e) => set('end_date')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="nc-job">{t('Position')}</Label><Input id="nc-job" value={v.job_title} onChange={(e) => set('job_title')(e.target.value)} placeholder={t('e.g. Cashier')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="nc-place">{t('Place of work')}</Label><Input id="nc-place" value={v.workplace} onChange={(e) => set('workplace')(e.target.value)} placeholder={t('The company address')} /></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="nc-desc">{t('What the job is')}</Label>
            <Textarea id="nc-desc" rows={2} value={v.job_description} onChange={(e) => set('job_description')(e.target.value)} placeholder={t('e.g. Serves customers at the till, keeps the shelves full and counts the cash at the end of the shift.')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="nc-gross">{t('Gross per month')} ({company?.base_currency})</Label>
            <Input id="nc-gross" type="number" step="any" className="text-right tabular" value={v.gross_salary} onChange={(e) => set('gross_salary')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="nc-payday">{t('Paid by day of the next month')}</Label>
            <Input id="nc-payday" type="number" min={1} max={31} className="text-right tabular" value={v.pay_day} onChange={(e) => set('pay_day')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="nc-h">{t('Hours per week')}</Label>
            <Input id="nc-h" type="number" step="any" className="text-right tabular" value={v.working_hours_per_week} onChange={(e) => set('working_hours_per_week')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="nc-sched">{t('Working hours')}</Label>
            <Input id="nc-sched" value={v.work_schedule} onChange={(e) => set('work_schedule')(e.target.value)} placeholder={t('e.g. Monday to Friday, 08:00–16:00')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="nc-prob">{t('Probation (months)')}<Hint text={{ sq: `Sipas ligjit, deri në ${law.probationMax} muaj. 0 = pa periudhë prove.`, en: `By law, up to ${law.probationMax} months. 0 = no probation.` }} /></Label>
            <Input id="nc-prob" type="number" min={0} max={law.probationMax} className="text-right tabular" value={v.probation_months} onChange={(e) => set('probation_months')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="nc-leave">{t('Annual leave (working days)')}<Hint text={{ sq: `Minimumi ligjor: ${law.leaveDays} ditë pune në vit.`, en: `The legal minimum: ${law.leaveDays} working days a year.` }} /></Label>
            <Input id="nc-leave" type="number" min={0} className="text-right tabular" value={v.annual_leave_days} onChange={(e) => set('annual_leave_days')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="nc-notice">{t('Notice (days)')}<Hint text={{ sq: 'Bosh = sipas ligjit, sipas vjetërsisë në punë kur jepet njoftimi.', en: 'Empty = by law, by length of service when notice is given.' }} /></Label>
            <Input id="nc-notice" type="number" min={0} className="text-right tabular" value={v.notice_days} onChange={(e) => set('notice_days')(e.target.value)} placeholder={t('By law ({n})', { n: notice })} /></div>
          {country === 'XK' && <div className="flex items-center justify-between gap-2 pt-6"><Label htmlFor="nc-prim">{t('Main employer')}</Label>
            <Switch id="nc-prim" checked={v.is_primary_employer} onCheckedChange={set('is_primary_employer')} /></div>}
        </div>
        {!!problems.length && emp && <ul className="grid gap-0.5 text-xs text-destructive">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={create.isPending} disabled={!!problems.length} onClick={async () => {
            const r = await create.mutateAsync({
              employee_id: emp!, contract_type: v.contract_type, start_date: v.start_date, end_date: v.end_date || null, gross_salary: num(v.gross_salary),
              currency_code: company?.base_currency ?? 'EUR', working_hours_per_week: num(v.working_hours_per_week), job_title: v.job_title.trim() || null,
              job_description: v.job_description.trim() || null, workplace: v.workplace.trim() || null, work_schedule: v.work_schedule.trim() || null,
              probation_months: num(v.probation_months), annual_leave_days: num(v.annual_leave_days), notice_days: v.notice_days === '' ? null : num(v.notice_days),
              pay_day: num(v.pay_day) || null, is_primary_employer: v.is_primary_employer, template_key: v.template, body,
            })
            toast.success(t('Contract ready to print and sign')); onClose(); navigate(`/hr/contracts/${r.id}`)
          }}><FilePen /> {t('Write the contract')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ================================================================== one contract */
function Paper({ html }: { html: string }) {
  const ref = React.useRef<HTMLIFrameElement>(null)
  const [h, setH] = React.useState(900)
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>${CONTRACT_CSS} body{padding:36px 44px;background:#fff}</style></head><body>${html}</body></html>`
  return <iframe ref={ref} title={t('The contract')} srcDoc={doc} className="w-full rounded-md border bg-white shadow-sm" style={{ height: h }}
    onLoad={() => { const b = ref.current?.contentDocument?.body; if (b) setH(Math.max(400, b.scrollHeight + 24)) }} />
}

export function ContractPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { company, can } = useCompany()
  const q = useContract(id)
  const c = q.data
  const facts = useFacts(c)
  const chain = useContractChain(c)
  const update = useUpdateContract()
  const del = useDeleteContract()
  const upload = useUploadSignedCopy()
  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState('')
  const [dialog, setDialog] = React.useState<null | 'sign' | 'annex' | 'extend' | 'end' | 'terms'>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (!c) return <EmptyState title={t('Contract not found')} description={t('It may have been deleted.')} action={<Button asChild variant="outline"><Link to="/hr/contracts">{t('Employment contracts')}</Link></Button>} />
  const country = countryOf(company?.country_code ?? 'AL')
  const draft = c.status === 'draft'
  const unsigned = !c.signed_on && c.status !== 'ended'
  const write = can('payroll.write')
  const model = c.body ?? defaultModel(country, c.kind === 'annex' ? 'annex' : 'contract', c.contract_type)
  const html = facts ? contractPaper(facts, model) : ''
  const pe = probationEnd(c)
  const later = (chain.data ?? []).filter((x) => x.parent_id === c.id)
  const noticeModel = defaultModel(country, 'notice')
  const title = c.kind === 'annex' ? t('Annex {number}', { number: c.number ?? '' }) : t('Contract {number}', { number: c.number ?? '' })
  return (
    <>
      <PageHeader title={title} back={{ href: '/hr/contracts', label: t('Employment contracts') }}
        meta={<><StatusBadge status={c.status} />{c.signed_on ? <Badge variant="success">{t('Signed {date}', { date: formatDate(c.signed_on) })}</Badge> : <Badge variant="warning">{t('Not signed')}</Badge>}</>}
        description={<>{c.employee && <Link className="font-medium text-primary hover:underline" to={`/hr/employees/${c.employee.id}`}>{c.employee.full_name}</Link>}
          {' · '}{humanize(c.contract_type)} · {formatDate(c.start_date)} – {c.end_date ? formatDate(c.end_date) : t('No end date')}</>}
        actions={<>
          <Button variant="outline" disabled={!facts} onClick={() => facts && printContract(facts, model)}><Printer /> {t('Print')}</Button>
          {write && unsigned && <Button onClick={() => setDialog('sign')}><FileSignature /> {t('Mark as signed')}</Button>}
          {write && c.status === 'active' && <>
            <Button variant="outline" onClick={() => setDialog('annex')}><PenLine /> {t('Annex')}</Button>
            {c.end_date && <Button variant="outline" onClick={() => setDialog('extend')}><CalendarPlus /> {t('Extend')}</Button>}
            <Button variant="outline" onClick={() => setDialog('end')}><UserX /> {t('End the contract')}</Button>
          </>}
          {c.status === 'ended' && c.ended_reason && !['changed', 'replaced'].includes(c.ended_reason) && facts &&
            <Button variant="outline" onClick={() => printContract(facts, noticeModel)}><FileText /> {t('Print the notice')}</Button>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-3">
          {unsigned && write && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[13px]">
              <span>{draft ? t('A draft: check the text, print it, have it signed, then mark it signed. Payroll uses it from then on.') : t('Payroll already uses this contract, but it has no signature yet: print it, have it signed and mark it signed.')}
                {facts && !facts.settings?.contract_signatory && <> <Link className="font-medium text-primary hover:underline" to="/hr/setup?tab=contracts">{t('Set who signs for the company')}</Link></>}</span>
              <div className="flex gap-2">
                {!editing && <Button size="sm" variant="outline" onClick={() => { setText(model); setEditing(true) }}><FilePen /> {t('Edit the text')}</Button>}
                <Button size="sm" variant="outline" onClick={() => setDialog('terms')}>{t('Change terms')}</Button>
              </div>
            </div>)}
          {editing ? (
            <Card><CardContent className="grid gap-2 p-3">
              <p className="text-xs text-muted-foreground">{t('Words in {{double braces}} are filled from the contract and the employee card. A blank line starts a new paragraph; a line starting with "Neni" is a heading.')}</p>
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={28} className="font-mono text-[12.5px] leading-relaxed" aria-label={t('The contract text')} />
              <div className="flex flex-wrap justify-between gap-2">
                <ConfirmDialog trigger={<Button size="sm" variant="ghost"><RotateCcw /> {t('Back to the model')}</Button>} title={t('Back to the model?')}
                  description={t('Your changes to the text are replaced by the model.')} confirmLabel={t('Back to the model')}
                  onConfirm={() => setText(defaultModel(country, c.kind === 'annex' ? 'annex' : 'contract', c.contract_type))} />
                <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(false)}>{t('Cancel')}</Button>
                  <Button size="sm" loading={update.isPending} onClick={async () => { await update.mutateAsync({ id: c.id, body: text }); setEditing(false); toast.success(t('Saved')) }}>{t('Save')}</Button></div>
              </div>
            </CardContent></Card>
          ) : facts ? <Paper html={html} /> : <Skeleton className="h-[600px]" />}
        </div>

        <div className="grid content-start gap-3">
          <Card><CardHeader className="py-3"><CardTitle>{t('Terms')}</CardTitle></CardHeader>
            <CardContent className="grid gap-1.5 pb-4 text-[13px]">
              <Row k={t('Position')} v={c.job_title ?? c.employee?.position?.title ?? '—'} />
              <Row k={t('Gross per month')} v={formatMoney(c.gross_salary, c.currency_code)} strong />
              <Row k={t('Hours per week')} v={formatQty(c.working_hours_per_week)} />
              {c.work_schedule && <Row k={t('Working hours')} v={c.work_schedule} />}
              <Row k={t('Place of work')} v={c.workplace ?? '—'} />
              <Row k={t('Probation')} v={pe ? t('until {date}', { date: formatDate(pe) }) : t('None')} />
              <Row k={t('Annual leave')} v={c.annual_leave_days != null ? t('{n} working days', { n: c.annual_leave_days }) : '—'} />
              <Row k={t('Notice')} v={c.notice_days != null ? t('{n} days', { n: c.notice_days }) : t('By law')} />
              {c.pay_day && <Row k={t('Paid by|payday')} v={t('day {n} of the next month', { n: c.pay_day })} />}
              {country === 'XK' && <Row k={t('Employer')} v={c.is_primary_employer ? t('Main employer') : t('Second job · 10% tax')} />}
              {c.status === 'ended' && <>
                <div className="my-1 border-t" />
                <Row k={t('Last working day')} v={formatDate(c.end_date)} strong />
                {c.ended_reason && <Row k={t('Why')} v={t(REASON_LABEL[c.ended_reason] ?? 'Other')} />}
                {c.notice_given_on && <Row k={t('Notice given')} v={formatDate(c.notice_given_on)} />}
                {c.ended_note && <p className="text-muted-foreground">{c.ended_note}</p>}
              </>}
            </CardContent></Card>

          <Card><CardHeader className="py-3"><CardTitle>{t('Signed copy')}</CardTitle>
            <CardDescription>{t('The scan or photo of the signed contract, kept with it. Only payroll people and the employee can open it.')}</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap gap-2 pb-4">
              {c.signed_file && <Button size="sm" variant="outline" onClick={() => void openSignedCopy(c.signed_file!)}><FileText /> {c.signed_file_name ?? t('Open')}</Button>}
              {write && <><input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden"
                onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return
                  if (f.size > 15 * 1024 * 1024) { toast.error(t('The file is larger than 15 MB')); return }
                  await upload.mutateAsync({ contract: c, file: f }); toast.success(t('Signed copy saved')) }} />
                <Button size="sm" variant={c.signed_file ? 'ghost' : 'outline'} loading={upload.isPending} onClick={() => fileRef.current?.click()}><FileUp /> {c.signed_file ? t('Replace') : t('Add the signed copy')}</Button></>}
              {!c.signed_file && !write && <p className="text-[13px] text-muted-foreground">{t('Not added yet.')}</p>}
            </CardContent></Card>

          {(chain.data?.length ?? 0) > 1 && (
            <Card><CardHeader className="py-3"><CardTitle>{t('History of {name}', { name: c.employee?.first_name ?? '' })}</CardTitle></CardHeader>
              <CardContent className="grid gap-1 pb-4 text-[13px]">
                {(chain.data ?? []).map((x) => (
                  <Link key={x.id} to={`/hr/contracts/${x.id}`} className={cn('flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted', x.id === c.id && 'bg-muted font-medium')}>
                    <span>{x.number}{x.kind === 'annex' && <span className="text-muted-foreground"> · {t('Annex')}</span>}<span className="block text-xs text-muted-foreground">{formatDate(x.start_date)} – {x.end_date ? formatDate(x.end_date) : '…'}</span></span>
                    <span className="text-right"><span className="tabular">{formatMoney(x.gross_salary, x.currency_code)}</span><span className="block"><StatusBadge status={x.status} /></span></span>
                  </Link>))}
                {later.some((x) => x.status === 'draft') && <p className="px-2 text-xs text-warning">{t('An annex is waiting to be signed.')}</p>}
              </CardContent></Card>)}

          {draft && write && <ConfirmDialog trigger={<Button variant="ghost" className="justify-self-start text-destructive"><Trash2 /> {t('Delete draft')}</Button>}
            title={t('Delete draft {number}?', { number: c.number ?? '' })} description={t('The draft disappears from lists.')} confirmLabel={t('Delete')} destructive
            onConfirm={async () => { await del.mutateAsync(c.id); navigate('/hr/contracts') }} />}
        </div>
      </div>
      <div className="mt-4 grid max-w-3xl gap-4"><LinkedTasks entityType="employment_contracts" entityId={c.id} label={c.number} /><ActivityTimeline table="employment_contracts" id={c.id} /></div>

      {dialog === 'sign' && facts && <SignDialog facts={facts} body={model} onClose={() => setDialog(null)} />}
      {(dialog === 'annex' || dialog === 'extend') && <AnnexDialog contract={c} extend={dialog === 'extend'} onClose={() => setDialog(null)} />}
      {dialog === 'end' && <EndDialog contract={c} country={country} onClose={() => setDialog(null)} onPrint={(f) => facts && printContract({ ...facts, contract: { ...c, ...f } }, noticeModel)} />}
      {dialog === 'terms' && <TermsDialog contract={c} country={country} onClose={() => setDialog(null)} />}
    </>
  )
}

const REASON_LABEL: Record<string, string> = {
  resigned: 'The employee resigned', dismissed: 'Dismissed by the employer', mutual: 'By mutual agreement', expired: 'The term ran out',
  probation: 'Did not pass probation', retired: 'Retirement', other: 'Other', changed: 'Changed by an annex', replaced: 'Replaced by a new contract',
}
function Row({ k, v, strong }: { k: string; v: React.ReactNode; strong?: boolean }) {
  return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className={cn('text-right', strong && 'font-semibold tabular')}>{v}</span></div>
}

/* ------------------------------------------------------------------ signing: the text is fixed with today's values */
function SignDialog({ facts, body, onClose }: { facts: ContractFacts; body: string; onClose: () => void }) {
  const c = facts.contract
  const sign = useSignContract()
  const update = useUpdateContract()
  const [on, setOn] = React.useState(todayISO())
  const replaces = c.kind === 'contract'
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Mark as signed')}</DialogTitle>
          <DialogDescription>{c.kind === 'annex'
            ? t('From {date} the new terms apply and payroll uses them; the contract it changes ends the day before.', { date: formatDate(c.start_date) })
            : t('The contract comes into force on {date} and payroll uses it. {hint}', { date: formatDate(c.start_date), hint: replaces ? t('A contract still in force for this person ends the day before.') : '' })}</DialogDescription></DialogHeader>
        <div className="grid gap-1.5"><Label htmlFor="sg-on">{t('Signed on')}</Label><Input id="sg-on" type="date" max={todayISO()} value={on} onChange={(e) => setOn(e.target.value)} /></div>
        <p className="text-xs text-muted-foreground">{t('After signing the text and the terms no longer change: a raise, a new position or a longer term is made with an annex.')}</p>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={sign.isPending || update.isPending} disabled={!on} onClick={async () => {
            // the paper keeps the words it was signed with, even if the employee card changes later
            const filled = fillModel(body, contractValues({ ...facts, contract: { ...c, signed_on: on }, today: on }))
            await update.mutateAsync({ id: c.id, body: filled })
            await sign.mutateAsync({ id: c.id, on })
            toast.success(t('Contract signed')); onClose()
          }}><FileSignature /> {t('Mark as signed')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ an annex: what changes, from when */
function AnnexDialog({ contract: c, extend, onClose }: { contract: ContractFull; extend: boolean; onClose: () => void }) {
  const { company } = useCompany()
  const annex = useAnnexContract()
  const navigate = useNavigate()
  const country = countryOf(company?.country_code ?? 'AL')
  const [from, setFrom] = React.useState(extend && c.end_date ? addDays(c.end_date, 1) : todayISO())
  const [v, setV] = React.useState({
    gross_salary: String(c.gross_salary), job_title: c.job_title ?? '', job_description: c.job_description ?? '', workplace: c.workplace ?? '',
    working_hours_per_week: String(c.working_hours_per_week), work_schedule: c.work_schedule ?? '', end_date: extend && c.end_date ? addDays(c.end_date, 365) : c.end_date ?? '',
    indefinite: false,
  })
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  const terms: Record<string, unknown> = {}
  if (num(v.gross_salary) !== Number(c.gross_salary)) terms.gross_salary = num(v.gross_salary)
  if (v.job_title.trim() !== (c.job_title ?? '')) terms.job_title = v.job_title.trim()
  if (v.job_description.trim() !== (c.job_description ?? '')) terms.job_description = v.job_description.trim()
  if (v.workplace.trim() !== (c.workplace ?? '')) terms.workplace = v.workplace.trim()
  if (num(v.working_hours_per_week) !== Number(c.working_hours_per_week)) terms.working_hours_per_week = num(v.working_hours_per_week)
  if (v.work_schedule.trim() !== (c.work_schedule ?? '')) terms.work_schedule = v.work_schedule.trim()
  if (v.indefinite) { terms.end_date = ''; terms.contract_type = 'indefinite' }
  else if ((v.end_date || '') !== (c.end_date ?? '')) terms.end_date = v.end_date
  const valid = from > c.start_date && Object.keys(terms).length > 0 && (!v.end_date || v.indefinite || v.end_date >= from) && num(v.gross_salary) >= 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{extend ? t('Extend the contract') : t('Annex to the contract')}</DialogTitle>
          <DialogDescription>{t('Change only what changes. The annex is a draft until it is signed; then the new terms apply from its first day.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="ax-from">{t('Applies from')}</Label><Input id="ax-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ax-to">{t('Contract ends on')}</Label><Input id="ax-to" type="date" disabled={v.indefinite} value={v.end_date} onChange={(e) => set('end_date')(e.target.value)} /></div>
          {c.end_date && <div className="flex items-center gap-2 sm:col-span-2"><Switch id="ax-indef" checked={v.indefinite} onCheckedChange={set('indefinite')} />
            <Label htmlFor="ax-indef" className="font-normal">{t('From now on without an end date (indefinite)')}</Label></div>}
          {!extend && <>
            <div className="grid gap-1.5"><Label htmlFor="ax-gross">{t('Gross per month')}</Label><Input id="ax-gross" type="number" step="any" className="text-right tabular" value={v.gross_salary} onChange={(e) => set('gross_salary')(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ax-h">{t('Hours per week')}</Label><Input id="ax-h" type="number" step="any" className="text-right tabular" value={v.working_hours_per_week} onChange={(e) => set('working_hours_per_week')(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ax-job">{t('Position')}</Label><Input id="ax-job" value={v.job_title} onChange={(e) => set('job_title')(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ax-place">{t('Place of work')}</Label><Input id="ax-place" value={v.workplace} onChange={(e) => set('workplace')(e.target.value)} /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="ax-sched">{t('Working hours')}</Label><Input id="ax-sched" value={v.work_schedule} onChange={(e) => set('work_schedule')(e.target.value)} /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="ax-desc">{t('What the job is')}</Label><Textarea id="ax-desc" rows={2} value={v.job_description} onChange={(e) => set('job_description')(e.target.value)} /></div>
          </>}
        </div>
        {country === 'AL' && extend && <p className="text-xs text-muted-foreground">{t('In Albania a fixed-term contract that goes on after its end without a new agreement counts as indefinite.')}</p>}
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={annex.isPending} disabled={!valid} onClick={async () => {
            const id = await annex.mutateAsync({ id: c.id, from, terms, body: defaultModel(country, 'annex') })
            toast.success(t('Annex ready to print and sign')); onClose(); navigate(`/hr/contracts/${id}`)
          }}><PenLine /> {t('Write the annex')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ ending: why, notice, last day */
function EndDialog({ contract: c, country, onClose, onPrint }: { contract: ContractFull; country: Country; onClose: () => void; onPrint: (f: Partial<ContractFull>) => void }) {
  const end = useEndContract()
  const [reason, setReason] = React.useState<string>(c.end_date && c.end_date <= addDays(todayISO(), 30) ? 'expired' : 'resigned')
  const [notice, setNotice] = React.useState(todayISO())
  const hired = c.employee?.hire_date ?? c.start_date
  const pe = probationEnd(c)
  const onProbation = !!pe && notice <= pe
  const legal = reason === 'probation' || onProbation ? LAW[country].probationNoticeDays : c.notice_days ?? legalNoticeDays(country, hired, notice, { byEmployee: reason === 'resigned', fixed: !!c.end_date })
  const needsNotice = ['resigned', 'dismissed', 'probation'].includes(reason)
  const [last, setLast] = React.useState(reason === 'expired' && c.end_date ? c.end_date : addDays(todayISO(), legal))
  React.useEffect(() => { if (reason === 'expired' && c.end_date) setLast(c.end_date); else if (needsNotice) setLast(addDays(notice, legal)) }, [reason, notice, legal, needsNotice, c.end_date])
  const [note, setNote] = React.useState('')
  const [leaves, setLeaves] = React.useState(true)
  const short = needsNotice && daysBetween(notice, last) < legal
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('End the contract')}</DialogTitle>
          <DialogDescription>{t('Payroll pays up to the last day. The notice can be printed for the employee to sign.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>{t('Why')}</Label>
            <Select value={reason} onValueChange={setReason}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{END_REASONS.map((r) => <SelectItem key={r} value={r}>{t(REASON_LABEL[r])}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="en-notice">{t('Notice given on')}</Label><Input id="en-notice" type="date" value={notice} onChange={(e) => setNotice(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="en-last">{t('Last working day')}</Label><Input id="en-last" type="date" min={c.start_date} value={last} onChange={(e) => setLast(e.target.value)} /></div>
          </div>
          {needsNotice && <p className={cn('text-xs', short ? 'text-warning' : 'text-muted-foreground')}>
            {short ? t('Shorter than the notice of {n} days; the days missing are usually paid.', { n: legal }) : t('Notice: {n} days ({why}).', { n: legal, why: onProbation || reason === 'probation' ? t('on probation') : c.notice_days != null ? t('from the contract') : t('by law, by length of service') })}</p>}
          <div className="grid gap-1.5"><Label htmlFor="en-note">{t('Note')}</Label><Textarea id="en-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. The reason given in the dismissal decision')} /></div>
          <div className="flex items-center gap-2"><Switch id="en-leaves" checked={leaves} onCheckedChange={setLeaves} /><Label htmlFor="en-leaves" className="font-normal">{t('The person leaves the company on the last day')}</Label></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="destructive" loading={end.isPending} disabled={!last || last < c.start_date || notice > last} onClick={async () => {
            await end.mutateAsync({ id: c.id, last_day: last, reason, notice_given_on: notice, note: note.trim() || null, end_employment: leaves })
            toast.success(t('Contract ended'), reason !== 'expired' ? { action: { label: t('Print the notice'), onClick: () => onPrint({ status: 'ended', end_date: last, ended_reason: reason, notice_given_on: notice, ended_note: note.trim() || null }) } } : undefined)
            onClose()
          }}><UserX /> {t('End the contract')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ a draft's terms */
function TermsDialog({ contract: c, country, onClose }: { contract: ContractFull; country: Country; onClose: () => void }) {
  const update = useUpdateContract()
  const law = LAW[country]
  const [v, setV] = React.useState({
    contract_type: c.contract_type, start_date: c.start_date, end_date: c.end_date ?? '', gross_salary: String(c.gross_salary), working_hours_per_week: String(c.working_hours_per_week),
    job_title: c.job_title ?? '', job_description: c.job_description ?? '', workplace: c.workplace ?? '', work_schedule: c.work_schedule ?? '',
    probation_months: String(c.probation_months), annual_leave_days: c.annual_leave_days != null ? String(c.annual_leave_days) : '', notice_days: c.notice_days != null ? String(c.notice_days) : '',
    pay_day: c.pay_day != null ? String(c.pay_day) : '', is_primary_employer: c.is_primary_employer,
  })
  const set = <K extends keyof typeof v>(k: K) => (x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  const fixed = v.contract_type === 'fixed_term' || v.contract_type === 'seasonal'
  const valid = v.start_date && (!fixed || v.end_date) && (!v.end_date || v.end_date >= v.start_date) && num(v.probation_months) <= law.probationMax
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{t('Terms of the contract')}</DialogTitle><DialogDescription>{t('The text shows the new terms straight away.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label>{t('Type')}</Label>
            <Select value={v.contract_type} onValueChange={set('contract_type')}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="tm-job">{t('Position')}</Label><Input id="tm-job" value={v.job_title} onChange={(e) => set('job_title')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="tm-from">{t('Starts on')}</Label><Input id="tm-from" type="date" value={v.start_date} onChange={(e) => set('start_date')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="tm-to">{t('Ends on')}</Label><Input id="tm-to" type="date" value={v.end_date} onChange={(e) => set('end_date')(e.target.value)} /></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="tm-desc">{t('What the job is')}</Label><Textarea id="tm-desc" rows={2} value={v.job_description} onChange={(e) => set('job_description')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="tm-place">{t('Place of work')}</Label><Input id="tm-place" value={v.workplace} onChange={(e) => set('workplace')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="tm-sched">{t('Working hours')}</Label><Input id="tm-sched" value={v.work_schedule} onChange={(e) => set('work_schedule')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="tm-gross">{t('Gross per month')}</Label><Input id="tm-gross" type="number" step="any" className="text-right tabular" value={v.gross_salary} onChange={(e) => set('gross_salary')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="tm-h">{t('Hours per week')}</Label><Input id="tm-h" type="number" step="any" className="text-right tabular" value={v.working_hours_per_week} onChange={(e) => set('working_hours_per_week')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="tm-prob">{t('Probation (months)')}</Label><Input id="tm-prob" type="number" min={0} max={law.probationMax} className="text-right tabular" value={v.probation_months} onChange={(e) => set('probation_months')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="tm-leave">{t('Annual leave (working days)')}</Label><Input id="tm-leave" type="number" min={0} className="text-right tabular" value={v.annual_leave_days} onChange={(e) => set('annual_leave_days')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="tm-notice">{t('Notice (days)')}</Label><Input id="tm-notice" type="number" min={0} className="text-right tabular" value={v.notice_days} onChange={(e) => set('notice_days')(e.target.value)} placeholder={t('By law')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="tm-pay">{t('Paid by day of the next month')}</Label><Input id="tm-pay" type="number" min={1} max={31} className="text-right tabular" value={v.pay_day} onChange={(e) => set('pay_day')(e.target.value)} /></div>
          {country === 'XK' && <div className="flex items-center justify-between gap-2 pt-6"><Label htmlFor="tm-prim">{t('Main employer')}</Label><Switch id="tm-prim" checked={v.is_primary_employer} onCheckedChange={set('is_primary_employer')} /></div>}
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={update.isPending} disabled={!valid} onClick={async () => {
            await update.mutateAsync({ id: c.id, contract_type: v.contract_type, start_date: v.start_date, end_date: v.end_date || null, gross_salary: num(v.gross_salary),
              working_hours_per_week: num(v.working_hours_per_week), job_title: v.job_title.trim() || null, job_description: v.job_description.trim() || null,
              workplace: v.workplace.trim() || null, work_schedule: v.work_schedule.trim() || null, probation_months: num(v.probation_months),
              annual_leave_days: v.annual_leave_days === '' ? null : num(v.annual_leave_days), notice_days: v.notice_days === '' ? null : num(v.notice_days),
              pay_day: v.pay_day === '' ? null : num(v.pay_day), is_primary_employer: v.is_primary_employer })
            toast.success(t('Saved')); onClose()
          }}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
