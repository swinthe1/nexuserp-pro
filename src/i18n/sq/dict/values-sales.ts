import type { Dict } from '../index'

/** Shitjet, agjentët, portali dhe kartelat: çdo shumë thotë nëse është me apo pa TVSH */
export default {
  // dokumentet e shitjes dhe rreshtat
  'Unit price (without VAT)': 'Çmimi për njësi (pa TVSH)',
  'Amount (without VAT)': 'Vlera (pa TVSH)',
  'Amount without VAT': 'Vlera pa TVSH',
  'Before discount, without VAT': 'Para zbritjes, pa TVSH',
  'Total with VAT ({currency})': 'Totali me TVSH ({currency})',
  'Still to pay (with VAT)': 'Mbetet për t’u paguar (me TVSH)',
  '{kind}: {n} lines, {amount} without VAT': '{kind}: {n} rreshta, {amount} pa TVSH',
  'of the order total with VAT {total}': 'nga totali i porosisë me TVSH {total}',
  '{amount} without VAT left to deduct': '{amount} pa TVSH për t’u zbritur',
  '{price} with VAT': '{price} me TVSH',
  '{price} without VAT': '{price} pa TVSH',

  // pasqyra e shitjeve
  'Sales (without VAT)': 'Shitjet (pa TVSH)',
  '{profit} after {cost} cost of goods, without VAT': '{profit} pas kostos së mallit {cost}, pa TVSH',
  'Orders taken (without VAT)': 'Porosi të marra (pa TVSH)',
  'Overdue invoices (with VAT)': 'Fatura me vonesë (me TVSH)',
  'To deliver and invoice (without VAT)': 'Për t’u dorëzuar dhe faturuar (pa TVSH)',
  'Open orders, the part not delivered yet': 'Porositë e hapura, pjesa ende pa u dorëzuar',
  'Open deals (without VAT)': 'Mundësi të hapura (pa TVSH)',
  'Last 12 months, {currency} without VAT': '12 muajt e fundit, {currency} pa TVSH',
  'Open deals by stage, without VAT': 'Mundësitë e hapura sipas fazës, pa TVSH',
  'Top customers (without VAT)': 'Klientët kryesorë (pa TVSH)',
  'Top products (without VAT)': 'Produktet kryesore (pa TVSH)',
  'By salesperson (without VAT)': 'Sipas shitësit (pa TVSH)',

  // listat, dorëzimet, abonimet
  'Cost (without VAT)': 'Kosto (pa TVSH)',
  'Cost ({currency}, without VAT)': 'Kosto ({currency}, pa TVSH)',
  'Cost of goods (without VAT)': 'Kosto e mallit (pa TVSH)',
  'Cost of goods {amount}, without VAT': 'Kosto e mallit {amount}, pa TVSH',
  'Unit cost (without VAT)': 'Kosto për njësi (pa TVSH)',
  'Each (with VAT)': 'Secila (me TVSH)',

  // partnerët dhe listat e çmimeve
  'Credit limit (with VAT)': 'Limiti i kreditit (me TVSH)',
  'Credit limit ({currency}, with VAT)': 'Limiti i kreditit ({currency}, me TVSH)',
  '{amount} with VAT, not fully invoiced yet': '{amount} me TVSH, ende jo plotësisht të faturuara',
  'Orders, total with VAT': 'Porositë, totali me TVSH',
  'Invoices, total with VAT': 'Faturat, totali me TVSH',
  'Deals, without VAT': 'Mundësitë, pa TVSH',
  'Price (without VAT)': 'Çmimi (pa TVSH)',
  'Price ({currency}, with VAT)': 'Çmimi ({currency}, me TVSH)',
  'Price ({currency}, without VAT)': 'Çmimi ({currency}, pa TVSH)',
  'Standard price (without VAT)': 'Çmimi standard (pa TVSH)',

  // mundësitë dhe kontaktet
  'Value (without VAT)': 'Vlera (pa TVSH)',
  'Value ({currency}, without VAT)': 'Vlera ({currency}, pa TVSH)',
  'Expected by probability (without VAT)': 'E pritshme sipas probabilitetit (pa TVSH)',
  '{n} deals · {total} total · {weighted} expected, without VAT': '{n} mundësi · {total} gjithsej · {weighted} të pritshme, pa TVSH',
  '{n} open deals worth {total} without VAT, {weighted} expected by probability.': '{n} mundësi të hapura me vlerë {total} pa TVSH, {weighted} të pritshme sipas probabilitetit.',
  'Est. value (without VAT)': 'Vlera e vlerësuar (pa TVSH)',
  'Estimated value (without VAT)': 'Vlera e vlerësuar (pa TVSH)',
  'Expected value (without VAT)': 'Vlera e pritshme (pa TVSH)',

  // promocionet
  'for {price} with VAT': 'për {price} me TVSH',
  'Discount given (with VAT)': 'Zbritja e dhënë (me TVSH)',

  // agjentët në terren
  'Owes (with VAT)': 'Detyrimi (me TVSH)',
  'Last orders, with VAT': 'Porositë e fundit, me TVSH',
  'Order {number} sent · {amount} with VAT': 'Porosia {number} u dërgua · {amount} me TVSH',
  '{name} · {n} products · {amount} with VAT': '{name} · {n} artikuj · {amount} me TVSH',
  'Amount (with VAT)': 'Shuma (me TVSH)',
  'Orders, with VAT': 'Porositë, me TVSH',

  // portali B2B
  'You owe (with VAT)': 'Keni detyrim (me TVSH)',

  // kartelat e besnikërisë (arka shet me TVSH)
  '{n} points per {amount} spent with VAT · 1 point = {value}': '{n} pikë për {amount} të shpenzuara me TVSH · 1 pikë = {value}',
  'Spending {spend} with VAT earns {pts} points, worth {value} off a later purchase.': 'Një blerje prej {spend} me TVSH fiton {pts} pikë, që vlejnë {value} zbritje në blerjen tjetër.',
  'Points for {amount} with VAT': 'Pikë për {amount} me TVSH',
  'Discount given with cards (with VAT)': 'Zbritje e dhënë me kartela (me TVSH)',
  '{amount} of {total}, with VAT': '{amount} nga {total}, me TVSH',
  'Discount (with VAT)': 'Zbritja (me TVSH)',
  'Spent (with VAT)': 'Shpenzuar (me TVSH)',
} satisfies Dict
