import * as React from 'react'
import { Card, CardContent } from '@/components/ui/card'

/** one thing the program does by itself */
export function AutomationCard({ icon: Icon, title, children, aside }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="grid gap-3 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-start sm:gap-4">
        <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary"><Icon className="size-[18px]" /></span>
        <div className="grid min-w-0 gap-3"><h2 className="text-[15px] font-semibold">{title}</h2>{children}</div>
        {aside && <div className="sm:pt-0.5">{aside}</div>}
      </CardContent>
    </Card>
  )
}
