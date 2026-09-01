import { capPhotoSize } from './image.js'

class SupabaseQueryBuilder {
  constructor(table) {
    this.table = table;
    this.method = null;
    this.args = null;
    this.filters = [];
    this.orders = [];
    this.rangeVal = null;
    this.singleVal = false;
    this.maybeSingleVal = false;
    this.countVal = null;
    this.headVal = false;
  }
  
  select(columns = '*', options = {}) {
    this.method = 'select';
    this.args = columns;
    if (options.count) this.countVal = options.count;
    if (options.head) this.headVal = options.head;
    return this;
  }
  
  insert(values) {
    this.method = 'insert';
    this.args = values;
    return this;
  }
  
  upsert(values, options = {}) {
    this.method = 'upsert';
    this.args = { values, options };
    return this;
  }
  
  update(values) {
    this.method = 'update';
    this.args = values;
    return this;
  }
  
  delete() {
    this.method = 'delete';
    return this;
  }
  
  eq(column, value) {
    this.filters.push({ type: 'eq', column, value });
    return this;
  }
  
  in(column, value) {
    this.filters.push({ type: 'in', column, value });
    return this;
  }
  
  ilike(column, value) {
    this.filters.push({ type: 'ilike', column, value });
    return this;
  }
  
  or(queryString) {
    this.filters.push({ type: 'or', value: queryString });
    return this;
  }
  
  order(column, options = {}) {
    this.orders.push({ column, ascending: options.ascending !== false });
    return this;
  }
  
  range(from, to) {
    this.rangeVal = { from, to };
    return this;
  }
  
  single() {
    this.singleVal = true;
    return this;
  }
  
  maybeSingle() {
    this.maybeSingleVal = true;
    return this;
  }
  
  async then(onfulfilled, onrejected) {
    try {
      const result = await this.execute();
      return onfulfilled ? onfulfilled(result) : result;
    } catch (err) {
      if (onrejected) return onrejected(err);
      throw err;
    }
  }
  
  async execute() {
    try {
      const res = await fetch('/api/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: this.method,
          table: this.table,
          args: this.args,
          filters: this.filters,
          orders: this.orders,
          range: this.rangeVal,
          single: this.singleVal,
          maybeSingle: this.maybeSingleVal,
          count: this.countVal,
          head: this.headVal
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        return { data: null, error: { message: errText } };
      }
      return await res.json();
    } catch (err) {
      console.error('Database query network error:', err);
      return { data: null, error: { message: err.message } };
    }
  }
}

export const supabase = {
  from(table) {
    return new SupabaseQueryBuilder(table);
  },
  rpc(fnName, args = {}) {
    return {
      async then(onfulfilled, onrejected) {
        try {
          const res = await fetch('/api/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'rpc',
              name: fnName,
              args
            })
          });
          if (!res.ok) {
            const errText = await res.text();
            const ret = { data: null, error: { message: errText } };
            return onfulfilled ? onfulfilled(ret) : ret;
          }
          const data = await res.json();
          return onfulfilled ? onfulfilled(data) : data;
        } catch (err) {
          if (onrejected) return onrejected(err);
          throw err;
        }
      }
    };
  }
};

function toDateInput(val) {
  if (!val) return new Date().toISOString()
  if (typeof val === 'number') return new Date(val).toISOString()
  return val
}

export function normalizePhoneDigits(phone) {
  if (!phone) return ''
  let digits = String(phone).replace(/\D/g, '')
  if (!digits) return ''

  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2)
  }

  // If 10 digits (2-digit DDD + 8-digit number), insert mandatory '9' after DDD
  if (digits.length === 10) {
    digits = digits.slice(0, 2) + '9' + digits.slice(2)
  }

  return '55' + digits
}

export function normTel(t) {
  return normalizePhoneDigits(t)
}

export function samePhone(a, b) {
  if (!a || !b) return false
  const na = normalizePhoneDigits(a)
  const nb = normalizePhoneDigits(b)
  if (na && nb && na === nb) return true

  const da = String(a).replace(/\D/g, '')
  const db = String(b).replace(/\D/g, '')
  if (da.length < 10 || db.length < 10) return false

  let cleanA = da.replace(/^55/, '')
  let cleanB = db.replace(/^55/, '')
  if (cleanA.length === 10) cleanA = cleanA.slice(0, 2) + '9' + cleanA.slice(2)
  if (cleanB.length === 10) cleanB = cleanB.slice(0, 2) + '9' + cleanB.slice(2)
  return cleanA === cleanB && cleanA.length === 11
}

// ---- USERS ----
export async function upsertUser(user) {
  const raw = (user.telefone || '').replace(/@.*$/, '')
  if (!raw) { console.error('upsertUser: telefone vazio'); return null }
  const telefone = normalizePhoneDigits(raw)

  // Ensure CPF is stored inside endereco
  const endereco = { ...(user.endereco || {}) }
  if (user.cpf && !endereco.cpf) {
    endereco.cpf = user.cpf
  }

  // Construct valid database columns only
  const dbUser = {
    telefone,
    nome: user.nome || '',
    email: user.email || '',
    endereco
  }
  if (user.id) dbUser.id = user.id

  const onConflict = user.id ? 'id' : 'telefone'

  let lastError = null
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { data, error } = await supabase.from('usuarios').upsert(dbUser, { onConflict }).select().single()
      if (!error && data) return { ...user, ...data }
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
    pendentes.push({ ...dbUser, savedAt: Date.now() })
    localStorage.setItem('thsm_pending_users', JSON.stringify(pendentes))
  } catch {}
  return null
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

