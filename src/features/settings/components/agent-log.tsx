import * as React from 'react'
import { ErrorState } from '@/components/error-state'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { formatDateWith, t } from '@/i18n'
import { useAgentLog } from '../api'

const TONE = { info: 'text-muted-foreground', ok: 'text-success', warn: 'text-warning', error: 'text-destructive' } as const

/** What the agent on the client's server wrote, newest first, so nobody has to log in there to look. */
export function AgentLogSheet({ connection, onClose }: { connection: { id: string; name: string; agent_version?: string | null } | null; onClose: () => void }) {
  const [problems, setProblems] = React.useState(false)
  const log = useAgentLog(connection?.id ?? null, problems)
  const rows = log.data ?? []
  return (
    <Sheet open={!!connection} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>{t('Agent log · {name}', { name: connection?.name ?? '' })}</SheetTitle>
          <SheetDescription>
            {t('What the agent on the client’s server is doing, as it happens. Kept for a week.')}
            {connection?.agent_version && <> {t('Agent version {v}.', { v: connection.agent_version })}</>}
          </SheetDescription>
          <label className="mt-2 flex items-center gap-2 text-[13px]">
            <Switch checked={problems} onCheckedChange={setProblems} /> {t('Only warnings and errors')}
          </label>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {log.isLoading && <div className="grid gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-5" />)}</div>}
          {log.isError && <ErrorState compact error={log.error} onRetry={() => void log.refetch()} />}
          {log.data && rows.length === 0 && <p className="text-sm text-muted-foreground">{problems ? t('No warnings or errors this week.') : t('Nothing from the agent yet. Agent 2.4 or newer sends its log here.')}</p>}
          <ol className="grid gap-0.5 font-mono text-[12px] leading-5">
            {rows.map((r) => (
              <li key={r.id} className="grid grid-cols-[auto_1fr] gap-3">
                <time className="tabular text-muted-foreground" dateTime={r.at}>{formatDateWith(new Date(r.at), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                <span className={cn('whitespace-pre-wrap break-words', TONE[r.level])}>{r.msg}</span>
              </li>
            ))}
          </ol>
        </div>
      </SheetContent>
    </Sheet>
  )
}
