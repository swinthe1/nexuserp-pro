import { appealSentence, CONTRACT_MODELS, CONTRACT_TYPE_SQ, ENDED_REASON_SQ, LAW, noticeSentence, type ContractKind, type Country } from '@/i18n/contracts/models'
import { amountInWords } from '@/lib/documents/model'
import { printHtml } from '@/lib/print'
import type { ContractFull } from './api'

/** what fills the {{…}} in a model */
export type ContractFacts = {
  contract: ContractFull
  parent?: Pick<ContractFull, 'number' | 'start_date' | 'gross_salary' | 'working_hours_per_week' | 'job_title' | 'job_description' | 'workplace' | 'work_schedule' | 'end_date' | 'contract_type' | 'annual_leave_days' | 'notice_days' | 'pay_day'> | null
  company: { name: string; legal_name?: string | null; tax_number?: string | null; business_number?: string | null; address_line1?: string | null; city?: string | null; country_code: string }
  settings?: { contract_signatory?: string | null; contract_signatory_title?: string | null; contract_place?: string | null } | null
  today: string
}

const d = (iso: string | null | undefined) => {
  if (!iso) return '…'
  const [y, m, day] = iso.slice(0, 10).split('-')
  return `${day}.${m}.${y}`
}
const money = (n: number, cur: string) => `${Number(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`
const addMonths = (iso: string, m: number) => {
  const x = new Date(iso + 'T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + m); x.setUTCDate(x.getUTCDate() - 1)
  return x.toISOString().slice(0, 10)
}
export const probationEnd = (c: { start_date: string; probation_months: number }) => c.probation_months > 0 ? addMonths(c.start_date, c.probation_months) : null

export function countryOf(code: string): Country { return code === 'XK' ? 'XK' : 'AL' }

/** the values a model can use, by name */
export function contractValues(f: ContractFacts): Record<string, string> {
  const c = f.contract, e = c.employee, co = f.company
  const country = countryOf(co.country_code)
  const fixed = !!c.end_date || c.contract_type !== 'indefinite'
  const place = f.settings?.contract_place || co.city || '…'
  const company = co.legal_name || co.name
  const companyAddress = [co.address_line1, co.city].filter(Boolean).join(', ') || '…'
  const type = CONTRACT_TYPE_SQ[country][c.contract_type] ?? c.contract_type
  const duration = c.end_date
    ? `${type}, nga data ${d(c.start_date)} deri më ${d(c.end_date)}`
    : `${type}, duke filluar nga data ${d(c.start_date)}`
  const pe = probationEnd(c)
  const probation = pe ? `Periudha e provës është ${c.probation_months} ${c.probation_months === 1 ? 'muaj' : 'muaj'}, nga ${d(c.start_date)} deri më ${d(pe)}.` : 'Për këtë kontratë nuk ka periudhë prove.'
  const p = f.parent
  const changes: string[] = []
  if (p) {
    if (Number(p.gross_salary) !== Number(c.gross_salary)) changes.push(`Paga bruto mujore ndryshon nga ${money(p.gross_salary, c.currency_code)} në ${money(c.gross_salary, c.currency_code)} (${amountInWords(c.gross_salary, c.currency_code)}).`)
    if ((p.job_title ?? '') !== (c.job_title ?? '')) changes.push(`Pozita e punës ndryshon nga "${p.job_title ?? '…'}" në "${c.job_title ?? '…'}".`)
    if ((p.job_description ?? '') !== (c.job_description ?? '')) changes.push(`Përshkrimi i punës bëhet: ${c.job_description ?? '…'}`)
    if ((p.workplace ?? '') !== (c.workplace ?? '')) changes.push(`Vendi i punës ndryshon në: ${c.workplace ?? '…'}.`)
    if (Number(p.working_hours_per_week) !== Number(c.working_hours_per_week)) changes.push(`Orari javor i punës ndryshon nga ${p.working_hours_per_week} në ${c.working_hours_per_week} orë në javë.`)
    if ((p.work_schedule ?? '') !== (c.work_schedule ?? '')) changes.push(`Orari i punës bëhet: ${c.work_schedule ?? '…'}.`)
    if ((p.end_date ?? '') !== (c.end_date ?? '')) changes.push(c.end_date ? `Kontrata zgjatet deri më ${d(c.end_date)}.` : 'Kontrata kthehet në kontratë me kohë të pacaktuar.')
    if (p.contract_type !== c.contract_type && !((p.end_date ?? '') !== (c.end_date ?? '') && !c.end_date)) changes.push(`Lloji i kontratës bëhet: ${type}.`)
    if ((p.annual_leave_days ?? null) !== (c.annual_leave_days ?? null)) changes.push(`Pushimi vjetor me pagesë bëhet ${c.annual_leave_days ?? '…'} ditë pune.`)
    if ((p.notice_days ?? null) !== (c.notice_days ?? null)) changes.push(`Afati i njoftimit për ndërprerjen bëhet ${c.notice_days ?? '…'} ditë.`)
    if ((p.pay_day ?? null) !== (c.pay_day ?? null)) changes.push(`Paga paguhet deri më datën ${c.pay_day ?? '…'} të muajit pasues.`)
  }
  return {
    nr: c.number ?? '…',
    data: d(c.signed_on ?? f.today),
    vendi: place,
    punedhenesi: company,
    nui: co.tax_number || co.business_number || '…',
    adresa_punedhenesit: companyAddress,
    perfaqesuesi: c.employer_signatory || f.settings?.contract_signatory || '…',
    pozita_perfaqesuesit: f.settings?.contract_signatory_title || 'Drejtor',
    punemarresi: e?.full_name ?? '…',
    nr_personal: e?.personal_number || '…',
    datelindja: d(e?.date_of_birth),
    adresa_punemarresit: e?.address || '…',
    tel_punemarresit: e?.phone || '…',
    pozita: c.job_title || e?.position?.title || '…',
    pershkrimi: c.job_description || 'Detyrat e punës që i cakton punëdhënësi në përputhje me pozitën e punës.',
    vendi_punes: c.workplace || companyAddress,
    njesia: e?.department?.name || '…',
    lloji: type,
    data_fillimit: d(c.start_date),
    data_mbarimit: c.end_date ? d(c.end_date) : 'pa afat',
    kohezgjatja: duration,
    prova: probation,
    oret: String(Number(c.working_hours_per_week)),
    orari: c.work_schedule || 'nga e hëna deri të premten',
    paga: money(c.gross_salary, c.currency_code),
    paga_fjale: amountInWords(c.gross_salary, c.currency_code),
    monedha: c.currency_code,
    dita_pageses: String(c.pay_day ?? 15),
    pushimi: String(c.annual_leave_days ?? LAW[country].leaveDays),
    njoftimi_teksti: noticeSentence(country, c.notice_days ?? null, fixed),
    ligji: LAW[country].name,
    ligjit: LAW[country].nameOf,
    kontrata_kolektive: 'nuk ka',
    e_drejta_ankeses: appealSentence(country, c.ended_reason ?? null),
    iban: e?.iban || '…',
    banka: e?.bank_name || '…',
    // annex
    nr_kontrates: p?.number ?? '…',
    data_kontrates: d(p?.start_date),
    data_aneksit: d(c.start_date),
    ndryshimet: changes.length ? changes.map((x, i) => `${i + 1}. ${x}`).join('\n') : '1. …',
    // notice
    arsyeja: c.ended_reason ? (ENDED_REASON_SQ[c.ended_reason] ?? c.ended_reason) : '…',
    dita_fundit: d(c.end_date),
    data_njoftimit: d(c.notice_given_on ?? f.today),
    shenim: c.ended_note || '',
  }
}

/** fills {{name}} with its value; unknown names stay as they are, so a typo shows on paper */
export function fillModel(body: string, values: Record<string, string>) {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => values[k] ?? m)
}

