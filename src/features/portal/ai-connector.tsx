import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Sparkles, Trash2 } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'

type Connector = { id: string; name: string; prefix: string; can_draft: boolean; is_active: boolean; created_at: string; last_used_at: string | null; calls: number }

/** The app's own address: the assistants call https://<it>/mcp/<key>. */
function appOrigin() {
  return /^https?:$/.test(window.location.protocol) && !/^(localhost|127\.)/.test(window.location.hostname) ? window.location.origin : 'https://erp.dris-ks.com' // i18n-ignore
}

/** A person's own links that let ChatGPT or Claude look at the company with that person's rights. */
export function AiConnectorPanel() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const [draft, setDraft] = React.useState(false)
  const [made, setMade] = React.useState<string | null>(null)
  const list = useQuery({
    queryKey: ['ai-connectors', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('ai_connectors', { p_company: companyId! })) as unknown as Connector[],
  })
  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('ai_connector_create', { p_company: companyId!, p_can_draft: draft })) as unknown as { key: string },
    onSuccess: (r) => { setMade(`${appOrigin()}/mcp/${r.key}`); void qc.invalidateQueries({ queryKey: ['ai-connectors', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  const revoke = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('ai_connector_revoke', { p_id: id })),
    onSuccess: () => { toast.success(t('The link no longer works')); void qc.invalidateQueries({ queryKey: ['ai-connectors', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  const copy = (s: string) => void navigator.clipboard?.writeText(s).then(() => toast.success(t('Copied')))
  const links = (list.data ?? []).filter((c) => c.is_active)
  return (
    <div className="grid gap-4 text-sm">
      <p className="text-[13px] text-muted-foreground">
        {t('Ask about your business in ChatGPT or Claude: “How much did we sell yesterday?”, “Who owes us the most?”, “Prepare an invoice for Viva Fresh with 10 boxes of water”. They see only what you may see in DrisPRO, and can at most prepare drafts: you check and book them here.')}
      </p>

      {made ? (
        <div className="grid gap-2 rounded-lg border border-primary/40 bg-primary/[0.04] p-3">
          <p className="font-medium">{t('Your link is ready. Copy it now: it is shown only this once.')}</p>
          <div className="flex gap-2">
            <Input readOnly value={made} onFocus={(e) => e.target.select()} className="font-mono text-[12px]" aria-label={t('Link')} />
            <Button variant="outline" onClick={() => copy(made)}><Copy /> {t('Copy')}</Button>
          </div>
          <p className="text-[12px] text-muted-foreground">{t('Whoever has this link sees the company as you. Do not share it; if it leaks, remove it below and make a new one.')}</p>
          <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setMade(null)}>{t('Done')}</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <label className="flex items-start gap-3">
            <Switch checked={draft} onCheckedChange={setDraft} aria-label={t('May prepare drafts')} />
            <span><span className="font-medium">{t('May prepare drafts')}</span>
              <span className="block text-[12px] text-muted-foreground">{t('Sales invoices and purchase orders, as drafts only. Off: it only reads.')}</span></span>
          </label>
          <Button loading={create.isPending} onClick={() => create.mutate()}><Sparkles /> {t('Make my link')}</Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3">
          <p className="mb-1.5 font-medium">Claude</p>{/* i18n-ignore */}
          <ol className="list-decimal space-y-1 pl-4 text-[13px] text-muted-foreground">
            <li>{t('Open claude.ai › Settings › Connectors.')}</li>
            <li>{t('Choose “Add custom connector”, name it DrisPRO and paste the link.')}</li>
            <li>{t('In a new chat, switch DrisPRO on under the tools button and ask.')}</li>
          </ol>
        </div>
        <div className="rounded-lg border p-3">
          <p className="mb-1.5 font-medium">ChatGPT</p>{/* i18n-ignore */}
          <ol className="list-decimal space-y-1 pl-4 text-[13px] text-muted-foreground">
            <li>{t('Open ChatGPT › Settings › Apps and connectors › Advanced, and switch on developer mode.')}</li>
            <li>{t('Choose “Create”, name it DrisPRO, paste the link and pick “No authentication”.')}</li>
            <li>{t('In a new chat, add DrisPRO from the + button and ask.')}</li>
          </ol>
        </div>
      </div>

      {links.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {links.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <code className="rounded bg-muted px-1.5 text-[12px]">{c.prefix}…</code>
              <Badge variant={c.can_draft ? 'info' : 'secondary'}>{c.can_draft ? t('Reads and prepares drafts') : t('Reads only')}</Badge>
              <span className="text-[12px] text-muted-foreground">{t('made {date}|link', { date: formatDate(c.created_at) })}</span>
              <span className="ml-auto flex items-center gap-2 text-[12px] text-muted-foreground">
                {c.last_used_at ? t('{n} calls, last {date}', { n: c.calls, date: formatDate(c.last_used_at, true) }) : t('never used')}
                <Button variant="ghost" size="icon" aria-label={t('Remove the link')} title={t('Remove the link')} onClick={() => revoke.mutate(c.id)}><Trash2 /></Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AiConnectorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('DrisPRO in ChatGPT and Claude')}</DialogTitle>
          <DialogDescription>{t('Your personal link, for the company you are in now.')}</DialogDescription>
        </DialogHeader>
        {open && <AiConnectorPanel />}
      </DialogContent>
    </Dialog>
  )
}
