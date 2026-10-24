import type { Dict } from '../index'

/** Platform owner: clients, licences, invitation-only sign-up, own password. */
export default {
  // platform page
  'Clients and licences': 'Klientët dhe licencat',
  'Open the app': 'Hap aplikacionin',
  'Create each client company with its administrator and licence. Only you see this page; clients cannot create companies themselves.':
    'Krijoni kompaninë e çdo klienti me administratorin dhe licencën e saj. Këtë faqe e shihni vetëm ju; klientët nuk mund të krijojnë kompani vetë.',
  'New client': 'Klient i ri',
  'Ending within {n} day': 'Skadojnë brenda {n} dite',
  'Ending within {n} days': 'Skadojnë brenda {n} ditëve',
  'Expired or paused': 'Të skaduara ose të pezulluara',
  'Search name, NUI/NIPT or email': 'Kërko emër, NUI/NIPT ose email',
  'Search clients': 'Kërko klientët',
  '{n} client': '{n} klient',
  '{n} clients': '{n} klientë',
  'No client matches the search': 'Asnjë klient nuk përputhet me kërkimin',
  'No clients yet': 'Ende pa klientë',
  'Add the first client: their company, the administrator account and the licence period.':
    'Shtoni klientin e parë: kompaninë, llogarinë e administratorit dhe periudhën e licencës.',
  'Client': 'Klienti',
  'Administrator': 'Administratori',
  'Plan': 'Paketa',
  'Last activity': 'Aktiviteti i fundit',
  'Change licence': 'Ndrysho licencën',
  'Set a new password': 'Vendos fjalëkalim të ri',
  'Open this company': 'Hap këtë kompani',
  'Open sign-up': 'Regjistrim i lirë',
  'When on, anyone can create an account and a company with a 30-day trial. Keep it off to decide every client yourself; invited staff can always sign up.':
    'Kur është i ndezur, kushdo mund të krijojë llogari dhe kompani me provë 30-ditore. Mbajeni të fikur që çdo klient ta vendosni ju; stafi i ftuar mund të regjistrohet gjithmonë.',
  'Anyone can sign up now': 'Tani kushdo mund të regjistrohet',
  'Sign-up is by invitation only': 'Regjistrimi bëhet vetëm me ftesë',
  'Basic': 'Bazë',
  'Pro': 'Pro',
  'Trial': 'Provë',
  'No licence': 'Pa licencë',
  'Paused': 'E pezulluar',
  'Starts {date}': 'Nis më {date}',
  'Ends today': 'Skadon sot',
  'Ends in {n} day': 'Skadon pas {n} dite',
  'Ends in {n} days': 'Skadon pas {n} ditësh',
  'Could not copy. Select the text and copy it by hand.': 'Nuk u kopjua. Zgjidheni tekstin dhe kopjojeni me dorë.',

  // new client
  'Creates the company with its warehouse, VAT codes and financial year, the administrator account and the licence.':
    'Krijon kompaninë me magazinën, kodet e TVSH-së dhe vitin financiar, llogarinë e administratorit dhe licencën.',
  'Administrator of the client': 'Administratori i klientit',
  'If this email already has an account, it keeps its current password.': 'Nëse ky email ka tashmë llogari, ajo mban fjalëkalimin që ka.',
  'Licence': 'Licenca',
  'Create client': 'Krijo klientin',
  'Maximum users': 'Numri maksimal i përdoruesve',
  '+1 month': '+1 muaj',
  '+6 months': '+6 muaj',
  '+1 year': '+1 vit',
  'Contract number, price, contact person…': 'Numri i kontratës, çmimi, personi i kontaktit…',
  'Only you see these notes.': 'Këto shënime i shihni vetëm ju.',
  'Your NexusERP account is ready.': 'Llogaria juaj në NexusERP është gati.',
  'Change the password after the first sign-in: click your initials at the top right, then Change password.':
    'Ndryshojeni fjalëkalimin pas hyrjes së parë: klikoni inicialet tuaja lart djathtas, pastaj Ndrysho fjalëkalimin.',
  'Send these sign-in details to the client. The password is shown only now.': 'Dërgojini klientit këto të dhëna hyrjeje. Fjalëkalimi shfaqet vetëm tani.',
  'Enter a whole number': 'Shkruani një numër të plotë',
  'At least 1 user': 'Të paktën 1 përdorues',
  'The end date is before the start date': 'Data e mbarimit është para datës së fillimit',

  // change licence
  'Licence for {name}': 'Licenca e {name}',
  "Outside the licence period, or while paused, the client's people cannot open the company. Their data is kept.":
    'Jashtë periudhës së licencës, ose kur është e pezulluar, njerëzit e klientit nuk mund ta hapin kompaninë. Të dhënat e tyre ruhen.',
  'Pause access': 'Pezullo qasjen',
  'For example while an invoice is unpaid. Turn off to give access back.': 'Për shembull kur një faturë nuk është paguar. Fikeni për t’ua kthyer qasjen.',
  'Save licence': 'Ruaj licencën',
  'Licence saved for {name}': 'Licenca u ruajt për {name}',
  '{n} person already uses this company. Remove people first or keep the limit higher.': '{n} person e përdor tashmë këtë kompani. Hiqni fillimisht njerëz ose mbajeni kufirin më të lartë.',
  '{n} people already use this company. Remove people first or keep the limit higher.': '{n} persona e përdorin tashmë këtë kompani. Hiqni fillimisht njerëz ose mbajeni kufirin më të lartë.',

  // new password (platform)
  "For a client who forgot the password. Any email in the client's company works.": 'Për një klient që ka harruar fjalëkalimin. Vlen për çdo email në kompaninë e klientit.',
  'Send the new password to the person. They can change it after signing in.': 'Dërgojini personit fjalëkalimin e ri. Mund ta ndryshojë pasi të hyjë.',
  'Generate': 'Gjenero',
  'Save password': 'Ruaj fjalëkalimin',

  // own password
  'Change password': 'Ndrysho fjalëkalimin',
  'Current password': 'Fjalëkalimi aktual',
  'Repeat the new password': 'Përsërit fjalëkalimin e ri',
  'The two new passwords are not the same.': 'Dy fjalëkalimet e reja nuk janë njësoj.',
  'The current password is not correct.': 'Fjalëkalimi aktual nuk është i saktë.',
  'Password changed': 'Fjalëkalimi u ndryshua',

  // licence on hold / ending
  'The licence for {company} ends today.': 'Licenca e {company} skadon sot.',
  'The licence for {company} ends on {date}, in {n} day.': 'Licenca e {company} skadon më {date}, pas {n} dite.',
  'The licence for {company} ends on {date}, in {n} days.': 'Licenca e {company} skadon më {date}, pas {n} ditësh.',
  'Contact your provider to renew it.': 'Kontaktoni furnitorin për ta rinovuar.',
  'Access to {company} is paused by your provider.': 'Qasja në {company} është pezulluar nga furnitori.',
  'The licence for {company} has not started yet.': 'Licenca e {company} nuk ka filluar ende.',
  'The licence for {company} ended on {date}.': 'Licenca e {company} ka skaduar më {date}.',
  '{company} has no active licence.': '{company} nuk ka licencë aktive.',
  'Your company is on hold': 'Qasja në kompani është e ndalur',
  'Your data is kept safe. Contact your provider to renew the licence, then sign in again.':
    'Të dhënat tuaja ruhen të sigurta. Kontaktoni furnitorin për të rinovuar licencën, pastaj hyni përsëri.',
  'No company yet': 'Ende pa kompani',
  "Your account is not linked to a company. Ask your company's administrator to invite this email address, then click Check again.":
    'Llogaria juaj nuk është e lidhur me asnjë kompani. Kërkojini administratorit të kompanisë t’ju ftojë me këtë email, pastaj klikoni Kontrollo përsëri.',
  'Signed in as {email}': 'Jeni brenda si {email}',
  'Check again': 'Kontrollo përsëri',

  "You are inside {company} as the platform administrator. Changes you make are saved in the client's books.":
    'Jeni brenda {company} si administrator i platformës. Ndryshimet që bëni ruhen në librat e klientit.',
  'Back to clients': 'Kthehu te klientët',

  // sign-in pages
  'Invited by your company? {link}': 'Ju ka ftuar kompania? {link}',
  'Accounts are by invitation. Use the email your company invited, and you join it automatically.':
    'Llogaritë hapen me ftesë. Përdorni emailin me të cilin ju ftoi kompania dhe hyni automatikisht në të.',
  "This email has no invitation. Ask your company's administrator to invite you, then try again.":
    'Ky email nuk ka ftesë. Kërkojini administratorit të kompanisë t’ju ftojë, pastaj provoni përsëri.',
} satisfies Dict
