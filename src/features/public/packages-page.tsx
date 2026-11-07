/**
 * The public page of the packages: not "Basic" or "Plus", but the kind of business. For each family of
 * businesses, the packages side by side: their size and what each has from the start, what is added on
 * request, and what is not part of it. No prices: the offer comes from DrisPRO, by the units and tills.
 */
import { useQuery } from '@tanstack/react-query'
import { Check, Mail, MessageCircle, Phone, Plus, Sparkles } from 'lucide-react'
import * as React from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { msg, t, tn } from '@/i18n'
import { FEATURES, MODULE_GROUPS, PACKAGES, PAID_MODULES, type Feature, type Package, type PackageKey } from '@/lib/plans'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { PublicFooter, PublicHeader } from './public-shell'

/** the families a visitor recognises himself in, each with the packages that compare with each other */
const FAMILIES: { key: string; label: string; packages: PackageKey[] }[] = [
  { key: 'dyqane', label: msg('Shops and markets'), packages: ['retail_mini', 'retail_market', 'retail_chain'] },
  { key: 'lokale', label: msg('Cafés, restaurants and hotels'), packages: ['cafe', 'restaurant', 'hotel'] },
  { key: 'shumice', label: msg('Wholesale and production'), packages: ['wholesale', 'manufacturing', 'general'] },
  { key: 'sherbime', label: msg('Services and appointments'), packages: ['services', 'beauty', 'clinic', 'auto_service', 'fitness'] },
]

/** what every package has, whatever the business: none of it is a module that can be left out */
const EVERY_PACKAGE = [
  msg('Stock with the average cost or FIFO, counts and labels'),
  msg('Purchases, suppliers and supplier invoices'),
  msg('Sales invoices and customers with their balances'),
  msg('Payments, the bank and expenses'),
  msg('VAT books and declarations'),
  msg('Reports, exported to Excel and PDF'),
  msg('The app on the phone, and the program for Windows and Mac'),
  msg('Help in Albanian'),
]

type Has = 'in' | 'ask' | 'no'
const has = (p: Package, f: Feature): Has => p.modules.includes(f) ? 'in' : p.optional.includes(f) ? 'ask' : 'no'
const limit = (n: number | null) => n == null ? t('No limit') : String(n)

function Cell({ v }: { v: Has }) {
  if (v === 'in') return <Check className="mx-auto size-[18px] text-primary" strokeWidth={2.6} aria-label={t('Included')} />
  if (v === 'ask') return <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11.5px] font-medium text-amber-800 dark:text-amber-300"><Plus className="size-3" />{t('On request')}</span>
  return <span className="text-muted-foreground/50" aria-label={t('Not part of it')}>—</span>
}

