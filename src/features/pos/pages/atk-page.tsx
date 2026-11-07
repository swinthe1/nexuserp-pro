/**
 * Kosovo: the business, its stores and its tills at ATK. Each till is registered on the device it sells on:
 * the key is made here, ATK signs its certificate, and from then on that device signs every receipt.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, Laptop, Loader2, ShieldCheck, ShieldOff, Store } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { formatDateWith, formatNumberWith, msg, t, tServer } from '@/i18n'
import { getTillKey, makeCsr, newTillKey, saveCertificate, removeTillKey, type AtkEnv } from '@/lib/atk/keys'
import { toBase64 } from '@/lib/atk/proto'
import { ATK_TYPES, ATK_UNITS } from '@/lib/atk/codes'
import { describeError, unwrap } from '@/lib/errors'
import { downloadCsv } from '@/lib/export'
import { supabase } from '@/lib/supabase'
import { cn, formatDate, todayISO } from '@/lib/utils'

type Till = { id: string; code: string; name: string; warehouse_id: string; atk_pos_id: number | null; certified: boolean; cert_env: AtkEnv | null
  cert_at: string | null; cert_by: string | null; device: string | null; public_key: string | null; missing: string[]
  /** ATK registered this till number once already: it will not register it again */
  taken?: boolean; next_free?: number | null }
type Setup = { country: string; nui: string | null; business: string; enabled: boolean; training: boolean; env: AtkEnv; fiscalization_no: string | null; application_id: number | null
  application_ids: { test: number | null; production: number | null } | null; is_super_admin: boolean; can_setup: boolean; can_register: boolean
  stores: { id: string; code: string; name: string; city: string | null; atk_branch_id: number | null; tills: number }[]; tills: Till[]
  queue: { waiting: number; failed: number; sent_today: number; oldest: string | null } }

const MISSING: Record<string, string> = {
  country: msg('the company is not in Kosovo'), nui: msg('the company\'s NUI (9 digits)'), fiscalization_no: msg('the fiscalization number from EDI'),
  application_id: msg('DrisPRO\'s number at ATK'), branch: msg('the store\'s ATK number'), pos: msg('the till\'s ATK number'),
}

function useSetup() {
  const { companyId } = useCompany()
  return useQuery({ queryKey: ['atk-setup', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('atk_setup', { p_company: companyId! })) as unknown as Setup })
}

/** what this browser holds for each till: a key with a certificate, and its public key */
function useDeviceKeys(tills: Till[] | undefined, env: AtkEnv | undefined) {
  const [keys, setKeys] = React.useState<Record<string, string | null>>({})
  const [n, setN] = React.useState(0)
  React.useEffect(() => {
    if (!tills || !env) return
    let alive = true
    void Promise.all(tills.map(async (r) => { const k = await getTillKey(r.id, env).catch(() => undefined); return [r.id, k?.certificate ? toBase64(k.publicKey) : null] as const }))
      .then((rows) => { if (alive) setKeys(Object.fromEntries(rows)) })
    return () => { alive = false }
  }, [tills, env, n])
  return { keys, refresh: () => setN((x) => x + 1) }
}

const deviceLabel = () => {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  return [browser, os].filter(Boolean).join(' · ')
}

async function waitJob(id: string) {
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, i < 10 ? 700 : 1500))
    const j = unwrap(await supabase.rpc('atk_job', { p_id: id })) as unknown as { status: string; error: string | null; business_name: string | null; certificate: string | null } | null
    if (j?.status === 'done') return j
    if (j?.status === 'failed') throw new Error(j.error ? tServer(j.error) : t('ATK did not accept the request'))
  }
  throw new Error(t('ATK did not answer in time. Check that the server is online and try again.'))
}

