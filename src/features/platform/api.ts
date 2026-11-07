import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export interface PlatformClient {
  id: string
  /** one unit (false), several (true), not said (null: as many as it has) */
  multi_unit?: boolean | null
  /** active units (shops, warehouses…) */
  units?: number
  name: string
  legal_name: string | null
  country_code: string
  tax_number: string | null
  created_at: string
  plan: string | null
  licence_code?: string | null
  deployment?: 'any' | 'cloud' | 'local' | null
  local_seen_at?: string | null
  local_version?: string | null
  local_url?: string | null
  has_server?: boolean
  max_users: number | null
  extra_features?: string[] | null
  max_warehouses?: number | null
  /** the business package (null: an older plan), its till limit, the tills it has, the modules it really has */
  package?: string | null
  max_registers?: number | null
  tills?: number
  modules?: string[] | null
  /** the computers licensed: tills, administration, waiting for approval */
  devices?: { till: number; office: number; pending: number } | null
  valid_from: string | null
  valid_until: string | null
  status: 'active' | 'suspended' | null
  notes: string | null
  users: number
  admins: string[]
  /** invited people still without an account */
  pending?: { member_id: string; email: string; invited_at: string; roles: string[] }[]
  last_activity: string | null
  is_training?: boolean
  business_type?: string
  sync?: SyncConnection[] | null
}

export interface SyncConnection {
  id: string
  name: string
  key_prefix: string
  is_active: boolean
  last_seen_at: string | null
  last_error: string | null
  pushes: number
  last_counts: Record<string, unknown> | null
}

export interface NewClient {
  name: string
  legal_name?: string
  country: 'XK' | 'AL'
  tax_number?: string
  owner_name?: string
  owner_email: string
  owner_password: string
  plan: string
  max_users: number
  valid_from: string
  valid_until: string
  notes?: string
  business_type: string
  /** one unit or several; with several, their names, kinds and towns */
  multi_unit: boolean
  unit_kind?: string
  units?: { name: string; kind: string; city?: string; code?: string }[]
  /** the package: its modules and limits (null limit = none) */
  package?: string
  modules?: string[]
  max_stores?: number | null
  max_tills?: number | null
}

export interface LicenseInput {
  company: string
  plan: string
  /** modules added to the plan for this client, and its own store limit (null = the plan's) */
  extra_features?: string[]
  max_warehouses?: number | null
  max_users: number
  valid_from: string
  valid_until: string
  status: 'active' | 'suspended'
  notes?: string | null
  /** a package: replaces the plan, its modules and limits */
  package?: { key: string; modules: string[]; max_stores: number | null; max_tills: number | null; apply_type: boolean } | null
}

const KEY = ['platform-clients']

export function usePlatformClients(enabled = true) {
  return useQuery({
    queryKey: KEY,
    enabled,
    queryFn: async () => unwrap(await supabase.rpc('platform_clients')) as unknown as { self_service: boolean; clients: PlatformClient[] },
  })
}

function useRefresh() {
  const qc = useQueryClient()
  return () => Promise.all([Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['platform'] })]), qc.invalidateQueries({ queryKey: ['my-context'] }), qc.invalidateQueries({ queryKey: ['platform'] })])
}

export function useCreateClient() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (v: NewClient) => unwrap(await supabase.rpc('platform_create_client', { p: { ...v } })) as unknown as string,
    onSuccess: refresh,
  })
}

export function useSaveLicense() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (v: LicenseInput) => {
      unwrap(await supabase.rpc('platform_save_license', {
        p_company: v.company, p_plan: v.plan, p_max_users: v.max_users, p_valid_from: v.valid_from,
        p_valid_until: v.valid_until, p_status: v.status, p_notes: v.notes ?? undefined,
      }))
      if (v.package) {
        unwrap(await supabase.rpc('platform_set_package', { p_company: v.company, p: { package: v.package.key, modules: v.package.modules, max_users: v.max_users,
          max_stores: v.package.max_stores, max_tills: v.package.max_tills, apply_type: v.package.apply_type } as never }))
      } else if (v.extra_features) {
        unwrap(await supabase.rpc('platform_set_plan_extras', { p_company: v.company, p_extra: v.extra_features, p_max_warehouses: (v.max_warehouses ?? null) as unknown as number }))
      }
    },
    onSuccess: refresh,
  })
}

