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
  /** printer: a printer by its name (a restaurant station's), from version 1.7; older versions use the kind's */
  print: (html: string, kind: PrintKind, printer?: string | null) => Promise<{ ok: boolean; printer: string | null; silent: boolean }>
  openDrawer: () => Promise<{ ok: boolean; reason?: string }>
  settings: () => Promise<DesktopSettings>
  saveSettings: (s: Partial<DesktopSettings>) => Promise<boolean>
  setServer: (url: string) => Promise<boolean>
  /** back to the licence page: another licence, or cloud ↔ local server */
  reactivate?: () => Promise<boolean>
  /** the files the program saved (from version 1.6) */
  downloads?: () => Promise<DesktopDownload[]>
  showInFolder?: (path: string) => Promise<boolean>
  openFile?: (path: string) => Promise<boolean>
  onDownloaded?: (cb: (d: DesktopDownload) => void) => () => void
}
export type DesktopDownload = { name: string; path: string; at: number; size: number }
export type PrintKind = 'receipt' | 'kitchen' | 'document'

// a Windows program installed before the rename still offers itself under its older name
const w = typeof window !== 'undefined' ? (window as unknown as Record<string, DrisproDesktop | undefined>) : undefined
export const desktop: DrisproDesktop | undefined = w ? (w.drisproDesktop ?? w['nexus' + 'Desktop']) : undefined
export const isDesktop = !!desktop
