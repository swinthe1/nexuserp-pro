import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, Plus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { msg, t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'

const SCOPES: { key: string; label: string; hint: string }[] = [
  { key: 'catalog.read', label: msg('Products, prices and stock'), hint: msg('read') },
  { key: 'partners.read', label: msg('Customers and vendors'), hint: msg('read, with what customers owe') },
  { key: 'partners.write', label: msg('Customers and vendors'), hint: msg('create and update by code') },
  { key: 'orders.write', label: msg('Sales orders'), hint: msg('create') },
  { key: 'orders.read', label: msg('Sales orders'), hint: msg('read status, deliveries and invoices') },
  { key: 'invoices.read', label: msg('Invoices'), hint: msg('read') },
]
type ApiKey = { id: string; name: string; key_prefix: string; scopes: string[]; is_active: boolean; created_at: string; last_used_at: string | null; calls: number }

/** The B2B portal settings and the keys other programs use to talk to DrisPRO. */
export function IntegrationsPage() {
  return (
    <>
      <PageHeader title={t('B2B portal and API')} description={t('Let customers order on their own, and connect a web shop or another program to DrisPRO.')} />
      <div className="grid max-w-4xl gap-4">
        <PortalSettings />
        <ApiKeys />
        <ApiDocs />
      </div>
    </>
  )
}

function PortalSettings() {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const s = useQuery({
    queryKey: ['portal-settings', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('company_settings').select('portal_auto_confirm, portal_stock').eq('company_id', companyId!).single()) as unknown as { portal_auto_confirm: boolean; portal_stock: string },
  })
  const save = useMutation({
    mutationFn: async (p: { auto?: boolean; stock?: string }) => unwrap(await supabase.rpc('portal_settings_save', { p_company: companyId!, p_auto_confirm: p.auto as boolean, p_stock: p.stock as string })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['portal-settings', companyId] }); toast.success(t('Saved')) },
    onError: (e) => toast.error(describeError(e)),
  })
  const edit = can('sales.approve')
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle>{t('B2B portal')}</CardTitle></CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <p className="text-[13px] text-muted-foreground">{t('The link for each customer is made on the customer’s page, under “B2B portal”. They see only their own prices, orders and invoices.')}</p>
        <label className="flex items-start justify-between gap-4">
          <span><span className="font-medium">{t('Confirm portal orders at once')}</span>
            <span className="block text-[13px] text-muted-foreground">{t('Off: each order waits as a draft for the sales team. On: it is confirmed at once, unless the credit limit stops it.')}</span></span>
          <Switch disabled={!edit || !s.data} checked={!!s.data?.portal_auto_confirm} onCheckedChange={(v) => save.mutate({ auto: v })} aria-label={t('Confirm portal orders at once')} />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span><span className="font-medium">{t('What customers see of the stock')}</span></span>
          <Select disabled={!edit || !s.data} value={s.data?.portal_stock ?? 'level'} onValueChange={(v) => save.mutate({ stock: v })}>
            <SelectTrigger className="w-60" aria-label={t('What customers see of the stock')}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="level">{t('In stock / few left / out')}</SelectItem>
              <SelectItem value="exact">{t('The exact quantity')}</SelectItem>
              <SelectItem value="none">{t('Nothing')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}

