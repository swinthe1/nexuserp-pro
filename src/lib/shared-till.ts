/**
 * A computer the administrator made a shared till: people sign in on it with their name and PIN.
 * The till's key stays in this browser only; the session of the person who signed in with a PIN
 * locks itself after a while without use, so the next person never works under someone else's name.
 */
const TILL = 'drispro.till'
const PIN_SESSION = 'drispro.till.session'

export type SharedTill = { token: string; name: string; company: string }

export function getTill(): SharedTill | null {
  try { const raw = localStorage.getItem(TILL); return raw ? (JSON.parse(raw) as SharedTill) : null } catch { return null }
}
export function setTill(t: SharedTill | null) {
  try { if (t) localStorage.setItem(TILL, JSON.stringify(t)); else localStorage.removeItem(TILL) } catch { /* private window */ }
}
export function markPinSession(userId: string | null) {
  try { if (userId) localStorage.setItem(PIN_SESSION, userId); else localStorage.removeItem(PIN_SESSION) } catch { /* private window */ }
}
export function isPinSession(userId: string | undefined | null) {
  try { return !!userId && localStorage.getItem(PIN_SESSION) === userId } catch { return false }
}
/** minutes without a touch or a key before a PIN session locks */
export const LOCK_AFTER_MIN = 10
