import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { Camera, FileText, PenLine, type LucideIcon } from 'lucide-react'
import type * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { t, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { shrink } from '@/lib/shrink-image'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney } from '@/lib/utils'

/*
 * What every "from a photo" page shares (supplier invoices, expenses, assets, Z reports):
 * sending photos or PDFs to be read, the card with the buttons, and the list of recent reads.
 */

/** what went wrong, in words for the client: never the reading service's own technical message */
export function readError(e: string | null | undefined) {
  if (!e) return ''
  if (/credit balance|anthropic|api[ _-]?key|x-api-key|rate.?limit|overloaded|authentic|billing|quota|\b(401|403|429|5\d\d)\b|fetch failed|ECONN|timed? ?out|network/i.test(e))
    return t('Reading from a photo does not work right now. Write it by hand; the photo can be read later.')
  return tServer(e)
}

export type ReadKind = 'invoice' | 'expense' | 'asset' | 'z_report'

/** Sends the chosen photos or PDFs to be read; one file opens its review, several are read in the background. */
export function usePhotoSubmit({ kind, invalidate, onOne, manyMessage, vendorId }: {
  kind: ReadKind; invalidate: QueryKey[]; onOne: (id: string) => void; manyMessage?: (n: number) => string
  /** whose invoice it is, when the person says so before the photo: the reader then gets that supplier's rules and usual items */
  vendorId?: string | null
}) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const send = useMutation({
    mutationFn: async (files: File[]) => {
      let last = ''
      for (const file of files) {
        if (!/^(image\/|application\/pdf)/.test(file.type)) throw new Error(t('Choose a photo or a PDF'))
        const f = await shrink(file)
        last = unwrap(await supabase.rpc('doc_read_submit', { p_company: companyId!, p_file: f.data, p_mime: f.mime, p_name: file.name,
          ...(kind === 'invoice' ? {} : { p_kind: kind }), ...(kind === 'invoice' && vendorId ? { p_vendor: vendorId } : {}) })) as string
      }
      return { last, n: files.length }
    },
    onSuccess: (r) => {
      if (r.n === 1 || !manyMessage) onOne(r.last); else toast.success(manyMessage(r.n))
      for (const k of invalidate) void qc.invalidateQueries({ queryKey: k })
    },
    onError: (e) => toast.error(describeError(e)),
  })
  /** the camera (one photo) or the gallery and files (several when allowed) */
  const pick = (capture: boolean, multiple = true) => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = 'image/*,application/pdf'
    if (capture) inp.setAttribute('capture', 'environment'); else inp.multiple = multiple
    inp.onchange = () => { const f = Array.from(inp.files ?? []); if (f.length) send.mutate(f) }
    inp.click()
  }
  return { send, pick }
}

/**
 * The photo, as a choice: the form is written by hand by default, and this slim bar offers to fill it from
 * a photo or a PDF instead. With onManual, the bar also leads to the form written by hand (first).
 */
export function PhotoCard({ icon: Icon, title, hint, extra, busy, disabled, multiple = true, onPick, onManual }: {
  icon: LucideIcon; title: string; hint: string; extra?: React.ReactNode; busy: boolean; disabled?: boolean; multiple?: boolean
  onPick: (capture: boolean) => void; onManual?: () => void
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-card/60 px-3 py-2.5 sm:flex-row sm:items-center">
      <Icon className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
      <div className="min-w-0 flex-1 text-[13px]">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground"> · {t('optional: fill it from a photo or a PDF')}</span>
        <div className="text-xs text-muted-foreground">{hint}</div>
        {extra}
      </div>
      <div className="flex flex-wrap gap-2">
        {onManual && <Button size="sm" onClick={onManual}><PenLine /> {t('Write it by hand')}</Button>}
        <Button size="sm" variant="outline" loading={busy} disabled={disabled} onClick={() => onPick(true)}><Camera /> {t('Take a photo')}</Button>
        <Button size="sm" variant="outline" disabled={busy || disabled} onClick={() => onPick(false)}><FileText /> {multiple ? t('Choose files') : t('Choose a file')}</Button>
      </div>
    </div>
  )
}

export type ReadItem = { id: string; status: string; error: string | null; title: React.ReactNode; date: string | null; created_at: string; extra?: string | null
  total: number | null; booked: boolean }

/** The recent reads: waiting, being read, read and to check, booked. */
export function ReadsList({ items, onOpen, bookedLabel, doneLabel = t('To check'), showWaiting = true }: {
  items: ReadItem[]; onOpen: (id: string) => void; bookedLabel: string; doneLabel?: string; showWaiting?: boolean
}) {
  if (!items.length) return null
  const waiting = items.filter((r) => r.status === 'done' && !r.booked).length
  const label: Record<string, string> = { queued: t('Waiting'), reading: t('Reading'), done: doneLabel, failed: t('Not read') }
  return (
    <Card><CardContent className="p-0">
      {showWaiting && waiting > 0 && <div className="border-b bg-info/5 px-4 py-2 text-[13px] font-medium text-info">{t('{n} read and waiting for you to book them', { n: waiting })}</div>}
      <ul className="divide-y">
        {items.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.title}</div>
                <div className="truncate text-xs text-muted-foreground">{r.date ? formatDate(r.date) : formatDate(r.created_at, true)}{r.extra ? ` · ${r.extra}` : ''}{r.error ? ` · ${readError(r.error)}` : ''}</div>
              </div>
              {r.total != null && <span className="text-right text-sm font-semibold tabular">{formatMoney(r.total)}<span className="block text-2xs font-normal text-muted-foreground">{t('with VAT')}</span></span>}
              {r.booked ? <Badge variant="outline" className="border-success/40 text-success">{bookedLabel}</Badge>
                : <span className={cn('w-20 text-right text-xs font-medium', r.status === 'failed' ? 'text-destructive' : r.status === 'done' ? 'text-info' : 'text-muted-foreground')}>{label[r.status] ?? r.status}</span>}
            </button>
          </li>
        ))}
      </ul>
    </CardContent></Card>
  )
}
