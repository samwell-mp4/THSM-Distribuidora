import { useState, useMemo, useEffect, useCallback } from 'react'
import './Admin.css'
import { supabase, syncAllForAdmin, getAllUsers, upsertOrders, upsertFinancial, upsertOrder, upsertUser, deleteOrder as supabaseDeleteOrder, deleteUserByTelefone, syncContatosToUsuarios, getAllLeads, upsertProducts } from '../lib/supabase'

const STORAGE_PRODUCTS = 'thsm_admin_produtos'
const STORAGE_FINANCIAL = 'thsm_admin_financeiro'
const STORAGE_CUSTOM_ROTAS = 'thsm_custom_rotas'
const WEBHOOK_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/novo-pedido'
const LISTA_CONTATOS_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/lista-contatos'
const ALERTAR_ROTAS_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/alertar-rotas'

const LS = {
  get(key, def) {
    try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : def } catch { return def }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)) }
}

function formatPreco(v) {
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`
}

function hoje() {
  return new Date().toISOString().split('T')[0]
}

function formatDate(str) {
  if (!str) return '-'
  const d = new Date(str + (str.length <= 10 ? 'T12:00:00' : ''))
  return d.toLocaleDateString('pt-BR')
}

function diffDays(a, b) {
  return Math.floor((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / (1000 * 60 * 60 * 24))
}

const WEBHOOK_STATUS_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/novo-pedido'

function buildOrderLink(orderId) {
  return `${window.location.origin}${window.location.pathname}?pedido=${orderId}`
}

function buildStatusWhatsApp(order, newStatus, extra = {}) {
  const link = buildOrderLink(order.id)
  const nome = order.customer?.nome || 'Cliente'
  const id = `#${order.id.toString().slice(-6)}`
  const msgItems = order.items.map(i => `  • ${i.nome} (${i.qty}x) — R$ ${i.preco.toFixed(2)}`).join('\n')
  const msgPagamento = order.pagamento === 'avista' ? 'À Vista' : order.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'

  const templates = {
    'pre-pedido': `⏳ *PRÉ-PEDIDO EM ANÁLISE* ⏳
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pré-pedido foi recebido e está em análise pela nossa equipe.
Em breve você receberá a confirmação.
━━━━━━━━━━━━━━━━━━
🔗 Acompanhe seu pedido: ${link}`,

    'pendente': `🆕 *PEDIDO RECEBIDO* 🆕
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
💳 Pagamento: ${msgPagamento}
💰 Total: R$ ${order.total.toFixed(2)}
━━━━━━━━━━━━━━━━━━
${msgItems}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido foi recebido com sucesso!
Em breve confirmaremos seu pedido.
━━━━━━━━━━━━━━━━━━
🔗 Acompanhe seu pedido: ${link}`,

    'confirmado': `✅ *PEDIDO CONFIRMADO* ✅
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido foi confirmado!
Em breve entraremos em contato para combinar a entrega.
━━━━━━━━━━━━━━━━━━
🔗 Acompanhe seu pedido: ${link}`,

    'em-andamento': `📋 *PEDIDO EM ANDAMENTO* 📋
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido está em andamento e sendo preparado para entrega.
━━━━━━━━━━━━━━━━━━
🔗 Acompanhe seu pedido: ${link}`,

    'em-rota': `🚚 *PEDIDO EM ROTA* 🚚
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
💳 Pagamento: ${msgPagamento}
💰 Total: R$ ${order.total.toFixed(2)}
━━━━━━━━━━━━━━━━━━
📦 *ITENS:*
${msgItems}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido saiu para entrega!
🔗 Acesse seu pedido: ${link}`,

    'entregue': extra.returnedItems?.length > 0
      ? `✅ *PEDIDO FINALIZADO* ✅
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido foi finalizado!
📦 Itens entregues:
${order.items.map(i => `  • ${i.nome} (${i.qty}x) — R$ ${(i.preco * i.qty).toFixed(2)}`).join('\n')}
📦 Itens devolvidos:
${extra.returnedItems.map(i => `  • ${i.nome} (${i.returnedQty}x) — R$ ${(i.preco * (i.returnedQty || 0)).toFixed(2)}`).join('\n')}
💰 Total cobrado: R$ ${order.total.toFixed(2)}
━━━━━━━━━━━━━━━━━━
⚠️ *Importante:* Produtos embalados/lacrados não podem ser abertos. Não aceitamos devolução de produtos violados.
Você tem até 24 horas para nos informar se houver algum item faltando ou com avaria.
━━━━━━━━━━━━━━━━━━
Obrigado pela preferência! 🎉`
      : `✅ *PEDIDO ENTREGUE* ✅
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido foi entregue com sucesso! 🎉
${order.items.length > 0 ? `📦 Itens:\n${order.items.map(i => `  • ${i.nome} (${i.qty}x) — R$ ${(i.preco * i.qty).toFixed(2)}`).join('\n')}\n` : ''}
⚠️ *Importante:* Produtos embalados/lacrados não podem ser abertos. Não aceitamos devolução de produtos violados.
Você tem até 24 horas para nos informar se houver algum item faltando ou com avaria.
━━━━━━━━━━━━━━━━━━
Obrigado pela preferência!
━━━━━━━━━━━━━━━━━━
🔗 Acompanhe: ${link}`,

    'cancelado': `❌ *PEDIDO CANCELADO* ❌
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido foi cancelado.
Em caso de dúvidas, entre em contato conosco.
━━━━━━━━━━━━━━━━━━`
  }

  return templates[newStatus] || `📋 *Atualização do Pedido ${id}* 📋\n━━━━━━━━━━━━━━━━━━\nStatus: ${newStatus}\n🔗 ${link}`
}

function sendStatusWebhook(order, newStatus, extra = {}) {
  const whatsappMessage = buildStatusWhatsApp(order, newStatus, extra)
  const returnedItems = extra.returnedItems || order.returnedItems || []
  fetch(WEBHOOK_STATUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'atualizacao-pedido',
      whatsappMessage,
      order: {
        id: order.id,
        date: order.date,
        status: newStatus,
        pagamento: order.pagamento,
        total: order.total,
        totalAvista: order.totalAvista,
        totalAprazo: order.totalAprazo,
        customer: order.customer,
        items: order.items.map(i => ({ nome: i.nome, qty: i.qty, preco: i.preco, tipo: i.tipo })),
        ...(returnedItems.length > 0 ? { returnedItems: returnedItems.map(i => ({ nome: i.nome, returnedQty: i.returnedQty || i.qty, preco: i.preco })) } : {})
      }
    })
  }).catch(() => {})
}

function sendAlertRota(tipo, contatos, orders, customText = '') {
  function formatDate(str) {
    if (!str) return '-'
    const d = new Date(str + (str.length <= 10 ? 'T12:00:00' : ''))
    return d.toLocaleDateString('pt-BR')
  }
  function formatPreco(v) {
    return `R$ ${Number(v).toFixed(2).replace('.', ',')}`
  }
  const contacts = contatos.map((c) => {
    const telefone = c.remoteJid?.replace(/@.*/, '').replace(/\D/g, '') || ''
    const normalizedPhone = telefone.startsWith('55') ? telefone : '55' + telefone
    let loginLink = ''
    if (telefone) {
      loginLink = `${window.location.origin}${window.location.pathname}?login=${btoa(normalizedPhone)}`
    }
    const userOrders = (orders || []).filter(o => {
      const ot = o.customer?.telefone || ''
      return ot === normalizedPhone || ot === telefone
    })
    const openOrders = userOrders.filter(o => !['entregue', 'cancelado'].includes(o.status))
    const lastOrder = openOrders[0]
    let whatsappMessage = ''
    const nome = c.pushName || c.nome || 'Cliente'
    if (tipo === 'personalizado') {
      whatsappMessage = customText
    } else if (tipo === 'alerta') {
      if (lastOrder) {
        const itens = lastOrder.items?.slice(0, 3).map(i => `  • ${i.nome} (${i.qty}x)`).join('\n') || ''
        const extras = lastOrder.items?.length > 3 ? `\n  ...e mais ${lastOrder.items.length - 3} item(ns)` : ''
        whatsappMessage = `🚚 *PASSANDO NA SUA CIDADE!* 🚚\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n📋 Pedido #${lastOrder.id.toString().slice(-6)}\n📌 Status: ${lastOrder.status}\n💵 Total: ${formatPreco(lastOrder.total)}\n${itens}${extras}\n━━━━━━━━━━━━━━━━━━\nEstamos na sua região! Seu pedido está em aberto.\n🔗 Acesse sua conta: ${loginLink}`
      } else {
        whatsappMessage = `🚚 *PASSANDO NA SUA CIDADE!* 🚚\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nEstamos passando na sua cidade! Aproveite para fazer seu pedido.\n🔗 Faça já seu pedido: ${loginLink}`
      }
    } else if (tipo === 'atualizacao') {
      if (lastOrder) {
        const itens = lastOrder.items?.slice(0, 3).map(i => `  • ${i.nome} (${i.qty}x) — ${formatPreco(i.preco * i.qty)}`).join('\n') || ''
        const extras = lastOrder.items?.length > 3 ? `\n  ...e mais ${lastOrder.items.length - 3} item(ns)` : ''
        const dataPedido = formatDate(lastOrder.date || lastOrder.createdAt)
        const finRecords = JSON.parse(localStorage.getItem('thsm_admin_financeiro') || '[]')
          .filter(f => f.orderId === lastOrder.id && f.status === 'pendente')
        const vencimentos = finRecords.slice(0, 2).map(f => `  📅 ${f.itemName}: ${formatDate(f.dueDate)} — ${formatPreco(f.value)}`).join('\n')
        const vencExtras = finRecords.length > 2 ? `\n  ...e mais ${finRecords.length - 2} parcela(s)` : ''
        whatsappMessage = `📋 *ATUALIZAÇÃO DO PEDIDO* 📋\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n📋 Pedido: #${lastOrder.id.toString().slice(-6)}\n📅 Data: ${dataPedido}\n📌 Status: ${lastOrder.status}\n${itens}${extras}\n💵 Total: ${formatPreco(lastOrder.total)}${vencimentos ? `\n━━━━━━━━━━━━━━━━━━\n📆 *Pendências:*\n${vencimentos}${vencExtras}` : ''}\n━━━━━━━━━━━━━━━━━━\n🔗 Acompanhe seu pedido: ${loginLink}`
      } else {
        whatsappMessage = `📋 *ATUALIZAÇÃO* 📋\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nVocê ainda não tem pedidos conosco.\nAproveite para fazer seu pedido agora!\n🔗 Fazer pedido: ${loginLink}`
      }
    }
    return {
      remoteJid: c.remoteJid,
      pushName: c.pushName || c.nome || '',
      cidade: c.cidade || '',
      rota: c.rota || '',
      telefone,
      loginLink,
      whatsappMessage
    }
  })
  const payload = {
    event: tipo === 'alerta' ? 'alertar-rotas' : tipo === 'atualizacao' ? 'atualizacao-pedidos' : 'personalizado',
    contacts,
    ...(tipo === 'personalizado' && customText ? { message: customText } : {})
  }
  fetch(ALERTAR_ROTAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {})
}

import AddressForm from '../components/AddressForm'
import MapView from '../components/MapView'

