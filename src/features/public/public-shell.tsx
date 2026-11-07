import { Link, NavLink } from 'react-router-dom'
import { Wordmark } from '@/components/wordmark'
import { t } from '@/i18n'
import { LanguageToggle } from '@/i18n/language'
import { cn } from '@/lib/utils'
import { LogoMark } from '@/components/logo-mark'

/** The dark band at the top of the public pages, with the way in. */
export function PublicHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="relative overflow-hidden bg-[#0B0B0C] text-white">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-48 size-[520px] rounded-full bg-white/[0.07] blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute -right-24 top-10 size-[460px] rounded-full bg-white/[0.05] blur-[130px]" />
      <nav className="relative mx-auto flex max-w-6xl items-center gap-2 px-4 py-4 sm:px-6">
        <Link to="/login" className="mr-auto flex items-center gap-2"><LogoMark className="text-white [&_g]:text-[#0B0B0C]" /> <Wordmark dark className="text-[19px]" /></Link>
        <PublicLink to="/paketat">{t('Packages|offer')}</PublicLink>
        <PublicLink to="/api" className="hidden sm:block">{t('For developers')}</PublicLink>
        <LanguageToggle className="hidden border-white/20 bg-white/10 text-white sm:inline-flex" />
        <Link to="/login" className="ml-1 rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-[#0B0B0C] hover:bg-white/90">{t('Sign in')}</Link>
      </nav>
      {children && <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">{children}</div>}
    </header>
  )
}

function PublicLink({ to, className, children }: { to: string; className?: string; children: React.ReactNode }) {
  return <NavLink to={to} className={({ isActive }) => cn('rounded-md px-3 py-1.5 text-sm text-white/75 hover:text-white', isActive && 'bg-white/10 text-white', className)}>{children}</NavLink>
}

export function PublicFooter() {
  return (
    <footer className="border-t py-8 text-center text-[13px] text-muted-foreground">
      <LogoMark className="mx-auto mb-2 size-6 text-foreground" />
      {t('DrisPRO · the business program for Kosovo and Albania')}
    </footer>
  )
}
