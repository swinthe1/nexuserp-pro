import * as React from 'react'
import { toast } from 'sonner'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useWarehouses } from '@/features/inventory/api'
import { useMembers } from '@/features/sales/api'
import { msg, t, td } from '@/i18n'
import { describeError } from '@/lib/errors'
import { cn, formatMoney, num } from '@/lib/utils'
import { type Safe, type SafeKind, type SafesOverview, useSafeCount, useSafeDecide, useSafeMove, useSafeSave, useTillSafe } from './api'

export const KIND_LABEL: Record<SafeKind, string> = {
  deposit: msg('Deposit in the bank'),
  withdrawal: msg('Take money out'),
  expense: msg('Pay an expense'),
  transfer: msg('Move to another safe'),
  cash_in: msg('Put money in'),
}
const KIND_HELP: Record<SafeKind, string> = {
  deposit: msg('The money leaves the safe now and is shown as on its way until it is on the bank statement.'),
  withdrawal: msg('For the owner or anything that is not a business expense. It is booked as owner drawings.'),
  expense: msg('A small expense paid in cash, booked on the expense you choose.'),
  transfer: msg('From this safe to another one, for example to the central safe.'),
  cash_in: msg('Money that comes into the safe from outside the tills, for example change the owner brings.'),
}
const REASON_HINT: Record<SafeKind, string> = {
  deposit: msg('e.g. Monday takings'),
  withdrawal: msg('e.g. for the owner'),
  expense: msg('e.g. cleaning, small repair'),
  transfer: msg('e.g. to the office'),
  cash_in: msg('e.g. change from the owner'),
}

const amountOk = (v: string) => num(v.replace(',', '.')) > 0
const toAmount = (v: string) => Math.round(num(v.replace(',', '.')) * 100) / 100

/** One movement of money in or out of a safe. */
export function MoveDialog({ safe, kind, data, onClose }: { safe: Safe; kind: SafeKind; data: SafesOverview; onClose: () => void }) {
  const move = useSafeMove()
  const [amount, setAmount] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [bank, setBank] = React.useState(data.banks[0]?.id ?? '')
  const [toSafe, setToSafe] = React.useState('')
  const [account, setAccount] = React.useState('')
  const [reference, setReference] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const others = data.safes.filter((s) => s.id !== safe.id && s.is_active)
  const amt = toAmount(amount)
  const out = kind !== 'cash_in'
  const waits = (kind === 'withdrawal' || kind === 'expense') && amt > num(safe.approval_limit) && !data.can.approve
  const ready = amountOk(amount) && reason.trim() && (kind !== 'deposit' || bank) && (kind !== 'transfer' || toSafe) && (kind !== 'expense' || account)

  const submit = () => {
    setError(null)
    move.mutate({ safe_id: safe.id, kind, amount: amt, reason: reason.trim(), bank_account_id: kind === 'deposit' ? bank : undefined,
      to_safe_id: kind === 'transfer' ? toSafe : undefined, account_id: kind === 'expense' ? account : undefined, reference: reference.trim() || undefined }, {
      onSuccess: (r) => {
        toast.success(r.status === 'pending' ? t('Sent for approval. The money stays in the safe until it is approved.') : t('Done: {number}', { number: r.number }))
        onClose()
      },
      onError: (e) => setError(describeError(e)),
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t(KIND_LABEL[kind])}</DialogTitle>
          <DialogDescription>{safe.name} · {t('in the safe {amount}', { amount: formatMoney(safe.balance, data.currency) })}. {t(KIND_HELP[kind])}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="sm-amount">{t('Amount')}</Label>
            <Input id="sm-amount" inputMode="decimal" autoFocus className="h-14 text-center text-3xl font-semibold tabular-nums" placeholder="0.00"
              value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.,]/g, '')); setError(null) }} />
            {out && amt > num(safe.balance) && <p className="text-xs text-destructive">{t('The safe has only {amount}', { amount: formatMoney(safe.balance, data.currency) })}</p>}
            {waits && <p className="text-xs text-warning">{t('Above {limit} it waits for approval before the money leaves.', { limit: formatMoney(safe.approval_limit, data.currency) })}</p>}
          </div>
          {kind === 'deposit' && (
            <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
              <div className="grid gap-1.5"><Label>{t('Bank account')}</Label>
                <Select value={bank} onValueChange={setBank}><SelectTrigger><SelectValue placeholder={t('Choose the bank')} /></SelectTrigger>
                  <SelectContent>{data.banks.map((b) => <SelectItem key={b.id} value={b.id}>{td(b.name)}</SelectItem>)}</SelectContent></Select>
                {!data.banks.length && <p className="text-xs text-muted-foreground">{t('Add the bank account first in Finance → Bank and cash.')}</p>}
              </div>
              <div className="grid gap-1.5"><Label htmlFor="sm-ref">{t('Slip number')}</Label>
                <Input id="sm-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('optional')} /></div>
            </div>
          )}
          {kind === 'transfer' && (
            <div className="grid gap-1.5"><Label>{t('To the safe')}</Label>
              <Select value={toSafe} onValueChange={setToSafe}><SelectTrigger><SelectValue placeholder={t('Choose the safe')} /></SelectTrigger>
                <SelectContent>{others.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
            </div>
          )}
          {kind === 'expense' && (
            <div className="grid gap-1.5"><Label>{t('Expense')}</Label>
              <Select value={account} onValueChange={setAccount}><SelectTrigger><SelectValue placeholder={t('What was it for?')} /></SelectTrigger>
                <SelectContent>{data.expense_accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.code} · {td(a.name)}</SelectItem>)}</SelectContent></Select>
            </div>
          )}
          <div className="grid gap-1.5"><Label htmlFor="sm-reason">{t('Why')}</Label>
            <Input id="sm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t(REASON_HINT[kind])} onKeyDown={(e) => { if (e.key === 'Enter' && ready) submit() }} /></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!ready} loading={move.isPending} onClick={submit}>{waits ? t('Ask for approval') : t(KIND_LABEL[kind])}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const pieceLabel = (p: number, cur: string) => formatMoney(p, cur, p < 1 ? 2 : 0)
