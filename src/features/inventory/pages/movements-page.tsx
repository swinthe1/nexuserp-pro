import { PageHeader } from '@/components/page-header'
import { MovementsTable } from '../components/movements-table'
import { t } from '@/i18n'

export function MovementsPage() {
  return (
    <>
      <PageHeader title={t('Stock movements')} description={t('Every item that came in, went out or moved, with the document behind it.')} />
      <MovementsTable />
    </>
  )
}
