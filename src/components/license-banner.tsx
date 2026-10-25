import { CableCar, CalendarClock, Eye, GraduationCap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { t, tn } from '@/i18n'
import { daysUntil, LICENSE_WARNING_DAYS } from '@/lib/license'
import { formatDate } from '@/lib/utils'
import { useLiveLink } from '@/features/settings/api'

/** Tells the company's administrators that the licence ends soon. */
export function LicenseBanner() {
  const { company, can } = useCompany()
  const until = company?.license?.valid_until
  if (!until || !can('admin.read')) return null
  const days = daysUntil(until)
  if (days > LICENSE_WARNING_DAYS || days < 0) return null
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-center text-[13px] text-foreground print:hidden">
      <CalendarClock className="size-4 shrink-0 text-warning" />
      <span>
        {days === 0
          ? t('The licence for {company} ends today.', { company: company!.name })
          : tn(days, 'The licence for {company} ends on {date}, in {n} day.', 'The licence for {company} ends on {date}, in {n} days.', { company: company!.name, date: formatDate(until) })}
        {' '}{t('Contact your provider to renew it.')}
      </span>
    </div>
  )
}

const SUPPORT_KEY = 'nexus.support'
/** The platform owner opened this client's company on purpose (kept for the browser tab). */
export function startSupportVisit(companyId: string) {
  try { sessionStorage.setItem(SUPPORT_KEY, companyId) } catch { /* ignore */ }
}
export function isSupportVisit(companyId: string) {
  try { return sessionStorage.getItem(SUPPORT_KEY) === companyId } catch { return false }
}

/** Reminds the platform owner that they are inside a client's company, not their own. */
export function SupportBanner() {
  const { company, isSuperAdmin } = useCompany()
  if (!isSuperAdmin || !company || company.roles.length) return null
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-primary/30 bg-primary/10 px-4 py-1.5 text-center text-[13px] text-foreground print:hidden">
      <Eye className="size-4 shrink-0 text-primary" />
      <span>{t('You are inside {company} as the platform administrator. Changes you make are saved in the client\'s books.', { company: company.name })}</span>
      <Link to="/platform" className="font-medium text-primary hover:underline">{t('Back to clients')}</Link>
    </div>
  )
}

/** Practice company: everyone sees that nothing here is official. */
export function TrainingBanner() {
  const { company } = useCompany()
  if (!company?.is_training) return null
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-warning/40 bg-warning/15 px-4 py-1.5 text-center text-[13px] font-medium text-foreground print:hidden">
      <GraduationCap className="size-4 shrink-0 text-warning" />
      <span>{t('Training company: data comes from the old program, and nothing done here is official or sent to the tax office.')}</span>
    </div>
  )
}

/** The link with the old program went quiet: the company's admins should look at the agent. */
export function LiveLinkBanner() {
  const { can } = useCompany()
  const admin = can('admin.read')
  const live = useLiveLink(admin)
  const silent = (live.data?.conns ?? []).find((c) => c.is_active && c.last_seen_at && Date.now() - new Date(c.last_seen_at).getTime() > 10 * 60_000)
  if (!admin || !silent) return null
  return (
    <div role="alert" className="flex items-center justify-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-center text-[13px] text-foreground print:hidden">
      <CableCar className="size-4 shrink-0 text-destructive" />
      <span>{t('The link with the old program has sent nothing since {time}. Stock and sales here are not current.', { time: formatDate(silent.last_seen_at, true) })}</span>
      <Link to="/settings/migration" className="font-medium text-primary hover:underline">{t('See the agent log')}</Link>
    </div>
  )
}
