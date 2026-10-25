import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export interface PlatformClient {
  id: string
  name: string
  legal_name: string | null
  country_code: string
  tax_number: string | null
  created_at: string
  plan: string | null
  licence_code?: string | null
  deployment?: 'any' | 'cloud' | 'local' | null
  local_seen_at?: string | null
  max_users: number | null
  extra_features?: string[] | null
  max_warehouses?: number | null
  valid_from: string | null
  valid_until: string | null
  status: 'active' | 'suspended' | null
  notes: string | null
  users: number
  admins: string[]
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
  return () => Promise.all([qc.invalidateQueries({ queryKey: KEY }), qc.invalidateQueries({ queryKey: ['my-context'] })])
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
      if (v.extra_features) {
        unwrap(await supabase.rpc('platform_set_plan_extras', { p_company: v.company, p_extra: v.extra_features, p_max_warehouses: (v.max_warehouses ?? null) as unknown as number }))
      }
    },
    onSuccess: refresh,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useSetSyncActive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; active: boolean }) => unwrap(await supabase.rpc('sync_set_active', { p_id: v.id, p_active: v.active })),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteClient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { company: string; name: string; deleteUsers: boolean }) =>
      unwrap(await supabase.rpc('platform_delete_client', { p_company: v.company, p_confirm_name: v.name, p_delete_users: v.deleteUsers })) as unknown as { rows: number; users_deleted: number },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
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
