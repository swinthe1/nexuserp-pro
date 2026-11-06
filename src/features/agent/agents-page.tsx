import { ArrowDown, ArrowUp, Banknote, MapPin, Pencil, Plus, Route, ShoppingBag, Smartphone, Trash2, UserRoundPlus } from 'lucide-react'
import { PageTableExport } from '@/components/page-table-export'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PageHeader } from '@/components/page-header'
import { SearchSelect } from '@/components/search-select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { msg, t, tn } from '@/i18n'
import { describeError } from '@/lib/errors'
import { cn, formatDate, formatMoney, todayISO } from '@/lib/utils'
import { useCustomers } from '@/features/sales/api'
import { type AgentsSetup, type DayAgent, type ManagedAgent, type Outcome, useAgentsDay, useAgentsSetup, useSaveAgent, useSaveRoute } from './api'

const WEEKDAYS = [msg('Monday'), msg('Tuesday'), msg('Wednesday'), msg('Thursday'), msg('Friday'), msg('Saturday'), msg('Sunday')]
const SHORT = [msg('Mon|day'), msg('Tue|day'), msg('Wed|day'), msg('Thu|day'), msg('Fri|day'), msg('Sat|day'), msg('Sun|day')]
const OUTCOME: Record<Outcome, string> = {
  order: msg('Order'), payment: msg('Collected|cash'), no_order: msg('No order today'), closed: msg('Closed'), other: msg('Visit note'),
}

/** The sales manager's view of the field agents: today's visits, orders and cash, and who visits whom on which day. */
export function AgentsPage() {
  const [tab, setTab] = React.useState('day')
  return (
    <>
      <PageHeader title={t('Field agents')}
        description={t('Agents take orders and collect cash at the customer with their phone, also without internet. Here you see their day and plan their routes.')}
        actions={<><PageTableExport />{<Button variant="outline" asChild><Link to="/agent"><Smartphone /> {t('Open the agent app')}</Link></Button>}</>} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="day">{t('The day')}</TabsTrigger><TabsTrigger value="setup">{t('Agents and routes')}</TabsTrigger></TabsList>
        <TabsContent value="day"><DayTab onSetup={() => setTab('setup')} /></TabsContent>
        <TabsContent value="setup"><SetupTab /></TabsContent>
      </Tabs>
    </>
  )
}

