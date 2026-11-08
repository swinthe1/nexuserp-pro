import { ArrowLeftRight, BadgeDollarSign, BedDouble, BookOpenCheck, CalendarClock, Boxes, Building2, BarChart3, Factory, LayoutDashboard, type LucideIcon, Percent, ScanLine, ShoppingCart, Store, Truck, Users, Wallet } from 'lucide-react'
import { NAV } from '@/app/nav'

/**
 * Each part of the menu has its own icon and colour, so a page always shows where it belongs.
 * The colour is a hue and saturation (`--mod`); the lightness comes from where it sits (`--mod-l`:
 * darker on white pages, lighter in the ink menu and the dark look).
 */
export interface ModuleLook { icon: LucideIcon; hue: string }

export const MODULES: Record<string, ModuleLook> = {
  Overview: { icon: LayoutDashboard, hue: '158 82%' },
  'Sell|menu': { icon: BadgeDollarSign, hue: '204 82%' },
  Retail: { icon: Store, hue: '330 70%' },
  'Buy|menu': { icon: ShoppingCart, hue: '262 60%' },
  'Inventory|menu': { icon: Boxes, hue: '152 68%' },
  Money: { icon: Wallet, hue: '172 72%' },
  'Taxes and books': { icon: Percent, hue: '350 70%' },
  Accounting: { icon: BookOpenCheck, hue: '196 70%' },
  Appointments: { icon: CalendarClock, hue: '290 58%' },
  Hotel: { icon: BedDouble, hue: '42 88%' },
  'Internal moves': { icon: ArrowLeftRight, hue: '120 45%' },
  Manufacturing: { icon: Factory, hue: '18 82%' },
  Logistics: { icon: Truck, hue: '188 78%' },
  'Warehouse|menu': { icon: ScanLine, hue: '32 90%' },
  People: { icon: Users, hue: '232 62%' },
  'Reports|menu': { icon: BarChart3, hue: '48 80%' },
  Company: { icon: Building2, hue: '210 18%' },
}

export const moduleLook = (section: string | undefined): ModuleLook => MODULES[section ?? ''] ?? MODULES.Overview

/** the menu section and page a URL belongs to: the longest matching menu link wins */
export function sectionOf(pathname: string): { section: string; icon: LucideIcon } | null {
  let best: { section: string; icon: LucideIcon; len: number } | null = null
  for (const s of NAV) {
    for (const i of s.items) {
      const path = i.href.split('?')[0]
      const ok = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`)
      if (ok && (!best || path.length > best.len)) best = { section: s.label, icon: i.icon, len: path.length }
    }
  }
  return best && { section: best.section, icon: best.icon }
}
