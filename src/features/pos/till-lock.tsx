/**
 * The till's lock. The cashier locks it when she steps away (or it locks itself after the company's
 * minutes without use); the sale on the screen stays as it was. She opens it with her own PIN, or a
 * manager with theirs. Without internet the PIN is checked against a copy kept on this device the
 * last time it was checked online. A page reload keeps the till locked.
 */
import { Delete, Lock, LogOut, ShieldCheck, Users } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDateWith, t, tServer } from '@/i18n'
import { describeError } from '@/lib/errors'
import { cn, initials } from '@/lib/utils'
import { posApprove, posMyPin, posUnlock, setMyPin } from './api'
import { kvGet, kvSet } from './offline'
import { ManagerPinFields, pinReady } from './manager-pin'

/* ------------------------------------------------------------------ the lock's state, kept across a reload */
const lockKey = (register: string) => `pos.locked:${register}`
export function readLocked(register: string) { try { return localStorage.getItem(lockKey(register)) === '1' } catch { return false } }
function writeLocked(register: string, v: boolean) { try { if (v) localStorage.setItem(lockKey(register), '1'); else localStorage.removeItem(lockKey(register)) } catch { /* private window */ } }

/* ------------------------------------------------------------------ the copy of the PIN for offline (a slow hash, never the PIN) */
type Verifier = { salt: string; hash: string; iter: number }
const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
async function derive(pin: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256))
}
async function keepVerifier(user: string, pin: string) {
  if (!crypto?.subtle) return
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iter = 150_000
  await kvSet(`pin:${user}`, { salt: b64(salt), hash: await derive(pin, salt, iter), iter } satisfies Verifier).catch(() => undefined)
}
async function checkOffline(user: string, pin: string): Promise<boolean | null> {
  const v = await kvGet<Verifier>(`pin:${user}`).catch(() => undefined)
  if (!v || !crypto?.subtle) return null
  return (await derive(pin, unb64(v.salt), v.iter)) === v.hash
}
/** wrong PINs without internet: five, then ten minutes of waiting (as on the server) */
const OFF_KEY = 'pos.pin.offline'
function offlineTries(): { n: number; until: number } { try { return JSON.parse(localStorage.getItem(OFF_KEY) ?? '') as { n: number; until: number } } catch { return { n: 0, until: 0 } } }
function setOfflineTries(v: { n: number; until: number } | null) { try { if (v) localStorage.setItem(OFF_KEY, JSON.stringify(v)); else localStorage.removeItem(OFF_KEY) } catch { /* ignore */ } }

/* ------------------------------------------------------------------ the hook the till uses */
export function useTillLock({ register, company, user, minutes, busy }: { register: string; company: string; user: string; minutes: number; busy: boolean }) {
  const [locked, setLocked] = React.useState(() => readLocked(register))
  const [hasPin, setHasPin] = React.useState<{ member: string; has_pin: boolean } | null>(null)
  const [askPin, setAskPin] = React.useState(false)
  React.useEffect(() => {
    if (!navigator.onLine) return
    void posMyPin(company).then(setHasPin).catch(() => undefined)
  }, [company])
  const known = hasPin?.has_pin ?? null
  const lock = React.useCallback(async (auto = false, sure = false) => {
    if (sure) { writeLocked(register, true); setLocked(true); return }
    // nobody is shut out: a cashier without a PIN chooses one first (a lock by itself waits for it)
    let pin = known
    if (pin === null && navigator.onLine) {
      const r = await posMyPin(company).catch(() => null)
      setHasPin(r); pin = r?.has_pin ?? null
    }
    if (pin === false) { if (!auto) setAskPin(true); return }
    if (pin === null) {
      const v = await kvGet<Verifier>(`pin:${user}`).catch(() => undefined)
      if (!v) { if (!auto) setAskPin(true); return }
    }
    writeLocked(register, true); setLocked(true)
  }, [known, company, register, user])
  const unlock = React.useCallback(() => { writeLocked(register, false); setLocked(false) }, [register])
  // by itself after the company's minutes without a touch or a key
  const busyRef = React.useRef(busy); busyRef.current = busy
  React.useEffect(() => {
    if (!minutes || locked) return
    let last = Date.now()
    const touch = () => { last = Date.now() }
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const timer = window.setInterval(() => { if (!busyRef.current && Date.now() - last > minutes * 60_000) void lock(true) }, 15_000)
    return () => { events.forEach((e) => window.removeEventListener(e, touch)); window.clearInterval(timer) }
  }, [minutes, locked, lock])
  return { locked, lock, unlock, askPin, closeAskPin: () => setAskPin(false), member: hasPin?.member ?? null,
    pinSet: () => { setHasPin((h) => (h ? { ...h, has_pin: true } : h)); setAskPin(false) } }
}

