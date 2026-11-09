import { CalendarClock, Flag, Repeat, Sparkles } from 'lucide-react'
import { msg, t } from '@/i18n'
import { cn, formatDate } from '@/lib/utils'
import type { Person, Task } from '../api'

export const STATUS_LABEL: Record<string, string> = {
  todo: msg('To do|task'), doing: msg('In progress|task'), waiting: msg('Waiting|task'), done: msg('Done|task'), cancelled: msg('Cancelled|task'),
}
export const STATUS_DOT: Record<string, string> = { todo: 'bg-muted-foreground/50', doing: 'bg-info', waiting: 'bg-warning', done: 'bg-success', cancelled: 'bg-muted-foreground/30' }
export const PRIORITY_LABEL: Record<number, string> = { 0: msg('Low|priority'), 1: msg('Normal|priority'), 2: msg('High|priority'), 3: msg('Urgent|priority') }
const PRIORITY_TONE: Record<number, string> = { 0: 'text-muted-foreground/60', 1: 'text-muted-foreground/40', 2: 'text-warning', 3: 'text-destructive' }

export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const addDaysISO = (iso: string, n: number) => { const [y, m, d] = iso.split('-').map(Number); const x = new Date(y!, m! - 1, d! + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
export const isOpen = (t: Pick<Task, 'status'>) => t.status !== 'done' && t.status !== 'cancelled'
export const isLate = (t: Pick<Task, 'status' | 'due_date'>) => isOpen(t) && !!t.due_date && t.due_date < todayISO()

export function PriorityFlag({ p, className }: { p: number; className?: string }) {
  if (p < 2 && p !== 0) return null
  return <Flag className={cn('size-3.5 shrink-0', PRIORITY_TONE[p], p >= 2 && 'fill-current', className)} aria-label={t(PRIORITY_LABEL[p]!)} />
}

export function DueChip({ task, className }: { task: Pick<Task, 'status' | 'due_date' | 'due_time'>; className?: string }) {
  if (!task.due_date) return null
  const today = todayISO()
  const late = isLate(task), now = task.due_date === today && isOpen(task), tomorrow = task.due_date === addDaysISO(today, 1)
  const words = task.due_date === today ? t('Today') : tomorrow ? t('Tomorrow') : formatDate(task.due_date)
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap text-xs tabular', late ? 'font-medium text-destructive' : now ? 'font-medium text-warning' : 'text-muted-foreground', className)}>
      <CalendarClock className="size-3.5" />{words}{task.due_time ? ` ${task.due_time.slice(0, 5)}` : ''}
    </span>
  )
}

export function Avatar({ person, size = 22 }: { person: Person | undefined | null; size?: number }) {
  if (!person) return <span className="inline-block rounded-full border border-dashed border-muted-foreground/40" style={{ width: size, height: size }} aria-label={t('Nobody yet')} />
  const ini = person.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  let h = 0; for (const c of person.name) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <span title={person.name} aria-label={person.name} className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${h} 45% 45%)` }}>{ini}</span>
  )
}

export function SourceMark({ task }: { task: Pick<Task, 'source'> }) {
  if (task.source === 'auto') return <Sparkles className="size-3.5 shrink-0 text-primary" aria-label={t('Made by the program')} />
  if (task.source === 'recurring') return <Repeat className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('Repeats')} />
  return null
}

/** where a linked document opens */
export function entityHref(type: string | null, id: string | null, label: string | null): string | null {
  if (!type) return null
  switch (type) {
    case 'sales_invoices': return id ? `/sales/invoices/${id}` : null
    case 'business_partners': return id ? `/partners/${id}` : null
    case 'pos_sessions': return id ? `/pos/sessions/${id}` : null
    case 'employment_contracts': return id ? `/hr/contracts/${id}` : null
    case 'employees': return id ? `/hr/employees/${id}` : null
    case 'lots': return id ? `/wms/lots/${id}` : null
    case 'leads': return '/crm/leads'
    case 'products': return id ? `/inventory/products/${id}` : null
    case 'product_variants': return label ? `/inventory/products?q=${encodeURIComponent(label)}` : '/inventory/products'
    case 'purchase_orders': return id ? `/procurement/orders/${id}` : null
    case 'vendor_bills': return id ? `/procurement/bills/${id}` : null
    case 'sales_orders': return id ? `/sales/orders/${id}` : null
    // the tasks the program makes by itself
    case 'sales_quotes': return id ? `/sales/quotes/${id}` : null
    case 'goods_receipts': return id ? `/inventory/receipts/${id}` : null
    case 'approval_requests': return '/approvals'
    case 'hotel_reservations': return '/hotel/reservations'
    case 'cycle_counts': return id ? `/wms/counts/${id}` : '/wms/counts'
    case 'loss_watch': return '/inventory/loss-watch'
    case 'count_sessions': return id ? `/wms/sessions/${id}` : '/wms/counts'
    default: return null
  }
}
export const ENTITY_LABEL: Record<string, string> = {
  sales_invoices: msg('Invoice'), business_partners: msg('Customer or vendor'), pos_sessions: msg('Till shift'), employment_contracts: msg('Contract'),
  employees: msg('Employee'), lots: msg('Lot'), leads: msg('Lead'), products: msg('Product'), product_variants: msg('Product'),
  purchase_orders: msg('Purchase order'), vendor_bills: msg('Vendor bill'), sales_orders: msg('Sales order'),
  sales_quotes: msg('Quote'), goods_receipts: msg('Goods receipt'), approval_requests: msg('Approval'), hotel_reservations: msg('Reservation'), cycle_counts: msg('Stock count'), loss_watch: msg('Loss watch'), count_sessions: msg('Counting together'),
}
