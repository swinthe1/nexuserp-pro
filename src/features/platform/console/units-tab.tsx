import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { t, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { UNIT_CATEGORIES, unitCategory, type UnitCategory } from '@/lib/unit-categories'
import { cn } from '@/lib/utils'

type Unit = { id: string; code: string; name: string; category: UnitCategory | null; type: string; city: string | null; address: string | null
  atk_branch_id: number | null; atk_unit_no: string | null; is_active: boolean; supplied_from_id: string | null; tills: number; restaurant_tills: number; can_delete?: boolean }
type Units = { limit: number | null; restaurant: boolean; units: Unit[] }

/**
 * A client's units, for the platform: what each is (market, café, restaurant, warehouse…), its tills, its number
 * at ATK; a new one in one form, or a change to one, for any client.
 */
export function ClientUnitsTab({ company }: { company: string }) {
  const q = useQuery({ queryKey: ['platform', 'units', company],
    queryFn: async () => unwrap(await supabase.rpc('platform_client_units' as never, { p_company: company } as never)) as unknown as Units })
  const [edit, setEdit] = React.useState<Unit | 'new' | null>(null)
  if (q.isLoading) return <Skeleton className="h-64" />
  if (q.isError || !q.data) return <p className="text-[13px] text-destructive">{tServer(describeError(q.error))}</p>
  const d = q.data
  const active = d.units.filter((u) => u.is_active).length
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div><CardTitle>{t('Units|places')}</CardTitle>
          <CardDescription>{d.limit ? t('{n} active of {max} the licence allows', { n: active, max: d.limit }) : t('{n} active', { n: active })}
            {!d.restaurant && <> · {t('the licence has no restaurant module')}</>}</CardDescription></div>
        <Button size="sm" onClick={() => setEdit('new')}><Plus /> {t('Add a unit')}</Button>
      </CardHeader>
      <CardContent className="pt-0">
        {!d.units.length ? <p className="py-8 text-center text-[13px] text-muted-foreground">{t('No unit yet.')}</p> : (
          <ul className="divide-y">
            {d.units.map((u) => { const c = unitCategory(u.category); const Icon = c?.icon
              return (
                <li key={u.id} className={cn('flex items-center gap-3 py-2.5', !u.is_active && 'opacity-60')}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">{Icon && <Icon className="size-4" />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium">{u.name} <span className="font-mono text-xs text-muted-foreground">{u.code}</span>
                      {!u.is_active && <Badge variant="outline">{t('Not active')}</Badge>}</div>
                    <div className="text-[12.5px] text-muted-foreground">
                      {[c ? t(c.label) : t('Kind not set'), u.city, u.tills ? t('{n} tills', { n: u.tills }) : null,
                        u.restaurant_tills ? t('{n} restaurant tills', { n: u.restaurant_tills }) : null, u.atk_branch_id ? t('ATK no. {n}', { n: u.atk_branch_id }) : null].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(u)}><Pencil /> {t('Change|unit')}</Button>
                </li>
              ) })}
          </ul>
        )}
      </CardContent>
      {edit && <UnitDialog company={company} units={d.units} restaurant={d.restaurant} unit={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  )
}

function UnitDialog({ company, units, restaurant, unit, onClose }: { company: string; units: Unit[]; restaurant: boolean; unit: Unit | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [v, setV] = React.useState({
    category: (unit?.category ?? 'market') as UnitCategory, name: unit?.name ?? '', code: unit?.code ?? '', city: unit?.city ?? '', address: unit?.address ?? '',
    atk: unit?.atk_branch_id ? String(unit.atk_branch_id) : '', tills: '1', from: unit?.supplied_from_id ?? '', active: unit?.is_active ?? true, addRestaurant: true,
  })
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  const cat = unitCategory(v.category)!
  const needsModule = cat.restaurant && !restaurant
  const ok = v.name.trim() && v.code.trim() && (!v.atk || /^\d{1,3}$/.test(v.atk))
  const save = useMutation({
    mutationFn: async () => {
      const p = { category: v.category, name: v.name.trim(), code: v.code.trim().toUpperCase(), city: v.city, address: v.address, atk_branch_id: v.atk || null,
        supplied_from_id: v.from || null, add_restaurant: needsModule && v.addRestaurant }
      if (unit) return unwrap(await supabase.rpc('platform_unit_update' as never, { p_unit: unit.id, p: { ...p, is_active: v.active } } as never)) as unknown as { tills_changed: number; tills_open: number }
      return unwrap(await supabase.rpc('platform_unit_create' as never, { p_company: company, p: { ...p, tills: cat.sells ? Number(v.tills) : 0 } } as never)) as unknown as { tills: string[] }
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['platform'] })
      const x = r as { tills?: string[]; tills_changed?: number; tills_open?: number }
      toast.success(unit
        ? [t('The unit is saved.'), x.tills_changed ? t('{n} tills changed their kind.', { n: x.tills_changed }) : '', x.tills_open ? t('{n} open tills change after they are closed.', { n: x.tills_open }) : ''].filter(Boolean).join(' ')
        : x.tills?.length ? t('{name} is ready, with tills {tills}', { name: v.name.trim(), tills: x.tills.join(', ') }) : t('{name} is ready', { name: v.name.trim() }))
      onClose()
    },
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  const remove = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('platform_unit_delete' as never, { p_unit: unit!.id } as never)) as unknown as { deleted: boolean; history?: Record<string, number> },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['platform'] })
      if (r.deleted) { toast.success(t('{name} was deleted', { name: unit!.name })); onClose(); return }
      toast.error(t('This unit has documents or stock behind it, so it cannot be deleted: make it not active instead.'))
    },
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{unit ? t('Change the unit') : t('Add a unit')}</DialogTitle>
          <DialogDescription>{unit ? t('A new kind also changes the kind of its tills (shop or restaurant).') : t('Saved, the unit has its places and tills and is ready to work.')}</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <section className="grid gap-2">
            <Label>{t('What kind of unit')}</Label>
            <div className="grid gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label={t('What kind of unit')}>
              {UNIT_CATEGORIES.map((c) => (
                <button key={c.key} type="button" role="radio" aria-checked={v.category === c.key} onClick={() => set('category', c.key)}
                  className={cn('flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[13px] transition-colors', v.category === c.key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50')}>
                  <c.icon className={cn('size-4 shrink-0', v.category === c.key ? 'text-primary' : 'text-muted-foreground')} />{t(c.label)}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground">{t(cat.text)}</p>
            {needsModule && <label className="flex items-center gap-2 rounded-md bg-warning/10 p-2 text-[12.5px]"><Checkbox checked={v.addRestaurant} onCheckedChange={(x) => set('addRestaurant', x === true)} />
              {t('The licence has no restaurant module: add it, so the restaurant tills open.')}</label>}
          </section>
          <section className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
            <div className="grid gap-1.5"><Label htmlFor="pu-name">{t('Name')}</Label><Input id="pu-name" autoFocus value={v.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pu-code">{t('Code')}</Label><Input id="pu-code" className="font-mono uppercase" value={v.code} onChange={(e) => set('code', e.target.value.toUpperCase())} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pu-city">{t('Town')}</Label><Input id="pu-city" value={v.city} onChange={(e) => set('city', e.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pu-atk" optional>{t('Number at ATK')}</Label>
              <Input id="pu-atk" inputMode="numeric" maxLength={3} value={v.atk} onChange={(e) => set('atk', e.target.value.replace(/\D/g, ''))} /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="pu-addr" optional>{t('Address')}</Label><Input id="pu-addr" value={v.address} onChange={(e) => set('address', e.target.value)} /></div>
          </section>
          <section className="grid items-start gap-3 sm:grid-cols-2">
            {!unit && cat.sells && (
              <div className="grid gap-1.5"><Label>{t('Tills')}</Label>
                <Select value={v.tills} onValueChange={(x) => set('tills', x)}><SelectTrigger aria-label={t('Tills')}><SelectValue /></SelectTrigger>
                  <SelectContent>{['0', '1', '2', '3', '4', '5', '6', '8', '10'].map((n) => <SelectItem key={n} value={n}>{n === '0' ? t('No till yet') : n}</SelectItem>)}</SelectContent></Select></div>
            )}
            {v.category !== 'warehouse' && (
              <div className="grid gap-1.5"><Label>{t('Where its goods come from')}</Label>
                <Select value={v.from || 'self'} onValueChange={(x) => set('from', x === 'self' ? '' : x)}><SelectTrigger aria-label={t('Where its goods come from')}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="self">{t('It buys itself from the suppliers')}</SelectItem>
                    {units.filter((u) => u.is_active && u.id !== unit?.id).map((u) => <SelectItem key={u.id} value={u.id}>{t('Supplied by {name}', { name: u.name })}</SelectItem>)}</SelectContent></Select></div>
            )}
            {unit && <label className="flex items-center gap-2 text-[13px]"><Switch checked={v.active} onCheckedChange={(x) => set('active', x)} /> {t('Active')}</label>}
          </section>
        </div>
        <DialogFooter className="sm:justify-between">
          {unit ? (unit.can_delete
            ? <Button variant="ghost" className="text-destructive" loading={remove.isPending} disabled={save.isPending}
                onClick={() => { if (confirm(t('Delete {name} with its places and tills? It has no document or stock behind it.', { name: unit.name }))) remove.mutate() }}><Trash2 /> {t('Delete the unit')}</Button>
            : <p className="max-w-[46ch] text-[12px] text-muted-foreground">{t('It has documents or stock behind it, so it is not deleted: switch "Active" off to close it.')}</p>)
            : <span />}
          <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>{t('Cancel')}</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!ok}>{unit ? t('Save') : t('Create the unit')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
