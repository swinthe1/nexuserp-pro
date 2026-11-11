import type { NavItem } from '@/app/nav'

/** one line in the side menu: a page on its own, or the pages that share a hub (shown as tabs inside) */
export interface MenuEntry { key: string; label: string; href: string; icon: NavItem['icon']; items: NavItem[] }

/**
 * Every page is its own line in the side menu again (the owner's decision, 11.11.2026): the tabs at the top of the pages
 * that shared one entry are gone. The one entry that stays joined is the one the owner asked to have in one place.
 */
const JOINED = new Set(['Books check'])
/** the entry a page shares with others, when it still does */
export const hubOf = (i: NavItem): string | undefined => (i.hub && JOINED.has(i.hub) ? i.hub : undefined)

/** the entries of a part of the menu, from the pages this person sees (in their order) */
export function menuEntries(items: NavItem[]): MenuEntry[] {
  const out: MenuEntry[] = []
  const byHub = new Map<string, MenuEntry>()
  for (const i of items) {
    const hub = hubOf(i)
    if (hub) {
      const e = byHub.get(hub)
      if (e) { e.items.push(i); continue }
      const n: MenuEntry = { key: `hub:${hub}`, label: hub, href: i.href, icon: i.icon, items: [i] }
      byHub.set(hub, n); out.push(n)
    } else {
      out.push({ key: i.href, label: i.label, href: i.href, icon: i.icon, items: [i] })
    }
  }
  // a hub with one page this person may open is that page, by its own name
  return out.map((e) => (e.items.length === 1 ? { ...e, key: e.items[0]!.href, label: e.items[0]!.label } : e))
}