export function defaultModel(country: Country, kind: ContractKind, type?: string | null) {
  const set = CONTRACT_MODELS[country]
  if (kind === 'contract') return type === 'fixed_term' || type === 'seasonal' ? set.fixed : type === 'service' ? set.service : set.indefinite
  return kind === 'annex' ? set.annex : set.notice
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** plain text to paper: the first line is the title, "Neni …" lines and lines in capitals are headings */
export function bodyToHtml(text: string) {
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  return blocks.map((b, i) => {
    const lines = b.split('\n')
    if (i === 0 && lines.length <= 2 && lines[0] === lines[0].toUpperCase()) return `<h1>${lines.map(esc).join('<br>')}</h1>`
    const first = lines[0]
    const heading = /^Neni\s+\d+/i.test(first) || (first.length < 70 && first === first.toUpperCase() && /[A-ZËÇ]/.test(first))
    if (heading) {
      const rest = lines.slice(1)
      return `<h2>${esc(first)}</h2>${rest.length ? `<p>${rest.map(esc).join('<br>')}</p>` : ''}`
    }
    return `<p>${lines.map(esc).join('<br>')}</p>`
  }).join('\n')
}

export const CONTRACT_CSS = `
@page { size: A4; margin: 22mm 20mm 20mm 22mm; }
* { box-sizing: border-box; }
body { font-family: "Times New Roman", Georgia, serif; font-size: 11.5pt; line-height: 1.5; color: #111; margin: 0; }
.head { display: flex; justify-content: space-between; gap: 16px; font-size: 9.5pt; color: #444; border-bottom: 1px solid #999; padding-bottom: 6px; margin-bottom: 18px; }
h1 { text-align: center; font-size: 14pt; letter-spacing: .04em; margin: 6px 0 16px; }
h2 { font-size: 11.5pt; margin: 14px 0 4px; }
p { margin: 0 0 8px; text-align: justify; }
.sign { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 36px; page-break-inside: avoid; }
.sign div { text-align: center; }
.sign .who { font-weight: bold; letter-spacing: .04em; }
.sign .line { border-bottom: 1px solid #111; height: 46px; margin: 4px 0 4px; }
.sign .name { font-size: 10.5pt; }
.foot { margin-top: 22px; font-size: 9pt; color: #555; text-align: center; }
`

export function contractPaper(f: ContractFacts, body: string) {
  const v = contractValues(f)
  const filled = fillModel(body, v)
  const isNotice = /^NJOFTIM/i.test(filled.trim())
  return `
<div class="head"><span>${esc(v.punedhenesi)} · NUI/NIPT ${esc(v.nui)}</span><span>${esc(v.nr)}</span></div>
${bodyToHtml(filled)}
<div class="sign">
  <div><div class="who">PUNËDHËNËSI</div><div class="line"></div><div class="name">${esc(v.perfaqesuesi)}${v.pozita_perfaqesuesit ? `, ${esc(v.pozita_perfaqesuesit)}` : ''}</div></div>
  <div><div class="who">${isNotice ? 'E MORA NË DORËZIM' : LAW[countryOf(f.company.country_code)].worker}</div><div class="line"></div><div class="name">${esc(v.punemarresi)}${isNotice ? ', data: ____________' : ''}</div></div>
</div>
<div class="foot">${esc(v.vendi)}, ${esc(isNotice ? v.data_njoftimit : v.data)}</div>`
}

export function printContract(f: ContractFacts, body: string) {
  printHtml(contractPaper(f, body), CONTRACT_CSS)
}
