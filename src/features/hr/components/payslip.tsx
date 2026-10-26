import { Printer } from 'lucide-react'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { printHtml } from '@/lib/print'
import { msg, t, tServer } from '@/i18n'
import { formatDate, formatMoney, formatMonth, formatQty, num } from '@/lib/utils'
import type { PayslipRow } from '../api'

const GROUPS: { type: string; title: string; sign: 1 | -1 }[] = [
  { type: 'earning', title: msg('Earnings'), sign: 1 },
  { type: 'employee_contribution', title: msg('Employee contributions'), sign: -1 },
  { type: 'tax', title: msg('Income tax'), sign: -1 },
  { type: 'deduction', title: msg('Deductions from pay'), sign: -1 },
  { type: 'employer_contribution', title: msg('Paid by the employer (not deducted)'), sign: 1 },
]
const monthOf = (d: string | undefined) => d ? formatMonth(`${d}T00:00:00`) : ''

/** Line names are written by the database in English; the standard ones are named here by their code. */
const LINE_NAMES: Record<string, string> = {
  SOC_EE: msg('Social insurance|payslip'), PENSION_EE: msg('Pension (Trust)|payslip'), HEALTH_EE: msg('Health insurance|payslip'),
  TAP: msg('Income tax (TAP)|payslip'), SOC_ER: msg('Social insurance (employer)|payslip'), PENSION_ER: msg('Pension (employer)|payslip'),
  HEALTH_ER: msg('Health insurance (employer)|payslip'),
}
type Line = PayslipRow['lines'][number]
export function payslipLineName(l: Line, slip: Pick<PayslipRow, 'paid_days' | 'working_days' | 'overtime_hours'>) {
  if (l.code === 'BASIC') return t('Basic salary · {paid} of {days} days', { paid: formatQty(slip.paid_days), days: formatQty(slip.working_days) })
  if (l.code === 'OVERTIME') return t('Overtime · {h} h', { h: formatQty(slip.overtime_hours) })
  if (l.code === 'NIGHT' || l.code === 'HOLIDAY') {
    const h = /· ([\d.]+) h/.exec(l.name)?.[1] ?? ''
    return l.code === 'NIGHT' ? t('Night work · {h} h', { h: formatQty(h) }) : t('Holiday and rest-day work · {h} h', { h: formatQty(h) })
  }
  if (l.code?.startsWith('DED:')) return l.name
  if (l.code === 'TAX') return l.name.includes('secondary') ? t('Income tax (secondary employer)|payslip') : t('Income tax|payslip')
  const k = l.code ? LINE_NAMES[l.code] : undefined
  return k ? t(k) : tServer(l.name)
}
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))

