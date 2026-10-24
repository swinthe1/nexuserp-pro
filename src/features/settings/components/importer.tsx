import { Boxes, CheckCircle2, Contact, Download, FileUp, HandCoins, ListTree, PackagePlus, Receipt, Save, Scale, Store, Tags, Trash2, TriangleAlert, Users } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { exportCsv } from '@/lib/export'
import { msg, t, tn, tServer } from '@/i18n'
import { cn, formatMoney, formatQty } from '@/lib/utils'
import { type AnyImportKind, isMigrationKind, type MigrationResult, useAnyImport, useDeleteImportTemplate, useImportTemplates, useSaveImportTemplate } from '../api'
import { excelDate, normalize, type ParsedFile, parseFile } from '../lib/parse-file'

/** 1.250,50 · 1,250.50 · 1250,5 · "18%" → 1250.50 / 18; anything else is passed on for the server to report */
export function plainNumber(v: string): string {
  let x = v.replace(/[\s\u00a0%€$]|lek[ëe]?|ALL|EUR/gi, '')
  if (/^-?[\d.]+,\d+$/.test(x)) x = x.replace(/\./g, '').replace(',', '.')
  else if (/^-?[\d,]+\.\d+$/.test(x)) x = x.replace(/,/g, '')
  else if (/^-?\d+,\d+$/.test(x)) x = x.replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(x)) x = x.replace(/\./g, '')
  return /^-?\d+(\.\d+)?$/.test(x) ? x : v
}

/** Kinds that go in as one document or entry: every row must be fine first */
const ALL_OR_NOTHING = new Set<AnyImportKind>(['opening_stock', 'open_receivables', 'open_payables', 'opening_balances'])

export type Col = { key: string; label: string; required?: boolean; hint?: string; example: [string, string]; aliases?: string[]; date?: boolean; num?: boolean }
export type Kind = { key: AnyImportKind; title: string; description: string; perm: string; icon: typeof Boxes; columns: Col[]; done: { label: string; href: string } }

