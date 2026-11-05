import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { useAuth } from '@/app/auth-provider'
import { useCompany } from '@/app/company-provider'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export type ChatConversation = {
  id: string; kind: 'direct' | 'group'; title: string | null; last_message_at: string; last_preview: string | null
  last_sender: string | null; muted: boolean; other: string | null; members: number; unread: number
}
export type ChatAttachment = { path: string; name: string; type: string; size: number; w?: number; h?: number }
export type ChatMessage = {
  id: number; conversation_id: string; sender_id: string | null; kind: 'text' | 'system'; body: string | null
  reply_to: number | null; attachments: ChatAttachment[] | string[]; created_at: string; edited_at: string | null; deleted_at: string | null
}
export type ChatMember = { user_id: string; role: string; last_read_at: string; muted_until: string | null }
export type ChatPerson = { id: string; name: string; email: string | null }

export const chatKeys = {
  list: (co: string | null) => ['chat', co, 'list'] as const,
  unread: (co: string | null) => ['chat', co, 'unread'] as const,
  people: (co: string | null) => ['chat', co, 'people'] as const,
  messages: (conv: string | null) => ['chat', 'messages', conv] as const,
  members: (conv: string | null) => ['chat', 'members', conv] as const,
}
const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

export function useChatList() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: chatKeys.list(companyId), enabled: !!companyId, refetchInterval: () => (visible() ? 20_000 : false),
    queryFn: async () => unwrap(await supabase.rpc('chat_list', { p_company: companyId! })) as unknown as ChatConversation[],
  })
}

export function useChatUnread() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: chatKeys.unread(companyId), enabled: !!companyId, refetchInterval: () => (visible() ? 30_000 : false),
    queryFn: async () => unwrap(await supabase.rpc('chat_unread', { p_company: companyId! })) as unknown as number,
  })
}

export function useChatPeople() {
  const { companyId } = useCompany()
  return useQuery({
    queryKey: chatKeys.people(companyId), enabled: !!companyId, staleTime: 5 * 60_000,
    queryFn: async () => unwrap(await supabase.rpc('chat_people', { p_company: companyId! })) as unknown as ChatPerson[],
  })
}

const PAGE = 50
export function useChatMessages(conv: string | null) {
  return useInfiniteQuery({
    queryKey: chatKeys.messages(conv), enabled: !!conv, initialPageParam: null as number | null,
    refetchInterval: () => (visible() ? 15_000 : false),
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('chat_messages').select('id, conversation_id, sender_id, kind, body, reply_to, attachments, created_at, edited_at, deleted_at')
        .eq('conversation_id', conv!).order('id', { ascending: false }).limit(PAGE)
      if (pageParam) q = q.lt('id', pageParam)
      return unwrap(await q) as unknown as ChatMessage[]
    },
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)!.id : undefined),
  })
}

export function useChatMembers(conv: string | null) {
  return useQuery({
    queryKey: chatKeys.members(conv), enabled: !!conv,
    queryFn: async () => unwrap(await supabase.from('chat_members').select('user_id, role, last_read_at, muted_until').eq('conversation_id', conv!)) as unknown as ChatMember[],
  })
}