/* ------------------------------------------------------------------ the locked screen */
export function LockScreen({ register, registerName, user, cashier, managers, onUnlocked, onSwitch }: {
  register: string; registerName: string; user: string; cashier: string
  managers: { member_id: string; name: string }[]
  onUnlocked: () => void; onSwitch: () => void
}) {
  const [pin, setPin] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [manager, setManager] = React.useState(false)
  const [mgr, setMgr] = React.useState(managers.length === 1 ? managers[0]!.member_id : '')
  const [mgrPin, setMgrPin] = React.useState('')
  // a barcode scanned into the PIN: the keys come faster than any hand types them
  const keys = React.useRef<number[]>([])
  const [since] = React.useState(() => new Date())

  const submit = React.useCallback(async (code: string) => {
    if (busy) return
    const k = keys.current
    if (k.length >= 4 && (k[k.length - 1]! - k[0]!) / (k.length - 1) < 30) {
      setPin(''); keys.current = []; setError(t('That was a scan. Open the till with your PIN first, then scan.')); return
    }
    if (!/^\d{4,6}$/.test(code)) { setError(t('The PIN has 4 to 6 digits')); return }
    setBusy(true); setError(null)
    try {
      if (navigator.onLine) {
        try {
          const r = await posUnlock(register, code)
          if (r.ok) { setOfflineTries(null); void keepVerifier(user, code); onUnlocked(); return }
          setError(r.no_pin ? t('You have no PIN yet. A manager opens the till; then choose your PIN.') : tServer(r.error ?? 'Wrong PIN'))
          setPin(''); return
        } catch (e) {
          if (navigator.onLine && !/fetch|network/i.test(String((e as Error)?.message))) throw e
        }
      }
      // without internet: the copy kept on this device
      const tries = offlineTries()
      if (tries.until > Date.now()) { setError(t('Too many wrong PINs; try again in {n} minutes', { n: Math.ceil((tries.until - Date.now()) / 60_000) })); setPin(''); return }
      const ok = await checkOffline(user, code)
      if (ok === null) { setError(t('Without internet the PIN cannot be checked on this device yet. It opens as soon as the internet is back.')); setPin(''); return }
      if (ok) { setOfflineTries(null); onUnlocked(); return }
      const n = tries.n + 1
      setOfflineTries({ n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 10 * 60_000 : 0 })
      setError(n >= 5 ? t('Too many wrong PINs; try again in 10 minutes') : t('Wrong PIN')); setPin('')
    } catch (e) { setError(describeError(e)); setPin('') } finally { setBusy(false); keys.current = [] }
  }, [busy, register, user, onUnlocked])

  const byManager = async () => {
    if (!pinReady(mgr, mgrPin) || busy) return
    setBusy(true); setError(null)
    try {
      const r = await posApprove(register, mgr, mgrPin, 'unlock')
      if (r.error || !r.approval) { setError(tServer(r.error ?? 'Wrong PIN')); setMgrPin(''); return }
      onUnlocked()
    } catch (e) { setError(describeError(e)); setMgrPin('') } finally { setBusy(false) }
  }

  const press = (d: string) => { if (busy) return; setError(null); keys.current.push(performance.now()); setPin((p) => (p + d).slice(0, 6)) }
  React.useEffect(() => {
    if (manager) return
    const onKey = (e: KeyboardEvent) => {
      // the till underneath hears nothing while it is locked
      e.stopImmediatePropagation()
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key) }
      else if (e.key === 'Backspace') { e.preventDefault(); setPin((p) => p.slice(0, -1)) }
      else if (e.key === 'Enter') { e.preventDefault(); void submit(pin) }
      else if (e.key === 'Escape') { e.preventDefault(); setPin(''); keys.current = [] }
      else if (e.key.length === 1 || e.key.startsWith('F')) e.preventDefault()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  })

  return (
    <div role="dialog" aria-modal="true" aria-label={t('The till is locked')} className="fixed inset-0 z-[60] grid place-items-center bg-background/95 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-lg">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">{initials(cashier)}</div>
        <div className="mt-3 flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground"><Lock className="size-3.5" /> {registerName}</div>
        <h1 className="mt-0.5 text-lg font-semibold">{t('{name} locked the till', { name: cashier })}</h1>
        <p className="text-[12.5px] text-muted-foreground">{t('Since {time}. The sale on the screen is kept.', { time: formatDateWith(since, { hour: '2-digit', minute: '2-digit' }) })}</p>

        {!manager ? <>
          <div className="mt-5 flex justify-center gap-2.5" aria-label={t('PIN')}>
            {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
              <span key={i} className={cn('size-3.5 rounded-full border-2 border-primary/60 transition-colors', i < pin.length && 'bg-primary')} />
            ))}
          </div>
          <div aria-live="polite" className="mt-3 min-h-5 text-[13px] font-medium text-destructive">{error}</div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <Button key={d} type="button" variant="outline" className="h-14 text-xl font-semibold tabular" onClick={() => press(d)}>{d}</Button>
            ))}
            <Button type="button" variant="ghost" className="h-14" aria-label={t('Delete')} onClick={() => setPin((p) => p.slice(0, -1))}><Delete className="size-5" /></Button>
            <Button type="button" variant="outline" className="h-14 text-xl font-semibold tabular" onClick={() => press('0')}>0</Button>
            <Button type="button" className="h-14" loading={busy} disabled={pin.length < 4} onClick={() => void submit(pin)}>{t('Open|till')}</Button>
          </div>
        </> : (
          <div className="mt-5 grid gap-3 text-left">
            <ManagerPinFields managers={managers} member={mgr} onMember={setMgr} pin={mgrPin} onPin={setMgrPin} autoFocus />
            <div aria-live="polite" className="min-h-5 text-[13px] font-medium text-destructive">{error}</div>
            <Button loading={busy} disabled={!pinReady(mgr, mgrPin) || !navigator.onLine} onClick={() => void byManager()}><ShieldCheck /> {t('Open the till')}</Button>
            {!navigator.onLine && <p className="text-[12.5px] text-warning">{t('A manager\'s PIN is checked online.')}</p>}
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px]">
          {managers.length > 0 && <button type="button" className="font-medium text-primary hover:underline" onClick={() => { setManager((m) => !m); setError(null) }}>
            {manager ? t('Open with my PIN') : t('A manager opens it')}</button>}
          <button type="button" className="inline-flex items-center gap-1 font-medium text-primary hover:underline" onClick={onSwitch}><Users className="size-3.5" /> {t('Switch cashier')}</button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ a cashier without a PIN chooses one */
