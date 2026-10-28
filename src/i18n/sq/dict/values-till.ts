import type { Dict } from '../index'

/** Arka, restoranti, hoteli, terminet: çdo shumë thotë nëse është me apo pa TVSH */
export default {
  // arka
  'with VAT|short': 'me TVSH',
  'Total with VAT|till': 'Totali me TVSH',
  '{price} each, with VAT': '{price} njësia, me TVSH',
  'Line total, with VAT': 'Totali i rreshtit, me TVSH',
  '{a} sold · {b} can be returned · {price} with VAT': '{a} të shitura · {b} mund të kthehen · {price} me TVSH',
  'Sales (with VAT)': 'Shitjet (me TVSH)',
  'Sales (without VAT)': 'Shitjet (pa TVSH)',
  'Closed sales today, with VAT': 'Shitjet e mbyllura sot, me TVSH',
  '{n} Z-report': '{n} raport Z',
  '{n} Z-reports': '{n} raporte Z',
  'Discounts given (with VAT)': 'Zbritjet e dhëna (me TVSH)',
  'Best sellers · sales with VAT': 'Më të shiturat · shitjet me TVSH',
  'Gross sales (with VAT)': 'Shitjet bruto (me TVSH)',
  'Refunds (with VAT)': 'Kthimet (me TVSH)',
  'Total with VAT {currency}': 'Totali me TVSH {currency}',
  // restoranti
  'To pay, with VAT': 'Për të paguar, me TVSH',
  'Takings (with VAT)': 'Xhiroja (me TVSH)',
  'Per guest (with VAT)': 'Për mysafir (me TVSH)',
  'Discounts (with VAT)': 'Zbritjet (me TVSH)',
  'Cancelled after sending · value with VAT': 'Anuluar pas dërgimit · vlera me TVSH',
  // hoteli
  '{amount} a night, with VAT': '{amount} nata, me TVSH',
  'Invoiced for stays this month, with VAT': 'Faturuar për qëndrimet këtë muaj, me TVSH',
  'Amount (with VAT)': 'Shuma (me TVSH)',
  // terminet dhe abonimet
  '{amount} expected, with VAT': '{amount} të pritshme, me TVSH',
  '{amount} with VAT': '{amount} me TVSH',
} satisfies Dict
