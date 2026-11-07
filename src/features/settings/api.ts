import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { roleInPackage } from '@/lib/plans'
import type { Json, Tables, TablesUpdate } from '@/lib/database.types'
import { msg } from '@/i18n'
import { describeError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export const adminKeys = { all: (c: string) => ['admin', c] as const }
function useAction<A, R>(fn: (a: A) => Promise<R>, extraKeys: string[][] = []) {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.all(companyId) })
      for (const k of extraKeys) void qc.invalidateQueries({ queryKey: k })
    },
    onError: (e) => toast.error(describeError(e)),
  })
}

/* ------------------------------------------------------------------ company */
export type CompanyProfile = Tables<'companies'>
export type CompanySettings = Tables<'company_settings'>
export function useCompanyProfile() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...adminKeys.all(companyId), 'company'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('companies').select('*').eq('id', companyId).single()),
  })
}
export const useSaveCompanyProfile = () => {
  const { companyId, refresh } = useCompany()
  return useAction(async (v: TablesUpdate<'companies'>) => {
    unwrap(await supabase.from('companies').update(v).eq('id', companyId))
    await refresh()
  })
}
export function useCompanySettings() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...adminKeys.all(companyId), 'settings'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('company_settings').select('*').eq('company_id', companyId).single()),
  })
}
export const useSaveCompanySettings = () => {
  const { companyId } = useCompany()
  return useAction(async (v: TablesUpdate<'company_settings'>) => unwrap(await supabase.from('company_settings').update(v).eq('company_id', companyId)))
}
export function useLookups() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...adminKeys.all(companyId), 'lookups'],
    enabled: !!companyId,
    queryFn: async () => {
      const [tax, wh, tcrs] = await Promise.all([
        supabase.from('tax_codes').select('id, code, name, rate, scope').eq('company_id', companyId).is('deleted_at', null).eq('is_active', true).order('code'),
        supabase.from('warehouses').select('id, code, name').eq('company_id', companyId).is('deleted_at', null).order('code'),
        supabase.from('fiscal_tcrs').select('id, tcr_code, business_unit_code, name, status, valid_from').eq('company_id', companyId).is('deleted_at', null).order('tcr_code'),
      ])
      return { taxCodes: unwrap(tax), warehouses: unwrap(wh), tcrs: unwrap(tcrs) }
    },
  })
}

/* ------------------------------------------------------------------ users and roles */
export type CompanyUser = {
  member_id: string; user_id: string | null; email: string; full_name: string | null; status: string; joined_at: string | null
  last_sign_in_at: string | null; role_ids: string[]; role_names: string[]; is_self: boolean; employee_id: string | null
  external_accountant?: boolean
}
export function useCompanyUsers() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...adminKeys.all(companyId), 'users'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('company_users', { p_company: companyId })) as CompanyUser[],
  })
}
export type RoleRow = Tables<'roles'> & { permissions: string[] }
export function useRoles() {
  const { companyId, hasFeature } = useCompany()
  return useQuery({
    queryKey: [...adminKeys.all(companyId), 'roles'],
    enabled: !!companyId,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('roles').select('*, role_permissions(permission)').order('sort_order').order('name'))
      return (rows as unknown as (Tables<'roles'> & { role_permissions: { permission: string }[] })[])
        .filter((r) => r.company_id === null || r.company_id === companyId)
        // a built-in role of a module the client does not have is not offered (it stays for the people who have it)
        .map(({ role_permissions, ...r }) => ({ ...r, is_assignable: r.is_assignable && (r.company_id !== null || roleInPackage(r.key, (f) => hasFeature(f))),
          permissions: role_permissions.map((p) => p.permission).sort() }))
    },
  })
}
export type PermissionRow = Tables<'permissions'>
export function usePermissionCatalog() {
  return useQuery({
    queryKey: ['permission-catalog'],
    staleTime: Infinity,
    queryFn: async () => unwrap(await supabase.from('permissions').select('*').order('module').order('action')),
  })
}
export const useInviteMember = () => {
  const { companyId } = useCompany()
  return useAction(async (a: { email: string; roles: string[] }) => unwrap(await supabase.rpc('invite_member', { p_company: companyId, p_email: a.email, p_role_keys: a.roles })))
}
export const useInviteAccountant = () => {
  const { companyId } = useCompany()
  return useAction(async (email: string) => unwrap(await supabase.rpc('invite_accountant', { p_company: companyId, p_email: email })))
}
export const useSetMemberRoles = () => useAction(async (a: { member: string; roles: string[] }) =>
  unwrap(await supabase.rpc('set_member_roles', { p_member: a.member, p_role_ids: a.roles })), [['my-context']])
