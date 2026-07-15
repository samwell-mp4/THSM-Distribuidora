import { useState, useMemo, useEffect, useCallback } from 'react'
import produtos from './data/produtos.json'
import Admin from './pages/Admin'
import AddressForm from './components/AddressForm'
import UserDashboard from './pages/UserDashboard'
import { supabase, upsertOrder, upsertUser } from './lib/supabase'
import './App.css'

const LS_USUARIOS = 'thsm_usuarios'
const LS_SESSAO = 'thsm_sessao'
const LS_ORDERS = 'thsm_admin_orders'
const LS_ADMIN = 'thsm_admin_auth'
const WEBHOOK_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/novo-pedido'
const ADMIN_USER = 'thsmadmin'
const ADMIN_PASS = 'th2026smdistribuidora!'

function App() {
  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('TODOS')
  const [selected, setSelected] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [imageErrors, setImageErrors] = useState({})
  const [sortBy, setSortBy] = useState('nome-asc')
  const [priceRange, setPriceRange] = useState([0, 5000])
  const [onlyInStock, setOnlyInStock] = useState(false)
  const [cart, setCart] = useState({})
  const [cartOpen, setCartOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [showFilters, setShowFilters] = useState(false)
  const [checkout, setCheckout] = useState(null)
  const [customer, setCustomer] = useState({ nome: '', email: '', telefone: '', senha: '', endereco: { cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' } })
  const [pagamento, setPagamento] = useState('aprazo')
  const [showLogin, setShowLogin] = useState(false)
  const [loginEmail, setLoginEmail] = useState('')
  const [loginSenha, setLoginSenha] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [adminUser, setAdminUser] = useState('')
  const [adminPass, setAdminPass] = useState('')
  const [initialOrderId, setInitialOrderId] = useState(null)
  const [showAddressRequired, setShowAddressRequired] = useState(false)
  const [addressRequiredEndereco, setAddressRequiredEndereco] = useState({ cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' })
  const [savingAddress, setSavingAddress] = useState(false)
  const [showAddressEdit, setShowAddressEdit] = useState(false)
  const [addressEditEndereco, setAddressEditEndereco] = useState({ cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' })
  const [adminAuth, setAdminAuth] = useState(() => {
    try { const d = localStorage.getItem(LS_ADMIN); return d ? JSON.parse(d) : null } catch { return null }
  })
  const [usuarios, setUsuarios] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_USUARIOS)) || [] } catch { return [] }
  })
  const [currentUser, setCurrentUser] = useState(() => {
    try { const d = localStorage.getItem(LS_SESSAO); return d ? JSON.parse(d) : null } catch { return null }
  })
  const ITEMS_PER_PAGE = 12

  const getRouteFromHash = useCallback(() => {
    if (new URLSearchParams(window.location.search).has('pedido')) return 'userdash'
    if (new URLSearchParams(window.location.search).has('login')) return 'userdash'
    const hash = window.location.hash.replace(/^#/, '') || '/'
    const path = hash.replace(/\/+$/, '') || '/'
    if (path.startsWith('/admin')) return 'admin'
    if (path.startsWith('/minha-conta')) return 'userdash'
    return 'catalog'
  }, [])

  const [route, setRoute] = useState(getRouteFromHash)

  const navigate = useCallback((path) => {
    window.location.hash = path
    setRoute(getRouteFromHash())
  }, [getRouteFromHash])

  useEffect(() => {
    const onHashChange = () => setRoute(getRouteFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [getRouteFromHash])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const pid = params.get('pedido')
    const loginToken = params.get('login')
    const doLogin = async (telefone) => {
      sessionStorage.setItem('thsm_user_tab', 'pedidos')
      let user = usuarios.find(u => u.telefone === telefone)
      if (!user) {
        const { data } = await supabase.from('usuarios').select('*').eq('telefone', telefone).single()
        if (data) {
          user = data
          setUsuarios(prev => {
            const merged = [...prev.filter(u => u.telefone !== data.telefone), data]
            localStorage.setItem(LS_USUARIOS, JSON.stringify(merged))
            return merged
          })
        }
      }
      if (user) {
        setCurrentUser(user)
        showToast(`Bem-vindo, ${user.nome}!`)
        const addr = user.endereco || {}
        if (!addr.cep || !addr.cidade || !addr.rua || !addr.numero) {
          setAddressRequiredEndereco({ cep: addr.cep || '', estado: addr.estado || '', cidade: addr.cidade || '', bairro: addr.bairro || '', rua: addr.rua || '', numero: addr.numero || '', complemento: addr.complemento || '' })
          setShowAddressRequired(true)
        } else {
          if (route !== 'userdash') navigate('/')
        }
      }
    }
    if (loginToken) {
      try {
        const telefone = atob(loginToken)
        doLogin(telefone)
      } catch { /* ignore invalid base64 */ }
      const url = new URL(window.location)
      url.searchParams.delete('login')
      window.history.replaceState({}, '', url)
    } else if (pid) {
      setInitialOrderId(Number(pid))
      const url = new URL(window.location)
      url.searchParams.delete('pedido')
      window.history.replaceState({}, '', url)
      if (route !== 'userdash') navigate('/minha-conta')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loginAdmin = () => {
    if (adminUser === ADMIN_USER && adminPass === ADMIN_PASS) {
      const auth = { loggedIn: true, timestamp: Date.now() }
      localStorage.setItem(LS_ADMIN, JSON.stringify(auth))
      setAdminAuth(auth)
      setShowAdminLogin(false)
      setAdminUser('')
      setAdminPass('')
      navigate('/admin')
    } else {
      alert('Usuário ou senha incorretos')
    }
  }

  // Auth

  useEffect(() => { localStorage.setItem(LS_USUARIOS, JSON.stringify(usuarios)) }, [usuarios])
  useEffect(() => { if (currentUser) localStorage.setItem(LS_SESSAO, JSON.stringify(currentUser)); else localStorage.removeItem(LS_SESSAO) }, [currentUser])
  useEffect(() => {
    supabase.from('usuarios').select('*').then(({ data }) => {
      if (data?.length) {
        localStorage.setItem(LS_USUARIOS, JSON.stringify(data))
        setUsuarios(data)
        const session = localStorage.getItem(LS_SESSAO)
        if (session) {
          const cur = JSON.parse(session)
          const fresh = data.find(u => u.telefone === cur.telefone)
          if (fresh) setCurrentUser(fresh)
        }
      }
    }).catch(() => {})
  }, [])

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }, [])

  const categorias = useMemo(() => ['TODOS', ...[...new Set(produtos.map(p => p.categoria))].sort()], [])

  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim()
    return produtos.filter(p => {
      if (term && !p.nome.toLowerCase().includes(term) && !p.categoria.toLowerCase().includes(term)) return false
      if (categoria !== 'TODOS' && p.categoria !== categoria) return false
      if (p.preco < priceRange[0] || p.preco > priceRange[1]) return false
      if (onlyInStock && p.estoque <= 0) return false
      return true
    }).sort((a, b) => {
      switch (sortBy) {
        case 'preco-asc': return a.preco - b.preco
        case 'preco-desc': return b.preco - a.preco
        case 'nome-desc': return b.nome.localeCompare(a.nome, 'pt-BR')
        default: return a.nome.localeCompare(b.nome, 'pt-BR')
      }
    })
  }, [search, categoria, priceRange, onlyInStock, sortBy])

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const paginated = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)

  useEffect(() => { setCurrentPage(1) }, [search, categoria, priceRange, onlyInStock, sortBy])

  const formatPreco = (v) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`

  const handleImageError = (id) => setImageErrors(prev => ({ ...prev, [id]: true }))

  const cartItems = useMemo(() => Object.values(cart).filter(i => i.qty > 0), [cart])
  const cartTotal = useMemo(() => cartItems.reduce((s, i) => s + i.preco * i.qty, 0), [cartItems])
  const cartCount = useMemo(() => cartItems.reduce((s, i) => s + i.qty, 0), [cartItems])

  const [priceMin, priceMax] = useMemo(() => {
    const prices = produtos.map(p => p.preco)
    return [Math.floor(Math.min(...prices)), Math.ceil(Math.max(...prices))]
  }, [])

  // --- Auth ---
  const fazerLogin = async () => {
    const raw = loginEmail.replace(/\D/g, '')
    const telefone = raw.startsWith('55') ? raw : '55' + raw
    const user = usuarios.find(u => u.telefone === telefone)
    if (!user) { showToast('Telefone não cadastrado', 'error'); return }
    const senha = user.endereco?.senha
    if (senha && loginSenha !== senha) { showToast('Senha incorreta', 'error'); return }
    setCurrentUser(user)
    setShowLogin(false)
    setLoginEmail('')
    setLoginSenha('')
    showToast(`Bem-vindo, ${user.nome}!`)
    const addr = user.endereco || {}
    if (!addr.cep || !addr.cidade || !addr.rua || !addr.numero) {
      setAddressRequiredEndereco({ cep: addr.cep || '', estado: addr.estado || '', cidade: addr.cidade || '', bairro: addr.bairro || '', rua: addr.rua || '', numero: addr.numero || '', complemento: addr.complemento || '' })
      setShowAddressRequired(true)
    }
  }

  const fazerRegistro = async () => {
    const raw = loginEmail.replace(/\D/g, '')
    const telefone = raw.startsWith('55') ? raw : '55' + raw
    if (!telefone || telefone.replace(/\D/g, '').length < 11) { showToast('Telefone inválido', 'error'); return }
    if (usuarios.find(u => u.telefone === telefone)) { showToast('Telefone já cadastrado', 'error'); return }
    const nome = loginEmail.includes('@') ? loginEmail.split('@')[0] : 'Usuário'
    const { data, error } = await supabase.from('usuarios').insert({
      telefone,
      nome,
      email: loginEmail.includes('@') ? loginEmail : '',
      endereco: { senha: loginSenha || '' }
    }).select().single()
    if (error) { showToast('Erro ao cadastrar', 'error'); return }
    setUsuarios(prev => [...prev, data])
    setCurrentUser(data)
    setShowLogin(false)
    setLoginEmail('')
    setLoginSenha('')
    showToast('Conta criada com sucesso!')
    const addr = data.endereco || {}
    if (!addr.cep || !addr.cidade || !addr.rua || !addr.numero) {
      setAddressRequiredEndereco({ cep: addr.cep || '', estado: addr.estado || '', cidade: addr.cidade || '', bairro: addr.bairro || '', rua: addr.rua || '', numero: addr.numero || '', complemento: addr.complemento || '' })
      setShowAddressRequired(true)
    }
  }

  const logout = () => {
    setCurrentUser(null)
    localStorage.removeItem(LS_SESSAO)
    showToast('Você saiu da sua conta')
  }

  const saveRequiredAddress = async () => {
    const addr = addressRequiredEndereco
    if (!addr.cep || !addr.cidade || !addr.rua || !addr.numero) { showToast('Preencha CEP, cidade, rua e número', 'error'); return }
    setSavingAddress(true)
    const updated = { ...currentUser, endereco: { ...(currentUser?.endereco || {}), ...addr } }
    await upsertUser(updated)
    setCurrentUser(updated)
    setShowAddressRequired(false)
    setSavingAddress(false)
    showToast('Endereço salvo com sucesso!')
    navigate('/')
  }

  const saveAddressEdit = async () => {
    const addr = addressEditEndereco
    if (!addr.cep || !addr.cidade || !addr.rua || !addr.numero) { showToast('Preencha CEP, cidade, rua e número', 'error'); return }
    setSavingAddress(true)
    const updated = { ...currentUser, endereco: { ...(currentUser?.endereco || {}), ...addr } }
    await upsertUser(updated)
    setCurrentUser(updated)
    setShowAddressEdit(false)
    setSavingAddress(false)
    showToast('Endereço atualizado!')
  }

  const autoLoginOuRegistro = async () => {
    const raw = customer.telefone.replace(/\D/g, '')
    const telefone = raw.startsWith('55') ? raw : '55' + raw
    if (!telefone) { showToast('Informe seu telefone', 'error'); return false }
    const existente = usuarios.find(u => u.telefone === telefone)
    if (existente) {
      const senha = existente.endereco?.senha
      if (senha && customer.senha !== senha) { showToast('Senha incorreta', 'error'); return false }
      setCurrentUser(existente)
      return true
    }
    if (!customer.senha) { showToast('Escolha uma senha', 'error'); return false }
    const { data, error } = await supabase.from('usuarios').insert({
      telefone,
      nome: customer.nome,
      email: customer.email,
      endereco: { ...(customer.endereco || {}), senha: customer.senha }
    }).select().single()
    if (error) { showToast('Erro ao criar cadastro', 'error'); return false }
    setUsuarios(prev => [...prev, data])
    setCurrentUser(data)
    return true
  }

  const addToCart = useCallback((p) => {
    setCart(prev => {
      const id = p.id
      const existing = prev[id]
      if (existing) {
        if (existing.qty >= p.estoque && p.estoque > 0) { showToast('Estoque máximo atingido!', 'error'); return prev }
        return { ...prev, [id]: { ...existing, qty: existing.qty + 1 } }
      }
      return { ...prev, [id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, qty: 1, estoque: p.estoque } }
    })
    showToast(`${p.nome.substring(0, 40)} adicionado ao carrinho`)
  }, [showToast])

  const removeFromCart = useCallback((id) => {
    setCart(prev => {
      const item = prev[id]
      if (!item) return prev
      if (item.qty <= 1) { const { [id]: _, ...rest } = prev; return rest }
      return { ...prev, [id]: { ...item, qty: item.qty - 1 } }
    })
  }, [])

  const deleteFromCart = useCallback((id) => {
    setCart(prev => { const { [id]: _, ...rest } = prev; return rest })
  }, [])

  const iniciarCheckout = () => {
    setCustomer({
      nome: currentUser?.nome || '',
      email: currentUser?.email || '',
      telefone: currentUser?.telefone || '',
      senha: '',
      endereco: currentUser?.endereco || { cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' }
    })
    setPagamento('aprazo')
    setCheckout(currentUser ? 'payment' : 'info')
    setCartOpen(false)
  }

  const buildOrderLink = (orderId) => `${window.location.origin}${window.location.pathname}?pedido=${orderId}`

  const buildWhatsAppMsg = (order) => {
    const link = buildOrderLink(order.id)
    const nome = order.customer?.nome || 'Cliente'
    const id = `#${order.id.toString().slice(-6)}`
    const msgItems = order.items.map(i => `  • ${i.nome} (${i.qty}x) — R$ ${i.preco.toFixed(2)}`).join('\n')
    const msgPagamento = order.pagamento === 'aprazo' ? 'A Prazo' : 'À Vista'
    const msgStatus = order.status === 'pendente' ? '✅ Aguardando confirmação' : order.status === 'pre-pedido' ? '⏳ Pré-pedido aguardando aprovação' : order.status
    return `🆕 *NOVO PEDIDO* 🆕\n━━━━━━━━━━━━━━━━━━\n📋 Pedido: ${id}\n📅 Data: ${order.date}\n👤 Cliente: ${nome}\n📞 Telefone: ${order.customer?.telefone || '-'}\n📍 Endereço: ${order.customer?.endereco?.rua || '-'}, ${order.customer?.endereco?.numero || '-'} - ${order.customer?.endereco?.bairro || '-'}, ${order.customer?.endereco?.cidade || '-'}/${order.customer?.endereco?.estado || '-'}\n━━━━━━━━━━━━━━━━━━\n💳 Pagamento: ${msgPagamento}\n💰 Total: R$ ${order.total.toFixed(2)}\n━━━━━━━━━━━━━━━━━━\n📦 *ITENS:*\n${msgItems}\n━━━━━━━━━━━━━━━━━━\n📌 Status: ${msgStatus}\n🔗 Acesse o pedido: ${link}`
  }

  const sendOrderWebhook = (order) => {
    fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'atualizacao-pedido',
        whatsappMessage: buildWhatsAppMsg(order),
        order: {
          id: order.id,
          date: order.date,
          status: order.status,
          pagamento: order.pagamento,
          total: order.total,
          totalAvista: order.totalAvista,
          totalAprazo: order.totalAprazo,
          customer: order.customer,
          items: order.items.map(i => ({ nome: i.nome, qty: i.qty, preco: i.preco, tipo: i.tipo, foto: i.foto }))
        }
      })
    }).catch(() => {})
  }

  const finalizarCheckout = () => {
    if (!autoLoginOuRegistro()) { showToast('Erro ao identificar usuário', 'error'); return }
    const items = cartItems.map(i => ({ ...i, tipo: 'aprazo' }))
    const total = items.reduce((s, i) => s + i.preco * i.qty, 0)
    const order = {
      id: Date.now(),
      user_id: currentUser?.id || null,
      date: new Date().toISOString().split('T')[0],
      customer: { nome: customer.nome, email: customer.email, telefone: customer.telefone, endereco: customer.endereco },
      items,
      pagamento: 'aprazo',
      total_avista: 0,
      total_aprazo: total,
      total,
      status: 'pre-pedido',
      pre_approved_at: null,
      created_at: new Date().toISOString()
    }
    const existing = JSON.parse(localStorage.getItem(LS_ORDERS) || '[]')
    localStorage.setItem(LS_ORDERS, JSON.stringify([order, ...existing]))
    upsertOrder({ ...order, user_id: currentUser?.id || order.user_id })
    setCart({})
    setCheckout(null)
    showToast('Pedido enviado com sucesso!')
    navigate('/minha-conta')
    sendOrderWebhook(order)
  }

  const formatPhone = (v) => {
    const nums = v.replace(/\D/g, '').slice(0, 11)
    if (nums.length <= 2) return `(${nums}`
    if (nums.length <= 7) return `(${nums.slice(0, 2)}) ${nums.slice(2)}`
    return `(${nums.slice(0, 2)}) ${nums.slice(2, 7)}-${nums.slice(7)}`
  }

  // Admin & UserDash views
  if (route === 'admin' && adminAuth?.loggedIn) return <Admin produtos={produtos} onVoltar={() => { navigate('/'); localStorage.removeItem(LS_ADMIN); setAdminAuth(null) }} />
  if (route === 'userdash') return <UserDashboard produtos={produtos} onVoltar={() => navigate('/')} initialOrderId={initialOrderId} />

  return (
    <div className="app">
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <i className={`fa-solid ${toast.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}`}></i>
          {toast.msg}
        </div>
      )}

      {/* HEADER */}
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="brand-icon" onDoubleClick={() => setShowAdminLogin(true)} title="Admin"><img src="/thsmdistribuidora.webp" alt="THSM" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '6px' }} /></div>
            <div>
              <h1>THSM Distribuidora</h1>
              <span className="header-sub">Catálogo de Produtos</span>
            </div>
          </div>
          <div className="header-actions">
            {currentUser ? (
              <div className="user-menu">
                <button className="user-btn" onClick={() => navigate('/minha-conta')} title="Meus Pedidos">
                  <i className="fa-solid fa-user"></i>
                  <span className="user-name">{currentUser.nome.split(' ')[0]}</span>
                </button>
                <button className="user-logout" onClick={logout} title="Sair">
                  <i className="fa-solid fa-right-from-bracket"></i>
                </button>
              </div>
            ) : (
              <button className="user-btn" onClick={() => setShowLogin(true)} title="Entrar">
                <i className="fa-solid fa-user"></i>
                <span className="user-name">Entrar</span>
              </button>
            )}
            <button className="cart-btn" onClick={() => setCartOpen(true)}>
              <i className="fa-solid fa-bag-shopping"></i>
              {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
            </button>
          </div>
        </div>
        {currentUser?.endereco?.cidade && (
          <div className="header-address-row">
            <button className="header-address-btn" onClick={() => { setAddressEditEndereco({ cep: currentUser.endereco.cep || '', estado: currentUser.endereco.estado || '', cidade: currentUser.endereco.cidade || '', bairro: currentUser.endereco.bairro || '', rua: currentUser.endereco.rua || '', numero: currentUser.endereco.numero || '', complemento: currentUser.endereco.complemento || '' }); setShowAddressEdit(true) }} title="Alterar endereço">
              <i className="fa-solid fa-location-dot"></i>
              <span>{currentUser.endereco.cidade}{currentUser.endereco.bairro ? `, ${currentUser.endereco.bairro}` : ''}</span>
            </button>
          </div>
        )}
      </header>

      {/* FILTERS */}
      <div className="filters-bar">
        <div className="filters-inner">
          <div className="search-box">
            <i className="fa-solid fa-magnifying-glass"></i>
            <input type="text" placeholder="Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button className="search-clear" onClick={() => setSearch('')}><i className="fa-solid fa-xmark"></i></button>}
          </div>
          <button className={`toggle-filters ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)}>
            <i className="fa-solid fa-sliders"></i> Filtros
          </button>
          <div className="sort-box">
            <i className="fa-solid fa-arrow-down-wide-short"></i>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="nome-asc">Nome A-Z</option>
              <option value="nome-desc">Nome Z-A</option>
              <option value="preco-asc">Menor Preço</option>
              <option value="preco-desc">Maior Preço</option>
            </select>
          </div>
          <span className="result-count">{filtered.length} produto{filtered.length !== 1 ? 's' : ''}</span>
        </div>
        {showFilters && (
          <div className="filters-extended">
            <div className="filters-extended-inner">
              <div className="filter-group">
                <label><i className="fa-solid fa-tag"></i> Categoria</label>
                <div className="category-pills">
                  {categorias.slice(0, 8).map(cat => (
                    <button key={cat} className={`pill ${categoria === cat ? 'active' : ''}`} onClick={() => setCategoria(cat)}>{cat}</button>
                  ))}
                  {categorias.length > 8 && (
                    <select className="cat-select" value={categoria} onChange={e => setCategoria(e.target.value)}>
                      {categorias.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  )}
                </div>
              </div>
              <div className="filter-group">
                <label><i className="fa-solid fa-dollar-sign"></i> Faixa de Preço</label>
                <div className="price-range">
                  <input type="range" min={priceMin} max={priceMax} step={1} value={priceRange[0]} onChange={e => setPriceRange([Number(e.target.value), priceRange[1]])} />
                  <input type="range" min={priceMin} max={priceMax} step={1} value={priceRange[1]} onChange={e => setPriceRange([priceRange[0], Number(e.target.value)])} />
                  <div className="price-labels">
                    <span>{formatPreco(priceRange[0])}</span>
                    <span>{formatPreco(priceRange[1])}</span>
                  </div>
                </div>
              </div>
              <div className="filter-group">
                <label className="stock-toggle">
                  <input type="checkbox" checked={onlyInStock} onChange={e => setOnlyInStock(e.target.checked)} />
                  <span className="toggle-track"></span>
                  Apenas em estoque
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* QUICK CATS */}
      <div className="quick-cats">
        {categorias.slice(0, 12).map(cat => (
          <button key={cat} className={`qc-btn ${categoria === cat ? 'active' : ''}`} onClick={() => setCategoria(cat)}>
            {cat === 'TODOS' ? <><i className="fa-solid fa-border-all"></i> Todos</> : cat}
          </button>
        ))}
      </div>

      {/* MAIN */}
      <main className="main">
        {paginated.length === 0 ? (
          <div className="empty">
            <i className="fa-solid fa-box-open"></i>
            <h3>Nenhum produto encontrado</h3>
            <p>Tente ajustar os filtros ou termos de busca</p>
            <button className="btn-clear" onClick={() => { setSearch(''); setCategoria('TODOS'); setPriceRange([priceMin, priceMax]); setOnlyInStock(false); setSortBy('nome-asc') }}>
              <i className="fa-solid fa-rotate"></i> Limpar Filtros
            </button>
          </div>
        ) : (
          <>
            <div className="grid">
              {paginated.map((p, i) => (
                <div key={p.id} className="card" style={{ animationDelay: `${(i % ITEMS_PER_PAGE) * 25}ms` }}>
                  <div className="card-img" onClick={() => setSelected(p)}>
                    {p.imagem && !imageErrors[p.id] ? (
                      <img src={p.imagem} alt={p.nome} loading="lazy" onError={() => handleImageError(p.id)} />
                    ) : (
                      <div className="card-img-fallback"><i className="fa-solid fa-image"></i></div>
                    )}
                    <div className="card-badges">
                      {p.estoque <= 0 ? <span className="badge out">Indisponível</span>
                        : p.estoque <= 5 ? <span className="badge low">Últimas {p.estoque}</span>
                        : <span className="badge in">Disponível</span>}
                    </div>
                    <div className="card-cat-tag">{p.categoria}</div>
                  </div>
                  <div className="card-body">
                    <h3 className="card-title" onClick={() => setSelected(p)}>{p.nome}</h3>
                    <div className="card-price">{formatPreco(p.preco)}</div>
                    <button className={`btn-add ${cart[p.id] ? 'in-cart' : ''}`} onClick={() => addToCart(p)} disabled={p.estoque <= 0}>
                      {cart[p.id] ? <><i className="fa-solid fa-check"></i> Adicionado</> : <><i className="fa-solid fa-plus"></i> Adicionar</>}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="pagination">
                <button className="page-btn" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><i className="fa-solid fa-chevron-left"></i></button>
                <div className="page-numbers">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    let p
                    if (totalPages <= 7) p = i + 1
                    else if (currentPage <= 4) p = i + 1
                    else if (currentPage >= totalPages - 3) p = totalPages - 6 + i
                    else p = currentPage - 3 + i
                    return <button key={p} className={`page-btn num ${currentPage === p ? 'active' : ''}`} onClick={() => setCurrentPage(p)}>{p}</button>
                  })}
                </div>
                <button className="page-btn" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}><i className="fa-solid fa-chevron-right"></i></button>
              </div>
            )}
          </>
        )}
      </main>

      {/* PRODUCT MODAL */}
      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)}><i className="fa-solid fa-xmark"></i></button>
            <div className="modal-img">
              {selected.imagem && !imageErrors[selected.id] ? (
                <img src={selected.imagem} alt={selected.nome} onError={() => handleImageError(selected.id)} />
              ) : (
                <div className="modal-img-fallback"><i className="fa-solid fa-image"></i></div>
              )}
            </div>
            <div className="modal-body">
              <span className="modal-cat">{selected.categoria}</span>
              <h2>{selected.nome}</h2>
              <div className="modal-price">{formatPreco(selected.preco)}</div>
              <div className="modal-stock">
                {selected.estoque > 0
                  ? <span className="stock-ok"><i className="fa-solid fa-circle-check"></i> {selected.estoque} em estoque</span>
                  : <span className="stock-no"><i className="fa-solid fa-circle-xmark"></i> Indisponível</span>}
              </div>
              {selected.descricao && (
                <div className="modal-desc">
                  <h4><i className="fa-solid fa-receipt"></i> Detalhes</h4>
                  <p>{selected.descricao}</p>
                </div>
              )}
              <button className="btn-add modal-add" onClick={() => { addToCart(selected); setSelected(null) }} disabled={selected.estoque <= 0}>
                <i className="fa-solid fa-bag-shopping"></i> Adicionar ao Carrinho
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CART DRAWER */}
      {cartOpen && (
        <div className="overlay cart-overlay" onClick={() => setCartOpen(false)}>
          <div className="cart-drawer active" onClick={e => e.stopPropagation()}>
            <div className="cart-header">
              <h2><i className="fa-solid fa-bag-shopping"></i> Carrinho</h2>
              <button className="cart-close" onClick={() => setCartOpen(false)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            {cartItems.length === 0 ? (
              <div className="cart-empty">
                <i className="fa-solid fa-cart-plus"></i>
                <p>Seu carrinho está vazio</p>
                <span>Adicione produtos do catálogo</span>
              </div>
            ) : (
              <>
                <div className="cart-items">
                  {cartItems.map(item => (
                    <div key={item.id} className="cart-item">
                      <div className="cart-item-img">
                        {item.imagem && !imageErrors[item.id]
                          ? <img src={item.imagem} alt={item.nome} onError={() => handleImageError(item.id)} />
                          : <div className="cart-item-img-fallback"><i className="fa-solid fa-image"></i></div>}
                      </div>
                      <div className="cart-item-info">
                        <p className="cart-item-name">{item.nome}</p>
                        <p className="cart-item-price">{formatPreco(item.preco)}</p>
                      </div>
                      <div className="cart-item-qty">
                        <button className="qty-btn" onClick={() => removeFromCart(item.id)}><i className="fa-solid fa-minus"></i></button>
                        <span>{item.qty}</span>
                        <button className="qty-btn" onClick={() => {
                          if (item.qty >= item.estoque && item.estoque > 0) { showToast('Estoque máximo!', 'error'); return }
                          setCart(prev => ({ ...prev, [item.id]: { ...prev[item.id], qty: prev[item.id].qty + 1 } }))
                        }}><i className="fa-solid fa-plus"></i></button>
                      </div>
                      <div className="cart-item-total">{formatPreco(item.preco * item.qty)}</div>
                      <button className="cart-item-remove" onClick={() => deleteFromCart(item.id)}><i className="fa-solid fa-trash-can"></i></button>
                    </div>
                  ))}
                </div>
                {cartItems.length > 0 && (() => {
                  const cartCats = new Set(cartItems.map(i => i.categoria).filter(Boolean))
                  const related = produtos
                    .filter(p => cartCats.has(p.categoria) && !cart[p.id] && p.preco > 0)
                    .slice(0, 5)
                  if (related.length === 0) return null
                  return (
                    <div className="cart-related">
                      <h4><i className="fa-solid fa-link"></i> Itens Relacionados</h4>
                      {related.map(p => (
                        <div key={p.id} className="cart-related-item">
                          <div className="cart-related-img">
                            {p.imagem
                              ? <img src={p.imagem} alt={p.nome} onError={e => { e.target.style.display = 'none' }} />
                              : <i className="fa-solid fa-box"></i>}
                          </div>
                          <div className="cart-related-info">
                            <span className="cart-related-name">{p.nome}</span>
                            <span className="cart-related-price">{formatPreco(p.preco)}</span>
                          </div>
                          <button className="cart-related-add" onClick={() => {
                            setCart(prev => ({ ...prev, [p.id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, foto: p.foto, estoque: p.estoque, categoria: p.categoria, qty: 1 } }))
                            showToast(`${p.nome} adicionado ao carrinho!`, 'success')
                          }}><i className="fa-solid fa-plus"></i></button>
                        </div>
                      ))}
                    </div>
                  )
                })()}
                <div className="cart-footer">
                  <div className="cart-summary">
                    <span>Total</span>
                    <span className="cart-summary-price">{formatPreco(cartTotal)}</span>
                  </div>
                  <button className="btn-next" onClick={iniciarCheckout} style={{ width: '100%' }}>
                    <i className="fa-solid fa-bag-shopping"></i> Finalizar Pedido
                  </button>
                  <button className="btn-clear-cart" onClick={() => { setCart({}); showToast('Carrinho limpo', 'success') }}>
                    <i className="fa-solid fa-trash-can"></i> Limpar Carrinho
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* CHECKOUT MODAL */}
      {checkout && (
        <div className="overlay" onClick={() => setCheckout(null)}>
          <div className="modal checkout-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setCheckout(null)}><i className="fa-solid fa-xmark"></i></button>
            <div className="checkout-steps">
              <span className={`step ${checkout === 'info' ? 'active' : ''} ${checkout !== 'info' ? 'done' : ''}`}>1. Dados</span>
              <span className={`step ${checkout === 'payment' ? 'active' : ''} ${checkout === 'review' ? 'done' : ''}`}>2. Pagamento</span>
              <span className={`step ${checkout === 'review' ? 'active' : ''}`}>3. Revisar</span>
            </div>

            {checkout === 'info' && (
              <div className="checkout-form">
                <h3><i className="fa-solid fa-user"></i> Dados do Cliente</h3>
                {currentUser && <p className="logged-msg"><i className="fa-solid fa-check-circle"></i> Logado como {currentUser.email}</p>}
                <div className="form-group">
                  <label>Nome completo *</label>
                  <input type="text" placeholder="Seu nome" value={customer.nome} onChange={e => setCustomer({ ...customer, nome: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Email * <small>(usado para identificar sua conta)</small></label>
                  <input type="text" inputMode="email" placeholder="seu@email.com" value={customer.email} onChange={e => setCustomer({ ...customer, email: e.target.value })} disabled={!!currentUser} />
                </div>
                <div className="form-group">
                  <label>Telefone / WhatsApp *</label>
                  <input type="text" placeholder="(31) 99999-9999" value={customer.telefone} onChange={e => setCustomer({ ...customer, telefone: formatPhone(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Endereço de entrega</label>
                  <AddressForm value={customer.endereco} onChange={(addr) => setCustomer({ ...customer, endereco: addr })} />
                </div>
                {!currentUser && (
                  <div className="form-group">
                    <label>Senha <small>(escolha uma senha para sua conta)</small></label>
                    <input type="password" placeholder="Sua senha" value={customer.senha} onChange={e => setCustomer({ ...customer, senha: e.target.value })} />
                  </div>
                )}
                <p className="info-msg"><i className="fa-solid fa-info-circle"></i> Ao continuar, você cria ou acessa sua conta automaticamente.</p>
                <button className="btn-next" disabled={!customer.nome.trim() || !customer.email.trim() || !customer.telefone.trim()} onClick={() => { if (autoLoginOuRegistro()) setCheckout('payment') }}>
                  Continuar <i className="fa-solid fa-arrow-right"></i>
                </button>
              </div>
            )}

            {checkout === 'payment' && (
              <div className="checkout-form">
                <h3><i className="fa-solid fa-credit-card"></i> Forma de Pagamento</h3>
                <div className="payment-options">
                  {[
                    { id: 'aprazo', icon: 'fa-calendar', label: 'A Prazo', desc: 'Pagar depois (no acerto)' },
                  ].map(p => (
                    <label key={p.id} className={`payment-option ${pagamento === p.id ? 'selected' : ''}`}>
                      <input type="radio" name="pagamento" value={p.id} checked={pagamento === p.id} onChange={() => setPagamento(p.id)} />
                      <div className="payment-content">
                        <i className={`fa-solid ${p.icon}`}></i>
                        <div>
                          <strong>{p.label}</strong>
                          <span>{p.desc}</span>
                        </div>
                        <span className="payment-tag">{formatPreco(cartTotal)}</span>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="checkout-nav">
                  <button className="btn-back" onClick={() => setCheckout('info')}><i className="fa-solid fa-arrow-left"></i> Voltar</button>
                  <button className="btn-next" onClick={() => setCheckout('review')}>Revisar Pedido <i className="fa-solid fa-arrow-right"></i></button>
                </div>
              </div>
            )}

            {checkout === 'review' && (
              <div className="checkout-form">
                <h3><i className="fa-solid fa-check-circle"></i> Revisar Pedido</h3>
                <div className="review-section">
                  <h4><i className="fa-solid fa-user"></i> Cliente</h4>
                  <p><strong>Nome:</strong> {customer.nome}</p>
                  <p><strong>Email:</strong> {customer.email}</p>
                  <p><strong>Telefone:</strong> {customer.telefone}</p>
                  {customer.endereco?.cidade && <p><strong>Endereço:</strong> {[customer.endereco.rua, customer.endereco.numero, customer.endereco.bairro, customer.endereco.cidade, customer.endereco.estado].filter(Boolean).join(', ')}</p>}
                </div>
                <div className="review-section">
                  <h4><i className="fa-solid fa-box"></i> Itens</h4>
                  {cartItems.map(item => {
                    return (
                      <div key={item.id} className="review-item">
                        <span className="review-item-name">{item.nome} <span className="review-item-qty">({item.qty}x)</span></span>
                        <div className="review-item-right">
                          <span className="review-item-price">{formatPreco(item.preco * item.qty)}</span>
                          <span className="review-item-tag aprazo">A Prazo</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="review-section">
                  <h4><i className="fa-solid fa-credit-card"></i> Pagamento</h4>
                  <p className="review-payment">
                    {pagamento === 'avista' && '💵 Pagamento à vista'}
                    {pagamento === 'aprazo' && '📋 Pagamento a prazo'}
                    {pagamento === 'misto' && '💵 Misto (parte à vista, parte a prazo)'}
                  </p>
                </div>
                <div className="review-total">
                  <span>Total Geral</span>
                  <span className="review-total-price">{formatPreco(cartTotal)}</span>
                </div>
                <div className="checkout-nav">
                  <button className="btn-back" onClick={() => setCheckout('payment')}><i className="fa-solid fa-arrow-left"></i> Voltar</button>
                  <button className="btn-next" onClick={finalizarCheckout}>
                    <i className="fa-solid fa-check"></i> Confirmar Pedido
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADMIN LOGIN MODAL */}
      {showAdminLogin && (
        <div className="overlay" onClick={() => setShowAdminLogin(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '380px' }}>
            <button className="modal-close" onClick={() => setShowAdminLogin(false)}><i className="fa-solid fa-xmark"></i></button>
            <div className="modal-body" style={{ textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem' }}>
                <i className="fa-solid fa-crown" style={{ color: '#f59e0b', fontSize: '1.3rem' }}></i>
              </div>
              <h2 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>Acesso Administrativo</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>Informe suas credenciais</p>
              <div className="form-group" style={{ textAlign: 'left' }}>
                <label>Usuário</label>
                <input type="text" placeholder="thsmadmin" value={adminUser} onChange={e => setAdminUser(e.target.value)} />
              </div>
              <div className="form-group" style={{ textAlign: 'left' }}>
                <label>Senha</label>
                <input type="password" placeholder="••••••••" value={adminPass} onChange={e => setAdminPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && loginAdmin()} />
              </div>
              <button className="btn-next" style={{ width: '100%', marginTop: '0.5rem' }} disabled={!adminUser || !adminPass} onClick={loginAdmin}>
                <i className="fa-solid fa-lock-open"></i> Entrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LOGIN MODAL */}
      {showLogin && (
        <div className="overlay" onClick={() => setShowLogin(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <button className="modal-close" onClick={() => setShowLogin(false)}><i className="fa-solid fa-xmark"></i></button>
            <div className="modal-body">
              <h2 style={{ textAlign: 'center', marginBottom: '0.25rem' }}>
                <i className="fa-solid fa-user-circle" style={{ color: 'var(--accent)' }}></i>
              </h2>
              <h2 style={{ textAlign: 'center', fontSize: '1.2rem' }}>{isRegistering ? 'Criar Conta' : 'Entrar'}</h2>
              <p style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                {isRegistering ? 'Crie sua conta com telefone e senha.' : 'Entre com seu telefone e senha.'}
              </p>
              <div className="form-group">
                <label>Telefone / Email</label>
                <input type="text" inputMode="email" placeholder="(31) 99999-9999 ou email" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Senha</label>
                <input type="password" placeholder="Sua senha" value={loginSenha} onChange={e => setLoginSenha(e.target.value)} />
              </div>
              {isRegistering && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  <i className="fa-solid fa-info-circle"></i> Escolha uma senha para sua conta
                </p>
              )}
              <button className="btn-next" style={{ width: '100%', marginTop: '0.5rem' }} disabled={!loginEmail || !loginSenha} onClick={isRegistering ? fazerRegistro : fazerLogin}>
                {isRegistering ? 'Criar Conta' : 'Entrar'}
              </button>
              <p style={{ textAlign: 'center', marginTop: '0.85rem', fontSize: '0.82rem' }}>
                {isRegistering ? 'Já tem conta?' : 'Não tem conta?'}{' '}
                <button onClick={() => setIsRegistering(!isRegistering)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', fontSize: '0.82rem' }}>
                  {isRegistering ? 'Faça login' : 'Cadastre-se'}
                </button>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ADDRESS REQUIRED MODAL */}
      {showAddressRequired && (
        <div className="overlay">
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-body">
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--warning-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem' }}>
                  <i className="fa-solid fa-location-dot" style={{ fontSize: '1.4rem', color: 'var(--warning)' }}></i>
                </div>
                <h2 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>Endereço Obrigatório</h2>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Para continuar, cadastre seu endereço de entrega.</p>
              </div>
              <AddressForm value={addressRequiredEndereco} onChange={(addr) => setAddressRequiredEndereco(addr)} />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
                <button className="btn-next" style={{ flex: 1, justifyContent: 'center' }} disabled={savingAddress || !addressRequiredEndereco.cep || !addressRequiredEndereco.cidade || !addressRequiredEndereco.rua || !addressRequiredEndereco.numero} onClick={saveRequiredAddress}>
                  {savingAddress ? <><i className="fa-solid fa-spinner fa-spin"></i> Salvando...</> : <><i className="fa-solid fa-check"></i> Salvar e Continuar</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADDRESS EDIT MODAL */}
      {showAddressEdit && (
        <div className="overlay" onClick={() => setShowAddressEdit(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <button className="modal-close" onClick={() => setShowAddressEdit(false)}><i className="fa-solid fa-xmark"></i></button>
            <div className="modal-body">
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--warning-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem' }}>
                  <i className="fa-solid fa-location-dot" style={{ fontSize: '1.4rem', color: 'var(--warning)' }}></i>
                </div>
                <h2 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>Alterar Endereço</h2>
              </div>
              <AddressForm value={addressEditEndereco} onChange={(addr) => setAddressEditEndereco(addr)} />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.25rem' }}>
                <button className="btn-next" style={{ flex: 1, justifyContent: 'center' }} disabled={savingAddress || !addressEditEndereco.cep || !addressEditEndereco.cidade || !addressEditEndereco.rua || !addressEditEndereco.numero} onClick={saveAddressEdit}>
                  {savingAddress ? <><i className="fa-solid fa-spinner fa-spin"></i> Salvando...</> : <><i className="fa-solid fa-check"></i> Salvar</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mobile user bottom nav (always on when logged in) */}
      {currentUser && (
        <div className="mobile-user-nav">
          <button className="mobile-user-item" onClick={() => navigate('/minha-conta')}>
            <i className="fa-solid fa-clipboard-list"></i>
            <span>Pedidos</span>
          </button>
          <button className="mobile-user-item" onClick={() => navigate('/minha-conta')}>
            <i className="fa-solid fa-coins"></i>
            <span>Financeiro</span>
          </button>
          <button className="mobile-user-item" onClick={logout}>
            <i className="fa-solid fa-right-from-bracket"></i>
            <span>Sair</span>
          </button>
        </div>
      )}

      {/* Mobile cart sticky footer (above user nav when both visible) */}
      {cartCount > 0 && (
        <div className="mobile-cart-bar">
          <div className="mobile-cart-info">
            <span className="mobile-cart-count"><i className="fa-solid fa-bag-shopping"></i> {cartCount} {cartCount === 1 ? 'item' : 'itens'}</span>
            <span className="mobile-cart-total">{formatPreco(cartTotal)}</span>
          </div>
          <button className="mobile-cart-btn" onClick={() => setCartOpen(true)}>
            Ver Carrinho <i className="fa-solid fa-arrow-right"></i>
          </button>
        </div>
      )}
    </div>
  )
}

export default App
