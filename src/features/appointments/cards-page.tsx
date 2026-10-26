import { CalendarDays, FileText, Plus, Search, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useCustomers } from '@/features/sales/api'
import { t } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, todayISO } from '@/lib/utils'
import { APPT_STATUS, CARD_KINDS, type CardKind, type Field, defaultCardKind, useApptAction, useCard, useCards } from './api'

/** Vehicles, patients, pets, devices: each with its history. */
export function CardsPage() {
  const { company } = useCompany()
  const [params, setParams] = useSearchParams()
  const kind = (params.get('kind') as CardKind | 'all' | null) ?? defaultCardKind(company?.business_type)
  const [search, setSearch] = React.useState('')
  const cards = useCards(kind, search)
  const [adding, setAdding] = React.useState(false)
  const navigate = useNavigate()
  const k = kind === 'all' ? null : CARD_KINDS[kind]
  return (
    <>
      <PageHeader title={t('Client cards')} description={t('The car with its plate and kilometres, the patient, the pet: everything done for them, visit by visit.')}
        actions={<Can perm="sales.write"><Button onClick={() => setAdding(true)}><Plus /> {k ? t('New: {kind}', { kind: t(k.label).toLowerCase() }) : t('New card')}</Button></Can>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          {(['vehicle', 'patient', 'pet', 'client', 'device', 'all'] as const).map((x) => (
            <Button key={x} size="sm" className="h-7" variant={kind === x ? 'secondary' : 'ghost'} onClick={() => setParams({ kind: x }, { replace: true })}>{x === 'all' ? t('All') : t(CARD_KINDS[x].plural)}</Button>
          ))}
        </div>
        <div className="relative w-full max-w-xs"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={kind === 'vehicle' ? t('Plate or VIN') : t('Name or phone')} aria-label={t('Search')} /></div>
      </div>
      {cards.isLoading ? <Skeleton className="h-64" /> : cards.isError ? <ErrorState error={cards.error} onRetry={() => void cards.refetch()} />
        : !cards.data?.length ? <EmptyState title={t('No cards yet')} description={t('Make a card the first time a client comes; their appointments and invoices fill its history.')} />
        : (
          <Card><CardContent className="p-0"><ul className="divide-y">
            {cards.data.map((c) => (
              <li key={c.id}><button type="button" onClick={() => navigate(`/appointments/cards/${c.id}`)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted/40">
                <span className="min-w-0 flex-1"><span className="font-medium">{c.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[t(CARD_KINDS[c.kind].label), summary(c.kind, c.attrs), c.partner?.name].filter(Boolean).join(' · ')}</span></span>
              </button></li>
            ))}
          </ul></CardContent></Card>
        )}
      {adding && <CardDialog kind={kind === 'all' ? defaultCardKind(company?.business_type) : kind} onClose={() => setAdding(false)} onSaved={(id) => navigate(`/appointments/cards/${id}`)} />}
    </>
  )
}

function summary(kind: CardKind, a: Record<string, string>) {
  if (kind === 'vehicle') return [a.make, a.model, a.year, a.km ? `${a.km} km` : ''].filter(Boolean).join(' ')
  if (kind === 'pet') return [a.species, a.breed].filter(Boolean).join(', ')
  if (kind === 'patient' || kind === 'client') return [a.phone, a.birth_date ? formatDate(a.birth_date) : ''].filter(Boolean).join(' · ')
  return [a.brand, a.model, a.serial].filter(Boolean).join(' ')
}

function FieldInput({ f, value, onChange }: { f: Field; value: string; onChange: (v: string) => void }) {
  const id = `f-${f.key}`
  return (
    <div className={cn('grid gap-1.5', f.wide && 'sm:col-span-2')}><Label htmlFor={id}>{t(f.label)}</Label>
      {f.type === 'textarea' ? <Textarea id={id} rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
        : <Input id={id} type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  )
}

function CardDialog({ kind, card, onClose, onSaved }: { kind: CardKind; card?: { id: string; title: string; partner_id: string | null; attrs: Record<string, string>; notes: string | null }; onClose: () => void; onSaved?: (id: string) => void }) {
  const { companyId } = useCompany()
  const customers = useCustomers()
  const k = CARD_KINDS[kind]
  const [title, setTitle] = React.useState(card?.title ?? '')
  const [partner, setPartner] = React.useState<string | null>(card?.partner_id ?? null)
  const [attrs, setAttrs] = React.useState<Record<string, string>>(card?.attrs ?? {})
  const [notes, setNotes] = React.useState(card?.notes ?? '')
  const save = useApptAction(async () => {
    const row = { title: kind === 'vehicle' ? title.trim().toUpperCase() : title.trim(), partner_id: partner, attrs, notes: notes.trim() || null }
    if (card) { unwrap(await supabase.from('client_cards').update(row as never).eq('id', card.id)); return card.id }
    return (unwrap(await supabase.from('client_cards').insert({ ...row, kind, company_id: companyId } as never).select('id').single()) as { id: string }).id
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{card ? card.title : t('New: {kind}', { kind: t(k.label).toLowerCase() })}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label htmlFor="ct">{t(k.title)}</Label><Input id="ct" value={title} onChange={(e) => setTitle(e.target.value)} className={kind === 'vehicle' ? 'uppercase' : ''} /></div>
          <div className="grid gap-1.5"><Label>{kind === 'patient' || kind === 'client' ? t('Who pays (client on file)') : t('Owner')}</Label>
            <SearchSelect value={partner} onChange={setPartner} clearable placeholder={t('None')} options={(customers.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.phone ?? c.code }))} /></div>
          {k.fields.map((f) => <FieldInput key={f.key} f={f} value={attrs[f.key] ?? ''} onChange={(v) => setAttrs((a) => ({ ...a, [f.key]: v }))} />)}
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="cn">{t('Notes')}</Label><Textarea id="cn" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={save.isPending} disabled={!title.trim()} onClick={() => save.mutate(undefined, { onSuccess: (id) => { toast.success(t('Saved')); onClose(); onSaved?.(id) } })}>{t('Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function CardDetailPage() {
  const { id } = useParams()
  const q = useCard(id)
  const { companyId } = useCompany()
  const [editing, setEditing] = React.useState(false)
  const [entry, setEntry] = React.useState<{ title: string; body: string; date: string; attrs: Record<string, string> } | null>(null)
  const addEntry = useApptAction(async () => {
    unwrap(await supabase.from('card_entries').insert({ company_id: companyId, card_id: id, title: entry!.title.trim(), body: entry!.body.trim() || null, entry_date: entry!.date, attrs: entry!.attrs } as never))
    // the car's kilometres follow the last visit
    const c = q.data?.card
    if (c?.kind === 'vehicle' && Number(entry!.attrs.km) > Number(c.attrs.km ?? 0)) unwrap(await supabase.from('client_cards').update({ attrs: { ...c.attrs, km: entry!.attrs.km } } as never).eq('id', c.id))
  })
  const removeEntry = useApptAction(async (eid: string) => unwrap(await supabase.from('card_entries').delete().eq('id', eid)))
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const { card, entries, appts } = q.data
  const k = CARD_KINDS[card.kind]
  // appointments without an entry of their own still show in the history
  const extra = appts.filter((a) => !entries.some((e) => e.appointment_id === a.id))
  return (
    <>
      <PageHeader back={{ href: `/appointments/cards?kind=${card.kind}`, label: t(k.plural) }} title={card.title}
        description={[t(k.label), summary(card.kind, card.attrs), card.partner?.name].filter(Boolean).join(' · ')}
        actions={<Can perm="sales.write">
          <Button variant="outline" onClick={() => setEditing(true)}>{t('Edit')}</Button>
          <Button onClick={() => setEntry({ title: '', body: '', date: todayISO(), attrs: {} })}><Plus /> {t('Add to the history')}</Button>
        </Can>} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <Card className="h-fit"><CardHeader><CardTitle>{t('Details')}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {k.fields.filter((f) => card.attrs[f.key]).map((f) => (
              <div key={f.key}><div className="text-xs text-muted-foreground">{t(f.label)}</div><div className="whitespace-pre-wrap">{f.type === 'date' ? formatDate(card.attrs[f.key]!) : card.attrs[f.key]}</div></div>
            ))}
            {card.notes && <div><div className="text-xs text-muted-foreground">{t('Notes')}</div><div className="whitespace-pre-wrap">{card.notes}</div></div>}
            {card.partner && <div><div className="text-xs text-muted-foreground">{t('Client')}</div><Link className="text-primary hover:underline" to={`/partners/${card.partner_id}`}>{card.partner.name}</Link>{card.partner.phone ? ` · ${card.partner.phone}` : ''}</div>}
          </CardContent></Card>
        <Card><CardHeader><CardTitle>{t('History')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!entries.length && !extra.length ? <p className="px-6 pb-6 text-[13px] text-muted-foreground">{t('Nothing yet. Appointments done for this card and notes you add appear here.')}</p> : (
              <ol className="divide-y">
                {entries.map((e) => (
                  <li key={e.id} className="grid gap-1 px-6 py-3 text-sm">
                    <div className="flex items-center gap-2"><span className="tabular text-xs text-muted-foreground">{formatDate(e.entry_date)}</span><span className="font-medium">{e.title}</span>
                      <span className="ml-auto flex gap-1">
                        {e.invoice_id && <Button size="xs" variant="ghost" asChild><Link to={`/sales/invoices/${e.invoice_id}`}><FileText /> {t('Invoice')}</Link></Button>}
                        <Can perm="sales.write"><Button size="icon" variant="ghost" className="size-7" aria-label={t('Remove')} onClick={() => removeEntry.mutate(e.id)}><Trash2 /></Button></Can>
                      </span></div>
                    {k.entry.filter((f) => e.attrs?.[f.key]).map((f) => <div key={f.key} className="text-[13px]"><span className="text-muted-foreground">{t(f.label)}: </span>{f.type === 'date' ? formatDate(e.attrs[f.key]!) : e.attrs[f.key]}</div>)}
                    {e.body && <div className="whitespace-pre-wrap text-[13px] text-muted-foreground">{e.body}</div>}
                  </li>
                ))}
                {extra.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 px-6 py-3 text-sm">
                    <CalendarDays className="size-4 text-muted-foreground" /><span className="tabular text-xs text-muted-foreground">{formatDate(a.starts_at, true)}</span>
                    <span>{a.service?.name ?? t('Appointment')}</span><StatusBadge status={a.status} label={t(APPT_STATUS[a.status])} />
                  </li>
                ))}
              </ol>
            )}
          </CardContent></Card>
      </div>
      {editing && <CardDialog kind={card.kind} card={card} onClose={() => { setEditing(false); void q.refetch() }} />}
      {entry && (
        <Dialog open onOpenChange={(o) => !o && setEntry(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{t('Add to the history')}</DialogTitle></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="et">{t('What was done')}</Label><Input id="et" value={entry.title} onChange={(e) => setEntry({ ...entry, title: e.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="edt">{t('Date')}</Label><Input id="edt" type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} /></div>
              {k.entry.map((f) => <FieldInput key={f.key} f={f} value={entry.attrs[f.key] ?? ''} onChange={(v) => setEntry({ ...entry, attrs: { ...entry.attrs, [f.key]: v } })} />)}
              <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="eb">{t('Notes')}</Label><Textarea id="eb" rows={3} value={entry.body} onChange={(e) => setEntry({ ...entry, body: e.target.value })} /></div>
            </div>
            <DialogFooter><Button variant="ghost" onClick={() => setEntry(null)}>{t('Cancel')}</Button>
              <Button loading={addEntry.isPending} disabled={!entry.title.trim()} onClick={() => addEntry.mutate(undefined, { onSuccess: () => { setEntry(null); toast.success(t('Saved')) } })}>{t('Save')}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
