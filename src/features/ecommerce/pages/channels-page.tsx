import { CircleAlert, ExternalLink, Globe, Link2, Plus, RefreshCw, RotateCcw, Send } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Can, useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { SimpleFormDialog } from '@/components/simple-form-dialog'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { Json } from '@/lib/database.types'
import { describeError } from '@/lib/errors'
import { cn, formatDate, formatMoney, formatQty, todayISO } from '@/lib/utils'
import { useWarehouses } from '@/features/inventory/api'
import { useCustomers, usePriceLists } from '@/features/sales/api'
import {
  useChannel, useChannelOrders, useChannels, useIngestOrder, useLinkProducts, useProductLinks, useRetryOrder, useSaveChannel, useSyncLogs, useSyncStock,
  ecoKeys, useToggleLink, type Channel, type ChannelOrder,
} from '../api'
import { msg, t, td, tEnum, tn, tServer } from '@/i18n'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { ErrorState } from '@/components/error-state'

const TYPES = ['shopify', 'woocommerce', 'magento', 'prestashop', 'custom_api', 'marketplace'] as const
const TYPE_LABEL: Record<string, string> = { shopify: 'Shopify', woocommerce: 'WooCommerce', magento: 'Magento', prestashop: 'PrestaShop', custom_api: msg('Own API'), marketplace: msg('Marketplace') } // i18n-ignore

const channelSchema = z.object({
  name: z.string().trim().min(1, msg('Name the channel')),
  channel_type: z.enum(TYPES),
  store_url: z.string().trim().url(msg('A full address, e.g. https://shop.example.al')).nullable().or(z.literal('')),
  warehouse_id: z.string().nullable(),
})
type ChannelValues = z.infer<typeof channelSchema>

export function ChannelsPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const channels = useChannels()
  const orders = useChannelOrders()
  const { companyId } = useCompany()
  useRealtimeInvalidate('channel_orders', companyId, [ecoKeys.all(companyId)])
  const warehouses = useWarehouses()
  const save = useSaveChannel()
  const [adding, setAdding] = React.useState(false)
  const today = todayISO()
  const stats = (id: string) => {
    const o = (orders.data ?? []).filter((x) => x.channel_id === id)
    return { today: o.filter((x) => String((x.payload as { created_at?: string } | null)?.created_at ?? x.created_at).slice(0, 10) === today).length, failed: o.filter((x) => x.import_status === 'failed').length, total: o.length }
  }
  return (
    <>
      <PageHeader title={t('Web shop')} description={t('Online stores and marketplaces. Their orders arrive here as sales orders; stock levels go back to them.')}
        actions={<Can perm="ecommerce.write"><Button onClick={() => setAdding(true)}><Plus /> {t('Add channel')}</Button></Can>} />
      {channels.isLoading ? <Skeleton className="h-32" /> : channels.isError ? <Card><ErrorState error={channels.error} onRetry={() => void channels.refetch()} /></Card> : !channels.data?.length ? (
        <Card><EmptyState icon={Globe} title={t('No channels yet')} description={t('Add your web shop to import its orders and keep its stock in step.')}
          action={<Can perm="ecommerce.write"><Button size="sm" onClick={() => setAdding(true)}><Plus /> {t('Add channel')}</Button></Can>} /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{channels.data.map((c) => {
          const s = stats(c.id)
          return (
            <Link key={c.id} to={`/ecommerce/${c.id}`} className="rounded-lg border bg-card p-4 transition-colors hover:border-ring/40">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="truncate font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{t(TYPE_LABEL[c.channel_type] ?? c.channel_type)}{c.store_url ? ` · ${c.store_url.replace(/^https?:\/\//, '')}` : ''}</div></div>
                <Badge variant={c.is_active ? 'success' : 'secondary'}>{c.is_active ? t('Active') : t('Not active')}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
                <div><div className="text-xs text-muted-foreground">{t('Orders today')}</div><div className="tabular font-semibold">{s.today}</div></div>
                <div><div className="text-xs text-muted-foreground">{t('Failed')}</div><div className={cn('tabular font-semibold', s.failed && 'text-destructive')}>{s.failed}</div></div>
                <div><div className="text-xs text-muted-foreground">{t('Last sync')}</div><div className="truncate">{c.last_synced_at ? formatDate(c.last_synced_at, true) : t('Never')}</div></div>
              </div>
            </Link>
          )
        })}</div>
      )}
      <Card className="mt-4">
        <CardHeader className="pb-2"><CardTitle>{t('Recent orders')}</CardTitle><CardDescription>{t('Each order is imported once, by its id in the shop. Failed imports keep the reason and can be retried after fixing it.')}</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto p-0"><OrdersTable rows={orders.data} loading={orders.isLoading} highlight={params.get('order')} showChannel /></CardContent>
      </Card>
      <SimpleFormDialog<ChannelValues> open={adding} onOpenChange={setAdding} title={t('Add a sales channel')} schema={channelSchema}
        description={t('The shop sends its orders to the app through a secure link. Keep the shop\'s access keys with your administrator — they are never saved in the app.')}
        defaultValues={{ name: '', channel_type: 'woocommerce', store_url: '', warehouse_id: (warehouses.data ?? []).find((w) => w.code === 'WH')?.id ?? null }}
        fields={[
          { name: 'name', label: t('Name'), placeholder: t('e.g. Web shop') },
          { name: 'channel_type', label: t('Platform'), type: 'select', options: TYPES.map((x) => ({ value: x, label: t(TYPE_LABEL[x]!) })) },
          { name: 'store_url', label: t('Store address'), optional: true, placeholder: 'https://shop.example.al' },
          { name: 'warehouse_id', label: t('Ships from'), type: 'select', optional: true, options: (warehouses.data ?? []).map((w) => ({ value: w.id, label: `${w.code} · ${td(w.name)}` })) },
        ]}
        submitLabel={t('Add channel')} onSubmit={async (v) => {
          const r = await save.mutateAsync({ ...v, store_url: v.store_url || null, settings: { prices_include_tax: true } })
          toast.success(t('Channel added')); navigate(`/ecommerce/${(r as { id: string }).id}`)
        }} />
    </>
  )
}