function DayTab({ onSetup }: { onSetup: () => void }) {
  const [date, setDate] = React.useState(todayISO())
  const [agent, setAgent] = React.useState<string | null>(null)
  const q = useAgentsDay(date)
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const d = q.data
  const visits = (d?.visits ?? []).filter((v) => !agent || v.agent_id === agent)
  const name = new Map((d?.agents ?? []).map((a) => [a.id, a.name]))
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5"><Label htmlFor="ag-day">{t('Day')}</Label><Input id="ag-day" type="date" className="w-44" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
        {agent && <Button variant="ghost" onClick={() => setAgent(null)}>{t('All agents')}</Button>}
      </div>
      {q.isPending ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>
        : !d?.agents.length ? <EmptyState icon={UserRoundPlus} title={t('No field agents yet')} description={t('Set up an agent: the member, the warehouse they sell from and their cash bag.')}
            action={<Button onClick={onSetup}><Plus /> {t('Set up an agent')}</Button>} />
        : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {d.agents.filter((a) => a.is_active || a.visited || a.orders).map((a) => <AgentCard key={a.id} a={a} currency={d.currency} selected={agent === a.id} onSelect={() => setAgent(agent === a.id ? null : a.id)} />)}
          </div>
        )}
      {d && d.agents.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">{agent ? t('Visits of {name}', { name: name.get(agent) ?? '' }) : t('Visits')} <span className="text-muted-foreground">· {visits.length}</span></h2>
          {visits.length === 0 ? <EmptyState compact icon={MapPin} title={t('No visits on this day')} /> : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>{t('Time')}</TableHead><TableHead>{t('Agent')}</TableHead><TableHead>{t('Customer')}</TableHead><TableHead>{t('Result')}</TableHead>
                  <TableHead className="text-right">{t('Amount (with VAT)')}</TableHead><TableHead>{t('Where')}</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {visits.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="whitespace-nowrap tabular-nums">{new Date(v.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                      <TableCell className="whitespace-nowrap">{name.get(v.agent_id)}</TableCell>
                      <TableCell><Link className="hover:underline" to={`/partners/${v.partner_id}`}>{v.partner}</Link></TableCell>
                      <TableCell>
                        {v.order ? <Link className="hover:underline" to={`/sales/orders/${v.order.id}`}>{v.order.number}</Link>
                          : v.payment ? <Link className="hover:underline" to={`/finance/payments/${v.payment.id}`}>{v.payment.number}</Link> : t(OUTCOME[v.outcome])}
                        {v.order && ['draft', 'pending_approval'].includes(v.order.status) && <Badge variant="outline" className="ml-2">{t('Waits for you')}</Badge>}
                        {v.note && <span className="block text-[12px] text-muted-foreground">{v.note}</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{v.order ? formatMoney(v.order.total, v.order.currency) : v.payment ? formatMoney(v.payment.amount, v.payment.currency) : ''}</TableCell>
                      <TableCell className="whitespace-nowrap text-[13px]">
                        {v.lat != null ? (
                          <a className={cn('inline-flex items-center gap-1 hover:underline', v.distance_m != null && v.distance_m > 300 && 'text-amber-700 dark:text-amber-400')}
                            href={`https://www.google.com/maps?q=${v.lat},${v.lng}`} target="_blank" rel="noreferrer">
                            <MapPin className="size-3.5" />
                            {v.distance_m == null ? t('On the map') : v.distance_m < 1000 ? t('{n} m from the shop', { n: Math.round(v.distance_m) }) : t('{n} km from the shop', { n: (v.distance_m / 1000).toFixed(1) })}
                          </a>
                        ) : <span className="text-muted-foreground">{t('No location')}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function AgentCard({ a, currency, selected, onSelect }: { a: DayAgent; currency: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected}
      className={cn('rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50', selected && 'border-primary ring-1 ring-primary')}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{a.name}</p>
        {a.held > 0 && <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400">{tn(a.held, '{n} order waits', '{n} orders wait')}</Badge>}
      </div>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {a.planned ? t('{done} of {n} on the route visited', { done: a.planned_visited, n: a.planned }) : t('No route for this day')}
        {a.visited > a.planned_visited && ` · ${tn(a.visited - a.planned_visited, '{n} more', '{n} more')}`}
      </p>
      {a.planned > 0 && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (a.planned_visited / a.planned) * 100)}%` }} /></div>}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
        <div><dt className="flex items-center gap-1 text-muted-foreground"><ShoppingBag className="size-3.5" />{t('Orders, with VAT')}</dt><dd className="font-semibold tabular-nums">{a.orders} · {formatMoney(a.orders_total, currency, 0)}</dd></div>
        <div><dt className="flex items-center gap-1 text-muted-foreground"><Banknote className="size-3.5" />{t('Collected|cash')}</dt><dd className="font-semibold tabular-nums">{formatMoney(a.collected, currency, 0)}</dd></div>
        <div><dt className="text-muted-foreground">{t('In the bag')}</dt><dd className="font-semibold tabular-nums">{a.cash == null ? '—' : formatMoney(a.cash, currency, 0)}</dd></div>
      </dl>
      {a.last && <p className="mt-2 truncate text-[12px] text-muted-foreground">{t('Last seen at {name}, {time}', { name: a.last.partner, time: formatDate(a.last.at, true) })}</p>}
    </button>
  )
}

// ---------------------------------------------------------------------------------------------
function SetupTab() {
  const q = useAgentsSetup()
  const [edit, setEdit] = React.useState<ManagedAgent | 'new' | null>(null)
  const [route, setRoute] = React.useState<ManagedAgent | null>(null)
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  if (q.isPending) return <Skeleton className="h-48" />
  const s = q.data
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-[13px] text-muted-foreground">{t('The cash an agent collects stays in their bag (a safe they hold) until they hand it in; take it into the shop safe on the Safe page.')}</p>
        <Button onClick={() => setEdit('new')} disabled={!s.members.length}><Plus /> {t('Set up an agent')}</Button>
      </div>
      {s.agents.length === 0 ? <EmptyState icon={UserRoundPlus} title={t('No field agents yet')} description={t('Any member can be an agent; sales reps are the usual ones.')} /> : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader><TableRow>
              <TableHead>{t('Agent')}</TableHead><TableHead>{t('Sells from')}</TableHead><TableHead>{t('Cash bag')}</TableHead><TableHead className="text-right">{t('Customers')}</TableHead>
              <TableHead>{t('Route|agent')}</TableHead><TableHead className="w-0" />
            </TableRow></TableHeader>
            <TableBody>
              {s.agents.map((a) => (
                <TableRow key={a.id} className={cn(!a.is_active && 'opacity-60')}>
                  <TableCell className="font-medium">{a.name}{!a.is_active && <Badge variant="outline" className="ml-2">{t('Not active')}</Badge>}</TableCell>
                  <TableCell>{a.warehouse ?? '—'}</TableCell>
                  <TableCell>{a.safe ? <>{a.safe} <span className="text-muted-foreground tabular-nums">· {formatMoney(a.cash ?? 0)}</span></> : <span className="text-amber-700 dark:text-amber-400">{t('None: cannot collect')}</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.customers}</TableCell>
                  <TableCell className="text-[13px]">
                    {[1, 2, 3, 4, 5, 6, 7].filter((d) => a.route.some((r) => r.weekday === d)).map((d) => `${t(SHORT[d - 1])} ${a.route.filter((r) => r.weekday === d).length}`).join(' · ') || <span className="text-muted-foreground">{t('No route')}</span>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setRoute(a)}><Route /> {t('Route|agent')}</Button>
                    <Button size="icon" variant="ghost" aria-label={t('Edit')} onClick={() => setEdit(a)}><Pencil /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {edit && <AgentDialog setup={s} agent={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {route && <RouteDialog agent={s.agents.find((a) => a.id === route.id) ?? route} onClose={() => setRoute(null)} />}
    </div>
  )
}

function AgentDialog({ setup, agent, onClose }: { setup: AgentsSetup; agent: ManagedAgent | null; onClose: () => void }) {
  const save = useSaveAgent()
  const [user, setUser] = React.useState(agent?.user_id ?? '')
  const [wh, setWh] = React.useState(agent?.warehouse_id ?? setup.warehouses[0]?.id ?? '')
  const [safe, setSafe] = React.useState(agent?.safe_id ?? (setup.can_make_safe ? 'new' : 'none'))
  const [active, setActive] = React.useState(agent?.is_active ?? true)
  const [error, setError] = React.useState<string | null>(null)
  const submit = () => save.mutate({ id: agent?.id, user_id: user, warehouse_id: wh, safe_id: safe === 'none' ? null : safe, is_active: active }, {
    onSuccess: () => { toast.success(agent ? t('Agent saved') : t('Agent set up. They open the agent app from the menu on their phone.')); onClose() },
    onError: (e) => setError(describeError(e)),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{agent ? agent.name : t('Set up an agent')}</DialogTitle>
          <DialogDescription>{t('Prices and the discount limit are the company’s; a bigger discount or a customer over the credit limit waits for a sales manager.')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {!agent && (
            <div className="grid gap-1.5"><Label>{t('Member')}</Label>
              <Select value={user} onValueChange={setUser}><SelectTrigger aria-label={t('Member')}><SelectValue placeholder={t('Choose a member')} /></SelectTrigger>
                <SelectContent>{setup.members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.name}</SelectItem>)}</SelectContent></Select></div>
          )}
          <div className="grid gap-1.5"><Label>{t('Sells from the warehouse')}</Label>
            <Select value={wh} onValueChange={setWh}><SelectTrigger aria-label={t('Sells from the warehouse')}><SelectValue /></SelectTrigger>
              <SelectContent>{setup.warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="grid gap-1.5"><Label>{t('Cash bag')}</Label>
            <Select value={safe} onValueChange={setSafe}><SelectTrigger aria-label={t('Cash bag')}><SelectValue /></SelectTrigger>
              <SelectContent>
                {setup.can_make_safe && !agent?.safe_id && <SelectItem value="new">{t('A new bag for this agent')}</SelectItem>}
                <SelectItem value="none">{t('None (the agent does not collect cash)')}</SelectItem>
                {setup.safes.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent></Select>
            {!setup.can_make_safe && <p className="text-[12px] text-muted-foreground">{t('A new bag is opened by someone with access to finance.')}</p>}
          </div>
          {agent && <label className="flex items-center justify-between gap-3 text-sm"><span>{t('Active')}</span><Switch checked={active} onCheckedChange={setActive} /></label>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!user || !wh} loading={save.isPending} onClick={submit}>{t('Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RouteDialog({ agent, onClose }: { agent: ManagedAgent; onClose: () => void }) {
  const today = ((new Date().getDay() + 6) % 7) + 1
  const [day, setDay] = React.useState(today)
  const [lists, setLists] = React.useState<Record<number, { id: string; name: string }[]>>(() => {
    const r: Record<number, { id: string; name: string }[]> = {}
    for (const s of [...agent.route].sort((a, b) => a.position - b.position)) (r[s.weekday] ??= []).push({ id: s.partner_id, name: s.name })
    return r
  })
  const [dirty, setDirty] = React.useState<Set<number>>(new Set())
  const customers = useCustomers()
  const all = React.useMemo(() => (customers.data ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.code ?? undefined, keywords: [c.code ?? '', c.tax_number ?? ''] })), [customers.data])
  const save = useSaveRoute()
  const list = lists[day] ?? []
  const change = (next: { id: string; name: string }[]) => { setLists((l) => ({ ...l, [day]: next })); setDirty((d) => new Set(d).add(day)) }
  const move = (i: number, by: number) => { const n = [...list]; const [x] = n.splice(i, 1); n.splice(i + by, 0, x); change(n) }
  const submit = async () => {
    for (const d of dirty) await save.mutateAsync({ agent: agent.id, weekday: d, partners: (lists[d] ?? []).map((x) => x.id) })
    toast.success(t('Route saved'))
    onClose()
  }
  const options = all.filter((p) => !list.some((x) => x.id === p.value))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Route of {name}', { name: agent.name })}</DialogTitle>
          <DialogDescription>{t('The customers to visit each day, in order. Customers without a salesperson become this agent’s.')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1">
          {WEEKDAYS.map((w, i) => (
            <Button key={w} size="sm" variant={day === i + 1 ? 'default' : 'outline'} onClick={() => setDay(i + 1)}>
              {t(SHORT[i])}{(lists[i + 1]?.length ?? 0) > 0 && <span className="ml-1 tabular-nums opacity-70">{lists[i + 1].length}</span>}
            </Button>
          ))}
        </div>
        <SearchSelect options={options} value={null} placeholder={t('Add a customer to {day}', { day: t(WEEKDAYS[day - 1]) })}
          onChange={(v) => { const p = all.find((x) => x.value === v); if (p) change([...list, { id: p.value, name: p.label }]) }} />
        {list.length === 0 ? <p className="py-6 text-center text-[13px] text-muted-foreground">{t('No visits on {day}', { day: t(WEEKDAYS[day - 1]) })}</p> : (
          <ol className="max-h-[45vh] divide-y overflow-y-auto rounded-lg border">
            {list.map((x, i) => (
              <li key={x.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="w-6 text-right tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="flex-1 truncate">{x.name}</span>
                <Button size="icon" variant="ghost" className="size-8" aria-label={t('Up')} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                <Button size="icon" variant="ghost" className="size-8" aria-label={t('Down')} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                <Button size="icon" variant="ghost" className="size-8" aria-label={t('Remove')} onClick={() => change(list.filter((y) => y.id !== x.id))}><Trash2 /></Button>
              </li>
            ))}
          </ol>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button disabled={!dirty.size} loading={save.isPending} onClick={() => void submit()}>{t('Save the route')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

