/**
 * Help at a distance, the console's side: the client's screen, live. The program on that computer is
 * asked through its own channel; the person there allows it or not; the picture comes straight from
 * that computer (WebRTC). Leaving this page, or "End", stops it on both sides.
 */
import { ArrowLeft, Ban, Clock, Expand, Loader2, MonitorOff, MonitorSmartphone, MousePointer2, PhoneOff, RotateCcw, ShieldCheck, WifiOff } from 'lucide-react'
import * as React from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { t, tServer } from '@/i18n'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { supportEnd, supportStart, type SupportStart } from '../../api'
import { SupportSignal } from './signal'

type Phase = 'connecting' | 'calling' | 'asking' | 'joining' | 'live' | 'declined' | 'unanswered' | 'offline' | 'busy' | 'invalid' | 'failed' | 'ended'
const DONE: Phase[] = ['declined', 'unanswered', 'offline', 'busy', 'invalid', 'failed', 'ended']
const pad = (n: number) => String(n).padStart(2, '0')

export function SupportViewerPage() {
  const { session } = useParams()
  const start = useLocation().state as SupportStart | null
  if (!start || start.session !== session) return <Gone />
  return <Viewer key={start.session} start={start} />
}

function Gone() {
  return (
    <div className="mx-auto grid max-w-md place-items-center gap-3 py-24 text-center">
      <MonitorOff className="size-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">{t('This session is over')}</h1>
      <p className="text-sm text-muted-foreground">{t('Open the computer again from the list to connect once more.')}</p>
      <Button asChild variant="outline"><Link to="/platform/devices"><ArrowLeft /> {t('Computers')}</Link></Button>
    </div>
  )
}

