import { Pencil, Plus, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { z } from 'zod'
import { Can, useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SimpleFormDialog } from '@/components/simple-form-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatQty } from '@/lib/utils'
import { useAttributes, useCategories, useMasterData, useUnits } from '../api'
import { msg, t, td, tEnum } from '@/i18n'
import { ErrorState } from '@/components/error-state'
import { Skeleton } from '@/components/ui/skeleton'

export function SetupPage() {
  return (
    <>
      <PageHeader title={t('Inventory setup')} description={t('Categories group products for reporting and accounting. Units define how you count. Attributes build variants.')} />
      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">{t('Categories')}</TabsTrigger>
          <TabsTrigger value="units">{t('Units of measure')}</TabsTrigger>
          <TabsTrigger value="attributes">{t('Variant attributes')}</TabsTrigger>
        </TabsList>
        <TabsContent value="categories"><Categories /></TabsContent>
        <TabsContent value="units"><Units /></TabsContent>
        <TabsContent value="attributes"><Attributes /></TabsContent>
      </Tabs>
    </>
  )
}

/** Skeleton while loading, an error with a retry when loading failed, otherwise null */
function loadState(q: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }) {
  if (q.isLoading) return <Skeleton className="m-4 h-24" />
  if (q.isError) return <ErrorState compact error={q.error} onRetry={() => void q.refetch()} />
  return null
}

const categorySchema = z.object({
  name: z.string().trim().min(2, msg('Enter a name')),
  code: z.string().trim().max(20).optional(),
  parent_id: z.string().uuid().nullable().optional(),
  perishable: z.boolean().optional(),
})

function Categories() {
  const cats = useCategories()
  const m = useMasterData('product_categories')
  const byId = new Map((cats.data ?? []).map((c) => [c.id, c]))
  const fields = [
    { name: 'name' as const, label: t('Name'), placeholder: t('Beverages') },
    { name: 'code' as const, label: t('Code'), optional: true, half: true, uppercase: true },
    { name: 'parent_id' as const, label: t('Parent'), type: 'select' as const, optional: true, half: true, options: [{ value: '__none', label: t('None') }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: td(c.name) }))] },
    // fruit and vegetables: thrown away when they go off; the waste report and the Zebra start from these groups
    { name: 'perishable' as const, label: t('Goes off quickly (fruit, vegetables)'), type: 'switch' as const },
  ]
  const path = (id: string | null): string => {
    const c = id ? byId.get(id) : undefined
    return c ? (c.parent_id ? `${path(c.parent_id)} / ${td(c.name)}` : td(c.name)) : ''
  }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div><CardTitle>{t('Product categories')}</CardTitle><CardDescription>{t('Group products for reports, price lists and searching.')}</CardDescription></div>
        <Can perm="inventory.write">
          <SimpleFormDialog trigger={<Button size="sm"><Plus /> {t('New category')}</Button>} title={t('New category')} schema={categorySchema}
            defaultValues={{ name: '', code: '', parent_id: null, perishable: false }} fields={fields} submitLabel={t('Create category')}
            onSubmit={({ perishable, ...v }) => m.create.mutateAsync({ ...v, code: v.code || null, parent_id: v.parent_id ?? null, ...(perishable ? { perishable } : {}) })} />
        </Can>
      </CardHeader>
      <CardContent className="p-0">
        {loadState(cats) ?? (!cats.data?.length ? <EmptyState compact title={t('No categories')} description={t('Examples: Apparel, Beverages, Raw materials.')} /> : (
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Category')}</TableHead><TableHead>{t('Code')}</TableHead><TableHead>{t('Goes off')}</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
            <TableBody>
              {[...cats.data].sort((a, b) => path(a.id).localeCompare(path(b.id))).map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{path(c.id)}</TableCell>
                  <TableCell className="text-muted-foreground">{c.code ?? '—'}</TableCell>
                  <TableCell>{(c as { perishable?: boolean }).perishable ? <Badge variant="secondary">{t('Goes off quickly')}</Badge> : null}</TableCell>
                  <TableCell className="whitespace-nowrap text-right"><Can perm="inventory.write">
                    <SimpleFormDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={t('Edit {name}', { name: td(c.name) })}><Pencil /></Button>} title={t('Edit {name}', { name: td(c.name) })} schema={categorySchema}
                      defaultValues={{ name: c.name, code: c.code ?? '', parent_id: c.parent_id, perishable: !!(c as { perishable?: boolean }).perishable }} fields={fields} submitLabel={t('Save')}
                      onSubmit={({ perishable, ...v }) => m.update.mutateAsync({ id: c.id, ...v, code: v.code || null, parent_id: v.parent_id === c.id ? null : v.parent_id ?? null,
                        ...(!!perishable !== !!(c as { perishable?: boolean }).perishable ? { perishable: !!perishable } : {}) })} />
                    <ConfirmDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={t('Delete {name}', { name: td(c.name) })}><Trash2 /></Button>} title={t('Delete {name}?', { name: td(c.name) })}
                      description={t('Products in this category become uncategorised.')} confirmLabel={t('Delete category')} destructive onConfirm={() => m.remove.mutateAsync(c.id)} />
                  </Can></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
      </CardContent>
    </Card>
  )
}

