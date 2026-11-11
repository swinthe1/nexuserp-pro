import { Check, ClipboardCopy, Crosshair, FileArchive, Image as ImageIcon, Lightbulb, ThumbsUp, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { t, tServer } from '@/i18n'
import { describeError } from '@/lib/errors'
import { download } from '@/lib/export'
import { cn, formatDate } from '@/lib/utils'
import { KINDS, pictureUrl, reqNo, STATUSES, useRequests, useRequestsOn, useSetRequestsOn, useUpdateRequest, useVote, useWithdraw,
  type ChangeRequest, type RequestStatus } from './api'
import { openRequest } from './request-host'

const kindLabel = (k: string) => t(KINDS.find((x) => x.key === k)?.label ?? k)
const statusOf = (s: string) => STATUSES.find((x) => x.key === s) ?? STATUSES[0]

/** one request as text, the way it goes to the developer */
function asText(r: ChangeRequest, picture?: string) {
  const lines = [
    `## ${reqNo(r.number)} · ${kindLabel(r.kind)} · ${t(statusOf(r.status).label)}`,
    `${t('Page')}: ${r.page_title || '?'}${r.page_path ? ` (${r.page_path})` : ''}`,
  ]
  if (r.target) lines.push(`${t('Spot')}: ${r.target}`)
  lines.push(`${t('From')}: ${r.author_name ?? '?'}${r.company ? ` (${r.company})` : ''}, ${formatDate(r.created_at, true)}${r.version ? `, ${t('version')} ${r.version}` : ''}${r.screen ? `, ${t('screen')} ${r.screen}` : ''}`)
  if (r.votes) lines.push(`${t('Me too')}: ${r.votes}`)
  if (r.duplicate_number) lines.push(`${t('The same as')} ${reqNo(r.duplicate_number)}`)
  lines.push('', `${t('Request')}:`, r.body)
  if (r.detail) lines.push('', `${t('Written out in detail (confirmed by the person)')}:`, r.detail)
  if (r.reply) lines.push('', `${t('Answer')}: ${r.reply}`)
  if (picture) lines.push('', `${t('Picture')}: ${picture}`)
  return lines.join('\n')
}

function RequestCard({ r, admin, selected, onSelect, all, focus }: {
  r: ChangeRequest; admin: boolean; selected: boolean; onSelect: (v: boolean) => void; all: ChangeRequest[]; focus: boolean
}) {
  const vote = useVote()
  const withdraw = useWithdraw()
  const update = useUpdateRequest()
  const [edit, setEdit] = React.useState({ status: r.status, done_version: r.done_version ?? '', reply: r.reply ?? '', dup: r.duplicate_number ? String(r.duplicate_number) : '' })
  React.useEffect(() => setEdit({ status: r.status, done_version: r.done_version ?? '', reply: r.reply ?? '', dup: r.duplicate_number ? String(r.duplicate_number) : '' }), [r])
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { if (focus) ref.current?.scrollIntoView({ block: 'center' }) }, [focus])
  const st = statusOf(r.status)
  const changed = edit.status !== r.status || edit.done_version !== (r.done_version ?? '') || edit.reply !== (r.reply ?? '') || edit.dup !== (r.duplicate_number ? String(r.duplicate_number) : '')
  const save = () => {
    const dupId = edit.dup.trim() ? all.find((x) => x.number === Number(edit.dup.replace(/\D/g, '')))?.id : null
    if (edit.dup.trim() && !dupId) { toast.error(t('There is no request {no}', { no: edit.dup })); return }
    update.mutate({ id: r.id, status: edit.status, done_version: edit.done_version, reply: edit.reply, duplicate_of: dupId ?? null },
      { onSuccess: () => toast.success(t('Saved')), onError: (e) => toast.error(tServer(describeError(e))) })
  }
  const showPicture = async () => {
    try { window.open(await pictureUrl(r.screenshot!), '_blank', 'noopener') } catch (e) { toast.error(tServer(describeError(e))) }
  }
  return (
    <div ref={ref} className={cn('grid gap-2 rounded-xl border bg-card p-4', focus && 'ring-2 ring-primary', r.status === 'done' || r.status === 'rejected' ? 'opacity-80' : '')}>
      <div className="flex flex-wrap items-center gap-2">
        {admin && <Checkbox checked={selected} onCheckedChange={(v) => onSelect(!!v)} aria-label={t('Choose {no}', { no: reqNo(r.number) })} />}
        <span className="font-semibold tabular-nums">{reqNo(r.number)}</span>
        <Badge variant="outline">{kindLabel(r.kind)}</Badge>
        <Badge variant={st.variant}>{t(st.label)}{r.status === 'done' && r.done_version ? ` ${r.done_version}` : ''}</Badge>
        {r.duplicate_number && <Badge variant="secondary">{t('The same as')} {reqNo(r.duplicate_number)}</Badge>}
        {r.page_path ? <Link to={r.page_path} className="min-w-0 truncate text-sm text-primary hover:underline">{r.page_title || r.page_path}</Link>
          : <span className="text-sm text-muted-foreground">{r.page_title}</span>}
        <span className="ml-auto text-xs text-muted-foreground">{r.author_name}{r.company ? `, ${r.company}` : ''}, {formatDate(r.created_at, true)}</span>
      </div>
      {r.target && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Crosshair className="size-3.5" />{r.target}</div>}
      <p className="whitespace-pre-wrap text-sm">{r.body}</p>
      {r.detail && (
        <details className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">{t('Written out in detail')}</summary>
          <p className="mt-2 whitespace-pre-wrap">{r.detail}</p>
        </details>
      )}
      {r.reply && !admin && <div className="rounded-lg bg-primary/[0.06] px-3 py-2 text-sm"><span className="font-medium">{t('Answer')}:</span> {r.reply}</div>}
      <div className="flex flex-wrap items-center gap-2">
        {!r.mine && <Button size="sm" variant={r.voted ? 'default' : 'outline'} loading={vote.isPending} onClick={() => vote.mutate(r.id)}>
          <ThumbsUp /> {t('Me too')}{r.votes ? ` (${r.votes})` : ''}</Button>}
        {r.mine && r.votes > 0 && <span className="flex items-center gap-1 text-xs text-muted-foreground"><ThumbsUp className="size-3.5" />{t('{n} want it too', { n: r.votes })}</span>}
        {r.screenshot && <Button size="sm" variant="ghost" onClick={() => void showPicture()}><ImageIcon /> {t('Picture')}</Button>}
        {(r.mine || admin) && r.status === 'new' && <Button size="sm" variant="ghost" className="text-muted-foreground" loading={withdraw.isPending}
          onClick={() => withdraw.mutate(r.id, { onError: (e) => toast.error(tServer(describeError(e))) })}><Trash2 /> {t('Take back')}</Button>}
      </div>
      {admin && (
        <div className="grid gap-2 rounded-lg border border-dashed p-3 sm:grid-cols-[10rem_8rem_8rem_minmax(0,1fr)_auto] sm:items-start">
          <Select value={edit.status} onValueChange={(v) => setEdit({ ...edit, status: v as RequestStatus })}>
            <SelectTrigger aria-label={t('Status')}><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{t(s.label)}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={edit.done_version} onChange={(e) => setEdit({ ...edit, done_version: e.target.value })} placeholder={t('Version')} aria-label={t('Version')} />
          <Input value={edit.dup} onChange={(e) => setEdit({ ...edit, dup: e.target.value })} placeholder={t('Same as K-')} aria-label={t('The same as')} />
          <Textarea rows={1} value={edit.reply} onChange={(e) => setEdit({ ...edit, reply: e.target.value })} placeholder={t('Answer to the person')} aria-label={t('Answer')} />
          <Button size="sm" disabled={!changed} loading={update.isPending} onClick={save}><Check /> {t('Save')}</Button>
        </div>
      )}
    </div>
  )
}

