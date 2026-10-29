import React, { useState, useMemo, useEffect, useRef } from 'react'

const GM_KEY = 'AIzaSyDqitbcWIg-akmvbGdTrBWf_H7FZ8G3YaY'

const CIDADE_COORDS = {
  'belo horizonte': [-19.92, -43.94], 'contagem': [-19.93, -44.05], 'betim': [-19.97, -44.20],
  'ibirite': [-20.02, -44.06], 'nova lima': [-19.99, -43.85], 'santa luzia': [-19.77, -43.85],
  'sabara': [-19.89, -43.81], 'caete': [-19.88, -43.67], 'ribeirao das neves': [-19.77, -44.09],
  'esmeraldas': [-19.76, -44.31], 'lagoa santa': [-19.63, -43.89], 'pedro leopoldo': [-19.62, -44.04],
  'vespasiano': [-19.69, -43.92], 'matheus leme': [-19.55, -44.07], 'divinopolis': [-20.15, -44.90],
  'sete lagoas': [-19.46, -44.25], 'juiz de fora': [-21.76, -43.35], 'ipatinga': [-19.47, -42.55],
  'governador valadares': [-18.85, -41.95], 'uberlandia': [-18.92, -48.28], 'uberaba': [-19.75, -47.94],
  'pouso alegre': [-22.23, -45.93], 'varginha': [-21.55, -45.43], 'barbacena': [-21.23, -43.77],
  'sao joao del rei': [-21.14, -44.26], 'muriaé': [-21.13, -42.37], 'ubá': [-21.12, -42.94]
}

