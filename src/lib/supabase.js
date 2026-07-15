import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zncuyrimrkzbidvxyonk.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuY3V5cmltcmt6Ymlkdnh5b25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NTMzOTksImV4cCI6MjA5OTMyOTM5OX0.gJ_NxaMO7fTpxwdFNNU4Phnn9E4qtOlyaMGugryL1iE'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Set RLS session variables
export function setSessionContext(phone, isAdmin = false) {
  supabase.rpc('app_set_config', { key: 'app.user_phone', value: phone || '' }).catch(() => {})
  supabase.rpc('app_set_config', { key: 'app.is_admin', value: isAdmin ? 'true' : 'false' }).catch(() => {})
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
  const { data } = await supabase.from('usuarios').select('*').order('nome')
  return data || []
}

// ---- ORDERS ----
export async function getAllOrders() {
  const { data } = await supabase.from('pedidos').select('*').order('created_at', { ascending: false })
  return (data || []).map(fixOrder)
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
    created_at: order.created_at || order.createdAt || new Date().toISOString(),
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
    created_at: o.created_at || o.createdAt || new Date().toISOString(),
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
  const { data } = await supabase.from('financeiro').select('*')
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

// ---- SYNC ALL FROM SUPABASE ----
export async function syncAllForAdmin() {
  const [orders, financial, users, rotas] = await Promise.all([
    getAllOrders(),
    getAllFinancial(),
    getAllUsers(),
    getRotasContatos()
  ])
  return { orders, financial, users, rotas }
}