export function useCreateAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { member: string; password: string; name?: string }) =>
      unwrap(await supabase.rpc('platform_create_account', { p_member: v.member, p_password: v.password, p_name: (v.name || null) as unknown as string })) as string,
    onSuccess: () => { void Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['platform'] })]) },
  })
}

export function useSetPassword() {
  return useMutation({
    mutationFn: async (v: { email: string; password: string }) =>
      unwrap(await supabase.rpc('platform_set_password', { p_email: v.email, p_password: v.password })),
  })
}

export function useSetSelfService() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (on: boolean) => unwrap(await supabase.rpc('platform_set_self_service', { p_on: on })),
    onSuccess: refresh,
  })
}

/** A password that is easy to read aloud or type: no look-alike letters, always with digits. */
export function generatePassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyz'
  const digits = '23456789'
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0]! % s.length]
  let p = ''
  for (let i = 0; i < 6; i++) p += pick(letters)
  for (let i = 0; i < 4; i++) p += pick(digits)
  return p.charAt(0).toUpperCase() + p.slice(1)
}

export function useCreateSyncKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { company: string; name: string }) =>
      unwrap(await supabase.rpc('sync_create_connection', { p_company: v.company, p_name: v.name })) as unknown as { id: string; key: string },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['platform'] })]),
  })
}

export function useSetSyncActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; active: boolean }) => unwrap(await supabase.rpc('sync_set_active', { p_id: v.id, p_active: v.active })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['platform'] })]),
  })
}

export function useSetTraining() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: async (v: { company: string; on: boolean }) => unwrap(await supabase.rpc('set_training_mode', { p_company: v.company, p_on: v.on })),
    onSuccess: refresh,
  })
}

export function useSetBusinessType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { company: string; type: string; applyMenu: boolean }) =>
      unwrap(await supabase.rpc('platform_set_business_type', { p_company: v.company, p_type: v.type, p_apply_menu: v.applyMenu })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['platform'] })]),
  })
}

export function useSetMultiUnit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { company: string; multi: boolean }) => unwrap(await supabase.rpc('platform_set_multi_unit', { p_company: v.company, p_multi: v.multi })),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['platform'] })]),
  })
}

export function useDeleteClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { company: string; name: string; deleteUsers: boolean }) =>
      unwrap(await supabase.rpc('platform_delete_client', { p_company: v.company, p_confirm_name: v.name, p_delete_users: v.deleteUsers })) as unknown as { rows: number; users_deleted: number },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['platform'] })]),
  })
}

export interface BackupRow { at: string; ok: boolean; kind: string; file: string | null; size_bytes: number | null; disk_free_bytes: number | null; disk_total_bytes: number | null; message: string | null }
/** The nightly database copies on the server (reported by the backup script). */
export function useBackupStatus() {
  return useQuery({
    queryKey: ['platform-backups'],
    refetchInterval: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc('platform_backup_status')) as unknown as
      { last_ok: BackupRow | null; last_failed: BackupRow | null; copies_week: number; recent: BackupRow[] },
  })
}

/* ------------------------------------------------------------------ the console */

export type PlatformEvent = { id: number; at: string; actor_email: string | null; company_id: string | null; company_name: string | null; kind: string
  details: Record<string, unknown>; company_exists?: boolean }
export type Attention = { kind: 'licence_expired' | 'licence_ending' | 'link_error' | 'link_quiet' | 'local_quiet' | 'pending_account' | 'seats_full'
  company_id: string; company_name: string; at?: string | null; days?: number; detail?: string | null; name?: string; version?: string | null; member_id?: string }
export interface PlatformOverview {
  clients: number; active: number; ending: number; expired: number; suspended: number; training: number; users: number; seats: number
  local_servers: number; local_online: number; local_versions: Record<string, number>
  income_month: number | null; priced: boolean; by_plan: Record<string, number>
  new_by_month: { month: string; n: number }[]
  links: { active: number; errors: number; quiet: number }
  reads_month: { total: number; failed: number }
  events: PlatformEvent[]; attention: Attention[]
}
export function usePlatformOverview() {
  return useQuery({ queryKey: ['platform', 'overview'], refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('platform_overview')) as unknown as PlatformOverview })
}

export type ClientMember = { member_id: string; user_id: string | null; email: string; name: string | null; status: string; last_sign_in_at: string | null
  joined_at: string | null; external_accountant: boolean; roles: string[]; role_keys: string[]; is_admin: boolean }