export function PackagesPage() {
  const [params, setParams] = useSearchParams()
  const family = FAMILIES.find((f) => f.key === params.get('lloji')) ?? FAMILIES[0]!
  const packs = family.packages.map((k) => PACKAGES.find((p) => p.key === k)!).filter(Boolean)
  const contact = useQuery({ queryKey: ['public-contact'], staleTime: 600_000,
    queryFn: async () => ((await supabase.rpc('public_contact')).data ?? {}) as { email?: string | null; phone?: string | null; whatsapp?: string | null } })
  const c = contact.data
  // the rows: every module that one of these packages has or offers, in its group
  const rows = MODULE_GROUPS.filter((g) => g.key !== 'paid').map((g) => ({
    group: g, features: FEATURES.filter((f) => f.group === g.key && packs.some((p) => has(p, f.key) !== 'no')),
  })).filter((r) => r.features.length)
  const cols = `minmax(200px,1.35fr) repeat(${packs.length}, minmax(0,1fr))`

  return (
    <div className="min-h-dvh bg-background">
      <PublicHeader>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">{t('A package for your kind of business')}</h1>
        <p className="mt-4 max-w-2xl text-lg text-white/75">{t('Not "basic" or "plus": a market gets what a market uses, a café what a café uses. Whatever else you need is added when you ask.')}</p>
        <div role="tablist" aria-label={t('Kind of business')} className="mt-8 flex flex-wrap gap-2">
          {FAMILIES.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={f.key === family.key} onClick={() => setParams({ lloji: f.key }, { replace: true })}
              className={cn('rounded-full px-4 py-2 text-sm font-medium transition-colors',
                f.key === family.key ? 'bg-white text-[#0B0B0C]' : 'bg-white/10 text-white/80 hover:bg-white/15 hover:text-white')}>{t(f.label)}</button>
          ))}
        </div>
      </PublicHeader>

      <main className="relative mx-auto -mt-8 max-w-6xl px-4 pb-16 sm:px-6">
        {/* ---------------- the comparison, on a wide screen ---------------- */}
        <section role="tabpanel" aria-label={t(family.label)} className="hidden overflow-hidden rounded-2xl border bg-card shadow-card md:block">
          <div className="grid border-b" style={{ gridTemplateColumns: cols }}>
            <div className="p-5 text-sm text-muted-foreground">{t('What it has')}</div>
            {packs.map((p) => (
              <div key={p.key} className="border-l p-5 text-center">
                <h2 className="text-[15px] font-semibold">{t(p.label)}</h2>
                <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{t(p.hint)}</p>
              </div>
            ))}
          </div>
          {/* every package: one row, set apart */}
          <div className="grid border-b bg-primary/[0.06]" style={{ gridTemplateColumns: cols }}>
            <div className="p-5">
              <p className="text-sm font-semibold text-primary">{t('In every package')}</p>
              <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">{EVERY_PACKAGE.slice(0, 5).map((x) => t(x)).join(' · ')}</p>
            </div>
            {packs.map((p) => <div key={p.key} className="grid place-items-center border-l"><Check className="size-[18px] text-primary" strokeWidth={2.6} /></div>)}
          </div>
          {/* the size */}
          {[
            { label: msg('Units (shops, warehouses)'), v: (p: Package) => limit(p.stores) },
            { label: msg('Tills'), v: (p: Package) => limit(p.tills) },
            { label: msg('Users included'), v: (p: Package) => String(p.users) },
          ].map((r) => (
            <div key={r.label} className="grid border-b text-sm" style={{ gridTemplateColumns: cols }}>
              <div className="px-5 py-3 font-medium">{t(r.label)}</div>
              {packs.map((p) => <div key={p.key} className="border-l px-5 py-3 text-center font-semibold tabular">{r.v(p)}</div>)}
            </div>
          ))}
          {rows.map((r) => (
            <React.Fragment key={r.group.key}>
              <div className="border-b bg-muted/40 px-5 py-2 text-[12.5px] font-semibold text-muted-foreground">{t(r.group.label)}</div>
              {r.features.map((f) => (
                <div key={f.key} className="grid border-b text-sm last:border-b-0" style={{ gridTemplateColumns: cols }}>
                  <div className="px-5 py-3">
                    <p className="font-medium">{t(f.label)}</p>
                    {f.hint && <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{t(f.hint)}</p>}
                  </div>
                  {packs.map((p) => <div key={p.key} className="grid place-items-center border-l px-3 py-3"><Cell v={has(p, f.key)} /></div>)}
                </div>
              ))}
            </React.Fragment>
          ))}
        </section>

        {/* ---------------- on the phone: one card per package ---------------- */}
        <div className="grid gap-4 md:hidden">
          {packs.map((p) => (
            <section key={p.key} className="rounded-2xl border bg-card p-5 shadow-card">
              <h2 className="text-lg font-semibold">{t(p.label)}</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">{t(p.hint)}</p>
              <p className="mt-3 text-[13px] font-medium">
                {p.stores == null ? t('Units without limit') : tn(p.stores, '{n} unit', '{n} units')} · {p.tills == null ? t('Tills without limit') : tn(p.tills, '{n} till', '{n} tills')} · {tn(p.users, '{n} user included', '{n} users included')}
              </p>
              <ul className="mt-3 grid gap-1.5 text-sm">
                {FEATURES.filter((f) => f.group !== 'paid' && has(p, f.key) === 'in').map((f) => <li key={f.key} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />{t(f.label)}</li>)}
              </ul>
              {p.optional.some((f) => !PAID_MODULES.some((m) => m.key === f)) && (
                <p className="mt-3 text-[13px] text-muted-foreground"><span className="font-medium text-foreground">{t('On request')}:</span>{' '}
                  {p.optional.filter((f) => !PAID_MODULES.some((m) => m.key === f)).map((f) => t(FEATURES.find((x) => x.key === f)!.label)).join(', ')}</p>
              )}
            </section>
          ))}
        </div>

        <p className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Check className="size-4 text-primary" strokeWidth={2.6} /> {t('Included from the start')}</span>
          <span className="inline-flex items-center gap-1.5"><Cell v="ask" /> {t('Added when you ask, at any time')}</span>
          <span className="inline-flex items-center gap-1.5"><span className="text-muted-foreground/60">—</span> {t('Not part of this package')}</span>
        </p>

        <section className="mt-14 grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold">{t('In every package')}</h2>
            <ul className="mt-4 grid gap-2.5">
              {EVERY_PACKAGE.map((x) => <li key={x} className="flex gap-2.5"><Check className="mt-0.5 size-5 shrink-0 text-primary" />{t(x)}</li>)}
            </ul>
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold"><Sparkles className="size-5 text-primary" /> {t('Paid by use')}</h2>
            <p className="mt-2 text-muted-foreground">{t('Any package can have these. Each use has a cost, so you choose them and pay only for what you use.')}</p>
            <ul className="mt-4 grid gap-3">
              {PAID_MODULES.map((m) => <li key={m.key} className="flex items-center gap-2 rounded-lg border bg-card p-3 font-medium"><Plus className="size-4 text-primary" />{t(m.label)}</li>)}
            </ul>
          </div>
        </section>

        <section id="kontakt" className="mt-16 rounded-2xl bg-[#0B0B0C] p-8 text-white sm:p-10">
          <h2 className="text-2xl font-bold">{t('Ask for an offer')}</h2>
          <p className="mt-2 max-w-xl text-white/75">{t('Tell us your kind of business, how many units and tills you have. We send you the offer and show you DrisPRO with a demo like your business.')}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            {c?.whatsapp && <a className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 font-semibold text-[#06301a]" href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(t('Hello, I would like an offer for DrisPRO ({kind})', { kind: t(family.label) }))}`}><MessageCircle className="size-4" /> WhatsApp{/* i18n-ignore */}</a>}
            {c?.phone && <a className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 font-semibold hover:bg-white/15" href={`tel:${c.phone.replace(/\s/g, '')}`}><Phone className="size-4" /> {c.phone}</a>}
            {c?.email && <a className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 font-semibold hover:bg-white/15" href={`mailto:${c.email}?subject=${encodeURIComponent(`DrisPRO · ${t(family.label)}`)}`}><Mail className="size-4" /> {c.email}</a>}
            <Link className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 font-semibold text-[#0B0B0C]" to="/login">{t('I already have DrisPRO: sign in')}</Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
