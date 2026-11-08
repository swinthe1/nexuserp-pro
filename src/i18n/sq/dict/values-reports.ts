import type { Dict } from '../index'

/** Shumat në përmbledhje, financë dhe raporte: çdo shumë thotë me apo pa TVSH */
export default {
  // paneli
  'Sales this month (without VAT)': 'Shitjet këtë muaj (pa TVSH)',
  'Sales this month (with VAT)': 'Shitjet këtë muaj (me TVSH)',
  '{n} invoices · {pct}% gross margin, without VAT': '{n} fatura · {pct}% marzh bruto, pa TVSH',
  '{n} receipts · {pct}% gross margin without VAT · old program': '{n} kupona · {pct}% marzh bruto pa TVSH · programi i vjetër',
  'Unpaid invoices past due (with VAT)': 'Fatura të papaguara me afat të kaluar (me TVSH)',
  'Customers late paying (with VAT)': 'Klientë që vonojnë pagesën (me TVSH)',
  'of {amount} customers owe in total, with VAT': 'nga {amount} që klientët detyrojnë gjithsej, me TVSH',
  'Bills to pay soon (with VAT)': 'Fatura për t’u paguar së shpejti (me TVSH)',
  'Orders to deliver and invoice (without VAT)': 'Porosi për t’u dorëzuar dhe faturuar (pa TVSH)',
  'Net profit this month (without VAT)': 'Fitimi neto këtë muaj (pa TVSH)',
  'Last 30 days, at purchase price without VAT ({currency})': '30 ditët e fundit, me çmim blerjeje pa TVSH ({currency})',
  'At purchase price, without VAT': 'Me çmim blerjeje, pa TVSH',
  'Cost, without VAT': 'Kosto, pa TVSH',
  '{amount} with VAT from {n} receipts today, from the old program. Updates by itself.': '{amount} me TVSH nga {n} kupona sot, nga programi i vjetër. Përditësohet vetë.',
  '{amount} this month, with VAT': '{amount} këtë muaj, me TVSH',
  '{amount} in {n} stores and warehouses, at purchase price (average cost) without VAT. Open one to see its items.':
    '{amount} në {n} njësi, me çmim blerjeje (kosto mesatare) pa TVSH. Hapni njërën për të parë artikujt.',
  'At purchase price (average cost), without VAT. Open one to see its items.': 'Me çmim blerjeje (kosto mesatare), pa TVSH. Hapni njërën për të parë artikujt.',

  // financa
  'Revenue (without VAT)': 'Të ardhurat (pa TVSH)',
  'Cost of goods sold {amount}, without VAT': 'Kostoja e mallit të shitur {amount}, pa TVSH',
  'Net profit (without VAT)': 'Fitimi neto (pa TVSH)',
  'Customers owe (with VAT)': 'Klientët detyrojnë (me TVSH)',
  'You owe vendors (with VAT)': 'U detyroheni furnitorëve (me TVSH)',
  'Stock value in the accounts (at purchase price, without VAT)': 'Vlera e stokut në kontabilitet (me çmim blerjeje, pa TVSH)',
  'Cash and bank at the end of each month (bars, left scale) and the month’s net profit without VAT (line, right scale), last 12 months':
    'Arka dhe banka në fund të çdo muaji (shtyllat, shkalla majtas) dhe fitimi neto i muajit pa TVSH (vija, shkalla djathtas), 12 muajt e fundit',
  'Revenue, gross profit and net profit, without VAT, {cur}': 'Të ardhurat, fitimi bruto dhe fitimi neto, pa TVSH, {cur}',
  'Total to collect (with VAT)': 'Gjithsej për t’u arkëtuar (me TVSH)',
  'Total to pay (with VAT)': 'Gjithsej për t’u paguar (me TVSH)',
  'Overdue (with VAT)': 'Me afat të kaluar (me TVSH)',
  'Over 90 days (with VAT)': 'Mbi 90 ditë (me TVSH)',
  'Open, with VAT': 'E hapur, me TVSH',
  'Total open, with VAT': 'Gjithsej e hapur, me TVSH',
  'open {amount}, with VAT': 'e hapur {amount}, me TVSH',
  'The receipt says {amount} with VAT': 'Kuponi shkruan {amount} me TVSH',
  'Sales of the day, with VAT': 'Shitjet e ditës, me TVSH',
  'The report says {amount} with VAT': 'Raporti shkruan {amount} me TVSH',
  'Cost (without VAT)': 'Kosto (pa TVSH)',
  'Cost of assets in use (without VAT)': 'Kostoja e aseteve në përdorim (pa TVSH)',
  'Proceeds {amount}, without VAT': 'Të ardhura nga shitja {amount}, pa TVSH',
  'Sale amount without VAT (0 if scrapped)': 'Shuma e shitjes pa TVSH (0 nëse nxirret jashtë përdorimit)',

  // tatimet
  'Gross income (with VAT)': 'Të ardhurat bruto (me TVSH)',
  'Purchases (with VAT)': 'Blerjet (me TVSH)',

  // historiku
  'Sales (with VAT)': 'Shitjet (me TVSH)',
  'Average sale (with VAT)': 'Shitja mesatare (me TVSH)',
  'With VAT, as on the documents of the old program': 'Me TVSH, siç janë në dokumentet e programit të vjetër',
  'Sales with VAT': 'Shitjet me TVSH',

  // kontabilisti
  'Sold at {amount}, without VAT': 'Shitur me {amount}, pa TVSH',
  '{amount} overdue from customers, with VAT': '{amount} me afat të kaluar nga klientët, me TVSH',

  // raportet (etiketat vijnë nga baza e të dhënave)
  'Revenue, without VAT': 'Të ardhurat, pa TVSH',
  'Margin, without VAT': 'Marzhi, pa TVSH',
  'Discounts given, without VAT': 'Zbritjet e dhëna, pa TVSH',
  'Amount without VAT': 'Vlera pa TVSH',
  'Margin when sold, without VAT': 'Marzhi kur të shitet, pa TVSH',
  'Planned for output, without VAT': 'Planifikuar për prodhimin, pa TVSH',
  'Actual cost, without VAT': 'Kosto faktike, pa TVSH',
  'Variance, without VAT': 'Diferenca, pa TVSH',
  'Unit cost, without VAT': 'Kostoja për njësi, pa TVSH',
  'Open amount, with VAT': 'Shuma e hapur, me TVSH',
} satisfies Dict
