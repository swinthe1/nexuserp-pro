import { KeyRound, LogOut, ShieldCheck, Smartphone } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useAuth } from '@/app/auth-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { t } from '@/i18n'
import { describeError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

type Gate = 'loading' | 'ok' | 'challenge' | 'enroll'

/** the sign-in service sends the QR code as a raw SVG in a data address; a "#" inside it would cut the picture short */
const qrSrc = (q: string) => {
  const m = q.match(/^data:image\/svg\+xml;(?:utf-8|charset=utf-8),(.*)$/s)
  return m && m[1]!.trimStart().startsWith('<') ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(m[1]!)}` : q
}

/**
 * Two-step verification. After the password:
 *  - whoever turned it on types the code from their phone (until then the server shows them no company's data);
 *  - the platform owners and the companies' administrators who have not turned it on are asked to, before anything else.
 * A server whose sign-in service cannot do it lets everyone through as before.
 */
export function MfaGate({ children }: { children: React.ReactNode }) {
  const { session, user, loading } = useAuth()
  const qc = useQueryClient()
  const [gate, setGate] = React.useState<Gate>('loading')
  const required = React.useRef<{ user: string; must: boolean; enabled: boolean } | null>(null)

  const check = React.useCallback(async () => {
    if (loading) return
    if (!user) { setGate('ok'); return }
    try {
      // read from the session on this device (works without internet)
      const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal.error) { setGate('ok'); return }
      if (aal.data.currentLevel === 'aal2') { setGate('ok'); return }
      // the server knows best (a factor set up on another device is not in this device's session yet)
      if (required.current?.user !== user.id || required.current.enabled) {
        const st = await supabase.rpc('mfa_status' as never)
        if (st.error) {
          // offline, or a server not updated yet: what the session says
          setGate(aal.data.nextLevel === 'aal2' ? 'challenge' : 'ok'); return
        }
        const v = (st.data ?? {}) as { required?: boolean; enabled?: boolean; verified?: boolean }
        required.current = { user: user.id, must: !!v.required, enabled: !!v.enabled && !v.verified }
      }
      setGate(required.current.enabled ? 'challenge' : required.current.must ? 'enroll' : 'ok')
    } catch { setGate('ok') }
  }, [user, loading])

  React.useEffect(() => { void check() }, [check, session?.access_token])

  if (gate === 'ok') return <>{children}</>
  if (gate === 'loading') return <div className="h-dvh bg-background" />
  return (
    <div className="grid min-h-dvh place-items-center bg-muted/40 p-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        {gate === 'challenge'
          ? <MfaChallenge onDone={() => { required.current = null; void qc.invalidateQueries(); void check() }} />
          : <MfaEnroll required onDone={() => { required.current = null; void qc.invalidateQueries(); void check() }} onSkip={() => setGate('ok')} />}
      </div>
    </div>
  )
}

/** the code from the phone, after the password */
function MfaChallenge({ onDone }: { onDone: () => void }) {
  const { user, signOut } = useAuth()
  const [code, setCode] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const f = await supabase.auth.mfa.listFactors()
      if (f.error) throw f.error
      const factor = f.data.totp[0]
      if (!factor) { onDone(); return }
      const r = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
      if (r.error) { setError(t('The code is not correct or has expired. Type the one showing now.')); setCode(''); return }
      onDone()
    } catch (err) { setError(describeError(err)) } finally { setBusy(false) }
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary"><Smartphone className="size-5" /></div>
      <div><h1 className="text-xl font-semibold">{t('Two-step verification')}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">{t('Open the authenticator app on your phone and type the 6-digit code for DrisPRO ({email}).', { email: user?.email ?? '' })}</p></div>
      <div className="grid gap-1.5"><Label htmlFor="mfa-code">{t('Code')}</Label>
        <Input id="mfa-code" autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-12 text-center font-mono text-2xl tracking-[0.4em]"
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
      {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
      <Button type="submit" size="lg" loading={busy} disabled={code.length !== 6}>{t('Continue')}</Button>
      <p className="text-xs text-muted-foreground">{t('Lost the phone? The platform owner can reset your two-step verification; then you set it up again.')}</p>
      <Button type="button" variant="ghost" onClick={() => void signOut()}><LogOut /> {t('Sign out')}</Button>
    </form>
  )
}

/** setting it up: scan the code with the phone, type what it shows */
export function MfaEnroll({ required, onDone, onSkip }: { required?: boolean; onDone: () => void; onSkip?: () => void }) {
  const { signOut } = useAuth()
  const [factor, setFactor] = React.useState<{ id: string; qr: string; secret: string } | null>(null)
  const [unsupported, setUnsupported] = React.useState<string | null>(null)
  const [code, setCode] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    let alive = true
    void (async () => {
      try {
        // a half-done set-up from before is dropped first
        const list = await supabase.auth.mfa.listFactors()
        for (const f of list.data?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
        const r = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `DrisPRO ${new Date().toISOString().slice(0, 16).replace('T', ' ')}` })
        if (!alive) return
        if (r.error) { setUnsupported(describeError(r.error)); return }
        setFactor({ id: r.data.id, qr: qrSrc(r.data.totp.qr_code), secret: r.data.totp.secret })
      } catch (err) { if (alive) setUnsupported(describeError(err)) }
    })()
    return () => { alive = false }
  }, [])
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!factor) return
    setBusy(true); setError(null)
    try {
      const r = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
      if (r.error) { setError(t('The code is not correct or has expired. Type the one showing now.')); setCode(''); return }
      onDone()
    } catch (err) { setError(describeError(err)) } finally { setBusy(false) }
  }
  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary"><ShieldCheck className="size-5" /></div>
      <div><h1 className="text-xl font-semibold">{t('Turn on two-step verification')}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">{required
          ? t('You manage a company (or the platform), so a password alone is not enough: after it, a code from your phone is asked. It takes a minute, once.')
          : t('After the password, a code from your phone is asked. A stolen password alone then opens nothing.')}</p></div>
      {unsupported ? (
        <div className="grid gap-3">
          <p role="alert" className="rounded-md bg-warning/10 px-3 py-2 text-[13px] text-warning">{t('This server cannot set up two-step verification yet ({reason}). Ask the administrator to turn it on in the sign-in service.', { reason: unsupported })}</p>
          {onSkip && <Button type="button" variant="outline" onClick={onSkip}>{t('Continue without it for now')}</Button>}
        </div>
      ) : !factor ? <div className="h-48 animate-pulse rounded-lg bg-muted" /> : (
        <>
          <ol className="grid gap-1 text-[13px]">
            <li>{t('1. Install an authenticator app on the phone: Google Authenticator or Microsoft Authenticator.')}</li>
            <li>{t('2. In the app, add an account and scan this code.')}</li>
            <li>{t('3. Type the 6 digits the app shows.')}</li>
          </ol>
          <div className="mx-auto rounded-lg border bg-white p-2"><img src={factor.qr} alt={t('Code to scan with the phone')} className="size-44" /></div>
          <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t('Cannot scan? Type this key in the app')}</summary>
            <code className="mt-1 block break-all rounded bg-muted px-2 py-1 font-mono text-foreground">{factor.secret}</code></details>
          <div className="grid gap-1.5"><Label htmlFor="mfa-new">{t('Code')}</Label>
            <Input id="mfa-new" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-12 text-center font-mono text-2xl tracking-[0.4em]"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
          {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
          <Button type="submit" size="lg" loading={busy} disabled={code.length !== 6}><KeyRound /> {t('Turn it on')}</Button>
        </>
      )}
      {required && <Button type="button" variant="ghost" onClick={() => void signOut()}><LogOut /> {t('Sign out')}</Button>}
    </form>
  )
}

/** from the account menu: is it on, turn it on or off */
export function TwoStepDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [factors, setFactors] = React.useState<{ id: string; name: string | null; created: string }[] | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const load = React.useCallback(async () => {
    const r = await supabase.auth.mfa.listFactors()
    if (r.error) { setError(describeError(r.error)); setFactors([]); return }
    setFactors(r.data.totp.map((f) => ({ id: f.id, name: f.friendly_name ?? null, created: f.created_at })))
  }, [])
  React.useEffect(() => { if (open) { setAdding(false); setError(null); setFactors(null); void load() } }, [open, load])
  const off = async (id: string) => {
    setBusy(true); setError(null)
    try {
      const r = await supabase.auth.mfa.unenroll({ factorId: id })
      if (r.error) throw r.error
      await supabase.auth.refreshSession()
      await load()
    } catch (err) { setError(describeError(err)) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Two-step verification')}</DialogTitle>
          <DialogDescription>{t('After the password, a code from your phone. A stolen password alone then opens nothing.')}</DialogDescription></DialogHeader>
        {adding ? <MfaEnroll onDone={() => { setAdding(false); void load() }} /> : factors === null ? <div className="h-16 animate-pulse rounded-md bg-muted" /> : (
          <div className="grid gap-3">
            {factors.length ? (
              <>
                <p className="flex items-center gap-2 text-[13px] font-medium text-success"><ShieldCheck className="size-4" /> {t('On')}</p>
                {factors.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-[13px]">
                    <span>{f.name ?? t('Phone')}</span>
                    <Button size="sm" variant="ghost" className="text-destructive" loading={busy} onClick={() => void off(f.id)}>{t('Turn off')}</Button>
                  </div>
                ))}
              </>
            ) : <Button onClick={() => setAdding(true)}><ShieldCheck /> {t('Turn on two-step verification')}</Button>}
            {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
