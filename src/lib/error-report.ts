import { supabase } from '@/lib/supabase'

type Kind = 'error' | 'promise' | 'page' | 'chunk'
const sent = new Map<string, number>()
let installed = false

/**
 * Sends an error the person met to the platform owner (the server takes tokens out, counts the same error
 * once a day). Quiet: never shows anything, never throws, at most one report of the same error a minute.
 */
export function reportError(error: unknown, kind: Kind = 'error') {
  try {
    if (!navigator.onLine) return
    const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error ?? 'unknown'))
    if (!e.message || /ResizeObserver loop|Load failed|NetworkError|Failed to fetch$|AbortError/i.test(e.message)) return
    const key = `${kind}|${e.message}`
    const now = Date.now()
    if ((sent.get(key) ?? 0) > now - 60_000) return
    sent.set(key, now)
    let company: string | null = null
    try { company = localStorage.getItem('drispro.company') } catch { /* ignore */ }
    void supabase.rpc('report_client_error' as never, { p: {
      kind, message: e.message, stack: e.stack ?? null, url: location.href, version: typeof __BUILD__ === 'string' ? __BUILD__ : null,
      user_agent: navigator.userAgent, company_id: company,
    } } as never).then(() => undefined, () => undefined)
  } catch { /* reporting never breaks anything */ }
}

// errors a save already showed to the person (its own message): awaiting it without a catch is not a new problem
const shown = new WeakSet<object>()
export function markShown(error: unknown) { if (error && typeof error === 'object') shown.add(error) }

/** the errors no page caught */
export function installErrorReporting() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (ev) => { if (ev.error || ev.message) reportError(ev.error ?? ev.message, 'error') })
  window.addEventListener('unhandledrejection', (ev) => {
    if (ev.reason && typeof ev.reason === 'object' && shown.has(ev.reason)) { ev.preventDefault(); return }
    reportError(ev.reason, 'promise')
  })
}
