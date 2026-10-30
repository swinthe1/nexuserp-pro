import type { Guide } from './types'

/**
 * What every page is for, in plain words: opened with the small ⓘ next to the page title.
 * Keyed by the page's address; ":id" stands for one document. Tour targets are the English text of a
 * button, tab, heading or field label (shown translated), or a CSS selector.
 */
export const GUIDES: Record<string, Guide> = {
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
}
