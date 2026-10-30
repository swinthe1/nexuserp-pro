import { Building2, Cable, CircleDollarSign, KeyRound, LifeBuoy, ScrollText, Settings2, Shapes, ShieldCheck, Sparkles, Trash2, UserPlus, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { msg, t } from '@/i18n'
import { formatDate } from '@/lib/utils'
import type { PlatformEvent } from '../api'
import { planLabel } from '../dialogs'
import { businessTypeLabel } from '../business-types'

/** what each line of the platform's diary says */
export const EVENT: Record<string, { label: string; icon: LucideIcon; tone?: 'danger' | 'good' }> = {
  client_created: { label: msg('Client created'), icon: Building2, tone: 'good' },
  client_deleted: { label: msg('Client deleted'), icon: Trash2, tone: 'danger' },
  licence_created: { label: msg('Licence given'), icon: ShieldCheck, tone: 'good' },
  licence_changed: { label: msg('Licence changed'), icon: ShieldCheck },
  password_set: { label: msg('New password set'), icon: KeyRound },
  account_created: { label: msg('Account made for an invited person'), icon: UserPlus },
  business_type_set: { label: msg('Type of business changed'), icon: Shapes },
  self_service_set: { label: msg('Open sign-up changed'), icon: Settings2 },
  prices_saved: { label: msg('Prices saved'), icon: CircleDollarSign },
  ai_limit_set: { label: msg('Photo reading limit changed'), icon: Sparkles },
  link_created: { label: msg('Live link made'), icon: Cable },
  link_on: { label: msg('Live link switched on'), icon: Cable, tone: 'good' },
  link_off: { label: msg('Live link switched off'), icon: Cable, tone: 'danger' },
  support_visit: { label: msg('Opened the company to help'), icon: LifeBuoy },
  member_added: { label: msg('Member added'), icon: UserPlus, tone: 'good' },
  client_details_set: { label: msg('Company details changed'), icon: Building2 },
  member_roles_set: { label: msg('Roles changed'), icon: ShieldCheck },
  member_suspended: { label: msg('Access suspended'), icon: UserPlus, tone: 'danger' },
  member_active: { label: msg('Access restored'), icon: UserPlus, tone: 'good' },
  member_removed: { label: msg('Removed from the company'), icon: Trash2, tone: 'danger' },
  member_details_set: { label: msg('Details changed'), icon: KeyRound },
}
export const eventLook = (kind: string) => EVENT[kind] ?? { label: kind, icon: ScrollText }

const FIELD: Record<string, string> = {
  plan: msg('Plan'), max_users: msg('Users'), valid_from: msg('Valid from'), valid_until: msg('Valid until'), status: msg('Status'),
  extra_features: msg('Added modules'), max_warehouses: msg('Units|places'), deployment: msg('Where it runs'), ai_reads_limit: msg('Photo reads a month'),
  ai_chat_limit: msg('Assistant questions a month'), notes: msg('Notes'),
  name: msg('Name'), legal_name: msg('Legal name'), tax_number: msg('NUI'), vat_number: msg('VAT number'), business_number: msg('Business number'),
  address_line1: msg('Address'), city: msg('City'), phone: msg('Phone'), email: msg('Email'), website: msg('Website'),
}

function value(k: string, v: unknown): string {
  if (v == null || (Array.isArray(v) && !v.length)) return '—'
  if (k === 'plan') return planLabel(String(v))
  if (k === 'valid_from' || k === 'valid_until') return formatDate(String(v))
  if (k === 'status') return v === 'active' ? t('Active') : v === 'suspended' ? t('Paused') : String(v)
  if (k === 'deployment') return v === 'local' ? t('Local server only') : v === 'cloud' ? t('Cloud only') : t('Cloud or local')
  if (Array.isArray(v)) return v.map(String).join(', ')
  return String(v)
}

/** the details of a line, in words: "Users: 10 → 11 · Valid until: 25.11.2026 → 25.11.2027" */
export function eventDetails(e: PlatformEvent): string {
  const d = e.details ?? {}
  if (e.kind === 'licence_changed' || e.kind === 'client_details_set') {
    return Object.entries(d).filter(([k]) => FIELD[k]).map(([k, x]) => {
      const c = x as { from: unknown; to: unknown }
      return k === 'notes' ? t(FIELD[k]!) : `${t(FIELD[k]!)}: ${value(k, c.from)} → ${value(k, c.to)}`
    }).join(' · ')
  }
  if (e.kind === 'licence_created') return [planLabel(String(d.plan ?? '')), d.max_users != null ? t('{n} users', { n: Number(d.max_users) }) : '', d.valid_until ? t('until {date}', { date: formatDate(String(d.valid_until)) }) : ''].filter(Boolean).join(' · ')
  if (e.kind === 'password_set' || e.kind === 'account_created' || e.kind === 'member_suspended' || e.kind === 'member_active' || e.kind === 'member_removed') return String(d.email ?? '')
  if (e.kind === 'member_added' || e.kind === 'member_roles_set') return [d.email, Array.isArray(d.roles) ? (d.roles as string[]).join(', ') : ''].filter(Boolean).join(' · ')
  if (e.kind === 'member_details_set') return [d.email, d.name].filter(Boolean).join(' → ')
  if (e.kind === 'business_type_set') return t(businessTypeLabel(String(d.type ?? '')))
  if (e.kind === 'self_service_set') return d.on ? t('Anyone can sign up') : t('By invitation only')
  if (e.kind === 'client_deleted') return t('{n} records deleted', { n: Number(d.rows ?? 0) })
  if (e.kind === 'ai_limit_set') return d.reads !== undefined ? t('Photo reads: {n}', { n: d.reads == null ? t('plan') : String(d.reads) }) : t('Assistant: {n}', { n: d.chat == null ? t('plan') : String(d.chat) })
  if (e.kind.startsWith('link_')) return String(d.name ?? '')
  return ''
}

/** one line of the diary */
export function EventRow({ e, showClient = true }: { e: PlatformEvent; showClient?: boolean }) {
  const look = eventLook(e.kind)
  const Icon = look.icon
  const details = eventDetails(e)
  return (
    <li className="flex gap-3 py-2.5">
      <span className={look.tone === 'danger' ? 'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive'
        : look.tone === 'good' ? 'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-success/10 text-success'
          : 'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground'}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">
          <span className="font-medium">{t(look.label)}</span>
          {showClient && e.company_name && <> · {e.company_id && e.company_exists !== false
            ? <Link to={`/platform/clients/${e.company_id}`} className="text-primary hover:underline">{e.company_name}</Link>
            : <span className="text-muted-foreground">{e.company_name}</span>}</>}
        </div>
        {details && <div className="truncate text-xs text-muted-foreground" title={details}>{details}</div>}
      </div>
      <div className="shrink-0 text-right text-2xs text-muted-foreground">
        <div className="tabular">{formatDate(e.at, true)}</div>
        {e.actor_email && <div className="max-w-[160px] truncate" title={e.actor_email}>{e.actor_email}</div>}
      </div>
    </li>
  )
}
