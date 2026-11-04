import type { ColumnDef } from '@tanstack/react-table'
import { ChevronRight, Factory, Layers, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable, inFilter } from '@/components/data-table/data-table'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ErrorState } from '@/components/error-state'
import { t, td } from '@/i18n'
import { cn, formatMoney, formatQty, num } from '@/lib/utils'
import { useVariantOptions } from '@/features/inventory/api'
import { useBom, useBomCost, useBomExplode, useBoms, useSaveBom, useWhereUsed, useWorkCenters, type BomDetail, type BomRow } from '../api'
import { NewWorkOrderDialog } from './work-orders-page'

export function BomsPage() {
  const navigate = useNavigate()
  const boms = useBoms()
  const cols = React.useMemo<ColumnDef<BomRow>[]>(() => [
    { accessorKey: 'code', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Recipe')} />, meta: { label: t('Recipe') },
      cell: ({ row: { original: b } }) => <span className="font-medium">{b.code}<span className="ml-1.5 text-xs font-normal text-muted-foreground">v{b.version}</span></span> },
    { id: 'product', accessorFn: (b) => b.variant?.name ?? '', header: ({ column }) => <ColumnHeader column={column} title={t('Makes')} />, meta: { label: t('Makes') },
      cell: ({ row: { original: b } }) => <span>{b.variant?.name} <span className="text-xs text-muted-foreground">{b.variant?.sku}</span></span> },
    { accessorKey: 'quantity', header: t('Batch'), meta: { label: t('Batch'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatQty(getValue() as number)}</span> },
    { id: 'lines', accessorFn: (b) => b.lines[0]?.count ?? 0, header: t('Components'), meta: { label: t('Components'), align: 'right' } },
    { id: 'ops', accessorFn: (b) => b.operations[0]?.count ?? 0, header: t('Steps'), meta: { label: t('Steps'), align: 'right' } },
    { accessorKey: 'bom_type', filterFn: inFilter, header: t('Type'), meta: { label: t('Type') }, cell: ({ getValue }) => (getValue() === 'kit' ? <Badge variant="secondary">{t('Kit')}</Badge> : t('Production')) },
    { id: 'state', accessorFn: (b) => (!b.is_active ? 'inactive' : b.is_default ? 'default' : 'alternative'), filterFn: inFilter, header: t('Use|column'), meta: { label: t('Use|column') },
      cell: ({ getValue }) => { const v = getValue() as string; return v === 'default' ? <Badge variant="success">{t('Default')}</Badge> : v === 'inactive' ? <Badge variant="secondary">{t('Inactive')}</Badge> : <Badge variant="outline">{t('Alternative')}</Badge> } },
  ], [])
  return (
    <>
      <PageHeader title={t('Recipes')} description={t('What each product is made of and how. An ingredient with its own recipe is a semi-finished product, so recipes can go several levels deep.')}
        actions={<Can perm="manufacturing.write"><Button asChild><Link to="/manufacturing/boms/new"><Plus /> {t('New recipe')}</Link></Button></Can>} />
      <DataTable tableKey="mfg.boms" columns={cols} data={boms.data} isLoading={boms.isLoading} error={boms.error} getRowId={(r) => r.id} exportName="boms"
        searchPlaceholder={t('Recipe code, product…')} onRowClick={(r) => navigate(`/manufacturing/boms/${r.id}`)}
        facets={[
          { columnId: 'bom_type', title: t('Type'), options: [{ value: 'manufacture', label: t('Production') }, { value: 'kit', label: t('Kit') }] },
          { columnId: 'state', title: t('Use|column'), options: [{ value: 'default', label: t('Default') }, { value: 'alternative', label: t('Alternative') }, { value: 'inactive', label: t('Inactive') }] },
        ]}
        empty={{ title: t('No recipes yet'), description: t('Start from the raw materials and work up: semi-finished products first, then the products made from them.') }} />
    </>
  )
}

export function BomPage() {
  const { id } = useParams()
  const bom = useBom(id)
  if (id && bom.isLoading) return <Skeleton className="mx-auto h-96 max-w-6xl" />
  if (id && bom.isError) return <ErrorState error={bom.error} onRetry={() => void bom.refetch()} />
  if (id && !bom.data) return <EmptyState icon={Layers} title={t('Recipe not found')} description={t('It may have been deleted.')} action={<Button variant="outline" asChild><Link to="/manufacturing/boms">{t('All recipes')}</Link></Button>} />
  return <BomEditor key={bom.data?.id ?? 'new'} bom={bom.data} />
}

type LineDraft = { key: string; component_variant_id: string | null; quantity: string; scrap_pct: string; is_optional: boolean }
type OpDraft = { key: string; sequence: string; name: string; work_center_id: string | null; setup_minutes: string; run_minutes_per_unit: string; instructions: string }
const key = () => crypto.randomUUID()

function BomEditor({ bom }: { bom?: BomDetail }) {
  const navigate = useNavigate()
  const { can } = useCompany()
  const variants = useVariantOptions()
  const centers = useWorkCenters()
  const save = useSaveBom()
  const editable = can('manufacturing.write')
  const [head, setHead] = React.useState(() => ({
    variant_id: bom?.variant_id ?? null as string | null, code: bom?.code ?? '', name: bom?.name ?? '', quantity: bom ? String(bom.quantity) : '1',
    version: bom ? String(bom.version) : '1', bom_type: bom?.bom_type ?? 'manufacture', is_default: bom?.is_default ?? true, is_active: bom?.is_active ?? true, notes: bom?.notes ?? '',
  }))
  const [lines, setLines] = React.useState<LineDraft[]>(() => (bom?.lines ?? []).sort((a, b) => a.line_no - b.line_no)
    .map((l) => ({ key: l.id, component_variant_id: l.component_variant_id, quantity: String(l.quantity), scrap_pct: String(l.scrap_pct || ''), is_optional: l.is_optional })))
  const [ops, setOps] = React.useState<OpDraft[]>(() => (bom?.operations ?? []).sort((a, b) => a.sequence - b.sequence)
    .map((o) => ({ key: o.id, sequence: String(o.sequence), name: o.name, work_center_id: o.work_center_id, setup_minutes: String(o.setup_minutes || ''),
                   run_minutes_per_unit: String(o.run_minutes_per_unit || ''), instructions: o.instructions ?? '' })))
  const [tab, setTab] = React.useState(bom ? 'structure' : 'edit')
  const [qty, setQty] = React.useState(bom ? String(bom.quantity) : '1')
  const [woOpen, setWoOpen] = React.useState(false)
  const setH = <K extends keyof typeof head>(k: K) => (v: (typeof head)[K]) => setHead((s) => ({ ...s, [k]: v }))
  const variantOptions = (variants.data ?? []).map((v) => ({ value: v.id, label: v.name, hint: v.sku }))
  const pickProduct = (v: string | null) => {
    const x = variants.data?.find((o) => o.id === v)
    setHead((s) => ({ ...s, variant_id: v, code: s.code || (x ? `BOM-${x.sku}` : ''), name: s.name || (x?.name ?? '') }))
  }
  const valid = head.variant_id && head.code.trim() && head.name.trim() && num(head.quantity) > 0 && lines.length > 0
    && lines.every((l) => l.component_variant_id && num(l.quantity) > 0 && l.component_variant_id !== head.variant_id)
    && ops.every((o) => o.name.trim() && o.work_center_id && num(o.sequence) > 0)
    && new Set(ops.map((o) => num(o.sequence))).size === ops.length

  const persist = async () => {
    const id = await save.mutateAsync({
      header: { id: bom?.id, variant_id: head.variant_id, code: head.code.trim(), name: head.name.trim(), quantity: num(head.quantity), version: Math.max(1, Math.round(num(head.version))),
                bom_type: head.bom_type, is_default: head.is_default, is_active: head.is_active, notes: head.notes || null },
      lines: lines.map((l, i) => ({ line_no: i + 1, component_variant_id: l.component_variant_id, quantity: num(l.quantity), scrap_pct: num(l.scrap_pct), is_optional: l.is_optional })),
      operations: ops.map((o) => ({ sequence: Math.round(num(o.sequence)), name: o.name.trim(), work_center_id: o.work_center_id, setup_minutes: num(o.setup_minutes),
                                    run_minutes_per_unit: num(o.run_minutes_per_unit), instructions: o.instructions || null })),
    })
    toast.success(t('Recipe saved'))
    if (!bom) navigate(`/manufacturing/boms/${id}`, { replace: true })
  }

  const editor = (
    <div className="grid gap-4">
      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-4">
          <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Makes')}</Label>
            <SearchSelect value={head.variant_id} onChange={pickProduct} options={variantOptions} disabled={!editable || !!bom} placeholder={t('Finished or semi-finished product')} /></div>
          <div className="grid gap-1.5"><Label htmlFor="b-code">{t('Code')}</Label><Input id="b-code" value={head.code} disabled={!editable} onChange={(e) => setH('code')(e.target.value.toUpperCase())} /></div>
          <div className="grid gap-1.5"><Label htmlFor="b-ver">{t('Version')}</Label><Input id="b-ver" inputMode="numeric" value={head.version} disabled={!editable} onChange={(e) => setH('version')(e.target.value)} /></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="b-name">{t('Name')}</Label><Input id="b-name" value={head.name} disabled={!editable} onChange={(e) => setH('name')(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="b-qty">{t('Batch quantity')}</Label><Input id="b-qty" inputMode="decimal" className="text-right tabular" value={head.quantity} disabled={!editable} onChange={(e) => setH('quantity')(e.target.value.replace(',', '.'))} /></div>
          <div className="grid gap-1.5"><Label>{t('Type')}</Label>
            <Select value={head.bom_type} onValueChange={setH('bom_type')} disabled={!editable}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="manufacture">{t('Production')}</SelectItem><SelectItem value="kit">{t('Kit or recipe: its parts leave stock when it is sold')}</SelectItem></SelectContent></Select></div>
          <div className="flex items-center justify-between gap-2 sm:col-span-2"><Label htmlFor="b-def">{t('Main recipe for this product')}</Label><Switch id="b-def" checked={head.is_default} disabled={!editable} onCheckedChange={setH('is_default')} /></div>
          <div className="flex items-center justify-between gap-2 sm:col-span-2"><Label htmlFor="b-act">{t('Active')}</Label><Switch id="b-act" checked={head.is_active} disabled={!editable} onCheckedChange={setH('is_active')} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
          <div><CardTitle>{t('Components')}</CardTitle><CardDescription>{t('Quantities are for one batch of {qty}. Waste % adds the expected loss on top.', { qty: formatQty(num(head.quantity) || 1) })}</CardDescription></div>
          {editable && <Button size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, { key: key(), component_variant_id: null, quantity: '1', scrap_pct: '', is_optional: false }])}><Plus /> {t('Add component')}</Button>}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-10">#</TableHead><TableHead>{t('Component')}</TableHead><TableHead className="w-32 text-right">{t('Quantity')}</TableHead>
              <TableHead className="w-28 text-right">{t('Waste %')}</TableHead><TableHead className="w-24">{t('Optional')}</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={l.key} className="hover:bg-transparent">
                  <TableCell className="text-muted-foreground tabular">{i + 1}</TableCell>
                  <TableCell><SearchSelect value={l.component_variant_id} disabled={!editable} options={variantOptions.filter((o) => o.value !== head.variant_id)} placeholder={t('Material or semi-finished product')}
                    onChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, component_variant_id: v } : x)))} /></TableCell>
                  <TableCell><Input aria-label={t('Quantity')} inputMode="decimal" className="text-right tabular" value={l.quantity} disabled={!editable} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value.replace(',', '.') } : x)))} /></TableCell>
                  <TableCell><Input aria-label={t('Waste %')} inputMode="decimal" className="text-right tabular" value={l.scrap_pct} placeholder="0" disabled={!editable} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, scrap_pct: e.target.value.replace(',', '.') } : x)))} /></TableCell>
                  <TableCell><Switch checked={l.is_optional} disabled={!editable} onCheckedChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, is_optional: v } : x)))} aria-label={t('Optional')} /></TableCell>
                  <TableCell>{editable && <Button size="icon" variant="ghost" className="size-8" aria-label={t('Remove')} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 /></Button>}</TableCell>
                </TableRow>
              ))}
              {!lines.length && <TableRow><TableCell colSpan={6} className="py-6 text-center text-[13px] text-muted-foreground">{t('Add the materials and semi-finished products one batch needs.')}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
          <div><CardTitle>{t('Steps')}</CardTitle><CardDescription>{t('Labour and overhead come from each work center\'s hourly rates. Time per unit is for each unit produced.')}</CardDescription></div>
          {editable && <Button size="sm" variant="outline" disabled={!centers.data?.length}
            onClick={() => setOps((os) => [...os, { key: key(), sequence: String((os.length + 1) * 10), name: '', work_center_id: centers.data?.[0]?.id ?? null, setup_minutes: '', run_minutes_per_unit: '', instructions: '' }])}><Plus /> {t('Add step')}</Button>}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead className="w-20">{t('Order|sequence')}</TableHead><TableHead>{t('Step')}</TableHead><TableHead className="w-48">{t('Work center')}</TableHead>
              <TableHead className="w-28 text-right">{t('Setup min')}</TableHead><TableHead className="w-32 text-right">{t('Min per unit')}</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {ops.map((o) => (
                <TableRow key={o.key} className="hover:bg-transparent">
                  <TableCell><Input aria-label={t('Order|sequence')} inputMode="numeric" className="tabular" value={o.sequence} disabled={!editable} onChange={(e) => setOps((os) => os.map((x) => (x.key === o.key ? { ...x, sequence: e.target.value } : x)))} /></TableCell>
                  <TableCell><Input aria-label={t('Step name')} value={o.name} placeholder={t('e.g. Roasting')} disabled={!editable} onChange={(e) => setOps((os) => os.map((x) => (x.key === o.key ? { ...x, name: e.target.value } : x)))} /></TableCell>
                  <TableCell><Select value={o.work_center_id ?? ''} disabled={!editable} onValueChange={(v) => setOps((os) => os.map((x) => (x.key === o.key ? { ...x, work_center_id: v } : x)))}>
                    <SelectTrigger><SelectValue placeholder={t('Work center')} /></SelectTrigger>
                    <SelectContent>{(centers.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.code} · {td(c.name)}</SelectItem>)}</SelectContent></Select></TableCell>
                  <TableCell><Input aria-label={t('Setup minutes')} inputMode="decimal" className="text-right tabular" value={o.setup_minutes} placeholder="0" disabled={!editable} onChange={(e) => setOps((os) => os.map((x) => (x.key === o.key ? { ...x, setup_minutes: e.target.value.replace(',', '.') } : x)))} /></TableCell>
                  <TableCell><Input aria-label={t('Minutes per unit')} inputMode="decimal" className="text-right tabular" value={o.run_minutes_per_unit} placeholder="0" disabled={!editable} onChange={(e) => setOps((os) => os.map((x) => (x.key === o.key ? { ...x, run_minutes_per_unit: e.target.value.replace(',', '.') } : x)))} /></TableCell>
                  <TableCell>{editable && <Button size="icon" variant="ghost" className="size-8" aria-label={t('Remove')} onClick={() => setOps((os) => os.filter((x) => x.key !== o.key))}><Trash2 /></Button>}</TableCell>
                </TableRow>
              ))}
              {!ops.length && <TableRow><TableCell colSpan={6} className="py-6 text-center text-[13px] text-muted-foreground">{centers.data?.length ? t('No steps: the product is put together without recorded time.') : <>{t('Create a work center first to add steps.')} <Link to="/manufacturing/work-centers" className="text-primary hover:underline">{t('Work centers')}</Link></>}</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )

  return (
    <div className="w-full">
      <PageHeader back={{ href: '/manufacturing/boms', label: t('Recipes') }}
        title={bom ? <>{bom.code} <span className="text-base font-normal text-muted-foreground">v{bom.version}</span></> : t('New recipe')}
        meta={bom && <>{bom.bom_type === 'kit' ? <Badge variant="secondary">{t('Kit')}</Badge> : null}{bom.is_default ? <Badge variant="success">{t('Default')}</Badge> : null}{!bom.is_active ? <Badge variant="secondary">{t('Inactive')}</Badge> : null}</>}
        description={bom ? t('{product} · batch of {qty}', { product: bom.variant?.name ?? '', qty: formatQty(bom.quantity) }) : t('Choose the product, then list its components and the steps that make it.')}
        actions={<>
          {bom && bom.bom_type === 'manufacture' && <Can perm="manufacturing.write"><Button variant="outline" onClick={() => setWoOpen(true)}><Factory /> {t('New work order')}</Button></Can>}
          {editable && (tab === 'edit' || !bom) && <Button loading={save.isPending} disabled={!valid} onClick={() => void persist()}>{t('Save recipe')}</Button>}
        </>} />
      {bom ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList><TabsTrigger value="structure">{t('Structure')}</TabsTrigger><TabsTrigger value="cost">{t('Cost')}</TabsTrigger><TabsTrigger value="edit">{t('Components and steps')}</TabsTrigger><TabsTrigger value="used">{t('Where used')}</TabsTrigger></TabsList>
          <TabsContent value="structure"><Structure bom={bom} qty={qty} setQty={setQty} /></TabsContent>
          <TabsContent value="cost"><CostView bom={bom} qty={qty} setQty={setQty} /></TabsContent>
          <TabsContent value="edit">{editor}</TabsContent>
          <TabsContent value="used"><WhereUsed variantId={bom.variant_id} /></TabsContent>
        </Tabs>
      ) : editor}
      {bom && woOpen && <NewWorkOrderDialog onClose={() => setWoOpen(false)} initialBom={bom.id} />}
    </div>
  )
}

