/**
 * Employment contract models and the labour-law numbers behind them (checked 31.10.2026).
 * Kosovo: Ligji i Punës Nr. 03/L-212 (art. 10, 11, 15, 20, 23, 32, 56, 69, 71, 72, 78, 79).
 * Albania: Kodi i Punës, ligji 7961/1995 as amended by 136/2015 and 91/2024 (art. 21, 83, 90–92, 142–145, 149–152).
 * The models are plain text: {{name}} is filled from the contract and the employee card, a blank line starts a
 * paragraph, a line starting with "Neni" is a heading, the first line is the title.
 */
export type Country = 'XK' | 'AL'
export type ContractKind = 'contract' | 'annex' | 'notice'

export const LAW: Record<Country, {
  name: string; nameOf: string; probationMax: number; probationDefault: number; probationNoticeDays: number; leaveDays: number; hoursPerWeek: number; worker: string
}> = {
  XK: { name: 'Ligji i Punës Nr. 03/L-212', nameOf: 'Ligjit të Punës Nr. 03/L-212', probationMax: 6, probationDefault: 3, probationNoticeDays: 7, leaveDays: 20, hoursPerWeek: 40, worker: 'I PUNËSUARI' },
  AL: { name: 'Kodi i Punës i Republikës së Shqipërisë', nameOf: 'Kodit të Punës të Republikës së Shqipërisë', probationMax: 3, probationDefault: 3, probationNoticeDays: 5, leaveDays: 22, hoursPerWeek: 40, worker: 'PUNËMARRËSI' },
}

const monthsBetween = (from: string, to: string) => {
  const a = new Date(from + 'T00:00:00Z'), b = new Date(to + 'T00:00:00Z')
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0)
}
/**
 * Notice by law, in calendar days, by length of service on the day notice is given.
 * XK art. 71: by the employer 30 / 45 / 60 days (up to 2 years / 2–10 / over 10); fixed term 30; by the employee (art. 69) 30, fixed term 15.
 * AL art. 143: both parties 2 weeks (up to 6 months) / 1 month (to 2 years) / 2 months (to 5 years) / 3 months (over 5).
 */
export function legalNoticeDays(country: Country, hired: string, on: string, opts: { byEmployee?: boolean; fixed?: boolean } = {}) {
  const m = Math.max(0, monthsBetween(hired, on))
  if (country === 'XK') {
    if (opts.byEmployee) return opts.fixed ? 15 : 30
    if (opts.fixed) return 30
    return m > 120 ? 60 : m >= 24 ? 45 : 30
  }
  return m <= 6 ? 14 : m <= 24 ? 30 : m <= 60 ? 60 : 90
}

export const CONTRACT_TYPE_SQ: Record<Country, Record<string, string>> = {
  XK: { indefinite: 'me kohë të pacaktuar', fixed_term: 'me kohë të caktuar', seasonal: 'për punë dhe detyra specifike', service: 'për shërbime' },
  AL: { indefinite: 'me kohëzgjatje të pacaktuar', fixed_term: 'me kohëzgjatje të caktuar', seasonal: 'me kohëzgjatje të caktuar (punë sezonale)', service: 'për shërbime' },
}
export const ENDED_REASON_SQ: Record<string, string> = {
  resigned: 'me kërkesë (dorëheqje) të punëmarrësit',
  dismissed: 'me vendim të punëdhënësit',
  mutual: 'me marrëveshje të palëve',
  expired: 'me skadimin e afatit të kontratës',
  probation: 'gjatë periudhës së provës',
  retired: 'për shkak të daljes në pension',
  other: 'për arsye të tjera',
}

