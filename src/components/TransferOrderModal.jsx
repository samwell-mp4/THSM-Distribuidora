import { useState, useMemo, useEffect } from 'react'
import { formatPhone, normalizePhoneDigits, samePhone, supabase } from '../lib/supabase'
import { searchMatches, normalizeSearch } from '../lib/search'
import './TransferOrderModal.css'

export default function TransferOrderModal({
  isOpen,
  onClose,
  orders = [],
  usuarios = [],
  initialSelectedOrderIds = [],
  onTransferSuccess,
  showToast = () => {}
}) {
  const [activeTab, setActiveTab] = useState('auto') // 'auto' | 'orders' | 'client'
  const [loading, setLoading] = useState(false)

  // Tab 1: Correção Automática de 5555 e Duplicados
  const problematicUsers = useMemo(() => {
    if (!usuarios || usuarios.length === 0) return []
    const list = []

    usuarios.forEach(u => {
      const rawTel = String(u.telefone || '').replace(/\D/g, '')
      const is5555 = rawTel.startsWith('5555')
      const isTooLong = rawTel.length > 13
      const isShortAnomaly = rawTel.length === 11 && rawTel.startsWith('55')

      if (is5555 || isTooLong || isShortAnomaly) {
        // Pedidos associados a este usuário
        const userOrders = orders.filter(o => {
          if (o.user_id && String(o.user_id) === String(u.id)) return true
          const custTel = String(o.customer?.telefone || '').replace(/\D/g, '')
          return custTel && (custTel === rawTel || samePhone(custTel, rawTel))
        })

        // Tenta encontrar o usuário real correspondente
        const cleanDigits = rawTel.replace(/^5555+/, '').replace(/^55/, '')
        const uCpf = (u.endereco?.cpf || u.cpf || '').replace(/\D/g, '')
        const uNome = (u.nome || '').trim().toLowerCase()

        const suggestedReal = usuarios.find(other => {
          if (other.id === u.id) return false
          const otherTel = String(other.telefone || '').replace(/\D/g, '')
          if (otherTel.startsWith('5555')) return false

          const otherCpf = (other.endereco?.cpf || other.cpf || '').replace(/\D/g, '')
          if (uCpf && otherCpf && uCpf.length === 11 && uCpf === otherCpf) return true

          const otherClean = otherTel.replace(/^55/, '')
          if (cleanDigits.length >= 8 && otherClean.includes(cleanDigits)) return true

          if (uNome && uNome.length > 3 && (other.nome || '').trim().toLowerCase() === uNome) return true
          return false
        })

        list.push({
          duplicateUser: u,
          ordersCount: userOrders.length,
          orders: userOrders,
          suggestedRealUser: suggestedReal || null,
          selectedTargetId: suggestedReal?.id || ''
        })
      }
    })

    return list
  }, [usuarios, orders])

  // Estado para alvos selecionados na aba automática
  const [autoTargets, setAutoTargets] = useState({})
  useEffect(() => {
    const init = {}
    problematicUsers.forEach(p => {
      init[p.duplicateUser.id] = p.selectedTargetId
    })
    setAutoTargets(init)
  }, [problematicUsers])

  // Tab 2: Pedidos específicos
  const [orderSearch, setOrderSearch] = useState('')
  const [selectedOrderIds, setSelectedOrderIds] = useState(new Set())
  const [targetUserSearch, setTargetUserSearch] = useState('')
  const [selectedTargetUser, setSelectedTargetUser] = useState(null)

  useEffect(() => {
    if (initialSelectedOrderIds && initialSelectedOrderIds.length > 0) {
      setSelectedOrderIds(new Set(initialSelectedOrderIds.map(String)))
      setActiveTab('orders')
    }
  }, [initialSelectedOrderIds])

  // Tab 3: Transferência por cliente
  const [sourceClientSearch, setSourceClientSearch] = useState('')
  const [selectedSourceUser, setSelectedSourceUser] = useState(null)
  const [deleteSourceUserAfter, setDeleteSourceUserAfter] = useState(true)

  // Filtragem de pedidos para Tab 2
  const filteredOrders = useMemo(() => {
    if (!orderSearch.trim()) return orders.slice(0, 50)
    const norm = normalizeSearch(orderSearch)
    return orders.filter(o => {
      const idMatch = String(o.id || '').includes(norm)
      const nameMatch = normalizeSearch(o.customer?.nome || '').includes(norm)
      const phoneMatch = String(o.customer?.telefone || '').replace(/\D/g, '').includes(norm)
      return idMatch || nameMatch || phoneMatch
    }).slice(0, 50)
  }, [orders, orderSearch])

  // Filtragem de usuários reais para destino (exclui os que têm 5555)
  const realUsers = useMemo(() => {
    return (usuarios || []).filter(u => {
      const tel = String(u.telefone || '')
      return !tel.startsWith('5555')
    })
  }, [usuarios])

  // Busca de cliente destino (Tab 2 e Tab 3)
  const searchUsers = (term) => {
    if (!term || term.trim().length < 2) return []
    const norm = normalizeSearch(term)
    return realUsers.filter(u => {
      const nameMatch = normalizeSearch(u.nome || '').includes(norm)
      const phoneMatch = String(u.telefone || '').replace(/\D/g, '').includes(norm)
      const emailMatch = normalizeSearch(u.email || '').includes(norm)
      const cpfMatch = String(u.endereco?.cpf || u.cpf || '').replace(/\D/g, '').includes(norm)
      return nameMatch || phoneMatch || emailMatch || cpfMatch
    }).slice(0, 8)
  }

  const targetUserSuggestions = useMemo(() => searchUsers(targetUserSearch), [targetUserSearch, realUsers])
  const sourceUserSuggestions = useMemo(() => {
    if (!sourceClientSearch || sourceClientSearch.trim().length < 2) return []
    const norm = normalizeSearch(sourceClientSearch)
    return (usuarios || []).filter(u => {
      const nameMatch = normalizeSearch(u.nome || '').includes(norm)
      const phoneMatch = String(u.telefone || '').replace(/\D/g, '').includes(norm)
      const emailMatch = normalizeSearch(u.email || '').includes(norm)
      return nameMatch || phoneMatch || emailMatch
    }).slice(0, 8)
  }, [sourceClientSearch, usuarios])

  // Pedidos do cliente de origem selecionado (Tab 3)
  const sourceUserOrders = useMemo(() => {
    if (!selectedSourceUser) return []
    return orders.filter(o => {
      if (o.user_id && String(o.user_id) === String(selectedSourceUser.id)) return true
      const custTel = String(o.customer?.telefone || '').replace(/\D/g, '')
      const uTel = String(selectedSourceUser.telefone || '').replace(/\D/g, '')
      return custTel && uTel && (custTel === uTel || samePhone(custTel, uTel))
    })
  }, [selectedSourceUser, orders])

  if (!isOpen) return null

  // Executa a transferência de uma lista de pedidos para um usuário alvo
  const executeTransfer = async (ordersToTransfer, targetUser, deleteSourceUserId = null) => {
    if (!ordersToTransfer || ordersToTransfer.length === 0) {
      showToast('Nenhum pedido selecionado para transferir.', 'error')
      return
    }
    if (!targetUser || !targetUser.id) {
      showToast('Selecione um cliente de destino válido.', 'error')
      return
    }

    setLoading(true)
    try {
      const targetPhone = normalizePhoneDigits(targetUser.telefone || '')
      const targetCpf = (targetUser.cpf || targetUser.endereco?.cpf || '').trim()
      const targetEndereco = { ...(targetUser.endereco || {}) }
      if (targetCpf && !targetEndereco.cpf) targetEndereco.cpf = targetCpf

      const now = Date.now()
      const updatedOrders = ordersToTransfer.map(o => {
        const updatedCustomer = {
          ...(o.customer || {}),
          id: targetUser.id,
          user_id: targetUser.id,
          nome: targetUser.nome || o.customer?.nome || '',
          email: targetUser.email || o.customer?.email || '',
          telefone: targetPhone || o.customer?.telefone || '',
          cpf: targetCpf || o.customer?.cpf || '',
          endereco: targetEndereco
        }

        return {
          ...o,
          user_id: targetUser.id,
          customer: updatedCustomer,
          lastModified: now,
          updatedAt: now
        }
      })

      // Atualiza pedidos no banco de dados sem tocar no financeiro
      for (const ord of updatedOrders) {
        await supabase.from('pedidos').upsert({
          id: ord.id,
          user_id: targetUser.id,
          status: ord.status,
          data: ord
        }, { onConflict: 'id' })
      }

      // Se solicitado, remove o usuário duplicado de origem
      if (deleteSourceUserId) {
        try {
          await supabase.from('usuarios').delete().eq('id', deleteSourceUserId)
        } catch (e) {
          console.warn('Erro ao deletar usuário duplicado:', e.message)
        }
      }

      if (onTransferSuccess) {
        await onTransferSuccess({
          updatedOrders,
          transferredCount: updatedOrders.length,
          deletedUserId: deleteSourceUserId,
          targetUser
        })
      }

      showToast(`${updatedOrders.length} pedido(s) transferido(s) para "${targetUser.nome}" com sucesso!`, 'success')
      return true
    } catch (err) {
      console.error('Erro na transferência:', err)
      showToast(`Falha ao transferir pedidos: ${err.message}`, 'error')
      return false
    } finally {
      setLoading(false)
    }
  }

  // Ação: Corrigir 1 item na aba automática
  const handleAutoTransferSingle = async (item) => {
    const targetId = autoTargets[item.duplicateUser.id]
    if (!targetId) {
      showToast('Selecione o cliente real de destino.', 'error')
      return
    }
    const targetUser = usuarios.find(u => u.id === targetId)
    if (!targetUser) {
      showToast('Cliente destino não encontrado.', 'error')
      return
    }

    const ok = await executeTransfer(item.orders, targetUser, item.duplicateUser.id)
    if (ok) {
      // Pedidos transferidos com sucesso
    }
  }

  // Ação: Corrigir todos com correspondência sugerida automática
  const handleAutoTransferAll = async () => {
    const readyItems = problematicUsers.filter(p => {
      const targetId = autoTargets[p.duplicateUser.id]
      return targetId && usuarios.some(u => u.id === targetId)
    })

    if (readyItems.length === 0) {
      showToast('Nenhum par de transferência configurado.', 'error')
      return
    }

    if (!window.confirm(`Tem certeza que deseja transferir pedidos de ${readyItems.length} usuário(s) duplicados para seus perfis reais? O financeiro será 100% mantido.`)) {
      return
    }

    let successCount = 0
    for (const item of readyItems) {
      const targetUser = usuarios.find(u => u.id === autoTargets[item.duplicateUser.id])
      if (targetUser) {
        const ok = await executeTransfer(item.orders, targetUser, item.duplicateUser.id)
        if (ok) successCount++
      }
    }

    showToast(`${successCount} perfil(is) duplicados corrigidos e pedidos transferidos!`, 'success')
    onClose()
  }

  // Ação: Transferir pedidos específicos selecionados (Tab 2)
  const handleTransferSelectedOrders = async () => {
    if (selectedOrderIds.size === 0) {
      showToast('Selecione ao menos 1 pedido.', 'error')
      return
    }
    if (!selectedTargetUser) {
      showToast('Selecione o cliente de destino.', 'error')
      return
    }

    const ordersToMove = orders.filter(o => selectedOrderIds.has(String(o.id)))
    const ok = await executeTransfer(ordersToMove, selectedTargetUser, null)
    if (ok) {
      setSelectedOrderIds(new Set())
      setSelectedTargetUser(null)
      setTargetUserSearch('')
      onClose()
    }
  }

  // Ação: Transferir todos os pedidos de um cliente para outro (Tab 3)
  const handleTransferClientOrders = async () => {
    if (!selectedSourceUser) {
      showToast('Selecione o cliente de origem.', 'error')
      return
    }
    if (!selectedTargetUser) {
      showToast('Selecione o cliente de destino.', 'error')
      return
    }
    if (selectedSourceUser.id === selectedTargetUser.id) {
      showToast('O cliente de origem e destino não podem ser o mesmo.', 'error')
      return
    }
    if (sourceUserOrders.length === 0) {
      showToast('O cliente de origem não possui pedidos.', 'error')
      return
    }

    if (!window.confirm(`Confirmar transferência de ${sourceUserOrders.length} pedido(s) de "${selectedSourceUser.nome}" para "${selectedTargetUser.nome}"?`)) {
      return
    }

    const deleteId = deleteSourceUserAfter ? selectedSourceUser.id : null
    const ok = await executeTransfer(sourceUserOrders, selectedTargetUser, deleteId)
    if (ok) {
      setSelectedSourceUser(null)
      setSelectedTargetUser(null)
      onClose()
    }
  }

  return (
    <div className="transfer-order-overlay" onClick={onClose}>
      <div className="transfer-order-modal" onClick={e => e.stopPropagation()}>
        <div className="transfer-order-header">
          <div>
            <h2><i className="fa-solid fa-arrow-right-arrow-left"></i> Transferir Pedidos entre Clientes</h2>
            <p>Vincule pedidos de cadastros duplicados (ex: números com 5555) aos clientes reais.</p>
          </div>
          <button className="transfer-order-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>

        {/* NAVEGAÇÃO DE ABAS */}
        <div className="transfer-order-tabs">
          <button
            className={`transfer-order-tab ${activeTab === 'auto' ? 'active' : ''}`}
            onClick={() => setActiveTab('auto')}
          >
            <i className="fa-solid fa-wand-magic-sparkles"></i> Corrigir Duplicados (5555)
            {problematicUsers.length > 0 && (
              <span className="transfer-tab-badge">{problematicUsers.length}</span>
            )}
          </button>
          <button
            className={`transfer-order-tab ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            <i className="fa-solid fa-box"></i> Pedidos Selecionados
            {selectedOrderIds.size > 0 && (
              <span style={{ background: '#e0e7ff', color: '#4338ca', fontSize: '0.72rem', padding: '0.1rem 0.45rem', borderRadius: '10px', fontWeight: 700 }}>
                {selectedOrderIds.size}
              </span>
            )}
          </button>
          <button
            className={`transfer-order-tab ${activeTab === 'client' ? 'active' : ''}`}
            onClick={() => setActiveTab('client')}
          >
            <i className="fa-solid fa-users"></i> Por Cliente (Origem → Destino)
          </button>
        </div>

        <div className="transfer-order-body">
          {/* BANNER DE GARANTIA FINANCEIRA */}
          <div className="transfer-info-banner">
            <i className="fa-solid fa-shield-halved"></i>
            <div>
              <h4>Garantia de Integridade Financeira</h4>
              <p>
                A transferência altera apenas o titular do pedido (cliente e endereço de entrega). Todos os registros financeiros (valores pagos, pendentes, parcelas, comprovantes e acertos) são <strong>preservados integralmente</strong> e continuam 100% corretos.
              </p>
            </div>
          </div>

          {/* ABA 1: CORREÇÃO AUTOMÁTICA DE 5555 */}
          {activeTab === 'auto' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>
                    Cadastros com anomalia de telefone detectados ({problematicUsers.length})
                  </h3>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                    O sistema identificou os cadastros criados com prefixo 5555 e seus clientes reais correspondentes.
                  </p>
                </div>
                {problematicUsers.length > 0 && (
                  <button
                    className="admin-btn"
                    style={{ background: '#7c3aed', color: 'white', borderColor: '#6d28d9', fontSize: '0.78rem', padding: '0.4rem 0.85rem' }}
                    onClick={handleAutoTransferAll}
                    disabled={loading}
                  >
                    <i className="fa-solid fa-bolt"></i> Transferir e Corrigir Todos
                  </button>
                )}
              </div>

              {problematicUsers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
                  <i className="fa-solid fa-circle-check" style={{ fontSize: '2.2rem', color: '#10b981', marginBottom: '0.75rem' }}></i>
                  <h4 style={{ margin: 0, color: '#1e293b' }}>Nenhum usuário com 5555 pendente!</h4>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                    Todos os cadastros estão com telefones regulares. Use a aba "Pedidos Selecionados" se quiser transferir pedidos manualmente.
                  </p>
                </div>
              ) : (
                problematicUsers.map(item => (
                  <div key={item.duplicateUser.id} className="transfer-auto-card">
                    {/* ORIGEM (DUPLICADO) */}
                    <div className="transfer-card-col">
                      <div className="transfer-user-tag-dup">
                        <i className="fa-solid fa-triangle-exclamation"></i> Cadastro Duplicado (5555)
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a' }}>
                        {item.duplicateUser.nome || 'Sem Nome'}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: '#dc2626', fontFamily: 'monospace', fontWeight: 600 }}>
                        {item.duplicateUser.telefone}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>
                        <i className="fa-solid fa-box"></i> <strong>{item.ordersCount}</strong> pedido(s) vinculado(s)
                      </div>
                    </div>

                    <div style={{ color: '#94a3b8', fontSize: '1.2rem' }}>
                      <i className="fa-solid fa-arrow-right"></i>
                    </div>

                    {/* DESTINO (REAL) */}
                    <div className="transfer-card-col">
                      <div className="transfer-user-tag-real">
                        <i className="fa-solid fa-circle-check"></i> Transferir para Cliente Real:
                      </div>
                      <select
                        value={autoTargets[item.duplicateUser.id] || ''}
                        onChange={e => setAutoTargets({ ...autoTargets, [item.duplicateUser.id]: e.target.value })}
                        style={{ width: '100%', padding: '0.45rem', fontSize: '0.82rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                      >
                        <option value="">-- Selecione o cliente real --</option>
                        {realUsers.map(u => (
                          <option key={u.id} value={u.id}>
                            {u.nome} ({formatPhone(u.telefone)}) {u.endereco?.cidade ? `• ${u.endereco.cidade}` : ''}
                          </option>
                        ))}
                      </select>
                      {item.suggestedRealUser && (
                        <div style={{ fontSize: '0.74rem', color: '#16a34a', marginTop: '0.25rem' }}>
                          <i className="fa-solid fa-lightbulb"></i> Sugestão identificada por nome/dados.
                        </div>
                      )}
                    </div>

                    {/* AÇÃO */}
                    <div>
                      <button
                        className="admin-btn"
                        style={{ background: '#7c3aed', color: 'white', borderColor: '#6d28d9', fontSize: '0.78rem', padding: '0.45rem 0.8rem', whiteSpace: 'nowrap' }}
                        disabled={loading || !autoTargets[item.duplicateUser.id]}
                        onClick={() => handleAutoTransferSingle(item)}
                      >
                        {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-arrow-right-arrow-left"></i>} Transferir & Limpar
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ABA 2: TRANSFERIR PEDIDOS SELECIONADOS */}
          {activeTab === 'orders' && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.25rem' }}>
                {/* LADO ESQUERDO: SELEÇÃO DE PEDIDOS */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b' }}>
                      1. Selecione os Pedidos a Transferir ({selectedOrderIds.size} selecionados)
                    </label>
                    {selectedOrderIds.size > 0 && (
                      <button
                        onClick={() => setSelectedOrderIds(new Set())}
                        style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '0.75rem', cursor: 'pointer' }}
                      >
                        Limpar seleção
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="Buscar pedido por comanda # ou cliente..."
                    value={orderSearch}
                    onChange={e => setOrderSearch(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', marginBottom: '0.5rem' }}
                  />

                  <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc' }}>
                    {filteredOrders.length === 0 ? (
                      <div style={{ padding: '1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>Nenhum pedido encontrado</div>
                    ) : (
                      filteredOrders.map(o => {
                        const isChecked = selectedOrderIds.has(String(o.id))
                        return (
                          <label
                            key={o.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.6rem',
                              padding: '0.5rem 0.75rem',
                              borderBottom: '1px solid #e2e8f0',
                              background: isChecked ? '#ede9fe' : 'transparent',
                              cursor: 'pointer',
                              fontSize: '0.8rem'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                const next = new Set(selectedOrderIds)
                                if (isChecked) next.delete(String(o.id)); else next.add(String(o.id))
                                setSelectedOrderIds(next)
                              }}
                            />
                            <div style={{ flex: 1 }}>
                              <strong>#{String(o.id).slice(-6)}</strong> • {o.customer?.nome || 'Sem Nome'}
                              <span style={{ color: '#64748b', marginLeft: '0.35rem', fontSize: '0.74rem' }}>
                                ({o.customer?.telefone || 'sem tel'})
                              </span>
                            </div>
                            <span style={{ fontWeight: 600, color: '#059669' }}>
                              R$ {Number(o.total || o.totalAprazo || 0).toFixed(2)}
                            </span>
                          </label>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* LADO DIREITO: SELEÇÃO DO CLIENTE DE DESTINO */}
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.5rem' }}>
                    2. Cliente de Destino (Perfil Real)
                  </label>
                  <input
                    type="text"
                    placeholder="Digite o nome, telefone ou CPF do cliente real..."
                    value={targetUserSearch}
                    onChange={e => setTargetUserSearch(e.target.value)}
                    style={{ width: '100%', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', marginBottom: '0.5rem' }}
                  />

                  {/* SUGESTÕES DE USUÁRIOS */}
                  <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#ffffff', marginBottom: '0.75rem' }}>
                    {targetUserSuggestions.length === 0 ? (
                      <div style={{ padding: '0.75rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.78rem' }}>
                        {targetUserSearch.length < 2 ? 'Digite ao menos 2 letras para buscar clientes...' : 'Nenhum cliente encontrado.'}
                      </div>
                    ) : (
                      targetUserSuggestions.map(u => (
                        <div
                          key={u.id}
                          onClick={() => {
                            setSelectedTargetUser(u)
                            setTargetUserSearch(u.nome)
                          }}
                          style={{
                            padding: '0.45rem 0.65rem',
                            borderBottom: '1px solid #f1f5f9',
                            cursor: 'pointer',
                            background: selectedTargetUser?.id === u.id ? '#dcfce7' : 'transparent',
                            fontSize: '0.8rem'
                          }}
                        >
                          <div style={{ fontWeight: 600, color: '#1e293b' }}>{u.nome}</div>
                          <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                            {formatPhone(u.telefone)} {u.endereco?.cidade ? `• ${u.endereco.cidade}` : ''}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {selectedTargetUser && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', padding: '0.65rem', fontSize: '0.8rem' }}>
                      <div style={{ fontWeight: 700, color: '#166534', marginBottom: '0.2rem' }}>
                        <i className="fa-solid fa-circle-check"></i> Destino Selecionado:
                      </div>
                      <div><strong>Nome:</strong> {selectedTargetUser.nome}</div>
                      <div><strong>Telefone:</strong> {formatPhone(selectedTargetUser.telefone)}</div>
                      {selectedTargetUser.endereco?.cidade && (
                        <div><strong>Cidade:</strong> {selectedTargetUser.endereco.cidade} - {selectedTargetUser.endereco.estado}</div>
                      )}
                    </div>
                  )}

                  <div style={{ marginTop: '1rem' }}>
                    <button
                      className="admin-btn"
                      style={{ width: '100%', background: '#7c3aed', color: 'white', borderColor: '#6d28d9', padding: '0.6rem' }}
                      disabled={loading || selectedOrderIds.size === 0 || !selectedTargetUser}
                      onClick={handleTransferSelectedOrders}
                    >
                      {loading ? (
                        <><i className="fa-solid fa-spinner fa-spin"></i> Transferindo...</>
                      ) : (
                        <><i className="fa-solid fa-arrow-right-arrow-left"></i> Transferir {selectedOrderIds.size} Pedido(s)</>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ABA 3: TRANSFERIR POR CLIENTE COMPLETO */}
          {activeTab === 'client' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
              {/* ORIGEM */}
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.4rem' }}>
                  1. Cliente de Origem (quem tem os pedidos atuais)
                </label>
                <input
                  type="text"
                  placeholder="Buscar cliente de origem..."
                  value={sourceClientSearch}
                  onChange={e => setSourceClientSearch(e.target.value)}
                  style={{ width: '100%', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', marginBottom: '0.5rem' }}
                />
                <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#ffffff', marginBottom: '0.75rem' }}>
                  {sourceUserSuggestions.map(u => (
                    <div
                      key={u.id}
                      onClick={() => {
                        setSelectedSourceUser(u)
                        setSourceClientSearch(u.nome)
                      }}
                      style={{
                        padding: '0.45rem 0.65rem',
                        borderBottom: '1px solid #f1f5f9',
                        cursor: 'pointer',
                        background: selectedSourceUser?.id === u.id ? '#fee2e2' : 'transparent',
                        fontSize: '0.8rem'
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{u.nome}</div>
                      <div style={{ fontSize: '0.72rem', color: u.telefone?.startsWith('5555') ? '#dc2626' : '#64748b' }}>
                        {u.telefone}
                      </div>
                    </div>
                  ))}
                </div>

                {selectedSourceUser && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.65rem', fontSize: '0.8rem' }}>
                    <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: '0.2rem' }}>
                      <i className="fa-solid fa-user"></i> Origem: {selectedSourceUser.nome}
                    </div>
                    <div><strong>Telefone:</strong> {selectedSourceUser.telefone}</div>
                    <div style={{ marginTop: '0.35rem', fontWeight: 600, color: '#b91c1c' }}>
                      <i className="fa-solid fa-box"></i> {sourceUserOrders.length} pedido(s) vinculados a este perfil
                    </div>
                  </div>
                )}
              </div>

              {/* DESTINO */}
              <div>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b', display: 'block', marginBottom: '0.4rem' }}>
                  2. Cliente de Destino (Perfil Real)
                </label>
                <input
                  type="text"
                  placeholder="Buscar cliente real de destino..."
                  value={targetUserSearch}
                  onChange={e => setTargetUserSearch(e.target.value)}
                  style={{ width: '100%', padding: '0.45rem 0.65rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', marginBottom: '0.5rem' }}
                />
                <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#ffffff', marginBottom: '0.75rem' }}>
                  {targetUserSuggestions.map(u => (
                    <div
                      key={u.id}
                      onClick={() => {
                        setSelectedTargetUser(u)
                        setTargetUserSearch(u.nome)
                      }}
                      style={{
                        padding: '0.45rem 0.65rem',
                        borderBottom: '1px solid #f1f5f9',
                        cursor: 'pointer',
                        background: selectedTargetUser?.id === u.id ? '#dcfce7' : 'transparent',
                        fontSize: '0.8rem'
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{u.nome}</div>
                      <div style={{ fontSize: '0.72rem', color: '#16a34a' }}>
                        {formatPhone(u.telefone)}
                      </div>
                    </div>
                  ))}
                </div>

                {selectedTargetUser && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '0.65rem', fontSize: '0.8rem', marginBottom: '0.75rem' }}>
                    <div style={{ fontWeight: 700, color: '#166534', marginBottom: '0.2rem' }}>
                      <i className="fa-solid fa-circle-check"></i> Destino: {selectedTargetUser.nome}
                    </div>
                    <div><strong>Telefone:</strong> {formatPhone(selectedTargetUser.telefone)}</div>
                  </div>
                )}

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', color: '#475569', cursor: 'pointer', marginBottom: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={deleteSourceUserAfter}
                    onChange={e => setDeleteSourceUserAfter(e.target.checked)}
                  />
                  <span>Excluir perfil de origem após transferir todos os pedidos</span>
                </label>

                <button
                  className="admin-btn"
                  style={{ width: '100%', background: '#7c3aed', color: 'white', borderColor: '#6d28d9', padding: '0.6rem' }}
                  disabled={loading || !selectedSourceUser || !selectedTargetUser || sourceUserOrders.length === 0}
                  onClick={handleTransferClientOrders}
                >
                  {loading ? (
                    <><i className="fa-solid fa-spinner fa-spin"></i> Transferindo...</>
                  ) : (
                    <><i className="fa-solid fa-arrow-right-arrow-left"></i> Transferir {sourceUserOrders.length} Pedido(s)</>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="transfer-order-footer">
          <button className="admin-btn admin-btn-sec" onClick={onClose} disabled={loading}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

