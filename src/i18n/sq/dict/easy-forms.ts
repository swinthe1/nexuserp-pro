import type { Dict } from '../index'

/** Libri i arkës dhe artikulli i ri i shkurtër */
export default {
  // libri i arkës
  'Amounts in {cur}.': 'Shumat në {cur}.',
  'Cash desk': 'Arka',
  'Went out': 'Doli',
  'End of day': 'Në fund të ditës',
  'Cash': 'Arka',
  'Total of {date}': 'Gjithsej më {date}',
  // artikulli i ri
  'The item is saved, but the opening stock is not: {why}': 'Artikulli u ruajt, por gjendja fillestare jo: {why}',
  'The item': 'Artikulli',
  'What is needed to sell it today. Everything else can wait under “More”.': 'Ajo që duhet për ta shitur sot. Të tjerat mund të presin te “Më shumë”.',
  'Scan it or type it': 'Skanoje ose shkruaje',
  'Make one': 'Krijo një',
  'Selling price with VAT': 'Çmimi i shitjes me TVSH',
  'Without VAT: {amount}': 'Pa TVSH: {amount}',
  'Quantity on the shelf now': 'Sasia në raft tani',
  'Purchase price without VAT': 'Çmimi i blerjes pa TVSH',
  'It goes into the stock as opening stock, valued at this price.': 'Hyn në stok si gjendje fillestare, me këtë çmim.',
  'Less': 'Më pak',
  'More: type, category, purchase VAT, variants, reorder points, weight and customs': 'Më shumë: lloji, grupi, TVSH-ja e blerjes, variantet, porositë automatike, pesha dhe dogana',
  'Kind and group': 'Lloji dhe grupi',
  // grupet brenda menysë
  'Customers and prices': 'Klientët dhe çmimet',
  'New customers': 'Klientë të rinj',
  'In the field and online': 'Në terren dhe online',
  'Goods in and out': 'Hyrjet dhe daljet',
  'Prices and labels': 'Çmimet dhe etiketat',
  'Setup|group': 'Rregullimet',
  'Books and declarations': 'Librat dhe deklaratat',
  'Other taxes': 'Tatime të tjera',
  // gabimet nga serveri
  'The opening quantity must be more than zero': 'Sasia fillestare duhet të jetë më e madhe se zero',
  'An item with variants gets its opening stock per variant, with a stock adjustment': 'Artikulli me variante e merr gjendjen fillestare për çdo variant, me një rregullim stoku',
} satisfies Dict
