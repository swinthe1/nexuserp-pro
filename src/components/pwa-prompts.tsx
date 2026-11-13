import * as React from 'react'
import { toast } from 'sonner'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { t } from '@/i18n'

/**
 * Service worker lifecycle, in plain words:
 *  - a new version is downloaded in the background; people choose when to reload (never in the middle of a sale)
 *  - the first time everything is cached, say once that the app now opens without internet
 *  - check for updates every 10 minutes for tills and tablets that stay open all day
 */
export function PwaPrompts() {
  const { needRefresh: [needRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return
      // every 10 minutes, and when the page comes back to the front or the internet returns
      const check = () => { if (navigator.onLine) void reg.update().catch(() => undefined) }
      setInterval(check, 10 * 60 * 1000)
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
      window.addEventListener('online', check)
    },
  })

  React.useEffect(() => {
    if (!needRefresh) return
    toast(t('A new version is ready'), {
      id: 'pwa-update',
      description: t('Reload when it suits you. Unsaved work on this page will be lost.'),
      duration: Infinity,
      action: { label: t('Reload'), onClick: () => void updateServiceWorker(true) },
    })
  }, [needRefresh, updateServiceWorker])

  React.useEffect(() => {
    if (!offlineReady) return
    toast.success(t('The app is installed on this device and opens even without internet.'), { id: 'pwa-offline' })
    setOfflineReady(false)
  }, [offlineReady, setOfflineReady])

  return null
}

/**
 * "Check for a new version": the program on a computer looks for a newer installer and answers in its own
 * window; the pages look for a newer version on the server and, if there is one, offer to reload.
 */
export async function checkForNewVersion() {
  const { desktop } = await import('@/lib/desktop')
  if (desktop?.checkUpdate) { await desktop.checkUpdate(); return }
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
  if (!reg) { window.location.reload(); return }
  const id = toast.loading(t('Looking for a new version…'))
  try {
    await reg.update()
    if (reg.installing || reg.waiting) toast.dismiss(id)   // the "A new version is ready" message follows
    else toast.success(t('You have the newest version.'), { id })
  } catch { toast.error(t('No connection to the server: try again in a moment.'), { id }) }
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BeforeInstallPromptEvent; listeners.forEach((l) => l()) })
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((l) => l()) })
}

/** Whether the browser offers installing the app, and a function that shows its install dialog. */
export function useInstallApp() {
  const [, force] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => { listeners.add(force); return () => { listeners.delete(force) } }, [])
  const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches
  return {
    canInstall: !!deferred && !standalone,
    install: async () => {
      if (!deferred) return
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      if (outcome === 'accepted') deferred = null
      listeners.forEach((l) => l())
    },
  }
}
