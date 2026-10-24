import * as React from 'react'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ImportKind } from '../api'
import { Importer, KINDS } from '../components/importer'

const BASIC: ImportKind[] = ['products', 'partners', 'employees', 'opening_stock']

export function ImportPage() {
  const { can } = useCompany()
  const kinds = KINDS.filter((k) => (BASIC as string[]).includes(k.key) && can(k.perm))
  const [kindKey, setKindKey] = React.useState<string | null>(null)
  const kind = kinds.find((k) => k.key === kindKey) ?? null
  if (!kinds.length) return <EmptyState title={t('Nothing you can import')} description={t('Importing needs the right to change products, customers and vendors, employees or stock.')} />
  return (
    <>
      <PageHeader title={t('Import data')} description={t('Bring products, customers and vendors, employees and opening stock in from a spreadsheet. The file is checked row by row before anything is saved.')} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kinds.map((k) => (
          <button key={k.key} type="button" onClick={() => setKindKey(k.key)}
            className={cn('flex flex-col items-start gap-1 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50', kindKey === k.key && 'border-primary ring-1 ring-primary')}>
            <k.icon className="mb-1 size-5 text-primary" />
            <span className="text-sm font-medium">{t(k.title)}</span>
            <span className="text-xs text-muted-foreground">{t(k.description)}</span>
          </button>
        ))}
      </div>
      {kind && <Importer key={kind.key} kind={kind} />}
    </>
  )
}
