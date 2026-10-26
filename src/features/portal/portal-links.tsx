import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Link2, MessageCircle, Plus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
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
import { formatDate } from '@/lib/utils'
import type { Json } from '@/lib/database.types'

type Link = { id: string; label: string | null; key_prefix: string; can_order: boolean; can_see_invoices: boolean; is_active: boolean
  expires_on: string | null; created_at: string; last_used_at: string | null; uses: number; locked_until: string | null }

export const portalUrl = (key: string) => `${window.location.origin}/b2b#${key}`

/** The customer's private links to their B2B portal. */
export function PortalLinks({ partner }: { partner: { id: string; name: string; phone?: string | null } }) {
  const { can } = useCompany()
  const qc = useQueryClient()
  const [adding, setAdding] = React.useState(false)
  const links = useQuery({
    queryKey: ['portal-links', partner.id],
    queryFn: async () => unwrap(await supabase.from('portal_links' as never).select('id, label, key_prefix, can_order, can_see_invoices, is_active, expires_on, created_at, last_used_at, uses, locked_until')
      .eq('partner_id', partner.id).order('created_at', { ascending: false })) as unknown as Link[],
  })
  const set = useMutation({
    mutationFn: async (a: { id: string; p: Record<string, unknown> }) => unwrap(await supabase.rpc('portal_link_set', { p_id: a.id, p: a.p as Json })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['portal-links', partner.id] }),
    onError: (e) => toast.error(describeError(e)),
  })
  const manage = can('sales.approve')
  return (
    <Card className="max-w-3xl">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 py-3">
        <CardTitle>{t('B2B portal')}</CardTitle>
        {manage && <Button size="sm" onClick={() => setAdding(true)}><Plus /> {t('New link')}</Button>}
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-[13px] text-muted-foreground">{t('With a private link the customer sees their prices and stock, sends orders and sees their invoices and what they owe, without an account. Orders arrive as sales orders for you to confirm.')}</p>
        {(links.data ?? []).length === 0 ? <EmptyState compact icon={Link2} title={t('No link yet')} /> : (
          <ul className="divide-y rounded-lg border">
            {links.data!.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
                <span className="font-medium">{l.label || l.key_prefix + '…'}</span>
                {!l.is_active && <Badge variant="outline">{t('Switched off')}</Badge>}
                {l.locked_until && new Date(l.locked_until) > new Date() && <Badge variant="destructive">{t('Locked: wrong PINs')}</Badge>}
                <span className="text-[12px] text-muted-foreground">
                  {[l.can_order ? t('orders') : null, l.can_see_invoices ? t('invoices') : null].filter(Boolean).join(' · ')}
                  {l.expires_on && ` · ${t('until {date}', { date: formatDate(l.expires_on) })}`}
                  {` · ${l.last_used_at ? t('last opened {date}', { date: formatDate(l.last_used_at, true) }) : t('never opened')}`}
                </span>
                {manage && (
                  <span className="ml-auto flex items-center gap-2">
                    {l.locked_until && new Date(l.locked_until) > new Date() && <Button size="sm" variant="ghost" onClick={() => set.mutate({ id: l.id, p: { unlock: true } })}>{t('Unlock')}</Button>}
                    <Switch checked={l.is_active} aria-label={t('Active')} onCheckedChange={(v) => set.mutate({ id: l.id, p: { is_active: v } })} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {adding && <NewLinkDialog partner={partner} onClose={() => setAdding(false)} />}
    </Card>
  )
}

function NewLinkDialog({ partner, onClose }: { partner: { id: string; name: string; phone?: string | null }; onClose: () => void }) {
  const qc = useQueryClient()
  const [label, setLabel] = React.useState('')
  const [pin, setPin] = React.useState('')
  const [order, setOrder] = React.useState(true)
  const [invoices, setInvoices] = React.useState(true)
  const [until, setUntil] = React.useState('')
  const [made, setMade] = React.useState<string | null>(null)
  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('portal_link_create', { p_partner: partner.id, p: { label, pin, can_order: order, can_see_invoices: invoices, expires_on: until || null } as Json })) as { key: string },
    onSuccess: (r) => { setMade(portalUrl(r.key)); void qc.invalidateQueries({ queryKey: ['portal-links', partner.id] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  const phone = (partner.phone ?? '').replace(/[^\d]/g, '')
  const message = made ? t('Hello! Here you can see our prices and stock, send orders and see your invoices: {url}', { url: made }) + (pin ? `\n${t('PIN')}: ${pin}` : '') : ''
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{made ? t('The link is ready') : t('New portal link')}</DialogTitle>
          <DialogDescription>{made ? t('Copy it now: for safety it is shown only this once. If it is lost, switch it off and make a new one.') : partner.name}</DialogDescription>
        </DialogHeader>
        {made ? (
          <div className="grid gap-3">
            <Input readOnly value={made} onFocus={(e) => e.target.select()} className="font-mono text-[12px]" aria-label={t('Link')} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(made).then(() => toast.success(t('Copied'))) }}><Copy /> {t('Copy')}</Button>
              <Button variant="outline" asChild><a href={`https://wa.me/${phone}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><MessageCircle /> {t('Send on WhatsApp')}</a></Button>
            </div>
            {pin && <p className="text-[13px] text-muted-foreground">{t('Give the PIN separately, by phone or in person.')}</p>}
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="pl-label">{t('Name')}</Label><Input id="pl-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('e.g. the purchasing office')} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pl-pin">{t('PIN (optional)')}</Label>
              <Input id="pl-pin" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder={t('4 to 8 digits')} /></div>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={order} onCheckedChange={(v) => setOrder(!!v)} />{t('Can send orders')}</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={invoices} onCheckedChange={(v) => setInvoices(!!v)} />{t('Can see invoices and what they owe')}</label>
            <div className="grid gap-1.5"><Label htmlFor="pl-until">{t('Valid until (optional)')}</Label><Input id="pl-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
          </div>
        )}
        <DialogFooter>
          {made ? <Button onClick={onClose}>{t('Done')}</Button> : <>
            <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            <Button disabled={!!pin && pin.length < 4} loading={create.isPending} onClick={() => create.mutate()}>{t('Make the link')}</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
