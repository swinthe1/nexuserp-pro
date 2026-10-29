import type { Dict } from '../index'

/** Kartelat (partneri, artikulli), IOS dhe kompensimi */
export default {
  'Partner cards': 'Kartelat e partnerëve',
  'The account card of a customer or supplier with the running balance, and the statement of open items to confirm balances (IOS).':
    'Kartela e klientit ose furnitorit me saldon vijuese, dhe lista e dokumenteve të hapura për konfirmimin e saldove (IOS).',
  'Choose a customer or supplier': 'Zgjidhni klientin ose furnitorin',
  'Their card shows every invoice, payment and compensation with the balance after each.': 'Kartela tregon çdo faturë, pagesë dhe kompensim me saldon pas secilit.',
  'As a customer': 'Si klient',
  'As a supplier': 'Si furnitor',
  'Card': 'Kartela',
  'Open items (IOS)': 'Dokumentet e hapura (IOS)',
  'Owes us': 'Na detyrohet',
  'Customer card': 'Kartela e klientit',
  'Supplier card': 'Kartela e furnitorit',
  'Statement of open items': 'Lista e dokumenteve të hapura (IOS)',
  'at {date}': 'më {date}',
  'At|date': 'Më datë',
  'The statement to send for confirmation of the balance: every open document at that date, with a place to confirm and sign.':
    'Lista që dërgohet për konfirmimin e saldos: çdo dokument i hapur në atë datë, me vend për konfirmim dhe nënshkrim.',
  'Nothing open at this date': 'Asgjë e hapur në këtë datë',
  'Advance / unallocated payment': 'Paradhënie / pagesë e pashpërndarë',
  'Their number': 'Numri i tyre',
  'Total open': 'Gjithsej e hapur',
  'According to our books, on {date} we owe you the amount above. Please confirm it by signing and returning this statement within 8 days; if your books differ, please send us your statement.':
    'Sipas librave tanë, më {date} ju detyrohemi shumën e mësipërme. Ju lutemi ta konfirmoni duke e nënshkruar dhe kthyer këtë listë brenda 8 ditëve; nëse librat tuaj ndryshojnë, na dërgoni gjendjen tuaj.',
  'According to our books, on {date} you owe us the amount above. Please confirm it by signing and returning this statement within 8 days; if your books differ, please send us your statement.':
    'Sipas librave tanë, më {date} na detyroheni shumën e mësipërme. Ju lutemi ta konfirmoni duke e nënshkruar dhe kthyer këtë listë brenda 8 ditëve; nëse librat tuaj ndryshojnë, na dërgoni gjendjen tuaj.',
  'We confirm [  ]    We do not confirm [  ]    Our balance: ______________': 'E konfirmojmë [  ]    Nuk e konfirmojmë [  ]    Saldoja jonë: ______________',
  'Open|amount': 'E hapur',
  'For {company}': 'Për {company}',
  'For {partner}': 'Për {partner}',
  'Hello,\n\nPlease find attached {what}.\n\nKind regards,\n{company}': 'Përshëndetje,\n\nJu dërgojmë bashkëngjitur {what}.\n\nMe respekt,\n{company}',

  // kompensimi
  'Compensation': 'Kompensim',
  'Compensations': 'Kompensimet',
  'When a partner is both customer and supplier, what they owe us and what we owe them are set against each other. Both invoices are settled by that amount and the books record it.':
    'Kur një partner është edhe klient edhe furnitor, ajo që na detyrohet dhe ajo që i detyrohemi mbyllen me njëra-tjetrën. Të dyja faturat paguhen me atë shumë dhe regjistrohet në libra.',
  'New compensation': 'Kompensim i ri',
  'No compensation yet': 'Ende pa kompensime',
  'Start one from a partner who has open invoices on both sides.': 'Filloni me një partner që ka fatura të hapura në të dyja anët.',
  'Choose the partner, then the invoices on both sides; the two sides must be equal.': 'Zgjidhni partnerin, pastaj faturat në të dyja anët; dy anët duhet të jenë të barabarta.',
  'A partner who is both customer and supplier': 'Partner që është edhe klient edhe furnitor',
  'No partner is both customer and supplier': 'Asnjë partner nuk është edhe klient edhe furnitor',
  'Fill in by itself': 'Plotëso vetë',
  'They owe us (our invoices)': 'Na detyrohen (faturat tona)',
  'We owe them (their invoices)': 'U detyrohemi (faturat e tyre)',
  'Their debt to us (our invoices)': 'Detyrimi i tyre ndaj nesh (faturat tona)',
  'Our debt to them (their invoices)': 'Detyrimi ynë ndaj tyre (faturat e tyre)',
  'Nothing open': 'Asgjë e hapur',
  'open {amount}': 'e hapur {amount}',
  'Both sides: {amount}': 'Të dyja anët: {amount}',
  'Tick the invoices to set against each other.': 'Shënoni faturat që mbyllen me njëra-tjetrën.',
  'The sides differ by {amount}': 'Anët ndryshojnë me {amount}',
  'Post the compensation': 'Posto kompensimin',
  'Compensation {number} posted': 'Kompensimi {number} u postua',
  'Cancel the compensation': 'Anulo kompensimin',
  'Why is it cancelled?': 'Pse anulohet?',
  'Compensation cancelled': 'Kompensimi u anulua',
  'Cancelled': 'Anuluar',
  'Invoice amount': 'Vlera e faturës',
  'Set off': 'Kompensuar',
  'Set off on both sides': 'Kompensuar në të dyja anët',
  'The two parties agree to set off their mutual debts for the amount above. After this compensation both debts are lower by this amount.':
    'Palët pajtohen të kompensojnë detyrimet e ndërsjella në shumën e mësipërme. Pas këtij kompensimi të dyja detyrimet zvogëlohen me këtë shumë.',

  // kartela e artikullit
  'Item card': 'Kartela e artikullit',
  'Every movement of an item with the quantity and the value after each: goods in, sales, returns, transfers, counts.':
    'Çdo lëvizje e artikullit me sasinë dhe vlerën pas secilës: hyrje, shitje, kthime, transferime, numërime.',
  'Choose an item': 'Zgjidhni artikullin',
  'Choose an item (name, code or barcode)': 'Zgjidhni artikullin (emri, kodi ose barkodi)',
  'Movement': 'Lëvizja',
  'Partner / warehouse': 'Partneri / njësia',
  'Goods in': 'Hyrje malli',
  'Till sale': 'Shitje në arkë',
  'Till return': 'Kthim në arkë',
  'Adjustment +': 'Rregullim +',
  'Adjustment −': 'Rregullim −',
  'Used in production': 'Përdorur në prodhim',
  'Revaluation': 'Rivlerësim',

  // serveri
  'Choose customer or supplier side': 'Zgjidhni anën e klientit ose të furnitorit',
  'Choose the invoices to set against each other': 'Zgjidhni faturat që kompensohen',
  'All documents of a compensation are in one currency': 'Të gjitha dokumentet e një kompensimi janë në një monedhë',
  'A compensation needs at least one invoice of the customer and one bill of the supplier': 'Kompensimi kërkon të paktën një faturë të klientit dhe një të furnitorit',
  'Compensation not found': 'Kompensimi nuk u gjet',
  'The compensation is already cancelled': 'Kompensimi është anuluar tashmë',
  'Write why it is cancelled': 'Shkruani pse anulohet',
} satisfies Dict