const pieceKey = (p: number) => String(Number(p.toFixed(2)))

/** Counting the safe note by note. The books are shown only after the count, so nobody counts towards a number. */
export function CountDialog({ safe, data, onClose }: { safe: Safe; data: SafesOverview; onClose: () => void }) {
  const count = useSafeCount()
  const [qty, setQty] = React.useState<Record<string, string>>({})
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<{ number: string; total: number; expected: number; difference: number } | null>(null)
  const total = data.pieces.reduce((s, p) => s + p * num(qty[pieceKey(p)]), 0)
  const notes = data.pieces.filter((p) => p >= 5)
  const coins = data.pieces.filter((p) => p < 5)

  const submit = () => {
    setError(null)
    const counts = Object.fromEntries(Object.entries(qty).filter(([, v]) => num(v) > 0).map(([k, v]) => [k, Math.trunc(num(v))]))
    count.mutate({ safe: safe.id, counts, note: note.trim() || undefined }, { onSuccess: setResult, onError: (e) => setError(describeError(e)) })
  }

  const row = (p: number) => {
    const k = pieceKey(p)
    return (
      <div key={k} className="grid grid-cols-[6.5rem_1fr_6rem] items-center gap-2">
        <span className="whitespace-nowrap text-right text-sm font-medium tabular-nums">{pieceLabel(p, data.currency)}</span>
        <Input inputMode="numeric" aria-label={t('How many of {piece}', { piece: pieceLabel(p, data.currency) })} className="h-9 text-center tabular-nums"
          value={qty[k] ?? ''} placeholder="0" onChange={(e) => { setQty((q) => ({ ...q, [k]: e.target.value.replace(/\D/g, '').slice(0, 5) })); setError(null) }} />
        <span className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">{num(qty[k]) ? formatMoney(p * num(qty[k]), data.currency) : ''}</span>
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Count {safe}', { safe: safe.name })}</DialogTitle>
          <DialogDescription>{result ? t('Count {number} is saved.', { number: result.number }) : t('Write how many of each note and coin there are. What the books say is shown after you save.')}</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{t('You counted')}</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(result.total, data.currency)}</p></div>
              <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{t('The books said')}</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(result.expected, data.currency)}</p></div>
              <div className={cn('rounded-lg border p-3', result.difference === 0 ? 'border-success/40 bg-success/5' : Math.abs(result.difference) > num(safe.tolerance) ? 'border-destructive/40 bg-destructive/5' : 'border-warning/40 bg-warning/5')}>
                <p className="text-xs text-muted-foreground">{t('Difference')}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{result.difference > 0 ? '+' : ''}{formatMoney(result.difference, data.currency)}</p></div>
            </div>
            <p className="text-sm text-muted-foreground">{result.difference === 0 ? t('The safe matches the books.')
              : t('The difference is booked and the safe now shows what you counted.')}</p>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              <div className="grid content-start gap-2"><p className="text-xs font-medium text-muted-foreground">{t('Notes')}</p>{notes.map(row)}</div>
              <div className="grid content-start gap-2"><p className="text-xs font-medium text-muted-foreground">{t('Coins')}</p>{coins.map(row)}</div>
            </div>
            <div className="flex items-baseline justify-between rounded-lg bg-muted/60 px-4 py-3">
              <span className="text-sm text-muted-foreground">{t('Counted')}</span>
              <span className="text-2xl font-semibold tabular-nums">{formatMoney(total, data.currency)}</span>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="sc-note">{t('Note')}</Label>
              <Textarea id="sc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Needed when the count does not match the books')} /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          {result ? <Button onClick={onClose}>{t('Close')}</Button> : <>
            <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            <Button loading={count.isPending} onClick={submit}>{t('Save the count')}</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A refusal says why, so the person who asked knows. */
export function RefuseDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const decide = useSafeDecide()
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{t('Refuse')}</DialogTitle><DialogDescription>{t('The person who asked sees your reason.')}</DialogDescription></DialogHeader>
        <Textarea rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('Why not?')} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="destructive" disabled={!note.trim()} loading={decide.isPending}
            onClick={() => decide.mutate({ id, approve: false, note: note.trim() }, { onSuccess: () => { toast.success(t('Refused')); onClose() }, onError: (e) => setError(describeError(e)) })}>{t('Refuse')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const AUTO = '__auto'
const NONE = '__none'

/** A new safe or the settings of one, with the tills that empty into it. */
export function SafeDialog({ safe, data, main, onClose }: { safe: Safe | null; data: SafesOverview; main?: boolean; onClose: () => void }) {
  const { companyId } = useCompany()
  const save = useSafeSave()
  const tillSafe = useTillSafe()
  const warehouses = useWarehouses()
  const members = useMembers()
  const [name, setName] = React.useState(safe?.name ?? (main ? t('Main safe') : ''))
  const [wh, setWh] = React.useState(safe?.warehouse_id ?? NONE)
  const [holder, setHolder] = React.useState(safe?.holder_id ?? NONE)
  const [limit, setLimit] = React.useState(String(safe?.approval_limit ?? 200))
  const [tol, setTol] = React.useState(String(safe?.tolerance ?? 5))
  const [max, setMax] = React.useState(safe?.max_balance ? String(safe.max_balance) : '')
  const [active, setActive] = React.useState(safe?.is_active ?? true)
  const [error, setError] = React.useState<string | null>(null)

  const submit = () => {
    setError(null)
    save.mutate({ company_id: companyId!, id: safe?.id, name: name.trim(), warehouse_id: wh === NONE ? null : wh, holder_id: holder === NONE ? null : holder,
      approval_limit: toAmount(limit), tolerance: toAmount(tol), max_balance: amountOk(max) ? toAmount(max) : null, is_active: active, main },
    { onSuccess: () => { toast.success(t('Saved')); onClose() }, onError: (e) => setError(describeError(e)) })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{safe ? safe.name : main ? t('Make the cash box a safe') : t('New safe')}</DialogTitle>
          <DialogDescription>{main ? t('The cash box the tills already empty into becomes the safe, with everything that is in it.')
            : safe ? t('Account {code} in the books.', { code: safe.account_code ?? '—' }) : t('It gets its own cash account in the books, next to the cash box.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="sf-name">{t('Name')}</Label>
            <Input id="sf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Safe at the Prishtina shop')} /></div>
          <div className="grid gap-1.5"><Label>{t('Shop')}</Label>
            <Select value={wh} onValueChange={setWh}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>{t('Not in a shop (central)')}</SelectItem>
                {(warehouses.data ?? []).map((w) => <SelectItem key={w.id} value={w.id}>{td(w.name)}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>{t('Who holds it')}</Label>
            <Select value={holder} onValueChange={setHolder}><SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>{t('Nobody in particular')}</SelectItem>
                {(members.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.full_name || m.email}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label htmlFor="sf-limit">{t('Approval above')}</Label>
            <Input id="sf-limit" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('Taking out or paying more than this waits for the owner.')}</p></div>
          <div className="grid gap-1.5"><Label htmlFor="sf-tol">{t('Allowed difference')}</Label>
            <Input id="sf-tol" inputMode="decimal" value={tol} onChange={(e) => setTol(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('A bigger difference in a count needs a note and is reported.')}</p></div>
          <div className="grid gap-1.5"><Label htmlFor="sf-max">{t('Most it should hold')}</Label>
            <Input id="sf-max" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} placeholder={t('no limit')} />
            <p className="text-xs text-muted-foreground">{t('Above this the safe asks for a bank deposit.')}</p></div>
          {safe && <div className="flex items-center gap-3 self-center"><Switch id="sf-active" checked={active} onCheckedChange={setActive} /><Label htmlFor="sf-active">{t('In use')}</Label></div>}
        </div>
        {safe && data.tills.length > 0 && (
          <div className="mt-2 grid gap-2">
            <p className="text-sm font-medium">{t('Tills')}</p>
            <p className="text-xs text-muted-foreground">{t('At closing each till empties into a safe: the one you choose, or else the safe of its shop.')}</p>
            <ul className="divide-y rounded-md border">
              {data.tills.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{td(r.name)}</span>
                  <Select value={r.safe_id ?? AUTO} onValueChange={(v) => tillSafe.mutate({ register: r.id, safe: v === AUTO ? null : v })}>
                    <SelectTrigger className="h-8 w-52"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value={AUTO}>{t('The safe of its shop')}</SelectItem>
                      {data.safes.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!name.trim()} loading={save.isPending} onClick={submit}>{safe ? t('Save') : t('Create the safe')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
