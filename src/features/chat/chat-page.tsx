import { ArrowLeft, BellOff, Bell, Check, Copy, CornerUpLeft, Download, FileText, LogOut, MessageSquarePlus, MoreHorizontal, Paperclip, Pencil, Search, SendHorizontal, Trash2, UserPlus, Users, X } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { copyText } from '@/components/data-table/copy-menu'
import { EmptyState } from '@/components/empty-state'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { formatDateWith, t, tServer } from '@/i18n'
import { describeError } from '@/lib/errors'
import { fuzzyFind } from '@/lib/fuzzy'
import { cn, formatMoney, initials } from '@/lib/utils'
import {
  docLinks, MAX_FILE, uploadChatFile, useChatActions, useChatList, useChatMembers, useChatMessages, useChatPeople, useFileUrl, useLinkCard, useOnline, useSendMessage, useTyping,
  type ChatAttachment, type ChatConversation, type ChatMessage, type ChatPerson,
} from './api'

const EDIT_MINUTES = 15
const time = (d: string) => formatDateWith(new Date(d), { hour: '2-digit', minute: '2-digit' })
const dayOf = (d: string) => d.slice(0, 10)
function when(d: string) {
  const x = new Date(d), now = new Date()
  if (dayOf(x.toISOString()) === dayOf(now.toISOString())) return time(d)
  if (now.getTime() - x.getTime() < 6 * 864e5) return formatDateWith(x, { weekday: 'short' })
  return formatDateWith(x, { day: '2-digit', month: 'short' })
}
const dayLabel = (d: string) => {
  const today = new Date(); const y = new Date(Date.now() - 864e5)
  if (dayOf(d) === dayOf(today.toISOString())) return t('Today')
  if (dayOf(d) === dayOf(y.toISOString())) return t('Yesterday')
  return formatDateWith(new Date(d), { weekday: 'long', day: 'numeric', month: 'long' })
}

function Avatar({ name, online, group, size = 9 }: { name: string; online?: boolean; group?: boolean; size?: 8 | 9 }) {
  return (
    <span className={cn('relative grid shrink-0 place-items-center rounded-full bg-primary/10 text-[12px] font-semibold text-primary', size === 9 ? 'size-9' : 'size-8')}>
      {group ? <Users className="size-4" /> : initials(name)}
      {online && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card bg-success" aria-label={t('Online')} />}
    </span>
  )
}

/** Chat: the people of the company talk to each other inside DrisPRO, one to one or in groups. */
export function ChatPage() {
  const [params, setParams] = useSearchParams()
  const current = params.get('c')
  const open = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('c', id); else n.delete('c'); return n })
  const list = useChatList()
  const people = useChatPeople()
  const online = useOnline()
  const [q, setQ] = React.useState('')
  const [starting, setStarting] = React.useState<'direct' | 'group' | null>(null)
  const convs = list.data ?? []
  const shown = q.trim() ? fuzzyFind(convs, q, (c) => ({ text: `${c.title ?? ''} ${c.last_preview ?? ''}` })) : convs
  const conv = convs.find((c) => c.id === current) ?? null

  return (
    <div className="-mx-4 -my-5 grid h-[calc(100dvh-52px)] grid-cols-[minmax(0,1fr)] border-t bg-card sm:-mx-6 lg:-mx-8 md:grid-cols-[300px_minmax(0,1fr)]">
      <aside className={cn('flex min-h-0 flex-col border-r', current && 'max-md:hidden')}>
        <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
          <h1 className="text-base font-semibold">{t('Chat')}</h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="sm" className="h-8"><MessageSquarePlus /> {t('New conversation')}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setStarting('direct')}><MessageSquarePlus /> {t('With one person')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setStarting('group')}><Users /> {t('A new group')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="relative px-3 pb-2">
          <Search className="pointer-events-none absolute left-5 top-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search the conversations')} className="h-9 pl-8" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.isLoading ? <div className="grid gap-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            : !shown.length ? <EmptyState compact icon={MessageSquarePlus} title={q ? t('Nothing found') : t('No conversations yet')} description={q ? undefined : t('Write to a colleague, or make a group for a team.')} />
            : shown.map((c) => (
              <button key={c.id} type="button" onClick={() => open(c.id)}
                className={cn('flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent/50', c.id === current && 'bg-accent')}>
                <Avatar name={c.title ?? ''} group={c.kind === 'group'} online={c.other ? online.has(c.other) : false} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={cn('truncate text-[13.5px]', c.unread ? 'font-semibold' : 'font-medium')}>{c.title || t('Conversation')}</span>
                    {c.muted && <BellOff className="size-3 shrink-0 text-muted-foreground" />}
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{when(c.last_message_at)}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className={cn('truncate text-[12.5px]', c.unread ? 'text-foreground' : 'text-muted-foreground')}>{previewText(c)}</span>
                    {c.unread > 0 && <span className="ml-auto grid min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground">{c.unread > 99 ? '99+' : c.unread}</span>}
                  </span>
                </span>
              </button>
            ))}
        </div>
      </aside>
      <section className={cn('flex min-h-0 min-w-0 flex-col', !current && 'max-md:hidden')}>
        {current && conv ? <Thread key={current} conv={conv} people={people.data ?? []} online={online} onBack={() => open(null)} onLeft={() => open(null)} />
          : current && list.isLoading ? <Skeleton className="m-4 h-40" />
          : <div className="grid flex-1 place-items-center"><EmptyState icon={MessageSquarePlus} title={t('Choose a conversation')} description={t('Or start a new one: with one person, or a group for a team.')} /></div>}
      </section>
      {starting && <StartDialog kind={starting} people={people.data ?? []} onClose={() => setStarting(null)} onOpen={(id) => { setStarting(null); open(id) }} />}
    </div>
  )
}