function normalizeStr(s) {
  if (!s) return ''
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function getOrderAddress(order) {
  const c = order.customer || {}
  const e = c.endereco || order.endereco || {}
  const rua = e.rua || c.rua || ''
  const numero = e.numero || c.numero || ''
  const bairro = e.bairro || c.bairro || ''
  const cidade = e.cidade || c.cidade || ''
  const estado = e.estado || c.estado || 'MG'
  const cep = e.cep || c.cep || ''
  const complemento = e.complemento || c.complemento || ''
  return { rua, numero, bairro, cidade, estado, cep, complemento }
}

function getOrderCustomerName(order) {
  return order.customer?.nome || order.customer?.pushName || order.nome || order.customerName || `Pedido #${order.id}`
}

function getOrderCustomerPhone(order) {
  return order.customer?.telefone || order.telefone || ''
}

function getOrderPendingValue(order, financial = []) {
  if (order.totalCobrar != null) {
    const pago = Number(order.totalPago || 0)
    return Math.max(0, Number(order.totalCobrar) - pago)
  }
  if (order.valorEmAberto != null) return Number(order.valorEmAberto)
  const relatedFin = financial.filter(f => String(f.order_id || f.orderId) === String(order.id) && f.status === 'pendente')
  if (relatedFin.length > 0) {
    return relatedFin.reduce((sum, f) => sum + (Number(f.data?.valor || f.valor || 0)), 0)
  }
  return Number(order.total || order.totalNota || 0)
}

function isAddressIncomplete(addr) {
  return !addr.rua || !addr.numero || !addr.cidade
}

export default function MontagemRota({
  jornada,
  orders = [],
  financial = [],
  onSaveRota,
  onCancel,
  showToast
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCity, setSelectedCity] = useState('TODAS')
  const [selectedStatus, setSelectedStatus] = useState('TODOS')
  
  // Selected order IDs in ordered sequence
  const [selectedOrderIds, setSelectedOrderIds] = useState(() => {
    if (jornada?.paradas && jornada.paradas.length > 0) {
      return jornada.paradas.map(p => String(p.pedidoId))
    }
    if (jornada?.pedidos_ids && jornada.pedidos_ids.length > 0) {
      return jornada.pedidos_ids.map(id => String(id))
    }
    return []
  })

  const [highlightedOrderId, setHighlightedOrderId] = useState(null)
  const mapRef = useRef(null)
  const gMap = useRef(null)
  const markersRef = useRef({})
  const [mapLoaded, setMapLoaded] = useState(false)

  // Eligible orders: status in ['em-rota', 'pendente', 'confirmado', 'em-andamento'] OR already in current journey
  const eligibleOrders = useMemo(() => {
    return orders.filter(o => {
      const isAlreadyInRota = selectedOrderIds.includes(String(o.id))
      if (isAlreadyInRota) return true
      if (o.status === 'cancelado' || o.status === 'concluido') return false
      return ['em-rota', 'pendente', 'confirmado', 'em-andamento', 'pre-pedido'].includes(o.status)
    })
  }, [orders, selectedOrderIds])

  // Cities extracted from eligible orders
  const availableCities = useMemo(() => {
    const set = new Set()
    eligibleOrders.forEach(o => {
      const addr = getOrderAddress(o)
      if (addr.cidade) set.add(addr.cidade.trim())
    })
    return ['TODAS', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [eligibleOrders])

  // Filtered orders for selection
  const filteredOrders = useMemo(() => {
    return eligibleOrders.filter(o => {
      const addr = getOrderAddress(o)
      const nome = getOrderCustomerName(o)
      const tel = getOrderCustomerPhone(o)
      const idStr = String(o.id)

      if (selectedCity !== 'TODAS' && normalizeStr(addr.cidade) !== normalizeStr(selectedCity)) {
        return false
      }
      if (selectedStatus !== 'TODOS' && o.status !== selectedStatus) {
        return false
      }
      if (searchTerm.trim()) {
        const query = normalizeStr(searchTerm)
        const match = normalizeStr(nome).includes(query) ||
          normalizeStr(tel).includes(query) ||
          idStr.includes(query) ||
          normalizeStr(addr.rua).includes(query) ||
          normalizeStr(addr.bairro).includes(query) ||
          normalizeStr(addr.cidade).includes(query)
        if (!match) return false
      }
      return true
    })
  }, [eligibleOrders, selectedCity, selectedStatus, searchTerm])

  // Summary calculations
  const summary = useMemo(() => {
    const selectedOrders = orders.filter(o => selectedOrderIds.includes(String(o.id)))
    const count = selectedOrders.length
    const totalCobrar = selectedOrders.reduce((sum, o) => sum + getOrderPendingValue(o, financial), 0)
    const incompleteCount = selectedOrders.filter(o => isAddressIncomplete(getOrderAddress(o))).length
    return { count, totalCobrar, incompleteCount }
  }, [orders, selectedOrderIds, financial])

  // Initialize Google Maps
  useEffect(() => {
    if (window.google?.maps) {
      setMapLoaded(true)
      return
    }
    const scriptId = 'google-maps-script'
    if (!document.getElementById(scriptId)) {
      window.initMontagemMap = () => setMapLoaded(true)
      const s = document.createElement('script')
      s.id = scriptId
      s.src = `https://maps.googleapis.com/maps/api/js?key=${GM_KEY}&callback=initMontagemMap`
      s.async = true
      s.defer = true
      document.head.appendChild(s)
    }
  }, [])

  // Create Google Map instance
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || gMap.current) return
    try {
      const m = new window.google.maps.Map(mapRef.current, {
        center: { lat: -19.92, lng: -43.94 }, // default Belo Horizonte
        zoom: 11,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
      })
      gMap.current = m
    } catch (e) {
      console.warn('Erro ao inicializar mapa:', e)
    }
  }, [mapLoaded])

  // Render markers on map
  useEffect(() => {
    if (!gMap.current || !window.google?.maps) return

    // Clear old markers
    Object.values(markersRef.current).forEach(m => m.setMap(null))
    markersRef.current = {}

    const bounds = new window.google.maps.LatLngBounds()
    let hasCoords = false

    filteredOrders.forEach((order) => {
      const ordId = String(order.id)
      const isSelected = selectedOrderIds.includes(ordId)
      const seqIndex = selectedOrderIds.indexOf(ordId) + 1
      const addr = getOrderAddress(order)
      
      let latLng = null
      const normCity = normalizeStr(addr.cidade)
      if (CIDADE_COORDS[normCity]) {
        // jitter slightly by order id to avoid overlap in same city
        const jx = ((Number(ordId) % 100) - 50) / 3000
        const jy = (((Number(ordId) * 7) % 100) - 50) / 3000
        latLng = {
          lat: CIDADE_COORDS[normCity][0] + jx,
          lng: CIDADE_COORDS[normCity][1] + jy
        }
      }

      if (latLng) {
        bounds.extend(latLng)
        hasCoords = true

        const markerColor = isSelected ? '#10b981' : '#94a3b8'
        const labelText = isSelected ? String(seqIndex) : '•'

        const marker = new window.google.maps.Marker({
          position: latLng,
          map: gMap.current,
          title: `${getOrderCustomerName(order)} - ${addr.rua}, ${addr.numero} (${addr.cidade})`,
          label: {
            text: labelText,
            color: '#ffffff',
            fontWeight: 'bold',
            fontSize: '12px'
          },
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: isSelected ? 16 : 10,
            fillColor: markerColor,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2
          }
        })

        marker.addListener('click', () => {
          setHighlightedOrderId(ordId)
        })

        markersRef.current[ordId] = marker
      }
    })

    if (hasCoords) {
      gMap.current.fitBounds(bounds)
      const listener = window.google.maps.event.addListener(gMap.current, 'idle', () => {
        if (gMap.current.getZoom() > 14) gMap.current.setZoom(14)
        window.google.maps.event.removeListener(listener)
      })
    }
  }, [filteredOrders, selectedOrderIds, mapLoaded])

  const toggleSelectOrder = (orderId) => {
    const idStr = String(orderId)
    setSelectedOrderIds(prev => {
      if (prev.includes(idStr)) {
        return prev.filter(x => x !== idStr)
      } else {
        return [...prev, idStr]
      }
    })
  }

  const selectAllFiltered = () => {
    const idsToAdd = filteredOrders.map(o => String(o.id))
    setSelectedOrderIds(prev => {
      const set = new Set([...prev, ...idsToAdd])
      return Array.from(set)
    })
    showToast?.(`${idsToAdd.length} pedidos adicionados à rota.`)
  }

  const deselectAllFiltered = () => {
    const idsToRemove = new Set(filteredOrders.map(o => String(o.id)))
    setSelectedOrderIds(prev => prev.filter(id => !idsToRemove.has(id)))
    showToast?.('Seleção limpa.')
  }

  const moveOrder = (index, direction) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= selectedOrderIds.length) return
    const updated = [...selectedOrderIds]
    const temp = updated[index]
    updated[index] = updated[targetIndex]
    updated[targetIndex] = temp
    setSelectedOrderIds(updated)
  }

  const handleConfirmRota = () => {
    if (selectedOrderIds.length === 0) {
      showToast?.('Selecione pelo menos um pedido para a rota.', 'warning')
      return
    }

    // Build paradas preserving previous statuses if existing
    const existingParadasMap = new Map()
    if (jornada?.paradas) {
      jornada.paradas.forEach(p => existingParadasMap.set(String(p.pedidoId), p))
    }

    const novasParadas = selectedOrderIds.map((id, index) => {
      const existing = existingParadasMap.get(id)
      return {
        id: existing?.id || `parada_${id}_${Date.now()}`,
        pedidoId: Number(id),
        ordem: index + 1,
        statusLogistico: existing?.statusLogistico || 'pendente',
        motivoFalha: existing?.motivoFalha || null,
        observacao: existing?.observacao || '',
        tentativaEm: existing?.tentativaEm || null,
        concluidaEm: existing?.concluidaEm || null
      }
    })

    onSaveRota({
      ...jornada,
      pedidos_ids: selectedOrderIds.map(Number),
      paradas: novasParadas
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Top Banner / Summary */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        padding: '16px 20px',
        border: '1px solid #e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '10px',
            background: '#ecfdf5',
            color: '#10b981',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2rem'
          }}>
            <i className="fa-solid fa-map-location-dot"></i>
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#1e293b' }}>
              Montagem da Rota
            </h3>
            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
              Selecione os pedidos e defina a ordem de atendimento das entregas.
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            padding: '8px 14px',
            borderRadius: '8px',
            textAlign: 'right'
          }}>
            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>SELECIONADOS</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#059669' }}>
              {summary.count} {summary.count === 1 ? 'pedido' : 'pedidos'}
            </div>
          </div>

          <div style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            padding: '8px 14px',
            borderRadius: '8px',
            textAlign: 'right'
          }}>
            <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>VALOR A COBRAR</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b' }}>
              R$ {summary.totalCobrar.toFixed(2).replace('.', ',')}
            </div>
          </div>

          <button
            type="button"
            className="mr-btn mr-btn-secondary"
            onClick={onCancel}
          >
            Voltar
          </button>
          <button
            type="button"
            className="mr-btn mr-btn-primary mr-btn-lg"
            onClick={handleConfirmRota}
            disabled={summary.count === 0}
          >
            <i className="fa-solid fa-check"></i> Salvar e Iniciar Rota
          </button>
        </div>
      </div>

      {summary.incompleteCount > 0 && (
        <div style={{
          background: '#fffbeb',
          border: '1px solid #fde68a',
          color: '#92400e',
          padding: '10px 14px',
          borderRadius: '8px',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <i className="fa-solid fa-triangle-exclamation"></i>
          Atenção: {summary.incompleteCount} pedido(s) selecionado(s) possuem endereço sem número ou cidade incompletos.
        </div>
      )}

      {/* Grid: Orders List & Map / Sequence */}
      <div className="mr-montagem-grid">
        {/* Left: Orders Selection */}
        <div className="mr-orders-selection-card">
          <div className="mr-selection-filters">
            <input
              type="text"
              className="mr-search-input"
              placeholder="Buscar cliente, telefone, endereço ou #pedido..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            <div className="mr-filter-row">
              <select
                className="mr-filter-select"
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
              >
                {availableCities.map(c => (
                  <option key={c} value={c}>{c === 'TODAS' ? 'Todas as Cidades' : c}</option>
                ))}
              </select>

              <select
                className="mr-filter-select"
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
              >
                <option value="TODOS">Todos os Status</option>
                <option value="em-rota">Em Rota</option>
                <option value="pendente">Pendente</option>
                <option value="confirmado">Confirmado</option>
                <option value="em-andamento">Em Andamento</option>
              </select>

              <button
                type="button"
                className="mr-btn mr-btn-secondary"
                style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                onClick={selectAllFiltered}
                title="Marcar todos os pedidos desta lista"
              >
                Marcar Todos
              </button>
              <button
                type="button"
                className="mr-btn mr-btn-secondary"
                style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                onClick={deselectAllFiltered}
                title="Desmarcar pedidos"
              >
                Limpar
              </button>
            </div>
          </div>

          <div className="mr-selection-list">
            {filteredOrders.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                <i className="fa-solid fa-inbox" style={{ fontSize: '2rem', marginBottom: '8px' }}></i>
                <p style={{ margin: 0 }}>Nenhum pedido elegível encontrado para estes filtros.</p>
              </div>
            ) : (
              filteredOrders.map(order => {
                const idStr = String(order.id)
                const isSelected = selectedOrderIds.includes(idStr)
                const seq = selectedOrderIds.indexOf(idStr) + 1
                const addr = getOrderAddress(order)
                const incomplete = isAddressIncomplete(addr)
                const pendingVal = getOrderPendingValue(order, financial)

                return (
                  <div
                    key={order.id}
                    className={`mr-order-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleSelectOrder(order.id)}
                    style={{
                      borderLeft: highlightedOrderId === idStr ? '4px solid #3b82f6' : undefined
                    }}
                  >
                    <input
                      type="checkbox"
                      className="mr-order-checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      onClick={(e) => e.stopPropagation()}
                    />

                    {isSelected && (
                      <div style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '50%',
                        background: '#10b981',
                        color: 'white',
                        fontWeight: 800,
                        fontSize: '0.78rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        {seq}
                      </div>
                    )}

                    <div className="mr-order-details">
                      <div className="mr-order-title-line">
                        <span className="mr-order-client">{getOrderCustomerName(order)}</span>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#059669' }}>
                          R$ {pendingVal.toFixed(2).replace('.', ',')}
                        </span>
                      </div>

                      <div className="mr-order-addr">
                        <i className="fa-solid fa-location-dot" style={{ marginRight: '4px', color: '#94a3b8' }}></i>
                        {addr.rua ? `${addr.rua}, ${addr.numero || 'S/N'}` : 'Endereço não informado'}
                        {addr.bairro ? ` - ${addr.bairro}` : ''} ({addr.cidade || 'Sem cidade'})
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: '0.7rem',
                          background: '#f1f5f9',
                          color: '#475569',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 600
                        }}>
                          #{String(order.id).slice(-6)}
                        </span>
                        <span style={{
                          fontSize: '0.7rem',
                          background: order.status === 'em-rota' ? '#fef3c7' : '#e0e7ff',
                          color: order.status === 'em-rota' ? '#b45309' : '#3730a3',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                          textTransform: 'uppercase'
                        }}>
                          {order.status}
                        </span>
                        {incomplete && (
                          <span className="mr-addr-warning">
                            <i className="fa-solid fa-exclamation-triangle"></i> Endereço incompleto
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right: Map & Ordered Sequence List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Map */}
          <div style={{
            background: 'white',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              padding: '10px 14px',
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.85rem',
              fontWeight: 700,
              color: '#334155'
            }}>
              <span><i className="fa-solid fa-map" style={{ color: '#3b82f6', marginRight: '6px' }}></i> Visualização no Mapa</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#64748b' }}>
                Verde: Selecionado com número de parada
              </span>
            </div>
            <div
              ref={mapRef}
              style={{
                width: '100%',
                height: '320px',
                background: '#e2e8f0'
              }}
            />
          </div>

          {/* Sequence List with Up/Down buttons */}
          <div style={{
            background: 'white',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: '420px'
          }}>
            <div style={{
              padding: '12px 16px',
              background: '#f8fafc',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: '#1e293b' }}>
                Ordem das Paradas ({selectedOrderIds.length})
              </h4>
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                Use as setas para ajustar a sequência de entrega
              </span>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {selectedOrderIds.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                  Nenhum pedido na rota. Marque os pedidos ao lado para montar a sequência.
                </div>
              ) : (
                selectedOrderIds.map((id, index) => {
                  const order = orders.find(o => String(o.id) === id)
                  if (!order) return null
                  const addr = getOrderAddress(order)

                  return (
                    <div
                      key={id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 14px',
                        borderBottom: '1px solid #f1f5f9',
                        background: index === 0 ? '#f0fdf4' : 'white'
                      }}
                    >
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        background: index === 0 ? '#10b981' : '#e2e8f0',
                        color: index === 0 ? 'white' : '#475569',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        {index + 1}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {getOrderCustomerName(order)}
                          {index === 0 && (
                            <span style={{ marginLeft: '6px', fontSize: '0.68rem', background: '#dcfce7', color: '#15803d', padding: '1px 5px', borderRadius: '4px', fontWeight: 800 }}>
                              1ª PARADA
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {addr.rua ? `${addr.rua}, ${addr.numero || 'S/N'}` : 'Sem rua'} • {addr.cidade}
                        </div>
                      </div>

                      <div className="mr-stop-reorder">
                        <button
                          type="button"
                          className="mr-reorder-btn"
                          disabled={index === 0}
                          onClick={() => moveOrder(index, -1)}
                          title="Mover para cima"
                        >
                          <i className="fa-solid fa-arrow-up"></i>
                        </button>
                        <button
                          type="button"
                          className="mr-reorder-btn"
                          disabled={index === selectedOrderIds.length - 1}
                          onClick={() => moveOrder(index, 1)}
                          title="Mover para baixo"
                        >
                          <i className="fa-solid fa-arrow-down"></i>
                        </button>
                      </div>

                      <button
                        type="button"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ef4444',
                          cursor: 'pointer',
                          padding: '4px',
                          fontSize: '0.85rem'
                        }}
                        onClick={() => toggleSelectOrder(id)}
                        title="Remover da rota"
                      >
                        <i className="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