function QtyBar({ qty, setQty, unit }: { qty: string; setQty: (v: string) => void; unit?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[13px]">
      <Label htmlFor="exp-qty" className="text-muted-foreground">{t('For')}</Label>
      <Input id="exp-qty" inputMode="decimal" className="h-8 w-24 text-right tabular" value={qty} onChange={(e) => setQty(e.target.value.replace(',', '.'))} />
      <span className="text-muted-foreground">{unit ?? t('units')}</span>
    </div>
  )
}

function Structure({ bom, qty, setQty }: { bom: BomDetail; qty: string; setQty: (v: string) => void }) {
  const rows = useBomExplode(bom.id, num(qty))
  const leaves = (rows.data ?? []).filter((r) => !r.sub_bom_id)
  const total = leaves.reduce((s, r) => s + num(r.ext_cost), 0)
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle>{t('All levels')}</CardTitle>
        <CardDescription>{t('Every level down to the raw materials. Semi-finished products are made from their own recipe; their ingredients are indented underneath. Stock is across all warehouses.')}</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <div className="px-4"><QtyBar qty={qty} setQty={setQty} /></div>
        {rows.isLoading ? <Skeleton className="m-4 h-40" /> : rows.isError ? <ErrorState compact error={rows.error} onRetry={() => void rows.refetch()} /> : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Component')}</TableHead><TableHead className="text-right">{t('Per batch')}</TableHead><TableHead className="text-right">{t('Needed')}</TableHead>
              <TableHead className="text-right">{t('Available')}</TableHead><TableHead className="text-right">{t('Unit cost (without VAT)')}</TableHead><TableHead className="text-right">{t('Cost (without VAT)')}</TableHead></TableRow></TableHeader>
            <TableBody>
              {(rows.data ?? []).map((r) => {
                const short = !r.sub_bom_id && num(r.available) < num(r.quantity)
                return (
                  <TableRow key={r.path} className="hover:bg-transparent">
                    <TableCell>
                      <div className="flex items-center gap-1.5" style={{ paddingLeft: (r.depth - 1) * 22 }}>
                        {r.depth > 1 && <ChevronRight className="size-3.5 text-muted-foreground/60" />}
                        {r.sub_bom_id ? <Layers className="size-4 text-primary" aria-label={t('Semi-finished product')} /> : null}
                        <span className={cn(r.sub_bom_id && 'font-medium')}>{r.name}</span>
                        <span className="text-xs text-muted-foreground">{r.sku}</span>
                        {r.sub_bom_id && <Link to={`/manufacturing/boms/${r.sub_bom_id}`} className="text-xs text-primary hover:underline">{t('Recipe')}</Link>}
                        {num(r.scrap_pct) > 0 && <span className="text-xs text-muted-foreground">{t('+{pct}% waste', { pct: num(r.scrap_pct) })}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{formatQty(r.qty_per)}</TableCell>
                    <TableCell className="text-right tabular font-medium">{formatQty(r.quantity)} <span className="text-xs font-normal text-muted-foreground">{td(r.uom)}</span></TableCell>
                    <TableCell className={cn('text-right tabular', short && 'text-destructive')}>{formatQty(r.available)}</TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">{r.sub_bom_id ? '—' : formatMoney(r.unit_cost)}</TableCell>
                    <TableCell className="text-right tabular">{r.sub_bom_id ? <span className="text-xs text-muted-foreground">{t('from its parts')}</span> : formatMoney(r.ext_cost)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
            <TableFooter><TableRow className="hover:bg-transparent"><TableCell colSpan={5} className="text-right font-medium">{t('Materials at current cost, without VAT')}</TableCell><TableCell className="text-right tabular font-semibold">{formatMoney(total)}</TableCell></TableRow></TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function CostView({ bom, qty, setQty }: { bom: BomDetail; qty: string; setQty: (v: string) => void }) {
  const cost = useBomCost(bom.id, num(qty))
  const c = cost.data
  const parts = c ? [{ k: t('Materials'), v: num(c.material) }, { k: t('Labour'), v: num(c.labor) }, { k: t('Overhead'), v: num(c.overhead) }] : []
  return (
    <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader className="pb-2"><CardTitle>{t('Cost breakdown (without VAT)')}</CardTitle><CardDescription>{t('Materials at their current average cost; semi-finished products are costed from their own recipes, including their steps.')}</CardDescription></CardHeader>
        <CardContent>
          <QtyBar qty={qty} setQty={setQty} />
          {cost.isError ? <ErrorState compact error={cost.error} onRetry={() => void cost.refetch()} /> : !c ? <Skeleton className="h-40" /> : <>
            <div className="mb-4 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
              {parts.map((p, i) => <div key={p.k} style={{ width: `${(p.v / Math.max(num(c.total), 1)) * 100}%` }} className={cn(i === 0 ? 'bg-primary' : i === 1 ? 'bg-primary/60' : 'bg-primary/30')} />)}
            </div>
            <div className="grid gap-2 text-[13px]">
              {parts.map((p, i) => (
                <div key={p.k} className="flex items-center justify-between"><span className="flex items-center gap-2"><span className={cn('size-2.5 rounded-full', i === 0 ? 'bg-primary' : i === 1 ? 'bg-primary/60' : 'bg-primary/30')} />{p.k}</span>
                  <span className="tabular">{formatMoney(p.v)} <span className="text-muted-foreground">({num(c.total) ? ((p.v / num(c.total)) * 100).toFixed(0) : 0}%)</span></span></div>
              ))}
              <div className="mt-1 flex justify-between border-t pt-2 font-semibold"><span>{t('Total for {qty}', { qty: formatQty(num(c.quantity)) })}</span><span className="tabular">{formatMoney(c.total)}</span></div>
            </div>
          </>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle>{t('Cost per unit (without VAT)')}</CardTitle></CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold tracking-[-0.02em] tabular">{c ? formatMoney(c.unit) : '—'}</div>
          <div className="mt-4 grid gap-1.5 text-[13px]">
            {(c?.operations ?? []).map((o) => (
              <div key={o.sequence} className="flex justify-between gap-2"><span><span className="tabular text-muted-foreground">{o.sequence}</span> {o.name} · {td(o.work_center)}</span>
                <span className="tabular text-muted-foreground">{t('{n} min', { n: formatQty(o.minutes) })}</span></div>
            ))}
            {c && !c.operations.length && <p className="text-muted-foreground">{t('This recipe has no steps of its own.')}</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function WhereUsed({ variantId }: { variantId: string }) {
  const q = useWhereUsed(variantId)
  if (q.isLoading) return <Skeleton className="h-32" />
  if (q.isError) return <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
  if (!q.data?.length) return <EmptyState icon={Layers} title={t('Not used in another recipe')} description={t('This product is only made, not used as an ingredient.')} />
  return (
    <Card><CardContent className="p-0"><Table>
      <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Used in')}</TableHead><TableHead>{t('Recipe')}</TableHead><TableHead className="text-right">{t('Quantity per batch')}</TableHead></TableRow></TableHeader>
      <TableBody>{q.data.map((r) => (
        <TableRow key={r.bom_id} className="hover:bg-transparent"><TableCell>{r.name} <span className="text-xs text-muted-foreground">{r.sku}</span></TableCell>
          <TableCell><Link to={`/manufacturing/boms/${r.bom_id}`} className="text-primary hover:underline">{r.bom_code}</Link></TableCell>
          <TableCell className="text-right tabular">{t('{a} per {b}', { a: formatQty(r.quantity), b: formatQty(r.bom_quantity) })}</TableCell></TableRow>
      ))}</TableBody>
    </Table></CardContent></Card>
  )
}
