import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { t } from '@/i18n'
import { LanguageToggle } from '@/i18n/language'

export function AuthLayout() {
  const { user, loading } = useAuth()
  if (!loading && user) return <Navigate to="/" replace />
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,560px)]">
      <div className="relative hidden overflow-hidden border-r bg-sidebar lg:block">
        <div className="absolute inset-0 opacity-[0.55] [background-image:linear-gradient(hsl(var(--border))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border))_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <img src="/favicon.svg" alt="" className="size-7" /> NexusERP Pro
          </div>
          <div className="max-w-md">
            <p className="text-3xl font-semibold leading-tight tracking-[-0.02em]">
              {t('Stock, sales, purchasing and accounting — all in one place.')}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              {t('Every receipt updates your average cost, and every movement can be traced back to its document. Made for shops, wholesalers and producers in Albania and Kosovo.')}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">{t('Several companies · Access by role · Full history of changes')}</p>
        </div>
      </div>
      <div className="relative flex items-center justify-center px-6 py-12">
        <LanguageToggle className="absolute right-4 top-4" />
        <div className="w-full max-w-sm"><Outlet /></div>
      </div>
    </div>
  )
}