export const useSetMemberStatus = () => useAction(async (a: { member: string; status: 'active' | 'suspended' | 'removed' }) =>
  unwrap(await supabase.rpc('set_member_status', { p_member: a.member, p_status: a.status })))
export const useSaveCustomRole = () => {
  const { companyId } = useCompany()
  return useAction(async (a: { id?: string | null; name: string; description?: string; permissions: string[] }) =>
    unwrap(await supabase.rpc('save_custom_role', { p_company: companyId, p_role: a.id ?? undefined as unknown as string, p_name: a.name,
                                                   p_description: a.description ?? '', p_permissions: a.permissions })) as unknown as string, [['my-context']])
}
export const useDeleteCustomRole = () => useAction(async (id: string) => unwrap(await supabase.rpc('delete_custom_role', { p_role: id })))

/* ------------------------------------------------------------------ approval workflows */
export type WorkflowStep = Tables<'approval_workflow_steps'>
export type Workflow = Tables<'approval_workflows'> & { steps: WorkflowStep[]; pending: { count: number }[] }
export function useWorkflows() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...adminKeys.all(companyId), 'workflows'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('approval_workflows')
      .select('*, steps:approval_workflow_steps(*), pending:approval_requests(count)')
      .eq('company_id', companyId).is('deleted_at', null).eq('pending.status', 'pending')
      .order('doc_type').order('priority').returns<Workflow[]>())
      .map((w) => ({ ...w, steps: [...w.steps].sort((a, b) => a.step_order - b.step_order) })),
  })
}
export function useApprovalDocTypes() {
  return useQuery({
    queryKey: ['approval-doc-types'],
    staleTime: Infinity,
    queryFn: async () => unwrap(await supabase.from('document_types').select('key, name, module').not('pending_status', 'is', null).order('name')),
  })
}
export const useSaveWorkflow = () => {
  const { companyId } = useCompany()
  return useAction(async (p: Record<string, unknown>) => unwrap(await supabase.rpc('save_approval_workflow', { p: { ...p, company_id: companyId } as Json })))
}
export const useToggleWorkflow = () => {
  const qc = useQueryClient()
  const { companyId } = useCompany()
  const key = [...adminKeys.all(companyId), 'workflows']
  return useMutation({
    mutationFn: async (a: { id: string; is_active: boolean }) => unwrap(await supabase.from('approval_workflows').update({ is_active: a.is_active }).eq('id', a.id)),
    // the switch moves at once; it moves back if saving fails
    onMutate: async (a) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Workflow[]>(key)
      qc.setQueryData<Workflow[]>(key, (ws) => ws?.map((w) => (w.id === a.id ? { ...w, is_active: a.is_active } : w)))
      return { prev }
    },
    onError: (e, _a, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); toast.error(describeError(e)) },
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  })
}
export const useDeleteWorkflow = () => useAction(async (id: string) =>
  unwrap(await supabase.from('approval_workflows').update({ deleted_at: new Date().toISOString() }).eq('id', id)))

