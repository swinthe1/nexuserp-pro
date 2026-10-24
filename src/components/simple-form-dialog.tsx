import { zodResolver } from '@hookform/resolvers/zod'
import * as React from 'react'
import { useForm, type DefaultValues, type FieldValues, type Path } from 'react-hook-form'
import type { ZodType } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'

export type FieldSpec<T> = {
  name: Path<T>
  label: string
  type?: 'text' | 'number' | 'select' | 'switch' | 'color'
  options?: { value: string; label: string }[]
  placeholder?: string
  description?: string
  optional?: boolean
  half?: boolean
  uppercase?: boolean
}

/** Small RHF + Zod form in a dialog, for master-data records (warehouses, units, categories…) */
export function SimpleFormDialog<T extends FieldValues>({
  trigger, title, description, schema, defaultValues, fields, submitLabel, onSubmit, open: openProp, onOpenChange,
}: {
  trigger?: React.ReactNode
  title: string
  description?: string
  schema: ZodType<T, any, any>
  defaultValues: DefaultValues<T>
  fields: FieldSpec<T>[]
  submitLabel: string
  onSubmit: (values: T) => Promise<unknown>
  open?: boolean
  onOpenChange?: (o: boolean) => void
}) {
  const [openState, setOpenState] = React.useState(false)
  const open = openProp ?? openState
  const setOpen = onOpenChange ?? setOpenState
  const form = useForm<T>({ resolver: zodResolver(schema), defaultValues })
  React.useEffect(() => { if (open) form.reset(defaultValues) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit(async (v) => {
    try {
      await onSubmit(v)
      setOpen(false)
    } catch (e) {
      form.setError(fields[0]!.name, { message: describeError(e) })
    }
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3" noValidate>
            {fields.map((f) => (
              <FormField key={f.name} control={form.control} name={f.name} render={({ field }) => (
                <FormItem className={cn(f.half ? 'col-span-1' : 'col-span-2', f.type === 'switch' && 'flex items-center justify-between gap-2 space-y-0')}>
                  <FormLabel optional={f.optional}>{f.label}</FormLabel>
                  {f.type === 'select' ? (
                    <Select value={field.value ?? ''} onValueChange={(v) => field.onChange(v === '__none' ? null : v)}>
                      <FormControl><SelectTrigger><SelectValue placeholder={f.placeholder ?? t('Choose…')} /></SelectTrigger></FormControl>
                      <SelectContent>{f.options?.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : f.type === 'switch' ? (
                    <FormControl><Switch checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                  ) : (
                    <FormControl>
                      <Input
                        type={f.type === 'number' ? 'number' : f.type === 'color' ? 'color' : 'text'}
                        step={f.type === 'number' ? 'any' : undefined}
                        placeholder={f.placeholder}
                        className={f.type === 'color' ? 'h-9 w-16 p-1' : undefined}
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(f.uppercase ? e.target.value.toUpperCase() : e.target.value)}
                      />
                    </FormControl>
                  )}
                  {f.description && <FormDescription>{f.description}</FormDescription>}
                  <FormMessage />
                </FormItem>
              )} />
            ))}
            <DialogFooter className="col-span-2 mt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('Cancel')}</Button>
              <Button type="submit" loading={form.formState.isSubmitting}>{submitLabel}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