function OrdersTable({ rows, loading, highlight, showChannel }: { rows: ChannelOrder[] | undefined; loading: boolean; highlight?: string | null; showChannel?: boolean }) {
  const retry = useRetryOrder()
  const ref = React.useRef<HTMLTableRowElement>(null)
  React.useEffect(() => { ref.current?.scrollIntoView({ block: 'center' }) }, [rows, highlight])
  if (loading) return <Skeleton className="m-4 h-32" />
  if (!rows?.length) return <EmptyState compact icon={Globe} title={t('No orders yet')} description={t('Orders appear when the shop sends them, or when you send a test order.')} />
  return (
    <Table>
      <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Order')}</TableHead>{showChannel && <TableHead>{t('Channel')}</TableHead>}<TableHead>{t('Customer')}</TableHead>
        <TableHead>{t('Ordered')}</TableHead><TableHead>{t('Import')}</TableHead><TableHead>{t('Sales order')}</TableHead><TableHead className="text-right">{t('Total (with VAT)')}</TableHead><TableHead className="w-[1%]" /></TableRow></TableHeader>
      <TableBody>{rows.map((o) => {
        const p = o.payload as { customer?: { name?: string; email?: string }; payment?: string; created_at?: string } | null
        return (
          <TableRow key={o.id} ref={o.id === highlight ? ref : undefined} className={cn('hover:bg-transparent', o.id === highlight && 'bg-accent/50')}>
            <TableCell className="font-medium">{o.external_order_number ?? o.external_order_id}{p?.payment === 'cod' && <Badge variant="warning" className="ml-1.5">{t('Pay on delivery')}</Badge>}</TableCell>
            {showChannel && <TableCell className="text-[13px]">{o.channel?.name}</TableCell>}
            <TableCell className="text-[13px]">{p?.customer?.name ?? p?.customer?.email ?? '—'}</TableCell>
            <TableCell className="text-[13px] text-muted-foreground">{formatDate(p?.created_at ?? o.created_at, true)}</TableCell>
            <TableCell><StatusBadge status={o.import_status} />{o.error_message && <div className="mt-1 flex max-w-72 items-start gap-1 text-xs text-destructive"><CircleAlert className="mt-0.5 size-3 shrink-0" />{tServer(o.error_message)}</div>}</TableCell>
            <TableCell>{o.sales_order ? <Link className="text-primary hover:underline" to={`/sales/orders/${o.sales_order.id}`}>{o.sales_order.number}</Link> : '—'}</TableCell>
            <TableCell className="text-right tabular">{o.sales_order ? formatMoney(o.sales_order.total) : '—'}</TableCell>
            <TableCell>{o.import_status === 'failed' && <Can perm="ecommerce.write"><Button size="sm" variant="outline" loading={retry.isPending && retry.variables === o.id}
              onClick={async () => { const r = await retry.mutateAsync(o.id); if (r.status === 'imported') toast.success(t('Imported')); else toast.error(r.error ? tServer(r.error) : t('Still failing')) }}>
              <RotateCcw /> {t('Retry')}</Button></Can>}</TableCell>
          </TableRow>
        )
      })}</TableBody>
    </Table>
  )
}

