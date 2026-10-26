import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, MinusCircle, Pencil, Plus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { SearchSelect } from '@/components/search-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { msg, t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { useBankAccounts } from '@/features/finance/api'
import { usePartners } from '@/features/sales/api'

type Ded = { id: string; kind: string; name: string; amount: number | null; percent: number | null; total: number | null; starts_on: string; ends_on: string | null
  is_active: boolean; notes: string | null; partner_id: string | null; partner: string | null; taken: number }
const KINDS: Record<string, string> = {
  advance: msg('Salary advance'), loan: msg('Loan'), garnishment: msg('Court order'), union: msg('Union fee'), other: msg('Other'),
}

/** Employee › Deductions: what is kept back from the net pay each month, and salary advances. */
export function DeductionsCard({ employeeId }: { employeeId: string }) {
  const { companyId, can, company } = useCompany()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['deductions', employeeId], queryFn: async () => (unwrap(await supabase.rpc('employee_deductions_list', { p_employee: employeeId })) ?? []) as unknown as Ded[] })
  const [edit, setEdit] = React.useState<Partial<Ded> & { mode?: 'amount' | 'percent' } | null>(null)
  const [adv, setAdv] = React.useState(false)
  const editable = can('payroll.write')
  const cur = company?.base_currency
  const refresh = () => qc.invalidateQueries({ queryKey: ['deductions', employeeId] })
  const save = useMutation({
    mutationFn: async (d: NonNullable<typeof edit>) => {
      const row = { kind: d.kind ?? 'other', name: (d.name ?? '').trim(), amount: d.mode === 'percent' ? null : num(d.amount), percent: d.mode === 'percent' ? num(d.percent) : null,
        total: d.total ? num(d.total) : null, starts_on: d.starts_on ?? todayISO(), ends_on: d.ends_on || null, partner_id: d.partner_id ?? null, is_active: d.is_active ?? true, notes: d.notes || null }
      if (d.id) unwrap(await supabase.from('employee_deductions').update(row).eq('id', d.id))
      else unwrap(await supabase.from('employee_deductions').insert({ ...row, company_id: companyId!, employee_id: employeeId }))
    },
    onSuccess: async () => { await refresh(); setEdit(null); toast.success(t('Saved')) },
    onError: (e) => toast.error(describeError(e)),
  })
  const toggle = useMutation({
    mutationFn: async (a: { id: string; on: boolean }) => unwrap(await supabase.from('employee_deductions').update({ is_active: a.on }).eq('id', a.id)),
    onSuccess: () => void refresh(), onError: (e) => toast.error(describeError(e)),
  })
  const rows = q.data ?? []

  return (
    <div className="grid gap-3">
      <p className="max-w-2xl text-[13px] text-muted-foreground">{t('Kept back from the net pay every month until the total is reached: salary advances, loans, court orders, union fees. They show on the payslip.')}</p>
      {editable && <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setEdit({ kind: 'loan', mode: 'amount', starts_on: todayISO(), is_active: true })}><Plus /> {t('Add a deduction')}</Button>
        {can('finance.write') && <Button size="sm" variant="outline" onClick={() => setAdv(true)}><Banknote /> {t('Pay a salary advance')}</Button>}
      </div>}
      {rows.length === 0 ? <EmptyState compact icon={MinusCircle} title={t('Nothing is deducted from this pay')} /> : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>{t('Deduction')}</TableHead><TableHead className="text-right">{t('Each month')}</TableHead><TableHead className="text-right">{t('Taken / total')}</TableHead>
              <TableHead>{t('From')}</TableHead><TableHead className="w-28">{t('Active')}</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {rows.map((d) => (
                <TableRow key={d.id} className={d.is_active ? '' : 'text-muted-foreground'}>
                  <TableCell><div className="font-medium">{d.name}</div><div className="text-xs text-muted-foreground">{t(KINDS[d.kind] ?? d.kind)}{d.partner ? ` · ${d.partner}` : ''}</div></TableCell>
                  <TableCell className="text-right tabular-nums">{d.percent != null ? `${num(d.percent)} %` : formatMoney(d.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(d.taken)}{d.total != null && <> / {formatMoney(d.total)}</>}
                    {d.total != null && num(d.taken) >= num(d.total) && <Badge variant="success" className="ml-2">{t('paid back')}</Badge>}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(d.starts_on)}{d.ends_on && ` – ${formatDate(d.ends_on)}`}</TableCell>
                  <TableCell><Switch checked={d.is_active} disabled={!editable} onCheckedChange={(on) => toggle.mutate({ id: d.id, on })} aria-label={t('{name} active', { name: d.name })} /></TableCell>
                  <TableCell>{editable && <Button variant="ghost" size="icon-sm" aria-label={t('Edit {name}', { name: d.name })} onClick={() => setEdit({ ...d, mode: d.percent != null ? 'percent' : 'amount' })}><Pencil /></Button>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {edit && <EditDialog value={edit} onChange={setEdit} onSave={() => save.mutate(edit)} saving={save.isPending} cur={cur} />}
      {adv && <AdvanceDialog employeeId={employeeId} onClose={() => { setAdv(false); void refresh() }} />}
    </div>
  )
}

function EditDialog({ value: d, onChange, onSave, saving, cur }: { value: Partial<Ded> & { mode?: 'amount' | 'percent' }; onChange: (d: Partial<Ded> & { mode?: 'amount' | 'percent' }) => void; onSave: () => void; saving: boolean; cur?: string }) {
  const partners = usePartners()
  const ok = !!d.name?.trim() && (d.mode === 'percent' ? num(d.percent) > 0 && num(d.percent) <= 100 : num(d.amount) > 0)
  return (
    <Dialog open onOpenChange={(o) => !o && onChange(null as never)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{d.id ? t('Edit the deduction') : t('Add a deduction')}</DialogTitle>
          <DialogDescription>{t('Taken from the net pay of each payroll from the start date, never more than the net or what is left of the total.')}</DialogDescription></DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (ok) onSave() }}>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label>{t('Kind|withholding')}</Label>
              <Select value={d.kind ?? 'other'} onValueChange={(v) => onChange({ ...d, kind: v })}>
                <SelectTrigger aria-label={t('Kind|withholding')}><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{t(v)}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="grid gap-1.5"><Label htmlFor="dd-name">{t('Name')}</Label><Input id="dd-name" value={d.name ?? ''} onChange={(e) => onChange({ ...d, name: e.target.value })} placeholder={t('e.g. Bank loan')} /></div>
          </div>
          <div className="inline-flex w-fit rounded-lg bg-muted p-1 text-sm">
            {(['amount', 'percent'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={d.mode === m} onClick={() => onChange({ ...d, mode: m })}
                className={`rounded-md px-3 py-1.5 font-medium ${d.mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}>{m === 'amount' ? t('An amount') : t('A share of the net')}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {d.mode === 'percent'
              ? <div className="grid gap-1.5"><Label htmlFor="dd-pct">{t('% of the net')}</Label><Input id="dd-pct" type="number" step="any" className="text-right" value={d.percent ?? ''} onChange={(e) => onChange({ ...d, percent: e.target.value as never })} /></div>
              : <div className="grid gap-1.5"><Label htmlFor="dd-amt">{t('Each month ({cur})', { cur: cur ?? '' })}</Label><Input id="dd-amt" type="number" step="any" className="text-right" value={d.amount ?? ''} onChange={(e) => onChange({ ...d, amount: e.target.value as never })} /></div>}
            <div className="grid gap-1.5"><Label htmlFor="dd-total">{t('Total (optional)')}</Label><Input id="dd-total" type="number" step="any" className="text-right" value={d.total ?? ''} onChange={(e) => onChange({ ...d, total: e.target.value as never })} placeholder={t('no end')} /></div>
            <div className="grid gap-1.5"><Label htmlFor="dd-from">{t('From')}</Label><Input id="dd-from" type="date" value={d.starts_on ?? ''} onChange={(e) => onChange({ ...d, starts_on: e.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="dd-to">{t('Until (optional)')}</Label><Input id="dd-to" type="date" value={d.ends_on ?? ''} onChange={(e) => onChange({ ...d, ends_on: e.target.value })} /></div>
          </div>
          {d.kind !== 'advance' && d.kind !== 'loan' && (
            <div className="grid gap-1.5"><Label>{t('Paid to (optional)')}</Label>
              <SearchSelect value={d.partner_id ?? null} clearable onChange={(v) => onChange({ ...d, partner_id: v })} placeholder={t('The court, union or bank it goes to')}
                options={(partners.data ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.code ?? undefined }))} /></div>
          )}
          <DialogFooter><Button type="submit" disabled={!ok} loading={saving}>{t('Save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AdvanceDialog({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const banks = useBankAccounts()
  const { company } = useCompany()
  const [amount, setAmount] = React.useState('')
  const [months, setMonths] = React.useState('1')
  const [bank, setBank] = React.useState<string>('')
  const [date, setDate] = React.useState(todayISO())
  const pay = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('employee_advance_pay', { p: { employee_id: employeeId, amount: num(amount), months: num(months), bank_account_id: bank, date } })),
    onSuccess: () => { toast.success(t('Advance paid; it is taken back from the next salaries')); onClose() },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Pay a salary advance')}</DialogTitle>
          <DialogDescription>{t('Paid now from the cash box or the bank, and taken back from the next salaries in equal parts.')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5"><Label htmlFor="ad-amt">{t('Amount ({cur})', { cur: company?.base_currency ?? '' })}</Label><Input id="ad-amt" type="number" step="any" className="text-right" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="ad-m">{t('Taken back in (months)')}</Label><Input id="ad-m" type="number" min="1" max="24" className="text-right" value={months} onChange={(e) => setMonths(e.target.value)} /></div>
          </div>
          <div className="grid gap-1.5"><Label>{t('Paid from')}</Label>
            <Select value={bank} onValueChange={setBank}><SelectTrigger aria-label={t('Paid from')}><SelectValue placeholder={t('Choose')} /></SelectTrigger>
              <SelectContent>{(banks.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="ad-date">{t('Date')}</Label><Input id="ad-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
          {num(amount) > 0 && num(months) > 0 && <p className="text-xs text-muted-foreground">{t('{amount} a month from the next salaries', { amount: formatMoney(num(amount) / num(months)) })}</p>}
        </div>
        <DialogFooter><Button disabled={!(num(amount) > 0) || !bank} loading={pay.isPending} onClick={() => pay.mutate()}>{t('Pay the advance')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
