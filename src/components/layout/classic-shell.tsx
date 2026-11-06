import { useQueryClient } from '@tanstack/react-query'
import { UnitPicker } from '@/components/layout/unit-picker'
import { ArrowLeft, ArrowRight, Bot, Building2, CalendarDays, ChevronRight, Clock, GraduationCap, Keyboard, Menu, Plus, Printer, RefreshCw, Search, Server, UserRound } from 'lucide-react'
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
import { useFavourites } from '@/components/layout/nav-prefs'
import { moduleLook } from '@/app/modules'
import { TillLockButton } from '@/components/layout/till-lock'
import { UserMenu } from '@/components/layout/user-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { menuEntries } from '@/components/layout/hubs'
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

/** a command of the ribbon: a big one (the first of its group) or a small one beside it */
function ToolButton({ icon: Icon, label, onClick, disabled, tone, big, ...rest }: { icon: typeof Plus; label: string; onClick?: () => void; disabled?: boolean; tone?: string; big?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} {...rest}
      className={cn('classic-cmd flex shrink-0 flex-col items-center justify-center gap-1 rounded-[4px] border border-transparent px-1 text-[12px] leading-tight text-foreground disabled:opacity-40',
        big ? 'h-[62px] w-[68px]' : 'h-[62px] w-[62px]')}>
      <span className={cn('grid place-items-center rounded-[6px]', big ? 'size-8 text-white shadow-sm' : 'size-7')} style={big ? { background: `hsl(${tone ?? '158 82%'} 34%)` } : { color: `hsl(${tone ?? '213 56%'} 36%)` }}>
        <Icon className={big ? 'size-[18px]' : 'size-[20px]'} strokeWidth={big ? 2 : 1.7} />
      </span>
      <span className="line-clamp-2 max-w-full text-center">{label}</span>
    </button>
  )
}

/** a group of the ribbon, its name underneath */
function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="classic-group flex h-full shrink-0 flex-col border-r px-1">
      <div className="flex flex-1 items-center gap-0.5">{children}</div>
      <div className="pb-0.5 text-center text-[10.5px] leading-none text-muted-foreground">{label}</div>
    </div>
  )
}

/** the pages one opens most: the ones starred, otherwise the usual ones of a shop */
const USUAL = ['/pos', '/sales/invoices', '/procurement/bills', '/inventory/stock', '/finance/payments', '/finance/cash-book']
function useShortcuts() {
  const sections = useMenuSections()
  const { favourites } = useFavourites()
  return React.useMemo(() => {
    const all = sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label })))
    const by = new Map(all.map((i) => [i.href, i]))
    const pick = (favourites.length ? favourites : USUAL).map((h) => by.get(h)).filter((i): i is (typeof all)[number] => !!i && i.href !== '/')
    return pick.slice(0, 6)
  }, [sections, favourites])
}

