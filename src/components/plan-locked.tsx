import { Lock } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useCompany } from '@/app/company-provider'
import { FEATURES, pageFeatures } from '@/lib/plans'
import { t } from '@/i18n'

/** Shown instead of a page whose module is not in the company's plan. */
export function PlanLocked({ path }: { path: string }) {
  const { company } = useCompany()
  const need = pageFeatures(path).map((f) => FEATURES.find((x) => x.key === f)).filter((x): x is (typeof FEATURES)[number] => !!x)
  const plan = need.some((f) => f.plan === 'standard') ? t('Standard') : t('Pro')
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-muted"><Lock className="size-5 text-muted-foreground" /></span>
      <h1 className="text-lg font-semibold">{company?.license?.plan === 'package' ? t('This module is not in your package') : t('This module is not in your plan')}</h1>
      <p className="text-sm text-muted-foreground">
        {company?.license?.plan === 'package'
          ? t('{module} is not among the modules of {company}. Ask your provider to add it to your licence.', { module: need.map((f) => t(f.label)).join(' / '), company: company?.name ?? '' })
          : need.length && need.every((f) => f.plan === 'paid')
          ? t('{module} is a separate module, each use has a cost. Ask your provider to add it to your licence.', { module: need.map((f) => t(f.label)).join(' / ') })
          : t('{module} comes with the {plan} plan. {company} is on {current}. Ask your provider to add it.', {
          module: need.map((f) => t(f.label)).join(' / '), plan, company: company?.name ?? '',
          current: company?.license?.plan === 'basic' ? t('Basic') : company?.license?.plan === 'standard' ? t('Standard') : t('Pro'),
        })}
      </p>
      <Button variant="outline" size="sm" asChild><Link to="/">{t('Back to the dashboard')}</Link></Button>
    </div>
  )
}