/** the names a model can use, with what they become */
export const PLACEHOLDERS: { key: string; sq: string; en: string }[] = [
  { key: 'nr', sq: 'Numri i kontratës', en: 'Contract number' },
  { key: 'data', sq: 'Data e nënshkrimit', en: 'Signing date' },
  { key: 'vendi', sq: 'Vendi i nënshkrimit', en: 'Place of signing' },
  { key: 'ligji', sq: 'Ligji i punës i vendit', en: 'The country\'s labour law' },
  { key: 'ligjit', sq: 'Ligjit të punës (në gjinore)', en: 'The labour law, "of the" form' },
  { key: 'punedhenesi', sq: 'Emri i kompanisë', en: 'Company name' },
  { key: 'nui', sq: 'NUI / NIPT', en: 'Tax number' },
  { key: 'adresa_punedhenesit', sq: 'Adresa e kompanisë', en: 'Company address' },
  { key: 'perfaqesuesi', sq: 'Kush nënshkruan për kompaninë', en: 'Who signs for the company' },
  { key: 'pozita_perfaqesuesit', sq: 'Pozita e tij', en: 'Their position' },
  { key: 'punemarresi', sq: 'Emri i punonjësit', en: 'Employee name' },
  { key: 'nr_personal', sq: 'Numri personal', en: 'Personal number' },
  { key: 'datelindja', sq: 'Datëlindja', en: 'Date of birth' },
  { key: 'adresa_punemarresit', sq: 'Adresa e punonjësit', en: 'Employee address' },
  { key: 'pozita', sq: 'Pozita e punës', en: 'Position' },
  { key: 'pershkrimi', sq: 'Përshkrimi i punës', en: 'Job description' },
  { key: 'vendi_punes', sq: 'Vendi i punës', en: 'Place of work' },
  { key: 'njesia', sq: 'Departamenti', en: 'Department' },
  { key: 'lloji', sq: 'Lloji i kontratës', en: 'Contract type' },
  { key: 'data_fillimit', sq: 'Data e fillimit', en: 'Start date' },
  { key: 'data_mbarimit', sq: 'Data e mbarimit', en: 'End date' },
  { key: 'kohezgjatja', sq: 'Kohëzgjatja në fjali', en: 'Duration as a sentence' },
  { key: 'prova', sq: 'Periudha e provës në fjali', en: 'Probation as a sentence' },
  { key: 'oret', sq: 'Orë në javë', en: 'Hours a week' },
  { key: 'orari', sq: 'Orari', en: 'Working hours' },
  { key: 'paga', sq: 'Paga bruto', en: 'Gross pay' },
  { key: 'paga_fjale', sq: 'Paga me fjalë', en: 'Pay in words' },
  { key: 'dita_pageses', sq: 'Dita e pagesës', en: 'Pay day' },
  { key: 'pushimi', sq: 'Ditët e pushimit vjetor', en: 'Annual leave days' },
  { key: 'njoftimi_teksti', sq: 'Afatet e njoftimit në fjali', en: 'Notice periods as a sentence' },
  { key: 'kontrata_kolektive', sq: 'Kontrata kolektive', en: 'Collective agreement' },
  { key: 'iban', sq: 'IBAN i punonjësit', en: 'Employee IBAN' },
  { key: 'nr_kontrates', sq: 'Aneks: numri i kontratës që ndryshon', en: 'Annex: number of the contract it changes' },
  { key: 'data_kontrates', sq: 'Aneks: data e asaj kontrate', en: 'Annex: date of that contract' },
  { key: 'data_aneksit', sq: 'Aneks: nga kur vlen', en: 'Annex: applies from' },
  { key: 'ndryshimet', sq: 'Aneks: lista e ndryshimeve', en: 'Annex: the list of changes' },
  { key: 'arsyeja', sq: 'Njoftim: arsyeja', en: 'Notice: the reason' },
  { key: 'data_njoftimit', sq: 'Njoftim: data e njoftimit', en: 'Notice: date given' },
  { key: 'dita_fundit', sq: 'Njoftim: dita e fundit e punës', en: 'Notice: last working day' },
  { key: 'shenim', sq: 'Njoftim: shënimi', en: 'Notice: the note' },
]

