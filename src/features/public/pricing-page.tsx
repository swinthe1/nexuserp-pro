import { useQuery } from '@tanstack/react-query'
import { Check, Mail, MessageCircle, Phone, Sparkles } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { msg, t, tn } from '@/i18n'
import { unwrap } from '@/lib/errors'
import { FEATURES, PAID_MODULES } from '@/lib/plans'
import { supabase } from '@/lib/supabase'
import { cn, formatMoney, num } from '@/lib/utils'
import { PublicFooter, PublicHeader } from './public-shell'

type PlanRow = { plan: 'basic' | 'standard' | 'pro'; price_month: number | null; price_year: number | null; per_user: number | null; users: number; highlight: boolean
  note: string | null; features: string[]; stores: number | null }
type Pricing = { plans: PlanRow[]; contact: { email: string | null; phone: string | null; whatsapp: string | null; currency: string; vat_note: string | null } }

const NAMES: Record<string, { name: string; who: string }> = {
  basic: { name: msg('Basic'), who: msg('One shop or a small business that sells and buys.') },
  standard: { name: msg('Standard'), who: msg('A business with several stores, the full books and staff.') },
  pro: { name: msg('Pro'), who: msg('Warehouses, production, deliveries and the web shop.') },
}

/** What every plan has: the things a business uses every day. */
const EVERY_PLAN = [
  msg('The till, also without internet'),
  msg('Stock with the average cost or FIFO, counts and labels'),
  msg('Purchases, suppliers and supplier invoices'),
  msg('Sales invoices, quotes, VAT books'),
  msg('The app on the phone, and the program for Windows and Mac'),
  msg('Notifications on the phone and the morning summary'),
  msg('DrisPRO inside ChatGPT and Claude'),
  msg('Your accountant free, with all their clients on one page'),
  msg('Help in Albanian'),
]