/* ------------------------------------------------------------------ numbering */
export type NumberingRow = {
  doc_type: string; name: string; module: string; prefix: string; include_year: boolean; padding: number; reset_policy: string
  configured: boolean; period_key: string; next_value: number; next_number: string
}
export function useNumbering() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...adminKeys.all(companyId), 'numbering'],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.rpc('numbering_overview', { p_company: companyId })) as unknown as NumberingRow[],
  })
}
export const useSaveNumbering = () => {
  const { companyId } = useCompany()
  return useAction(async (a: { doc_type: string; prefix: string; include_year: boolean; padding: number; reset_policy: string; next_value?: number | null }) =>
    unwrap(await supabase.rpc('save_numbering', { p_company: companyId, p_doc_type: a.doc_type, p_prefix: a.prefix, p_include_year: a.include_year,
                                                 p_padding: a.padding, p_reset_policy: a.reset_policy, p_next_value: a.next_value ?? undefined })))
}

/* ------------------------------------------------------------------ audit */
export type AuditRow = {
  id: number; occurred_at: string; table_name: string; record_id: string; action: string; actor_id: string | null; actor: string
  changed_fields: string[] | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; record_label: string; total: number
}
export type AuditFilters = { table?: string; actor?: string; action?: string; from?: string; to?: string; record?: string; page: number }
export const AUDIT_PAGE = 50
export function useAuditFeed(f: AuditFilters) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...adminKeys.all(companyId), 'audit', f],
    enabled: !!companyId,
    placeholderData: (prev) => prev,
    queryFn: async () => unwrap(await supabase.rpc('audit_feed', {
      p_company: companyId, p_table: f.table || undefined, p_actor: f.actor || undefined, p_action: f.action || undefined,
      p_from: f.from || undefined, p_to: f.to || undefined, p_record: f.record || undefined, p_limit: AUDIT_PAGE, p_offset: f.page * AUDIT_PAGE,
    })) as unknown as AuditRow[],
  })
}
export function useAuditPeople() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...adminKeys.all(companyId), 'audit-people'],
    enabled: !!companyId,
    queryFn: async () => {
      const members = unwrap(await supabase.from('company_members').select('user_id, invited_email').eq('company_id', companyId).not('user_id', 'is', null))
      const ids = members.map((m) => m.user_id as string)
      const profiles = ids.length ? unwrap(await supabase.from('profiles').select('id, full_name, email').in('id', ids)) : []
      return members.map((m) => {
        const p = profiles.find((x) => x.id === m.user_id)
        return { id: m.user_id as string, name: p?.full_name ?? p?.email ?? m.invited_email ?? '—' }
      }).sort((a, b) => a.name.localeCompare(b.name))
    },
  })
}

/* ------------------------------------------------------------------ imports */
export type ImportKind = 'products' | 'partners' | 'employees' | 'opening_stock'
export type ImportResult = { rows: number; created: number; updated: number; errors: { row: number; field: string | null; message: string }[]; dry_run: boolean; adjustment_id: string | null }

/* ------------------------------------------------------------------ migration from another program */
export type MigrationKind = 'open_receivables' | 'open_payables' | 'opening_balances' | 'price_lists' | 'warehouses' | 'accounts'
export type AnyImportKind = ImportKind | MigrationKind
export const MIGRATION_KINDS: MigrationKind[] = ['open_receivables', 'open_payables', 'opening_balances', 'price_lists', 'warehouses', 'accounts']
export const isMigrationKind = (k: string): k is MigrationKind => (MIGRATION_KINDS as string[]).includes(k)

export type MigrationResult = ImportResult & { ok?: number; total?: number; journal_entry_id?: string | null }

/** One import into the current company; spreadsheet kinds go to import_rows, the cut-over position to migration_import */
export const useAnyImport = () => {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { kind: AnyImportKind; rows: Record<string, string>[]; dryRun: boolean; cutover?: string; file?: string }): Promise<MigrationResult> => {
      if (isMigrationKind(a.kind)) {
        return unwrap(await supabase.rpc('migration_import', { p_company: companyId, p_kind: a.kind, p_rows: a.rows as unknown as Json, p_dry_run: a.dryRun,
          p_cutover: a.cutover, p_file: a.file })) as unknown as MigrationResult
      }
      const r = unwrap(await supabase.rpc('import_rows', { p_company: companyId, p_kind: a.kind, p_rows: a.rows as unknown as Json, p_dry_run: a.dryRun })) as unknown as ImportResult
      if (!a.dryRun) {
        await supabase.rpc('log_migration_run', { p_company: companyId, p_kind: a.kind, p_file: a.file ?? '', p_rows: r.rows,
          p_created: r.created, p_updated: r.updated, p_skipped: r.errors.length })
      }
      return r
    },
    onSuccess: (_r, a) => { if (!a.dryRun) void qc.invalidateQueries() },
    onError: (e) => toast.error(describeError(e)),
  })
}

