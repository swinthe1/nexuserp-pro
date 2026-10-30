import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Mail, MessageCircle, RotateCcw, Send, ShoppingCart, Sunrise } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, formatMoney } from '@/lib/utils'
import { t, tn, tServer } from '@/i18n'
import { AutomationCard } from './automation-card'

type Mailbox = { host: string; port: number; security: 'tls' | 'starttls' | 'none'; username: string | null; has_password: boolean; from_name: string | null
  from_email: string; reply_to: string | null; is_active: boolean; verified_at: string | null; last_error: string | null }
type Messaging = { summary_hour: number | null; summary_emails: string[]; summary_whatsapp: string[]; dunning_enabled: boolean; dunning_email: boolean
  dunning_whatsapp: boolean; dunning_steps: number[]; dunning_subject: string | null; dunning_text: string | null;
  reminder_before_enabled: boolean; reminder_before_days: number; reminder_before_text: string | null; po_email_auto: boolean; po_email_text: string | null
  mailbox: Mailbox | null; whatsapp_ready: boolean; whatsapp_module?: boolean }
type Msg = { id: string; channel: 'email' | 'whatsapp'; to_address: string; subject: string | null; purpose: string; status: string; attempts: number; last_error: string | null; sent_at: string | null; created_at: string }

// sample texts shown in empty fields (the customer-facing texts are Albanian on purpose)
const PH = {
  smtp: 'smtp.gmail.com', from: 'info@kompania.com', emails: 'pronari@kompania.com, menaxheri@kompania.com', phones: '+383 44 123 456', steps: '3, 15, 30',
  subject: 'Kujtesë pagese nga {company}', starttls: 'STARTTLS (587)', tls: 'SSL/TLS (465)', wa: 'WhatsApp',
  dunningText: 'Përshëndetje {customer},\n\nJu kujtojmë se këto fatura janë ende të papaguara:\n{invoices}\n\nGjithsej: {total}\n\nFaleminderit,\n{company} {phone}',
  beforeText: 'Përshëndetje {customer},\n\nJu kujtojmë me mirësjellje se këto pagesa kanë afat së shpejti:\n{invoices}\n\nGjithsej: {total}\n\nFaleminderit,\n{company} {phone}',
  po: 'Përshëndetje,\n\nJu lutemi na dërgoni mallin e mëposhtëm sipas porosisë {number}{date}.',
}
const list = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)

