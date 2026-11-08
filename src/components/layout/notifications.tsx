import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck, TriangleAlert, Stamp, Info } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { supabase } from '@/lib/supabase'
import { t, tServer } from '@/i18n'
import { cn, formatDate } from '@/lib/utils'

const ICONS: Record<string, typeof Bell> = { alert: TriangleAlert, approval: Stamp }

export function NotificationsButton() {
  const { user } = useAuth()
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const key = ['notifications', companyId, user?.id]

  const { data = [] } = useQuery({
    queryKey: key,
    enabled: !!companyId && !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from('notifications')
        .select('id, type, title, body, link, read_at, created_at')
        .eq('company_id', companyId).order('created_at', { ascending: false }).limit(30)
      if (error) throw error
      return data
    },
  })
  const unread = data.filter((n) => !n.read_at).length

  React.useEffect(() => {
    if (!user || !companyId) return
    const ch = supabase.channel(`notif:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as { company_id: string; title: string; body: string | null }
          if (n.company_id === companyId) toast(tServer(n.title), { description: n.body ? tServer(n.body) : undefined })
          void qc.invalidateQueries({ queryKey: ['notifications'] })
        })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [user, companyId, qc])

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
      if (error) throw error
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<typeof data>(key)
      qc.setQueryData<typeof data>(key, (old) => old?.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)))
      return { prev }
    },
    onError: (_e, _v, ctx) => qc.setQueryData(key, ctx?.prev),
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={unread ? t('Notifications, {n} unread', { n: unread }) : t('Notifications')} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent data-tab-opener="" align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">{t('Notifications')}</span>
          <Button variant="ghost" size="xs" disabled={!unread} onClick={() => markRead.mutate(data.filter((n) => !n.read_at).map((n) => n.id))}>
            <CheckCheck /> {t('Mark all read')}
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {data.length === 0 && <p className="px-3 py-10 text-center text-sm text-muted-foreground">{t("You're all caught up.")}</p>}
          {data.map((n) => {
            const Icon = ICONS[n.type] ?? Info
            return (
              <button
                key={n.id}
                className={cn('flex w-full gap-2.5 border-b px-3 py-2.5 text-left last:border-0 hover:bg-secondary/60', !n.read_at && 'bg-accent/40')}
                onClick={() => {
                  if (!n.read_at) markRead.mutate([n.id])
                  if (n.link) { navigate(n.link); setOpen(false) }
                }}
              >
                <Icon className={cn('mt-0.5 size-4 shrink-0', n.type === 'alert' ? 'text-warning' : 'text-primary')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{tServer(n.title)}</span>
                  {n.body && <span className="block text-xs text-muted-foreground">{tServer(n.body)}</span>}
                  <span className="mt-0.5 block text-2xs text-muted-foreground">{formatDate(n.created_at, true)}</span>
                </span>
              </button>
            )
          })}
        </div>
        <div className="border-t p-1">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => { setOpen(false); navigate('/notifications') }}>{t('See all notifications')}</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