export const KINDS: Kind[] = [
  { key: 'products', title: msg('Products'), description: msg('Items you buy, make or sell. Rows with an existing SKU update that product.'), perm: 'inventory.write', icon: Boxes,
    done: { label: msg('Open products'), href: '/inventory/products' },
    columns: [
      { key: 'sku', label: msg('SKU'), required: true, example: ['WATER-15', 'COF-ARABICA-1KG'], aliases: ['code', 'kodi', 'item code', 'shifra', 'sifra', 'kodi i artikullit', 'shifra e artikullit', 'plu'] },
      { key: 'name', label: msg('Name'), required: true, example: ['Spring water 1.5 L', 'Arabica beans 1 kg'], aliases: ['emertimi', 'pershkrimi', 'description', 'emri', 'artikulli', 'emertimi i artikullit', 'emri i artikullit'] },
      { key: 'uom', label: msg('Unit'), hint: msg('pcs, kg, l… (default pcs)'), example: ['pcs', 'kg'], aliases: ['njesia', 'unit of measure', 'njesia matese', 'nj m', 'njm', 'jm'] },
      { key: 'type', label: msg('Type'), hint: msg('stockable, consumable or service'), example: ['stockable', 'stockable'], aliases: ['lloji'] },
      { key: 'category', label: msg('Category'), hint: msg('created if new'), example: ['Beverages', 'Coffee'], aliases: ['kategoria', 'grupi', 'grupi i artikujve', 'nengrupi'] },
      { key: 'price', label: msg('Sales price'), hint: msg('without VAT'), example: ['80', '2400'], aliases: ['cmimi', 'cmimi i shitjes', 'sales price', 'price', 'qmimi', 'qmimi i shitjes', 'cmimi me pakice', 'qmimi me pakice', 'cmimi pa tvsh', 'qmimi pa tvsh'], num: true },
      { key: 'cost', label: msg('Standard cost'), example: ['42', '1450'], aliases: ['kosto', 'cost price', 'cmimi i blerjes', 'qmimi i blerjes', 'kosto mesatare'], num: true },
      { key: 'vat', label: msg('VAT'), hint: msg('code or rate, e.g. VAT20 or 20'), example: ['VAT20', 'VAT20'], aliases: ['tvsh', 'tax', 'tvsh %', 'norma e tvsh', 'norma tvsh'] },
      { key: 'barcode', label: msg('Barcode'), example: ['5901234123457', ''], aliases: ['barkodi', 'ean', 'barkod', 'bar kodi'] },
      { key: 'weight_kg', label: msg('Weight (kg)'), example: ['1.55', '1.05'], aliases: ['pesha'], num: true },
      { key: 'brand', label: msg('Brand'), example: ['Glina', ''], aliases: ['marka'] },
    ] },
  { key: 'partners', title: msg('Customers and vendors'), description: msg('Matched by NIPT/NUI or code; existing partners are updated.'), perm: 'partners.write', icon: Users,
    done: { label: msg('Open partners'), href: '/partners' },
    columns: [
      { key: 'name', label: msg('Name'), required: true, example: ['Hotel Rogner', 'Ujë Glina sh.p.k.'], aliases: ['emri', 'emertimi', 'subjekti', 'company', 'emri i subjektit', 'emri i biznesit', 'partneri', 'klienti', 'furnitori'] },
      { key: 'code', label: msg('Code'), hint: msg('numbered automatically when empty'), example: ['', ''], aliases: ['kodi', 'shifra', 'sifra', 'kodi i subjektit'] },
      { key: 'role', label: msg('Role'), hint: msg('customer, vendor or both'), example: ['customer', 'vendor'], aliases: ['lloji', 'type'] },
      { key: 'tax_number', label: msg('NIPT / NUI'), example: ['K01725013D', 'J61812007A'], aliases: ['nipt', 'nui', 'tax number', 'vat number', 'numri fiskal', 'nr fiskal', 'numri unik identifikues', 'nr biznesit', 'nrb'] },
      { key: 'email', label: msg('Email'), example: ['purchasing@rogner.al', ''], aliases: ['e mail', 'emaili'] },
      { key: 'phone', label: msg('Phone'), example: ['+355 4 223 5035', ''], aliases: ['telefoni', 'tel'] },
      { key: 'address', label: msg('Address'), example: ['Bulevardi Dëshmorët e Kombit', 'Rruga Glina'], aliases: ['adresa'] },
      { key: 'city', label: msg('City'), example: ['Tiranë', 'Sarandë'], aliases: ['qyteti', 'komuna'] },
      { key: 'country', label: msg('Country'), hint: msg('AL, XK…'), example: ['AL', 'AL'], aliases: ['shteti'] },
      { key: 'payment_terms', label: msg('Payment terms'), hint: msg('code, e.g. NET30'), example: ['NET15', 'NET30'], aliases: ['afati i pageses', 'terms'] },
      { key: 'credit_limit', label: msg('Credit limit'), example: ['150000', ''], aliases: ['limiti'], num: true },
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
      { key: 'gross_salary', label: msg('Gross salary'), hint: msg('monthly; creates the contract'), example: ['90000', '62000'], aliases: ['paga bruto', 'paga', 'salary'], num: true },
      { key: 'hours_per_week', label: msg('Hours per week'), example: ['40', '40'], aliases: ['ore ne jave'], num: true },
      { key: 'iban', label: msg('IBAN'), example: ['AL47212110090000000235698741', ''], aliases: ['llogaria bankare'] },
    ] },
  { key: 'opening_stock', title: msg('Opening stock'), description: msg('Quantities and costs on hand when you start. One warehouse per file; posted as one opening adjustment.'), perm: 'inventory.write', icon: PackagePlus,
    done: { label: msg('Open stock levels'), href: '/inventory/stock' },
    columns: [
      { key: 'sku', label: msg('SKU'), required: true, example: ['WATER-15', 'COF-ARABICA-1KG'], aliases: ['kodi', 'shifra', 'sifra', 'kodi i artikullit', 'shifra e artikullit'] },
      { key: 'warehouse', label: msg('Warehouse code'), hint: msg('the same on every row'), example: ['WH', 'WH'], aliases: ['magazina'] },
      { key: 'location', label: msg('Location code'), hint: msg('default: the main stock location'), example: ['', ''], aliases: ['vendndodhja', 'bin'] },
      { key: 'quantity', label: msg('Quantity'), required: true, example: ['480', '25'], aliases: ['sasia', 'qty', 'gjendja', 'sasia ne stok', 'stoku'], num: true },
      { key: 'unit_cost', label: msg('Unit cost'), required: true, example: ['42', '1450'], aliases: ['kosto', 'cmimi i blerjes', 'cost', 'qmimi i blerjes', 'kosto mesatare', 'cmimi mesatar', 'qmimi mesatar'], num: true },
      { key: 'lot', label: msg('Lot'), hint: msg('for lot-tracked items'), example: ['', 'BR-24-201'], aliases: ['loti', 'batch'] },
      { key: 'expiry', label: msg('Expiry'), example: ['', '2027-06-30'], aliases: ['skadenca', 'afati'], date: true },
    ] },
  { key: 'warehouses', title: msg('Stores and warehouses'), description: msg('Every store or warehouse the stock sits in, with the code the stock files use.'), perm: 'admin.write', icon: Store,
    done: { label: msg('Open warehouses'), href: '/inventory/warehouses' },
    columns: [
      { key: 'code', label: msg('Code'), required: true, example: ['1', '2'], aliases: ['kodi', 'shifra', 'nr', 'value'] },
      { key: 'name', label: msg('Name'), required: true, example: ['Store 1 Drenas', 'Store 2 Korroticë'], aliases: ['emri', 'emertimi', 'njesia', 'magazina'] },
      { key: 'type', label: msg('Type'), hint: msg('store or warehouse (default store)'), example: ['store', 'store'], aliases: ['lloji'] },
      { key: 'address', label: msg('Address'), example: ['', ''], aliases: ['adresa'] },
      { key: 'city', label: msg('City'), example: ['Drenas', 'Korroticë'], aliases: ['qyteti', 'komuna'] },
    ] },
  { key: 'accounts', title: msg('Chart of accounts'), description: msg('The accounts of the old program with their codes, so balances can come in as they were.'), perm: 'admin.write', icon: ListTree,
    done: { label: msg('Open the chart of accounts'), href: '/finance/accounts' },
    columns: [
      { key: 'code', label: msg('Account code'), required: true, example: ['12103', '50001'], aliases: ['konto', 'kodi', 'llogaria', 'value'] },
      { key: 'name', label: msg('Name'), required: true, example: ['Receivables', 'Product expenses'], aliases: ['emri', 'emertimi', 'pershkrimi'] },
      { key: 'type', label: msg('Type'), required: true, hint: msg('asset, liability, equity, revenue or expense (A, L, O, R, E)'), example: ['A', 'E'], aliases: ['lloji', 'accounttype'] },
      { key: 'subtype', label: msg('Kind'), hint: msg('optional: bank, cash, receivable, payable, inventory, tax…'), example: ['receivable', ''], aliases: ['nenlloji'] },
    ] },
  { key: 'price_lists', title: msg('Price lists'), description: msg('Special prices per list, e.g. wholesale. Lists are created when new; existing prices are updated.'), perm: 'sales.write', icon: Tags,
    done: { label: msg('Open price lists'), href: '/sales/price-lists' },
    columns: [
      { key: 'price_list', label: msg('Price list'), required: true, example: ['Wholesale', 'Wholesale'], aliases: ['lista', 'lista e cmimeve', 'emri i listes', 'cmimorja'] },
      { key: 'sku', label: msg('SKU'), required: true, example: ['WATER-15', 'COF-ARABICA-1KG'], aliases: ['kodi', 'shifra', 'sifra', 'kodi i artikullit'] },
      { key: 'price', label: msg('Price'), required: true, hint: msg('without VAT'), example: ['0.32', '11.50'], aliases: ['cmimi', 'cmimi i shitjes', 'cmimi pa tvsh', 'qmimi', 'qmimi pa tvsh'], num: true },
      { key: 'min_quantity', label: msg('From quantity'), hint: msg('default 1'), example: ['', '10'], aliases: ['sasia minimale', 'nga sasia'], num: true },
      { key: 'currency', label: msg('Currency'), hint: msg('default: the company currency'), example: ['', ''], aliases: ['valuta', 'monedha'] },
    ] },
  { key: 'open_receivables', title: msg('Open customer invoices'), description: msg('What each customer still owes on the cut-over date, invoice by invoice. They age and take payments like any invoice.'), perm: 'admin.write', icon: HandCoins,
    done: { label: msg('Open customer balances'), href: '/finance/receivables' },
    columns: [
      { key: 'partner', label: msg('Customer'), required: true, hint: msg('code, NUI/NIPT or exact name'), example: ['K001', '810000002'], aliases: ['klienti', 'kodi i klientit', 'subjekti', 'bleresi', 'partneri', 'nui', 'nipt', 'emri i klientit'] },
      { key: 'number', label: msg('Invoice number'), required: true, example: ['F-120/25', 'F-131/25'], aliases: ['nr fatures', 'nr. fatures', 'numri i fatures', 'fatura', 'dokumenti', 'nr dok', 'nr. dok', 'numri'] },
      { key: 'date', label: msg('Invoice date'), hint: msg('default: the cut-over date'), example: ['2026-08-10', '01.09.2026'], aliases: ['data', 'data e fatures', 'data e dokumentit'], date: true },
      { key: 'due_date', label: msg('Due date'), example: ['2026-09-10', ''], aliases: ['afati', 'afati i pageses', 'data e pageses', 'maturimi', 'skadenca'], date: true },
      { key: 'amount', label: msg('Amount still owed'), required: true, hint: msg('what is left to pay, not the invoice total; negative for credit notes'), example: ['1250.50', '300'], aliases: ['saldo', 'borxhi', 'mbetja', 'per pagese', 'detyrimi', 'shuma', 'e papaguar', 'mbetur'], num: true },
      { key: 'currency', label: msg('Currency'), hint: msg('default: the company currency'), example: ['', ''], aliases: ['valuta', 'monedha'] },
      { key: 'rate', label: msg('Exchange rate'), hint: msg('only for other currencies'), example: ['', ''], aliases: ['kursi'], num: true },
    ] },
  { key: 'open_payables', title: msg('Open vendor bills'), description: msg('What you still owe each vendor on the cut-over date, bill by bill.'), perm: 'admin.write', icon: Receipt,
    done: { label: msg('Open vendor balances'), href: '/finance/payables' },
    columns: [
      { key: 'partner', label: msg('Vendor'), required: true, hint: msg('code, NUI/NIPT or exact name'), example: ['F001', '810000003'], aliases: ['furnitori', 'kodi i furnitorit', 'subjekti', 'shitesi', 'partneri', 'nui', 'nipt', 'emri i furnitorit'] },
      { key: 'number', label: msg('Vendor invoice number'), required: true, example: ['DV-889', 'DV-901'], aliases: ['nr fatures', 'nr. fatures', 'numri i fatures', 'fatura', 'dokumenti', 'nr dok', 'numri'] },
      { key: 'date', label: msg('Bill date'), hint: msg('default: the cut-over date'), example: ['2026-09-20', ''], aliases: ['data', 'data e fatures', 'data e dokumentit'], date: true },
      { key: 'due_date', label: msg('Due date'), example: ['2026-10-20', ''], aliases: ['afati', 'afati i pageses', 'data e pageses', 'maturimi', 'skadenca'], date: true },
      { key: 'amount', label: msg('Amount still owed'), required: true, hint: msg('what is left to pay, not the bill total; negative for credit notes'), example: ['800', '100'], aliases: ['saldo', 'borxhi', 'mbetja', 'per pagese', 'detyrimi', 'shuma', 'e papaguar', 'mbetur'], num: true },
      { key: 'currency', label: msg('Currency'), hint: msg('default: the company currency'), example: ['', 'USD'], aliases: ['valuta', 'monedha'] },
      { key: 'rate', label: msg('Exchange rate'), hint: msg('only for other currencies'), example: ['', '0.92'], aliases: ['kursi'], num: true },
    ] },
  { key: 'opening_balances', title: msg('Account balances'), description: msg('The trial balance on the cut-over date: bank, cash, loans, VAT, capital… Customers, vendors and stock come from their own steps.'), perm: 'admin.write', icon: Scale,
    done: { label: msg('Open the trial balance'), href: '/finance/reports' },
    columns: [
      { key: 'account', label: msg('Account code'), required: true, hint: msg('as in the chart of accounts'), example: ['5121', '164'], aliases: ['konto', 'llogaria', 'kodi i llogarise', 'nr llogarise', 'account code'] },
      { key: 'debit', label: msg('Debit'), example: ['10000', ''], aliases: ['debi', 'debia', 'debiti', 'saldo debi'], num: true },
      { key: 'credit', label: msg('Credit'), example: ['', '4000'], aliases: ['kredi', 'kredia', 'krediti', 'saldo kredi'], num: true },
      { key: 'balance', label: msg('Balance'), hint: msg('instead of debit and credit: positive = debit'), example: ['', ''], aliases: ['saldo', 'gjendja', 'bilanci'], num: true },
    ] },
]

