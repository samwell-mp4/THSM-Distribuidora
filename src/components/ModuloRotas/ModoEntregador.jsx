import React, { useState, useMemo } from 'react'

function getOrderAddress(order) {
  const c = order.customer || {}
  const e = c.endereco || order.endereco || {}
  return {
    rua: e.rua || c.rua || '',
    numero: e.numero || c.numero || '',
    bairro: e.bairro || c.bairro || '',
    cidade: e.cidade || c.cidade || '',
    estado: e.estado || c.estado || 'MG',
    cep: e.cep || c.cep || '',
    complemento: e.complemento || c.complemento || ''
  }
}

function formatFullAddress(addr) {
  const parts = []
  if (addr.rua) parts.push(addr.rua)
  if (addr.numero) parts.push(`nº ${addr.numero}`)
  if (addr.complemento) parts.push(`(${addr.complemento})`)
  if (addr.bairro) parts.push(addr.bairro)
  if (addr.cidade) parts.push(addr.cidade)
  if (addr.estado) parts.push(addr.estado)
  if (addr.cep) parts.push(`CEP: ${addr.cep}`)
  return parts.join(', ')
}

function getOrderCustomerName(order) {
  return order.customer?.nome || order.customer?.pushName || order.nome || order.customerName || `Pedido #${order.id}`
}

function getOrderCustomerPhone(order) {
  return order.customer?.telefone || order.telefone || ''
}

function cleanPhoneDigits(phone) {
  if (!phone) return ''
  const digits = String(phone).replace(/\D/g, '')
  if (digits.startsWith('55')) return digits
  return '55' + digits
}

