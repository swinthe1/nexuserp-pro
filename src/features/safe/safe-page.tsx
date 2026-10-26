import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, BookOpenText, Calculator, Check, ChevronDown, Landmark, Plus, Receipt, Settings2, TriangleAlert, UserRoundCheck, Vault, X } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { msg, t, td, tn, tServer } from '@/i18n'
import { cn, formatDate, formatMoney, num, todayISO } from '@/lib/utils'
import { type BookLine, type Handover, type Safe, type SafeKind, type SafesOverview, useDepositArrived, useHandoverDecline, useSafeDifferences, useSafeBook, useSafeCancel, useSafeDecide, useSafes } from './api'
import { CountDialog, HandoverDialog, KIND_LABEL, MoveDialog, RefuseDialog, SafeDialog, TakeOverDialog } from './safe-dialogs'

type Open =
  | { kind: 'move'; safe: Safe; move: SafeKind }
  | { kind: 'count'; safe: Safe }
  | { kind: 'settings'; safe: Safe | null; main?: boolean }
  | { kind: 'refuse'; id: string }
  | { kind: 'handover'; safe: Safe }
  | { kind: 'takeover'; handover: Handover }
  | null

const BOOK_KIND: Record<BookLine['kind'], string> = {
  till: msg('Till'), count: msg('Count|book'), other: msg('Other entry'),
  deposit: msg('To the bank'), withdrawal: msg('Taken out'), expense: msg('Expense'), transfer: msg('Between safes'), cash_in: msg('Put in'),
}

/** The shop safe: what is in it, what came from the tills, what went to the bank and what was taken out. */
export function SafePage() {
  const q = useSafes()
  const [open, setOpen] = React.useState<Open>(null)
  const [bookSafe, setBookSafe] = React.useState<string | null>(null)
  const [params] = useSearchParams()
  const highlight = params.get('approve')
  const d = q.data
  const close = () => setOpen(null)
  const askedHandover = params.get('handover')
  const [shown, setShown] = React.useState(false)
  React.useEffect(() => {
    const h = d?.handovers.find((x) => x.id === askedHandover && x.to_me)
    if (h && !shown) { setShown(true); setOpen({ kind: 'takeover', handover: h }) }
  }, [d, askedHandover, shown])

  React.useEffect(() => { if (!bookSafe && d?.safes.length) setBookSafe(d.safes[0]!.id) }, [d, bookSafe])

  return (
    <>
      <PageHeader title={t('Safe|nav')}
        description={t('The cash of the shop: what comes from the tills, what goes to the bank and what is taken out. The safe is an account in the books, so the two always agree.')}
        actions={d?.can.setup && d.safes.length > 0 ? <Button variant="outline" onClick={() => setOpen({ kind: 'settings', safe: null })}><Plus /> {t('New safe')}</Button> : undefined} />

      {q.isLoading ? <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>
        : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        : !d!.safes.length ? (
          <Card><CardContent className="p-0">
            <EmptyState icon={Vault} title={t('No safe yet')}
              description={d!.can.setup ? t('Make the cash box the tills already empty into a safe, or make a new one for a shop.') : t('Someone with access to finance sets up the safe.')}
              action={d!.can.setup ? <div className="flex flex-wrap justify-center gap-2">
                {d!.cash_box_free && <Button onClick={() => setOpen({ kind: 'settings', safe: null, main: true })}>{t('Make the cash box a safe')}</Button>}
                <Button variant={d!.cash_box_free ? 'outline' : 'default'} onClick={() => setOpen({ kind: 'settings', safe: null })}><Plus /> {t('New safe')}</Button>
              </div> : undefined} />
          </CardContent></Card>
        ) : (
          <div className="grid gap-6 [&>*]:min-w-0">
            {d!.handovers.length > 0 && <HandoverList data={d!} onTake={(h) => setOpen({ kind: 'takeover', handover: h })} />}
            {d!.waiting.length > 0 && <WaitingList data={d!} highlight={highlight} onRefuse={(id) => setOpen({ kind: 'refuse', id })} />}
            <Totals data={d!} />
            <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
              {d!.safes.map((s) => <SafeCard key={s.id} safe={s} data={d!} onOpen={setOpen} onBook={() => setBookSafe(s.id)} />)}
            </div>
            {d!.on_the_way.length > 0 && <OnTheWayList data={d!} />}
            <DifferencesCard data={d!} />
            {bookSafe && <SafeBookCard data={d!} safeId={bookSafe} onSafe={setBookSafe} />}
          </div>
        )}

      {open?.kind === 'move' && d && <MoveDialog safe={open.safe} kind={open.move} data={d} onClose={close} />}
      {open?.kind === 'count' && d && <CountDialog safe={open.safe} data={d} onClose={close} />}
      {open?.kind === 'settings' && d && <SafeDialog safe={open.safe} main={open.main} data={d} onClose={close} />}
      {open?.kind === 'refuse' && <RefuseDialog id={open.id} onClose={close} />}
      {open?.kind === 'handover' && d && <HandoverDialog safe={open.safe} data={d} onClose={close} />}
      {open?.kind === 'takeover' && d && <TakeOverDialog handover={open.handover} safe={d.safes.find((s) => s.id === open.handover.safe_id)} data={d} onClose={close} />}
    </>
  )
}