function Viewer({ start }: { start: SupportStart }) {
  const navigate = useNavigate()
  const video = React.useRef<HTMLVideoElement>(null)
  const stage = React.useRef<HTMLDivElement>(null)
  const [phase, setPhase] = React.useState<Phase>('connecting')
  const [online, setOnline] = React.useState(false)
  const [since, setSince] = React.useState<number | null>(null)
  const [size, setSize] = React.useState<string | null>(null)
  const [now, setNow] = React.useState(Date.now())
  const [retrying, setRetrying] = React.useState(false)
  // the person at the computer allowed control: the mouse and keys on the picture go to that computer
  const [control, setControl] = React.useState(false)
  const dc = React.useRef<RTCDataChannel | null>(null)
  const phaseRef = React.useRef<Phase>('connecting')
  const go = React.useCallback((p: Phase) => { phaseRef.current = p; setPhase(p) }, [])
  const ctl = React.useRef<{ signal: SupportSignal | null; pc: RTCPeerConnection | null; queue: RTCIceCandidateInit[]; closed: boolean; leaving?: number }>({ signal: null, pc: null, queue: [], closed: false })

  // the whole conversation with the program, for as long as this page is open
  React.useEffect(() => {
    const c = ctl.current
    c.closed = false
    // React may unmount and mount again at once (development): that is not leaving the page
    window.clearTimeout(c.leaving)
    const id = start.session
    let ask: number | undefined
    let giveUp: number | undefined
    const finish = (p: Phase, server: 'ended' | 'failed' | null = 'ended') => {
      if (DONE.includes(phaseRef.current)) return
      window.clearInterval(ask); window.clearTimeout(giveUp)
      c.pc?.close(); c.pc = null; dc.current = null
      if (video.current) video.current.srcObject = null
      go(p)
      if (server) void supportEnd(id, server)
    }
    const signal = new SupportSignal(start.channel, async (event, p) => {
      if (event === 'here') { setOnline(true); return }
      if (p.session !== id) return
      if (event === 'ack') { window.clearInterval(ask); window.clearTimeout(giveUp); if (phaseRef.current === 'calling') go('asking') }
      else if (event === 'declined') finish('declined', null)
      else if (event === 'unanswered') finish('unanswered', null)
      else if (event === 'busy') finish('busy')
      else if (event === 'invalid') finish('invalid')
      else if (event === 'error') { finish('failed', 'failed'); toast.error(String(p.message ?? '')) }
      else if (event === 'end') finish('ended', null)
      else if (event === 'offer') {
        go('joining')
        setControl(!!p.control)
        const scr = p.screen as { width?: number; height?: number } | undefined
        if (scr?.width) setSize(`${scr.width}×${scr.height}`)
        const pc = new RTCPeerConnection({ iceServers: start.ice })
        c.pc = pc
        pc.ondatachannel = (e) => { if (e.channel.label === 'input') dc.current = e.channel }
        pc.ontrack = (e) => {
          if (video.current) { video.current.srcObject = e.streams[0] ?? new MediaStream([e.track]); void video.current.play().catch(() => undefined) }
          go('live'); setSince(Date.now())
        }
        pc.onicecandidate = (e) => { if (e.candidate) signal.send('ice', { session: id, from: 'viewer', candidate: e.candidate.toJSON() }) }
        pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') finish('failed', 'failed') }
        await pc.setRemoteDescription(p.sdp as RTCSessionDescriptionInit)
        for (const x of c.queue.splice(0)) await pc.addIceCandidate(x).catch(() => undefined)
        await pc.setLocalDescription(await pc.createAnswer())
        signal.send('answer', { session: id, sdp: { type: pc.localDescription!.type, sdp: pc.localDescription!.sdp } })
      } else if (event === 'ice' && p.from === 'device' && p.candidate) {
        const cand = p.candidate as RTCIceCandidateInit
        if (c.pc?.remoteDescription) await c.pc.addIceCandidate(cand).catch(() => undefined)
        else c.queue.push(cand)
      }
    }, (s) => {
      if (s !== 'joined' || phaseRef.current !== 'connecting') return
      go('calling')
      // asked again every few seconds until the program says it got it; nobody there → it gives up
      const request = () => signal.send('request', { session: id, mode: start.mode })
      signal.send('hello', {}); request()
      ask = window.setInterval(request, 3000)
      giveUp = window.setTimeout(() => finish('offline'), 45_000)
    })
    c.signal = signal
    const bye = () => { signal.send('end', { session: id }); void supportEnd(id) }
    window.addEventListener('beforeunload', bye)
    return () => {
      window.removeEventListener('beforeunload', bye)
      window.clearInterval(ask); window.clearTimeout(giveUp)
      c.pc?.close(); c.pc = null
      const wasOpen = !DONE.includes(phaseRef.current)
      if (wasOpen) signal.send('end', { session: id })
      signal.close(); c.signal = null; c.closed = true
      if (wasOpen) c.leaving = window.setTimeout(() => void supportEnd(id), 300)
    }
  }, [start, go])

  React.useEffect(() => { if (phase !== 'live') return; const i = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(i) }, [phase])

  const end = () => {
    ctl.current.signal?.send('end', { session: start.session })
    ctl.current.pc?.close(); ctl.current.pc = null
    if (video.current) video.current.srcObject = null
    if (!DONE.includes(phaseRef.current)) void supportEnd(start.session)
    go('ended')
  }
  const again = async () => {
    setRetrying(true)
    try { const r = await supportStart(start.device.id); navigate(`/platform/support/${r.session}`, { replace: true, state: r }) }
    catch (e) { toast.error(tServer(describeError(e))) } finally { setRetrying(false) }
  }
  const secs = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0
  const done = DONE.includes(phase)

  return (
    <div className="-mx-3 -my-4 flex min-h-[calc(100dvh-52px)] flex-col sm:-mx-6 sm:-my-6">
      <div className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-2.5 sm:px-6">
        <MonitorSmartphone className="size-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold">{start.device.label} · {start.device.name}</h1>
          <p className="truncate text-[12px] text-muted-foreground">{start.device.company}{size ? ` · ${size}` : ''}</p>
        </div>
        <StatusPill phase={phase} online={online} secs={secs} />
        {phase === 'live' && <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium', control ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
          <MousePointer2 className="size-3.5" />{control ? t('You control it: click on the picture') : t('Viewing only: the person allowed no control')}</span>}
        <div className="ml-auto flex items-center gap-2">
          {phase === 'live' && <Button variant="outline" size="sm" onClick={() => void stage.current?.requestFullscreen?.()}><Expand /> {t('Full screen')}</Button>}
          {done
            ? <Button size="sm" loading={retrying} onClick={() => void again()}><RotateCcw /> {t('Connect again')}</Button>
            : <Button size="sm" variant="destructive" onClick={end}><PhoneOff /> {t('End|support')}</Button>}
        </div>
      </div>
      <div ref={stage} className="relative grid flex-1 place-items-center bg-[#0d1117]">
        <video ref={video} muted playsInline autoPlay className={cn('absolute inset-0 size-full object-contain', phase !== 'live' && 'invisible')} />
        {phase === 'live' && control && <ControlLayer video={video} send={(ev) => { const ch = dc.current; if (ch?.readyState === 'open') ch.send(JSON.stringify(ev)) }} />}
        {phase !== 'live' && <StatePanel phase={phase} online={online} />}
      </div>
    </div>
  )
}

function StatusPill({ phase, online, secs }: { phase: Phase; online: boolean; secs: number }) {
  const live = phase === 'live'
  const label = live ? `${t('Watching')} · ${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`
    : DONE.includes(phase) ? t('Not connected') : online ? t('The program is online') : t('Connecting…')
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium',
      live ? 'bg-destructive/10 text-destructive' : DONE.includes(phase) ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary')}>
      <span className={cn('size-2 rounded-full', live ? 'animate-pulse bg-destructive' : DONE.includes(phase) ? 'bg-muted-foreground/50' : 'bg-primary')} />
      <span className="tabular">{label}</span>
    </span>
  )
}

