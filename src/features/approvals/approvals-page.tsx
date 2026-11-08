import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageTableExport } from '@/components/page-table-export'
import { Check, X } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, humanize } from '@/lib/utils'
import { t, td } from '@/i18n'

const DOC_HREF: Record<string, string> = {
  stock_adjustment: '/inventory/adjustments/',
  purchase_order: '/procurement/orders/',
  purchase_requisition: '/procurement/requisitions/',
  sales_order: '/sales/orders/',
  vendor_payment: '/finance/payments/',
  customer_payment: '/finance/payments/',
  stock_transfer: '/inventory/transfers/',
  transfer_difference: '/inventory/transfers/',
  sales_invoice: '/sales/invoices/',
  vendor_bill: '/procurement/bills/',
  leave_request: '/hr/leave?open=',
}

type Request = {
  id: string; doc_type: string; document_id: string; document_number: string | null; amount: number | null; status: string
  current_step: number; requested_by: string | null; requested_at: string; decided_at: string | null
  workflow: { name: string; steps: { step_order: number; name: string; approver_role_id: string | null; approver_user_id: string | null }[] } | null
}

export function ApprovalsPage() {
  const { companyId, company } = useCompany()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = React.useState<'pending' | 'decided'>('pending')
  const [deciding, setDeciding] = React.useState<{ req: Request; decision: 'approved' | 'rejected' } | null>(null)
  const [comment, setComment] = React.useState('')
  const key = ['approvals', companyId, tab]
  useRealtimeInvalidate('approval_requests', companyId, [['approvals', companyId]])

  const requests = useQuery({
    queryKey: key,
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('approval_requests')
        .select('id, doc_type, document_id, document_number, amount, status, current_step, requested_by, requested_at, decided_at, workflow:approval_workflows(name, steps:approval_workflow_steps(step_order, name, approver_role_id, approver_user_id))')
        .eq('company_id', companyId).order('requested_at', { ascending: false }).limit(200)
      q = tab === 'pending' ? q.eq('status', 'pending') : q.neq('status', 'pending')
      return unwrap(await q) as unknown as Request[]
    },
  })
  const roles = useQuery({
    queryKey: ['roles'], staleTime: Infinity,
    queryFn: async () => unwrap(await supabase.from('roles').select('id, key, name')),
  })
  const roleById = new Map((roles.data ?? []).map((r) => [r.id, r]))

  // optimistic: the request leaves the "waiting" list at once and comes back if the decision fails
  const decide = useMutation({
    mutationFn: async ({ id, decision, note }: { id: string; decision: string; note: string }) =>
      unwrap(await supabase.rpc('decide_approval', { p_request_id: id, p_decision: decision, p_comment: note || undefined })),
    onMutate: async ({ id }) => {
      setDeciding(null); setComment('')
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<Request[]>(key)
      qc.setQueryData<Request[]>(key, (rows) => rows?.filter((r) => r.id !== id))
      return { previous }
    },
    onSuccess: (result, v) => {
      toast.success(result === 'pending' ? t('Recorded. The next approver has been notified.') : v.decision === 'approved' ? t('Approved') : t('Rejected'))
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
      toast.error(describeError(e))
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['approvals', companyId] })
      for (const k of ['inv', 'proc', 'sales', 'fin']) void qc.invalidateQueries({ queryKey: [k, companyId] })
    },
  })

  const canDecide = (r: Request) => {
    if (r.requested_by === user?.id) return false
    const step = r.workflow?.steps.find((s) => s.step_order === r.current_step)
    if (!step) return false
    if (step.approver_user_id === user?.id) return true
    const roleKey = step.approver_role_id ? roleById.get(step.approver_role_id)?.key : undefined
    return !!company && (company.roles.includes('company_admin') || (!!roleKey && company.roles.includes(roleKey)))
  }

  return (
    <>
      <PageHeader actions={<PageTableExport />} title={t('Approvals|menu')} description={t("Documents waiting for your decision. You can't approve your own requests.")} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mb-4">
        <TabsList><TabsTrigger value="pending">{t('Waiting')}</TabsTrigger><TabsTrigger value="decided">{t('Decided')}</TabsTrigger></TabsList>
      </Tabs>
      <div className="overflow-hidden rounded-lg border bg-card">
        {requests.isLoading ? <div className="grid gap-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
          : requests.isError ? <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
          : !requests.data?.length ? <EmptyState title={tab === 'pending' ? t('Nothing waiting for approval') : t('No decisions yet')} description={t('Which documents need approval is set in Settings → Approval workflows.')}
              action={<Button variant="outline" size="sm" asChild><Link to="/settings/workflows">{t('Open approval workflows')}</Link></Button>} />
          : (
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead>{t('Document')}</TableHead><TableHead>{t('Workflow')}</TableHead><TableHead>{t('Step')}</TableHead><TableHead className="text-right">{t('Amount')}</TableHead><TableHead>{t('Requested')}</TableHead><TableHead>{t('Status')}</TableHead><TableHead className="w-48" />
              </TableRow></TableHeader>
              <TableBody>
                {requests.data.map((r) => {
                  const step = r.workflow?.steps.find((s) => s.step_order === r.current_step)
                  const href = DOC_HREF[r.doc_type]
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        {href ? <Link to={href + r.document_id} className="font-medium hover:underline">{r.document_number}</Link> : <span className="font-medium">{r.document_number}</span>}
                        <div className="text-xs text-muted-foreground">{humanize(r.doc_type)}</div>
                      </TableCell>
                      <TableCell className="text-[13px]">{r.workflow?.name}</TableCell>
                      <TableCell className="text-[13px]">{step?.name ?? '—'}{step?.approver_role_id && <div className="text-xs text-muted-foreground">{td(roleById.get(step.approver_role_id)?.name)}</div>}</TableCell>
                      <TableCell className="text-right tabular">{formatMoney(r.amount, company?.base_currency)}
                        {/* an order's amount is its total with VAT */}
                        {(r.doc_type === 'sales_order' || r.doc_type === 'purchase_order') && <span className="block text-2xs text-muted-foreground">{t('with VAT')}</span>}</TableCell>
                      <TableCell className="text-[13px]">{formatDate(r.requested_at, true)}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-right">
                        {r.status === 'pending' && canDecide(r) && (
                          <div className="flex justify-end gap-1.5">
                            <Button size="xs" variant="outline" onClick={() => setDeciding({ req: r, decision: 'rejected' })}><X /> {t('Reject')}</Button>
                            <Button size="xs" loading={decide.isPending && decide.variables?.id === r.id} onClick={() => decide.mutate({ id: r.id, decision: 'approved', note: '' })}><Check /> {t('Approve')}</Button>
                          </div>
                        )}
                        {r.status === 'pending' && r.requested_by === user?.id && <span className="text-xs text-muted-foreground">{t('Your request')}</span>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
      </div>
      <Dialog open={!!deciding} onOpenChange={(o) => !o && setDeciding(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{deciding?.decision === 'approved' ? t('Approve {doc}', { doc: deciding?.req.document_number ?? '' }) : t('Reject {doc}', { doc: deciding?.req.document_number ?? '' })}</DialogTitle></DialogHeader>
          <Textarea rows={3} placeholder={deciding?.decision === 'rejected' ? t('Tell the requester what to change') : t('Note (optional)')} value={comment} onChange={(e) => setComment(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>{t('Cancel')}</Button>
            <Button variant={deciding?.decision === 'rejected' ? 'destructive' : 'default'} loading={decide.isPending}
              disabled={deciding?.decision === 'rejected' && !comment.trim()}
              onClick={() => deciding && decide.mutate({ id: deciding.req.id, decision: deciding.decision, note: comment.trim() })}>
              {deciding?.decision === 'approved' ? t('Approve') : t('Reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
