import { useState, useMemo, useEffect } from 'react'
import './Admin.css'

const STORAGE_ORDERS = 'thsm_admin_orders'
const STORAGE_PRODUCTS = 'thsm_admin_produtos'
const STORAGE_FINANCIAL = 'thsm_admin_financeiro'
const WEBHOOK_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook-test/novo-pedido'

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

import AddressForm from '../components/AddressForm'

export default function Admin({ produtos, onVoltar }) {
  const [tab, setTab] = useState('dashboard')
  const [orders, setOrders] = useState(() => LS.get(STORAGE_ORDERS, []))
  const [prodChanges, setProdChanges] = useState(() => LS.get(STORAGE_PRODUCTS, {}))
  const [financial, setFinancial] = useState(() => LS.get(STORAGE_FINANCIAL, []))
  const [toast, setToast] = useState(null)
  const [orderFilter, setOrderFilter] = useState('todos')
  const [prodSearch, setProdSearch] = useState('')
  const [prodPage, setProdPage] = useState(1)
  const [editingProd, setEditingProd] = useState(null)
  const [showAddOrder, setShowAddOrder] = useState(false)
  const [showOrderDetail, setShowOrderDetail] = useState(null)
  const [showDeliveryModal, setShowDeliveryModal] = useState(null)
  const [returnQuantities, setReturnQuantities] = useState({})
  const [finFilter, setFinFilter] = useState('todos')
  const [finEdit, setFinEdit] = useState(null)
  const [usuarios, setUsuarios] = useState(() => LS.get('thsm_usuarios', []))
  const [selectedUserEmail, setSelectedUserEmail] = useState(null)
  const [prodCatFilter, setProdCatFilter] = useState('TODOS')
  const [prodStockFilter, setProdStockFilter] = useState('todos')
  const [prodPriceRange, setProdPriceRange] = useState([0, 5000])
  const [prodSort, setProdSort] = useState({ field: 'nome', dir: 'asc' })
  const [prodSelectedIds, setProdSelectedIds] = useState(new Set())
  const [showBulkPrice, setShowBulkPrice] = useState(false)
  const [bulkPriceValue, setBulkPriceValue] = useState('')
  const [orderSearch, setOrderSearch] = useState('')
  const [orderSort, setOrderSort] = useState({ field: 'createdAt', dir: 'desc' })
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [orderDateStart, setOrderDateStart] = useState('')
  const [orderDateEnd, setOrderDateEnd] = useState('')
  const [orderCityFilter, setOrderCityFilter] = useState('TODAS')
  const PROD_PER_PAGE = 20

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  // Persist
  useEffect(() => { LS.set(STORAGE_ORDERS, orders) }, [orders])
  useEffect(() => { LS.set(STORAGE_PRODUCTS, prodChanges) }, [prodChanges])
  useEffect(() => { LS.set(STORAGE_FINANCIAL, financial) }, [financial])

  const produtosAtuais = useMemo(() => {
    return produtos.map(p => ({
      ...p,
      ...(prodChanges[p.id] || {})
    }))
  }, [produtos, prodChanges])

  // =============================================
  // ORDERS
  // =============================================
  const addOrder = (data) => {
    const items = data.items
    const totalAvista = items.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
    const totalAprazo = items.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
    const order = {
      id: Date.now(),
      date: hoje(),
      customer: { nome: data.nome, telefone: data.telefone, endereco: data.endereco || { cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' } },
      items,
      pagamento: data.pagamento,
      totalAvista,
      totalAprazo,
      total: totalAvista + totalAprazo,
      status: 'pendente',
      createdAt: Date.now()
    }
    setOrders(prev => [order, ...prev])

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
    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'novo-pedido',
        order: {
          id: order.id,
          date: order.date,
          status: order.status,
          pagamento: order.pagamento,
          total: order.total,
          totalAvista: order.totalAvista,
          totalAprazo: order.totalAprazo,
          customer: order.customer,
          items: order.items.map(i => ({ nome: i.nome, qty: i.qty, preco: i.preco, tipo: i.tipo }))
        }
      })
    }).catch(() => {})
  }

  const updateOrderStatus = (id, status) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o))
    if (status === 'entregue') {
      setFinancial(prev => prev.map(f => f.orderId === id && f.status !== 'pago' ? { ...f, status: 'pago', paidDate: hoje() } : f))
    }
    showToast(`Pedido #${id} atualizado para "${status}"`)
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
    setOrders(prev => prev.map(o => o.id === orderId ? {
      ...o,
      items: remainingItems,
      totalAvista,
      totalAprazo,
      total: totalAvista + totalAprazo,
      status: 'em-andamento',
      preApprovedAt: now,
      rejectedItems: rejectedItemIds.length > 0 ? rejectedItemIds.map(idx => order.items[idx]) : []
    } : o))
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
    showToast(`Pedido #${orderId} pré-aprovado como "Em Andamento"`)
    setShowOrderDetail(null)
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
    setOrders(prev => prev.map(o => o.id === orderId ? {
      ...o,
      items: adjustedItems,
      totalAvista,
      totalAprazo,
      total: totalAvista + totalAprazo,
      status: 'entregue',
      returnedItems
    } : o))
    // Update financial: delivered items marked paid, returned items removed
    setFinancial(prev => prev.map(f => {
      if (f.orderId !== orderId) return f
      const item = order.items.find(i => f.id === orderId + '-' + i.id)
      if (!item) return f
      const returnedQty = returnQuantities[item.id] || 0
      if (returnedQty >= item.qty) {
        return { ...f, status: 'cancelado', paidDate: hoje() }
      }
      const remainingQty = item.qty - returnedQty
      return { ...f, qty: remainingQty, value: item.preco * remainingQty, status: 'pago', paidDate: hoje() }
    }))
    showToast(`Pedido #${orderId} finalizado com devolução`)
    setShowDeliveryModal(null)
    setReturnQuantities({})
  }

  const deleteOrder = (id) => {
    if (!confirm('Excluir este pedido?')) return
    setOrders(prev => prev.filter(o => o.id !== id))
    setFinancial(prev => prev.filter(f => f.orderId !== id))
    showToast('Pedido excluído')
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

  const filteredOrders = useMemo(() => {
    let result = orders
    if (orderFilter !== 'todos') result = result.filter(o => o.status === orderFilter)
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

  const toggleSort = (field) => {
    setOrderSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' })
  }

  const sortIcon = (field) => {
    if (orderSort.field !== field) return <i className="fa-solid fa-sort" style={{ opacity: 0.3, marginLeft: 3, fontSize: '0.65rem' }}></i>
    return <i className={`fa-solid fa-sort-${orderSort.dir === 'asc' ? 'up' : 'down'}`} style={{ marginLeft: 3, fontSize: '0.65rem' }}></i>
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredOrders.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filteredOrders.map(o => o.id)))
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
      if (action === 'confirm') updateOrderStatus(id, 'confirmado')
      else if (action === 'delete') {
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
    window.open(`https://wa.me/5531998461300?text=${encodeURIComponent(msg)}`, '_blank')
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

  // =============================================
  // PRODUCTS
  // =============================================
  const updateProduct = (id, changes) => {
    setProdChanges(prev => ({
      ...prev,
      [id]: { ...(prev[id] || {}), ...changes }
    }))
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
    if (prodSelectedIds.size === paginatedProds.length) setProdSelectedIds(new Set())
    else setProdSelectedIds(new Set(paginatedProds.map(p => p.id)))
  }

  const toggleProdSelect = (id) => {
    setProdSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
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
  const sidebar = [
    { id: 'dashboard', icon: 'fa-chart-pie', label: 'Dashboard' },
    { id: 'pedidos', icon: 'fa-clipboard-list', label: 'Pedidos', count: stats.prePedidos + stats.pendentes },
    { id: 'produtos', icon: 'fa-boxes', label: 'Produtos' },
    { id: 'financeiro', icon: 'fa-coins', label: 'Financeiro', count: financial.filter(f => f.status === 'pendente').length },
    { id: 'usuarios', icon: 'fa-users', label: 'Usuários', count: usuarios.length },
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
          <i className="fa-solid fa-crown"></i>
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
                { id: 'confirmado', label: 'Confirmados', count: orders.filter(o => o.status === 'confirmado').length },
                { id: 'em-andamento', label: 'Em Andamento', count: orders.filter(o => o.status === 'em-andamento').length },
                { id: 'em-rota', label: 'Em Rota', count: orders.filter(o => o.status === 'em-rota').length },
                { id: 'entregue', label: 'Entregues', count: orders.filter(o => o.status === 'entregue').length },
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
                      <input type="checkbox" checked={filteredOrders.length > 0 && selectedIds.size === filteredOrders.length} onChange={toggleSelectAll} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
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
                  {filteredOrders.map(o => (
                    <tr key={o.id} className={selectedIds.has(o.id) ? 'row-selected' : ''}>
                      <td>
                        <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                      </td>
                      <td style={{ fontWeight: 600 }}>{o.customer.nome}</td>
                      <td>{o.customer.telefone}</td>
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
                          {o.status === 'pre-pedido' && <button className="action-btn" style={{ color: '#8b5cf6', borderColor: '#8b5cf6' }} title="Revisar e pré-aprovar" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-clipboard-check"></i></button>}
                          {o.status === 'pendente' && <button className="action-btn action-confirm" title="Editar/Confirmar" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-pen"></i></button>}
                          {o.status === 'confirmado' && <button className="action-btn action-deliver" title="Em Rota" onClick={() => updateOrderStatus(o.id, 'em-rota')}><i className="fa-solid fa-truck"></i></button>}
                          {o.status === 'em-rota' && <button className="action-btn action-confirm" title="Entregue" onClick={() => updateOrderStatus(o.id, 'entregue')}><i className="fa-solid fa-check"></i></button>}
                          {o.status === 'em-andamento' && (
                            <button className="action-btn action-deliver" title="Em Rota" onClick={() => updateOrderStatus(o.id, 'em-rota')}><i className="fa-solid fa-truck"></i></button>
                          )}
                          {o.status === 'em-rota' && (
                            <button className="action-btn" title="Finalizar com devolução" onClick={() => { setShowDeliveryModal(o); setReturnQuantities({}) }}><i className="fa-solid fa-rotate-left"></i></button>
                          )}
                          <button className="action-btn action-delete" title="Excluir" onClick={() => deleteOrder(o.id)}><i className="fa-solid fa-trash"></i></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredOrders.length === 0 && <tr><td colSpan="11" className="td-empty">Nenhum pedido encontrado</td></tr>}
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

            </div>

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
                <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={() => setProdSelectedIds(new Set())}>
                  <i className="fa-solid fa-xmark"></i> Limpar
                </button>
              </div>
            )}

            <div className="admin-table-wrap">
              <table className="admin-table table-prod">
                <thead>
                  <tr>
                    <th style={{ width: '36px' }}>
                      <input type="checkbox" checked={paginatedProds.length > 0 && prodSelectedIds.size === paginatedProds.length} onChange={toggleProdSelectAll} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
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
          </div>
        )}

        {/* FINANCEIRO */}
        {/* USUÁRIOS */}
        {tab === 'usuarios' && (
          <div className="admin-section">
            <h1>Usuários</h1>
            <p className="admin-subtitle">{usuarios.length} usuários cadastrados</p>

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

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Email</th>
                    <th>Telefone</th>
                    <th>Cadastro</th>
                    <th>Pedidos</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {usuarios.map(u => {
                    const userOrders = orders.filter(o => o.customer?.email === u.email)
                    const totalGasto = userOrders.reduce((s, o) => s + o.total, 0)
                    return (
                      <tr key={u.id}>
                        <td style={{ fontWeight: 600 }}>{u.nome}</td>
                        <td>{u.email}</td>
                        <td>{u.telefone}</td>
                        <td>{formatDate(u.createdAt ? new Date(u.createdAt).toISOString().split('T')[0] : '')}</td>
                        <td>
                          <span className="cat-tag">{userOrders.length} pedidos</span>
                          {userOrders.length > 0 && (
                            <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>
                              {formatPreco(totalGasto)}
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="td-actions">
                            <button className="action-btn" title="Ver pedidos do usuário" onClick={() => { setSelectedUserEmail(u.email); setTab('pedidos') }}>
                              <i className="fa-solid fa-clipboard-list"></i>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {usuarios.length === 0 && <tr><td colSpan="6" className="td-empty">Nenhum usuário cadastrado</td></tr>}
                </tbody>
              </table>
            </div>
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
          onSave={addOrder}
          onClose={() => setShowAddOrder(false)}
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
          onEditAndConfirm={(editedItems) => {
            const totalAvista = editedItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
            const totalAprazo = editedItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
            setOrders(prev => prev.map(o => o.id === showOrderDetail.id ? {
              ...o,
              items: editedItems,
              totalAvista,
              totalAprazo,
              total: totalAvista + totalAprazo,
              status: 'confirmado'
            } : o))
            showToast(`Pedido #${showOrderDetail.id} atualizado e confirmado!`)
            setShowOrderDetail(null)
          }}
        />
      )}

      {/* MODAL DELIVERY (RETURN RECORDING) */}
      {showDeliveryModal && (
        <div className="admin-overlay" onClick={() => setShowDeliveryModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-rotate-left"></i> Registrar Devolução</h3>
              <button className="admin-modal-close" onClick={() => setShowDeliveryModal(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ fontSize: '0.85rem', color: 'var(--admin-text-sec)', marginBottom: '1rem' }}>
                Informe a quantidade de itens <strong>devolvidos</strong> (não vendidos). Apenas os itens vendidos serão cobrados.
              </p>
              {showDeliveryModal.items.map((i, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0', borderBottom: '1px solid var(--admin-border)' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500 }}>{i.nome}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>
                      {i.qty}x {formatPreco(i.preco)} — tipo: {i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem' }}>
                    <span style={{ color: 'var(--admin-text-sec)' }}>Devolver:</span>
                    <input type="number" min="0" max={i.qty} step="1" value={returnQuantities[i.id] || ''}
                      placeholder="0"
                      onChange={e => setReturnQuantities(prev => {
                        const val = e.target.value === '' ? '' : Math.min(Number(e.target.value), i.qty)
                        return { ...prev, [i.id]: val }
                      })}
                      style={{ width: '55px', padding: '0.3rem 0.4rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', textAlign: 'center' }}
                    />
                  </div>
                </div>
              ))}
              <div className="modal-actions" style={{ marginTop: '1rem' }}>
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

      {/* MODAL EDIT PRODUCT */}
      {editingProd && (
        <EditProductModal
          product={editingProd}
          onSave={(changes) => updateProduct(editingProd.id, changes)}
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
function AddOrderModal({ produtos, onSave, onClose }) {
  const [step, setStep] = useState(1)
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [endereco, setEndereco] = useState({ cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' })
  const [pagamento, setPagamento] = useState('avista')
  const [diasPrazo, setDiasPrazo] = useState(30)
  const [cart, setCart] = useState({})
  const [search, setSearch] = useState('')
  const [prodPage, setProdPage] = useState(1)

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
    setCart(prev => ({ ...prev, [p.id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, qty: (prev[p.id]?.qty || 0) + 1, tipo: 'avista' } }))
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

  const handleSave = () => {
    if (cartItems.length === 0 || !nome.trim() || !telefone.trim()) return
    onSave({
      nome: nome.trim(),
      telefone: telefone.trim(),
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
              <div className="form-group">
                <label>Nome do cliente *</label>
                <input type="text" placeholder="Nome completo" value={nome} onChange={e => setNome(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Telefone / WhatsApp *</label>
                <input type="text" placeholder="(31) 99999-9999" value={telefone} onChange={e => setTelefone(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Endereço</label>
                <AddressForm value={endereco} onChange={(a) => setEndereco(a)} />
              </div>
              <button className="admin-btn admin-btn-primary" disabled={!nome.trim() || !telefone.trim()} onClick={() => setStep(2)}>
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
function OrderDetailModal({ order, financial, produtos, onClose, onStatusChange, onPreApprovar, onEditAndConfirm }) {
  const [rejectedItems, setRejectedItems] = useState(new Set())
  const [editMode, setEditMode] = useState(false)
  const [editedItems, setEditedItems] = useState(order.items.map(i => ({ ...i })))
  const [addSearch, setAddSearch] = useState('')
  const [addCart, setAddCart] = useState({})
  const [preAddSearch, setPreAddSearch] = useState('')
  const [preAddCart, setPreAddCart] = useState({})
  const [preReplacements, setPreReplacements] = useState([])

  const toggleReject = (idx) => {
    setRejectedItems(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  const diasEmAndamento = order.preApprovedAt
    ? Math.floor((Date.now() - order.preApprovedAt) / (1000 * 60 * 60 * 24))
    : 0
  const podeFinalizar = diasEmAndamento >= 60

  const changeQty = (idx, delta) => {
    setEditedItems(prev => prev.map((item, i) => i === idx ? { ...item, qty: Math.max(0, item.qty + delta) } : item))
  }

  const removeItem = (idx) => {
    setEditedItems(prev => prev.filter((_, i) => i !== idx))
  }

  const addItemToEdit = (p) => {
    setAddCart(prev => ({
      ...prev,
      [p.id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, tipo: 'avista', qty: (prev[p.id]?.qty || 0) + 1 }
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
    onEditAndConfirm(validItems)
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
                    <span className="detail-item-qty">{formatPreco(i.preco)}</span>
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
                <i className="fa-solid fa-check"></i> Salvar e Confirmar Pedido
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
            <h4>Cliente</h4>
            <p><strong>Nome:</strong> {order.customer.nome}</p>
            <p><strong>Telefone:</strong> {order.customer.telefone}</p>
            {order.customer.endereco?.cidade && <p><strong>Endereço:</strong> {[order.customer.endereco.rua, order.customer.endereco.numero, order.customer.endereco.bairro, order.customer.endereco.cidade, order.customer.endereco.estado].filter(Boolean).join(', ')}</p>}
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

          {order.status === 'em-andamento' && (
            <div className="detail-section">
              <h4><i className="fa-solid fa-clock"></i> Andamento</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div style={{ flex: 1, height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, (diasEmAndamento / 60) * 100)}%`, height: '100%', background: podeFinalizar ? 'var(--success)' : '#8b5cf6', borderRadius: '4px', transition: 'width 0.3s' }}></div>
                </div>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: podeFinalizar ? 'var(--success)' : '#8b5cf6', whiteSpace: 'nowrap' }}>
                  {diasEmAndamento}d / 60d
                </span>
              </div>
              {!podeFinalizar && (
                <p style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', marginTop: '0.4rem' }}>
                  <i className="fa-solid fa-info-circle"></i> Aguarde {60 - diasEmAndamento} dias para finalizar
                </p>
              )}
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
                onClick={() => setEditMode(true)}>
                <i className="fa-solid fa-pen"></i> Editar Itens
              </button>
            )}
            {order.status === 'pre-pedido' && (
              <button className="admin-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6' }}
                onClick={() => onPreApprovar([...rejectedItems], preReplacements)}>
                <i className="fa-solid fa-clipboard-check"></i> Pré-aprovar
              </button>
            )}
            {order.status === 'pendente' && (
              <button className="admin-btn admin-btn-primary" onClick={() => onStatusChange('confirmado')}>
                <i className="fa-solid fa-check"></i> Confirmar (sem alterações)
              </button>
            )}
            {order.status === 'confirmado' && (
              <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} onClick={() => onStatusChange('em-rota')}>
                <i className="fa-solid fa-truck"></i> Em Rota
              </button>
            )}
            {order.status === 'em-rota' && (
              <button className="admin-btn admin-btn-primary" onClick={() => onStatusChange('entregue')}>
                <i className="fa-solid fa-check"></i> Marcar como Entregue
              </button>
            )}
            {order.status === 'em-andamento' && podeFinalizar && (
              <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} onClick={() => onStatusChange('em-rota')}>
                <i className="fa-solid fa-truck"></i> Em Rota
              </button>
            )}
            {order.status === 'em-rota' && (
              <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} onClick={onClose}>
                <i className="fa-solid fa-rotate-left"></i> Registrar Devolução
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
// MODAL: EDIT PRODUCT
// =============================================
function EditProductModal({ product, onSave, onClose }) {
  const [nome, setNome] = useState(product.nome)
  const [preco, setPreco] = useState(String(product.preco))
  const [estoque, setEstoque] = useState(String(product.estoque))
  const [imagem, setImagem] = useState(product.imagem || '')
  const [categoria, setCategoria] = useState(product.categoria)

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px' }}>
        <div className="admin-modal-header">
          <h3><i className="fa-solid fa-pen"></i> Editar Produto</h3>
          <button className="admin-modal-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>
        <div className="admin-modal-body">
          <div className="form-group">
            <label>Nome do produto</label>
            <input type="text" value={nome} onChange={e => setNome(e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Preço (R$)</label>
              <input type="number" step="0.01" min="0" value={preco} onChange={e => setPreco(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Estoque</label>
              <input type="number" step="1" value={estoque} onChange={e => setEstoque(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>URL da Imagem</label>
            <input type="text" value={imagem} onChange={e => setImagem(e.target.value)} />
            {imagem && <img src={imagem} alt="" className="edit-preview" onError={e => e.target.style.display = 'none'} />}
          </div>
          <div className="form-group">
            <label>Categoria</label>
            <input type="text" value={categoria} onChange={e => setCategoria(e.target.value)} />
          </div>
          <div className="modal-actions">
            <button className="admin-btn admin-btn-sec" onClick={onClose}>Cancelar</button>
            <button className="admin-btn admin-btn-primary" onClick={() => onSave({ nome, preco: Number(preco), estoque: Number(estoque), imagem, categoria })}>
              <i className="fa-solid fa-check"></i> Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
