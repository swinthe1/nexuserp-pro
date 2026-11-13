import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePriceLists } from '@/features/sales/api'
import { t, td } from '@/i18n'
import { UNIT_CATEGORIES, unitCategory, type UnitCategory } from '@/lib/unit-categories'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useWarehouses } from '../api'

type Kind = UnitCategory

/**
 * "Njësi e re" in one form: what kind of unit, where, its number at ATK, how many tills and where its goods
 * come from. Saved, the unit has its places and tills and is ready to sell.
 */
export function NewUnitDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: string) => void }) {
  const { companyId, hasFeature } = useCompany()
  const qc = useQueryClient()
  const units = (useWarehouses({ all: true }).data ?? []).filter((w) => w.is_active)
  const priceLists = usePriceLists()
  const depots = units.filter((w) => w.warehouse_type === 'warehouse')
  const blank = React.useCallback(() => ({
    kind: 'market' as Kind, name: '', code: '', city: '', address: '', atk: '', tills: '1', from: depots[0]?.id ?? '', priceList: '',
  }), [depots[0]?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [v, setV] = React.useState(blank)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { if (open) setV(blank()) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof ReturnType<typeof blank>>(k: K, x: ReturnType<typeof blank>[K]) => setV((s) => ({ ...s, [k]: x }))
  const cat = unitCategory(v.kind)!
  const sells = cat.sells
  const noModule = cat.restaurant && !hasFeature('restaurant')
  // a code from the name, until one is written: "Lider Market 2" → LM2
  const suggested = v.name.split(/[\s–-]+/).filter(Boolean).map((w) => (/^\d+$/.test(w) ? w : w[0])).join('').toUpperCase().slice(0, 6)
  const code = (v.code || suggested).toUpperCase()
  const ok = v.name.trim() && code && (!v.atk || /^\d{1,3}$/.test(v.atk)) && !noModule

  const submit = async () => {
    setBusy(true)
    try {
      const r = unwrap(await supabase.rpc('unit_create', { p: {
        company_id: companyId, category: v.kind, name: v.name.trim(), code, city: v.city, address: v.address, atk_branch_id: v.atk || null,
        tills: sells ? Number(v.tills) || 0 : 0, supplied_from_id: v.from || null, price_list_id: v.priceList || null,
      } })) as { id: string; tills: string[] }
      await qc.invalidateQueries()
      toast.success(r.tills.length ? t('{name} is ready, with tills {tills}', { name: v.name.trim(), tills: r.tills.join(', ') }) : t('{name} is ready', { name: v.name.trim() }))
      onOpenChange(false)
      onCreated?.(r.id)
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('New unit')}</DialogTitle>
          <DialogDescription>{t('A shop, restaurant, warehouse or kitchen of the company. Saved, it has its places and tills and is ready to work.')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <section className="grid gap-2">
            <Label>{t('What kind of unit')}</Label>
            <div className="grid gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label={t('What kind of unit')}>
              {UNIT_CATEGORIES.map((k) => (
                <button key={k.key} type="button" role="radio" aria-checked={v.kind === k.key} onClick={() => set('kind', k.key)}
                  className={cn('flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[13px] transition-colors', v.kind === k.key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50')}>
                  <k.icon className={cn('size-4 shrink-0', v.kind === k.key ? 'text-primary' : 'text-muted-foreground')} />{t(k.label)}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground">{t(cat.text)}</p>
            {noModule && <p className="rounded-md bg-warning/10 p-2 text-[12.5px]">{t('Restaurant tills come with the restaurant module, which this licence does not have: ask DrisPRO to add it.')}</p>}
          </section>

          <section className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
            <div className="grid gap-1.5"><Label htmlFor="nu-name">{t('Name')}</Label>
              <Input id="nu-name" autoFocus value={v.name} onChange={(e) => set('name', e.target.value)} placeholder={t('e.g. Market 2 – Korroticë')} /></div>
            <div className="grid gap-1.5"><Label htmlFor="nu-code">{t('Code')}</Label>
              <Input id="nu-code" className="font-mono uppercase" value={v.code} placeholder={suggested || 'LM2'} onChange={(e) => set('code', e.target.value.toUpperCase())} /></div> {/* i18n-ignore */}
            <div className="grid gap-1.5"><Label htmlFor="nu-city">{t('Town')}</Label><Input id="nu-city" value={v.city} onChange={(e) => set('city', e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="nu-atk" optional>{t('Number at ATK')}</Label>
              <Input id="nu-atk" inputMode="numeric" maxLength={3} value={v.atk} onChange={(e) => set('atk', e.target.value.replace(/\D/g, ''))} aria-invalid={!!v.atk && !/^\d{1,3}$/.test(v.atk)} /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="nu-addr" optional>{t('Address')}</Label><Input id="nu-addr" value={v.address} onChange={(e) => set('address', e.target.value)} /></div>
            {sells && <p className="text-[12px] text-muted-foreground sm:col-span-2">{t('The number at ATK is the one of the business unit in its registration at ATK; it goes into the fiscal receipts of this unit. It can be added later.')}</p>}
          </section>

          {sells && (
            <section className="grid items-start gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label>{t('Tills')}</Label>
                <Select value={v.tills} onValueChange={(x) => set('tills', x)}><SelectTrigger aria-label={t('Tills')}><SelectValue /></SelectTrigger>
                  <SelectContent>{['0', '1', '2', '3', '4', '5', '6', '8', '10'].map((n) => <SelectItem key={n} value={n}>{n === '0' ? t('No till yet') : n}</SelectItem>)}</SelectContent></Select>
                <p className="text-[12px] text-muted-foreground">{cat.restaurant ? t('Restaurant tills: tables, waiters, orders to the kitchen.') : t('Shop tills: scan and sell.')} {t('Their fiscal devices are added at ATK later.')}</p></div>
              <div className="grid gap-1.5"><Label optional>{t('Price list')}</Label>
                <Select value={v.priceList || 'none'} onValueChange={(x) => set('priceList', x === 'none' ? '' : x)}><SelectTrigger aria-label={t('Price list')}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">{t('The items’ own prices')}</SelectItem>
                    {(priceLists.data ?? []).map((pl) => <SelectItem key={pl.id} value={pl.id}>{td(pl.name)}</SelectItem>)}</SelectContent></Select></div>
            </section>
          )}

          {v.kind !== 'warehouse' && (
            <section className="grid gap-1.5">
              <Label>{t('Where its goods come from')}</Label>
              <Select value={v.from || 'self'} onValueChange={(x) => set('from', x === 'self' ? '' : x)}><SelectTrigger aria-label={t('Where its goods come from')}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="self">{t('It buys itself from the suppliers')}</SelectItem>
                  {units.map((w) => <SelectItem key={w.id} value={w.id}>{t('Supplied by {name}', { name: td(w.name) })}</SelectItem>)}</SelectContent></Select>
              <p className="text-[12px] text-muted-foreground">{t('Supplied by another unit: a transfer to this unit starts from there.')}</p>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t('Cancel')}</Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!ok}>{t('Create the unit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
