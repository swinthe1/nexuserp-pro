import type { L } from './types'

/** One lesson: a page to open; its ⓘ explanation and "Show me" are the lesson itself */
export type Lesson = { key: string; title: L; href: string; minutes: number; why: L }
/** A training path for a kind of work, with the roles it is meant for */
export type Track = { key: string; title: L; who: L; roles: string[]; lessons: Lesson[] }

export const TRACKS: Track[] = [
  {
    key: 'cashier',
    title: { sq: 'Arkëtari', en: 'Cashier' },
    who: { sq: 'Për ata që shesin në arkë.', en: 'For those who sell at the till.' },
    roles: ['pos_cashier', 'store_manager'],
    lessons: [
      { key: 'cashier.open', title: { sq: 'Hap arkën në fillim të ditës', en: 'Open the till in the morning' }, href: '/pos', minutes: 3,
        why: { sq: 'Paratë në sirtar në fillim janë baza për numërimin në fund të ditës.', en: 'The cash in the drawer at the start is the base for the count at the end.' } },
      { key: 'cashier.sell', title: { sq: 'Shit, merr paratë dhe printo kuponin', en: 'Sell, take the money, print the receipt' }, href: '/pos', minutes: 5,
        why: { sq: 'Ekrani i shitjes: skano, paguaj, përfundo. Hape arkën dhe kliko ⓘ pranë emrit të saj.', en: 'Open a till: scan, pay, finish. Open the till and click the ⓘ next to its name.' } },
      { key: 'cashier.return', title: { sq: 'Kthimi i mallit dhe hyrje/dalje parash', en: 'Returns and cash in/out' }, href: '/pos', minutes: 3,
        why: { sq: 'Te arka, menyja "Më shumë" ka kthimin dhe lëvizjet e parave; kurrë mos shit me minus.', en: 'At the till, "More" holds returns and cash movements; never sell a negative quantity.' } },
      { key: 'cashier.close', title: { sq: 'Mbyll turnin dhe raporti Z', en: 'Close the shift and the Z report' }, href: '/pos', minutes: 4,
        why: { sq: 'Numëro paratë sipas kartëmonedhave; diferenca regjistrohet dhe e sheh pronari.', en: 'Count the cash by note and coin; any difference is recorded and the owner sees it.' } },
      { key: 'cashier.loyalty', title: { sq: 'Kartat e klientëve dhe zbritjet', en: 'Customer cards and discounts' }, href: '/pos/loyalty', minutes: 3,
        why: { sq: 'Si përdoret karta e klientit dhe pse zbritjet e mëdha kërkojnë menaxherin.', en: 'How a customer card is used and why big discounts need the manager.' } },
    ],
  },
  {
    key: 'warehouse',
    title: { sq: 'Magazinieri', en: 'Warehouse' },
    who: { sq: 'Për ata që pranojnë, lëvizin dhe numërojnë mallin.', en: 'For those who receive, move and count the goods.' },
    roles: ['warehouse_operator', 'inventory_manager', 'store_manager'],
    lessons: [
      { key: 'warehouse.items', title: { sq: 'Artikujt dhe barkodet', en: 'Items and barcodes' }, href: '/inventory/products', minutes: 3,
        why: { sq: 'Çdo artikull me barkodin e vet: pa të, skanimi nuk e gjen.', en: 'Each item with its own barcode: without it the scan does not find it.' } },
      { key: 'warehouse.stock', title: { sq: 'Gjendja dhe kartela e artikullit', en: 'Stock and the item card' }, href: '/inventory/stock', minutes: 3,
        why: { sq: 'Sa ka, ku është, dhe çdo hyrje e dalje me datë.', en: 'How much there is, where, and every movement by date.' } },
      { key: 'warehouse.receive', title: { sq: 'Pranimi i mallit me faturë', en: 'Receiving goods with the invoice' }, href: '/procurement/invoice/new', minutes: 6,
        why: { sq: 'Hapi më i rëndësishëm: malli hyn në stok me koston e saktë dhe fatura regjistrohet.', en: 'The most important step: the goods enter stock at the right cost and the bill is recorded.' } },
      { key: 'warehouse.transfer', title: { sq: 'Transferi nga një njësi në tjetrën', en: 'Moving goods between units' }, href: '/inventory/transfers', minutes: 3,
        why: { sq: 'Nga depo në dyqan: stoku ndërron vend, vlera mbetet e njëjtë.', en: 'From the depot to the shop: the stock changes place, the value stays.' } },
      { key: 'warehouse.adjust', title: { sq: 'Dëmtimi, skadimi dhe korrigjimet', en: 'Damage, expiry and corrections' }, href: '/inventory/adjustments', minutes: 3,
        why: { sq: 'Arsyeja e saktë del te raporti i humbjeve.', en: 'The right reason shows in the shrinkage report.' } },
      { key: 'warehouse.count', title: { sq: 'Numërimi i stokut', en: 'Counting the stock' }, href: '/wms/counts', minutes: 6,
        why: { sq: 'Fleta e numërimit, Excel-i, vlera e diferencave dhe rinumërimi.', en: 'The count sheet, Excel, the value of differences and recounting.' } },
      { key: 'warehouse.shrinkage', title: { sq: 'Humbjet dhe firot', en: 'Shrinkage' }, href: '/inventory/shrinkage', minutes: 2,
        why: { sq: 'Ku humbet malli dhe sa kushton.', en: 'Where goods go missing and what it costs.' } },
    ],
  },
  {
    key: 'sales',
    title: { sq: 'Shitësi', en: 'Sales' },
    who: { sq: 'Për ata që ofertojnë, faturojnë dhe ndjekin klientët.', en: 'For those who quote, invoice and follow customers.' },
    roles: ['sales_rep', 'sales_manager'],
    lessons: [
      { key: 'sales.partners', title: { sq: 'Klientët: të dhënat dhe kushtet', en: 'Customers: details and terms' }, href: '/partners', minutes: 3,
        why: { sq: 'NUI-ja, afati i pagesës dhe kufiri i kredisë vendosen një herë dhe vlejnë në çdo faturë.', en: 'The NUI, payment terms and credit limit are set once and apply to every invoice.' } },
      { key: 'sales.quote', title: { sq: 'Oferta dhe porosia', en: 'Quote and order' }, href: '/sales/quotes', minutes: 4,
        why: { sq: 'Oferta bëhet porosi me një klikim; porosia e rezervon mallin.', en: 'A quote becomes an order in one click; the order reserves the goods.' } },
      { key: 'sales.invoice', title: { sq: 'Fatura e shitjes', en: 'The sales invoice' }, href: '/sales/invoices/new', minutes: 6,
        why: { sq: 'Klienti, rreshtat, afati, kontabilizimi; dhe pse gabimi korrigjohet me notë krediti.', en: 'Customer, lines, due date, posting; and why a mistake is corrected with a credit note.' } },
      { key: 'sales.delivery', title: { sq: 'Dërgesat', en: 'Deliveries' }, href: '/sales/deliveries', minutes: 3,
        why: { sq: 'Malli del nga stoku kur niset dërgesa.', en: 'The goods leave stock when the delivery goes.' } },
      { key: 'sales.debts', title: { sq: 'Borxhet dhe kujtesat', en: 'Debts and reminders' }, href: '/finance/receivables', minutes: 4,
        why: { sq: 'Kush vonohet dhe si i dërgon kujtesë me një klikim.', en: 'Who is late and how to send a reminder in one click.' } },
    ],
  },
  {
    key: 'accountant',
    title: { sq: 'Kontabilisti', en: 'Accountant' },
    who: { sq: 'Për ata që mbajnë paratë, bankën dhe librat.', en: 'For those who keep the money, the bank and the books.' },
    roles: ['accountant', 'finance_manager'],
    lessons: [
      { key: 'acc.payments', title: { sq: 'Pagesat dhe arkëtimet', en: 'Payments and receipts' }, href: '/finance/payments', minutes: 4,
        why: { sq: 'Çdo pagesë lidhet me faturën që mbyll, përndryshe fatura duket e papaguar.', en: 'Each payment is matched to the invoice it settles, or the invoice looks unpaid.' } },
      { key: 'acc.proposal', title: { sq: 'Propozimi i pagesave', en: 'The payment proposal' }, href: '/finance/payment-proposal', minutes: 4,
        why: { sq: 'Çka paguhet këtë javë, brenda parave që ke, me listën për bankën.', en: 'What to pay this week within the money you have, with the list for the bank.' } },
      { key: 'acc.bank', title: { sq: 'Banka: ekstrakti dhe diferencat', en: 'The bank: statements and differences' }, href: '/finance/bank', minutes: 5,
        why: { sq: 'Importo ekstraktin, lidh rreshtat, dhe "Pse?" të shpjegon diferencën.', en: 'Import the statement, match the lines, and "Why?" explains the difference.' } },
      { key: 'acc.cashbook', title: { sq: 'Libri i arkës', en: 'The cash book' }, href: '/finance/cash-book', minutes: 2,
        why: { sq: 'Çdo ditë, gjendja duhet të përputhet me paratë e numëruara.', en: 'Each day the balance must match the cash counted.' } },
      { key: 'acc.expenses', title: { sq: 'Shpenzimet nga fotoja', en: 'Expenses from a photo' }, href: '/finance/expenses', minutes: 3,
        why: { sq: 'Fotografo kuponin; kontrollo çka lexoi programi para se ta regjistrosh.', en: 'Photograph the receipt; check what the program read before booking it.' } },
      { key: 'acc.vat', title: { sq: 'Librat e TVSH-së dhe deklarata', en: 'VAT books and the return' }, href: '/tax/books', minutes: 5,
        why: { sq: 'Libri i shitjeve dhe blerjeve, pastaj deklarata e muajit.', en: 'The sales and purchase books, then the month\'s return.' } },
      { key: 'acc.reports', title: { sq: 'Pasqyrat financiare', en: 'Financial statements' }, href: '/finance/reports', minutes: 4,
        why: { sq: 'Fitimi, bilanci dhe rrjedha e parasë për çdo periudhë.', en: 'Profit, balance sheet and cash flow for any period.' } },
    ],
  },
  {
    key: 'owner',
    title: { sq: 'Pronari', en: 'Owner' },
    who: { sq: 'Për pronarin ose menaxherin: pasqyra, njerëzit, paratë.', en: 'For the owner or manager: the overview, the people, the money.' },
    roles: ['company_admin'],
    lessons: [
      { key: 'owner.dashboard', title: { sq: 'Paneli: çka po ndodh sot', en: 'The dashboard: what is happening today' }, href: '/', minutes: 2,
        why: { sq: 'Kartelat e panelit i zgjedh vetë me "Personalizo panelin".', en: 'Pick the dashboard cards yourself with "Customise the dashboard".' } },
      { key: 'owner.users', title: { sq: 'Përdoruesit dhe rolet', en: 'Users and roles' }, href: '/settings/users', minutes: 4,
        why: { sq: 'Kush hyn në program dhe çka lejohet të bëjë.', en: 'Who signs in and what they may do.' } },
      { key: 'owner.forecast', title: { sq: 'Parashikimi i parasë', en: 'The cash forecast' }, href: '/finance/cash-forecast', minutes: 4,
        why: { sq: 'Në cilën javë mund të të mungojnë paratë, që të veprosh me kohë.', en: 'In which week money may run short, so you act in time.' } },
      { key: 'owner.debts', title: { sq: 'Borxhet: kush të ka borxh', en: 'Debts: who owes you' }, href: '/finance/receivables', minutes: 3,
        why: { sq: 'Klientët me vonesë dhe kujtesat automatike.', en: 'Late customers and automatic reminders.' } },
      { key: 'owner.approvals', title: { sq: 'Miratimet', en: 'Approvals' }, href: '/approvals', minutes: 2,
        why: { sq: 'Zbritjet, rregullimet dhe pagesat e mëdha presin fjalën tënde.', en: 'Big discounts, adjustments and payments wait for your word.' } },
      { key: 'owner.automation', title: { sq: 'Automatizimet: kujtesat dhe përmbledhja', en: 'Automations: reminders and the summary' }, href: '/settings/automation', minutes: 4,
        why: { sq: 'Përmbledhja e mëngjesit, kujtesat për klientët dhe emaili i kompanisë.', en: 'The morning summary, customer reminders and the company email.' } },
    ],
  },
]

export const ALL_LESSONS = TRACKS.flatMap((tr) => tr.lessons)
/** the tracks for a person's roles; someone with no matching role sees them all */
export function tracksFor(roleKeys: string[]) {
  const mine = TRACKS.filter((tr) => tr.roles.some((r) => roleKeys.includes(r)))
  return mine.length ? mine : TRACKS
}
