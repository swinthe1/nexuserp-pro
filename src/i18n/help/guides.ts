import type { Guide } from './types'
import { GUIDES_A } from './guides-a'
import { GUIDES_B } from './guides-b'
import { GUIDES_C } from './guides-c'
import { GUIDES_D } from './guides-d'

/**
 * What every page is for, in plain words: opened with the small ⓘ next to the page title.
 * Keyed by the page's address; ":id" stands for one document. Tour targets are the English text of a
 * button, tab, heading or field label (shown translated), or a CSS selector.
 */
const BASE: Record<string, Guide> = {
  /* ------------------------------------------------------------------ the till */
  '/pos': {
    what: { sq: 'Këtu janë arkat e dyqanit: hap një arkë për të shitur, shiko turnet dhe raportet Z të ditës.', en: 'The shop\'s tills: open one to sell, and see the shifts and the day\'s Z reports.' },
    steps: [
      { sq: 'Kliko "Shko te arka" te arka ku punon.', en: 'Click "Go to the till" on the till you work at.' },
      { sq: 'Në fillim të ditës shkruaj sa para ka në sirtar dhe kliko "Hap arkën".', en: 'At the start of the day, type the cash in the drawer and click "Open the till".' },
      { sq: 'Në fund të ditës mbyll turnin: numëro paratë dhe printo raportin Z.', en: 'At the end of the day close the shift: count the cash and print the Z report.' },
    ],
    mistakes: [{ sq: 'Mos e lër arkën të hapur natën: shitjet e ditës tjetër përzihen me të sotmet.', en: 'Do not leave the till open overnight: tomorrow\'s sales get mixed with today\'s.' }],
    after: { sq: 'Çdo turn i mbyllur bëhet raport Z dhe regjistrim në kontabilitet; diferenca e parave del te sefi.', en: 'Each closed shift becomes a Z report and a book entry; any cash difference shows at the safe.' },
    related: [{ href: '/safe', label: { sq: 'Sefi', en: 'Safe' } }, { href: '/pos/loyalty', label: { sq: 'Kartat e zbritjes', en: 'Loyalty cards' } }],
  },
  '/pos/till/:registerId': {
    what: { sq: 'Ekrani i shitjes në arkë: skano mallin, merr paratë, printo kuponin.', en: 'The till screen: scan the goods, take the money, print the receipt.' },
    steps: [
      { sq: 'Skano barkodin ose kërko artikullin me emër; çdo skanim shton një copë.', en: 'Scan the barcode or search the item by name; each scan adds one piece.' },
      { sq: 'Për sasi ose zbritje kliko rreshtin dhe zgjidh "Sasia, zbritja…".', en: 'For a quantity or a discount, click the line and choose "Quantity, discount…".' },
      { sq: 'Kliko "Paguaj", zgjidh para në dorë ose kartë dhe shkruaj sa të dha klienti: kusuri del vetë.', en: 'Click "Pay", choose cash or card and type what the customer gave: the change is shown.' },
      { sq: 'Kliko "Përfundo shitjen"; kuponi printohet dhe fillon shitja tjetër.', en: 'Click "Finish the sale"; the receipt prints and the next sale starts.' },
    ],
    mistakes: [
      { sq: 'Kthimi i mallit bëhet me "Kthim" nga menyja "Më shumë", jo duke shitur me minus.', en: 'A return is done with "Return" in "More", not by selling a negative quantity.' },
      { sq: 'Zbritjet e mëdha kërkojnë menaxherin: thirre para se ta premtosh zbritjen.', en: 'Big discounts need the manager: call them before promising the discount.' },
    ],
    after: { sq: 'Malli zbret nga stoku menjëherë; paratë shkojnë te sirtari i arkës deri në mbylljen e turnit.', en: 'The goods leave stock at once; the money goes to the till drawer until the shift is closed.' },
    tour: [
      { target: 'input[type=search], [data-help=till-scan]', say: { sq: 'Këtu skanon ose shkruan emrin e artikullit.', en: 'Scan here, or type the item\'s name.' } },
      { target: 'More', say: { sq: 'Te "Më shumë" janë kthimi, hyrje/dalje parash dhe mbyllja e turnit.', en: '"More" holds returns, cash in/out and closing the shift.' } },
      { target: 'Pay', say: { sq: 'Kur mbaron, kliko "Paguaj" dhe zgjidh si paguan klienti.', en: 'When done, click "Pay" and choose how the customer pays.' } },
    ],
  },
  '/safe': {
    what: { sq: 'Sefi: paratë që nxirren nga arkat, dorëzohen në bankë ose merren nga pronari.', en: 'The safe: money taken from the tills, taken to the bank or by the owner.' },
    steps: [
      { sq: 'Kur mbyllet një turn, paratë e arkës kalojnë në sef.', en: 'When a shift closes, the till\'s cash moves to the safe.' },
      { sq: 'Për dorëzim në bankë ose marrje nga pronari regjistro lëvizjen me shumën dhe arsyen.', en: 'For a bank deposit or the owner taking money, record the movement with the amount and the reason.' },
      { sq: 'Numëro sefin rregullisht: diferenca regjistrohet dhe e sheh pronari.', en: 'Count the safe regularly: a difference is recorded and the owner sees it.' },
    ],
    after: { sq: 'Çdo lëvizje bëhet regjistrim në kontabilitet; paratë në rrugë për në bankë dalin te Banka dhe arka.', en: 'Each movement is a book entry; money on its way to the bank shows under Bank and cash.' },
  },

  /* ------------------------------------------------------------------ stock */
  '/inventory/products': {
    what: { sq: 'Lista e artikujve: çmimet, kostot dhe sa ka në stok.', en: 'The list of items: prices, costs and what is in stock.' },
    steps: [
      { sq: 'Kliko "Produkt i ri" për një artikull të ri; mjafton barkodi, emri dhe çmimi.', en: 'Click "New product" for a new item; the barcode, name and price are enough.' },
      { sq: 'Kliko një artikull për ta parë ose ndryshuar: çmimet, barkodet, paketimet, pika e riporositjes.', en: 'Click an item to see or change it: prices, barcodes, packs, reorder point.' },
      { sq: 'Me "Importo" sjell shumë artikuj njëherësh nga Excel-i.', en: 'With "Import" bring many items at once from Excel.' },
    ],
    mistakes: [{ sq: 'Mos krijo dy artikuj me të njëjtin barkod: skanimi do të gjejë vetëm njërin.', en: 'Do not create two items with the same barcode: a scan finds only one.' }],
    related: [{ href: '/inventory/stock', label: { sq: 'Gjendja', en: 'Stock on hand' } }, { href: '/inventory/levelling', label: { sq: 'Nivelimi i çmimeve', en: 'Price levelling' } }],
  },
  '/inventory/products/new': {
    what: { sq: 'Artikull i ri, me fushat më të nevojshme; të tjerat janë te "Më shumë".', en: 'A new item with the fields you need; the rest is under "More".' },
    steps: [
      { sq: 'Skano ose shkruaj barkodin, pastaj emrin.', en: 'Scan or type the barcode, then the name.' },
      { sq: 'Shkruaj çmimin e shitjes me TVSH; pa TVSH llogaritet vetë.', en: 'Type the selling price with VAT; without VAT is worked out.' },
      { sq: 'Nëse malli është tashmë në raft, shkruaj sasinë: hyn si gjendje fillestare.', en: 'If the goods are already on the shelf, type the quantity: it goes in as opening stock.' },
    ],
    mistakes: [{ sq: 'Kontrollo normën e TVSH-së (8% ose 18%): ajo del në kupon dhe në librin e shitjeve.', en: 'Check the VAT rate (8% or 18%): it goes on the receipt and in the sales book.' }],
  },
  '/inventory/stock': {
    what: { sq: 'Sa ka nga çdo artikull, në cilën njësi, dhe sa vlen.', en: 'How much of each item there is, in which unit, and what it is worth.' },
    steps: [
      { sq: 'Filtro sipas njësisë ose kategorisë.', en: 'Filter by unit or category.' },
      { sq: '"E rezervuar" është malli i premtuar në porosi; "e lirë" është ajo që mund të shitet.', en: '"Reserved" is promised on orders; "available" is what can still be sold.' },
      { sq: 'Kliko artikullin për kartelën: çdo hyrje dhe dalje me datë.', en: 'Click an item for its card: every movement in and out by date.' },
    ],
  },
  '/inventory/item-card': {
    what: { sq: 'Kartela e artikullit: çdo hyrje dhe dalje, me gjendjen pas secilës.', en: 'The item card: every movement in and out, with the stock after each.' },
    steps: [
      { sq: 'Zgjidh artikullin dhe periudhën.', en: 'Choose the item and the period.' },
      { sq: 'Kliko një rresht për dokumentin që e shkaktoi (faturë, pranim, shitje në arkë).', en: 'Click a line to open the document behind it (bill, receipt, till sale).' },
    ],
  },
  '/inventory/receipts/new': {
    what: { sq: 'Pranimi i mallit që vjen te njësia, me ose pa porosi blerjeje.', en: 'Goods arriving at a unit, with or without a purchase order.' },
    steps: [
      { sq: 'Zgjidh furnitorin dhe njësinë ku hyn malli.', en: 'Choose the vendor and the unit the goods go into.' },
      { sq: 'Shto rreshtat ose zgjidh porosinë që të mbushen vetë.', en: 'Add the lines, or choose the order to fill them in.' },
      { sq: 'Kontrollo sasitë me fletëdërgesën dhe përfundo pranimin.', en: 'Check the quantities against the delivery note and finish the receipt.' },
    ],
    mistakes: [{ sq: 'Nëse ke edhe faturën, përdor "Fatura e blerjes me mall": pranimi dhe fatura bëhen njëherësh.', en: 'If you also have the invoice, use "Purchase invoice with goods": receipt and bill in one go.' }],
    after: { sq: 'Malli hyn në stok me koston e rreshtit; transporti dhe dogana shtohen me "Shto koston e mbërritjes".', en: 'The goods enter stock at the line cost; freight and customs are added with "Add arrival costs".' },
  },
  '/inventory/transfers/new': {
    what: { sq: 'Kalimi i mallit nga një njësi në tjetrën (p.sh. nga depo në dyqan).', en: 'Moving goods from one unit to another (for example from the depot to the shop).' },
    steps: [
      { sq: 'Zgjidh nga ku dhe ku shkon malli.', en: 'Choose where the goods come from and where they go.' },
      { sq: 'Shto artikujt dhe sasitë.', en: 'Add the items and quantities.' },
      { sq: 'Nise; kur arrin, njësia tjetër e pranon.', en: 'Send it; when it arrives, the other unit receives it.' },
    ],
    after: { sq: 'Vlera e stokut nuk ndryshon: malli vetëm ndërron vend.', en: 'The stock value does not change: the goods only change place.' },
  },
  '/inventory/adjustments/new': {
    what: { sq: 'Korrigjimi i stokut për dëmtim, vjedhje, skadim ose gabim.', en: 'Correcting stock for damage, theft, expiry or a mistake.' },
    steps: [
      { sq: 'Zgjidh arsyen: kjo del te raporti i humbjeve.', en: 'Choose the reason: it shows in the shrinkage report.' },
      { sq: 'Shto artikujt me sasinë që hiqet (minus) ose shtohet (plus).', en: 'Add the items with the quantity removed (minus) or added (plus).' },
      { sq: 'Kontabilizoje; rregullimet e mëdha mund të kërkojnë miratim.', en: 'Post it; large adjustments may need approval.' },
    ],
    mistakes: [{ sq: 'Për numërimin e gjithë raftit përdor "Inventarizimi": ai i llogarit diferencat vetë.', en: 'To count a whole shelf use "Stock count": it works out the differences itself.' }],
  },
  '/wms/counts': {
    what: { sq: 'Numërimi i stokut (inventarizimi): numëron raftet dhe programi gjen diferencat.', en: 'Stock counting: count the shelves and the program finds the differences.' },
    steps: [
      { sq: 'Kliko "Numërim i ri", zgjidh njësinë dhe raftet ose kategorinë.', en: 'Click "New count", choose the unit and the shelves or a category.' },
      { sq: 'Numëro me skaner, me dorë, ose printo fletën dhe fute nga Excel-i.', en: 'Count with a scanner, by hand, or print the sheet and bring it in from Excel.' },
      { sq: 'Kliko "Përfundo numërimin", shiko vlerën e diferencave dhe konfirmo.', en: 'Click "Finish counting", see the value of the differences and confirm.' },
    ],
    mistakes: [{ sq: 'Numërimi "i verbër" nuk ia tregon punëtorit sa duhet të jetë: kështu numëron pa u ndikuar.', en: 'A "blind" count does not show the counter the expected quantity, so they count without bias.' }],
  },
  '/wms/counts/:id': {
    what: { sq: 'Një numërim: skano raftin, pastaj çdo artikull në të.', en: 'One count: scan the shelf, then every item on it.' },
    steps: [
      { sq: 'Skano etiketën e raftit (ose printo fletën e numërimit).', en: 'Scan the shelf label (or print the count sheet).' },
      { sq: 'Skano çdo artikull; çdo skanim shton një copë. Kliko rreshtin për ta shkruar sasinë me dorë.', en: 'Scan each item; each scan adds one. Click a line to type the quantity.' },
      { sq: 'Kur mbaron, "Përfundo numërimin" e dërgon për shqyrtim.', en: 'When done, "Finish counting" sends it for review.' },
      { sq: 'Te shqyrtimi shiko çka mungon dhe sa vlen; diferencat e mëdha ktheji për rinumërim.', en: 'In the review see what is missing and what it is worth; send big differences back to be counted again.' },
      { sq: '"Konfirmo diferencat" e korrigjon stokun.', en: '"Confirm differences" corrects the stock.' },
    ],
    after: { sq: 'Diferencat bëhen një rregullim stoku me arsye "Numërim" dhe dalin te Humbjet dhe firot.', en: 'The differences become one stock adjustment (reason: count) and show in Shrinkage.' },
    tour: [
      { target: 'Print the count sheet', say: { sq: 'Printo fletën nëse numëroni me letër.', en: 'Print the sheet if you count on paper.' } },
      { target: 'From Excel', say: { sq: 'Ose sill sasitë nga Excel-i.', en: 'Or bring the quantities from Excel.' } },
      { target: 'Finish counting', say: { sq: 'Kur mbaroni, dërgojeni për shqyrtim.', en: 'When you are done, send it for review.' } },
    ],
  },
  '/inventory/shrinkage': {
    what: { sq: 'Çka mungoi ose u gjet në stok gjatë një periudhe, me vlerën me kosto.', en: 'What went missing or turned up over a period, with its value at cost.' },
    steps: [
      { sq: 'Zgjidh periudhën.', en: 'Choose the period.' },
      { sq: 'Shiko sipas artikullit, arsyes, njësisë ose kategorisë: ku humbet më shumë.', en: 'Look by item, reason, unit or category: where most is lost.' },
    ],
    after: { sq: 'Artikujt që humbin shpesh kanë nevojë për më shumë kontroll (raft më afër arkës, kamerë, numërim më i shpeshtë).', en: 'Items that often go missing need more control (shelf near the till, camera, more frequent counts).' },
  },
  '/inventory/levelling': {
    what: { sq: 'Nivelimi i çmimeve: ndryshimi i çmimeve të shitjes si dokument, me datë.', en: 'Price levelling: changing selling prices as a dated document.' },
    steps: [
      { sq: 'Krijo një nivelim dhe shto artikujt me çmimin e ri.', en: 'Create a levelling and add the items with their new price.' },
      { sq: 'Kontabilizoje: çmimet e reja vlejnë nga ai moment, edhe në arkë.', en: 'Post it: the new prices apply from then on, at the till too.' },
      { sq: 'Printo etiketat e reja për raftet.', en: 'Print the new shelf labels.' },
    ],
  },

  /* ------------------------------------------------------------------ buying */
  '/procurement/invoice/new': {
    what: { sq: 'Fatura e blerjes me mall: malli hyn në stok dhe fatura regjistrohet njëherësh.', en: 'Purchase invoice with goods: the goods enter stock and the bill is recorded in one go.' },
    steps: [
      { sq: 'Zgjidh furnitorin dhe shkruaj numrin e faturës së tij.', en: 'Choose the vendor and type their invoice number.' },
      { sq: 'Skano ose kërko artikujt; shkruaj sasinë dhe çmimin pa TVSH si në faturë.', en: 'Scan or search the items; type the quantity and the price without VAT as on the invoice.' },
      { sq: 'Programi propozon çmimet e reja të shitjes sipas marzhës; prano ato që të duken mirë.', en: 'The program suggests new selling prices by margin; take the ones that look right.' },
      { sq: 'Nëse paguan në vend, zgjidh arkën ose bankën te "Pagesa". Kliko "Kompleto".', en: 'If you pay on the spot, choose the cash box or bank under "Payment". Click "Complete".' },
    ],
    mistakes: [
      { sq: 'Totali duhet të dalë si në letër: kontrollo TVSH-në dhe zbritjet para se ta kompletosh.', en: 'The total must match the paper: check the VAT and discounts before completing.' },
      { sq: 'Mos e regjistro dy herë të njëjtën faturë: programi paralajmëron kur numri përsëritet.', en: 'Do not record the same bill twice: the program warns when the number repeats.' },
    ],
    after: { sq: 'Malli hyn në stok, fatura shkon te "Kujt i kam borxh" dhe në librin e blerjeve.', en: 'The goods enter stock; the bill goes to payables and the purchase book.' },
    tour: [
      { target: 'Vendor', say: { sq: 'Fillo me furnitorin.', en: 'Start with the vendor.' } },
      { target: 'Invoice date', say: { sq: 'Data e faturës, si në letër.', en: 'The invoice date, as on the paper.' } },
      { target: 'Margin for all', say: { sq: 'Këtu cakton marzhën dhe programi i llogarit çmimet e shitjes.', en: 'Set a margin here and the program works out the selling prices.' } },
      { target: 'Complete', say: { sq: 'Në fund: malli hyn në stok dhe fatura regjistrohet.', en: 'At the end: the goods go into stock and the bill is recorded.' } },
    ],
  },
  '/procurement/bills': {
    what: { sq: 'Faturat e furnitorëve: me mall, pa mall (shërbime, shpenzime) dhe notat e kreditit.', en: 'Vendor bills: with goods, without goods (services, expenses) and credit notes.' },
    steps: [
      { sq: 'Për faturë me mall përdor "Fatura e blerjes me mall".', en: 'For a bill with goods use "Purchase invoice with goods".' },
      { sq: 'Për shërbim ose shpenzim (rrymë, qira) bëj faturë pa mall.', en: 'For a service or an expense (electricity, rent) make a bill without goods.' },
      { sq: 'Kliko një faturë për ta parë, paguar ose ndarë në këste.', en: 'Click a bill to see it, pay it or split it into instalments.' },
    ],
  },

  /* ------------------------------------------------------------------ selling */
  '/sales/invoices': {
    what: { sq: 'Faturat e shitjes dhe notat e kreditit.', en: 'Sales invoices and credit notes.' },
    steps: [
      { sq: 'Kliko "Faturë e re", zgjidh klientin dhe shto artikujt.', en: 'Click "New invoice", choose the customer and add the items.' },
      { sq: 'Filtro sipas statusit: "Papaguar" janë ato që duhen arkëtuar.', en: 'Filter by status: "Unpaid" are the ones still to collect.' },
      { sq: 'Për gabim në një faturë të kontabilizuar bëj "Notë krediti", jo fshirje.', en: 'For a mistake on a posted invoice make a "Credit note", not a deletion.' },
    ],
    related: [{ href: '/finance/receivables', label: { sq: 'Borxhet', en: 'Debts' } }, { href: '/sales/recurring', label: { sq: 'Faturat mujore', en: 'Recurring invoices' } }],
  },
  '/sales/invoices/:id': {
    what: { sq: 'Një faturë shitjeje: klienti, artikujt, afati i pagesës.', en: 'One sales invoice: the customer, the items, the due date.' },
    steps: [
      { sq: 'Zgjidh klientin: kushtet e pagesës dhe çmimet e tij plotësohen vetë.', en: 'Choose the customer: their payment terms and prices fill in by themselves.' },
      { sq: 'Shto rreshtat: skano barkodin ose kërko artikullin, shkruaj sasinë.', en: 'Add the lines: scan the barcode or search the item, type the quantity.' },
      { sq: 'Kontrollo totalin dhe kliko "Kontabilizo faturën".', en: 'Check the total and click "Post invoice".' },
      { sq: 'Printoje ose dërgoje me email; kur paguan klienti, "Regjistro arkëtimin".', en: 'Print it or email it; when the customer pays, "Record a receipt".' },
    ],
    mistakes: [
      { sq: 'Një faturë e kontabilizuar nuk ndryshohet më: për korrigjim bëj notë krediti.', en: 'A posted invoice cannot be changed: make a credit note to correct it.' },
      { sq: 'Nëse klienti paguan me pjesë, ndaje faturën në këste te kartela "Këstet".', en: 'If the customer pays in parts, split the invoice under "Instalments".' },
    ],
    after: { sq: 'Malli zbret nga stoku (nëse s\'ka dalë me dërgesë), fatura shkon te Borxhet, në librin e shitjeve dhe në kontabilitet.', en: 'The goods leave stock (unless delivered already); the invoice goes to Debts, the sales book and the books.' },
    tour: [
      { target: 'Customer', say: { sq: 'Fillo me klientin.', en: 'Start with the customer.' } },
      { target: 'Payment terms', say: { sq: 'Afati i pagesës vjen nga klienti; mund ta ndryshosh.', en: 'The payment terms come from the customer; you can change them.' } },
      { target: 'Lines', say: { sq: 'Këtu shton artikujt: skano ose kërko.', en: 'Add the items here: scan or search.' } },
      { target: 'Post invoice', say: { sq: 'Në fund kontabilizoje: pas kësaj nuk ndryshohet më.', en: 'At the end, post it: after that it can no longer change.' } },
    ],
  },
  '/sales/quotes': {
    what: { sq: 'Ofertat për klientët: çmime që i premton para porosisë.', en: 'Quotes for customers: prices you promise before the order.' },
    steps: [
      { sq: 'Bëj ofertën dhe dërgoja klientit.', en: 'Make the quote and send it to the customer.' },
      { sq: 'Kur pranon, kliko "Krijo porosinë": nuk e shkruan dy herë.', en: 'When they accept, click "Create the order": you do not type it twice.' },
    ],
  },
  '/sales/orders': {
    what: { sq: 'Porositë e klientëve: malli rezervohet, dërgohet dhe faturohet.', en: 'Customer orders: the goods are reserved, delivered and invoiced.' },
    steps: [
      { sq: 'Konfirmo porosinë: kontrollohet kredia e klientit dhe rezervohet malli.', en: 'Confirm the order: the customer\'s credit is checked and the goods are reserved.' },
      { sq: 'Krijo dërgesën kur malli niset.', en: 'Create the delivery when the goods leave.' },
      { sq: 'Krijo faturën nga porosia.', en: 'Create the invoice from the order.' },
    ],
  },
  '/partners': {
    what: { sq: 'Klientët dhe furnitorët: të dhënat, kushtet e pagesës, kartela dhe kujtesat.', en: 'Customers and vendors: details, payment terms, card and reminders.' },
    steps: [
      { sq: 'Shto partnerin me NUI-në: të dhënat nga ARBK plotësohen kur gjenden.', en: 'Add the partner with their NUI: the registry details fill in when found.' },
      { sq: 'Cakto kushtet e pagesës dhe kufirin e kredisë.', en: 'Set the payment terms and the credit limit.' },
      { sq: 'Te "Kartela" sheh çdo faturë dhe pagesë; te "Kujtesat" sheh kujtesat e dërguara.', en: 'Under "Card" see every invoice and payment; under "Reminders" the reminders sent.' },
    ],
  },

  /* ------------------------------------------------------------------ money */
  '/finance/payments': {
    what: { sq: 'Pagesat: paratë që hyjnë nga klientët dhe dalin te furnitorët.', en: 'Payments: money in from customers and out to vendors.' },
    steps: [
      { sq: '"Arkëto një pagesë" kur paguan klienti; "Paguaj një furnitor" kur paguan ti.', en: '"Receive a payment" when a customer pays; "Pay a vendor" when you pay.' },
      { sq: 'Zgjidh partnerin, bankën ose arkën dhe shumën.', en: 'Choose the partner, the bank or cash box and the amount.' },
      { sq: 'Lidhe pagesën me faturat që mbyll, pastaj kontabilizoje.', en: 'Match the payment to the invoices it settles, then post it.' },
    ],
    mistakes: [{ sq: 'Një pagesë pa e lidhur me faturë mbetet "e papërputhur" dhe fatura duket ende e papaguar.', en: 'A payment not matched to an invoice stays "unmatched" and the invoice still looks unpaid.' }],
    related: [{ href: '/finance/payment-proposal', label: { sq: 'Propozimi i pagesave', en: 'Payment proposal' } }],
  },
  '/finance/payments/:id': {
    what: { sq: 'Një pagesë: kush pagoi, sa, nga cila llogari, dhe cilat fatura mbyll.', en: 'One payment: who paid, how much, from which account, and which invoices it settles.' },
    steps: [
      { sq: 'Zgjidh partnerin: dalin faturat e tij të hapura.', en: 'Choose the partner: their open invoices appear.' },
      { sq: 'Shkruaj shumën dhe zgjidh bankën ose arkën.', en: 'Type the amount and choose the bank or cash box.' },
      { sq: 'Programi e ndan shumën mbi faturat më të vjetra; ndryshoje nëse klienti tha ndryshe.', en: 'The program spreads the amount over the oldest invoices; change it if the customer said otherwise.' },
      { sq: 'Kontabilizoje.', en: 'Post it.' },
    ],
    tour: [
      { target: 'Customer', say: { sq: 'Zgjidh klientin ose furnitorin.', en: 'Choose the customer or vendor.' } },
      { target: 'Method', say: { sq: 'Si u pagua: bankë ose para në dorë.', en: 'How it was paid: bank or cash.' } },
      { target: 'Post receipt', say: { sq: 'Në fund kontabilizoje.', en: 'At the end, post it.' } },
    ],
  },
  '/finance/receivables': {
    what: { sq: 'Borxhet: kush të ka borxh dhe sa kohë ka kaluar afati.', en: 'Debts: who owes you and how long it is overdue.' },
    steps: [
      { sq: 'Kolonat 1–30, 31–60… ditë tregojnë sa vonë janë pagesat.', en: 'The 1–30, 31–60… day columns show how late the payments are.' },
      { sq: 'Zilja 🔔 i dërgon klientit kujtesë menjëherë.', en: 'The bell 🔔 sends the customer a reminder now.' },
      { sq: '"Arkëto" hap pagesën për atë klient.', en: '"Collect" opens a payment for that customer.' },
    ],
    after: { sq: 'Te skeda "Kujt i kam borxh" sheh anën tjetër: çfarë u detyrohesh furnitorëve.', en: 'The "Payables" tab shows the other side: what you owe vendors.' },
  },
  '/finance/payables': {
    what: { sq: 'Kujt i ke borxh: faturat e furnitorëve të papaguara, sipas vonesës.', en: 'What you owe: unpaid vendor bills by how overdue they are.' },
    steps: [
      { sq: 'Fillo nga kolonat me vonesë: ato janë më urgjente.', en: 'Start with the overdue columns: they are the most urgent.' },
      { sq: '"Paguaj disa njëherësh" hap propozimin e pagesave.', en: '"Pay several at once" opens the payment proposal.' },
    ],
  },
  '/finance/payment-proposal': {
    what: { sq: 'Çfarë duhet paguar këtë javë: faturat e furnitorëve sipas urgjencës, brenda parave që ke.', en: 'What to pay this week: vendor bills by urgency, within the money you have.' },
    steps: [
      { sq: 'Zgjidh llogarinë nga paguan: programi shënon të vonuarat dhe ato me afat këtë javë, aq sa mjaftojnë paratë.', en: 'Choose the account you pay from: the program ticks the overdue and this week\'s, as far as the money goes.' },
      { sq: 'Ndrysho çka të duash: hiq ose shto fatura, ose paguaj vetëm një pjesë.', en: 'Change what you like: untick or tick bills, or pay only part.' },
      { sq: '"Lista për bankën" të jep IBAN-et dhe shumat për e-banking.', en: '"List for the bank" gives the IBANs and amounts for e-banking.' },
      { sq: 'Kliko "Paguaj": bëhet një pagesë për çdo furnitor.', en: 'Click "Pay": one payment per vendor is made.' },
    ],
  },
  '/finance/cash-forecast': {
    what: { sq: 'Parashikimi i parasë: sa para do të kesh çdo javë në 13 javët e ardhshme.', en: 'Cash forecast: how much money you will have each week for the next 13 weeks.' },
    steps: [
      { sq: 'Shiko paralajmërimin lart: nëse paraja bie nën zero, del java dhe shuma.', en: 'Look at the warning on top: if cash goes below zero, it names the week and the amount.' },
      { sq: 'Kliko një javë për çdo faturë që hyn ose del.', en: 'Click a week for every invoice coming in or going out.' },
      { sq: 'Shto "Zërat e tu": qira, kredi, tërheqje të pronarit, çka librat nuk e dinë.', en: 'Add "Your own items": rent, a loan, the owner\'s draw, what the books do not know.' },
    ],
    mistakes: [{ sq: '"Me vlerësime" shton faturat dhe blerjet që s\'janë bërë ende, sipas mesatares; fike për të parë vetëm ato të sigurtat.', en: '"With estimates" adds invoices and purchases not made yet, by the average; switch it off to see only the certain ones.' }],
  },
  '/finance/bank': {
    what: { sq: 'Banka dhe arka: gjendja e çdo llogarie dhe krahasimi me ekstraktin e bankës.', en: 'Bank and cash: each account\'s balance and the comparison with the bank statement.' },
    steps: [
      { sq: 'Importo ekstraktin nga e-banking (Excel, CSV ose XML).', en: 'Import the statement from e-banking (Excel, CSV or XML).' },
      { sq: 'Programi i lidh rreshtat me pagesat; ato që mbeten lidhi me dorë.', en: 'The program matches the lines to payments; match the rest by hand.' },
      { sq: '"Pse?" shpjegon diferencën mes librave dhe bankës.', en: '"Why?" explains the difference between the books and the bank.' },
    ],
    mistakes: [{ sq: 'Kontrollo që saldo fillestare e ekstraktit të jetë e saktë: përndryshe del diferencë "e pashpjeguar".', en: 'Check that the statement\'s opening balance is right, or an "unexplained" difference appears.' }],
  },
  '/finance/cash-book': {
    what: { sq: 'Libri i arkës: çdo hyrje dhe dalje e parave në dorë, ditë për ditë.', en: 'The cash book: every cash movement in and out, day by day.' },
    steps: [
      { sq: 'Zgjidh arkën dhe periudhën.', en: 'Choose the cash box and the period.' },
      { sq: 'Gjendja në fund të çdo dite duhet të përputhet me paratë e numëruara.', en: 'The balance at the end of each day should match the cash counted.' },
      { sq: 'Printoje kur ta kërkojë kontabilisti.', en: 'Print it when the accountant asks.' },
    ],
  },
  '/finance/expenses': {
    what: { sq: 'Shpenzimet: fotografo kuponin ose faturën dhe programi e lexon dhe e regjistron.', en: 'Expenses: photograph the receipt or bill and the program reads and books it.' },
    steps: [
      { sq: 'Bëj foto ose zgjidh skedarin, ose plotëso me dorë.', en: 'Take a photo or choose the file, or fill it in by hand.' },
      { sq: 'Kontrollo furnitorin, datën dhe TVSH-në që lexoi programi.', en: 'Check the vendor, date and VAT the program read.' },
      { sq: 'Zgjidh nga u pagua (arka ose banka) dhe regjistroje.', en: 'Choose what it was paid from (cash box or bank) and book it.' },
    ],
  },
  '/finance/cards': {
    what: { sq: 'Kartela e partnerit: çdo faturë, pagesë dhe kompensim me një klient ose furnitor, me saldon.', en: 'The partner card: every invoice, payment and compensation with a customer or vendor, with the balance.' },
    steps: [
      { sq: 'Zgjidh partnerin dhe periudhën.', en: 'Choose the partner and the period.' },
      { sq: 'Dërgoja klientit si konfirmim saldoje (IOS) për ta krahasuar me librat e tij.', en: 'Send it to the customer as a balance confirmation to compare with their books.' },
    ],
  },
  '/finance/compensations': {
    what: { sq: 'Kompensimi: kur një partner të ka borxh dhe ti i ke borxh atij, i mbyll të dyja pa lëvizur para.', en: 'Compensation: when a partner owes you and you owe them, settle both without moving money.' },
    steps: [
      { sq: 'Zgjidh partnerin: dalin faturat e hapura në të dyja anët.', en: 'Choose the partner: the open invoices on both sides appear.' },
      { sq: 'Zgjidh çka kompensohet (shumat duhet të jenë të barabarta) dhe kontabilizoje.', en: 'Choose what is offset (the amounts must be equal) and post it.' },
    ],
  },

  /* ------------------------------------------------------------------ detail pages that had none */
  '/partners/:id': {
    what: { sq: 'Kartela e një klienti ose furnitori: të dhënat, kushtet e pagesës, kontaktet, çmimet e veçanta dhe gjithë dokumentet me të.', en: 'The card of one customer or vendor: details, payment terms, contacts, special prices and every document with them.' },
    steps: [
      { sq: 'Për biznes, shkruaj NUI-në ose emrin dhe kliko "Gjeje në regjistrin e bizneseve (ARBK)": emri, adresa dhe NIPT-i plotësohen vetë.', en: 'For a business, type the NUI or name and click "Find it in the business register (ARBK)": name, address and tax number fill in by themselves.' },
      { sq: 'Te "Detajet", pjesa "Kushtet e shitjes": kushtet e pagesës, lista e çmimeve dhe "Limiti i kreditit (me TVSH)".', en: 'Under "Details", the "Sales terms" part: payment terms, price list and "Credit limit (with VAT)".' },
      { sq: 'Te "Kontaktet dhe adresat" shto personat dhe adresat e dërgesës.', en: 'Under "Contacts and addresses" add people and delivery addresses.' },
      { sq: 'Te "Çmime të veçanta" jep një çmim fiks ose zbritje vetëm për këtë klient.', en: 'Under "Special prices" give a fixed price or discount just for this customer.' },
      { sq: 'Te "Kujtesat" shikon çfarë kujtesash i kanë shkuar dhe mund t\'i dërgosh një tani.', en: 'Under "Reminders" see which reminders were sent and send one now.' },
    ],
    mistakes: [
      { sq: 'Pa NIPT/NUI nuk del dot faturë fiskale për biznes.', en: 'Without a tax number you cannot issue a fiscal invoice to a business.' },
      { sq: 'Ndryshimi i kushteve të pagesës vlen për dokumentet e reja; të vjetrat mbajnë të tyret.', en: 'Changing the payment terms applies to new documents; old ones keep theirs.' },
    ],
    after: { sq: 'Kushtet dhe çmimet e kartelës plotësohen vetë në çdo ofertë, porosi dhe faturë të re për këtë partner.', en: 'The card\'s terms and prices fill in by themselves on every new quote, order and invoice for this partner.' },
    related: [{ href: '/finance/receivables', label: { sq: 'Borxhet', en: 'Debts' } }, { href: '/sales/price-lists', label: { sq: 'Listat e çmimeve', en: 'Price lists' } }],
    tour: [
      { target: 'Details', say: { sq: 'Te "Detajet": NIPT-i, adresa, kushtet e pagesës, lista e çmimeve dhe limiti i kreditit.', en: 'Under "Details": tax number, address, payment terms, price list and credit limit.' } },
      { target: 'Contacts and addresses', say: { sq: 'Personat dhe adresat e dërgesës.', en: 'People and delivery addresses.' } },
      { target: 'Special prices', say: { sq: 'Çmimet që vlejnë vetëm për këtë partner.', en: 'Prices that apply only to this partner.' } },
      { target: 'Reminders', say: { sq: 'Kujtesat për pagesë që i kanë shkuar dhe butoni për të dërguar një tani.', en: 'Payment reminders sent and the button to send one now.' } },
    ],
  },
  '/procurement/bills/:id': {
    what: { sq: 'Një faturë furnitori: e regjistron siç është shtypur, e kontrollon me porosinë dhe pranimin, pastaj e kontabilizon dhe e paguan.', en: 'One vendor bill: enter it as printed, check it against the order and receipt, then post and pay it.' },
    steps: [
      { sq: 'Zgjidh furnitorin dhe shkruaj numrin e faturës "Siç është shtypur në faturën e tyre", datën dhe afatin.', en: 'Choose the vendor and type the bill number "As printed on their invoice", the date and due date.' },
      { sq: 'Shto rreshtat me sasi dhe çmim pa TVSH; totalet llogariten vetë.', en: 'Add lines with quantity and price without VAT; totals work themselves out.' },
      { sq: 'Nëse vjen nga një porosi, programi e krahason: sasitë dhe çmimet që nuk përputhen dalin të shënuara.', en: 'If it comes from an order, the program compares them: quantities and prices that do not match are flagged.' },
      { sq: 'Kliko "Kontabilizo faturën". Pastaj "Paguaj këtë faturë" ose ndaje në këste.', en: 'Click "Post bill". Then "Pay this bill" or split it into instalments.' },
    ],
    mistakes: [
      { sq: 'Fatura me mall që nuk ka kaluar nga pranimi bëhet më mirë te "Fatura e blerjes me mall", që të hyjë malli në stok.', en: 'A bill with goods that did not go through a receipt is better done in "Purchase invoice with goods", so the stock comes in.' },
      { sq: '"Kontabilizo gjithsesi…" kërkon arsye dhe mbetet e shënuar; përdore vetëm kur diferenca është e kuptuar.', en: '"Post anyway…" asks for a reason and stays recorded; use it only when the difference is understood.' },
      { sq: 'Fatura e kontabilizuar nuk fshihet; korrigjohet me notë krediti.', en: 'A posted bill is not deleted; it is corrected with a credit note.' },
    ],
    after: { sq: 'Detyrimi ndaj furnitorit hyn në Borxhe, TVSH-ja e zbritshme në librin e blerjeve dhe fatura del te Propozimi i pagesave sipas afatit.', en: 'What you owe goes into Debts, the deductible VAT into the purchase book, and the bill shows in the Payment proposal by its due date.' },
    related: [{ href: '/finance/payment-proposal', label: { sq: 'Propozimi i pagesave', en: 'Payment proposal' } }, { href: '/procurement/invoice/new', label: { sq: 'Fatura me mall', en: 'Invoice with goods' } }],
    tour: [
      { target: 'Vendor', say: { sq: 'Fillo me furnitorin: kushtet e pagesës vijnë nga kartela e tij.', en: 'Start with the vendor: payment terms come from their card.' } },
      { target: 'Due date', say: { sq: 'Afati i pagesës. Pas tij fatura del si e vonuar.', en: 'The due date. After it the bill shows as overdue.' } },
      { target: 'Post bill', say: { sq: 'Kur gjithçka është në rregull, kontabilizoje.', en: 'When everything is right, post it.' } },
    ],
  },
  '/procurement/requisitions/:id': {
    what: { sq: 'Një kërkesë për blerje: punëtori shkruan çfarë i duhet, menaxheri e miraton dhe blerjet e kthejnë në porosi te furnitorët.', en: 'One purchase requisition: a worker writes what is needed, a manager approves it and purchasing turns it into orders to vendors.' },
    steps: [
      { sq: 'Shto artikujt: produkt nga katalogu ose përshkrim i lirë, sasia dhe kostoja e përafërt pa TVSH.', en: 'Add items: a catalogue product or a free description, the quantity and an estimated cost without VAT.' },
      { sq: 'Vendos "Duhet deri më", depon dhe arsyen.', en: 'Set "Needed by", the warehouse and the reason.' },
      { sq: 'Kliko "Dërgo për miratim". Miratuesi e sheh te "Për miratim".', en: 'Click "Submit for approval". The approver sees it under "Approvals".' },
      { sq: 'Pas miratimit, blerjet klikojnë "Krijo porosi blerjeje": një porosi për çdo furnitor të sugjeruar.', en: 'Once approved, purchasing clicks "Create purchase orders": one order per suggested vendor.' },
    ],
    mistakes: [
      { sq: 'Shiko sasinë "në stok" dhe "tashmë në porosi" para se ta kërkosh, që të mos blihet dy herë.', en: 'Check the "on hand" and "already on order" quantities before asking, so it is not bought twice.' },
    ],
    after: { sq: 'Porositë e krijuara lidhen me kërkesën; kur malli vjen, pranohet nga porosia.', en: 'The orders created are linked to the requisition; when the goods arrive they are received from the order.' },
    related: [{ href: '/approvals', label: { sq: 'Për miratim', en: 'Approvals' } }, { href: '/procurement/orders', label: { sq: 'Porositë e blerjes', en: 'Purchase orders' } }],
  },
  '/manufacturing/boms/:id': {
    what: { sq: 'Receta e një produkti: nga çfarë përbërësish bëhet, me sa firo dhe me cilët hapa pune. Prej saj del kostoja për njësi.', en: 'A product\'s recipe: which components it is made of, with how much waste and which work steps. Its cost per unit comes from it.' },
    steps: [
      { sq: 'Zgjidh produktin që bëhet dhe "Sasia e serisë": sa njësi del nga një seri.', en: 'Choose the product made and the "Batch quantity": how many units one batch makes.' },
      { sq: 'Kliko "Shto përbërës" për çdo lëndë, me sasinë për seri dhe "Firo %".', en: 'Click "Add component" for each material, with the quantity per batch and "Waste %".' },
      { sq: 'Kliko "Shto hap" për punën: qendra e punës dhe minutat për njësi. Puna dhe shpenzimet e përgjithshme llogariten nga qendra.', en: 'Click "Add step" for the work: the work center and minutes per unit. Labour and overhead come from the center.' },
      { sq: 'Kliko "Ruaj recetën" dhe shiko "Ndarja e kostos (pa TVSH)".', en: 'Click "Save recipe" and look at the "Cost breakdown (without VAT)".' },
    ],
    mistakes: [
      { sq: 'Si "Set" përbërësit dalin nga stoku kur shitet produkti; si recetë prodhimi dalin vetëm me urdhër pune.', en: 'As a "Kit" the parts leave stock when the product is sold; as a production recipe they leave only with a work order.' },
      { sq: 'Pa qendër pune nuk shtohen dot hapa; krijoje te Qendrat e punës.', en: 'Without a work center you cannot add steps; create one under Work centers.' },
    ],
    after: { sq: 'Urdhrat e punës për këtë produkt marrin përbërësit dhe hapat nga kjo recetë.', en: 'Work orders for this product take the components and steps from this recipe.' },
    related: [{ href: '/manufacturing/orders', label: { sq: 'Urdhrat e punës', en: 'Work orders' } }, { href: '/manufacturing/work-centers', label: { sq: 'Qendrat e punës', en: 'Work centers' } }],
    tour: [
      { target: 'Components and steps', say: { sq: 'Këtu ndryshon përbërësit dhe hapat e recetës.', en: 'Here you change the recipe\'s components and steps.' } },
      { target: 'Add component', say: { sq: 'Shto çdo lëndë që hyn në produkt.', en: 'Add every material that goes into the product.' } },
      { target: 'Add step', say: { sq: 'Hapat e punës me minutat për njësi.', en: 'Work steps with minutes per unit.' } },
      { target: 'Save recipe', say: { sq: 'Ruaje dhe shiko koston për njësi.', en: 'Save it and see the cost per unit.' } },
      { target: 'Cost', say: { sq: 'Kostoja për njësi: lëndët, puna dhe shpenzimet e përgjithshme.', en: 'The cost per unit: materials, labour and overhead.' } },
      { target: 'Where used', say: { sq: 'Në cilat receta të tjera hyn ky produkt.', en: 'Which other recipes use this product.' } },
    ],
  },
  '/inventory/landed-costs/:id': {
    what: { sq: 'Kostot e importit (transport, doganë, spedicion) që shtohen te vlera e mallit të pranuar, që kostoja e çdo artikulli të jetë e vërtetë.', en: 'Import costs (freight, customs, forwarding) added to the value of goods received, so each item\'s cost is the real one.' },
    steps: [
      { sq: 'Zgjidh "Pranimet ku zbatohet kjo kosto".', en: 'Choose the "Receipts this cost applies to".' },
      { sq: 'Kliko "Shto kosto" për çdo shpenzim: transport, taksa doganore, spedicion, me shumën pa TVSH.', en: 'Click "Add charge" for each cost: freight, customs duty, forwarding, with the amount without VAT.' },
      { sq: 'Për doganën plotëso deklaratën doganore (numri DUD) dhe TVSH-në e importit të paguar.', en: 'For customs fill in the customs declaration (DUD number) and the import VAT paid.' },
      { sq: 'Zgjidh "Shpërnda sipas" (vlerë, sasi, peshë…) dhe kliko "Shpërnda dhe regjistro".', en: 'Choose "Split by" (value, quantity, weight…) and click "Spread and record".' },
    ],
    mistakes: [
      { sq: 'TVSH e importit nuk hyn në koston e mallit: ajo zbritet si TVSH hyrëse.', en: 'Import VAT does not go into the goods\' cost: it is deducted as input VAT.' },
      { sq: 'Pjesa që i takon mallit të shitur tashmë shkon në kosto të mallit të shitur, jo në stok.', en: 'The share for goods already sold goes to cost of goods sold, not to stock.' },
    ],
    after: { sq: 'Kostoja shtohet te shtresat FIFO të vetë atij pranimi, ndaj marzhat e shitjeve të ardhshme dalin të sakta.', en: 'The cost is added to the FIFO layers of that very receipt, so margins on future sales come out right.' },
    related: [{ href: '/inventory/receipts', label: { sq: 'Pranimet', en: 'Receipts' } }],
    tour: [
      { target: 'Receipts this cost applies to', say: { sq: 'Fillimisht zgjidh pranimet e mallit.', en: 'First choose the goods receipts.' } },
      { target: 'Add charge', say: { sq: 'Shto çdo shpenzim importi.', en: 'Add each import cost.' } },
      { target: 'Spread and record', say: { sq: 'Shpërndaje në artikuj dhe regjistroje.', en: 'Spread it over the items and record it.' } },
    ],
  },

  '/inventory/products/:id': {
    what: { sq: 'Kartela e një produkti: çmimi, TVSH-ja, sa ka në çdo depo, varianti dhe barkodet, ambalazhet dhe kur duhet riporositur.', en: 'One product\'s card: price, VAT, how much is in each warehouse, variants and barcodes, packaging and when to reorder.' },
    steps: [
      { sq: 'Kliko "Ndrysho" për emrin, kategorinë, çmimin e shitjes dhe TVSH-në.', en: 'Click "Edit" for the name, category, selling price and VAT.' },
      { sq: 'Te "Stoku" shikon sa ka në çdo depo, raft dhe lot, me koston mesatare.', en: 'Under "Stock" see how much is in each warehouse, bin and lot, with the average cost.' },
      { sq: 'Te "Variantet dhe barkodet" shto barkodin e prodhuesit ose "Krijo kod të brendshëm" për mallin pa barkod.', en: 'Under "Variants & barcodes" add the maker\'s barcode or "Generate in-store code" for goods without one.' },
      { sq: 'Te "Pikat e riporositjes" vendos kur bie poshtë sasia dhe deri sa të porositet; Rimbushja i propozon vetë.', en: 'Under "Reorder points" set when the quantity is too low and how much to order up to; Replenishment suggests them.' },
      { sq: 'Te "Kartela e artikullit" sheh çdo hyrje dhe dalje me dokumentin e saj.', en: 'Under "Item card" see every in and out with its document.' },
    ],
    mistakes: [
      { sq: 'Njësia, lloji dhe gjurmimi me lot nuk ndryshohen pasi produkti ka lëvizje; krijo produkt të ri nëse duhet.', en: 'Unit, type and lot tracking cannot change once the product has movements; make a new product if needed.' },
    ],
    after: { sq: 'Ndryshimi i çmimit ruhet te "Historiku i çmimit" dhe vlen menjëherë në arkë dhe në dokumentet e reja.', en: 'A price change is kept in "Price history" and applies at once at the till and on new documents.' },
    related: [{ href: '/inventory/labels', label: { sq: 'Etiketat', en: 'Labels' } }, { href: '/procurement/replenishment', label: { sq: 'Rimbushja', en: 'Replenishment' } }],
    tour: [
      { target: 'Stock', say: { sq: 'Sa ka në çdo depo, raft dhe lot.', en: 'How much is in each warehouse, bin and lot.' } },
      { target: 'Variants & barcodes', say: { sq: 'Barkodet që lexon arka dhe skaneri.', en: 'The barcodes the till and scanner read.' } },
      { target: 'Reorder points', say: { sq: 'Kur bie sasia, programi të kujton ta porositësh.', en: 'When the quantity drops, the program reminds you to order.' } },
      { target: 'Item card', say: { sq: 'Çdo lëvizje e këtij artikulli, me dokumentin.', en: 'Every movement of this item, with its document.' } },
    ],
  },
  '/sales/deliveries/:id': {
    what: { sq: 'Një dërgesë te klienti: çfarë merret nga depo dhe kur del malli. Kur përfundon, stoku zbret dhe kostoja e mallit kontabilizohet.', en: 'One delivery to a customer: what is taken from the warehouse and when the goods leave. When completed, stock goes down and the cost of goods is booked.' },
    steps: [
      { sq: 'Kontrollo "Merret nga" (depo), datën dhe rreshtat me sasi; për mall me lot zgjidh lotin.', en: 'Check "Pick from" (the warehouse), the date and the lines with quantities; for lot goods choose the lot.' },
      { sq: 'Shkruaj shënimet për shoferin dhe numrin e gjurmimit nëse e dërgon me korrier.', en: 'Write notes for the driver and the tracking number if a courier takes it.' },
      { sq: 'Kliko "Përfundo dërgesën" kur malli largohet.', en: 'Click "Complete delivery" when the goods leave.' },
    ],
    mistakes: [
      { sq: 'Mos e përfundo para se malli të dalë realisht: stoku zbret menjëherë.', en: 'Do not complete it before the goods really leave: stock goes down at once.' },
    ],
    after: { sq: 'Nga porosia mund të bësh faturën për sasinë e dërguar; dërgesa e përfunduar nuk fshihet.', en: 'From the order you can invoice the quantity delivered; a completed delivery is not deleted.' },
    related: [{ href: '/sales/deliveries', label: { sq: 'Dërgesat', en: 'Deliveries' } }],
    tour: [
      { target: 'Pick from', say: { sq: 'Nga cila depo del malli.', en: 'Which warehouse the goods leave from.' } },
      { target: 'Complete delivery', say: { sq: 'Kur malli largohet, përfundoje këtu.', en: 'When the goods leave, complete it here.' } },
    ],
  },
  '/finance/accounts/:id': {
    what: { sq: 'Kartela e një llogarie kontabël: gjendja fillestare, çdo veprim debi dhe kredi me dokumentin e tij, dhe gjendja në fund.', en: 'One ledger account\'s card: the opening balance, every debit and credit with its document, and the closing balance.' },
    steps: [
      { sq: 'Zgjidh periudhën me "Nga" dhe "Deri".', en: 'Choose the period with "From" and "To".' },
      { sq: 'Kliko një rresht për të hapur regjistrimin ose dokumentin që e krijoi.', en: 'Click a line to open the entry or the document that made it.' },
      { sq: 'Me "Ndrysho" ndryshon emrin, grupin dhe seksionin e fluksit të parasë.', en: 'With "Edit" change the name, group and cash flow section.' },
    ],
    mistakes: [
      { sq: 'Kodi i llogarisë me lëvizje nuk ndryshohet; regjistrimet gabim korrigjohen me regjistrim të ri.', en: 'An account with movements keeps its code; wrong entries are fixed with a new entry.' },
    ],
    related: [{ href: '/finance/accounts', label: { sq: 'Plani kontabël', en: 'Chart of accounts' } }, { href: '/finance/account-card', label: { sq: 'Kartela e llogarisë', en: 'Account card' } }],
  },
  '/pos/sessions/:id': {
    what: { sq: 'Një ndërrim arke: kush e hapi, sa para kishte në fillim, çdo kupon, pagesat sipas mënyrës, diferenca e parave dhe raporti Z.', en: 'One till shift: who opened it, the opening cash, every receipt, payments by method, the cash difference and the Z-report.' },
    steps: [
      { sq: 'Shiko "Diferenca e parave": sa u numërua kundrejt sa pritej në sirtar.', en: 'Look at "Cash difference": what was counted against what was expected in the drawer.' },
      { sq: 'Te "Kupona" hap një kupon për ta printuar përsëri ose për të bërë kthim.', en: 'Under "Receipts" open one to reprint it or make a refund.' },
      { sq: 'Te raporti Z kliko "Printo raportin Z" për letrën e mbylljes.', en: 'On the Z-report click "Print Z-report" for the closing slip.' },
      { sq: 'Te "Kontabiliteti" sheh si u regjistrua ndërrimi në libra.', en: 'Under "Accounting" see how the shift was booked.' },
    ],
    mistakes: [
      { sq: 'Diferenca e madhe e parave duhet sqaruar me arkëtarin të njëjtën ditë.', en: 'A large cash difference should be cleared up with the cashier the same day.' },
    ],
    after: { sq: 'Shitjet e ndërrimit hyjnë në librin e shitjeve dhe paratë kalojnë në arkë ose në kasafortë.', en: 'The shift\'s sales go into the sales book and the cash moves into the cash box or safe.' },
    related: [{ href: '/finance/z-reports', label: { sq: 'Z-raportet', en: 'Z reports' } }],
    tour: [
      { target: 'Receipts', say: { sq: 'Çdo kupon i ndërrimit.', en: 'Every receipt of the shift.' } },
      { target: 'Accounting', say: { sq: 'Si u regjistrua në libra.', en: 'How it was booked.' } },
    ],
  },
  '/training': {
    what: { sq: 'Mësime të shkurtra sipas rolit tënd. Çdo mësim hap faqen e vërtetë, e shpjegon hap pas hapi dhe të tregon ku të klikosh.', en: 'Short lessons for your role. Each one opens the real page, explains it step by step and shows you where to click.' },
    steps: [
      { sq: 'Kliko "Fillo" te mësimi i parë. Faqja hapet me shpjegimin anash.', en: 'Click "Start" on the first lesson. The page opens with the explanation beside it.' },
      { sq: 'Lexoje, provoje dhe kliko "Mësimi u krye".', en: 'Read it, try it and click "Lesson done".' },
      { sq: 'Pronari sheh te Përdoruesit sa mësime ka kryer secili.', en: 'The owner sees under Users how many lessons each person finished.' },
    ],
    after: { sq: 'Te çdo faqe, ⓘ pranë titullit e hap të njëjtin shpjegim kur të duhet përsëri.', en: 'On every page, the ⓘ next to the title opens the same explanation whenever you need it again.' },
  },
}

export const GUIDES: Record<string, Guide> = { ...GUIDES_A, ...GUIDES_B, ...GUIDES_C, ...GUIDES_D, ...BASE }