export function Importer({ kind, cutover, source }: { kind: Kind; cutover?: string; source?: string }) {
  const run = useAnyImport()
  const { company, isSuperAdmin } = useCompany()
  const templates = useImportTemplates(kind.key)
  const saveTemplate = useSaveImportTemplate()
  const deleteTemplate = useDeleteImportTemplate()
  const [templateOpen, setTemplateOpen] = React.useState(false)
  const [templateName, setTemplateName] = React.useState('')
  const [templateShared, setTemplateShared] = React.useState(false)
  const [file, setFile] = React.useState<{ name: string; data: ParsedFile } | null>(null)
  const [mapping, setMapping] = React.useState<Record<string, number | null>>({})
  const [check, setCheck] = React.useState<MigrationResult | null>(null)
  const [done, setDone] = React.useState<MigrationResult | null>(null)
  const [drag, setDrag] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const load = async (f: File) => {
    try {
      const data = await parseFile(f)
      if (!data.rows.length) return toast.error(t('The file has column names but no rows.'))
      if (data.rows.length > (isMigrationKind(kind.key) ? 20000 : 5000)) return toast.error(isMigrationKind(kind.key) ? t('Import at most 20,000 rows at a time; split the file.') : t('Import at most 5,000 rows at a time; split the file.'))
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
  const applyTemplate = (id: string) => {
    const tpl = templates.data?.find((x) => x.id === id)
    if (!tpl || !file) return
    const heads = file.data.headers.map(normalize)
    const m: Record<string, number | null> = { ...mapping }
    for (const c of kind.columns) {
      const h = tpl.mapping[c.key]
      if (h === undefined) continue
      const i = heads.indexOf(normalize(h))
      m[c.key] = i >= 0 ? i : null
    }
    setMapping(m); setCheck(null)
    toast.success(t('Columns matched with “{name}”', { name: tpl.name }))
  }
  const mappingByHeader = () => Object.fromEntries(kind.columns
    .filter((c) => mapping[c.key] != null)
    .map((c) => [c.key, file!.data.headers[mapping[c.key]!] ?? '']))
  const doSaveTemplate = async () => {
    if (!templateName.trim()) return
    await saveTemplate.mutateAsync({ kind: kind.key, name: templateName.trim(), source: source ?? '', mapping: mappingByHeader(), shared: templateShared })
    toast.success(t('Template “{name}” saved', { name: templateName.trim() }))
    setTemplateOpen(false)
  }

  const rows = React.useMemo(() => (file?.data.rows ?? []).map((r) => {
    const o: Record<string, string> = {}
    for (const c of kind.columns) {
      const i = mapping[c.key]
      const v = i === null || i === undefined ? '' : String(r[i] ?? '').trim()
      if (v !== '') o[c.key] = c.date ? excelDate(v) : c.num ? plainNumber(v) : v
    }
    return o
  }), [file, mapping, kind])
  const missing = kind.columns.filter((c) => c.required && (mapping[c.key] === null || mapping[c.key] === undefined))

  const template = () => exportCsv([0, 1], kind.columns.map((c) => ({ header: t(c.label), value: (i: number) => c.example[i] })), `import-${kind.key}-template`)
  const doCheck = async () => { setDone(null); setCheck(await run.mutateAsync({ kind: kind.key, rows, dryRun: true, cutover, file: file?.name })) }
  const doImport = async () => {
    const r = await run.mutateAsync({ kind: kind.key, rows, dryRun: false, cutover, file: file?.name })
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
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
              <div className="min-w-0 flex-1"><CardTitle>{t('2. Match the columns')}</CardTitle><CardDescription>{t('Columns were matched by name; change any that are wrong. Optional columns that are not in the file stay empty.')}</CardDescription></div>
              <div className="flex flex-wrap items-center gap-2">
                {(templates.data?.length ?? 0) > 0 && (
                  <Select onValueChange={applyTemplate}>
                    <SelectTrigger className="h-8 w-56" aria-label={t('Use a saved template')}><SelectValue placeholder={t('Use a saved template')} /></SelectTrigger>
                    <SelectContent>{templates.data!.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}{x.company_id ? '' : ` · ${t('shared')}`}</SelectItem>)}</SelectContent>
                  </Select>
                )}
                <Button variant="outline" size="sm" onClick={() => { setTemplateName(source ? `${source} · ${t(kind.title)}` : ''); setTemplateShared(false); setTemplateOpen(true) }}>
                  <Save /> {t('Save as template')}
                </Button>
              </div>
            </CardHeader>
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
              ? <p className="text-[13px]"><span className="font-medium text-destructive">{tn(check.errors.length, '{n} row needs fixing.', '{n} rows need fixing.')}</span> {ALL_OR_NOTHING.has(kind.key) ? t('These rows go in together, so fix them first.') : t('The other rows can be imported now.')}</p>
              : <p className="flex items-center gap-2 text-[13px] text-success"><CheckCircle2 className="size-4" />{t('All {n} rows are fine: {created} new, {updated} updates.', { n: formatQty(check.rows), created: check.created, updated: check.updated })}</p>)}
            {check && isMigrationKind(kind.key) && kind.key !== 'price_lists' && check.total != null && (
              <p className="rounded-md border bg-muted/40 p-2.5 text-[13px]">{t('Total in the file: {amount}. Compare it with the same report in the old program.', { amount: formatMoney(check.total, company?.base_currency) })}</p>
            )}
            <Button disabled={!check || (ALL_OR_NOTHING.has(kind.key) && check.errors.length > 0) || check.rows === check.errors.length || (isMigrationKind(kind.key) && !cutover)} loading={run.isPending && !run.variables?.dryRun}
              onClick={() => void doImport()}>
              {check ? tn(check.rows - check.errors.length, 'Import {n} row', 'Import {n} rows') : t('Import rows')}
            </Button>
            {done && (
              <div className="rounded-md border bg-muted/40 p-3 text-[13px]">
                <p className="font-medium">{done.errors.length ? t('Imported: {created} created, {updated} updated, {skipped} skipped.', { created: done.created, updated: done.updated, skipped: done.errors.length }) : t('Imported: {created} created, {updated} updated.', { created: done.created, updated: done.updated })}</p>
                <Link to={done.adjustment_id ? `/inventory/adjustments/${done.adjustment_id}` : done.journal_entry_id ? `/finance/journal/${done.journal_entry_id}` : kind.done.href} className="text-primary hover:underline">
                  {done.adjustment_id ? t('Open the opening stock adjustment') : done.journal_entry_id ? t('Open the journal entry') : t(kind.done.label)}
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
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('Save as template')}</DialogTitle>
            <DialogDescription>{t('Next time a file from the same program comes in, choose the template and the columns match by themselves.')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5"><label htmlFor="tpl-name" className="text-sm font-medium">{t('Template name')}</label>
              <Input id="tpl-name" autoFocus value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={t('e.g. Logmicro · products')} /></div>
            {isSuperAdmin && (
              <label className="flex items-start gap-2 text-[13px]"><Checkbox checked={templateShared} onCheckedChange={(v) => setTemplateShared(!!v)} className="mt-0.5" />
                <span>{t('Share with every client')}<span className="block text-xs text-muted-foreground">{t('Only the column names are saved, never the data.')}</span></span></label>
            )}
            {(templates.data ?? []).length > 0 && (
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground">{t('Saved templates')}</p>
                {templates.data!.map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="truncate">{x.name}{x.company_id ? '' : ` · ${t('shared')}`}</span>
                    {(x.company_id || isSuperAdmin) && <Button variant="ghost" size="icon-sm" aria-label={t('Delete {name}', { name: x.name })} onClick={() => void deleteTemplate.mutateAsync(x.id)}><Trash2 /></Button>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateOpen(false)}>{t('Cancel')}</Button>
            <Button onClick={() => void doSaveTemplate()} loading={saveTemplate.isPending} disabled={!templateName.trim()}>{t('Save template')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
