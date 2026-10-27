import type { Dict } from '../index'

/** Nivelimi i çmimeve, magazinat sipas përdoruesit, faturat e paradhënies */
export default {
  // nivelimi
  'Price levelling': 'Nivelimi i çmimeve',
  'Change the selling prices of many items at once, as one document: the stock on hand and the value of the change are recorded, and new labels can be printed.':
    'Ndryshoni çmimet e shitjes së shumë artikujve njëherësh, me një dokument: regjistrohet gjendja në stok dhe vlera e ndryshimit, dhe mund të printohen etiketat e reja.',
  'New levelling': 'Nivelim i ri',
  'No levelling yet': 'Ende pa nivelime',
  'Start one to change several prices together.': 'Filloni një për të ndryshuar disa çmime bashkë.',
  'Stock of': 'Stoku i',
  'Value change': 'Vlera e ndryshimit',
  'price-levelling': 'nivelimi-i-cmimeve',
  'Add a whole category': 'Shto një kategori të tërë',
  'No items in this category': 'Asnjë artikull në këtë kategori',
  'Change all by %': 'Ndrysho të gjitha me %',
  'Add items one by one or a whole category, then type the new prices (with VAT) or change them all by a percentage.':
    'Shtoni artikujt një nga një ose një kategori të tërë, pastaj shkruani çmimet e reja (me TVSH) ose ndryshojini të gjitha me një përqindje.',
  'New price of {name}': 'Çmimi i ri i {name}',
  '{n} prices change · value of the change on the stock (with VAT)': '{n} çmime ndryshojnë · vlera e ndryshimit në stok (me TVSH)',
  'Post the levelling?': 'Të postohet nivelimi?',
  '{n} prices change now. Value of the change on the stock: {amount}.': '{n} çmime ndryshojnë tani. Vlera e ndryshimit në stok: {amount}.',
  '{number} posted: {n} prices changed, value {amount}': '{number} u postua: {n} çmime u ndryshuan, vlera {amount}',
  'The prices do not change.': 'Çmimet nuk ndryshojnë.',
  'Prices with VAT.': 'Çmimet me TVSH.',

  // magazinat
  'Warehouses they work in': 'Magazinat ku punon',
  'Warehouses of {name}': 'Magazinat e {name}',
  'Tick the shops and warehouses this person works in. They can then receive, sell, count and move goods only there. With none ticked, they work in all.':
    'Shënoni dyqanet dhe magazinat ku punon ky person. Atëherë mund të pranojë, shesë, numërojë dhe lëvizë mall vetëm aty. Pa asnjë të shënuar, punon në të gjitha.',
  'Saved: only the ticked warehouses': 'U ruajt: vetëm magazinat e shënuara',
  'Saved: all warehouses': 'U ruajt: të gjitha magazinat',

  // paradhëniet
  'Advance invoice': 'Faturë paradhënieje',
  'Advance invoices': 'Faturat e paradhënies',
  'For a payment before delivery. Its VAT is due now; the final invoice deducts it, so the customer pays only the rest.':
    'Për një pagesë para dorëzimit. TVSH-ja e saj detyrohet tani; fatura përfundimtare e zbret, kështu që klienti paguan vetëm pjesën tjetër.',
  'Part of the order (%)': 'Pjesë e porosisë (%)',
  'Amount with VAT': 'Shuma me TVSH',
  'Advance with VAT': 'Paradhënia me TVSH',
  'of the order {total}': 'nga porosia {total}',
  'Create the advance invoice': 'Krijo faturën e paradhënies',
  'Draft advance invoice created — check it and post it': 'U krijua drafti i faturës së paradhënies — kontrollojeni dhe postojeni',
  'Advances to deduct': 'Paradhënie për t’u zbritur',
  '{amount} left to deduct': '{amount} për t’u zbritur',
  'fully deducted': 'e zbritur plotësisht',
  'Deduct them from this invoice': 'Zbriti nga kjo faturë',
  'Save the invoice first if you changed its lines.': 'Ruajeni faturën më parë nëse keni ndryshuar rreshtat.',
  'Advances deducted': 'Paradhëniet u zbritën',
  'Nothing to deduct': 'Asgjë për të zbritur',
  'Advance deducted': 'Paradhënie e zbritur',

  // serveri
  'Price levelling not found': 'Nivelimi nuk u gjet',
  'It is already posted': 'Është postuar tashmë',
  'Add at least one item': 'Shtoni të paktën një artikull',
  'Member not found': 'Anëtari nuk u gjet',
  'Unknown warehouse': 'Magazinë e panjohur',
  'Confirm the order first': 'Konfirmojeni më parë porosinë',
  'Customer not found': 'Klienti nuk u gjet',
  'Enter the amount of the advance': 'Shkruani shumën e paradhënies',
  'The advance is more than the order': 'Paradhënia është më e madhe se porosia',
  'Invoice not found': 'Fatura nuk u gjet',
  'New prices from the cost': 'Çmimet e reja nga kostoja',
  'Every item that came in, went out or moved, with the document behind it. Choose an item to see its card with the quantity and the value after each movement.': 'Çdo artikull që hyri, doli ose lëvizi, me dokumentin përkatës. Zgjidhni një artikull për të parë kartelën e tij me sasinë dhe vlerën pas çdo lëvizjeje.',
  'When goods arrive at a new cost, DrisPRO works out the price that keeps the target margin of the category, VAT included and rounded like your shelf prices. Accepted prices are saved as one price levelling; nothing changes by itself.': 'Kur malli vjen me kosto të re, DrisPRO llogarit çmimin që ruan marzhën e synuar të kategorisë, me TVSH dhe të rrumbullakuar si çmimet në raft. Çmimet e pranuara ruhen si një nivelim i çmimeve; asgjë nuk ndryshon vetvetiu.',
} satisfies Dict
