import { createClient } from '@supabase/supabase-js'
import { capPhotoSize } from './image'

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
  const raw = (user.telefone || '').replace(/@.*$/, '').replace(/\D/g, '')
  if (!raw) { console.error('upsertUser: telefone vazio'); return null }
  const telefone = raw.startsWith('55') ? raw : '55' + raw
  const clean = { ...user, telefone }
  let lastError = null
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { data, error } = await supabase.from('usuarios').upsert(clean, { onConflict: 'telefone' }).select().single()
      if (!error) return data || clean
      lastError = error
      if (attempt < 3) await new Promise(r => setTimeout(r, 600 * attempt))
    }
  } catch (e) {
    lastError = e
  }
  console.error('Erro upsertUser:', lastError)
  // Sem rede: guarda pendente para reprocessar quando voltar
  try {
    const pendentes = JSON.parse(localStorage.getItem('thsm_pending_users') || '[]')
    pendentes.push({ ...clean, savedAt: Date.now() })
    localStorage.setItem('thsm_pending_users', JSON.stringify(pendentes))
  } catch {}
  return clean
}

export async function findUserByPhone(telefone) {
  const { data } = await supabase.from('usuarios').select('*').eq('telefone', telefone).single()
  return data || null
}

async function paginateAll(table, pageSize = 1000) {
  let all = []
  let offset = 0
  while (true) {
    const { data } = await supabase.from(table).select('*').range(offset, offset + pageSize - 1)
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return all
}

export async function getAllUsers() {
  const data = await paginateAll('usuarios')
  return data.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
}

// ---- ORDERS ----
export async function getAllOrders() {
  const data = await paginateAll('pedidos')
  return (data || []).map(fixOrder).sort((a, b) => new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0))
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
    data: {
      ...order,
      identityPhoto: capPhotoSize(order.identityPhoto),
      addressProof: capPhotoSize(order.addressProof)
    }
  }
  try {
    const { error } = await supabase.from('pedidos').upsert(record, { onConflict: 'id' })
    if (error) console.error('Erro upsertOrder:', error)
  } catch (e) {
    console.error('Exceção upsertOrder:', e)
  }
}

async function upsertChunked(table, records, mapFn) {
  if (records.length === 0) return
  const seen = new Map()
  records.forEach(r => seen.set(r.id, r))
  const mapped = [...seen.values()].map(mapFn)
  const CHUNK = 200
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const slice = mapped.slice(i, i + CHUNK)
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error } = await supabase.from(table).upsert(slice, { onConflict: 'id' })
      if (!error) break
      // 23503 = FK violation (ex.: financeiro antes do pedido existir). Aguarda e tenta de novo;
      // a sincronização do pedido costuma chegar em seguida.
      if (error.code === '23503' && attempt < 3) {
        await new Promise(r => setTimeout(r, 1200 * attempt))
        continue
      }
      console.error(`Erro upsert ${table}:`, error)
      break
    }
  }
}

export async function upsertOrders(orders) {
  await upsertChunked('pedidos', orders, o => ({
    id: o.id,
    user_id: o.user_id || o.userId || null,
    status: o.status || 'pendente',
    created_at: toDateInput(o.created_at || o.createdAt),
    data: {
      ...o,
      identityPhoto: capPhotoSize(o.identityPhoto),
      addressProof: capPhotoSize(o.addressProof)
    }
  }))
}

export async function deleteOrder(id) {
  try {
    const { error } = await supabase.rpc('admin_delete_order', { ord_id: id })
    if (error) console.error('Erro deleteOrder:', error)
    return { error }
  } catch (e) {
    console.error('Exceção deleteOrder:', e)
    return { error: e }
  }
}

export async function deleteUserByTelefone(telefone) {
  const { data, error } = await supabase.rpc('admin_delete_user', { user_phone: telefone })
  if (error) console.error('Erro deleteUserByTelefone:', error)
  return { error, deletedOrders: data === 'ok' ? 1 : 0 }
}

function fixOrder(row) {
  if (row.data && typeof row.data === 'object') return { ...row.data, user_id: row.user_id, status: row.status }
  return row
}

// ---- FINANCIAL ----
export async function getAllFinancial() {
  const data = await paginateAll('financeiro')
  return (data || []).map(f => f.data || f)
}

export async function upsertFinancial(records) {
  await upsertChunked('financeiro', records, r => ({
    id: r.id,
    order_id: r.orderId || r.order_id || null,
    status: r.status || 'pendente',
    data: r
  }))
  // FK race: se um pedido acabou de ser criado, o financeiro pode chegar antes do pedidos.
  // Erros de FK (23503) são tolerados aqui; o effect re-sincroniza quando o pedido existir.
}

