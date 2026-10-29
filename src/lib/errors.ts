import type { PostgrestError } from '@supabase/supabase-js'
import { t, tServer } from '@/i18n'

/**
 * Turns database / PostgREST errors into a sentence a user can act on.
 * Business-rule errors raised by our SQL functions are already written for
 * people (in English), so they are translated through the server message
 * catalog; constraint violations get a plain sentence.
 */
export function describeError(error: unknown): string {
  if (!error) return t('Something went wrong. Try again.')
  if (typeof error === 'string') return tServer(error)
  const e = error as Partial<PostgrestError> & { message?: string }
  const msg = e.message ?? ''
  if (!msg && !e.code) return t('Something went wrong. Try again.')
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return t('No connection. Check the internet and try again.')
  switch (e.code) {
    case '23505':
      if (msg.includes('_code_key') || msg.includes('_sku_key')) return t('That code is already used by another record.')
      if (msg.includes('barcodes_key')) return t('That barcode is already assigned to another product.')
      if (msg.includes('vendor_invoice')) return t('This vendor invoice number has already been entered.')
      return msg.includes('duplicate key') ? t('A record with these values already exists.') : tServer(msg)
    case '23503':
      return msg.includes('foreign key') ? t('This refers to a record that no longer exists, or is still used elsewhere.') : tServer(msg)
    case '42501':
      return msg.startsWith('Permission denied') || msg.includes('row-level security')
        ? t("You don't have permission to do this. Ask a company admin for access.")
        : tServer(msg)
    case 'PGRST202':   // the app is newer than the database: the server's update (database part) has not run yet
    case 'PGRST205':
    case '42883':
      return t('This part needs the latest server update. The administrator runs the server update and it works.')
    case '57014':     // the server's time limit
      return t('This took longer than the server allows and nothing was changed. Try again; if it happens again, tell the administrator.')
    case 'PGRST301':
    case '401':
      return t('Your session has expired. Sign in again.')
    default:
      return tServer(msg)
  }
}

/** Throws the Supabase error so TanStack Query treats it as a failure */
export function unwrap<T>(res: { data: T; error: PostgrestError | null }): NonNullable<T> {
  if (res.error) throw res.error
  return res.data as NonNullable<T>
}