export interface ClientDetail {
  company: { id: string; name: string; legal_name: string | null; tax_number: string | null; vat_number: string | null; business_number: string | null
    country_code: string; base_currency: string; address: string | null; address_line1: string | null; city: string | null; phone: string | null; email: string | null; website: string | null
    created_at: string; is_training: boolean; business_type: string }
  licence: (Record<string, unknown> & { plan: string; max_users: number; valid_from: string; valid_until: string; status: string; code: string | null
    deployment: string; local_seen_at: string | null; local_version: string | null; local_url: string | null; has_server: boolean
    extra_features: string[]; max_warehouses: number | null; notes: string | null; updated_at: string }) | null
  users: number
  members: ClientMember[]
  usage: { invoices: number; invoices_month: number; bills: number; pos_month: number; products: number; partners: number; warehouses: number
    reads_month: number; last_activity: string | null; activity_by_day: { day: string; n: number }[] }
  sync: SyncConnection[]
  events: PlatformEvent[]
}
export function useClientDetail(id: string | undefined) {
  return useQuery({ queryKey: ['platform', 'client', id], enabled: !!id,
    queryFn: async () => unwrap(await supabase.rpc('platform_client_detail', { p_company: id! })) as unknown as ClientDetail })
}

export function usePlatformEvents(company?: string | null, kind?: string | null) {
  return useQuery({ queryKey: ['platform', 'events', company ?? null, kind ?? null],
    queryFn: async () => unwrap(await supabase.rpc('platform_events', { p_company: company ?? undefined, p_limit: 500, p_kind: kind ?? undefined })) as unknown as PlatformEvent[] })
}

/* ------------------------------------------------------------------ the VPS */
export type ServerDisk = { mount: string; total: number; used: number; free: number; inodes_pct?: number | null }
export type ServerCheck = { name: string; url: string; status?: number; ms?: number; ok: boolean; error?: string; cert_days?: number }
export type ServerContainer = { name: string; at: string; image: string | null; state: string; status: string | null; health: string | null; restarts: number | null
  started_at: string | null; cpu_pct: number | null; mem_bytes: number | null; mem_limit: number | null; net_io: string | null; block_io: string | null
  restart_policy?: string | null; exit_code?: number | null }
export type ServerAlert = { kind: 'monitor_quiet' | 'cpu_high' | 'mem_high' | 'disk_high' | 'check_failed' | 'cert_soon' | 'container_down' | 'container_unhealthy' | 'many_errors'
  at?: string | null; name?: string; value?: number; detail?: string | null }
export interface ServerStatus {
  last: null | { at: string; cpu_pct: number; load1: number; load5: number; load15: number; cores: number; mem_total: number; mem_available: number
    swap_total: number; swap_used: number; net_rx: number; net_tx: number; uptime_s: number; disks: ServerDisk[]; checks: ServerCheck[]
    host: { hostname?: string; os?: string; kernel?: string; docker?: string; boot?: string
      top?: { pid: number; cpu: number; mem: number; mem_bytes?: number; command: string; container_id?: string; container?: string }[] } }
  series: { at: string; cpu: number; mem: number; load: number; rx: number; tx: number }[]
  containers: ServerContainer[]
  errors: { id: number; at: string; container: string; level: 'error' | 'warn'; line: string }[]
  error_counts: Record<string, number>
  tails: { container: string; at: string }[]
  database: { version?: string; size?: number; connections?: number; active?: number; idle_in_tx?: number; max_connections?: number; longest_s?: number
    cache_hit?: number; deadlocks?: number; started_at?: string; tables?: { name: string; size: number; rows: number }[]; error?: string }
  alerts: ServerAlert[]
}
export function useServerStatus(hours = 24) {
  return useQuery({ queryKey: ['platform', 'server', hours], refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('platform_server_status', { p_hours: hours })) as unknown as ServerStatus })
}
export function useServerLog(container: string | null) {
  return useQuery({ queryKey: ['platform', 'server-log', container], enabled: !!container, refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('platform_server_log', { p_container: container! })) as unknown as { container: string; at: string; lines: string } | null })
}

