/** The Windows program (desktop/) gives the page a few things a browser cannot: see window.nexusDesktop. */
export interface DesktopSettings {
  server: string; receiptPrinter: string; kitchenPrinter: string; documentPrinter: string; paperWidth: number
  drawer: { mode: 'none' | 'network'; host: string; port: number }; autoStart: boolean; fullScreen: boolean
}
export interface NexusDesktop {
  isDesktop: true
  info: () => Promise<{ version: string; platform: string; server: string }>
  printers: () => Promise<{ name: string; isDefault: boolean; description: string }[]>
  print: (html: string, kind: PrintKind) => Promise<{ ok: boolean; printer: string | null; silent: boolean }>
  openDrawer: () => Promise<{ ok: boolean; reason?: string }>
  settings: () => Promise<DesktopSettings>
  saveSettings: (s: Partial<DesktopSettings>) => Promise<boolean>
  setServer: (url: string) => Promise<boolean>
}
export type PrintKind = 'receipt' | 'kitchen' | 'document'

export const desktop: NexusDesktop | undefined = typeof window !== 'undefined' ? (window as unknown as { nexusDesktop?: NexusDesktop }).nexusDesktop : undefined
export const isDesktop = !!desktop
