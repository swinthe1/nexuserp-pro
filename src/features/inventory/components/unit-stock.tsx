import { ArrowRight, Check, PackageX, Send, ShoppingCart, Store, Truck, Warehouse } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { describeError } from '@/lib/errors'
import { t, td, msg } from '@/i18n'
import { cn, formatQty } from '@/lib/utils'
import { useItemRequest, useItemWhere, type UnitStock, type WhereResult, type WhereSuggestion } from '../where'

const STATUS = {
  none: { label: msg("Doesn't carry it"), cls: 'text-muted-foreground' },
  out: { label: msg('None free'), cls: 'text-destructive' },
  low: { label: msg('Low|stock'), cls: 'text-warning' },
  ok: { label: msg('In stock|unit'), cls: 'text-success' },
} as const

/** every unit with the item: how much is free, its minimum, what is on the way */
export function UnitsList({ units, unit, className }: { units: UnitStock[]; unit?: string | null; className?: string }) {
  return (
    <ul className={cn('divide-y rounded-lg border bg-card', className)}>
      {units.map((u) => {
        const Icon = u.type === 'warehouse' ? Warehouse : Store
        const st = STATUS[u.status]
        return (
          <li key={u.id} className={cn('flex items-center gap-3 px-3 py-2.5', u.here && 'bg-primary/[0.04]')}>
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="truncate text-[14px] font-medium">{td(u.name)}</span>
                {u.here && <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">{t('My unit')}</Badge>}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className={st.cls}>{t(st.label)}</span>
                {u.reserved > 0 && <span>{t('{n} reserved', { n: formatQty(u.reserved) })}</span>}
                {u.min_qty != null && <span>{t('keeps {min}–{max}', { min: formatQty(u.min_qty), max: formatQty(u.max_qty ?? u.min_qty) })}</span>}
                {u.outgoing > 0 && <span>{t('{n} promised to another unit', { n: formatQty(u.outgoing) })}</span>}
                {u.incoming > 0 && <span className="text-primary">{t('+{n} on the way', { n: formatQty(u.incoming) })}</span>}
                {u.sold_30 > 0 && <span>{t('{n} sold in 30 days', { n: formatQty(u.sold_30) })}</span>}
              </div>
              {u.docs.length > 0 && (
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                  {u.docs.slice(0, 3).map((d) => (
                    <Link key={d.id} to={`/inventory/transfers/${d.id}`} className="text-primary hover:underline">
                      {d.number} · {d.status === 'in_transit' ? t('on the road') : d.is_request ? t('asked for') : t('draft|transfer')} · {formatQty(d.qty)} {t('from {unit}', { unit: td(d.from) })}
                    </Link>))}
                </div>
              )}
            </div>
            <div className="text-right">
              <div className={cn('text-xl font-semibold tabular leading-none', u.available <= 0 && u.status !== 'none' ? 'text-destructive' : u.status === 'low' ? 'text-warning' : u.status === 'none' ? 'text-muted-foreground' : '')}>
                {formatQty(u.available)}
              </div>
              {unit && <div className="mt-0.5 text-[11px] text-muted-foreground">{td(unit)}</div>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** what to do for one short unit */
export function SuggestionCard({ s, data }: { s: WhereSuggestion; data: WhereResult }) {
  const to = data.units?.find((u) => u.id === s.to)
  const from = data.units?.find((u) => u.id === s.from)
  const [asking, setAsking] = React.useState(false)
  const unit = data.item?.unit ? td(data.item.unit) : ''
  if (s.kind === 'coming') {
    return (
      <div className="flex gap-3 rounded-lg border border-primary/30 bg-primary/[0.04] p-3">
        <Truck className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="text-[13px]">
          <div className="font-medium">{t('{unit}: {n} already on the way', { unit: td(s.to_name), n: formatQty(s.incoming) })}</div>
          <div className="text-muted-foreground">{t('That is enough for now; nothing more to ask for.')}</div>
        </div>
      </div>
    )
  }
  if (s.kind === 'buy') {
    return (
      <div className="flex gap-3 rounded-lg border border-warning/40 bg-warning/[0.06] p-3">
        <ShoppingCart className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="grid gap-1 text-[13px]">
          <div className="font-medium">{t('{unit}: no other unit can spare it', { unit: td(s.to_name) })}</div>
          <div className="text-muted-foreground">
            {s.qty ? t('Order {n} {unit} from the supplier', { n: formatQty(s.qty), unit }) : t('Order it from the supplier')}
            {s.vendor_name ? ` (${td(s.vendor_name)})` : ''}{s.incoming > 0 ? ` · ${t('{n} already on the way', { n: formatQty(s.incoming) })}` : ''}.
          </div>
          <Link to="/procurement/replenishment" className="text-primary hover:underline">{t('Open replenishment')}</Link>
        </div>
      </div>
    )
  }
  const why = s.basis === 'rule' ? t('This fills {unit} up to its maximum of {max}.', { unit: td(s.to_name), max: formatQty(to?.max_qty ?? 0) })
    : s.basis === 'sales' ? t('About two weeks of sales.')
    : t('Half of what {unit} can spare.', { unit: td(s.from_name ?? '') })
  return (
    <div className="grid gap-2 rounded-lg border-2 border-primary/50 bg-primary/[0.05] p-3">
      <div className="flex items-start gap-3">
        <Send className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 text-[13px]">
          <div className="text-[15px] font-semibold">{t('Take {n} {unit} from {from}', { n: formatQty(s.qty ?? 0), unit, from: td(s.from_name ?? '') })}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-muted-foreground">
            {td(s.from_name ?? '')} <ArrowRight className="size-3" /> {td(s.to_name)}
          </div>
          <p className="mt-1 text-muted-foreground">
            {t(from?.min_qty != null ? '{to} has {n}. {from} has {has} and can give {spare} without going under its own minimum.'
              : from?.type === 'warehouse' ? '{to} has {n}. {from} has {spare} free.' : '{to} has {n}. {from} has {has} and keeps half for itself.', {
              to: td(s.to_name), n: formatQty(to?.available ?? 0), from: td(s.from_name ?? ''), has: formatQty(s.from_available ?? 0), spare: formatQty(s.from_spare ?? 0) })} {why}
            {(s.rest ?? 0) > 0 && <> {t('The other {n} have to be bought.', { n: formatQty(s.rest ?? 0) })}</>}
          </p>
        </div>
      </div>
      {data.can_request && <Button className="h-11 justify-self-start" onClick={() => setAsking(true)}><Send /> {t('Ask {unit} for it', { unit: td(s.from_name ?? '') })}</Button>}
      {asking && data.item && <AskDialog variantId={data.item.variant_id} name={data.item.name} unit={unit} s={s} onClose={() => setAsking(false)} />}
    </div>
  )
}

function AskDialog({ variantId, name, unit, s, onClose }: { variantId: string; name: string; unit: string; s: WhereSuggestion; onClose: () => void }) {
  const req = useItemRequest()
  const [qty, setQty] = React.useState(String(s.qty ?? ''))
  const [note, setNote] = React.useState('')
  const n = Number(qty.replace(',', '.'))
  const over = s.from_available != null && n > s.from_available
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('Ask {unit} for it', { unit: td(s.from_name ?? '') })}</DialogTitle>
          <DialogDescription>{t('A transfer request goes to {from}; the people there are told. They send it and {to} counts it when it arrives.', { from: td(s.from_name ?? ''), to: td(s.to_name) })}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault()
          if (!(n > 0)) return
          try {
            const r = await req.mutateAsync({ variant: variantId, from: s.from!, to: s.to, qty: n, note })
            toast.success(r.merged ? t('Added to request {number}', { number: r.number }) : t('Request {number} sent to {unit}', { number: r.number, unit: td(s.from_name ?? '') }),
              { description: `${formatQty(n)} × ${name}`, action: { label: t('Open'), onClick: () => window.location.assign(`/inventory/transfers/${r.id}`) } })
            onClose()
          } catch (err) { toast.error(describeError(err)) }
        }}>
          <div className="grid gap-1.5">
            <Label htmlFor="ask-qty">{t('Quantity')} {unit && <span className="text-muted-foreground">({unit})</span>}</Label>
            <Input id="ask-qty" autoFocus inputMode="decimal" className="h-12 text-center text-xl font-semibold tabular" value={qty} onChange={(e) => setQty(e.target.value)} onFocus={(e) => e.target.select()} />
            {over && <p className="text-xs text-warning">{t('{unit} has only {n} free.', { unit: td(s.from_name ?? ''), n: formatQty(s.from_available ?? 0) })}</p>}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ask-note">{t('Note (optional)')}</Label>
            <Input id="ask-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. needed for the weekend')} />
          </div>
          <DialogFooter><Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button><Button type="submit" loading={req.isPending} disabled={!(n > 0)}><Send /> {t('Send request')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** the answer for one item: suggestions on top, then every unit */
export function WhereView({ data, compact }: { data: WhereResult; compact?: boolean }) {
  const units = data.units ?? []
  const here = units.find((u) => u.here)
  const sugg = data.suggestions ?? []
  const carrying = units.filter((u) => u.status !== 'none')
  const total = units.reduce((s, u) => s + Math.max(0, u.available), 0)
  return (
    <div className="grid gap-3">
      {!compact && (
        <p className="text-[13px] text-muted-foreground">
          {t('{n} free in all, in {units} of {all} units', { n: formatQty(total), units: carrying.filter((u) => u.available > 0).length, all: units.length })}
        </p>
      )}
      {sugg.map((s, i) => <SuggestionCard key={`${s.to}-${i}`} s={s} data={data} />)}
      {here && !sugg.length && here.status === 'ok' && (
        <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/[0.06] p-3 text-[13px]">
          <Check className="size-4 text-success" /> {t('{unit} has enough: {n}', { unit: td(here.name), n: formatQty(here.available) })}
        </div>
      )}
      {!here && !sugg.length && units.some((u) => u.status !== 'none') && (
        <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/[0.06] p-3 text-[13px]">
          <Check className="size-4 text-success" /> {t('No unit is short of it.')}
        </div>
      )}
      {!units.some((u) => u.status !== 'none') && (
        <div className="flex items-center gap-2 rounded-lg border p-3 text-[13px] text-muted-foreground"><PackageX className="size-4" /> {t('No unit has it yet.')}</div>
      )}
      <UnitsList units={units} unit={data.item?.unit} />
    </div>
  )
}

/** the product page: the item in every unit */
export function UnitsCard({ variants }: { variants: { id: string; sku: string; name: string; is_default?: boolean | null }[] }) {
  const { can } = useCompany()
  const [v, setV] = React.useState(() => (variants.find((x) => x.is_default) ?? variants[0])?.id ?? null)
  const q = useItemWhere(v, null, { enabled: can('inventory.read') })
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>{t('In every unit')}</CardTitle>
        <CardDescription>{t('How much each store and warehouse has, and where to take it from when one is short.')}</CardDescription>
        {variants.length > 1 && (
          <Select value={v ?? ''} onValueChange={setV}>
            <SelectTrigger className="mt-2 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{variants.map((x) => <SelectItem key={x.id} value={x.id}>{x.sku} · {x.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent>
        {q.isLoading ? <Skeleton className="h-40" /> : q.data?.found ? <WhereView data={q.data} compact /> : null}
        <Link to="/inventory/check" className="mt-3 inline-block text-[13px] text-primary hover:underline">{t('Check another item')}</Link>
      </CardContent>
    </Card>
  )
}
