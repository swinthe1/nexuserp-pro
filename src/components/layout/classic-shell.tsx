import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Bot, GraduationCap, Menu, Plus, Printer, RefreshCw, Search } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { useCommandPalette } from '@/components/layout/command-palette'
import { CompanySwitcher } from '@/components/layout/company-switcher'
import { NewMenu } from '@/components/layout/new-menu'
import { NotificationsButton } from '@/components/layout/notifications'
import { ChatButton } from '@/features/chat/chat-button'
import { SidebarNav, useActiveHref, useMenuSections } from '@/components/layout/sidebar'
import { TillLockButton } from '@/components/layout/till-lock'
import { UserMenu } from '@/components/layout/user-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AssistantButton } from '@/features/assistant/assistant'
import { t } from '@/i18n'
import { LanguageToggle } from '@/i18n/language'
import { LastExportButton } from '@/components/layout/last-export'
import { cn, formatDate } from '@/lib/utils'

/*
 * The classic look: a Windows program as people know it from their old ERP. A title bar with the
 * company and the page, a menu bar with the parts of the program, a toolbar with big buttons,
 * the menu as a tree on the left and a status bar at the bottom. Same pages, same data.
 */

function useClock() {
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => { const id = window.setInterval(() => setNow(new Date()), 20_000); return () => window.clearInterval(id) }, [])
  return now
}
function useOnline() {
  const [on, setOn] = React.useState(() => navigator.onLine)
  React.useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return on
}
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

function ToolButton({ icon: Icon, label, onClick, disabled, ...rest }: { icon: typeof Plus; label: string; onClick?: () => void; disabled?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} {...rest}
      className="flex h-[58px] w-[74px] shrink-0 flex-col items-center justify-center gap-1 rounded-sm border border-transparent px-1 text-[12px] leading-tight text-foreground hover:border-[hsl(var(--border))] hover:bg-[hsl(var(--accent))] active:bg-[hsl(var(--secondary))] disabled:opacity-40 data-[state=open]:border-[hsl(var(--border))] data-[state=open]:bg-[hsl(var(--accent))]">
      <Icon className="size-[22px] text-primary" strokeWidth={1.6} />
      <span className="line-clamp-2 text-center">{label}</span>
    </button>
  )
}

