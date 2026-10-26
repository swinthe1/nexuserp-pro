import { Download, KeyRound, Languages, LaptopMinimal, LayoutGrid, LogOut, Monitor, Moon, PanelLeft, ServerCog, Sparkles, Sun, UserRound } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { useTheme } from '@/app/theme-provider'
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

export function UserMenu() {
  const { user, signOut } = useAuth()
  const { company, isSuperAdmin, simple, setSimple } = useCompany()
  const [pwOpen, setPwOpen] = React.useState(false)
  const [pcOpen, setPcOpen] = React.useState(false)
  const [aiOpen, setAiOpen] = React.useState(false)
  const { theme, setTheme } = useTheme()
  const locale = useLocale()
  const { canInstall, install } = useInstallApp()
  const name = (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:p-1.5" aria-label={t('Account menu')}>
        <Avatar className="size-7"><AvatarFallback>{initials(name)}</AvatarFallback></Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium text-foreground">{name}</div>
          <div className="truncate text-xs">{user?.email}</div>
          {company && <div className="mt-1 truncate text-xs">{company.roles.map((r) => td(r.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))).join(', ')}</div>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link to="/hr/me"><UserRound /> {t('My workplace')}</Link></DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setPwOpen(true)}><KeyRound /> {t('Change password')}</DropdownMenuItem>
        {company && (simple
          ? <DropdownMenuItem onSelect={() => setSimple(false)}><PanelLeft /> {t('Show all menus')}</DropdownMenuItem>
          : <DropdownMenuItem onSelect={() => setSimple(true)}><LayoutGrid /> {t('Simple view: large buttons')}</DropdownMenuItem>)}
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
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {isDesktop && <DropdownMenuItem onSelect={() => setPcOpen(true)}><LaptopMinimal /> {t('This computer: printers')}</DropdownMenuItem>}
        {!isDesktop && canInstall && <DropdownMenuItem onSelect={() => void install()}><Download /> {t('Install the app on this device')}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}><LogOut /> {t('Sign out')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    <DesktopSettingsDialog open={pcOpen} onOpenChange={setPcOpen} />
    <AiConnectorDialog open={aiOpen} onOpenChange={setAiOpen} />
    </>
  )
}