export function AtkPage() {
  const { company } = useCompany()
  const q = useSetup()
  const s = q.data
  const [params] = useSearchParams()
  const focus = params.get('till')
  const device = useDeviceKeys(s?.tills, s?.env)
  const [registering, setRegistering] = React.useState<Till | null>(null)

  if (company && company.country_code !== 'XK') {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={t('Tills at ATK')} />
        <p className="text-[13px] text-muted-foreground">{t('Registering tills with ATK is for companies in Kosovo.')}</p>
      </div>
    )
  }
  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <PageHeader title={t('Tills at ATK')}
        description={t('DrisPRO as the fiscal software: each till signs its own receipts with its key and prints the QR code, also without internet. The server sends every coupon to ATK.')}
        actions={<Button variant="outline" asChild><Link to="/tax/fiscalization">{t('Sent to ATK')}</Link></Button>} />
      {s && <SwitchCard s={s} />}
      {s && <BusinessCard s={s} />}
      {s && <TillsCard s={s} keys={device.keys} focus={focus} onRegister={setRegistering} onForgotten={() => { device.refresh(); void q.refetch() }} />}
      {s && <CodesCard canEdit={s.can_setup} />}
      {s && <QueueCard s={s} />}
      {s && <LogCard />}
      {registering && s && (
        <RegisterDialog s={s} till={registering} onClose={(ok) => { setRegistering(null); if (ok) { device.refresh(); void q.refetch() } }} />
      )}
    </div>
  )
}

function SwitchCard({ s }: { s: Setup }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const notReady = s.tills.filter((r) => !r.certified)
  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      const ask = on
        ? notReady.length ? t('These tills are not registered yet and will stop selling until they are: {names}. Go on?', { names: notReady.map((r) => r.name).join(', ') })
          : t('From now on every receipt of this company is signed and sent to ATK. Go on?')
        : t('The tills stop signing receipts for ATK. Do this only if the shop goes back to its own fiscal device. Go on?')
      if (!confirm(ask)) return false
      unwrap(await supabase.rpc('atk_settings_save', { p_company: companyId!, p_fiscalization_no: s.fiscalization_no ?? '', p_env: s.env, p_on: on }))
      return true
    },
    onSuccess: (ok) => { if (ok) { toast.success(t('Saved')); void qc.invalidateQueries({ queryKey: ['atk-setup', companyId] }) } },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3', s.enabled ? 'border-success/40 bg-success/5' : 'bg-card')}>
      <ShieldCheck className={cn('size-5 shrink-0', s.enabled ? 'text-success' : 'text-muted-foreground')} />
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="font-medium">{s.enabled ? t('DrisPRO signs every till receipt for ATK') : t('DrisPRO does not sign the till receipts yet')}</div>
        <div className="text-muted-foreground">{s.training ? t('This is a training company: nothing is ever sent to ATK from it.')
          : s.enabled ? t('A till that is not registered on its device does not sell.')
          : t('Set the numbers and register the tills first, then turn it on. Until then the shop keeps its own fiscal device.')}</div>
      </div>
      {s.can_setup && !s.training && <Switch checked={s.enabled} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} aria-label={t('DrisPRO signs the till receipts')} />}
    </div>
  )
}