/* ================================================================== channel detail */
export function ChannelPage() {
  const { id } = useParams()
  const ch = useChannel(id)
  const orders = useChannelOrders(id)
  const links = useProductLinks(id)
  const logs = useSyncLogs(id)
  const link = useLinkProducts()
  const sync = useSyncStock()
  const toggle = useToggleLink()
  const { can, companyId } = useCompany()
  useRealtimeInvalidate('channel_orders', companyId, [ecoKeys.all(companyId)])
  const [synced, setSynced] = React.useState<{ items: { sku: string; available: number }[]; count: number; sent: boolean } | null>(null)
  const [testOpen, setTestOpen] = React.useState(false)
  if (ch.isLoading) return <Skeleton className="h-96" />
  if (ch.isError) return <ErrorState error={ch.error} onRetry={() => void ch.refetch()} />
  const c = ch.data
  if (!c) return <EmptyState title={t('Channel not found')} action={<Link to="/ecommerce" className="text-sm text-primary hover:underline">{t('All channels')}</Link>} />
  return (
    <>
      <PageHeader back={{ href: '/ecommerce', label: t('Web shop') }} title={c.name}
        meta={<Badge variant={c.is_active ? 'success' : 'secondary'}>{c.is_active ? t('Active') : t('Not active')}</Badge>}
        description={<>{t(TYPE_LABEL[c.channel_type] ?? c.channel_type)}{c.store_url && <> · <a className="inline-flex items-center gap-1 hover:underline" href={c.store_url} target="_blank" rel="noreferrer">{c.store_url}<ExternalLink className="size-3" /></a></>}
          {' · '}{c.last_synced_at ? t('last sync {date}', { date: formatDate(c.last_synced_at, true) }) : t('never synced')}</>}
        actions={<Can perm="ecommerce.write">
          <Button variant="outline" loading={link.isPending} onClick={async () => { const n = await link.mutateAsync(c.id); toast.success(n ? tn(n, '{n} product linked', '{n} products linked') : t('Every product is already linked')) }}><Link2 /> {t('Link all by SKU')}</Button>
          <Button variant="outline" loading={sync.isPending} onClick={async () => setSynced(await sync.mutateAsync(c.id))}><RefreshCw /> {t('Sync stock now')}</Button>
          <Button onClick={() => setTestOpen(true)}><Send /> {t('Send a test order')}</Button>
        </Can>} />
      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders">{t('Orders ({n})', { n: orders.data?.length ?? 0 })}</TabsTrigger>
          <TabsTrigger value="products">{t('Products ({n})', { n: links.data?.length ?? 0 })}</TabsTrigger>
          <TabsTrigger value="log">{t('Sync log')}</TabsTrigger>
          <TabsTrigger value="settings">{t('Settings')}</TabsTrigger>
        </TabsList>
        <TabsContent value="orders"><Card><CardContent className="overflow-x-auto p-0"><OrdersTable rows={orders.data} loading={orders.isLoading} /></CardContent></Card></TabsContent>
        <TabsContent value="products">
          <Card><CardContent className="overflow-x-auto p-0">
            {links.isLoading ? <Skeleton className="m-4 h-32" /> : !links.data?.length ? <EmptyState compact icon={Link2} title={t('No products linked')} description={t('Link products by SKU so orders and stock line up.')} /> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Product')}</TableHead><TableHead>{t('Shop product id')}</TableHead><TableHead>{t('Shop variant / SKU')}</TableHead>
                  <TableHead>{t('Last sync')}</TableHead><TableHead className="text-right">{t('Sync')}</TableHead></TableRow></TableHeader>
                <TableBody>{links.data.map((l) => (
                  <TableRow key={l.id} className="hover:bg-transparent">
                    <TableCell><span className="font-medium">{l.variant?.name}</span> <span className="text-xs text-muted-foreground">{l.variant?.sku}</span></TableCell>
                    <TableCell className="font-mono text-xs">{l.external_product_id}</TableCell>
                    <TableCell className="font-mono text-xs">{l.external_variant_id ?? '—'}</TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{l.last_synced_at ? formatDate(l.last_synced_at, true) : t('Never')}</TableCell>
                    <TableCell className="text-right"><Switch checked={l.sync_enabled} disabled={!can('ecommerce.write')} aria-label={t('Sync {code}', { code: l.variant?.sku ?? '' })}
                      onCheckedChange={(on) => toggle.mutate({ id: l.id, on })} /></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="log">
          <Card><CardContent className="overflow-x-auto p-0">
            {logs.isLoading ? <Skeleton className="m-4 h-32" /> : !logs.data?.length ? <EmptyState compact title={t('Nothing synced yet')} /> : (
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Started')}</TableHead><TableHead>{t('What')}</TableHead><TableHead>{t('Status')}</TableHead>
                  <TableHead className="text-right">{t('Records')}</TableHead><TableHead className="text-right">{t('Failed')}</TableHead><TableHead>{t('Message')}</TableHead></TableRow></TableHeader>
                <TableBody>{logs.data.map((l) => (
                  <TableRow key={l.id} className="hover:bg-transparent">
                    <TableCell className="text-[13px]">{formatDate(l.started_at, true)}</TableCell>
                    <TableCell className="text-[13px]">{tEnum(`sync_${l.sync_type}`)} · {l.direction === 'inbound' ? t('from the shop') : t('to the shop')}</TableCell>
                    <TableCell><StatusBadge status={l.status} /></TableCell>
                    <TableCell className="text-right tabular">{l.records_processed}</TableCell>
                    <TableCell className="text-right tabular">{l.records_failed || '—'}</TableCell>
                    <TableCell className="max-w-80 text-xs text-muted-foreground">{tServer(l.error_message)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            )}
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="settings"><ChannelSettings channel={c} /></TabsContent>
      </Tabs>
      <Dialog open={!!synced} onOpenChange={(o) => !o && setSynced(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('Stock sync')}</DialogTitle>
            <DialogDescription>{synced?.sent ? t('{n} quantities sent to the shop.', { n: synced.count }) : t('{n} quantities calculated. The channel is not active, so nothing was sent.', { n: synced?.count ?? 0 })}</DialogDescription></DialogHeader>
          <div className="max-h-80 overflow-y-auto rounded-md border">
            <Table><TableHeader><TableRow className="hover:bg-transparent"><TableHead>{t('Code')}</TableHead><TableHead className="text-right">{t('Available')}</TableHead></TableRow></TableHeader>
              <TableBody>{(synced?.items ?? []).map((i) => <TableRow key={i.sku} className="hover:bg-transparent"><TableCell className="font-mono text-xs">{i.sku}</TableCell>
                <TableCell className={cn('text-right tabular', !i.available && 'text-muted-foreground')}>{formatQty(i.available)}</TableCell></TableRow>)}</TableBody></Table>
          </div>
          <DialogFooter><Button onClick={() => setSynced(null)}>{t('Done')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {testOpen && <TestOrderDialog channel={c} onClose={() => setTestOpen(false)} />}
    </>
  )
}

function ChannelSettings({ channel: c }: { channel: Channel }) {
  const { can } = useCompany()
  const warehouses = useWarehouses()
  const priceLists = usePriceLists()
  const customers = useCustomers()
  const save = useSaveChannel()
  const settings = (c.settings ?? {}) as Record<string, unknown>
  const [v, setV] = React.useState({ warehouse_id: c.warehouse_id, price_list_id: c.price_list_id, default_customer_id: c.default_customer_id, is_active: c.is_active,
    sync_products: c.sync_products, sync_stock: c.sync_stock, import_orders: c.import_orders, prices_include_tax: settings.prices_include_tax !== false })
  const ro = !can('ecommerce.write')
  const sw = (key: 'is_active' | 'sync_products' | 'sync_stock' | 'import_orders' | 'prices_include_tax', label: string, hint: string) => (
    <label className="flex items-center justify-between gap-3 py-2.5">
      <span><span className="block text-sm font-medium">{label}</span><span className="text-[13px] text-muted-foreground">{hint}</span></span>
      <Switch checked={v[key]} disabled={ro} onCheckedChange={(on) => setV((x) => ({ ...x, [key]: on }))} />
    </label>
  )
  return (
    <Card className="max-w-2xl">
      <CardContent className="grid gap-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label>{t('Ships from')}</Label>
            <Select disabled={ro} value={v.warehouse_id ?? '__none'} onValueChange={(x) => setV((s) => ({ ...s, warehouse_id: x === '__none' ? null : x }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__none">{t('Company default')}</SelectItem>{(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{w.code} · {td(w.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>{t('Price list')}</Label>
            <Select disabled={ro} value={v.price_list_id ?? '__none'} onValueChange={(x) => setV((s) => ({ ...s, price_list_id: x === '__none' ? null : x }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__none">{t('Prices from the shop')}</SelectItem>{(priceLists.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{td(p.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5 sm:col-span-2"><Label>{t('Customer for orders without an email')}</Label>
            <SearchSelect disabled={ro} clearable value={v.default_customer_id} onChange={(x) => setV((s) => ({ ...s, default_customer_id: x }))} placeholder={t('None — such orders fail')}
              options={(customers.data ?? []).map((p) => ({ value: p.id, label: p.name, hint: p.code ?? undefined }))} />
            <p className="text-xs text-muted-foreground">{t('Orders with an email are matched to that customer, or create one.')}</p></div>
        </div>
        <div className="divide-y border-y">
          {sw('is_active', t('Active'), t('When off, orders are still accepted, but stock is not sent to the shop'))}
          {sw('import_orders', t('Import orders'), t('Create sales orders from the shop\'s orders'))}
          {sw('sync_stock', t('Send stock levels'), t('The available quantity of each linked product'))}
          {sw('sync_products', t('Send products'), t('Names and prices of linked products'))}
          {sw('prices_include_tax', t('Shop prices include VAT'), t('Prices are turned into prices without VAT using each product\'s VAT rate'))}
        </div>
        {!ro && <div><Button loading={save.isPending} onClick={async () => {
          try {
            const { prices_include_tax, ...rest } = v
            await save.mutateAsync({ id: c.id, ...rest, settings: { ...settings, prices_include_tax } })
            toast.success(t('Channel saved'))
          } catch (e) { toast.error(describeError(e)) }
        }}>{t('Save settings')}</Button></div>}
      </CardContent>
    </Card>
  )
}

function TestOrderDialog({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const ingest = useIngestOrder()
  const links = useProductLinks(channel.id)
  const navigate = useNavigate()
  const sku = links.data?.[0]?.external_variant_id ?? links.data?.[0]?.variant?.sku ?? 'SKU-1'
  const sample = React.useMemo(() => JSON.stringify({
    id: `test-${Date.now().toString(36)}`, number: `#T${String(Date.now()).slice(-5)}`, created_at: new Date().toISOString(), currency: 'ALL', prices_include_tax: true,
    customer: { email: 'test.customer@example.al', name: 'Test Customer', phone: '+355 69 000 0000' },
    shipping_address: { line1: 'Rruga e Durrësit 1', city: 'Tiranë', postal_code: '1001', country: 'AL' },
    lines: [{ sku, quantity: 1, price: 1200 }], shipping: 200, payment: 'cod',
  }, null, 2), [sku])
  const [text, setText] = React.useState('')
  React.useEffect(() => { setText(sample) }, [sample])
  const [result, setResult] = React.useState<{ ok: boolean; msg: string; so?: string } | null>(null)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('Send a test order')}</DialogTitle>
          <DialogDescription>{t('Goes through the same import as a real shop order: the customer is found by email, items by code, and prices with VAT are turned into prices without VAT. Sending the same id twice imports it only once.')}</DialogDescription>
        </DialogHeader>
        <Textarea className="h-72 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label={t('Order data (JSON)')} />
        {result && <p role="status" className={cn('rounded-md border px-3 py-2 text-[13px]', result.ok ? 'border-success/30 bg-success/5 text-success' : 'border-destructive/30 bg-destructive/5 text-destructive')}>
          {result.msg}{result.so && <> · <button className="underline" onClick={() => navigate(`/sales/orders/${result.so}`)}>{t('open the sales order')}</button></>}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Close')}</Button>
          <Button loading={ingest.isPending} onClick={async () => {
            let payload: Json
            try { payload = JSON.parse(text) as Json } catch { setResult({ ok: false, msg: t('The text is not valid JSON.') }); return }
            try {
              const r = await ingest.mutateAsync({ channel: channel.id, payload })
              setResult(r.status === 'failed' ? { ok: false, msg: t('Import failed: {reason}', { reason: tServer(r.error) }) }
                : { ok: true, msg: r.status === 'duplicate' ? t('Already imported earlier') : t('Imported'), so: r.sales_order_id })
            } catch (e) { setResult({ ok: false, msg: describeError(e) }) }
          }}><Send /> {t('Send')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