const PENDING_ORDERS_KEY = 'thsm_pending_orders'

function readPendingOrders() {
  try { return JSON.parse(localStorage.getItem(PENDING_ORDERS_KEY)) || [] } catch { return [] }
}

function writePendingOrders(list) {
  try {
    if (list.length) localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(list))
    else localStorage.removeItem(PENDING_ORDERS_KEY)
  } catch {}
}

function orderRecord(o) {
  let uid = o.user_id || o.userId || null
  if (typeof uid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) {
    uid = null
  }

  return {
    id: Number(o.id),
    user_id: uid,
    status: o.status || 'pendente',
    created_at: toDateInput(o.created_at || o.createdAt),
    data: {
      ...o,
      identityPhoto: capPhotoSize(o.identityPhoto),
      addressProof: capPhotoSize(o.addressProof)
    }
  }
}

async function upsertOrderBatch(records, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { error } = await supabase.from('pedidos').upsert(records, { onConflict: 'id' })
      if (!error) return true
      console.error('Erro upsert pedidos:', attempt, error)
    } catch (e) {
      console.error('Exceção upsert pedidos:', attempt, e)
    }
    if (attempt < attempts) await new Promise(r => setTimeout(r, 700 * attempt))
  }
  return false
}

function queueOrderWrite(order) {
  if (!order || order.id == null) return
  const compact = { ...order, identityPhoto: capPhotoSize(order.identityPhoto, 8000), addressProof: capPhotoSize(order.addressProof, 8000) }
  const pending = readPendingOrders()
  const idx = pending.findIndex(p => p.id === order.id)
  if (idx >= 0) pending[idx] = { ...pending[idx], ...compact }
  else pending.push(compact)
  writePendingOrders(pending)
  setTimeout(() => { flushPendingOrders() }, 800)
}

function removePendingOrder(id) {
  const pending = readPendingOrders().filter(p => p.id !== id)
  writePendingOrders(pending)
}

let flushingOrders = false
export async function flushPendingOrders() {
  if (flushingOrders) return
  const pending = readPendingOrders()
  if (pending.length === 0) return
  flushingOrders = true
  try {
    const remaining = []
    for (const o of pending) {
      const ok = await upsertOrderBatch([orderRecord(o)], 2)
      if (!ok) remaining.push(o)
    }
    writePendingOrders(remaining)
  } finally {
    flushingOrders = false
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushPendingOrders() })
  window.addEventListener('focus', () => { flushPendingOrders() })
}

export async function upsertOrder(order) {
  if (!order || order.id == null) return true
  const ok = await upsertOrderBatch([orderRecord(order)])
  if (ok) removePendingOrder(order.id)
  else queueOrderWrite(order)
  return ok
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
      if ((error.code === '23503' || error.code === '57014' || !error.code) && attempt < 3) {
        await new Promise(r => setTimeout(r, 1200 * attempt))
        continue
      }
      console.error(`Erro upsert ${table}:`, error)
      break
    }
  }
}

export async function upsertOrders(orders) {
  const seen = new Map()
  orders.forEach(o => { if (o && o.id != null) seen.set(o.id, o) })
  const list = [...seen.values()]
  if (list.length === 0) return
  const CHUNK = 100
  for (let i = 0; i < list.length; i += CHUNK) {
    const slice = list.slice(i, i + CHUNK)
    const ok = await upsertOrderBatch(slice.map(orderRecord))
    if (ok) slice.forEach(o => removePendingOrder(o.id))
    else slice.forEach(o => queueOrderWrite(o))
  }
  flushPendingOrders()
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

export async function deleteOnlyFinancialByOrder(orderId) {
  const { error } = await supabase.from('financeiro').delete().eq('order_id', orderId)
  if (error) console.error('Erro ao deletar financeiro:', error)
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
    const rec = {
      id: Number(id),
      ...rest,
      updated_at: new Date().toISOString()
    }
    // Only include variants column if it is explicitly being modified
    if (variantes !== undefined) {
      rec.variantes = variantes
    }
    return rec
  })
  if (records.length === 0) return
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { error } = await supabase.from('produtos').upsert(records, { onConflict: 'id' })
    if (!error) return
    console.error('Erro upsertProducts:', error)
    const msg = error.message || ''
    const m = /Could not find the ['"]([^'"]+)['"] column/.exec(msg) || /column [\'\"]?([^\'\"]+)[\'\"]? does not exist/i.exec(msg) || /column "([^"]+)"/i.exec(msg)
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
    const { error: err1 } = await supabase.from('produtos').delete().in('id', mapped)
    if (err1) {
      console.warn('Erro deleteProducts fallback para rpc:', err1)
      const { error } = await supabase.rpc('admin_delete_products', { product_ids: mapped })
      if (error) console.error('Erro deleteProducts (rpc):', error)
    }
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