function useMessaging() {
  const { companyId } = useCompany()
  return useQuery({ queryKey: ['messaging', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('messaging_settings', { p_company: companyId! })) as unknown as Messaging })
}
function useSaveMessaging() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (p: Record<string, unknown>) => unwrap(await supabase.rpc('messaging_settings_save', { p_company: companyId!, p: p as never })),
    onSuccess: () => { toast.success(t('Saved')); void qc.invalidateQueries({ queryKey: ['messaging', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
}

export function MessagingSettings() {
  const { can } = useCompany()
  const q = useMessaging()
  if (!can('admin.read') || !q.data) return null
  const d = q.data
  const writer = can('admin.write')
  return (
    <>
      <MailboxCard m={d.mailbox} writer={writer} />
      <SummaryCard d={d} writer={writer} />
      <DunningCard d={d} writer={writer} />
      <PoCard d={d} writer={writer} />
      <MessagesCard />
    </>
  )
}

/* ------------------------------------------------------------------ the company's mailbox */
function MailboxCard({ m, writer }: { m: Mailbox | null; writer: boolean }) {
  const { companyId } = useCompany()
  const { user } = useAuth()
  const qc = useQueryClient()
  const [f, setF] = React.useState({ host: m?.host ?? '', port: String(m?.port ?? 587), security: m?.security ?? 'starttls', username: m?.username ?? '', password: '',
    from_name: m?.from_name ?? '', from_email: m?.from_email ?? '', reply_to: m?.reply_to ?? '' })
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }))
  const save = useMutation({
    mutationFn: async (remove?: boolean) => unwrap(await supabase.rpc('mail_account_save', { p_company: companyId!, p: (remove ? { remove: true } : { ...f, port: Number(f.port) }) as never })),
    onSuccess: () => { toast.success(t('Saved')); set({ password: '' }); void qc.invalidateQueries({ queryKey: ['messaging', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  const test = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('mail_account_test', { p_company: companyId!, p_to: user?.email ?? '' })),
    onSuccess: () => { toast.success(t('A test email is on its way to {email}. It shows below in a minute.', { email: user?.email ?? '' })); void qc.invalidateQueries({ queryKey: ['messages', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  // the usual mail services, filled in with one click
  const presets: [string, string, string, string][] = [['Gmail', 'smtp.gmail.com', '587', 'starttls'], ['Outlook / Microsoft 365', 'smtp.office365.com', '587', 'starttls'],
    ['Zoho', 'smtp.zoho.eu', '465', 'tls'], ['Hostinger', 'smtp.hostinger.com', '465', 'tls']]
  return (
    <AutomationCard icon={Mail} title={t('The company’s email')}
      aside={m ? (m.verified_at ? <Badge variant="outline" className="border-success/40 text-success">{t('Works')}</Badge>
        : m.last_error ? <Badge variant="outline" className="border-destructive/40 text-destructive">{t('Not working')}</Badge> : <Badge variant="outline">{t('Not tested')}</Badge>) : undefined}>
      <p className="text-[13px] text-muted-foreground">{t('Reminders, purchase orders and the morning summary go out from this mailbox, in the company’s name. For Gmail use an app password (Google account → Security → App passwords).')}</p>
      {m?.last_error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{m.last_error}</p>}
      <div className="flex flex-wrap gap-1.5">
        {presets.map(([n, h, p, s]) => <Button key={n} type="button" size="xs" variant="outline" disabled={!writer} onClick={() => set({ host: h, port: p, security: s as Mailbox['security'] })}>{n}</Button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_90px_150px]">
        <div className="grid gap-1.5"><Label htmlFor="mh">{t('Mail server (SMTP)')}</Label><Input id="mh" value={f.host} onChange={(e) => set({ host: e.target.value })} placeholder={PH.smtp} disabled={!writer} /></div>
        <div className="grid gap-1.5"><Label htmlFor="mp">{t('Port')}</Label><Input id="mp" type="number" value={f.port} onChange={(e) => set({ port: e.target.value })} disabled={!writer} /></div>
        <div className="grid gap-1.5"><Label>{t('Security|mail')}</Label>
          <Select value={f.security} onValueChange={(v) => set({ security: v as Mailbox['security'] })} disabled={!writer}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="starttls">{PH.starttls}</SelectItem><SelectItem value="tls">{PH.tls}</SelectItem><SelectItem value="none">{t('None')}</SelectItem></SelectContent>
          </Select></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5"><Label htmlFor="mu">{t('User name')}</Label><Input id="mu" value={f.username} onChange={(e) => set({ username: e.target.value })} autoComplete="off" disabled={!writer} /></div>
        <div className="grid gap-1.5"><Label htmlFor="mw">{t('Password')}</Label><Input id="mw" type="password" value={f.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password"
          placeholder={m?.has_password ? t('Saved; type only to change it') : ''} disabled={!writer} /></div>
        <div className="grid gap-1.5"><Label htmlFor="mf">{t('Sender address')}</Label><Input id="mf" type="email" value={f.from_email} onChange={(e) => set({ from_email: e.target.value })} placeholder={PH.from} disabled={!writer} /></div>
        <div className="grid gap-1.5"><Label htmlFor="mn">{t('Sender name')}</Label><Input id="mn" value={f.from_name} onChange={(e) => set({ from_name: e.target.value })} disabled={!writer} /></div>
        <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="mr">{t('Replies go to (optional)')}</Label><Input id="mr" type="email" value={f.reply_to} onChange={(e) => set({ reply_to: e.target.value })} disabled={!writer} /></div>
      </div>
      {writer && (
        <div className="flex flex-wrap justify-end gap-2">
          {m && <Button variant="ghost" className="text-destructive" disabled={save.isPending} onClick={() => save.mutate(true)}>{t('Remove')}</Button>}
          {m && <Button variant="outline" loading={test.isPending} onClick={() => test.mutate()}><Send /> {t('Send a test email')}</Button>}
          <Button loading={save.isPending} disabled={!f.host || !f.from_email} onClick={() => save.mutate(false)}>{t('Save')}</Button>
        </div>
      )}
    </AutomationCard>
  )
}

/* ------------------------------------------------------------------ the morning summary */
function SummaryCard({ d, writer }: { d: Messaging; writer: boolean }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const save = useSaveMessaging()
  const [emails, setEmails] = React.useState(d.summary_emails.join(', '))
  const [phones, setPhones] = React.useState(d.summary_whatsapp.join(', '))
  const now = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('summary_send_now', { p_company: companyId! })) as number,
    onSuccess: (n) => { toast.success(tn(n, '{n} summary on its way', '{n} summaries on their way')); void qc.invalidateQueries({ queryKey: ['messages', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <AutomationCard icon={Sunrise} title={t('Morning summary for the owner')}
      aside={<Switch checked={d.summary_hour != null} disabled={!writer || save.isPending} aria-label={t('Morning summary for the owner')} onCheckedChange={(on) => save.mutate({ summary_hour: on ? '7' : '' })} />}>
      <p className="text-[13px] text-muted-foreground">{t('Yesterday in one message: sales, cash, cash differences, open tills, low stock, overdue debts, bills due and what waits for approval.')}</p>
      {d.summary_hour != null && (
        <>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <div className="grid gap-1.5"><Label>{t('At')}</Label>
              <Select value={String(d.summary_hour)} disabled={!writer} onValueChange={(v) => save.mutate({ summary_hour: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Array.from({ length: 24 }, (_, h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="grid gap-1.5"><Label htmlFor="se">{t('Email addresses')}</Label>
              <Input id="se" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={PH.emails} disabled={!writer} /></div>
          </div>
          {d.whatsapp_module ? <div className="grid gap-1.5"><Label htmlFor="sw">{t('WhatsApp numbers')}</Label>
            <Input id="sw" value={phones} onChange={(e) => setPhones(e.target.value)} placeholder={PH.phones} disabled={!writer} />
            {!d.whatsapp_ready && <p className="text-xs text-warning">{t('WhatsApp starts working once the DrisPRO business number is connected; until then only the email goes out.')}</p>}</div>
            : <WhatsAppOff />}
          {writer && <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" loading={now.isPending} onClick={() => now.mutate()}><Send /> {t('Send it now')}</Button>
            <Button loading={save.isPending} onClick={() => save.mutate({ summary_emails: list(emails), summary_whatsapp: list(phones) })}>{t('Save')}</Button>
          </div>}
        </>
      )}
    </AutomationCard>
  )
}

function WhatsAppOff() {
  return <p className="text-xs text-muted-foreground">{t('Sending by WhatsApp is a separate module (each message has a cost). Ask DrisPRO to add it to your licence.')}</p>
}

/* ------------------------------------------------------------------ reminders for overdue invoices */
function DunningCard({ d, writer }: { d: Messaging; writer: boolean }) {
  const { companyId } = useCompany()
  const save = useSaveMessaging()
  const [steps, setSteps] = React.useState(d.dunning_steps.join(', '))
  const [subject, setSubject] = React.useState(d.dunning_subject ?? '')
  const [text, setText] = React.useState(d.dunning_text ?? '')
  const [beforeDays, setBeforeDays] = React.useState(String(d.reminder_before_days ?? 3))
  const [beforeText, setBeforeText] = React.useState(d.reminder_before_text ?? '')
  const preview = useQuery({ queryKey: ['dunning-preview', companyId], enabled: !!companyId && (d.dunning_enabled || d.reminder_before_enabled),
    queryFn: async () => unwrap(await supabase.rpc('dunning_preview', { p_company: companyId! })) as unknown as { partner_id: string; partner_name: string; email: string | null; phone: string | null; step: number; total: number; invoices: number; kind: string }[] })
  return (
    <AutomationCard icon={BellRing} title={t('Payment reminders')}
      aside={<Switch checked={d.dunning_enabled} disabled={!writer || save.isPending} aria-label={t('Reminders for overdue invoices')} onCheckedChange={(v) => save.mutate({ dunning_enabled: v })} />}>
      <p className="text-[13px] text-muted-foreground">{t('Every morning at 9, each customer whose invoices passed a step gets one message listing them. A step is sent once per invoice; an invoice in instalments is reminded instalment by instalment.')}</p>
      <div className="grid gap-3 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm font-medium"><Switch checked={d.reminder_before_enabled} disabled={!writer || save.isPending} onCheckedChange={(v) => save.mutate({ reminder_before_enabled: v })} />
          {t('Also remind before the due date')}</label>
        {d.reminder_before_enabled && <>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Input id="rbd" inputMode="numeric" className="h-8 w-16 text-right" value={beforeDays} onChange={(e) => setBeforeDays(e.target.value)} disabled={!writer} aria-label={t('Days before the due date')} />
            <span className="text-muted-foreground">{t('days before the due date (each invoice or instalment once)')}</span>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="rbt">{t('Text')}</Label>
            <Textarea id="rbt" rows={5} value={beforeText} onChange={(e) => setBeforeText(e.target.value)} disabled={!writer} placeholder={PH.beforeText} />
            <p className="text-xs text-muted-foreground">{t('Leave empty for the standard text. You can use {customer}, {invoices}, {total}, {date}, {company}, {phone}, {email}.')}</p></div>
          {writer && <div className="flex justify-end"><Button size="sm" loading={save.isPending} onClick={() => save.mutate({ reminder_before_days: Number(beforeDays) || 3, reminder_before_text: beforeText })}>{t('Save')}</Button></div>}
        </>}
      </div>
      {d.dunning_enabled && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="grid gap-1.5"><Label htmlFor="ds">{t('Days after the due date')}</Label>
              <Input id="ds" value={steps} onChange={(e) => setSteps(e.target.value)} placeholder={PH.steps} disabled={!writer} /></div>
            <label className="flex h-10 items-center gap-2 text-sm"><Switch checked={d.dunning_email} disabled={!writer} onCheckedChange={(v) => save.mutate({ dunning_email: v })} /> {t('Email')}</label>
            {d.whatsapp_module && <label className="flex h-10 items-center gap-2 text-sm"><Switch checked={d.dunning_whatsapp} disabled={!writer} onCheckedChange={(v) => save.mutate({ dunning_whatsapp: v })} /> {PH.wa}</label>}
          </div>
          <div className="grid gap-1.5"><Label htmlFor="dsub">{t('Subject')}</Label>
            <Input id="dsub" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={PH.subject} disabled={!writer} /></div>
          <div className="grid gap-1.5"><Label htmlFor="dtx">{t('Text')}</Label>
            <Textarea id="dtx" rows={6} value={text} onChange={(e) => setText(e.target.value)} disabled={!writer}
              placeholder={PH.dunningText} />
            <p className="text-xs text-muted-foreground">{t('Leave empty for the standard text. You can use {customer}, {invoices}, {total}, {days}, {company}, {phone}, {email}.')}</p></div>
          {writer && <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate({ dunning_steps: list(steps), dunning_subject: subject, dunning_text: text })}>{t('Save')}</Button></div>}
          {!!preview.data?.length && (
            <div className="grid gap-1 rounded-md border p-3">
              <div className="text-xs font-medium text-muted-foreground">{t('The next round would remind')}</div>
              {preview.data.slice(0, 8).map((p) => (
                <div key={p.partner_id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate">{p.partner_name} <span className="text-muted-foreground">· {p.kind === 'upcoming' ? t('due soon') : t('{n} days late', { n: p.step })}{!p.email && !p.phone ? ` · ${t('no email or phone')}` : ''}</span></span>
                  <span className="shrink-0 tabular">{formatMoney(p.total)}</span>
                </div>
              ))}
              {preview.data.length > 8 && <div className="text-xs text-muted-foreground">{t('and {n} more', { n: preview.data.length - 8 })}</div>}
            </div>
          )}
        </>
      )}
    </AutomationCard>
  )
}

/* ------------------------------------------------------------------ purchase orders */
function PoCard({ d, writer }: { d: Messaging; writer: boolean }) {
  const save = useSaveMessaging()
  const [text, setText] = React.useState(d.po_email_text ?? '')
  return (
    <AutomationCard icon={ShoppingCart} title={t('Purchase orders to the vendor')}
      aside={<Switch checked={d.po_email_auto} disabled={!writer || save.isPending} aria-label={t('Purchase orders to the vendor')} onCheckedChange={(v) => save.mutate({ po_email_auto: v })} />}>
      <p className="text-[13px] text-muted-foreground">{t('When a purchase order is approved, it goes to the vendor’s email with its lines (their codes too) and the total. Each order can also be sent by hand from its page.')}</p>
      {d.po_email_auto && (
        <>
          <div className="grid gap-1.5"><Label htmlFor="pot">{t('Opening text')}</Label>
            <Textarea id="pot" rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={!writer}
              placeholder={PH.po} />
            <p className="text-xs text-muted-foreground">{t('You can use {number}, {date}, {vendor}, {company}.')}</p></div>
          {writer && <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate({ po_email_text: text })}>{t('Save')}</Button></div>}
        </>
      )}
    </AutomationCard>
  )
}

/* ------------------------------------------------------------------ what went out */
function MessagesCard() {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['messages', companyId], enabled: !!companyId, refetchInterval: 15000,
    queryFn: async () => unwrap(await supabase.rpc('messages_list', { p_company: companyId!, p_limit: 50 })) as unknown as Msg[] })
  const retry = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('message_retry', { p_id: id })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['messages', companyId] }),
    onError: (e) => toast.error(describeError(e)),
  })
  const purpose: Record<string, string> = { summary: t('Summary'), dunning: t('Reminder'), purchase_order: t('Purchase order'), test: t('Test'), other: t('Other') }
  const status: Record<string, [string, string]> = { queued: [t('Waiting'), 'text-muted-foreground'], sending: [t('Sending'), 'text-primary'], sent: [t('Sent'), 'text-success'],
    relayed: [t('Sent through the cloud'), 'text-success'], failed: [t('Not sent'), 'text-destructive'] }
  return (
    <AutomationCard icon={MessageCircle} title={t('Messages sent')}>
      {!q.data?.length ? <p className="text-[13px] text-muted-foreground">{t('Nothing has gone out yet.')}</p> : (
        <ul className="grid divide-y rounded-md border">
          {q.data.map((m) => {
            const [label, cls] = status[m.status] ?? [m.status, '']
            return (
              <li key={m.id} className="grid gap-0.5 px-3 py-2 text-[13px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate"><span className="text-muted-foreground">{m.channel === 'email' ? t('Email') : PH.wa} · {purpose[m.purpose] ?? m.purpose} · </span>{m.to_address}</span>
                  <span className={cn('shrink-0 text-xs font-medium', cls)}>{label}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="min-w-0 truncate">{m.subject ?? ''} · {formatDate(m.sent_at ?? m.created_at, true)}</span>
                  {m.status === 'failed' && can('admin.write') && <Button size="xs" variant="ghost" onClick={() => retry.mutate(m.id)}><RotateCcw /> {t('Try again')}</Button>}
                </div>
                {m.status === 'failed' && m.last_error && <div className="text-xs text-destructive">{tServer(m.last_error)}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </AutomationCard>
  )
}
