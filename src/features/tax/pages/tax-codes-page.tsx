import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Plus } from 'lucide-react'
import * as React from 'react'
import { z } from 'zod'
import { Can, useCompany } from '@/app/company-provider'
import { ColumnHeader, DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { SimpleFormDialog } from '@/components/simple-form-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { msg, t, td } from '@/i18n'
import { formatQty } from '@/lib/utils'
import { type TaxCode, useSaveTaxCode, useTaxAccounts, useTaxCodes } from '../api'

const schema = z.object({
  code: z.string().trim().min(1, 'Enter a code').max(20),
  name: z.string().trim().min(1, 'Enter a name'),
  rate: z.coerce.number().min(0).max(100),
  scope: z.enum(['sales', 'purchase', 'both']),
  vat_category: z.string().nullable(),
  is_exempt: z.boolean(),
  is_reverse_charge: z.boolean(),
  is_deductible: z.boolean(),
  exemption_code: z.string().trim().nullable().optional(),
  output_account_id: z.string().nullable(),
  input_account_id: z.string().nullable(),
  is_active: z.boolean(),
})
type Values = z.infer<typeof schema>

const CATEGORY: Record<string, string> = { exempt_credit: msg('Exempt with credit'), export: msg('Export'), farmer: msg('From farmers') }

export function TaxCodesPage() {
  const { company } = useCompany()
  const codes = useTaxCodes()
  const accounts = useTaxAccounts()
  const save = useSaveTaxCode()
  const [edit, setEdit] = React.useState<TaxCode | 'new' | null>(null)
  const accOptions = [{ value: '__none', label: t('Company default') }, ...(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.code} ${td(a.name)}` }))]
  const accName = (id: string | null) => { const a = accounts.data?.find((x) => x.id === id); return a ? a.code : t('default') }
  const xk = company?.country_code === 'XK'

  const cols = React.useMemo<ColumnDef<TaxCode>[]>(() => [
    { accessorKey: 'code', enableHiding: false, header: ({ column }) => <ColumnHeader column={column} title={t('Code')} />, meta: { label: t('Code') },
      cell: ({ row: { original: x } }) => <span className="font-medium">{x.code}{!x.is_active && <Badge variant="secondary" className="ml-2">{t('Inactive')}</Badge>}</span> },
    { accessorKey: 'name', header: t('Name'), meta: { label: t('Name') }, cell: ({ getValue }) => td(getValue() as string) },
    { accessorKey: 'rate', header: t('Rate'), meta: { label: t('Rate'), align: 'right' }, cell: ({ getValue }) => <span className="tabular">{formatQty(getValue() as number)}%</span> },
    { accessorKey: 'scope', header: t('Used on'), meta: { label: t('Used on') }, cell: ({ getValue }) => ({ both: t('Sales and purchases'), sales: t('Sales'), purchase: t('Purchases') } as Record<string, string>)[getValue() as string] },
    { id: 'treatment', accessorFn: (x) => treatment(x), header: t('VAT type'), meta: { label: t('VAT type') },
      cell: ({ row: { original: x } }) => <span className="flex flex-wrap gap-1">{treatmentBadges(x).map((b) => <Badge key={b} variant="secondary">{b}</Badge>)}</span> },
    { id: 'accounts', accessorFn: (x) => `${accName(x.output_account_id)} / ${accName(x.input_account_id)}`, header: t('Accounts (sales / purchases)'), meta: { label: t('Accounts') },
      cell: ({ getValue }) => <span className="tabular text-muted-foreground">{getValue() as string}</span> },
    { id: 'actions', header: '', enableHiding: false, meta: { noExport: true },
      cell: ({ row: { original: x } }) => <Can perm="tax.write"><Button size="icon-sm" variant="ghost" aria-label={t('Edit {name}', { name: x.code })} onClick={(e) => { e.stopPropagation(); setEdit(x) }}><Pencil /></Button></Can> },
  ], [accounts.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = edit && edit !== 'new' ? edit : null
  return (
    <>
      <PageHeader title={t('Tax codes')}
        description={xk ? t('VAT rates used on invoices. The VAT type decides the book column and the declaration field a line goes to.') : t('VAT rates used on invoices. The VAT type decides the book column and the declaration row a line goes to.')}
        actions={<Can perm="tax.write"><Button onClick={() => setEdit('new')}><Plus /> {t('New tax code')}</Button></Can>} />
      <DataTable tableKey="tax.codes" columns={cols} data={codes.data} isLoading={codes.isLoading} error={codes.error} getRowId={(r) => r.id} exportName="tax-codes"
        searchPlaceholder={t('Code, name…')} />
      <SimpleFormDialog<Values> open={!!edit} onOpenChange={(o) => !o && setEdit(null)}
        title={current ? t('Edit {name}', { name: current.code }) : t('New tax code')}
        description={t('Reverse charge: the vendor charges no VAT and the company books it as both sales and purchase VAT. Non-deductible VAT is added to the cost.')}
        schema={schema} submitLabel={current ? t('Save changes') : t('Create tax code')}
        defaultValues={{
          code: current?.code ?? '', name: current?.name ?? '', rate: current?.rate ?? 0, scope: (current?.scope as Values['scope']) ?? 'both',
          vat_category: current?.vat_category ?? '__none', is_exempt: current?.is_exempt ?? false, is_reverse_charge: current?.is_reverse_charge ?? false,
          is_deductible: current?.is_deductible ?? true, exemption_code: current?.exemption_code ?? '',
          output_account_id: current?.output_account_id ?? '__none', input_account_id: current?.input_account_id ?? '__none', is_active: current?.is_active ?? true,
        }}
        fields={[
          { name: 'code', label: t('Code'), half: true, uppercase: true, placeholder: 'VAT20' },
          { name: 'rate', label: t('Rate %'), type: 'number', half: true },
          { name: 'name', label: t('Name'), placeholder: t('VAT 20%') },
          { name: 'scope', label: t('Used on'), type: 'select', half: true, options: [{ value: 'both', label: t('Sales and purchases') }, { value: 'sales', label: t('Sales') }, { value: 'purchase', label: t('Purchases') }] },
          { name: 'vat_category', label: t('Book column'), type: 'select', half: true, options: [{ value: '__none', label: t('By rate') }, ...Object.entries(CATEGORY).map(([value, label]) => ({ value, label: t(label) }))],
            description: t('Only for exports, exempt sales with right to credit (XK [10]) and purchases from farmers (XK [51]).') },
          { name: 'is_exempt', label: t('Exempt'), type: 'switch', half: true },
          { name: 'is_reverse_charge', label: t('Reverse charge'), type: 'switch', half: true },
          { name: 'is_deductible', label: t('Purchase VAT can be deducted'), type: 'switch', half: true },
          { name: 'is_active', label: t('Active'), type: 'switch', half: true },
          { name: 'exemption_code', label: t('Exemption reason code'), optional: true, placeholder: t('e.g. TYPE_1 (fiscalization)') },
          { name: 'output_account_id', label: t('Sales VAT account'), type: 'select', half: true, options: accOptions },
          { name: 'input_account_id', label: t('Purchase VAT account'), type: 'select', half: true, options: accOptions },
        ]}
        onSubmit={async (v) => {
          const none = (x: string | null | undefined) => (!x || x === '__none' ? null : x)
          await save.mutateAsync({
            ...(current ? { id: current.id } : { country_code: company?.country_code }),
            code: v.code, name: v.name, rate: v.rate, scope: v.scope, vat_category: none(v.vat_category), is_exempt: v.is_exempt,
            is_reverse_charge: v.is_reverse_charge, is_deductible: v.is_deductible, exemption_code: v.exemption_code || null,
            output_account_id: none(v.output_account_id), input_account_id: none(v.input_account_id), is_active: v.is_active,
          })
        }} />
    </>
  )
}

function treatmentBadges(x: TaxCode) {
  const b: string[] = []
  if (x.is_reverse_charge) b.push(t('Reverse charge'))
  if (x.is_exempt) b.push(t('Exempt'))
  if (!x.is_deductible) b.push(t('Not deductible'))
  if (x.vat_category) b.push(CATEGORY[x.vat_category] ? t(CATEGORY[x.vat_category]!) : x.vat_category)
  if (!b.length) b.push(Number(x.rate) === 0 ? t('Zero rate') : t('Standard'))
  return b
}
const treatment = (x: TaxCode) => treatmentBadges(x).join(', ')
