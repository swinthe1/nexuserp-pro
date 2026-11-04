import { useQuery } from '@tanstack/react-query'
import type * as React from 'react'
import { ChevronDown, ChevronUp, ExternalLink, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { t, tServer } from '@/i18n'
import { fetchPrintDoc } from '@/lib/documents/model'
import { renderDocHtml } from '@/lib/documents/render-html'
import { describeError } from '@/lib/errors'
import { printHtml } from '@/lib/print'
import { formatMoney, formatQty } from '@/lib/utils'
import type { Getter } from './rules'
import { DuplicateButton } from '@/components/duplicate-button'
import type { RowPreview } from './types'

/**
 * A quick look at a row without leaving the list: the document as it prints (invoices, orders, receipts…),
 * or every field of the row and its lines. ↑ ↓ move to the row above or below; "Open" opens it.
 */
export function PreviewSheet<T>({ rows, index, onIndex, onClose, getters, preview, onOpen, fields }: {
  rows: T[]; index: number; onIndex: (i: number) => void; onClose: () => void
  getters: Getter[]; preview?: (row: T) => RowPreview | null; onOpen?: (row: T) => void
  /** the row's fields as the list shows them (badges, dates, money), with their names */
  fields: (i: number) => { id: string; label: string; node: React.ReactNode }[]
}) {
  const row = rows[index]
  const spec = row && preview ? preview(row) : null
  const title = spec?.title ?? (row ? getters.map((g) => g.text(row)).find(Boolean) : '') ?? ''
  const go = (d: number) => { const i = index + d; if (i >= 0 && i < rows.length) onIndex(i) }
  const doc = useQuery({
    queryKey: ['preview-doc', spec?.print?.kind, spec?.print?.id], enabled: !!spec?.print, staleTime: 30_000,
    queryFn: async () => renderDocHtml(await fetchPrintDoc(spec!.print!.kind, spec!.print!.id)),
  })
  const lines = useQuery({ queryKey: ['preview-lines', title, spec?.lines ? index : null], enabled: !!spec?.lines && !spec?.print, staleTime: 30_000, queryFn: () => spec!.lines!() })

  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[760px]"
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); go(1) } else if (e.key === 'ArrowUp') { e.preventDefault(); go(-1) } }}>
        <SheetHeader className="flex-row items-center gap-2 space-y-0 border-b px-4 py-3 pr-12">
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-base">{title || t('Preview')}</SheetTitle>
            <SheetDescription className="text-[12px]">{t('{n} of {total} · ↑ ↓ for the next one', { n: index + 1, total: rows.length })}</SheetDescription>
          </div>
          <Button size="icon" variant="outline" className="size-8" disabled={index === 0} onClick={() => go(-1)} aria-label={t('The one above')}><ChevronUp /></Button>
          <Button size="icon" variant="outline" className="size-8" disabled={index >= rows.length - 1} onClick={() => go(1)} aria-label={t('The one below')}><ChevronDown /></Button>
          {doc.data && <Button size="sm" variant="outline" onClick={() => printHtml(doc.data.body, doc.data.css, 'document')}><Printer /> {t('Print')}</Button>}
          {spec?.duplicate && spec.id && <DuplicateButton size="sm" table={spec.duplicate} id={spec.id} />}
          {onOpen && row && <Button size="sm" onClick={() => onOpen(row)}><ExternalLink /> {t('Open')}</Button>}
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/40">
          {spec?.print ? (
            doc.isPending ? <div className="grid gap-2 p-6"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-64" /></div>
              : doc.isError ? <p className="p-6 text-sm text-destructive">{tServer(describeError(doc.error))}</p>
              : <iframe title={title} className="h-full min-h-[70vh] w-full border-0 bg-white"
                  srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:16px} ${doc.data.css}</style></head><body>${doc.data.body}</body></html>`} />
          ) : row ? (
            <div className="grid gap-4 p-4">
              <dl className="grid gap-x-6 gap-y-2 rounded-lg border bg-card p-4 text-[13px] sm:grid-cols-2">
                {fields(index).map((f) => (
                  <div key={f.id} className="min-w-0"><dt className="text-[11px] text-muted-foreground">{f.label}</dt><dd className="truncate font-medium [&_*]:whitespace-normal">{f.node}</dd></div>))}
              </dl>
              {spec?.lines && (
                <div className="overflow-hidden rounded-lg border bg-card">
                  <table className="w-full text-[13px]">
                    <thead className="bg-muted/50 text-[12px] text-muted-foreground"><tr>
                      <th className="px-3 py-2 text-left font-medium">{t('Item')}</th><th className="px-3 py-2 text-right font-medium">{t('Qty')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('Price')}</th><th className="px-3 py-2 text-right font-medium">{t('Value')}</th></tr></thead>
                    <tbody>
                      {lines.isPending && <tr><td colSpan={4} className="p-3"><Skeleton className="h-5" /></td></tr>}
                      {lines.data?.map((l, i) => (
                        <tr key={i} className="border-t"><td className="px-3 py-1.5">{l.name}</td><td className="px-3 py-1.5 text-right tabular-nums">{formatQty(l.qty)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{l.price == null ? '' : formatMoney(l.price)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{l.total == null ? '' : formatMoney(l.total)}</td></tr>
                      ))}
                      {lines.data?.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-muted-foreground">{t('No lines')}</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
