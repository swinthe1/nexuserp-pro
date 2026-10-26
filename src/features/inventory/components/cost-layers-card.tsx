import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate, formatMoney, formatQty } from '@/lib/utils'

type Layer = { at: string; qty_in: number; qty_left: number; unit_cost: number; reference: string | null }

/** Under FIFO: the receipts still in stock, oldest first (the next sale takes the top one) */
export function CostLayersCard({ variantIds }: { variantIds: string[] }) {
  const q = useQuery({
    queryKey: ['cost-layers', variantIds],
    enabled: variantIds.length > 0,
    queryFn: async () => (await Promise.all(variantIds.map(async (id) => unwrap(await supabase.rpc('cost_layers_of', { p_variant: id })) as unknown as Layer[]))).flat()
      .sort((a, b) => a.at.localeCompare(b.at)),
  })
  if (!q.data?.length) return null
  return (
    <Card>
      <CardHeader><CardTitle>{t('Cost layers (FIFO)')}</CardTitle><CardDescription>{t('The receipts still in stock, oldest first: the next sale takes the cost of the top one.')}</CardDescription></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>{t('Date')}</TableHead><TableHead>{t('Document')}</TableHead><TableHead className="text-right">{t('Left')}</TableHead><TableHead className="text-right">{t('Unit cost')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {q.data.map((l, i) => (
              <TableRow key={i}>
                <TableCell className="text-[13px]">{formatDate(l.at)}</TableCell>
                <TableCell className="text-[13px]">{l.reference ?? t('Opening stock')}</TableCell>
                <TableCell className="text-right tabular">{formatQty(l.qty_left)} <span className="text-muted-foreground">/ {formatQty(l.qty_in)}</span></TableCell>
                <TableCell className="text-right tabular">{formatMoney(l.unit_cost)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
