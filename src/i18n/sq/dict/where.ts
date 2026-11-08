/** Check item: one item across every store and warehouse, and where to take it from (src/features/inventory/where.ts, unit-stock, item-check-page) */
const dict: Record<string, string> = {
  'Check item|menu': 'Kontrollo artikullin',
  'Check item': 'Kontrollo artikullin',
  'Check another item': 'Kontrollo një artikull tjetër',
  'How much every store has, and where to take it from': 'Sa ka çdo njësi dhe nga ku ta marrësh',
  'Scan the item or type its name': 'Skano artikullin ose shkruaj emrin',
  'Scan any item to see how much every store and warehouse has. When your unit is short, it tells you which unit to take it from.':
    'Skano çdo artikull për të parë sa ka çdo njësi. Kur njësisë sate i mungon, të tregon nga cila njësi ta marrësh.',
  '{n} items match “{q}”: tap one': '{n} artikuj përputhen me “{q}”: zgjidh njërin',
  'Back to the {n} matches': 'Kthehu te {n} artikujt e gjetur',
  'My unit': 'Njësia ime',
  'My unit: {name}': 'Njësia ime: {name}',
  'All units': 'Të gjitha njësitë',
  'Price {price}': 'Çmimi {price}',
  'Item page': 'Faqja e artikullit',

  "Doesn't carry it": 'Nuk e mban',
  'None free': "S'ka të lirë",
  'Low|stock': 'Pak',
  'In stock|unit': 'Ka',
  'keeps {min}–{max}': 'mban {min}–{max}',
  '{n} promised to another unit': '{n} të premtuara për një njësi tjetër',
  '+{n} on the way': '+{n} në rrugë',
  '{n} sold in 30 days': '{n} të shitura në 30 ditë',
  'on the road': 'në rrugë',
  'asked for': 'e kërkuar',
  'draft|transfer': 'draft',
  'from {unit}': 'nga {unit}',

  '{unit}: {n} already on the way': '{unit}: {n} janë tashmë në rrugë',
  'That is enough for now; nothing more to ask for.': 'Mjafton për tani; nuk duhet kërkuar gjë tjetër.',
  '{unit}: no other unit can spare it': '{unit}: asnjë njësi tjetër nuk ka tepricë',
  'Order {n} {unit} from the supplier': 'Porosit {n} {unit} nga furnitori',
  'Order it from the supplier': 'Porosite nga furnitori',
  '{n} already on the way': '{n} tashmë në rrugë',
  'Open replenishment': 'Hap furnizimin',
  'This fills {unit} up to its maximum of {max}.': 'Kështu {unit} mbushet deri te maksimumi i saj prej {max}.',
  'About two weeks of sales.': 'Rreth dy javë shitje.',
  'Half of what {unit} can spare.': 'Gjysma e asaj që i tepron {unit}.',
  'Take {n} {unit} from {from}': 'Merr {n} {unit} nga {from}',
  '{to} has {n}. {from} has {has} and can give {spare} without going under its own minimum.':
    '{to} ka {n}. {from} ka {has} dhe mund të japë {spare} pa rënë nën minimumin e vet.',
  '{to} has {n}. {from} has {spare} free.': '{to} ka {n}. {from} ka {spare} të lira.',
  '{to} has {n}. {from} has {has} and keeps half for itself.': '{to} ka {n}. {from} ka {has} dhe gjysmën e mban për vete.',
  'The other {n} have to be bought.': 'Të tjerat {n} duhen blerë.',
  'Ask {unit} for it': 'Kërko nga {unit}',
  'A transfer request goes to {from}; the people there are told. They send it and {to} counts it when it arrives.':
    'Një kërkesë për transferim shkon te {from} dhe njerëzit atje njoftohen. Ata e dërgojnë, dhe {to} e numëron kur arrin.',
  'Added to request {number}': 'U shtua te kërkesa {number}',
  'Request {number} sent to {unit}': 'Kërkesa {number} u dërgua te {unit}',
  '{unit} has only {n} free.': '{unit} ka vetëm {n} të lira.',
  'e.g. needed for the weekend': 'p.sh. duhet për fundjavë',
  'Send request': 'Dërgo kërkesën',
  '{n} free in all, in {units} of {all} units': '{n} të lira gjithsej, në {units} nga {all} njësi',
  '{unit} has enough: {n}': '{unit} ka mjaft: {n}',
  'No unit is short of it.': 'Asnjë njësi nuk ka mungesë.',
  'No unit has it yet.': 'Asnjë njësi nuk e ka ende.',
  'In every unit': 'Në çdo njësi',
  'How much each store and warehouse has, and where to take it from when one is short.':
    'Sa ka çdo njësi, dhe nga ku ta marrësh kur njërës i mungon.',

  // till
  'no other unit has it': 'asnjë njësi tjetër nuk e ka',
  'has it: {list}': 'e ka: {list}',

  // replenishment
  'Take from other units before buying': 'Merr nga njësitë e tjera para se të blesh',
  'When another store or warehouse has more than its minimum, that is moved first and only the rest is bought.':
    'Kur një njësi tjetër ka më shumë se minimumi i vet, ajo transferohet së pari dhe blihet vetëm pjesa që mbetet.',
}
export default dict
