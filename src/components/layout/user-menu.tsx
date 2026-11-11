import { Download, IdCard, KeyRound, Languages, LaptopMinimal, LayoutGrid, LogOut, Monitor, Moon, PanelLeft, BriefcaseBusiness, ServerCog, Smartphone, Sparkles, Sun, UserRound, GraduationCap, FolderDown, Minus, Plus, ZoomIn, PanelTop, Lightbulb } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { useTheme } from '@/app/theme-provider'
import { setZoom, stepZoom, useZoom, ZOOMS } from '@/app/zoom'
import { cn } from '@/lib/utils'
import { readTabsOn, writeTabsOn } from '@/components/layout/work-tabs'
import { MyLoginDialog, isPinOnlyEmail, useMyLogin } from '@/features/auth/login-setup'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LOCALES, type Locale, t, td, useLocale } from '@/i18n'
import { chooseLocale } from '@/i18n/language'
import { ChangePasswordDialog } from '@/components/change-password-dialog'
import { useInstallApp } from '@/components/pwa-prompts'
import { initials } from '@/lib/utils'
import { DesktopSettingsDialog } from '@/components/desktop-settings'
import { isDesktop } from '@/lib/desktop'
import { AiConnectorDialog } from '@/features/portal/ai-connector'
import { ProfileDialog } from '@/features/settings/components/profile-dialog'

