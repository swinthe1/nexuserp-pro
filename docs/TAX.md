# Tax and fiscal compliance (Phase 8)

Migration `20261024001900_tax_engine.sql`. Tests: `supabase/tests/08_tax.sql` (46 assertions), with the expected figures worked out by hand in the file header.

## How documents become VAT entries

`app.vat_entries(company, from, to)` turns every posted document of a period into one row per document × VAT treatment × rate, in the base currency. Foreign-currency documents use their own exchange rate.

| Source | Treatment (`kind`) |
|---|---|
| Customer invoices and credit notes (not POS) | `taxable`, `exempt`, `exempt_credit` (exempt with right to credit), `export` (0 %) |
| POS receipts | Same kinds. Daily totals per register; receipts to a customer with a tax number are listed one by one |
| Vendor bills and vendor credit notes | `domestic`, `investment` (line account is a fixed asset), `farmer`, `no_vat`, `non_deductible`, `reverse_charge` |
| Customs declarations (landed costs with a DUD) | `import`: customs value and import VAT |

The tax code decides the treatment:
- `is_exempt` makes a line exempt.
- `is_reverse_charge` makes it reverse charge.
- `is_deductible = false` makes its VAT non-deductible.
- `vat_category` refines it: `exempt_credit`, `export` or `farmer`.

### Ledger changes that come with it
- **Reverse charge:** the vendor charges no VAT, so the line's rate snapshots as 0. When the bill is posted, the company self-assesses it as Dr input VAT / Cr output VAT at the code's rate.
- **Non-deductible VAT:** it is added to the expense or stock line, not to 4456.
- **Import VAT:** it is entered on the landed cost, in the customs declaration fields (DUD number and date, value for VAT, rate, amount). Posting books Dr 4456 / Cr 467; the customs or forwarder bill clears 467. Import VAT never enters stock value.

## The books (`/tax/books`)

`vat_book(company, from, to, 'sales' | 'purchase')` lays the entries out in the official columns from `vat_layout(country)`.

**Kosovo (ATK).** Columns are the field numbers of the VAT return, so the books add up to the form:

| Sales book | Purchase book |
|---|---|
| [9] exempt without credit · [10] exempt with credit · [11] exports | [31] / [32] without VAT (capital) · [33] / [34] non-deductible VAT, shown gross |
| [12]/[13] taxable 18 % · [14]/[15] taxable 8 % | [35]–[38] imports 18 % / 8 % |
| [16]–[19] **credit notes received** | [43]–[46] domestic 18 % / 8 % · [47]–[50] capital 18 % / 8 % · [51]/[52] farmers |
| [28]/[29] reverse charge | [53]–[56] **credit notes issued** · [65]/[66] reverse charge |

As on the ATK form, a credit note you issue reduces VAT from the purchase side ([53]–[56]). A credit note you receive increases it from the sales side ([16]–[19]).

**Albania (DPT).**
- Sales book columns: exempt, exports 0 %, taxable and VAT at 20 / 10 / 6 %, reverse charge.
- Purchase book columns: without VAT, imports, domestic 20 / 10 / 6 %, capital purchases, reverse charge, non-deductible (gross).
- Credit notes are negative in their own book.
- The fiscal code (NIVF) of each fiscalized invoice is shown next to it.

Since July 2022 the DPT pre-fills the books and the return from fiscalized e-invoices, so the Albanian layout is a reconciliation view. The row codes A1–C5 are this app's, grouped the way the e-filing return groups them. Check them against the portal before relying on them as official box numbers.

All books export to Excel with title lines (company, NIPT/NUI, book, period), as well as to CSV and PDF.

## VAT declarations (`/tax/declarations`)

`vat_return_preview(company, from, to, credit_bf?, refund?)` sums the books into the form. It also:
- carries the credit forward from the previous submitted or accepted declaration;
- applies a requested refund;
- compares output and input VAT with accounts 4457 / 4456 for the period (ledger check). The check accounts for two known timing differences:
  - POS VAT in sessions that are still open; it reaches the ledger at the Z-report.
  - XK credit notes that sit on the other side of the form.

| Step | Function | Effect |
|---|---|---|
| Create | `create_vat_declaration(company, year, month)` | One per month. The snapshot is stored in `details`. |
| Recalculate | `refresh_vat_declaration(id, refund?)` | Drafts only; sets the refund requested. |
| Submit | `submit_vat_declaration(id, reference)` | Earlier drafts must go first. Posts the settlement (Dr 4457 output, Cr 4456 input, the difference to 4455). **Closes the month for VAT:** invoices, bills and customs entries dated in it can no longer be posted. |
| Decide | `decide_vat_declaration(id, accepted, note)` | Rejecting reverses the settlement and reopens the month; a later declaration must be rejected first. |
| Reopen | `reopen_vat_declaration(id)` | A rejected declaration goes back to draft. |

**Kosovo settlement fields:**
- [30] total output VAT.
- [67] total deductible VAT.
- [68] credit brought forward.
- [72] payable = [30] − [67] − [68] when that is positive.
- Otherwise [69] is the remaining credit: [70] can be asked back as a refund, and [71] is carried to next month.

