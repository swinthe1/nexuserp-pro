import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, Send, Trash2, Webhook } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate } from '@/lib/utils'
import { WEBHOOK_EVENTS } from './api-calls'

type Hook = { id: string; url: string; events: string[]; description: string | null; is_active: boolean; failures: number; last_status: number | null; last_error: string | null
  last_at: string | null; created_at: string; secret_hint: string
  recent: { id: string; event: string; status: 'queued' | 'sending' | 'sent' | 'failed'; attempts: number; response: number | null; error: string | null; created_at: string }[] }

/** Tell another program the moment something happens in DrisPRO. */
export function WebhooksCard() {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const [adding, setAdding] = React.useState(false)
  const [open, setOpen] = React.useState<string | null>(null)
  const list = useQuery({ queryKey: ['webhooks', companyId], enabled: !!companyId, refetchInterval: 15_000,
    queryFn: async () => unwrap(await supabase.rpc('webhooks_list', { p_company: companyId! })) as unknown as Hook[] })
  const done = () => void qc.invalidateQueries({ queryKey: ['webhooks', companyId] })
  const update = useMutation({ mutationFn: async (a: { id: string; p: Record<string, unknown> }) => unwrap(await supabase.rpc('webhook_update', { p_id: a.id, p: a.p as never })), onSuccess: done, onError: (e) => toast.error(describeError(e)) })
  const test = useMutation({ mutationFn: async (id: string) => unwrap(await supabase.rpc('webhook_test', { p_id: id })), onSuccess: () => { toast.success(t('A test message is on its way')); done() }, onError: (e) => toast.error(describeError(e)) })
  const write = can('admin.write')
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 py-3">
        <CardTitle className="flex items-center gap-2"><Webhook className="size-4" /> {t('Webhooks')}</CardTitle>
        {write && <Button size="sm" onClick={() => setAdding(true)}><Plus /> {t('New webhook')}</Button>}
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-[13px] text-muted-foreground">{t('DrisPRO calls your address the moment something happens: an invoice posted, a payment, a new order, low stock. Each message is signed with your secret.')}{' '}
          <Link to="/api#webhooks" className="text-primary hover:underline">{t('How to receive them')}</Link></p>
        {(list.data ?? []).length > 0 && (
          <ul className="divide-y rounded-lg border">
            {list.data!.map((h) => (
              <li key={h.id} className="grid gap-1.5 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 truncate text-[12px]">{h.url}</code>
                  {!h.is_active && <Badge variant="outline">{t('Switched off')}</Badge>}
                  {h.failures > 0 && h.is_active && <Badge variant="outline" className="border-warning/50 text-warning">{t('{n} failures in a row', { n: h.failures })}</Badge>}
                  <span className="ml-auto flex items-center gap-1">
                    {write && <>
                      <Button size="xs" variant="ghost" onClick={() => test.mutate(h.id)}><Send /> {t('Test')}</Button>
                      <Switch checked={h.is_active} aria-label={t('Active')} onCheckedChange={(v) => update.mutate({ id: h.id, p: { is_active: v } })} />
                      <Button size="icon" variant="ghost" className="size-8" aria-label={t('Remove')} onClick={() => update.mutate({ id: h.id, p: { delete: true } })}><Trash2 /></Button>
                    </>}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">{h.events.map((e) => <Badge key={e} variant="secondary" className="font-mono text-[11px]">{e}</Badge>)}</div>
                <button type="button" className="justify-self-start text-xs text-muted-foreground hover:underline" onClick={() => setOpen(open === h.id ? null : h.id)}>
                  {h.last_at ? t('Last: {date} · {result}', { date: formatDate(h.last_at, true), result: h.last_error ? h.last_error : String(h.last_status ?? '') }) : t('Nothing sent yet')}
                </button>
                {open === h.id && (
                  <ul className="grid gap-0.5 rounded-md bg-muted/60 p-2 text-xs">
                    {h.recent.map((d) => (
                      <li key={d.id} className="flex gap-2"><span className="tabular text-muted-foreground">{formatDate(d.created_at, true)}</span><span className="font-mono">{d.event}</span>
                        <span className={cn('ml-auto', d.status === 'sent' ? 'text-success' : d.status === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
                          {d.status === 'sent' ? `✓ ${d.response ?? ''}` : d.status === 'failed' ? `${d.error ?? ''} · ${t('try {n}', { n: d.attempts })}` : t('waiting')}</span></li>
                    ))}
                    {!h.recent.length && <li className="text-muted-foreground">{t('Nothing sent yet')}</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {adding && <NewWebhook onClose={() => { setAdding(false); done() }} />}
    </Card>
  )
}

function NewWebhook({ onClose }: { onClose: () => void }) {
  const { companyId } = useCompany()
  const [url, setUrl] = React.useState('https://')
  const [events, setEvents] = React.useState<string[]>(['invoice.posted', 'payment.received'])
  const [secret, setSecret] = React.useState<string | null>(null)
  const make = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('webhook_create', { p_company: companyId!, p_url: url.trim(), p_events: events })) as unknown as { secret: string },
    onSuccess: (r) => setSecret(r.secret), onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{secret ? t('The webhook is ready') : t('New webhook')}</DialogTitle>
          <DialogDescription>{secret ? t('Copy the secret now: it is shown only this once. Your program uses it to check that a message really comes from DrisPRO.') : t('The address of your program that receives the messages, and what it should hear about.')}</DialogDescription></DialogHeader>
        {secret ? (
          <div className="flex gap-2"><Input readOnly value={secret} onFocus={(e) => e.target.select()} className="font-mono text-[12px]" aria-label={t('Secret')} />
            <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(secret).then(() => toast.success(t('Copied')))}><Copy /> {t('Copy')}</Button></div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="wu">{t('Address')}</Label><Input id="wu" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
            <fieldset className="grid gap-1.5"><legend className="mb-1 text-sm font-medium">{t('What to send')}</legend>
              {WEBHOOK_EVENTS.map((e) => (
                <label key={e.key} className="flex items-start gap-2 text-sm">
                  <Checkbox className="mt-0.5" checked={events.includes(e.key)} onCheckedChange={(v) => setEvents((x) => (v ? [...x, e.key] : x.filter((y) => y !== e.key)))} />
                  <span>{t(e.what)} <code className="text-[11px] text-muted-foreground">{e.key}</code></span>
                </label>
              ))}
            </fieldset>
          </div>
        )}
        <DialogFooter>{secret ? <Button onClick={onClose}>{t('Done')}</Button> : <>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button loading={make.isPending} disabled={!/^https?:\/\/\S+\.\S+/.test(url.trim()) || !events.length} onClick={() => make.mutate()}>{t('Make the webhook')}</Button></>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
