import { zodResolver as base } from '@hookform/resolvers/zod'
import type { FieldValues, ResolverOptions, ResolverResult } from 'react-hook-form'
import type { z } from 'zod/v3'

/*
 * The forms' schemas are written with the zod 3 way of writing ('zod/v3' inside the zod 4 package, which carries
 * the security fixes). The resolver works with them as before; only its types name zod 4, so this gives it the old ones.
 */
type Resolver = <T extends z.Schema<any, any>>(schema: T, schemaOptions?: Partial<z.ParseParams>, factoryOptions?: { mode?: 'async' | 'sync'; raw?: boolean }) =>
  <TFieldValues extends FieldValues, TContext>(values: TFieldValues, context: TContext | undefined, options: ResolverOptions<TFieldValues>) => Promise<ResolverResult<TFieldValues>>

export const zodResolver = base as unknown as Resolver
