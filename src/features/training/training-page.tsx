import { CheckCircle2, Circle, Clock, GraduationCap, PlayCircle } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { t, useLocale } from '@/i18n'
import { TRACKS, tracksFor } from '@/i18n/help/training'
import { cn } from '@/lib/utils'
import { useMarkLesson, useMyTraining } from './api'

/** Lessons for my kind of work: each opens a page with its explanation and "Show me" */
export function TrainingPage() {
  const { company } = useCompany()
  const locale = useLocale()
  const pick = (x: { sq: string; en: string }) => (locale === 'sq' ? x.sq : x.en)
  const navigate = useNavigate()
  const done = useMyTraining()
  const mark = useMarkLesson()
  const [all, setAll] = React.useState(false)
  const mine = tracksFor(company?.roles ?? [])
  const tracks = all ? TRACKS : mine
  const total = tracks.reduce((s, tr) => s + tr.lessons.length, 0)
  const finished = tracks.reduce((s, tr) => s + tr.lessons.filter((l) => done.data?.has(l.key)).length, 0)
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('Training|menu')}
        description={t('Short lessons for your work. Each one opens the page itself, explains it step by step and shows you where to click. Tick it when you are done.')}
        actions={mine.length < TRACKS.length ? <div className="flex items-center gap-2"><Switch id="tr-all" checked={all} onCheckedChange={setAll} /><Label htmlFor="tr-all" className="text-[13px]">{t('Show every role')}</Label></div> : undefined} />
      {done.isLoading ? <Skeleton className="h-64" /> : (
        <>
          <div className="mb-5 flex items-center gap-4 rounded-xl border bg-card p-4">
            <GraduationCap className="size-8 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{finished === total ? t('Training finished. Well done!') : t('{done} of {total} lessons done', { done: finished, total })}</div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${total ? (finished / total) * 100 : 0}%` }} /></div>
            </div>
          </div>
          <div className="grid gap-4">
            {tracks.map((tr) => {
              const n = tr.lessons.filter((l) => done.data?.has(l.key)).length
              return (
                <Card key={tr.key}>
                  <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
                    <div><CardTitle>{pick(tr.title)}</CardTitle><CardDescription>{pick(tr.who)}</CardDescription></div>
                    <span className="shrink-0 text-xs text-muted-foreground tabular">{n}/{tr.lessons.length} · {t('{n} min', { n: tr.lessons.reduce((s, l) => s + l.minutes, 0) })}</span>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ol className="divide-y border-t">
                      {tr.lessons.map((l, i) => {
                        const ok = !!done.data?.has(l.key)
                        return (
                          <li key={l.key} className="flex items-start gap-3 px-4 py-3">
                            <button type="button" aria-label={ok ? t('Mark as not done') : t('Mark as done')} onClick={() => mark.mutate({ lesson: l.key, done: !ok })} className="mt-0.5 shrink-0">
                              {ok ? <CheckCircle2 className="size-5 text-success" /> : <Circle className="size-5 text-muted-foreground/50" />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className={cn('text-[14px] font-medium', ok && 'text-muted-foreground')}>{i + 1}. {pick(l.title)}</div>
                              <div className="text-[13px] text-muted-foreground">{pick(l.why)}</div>
                            </div>
                            <span className="hidden shrink-0 items-center gap-1 pt-0.5 text-xs text-muted-foreground sm:flex"><Clock className="size-3.5" />{t('{n} min', { n: l.minutes })}</span>
                            <Button size="sm" variant={ok ? 'ghost' : 'outline'} className="shrink-0" onClick={() => navigate(`${l.href}?learn=${encodeURIComponent(l.key)}`)}>
                              <PlayCircle /> {ok ? t('Again') : t('Start|lesson')}
                            </Button>
                          </li>
                        )
                      })}
                    </ol>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
