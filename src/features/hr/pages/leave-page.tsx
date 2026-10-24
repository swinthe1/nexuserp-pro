import type { ColumnDef } from '@tanstack/react-table'
import { Check, Plus, Send, X } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState } from '@/components/error-state'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { t, td, tServer } from '@/i18n'
import { cn, formatDate, formatQty, humanize, num } from '@/lib/utils'
import { useCancelLeave, useDecideLeave, useLeaveBalances, useLeaveRequests, useLeaveTypes, useSubmitLeave, type LeaveRow } from '../api'
import { NewLeaveDialog } from '../components/leave-dialog'

export function LeavePage() {
  const [params, setParams] = useSearchParams()
  const leave = useLeaveRequests()
  const types = useLeaveTypes()
  const [newOpen, setNewOpen] = React.useState(false)
  const openId = params.get('id')
  const current = leave.data?.find((l) => l.id === openId)
  const statusFilter = params.get('status')
  const { companyId } = useCompany()
  useRealtimeInvalidate('leave_requests', companyId, [['hr', companyId, 'leave'], ['hr', companyId, 'balances'], ['hr', companyId, 'overview']])
  const cols = React.useMemo<ColumnDef<LeaveRow>[]>(() => [
    { accessorKey: 'number', header: ({ column }) => <ColumnHeader column={column} title={t('Request')} />, meta: { label: t('Request') }, cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { id: 'employee', accessorFn: (l) => l.employee?.full_name ?? '', header: ({ column }) => <ColumnHeader column={column} title={t('Employee')} />, meta: { label: t('Employee') } },
    { id: 'type', accessorFn: (l) => l.type?.name ?? '', filterFn: inFilter, header: t('Type'), meta: { label: t('Type') }, cell: ({ getValue }) => td(getValue() as string) },
    { accessorKey: 'start_date', header: ({ column }) => <ColumnHeader column={column} title={t('From')} />, meta: { label: t('From') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'end_date', header: t('To'), meta: { label: t('To') }, cell: ({ getValue }) => formatDate(getValue() as string) },
    { accessorKey: 'days', header: t('Days'), meta: { label: t('Days'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatQty(getValue() as number)}</span> },
    { accessorKey: 'status', filterFn: inFilter, header: t('Status'), meta: { label: t('Status') }, cell: ({ getValue }) => <StatusBadge status={getValue() as string} /> },
    { accessorKey: 'reason', header: t('Reason'), meta: { label: t('Reason') }, cell: ({ getValue }) => <span className="line-clamp-1 max-w-[240px] text-muted-foreground">{(getValue() as string) ?? ''}</span> },
  ], [])
  return (
    <>
      <PageHeader title={t('Leave')} description={t('Requests, decisions and what everyone has left this year.')}
        actions={<Can perm="hr.write"><Button onClick={() => setNewOpen(true)}><Plus /> {t('Ask for leave')}</Button></Can>} />
      <Tabs defaultValue="requests">
        <TabsList><TabsTrigger value="requests">{t('Requests')}</TabsTrigger><TabsTrigger value="balances">{t('Days left')}</TabsTrigger></TabsList>
        <TabsContent value="requests">
          <DataTable key={statusFilter ?? 'all'} tableKey="hr.leave" columns={cols} data={leave.data} isLoading={leave.isLoading} error={leave.error} getRowId={(r) => r.id}
            exportName="leave-requests" searchPlaceholder={t('Employee, number…')} onRowClick={(r) => setParams((p) => { p.set('id', r.id); return p })}
            initialFilters={statusFilter ? [{ id: 'status', value: [statusFilter] }] : undefined}
            facets={[
              { columnId: 'status', title: t('Status'), options: ['draft', 'submitted', 'approved', 'rejected', 'cancelled'].map((s) => ({ value: s, label: humanize(s) })) },
              { columnId: 'type', title: t('Type'), options: (types.data ?? []).map((x) => ({ value: x.name, label: td(x.name) })) },
            ]}
            empty={{ title: t('No leave requests yet'), description: t('Requests from employees and HR appear here for a decision.'), action: <Can perm="hr.write"><Button size="sm" onClick={() => setNewOpen(true)}><Plus /> {t('Ask for leave')}</Button></Can> }} />
        </TabsContent>
        <TabsContent value="balances"><BalancesTable /></TabsContent>
      </Tabs>
      {newOpen && <NewLeaveDialog onClose={() => setNewOpen(false)} />}
      {current && <LeaveDialog leave={current} onClose={() => setParams((p) => { p.delete('id'); return p })} />}
    </>
  )
}

export function LeaveDialog({ leave, onClose, self }: { leave: LeaveRow; onClose: () => void; self?: boolean }) {
  const { can } = useCompany()
  const decide = useDecideLeave()
  const submit = useSubmitLeave()
  const cancel = useCancelLeave()
  const [note, setNote] = React.useState('')
  const canDecide = !self && leave.status === 'submitted' && can('hr.approve')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2">{leave.number} <StatusBadge status={leave.status} /></DialogTitle>
          <DialogDescription>{leave.employee?.full_name} · {td(leave.type?.name)}{leave.type && !leave.type.is_paid ? ` ${t('(unpaid)')}` : ''}</DialogDescription></DialogHeader>
        <div className="grid gap-2 text-[13px]">
          <div className="flex justify-between"><span className="text-muted-foreground">{t('Dates')}</span><span>{formatDate(leave.start_date)} – {formatDate(leave.end_date)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">{t('Working days')}</span><span className="tabular font-medium">{formatQty(leave.days)}</span></div>
          {leave.reason && <div><span className="text-muted-foreground">{t('Reason')}</span><p className="mt-0.5">{leave.reason}</p></div>}
          {leave.decided_at && <div className="flex justify-between"><span className="text-muted-foreground">{t('Decided|date')}</span><span>{formatDate(leave.decided_at, true)}</span></div>}
          {leave.decision_note && <div><span className="text-muted-foreground">{t('Note')}</span><p className="mt-0.5">{tServer(leave.decision_note)}</p></div>}
          {canDecide && <div className="mt-1 grid gap-1.5"><Label htmlFor="lv-note">{t('Note to the employee')} <span className="font-normal text-muted-foreground">{t('(optional)')}</span></Label>
            <Textarea id="lv-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          {['draft', 'submitted', 'approved'].includes(leave.status) && (self ? leave.status !== 'approved' : can('hr.write')) &&
            <Button variant="ghost" className="mr-auto text-destructive" loading={cancel.isPending}
              onClick={async () => { await cancel.mutateAsync(leave.id); toast.success(t('Leave cancelled')); onClose() }}><X /> {t('Cancel leave')}</Button>}
          {leave.status === 'draft' && <Button loading={submit.isPending} onClick={async () => { await submit.mutateAsync(leave.id); toast.success(t('Leave request sent')); onClose() }}><Send /> {t('Send request')}</Button>}
          {canDecide && <>
            <Button variant="outline" loading={decide.isPending} onClick={async () => { await decide.mutateAsync({ id: leave.id, approve: false, note }); toast.success(t('Leave rejected')); onClose() }}>{t('Reject')}</Button>
            <Button loading={decide.isPending} onClick={async () => { await decide.mutateAsync({ id: leave.id, approve: true, note }); toast.success(t('Leave approved')); onClose() }}><Check /> {t('Approve leave')}</Button>
          </>}
          {!canDecide && leave.status !== 'draft' && <Button variant="outline" onClick={onClose}>{t('Close')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BalancesTable() {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = React.useState(thisYear)
  const bal = useLeaveBalances(year)
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <p className="text-[13px] text-muted-foreground">{t('Leave types with yearly days, counted pro rata for people who join or leave during the year.')}</p>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}><SelectTrigger className="w-[100px]" aria-label={t('Year')}><SelectValue /></SelectTrigger>
          <SelectContent>{[thisYear + 1, thisYear, thisYear - 1].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select>
      </div>
      <CardContent className="overflow-x-auto p-0">
        <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Employee')}</TableHead><TableHead>{t('Type')}</TableHead><TableHead className="text-right">{t('Days per year')}</TableHead>
          <TableHead className="text-right">{t('Taken')}</TableHead><TableHead className="text-right">{t('Waiting')}</TableHead><TableHead className="text-right">{t('Left')}</TableHead></TableRow></TableHeader>
          <TableBody>{bal.isError && <TableRow><TableCell colSpan={6}><ErrorState compact error={bal.error} onRetry={() => void bal.refetch()} /></TableCell></TableRow>}
            {!bal.isLoading && !bal.isError && !bal.data?.length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-[13px] text-muted-foreground">{t('No leave types with yearly days. Set them in HR setup.')}</TableCell></TableRow>}
            {(bal.data ?? []).map((b) => (
            <TableRow key={`${b.employee_id}-${b.leave_type_id}`}>
              <TableCell><Link to={`/hr/employees/${b.employee_id}`} className="hover:underline">{b.employee}</Link></TableCell><TableCell>{td(b.leave_type)}</TableCell>
              <TableCell className="text-right tabular">{formatQty(b.entitlement)}</TableCell><TableCell className="text-right tabular">{formatQty(b.taken)}</TableCell>
              <TableCell className="text-right tabular text-muted-foreground">{num(b.pending) ? formatQty(b.pending) : '—'}</TableCell>
              <TableCell className={cn('text-right tabular font-medium', num(b.remaining) < 0 && 'text-destructive')}>{formatQty(b.remaining)}</TableCell></TableRow>))}
          </TableBody></Table>
      </CardContent>
    </Card>
  )
}
