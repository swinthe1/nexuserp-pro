import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import { ArrowRightCircle, Mail, Phone, Plus } from 'lucide-react'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { describeError } from '@/lib/errors'
import { formatDate, formatMoney, humanize } from '@/lib/utils'
import { useConvertLead, useCustomers, useLeads, useMembers, useSaveRecord, type LeadRow } from '../api'
import { leadSchema, type LeadValues } from '../schemas'
import { t } from '@/i18n'

const SOURCES = ['website', 'referral', 'walk_in', 'campaign', 'cold_call', 'social', 'event', 'other'] as const
const STATUSES = ['new', 'contacted', 'qualified', 'converted', 'lost']

export function LeadsPage() {
  const [params, setParams] = useSearchParams()
  const leads = useLeads()
  const openId = params.get('open')
  const setOpen = (id: string | null) => setParams((p) => { if (id) p.set('open', id); else p.delete('open'); return p }, { replace: true })

  const columns = React.useMemo<ColumnDef<LeadRow>[]>(() => [
    { accessorKey: 'number', header: ({ column }) => <ColumnHeader column={column} title={t('Number')} />, meta: { label: t('Number') }, cell: ({ getValue }) => <span className="text-muted-foreground">{getValue() as string}</span> },
    {
      accessorKey: 'title', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Lead|column')} />, meta: { label: t('Lead|column') },
      cell: ({ row: { original: l } }) => <div><div className="font-medium">{l.title}</div><div className="text-xs text-muted-foreground">{[l.contact_name, l.company_name].filter(Boolean).join(' · ') || l.email || l.phone}</div></div>,
    },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status'), exportValue: (l) => humanize(l.status) }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: 'source', filterFn: inFilter, header: t('Source'), meta: { label: t('Source'), exportValue: (l) => humanize(l.source) }, cell: ({ getValue }) => humanize(getValue() as string) },
    { id: 'owner', accessorFn: (l) => l.owner?.full_name ?? '', filterFn: inFilter, header: t('Owner'), meta: { label: t('Owner') }, cell: ({ getValue }) => (getValue() as string) || <span className="text-muted-foreground">{t('Unassigned')}</span> },
    { accessorKey: 'estimated_value', header: ({ column }) => <ColumnHeader column={column} title={t('Est. value')} />, meta: { label: t('Estimated value'), align: 'right' }, cell: ({ getValue }) => getValue() == null ? '—' : <span className="tabular">{formatMoney(getValue() as number)}</span> },
    { accessorKey: 'created_at', header: ({ column }) => <ColumnHeader column={column} title={t('Added')} />, meta: { label: t('Added') }, cell: ({ getValue }) => formatDate(getValue() as string) },
  ], [])
  const owners = [...new Set((leads.data ?? []).map((l) => l.owner?.full_name).filter(Boolean))] as string[]
  const newButton = <Can perm="crm.write"><Button onClick={() => setOpen('new')}><Plus /> {t('New lead')}</Button></Can>

  return (
    <>
      <PageHeader title={t('Leads')} description={t('People and companies who showed interest. Check them, then turn them into a customer and a deal in the pipeline.')} actions={newButton} />
      <DataTable
        tableKey="crm.leads" columns={columns} data={leads.data} isLoading={leads.isLoading} error={leads.error}
        getRowId={(l) => l.id} exportName="leads" searchPlaceholder={t('Name, company, email…')} initialHidden={['number']}
        onRowClick={(l) => setOpen(l.id)}
        facets={[
          { columnId: 'status', title: t('Status'), options: STATUSES.map((s) => ({ value: s, label: humanize(s) })) },
          { columnId: 'source', title: t('Source'), options: SOURCES.map((s) => ({ value: s, label: humanize(s) })) },
          { columnId: 'owner', title: t('Owner'), options: owners.map((o) => ({ value: o, label: o })) },
        ]}
        empty={{ title: t('No leads yet'), description: t('Add enquiries from the website, phone calls or walk-ins here.'), action: newButton }}
      />
      <Sheet open={!!openId && (openId === 'new' || !!leads.data?.some((l) => l.id === openId))} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="sm:max-w-lg">
          {openId && <LeadForm key={openId} lead={leads.data?.find((l) => l.id === openId)} onDone={() => setOpen(null)} />}
        </SheetContent>
      </Sheet>
    </>
  )
}

