import { useQuery } from '@tanstack/react-query'
import { Download, Loader2, MonitorDown } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { isDesktop } from '@/lib/desktop'
import { isLocalServer, supabaseAnonKey, supabaseUrl } from '@/lib/supabase'
import { cn, formatDate } from '@/lib/utils'

/** The Windows program lives in the DrisPRO cloud; a local server asks there too (public key, read only). */
const CLOUD = { url: 'https://api.erp.dris-ks.com', key: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc5Mjg0NTY2MCwiZXhwIjo0OTQ4NTE5MjYwLCJyb2xlIjoiYW5vbiJ9.b6G9lu0yfVwPpWlddYYql4Hf0oelvnyrF-JH_xl3jd0' }
const api = isLocalServer ? CLOUD : { url: supabaseUrl, key: supabaseAnonKey }

export type DesktopRelease = { version: string; file_name: string; size_bytes: number; parts: number; sha256: string; path: string; published_at: string; notes: string | null }

/** this computer is a Mac (the Mac program is offered there, the Windows one elsewhere) */
export const onMac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent) && !/iPhone|iPad/.test(navigator.userAgent)

export function useDesktopRelease(enabled = true, platform: 'windows' | 'mac' = onMac ? 'mac' : 'windows') {
  return useQuery({
    queryKey: ['desktop-release', platform], enabled, staleTime: 10 * 60_000, retry: 1,
    queryFn: async () => {
      const r = await fetch(`${api.url}/rest/v1/rpc/desktop_release`, { method: 'POST', headers: { apikey: api.key, 'Content-Type': 'application/json' },
        body: platform === 'windows' ? '{}' : JSON.stringify({ p_platform: platform }) })
      if (!r.ok) throw new Error(String(r.status))
      return (await r.json()) as DesktopRelease | null
    },
  })
}

export const partName = (i: number) => `.part${String(i).padStart(3, '0')}`
const mb = (b: number) => `${Math.round(b / 1024 / 1024)} MB`

/** The parts are fetched one after another and saved as one file, with the progress shown. */
async function download(rel: DesktopRelease, onProgress: (done: number) => void) {
  const chunks: Blob[] = []
  let done = 0
  for (let i = 0; i < rel.parts; i++) {
    const r = await fetch(`${api.url}/storage/v1/object/public/downloads/${rel.path}${partName(i)}`)
    if (!r.ok || !r.body) throw new Error(String(r.status))
    const reader = r.body.getReader()
    const bufs: Uint8Array[] = []
    for (;;) {
      const { done: end, value } = await reader.read()
      if (end) break
      bufs.push(value); done += value.length; onProgress(done)
    }
    chunks.push(new Blob(bufs as BlobPart[]))
  }
  const file = new Blob(chunks, { type: rel.file_name.endsWith('.dmg') ? 'application/x-apple-diskimage' : 'application/vnd.microsoft.portable-executable' })
  if (file.size !== rel.size_bytes) throw new Error('size')
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map((b) => b.toString(16).padStart(2, '0')).join('')
  if (digest !== rel.sha256) throw new Error('sha256')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file); a.download = rel.file_name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
}

export function DesktopDownload({ className }: { className?: string }) {
  const rel = useDesktopRelease(!isDesktop)
  const [progress, setProgress] = React.useState<number | null>(null)
  const [error, setError] = React.useState(false)
  if (isDesktop || !rel.data) return null
  const r = rel.data
  const start = async () => {
    setError(false); setProgress(0)
    try { await download(r, setProgress) } catch { setError(true) } finally { setProgress(null) }
  }
  const pct = progress === null ? 0 : Math.min(100, Math.round((progress / r.size_bytes) * 100))
  return (
    <div className={cn('rounded-xl border bg-card/60 p-4', className)}>
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><MonitorDown className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{onMac ? t('DrisPRO for Mac') : t('DrisPRO for Windows')}</p>
          <p className="text-xs text-muted-foreground">{t('Version {v} · {size} · {date}', { v: r.version, size: mb(r.size_bytes), date: formatDate(r.published_at) })}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void start()} disabled={progress !== null}>
          {progress !== null ? <><Loader2 className="animate-spin" /> {pct}%</> : <><Download /> {t('Download')}</>}
        </Button>
      </div>
      {progress !== null && <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} /></div>}
      {onMac && <p className="mt-3 text-xs text-muted-foreground">{t('Drag DrisPRO into Applications. The first time, the Mac asks to confirm: System Settings › Privacy & Security › Open Anyway.')}</p>}
      {error && <p className="mt-3 text-xs text-destructive">{t('The download did not finish. Check the connection and try again.')}</p>}
    </div>
  )
}