export default function Admin({ produtos, onVoltar }) {
  const [tab, setTab] = useState(() => sessionStorage.getItem('thsm_admin_tab') || 'dashboard')
  useEffect(() => { sessionStorage.setItem('thsm_admin_tab', tab) }, [tab])
  const [orders, setOrders] = useState([])
  const [prodChanges, setProdChanges] = useState(() => LS.get(STORAGE_PRODUCTS, {}))
  const [financial, setFinancial] = useState(() => LS.get(STORAGE_FINANCIAL, []))
  const [toast, setToast] = useState(null)
  const [orderFilter, setOrderFilter] = useState('todos')
  const [prodSearch, setProdSearch] = useState('')
  const [prodPage, setProdPage] = useState(1)
  const [editingProd, setEditingProd] = useState(null)
  const [prodViewMode, setProdViewMode] = useState('visual')
  const [prodCart, setProdCart] = useState({})
  const [prodCartOpen, setProdCartOpen] = useState(false)
  const [prodImageErrors, setProdImageErrors] = useState({})
  const [showAddOrder, setShowAddOrder] = useState(false)
  const [preselectedUserForOrder, setPreselectedUserForOrder] = useState(null)
  const [showOrderDetail, setShowOrderDetail] = useState(null)
  const [showDeliveryModal, setShowDeliveryModal] = useState(null)
  const [returnQuantities, setReturnQuantities] = useState({})
  const [payQuantities, setPayQuantities] = useState({})
  const [identityPreview, setIdentityPreview] = useState('')
  const [addressPreview, setAddressPreview] = useState('')
  const [finFilter, setFinFilter] = useState('todos')
  const [finEdit, setFinEdit] = useState(null)
  const [usuarios, setUsuarios] = useState([])
  const [syncingUsers, setSyncingUsers] = useState(false)
  const [selectedUserEmail, setSelectedUserEmail] = useState(null)
  const [selectedUserDetail, setSelectedUserDetail] = useState(null)
  const [editingUser, setEditingUser] = useState(false)
  const [editUserData, setEditUserData] = useState(null)
  const [userSearch, setUserSearch] = useState('')
  const [userCityFilter, setUserCityFilter] = useState('TODAS')
  const [userOrigemFilter, setUserOrigemFilter] = useState('TODAS')
  const [userEnderecoSearch, setUserEnderecoSearch] = useState('')
  const [userSort, setUserSort] = useState({ field: 'nome', dir: 'asc' })
  const [userPage, setUserPage] = useState(1)
  const [selectedUserIds, setSelectedUserIds] = useState(new Set())
  const [userMsgMenu, setUserMsgMenu] = useState(null)
  const USER_PAGE_SIZE = 50
  const [prodCatFilter, setProdCatFilter] = useState('TODOS')
  const [prodStockFilter, setProdStockFilter] = useState('todos')
  const [prodPriceRange, setProdPriceRange] = useState([0, 5000])
  const [prodSort, setProdSort] = useState({ field: 'nome', dir: 'asc' })
  const [prodSelectedIds, setProdSelectedIds] = useState(new Set())
  const [showBulkPrice, setShowBulkPrice] = useState(false)
  const [bulkPriceValue, setBulkPriceValue] = useState('')
  const [showBulkStock, setShowBulkStock] = useState(false)
  const [bulkStockValue, setBulkStockValue] = useState('')
  const [leads, setLeads] = useState([])
  const [orderSearch, setOrderSearch] = useState('')
  const [orderSort, setOrderSort] = useState({ field: 'createdAt', dir: 'desc' })
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [orderDateStart, setOrderDateStart] = useState('')
  const [orderDateEnd, setOrderDateEnd] = useState('')
  const [orderCityFilter, setOrderCityFilter] = useState('TODAS')
  const [orderPage, setOrderPage] = useState(1)
  const ORDER_PAGE_SIZE = 50
  const [rotas, setRotas] = useState([])
  const [rotasLoading, setRotasLoading] = useState(false)
  const [importingRotas, setImportingRotas] = useState(false)
  const [rotasError, setRotasError] = useState(null)
  const [expandedRota, setExpandedRota] = useState(null)
  const [filterCidade, setFilterCidade] = useState('TODAS')
  const [filterRota, setFilterRota] = useState('TODAS')
  const [filterRotaSearch, setFilterRotaSearch] = useState('')
  const [customMsgRota, setCustomMsgRota] = useState(null)
  const [customMsgText, setCustomMsgText] = useState('')
  const [showNewRota, setShowNewRota] = useState(false)
  const [newRotaName, setNewRotaName] = useState('')
  const [newRotaSearch, setNewRotaSearch] = useState('')
  const [newRotaSelected, setNewRotaSelected] = useState([])
  const [newContactPhone, setNewContactPhone] = useState('')
  const [newContactName, setNewContactName] = useState('')
  const [editCustomContact, setEditCustomContact] = useState(null)
  const [editContactName, setEditContactName] = useState('')
  const [editContactPhone, setEditContactPhone] = useState('')
  const [editContactCity, setEditContactCity] = useState('')
  const [customRotas, setCustomRotas] = useState(() => LS.get(STORAGE_CUSTOM_ROTAS, []))
  const [kits, setKits] = useState(() => LS.get('thsm_kits', []))
  const [showKitModal, setShowKitModal] = useState(false)
  const [editingKit, setEditingKit] = useState(null)
  const [newProducts, setNewProducts] = useState(() => LS.get('thsm_admin_new_products', []))
  const PROD_PER_PAGE = 20

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  const buildAddressString = (e) => {
    return [e.rua, e.numero, e.bairro, e.cidade, e.estado].filter(Boolean).join(', ')
  }

  const openGoogleMaps = (addr) => {
    if (addr) window.open(`https://www.google.com/maps/search/${encodeURIComponent(addr)}`, '_blank')
  }

  const openRoutePlanning = (users) => {
    const addresses = users.map(u => buildAddressString(u.endereco || {})).filter(Boolean)
    if (addresses.length === 0) return showToast('Nenhum endereço válido selecionado', 'error')
    window.open(`https://www.google.com/maps/dir/${addresses.map(a => encodeURIComponent(a)).join('/')}`, '_blank')
  }

  const USER_MSG_TEMPLATES = [
    { key: 'passando', label: 'Passando na sua cidade', icon: 'fa-truck', msg: (nome) => `🚚 *PASSANDO NA SUA CIDADE!* 🚚\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nEstamos passando na sua cidade! Aproveite para fazer seu pedido.\n🔗 Faça já seu pedido: ${window.location.origin}${window.location.pathname}` },
    { key: 'acerto', label: 'Acerto financeiro', icon: 'fa-coins', msg: (nome) => `💰 *ACERTO FINANCEIRO* 💰\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nOlá! Passando para lembrar sobre o acerto financeiro pendente.\n🔗 Acesse sua conta: ${window.location.origin}${window.location.pathname}?login=` },
    { key: 'pedido', label: 'Novidades no catálogo', icon: 'fa-tag', msg: (nome) => `🛍️ *NOVIDADES NO CATÁLOGO!* 🛍️\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nTemos novidades incríveis no catálogo! Venha conferir.\n🔗 Ver catálogo: ${window.location.origin}${window.location.pathname}` },
    { key: 'personalizado', label: 'Personalizado', icon: 'fa-pen', msg: (nome) => '' },
  ]

  const sendUserWhatsApp = (u, templateKey) => {
    const phone = (u.telefone || '').replace(/\D/g, '')
    if (!phone) return showToast('Usuário sem telefone', 'error')
    const nome = u.nome || u.pushName || 'Cliente'
    const template = USER_MSG_TEMPLATES.find(t => t.key === templateKey)
    if (!template) return
    if (templateKey === 'personalizado') {
      const msg = prompt('Digite a mensagem:')
      if (msg) window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`, '_blank')
      return
    }
    const msg = template.msg(nome)
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`, '_blank')
    setUserMsgMenu(null)
  }

  useEffect(() => {
    if (orders.length > 0) upsertOrders(orders)
  }, [orders])
  useEffect(() => {
    LS.set(STORAGE_PRODUCTS, prodChanges)
    if (Object.keys(prodChanges).length > 0) upsertProducts(prodChanges)
  }, [prodChanges])
  useEffect(() => { LS.set(STORAGE_CUSTOM_ROTAS, customRotas) }, [customRotas])
  useEffect(() => {
    LS.set(STORAGE_FINANCIAL, financial)
    if (financial.length > 0) upsertFinancial(financial)
  }, [financial])

  const fetchRotas = useCallback(async () => {
    setRotasLoading(true)
    setRotasError(null)
    try {
      let allContacts = []
      let offset = 0
      const PAGE_SIZE = 1000
      const MAX_PAGES = 10
      const seen = new Set()

      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetch(LISTA_CONTATOS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset, limit: PAGE_SIZE })
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const arr = Array.isArray(data) ? data : (data.code === 0 ? [] : [data])
        if (arr.length === 0) break

        const newContacts = arr.filter(c => {
          const key = c.remoteJid || c.pushName || Math.random()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })

        if (newContacts.length === 0) break

        allContacts = allContacts.concat(newContacts)
        offset += arr.length

        if (arr.length < PAGE_SIZE) break
      }

      setRotas(allContacts)
    } catch (e) {
      setRotasError(e.message)
    } finally {
      setRotasLoading(false)
    }
  }, [])

  useEffect(() => {
    setSyncingUsers(true)
    syncAllForAdmin().then(({ orders: o, financial: f, users: u, rotas: r, products: p }) => {
      if (o.length) {
        setOrders(prev => {
          const map = new Map()
          o.forEach(ord => map.set(ord.id, ord))
          prev.forEach(ord => map.set(ord.id, ord))
          return Array.from(map.values())
        })
      }
      if (f.length) {
        setFinancial(prev => {
          const map = new Map()
          f.forEach(fin => map.set(fin.id, fin))
          prev.forEach(fin => map.set(fin.id, fin))
          const merged = Array.from(map.values())
          LS.set(STORAGE_FINANCIAL, merged)
          return merged
        })
      }
      LS.set('thsm_usuarios', u); setUsuarios(u)
      if (r.length) { setRotas(r) } else { fetchRotas() }
      if (p.length) {
        const fromDB = {}
        const variantsDB = {}
        p.forEach(prod => {
          const override = {}
          if (prod.preco !== null) override.preco = prod.preco
          if (prod.estoque !== null) override.estoque = prod.estoque
          if (prod.imagem !== null) override.imagem = prod.imagem
          if (prod.categoria !== null) override.categoria = prod.categoria
          if (Object.keys(override).length > 0) fromDB[prod.id] = override
          if (prod.variantes && Object.keys(prod.variantes).length > 0) {
            variantsDB[prod.id] = prod.variantes
          }
        })
        if (Object.keys(variantsDB).length > 0) {
          try {
            const existing = JSON.parse(localStorage.getItem('thsm_prod_variants') || '{}')
            localStorage.setItem('thsm_prod_variants', JSON.stringify({ ...existing, ...variantsDB }))
          } catch {}
        }
        setProdChanges(prev => {
          const merged = { ...fromDB, ...prev }
          LS.set(STORAGE_PRODUCTS, merged)
          return merged
        })
      }
    }).catch(e => { console.error('syncAllForAdmin error:', e) })
      .finally(() => setSyncingUsers(false))
    getAllLeads().then(setLeads).catch(() => {})
  }, [])

  // Auto-expand first rota when rotas load
  useEffect(() => {
    if (rotas.length > 0 && !expandedRota) setExpandedRota(rotas[0].rota)
  }, [rotas, expandedRota])

  useEffect(() => { LS.set('thsm_admin_new_products', newProducts) }, [newProducts])

  const produtosAtuais = useMemo(() => {
    const base = produtos.map(p => ({
      ...p,
      ...(prodChanges[p.id] || {})
    }))
    const news = newProducts.map(p => ({ ...p, ...(prodChanges[p.id] || {}) }))
    return [...news, ...base]
  }, [produtos, prodChanges, newProducts])

  // =============================================
  // ORDERS
  // =============================================
  const addOrder = async (data) => {
    const items = data.items
    const totalAvista = items.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
    const totalAprazo = items.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
    const order = {
      id: Date.now(),
      date: hoje(),
      customer: { nome: data.nome, telefone: data.telefone, cpf: data.cpf || '', endereco: data.endereco || { cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' } },
      items,
      pagamento: data.pagamento,
      totalAvista,
      totalAprazo,
      total: totalAvista + totalAprazo,
      status: 'pendente',
      createdAt: Date.now()
    }
    setOrders(prev => [order, ...prev])

    // Upsert user to Supabase and update local list
    const existingUser = usuarios.find(u => u.telefone === data.telefone)
    const mergedEndereco = { ...(existingUser?.endereco || {}), ...(data.endereco || {}), origem: existingUser?.endereco?.origem || 'Admin' }
    const savedUser = await upsertUser({
      telefone: data.telefone,
      nome: data.nome,
      email: data.email || '',
      cpf: data.cpf || '',
      endereco: mergedEndereco
    })
    if (savedUser) {
      order.user_id = savedUser.id
      setUsuarios(prev => {
        const idx = prev.findIndex(u => u.telefone === savedUser.telefone)
        if (idx >= 0) {
          const updated = [...prev]
          updated[idx] = savedUser
          return updated
        }
        return [savedUser, ...prev]
      })
    }

    // Create financial records for "a prazo" items
    const finRecords = items.filter(i => i.tipo === 'aprazo').map(i => {
      const dias = data.diasParaVencimento || 30
      const due = new Date()
      due.setDate(due.getDate() + dias)
      return {
        id: order.id + '-' + i.id,
        orderId: order.id,
        customerName: data.nome,
        itemName: i.nome,
        qty: i.qty,
        value: i.preco * i.qty,
        dueDate: due.toISOString().split('T')[0],
        paidDate: null,
        status: 'pendente'
      }
    })
    if (finRecords.length > 0) {
      setFinancial(prev => [...finRecords, ...prev])
    }

    showToast('Pedido adicionado com sucesso!')
    setShowAddOrder(false)
    sendStatusWebhook(order, order.status)
  }

  const updateOrderStatus = (id, status) => {
    const order = orders.find(o => o.id === id)
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o))
    if (status === 'entregue') {
      setFinancial(prev => prev.map(f => f.orderId === id && f.status !== 'pago' ? { ...f, status: 'pago', paidDate: hoje() } : f))
    }
    showToast(`Pedido #${id} atualizado para "${status}"`)
    if (order) sendStatusWebhook(order, status)
  }

  const preApprovarPedido = (orderId, rejectedItemIds, replacements = []) => {
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    const rejected = new Set(rejectedItemIds)
    let remainingItems = order.items.filter((_, idx) => !rejected.has(idx))
    if (replacements.length > 0) {
      remainingItems = [...remainingItems, ...replacements]
    }
    if (remainingItems.length === 0) { showToast('Não é possível aprovar um pedido sem itens', 'error'); return }
    const totalAvista = remainingItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
    const totalAprazo = remainingItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
    const now = Date.now()
    const updatedOrder = {
      ...order,
      items: remainingItems,
      totalAvista,
      totalAprazo,
      total: totalAvista + totalAprazo,
      status: 'pendente',
      preApprovedAt: now,
      rejectedItems: rejectedItemIds.length > 0 ? rejectedItemIds.map(idx => order.items[idx]) : []
    }
    setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o))
    // Create financial records for approved a-prazo items
    const finRecords = remainingItems.filter(i => i.tipo === 'aprazo').map(i => {
      const dias = 60
      const due = new Date()
      due.setDate(due.getDate() + dias)
      return {
        id: orderId + '-' + i.id,
        orderId,
        customerName: order.customer?.nome || '',
        itemName: i.nome,
        qty: i.qty,
        value: i.preco * i.qty,
        dueDate: due.toISOString().split('T')[0],
        paidDate: null,
        status: 'pendente'
      }
    })
    if (finRecords.length > 0) setFinancial(prev => [...finRecords, ...prev])
    showToast(`Pedido #${orderId} revisado e enviado para "Pendente"`)
    setShowOrderDetail(null)
    sendStatusWebhook(updatedOrder, 'pendente')
  }

  const updateOrderCustomer = (id, customerData) => {
    const telefone = customerData.telefone?.replace(/\D/g, '') || ''
    setOrders(prev => prev.map(o => o.id === id ? { ...o, customer: customerData } : o))
    setShowOrderDetail(prev => prev?.id === id ? { ...prev, customer: customerData } : prev)
    if (telefone) {
      const existingUser = usuarios.find(u => u.telefone === telefone)
      upsertUser({
        telefone,
        nome: customerData.nome,
        email: customerData.email || '',
        endereco: { ...(existingUser?.endereco || {}), ...customerData.endereco, cpf: customerData.cpf || existingUser?.endereco?.cpf || '' }
      }).then(saved => {
        if (saved) {
          setUsuarios(prev => prev.map(u => u.telefone === saved.telefone ? saved : u))
          setOrders(prev => prev.map(o =>
            o.customer?.telefone?.replace(/\D/g, '') === telefone
              ? { ...o, customer: { ...o.customer, nome: customerData.nome } }
              : o
          ))
        }
      })
    }
    showToast('Dados do cliente atualizados!')
  }

  const cancelOrder = (id) => {
    const order = orders.find(o => o.id === id)
    if (!order) return
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'cancelado' } : o))
    setFinancial(prev => prev.map(f => f.orderId === id ? { ...f, status: 'cancelado' } : f))
    setShowOrderDetail(null)
    showToast(`Pedido #${id} cancelado!`)
    sendStatusWebhook(order, 'cancelado')
  }

  const handleDeliveryFile = (e, type) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      if (type === 'identity') setIdentityPreview(ev.target.result)
      else setAddressPreview(ev.target.result)
    }
    reader.readAsDataURL(file)
  }

  const finalizarComDevolucao = (orderId) => {
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    if (!order.preApprovedAt) { showToast('Erro: pedido sem data de início', 'error'); return }
    const dias = Math.floor((Date.now() - order.preApprovedAt) / (1000 * 60 * 60 * 24))
    if (dias < 60 && !window.confirm(`Apenas ${dias} dias desde o início. Deseja finalizar mesmo assim?`)) return
    const returnedItems = []
    const remainingItems = order.items.filter(i => {
      const qty = returnQuantities[i.id] || 0
      if (qty > 0) returnedItems.push({ ...i, returnedQty: Math.min(qty, i.qty) })
      return (i.qty - (returnQuantities[i.id] || 0)) > 0
    })
    const adjustedItems = remainingItems.map(i => ({
      ...i,
      qty: i.qty - (returnQuantities[i.id] || 0)
    }))
    const totalAvista = adjustedItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
    const totalAprazo = adjustedItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
    const totalReembolso = order.items.reduce((s, i) => s + i.preco * (returnQuantities[i.id] || 0), 0)
    const updatedOrder = {
      ...order,
      items: adjustedItems,
      totalAvista,
      totalAprazo,
      total: totalAvista + totalAprazo,
      status: 'entregue',
      returnedItems,
      totalReembolso,
      identityPhoto: identityPreview || order.identityPhoto || '',
      addressProof: addressPreview || order.addressProof || '',
      deliveredAt: Date.now()
    }
    setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o))
    // Sync financeiro: update existing, create for missing items
    setFinancial(prev => {
      const existing = prev.filter(f => f.orderId === orderId)
      const existingIds = new Set(existing.map(f => f.id))
      const newRecords = adjustedItems
        .filter(i => !existingIds.has(orderId + '-' + i.id))
        .map(i => ({
          id: orderId + '-' + i.id,
          orderId,
          customerName: order.customer?.nome || '',
          itemName: i.nome,
          qty: i.qty,
          value: i.preco * i.qty,
          dueDate: hoje(),
          paidDate: hoje(),
          status: i.tipo === 'aprazo' ? 'pendente' : 'pago'
        }))
      const updated = prev.map(f => {
        if (f.orderId !== orderId) return f
        const item = order.items.find(i => f.id === orderId + '-' + i.id)
        if (!item) return f
        const returnedQty = returnQuantities[item.id] || 0
        if (returnedQty >= item.qty) return { ...f, status: 'cancelado', paidDate: hoje() }
        const remainingQty = item.qty - returnedQty
        return { ...f, qty: remainingQty, value: item.preco * remainingQty, status: 'pago', paidDate: hoje() }
      })
      return [...updated, ...newRecords]
    })
    const refundMsg = totalReembolso > 0 ? ` — Reembolso: ${formatPreco(totalReembolso)}` : ''
    showToast(`Pedido #${orderId} finalizado!${refundMsg}`)
    sendStatusWebhook(updatedOrder, 'entregue', { returnedItems })
    setShowDeliveryModal(null)
    setReturnQuantities({})
    setPayQuantities({})
    setIdentityPreview('')
    setAddressPreview('')
  }

  const deleteOrder = (id) => {
    if (!confirm('Excluir este pedido?')) return
    setOrders(prev => prev.filter(o => o.id !== id))
    setFinancial(prev => prev.filter(f => f.orderId !== id))
    supabaseDeleteOrder(id)
    showToast('Pedido excluído')
  }

  const saveUserEdit = async () => {
    if (!editUserData) return
    const payload = {
      telefone: editUserData.telefone,
      nome: editUserData.nome,
      email: editUserData.email || '',
      endereco: { ...(editUserData.endereco || {}) }
    }
    if (editUserData.senha) payload.endereco.senha = editUserData.senha
    else if (selectedUserDetail?.endereco?.senha) payload.endereco.senha = selectedUserDetail.endereco.senha

    const saved = await upsertUser(payload)
    if (saved) {
      setUsuarios(prev => prev.map(u => u.telefone === saved.telefone ? saved : u))
      setSelectedUserDetail(saved)
      setEditingUser(false)
      setEditUserData(null)
      showToast('Usuário atualizado com sucesso!')
    } else {
      showToast('Erro ao salvar usuário', 'error')
    }
  }

  const gerarSenhasUsuarios = async () => {
    if (!confirm('Gerar senha para todos os usuários que não têm? (Senha = primeiro nome + 4 últimos dígitos do telefone)')) return
    const semSenha = usuarios.filter(u => !u.endereco?.senha)
    if (semSenha.length === 0) { showToast('Todos os usuários já têm senha!', 'warning'); return }
    let count = 0
    for (const u of semSenha) {
      const primeiroNome = (u.nome || 'Usuario').split(' ')[0]
      const ultimos4 = (u.telefone || '').replace(/\D/g, '').slice(-4)
      const senha = primeiroNome + ultimos4
      const endereco = { ...(u.endereco || {}), senha }
      const saved = await upsertUser({ telefone: u.telefone, nome: u.nome, email: u.email || '', endereco })
      if (saved) {
        setUsuarios(prev => prev.map(x => x.telefone === saved.telefone ? saved : x))
        count++
      }
    }
    showToast(`${count} senha(s) gerada(s) com sucesso!`)
  }

  const handleDeleteUser = async (user) => {
    if (!confirm(`Tem certeza que deseja excluir "${user.nome}" (${user.telefone})?\n\nIsso também excluirá todos os pedidos e financeiro deste usuário.`)) return
    const { error, deletedOrders } = await deleteUserByTelefone(user.telefone)
    if (error) { showToast('Erro ao excluir usuário', 'error'); return }
    setUsuarios(prev => prev.filter(u => u.telefone !== user.telefone))
    if (selectedUserDetail?.telefone === user.telefone) setSelectedUserDetail(null)
    showToast(`Usuário excluído! ${deletedOrders > 0 ? `${deletedOrders} pedido(s) removido(s).` : ''}`)
  }

  const formatPhone = (v) => {
    const nums = v.replace(/\D/g, '')
    if (nums.length <= 2) return `(${nums}`
    if (nums.length <= 7) return `(${nums.slice(0, 2)}) ${nums.slice(2)}`
    return `(${nums.slice(0, 2)}) ${nums.slice(2, 7)}-${nums.slice(7)}`
  }

  const cidadesOrders = useMemo(() => {
    const cidades = [...new Set(orders.map(o => o.customer?.endereco?.cidade).filter(Boolean))]
    return ['TODAS', ...cidades.sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [orders])

  const userOrdersDetail = useMemo(() => {
    if (!selectedUserDetail) return []
    return orders.filter(o => o.customer?.telefone === selectedUserDetail.telefone || o.user_id === selectedUserDetail.id)
      .sort((a, b) => (b.createdAt || b.date || 0) - (a.createdAt || a.date || 0))
  }, [orders, selectedUserDetail])

  const filteredOrders = useMemo(() => {
    let result = orders
    if (orderFilter === 'concluidos') result = result.filter(o => o.status === 'entregue' || o.status === 'cancelado')
    else if (orderFilter !== 'todos') result = result.filter(o => o.status === orderFilter)
    if (selectedUserEmail) result = result.filter(o => o.customer?.email === selectedUserEmail)
    const t = orderSearch.toLowerCase().trim()
    if (t) result = result.filter(o =>
      o.customer?.nome?.toLowerCase().includes(t) ||
      o.customer?.telefone?.includes(t) ||
      (o.customer?.endereco?.cidade || '').toLowerCase().includes(t)
    )
    if (orderDateStart) result = result.filter(o => (o.date || '') >= orderDateStart)
    if (orderDateEnd) result = result.filter(o => (o.date || '') <= orderDateEnd)
    if (orderCityFilter !== 'TODAS') result = result.filter(o => o.customer?.endereco?.cidade === orderCityFilter)
    result = [...result].sort((a, b) => {
      let va, vb
      switch (orderSort.field) {
        case 'cliente': va = a.customer?.nome || ''; vb = b.customer?.nome || ''; return orderSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'telefone': va = a.customer?.telefone || ''; vb = b.customer?.telefone || ''; return orderSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        case 'regiao': va = a.customer?.endereco?.cidade || ''; vb = b.customer?.endereco?.cidade || ''; return orderSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'data': return orderSort.dir === 'asc' ? (a.date || '').localeCompare(b.date || '') : (b.date || '').localeCompare(a.date || '')
        case 'itens': va = a.items?.reduce((s, i) => s + i.qty, 0) || 0; vb = b.items?.reduce((s, i) => s + i.qty, 0) || 0; return orderSort.dir === 'asc' ? va - vb : vb - va
        case 'total': return orderSort.dir === 'asc' ? (a.total || 0) - (b.total || 0) : (b.total || 0) - (a.total || 0)
        default: return (b.createdAt || 0) - (a.createdAt || 0)
      }
    })
    return result
  }, [orders, orderFilter, selectedUserEmail, orderSearch, orderSort, orderDateStart, orderDateEnd, orderCityFilter])

  const paginatedOrders = useMemo(() => {
    const start = (orderPage - 1) * ORDER_PAGE_SIZE
    return filteredOrders.slice(start, start + ORDER_PAGE_SIZE)
  }, [filteredOrders, orderPage])

  const totalOrderPages = useMemo(() => Math.ceil(filteredOrders.length / ORDER_PAGE_SIZE), [filteredOrders])

  useEffect(() => { setOrderPage(1) }, [orderSearch, orderFilter, orderDateStart, orderDateEnd, orderCityFilter, selectedUserEmail])

  const toggleSort = (field) => {
    setOrderSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' })
  }

  const sortIcon = (field) => {
    if (orderSort.field !== field) return <i className="fa-solid fa-sort" style={{ opacity: 0.3, marginLeft: 3, fontSize: '0.65rem' }}></i>
    return <i className={`fa-solid fa-sort-${orderSort.dir === 'asc' ? 'up' : 'down'}`} style={{ marginLeft: 3, fontSize: '0.65rem' }}></i>
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedOrders.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(paginatedOrders.map(o => o.id)))
  }

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const bulkAction = (action) => {
    if (selectedIds.size === 0) { showToast('Selecione pelo menos um pedido', 'error'); return }
    if (action === 'delete' && !confirm(`Excluir ${selectedIds.size} pedido(s)?`)) return
    selectedIds.forEach(id => {
      const order = orders.find(o => o.id === id)
      if (action === 'confirm') {
        if (order?.status === 'pre-pedido') updateOrderStatus(id, 'pendente')
        else if (order?.status === 'pendente') updateOrderStatus(id, 'em-rota')
        else updateOrderStatus(id, 'em-rota')
      } else if (action === 'delete') {
        setOrders(prev => prev.filter(o => o.id !== id))
        setFinancial(prev => prev.filter(f => f.orderId !== id))
      }
    })
    if (action === 'delete') showToast(`${selectedIds.size} pedido(s) excluído(s)`)
    setSelectedIds(new Set())
  }

  const sendWhatsApp = (o) => {
    const end = o.customer?.endereco
    let msg = `🛒 *NOVO PEDIDO - THSM Distribuidora*\n\n`
    msg += `👤 *Cliente:* ${o.customer?.nome || ''}\n`
    msg += `📧 *Email:* ${o.customer?.email || ''}\n`
    msg += `📞 *Telefone:* ${o.customer?.telefone || ''}\n`
    if (end?.rua || end?.cidade) {
      const parts = []
      if (end.rua) parts.push(end.rua + (end.numero ? `, ${end.numero}` : ''))
      if (end.bairro) parts.push(end.bairro)
      const cityState = [end.cidade, end.estado].filter(Boolean).join('/')
      if (cityState) parts.push(cityState)
      if (end.complemento) parts.push(end.complemento)
      if (end.cep) parts.push(`CEP: ${end.cep}`)
      msg += `📍 *Endereço:* ${parts.join(', ')}\n`
    }
    msg += `─────────────────────\n\n`
    const itensAvista = o.items.filter(i => i.tipo === 'avista')
    const itensAprazo = o.items.filter(i => i.tipo === 'aprazo')
    if (itensAvista.length) {
      msg += `💵 *À VISTA:*\n`
      itensAvista.forEach(i => msg += `• ${i.nome} (${i.qty}x) = ${formatPreco(i.preco * i.qty)}\n`)
      msg += '\n'
    }
    if (itensAprazo.length) {
      msg += `📋 *A PRAZO:*\n`
      itensAprazo.forEach(i => msg += `• ${i.nome} (${i.qty}x) = ${formatPreco(i.preco * i.qty)}\n`)
      msg += '\n'
    }
    msg += `─────────────────────\n`
    msg += `💰 *Total geral: ${formatPreco(o.total)}*\n`
    msg += `💳 *Pagamento:* ${o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}`
    if (o.returnedItems?.length > 0) {
      msg += `\n\n📦 *ITENS DEVOLVIDOS:*\n`
      o.returnedItems.forEach(i => msg += `• ${i.nome} (${i.returnedQty}x) = ${formatPreco(i.preco * (i.returnedQty || 0))}\n`)
    }
    const phone = (o.customer?.telefone || '5531998461300').replace(/\D/g, '')
    const waNumber = phone.startsWith('55') ? phone : '55' + phone
    window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}`, '_blank')
  }

  // Stats
  const stats = useMemo(() => {
    const total = orders.length
    const pendentes = orders.filter(o => o.status === 'pendente').length
    const prePedidos = orders.filter(o => o.status === 'pre-pedido').length
    const confirmados = orders.filter(o => o.status === 'confirmado').length
    const emAndamento = orders.filter(o => o.status === 'em-andamento').length
    const emRota = orders.filter(o => o.status === 'em-rota').length
    const entregues = orders.filter(o => o.status === 'entregue').length
    const faturamento = orders.filter(o => o.status !== 'cancelado').reduce((s, o) => s + o.total, 0)
    const aReceber = financial.filter(f => f.status === 'pendente').reduce((s, f) => s + f.value, 0)
    const recebido = financial.filter(f => f.status === 'pago').reduce((s, f) => s + f.value, 0)
    return { total, pendentes, prePedidos, confirmados, emAndamento, entregues, faturamento, aReceber, recebido }
  }, [orders, financial])

  // Usuarios filter & pagination
  const filteredUsuarios = useMemo(() => {
    let result = usuarios
    const t = userSearch.toLowerCase().trim()
    const tEnd = userEnderecoSearch.toLowerCase().trim()
    if (selectedUserEmail || t || userCityFilter !== 'TODAS' || userOrigemFilter !== 'TODAS' || tEnd) {
      result = usuarios.filter(u => {
        if (userCityFilter !== 'TODAS') {
          const cidade = (u.endereco?.cidade || u.endereco?.cidade || '').toLowerCase()
          if (cidade !== userCityFilter.toLowerCase()) return false
        }
        if (userOrigemFilter !== 'TODAS') {
          const origem = u.endereco?.origem || ''
          if (origem !== userOrigemFilter) return false
        }
        if (tEnd) {
          const e = u.endereco || {}
          const addrStr = [e.rua, e.numero, e.bairro, e.cidade, e.estado, e.cep, e.complemento].filter(Boolean).join(' ').toLowerCase()
          if (!addrStr.includes(tEnd)) return false
        }
        if (t && !u.nome?.toLowerCase().includes(t) && !u.telefone?.includes(t) && !(u.email || '').toLowerCase().includes(t)) return false
        return true
      })
    }
    return result.sort((a, b) => {
      let va, vb
      switch (userSort.field) {
        case 'nome': va = a.nome || ''; vb = b.nome || ''; return userSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'telefone': va = a.telefone || ''; vb = b.telefone || ''; return userSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        case 'cidade': va = a.endereco?.cidade || ''; vb = b.endereco?.cidade || ''; return userSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        default: return (a.nome || '').localeCompare(b.nome || '', 'pt-BR')
      }
    })
  }, [usuarios, userSearch, userCityFilter, userOrigemFilter, userEnderecoSearch, userSort, selectedUserEmail])

  const paginatedUsuarios = useMemo(() => {
    const start = (userPage - 1) * USER_PAGE_SIZE
    return filteredUsuarios.slice(start, start + USER_PAGE_SIZE)
  }, [filteredUsuarios, userPage])

  const totalUserPages = useMemo(() => Math.ceil(filteredUsuarios.length / USER_PAGE_SIZE), [filteredUsuarios])

  useEffect(() => { setUserPage(1) }, [userSearch, userCityFilter, userOrigemFilter, userEnderecoSearch, selectedUserEmail])

  const userCities = useMemo(() => {
    const cidades = [...new Set(usuarios.map(u => u.endereco?.cidade).filter(Boolean))]
    return ['TODAS', ...cidades.sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [usuarios])

  // =============================================
  // PRODUCTS
  // =============================================
  const updateProduct = (id, changes) => {
    setProdChanges(prev => {
      const next = { ...prev, [id]: { ...(prev[id] || {}), ...changes } }
      LS.set(STORAGE_PRODUCTS, next)
      return next
    })
    showToast('Produto atualizado!')
    if (editingProd) setEditingProd(null)
  }

  const categoriasProd = useMemo(() => ['TODOS', ...[...new Set(produtos.map(p => p.categoria))].sort()], [produtos])

  const filteredProds = useMemo(() => {
    const t = prodSearch.toLowerCase().trim()
    const [pMin, pMax] = prodPriceRange
    return produtosAtuais.filter(p => {
      if (t && !p.nome.toLowerCase().includes(t) && !p.categoria.toLowerCase().includes(t)) return false
      if (prodCatFilter !== 'TODOS' && p.categoria !== prodCatFilter) return false
      if (prodStockFilter === 'in' && p.estoque <= 0) return false
      if (prodStockFilter === 'out' && p.estoque > 0) return false
      if (p.preco < pMin || p.preco > pMax) return false
      return true
    }).sort((a, b) => {
      let va, vb
      switch (prodSort.field) {
        case 'nome': va = a.nome; vb = b.nome; return prodSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'categoria': va = a.categoria; vb = b.categoria; return prodSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'preco': return prodSort.dir === 'asc' ? a.preco - b.preco : b.preco - a.preco
        case 'estoque': return prodSort.dir === 'asc' ? (a.estoque || 0) - (b.estoque || 0) : (b.estoque || 0) - (a.estoque || 0)
        default: return a.nome.localeCompare(b.nome, 'pt-BR')
      }
    })
  }, [produtosAtuais, prodSearch, prodCatFilter, prodStockFilter, prodPriceRange, prodSort])

  const totalProdPages = Math.ceil(filteredProds.length / PROD_PER_PAGE)
  const paginatedProds = filteredProds.slice((prodPage - 1) * PROD_PER_PAGE, prodPage * PROD_PER_PAGE)
  useEffect(() => { setProdPage(1) }, [prodSearch, prodCatFilter, prodStockFilter, prodPriceRange])

  const toggleProdSort = (field) => {
    setProdSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' })
  }

  const prodSortIcon = (field) => {
    if (prodSort.field !== field) return <i className="fa-solid fa-sort" style={{ opacity: 0.3, marginLeft: 3, fontSize: '0.65rem' }}></i>
    return <i className={`fa-solid fa-sort-${prodSort.dir === 'asc' ? 'up' : 'down'}`} style={{ marginLeft: 3, fontSize: '0.65rem' }}></i>
  }

  const toggleProdSelectAll = () => {
    if (prodSelectedIds.size === filteredProds.length) setProdSelectedIds(new Set())
    else setProdSelectedIds(new Set(filteredProds.map(p => p.id)))
  }

  const toggleProdSelect = (id) => {
    setProdSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const addToProdCart = (p) => {
    setProdCart(prev => {
      const existing = prev[p.id]
      if (existing) return { ...prev, [p.id]: { ...existing, qty: existing.qty + 1 } }
      return { ...prev, [p.id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, tipo: 'aprazo', qty: 1 } }
    })
  }

  const removeFromProdCart = (id) => {
    setProdCart(prev => {
      const existing = prev[id]
      if (!existing) return prev
      if (existing.qty <= 1) {
        const { [id]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [id]: { ...existing, qty: existing.qty - 1 } }
    })
  }

  const prodCartItems = useMemo(() => Object.values(prodCart).filter(i => i.qty > 0), [prodCart])
  const prodCartCount = useMemo(() => prodCartItems.reduce((s, i) => s + i.qty, 0), [prodCartItems])
  const prodCartTotal = useMemo(() => prodCartItems.reduce((s, i) => s + i.preco * i.qty, 0), [prodCartItems])

  const clearProdCart = () => setProdCart({})

  const createOrderFromCart = () => {
    if (prodCartItems.length === 0) { showToast('Carrinho vazio', 'error'); return }
    setShowAddOrder(true)
  }

  const toggleProdImageError = (id) => {
    setProdImageErrors(prev => ({ ...prev, [id]: true }))
  }

  const bulkProdAction = (action) => {
    if (prodSelectedIds.size === 0) { showToast('Selecione pelo menos um produto', 'error'); return }
    if (action === 'zerar') {
      if (!confirm(`Zerar estoque de ${prodSelectedIds.size} produto(s)?`)) return
      prodSelectedIds.forEach(id => updateProduct(id, { estoque: 0 }))
      showToast(`Estoque zerado para ${prodSelectedIds.size} produto(s)`)
    } else if (action === 'ocultar') {
      if (!confirm(`Marcar ${prodSelectedIds.size} produto(s) como indisponível?`)) return
      prodSelectedIds.forEach(id => updateProduct(id, { estoque: 0 }))
      showToast(`${prodSelectedIds.size} produto(s) marcados como indisponível`)
    } else if (action === 'preco') {
      setShowBulkPrice(true)
      return
    } else if (action === 'estoque') {
      setShowBulkStock(true)
      return
    }
    setProdSelectedIds(new Set())
  }

  const applyBulkPrice = () => {
    const val = parseFloat(bulkPriceValue)
    if (isNaN(val) || val < 0) { showToast('Valor inválido', 'error'); return }
    if (!confirm(`Definir preço R$ ${val.toFixed(2).replace('.', ',')} para ${prodSelectedIds.size} produto(s)?`)) return
    prodSelectedIds.forEach(id => updateProduct(id, { preco: val }))
    showToast(`Preço atualizado para ${prodSelectedIds.size} produto(s)`)
    setProdSelectedIds(new Set())
    setShowBulkPrice(false)
    setBulkPriceValue('')
  }

  const applyBulkStock = () => {
    const val = parseInt(bulkStockValue, 10)
    if (isNaN(val) || val < 0) { showToast('Valor inválido', 'error'); return }
    if (!confirm(`Definir estoque ${val} para ${prodSelectedIds.size} produto(s)?`)) return
    prodSelectedIds.forEach(id => updateProduct(id, { estoque: val }))
    showToast(`Estoque atualizado para ${prodSelectedIds.size} produto(s)`)
    setProdSelectedIds(new Set())
    setShowBulkStock(false)
    setBulkStockValue('')
  }

  // =============================================
  // FINANCIAL
  // =============================================
  const filteredFin = useMemo(() => {
    if (finFilter === 'todos') return financial
    return financial.filter(f => f.status === finFilter)
  }, [financial, finFilter])

  const finTotal = useMemo(() => {
    const pendente = financial.filter(f => f.status === 'pendente').reduce((s, f) => s + f.value, 0)
    const pago = financial.filter(f => f.status === 'pago').reduce((s, f) => s + f.value, 0)
    const atrasado = financial.filter(f => f.status === 'pendente' && diffDays(f.dueDate, hoje()) > 0).reduce((s, f) => s + f.value, 0)
    return { pendente, pago, atrasado }
  }, [financial])

  const quitarFin = (id) => {
    setFinancial(prev => prev.map(f => f.id === id ? { ...f, status: 'pago', paidDate: hoje() } : f))
    showToast('Conta marcada como paga!')
    setFinEdit(null)
  }

  const updateDueDate = (id, newDate) => {
    setFinancial(prev => prev.map(f => f.id === id ? { ...f, dueDate: newDate } : f))
    showToast('Vencimento atualizado!')
  }

  // =============================================
  // SIDEBAR
  // =============================================
  const rotasAgrupadas = useMemo(() => {
    const groups = {}
    rotas.forEach(r => {
      const rotaKey = r.rota || 'Sem rota'
      if (!groups[rotaKey]) groups[rotaKey] = { rota: rotaKey, cidades: {}, total: 0 }
      const cidadeKey = r.cidade || 'Sem cidade'
      if (!groups[rotaKey].cidades[cidadeKey]) groups[rotaKey].cidades[cidadeKey] = { cidade: cidadeKey, contatos: [] }
      groups[rotaKey].cidades[cidadeKey].contatos.push(r)
      groups[rotaKey].total++
    })
    customRotas.forEach(cr => {
      const rotaKey = cr.rota
      if (!groups[rotaKey]) groups[rotaKey] = { rota: rotaKey, cidades: {}, total: 0, _custom: true }
      cr.cidades.forEach(c => {
        const cidadeKey = c.cidade || 'Sem cidade'
        if (!groups[rotaKey].cidades[cidadeKey]) groups[rotaKey].cidades[cidadeKey] = { cidade: cidadeKey, contatos: [] }
        c.contatos.forEach(ct => {
          groups[rotaKey].cidades[cidadeKey].contatos.push(ct)
          groups[rotaKey].total++
        })
      })
    })
    return Object.values(groups).map(g => ({
      ...g,
      cidades: Object.values(g.cidades).sort((a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR'))
    }))
  }, [rotas])

  const cidadesRotas = useMemo(() => {
    const cidades = [...new Set(rotas.map(r => r.cidade).filter(Boolean))]
    return ['TODAS', ...cidades.sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [rotas])

  const rotasUnicas = useMemo(() => {
    const rotasList = [...new Set(rotas.map(r => r.rota).filter(Boolean))]
    return ['TODAS', ...rotasList.sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [rotas])

  const rotasFiltradas = useMemo(() => {
    let result = rotasAgrupadas
    if (filterCidade !== 'TODAS') result = result.filter(g => Object.values(g.cidades).some(c => c.cidade === filterCidade))
    if (filterRota !== 'TODAS') result = result.filter(g => g.rota === filterRota)
    const t = filterRotaSearch.toLowerCase().trim()
    if (t) result = result.filter(g =>
      g.rota.toLowerCase().includes(t) ||
      Object.values(g.cidades).some(c => c.cidade.toLowerCase().includes(t)) ||
      Object.values(g.cidades).some(c => c.contatos.some(ct => ct.pushName?.toLowerCase().includes(t)))
    )
    return result
  }, [rotasAgrupadas, filterCidade, filterRota, filterRotaSearch])

  const rotaStats = useMemo(() => {
    const totalContatos = rotas.length
    const totalRotas = rotasAgrupadas.length
    const totalCidades = cidadesRotas.length - 1
    return { totalContatos, totalRotas, totalCidades }
  }, [rotas, rotasAgrupadas, cidadesRotas])

  const sidebar = [
    { id: 'dashboard', icon: 'fa-chart-pie', label: 'Dashboard' },
    { id: 'pedidos', icon: 'fa-clipboard-list', label: 'Pedidos', count: stats.prePedidos + stats.pendentes },
    { id: 'produtos', icon: 'fa-boxes', label: 'Produtos' },
    { id: 'rotas', icon: 'fa-route', label: 'Rotas', count: rotaStats.totalRotas },
    { id: 'financeiro', icon: 'fa-coins', label: 'Financeiro', count: financial.filter(f => f.status === 'pendente').length },
    { id: 'usuarios', icon: 'fa-users', label: 'Usuários', count: usuarios.length },
    { id: 'leads', icon: 'fa-file-pen', label: 'Inscrições', count: leads.length },
    { id: 'mapa', icon: 'fa-map', label: 'Mapa' },
  ]

  return (
    <div className="admin">
      {toast && (
        <div className={`admin-toast admin-toast-${toast.type}`}>
          <i className={`fa-solid ${toast.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}`}></i>
          {toast.msg}
        </div>
      )}

      {/* SIDEBAR */}
      <aside className="admin-sidebar">
        <div className="admin-logo">
          <img src="/thsmdistribuidora.webp" alt="THSM" style={{ width: '28px', height: '28px', objectFit: 'contain', borderRadius: '4px' }} />
          <div>
            <strong>THSM Admin</strong>
            <span>Painel de Controle</span>
          </div>
        </div>
        <nav className="admin-nav">
          {sidebar.map(s => (
            <button key={s.id} className={`admin-nav-item ${tab === s.id ? 'active' : ''}`} onClick={() => setTab(s.id)}>
              <i className={`fa-solid ${s.icon}`}></i>
              <span>{s.label}</span>
              {s.count > 0 && <span className="admin-badge">{s.count}</span>}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <button className="admin-nav-item" onClick={onVoltar}>
            <i className="fa-solid fa-arrow-left"></i>
            <span>Voltar ao Catálogo</span>
          </button>
        </div>
      </aside>

      {/* CONTENT */}
      <main className="admin-content">
        {/* DASHBOARD */}
        {tab === 'dashboard' && (
          <div className="admin-section">
            <h1>Dashboard</h1>
            <p className="admin-subtitle">Resumo geral do sistema</p>

            <div className="admin-cards">
              <div className="admin-card card-blue">
                <i className="fa-solid fa-shopping-bag"></i>
                <div>
                  <strong>{stats.total}</strong>
                  <span>Total de Pedidos</span>
                </div>
              </div>
              <div className="admin-card card-yellow">
                <i className="fa-solid fa-hourglass-half"></i>
                <div>
                  <strong>{stats.pendentes}</strong>
                  <span>Pendentes</span>
                </div>
              </div>
              <div className="admin-card card-green">
                <i className="fa-solid fa-check-circle"></i>
                <div>
                  <strong>{stats.entregues}</strong>
                  <span>Entregues</span>
                </div>
              </div>
              <div className="admin-card card-purple">
                <i className="fa-solid fa-dollar-sign"></i>
                <div>
                  <strong>{formatPreco(stats.faturamento)}</strong>
                  <span>Faturamento Total</span>
                </div>
              </div>
              <div className="admin-card card-red">
                <i className="fa-solid fa-clock"></i>
                <div>
                  <strong>{formatPreco(stats.aReceber)}</strong>
                  <span>A Receber (Prazo)</span>
                </div>
              </div>
              <div className="admin-card card-teal">
                <i className="fa-solid fa-sack-dollar"></i>
                <div>
                  <strong>{formatPreco(stats.recebido)}</strong>
                  <span>Recebido (Prazo)</span>
                </div>
              </div>
            </div>

            <div className="admin-chart-section">
              <h2>Últimos Pedidos</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                    <th>#</th>
                    <th>Cliente</th>
                    <th>Região</th>
                    <th>Data</th>
                    <th>Total</th>
                    <th>Pagamento</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 8).map(o => (
                    <tr key={o.id}>
                      <td>#{o.id.toString().slice(-6)}</td>
                      <td>{o.customer.nome}</td>
                      <td>{[o.customer.endereco?.cidade, o.customer.endereco?.estado].filter(Boolean).join('/') || '-'}</td>
                      <td>{formatDate(o.date)}</td>
                      <td className="td-price">{formatPreco(o.total)}</td>
                      <td>{o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</td>
                      <td><span className={`status-tag status-${o.status}`}>{o.status}</span></td>
                    </tr>
                  ))}
                  {orders.length === 0 && <tr><td colSpan="7" className="td-empty">Nenhum pedido ainda</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* PEDIDOS */}
        {tab === 'pedidos' && (
          <div className="admin-section">
            <div className="admin-header-row">
              <div>
                <h1>Pedidos</h1>
                <p className="admin-subtitle">Gerencie todos os pedidos recebidos</p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {selectedUserEmail && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--accent)', background: 'var(--accent-bg)', padding: '0.3rem 0.6rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <i className="fa-solid fa-user"></i> {selectedUserEmail}
                    <button style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: '0' }} onClick={() => setSelectedUserEmail(null)}>
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </span>
                )}
                <button className="admin-btn admin-btn-primary" onClick={() => setShowAddOrder(true)}>
                  <i className="fa-solid fa-plus"></i> Novo Pedido
                </button>
              </div>
            </div>

            <div className="admin-tabs">
              {[
                { id: 'todos', label: 'Todos', count: orders.length },
                { id: 'pre-pedido', label: 'Pré-Pedidos', count: orders.filter(o => o.status === 'pre-pedido').length },
                { id: 'pendente', label: 'Pendentes', count: orders.filter(o => o.status === 'pendente').length },
                { id: 'em-rota', label: 'Em Rota', count: orders.filter(o => o.status === 'em-rota').length },
                { id: 'entregue', label: 'Entregues', count: orders.filter(o => o.status === 'entregue').length },
                { id: 'concluidos', label: 'Concluídos', count: orders.filter(o => o.status === 'entregue' || o.status === 'cancelado').length },
                { id: 'cancelado', label: 'Cancelados', count: orders.filter(o => o.status === 'cancelado').length },
              ].map(t => (
                <button key={t.id} className={`admin-tab ${orderFilter === t.id ? 'active' : ''}`} onClick={() => setOrderFilter(t.id)}>
                  {t.label} {t.count > 0 && <span className="tab-count">{t.count}</span>}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="admin-search-prod" style={{ flex: '1', minWidth: '180px' }}>
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar por nome, telefone ou cidade..." value={orderSearch} onChange={e => setOrderSearch(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>
                <span>Data:</span>
                <input type="date" value={orderDateStart} onChange={e => setOrderDateStart(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', maxWidth: '130px' }} />
                <span>—</span>
                <input type="date" value={orderDateEnd} onChange={e => setOrderDateEnd(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', maxWidth: '130px' }} />
              </div>
              <select value={orderCityFilter} onChange={e => setOrderCityFilter(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', background: 'white', cursor: 'pointer', maxWidth: '150px' }}>
                {cidadesOrders.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {selectedIds.size > 0 && (
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', fontWeight: 600 }}>{selectedIds.size} selecionado(s)</span>
                  <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} onClick={() => bulkAction('confirm')}>
                    <i className="fa-solid fa-check"></i> Confirmar
                  </button>
                  <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', background: 'var(--danger)', color: 'white', borderColor: 'var(--danger)' }} onClick={() => bulkAction('delete')}>
                    <i className="fa-solid fa-trash"></i> Excluir
                  </button>
                  <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }} onClick={() => setSelectedIds(new Set())}>
                    <i className="fa-solid fa-xmark"></i> Limpar
                  </button>
                </div>
              )}
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: '36px' }}>
                      <input type="checkbox" checked={paginatedOrders.length > 0 && selectedIds.size === paginatedOrders.length} onChange={toggleSelectAll} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('cliente')}>Cliente {sortIcon('cliente')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('telefone')}>Telefone {sortIcon('telefone')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('regiao')}>Região {sortIcon('regiao')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('data')}>Data {sortIcon('data')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('itens')}>Itens {sortIcon('itens')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('total')}>Total {sortIcon('total')}</th>
                    <th>Pagamento</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOrders.map(o => (
                    <tr key={o.id} className={selectedIds.has(o.id) ? 'row-selected' : ''}>
                      <td>
                        <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                      </td>
                      <td style={{ fontWeight: 600 }}>{o.customer?.nome || '-'}</td>
                      <td>{o.customer?.telefone || '-'}</td>
                      <td>{[o.customer.endereco?.cidade, o.customer.endereco?.estado].filter(Boolean).join('/') || '-'}</td>
                      <td>{formatDate(o.date)}</td>
                      <td>{o.items.reduce((s, i) => s + i.qty, 0)} itens</td>
                      <td className="td-price">{formatPreco(o.total)}</td>
                      <td>{o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</td>
                      <td><span className={`status-tag status-${o.status}`}>{o.status}</span></td>
                      <td>
                        <div className="td-actions">
                          <button className="action-btn action-green" title="Enviar WhatsApp" onClick={() => sendWhatsApp(o)}><i className="fa-brands fa-whatsapp"></i></button>
                          <button className="action-btn" title="Ver detalhes" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-eye"></i></button>
                          {o.status === 'pre-pedido' && <button className="action-btn" style={{ color: '#8b5cf6', borderColor: '#8b5cf6' }} title="Revisar" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-clipboard-check"></i></button>}
                          {o.status === 'pendente' && <button className="action-btn action-confirm" title="Editar" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-pen"></i></button>}
                          {o.status === 'pendente' && <button className="action-btn action-deliver" title="Em Rota" onClick={() => updateOrderStatus(o.id, 'em-rota')}><i className="fa-solid fa-truck"></i></button>}
                          {o.status === 'em-rota' && <button className="action-btn action-confirm" title="Finalizar Entrega" onClick={() => { setShowDeliveryModal(o); setReturnQuantities({}); setPayQuantities({}); setIdentityPreview(''); setAddressPreview('') }}><i className="fa-solid fa-check"></i></button>}
                          {o.status === 'em-rota' && (
                            <button className="action-btn" style={{ color: '#f59e0b', borderColor: '#f59e0b' }} title="Voltar para Pendente" onClick={() => updateOrderStatus(o.id, 'pendente')}><i className="fa-solid fa-undo"></i></button>
                          )}
                          <button className="action-btn action-delete" title="Excluir" onClick={() => deleteOrder(o.id)}><i className="fa-solid fa-trash"></i></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paginatedOrders.length === 0 && <tr><td colSpan="11" className="td-empty">Nenhum pedido encontrado</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* PRODUTOS */}
        {tab === 'produtos' && (
          <div className="admin-section">
            <div className="admin-header-row">
              <div>
                <h1>Produtos</h1>
                <p className="admin-subtitle">{produtosAtuais.length} produtos cadastrados</p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button className="admin-btn" style={{ background: '#2563eb', color: 'white', borderColor: '#2563eb', fontSize: '0.78rem', padding: '0.35rem 0.7rem' }} onClick={() => setEditingProd({ id: Date.now(), nome: '', preco: 0, estoque: 0, imagem: '', categoria: '', descricao: '', variantes: {}, _new: true })}>
                  <i className="fa-solid fa-plus"></i> Novo Produto
                </button>
                <button className="admin-btn" style={{ background: '#059669', color: 'white', borderColor: '#059669', fontSize: '0.78rem', padding: '0.35rem 0.7rem' }} onClick={() => { setEditingKit(null); setShowKitModal(true) }}>
                  <i className="fa-solid fa-toolbox"></i> Montar Kit
                </button>
                {prodCartCount > 0 && (
                  <button className="admin-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6', position: 'relative' }} onClick={() => setProdCartOpen(true)}>
                    <i className="fa-solid fa-shopping-cart"></i> Carrinho
                    <span style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#dc2626', color: 'white', borderRadius: '50%', width: '18px', height: '18px', fontSize: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{prodCartCount}</span>
                  </button>
                )}
                <div style={{ display: 'flex', gap: '0.25rem', background: '#e5e7eb', borderRadius: '8px', padding: '2px' }}>
                  <button className={`admin-btn ${prodViewMode === 'visual' ? 'admin-btn-primary' : 'admin-btn-sec'}`} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', border: 'none' }} onClick={() => setProdViewMode('visual')}>
                    <i className="fa-solid fa-th"></i>
                  </button>
                  <button className={`admin-btn ${prodViewMode === 'tabela' ? 'admin-btn-primary' : 'admin-btn-sec'}`} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', border: 'none' }} onClick={() => setProdViewMode('tabela')}>
                    <i className="fa-solid fa-list"></i>
                  </button>
                </div>
              </div>
            </div>

            {/* Search + Filter bar */}
            <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="admin-search-prod" style={{ flex: '1', minWidth: '180px' }}>
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar produto..." value={prodSearch} onChange={e => setProdSearch(e.target.value)} style={{ width: '100%' }} />
              </div>
              <select value={prodCatFilter} onChange={e => setProdCatFilter(e.target.value)} style={{ padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', background: 'white', cursor: 'pointer' }}>
                {categoriasProd.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={prodStockFilter} onChange={e => setProdStockFilter(e.target.value)} style={{ padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', background: 'white', cursor: 'pointer' }}>
                <option value="todos">Todos os estoques</option>
                <option value="in">Em estoque</option>
                <option value="out">Indisponível</option>
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>
                <span>Preço:</span>
                <input type="number" min="0" step="1" value={prodPriceRange[0]} onChange={e => setProdPriceRange([Number(e.target.value) || 0, prodPriceRange[1]])} style={{ width: '65px', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem' }} placeholder="Min" />
                <span>—</span>
                <input type="number" min="0" step="1" value={prodPriceRange[1]} onChange={e => setProdPriceRange([prodPriceRange[0], Number(e.target.value) || 5000])} style={{ width: '65px', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem' }} placeholder="Max" />
              </div>
            </div>

            {/* Bulk actions bar */}
            {prodSelectedIds.size > 0 && (
              <div style={{ marginBottom: '0.65rem', padding: '0.5rem 0.75rem', background: 'rgba(37,99,235,0.05)', borderRadius: '8px', border: '1px solid rgba(37,99,235,0.15)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent)' }}>{prodSelectedIds.size} selecionado(s)</span>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: '#dc2626', color: 'white', borderColor: '#dc2626' }} onClick={() => bulkProdAction('zerar')}>
                  <i className="fa-solid fa-ban"></i> Zerar Estoque
                </button>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} onClick={() => bulkProdAction('ocultar')}>
                  <i className="fa-solid fa-eye-slash"></i> Indisponível
                </button>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }} onClick={() => bulkProdAction('preco')}>
                  <i className="fa-solid fa-dollar-sign"></i> Trocar Preço
                </button>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: '#10b981', color: 'white', borderColor: '#10b981' }} onClick={() => bulkProdAction('estoque')}>
                  <i className="fa-solid fa-warehouse"></i> Definir Estoque
                </button>
                <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={() => setProdSelectedIds(new Set())}>
                  <i className="fa-solid fa-xmark"></i> Limpar
                </button>
              </div>
            )}

            {/* Visual Grid View */}
            {prodViewMode === 'visual' && (
              <>
                <div className="admin-prod-grid">
                  {paginatedProds.map((p, i) => (
                    <div key={p.id} className={`admin-prod-card ${prodSelectedIds.has(p.id) ? 'selected' : ''}`} style={{ animationDelay: `${i * 25}ms` }}>
                      <div className="admin-prod-card-check">
                        <input type="checkbox" checked={prodSelectedIds.has(p.id)} onChange={() => toggleProdSelect(p.id)} />
                      </div>
                      <div className="admin-prod-card-img" onClick={() => setEditingProd(p)}>
                        {p.imagem && !prodImageErrors[p.id] ? (
                          <img src={p.imagem} alt={p.nome} loading="lazy" onError={() => toggleProdImageError(p.id)} />
                        ) : (
                          <div className="admin-prod-card-img-fallback"><i className="fa-solid fa-image"></i></div>
                        )}
                        <div className="admin-prod-card-badges">
                          {p.estoque <= 0 ? <span className="admin-badge out">Indisponível</span>
                            : p.estoque <= 5 ? <span className="admin-badge low">Últimas {p.estoque}</span>
                            : <span className="admin-badge in">Disponível</span>}
                        </div>
                        <div className="admin-prod-card-cat">{p.categoria}</div>
                      </div>
                      <div className="admin-prod-card-body">
                        <h3 className="admin-prod-card-title" onClick={() => setEditingProd(p)}>{p.nome}</h3>
                        <div className="admin-prod-card-price">{formatPreco(p.preco)}</div>
                        <button className={`admin-prod-card-btn ${prodCart[p.id] ? 'in-cart' : ''}`} onClick={() => addToProdCart(p)} disabled={p.estoque <= 0}>
                          {prodCart[p.id] ? <><i className="fa-solid fa-check"></i> Adicionado</> : <><i className="fa-solid fa-plus"></i> Adicionar</>}
                        </button>
                      </div>
                    </div>
                  ))}
                  {paginatedProds.length === 0 && (
                    <div className="admin-prod-empty">
                      <i className="fa-solid fa-box-open"></i>
                      <h3>Nenhum produto encontrado</h3>
                      <p>Tente ajustar os filtros</p>
                    </div>
                  )}
                </div>

                {totalProdPages > 1 && (
                  <div className="admin-pagination">
                    <button disabled={prodPage === 1} onClick={() => setProdPage(p => p - 1)}><i className="fa-solid fa-chevron-left"></i></button>
                    <span>{prodPage} de {totalProdPages}</span>
                    <button disabled={prodPage === totalProdPages} onClick={() => setProdPage(p => p + 1)}><i className="fa-solid fa-chevron-right"></i></button>
                  </div>
                )}
              </>
            )}

            {/* Table View */}
            {prodViewMode === 'tabela' && (
              <>
                <div className="admin-table-wrap">
                  <table className="admin-table table-prod">
                    <thead>
                      <tr>
                        <th style={{ width: '36px' }}>
                          <input type="checkbox" checked={filteredProds.length > 0 && prodSelectedIds.size === filteredProds.length} onChange={toggleProdSelectAll} style={{ cursor: 'pointer', width: '15px', height: '15px' }} title={prodSelectedIds.size === filteredProds.length ? 'Desmarcar todos' : `Selecionar todos (${filteredProds.length} produtos)`} />
                        </th>
                        <th style={{width: '50px'}}>Foto</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => toggleProdSort('nome')}>Produto {prodSortIcon('nome')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => toggleProdSort('categoria')}>Categoria {prodSortIcon('categoria')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => toggleProdSort('preco')}>Preço {prodSortIcon('preco')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => toggleProdSort('estoque')}>Estoque {prodSortIcon('estoque')}</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedProds.map(p => (
                        <tr key={p.id} className={prodSelectedIds.has(p.id) ? 'row-selected' : ''}>
                          <td>
                            <input type="checkbox" checked={prodSelectedIds.has(p.id)} onChange={() => toggleProdSelect(p.id)} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                          </td>
                          <td>
                            <div className="prod-thumb">
                              {p.imagem ? <img src={p.imagem} alt={p.nome} /> : <i className="fa-solid fa-image"></i>}
                            </div>
                          </td>
                          <td className="td-prod-name">{p.nome}</td>
                          <td><span className="cat-tag">{p.categoria}</span></td>
                          <td className="td-price">{formatPreco(p.preco)}</td>
                          <td>
                            <span className={`stock-tag ${p.estoque > 0 ? 'in' : 'out'}`}>
                              {p.estoque > 0 ? `${p.estoque} un` : 'Indisponível'}
                            </span>
                          </td>
                          <td>
                            <div className="td-actions">
                              <button className="action-btn action-green" title="Editar" onClick={() => setEditingProd(p)}>
                                <i className="fa-solid fa-pen"></i>
                              </button>
                              <button className="action-btn" title="Zerar estoque" onClick={() => { if (confirm(`Zerar estoque de "${p.nome}"?`)) updateProduct(p.id, { estoque: 0 }) }}>
                                <i className="fa-solid fa-ban" style={{ color: '#dc2626' }}></i>
                              </button>
                              <button className="action-btn" title="Alternar disponibilidade" onClick={() => updateProduct(p.id, { estoque: p.estoque > 0 ? 0 : 1 })}>
                                <i className={`fa-solid ${p.estoque > 0 ? 'fa-eye-slash' : 'fa-eye'}`} style={{ color: p.estoque > 0 ? '#f59e0b' : 'var(--success)' }}></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {paginatedProds.length === 0 && <tr><td colSpan="7" className="td-empty">Nenhum produto encontrado</td></tr>}
                    </tbody>
                  </table>
                </div>

                {totalProdPages > 1 && (
                  <div className="admin-pagination">
                    <button disabled={prodPage === 1} onClick={() => setProdPage(p => p - 1)}><i className="fa-solid fa-chevron-left"></i></button>
                    <span>{prodPage} de {totalProdPages}</span>
                    <button disabled={prodPage === totalProdPages} onClick={() => setProdPage(p => p + 1)}><i className="fa-solid fa-chevron-right"></i></button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* CART DRAWER */}
        {prodCartOpen && (
          <div className="admin-overlay" onClick={() => setProdCartOpen(false)}>
            <div className="admin-cart-drawer" onClick={e => e.stopPropagation()}>
              <div className="admin-cart-header">
                <h3><i className="fa-solid fa-shopping-cart"></i> Carrinho</h3>
                <button className="admin-modal-close" onClick={() => setProdCartOpen(false)}><i className="fa-solid fa-xmark"></i></button>
              </div>
              <div className="admin-cart-body">
                {prodCartItems.length === 0 ? (
                  <div className="admin-cart-empty">
                    <i className="fa-solid fa-cart-plus"></i>
                    <p>Carrinho vazio</p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>Adicione produtos do catálogo</p>
                  </div>
                ) : (
                  <>
                    {prodCartItems.map(item => (
                      <div key={item.id} className="admin-cart-item">
                        <div className="admin-cart-item-img">
                          {item.imagem ? <img src={item.imagem} alt={item.nome} /> : <i className="fa-solid fa-image"></i>}
                        </div>
                        <div className="admin-cart-item-info">
                          <span className="admin-cart-item-name">{item.nome}</span>
                          <span className="admin-cart-item-price">{formatPreco(item.preco)}</span>
                        </div>
                        <div className="admin-cart-item-qty">
                          <button className="qty-btn-sm" onClick={() => removeFromProdCart(item.id)}><i className="fa-solid fa-minus"></i></button>
                          <span>{item.qty}</span>
                          <button className="qty-btn-sm" onClick={() => addToProdCart({ id: item.id, nome: item.nome, preco: item.preco, imagem: item.imagem })}><i className="fa-solid fa-plus"></i></button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
              {prodCartItems.length > 0 && (
                <div className="admin-cart-footer">
                  <div className="admin-cart-total">
                    <span>Total:</span>
                    <strong>{formatPreco(prodCartTotal)}</strong>
                  </div>
                  <div className="admin-cart-actions">
                    <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.78rem' }} onClick={clearProdCart}>
                      <i className="fa-solid fa-trash"></i> Limpar
                    </button>
                    <button className="admin-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6', fontSize: '0.78rem' }} onClick={() => { setProdCartOpen(false); createOrderFromCart() }}>
                      <i className="fa-solid fa-file-invoice"></i> Criar Pedido
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* FINANCEIRO */}
        {/* USUÁRIOS */}
        {tab === 'usuarios' && (
          <div className="admin-section">
            {selectedUserDetail ? (
              <>
                <div className="admin-header-row">
                  <div>
                    <button className="admin-btn admin-btn-sec" onClick={() => setSelectedUserDetail(null)} style={{ marginBottom: '0.5rem', fontSize: '0.78rem' }}>
                      <i className="fa-solid fa-arrow-left"></i> Voltar
                    </button>
                    <h1>{selectedUserDetail.nome}</h1>
                    <p className="admin-subtitle">{selectedUserDetail.telefone} &middot; {selectedUserDetail.email || 'sem email'}</p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {!editingUser && (
                      <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }}
                        onClick={() => { setPreselectedUserForOrder(selectedUserDetail); setShowAddOrder(true) }}>
                        <i className="fa-solid fa-plus"></i> Novo Pedido
                      </button>
                    )}
                    {!editingUser && (
                      <button className="admin-btn" style={{ background: '#25d366', color: 'white', borderColor: '#25d366' }}
                        onClick={() => {
                          const u = selectedUserDetail
                          const phone = (u.telefone || '').replace(/\D/g, '')
                          if (phone) {
                            const nome = u.nome || 'Cliente'
                            const msg = `🚚 *PASSANDO NA SUA CIDADE!* 🚚\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nEstamos passando na sua cidade! Aproveite para fazer seu pedido.\n🔗 Faça já seu pedido: ${window.location.origin}${window.location.pathname}`
                            window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`, '_blank')
                          } else {
                            showToast('Usuário sem telefone', 'error')
                          }
                        }}>
                        <i className="fa-brands fa-whatsapp"></i> WhatsApp
                      </button>
                    )}
                    {!editingUser && (
                      <button className="admin-btn" style={{ background: 'var(--danger)', color: 'white', borderColor: 'var(--danger)' }}
                        onClick={() => handleDeleteUser(selectedUserDetail)}>
                        <i className="fa-solid fa-trash-can"></i> Excluir
                      </button>
                    )}
                    <button className="admin-btn" style={{ background: editingUser ? 'var(--success)' : 'var(--accent)', color: 'white', borderColor: editingUser ? 'var(--success)' : 'var(--accent)' }}
                      onClick={editingUser ? saveUserEdit : () => { setEditingUser(true); setEditUserData({ ...selectedUserDetail }) }}>
                      <i className={`fa-solid ${editingUser ? 'fa-check' : 'fa-pen'}`}></i> {editingUser ? 'Salvar' : 'Editar'}
                    </button>
                  </div>
                </div>

                {/* Info Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                  <div className="admin-card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid var(--accent)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--accent-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontSize: '1.1rem' }}>
                        <i className="fa-solid fa-user"></i>
                      </div>
                      <div>
                        {editingUser ? (
                          <input type="text" value={editUserData.nome} onChange={e => setEditUserData(p => ({ ...p, nome: e.target.value }))}
                            style={{ fontWeight: 700, fontSize: '0.95rem', border: '1px solid var(--admin-border)', borderRadius: '6px', padding: '0.25rem 0.5rem', width: '100%' }} />
                        ) : (
                          <strong style={{ fontSize: '0.95rem' }}>{selectedUserDetail.nome}</strong>
                        )}
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Nome</span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid #06b6d4' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#ecfeff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#06b6d4', fontSize: '1.1rem' }}>
                        <i className="fa-solid fa-phone"></i>
                      </div>
                      <div>
                        {editingUser ? (
                          <input type="text" value={editUserData.telefone} onChange={e => setEditUserData(p => ({ ...p, telefone: e.target.value }))}
                            style={{ fontWeight: 700, fontSize: '0.95rem', border: '1px solid var(--admin-border)', borderRadius: '6px', padding: '0.25rem 0.5rem', width: '100%' }} />
                        ) : (
                          <strong style={{ fontSize: '0.95rem' }}>{selectedUserDetail.telefone}</strong>
                        )}
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Telefone</span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid #8b5cf6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6', fontSize: '1.1rem' }}>
                        <i className="fa-solid fa-envelope"></i>
                      </div>
                      <div>
                        {editingUser ? (
                          <input type="email" value={editUserData.email} onChange={e => setEditUserData(p => ({ ...p, email: e.target.value }))}
                            style={{ fontWeight: 700, fontSize: '0.95rem', border: '1px solid var(--admin-border)', borderRadius: '6px', padding: '0.25rem 0.5rem', width: '100%' }} />
                        ) : (
                          <strong style={{ fontSize: '0.95rem' }}>{selectedUserDetail.email || '-'}</strong>
                        )}
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Email</span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid #dc2626' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626', fontSize: '1.1rem' }}>
                        <i className="fa-solid fa-id-card"></i>
                      </div>
                      <div>
                        {editingUser ? (
                          <input type="text" value={editUserData.endereco?.cpf || ''} onChange={e => setEditUserData(p => ({ ...p, endereco: { ...(p.endereco || {}), cpf: e.target.value } }))}
                            style={{ fontWeight: 700, fontSize: '0.95rem', border: '1px solid var(--admin-border)', borderRadius: '6px', padding: '0.25rem 0.5rem', width: '100%' }} placeholder="000.000.000-00" />
                        ) : (
                          <strong style={{ fontSize: '0.95rem' }}>{selectedUserDetail.endereco?.cpf || '-'}</strong>
                        )}
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>CPF</span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid #f59e0b' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b', fontSize: '1.1rem' }}>
                        <i className="fa-solid fa-calendar"></i>
                      </div>
                      <div>
                        <strong style={{ fontSize: '0.95rem' }}>{formatDate(selectedUserDetail.created_at ? new Date(selectedUserDetail.created_at).toISOString().split('T')[0] : '')}</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Cadastro</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Password Card */}
                <div style={{ background: '#f9fafb', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.25rem', border: '1px solid var(--admin-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <h4 style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <i className="fa-solid fa-lock" style={{ color: 'var(--admin-text-sec)' }}></i> Senha
                    </h4>
                  </div>
                  {editingUser ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input type="text" placeholder="Nova senha" value={editUserData.senha || ''} onChange={e => setEditUserData(p => ({ ...p, senha: e.target.value }))}
                        style={{ flex: 1, padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.85rem' }} />
                      <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Deixe vazio para manter</span>
                    </div>
                  ) : (
                    <p style={{ fontSize: '0.82rem', color: 'var(--admin-text-sec)' }}>
                      {selectedUserDetail.endereco?.senha ? '••••••••' : 'Nenhuma senha definida'}
                    </p>
                  )}
                </div>

                {/* Nível e Limites Card */}
                <div style={{ background: '#f9fafb', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.25rem', border: '1px solid var(--admin-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <h4 style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <i className="fa-solid fa-star" style={{ color: '#f59e0b' }}></i> Nível do Cliente
                    </h4>
                  </div>
                  {editingUser ? (
                    <select value={editUserData.endereco?.nivel || ''} onChange={e => setEditUserData(p => ({ ...p, endereco: { ...(p.endereco || {}), nivel: e.target.value } }))}
                      style={{ width: '100%', padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.85rem' }}>
                      <option value="">Selecionar nível...</option>
                      <option value="primeiro-comprador">Primeiro Comprador</option>
                      <option value="comprador-antigo">Comprador Antigo</option>
                    </select>
                  ) : (
                    <p style={{ fontSize: '0.82rem' }}>
                      {selectedUserDetail.endereco?.nivel === 'primeiro-comprador' ? <><span style={{ color: '#10b981', fontWeight: 600 }}>●</span> Primeiro Comprador</> :
                       selectedUserDetail.endereco?.nivel === 'comprador-antigo' ? <><span style={{ color: '#8b5cf6', fontWeight: 600 }}>●</span> Comprador Antigo</> :
                       <span style={{ color: 'var(--admin-text-sec)' }}>Nenhum nível definido</span>}
                    </p>
                  )}
                  <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--admin-border)', paddingTop: '0.75rem' }}>
                    <h4 style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                      <i className="fa-solid fa-gavel" style={{ color: '#dc2626' }}></i> Limites
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', display: 'block', marginBottom: '0.2rem' }}>Limite de Pedidos</span>
                        {editingUser ? (
                          <input type="number" min="0" placeholder="Sem limite" value={editUserData.endereco?.limitePedidos ?? ''} onChange={e => setEditUserData(p => ({ ...p, endereco: { ...(p.endereco || {}), limitePedidos: e.target.value === '' ? null : Number(e.target.value) } }))}
                            style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem' }} />
                        ) : (
                          <strong style={{ fontSize: '0.95rem' }}>{selectedUserDetail.endereco?.limitePedidos ?? '—'}</strong>
                        )}
                      </div>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', display: 'block', marginBottom: '0.2rem' }}>Limite de Preço (R$)</span>
                        {editingUser ? (
                          <input type="number" min="0" step="0.01" placeholder="Sem limite" value={editUserData.endereco?.limitePreco ?? ''} onChange={e => setEditUserData(p => ({ ...p, endereco: { ...(p.endereco || {}), limitePreco: e.target.value === '' ? null : Number(e.target.value) } }))}
                            style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem' }} />
                        ) : (
                          <strong style={{ fontSize: '0.95rem' }}>{selectedUserDetail.endereco?.limitePreco ? formatPreco(selectedUserDetail.endereco.limitePreco) : '—'}</strong>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Address Card */}
                <div style={{ background: '#f9fafb', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.25rem', border: '1px solid var(--admin-border)' }}>
                  <h4 style={{ fontSize: '0.85rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <i className="fa-solid fa-location-dot"></i> Endereço
                    {(() => {
                      const ec = selectedUserDetail.endereco || {}
                      const addr = buildAddressString(ec)
                      return addr ? <button className="action-btn" style={{ marginLeft: 'auto', color: '#2563eb' }} title="Ver no Google Maps" onClick={() => openGoogleMaps(addr)}><i className="fa-solid fa-location-dot"></i></button> : null
                    })()}
                  </h4>
                  {editingUser ? (
                    <AddressForm value={editUserData.endereco || {}} onChange={(a) => setEditUserData(p => ({ ...p, endereco: a }))} />
                  ) : (
                    (() => {
                      const e = selectedUserDetail.endereco || {}
                      const hasAddr = e.cep || e.rua || e.bairro || e.cidade || e.estado || e.rota
                      if (!hasAddr) return <p style={{ fontSize: '0.82rem', color: 'var(--admin-text-sec)' }}>Nenhum endereço cadastrado</p>
                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', fontSize: '0.85rem' }}>
                          {e.cep && <div><span style={{ color: 'var(--admin-text-sec)', display: 'block', fontSize: '0.72rem' }}>CEP</span><strong>{e.cep}</strong></div>}
                          {e.rua && <div><span style={{ color: 'var(--admin-text-sec)', display: 'block', fontSize: '0.72rem' }}>Logradouro</span><strong>{e.rua}{e.numero ? `, ${e.numero}` : ''}</strong></div>}
                          {e.bairro && <div><span style={{ color: 'var(--admin-text-sec)', display: 'block', fontSize: '0.72rem' }}>Bairro</span><strong>{e.bairro}</strong></div>}
                          {e.cidade && <div><span style={{ color: 'var(--admin-text-sec)', display: 'block', fontSize: '0.72rem' }}>Cidade</span><strong>{e.cidade}{e.estado ? ` / ${e.estado}` : ''}</strong></div>}
                          {e.complemento && <div><span style={{ color: 'var(--admin-text-sec)', display: 'block', fontSize: '0.72rem' }}>Complemento</span><strong>{e.complemento}</strong></div>}
                          {e.rota && <div><span style={{ color: 'var(--admin-text-sec)', display: 'block', fontSize: '0.72rem' }}>Rota</span><strong style={{ color: '#8b5cf6' }}>{e.rota}</strong></div>}
                        </div>
                      )
                    })()
                  )}
                </div>

                {/* Stats Cards */}
                {(() => {
                  const totalPedidos = userOrdersDetail.length
                  const totalGasto = userOrdersDetail.reduce((s, o) => s + o.total, 0)
                  const ultimoPedido = userOrdersDetail.length > 0 ? userOrdersDetail.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] : null
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem', marginBottom: '1.25rem' }}>
                      <div className="admin-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid var(--accent)', textAlign: 'center' }}>
                        <strong style={{ fontSize: '1.2rem', color: 'var(--accent)' }}>{totalPedidos}</strong>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Pedidos</span>
                      </div>
                      <div className="admin-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid var(--success)', textAlign: 'center' }}>
                        <strong style={{ fontSize: '1.2rem', color: 'var(--success)' }}>{formatPreco(totalGasto)}</strong>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Total Gasto</span>
                      </div>
                      <div className="admin-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid #8b5cf6', textAlign: 'center' }}>
                        <strong style={{ fontSize: '1.2rem', color: '#8b5cf6' }}>{ultimoPedido ? formatDate(ultimoPedido.date) : '-'}</strong>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Último Pedido</span>
                      </div>
                      <div className="admin-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid #f59e0b', textAlign: 'center' }}>
                        <strong style={{ fontSize: '1.2rem', color: '#f59e0b' }}>
                          {(() => {
                            const pend = userOrdersDetail.filter(o => o.status === 'pendente' || o.status === 'pre-pedido').length
                            return pend || '0'
                          })()}
                        </strong>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Pendentes</span>
                      </div>
                    </div>
                  )
                })()}

                {/* Orders from this user */}
                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <i className="fa-solid fa-clipboard-list"></i> Pedidos
                  <span className="cat-tag">{userOrdersDetail.length} pedidos</span>
                  {userOrdersDetail.length > 0 && <span style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>— {formatPreco(userOrdersDetail.reduce((s, o) => s + o.total, 0))}</span>}
                </h3>

                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Data</th>
                        <th>Itens</th>
                        <th>Total</th>
                        <th>Pagamento</th>
                        <th>Status</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userOrdersDetail.map(o => (
                        <tr key={o.id}>
                          <td>#{o.id.toString().slice(-6)}</td>
                          <td>{formatDate(o.date)}</td>
                          <td>{o.items.reduce((s, i) => s + i.qty, 0)} itens</td>
                          <td className="td-price">{formatPreco(o.total)}</td>
                          <td>{o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</td>
                          <td><span className={`status-tag status-${o.status}`}>{o.status}</span></td>
                          <td>
                            <div className="td-actions">
                              <button className="action-btn" title="Ver pedido" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-eye"></i></button>
                              <button className="action-btn action-delete" title="Excluir" onClick={() => { if (confirm(`Excluir pedido #${o.id}?`)) deleteOrder(o.id) }}><i className="fa-solid fa-trash"></i></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {userOrdersDetail.length === 0 && <tr><td colSpan="7" className="td-empty">Nenhum pedido deste usuário</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <div className="admin-header-row">
                  <div>
                    <h1>Usuários</h1>
                    <p className="admin-subtitle">{usuarios.length} usuários cadastrados</p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.78rem', padding: '0.4rem 0.7rem' }}
                      onClick={() => { setSyncingUsers(true); syncAllForAdmin().then(({ users: u }) => { LS.set('thsm_usuarios', u); setUsuarios(u) }).catch(e => console.error('sync error:', e)).finally(() => setSyncingUsers(false)) }}>
                      <i className={`fa-solid ${syncingUsers ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i> {syncingUsers ? 'Sincronizando' : 'Sincronizar'}
                    </button>
                    <button className="admin-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6', fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                      onClick={gerarSenhasUsuarios}>
                      <i className="fa-solid fa-key"></i> Gerar Senhas
                    </button>
                  </div>
                </div>

                {selectedUserEmail && (
                  <div style={{ marginBottom: '1rem', padding: '0.65rem 0.85rem', background: 'var(--accent-bg)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 500 }}>
                      <i className="fa-solid fa-filter"></i> Filtrando pedidos de: <strong>{selectedUserEmail}</strong>
                    </span>
                    <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={() => { setSelectedUserEmail(null); setTab('pedidos') }}>
                      <i className="fa-solid fa-xmark"></i> Limpar filtro
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="admin-search-prod" style={{ flex: '1', minWidth: '180px' }}>
                    <i className="fa-solid fa-search"></i>
                    <input type="text" placeholder="Buscar por nome, telefone ou email..." value={userSearch} onChange={e => setUserSearch(e.target.value)} style={{ width: '100%' }} />
                  </div>
                  <select value={userCityFilter} onChange={e => setUserCityFilter(e.target.value)} style={{ padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', background: 'white', cursor: 'pointer', maxWidth: '160px' }}>
                    {userCities.map(c => <option key={c} value={c}>{c === 'TODAS' ? 'Todas as cidades' : c}</option>)}
                  </select>
                  <select value={userOrigemFilter} onChange={e => setUserOrigemFilter(e.target.value)} style={{ padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', background: 'white', cursor: 'pointer', maxWidth: '160px' }}>
                    <option value="TODAS">Todas origens</option>
                    <option value="BOT">BOT</option>
                    <option value="Registro do Site">Registro do Site</option>
                    <option value="Admin">Admin</option>
                    <option value="Importado WhatsApp">Importado WhatsApp</option>
                  </select>
                  <div className="admin-search-prod" style={{ minWidth: '160px', maxWidth: '200px' }}>
                    <i className="fa-solid fa-search"></i>
                    <input type="text" placeholder="Buscar endereço..." value={userEnderecoSearch} onChange={e => setUserEnderecoSearch(e.target.value)} style={{ width: '100%' }} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', fontSize: '0.78rem' }}>
                    <button className={`admin-btn ${userSort.field === 'nome' ? 'admin-btn-primary' : 'admin-btn-sec'}`} style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }} onClick={() => setUserSort(prev => prev.field === 'nome' ? { field: 'nome', dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field: 'nome', dir: 'asc' })}>
                      Nome {userSort.field === 'nome' && <i className={`fa-solid fa-sort-${userSort.dir === 'asc' ? 'up' : 'down'}`}></i>}
                    </button>
                    <button className={`admin-btn ${userSort.field === 'cidade' ? 'admin-btn-primary' : 'admin-btn-sec'}`} style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }} onClick={() => setUserSort(prev => prev.field === 'cidade' ? { field: 'cidade', dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field: 'cidade', dir: 'asc' })}>
                      Cidade {userSort.field === 'cidade' && <i className={`fa-solid fa-sort-${userSort.dir === 'asc' ? 'up' : 'down'}`}></i>}
                    </button>
                  </div>
                  {selectedUserIds.size > 0 && (
                    <button className="admin-btn" style={{ background: '#dc2626', color: 'white', borderColor: '#dc2626', fontSize: '0.78rem', padding: '0.4rem 0.7rem' }}
                      onClick={() => openRoutePlanning(filteredUsuarios.filter(u => selectedUserIds.has(u.telefone || u.id)))}>
                      <i className="fa-solid fa-route"></i> Traçar Rotas ({selectedUserIds.size})
                    </button>
                  )}
                </div>

                <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th style={{ width: '32px' }}>
                            <input type="checkbox" checked={paginatedUsuarios.length > 0 && paginatedUsuarios.every(u => selectedUserIds.has(u.telefone || u.id))}
                              onChange={e => {
                                if (e.target.checked) {
                                  setSelectedUserIds(new Set(paginatedUsuarios.map(u => u.telefone || u.id)))
                                } else {
                                  setSelectedUserIds(new Set())
                                }
                              }} />
                          </th>
                          <th>Nome</th>
                          <th>Telefone</th>
                          <th>Email</th>
                          <th>CPF</th>
                          <th>Origem</th>
                          <th>Nível</th>
                          <th>Endereço</th>
                          <th>Cadastro</th>
                          <th>Pedidos</th>
                          <th>Limites</th>
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                         {paginatedUsuarios.map(u => {
                           const uid = u.telefone || u.id
                           const userOrders = orders.filter(o => o.customer?.telefone === u.telefone || o.user_id === u.id)
                           const totalGasto = userOrders.reduce((s, o) => s + o.total, 0)
                           const e = u.endereco || {}
                           const endStr = [e.rua && `${e.rua}${e.numero ? `, ${e.numero}` : ''}`, e.bairro, e.cidade].filter(Boolean).join(', ') || '-'
                           const origem = e.origem || '—'
                           const origemColors = { 'BOT': '#8b5cf6', 'Registro do Site': '#16a34a', 'Admin': '#2563eb', 'Importado WhatsApp': '#d97706' }
                           return (
                             <tr key={uid}>
                               <td>
                                 <input type="checkbox" checked={selectedUserIds.has(uid)}
                                   onChange={e => {
                                     const next = new Set(selectedUserIds)
                                     e.target.checked ? next.add(uid) : next.delete(uid)
                                     setSelectedUserIds(next)
                                   }} />
                               </td>
                                <td style={{ fontWeight: 600 }}>{u.nome}</td>
                                <td>{u.telefone}</td>
                                <td>{u.email || '-'}</td>
                                <td style={{ fontSize: '0.78rem' }}>{u.endereco?.cpf || '-'}</td>
                                <td>
                                  <span className="origem-badge" style={{ background: `${origemColors[origem] || '#6b7280'}18`, color: origemColors[origem] || '#6b7280', border: `1px solid ${origemColors[origem] || '#6b7280'}30` }}>
                                    {origem === 'BOT' ? <i className="fa-solid fa-robot"></i> : origem === 'Registro do Site' ? <i className="fa-solid fa-globe"></i> : origem === 'Admin' ? <i className="fa-solid fa-user-tie"></i> : origem === 'Importado WhatsApp' ? <i className="fa-brands fa-whatsapp"></i> : <i className="fa-solid fa-circle-question"></i>}
                                    {' '}{origem}
                                  </span>
                                </td>
                                <td>
                                  {u.endereco?.nivel === 'primeiro-comprador' ? <span style={{ color: '#10b981', fontWeight: 600, fontSize: '0.78rem' }}>Primeiro Comprador</span> :
                                   u.endereco?.nivel === 'comprador-antigo' ? <span style={{ color: '#8b5cf6', fontWeight: 600, fontSize: '0.78rem' }}>Comprador Antigo</span> :
                                   <span style={{ color: 'var(--admin-text-sec)', fontSize: '0.75rem' }}>—</span>}
                                </td>
                               <td style={{ fontSize: '0.78rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={endStr}>
                                 {endStr}
                               </td>
                               <td>{formatDate(u.created_at ? new Date(u.created_at).toISOString().split('T')[0] : (u.createdAt ? new Date(u.createdAt).toISOString().split('T')[0] : ''))}</td>
                                <td>
                                  <span className="cat-tag">{userOrders.length} pedidos</span>
                                  {userOrders.length > 0 && (
                                    <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>
                                      {formatPreco(totalGasto)}
                                    </span>
                                  )}
                                </td>
                                <td style={{ fontSize: '0.75rem' }}>
                                  {u.endereco?.limitePedidos ? <span>P: {u.endereco.limitePedidos}</span> : null}
                                  {u.endereco?.limitePreco ? <span>{u.endereco?.limitePedidos ? ' | ' : ''}R$: {formatPreco(u.endereco.limitePreco)}</span> : null}
                                  {!u.endereco?.limitePedidos && !u.endereco?.limitePreco ? <span style={{ color: 'var(--admin-text-sec)' }}>—</span> : null}
                                </td>
                                 <td style={{ position: 'relative' }}>
                                  <div className="td-actions">
                                    <button className="action-btn" style={{ color: '#2563eb' }} title="Ver no Google Maps" onClick={() => openGoogleMaps(buildAddressString(e))}>
                                      <i className="fa-solid fa-location-dot"></i>
                                    </button>
                                    <button className="action-btn" style={{ color: '#8b5cf6' }} title="Ver no Mapa Interativo" onClick={() => { setTab('mapa'); setSelectedUserIds(new Set([u.telefone || u.id])) }}>
                                      <i className="fa-solid fa-map"></i>
                                    </button>
                                    <button className="action-btn" style={{ color: '#25d366' }} title="Enviar WhatsApp"
                                      onClick={() => setUserMsgMenu(userMsgMenu === u.telefone ? null : u.telefone)}>
                                      <i className="fa-brands fa-whatsapp"></i>
                                    </button>
                                    <button className="action-btn action-green" title="Ver detalhes do usuário" onClick={() => setSelectedUserDetail(u)}>
                                      <i className="fa-solid fa-user"></i>
                                    </button>
                                    <button className="action-btn" title="Ver pedidos" onClick={() => { setSelectedUserEmail(u.email || u.telefone); setTab('pedidos') }}>
                                      <i className="fa-solid fa-clipboard-list"></i>
                                    </button>
                                    <button className="action-btn" style={{ color: 'var(--danger)' }} title="Excluir usuário" onClick={() => handleDeleteUser(u)}>
                                      <i className="fa-solid fa-trash-can"></i>
                                    </button>
                                  </div>
                                  {userMsgMenu === u.telefone && (
                                    <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 100, background: 'white', border: '1px solid var(--admin-border)', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: '200px', padding: '0.35rem', marginTop: '4px' }}>
                                      {USER_MSG_TEMPLATES.map(t => (
                                        <div key={t.key}
                                          style={{ padding: '0.55rem 0.7rem', cursor: 'pointer', borderRadius: '8px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--admin-text)' }}
                                          onClick={() => sendUserWhatsApp(u, t.key)}
                                          onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                          <i className={`fa-solid ${t.icon}`} style={{ width: '16px', color: '#25d366' }}></i>
                                          {t.label}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                               </td>
                             </tr>
                           )
                         })}
                         {paginatedUsuarios.length === 0 && <tr><td colSpan="10" className="td-empty">Nenhum usuário encontrado</td></tr>}
                    </tbody>
                  </table>
                </div>

                {totalUserPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1rem 0', fontSize: '0.85rem' }}>
                    <button className="admin-btn admin-btn-sec" style={{ padding: '0.35rem 0.75rem', fontSize: '0.82rem' }} disabled={userPage <= 1} onClick={() => setUserPage(p => Math.max(1, p - 1))}>
                      <i className="fa-solid fa-chevron-left"></i> Anterior
                    </button>
                    <span style={{ color: 'var(--admin-text-sec)' }}>
                      Página {userPage} de {totalUserPages} ({filteredUsuarios.length} usuários)
                    </span>
                    <button className="admin-btn admin-btn-sec" style={{ padding: '0.35rem 0.75rem', fontSize: '0.82rem' }} disabled={userPage >= totalUserPages} onClick={() => setUserPage(p => Math.min(totalUserPages, p + 1))}>
                      Próxima <i className="fa-solid fa-chevron-right"></i>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* LEADS */}
        {tab === 'leads' && (
          <div className="admin-section">
            <div className="admin-header-row">
              <div>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <i className="fa-solid fa-file-pen" style={{ color: 'var(--accent)' }}></i>
                  Inscrições do Site
                </h1>
                <p className="admin-subtitle">{leads.length} cadastros recebidos</p>
              </div>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Telefone</th>
                    <th>Email</th>
                    <th>Cidade</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map(l => {
                    const e = l.endereco || {}
                    return (
                      <tr key={l.id}>
                        <td style={{ fontWeight: 600 }}>{l.nome}</td>
                        <td>{l.telefone}</td>
                        <td>{l.email || '-'}</td>
                        <td>{[e.cidade, e.estado].filter(Boolean).join('/') || '-'}</td>
                        <td>{formatDate(l.created_at)}</td>
                      </tr>
                    )
                  })}
                  {leads.length === 0 && <tr><td colSpan="5" className="td-empty">Nenhuma inscrição recebida</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MAPA */}
        {tab === 'mapa' && (
          <div className="admin-section" style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
            <MapView usuarios={usuarios} orders={orders} financial={financial}
  onMarkOnWay={(user) => {
    const userOrders = orders.filter(o => o.customer?.telefone === user.telefone || o.user_id === user.id)
    const toUpdate = userOrders.filter(o => !['entregue', 'cancelado'].includes(o.status))
    if (toUpdate.length === 0) return
    if (confirm(`Marcar ${toUpdate.length} pedido(s) de ${user.nome || user.pushName} como "Em Rota"?`)) {
      setOrders(prev => prev.map(o => toUpdate.some(t => t.id === o.id) ? { ...o, status: 'em-rota' } : o))
    }
  }}
  onViewUser={(user) => {
    setSelectedUserDetail(user)
    setTab('usuarios')
  }} />
          </div>
        )}

        {/* ROTAS */}
        {tab === 'rotas' && (
          <div className="admin-section">
            <div className="admin-header-row">
              <div>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="rota-title-icon"><i className="fa-solid fa-route"></i></span>
                  Rotas
                </h1>
                <p className="admin-subtitle">Mapa de rotas e contatos de WhatsApp</p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="admin-btn" style={{ background: '#059669', color: 'white', borderColor: '#059669' }} onClick={() => { setNewRotaName(''); setNewRotaSearch(''); setNewRotaSelected([]); setNewContactPhone(''); setNewContactName(''); setShowNewRota(true) }}>
                  <i className="fa-solid fa-plus"></i> Nova Rota
                </button>
                <button className="admin-btn admin-btn-primary" onClick={fetchRotas} disabled={rotasLoading}>
                  <i className={`fa-solid ${rotasLoading ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i>
                  {rotasLoading ? 'Buscando...' : 'Atualizar'}
                </button>
                <button className="admin-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6' }}
                  disabled={rotas.length === 0 || importingRotas}
                  onClick={async () => {
                    if (importingRotas) return
                    setImportingRotas(true)
                    try {
                      const added = await syncContatosToUsuarios(rotas)
                      if (added > 0) {
                        showToast(`${added} contato(s) importado(s) para usuários!`)
                        const u = await getAllUsers()
                        if (u.length) { setUsuarios(u); LS.set('thsm_usuarios', u) }
                      } else {
                        showToast('Nenhum novo contato para importar', 'warning')
                      }
                    } catch (e) {
                      console.error('Erro ao importar:', e)
                      showToast('Erro ao importar contatos', 'error')
                    } finally {
                      setImportingRotas(false)
                    }
                  }}>
                  <i className={`fa-solid ${importingRotas ? 'fa-spinner fa-spin' : 'fa-users'}`}></i>
                  {importingRotas ? 'Importando...' : 'Importar para Usuários'}
                </button>
              </div>
            </div>

            {rotasError && (
              <div className="rota-error-card">
                <div className="rota-error-icon"><i className="fa-solid fa-exclamation-triangle"></i></div>
                <div className="rota-error-body">
                  <strong>Erro ao carregar</strong>
                  <span>{rotasError}</span>
                  <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }} onClick={fetchRotas}>
                    <i className="fa-solid fa-rotate"></i> Tentar novamente
                  </button>
                </div>
              </div>
            )}

            {rotasLoading && (
              <div className="rota-loading">
                <div className="rota-loading-spinner"><i className="fa-solid fa-spinner fa-spin"></i></div>
                <div className="rota-loading-text">
                  <strong>Sincronizando rotas...</strong>
                  <span>Aguarde enquanto buscamos os dados do WhatsApp</span>
                </div>
              </div>
            )}

            {rotas.length > 0 && !rotasLoading && (
              <>
                {/* STATS CARDS */}
                <div className="rota-stats">
                  <div className="rota-stat-card stat-purple">
                    <div className="rota-stat-icon"><i className="fa-solid fa-route"></i></div>
                    <div className="rota-stat-info">
                      <strong>{rotaStats.totalRotas}</strong>
                      <span>Rotas</span>
                    </div>
                  </div>
                  <div className="rota-stat-card stat-blue">
                    <div className="rota-stat-icon"><i className="fa-solid fa-city"></i></div>
                    <div className="rota-stat-info">
                      <strong>{rotaStats.totalCidades}</strong>
                      <span>Cidades</span>
                    </div>
                  </div>
                  <div className="rota-stat-card stat-green">
                    <div className="rota-stat-icon"><i className="fa-solid fa-users"></i></div>
                    <div className="rota-stat-info">
                      <strong>{rotaStats.totalContatos}</strong>
                      <span>Contatos</span>
                    </div>
                  </div>
                </div>

                {/* FILTERS */}
                <div className="rota-filters">
                  <div className="rota-select-wrap">
                    <i className="fa-solid fa-city"></i>
                    <select value={filterCidade} onChange={e => setFilterCidade(e.target.value)}>
                      <option value="TODAS">Todas as cidades</option>
                      {cidadesRotas.filter(c => c !== 'TODAS').map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="rota-select-wrap">
                    <i className="fa-solid fa-route"></i>
                    <select value={filterRota} onChange={e => setFilterRota(e.target.value)}>
                      <option value="TODAS">Todas as rotas</option>
                      {rotasUnicas.filter(r => r !== 'TODAS').map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="rota-search-box">
                    <i className="fa-solid fa-search"></i>
                    <input type="text" placeholder="Buscar rota, cidade ou contato..." value={filterRotaSearch} onChange={e => setFilterRotaSearch(e.target.value)} />
                    {filterRotaSearch && <button className="rota-search-clear" onClick={() => setFilterRotaSearch('')}><i className="fa-solid fa-xmark"></i></button>}
                  </div>
                </div>

                {/* ROUTE GRID */}
                {rotasFiltradas.length === 0 ? (
                  <div className="rota-empty">
                    <i className="fa-solid fa-map-location-dot"></i>
                    <h3>Nenhuma rota encontrada</h3>
                    <p>Tente alterar os filtros</p>
                  </div>
                ) : (
                  <div className="rota-grid">
                    {rotasFiltradas.map((grupo) => {
                      const isExpanded = expandedRota === grupo.rota
                      const cidadesVisiveis = filterCidade === 'TODAS'
                        ? grupo.cidades
                        : grupo.cidades.filter(c => c.cidade === filterCidade)
                      const totalVisivel = cidadesVisiveis.reduce((s, c) => s + c.contatos.length, 0)
                      const allContatos = cidadesVisiveis.flatMap(c => c.contatos)
                      return (
                        <div key={grupo.rota} className={`rota-card ${isExpanded ? 'expanded' : ''}`}>
                          <div className="rota-card-main" onClick={() => setExpandedRota(isExpanded ? null : grupo.rota)}>
                            <div className="rota-card-preview">
                              <div className="rota-card-avatar">
                                {allContatos[0]?.profilePicture ? (
                                  <img src={allContatos[0].profilePicture} alt="" onError={e => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<i class=\"fa-solid fa-route\"></i>' }} />
                                ) : (
                                  <i className="fa-solid fa-route"></i>
                                )}
                              </div>
                              <div className="rota-card-meta">
                                <strong className="rota-card-title">{grupo.rota}</strong>
                                <span className="rota-card-subtitle">
                                  <i className="fa-solid fa-users"></i> {totalVisivel} contatos
                                  <span className="rota-dot"></span>
                                  <i className="fa-solid fa-city"></i> {cidadesVisiveis.length} {cidadesVisiveis.length === 1 ? 'cidade' : 'cidades'}
                                </span>
            </div>

            {totalOrderPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1rem 0', fontSize: '0.85rem' }}>
                <button className="admin-btn admin-btn-sec" style={{ padding: '0.35rem 0.75rem', fontSize: '0.82rem' }} disabled={orderPage <= 1} onClick={() => setOrderPage(p => Math.max(1, p - 1))}>
                  <i className="fa-solid fa-chevron-left"></i> Anterior
                </button>
                <span style={{ color: 'var(--admin-text-sec)' }}>
                  Página {orderPage} de {totalOrderPages} ({filteredOrders.length} pedidos)
                </span>
                <button className="admin-btn admin-btn-sec" style={{ padding: '0.35rem 0.75rem', fontSize: '0.82rem' }} disabled={orderPage >= totalOrderPages} onClick={() => setOrderPage(p => Math.min(totalOrderPages, p + 1))}>
                  Próxima <i className="fa-solid fa-chevron-right"></i>
                </button>
              </div>
            )}
          </div>
                            <div className="rota-card-actions">
                              <button className="rota-map-btn" title="Ver no Google Maps" onClick={e => { e.stopPropagation(); window.open(`https://www.google.com/maps/search/${encodeURIComponent(grupo.rota)}`, '_blank') }}>
                                <i className="fa-solid fa-map-location-dot"></i>
                                <span>Mapa</span>
                              </button>
                              <button className="rota-map-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6' }} title="Alertar Rotas" onClick={e => { e.stopPropagation(); if (confirm(`Enviar alerta para ${totalVisivel} contatos da rota "${grupo.rota}"?`)) { sendAlertRota('alerta', allContatos, orders); showToast(`Alerta enviado para ${totalVisivel} contatos`) } }}>
                                <i className="fa-solid fa-bullhorn"></i>
                                <span>Alertar</span>
                              </button>
                              <button className="rota-map-btn" style={{ background: '#059669', color: 'white', borderColor: '#059669' }} title="Atualização Pedidos" onClick={e => { e.stopPropagation(); if (confirm(`Enviar atualização de pedidos para ${totalVisivel} contatos da rota "${grupo.rota}"?`)) { sendAlertRota('atualizacao', allContatos, orders); showToast(`Atualização enviada para ${totalVisivel} contatos`) } }}>
                                <i className="fa-solid fa-rotate"></i>
                                <span>Pedidos</span>
                              </button>
                              <button className="rota-map-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} title="Personalizado" onClick={e => { e.stopPropagation(); setCustomMsgRota({ rota: grupo.rota, contatos: allContatos, total: totalVisivel }) }}>
                                <i className="fa-solid fa-pen"></i>
                                <span>Custom</span>
                              </button>
                              {grupo._custom && (
                                <button className="rota-map-btn" style={{ background: '#dc2626', color: 'white', borderColor: '#dc2626' }} title="Excluir rota" onClick={e => { e.stopPropagation(); if (confirm(`Excluir rota "${grupo.rota}"?`)) { setCustomRotas(prev => prev.filter(cr => cr.rota !== grupo.rota)); showToast(`Rota "${grupo.rota}" excluída`) } }}>
                                  <i className="fa-solid fa-trash"></i>
                                  <span>Excluir</span>
                                </button>
                              )}
                              <span className="rota-expand-icon">
                                <i className={`fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
                              </span>
                            </div>
                          </div>

                          {/* Subcategory badges */}
                          <div className="rota-subcats">
                            {cidadesVisiveis.map(c => (
                              <span key={c.cidade} className="rota-subcat-badge">
                                <i className="fa-solid fa-city"></i> {c.cidade}
                                <span className="rota-subcat-count">{c.contatos.length}</span>
                              </span>
                            ))}
                          </div>

                          {isExpanded && (
                            <div className="rota-contacts">
                              {cidadesVisiveis.map(c => (
                                <div key={c.cidade} className="rota-subcat-group">
                                  <div className="rota-contacts-header">
                                    <span><i className="fa-solid fa-city"></i> {c.cidade}</span>
                                    <span className="rota-contacts-count">{c.contatos.length} {c.contatos.length === 1 ? 'contato' : 'contatos'}</span>
                                  </div>
                                  <div className="rota-contacts-body">
                                    {c.contatos.map((ct, ci) => (
                                      <div key={ci} className="rota-contact-row">
                                        <div className="rota-contact-avatar">
                                          {ct.profilePicture ? (
                                            <img src={ct.profilePicture} alt={ct.pushName} onError={e => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<i class=\"fa-solid fa-user\"></i>' }} />
                                          ) : (
                                            <i className="fa-solid fa-user"></i>
                                          )}
                                        </div>
                                        <div className="rota-contact-info">
                                          <span className="rota-contact-name">{ct.pushName || 'Sem nome'}</span>
                                          <span className="rota-contact-phone">{ct.remoteJid?.replace(/@.*/, '')}</span>
                                        </div>
                                        <button
                                          className="rota-whatsapp-btn"
                                          title="Conversar no WhatsApp"
                                          onClick={() => {
                                            const phone = ct.remoteJid?.replace(/@.*/, '').replace(/\D/g, '')
                                            if (phone) window.open(`https://wa.me/${phone}`, '_blank')
                                          }}
                                        >
                                          <i className="fa-brands fa-whatsapp"></i>
                                        </button>
                                        {grupo._custom && (
                                          <>
                                            <button className="rota-whatsapp-btn" style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }} title="Editar"
                                              onClick={e => { e.stopPropagation(); setEditCustomContact({ contato: ct, rotaName: grupo.rota }); setEditContactName(ct.pushName || ''); setEditContactPhone((ct.remoteJid || '').replace(/@.*/, '').replace(/\D/g, '')); setEditContactCity(ct.cidade || '') }}>
                                              <i className="fa-solid fa-pen" style={{ fontSize: '0.65rem' }}></i>
                                            </button>
                                            <button className="rota-whatsapp-btn" style={{ background: '#dc2626', borderColor: '#dc2626' }} title="Remover"
                                              onClick={e => { e.stopPropagation(); if (confirm(`Remover ${ct.pushName || 'contato'} da rota "${grupo.rota}"?`)) { setCustomRotas(prev => prev.map(cr => cr.rota === grupo.rota ? { ...cr, cidades: cr.cidades.map(cid => ({ ...cid, contatos: cid.contatos.filter(x => x.remoteJid !== ct.remoteJid) })).filter(cid => cid.contatos.length > 0) } : cr).filter(cr => cr.cidades.length > 0)); showToast('Contato removido') } }}>
                                              <i className="fa-solid fa-trash" style={{ fontSize: '0.65rem' }}></i>
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {rotas.length === 0 && !rotasLoading && !rotasError && (
              <div className="rota-empty-state">
                <div className="rota-empty-icon"><i className="fa-solid fa-route"></i></div>
                <h3>Nenhuma rota carregada</h3>
                <p>Clique em "Atualizar" para buscar as rotas do WhatsApp</p>
                <button className="admin-btn admin-btn-primary" onClick={fetchRotas}>
                  <i className="fa-solid fa-rotate"></i> Atualizar Rotas
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'financeiro' && (
          <div className="admin-section">
            <h1>Financeiro</h1>
            <p className="admin-subtitle">Controle de contas a prazo e recebimentos</p>

            <div className="admin-cards">
              <div className="admin-card card-red">
                <i className="fa-solid fa-exclamation-triangle"></i>
                <div>
                  <strong>{formatPreco(finTotal.atrasado)}</strong>
                  <span>Em Atraso</span>
                </div>
              </div>
              <div className="admin-card card-yellow">
                <i className="fa-solid fa-clock"></i>
                <div>
                  <strong>{formatPreco(finTotal.pendente)}</strong>
                  <span>A Receber</span>
                </div>
              </div>
              <div className="admin-card card-green">
                <i className="fa-solid fa-check-circle"></i>
                <div>
                  <strong>{formatPreco(finTotal.pago)}</strong>
                  <span>Recebido</span>
                </div>
              </div>
            </div>

            <div className="admin-tabs">
              {[
                { id: 'todos', label: 'Todas', count: financial.length },
                { id: 'pendente', label: 'Pendentes', count: financial.filter(f => f.status === 'pendente').length },
                { id: 'pago', label: 'Pagas', count: financial.filter(f => f.status === 'pago').length },
              ].map(t => (
                <button key={t.id} className={`admin-tab ${finFilter === t.id ? 'active' : ''}`} onClick={() => setFinFilter(t.id)}>
                  {t.label} {t.count > 0 && <span className="tab-count">{t.count}</span>}
                </button>
              ))}
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Item</th>
                    <th>Qtd</th>
                    <th>Valor</th>
                    <th>Vencimento</th>
                    <th>Dias</th>
                    <th>Status</th>
                    <th>Pagamento</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredFin.map(f => {
                    const dias = diffDays(hoje(), f.dueDate)
                    const atrasado = f.status === 'pendente' && dias > 0
                    return (
                      <tr key={f.id} className={atrasado ? 'row-overdue' : ''}>
                        <td>{f.customerName}</td>
                        <td className="td-prod-name">{f.itemName}</td>
                        <td>{f.qty}</td>
                        <td className="td-price">{formatPreco(f.value)}</td>
                        <td>{formatDate(f.dueDate)}</td>
                        <td>
                          {f.status === 'pago' ? (
                            <span className="days-ok">Pago</span>
                          ) : dias > 0 ? (
                            <span className="days-overdue">+{dias} dias</span>
                          ) : dias === 0 ? (
                            <span className="days-today">Vence hoje</span>
                          ) : (
                            <span className="days-future">Faltam {Math.abs(dias)} dias</span>
                          )}
                        </td>
                        <td>
                          <span className={`status-tag ${atrasado ? 'status-atrasado' : f.status === 'pendente' ? 'status-pendente' : 'status-pago'}`}>
                            {atrasado ? 'Atrasado' : f.status === 'pendente' ? 'Pendente' : 'Pago'}
                          </span>
                        </td>
                        <td>
                          {f.paidDate ? formatDate(f.paidDate) : '-'}
                        </td>
                        <td>
                          <div className="td-actions">
                            {f.status === 'pendente' && (
                              <>
                                <button className="action-btn action-confirm" title="Quitar" onClick={() => quitarFin(f.id)}>
                                  <i className="fa-solid fa-check"></i>
                                </button>
                                <button className="action-btn" title="Editar vencimento" onClick={() => setFinEdit(f)}>
                                  <i className="fa-solid fa-calendar"></i>
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredFin.length === 0 && <tr><td colSpan="9" className="td-empty">Nenhum registro financeiro</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* MODAL ADD ORDER */}
      {showAddOrder && (
        <AddOrderModal
          produtos={produtosAtuais}
          usuarios={usuarios}
          initialCart={prodCart}
          preselectedUser={preselectedUserForOrder}
          onSave={(order) => { addOrder(order); clearProdCart() }}
          onClose={() => { setShowAddOrder(false); setPreselectedUserForOrder(null); clearProdCart() }}
        />
      )}

      {/* MODAL ORDER DETAIL */}
      {showOrderDetail && (
        <OrderDetailModal
          order={showOrderDetail}
          financial={financial.filter(f => f.orderId === showOrderDetail.id)}
          produtos={produtosAtuais}
          onClose={() => setShowOrderDetail(null)}
          onStatusChange={(s) => { updateOrderStatus(showOrderDetail.id, s); setShowOrderDetail(null) }}
          onPreApprovar={(rejectedIds, replacements) => preApprovarPedido(showOrderDetail.id, rejectedIds, replacements)}
          onOpenDelivery={(order) => { setShowDeliveryModal(order); setReturnQuantities({}); setPayQuantities({}); setIdentityPreview(''); setAddressPreview('') }}
          onEditAndConfirm={(editedItems, currentStatus) => {
            const totalAvista = editedItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
            const totalAprazo = editedItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
            setOrders(prev => prev.map(o => o.id === showOrderDetail.id ? {
              ...o,
              items: editedItems,
              totalAvista,
              totalAprazo,
              total: totalAvista + totalAprazo,
              status: 'em-rota'
            } : o))
            showToast(`Pedido #${showOrderDetail.id} atualizado e enviado para rota!`)
            setShowOrderDetail(null)
          }}
          onUpdateCustomer={(id, customerData) => updateOrderCustomer(id, customerData)}
          onCancelOrder={(id) => cancelOrder(id)}
        />
      )}

      {/* MODAL DELIVERY (UNIFIED FINALIZATION) */}
      {showDeliveryModal && (
        <div className="admin-overlay" onClick={() => setShowDeliveryModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '540px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-check-circle"></i> Finalizar Pedido</h3>
              <button className="admin-modal-close" onClick={() => setShowDeliveryModal(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ fontSize: '0.85rem', color: 'var(--admin-text-sec)', marginBottom: '0.75rem' }}>
                Informe a quantidade de itens <strong>devolvidos</strong> (não vendidos). Apenas os itens vendidos serão cobrados.
              </p>

              {showDeliveryModal.items.map((i, idx) => {
                const maxQty = i.qty
                return (
                  <div key={idx} style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--admin-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{i.nome} ({i.qty}x)</span>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{formatPreco(i.preco * i.qty)}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', marginBottom: '0.35rem' }}>
                      {i.preco.toFixed(2).replace('.', ',')} /un — {i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem' }}>
                        <span style={{ color: 'var(--admin-text-sec)' }}>Devolver:</span>
                        <input type="number" min="0" max={maxQty} step="1" value={returnQuantities[i.id] || ''}
                          placeholder="0"
                          onChange={e => {
                            const val = e.target.value === '' ? '' : Math.min(Number(e.target.value), maxQty)
                            setReturnQuantities(prev => ({ ...prev, [i.id]: val }))
                          }}
                          style={{ width: '50px', padding: '0.25rem 0.35rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', textAlign: 'center' }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Auto-calc summary */}
              {(() => {
                const totalOriginal = showDeliveryModal.items.reduce((s, i) => s + i.preco * i.qty, 0)
                const totalDevolvido = showDeliveryModal.items.reduce((s, i) => s + i.preco * (returnQuantities[i.id] || 0), 0)
                const totalCobrar = totalOriginal - totalDevolvido
                return (
                  <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1rem', marginTop: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem' }}>
                      <span>Total original</span>
                      <span>{formatPreco(totalOriginal)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem', color: 'var(--danger)' }}>
                      <span><i className="fa-solid fa-rotate-left"></i> Total devolvido</span>
                      <span style={{ fontWeight: 700 }}>{formatPreco(totalDevolvido)}</span>
                    </div>
                    <div style={{ borderTop: '1px solid var(--admin-border)', marginTop: '0.35rem', paddingTop: '0.35rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                      <span style={{ fontWeight: 700 }}>Total a cobrar</span>
                      <span style={{ fontWeight: 800, color: totalCobrar > 0 ? 'var(--accent)' : 'var(--success)' }}>{formatPreco(totalCobrar)}</span>
                    </div>
                  </div>
                )
              })()}

              {/* Document upload (optional) */}
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  <i className="fa-solid fa-file"></i> Documentos <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>(opcional)</span>
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '140px' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem', color: 'var(--admin-text-sec)' }}>Foto de Identidade</label>
                    <input type="file" accept="image/*" onChange={e => handleDeliveryFile(e, 'identity')} style={{ fontSize: '0.75rem', width: '100%' }} />
                    {identityPreview && <img src={identityPreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '50px', marginTop: '0.25rem', borderRadius: '4px' }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: '140px' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem', color: 'var(--admin-text-sec)' }}>Comprovante de Endereço</label>
                    <input type="file" accept="image/*" onChange={e => handleDeliveryFile(e, 'address')} style={{ fontSize: '0.75rem', width: '100%' }} />
                    {addressPreview && <img src={addressPreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '50px', marginTop: '0.25rem', borderRadius: '4px' }} />}
                  </div>
                </div>
              </div>

              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setShowDeliveryModal(null)}>Cancelar</button>
                <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }}
                  onClick={() => finalizarComDevolucao(showDeliveryModal.id)}>
                  <i className="fa-solid fa-check"></i> Finalizar Pedido
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL BULK PRICE */}
      {showBulkPrice && (
        <div className="admin-overlay" onClick={() => { setShowBulkPrice(false); setBulkPriceValue('') }}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-dollar-sign"></i> Trocar Preço em Massa</h3>
              <button className="admin-modal-close" onClick={() => { setShowBulkPrice(false); setBulkPriceValue('') }}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--admin-text-sec)' }}>
                Defina um novo preço para <strong>{prodSelectedIds.size} produto(s)</strong> selecionado(s):
              </p>
              <div className="form-group">
                <label>Novo preço (R$)</label>
                <input type="number" step="0.01" min="0" placeholder="0,00" value={bulkPriceValue} onChange={e => setBulkPriceValue(e.target.value)} autoFocus />
              </div>
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => { setShowBulkPrice(false); setBulkPriceValue('') }}>Cancelar</button>
                <button className="admin-btn admin-btn-primary" disabled={!bulkPriceValue} onClick={applyBulkPrice}>
                  <i className="fa-solid fa-check"></i> Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBulkStock && (
        <div className="admin-overlay" onClick={() => { setShowBulkStock(false); setBulkStockValue('') }}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-warehouse"></i> Definir Estoque em Massa</h3>
              <button className="admin-modal-close" onClick={() => { setShowBulkStock(false); setBulkStockValue('') }}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--admin-text-sec)' }}>
                Defina a quantidade em estoque para <strong>{prodSelectedIds.size} produto(s)</strong> selecionado(s):
              </p>
              <div className="form-group">
                <label>Quantidade</label>
                <input type="number" step="1" min="0" placeholder="0" value={bulkStockValue} onChange={e => setBulkStockValue(e.target.value)} autoFocus />
              </div>
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => { setShowBulkStock(false); setBulkStockValue('') }}>Cancelar</button>
                <button className="admin-btn admin-btn-primary" disabled={bulkStockValue === ''} onClick={applyBulkStock}>
                  <i className="fa-solid fa-check"></i> Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {customMsgRota && (
        <div className="admin-overlay" onClick={() => { setCustomMsgRota(null); setCustomMsgText('') }}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-pen"></i> Mensagem Personalizada</h3>
              <button className="admin-modal-close" onClick={() => { setCustomMsgRota(null); setCustomMsgText('') }}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--admin-text-sec)' }}>
                Enviar mensagem personalizada para <strong>{customMsgRota.total} contatos</strong> da rota <strong>{customMsgRota.rota}</strong>:
              </p>
              <div className="form-group">
                <label>Texto da mensagem</label>
                <textarea
                  placeholder="Digite a mensagem que será enviada..."
                  value={customMsgText}
                  onChange={e => setCustomMsgText(e.target.value)}
                  rows={5}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit' }}
                  autoFocus
                />
              </div>
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => { setCustomMsgRota(null); setCustomMsgText('') }}>Cancelar</button>
                <button className="admin-btn admin-btn-primary" disabled={!customMsgText.trim()} onClick={() => {
                  sendAlertRota('personalizado', customMsgRota.contatos, orders, customMsgText.trim())
                  showToast(`Mensagem enviada para ${customMsgRota.total} contatos`)
                  setCustomMsgRota(null)
                  setCustomMsgText('')
                }}>
                  <i className="fa-solid fa-paper-plane"></i> Enviar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNewRota && (
        <div className="admin-overlay" onClick={() => setShowNewRota(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-plus-circle"></i> Nova Rota</h3>
              <button className="admin-modal-close" onClick={() => setShowNewRota(false)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <div className="form-group">
                <label>Nome da Rota</label>
                <input type="text" placeholder="Ex: Zona Norte" value={newRotaName} onChange={e => setNewRotaName(e.target.value)} autoFocus />
              </div>
              <div style={{ marginBottom: '0.75rem', padding: '0.65rem', background: '#f9fafb', borderRadius: '8px', border: '1px dashed var(--admin-border)' }}>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.82rem', fontWeight: 600 }}>Adicionar Contato Manual</label>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                  <input type="text" placeholder="Telefone (obrigatório)" value={newContactPhone} onChange={e => setNewContactPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} style={{ flex: 1, minWidth: '140px', padding: '0.4rem 0.55rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.8rem' }} />
                  <input type="text" placeholder="Nome (opcional)" value={newContactName} onChange={e => setNewContactName(e.target.value)} style={{ flex: 1, minWidth: '140px', padding: '0.4rem 0.55rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.8rem' }} />
                  <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem', background: '#059669', color: 'white', borderColor: '#059669' }} disabled={!newContactPhone} onClick={() => {
                    const nums = newContactPhone.replace(/\D/g, '')
                    if (nums.length < 10) { showToast('Telefone inválido — mínimo 10 dígitos', 'error'); return }
                    const normalized = nums.startsWith('55') ? nums : '55' + nums
                    const allExisting = [...rotas, ...newRotaSelected]
                    if (allExisting.some(r => (r.remoteJid || '').includes(normalized))) { showToast('Este telefone já está na lista', 'error'); return }
                    const name = newContactName.trim() || 'Contato'
                    setNewRotaSelected(prev => [...prev, { remoteJid: `${normalized}@s.whatsapp.net`, pushName: name, nome: name, cidade: 'Personalizado' }])
                    setNewContactPhone('')
                    setNewContactName('')
                    showToast(`${name} adicionado à seleção`)
                  }}>
                    <i className="fa-solid fa-plus"></i> Adicionar
                  </button>
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--admin-text-sec)', margin: 0 }}>Digite apenas números — o sistema normaliza automaticamente com 55</p>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.82rem', fontWeight: 600 }}>Buscar Contatos Existentes</label>
                <div className="admin-search-prod" style={{ marginBottom: '0.5rem' }}>
                  <i className="fa-solid fa-search"></i>
                  <input type="text" placeholder="Buscar contatos..." value={newRotaSearch} onChange={e => setNewRotaSearch(e.target.value)} style={{ width: '100%' }} />
                </div>
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: '8px' }}>
                  {rotas.filter(r => {
                    const t = newRotaSearch.toLowerCase().trim()
                    if (!t) return false
                    return (r.pushName || '').toLowerCase().includes(t) || (r.remoteJid || '').includes(t) || (r.cidade || '').toLowerCase().includes(t)
                  }).slice(0, 30).map((r, i) => {
                    const phone = r.remoteJid?.replace(/@.*/, '').replace(/\D/g, '') || ''
                    const isSelected = newRotaSelected.some(s => s.remoteJid === r.remoteJid)
                    return (
                      <div key={i} className="add-prod-row" style={{ padding: '0.35rem 0.5rem' }}>
                        <div className="add-prod-info" style={{ flex: 1, minWidth: 0 }}>
                          <span className="add-prod-name" style={{ fontSize: '0.82rem' }}>{r.pushName || 'Sem nome'}</span>
                          <span className="add-prod-price" style={{ fontSize: '0.72rem' }}>{phone} {r.cidade ? `- ${r.cidade}` : ''}</span>
                        </div>
                        <button className={`add-prod-add ${isSelected ? 'in-cart' : ''}`} style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem' }}
                          onClick={() => {
                            if (isSelected) setNewRotaSelected(prev => prev.filter(s => s.remoteJid !== r.remoteJid))
                            else setNewRotaSelected(prev => [...prev, { ...r, cidade: r.cidade || 'Sem cidade' }])
                          }}>
                          {isSelected ? <><i className="fa-solid fa-check"></i> Adicionado</> : <><i className="fa-solid fa-plus"></i> Adicionar</>}
                        </button>
                      </div>
                    )
                  })}
                  {newRotaSearch && rotas.filter(r => (r.pushName || '').toLowerCase().includes(newRotaSearch.toLowerCase())).length === 0 && (
                    <p style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--admin-text-sec)' }}>Nenhum contato encontrado</p>
                  )}
                </div>
              </div>
              {newRotaSelected.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>{newRotaSelected.length} contato(s) selecionado(s):</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {newRotaSelected.map((s, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.5rem', background: '#eef2ff', borderRadius: '50px', fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 500 }}>
                        {s.pushName || s.remoteJid?.replace(/@.*/, '')}
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 0, fontSize: '0.75rem' }} onClick={() => setNewRotaSelected(prev => prev.filter(x => x.remoteJid !== s.remoteJid))}>
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setShowNewRota(false)}>Cancelar</button>
                <button className="admin-btn admin-btn-primary" disabled={!newRotaName.trim() || newRotaSelected.length === 0} onClick={() => {
                  const grouped = {}
                  newRotaSelected.forEach(s => {
                    const cid = s.cidade || 'Sem cidade'
                    if (!grouped[cid]) grouped[cid] = { cidade: cid, contatos: [] }
                    grouped[cid].contatos.push(s)
                  })
                  const novaRota = { rota: newRotaName.trim(), cidades: Object.values(grouped) }
                  setCustomRotas(prev => [...prev, novaRota])
                  showToast(`Rota "${newRotaName.trim()}" criada com ${newRotaSelected.length} contato(s)`)
                  setShowNewRota(false)
                  setNewRotaName('')
                  setNewRotaSearch('')
                  setNewRotaSelected([])
                }}>
                  <i className="fa-solid fa-check"></i> Criar Rota
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editCustomContact && (
        <div className="admin-overlay" onClick={() => setEditCustomContact(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-pen"></i> Editar Contato</h3>
              <button className="admin-modal-close" onClick={() => setEditCustomContact(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <div className="form-group">
                <label>Nome</label>
                <input type="text" placeholder="Nome do contato" value={editContactName} onChange={e => setEditContactName(e.target.value)} autoFocus />
              </div>
              <div className="form-group">
                <label>Telefone (com DDD, só números)</label>
                <input type="text" placeholder="31999999999" value={editContactPhone} onChange={e => setEditContactPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} />
              </div>
              <div className="form-group">
                <label>Cidade</label>
                <input type="text" placeholder="Cidade" value={editContactCity} onChange={e => setEditContactCity(e.target.value)} />
              </div>
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setEditCustomContact(null)}>Cancelar</button>
                <button className="admin-btn admin-btn-primary" disabled={!editContactPhone || editContactPhone.replace(/\D/g, '').length < 10} onClick={() => {
                  const nums = editContactPhone.replace(/\D/g, '')
                  const normalized = nums.startsWith('55') ? nums : '55' + nums
                  const oldJid = editCustomContact.contato.remoteJid
                  setCustomRotas(prev => prev.map(cr => cr.rota === editCustomContact.rotaName ? {
                    ...cr,
                    cidades: cr.cidades.map(cid => ({
                      ...cid,
                      contatos: cid.contatos.map(x => x.remoteJid === oldJid ? {
                        ...x,
                        pushName: editContactName.trim() || x.pushName,
                        remoteJid: `${normalized}@s.whatsapp.net`,
                        cidade: editContactCity.trim() || x.cidade
                      } : x)
                    }))
                  } : cr))
                  showToast('Contato atualizado')
                  setEditCustomContact(null)
                }}>
                  <i className="fa-solid fa-check"></i> Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KIT MODAL */}
      {showKitModal && (
        <KitModal
          produtos={produtosAtuais}
          kit={editingKit}
          onSave={(kit) => {
            const saved = { ...kit, id: kit.id || Date.now().toString(36) + Math.random().toString(36).substring(2, 6), criadoEm: new Date().toISOString() }
            const updated = editingKit ? kits.map(k => k.id === saved.id ? saved : k) : [...kits, saved]
            LS.set('thsm_kits', updated)
            setKits(updated)
            setShowKitModal(false)
            setEditingKit(null)
            showToast(`Kit "${saved.nome}" ${editingKit ? 'atualizado' : 'criado'}! URL: ${window.location.origin}${window.location.pathname}#/kit/${saved.id}`)
          }}
          onClose={() => { setShowKitModal(false); setEditingKit(null) }}
        />
      )}

      {/* Lista de Kits salvos */}
      {kits.length > 0 && tab === 'produtos' && !showKitModal && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h4 style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#166534' }}>
              <i className="fa-solid fa-toolbox"></i> Kits Criados
            </h4>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {kits.map(kit => (
              <div key={kit.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.65rem', background: 'white', borderRadius: '20px', border: '1px solid #bbf7d0', fontSize: '0.78rem' }}>
                <span style={{ fontWeight: 600 }}>{kit.nome}</span>
                <span style={{ color: 'var(--admin-text-sec)', fontSize: '0.7rem' }}>({(kit.produtoIds || []).length} prod)</span>
                <button style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.75rem', padding: '0.15rem 0.25rem' }} title="Copiar link" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}#/kit/${kit.id}`); showToast('Link copiado!') }}>
                  <i className="fa-solid fa-link"></i>
                </button>
                <button style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: '0.75rem', padding: '0.15rem 0.25rem' }} title="Editar" onClick={() => { setEditingKit(kit); setShowKitModal(true) }}>
                  <i className="fa-solid fa-pen"></i>
                </button>
                <button style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.75rem', padding: '0.15rem 0.25rem' }} title="Excluir" onClick={() => { if (confirm(`Excluir kit "${kit.nome}"?`)) { const updated = kits.filter(k => k.id !== kit.id); LS.set('thsm_kits', updated); setKits(updated); showToast('Kit excluído') } }}>
                  <i className="fa-solid fa-trash-can"></i>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL EDIT PRODUCT */}
      {editingProd && (
        <EditProductModal
          product={editingProd}
          onSave={(changes) => {
            if (editingProd._new) {
              const newId = editingProd.id
              setNewProducts(prev => {
                const exists = prev.find(p => p.id === newId)
                if (exists) return prev.map(p => p.id === newId ? { ...p, ...changes, _new: true } : p)
                return [{ ...changes, id: newId, _new: true }, ...prev]
              })
              setEditingProd(null)
            } else {
              updateProduct(editingProd.id, changes)
            }
          }}
          onClose={() => setEditingProd(null)}
        />
      )}

      {/* MODAL EDIT FINANCIAL */}
      {finEdit && (
        <div className="admin-overlay" onClick={() => setFinEdit(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="admin-modal-header">
              <h3>Editar Vencimento</h3>
              <button className="admin-modal-close" onClick={() => setFinEdit(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-sec)' }}>{finEdit.itemName} - {formatPreco(finEdit.value)}</p>
              <div className="form-group">
                <label>Nova data de vencimento</label>
                <input type="date" defaultValue={finEdit.dueDate} id="fin-due-input" />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <button className="admin-btn" onClick={() => {
                  const val = document.getElementById('fin-due-input').value
                  if (val) updateDueDate(finEdit.id, val)
                  setFinEdit(null)
                }}>Salvar</button>
                <button className="admin-btn admin-btn-sec" onClick={() => setFinEdit(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================
// MODAL: ADD ORDER
// =============================================
function AddOrderModal({ produtos, usuarios, initialCart, preselectedUser, onSave, onClose }) {
  const [step, setStep] = useState(1)
  const [showNewForm, setShowNewForm] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [cpf, setCpf] = useState('')
  const [endereco, setEndereco] = useState({ cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' })
  const [pagamento, setPagamento] = useState('avista')
  const [diasPrazo, setDiasPrazo] = useState(30)
  const [cart, setCart] = useState(() => {
    if (initialCart && Object.keys(initialCart).length > 0) {
      return Object.fromEntries(
        Object.entries(initialCart).map(([id, item]) => [id, { ...item, tipo: item.tipo || 'avista' }])
      )
    }
    return {}
  })
  const [search, setSearch] = useState('')
  const [prodPage, setProdPage] = useState(1)

  const filteredUsers = useMemo(() => {
    const t = userSearch.toLowerCase().trim()
    if (!t) return []
    return usuarios.filter(u =>
      u.nome?.toLowerCase().includes(t) ||
      u.telefone?.includes(t) ||
      (u.email || '').toLowerCase().includes(t)
    ).slice(0, 20)
  }, [usuarios, userSearch])

  useEffect(() => {
    if (preselectedUser) {
      pickUser(preselectedUser)
    }
  }, [])

  const pickUser = (u) => {
    setSelectedUser(u)
    setNome(u.nome || '')
    setTelefone(u.telefone || '')
    setEndereco(u.endereco || { cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' })
    setUserSearch('')
    setShowNewForm(false)
  }

  const resetForm = () => {
    setSelectedUser(null)
    setNome('')
    setTelefone('')
    setEndereco({ cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' })
    setShowNewForm(true)
    setUserSearch('')
  }

  const filteredProds = useMemo(() => {
    const t = search.toLowerCase().trim()
    return t ? produtos.filter(p => p.nome.toLowerCase().includes(t)) : produtos
  }, [produtos, search])

  const paginatedProds = useMemo(() => {
    const start = (prodPage - 1) * 10
    return filteredProds.slice(start, start + 10)
  }, [filteredProds, prodPage])

  const totalPages = Math.ceil(filteredProds.length / 10)
  useEffect(() => { setProdPage(1) }, [search])

  const cartItems = useMemo(() => Object.values(cart).filter(i => i.qty > 0), [cart])
  const cartTotal = useMemo(() => cartItems.reduce((s, i) => s + i.preco * i.qty, 0), [cartItems])

  const addItem = (p) => {
    setCart(prev => ({ ...prev, [p.id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, qty: (prev[p.id]?.qty || 0) + 1, tipo: 'aprazo' } }))
  }

  const removeItem = (id) => {
    setCart(prev => {
      if (!prev[id] || prev[id].qty <= 1) {
        const { [id]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [id]: { ...prev[id], qty: prev[id].qty - 1 } }
    })
  }

  const setItemTipo = (id, tipo) => {
    setCart(prev => prev[id] ? { ...prev, [id]: { ...prev[id], tipo } } : prev)
  }

  const formatPhone = (v) => {
    const nums = v.replace(/\D/g, '').slice(0, 11)
    if (nums.length <= 2) return `(${nums}`
    if (nums.length <= 7) return `(${nums.slice(0, 2)}) ${nums.slice(2)}`
    return `(${nums.slice(0, 2)}) ${nums.slice(2, 7)}-${nums.slice(7)}`
  }

  const normalizePhone = (v) => {
    const nums = v.replace(/\D/g, '')
    return nums.startsWith('55') ? nums : '55' + nums
  }

  const handleSave = () => {
    if (cartItems.length === 0 || !nome.trim() || !telefone.trim() || !cpf.trim()) return
    onSave({
      nome: nome.trim(),
      telefone: normalizePhone(telefone),
      cpf: cpf.trim(),
      endereco,
      pagamento: pagamento === 'misto' ? 'misto' : (pagamento === 'aprazo' ? 'aprazo' : 'avista'),
      items: cartItems.map(i => ({ ...i, tipo: pagamento === 'aprazo' ? 'aprazo' : (pagamento === 'avista' ? 'avista' : i.tipo) })),
      diasParaVencimento: (pagamento === 'aprazo' || pagamento === 'misto') ? diasPrazo : 0
    })
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal admin-modal-lg" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h3><i className="fa-solid fa-plus-circle"></i> Novo Pedido</h3>
          <button className="admin-modal-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>

        <div className="admin-steps">
          <span className={`step ${step >= 1 ? (step > 1 ? 'done' : 'active') : ''}`}>1. Cliente</span>
          <span className={`step ${step >= 2 ? (step > 2 ? 'done' : 'active') : ''}`}>2. Itens</span>
          <span className={`step ${step >= 3 ? (step > 3 ? 'done' : 'active') : ''}`}>3. Pagamento</span>
        </div>

        <div className="admin-modal-body">
          {step === 1 && (
            <div className="modal-form">
              {!showNewForm && !selectedUser && (
                <>
                  <div className="form-group">
                    <label>Buscar cliente existente</label>
                    <div className="admin-search-prod">
                      <i className="fa-solid fa-search"></i>
                      <input type="text" placeholder="Digite nome, telefone ou email..." value={userSearch} onChange={e => setUserSearch(e.target.value)} style={{ width: '100%' }} />
                    </div>
                    {filteredUsers.length > 0 && (
                      <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: '8px', marginTop: '0.4rem' }}>
                        {filteredUsers.map(u => (
                          <div key={u.id} className="add-prod-row" style={{ cursor: 'pointer', padding: '0.5rem 0.7rem' }} onClick={() => pickUser(u)}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{u.nome}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>{u.telefone} {u.email ? `· ${u.email}` : ''} {u.endereco?.cidade ? `· ${u.endereco.cidade}` : ''}</div>
                            </div>
                            <i className="fa-solid fa-chevron-right" style={{ color: 'var(--admin-text-sec)', fontSize: '0.75rem' }}></i>
                          </div>
                        ))}
                      </div>
                    )}
                    {userSearch && filteredUsers.length === 0 && (
                      <p style={{ fontSize: '0.82rem', color: 'var(--admin-text-sec)', marginTop: '0.4rem' }}>
                        Nenhum cliente encontrado. <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginLeft: '0.3rem' }} onClick={resetForm}><i className="fa-solid fa-plus"></i> Adicionar Novo</button>
                      </p>
                    )}
                    {!userSearch && (
                      <p style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', marginTop: '0.5rem' }}>
                        Ou <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={resetForm}><i className="fa-solid fa-plus"></i> Adicionar Novo Cliente</button>
                      </p>
                    )}
                  </div>
                </>
              )}

              {(selectedUser || showNewForm) && (
                <>
                  {selectedUser && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.7rem', background: 'var(--accent-bg)', borderRadius: '8px', marginBottom: '0.75rem' }}>
                      <i className="fa-solid fa-user-check" style={{ color: 'var(--accent)' }}></i>
                      <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 500 }}>{selectedUser.nome} — {selectedUser.telefone}</span>
                      <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => { setSelectedUser(null); setShowNewForm(false); setNome(''); setTelefone(''); setCpf(''); setEndereco({ cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' }) }}>
                        <i className="fa-solid fa-xmark"></i> Trocar
                      </button>
                    </div>
                  )}

                  <div className="form-group">
                    <label>Nome do cliente *</label>
                    <input type="text" placeholder="Nome completo" value={nome} onChange={e => setNome(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Telefone / WhatsApp *</label>
                    <input type="text" placeholder="(31) 99999-9999" value={formatPhone(telefone)} onChange={e => setTelefone(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>CPF *</label>
                    <input type="text" placeholder="000.000.000-00" value={cpf} onChange={e => setCpf(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Endereço</label>
                    <AddressForm value={endereco} onChange={(a) => setEndereco(a)} />
                  </div>
                </>
              )}

              {showNewForm && !selectedUser && (
                <div className="form-group">
                  <div className="form-group">
                    <label>Nome do cliente *</label>
                    <input type="text" placeholder="Nome completo" value={nome} onChange={e => setNome(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Telefone / WhatsApp *</label>
                    <input type="text" placeholder="(31) 99999-9999" value={formatPhone(telefone)} onChange={e => setTelefone(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>CPF *</label>
                    <input type="text" placeholder="000.000.000-00" value={cpf} onChange={e => setCpf(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Endereço</label>
                    <AddressForm value={endereco} onChange={(a) => setEndereco(a)} />
                  </div>
                </div>
              )}

              <button className="admin-btn admin-btn-primary" disabled={!nome.trim() || !telefone.trim() || !cpf.trim()} onClick={() => setStep(2)} style={{ marginTop: '0.75rem' }}>
                Próximo <i className="fa-solid fa-arrow-right"></i>
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="modal-form">
              <div className="admin-search-prod" style={{ marginBottom: '0.75rem' }}>
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>

              <div className="add-prod-list">
                {paginatedProds.map(p => {
                  const inCart = cart[p.id]
                  return (
                    <div key={p.id} className={`add-prod-row ${inCart ? 'in-cart' : ''}`}>
                      <div className="add-prod-info">
                        <span className="add-prod-name">{p.nome}</span>
                        <span className="add-prod-price">{formatPreco(p.preco)}</span>
                      </div>
                      {inCart ? (
                        <div className="add-prod-controls">
                          <span className="add-prod-qty">{inCart.qty}x</span>
                          <button className="qty-btn-sm" onClick={() => removeItem(p.id)}><i className="fa-solid fa-minus"></i></button>
                          <button className="qty-btn-sm" onClick={() => addItem(p)}><i className="fa-solid fa-plus"></i></button>
                        </div>
                      ) : (
                        <button className="add-prod-add" onClick={() => addItem(p)}>
                          <i className="fa-solid fa-plus"></i> Adicionar
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {totalPages > 1 && (
                <div className="admin-pagination" style={{ marginTop: '0.75rem' }}>
                  <button disabled={prodPage === 1} onClick={() => setProdPage(p => p - 1)}><i className="fa-solid fa-chevron-left"></i></button>
                  <span>{prodPage}/{totalPages}</span>
                  <button disabled={prodPage === totalPages} onClick={() => setProdPage(p => p + 1)}><i className="fa-solid fa-chevron-right"></i></button>
                </div>
              )}

              {cartItems.length > 0 && (
                <div className="add-prod-summary">
                  <span>{cartItems.length} itens adicionados</span>
                  <span>Total: <strong>{formatPreco(cartTotal)}</strong></span>
                </div>
              )}

              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setStep(1)}><i className="fa-solid fa-arrow-left"></i> Voltar</button>
                <button className="admin-btn admin-btn-primary" disabled={cartItems.length === 0} onClick={() => setStep(3)}>
                  Próximo <i className="fa-solid fa-arrow-right"></i>
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="modal-form">
              <div className="payment-options-admin">
                <label className={`pay-opt ${pagamento === 'avista' ? 'selected' : ''}`}>
                  <input type="radio" name="pag" value="avista" checked={pagamento === 'avista'} onChange={() => setPagamento('avista')} />
                  <i className="fa-solid fa-money-bill-wave"></i>
                  <div><strong>À Vista</strong><span>Pagar tudo agora</span></div>
                </label>
                <label className={`pay-opt ${pagamento === 'aprazo' ? 'selected' : ''}`}>
                  <input type="radio" name="pag" value="aprazo" checked={pagamento === 'aprazo'} onChange={() => setPagamento('aprazo')} />
                  <i className="fa-solid fa-calendar"></i>
                  <div><strong>A Prazo</strong><span>Pagar depois</span></div>
                </label>
                <label className={`pay-opt ${pagamento === 'misto' ? 'selected' : ''}`}>
                  <input type="radio" name="pag" value="misto" checked={pagamento === 'misto'} onChange={() => setPagamento('misto')} />
                  <i className="fa-solid fa-split"></i>
                  <div><strong>Misto</strong><span>Parte agora, parte depois</span></div>
                </label>
              </div>

              {(pagamento === 'aprazo' || pagamento === 'misto') && (
                <div className="form-group">
                  <label>Dias para vencimento</label>
                  <input type="number" min={1} max={365} value={diasPrazo} onChange={e => setDiasPrazo(Number(e.target.value))} />
                </div>
              )}

              {pagamento === 'misto' && (
                <div className="split-admin">
                  <p className="split-label">Defina cada item:</p>
                  {cartItems.map(i => (
                    <div key={i.id} className={`split-row-admin ${i.tipo === 'aprazo' ? 'prazo' : 'vista'}`} onClick={() => setItemTipo(i.id, i.tipo === 'avista' ? 'aprazo' : 'avista')}>
                      <span>{i.nome} ({i.qty}x)</span>
                      <span className={`split-badge ${i.tipo === 'avista' ? 'vista' : 'aprazo'}`}>
                        {i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setStep(2)}><i className="fa-solid fa-arrow-left"></i> Voltar</button>
                <button className="admin-btn admin-btn-primary btn-save-order" disabled={cartItems.length === 0} onClick={handleSave}>
                  <i className="fa-solid fa-check"></i> Salvar Pedido
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================
// MODAL: ORDER DETAIL (with pre-pedido review + pendente edit)
// =============================================
function OrderDetailModal({ order, financial, produtos, onClose, onStatusChange, onPreApprovar, onEditAndConfirm, onOpenDelivery, onUpdateCustomer, onCancelOrder }) {
  const [rejectedItems, setRejectedItems] = useState(new Set())
  const [editMode, setEditMode] = useState(false)
  const [editedItems, setEditedItems] = useState(order.items.map(i => ({ ...i })))
  const [addSearch, setAddSearch] = useState('')
  const [addCart, setAddCart] = useState({})
  const [preAddSearch, setPreAddSearch] = useState('')
  const [preAddCart, setPreAddCart] = useState({})
  const [preReplacements, setPreReplacements] = useState([])
  const [customerEdit, setCustomerEdit] = useState(false)
  const [editCustomer, setEditCustomer] = useState({
    nome: order.customer?.nome || '',
    email: order.customer?.email || '',
    telefone: order.customer?.telefone || '',
    cpf: order.customer?.cpf || '',
    endereco: { ...(order.customer?.endereco || {}) }
  })

  const toggleReject = (idx) => {
    setRejectedItems(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  const changeQty = (idx, delta) => {
    setEditedItems(prev => prev.map((item, i) => i === idx ? { ...item, qty: Math.max(0, item.qty + delta) } : item))
  }

  const removeItem = (idx) => {
    setEditedItems(prev => prev.filter((_, i) => i !== idx))
  }

  const addItemToEdit = (p) => {
    setAddCart(prev => ({
      ...prev,
      [p.id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, tipo: 'aprazo', qty: (prev[p.id]?.qty || 0) + 1 }
    }))
  }

  const removeFromAddCart = (id) => {
    setAddCart(prev => {
      if (!prev[id] || prev[id].qty <= 1) {
        const { [id]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [id]: { ...prev[id], qty: prev[id].qty - 1 } }
    })
  }

  const confirmAddItems = () => {
    const newItems = Object.values(addCart).filter(i => i.qty > 0)
    if (newItems.length === 0) return
    setEditedItems(prev => [...prev, ...newItems])
    setAddCart({})
    setAddSearch('')
  }

  const handleEditConfirm = () => {
    const validItems = editedItems.filter(i => i.qty > 0)
    if (validItems.length === 0) { return }
    onEditAndConfirm(validItems, order.status)
  }

  const editTotal = editedItems.filter(i => i.qty > 0).reduce((s, i) => s + i.preco * i.qty, 0)

  const filteredAddProds = useMemo(() => {
    const t = addSearch.toLowerCase().trim()
    if (!t) return []
    return produtos.filter(p => p.nome.toLowerCase().includes(t)).slice(0, 10)
  }, [produtos, addSearch])

  const filteredPreAddProds = useMemo(() => {
    const t = preAddSearch.toLowerCase().trim()
    if (!t) return []
    return produtos.filter(p => p.nome.toLowerCase().includes(t)).slice(0, 10)
  }, [produtos, preAddSearch])

  const addToPreReplacement = (p) => {
    setPreAddCart(prev => ({
      ...prev,
      [p.id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, tipo: 'aprazo', qty: (prev[p.id]?.qty || 0) + 1 }
    }))
  }

  const removeFromPreCart = (id) => {
    setPreAddCart(prev => {
      if (!prev[id] || prev[id].qty <= 1) {
        const { [id]: _, ...keep } = prev
        return keep
      }
      return { ...prev, [id]: { ...prev[id], qty: prev[id].qty - 1 } }
    })
  }

  const confirmPreReplacements = () => {
    const newItems = Object.values(preAddCart).filter(i => i.qty > 0)
    if (newItems.length === 0) return
    setPreReplacements(prev => [...prev, ...newItems])
    setPreAddCart({})
    setPreAddSearch('')
  }

  if (editMode) {
    return (
      <div className="admin-overlay" onClick={() => { setEditMode(false); setEditedItems(order.items.map(i => ({ ...i }))); setAddCart({}) }}>
        <div className="admin-modal admin-modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
          <div className="admin-modal-header">
            <h3><i className="fa-solid fa-pen"></i> Editar Itens — Pedido #{order.id.toString().slice(-6)}</h3>
            <button className="admin-modal-close" onClick={() => { setEditMode(false); setEditedItems(order.items.map(i => ({ ...i }))); setAddCart({}) }}><i className="fa-solid fa-xmark"></i></button>
          </div>
          <div className="admin-modal-body">
            <div className="detail-section">
              <h4>Itens do Pedido</h4>
              {editedItems.map((i, idx) => (
                <div key={idx} className="detail-item" style={{ opacity: i.qty <= 0 ? 0.4 : 1 }}>
                  <div style={{ flex: 1 }}>
                    <span className="detail-item-name" style={{ textDecoration: i.qty <= 0 ? 'line-through' : 'none' }}>{i.nome}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--admin-text-sec)' }}>Preço:</span>
                      <input type="number" step="0.01" min="0" value={i.preco}
                        onChange={e => {
                          const val = parseFloat(e.target.value)
                          if (!isNaN(val) && val >= 0) {
                            setEditedItems(prev => prev.map((item, ii) => ii === idx ? { ...item, preco: val } : item))
                          }
                        }}
                        style={{ width: '80px', padding: '0.2rem 0.35rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', textAlign: 'right' }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span className={`split-badge ${i.tipo === 'avista' ? 'vista' : 'aprazo'}`}>
                      {i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px', border: '1px solid var(--admin-border)', borderRadius: '6px', padding: '2px' }}>
                      <button className="qty-btn-sm" onClick={() => changeQty(idx, -1)}><i className="fa-solid fa-minus"></i></button>
                      <span style={{ minWidth: '20px', textAlign: 'center', fontSize: '0.82rem', fontWeight: 600 }}>{i.qty}</span>
                      <button className="qty-btn-sm" onClick={() => changeQty(idx, 1)}><i className="fa-solid fa-plus"></i></button>
                    </div>
                    <button className="action-btn action-delete" title="Remover" onClick={() => removeItem(idx)}><i className="fa-solid fa-trash"></i></button>
                  </div>
                </div>
              ))}
              {editedItems.length === 0 && <p style={{ fontSize: '0.85rem', color: 'var(--admin-text-sec)' }}>Nenhum item no pedido</p>}
            </div>

            <div className="detail-section">
              <h4><i className="fa-solid fa-plus-circle"></i> Adicionar Produtos</h4>
              <div className="admin-search-prod" style={{ marginBottom: '0.5rem' }}>
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar produto para adicionar..." value={addSearch} onChange={e => setAddSearch(e.target.value)} style={{ width: '100%' }} />
              </div>
              {filteredAddProds.length > 0 && (
                <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: '8px' }}>
                  {filteredAddProds.map(p => {
                    const inCart = addCart[p.id]
                    return (
                      <div key={p.id} className="add-prod-row" style={{ padding: '0.4rem 0.6rem' }}>
                        <div className="add-prod-info">
                          <span className="add-prod-name">{p.nome}</span>
                          <span className="add-prod-price">{formatPreco(p.preco)}</span>
                        </div>
                        {inCart ? (
                          <div className="add-prod-controls">
                            <span className="add-prod-qty">{inCart.qty}x</span>
                            <button className="qty-btn-sm" onClick={() => removeFromAddCart(p.id)}><i className="fa-solid fa-minus"></i></button>
                            <button className="qty-btn-sm" onClick={() => addItemToEdit(p)}><i className="fa-solid fa-plus"></i></button>
                          </div>
                        ) : (
                          <button className="add-prod-add" onClick={() => addItemToEdit(p)}>
                            <i className="fa-solid fa-plus"></i> Adicionar
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {Object.values(addCart).filter(i => i.qty > 0).length > 0 && (
                <button className="admin-btn admin-btn-primary" style={{ marginTop: '0.5rem', fontSize: '0.82rem' }} onClick={confirmAddItems}>
                  <i className="fa-solid fa-check"></i> Adicionar {Object.values(addCart).reduce((s, i) => s + i.qty, 0)} item(ns) ao pedido
                </button>
              )}
              {!addSearch && <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Digite o nome do produto para buscá-lo no catálogo</p>}
            </div>

            <div className="detail-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Total: <strong style={{ color: 'var(--accent)', fontSize: '1.1rem' }}>{formatPreco(editTotal)}</strong></span>
                <span style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>{editedItems.filter(i => i.qty > 0).length} itens</span>
              </div>
            </div>

            <div className="modal-actions">
              <button className="admin-btn admin-btn-sec" onClick={() => { setEditMode(false); setEditedItems(order.items.map(i => ({ ...i }))); setAddCart({}) }}>Cancelar</button>
              <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} disabled={editedItems.filter(i => i.qty > 0).length === 0} onClick={handleEditConfirm}>
                <i className="fa-solid fa-check"></i> Salvar e Enviar para Rota
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div className="admin-modal-header">
          <h3><i className="fa-solid fa-receipt"></i> Pedido #{order.id.toString().slice(-6)}</h3>
          <button className="admin-modal-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>
        <div className="admin-modal-body">
          <div className="detail-section">
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Cliente
              {!customerEdit && order.status === 'pre-pedido' && (
                <button className="action-btn" title="Editar dados do cliente" onClick={() => setCustomerEdit(true)} style={{ color: '#2563eb', fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}>
                  <i className="fa-solid fa-pencil"></i>
                </button>
              )}
            </h4>
            {customerEdit ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div><strong style={{ fontSize: '0.78rem' }}>Nome:</strong>
                  <input type="text" value={editCustomer.nome} onChange={e => setEditCustomer(p => ({ ...p, nome: e.target.value }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>Email:</strong>
                  <input type="email" value={editCustomer.email} onChange={e => setEditCustomer(p => ({ ...p, email: e.target.value }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>Telefone:</strong>
                  <input type="text" value={editCustomer.telefone} onChange={e => setEditCustomer(p => ({ ...p, telefone: e.target.value }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>CPF:</strong>
                  <input type="text" value={editCustomer.cpf} onChange={e => setEditCustomer(p => ({ ...p, cpf: e.target.value }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} placeholder="000.000.000-00" />
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>Rua:</strong>
                  <input type="text" value={editCustomer.endereco.rua || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, rua: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <div style={{ flex: 1 }}><strong style={{ fontSize: '0.78rem' }}>Número:</strong>
                    <input type="text" value={editCustomer.endereco.numero || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, numero: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                  </div>
                  <div style={{ flex: 1 }}><strong style={{ fontSize: '0.78rem' }}>Bairro:</strong>
                    <input type="text" value={editCustomer.endereco.bairro || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, bairro: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <div style={{ flex: 1 }}><strong style={{ fontSize: '0.78rem' }}>Cidade:</strong>
                    <input type="text" value={editCustomer.endereco.cidade || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, cidade: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                  </div>
                  <div style={{ width: '70px' }}><strong style={{ fontSize: '0.78rem' }}>UF:</strong>
                    <input type="text" value={editCustomer.endereco.estado || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, estado: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                  </div>
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>CEP:</strong>
                  <input type="text" value={editCustomer.endereco.cep || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, cep: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>Complemento:</strong>
                  <input type="text" value={editCustomer.endereco.complemento || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, complemento: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem' }}>
                  <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} onClick={() => { setCustomerEdit(false); setEditCustomer({ nome: order.customer?.nome || '', email: order.customer?.email || '', telefone: order.customer?.telefone || '', endereco: { ...(order.customer?.endereco || {}) } }) }}>Cancelar</button>
                  <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} onClick={() => { onUpdateCustomer?.(order.id, editCustomer); setCustomerEdit(false) }}><i className="fa-solid fa-check"></i> Salvar Cliente</button>
                </div>
              </div>
            ) : (
              <>
                <p><strong>Nome:</strong> {order.customer?.nome || '-'}</p>
                <p><strong>Email:</strong> {order.customer?.email || '-'}</p>
                <p><strong>Telefone:</strong> {order.customer?.telefone || '-'}</p>
                {order.customer?.cpf && <p><strong>CPF:</strong> {order.customer.cpf}</p>}
                <p><strong>Endereço:</strong> {order.customer?.endereco ? [order.customer.endereco.rua, order.customer.endereco.numero, order.customer.endereco.bairro, order.customer.endereco.cidade, order.customer.endereco.estado].filter(Boolean).join(', ') || '-' : '-'}</p>
                {order.customer?.endereco?.cep && <p><strong>CEP:</strong> {order.customer.endereco.cep}</p>}
                {order.customer?.endereco?.complemento && <p><strong>Complemento:</strong> {order.customer.endereco.complemento}</p>}
              </>
            )}
          </div>

          <div className="detail-section">
            <h4>Itens</h4>
            {order.items.map((i, idx) => {
              const isRejected = rejectedItems.has(idx)
              return (
                <div key={idx} className="detail-item" style={{ opacity: isRejected ? 0.5 : 1 }}>
                  <div>
                    <span className="detail-item-name" style={{ textDecoration: isRejected ? 'line-through' : 'none' }}>{i.nome}</span>
                    <span className="detail-item-qty">{i.qty}x {formatPreco(i.preco)}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className={`split-badge ${i.tipo === 'avista' ? 'vista' : 'aprazo'}`}>
                      {i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                    </span>
                    {order.status === 'pre-pedido' && (
                      <button className={`action-btn ${isRejected ? 'action-confirm' : 'action-delete'}`}
                        title={isRejected ? 'Re-adicionar item' : 'Recusar item'}
                        onClick={() => toggleReject(idx)}>
                        <i className={`fa-solid ${isRejected ? 'fa-undo' : 'fa-ban'}`}></i>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {order.status === 'pre-pedido' && rejectedItems.size > 0 && (
            <div className="detail-section" style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)' }}>
              <h4 style={{ color: 'var(--danger)' }}><i className="fa-solid fa-ban"></i> Itens Recusados</h4>
              {[...rejectedItems].map(idx => (
                <p key={idx} style={{ fontSize: '0.82rem', color: 'var(--danger)', marginBottom: '0.2rem' }}>
                  {order.items[idx].nome} ({order.items[idx].qty}x)
                </p>
              ))}
            </div>
          )}

          {order.status === 'pre-pedido' && (
            <div className="detail-section">
              <h4><i className="fa-solid fa-exchange-alt"></i> Adicionar Substitutos</h4>
              <div className="admin-search-prod" style={{ marginBottom: '0.5rem' }}>
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar produto para substituir..." value={preAddSearch} onChange={e => setPreAddSearch(e.target.value)} style={{ width: '100%' }} />
              </div>
              {filteredPreAddProds.length > 0 && (
                <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: '8px' }}>
                  {filteredPreAddProds.map(p => {
                    const inCart = preAddCart[p.id]
                    return (
                      <div key={p.id} className="add-prod-row" style={{ padding: '0.35rem 0.5rem' }}>
                        <div className="add-prod-info">
                          <span className="add-prod-name">{p.nome}</span>
                          <span className="add-prod-price">{formatPreco(p.preco)}</span>
                        </div>
                        {inCart ? (
                          <div className="add-prod-controls">
                            <span className="add-prod-qty">{inCart.qty}x</span>
                            <button className="qty-btn-sm" onClick={() => removeFromPreCart(p.id)}><i className="fa-solid fa-minus"></i></button>
                            <button className="qty-btn-sm" onClick={() => addToPreReplacement(p)}><i className="fa-solid fa-plus"></i></button>
                          </div>
                        ) : (
                          <button className="add-prod-add" style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem' }} onClick={() => { setPreAddCart({ [p.id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, tipo: 'aprazo', qty: 1 } }) }}>
                            <i className="fa-solid fa-plus"></i> Substituto
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {Object.values(preAddCart).filter(i => i.qty > 0).length > 0 && (
                <button className="admin-btn" style={{ marginTop: '0.4rem', fontSize: '0.78rem', background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6' }} onClick={confirmPreReplacements}>
                  <i className="fa-solid fa-check"></i> Adicionar ao pedido
                </button>
              )}
              {preReplacements.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--success)', marginBottom: '0.25rem' }}>Produtos substitutos adicionados:</p>
                  {preReplacements.map((r, i) => (
                    <p key={i} style={{ fontSize: '0.8rem', color: 'var(--admin-text)', marginBottom: '0.15rem' }}>
                      {r.nome} ({r.qty}x) — {formatPreco(r.preco * r.qty)}
                    </p>
                  ))}
                </div>
              )}
              {!preAddSearch && preReplacements.length === 0 && <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Digite o nome de um produto para adicionar como substituto aos itens recusados</p>}
            </div>
          )}

          <div className="detail-section">
            <h4>Resumo</h4>
            <div className="detail-summary">
              {order.status === 'pre-pedido' && (() => {
                const rejectedSet = rejectedItems
                const kept = order.items.filter((_, i) => !rejectedSet.has(i))
                const all = [...kept, ...preReplacements]
                const av = all.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
                const ap = all.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
                return (
                  <>
                    <span style={{ color: 'var(--danger)' }}>Itens recusados: {rejectedItems.size}</span>
                    <span>Substitutos: {preReplacements.length} itens</span>
                    <span>Total <strong style={{ color: 'var(--accent)' }}>{formatPreco(av + ap)}</strong></span>
                    {ap > 0 && <span>📋 A prazo: <strong style={{ color: 'var(--warning)' }}>{formatPreco(ap)}</strong></span>}
                  </>
                )
              })()}
              {order.status !== 'pre-pedido' && (
                <span>Total: <strong>{formatPreco(order.total)}</strong></span>
              )}
              <span>Pagamento: {order.pagamento === 'avista' ? 'À Vista' : order.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</span>
              {order.pagamento === 'misto' && order.items && (
                <span style={{ fontSize: '0.78rem' }}>
                  💵 Pago: <strong style={{ color: 'var(--success)' }}>{formatPreco(order.items.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0))}</strong>
                  {' | '}📋 Devendo: <strong style={{ color: 'var(--warning)' }}>{formatPreco(order.items.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0))}</strong>
                </span>
              )}
              <span>Status: <span className={`status-tag status-${order.status}`}>{order.status}</span></span>
            </div>
          </div>

          {financial.length > 0 && (
            <div className="detail-section">
              <h4>Contas a Prazo</h4>
              {financial.map(f => (
                <div key={f.id} className="detail-item">
                  <div>
                    <span className="detail-item-name">{f.itemName}</span>
                    <span className="detail-item-qty">{formatPreco(f.value)} - Vence {formatDate(f.dueDate)}</span>
                  </div>
                  <span className={`status-tag ${f.status === 'pago' ? 'status-pago' : f.status === 'cancelado' ? 'status-cancelado' : 'status-pendente'}`}>
                    {f.status === 'pago' ? 'Pago' : f.status === 'cancelado' ? 'Cancelado' : 'Pendente'}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="modal-actions">
            {order.status === 'pendente' && (
              <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }}
                onClick={() => { setEditMode(true); setEditedItems(order.items.map(i => ({ ...i }))) }}>
                <i className="fa-solid fa-pen"></i> Editar Itens
              </button>
            )}
            {order.status === 'pre-pedido' && (
              <button className="admin-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6' }}
                onClick={() => onPreApprovar([...rejectedItems], preReplacements)}>
                <i className="fa-solid fa-clipboard-check"></i> OK
              </button>
            )}
            {order.status === 'pendente' && (
              <button className="admin-btn admin-btn-primary" onClick={() => onStatusChange('em-rota')}>
                <i className="fa-solid fa-truck"></i> Em Rota
              </button>
            )}
            {(order.status === 'pre-pedido' || order.status === 'pendente') && (
              <button className="admin-btn" style={{ background: 'var(--danger)', color: 'white', borderColor: 'var(--danger)' }} onClick={() => { if (confirm('Tem certeza que deseja cancelar esta comanda?')) { onCancelOrder?.(order.id) } }}>
                <i className="fa-solid fa-ban"></i> Cancelar Comanda
              </button>
            )}
            {order.returnedItems?.length > 0 && (
            <div className="detail-section">
              <h4 style={{ color: 'var(--danger)' }}><i className="fa-solid fa-rotate-left"></i> Itens Devolvidos</h4>
              {order.returnedItems.map((i, idx) => (
                <div key={idx} className="detail-item">
                  <span className="detail-item-name">{i.nome}</span>
                  <span className="detail-item-qty">{i.returnedQty}x devolvido</span>
                </div>
              ))}
            </div>
          )}

          {(order.identityPhoto || order.addressProof) && (
            <div className="detail-section">
              <h4><i className="fa-solid fa-file"></i> Documentos</h4>
              {order.identityPhoto && (
                <div style={{ marginBottom: '0.5rem' }}>
                  <p style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.25rem' }}>Identidade</p>
                  <img src={order.identityPhoto} alt="Identidade" style={{ maxWidth: '200px', borderRadius: '6px', border: '1px solid var(--admin-border)', cursor: 'pointer' }} onClick={() => window.open(order.identityPhoto, '_blank')} />
                </div>
              )}
              {order.addressProof && (
                <div>
                  <p style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.25rem' }}>Comprovante de Endereço</p>
                  <img src={order.addressProof} alt="Comprovante" style={{ maxWidth: '200px', borderRadius: '6px', border: '1px solid var(--admin-border)', cursor: 'pointer' }} onClick={() => window.open(order.addressProof, '_blank')} />
                </div>
              )}
            </div>
          )}

            {order.status === 'em-rota' && (
              <button className="admin-btn admin-btn-primary" onClick={() => { onClose(); setTimeout(() => onOpenDelivery?.(order), 100) }}>
                <i className="fa-solid fa-check"></i> Finalizar Pedido
              </button>
            )}
            <button className="admin-btn admin-btn-sec" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================
// MODAL: MONTAR KIT
// =============================================
function KitModal({ produtos, kit, onSave, onClose }) {
  const [nome, setNome] = useState(kit?.nome || '')
  const [descricao, setDescricao] = useState(kit?.descricao || '')
  const [prazoTexto, setPrazoTexto] = useState(kit?.prazoTexto || '')
  const [observacoes, setObservacoes] = useState(kit?.observacoes || '')
  const [selectedIds, setSelectedIds] = useState(new Set(kit?.produtoIds || []))
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return q ? produtos.filter(p => p.nome.toLowerCase().includes(q) || (p.categoria || '').toLowerCase().includes(q)) : produtos
  }, [produtos, search])

  const toggle = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal kit-modal" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h3><i className="fa-solid fa-toolbox"></i> {kit ? 'Editar Kit' : 'Montar Novo Kit'}</h3>
          <button className="admin-modal-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>
        <div className="kit-modal-body">
          <div className="kit-modal-fields">
            <div className="form-group">
              <label>Nome do Kit <span className="required-star">*</span></label>
              <input type="text" placeholder="Ex: Kit Dia das Mães" value={nome} onChange={e => setNome(e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label>Descrição</label>
              <textarea rows="2" placeholder="Uma descrição curta e atraente para o kit..." value={descricao} onChange={e => setDescricao(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Texto de Prazo / Pagamento</label>
              <textarea rows="3" placeholder="Explique as condições de pagamento (prazo, parcelamento, etc.)" value={prazoTexto} onChange={e => setPrazoTexto(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Observações (opcional)</label>
              <textarea rows="2" placeholder="Informações extras sobre o kit..." value={observacoes} onChange={e => setObservacoes(e.target.value)} />
            </div>
          </div>

          <div className="kit-modal-produtos">
            <div className="kit-modal-produtos-header">
              <label>Produtos no Kit <span className="selected-count">{selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}</span></label>
              <div className="admin-search-prod">
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="kit-produtos-lista">
              {filtered.map(p => (
                <label key={p.id} className={`kit-prod-item ${selectedIds.has(p.id) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="kit-prod-nome">{p.nome}</span>
                  <span className="kit-prod-cat">{p.categoria}</span>
                  <span className="kit-prod-preco">R$ {p.preco.toFixed(2).replace('.', ',')}</span>
                </label>
              ))}
              {filtered.length === 0 && <div className="kit-prod-empty">Nenhum produto encontrado</div>}
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="admin-btn admin-btn-sec" onClick={onClose}>Cancelar</button>
          <button className="admin-btn admin-btn-primary" disabled={!nome.trim() || selectedIds.size === 0}
            onClick={() => onSave({
              ...kit,
              nome: nome.trim(),
              descricao: descricao.trim(),
              prazoTexto: prazoTexto.trim(),
              observacoes: observacoes.trim(),
              produtoIds: [...selectedIds]
            })}>
            <i className="fa-solid fa-check"></i> {kit ? 'Atualizar Kit' : 'Criar Kit'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================
// MODAL: EDIT PRODUCT
// =============================================
function EditProductModal({ product, onSave, onClose }) {
  const [nome, setNome] = useState(product.nome)
  const [preco, setPreco] = useState(String(product.preco))
  const [estoque, setEstoque] = useState(String(product.estoque))
  const [imagem, setImagem] = useState(product.imagem || '')
  const [categoria, setCategoria] = useState(product.categoria)
  const [descricao, setDescricao] = useState(product.descricao || '')
  const [variantes, setVariantes] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('thsm_prod_variants') || '{}')
      return saved[product.id] || product.variantes || {}
    } catch { return product.variantes || {} }
  })
  const [newVarTypeName, setNewVarTypeName] = useState('')

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') setImagem(reader.result)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const addVariantType = () => {
    const name = newVarTypeName.trim()
    if (!name) return
    setVariantes(prev => ({ ...prev, [name]: [''] }))
    setNewVarTypeName('')
  }

  const removeVariantType = (key) => {
    if (!confirm(`Remover variação "${key}"?`)) return
    setVariantes(prev => {
      const { [key]: _, ...rest } = prev
      return rest
    })
  }

  const renameVariantType = (oldKey, newKey) => {
    const trimmed = newKey.trim()
    if (!trimmed || trimmed === oldKey) return
    if (variantes[trimmed]) return
    setVariantes(prev => {
      const { [oldKey]: val, ...rest } = prev
      return { ...rest, [trimmed]: val }
    })
  }

  const addVariantOption = (type) => {
    setVariantes(prev => ({
      ...prev,
      [type]: [...(prev[type] || []), '']
    }))
  }

  const updateVariantOption = (type, idx, value) => {
    setVariantes(prev => ({
      ...prev,
      [type]: (prev[type] || []).map((v, i) => i === idx ? value : v)
    }))
  }

  const removeVariantOption = (type, idx) => {
    setVariantes(prev => ({
      ...prev,
      [type]: (prev[type] || []).filter((_, i) => i !== idx)
    }))
  }

  const handleSave = () => {
    if (!nome.trim() || preco === '' || isNaN(Number(preco))) return
    const cleaned = {}
    Object.entries(variantes).forEach(([k, v]) => {
      const opts = v.filter(o => o.trim())
      if (opts.length > 0) cleaned[k] = opts
    })
    try {
      const all = JSON.parse(localStorage.getItem('thsm_prod_variants') || '{}')
      if (Object.keys(cleaned).length > 0) all[product.id] = cleaned
      else delete all[product.id]
      localStorage.setItem('thsm_prod_variants', JSON.stringify(all))
    } catch {}
    onSave({ nome: nome.trim(), preco: Number(preco), estoque: Number(estoque), imagem, categoria, descricao, variantes: cleaned })
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
        <div className="admin-modal-header">
          <h3><i className="fa-solid fa-pen"></i> {product._new ? 'Novo Produto' : 'Editar Produto'}</h3>
          <button className="admin-modal-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>
        <div className="admin-modal-body">
          <div className="form-group">
            <label>Nome do produto <span style={{color:'var(--danger)'}}>*</span></label>
            <input type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Camiseta Masculina" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Preço (R$) <span style={{color:'var(--danger)'}}>*</span></label>
              <input type="number" step="0.01" min="0" value={preco} onChange={e => setPreco(e.target.value)} placeholder="0,00" />
            </div>
            <div className="form-group">
              <label>Estoque</label>
              <input type="number" step="1" value={estoque} onChange={e => setEstoque(e.target.value)} placeholder="0" />
            </div>
          </div>

          <div className="form-group">
            <label>Imagem do Produto</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label className="admin-btn" style={{ cursor: 'pointer', fontSize: '0.78rem', padding: '0.35rem 0.75rem', background: '#f0f0f0', border: '1px solid var(--admin-border)', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <i className="fa-solid fa-upload"></i> Upload
                <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
              </label>
              <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>ou URL:</span>
            </div>
            <input type="text" value={imagem} onChange={e => setImagem(e.target.value)} placeholder="https://...png" />
            {imagem && (
              <div style={{ position: 'relative', display: 'inline-block', marginTop: '0.4rem' }}>
                <img src={imagem} alt="" className="edit-preview" onError={e => e.target.style.display = 'none'} />
                <button className="action-btn action-delete" style={{ position: 'absolute', top: '-6px', right: '-6px', width: '20px', height: '20px', borderRadius: '50%', fontSize: '0.65rem', display: imagem ? 'flex' : 'none' }} onClick={() => setImagem('')}>
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Categoria</label>
            <input type="text" value={categoria} onChange={e => setCategoria(e.target.value)} placeholder="Ex: Masculino, Feminino, Acessórios" />
          </div>
          <div className="form-group">
            <label>Descrição</label>
            <textarea rows="3" value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descrição detalhada do produto..." style={{ width: '100%', padding: '0.5rem 0.65rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          <div className="form-group" style={{ borderTop: '1px solid var(--admin-border)', paddingTop: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
              <label style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>
                <i className="fa-solid fa-tags" style={{ color: '#8b5cf6' }}></i> Variações do Produto
              </label>
            </div>

            {Object.keys(variantes).length > 0 && (
              <div style={{ marginBottom: '0.75rem' }}>
                {Object.entries(variantes).map(([type, options]) => (
                  <div key={type} style={{ marginBottom: '0.65rem', padding: '0.65rem 0.75rem', background: '#f9fafb', borderRadius: '10px', border: '1px solid var(--admin-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <input
                        type="text"
                        value={type}
                        onChange={e => {
                          const { [type]: val, ...rest } = variantes
                          const key = e.target.value.trim()
                          if (key) {
                            setVariantes({ ...rest, [key]: val })
                          } else {
                            setVariantes({ ...rest, [type]: val })
                          }
                        }}
                        style={{ fontWeight: 700, fontSize: '0.85rem', textTransform: 'uppercase', color: '#8b5cf6', border: '1px solid transparent', borderRadius: '4px', padding: '0.15rem 0.3rem', background: 'transparent', width: '140px' }}
                        onFocus={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.background = 'white' }}
                        onBlur={e => { e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent' }}
                      />
                      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--admin-text-sec)', background: '#e5e7eb', borderRadius: '10px', padding: '0.1rem 0.45rem' }}>{options.filter(o => o.trim()).length} opções</span>
                        <button className="action-btn" style={{ color: '#059669', width: '24px', height: '24px' }} title="Adicionar opção" onClick={() => addVariantOption(type)}>
                          <i className="fa-solid fa-plus"></i>
                        </button>
                        <button className="action-btn action-delete" style={{ width: '24px', height: '24px' }} title="Remover variação" onClick={() => removeVariantType(type)}>
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {options.map((opt, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.15rem', background: 'white', borderRadius: '8px', border: '1px solid var(--admin-border)', padding: '0.15rem 0.3rem 0.15rem 0.55rem' }}>
                          <input
                            type="text"
                            value={opt}
                            onChange={e => updateVariantOption(type, idx, e.target.value)}
                            placeholder={`Opção ${idx + 1}`}
                            style={{ width: '80px', padding: '0.25rem 0', border: 'none', fontSize: '0.82rem', background: 'transparent', outline: 'none' }}
                          />
                          {options.length > 1 && (
                            <button className="action-btn action-delete" style={{ padding: '0.1rem', width: '18px', height: '18px' }} title="Remover" onClick={() => removeVariantOption(type, idx)}>
                              <i className="fa-solid fa-xmark"></i>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              <input
                type="text"
                value={newVarTypeName}
                onChange={e => setNewVarTypeName(e.target.value)}
                placeholder="Ex: Cor, Tamanho, Aroma..."
                style={{ flex: 1, padding: '0.4rem 0.65rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.82rem' }}
                onKeyDown={e => { if (e.key === 'Enter') addVariantType() }}
              />
              <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.35rem 0.7rem', background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6', whiteSpace: 'nowrap' }} onClick={addVariantType} disabled={!newVarTypeName.trim()}>
                <i className="fa-solid fa-plus"></i> Adicionar
              </button>
            </div>
            {Object.keys(variantes).length === 0 && (
              <p style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', marginTop: '0.35rem' }}>
                Digite o nome da variação acima (Cor, Tamanho, etc.) e clique em "Adicionar".
              </p>
            )}
          </div>

          <div className="modal-actions">
            <button className="admin-btn admin-btn-sec" onClick={onClose}>Cancelar</button>
            <button className="admin-btn admin-btn-primary" disabled={!nome.trim() || preco === '' || isNaN(Number(preco))} onClick={handleSave}>
              <i className="fa-solid fa-check"></i> Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
