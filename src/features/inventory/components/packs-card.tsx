import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Boxes, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t, td } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { usePacks, type Pack } from '@/lib/packs'
import { supabase } from '@/lib/supabase'
import { formatMoney, formatQty, num } from '@/lib/utils'

/** Product › Packaging: box = 24 pieces, crate = 12, pallet = 960. Documents can then be filled in by the box. */
export function PacksCard({ product }: { product: { id: string; sales_price: number | null; uom_code?: string | null } }) {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const { packs, isLoading } = usePacks()
  const mine = packs.filter((k) => k.product_id === product.id)
  const editable = can('inventory.write')
  const [edit, setEdit] = React.useState<Partial<Pack> | null>(null)
  const pieces = product.uom_code ? td(product.uom_code) : t('pieces')
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['packs'] }), qc.invalidateQueries({ queryKey: ['inv'] })])

  const save = useMutation({
    mutationFn: async (k: Partial<Pack>) => {
      const row = { name: (k.name ?? '').trim(), factor: num(k.factor), barcode: k.barcode?.trim() || null, is_default: !!k.is_default }
      // only one main pack: the old one steps down first
      if (row.is_default) {
        const old = mine.find((x) => x.is_default && x.id !== k.id)
        if (old) unwrap(await supabase.from('product_packs').update({ is_default: false }).eq('id', old.id))
      }
      if (k.id) unwrap(await supabase.from('product_packs').update(row).eq('id', k.id))
      else unwrap(await supabase.from('product_packs').insert({ ...row, company_id: companyId!, product_id: product.id }))
    },
    onSuccess: async () => { await refresh(); setEdit(null); toast.success(t('Packaging saved')) },
    onError: (e) => toast.error(describeError(e)),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('product_packs').delete().eq('id', id)),
    onSuccess: async () => { await refresh(); toast.success(t('Packaging removed')) },
    onError: (e) => toast.error(describeError(e)),
  })

  return (
    <div className="grid gap-3">
      <p className="max-w-2xl text-[13px] text-muted-foreground">
        {t('How the item is packed: a box of 24, a crate of 12. On purchases and sales the quantity can then be entered in boxes, the documents print “2 Kuti × 24”, and scanning the box barcode counts the whole box.')}
      </p>
      {mine.length === 0 && !isLoading ? (
        <EmptyState compact icon={Boxes} title={t('No packaging yet')} description={t('The item is counted only in {unit}.', { unit: pieces })}
          action={editable && <Button size="sm" onClick={() => setEdit({ name: '', factor: undefined, is_default: true })}><Plus /> {t('Add packaging')}</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>{t('Packaging')}</TableHead><TableHead className="text-right">{t('Pieces in it')}</TableHead><TableHead>{t('Barcode of the pack')}</TableHead>
              <TableHead className="text-right">{t('Price of the pack')}</TableHead><TableHead className="w-24" />
            </TableRow></TableHeader>
            <TableBody>
              {mine.map((k) => (
                <TableRow key={k.id} className="hover:bg-transparent">
                  <TableCell className="font-medium">{k.name}{k.is_default && <Badge variant="secondary" className="ml-2 gap-1"><Star className="size-3" />{t('Main')}</Badge>}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(k.factor)} {pieces}</TableCell>
                  <TableCell className="tabular-nums">{k.barcode ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoney(num(product.sales_price) * k.factor)} <span className="text-2xs">{t('without VAT')}</span></TableCell>
                  <TableCell className="text-right">
                    {editable && <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon-sm" aria-label={t('Edit {name}', { name: k.name })} onClick={() => setEdit(k)}><Pencil /></Button>
                      <ConfirmDialog title={t('Remove the packaging {name}?', { name: k.name })} description={t('Documents that already used it keep their quantities.')}
                        confirmLabel={t('Remove')} destructive onConfirm={() => remove.mutateAsync(k.id)}
                        trigger={<Button variant="ghost" size="icon-sm" aria-label={t('Remove {name}', { name: k.name })}><Trash2 /></Button>} />
                    </div>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editable && mine.length > 0 && <Button variant="outline" size="sm" className="w-fit" onClick={() => setEdit({ name: '', is_default: false })}><Plus /> {t('Add packaging')}</Button>}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{edit?.id ? t('Edit packaging') : t('Add packaging')}</DialogTitle>
            <DialogDescription>{t('For example Kuti with 24 {unit}.', { unit: pieces })}</DialogDescription></DialogHeader>
          {edit && (
            <form className="grid gap-3" onSubmit={(e) => {
              e.preventDefault()
              if (!edit.name?.trim()) return void toast.error(t('Enter the name of the packaging'))
              if (!(num(edit.factor) > 0)) return void toast.error(t('Enter how many pieces are in it'))
              save.mutate(edit)
            }}>
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <div className="grid gap-1.5"><Label htmlFor="pk-name">{t('Name')}</Label>
                  <Input id="pk-name" autoFocus maxLength={40} value={edit.name ?? ''} placeholder={t('Kuti, Arkë, Paletë')} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
                <div className="grid gap-1.5"><Label htmlFor="pk-f">{t('{unit} in it', { unit: pieces })}</Label>
                  <Input id="pk-f" type="number" step="any" min="0" className="text-right" value={edit.factor ?? ''} onChange={(e) => setEdit({ ...edit, factor: e.target.value === '' ? undefined : num(e.target.value) })} /></div>
              </div>
              <div className="grid gap-1.5"><Label htmlFor="pk-bc">{t('Barcode of the pack (optional)')}</Label>
                <Input id="pk-bc" className="tabular-nums" value={edit.barcode ?? ''} placeholder={t('Scan the code on the box')} onChange={(e) => setEdit({ ...edit, barcode: e.target.value })} /></div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>{t('Main packaging')}<span className="block text-xs text-muted-foreground">{t('Shown on labels and used to print loose quantities in boxes.')}</span></span>
                <Switch checked={!!edit.is_default} onCheckedChange={(on) => setEdit({ ...edit, is_default: on })} aria-label={t('Main packaging')} />
              </label>
              <DialogFooter><Button type="submit" loading={save.isPending}>{t('Save')}</Button></DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
