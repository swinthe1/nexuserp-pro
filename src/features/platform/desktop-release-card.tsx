import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MonitorDown, Upload } from 'lucide-react'
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
            {latest ? t('The sign-in page offers version {v} ({date}). Put a newer installer here and it offers that one.', { v: latest.version, date: formatDate(latest.published_at) })
              : t('Not on the sign-in page yet. Put the installer (DrisPRO-Setup-….exe) here.')}
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
        <div className="grid gap-1.5"><Label htmlFor="dsk-file">{t('Installer')}</Label>
          <Input id="dsk-file" type="file" accept=".exe" onChange={(e) => pick(e.target.files?.[0] ?? null)} disabled={!!step} /></div>
        <div className="grid gap-1.5"><Label htmlFor="dsk-ver">{t('Version')}</Label>
          <Input id="dsk-ver" value={version} onChange={(e) => setVersion(e.target.value.trim())} placeholder="1.3.0" disabled={!!step} /></div>
        <Button onClick={() => void publish()} loading={!!step} disabled={!file || !/^\d+\.\d+\.\d+$/.test(version)}><Upload /> {t('Publish')}</Button>
      </div>
      {step && <p className="mt-2 text-xs text-muted-foreground">{step}</p>}
    </div>
  )
}