/* ------------------------------------------------------------------ Kosovo */
const xkContract = (fixed: boolean) => `KONTRATË PUNE
Nr. {{nr}}

Në mbështetje të neneve 10 dhe 11 të {{ligjit}}, më {{data}} në {{vendi}}, lidhet kjo kontratë pune ndërmjet palëve:

Neni 1 – Palët kontraktuese
Punëdhënësi: {{punedhenesi}}, me seli në {{adresa_punedhenesit}}, NUI {{nui}}, i përfaqësuar nga {{perfaqesuesi}}, {{pozita_perfaqesuesit}} (në vijim: Punëdhënësi),
dhe
I punësuari: {{punemarresi}}, numri personal {{nr_personal}}, i lindur më {{datelindja}}, me vendbanim në {{adresa_punemarresit}} (në vijim: I punësuari).

Neni 2 – Pozita dhe detyrat e punës
I punësuari punësohet në pozitën: {{pozita}}.
Detyrat e punës: {{pershkrimi}}
I punësuari i kryen detyrat me përgjegjësi, sipas udhëzimeve të Punëdhënësit dhe akteve të brendshme të tij.

Neni 3 – Vendi i punës
Vendi i punës është {{vendi_punes}}. Kur puna duhet të kryhet në vende të ndryshme, Punëdhënësi e njofton të punësuarin paraprakisht.

Neni 4 – Kohëzgjatja dhe fillimi i punës
Kjo kontratë lidhet ${fixed ? '{{kohezgjatja}}. Kontrata me kohë të caktuar që vazhdohet, shprehimisht ose heshturazi, përtej dhjetë (10) viteve konsiderohet kontratë me kohë të pacaktuar.' : '{{kohezgjatja}}.'}

Neni 5 – Periudha e provës
{{prova}} Gjatë periudhës së provës secila palë mund ta ndërpresë kontratën me njoftim prej shtatë (7) ditësh.

Neni 6 – Orari i punës
Orari i plotë i punës është {{oret}} orë në javë, {{orari}}. Puna jashtë orarit kryhet vetëm sipas ligjit dhe jo më shumë se tetë (8) orë në javë.

Neni 7 – Paga
Paga bazë bruto mujore është {{paga}} ({{paga_fjale}}). Nga paga bruto mbahen kontributet pensionale dhe tatimi në të ardhurat personale, sipas ligjit.
Paga paguhet një herë në muaj, jo më vonë se data {{dita_pageses}} e muajit pasues, në llogarinë bankare të të punësuarit.
Për punë jashtë orarit, natën, në ditë festash dhe në fundjavë, i punësuari paguhet me shtesat e parapara në nenin 56 të Ligjit të Punës.

Neni 8 – Pushimi vjetor dhe lejet
I punësuari ka të drejtë në pushim vjetor me pagesë prej {{pushimi}} ditë pune në vit kalendarik, i cili rritet në rastet e parapara me ligj (një ditë pune për çdo pesë vjet përvojë pune). Pushimi vjetor shfrytëzohet pas gjashtë (6) muajve punë të pandërprerë. Lejet e tjera shfrytëzohen sipas ligjit.

Neni 9 – Detyrimet e palëve
Punëdhënësi siguron kushte të sigurta dhe të shëndetshme pune, paguan pagën dhe kontributet në kohë dhe e njofton Administratën Tatimore të Kosovës për këtë kontratë para fillimit të punës.
I punësuari respekton orarin dhe aktet e brendshme të Punëdhënësit dhe kujdeset për pasurinë që i besohet.

Neni 10 – Fshehtësia
I punësuari ruan fshehtësinë e të dhënave afariste dhe personale që i njeh në punë, gjatë kohëzgjatjes së kontratës dhe pas përfundimit të saj.

Neni 11 – Ndërprerja e kontratës
Kontrata ndërpritet me marrëveshje të palëve, me skadimin e afatit, me njoftim, ose në rastet tjera të parapara me ligj. {{njoftimi_teksti}}
Vendimi i Punëdhënësit për ndërprerjen e kontratës jepet me shkrim dhe arsyetohet.

Neni 12 – Zgjidhja e mosmarrëveshjeve
I punësuari që konsideron se i është shkelur ndonjë e drejtë, mund t'i drejtohet Punëdhënësit me kërkesë me shkrim dhe më pas gjykatës kompetente, sipas neneve 78 dhe 79 të Ligjit të Punës.

Neni 13 – Dispozitat përfundimtare
Për çështjet që nuk rregullohen me këtë kontratë zbatohen {{ligji}}, kontrata kolektive dhe aktet e brendshme të Punëdhënësit.
Kjo kontratë ndryshohet vetëm me aneks me shkrim, të nënshkruar nga të dy palët.
Kontrata hartohet në dy (2) kopje identike, nga një për secilën palë, dhe hyn në fuqi në ditën e nënshkrimit.`

