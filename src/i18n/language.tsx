import { Languages } from 'lucide-react'
import * as React from 'react'
import { useAuth } from '@/app/auth-provider'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { isLocale, LOCALES, type Locale, setLocale, t, useLocale } from './index'

const PENDING = 'drispro.lang.chosen'
// set once the person picks a language in this tab, so a slower profile read never overrides their choice
let choseHere = false

/** Re-mounts everything below it when the language changes, so all text is rendered again in the new language. */
export function LocaleBoundary({ children }: { children: React.ReactNode }) {
  const locale = useLocale()
  return <React.Fragment key={locale}>{children}</React.Fragment>
}

/** Changes the language; when signed in, remembers it on the profile so it follows the person to other devices. */
export function chooseLocale(l: Locale, userId?: string | null) {
  choseHere = true
  setLocale(l)
  // query builders only run when awaited/then-ed
  if (userId) void supabase.from('profiles').update({ locale: l }).eq('id', userId).then(({ error }) => { if (error) console.warn('[lang] not saved to profile', error.message) })
  else try { localStorage.setItem(PENDING, l) } catch { /* ignore */ }
}

/** After sign-in: a choice made on the sign-in page wins and is saved; otherwise the profile's language is used. */
export function LanguageSync() {
  const { user } = useAuth()
  React.useEffect(() => {
    if (!user) return
    let pending: string | null = null
    try { pending = localStorage.getItem(PENDING); localStorage.removeItem(PENDING) } catch { /* ignore */ }
    if (isLocale(pending)) { chooseLocale(pending, user.id); return }
    void supabase.from('profiles').select('locale').eq('id', user.id).maybeSingle().then(({ data }) => {
      const l = data?.locale
      if (!choseHere && isLocale(l)) setLocale(l)
    })
  }, [user])
  return null
}

/** SQ | EN | SR toggle for the top bar and the sign-in pages. */
export function LanguageToggle({ className }: { className?: string }) {
  const locale = useLocale()
  const { user } = useAuth()
  return (
    <div role="radiogroup" aria-label={t('Language')} className={cn('inline-flex h-8 items-center rounded-md border bg-card p-0.5 text-xs font-medium shadow-sm', className)}>
      {LOCALES.map((l) => (
        <button key={l.key} type="button" role="radio" aria-checked={locale === l.key} title={l.label} lang={l.key}
          onClick={() => chooseLocale(l.key, user?.id)}
          className={cn('h-full rounded px-2 transition-colors', locale === l.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
          {l.short}
        </button>
      ))}
    </div>
  )
}

/** Compact menu version for narrow screens. */
export function LanguageMenuButton() {
  const locale = useLocale()
  const { user } = useAuth()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('Language')}><Languages /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={locale} onValueChange={(v) => chooseLocale(v as Locale, user?.id)}>
          {LOCALES.map((l) => <DropdownMenuRadioItem key={l.key} value={l.key} lang={l.key}>{l.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
