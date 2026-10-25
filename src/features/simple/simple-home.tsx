import { ClipboardCheck, FileText, PackagePlus, Search, ShoppingCart, Sparkles, Truck, UserRound, Users, Wallet, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { msg, t } from '@/i18n'
import { cn } from '@/lib/utils'

type Tile = { key: string; icon: LucideIcon; label: string; hint: string; to?: string; action?: () => void; tone: string }

/** opens the assistant panel from anywhere (the panel listens for it) */
export const openAssistant = () => window.dispatchEvent(new Event('drispro:assistant'))

const L = {
  sell: msg('Sell'), sellHint: msg('Open the till and sell'),
  invoice: msg('New invoice'), invoiceHint: msg('An invoice for a customer'),
  order: msg('New order'), orderHint: msg('What a customer orders'),
  receive: msg('Receive goods'), receiveHint: msg('Goods that came from a supplier'),
  receivePhoto: msg('Take a photo of the supplier’s invoice'),
  count: msg('Count the stock'), countHint: msg('Count what is on the shelf'),
  find: msg('Find an item'), findHint: msg('Price and how many are left'),
  debts: msg('Who owes us'), debtsHint: msg('Unpaid invoices of customers'),
  customers: msg('Customers'), customersHint: msg('Phone, address and what they bought'),
  ask: msg('Ask'), askHint: msg('Write a question, the assistant answers'),
  me: msg('My work'), meHint: msg('Pay slips, leave and my hours'),
}

/** The start of the simple view: the few things this person does, as large buttons. */
export function SimpleHome() {
  const { can, hasFeature, company } = useCompany()
  const { user } = useAuth()
  const name = ((user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? '').split(/[ @]/)[0]
  const tiles: Tile[] = []
  const add = (ok: boolean, tile: Tile) => { if (ok && tiles.length < 6) tiles.push(tile) }
  add(can('pos.write'), { key: 'sell', icon: ShoppingCart, label: L.sell, hint: L.sellHint, to: '/pos', tone: 'bg-primary text-primary-foreground' })
  add(can('invoicing.write'), { key: 'invoice', icon: FileText, label: L.invoice, hint: L.invoiceHint, to: '/sales/invoices/new', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' })
  add(can('sales.write') && !can('invoicing.write'), { key: 'order', icon: Truck, label: L.order, hint: L.orderHint, to: '/sales/orders/new', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' })
  add(can('inventory.write'), { key: 'receive', icon: PackagePlus, label: L.receive, hint: hasFeature('ai_reads') ? L.receivePhoto : L.receiveHint,
    to: hasFeature('ai_reads') ? '/inventory/read-invoice' : '/inventory/receipts/new', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' })
  add(can('wms.write'), { key: 'count', icon: ClipboardCheck, label: L.count, hint: L.countHint, to: '/wms/counts', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' })
  add(can('inventory.read'), { key: 'find', icon: Search, label: L.find, hint: L.findHint, to: '/inventory/products', tone: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' })
  add(can('invoicing.read'), { key: 'debts', icon: Wallet, label: L.debts, hint: L.debtsHint, to: '/finance/receivables', tone: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' })
  add(can('partners.read'), { key: 'customers', icon: Users, label: L.customers, hint: L.customersHint, to: '/partners', tone: 'bg-teal-500/15 text-teal-700 dark:text-teal-300' })
  add(hasFeature('ai_assistant'), { key: 'ask', icon: Sparkles, label: L.ask, hint: L.askHint, action: openAssistant, tone: 'bg-primary/15 text-primary' })
  add(true, { key: 'me', icon: UserRound, label: L.me, hint: L.meHint, to: '/hr/me', tone: 'bg-secondary text-foreground' })

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{t('Hello, {name}', { name })}</h1>
        <p className="mt-1 text-base text-muted-foreground">{t('What are you doing now? Tap one.')} <span className="max-sm:hidden">· {company?.name}</span></p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {tiles.map((x) => {
          const body = (
            <>
              <span className={cn('grid size-14 place-items-center rounded-2xl sm:size-16', x.tone)}><x.icon className="size-7 sm:size-8" strokeWidth={1.8} /></span>
              <span className="mt-4 block text-lg font-semibold leading-tight sm:text-xl">{t(x.label)}</span>
              <span className="mt-1 block text-sm leading-snug text-muted-foreground">{t(x.hint)}</span>
            </>
          )
          const cls = 'group flex min-h-40 flex-col items-start rounded-2xl border bg-card p-4 text-left shadow-sm transition-[transform,box-shadow,border-color] active:scale-[0.98] hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-48 sm:p-6'
          return x.to
            ? <Link key={x.key} to={x.to} className={cls}>{body}</Link>
            : <button key={x.key} type="button" onClick={x.action} className={cls}>{body}</button>
        })}
      </div>
    </div>
  )
}