function MenuBar() {
  const sections = useMenuSections()
  const navigate = useNavigate()
  const palette = useCommandPalette()
  return (
    <nav aria-label={t('Main menu')} className="hidden h-[28px] items-stretch gap-0 border-b bg-card px-1 text-[13px] lg:flex">
      {sections.map((s) => (
        <DropdownMenu key={s.label} modal={false}>
          <DropdownMenuTrigger className="rounded-sm px-2.5 outline-none hover:bg-[hsl(var(--accent))] focus-visible:bg-[hsl(var(--accent))] data-[state=open]:bg-[hsl(var(--accent))]">
            {t(s.title ?? s.label)}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={2} className="max-h-[70vh] min-w-56 overflow-y-auto rounded-sm p-1">
            {s.items.map((i, k) => {
              const heading = i.group && i.group !== s.items[k - 1]?.group ? i.group : null
              return (
                <React.Fragment key={i.href}>
                  {heading && <>{k > 0 && <DropdownMenuSeparator />}<DropdownMenuLabel className="py-1 text-2xs font-medium text-muted-foreground">{t(heading)}</DropdownMenuLabel></>}
                  <DropdownMenuItem className="h-7 gap-2 rounded-sm py-0 text-[13px]" onSelect={() => navigate(i.href)}>
                    <i.icon className="size-4 text-muted-foreground" />{t(i.label)}
                  </DropdownMenuItem>
                </React.Fragment>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className="rounded-sm px-2.5 outline-none hover:bg-[hsl(var(--accent))] data-[state=open]:bg-[hsl(var(--accent))]">{t('Help')}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={2} className="min-w-56 rounded-sm p-1">
          <DropdownMenuItem className="h-7 gap-2 rounded-sm py-0 text-[13px]" onSelect={() => palette.open()}><Search className="size-4 text-muted-foreground" />{t('Search or jump to…')}<span className="ml-auto text-2xs text-muted-foreground">Ctrl K{/* i18n-ignore */}</span></DropdownMenuItem>
          <DropdownMenuItem className="h-7 gap-2 rounded-sm py-0 text-[13px]" onSelect={() => window.dispatchEvent(new Event('drispro:assistant'))}><Bot className="size-4 text-muted-foreground" />{t('Assistant')}<span className="ml-auto text-2xs text-muted-foreground">Ctrl J{/* i18n-ignore */}</span></DropdownMenuItem>
          <DropdownMenuItem asChild className="h-7 gap-2 rounded-sm py-0 text-[13px]"><Link to="/training"><GraduationCap className="size-4 text-muted-foreground" />{t('Training')}</Link></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  )
}

export function ClassicShell({ children, onOpenMobileNav }: { children: React.ReactNode; onOpenMobileNav: () => void }) {
  const { company, hasFeature } = useCompany()
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const palette = useCommandPalette()
  const sections = useMenuSections()
  const activeHref = useActiveHref()
  const page = sections.flatMap((s) => s.items).find((i) => i.href === activeHref)
  const now = useClock()
  const online = useOnline()
  const [spin, setSpin] = React.useState(false)
  const who = (user?.user_metadata as { full_name?: string } | undefined)?.full_name || user?.email || ''
  const refresh = () => { setSpin(true); void qc.invalidateQueries().finally(() => window.setTimeout(() => setSpin(false), 400)) }

  return (
    <div className="classic-shell flex min-h-dvh flex-col pb-[26px]">
      <header className="sticky top-0 z-30 print:hidden">
        {/* the title bar */}
        <div className="classic-titlebar flex h-[30px] items-center gap-3 px-3 text-[13px] text-white">
          <button type="button" className="lg:hidden" onClick={onOpenMobileNav} aria-label={t('Open navigation')}><Menu className="size-4" /></button>
          <span className="font-semibold">DrisPRO</span>
          <span className="truncate opacity-90">{company?.name}{page ? ` — ${t(page.label)}` : ''}</span>
          <span className="ml-auto hidden truncate opacity-90 sm:inline">{who} · {formatDate(now)} {hhmm(now)}</span>
        </div>
        <MenuBar />
        {/* the toolbar */}
        <div className="flex h-[64px] items-center gap-0.5 overflow-x-auto border-b bg-[hsl(var(--muted))] px-1.5">
          <NewMenu trigger={<ToolButton icon={Plus} label={t('New|create')} />} />
          <ToolButton icon={Search} label={t('Search')} onClick={() => palette.open()} />
          <ToolButton icon={RefreshCw} label={t('Refresh')} onClick={refresh} className={spin ? '[&_svg]:animate-spin' : undefined} />
          <ToolButton icon={Printer} label={t('Print')} onClick={() => window.print()} />
          <span className="mx-1 h-10 w-px shrink-0 bg-[hsl(var(--border))]" />
          <ToolButton icon={ArrowLeft} label={t('Back')} onClick={() => navigate(-1)} />
          <ToolButton icon={ArrowRight} label={t('Forward')} onClick={() => navigate(1)} />
          {hasFeature('ai_assistant') && <><span className="mx-1 h-10 w-px shrink-0 bg-[hsl(var(--border))]" />
            <ToolButton icon={Bot} label={t('Assistant')} onClick={() => window.dispatchEvent(new Event('drispro:assistant'))} /></>}
          <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
            <LastExportButton />
            <LanguageToggle className="hidden sm:inline-flex" />
            <TillLockButton />
            {/* the assistant's own panel (Ctrl+J) lives in its launcher */}
            <span className="hidden"><AssistantButton /></span>
            <ChatButton />
            <NotificationsButton />
            <UserMenu />
          </div>
        </div>
      </header>
      <div className="flex min-w-0 flex-1">
        {/* the menu as a tree */}
        <aside className="classic-tree sticky top-[122px] hidden h-[calc(100dvh-122px-26px)] w-[250px] shrink-0 flex-col border-r bg-card lg:flex print:!hidden">
          <div className="border-b p-2"><CompanySwitcher /></div>
          <div className="flex-1 overflow-y-auto p-2"><SidebarNav /></div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
      {/* the status bar */}
      <footer className="classic-titlebar fixed inset-x-0 bottom-0 z-30 flex h-[26px] items-center gap-5 overflow-hidden whitespace-nowrap px-3 text-[12px] text-white print:hidden">
        <span className="flex items-center gap-1.5"><span className={cn('size-2 rounded-full', online ? 'bg-emerald-400' : 'bg-red-400')} />{online ? t('Connected to the server') : t('No connection: the till keeps selling')}</span>
        <span className="hidden truncate opacity-90 sm:inline">{t('Company')}: {company?.name}</span>
        <span className="hidden opacity-90 md:inline">{t('Server')}: {window.location.host}</span>
        <span className="ml-auto opacity-90">{formatDate(now)} {hhmm(now)}</span>
      </footer>
    </div>
  )
}
