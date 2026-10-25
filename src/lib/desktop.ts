/** The Windows program (desktop/) gives the page a few things a browser cannot: see window.drisproDesktop. */
export interface DesktopSettings {
  licence: string; mode: 'cloud' | 'local' | ''; company: string
  server: string; receiptPrinter: string; kitchenPrinter: string; documentPrinter: string; paperWidth: number
  drawer: { mode: 'none' | 'network'; host: string; port: number }; autoStart: boolean; fullScreen: boolean
}
export interface DrisproDesktop {
  isDesktop: true
  info: () => Promise<{ version: string; platform: string; server: string }>
  printers: () => Promise<{ name: string; isDefault: boolean; description: string }[]>
  print: (html: string, kind: PrintKind) => Promise<{ ok: boolean; printer: string | null; silent: boolean }>
  openDrawer: () => Promise<{ ok: boolean; reason?: string }>
  settings: () => Promise<DesktopSettings>
  saveSettings: (s: Partial<DesktopSettings>) => Promise<boolean>
  setServer: (url: string) => Promise<boolean>
  /** back to the licence page: another licence, or cloud ↔ local server */
  reactivate?: () => Promise<boolean>
}
export type PrintKind = 'receipt' | 'kitchen' | 'document'

// a Windows program installed before the rename still offers itself under its older name
const w = typeof window !== 'undefined' ? (window as unknown as Record<string, DrisproDesktop | undefined>) : undefined
export const desktop: DrisproDesktop | undefined = w ? (w.drisproDesktop ?? w['nexus' + 'Desktop']) : undefined
export const isDesktop = !!desktop