**Albania:** C1 is the net (output − input); C2 the credit brought forward; C3 the refund requested; C4 the credit carried; C5 the VAT payable.

## Fiscalization (`/tax/fiscalization`)

- **Queueing.** Posted invoices are queued by `post_sales_invoice` (Phase 3); paid POS receipts are queued when they become paid. A trigger fills each record with what the authority needs:
  - issuer NIPT, issue time, number, total;
  - business unit, TCR and software codes;
  - whether the receipt was issued offline (a subsequent delivery).
- **IIC.** In Albania the IIC is the MD5 of the RSA signature of `NIPT|time|number|business unit|TCR|software|total`. Signing needs the company's certificate, which belongs with the Edge Function, so the stored IIC is the MD5 of the unsigned string until then.
- **`process_fiscal_queue(company)`:**
  - **Test environment:** simulates the answer — FIC (NIVF) and the verification QR link in Albania, a verification code in Kosovo — and marks the documents fiscalized.
  - **Production:** marks the documents failed with "connector not configured" until the `fiscalize` Edge Function (certificate, CIS / ATK endpoint) is deployed.

### Kosovo: DrisPRO as the fiscal software (SEF) — `/pos/atk`

Built from ATK's technical documentation (github.com/fiskalizimi/pos-golang and pos-csharp, `models.proto`), Administrative Instruction MF 01/2026 and ATK's amendment of 22.06.2026.

- **Numbers.** These are what ATK sees:
  - BusinessId: the company's NUI.
  - BranchId: `warehouses.atk_branch_id` (1–999).
  - PosId: `pos_registers.atk_pos_id` (1–99, unique per store).
  - FiscalizationNo: `company_settings.atk_fiscalization_no`, from EDI.
  - ApplicationId: DrisPRO's number at ATK, kept in `platform_settings.atk_application_id_test` and `atk_application_id_prod`.
- **Registering a till** happens on the device it sells on:
  1. `atk_onboard_verify` → the postier calls `/ca/verify/{nui}` and gets back the business name and a verification code.
  2. The browser makes an ECDSA P-256 key. It is a non-extractable WebCrypto key over https; on a local server over plain http (no WebCrypto there) it is a software key in IndexedDB.
  3. The browser makes the CSR (C=RKS, L=branch, O=NUI, OU=POS, CN=business name).
  4. `atk_onboard_csr` → the postier calls `/ca/signcsr`. The certificate is kept on the register and on the device.
  5. The key is stored only after ATK signs it, so a failed attempt never loses the working key.
- **Each sale** is built and signed on the till, so it also works offline (`src/lib/atk`):
  - The POS coupon and the citizen coupon are encoded as Protobuf.
  - The signature is ECDSA/SHA-256 over the Base64 text, in ASN.1 form.
  - The QR code is `base64(citizen)|signature`.
  - Units of money:
    - Item prices are in 0.0001 €.
    - Totals are in cents.
    - VAT by letter: A exempt, C 0 %, D 8 %, E 18 %. The base is rounded and the VAT is the rest, so the groups always add up.
  - Coupon numbers are `(branch × 100 + POS) × 10⁹ + the till's count`. The count never goes back; the server's highest count is the floor.
  - A refund is a RETURN coupon whose ReferenceNo is the original coupon.
- **Sending.**
  - The signed coupon rides on the sale (`pos_orders.atk`, then `fiscalization_records.request_payload.atk`).
  - `atk_wait` / `atk_done` hand each coupon to the postier, which posts it to `/pos/coupon`. In the test environment it also posts the QR to `/citizen/coupon`, so ATK's checks see both halves.
  - ATK's `transaction_id` is kept in `fic`.
  - A refusal or a lost connection is retried with backoff (1, 2, 5, 15, 30 min, then hourly). The first refusal notifies `tax.write`.
  - A receipt from a till that is not registered is marked `NOT_SIGNED` and never sent. A till that is not registered on its device does not sell.
- **What has not reached ATK** can be downloaded as CSV from `/pos/atk`; ATK asks for this format in its 22.06.2026 amendment.
- **Testing locally.**
  - `ATK_TEST_BASE` points the postier's test-environment calls at a stand-in instead of `fiskalizimi-test.atk-ks.org`.
  - `supabase/tests/68_atk_sef.sql` covers the database side.

## Tax calendar

`tax_calendar(company, months)` lists, for each past month:
- the VAT return: due by the 14th of the next month in Albania, the 20th in Kosovo;
- payroll withholding: due by the 20th in Albania, the 15th in Kosovo.

Each obligation's status comes from the declaration or payroll run. Daily reminders (`run_daily_reminders`, pg_cron) notify finance and HR five days before a deadline and when it is overdue.

## Rates used

- Albania: VAT 20 %, 10 % (fertilisers, seeds, plant protection) and 6 % (accommodation, books, some media), plus exports at 0 %.
- Kosovo: VAT 18 % and 8 %.
- Companies get a `VAT10` code when created; existing Albanian companies get it from the migration.
