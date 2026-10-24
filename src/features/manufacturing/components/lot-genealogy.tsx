import { ArrowDown, ArrowUp, Factory } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { t } from '@/i18n'
import { formatDate, formatQty } from '@/lib/utils'
import { useGenealogy, type GenealogyRow } from '../api'

/** Production genealogy of a lot: what it was made from (to any depth) and everything made from it */
export function LotGenealogy({ lotId }: { lotId: string }) {
  const { can } = useCompany()
  const up = useGenealogy(lotId, 'up')
  const down = useGenealogy(lotId, 'down')
  if (!can('manufacturing.read') && !can('inventory.read')) return null
  if (up.isLoading || down.isLoading) return <Skeleton className="mt-4 h-24" />
  if (!up.data?.length && !down.data?.length) return null
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <TreeCard title={t('Made from')} description={t('Every lot that went into this one, down to the raw materials.')} icon={<ArrowDown className="size-4" />} rows={up.data ?? []}
        empty={t('Not produced here: it was received or counted in.')} />
      <TreeCard title={t('Used in')} description={t('Every lot made from this one. For a recall, these lots and their customers are affected too.')} icon={<ArrowUp className="size-4" />}
        rows={down.data ?? []} empty={t('Not used in production yet.')} />
    </div>
  )
}

function TreeCard({ title, description, icon, rows, empty }: { title: string; description: string; icon: React.ReactNode; rows: GenealogyRow[]; empty: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2">{icon}{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent className="grid gap-1 p-0 pb-2">
        {!rows.length && <p className="px-4 pb-2 text-[13px] text-muted-foreground">{empty}</p>}
        {rows.map((r) => (
          <div key={`${r.depth}-${r.lot_id}-${r.work_order_id}`} className="flex items-center justify-between gap-3 px-4 py-1.5 text-[13px]" style={{ paddingLeft: 16 + (r.depth - 1) * 20 }}>
            <span className="min-w-0">
              <Link to={`/wms/lots/${r.lot_id}`} className="font-mono font-medium text-primary hover:underline">{r.lot_number}</Link>
              <span className="ml-1.5">{r.name}</span>
              <span className="block text-xs text-muted-foreground">
                <Factory className="mr-1 inline size-3" /><Link to={`/manufacturing/orders/${r.work_order_id}`} className="hover:underline">{r.work_order}</Link>
                {r.vendor ? ` · ${t('from {vendor}', { vendor: r.vendor })}` : ''}{r.expiry_date ? ` · ${t('expires {date}', { date: formatDate(r.expiry_date) })}` : ''}
              </span>
            </span>
            <span className="shrink-0 tabular text-muted-foreground">{formatQty(r.quantity)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
