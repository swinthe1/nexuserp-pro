import { Check, Cloud, ShieldCheck, WifiOff } from 'lucide-react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { DesktopDownload } from '@/features/auth/desktop-download'
import { msg, t } from '@/i18n'
import { LanguageToggle } from '@/i18n/language'
import { getTill } from '@/lib/shared-till'
import { cn } from '@/lib/utils'

/** What the program does, printed as the lines of a till receipt: the thing every shop knows. */
const LINES = [
  msg('Sales at the till'),
  msg('Stock and average cost'),
  msg('Purchases and suppliers'),
  msg('VAT and the books'),
  msg('Payroll'),
  msg('Accounting'),
]

/** Three plain facts a business owner asks about first. */
const FACTS = [
  { icon: WifiOff, title: msg('The till works without internet'), text: msg('Sales go on; everything is sent when the line is back.') },
  { icon: ShieldCheck, title: msg('Each person sees their part'), text: msg('Roles for the cashier, the warehouse and the accountant, with every change on record.') },
  { icon: Cloud, title: msg('In the cloud or on your server'), text: msg('On the web, on the phone and as a program for Windows and Mac.') },
]

function Receipt({ className }: { className?: string }) {
  return (
    <div className={cn('auth-receipt relative w-[280px] rotate-[-2deg] text-[#1d232f] drop-shadow-[0_24px_40px_rgba(0,0,0,0.35)]', className)}>
      <div className="rounded-t-sm bg-[#fdfdfb] px-6 pb-6 pt-7">
        <div className="flex items-center justify-center gap-2 text-[15px] font-semibold">
          <img src="/favicon.svg" alt="" className="size-5" /> DrisPRO
        </div>
        <p className="mt-1 text-center text-xs text-[#5b6372]">{t('Your shop · today')}</p>
        <div className="my-4 border-t border-dashed border-[#c9ccd3]" />
        <ul className="grid gap-2.5 text-[13px]">
          {LINES.map((l) => (
            <li key={l} className="flex items-baseline gap-2">
              <span>{t(l)}</span>
              <span className="mb-[3px] flex-1 border-b border-dotted border-[#b7bbc4]" />
              <Check className="size-3.5 translate-y-[2px] text-[#0E8A5F]" strokeWidth={3} />
            </li>
          ))}
        </ul>
        <div className="my-4 border-t border-dashed border-[#c9ccd3]" />
        <div className="flex items-baseline justify-between text-sm font-semibold">
          <span>{t('Total')}</span><span>{t('one program')}</span>
        </div>
        <p className="mt-4 text-center text-[11px] text-[#5b6372]">{t('Thank you, and see you tomorrow')}</p>
      </div>
      {/* the torn edge */}
      <div className="h-3 bg-[#fdfdfb] [clip-path:polygon(0_0,100%_0,100%_30%,95%_100%,90%_30%,85%_100%,80%_30%,75%_100%,70%_30%,65%_100%,60%_30%,55%_100%,50%_30%,45%_100%,40%_30%,35%_100%,30%_30%,25%_100%,20%_30%,15%_100%,10%_30%,5%_100%,0_30%)]" />
    </div>
  )
}

/** The deep green of the brand with its two glows, shared by the desktop side and the phone header. */
function Backdrop() {
  return <>
    <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 size-[520px] rounded-full bg-[#11A06E]/25 blur-[120px]" />
    <div aria-hidden className="pointer-events-none absolute -bottom-48 right-0 size-[560px] rounded-full bg-[#1583C8]/25 blur-[130px]" />
    <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px]" />
  </>
}

function Brand({ className }: { className?: string }) {
  return <a href="/" className={cn('flex items-center gap-2 text-[15px] font-semibold', className)}><img src="/favicon.svg" alt="" className="size-7" /> DrisPRO</a>
}

function FooterLinks({ className }: { className?: string }) {
  return (
    <nav className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs', className)} aria-label="DrisPRO">
      <a href="/api" className="hover:underline">{t('For developers')}</a>
      <span>© {new Date().getFullYear()} DrisPRO</span>
    </nav>
  )
}