/* ------------------------------------------------------------------ Albania */
const alContract = (fixed: boolean) => `KONTRATË PUNE
Nr. {{nr}}

Në mbështetje të nenit 21 të {{ligjit}}, më {{data}} në {{vendi}}, lidhet kjo kontratë pune ndërmjet palëve:

Neni 1 – Palët kontraktuese
Punëdhënësi: {{punedhenesi}}, me seli në {{adresa_punedhenesit}}, NIPT {{nui}}, i përfaqësuar nga {{perfaqesuesi}}, {{pozita_perfaqesuesit}} (në vijim: Punëdhënësi),
dhe
Punëmarrësi: {{punemarresi}}, numri personal {{nr_personal}}, i lindur më {{datelindja}}, me banim në {{adresa_punemarresit}} (në vijim: Punëmarrësi).

Neni 2 – Pozita dhe përshkrimi i punës
Punëmarrësi punësohet në pozitën: {{pozita}}.
Përshkrimi i përgjithshëm i punës: {{pershkrimi}}
Punëmarrësi e kryen punën personalisht, me kujdes dhe besnikëri, sipas udhëzimeve të Punëdhënësit.

Neni 3 – Vendi i punës
Vendi i punës është {{vendi_punes}}.

Neni 4 – Kohëzgjatja dhe fillimi i punës
Kjo kontratë lidhet ${fixed ? '{{kohezgjatja}}, për arsye objektive që lidhen me natyrën e përkohshme të punës. Nëse marrëdhënia e punës vazhdon heshturazi pas afatit, kontrata konsiderohet me kohëzgjatje të pacaktuar.' : '{{kohezgjatja}}.'}

Neni 5 – Periudha e provës
{{prova}} Gjatë periudhës së provës secila palë mund ta zgjidhë kontratën duke njoftuar palën tjetër të paktën pesë (5) ditë përpara.

Neni 6 – Orari i punës
Kohëzgjatja normale e punës është {{oret}} orë në javë, {{orari}}. Puna jashtë orarit kryhet sipas Kodit të Punës, jo më shumë se 200 orë në vit, dhe paguhet me shtesë jo më pak se 25%, ose 50% kur kryhet në ditën e pushimit javor ose në festa zyrtare.

Neni 7 – Paga
Paga bruto mujore është {{paga}} ({{paga_fjale}}). Nga paga mbahen kontributet e sigurimeve shoqërore e shëndetësore dhe tatimi mbi të ardhurat personale, sipas ligjit.
Paga paguhet një herë në muaj, jo më vonë se data {{dita_pageses}} e muajit pasues, me transfertë bankare në llogarinë e Punëmarrësit.

Neni 8 – Pushimet vjetore
Punëmarrësi ka të drejtë për pushim vjetor të paguar prej {{pushimi}} ditë pune në vit, pa llogaritur festat zyrtare.

Neni 9 – Detyrimet e palëve
Punëdhënësi siguron kushte të sigurta pune, paguan pagën dhe kontributet në kohë dhe e deklaron Punëmarrësin pranë administratës tatimore të paktën një ditë kalendarike para fillimit të punës.
Punëmarrësi respekton orarin dhe rregulloren e brendshme dhe ruan pasurinë që i besohet.

Neni 10 – Kontrata kolektive dhe masat disiplinore
Kontrata kolektive e zbatueshme: {{kontrata_kolektive}}.
Kur nuk ka kontratë kolektive, masat disiplinore janë: vërejtja me shkrim, paralajmërimi për zgjidhjen e kontratës dhe zgjidhja e kontratës për shkak të justifikuar. Asnjë masë nuk merret pa e dëgjuar më parë Punëmarrësin.

Neni 11 – Besnikëria dhe fshehtësia
Punëmarrësi nuk përdor dhe nuk u jep të tjerëve të dhëna që përbëjnë sekret profesional ose tregtar të Punëdhënësit, gjatë kontratës dhe pas përfundimit të saj.

Neni 12 – Zgjidhja e kontratës dhe afatet e njoftimit
{{njoftimi_teksti}}
Para zgjidhjes së kontratës, Punëdhënësi e fton Punëmarrësin me shkrim për një takim, të paktën 72 orë përpara, dhe ia njofton vendimin me shkrim. Pas tre vjetësh pune, Punëmarrësi përfiton shpërblim për vjetërsi sipas nenit 145 të Kodit të Punës.

Neni 13 – Mosmarrëveshjet
Mosmarrëveshjet zgjidhen me marrëveshje ndërmjet palëve; në mungesë të saj, nga gjykata kompetente.

Neni 14 – Dispozitat përfundimtare
Për çështjet që nuk rregullohen me këtë kontratë zbatohet {{ligji}}.
Kjo kontratë mund të ndryshohet vetëm me shkrim dhe me pëlqimin e të dy palëve.
Kontrata hartohet në dy (2) kopje identike, nga një për secilën palë, dhe hyn në fuqi në ditën e nënshkrimit.`