function SafeCard({ safe, data, onOpen, onBook }: { safe: Safe; data: SafesOverview; onOpen: (o: Open) => void; onBook: () => void }) {
  const cur = data.currency
  const full = safe.max_balance != null && num(safe.balance) > num(safe.max_balance)
  const lc = safe.last_count
  const move = (m: SafeKind) => onOpen({ kind: 'move', safe, move: m })
  const handing = data.handovers.find((h) => h.safe_id === safe.id)
  return (
    <Card className={cn(!safe.is_active && 'opacity-60')}>
      <CardContent className="grid gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Vault className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{safe.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {[safe.warehouse ? td(safe.warehouse) : t('Central'), safe.holder && t('held by {name}', { name: safe.holder })].filter(Boolean).join(' · ')}
            </p>
          </div>
          {!safe.is_active && <Badge variant="secondary">{t('Not in use')}</Badge>}
          {handing && <Badge variant="warning">{t('Being handed to {name}', { name: handing.to ?? '' })}</Badge>}
          {data.can.setup && <Button variant="ghost" size="icon" aria-label={t('Settings')} onClick={() => onOpen({ kind: 'settings', safe })}><Settings2 /></Button>}
        </div>

        <div>
          <p className="text-4xl font-semibold tracking-tight tabular-nums">{formatMoney(safe.balance, cur)}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t('Today in {in}, out {out}', { in: formatMoney(safe.today_in, cur), out: formatMoney(safe.today_out, cur) })}
          </p>
        </div>

        {full && (
          <p className="flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-[13px] text-warning">
            <TriangleAlert className="size-4 shrink-0" />{t('More than {max} in the safe. Take some to the bank.', { max: formatMoney(safe.max_balance, cur) })}
          </p>
        )}

        <dl className="grid gap-1.5 text-[13px]">
          <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">{t('Last count')}</dt>
            <dd className="min-w-0">{lc ? <>{formatDate(lc.at, true)}{lc.by ? ` · ${lc.by}` : ''}{' · '}
              <span className={cn(num(lc.difference) === 0 ? 'text-success' : Math.abs(num(lc.difference)) > num(safe.tolerance) ? 'text-destructive' : 'text-warning')}>
                {num(lc.difference) === 0 ? t('matched') : `${num(lc.difference) > 0 ? '+' : ''}${formatMoney(lc.difference, cur)}`}</span></>
              : <span className="text-muted-foreground">{t('never counted')}</span>}</dd></div>
          <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">{t('Tills')}</dt>
            <dd className="min-w-0">{safe.tills.length ? safe.tills.map(td).join(', ') : <span className="text-muted-foreground">{t('none empty into it')}</span>}</dd></div>
        </dl>

        {data.can.move && safe.is_active && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => onOpen({ kind: 'count', safe })}><Calculator /> {t('Count')}</Button>
            <Button variant="outline" onClick={() => move('deposit')}><Landmark /> {t('To the bank')}</Button>
            <Button variant="outline" onClick={() => move('withdrawal')}><ArrowUpFromLine /> {t('Take out')}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline">{t('More')} <ChevronDown /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => move('expense')}><Receipt /> {t(KIND_LABEL.expense)}</DropdownMenuItem>
                {data.safes.filter((s) => s.is_active).length > 1 && <DropdownMenuItem onSelect={() => move('transfer')}><ArrowLeftRight /> {t(KIND_LABEL.transfer)}</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => move('cash_in')}><ArrowDownToLine /> {t(KIND_LABEL.cash_in)}</DropdownMenuItem>
                {data.people.length > 0 && !handing && <DropdownMenuItem onSelect={() => onOpen({ kind: 'handover', safe })}><UserRoundCheck /> {t('Hand over the safe')}</DropdownMenuItem>}
                <DropdownMenuItem onSelect={onBook}><BookOpenText /> {t('The safe book')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function HandoverList({ data, onTake }: { data: SafesOverview; onTake: (h: Handover) => void }) {
  const decline = useHandoverDecline()
  return (
    <Card className="border-primary/40">
      <CardContent className="p-0">
        <p className="border-b px-5 py-3 text-sm font-medium">{t('Safes being handed over')}</p>
        <ul className="divide-y">
          {data.handovers.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <UserRoundCheck className="size-5 shrink-0 text-primary" />
              <div className="min-w-[12rem] flex-1 text-[13px]">
                <p>{h.to_me ? t('{name} hands you {safe}', { name: h.from ?? '', safe: h.safe }) : t('{safe}: from {from} to {to}', { safe: h.safe, from: h.from ?? '', to: h.to ?? '' })}</p>
                <p className="text-xs text-muted-foreground">{formatDate(h.created_at, true)}</p>
              </div>
              {h.to_me && <Button size="sm" onClick={() => onTake(h)}><Calculator /> {t('Count and take it')}</Button>}
              {!h.to_me && (h.from_me || data.can.approve) && <Button size="sm" variant="ghost" loading={decline.isPending} onClick={() => decline.mutate({ id: h.id })}>{t('Take back')}</Button>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function WaitingList({ data, highlight, onRefuse }: { data: SafesOverview; highlight: string | null; onRefuse: (id: string) => void }) {
  const decide = useSafeDecide()
  const cancel = useSafeCancel()
  return (
    <Card className="border-warning/40">
      <CardContent className="p-0">
        <p className="border-b px-5 py-3 text-sm font-medium">{t('Waiting for approval')}</p>
        <ul className="divide-y">
          {data.waiting.map((w) => (
            <li key={w.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3', w.id === highlight && 'bg-warning/5')}>
              <span className="text-lg font-semibold tabular-nums">{formatMoney(w.amount, data.currency)}</span>
              <div className="min-w-[12rem] flex-1 text-[13px]">
                <p className="truncate">{t(KIND_LABEL[w.kind])} · {w.safe} · {w.reason}</p>
                <p className="text-xs text-muted-foreground">{[w.by, formatDate(w.created_at, true), w.number].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex gap-2">
                {data.can.approve && <>
                  <Button size="sm" loading={decide.isPending && decide.variables?.id === w.id} onClick={() => decide.mutate({ id: w.id, approve: true })}><Check /> {t('Approve')}</Button>
                  <Button size="sm" variant="outline" onClick={() => onRefuse(w.id)}><X /> {t('Refuse')}</Button>
                </>}
                {w.mine && !data.can.approve && <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => cancel.mutate(w.id)}>{t('Take back')}</Button>}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function OnTheWayList({ data }: { data: SafesOverview }) {
  const arrived = useDepositArrived()
  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b px-5 py-3">
          <p className="text-sm font-medium">{t('On the way to the bank')}</p>
          <p className="text-xs text-muted-foreground">{t('Out of the safe, not yet on the bank statement. Mark each one when you see it in the bank.')}</p>
        </div>
        <ul className="divide-y">
          {data.on_the_way.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <span className="font-semibold tabular-nums">{formatMoney(m.amount, data.currency)}</span>
              <div className="min-w-[12rem] flex-1 text-[13px]">
                <p className="truncate">{m.safe} → {m.bank ? td(m.bank) : '—'} · {m.reason}</p>
                <p className="text-xs text-muted-foreground">{[formatDate(m.moved_on), m.reference && t('slip {ref}', { ref: m.reference }), m.number].filter(Boolean).join(' · ')}</p>
              </div>
              {data.can.move && <Button size="sm" variant="outline" loading={arrived.isPending && arrived.variables?.id === m.id} onClick={() => arrived.mutate({ id: m.id })}>
                <Check /> {t('It is in the bank')}</Button>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function Totals({ data }: { data: SafesOverview }) {
  const total = data.safes.reduce((s, x) => s + num(x.balance), 0)
  const onWay = data.on_the_way.reduce((s, x) => s + num(x.amount), 0)
  return (
    <div className="flex flex-wrap items-baseline gap-x-8 gap-y-1 text-[13px] text-muted-foreground">
      <span>{tn(data.safes.length, 'In {n} safe', 'In {n} safes')} <span className="ml-1 text-base font-semibold text-foreground tabular-nums">{formatMoney(total, data.currency)}</span></span>
      {onWay > 0 && <span>{t('On the way to the bank')} <span className="ml-1 font-medium text-foreground tabular-nums">{formatMoney(onWay, data.currency)}</span></span>}
      {data.waiting.length > 0 && <span>{tn(data.waiting.length, '{n} waits for approval', '{n} wait for approval')}</span>}
    </div>
  )
}

function DifferencesCard({ data }: { data: SafesOverview }) {
  const [from, setFrom] = React.useState(monthStart)
  const [to, setTo] = React.useState(todayISO)
  const q = useSafeDifferences(from, to)
  const cur = data.currency
  const money = (v: number) => (num(v) === 0 ? <span className="text-muted-foreground">0</span>
    : <span className={num(v) < 0 ? 'text-destructive' : 'text-success'}>{num(v) > 0 ? '+' : ''}{formatMoney(v, cur)}</span>)
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <div className="mr-auto">
            <p className="text-sm font-medium">{t('Differences by person')}</p>
            <p className="text-xs text-muted-foreground">{t('Till shifts they closed, safe counts they made and handovers they took that did not agree.')}</p>
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <Label htmlFor="sd-from" className="text-muted-foreground">{t('From')}</Label><Input id="sd-from" type="date" className="h-8 w-[140px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Label htmlFor="sd-to" className="text-muted-foreground">{t('To')}</Label><Input id="sd-to" type="date" className="h-8 w-[140px]" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {q.isLoading ? <Skeleton className="m-4 h-24" /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.length
          ? <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">{t('No shifts or counts in these days.')}</p> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('Person')}</TableHead><TableHead className="text-right">{t('Shifts')}</TableHead><TableHead className="text-right">{t('At the till')}</TableHead>
                <TableHead className="text-right">{t('Counts')}</TableHead><TableHead className="text-right">{t('In the safe')}</TableHead>
                <TableHead className="text-right">{t('Handovers that did not agree')}</TableHead><TableHead className="text-right">{t('Total')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {q.data.map((p) => (
                  <TableRow key={p.user_id}>
                    <TableCell className="font-medium">{p.name ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.shifts}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{money(p.shift_diff)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.counts}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{money(p.count_diff)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.handovers_off || ''}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{money(p.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function monthStart() { return `${todayISO().slice(0, 8)}01` }

function SafeBookCard({ data, safeId, onSafe }: { data: SafesOverview; safeId: string; onSafe: (id: string) => void }) {
  const [from, setFrom] = React.useState(monthStart)
  const [to, setTo] = React.useState(todayISO)
  const book = useSafeBook(safeId, from, to)
  const cur = data.currency
  const b = book.data
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-3">
          <p className="mr-auto text-sm font-medium">{t('The safe book')}</p>
          {data.safes.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {data.safes.map((s) => <Button key={s.id} size="sm" variant={s.id === safeId ? 'secondary' : 'ghost'} onClick={() => onSafe(s.id)}>{s.name}</Button>)}
            </div>
          )}
          <div className="flex items-center gap-2 text-[13px]">
            <Label htmlFor="sb-from" className="text-muted-foreground">{t('From')}</Label><Input id="sb-from" type="date" className="h-8 w-[140px]" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Label htmlFor="sb-to" className="text-muted-foreground">{t('To')}</Label><Input id="sb-to" type="date" className="h-8 w-[140px]" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        {book.isLoading ? <Skeleton className="m-4 h-32" /> : book.isError ? <ErrorState error={book.error} onRetry={() => void book.refetch()} /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-28">{t('Date')}</TableHead><TableHead>{t('What')}</TableHead><TableHead>{t('Description')}</TableHead>
                <TableHead className="text-right">{t('In')}</TableHead><TableHead className="text-right">{t('Out')}</TableHead><TableHead className="text-right">{t('Balance')}</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                <TableRow className="bg-muted/40"><TableCell colSpan={5} className="text-[13px] text-muted-foreground">{t('In the safe on {date}', { date: formatDate(from) })}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">{formatMoney(b?.opening, cur)}</TableCell></TableRow>
                {(b?.lines ?? []).map((l, i) => (
                  <TableRow key={`${l.entry_id}-${i}`}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatDate(l.date)}</TableCell>
                    <TableCell className="whitespace-nowrap text-[13px]">{t(BOOK_KIND[l.kind] ?? BOOK_KIND.other)}</TableCell>
                    <TableCell className="min-w-[16rem] max-w-[28rem] text-[13px]">
                      <Link to={l.source_type === 'pos_session' && l.source_id ? `/pos/sessions/${l.source_id}` : `/finance/journal/${l.entry_id}`} className="hover:underline">
                        <span className="text-muted-foreground">{l.reference}</span> {tServer(l.memo)}</Link>
                      {l.by && <span className="text-xs text-muted-foreground"> · {l.by}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{num(l.in) ? formatMoney(l.in, cur) : ''}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{num(l.out) ? formatMoney(l.out, cur) : ''}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(l.balance, cur)}</TableCell>
                  </TableRow>
                ))}
                {!b?.lines.length && <TableRow><TableCell colSpan={6} className="py-8 text-center text-[13px] text-muted-foreground">{t('Nothing moved in these days.')}</TableCell></TableRow>}
                <TableRow className="bg-muted/40"><TableCell colSpan={5} className="text-[13px] font-medium">{t('In the safe on {date}', { date: formatDate(to) })}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(b?.closing, cur)}</TableCell></TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
