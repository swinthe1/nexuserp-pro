import { PackageCheck, ScanLine, Truck } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Can } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type { Tables } from '@/lib/database.types'
import { cn, formatDate, formatQty, num } from '@/lib/utils'
import { t, tn } from '@/i18n'
import { useBarcodesOf, useReceiveTransfer, useVariantOptions } from '../api'

type Line = Tables<'stock_transfer_lines'>
type Doc = Tables<'stock_transfers'> & { lines: Line[] }

/**
 * A transfer on the road: the receiving store counts what arrived (typing or scanning) and
 * says what happens to anything missing. Once received, the same card shows the result.
 */
export function ReceiveTransferCard({ doc }: { doc: Doc }) {
  const receiving = doc.status === 'in_transit'
  const variants = useVariantOptions()
  const barcodes = useBarcodesOf(doc.lines.map((l) => l.variant_id))
  const receive = useReceiveTransfer()
  const [got, setGot] = React.useState<Record<string, string>>(() => Object.fromEntries(doc.lines.map((l) => [l.id, String(num(l.quantity_done))])))
  const [action, setAction] = React.useState<Record<string, 'loss' | 'return'>>({})
  const [note, setNote] = React.useState('')
  const [scan, setScan] = React.useState('')
  const scanRef = React.useRef<HTMLInputElement>(null)

  const item = (id: string) => variants.data?.find((v) => v.id === id)
  const shipped = (l: Line) => num(l.quantity_done)
  const received = (l: Line) => (receiving ? num(got[l.id]) : num(l.quantity_received ?? l.quantity_done))
  const diff = (l: Line) => received(l) - shipped(l)
  const short = doc.lines.filter((l) => diff(l) < 0)
  const extra = doc.lines.filter((l) => diff(l) > 0)

  // a scan counts on the first line of that item that is not yet full (or the last one): one unit, or a
  // whole box when the barcode is the box's (a box of 12 counts 12)
  const onScan = (e: React.FormEvent) => {
    e.preventDefault()
    const code = scan.trim()
    if (!code) return
    const bc = barcodes.data?.find((b) => b.barcode === code)
    const variant = bc?.variant_id ?? variants.data?.find((v) => v.sku.toUpperCase() === code.toUpperCase())?.id
    const per = Math.max(num(bc?.quantity) || 1, 1)
    const lines = doc.lines.filter((l) => l.variant_id === variant)
    if (!lines.length) { toast.error(t('This item is not on the transfer'), { description: code }); setScan(''); return }
    const target = lines.find((l) => num(got[l.id]) < shipped(l)) ?? lines[lines.length - 1]
    setGot((g) => ({ ...g, [target.id]: String(num(g[target.id]) + per) }))
    if (per > 1) toast.info(t('A box: {n} counted', { n: per }), { description: item(target.variant_id)?.name })
    setScan('')
  }

  const startCounting = () => { setGot(Object.fromEntries(doc.lines.map((l) => [l.id, '0']))); scanRef.current?.focus() }

  const submit = async () => {
    const r = await receive.mutateAsync({
      id: doc.id, note,
      lines: doc.lines.map((l) => ({ line_id: l.id, received: num(got[l.id]), ...(diff(l) < 0 ? { action: action[l.id] ?? 'loss' } : {}) })),
    })
    if (r.difference) toast.warning(t('Received with differences'), { description: t('{lost} lost, {returned} sent back, {extra} extra', { lost: formatQty(r.lost), returned: formatQty(r.returned), extra: formatQty(r.extra) }) })
    else toast.success(t('Received in full'))
  }

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            {receiving ? <Truck className="size-4 text-muted-foreground" /> : <PackageCheck className="size-4 text-muted-foreground" />}
            {receiving ? t('On the road — count what arrived') : t('Received|transfer')}
          </CardTitle>
          <CardDescription>
            {receiving
              ? t('Shipped {date}. Count each item as it comes off the truck, by typing or scanning. Anything missing is either a loss or goes back to the sender.', { date: formatDate(doc.shipped_at, true) })
              : t('Received {date}.', { date: formatDate(doc.received_at, true) }) + (doc.receive_note ? ` ${doc.receive_note}` : '')}
          </CardDescription>
        </div>
        {receiving && (
          <Can perm="wms.write">
            <div className="flex flex-wrap items-center gap-2">
              <form onSubmit={onScan} className="relative">
                <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input ref={scanRef} value={scan} onChange={(e) => setScan(e.target.value)} placeholder={t('Scan a barcode')} className="h-9 w-56 pl-8" aria-label={t('Scan a barcode')} />
              </form>
              <Button type="button" variant="outline" size="sm" onClick={startCounting}>{t('Count from zero')}</Button>
            </div>
          </Can>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        <Table>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead className="min-w-[220px]">{t('Product')}</TableHead>
            <TableHead className="w-28 text-right">{t('Shipped')}</TableHead>
            <TableHead className="w-32 text-right">{t('Received|transfer')}</TableHead>
            <TableHead className="w-28 text-right">{t('Difference')}</TableHead>
            <TableHead className="min-w-[200px]">{t('Missing units')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {doc.lines.map((l) => {
              const v = item(l.variant_id)
              const d = diff(l)
              return (
                <TableRow key={l.id} className="hover:bg-transparent">
                  <TableCell>
                    <div className="font-medium">{v?.name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{v?.sku}</div>
                  </TableCell>
                  <TableCell className="text-right tabular">{formatQty(shipped(l))}</TableCell>
                  <TableCell className="text-right">
                    {receiving
                      ? <Input type="number" min="0" step="any" value={got[l.id] ?? ''} onChange={(e) => setGot((g) => ({ ...g, [l.id]: e.target.value }))}
                          className="ml-auto h-9 w-28 text-right" aria-label={t('Received quantity of {item}', { item: v?.name ?? '' })} />
                      : <span className="tabular">{formatQty(received(l))}</span>}
                  </TableCell>
                  <TableCell className={cn('text-right tabular', d < 0 && 'text-destructive', d > 0 && 'text-warning')}>{d === 0 ? '—' : (d > 0 ? '+' : '') + formatQty(d)}</TableCell>
                  <TableCell>
                    {d < 0 && receiving && (
                      <Select value={action[l.id] ?? 'loss'} onValueChange={(x) => setAction((a) => ({ ...a, [l.id]: x as 'loss' | 'return' }))}>
                        <SelectTrigger className="h-9 w-48" aria-label={t('What happens to the missing units')}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="loss">{t('Lost on the way')}</SelectItem>
                          <SelectItem value="return">{t('Back to the sender')}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {!receiving && l.difference_action && (
                      <Badge variant={l.difference_action === 'loss' ? 'destructive' : 'secondary'}>
                        {l.difference_action === 'loss' ? t('Lost on the way') : l.difference_action === 'return' ? t('Back to the sender') : t('Extra, added to stock')}
                      </Badge>
                    )}
                    {d > 0 && receiving && <span className="text-xs text-muted-foreground">{t('Extra, added to stock')}</span>}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        {receiving && (
          <Can perm="wms.write">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="grid gap-1.5">
                <Label htmlFor="receive-note" optional>{t('Note on the delivery')}</Label>
                <Textarea id="receive-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. two boxes damaged')} />
              </div>
              <ConfirmDialog
                trigger={<Button loading={receive.isPending}><PackageCheck /> {t('Receive the goods')}</Button>}
                title={t('Receive {number}?', { number: doc.number })}
                description={short.length || extra.length
                  ? t('{short} with missing units and {extra} with extra units. The stock of both stores changes now and cannot be undone.', {
                      short: tn(short.length, '{n} line', '{n} lines'), extra: tn(extra.length, '{n} line', '{n} lines') })
                  : t('Everything arrived as shipped. The goods go onto this store’s shelves.')}
                confirmLabel={t('Receive the goods')}
                onConfirm={submit}
              />
            </div>
          </Can>
        )}
      </CardContent>
    </Card>
  )
}
