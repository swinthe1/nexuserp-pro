import { Check, Delete, Loader2 } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { t, tServer } from '@/i18n'
import { describeError } from '@/lib/errors'
import { type SharedTill, markPinSession, setTill } from '@/lib/shared-till'
import { supabase } from '@/lib/supabase'
import { cn, initials } from '@/lib/utils'

type Person = { member_id: string; name: string }
type People = { device: string; company: string; people: Person[] } | null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** after the PIN was accepted: the server makes a one-time code, and the code opens the session; the user's id */
export async function finishPinSignIn(request: string, secret: string): Promise<string | null> {
  let res: { status: string; email?: string; otp?: string; error?: string } = { status: 'queued' }
  for (let i = 0; i < 60 && (res.status === 'queued' || res.status === 'running'); i++) {
    await sleep(i < 10 ? 250 : 500)
    const q = await supabase.rpc('pin_login_result', { p_request: request, p_secret: secret })
    if (q.error) throw q.error
    res = q.data as unknown as typeof res
  }
  if (res.status !== 'done' || !res.email || !res.otp) throw new Error(res.error ?? 'The sign-in did not answer in time; try again')
  let v = await supabase.auth.verifyOtp({ email: res.email, token: res.otp, type: 'magiclink' })
  if (v.error) v = await supabase.auth.verifyOtp({ email: res.email, token: res.otp, type: 'email' })
  if (v.error) throw v.error
  return v.data.user?.id ?? null
}

/** On a shared till: tap your name, type your PIN. */
export function PinLogin({ till, onEmail }: { till: SharedTill; /** to the sign-in with a user name */ onEmail: () => void }) {
  const navigate = useNavigate()
  const [people, setPeople] = React.useState<People | undefined>(undefined)
  const [who, setWho] = React.useState<Person | null>(null)
  const [pin, setPin] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    void supabase.rpc('shared_device_people', { p_token: till.token }).then(({ data, error: e }) => {
      if (e) { setError(describeError(e)); setPeople(null); return }
      // the administrator took this computer off the list of tills
      if (!data) { setTill(null); onEmail(); return }
      setPeople(data as unknown as People)
    })
  }, [till.token, onEmail])

  const submit = React.useCallback(async (code: string) => {
    if (!who || code.length < 4 || busy) return
    setBusy(true); setError(null)
    try {
      const { data, error: e } = await supabase.rpc('pin_login', { p_token: till.token, p_member: who.member_id, p_pin: code })
      if (e) throw e
      const r = data as unknown as { error?: string; request?: string; secret?: string }
      if (r.error) { setError(tServer(r.error)); setPin(''); return }
      markPinSession(await finishPinSignIn(r.request!, r.secret!))
      navigate('/', { replace: true })
    } catch (e) { setError(describeError(e)); setPin('') } finally { setBusy(false) }
  }, [who, busy, till.token, navigate])

  const press = (d: string) => {
    if (busy) return
    setError(null)
    const next = (pin + d).slice(0, 6)
    setPin(next)
    if (next.length === 6) void submit(next)
  }
  React.useEffect(() => {
    if (!who) return
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (e.key === 'Enter') void submit(pin)
      else if (e.key === 'Escape') { setWho(null); setPin('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (people === undefined) return <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />

  if (!who) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-[-0.01em]">{t('Who are you?')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{people ? `${people.company} · ${people.device}` : till.name}</p>
        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
        {people && people.people.length === 0 && <p className="mt-6 text-sm text-muted-foreground">{t('Nobody has a PIN yet. The administrator gives one in Settings → Users.')}</p>}
        <div className="mt-6 grid grid-cols-2 gap-3">
          {people?.people.map((p) => (
            <button key={p.member_id} type="button" onClick={() => { setWho(p); setPin(''); setError(null) }}
              className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border bg-card p-3 text-center shadow-sm transition-[transform,border-color] hover:border-primary/40 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-base font-semibold text-primary">{initials(p.name)}</span>
              <span className="line-clamp-2 text-sm font-medium leading-tight">{p.name}</span>
            </button>
          ))}
        </div>
        <button type="button" onClick={onEmail} className="mt-8 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{t('Sign in with your user name')}</button>
      </div>
    )
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  return (
    <div className="mx-auto max-w-xs">
      <button type="button" onClick={() => { setWho(null); setPin('') }} className="text-sm text-muted-foreground hover:text-foreground">← {t('Someone else')}</button>
      <div className="mt-4 flex flex-col items-center text-center">
        <span className="grid size-14 place-items-center rounded-full bg-primary/10 text-lg font-semibold text-primary">{initials(who.name)}</span>
        <p className="mt-2 text-lg font-semibold">{who.name}</p>
        <p className="text-sm text-muted-foreground">{t('Type your PIN')}</p>
        <div className="mt-4 flex h-5 items-center gap-3" aria-label={t('{n} digits typed', { n: pin.length })}>
          {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
            <span key={i} className={cn('size-3.5 rounded-full border-2 border-primary transition-colors', i < pin.length && 'bg-primary')} />
          ))}
        </div>
        <p className={cn('mt-3 min-h-5 text-sm', error ? 'text-destructive' : 'text-muted-foreground')}>{error ?? (busy ? t('Signing in…') : '')}</p>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-3">
        {keys.map((k) => <PadKey key={k} onClick={() => press(k)} disabled={busy}>{k}</PadKey>)}
        <PadKey onClick={() => setPin((p) => p.slice(0, -1))} disabled={busy || !pin} label={t('Delete')}><Delete className="size-6" /></PadKey>
        <PadKey onClick={() => press('0')} disabled={busy}>0</PadKey>
        <PadKey onClick={() => void submit(pin)} disabled={busy || pin.length < 4} primary label={t('Sign in')}>
          {busy ? <Loader2 className="size-6 animate-spin" /> : <Check className="size-7" />}
        </PadKey>
      </div>
    </div>
  )
}

function PadKey({ children, onClick, disabled, primary, label }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; label?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label}
      className={cn('grid h-16 place-items-center rounded-2xl border text-2xl font-medium tabular-nums shadow-sm transition-[transform,background-color] active:scale-[0.95] disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        primary ? 'border-primary bg-primary text-base text-primary-foreground' : 'bg-card hover:bg-secondary')}>
      {children}
    </button>
  )
}
