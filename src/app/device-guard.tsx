import { useQuery } from '@tanstack/react-query'
import { ShieldAlert } from 'lucide-react'
import * as React from 'react'
import { useAuth } from '@/app/auth-provider'
import { DevicePairing } from '@/features/auth/device-pairing'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n'
import { renewLease } from '@/lib/device-licence'
import { supabase } from '@/lib/supabase'

type DeviceState = { guard: 'off' | 'warn' | 'on'; licensed: boolean }

/**
 * Watches this device's licence while someone works: renews its lease, and when the client lets only licensed
 * devices work and this one has none (or it was blocked, or its 30 days ran out), the person is signed out and
 * the sign-in page asks for a licence. When the client only warns, a line says so with a way to ask for one.
 */
export function DeviceGuard() {
  const { session, signOut } = useAuth()
  const [open, setOpen] = React.useState(false)
  const state = useQuery({
    queryKey: ['device-state', session?.user.id],
    enabled: !!session,
    refetchInterval: 10 * 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      void renewLease()
      const { data, error } = await supabase.rpc('device_state')
      if (error) throw error
      return data as unknown as DeviceState
    },
  })
  React.useEffect(() => {
    if (state.data?.guard === 'on' && !state.data.licensed) {
      void signOut().finally(() => window.location.assign('/login?device=1'))
    }
  }, [state.data, signOut])
  if (!session || state.data?.guard !== 'warn' || state.data.licensed) return null
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-3 border-t border-warning/40 bg-warning/10 px-4 py-2 text-sm backdrop-blur print:hidden" role="status">
        <ShieldAlert className="h-4 w-4 text-warning" aria-hidden />
        <span>{t('This device has no DrisPRO licence. Soon your company will let only licensed devices work.')}</span>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>{t('Ask for a licence')}</Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('A licence for this device')}</DialogTitle></DialogHeader>
          <DevicePairing onLicensed={() => { setOpen(false); void state.refetch() }} />
        </DialogContent>
      </Dialog>
    </>
  )
}
