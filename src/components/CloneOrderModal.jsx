import React, { useState, useMemo } from 'react'
import { searchMatches, clientMatchesSearch } from '../lib/search'
import AddressForm from './AddressForm'

function formatPreco(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`
}

function hoje() {
  return new Date().toISOString().split('T')[0]
}

function cleanDecimalInput(val) {
  if (val == null) return ''
  let str = String(val).replace(/\./g, ',').replace(/[^0-9,]/g, '')
  const parts = str.split(',')
  if (parts.length > 2) {
    str = parts[0] + ',' + parts.slice(1).join('')
  }
  return str
}

function parseDecimalToNumber(val) {
  if (val == null || val === '') return 0
  const clean = String(val).replace(/\s/g, '').replace(',', '.')
  const num = parseFloat(clean)
  return isNaN(num) ? 0 : num
}



function getOrderRawItems(ord) {
  if (!ord) return []
  if (Array.isArray(ord.items) && ord.items.length > 0) return ord.items
  if (Array.isArray(ord.originalItems) && ord.originalItems.length > 0) return ord.originalItems
  if (Array.isArray(ord.itens) && ord.itens.length > 0) return ord.itens
  return []
}

export default function CloneOrderModal({ originalOrder, usuarios = [], produtos = [], onSave, onClose }) {
  const produtosAtuais = produtos || []

  // 1. Status Inicial e Datas
  const [status, setStatus] = useState('pendente')
  const [date, setDate] = useState(hoje())
  const [dataVencimento, setDataVencimento] = useState(() => {
    if (originalOrder?.dataVencimento) return originalOrder.dataVencimento
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [notificarWhatsApp, setNotificarWhatsApp] = useState(originalOrder?.notificarWhatsApp !== false)

  // 2. Cliente
  const origCustomer = originalOrder?.customer || {}
  const origEnd = origCustomer.endereco || {}

  const [clientMode, setClientMode] = useState('keep') // 'keep' | 'search' | 'new'
  const [userSearch, setUserSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)

  const [nome, setNome] = useState(origCustomer.nome || originalOrder?.nome || '')
  const [telefone, setTelefone] = useState(origCustomer.telefone || originalOrder?.telefone || '')
  const [cpf, setCpf] = useState(origCustomer.cpf || '')
  const [endereco, setEndereco] = useState({
    cep: origEnd.cep || '',
    estado: origEnd.estado || '',
    cidade: origEnd.cidade || originalOrder?.cidade || '',
    bairro: origEnd.bairro || '',
    rua: origEnd.rua || origEnd.logradouro || '',
    numero: origEnd.numero || '',
    complemento: origEnd.complemento || '',
    rota: origEnd.rota || originalOrder?.rota || ''
  })

  // 3. Itens
  const [items, setItems] = useState(() => {
    const raw = getOrderRawItems(originalOrder)
    return raw.map((i, idx) => {
      const p = (i.preco != null && i.preco !== '') ? String(i.preco).replace('.', ',') : '0'
      const c = (i.preco_custo != null && i.preco_custo !== '') ? String(i.preco_custo).replace('.', ',') : ''
      return {
        ...i,
        _tempKey: `orig_${idx}_${Date.now()}`,
        qty: Number(i.qty) || 1,
        preco: p,
        preco_custo: c,
        tipo: i.tipo || 'avista'
      }
    })
  })

  // Busca de catálogo para adicionar itens
  const [addSearch, setAddSearch] = useState('')

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return []
    return (usuarios || []).filter(u => clientMatchesSearch(u, userSearch)).slice(0, 30)
  }, [usuarios, userSearch])

  const filteredCatalogProds = useMemo(() => {
    if (!addSearch.trim()) return []
    return (produtosAtuais || []).filter(p => searchMatches(p.nome, addSearch) || searchMatches(p.displayName, addSearch) || searchMatches(p.categoria, addSearch)).slice(0, 20)
  }, [produtosAtuais, addSearch])

  const handlePickUser = (u) => {
    if (!u) return
    setSelectedUser(u)
    const end = u.endereco || {}
    setNome(u.nome || '')
    setTelefone(u.telefone || '')
    setCpf(u.cpf || end.cpf || '')
    setEndereco({
      cep: end.cep || '',
      estado: end.estado || '',
      cidade: end.cidade || u.cidade || '',
      bairro: end.bairro || '',
      rua: end.rua || end.logradouro || '',
      numero: end.numero || '',
      complemento: end.complemento || '',
      rota: end.rota || u.rota || ''
    })
    setUserSearch('')
  }

  const handleSwitchMode = (mode) => {
    setClientMode(mode)
    if (mode === 'keep') {
      setSelectedUser(null)
      setNome(origCustomer.nome || originalOrder?.nome || '')
      setTelefone(origCustomer.telefone || originalOrder?.telefone || '')
      setCpf(origCustomer.cpf || '')
      setEndereco({
        cep: origEnd.cep || '',
        estado: origEnd.estado || '',
        cidade: origEnd.cidade || originalOrder?.cidade || '',
        bairro: origEnd.bairro || '',
        rua: origEnd.rua || origEnd.logradouro || '',
        numero: origEnd.numero || '',
        complemento: origEnd.complemento || '',
        rota: origEnd.rota || originalOrder?.rota || ''
      })
    } else if (mode === 'new') {
      setSelectedUser(null)
      setNome('')
      setTelefone('')
      setCpf('')
      setEndereco({ cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '', rota: '' })
    }
  }

  const updateItem = (index, field, value) => {
    setItems(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const removeItem = (index) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const handleAddProductFromCatalog = (prod) => {
    if (!prod) return
    const cost = (prod.preco_custo != null && prod.preco_custo !== '') ? String(prod.preco_custo).replace('.', ',') : ''
    const price = (prod.preco != null && prod.preco !== '') ? String(prod.preco).replace('.', ',') : '0'
    const newItem = {
      id: prod.id,
      _tempKey: `add_${Date.now()}_${Math.random()}`,
      nome: prod.nome || prod.displayName || 'Produto',
      displayName: prod.displayName || prod.nome || 'Produto',
      qty: 1,
      preco: price,
      preco_custo: cost,
      tipo: 'avista'
    }
    setItems(prev => [...prev, newItem])
    setAddSearch('')
  }

  // Cálculos em tempo real
  const totalPieces = items.reduce((s, i) => s + (Number(i.qty) || 0), 0)
  const totalAvista = items.filter(i => i.tipo === 'avista').reduce((s, i) => s + (parseDecimalToNumber(i.preco) * (Number(i.qty) || 0)), 0)
  const totalAprazo = items.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + (parseDecimalToNumber(i.preco) * (Number(i.qty) || 0)), 0)
  const totalGeral = Math.round((totalAvista + totalAprazo) * 100) / 100

  const handleConfirm = () => {
    if (!nome.trim()) {
      alert('Por favor, informe o nome do cliente.')
      return
    }
    if (!telefone.trim()) {
      alert('Por favor, informe o telefone do cliente.')
      return
    }
    if (items.length === 0 || totalPieces === 0) {
      alert('O pedido duplicado precisa ter pelo menos 1 item com quantidade maior que zero.')
      return
    }

    const cleanCustomer = {
      id: selectedUser?.id || (clientMode === 'keep' ? (origCustomer.id || originalOrder?.user_id) : null),
      nome: nome.trim(),
      telefone: telefone.trim(),
      cpf: cpf.trim(),
      endereco: {
        ...endereco,
        cidade: endereco.cidade?.trim() || '',
        rota: endereco.rota?.trim() || ''
      }
    }

    const resolvedItems = items.filter(i => (Number(i.qty) || 0) > 0).map(i => {
      const p = parseDecimalToNumber(i.preco)
      const c = (i.preco_custo != null && i.preco_custo !== '') ? parseDecimalToNumber(i.preco_custo) : null
      return {
        id: i.id || `item_${Date.now()}_${Math.random()}`,
        nome: i.nome || i.displayName || 'Produto',
        displayName: i.displayName || i.nome || 'Produto',
        qty: Number(i.qty) || 1,
        preco: p,
        preco_custo: c,
        tipo: i.tipo || 'avista'
      }
    })

    onSave({
      origemId: originalOrder.id,
      customer: cleanCustomer,
      status,
      date,
      dataVencimento: totalAprazo > 0 ? (dataVencimento || null) : null,
      notificarWhatsApp,
      items: resolvedItems,
      isNovoCliente: clientMode === 'new'
    })
  }

  return (
    <div className="admin-overlay">
      <div className="admin-modal admin-modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '820px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* HEADER */}
        <div className="admin-modal-header" style={{ padding: '0.85rem 1.25rem' }}>
          <div>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, fontSize: '1.15rem' }}>
              <i className="fa-solid fa-copy" style={{ color: '#8b5cf6' }}></i>
              Duplicar / Clonar Pedido #{String(originalOrder.id).slice(-6)}
            </h3>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>
              Personalize o cliente, itens e etapa inicial para criar a nova comanda
            </p>
          </div>
          <button className="admin-modal-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>

        {/* BODY */}
        <div className="admin-modal-body" style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>

          {/* SEÇÃO 1: CONFIGURAÇÃO DE ETAPA E DATAS */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <i className="fa-solid fa-flag" style={{ color: '#8b5cf6' }}></i> Etapa inicial da nova comanda:
              </span>

              {/* SWITCH WHATSAPP */}
              <label
                className={`action-zap-switch ${notificarWhatsApp ? 'zap-on' : 'zap-off'}`}
                title={notificarWhatsApp ? 'Envio de WhatsApp ativado para este pedido' : 'Envio de WhatsApp desativado'}
                style={{ fontSize: '0.75rem', padding: '0.25rem 0.55rem' }}
              >
                <input
                  type="checkbox"
                  checked={notificarWhatsApp}
                  onChange={e => setNotificarWhatsApp(e.target.checked)}
                  style={{ display: 'none' }}
                />
                <i className="fa-brands fa-whatsapp"></i>
                <span>{notificarWhatsApp ? 'Disparo Zap: ON' : 'Disparo Zap: OFF'}</span>
              </label>
            </div>

            {/* STATUS CHIPS */}
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {[
                { id: 'pendente', label: 'Pendente (Padrão)' },
                { id: 'pre-pedido', label: 'Pré-Pedido' },
                { id: 'confirmado', label: 'Confirmado' },
                { id: 'em-andamento', label: 'Em Andamento' },
                { id: 'em-rota', label: 'Em Rota' },
                { id: 'entregue', label: 'Entregue' },
                { id: 'acerto', label: 'Acerto' },
                { id: 'calote_parcial', label: 'Calote Parcial' },
                { id: 'concluido', label: 'Concluído' }
              ].map(s => (
                <button
                  key={s.id}
                  type="button"
                  className={`pag-chip ${status === s.id ? 'active' : ''}`}
                  onClick={() => setStatus(s.id)}
                  style={{ fontSize: '0.76rem', padding: '0.3rem 0.65rem' }}
                >
                  {status === s.id && <i className="fa-solid fa-check" style={{ marginRight: '4px' }}></i>}
                  {s.label}
                </button>
              ))}
            </div>

            {/* DATAS ROW */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '140px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: '#475569' }}>
                  <i className="fa-solid fa-calendar-day"></i> Data do Novo Pedido
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', background: 'white' }}
                />
              </div>

              {totalAprazo > 0 && (
                <div style={{ flex: 1, minWidth: '140px' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.25rem', color: '#b45309' }}>
                    <i className="fa-solid fa-calendar-check"></i> Vencimento das Contas a Prazo
                  </label>
                  <input
                    type="date"
                    value={dataVencimento}
                    onChange={e => setDataVencimento(e.target.value)}
                    style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid #fde68a', fontSize: '0.82rem', background: '#fffbeb' }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* SEÇÃO 2: CLIENTE (MANTER / TROCAR / CADASTRAR NOVO) */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <i className="fa-solid fa-user" style={{ color: '#8b5cf6' }}></i> Cliente do Pedido:
              </span>

              {/* TABS DE MODO DE CLIENTE */}
              <div style={{ display: 'inline-flex', background: '#e2e8f0', padding: '2px', borderRadius: '8px' }}>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('keep')}
                  style={{
                    border: 'none',
                    padding: '0.25rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: clientMode === 'keep' ? 'white' : 'transparent',
                    color: clientMode === 'keep' ? '#8b5cf6' : '#64748b',
                    boxShadow: clientMode === 'keep' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  <i className="fa-solid fa-user-check"></i> Manter Original
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('search')}
                  style={{
                    border: 'none',
                    padding: '0.25rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: clientMode === 'search' ? 'white' : 'transparent',
                    color: clientMode === 'search' ? '#8b5cf6' : '#64748b',
                    boxShadow: clientMode === 'search' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  <i className="fa-solid fa-magnifying-glass"></i> Trocar Cliente
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('new')}
                  style={{
                    border: 'none',
                    padding: '0.25rem 0.6rem',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: clientMode === 'new' ? 'white' : 'transparent',
                    color: clientMode === 'new' ? '#8b5cf6' : '#64748b',
                    boxShadow: clientMode === 'new' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                  }}
                >
                  <i className="fa-solid fa-user-plus"></i> Novo Cliente
                </button>
              </div>
            </div>

            {/* CONTEÚDO DA ESCOLHA DO CLIENTE */}
            {clientMode === 'keep' && (
              <div style={{ background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.65rem 0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <div>
                    <strong style={{ fontSize: '0.92rem', color: '#1e293b' }}>{nome || 'Sem nome'}</strong>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.15rem' }}>
                      <i className="fa-brands fa-whatsapp" style={{ color: '#16a34a' }}></i> {formatPhone(telefone) || 'Sem telefone'}
                      {endereco?.cidade && ` • ${endereco.cidade}`}
                      {endereco?.rota && ` • Rota: ${endereco.rota}`}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.72rem', background: '#f3e8ff', color: '#7e22ce', padding: '0.2rem 0.5rem', borderRadius: '6px', fontWeight: 600 }}>
                    Mesmo cliente do pedido #{String(originalOrder.id).slice(-6)}
                  </span>
                </div>
              </div>
            )}

            {clientMode === 'search' && (
              <div>
                <div style={{ position: 'relative', marginBottom: '0.5rem' }}>
                  <i className="fa-solid fa-magnifying-glass" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}></i>
                  <input
                    type="text"
                    placeholder="Digite nome, telefone, cidade ou documento..."
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem 0.6rem 0.45rem 2.1rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', background: 'white' }}
                    autoFocus
                  />
                </div>

                {selectedUser && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '0.6rem 0.75rem', marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#166534' }}>{selectedUser.nome}</div>
                      <div style={{ fontSize: '0.75rem', color: '#15803d' }}>
                        {formatPhone(selectedUser.telefone)} {selectedUser.endereco?.cidade ? `• ${selectedUser.endereco.cidade}` : ''} {selectedUser.rota ? `• Rota: ${selectedUser.rota}` : ''}
                      </div>
                    </div>
                    <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#166534', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
                      <i className="fa-solid fa-check"></i> Selecionado
                    </span>
                  </div>
                )}

                {userSearch && filteredUsers.length > 0 && (
                  <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '6px', background: 'white', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
                    {filteredUsers.map((u, i) => (
                      <div
                        key={u.id || i}
                        onClick={() => handlePickUser(u)}
                        style={{ padding: '0.45rem 0.65rem', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'background 100ms' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}
                      >
                        <div>
                          <strong>{u.nome}</strong>
                          <span style={{ color: '#64748b', marginLeft: '0.5rem' }}>{formatPhone(u.telefone)}</span>
                          {u.endereco?.cidade && <span style={{ color: '#94a3b8', marginLeft: '0.4rem' }}>({u.endereco.cidade})</span>}
                        </div>
                        <span style={{ color: '#8b5cf6', fontWeight: 600, fontSize: '0.72rem' }}>Selecionar</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {clientMode === 'new' && (
              <div style={{ background: 'white', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem', marginBottom: '0.6rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, marginBottom: '0.2rem' }}>Nome Completo *</label>
                    <input
                      type="text"
                      placeholder="Nome do cliente"
                      value={nome}
                      onChange={e => setNome(e.target.value)}
                      style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, marginBottom: '0.2rem' }}>Telefone / WhatsApp *</label>
                    <input
                      type="text"
                      placeholder="(31) 99999-9999"
                      value={formatPhone(telefone)}
                      onChange={e => setTelefone(e.target.value)}
                      style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.74rem', fontWeight: 600, marginBottom: '0.2rem' }}>CPF (Opcional)</label>
                    <input
                      type="text"
                      placeholder="000.000.000-00"
                      value={cpf}
                      onChange={e => setCpf(e.target.value)}
                      style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
                    />
                  </div>
                </div>

                <AddressForm value={endereco} onChange={a => setEndereco(a)} requiredFields={false} />
              </div>
            )}
          </div>

          {/* SEÇÃO 3: PRODUTOS / ITENS */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <i className="fa-solid fa-boxes-stacked" style={{ color: '#8b5cf6' }}></i> Itens Clonados ({items.length} produtos / {totalPieces} peças):
              </span>

              {/* BUSCADOR DE PRODUTOS PARA ADICIONAR */}
              <div style={{ position: 'relative', minWidth: '220px' }}>
                <input
                  type="text"
                  placeholder="＋ Adicionar outro produto..."
                  value={addSearch}
                  onChange={e => setAddSearch(e.target.value)}
                  style={{ width: '100%', padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.78rem', background: 'white' }}
                />
                {addSearch && filteredCatalogProds.length > 0 && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', width: '280px', maxHeight: '180px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '6px', background: 'white', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.15)', zIndex: 50, marginTop: '2px' }}>
                    {filteredCatalogProds.map(p => (
                      <div
                        key={p.id}
                        onClick={() => handleAddProductFromCatalog(p)}
                        style={{ padding: '0.4rem 0.6rem', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: '0.76rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}
                      >
                        <span style={{ fontWeight: 600 }}>{p.nome}</span>
                        <span style={{ color: '#059669', fontWeight: 700 }}>{formatPreco(p.preco)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* LISTA / TABELA DE ITENS */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', background: 'white' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', color: '#475569', fontSize: '0.72rem', textTransform: 'uppercase' }}>
                    <th style={{ padding: '0.5rem 0.6rem', textAlign: 'left' }}>Produto</th>
                    <th style={{ padding: '0.5rem 0.4rem', textAlign: 'center', width: '90px' }}>Tipo</th>
                    <th style={{ padding: '0.5rem 0.4rem', textAlign: 'center', width: '90px' }}>Qtd</th>
                    <th style={{ padding: '0.5rem 0.4rem', textAlign: 'right', width: '95px' }}>Preço Unit.</th>
                    <th style={{ padding: '0.5rem 0.4rem', textAlign: 'right', width: '90px' }}>Custo</th>
                    <th style={{ padding: '0.5rem 0.5rem', textAlign: 'right', width: '90px' }}>Subtotal</th>
                    <th style={{ padding: '0.5rem 0.4rem', textAlign: 'center', width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const priceNum = parseDecimalToNumber(item.preco)
                    const subtotal = priceNum * (Number(item.qty) || 0)
                    return (
                      <tr key={item._tempKey || idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.45rem 0.6rem' }}>
                          <span style={{ fontWeight: 600, color: '#1e293b' }}>{item.nome || item.displayName}</span>
                        </td>
                        <td style={{ padding: '0.45rem 0.4rem', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => updateItem(idx, 'tipo', item.tipo === 'avista' ? 'aprazo' : 'avista')}
                            style={{
                              border: 'none',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              background: item.tipo === 'avista' ? '#dcfce7' : '#e0e7ff',
                              color: item.tipo === 'avista' ? '#15803d' : '#4338ca'
                            }}
                            title="Clique para alternar entre À Vista e A Prazo"
                          >
                            {item.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                          </button>
                        </td>
                        <td style={{ padding: '0.45rem 0.4rem', textAlign: 'center' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                            <button
                              type="button"
                              onClick={() => updateItem(idx, 'qty', Math.max(1, (Number(item.qty) || 1) - 1))}
                              style={{ width: '22px', height: '22px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc', cursor: 'pointer', fontSize: '0.72rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >-</button>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={item.qty}
                              onChange={e => updateItem(idx, 'qty', Math.max(1, Number(e.target.value) || 1))}
                              style={{ width: '38px', textAlign: 'center', padding: '2px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.78rem' }}
                            />
                            <button
                              type="button"
                              onClick={() => updateItem(idx, 'qty', (Number(item.qty) || 1) + 1)}
                              style={{ width: '22px', height: '22px', border: '1px solid #cbd5e1', borderRadius: '4px', background: '#f8fafc', cursor: 'pointer', fontSize: '0.72rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >+</button>
                          </div>
                        </td>
                        <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right' }}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={item.preco}
                            onChange={e => updateItem(idx, 'preco', cleanDecimalInput(e.target.value))}
                            style={{ width: '75px', textAlign: 'right', padding: '2px 4px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.78rem' }}
                          />
                        </td>
                        <td style={{ padding: '0.45rem 0.4rem', textAlign: 'right' }}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={item.preco_custo || ''}
                            placeholder="0,00"
                            onChange={e => updateItem(idx, 'preco_custo', cleanDecimalInput(e.target.value))}
                            style={{ width: '70px', textAlign: 'right', padding: '2px 4px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.78rem', color: '#059669' }}
                          />
                        </td>
                        <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', fontWeight: 700, color: '#334155' }}>
                          {formatPreco(subtotal)}
                        </td>
                        <td style={{ padding: '0.45rem 0.4rem', textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: '0.85rem' }}
                            title="Remover item"
                          >
                            <i className="fa-solid fa-trash"></i>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan="7" style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8' }}>
                        Nenhum item no pedido duplicado. Use o buscador acima para adicionar.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* BARRA DE TOTAIS EM DESTAQUE */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', padding: '0.65rem 0.9rem', background: 'white', borderRadius: '8px', border: '1px solid #cbd5e1', flexWrap: 'wrap', gap: '0.6rem' }}>
              <div style={{ display: 'flex', gap: '1rem', fontSize: '0.78rem', color: '#475569', flexWrap: 'wrap' }}>
                <span>Peças: <strong style={{ color: '#0f172a' }}>{totalPieces} un</strong></span>
                <span>À Vista: <strong style={{ color: '#15803d' }}>{formatPreco(totalAvista)}</strong></span>
                <span>A Prazo: <strong style={{ color: '#4338ca' }}>{formatPreco(totalAprazo)}</strong></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155' }}>Total do Novo Pedido:</span>
                <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#7c3aed', background: '#f5f3ff', padding: '0.2rem 0.6rem', borderRadius: '6px', border: '1px solid #ddd6fe' }}>
                  {formatPreco(totalGeral)}
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* FOOTER */}
        <div className="modal-actions" style={{ padding: '0.85rem 1.25rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button type="button" className="admin-btn admin-btn-sec" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="admin-btn"
            style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.45rem' }}
            disabled={!nome.trim() || !telefone.trim() || items.length === 0}
            onClick={handleConfirm}
          >
            <i className="fa-solid fa-copy"></i> Criar Pedido Duplicado
          </button>
        </div>
      </div>
    </div>
  )
}

