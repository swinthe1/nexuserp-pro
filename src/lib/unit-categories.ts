import { Building2, Cake, ChefHat, Coffee, Factory, Hotel, Package, Pill, Sandwich, ShoppingBag, ShoppingCart, Warehouse, Wrench, type LucideIcon } from 'lucide-react'
import { msg } from '@/i18n'

/** What a unit is (warehouses.unit_category). The server sets the stock kind and the tills' kind from it. */
export type UnitCategory = 'market' | 'shop' | 'restaurant' | 'cafe' | 'fast_food' | 'bakery' | 'hotel' | 'pharmacy' | 'wholesale' | 'warehouse' | 'production' | 'services' | 'other'
export const UNIT_CATEGORIES: { key: UnitCategory; icon: LucideIcon; label: string; text: string; sells: boolean; restaurant: boolean }[] = [
  { key: 'market', icon: ShoppingCart, label: msg('Market or supermarket'), text: msg('Till, stock, labels and scales.'), sells: true, restaurant: false },
  { key: 'shop', icon: ShoppingBag, label: msg('Shop|unit'), text: msg('Clothes, shoes, tools, phones…: till and stock.'), sells: true, restaurant: false },
  { key: 'restaurant', icon: ChefHat, label: msg('Restaurant|unit'), text: msg('Tables, waiters, orders to the kitchen.'), sells: true, restaurant: true },
  { key: 'cafe', icon: Coffee, label: msg('Café or bar'), text: msg('Tables and quick orders at the bar.'), sells: true, restaurant: true },
  { key: 'fast_food', icon: Sandwich, label: msg('Fast food or pizzeria'), text: msg('Orders at the counter and to the kitchen.'), sells: true, restaurant: true },
  { key: 'bakery', icon: Cake, label: msg('Bakery or pastry shop'), text: msg('Sells at the till; recipes take the ingredients.'), sells: true, restaurant: false },
  { key: 'hotel', icon: Hotel, label: msg('Hotel|unit'), text: msg('Rooms and the till of the reception.'), sells: true, restaurant: false },
  { key: 'pharmacy', icon: Pill, label: msg('Pharmacy'), text: msg('Till, lots and expiry dates.'), sells: true, restaurant: false },
  { key: 'wholesale', icon: Building2, label: msg('Wholesale store'), text: msg('Invoices to businesses, and a till if it sells to people.'), sells: true, restaurant: false },
  { key: 'services', icon: Wrench, label: msg('Services|unit'), text: msg('Work and appointments, with a till for payments.'), sells: true, restaurant: false },
  { key: 'warehouse', icon: Warehouse, label: msg('Warehouse|kind'), text: msg('Keeps goods and supplies the other units. No till.'), sells: false, restaurant: false },
  { key: 'production', icon: Factory, label: msg('Kitchen or production'), text: msg('Makes products from recipes. No till.'), sells: false, restaurant: false },
  { key: 'other', icon: Package, label: msg('Other|unit'), text: msg('Any other place of the business.'), sells: true, restaurant: false },
]
export const unitCategory = (k: string | null | undefined) => UNIT_CATEGORIES.find((c) => c.key === k)
