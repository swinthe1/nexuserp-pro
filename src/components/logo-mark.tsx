import { cn } from '@/lib/utils'

/**
 * The DrisPRO mark in black and white: a tile in the text colour with the "D" cut out of it, so it is
 * black on a light page and white on a dark one (the page's text colour decides). public/favicon.svg
 * is the same drawing for the browser tab.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn('size-7 shrink-0', className)}>
      <rect width="64" height="64" rx="14" fill="currentColor" />
      <g transform="translate(10 10) scale(0.6875)" className="text-background">
        <rect x="6" y="8" width="20" height="20" rx="5" fill="currentColor" opacity="0.6" />
        <rect x="6" y="36" width="20" height="20" rx="5" fill="currentColor" />
        <path d="M32 8h2a24 24 0 0 1 0 48h-2z" fill="currentColor" />
      </g>
    </svg>
  )
}
