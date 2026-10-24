import { House, RotateCw, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'

const isChunkError = (e: Error) => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(e.message)

/**
 * Catches a crash in one page so the menu and the rest of the app keep working.
 * Re-keyed on navigation by the layout, so moving to another page clears it.
 * After an update, an old tab may ask for files that no longer exist — then reloading fixes it.
 */
export class PageErrorBoundary extends React.Component<{ children: React.ReactNode; fullScreen?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error('[page]', error) }
  render() {
    const e = this.state.error
    if (!e) return this.props.children
    const update = isChunkError(e)
    return (
      <div role="alert" className={this.props.fullScreen ? 'flex min-h-dvh items-center justify-center p-6' : 'py-16'}>
        <div className="mx-auto flex max-w-md flex-col items-center gap-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive"><TriangleAlert className="size-5" /></span>
          <p className="text-sm font-medium">{update ? t('A new version of the app is ready') : t('This page ran into a problem')}</p>
          <p className="text-[13px] text-muted-foreground">
            {update ? t('Reload to continue with the latest version.') : t('Your data is safe. Reload the page, or go back to the dashboard and try again.')}
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => location.reload()}><RotateCw /> {t('Reload')}</Button>
            {!update && <Button size="sm" variant="outline" onClick={() => { location.href = '/' }}><House /> {t('Go to the dashboard')}</Button>}
          </div>
          {!update && <details className="mt-3 max-w-full text-left text-xs text-muted-foreground"><summary className="cursor-pointer">{t('Technical details')}</summary><pre className="mt-1 whitespace-pre-wrap break-words">{e.message}</pre></details>}
        </div>
      </div>
    )
  }
}
