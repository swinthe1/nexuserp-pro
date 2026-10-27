import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Landmark, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { t } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { arbkUrl, type RegistryBusiness } from '@/lib/registry'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

/** What the business register says about a partner, with a link to see the rest on ARBK. */
export function RegistryLine({ partnerId }: { partnerId: string }) {
  const q = useQuery({ queryKey: ['partner-registry', partnerId], staleTime: 10 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc('partner_registry', { p_partner: partnerId })) as unknown as (RegistryBusiness & { updated_at: string }) | null })
  const b = q.data
  if (!b) return null
  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-2.5 text-[13px]', b.active ? 'bg-card' : 'border-warning/40 bg-warning/10')}>
      {b.active ? <Landmark className="size-4 text-primary" /> : <TriangleAlert className="size-4 text-warning" />}
      <span className="font-medium">{t('Business register')}:</span>
      <span className={cn('font-medium', b.active ? 'text-success' : 'text-warning')}>{b.active ? t('Active') : b.status}</span>
      {[b.name, b.legal_form, b.city, b.activity].filter(Boolean).map((x) => <span key={x} className="text-muted-foreground">· {x}</span>)}
      <a href={arbkUrl(b.nui)} target="_blank" rel="noreferrer" onClick={() => { void navigator.clipboard?.writeText(b.nui).then(() => toast.info(t('NUI {nui} copied: paste it in the ARBK search', { nui: b.nui }))).catch(() => {}) }} className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline">{t('See on ARBK')} <ExternalLink className="size-3" /></a>
    </div>
  )
}
