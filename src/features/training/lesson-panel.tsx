import { ArrowRight, CheckCircle2, GraduationCap, Hand, MousePointerClick, Target } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { type Lesson, lessonHref, nextLesson } from '@/i18n/help/training'
import type { TourStep } from '@/i18n/help/types'
import { useMarkLesson, useMyTracks, useMyTraining } from './api'
import { LessonCheck, usePickL } from './lesson-check'

/**
 * The lesson, on top of the page's explanation when it was opened from the training: what you will learn,
 * the steps, "Show me", a small task and the question; when it is answered, the next lesson is one click away.
 */
export function LessonPanel({ lesson, tour, onShowMe, onTry, onGo }: {
  lesson: Lesson; tour: TourStep[] | null
  onShowMe: () => void
  /** close the panel and try on the page (the lesson stays open under the ⓘ) */
  onTry: () => void
  /** close the panel and go to an address */
  onGo: (href: string) => void
}) {
  const pick = usePickL()
  const mark = useMarkLesson()
  const done = useMyTraining()
  const tracks = useMyTracks(false)
  const was = !!done.data?.has(lesson.key)
  const [passed, setPassed] = React.useState(was)
  const after = new Set(done.data ?? []); after.add(lesson.key)
  const next = nextLesson(tracks, after, lesson.key)
  const finish = () => { setPassed(true); if (!was) mark.mutate({ lesson: lesson.key, done: true }) }
  return (
    <section className="grid gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold"><GraduationCap className="size-5 text-primary" /> {pick(lesson.title)}</h3>
      <p className="flex items-start gap-2"><Target className="mt-0.5 size-4 shrink-0 text-primary" /><span><span className="font-semibold">{t('You will learn')}:</span> {pick(lesson.goal)}</span></p>
      <ol className="grid gap-1.5">
        {lesson.steps.map((s, i) => (
          <li key={i} className="flex gap-2.5"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">{i + 1}</span><span>{pick(s)}</span></li>
        ))}
      </ol>
      {lesson.practice && <p className="flex items-start gap-2 rounded-lg bg-background/70 p-2.5"><Hand className="mt-0.5 size-4 shrink-0 text-primary" /><span>{pick(lesson.practice)}</span></p>}
      <div className="flex flex-wrap gap-2">
        {!!tour?.length && <Button size="sm" onClick={onShowMe}><MousePointerClick /> {t('Show me on the page')}</Button>}
        <Button size="sm" variant="outline" onClick={onTry}>{t('Try it on the page first')}</Button>
      </div>
      <div className="rounded-lg border bg-card p-3">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{lesson.check ? t('Check yourself') : t('Done with it?')}</p>
        {lesson.check
          ? <LessonCheck check={lesson.check} done={was} onRight={finish} />
          : !passed && <Button size="sm" loading={mark.isPending} onClick={finish}><CheckCircle2 /> {t('Lesson done')}</Button>}
        {passed && (
          <div className="mt-3 flex flex-wrap gap-2">
            {next
              ? <Button size="sm" onClick={() => onGo(lessonHref(next))}>{t('Next lesson: {lesson}', { lesson: pick(next.title) })} <ArrowRight /></Button>
              : <p className="text-[13px] font-semibold text-success">{t('Training finished. Well done!')}</p>}
            <Button size="sm" variant="ghost" onClick={() => onGo('/training')}>{t('Back to the training')}</Button>
          </div>
        )}
      </div>
    </section>
  )
}
