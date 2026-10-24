import { cn } from '@/lib/utils'

/** Settings-style section: title + explanation on the left, fields on the right (stacked on mobile) */
export function FormSection({ title, description, children, className }: {
  title: string; description?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <section className={cn('grid gap-4 border-b py-6 first:pt-5 last:border-0 md:grid-cols-[220px_minmax(0,1fr)] md:gap-8', className)}>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      <div className="grid min-w-0 gap-4">{children}</div>
    </section>
  )
}