export type MigrationRun = { id: string; kind: string; file_name: string | null; cutover_date: string | null; rows: number; created: number; updated: number;
  skipped: number; total: number | null; journal_entry_id: string | null; run_at: string; run_by: string | null }
export type MigrationCheck = {
  warehouses?: number; accounts_imported?: number
  products: number; customers: number; vendors: number; employees: number; price_list_items: number; stock_value: number; stock_lines: number
  receivables: number; receivables_count: number; payables: number; payables_count: number; opening_account_balance: number
  classes: { class: string; debit: number; credit: number }[]; runs: MigrationRun[]
}
export function useMigrationCheck(cutover: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...adminKeys.all(companyId), 'migration-check', cutover],
    enabled: !!companyId && !!cutover,
    queryFn: async () => unwrap(await supabase.rpc('migration_check', { p_company: companyId, p_cutover: cutover })) as unknown as MigrationCheck,
  })
}

export type ImportTemplate = { id: string; company_id: string | null; kind: string; name: string; source_system: string | null; mapping: Record<string, string> }
export function useImportTemplates(kind: string) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...adminKeys.all(companyId), 'import-templates', kind],
    enabled: !!companyId,
    queryFn: async () => unwrap(await supabase.from('import_templates').select('id, company_id, kind, name, source_system, mapping').eq('kind', kind).order('name')) as unknown as ImportTemplate[],
  })
}
export const useSaveImportTemplate = () => {
  const { companyId } = useCompany()
  return useAction(async (a: { kind: string; name: string; source: string; mapping: Record<string, string>; shared: boolean }) =>
    unwrap(await supabase.rpc('save_import_template', { p_company: companyId, p_kind: a.kind, p_name: a.name, p_source: a.source,
      p_mapping: a.mapping as unknown as Json, p_shared: a.shared })))
}
export const useDeleteImportTemplate = () => useAction(async (id: string) => unwrap(await supabase.rpc('delete_import_template', { p_id: id })))

/* ------------------------------------------------------------------ live link from the old program */
export type LiveConnection = { id: string; name: string; key_prefix: string; is_active: boolean; last_seen_at: string | null; last_error: string | null; pushes: number; down_since?: string | null; agent_version?: string | null }
export type ExternalDocument = { id: string; kind: 'sale' | 'purchase' | 'balance'; number: string | null; partner_code: string | null; partner_id: string | null
  doc_date: string | null; due_date: string | null; total: number | null; open_amount: number; warehouse_code: string | null; synced_at: string }
export function useLiveLink(enabled = true) {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: [...adminKeys.all(companyId), 'live-link'],
    enabled: !!companyId && enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const conns = unwrap(await supabase.from('sync_connections').select('id, name, key_prefix, is_active, last_seen_at, last_error, pushes, down_since, agent_version').eq('company_id', companyId)) as LiveConnection[]
      if (!conns.length) return { conns, docs: [] as ExternalDocument[] }
      const docs = unwrap(await supabase.from('external_documents').select('id, kind, number, partner_code, partner_id, doc_date, due_date, total, open_amount, warehouse_code, synced_at')
        .eq('company_id', companyId).neq('open_amount', 0).order('due_date', { ascending: true }).limit(500)) as ExternalDocument[]
      return { conns, docs }
    },
  })
}

