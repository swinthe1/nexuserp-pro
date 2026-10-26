import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { Field } from './field'

/** Average cost or FIFO; the switch takes effect at once (not with the form's Save) */
export function CostingMethodField({ value }: { value: string }) {
  const { companyId, can } = useCompany()
  const qc = useQueryClient()
  const fifo = value === 'fifo'
  const next = fifo ? 'weighted_average' : 'fifo'
  const [busy, setBusy] = React.useState(false)
  const apply = async () => {
    setBusy(true)
    try {
      unwrap(await supabase.rpc('costing_method_set', { p_company: companyId!, p_method: next }))
      toast.success(next === 'fifo' ? t('Stock is now valued first in, first out') : t('Stock is now valued at the average cost'))
      await qc.invalidateQueries()
    } catch (e) { toast.error(describeError(e)); throw e } finally { setBusy(false) }
  }
  return (
    <Field label={t('Costing method')} hint={fifo
      ? t('First in, first out: what is sold takes the cost of the oldest goods still in stock.')
      : t('Average: every receipt updates the average cost of the item.')}>
      <div className="flex items-center gap-2">
        <span className="flex h-9 flex-1 items-center truncate rounded-md border bg-muted/40 px-3 text-sm">{fifo ? t('First in, first out (FIFO)') : t('Weighted average')}</span>
        {can('finance.approve') && (
          <ConfirmDialog
            trigger={<Button variant="outline" size="sm" loading={busy}>{t('Change|method')}</Button>}
            title={next === 'fifo' ? t('Value stock first in, first out?') : t('Value stock at the average cost?')}
            description={next === 'fifo'
              ? t('What is in stock now starts as one layer at its average cost; from now on every receipt is a layer of its own and sales take the oldest first. Past movements stay as they are.')
              : t('From now on every receipt updates the average cost again. The layers kept for FIFO are dropped; past movements stay as they are.')}
            confirmLabel={t('Change|method')}
            onConfirm={apply}
          />
        )}
      </div>
    </Field>
  )
}