function ApiKeys() {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const [adding, setAdding] = React.useState(false)
  const keys = useQuery({
    queryKey: ['api-keys', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('api_keys' as never).select('id, name, key_prefix, scopes, is_active, created_at, last_used_at, calls')
      .eq('company_id', companyId!).order('created_at', { ascending: false })) as unknown as ApiKey[],
  })
  const active = useMutation({
    mutationFn: async (a: { id: string; on: boolean }) => unwrap(await supabase.rpc('api_key_set_active', { p_id: a.id, p_active: a.on })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['api-keys', companyId] }),
    onError: (e) => toast.error(describeError(e)),
  })
  const scopeLabel = (k: string) => { const s = SCOPES.find((x) => x.key === k); return s ? `${t(s.label)} (${t(s.hint)})` : k }
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 py-3">
        <CardTitle>{t('API keys')}</CardTitle>
        {can('admin.write') && <Button size="sm" onClick={() => setAdding(true)}><Plus /> {t('New key')}</Button>}
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-[13px] text-muted-foreground">{t('A key works with your rights and only for what you allow it. At most 120 calls a minute. Switch it off at once if it leaks.')}</p>
        {(keys.data ?? []).length === 0 ? <EmptyState compact icon={KeyRound} title={t('No key yet')} /> : (
          <ul className="divide-y rounded-lg border">
            {keys.data!.map((k) => (
              <li key={k.id} className="grid gap-1 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{k.name}</span>
                  <code className="rounded bg-muted px-1.5 text-[12px]">{k.key_prefix}…</code>
                  {!k.is_active && <Badge variant="outline">{t('Switched off')}</Badge>}
                  <span className="ml-auto flex items-center gap-3 text-[12px] text-muted-foreground">
                    {k.last_used_at ? t('{n} calls, last {date}', { n: k.calls, date: formatDate(k.last_used_at, true) }) : t('never used')}
                    {can('admin.write') && <Switch checked={k.is_active} aria-label={t('Active')} onCheckedChange={(v) => active.mutate({ id: k.id, on: v })} />}
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground">{k.scopes.map(scopeLabel).join(' · ')}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {adding && <NewKeyDialog onClose={() => setAdding(false)} />}
    </Card>
  )
}

function NewKeyDialog({ onClose }: { onClose: () => void }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const [name, setName] = React.useState('')
  const [scopes, setScopes] = React.useState<string[]>(['catalog.read'])
  const [made, setMade] = React.useState<string | null>(null)
  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('api_key_create', { p_company: companyId!, p_name: name, p_scopes: scopes })) as { key: string },
    onSuccess: (r) => { setMade(r.key); void qc.invalidateQueries({ queryKey: ['api-keys', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{made ? t('The key is ready') : t('New API key')}</DialogTitle>
          <DialogDescription>{made ? t('Copy it now: for safety it is shown only this once. Keep it on the server of the other program, never in a web page.') : t('Give it to the program that will use it.')}</DialogDescription>
        </DialogHeader>
        {made ? (
          <div className="grid gap-2">
            <Input readOnly value={made} onFocus={(e) => e.target.select()} className="font-mono text-[12px]" aria-label={t('API key')} />
            <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(made).then(() => toast.success(t('Copied'))) }}><Copy /> {t('Copy')}</Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="ak-name">{t('Name')}</Label><Input id="ak-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. the web shop')} /></div>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('What it may do')}</legend>
              {SCOPES.map((s) => (
                <label key={s.key} className="flex items-start gap-2 text-sm">
                  <Checkbox className="mt-0.5" checked={scopes.includes(s.key)} onCheckedChange={(v) => setScopes((x) => v ? [...x, s.key] : x.filter((y) => y !== s.key))} />
                  <span>{t(s.label)} <span className="text-muted-foreground">· {t(s.hint)}</span></span>
                </label>
              ))}
            </fieldset>
          </div>
        )}
        <DialogFooter>
          {made ? <Button onClick={onClose}>{t('Done')}</Button> : <>
            <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            <Button disabled={!name.trim() || !scopes.length} loading={create.isPending} onClick={() => create.mutate()}>{t('Make the key')}</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const CALLS: { fn: string; scope: string; what: string; body: string }[] = [
  { fn: 'api_products', scope: 'catalog.read', what: msg('Products, 200 at a time (up to 500); “next” is the SKU to continue after. With p_updated_since, only what changed (also switched-off ones).'), body: '{"p_updated_since":"2026-10-01T00:00:00Z","p_after":null,"p_limit":200}' }, // i18n-ignore
  { fn: 'api_stock', scope: 'catalog.read', what: msg('Stock per warehouse: on hand, reserved, available.'), body: '{"p_skus":["33173","33174"],"p_warehouse":null}' }, // i18n-ignore
  { fn: 'api_prices', scope: 'catalog.read', what: msg('The price a customer gets, by their code (their own price, their price list or the list price).'), body: '{"p_partner_code":"1001","p_skus":["33173"],"p_quantity":1}' }, // i18n-ignore
  { fn: 'api_partners', scope: 'partners.read', what: msg('Customers and vendors with what customers owe, paged by code.'), body: '{"p_updated_since":null,"p_after":null}' }, // i18n-ignore
  { fn: 'api_partner_upsert', scope: 'partners.write', what: msg('Create or update by code, with the same columns as the spreadsheet import.'), body: '{"p_rows":[{"code":"1001","name":"Viva Fresh","role":"customer","tax_number":"810000011"}]}' }, // i18n-ignore
  { fn: 'api_order_create', scope: 'orders.write', what: msg('A sales order at the company’s prices. The same external_id never makes a second order. “confirm”: true confirms it at once.'), body: '{"p":{"external_id":"WEB-1001","partner_code":"1001","confirm":true,"lines":[{"sku":"33173","quantity":2}],"note":"…"}}' }, // i18n-ignore
  { fn: 'api_order_get', scope: 'orders.read', what: msg('An order by its number or external_id: status, delivered and invoiced quantities.'), body: '{"p_external_id":"WEB-1001"}' }, // i18n-ignore
  { fn: 'api_invoices', scope: 'invoices.read', what: msg('Posted invoices and what is still open, paged by number.'), body: '{"p_since":"2026-10-01","p_partner_code":null}' }, // i18n-ignore
]

function ApiDocs() {
  const base = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc`
  return (
    <Card>
      <CardHeader className="py-3"><CardTitle>{t('How to call it')}</CardTitle></CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <p className="text-[13px] text-muted-foreground">{t('Every call is a POST with JSON. Send the public key in “apikey” and your key in “x-api-key”. Errors come back with an HTTP error code and a message.')}</p>
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-[12px] leading-relaxed">{`curl -X POST '${base}/api_products' \\
  -H 'apikey: ${supabaseAnonKey}' \\
  -H 'x-api-key: nxa_…' \\
  -H 'Content-Type: application/json' \\
  -d '{"p_limit":200}'`}</pre>
        <ul className="grid gap-3">
          {CALLS.map((c) => (
            <li key={c.fn} className="rounded-lg border p-3">
              <p className="flex flex-wrap items-center gap-2"><code className="font-semibold">POST /rpc/{c.fn}</code><Badge variant="secondary">{c.scope}</Badge></p> {/* i18n-ignore */}
              <p className="mt-1 text-[13px] text-muted-foreground">{t(c.what)}</p>
              <pre className="mt-2 overflow-x-auto rounded bg-muted px-2 py-1.5 text-[12px]">{c.body}</pre>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