/** new messages and reads arrive at once where the server has realtime; otherwise the lists ask again every few seconds */
export function useChatRealtime() {
  const { companyId } = useCompany()
  const { user } = useAuth()
  const qc = useQueryClient()
  React.useEffect(() => {
    if (!companyId || !user) return
    const ch = supabase.channel(`chat:${companyId}:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `company_id=eq.${companyId}` }, (p) => {
        const m = (p.new ?? p.old) as { conversation_id?: string }
        if (m?.conversation_id) void qc.invalidateQueries({ queryKey: chatKeys.messages(m.conversation_id) })
        void qc.invalidateQueries({ queryKey: chatKeys.list(companyId) })
        void qc.invalidateQueries({ queryKey: chatKeys.unread(companyId) })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_members', filter: `company_id=eq.${companyId}` }, (p) => {
        const m = (p.new ?? p.old) as { conversation_id?: string }
        if (m?.conversation_id) void qc.invalidateQueries({ queryKey: chatKeys.members(m.conversation_id) })
        void qc.invalidateQueries({ queryKey: chatKeys.list(companyId) })
      })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [companyId, user, qc])
}

/** who is in the program now (presence), and who is typing in a conversation (broadcast) */
export function useOnline() {
  const { companyId } = useCompany()
  const { user } = useAuth()
  const [online, setOnline] = React.useState<Set<string>>(new Set())
  React.useEffect(() => {
    if (!companyId || !user) return
    const ch = supabase.channel(`online:${companyId}`, { config: { presence: { key: user.id } } })
    ch.on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(ch.presenceState()))))
      .subscribe((s) => { if (s === 'SUBSCRIBED') void ch.track({ at: Date.now() }) })
    return () => { void supabase.removeChannel(ch) }
  }, [companyId, user])
  return online
}

export function useTyping(conv: string | null) {
  const { user } = useAuth()
  const [typing, setTyping] = React.useState<Record<string, number>>({})
  const chRef = React.useRef<ReturnType<typeof supabase.channel> | null>(null)
  React.useEffect(() => {
    if (!conv || !user) return
    const ch = supabase.channel(`typing:${conv}`)
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      const id = (payload as { user?: string }).user
      if (id && id !== user.id) setTyping((t) => ({ ...t, [id]: Date.now() }))
    }).subscribe()
    chRef.current = ch
    const tick = window.setInterval(() => setTyping((t) => Object.fromEntries(Object.entries(t).filter(([, at]) => Date.now() - at < 4000))), 1500)
    return () => { window.clearInterval(tick); chRef.current = null; void supabase.removeChannel(ch) }
  }, [conv, user])
  const last = React.useRef(0)
  const ping = React.useCallback(() => {
    if (!user || Date.now() - last.current < 2500) return
    last.current = Date.now()
    void chRef.current?.send({ type: 'broadcast', event: 'typing', payload: { user: user.id } })
  }, [user])
  return { typing: Object.keys(typing), ping }
}

export function useChatActions() {
  const { companyId } = useCompany()
  const qc = useQueryClient()
  const refresh = (conv?: string) => {
    if (conv) void qc.invalidateQueries({ queryKey: chatKeys.messages(conv) })
    void qc.invalidateQueries({ queryKey: chatKeys.list(companyId) })
    void qc.invalidateQueries({ queryKey: chatKeys.unread(companyId) })
  }
  const call = async (fn: string, args: Record<string, unknown>) => unwrap(await supabase.rpc(fn as never, args as never)) as unknown
  return {
    refresh,
    openDirect: async (user: string) => (await call('chat_open_direct', { p_company: companyId!, p_user: user })) as string,
    createGroup: async (title: string, users: string[]) => (await call('chat_create_group', { p_company: companyId!, p_title: title, p_users: users })) as string,
    addMembers: async (conv: string, users: string[]) => { await call('chat_add_members', { p_conv: conv, p_users: users }) },
    leave: async (conv: string) => { await call('chat_leave', { p_conv: conv }) },
    rename: async (conv: string, title: string) => { await call('chat_rename', { p_conv: conv, p_title: title }) },
    send: async (conv: string, body: string, replyTo: number | null, attachments: ChatAttachment[]) => call('chat_send', { p_conv: conv, p_body: body, p_reply_to: replyTo, p_attachments: attachments }),
    edit: async (id: number, body: string) => { await call('chat_edit', { p_id: id, p_body: body }) },
    remove: async (id: number) => { await call('chat_delete', { p_id: id }) },
    read: async (conv: string) => { await call('chat_read', { p_conv: conv }) },
    mute: async (conv: string, until: string | null) => { await call('chat_mute', { p_conv: conv, p_until: until }) },
  }
}

export function useSendMessage(conv: string | null) {
  const a = useChatActions()
  return useMutation({
    mutationFn: (v: { body: string; replyTo: number | null; attachments: ChatAttachment[] }) => a.send(conv!, v.body, v.replyTo, v.attachments),
    onSuccess: () => a.refresh(conv ?? undefined),
  })
}

/** a picture is made smaller before it goes (a phone photo of 6 MB becomes a few hundred KB) */
async function shrink(f: File): Promise<{ blob: Blob; w?: number; h?: number; type: string; name: string }> {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return { blob: f, type: f.type || 'application/octet-stream', name: f.name }
  try {
    const url = URL.createObjectURL(f)
    const img = new Image(); img.src = url; await img.decode(); URL.revokeObjectURL(url)
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k)
    if (k === 1 && f.size < 600_000) return { blob: f, w, h, type: f.type, name: f.name }
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d')!.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('image'))), 'image/jpeg', 0.85))
    return { blob, w, h, type: 'image/jpeg', name: f.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg' }
  } catch { return { blob: f, type: f.type, name: f.name } }
}

export const MAX_FILE = 25 * 1024 * 1024
export async function uploadChatFile(companyId: string, conv: string, f: File): Promise<ChatAttachment> {
  const s = await shrink(f)
  if (s.blob.size > MAX_FILE) throw new Error('too-big')
  const safe = s.name.replace(/[\\/:*?"<>|#%]+/g, '-').slice(0, 150) || 'skedar'
  const path = `${companyId}/${conv}/${crypto.randomUUID()}/${safe}`
  const up = await supabase.storage.from('chat-files').upload(path, s.blob, { contentType: s.type, upsert: false })
  if (up.error) throw up.error
  return { path, name: safe, type: s.type, size: s.blob.size, w: s.w, h: s.h }
}

/** a short-lived link to a file of the conversation (the folder is private) */
export function useFileUrl(path: string | null) {
  return useQuery({
    queryKey: ['chat', 'file', path], enabled: !!path, staleTime: 50 * 60_000,
    queryFn: async () => { const r = await supabase.storage.from('chat-files').createSignedUrl(path!, 3600); if (r.error) throw r.error; return r.data.signedUrl },
  })
}

/** DrisPRO links inside a message: the documents they point at */
const LINK = /(?:https?:\/\/[^\s/]+)?\/(sales\/invoices|procurement\/bills|procurement\/invoice|sales\/orders|procurement\/orders|inventory\/products|partners)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi
const KIND: Record<string, string> = {
  'sales/invoices': 'sales_invoice', 'procurement/bills': 'vendor_bill', 'procurement/invoice': 'vendor_bill', 'sales/orders': 'sales_order',
  'procurement/orders': 'purchase_order', 'inventory/products': 'product', partners: 'partner',
}
export function docLinks(body: string | null): { kind: string; id: string; href: string }[] {
  if (!body) return []
  const out: { kind: string; id: string; href: string }[] = []
  for (const m of body.matchAll(LINK)) {
    const kind = KIND[m[1]!.toLowerCase()]
    if (kind && !out.some((x) => x.id === m[2])) out.push({ kind, id: m[2]!, href: `/${m[1]}/${m[2]}` })
  }
  return out.slice(0, 3)
}
export type LinkCard = { number: string | null; party: string | null; total: number | null; currency?: string | null; status: string | null; date?: string | null; tax_number?: string | null }
export function useLinkCard(kind: string, id: string) {
  return useQuery({
    queryKey: ['chat', 'card', kind, id], staleTime: 60_000,
    queryFn: async () => unwrap(await supabase.rpc('chat_link_card', { p_kind: kind, p_id: id })) as unknown as LinkCard | null,
  })
}
