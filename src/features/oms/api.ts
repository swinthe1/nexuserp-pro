import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export type QueueLine = {
  sales_order_id: string; order_number: string; order_date: string; requested_date: string | null; partner: string; line_id: string
  variant_id: string; sku: string; name: string; ordered: number; delivered: number; reserved: number; outstanding: number
  available: number; incoming: number; next_receipt: string | null; state: 'in_delivery' | 'ready' | 'can_reserve' | 'awaiting_stock' | 'short'
}

export function useFulfillmentQueue(warehouse: string | null) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['oms', companyId, 'queue', warehouse],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('fulfillment_queue', { p_company: companyId, p_warehouse: warehouse ?? undefined })) as unknown as QueueLine[],
  })
}

function useOmsAction<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['oms', companyId] }), qc.invalidateQueries({ queryKey: ['sales', companyId] })]),
    onError: (e) => toast.error(describeError(e)),
  })
}
export const useReserveOrder = () => useOmsAction(async (id: string) => unwrap(await supabase.rpc('reserve_sales_order', { p_id: id })) as number)
export const useDeliverOrder = () => useOmsAction(async (id: string) => unwrap(await supabase.rpc('create_delivery_from_order', { p_order: id })) as string)