export function UserMenu() {
  const { user, signOut } = useAuth()
  const { company, companies, isSuperAdmin, simple, setSimple } = useCompany()
  const keepsBooks = companies.length > 1 || companies.some((c) => c.roles.includes('accountant'))
  const [pwOpen, setPwOpen] = React.useState(false)
  const [pcOpen, setPcOpen] = React.useState(false)
  const [aiOpen, setAiOpen] = React.useState(false)
  const [meOpen, setMeOpen] = React.useState(false)
  const [pinOpen, setPinOpen] = React.useState(false)
  const myLogin = useMyLogin()
  const { theme, setTheme, look, setLook } = useTheme()
  const locale = useLocale()
  const { canInstall, install } = useInstallApp()
  const name = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:p-1.5" aria-label={t('Account menu')}>
        <Avatar className="size-7"><AvatarFallback>{initials(name)}</AvatarFallback></Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-tab-opener="" align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium text-foreground">{name}</div>
          <div className="truncate text-xs">{myLogin.data ? `@${myLogin.data.username}` : isPinOnlyEmail(user?.email) ? '' : user?.email}</div>
          {company && <div className="mt-1 truncate text-xs">{company.roles.map((r) => td(r.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))).join(', ')}</div>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {company && user && <DropdownMenuItem onSelect={() => setMeOpen(true)}><IdCard /> {t('My details')}</DropdownMenuItem>}
        <DropdownMenuItem asChild><Link to="/hr/me"><UserRound /> {t('My workplace')}</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/training"><GraduationCap /> {t('Training|menu')}</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/exports"><FolderDown /> {t('My exports')}</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to="/requests"><Lightbulb /> {t('Requests')}</Link></DropdownMenuItem>
        {isSuperAdmin && !myLogin.data
          ? <DropdownMenuItem onSelect={() => setPwOpen(true)}><KeyRound /> {t('Change password')}</DropdownMenuItem>
          : <DropdownMenuItem onSelect={() => setPinOpen(true)}><KeyRound /> {t('Change my PIN')}</DropdownMenuItem>}
        {company && (simple
          ? <DropdownMenuItem onSelect={() => setSimple(false)}><PanelLeft /> {t('Show all menus')}</DropdownMenuItem>
          : <DropdownMenuItem onSelect={() => setSimple(true)}><LayoutGrid /> {t('Simple view: large buttons')}</DropdownMenuItem>)}
        {keepsBooks && <DropdownMenuItem asChild><Link to="/accountant"><BriefcaseBusiness /> {t('My clients')}</Link></DropdownMenuItem>}
        {company && !isDesktop && <DropdownMenuItem asChild><Link to="/notifications?view=settings"><Smartphone /> {t('Notifications on the phone')}</Link></DropdownMenuItem>}
        {company && <DropdownMenuItem onSelect={() => setAiOpen(true)}><Sparkles /> {t('DrisPRO in ChatGPT and Claude')}</DropdownMenuItem>}
        {isSuperAdmin && <DropdownMenuItem asChild><Link to="/platform"><ServerCog /> {t('Clients and licences')}</Link></DropdownMenuItem>}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><Languages /> {t('Language')}: {LOCALES.find((l) => l.key === locale)?.label}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={locale} onValueChange={(v) => chooseLocale(v as Locale, user?.id)}>
              {LOCALES.map((l) => <DropdownMenuRadioItem key={l.key} value={l.key} lang={l.key}>{l.label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Monitor />} {t('Appearance')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
              <DropdownMenuRadioItem value="light">{t('Light')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">{t('Dark')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">{t('Same as device')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-2xs font-medium text-muted-foreground">{t('The look of the program')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={look} onValueChange={(v) => setLook(v as 'modern' | 'classic')}>
              <DropdownMenuRadioItem value="modern">{t('Modern')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="classic">{t('Classic (Windows)')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <ZoomRow />
        <TabsRow />
        {isDesktop && <DropdownMenuItem onSelect={() => setPcOpen(true)}><LaptopMinimal /> {t('This computer: printers')}</DropdownMenuItem>}
        {!isDesktop && canInstall && <DropdownMenuItem onSelect={() => void install()}><Download /> {t('Install the app on this device')}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}><LogOut /> {t('Sign out')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    {pinOpen && <MyLoginDialog onClose={() => setPinOpen(false)} />}
    <DesktopSettingsDialog open={pcOpen} onOpenChange={setPcOpen} />
    <AiConnectorDialog open={aiOpen} onOpenChange={setAiOpen} />
    {meOpen && user && <ProfileDialog userId={user.id} self onClose={() => setMeOpen(false)} />}
    </>
  )
}

/** Screen size: − 100% +, and "fit the screen" */
function ZoomRow() {
  const { setting, zoom } = useZoom()
  const pct = Math.round(zoom * 100)
  const btn = 'grid size-7 place-items-center rounded-md border bg-background text-foreground hover:bg-secondary disabled:opacity-40'
  return (
    <div className="hidden px-2 py-1.5 sm:block">
      <div className="flex items-center gap-2 text-sm">
        <ZoomIn className="size-4 text-muted-foreground" />
        <span className="flex-1">{t('Screen size')}</span>
        <button type="button" className={btn} aria-label={t('Smaller')} title={t('Smaller (Ctrl+Alt+−)')} disabled={zoom <= ZOOMS[0]} onClick={() => stepZoom(-1)}><Minus className="size-3.5" /></button>
        <button type="button" className="w-11 rounded-md py-1 text-center text-[13px] tabular hover:bg-secondary" title={t('Back to 100% (Ctrl+Alt+0)')} onClick={() => setZoom(1)}>{pct}%</button>
        <button type="button" className={btn} aria-label={t('Bigger')} title={t('Bigger (Ctrl+Alt++)')} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => stepZoom(1)}><Plus className="size-3.5" /></button>
      </div>
      <button type="button" onClick={() => setZoom(setting === 'auto' ? 1 : 'auto')}
        className={cn('mt-1.5 w-full rounded-md border px-2 py-1 text-left text-xs', setting === 'auto' ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary')}>
        {setting === 'auto' ? t('Fits the screen by itself: on') : t('Fit the screen by itself')}
      </button>
    </div>
  )
}

/** the work tabs above the page, on or off (on a phone there are none) */
function TabsRow() {
  const [on, setOn] = React.useState(readTabsOn)
  React.useEffect(() => { const o = () => setOn(readTabsOn()); window.addEventListener('drispro-tabs', o); return () => window.removeEventListener('drispro-tabs', o) }, [])
  return (
    <DropdownMenuItem className="max-lg:hidden" onSelect={(e) => { e.preventDefault(); writeTabsOn(!on) }}>
      <PanelTop /> <span className="flex-1">{t('Work tabs above the page')}</span>
      <span className={cn('relative h-4 w-7 rounded-full transition-colors', on ? 'bg-primary' : 'bg-muted-foreground/30')}>
        <span className={cn('absolute top-0.5 size-3 rounded-full bg-background transition-all', on ? 'left-3.5' : 'left-0.5')} />
      </span>
    </DropdownMenuItem>
  )
}
