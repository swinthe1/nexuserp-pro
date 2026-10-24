import { Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { t, td, tn } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { useCategories } from '@/features/inventory/api'
import { type Station, useSaveRoom, useStations } from './api'

type AreaRow = { id: string; name: string; sort_order: number; tables: { id: string; name: string; seats: number; sort_order: number; is_active: boolean; deleted_at: string | null }[] }

/** Rooms, tables and where orders go (kitchen, bar). Managers only. */
export function RoomSetupDialog({ warehouseId, onClose }: { warehouseId: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{t('Set up the room')}</DialogTitle>
          <DialogDescription>{t('Rooms and tables of this place, and the kitchen and bar screens that receive the orders.')}</DialogDescription></DialogHeader>
        <Tabs defaultValue="tables">
          <TabsList><TabsTrigger value="tables">{t('Rooms and tables')}</TabsTrigger><TabsTrigger value="stations">{t('Kitchen and bar')}</TabsTrigger></TabsList>
          <TabsContent value="tables" className="mt-4"><Tables warehouseId={warehouseId} /></TabsContent>
          <TabsContent value="stations" className="mt-4"><Stations warehouseId={warehouseId} /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

const guard = async (fn: () => Promise<void>) => { try { await fn() } catch (e) { toast.error(describeError(e)) } }

function Tables({ warehouseId }: { warehouseId: string }) {
  const { companyId } = useCompany()
  const room = useSaveRoom()
  const areas = useQuery({
    queryKey: ['restaurant', companyId, 'areas', warehouseId],
    queryFn: async () => unwrap(await supabase.from('restaurant_areas').select('id, name, sort_order, tables:restaurant_tables(id, name, seats, sort_order, is_active, deleted_at)')
      .eq('warehouse_id', warehouseId).is('deleted_at', null).order('sort_order')) as unknown as AreaRow[],
  })
  const [newArea, setNewArea] = React.useState('')
  const [count, setCount] = React.useState<Record<string, string>>({})
  const [seats, setSeats] = React.useState<Record<string, string>>({})
  const reload = () => void areas.refetch()
  return (
    <div className="grid gap-4">
      {(areas.data ?? []).map((a) => {
        const tables = a.tables.filter((x) => !x.deleted_at).sort((x, y) => x.sort_order - y.sort_order || x.name.localeCompare(y.name, undefined, { numeric: true }))
        const prefix = (a.name.trim()[0] ?? 'T').toUpperCase()
        return (
          <div key={a.id} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Input defaultValue={a.name} className="h-9 max-w-xs font-medium" aria-label={t('Room name')}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== a.name) void guard(async () => { await room.renameArea(a.id, v); reload() }) }} />
              <span className="text-xs text-muted-foreground">{tn(tables.length, '{n} table', '{n} tables')}</span>
              <Button variant="ghost" size="icon" className="ml-auto text-destructive" aria-label={t('Remove {name}', { name: a.name })}
                onClick={() => { if (confirm(t('Remove {name} and its tables?', { name: a.name }))) void guard(async () => { await room.removeArea(a.id); reload() }) }}><Trash2 /></Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tables.map((tb) => (
                <span key={tb.id} className="inline-flex items-center gap-1 rounded-md border bg-card py-1 pl-2 pr-1 text-[13px]">
                  <b>{tb.name}</b><span className="text-muted-foreground">· {tb.seats}</span>
                  <button type="button" className="rounded p-0.5 text-muted-foreground hover:text-destructive" aria-label={t('Remove {name}', { name: tb.name })}
                    onClick={() => void guard(async () => { await room.removeTable(tb.id); reload() })}><Trash2 className="size-3.5" /></button>
                </span>
              ))}
            </div>
            <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => {
              e.preventDefault()
              const n = Math.min(Math.max(parseInt(count[a.id] || '1', 10) || 1, 1), 50)
              const start = tables.length
              const names = Array.from({ length: n }, (_, i) => `${prefix}${start + i + 1}`)
              void guard(async () => { await room.addTables(a.id, names, Math.max(parseInt(seats[a.id] || '4', 10) || 4, 1), start); setCount((c) => ({ ...c, [a.id]: '' })); reload() })
            }}>
              <div className="grid gap-1"><Label htmlFor={`n-${a.id}`}>{t('How many tables')}</Label>
                <Input id={`n-${a.id}`} inputMode="numeric" className="h-9 w-24" value={count[a.id] ?? ''} onChange={(e) => setCount((c) => ({ ...c, [a.id]: e.target.value.replace(/\D/g, '') }))} placeholder="1" /></div>
              <div className="grid gap-1"><Label htmlFor={`s-${a.id}`}>{t('Seats')}</Label>
                <Input id={`s-${a.id}`} inputMode="numeric" className="h-9 w-20" value={seats[a.id] ?? ''} onChange={(e) => setSeats((c) => ({ ...c, [a.id]: e.target.value.replace(/\D/g, '') }))} placeholder="4" /></div>
              <Button type="submit" variant="outline" size="sm"><Plus /> {t('Add tables')}</Button>
              <span className="text-xs text-muted-foreground">{t('Named {a}, {b}…', { a: `${prefix}${tables.length + 1}`, b: `${prefix}${tables.length + 2}` })}</span>
            </form>
          </div>
        )
      })}
      <form className="flex items-end gap-2" onSubmit={(e) => {
        e.preventDefault()
        if (!newArea.trim()) return
        void guard(async () => { await room.addArea(warehouseId, newArea.trim(), (areas.data?.length ?? 0) + 1); setNewArea(''); reload() })
      }}>
        <div className="grid flex-1 gap-1"><Label htmlFor="new-area">{t('New room')}</Label><Input id="new-area" value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder={t('e.g. Hall, Terrace, Bar')} /></div>
        <Button type="submit" disabled={!newArea.trim()}><Plus /> {t('Add room')}</Button>
      </form>
    </div>
  )
}

