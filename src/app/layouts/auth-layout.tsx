import { Check } from 'lucide-react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { DesktopDownload } from '@/features/auth/desktop-download'
import { msg, t } from '@/i18n'
import { LanguageToggle } from '@/i18n/language'

/** What the program does, printed as the lines of a till receipt: the thing every shop knows. */
const LINES = [
  msg('Sales at the till'),
  msg('Stock and average cost'),
  msg('Purchases and suppliers'),
  msg('VAT and the books'),
  msg('Payroll'),
  msg('Accounting'),
]

function Receipt() {
  return (
    <div className="auth-receipt relative w-[300px] rotate-[-2deg] text-[#1d232f] drop-shadow-[0_24px_40px_rgba(0,0,0,0.35)]">
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
              <Check className="size-3.5 translate-y-[2px] text-[#2f5bd3]" strokeWidth={3} />
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

export function AuthLayout() {
  const { user, loading } = useAuth()
  if (!loading && user) return <Navigate to="/" replace />
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
      <style>{`
        @keyframes auth-print { from { clip-path: inset(0 0 100% 0); transform: translateY(-24px) rotate(-2deg); } to { clip-path: inset(0 0 0 0); transform: translateY(0) rotate(-2deg); } }
        .auth-receipt { animation: auth-print 1.1s cubic-bezier(.2,.7,.2,1) both .15s; }
        @media (prefers-reduced-motion: reduce) { .auth-receipt { animation: none; } }
      `}</style>
      <aside className="relative hidden overflow-hidden bg-[#121a2e] text-white lg:flex">
        {/* the slot of the till the receipt comes out of */}
        <div className="absolute inset-x-0 top-0 h-px bg-white/10" />
        <div className="relative flex w-full flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <img src="/favicon.svg" alt="" className="size-7" /> DrisPRO
          </div>
          <div className="grid max-w-4xl items-center gap-14 min-[1400px]:grid-cols-[minmax(0,1fr)_auto]">
            <div className="max-w-md">
              <h2 className="text-[2.6rem] font-semibold leading-[1.08] tracking-[-0.03em]">
                {t('Stock, sales, purchasing and accounting — all in one place.')}
              </h2>
              <p className="mt-5 max-w-sm text-[15px] leading-relaxed text-white/65">
                {t('Every receipt updates your average cost, and every movement can be traced back to its document. Made for shops, wholesalers and producers in Albania and Kosovo.')}
              </p>
            </div>
            <div className="hidden justify-center min-[1400px]:flex"><Receipt /></div>
          </div>
          <p className="text-xs text-white/45">{t('Several companies · Access by role · Full history of changes')}</p>
        </div>
      </aside>

      <main className="relative flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold lg:invisible">
            <img src="/favicon.svg" alt="" className="size-7" /> DrisPRO
          </div>
          <LanguageToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <Outlet />
          <DesktopDownload className="mt-10 max-sm:hidden" />
        </div>
      </main>
    </div>
  )
}
