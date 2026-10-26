import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Smartphone, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { t } from '@/i18n'
import { isDesktop } from '@/lib/desktop'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'

type Device = { id: string; label: string | null; endpoint: string; created_at: string; last_sent_at: string | null }

const supported = () => !isDesktop && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext
const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

function deviceLabel() {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '' // i18n-ignore
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '' // i18n-ignore
  return [os, br].filter(Boolean).join(' · ')
}

function keyBytes(b64: string) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))])
}

/** This device's subscription, if any (null when the browser cannot do it). */
function useThisDevice() {
  return useQuery({
    queryKey: ['push-this-device'],
    enabled: supported(),
    queryFn: async () => { const reg = await registration(); return (await reg?.pushManager.getSubscription())?.endpoint ?? null },
  })
}

/** Switch notifications on for this device: the browser asks for permission, DrisPRO keeps its address. */
export function usePushSwitch() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const done = () => { void qc.invalidateQueries({ queryKey: ['push-this-device'] }); void qc.invalidateQueries({ queryKey: ['push-devices'] }) }
  const on = useMutation({
    mutationFn: async () => {
      if (await Notification.requestPermission() !== 'granted') throw new Error(t('Notifications are blocked for DrisPRO in this browser. Allow them in the browser’s site settings, then try again.'))
      const key = unwrap(await supabase.rpc('push_public_key')) as string | null
      if (!key) throw new Error(t('The server is getting ready for notifications. Try again in a minute.'))
      const reg = await registration()
      if (!reg) throw new Error(t('Reload the page once, then try again.'))
      let sub = await reg.pushManager.getSubscription()
      const want = keyBytes(key)
      const same = sub?.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey).every((b, i) => b === want[i])
      if (sub && !same) { await sub.unsubscribe(); sub = null }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want })
      const j = sub.toJSON()
      unwrap(await supabase.rpc('push_subscribe', { p_endpoint: j.endpoint!, p_p256dh: j.keys!.p256dh!, p_auth: j.keys!.auth!, p_label: deviceLabel() }))
      unwrap(await supabase.rpc('push_test', { p_company: companyId! }))
    },
    onSuccess: () => { done(); toast.success(t('Switched on. A test notification is on its way.')) },
    onError: (e) => toast.error(describeError(e)),
  })
  const off = useMutation({
    mutationFn: async () => {
      const sub = await (await registration())?.pushManager.getSubscription()
      if (sub) { unwrap(await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint })); await sub.unsubscribe() }
    },
    onSuccess: () => { done(); toast.success(t('This device gets no more notifications')) },
    onError: (e) => toast.error(describeError(e)),
  })
  return { on, off }
}

export function PushCard() {
  const { companyId } = useCompany()
  const { user } = useAuth()
  const qc = useQueryClient()
  const here = useThisDevice()
  const { on, off } = usePushSwitch()
  const devices = useQuery({
    queryKey: ['push-devices', user?.id], enabled: !!user,
    queryFn: async () => unwrap(await supabase.from('push_subscriptions').select('id, label, endpoint, created_at, last_sent_at').order('created_at', { ascending: false })) as Device[],
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.rpc('push_unsubscribe', { p_id: id })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['push-devices'] }); void qc.invalidateQueries({ queryKey: ['push-this-device'] }) },
    onError: (e) => toast.error(describeError(e)),
  })
  const test = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('push_test', { p_company: companyId! })),
    onSuccess: () => toast.success(t('A test notification is on its way')),
    onError: (e) => toast.error(describeError(e)),
  })
  const can = supported()
  const iosWait = can === false && !isDesktop && isIos() && !installed()
  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Smartphone className="size-4" /> {t('On your phone')}</CardTitle>
        <CardDescription>{t('The same notifications, on your phone or computer even when DrisPRO is closed. Switch it on once on each device.')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {isDesktop ? (
          <p className="text-[13px] text-muted-foreground">{t('Open DrisPRO in the browser on your phone (Chrome on Android, Safari on iPhone) and switch it on there.')}</p>
        ) : iosWait ? (
          <p className="rounded-lg bg-info/10 p-3 text-[13px]">{t('On iPhone: tap Share › “Add to Home Screen”, open DrisPRO from the new icon and switch it on there (iOS 16.4 or newer).')}</p>
        ) : !can ? (
          <p className="text-[13px] text-muted-foreground">{t('This browser cannot receive notifications. Use Chrome, Edge, Firefox or Safari, on a secure (https) address.')}</p>
        ) : here.data ? (
          <div className="flex flex-wrap gap-2">
            <span className="flex items-center gap-1.5 font-medium text-primary"><BellRing className="size-4" /> {t('On for this device')}</span>
            <Button size="sm" variant="outline" className="ml-auto" loading={test.isPending} onClick={() => test.mutate()}>{t('Send a test')}</Button>
            <Button size="sm" variant="ghost" loading={off.isPending} onClick={() => off.mutate()}>{t('Switch off')}</Button>
          </div>
        ) : (
          <Button loading={on.isPending} onClick={() => on.mutate()}><BellRing /> {t('Switch on for this device')}</Button>
        )}
        {(devices.data ?? []).length > 0 && (
          <ul className="divide-y rounded-lg border">
            {devices.data!.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-3 py-2">
                <Smartphone className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.label || t('Device')}{d.endpoint === here.data && <span className="font-normal text-muted-foreground"> · {t('this one')}</span>}</span>
                  <span className="block text-[12px] text-muted-foreground">{d.last_sent_at ? t('last notification {date}', { date: formatDate(d.last_sent_at, true) }) : t('since {date}', { date: formatDate(d.created_at) })}</span>
                </span>
                <Button variant="ghost" size="icon" aria-label={t('Remove the device')} title={t('Remove the device')} onClick={() => remove.mutate(d.id)}><Trash2 /></Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
