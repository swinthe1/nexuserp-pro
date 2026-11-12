/**
 * ATK's technical test of the SEF (the Commission's invitation, 12 November 2026; Kushtet dhe Procedurat, neni 6):
 * every coupon has five items, and the coupons together cover the VAT rates, prices and quantities with two and
 * four decimals, discounts on a line and on the whole sale (in % and in euro), the ways of paying, returns and a
 * cancellation; then the till without internet, the receipt book, the clock and the log.
 * A sale scenario fills the till with one click; the others say what to do, step by step.
 */
import { msg } from '@/i18n'
import type { CatalogItem } from './api'

export interface ScenarioLine { variant_id: string; qty: number; discount: number; off?: number }
export interface Scenario {
  id: string
  title: string
  /** what ATK checks with it */
  checks: string
  steps: string[]
  /** a sale the till can fill by itself */
  sale?: { qty: number[]; discount?: number[]; off?: number[]; saleDisc?: { pct?: number; value?: number }; pay: string }
}

export const SCENARIOS: Scenario[] = [
  { id: 'rates', title: msg('Five items with different VAT rates, paid in cash'), checks: msg('The VAT rates A, C, D and E on one coupon, VAT by rate, the total without VAT, payment in cash.'),
    sale: { qty: [2, 1, 3, 1, 2], pay: msg('Pay in cash (F5), with more than the total, so the change shows.') },
    steps: [msg('Press "Fill the till". Five items come, one of each VAT rate the company sells.'), msg('Pay in cash with a note bigger than the total.'), msg('The coupon prints with the QR code; scan it with ATK\'s app.')] },
  { id: 'decimals', title: msg('Quantities and prices with two and four decimals, paid by card'), checks: msg('Quantity 1,25 and 0,3575; a price with four decimals; the total rounded to two.'),
    sale: { qty: [1.25, 0.3575, 2.5, 1, 0.125], pay: msg('Pay by card (F6) and choose the bank.') },
    steps: [msg('Before the test, give one item a price with four decimals (for example 0,3333 €) on its item page.'), msg('Press "Fill the till": the quantities come with two and four decimals.'), msg('Pay by card and choose the bank\'s terminal.')] },
  { id: 'line-discount', title: msg('A discount on an item, in % and in euro'), checks: msg('The price ATK gets is the price with the discount; the paper shows the shelf price and the discount with a minus.'),
    sale: { qty: [2, 3, 1, 1, 1], discount: [10, 0, 0, 0, 0], off: [0, 0.5, 0, 0, 0], pay: msg('Pay in cash.') },
    steps: [msg('Press "Fill the till": the first item has 10 % off, the second 0,50 € off.'), msg('Pay. On the coupon each discount is under its item, with a minus.')] },
  { id: 'sale-discount-pct', title: msg('A discount on the whole sale, in %'), checks: msg('The subtotal, the discount on it with a minus, the total; VAT by rate after the discount.'),
    sale: { qty: [1, 2, 1, 3, 1], saleDisc: { pct: 5 }, pay: msg('Pay by card.') },
    steps: [msg('Press "Fill the till": the sale has 5 % off the total.'), msg('Pay. The coupon shows the subtotal, then the discount on the total.')] },
  { id: 'sale-discount-value', title: msg('A discount on the whole sale, in euro, paid in cash and by card together'), checks: msg('A discount in euro on the total; a payment split between cash and card.'),
    sale: { qty: [2, 2, 1, 1, 4], saleDisc: { value: 1 }, pay: msg('Pay part in cash, the rest by card.') },
    steps: [msg('Press "Fill the till": the sale has 1,00 € off the total.'), msg('In the payment window type a part in cash, then pay the rest by card.')] },
  { id: 'return-part', title: msg('A return of some items of a sale'), checks: msg('A return coupon that names the original coupon; the VAT of the returned items.'),
    steps: [msg('In the till press "Refund" (F9) and scan or type the number of a coupon made above.'), msg('Choose two of its items and the reason, then confirm.'), msg('The return coupon prints with the number of the original coupon.')] },
  { id: 'return-all', title: msg('A return of a whole sale'), checks: msg('Every item of a coupon returned; nothing more can be returned on it afterwards.'),
    steps: [msg('Press "Refund" (F9), find another coupon made above and choose all its items.'), msg('Try to return the same coupon again: the program refuses.')] },
  { id: 'cancel', title: msg('A cancellation of a coupon'), checks: msg('A cancellation coupon with its reason, tied to the original coupon.'),
    steps: [msg('Press "Refund" (F9), find a coupon nothing was returned from and tick "Cancel the whole coupon: it was issued by mistake".'), msg('Write the reason. The cancellation coupon prints with it.')] },
  { id: 'offline', title: msg('The till without internet'), checks: msg('Coupons made and kept safe without internet, marked OFFLINE, in order; sent by themselves when the internet is back; the event in the log.'),
    steps: [msg('Take the internet away from the computer (the cable or the Wi-Fi).'), msg('The till shows that it works without internet. Make two sales: the coupons print with the QR code and the word OFFLINE.'), msg('Give the internet back. The sales go to ATK by themselves; on the SEF page "Waiting to be sent" goes back to 0.'), msg('The log shows "Internet lost", "Internet back" and the two coupons sent.')] },
  { id: 'block', title: msg('A coupon from the fiscal receipt book'), checks: msg('A coupon written by hand while the till was fully down is registered afterwards with the book\'s number and its time.'),
    steps: [msg('In the till open "More" and choose "From the receipt book".'), msg('Type the number in the book and the date and time written on it, then make the sale as written.')] },
  { id: 'copy', title: msg('A copy of a coupon'), checks: msg('A coupon printed again is marked "COPY OF THE COUPON".'),
    steps: [msg('On the tills page open the shift, go to "Receipts" and press "Reprint" on a coupon.')] },
  { id: 'clock', title: msg('The clock'), checks: msg('The till takes the time from the server, so a computer with a wrong clock still writes the right time.'),
    steps: [msg('Move the computer\'s clock one hour ahead and make a sale.'), msg('The coupon has the right time, and the log has "Clock off".'), msg('Put the computer\'s clock back.')] },
  { id: 'log', title: msg('The log: PayLoad, Hash Chain and Integrity Check'), checks: msg('Every send and failed send to the second, the errors, the changes; each row with its payload, the previous hash and its own; a check of the chain; the export.'),
    steps: [msg('On the SEF page go to "The SEF log" and press "Integrity check": the chain holds.'), msg('Press "Download the log (CSV)": the file has PayLoad, Previous Hash, Current Hash and Integrity Check for every row.'), msg('Under "Waiting to be sent" there is the file of the coupons ATK has not taken yet.')] },
  { id: 'no-vat', title: msg('A taxpayer not registered for VAT'), checks: msg('No VAT number at the head, every item under the 0 % letter (C), no VAT in the totals.'),
    steps: [msg('Open a test company with no VAT number in its details and register a till for it.'), msg('Make a sale of five items: the coupon has no VAT number and no VAT.')] },
]

