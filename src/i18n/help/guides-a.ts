import type { Guide } from './types'

/**
 * More page guides (see guides.ts for the format): the start page, approvals, selling, the field,
 * the web shop, the till extras and buying. Keyed by the page's address; ":id" stands for one document.
 */
export const GUIDES_A: Record<string, Guide> = {
  /* ------------------------------------------------------------------ everyday */
  '/': {
    what: { sq: 'Faqja e parë: shifrat kryesore (stoku, shitjet, borxhet, miratimet) dhe lëvizjet e fundit të stokut.', en: 'The start page: the key figures (stock, sales, debts, approvals) and the latest stock movements.' },
    steps: [
      { sq: '"Dita deri tani" të thotë me një fjali sa ke shitur sot, krahasuar me ditët e zakonshme, dhe çka shitet më shumë.', en: '"The day so far" tells you in one sentence what you sold today, compared with usual days, and what sells most.' },
      { sq: 'Kliko një kartelë me shifër për të hapur faqen pas saj, p.sh. borxhet ose stokun.', en: 'Click a figure card to open the page behind it, e.g. debts or stock.' },
      { sq: 'Kliko "Personalizo panelin" për të zgjedhur cilat kartela dalin dhe me çfarë radhe; zgjedhjen e sheh vetëm ti.', en: 'Click "Choose cards" to pick which cards show and in what order; only you see this choice.' },
      { sq: 'Kur lart del shiriti "gjëra për t\'u kontrolluar në libra", klikoje: të hap kontrollin e librave.', en: 'When the "things to check in the books" strip shows on top, click it: it opens the books check.' },
      { sq: '"Po mbarojnë" tregon artikujt që ranë te pika e riporositjes; "Shiko të gjitha" hap listën e plotë.', en: '"Running low" shows items that dropped to the reorder point; "View all" opens the full list.' },
    ],
    mistakes: [
      { sq: 'Vlera e stokut dhe lëvizjet janë me çmim blerjeje pa TVSH, jo me çmimin e shitjes.', en: 'Stock value and movements are at purchase price without VAT, not at the selling price.' },
      { sq: 'Në pamjen e thjeshtë këtu ke vetëm butona të mëdhenj: me "Rregullo" zgjedh cilët dalin.', en: 'In the simple view this page has only big buttons: "Arrange" picks which ones show.' },
    ],
    related: [{ href: '/approvals', label: { sq: 'Për miratim', en: 'Approvals' } }, { href: '/check', label: { sq: 'Kontrolli i librave', en: 'Books check' } }],
    tour: [
      { target: 'Choose cards', say: { sq: 'Këtu zgjedh cilat shifra të dalin në faqen e parë.', en: 'Choose here which figures show on the start page.' } },
      { target: 'View all', say: { sq: 'Lista e plotë e artikujve që po mbarojnë.', en: 'The full list of items running low.' } },
    ],
  },
  '/approvals': {
    what: { sq: 'Dokumentet që presin vendimin tënd: porosi, kërkesa blerjeje, rregullime stoku, pagesa. Kërkesat e tua nuk i miraton dot vetë.', en: 'Documents waiting for your decision: orders, requisitions, stock adjustments, payments. You cannot approve your own requests.' },
    steps: [
      { sq: 'Te "Në pritje" sheh çka pret vendimin; kliko numrin për të parë dokumentin.', en: 'Under "Waiting" see what waits for a decision; click the number to see the document.' },
      { sq: '"Mirato" e miraton me një klikim. "Refuzo" kërkon arsyen.', en: '"Approve" approves it in one click. "Reject" asks for the reason.' },
      { sq: 'Kur refuzon, shkruaj patjetër arsyen: kërkuesi e sheh se çka duhet ndryshuar.', en: 'When you reject, you must write the reason: the requester sees what to change.' },
      { sq: 'Te "Të vendosura" sheh vendimet e mëparshme.', en: 'Under "Decided" see the earlier decisions.' },
    ],
    mistakes: [
      { sq: 'Te kërkesa jote del "Kërkesa juaj" pa butona: atë e miraton dikush tjetër.', en: 'Your own request shows "Your request" without buttons: someone else approves it.' },
      { sq: 'Cilat dokumente kërkojnë miratim dhe nga kush caktohet te Rregullat e miratimit.', en: 'Which documents need approval, and by whom, is set in Approval workflows.' },
    ],
    after: { sq: 'Kërkuesi njoftohet për vendimin. Nëse rregulli ka edhe një hap, njoftohet miratuesi i radhës; pas miratimit të fundit dokumenti vazhdon (p.sh. porosia rezervon mallin). Një miratim që pret më shumë se 2 ditë bëhet detyrë për administratorin e kompanisë.', en: 'The requester is notified of the decision. If the workflow has another step, the next approver is notified; after the last approval the document goes on (e.g. the order reserves stock). An approval waiting more than 2 days becomes a task for the company\'s administrator.' },
    related: [{ href: '/settings/workflows', label: { sq: 'Rregullat e miratimit', en: 'Approval workflows' } }, { href: '/notifications', label: { sq: 'Njoftimet', en: 'Notifications' } }],
    tour: [
      { target: 'Waiting', say: { sq: 'Këtu janë dokumentet që presin ty.', en: 'Here are the documents waiting for you.' } },
      { target: 'Approve', say: { sq: 'Mirato ose refuzo në rreshtin e dokumentit.', en: 'Approve or reject on the document\'s line.' } },
      { target: 'Decided', say: { sq: 'Vendimet e mëparshme janë këtu.', en: 'Earlier decisions are here.' } },
    ],
  },
  '/accountant': {
    what: { sq: 'Për kontabilistin: çdo kompani që ua mban librat, me atë që pret në secilën.', en: 'For the accountant: every company you keep the books of, with what waits in each one.' },
    steps: [
      { sq: 'Kërko kompaninë te "Gjej një klient"; ato me më shumë punë dalin të parat.', en: 'Find the company with "Find a client"; those with the most work come first.' },
      { sq: 'Kliko një etiketë (rreshta banke për t\'u lidhur, kupona për t\'u regjistruar, fatura në skicë…): hapet ajo kompani në faqen e duhur.', en: 'Click a tag (bank lines to match, receipts to book, draft invoices…): that company opens at the right page.' },
      { sq: 'Etiketa e TVSH-së ose e deklaratës së pagave tregon afatin; me të kuqe do të thotë që ka kaluar.', en: 'The VAT or payroll declaration tag shows the deadline; red means it has passed.' },
      { sq: 'Kliko "Hap" për të hyrë te financat e kompanisë.', en: 'Click "Open" to go into the company\'s finance.' },
    ],
    mistakes: [{ sq: 'Kur hap një klient, programi kalon në atë kompani: shiko emrin lart para se të regjistrosh diçka.', en: 'Opening a client switches the program to that company: check the name on top before you record anything.' }],
    related: [{ href: '/finance/bank', label: { sq: 'Banka dhe arka', en: 'Bank and cash' } }, { href: '/tax', label: { sq: 'Afatet e tatimeve', en: 'Tax overview' } }],
  },
  '/notifications': {
    what: { sq: 'Njoftimet: miratimet që të presin, afatet dhe gjërat që duan vëmendje në këtë kompani.', en: 'Notifications: approvals waiting for you, deadlines and things that need attention in this company.' },
    steps: [
      { sq: 'Te "Kutia hyrëse" kliko një njoftim: hapet faqja ku duhet të veprosh dhe njoftimi shënohet si i lexuar.', en: 'Under "Inbox" click a notification: the page where you need to act opens and it is marked as read.' },
      { sq: 'Zgjidh një kategori majtas, ose ndiz "Vetëm të palexuarat".', en: 'Choose a category on the left, or switch on "Unread only".' },
      { sq: '"Shëno të gjitha si të lexuara" i pastron të gjitha njëherësh.', en: '"Mark all as read" clears them all at once.' },
      { sq: 'Te "Çfarë merrni" fik kategoritë që s\'të duhen: në aplikacion, në telefon ose me email.', en: 'Under "What you receive" switch off the categories you do not need: in the app, on the phone or by email.' },
    ],
    mistakes: [
      { sq: 'Njoftimet e miratimeve në aplikacion nuk fiken: ato duhen gjithmonë.', en: 'Approval notifications in the app cannot be switched off: they are always needed.' },
      { sq: 'Kopjet me email nisin të vijnë vetëm pasi administratori lidh shërbimin e postës.', en: 'Email copies start arriving only once the administrator connects a mail service.' },
    ],
    related: [{ href: '/approvals', label: { sq: 'Për miratim', en: 'Approvals' } }],
  },

  /* ------------------------------------------------------------------ selling */
  '/sales/deliveries': {
    what: { sq: 'Dërgesat: malli që del nga njësia për klientët. Kur përfundon dërgesa, malli zbret nga stoku.', en: 'Deliveries: goods leaving the unit for customers. Completing a delivery takes the goods out of stock.' },
    steps: [
      { sq: 'Dërgesa krijohet nga porosia e konfirmuar me "Krijo dërgesën", ose nga "Porositë në pritje".', en: 'A delivery is created from a confirmed order with "Create delivery", or from the "Order desk".' },
      { sq: 'Hape dërgesën dhe kontrollo sasitë dhe raftin te "Merret nga"; shto "Numri i gjurmimit" ose "Shënime për shoferin" kur duhen.', en: 'Open the delivery and check the quantities and the shelf under "Pick from"; add a "Tracking number" or "Notes for the driver" when needed.' },
      { sq: 'Kur malli është përgatitur, mund ta shënosh "Gati për dërgim" (te butoni ⋯ i dërgesës).', en: 'When the goods are prepared you can mark it "Ready to ship" (under the delivery\'s ⋯ button).' },
      { sq: 'Kur malli niset, kliko "Përfundo dërgesën".', en: 'When the goods leave, click "Complete delivery".' },
    ],
    mistakes: [{ sq: 'Për të dërguar më pak se porosia, ul sasinë: pjesa tjetër mbetet e rezervuar në porosi për një dërgesë tjetër.', en: 'To send less than ordered, lower the quantity: the rest stays reserved on the order for a later delivery.' }],
    after: { sq: 'Stoku zbret, rezervimet e porosisë përdoren dhe kostoja e mallit regjistrohet në kontabilitet me koston mesatare. Fatura bëhet nga porosia.', en: 'Stock goes down, the order\'s reservations are used up and the cost of the goods is booked at average cost. The invoice is made from the order.' },
    related: [{ href: '/sales/orders', label: { sq: 'Porositë', en: 'Sales orders' } }, { href: '/oms/fulfillment', label: { sq: 'Porositë në pritje', en: 'Order desk' } }],
  },
  '/sales/recurring': {
    what: { sq: 'Faturat mujore: qiraja, abonimet, mirëmbajtja. Bëhen vetë çdo mëngjes në ditën e tyre.', en: 'Recurring invoices: rent, subscriptions, maintenance. They are made by themselves every morning on their day.' },
    steps: [
      { sq: 'Për të filluar, hap një faturë që përsëritet çdo muaj dhe kliko "Përsërit".', en: 'To start one, open an invoice that comes back every month and click "Repeat".' },
      { sq: 'Zgjidh "Sa shpesh" (çdo muaj, çdo 2, 3, 6 muaj ose çdo vit) dhe "Në ditën" (1–28).', en: 'Choose "How often" (every month, every 2, 3, 6 months or every year) and "On day" (1–28).' },
      { sq: 'Ndiz "Postoji menjëherë" që të kontabilizohen vetë; përndryshe çdo faturë pret si skicë që ta kontrollosh.', en: 'Switch on "Post them straight away" to have them posted by themselves; otherwise each one waits as a draft for you to check.' },
      { sq: 'Këtu, me "Ndrysho" ndërron datën e radhës ose fundin; me butonin e pauzës e ndal përkohësisht.', en: 'Here, "Edit" changes the next date or the end; the pause button stops it for a while.' },
    ],
    mistakes: [
      { sq: 'Rreshtat vijnë nga fatura e parë: për t\'i ndryshuar, bëj faturë të re, përsërite atë dhe hiq planin e vjetër.', en: 'The lines come from the first invoice: to change them, make a new invoice, repeat it and remove the old plan.' },
      { sq: 'Shkruaj {period} në tekstin e rreshtit, p.sh. "Qiraja {period}", që në çdo faturë të dalë muaji.', en: 'Write {period} in the line text, e.g. "Rent {period}", so each invoice shows its month.' },
    ],
    after: { sq: 'Çdo faturë e bërë del te Faturat; kur kontabilizohet, shkon te Borxhet dhe në librin e shitjeve. Nëse një faturë nuk bëhet dot, arsyeja del te kolona "Tjetra".', en: 'Each invoice made shows under Invoices; once posted it goes to Debts and the sales book. If one cannot be made, the reason shows in the "Next" column.' },
    related: [{ href: '/sales/invoices', label: { sq: 'Faturat', en: 'Invoices' } }],
  },
  '/oms/fulfillment': {
    what: { sq: 'Çdo rresht i porosive të hapura: sa është rezervuar, sa ka të lirë dhe sa po vjen. Këtu rezervon, dërgon dhe porosit atë që mungon.', en: 'Every open order line: what is reserved, free and on the way. Reserve, ship and order what is missing from here.' },
    steps: [
      { sq: 'Zgjidh njësinë lart, ose lëre "Të gjitha njësitë".', en: 'Choose the unit on top, or leave "All warehouses".' },
      { sq: 'Kliko një kartelë lart (p.sh. "Mund të rezervohet" ose "Mungesë") për të parë vetëm ato rreshta.', en: 'Click a card on top (e.g. "Can reserve" or "Short") to see only those lines.' },
      { sq: 'Te porosia kliko "Rezervo" për të zënë mallin e lirë; kur gjithçka është gati, "Krijo dërgesën" (ose "Dërgo të rezervuarat" për pjesën që ka).', en: 'On the order click "Reserve" to take the free stock; when everything is ready, "Create delivery" (or "Deliver reserved" for the part there is).' },
      { sq: 'Për rreshtat me "Mungesë" kliko "Planifiko rifurnizimin" dhe porosite te furnitori.', en: 'For "Short" lines click "Plan replenishment" and order from the vendor.' },
    ],
    mistakes: [{ sq: '"Stoku i lirë" me të kuqe do të thotë që është rezervuar më shumë se sa ka fizikisht: kontrollo stokun.', en: '"Free stock" in red means more is reserved than is on hand: check the stock.' }],
    after: { sq: 'Rezervimi e mban mallin vetëm për këtë porosi; "Krijo dërgesën" hap një dërgesë skicë, dhe stoku zbret kur ajo përfundon.', en: 'Reserving keeps the goods for this order only; "Create delivery" opens a draft delivery, and stock goes down when it is completed.' },
    related: [{ href: '/sales/deliveries', label: { sq: 'Dërgesat', en: 'Deliveries' } }, { href: '/procurement/replenishment', label: { sq: 'Çka duhet porositur', en: 'Replenishment' } }],
    tour: [
      { target: 'Reserve', say: { sq: 'Zë mallin e lirë për këtë porosi.', en: 'Take the free stock for this order.' } },
      { target: 'Create delivery', say: { sq: 'Kur porosia është gati, bëj dërgesën.', en: 'When the order is ready, make the delivery.' } },
      { target: 'Plan replenishment', say: { sq: 'Për atë që mungon, shko te rifurnizimi.', en: 'For what is short, go to replenishment.' } },
    ],
  },
  '/sales/price-lists': {
    what: { sq: 'Listat e çmimeve: çmime shumicë, pakicë ose për një kanal, edhe sipas sasisë. Klienti me listë i merr vetë çmimet e duhura.', en: 'Price lists: wholesale, retail or channel prices, also by quantity. A customer with a list gets the right prices automatically.' },
    steps: [
      { sq: 'Kliko "Listë e re çmimesh", jepi emër (p.sh. Shumicë) dhe zgjidh monedhën.', en: 'Click "New price list", give it a name (e.g. Wholesale) and choose the currency.' },
      { sq: 'Kliko "Shto çmim", zgjidh artikullin dhe shkruaj çmimin; "Zbritja %" është me dëshirë.', en: 'Click "Add price", choose the item and type the price; "Discount %" is optional.' },
      { sq: 'Për çmim më të lirë në sasi të madhe, shto të njëjtin artikull edhe një herë me "Nga sasia" më të madhe.', en: 'For a lower price on bigger quantities, add the same item again with a higher "From qty".' },
      { sq: 'Lidhe listën me klientin te kartela e tij; "Lista e parazgjedhur" vlen për klientët pa listë.', en: 'Give the list to the customer on their card; the "Default list" is for customers without one.' },
    ],
    mistakes: [
      { sq: 'Shiko kolonën "Marzhi": nën 10% del me të kuqe, që të mos shesësh nën kosto pa e ditur.', en: 'Watch the "Margin" column: under 10% shows red, so you do not sell below cost without knowing.' },
      { sq: 'Ndiz "Çmimet përfshijnë TVSH" vetëm për listat e pakicës, ku çmimi në raft është përfundimtar.', en: 'Switch on "Prices include VAT" only for retail lists, where the shelf price is final.' },
    ],
    after: { sq: 'Dokumentet e reja të shitjes e marrin çmimin nga lista; ato të bëra më parë i mbajnë çmimet e tyre.', en: 'New sales documents take their prices from the list; ones made earlier keep their prices.' },
    related: [{ href: '/partners?role=customer', label: { sq: 'Klientët', en: 'Customers' } }, { href: '/sales/promotions', label: { sq: 'Promocionet', en: 'Promotions' } }],
  },
  '/sales/promotions': {
    what: { sq: 'Promocionet: zbritje për një kohë, me përqindje, me çmim të veçantë ose "3 me 2". Arka i zbaton vetë.', en: 'Promotions: discounts for a time, as a percentage, a special price or "3 for 2". The till applies them by itself.' },
    steps: [
      { sq: 'Kliko "Promocion i ri" dhe zgjidh llojin: "% zbritje", "Çmim i veçantë" ose "Bli disa, merr disa falas".', en: 'Click "New promotion" and choose the kind: "% off", "A special price" or "Buy some, get some free".' },
      { sq: 'Te "Artikuj" shto artikujt ose kategoritë; nëse s\'zgjedh asnjë, vlen për çdo artikull.', en: 'Under "Items" add the items or categories; if you choose none, it applies to every item.' },
      { sq: 'Cakto datat, orët dhe ditët e javës (p.sh. vetëm të shtunën, nga ora 17 deri 19).', en: 'Set the dates, the hours and the days of the week (e.g. only Saturday, from 5 to 7 pm).' },
      { sq: 'Te "Ku" zgjidh "Në arkë" dhe/ose "Në dokumentet e shitjes", pastaj kliko "Ruaj".', en: 'Under "Where" tick "On the till" and/or "On sales documents", then click "Save".' },
      { sq: 'Te "Rezultatet" sheh sa zbritje u dha dhe sa u shit me secilin promocion.', en: 'Under "Results" see how much discount was given and how much was sold with each promotion.' },
    ],
    mistakes: [{ sq: 'Për ta ndalur para kohe, hape promocionin dhe fik "Aktiv".', en: 'To stop it early, open the promotion and switch off "Active".' }],
    after: { sq: 'Arka e llogarit zbritjen vetë në kupon; dokumentet e shitjes e marrin si zbritje në rresht. Rezultatet llogariten nga kuponat e arkës.', en: 'The till works out the discount on the receipt by itself; sales documents take it as the line discount. Results are counted from the till receipts.' },
    related: [{ href: '/pos/loyalty', label: { sq: 'Kartat e zbritjes', en: 'Loyalty cards' } }, { href: '/sales/price-lists', label: { sq: 'Listat e çmimeve', en: 'Price lists' } }],
  },
  '/crm/leads': {
    what: { sq: 'Kontaktet: njerëz dhe firma që treguan interes. I kontrollon, pastaj i kthen në klient dhe në mundësi shitjeje.', en: 'Leads: people and companies who showed interest. Check them, then turn them into a customer and a deal.' },
    steps: [
      { sq: 'Kliko "Kontakt i ri" dhe shkruaj për çfarë janë të interesuar, personin, telefonin dhe burimin.', en: 'Click "New lead" and type what they are interested in, the contact person, the phone and the source.' },
      { sq: 'Pasi të flasësh me ta, kliko "Kontaktuar"; kur sheh që janë blerës të vërtetë, "I kualifikuar".', en: 'Once you have spoken to them, click "Contacted"; when you see they are real buyers, "Qualified".' },
      { sq: 'Kliko "Konverto" dhe zgjidh "Krijo klient të ri" ose "Lidhe me një klient ekzistues".', en: 'Click "Convert" and choose "Create a new customer" or "Link to an existing customer".' },
      { sq: 'Nëse s\'kanë interes, kliko "Nuk është i interesuar"; me "Rihap" e kthen prapë.', en: 'If they are not interested, click "Not interested"; "Reopen" brings it back.' },
    ],
    after: { sq: 'Konvertimi krijon një mundësi shitjeje në fazën e parë te Marrëveshjet, të lidhur me klientin.', en: 'Converting creates a deal in the first stage of the Pipeline, linked to the customer.' },
    related: [{ href: '/crm/pipeline', label: { sq: 'Marrëveshjet', en: 'Pipeline' } }],
  },
  '/crm/pipeline': {
    what: { sq: 'Marrëveshjet: mundësitë e shitjes që janë në punë, të ndara sipas fazave.', en: 'Pipeline: the deals in progress, by stage.' },
    steps: [
      { sq: 'Kliko "Mundësi e re shitjeje", ose konverto një kontakt.', en: 'Click "New deal", or convert a lead.' },
      { sq: 'Tërhiqe kartelën nga një fazë te tjetra sa ecën bisedimi.', en: 'Drag the card from one stage to the next as the talks move on.' },
      { sq: 'Hape mundësinë dhe kliko "Ofertë e re" për t\'i dërguar klientit ofertë.', en: 'Open the deal and click "New quote" to send the customer an offer.' },
      { sq: 'Në fund kliko "Fituar" ose "Humbur"; për të humburën zgjidh arsyen.', en: 'At the end click "Won" or "Lost"; for a lost one, choose the reason.' },
      { sq: '"Mundësitë e mia" tregon vetëm tuat; "Lista" i shfaq si tabelë.', en: '"My deals" shows only yours; "List" shows them as a table.' },
    ],
    after: { sq: 'Kur oferta e mundësisë kthehet në porosi, mundësia shënohet vetë si e fituar. Arsyet e humbjes dalin te raportet.', en: 'When the deal\'s quote becomes an order, the deal is marked as won by itself. Lost reasons show in the reports.' },
    related: [{ href: '/crm/leads', label: { sq: 'Kontaktet', en: 'Leads' } }, { href: '/sales/quotes', label: { sq: 'Ofertat', en: 'Quotes' } }],
  },

  /* ------------------------------------------------------------------ in the field and online */
  '/agent': {
    what: { sq: 'Aplikacioni i agjentit në telefon: rruga e ditës, porositë dhe arkëtimet te klienti, edhe pa internet.', en: 'The agent\'s phone app: the day\'s route, orders and collections at the customer, also without internet.' },
    steps: [
      { sq: 'Shiko rrugën e sotme dhe kliko klientin që po viziton (ose përdor "Kërko klientin").', en: 'Look at today\'s route and click the customer you are visiting (or use "Search a customer").' },
      { sq: 'Kliko "Porosi e re", shto artikujt, pastaj "Shiko dhe dërgo" dhe "Dërgo porosinë".', en: 'Click "New order", add the items, then "Review and send" and "Send the order".' },
      { sq: 'Kur klienti paguan, kliko "Arkëto", shkruaj shumën dhe ruaje; pastaj "Dërgo mandatin në WhatsApp".', en: 'When the customer pays, click "Collect", type the amount and save it; then "Send the receipt on WhatsApp".' },
      { sq: 'Nëse s\'ka porosi, ruaje si "Vizitë pa porosi" me një shënim.', en: 'If there is no order, save a "Visit without an order" with a note.' },
    ],
    mistakes: [
      { sq: 'Pa internet vazhdo punën: çdo gjë ruhet në telefon dhe dërgohet vetë kur kthehet interneti.', en: 'Without internet keep working: everything is kept on the phone and sent by itself when the internet is back.' },
      { sq: 'Nëse s\'je caktuar si agjent ose s\'ke çantë parash, menaxheri të cakton te Agjentët.', en: 'If you are not set up as an agent or have no cash bag, the manager sets you up under Field agents.' },
    ],
    after: { sq: 'Porosia bëhet porosi shitjeje dhe konfirmohet vetë; zbritja e madhe ose klienti mbi kufirin e kredisë presin menaxherin. Paratë hyjnë në çantën tënde dhe mbyllin faturat më të vjetra të klientit.', en: 'The order becomes a sales order and is confirmed by itself; a big discount or a customer over the credit limit waits for the manager. The cash goes into your bag and settles the customer\'s oldest invoices.' },
  },
  '/sales/agents': {
    what: { sq: 'Agjentët në terren: dita e tyre (vizitat, porositë, paratë) dhe rrugët që bëjnë.', en: 'Field agents: their day (visits, orders, cash) and the routes they follow.' },
    steps: [
      { sq: 'Te "Agjentët dhe rrugët" kliko "Cakto agjent": zgjidh anëtarin, njësinë nga shet dhe çantën e parave.', en: 'Under "Agents and routes" click "Set up an agent": choose the member, the unit they sell from and the cash bag.' },
      { sq: 'Kliko "Rruga" te agjenti, shto me radhë klientët për çdo ditë të javës dhe kliko "Ruaj rrugën".', en: 'Click "Route" on the agent, add the customers in order for each weekday and click "Save the route".' },
      { sq: 'Te "Dita" zgjidh datën: sheh çdo vizitë, porosi dhe arkëtim, me vendin në hartë.', en: 'Under "The day" choose the date: see every visit, order and collection, with the place on the map.' },
      { sq: 'Porositë me "Pret ju" presin vendimin tënd: hapi dhe konfirmoji.', en: 'Orders marked "Waits for you" wait for your decision: open and confirm them.' },
    ],
    mistakes: [
      { sq: 'Paratë e arkëtuara mbeten në çantën e agjentit derisa t\'i dorëzojë: merri në sefin e njësisë te faqja Sefi.', en: 'Collected cash stays in the agent\'s bag until they hand it in: take it into the shop safe on the Safe page.' },
      { sq: 'Vizita e regjistruar larg vendndodhjes së klientit del me ngjyrë portokalli: kontrolloje.', en: 'A visit recorded far from the customer\'s shop shows in orange: check it.' },
    ],
    related: [{ href: '/agent', label: { sq: 'Agjenti', en: 'Agent app' } }, { href: '/safe', label: { sq: 'Sefi', en: 'Safe' } }],
  },
  '/ecommerce': {
    what: { sq: 'Shitja online: faqet e shitjes online dhe tregjet online. Porositë e tyre vijnë këtu si porosi shitjeje dhe stoku u kthehet atyre.', en: 'Web shop: online stores and marketplaces. Their orders arrive here as sales orders and stock levels go back to them.' },
    steps: [
      { sq: 'Kliko "Shto kanal", zgjidh platformën (Shopify, WooCommerce…), adresën e faqes online dhe njësinë nga niset malli.', en: 'Click "Add channel", choose the platform (Shopify, WooCommerce…), the store address and the unit it ships from.' },
      { sq: 'Hape kanalin dhe kliko "Lidh të gjitha sipas kodit", që artikujt të përputhen me ato të faqes online.', en: 'Open the channel and click "Link all by SKU" so the items line up with the shop\'s.' },
      { sq: 'Te "Cilësimet" zgjidh listën e çmimeve, klientin për porositë pa email dhe çka sinkronizohet; kliko "Ruaj cilësimet".', en: 'Under "Settings" choose the price list, the customer for orders without an email and what is synced; click "Save settings".' },
      { sq: 'Me "Dërgo një porosi prove" e provon importin para se të nisë faqja online e vërtetë.', en: 'With "Send a test order" try the import before the real shop starts.' },
    ],
    mistakes: [{ sq: 'Porosia që dështon e mban arsyen (p.sh. artikull i palidhur): rregulloje dhe kliko "Provo përsëri".', en: 'A failed order keeps its reason (e.g. an unlinked item): fix it and click "Retry".' }],
    after: { sq: 'Çdo porosi importohet vetëm një herë, si porosi shitjeje; gjendja e lirë e artikujve të lidhur i dërgohet faqes online ("Sinkronizo stokun tani" e bën menjëherë).', en: 'Each order is imported only once, as a sales order; the available stock of linked items is sent to the shop ("Sync stock now" does it at once).' },
    related: [{ href: '/sales/orders', label: { sq: 'Porositë', en: 'Sales orders' } }],
  },

  /* ------------------------------------------------------------------ the till extras */
  '/pos/loyalty': {
    what: { sq: 'Kartat e zbritjes: zbritje ose pikë për klientët, në çdo njësi të kompanisë. Arka i zbaton vetë.', en: 'Loyalty cards: a discount or points for customers, in every store of the company. The till applies them by itself.' },
    steps: [
      { sq: 'Te "Llojet e kartelave" kliko "Lloj i ri kartele" dhe zgjidh çfarë jep: zbritje, pikë ose zbritje për punëtorë.', en: 'Under "Types of card" click "New type of card" and choose what it gives: a discount, points or a staff discount.' },
      { sq: 'Te "Kartelat" kliko "Kartelë e re", zgjidh llojin, shkruaj emrin dhe telefonin e klientit dhe kliko "Krijo kartelën".', en: 'Under "Cards" click "New card", choose the type, type the customer\'s name and phone and click "Make the card".' },
      { sq: 'Lëre bosh "Numri i kartelës" që ta bëjë programi, ose skano kartelën plastike që ke.', en: 'Leave "Card number" empty for the program to make one, or scan a plastic card you have.' },
      { sq: 'Kliko "Printo kartelën" për barkodin; te "Raporti" sheh zbritjet e dhëna dhe klientët më të mirë.', en: 'Click "Print card" for the barcode; under "Report" see the discounts given and the best customers.' },
    ],
    mistakes: [
      { sq: 'Kartelën e humbur hape dhe kliko "Blloko", që të mos e përdorë dikush tjetër.', en: 'For a lost card, open it and click "Block" so nobody else uses it.' },
      { sq: 'Te "Jo për këto kategori" hiq p.sh. cigaret ose mallin që është tashmë në ofertë.', en: 'Under "Not for these categories" leave out e.g. cigarettes or goods already on offer.' },
    ],
    after: { sq: 'Kur skanohet kartela në arkë, zbritja ose pikët llogariten vetë; arkëtari nuk jep dot zbritje kartele me dorë.', en: 'When the card is scanned at the till, the discount or points are worked out by themselves; the cashier cannot give a card discount by hand.' },
    related: [{ href: '/pos', label: { sq: 'Arka', en: 'Point of sale' } }, { href: '/sales/promotions', label: { sq: 'Promocionet', en: 'Promotions' } }],
  },
  '/pos/waiters': {
    what: { sq: 'Kamarierët: llogaritë, tavolinat, mysafirët dhe xhiroja e secilit, me zbritjet dhe artikujt e anuluar pasi shkuan në kuzhinë.', en: 'Waiters: bills, tables, guests and takings for each one, with the discounts and the items cancelled after they reached the kitchen.' },
    steps: [
      { sq: 'Zgjidh periudhën ("Sot", "Dje", "Këtë javë", "Këtë muaj") ose shkruaj datat te "Nga" dhe "Deri".', en: 'Choose the period ("Today", "Yesterday", "This week", "This month") or type the dates under "From" and "To".' },
      { sq: 'Zgjidh njësinë, ose lëre "Të gjitha njësitë".', en: 'Choose the store, or leave "All stores".' },
      { sq: 'Krahaso kamarierët: xhiron për mysafir, zbritjet dhe kohën mesatare në tavolinë.', en: 'Compare the waiters: takings per guest, discounts and the average table time.' },
    ],
    mistakes: [
      { sq: 'Dalin vetëm llogaritë e paguara në tavolina nga ekrani i sallës, jo shitjet e zakonshme në arkë.', en: 'Only bills paid at tables on the floor screen show up, not ordinary till sales.' },
      { sq: 'Shiko kolonën "Anuluar pas dërgimit": anulimet e shpeshta pasi porosia shkoi në kuzhinë duan sqarim.', en: 'Watch the "Cancelled after sending" column: frequent cancellations after the order reached the kitchen need explaining.' },
    ],
  },

  /* ------------------------------------------------------------------ buying */
  '/procurement/orders': {
    what: { sq: 'Porositë e blerjes: çka ke porositur te furnitorët. Porositë e miratuara llogariten si mall në ardhje derisa të pranohen.', en: 'Purchase orders: what you have ordered from vendors. Approved orders count as incoming stock until they are received.' },
    steps: [
      { sq: 'Kliko "Porosi e re blerjeje", ose bëje nga "Çka duhet porositur" ose nga një kërkesë blerjeje e miratuar.', en: 'Click "New purchase order", or make it from Replenishment or from an approved requisition.' },
      { sq: 'Filtro sipas statusit, furnitorit ose faturimit; data e pritshme që ka kaluar del si e vonuar.', en: 'Filter by status, vendor or billing; an expected date that has passed shows as late.' },
      { sq: 'Kliko një porosi për ta dërguar, për të pranuar mallin ose për të regjistruar faturën.', en: 'Click an order to send it, receive the goods or enter the bill.' },
    ],
    related: [{ href: '/procurement/replenishment', label: { sq: 'Çka duhet porositur', en: 'Replenishment' } }, { href: '/procurement/vendor-prices', label: { sq: 'Çmimet e furnitorëve', en: 'Vendor prices' } }],
  },
  '/procurement/orders/:id': {
    what: { sq: 'Një porosi blerjeje: furnitori, artikujt, kur pritet malli dhe ku dorëzohet.', en: 'One purchase order: the vendor, the items, when the goods are expected and where they go.' },
    steps: [
      { sq: 'Zgjidh furnitorin, "Dorëzimi i pritur" dhe njësinë te "Dorëzo në".', en: 'Choose the vendor, the "Expected delivery" and the unit under "Deliver to".' },
      { sq: 'Shto rreshtat: çmimi vjen nga çmimet e furnitorit, nga çmimi i fundit i paguar ose nga kostoja mesatare.', en: 'Add the lines: the price comes from the vendor\'s prices, the last price paid or the average cost.' },
      { sq: 'Kliko "Dërgo": porosia kontrollohet dhe miratohet, ose shkon te miratuesi kur shuma e kërkon.', en: 'Click "Submit": the order is checked and approved, or goes to the approver when the amount needs it.' },
      { sq: 'Dërgoja furnitorit me "Dërgo me e-mail" (te shigjeta pranë "Printo"): porosia shënohet vetë si e dërguar (kur e dërgon ndryshe, "Shëno si të dërguar" është te butoni ⋯). Kur vjen malli, kliko "Prano mallin".', en: 'Send it to the vendor with "Send by email" (the arrow next to "Print"): the order is marked sent by itself (when you send it another way, "Mark as sent" is under the ⋯ button). When the goods arrive, click "Receive goods".' },
      { sq: 'Kur vjen fatura, kliko "Regjistro faturën": krahasohet me porosinë dhe me mallin e pranuar.', en: 'When the bill comes, click "Enter bill": it is checked against the order and the goods received.' },
    ],
    mistakes: [
      { sq: 'Pas "Dërgo" rreshtat nuk ndryshohen; nëse pret ende miratim, kliko "Tërhiq" që të kthehet në skicë.', en: 'After "Submit" the lines cannot change; while it still waits for approval, click "Withdraw" to get it back as a draft.' },
      { sq: 'Nëse pjesa tjetër e mallit nuk do të vijë, kliko "Mbyll porosinë" te butoni ⋯, që të mos llogaritet më si mall në ardhje. Aty janë edhe "Furnitori konfirmoi", "Porosit sërish pjesën që mungon" dhe "Anulo porosinë".', en: 'If the rest of the goods will not come, click "Close order" under the ⋯ button so it no longer counts as incoming stock. "Vendor confirmed", "Order the rest again" and "Cancel order" are there too.' },
    ],
    after: { sq: 'Porosia e miratuar del si mall në ardhje te stoku dhe te rifurnizimi. "Prano mallin" hap një pranim skicë; malli hyn në stok kur e konfirmon.', en: 'An approved order shows as incoming stock and in replenishment. "Receive goods" opens a draft receipt; the goods enter stock when you confirm it.' },
    related: [{ href: '/procurement/vendor-prices', label: { sq: 'Çmimet e furnitorëve', en: 'Vendor prices' } }, { href: '/procurement/bills', label: { sq: 'Faturat e blerjes', en: 'Vendor bills' } }],
    tour: [
      { target: 'Vendor', say: { sq: 'Fillo me furnitorin.', en: 'Start with the vendor.' } },
      { target: 'Expected delivery', say: { sq: 'Kur e pret mallin: pas kësaj date porosia del e vonuar.', en: 'When you expect the goods: after this date the order shows as late.' } },
      { target: 'Submit', say: { sq: 'Dërgoje për miratim; pas kësaj rreshtat nuk ndryshohen.', en: 'Submit it for approval; after that the lines cannot change.' } },
      { target: 'Receive goods', say: { sq: 'Kur vjen malli, prano këtu.', en: 'When the goods arrive, receive them here.' } },
    ],
  },
  '/inventory/read-invoice': {
    what: { sq: 'Fatura nga fotoja: fotografo faturën e furnitorit ose zgjidh PDF-në; programi lexon furnitorin dhe rreshtat dhe gjen artikujt e tu.', en: 'Invoice from a photo: photograph the vendor\'s invoice or choose its PDF; the program reads the vendor and the lines and finds your items.' },
    steps: [
      { sq: 'Kliko "Bëj një foto" ose "Zgjidh një skedar"; leximi zgjat rreth gjysmë minute.', en: 'Click "Take a photo" or "Choose a file"; reading takes about half a minute.' },
      { sq: 'Kontrollo furnitorin, numrin e faturës, datën dhe njësinë ku hyn malli.', en: 'Check the vendor, the invoice number, the date and the unit the goods go into.' },
      { sq: 'Në çdo rresht kontrollo artikullin që gjeti programi, sasinë dhe koston pa TVSH; rreshtit që s\'e pranon hiqja shenjën.', en: 'On each line check the item the program found, the quantity and the cost without VAT; untick a line you do not receive.' },
      { sq: 'Kliko "Bëje faturë blerjeje" dhe kontrolloje faturën para postimit; ose "Vetëm mallin, fatura më vonë" për pranim pa faturë.', en: 'Click "Make the purchase invoice" and check it before posting; or "Only the goods, the invoice later" for a receipt without the invoice.' },
      { sq: 'Pas leximit, "Bëje faturë blerjeje" e hap faturën e blerjes të plotësuar (furnitori, numri, data, rreshtat); kur e postoni, hyn edhe malli. "Vetëm mallin" bën vetëm pranimin, fatura vjen më vonë.', en: 'After reading, "Make the purchase invoice" opens the purchase invoice filled in (supplier, number, date, lines); posting it also brings the goods in. "Only the goods" makes just the receipt; the invoice comes later.' },
    ],
    mistakes: [
      { sq: 'Fotografo gjithë faqen, drejt dhe me dritë; PDF-ja nga furnitori lexohet më mirë.', en: 'Photograph the whole page, flat and with light; a PDF from the vendor reads best.' },
      { sq: 'Ka një numër faturash në muaj që lexohen; kur mbarojnë, prano mallin me dorë deri më 1 të muajit.', en: 'There is a monthly number of invoices that can be read; when they run out, receive goods by hand until the 1st.' },
    ],
    after: { sq: 'Krijohet një pranim malli skicë; malli hyn në stok vetëm kur ti e kontabilizon pranimin.', en: 'A draft goods receipt is made; the goods enter stock only when you post the receipt.' },
    related: [{ href: '/inventory/receipts', label: { sq: 'Pranimet', en: 'Goods receipts' } }, { href: '/procurement/invoice/new', label: { sq: 'Faturë blerje', en: 'Purchase invoice with goods' } }],
    tour: [
      { target: 'Take a photo', say: { sq: 'Fotografo faturën, ose zgjidh skedarin pranë.', en: 'Photograph the invoice, or choose the file next to it.' } },
      { target: 'Make the purchase invoice', say: { sq: 'Pasi kontrollon rreshtat, bëje faturën e blerjes.', en: 'Once the lines are checked, make the purchase invoice.' } },
    ],
  },
  '/inventory/landed-costs': {
    what: { sq: 'Dogana dhe transporti: kostot e transportit, doganës dhe sigurimit që i shtohen kostos së mallit të pranuar, zakonisht pas zhdoganimit.', en: 'Landed costs: transport, customs and insurance added to the cost of received goods, usually after customs clearance.' },
    steps: [
      { sq: 'Kliko "Kosto e re mbërritjeje", ose "Shto koston e mbërritjes" te pranimi i mallit.', en: 'Click "New landed cost", or "Add landed cost" on the goods receipt.' },
      { sq: 'Te "Kostot" kliko "Shto kosto" për çdo shpenzim (transport, taksë doganore…), pa TVSH.', en: 'Under "Charges" click "Add charge" for each cost (freight, customs duty…), without VAT.' },
      { sq: 'Zgjidh pranimet ku zbatohet kostoja dhe si ndahet te "Shpërnda sipas" (vlerës, sasisë, peshës…).', en: 'Choose the receipts the cost applies to and how it is split under "Split by" (value, quantity, weight…).' },
      { sq: 'Për import plotëso "Deklarata doganore": numrin e DUD-it dhe TVSH-në e paguar në kufi.', en: 'For an import fill in "Customs declaration": the DUD number and the VAT paid at the border.' },
      { sq: 'Kliko "Shpërnda dhe regjistro".', en: 'Click "Spread and record".' },
    ],
    mistakes: [{ sq: 'Pranimi i mallit duhet të jetë i kontabilizuar para se t\'i shtosh koston.', en: 'The goods receipt must be posted before you add its cost.' }],
    after: { sq: 'Pjesa për mallin që është ende në stok rrit koston mesatare; pjesa për mallin e shitur kalon në shpenzime. TVSH e importit shkon në librin e blerjeve, jo në vlerën e stokut.', en: 'The share for goods still in stock raises their average cost; the share for goods already sold is booked as an expense. Import VAT goes to the purchase book, not into the stock value.' },
    related: [{ href: '/inventory/receipts', label: { sq: 'Pranimet', en: 'Goods receipts' } }],
  },
  '/procurement/vendor-prices': {
    what: { sq: 'Çmimet e furnitorëve: sa kushton artikulli te secili furnitor, porosia minimale dhe koha e dorëzimit.', en: 'Vendor prices: what each vendor charges for an item, their minimum order and delivery time.' },
    steps: [
      { sq: 'Kliko "Shto çmim", zgjidh furnitorin dhe artikullin.', en: 'Click "Add price", choose the vendor and the item.' },
      { sq: 'Shkruaj çmimin pa TVSH, porosinë minimale dhe kohën e dorëzimit në ditë.', en: 'Type the price without VAT, the minimum order and the delivery time in days.' },
      { sq: 'Ndiz "Furnitori i preferuar" te furnitori nga i cili blen zakonisht atë artikull.', en: 'Switch on "Preferred vendor" for the vendor you usually buy that item from.' },
    ],
    mistakes: [{ sq: 'Një furnitor ka vetëm një çmim për artikull: ndrysho atë që ekziston, mos shto tjetër.', en: 'A vendor has only one price per item: edit the existing one rather than adding another.' }],
    after: { sq: 'Porositë e blerjes e marrin çmimin nga këtu; rifurnizimi zgjedh furnitorin e preferuar dhe respekton porosinë minimale.', en: 'Purchase orders take their price from here; replenishment picks the preferred vendor and respects the minimum order.' },
    related: [{ href: '/procurement/replenishment', label: { sq: 'Çka duhet porositur', en: 'Replenishment' } }],
  },
  '/procurement/replenishment': {
    what: { sq: 'Çka duhet porositur: artikujt që ranë te pika e riporositjes ose poshtë saj, me sasinë e propozuar deri te maksimumi.', en: 'Replenishment: items at or below their reorder point, with the suggested quantity up to the maximum.' },
    steps: [
      { sq: 'Kliko "Nis rifurnizimin" që programi të llogarisë çka mungon në të gjitha njësitë; ose "Kontrollo stokun tani" (te butoni ⋯) për njësinë e zgjedhur.', en: 'Click "Run replenishment" for the program to work out what is missing in all units; or "Check stock now" (under the ⋯ button) for the chosen unit.' },
      { sq: 'Kontrollo sasinë dhe furnitorin në çdo rresht; ndryshoji nëse duhet.', en: 'Check the quantity and the vendor on each line; change them if needed.' },
      { sq: 'Zgjidh rreshtat dhe kliko "Krijo dokumentet": secili rresht bëhet dokumenti që i duhet — porosi blerjeje (një për çdo furnitor), transfer nga njësia tjetër ose urdhër pune.', en: 'Tick the lines and click "Create documents": each line becomes the document it needs — a purchase order (one per vendor), a transfer from the other unit or a work order.' },
      { sq: 'Rreshtat që s\'të duhen hiqi me "Hidh poshtë".', en: 'Remove the lines you do not need with "Dismiss".' },
    ],
    mistakes: [{ sq: 'Pika e riporositjes (min/maks) caktohet për çdo artikull dhe njësi te faqja e produktit, ose me "Min dhe maks nga shitjet" (te butoni ⋯): pa të, artikulli nuk del këtu.', en: 'The reorder point (min/max) is set per item and unit on the product page, or with "Min and max from sales" (under the ⋯ button): without it the item does not show here.' }],
    after: { sq: 'Krijohen dokumente skicë; ti i kontrollon dhe i dërgon. Me "Rifurnizim automatik" kjo bëhet vetë çdo ditë.', en: 'Draft documents are made; you review and send them. With "Automatic replenishment" this happens every day by itself.' },
    related: [{ href: '/procurement/vendor-prices', label: { sq: 'Çmimet e furnitorëve', en: 'Vendor prices' } }, { href: '/procurement/orders', label: { sq: 'Porositë e blerjes', en: 'Purchase orders' } }],
    tour: [
      { target: 'Run replenishment', say: { sq: 'Fillo këtu: programi llogarit çka mungon në të gjitha njësitë.', en: 'Start here: the program works out what is missing in all units.' } },
      { target: 'More', say: { sq: 'Te ⋯: kontrollo stokun e kësaj njësie dhe min/maks nga shitjet.', en: 'Under ⋯: check this unit\'s stock and min/max from sales.' } },
      { target: 'Create documents', say: { sq: 'Zgjidh rreshtat dhe bëj të gjitha dokumentet njëherësh.', en: 'Tick the lines and make all the documents at once.' } },
    ],
  },
  '/procurement/requisitions': {
    what: { sq: 'Kërkesat për blerje: dikush kërkon diçka, blerjet e miratojnë dhe e porositin te furnitori i duhur.', en: 'Requisitions: someone asks for something, purchasing approves it and orders it from the right vendor.' },
    steps: [
      { sq: 'Kliko "Kërkesë e re blerjeje", zgjidh njësinë, "Duhet deri më" dhe shkruaj për çfarë duhet.', en: 'Click "New requisition", choose the unit, "Needed by" and write what it is for.' },
      { sq: 'Kliko "Shto artikull": zgjidh produktin nga katalogu ose përshkruaj çfarë duhet.', en: 'Click "Add item": choose a product from the catalogue or describe what is needed.' },
      { sq: 'Kliko "Dërgo për miratim"; blerjet njoftohen.', en: 'Click "Submit for approval"; purchasing is notified.' },
      { sq: 'Pas miratimit, blerjet klikojnë "Krijo porosi blerjeje": del një porosi skicë për çdo furnitor.', en: 'Once approved, purchasing clicks "Create purchase orders": one draft order per vendor.' },
    ],
    mistakes: [
      { sq: 'Kërkesën tënde nuk e miraton dot vetë.', en: 'You cannot approve your own requisition.' },
      { sq: 'Nëse refuzohet, lexo arsyen, kliko "Ndrysho përsëri" dhe dërgoje prapë.', en: 'If it is rejected, read the reason, click "Edit again" and submit it again.' },
    ],
    related: [{ href: '/procurement/orders', label: { sq: 'Porositë e blerjes', en: 'Purchase orders' } }, { href: '/approvals', label: { sq: 'Për miratim', en: 'Approvals' } }],
  },

  /* ------------------------------------------------------------------ one sales document */
  '/sales/quotes/:id': {
    what: { sq: 'Një ofertë për klientin: artikujt, çmimet dhe deri kur vlen.', en: 'One quote for a customer: the items, the prices and how long it is valid.' },
    steps: [
      { sq: 'Zgjidh klientin: çmimet vijnë nga lista e tij, ose zgjidh tjetër te "Lista e çmimeve".', en: 'Choose the customer: prices come from their list, or choose another under "Price list".' },
      { sq: 'Cakto "E vlefshme deri më" dhe shto rreshtat.', en: 'Set "Valid until" and add the lines.' },
      { sq: 'Te shigjeta e vogël pranë "Printo" kliko "Dërgo me e-mail": oferta shënohet vetë si e dërguar. Nëse e dërgon ndryshe, "Shëno si e dërguar pa e-mail" është te butoni ⋯.', en: 'From the small arrow next to "Print" click "Send by email": the quote is marked sent by itself. If you send it another way, "Mark as sent without e-mail" is under the ⋯ button.' },
      { sq: 'Kur klienti pranon, kliko "Krijo porosinë". Kur refuzon, "Klienti refuzoi" është te butoni ⋯.', en: 'When the customer accepts, click "Create order". When they say no, "Customer said no" is under the ⋯ button.' },
    ],
    mistakes: [
      { sq: 'Një ofertë e dërguar nuk ndryshohet: "Ndrysho përsëri" (te ⋯) e kthen në skicë.', en: 'A sent quote cannot be changed: "Edit again" (under ⋯) brings it back to draft.' },
    ],
    after: { sq: 'Oferta nuk prek as stokun as kontabilitetin. Pas 3 ditësh pa përgjigje, programi të jep detyrën "Telefono klientin"; kur kalon data, oferta skadon vetë.', en: 'A quote touches neither stock nor the books. After 3 days without an answer, the program gives you the task "Call the customer"; when the date passes, the quote expires by itself.' },
    tour: [
      { target: 'Customer', say: { sq: 'Fillo me klientin: çmimet e tij plotësohen vetë.', en: 'Start with the customer: their prices fill in by themselves.' } },
      { target: 'Valid until', say: { sq: 'Deri kur e mban ofertën.', en: 'How long you hold the offer.' } },
      { target: 'Lines', say: { sq: 'Shto artikujt këtu.', en: 'Add the items here.' } },
      { target: 'Create order', say: { sq: 'Kur klienti pranon, ktheje në porosi pa e shkruar përsëri.', en: 'When the customer accepts, turn it into an order without typing it again.' } },
      { target: 'More', say: { sq: 'Te ⋯: shëno si e dërguar pa e-mail, klienti refuzoi, ndrysho përsëri.', en: 'Under ⋯: mark sent without e-mail, customer said no, edit again.' } },
    ],
  },
  '/sales/orders/:id': {
    what: { sq: 'Një porosi klienti: artikujt, nga cila njësi dërgohen, dhe sa është dërguar e faturuar.', en: 'One customer order: the items, which unit they go from, and how much is delivered and invoiced.' },
    steps: [
      { sq: 'Zgjidh klientin dhe njësinë te "Dërgohet nga", pastaj shto rreshtat.', en: 'Choose the customer and the unit under "Send from", then add the lines.' },
      { sq: 'Kliko "Konfirmo porosinë": kontrollohen zbritjet dhe kredia e klientit, pastaj rezervohet malli.', en: 'Click "Confirm order": the discounts and the customer\'s credit are checked, then the goods are reserved.' },
      { sq: 'Kur malli niset, kliko "Krijo dërgesën".', en: 'When the goods leave, click "Create delivery".' },
      { sq: 'Kliko "Krijo faturën" për të faturuar; për pagesë para dërgimit përdor "Faturë paradhënieje".', en: 'Click "Create invoice" to invoice it; for a payment before delivery use "Advance invoice".' },
    ],
    mistakes: [
      { sq: 'Pas konfirmimit rreshtat nuk ndryshohen më.', en: 'After confirming, the lines can no longer change.' },
      { sq: 'Nëse pjesa tjetër s\'do të dërgohet, kliko "Mbyll porosinë" te butoni ⋯, që të lirohet malli i rezervuar. Aty janë edhe "Rezervo stokun" dhe "Anulo porosinë"; rezervimi bëhet edhe vetë çdo orë, kur vjen malli.', en: 'If the rest will not be delivered, click "Close order" under the ⋯ button to release the reserved stock. "Reserve stock" and "Cancel order" are there too; reservation also runs by itself every hour, as goods arrive.' },
    ],
    after: { sq: 'Malli i rezervuar nuk i shitet dot tjetërkujt; stoku zbret kur përfundon dërgesa, dhe borxhi i klientit lind me faturën. Kur kalohet kufiri i kredisë ose i zbritjes, porosia shkon për miratim.', en: 'Reserved goods cannot be sold to anyone else; stock goes down when the delivery is completed, and the customer\'s debt starts with the invoice. Over the credit or discount limit, the order goes for approval.' },
    related: [{ href: '/sales/deliveries', label: { sq: 'Dërgesat', en: 'Deliveries' } }, { href: '/oms/fulfillment', label: { sq: 'Porositë në pritje', en: 'Order desk' } }],
    tour: [
      { target: 'Customer', say: { sq: 'Fillo me klientin.', en: 'Start with the customer.' } },
      { target: 'Lines', say: { sq: 'Këtu shton artikujt: skano ose kërko.', en: 'Add the items here: scan or search.' } },
      { target: 'Confirm order', say: { sq: 'Konfirmo: malli rezervohet dhe rreshtat nuk ndryshohen më.', en: 'Confirm: the goods are reserved and the lines can no longer change.' } },
      { target: 'Create delivery', say: { sq: 'Kur malli niset, bëj dërgesën nga këtu.', en: 'When the goods leave, make the delivery from here.' } },
    ],
  },
}
