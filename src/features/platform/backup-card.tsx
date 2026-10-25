import { DatabaseBackup } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { cn, formatDate } from '@/lib/utils'
import { t, tn } from '@/i18n'
import { useBackupStatus } from './api'

const size = (b: number | null | undefined) => {
  if (!b) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = b
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

/** Are the database copies being made, and is there room for them? */
export function BackupCard() {
  const q = useBackupStatus()
  const [open, setOpen] = React.useState(false)
  const last = q.data?.last_ok
  const failed = q.data?.last_failed
  const hours = last ? (Date.now() - new Date(last.at).getTime()) / 3_600_000 : null
  const failedSince = failed && (!last || failed.at > last.at)
  const freePct = last?.disk_free_bytes && last.disk_total_bytes ? (last.disk_free_bytes / last.disk_total_bytes) * 100 : null
  const state = !last ? { label: t('No copy yet'), variant: 'destructive' as const }
    : failedSince ? { label: t('Last copy failed'), variant: 'destructive' as const }
      : hours! > 26 ? { label: t('No copy for over a day'), variant: 'warning' as const }
        : freePct !== null && freePct < 15 ? { label: t('Disk almost full'), variant: 'warning' as const }
          : { label: t('Copies are made'), variant: 'success' as const }

  return (
    <div className="mt-6 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium"><DatabaseBackup className="size-4 text-muted-foreground" /> {t('Database copies')} <Badge variant={state.variant}>{state.label}</Badge></p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {q.isLoading ? '…' : last
              ? t('Last copy {time}, {size}. {n} copies this week. Disk: {free} free of {total}.', {
                  time: formatDate(last.at, true), size: size(last.size_bytes), n: q.data!.copies_week,
                  free: size(last.disk_free_bytes), total: size(last.disk_total_bytes) })
              : t('No copy has reported yet. Run Perditeso-serverin.bat once: it installs the nightly copy and makes the first one.')}
          </p>
          {failedSince && <p className="mt-1 text-[13px] text-destructive">{formatDate(failed!.at, true)}: {failed!.message}</p>}
        </div>
        {(q.data?.recent.length ?? 0) > 0 && (
          <button type="button" className="text-[13px] text-primary hover:underline" onClick={() => setOpen(!open)}>
            {open ? t('Hide') : tn(q.data!.recent.length, 'Show the last copy', 'Show the last {n} copies')}
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-3 grid gap-1 border-t pt-3 text-[13px]">
          {q.data!.recent.map((b) => (
            <li key={b.at} className="grid grid-cols-[150px_150px_1fr_auto] gap-3">
              <span className="tabular text-muted-foreground">{formatDate(b.at, true)}</span>
              <span>{b.kind === 'before-update' ? t('Before an update') : b.kind === 'manual' ? t('By hand') : t('Nightly')}</span>
              <span className={cn('truncate', !b.ok && 'text-destructive')}>{b.ok ? b.file?.split('/').pop() : b.message}</span>
              <span className="tabular">{b.ok ? size(b.size_bytes) : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