/* ------------------------------------------------------------------ a client's people */
export type CompanyRole = { id: string; key: string; name: string; description: string | null }
export function useCompanyRoles(company: string | undefined) {
  return useQuery({ queryKey: ['platform', 'roles', company], enabled: !!company,
    queryFn: async () => unwrap(await supabase.rpc('platform_company_roles', { p_company: company! })) as unknown as CompanyRole[] })
}
function usePeopleAction<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['platform'] }), qc.invalidateQueries({ queryKey: KEY })]) })
}
export const useAddMember = () => usePeopleAction(async (a: { company: string; email: string; name: string; password: string; roles: string[] }) =>
  unwrap(await supabase.rpc('platform_add_member', { p_company: a.company, p_email: a.email, p_name: a.name, p_password: a.password, p_role_keys: a.roles })) as unknown as { member_id: string; new_account: boolean; email: string })
export const useMemberRoles = () => usePeopleAction(async (a: { member: string; roles: string[] }) =>
  unwrap(await supabase.rpc('platform_member_roles', { p_member: a.member, p_role_keys: a.roles })))
export const useMemberStatus = () => usePeopleAction(async (a: { member: string; status: 'active' | 'suspended' | 'removed' }) =>
  unwrap(await supabase.rpc('platform_member_status', { p_member: a.member, p_status: a.status })))
export const useUpdateCompany = () => usePeopleAction(async (a: { company: string; values: Record<string, string> }) =>
  unwrap(await supabase.rpc('platform_update_company', { p_company: a.company, p: a.values as never })))

/** the errors people met in the app, the same one counted once a day */
export type ClientError = { fingerprint: string; kind: 'error' | 'promise' | 'page' | 'chunk'; message: string; stack: string | null; url: string | null; version: string | null
  count: number; people: number; companies: string | null; first_at: string; last_at: string }
export function useClientErrors(days = 7) {
  return useQuery({ queryKey: ['platform', 'client-errors', days], refetchInterval: 120_000,
    queryFn: async () => {
      const r = await supabase.rpc('platform_client_errors' as never, { p_days: days } as never)
      if (r.error?.code === 'PGRST202') return [] as ClientError[]   // a server not updated yet
      return unwrap(r) as unknown as ClientError[]
    } })
}

/* ------------------------------------------------------------------ the computers: a licence for each */
export type PlatformDevice = { id: string; company_id: string; company: string | null; number: number; label: string; name: string; kind: 'till' | 'office'
  status: 'active' | 'pending' | 'blocked'; hostname: string | null; os: string | null; os_user: string | null; platform: string | null; app_version: string | null
  mode: string | null; server: string | null; last_ip: string | null; migrated: boolean; note: string | null; register: string | null; register_seen_at: string | null
  created_at: string; approved_at: string | null; approved_by: string | null; blocked_at: string | null; last_seen_at: string | null }
export type DeviceLimits = { till: number | null; office: number | null; approval: 'auto' | 'request'; max_till_devices: number | null; max_office_devices: number | null; max_registers: number | null }
export function usePlatformDevices(company?: string, enabled = true) {
  return useQuery({
    queryKey: ['platform', 'devices', company ?? 'all'], enabled, refetchInterval: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('platform_devices', company ? { p_company: company } : {})) as unknown as
      { devices: PlatformDevice[]; limits: DeviceLimits | null; pending: number },
  })
}
function useDevicesRefresh() {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['platform', 'devices'] }), qc.invalidateQueries({ queryKey: KEY })])
}
export function useDeviceSet() {
  const refresh = useDevicesRefresh()
  return useMutation({ mutationFn: async (a: { id: string; status?: string; name?: string; kind?: string; note?: string | null }) => {
    const { id, ...p } = a
    unwrap(await supabase.rpc('platform_device_set', { p_device: id, p: p as never }))
  }, onSuccess: refresh })
}
export function useDeviceDelete() {
  const refresh = useDevicesRefresh()
  return useMutation({ mutationFn: async (id: string) => { unwrap(await supabase.rpc('platform_device_delete', { p_device: id })) }, onSuccess: refresh })
}
export function useDeviceLimits() {
  const refresh = useDevicesRefresh()
  return useMutation({ mutationFn: async (a: { company: string; max_till_devices?: number | null; max_office_devices?: number | null; approval?: 'auto' | 'request' }) => {
    const { company, ...p } = a
    unwrap(await supabase.rpc('platform_device_limits', { p_company: company, p: p as never }))
  }, onSuccess: refresh })
}
