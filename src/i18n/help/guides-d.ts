import type { Guide } from './types'

/**
 * Page guides for people (HR and payroll), company settings, appointments and the hotel.
 * Same shape as GUIDES in ./guides: keyed by the page's address; ":id" stands for one document.
 */
export const GUIDES_D: Record<string, Guide> = {
  /* ------------------------------------------------------------------ people */
  '/hr': {
    what: { sq: 'Pasqyra e personelit: sa punonjës ke, kush është në punë ose me leje sot, dhe sa kushtojnë pagat.', en: 'The people overview: how many employees you have, who is at work or on leave today, and what salaries cost.' },
    steps: [
      { sq: 'Kliko kartelat lart ("Në punë sot", "Me leje sot", "Leje për t\'u vendosur") për të hapur listën përkatëse.', en: 'Click the tiles on top ("At work today", "On leave today", "Leave to decide") to open that list.' },
      { sq: '"Kostoja e pagave" tregon muajt me pagë përfundimtare: bruto plus kontributet e punëdhënësit, dhe sa morën punonjësit neto.', en: '"Salary cost" shows the months with a final payroll: gross plus employer contributions, and what employees received net.' },
      { sq: 'Te "Kontrata që mbarojnë" sheh kontratat me afat që mbarojnë në 60 ditët e ardhshme; kliko emrin për të hapur punonjësin.', en: 'Under "Contracts ending" see the fixed-term contracts ending in the next 60 days; click a name to open the employee.' },
      { sq: 'Me "Punonjës i ri" shton një punonjës; te "Cilësimet e personelit" cakton departamentet, pozicionet dhe llojet e lejeve.', en: 'With "New employee" add a person; under "HR setup" set the departments, positions and leave types.' },
    ],
    related: [{ href: '/hr/employees', label: { sq: 'Punonjësit', en: 'Employees' } }, { href: '/hr/payroll', label: { sq: 'Pagat', en: 'Payroll' } }],
  },
  '/hr/setup': {
    what: { sq: 'Cilësimet e personelit: departamentet, pozicionet e punës, llojet e lejeve dhe festat zyrtare.', en: 'HR setup: departments, job positions, leave types and public holidays.' },
    steps: [
      { sq: 'Te "Departamentet" kliko "Departament i ri" dhe zgjidh menaxherin dhe qendrën e kostos.', en: 'Under "Departments" click "New department" and choose the manager and the cost center.' },
      { sq: 'Te "Pozicionet" shkruaj titujt e punës: ato dalin në fletëpagesë dhe në listën për tatimet.', en: 'Under "Positions" type the job titles: they show on payslips and on the payroll list for the tax office.' },
      { sq: 'Te "Llojet e lejeve" cakto "Ditë në vit" (0 do të thotë pa kufi, p.sh. pushimi mjekësor) dhe nëse leja paguhet.', en: 'Under "Leave types" set "Days per year" (0 means no limit, e.g. sick leave) and whether the leave is paid.' },
      { sq: 'Te "Festat zyrtare" kliko "Shto festë" për çdo festë të vitit.', en: 'Under "Public holidays" click "Add holiday" for each holiday of the year.' },
    ],
    mistakes: [
      { sq: 'Kur festa bie në fundjavë, shkruaj ditën ku zhvendoset pushimi, jo të shtunën ose të dielën.', en: 'When a holiday falls on a weekend, enter the day it moves to, not the Saturday or Sunday.' },
      { sq: 'Një departament, pozicion ose lloj leje fshihet vetëm kur nuk e përdor askush.', en: 'A department, position or leave type can only be deleted while nothing uses it.' },
    ],
    after: { sq: 'Pagat regjistrohen te qendra e kostos e departamentit, nëse punonjësi nuk ka të vetën. Festat nuk numërohen as si leje, as si ditë pune; leja pa pagesë ul pagën.', en: 'Salaries are booked on the department\'s cost center unless the employee has their own. Holidays count neither as leave nor as working days; unpaid leave reduces pay.' },
  },
  '/hr/employees': {
    what: { sq: 'Të gjithë punonjësit, me departamentin, menaxherin dhe kontratën.', en: 'Everyone who works here, with their department, manager and contract.' },
    steps: [
      { sq: 'Kliko "Punonjës i ri" për një punonjës, ose "Importo" për shumë njëherësh nga Excel-i.', en: 'Click "New employee" for one person, or "Import" for many at once from Excel.' },
      { sq: 'Kërko me emër, numër ose email; filtro sipas departamentit, pozicionit ose statusit.', en: 'Search by name, number or email; filter by department, position or status.' },
      { sq: 'Lista tregon aktivët dhe ata me leje; për ata që janë larguar ndrysho filtrin "Statusi".', en: 'The list shows active people and those on leave; for people who left, change the "Status" filter.' },
      { sq: 'Kliko një punonjës për profilin, kontratën, lejet, prezencën dhe fletëpagesat.', en: 'Click an employee for the profile, contract, leave, attendance and payslips.' },
    ],
    related: [{ href: '/hr/setup', label: { sq: 'Cilësimet e personelit', en: 'HR setup' } }, { href: '/settings/import', label: { sq: 'Importi', en: 'Import data' } }],
  },
  '/hr/employees/:id': {
    what: { sq: 'Kartela e punonjësit: të dhënat personale, kontrata, lejet, prezenca dhe fletëpagesat.', en: 'The employee\'s file: personal details, contract, leave, attendance and payslips.' },
    steps: [
      { sq: 'Te "Profili" plotëso emrin, numrin personal, departamentin, menaxherin dhe IBAN-in, pastaj kliko "Ruaj ndryshimet".', en: 'Under "Profile" fill in the name, personal number, department, manager and IBAN, then click "Save changes".' },
      { sq: 'Te "Kontrata" kliko "Kontratë e re" dhe shkruaj "Bruto në muaj" dhe orët në javë.', en: 'Under "Contract" click "New contract" and type the "Gross per month" and the hours per week.' },
      { sq: 'Te "Llogaria e hyrjes" lidhe punonjësin me përdoruesin e tij: kështu regjistron hyrjen, kërkon leje dhe sheh fletëpagesat vetë.', en: 'Under "Login" link the employee to their user: then they clock in, ask for leave and see their own payslips.' },
      { sq: 'Te "Ndalesat" shto paradhëniet, kreditë ose ndalesat e tjera që mbahen nga paga neto çdo muaj.', en: 'Under "Deductions" add salary advances, loans or other amounts kept back from the net pay every month.' },
    ],
    mistakes: [
      { sq: 'Pa kontratë aktive punonjësi nuk hyn në listëpagesë. Një person ka vetëm një kontratë aktive: mbyll të vjetrën para se të hapësh të renë.', en: 'Without an active contract the person is left out of payroll. One active contract per person: end the old one before starting another.' },
      { sq: 'Në Kosovë, për punën e dytë fik "Punëdhënësi kryesor": paga tatohet me 10% të sheshtë, pa shumë të patatueshme.', en: 'In Kosovo, for a second job switch off "Main employer": the pay is taxed at a flat 10%, with no tax-free amount.' },
    ],
    after: { sq: 'Pagat llogariten nga kontrata aktive. Menaxheri i caktuar këtu i sheh kërkesat për leje te "Vendi im i punës" dhe mund t\'i miratojë.', en: 'Payroll uses the active contract. The manager set here sees the leave requests under "My workplace" and can approve them.' },
    related: [{ href: '/hr/payroll', label: { sq: 'Pagat', en: 'Payroll' } }, { href: '/hr/leave', label: { sq: 'Lejet', en: 'Leave' } }],
    tour: [
      { target: 'Profile', say: { sq: 'Këtu janë të dhënat personale, departamenti dhe IBAN-i.', en: 'Personal details, department and IBAN are here.' } },
      { target: 'Login', say: { sq: 'Lidhe me përdoruesin që punonjësi të regjistrojë hyrjen dhe të kërkojë leje vetë.', en: 'Link the user so the employee can clock in and ask for leave on their own.' } },
      { target: 'Contract', say: { sq: 'Pa kontratë aktive nuk ka pagë: shtoje këtu.', en: 'No active contract, no pay: add it here.' } },
      { target: 'Save changes', say: { sq: 'Mos harro të ruash.', en: 'Do not forget to save.' } },
    ],
  },
  '/hr/leave': {
    what: { sq: 'Lejet: kërkesat, vendimet dhe sa ditë i kanë mbetur secilit këtë vit.', en: 'Leave: requests, decisions and what everyone has left this year.' },
    steps: [
      { sq: 'Kliko "Kërko leje", zgjidh punonjësin, llojin e lejes dhe datat; numërohen vetëm ditët e punës.', en: 'Click "Ask for leave", choose the employee, the type of leave and the dates; only working days count.' },
      { sq: '"Ruaj si skicë" e mban për më vonë; "Dërgo kërkesën" e dërgon për vendim.', en: '"Save draft" keeps it for later; "Send request" sends it for a decision.' },
      { sq: 'Kliko një kërkesë që pret dhe zgjidh "Mirato lejen" ose "Refuzo"; mund t\'i shkruash edhe një shënim punonjësit.', en: 'Click a waiting request and choose "Approve leave" or "Reject"; you can also write a note to the employee.' },
      { sq: 'Te "Ditët e mbetura" sheh për çdo punonjës sa ditë ka në vit, sa ka marrë dhe sa i kanë mbetur.', en: 'Under "Days left" see for each employee their days per year, what they took and what is left.' },
    ],
    mistakes: [{ sq: 'Fundjavat dhe festat zyrtare nuk numërohen; nëse ditët dalin gabim, kontrollo festat te "Cilësimet e personelit".', en: 'Weekends and public holidays do not count; if the days look wrong, check the holidays in "HR setup".' }],
    after: { sq: 'Leja e miratuar del te prezenca dhe zbret nga ditët e mbetura; leja pa pagesë ul pagën e muajit.', en: 'Approved leave shows in attendance and comes off the days left; unpaid leave reduces that month\'s pay.' },
    related: [{ href: '/hr/attendance', label: { sq: 'Prezenca', en: 'Attendance' } }, { href: '/hr/setup', label: { sq: 'Cilësimet e personelit', en: 'HR setup' } }],
  },
  '/hr/attendance': {
    what: { sq: 'Prezenca: muaji i çdo punonjësi me një shikim, ditët në punë me orë, lejet, festat dhe mungesat.', en: 'Attendance: each person\'s month at a glance, days at work with hours, leave, holidays and missing days.' },
    steps: [
      { sq: 'Zgjidh muajin me shigjetat dhe, nëse do, një departament.', en: 'Choose the month with the arrows and, if you like, a department.' },
      { sq: 'Çdo katror është një ditë: numri tregon orët e punuara, shkronja tregon leje, festë ose mungesë.', en: 'Each box is one day: a number shows the hours worked, a letter shows leave, a holiday or an absence.' },
      { sq: 'Kliko një ditë për të shtuar ose korrigjuar "Hyrja", "Dalja" dhe "Orë shtesë (h)", pastaj "Ruaj".', en: 'Click a day to add or correct "In", "Out" and "Overtime (h)", then "Save".' },
      { sq: 'Në fund të rreshtit sheh orët, orët shtesë, ditët në punë dhe mungesat e muajit.', en: 'At the end of the row see the month\'s hours, overtime, days present and absences.' },
    ],
    mistakes: [{ sq: 'Një ditë pune pa regjistrim dhe pa leje del si mungesë: korrigjoje para pagave nëse punonjësi ishte në punë.', en: 'A working day with no record and no leave shows as absent: correct it before payroll if the person was at work.' }],
    after: { sq: 'Orët shtesë nga prezenca paguhen me shtesën ligjore kur llogaritet paga.', en: 'Overtime from attendance is paid at the legal premium when payroll is calculated.' },
  },
  '/hr/payroll': {
    what: { sq: 'Pagat: një listëpagesë për çdo muaj, e llogarit, e miraton dikush tjetër, bëhet përfundimtare dhe paguhet.', en: 'Payroll: one payroll per month, calculated, approved by someone else, made final, then paid.' },
    steps: [
      { sq: 'Kliko "Listëpagesë e re mujore", zgjidh muajin dhe datën e pagesës, pastaj "Krijo listëpagesën".', en: 'Click "New monthly payroll", choose the month and the pay date, then "Create payroll".' },
      { sq: 'Në të hyjnë të gjithë punonjësit me kontratë aktive.', en: 'Everyone with an active contract is included.' },
      { sq: 'Kliko një listëpagesë për ta llogaritur, miratuar dhe paguar; filtro sipas statusit për ato që presin.', en: 'Click a payroll to calculate, approve and pay it; filter by status for the ones waiting.' },
    ],
    mistakes: [{ sq: 'Punonjësi pa kontratë aktive nuk del në listëpagesë: shtoja kontratën te kartela e tij.', en: 'A person without an active contract is not on the payroll: add the contract on their file.' }],
    related: [{ href: '/hr/employees', label: { sq: 'Punonjësit', en: 'Employees' } }, { href: '/settings/automation', label: { sq: 'Automatizimet', en: 'Automations' } }],
  },
  '/hr/payroll/:id': {
    what: { sq: 'Një listëpagesë mujore: bruto, kontributet, tatimi, neto dhe kostoja e punëdhënësit për çdo punonjës.', en: 'One monthly payroll: gross, contributions, tax, net and employer cost for each employee.' },
    steps: [
      { sq: 'Te "Të ardhura shtesë" shto shpërblimet dhe shtesat para se ta llogaritësh.', en: 'Under "Extra earnings" add bonuses and allowances before calculating.' },
      { sq: 'Kliko "Llogarit pagat"; pas çdo ndryshimi kliko "Rillogarit".', en: 'Click "Calculate payroll"; after any change click "Recalculate".' },
      { sq: 'Dikush tjetër, jo ai që e llogariti, klikon "Mirato listëpagesën".', en: 'Someone other than the person who calculated it clicks "Approve payroll".' },
      { sq: 'Kliko "Bëje përfundimtare dhe kontabilizo", pastaj "Paguaj pagat" dhe zgjidh llogarinë bankare.', en: 'Click "Make final and book", then "Pay salaries" and choose the bank account.' },
      { sq: 'Te "Lista për deklaratën" eksporto listën për deklaratën mujore të pagave.', en: 'Under "Declaration list" export the list for the monthly payroll declaration.' },
    ],
    mistakes: [
      { sq: 'Ai që e llogarit listëpagesën nuk mund ta miratojë vetë: duhet dikush tjetër me të drejtë miratimi.', en: 'The person who calculated the payroll cannot approve it: someone else with approval rights must.' },
      { sq: 'Deri sa ta kontabilizosh, mund ta kthesh me "Kthe në skicë"; pas kontabilizimit nuk ndryshohet më.', en: 'Until it is booked you can send it back with "Back to draft"; once booked it no longer changes.' },
    ],
    after: { sq: 'Pagat dhe kontributet regjistrohen si shpenzim; neto, kontributet dhe tatimi bëhen detyrime për t\'u paguar. Punonjësit i shohin fletëpagesat te "Vendi im i punës".', en: 'Salaries and contributions are booked as expenses; net pay, contributions and tax become amounts to pay. Employees see their payslips under "My workplace".' },
    tour: [
      { target: 'Extra earnings', say: { sq: 'Shpërblimet e muajit shtohen këtu, para llogaritjes.', en: 'The month\'s bonuses go here, before calculating.' } },
      { target: 'Payslips', say: { sq: 'Fletëpagesa e çdo punonjësi: kliko një rresht për ta parë.', en: 'Each employee\'s payslip: click a line to see it.' } },
      { target: 'Declaration list', say: { sq: 'Lista për deklaratën mujore, gati për eksport.', en: 'The list for the monthly declaration, ready to export.' } },
    ],
  },
  '/hr/me': {
    what: { sq: 'Vendi im i punës: regjistro hyrjen dhe daljen, kërko leje dhe shiko fletëpagesat e tua.', en: 'My workplace: clock in and out, ask for leave and see your payslips.' },
    steps: [
      { sq: 'Kur vjen në punë kliko "Regjistro hyrjen"; kur ikën, "Regjistro daljen".', en: 'When you arrive click "Clock in"; when you leave, "Clock out".' },
      { sq: 'Kliko "Kërko leje", zgjidh llojin e lejes dhe datat, pastaj "Dërgo kërkesën".', en: 'Click "Ask for leave", choose the type of leave and the dates, then "Send request".' },
      { sq: 'Te kartela e lejeve sheh sa ditë të kanë mbetur këtë vit.', en: 'The leave card shows how many days you have left this year.' },
      { sq: 'Kliko një muaj te "Fletëpagesat e mia" për ta parë fletëpagesën.', en: 'Click a month under "My payslips" to see the payslip.' },
    ],
    mistakes: [{ sq: 'Nëse faqja thotë se llogaria jote nuk është lidhur me punonjës, kërkoji personelit ta lidhë te kartela jote.', en: 'If the page says your login is not linked to an employee, ask HR to link it on your employee file.' }],
    after: { sq: 'Nëse je menaxher, kërkesat e ekipit dalin poshtë te "Lejet e ekipit tuaj": mirato ose refuzo direkt aty.', en: 'If you are a manager, your team\'s requests show below under "Your team\'s leave": approve or reject them right there.' },
  },

  /* ------------------------------------------------------------------ company settings */
  '/settings': {
    what: { sq: 'Cilësimet e kompanisë: si del kompania në dokumente, me çka fillojnë dokumentet e reja dhe lidhja me tatimet.', en: 'Company settings: how the company appears on documents, what new documents start with, and the link to the tax office.' },
    steps: [
      { sq: 'Te "Kompania" plotëso emrin, NUI-në ose NIPT-in, adresën dhe kontaktet: dalin në fatura, kupona dhe fletëpagesa.', en: 'Under "Company" fill in the name, NUI or NIPT, address and contacts: they print on invoices, receipts and payslips.' },
      { sq: 'Te "Vlerat fillestare dhe rregullat" zgjidh njësinë dhe TVSH-në që propozohen, dhe rregullat si "Lejo stok negativ".', en: 'Under "Defaults and rules" choose the warehouse and VAT that are suggested, and rules such as "Allow negative stock".' },
      { sq: 'Te "Fiskalizimi" ndiz "Fiskalizo dokumentet" dhe shkruaj kodet nga administrata tatimore.', en: 'Under "Fiscalization" switch on "Fiscalize documents" and type the codes from the tax office.' },
      { sq: 'Kliko "Ruaj ndryshimet" poshtë faqes; te "Menuja" çdo ndryshim ruhet menjëherë.', en: 'Click "Save changes" at the bottom; under "Menu" each change is saved at once.' },
    ],
    mistakes: [{ sq: 'Me mënyrën "Test" asgjë nuk shkon te tatimet. Kalo në "Reale" vetëm kur shërbimi i fiskalizimit është vendosur me certifikatën e kompanisë.', en: 'In "Test" mode nothing reaches the tax office. Switch to "Live" only once the fiscalization service is set up with the company certificate.' }],
    after: { sq: 'Pjesët e fikura te "Menuja" zhduken nga menuja e të gjithëve, por asgjë nuk fshihet: faqet gjenden ende me kërkim.', en: 'Parts switched off under "Menu" disappear from everyone\'s menu, but nothing is deleted: the pages can still be found by search.' },
    tour: [
      { target: 'Company', say: { sq: 'Të dhënat që dalin në çdo dokument.', en: 'The details printed on every document.' } },
      { target: 'Defaults and rules', say: { sq: 'Me çka fillon një dokument i ri, dhe kontrollet që bën programi.', en: 'What a new document starts with, and the checks the program makes.' } },
      { target: 'Fiscalization', say: { sq: 'Lidhja me tatimet për faturat dhe kuponat.', en: 'The tax office link for invoices and receipts.' } },
      { target: 'Menu', say: { sq: 'Fshih nga menuja atë që kompania nuk e përdor.', en: 'Hide from the menu what the company does not use.' } },
    ],
  },
  '/settings/users': {
    what: { sq: 'Përdoruesit: kush hyn në këtë kompani dhe çfarë mund të bëjë secili, sipas roleve të tij.', en: 'Users: who can sign in to this company and what each person may do, by their roles.' },
    steps: [
      { sq: 'Kliko "Fto një person", shkruaj email-in, zgjidh rolet dhe kliko "Dërgo ftesën".', en: 'Click "Invite a person", type the email, choose the roles and click "Send invitation".' },
      { sq: 'Nëse personi ka llogari, i vjen ftesa dhe duhet të klikojë "Prano"; deri atëherë del si "I ftuar". Për dikë pa llogari, llogarinë e hap administratori i DrisPRO.', en: 'If the person has an account, they get the invitation and must click "Accept"; until then they show as "Invited". For someone without an account, the DrisPRO administrator makes one.' },
      { sq: 'Te menyja "…" e çdo personi: "Ndrysho rolet", "Njësitë ku punon", PIN për arkën e përbashkët ose "Pezullo aksesin".', en: 'In each person\'s "…" menu: "Change roles", "Warehouses they work in", a PIN for the shared till, or "Suspend access".' },
      { sq: 'Fto kontabilistin te "Kontabilisti juaj, falas": nuk zë vend përdoruesi në licencë.', en: 'Invite your accountant under "Your accountant, free": they do not take a user place of your licence.' },
    ],
    mistakes: [{ sq: 'Me "Hiq nga kompania" personi humb aksesin menjëherë. Për një largim të përkohshëm përdor "Pezullo aksesin" dhe më vonë "Rikthe aksesin".', en: 'With "Remove from company" the person loses access at once. For a temporary break use "Suspend access", and later "Restore access".' }],
    after: { sq: 'Rolet e ndryshuara vlejnë herën tjetër që personi hap një faqe. Dokumentet që ka bërë mbeten me emrin e tij.', en: 'Changed roles apply the next time the person opens a page. Documents they made keep their name.' },
    related: [{ href: '/settings/roles', label: { sq: 'Rolet dhe të drejtat', en: 'Roles and permissions' } }, { href: '/hr/employees', label: { sq: 'Punonjësit', en: 'Employees' } }],
    tour: [
      { target: 'Invite a person', say: { sq: 'Fto dikë me email dhe zgjidh rolet e tij.', en: 'Invite someone by email and choose their roles.' } },
      { target: 'Roles and permissions', say: { sq: 'Këtu sheh çfarë lejon çdo rol, dhe bën role të tua.', en: 'See what each role allows here, and make your own roles.' } },
    ],
  },
  '/settings/roles': {
    what: { sq: 'Rolet dhe të drejtat: çfarë mund të shohë dhe ndryshojë çdo rol në secilën pjesë të programit.', en: 'Roles and permissions: what each role may see and change in every part of the program.' },
    steps: [
      { sq: 'Kliko një rol majtas për të parë të drejtat e tij.', en: 'Click a role on the left to see its permissions.' },
      { sq: 'Rolet "I gatshëm" nuk ndryshohen: kliko "Kopjo si rol të personalizuar" për të bërë versionin tënd.', en: '"Built in" roles cannot change: click "Copy as custom role" to make your own version.' },
      { sq: 'Ose kliko "Rol i ri i personalizuar", jepi emër dhe shëno për çdo fushë "Shiko", "Ndrysho", "Fshi" ose "Mirato".', en: 'Or click "New custom role", name it and tick "See", "Change", "Delete" or "Approve" for each area.' },
      { sq: 'Kliko "Krijo rolin", pastaj jepua njerëzve te "Përdoruesit" me "Ndrysho rolet".', en: 'Click "Create role", then give it to people under "Users" with "Change roles".' },
    ],
    mistakes: [{ sq: 'Një rol i personalizuar fshihet vetëm pasi t\'ua heqësh të gjithëve.', en: 'A custom role can be deleted only after you take it away from everyone.' }],
    related: [{ href: '/settings/users', label: { sq: 'Përdoruesit', en: 'Users' } }],
  },
  '/settings/numbering': {
    what: { sq: 'Numërimi i dokumenteve: si numërohet çdo lloj dokumenti. Numrat nuk kanë zbrazëtira dhe nuk përdoren dy herë.', en: 'Document numbering: how each kind of document is numbered. Numbers have no gaps and are never used twice.' },
    steps: [
      { sq: 'Kliko lapsin te dokumenti që do të ndryshosh.', en: 'Click the pencil on the document you want to change.' },
      { sq: 'Ndrysho "Parashtesa", "Shifrat" dhe, nëse do, "Viti në numër"; poshtë sheh si del numri i radhës.', en: 'Change the "Prefix", "Digits" and, if you like, "Year in the number"; below you see how the next number looks.' },
      { sq: 'Me "Kodi i dyqanit ose njësisë në numër" çdo dyqan numëron më vete.', en: 'With "Store or warehouse code in the number" each store counts on its own.' },
      { sq: 'Kur vazhdon një seri nga programi i vjetër, rrite "Numri i radhës" dhe kliko "Ruaj numërimin".', en: 'When continuing a series from the old program, move "Next number" forward and click "Save numbering".' },
    ],
    mistakes: [{ sq: '"Numri i radhës" vetëm rritet, nuk zbret. Numërimi që rifillon çdo vit duhet ta ketë vitin në numër, përndryshe numrat e dy viteve do të ishin të njëjtë.', en: '"Next number" only moves forward. Numbering that restarts every year must show the year, or two years would get the same numbers.' }],
    after: { sq: 'Ndryshimi vlen nga dokumenti i ardhshëm; numrat e dhënë mbeten siç janë.', en: 'The change applies from the next document; numbers already given stay as they are.' },
  },
  '/settings/automation': {
    what: { sq: 'Automatizimet: çfarë bën DrisPRO vetë dhe kur. Çdo gjë që prek paratë, ligjin ose mallin pret konfirmimin e një personi.', en: 'Automations: what DrisPRO does by itself, and when. Whatever touches money, the law or goods waits for a person to confirm.' },
    steps: [
      { sq: 'Te "Mbyllja e ditës në arkë" shkruaj nga sa diferencë parash të njoftohesh dhe kliko "Ruaj".', en: 'Under "End of the day at the till" type from what cash difference you want to be told, and click "Save".' },
      { sq: 'Ndiz "Pagat mujore" dhe zgjidh ditën: listëpagesa përgatitet vetë si skicë nga kontratat, prezenca dhe lejet.', en: 'Switch on "Monthly payroll" and choose the day: the payroll is prepared as a draft from contracts, attendance and leave.' },
      { sq: 'Te "Serveri i email-it (SMTP)" vendos kutinë postare dhe kliko "Dërgo një email prove": prej saj dalin kujtesat, porositë dhe përmbledhja e mëngjesit.', en: 'Under "Mail server (SMTP)" set the mailbox and click "Send a test email": reminders, purchase orders and the morning summary go out from it.' },
      { sq: 'Kliko "Hap" te "Faturat mujore", "Çmimet e reja nga kosto" ose "Rifurnizim" për t\'i rregulluar.', en: 'Click "Open" on "Recurring invoices", "New selling prices from the cost" or "Replenishment" to set them up.' },
    ],
    mistakes: [{ sq: 'Për Gmail përdor një fjalëkalim aplikacioni (Google › Security › App passwords), jo fjalëkalimin e zakonshëm.', en: 'For Gmail use an app password (Google › Security › App passwords), not your usual password.' }],
    after: { sq: 'Listëpagesa e përgatitur vetë mbetet skicë: miratimi dhe pagesa mbeten te ti.', en: 'The payroll prepared by itself stays a draft: approving and paying stay with you.' },
    related: [{ href: '/hr/payroll', label: { sq: 'Pagat', en: 'Payroll' } }, { href: '/sales/recurring', label: { sq: 'Faturat mujore', en: 'Recurring invoices' } }],
  },
  '/settings/workflows': {
    what: { sq: 'Rregullat e miratimit: cilat dokumente duhet t\'i miratojë dikush, nga cila shumë, dhe kush vendos në çdo hap.', en: 'Approval workflows: which documents need approval, from what amount, and who decides at each step.' },
    steps: [
      { sq: 'Kliko "Rrjedhë e re", jepi emër dhe zgjidh dokumentin (p.sh. porosi blerjeje, pagesë furnitori, leje).', en: 'Click "New workflow", name it and choose the document (e.g. purchase order, vendor payment, leave).' },
      { sq: 'Shkruaj "Nga shuma": rrjedha vlen për dokumentet me këtë shumë ose më shumë.', en: 'Type the "From amount": the workflow applies to documents of this amount or more.' },
      { sq: 'Shto hapat me "Shto një hap"; për secilin zgjidh "Kush miraton": një rol ose një person.', en: 'Add steps with "Add a step"; for each one choose "Who approves": a role or a person.' },
      { sq: 'Kliko "Krijo rrjedhën"; me çelësin pranë saj e fik ose e ndez kur të duash.', en: 'Click "Create workflow"; use the switch next to it to turn it off or on at any time.' },
    ],
    mistakes: [{ sq: 'Pa asnjë rrjedhë, dokumentet miratohen sapo dërgohen. Kur disa rrjedha i përshtaten një dokumenti, fiton ajo me "Përparësia" më të lartë.', en: 'Without any workflow, documents are approved as soon as they are sent. When several fit a document, the highest "Priority" wins.' }],
    after: { sq: 'Hapat shkojnë me radhë; një "jo" e kthen dokumentin mbrapsht.', en: 'Steps run in order; one "no" sends the document back.' },
    related: [{ href: '/settings/roles', label: { sq: 'Rolet dhe të drejtat', en: 'Roles and permissions' } }],
  },
  '/settings/import': {
    what: { sq: 'Importi: sill artikujt, klientët e furnitorët, punonjësit dhe gjendjen fillestare nga Excel ose CSV.', en: 'Import data: bring products, customers and vendors, employees and opening stock from Excel or CSV.' },
    steps: [
      { sq: 'Zgjidh çfarë importon; kliko "Shabllon" për një skedar shembull me kolonat e duhura.', en: 'Choose what you import; click "Template" for a sample file with the right columns.' },
      { sq: 'Kliko "Zgjidh një skedar": Excel .xlsx ose CSV, me emrat e kolonave në rreshtin e parë.', en: 'Click "Choose a file": Excel .xlsx or CSV, with the column names in the first row.' },
      { sq: 'Kontrollo lidhjen e kolonave (ato me * janë të detyrueshme); me "Ruaje si shabllon" e gjen gati herën tjetër.', en: 'Check how the columns are matched (those with * are required); with "Save as template" it is ready next time.' },
      { sq: 'Kliko "Kontrollo skedarin": asgjë nuk ruhet, vetëm del çka duhet rregulluar. Pastaj importo rreshtat.', en: 'Click "Check the file": nothing is saved, it only shows what to fix. Then import the rows.' },
    ],
    mistakes: [
      { sq: 'Artikulli me SKU që ekziston përditësohet, nuk krijohet i ri; partnerët gjenden sipas NIPT/NUI ose kodit.', en: 'An item with an existing SKU is updated, not created again; partners are matched by NIPT/NUI or code.' },
      { sq: 'Për gjendjen fillestare bëj një skedar për çdo njësi.', en: 'For opening stock make one file per warehouse.' },
    ],
    after: { sq: 'Gjendja fillestare regjistrohet si një rregullim stoku i hapjes.', en: 'Opening stock is posted as one opening stock adjustment.' },
    related: [{ href: '/settings/migration', label: { sq: 'Kalimi nga programi tjetër', en: 'Move from another program' } }],
  },
  '/settings/migration': {
    what: { sq: 'Kalimi nga programi tjetër: sill kompaninë nga programi i vjetër, hap pas hapi, dhe krahaso totalet.', en: 'Move from another program: bring the company over from the old program step by step, then compare the totals.' },
    steps: [
      { sq: 'Zgjidh "Data e kalimit" dhe "Programi i vjetër"; nxirr çdo listë në Excel nga programi i vjetër në atë datë.', en: 'Choose the "Cut-over date" and the "Old program"; export each list to Excel from the old program on that date.' },
      { sq: 'Ndiq hapat me radhë majtas: artikujt, partnerët, gjendja, faturat e hapura, saldot e llogarive. Ato "(opsionale)" mund t\'i kalosh.', en: 'Follow the steps on the left in order: products, partners, stock, open invoices, account balances. The "(optional)" ones can be skipped.' },
      { sq: 'Në çdo hap: zgjidh skedarin, lidh kolonat, kontrolloje dhe importoje.', en: 'In each step: choose the file, match the columns, check it and import it.' },
      { sq: 'Në fund hap "Kontrolli i totaleve" dhe krahaso çdo shifër me të njëjtin raport në programin e vjetër.', en: 'At the end open "Check the totals" and compare each figure with the same report in the old program.' },
    ],
    mistakes: [
      { sq: 'Rendi ka rëndësi: faturat e hapura kanë nevojë për klientët, gjendja dhe çmimet për artikujt.', en: 'The order matters: open invoices need their customers, stock and prices need the products.' },
      { sq: 'Nëse një shifër nuk përputhet, importo sërish atë hap ose korrigjo dokumentin.', en: 'If a figure does not match, import that step again or correct the document.' },
    ],
    after: { sq: 'Nga data e kalimit kompania punon vetëm në DrisPRO; faturat e hapura vjetërohen dhe paguhen si çdo faturë tjetër.', en: 'From the cut-over date the company works only in DrisPRO; the open invoices age and take payments like any other.' },
  },
  '/settings/integrations': {
    what: { sq: 'Lidhjet me programe: portali B2B për klientët, ChatGPT dhe Claude, çelësat API dhe webhooks.', en: 'B2B portal and API: the portal for customers, ChatGPT and Claude, API keys and webhooks.' },
    steps: [
      { sq: 'Te "Portali B2B" zgjidh nëse porositë konfirmohen menjëherë dhe çfarë shohin klientët nga stoku. Lidhja për çdo klient bëhet te faqja e klientit.', en: 'Under "B2B portal" choose whether orders are confirmed at once and what customers see of the stock. Each customer\'s link is made on the customer\'s page.' },
      { sq: 'Te "ChatGPT dhe Claude" kliko "Krijo lidhjen time" dhe ngjite lidhjen në ChatGPT ose Claude, sipas udhëzimeve.', en: 'Under "ChatGPT and Claude" click "Make my link" and paste the link into ChatGPT or Claude, as the steps say.' },
      { sq: 'Te "Çelësat API" kliko "Çelës i ri", jepi emër, shëno "Çfarë mund të bëjë" dhe kliko "Bëj çelësin".', en: 'Under "API keys" click "New key", name it, tick "What it may do" and click "Make the key".' },
      { sq: 'Kopjo çelësin menjëherë: shfaqet vetëm një herë.', en: 'Copy the key at once: it is shown only this once.' },
    ],
    mistakes: [{ sq: 'Kush e ka lidhjen ose çelësin e sheh kompaninë si ti: mos e ndaj. Nëse rrjedh, fike çelësin ose hiqe lidhjen dhe bëj një të re.', en: 'Whoever has the link or the key sees the company as you: do not share it. If it leaks, switch the key off or remove the link and make a new one.' }],
    related: [{ href: '/partners', label: { sq: 'Klientët dhe furnitorët', en: 'Customers and vendors' } }],
  },
  '/settings/audit': {
    what: { sq: 'Historiku i ndryshimeve: kush ndryshoi çfarë, kur, dhe vlerat para e pas. Këtu asgjë nuk ndryshohet e nuk fshihet.', en: 'Change history: who changed what, when, and the values before and after. Nothing here can be edited or deleted.' },
    steps: [
      { sq: 'Filtro sipas "Fusha", "Personi", "Veprimi" ose datave.', en: 'Filter by "Area", "Person", "Action" or dates.' },
      { sq: 'Kliko një rresht për të parë çdo fushë që ndryshoi, me vlerën e vjetër dhe të renë.', en: 'Click a row to see each field that changed, with the old and the new value.' },
      { sq: 'Kliko "Gjithë historiku i këtij regjistrimi" për ta ndjekur një dokument nga fillimi.', en: 'Click "Full history of this record" to follow one document from the start.' },
      { sq: 'Nëse diçka u fshi gabimisht, hap rreshtin e fshirjes dhe kliko "Ktheje".', en: 'If something was deleted by mistake, open the row of the deletion and click "Bring it back".' },
    ],
    mistakes: [{ sq: '"Ktheje" kërkon të drejtën e fshirjes në atë fushë.', en: '"Bring it back" needs the right to delete in that area.' }],
  },

  /* ------------------------------------------------------------------ appointments */
  '/appointments': {
    what: { sq: 'Kalendari i termineve: dita sipas personit, karriges ose ngritësit. Kliko një vend të lirë për të rezervuar.', en: 'The appointment calendar: the day by person, chair or lift. Click a free place to book.' },
    steps: [
      { sq: 'Zgjidh ditën me shigjetat, me datën ose me "Sot".', en: 'Choose the day with the arrows, the date or "Today".' },
      { sq: 'Kliko një vend të lirë në kolonën e personit, ose "Termin i ri".', en: 'Click a free place in the person\'s column, or "New appointment".' },
      { sq: 'Zgjidh shërbimin dhe orën te "Oraret e lira"; zgjidh klientin ose shkruaj emrin dhe telefonin e një klienti të ri, pastaj ruaje.', en: 'Choose the service and a time under "Free times"; pick the client or type a new client\'s name and phone, then save.' },
      { sq: 'Kur vjen klienti kliko terminin dhe "Erdhi"; kur mbaron puna, "U krye, te fatura".', en: 'When the client arrives click the appointment and "Arrived"; when the work is done, "Done, to the invoice".' },
    ],
    mistakes: [{ sq: 'Pa email te "Email (për kujtesën)" klienti nuk merr kujtesë një ditë para terminit.', en: 'Without an email under "Email (for the reminder)" the client gets no reminder the day before.' }],
    after: { sq: '"U krye, te fatura" bën faturën me shërbimin dhe çmimin për ta kontrolluar, dhe e shton vizitën në kartelën e klientit.', en: '"Done, to the invoice" makes the invoice with the service and price for you to check, and adds the visit to the client card.' },
    related: [{ href: '/appointments/setup', label: { sq: 'Shërbimet dhe stafi', en: 'Services and staff' } }, { href: '/appointments/cards', label: { sq: 'Dosjet e klientëve', en: 'Client cards' } }],
    tour: [
      { target: 'Services and staff', say: { sq: 'Fillo këtu: kush punon dhe çfarë shërbimesh ofron.', en: 'Start here: who works and which services they offer.' } },
      { target: 'New appointment', say: { sq: 'Termin i ri, ose kliko direkt një vend të lirë në kalendar.', en: 'A new appointment, or click a free place on the calendar.' } },
      { target: 'Today', say: { sq: 'Kthehu te dita e sotme.', en: 'Go back to today.' } },
    ],
  },
  '/appointments/cards': {
    what: { sq: 'Dosjet e klientëve: vetura me targë e kilometra, pacienti, kafsha ose pajisja, me gjithë historikun vizitë pas vizite.', en: 'Client cards: the car with its plate and kilometres, the patient, the pet or the device, with its whole history visit by visit.' },
    steps: [
      { sq: 'Zgjidh llojin lart dhe kërko me targë, emër ose telefon.', en: 'Choose the kind on top and search by plate, name or phone.' },
      { sq: 'Kliko butonin e kartelës së re lart djathtas, plotëso emrin ose targën dhe zgjidh klientin.', en: 'Click the new-card button on the top right, fill in the name or plate and choose the client.' },
      { sq: 'Hap një kartelë dhe kliko "Shto në historik" për të shkruar çfarë u bë.', en: 'Open a card and click "Add to the history" to write down what was done.' },
    ],
    mistakes: [{ sq: 'Te termini zgjidh klientin dhe kartelën e tij: vetëm atëherë vizita dhe fatura shkojnë në historikun e kartelës.', en: 'On the appointment choose the client and their card: only then do the visit and the invoice go into the card\'s history.' }],
    related: [{ href: '/appointments', label: { sq: 'Kalendari i termineve', en: 'Appointment calendar' } }],
  },
  '/appointments/memberships': {
    what: { sq: 'Anëtarësimet: shit anëtarësim mujor, vjetor ose me numër hyrjesh, kontrollo anëtarët te hyrja dhe shiko kujt i mbaron së shpejti.', en: 'Memberships: sell a monthly, yearly or visit-based membership, check members in at the door, and see whose ends soon.' },
    steps: [
      { sq: 'Në fillim shto paketat te "Paketat" me "Shto": emri, muajt ose ditët, hyrjet dhe çmimi me TVSH.', en: 'First add the plans under "Plans" with "Add": name, months or days, visits and price with VAT.' },
      { sq: 'Kliko "Shit një anëtarësim", zgjidh anëtarin dhe paketën, pastaj "Shit, te fatura".', en: 'Click "Sell a membership", choose the member and the plan, then "Sell, to the invoice".' },
      { sq: 'Te "Te hyrja" skano kartelën ose shkruaj numrin, telefonin ose emrin dhe kliko "Check-in".', en: 'Under "At the door" scan the card or type its number, the phone or the name, and click "Check in".' },
      { sq: 'Zgjidh "Mbarojnë brenda 7 ditëve" dhe kliko "Rinovo" për ata që vazhdojnë.', en: 'Choose "Ending within 7 days" and click "Renew" for those who continue.' },
    ],
    mistakes: [{ sq: 'Për një pushim të përkohshëm përdor "Ngrije", jo një shitje të re: ditët e ngrira shtohen në fund.', en: 'For a temporary break use "Freeze", not a new sale: the frozen days are added at the end.' }],
    after: { sq: 'Çdo shitje bën një faturë për klientin; anëtari merr një numër kartele për hyrjen. Rinovimi fillon ditën pas mbarimit dhe mban të njëjtën kartelë.', en: 'Each sale makes an invoice for the client; the member gets a card number for the door. A renewal starts the day after the current one ends and keeps the same card.' },
  },
  '/appointments/setup': {
    what: { sq: 'Shërbimet dhe stafi: kush merr termine dhe çfarë bën, me kohëzgjatjen dhe çmimin.', en: 'Services and staff: who takes appointments and what they do, with the length and the price.' },
    steps: [
      { sq: 'Te "Kush punon" kliko "Shto": një person, karrige, dhomë ose ngritës; secili bëhet një kolonë në kalendar.', en: 'Under "Who works" click "Add": a person, chair, room or lift; each becomes a column of the calendar.' },
      { sq: 'Cakto "Orari i punës" për çdo ditë; jashtë orarit kalendari del i hirtë.', en: 'Set the "Working hours" for each day; outside them the calendar is grey.' },
      { sq: 'Te "Shërbime" kliko "Shto": emri, minutat dhe çmimi me TVSH.', en: 'Under "Services" click "Add": name, minutes and price with VAT.' },
      { sq: 'Te "Kush e bën" zgjidh kush e kryen shërbimin; pa zgjedhur askënd, e bën kushdo.', en: 'Under "Who does it" choose who performs the service; with nobody chosen, everyone can.' },
    ],
    mistakes: [{ sq: 'Çmimi i shërbimit është me TVSH dhe bëhet rresht në faturë: kontrollo normën e TVSH-së.', en: 'The service price includes VAT and becomes an invoice line: check the VAT rate.' }],
    after: { sq: 'Kalendari hapet sapo të kesh të paktën një person ose vend pune.', en: 'The calendar opens as soon as there is at least one person or place.' },
  },

  /* ------------------------------------------------------------------ hotel */
  '/hotel': {
    what: { sq: 'Recepsioni: kush mbërrin, kush largohet dhe sa i zënë është hoteli sonte.', en: 'The front desk: who arrives, who leaves, and how full the hotel is tonight.' },
    steps: [
      { sq: 'Te "Mbërritjet sot" kliko "Check-in" kur mysafiri vjen.', en: 'Under "Arrivals today" click "Check in" when the guest arrives.' },
      { sq: 'Te "Largimet sot" kliko "Check-out": hapet rezervimi për ta mbyllur.', en: 'Under "Departures today" click "Check out": the reservation opens to close it.' },
      { sq: 'Te "Pastrimi i dhomave" kliko "Gati" kur dhoma është pastruar.', en: 'Under "Housekeeping" click "Ready" when a room has been cleaned.' },
      { sq: 'Kliko "Rezervim i ri" për një rezervim, ose "Kalendari i dhomave" për të parë netët.', en: 'Click "New reservation" for a booking, or "Room calendar" to see the nights.' },
    ],
    after: { sq: 'Me check-out bëhet një faturë skicë me netët dhe shtesat; e konfirmon dhe merr pagesën aty. Dhoma kalon për pastrim.', en: 'Check-out makes a draft invoice with the nights and extras; you confirm it and take the payment there. The room goes to cleaning.' },
    related: [{ href: '/hotel/reservations', label: { sq: 'Rezervimet', en: 'Reservations' } }, { href: '/hotel/rooms', label: { sq: 'Dhomat', en: 'Rooms' } }],
    tour: [
      { target: 'Arrivals today', say: { sq: 'Kush vjen sot: kliko "Check-in" kur arrin.', en: 'Who comes today: click "Check in" when they arrive.' } },
      { target: 'Departures today', say: { sq: 'Kush ikën sot: check-out bën faturën.', en: 'Who leaves today: check-out makes the invoice.' } },
      { target: 'New reservation', say: { sq: 'Rezervim i ri për një mysafir.', en: 'A new booking for a guest.' } },
      { target: 'Room calendar', say: { sq: 'Të gjitha dhomat, natë pas nate.', en: 'All rooms, night by night.' } },
    ],
  },
  '/hotel/calendar': {
    what: { sq: 'Kalendari i dhomave: çdo dhomë dhe netët e saj për dy javë. Një qëndrim është një shirit nga mbërritja te largimi.', en: 'The room calendar: every room and its nights for two weeks. A stay is a bar from arrival to departure.' },
    steps: [
      { sq: 'Lëviz me shigjetat ose kliko "Sot".', en: 'Move with the arrows or click "Today".' },
      { sq: 'Kliko një natë të lirë te dhoma për ta rezervuar: dhoma dhe data plotësohen vetë.', en: 'Click a free night on a room to book it: the room and the date fill in by themselves.' },
      { sq: 'Kliko një shirit për të hapur rezervimin: ndrysho, bëj check-in ose check-out.', en: 'Click a bar to open the reservation: change it, check in or check out.' },
      { sq: 'Ngjyra e shiritit tregon statusin; pika te numri i dhomës tregon pastrimin.', en: 'The bar\'s colour shows the status; the dot by the room number shows the cleaning state.' },
    ],
    mistakes: [{ sq: 'Dhoma "Jashtë funksionit" nuk rezervohet; ndryshoja gjendjen te "Dhomat" kur të rregullohet.', en: 'A room "Out of order" cannot be booked; change its state under "Rooms" once it is fixed.' }],
  },
  '/hotel/reservations': {
    what: { sq: 'Rezervimet: çdo qëndrim, i rezervuar, në hotel ose i larguar. Kërko sipas mysafirit, numrit ose telefonit.', en: 'Reservations: every stay, booked, in the hotel or gone. Search by guest, number or phone.' },
    steps: [
      { sq: 'Kërko mysafirin ose filtro sipas statusit; kliko një rezervim për ta hapur.', en: 'Search for the guest or filter by status; click a reservation to open it.' },
      { sq: 'Për një të ri kliko "Rezervim i ri": shkruaj mysafirin, zgjidh dhomën, datat dhe çmimin për natë, pastaj "Rezervo dhomën".', en: 'For a new one click "New reservation": type the guest, choose the room, dates and price a night, then "Book the room".' },
      { sq: 'Kur mysafiri është në hotel, shto te "Shtesat në dhomë" minibarin, mëngjesin ose lavanderinë.', en: 'While the guest is in the hotel, add the minibar, breakfast or laundry under "Extras on the room".' },
    ],
    mistakes: [{ sq: 'Nëse fatura duhet të dalë në emër të një firme, zgjidhe te "Fatura në emër të (sipas dëshirës)" para check-out.', en: 'If the invoice must be in a company\'s name, choose it under "Invoice to (optional)" before check-out.' }],
    after: { sq: 'Shtesat dalin në faturë me check-out. Me "Anulo rezervimin" dhoma lirohet për ato net.', en: 'Extras go on the invoice at check-out. "Cancel the reservation" frees the room for those nights.' },
  },
  '/hotel/rooms': {
    what: { sq: 'Dhomat: llojet e dhomave me çmimin për natë, dhe çdo dhomë me gjendjen e pastrimit.', en: 'Rooms: the room types with their price a night, and every room with its cleaning state.' },
    steps: [
      { sq: 'Te "Llojet e dhomave" kliko "Shto": emri (teke, dyshe, suitë), sa njerëz dhe çmimi për natë me TVSH.', en: 'Under "Room types" click "Add": the name (single, double, suite), how many people and the price a night with VAT.' },
      { sq: 'Te "Dhomat" kliko "Shto dhomë", shkruaj numrin dhe zgjidh llojin.', en: 'Under "Rooms" click "Add a room", type the number and choose the type.' },
      { sq: 'Ndrysho gjendjen te "Pastrimi": "E pastër", "Për pastrim", "Për kontroll" ose "Jashtë funksionit".', en: 'Change the state under "Cleaning": "Clean", "To clean", "To inspect" or "Out of order".' },
    ],
    mistakes: [{ sq: 'Akomodimi shpesh ka TVSH të reduktuar: zgjidh normën te lloji i dhomës dhe pyet kontabilistin.', en: 'Accommodation often has a reduced VAT rate: choose it on the room type and check with your accountant.' }],
    after: { sq: 'Rezervimi i ri merr çmimin nga lloji i dhomës; mund ta ndryshosh te rezervimi.', en: 'A new reservation takes its price from the room type; you can change it on the reservation.' },
  },
}
