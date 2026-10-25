import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, History, Loader2, MessageSquarePlus, Sparkles, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useLocation } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate } from '@/lib/utils'
import { msg, t, tServer } from '@/i18n'
import { Markdown } from './markdown'

type Msg = { id: string; role: 'user' | 'assistant'; content: string; created_at: string }
type State = { id: string; title: string | null; messages: Msg[]; job: { id: string; status: 'queued' | 'running' | 'done' | 'failed'; step: string | null; error: string | null } | null }

const busy = (s?: State) => s?.job?.status === 'queued' || s?.job?.status === 'running'

/** what the assistant is doing, by the tool it is using */
function stepLabel(step: string | null | undefined) {
  switch (step) {
    case 'search': return t('Searching…')
    case 'find_items': return t('Looking at the items…')
    case 'partner_balance': return t('Looking at the open invoices…')
    case 'find_document': return t('Opening the document…')
    case 'low_stock': return t('Checking the stock…')
    case 'day_summary': return t('Looking at the day…')
    case 'report': return t('Adding up the numbers…')
    default: return t('Thinking…')
  }
}

const SUGGESTIONS = [
  msg('How much did we sell this month, and to whom?'),
  msg('Who owes us money and how late are they?'),
  msg('What do I need to order?'),
  msg('How did yesterday go?'),
]

export function AssistantButton() {
  const { hasFeature } = useCompany()
  return hasFeature('ai_assistant') ? <AssistantLauncher /> : null
}

function AssistantLauncher() {
  const [open, setOpen] = React.useState(false)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setOpen((o) => !o) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-primary hover:text-primary" onClick={() => setOpen(true)} aria-label={t('Assistant')} title={t('Assistant') + ' (Ctrl J)'}>
        <Sparkles className="size-4" /><span className="hidden md:inline">{t('Assistant')}</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="gap-0 p-0 sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
          {open && <AssistantPanel onClose={() => setOpen(false)} />}
        </SheetContent>
      </Sheet>
    </>
  )
}

