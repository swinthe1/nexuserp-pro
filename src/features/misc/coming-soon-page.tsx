import { Hammer } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { NAV } from '@/app/nav'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { t } from '@/i18n'

export function ComingSoonPage() {
  const { pathname } = useLocation()
  const item = NAV.flatMap((s) => s.items).find((i) => i.href !== '/' && pathname.startsWith(i.href))
  return (
    <>
      <PageHeader title={item?.label ? t(item.label) : t('Not available yet')} />
      <div className="rounded-lg border bg-card">
        <EmptyState icon={Hammer} title={t('This page is not available yet')}
          description={t('It will be added in a later update.')} />
      </div>
    </>
  )
}

export function NotFoundPage() {
  return <EmptyState title={t('Page not found')} description={t('Check the address, or use Ctrl K to jump to what you need.')} />
}
