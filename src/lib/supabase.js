import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zncuyrimrkzbidvxyonk.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuY3V5cmltcmt6Ymlkdnh5b25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NTMzOTksImV4cCI6MjA5OTMyOTM5OX0.gJ_NxaMO7fTpxwdFNNU4Phnn9E4qtOlyaMGugryL1iE'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

function toDateInput(val) {
  if (!val) return new Date().toISOString()
  if (typeof val === 'number') return new Date(val).toISOString()
  return val
}

// ---- USERS ----
export async function upsertUser(user) {
  const { data, error } = await supabase.from('usuarios').upsert(user, { onConflict: 'telefone' }).select().single()
  if (error) console.error('Erro upsertUser:', error)
  return data || user
}

export async function findUserByPhone(telefone) {
  const { data } = await supabase.from('usuarios').select('*').eq('telefone', telefone).single()
  return data || null
}

export async function getAllUsers() {
  const { data } = await supabase.from('usuarios').select('*').order('nome').range(0, 999999)
  return data || []
}

// ---- ORDERS ----
export async function getAllOrders() {
  const { data } = await supabase.from('pedidos').select('*').order('created_at', { ascending: false }).range(0, 99999)
  return (data || []).map(fixOrder)
}

export async function getOrdersCount() {
  const { count } = await supabase.from('pedidos').select('*', { count: 'exact', head: true })
  return count || 0
}

export async function getOrdersPage(page = 1, pageSize = 100) {
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const { data, count } = await supabase.from('pedidos').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(from, to)
  return { orders: (data || []).map(fixOrder), count: count || 0 }
}

export async function getUserOrders(userId) {
  const { data } = await supabase.from('pedidos').select('*').eq('user_id', userId).order('created_at', { ascending: false })
  return (data || []).map(fixOrder)
}

export async function upsertOrder(order) {
  const record = {
    id: order.id,
    user_id: order.user_id || order.userId || null,
    status: order.status || 'pendente',
    created_at: toDateInput(order.created_at || order.createdAt),
    data: order
  }
  const { error } = await supabase.from('pedidos').upsert(record, { onConflict: 'id' })
  if (error) console.error('Erro upsertOrder:', error)
}

export async function upsertOrders(orders) {
  const records = orders.map(o => ({
    id: o.id,
    user_id: o.user_id || o.userId || null,
    status: o.status || 'pendente',
    created_at: toDateInput(o.created_at || o.createdAt),
    data: o
  }))
  if (records.length === 0) return
  const { error } = await supabase.from('pedidos').upsert(records, { onConflict: 'id' })
  if (error) console.error('Erro upsertOrders:', error)
}

export async function deleteOrder(id) {
  await supabase.from('financeiro').delete().eq('order_id', id)
  await supabase.from('pedidos').delete().eq('id', id)
}

function fixOrder(row) {
  if (row.data && typeof row.data === 'object') return { ...row.data, user_id: row.user_id, status: row.status }
  return row
}

// ---- FINANCIAL ----
export async function getAllFinancial() {
  const { data } = await supabase.from('financeiro').select('*').range(0, 99999)
  return (data || []).map(f => f.data || f)
}

export async function upsertFinancial(records) {
  if (records.length === 0) return
  const mapped = records.map(r => ({
    id: r.id,
    order_id: r.orderId || r.order_id,
    status: r.status || 'pendente',
    data: r
  }))
  const { error } = await supabase.from('financeiro').upsert(mapped, { onConflict: 'id' })
  if (error) console.error('Erro upsertFinancial:', error)
}

export async function deleteFinancialByOrder(orderId) {
  await supabase.from('financeiro').delete().eq('order_id', orderId)
}

// ---- ROTAS ----
export async function getRotasContatos() {
  const { data } = await supabase.from('rotas_contatos').select('*')
  return data || []
}

// ---- SYNC CONTATOS -> USUARIOS (upsert all: insert new + update existing nome/cidade/rota) ----
export async function syncContatosToUsuarios(contatos) {
  if (!contatos || contatos.length === 0) return 0

  // Fetch existing users' endereco in one query
  const telefones = contatos.map(ct => {
    const phone = ct.remoteJid?.replace(/@.*/, '').replace(/\D/g, '')
    if (!phone || phone.length < 10) return null
    const normalized = phone.startsWith('55') ? phone : `55${phone}`
    return normalized
  }).filter(Boolean)

  if (telefones.length === 0) return 0

  const { data: existing } = await supabase.from('usuarios').select('telefone, endereco').in('telefone', telefones)
  const existingMap = {}
  if (existing) existing.forEach(u => { existingMap[u.telefone] = u.endereco || {} })

  const batch = contatos.map(ct => {
    const phone = ct.remoteJid?.replace(/@.*/, '').replace(/\D/g, '')
    if (!phone || phone.length < 10) return null
    const normalized = phone.startsWith('55') ? phone : `55${phone}`
    const mergedEndereco = { ...(existingMap[normalized] || {}), cidade: ct.cidade || '', rota: ct.rota || '' }
    return {
      telefone: normalized,
      nome: ct.pushName || 'Contato',
      endereco: mergedEndereco
    }
  }).filter(Boolean)

  if (batch.length === 0) return 0

  const { error } = await supabase.from('usuarios').upsert(batch, { onConflict: 'telefone', ignoreDuplicates: false })

  if (error) {
    console.error('Erro syncContatosToUsuarios:', error)
    return 0
  }

  return batch.length
}

function makeToken() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6)
}

// ---- LOGIN TOKENS ----
export async function generateLoginToken(telefone) {
  const token = makeToken()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase.from('login_tokens').insert({
    telefone,
    token,
    expires_at: expiresAt
  })
  if (error) { console.error('Erro generateLoginToken:', error); return null }
  return token
}

export async function consumeLoginToken(token) {
  if (!token) return null
  const { data, error } = await supabase.from('login_tokens').select('*').eq('token', token).maybeSingle()
  if (error || !data) return null
  if (data.used) return null
  if (new Date(data.expires_at) < new Date()) return null
  await supabase.from('login_tokens').update({ used: true }).eq('token', token)
  return data.telefone
}
export async function syncAllForAdmin() {
  const [orders, financial, users, rotas] = await Promise.all([
    getAllOrders(),
    getAllFinancial(),
    getAllUsers(),
    getRotasContatos()
  ])
  return { orders, financial, users, rotas }
}
