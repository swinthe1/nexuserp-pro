import { Bell, CheckCheck, Info, Mail, Stamp, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useRealtimeInvalidate } from '@/hooks/use-realtime'
import { formatDateWith, msg, t, tServer } from '@/i18n'
import { cn, formatDate } from '@/lib/utils'
import { NOTIFICATION_CATEGORIES, type NotificationRow, useMarkNotifications, useNotificationCounts, useNotificationPrefs, useNotificationsFeed, useSaveNotificationPref } from '../api'
import { ToggleRow } from '../components/field'

const ICON: Record<string, typeof Bell> = { alert: TriangleAlert, approval: Stamp, info: Info }

function dayLabel(iso: string) {
  const d = new Date(iso), today = new Date()
  const diff = Math.floor((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  if (diff === 0) return t('Today')
  if (diff === 1) return t('Yesterday')
  if (diff < 7) { const w = formatDateWith(d, { weekday: 'long' }); return w.charAt(0).toUpperCase() + w.slice(1) }
  return formatDate(iso)
}

export function NotificationsPage() {
  const [params, setParams] = useSearchParams()
  const category = params.get('category') ?? 'all'
  const unreadOnly = params.get('unread') === '1'
  const view = params.get('view') ?? 'inbox'
  const feed = useNotificationsFeed(category, unreadOnly)
  const counts = useNotificationCounts()
  const { companyId } = useCompany()
  useRealtimeInvalidate('notifications', companyId, [['notifications']])
  const mark = useMarkNotifications()
  const navigate = useNavigate()
  const set = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }
  const unreadTotal = Object.values(counts.data ?? {}).reduce((a, b) => a + b, 0)

  const groups = React.useMemo(() => {
    const m = new Map<string, NotificationRow[]>()
    for (const n of feed.data ?? []) { const k = dayLabel(n.created_at); m.set(k, [...(m.get(k) ?? []), n]) }
    return [...m.entries()]
  }, [feed.data])

  return (
    <>
      <PageHeader title={t('Notifications')} description={t('Approvals waiting for you, deadlines, and things that need attention in this company.')}
        actions={view === 'inbox' && <Button variant="outline" disabled={!unreadTotal}
          onClick={() => void mark.mutateAsync({ ids: (feed.data ?? []).filter((n) => !n.read_at).map((n) => n.id), read: true })}><CheckCheck /> {t('Mark all as read')}</Button>} />
      <Tabs value={view} onValueChange={(v) => set('view', v === 'inbox' ? null : v)} className="mb-4">
        <TabsList><TabsTrigger value="inbox">{t('Inbox')}{unreadTotal ? ` · ${unreadTotal}` : ''}</TabsTrigger><TabsTrigger value="settings">{t('What you receive')}</TabsTrigger></TabsList>
      </Tabs>
      {view === 'settings' ? <Preferences /> : (
        <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label={t('Categories')}>
            {[{ key: 'all', label: msg('All') }, ...NOTIFICATION_CATEGORIES].map((c) => {
              const n = c.key === 'all' ? unreadTotal : counts.data?.[c.key] ?? 0
              return (
                <button key={c.key} type="button" onClick={() => set('category', c.key === 'all' ? null : c.key)}
                  className={cn('flex shrink-0 items-center justify-between gap-3 rounded-md px-3 py-1.5 text-left text-[13px] hover:bg-secondary/70', category === c.key && 'bg-secondary font-medium')}>
                  {t(c.label)}{n > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-xs tabular text-primary">{n}</span>}
                </button>
              )
            })}
            <Separator className="my-2 hidden lg:block" />
            <label className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-[13px]">
              <Switch checked={unreadOnly} onCheckedChange={(c) => set('unread', c ? '1' : null)} aria-label={t('Unread only')} /> {t('Unread only')}
            </label>
          </nav>
          <Card className="overflow-hidden">
            {feed.isError ? <ErrorState error={feed.error} onRetry={() => void feed.refetch()} /> : feed.isLoading ? <Skeleton className="m-4 h-64" /> : !feed.data?.length ? (
              <EmptyState icon={Bell} title={unreadOnly ? t('Nothing unread') : t('No notifications')} description={t('When something needs you, it appears here and in the bell at the top.')} />
            ) : groups.map(([day, list]) => (
              <section key={day}>
                <h2 className="border-b bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">{day}</h2>
                <ul>
                  {list.map((n) => {
                    const Icon = ICON[n.type] ?? Info
                    return (
                      <li key={n.id} className={cn('group flex items-start gap-3 border-b px-4 py-3 last:border-0', !n.read_at && 'bg-accent/30')}>
                        <Icon className={cn('mt-0.5 size-4 shrink-0', n.type === 'alert' ? 'text-warning' : 'text-primary')} />
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => {
                          if (!n.read_at) void mark.mutateAsync({ ids: [n.id], read: true })
                          if (n.link) navigate(n.link)
                        }}>
                          <span className={cn('block text-[13px]', !n.read_at && 'font-medium')}>{tServer(n.title)}</span>
                          {n.body && <span className="block text-xs text-muted-foreground">{tServer(n.body)}</span>}
                          <span className="mt-0.5 block text-2xs text-muted-foreground">{formatDate(n.created_at, true)} · {t(NOTIFICATION_CATEGORIES.find((c) => c.key === n.category)?.label ?? 'General')}</span>
                        </button>
                        <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => void mark.mutateAsync({ ids: [n.id], read: !n.read_at })}>{n.read_at ? t('Mark as unread') : t('Mark as read')}</Button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </Card>
        </div>
      )}
    </>
  )
}

function Preferences() {
  const prefs = useNotificationPrefs()
  const save = useSaveNotificationPref()
  const get = (k: string) => prefs.data?.find((p) => p.category === k)
  return (
    <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader><CardTitle>{t('In the app')}</CardTitle><CardDescription>{t('Turn off what you do not need to hear about. Daily reminders (deadlines, contracts, lots about to expire) belong to their category.')}</CardDescription></CardHeader>
        <CardContent>
          {NOTIFICATION_CATEGORIES.map((c, i) => (
            <React.Fragment key={c.key}>
              {i > 0 && <Separator />}
              <ToggleRow title={t(c.label)} description={t(c.description)}
                control={<div className="flex items-center gap-4">
                  <Switch checked={c.key === 'approvals' || (get(c.key)?.in_app ?? true)} disabled={c.key === 'approvals'} aria-label={t('{category} in the app', { category: t(c.label) })}
                    onCheckedChange={(v) => void save.mutateAsync({ category: c.key, in_app: v })} />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title={t('Email copies')}>
                    <Mail className="size-3.5" />
                    <Switch checked={get(c.key)?.email ?? false} aria-label={t('{category} by email', { category: t(c.label) })} onCheckedChange={(v) => void save.mutateAsync({ category: c.key, email: v })} />
                  </label>
                </div>} />
            </React.Fragment>
          ))}
        </CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="size-4" /> {t('Email copies')}</CardTitle>
          <CardDescription>{t('Your choice is saved now. Emails start arriving once your administrator connects a mail service.')}</CardDescription></CardHeader>
      </Card>
    </div>
  )
}
