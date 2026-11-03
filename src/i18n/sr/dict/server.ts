/** Serbian (Latin): messages written by the database at the till and on the ATK pages (exact ones; those with values are in ../server-templates.ts). */
import type { Dict } from '../index'

export default {
  "A refund cannot be refunded": "Povraćaj ne može ponovo da se vrati",
  "Choose the receipt being refunded": "Izaberite kupon koji se vraća",
  "Payments are positive on sales and negative on refunds": "Plaćanja su pozitivna kod prodaje i negativna kod povraćaja",
  "Till not found": "Kasa nije pronađena",
  "The order still has items to pay or cancel": "Porudžbina još ima stavke za plaćanje ili otkazivanje",
  "Open the till first; paying needs an open shift": "Prvo otvorite kasu; za plaćanje je potrebna otvorena smena",
  "SESSION_CLOSED: open the till first; paying needs an open shift": "Prvo otvorite kasu; za plaćanje je potrebna otvorena smena",
  "This computer is no longer a shared till; sign in with email": "Ovaj računar više nije zajednička kasa; prijavite se e-poštom",
  "Close the open shift of this till first": "Prvo zatvorite otvorenu smenu ove kase",
  "That shift was closed before they were sent: its count is short by them and this shift is over by them.": "Ta smena je zatvorena pre nego što su poslate: njeno brojanje pokazuje manjak za njih, a ova smena višak.",
  "Permission denied: the shift leader or store manager signs": "Nemate pravo: potpisuje šef smene ili menadžer prodavnice",
  // ATK
  "Only a manager with the tax rights sets the ATK numbers": "Brojeve u PAK podešava samo menadžer sa poreskim pravima",
  "The environment is test or production": "Okruženje je test ili stvarno",
  "Only the platform admin sets DrisPRO's numbers at ATK": "Brojeve DrisPRO-a u PAK podešava samo administrator platforme",
  "Only a store manager registers a till with ATK": "Kasu u PAK registruje samo menadžer jedinice",
  "This till is being registered already; wait a moment": "Ova kasa se već registruje; sačekajte trenutak",
  "Start the registration again": "Ponovo pokrenite registraciju",
  "The certificate request is not valid": "Zahtev za sertifikat nije važeći",
  "The fiscal coupon of this sale is not complete": "Fiskalni kupon ove prodaje nije potpun",
  "Two tills of the same store have the same ATK number": "Dve kase iste jedinice imaju isti broj u PAK",
  "This receipt was made on a till that is not registered with ATK, so it has no signed coupon": "Ovaj kupon je izdat na kasi koja nije registrovana u PAK, pa nema potpisan kupon",
  "ATK could not be reached": "PAK nije dostupna",
  "ATK gave no verification code": "PAK nije dala verifikacioni kod",
  "ATK gave no certificate": "PAK nije dala sertifikat",
  "Made before DrisPRO signed the receipts: fiscalized by the shop's own fiscal device": "Izdato pre nego što je DrisPRO počeo da potpisuje kupone: fiskalizovano sopstvenim fiskalnim uređajem prodavnice",
  "Kosovo invoices are not sent to ATK through the fiscal software; only till coupons are": "Fakture na Kosovu se ne šalju u PAK preko fiskalnog softvera; šalju se samo kuponi kase",
  "A cancellation coupon needs its reason": "Kupon poništenja mora imati razlog",
  "A training company never sends anything to ATK": "Preduzeće za obuku nikada ništa ne šalje u PAK",
} satisfies Dict
