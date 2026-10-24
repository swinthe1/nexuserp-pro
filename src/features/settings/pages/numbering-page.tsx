import { Pencil } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ErrorState } from '@/components/error-state'
import { t, td } from '@/i18n'
import { humanize } from '@/lib/utils'
import { type NumberingRow, useNumbering, useSaveNumbering } from '../api'
import { Field } from '../components/field'

const preview = (prefix: string, year: boolean, padding: number, next: number) =>
  `${prefix}${year ? `${new Date().getFullYear()}-` : ''}${String(next).padStart(padding, '0')}`

export function NumberingPage() {
  const { can } = useCompany()
  const rows = useNumbering()
  const [editing, setEditing] = React.useState<NumberingRow | null>(null)
  const groups = React.useMemo(() => {
    const m = new Map<string, NumberingRow[]>()
    for (const r of rows.data ?? []) m.set(r.module, [...(m.get(r.module) ?? []), r])
    return [...m.entries()]
  }, [rows.data])
  return (
    <>
      <PageHeader title={t('Document numbering')} description={t('How each kind of document is numbered. Numbers have no gaps: they are taken when a document is saved and never reused.')} />
      {rows.isError ? <ErrorState error={rows.error} onRetry={() => void rows.refetch()} /> : rows.isLoading ? <Skeleton className="h-96" /> : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">{t('Document')}</TableHead>
                  <TableHead>{t('Next number')}</TableHead>
                  <TableHead>{t('Starts again')}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(([module, list]) => (
                  <React.Fragment key={module}>
                    <TableRow className="hover:bg-transparent"><TableCell colSpan={4} className="bg-muted/40 pl-6 text-xs font-medium text-muted-foreground">{humanize(module)}</TableCell></TableRow>
                    {list.map((r) => (
                      <TableRow key={r.doc_type}>
                        <TableCell className="pl-6">{td(r.name)}</TableCell>
                        <TableCell className="font-mono text-[13px]">{r.next_number}</TableCell>
                        <TableCell className="text-muted-foreground">{r.reset_policy === 'yearly' ? t('Every year') : t('Never')}</TableCell>
                        <TableCell>{can('admin.write') && <Button variant="ghost" size="icon-sm" aria-label={t('Change numbering of {name}', { name: td(r.name) })} onClick={() => setEditing(r)}><Pencil /></Button>}</TableCell>
                      </TableRow>
                    ))}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      {editing && <NumberingDialog row={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function NumberingDialog({ row, onClose }: { row: NumberingRow; onClose: () => void }) {
  const save = useSaveNumbering()
  const [prefix, setPrefix] = React.useState(row.prefix)
  const [year, setYear] = React.useState(row.include_year)
  const [padding, setPadding] = React.useState(row.padding)
  const [reset, setReset] = React.useState(row.reset_policy)
  const [next, setNext] = React.useState(row.next_value)
  const tooLow = next < row.next_value
  const badPrefix = !prefix.trim() || /\s/.test(prefix)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Numbers for {name}', { name: td(row.name) })}</DialogTitle>
          <DialogDescription>{t('Changes apply to the next document. Numbers already given stay as they are.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Prefix')} htmlFor="num-prefix" hint={badPrefix ? <span className="text-destructive">{t('No spaces, not empty.')}</span> : undefined}>
            <Input id="num-prefix" className="font-mono" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </Field>
          <Field label={t('Digits')} htmlFor="num-pad"><Input id="num-pad" type="number" min={2} max={10} className="tabular" value={padding} onChange={(e) => setPadding(Math.min(10, Math.max(2, Number(e.target.value) || 2)))} /></Field>
          <Field label={t('Year in the number')} htmlFor="num-year"><Switch id="num-year" checked={year} onCheckedChange={setYear} /></Field>
          <Field label={t('Start again from 1')} htmlFor="num-reset">
            <Select value={reset} onValueChange={setReset}>
              <SelectTrigger id="num-reset"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="yearly">{t('Every year')}</SelectItem><SelectItem value="never">{t('Never')}</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label={t('Next number')} htmlFor="num-next" className="sm:col-span-2"
            hint={tooLow ? <span className="text-destructive">{t('It can only move forward (now {n}), so no number is used twice.', { n: row.next_value })}</span> : t('Move it forward when continuing a series from another system.')}>
            <Input id="num-next" type="number" min={row.next_value} className="tabular" value={next} onChange={(e) => setNext(Number(e.target.value) || 1)} />
          </Field>
        </div>
        <p className="rounded-md bg-muted px-3 py-2 text-[13px]">{t('Next:')} <span className="font-mono font-medium">{preview(prefix, year, padding, next)}</span></p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={tooLow || badPrefix} loading={save.isPending}
            onClick={() => void save.mutateAsync({ doc_type: row.doc_type, prefix: prefix.trim(), include_year: year, padding, reset_policy: reset,
              next_value: next !== row.next_value ? next : null }).then(() => { toast.success(t('Numbering saved')); onClose() })}>
            {t('Save numbering')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
