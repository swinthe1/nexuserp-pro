import { Lock } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { isPinSession, LOCK_AFTER_MIN, markPinSession } from '@/lib/shared-till'

/** On a shared till: a "Lock" button, and the lock by itself after a while without use. */
export function useTillLock() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const pin = isPinSession(user?.id)
  const lock = React.useCallback(async () => {
    markPinSession(null)
    await signOut()
    navigate('/login', { replace: true })
  }, [signOut, navigate])
  React.useEffect(() => {
    if (!pin) return
    let last = Date.now()
    const touch = () => { last = Date.now() }
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel']
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const timer = window.setInterval(() => { if (Date.now() - last > LOCK_AFTER_MIN * 60_000) void lock() }, 15_000)
    return () => { events.forEach((e) => window.removeEventListener(e, touch)); window.clearInterval(timer) }
  }, [pin, lock])
  return { pin, lock }
}

export function TillLockButton({ className }: { className?: string }) {
  const { pin, lock } = useTillLock()
  if (!pin) return null
  return (
    <Button variant="outline" size="sm" className={className} onClick={() => void lock()} title={t('Lock the till: the next person signs in with their PIN')}>
      <Lock /> {t('Lock|till')}
    </Button>
  )
}