export function printPayslip(slip: PayslipRow, companyName: string, currency: string) {
  const rows = GROUPS.map((g) => {
    const lines = slip.lines.filter((l) => l.line_type === g.type)
    if (!lines.length) return ''
    return `<tr class="g"><td colspan="3">${esc(t(g.title))}</td></tr>` + lines.map((l) =>
      `<tr><td>${esc(payslipLineName(l, slip))}</td><td class="r">${l.rate_pct != null ? esc(t('{rate}% of {base}', { rate: num(l.rate_pct), base: formatMoney(l.base) })) : ''}</td><td class="r">${formatMoney(num(l.amount) * (g.type === 'employer_contribution' ? 1 : g.sign))}</td></tr>`).join('')
  }).join('')
  printHtml(`
    <h1>${esc(t('Payslip'))} · ${esc(monthOf(slip.run?.period_start))}</h1>
    <p class="m">${esc(companyName)} · ${esc(slip.run?.number ?? '')} · ${esc(t('paid {date}', { date: formatDate(slip.run?.pay_date) }))}</p>
    <table class="h"><tr><td><b>${esc(slip.employee?.full_name ?? '')}</b><br>${esc(slip.employee?.number ?? '')}${slip.employee?.personal_number ? ` · ${esc(t('Personal no.'))} ${esc(slip.employee.personal_number)}` : ''}<br>
      ${esc([slip.employee?.position?.title, slip.employee?.department?.name].filter(Boolean).join(' · '))}</td>
      <td class="r">${esc(t('Days paid {paid} of {days}', { paid: formatQty(slip.paid_days), days: formatQty(slip.working_days) }))}${num(slip.unpaid_leave_days) ? `<br>${esc(t('Unpaid leave {n} days', { n: formatQty(slip.unpaid_leave_days) }))}` : ''}
      ${slip.employee?.iban ? `<br>IBAN ${esc(slip.employee.iban)}` : ''}</td></tr></table>
    <table class="l">${rows}
      <tr class="t"><td>${esc(t('Gross'))}</td><td></td><td class="r">${formatMoney(slip.gross_salary)}</td></tr>
      <tr class="t"><td>${esc(t('Net pay'))}</td><td></td><td class="r">${formatMoney(slip.net_salary, currency)}</td></tr></table>`,
  `body{font:12px system-ui,sans-serif;margin:28px;color:#111}h1{font-size:18px;margin:0}.m{color:#555;margin:4px 0 16px}table{width:100%;border-collapse:collapse}
   .h td{vertical-align:top;padding:8px 0;border-top:1px solid #ccc;border-bottom:1px solid #ccc}.r{text-align:right}.l td{padding:5px 0;border-bottom:1px solid #eee}
   .g td{padding-top:14px;font-weight:600;color:#444;border-bottom:1px solid #bbb}.t td{font-weight:700;font-size:13px;border-bottom:none;padding-top:10px}`)
}

export function PayslipDialog({ slip, onClose }: { slip: PayslipRow; onClose: () => void }) {
  const { company } = useCompany()
  const currency = company?.base_currency ?? ''
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{slip.employee?.full_name} · {monthOf(slip.run?.period_start)}</DialogTitle>
          <DialogDescription>{slip.run?.number} · {t('{paid} of {days} working days paid', { paid: formatQty(slip.paid_days), days: formatQty(slip.working_days) })}
            {num(slip.unpaid_leave_days) ? ` · ${t('{n} unpaid', { n: formatQty(slip.unpaid_leave_days) })}` : ''}{num(slip.overtime_hours) ? ` · ${t('{n} h overtime', { n: formatQty(slip.overtime_hours) })}` : ''}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-[13px]">
          {GROUPS.map((g) => {
            const lines = slip.lines.filter((l) => l.line_type === g.type)
            if (!lines.length) return null
            return (
              <div key={g.type}>
                <div className="mb-1 text-xs font-medium text-muted-foreground">{t(g.title)}</div>
                {lines.map((l) => (
                  <div key={l.id} className="flex justify-between gap-3 border-b py-1 last:border-0">
                    <span>{payslipLineName(l, slip)}{l.rate_pct != null && <span className="text-muted-foreground"> · {t('{rate}% of {base}', { rate: num(l.rate_pct), base: formatMoney(l.base) })}</span>}</span>
                    <span className="shrink-0 tabular">{g.sign < 0 ? '−' : ''}{formatMoney(l.amount)}</span>
                  </div>))}
              </div>)
          })}
          <div className="grid gap-1 rounded-md bg-muted/50 p-3">
            <div className="flex justify-between"><span>{t('Gross')}</span><span className="tabular">{formatMoney(slip.gross_salary)}</span></div>
            <div className="flex justify-between text-muted-foreground"><span>{t('Deducted')}</span><span className="tabular">−{formatMoney(num(slip.employee_contributions) + num(slip.income_tax))}</span></div>
            <div className="flex justify-between text-base font-semibold"><span>{t('Net pay')}</span><span className="tabular">{formatMoney(slip.net_salary, currency)}</span></div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>{t('Cost to the employer')}</span><span className="tabular">{formatMoney(num(slip.gross_salary) + num(slip.employer_contributions))}</span></div>
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => printPayslip(slip, company?.name ?? '', currency)}><Printer /> {t('Print payslip')}</Button><Button onClick={onClose}>{t('Done')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
