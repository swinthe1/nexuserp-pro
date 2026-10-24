import { Boxes, CheckCircle2, Contact, Download, FileUp, PackagePlus, TriangleAlert, Users } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { exportCsv } from '@/lib/export'
import { msg, t, tn, tServer } from '@/i18n'
import { cn, formatQty } from '@/lib/utils'
import { type ImportKind, type ImportResult, useImportRows } from '../api'
import { excelDate, normalize, type ParsedFile, parseFile } from '../lib/parse-file'

type Col = { key: string; label: string; required?: boolean; hint?: string; example: [string, string]; aliases?: string[]; date?: boolean }
type Kind = { key: ImportKind; title: string; description: string; perm: string; icon: typeof Boxes; columns: Col[]; done: { label: string; href: string } }

const KINDS: Kind[] = [
  { key: 'products', title: msg('Products'), description: msg('Items you buy, make or sell. Rows with an existing SKU update that product.'), perm: 'inventory.write', icon: Boxes,
    done: { label: msg('Open products'), href: '/inventory/products' },
    columns: [
      { key: 'sku', label: msg('SKU'), required: true, example: ['WATER-15', 'COF-ARABICA-1KG'], aliases: ['code', 'kodi', 'item code', 'artikulli'] },
      { key: 'name', label: msg('Name'), required: true, example: ['Spring water 1.5 L', 'Arabica beans 1 kg'], aliases: ['emertimi', 'pershkrimi', 'description', 'emri'] },
      { key: 'uom', label: msg('Unit'), hint: msg('pcs, kg, l… (default pcs)'), example: ['pcs', 'kg'], aliases: ['njesia', 'unit of measure'] },
      { key: 'type', label: msg('Type'), hint: msg('stockable, consumable or service'), example: ['stockable', 'stockable'], aliases: ['lloji'] },
      { key: 'category', label: msg('Category'), hint: msg('created if new'), example: ['Beverages', 'Coffee'], aliases: ['kategoria', 'grupi'] },
      { key: 'price', label: msg('Sales price'), hint: msg('without VAT'), example: ['80', '2400'], aliases: ['cmimi', 'cmimi i shitjes', 'sales price', 'price'] },
      { key: 'cost', label: msg('Standard cost'), example: ['42', '1450'], aliases: ['kosto', 'cost price'] },
      { key: 'vat', label: msg('VAT'), hint: msg('code or rate, e.g. VAT20 or 20'), example: ['VAT20', 'VAT20'], aliases: ['tvsh', 'tax'] },
      { key: 'barcode', label: msg('Barcode'), example: ['5901234123457', ''], aliases: ['barkodi', 'ean'] },
      { key: 'weight_kg', label: msg('Weight (kg)'), example: ['1.55', '1.05'], aliases: ['pesha'] },
      { key: 'brand', label: msg('Brand'), example: ['Glina', ''], aliases: ['marka'] },
    ] },
  { key: 'partners', title: msg('Customers and vendors'), description: msg('Matched by NIPT/NUI or code; existing partners are updated.'), perm: 'partners.write', icon: Users,
    done: { label: msg('Open partners'), href: '/partners' },
    columns: [
      { key: 'name', label: msg('Name'), required: true, example: ['Hotel Rogner', 'Ujë Glina sh.p.k.'], aliases: ['emri', 'emertimi', 'subjekti', 'company'] },
      { key: 'code', label: msg('Code'), hint: msg('numbered automatically when empty'), example: ['', ''], aliases: ['kodi'] },
      { key: 'role', label: msg('Role'), hint: msg('customer, vendor or both'), example: ['customer', 'vendor'], aliases: ['lloji', 'type'] },
      { key: 'tax_number', label: msg('NIPT / NUI'), example: ['K01725013D', 'J61812007A'], aliases: ['nipt', 'nui', 'tax number', 'vat number', 'numri fiskal'] },
      { key: 'email', label: msg('Email'), example: ['purchasing@rogner.al', ''], aliases: ['e mail', 'emaili'] },
      { key: 'phone', label: msg('Phone'), example: ['+355 4 223 5035', ''], aliases: ['telefoni', 'tel'] },
      { key: 'address', label: msg('Address'), example: ['Bulevardi Dëshmorët e Kombit', 'Rruga Glina'], aliases: ['adresa'] },
      { key: 'city', label: msg('City'), example: ['Tiranë', 'Sarandë'], aliases: ['qyteti'] },
      { key: 'country', label: msg('Country'), hint: msg('AL, XK…'), example: ['AL', 'AL'], aliases: ['shteti'] },
      { key: 'payment_terms', label: msg('Payment terms'), hint: msg('code, e.g. NET30'), example: ['NET15', 'NET30'], aliases: ['afati i pageses', 'terms'] },
      { key: 'credit_limit', label: msg('Credit limit'), example: ['150000', ''], aliases: ['limiti'] },
    ] },
  { key: 'employees', title: msg('Employees'), description: msg('With their department, position and salary contract. Matched by personal number.'), perm: 'hr.write', icon: Contact,
    done: { label: msg('Open employees'), href: '/hr/employees' },
    columns: [
      { key: 'first_name', label: msg('First name'), required: true, example: ['Ana', 'Gent'], aliases: ['emri'] },
      { key: 'last_name', label: msg('Last name'), required: true, example: ['Berisha', 'Hoxha'], aliases: ['mbiemri'] },
      { key: 'hire_date', label: msg('Hire date'), required: true, hint: msg('YYYY-MM-DD or 15.03.2026'), example: ['2024-03-01', '2025-09-15'], aliases: ['data e punesimit', 'fillimi'], date: true },
      { key: 'personal_number', label: msg('Personal number'), example: ['J70412011H', 'K85307023M'], aliases: ['nid', 'numri personal', 'nr personal'] },
      { key: 'date_of_birth', label: msg('Date of birth'), example: ['1990-04-12', '1995-07-30'], aliases: ['datelindja'], date: true },
      { key: 'email', label: msg('Email'), example: ['', ''], aliases: ['emaili'] },
      { key: 'phone', label: msg('Phone'), example: ['', ''], aliases: ['telefoni'] },
      { key: 'department', label: msg('Department'), hint: msg('created if new'), example: ['Sales', 'Warehouse'], aliases: ['departamenti', 'sektori'] },
      { key: 'position', label: msg('Position'), hint: msg('created if new'), example: ['Sales representative', 'Driver'], aliases: ['pozicioni', 'detyra'] },
      { key: 'gross_salary', label: msg('Gross salary'), hint: msg('monthly; creates the contract'), example: ['90000', '62000'], aliases: ['paga bruto', 'paga', 'salary'] },
      { key: 'hours_per_week', label: msg('Hours per week'), example: ['40', '40'], aliases: ['ore ne jave'] },
      { key: 'iban', label: msg('IBAN'), example: ['AL47212110090000000235698741', ''], aliases: ['llogaria bankare'] },
    ] },
  { key: 'opening_stock', title: msg('Opening stock'), description: msg('Quantities and costs on hand when you start. One warehouse per file; posted as one opening adjustment.'), perm: 'inventory.write', icon: PackagePlus,
    done: { label: msg('Open stock levels'), href: '/inventory/stock' },
    columns: [
      { key: 'sku', label: msg('SKU'), required: true, example: ['WATER-15', 'COF-ARABICA-1KG'], aliases: ['kodi', 'artikulli'] },
      { key: 'warehouse', label: msg('Warehouse code'), hint: msg('the same on every row'), example: ['WH', 'WH'], aliases: ['magazina'] },
      { key: 'location', label: msg('Location code'), hint: msg('default: the main stock location'), example: ['', ''], aliases: ['vendndodhja', 'bin'] },
      { key: 'quantity', label: msg('Quantity'), required: true, example: ['480', '25'], aliases: ['sasia', 'qty'] },
      { key: 'unit_cost', label: msg('Unit cost'), required: true, example: ['42', '1450'], aliases: ['kosto', 'cmimi i blerjes', 'cost'] },
      { key: 'lot', label: msg('Lot'), hint: msg('for lot-tracked items'), example: ['', 'BR-24-201'], aliases: ['loti', 'batch'] },
      { key: 'expiry', label: msg('Expiry'), example: ['', '2027-06-30'], aliases: ['skadenca', 'afati'], date: true },
    ] },
]

