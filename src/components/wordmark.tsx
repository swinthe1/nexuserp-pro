import { cn } from '@/lib/utils'

/** The DrisPRO name as it is drawn in the logo: Red Hat Display, heavy, "PRO" a shade lighter */
export function Wordmark({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span className={cn('font-brand font-black tracking-[-0.03em]', className)}>
      {'Dris'}<span className={dark ? 'text-white/55' : 'opacity-50'}>PRO</span>
    </span>
  )
}