function BusinessCard({ s }: { s: Setup }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const [no, setNo] = React.useState(s.fiscalization_no ?? '')
  const [env, setEnv] = React.useState<AtkEnv>(s.env)
  const [appTest, setAppTest] = React.useState(String(s.application_ids?.test ?? ''))
  const [appProd, setAppProd] = React.useState(String(s.application_ids?.production ?? ''))
  const save = useMutation({
    mutationFn: async () => {
      if (env === 'production' && s.env !== 'production' && !confirm(t('From now on the tills send real coupons to ATK. Every till must be registered again for the live environment. Go on?'))) return false
      unwrap(await supabase.rpc('atk_settings_save', { p_company: companyId!, p_fiscalization_no: no, p_env: env }))
      const idsChanged = appTest !== String(s.application_ids?.test ?? '') || appProd !== String(s.application_ids?.production ?? '')
      if (s.is_super_admin && idsChanged) unwrap(await supabase.rpc('atk_platform_save', { p_test: appTest ? Number(appTest) : null as never, p_production: appProd ? Number(appProd) : null as never }))
      return true
    },
    onSuccess: (ok) => { if (ok) { toast.success(t('Saved')); void qc.invalidateQueries({ queryKey: ['atk-setup', companyId] }) } },
    // what was saved before the error shows at once
    onError: (e) => { toast.error(describeError(e)); void qc.invalidateQueries({ queryKey: ['atk-setup', companyId] }) },
  })
  return (
    <Card>
      <CardHeader><CardTitle>{t('The business at ATK')}</CardTitle>
        <CardDescription>{t('The fiscalization number comes from EDI ("Kërkesë për Fiskalizim"). The test environment is for ATK\'s checks before certification.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>{t('NUI')}</Label>
          <div className={cn('flex h-9 items-center text-[13px]', !/^\d{9}$/.test(s.nui ?? '') && 'text-destructive')}>
            {s.nui || t('Not set')}{!/^\d{9}$/.test(s.nui ?? '') && <Link className="ml-2 text-primary hover:underline" to="/settings/company">{t('Set it in the company settings')}</Link>}
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="atk-no">{t('Fiscalization number (EDI)')}</Label>
          <Input id="atk-no" value={no} onChange={(e) => setNo(e.target.value.trim())} disabled={!s.can_setup} placeholder={t('e.g. {v}', { v: '81234567' })} />
        </div>
        <div className="grid gap-1.5">
          <Label>{t('Environment')}</Label>
          <Select value={env} onValueChange={(v) => setEnv(v as AtkEnv)} disabled={!s.can_setup}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="test">{t('Test (fiskalizimi-test.atk-ks.org)')}</SelectItem>
              <SelectItem value="production">{t('Live (fiskalizimi.atk-ks.org)')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>{t('DrisPRO\'s number at ATK (Application ID)')}</Label>
          {s.is_super_admin ? (
            <div className="grid grid-cols-2 gap-2">
              <Input inputMode="numeric" value={appTest} onChange={(e) => setAppTest(e.target.value.replace(/\D/g, ''))} placeholder={t('Test')} aria-label={t('Application ID, test')} />
              <Input inputMode="numeric" value={appProd} onChange={(e) => setAppProd(e.target.value.replace(/\D/g, ''))} placeholder={t('Live')} aria-label={t('Application ID, live')} />
            </div>
          ) : <div className="flex h-9 items-center text-[13px]">{s.application_id ?? <span className="text-muted-foreground">{t('Set by DrisPRO')}</span>}</div>}
        </div>
        {s.can_setup && <div className="sm:col-span-2"><Button loading={save.isPending} onClick={() => save.mutate()}>{t('Save')}</Button></div>}
      </CardContent>
    </Card>
  )
}

function TillsCard({ s, keys, focus, onRegister, onForgotten }: { s: Setup; keys: Record<string, string | null>; focus: string | null; onRegister: (t: Till) => void; onForgotten: () => void }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const [stores, setStores] = React.useState<Record<string, string>>(() => Object.fromEntries(s.stores.map((w) => [w.id, String(w.atk_branch_id ?? '')])))
  const [tills, setTills] = React.useState<Record<string, string>>(() => Object.fromEntries(s.tills.map((r) => [r.id, String(r.atk_pos_id ?? '')])))
  const dirty = s.stores.some((w) => (stores[w.id] ?? '') !== String(w.atk_branch_id ?? '')) || s.tills.some((r) => (tills[r.id] ?? '') !== String(r.atk_pos_id ?? ''))
  const save = useMutation({
    mutationFn: async () => {
      const changed = s.tills.filter((r) => r.certified && (tills[r.id] ?? '') !== String(r.atk_pos_id ?? ''))
      if (changed.length && !confirm(t('A certificate names its till number. Changing it means registering these tills again: {names}. Go on?', { names: changed.map((r) => r.name).join(', ') }))) return false
      unwrap(await supabase.rpc('atk_numbers_save', { p_company: companyId!,
        p_stores: s.stores.map((w) => ({ id: w.id, atk_branch_id: stores[w.id] || null })) as never,
        p_tills: s.tills.map((r) => ({ id: r.id, atk_pos_id: tills[r.id] || null })) as never }))
      return true
    },
    onSuccess: (ok) => { if (ok) { toast.success(t('Saved')); void qc.invalidateQueries({ queryKey: ['atk-setup', companyId] }) } },
    onError: (e) => toast.error(describeError(e)),
  })
  const forget = useMutation({
    mutationFn: async (r: Till) => {
      if (!confirm(t('{name} stops signing receipts. ATK does not register the same till number twice, so to sell again it will need a new number. Go on?', { name: r.name }))) return
      unwrap(await supabase.rpc('atk_till_forget', { p_register: r.id }))
      await removeTillKey(r.id, s.env).catch(() => undefined)
      onForgotten()
    },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Card>
      <CardHeader><CardTitle>{t('Stores and tills')}</CardTitle>
        <CardDescription>{t('Each store has its own ATK number (1–999) and each till in it its own (1–99). Register a till on the computer, tablet or phone it sells on.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        {!s.stores.length && <p className="text-[13px] text-muted-foreground">{t('No store has a till yet. Add tills in the till settings first.')}</p>}
        {s.stores.map((w) => (
          <div key={w.id} className="rounded-lg border">
            <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-3 py-2">
              <Store className="size-4 text-muted-foreground" />
              <span className="flex-1 text-[13px] font-medium">{w.name}{w.city ? <span className="font-normal text-muted-foreground"> · {w.city}</span> : null}</span>
              <Label htmlFor={`b-${w.id}`} className="text-xs text-muted-foreground">{t('Store no. at ATK')}</Label>
              <Input id={`b-${w.id}`} className="h-8 w-20 text-right tabular" inputMode="numeric" disabled={!s.can_setup} value={stores[w.id] ?? ''}
                onChange={(e) => setStores((m) => ({ ...m, [w.id]: e.target.value.replace(/\D/g, '').slice(0, 3) }))} />
            </div>
            <ul className="divide-y">
              {s.tills.filter((r) => r.warehouse_id === w.id).map((r) => {
                const here = !!keys[r.id] && keys[r.id] === r.public_key && r.certified
                return (
                  <li key={r.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5', focus === r.id && 'bg-primary/5')}>
                    <span className="min-w-36 flex-1">
                      <span className="block text-[13px] font-medium">{r.name} <span className="font-normal text-muted-foreground">{r.code}</span></span>
                      <span className="block text-xs text-muted-foreground">
                        {r.certified
                          ? here ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-3.5" /> {t('Registered on this device')}</span>
                            : <span className="inline-flex items-center gap-1"><Laptop className="size-3.5" /> {t('Registered on another device: {device}', { device: r.device ?? '—' })}</span>
                          : r.cert_env && r.cert_env !== s.env ? t('Registered only for the {env} environment', { env: r.cert_env === 'test' ? t('test') : t('live') })
                          : t('Not registered')}
                        {r.certified && r.cert_at && <> · {formatDateWith(new Date(r.cert_at), { day: '2-digit', month: '2-digit', year: 'numeric' })}{r.cert_by ? ` · ${r.cert_by}` : ''}</>}
                      </span>
                      {r.taken && (tills[r.id] ?? '') === String(r.atk_pos_id ?? '') && (
                        <span className="block text-xs text-warning">
                          {t('ATK has registered till number {n} once already and does not take it again.', { n: r.atk_pos_id ?? '' })}
                          {r.next_free && s.can_setup && <> <button type="button" className="font-medium text-primary hover:underline"
                            onClick={() => setTills((m) => ({ ...m, [r.id]: String(r.next_free) }))}>{t('Use number {n}', { n: r.next_free })}</button>, {t('then save the numbers.')}</>}
                        </span>
                      )}
                      {r.missing.length > 0 && r.missing.some((m) => m !== 'pos' && m !== 'branch') && (
                        <span className="block text-xs text-warning">{t('Missing: {list}', { list: r.missing.map((m) => t(MISSING[m] ?? m)).join(', ') })}</span>
                      )}
                    </span>
                    <Label htmlFor={`p-${r.id}`} className="text-xs text-muted-foreground">{t('Till no.')}</Label>
                    <Input id={`p-${r.id}`} className="h-8 w-16 text-right tabular" inputMode="numeric" disabled={!s.can_setup} value={tills[r.id] ?? ''}
                      onChange={(e) => setTills((m) => ({ ...m, [r.id]: e.target.value.replace(/\D/g, '').slice(0, 2) }))} />
                    {s.can_register && (here ? (
                      <Button size="sm" variant="ghost" className="text-muted-foreground" loading={forget.isPending && forget.variables?.id === r.id} onClick={() => forget.mutate(r)}><ShieldOff /> {t('Unregister')}</Button>
                    ) : (
                      <Button size="sm" variant={focus === r.id ? 'default' : 'outline'} disabled={r.missing.length > 0 || dirty || !!r.taken} title={dirty ? t('Save the numbers first') : undefined}
                        onClick={() => onRegister(r)}><ShieldCheck /> {r.certified ? t('Move to this device') : t('Register this device')}</Button>
                    ))}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
        {s.can_setup && s.stores.length > 0 && <div><Button variant={dirty ? 'default' : 'outline'} disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('Save the numbers')}</Button></div>}
      </CardContent>
    </Card>
  )
}

type Codes = { default_type: string; units: { id: string; code: string; name: string; atk_unit: string | null; items: number }[]
  categories: { id: string; name: string; atk_type: string | null; items: number }[] }
const NONE = '__none'
function CodesCard({ canEdit }: { canEdit: boolean }) {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['atk-codes', companyId], enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('atk_codes', { p_company: companyId! })) as unknown as Codes })
  const [def, setDef] = React.useState<string | null>(null)
  const [units, setUnits] = React.useState<Record<string, string>>({})
  const [cats, setCats] = React.useState<Record<string, string>>({})
  const c = q.data
  const save = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('atk_codes_save', { p_company: companyId!, p_default_type: def ?? c?.default_type ?? 'TT',
      p_units: Object.entries(units).map(([id, v]) => ({ id, atk_unit: v === NONE ? null : v })) as never,
      p_categories: Object.entries(cats).map(([id, v]) => ({ id, atk_type: v === NONE ? null : v })) as never })),
    onSuccess: () => { toast.success(t('Saved')); setUnits({}); setCats({}); setDef(null); void qc.invalidateQueries({ queryKey: ['atk-codes', companyId] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  if (!c) return null
  const dirty = def !== null || Object.keys(units).length > 0 || Object.keys(cats).length > 0
  const usedUnits = c.units.filter((u) => u.items > 0 || u.atk_unit)
  const typeOptions = ATK_TYPES.map(([code, name]) => <SelectItem key={code} value={code}>{code} · {name}</SelectItem>)
  return (
    <Card>
      <CardHeader><CardTitle>{t('Units and categories for ATK')}</CardTitle>
        <CardDescription>{t('Every coupon line carries ATK\'s code of its unit and of its category, from ATK\'s own lists. A unit without a match goes as CP (copë); a category without one takes the company\'s.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-1.5 sm:max-w-md">
          <Label>{t('The company\'s category')}</Label>
          <Select value={def ?? c.default_type} onValueChange={setDef} disabled={!canEdit}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{typeOptions}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-[13px] font-medium">{t('Units|measure')}</div>
            <ul className="divide-y rounded-lg border">
              {usedUnits.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[13px]">{u.name} <span className="text-muted-foreground">{u.code} · {t('{n} items', { n: u.items })}</span></span>
                  <Select value={units[u.id] ?? u.atk_unit ?? NONE} onValueChange={(v) => setUnits((m) => ({ ...m, [u.id]: v }))} disabled={!canEdit}>
                    <SelectTrigger className={cn('h-8 w-48', !(units[u.id] ?? u.atk_unit) && u.items > 0 && 'border-warning')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('Not matched (CP)')}</SelectItem>
                      {ATK_UNITS.map(([code, name]) => <SelectItem key={code} value={code}>{code} · {name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium">{t('Item categories')}</div>
            {!c.categories.length ? <p className="text-[13px] text-muted-foreground">{t('No item categories yet: every item takes the company\'s category.')}</p> : (
              <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
                {c.categories.map((x) => (
                  <li key={x.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[13px]">{x.name} <span className="text-muted-foreground">· {t('{n} items', { n: x.items })}</span></span>
                    <Select value={cats[x.id] ?? x.atk_type ?? NONE} onValueChange={(v) => setCats((m) => ({ ...m, [x.id]: v }))} disabled={!canEdit}>
                      <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t('The company\'s category')}</SelectItem>
                        {typeOptions}
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {canEdit && <div><Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t('Save')}</Button></div>}
      </CardContent>
    </Card>
  )
}

function QueueCard({ s }: { s: Setup }) {
  const { companyId } = useCompany()
  const exp = useMutation({
    mutationFn: async () => {
      const rows = unwrap(await supabase.from('fiscalization_records').select('created_at, iic, verification_code, status, attempt_count, error_message, request_payload')
        .eq('company_id', companyId!).eq('country_code', 'XK').eq('source_doc_type', 'pos_order').in('status', ['pending', 'sent', 'failed']).order('created_at').limit(50000))
      downloadCsv(`atk-not-sent-${todayISO()}`, [
        [t('Made'), t('Coupon no.'), t('Verification code'), t('Status'), t('Attempts'), t('Error'), t('Number'), t('Total'), 'details', 'signature'],
        ...rows.map((r) => {
          const p = (r.request_payload ?? {}) as { number?: string; total?: number; atk?: { details?: string; signature?: string } }
          return [formatDate(r.created_at, true), r.iic, r.verification_code, r.status, r.attempt_count, r.error_message ? tServer(r.error_message) : '', p.number ?? '', p.total ?? '', p.atk?.details ?? '', p.atk?.signature ?? '']
        }),
      ])
      return rows.length
    },
    onSuccess: (n) => { if (!n) toast.success(t('Everything has reached ATK')) },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Card>
      <CardHeader><CardTitle>{t('Coupons to ATK')}</CardTitle>
        <CardDescription>{t('Coupons made without internet wait on the till and then on the server until ATK takes them. On ATK\'s request, what has not reached it yet can be given as a file.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t('Waiting to be sent')} value={s.queue.waiting} tone={s.queue.waiting ? 'warning' : 'default'} hint={s.queue.oldest ? t('oldest {date}', { date: formatDate(s.queue.oldest, true) }) : undefined} />
          <StatCard label={t('Not taken by ATK')} value={s.queue.failed} tone={s.queue.failed ? 'destructive' : 'default'} hint={t('Tried again by itself')} />
          <StatCard label={t('Taken by ATK today')} value={s.queue.sent_today} />
        </div>
        <div><Button variant="outline" loading={exp.isPending} onClick={() => exp.mutate()}><Download /> {t('Download what has not reached ATK (CSV)')}</Button></div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ the log ATK checks (Kërkesat specifike, neni 25.15 and "Verifikimi dhe Kontrolli") */
type LogRow = { id: number; kind: string; at: string; register_id: string | null; coupon_no: number | null; amount: number | null; details: Record<string, unknown> }
const KINDS: Record<string, string> = {
  started: msg('Till opened|log'), offline: msg('Internet lost|log'), online: msg('Internet back|log'), clock: msg('Clock off|log'),
  sent: msg('Sent to ATK|log'), failed: msg('Not taken by ATK|log'), change: msg('Change to the SEF|log'),
}
const CHANGES: Record<string, string> = {
  fiscalization_no: msg('Fiscalization number (EDI)'), sef_enabled: msg('DrisPRO signs the till receipts'), environment: msg('Environment'),
  store_number: msg('Store no. at ATK'), till_number: msg('Till no.'), till_registered: msg('Registered with ATK|log'), till_unregistered: msg('Unregistered from ATK|log'),
}
const FILTERS: { v: string; l: string; kinds: string[] | null }[] = [
  { v: 'all', l: msg('Everything|log'), kinds: null },
  { v: 'sends', l: msg('Sends to ATK|log'), kinds: ['sent', 'failed'] },
  { v: 'failed', l: msg('Errors|log'), kinds: ['failed', 'clock'] },
  { v: 'offline', l: msg('Interruptions|log'), kinds: ['offline', 'online', 'started'] },
  { v: 'change', l: msg('Changes to the SEF|log'), kinds: ['change'] },
]
const secs = (d: string) => formatDateWith(new Date(d), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
const dur = (s: number) => (s >= 3600 ? t('{h} h {m} min', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) }) : s >= 60 ? t('{m} min', { m: Math.round(s / 60) }) : t('{s} s', { s }))
function logText(r: LogRow) {
  const d = r.details
  const v = (k: string) => (d[k] === undefined || d[k] === null ? '' : String(d[k]))
  switch (r.kind) {
    case 'sent': return t('ATK transaction {no}', { no: v('transaction') }) + (Number(d.attempt) > 1 ? ` · ${t('try {n}', { n: v('attempt') })}` : '')
    case 'failed': return `${tServer(v('error')) || v('error_code')}${d.attempt ? ` · ${t('try {n}', { n: v('attempt') })}` : ''}`
    case 'online': return t('After {time} without internet · {n} sales were waiting', { time: dur(Number(d.offline_seconds) || 0), n: Number(d.waiting) || 0 })
    case 'clock': return t('The device clock was {s} s off', { s: v('offset_seconds') })
    case 'started': return d.online === false ? t('Opened without internet') : ''
    case 'change': return `${t(CHANGES[v('what')] ?? v('what'))}: ${v('from') || '—'} → ${v('to') || '—'}`
    default: return ''
  }
}
function LogCard() {
  const { companyId } = useCompany()
  const day = (n: number) => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const [from, setFrom] = React.useState(() => day(7))
  const [to, setTo] = React.useState(() => day(0))
  const [filter, setFilter] = React.useState('all')
  const kinds = FILTERS.find((f) => f.v === filter)?.kinds ?? null
  const tills = useQuery({ queryKey: ['atk-log-tills', companyId], enabled: !!companyId, staleTime: 300_000,
    queryFn: async () => new Map(unwrap(await supabase.from('pos_registers').select('id, name').eq('company_id', companyId!)).map((r) => [r.id, r.name])) })
  const fetchRows = async (limit: number) => {
    let q = supabase.from('atk_events').select('id, kind, at, register_id, coupon_no, amount, details').eq('company_id', companyId!)
      .gte('at', new Date(`${from}T00:00:00`).toISOString()).lt('at', new Date(new Date(`${to}T00:00:00`).getTime() + 864e5).toISOString())
    if (kinds) q = q.in('kind', kinds)
    return unwrap(await q.order('at', { ascending: false }).order('id', { ascending: false }).limit(limit)) as unknown as LogRow[]
  }
  const rows = useQuery({ queryKey: ['atk-log', companyId, from, to, filter], enabled: !!companyId && !!from && !!to, queryFn: () => fetchRows(100) })
  const exp = useMutation({
    mutationFn: async () => {
      const all = await fetchRows(50000)
      downloadCsv(`atk-log-${from}-${to}`, [
        [t('Date and time'), t('Event|log'), t('Till'), t('Coupon no.'), t('Total'), t('Details')],
        ...[...all].reverse().map((r) => [secs(r.at), t(KINDS[r.kind] ?? r.kind), r.register_id ? tills.data?.get(r.register_id) ?? '' : '', r.coupon_no ?? '', r.amount ?? '', logText(r)]),
      ])
    },
    onError: (e) => toast.error(describeError(e)),
  })
  return (
    <Card>
      <CardHeader><CardTitle>{t('The SEF log')}</CardTitle>
        <CardDescription>{t('Every send to ATK and every failed one, the errors, the times the internet dropped and came back, and the changes made to the SEF, to the second. Nothing in it can be changed or deleted; ATK can get it as a file.')}</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1"><Label htmlFor="lg-from" className="text-xs">{t('From|date')}</Label><Input id="lg-from" type="date" className="h-9 w-40" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="grid gap-1"><Label htmlFor="lg-to" className="text-xs">{t('To|date')}</Label><Input id="lg-to" type="date" className="h-9 w-40" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
          <Select value={filter} onValueChange={setFilter}><SelectTrigger className="h-9 w-48" aria-label={t('Show|log')}><SelectValue /></SelectTrigger>
            <SelectContent>{FILTERS.map((f) => <SelectItem key={f.v} value={f.v}>{t(f.l)}</SelectItem>)}</SelectContent></Select>
          <Button variant="outline" className="ml-auto" loading={exp.isPending} onClick={() => exp.mutate()}><Download /> {t('Download the log (CSV)')}</Button>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr>
              <th className="px-3 py-2 font-medium">{t('Date and time')}</th><th className="px-3 py-2 font-medium">{t('Event|log')}</th><th className="px-3 py-2 font-medium">{t('Till')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('Coupon no.')}</th><th className="px-3 py-2 text-right font-medium">{t('Total')}</th><th className="px-3 py-2 font-medium">{t('Details')}</th></tr></thead>
            <tbody>
              {(rows.data ?? []).map((r) => (
                <tr key={r.id} className="border-t align-top">
                  <td className="whitespace-nowrap px-3 py-1.5 tabular">{secs(r.at)}</td>
                  <td className={cn('whitespace-nowrap px-3 py-1.5 font-medium', (r.kind === 'failed' || r.kind === 'clock') && 'text-destructive', r.kind === 'offline' && 'text-warning')}>{t(KINDS[r.kind] ?? r.kind)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{r.register_id ? tills.data?.get(r.register_id) ?? '' : ''}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular">{r.coupon_no ?? ''}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular">{r.amount != null ? formatNumberWith(r.amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}</td>
                  <td className="max-w-[22rem] truncate px-3 py-1.5 text-muted-foreground" title={logText(r)}>{logText(r)}</td>
                </tr>
              ))}
              {rows.data && !rows.data.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('Nothing in the log for these days')}</td></tr>}
            </tbody>
          </table>
        </div>
        {(rows.data?.length ?? 0) >= 100 && <p className="text-xs text-muted-foreground">{t('The newest 100 are shown; the file has them all.')}</p>}
      </CardContent>
    </Card>
  )
}

type Step = 'verify' | 'key' | 'sign' | 'done'
function RegisterDialog({ s, till, onClose }: { s: Setup; till: Till; onClose: (ok: boolean) => void }) {
  const [step, setStep] = React.useState<Step | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const store = s.stores.find((w) => w.id === till.warehouse_id)
  const run = async () => {
    setError(null)
    try {
      setStep('verify')
      const v = unwrap(await supabase.rpc('atk_onboard_verify', { p_register: till.id })) as unknown as string
      const r1 = await waitJob(v)
      setStep('key')
      const key = await newTillKey(till.id, s.env, { nui: s.nui ?? '', posId: String(till.atk_pos_id), branchId: String(store?.atk_branch_id), businessName: r1.business_name ?? s.business })
      const csr = await makeCsr(key)
      setStep('sign')
      const c = unwrap(await supabase.rpc('atk_onboard_csr', { p_verify: v, p_csr: csr, p_public_key: toBase64(key.publicKey), p_device: deviceLabel() })) as unknown as string
      const r2 = await waitJob(c)
      await saveCertificate(key, r2.certificate ?? '')
      setStep('done')
    } catch (e) { setError(describeError(e)); setStep(null) }
  }
  const steps: { id: Step; label: string }[] = [
    { id: 'verify', label: t('ATK checks the business and the numbers') },
    { id: 'key', label: t('This device makes the till\'s key (it never leaves the device)') },
    { id: 'sign', label: t('ATK signs the till\'s certificate') },
  ]
  const at = step ? ['verify', 'key', 'sign', 'done'].indexOf(step) : -1
  return (
    <Dialog open onOpenChange={(o) => { if (!o && (step === null || step === 'done')) onClose(step === 'done') }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Register {name} on this device', { name: till.name })}</DialogTitle>
          <DialogDescription>{t('Do this on the computer, tablet or phone this till sells on. Afterwards only this device signs its receipts.')}
            {s.env === 'test' ? ` ${t('ATK test environment.')}` : ` ${t('ATK live environment.')}`}</DialogDescription>
        </DialogHeader>
        <ol className="grid gap-2 text-[13px]">
          {steps.map((x, i) => (
            <li key={x.id} className={cn('flex items-center gap-2', i > at && 'text-muted-foreground')}>
              {i < at || step === 'done' ? <CheckCircle2 className="size-4 text-success" /> : i === at ? <Loader2 className="size-4 animate-spin text-primary" /> : <span className="size-4 rounded-full border" />}
              {x.label}
            </li>
          ))}
        </ol>
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{error}</p>}
        {step === 'done' && <p className="rounded-md bg-success/10 px-3 py-2 text-[13px] text-success">{t('{name} is registered with ATK. Its receipts are signed on this device from now on.', { name: till.name })}</p>}
        <DialogFooter>
          {step === 'done' ? <Button onClick={() => onClose(true)}>{t('Done')}</Button> : (
            <>
              <Button variant="outline" disabled={step !== null} onClick={() => onClose(false)}>{t('Cancel')}</Button>
              <Button loading={step !== null} onClick={() => void run()}>{error ? t('Try again') : t('Register')}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