export function AuthLayout() {
  const { user, loading } = useAuth()
  if (!loading && user) return <Navigate to="/" replace />
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(440px,560px)]">
      <style>{`
        @keyframes auth-print { from { clip-path: inset(0 0 100% 0); transform: translateY(-24px) rotate(-2deg); } to { clip-path: inset(0 0 0 0); transform: translateY(0) rotate(-2deg); } }
        .auth-receipt { animation: auth-print 1.1s cubic-bezier(.2,.7,.2,1) both .15s; }
        @media (prefers-reduced-motion: reduce) { .auth-receipt { animation: none; } }
      `}</style>

      {/* ---------------- desktop: the story on the left ---------------- */}
      <aside className="relative hidden overflow-hidden bg-[hsl(196_48%_11%)] text-white lg:flex">
        <Backdrop />
        <div className="relative flex w-full flex-col p-12 xl:p-16">
          <div className="flex items-center gap-6">
            <Brand />
            <nav className="ml-auto flex items-center gap-6 text-sm text-white/70">
              <a href="/api" className="hover:text-white">{t('For developers')}</a>
            </nav>
          </div>

          <div className="my-auto grid items-center gap-12 py-12 min-[1360px]:grid-cols-[minmax(0,1fr)_auto]">
            <div className="max-w-xl">
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/75">
                <span className="size-1.5 rounded-full bg-[#2BD98F]" /> {t('Made for Kosovo and Albania')}
              </p>
              <h1 className="text-[2.75rem] font-bold leading-[1.05] tracking-[-0.03em] xl:text-[3.25rem]">
                {t('Stock, sales, purchasing and accounting — all in one place.')}
              </h1>
              <p className="mt-6 max-w-md text-base leading-relaxed text-white/65">
                {t('Every receipt updates your average cost, and every movement can be traced back to its document. Made for shops, wholesalers and producers in Albania and Kosovo.')}
              </p>
            </div>
            <div className="hidden justify-center min-[1360px]:flex"><Receipt /></div>
          </div>

          <ul className="grid gap-5 border-t border-white/10 pt-8 min-[1500px]:grid-cols-3 min-[1500px]:gap-6">
            {FACTS.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-[#2BD98F]"><f.icon className="size-[18px]" /></span>
                <div><p className="text-sm font-medium">{t(f.title)}</p><p className="mt-0.5 text-[13px] leading-snug text-white/55">{t(f.text)}</p></div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* ---------------- the form: a card on the phone, a calm column on the desktop ---------------- */}
      <main className="relative flex min-h-dvh flex-col">
        {/* phone and tablet: the brand on top, the form rises over it */}
        <header className="relative overflow-hidden bg-[hsl(196_48%_11%)] px-5 pb-24 pt-5 text-white sm:px-8 lg:hidden">
          <Backdrop />
          <div className="relative flex items-center justify-between">
            <Brand />
            <div className="rounded-lg bg-white/95 text-foreground"><LanguageToggle /></div>
          </div>
          <h1 className="relative mt-8 max-w-md text-[1.75rem] font-bold leading-[1.1] tracking-[-0.02em] sm:text-4xl">
            {t('Stock, sales, purchasing and accounting — all in one place.')}
          </h1>
          <p className="relative mt-3 max-w-md text-sm text-white/65">{t('Made for Kosovo and Albania')}</p>
        </header>

        <div className="hidden justify-end px-10 pt-6 lg:flex"><LanguageToggle /></div>

        <div className="relative -mt-16 flex flex-1 flex-col px-4 pb-6 sm:px-8 lg:mt-0 lg:px-10">
          <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col lg:justify-center">
            <div className="rounded-2xl bg-card p-6 shadow-[0_20px_50px_-20px_rgba(6,40,30,0.45)] ring-1 ring-black/5 sm:p-8 lg:rounded-none lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0">
              <Outlet />
            </div>
            {!getTill() && <DesktopDownload className="mt-8 hidden md:grid" />}
            {/* on the phone the three facts follow the form */}
            <ul className="mt-8 grid gap-4 px-1 lg:hidden">
              {FACTS.map((f) => (
                <li key={f.title} className="flex gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><f.icon className="size-[18px]" /></span>
                  <div><p className="text-sm font-medium">{t(f.title)}</p><p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{t(f.text)}</p></div>
                </li>
              ))}
            </ul>
          </div>
          <FooterLinks className="mx-auto mt-8 w-full max-w-[400px] justify-center text-muted-foreground lg:justify-start" />
        </div>
      </main>
    </div>
  )
}