export type AgentLogLine = { id: number; at: string; level: 'info' | 'ok' | 'warn' | 'error'; msg: string }
/** The agent's own log, as it runs on the client's server (refreshes by itself). */
export function useAgentLog(connectionId: string | null, problemsOnly: boolean) {
  return useQuery({
    queryKey: ['agent-log', connectionId, problemsOnly],
    enabled: !!connectionId,
    refetchInterval: 5_000,
    queryFn: async () => unwrap(await supabase.rpc('sync_agent_log', { p_connection: connectionId!, p_level: problemsOnly ? 'problems' : undefined, p_limit: 500 })) as unknown as AgentLogLine[],
  })
}

/* ------------------------------------------------------------------ notifications */
export type NotificationRow = Pick<Tables<'notifications'>, 'id' | 'type' | 'category' | 'title' | 'body' | 'link' | 'read_at' | 'created_at' | 'entity_type'>
export const NOTIFICATION_CATEGORIES = [
  { key: 'approvals', label: msg('Approvals'), description: msg('Documents waiting for your decision. Always delivered.') },
  { key: 'tasks', label: msg('Tasks|menu'), description: msg('Tasks given to you, due today or tomorrow, done, and comments on them.') },
  { key: 'summary', label: msg('Morning summary'), description: msg('Every morning, yesterday in one line: sales, cash, overdue debts, low stock. For owners and administrators.') },
  { key: 'cash', label: msg('Cash and tills'), description: msg('Differences when a till is closed, the safe, money waiting for approval.') },
  { key: 'people', label: msg('People'), description: msg('Leave requests and decisions, payslips, contracts ending.') },
  { key: 'tax', label: msg('Tax'), description: msg('VAT and payroll deadlines, problems with fiscalization.') },
  { key: 'stock', label: msg('Stock and purchasing'), description: msg('Low stock, lots about to expire, reorder suggestions.') },
  { key: 'sales', label: msg('Sales'), description: msg('New web shop orders and other sales news.') },
  { key: 'logistics', label: msg('Logistics'), description: msg('Failed deliveries and problems with shipments.') },
  { key: 'general', label: msg('General'), description: msg('Everything else, such as being added to a company.') },
] as const
export function useNotificationsFeed(category: string, unreadOnly: boolean) {
  const { companyId } = useCompany()
  const { user } = useAuth()
  return useQuery({
    queryKey: ['notifications', companyId, user?.id, 'feed', category, unreadOnly],
    enabled: !!companyId && !!user,
    queryFn: async () => {
      let q = supabase.from('notifications').select('id, type, category, title, body, link, read_at, created_at, entity_type')
        .eq('company_id', companyId).eq('user_id', user!.id).order('created_at', { ascending: false }).limit(300)
      if (category !== 'all') q = q.eq('category', category)
      if (unreadOnly) q = q.is('read_at', null)
      return unwrap(await q) as NotificationRow[]
    },
  })
}
export function useNotificationCounts() {
  const { companyId } = useCompany()
  const { user } = useAuth()
  return useQuery({
    queryKey: ['notifications', companyId, user?.id, 'counts'],
    enabled: !!companyId && !!user,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('notifications').select('category').eq('company_id', companyId).eq('user_id', user!.id).is('read_at', null))
      const out: Record<string, number> = {}
      for (const r of rows) out[r.category] = (out[r.category] ?? 0) + 1
      return out
    },
  })
}
export const useMarkNotifications = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { ids: string[]; read: boolean }) => unwrap(await supabase.from('notifications')
      .update({ read_at: a.read ? new Date().toISOString() : null }).in('id', a.ids)),
    // update the lists and the counters at once; put them back if saving fails
    onMutate: async (a) => {
      await qc.cancelQueries({ queryKey: ['notifications'] })
      const prev = qc.getQueriesData({ queryKey: ['notifications'] })
      const ids = new Set(a.ids)
      const readAt = a.read ? new Date().toISOString() : null
      // categories of the notifications whose state actually changes (from any loaded feed)
      const delta: Record<string, number> = {}
      const seen = new Set<string>()
      for (const [k, data] of prev) {
        if (k[3] !== 'feed' || !Array.isArray(data)) continue
        for (const n of data as NotificationRow[]) {
          if (!ids.has(n.id) || seen.has(n.id) || !!n.read_at === a.read) continue
          seen.add(n.id)
          delta[n.category] = (delta[n.category] ?? 0) + (a.read ? -1 : 1)
        }
      }
      qc.setQueriesData<NotificationRow[]>({ queryKey: ['notifications'], predicate: (q) => q.queryKey[3] === 'feed' }, (rows) =>
        rows?.map((n) => (ids.has(n.id) ? { ...n, read_at: readAt } : n)))
      qc.setQueriesData<Record<string, number>>({ queryKey: ['notifications'], predicate: (q) => q.queryKey[3] === 'counts' }, (c) => {
        if (!c) return c
        const out = { ...c }
        for (const [cat, d] of Object.entries(delta)) out[cat] = Math.max(0, (out[cat] ?? 0) + d)
        return out
      })
      return { prev }
    },
    onError: (e, _a, ctx) => { ctx?.prev.forEach(([k, d]) => qc.setQueryData(k, d)); toast.error(describeError(e)) },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