export default function ModoEntregador({
  jornada,
  orders = [],
  financial = [],
  onUpdateJornada,
  onOpenAcertoModal,
  onOpenDespesasModal,
  onOpenFechamentoModal,
  onVoltarMontagem,
  onUpdateOrderStatus,
  showToast
}) {
  const [selectedParadaId, setSelectedParadaId] = useState(null)
  const [showFalhaModal, setShowFalhaModal] = useState(null)
  const [motivoFalha, setMotivoFalha] = useState('cliente_ausente')
  const [obsFalha, setObsFalha] = useState('')

  const paradas = useMemo(() => {
    return jornada?.paradas || []
  }, [jornada])

  // Current active next delivery: first stop that is 'pendente' or 'em_andamento'
  const nextStop = useMemo(() => {
    if (selectedParadaId) {
      const explicit = paradas.find(p => p.id === selectedParadaId)
      if (explicit) return explicit
    }
    return paradas.find(p => p.statusLogistico === 'pendente' || p.statusLogistico === 'em_andamento') || paradas[0]
  }, [paradas, selectedParadaId])

  // Get matching order for next stop
  const nextOrder = useMemo(() => {
    if (!nextStop) return null
    return orders.find(o => String(o.id) === String(nextStop.pedidoId))
  }, [nextStop, orders])

  // Progress stats
  const stats = useMemo(() => {
    const total = paradas.length
    const entregues = paradas.filter(p => p.statusLogistico === 'entregue').length
    const percent = total > 0 ? Math.round((entregues / total) * 100) : 0
    return { total, entregues, percent }
  }, [paradas])

  // Items summary for next order
  const nextOrderItemsSummary = useMemo(() => {
    if (!nextOrder) return ''
    const items = Array.isArray(nextOrder.items) && nextOrder.items.length > 0
      ? nextOrder.items
      : (Array.isArray(nextOrder.originalItems) ? nextOrder.originalItems : (nextOrder.itens || []))
    if (!items.length) return 'Nenhum item discriminado'
    return items.map(i => `${i.qty || 1}x ${i.nome || i.titulo || 'Produto'}`).join(' • ')
  }, [nextOrder])

  // Pending value to collect
  const nextOrderPendingValue = useMemo(() => {
    if (!nextOrder) return 0
    if (nextOrder.totalCobrar != null) {
      const pago = Number(nextOrder.totalPago || 0)
      return Math.max(0, Number(nextOrder.totalCobrar) - pago)
    }
    if (nextOrder.valorEmAberto != null) return Number(nextOrder.valorEmAberto)
    return Number(nextOrder.total || nextOrder.totalNota || 0)
  }, [nextOrder])

  // WhatsApp "Estou chegando" handler
  const handleWhatsAppChegando = () => {
    if (!nextOrder) return
    const rawTel = getOrderCustomerPhone(nextOrder)
    const phone = cleanPhoneDigits(rawTel)
    if (!phone || phone.length < 10) {
      showToast?.('Telefone do cliente inválido ou não informado.', 'warning')
      return
    }

    const clienteNome = getOrderCustomerName(nextOrder).split(' ')[0]
    const msg = `Olá, ${clienteNome}! 👋 Aqui é da THSM Distribuidora.\n\nNosso entregador já está a caminho do seu endereço e deve chegar em breve! 🚚💨\n\nPor favor, deixe um responsável no local para receber o pedido #${String(nextOrder.id).slice(-6)}.`
    const encoded = encodeURIComponent(msg)
    window.open(`https://api.whatsapp.com/send?phone=${phone}&text=${encoded}`, '_blank')
  }

  // Navigation handlers
  const handleOpenGoogleMaps = (addr) => {
    const query = encodeURIComponent(formatFullAddress(addr))
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${query}`, '_blank')
  }

  const handleOpenWaze = (addr) => {
    const query = encodeURIComponent(formatFullAddress(addr))
    window.open(`https://waze.com/ul?q=${query}&navigate=yes`, '_blank')
  }

  const handleOpenFullRouteMaps = () => {
    if (paradas.length === 0) return
    const pendingStops = paradas.filter(p => p.statusLogistico !== 'entregue')
    const stopsToUse = pendingStops.length > 0 ? pendingStops : paradas
    const addrs = stopsToUse.map(p => {
      const o = orders.find(ord => String(ord.id) === String(p.pedidoId))
      return o ? formatFullAddress(getOrderAddress(o)) : ''
    }).filter(Boolean)

    if (addrs.length === 0) return
    if (addrs.length === 1) {
      handleOpenGoogleMaps(getOrderAddress(orders.find(o => String(o.id) === String(stopsToUse[0].pedidoId))))
      return
    }

    const destination = encodeURIComponent(addrs[addrs.length - 1])
    const waypoints = addrs.slice(0, addrs.length - 1).map(a => encodeURIComponent(a)).join('|')
    const url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&waypoints=${waypoints}`
    window.open(url, '_blank')
  }

  // Mark delivered
  const handleMarcarEntregue = (parada, order) => {
    if (!window.confirm(`Confirmar entrega do pedido #${order.id} (${getOrderCustomerName(order)})?`)) {
      return
    }

    const agora = new Date().toISOString()
    const updatedParadas = paradas.map(p => {
      if (p.id === parada.id) {
        return {
          ...p,
          statusLogistico: 'entregue',
          concluidaEm: agora
        }
      }
      return p
    })

    // Update order status via core function
    onUpdateOrderStatus(order.id, 'entregue')

    // Update active journey
    onUpdateJornada({
      ...jornada,
      paradas: updatedParadas
    })

    showToast?.(`Entrega #${order.id} marcada como entregue!`)
  }

  // Register failure occurrence
  const handleConfirmFalha = () => {
    if (!showFalhaModal) return
    const { parada, order } = showFalhaModal
    const agora = new Date().toISOString()

    const updatedParadas = paradas.map(p => {
      if (p.id === parada.id) {
        return {
          ...p,
          statusLogistico: 'tentativa_sem_sucesso',
          motivoFalha,
          observacao: obsFalha.trim(),
          tentativaEm: agora
        }
      }
      return p
    })

    onUpdateJornada({
      ...jornada,
      paradas: updatedParadas
    })

    setShowFalhaModal(null)
    setObsFalha('')
    showToast?.(`Ocorrência de não-entrega registrada no pedido #${order.id}.`, 'warning')
  }

  const handleReorderParadas = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= paradas.length) return
    const updated = [...paradas]
    const temp = updated[index]
    updated[index] = updated[target]
    updated[target] = temp

    // Re-assign order numbers
    const fixed = updated.map((p, i) => ({ ...p, ordem: i + 1 }))
    onUpdateJornada({
      ...jornada,
      pedidos_ids: fixed.map(p => p.pedidoId),
      paradas: fixed
    })
  }

  const nextAddr = nextOrder ? getOrderAddress(nextOrder) : null

  return (
    <div className="mr-entregador-view">
      {/* Sticky Compact Header for Field Operation */}
      <div className="mr-driver-header">
        <div className="mr-driver-header-main">
          <div className="mr-driver-title">
            <div className="mr-driver-avatar">
              <i className="fa-solid fa-truck"></i>
            </div>
            <div className="mr-driver-info">
              <h3>{jornada.operador}</h3>
              <span>{jornada.veiculo} • KM Inicial: {jornada.km_inicial}</span>
            </div>
          </div>

          <div className="mr-driver-header-actions">
            <button
              type="button"
              className="mr-btn mr-btn-secondary"
              onClick={onVoltarMontagem}
              title="Ajustar Pedidos na Rota"
            >
              <i className="fa-solid fa-sliders"></i> <span>Ajustar Rota</span>
            </button>
            <button
              type="button"
              className="mr-btn mr-btn-warning"
              onClick={onOpenDespesasModal}
              title="Lançar Despesa"
            >
              <i className="fa-solid fa-receipt"></i> <span>+ Despesa</span>
            </button>
            <button
              type="button"
              className="mr-btn mr-btn-primary mr-btn-fechar-jornada"
              onClick={onOpenFechamentoModal}
              title="Fechar o dia e prestar contas"
            >
              <i className="fa-solid fa-flag-checkered"></i> <span>Fechar Jornada</span>
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mr-progress-wrap">
          <div className="mr-progress-labels">
            <span>Progresso da Rota: {stats.entregues} de {stats.total} concluídas</span>
            <span>{stats.percent}%</span>
          </div>
          <div className="mr-progress-bar-bg">
            <div className="mr-progress-bar-fill" style={{ width: `${stats.percent}%` }}></div>
          </div>
        </div>

        {/* Quick Route Actions */}
        <div className="mr-driver-quick-actions">
          <button
            type="button"
            className="mr-btn mr-btn-blue"
            style={{ padding: '6px 12px', fontSize: '0.78rem' }}
            onClick={handleOpenFullRouteMaps}
            title="Abrir todo o percurso no Google Maps"
          >
            <i className="fa-solid fa-route"></i> Abrir Rota Completa no Google Maps
          </button>
        </div>
      </div>

      {/* Hero Card: PRÓXIMA ENTREGA */}
      {nextStop && nextOrder ? (
        <div className="mr-hero-card">
          <div className="mr-hero-badge">
            <i className="fa-solid fa-location-arrow"></i> Parada Prioritária
          </div>

          <div className="mr-hero-client-row">
            <div className="mr-hero-stop-number">
              #{nextStop.ordem || 1}
            </div>
            <div className="mr-hero-client-meta">
              <h2 className="mr-hero-client-name">
                {getOrderCustomerName(nextOrder)}
              </h2>
              <div className="mr-hero-phone">
                <i className="fa-solid fa-phone" style={{ color: '#10b981' }}></i>
                {getOrderCustomerPhone(nextOrder) || 'Telefone não informado'}
                <span style={{
                  marginLeft: '8px',
                  background: '#f1f5f9',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '0.72rem',
                  fontWeight: 700
                }}>
                  Pedido #{String(nextOrder.id).slice(-6)}
                </span>
              </div>
            </div>
          </div>

          {/* Full address box */}
          <div className="mr-hero-address-box">
            <div className="mr-hero-addr-line">
              <i className="fa-solid fa-map-pin" style={{ color: '#ef4444', marginRight: '6px' }}></i>
              {nextAddr.rua ? `${nextAddr.rua}, nº ${nextAddr.numero || 'S/N'}` : 'Endereço sem rua'}
              {nextAddr.complemento ? ` (${nextAddr.complemento})` : ''}
            </div>
            <div className="mr-hero-addr-sub">
              {nextAddr.bairro ? `${nextAddr.bairro} • ` : ''}
              {nextAddr.cidade} - {nextAddr.estado}
              {nextAddr.cep ? ` • CEP: ${nextAddr.cep}` : ''}
            </div>
          </div>

          {/* Items & Payment to collect */}
          <div className="mr-hero-items-box">
            <div style={{ flex: 1, minWidth: '180px' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, display: 'block' }}>ITENS:</span>
              <strong style={{ fontSize: '0.85rem', color: '#1e293b' }}>{nextOrderItemsSummary}</strong>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, display: 'block' }}>VALOR A COBRAR:</span>
              <strong style={{ fontSize: '1.25rem', color: nextOrderPendingValue > 0 ? '#059669' : '#64748b', fontWeight: 900 }}>
                {nextOrderPendingValue > 0 ? `R$ ${nextOrderPendingValue.toFixed(2).replace('.', ',')}` : 'Já pago / Quitado'}
              </strong>
            </div>
          </div>

          {/* Navigation and WhatsApp Action Row */}
          <div className="mr-hero-nav-row">
            <button
              type="button"
              className="mr-btn mr-btn-lg mr-btn-maps mr-btn-touch"
              onClick={() => handleOpenGoogleMaps(nextAddr)}
            >
              <i className="fa-solid fa-diamond-turn-right"></i> Navegar Google Maps
            </button>
            <button
              type="button"
              className="mr-btn mr-btn-lg mr-btn-waze mr-btn-touch"
              onClick={() => handleOpenWaze(nextAddr)}
            >
              <i className="fa-solid fa-location-crosshairs"></i> Navegar Waze
            </button>
            <button
              type="button"
              className="mr-btn mr-btn-lg mr-btn-wa-chegando mr-btn-touch"
              onClick={handleWhatsAppChegando}
            >
              <i className="fa-brands fa-whatsapp" style={{ fontSize: '1.2rem' }}></i> WhatsApp: Estou Chegando!
            </button>
          </div>

          {/* Main Operational Actions: Entregue, Fazer Acerto, Ocorrência */}
          <div className="mr-hero-main-actions">
            <div className="mr-action-grid-primary">
              <button
                type="button"
                className="mr-btn mr-btn-lg mr-btn-primary mr-btn-touch"
                onClick={() => handleMarcarEntregue(nextStop, nextOrder)}
              >
                <i className="fa-solid fa-circle-check" style={{ fontSize: '1.1rem' }}></i> Marcar Entregue
              </button>
              <button
                type="button"
                className="mr-btn mr-btn-lg mr-btn-purple mr-btn-touch"
                onClick={() => onOpenAcertoModal(nextOrder, 'acerto')}
              >
                <i className="fa-solid fa-handshake" style={{ fontSize: '1.1rem' }}></i> Fazer Acerto Financeiro
              </button>
            </div>

            <button
              type="button"
              className="mr-btn mr-btn-danger"
              style={{ width: '100%', minHeight: '42px' }}
              onClick={() => setShowFalhaModal({ parada: nextStop, order: nextOrder })}
            >
              <i className="fa-solid fa-triangle-exclamation"></i> Não consegui entregar (Registrar Ocorrência)
            </button>
          </div>
        </div>
      ) : (
        <div className="mr-empty-jornada-card">
          <div className="mr-empty-icon">
            <i className="fa-solid fa-circle-check"></i>
          </div>
          <h3 style={{ margin: 0, color: '#1e293b' }}>Todas as entregas da rota foram concluídas!</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
            Parabéns! Você já finalizou todas as paradas. Clique no botão abaixo para conferir as despesas e fechar a jornada.
          </p>
          <button
            type="button"
            className="mr-btn mr-btn-primary mr-btn-lg"
            onClick={onOpenFechamentoModal}
          >
            <i className="fa-solid fa-flag-checkered"></i> Fechar Jornada e Prestar Contas
          </button>
        </div>
      )}

      {/* Lista Completa das Paradas */}
      <div className="mr-stops-card">
        <div className="mr-stops-header">
          <h4>Fila Completa de Entregas ({paradas.length})</h4>
          <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
            Toque em uma parada para defini-la como prioritária
          </span>
        </div>

        <div>
          {paradas.map((parada, index) => {
            const order = orders.find(o => String(o.id) === String(parada.pedidoId))
            if (!order) return null
            const addr = getOrderAddress(order)
            const isDone = parada.statusLogistico === 'entregue'
            const isFailed = parada.statusLogistico === 'tentativa_sem_sucesso'
            const isCurrent = nextStop?.id === parada.id

            return (
              <div
                key={parada.id}
                className={`mr-stop-item ${isCurrent ? 'is-current' : ''} ${isDone ? 'is-done' : ''}`}
                onClick={() => setSelectedParadaId(parada.id)}
              >
                <div className={`mr-stop-badge ${isDone ? 'done' : (isFailed ? 'failed' : 'pending')}`}>
                  {isDone ? <i className="fa-solid fa-check"></i> : (isFailed ? <i className="fa-solid fa-xmark"></i> : parada.ordem || index + 1)}
                </div>

                <div className="mr-stop-content">
                  <div className="mr-stop-top">
                    <span className="mr-stop-name">{getOrderCustomerName(order)}</span>
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: isDone ? '#dcfce7' : (isFailed ? '#fee2e2' : '#f1f5f9'),
                      color: isDone ? '#15803d' : (isFailed ? '#b91c1c' : '#475569')
                    }}>
                      {isDone ? 'Entregue' : (isFailed ? 'Tentativa sem sucesso' : 'Pendente')}
                    </span>
                  </div>

                  <div className="mr-stop-addr">
                    {addr.rua ? `${addr.rua}, nº ${addr.numero || 'S/N'}` : 'Sem rua'} • {addr.bairro || addr.cidade}
                  </div>
                </div>

                <div className="mr-stop-reorder" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="mr-reorder-btn"
                    disabled={index === 0}
                    onClick={() => handleReorderParadas(index, -1)}
                    title="Subir na ordem"
                  >
                    <i className="fa-solid fa-arrow-up"></i>
                  </button>
                  <button
                    type="button"
                    className="mr-reorder-btn"
                    disabled={index === paradas.length - 1}
                    onClick={() => handleReorderParadas(index, 1)}
                    title="Descer na ordem"
                  >
                    <i className="fa-solid fa-arrow-down"></i>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Barra de Ações Rápidas no Rodapé da Jornada */}
      <div className="mr-driver-bottom-bar">
        <button
          type="button"
          className="mr-btn mr-btn-secondary"
          onClick={onVoltarMontagem}
        >
          <i className="fa-solid fa-sliders"></i> Ajustar Rota
        </button>
        <button
          type="button"
          className="mr-btn mr-btn-warning"
          onClick={onOpenDespesasModal}
        >
          <i className="fa-solid fa-receipt"></i> + Despesa
        </button>
        <button
          type="button"
          className="mr-btn mr-btn-primary"
          onClick={onOpenFechamentoModal}
          style={{ fontWeight: 800 }}
        >
          <i className="fa-solid fa-flag-checkered"></i> Fechar Jornada
        </button>
      </div>

      {/* Modal de Tentativa Sem Sucesso */}
      {showFalhaModal && (
        <div className="mr-modal-overlay" onClick={() => setShowFalhaModal(null)}>
          <div className="mr-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="mr-modal-header">
              <h3>
                <i className="fa-solid fa-triangle-exclamation" style={{ color: '#ef4444' }}></i>
                Registrar Tentativa Sem Sucesso
              </h3>
              <button
                type="button"
                className="mr-reorder-btn"
                onClick={() => setShowFalhaModal(null)}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="mr-modal-body">
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#475569' }}>
                Informe o motivo da não-conclusão da entrega de <strong>{getOrderCustomerName(showFalhaModal.order)}</strong>:
              </p>

              <div className="mr-form-group">
                <label className="mr-form-label">Motivo *</label>
                <select
                  className="mr-form-select"
                  value={motivoFalha}
                  onChange={(e) => setMotivoFalha(e.target.value)}
                >
                  <option value="cliente_ausente">🚪 Cliente ausente / Ninguém no local</option>
                  <option value="reagendamento_solicitado">📅 Cliente pediu reagendamento</option>
                  <option value="endereco_incorreto">📍 Endereço incorreto ou incompleto</option>
                  <option value="cliente_recusou">🛑 Cliente recusou o pedido</option>
                  <option value="estabelecimento_fechado">🔒 Estabelecimento fechado</option>
                  <option value="outro">❓ Outro motivo</option>
                </select>
              </div>

              <div className="mr-form-group">
                <label className="mr-form-label">Observação adicional (Opcional)</label>
                <textarea
                  rows="2"
                  className="mr-form-textarea"
                  placeholder="Ex: Tentei contato telefônico 3x, vizinho informou que viajou..."
                  value={obsFalha}
                  onChange={(e) => setObsFalha(e.target.value)}
                />
              </div>
            </div>

            <div className="mr-modal-footer">
              <button
                type="button"
                className="mr-btn mr-btn-secondary"
                onClick={() => setShowFalhaModal(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="mr-btn mr-btn-danger mr-btn-lg"
                onClick={handleConfirmFalha}
              >
                Registrar Ocorrência
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

