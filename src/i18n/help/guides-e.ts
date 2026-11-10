import type { Guide } from './types'

/** Pages added or changed since the first guides: the restaurant floor and kitchen, statements, pending invoices… */
export const GUIDES_E: Record<string, Guide> = {
  '/finance/bank/statements/:id': {
    what: { sq: 'Një ekstrakt bankar: çdo rresht duhet të lidhet me një pagesë, të regjistrohet në një llogari ose të shpërfillet. Kur s\'mbetet asgjë, ekstrakti mbyllet.', en: 'One bank statement: each line must be matched to a payment, recorded to an account or ignored. When nothing is left, the statement is closed.' },
    steps: [
      { sq: 'Shiko "Hapja + rreshtat": duhet të jetë sa saldo përfundimtare e bankës. Nëse jo, ekstrakti nuk është i plotë.', en: 'Look at "Opening + lines": it must equal the bank\'s closing balance. If not, the statement is incomplete.' },
      { sq: 'Kliko "Mbyll ekstraktin": programi lidh çka mundet. Nëse mbeten rreshta, të tregon cilët ("Për t\'u bërë").', en: 'Click "Finish statement": the program matches what it can. If lines are left, it shows you which ("To do").' },
      { sq: 'Për rreshtat me propozim ("Për kontroll"), shiko propozimin dhe kliko "Prano" ose "Jo kjo"; "Prano të gjitha" i pranon njëherësh.', en: 'For lines with a suggestion ("To check"), look at it and click "Accept" or "Not this"; "Accept all" accepts them at once.' },
      { sq: 'Për çdo rresht tjetër kliko "Përputh" dhe zgjidh pagesën. Te butoni ⋯ i rreshtit: regjistro një arkëtim/pagesë të re, "Regjistro në llogari" (p.sh. komision banke) ose "Shpërfill".', en: 'For any other line click "Match" and choose the payment. Under the line\'s ⋯ button: record a new receipt/payment, "Record to account" (e.g. a bank fee) or "Ignore".' },
      { sq: 'Kur s\'mbetet asnjë rresht, kliko përsëri "Mbyll ekstraktin": ekstrakti rakordohet.', en: 'When no line is left, click "Finish statement" again: the statement is reconciled.' },
    ],
    mistakes: [
      { sq: 'Mos e prano një propozim pa e parë: shuma dhe klienti duhet të jenë ata të duhurit.', en: 'Do not accept a suggestion without looking: the amount and the customer must be the right ones.' },
      { sq: '"Shpërfill" vetëm për rreshta që nuk janë veprime të vërteta (p.sh. të dyfishuar në skedar).', en: '"Ignore" only lines that are not real transactions (e.g. doubled in the file).' },
    ],
    after: { sq: 'Ekstrakti i rakorduar nuk ndryshon më; gjendja e bankës në libra përputhet me bankën.', en: 'A reconciled statement no longer changes; the bank balance in the books matches the bank.' },
    related: [{ href: '/finance/bank', label: { sq: 'Banka dhe arka', en: 'Bank and cash' } }, { href: '/finance/payments', label: { sq: 'Pagesat', en: 'Payments' } }],
    tour: [
      { target: 'Finish statement', say: { sq: 'Një buton: lidh çka mundet dhe e mbyll kur s\'mbetet asgjë.', en: 'One button: matches what it can and closes when nothing is left.' } },
      { target: 'To check', say: { sq: 'Propozimet që presin shikimin tënd.', en: 'The suggestions waiting for your look.' } },
      { target: 'Match', say: { sq: 'Lidhe rreshtin me pagesën me dorë.', en: 'Match the line to the payment by hand.' } },
    ],
  },
  '/pos/floor/:registerId': {
    what: { sq: 'Tavolinat e restorantit ose kafes: hap tavolinën, merr porosinë, dërgoje në kuzhinë dhe merr pagesën.', en: 'The tables of the restaurant or café: open a table, take the order, send it to the kitchen and take the payment.' },
    steps: [
      { sq: 'Kliko një tavolinë të lirë: hapet porosia e saj. Për porosi pa tavolinë kliko "Me vete".', en: 'Tap a free table: its order opens. For an order without a table tap "Takeaway".' },
      { sq: 'Prek artikujt në meny për t\'i shtuar; te rreshti shton "Shënim për kuzhinën" (p.sh. pa akull).', en: 'Tap the items on the menu to add them; on a line add a "Note for the kitchen" (e.g. no ice).' },
      { sq: 'Kliko "Dërgo": artikujt e rinj shkojnë në kuzhinë ose në banak.', en: 'Tap "Send": the new items go to the kitchen or the bar.' },
      { sq: '"Lëviz" e kalon porosinë në një tavolinë tjetër (ose i bashkon dy llogari); "Llogaria" printon llogarinë për mysafirin.', en: '"Move" moves the order to another table (or joins two bills); "Print the bill" prints the bill for the guest.' },
      { sq: 'Kliko "Paguaj": zgjidh "E gjithë llogaria" ose vetëm një pjesë (kur mysafirët paguajnë veç), pastaj mënyrën e pagesës.', en: 'Tap "Pay": choose "Whole bill" or only a part (when guests pay separately), then how they pay.' },
    ],
    mistakes: [
      { sq: 'Artikulli që kuzhina e ka marrë nuk fshihet: anulohet me arsye, dhe arsyeja mbetet në histori.', en: 'An item the kitchen already has is not deleted: it is cancelled with a reason, and the reason stays in the history.' },
      { sq: 'Llogaria e printuar nuk është kupon fiskal: kuponi del kur paguhet.', en: 'The printed bill is not a fiscal receipt: the receipt comes when it is paid.' },
    ],
    after: { sq: 'Kur paguhet e gjithë llogaria, tavolina lirohet; malli dhe recetat zbresin nga stoku dhe pagesa shkon te ndërrimi i arkës.', en: 'When the whole bill is paid, the table is free; the goods and recipes leave stock and the payment goes to the till\'s shift.' },
    related: [{ href: '/pos/waiters', label: { sq: 'Kamarierët', en: 'Waiters' } }, { href: '/manufacturing/boms', label: { sq: 'Recetat', en: 'Recipes' } }],
    tour: [
      { target: 'Takeaway', say: { sq: 'Porosi pa tavolinë: me vete ose në banak.', en: 'An order without a table: takeaway or at the bar.' } },
      { target: 'Send', say: { sq: 'Dërgo artikujt e rinj në kuzhinë.', en: 'Send the new items to the kitchen.' } },
      { target: 'Move', say: { sq: 'Kalo porosinë në tavolinë tjetër.', en: 'Move the order to another table.' } },
      { target: 'Print the bill', say: { sq: 'Printo llogarinë për mysafirin.', en: 'Print the bill for the guest.' } },
    ],
  },
  '/pos/kitchen/:warehouseId': {
    what: { sq: 'Ekrani i kuzhinës (ose i banakut): porositë që dërgojnë kamarierët dalin këtu vetë, me tavolinën dhe shënimet.', en: 'The kitchen (or bar) screen: the orders the waiters send appear here by themselves, with the table and the notes.' },
    steps: [
      { sq: 'Mbaje këtë faqe hapur në kompjuterin ose tabletin e kuzhinës; "Ekran i plotë" e zmadhon.', en: 'Keep this page open on the kitchen computer or tablet; "Full screen" makes it bigger.' },
      { sq: 'Zgjidh "Stacioni" nëse kuzhina dhe banaku kanë ekrane të veçanta.', en: 'Choose the "Station" if the kitchen and the bar have separate screens.' },
      { sq: 'Kur një pjatë është gati, kliko atë; kur e gjithë porosia është gati, "Të gjitha gati". Kur kamarieri e merr, "U mor".', en: 'When a dish is ready, tap it; when the whole order is ready, "All ready". When the waiter takes it, "Picked up".' },
      { sq: 'Për fletë në letër, ndiz "Printo porositë e reja": çdo porosi e re printohet një herë.', en: 'For paper tickets, turn on "Print new orders": each new order is printed once.' },
    ],
    mistakes: [{ sq: 'Pa internet ekrani mund të mos tregojë porositë e fundit: shiriti lart të lajmëron dhe provon vetë përsëri.', en: 'Without internet the screen may not show the latest orders: the bar on top tells you and tries again by itself.' }],
    tour: [
      { target: 'Station', say: { sq: 'Kuzhina apo banaku: secili sheh vetëm të vetat.', en: 'Kitchen or bar: each sees only its own.' } },
      { target: 'Full screen', say: { sq: 'Zmadhoje për ta parë nga larg.', en: 'Make it big to see it from a distance.' } },
    ],
  },
  '/procurement/pending-invoices': {
    what: { sq: 'Malli i pranuar pa faturën e furnitorit: çdo pranim që pret faturën, sa ditë pret dhe sa vlen.', en: 'Goods received without the supplier\'s invoice: each receipt waiting for its invoice, how many days it waits and what it is worth.' },
    steps: [
      { sq: 'Shiko listën: pranimet më të vjetra dalin lart, me "Ditë në pritje".', en: 'Look at the list: the oldest receipts come first, with "Days waiting".' },
      { sq: 'Kur vjen fatura, kliko "Fut faturën" te pranimi (ose "Faturo porosinë" kur ka porosi blerjeje).', en: 'When the invoice comes, click "Enter the invoice" on the receipt (or "Bill the order" when there is a purchase order).' },
      { sq: 'Shkruaj "Numri i faturës" dhe "Data e faturës" ashtu siç janë në faturën e furnitorit: ato shkojnë në librin e blerjeve.', en: 'Type the "Invoice number" and "Invoice date" exactly as they are on the supplier\'s invoice: they go to the purchase book.' },
      { sq: 'Kontrollo faturën skicë që krijohet (çmimet, TVSH-ja) dhe kontabilizoje.', en: 'Check the draft bill that is made (prices, VAT) and post it.' },
    ],
    mistakes: [{ sq: 'Mos përdor numrin e fletëpranimit si numër faturë: libri i blerjeve kërkon numrin e furnitorit.', en: 'Do not use the receipt\'s number as the invoice number: the purchase book needs the supplier\'s number.' }],
    after: { sq: 'Pas 7 ditësh pa faturë, programi i jep detyrë personit që e pranoi mallin: "Kërko faturën e furnitorit".', en: 'After 7 days without an invoice, the program gives the person who received the goods a task: "Ask the supplier for the invoice".' },
    related: [{ href: '/inventory/receipts', label: { sq: 'Pranimet e mallit', en: 'Goods receipts' } }, { href: '/procurement/bills', label: { sq: 'Faturat e blerjes', en: 'Purchase bills' } }],
    tour: [
      { target: 'Enter the invoice', say: { sq: 'Kur vjen fatura: numri dhe data e saj, dhe bëhet fatura e blerjes.', en: 'When the invoice comes: its number and date, and the purchase bill is made.' } },
    ],
  },
}