function MenuBar() {
  const sections = useMenuSections()
  const navigate = useNavigate()
  const palette = useCommandPalette()
  const activeHref = useActiveHref()
  const here = sections.find((s) => s.items.some((i) => i.href === activeHref))?.label
  return (
    <nav aria-label={t('Main menu')} className="classic-menubar hidden h-[30px] items-stretch gap-0.5 border-b px-1.5 text-[13px] lg:flex">
      {sections.map((s) => {
        const look = moduleLook(s.label)
        return (
          <DropdownMenu key={s.label} modal={false}>
            <DropdownMenuTrigger data-here={s.label === here || undefined} style={{ '--mod': look.hue } as React.CSSProperties}
              className="classic-menu-item relative flex items-center gap-1.5 rounded-[3px] px-2.5 outline-none hover:bg-[hsl(var(--accent))] focus-visible:bg-[hsl(var(--accent))] data-[state=open]:bg-[hsl(var(--accent))]">
              <look.icon className="size-3.5" style={{ color: 'hsl(var(--mod) 38%)' }} strokeWidth={2} />
              {t(s.title ?? s.label)}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={2} className="max-h-[70vh] min-w-60 overflow-y-auto rounded-[4px] p-1 shadow-lg">
              {/* the same groups as the menu of the modern look: a group opens its pages beside it, a lone page opens at once */}
              {menuEntries(s.items).map((e) => {
                const on = e.items.some((i) => i.href === activeHref)
                const Icon = e.icon
                if (e.items.length === 1) return (
                  <DropdownMenuItem key={e.key} className={cn('h-8 gap-2 rounded-[3px] py-0 text-[13px]', on && 'bg-[hsl(var(--accent))] font-semibold')} onSelect={() => navigate(e.href)}>
                    <Icon className="size-4" style={{ color: `hsl(${look.hue} 38%)` }} />{t(e.label)}
                  </DropdownMenuItem>
                )
                return (
                  <DropdownMenuSub key={e.key}>
                    <DropdownMenuSubTrigger className={cn('h-8 gap-2 rounded-[3px] py-0 text-[13px]', on && 'bg-[hsl(var(--accent))] font-semibold')}
                      onClick={() => navigate(e.href)}>
                      <Icon className="size-4" style={{ color: `hsl(${look.hue} 38%)` }} />{t(e.label)}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent sideOffset={2} className="max-h-[70vh] min-w-56 overflow-y-auto rounded-[4px] p-1 shadow-lg">
                      {e.items.map((i) => (
                        <DropdownMenuItem key={i.href} className={cn('h-7 gap-2 rounded-[3px] py-0 text-[13px]', i.href === activeHref && 'bg-[hsl(var(--accent))] font-semibold')} onSelect={() => navigate(i.href)}>
                          <i.icon className="size-4" style={{ color: `hsl(${look.hue} 38%)` }} />{t(i.label)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      })}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className="rounded-[3px] px-2.5 outline-none hover:bg-[hsl(var(--accent))] data-[state=open]:bg-[hsl(var(--accent))]">{t('Help')}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={2} className="min-w-56 rounded-[4px] p-1 shadow-lg">
          <DropdownMenuItem className="h-7 gap-2 rounded-[3px] py-0 text-[13px]" onSelect={() => palette.open()}><Search className="size-4 text-muted-foreground" />{t('Search or jump to…')}<span className="ml-auto text-2xs text-muted-foreground">Ctrl K{/* i18n-ignore */}</span></DropdownMenuItem>
          <DropdownMenuItem className="h-7 gap-2 rounded-[3px] py-0 text-[13px]" onSelect={() => window.dispatchEvent(new Event('drispro:assistant'))}><Bot className="size-4 text-muted-foreground" />{t('Assistant')}<span className="ml-auto text-2xs text-muted-foreground">Ctrl J{/* i18n-ignore */}</span></DropdownMenuItem>
          <DropdownMenuItem asChild className="h-7 gap-2 rounded-[3px] py-0 text-[13px]"><Link to="/training"><GraduationCap className="size-4 text-muted-foreground" />{t('Training')}</Link></DropdownMenuItem>
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

  const here = sections.find((s) => s.items.some((i) => i.href === activeHref))
  const look = moduleLook(here?.label)
  const shortcuts = useShortcuts()

  return (
    <div className="classic-shell flex min-h-dvh flex-col pb-[28px]">
      <header className="sticky top-0 z-30 print:hidden">
        {/* the title bar: the program, where you are, who you are */}
        <div className="classic-titlebar flex h-[34px] items-center gap-3 px-3 text-[13px] text-white">
          <button type="button" className="lg:hidden" onClick={onOpenMobileNav} aria-label={t('Open navigation')}><Menu className="size-4" /></button>
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-[20px] place-items-center rounded-[5px] bg-white/95 text-[11px] font-extrabold text-[hsl(213_56%_26%)]">D</span>DrisPRO
          </span>
          <span className="h-4 w-px bg-white/25" />
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            <span className="truncate opacity-95">{company?.name}</span>
            {here && <><ChevronRight className="size-3.5 shrink-0 opacity-60" /><look.icon className="size-3.5 shrink-0" style={{ color: `hsl(${look.hue} 72%)` }} /><span className="truncate opacity-95">{t(here.title ?? here.label)}</span></>}
            {page && <><ChevronRight className="size-3.5 shrink-0 opacity-60" /><span className="truncate font-semibold">{t(page.label)}</span></>}
          </span>
          <span className="ml-auto hidden items-center gap-2 truncate opacity-90 sm:flex">
            <UserRound className="size-3.5" />{who}<span className="h-3.5 w-px bg-white/25" /><CalendarDays className="size-3.5" />{formatDate(now)} {hhmm(now)}
          </span>
        </div>
        <MenuBar />
        {/* the ribbon: the commands in groups, then the pages one opens most */}
        <div className="classic-ribbon flex h-[80px] items-stretch overflow-x-auto border-b px-1 pt-1">
          <RibbonGroup label={t('Document|ribbon')}>
            <NewMenu trigger={<ToolButton big icon={Plus} label={t('New|create')} tone="152 68%" />} />
            <ToolButton icon={Search} label={t('Search')} onClick={() => palette.open()} />
            <ToolButton icon={Printer} label={t('Print')} onClick={() => window.print()} />
          </RibbonGroup>
          <RibbonGroup label={t('View|ribbon')}>
            <ToolButton icon={ArrowLeft} label={t('Back')} onClick={() => navigate(-1)} />
            <ToolButton icon={ArrowRight} label={t('Forward')} onClick={() => navigate(1)} />
            <ToolButton icon={RefreshCw} label={t('Refresh')} onClick={refresh} className={spin ? '[&_svg]:animate-spin' : undefined} />
          </RibbonGroup>
          {shortcuts.length > 0 && (
            <RibbonGroup label={t('Shortcuts|ribbon')}>
              {shortcuts.map((i) => <ToolButton key={i.href} icon={i.icon} label={t(i.label)} tone={moduleLook(i.section).hue} onClick={() => navigate(i.href)}
                aria-current={i.href === activeHref ? 'page' : undefined} />)}
            </RibbonGroup>
          )}
          {hasFeature('ai_assistant') && (
            <RibbonGroup label={t('Help')}>
              <ToolButton icon={Bot} label={t('Assistant')} tone="262 60%" onClick={() => window.dispatchEvent(new Event('drispro:assistant'))} />
              <ToolButton icon={GraduationCap} label={t('Training')} tone="32 90%" onClick={() => navigate('/training')} />
            </RibbonGroup>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1 pl-2 pr-1">
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
        <aside className="classic-tree sticky top-[145px] hidden h-[calc(100dvh-145px-28px)] w-[256px] shrink-0 flex-col border-r lg:flex print:!hidden"
          style={{ '--mod': look.hue } as React.CSSProperties}>
          <div className="grid gap-1.5 border-b p-2"><CompanySwitcher /><UnitPicker /></div>
          <div className="flex-1 overflow-y-auto p-2"><SidebarNav /></div>
        </aside>
        <div className="classic-page flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
      {/* the status bar */}
      <footer className="classic-titlebar classic-status fixed inset-x-0 bottom-0 z-30 flex h-[28px] items-center overflow-hidden whitespace-nowrap px-1 text-[12px] text-white print:hidden">
        <span className="flex items-center gap-1.5"><span className={cn('size-2 rounded-full', online ? 'bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400' : 'bg-red-400')} />{online ? t('Connected to the server') : t('No connection: the till keeps selling')}</span>
        <span className="hidden truncate sm:flex"><Building2 className="size-3.5" />{company?.name}</span>
        <span className="hidden md:flex"><Server className="size-3.5" />{window.location.host}</span>
        {page && <span className="hidden lg:flex"><look.icon className="size-3.5" />{t(page.label)}</span>}
        <span className="ml-auto hidden md:flex"><Keyboard className="size-3.5" />Ctrl K {/* i18n-ignore */}· {t('Search')}</span>
        <span><Clock className="size-3.5" />{formatDate(now)} {hhmm(now)}</span>
      </footer>
    </div>
  )
}