/**
 * Five items for a scenario: one of each VAT rate the catalog has first (so A, C, D and E are on the coupon), then
 * more of what is in stock; items sold by weight take the quantities with decimals.
 */
export function scenarioLines(catalog: CatalogItem[], sc: Scenario): ScenarioLine[] {
  if (!sc.sale) return []
  const ok = catalog.filter((c) => c.price > 0 && c.product_type !== 'service' && c.tracking !== 'serial' && c.tracking !== 'lot')
  const pool = ok.length >= 5 ? ok : catalog.filter((c) => c.price > 0)
  const byStock = [...pool].sort((a, b) => b.on_hand - a.on_hand)
  const picked: CatalogItem[] = []
  for (const rate of [...new Set(byStock.map((c) => `${c.tax_rate}|${c.tax_code_id ?? ''}`))]) {
    const item = byStock.find((c) => `${c.tax_rate}|${c.tax_code_id ?? ''}` === rate && !picked.includes(c))
    if (item && picked.length < 5) picked.push(item)
  }
  for (const c of byStock) { if (picked.length >= 5) break; if (!picked.includes(c)) picked.push(c) }
  return picked.map((c, i) => ({ variant_id: c.variant_id, qty: sc.sale!.qty[i] ?? 1, discount: sc.sale!.discount?.[i] ?? 0, off: sc.sale!.off?.[i] || undefined }))
}
