import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { t, td } from '@/i18n'
import type { Pack } from '@/lib/packs'
import { formatQty, num } from '@/lib/utils'

export type PackChange = { pack_id: string | null; pack_qty: number | null; quantity?: number }

/** Under a line's quantity: count it in boxes instead of pieces. Shown only for items that have packs. */
export function PackQty({ packs, packId, packQty, quantity, uom, line, onChange, editable = true }: {
  packs: Pack[] | undefined; packId?: string | null; packQty?: number | null; quantity: unknown; uom?: string | null; line: number
  onChange: (v: PackChange) => void; editable?: boolean
}) {
  if (!packs?.length) return null
  const pack = packs.find((k) => k.id === packId) ?? null
  if (!editable) return pack ? <div className="text-2xs text-muted-foreground">{formatQty(packQty)} {pack.name} × {formatQty(pack.factor)}</div> : null
  const pieces = uom ? td(uom) : t('pieces')
  return (
    <div className="mt-1 grid gap-0.5">
      <div className="flex items-center justify-end gap-1">
        {pack && (
          <Input type="number" step="any" min="0" className="h-7 w-16 px-2 text-right text-xs" value={packQty ?? ''} aria-label={t('Packs, line {n}', { n: line })}
            onChange={(e) => {
              const n = e.target.value === '' ? null : num(e.target.value)
              onChange({ pack_id: pack.id, pack_qty: n, quantity: n ? Math.round(n * pack.factor * 10000) / 10000 : undefined })
            }} />
        )}
        <Select value={packId ?? '-'} onValueChange={(id) => {
          const k = packs.find((x) => x.id === id)
          if (!k) return onChange({ pack_id: null, pack_qty: null })
          const n = Math.max(1, Math.round(num(quantity) / k.factor))
          onChange({ pack_id: k.id, pack_qty: n, quantity: n * k.factor })
        }}>
          <SelectTrigger className="h-7 w-auto min-w-[88px] gap-1 px-2 text-xs" aria-label={t('Counted in, line {n}', { n: line })}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="-">{pieces}</SelectItem>
            {packs.map((k) => <SelectItem key={k.id} value={k.id}>{k.name} × {formatQty(k.factor)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {pack && <p className="text-right text-2xs text-muted-foreground">= {formatQty(num(quantity))} {pieces}</p>}
    </div>
  )
}

/** the pieces were typed: keep the number of packs in step */
export const packsFromPieces = (pack: Pack | undefined | null, qty: unknown) => pack ? Math.round(num(qty) / pack.factor * 10000) / 10000 : null
