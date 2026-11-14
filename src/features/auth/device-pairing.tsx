import { CheckCircle2, KeyRound, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { checkPairing, deviceKind, startPairing, type Pairing } from '@/lib/device-licence'

/**
 * This device has no licence of its own: it asks DrisPRO for a pairing code, shows it large, and waits.
 * DrisPRO's Super Admin types the code in the Platform; the device then has its licence and signs in.
 */
export function DevicePairing({ onLicensed }: { onLicensed: () => void }) {
  const [pairing, setPairing] = React.useState<Pairing | null>(null)
  const [state, setState] = React.useState<'idle' | 'asking' | 'waiting' | 'done' | 'expired'>('idle')
  const [error, setError] = React.useState<string | null>(null)

  const ask = React.useCallback(async () => {
    setState('asking'); setError(null)
    try { setPairing(await startPairing()); setState('waiting') }
    catch { setError(t('DrisPRO could not be reached. Check the internet and try again.')); setState('idle') }
  }, [])

  React.useEffect(() => {
    if (state !== 'waiting' || !pairing) return
    let stop = false
    const tick = async () => {
      try {
        const r = await checkPairing(pairing)
        if (stop) return
        if (r.status === 'active') { setState('done'); window.setTimeout(onLicensed, 1200) }
        else if (r.status === 'expired' || r.status === 'unknown') setState('expired')
      } catch { /* no internet for a moment: asks again */ }
    }
    const id = window.setInterval(() => void tick(), 4000)
    return () => { stop = true; window.clearInterval(id) }
  }, [state, pairing, onLicensed])

  return (
    <div className="grid gap-4 rounded-lg border border-warning/40 bg-warning/5 p-4" role="status" aria-live="polite">
      <div className="flex gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
        <div className="grid gap-1">
          <p className="font-medium">{t('This device has no DrisPRO licence')}</p>
          <p className="text-sm text-muted-foreground">
            {deviceKind() === 'mobile'
              ? t('Your company lets only licensed phones and computers work. Ask for a licence for this phone: DrisPRO approves it.')
              : t('Your company lets only licensed phones and computers work. Ask for a licence for this computer: DrisPRO approves it.')}
          </p>
        </div>
      </div>
      {state === 'idle' || state === 'asking' ? (
        <Button type="button" onClick={() => void ask()} disabled={state === 'asking'} className="h-11">
          {state === 'asking' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
          {t('Ask for a licence for this device')}
        </Button>
      ) : null}
      {state === 'waiting' && pairing ? (
        <div className="grid justify-items-center gap-2 text-center">
          <p className="text-sm text-muted-foreground">{t('Give this code to DrisPRO (phone or WhatsApp):')}</p>
          <p className="font-mono text-4xl font-semibold tracking-[0.3em]" aria-label={pairing.code.split('').join(' ')}>{pairing.code}</p>
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t('Waiting for the approval… the code is valid for 15 minutes.')}</p>
        </div>
      ) : null}
      {state === 'expired' ? (
        <Button type="button" variant="outline" onClick={() => void ask()} className="h-11">
          <RefreshCw className="h-4 w-4" aria-hidden />{t('The code ran out: ask for a new one')}
        </Button>
      ) : null}
      {state === 'done' ? (
        <p className="flex items-center gap-2 font-medium text-success"><CheckCircle2 className="h-5 w-5" aria-hidden />{t('This device now has its licence. Sign in.')}</p>
      ) : null}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  )
}
