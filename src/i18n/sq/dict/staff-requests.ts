import type { Dict } from '../index'

/** From the meeting with the administrative staff: duplicates, new items, stock in every unit, transfers */
export default {
  "Already entered as {number} on {date}, {total} ({vendor}).": "Është regjistruar tashmë si {number} më {date}, {total} ({vendor}).",
  "This invoice is already in: {number}": "Kjo faturë është tashmë në sistem: {number}",
  "Items that came on supplier invoices and are not in DrisPRO yet. Make them, or refuse them with a reason; the one who asked is told. After it is made, set its category and selling price on the item.": "Artikujt që erdhën me faturat e furnitorëve dhe nuk janë ende në DrisPRO. Krijoji, ose refuzoji me arsye; ai që i kërkoi njoftohet. Pasi krijohet, vendosi kategorinë dhe çmimin e shitjes te artikulli.",
  "Make the item": "Krijo artikullin",
  "New items from supplier invoices": "Artikujt e rinj nga faturat e furnitorëve",
  "New items need approval": "Artikujt e rinj kërkojnë miratim",
  "New items to approve": "Artikuj të rinj për miratim",
  "Nothing decided yet": "Ende asgjë e vendosur",
  "Off: whoever enters a supplier invoice may make a new item from its line. Turn it on so that new items wait for someone who approves items.": "Fikur: kushdo që regjistron faturën e furnitorit mund të krijojë artikull të ri nga rreshti i saj. Ndize që artikujt e rinj të presin dikë që i miraton.",
  "On: an item that is not in DrisPRO yet is not made from an invoice by whoever enters it. The line waits, and the people who approve items make it or refuse it under Products → New items to approve.": "Ndezur: artikulli që nuk është ende në DrisPRO nuk krijohet nga fatura nga kushdo që e regjistron. Rreshti pret, dhe personat që miratojnë artikuj e krijojnë ose e refuzojnë te Artikujt → Artikuj të rinj për miratim.",
  "Refuse {name}?": "Të refuzohet {name}?",
  "Refused: {reason}": "U refuzua: {reason}",
  "Refused; the one who asked is told": "U refuzua; ai që e kërkoi njoftohet",
  "Stock in every unit": "Gjendja në çdo njësi",
  "The item is made; the one who asked is told": "Artikulli u krijua; ai që e kërkoi njoftohet",
  "The one who asked sees the reason. For example: it is already in DrisPRO under another name.": "Ai që e kërkoi e sheh arsyen. Për shembull: është tashmë në DrisPRO me emër tjetër.",
  "barcode {code}": "barkodi {code}",
  "cost {amount}": "kosto {amount}",
  "stock-by-unit": "gjendja-sipas-njesive",
  "supplier code {code}": "kodi i furnitorit {code}",
  "{name} is not in DrisPRO yet: it was sent for approval. Once it is made, the line is found.": "{name} nuk është ende në DrisPRO: u dërgua për miratim. Pasi të krijohet, rreshti gjendet.",
  "{n} items, on hand in each store and warehouse. Click an item to open its card.": "{n} artikuj, gjendja në çdo njësi. Kliko një artikull për ta hapur.",
  "{n} new items to approve": "{n} artikuj të rinj për miratim",
  "{n} of the chosen items have no stock anywhere.": "{n} nga artikujt e zgjedhur nuk kanë stok askund.",
} satisfies Dict
