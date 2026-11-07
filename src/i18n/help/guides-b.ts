import type { Guide } from './types'

/**
 * Page guides, part B: stock documents, the warehouse floor (scanner screens), production and logistics.
 * Same format as guides.ts: keyed by the page's address; ":id" stands for one document.
 */
export const GUIDES_B: Record<string, Guide> = {
  /* ------------------------------------------------------------------ stock */
  '/inventory/alerts': {
    what: { sq: 'Artikujt që kanë rënë te pika e riporositjes ose më poshtë, me sasinë që duhet porositur.', en: 'Items at or below their reorder point, with the quantity to order.' },
    steps: [
      { sq: 'Filtro sipas njësisë për të parë çka po mbaron në secilin dyqan ose depo.', en: 'Filter by unit to see what is running low in each shop or depot.' },
      { sq: '"Porosia e sugjeruar" e mbush njësinë deri te maksimumi, pa atë që është tashmë "Në ardhje".', en: '"Suggested order" fills the unit up to its maximum, minus what is already "Incoming".' },
      { sq: 'Kliko "Shëno si të parë" kur e ke marrë parasysh sinjalizimin.', en: 'Click "Mark as seen" once you have dealt with the alert.' },
      { sq: 'Për ta porositur hap "Rifurnizim" poshtë tabelës; kur vjen malli, kliko "Prano mallin".', en: 'To order it, open "Replenishment" under the table; when the goods arrive, click "Receive goods".' },
    ],
    mistakes: [{ sq: 'Artikulli del këtu vetëm nëse ka pikë riporositjeje: caktoje te artikulli me "Shto pikë riporositjeje".', en: 'An item shows here only if it has a reorder point: set one on the item with "Add reorder point".' }],
    after: { sq: 'Kur stoku i lirë ngrihet mbi pikën e riporositjes (p.sh. pas një pranimi), artikulli del nga lista.', en: 'When the available stock rises above the reorder point (for example after a receipt), the item leaves the list.' },
    related: [{ href: '/procurement/replenishment', label: { sq: 'Çka duhet porositur', en: 'Replenishment' } }, { href: '/inventory/stock', label: { sq: 'Gjendja', en: 'Stock levels' } }],
  },
  '/wms/lots': {
    what: { sq: 'Çdo lot dhe numër serik: kur skadon, sa ka në stok dhe kujt i shkoi.', en: 'Every lot and serial number: when it expires, how much is in stock and who received it.' },
    steps: [
      { sq: 'Shiko kartat lart: "Të skaduara, ende në stok" duhen hequr nga raftet menjëherë.', en: 'Look at the cards on top: "Expired, still in stock" must come off the shelves now.' },
      { sq: 'Filtro sipas "Afati i ruajtjes" ose "Stoku"; në fillim dalin vetëm lotet që janë "Në stok".', en: 'Filter by "Shelf life" or "Stock"; at first only the lots "In stock" are shown.' },
      { sq: 'Kliko një lot për rrugën e tij: nga erdhi, ku lëvizi dhe "Kush e mori".', en: 'Click a lot for its path: where it came from, where it moved and "Who received it".' },
      { sq: 'Nëse duhet tërhequr malli, te loti kliko "Lista e tërheqjes": shkarkon klientët dhe sasitë.', en: 'If the goods must be recalled, click "Recall list" on the lot: it downloads the customers and quantities.' },
    ],
    mistakes: [{ sq: 'Lotet krijohen vetëm kur pranon artikuj që ndiqen me lot; artikujt pa lot nuk dalin këtu.', en: 'Lots are created only when you receive items tracked by lot; items without lots do not show here.' }],
    after: { sq: 'Mbledhja, vendosja në raft dhe arka marrin së pari lotet që skadojnë më herët; lotet e skaduara nuk rezervohen për porosi.', en: 'Picking, putting away and the till take the lots that expire first; expired lots are never reserved for orders.' },
    related: [{ href: '/inventory/receipts', label: { sq: 'Pranimet', en: 'Goods receipts' } }],
  },
  '/inventory/receipts': {
    what: { sq: 'Pranimet e mallit: malli që vjen nga furnitorët, nga importi ose si kthim nga klientët.', en: 'Goods receipts: goods coming in from vendors, imports or customer returns.' },
    steps: [
      { sq: 'Kliko "Prano mallin" për një pranim të ri, me ose pa porosi blerjeje.', en: 'Click "Receive goods" for a new receipt, with or without a purchase order.' },
      { sq: 'Nëse e ke këtë mundësi, "Fatura nga fotoja" e lexon faturën dhe e plotëson për ty.', en: 'If you have it, "Invoice from a photo" reads the invoice and fills it in for you.' },
      { sq: 'Filtro sipas statusit ("Skicë" janë të pakryerat) ose te "Dogana" për importet që presin zhdoganimin.', en: 'Filter by status ("Draft" are not done yet) or by "Customs" for imports waiting for clearance.' },
      { sq: 'Kliko një pranim për ta hapur, kontrolluar dhe kryer.', en: 'Click a receipt to open, check and complete it.' },
    ],
    after: { sq: 'Vetëm pranimi i kryer e shton stokun dhe rillogarit koston mesatare; skicat nuk ndryshojnë asgjë.', en: 'Only a completed receipt adds the stock and recalculates the average cost; drafts change nothing.' },
    related: [{ href: '/procurement/orders', label: { sq: 'Porositë e blerjes', en: 'Purchase orders' } }, { href: '/inventory/landed-costs', label: { sq: 'Dogana dhe transporti', en: 'Landed costs' } }],
  },
  '/inventory/receipts/:id': {
    what: { sq: 'Një pranim malli: nga kush vjen, në cilën njësi hyn dhe çfarë erdhi.', en: 'One goods receipt: who it comes from, which unit it goes into and what arrived.' },
    steps: [
      { sq: 'Zgjidh "Lloji i pranimit" dhe, nëse ka, "Porosi blerjeje": rreshtat dhe çmimet vijnë nga porosia.', en: 'Choose the "Receipt type" and, if there is one, the "Purchase order": lines and prices come from the order.' },
      { sq: 'Kontrollo "Njësia" dhe datën, dhe shkruaj "Nr. i fletëdërgesës".', en: 'Check the "Warehouse" and the date, and type the "Delivery note no.".' },
      { sq: 'Te "Produktet e pranuara" kontrollo sasitë me fletëdërgesën; për artikujt me lot zgjidh ose krijo lotin.', en: 'Under "Products received" check the quantities against the delivery note; for items with lots choose or create the lot.' },
      { sq: 'Kliko "Prano mallin" dhe konfirmo; pas kësaj pranimi nuk ndryshohet më.', en: 'Click "Receive goods" and confirm; after that the receipt can no longer change.' },
      { sq: 'Pastaj: "Etiketat" për raftet, "Krijo faturën e furnitorit" (kur s\'ka porosi) ose "Kthe te furnitori" për mallin me defekt.', en: 'Then: "Labels" for the shelves, "Create the vendor bill" (when there is no order) or "Return to the vendor" for faulty goods.' },
    ],
    mistakes: [
      { sq: 'Për mall nga importi aktivizo "Mall i importuar…" dhe shkruaj DUD-in; transportin dhe doganën i shton më vonë me "Shto koston e mbërritjes".', en: 'For imported goods switch on "Imported goods…" and type the customs declaration; add freight and customs later with "Add landed cost".' },
      { sq: 'Rreshtat me QC "Refuzuar" nuk hyjnë në stok; kthimi nga klienti hyn me koston mesatare, pa çmim.', en: 'Lines with QC "Rejected" do not enter stock; a customer return comes back at the average cost, without a price.' },
    ],
    after: { sq: 'Malli hyn në stok dhe kostoja mesatare rillogaritet. Për blerjet regjistrohet stoku kundrejt mallit të pranuar pa faturë, derisa të vijë fatura (shih "Kontabiliteti").', en: 'The goods enter stock and the average cost is recalculated. For purchases the books record the stock against goods received not yet invoiced, until the bill comes (see "Accounting").' },
    related: [{ href: '/procurement/bills', label: { sq: 'Faturat e blerjes', en: 'Vendor bills' } }, { href: '/inventory/labels', label: { sq: 'Etiketat', en: 'Labels' } }],
    tour: [
      { target: 'Receipt type', say: { sq: 'Nga furnitori, kthim nga klienti ose tjetër.', en: 'From a vendor, a customer return, or other.' } },
      { target: 'Purchase order', say: { sq: 'Zgjidh porosinë dhe rreshtat mbushen vetë.', en: 'Choose the order and the lines fill in by themselves.' } },
      { target: 'Delivery note no.', say: { sq: 'Numri i fletëdërgesës, si në letër.', en: 'The delivery note number, as on the paper.' } },
      { target: 'Products received', say: { sq: 'Këtu kontrollon çka erdhi; skanimi i barkodit te fusha e produktit punon.', en: 'Check here what arrived; scanning a barcode into the product field works.' } },
    ],
  },
  '/inventory/transfers': {
    what: { sq: 'Transferet: malli që kalon nga një njësi në tjetrën, ose nga një raft në tjetrin.', en: 'Transfers: goods moving from one unit to another, or from one shelf to another.' },
    steps: [
      { sq: 'Kliko "Transferim i ri" dhe zgjidh nga ku dhe ku shkon malli.', en: 'Click "New transfer" and choose where the goods come from and where they go.' },
      { sq: 'Te "Vëmendje" sheh kërkesat nga dyqanet, mallin "Në rrugë mbi një ditë" dhe ato "Pranuar me diferenca".', en: 'Under "Attention" see requests from shops, goods "On the road over a day" and those "Received with differences".' },
      { sq: 'Kliko një transfer që është në rrugë për ta numëruar dhe pranuar te njësia pranuese.', en: 'Click a transfer on the road to count and receive it at the receiving unit.' },
    ],
    after: { sq: 'Vlera e stokut nuk ndryshon: malli vetëm ndërron vend. Edhe lëvizjet nga skaneri ("Lëviz mallin") dalin këtu.', en: 'The stock value does not change: the goods only change place. Moves from the scanner ("Move stock") show here too.' },
    related: [{ href: '/wms/move', label: { sq: 'Lëviz mallin', en: 'Move stock' } }],
  },
  '/inventory/transfers/:id': {
    what: { sq: 'Një transferim: çka niset, nga cila njësi te cila, dhe çka arriti.', en: 'One transfer: what is sent, from which unit to which, and what arrived.' },
    steps: [
      { sq: 'Zgjidh "Nga" dhe "Deri"; e njëjta njësi në të dyja anët do të thotë lëvizje mes rafteve.', en: 'Choose "From" and "To"; the same unit on both sides means moving between shelves.' },
      { sq: 'Shto artikujt me "Shto rresht"; "Në dispozicion" tregon sa ka të lirë në raftin nga merret.', en: 'Add the items with "Add line"; "Available" shows what is free on the shelf it is taken from.' },
      { sq: 'Mes dy njësive kliko "Dërgo": malli del dhe është në rrugë. Brenda një njësie kliko "Lëviz mallin": zhvendoset menjëherë.', en: 'Between two units click "Ship": the goods leave and are on the road. Inside one unit click "Move stock": it moves at once.' },
      { sq: 'Kur arrin, njësia pranuese e numëron (me skaner ose me dorë) dhe kliko "Prano mallin".', en: 'When it arrives, the receiving unit counts it (scanning or typing) and clicks "Receive the goods".' },
      { sq: 'Për çdo mungesë zgjidh "Humbur gjatë rrugës" ose "Kthehet te dërguesi".', en: 'For anything missing choose "Lost on the way" or "Back to the sender".' },
    ],
    mistakes: [
      { sq: 'Kur dyqani e kërkon mallin, aktivizo "Kjo është kërkesë nga njësia pranuese": depoja e kontrollon dhe e dërgon.', en: 'When a shop asks for goods, switch on "This is a request from the receiving store": the depot checks and ships it.' },
      { sq: 'Pranimi me diferenca nuk zhbëhet: numëro me kujdes para se ta konfirmosh.', en: 'Receiving with differences cannot be undone: count carefully before you confirm.' },
    ],
    after: { sq: 'Vlera e stokut nuk ndryshon. Humbjet gjatë rrugës dalin nga stoku dhe regjistrohen në kontabilitet; tepricat shtohen në stok.', en: 'The stock value does not change. Losses on the way leave stock and are booked; extras are added to stock.' },
    tour: [
      { target: 'From', say: { sq: 'Njësia nga del malli.', en: 'The unit the goods leave from.' } },
      { target: 'To', say: { sq: 'Njësia ku shkon malli; e njëjta njësi = lëvizje mes rafteve.', en: 'The unit the goods go to; the same unit = moving between shelves.' } },
      { target: 'This is a request from the receiving store', say: { sq: 'Aktivizoje kur dyqani e kërkon mallin nga depoja.', en: 'Switch it on when a shop asks the depot for goods.' } },
    ],
  },
  '/inventory/adjustments': {
    what: { sq: 'Rregullimet e stokut: gjendja fillestare, korrigjimet, dëmtimet dhe humbjet.', en: 'Stock adjustments: opening stock, corrections, damage and losses.' },
    steps: [
      { sq: 'Kliko "Rregullim i ri" dhe zgjidh arsyen.', en: 'Click "New adjustment" and choose the reason.' },
      { sq: 'Filtro sipas "Arsyeja" ose statusit; "Pret miratim" janë ato që i pret menaxheri.', en: 'Filter by "Reason" or status; "Pending approval" are the ones waiting for the manager.' },
      { sq: 'Kliko një rregullim për ta hapur ose kryer.', en: 'Click an adjustment to open or complete it.' },
    ],
    mistakes: [{ sq: 'Për numërimin e gjithë raftit përdor "Inventarizimi": ai i bën vetë rregullimet nga diferencat.', en: 'To count a whole shelf use "Stock count": it makes the adjustments from the differences itself.' }],
    after: { sq: 'Çdo rregullim i kryer ndryshon stokun dhe vlerën e tij në kontabilitet; arsyeja del te Humbjet dhe firot.', en: 'Each completed adjustment changes the stock and its value in the books; the reason shows in Shrinkage.' },
    related: [{ href: '/wms/counts', label: { sq: 'Inventarizimi', en: 'Stock count' } }, { href: '/inventory/shrinkage', label: { sq: 'Humbjet dhe firot', en: 'Shrinkage' } }],
  },
  '/inventory/adjustments/:id': {
    what: { sq: 'Një rregullim stoku: çka shtohet ose hiqet, në cilën njësi dhe pse.', en: 'One stock adjustment: what is added or removed, in which unit and why.' },
    steps: [
      { sq: 'Zgjidh "Njësia", "Arsyeja" dhe datën; te "Shënime" shkruaj pse ndryshoi stoku.', en: 'Choose the "Warehouse", the "Reason" and the date; under "Notes" write why the stock changed.' },
      { sq: 'Shto rreshtat: te "Ndryshimi (±)" plus për mall të gjetur ose gjendje fillestare, minus për humbje dhe dëmtim.', en: 'Add the lines: in "Change (±)" plus for stock found or opening stock, minus for losses and damage.' },
      { sq: 'Kolona "Pas" tregon sa mbetet; e kuqe do të thotë se stoku del në minus.', en: 'The "After" column shows what is left; red means the stock goes below zero.' },
      { sq: 'Kliko "Dërgo dhe kryej". Nëse kërkon miratim, shkon te menaxheri; pasi miratohet, kliko "Kryej rregullimin".', en: 'Click "Send and complete". If it needs approval it goes to the manager; once approved, click "Complete adjustment".' },
    ],
    mistakes: [{ sq: 'Te "Gjendja fillestare" shkruaj koston për njësi në çdo rresht: ajo bëhet kostoja mesatare e fillimit.', en: 'For "Opening stock" type each line\'s unit cost: it becomes the starting average cost.' }],
    after: { sq: 'Shtimet vlerësohen me koston që shkruan (ose koston mesatare), heqjet me koston mesatare. Malli i dëmtuar dhe i skaduar shkon te skartimi; regjistrimi del te "Kontabiliteti".', en: 'Increases are valued at the cost you type (or the average cost), decreases at the average cost. Damaged and expired goods go to scrap; the entry shows under "Accounting".' },
    tour: [
      { target: 'Reason', say: { sq: 'Arsyeja del te raporti i humbjeve: zgjidhe saktë.', en: 'The reason shows in the shrinkage report: choose it carefully.' } },
      { target: 'Change (±)', say: { sq: 'Plus shton, minus heq.', en: 'Plus adds, minus removes.' } },
      { target: 'Notes', say: { sq: 'Shkruaj pse: e sheh menaxheri dhe kontrolli.', en: 'Write why: the manager and the auditors see it.' } },
    ],
  },
  '/inventory/labels': {
    what: { sq: 'Etiketat e raftit, të çmimit dhe me barkod, në fletë A4 ose në printer etiketash.', en: 'Shelf, price and barcode labels, on A4 sheets or a label printer.' },
    steps: [
      { sq: 'Shto artikujt me emër ose barkod, ose merri nga "Pranim malli", "Faturë blerje", "Çmimet e ndryshuara" ose "Kategoria".', en: 'Add items by name or barcode, or take them from "Goods receipt", "Purchase invoice", "Changed prices" or "Category".' },
      { sq: 'Te kolona "Etiketat" shkruaj sa etiketa do për çdo artikull.', en: 'In the "Labels" column type how many labels you want for each item.' },
      { sq: 'Zgjidh "Lloji i etiketës" dhe "Letra"; shiko parapamjen djathtas.', en: 'Choose the "Kind of label" and the "Paper"; check the preview on the right.' },
      { sq: 'Kliko "Printo … etiketa" ose "PDF".', en: 'Click "Print … labels" or "PDF".' },
    ],
    mistakes: [
      { sq: 'Për një fletë A4 të përdorur pjesërisht, cakto "Fillo nga etiketa" që të mos humbasësh etiketat bosh.', en: 'For a partly used A4 sheet, set "Start at label" so the empty labels are not wasted.' },
      { sq: 'Nëse printimi del pak jashtë etiketave, rregulloje te "Rregullimi i printerit".', en: 'If the print lands a little off the labels, fix it under "Printer adjustment".' },
    ],
    after: { sq: 'Artikujt pa barkod mund të marrin barkod të dyqanit me "Jepu barkod … artikujve që s’kanë".', en: 'Items without a barcode can get an in-store barcode with "Give barcodes to the … items without one".' },
    related: [{ href: '/inventory/levelling', label: { sq: 'Nivelimi i çmimeve', en: 'Price levelling' } }],
    tour: [
      { target: 'Items', say: { sq: 'Zgjidh nga ku i merr artikujt.', en: 'Choose where to take the items from.' } },
      { target: 'Kind of label', say: { sq: 'Etiketë rafti, çmimi ose barkodi.', en: 'A shelf, price or barcode label.' } },
      { target: 'Paper', say: { sq: 'Fleta A4 ose printeri i etiketave që ke.', en: 'The A4 sheet or the label printer you have.' } },
    ],
  },
  '/inventory/warehouses': {
    what: { sq: 'Njësitë (depo, dyqane) dhe raftet e tyre: çdo lëvizje stoku shkon nga një vend te tjetri.', en: 'Units (depots, shops) and their shelves: every stock movement goes from one place to another.' },
    steps: [
      { sq: 'Kliko "Njësi e re", shkruaj kodin, emrin dhe llojin; krijohet vetë edhe një raft stoku.', en: 'Click "New warehouse", type the code, name and type; a stock shelf is created with it.' },
      { sq: 'Zgjidh njësinë majtas për të parë raftet dhe vlerën e stokut në to.', en: 'Choose a unit on the left to see its shelves and the stock value on them.' },
      { sq: 'Me "Shto vendndodhje" shto raftet; "Barkodi i raftit" të lejon ta skanosh gjatë pranimit dhe transferimit.', en: 'Add shelves with "Add location"; a "Bin barcode" lets you scan it when receiving and transferring.' },
      { sq: 'Me "Brenda" i rendit raftet njëri brenda tjetrit; një "Grup (pa stok)" vetëm i mbledh.', en: 'With "Inside" put shelves under one another; a "Group (no stock)" only holds them together.' },
    ],
    mistakes: [{ sq: 'Vetëm raftet bosh fshihen. Për një raft rezervë çaktivizo "Mblidh nga ky raft".', en: 'Only empty shelves can be deleted. For a reserve shelf switch off "Pick from this bin".' }],
    related: [{ href: '/inventory/stock', label: { sq: 'Gjendja', en: 'Stock levels' } }, { href: '/wms', label: { sq: 'Paneli i skanerit', en: 'Warehouse floor' } }],
  },
  '/inventory/setup': {
    what: { sq: 'Kategoritë e artikujve, njësitë matëse dhe atributet (masa, ngjyra) për variantet.', en: 'Item categories, units of measure and attributes (size, colour) for variants.' },
    steps: [
      { sq: 'Te "Kategoritë" kliko "Kategori e re"; një kategori mund të jetë brenda tjetrës.', en: 'Under "Categories" click "New category"; a category can sit inside another.' },
      { sq: 'Te "Njësitë matëse" shto p.sh. paketën me 6 copë: "Madhësia kundrejt njësisë bazë" është 6.', en: 'Under "Units of measure" add for example a pack of 6: the "Size relative to the reference unit" is 6.' },
      { sq: 'Te "Atributet e variantit" krijo p.sh. Masa me S, M, L: artikulli i ri merr një variant për çdo kombinim.', en: 'Under "Variant attributes" create for example Size with S, M, L: a new item gets one variant per combination.' },
    ],
    mistakes: [{ sq: 'Kur fshin një kategori, artikujt e saj mbeten pa kategori.', en: 'When you delete a category, its items are left without one.' }],
    related: [{ href: '/inventory/products', label: { sq: 'Artikujt', en: 'Products' } }],
  },

  /* ------------------------------------------------------------------ warehouse floor */
  '/wms': {
    what: { sq: 'Paneli i skanerit: ekranet e depos për pranim, vendosje në raft, mbledhje, dërgim, lëvizje dhe numërim.', en: 'The warehouse floor: scanner screens for receiving, putting away, picking, shipping, moving and counting.' },
    steps: [
      { sq: 'Zgjidh njësinë lart djathtas; programi e mban mend në këtë pajisje.', en: 'Choose the unit at the top right; the program remembers it on this device.' },
      { sq: 'Kliko një kuadrat ose shtyp tastin 1–7; numri tregon sa punë presin.', en: 'Click a tile or press 1–7; the number shows how much work is waiting.' },
      { sq: 'Çdo ekran punon me skaner, me kamerën e telefonit ose me tastierë.', en: 'Each screen works with a scanner, the phone camera or the keyboard.' },
    ],
    mistakes: [{ sq: 'Malli në zonën e pranimit nuk mblidhet për porosi derisa të vendoset në raft: kliko "Vendos në raft nga …".', en: 'Goods in the receiving area cannot be picked until they are put away: click "Put away …".' }],
    related: [{ href: '/wms/receive', label: { sq: 'Prano mallin', en: 'Receive' } }, { href: '/wms/picking', label: { sq: 'Mblidh mallin', en: 'Pick' } }],
  },
  '/wms/receive': {
    what: { sq: 'Pranimi me skaner: malli që pritet, i numëruar artikull për artikull.', en: 'Receiving with the scanner: the expected goods, counted item by item.' },
    steps: [
      { sq: 'Skano numrin e porosisë, të pranimit ose të fletëdërgesës, ose kliko furnitorin në listë.', en: 'Scan the order, receipt or delivery note number, or click the vendor in the list.' },
      { sq: 'Skano çdo artikull; për artikujt me lot skano etiketën e lotit ose shkruaj numrin dhe datën e skadimit.', en: 'Scan each item; for items with lots scan the lot label or type the number and expiry date.' },
      { sq: 'Kliko një rresht për të shkruar sasinë me dorë; rreshti bëhet i gjelbër kur përputhet.', en: 'Click a line to type the quantity; the line turns green when it matches.' },
      { sq: 'Kliko "Prano … njësi" dhe konfirmo.', en: 'Click "Receive … units" and confirm.' },
    ],
    mistakes: [{ sq: 'Numërimi ruhet në pajisje edhe nëse fiket; "Fillo nga e para" e fshin dhe nis nga zero.', en: 'The count is kept on the device even if it switches off; "Start over" clears it and starts from zero.' }],
    after: { sq: 'Malli hyn në zonën e pranimit dhe krijohet vetë detyra për ta vendosur në raft. Porosia e blerjes mban hapur atë që mungon.', en: 'The goods go into the receiving area and a put-away task is created. The purchase order keeps open whatever is missing.' },
    related: [{ href: '/wms/putaway', label: { sq: 'Vendos në raft', en: 'Put away' } }],
  },
  '/wms/putaway': {
    what: { sq: 'Vendosja në raft: malli i pranuar kalon nga zona e pranimit te raftet ku ruhet.', en: 'Putting away: received goods move from the receiving area to the shelves where they are kept.' },
    steps: [
      { sq: 'Kliko një detyrë; për çdo pranim krijohet vetë një e tillë.', en: 'Click a task; one is created for every receipt.' },
      { sq: 'Programi tregon artikullin dhe raftet e propozuara: kliko njërin ose skano etiketën e çdo rafti tjetër.', en: 'The program shows the item and suggested shelves: click one or scan any other shelf label.' },
      { sq: 'Ndrysho sasinë nëse e ndan mallin në disa rafte; skano një artikull tjetër për të kaluar te ai.', en: 'Change the quantity to split the goods over several shelves; scan another item to switch to it.' },
      { sq: 'Kur vendoset çdo rresht, detyra mbyllet vetë.', en: 'When every line is put away, the task closes by itself.' },
    ],
    mistakes: [{ sq: '"Mblidh të gjitha nga …" bën një detyrë për gjithë mallin që ka mbetur në zonën e pranimit.', en: '"Collect all from …" makes one task for everything still lying in the receiving area.' }],
    after: { sq: 'Malli kalon në raftet e reja pa ndryshuar vlerë dhe tani mund të mblidhet për porosi.', en: 'The goods move to the new shelves without changing value and can now be picked for orders.' },
  },
  '/wms/picking': {
    what: { sq: 'Mbledhja e mallit për dërgesat e klientëve, me listë mbledhjeje.', en: 'Picking goods for customer deliveries, with a pick list.' },
    steps: [
      { sq: 'Te "Për t’u mbledhur" zgjidh një ose disa dërgesa të së njëjtës njësi dhe kliko "Fillo mbledhjen".', en: 'Under "To pick" select one or more deliveries from the same unit and click "Start picking".' },
      { sq: 'Shko te rafti që tregohet, skano raftin, pastaj çdo artikull.', en: 'Go to the shelf shown, scan the shelf, then each item.' },
      { sq: 'Nëse mungon malli, kliko "Mungesë — u gjetën …"; me "Kaloje për tani" kalon te rreshti tjetër.', en: 'If goods are missing, click "Short — … found"; "Skip for now" moves to the next line.' },
      { sq: 'Kur mblidhet gjithçka, kliko "Përfundo listën e mbledhjes".', en: 'When everything is picked, click "Finish pick list".' },
    ],
    mistakes: [{ sq: 'Nëse e merr mallin nga një raft tjetër, skano atë raft: programi regjistron nga ku u mor.', en: 'If you take the goods from another shelf, scan that shelf: the program records where they came from.' }],
    after: { sq: 'Dërgesat bëhen gati dhe dalin te "Dërgo". Artikujt që mungojnë hiqen nga dërgesa; porosia i mban për më vonë.', en: 'The deliveries become ready and show under "Ship". Missing items are taken off the delivery; the order keeps them for later.' },
    related: [{ href: '/wms/shipping', label: { sq: 'Dërgo', en: 'Ship' } }],
  },
  '/wms/shipping': {
    what: { sq: 'Dërgimi: dërgesat e mbledhura që presin të nisen.', en: 'Shipping: picked deliveries waiting to leave.' },
    steps: [
      { sq: 'Skano numrin e dërgesës ose të porosisë, ose kliko "Dërgo" te dërgesa.', en: 'Scan the delivery or order number, or click "Ship" on the delivery.' },
      { sq: 'Printo "Fletë paketimi" dhe fute në pako.', en: 'Print the "Packing slip" and put it in the parcel.' },
      { sq: 'Shkruaj transportuesin, numrin e gjurmimit, pakot dhe peshën, pastaj kliko "Konfirmo dërgimin".', en: 'Type the carrier, tracking number, parcels and weight, then click "Confirm shipment".' },
    ],
    after: { sq: 'Malli del nga stoku dhe regjistrohet kostoja e mallit të shitur; dërgesa del te "Dërguar së fundi".', en: 'The goods leave stock and the cost of goods sold is booked; the delivery shows under "Recently shipped".' },
    related: [{ href: '/sales/deliveries', label: { sq: 'Dërgesat', en: 'Deliveries' } }, { href: '/logistics/planning', label: { sq: 'Planifikimi i transportit', en: 'Delivery planning' } }],
  },
  '/wms/move': {
    what: { sq: 'Lëvizja e mallit nga një raft te tjetri, me tre skanime.', en: 'Moving goods from one shelf to another, in three scans.' },
    steps: [
      { sq: 'Skano raftin ku është malli.', en: 'Scan the shelf the goods are on.' },
      { sq: 'Skano artikujt që lëviz (ose kliko në listën e raftit); kliko sasinë për ta ndryshuar.', en: 'Scan the items to move (or click them in the shelf list); click the quantity to change it.' },
      { sq: 'Skano raftin ku i çon: lëvizja kryhet menjëherë.', en: 'Scan the shelf you take them to: the move is done at once.' },
    ],
    mistakes: [{ sq: 'Lëviz vetëm sasia e lirë: malli i rezervuar për porosi nuk lëvizet.', en: 'Only the free quantity moves: goods reserved for orders cannot be moved.' }],
    after: { sq: 'Lëvizja ruhet si transferim i kryer dhe del te Transferet; vlera e stokut nuk ndryshon.', en: 'The move is saved as a completed transfer and shows under Transfers; the stock value does not change.' },
    related: [{ href: '/inventory/transfers', label: { sq: 'Transferet', en: 'Transfers' } }],
  },

  /* ------------------------------------------------------------------ production */
  '/manufacturing': {
    what: { sq: 'Pasqyra e prodhimit: çka po prodhohet, çka duhet prodhuar dhe sa kushton, pa TVSH.', en: 'Production overview: what is being made, what to make next and what it costs, without VAT.' },
    steps: [
      { sq: 'Zgjidh periudhën; kartat tregojnë urdhrat në prodhim, ata me vonesë dhe vlerën e prodhuar.', en: 'Choose the period; the cards show orders in production, late ones and the value produced.' },
      { sq: 'Te "Plani i prodhimit" shiko "Për t\'u prodhuar" dhe kliko "Planifiko …" për urdhrin e punës me atë sasi.', en: 'In the "Production plan" look at "To make" and click "Plan …" for a work order with that quantity.' },
      { sq: 'Te "Ngarkesa e qendrave të punës" e kuqja tregon ditët me më shumë punë se orë.', en: 'In "Work center load" red shows the days with more work than hours.' },
      { sq: 'Me "Urdhër pune i ri" ose "Recetë e re" fillon nga e para.', en: 'Start from scratch with "New work order" or "New recipe".' },
    ],
    mistakes: [{ sq: 'Në plan dalin vetëm artikujt me recetë; kur stoku bie nën minimum, plani e mbush deri te maksimumi.', en: 'Only items with a recipe are in the plan; when stock falls below the minimum, the plan fills up to the maximum.' }],
    related: [{ href: '/manufacturing/orders', label: { sq: 'Urdhrat e punës', en: 'Work orders' } }, { href: '/manufacturing/boms', label: { sq: 'Recetat', en: 'Recipes' } }],
  },
  '/manufacturing/orders': {
    what: { sq: 'Urdhrat e punës: çka po prodhohet, nga planifikimi deri te mbyllja.', en: 'Work orders: what is being made, from planned to closed.' },
    steps: [
      { sq: 'Kliko "Urdhër pune i ri", zgjidh produktin dhe sasinë: materialet dhe hapat vijnë nga receta.', en: 'Click "New work order", choose the product and quantity: materials and steps come from the recipe.' },
      { sq: 'Shiko si "Lista" ose si "Tabela" sipas statusit; të vonuarat shënohen "Me vonesë".', en: 'View as a "List" or as a "Board" by status; late ones are marked "Late".' },
      { sq: 'Kliko një urdhër për ta lëshuar në prodhim, për të përdorur materialet dhe për të regjistruar prodhimin.', en: 'Click an order to release it, use the materials and book the output.' },
    ],
    mistakes: [{ sq: 'Lista tregon në fillim vetëm urdhrat aktivë; për të mbyllurit dhe të anuluarit ndrysho filtrin e statusit.', en: 'The list first shows only active orders; change the status filter for closed and cancelled ones.' }],
    after: { sq: 'Përdorimi i materialeve dhe regjistrimi i prodhimit lëvizin stokun; mbyllja e urdhrit e barazon koston në kontabilitet.', en: 'Using materials and booking output move the stock; closing the order settles the cost in the books.' },
  },
  '/manufacturing/orders/:id': {
    what: { sq: 'Një urdhër pune: materialet, hapat, prodhimi dhe kostoja.', en: 'One work order: its materials, steps, output and cost.' },
    steps: [
      { sq: 'Kliko "Lësho në prodhim": programi të tregon nëse mungon ndonjë material.', en: 'Click "Release": the program tells you if any material is missing.' },
      { sq: 'Te "Hapat" kliko "Raporto punën" për minutat e punuara.', en: 'Under "Steps" click "Report work" for the minutes worked.' },
      { sq: 'Kur del malli i gatshëm, kliko "Regjistro prodhimin" dhe shkruaj sasinë e mirë dhe sa u hodh poshtë.', en: 'When finished goods come off the line, click "Book output" and type the good quantity and how much was scrapped.' },
      { sq: 'Te butoni ⋯ janë "Përdor materialet" (kur merren nga magazina para prodhimit), "Kthe materialin e papërdorur", "Përfundo më herët", "Kthe në skicë" dhe "Anulo urdhrin e punës".', en: 'Under the ⋯ button are "Use materials" (when they are taken from the store before output), "Return unused material", "Finish early", "Back to draft" and "Cancel work order".' },
      { sq: 'Në fund kliko "Mbyll dhe barazo koston".', en: 'At the end click "Close and settle cost".' },
    ],
    mistakes: [
      { sq: 'Kur del paralajmërimi për material që mungon, lëvize stokun në vendin e prodhimit ose pranoje para se t\'i përdorësh materialet.', en: 'When the missing-material warning shows, move the stock to the production place or receive it before using the materials.' },
      { sq: 'Prodhimi i pjesshëm vlerësohet me koston e planifikuar; prodhimi i fundit merr gjithë koston që ka mbetur.', en: 'Partial output is valued at the planned cost; the last output takes all the cost that is left.' },
    ],
    after: { sq: 'Materialet dalin nga stoku në prodhim në proces; malli i gatshëm hyn në stok. Në mbyllje, kostoja që nuk e mori prodhimi regjistrohet si diferencë kostoje (konto 6012).', en: 'Materials leave stock into work in progress; finished goods enter stock. On closing, any cost the output did not take is booked as a cost difference (account 6012).' },
    tour: [
      { target: 'Materials', say: { sq: 'Çka duhet, çka u përdor dhe çka është e lirë.', en: 'What is needed, what was used and what is free.' } },
      { target: 'Steps', say: { sq: 'Hapat e punës: raporto minutat këtu.', en: 'The work steps: report the minutes here.' } },
      { target: 'Cost', say: { sq: 'Kostoja e planifikuar kundrejt kostos së vërtetë.', en: 'The planned cost against the actual cost.' } },
      { target: 'More', say: { sq: 'Te ⋯: materialet, kthimi i tyre, përfundimi më herët dhe anulimi.', en: 'Under ⋯: materials, returning them, finishing early and cancelling.' } },
    ],
  },
  '/manufacturing/boms': {
    what: { sq: 'Recetat: nga çka përbëhet çdo produkt dhe si bëhet.', en: 'Recipes: what each product is made of and how.' },
    steps: [
      { sq: 'Kliko "Recetë e re", zgjidh produktin që prodhon dhe sasinë e serisë.', en: 'Click "New recipe", choose the product it makes and the batch quantity.' },
      { sq: 'Shto përbërësit me sasinë për një seri; "Firo %" shton humbjen e pritur.', en: 'Add the components with the quantity for one batch; "Waste %" adds the expected loss.' },
      { sq: 'Shto hapat me qendrën e punës dhe minutat: nga to llogaritet kostoja e punës.', en: 'Add the steps with the work center and minutes: the labour cost is worked out from them.' },
      { sq: 'Zgjidh llojin: "Prodhimi" për urdhra pune, ose "Set ose recetë: përbërësit dalin nga stoku kur shitet".', en: 'Choose the type: "Production" for work orders, or "Kit or recipe: its parts leave stock when it is sold".' },
    ],
    mistakes: [
      { sq: 'Fillo nga lëndët e para: së pari gjysmëproduktet, pastaj produktet që bëhen prej tyre.', en: 'Start from the raw materials: semi-finished products first, then the products made from them.' },
      { sq: 'Një produkt mund të ketë disa receta; përdoret ajo me "Receta kryesore për këtë produkt".', en: 'A product can have several recipes; the one marked "Main recipe for this product" is used.' },
    ],
    related: [{ href: '/manufacturing/work-centers', label: { sq: 'Makinat dhe linjat', en: 'Work centers' } }, { href: '/manufacturing/orders', label: { sq: 'Urdhrat e punës', en: 'Work orders' } }],
  },
  '/manufacturing/work-centers': {
    what: { sq: 'Makinat, linjat dhe ekipet ku bëhet puna, me koston e tyre për orë.', en: 'The machines, lines and teams where the work is done, with their cost per hour.' },
    steps: [
      { sq: 'Kliko "Qendër pune e re" dhe shkruaj kodin dhe emrin.', en: 'Click "New work center" and type the code and name.' },
      { sq: 'Shkruaj "Puna për orë" dhe "Shpenzime të përgjithshme për orë" (energji, amortizim, pjesë e qirasë).', en: 'Type the "Labour per hour" and "Overhead per hour" (energy, depreciation, share of rent).' },
      { sq: 'Cakto "Orë në ditë" dhe "Efikasiteti %": te 80% çdo hap zgjat 25% më shumë.', en: 'Set the "Hours per day" and "Efficiency %": at 80% every step takes 25% longer.' },
      { sq: 'Poshtë shiko ngarkesën e dy javëve të ardhshme; e kuqja do të thotë më shumë punë se orë.', en: 'Below, see the load for the next two weeks; red means more work than hours.' },
    ],
    after: { sq: 'Koha e raportuar në urdhrat e punës shumëzohet me këto tarifa dhe bëhet kosto pune dhe shpenzime në produkt.', en: 'Time reported on work orders is multiplied by these rates and becomes labour and overhead cost in the product.' },
    related: [{ href: '/manufacturing/boms', label: { sq: 'Recetat', en: 'Recipes' } }],
  },

  /* ------------------------------------------------------------------ logistics */
  '/logistics': {
    what: { sq: 'Pasqyra e logjistikës: çka pret të niset, çka është në rrugë dhe si shkojnë dorëzimet.', en: 'Logistics overview: what is waiting to go out, what is on the road and how deliveries are going.' },
    steps: [
      { sq: 'Zgjidh periudhën; "Për t\'u nisur" janë dërgesat e mbledhura që s\'janë ende në itinerar.', en: 'Choose the period; "To dispatch" are picked deliveries not on a route yet.' },
      { sq: 'Te "Itineraret e sotme" sheh ndalesat e kryera dhe ngarkesën e çdo mjeti.', en: 'Under "Today\'s routes" see the stops done and each vehicle\'s load.' },
      { sq: 'Kontrollo "Pagesë në dorëzim për t\'u dorëzuar në arkë": paratë që shoferët i mblodhën por s\'janë në arkë.', en: 'Check "Cash on delivery to settle": money drivers collected that is not in the cash box yet.' },
      { sq: 'Kliko "Planifiko dërgesat" për të krijuar itineraret.', en: 'Click "Plan deliveries" to create the routes.' },
    ],
    related: [{ href: '/logistics/planning', label: { sq: 'Planifikimi i transportit', en: 'Delivery planning' } }, { href: '/logistics/shipments', label: { sq: 'Transportet', en: 'Shipments' } }],
  },
  '/logistics/planning': {
    what: { sq: 'Planifikimi i transportit: dërgesat e mbledhura bëhen transporte dhe vendosen në një furgon ose te një korrier.', en: 'Delivery planning: picked deliveries become shipments and go on a van or to a carrier.' },
    steps: [
      { sq: 'Te "Në pritje për t\'u nisur" kliko "Krijo transport" te dërgesa; shkruaj pagesën në dorëzim nëse klienti paguan kur e merr.', en: 'Under "Waiting to go out" click "Create shipment" on a delivery; type the cash on delivery if the customer pays on receipt.' },
      { sq: 'Zgjidh transportet (janë sipas qytetit) dhe kliko "Itinerar i ri", ose "Shto te …" për një itinerar që ekziston.', en: 'Select the shipments (grouped by city) and click "New route", or "Add to …" for an existing route.' },
      { sq: 'Zgjidh mjetin, shoferin dhe nga niset; programi paralajmëron nëse pesha kalon kapacitetin.', en: 'Choose the vehicle, driver and where it leaves from; the program warns if the weight is over capacity.' },
      { sq: 'Për korrier të jashtëm kliko "Transportuesi" te transporti dhe shkruaj numrin e gjurmimit.', en: 'For an outside courier click "Carrier" on the shipment and type the tracking number.' },
      { sq: 'Kliko "Hap fletën e itinerarit" për renditjen e ndalesave dhe për shoferin.', en: 'Click "Open route sheet" to order the stops and for the driver.' },
    ],
    mistakes: [{ sq: 'Shoferi duhet të konfirmojë që i mori paratë e pagesës në dorëzim, përndryshe ndalesa nuk llogaritet e dorëzuar.', en: 'The driver must confirm the cash on delivery was collected, or the stop does not count as delivered.' }],
    after: { sq: 'Kur pakoja i jepet korrierit, malli del nga stoku (nëse depoja s\'e ka nxjerrë ende).', en: 'When the parcel is handed to the carrier, the goods leave stock (if the warehouse has not done it yet).' },
    tour: [
      { target: 'Waiting to go out', say: { sq: 'Dërgesat dhe transportet që s\'janë ende në itinerar, sipas qytetit.', en: 'Deliveries and shipments not on a route yet, by city.' } },
      { target: 'New route', say: { sq: 'Krijo itinerarin për një mjet dhe një shofer.', en: 'Create the route for a vehicle and a driver.' } },
    ],
  },
  '/logistics/shipments': {
    what: { sq: 'Transportet: çdo pako që del, me furgonin tonë ose me korrier, me gjurmim dhe pagesë në dorëzim.', en: 'Shipments: every parcel that leaves, on our vans or with a carrier, with tracking and cash on delivery.' },
    steps: [
      { sq: 'Filtro sipas statusit, transportuesit ose "Pagesë në dorëzim".', en: 'Filter by status, carrier or "Cash on delivery".' },
      { sq: 'Kliko numrin e gjurmimit për ta ndjekur pakon te faqja e korrierit.', en: 'Click the tracking number to follow the parcel on the carrier\'s page.' },
      { sq: 'Kliko një transport për ta shënuar të dorëzuar ose të padorëzuar.', en: 'Click a shipment to mark it delivered or not delivered.' },
      { sq: 'Për paratë që solli shoferi: zgjidh ato "Mbledhur, jo në arkë", kliko "Dorëzo në arkë paratë e mbledhura", zgjidh arkën ose bankën dhe "Regjistro arkëtimet".', en: 'For cash the drivers brought in: select those "Collected, not settled", click "Settle cash on delivery", choose the cash box or bank and "Record receipts".' },
    ],
    after: { sq: 'Çdo transport i dorëzuar në arkë bëhet arkëtim nga klienti dhe lidhet me faturat e hapura të porosisë.', en: 'Each settled shipment becomes a customer receipt, applied to the order\'s open invoices.' },
    related: [{ href: '/logistics/planning', label: { sq: 'Planifikimi i transportit', en: 'Delivery planning' } }, { href: '/finance/payments', label: { sq: 'Pagesat', en: 'Payments' } }],
  },
  '/logistics/setup': {
    what: { sq: 'Mjetet dhe korrierët: furgonët tanë me shoferët, dhe kompanitë korriere që u japim pakot.', en: 'Carriers and fleet: our own vans and drivers, and the courier companies we hand parcels to.' },
    steps: [
      { sq: 'Kliko "Shto transportues" për çdo korrier dhe zgjidh "Kompani korriere" ose "Mjetet tona".', en: 'Click "Add carrier" for each courier and choose "Courier company" or "Our own vehicles".' },
      { sq: 'Te "Lidhja e gjurmimit" vendos adresën e faqes së gjurmimit me {tracking}: numri i gjurmimit bëhet lidhje.', en: 'In "Tracking link" put the tracking page address with {tracking}: the tracking number becomes a link.' },
      { sq: 'Kliko "Shto mjet" dhe shkruaj targën, "Kapaciteti i ngarkesës (kg)" dhe "Shoferi i zakonshëm".', en: 'Click "Add vehicle" and type the plate, the "Load capacity (kg)" and the "Usual driver".' },
    ],
    after: { sq: 'Kapaciteti kontrollohet kur vendos transporte në itinerar, dhe shoferi i zakonshëm propozohet vetë.', en: 'The capacity is checked when you put shipments on a route, and the usual driver is suggested.' },
    related: [{ href: '/logistics/planning', label: { sq: 'Planifikimi i transportit', en: 'Delivery planning' } }],
  },
}