export function ImportPage() {
  const { can } = useCompany()
  const kinds = KINDS.filter((k) => can(k.perm))
  const [kindKey, setKindKey] = React.useState<ImportKind | null>(null)
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

function Importer({ kind }: { kind: Kind }) {
  const run = useImportRows()
  const [file, setFile] = React.useState<{ name: string; data: ParsedFile } | null>(null)
  const [mapping, setMapping] = React.useState<Record<string, number | null>>({})
  const [check, setCheck] = React.useState<ImportResult | null>(null)
  const [done, setDone] = React.useState<ImportResult | null>(null)
  const [drag, setDrag] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const load = async (f: File) => {
    try {
      const data = await parseFile(f)
      if (!data.rows.length) return toast.error(t('The file has column names but no rows.'))
      if (data.rows.length > 5000) return toast.error(t('Import at most 5,000 rows at a time; split the file.'))
      // match columns by name or a known alias (Albanian headers too)
      const heads = data.headers.map(normalize)
      const m: Record<string, number | null> = {}
      for (const c of kind.columns) {
        const names = [c.key, c.label, t(c.label), ...(c.aliases ?? [])].map(normalize)
        const i = heads.findIndex((h) => names.includes(h))
        m[c.key] = i >= 0 ? i : null
      }
      setFile({ name: f.name, data }); setMapping(m); setCheck(null); setDone(null)
    } catch (e) {
      toast.error(tServer((e as Error).message) || t('The file could not be read.'))
    }
  }
  const rows = React.useMemo(() => (file?.data.rows ?? []).map((r) => {
    const o: Record<string, string> = {}
    for (const c of kind.columns) {
      const i = mapping[c.key]
      const v = i === null || i === undefined ? '' : String(r[i] ?? '').trim()
      if (v !== '') o[c.key] = c.date ? excelDate(v) : v
    }
    return o
  }), [file, mapping, kind])
  const missing = kind.columns.filter((c) => c.required && (mapping[c.key] === null || mapping[c.key] === undefined))

  const template = () => exportCsv([0, 1], kind.columns.map((c) => ({ header: c.key, value: (i: number) => c.example[i] })), `import-${kind.key}-template`)
  const doCheck = async () => { setDone(null); setCheck(await run.mutateAsync({ kind: kind.key, rows, dryRun: true })) }
  const doImport = async () => {
    const r = await run.mutateAsync({ kind: kind.key, rows, dryRun: false })
    setDone(r); setCheck(null)
    if (!r.errors.length) toast.success(t('{created} created, {updated} updated', { created: r.created, updated: r.updated }))
  }

  return (
    <div className="mt-4 grid gap-4 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div><CardTitle>{t('1. Choose the file')}</CardTitle><CardDescription>{t('CSV (comma or semicolon) or Excel .xlsx; the first row holds the column names.')}</CardDescription></div>
            <Button variant="outline" size="sm" onClick={template}><Download /> {t('Template')}</Button>
          </CardHeader>
          <CardContent>
            <div onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void load(f) }}
              className={cn('flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-center', drag && 'border-primary bg-primary/5')}>
              <FileUp className="size-6 text-muted-foreground" />
              <p className="text-[13px]">{file ? <><span className="font-medium">{file.name}</span> · {tn(file.data.rows.length, '{n} row', '{n} rows')}</> : t('Drop the file here')}</p>
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>{file ? t('Choose another file') : t('Choose a file')}</Button>
              <input ref={inputRef} type="file" accept=".csv,.txt,.xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = '' }} />
            </div>
          </CardContent>
        </Card>
        {file && (
          <Card>
            <CardHeader><CardTitle>{t('2. Match the columns')}</CardTitle><CardDescription>{t('Columns were matched by name; change any that are wrong. Optional columns that are not in the file stay empty.')}</CardDescription></CardHeader>
            <CardContent className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {kind.columns.map((c) => (
                <div key={c.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-3">
                  <span className="text-[13px]">{t(c.label)} <span className="font-mono text-2xs text-muted-foreground">{c.key}</span>{c.required && <span className="text-destructive"> *</span>}
                    {c.hint && <span className="block text-xs text-muted-foreground">{t(c.hint)}</span>}</span>
                  <Select value={mapping[c.key] === null || mapping[c.key] === undefined ? 'none' : String(mapping[c.key])}
                    onValueChange={(v) => { setMapping({ ...mapping, [c.key]: v === 'none' ? null : Number(v) }); setCheck(null) }}>
                    <SelectTrigger aria-label={t('File column for {field}', { field: t(c.label) })} className={cn(c.required && mapping[c.key] == null && 'border-destructive')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('Not in the file')}</SelectItem>
                      {file.data.headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h || t('Column {n}', { n: i + 1 })}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
        {file && (
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>{t('Preview')}</CardTitle><CardDescription>{t('The first rows as they will be imported.')}</CardDescription></CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow><TableHead className="w-12 pl-6">{t('Row')}</TableHead>
                  {kind.columns.filter((c) => mapping[c.key] != null).map((c) => <TableHead key={c.key} className="whitespace-nowrap">{t(c.label)}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {rows.slice(0, 6).map((r, i) => (
                    <TableRow key={i}><TableCell className="pl-6 tabular text-muted-foreground">{i + 1}</TableCell>
                      {kind.columns.filter((c) => mapping[c.key] != null).map((c) => <TableCell key={c.key} className="whitespace-nowrap">{r[c.key] ?? ''}</TableCell>)}</TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader><CardTitle>{t('3. Check, then import')}</CardTitle>
            <CardDescription>{t('The check runs every row through the same rules as the import and saves nothing.')}</CardDescription></CardHeader>
          <CardContent className="grid gap-3">
            {missing.length > 0 && file && <p className="flex gap-2 text-[13px] text-destructive"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{t('Match the required columns: {columns}.', { columns: missing.map((c) => t(c.label)).join(', ') })}</p>}
            <Button variant="outline" disabled={!file || missing.length > 0} loading={run.isPending && run.variables?.dryRun} onClick={() => void doCheck()}>{t('Check the file')}</Button>
            {check && (check.errors.length
              ? <p className="text-[13px]"><span className="font-medium text-destructive">{tn(check.errors.length, '{n} row needs fixing.', '{n} rows need fixing.')}</span> {kind.key === 'opening_stock' ? t('Opening stock goes in as one document, so fix them first.') : t('The other rows can be imported now.')}</p>
              : <p className="flex items-center gap-2 text-[13px] text-success"><CheckCircle2 className="size-4" />{t('All {n} rows are fine: {created} new, {updated} updates.', { n: formatQty(check.rows), created: check.created, updated: check.updated })}</p>)}
            <Button disabled={!check || (kind.key === 'opening_stock' && check.errors.length > 0) || check.rows === check.errors.length} loading={run.isPending && !run.variables?.dryRun}
              onClick={() => void doImport()}>
              {check ? tn(check.rows - check.errors.length, 'Import {n} row', 'Import {n} rows') : t('Import rows')}
            </Button>
            {done && (
              <div className="rounded-md border bg-muted/40 p-3 text-[13px]">
                <p className="font-medium">{done.errors.length ? t('Imported: {created} created, {updated} updated, {skipped} skipped.', { created: done.created, updated: done.updated, skipped: done.errors.length }) : t('Imported: {created} created, {updated} updated.', { created: done.created, updated: done.updated })}</p>
                <Link to={done.adjustment_id ? `/inventory/adjustments/${done.adjustment_id}` : kind.done.href} className="text-primary hover:underline">
                  {done.adjustment_id ? t('Open the opening stock adjustment') : t(kind.done.label)}
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
        {(check ?? done)?.errors.length ? (
          <Card className="overflow-hidden">
            <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2">{t('Rows to fix')} <Badge variant="destructive">{(check ?? done)!.errors.length}</Badge></CardTitle></CardHeader>
            <div className="max-h-[420px] overflow-y-auto">
              <Table>
                <TableHeader><TableRow><TableHead className="pl-6">{t('Row')}</TableHead><TableHead>{t('Column')}</TableHead><TableHead>{t('Problem')}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(check ?? done)!.errors.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-6 tabular">{e.row + 1}</TableCell>
                      <TableCell className="whitespace-nowrap">{(() => { const c = kind.columns.find((x) => x.key === e.field); return c ? t(c.label) : e.field ?? '—' })()}</TableCell>
                      <TableCell>{tServer(e.message)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="border-t px-6 py-2 text-xs text-muted-foreground">{t('Row numbers count the column names as row 1, as in the spreadsheet.')}</p>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
