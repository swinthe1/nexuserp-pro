import type { L } from './types'

/** Short explanations next to hard fields: the small ⓘ, one or two sentences */
export const TIPS: Record<string, L> = {
  exchange_rate: { sq: 'Sa euro ose lekë vlen 1 njësi e monedhës së dokumentit në atë ditë. Plotësohet vetë nga kursi i ditës.', en: 'What 1 unit of the document\'s currency is worth that day. Filled in from the day\'s rate.' },
  payment_terms: { sq: 'Brenda sa ditëve paguan klienti ose furnitori, ose me çfarë këstesh. Vjen nga kartela e partnerit; mund ta ndryshosh për këtë dokument.', en: 'Within how many days the partner pays, or in which instalments. Comes from the partner\'s card; you can change it here.' },
  due_date: { sq: 'Dita e fundit e pagesës. Pas saj fatura del si e vonuar te Borxhet dhe klienti merr kujtesë (nëse janë të ndezura).', en: 'The last day to pay. After it the invoice shows as overdue in Debts and the customer gets a reminder (if switched on).' },
  blind_count: { sq: 'Punëtori nuk e sheh sa duhet të jetë në raft, që të numërojë atë që sheh e jo atë që pret.', en: 'The counter does not see the expected quantity, so they count what they see, not what they expect.' },
  early_discount: { sq: 'Nëse fatura paguhet brenda këtyre ditëve, partneri jep këtë zbritje. Propozimi i pagesave i nxjerr këto të parat.', en: 'If paid within these days, the partner gives this discount. The payment proposal puts these first.' },
  instalments: { sq: 'Totali ndahet në pjesë me data të ndryshme. Pagesat mbyllin së pari këstin më të vjetër; kujtesat dhe borxhet llogariten për çdo këst.', en: 'The total is split into parts with their own dates. Payments settle the oldest part first; reminders and debts count each part.' },
  unit_place: { sq: 'Njësia është vendi ku ndodhet malli: pika e shitjes, depoja ose magazina.', en: 'The unit is where the goods are: the shop, the depot or the warehouse.' },
  margin_all: { sq: 'Marzha mbi koston e blerjes. Me "Vendos çmimet" programi llogarit çmimin e shitjes për çdo rresht.', en: 'The margin over the purchase cost. "Set prices" works out the selling price for each line.' },
  pay_from: { sq: 'Nga cila arkë ose bankë dalin paratë. Shuma e saj pas pagesës tregohet krah.', en: 'Which cash box or bank the money leaves from. What is left after paying is shown next to it.' },
  with_estimates: { sq: 'Shton faturat dhe blerjet që nuk janë bërë ende, sipas mesatares së 8 javëve të fundit. Fike për të parë vetëm atë që është e sigurt.', en: 'Adds invoices and purchases not made yet, by the average of the last 8 weeks. Switch off to see only what is certain.' },
  opening_qty: { sq: 'Sa copë janë tani në raft. Hyjnë si gjendje fillestare me koston që shkruan.', en: 'How many pieces are on the shelf now. They go in as opening stock at the cost you type.' },
  price_with_vat: { sq: 'Çmimi që paguan klienti, me TVSH. Çmimi pa TVSH llogaritet vetë sipas normës.', en: 'The price the customer pays, VAT included. The price without VAT is worked out from the rate.' },
  credit_limit: { sq: 'Sa mund të të ketë borxh klienti. Porositë mbi këtë kufi ndalen derisa t\'i miratojë menaxheri.', en: 'How much the customer may owe you. Orders over the limit stop until a manager approves.' },
  recount: { sq: 'Rreshtat me diferencë më të madhe se kjo vlerë ose përqindje kthehen për t\'u numëruar përsëri. Numërimi i parë ruhet.', en: 'Lines with a difference bigger than this value or percent go back to be counted again. The first count is kept.' },
  reminder_steps: { sq: 'Pas sa ditësh vonese i shkon klientit kujtesa, p.sh. 3, 15, 30. Çdo hap dërgohet një herë.', en: 'After how many days late the customer is reminded, e.g. 3, 15, 30. Each step is sent once.' },
}
