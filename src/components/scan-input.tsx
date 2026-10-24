import { Camera, ScanLine, X } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

/* ------------------------------------------------------------------ feedback */
let audio: AudioContext | null = null
/** Short beep for a good scan, low buzz for a bad one (scanner-gun habit: you hear it before you look) */
export function scanFeedback(kind: 'ok' | 'error') {
  try {
    audio ??= new AudioContext()
    const o = audio.createOscillator()
    const g = audio.createGain()
    o.type = kind === 'ok' ? 'sine' : 'square'
    o.frequency.value = kind === 'ok' ? 1320 : 180
    g.gain.value = 0.06
    o.connect(g).connect(audio.destination)
    o.start()
    o.stop(audio.currentTime + (kind === 'ok' ? 0.07 : 0.22))
  } catch { /* audio unavailable */ }
  if (kind === 'error') navigator.vibrate?.(180)
}

type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }
export const hasCamera = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

/**
 * The input every scan screen is built around. Keyboard-wedge scanners type the code and press Enter;
 * people can type too. Focus comes back after a scan so the next scan just works.
 */
export const ScanInput = React.forwardRef<HTMLInputElement, {
  onScan: (code: string) => void | Promise<void>
  placeholder?: string
  status?: { tone: 'ok' | 'error' | 'info'; text: string } | null
  className?: string
  autoFocus?: boolean
  /** keep focus on this input when clicking empty space (scan screens) */
  sticky?: boolean
}>(function ScanInput({ onScan, placeholder, status, className, autoFocus = true, sticky = true }, fwd) {
  const ref = React.useRef<HTMLInputElement | null>(null)
  const [value, setValue] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [camera, setCamera] = React.useState(false)
  React.useImperativeHandle(fwd, () => ref.current!)

  React.useEffect(() => {
    if (!sticky) return
    // refocus after clicks on non-interactive space, never stealing focus from other fields or open dialogs
    const onUp = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input,textarea,select,button,a,[role=dialog],[role=listbox],[role=menu],[contenteditable=true]')) return
      if (document.querySelector('[role=dialog]')) return
      ref.current?.focus({ preventScroll: true })
    }
    window.addEventListener('pointerup', onUp)
    return () => window.removeEventListener('pointerup', onUp)
  }, [sticky])

  const submit = async (code: string) => {
    const c = code.trim()
    if (!c) return
    setValue('')
    setBusy(true)
    try { await onScan(c) } finally { setBusy(false); ref.current?.focus() }
  }

  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(value) } }}
            autoFocus={autoFocus}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
            aria-label={t('Scan')}
            placeholder={placeholder ?? t('Scan a barcode or type a code')}
            className={cn('h-12 w-full rounded-lg border-2 bg-background pl-11 pr-3 font-mono text-base outline-none transition-colors',
              'focus:border-primary focus:ring-4 focus:ring-primary/15', busy && 'opacity-70')}
          />
        </div>
        {hasCamera && <Button type="button" variant="outline" className="h-12 w-12 shrink-0 p-0" aria-label={t('Scan with the camera')} onClick={() => setCamera(true)}><Camera className="size-5" /></Button>}
      </div>
      <div aria-live="polite" className={cn('min-h-5 text-[13px]', status?.tone === 'error' ? 'font-medium text-destructive' : status?.tone === 'ok' ? 'text-success' : 'text-muted-foreground')}>
        {status?.text}
      </div>
      {camera && <CameraScanner onClose={() => setCamera(false)} onCode={(c) => { setCamera(false); void submit(c) }} />}
    </div>
  )
})

export function CameraScanner({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const video = React.useRef<HTMLVideoElement>(null)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    let stream: MediaStream | null = null
    let stop = false
    const Detector = (window as unknown as { BarcodeDetector: new (o?: unknown) => BarcodeDetectorLike }).BarcodeDetector
    const detector = new Detector({ formats: ['ean_13', 'ean_8', 'upc_a', 'code_128', 'code_39', 'qr_code', 'data_matrix'] })
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (!video.current) return
        video.current.srcObject = stream
        await video.current.play()
        while (!stop) {
          const codes = await detector.detect(video.current).catch(() => [])
          if (codes[0]?.rawValue) { scanFeedback('ok'); onCode(codes[0].rawValue); return }
          await new Promise((r) => setTimeout(r, 180))
        }
      } catch {
        setError('The camera is not available. Allow camera access or use a scanner.')
      }
    })()
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()) }
  }, [onCode])
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('Scan with the camera')}</DialogTitle><DialogDescription>{t('Hold the barcode inside the frame.')}</DialogDescription></DialogHeader>
        {error ? <p className="text-[13px] text-destructive">{error}</p> : (
          <div className="relative overflow-hidden rounded-lg bg-black">
            <video ref={video} className="aspect-[4/3] w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-primary/80 shadow-[0_0_12px_hsl(var(--primary))]" />
          </div>
        )}
        <Button variant="outline" onClick={onClose}><X /> {t('Close')}</Button>
      </DialogContent>
    </Dialog>
  )
}
