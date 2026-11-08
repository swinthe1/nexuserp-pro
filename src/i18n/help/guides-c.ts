import type { Guide } from './types'

/**
 * Taxes, accounting and the overview pages: what each one is for, in plain words.
 * Same format as guides.ts; keyed by the page's address, ":id" stands for one document.
 * Tour targets are the English text of a button, tab, heading or field label (shown translated).
 */
export const GUIDES_C: Record<string, Guide> = {
  /* ------------------------------------------------------------------ VAT and the tax office */
  '/tax/books': {
    what: { sq: 'Librat e TVSH-së: çdo dokument përfundimtar i muajit, në librin e shitjeve ose të blerjeve, në kolonat e deklaratës.', en: 'The VAT books: every final document of the month, in the sales or the purchase book, in the columns of the declaration.' },
    steps: [
      { sq: 'Zgjidh muajin lart djathtas.', en: 'Choose the month at the top right.' },
      { sq: 'Kalo mes librit të shitjeve dhe librit të blerjeve me skedat mbi tabelë.', en: 'Switch between the sales book and the purchase book with the tabs above the table.' },
      { sq: 'Kliko numrin e dokumentit për ta hapur faturën pas rreshtit.', en: 'Click a document number to open the invoice behind the line.' },
      { sq: 'Me "Eksporto" e merr librin në Excel, CSV ose PDF.', en: 'With "Export" you get the book in Excel, CSV or PDF.' },
    ],
    mistakes: [
      { sq: 'Faturat në skicë nuk dalin këtu: kontabilizoji para se të bësh deklaratën.', en: 'Draft invoices do not show here: post them before you make the declaration.' },
      { sq: 'Në Kosovë, notat e kreditit që lëshon ti shkojnë në librin e blerjeve dhe ato që merr në librin e shitjeve, si në deklaratën e ATK-së.', en: 'In Kosovo, credit notes you issue go in the purchase book and those you receive go in the sales book, as on the ATK return.' },
    ],
    after: { sq: 'Nga këta libra plotësohet deklarata e TVSH-së e muajit.', en: 'The month\'s VAT declaration is filled from these books.' },
    related: [{ href: '/tax/declarations', label: { sq: 'Deklaratat e TVSH', en: 'VAT declarations' } }, { href: '/tax', label: { sq: 'Afatet e tatimeve', en: 'Tax overview' } }],
  },
  '/tax/declarations': {
    what: { sq: 'Deklaratat mujore të TVSH-së, të plotësuara nga librat e shitjeve dhe blerjeve.', en: 'The monthly VAT declarations, filled from the sales and purchase books.' },
    steps: [
      { sq: 'Kliko "Deklaratë e re", zgjidh muajin dhe kliko "Krijo deklaratën".', en: 'Click "New declaration", choose the month and click "Create declaration".' },
      { sq: 'Deklarata krijohet si skicë dhe hapet: kontrolloje para se ta dorëzosh.', en: 'The declaration is created as a draft and opens: check it before you submit it.' },
      { sq: 'Filtro sipas statusit për të parë cilat janë ende skicë dhe cilat janë dorëzuar.', en: 'Filter by status to see which are still drafts and which are submitted.' },
    ],
    mistakes: [{ sq: 'Programi propozon muajin e kaluar: kontrollo që ke zgjedhur muajin e duhur.', en: 'The program suggests last month: check that you chose the right month.' }],
    after: { sq: 'Kur dorëzohet, deklarata regjistrohet në kontabilitet dhe muaji mbyllet për TVSH.', en: 'When it is submitted, the declaration is booked and the month is closed for VAT.' },
    related: [{ href: '/tax/books', label: { sq: 'Librat e TVSH-së', en: 'VAT books' } }, { href: '/tax', label: { sq: 'Afatet e tatimeve', en: 'Tax overview' } }],
  },
  '/tax/declarations/:id': {
    what: { sq: 'Një deklaratë TVSH-je: fushat e formularit, rezultati i muajit dhe dorëzimi.', en: 'One VAT declaration: the fields of the form, the result of the month and the filing.' },
    steps: [
      { sq: 'Kontrollo shifrat e formularit; me "Librat" (te butoni ⋯) sheh dokumentet pas tyre. Drafti i muajit të kaluar bëhet vetë në ditët 1–3 të muajit.', en: 'Check the figures of the form; with "Books" (under the ⋯ button) you see the documents behind them. Last month\'s draft is made by itself on days 1–3 of the month.' },
      { sq: 'Nëse ke shtuar ose ndryshuar fatura të këtij muaji, kliko "Rillogarit" te butoni ⋯.', en: 'If you added or changed invoices of this month, click "Recalculate" under the ⋯ button.' },
      { sq: 'Shiko "Kontrolli me kontabilitetin": TVSH-ja e librave duhet të përputhet me kontabilitetin.', en: 'Look at "Accounting check": the VAT in the books should match accounting.' },
      { sq: 'Nëse ke kredi dhe kërkon rimbursim, shkruaj shumën te "Rimbursimi që kërkohet" dhe kliko "Zbato".', en: 'If you have a credit and ask for a refund, type the amount under "Refund to request" and click "Apply".' },
      { sq: 'Deklaroje te ATK-ja (DPT në Shqipëri), pastaj kliko "Dorëzo deklaratën" dhe shkruaj numrin te "Referenca e dorëzimit".', en: 'File it with the ATK (DPT in Albania), then click "Submit declaration" and type the number under "Filing reference".' },
      { sq: 'Një faturë erdhi vonë për një muaj të deklaruar? Te ⋯ zgjidh "Deklaratë korrigjuese": muaji pranon sërish dokumente, deklarata e re tregon diferencën dhe me dorëzimin kontabilizohet vetëm diferenca.', en: 'An invoice came late for a declared month? Under ⋯ choose "Corrective declaration": the month takes documents again, the new declaration shows the difference and submitting it books only the difference.' },
    ],
    mistakes: [
      { sq: '"Dorëzo deklaratën" nuk e dërgon deklaratën te ATK-ja: e regjistron në libra dhe e mbyll muajin. Deklarimi bëhet në portalin e tatimeve.', en: '"Submit declaration" does not send it to the ATK: it books it and closes the month. The filing itself is done on the tax office portal.' },
      { sq: 'Nëse tatimet e refuzojnë, kliko "Shëno si të refuzuar" (te butoni ⋯), pastaj "Rihape si skicë" për ta korrigjuar dhe dorëzuar përsëri.', en: 'If the tax office rejects it, click "Mark rejected" (under the ⋯ button), then "Reopen as draft" to correct it and submit it again.' },
    ],
    after: { sq: 'TVSH-ja e shitjeve dhe e blerjeve e muajit kalon në kontin 4455; diferenca paguhet ose mbartet si kredi në muajin tjetër. Pas dorëzimit nuk shtohet më asnjë faturë në atë muaj.', en: 'The month\'s sales and purchase VAT moves to account 4455; the balance is paid or carried as a credit to next month. After submitting, no invoice can be added to that month.' },
    related: [{ href: '/tax/books', label: { sq: 'Librat e TVSH-së', en: 'VAT books' } }],
    tour: [
      { target: 'More', say: { sq: 'Te butoni ⋯ janë "Librat", "Printo", "Rillogarit" (merr përsëri shifrat nga librat) dhe "Shëno si të refuzuar".', en: 'Under the ⋯ button are "Books", "Print", "Recalculate" (takes the figures from the books again) and "Mark rejected".' } },
      { target: 'Accounting check', say: { sq: 'Këtu sheh nëse librat përputhen me kontabilitetin.', en: 'Here you see whether the books match accounting.' } },
      { target: 'Result', say: { sq: 'Sa TVSH paguhet këtë muaj, ose sa kredi mbartet.', en: 'How much VAT is paid this month, or how much credit is carried.' } },
      { target: 'Submit declaration', say: { sq: 'Në fund: regjistrohet në libra dhe muaji mbyllet për TVSH.', en: 'At the end: it is booked and the month closes for VAT.' } },
    ],
  },
  '/tax/small-business': {
    what: { sq: 'Biznesi i vogël: biznesi që nuk është në TVSH paguan çdo tremujor një tatim mbi të ardhurat bruto.', en: 'Small business: a business not registered for VAT pays a tax on its gross income every quarter.' },
    steps: [
      { sq: 'Zgjidh vitin lart djathtas.', en: 'Choose the year at the top right.' },
      { sq: 'Te "Norma e këtij biznesi" zgjidh 3% (tregti, transport, bujqësi) ose 9% (shërbime, profesione).', en: 'Under "The rate of this business" choose 3% (trade, transport, farming) or 9% (services, professions).' },
      { sq: 'Shiko tabelën: për çdo tremujor të ardhurat, tatimin dhe afatin.', en: 'Look at the table: for each quarter the income, the tax and the due date.' },
      { sq: 'Kliko "Libri i shitjeve" te një tremujor për dokumentet nga vijnë të ardhurat.', en: 'Click "Sales book" on a quarter for the documents the income comes from.' },
    ],
    mistakes: [
      { sq: 'Biznesi i regjistruar për TVSH nuk e paguan këtë tatim: ai deklaron TVSH-në çdo muaj.', en: 'A business registered for VAT does not pay this tax: it declares VAT every month.' },
      { sq: 'Kur të ardhurat e vitit kalojnë kufirin, faqja të paralajmëron: biznesi duhet të regjistrohet për TVSH.', en: 'When the year\'s income goes over the limit, the page warns you: the business must register for VAT.' },
    ],
    after: { sq: 'Kjo faqe vetëm e llogarit tatimin, nuk regjistron asgjë. Ai deklarohet dhe paguhet deri më 15 të muajit pas tremujorit.', en: 'This page only works out the tax, it books nothing. It is declared and paid by the 15th of the month after the quarter.' },
    related: [{ href: '/tax/books', label: { sq: 'Librat e TVSH-së', en: 'VAT books' } }],
  },
  '/finance/z-reports': {
    what: { sq: 'Z-raportet e arkës fiskale tënde: fotografo raportin e ditës dhe programi i regjistron shitjet sipas normës së TVSH-së.', en: 'The Z reports of your own fiscal register: photograph the day\'s report and the program books the sales by VAT rate.' },
    steps: [
      { sq: 'Kliko "Bëj një foto" ose "Zgjidh skedarë" (disa ditë njëherësh); mund ta plotësosh edhe me dorë më poshtë.', en: 'Click "Take a photo" or "Choose files" (several days at once); you can also fill it in by hand below.' },
      { sq: 'Kontrollo "Numri i Z-raportit", arkën fiskale dhe datën.', en: 'Check the "Z report number", the fiscal register and the date.' },
      { sq: 'Për çdo normë zgjidh TVSH-në dhe shkruaj shumën pa TVSH; për një tjetër kliko "Një normë tjetër TVSH".', en: 'For each rate choose the VAT and type the amount without VAT; for another one click "Another VAT rate".' },
      { sq: 'Shkruaj sa u pagua "Me para në dorë" dhe "Me kartë", me arkën dhe bankën ku shkojnë.', en: 'Type what was paid "In cash" and "By card", with the till and the bank they go to.' },
      { sq: 'Kliko "Regjistro shitjet".', en: 'Click "Book the sales".' },
    ],
    mistakes: [
      { sq: 'Shumat në rreshta janë pa TVSH: krahaso totalin me TVSH me atë që shkruan raporti.', en: 'The amounts on the lines are without VAT: compare the total with VAT with what the report says.' },
      { sq: 'I njëjti Z-raport nuk regjistrohet dy herë: programi e refuzon numrin që është regjistruar më parë.', en: 'The same Z report is not booked twice: the program refuses a number already booked.' },
    ],
    after: { sq: 'Bëhet një faturë shitjeje e kontabilizuar te klienti "Shitje me arkë fiskale" dhe del në librin e shitjeve; nuk dërgohet përsëri për fiskalizim. Paratë në dorë hyjnë në arkë, kartat në bankë; pjesa që mbetet është e hapur te ai klient.', en: 'A posted sales invoice is made to the customer "Shitje me arkë fiskale" and goes in the sales book; it is not sent for fiscalization again. Cash goes into the till, cards into the bank; whatever is left stays open on that customer.' },
    related: [{ href: '/tax/books', label: { sq: 'Librat e TVSH-së', en: 'VAT books' } }],
    tour: [
      { target: 'Take a photo', say: { sq: 'Fotografo të gjithë raportin, të shtrirë dhe me dritë.', en: 'Photograph the whole report, flat and in good light.' } },
      { target: 'Z report number', say: { sq: 'Numri i raportit duhet patjetër.', en: 'The report number is required.' } },
      { target: 'Another VAT rate', say: { sq: 'Shto një rresht për çdo normë TVSH-je që ka raporti.', en: 'Add a line for each VAT rate on the report.' } },
      { target: 'Book the sales', say: { sq: 'Në fund: shitjet e ditës hyjnë në libra.', en: 'At the end: the day\'s sales go into the books.' } },
    ],
  },
  '/tax/withholding': {
    what: { sq: 'Tatimi në burim: tatimi që mban nga pagesat për qira, interes, të drejta autori ose shërbime të individëve dhe jorezidentëve.', en: 'Withholding tax: the tax you keep back from payments for rent, interest, royalties or services of individuals and non-residents.' },
    steps: [
      { sq: 'Tatimi mbahet te fatura e furnitorit: hap faturën e kontabilizuar dhe kliko "Mbaj tatimin në burim".', en: 'The tax is withheld on the supplier\'s bill: open the posted bill and click "Withhold tax".' },
      { sq: 'Këtu, te "Sipas muajit", zgjidh muajin: sheh çdo tatim të mbajtur dhe totalin sipas llojit.', en: 'Here, under "By month", choose the month: you see each tax withheld and the total by kind.' },
      { sq: 'Me "Eksporto" e merr listën për deklaratën mujore.', en: 'With "Export" you get the list for the monthly declaration.' },
      { sq: 'Te "Llojet dhe normat" kontrollo normat; ndryshoji kur ndryshon ligji, ose shto një lloj të ri.', en: 'Under "Kinds and rates" check the rates; change them when the law changes, or add a new kind.' },
    ],
    mistakes: [{ sq: 'Normat janë ato të zakonshme të vendit: kontrolloji me kontabilistin para se t\'i përdorësh.', en: 'The rates are the usual ones of the country: check them with your accountant before you use them.' }],
    after: { sq: 'Furnitori merr aq më pak para: borxhi ndaj tij zvogëlohet dhe tatimi regjistrohet si detyrim ndaj tatimeve, që deklarohet dhe paguhet deri në datën që tregon faqja.', en: 'The supplier gets that much less: what you owe them goes down and the tax is booked as owed to the tax office, declared and paid by the date the page shows.' },
    related: [{ href: '/procurement/bills', label: { sq: 'Faturat e furnitorëve', en: 'Vendor bills' } }],
  },
  '/tax/income-tax': {
    what: { sq: 'Tatimi mbi fitimin: nga fitimi në libra te tatimi i vitit, me shpenzimet e pazbritshme dhe humbjet e viteve të kaluara.', en: 'Corporate income tax: from the profit in the books to the tax of the year, with non-deductible expenses and losses of earlier years.' },
    steps: [
      { sq: 'Shkruaj vitin.', en: 'Type the year.' },
      { sq: 'Kliko "Zgjidh llogaritë" dhe shëno kontot e shpenzimeve që tatimet nuk i pranojnë (gjoba, shpenzime private…).', en: 'Click "Choose accounts" and mark the expense accounts the tax office does not accept (fines, private expenses…).' },
      { sq: 'Shto te "± Diferenca të tjera" çdo ndryshim tjetër dhe shkruaj humbjet e viteve të mëparshme që përdor.', en: 'Add any other change under "± Other differences" and type the losses of earlier years you use.' },
      { sq: 'Kontrollo normën dhe këstet e paguara gjatë vitit, pastaj kliko "Ruaj".', en: 'Check the rate and the advances paid during the year, then click "Save".' },
      { sq: 'Kliko "Regjistroje" për ta futur tatimin në libra.', en: 'Click "Book it" to put the tax in the books.' },
    ],
    mistakes: [
      { sq: 'Nëse shifrat ndryshojnë pasi e ke regjistruar, kliko përsëri "Regjistroje": regjistrimi i ri zëvendëson të vjetrin.', en: 'If the figures change after you booked it, click "Book it" again: the new entry replaces the old one.' },
      { sq: 'Kur viti është mbyllur, tatimi nuk ndryshohet më; rihape vitin te "Mbyllja e vitit".', en: 'When the year is closed the tax can no longer change; reopen the year under "Year-end close".' },
    ],
    after: { sq: 'Tatimi regjistrohet si shpenzim i vitit dhe si detyrim ndaj tatimeve. Fleta ndihmon për deklaratën vjetore: kontrolloje me kontabilistin para se ta dorëzosh.', en: 'The tax is booked as an expense of the year and as owed to the tax office. The sheet helps with the annual return: check it with your accountant before filing.' },
    related: [{ href: '/finance/year-end', label: { sq: 'Mbyllja e vitit', en: 'Year-end close' } }, { href: '/finance/reports', label: { sq: 'Pasqyrat financiare', en: 'Financial statements' } }],
    tour: [
      { target: 'Choose accounts', say: { sq: 'Shëno kontot e shpenzimeve që nuk zbriten.', en: 'Mark the expense accounts that are not deductible.' } },
      { target: '− Losses of earlier years used', say: { sq: 'Humbjet e viteve të kaluara që i zbret nga fitimi.', en: 'The losses of earlier years you take off the profit.' } },
      { target: 'Save', say: { sq: 'Ruaje fletën pa e regjistruar ende.', en: 'Save the sheet without booking it yet.' } },
      { target: 'Book it', say: { sq: 'Fute tatimin në libra.', en: 'Put the tax in the books.' } },
    ],
  },
  '/tax/fiscalization': {
    what: { sq: 'Fiskalizimi: çdo faturë dhe kupon që dërgohet te tatimet, me kodin që merr, dhe ato që dështuan.', en: 'Fiscalization: every invoice and receipt sent to the tax office, with the code it gets, and the ones that failed.' },
    steps: [
      { sq: 'Shiko kartat lart: sa presin, sa dështuan dhe sa u fiskalizuan sot.', en: 'Look at the cards on top: how many are waiting, how many failed and how many were fiscalized today.' },
      { sq: 'Filtro sipas statusit "Dështoi" dhe lexo gabimin në rresht.', en: 'Filter by the status "Failed" and read the error on the line.' },
      { sq: 'Pasi ta rregullosh shkakun, kliko "Dërgo dokumentet në pritje": ato që dështuan dërgohen përsëri.', en: 'Once you fix the cause, click "Send waiting documents": the failed ones are sent again.' },
      { sq: 'Kliko "Verifiko" te rreshti për ta parë dokumentin në faqen e tatimeve.', en: 'Click "Verify" on a line to see the document on the tax office\'s site.' },
    ],
    mistakes: [{ sq: 'Në mënyrën prove përgjigjja e tatimeve simulohet: kodet dhe lidhjet QR janë vetëm për provë.', en: 'In test mode the tax office\'s answer is simulated: the codes and QR links are for testing only.' }],
    after: { sq: 'Dokumentet e lëshuara pa internet dërgohen më vonë, si fiskalizim i mëvonshëm.', en: 'Documents issued offline are sent afterwards, as later fiscalization.' },
    related: [{ href: '/tax', label: { sq: 'Afatet e tatimeve', en: 'Tax overview' } }],
  },
  '/tax/codes': {
    what: { sq: 'Kodet e TVSH-së: normat që vendos në fatura, dhe në cilën kolonë të librit dhe fushë të deklaratës shkon çdo rresht.', en: 'Tax codes: the rates you put on invoices, and which book column and declaration field each line goes to.' },
    steps: [
      { sq: 'Kliko "Kod i ri tatimor" për një normë të re, ose lapsin te rreshti për ta ndryshuar.', en: 'Click "New tax code" for a new rate, or the pencil on a line to change it.' },
      { sq: 'Shkruaj kodin, emrin dhe normën, dhe zgjidh "Përdoret në": shitje, blerje ose të dyja.', en: 'Type the code, the name and the rate, and choose "Used on": sales, purchases or both.' },
      { sq: 'Për raste të veçanta ndez "E përjashtuar" ose "Autongarkesë", ose fik "TVSH-ja e blerjes zbritet".', en: 'For special cases switch on "Exempt" or "Reverse charge", or switch off "Purchase VAT can be deducted".' },
      { sq: 'Lëri kontot te "Parazgjedhja e kompanisë", përveç kur kontabilisti të thotë ndryshe.', en: 'Leave the accounts on "Company default", unless your accountant says otherwise.' },
    ],
    mistakes: [
      { sq: 'Një lloj i gabuar TVSH-je e çon rreshtin në kolonë të gabuar të librit dhe të deklaratës: pyet kontabilistin kur nuk je i sigurt.', en: 'A wrong VAT type sends the line to the wrong book column and declaration field: ask your accountant when unsure.' },
      { sq: 'Një kod që nuk përdoret më fike me "Aktiv"; mos e kthe në një normë tjetër.', en: 'Switch off a code you no longer use with "Active"; do not turn it into another rate.' },
    ],
    after: { sq: 'Te autongarkesa furnitori nuk vë TVSH dhe kompania e regjistron si TVSH të shitjeve dhe të blerjeve njëherësh; TVSH-ja që nuk zbritet i shtohet kostos.', en: 'With reverse charge the vendor charges no VAT and the company books it as both sales and purchase VAT; non-deductible VAT is added to the cost.' },
  },
  '/tax': {
    what: { sq: 'Afatet e tatimeve: TVSH-ja e këtij muaji deri tani, çka duhet dorëzuar dhe kur, dhe si po shkon fiskalizimi.', en: 'Tax overview: this month\'s VAT so far, what is due and when, and how fiscalization is going.' },
    steps: [
      { sq: 'Shiko kartat lart: TVSH e shitjeve, e blerjeve dhe sa del për të paguar deri tani. Kliko një kartë për librin.', en: 'Look at the cards on top: sales VAT, purchase VAT and what is to pay so far. Click a card for the book.' },
      { sq: 'Te "Afatet" sheh çdo deklaratë me afatin dhe statusin; të vonuarat dalin me të kuqe.', en: 'Under "Deadlines" you see each declaration with its due date and status; late ones are red.' },
      { sq: 'Kur mbaron muaji, kliko "Deklaratë e re".', en: 'When the month is over, click "New declaration".' },
      { sq: 'Nëse "Librat kundrejt kontabilitetit" tregon "Kontrolloni", kliko "Hap librat" dhe gjej diferencën.', en: 'If "Books against accounting" says "Check", click "Open the books" and find the difference.' },
      { sq: 'Afatet tregojnë vetëm tatimet që i takojnë kompanisë: TVSH-në kur ka numër TVSH-je, tatimin e biznesit të vogël çdo tremujor kur s\'ka (Kosovë), tatimin në burim në muajt kur është mbajtur dhe këstin tremujor të tatimit në fitim. Kur kalon data e një tatimi që programi s\'e di a u dorëzua, shkruan "Afati kaloi: kontrolloni".', en: 'The deadlines list only the taxes the company files: VAT with a VAT number, the small business tax each quarter without one (Kosovo), withholding tax in months when tax was withheld, and the quarterly profit tax instalment. When the date of a tax the program cannot check has passed, it says "Date passed: check it was filed".' },
    ],
    mistakes: [{ sq: 'TVSH-ja e kuponëve në turne të hapura të arkës kalon në kontabilitet vetëm me Z-raportin: mbyll turnet para se të krahasosh.', en: 'Till VAT in open shifts reaches accounting only with the Z report: close the shifts before you compare.' }],
    related: [{ href: '/tax/declarations', label: { sq: 'Deklaratat e TVSH', en: 'VAT declarations' } }, { href: '/tax/fiscalization', label: { sq: 'Fiskalizimi', en: 'Fiscalization' } }],
    tour: [
      { target: 'Open the books', say: { sq: 'Librat e shitjeve dhe blerjeve të këtij muaji.', en: 'This month\'s sales and purchase books.' } },
      { target: 'Deadlines', say: { sq: 'Çka duhet dorëzuar dhe deri kur.', en: 'What is due, and by when.' } },
      { target: 'Accounting check', say: { sq: 'Librat duhet të përputhen me kontabilitetin.', en: 'The books should match accounting.' } },
      { target: 'New declaration', say: { sq: 'Krijo deklaratën e muajit nga librat.', en: 'Create the month\'s declaration from the books.' } },
    ],
  },

  /* ------------------------------------------------------------------ accounting */
  '/check': {
    what: { sq: 'Kontrolli i librave: gabimet që kanë kaluar pa u vënë re, secili me arsyen pse ka rëndësi dhe vendin ku rregullohet.', en: 'Books check: the mistakes that slipped through, each with why it matters and where to fix it.' },
    steps: [
      { sq: 'Lexo çdo kartë: çka nuk është në rregull dhe pse ka rëndësi.', en: 'Read each card: what is not right and why it matters.' },
      { sq: 'Kliko butonin te rreshti ("Fut faturën", "Bëje faturën", "Shto NUI-në" ose "Rregulloje") për të shkuar aty ku rregullohet.', en: 'Click the button on the line ("Enter the invoice", "Make the invoice", "Add the NUI" or "Fix it") to go where it is fixed.' },
      { sq: 'Kur janë më shumë, kliko "Shiko të gjitha" për listën e plotë.', en: 'When there are more, click "See all" for the full list.' },
      { sq: 'Kontrollohen edhe arkat nën zero, dokumentet e refuzuara në fiskalizim, rreshtat e bankës të papërputhur prej më shumë se një muaji dhe pagesat me para në dorë me biznese mbi kufi (kufiri vendoset te Cilësimet e kompanisë; bosh: 300 € në Kosovë, 150 000 lekë në Shqipëri).', en: 'Also checked: cash boxes below zero, documents refused at fiscalization, bank lines unmatched for over a month, and cash payments with businesses above the limit (set in the company settings; empty: 300 € in Kosovo, 150 000 lekë in Albania).' },
    ],
    mistakes: [{ sq: 'Asgjë këtu nuk ndryshon vetvetiu: çdo gabim e rregullon ti në dokumentin e tij.', en: 'Nothing here changes by itself: you fix each mistake on its own document.' }],
    after: { sq: 'Pasi e rregullon dokumentin, gabimi nuk del më në listë.', en: 'Once you fix the document, the mistake no longer shows in the list.' },
  },
  '/finance/reports': {
    what: { sq: 'Pasqyrat financiare: të ardhurat dhe shpenzimet, bilanci, fluksi i parasë dhe bilanci i verifikimit, nga regjistrimet e kontabilizuara.', en: 'Financial statements: income statement, balance sheet, cash flow and trial balance, from posted entries.' },
    steps: [
      { sq: 'Zgjidh pasqyrën me skedat lart.', en: 'Choose the statement with the tabs on top.' },
      { sq: 'Zgjidh periudhën dhe, nëse do, "Krahaso me" vitin e mëparshëm ose muaj pas muaji.', en: 'Choose the period and, if you like, "Compare with" the previous year or month by month.' },
      { sq: 'Për një degë ose projekt zgjidh "Qendra e kostos" (te pasqyra e të ardhurave dhe bilanci i verifikimit).', en: 'For a branch or project choose the "Cost center" (on the income statement and the trial balance).' },
      { sq: 'Kliko një konto për të parë çdo regjistrim pas saj.', en: 'Click an account to see every entry behind it.' },
      { sq: 'Me "Eksporto" ose "Printo" e merr pasqyrën.', en: 'With "Export" or "Print" you take the statement with you.' },
    ],
    mistakes: [{ sq: 'Regjistrimet në skicë nuk llogariten: kontabilizoji para se t\'i lexosh shifrat.', en: 'Draft entries are not counted: post them before you read the figures.' }],
    related: [{ href: '/finance/accounts', label: { sq: 'Plani kontabël', en: 'Chart of accounts' } }, { href: '/finance/cost-centers', label: { sq: 'Qendrat e kostos', en: 'Cost centers' } }],
    tour: [
      { target: 'Income statement', say: { sq: 'Të ardhurat, shpenzimet dhe fitimi i periudhës.', en: 'Revenue, expenses and the profit of the period.' } },
      { target: 'Balance sheet', say: { sq: 'Çka ka kompania dhe çka i detyrohet, në një datë.', en: 'What the company owns and owes, on a date.' } },
      { target: 'Trial balance', say: { sq: 'Çdo konto me debinë dhe kredinë: kontrolli i kontabilistit.', en: 'Every account with its debits and credits: the accountant\'s check.' } },
      { target: 'Compare with', say: { sq: 'Krahaso me vitet e kaluara ose muaj pas muaji.', en: 'Compare with earlier years or month by month.' } },
    ],
  },
  '/finance/journal': {
    what: { sq: 'Regjistrimet kontabël: gjithçka që është regjistruar në konto. Ato automatike vijnë nga dokumentet; ato manuale i bën ti.', en: 'Journal entries: everything recorded in the accounts. Automatic ones come from documents; manual ones you make yourself.' },
    steps: [
      { sq: 'Zgjidh periudhën me datat lart.', en: 'Choose the period with the dates on top.' },
      { sq: 'Filtro sipas ditarit, burimit (automatik ose manual) ose statusit.', en: 'Filter by journal, source (automatic or manual) or status.' },
      { sq: 'Kliko një regjistrim për rreshtat e tij dhe dokumentin nga vjen.', en: 'Click an entry for its lines and the document it comes from.' },
      { sq: 'Për përllogaritje, gjendje fillestare ose korrigjime kliko "Regjistrim manual".', en: 'For accruals, opening balances or corrections click "Manual entry".' },
    ],
    mistakes: [{ sq: 'Mos bëj regjistrim manual për një faturë ose pagesë: dokumenti e regjistron vetë, dhe do të dalë dy herë.', en: 'Do not make a manual entry for an invoice or payment: the document books itself, and it would show twice.' }],
    related: [{ href: '/finance/accounts', label: { sq: 'Plani kontabël', en: 'Chart of accounts' } }, { href: '/finance/account-card', label: { sq: 'Kartela e kontos', en: 'Account card' } }],
  },
  '/finance/journal/:id': {
    what: { sq: 'Një regjistrim kontabël: ditari, data dhe rreshtat në debi dhe kredi. Këtu bën edhe regjistrimin manual.', en: 'One journal entry: the journal, the date and the debit and credit lines. This is also where you make a manual entry.' },
    steps: [
      { sq: 'Zgjidh "Ditari" dhe datën, dhe shkruaj përshkrimin.', en: 'Choose the "Journal" and the date, and type the description.' },
      { sq: 'Për çdo rresht zgjidh kontin dhe shkruaj shumën në "Debi" ose në "Kredi"; partneri dhe qendra e kostos janë sipas nevojës.', en: 'For each line choose the account and type the amount under "Debit" or "Credit"; the partner and cost center are as needed.' },
      { sq: 'Me "Shto rresht" shton rreshta. Debia dhe kredia duhet të barazohen; nëse ka diferencë, kliko mesazhin e kuq për ta barazuar në rreshtin e fundit.', en: 'With "Add line" you add lines. Debits and credits must be equal; if there is a difference, click the red message to balance it on the last line.' },
      { sq: 'Kliko "Ruaj si skicë" për ta lënë për më vonë, ose "Kontabilizo" kur është gati.', en: 'Click "Save draft" to leave it for later, or "Post" when it is ready.' },
    ],
    mistakes: [
      { sq: 'Një regjistrim i kontabilizuar nuk ndryshohet: për ta korrigjuar kliko "Storno" dhe bëj një të ri.', en: 'A posted entry cannot be changed: to correct it click "Reverse" and make a new one.' },
      { sq: 'Regjistrimet automatike korrigjohen nga dokumenti i tyre (p.sh. me notë krediti), jo këtu.', en: 'Automatic entries are corrected from their document (for example with a credit note), not here.' },
    ],
    after: { sq: '"Kontabilizo" i ndryshon menjëherë saldot e kontove dhe pasqyrat financiare. "Storno" kontabilizon sot një regjistrim të ri me debi dhe kredi të ndërruara.', en: '"Post" changes the account balances and the financial statements at once. "Reverse" posts a new entry today with debits and credits swapped.' },
    tour: [
      { target: 'Journal', say: { sq: 'Zgjidh ditarin; zakonisht ai i përgjithshëm.', en: 'Choose the journal; usually the general one.' } },
      { target: 'Add line', say: { sq: 'Shto aq rreshta sa të duhen.', en: 'Add as many lines as you need.' } },
      { target: 'Save draft', say: { sq: 'Ruaje pa e kontabilizuar.', en: 'Save it without posting.' } },
      { target: 'Post', say: { sq: 'Kur debia dhe kredia barazohen, kontabilizoje.', en: 'When debits and credits are equal, post it.' } },
    ],
  },
  '/finance/account-card': {
    what: { sq: 'Kartela e kontos: çdo regjistrim në një konto, me saldon pas secilit.', en: 'The account card: every entry on one account, with the balance after each.' },
    steps: [
      { sq: 'Zgjidh kontin nga lista; mund të kërkosh me kod ose emër.', en: 'Choose the account from the list; you can search by code or name.' },
      { sq: 'Te kartela zgjidh periudhën me datat lart.', en: 'On the card, choose the period with the dates on top.' },
      { sq: 'Kliko numrin e regjistrimit ose dokumentin për ta hapur.', en: 'Click the entry number or the document to open it.' },
    ],
    related: [{ href: '/finance/accounts', label: { sq: 'Plani kontabël', en: 'Chart of accounts' } }],
  },
  '/finance/accounts': {
    what: { sq: 'Plani kontabël: kontot sipas klasave, me lëvizjen dhe saldon e këtij viti.', en: 'The chart of accounts: the accounts by class, with this year\'s movement and balance.' },
    steps: [
      { sq: 'Kërko me kod ose emër; me "Vetëm llogaritë me lëvizje" sheh vetëm ato që janë përdorur.', en: 'Search by code or name; with "Only accounts with movements" you see only the ones used.' },
      { sq: 'Kliko një konto për kartelën e saj: çdo regjistrim me saldon.', en: 'Click an account for its card: every entry with the balance.' },
      { sq: 'Për një konto të re kliko "Llogari e re" dhe plotëso kodin, grupin, emrin dhe llojin.', en: 'For a new account click "New account" and fill in the code, group, name and type.' },
    ],
    mistakes: [
      { sq: 'Kodi i kontos nuk ndryshohet pasi krijohet: kontrolloje mirë para se ta ruash.', en: 'An account\'s code cannot change once created: check it well before saving.' },
      { sq: '"Lloji i llogarisë" vendos ku del kontoja në pasqyrat financiare.', en: 'The "Kind" decides where the account appears in the financial statements.' },
    ],
    related: [{ href: '/finance/account-card', label: { sq: 'Kartela e kontos', en: 'Account card' } }, { href: '/finance/setup', label: { sq: 'Cilësimet e financës', en: 'Finance setup' } }],
  },
  '/finance/assets': {
    what: { sq: 'Mjetet themelore: pajisjet, automjetet dhe mobiljet e kompanisë, me amortizimin e çdo muaji.', en: 'Fixed assets: the company\'s equipment, vehicles and furniture, with each month\'s depreciation.' },
    steps: [
      { sq: 'Kliko "Aktiv i ri" për ta regjistruar me dorë, ose "Nga fotoja e faturës" për ta krijuar nga fatura.', en: 'Click "New asset" to register it by hand, or "From an invoice photo" to make it from the invoice.' },
      { sq: 'Kliko një mjet për planin e amortizimit dhe detajet.', en: 'Click an asset for its depreciation schedule and details.' },
      { sq: 'Kliko "Llogarit amortizimin", zgjidh datën te "Deri dhe përfshirë" dhe kliko "Regjistro amortizimin".', en: 'Click "Run depreciation", choose the date under "Up to and including" and click "Record depreciation".' },
      { sq: 'Ndiz "Regjistroje vetë çdo muaj" që muaji i kaluar të regjistrohet vetë në ditën e parë të muajit.', en: 'Switch on "Record it by itself every month" so last month is recorded on the first day of each month.' },
    ],
    after: { sq: 'Bëhet një regjistrim amortizimi për çdo muaj; muajt e regjistruar më parë kapërcehen, ndaj nuk regjistrohen dy herë.', en: 'One depreciation entry is made per month; months already recorded are skipped, so nothing is booked twice.' },
    related: [{ href: '/finance/asset-invoices', label: { sq: 'Mjete nga faturat', en: 'Assets from invoices' } }],
  },
  '/finance/assets/:id': {
    what: { sq: 'Një mjet themelor: të dhënat, plani i amortizimit, dhe shitja ose nxjerrja jashtë përdorimit.', en: 'One fixed asset: its details, the depreciation schedule, and selling or scrapping it.' },
    steps: [
      { sq: 'Plotëso emrin, kategorinë, datat, koston pa TVSH dhe jetëgjatësinë në muaj; kliko "Ruaj".', en: 'Fill in the name, category, dates, cost without VAT and useful life in months; click "Save".' },
      { sq: 'Kliko "Vëre në përdorim" dhe zgjidh "Regjistro blerjen tani" ose "Tashmë në kontabilitet".', en: 'Click "Put in service" and choose "Record the purchase now" or "Already in the accounts".' },
      { sq: 'Te "Amortizimi" sheh çdo muaj: shumën, sa është amortizuar dhe vlerën që mbetet.', en: 'Under "Depreciation" you see each month: the amount, what is depreciated and the value left.' },
      { sq: 'Kur e shet ose e hedh, kliko "Shit ose nxirr jashtë përdorimit" dhe shkruaj shumën e shitjes pa TVSH (0 nëse hidhet).', en: 'When you sell or scrap it, click "Sell or scrap" and type the sale amount without VAT (0 if scrapped).' },
    ],
    mistakes: [
      { sq: 'Nëse fatura e furnitorit është regjistruar tashmë në kontin e mjetit, zgjidh "Tashmë në kontabilitet": përndryshe blerja regjistrohet dy herë.', en: 'If the vendor bill was already booked to the asset account, choose "Already in the accounts": otherwise the purchase is booked twice.' },
      { sq: 'Pasi vihet në përdorim, të dhënat e mjetit nuk ndryshohen më.', en: 'Once in service, the asset\'s details can no longer change.' },
    ],
    after: { sq: 'Amortizimi fillon nga muaji i vënies në përdorim. Te shitja, amortizimi plotësohet deri në datë, mjeti hiqet nga librat dhe regjistrohet fitimi ose humbja.', en: 'Depreciation starts from the in-service month. On a sale, depreciation is brought up to the date, the asset leaves the books and the gain or loss is booked.' },
    tour: [
      { target: 'Save', say: { sq: 'Ruaje mjetin si skicë.', en: 'Save the asset as a draft.' } },
      { target: 'Put in service', say: { sq: 'Nga ky moment fillon amortizimi.', en: 'Depreciation starts from here.' } },
      { target: 'Depreciation', say: { sq: 'Plani i amortizimit, muaj pas muaji.', en: 'The depreciation schedule, month by month.' } },
    ],
  },
  '/finance/asset-invoices': {
    what: { sq: 'Mjete nga faturat: fotografo faturën e një veture, makine ose kompjuteri dhe programi e regjistron si investim, krijon mjetin dhe planin e amortizimit.', en: 'Assets from invoices: photograph the invoice of a vehicle, machine or computer and the program books it as an investment, makes the asset and plans its depreciation.' },
    steps: [
      { sq: 'Kliko "Bëj një foto" ose "Zgjidh skedarë"; mund ta plotësosh edhe me dorë.', en: 'Click "Take a photo" or "Choose files"; you can also fill it in by hand.' },
      { sq: 'Kontrollo shitësin, numrin e faturës dhe datën që lexoi programi.', en: 'Check the seller, the invoice number and the date the program read.' },
      { sq: 'Shkruaj emrin te "Mjeti", zgjidh "Lloji i mjetit" dhe kontrollo jetëgjatësinë në muaj.', en: 'Type the name under "The asset", choose the "Kind of asset" and check the useful life in months.' },
      { sq: 'Kontrollo shumat pa TVSH, zgjidh te "U pagua?" nëse është paguar, dhe kliko "Regjistro mjetin".', en: 'Check the amounts without VAT, choose under "Paid?" whether it is paid, and click "Book the asset".' },
    ],
    mistakes: [{ sq: 'Shitësi që nuk është në listë shtohet si furnitor i ri kur e regjistron: kontrollo emrin dhe NUI-në.', en: 'A seller not in your list is added as a new vendor when you book: check the name and NUI.' }],
    after: { sq: 'Fatura del te faturat e furnitorëve dhe në librin e blerjeve; nëse nuk u pagua, pret te faturat për t’u paguar. Mjeti krijohet, vihet në përdorim dhe amortizohet çdo muaj.', en: 'The invoice goes to the vendor bills and the purchase book; if not paid, it waits among the bills to pay. The asset is made, put in service and depreciated every month.' },
    related: [{ href: '/finance/assets', label: { sq: 'Mjetet themelore', en: 'Fixed assets' } }],
  },
  '/finance/cost-centers': {
    what: { sq: 'Qendrat e kostos: dega, departamenti ose projekti, për të parë fitimin e secilit veç.', en: 'Cost centers: a branch, department or project, to see the profit of each one.' },
    steps: [
      { sq: 'Kliko "Qendër kostoje e re" dhe shkruaj kodin dhe emrin; te "Bën pjesë te" mund ta vendosësh nën një tjetër.', en: 'Click "New cost center" and type the code and name; under "Belongs to" you can put it under another one.' },
      { sq: 'Zgjidh qendrën e kostos te regjistrimet, mjetet dhe dokumentet.', en: 'Choose the cost center on entries, assets and documents.' },
      { sq: 'Zgjidh periudhën me datat lart: për secilën sheh të ardhurat, koston e mallit, shpenzimet, fitimin dhe marzhin.', en: 'Choose the period with the dates on top: for each you see revenue, cost of goods, expenses, profit and margin.' },
    ],
    mistakes: [{ sq: 'Të ardhurat dhe shpenzimet pa qendër kostoje dalin veç te "Pa qendër kostoje": kontrollo që e ke zgjedhur në dokumente.', en: 'Revenue and costs without a cost center show apart under "No cost center": check you chose it on the documents.' }],
    related: [{ href: '/finance/reports', label: { sq: 'Pasqyrat financiare', en: 'Financial statements' } }],
  },
  '/finance/year-end': {
    what: { sq: 'Mbyllja e vitit: kontrollo që asgjë nuk ka mbetur e hapur, shiko rezultatin dhe mbyll vitin.', en: 'Year-end close: check that nothing is left open, see the result and close the year.' },
    steps: [
      { sq: 'Zgjidh vitin lart.', en: 'Choose the year on top.' },
      { sq: 'Te "Para mbylljes" rregullo çdo gjë me të kuqe me "Hap"; e verdha vlen të kontrollohet, por nuk e ndalon mbylljen.', en: 'Under "Before closing" fix everything in red with "Open"; yellow is worth checking but does not stop the closing.' },
      { sq: 'Shiko rezultatin e vitit: të ardhurat, shpenzimet dhe fitimin ose humbjen.', en: 'Look at the result of the year: revenue, expenses and the profit or loss.' },
      { sq: 'Zgjidh nëse rezultati kalon te kontoja 108 më 1 janar, pastaj kliko "Mbyll vitin".', en: 'Choose whether the result is carried to account 108 on 1 January, then click "Close the year".' },
      { sq: 'Para mbylljes kontrollohen edhe numërimi vjetor i stokut dhe saldot e hapura me partnerët (dërgoni IOS për konfirmim).', en: 'Before closing, the yearly stock count and the open balances with partners are checked too (send the IOS to confirm).' },
    ],
    mistakes: [
      { sq: 'Vitet mbyllen me radhë: mbyll më parë vitet e mëparshme që janë ende të hapura.', en: 'Years close in order: first close the earlier years that are still open.' },
      { sq: 'Vitin e mbyll vetëm dikush me të drejtë miratimi në financë.', en: 'Only someone who can approve in finance can close the year.' },
    ],
    after: { sq: 'Rezultati kalon në kontin 109 në fund të vitit dhe çdo muaj i vitit mbyllet: asgjë me datë në atë vit nuk kontabilizohet më. Për një korrigjim kliko "Rihap vitin" dhe shkruaj arsyen.', en: 'The result moves to account 109 at the end of the year and every month of the year closes: nothing dated in it can be posted any more. To correct something, click "Reopen the year" and give the reason.' },
    related: [{ href: '/tax/income-tax', label: { sq: 'Tatimi mbi fitimin', en: 'Corporate income tax' } }],
    tour: [
      { target: 'Before closing', say: { sq: 'Lista e asaj që duhet përfunduar para mbylljes.', en: 'The list of what to finish before closing.' } },
      { target: 'Close the year', say: { sq: 'Kur nuk ka më asgjë me të kuqe, mbyll vitin.', en: 'When nothing is red any more, close the year.' } },
    ],
  },
  '/finance/setup': {
    what: { sq: 'Cilësimet e financës: kontot që përdorin regjistrimet automatike, muajt e hapur, ditarët dhe rregulla të tjera.', en: 'Finance setup: the accounts automatic entries use, the open months, the journals and other rules.' },
    steps: [
      { sq: 'Te "Llogaritë e kontabilizimit" cakto kontin për çdo rast (arka, banka, TVSH, paga…).', en: 'Under "Posting accounts" set the account for each case (cash, bank, VAT, salaries…).' },
      { sq: 'Te "Muajt kontabël" krijo vitin financiar dhe mbyll muajt e përfunduar me "Mbyll muajin".', en: 'Under "Accounting months" create the financial year and close finished months with "Close month".' },
      { sq: 'Te "Kategoritë e aktiveve" sheh jetëgjatësinë, mënyrën dhe kontot e amortizimit.', en: 'Under "Asset categories" you see the useful life, method and depreciation accounts.' },
      { sq: 'Te "Kufijtë e parave në dorë" cakto kufijtë për pagesat me para në dorë; te "Kushtet e pagesës" afatet e pagesës.', en: 'Under "Cash limits" set the limits for cash payments; under "Payment terms" the payment terms.' },
      { sq: '"Kyç" e mbyll muajin përgjithmonë: programi pyet njëherë me emrin e muajit. Kyçeni vetëm pasi të jenë dorëzuar deklaratat dhe kontrolluar librat; për punën e zakonshme mjafton "Mbyll muajin".', en: '"Lock" closes the month for good: the program asks once with the month\'s name. Lock only after the declarations are filed and the books checked; for everyday work "Close month" is enough.' },
    ],
    mistakes: [
      { sq: 'Një rast pa konto te "Llogaritë e kontabilizimit" e ndalon kontabilizimin e dokumenteve që e përdorin.', en: 'A case with no account under "Posting accounts" stops the posting of the documents that use it.' },
      { sq: 'Një muaj i mbyllur mund ta rihapë menaxheri i financës; një muaj i kyçur ("Kyç") nuk rihapet më.', en: 'A closed month can be reopened by a finance manager; a locked month ("Lock") can never be reopened.' },
    ],
    after: { sq: 'Dokumentet me datë në një muaj të mbyllur refuzohen me një mesazh të qartë.', en: 'Documents dated in a closed month are refused with a clear message.' },
  },

  /* ------------------------------------------------------------------ the numbers */
  '/reports': {
    what: { sq: 'Raportet: shitjet, blerjet, stoku, financat dhe tatimet, secili raport si një pyetje.', en: 'Reports: sales, purchasing, stock, finance and tax, each report as a question.' },
    steps: [
      { sq: 'Lart janë katër pyetjet më të shpeshta: "Sa shitëm?", "Ku fitojmë më shumë?", "Sa vlen stoku?", "Kush na ka borxh?". Poshtë, raportet janë të grupuara sipas pyetjes: Shitjet, Fitimi, Stoku, Blerja, Paratë dhe borxhet, Tatimet.', en: 'On top are the four most common questions: "How much did we sell?", "Where do we earn most?", "What is the stock worth?", "Who owes us?". Below, the reports are grouped by question: Sales, Profit, Stock, Buying, Money and debts, Taxes.' },
      { sq: 'Nuk e gjen? Shkruaj një fjalë te "Gjej një raport…" (p.sh. "TVSH", "skadim", "klient").', en: 'Cannot find it? Type a word in "Find a report…" (e.g. "VAT", "expiry", "customer").' },
      { sq: 'Zgjidh periudhën dhe si grupohen shifrat te "Grupo sipas"; me "Në kolona" e kthen në tabelë me kolona.', en: 'Choose the period and how the figures are grouped under "Group by"; with "Across" you turn it into a table with columns.' },
      { sq: 'Kliko një rresht për të parë nga se përbëhet; rruga mbi tabelë të kthen pas.', en: 'Click a row to see what makes it up; the path above the table takes you back.' },
      { sq: 'Kliko "Ruaj raportin" për ta gjetur më vonë te "Raportet e mia", ose "Eksporto" për Excel, CSV ose PDF.', en: 'Click "Save the report" to find it later under "My reports", or "Export" for Excel, CSV or PDF.' },
    ],
    mistakes: [{ sq: 'Raportet që sheh varen nga roli yt: nëse të mungon një raport, pyet administratorin e kompanisë.', en: 'The reports you see follow your role: if one is missing, ask the company admin.' }],
    related: [{ href: '/finance/reports', label: { sq: 'Pasqyrat financiare', en: 'Financial statements' } }],
  },
  '/sales': {
    what: { sq: 'Pasqyra e shitjeve: sa ke shitur, me çfarë marzhi, cilat fatura janë me vonesë dhe kush blen më shumë.', en: 'Sales overview: how much you sold, at what margin, which invoices are overdue and who buys most.' },
    steps: [
      { sq: 'Zgjidh periudhën lart.', en: 'Choose the period on top.' },
      { sq: 'Kliko një kartë (p.sh. "Shitjet (pa TVSH)" ose "Fatura me vonesë (me TVSH)") për listën pas saj.', en: 'Click a card (for example "Sales (without VAT)" or "Overdue invoices (with VAT)") for the list behind it.' },
      { sq: 'Shiko klientët dhe produktet kryesore, dhe shitjet sipas shitësit.', en: 'Look at the top customers and products, and the sales by salesperson.' },
      { sq: 'Me "Ofertë e re" ose "Porosi e re" fillon një shitje të re.', en: 'With "New quote" or "New order" you start a new sale.' },
      { sq: 'Shitjet përfshijnë edhe arkat (pa TVSH, pa kthimet); grafiku i tregon arkat dhe faturat veç e veç. Marzha e kartës vlen për faturat.', en: 'Sales include the tills too (without VAT, refunds taken off); the chart shows tills and invoices apart. The margin card is for invoices.' },
    ],
    mistakes: [{ sq: 'Shitjet numërohen nga faturat e kontabilizuara minus notat e kreditit, pa TVSH: faturat në skicë nuk llogariten.', en: 'Sales count posted invoices minus credit notes, without VAT: draft invoices are not counted.' }],
    related: [{ href: '/sales/invoices', label: { sq: 'Faturat e shitjes', en: 'Customer invoices' } }, { href: '/reports', label: { sq: 'Raportet', en: 'Reports' } }],
  },
  '/procurement': {
    what: { sq: 'Pasqyra e blerjeve: sa ke shpenzuar, çka është në porosi, çka ke pranuar pa faturë dhe cilat fatura janë me vonesë.', en: 'Purchasing overview: what you spent, what is on order, what came in without a bill and which bills are overdue.' },
    steps: [
      { sq: 'Zgjidh periudhën lart.', en: 'Choose the period on top.' },
      { sq: 'Kliko një kartë për listën pas saj; "Fatura me mospërputhje" janë ato ku sasia ose çmimi ndryshon nga porosia.', en: 'Click a card for the list behind it; "Bills with a mismatch" are those where quantity or price differs from the order.' },
      { sq: 'Te "Furnitorët" sheh shpenzimin, dorëzimet në kohë dhe sa ditë zgjat dorëzimi.', en: 'Under "Vendors" you see the spend, on-time deliveries and how many days delivery takes.' },
      { sq: 'Me "Porosi e re blerjeje" ose "Kërkesë e re blerjeje" fillon një blerje.', en: 'With "New purchase order" or "New requisition" you start a purchase.' },
    ],
    mistakes: [{ sq: '"Pranuar, pa faturë" është malli që ka hyrë, por fatura e furnitorit nuk është regjistruar ende: pritet një faturë.', en: '"Received, not billed" is goods that came in whose vendor bill is not recorded yet: a bill is still to come.' }],
    related: [{ href: '/procurement/bills', label: { sq: 'Faturat e furnitorëve', en: 'Vendor bills' } }, { href: '/reports', label: { sq: 'Raportet', en: 'Reports' } }],
  },
  '/finance': {
    what: { sq: 'Financat në përgjithësi: të ardhurat, fitimi, paratë, TVSH-ja dhe borxhet, direkt nga kontabiliteti.', en: 'Finance overview: revenue, profit, cash, VAT and debts, straight from the accounts.' },
    steps: [
      { sq: 'Zgjidh periudhën lart.', en: 'Choose the period on top.' },
      { sq: 'Kliko një shifër për të parë çka ka pas saj.', en: 'Click a figure to see what is behind it.' },
      { sq: 'Shiko grafikun: paratë në fund të çdo muaji dhe fitimin e muajit.', en: 'Look at the chart: cash at the end of each month and the month\'s profit.' },
      { sq: '"Arkëto një pagesë" është butoni kryesor; "Paguaj një furnitor" dhe "Regjistrim manual" janë te butoni ⋯.', en: '"Receive a payment" is the main button; "Pay a vendor" and "Manual entry" are under the ⋯ button.' },
    ],
    mistakes: [{ sq: '"Regjistrime si skicë" janë regjistrime manuale ende të pakontabilizuara: kontabilizoji ose fshiji.', en: '"Draft entries" are manual entries not posted yet: post them or delete them.' }],
    related: [{ href: '/finance/reports', label: { sq: 'Pasqyrat financiare', en: 'Financial statements' } }],
  },
  '/history': {
    what: { sq: 'Programi i vjetër: shitjet, blerjet, pagesat dhe kontabiliteti nga programi që përdorej më parë, të ruajtura si arkiv.', en: 'The old program: sales, purchases, payments and accounting from the program used before, kept as an archive.' },
    steps: [
      { sq: 'Zgjidh periudhën me "Nga" dhe "Deri".', en: 'Choose the period with "From" and "To".' },
      { sq: 'Te "Pasqyra" sheh shitjet dhe blerjet sipas muajve, sipas njësisë dhe produktet më të shitura.', en: 'Under "Overview" you see sales and purchases by month, by store and the best-selling products.' },
      { sq: 'Te "Dokumentet" kërko një faturë ose kupon me numër ose partner, dhe kliko për ta parë me rreshta.', en: 'Under "Documents" search an invoice or receipt by number or partner, and click it to see its lines.' },
      { sq: 'Te "Pagesat dhe arka" sheh pagesat; te "Kontabiliteti" lëvizjen e çdo kontoje sipas muajve të një viti.', en: 'Under "Payments and cash" you see the payments; under "Accounting" each account\'s movement by month of a year.' },
    ],
    mistakes: [{ sq: 'Ky është vetëm arkiv: nuk ndryshon stokun, librat ose çka është dërguar te tatimet.', en: 'This is only an archive: it does not change stock, the books or anything sent to the tax office.' }],
  },
}
