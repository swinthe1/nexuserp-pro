import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import type { Json, Tables } from '@/lib/database.types'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export const ecoKeys = { all: (c: string) => ['eco', c] as const }
function useAction<A, R>(fn: (a: A) => Promise<R>, opts: { silent?: boolean } = {}) {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  const invalidate = React.useCallback(() => Promise.all([
    qc.invalidateQueries({ queryKey: ecoKeys.all(companyId) }),
    qc.invalidateQueries({ queryKey: ['sales', companyId] }),
  ]), [qc, companyId])
  return useMutation({ mutationFn: fn, onSuccess: () => void invalidate(), onError: (e) => { if (!opts.silent) toast.error(describeError(e)) } })
}

export type Channel = Tables<'sales_channels'> & { warehouse: { code: string; name: string } | null }
export function useChannels() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...ecoKeys.all(companyId), 'channels'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('sales_channels').select('*, warehouse:warehouses(code, name)').eq('company_id', companyId).is('deleted_at', null)
      .order('name').returns<Channel[]>()),
  })
}
export function useChannel(id: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...ecoKeys.all(companyId), 'channel', id],
    enabled: !!companyId && !!id,
    queryFn: async () => unwrap(await supabase.from('sales_channels').select('*, warehouse:warehouses(code, name)').eq('id', id!).single().returns<Channel>()),
  })
}
export const useSaveChannel = () => {
  const { companyId } = useCompany()
  return useAction(async ({ id, ...v }: Record<string, unknown> & { id?: string }) => id
    ? unwrap(await supabase.from('sales_channels').update(v as never).eq('id', id).select('id').single())
    : unwrap(await supabase.from('sales_channels').insert({ ...v, company_id: companyId } as never).select('id').single()), { silent: true })
}

export type ChannelOrder = Tables<'channel_orders'> & { channel: { name: string } | null; sales_order: { id: string; number: string; total: number; status: string } | null }
export function useChannelOrders(channel?: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...ecoKeys.all(companyId), 'orders', channel ?? null],
    enabled: !!companyId,
    queryFn: async () => {
      let q = supabase.from('channel_orders').select('*, channel:sales_channels(name), sales_order:sales_orders(id, number, total, status)').eq('company_id', companyId)
      if (channel) q = q.eq('channel_id', channel)
      return unwrap(await q.order('created_at', { ascending: false }).limit(200).returns<ChannelOrder[]>())
    },
  })
}
export type ProductLink = Tables<'channel_product_links'> & { variant: { sku: string; name: string } | null }
export function useProductLinks(channel: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...ecoKeys.all(companyId), 'links', channel],
    enabled: !!companyId && !!channel,
    queryFn: async () => unwrap(await supabase.from('channel_product_links').select('*, variant:product_variants(sku, name)').eq('channel_id', channel!)
      .order('external_variant_id').returns<ProductLink[]>()),
  })
}
export function useSyncLogs(channel: string | undefined) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...ecoKeys.all(companyId), 'logs', channel],
    enabled: !!companyId && !!channel,
    queryFn: async () => unwrap(await supabase.from('channel_sync_logs').select('*').eq('channel_id', channel!).order('started_at', { ascending: false }).limit(50)),
  })
}
export const useToggleLink = () => useAction(async (a: { id: string; on: boolean }) => unwrap(await supabase.from('channel_product_links').update({ sync_enabled: a.on }).eq('id', a.id)))
export const useLinkProducts = () => useAction(async (channel: string) => unwrap(await supabase.rpc('link_channel_products', { p_channel: channel })) as number)
export const useSyncStock = () => useAction(async (channel: string) =>
  unwrap(await supabase.rpc('sync_channel_stock', { p_channel: channel })) as unknown as { items: { sku: string; available: number }[]; count: number; sent: boolean })
export const useIngestOrder = () => useAction(async (a: { channel: string; payload: Json }) =>
  unwrap(await supabase.rpc('ingest_channel_order', { p_channel: a.channel, p_payload: a.payload })) as unknown as IngestResult, { silent: true })
export const useRetryOrder = () => useAction(async (id: string) => unwrap(await supabase.rpc('retry_channel_order', { p_channel_order: id })) as unknown as IngestResult)
export type IngestResult = { status: 'imported' | 'duplicate' | 'failed'; channel_order_id: string; sales_order_id?: string; error?: string }
