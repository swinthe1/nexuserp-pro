import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { t, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

/** the documents that can be copied into a new draft (their tables) */
export type DuplicableTable = 'sales_quotes' | 'sales_orders' | 'sales_invoices' | 'purchase_orders' | 'vendor_bills' | 'goods_receipts' | 'stock_transfers' | 'stock_adjustments'

/** "Dupliko": a new draft with the same partner, warehouse and lines, opened at once */
export function useDuplicate() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ table, id }: { table: DuplicableTable; id: string }) =>
      unwrap(await supabase.rpc('duplicate_document', { p_table: table, p_id: id })) as unknown as { id: string; number: string; href: string },
    onSuccess: (r) => {
      void qc.invalidateQueries()
      toast.success(t('Copy {number} made as a draft: check the dates and change what is different', { number: r.number }))
      navigate(r.href)
    },
    onError: (e) => toast.error(tServer(describeError(e))),
  })
}

export function DuplicateButton({ table, id, size = 'default', variant = 'outline' }: { table: DuplicableTable; id: string; size?: 'default' | 'sm'; variant?: 'outline' | 'ghost' }) {
  const dup = useDuplicate()
  return (
    <Button variant={variant} size={size} loading={dup.isPending} onClick={() => dup.mutate({ table, id })} title={t('A new draft with the same lines')}>
      <Copy /> {t('Duplicate')}
    </Button>
  )
}
