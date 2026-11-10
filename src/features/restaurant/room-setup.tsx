import { categoryTreeOptions } from '@/features/inventory/components/category-picks'
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
import { t, tn } from '@/i18n'
import { cn } from '@/lib/utils'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { useCategories } from '@/features/inventory/api'
import { type Station, useSaveRoom, useStations } from './api'
import { desktop } from '@/lib/desktop'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FloorPlanEditor } from './floor-plan'

type AreaRow = { id: string; name: string; sort_order: number; tables: { id: string; name: string; seats: number; sort_order: number; is_active: boolean; deleted_at: string | null; pos_x: number | null; pos_y: number | null; shape: string }[] }

/** Rooms, tables and where orders go (kitchen, bar). Managers only. */
export function RoomSetupDialog({ warehouseId, onClose }: { warehouseId: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{t('Set up the room')}</DialogTitle>
          <DialogDescription>{t('Rooms and tables of this place, and the kitchen and bar screens that receive the orders.')}</DialogDescription></DialogHeader>
        <Tabs defaultValue="tables">
          <TabsList><TabsTrigger value="tables">{t('Rooms and tables')}</TabsTrigger><TabsTrigger value="plan">{t('Floor plan')}</TabsTrigger><TabsTrigger value="stations">{t('Kitchen and bar')}</TabsTrigger></TabsList>
          <TabsContent value="tables" className="mt-4"><Tables warehouseId={warehouseId} /></TabsContent>
          <TabsContent value="plan" className="mt-4"><Plan warehouseId={warehouseId} /></TabsContent>
          <TabsContent value="stations" className="mt-4"><Stations warehouseId={warehouseId} /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

const guard = async (fn: () => Promise<void>) => { try { await fn() } catch (e) { toast.error(describeError(e)) } }

function useAreas(warehouseId: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['restaurant', companyId, 'areas', warehouseId],
    queryFn: async () => unwrap(await supabase.from('restaurant_areas').select('id, name, sort_order, tables:restaurant_tables(id, name, seats, sort_order, is_active, deleted_at, pos_x, pos_y, shape)')
      .eq('warehouse_id', warehouseId).is('deleted_at', null).order('sort_order')) as unknown as AreaRow[],
  })
}

/** Where the tables stand, room by room. */
function Plan({ warehouseId }: { warehouseId: string }) {
  const areas = useAreas(warehouseId)
  const room = useSaveRoom()
  const [areaId, setAreaId] = React.useState<string | null>(null)
  const list = areas.data ?? []
  const area = list.find((a) => a.id === areaId) ?? list[0]
  if (!area) return <p className="text-[13px] text-muted-foreground">{t('Add a room and its tables first.')}</p>
  const tables = area.tables.filter((x) => !x.deleted_at && x.is_active).map((x) => ({ id: x.id, name: x.name, seats: x.seats, x: x.pos_x, y: x.pos_y, shape: x.shape }))
  return (
    <div className="grid gap-3">
      {list.length > 1 && (
        <div className="flex flex-wrap gap-1.5">{list.map((a) => <Button key={a.id} size="sm" variant={a.id === area.id ? 'default' : 'outline'} onClick={() => setAreaId(a.id)}>{a.name}</Button>)}</div>
      )}
      <FloorPlanEditor key={area.id} tables={tables} onSave={(id, v) => guard(async () => { await room.updateTable(id, v); void areas.refetch() })} />
    </div>
  )
}

function Tables({ warehouseId }: { warehouseId: string }) {
  const room = useSaveRoom()
  const areas = useAreas(warehouseId)
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
  // the printers of this computer (the Windows program only)
  const [printers, setPrinters] = React.useState<{ name: string }[]>([])
  React.useEffect(() => { if (desktop) void desktop.printers().then(setPrinters).catch(() => setPrinters([])) }, [])
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
            {s.whole_order !== undefined && <label className="ml-2 flex items-center gap-2 text-[13px]" title={t('Gets every item of the order, e.g. the bar; the other stations only their own')}>
              <Switch checked={!!s.whole_order} onCheckedChange={(on) => save(s, { whole_order: on })} aria-label={t('The whole order')} />{t('The whole order')}</label>}
            <Button variant="ghost" size="icon" className="ml-auto text-destructive" aria-label={t('Remove {name}', { name: s.name })}
              onClick={() => void guard(async () => { await room.removeStation(s.id); reload() })}><Trash2 /></Button>
          </div>
          {s.printer !== undefined && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-muted-foreground">{t('Printer')}:</span>
              {printers.length ? (
                <Select value={s.printer ?? '__none'} onValueChange={(v) => save(s, { printer: v === '__none' ? null : v })}>
                  <SelectTrigger className="h-8 w-64" aria-label={t('Printer')}><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="__none">{t('The kitchen printer of the program')}</SelectItem>
                    {printers.map((p) => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                    {s.printer && !printers.some((p) => p.name === s.printer) && <SelectItem value={s.printer}>{s.printer}</SelectItem>}</SelectContent>
                </Select>
              ) : (
                <Input defaultValue={s.printer ?? ''} className="h-8 w-64" placeholder={t('The printer\'s name in Windows')} aria-label={t('Printer')}
                  onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (s.printer ?? null)) save(s, { printer: v }) }} />
              )}
              <span className="text-[12px] text-muted-foreground">{t('In the Windows program the ticket goes straight to it.')}</span>
            </div>
          )}
          <div className="mt-3 grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
            {categoryTreeOptions(categories.data ?? []).map((c) => (
              <label key={c.value} className={cn('flex items-center gap-2 text-[13px]', c.indent && 'pl-4 text-muted-foreground')}>
                <Checkbox checked={s.category_ids.includes(c.value)} onCheckedChange={(on) => save(s, { category_ids: on ? [...s.category_ids, c.value] : s.category_ids.filter((x) => x !== c.value) })} />{c.label}
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
