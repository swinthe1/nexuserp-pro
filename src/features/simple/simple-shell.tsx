import { ArrowLeft } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { NotificationsButton } from '@/components/layout/notifications'
import { TillLockButton } from '@/components/layout/till-lock'
import { UserMenu } from '@/components/layout/user-menu'
import { Button } from '@/components/ui/button'
import { AssistantButton } from '@/features/assistant/assistant'
import { t } from '@/i18n'
import { LogoMark } from '@/components/logo-mark'

/** The top bar of the simple view: the way back to the start is always one large button. */
export function SimpleTopbar() {
  const { pathname } = useLocation()
  const { company } = useCompany()
  const home = pathname === '/'
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur print:hidden sm:px-5">
      {home ? (
        <div className="flex min-w-0 items-center gap-2">
          <LogoMark className="size-8 text-foreground" />
          <span className="truncate text-base font-semibold">{company?.name ?? 'DrisPRO'}</span>
        </div>
      ) : (
        <Button asChild size="lg" variant="outline" className="h-11 gap-2 rounded-xl px-4 text-base">
          <Link to="/"><ArrowLeft className="size-5" /> {t('Start')}</Link>
        </Button>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <TillLockButton className="h-10 rounded-xl px-3 text-sm" />
        <AssistantButton />
        <NotificationsButton />
        <UserMenu />
      </div>
    </header>
  )
}