function Stations({ warehouseId }: { warehouseId: string }) {
  const stations = useStations(warehouseId)
  const room = useSaveRoom()
  const categories = useCategories()
  const [name, setName] = React.useState('')
  const reload = () => void stations.refetch()
  const save = (s: Station, patch: Partial<Station>) => void guard(async () => { await room.saveStation({ ...s, ...patch, warehouse_id: warehouseId }); reload() })
  return (
    <div className="grid gap-4">
      <p className="text-[13px] text-muted-foreground">{t('Each item goes to the station of its category; everything else goes to the station marked "the rest". Open the kitchen screen on a tablet or TV in the kitchen and choose the station.')}</p>
      {(stations.data ?? []).map((s) => (
        <div key={s.id} className="rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Input defaultValue={s.name} className="h-9 max-w-xs font-medium" aria-label={t('Station name')} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) save(s, { name: v }) }} />
            <label className="ml-2 flex items-center gap-2 text-[13px]"><Switch checked={s.is_default} onCheckedChange={(on) => save(s, { is_default: on })} aria-label={t('The rest')} />{t('The rest')}</label>
            <Button variant="ghost" size="icon" className="ml-auto text-destructive" aria-label={t('Remove {name}', { name: s.name })}
              onClick={() => void guard(async () => { await room.removeStation(s.id); reload() })}><Trash2 /></Button>
          </div>
          <div className="mt-3 grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
            {(categories.data ?? []).map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={s.category_ids.includes(c.id)} onCheckedChange={(on) => save(s, { category_ids: on ? [...s.category_ids, c.id] : s.category_ids.filter((x) => x !== c.id) })} />{td(c.name)}
              </label>
            ))}
          </div>
        </div>
      ))}
      <form className="flex items-end gap-2" onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        void guard(async () => { await room.saveStation({ warehouse_id: warehouseId, name: name.trim(), category_ids: [], is_default: !(stations.data ?? []).some((x) => x.is_default) }); setName(''); reload() })
      }}>
        <div className="grid flex-1 gap-1"><Label htmlFor="new-st">{t('New station')}</Label><Input id="new-st" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Kitchen, Bar, Grill')} /></div>
        <Button type="submit" disabled={!name.trim()}><Plus /> {t('Add station')}</Button>
      </form>
    </div>
  )
}
