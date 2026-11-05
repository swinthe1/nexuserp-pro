import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import * as React from 'react'
import { useCompany } from '@/app/company-provider'
import { t, td } from '@/i18n'
import { supabase } from '@/lib/supabase'

type Groups = Record<string, { groups: string[]; subs: string[] }>

/**
 * The groups and sub-groups of the items on each document (from the meeting with the staff): two
 * columns and two filters for the supplier's lists (purchase invoices, orders, receipts).
 */
export function useDocGroups<R extends { id: string }>(table: 'vendor_bills' | 'purchase_orders' | 'goods_receipts' | null, rows: R[] | undefined) {
  const { companyId } = useCompany()
  const q = useQuery({
    queryKey: ['doc-groups', companyId, table], enabled: !!companyId && !!table, staleTime: 60_000,
    queryFn: async () => {
      const r = await supabase.rpc('doc_item_groups' as never, { p_company: companyId, p_doc: table } as never)
      return (r.error ? {} : r.data) as unknown as Groups   // a server not updated yet: no groups
    },
  })
  const map = q.data ?? {}
  const has = Object.keys(map).length > 0
  const columns = React.useMemo<ColumnDef<R>[]>(() => !has ? [] : [
    { id: 'item_groups', accessorFn: (r) => (map[r.id]?.groups ?? []).map((g) => td(g)).join(', '), filterFn: anyOf, header: t('Groups'), meta: { label: t('Groups') },
      cell: ({ getValue }) => <span className="text-[12.5px] text-muted-foreground">{getValue() as string}</span> },
    { id: 'item_subs', accessorFn: (r) => (map[r.id]?.subs ?? []).map((g) => td(g)).join(', '), filterFn: anyOf, header: t('Sub-groups'), meta: { label: t('Sub-groups') },
      cell: ({ getValue }) => <span className="text-[12.5px] text-muted-foreground">{getValue() as string}</span> },
  ], [map, has]) // eslint-disable-line react-hooks/exhaustive-deps
  const facets = React.useMemo(() => {
    if (!has) return []
    const ids = new Set((rows ?? []).map((r) => r.id))
    const g = new Set<string>(), s = new Set<string>()
    for (const [id, v] of Object.entries(map)) if (ids.has(id)) { v.groups.forEach((x) => g.add(td(x))); v.subs.forEach((x) => s.add(td(x))) }
    return [
      { columnId: 'item_groups', title: t('Groups'), options: [...g].sort().map((x) => ({ value: x, label: x })) },
      ...(s.size ? [{ columnId: 'item_subs', title: t('Sub-groups'), options: [...s].sort().map((x) => ({ value: x, label: x })) }] : []),
    ]
  }, [map, has, rows])
  return { columns, facets, hidden: ['item_subs'] }
}

// a document passes when any of its groups is among the chosen ones
function anyOf(row: { getValue: (id: string) => unknown }, id: string, value: string[]) {
  if (!value?.length) return true
  const have = String(row.getValue(id) ?? '').split(', ')
  return value.some((v) => have.includes(v))
}
