import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Mail, MessageCircle, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Can } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate } from '@/lib/utils'

type Sent = { id: string; at: string; channel: string; to_address: string; subject: string | null; status: string; sent_at: string | null; last_error: string | null }

/** Send a reminder to one customer now: what is late, or (when nothing is late) what falls due next */
export function useSendReminder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (partner: string) => unwrap(await supabase.rpc('send_reminder_now', { p_partner: partner })) as unknown as { kind: string; messages: number; items: number },
    onSuccess: (r) => {
      toast.success(r.kind === 'overdue' ? t('Reminder sent for {n} late payments', { n: r.items }) : t('Reminder sent for {n} payments falling due', { n: r.items }))
      void qc.invalidateQueries({ queryKey: ['reminders'] })
    },
    onError: (e) => toast.error(describeError(e)),
  })
}

/** On the customer's page: leave them out of reminders, send one now, and every reminder they got */
export function CustomerReminders({ partnerId, noReminders, hasContact }: { partnerId: string; noReminders: boolean; hasContact: boolean }) {
  const qc = useQueryClient()
  const send = useSendReminder()
  const hist = useQuery({
    queryKey: ['reminders', partnerId],
    queryFn: async () => unwrap(await supabase.rpc('reminder_history', { p_partner: partnerId })) as unknown as Sent[],
  })
  const toggle = useMutation({
    mutationFn: async (off: boolean) => unwrap(await supabase.from('business_partners').update({ no_reminders: off } as never).eq('id', partnerId)),
    onSuccess: () => { void qc.invalidateQueries(); toast.success(t('Saved')) },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Card className="max-w-3xl">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div><CardTitle className="flex items-center gap-2"><BellRing className="size-4 text-muted-foreground" /> {t('Payment reminders')}</CardTitle>
          <CardDescription>{t('Reminders go by themselves before the due date and when payments are late, as set in Settings → Automations.')}</CardDescription></div>
        <Can perm="invoicing.write"><Button size="sm" variant="outline" disabled={!hasContact || noReminders} loading={send.isPending} onClick={() => send.mutate(partnerId)}><Send /> {t('Send a reminder now')}</Button></Can>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Can perm="invoicing.write">
          <div className="flex items-center gap-2">
            <Switch id="no-rem" checked={!noReminders} onCheckedChange={(v) => toggle.mutate(!v)} />
            <Label htmlFor="no-rem">{t('Send reminders to this customer')}</Label>
          </div>
        </Can>
        {!hasContact && <p className="text-[13px] text-warning">{t('The customer has no email or phone, so no reminder can reach them.')}</p>}
        {hist.isLoading ? <Skeleton className="h-16" /> : !hist.data?.length ? <p className="text-[13px] text-muted-foreground">{t('No reminders sent yet.')}</p> : (
          <ul className="divide-y rounded-md border text-[13px]">
            {hist.data.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                {m.channel === 'whatsapp' ? <MessageCircle className="size-4 shrink-0 text-muted-foreground" /> : <Mail className="size-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1"><div className="truncate">{m.subject ?? t('WhatsApp message')}</div>
                  <div className="truncate text-xs text-muted-foreground">{m.to_address}{m.last_error ? ` · ${m.last_error}` : ''}</div></div>
                <span className="shrink-0 text-xs text-muted-foreground tabular">{formatDate(m.sent_at ?? m.at, true)}</span>
                <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium', m.status === 'sent' ? 'bg-success/10 text-success' : m.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>
                  {m.status === 'sent' ? t('Sent|message') : m.status === 'failed' ? t('Not sent') : t('Waiting to go')}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
