import { GraduationCap, X } from 'lucide-react'
import * as React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { useMyTracks, useMyTraining } from './api'

/** A new person who has not started the training is invited to it once (until they start or say later) */
export function TrainingNudge() {
  const { user } = useAuth()
  const { company } = useCompany()
  const tracks = useMyTracks()
  const { pathname } = useLocation()
  const done = useMyTraining()
  const key = `drispro-training-later:${user?.id ?? ''}:${company?.id ?? ''}`
  const [later, setLater] = React.useState(() => { try { return localStorage.getItem(key) === '1' } catch { return true } })
  if (later || !done.data || done.data.size > 0 || pathname.startsWith('/training') || pathname.startsWith('/pos/till')) return null
  // the first path that is not "Getting started": that one is short and comes first anyway
  const minutes = tracks.filter((tr) => !tr.roles.includes('*')).concat(tracks).slice(0, 1).flatMap((tr) => tr.lessons).reduce((s, l) => s + l.minutes, 0)
  const dismiss = () => { try { localStorage.setItem(key, '1') } catch { /* private window */ } setLater(true) }
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-primary/20 bg-primary/5 px-4 py-2.5 text-[13px]">
      <GraduationCap className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">{t('Welcome! A short training for your work takes about {n} minutes: each lesson opens the page and shows you where to click.', { n: minutes })}</span>
      <span className="flex gap-2">
        <Button size="sm" asChild><Link to="/training">{t('Start the training')}</Link></Button>
        <Button size="sm" variant="ghost" onClick={dismiss}><X /> {t('Later')}</Button>
      </span>
    </div>
  )
}