function StatePanel({ phase, online }: { phase: Phase; online: boolean }) {
  const S: Record<Exclude<Phase, 'live'>, { icon: React.ElementType; title: string; text: string; spin?: boolean }> = {
    connecting: { icon: Loader2, spin: true, title: t('Connecting…'), text: t('Opening the line to the computer.') },
    calling: { icon: Loader2, spin: true, title: online ? t('The program is online') : t('Calling the computer…'), text: t('The DrisPRO program on that computer is being asked.') },
    asking: { icon: ShieldCheck, title: t('Waiting for the person at the computer'), text: t('A question is on their screen: allow viewing or refuse. Nothing is shown until they allow it.') },
    joining: { icon: Loader2, spin: true, title: t('Allowed. The picture is coming…'), text: t('The two computers are finding each other.') },
    declined: { icon: Ban, title: t('The person at the computer refused'), text: t('Nothing was shown. Call them before asking again.') },
    unanswered: { icon: Clock, title: t('Nobody answered'), text: t('The question stayed on the screen with no answer and closed by itself.') },
    offline: { icon: WifiOff, title: t('The computer did not answer'), text: t('The DrisPRO program may be closed, the computer off or without internet, or its program older than version 1.9.') },
    busy: { icon: MonitorSmartphone, title: t('Someone else is connected'), text: t('Another support session is open on this computer.') },
    invalid: { icon: Ban, title: t('The request was not confirmed'), text: t('The server did not confirm this request to the computer. Start again from the list.') },
    failed: { icon: WifiOff, title: t('The picture could not get through'), text: t('The two networks did not let the computers meet. A TURN server (Computers › Connection settings) makes it work from anywhere.') },
    ended: { icon: MonitorOff, title: t('The session ended'), text: t('The screen is no longer shared. It is in the diary.') },
  }
  const s = S[phase as Exclude<Phase, 'live'>]
  const Icon = s.icon
  return (
    <div className="grid max-w-md place-items-center gap-2 px-6 text-center text-white">
      <Icon className={cn('size-9 text-white/80', s.spin && 'animate-spin')} />
      <p className="text-[16px] font-semibold">{s.title}</p>
      <p className="text-[13px] text-white/70">{s.text}</p>
    </div>
  )
}

/**
 * Over the picture: the mouse and keyboard of the support person, sent to the computer. Positions are shares
 * of the picture (0–1), so the size of either screen does not matter; the black bands around it send nothing.
 */
function ControlLayer({ video, send }: { video: React.RefObject<HTMLVideoElement | null>; send: (ev: Record<string, unknown>) => void }) {
  const layer = React.useRef<HTMLDivElement>(null)
  const last = React.useRef(0)
  React.useEffect(() => { layer.current?.focus() }, [])
  const at = (e: React.MouseEvent | React.WheelEvent) => {
    const v = video.current
    if (!v || !v.videoWidth) return null
    const r = v.getBoundingClientRect()
    const k = Math.min(r.width / v.videoWidth, r.height / v.videoHeight)
    const w = v.videoWidth * k, h = v.videoHeight * k
    const x = (e.clientX - r.left - (r.width - w) / 2) / w, y = (e.clientY - r.top - (r.height - h) / 2) / h
    return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x, y }
  }
  const move = (e: React.MouseEvent, force = false) => {
    const now = performance.now()
    if (!force && now - last.current < 30) return
    last.current = now
    const p = at(e); if (p) send({ t: 'm', ...p })
  }
  const button = (e: React.MouseEvent, up: boolean) => {
    e.preventDefault(); layer.current?.focus()
    if (![0, 1, 2].includes(e.button)) return
    move(e, true); send({ t: 'b', b: e.button === 2 ? 2 : e.button === 1 ? 1 : 0, up })
  }
  const key = (e: React.KeyboardEvent, up: boolean) => {
    // the Windows key stays on this side; a plain character goes as text, the rest as keys
    if (e.key === 'Meta' || e.code.startsWith('Meta') || e.code.startsWith('OS')) return
    e.preventDefault()
    if (!up && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { send({ t: 'c', ch: e.key }); return }
    if (up && e.key.length === 1 && !e.ctrlKey && !e.altKey) return
    send({ t: 'k', code: e.code, up })
  }
  return (
    <div ref={layer} tabIndex={0} aria-label={t('The remote computer: mouse and keyboard go to it')}
      className="absolute inset-0 cursor-crosshair outline-none"
      onMouseMove={(e) => move(e)} onMouseDown={(e) => button(e, false)} onMouseUp={(e) => button(e, true)}
      onContextMenu={(e) => e.preventDefault()} onAuxClick={(e) => e.preventDefault()}
      onWheel={(e) => { const p = at(e); if (p) send({ t: 'w', dy: e.deltaY, dx: e.deltaX }) }}
      onKeyDown={(e) => key(e, false)} onKeyUp={(e) => key(e, true)} />
  )
}