const annex = (country: Country) => `ANEKS NR. {{nr}}
I KONTRATËS SË PUNËS NR. {{nr_kontrates}}, DATË {{data_kontrates}}

Më {{data}} në {{vendi}}, ndërmjet {{punedhenesi}}, ${country === 'XK' ? 'NUI' : 'NIPT'} {{nui}}, i përfaqësuar nga {{perfaqesuesi}}, dhe ${country === 'XK' ? 'të punësuarit' : 'punëmarrësit'} {{punemarresi}}, numri personal {{nr_personal}}, palët bien dakord si vijon:

Neni 1 – Ndryshimet
Nga data {{data_aneksit}} kontrata e punës ndryshon si vijon:
{{ndryshimet}}

Neni 2 – Dispozitat e tjera
Të gjitha dispozitat e tjera të kontratës së punës mbeten të pandryshuara.

Neni 3 – Hyrja në fuqi
Ky aneks është pjesë përbërëse e kontratës së punës, hartohet në dy (2) kopje identike dhe vlen nga data {{data_aneksit}}.`

const notice = (country: Country) => `NJOFTIM
PËR ${country === 'XK' ? 'NDËRPRERJEN' : 'ZGJIDHJEN'} E KONTRATËS SË PUNËS

Për: {{punemarresi}}, numri personal {{nr_personal}}
Pozita: {{pozita}}

Ju njoftojmë se kontrata juaj e punës Nr. {{nr}}, në fuqi nga data {{data_fillimit}}, përfundon {{arsyeja}}.

Njoftimi jepet më {{data_njoftimit}}. Dita juaj e fundit e punës është {{dita_fundit}}.

{{shenim}}

Deri në ditën e fundit vazhdoni punën sipas kontratës. Paga deri në ditën e fundit dhe pushimi vjetor i pashfrytëzuar paguhen sipas ligjit.

{{e_drejta_ankeses}}`

export const CONTRACT_MODELS: Record<Country, { indefinite: string; fixed: string; service: string; annex: string; notice: string }> = {
  XK: { indefinite: xkContract(false), fixed: xkContract(true), service: xkContract(true), annex: annex('XK'), notice: notice('XK') },
  AL: { indefinite: alContract(false), fixed: alContract(true), service: alContract(true), annex: annex('AL'), notice: notice('AL') },
}

/** the notice clause in words: what the contract says, or the law's table */
export function noticeSentence(country: Country, noticeDays: number | null, fixed: boolean) {
  if (noticeDays != null) return `Afati i njoftimit për ndërprerjen e kontratës është ${noticeDays} ditë kalendarike për të dy palët, por jo më i shkurtër se afati i parashikuar me ligj.`
  if (country === 'XK') return fixed
    ? 'Punëdhënësi që nuk e vazhdon kontratën e njofton të punësuarin me shkrim të paktën 30 ditë para skadimit të saj. Për ndërprerje para afatit, Punëdhënësi jep njoftim prej 30 ditësh, ndërsa i punësuari prej 15 ditësh.'
    : 'Punëdhënësi jep njoftim me shkrim prej 30 ditësh kalendarike për punë nga 6 muaj deri në 2 vjet, 45 ditësh për punë nga 2 deri në 10 vjet dhe 60 ditësh për punë mbi 10 vjet. I punësuari jep njoftim me shkrim prej 30 ditësh.'
  return 'Secila palë mund ta zgjidhë kontratën duke respektuar afatet e njoftimit të nenit 143 të Kodit të Punës: 2 javë në 6 muajt e parë të punës, 1 muaj për punë deri në 2 vjet, 2 muaj për punë nga 2 deri në 5 vjet dhe 3 muaj për punë mbi 5 vjet.'
}
export function appealSentence(country: Country, reason: string | null) {
  if (reason !== 'dismissed' && reason !== 'probation') return ''
  return country === 'XK'
    ? 'Nëse nuk pajtoheni me këtë vendim, mund t\'i drejtoheni Punëdhënësit me kërkesë me shkrim brenda tridhjetë (30) ditëve dhe më pas gjykatës kompetente, sipas neneve 78 dhe 79 të Ligjit të Punës.'
    : 'Nëse nuk pajtoheni me këtë vendim, mund t\'i drejtoheni gjykatës kompetente sipas Kodit të Punës.'
}
