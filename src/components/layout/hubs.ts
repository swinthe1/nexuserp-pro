import type { NavItem } from '@/app/nav'

/** one line in the side menu: a page on its own, or the pages that share a hub (shown as tabs inside) */
export interface MenuEntry { key: string; label: string; href: string; icon: NavItem['icon']; items: NavItem[] }

/** the entries of a part of the menu, from the pages this person sees (in their order) */
export function menuEntries(items: NavItem[]): MenuEntry[] {
  const out: MenuEntry[] = []
  const byHub = new Map<string, MenuEntry>()
  for (const i of items) {
    if (i.hub) {
      const e = byHub.get(i.hub)
      if (e) { e.items.push(i); continue }
      const n: MenuEntry = { key: `hub:${i.hub}`, label: i.hub, href: i.href, icon: i.icon, items: [i] }
      byHub.set(i.hub, n); out.push(n)
    } else {
      out.push({ key: i.href, label: i.label, href: i.href, icon: i.icon, items: [i] })
    }
  }
  // a hub with one page this person may open is that page, by its own name
  return out.map((e) => (e.items.length === 1 ? { ...e, key: e.items[0]!.href, label: e.items[0]!.label } : e))
}