const unitSchema = z.object({
  code: z.string().trim().min(1, msg('Enter a code')).max(12),
  name: z.string().trim().min(1, msg('Enter a name')),
  category: z.enum(['unit', 'weight', 'volume', 'length', 'area', 'time']),
  ratio: z.coerce.number().positive(msg('Must be above 0')),
  is_active: z.boolean(),
})

function Units() {
  const units = useUnits()
  const m = useMasterData('units_of_measure')
  const refOf = (cat: string) => units.data?.find((u) => u.category === cat && u.is_reference)?.code
  const fields = [
    { name: 'code' as const, label: t('Code'), half: true, placeholder: t('pack6') },
    { name: 'category' as const, label: t('Measures'), type: 'select' as const, half: true, options: ['unit', 'weight', 'volume', 'length', 'area', 'time'].map((c) => ({ value: c, label: tEnum(`uom_${c}`) })) },
    { name: 'name' as const, label: t('Name'), placeholder: t('Pack of 6') },
    { name: 'ratio' as const, label: t('Size relative to the reference unit'), type: 'number' as const, description: t('e.g. 6 for a pack of six pieces, 0.001 for grams.') },
    { name: 'is_active' as const, label: t('Active'), type: 'switch' as const },
  ]
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div><CardTitle>{t('Units of measure')}</CardTitle><CardDescription>{t('Each group has one reference unit; others convert to it by ratio.')}</CardDescription></div>
        <Can perm="inventory.write">
          <SimpleFormDialog trigger={<Button size="sm"><Plus /> {t('New unit')}</Button>} title={t('New unit')} schema={unitSchema}
            defaultValues={{ code: '', name: '', category: 'unit', ratio: 1, is_active: true }} fields={fields} submitLabel={t('Create unit')}
            onSubmit={(v) => m.create.mutateAsync(v)} />
        </Can>
      </CardHeader>
      <CardContent className="p-0">
        {loadState(units) ?? <Table>
          <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Unit')}</TableHead><TableHead>{t('Measures')}</TableHead><TableHead className="text-right">{t('Conversion')}</TableHead><TableHead className="w-24" /></TableRow></TableHeader>
          <TableBody>
            {(units.data ?? []).map((u) => (
              <TableRow key={u.id}>
                <TableCell><span className="font-medium">{u.name}</span> <span className="text-muted-foreground">({u.code})</span> {u.is_reference && <Badge variant="secondary">{t('Reference')}</Badge>} {!u.is_active && <Badge variant="outline">{t('Inactive')}</Badge>}</TableCell>
                <TableCell>{tEnum(`uom_${u.category}`)}</TableCell>
                <TableCell className="text-right tabular text-[13px]">{u.is_reference ? '—' : `1 ${u.code} = ${formatQty(u.ratio)} ${refOf(u.category) ?? ''}`}</TableCell>
                <TableCell className="whitespace-nowrap text-right"><Can perm="inventory.write">
                  {!u.is_reference && (
                    <SimpleFormDialog trigger={<Button variant="ghost" size="icon-sm" aria-label={t('Edit {name}', { name: td(u.name) })}><Pencil /></Button>} title={t('Edit {name}', { name: td(u.name) })} schema={unitSchema}
                      defaultValues={{ code: u.code, name: u.name, category: u.category as 'unit', ratio: u.ratio, is_active: u.is_active }} fields={fields} submitLabel={t('Save')}
                      onSubmit={(v) => m.update.mutateAsync({ id: u.id, ...v })} />
                  )}
                </Can></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>}
      </CardContent>
    </Card>
  )
}

function Attributes() {
  const { can } = useCompany()
  const attrs = useAttributes()
  const ma = useMasterData('product_attributes')
  const mv = useMasterData('product_attribute_values')
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const editable = can('inventory.write')
  const schema = z.object({ name: z.string().trim().min(1, msg('Enter a name')), display_type: z.enum(['select', 'color', 'pills']) })
  const addValue = (attributeId: string, sortOrder: number) => {
    const value = drafts[attributeId]?.trim()
    if (!value) return
    mv.create.mutate({ attribute_id: attributeId, value, sort_order: sortOrder }, { onSuccess: () => setDrafts((d) => ({ ...d, [attributeId]: '' })) })
  }
  return (
    <div className="grid gap-3">
      <div className="flex justify-between">
        <p className="text-[13px] text-muted-foreground">{t('Attributes like size and colour generate one SKU per combination when you create a product.')}</p>
        <Can perm="inventory.write">
          <SimpleFormDialog trigger={<Button size="sm"><Plus /> {t('New attribute')}</Button>} title={t('New attribute')} schema={schema}
            defaultValues={{ name: '', display_type: 'select' }} submitLabel={t('Create attribute')}
            fields={[{ name: 'name', label: t('Name'), placeholder: t('Size') }, { name: 'display_type', label: t('Shown as'), type: 'select', options: [{ value: 'select', label: t('List') }, { value: 'pills', label: t('Buttons') }, { value: 'color', label: t('Colour swatches') }] }]}
            onSubmit={(v) => ma.create.mutateAsync({ ...v, sort_order: (attrs.data?.length ?? 0) + 1 })} />
        </Can>
      </div>
      {loadState(attrs) && <Card>{loadState(attrs)}</Card>}
      {attrs.data?.length === 0 && <Card><EmptyState compact title={t('No attributes')} description={t('Add Size with S, M, L, XL — or Flavour, Capacity, Material.')} /></Card>}
      {attrs.data?.map((a) => {
        const values = a.product_attribute_values.filter((v) => !v.deleted_at).sort((x, y) => x.sort_order - y.sort_order)
        return (
          <Card key={a.id}>
            <CardContent className="flex flex-wrap items-center gap-2 p-4">
              <span className="w-28 text-sm font-medium">{a.name}</span>
              {values.map((v) => (
                <Badge key={v.id} variant="outline" className="gap-1.5 py-1 text-[13px]">
                  {a.display_type === 'color' && <span className="size-3 rounded-full border" style={{ background: v.color_hex ?? 'transparent' }} />}
                  {v.value}
                  {editable && <button onClick={() => mv.remove.mutate(v.id)} aria-label={t('Remove {name}', { name: v.value })} className="hover:text-destructive"><X className="size-3" /></button>}
                </Badge>
              ))}
              {editable && (
                <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); addValue(a.id, values.length + 1) }}>
                  <Input className="h-7 w-32 text-[13px]" placeholder={t('Add value')} value={drafts[a.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [a.id]: e.target.value })} aria-label={t('New value for {name}', { name: a.name })} />
                  <Button size="xs" variant="ghost" type="submit" disabled={!drafts[a.id]?.trim()}><Plus /></Button>
                </form>
              )}
              {editable && (
                <ConfirmDialog trigger={<Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={t('Delete {name}', { name: a.name })}><Trash2 /></Button>}
                  title={t('Delete {name}?', { name: a.name })} description={t('Existing variants keep their names; the attribute just can\'t be used for new products.')} confirmLabel={t('Delete attribute')} destructive
                  onConfirm={() => ma.remove.mutateAsync(a.id)} />
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
