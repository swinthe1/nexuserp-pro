import { ArrowLeft } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * One step back: the page you came from. Opened straight from a link or after a refresh there is no
 * page before it here, so it goes up one level (a document → its list) or to the start page.
 */
export function useGoBack(home = '/') {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
  const parts = pathname.split('/').filter(Boolean)
  const atHome = pathname === home || pathname === `${home}/`
  const go = () => {
    if (idx > 0) return navigate(-1)
    navigate(parts.length > 2 ? `/${parts.slice(0, -1).join('/')}` : home)
  }
  return { go, can: idx > 0 || !atHome }
}

/** the arrow at the left of the top bar, on every page but the start page with nothing before it */
export function BackButton({ home = '/', className }: { home?: string; className?: string }) {
  const { go, can } = useGoBack(home)
  if (!can) return null
  return (
    <button type="button" onClick={go} title={t('Back one step')} aria-label={t('Back one step')}
      className={cn('grid size-9 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary', className)}>
      <ArrowLeft className="size-[18px]" />
    </button>
  )
}
