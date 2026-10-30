import { AlertTriangle, CircleCheck, Scale } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n'
import { cn, formatDate, formatMoney, num } from '@/lib/utils'
import type { BankPositionAccount } from '../api'

const near0 = (v: number) => Math.abs(v) < 0.005

/** on a bank card: books and bank side by side, and whether they agree */
export function BankPositionLine({ a, onOpen }: { a: BankPositionAccount | undefined; onOpen: () => void }) {
  if (!a || a.kind === 'cash') return null
  const st = a.statement
  if (!st) return <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{t('Import a statement to compare the books with the bank.')}</div>
  const ok = near0(num(st.unexplained))
  const old = st.days_old > 7
  return (
    <div className="grid gap-1.5 rounded-md border bg-muted/30 px-3 py-2 text-xs">
      <div className="grid grid-cols-2 gap-2">
        <div><div className="text-muted-foreground">{t('Books on {date}', { date: formatDate(st.date) })}</div><div className="tabular text-sm font-medium">{formatMoney(st.book_at_date, a.currency)}</div></div>
        <div><div className="text-muted-foreground">{t('Bank statement')}</div><div className="tabular text-sm font-medium">{formatMoney(st.closing, a.currency)}</div></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {ok ? <span className="flex items-center gap-1 text-success"><CircleCheck className="size-3.5" />
          {near0(num(st.difference)) ? t('Books and bank agree') : t('The difference is explained')}</span>
          : <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="size-3.5" />{t('Not explained: {amount}', { amount: formatMoney(st.unexplained, a.currency) })}</span>}
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onOpen}><Scale className="size-3.5" /> {t('Why?')}</Button>
      </div>
      {old && <div className="text-warning">{t('The last statement is {n} days old. Import a newer one.', { n: st.days_old })}</div>}
    </div>
  )
}

/** the reconciliation, the way an accountant writes it on paper */
export function BankPositionDialog({ a, onClose }: { a: BankPositionAccount; onClose: () => void }) {
  const st = a.statement!
  const cur = a.currency
  const since = num(a.book_balance) - num(st.book_at_date)
  const Row = ({ label, value, strong, tone, sub }: { label: string; value: number; strong?: boolean; tone?: 'bad' | 'good'; sub?: string }) => (
    <div className={cn('flex items-baseline justify-between gap-3 py-1.5', strong && 'border-t font-medium')}>
      <span>{label}{sub && <span className="block text-xs font-normal text-muted-foreground">{sub}</span>}</span>
      <span className={cn('shrink-0 tabular', tone === 'bad' && 'text-destructive', tone === 'good' && 'text-success')}>{formatMoney(value, cur)}</span>
    </div>
  )
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{a.name}</DialogTitle>
          <DialogDescription>{t('Bank statement of {date} next to the books on the same day.', { date: formatDate(st.date) })}</DialogDescription>
        </DialogHeader>
        <div className="text-[13px]">
          <Row label={t('Balance on the bank statement')} value={st.closing} />
          <Row label={t('− On the statement, not in the books yet')} sub={t('{n} lines to match or book', { n: st.not_in_books_count })} value={-num(st.not_in_books)} />
          <Row label={t('+ In the books, not on the statement yet')} sub={t('{n} payments or entries the bank has not shown', { n: st.not_in_bank_count })} value={st.not_in_bank} />
          <Row label={t('= Should be in the books')} value={num(st.closing) - num(st.not_in_books) + num(st.not_in_bank)} strong />
          <Row label={t('Balance in the books')} value={st.book_at_date} />
          <Row label={t('Not explained')} value={st.unexplained} strong tone={near0(num(st.unexplained)) ? 'good' : 'bad'}
            sub={near0(num(st.unexplained)) ? t('Everything is explained.') : t('Check the opening balance of the statement, or a payment booked to the wrong account.')} />
          {!near0(since) && <p className="mt-1 text-xs text-muted-foreground">{t('Since {date} the books moved by {amount}; today they show {now}.', { date: formatDate(st.date), amount: formatMoney(since, cur), now: formatMoney(a.book_balance, cur) })}</p>}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <ItemList title={t('On the statement, not in the books')} empty={t('Every statement line is in the books.')}
            items={a.not_in_books_items.map((i) => ({ key: i.id, date: i.date, text: i.description ?? '—', amount: i.amount, href: `/finance/bank/statements/${i.statement_id}` }))} cur={cur} />
          <ItemList title={t('In the books, not on the statement')} empty={t('The bank has shown every payment.')}
            items={a.not_in_bank_items.map((i) => ({ key: i.entry_id + i.number, date: i.date, text: [i.number, i.description].filter(Boolean).join(' · '), amount: i.amount, href: `/finance/journal/${i.entry_id}` }))} cur={cur} />
        </div>
        <div className="flex justify-end">
          <Button asChild onClick={onClose}><Link to={`/finance/bank/statements/${st.id}`}>{t('Open the statement')}</Link></Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ItemList({ title, empty, items, cur }: { title: string; empty: string; items: { key: string; date: string; text: string; amount: number; href: string }[]; cur: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      {!items.length ? <p className="text-xs text-muted-foreground">{empty}</p> : (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-md border text-xs">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="w-10 shrink-0 tabular text-muted-foreground">{i.date.slice(8, 10)}.{i.date.slice(5, 7)}</span>
              <Link to={i.href} className="min-w-0 flex-1 truncate hover:underline">{i.text}</Link>
              <span className={cn('shrink-0 tabular', num(i.amount) < 0 ? 'text-destructive' : 'text-success')}>{formatMoney(i.amount, cur)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
