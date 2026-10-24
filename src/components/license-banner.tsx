import { CalendarClock, Eye } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { t, tn } from '@/i18n'
import { daysUntil, LICENSE_WARNING_DAYS } from '@/lib/license'
import { formatDate } from '@/lib/utils'

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