export type NotificationPref = Tables<'notification_preferences'>
export function useNotificationPrefs() {
  const { companyId } = useCompany()
  const { user } = useAuth()
  return useQuery({
    queryKey: ['notification-prefs', companyId, user?.id],
    enabled: !!companyId && !!user,
    queryFn: async () => unwrap(await supabase.from('notification_preferences').select('*').eq('company_id', companyId).eq('user_id', user!.id)),
  })
}
export const useSaveNotificationPref = () => {
  const { companyId } = useCompany()
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { category: string; in_app?: boolean; email?: boolean; push?: boolean }) => unwrap(await supabase.from('notification_preferences')
      .upsert({ user_id: user!.id, company_id: companyId, category: a.category, ...('in_app' in a ? { in_app: a.in_app } : {}), ...('email' in a ? { email: a.email } : {}), ...('push' in a ? { push: a.push } : {}) },
              { onConflict: 'user_id,company_id,category' })),
    onMutate: async (a) => {
      const key = ['notification-prefs', companyId, user?.id]
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<NotificationPref[]>(key)
      qc.setQueryData<NotificationPref[]>(key, (rows = []) => {
        const has = rows.some((r) => r.category === a.category)
        const patch = { ...('in_app' in a ? { in_app: a.in_app! } : {}), ...('email' in a ? { email: a.email! } : {}), ...('push' in a ? { push: a.push! } : {}) }
        return has ? rows.map((r) => (r.category === a.category ? { ...r, ...patch } : r))
          : [...rows, { user_id: user!.id, company_id: companyId, category: a.category, in_app: true, email: false, push: true, ...patch } as NotificationPref]
      })
      return { prev, key }
    },
    onError: (e, _a, ctx) => { if (ctx) qc.setQueryData(ctx.key, ctx.prev); toast.error(describeError(e)) },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['notification-prefs'] }),
  })
}

/** Unsaved-changes helper for long settings forms */
export function useDirty<T>(initial: T | undefined) {
  const [value, setValue] = React.useState<T | undefined>(initial)
  React.useEffect(() => { setValue(initial) }, [initial])
  const dirty = JSON.stringify(value) !== JSON.stringify(initial)
  return [value, setValue, dirty] as const
}

/** warehouses each person works in (members not listed work in all) */
export function useMemberWarehouses() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: ['member-warehouses', companyId], enabled: !!companyId,
    queryFn: async () => (unwrap(await supabase.rpc('member_warehouses', { p_company: companyId })) ?? {}) as Record<string, string[]>,
  })
}
export function useSetMemberWarehouses() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (a: { member: string; warehouses: string[] }) => unwrap(await supabase.rpc('member_set_warehouses', { p_member: a.member, p_warehouses: a.warehouses })),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['member-warehouses'] }); void qc.invalidateQueries({ queryKey: ['inv'] }) },
    onError: (e) => toast.error(describeError(e)),
  })
}
