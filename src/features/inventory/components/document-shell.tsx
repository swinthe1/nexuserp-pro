import { Ban, Send, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Can } from '@/app/company-provider'
import { ActivityTimeline } from '@/components/activity-timeline'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDate } from '@/lib/utils'
import { DOC_TABLE, useCancelDocument, useDeleteDocument, type DocKind } from '../api'
import { AccountingTab } from '@/features/finance/components/t-accounts'
import { msg, t } from '@/i18n'
import { MoreMenu } from '@/components/more-menu'

/** stock documents that post to the ledger (transfers move stock without changing its value) */
const GL_SOURCE: Partial<Record<DocKind, string>> = { receipts: 'goods_receipt', adjustments: 'stock_adjustment', 'landed-costs': 'landed_cost' }

export interface DocMeta { id: string; number: string; status: string; created_at?: string | null }

const LIST_HREF: Record<DocKind, { href: string; label: string }> = {
  receipts: { href: '/inventory/receipts', label: msg('Goods receipts') },
  adjustments: { href: '/inventory/adjustments', label: msg('Stock adjustments') },
  transfers: { href: '/inventory/transfers', label: msg('Transfers') },
  'landed-costs': { href: '/inventory/landed-costs', label: msg('Landed costs') },
}

/**
 * Frame for every inventory document: header with number + status, the
 * save/post/cancel/delete actions (permission-gated), the form body, an
 * optional summary column, and the activity timeline once the document exists.
 */
export function DocumentShell({
  kind, doc, newTitle, writePerm, saving, posting, onSave, onPost, postLabel, postConfirm, summary, children, banner, lines,
  postableStatuses = ['draft'],
}: {
  /** statuses in which the post action is offered (e.g. 'approved' for adjustments) */
  postableStatuses?: string[]
  kind: DocKind
  doc?: DocMeta
  newTitle: string
  writePerm: string
  saving?: boolean
  posting?: boolean
  onSave: () => void
  onPost: () => Promise<unknown>
  postLabel: string
  postConfirm: React.ReactNode
  summary?: React.ReactNode
  banner?: React.ReactNode
  /** full-width section under the header form (the lines table) */
  lines?: React.ReactNode
  children: React.ReactNode
}) {
  const navigate = useNavigate()
  const cancel = useCancelDocument(kind)
  const remove = useDeleteDocument(kind)
  const editable = !doc || doc.status === 'draft'
  const postable = !doc || postableStatuses.includes(doc.status)
  const list = { href: LIST_HREF[kind].href, label: t(LIST_HREF[kind].label) }

  return (
    <div className="w-full">
      <PageHeader
        back={list}
        title={doc ? doc.number : newTitle}
        meta={doc && <StatusBadge status={doc.status} />}
        description={doc?.created_at ? t('Created {date}', { date: formatDate(doc.created_at, true) }) : undefined}
        actions={postable && (
          <Can perm={writePerm}>
            {doc && editable && <MoreMenu items={[
              { label: t('Cancel document'), icon: Ban, onSelect: () => cancel.mutateAsync(doc.id),
                confirm: { title: t('Cancel {number}?', { number: doc.number }), description: t('It stays in the records as cancelled and can no longer be completed. Its number is kept.') } },
              { label: t('Delete draft'), icon: Trash2, destructive: true, separate: true, onSelect: async () => { await remove.mutateAsync(doc.id); navigate(list.href) },
                confirm: { title: t('Delete draft {number}?', { number: doc.number }), description: t('The draft is removed from the lists. Nothing was recorded yet, so stock does not change.') } },
            ]} />}
            {editable && <Button variant="outline" onClick={onSave} loading={saving}>{doc ? t('Save draft') : t('Create draft')}</Button>}
            <ConfirmDialog
              trigger={<Button disabled={saving || posting}><Send /> {postLabel}</Button>}
              title={`${postLabel}?`}
              description={postConfirm}
              confirmLabel={postLabel}
              onConfirm={onPost}
            />
          </Can>
        )}
      />
      {banner}
      {(() => {
        const body = (
          <>
            <div className={summary ? 'grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]' : ''}>
              <div className="min-w-0">{children}</div>
              {summary}
            </div>
            {lines}
          </>
        )
        return doc ? (
          <Tabs defaultValue="document">
            <TabsList><TabsTrigger value="document">{t('Document')}</TabsTrigger>{GL_SOURCE[kind] && <TabsTrigger value="accounting">{t('Accounting')}</TabsTrigger>}<TabsTrigger value="activity">{t('Activity')}</TabsTrigger></TabsList>
            <TabsContent value="document">{body}</TabsContent>
            <TabsContent value="activity" className="max-w-2xl"><ActivityTimeline table={DOC_TABLE[kind]} id={doc.id} /></TabsContent>
            {GL_SOURCE[kind] && <TabsContent value="accounting"><AccountingTab sourceType={GL_SOURCE[kind]!} sourceId={doc.id} /></TabsContent>}
          </Tabs>
        ) : body
      })()}
    </div>
  )
}

export function SummaryCard({ title, rows, footer }: { title?: string; rows: [React.ReactNode, React.ReactNode][]; footer?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title ?? t('Summary')}</CardTitle></CardHeader>
      <CardContent className="grid gap-2 text-[13px]">
        {rows.map(([k, v], i) => (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">{k}</span><span className="text-right tabular font-medium">{v}</span>
          </div>
        ))}
        {footer && <div className="mt-2 border-t pt-3 text-xs text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  )
}

/** Card wrapping an editable lines table */
export function LinesCard({ title, action, children, error }: { title: string; action?: React.ReactNode; children: React.ReactNode; error?: string }) {
  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-center justify-between space-y-0 py-3">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">{children}</CardContent>
      {error && <p className="px-4 pb-3 text-xs font-medium text-destructive">{error}</p>}
    </Card>
  )
}