function LeadForm({ lead, onDone }: { lead?: LeadRow; onDone: () => void }) {
  const { can, company } = useCompany()
  const { user } = useAuth()
  const members = useMembers()
  const save = useSaveRecord('leads')
  const [convertOpen, setConvertOpen] = React.useState(false)
  const isOpen = !lead || ['new', 'contacted', 'qualified'].includes(lead.status)
  const writable = can('crm.write') && isOpen
  const form = useForm<LeadValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      title: lead?.title ?? '', contact_name: lead?.contact_name ?? '', company_name: lead?.company_name ?? '', email: lead?.email ?? '',
      phone: lead?.phone ?? '', source: (lead?.source as LeadValues['source']) ?? 'website', estimated_value: lead?.estimated_value ?? null,
      owner_id: lead?.owner_id ?? user?.id ?? null, notes: lead?.notes ?? '',
    },
  })
  const submit = form.handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        id: lead?.id, ...v, email: v.email || null, phone: v.phone || null, contact_name: v.contact_name || null, company_name: v.company_name || null,
        owner_id: v.owner_id ?? null, notes: v.notes || null, ...(lead ? {} : { currency_code: company?.base_currency }),
      })
      toast.success(lead ? t('Lead updated') : t('Lead added'))
      onDone()
    } catch (e) { toast.error(describeError(e)) }
  })
  const setStatus = async (status: string, extra: Record<string, unknown> = {}) => {
    try { await save.mutateAsync({ id: lead!.id, status, ...extra }); toast.success(t('Marked as {status}', { status: humanize(status).toLowerCase() })) } catch (e) { toast.error(describeError(e)) }
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{lead ? lead.title : t('New lead')}</SheetTitle>
        {lead && <SheetDescription className="flex items-center gap-2">{lead.number} <StatusBadge status={lead.status} /> {lead.lost_reason && `· ${lead.lost_reason}`}</SheetDescription>}
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {lead && (lead.email || lead.phone) && (
          <div className="mb-4 flex flex-wrap gap-2">
            {lead.email && <Button size="sm" variant="outline" asChild><a href={`mailto:${lead.email}`}><Mail /> {lead.email}</a></Button>}
            {lead.phone && <Button size="sm" variant="outline" asChild><a href={`tel:${lead.phone}`}><Phone /> {lead.phone}</a></Button>}
          </div>
        )}
        <Form {...form}>
          <form id="lead-form" onSubmit={submit} className="grid gap-4">
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem><FormLabel>{t("What they're interested in")}</FormLabel><FormControl><Input placeholder={t('Wholesale coffee supply for a hotel')} disabled={!writable} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="contact_name" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Contact person')}</FormLabel><FormControl><Input disabled={!writable} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="company_name" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Company')}</FormLabel><FormControl><Input disabled={!writable} {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Email')}</FormLabel><FormControl><Input type="email" disabled={!writable} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Phone')}</FormLabel><FormControl><Input type="tel" placeholder="+355 6…" disabled={!writable} {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="source" render={({ field }) => (
                <FormItem><FormLabel>{t('Source')}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={!writable}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{SOURCES.map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent>
                  </Select></FormItem>
              )} />
              <FormField control={form.control} name="estimated_value" render={({ field }) => (
                <FormItem><FormLabel optional>{t('Estimated value')}</FormLabel><FormControl><Input type="number" step="any" className="tabular" disabled={!writable} {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="owner_id" render={({ field }) => (
                <FormItem className="col-span-2"><FormLabel optional>{t('Owner')}</FormLabel>
                  <Select value={field.value ?? ''} onValueChange={field.onChange} disabled={!writable}>
                    <FormControl><SelectTrigger><SelectValue placeholder={t('Unassigned')} /></SelectTrigger></FormControl>
                    <SelectContent>{(members.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name ?? m.email}</SelectItem>)}</SelectContent>
                  </Select></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel optional>{t('Notes')}</FormLabel><FormControl><Textarea rows={3} disabled={!writable} {...field} /></FormControl></FormItem>
            )} />
          </form>
        </Form>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
        <div className="flex flex-wrap gap-1.5">
          {lead && can('crm.write') && lead.status === 'new' && <Button size="sm" variant="ghost" onClick={() => setStatus('contacted')}>{t('Contacted')}</Button>}
          {lead && can('crm.write') && ['new', 'contacted'].includes(lead.status) && <Button size="sm" variant="ghost" onClick={() => setStatus('qualified')}>{t('Qualified|lead')}</Button>}
          {lead && can('crm.write') && isOpen && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setStatus('lost', { lost_reason: t('Not interested') })}>{t('Not interested')}</Button>}
          {lead?.status === 'lost' && can('crm.write') && <Button size="sm" variant="outline" onClick={() => setStatus('new', { lost_reason: null })}>{t('Reopen')}</Button>}
        </div>
        <div className="flex gap-2">
          {lead && isOpen && can('crm.write') && <Button variant="outline" onClick={() => setConvertOpen(true)}><ArrowRightCircle /> {t('Convert')}</Button>}
          {writable && <Button type="submit" form="lead-form" loading={save.isPending}>{lead ? t('Save') : t('Add lead')}</Button>}
        </div>
      </div>
      {lead && <ConvertDialog lead={lead} open={convertOpen} onOpenChange={setConvertOpen} />}
    </>
  )
}

function ConvertDialog({ lead, open, onOpenChange }: { lead: LeadRow; open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const { can } = useCompany()
  const customers = useCustomers()
  const convert = useConvertLead()
  const match = React.useMemo(() => customers.data?.find((c) =>
    (lead.email && c.email?.toLowerCase() === lead.email.toLowerCase()) || (lead.company_name && c.name.toLowerCase() === lead.company_name.toLowerCase())), [customers.data, lead])
  const [mode, setMode] = React.useState<'new' | 'existing'>('new')
  const [partnerId, setPartnerId] = React.useState<string | null>(null)
  const [name, setName] = React.useState(lead.title)
  const [value, setValue] = React.useState(lead.estimated_value?.toString() ?? '')
  React.useEffect(() => { if (open && match) { setMode('existing'); setPartnerId(match.id) } }, [open, match])
  const canCreate = can('partners.write')

  const run = async () => {
    try {
      const r = await convert.mutateAsync({ leadId: lead.id, partnerId: mode === 'existing' ? partnerId : null, name, value: value === '' ? null : Number(value) })
      toast.success(t('Lead converted'), { description: t('The customer and the deal are ready.') })
      onOpenChange(false)
      navigate(`/crm/pipeline?open=${r.opportunity_id}`)
    } catch (e) { toast.error(describeError(e)) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Convert lead')}</DialogTitle>
          <DialogDescription>{t('Creates a deal in the first stage of the pipeline, linked to a customer.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">{t('Customer')}</legend>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="radio" name="mode" className="mt-0.5 accent-[hsl(var(--primary))]" checked={mode === 'new'} disabled={!canCreate} onChange={() => setMode('new')} />
              <span>{t('Create a new customer')} <span className="block text-muted-foreground">{lead.company_name || lead.contact_name || lead.title}{lead.email && `, ${lead.email}`}</span></span>
            </label>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="radio" name="mode" className="mt-0.5 accent-[hsl(var(--primary))]" checked={mode === 'existing'} onChange={() => setMode('existing')} />
              <span>{t('Link to an existing customer')}{match && <span className="block text-muted-foreground">{t('Looks like {name} is already a customer.', { name: match.name })}</span>}</span>
            </label>
            {mode === 'existing' && <SearchSelect value={partnerId} onChange={setPartnerId} placeholder={t('Choose a customer')} options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code }))} />}
          </fieldset>
          <div className="grid gap-1.5"><Label htmlFor="cv-name">{t('Deal name')}</Label><Input id="cv-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="cv-val">{t('Expected value')}</Label><Input id="cv-val" type="number" step="any" className="tabular" value={value} onChange={(e) => setValue(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button onClick={run} loading={convert.isPending} disabled={!name.trim() || (mode === 'existing' && !partnerId)}>{t('Convert')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