/** The public page with the plans and their prices (set by the platform owner). */
export function PricingPage() {
  const [yearly, setYearly] = React.useState(false)
  const q = useQuery({ queryKey: ['public-pricing'], queryFn: async () => unwrap(await supabase.rpc('public_pricing')) as unknown as Pricing })
  const cur = q.data?.contact.currency === 'ALL' ? 'L' : '€'
  const c = q.data?.contact
  const anyYear = q.data?.plans.some((p) => p.price_year != null)
  return (
    <div className="min-h-dvh bg-background">
      <PublicHeader>
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">{t('One program for the whole business. A clear price.')}</h1>
        <p className="mt-4 max-w-xl text-lg text-white/75">{t('The till, stock, purchases, invoices, VAT, the books and payroll, made for Kosovo and Albania. Choose the plan that fits; change it whenever you grow.')}</p>
        {anyYear && (
          <div className="mt-8 inline-flex rounded-full bg-white/10 p-1 text-sm" role="radiogroup" aria-label={t('Billing')}>
            <button type="button" role="radio" aria-checked={!yearly} onClick={() => setYearly(false)} className={cn('rounded-full px-4 py-1.5', !yearly && 'bg-white font-semibold text-[hsl(196_48%_11%)]')}>{t('Monthly')}</button>
            <button type="button" role="radio" aria-checked={yearly} onClick={() => setYearly(true)} className={cn('rounded-full px-4 py-1.5', yearly && 'bg-white font-semibold text-[hsl(196_48%_11%)]')}>{t('Yearly')}</button>
          </div>
        )}
      </PublicHeader>

      <main className="mx-auto -mt-8 max-w-6xl px-4 pb-16 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          {(q.data?.plans ?? []).map((p) => {
            const price = yearly && p.price_year != null ? p.price_year / 12 : p.price_month
            const prev = p.plan === 'standard' ? 'basic' : p.plan === 'pro' ? 'standard' : null
            const prevFeatures = prev ? q.data!.plans.find((x) => x.plan === prev)?.features ?? [] : []
            const added = FEATURES.filter((f) => f.plan !== 'paid' && p.features.includes(f.key) && !prevFeatures.includes(f.key))
            return (
              <section key={p.plan} className={cn('relative flex flex-col rounded-2xl border bg-card p-6 shadow-card', p.highlight && 'border-primary ring-2 ring-primary/30')}>
                {p.highlight && <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">{t('Most chosen')}</span>}
                <h2 className="text-xl font-bold">{t(NAMES[p.plan]!.name)}</h2>
                <p className="mt-1 min-h-10 text-[13px] text-muted-foreground">{t(NAMES[p.plan]!.who)}</p>
                <div className="mt-5 min-h-16">
                  {price != null ? <>
                    <span className="text-4xl font-bold tabular tracking-tight">{formatMoney(price, null)}</span> <span className="text-muted-foreground">{cur} / {t('month')}</span>
                    <div className="text-xs text-muted-foreground">{yearly && p.price_year != null ? t('{amount} {cur} a year', { amount: formatMoney(p.price_year, null), cur }) : t('without VAT')}</div>
                  </> : <span className="text-2xl font-semibold">{t('On offer')}</span>}
                </div>
                <ul className="mt-4 grid gap-2 text-sm">
                  <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{tn(p.users, '{n} user included', '{n} users included')}{p.per_user != null ? ` · ${t('+{amount} {cur} each one more', { amount: formatMoney(num(p.per_user), null), cur })}` : ''}</li>
                  <li className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{p.stores == null ? t('Stores and warehouses without limit') : tn(p.stores, '{n} store or warehouse', 'Up to {n} stores or warehouses')}</li>
                  {prev && <li className="pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('Everything in {plan}, and', { plan: t(NAMES[prev]!.name) })}</li>}
                  {added.map((f) => <li key={f.key} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{t(f.label)}</li>)}
                  {p.plan === 'basic' && EVERY_PLAN.slice(0, 4).map((x) => <li key={x} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{t(x)}</li>)}
                </ul>
                {p.note && <p className="mt-4 text-[13px] text-muted-foreground">{p.note}</p>}
                <div className="mt-auto pt-6">
                  <a href={c?.whatsapp ? `https://wa.me/${c.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(t('Hello, I would like DrisPRO {plan}', { plan: t(NAMES[p.plan]!.name) }))}` : c?.email ? `mailto:${c.email}?subject=${encodeURIComponent(`DrisPRO ${t(NAMES[p.plan]!.name)}`)}` : '#kontakt'}
                    className={cn('block rounded-lg px-4 py-2.5 text-center text-sm font-semibold', p.highlight ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border hover:bg-muted')}>{t('Ask for {plan}', { plan: t(NAMES[p.plan]!.name) })}</a>
                </div>
              </section>
            )
          })}
        </div>
        {c?.vat_note && <p className="mt-4 text-center text-[13px] text-muted-foreground">{c.vat_note}</p>}

        <section className="mt-16 grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold">{t('In every plan')}</h2>
            <ul className="mt-4 grid gap-2.5">
              {EVERY_PLAN.map((x) => <li key={x} className="flex gap-2.5"><Check className="mt-0.5 size-5 shrink-0 text-primary" />{t(x)}</li>)}
            </ul>
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold"><Sparkles className="size-5 text-primary" /> {t('Paid by use')}</h2>
            <p className="mt-2 text-muted-foreground">{t('These cost money every time they are used, so you choose them and pay only what you use.')}</p>
            <ul className="mt-4 grid gap-3">
              {PAID_MODULES.map((m) => <li key={m.key} className="flex items-center gap-2 rounded-lg border bg-card p-3 font-medium"><Check className="size-4 text-primary" />{t(m.label)}</li>)}
            </ul>
          </div>
        </section>

        <section id="kontakt" className="mt-16 rounded-2xl bg-[hsl(196_48%_11%)] p-8 text-white sm:p-10">
          <h2 className="text-2xl font-bold">{t('See it with your own data')}</h2>
          <p className="mt-2 max-w-xl text-white/75">{t('We show you DrisPRO with a demo of a business like yours, and bring over what you have in your old program.')}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {c?.whatsapp && <a className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 font-semibold text-[#06301a]" href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`}><MessageCircle className="size-4" /> WhatsApp{/* i18n-ignore */}</a>}
            {c?.phone && <a className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 font-semibold hover:bg-white/15" href={`tel:${c.phone.replace(/\s/g, '')}`}><Phone className="size-4" /> {c.phone}</a>}
            {c?.email && <a className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 font-semibold hover:bg-white/15" href={`mailto:${c.email}`}><Mail className="size-4" /> {c.email}</a>}
            <Link className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 font-semibold text-[hsl(196_48%_11%)]" to="/login">{t('I already have DrisPRO: sign in')}</Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
