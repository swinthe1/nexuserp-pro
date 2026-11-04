import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, FileSpreadsheet, FileText, FolderDown, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { DataTable } from '@/components/data-table/data-table'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { t, tServer } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { downloadExport, useMyExports, type MyExport } from '@/lib/my-exports'

type Row = MyExport

const size = (b: number | null) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

/** "Eksportet e mia": every file this person exported, to download again, open, or see where it came from. */
export function ExportsPage() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const list = useMyExports()
  const [busy, setBusy] = React.useState<string | null>(null)
  const again = async (r: Row) => { setBusy(r.id); try { await downloadExport(r) } catch (e) { toast.error(tServer(describeError(e))) } finally { setBusy(null) } }
  const open = async (r: Row) => {
    const { data, error } = await supabase.storage.from('my-exports').createSignedUrl(r.path, 300)
    if (error) toast.error(tServer(describeError(error))); else window.open(data.signedUrl, '_blank', 'noopener')
  }
  const del = useMutation({
    mutationFn: async (r: Row) => {
      await supabase.storage.from('my-exports').remove([r.path])
      unwrap(await supabase.from('my_exports').delete().eq('id', r.id))
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-exports', companyId] }),
    onError: (e) => toast.error(tServer(describeError(e))),
  })
  return (
    <>
      <PageHeader title={t('My exports')} description={t('Every Excel, CSV and PDF you exported from a list or a report. The browser put each in its Downloads folder; here you get the same file again, on any computer, for 90 days.')} />
      <DataTable<Row> tableKey="my.exports" data={list.data} isLoading={list.isLoading} error={list.error} getRowId={(r) => r.id} exportName={t('My exports')}
        searchPlaceholder={t('File or page…')}
        empty={{ title: t('No exports yet'), description: t('Export a list to Excel, CSV or PDF and it shows here.') }}
        columns={[
          { accessorKey: 'created_at', header: t('When'), meta: { label: t('When') }, cell: ({ getValue }) => formatDate(getValue() as string, true) },
          { accessorKey: 'file_name', header: t('File'), enableHiding: false, meta: { label: t('File') },
            cell: ({ row: { original: r } }) => <span className="flex items-center gap-2 font-medium">{r.kind === 'pdf' ? <FileText className="size-4 text-red-600" /> : <FileSpreadsheet className="size-4 text-emerald-600" />}{r.file_name}</span> },
          { accessorKey: 'kind', header: t('Type'), meta: { label: t('Type') }, cell: ({ getValue }) => String(getValue()).toUpperCase() },
          { id: 'page', accessorFn: (r) => r.page_title ?? r.page ?? '', header: t('From the page'), meta: { label: t('From the page') },
            cell: ({ row: { original: r } }) => r.page ? <Link className="text-primary hover:underline" to={r.page} onClick={(e) => e.stopPropagation()}>{r.page_title || r.page}</Link> : '' },
          { accessorKey: 'row_count', header: t('Rows'), meta: { label: t('Rows'), align: 'right' } },
          { accessorKey: 'size_bytes', header: t('Size'), meta: { label: t('Size'), align: 'right' }, cell: ({ getValue }) => size(getValue() as number | null) },
          { id: 'actions', header: '', enableHiding: false, meta: { noExport: true },
            cell: ({ row: { original: r } }) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="outline" loading={busy === r.id} onClick={() => void again(r)}><Download /> {t('Download again')}</Button>
                {r.kind === 'pdf' && <Button size="sm" variant="ghost" onClick={() => void open(r)} title={t('Open in a new tab')}><ExternalLink /></Button>}
                <Button size="sm" variant="ghost" className="text-muted-foreground" aria-label={t('Delete')} onClick={() => del.mutate(r)}><Trash2 /></Button>
              </div>
            ) },
        ]} />
      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground"><FolderDown className="size-4" />
        {t('Where the browser saved a file: press Ctrl+J in the browser for its downloads, with "Show in folder".')}</p>
    </>
  )
}