function AssistantPanel({ onClose }: { onClose: () => void }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const { pathname } = useLocation()
  const [conv, setConv] = React.useState<string | null>(() => { try { return sessionStorage.getItem('drispro.assistant.' + companyId) } catch { return null } })
  const [showHistory, setShowHistory] = React.useState(false)
  const [text, setText] = React.useState('')
  const scroller = React.useRef<HTMLDivElement>(null)
  const input = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => { try { if (conv) sessionStorage.setItem('drispro.assistant.' + companyId, conv); else sessionStorage.removeItem('drispro.assistant.' + companyId) } catch { /* private window */ } }, [conv, companyId])
  React.useEffect(() => { setTimeout(() => input.current?.focus(), 50) }, [])

  const usage = useQuery({ queryKey: ['assistant-usage', companyId],
    queryFn: async () => unwrap(await supabase.rpc('assistant_usage', { p_company: companyId })) as unknown as { used: number; limit: number } })
  const state = useQuery({
    queryKey: ['assistant', conv], enabled: !!conv, retry: false,
    queryFn: async () => unwrap(await supabase.rpc('assistant_state', { p_conversation: conv! })) as unknown as State,
    refetchInterval: (q) => (busy(q.state.data as State | undefined) ? 800 : false),
  })
  React.useEffect(() => { if (state.isError) setConv(null) }, [state.isError])
  const history = useQuery({ queryKey: ['assistant-list', companyId], enabled: showHistory,
    queryFn: async () => unwrap(await supabase.rpc('assistant_conversations', { p_company: companyId })) as unknown as { id: string; title: string | null; updated_at: string }[] })

  const s = state.data
  const waiting = busy(s)
  const wasWaiting = React.useRef(false)
  React.useEffect(() => {
    if (wasWaiting.current && !waiting) void qc.invalidateQueries({ queryKey: ['assistant-usage', companyId] })
    wasWaiting.current = waiting
  }, [waiting, qc, companyId])
  React.useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [s?.messages.length, waiting])

  const send = useMutation({
    mutationFn: async (q: string) => unwrap(await supabase.rpc('assistant_send', {
      p_company: companyId, p_conversation: conv as string, p_text: q, p_context: { path: pathname, title: document.title } })) as unknown as { conversation_id: string },
    onSuccess: (r) => { setText(''); setConv(r.conversation_id); void qc.invalidateQueries({ queryKey: ['assistant', r.conversation_id] }); void qc.invalidateQueries({ queryKey: ['assistant-usage', companyId] }) },
  })
  const forget = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('assistant_forget', { p_conversation: id })),
    onSuccess: (_r, id) => { if (id === conv) setConv(null); void qc.invalidateQueries({ queryKey: ['assistant-list', companyId] }) },
  })

  const ask = (q: string) => { const v = q.trim(); if (v && !waiting && !send.isPending) send.mutate(v) }
  const lastQuestion = [...(s?.messages ?? [])].reverse().find((m) => m.role === 'user')?.content
  const full = usage.data && usage.data.used >= usage.data.limit

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="flex-row items-center gap-1 space-y-0 py-3 pl-4 pr-11">
        <Sparkles className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <SheetTitle className="text-sm">{t('Assistant')}</SheetTitle>
          <SheetDescription className="text-2xs">
            {usage.data ? t('{used} of {limit} questions this month', { used: usage.data.used, limit: usage.data.limit }) : t('Ask about your sales, stock, debts and documents')}
          </SheetDescription>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => setShowHistory((v) => !v)} aria-label={t('Earlier conversations')} title={t('Earlier conversations')}
          className={cn(showHistory && 'bg-secondary')}><History /></Button>
        <Button variant="ghost" size="icon-sm" onClick={() => { setConv(null); setShowHistory(false); input.current?.focus() }} aria-label={t('New conversation')} title={t('New conversation')}>
          <MessageSquarePlus />
        </Button>
      </SheetHeader>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {showHistory ? (
          <div className="space-y-1">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t('Earlier conversations')}</p>
            {history.isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            {history.data?.length === 0 && <p className="text-sm text-muted-foreground">{t('No conversations yet.')}</p>}
            {history.data?.map((h) => (
              <div key={h.id} className={cn('group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-secondary', h.id === conv && 'bg-secondary')}>
                <button className="min-w-0 flex-1 text-left" onClick={() => { setConv(h.id); setShowHistory(false) }}>
                  <div className="truncate text-sm">{h.title ?? t('Conversation')}</div>
                  <div className="text-2xs text-muted-foreground">{formatDate(h.updated_at, true)}</div>
                </button>
                <Button variant="ghost" size="icon-sm" className="opacity-60 group-hover:opacity-100" aria-label={t('Forget')} title={t('Forget')}
                  onClick={() => forget.mutate(h.id)}><Trash2 /></Button>
              </div>
            ))}
          </div>
        ) : !conv || !s ? (
          conv && state.isLoading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : (
            <div className="flex h-full flex-col justify-end gap-3 pb-2">
              <div>
                <p className="text-sm font-medium">{t('What do you want to know?')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('The assistant reads your company\u2019s data with your permissions and answers with links to the documents. For now it only reads: it does not change or send anything.')}</p>
              </div>
              <div className="flex flex-col items-start gap-1.5">
                {SUGGESTIONS.map((q) => (
                  <button key={q} disabled={!!full || send.isPending} onClick={() => ask(t(q))}
                    className="rounded-full border bg-background px-3 py-1.5 text-left text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50">{t(q)}</button>
                ))}
              </div>
            </div>
          )
        ) : (
          <div className="space-y-4">
            {s.messages.map((m) => m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">{m.content}</div>
              </div>
            ) : (
              <div key={m.id} className="flex gap-2">
                <Sparkles className="mt-1 size-3.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1"><Markdown text={m.content} onNavigate={onClose} /></div>
              </div>
            ))}
            {waiting && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                <Loader2 className="size-3.5 animate-spin text-primary" />{stepLabel(s.job?.step)}
              </div>
            )}
            {s.job?.status === 'failed' && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                <p className="text-destructive">{tServer(s.job.error ?? 'The assistant could not answer')}</p>
                {lastQuestion && !full && <Button variant="outline" size="sm" className="mt-2" disabled={send.isPending} onClick={() => ask(lastQuestion)}>{t('Ask again')}</Button>}
              </div>
            )}
          </div>
        )}
      </div>

      <form className="border-t p-3" onSubmit={(e) => { e.preventDefault(); ask(text) }}>
        {send.isError && <p className="mb-2 text-xs text-destructive">{describeError(send.error)}</p>}
        {full && <p className="mb-2 text-xs text-muted-foreground">{t('This month\u2019s questions are used up. The assistant starts again on the 1st.')}</p>}
        <div className="flex items-end gap-2 rounded-xl border bg-background px-2 py-1.5 focus-within:border-ring/60">
          <textarea
            ref={input} rows={1} value={text} maxLength={4000} disabled={!!full}
            onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(text) } }}
            placeholder={t('Ask something…')}
            className="max-h-36 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-base outline-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 sm:text-sm"
          />
          <Button type="submit" size="icon-sm" className="mb-0.5 rounded-full" disabled={!text.trim() || waiting || send.isPending || !!full} aria-label={t('Send')}>
            {send.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
          </Button>
        </div>
      </form>
    </div>
  )
}