/** "Kërkesat": everything the testers asked for, to follow, say "me too", and for the platform owner to sort and hand over */
export function RequestsPage() {
  const { isSuperAdmin: admin } = useCompany()
  const list = useRequests()
  const on = useRequestsOn()
  const setOn = useSetRequestsOn()
  const [params] = useSearchParams()
  const focusNo = Number(params.get('k')) || null
  const [status, setStatus] = React.useState<'open' | 'all' | RequestStatus>('open')
  const [kind, setKind] = React.useState('all')
  const [mineOnly, setMineOnly] = React.useState(false)
  const [q, setQ] = React.useState('')
  const [sel, setSel] = React.useState<Set<string>>(new Set())
  const [packing, setPacking] = React.useState(false)
  const rows = list.data ?? []
  const count = (s: string) => rows.filter((r) => (s === 'open' ? r.status !== 'done' && r.status !== 'rejected' : s === 'all' || r.status === s)).length
  const needle = q.trim().toLowerCase()
  const shown = rows.filter((r) =>
    (focusNo && r.number === focusNo) || (
      (status === 'all' || (status === 'open' ? r.status !== 'done' && r.status !== 'rejected' : r.status === status))
      && (kind === 'all' || r.kind === kind) && (!mineOnly || r.mine)
      && (!needle || [reqNo(r.number), r.body, r.detail, r.page_title, r.target, r.author_name, r.company].some((x) => x?.toLowerCase().includes(needle)))))
  const chosen = rows.filter((r) => sel.has(r.id)).sort((a, b) => a.number - b.number)

  const copyText = async () => {
    const text = [t('Requests from the testers of DrisPRO'), '', ...chosen.map((r) => asText(r)), ''].join('\n\n')
    try { await navigator.clipboard.writeText(text); toast.success(t('{n} requests copied, paste them in the chat', { n: chosen.length })) } catch (e) { toast.error(tServer(describeError(e))) }
  }
  const packZip = async () => {
    setPacking(true)
    try {
      const { zipSync, strToU8 } = await import('fflate')
      const files: Record<string, Uint8Array> = {}
      const parts: string[] = []
      for (const r of chosen) {
        let name: string | undefined
        if (r.screenshot) {
          try {
            const res = await fetch(await pictureUrl(r.screenshot))
            if (res.ok) { name = `foto/${reqNo(r.number)}.${r.screenshot.endsWith('.png') ? 'png' : 'jpg'}`; files[name] = new Uint8Array(await res.arrayBuffer()) }
          } catch { /* the request goes without its picture */ }
        }
        parts.push(asText(r, name))
      }
      files['kerkesat.md'] = strToU8([`# ${t('Requests from the testers of DrisPRO')}`, ...parts].join('\n\n---\n\n'))
      const zip = zipSync(files, { level: 0 })
      download(new Blob([zip], { type: 'application/zip' }), `kerkesat-${new Date().toISOString().slice(0, 10)}.zip`)
    } catch (e) { toast.error(tServer(describeError(e))) } finally { setPacking(false) }
  }

  return (
    <>
      <PageHeader title={t('Requests')}
        description={t('What the testers ask to add, take out, change or join, and the mistakes they meet. Press "Request" on any page, or right click a menu line. Say "Me too" instead of writing the same again.')}
        actions={<>
          {admin && <label className="flex items-center gap-2 text-sm"><Switch checked={!!on.data} onCheckedChange={(v) => setOn.mutate(v)} />{t('Requests open')}</label>}
          {on.data && <Button onClick={() => openRequest()}><Lightbulb /> {t('New request')}</Button>}
        </>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 text-sm">
          {([['open', t('Open|requests')], ['all', t('All')], ...STATUSES.map((s) => [s.key, t(s.label)])] as [string, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setStatus(k as typeof status)}
              className={cn('rounded-md px-3 py-1.5', status === k ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {label} <span className="tabular-nums text-muted-foreground">{count(k)}</span>
            </button>
          ))}
        </div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-40" aria-label={t('Kind')}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">{t('All kinds')}</SelectItem>{KINDS.map((k) => <SelectItem key={k.key} value={k.key}>{t(k.label)}</SelectItem>)}</SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm"><Switch checked={mineOnly} onCheckedChange={setMineOnly} />{t('Only mine')}</label>
        <Input className="w-64" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search: number, words, page, person…')} aria-label={t('Search')} />
      </div>
      {admin && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <Checkbox checked={shown.length > 0 && shown.every((r) => sel.has(r.id))}
            onCheckedChange={(v) => setSel(v ? new Set([...sel, ...shown.map((r) => r.id)]) : new Set([...sel].filter((id) => !shown.some((r) => r.id === id))))}
            aria-label={t('Choose all shown')} />
          <span>{t('{n} chosen', { n: chosen.length })}</span>
          <Button size="sm" variant="outline" disabled={!chosen.length} onClick={() => void copyText()}><ClipboardCopy /> {t('Copy for Claude')}</Button>
          <Button size="sm" variant="outline" disabled={!chosen.length} loading={packing} onClick={() => void packZip()}><FileArchive /> {t('With the pictures (zip)')}</Button>
          {chosen.length > 0 && <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSel(new Set())}>{t('Clear the choice')}</button>}
        </div>
      )}
      {list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        : list.isLoading ? <div className="grid gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
        : !shown.length ? <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">{rows.length ? t('No request matches the filter.') : t('No requests yet. Press "Request" on any page to send the first one.')}</div>
        : <div className="grid gap-3">{shown.map((r) => (
            <RequestCard key={r.id} r={r} admin={admin} all={rows} focus={r.number === focusNo}
              selected={sel.has(r.id)} onSelect={(v) => setSel((s) => { const n = new Set(s); if (v) n.add(r.id); else n.delete(r.id); return n })} />
          ))}</div>}
    </>
  )
}
