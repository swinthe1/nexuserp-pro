import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, MonitorDown, Upload } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { partName } from '@/features/auth/desktop-download'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'

/** under the storage limit of one file (50 MB) */
const PART = 45 * 1024 * 1024

type Row = { version: string; file_name: string; size_bytes: number; published_at: string }

/** The platform owner puts a new Windows installer here; the sign-in page offers the newest one to everyone. */
export function DesktopReleaseCard() {
  const qc = useQueryClient()
  const list = useQuery({ queryKey: ['platform-desktop'], queryFn: async () => unwrap(await supabase.rpc('platform_desktop_releases')) as Row[] })
  const [file, setFile] = React.useState<File | null>(null)
  const [version, setVersion] = React.useState('')
  const [step, setStep] = React.useState<string | null>(null)
  const [manual, setManual] = React.useState(false)
  const [newKey, setNewKey] = React.useState<string | null>(null)
  const auto = useQuery({ queryKey: ['platform-desktop-auto'], queryFn: async () => unwrap(await supabase.rpc('platform_desktop_publish_status')) as { created_at: string; last_used_at: string | null } | null })
  const makeKey = async () => {
    try { setNewKey(unwrap(await supabase.rpc('platform_desktop_publish_key')) as string); void qc.invalidateQueries({ queryKey: ['platform-desktop-auto'] }) }
    catch (e) { toast.error(describeError(e)) }
  }

  const pick = (f: File | null) => {
    setFile(f)
    const v = f?.name.match(/(\d+\.\d+\.\d+)/)?.[1]
    if (v) setVersion(v)
  }

  const publish = async () => {
    if (!file || !/^\d+\.\d+\.\d+$/.test(version)) return
    try {
      setStep(t('Checking the file…'))
      const buf = await file.arrayBuffer()
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map((b) => b.toString(16).padStart(2, '0')).join('')
      const name = `DrisPRO-Setup-${version}.exe`
      const parts = Math.max(1, Math.ceil(file.size / PART))
      for (let i = 0; i < parts; i++) {
        setStep(t('Uploading part {i} of {n}…', { i: i + 1, n: parts }))
        const { error } = await supabase.storage.from('downloads')
          .upload(`windows/${version}/${name}${partName(i)}`, file.slice(i * PART, (i + 1) * PART), { upsert: true, contentType: 'application/octet-stream', cacheControl: '31536000' })
        if (error) throw error
      }
      unwrap(await supabase.rpc('platform_desktop_publish', { p_version: version, p_file_name: name, p_size: file.size, p_parts: parts, p_sha256: sha }))
      toast.success(t('Version {v} is on the sign-in page now', { v: version }))
      setFile(null); setVersion('')
      void qc.invalidateQueries({ queryKey: ['platform-desktop'] }); void qc.invalidateQueries({ queryKey: ['desktop-release'] })
    } catch (e) { toast.error(describeError(e)) } finally { setStep(null) }
  }

  const latest = list.data?.[0]
  return (
    <div className="mt-6 rounded-lg border bg-card p-4">
      <div className="flex items-start gap-3">
        <MonitorDown className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t('The Windows program')}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {latest ? t('The sign-in page offers version {v} ({date}).', { v: latest.version, date: formatDate(latest.published_at) })
              : t('Not on the sign-in page yet.')}{' '}
            {auto.data ? t('Each new version comes here by itself as soon as it is built.') : t('Turn on publishing by itself once, and every new version comes here without you doing anything.')}
          </p>
        </div>
      </div>

      {(list.data?.length ?? 0) > 0 && (
        <ul className="mt-3 divide-y rounded-md border text-[13px]">
          {list.data!.map((r, i) => (
            <li key={r.version} className="flex items-center gap-3 px-3 py-2">
              <span className="font-medium tabular-nums">{r.version}</span>
              {i === 0 && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">{t('offered now')}</span>}
              <span className="ml-auto text-xs text-muted-foreground">{`${Math.round(r.size_bytes / 1048576)} MB · ${formatDate(r.published_at, true)}`}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 rounded-md border border-dashed p-3">
        <div className="flex flex-wrap items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" />
          <span className="text-[13px] font-medium">{t('Publishing by itself')}</span>
          <span className="text-xs text-muted-foreground">
            {auto.data ? (auto.data.last_used_at ? t('on · last used {date}', { date: formatDate(auto.data.last_used_at, true) }) : t('on · waiting for the first build')) : t('off')}
          </span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => void makeKey()}>{auto.data ? t('New key') : t('Turn on')}</Button>
        </div>
        {newKey && (
          <div className="mt-3 grid gap-2 text-[13px]">
            <p>{t('Copy this key now; it is shown only once. On GitHub open the DrisPRO repository → Settings → Secrets and variables → Actions → New repository secret, name it DRISPRO_PUBLISH_KEY and paste the key.')}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">{newKey}</code>
              <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(newKey); toast.success(t('Copied')) }}><Copy /> {t('Copy')}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('From then on, every time the Windows program changes, GitHub builds the installer and it appears here by itself in about 10 minutes.')}</p>
          </div>
        )}
      </div>

      {!manual ? (
        <button type="button" className="mt-3 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => setManual(true)}>{t('Upload an installer by hand')}</button>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
          <div className="grid gap-1.5"><Label htmlFor="dsk-file">{t('Installer')}</Label>
            <Input id="dsk-file" type="file" accept=".exe" onChange={(e) => pick(e.target.files?.[0] ?? null)} disabled={!!step} /></div>
          <div className="grid gap-1.5"><Label htmlFor="dsk-ver">{t('Version')}</Label>
            <Input id="dsk-ver" value={version} onChange={(e) => setVersion(e.target.value.trim())} placeholder="1.3.0" disabled={!!step} /></div>
          <Button onClick={() => void publish()} loading={!!step} disabled={!file || !/^\d+\.\d+\.\d+$/.test(version)}><Upload /> {t('Publish')}</Button>
        </div>
      )}
      {step && <p className="mt-2 text-xs text-muted-foreground">{step}</p>}
    </div>
  )
}
