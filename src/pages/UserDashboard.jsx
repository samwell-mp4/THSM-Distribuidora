import { useState, useMemo, useEffect } from 'react'
import { supabase, upsertOrder, upsertFinancial, deleteOrder as supabaseDeleteOrder, upsertUser } from '../lib/supabase'
import AddressForm from '../components/AddressForm'

const LS_ORDERS = 'thsm_admin_orders'
const LS_FINANCIAL = 'thsm_admin_financeiro'
const LS_SESSAO = 'thsm_sessao'

function formatPreco(v) {
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`
}

function formatDate(str) {
  if (!str) return '-'
  const d = new Date(str + (str.length <= 10 ? 'T12:00:00' : ''))
  return d.toLocaleDateString('pt-BR')
}

function diffDays(a, b) {
  return Math.floor((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / (1000 * 60 * 60 * 24))
}

function hoje() {
  return new Date().toISOString().split('T')[0]
}

function getLS(key) {
  try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : [] } catch { return [] }
}

function setLS(key, data) {
  localStorage.setItem(key, JSON.stringify(data))
}

export default function UserDashboard({ produtos = [], onVoltar, initialOrderId }) {
  const [tab, setTab] = useState(() => sessionStorage.getItem('thsm_user_tab') || 'pedidos')
  useEffect(() => { sessionStorage.setItem('thsm_user_tab', tab) }, [tab])
  const [finFilter, setFinFilter] = useState('todas')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [showPayment, setShowPayment] = useState(null)
  const [paymentStep, setPaymentStep] = useState('review')
  const [processing, setProcessing] = useState(false)
  const [prodSearch, setProdSearch] = useState('')
  const [showComanda, setShowComanda] = useState(null)
  const [prodCategoria, setProdCategoria] = useState('TODOS')
  const [orderSearch, setOrderSearch] = useState('')
  const [orderDateStart, setOrderDateStart] = useState('')
  const [orderDateEnd, setOrderDateEnd] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [editPreOrder, setEditPreOrder] = useState(false)
  const [editedPreItems, setEditedPreItems] = useState([])
  const [preAddSearch, setPreAddSearch] = useState('')
  const [preAddCart, setPreAddCart] = useState({})
  const [showUserDelivery, setShowUserDelivery] = useState(null)
  const [userReturnQtys, setUserReturnQtys] = useState({})
  const [userPayQtys, setUserPayQtys] = useState({})
  const [identityPreview, setIdentityPreview] = useState('')
  const [addressPreview, setAddressPreview] = useState('')
  const [finalizing, setFinalizing] = useState(false)
  const [editNome, setEditNome] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editTelefone, setEditTelefone] = useState('')
  const [editSenha, setEditSenha] = useState('')
  const [editEndereco, setEditEndereco] = useState({ cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' })
  const [savingProfile, setSavingProfile] = useState(false)

  const initConta = () => {
    setTab('conta')
    if (!currentUser) return
    setEditNome(currentUser.nome || '')
    setEditEmail(currentUser.email || '')
    setEditTelefone(currentUser.telefone || '')
    setEditSenha(currentUser.endereco?.senha || '')
    setEditEndereco({
      cep: currentUser.endereco?.cep || '',
      estado: currentUser.endereco?.estado || '',
      cidade: currentUser.endereco?.cidade || '',
      bairro: currentUser.endereco?.bairro || '',
      rua: currentUser.endereco?.rua || '',
      numero: currentUser.endereco?.numero || '',
      complemento: currentUser.endereco?.complemento || ''
    })
  }

  const saveProfile = async () => {
    if (!editNome.trim()) { alert('Nome é obrigatorio'); return }
    setSavingProfile(true)
    const updated = {
      ...currentUser,
      id: currentUser.id,
      nome: editNome.trim(),
      email: editEmail.trim(),
      telefone: editTelefone.replace(/\D/g, ''),
      endereco: { ...(currentUser.endereco || {}), ...editEndereco, senha: editSenha || currentUser.endereco?.senha || '' }
    }
    await upsertUser(updated)
    localStorage.setItem(LS_SESSAO, JSON.stringify(updated))
    setSavingProfile(false)
    alert('Dados salvos com sucesso!')
  }

  useEffect(() => {
    if (initialOrderId) {
      const order = allOrders.find(o => o.id === initialOrderId)
      if (order && currentUser && (order.userId === currentUser.id || order.customer?.email === currentUser.email || order.customer?.telefone === currentUser.telefone)) {
        setSelectedOrder(order)
      }
    }
  }, [initialOrderId])

  const currentUser = useMemo(() => {
    try { const d = localStorage.getItem(LS_SESSAO); return d ? JSON.parse(d) : null } catch { return null }
  }, [])

  const [allOrders, setAllOrders] = useState(() => getLS(LS_ORDERS))
  const [financial, setFinancial] = useState(() => getLS(LS_FINANCIAL))

  useEffect(() => {
    if (!currentUser?.telefone) return
    supabase.from('usuarios').select('id').eq('telefone', currentUser.telefone).single().then(({ data: user }) => {
      if (!user) return
      supabase.from('pedidos').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).then(({ data }) => {
        if (data?.length) {
          const orders = data.map(r => r.data || r)
          setAllOrders(orders)
          setLS(LS_ORDERS, orders)
        }
      })
    }).catch(() => {})
  }, [currentUser?.telefone])

  const userOrders = useMemo(() => {
    if (!currentUser) return []
    return allOrders
      .filter(o => o.userId === currentUser.id || o.customer?.email === currentUser.email)
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [allOrders, currentUser])

  const userFinancial = useMemo(() => {
    if (!currentUser) return []
    const orderIds = new Set(userOrders.map(o => o.id))
    return financial.filter(f => orderIds.has(f.orderId))
  }, [financial, userOrders])

  const pendentes = userFinancial.filter(f => f.status === 'pendente')
  const pendentesTotal = pendentes.reduce((s, f) => s + f.value, 0)
  const atrasados = pendentes.filter(f => diffDays(f.dueDate, hoje()) > 0)
  const atrasadosTotal = atrasados.reduce((s, f) => s + f.value, 0)

  const deleteOrder = (id) => {
    if (!confirm('Excluir este pedido?')) return
    const updated = allOrders.filter(o => o.id !== id)
    setAllOrders(updated)
    setLS(LS_ORDERS, updated)
    supabaseDeleteOrder(id)
  }

  const openPayment = (f) => {
    setShowPayment(f)
    setPaymentStep('review')
  }

  const processPayment = () => {
    setProcessing(true)
    setTimeout(() => {
      setPaymentStep('success')
      setProcessing(false)
      const updated = financial.map(f => f.id === showPayment.id ? { ...f, status: 'pago', paidDate: hoje() } : f)
      setFinancial(updated)
      setLS(LS_FINANCIAL, updated)
    }, 2000)
  }

  const closePayment = () => {
    setShowPayment(null)
    setPaymentStep('review')
  }

  const savePrePedidoEdits = (editedItems) => {
    if (!selectedOrder) return
    const totalAvista = editedItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
    const totalAprazo = editedItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
    const updated = allOrders.map(o => o.id === selectedOrder.id ? {
      ...o,
      items: editedItems,
      totalAvista,
      totalAprazo,
      total: totalAvista + totalAprazo,
    } : o)
    setAllOrders(updated)
    setLS(LS_ORDERS, updated)
    setSelectedOrder(prev => ({ ...prev, items: editedItems, totalAvista, totalAprazo, total: totalAvista + totalAprazo }))
    upsertOrder({ ...selectedOrder, items: editedItems, totalAvista, totalAprazo, total: totalAvista + totalAprazo })
    setEditPreOrder(false)
  }

  const finalizarUserEntrega = () => {
    if (!showUserDelivery) return
    setFinalizing(true)
    const order = showUserDelivery
    const returnedItems = []
    const remainingItems = order.items.filter(i => {
      const qty = userReturnQtys[i.id] || 0
      if (qty > 0) returnedItems.push({ ...i, returnedQty: Math.min(qty, i.qty) })
      return (i.qty - qty) > 0
    })
    const adjustedItems = remainingItems.map(i => {
      const qty = userReturnQtys[i.id] || 0
      return { ...i, qty: i.qty - qty }
    })
    const totalAvista = adjustedItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
    const totalAprazo = adjustedItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
    const updatedOrders = allOrders.map(o => o.id === order.id ? {
      ...o,
      items: adjustedItems,
      totalAvista,
      totalAprazo,
      total: totalAvista + totalAprazo,
      status: 'entregue',
      returnedItems,
      identityPhoto: identityPreview || o.identityPhoto || '',
      addressProof: addressPreview || o.addressProof || '',
      deliveredAt: Date.now()
    } : o)
    const updatedFinancial = financial.map(f => {
      if (f.orderId !== order.id) return f
      const item = order.items.find(i => f.id === order.id + '-' + i.id)
      if (!item) return f
      const returnedQty = userReturnQtys[item.id] || 0
      if (returnedQty >= item.qty) return { ...f, status: 'cancelado', paidDate: hoje() }
      const remainingQty = item.qty - returnedQty
      return { ...f, qty: remainingQty, value: item.preco * remainingQty, status: 'pago', paidDate: hoje() }
    })
    setAllOrders(updatedOrders)
    setLS(LS_ORDERS, updatedOrders)
    setFinancial(updatedFinancial)
    setLS(LS_FINANCIAL, updatedFinancial)
    upsertOrder(updatedOrders.find(o => o.id === showUserDelivery.id))
    upsertFinancial(updatedFinancial)
    setTimeout(() => {
      setFinalizing(false)
      setShowUserDelivery(null)
      setUserReturnQtys({})
      setUserPayQtys({})
      setIdentityPreview('')
      setAddressPreview('')
      setSelectedOrder(null)
    }, 1500)
  }

  const handleFile = (e, type) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      if (type === 'identity') setIdentityPreview(ev.target.result)
      else setAddressPreview(ev.target.result)
    }
    reader.readAsDataURL(file)
  }

  const filteredPreAddProds = useMemo(() => {
    const t = preAddSearch.toLowerCase().trim()
    if (!t) return []
    return produtos.filter(p => p.nome?.toLowerCase().includes(t)).slice(0, 10)
  }, [produtos, preAddSearch])

  const addToPreCart = (p) => {
    setPreAddCart(prev => ({
      ...prev,
      [p.id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, tipo: 'avista', qty: (prev[p.id]?.qty || 0) + 1 }
    }))
  }

  const removeFromPreCart = (id) => {
    setPreAddCart(prev => {
      if (!prev[id] || prev[id].qty <= 1) {
        const { [id]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [id]: { ...prev[id], qty: prev[id].qty - 1 } }
    })
  }

  const confirmPreAdd = () => {
    const newItems = Object.values(preAddCart).filter(i => i.qty > 0)
    if (newItems.length === 0) return
    setEditedPreItems(prev => [...prev, ...newItems])
    setPreAddCart({})
    setPreAddSearch('')
  }

  const changeQty = (idx, delta) => {
    setEditedPreItems(prev => prev.map((item, i) => i === idx ? { ...item, qty: Math.max(0, item.qty + delta) } : item))
  }

  const removeEditedItem = (idx) => {
    setEditedPreItems(prev => prev.filter((_, i) => i !== idx))
  }

  function generatePixCode() {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    let code = '00020126580014BR.GOV.BCB.PIX0136'
    for (let i = 0; i < 32; i++) code += chars.charAt(Math.floor(Math.random() * chars.length))
    code += '52040000530398654'
    code += String(showPayment?.value?.toFixed(2).replace('.', '') || '000').padStart(10, '0')
    code += '5802BR5925THSM Distribuidora6009SAO PAULO62070503***6304FFFF'
    return code
  }

  return (
    <div className="admin">
      <aside className="admin-sidebar">
        <div className="admin-logo">
          <img src="/thsmdistribuidora.webp" alt="THSM" style={{ width: '28px', height: '28px', objectFit: 'contain', borderRadius: '4px' }} />
          <div>
            <strong>THSM Distribuidora</strong>
            <span>Cliente</span>
          </div>
        </div>
        <nav className="admin-nav">
          <button className={`admin-nav-item ${tab === 'produtos' ? 'active' : ''}`} onClick={() => setTab('produtos')}>
            <i className="fa-solid fa-box"></i> <span>Produtos</span>
          </button>
          <button className={`admin-nav-item ${tab === 'pedidos' ? 'active' : ''}`} onClick={() => setTab('pedidos')}>
            <i className="fa-solid fa-clipboard-list"></i> <span>Meus Pedidos</span>
          </button>
          <button className={`admin-nav-item ${tab === 'financeiro' ? 'active' : ''}`} onClick={() => setTab('financeiro')}>
            <i className="fa-solid fa-coins"></i> <span>Financeiro</span>
            {pendentes.length > 0 && <span className="admin-badge">{pendentes.length}</span>}
          </button>
          <button className={`admin-nav-item ${tab === 'conta' ? 'active' : ''}`} onClick={initConta}>
            <i className="fa-solid fa-user-gear"></i> <span>Minha Conta</span>
          </button>
        </nav>
        <div className="admin-sidebar-footer">
          <div className="admin-user-card">
            <div className="admin-user-avatar">{currentUser?.nome?.charAt(0)?.toUpperCase() || 'U'}</div>
            <div className="admin-user-info">
              <div className="admin-user-name">{currentUser?.nome || 'Usuário'}</div>
              <div className="admin-user-email">{currentUser?.email || ''}</div>
            </div>
            <button onClick={onVoltar} className="admin-user-back" title="Voltar ao Catálogo">
              <i className="fa-solid fa-arrow-left"></i>
            </button>
          </div>
        </div>
      </aside>

      <main className="admin-content">
        {tab === 'produtos' && (
          <div className="admin-section">
            <div className="admin-header-row">
              <div>
                <h1>Produtos</h1>
                <p className="admin-subtitle">Catálogo de produtos</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
                <i className="fa-solid fa-magnifying-glass"></i>
                <input type="text" placeholder="Buscar produto..." value={prodSearch} onChange={e => setProdSearch(e.target.value)} />
                {prodSearch && <button className="search-clear" onClick={() => setProdSearch('')}><i className="fa-solid fa-xmark"></i></button>}
              </div>
              <select value={prodCategoria} onChange={e => setProdCategoria(e.target.value)} style={{ padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--admin-border)', fontSize: '0.82rem', background: 'white' }}>
                <option value="TODOS">Todas as categorias</option>
                {[...new Set(produtos.filter(p => p.categoria).map(p => p.categoria))].sort().map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            {(() => {
              const filtered = produtos.filter(p => {
                if (prodCategoria !== 'TODOS' && p.categoria !== prodCategoria) return false
                if (prodSearch) {
                  const q = prodSearch.toLowerCase()
                  return p.nome?.toLowerCase().includes(q) || p.categoria?.toLowerCase().includes(q)
                }
                return true
              })
              return filtered.length === 0 ? (
                <div className="empty">
                  <i className="fa-solid fa-box-open"></i>
                  <h3>Nenhum produto encontrado</h3>
                </div>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Produto</th>
                        <th>Categoria</th>
                        <th>Preço</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p, idx) => (
                        <tr key={p.id || idx}>
                          <td className="td-prod-name" data-label="Produto">{p.nome}</td>
                          <td data-label="Categoria">{p.categoria || '-'}</td>
                          <td className="td-price" data-label="Preço">{formatPreco(p.preco)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        )}

        {tab === 'pedidos' && (
          <div className="admin-section">
            <div className="admin-header-row">
              <div>
                <h1>Meus Pedidos</h1>
                <p className="admin-subtitle">Acompanhe todos os seus pedidos</p>
              </div>
            </div>
            <div className="admin-cards">
              <div className="admin-card card-blue">
                <i className="fa-solid fa-shopping-bag"></i>
                <div>
                  <strong>{userOrders.length}</strong>
                  <span>Total de Pedidos</span>
                </div>
              </div>
              <div className="admin-card card-yellow">
                <i className="fa-solid fa-hourglass-half"></i>
                <div>
                  <strong>{userOrders.filter(o => o.status === 'pendente').length}</strong>
                  <span>Pendentes</span>
                </div>
              </div>
              <div className="admin-card card-green">
                <i className="fa-solid fa-check-circle"></i>
                <div>
                  <strong>{userOrders.filter(o => o.status === 'entregue').length}</strong>
                  <span>Entregues</span>
                </div>
              </div>
            </div>
            {/* Filters */}
            <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="admin-search-prod" style={{ flex: 1, minWidth: '160px' }}>
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar por produto ou item..." value={orderSearch} onChange={e => setOrderSearch(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>
                <span>Data:</span>
                <input type="date" value={orderDateStart} onChange={e => setOrderDateStart(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', maxWidth: '120px' }} />
                <span>—</span>
                <input type="date" value={orderDateEnd} onChange={e => setOrderDateEnd(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', maxWidth: '120px' }} />
              </div>
              {(orderSearch || orderDateStart || orderDateEnd) && (
                <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem' }} onClick={() => { setOrderSearch(''); setOrderDateStart(''); setOrderDateEnd('') }}>
                  <i className="fa-solid fa-xmark"></i> Limpar
                </button>
              )}
            </div>

            {(() => {
              const filtered = userOrders.filter(o => {
                if (orderDateStart && o.date < orderDateStart) return false
                if (orderDateEnd && o.date > orderDateEnd) return false
                if (orderSearch) {
                  const q = orderSearch.toLowerCase()
                  const matchItem = o.items.some(i => i.nome?.toLowerCase().includes(q))
                  if (!matchItem) return false
                }
                return true
              })
              return filtered.length === 0 ? (
                <div className="empty">
                  <i className="fa-solid fa-box-open"></i>
                  <h3>{userOrders.length === 0 ? 'Nenhum pedido encontrado' : 'Nenhum pedido com esses filtros'}</h3>
                  <p>{userOrders.length === 0 ? 'Você ainda não realizou nenhum pedido.' : 'Tente limpar os filtros para ver mais resultados.'}</p>
                </div>
              ) : (
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
                      {filtered.map(o => (
                        <tr key={o.id}>
                          <td data-label="Pedido">#{o.id.toString().slice(-6)}</td>
                          <td data-label="Data">{formatDate(o.date)}</td>
                          <td data-label="Itens">{o.items.reduce((s, i) => s + i.qty, 0)} itens</td>
                          <td className="td-price" data-label="Total">{formatPreco(o.total)}</td>
                          <td data-label="Pagamento">{o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</td>
                          <td data-label="Status"><span className={`status-tag status-${o.status}`}>{o.status}</span></td>
                          <td data-label="Ações">
                            <div className="td-actions">
                              {o.status === 'pre-pedido' && (
                                <button className="action-btn action-confirm" title="Editar Comanda" onClick={() => { setSelectedOrder(o); setEditedPreItems(o.items.map(i => ({ ...i }))); setEditPreOrder(true) }}>
                                  <i className="fa-solid fa-pen"></i>
                                </button>
                              )}
                              <button className="action-btn" title="Ver detalhes" onClick={() => setSelectedOrder(o)}>
                                <i className="fa-solid fa-eye"></i>
                              </button>
                              <button className="action-btn action-delete" title="Excluir" onClick={() => deleteOrder(o.id)}>
                                <i className="fa-solid fa-trash"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        )}

        {tab === 'financeiro' && (
          <div className="admin-section">
            <div className="admin-header-row">
              <div>
                <h1>Financeiro</h1>
                <p className="admin-subtitle">Gerencie suas contas a prazo</p>
              </div>
            </div>
            <div className="admin-cards">
              <div className="admin-card card-yellow">
                <i className="fa-solid fa-clock"></i>
                <div>
                  <strong>{formatPreco(pendentesTotal)}</strong>
                  <span>A Pagar</span>
                </div>
              </div>
              <div className="admin-card card-red">
                <i className="fa-solid fa-exclamation-triangle"></i>
                <div>
                  <strong>{formatPreco(atrasadosTotal)}</strong>
                  <span>Em Atraso</span>
                </div>
              </div>
              <div className="admin-card card-green">
                <i className="fa-solid fa-check-circle"></i>
                <div>
                  <strong>{formatPreco(userFinancial.filter(f => f.status === 'pago').reduce((s, f) => s + f.value, 0))}</strong>
                  <span>Pago</span>
                </div>
              </div>
            </div>
            <div className="admin-tabs">
              {[
                { id: 'todas', label: 'Todas', count: userFinancial.length },
                { id: 'pendente', label: 'Pendentes', count: pendentes.length },
                { id: 'pago', label: 'Pagas', count: userFinancial.filter(f => f.status === 'pago').length },
              ].map(t => (
                <button key={t.id} className={`admin-tab ${finFilter === t.id ? 'active' : ''}`} onClick={() => setFinFilter(t.id)}>
                  {t.label} {t.count > 0 && <span className="tab-count">{t.count}</span>}
                </button>
              ))}
            </div>
            {(() => {
              const filtered = finFilter === 'todas' ? userFinancial : userFinancial.filter(f => f.status === finFilter)
              return filtered.length === 0 ? (
                <div className="empty">
                  <i className="fa-solid fa-coins"></i>
                  <h3>Nenhum registro financeiro</h3>
                  <p>Você não possui contas a prazo.</p>
                </div>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Valor</th>
                        <th>Vencimento</th>
                        <th>Dias</th>
                        <th>Status</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(f => {
                        const diff = diffDays(hoje(), f.dueDate)
                        const overdue = f.status === 'pendente' && diff > 0
                        const order = allOrders.find(o => o.id === f.orderId)
                        return (
                          <tr key={f.id} className={overdue ? 'row-overdue' : ''}>
                            <td className="td-prod-name" data-label="Item">{f.itemName} ({f.qty}x)</td>
                            <td className="td-price" data-label="Valor">{formatPreco(f.value)}</td>
                            <td data-label="Vencimento">{formatDate(f.dueDate)}</td>
                            <td data-label="Dias">
                              {f.status === 'pago' ? (
                                <span className="days-ok">Pago</span>
                              ) : diff > 0 ? (
                                <span className="days-overdue">+{diff} dias</span>
                              ) : diff === 0 ? (
                                <span className="days-today">Vence hoje</span>
                              ) : (
                                <span className="days-future">Faltam {Math.abs(diff)} dias</span>
                              )}
                            </td>
                            <td data-label="Status">
                              <span className={`status-tag ${overdue ? 'status-atrasado' : f.status === 'pendente' ? 'status-pendente' : 'status-pago'}`}>
                                {overdue ? 'Atrasado' : f.status === 'pendente' ? 'Pendente' : 'Pago'}
                              </span>
                            </td>
                            <td data-label="Ações">
                              <div className="td-actions">
                                {f.status === 'pendente' && (
                                  <button className="action-btn action-confirm" title="Pagar" onClick={() => openPayment(f)}>
                                    <i className="fa-solid fa-credit-card"></i>
                                  </button>
                                )}
                                {order && (
                                  <button className="action-btn" title="Ver pedido" onClick={() => setSelectedOrder(order)}>
                                    <i className="fa-solid fa-eye"></i>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </div>
        )}
      </main>

      {/* ORDER DETAIL MODAL */}
      {selectedOrder && (
        <div className="admin-overlay" onClick={() => setSelectedOrder(null)}>
          <div className="admin-modal admin-modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '650px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-receipt"></i> Pedido #{selectedOrder.id.toString().slice(-6)}</h3>
              <button className="admin-modal-close" onClick={() => setSelectedOrder(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {(() => {
                const order = selectedOrder
                const orderFin = userFinancial.filter(f => f.orderId === order.id)
                return (
                  <>
                    <div className="detail-section">
                      <h4>Informações</h4>
                      <p><strong>Data:</strong> {formatDate(order.date)}</p>
                      <p><strong>Status:</strong> <span className={`status-tag status-${order.status}`}>{order.status}</span></p>
                      {order.customer?.endereco?.cidade && (
                        <p><strong>Cidade:</strong> {order.customer.endereco.cidade} / {order.customer.endereco.estado}</p>
                      )}
                    </div>

                    <div className="detail-section">
                      <h4><i className="fa-solid fa-box"></i> Itens</h4>
                      {order.items.map((i, idx) => (
                        <div key={idx} className="review-item">
                          <span className="review-item-name">{i.nome} <span className="review-item-qty">({i.qty}x)</span></span>
                          <div className="review-item-right">
                            <span className="review-item-price">{formatPreco(i.preco * i.qty)}</span>
                            <span className={`review-item-tag ${i.tipo}`}>{i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="detail-section">
                      <h4><i className="fa-solid fa-credit-card"></i> Pagamento</h4>
                      <p>{order.pagamento === 'avista' ? 'À Vista' : order.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</p>
                      {order.pagamento !== 'avista' && (
                        <div style={{ marginTop: '0.35rem' }}>
                          <p><strong>Total à vista:</strong> {formatPreco(order.totalAvista || 0)}</p>
                          <p><strong>Total a prazo:</strong> {formatPreco(order.totalAprazo || 0)}</p>
                        </div>
                      )}
                    </div>

                    {orderFin.length > 0 && (
                      <div className="detail-section">
                        <h4><i className="fa-solid fa-calendar"></i> Contas a Prazo</h4>
                        {orderFin.map(f => {
                          const diff = diffDays(hoje(), f.dueDate)
                          const overdue = f.status === 'pendente' && diff > 0
                          return (
                            <div key={f.id} className="detail-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                <span className="detail-item-name">{f.itemName} ({f.qty}x)</span>
                                <span className="detail-item-qty"><strong>{formatPreco(f.value)}</strong></span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.78rem' }}>
                                <span style={{ color: overdue ? 'var(--danger)' : 'var(--text-muted)' }}>
                                  Vence: {formatDate(f.dueDate)}
                                  {overdue && <span style={{ color: 'var(--danger)', fontWeight: 700 }}> ({diff} dias atrasado)</span>}
                                  {f.status === 'pendente' && !overdue && diff <= 0 && <span style={{ color: 'var(--text-muted)' }}> (faltam {Math.abs(diff)} dias)</span>}
                                </span>
                                <span className={`status-tag ${f.status === 'pago' ? 'status-pago' : overdue ? 'status-atrasado' : 'status-pendente'}`}>
                                  {f.status === 'pago' ? 'Pago' : overdue ? 'Atrasado' : 'Pendente'}
                                </span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    <div className="detail-section">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '1rem' }}>
                        <span style={{ fontWeight: 600 }}>Total</span>
                        <span style={{ fontWeight: 800, color: 'var(--accent)' }}>{formatPreco(order.total)}</span>
                      </div>
                    </div>

                    {order.status === 'entregue' && order.returnedItems?.length > 0 && (
                      <div className="detail-section">
                        <h4 style={{ color: 'var(--danger)' }}><i className="fa-solid fa-rotate-left"></i> Itens Devolvidos</h4>
                        {order.returnedItems.map((i, idx) => (
                          <div key={idx} className="review-item">
                            <span className="review-item-name">{i.nome} <span className="review-item-qty">({i.returnedQty}x)</span></span>
                            <div className="review-item-right">
                              <span className="review-item-price">{formatPreco(i.preco * i.returnedQty)}</span>
                              <span className="review-item-tag" style={{ background: '#fef2f2', color: 'var(--danger)' }}>Devolvido</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {order.status === 'entregue' && (order.identityPhoto || order.addressProof) && (
                      <div className="detail-section">
                        <h4><i className="fa-solid fa-file"></i> Documentos</h4>
                        {order.identityPhoto && (
                          <div style={{ marginBottom: '0.5rem' }}>
                            <p style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.25rem' }}>Identidade</p>
                            <img src={order.identityPhoto} alt="Identidade" style={{ maxWidth: '180px', borderRadius: '6px', border: '1px solid var(--admin-border)', cursor: 'pointer' }} onClick={() => window.open(order.identityPhoto, '_blank')} />
                          </div>
                        )}
                        {order.addressProof && (
                          <div>
                            <p style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.25rem' }}>Comprovante de Endereço</p>
                            <img src={order.addressProof} alt="Comprovante" style={{ maxWidth: '180px', borderRadius: '6px', border: '1px solid var(--admin-border)', cursor: 'pointer' }} onClick={() => window.open(order.addressProof, '_blank')} />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )
              })()}

              <div className="modal-actions" style={{ marginTop: '1rem' }}>
                {selectedOrder.status === 'pre-pedido' && (
                  <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }}
                    onClick={() => { setEditedPreItems(selectedOrder.items.map(i => ({ ...i }))); setEditPreOrder(true) }}>
                    <i className="fa-solid fa-pen"></i> Editar Comanda
                  </button>
                )}
                {(selectedOrder.status === 'em-andamento' || selectedOrder.status === 'confirmado') && (
                  <button className="admin-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6' }}
                    onClick={() => setShowComanda(selectedOrder)}>
                    <i className="fa-solid fa-receipt"></i> Visualizar Comanda
                  </button>
                )}
                {selectedOrder.status === 'em-rota' && (
                  <button className="admin-btn" style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }}
                    onClick={() => { setShowUserDelivery(selectedOrder); setUserReturnQtys({}); setUserPayQtys({}); setIdentityPreview(''); setAddressPreview('') }}>
                    <i className="fa-solid fa-rotate-left"></i> Registrar Pagamento / Devolução
                  </button>
                )}
                <button className="admin-btn admin-btn-sec" onClick={() => setSelectedOrder(null)}>Fechar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'conta' && (
        <div className="admin-section">
          <div className="admin-header-row">
            <div>
              <h1>Minha Conta</h1>
              <p className="admin-subtitle">Edite suas informações pessoais</p>
            </div>
          </div>
          <div className="conta-form">
            <div className="form-group">
              <label>Nome</label>
              <input type="text" value={editNome} onChange={e => setEditNome(e.target.value)} placeholder="Seu nome" />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} placeholder="seu@email.com" />
            </div>
            <div className="form-group">
              <label>Telefone / WhatsApp</label>
              <input type="text" value={editTelefone} onChange={e => setEditTelefone(e.target.value)} placeholder="(31) 99999-9999" />
            </div>
            <div className="form-group">
              <label>Senha</label>
              <input type="password" value={editSenha} onChange={e => setEditSenha(e.target.value)} placeholder="Nova senha" />
            </div>
            <div className="form-group">
              <label>Endereço</label>
              <AddressForm value={editEndereco} onChange={(addr) => setEditEndereco(addr)} />
            </div>
            <button className="btn-next conta-save-btn" disabled={savingProfile} onClick={saveProfile}>
              {savingProfile ? <span><i className="fa-solid fa-spinner fa-spin"></i> Salvando...</span> : <span><i className="fa-solid fa-check"></i> Salvar Alterações</span>}
            </button>
          </div>
        </div>
      )}

      {/* Sticky bottom nav for mobile */}
      <nav className="admin-bottom-nav">
        <button className={`admin-bottom-item ${tab === 'conta' ? 'active' : ''}`} onClick={initConta}>
          <i className="fa-solid fa-user-gear"></i>
          <span>Minha Conta</span>
        </button>
        <button className={`admin-bottom-item ${tab === 'pedidos' ? 'active' : ''}`} onClick={() => setTab('pedidos')}>
          <i className="fa-solid fa-clipboard-list"></i>
          <span>Pedidos</span>
        </button>
        <button className={`admin-bottom-item ${tab === 'financeiro' ? 'active' : ''}`} onClick={() => setTab('financeiro')}>
          <i className="fa-solid fa-coins"></i>
          <span>Financeiro</span>
          {pendentes.length > 0 && <span className="admin-bottom-badge">{pendentes.length}</span>}
        </button>
        <button className="admin-bottom-item" onClick={onVoltar}>
          <i className="fa-solid fa-arrow-left"></i>
          <span>Voltar</span>
        </button>
      </nav>

      {showPayment && (
        <div className="admin-overlay" onClick={closePayment}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-credit-card"></i> Pagamento</h3>
              <button className="admin-modal-close" onClick={closePayment}><i className="fa-solid fa-times"></i></button>
            </div>
            <div className="admin-modal-body">
              {paymentStep === 'review' && (
                <>
                  <div style={{ padding: '0.5rem 0' }}>
                    <div style={{ background: '#f9fafb', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Item</span>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Valor</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>{showPayment.itemName} ({showPayment.qty}x)</span>
                        <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--accent)' }}>{formatPreco(showPayment.value)}</span>
                      </div>
                    </div>
                    <div style={{ background: '#f9fafb', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Vencimento</span>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Cliente</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{formatDate(showPayment.dueDate)}</span>
                        <span>{currentUser?.nome || '-'}</span>
                      </div>
                    </div>
                    <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '0.75rem 1rem', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <i className="fa-solid fa-qrcode" style={{ color: 'var(--success)', fontSize: '1.2rem' }}></i>
                      <div style={{ fontSize: '0.82rem', color: '#166534' }}>
                        <strong>Pagamento via PIX</strong>
                        <div style={{ fontSize: '0.75rem' }}>Escaneie o código ou copie a chave</div>
                      </div>
                    </div>
                  </div>
                  <button className="admin-btn" style={{ width: '100%', justifyContent: 'center', background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)', padding: '0.7rem' }} onClick={() => setPaymentStep('pix')}>
                    <i className="fa-solid fa-qrcode"></i> Gerar PIX para pagamento
                  </button>
                </>
              )}
              {paymentStep === 'pix' && (
                <>
                  <div style={{ padding: '0.5rem 0', textAlign: 'center' }}>
                    <div style={{ background: 'white', borderRadius: 12, padding: '1.25rem', marginBottom: '0.75rem', border: '2px dashed var(--admin-border)' }}>
                      <div style={{ width: 160, height: 160, margin: '0 auto 0.75rem', background: '#f0f2f5', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--admin-border)' }}>
                        <i className="fa-solid fa-qrcode" style={{ fontSize: '4rem', color: 'var(--admin-text-sec)' }}></i>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--admin-text-sec)', wordBreak: 'break-all', background: '#f9fafb', padding: '0.5rem', borderRadius: 6, fontFamily: 'monospace' }}>
                        {generatePixCode()}
                      </div>
                      <button className="admin-btn" style={{ marginTop: '0.5rem', fontSize: '0.75rem' }} onClick={() => { navigator.clipboard?.writeText(generatePixCode()); alert('Código PIX copiado!') }}>
                        <i className="fa-solid fa-copy"></i> Copiar código
                      </button>
                    </div>
                    <div style={{ background: '#fefce8', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1rem', border: '1px solid #fde68a', textAlign: 'left', fontSize: '0.8rem', color: '#92400e' }}>
                      <i className="fa-solid fa-circle-info" style={{ marginRight: '0.35rem' }}></i>
                      Após realizar o pagamento, clique em <strong>"Confirmar Pagamento"</strong> para validar.
                    </div>
                    <button
                      className="admin-btn"
                      style={{ width: '100%', justifyContent: 'center', background: processing ? 'var(--admin-text-sec)' : 'var(--success)', color: 'white', borderColor: processing ? 'var(--admin-text-sec)' : 'var(--success)', padding: '0.7rem' }}
                      onClick={processPayment}
                      disabled={processing}
                    >
                      {processing ? (
                        <><i className="fa-solid fa-spinner fa-spin"></i> Processando...</>
                      ) : (
                        <><i className="fa-solid fa-check"></i> Confirmar Pagamento</>
                      )}
                    </button>
                  </div>
                </>
              )}
              {paymentStep === 'success' && (
                <div style={{ padding: '1.5rem 0', textAlign: 'center' }}>
                  <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                    <i className="fa-solid fa-check" style={{ fontSize: '1.8rem', color: 'var(--success)' }}></i>
                  </div>
                  <h3 style={{ margin: '0 0 0.25rem', color: 'var(--success)' }}>Pagamento Confirmado!</h3>
                  <p style={{ fontSize: '0.85rem', color: 'var(--admin-text-sec)', marginBottom: '1.25rem' }}>
                    {showPayment.itemName} — {formatPreco(showPayment.value)}
                  </p>
                  <div style={{ background: '#f9fafb', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1.25rem', textAlign: 'left', fontSize: '0.82rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <span style={{ color: 'var(--admin-text-sec)' }}>Data do pagamento</span>
                      <span style={{ fontWeight: 600 }}>{formatDate(hoje())}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--admin-text-sec)' }}>Status</span>
                      <span className="status-tag status-pago">Pago</span>
                    </div>
                  </div>
                  <button className="admin-btn" style={{ width: '100%', justifyContent: 'center', background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)', padding: '0.65rem' }} onClick={closePayment}>
                    <i className="fa-solid fa-check"></i> Concluir
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* PRE-PEDIDO EDIT MODAL */}
      {editPreOrder && selectedOrder && (
        <div className="admin-overlay" onClick={() => setEditPreOrder(false)}>
          <div className="admin-modal admin-modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-pen"></i> Editar Comanda — Pedido #{selectedOrder.id.toString().slice(-6)}</h3>
              <button className="admin-modal-close" onClick={() => setEditPreOrder(false)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <div style={{ marginBottom: '1rem' }}>
                <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Itens</h4>
                {editedPreItems.map((i, idx) => (
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
                      <button className="action-btn action-delete" title="Remover" onClick={() => removeEditedItem(idx)}><i className="fa-solid fa-trash"></i></button>
                    </div>
                  </div>
                ))}
                {editedPreItems.length === 0 && <p style={{ fontSize: '0.85rem', color: 'var(--admin-text-sec)' }}>Nenhum item na comanda</p>}
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <h4 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}><i className="fa-solid fa-plus-circle"></i> Adicionar Produtos</h4>
                <div className="admin-search-prod" style={{ marginBottom: '0.5rem' }}>
                  <i className="fa-solid fa-search"></i>
                  <input type="text" placeholder="Buscar produto..." value={preAddSearch} onChange={e => setPreAddSearch(e.target.value)} style={{ width: '100%' }} />
                </div>
                {filteredPreAddProds.length > 0 && (
                  <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: '8px' }}>
                    {filteredPreAddProds.map(p => {
                      const inCart = preAddCart[p.id]
                      return (
                        <div key={p.id} className="add-prod-row" style={{ padding: '0.4rem 0.6rem' }}>
                          <div className="add-prod-info">
                            <span className="add-prod-name">{p.nome}</span>
                            <span className="add-prod-price">{formatPreco(p.preco)}</span>
                          </div>
                          {inCart ? (
                            <div className="add-prod-controls">
                              <span className="add-prod-qty">{inCart.qty}x</span>
                              <button className="qty-btn-sm" onClick={() => removeFromPreCart(p.id)}><i className="fa-solid fa-minus"></i></button>
                              <button className="qty-btn-sm" onClick={() => addToPreCart(p)}><i className="fa-solid fa-plus"></i></button>
                            </div>
                          ) : (
                            <button className="add-prod-add" onClick={() => addToPreCart(p)}>
                              <i className="fa-solid fa-plus"></i> Adicionar
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                {Object.values(preAddCart).filter(i => i.qty > 0).length > 0 && (
                  <button className="admin-btn" style={{ marginTop: '0.5rem', fontSize: '0.82rem', background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6' }} onClick={confirmPreAdd}>
                    <i className="fa-solid fa-check"></i> Adicionar {Object.values(preAddCart).reduce((s, i) => s + i.qty, 0)} item(ns)
                  </button>
                )}
                {!preAddSearch && <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Digite o nome do produto para buscá-lo no catálogo</p>}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Total: <strong style={{ color: 'var(--accent)', fontSize: '1.1rem' }}>{formatPreco(editedPreItems.filter(i => i.qty > 0).reduce((s, i) => s + i.preco * i.qty, 0))}</strong></span>
                <span style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>{editedPreItems.filter(i => i.qty > 0).length} itens</span>
              </div>

              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setEditPreOrder(false)}>Cancelar</button>
                <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} disabled={editedPreItems.filter(i => i.qty > 0).length === 0} onClick={() => savePrePedidoEdits(editedPreItems.filter(i => i.qty > 0))}>
                  <i className="fa-solid fa-check"></i> Salvar Alterações
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* USER DELIVERY MODAL (EM ROTA) */}
      {showUserDelivery && (
        <div className="admin-overlay" onClick={() => setShowUserDelivery(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-rotate-left"></i> Registrar Pagamento / Devolução</h3>
              <button className="admin-modal-close" onClick={() => setShowUserDelivery(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ fontSize: '0.85rem', color: 'var(--admin-text-sec)', marginBottom: '0.75rem' }}>
                Informe o que deseja <strong>pagar</strong> e o que vai <strong>devolver</strong>.
              </p>

              {/* Items */}
              <div style={{ marginBottom: '1rem' }}>
                {showUserDelivery.items.map((i, idx) => {
                  const returnQty = userReturnQtys[i.id] || 0
                  const payQty = userPayQtys[i.id] || 0
                  const maxReturn = i.qty
                  const remaining = i.qty - returnQty
                  return (
                    <div key={idx} style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--admin-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{i.nome} ({i.qty}x)</span>
                        <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{formatPreco(i.preco * i.qty)}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', marginBottom: '0.35rem' }}>
                        {i.preco.toFixed(2).replace('.', ',')} /un — {i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                      </div>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem' }}>
                          <span style={{ color: 'var(--success)', fontWeight: 600 }}>Pagar:</span>
                          <input type="number" min="0" max={maxReturn} step="1" value={payQty || ''}
                            placeholder="0"
                            onChange={e => {
                              const val = e.target.value === '' ? '' : Math.min(Number(e.target.value), maxReturn)
                              setUserPayQtys(prev => ({ ...prev, [i.id]: val }))
                            }}
                            style={{ width: '50px', padding: '0.25rem 0.35rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', textAlign: 'center' }}
                          />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem' }}>
                          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>Devolver:</span>
                          <input type="number" min="0" max={maxReturn} step="1" value={returnQty || ''}
                            placeholder="0"
                            onChange={e => {
                              const val = e.target.value === '' ? '' : Math.min(Number(e.target.value), maxReturn)
                              setUserReturnQtys(prev => ({ ...prev, [i.id]: val }))
                            }}
                            style={{ width: '50px', padding: '0.25rem 0.35rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', textAlign: 'center' }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Auto-calc summary */}
              {(() => {
                const totalOriginal = showUserDelivery.items.reduce((s, i) => s + i.preco * i.qty, 0)
                const totalPago = showUserDelivery.items.reduce((s, i) => s + i.preco * (userPayQtys[i.id] || 0), 0)
                const totalDevolvido = showUserDelivery.items.reduce((s, i) => s + i.preco * (userReturnQtys[i.id] || 0), 0)
                const totalCobrar = totalOriginal - totalDevolvido
                return (
                  <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem' }}>
                      <span>Total original</span>
                      <span>{formatPreco(totalOriginal)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem', color: 'var(--success)' }}>
                      <span><i className="fa-solid fa-check-circle"></i> Total a pagar</span>
                      <span style={{ fontWeight: 700 }}>{formatPreco(totalPago)}</span>
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
                  <i className="fa-solid fa-file"></i> Documentos <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>(opcional — apenas para primeiro cadastro)</span>
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '140px' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem', color: 'var(--admin-text-sec)' }}>Foto de Identidade</label>
                    <input type="file" accept="image/*" onChange={e => handleFile(e, 'identity')} style={{ fontSize: '0.75rem', width: '100%' }} />
                    {identityPreview && <img src={identityPreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '60px', marginTop: '0.25rem', borderRadius: '4px' }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: '140px' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem', color: 'var(--admin-text-sec)' }}>Comprovante de Endereço</label>
                    <input type="file" accept="image/*" onChange={e => handleFile(e, 'address')} style={{ fontSize: '0.75rem', width: '100%' }} />
                    {addressPreview && <img src={addressPreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '60px', marginTop: '0.25rem', borderRadius: '4px' }} />}
                  </div>
                </div>
              </div>

              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setShowUserDelivery(null)}>Cancelar</button>
                <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }}
                  disabled={finalizing || Object.values(userReturnQtys).every(v => !v || v <= 0)}
                  onClick={finalizarUserEntrega}>
                  {finalizing ? (
                    <><i className="fa-solid fa-spinner fa-spin"></i> Finalizando...</>
                  ) : (
                    <><i className="fa-solid fa-check"></i> Finalizar Pedido</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* COMANDA MODAL */}
      {showComanda && (
        <div className="admin-overlay" onClick={() => setShowComanda(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="admin-modal-header" style={{ background: 'var(--accent)', color: 'white' }}>
              <h3 style={{ color: 'white' }}><i className="fa-solid fa-receipt"></i> Comanda #{showComanda.id.toString().slice(-6)}</h3>
              <button className="admin-modal-close" onClick={() => setShowComanda(null)} style={{ color: 'white' }}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body" style={{ maxHeight: '75vh', overflowY: 'auto' }}>
              <div style={{ padding: '0.5rem 0', borderBottom: '2px dashed var(--admin-border)', marginBottom: '1rem', textAlign: 'center' }}>
                <strong style={{ fontSize: '0.9rem' }}>{showComanda.customer?.nome || 'Cliente'}</strong>
                <p style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>
                  {formatDate(showComanda.date)} &middot; <span className={`status-tag status-${showComanda.status}`} style={{ fontSize: '0.7rem' }}>{showComanda.status}</span>
                </p>
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, color: 'var(--admin-text-sec)', padding: '0.35rem 0', borderBottom: '1px solid var(--admin-border)' }}>
                  <span>Item</span>
                  <span style={{ textAlign: 'center', width: '50px' }}>Qtd</span>
                  <span style={{ textAlign: 'right', width: '80px' }}>Valor</span>
                </div>
                {showComanda.items.map((i, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid #f0f0f0', fontSize: '0.82rem' }}>
                    <span style={{ flex: 1 }}>{i.nome}</span>
                    <span style={{ textAlign: 'center', width: '50px', fontWeight: 600 }}>{i.qty}x</span>
                    <span style={{ textAlign: 'right', width: '80px', fontWeight: 600 }}>{formatPreco(i.preco * i.qty)}</span>
                  </div>
                ))}
              </div>

              <div style={{ borderTop: '2px solid var(--admin-border)', paddingTop: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.82rem' }}>
                  <span>Total à vista</span>
                  <span style={{ fontWeight: 600 }}>{formatPreco(showComanda.totalAvista || 0)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.82rem' }}>
                  <span>Total a prazo</span>
                  <span style={{ fontWeight: 600, color: 'var(--warning)' }}>{formatPreco(showComanda.totalAprazo || 0)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1rem', borderTop: '1px solid var(--admin-border)', paddingTop: '0.5rem', marginTop: '0.25rem' }}>
                  <span style={{ fontWeight: 700 }}>Total Geral</span>
                  <span style={{ fontWeight: 800, color: 'var(--accent)' }}>{formatPreco(showComanda.total)}</span>
                </div>
              </div>

              <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: '#f9fafb', borderRadius: '8px', fontSize: '0.78rem', color: 'var(--admin-text-sec)', textAlign: 'center' }}>
                {showComanda.pagamento === 'aprazo' ? 'Pagamento: A Prazo' : showComanda.pagamento === 'avista' ? 'Pagamento: À Vista' : 'Pagamento: Misto'}
              </div>
            </div>

            <div className="admin-modal-footer" style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid var(--admin-border)', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="admin-btn admin-btn-sec" onClick={() => setShowComanda(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
