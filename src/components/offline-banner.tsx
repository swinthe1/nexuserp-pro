import { CloudOff } from 'lucide-react'
import * as React from 'react'
import { t } from '@/i18n'

/** A thin bar under the top bar while the device has no internet. */
export function OfflineBanner() {
  const [online, setOnline] = React.useState(() => typeof navigator === 'undefined' || navigator.onLine)
  React.useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  if (online) return null
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-[13px] text-foreground print:hidden">
      <CloudOff className="size-4 text-warning" />
      {t('You are offline. You can keep looking around; changes are saved when the connection is back.')}
    </div>
  )
}