export async function deleteFinancialByOrder(orderId) {
  await supabase.rpc('admin_delete_order', { ord_id: orderId })
}

// ---- ROTAS ----
export async function getRotasContatos() {
  const { data } = await supabase.from('rotas_contatos').select('*')
  return data || []
}

// ---- ROTAS EDITS (edições feitas pelo admin que sobrevivem à sincronização do webhook) ----
export async function getAllRotaEdits() {
  const { data } = await supabase.from('rotas_edits').select('*')
  return data || []
}

export async function upsertRotaEdits(records) {
  if (!records || records.length === 0) return
  const seen = new Map()
  records.forEach(r => seen.set(r.id, r))
  const mapped = [...seen.values()].map(r => ({
    id: r.id,
    rota: r.rota || '',
    acao: r.acao || 'adicionar',
    contato: r.contato || {},
    created_at: r.created_at || new Date().toISOString()
  }))
  const { error } = await supabase.from('rotas_edits').upsert(mapped, { onConflict: 'id' })
  if (error) console.error('Erro upsertRotaEdits:', error)
}

export async function deleteRotaEdit(id) {
  const { error } = await supabase.from('rotas_edits').delete().eq('id', id)
  if (error) console.error('Erro deleteRotaEdit:', error)
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
    const mergedEndereco = { ...(existingMap[normalized] || {}), cidade: ct.cidade || '', rota: ct.rota || '', origem: existingMap[normalized]?.origem || 'Importado WhatsApp' }
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

// ---- LEADS ----
export async function getAllLeads() {
  const { data } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
  return data || []
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
// ---- PRODUCTS ----
export async function getAllProducts() {
  const { data } = await supabase.from('produtos').select('*')
  return data || []
}

// ---- DESPESAS ----
export async function getAllDespesas() {
  const data = await paginateAll('despesas')
  return (data || []).map(f => f.data || f)
}

export async function upsertDespesas(records) {
  if (records.length === 0) return
  const seen = new Map()
  records.forEach(r => seen.set(r.id, r))
  const mapped = [...seen.values()].map(r => ({
    id: r.id,
    status: r.status || 'pendente',
    data: r
  }))
  try {
    const { error } = await supabase.from('despesas').upsert(mapped, { onConflict: 'id' })
    if (error) console.error('Erro upsertDespesas:', error)
  } catch (e) {
    console.error('Exceção upsertDespesas:', e)
  }
}

export async function upsertProducts(products) {
  let records = Object.entries(products).map(([id, changes]) => {
    const { variantes, ...rest } = changes
    return {
      id: Number(id),
      ...rest,
      variantes: variantes || {},
      updated_at: new Date().toISOString()
    }
  })
  if (records.length === 0) return
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { error } = await supabase.from('produtos').upsert(records, { onConflict: 'id' })
    if (!error) return
    console.error('Erro upsertProducts:', error)
    // PGRST204 = coluna não existe no banco. Remove a coluna problemática e tenta de novo,
    // para o produto salvar mesmo com o schema do banco desatualizado.
    const m = /Could not find the '([^']+)' column/.exec(error.message || '')
    if (m && attempt < 4) {
      const col = m[1]
      records = records.map(r => { const { [col]: _omit, ...rest } = r; return rest })
      continue
    }
    return
  }
}

export async function deleteProducts(ids) {
  if (!ids || ids.length === 0) return
  const mapped = [...new Set(ids)].map(Number)
  try {
    const { error } = await supabase.rpc('admin_delete_products', { product_ids: mapped })
    if (error) console.error('Erro deleteProducts (rpc):', error)
  } catch (e) {
    console.error('Erro deleteProducts:', e)
  }
}

export async function syncAllForAdmin() {
  const [orders, financial, users, rotas, products, despesas, rotaEdits] = await Promise.allSettled([
    getAllOrders(),
    getAllFinancial(),
    getAllUsers(),
    getRotasContatos(),
    getAllProducts(),
    getAllDespesas(),
    getAllRotaEdits()
  ])
  return {
    orders: orders.status === 'fulfilled' ? orders.value : [],
    financial: financial.status === 'fulfilled' ? financial.value : [],
    users: users.status === 'fulfilled' ? users.value : [],
    rotas: rotas.status === 'fulfilled' ? rotas.value : [],
    products: products.status === 'fulfilled' ? products.value : [],
    despesas: despesas.status === 'fulfilled' ? despesas.value : [],
    rotaEdits: rotaEdits.status === 'fulfilled' ? rotaEdits.value : []
  }
}