export function ChoosePinDialog({ member, user, onDone, onCancel }: { member: string | null; user: string; onDone: () => void; onCancel: () => void }) {
  const [a, setA] = React.useState('')
  const [b, setB] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const save = async () => {
    if (!member) return
    if (!/^\d{4,6}$/.test(a)) { setError(t('The PIN has 4 to 6 digits')); return }
    if (a !== b) { setError(t('The two PINs are not the same')); return }
    setBusy(true); setError(null)
    try { await setMyPin(member, a); await keepVerifier(user, a); onDone() } catch (e) { setError(describeError(e)) } finally { setBusy(false) }
  }
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6)
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Lock className="size-5 text-primary" /> {t('Choose your PIN')}</DialogTitle>
          <DialogDescription>{t('The till opens again only with it. 4 to 6 digits that only you know. The same PIN signs you in on a shared till.')}</DialogDescription>
        </DialogHeader>
        {!member || !navigator.onLine ? <p className="text-[13px] text-warning">{t('Choosing a PIN needs internet.')}</p> : (
          <div className="grid gap-3">
            <div className="grid gap-1.5"><Label htmlFor="pin-a">{t('PIN')}</Label>
              <Input id="pin-a" type="password" inputMode="numeric" autoComplete="off" autoFocus className="text-center text-lg tracking-[0.4em] tabular" value={a} onChange={(e) => setA(digits(e.target.value))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="pin-b">{t('The same PIN again')}</Label>
              <Input id="pin-b" type="password" inputMode="numeric" autoComplete="off" className="text-center text-lg tracking-[0.4em] tabular" value={b} onChange={(e) => setB(digits(e.target.value))}
                onKeyDown={(e) => { if (e.key === 'Enter') void save() }} /></div>
            <div aria-live="polite" className="min-h-5 text-[13px] font-medium text-destructive">{error}</div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>{t('Cancel')}</Button>
          <Button onClick={() => void save()} loading={busy} disabled={!member || !navigator.onLine}>{t('Save the PIN and lock')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ switching cashier: the shift closes with its count */
export function SwitchCashierDialog({ cashier, saleOnScreen, mode, onClose, onCloseShift, onSignOut }: {
  cashier: string; saleOnScreen: boolean
  /** own: her own shift, open; stepping: a manager in someone else's shift; locked: from the locked screen (no PIN typed) */
  mode: 'own' | 'stepping' | 'locked'
  onClose: () => void; onCloseShift: () => void; onSignOut: () => void
}) {
  const stepping = mode === 'stepping'
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="size-5 text-primary" /> {t('Switch cashier')}</DialogTitle>
          <DialogDescription>{stepping
            ? t('You are stepping in on {name}\'s shift. When you leave, she carries on in her own shift.', { name: cashier })
            : mode === 'locked'
              ? t('The shift stays {name}\'s until she closes it with her count (open the till with her PIN to close it now). Signing out lets the next person sign in.', { name: cashier })
              : t('Each cashier sells in her own shift. {name} closes this one with her count; the next cashier signs in and opens hers.', { name: cashier })}</DialogDescription>
        </DialogHeader>
        {saleOnScreen && <p className="rounded-md border border-warning/50 bg-warning/5 px-3 py-2 text-[13px]">{mode === 'locked'
          ? t('The sale on the screen is lost when signing out.') : t('Finish or clear the sale on the screen first.')}</p>}
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={onClose}>{t('Cancel')}</Button>
          <div className="flex flex-wrap justify-end gap-2">
            {mode === 'locked' ? <Button variant="destructive" onClick={onSignOut}><LogOut /> {t('Sign out')}</Button>
              : stepping ? <Button disabled={saleOnScreen} onClick={onSignOut}><LogOut /> {t('Sign out')}</Button>
              : <Button disabled={saleOnScreen} onClick={onCloseShift}><LogOut /> {t('Close my shift and switch')}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
