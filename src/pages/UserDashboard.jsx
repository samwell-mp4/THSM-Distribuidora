import { useState, useMemo } from 'react'

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

export default function UserDashboard({ produtos = [], onVoltar }) {
  const [tab, setTab] = useState('pedidos')
  const [finFilter, setFinFilter] = useState('todas')
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [showPayment, setShowPayment] = useState(null)
  const [paymentStep, setPaymentStep] = useState('review')
  const [processing, setProcessing] = useState(false)
  const [prodSearch, setProdSearch] = useState('')
  const [prodCategoria, setProdCategoria] = useState('TODOS')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const currentUser = useMemo(() => {
    try { const d = localStorage.getItem(LS_SESSAO); return d ? JSON.parse(d) : null } catch { return null }
  }, [])

  const [allOrders, setAllOrders] = useState(() => getLS(LS_ORDERS))
  const [financial, setFinancial] = useState(() => getLS(LS_FINANCIAL))

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

  function generatePixCode() {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    let code = '00020126580014BR.GOV.BCB.PIX0136'
    for (let i = 0; i < 32; i++) code += chars.charAt(Math.floor(Math.random() * chars.length))
    code += '52040000530398654'
    code += String(showPayment?.value?.toFixed(2).replace('.', '') || '000').padStart(10, '0')
    code += '5802BR5925THSM Distribuidora6009SAO PAULO62070503***6304FFFF'
    return code
  }

  if (selectedOrder) {
    const order = selectedOrder
    const orderFin = userFinancial.filter(f => f.orderId === order.id)
    return (
      <div className="app">
        <header className="header">
          <div className="header-inner">
            <div className="header-brand">
              <div className="brand-icon"><i className="fa-solid fa-cubes"></i></div>
              <div>
                <h1>THSM Distribuidora</h1>
                <span className="header-sub">Detalhes do Pedido</span>
              </div>
            </div>
          </div>
        </header>
        <main className="main" style={{ maxWidth: '700px' }}>
          <button onClick={() => setSelectedOrder(null)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <i className="fa-solid fa-arrow-left"></i> Voltar aos meus pedidos
          </button>
          <div className="review-section">
            <h4><i className="fa-solid fa-receipt"></i> Pedido #{order.id.toString().slice(-6)}</h4>
            <p><strong>Data:</strong> {formatDate(order.date)}</p>
            <p><strong>Status:</strong> <span className={`status-tag status-${order.status}`}>{order.status}</span></p>
          </div>
          <div className="review-section">
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
          <div className="review-section">
            <h4><i className="fa-solid fa-credit-card"></i> Pagamento</h4>
            <p>{order.pagamento === 'avista' ? 'À Vista' : order.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</p>
            {order.pagamento !== 'avista' && (
              <div style={{ marginTop: '0.5rem' }}>
                <p><strong>Total à vista:</strong> {formatPreco(order.totalAvista || 0)}</p>
                <p><strong>Total a prazo:</strong> {formatPreco(order.totalAprazo || 0)}</p>
              </div>
            )}
          </div>
          {orderFin.length > 0 && (
            <div className="review-section">
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
          <div className="review-total" style={{ marginTop: '0.75rem' }}>
            <span>Total do Pedido</span>
            <span className="review-total-price">{formatPreco(order.total)}</span>
          </div>
        </main>
      </div>
    )
  }

  const tabLabel = tab === 'produtos' ? 'Produtos' : tab === 'pedidos' ? 'Meus Pedidos' : tab === 'financeiro' ? 'Financeiro' : ''

  return (
    <div className="admin">
      {/* Mobile header */}
      <div className="admin-mobile-top">
        <button className="admin-hamburger" onClick={() => setSidebarOpen(true)}>
          <i className="fa-solid fa-bars"></i>
        </button>
        <span className="admin-mobile-title">{tabLabel}</span>
        <button className="admin-hamburger" onClick={onVoltar} style={{ fontSize: '0.9rem' }}>
          <i className="fa-solid fa-arrow-left"></i>
        </button>
      </div>

      {/* Sidebar overlay on mobile */}
      {sidebarOpen && <div className="admin-overlay" onClick={() => setSidebarOpen(false)} />}

      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="admin-sidebar-header">
          <div className="admin-logo">
            <i className="fa-solid fa-cubes"></i>
            <div>
              <strong>THSM Distribuidora</strong>
              <span>Cliente</span>
            </div>
          </div>
          <button className="admin-hamburger close" onClick={() => setSidebarOpen(false)} style={{ display: 'none' }}>
            <i className="fa-solid fa-times"></i>
          </button>
        </div>
        <nav className="admin-nav">
          <button className={`admin-nav-item ${tab === 'produtos' ? 'active' : ''}`} onClick={() => { setTab('produtos'); setSidebarOpen(false) }}>
            <i className="fa-solid fa-box"></i> <span>Produtos</span>
          </button>
          <button className={`admin-nav-item ${tab === 'pedidos' ? 'active' : ''}`} onClick={() => { setTab('pedidos'); setSidebarOpen(false) }}>
            <i className="fa-solid fa-clipboard-list"></i> <span>Meus Pedidos</span>
          </button>
          <button className={`admin-nav-item ${tab === 'financeiro' ? 'active' : ''}`} onClick={() => { setTab('financeiro'); setSidebarOpen(false) }}>
            <i className="fa-solid fa-coins"></i> <span>Financeiro</span>
            {pendentes.length > 0 && <span className="admin-badge">{pendentes.length}</span>}
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
            {userOrders.length === 0 ? (
              <div className="empty">
                <i className="fa-solid fa-box-open"></i>
                <h3>Nenhum pedido encontrado</h3>
                <p>Você ainda não realizou nenhum pedido.</p>
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
                    {userOrders.map(o => (
                      <tr key={o.id}>
                        <td data-label="Pedido">#{o.id.toString().slice(-6)}</td>
                        <td data-label="Data">{formatDate(o.date)}</td>
                        <td data-label="Itens">{o.items.reduce((s, i) => s + i.qty, 0)} itens</td>
                        <td className="td-price" data-label="Total">{formatPreco(o.total)}</td>
                        <td data-label="Pagamento">{o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</td>
                        <td data-label="Status"><span className={`status-tag status-${o.status}`}>{o.status}</span></td>
                        <td data-label="Ações">
                          <div className="td-actions">
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
            )}
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

      {/* Sticky bottom nav for mobile */}
      <nav className="admin-bottom-nav">
        <button className={`admin-bottom-item ${tab === 'produtos' ? 'active' : ''}`} onClick={() => setTab('produtos')}>
          <i className="fa-solid fa-box"></i>
          <span>Produtos</span>
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
    </div>
  )
}
