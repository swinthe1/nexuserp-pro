import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, PackagePlus, X } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { t, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney } from '@/lib/utils'

type Req = {
  id: string; name: string; barcode: string | null; code: string | null; vat_rate: number | null; cost: number | null; status: 'pending' | 'made' | 'refused'
  variant_id: string | null; reason: string | null; requested_by: string | null; created_at: string; decided_at: string | null
  vendor: { name: string } | null
  variant: { product_id: string } | null
}

export function usePendingItemRequests() {
  const { companyId, can } = useCompany()
  return useQuery({
    queryKey: ['item-requests', companyId, 'pending-count'], enabled: !!companyId && can('inventory.approve'), staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase.from('item_requests').select('id', { count: 'exact', head: true }).eq('company_id', companyId!).eq('status', 'pending')
      if (error) throw error
      return count ?? 0
    },
  })
}

/** New items asked for from supplier invoices, made or refused by someone who approves items. */
export function ItemRequestsPage() {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const [tab, setTab] = React.useState<'pending' | 'done'>('pending')
  const [refusing, setRefusing] = React.useState<Req | null>(null)
  const [reason, setReason] = React.useState('')
  const list = useQuery({
    queryKey: ['item-requests', companyId, tab], enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('item_requests').select('id, name, barcode, code, vat_rate, cost, status, variant_id, reason, requested_by, created_at, decided_at, vendor:business_partners(name), variant:product_variants(product_id)')
        .eq('company_id', companyId!).order('created_at', { ascending: false }).limit(200)
      q = tab === 'pending' ? q.eq('status', 'pending') : q.neq('status', 'pending')
      return unwrap(await q) as unknown as Req[]
    },
  })
  const decide = useMutation({
    mutationFn: async (v: { id: string; make: boolean; reason?: string }) => unwrap(await supabase.rpc('item_request_decide', { p_id: v.id, p_make: v.make, p_reason: (v.reason ?? null) as string })),
    onSuccess: (_d, v) => {
      toast.success(v.make ? t('The item is made; the one who asked is told') : t('Refused; the one who asked is told'))
      setRefusing(null); setReason('')
      void qc.invalidateQueries({ queryKey: ['item-requests', companyId] })
    },
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  const approve = can('inventory.approve')
  return (
    <>
      <PageHeader back={{ href: '/inventory/products', label: t('Products') }} title={t('New items to approve')}
        description={t('Items that came on supplier invoices and are not in DrisPRO yet. Make them, or refuse them with a reason; the one who asked is told. After it is made, set its category and selling price on the item.')} />
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'pending' | 'done')} className="mb-3">
        <TabsList><TabsTrigger value="pending">{t('Waiting')}</TabsTrigger><TabsTrigger value="done">{t('Decided')}</TabsTrigger></TabsList>
      </Tabs>
      {list.isLoading ? <Skeleton className="h-40" /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        : !list.data?.length ? <EmptyState icon={PackagePlus} title={tab === 'pending' ? t('Nothing waiting') : t('Nothing decided yet')} />
        : <Card><CardContent className="divide-y p-0">
            {list.data.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-[12.5px] text-muted-foreground">
                    {[r.barcode && t('barcode {code}', { code: r.barcode }), r.code && t('supplier code {code}', { code: r.code }), r.vendor?.name,
                      r.cost != null && t('cost {amount}', { amount: formatMoney(r.cost) }), r.vat_rate != null && `${t('VAT')} ${r.vat_rate}%`, formatDate(r.created_at, true)].filter(Boolean).join(' · ')}
                  </p>
                  {r.status === 'refused' && r.reason && <p className="text-[12.5px] text-destructive">{t('Refused: {reason}', { reason: r.reason })}</p>}
                </div>
                {r.status === 'made' && r.variant_id && <Badge variant="success">{t('Made')}</Badge>}
                {r.status === 'refused' && <Badge variant="destructive">{t('Refused')}</Badge>}
                {r.status === 'pending' && approve && <>
                  <Button size="sm" variant="outline" onClick={() => { setRefusing(r); setReason('') }}><X /> {t('Refuse')}</Button>
                  <Button size="sm" loading={decide.isPending && decide.variables?.id === r.id && decide.variables.make} onClick={() => decide.mutate({ id: r.id, make: true })}><Check /> {t('Make the item')}</Button>
                </>}
                {r.status === 'made' && r.variant?.product_id && <Button size="sm" variant="ghost" asChild><Link to={`/inventory/products?item=${r.variant.product_id}`}>{t('Open')}</Link></Button>}
              </div>
            ))}
          </CardContent></Card>}
      <Dialog open={!!refusing} onOpenChange={(o) => !o && setRefusing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('Refuse {name}?', { name: refusing?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('The one who asked sees the reason. For example: it is already in DrisPRO under another name.')}</DialogDescription></DialogHeader>
          <Textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('Why')} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRefusing(null)}>{t('Cancel')}</Button>
            <Button variant="destructive" disabled={reason.trim().length < 3} loading={decide.isPending} onClick={() => refusing && decide.mutate({ id: refusing.id, make: false, reason })}>{t('Refuse')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