function previewText(c: ChatConversation) {
  if (!c.last_preview) return c.kind === 'group' ? t('{n} people', { n: c.members }) : t('No messages yet')
  return c.last_preview
}

/* ---------------------------------------------------------------------------------- a conversation */
function Thread({ conv, people, online, onBack, onLeft }: { conv: ChatConversation; people: ChatPerson[]; online: Set<string>; onBack: () => void; onLeft: () => void }) {
  const { user } = useAuth()
  const { companyId } = useCompany()
  const msgs = useChatMessages(conv.id)
  const members = useChatMembers(conv.id)
  const actions = useChatActions()
  const send = useSendMessage(conv.id)
  const { typing, ping } = useTyping(conv.id)
  const [text, setText] = React.useState('')
  const [reply, setReply] = React.useState<ChatMessage | null>(null)
  const [editing, setEditing] = React.useState<ChatMessage | null>(null)
  const [files, setFiles] = React.useState<File[]>([])
  const [busy, setBusy] = React.useState(false)
  const [adding, setAdding] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const boxRef = React.useRef<HTMLTextAreaElement>(null)
  const nameOf = React.useCallback((id: string | null) => people.find((p) => p.id === id)?.name ?? '…', [people])
  const all = React.useMemo(() => (msgs.data?.pages ?? []).flat().slice().reverse(), [msgs.data])
  const byId = React.useMemo(() => new Map(all.map((m) => [m.id, m])), [all])
  // where "new" starts: what came after my last read when the conversation was opened
  const [readMark] = React.useState(() => members.data?.find((m) => m.user_id === user?.id)?.last_read_at ?? null)
  const firstNew = all.find((m) => readMark && m.created_at > readMark && m.sender_id !== user?.id && m.kind === 'text')?.id

  // read: on open, when something new comes, when the window is looked at again
  const lastId = all.at(-1)?.id
  React.useEffect(() => {
    const read = () => { if (document.visibilityState === 'visible') void actions.read(conv.id).then(() => actions.refresh()) }
    read()
    document.addEventListener('visibilitychange', read)
    return () => document.removeEventListener('visibilitychange', read)
  }, [conv.id, lastId]) // eslint-disable-line react-hooks/exhaustive-deps

  // the newest at the bottom, in view
  const scroller = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { const el = scroller.current; if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight }, [lastId])
  React.useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight }, [msgs.isSuccess])

  const pick = (list: FileList | File[] | null) => {
    const ok = [...(list ?? [])].filter((f) => { if (f.size > MAX_FILE * 3) { toast.error(t('{name} is bigger than 25 MB', { name: f.name })); return false } return true })
    setFiles((x) => [...x, ...ok].slice(0, 10))
  }
  const submit = async () => {
    const body = text.trim()
    if (editing) {
      if (!body) return
      setBusy(true)
      try { await actions.edit(editing.id, body); setEditing(null); setText(''); actions.refresh(conv.id) } catch (e) { toast.error(tServer(describeError(e))) } finally { setBusy(false) }
      return
    }
    if (!body && !files.length) return
    setBusy(true)
    try {
      const att: ChatAttachment[] = []
      for (const f of files) {
        try { att.push(await uploadChatFile(companyId!, conv.id, f)) } catch (e) { toast.error((e as Error).message === 'too-big' ? t('{name} is bigger than 25 MB', { name: f.name }) : tServer(describeError(e))); throw e }
      }
      await send.mutateAsync({ body, replyTo: reply?.id ?? null, attachments: att })
      setText(''); setFiles([]); setReply(null)
      requestAnimationFrame(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight })
    } catch (e) { if ((e as Error).message !== 'too-big') toast.error(tServer(describeError(e))) } finally { setBusy(false); boxRef.current?.focus() }
  }
  const me = members.data?.find((m) => m.user_id === user?.id)
  const muted = !!me?.muted_until && me.muted_until > new Date().toISOString()
  const onlineCount = (members.data ?? []).filter((m) => m.user_id !== user?.id && online.has(m.user_id)).length
  const subtitle = conv.kind === 'direct'
    ? (conv.other && online.has(conv.other) ? t('Online') : '')
    : `${t('{n} people', { n: members.data?.length ?? conv.members })}${onlineCount ? ` · ${t('{n} online', { n: onlineCount })}` : ''}`

  return (
    <div className="flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); pick(e.dataTransfer.files) } }}>
      <header className="flex items-center gap-2.5 border-b px-3 py-2">
        <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onBack} aria-label={t('Back')}><ArrowLeft /></Button>
        <Avatar name={conv.title ?? ''} group={conv.kind === 'group'} online={conv.other ? online.has(conv.other) : false} size={8} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{conv.title || t('Conversation')}</p>
          {subtitle && <p className="truncate text-[12px] text-muted-foreground">{subtitle}</p>}
        </div>
        <Button variant="ghost" size="icon-sm" title={muted ? t('Notifications are off; turn them on') : t('Mute this conversation')} aria-label={muted ? t('Turn notifications on') : t('Mute')}
          onClick={() => void actions.mute(conv.id, muted ? null : new Date(Date.now() + 365 * 864e5).toISOString()).then(() => { void members.refetch(); actions.refresh() })}>
          {muted ? <BellOff /> : <Bell />}
        </Button>
        {conv.kind === 'group' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('More')}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setAdding(true)}><UserPlus /> {t('Add people')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { const n = window.prompt(t('The name of the group'), conv.title ?? ''); if (n) void actions.rename(conv.id, n).then(() => actions.refresh()).catch((e) => toast.error(tServer(describeError(e)))) }}><Pencil /> {t('Rename')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onSelect={() => void actions.leave(conv.id).then(() => { actions.refresh(); onLeft() }).catch((e) => toast.error(tServer(describeError(e))))}><LogOut /> {t('Leave the group')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-muted/30 px-3 py-3 sm:px-5">
        {msgs.hasNextPage && <div className="mb-3 text-center"><Button variant="outline" size="sm" loading={msgs.isFetchingNextPage} onClick={() => void msgs.fetchNextPage()}>{t('Load older messages')}</Button></div>}
        {msgs.isLoading && <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className={cn('h-10 w-2/3', i % 2 && 'ml-auto')} />)}</div>}
        {!msgs.isLoading && !all.length && <p className="py-10 text-center text-[13px] text-muted-foreground">{t('Write the first message.')}</p>}
        {all.map((m, i) => {
          const prev = all[i - 1]
          const newDay = !prev || dayOf(prev.created_at) !== dayOf(m.created_at)
          const grouped = !!prev && !newDay && prev.sender_id === m.sender_id && prev.kind === 'text' && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000
          return (
            <React.Fragment key={m.id}>
              {newDay && <div className="my-3 flex items-center gap-3 text-[11.5px] text-muted-foreground"><span className="h-px flex-1 bg-border" />{dayLabel(m.created_at)}<span className="h-px flex-1 bg-border" /></div>}
              {m.id === firstNew && <div className="my-2 flex items-center gap-3 text-[11.5px] font-medium text-primary"><span className="h-px flex-1 bg-primary/40" />{t('New')}<span className="h-px flex-1 bg-primary/40" /></div>}
              {m.kind === 'system'
                ? <p className="my-2 text-center text-[12px] text-muted-foreground">{systemText(m, nameOf)}</p>
                : <Bubble m={m} mine={m.sender_id === user?.id} showName={conv.kind === 'group' && !grouped && m.sender_id !== user?.id} grouped={grouped}
                    name={nameOf(m.sender_id)} replyTo={m.reply_to ? byId.get(m.reply_to) ?? null : null} replyName={(id) => nameOf(id)}
                    onReply={() => { setReply(m); setEditing(null); boxRef.current?.focus() }}
                    onEdit={() => { setEditing(m); setReply(null); setText(m.body ?? ''); boxRef.current?.focus() }}
                    onDelete={() => void actions.remove(m.id).then(() => actions.refresh(conv.id)).catch((e) => toast.error(tServer(describeError(e))))} />}
            </React.Fragment>
          )
        })}
      </div>

      <footer className="border-t bg-card px-3 py-2">
        {typing.length > 0 && <p className="mb-1 text-[12px] text-muted-foreground">{t('{name} is writing…', { name: typing.map(nameOf).join(', ') })}</p>}
        {(reply || editing) && (
          <div className="mb-1.5 flex items-center gap-2 rounded-md border-l-2 border-primary bg-muted/60 px-2 py-1 text-[12.5px]">
            {editing ? <Pencil className="size-3.5 text-primary" /> : <CornerUpLeft className="size-3.5 text-primary" />}
            <span className="min-w-0 flex-1 truncate">{editing ? t('Changing the message') : <><b>{nameOf(reply!.sender_id)}</b>: {reply!.body ?? t('a file')}</>}</span>
            <button type="button" onClick={() => { setReply(null); if (editing) { setEditing(null); setText('') } }} aria-label={t('Cancel')}><X className="size-4" /></button>
          </div>
        )}
        {files.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <span key={i} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-[12px]">
                <FileText className="size-3.5 shrink-0" /><span className="truncate">{f.name}</span>
                <button type="button" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={t('Remove')}><X className="size-3.5" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = '' }} />
          <Button variant="ghost" size="icon-sm" className="mb-1" disabled={!!editing} onClick={() => fileRef.current?.click()} aria-label={t('Attach a file')} title={t('Attach a file')}><Paperclip /></Button>
          <Textarea ref={boxRef} rows={1} value={text} placeholder={t('Write a message… (Enter sends, Shift+Enter a new line)')}
            className="max-h-40 min-h-[38px] flex-1 resize-none py-2 text-[13.5px]"
            onChange={(e) => { setText(e.target.value); ping(); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px` }}
            onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); pick(f) } }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit() }
              if (e.key === 'Escape') { setReply(null); if (editing) { setEditing(null); setText('') } }
            }} />
          <Button size="icon" className="mb-0.5" loading={busy} disabled={!text.trim() && !files.length} onClick={() => void submit()} aria-label={editing ? t('Save') : t('Send')}>
            {editing ? <Check /> : <SendHorizontal />}
          </Button>
        </div>
      </footer>
      {adding && <AddPeopleDialog conv={conv} people={people} current={(members.data ?? []).map((m) => m.user_id)} onClose={() => { setAdding(false); void members.refetch() }} />}
    </div>
  )
}

function systemText(m: ChatMessage, nameOf: (id: string | null) => string) {
  if (m.body === 'created') return t('{name} made the group', { name: nameOf(m.sender_id) })
  if (m.body === 'left') return t('{name} left the group', { name: nameOf(m.sender_id) })
  if (m.body === 'added') return t('{name} added {people}', { name: nameOf(m.sender_id), people: (m.attachments as string[]).map((u) => nameOf(u)).join(', ') })
  return m.body ?? ''
}

/* ---------------------------------------------------------------------------------- one message */
function Bubble({ m, mine, showName, grouped, name, replyTo, replyName, onReply, onEdit, onDelete }: {
  m: ChatMessage; mine: boolean; showName: boolean; grouped: boolean; name: string; replyTo: ChatMessage | null; replyName: (id: string | null) => string
  onReply: () => void; onEdit: () => void; onDelete: () => void
}) {
  const fresh = Date.now() - new Date(m.created_at).getTime() < EDIT_MINUTES * 60_000
  const files = (m.attachments ?? []) as ChatAttachment[]
  const links = docLinks(m.body)
  return (
    <div className={cn('group/m flex', mine ? 'justify-end' : 'justify-start', grouped ? 'mt-0.5' : 'mt-2.5')}>
      <div className={cn('flex max-w-[min(680px,85%)] items-end gap-1', mine && 'flex-row-reverse')}>
        <div className={cn('min-w-0 rounded-2xl px-3 py-1.5 text-[13.5px] shadow-sm', mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md border bg-card')}>
          {showName && <p className="mb-0.5 text-[12px] font-semibold text-primary">{name}</p>}
          {replyTo && (
            <div className={cn('mb-1 rounded-md border-l-2 px-2 py-0.5 text-[12px]', mine ? 'border-primary-foreground/60 bg-primary-foreground/10' : 'border-primary bg-muted/60')}>
              <b>{replyName(replyTo.sender_id)}</b>: <span className="line-clamp-2">{replyTo.deleted_at ? t('Message deleted') : replyTo.body ?? t('a file')}</span>
            </div>
          )}
          {m.deleted_at ? <p className="italic opacity-70">{t('Message deleted')}</p> : <>
            {files.length > 0 && <div className="mb-1 grid gap-1">{files.map((f) => <FileItem key={f.path} f={f} mine={mine} />)}</div>}
            {m.body && <p className="whitespace-pre-wrap break-words">{linkify(m.body, mine)}</p>}
            {links.map((l) => <DocCard key={l.id} kind={l.kind} id={l.id} href={l.href} mine={mine} />)}
          </>}
          <p className={cn('mt-0.5 text-right text-[10.5px]', mine ? 'text-primary-foreground/75' : 'text-muted-foreground')}>{m.edited_at && !m.deleted_at ? `${t('changed')} · ` : ''}{time(m.created_at)}</p>
        </div>
        {!m.deleted_at && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="size-7 opacity-0 group-hover/m:opacity-100 data-[state=open]:opacity-100" aria-label={t('Message actions')}><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align={mine ? 'end' : 'start'}>
              <DropdownMenuItem onSelect={onReply}><CornerUpLeft /> {t('Reply')}</DropdownMenuItem>
              {m.body && <DropdownMenuItem onSelect={() => void copyText(m.body!).then(() => toast.success(t('Copied')))}><Copy /> {t('Copy')}</DropdownMenuItem>}
              {mine && fresh && <>
                <DropdownMenuSeparator />
                {m.body !== null && <DropdownMenuItem onSelect={onEdit}><Pencil /> {t('Change|edit')}</DropdownMenuItem>}
                <DropdownMenuItem className="text-destructive" onSelect={onDelete}><Trash2 /> {t('Delete')}</DropdownMenuItem>
              </>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

const URL_RE = /(https?:\/\/[^\s]+)/g
function linkify(body: string, mine: boolean) {
  const parts = body.split(URL_RE)
  return parts.map((p, i) => (i % 2 === 1
    ? <a key={i} href={p} target="_blank" rel="noreferrer noopener" className={cn('underline underline-offset-2', mine ? 'text-primary-foreground' : 'text-primary')}>{p}</a>
    : <React.Fragment key={i}>{p}</React.Fragment>))
}

function FileItem({ f, mine }: { f: ChatAttachment; mine: boolean }) {
  const url = useFileUrl(f.path)
  const isImage = f.type.startsWith('image/')
  const size = f.size > 1024 * 1024 ? `${(f.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(f.size / 1024))} KB`
  if (isImage) return url.data
    ? <a href={url.data} target="_blank" rel="noreferrer noopener"><img src={url.data} alt={f.name} className="max-h-64 max-w-full rounded-lg object-cover" style={f.w && f.h ? { aspectRatio: `${f.w} / ${f.h}` } : undefined} /></a>
    : <Skeleton className="h-40 w-56 rounded-lg" />
  return (
    <a href={url.data} download={f.name} target="_blank" rel="noreferrer noopener"
      className={cn('flex items-center gap-2 rounded-lg border px-2 py-1.5', mine ? 'border-primary-foreground/30 bg-primary-foreground/10' : 'bg-muted/40 hover:bg-muted')}>
      <FileText className="size-5 shrink-0" />
      <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{f.name}</span><span className="block text-[11px] opacity-75">{size}</span></span>
      <Download className="size-4 shrink-0 opacity-70" />
    </a>
  )
}

const CARD_TITLE: Record<string, string> = { sales_invoice: 'Invoice', vendor_bill: 'Vendor bill', sales_order: 'Sales order', purchase_order: 'Purchase order', product: 'Item', partner: 'Customer or vendor' }
function DocCard({ kind, id, href, mine }: { kind: string; id: string; href: string; mine: boolean }) {
  const card = useLinkCard(kind, id)
  return (
    <Link to={href} className={cn('mt-1 block rounded-lg border px-2.5 py-1.5 text-[12.5px]', mine ? 'border-primary-foreground/30 bg-primary-foreground/10' : 'bg-muted/40 hover:bg-muted')}>
      {card.isLoading ? <Skeleton className="h-8 w-48" /> : !card.data ? <span className="opacity-80">{t('A DrisPRO document you have no access to')}</span> : <>
        <span className="block text-[11px] opacity-75">{t(CARD_TITLE[kind] ?? 'Document')}</span>
        <span className="flex items-center gap-2"><b>{card.data.number}</b>{card.data.status && <StatusBadge status={card.data.status} />}</span>
        {card.data.party && <span className="block truncate">{card.data.party}</span>}
        {card.data.total != null && kind !== 'partner' && <span className="block font-semibold">{formatMoney(card.data.total, card.data.currency ?? undefined)}</span>}
      </>}
    </Link>
  )
}

/* ---------------------------------------------------------------------------------- starting */
function StartDialog({ kind, people, onClose, onOpen }: { kind: 'direct' | 'group'; people: ChatPerson[]; onClose: () => void; onOpen: (id: string) => void }) {
  const { user } = useAuth()
  const actions = useChatActions()
  const [q, setQ] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [chosen, setChosen] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const others = people.filter((p) => p.id !== user?.id)
  const shown = q.trim() ? fuzzyFind(others, q, (p) => ({ text: p.name, codes: [p.email] })) : others
  const go = async (fn: () => Promise<string>) => {
    setBusy(true)
    try { const id = await fn(); actions.refresh(); onOpen(id) } catch (e) { toast.error(tServer(describeError(e))) } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === 'direct' ? t('Write to someone') : t('A new group')}</DialogTitle>
          <DialogDescription>{kind === 'direct' ? t('Only you and that person see the conversation.') : t('Everyone in the group sees all its messages and files.')}</DialogDescription>
        </DialogHeader>
        {kind === 'group' && <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('The name of the group, e.g. Warehouse')} />}
        <Input autoFocus={kind === 'direct'} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search people')} />
        <div className="grid max-h-72 gap-0.5 overflow-y-auto rounded-md border p-1">
          {!shown.length && <p className="p-3 text-[13px] text-muted-foreground">{t('Nobody else in this company yet')}</p>}
          {shown.map((p) => kind === 'direct'
            ? <button key={p.id} type="button" disabled={busy} onClick={() => void go(() => actions.openDirect(p.id))} className="flex items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                <Avatar name={p.name} size={8} /><span className="min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block truncate text-[12px] text-muted-foreground">{p.email}</span></span></button>
            : <label key={p.id} className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-accent">
                <Checkbox checked={chosen.includes(p.id)} onCheckedChange={(c) => setChosen((x) => (c ? [...x, p.id] : x.filter((y) => y !== p.id)))} />
                <Avatar name={p.name} size={8} /><span className="truncate">{p.name}</span></label>)}
        </div>
        {kind === 'group' && (
          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            <Button loading={busy} disabled={title.trim().length < 2 || !chosen.length} onClick={() => void go(() => actions.createGroup(title.trim(), chosen))}>{t('Make the group')}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddPeopleDialog({ conv, people, current, onClose }: { conv: ChatConversation; people: ChatPerson[]; current: string[]; onClose: () => void }) {
  const actions = useChatActions()
  const [chosen, setChosen] = React.useState<string[]>([])
  const [busy, setBusy] = React.useState(false)
  const rest = people.filter((p) => !current.includes(p.id))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Add people to {name}', { name: conv.title ?? '' })}</DialogTitle>
          <DialogDescription>{t('They see the earlier messages too.')}</DialogDescription></DialogHeader>
        <div className="grid max-h-72 gap-0.5 overflow-y-auto rounded-md border p-1">
          {!rest.length && <p className="p-3 text-[13px] text-muted-foreground">{t('Everyone is already in the group')}</p>}
          {rest.map((p) => (
            <label key={p.id} className="flex items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-accent">
              <Checkbox checked={chosen.includes(p.id)} onCheckedChange={(c) => setChosen((x) => (c ? [...x, p.id] : x.filter((y) => y !== p.id)))} />
              <Avatar name={p.name} size={8} /><span className="truncate">{p.name}</span></label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={busy} disabled={!chosen.length} onClick={async () => {
            setBusy(true)
            try { await actions.addMembers(conv.id, chosen); actions.refresh(conv.id); onClose() } catch (e) { toast.error(tServer(describeError(e))) } finally { setBusy(false) }
          }}>{t('Add')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
