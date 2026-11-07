import { Menu, Search } from 'lucide-react'
import { NewMenu } from '@/components/layout/new-menu'
import { NotificationsButton } from '@/components/layout/notifications'
import { ChatButton } from '@/features/chat/chat-button'
import { UserMenu } from '@/components/layout/user-menu'
import { LastExportButton } from '@/components/layout/last-export'
import { BackButton } from '@/components/layout/back-button'
import { useCommandPalette } from '@/components/layout/command-palette'
import { Button } from '@/components/ui/button'
import { AssistantButton } from '@/features/assistant/assistant'
import { TillLockButton } from '@/components/layout/till-lock'
import { t } from '@/i18n'

export function Topbar({ onOpenMobileNav }: { onOpenMobileNav: () => void }) {
  const { open } = useCommandPalette()
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  return (
    <header className="sticky top-0 z-30 flex h-[52px] print:hidden items-center gap-2 border-b bg-card/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-card/75 sm:px-5">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onOpenMobileNav} aria-label={t('Open navigation')}>
        <Menu />
      </Button>
      <BackButton />
      <button
        onClick={() => open()}
        className="flex h-9 w-full min-w-0 max-w-md items-center gap-2 rounded-full border border-transparent bg-muted px-3.5 text-[13px] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-card hover:text-foreground"
      >
        <Search className="size-4" />
        <span className="flex-1 truncate text-left">{t('Search or jump to…')}</span>
        <kbd className="hidden rounded-md border bg-card px-1.5 text-2xs font-semibold sm:inline">{isMac ? '⌘' : 'Ctrl'} K</kbd>{/* i18n-ignore */}
      </button>
      {/* right next to the search: find something, or make something new */}
      <NewMenu />
      <div className="ml-auto flex items-center gap-1">
        <LastExportButton />
        <TillLockButton />
        <AssistantButton />
        <ChatButton />
        <NotificationsButton />
        <UserMenu />
      </div>
    </header>
  )
}
