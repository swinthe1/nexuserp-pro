import { CheckCircle2, ChevronDown, Circle, Clock, GraduationCap, Hand, ListChecks, PlayCircle, Target } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import { type Lesson, lessonHref, nextLesson, TRACKS } from '@/i18n/help/training'
import { cn } from '@/lib/utils'
import { useMarkLesson, useMyTracks, useMyTraining } from './api'
import { LessonCheck, usePickL } from './lesson-check'

/**
 * The training: paths of short lessons for my work. Each lesson says what you will be able to do, its steps,
 * a small task to try and one question; "Start" opens the page itself with its explanation and "Show me".
 */
export function TrainingPage() {
  const pick = usePickL()
  const navigate = useNavigate()
  const done = useMyTraining()
  const mark = useMarkLesson()
  const [all, setAll] = React.useState(false)
  const mine = useMyTracks(false)
  const every = useMyTracks(true)
  const tracks = all ? every : mine
  const finishedSet = done.data ?? new Set<string>()
  const lessons = tracks.flatMap((tr) => tr.lessons)
  const total = lessons.length
  const finished = lessons.filter((l) => finishedSet.has(l.key)).length
  const next = nextLesson(tracks, finishedSet)
  const [openKey, setOpenKey] = React.useState<string | null>(null)
  React.useEffect(() => { if (next && openKey === null && done.data) setOpenKey(next.key) }, [next, openKey, done.data])

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('Training|menu')}
        description={t('Short lessons for your work. Each one says what you will learn, opens the page itself and shows you where to click; one question at the end checks it.')}
        actions={every.length > mine.length ? <div className="flex items-center gap-2"><Switch id="tr-all" checked={all} onCheckedChange={setAll} /><Label htmlFor="tr-all" className="text-[13px]">{t('Show every role')}</Label></div> : undefined} />
      {done.isLoading ? <Skeleton className="h-64" /> : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4">
            <GraduationCap className="size-8 shrink-0 text-primary" />
            <div className="min-w-[200px] flex-1">
              <div className="text-sm font-semibold">{finished === total ? t('Training finished. Well done!') : t('{done} of {total} lessons done', { done: finished, total })}</div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${total ? (finished / total) * 100 : 0}%` }} /></div>
            </div>
            {next && (
              <Button onClick={() => navigate(lessonHref(next))}>
                <PlayCircle /> {finished ? t('Continue: {lesson}', { lesson: pick(next.title) }) : t('Start the training')}
              </Button>
            )}
          </div>
          <div className="grid gap-4">
            {tracks.map((tr) => {
              const n = tr.lessons.filter((l) => finishedSet.has(l.key)).length
              return (
                <Card key={tr.key}>
                  <CardHeader className="gap-2 space-y-0 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div><CardTitle>{pick(tr.title)}</CardTitle><CardDescription>{pick(tr.who)}</CardDescription></div>
                      <span className="shrink-0 text-xs text-muted-foreground tabular">{n}/{tr.lessons.length} · {t('{n} min', { n: tr.lessons.reduce((s, l) => s + l.minutes, 0) })}</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(n / tr.lessons.length) * 100}%` }} /></div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ol className="divide-y border-t">
                      {tr.lessons.map((l, i) => (
                        <LessonRow key={l.key} lesson={l} n={i + 1} ok={finishedSet.has(l.key)} open={openKey === l.key}
                          onToggle={() => setOpenKey(openKey === l.key ? '' : l.key)}
                          onMark={(v) => mark.mutate({ lesson: l.key, done: v })}
                          onStart={() => navigate(lessonHref(l))} />
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              )
            })}
          </div>
          {all && every.length < TRACKS.length && <p className="mt-4 text-center text-xs text-muted-foreground">{t('Paths for modules your licence does not have are not shown.')}</p>}
        </>
      )}
    </div>
  )
}

function LessonRow({ lesson: l, n, ok, open, onToggle, onMark, onStart }: {
  lesson: Lesson; n: number; ok: boolean; open: boolean; onToggle: () => void; onMark: (done: boolean) => void; onStart: () => void
}) {
  const pick = usePickL()
  const id = `lesson-${l.key.replace(/\W/g, '-')}`
  return (
    <li className={cn(open && 'bg-muted/30')}>
      <div className="flex items-start gap-3 px-4 py-3">
        <button type="button" aria-label={ok ? t('Mark as not done') : t('Mark as done')} onClick={() => onMark(!ok)} className="mt-0.5 shrink-0">
          {ok ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-muted-foreground/50" />}
        </button>
        <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <span className={cn('flex items-center gap-1.5 text-[14px] font-semibold', ok && 'text-muted-foreground')}>
            {n}. {pick(l.title)}
            <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </span>
          <span className="block text-[13px] text-muted-foreground">{pick(l.why)}</span>
        </button>
        <span className="hidden shrink-0 items-center gap-1 pt-0.5 text-xs text-muted-foreground sm:flex"><Clock className="size-3.5" />{t('{n} min', { n: l.minutes })}</span>
        <Button size="sm" variant={ok ? 'ghost' : 'outline'} className="shrink-0" onClick={onStart}>
          <PlayCircle /> {ok ? t('Again') : t('Start|lesson')}
        </Button>
      </div>
      {open && (
        <div id={id} className="grid gap-4 px-4 pb-4 pl-12 text-[13.5px] leading-relaxed md:grid-cols-2">
          <div className="grid content-start gap-3">
            <p className="flex items-start gap-2"><Target className="mt-0.5 size-4 shrink-0 text-primary" /><span><span className="font-semibold">{t('You will learn')}:</span> {pick(l.goal)}</span></p>
            <div>
              <p className="mb-1.5 flex items-center gap-2 font-semibold"><ListChecks className="size-4 text-primary" />{t('Step by step')}</p>
              <ol className="grid gap-1.5">
                {l.steps.map((s, i) => <li key={i} className="flex gap-2.5"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{i + 1}</span><span>{pick(s)}</span></li>)}
              </ol>
            </div>
            {l.practice && <p className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 p-2.5"><Hand className="mt-0.5 size-4 shrink-0 text-primary" /><span>{pick(l.practice)}</span></p>}
            <Button className="justify-self-start" onClick={onStart}><PlayCircle /> {t('Open the page and start')}</Button>
          </div>
          {l.check && (
            <div className="rounded-lg border bg-card p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">{t('Check yourself')}</p>
              <LessonCheck key={l.key} check={l.check} done={ok} onRight={() => { if (!ok) onMark(true) }} />
            </div>
          )}
        </div>
      )}
    </li>
  )
}
