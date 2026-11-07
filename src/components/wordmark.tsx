import { cn } from '@/lib/utils'

/** The DrisPRO name as it is drawn in the logo: Red Hat Display, heavy, "PRO" in green */
export function Wordmark({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span className={cn('font-brand font-black tracking-[-0.03em]', className)}>
      {'Dris'}<span className={dark ? 'text-[#6EE7B7]' : 'text-[#0E8A5F]'}>PRO</span>
    </span>
  )
}
