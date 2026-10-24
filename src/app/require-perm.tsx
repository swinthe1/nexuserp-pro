import { Lock } from 'lucide-react'
import * as React from 'react'
import { Outlet } from 'react-router-dom'
import { useCompany } from '@/app/company-provider'
import { EmptyState } from '@/components/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { t } from '@/i18n'

export function PageFallback() {
  return <div className="grid gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-[420px]" /></div>
}

/** Blocks a route when the user lacks the permission (RLS would return nothing anyway) */
export function RequirePerm({ perm, anyOf }: { perm: string; anyOf?: string[] }) {
  const { can } = useCompany()
  const ok = anyOf ? anyOf.some((p) => can(p)) : can(perm)
  if (!ok) return <EmptyState icon={Lock} title={t("You don't have access to this page")} description={t('Ask a company admin to give your role access to it.')} />
  return <React.Suspense fallback={<PageFallback />}><Outlet /></React.Suspense>
}

/** Route-level code splitting: each module loads on first visit */
export const lazyPage = <T,>(load: () => Promise<T>, name: keyof T) =>
  React.lazy(() => load().then((m) => ({ default: m[name] as unknown as React.ComponentType })))
