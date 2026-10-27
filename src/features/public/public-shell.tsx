import { Link, NavLink } from 'react-router-dom'
import { t } from '@/i18n'
import { LanguageToggle } from '@/i18n/language'
import { cn } from '@/lib/utils'

/** The dark band at the top of the public pages, with the way in. */
export function PublicHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="relative overflow-hidden bg-[hsl(196_48%_11%)] text-white">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-48 size-[520px] rounded-full bg-[#11A06E]/25 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute -right-24 top-10 size-[460px] rounded-full bg-[#1583C8]/20 blur-[130px]" />
      <nav className="relative mx-auto flex max-w-6xl items-center gap-2 px-4 py-4 sm:px-6">
        <Link to="/login" className="mr-auto flex items-center gap-2 text-[15px] font-semibold"><img src="/favicon.svg" alt="" className="size-7" /> DrisPRO</Link>
        <PublicLink to="/api">{t('For developers')}</PublicLink>
        <LanguageToggle className="hidden border-white/20 bg-white/10 text-white sm:inline-flex" />
        <Link to="/login" className="ml-1 rounded-md bg-white px-3 py-1.5 text-sm font-semibold text-[hsl(196_48%_11%)] hover:bg-white/90">{t('Sign in')}</Link>
      </nav>
      {children && <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">{children}</div>}
    </header>
  )
}

function PublicLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <NavLink to={to} className={({ isActive }) => cn('rounded-md px-3 py-1.5 text-sm text-white/75 hover:text-white', isActive && 'bg-white/10 text-white')}>{children}</NavLink>
}

export function PublicFooter() {
  return (
    <footer className="border-t py-8 text-center text-[13px] text-muted-foreground">
      <img src="/favicon.svg" alt="" className="mx-auto mb-2 size-6" />
      {t('DrisPRO · the business program for Kosovo and Albania')}
    </footer>
  )
}
