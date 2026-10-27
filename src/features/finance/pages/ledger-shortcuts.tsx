import { Navigate, useNavigate } from 'react-router-dom'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { t, td } from '@/i18n'
import { useAccounts } from '../api'

/** "Libri i arkës": the ledger of the main cash account, as accountants look for it. */
export function CashBookPage() {
  const accounts = useAccounts()
  if (accounts.isLoading) return <Skeleton className="h-64" />
  const cash = (accounts.data ?? []).find((a) => a.is_postable && a.account_subtype === 'cash')
  if (!cash) return <EmptyState title={t('No cash account yet')} description={t('Add a cash account in the chart of accounts.')} />
  return <Navigate to={`/finance/accounts/${cash.id}`} replace />
}

/** "Kartela e kontos": choose an account and see every entry on it. */
export function AccountCardPage() {
  const accounts = useAccounts()
  const navigate = useNavigate()
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <PageHeader title={t('Account card')} description={t('Every entry on one account, with its running balance. Choose the account.')} />
      <Card><CardContent className="p-4">
        <SearchSelect value={null} onChange={(v) => v && navigate(`/finance/accounts/${v}`)} placeholder={t('Choose an account')}
          options={(accounts.data ?? []).filter((a) => a.is_postable).map((a) => ({ value: a.id, label: `${a.code} · ${td(a.name)}` }))} />
      </CardContent></Card>
    </div>
  )
}
