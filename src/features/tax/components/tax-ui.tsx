import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t } from '@/i18n'
import { cn, formatMoney } from '@/lib/utils'
import { monthLabel, previousMonth, useCreateDeclaration } from '../api'

/** YYYY-MM picker */
export function MonthPicker({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return <Input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className={cn('h-9 w-[160px]', className)} aria-label={t('Month')} />
}

export function NewDeclarationDialog({ open, onOpenChange, initialMonth }: { open: boolean; onOpenChange: (o: boolean) => void; initialMonth?: string }) {
  const [ym, setYm] = React.useState(initialMonth ?? previousMonth())
  const create = useCreateDeclaration()
  const navigate = useNavigate()
  React.useEffect(() => { if (open) setYm(initialMonth ?? previousMonth()) }, [open, initialMonth])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('New VAT declaration')}</DialogTitle>
          <DialogDescription>{t('It is filled from the month\'s sales and purchase books, and stays a draft until you submit it.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="decl-month">{t('Month')}</Label>
          <MonthPicker value={ym} onChange={setYm} className="w-full" />
          <p className="text-xs text-muted-foreground">{monthLabel(ym)}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
          <Button loading={create.isPending} onClick={() => {
            const [y, m] = ym.split('-').map(Number) as [number, number]
            create.mutate({ year: y, month: m }, { onSuccess: (id) => { onOpenChange(false); navigate(`/tax/declarations/${id}`) } })
          }}>{t('Create declaration')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Difference indicator: zero = ties */
export function TieOut({ label, book, ledger, diff, note }: { label: string; book: number; ledger: number; diff: number; note?: React.ReactNode }) {
  const ok = Math.abs(diff) < 0.01
  return (
    <div className="grid gap-0.5 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('tabular font-medium', ok ? 'text-success' : 'text-warning')}>{ok ? t('Matches') : t('Off by {amount}', { amount: fmt(diff) })}</span>
      </div>
      <div className="flex justify-between gap-2 text-xs text-muted-foreground"><span>{t('Books {amount}', { amount: fmt(book) })}</span><span>{t('Accounting {amount}', { amount: fmt(ledger) })}</span></div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  )
}
const fmt = (n: number) => formatMoney(n)
