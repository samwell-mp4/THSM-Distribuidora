import React, { useState } from 'react'

export default function HistoricoJornadas({
  historico = [],
  orders = [],
  despesas = [],
  onVerDetalhes,
  onReabrirJornada,
  onExcluirJornada,
  showToast
}) {
  const [selectedJornada, setSelectedJornada] = useState(null)
  const [filtroData, setFiltroData] = useState('')
  const [filtroMotorista, setFiltroMotorista] = useState('')

  const jornadasFiltradas = historico.filter(j => {
    if (filtroData && j.data !== filtroData) return false
    if (filtroMotorista.trim()) {
      const q = filtroMotorista.toLowerCase()
      const match = (j.operador || '').toLowerCase().includes(q) || (j.veiculo || '').toLowerCase().includes(q)
      if (!match) return false
    }
    return true
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header and filters */}
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
        <div>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#1e293b' }}>
            Histórico de Jornadas e Fechamentos
          </h3>
          <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
            Consulte rotas encerradas, prestação de contas e relatórios operacionais.
          </span>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="date"
            className="mr-search-input"
            style={{ width: 'auto' }}
            value={filtroData}
            onChange={(e) => setFiltroData(e.target.value)}
          />
          <input
            type="text"
            className="mr-search-input"
            style={{ width: '180px' }}
            placeholder="Filtrar motorista..."
            value={filtroMotorista}
            onChange={(e) => setFiltroMotorista(e.target.value)}
          />
          {(filtroData || filtroMotorista) && (
            <button
              type="button"
              className="mr-btn mr-btn-secondary"
              onClick={() => { setFiltroData(''); setFiltroMotorista('') }}
            >
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Grid or Empty */}
      {jornadasFiltradas.length === 0 ? (
        <div className="mr-empty-jornada-card">
          <div className="mr-empty-icon" style={{ background: '#f1f5f9', color: '#64748b' }}>
            <i className="fa-solid fa-clock-rotate-left"></i>
          </div>
          <h3 style={{ margin: 0, color: '#1e293b' }}>Nenhuma jornada no histórico</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.9rem' }}>
            As jornadas encerradas e prestadas contas aparecerão registradas aqui.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
          {jornadasFiltradas.map((j) => {
            const resumo = j.resumo_fechamento || {}
            const paradas = j.paradas || []
            const totalParadas = paradas.length
            const entregues = paradas.filter(p => p.statusLogistico === 'entregue').length
            const kmRodados = j.km_final && j.km_inicial ? Math.max(0, Number(j.km_final) - Number(j.km_inicial)) : (resumo.kmPercorrido || 0)

            return (
              <div
                key={j.id}
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  padding: '18px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                      {j.data}
                    </span>
                    <h4 style={{ margin: '2px 0 0 0', fontSize: '1rem', fontWeight: 800, color: '#1e293b' }}>
                      {j.operador}
                    </h4>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {j.veiculo || 'Veículo THSM'}
                    </span>
                  </div>

                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    padding: '3px 8px',
                    borderRadius: '6px',
                    background: j.status === 'fechada' ? '#dcfce7' : '#fef3c7',
                    color: j.status === 'fechada' ? '#15803d' : '#b45309',
                    textTransform: 'uppercase'
                  }}>
                    {j.status === 'fechada' ? 'Encerrada' : j.status}
                  </span>
                </div>

                <div style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: '8px',
                  textAlign: 'center'
                }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>RODADOS</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#1e293b' }}>
                      {kmRodados > 0 ? `${kmRodados} km` : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>ENTREGAS</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#059669' }}>
                      {entregues} / {totalParadas}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>CAIXA ENTREGUE</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#047857' }}>
                      R$ {(resumo.saldoDinheiroDevolver != null ? resumo.saldoDinheiroDevolver : 0).toFixed(2).replace('.', ',')}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                  <button
                    type="button"
                    className="mr-btn mr-btn-secondary"
                    style={{ flex: 1, padding: '8px 12px', fontSize: '0.82rem' }}
                    onClick={() => setSelectedJornada(j)}
                  >
                    <i className="fa-solid fa-eye"></i> Ver Detalhes
                  </button>

                  {onReabrirJornada && (
                    <button
                      type="button"
                      className="mr-btn mr-btn-warning"
                      style={{ padding: '8px 12px', fontSize: '0.82rem' }}
                      onClick={() => {
                        if (window.confirm(`Deseja reabrir a jornada de ${j.operador} (${j.data}) para correções?`)) {
                          onReabrirJornada(j)
                        }
                      }}
                      title="Reabrir Jornada"
                    >
                      <i className="fa-solid fa-rotate-left"></i>
                    </button>
                  )}

                  {onExcluirJornada && (
                    <button
                      type="button"
                      className="mr-btn mr-btn-danger"
                      style={{ padding: '8px 10px', fontSize: '0.82rem' }}
                      onClick={() => {
                        if (window.confirm(`Excluir permanentemente o registro desta jornada? Esta ação não pode ser desfeita.`)) {
                          onExcluirJornada(j.id)
                        }
                      }}
                      title="Excluir Registro"
                    >
                      <i className="fa-solid fa-trash-can"></i>
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Details Modal */}
      {selectedJornada && (
        <div className="mr-modal-overlay" onClick={() => setSelectedJornada(null)}>
          <div className="mr-modal-box" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
            <div className="mr-modal-header">
              <h3>
                <i className="fa-solid fa-file-invoice-dollar" style={{ color: '#10b981' }}></i>
                Detalhes da Jornada ({selectedJornada.data})
              </h3>
              <button
                type="button"
                className="mr-reorder-btn"
                onClick={() => setSelectedJornada(null)}
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            </div>

            <div className="mr-modal-body">
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px 16px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
                fontSize: '0.88rem'
              }}>
                <div><strong>Motorista:</strong> {selectedJornada.operador}</div>
                <div><strong>Veículo:</strong> {selectedJornada.veiculo}</div>
                <div><strong>KM Inicial:</strong> {selectedJornada.km_inicial} km</div>
                <div><strong>KM Final:</strong> {selectedJornada.km_final || '—'} km</div>
                <div><strong>Iniciou em:</strong> {new Date(selectedJornada.iniciou_em).toLocaleString('pt-BR')}</div>
                <div><strong>Finalizou em:</strong> {selectedJornada.finalizou_em ? new Date(selectedJornada.finalizou_em).toLocaleString('pt-BR') : '—'}</div>
              </div>

              {selectedJornada.resumo_fechamento && (
                <div style={{
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  borderRadius: '8px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  fontSize: '0.88rem'
                }}>
                  <h4 style={{ margin: 0, color: '#065f46', fontWeight: 800 }}>Fechamento Financeiro</h4>
                  <div>💰 Total Faturado: R$ {(selectedJornada.resumo_fechamento.totalFaturado || 0).toFixed(2).replace('.', ',')}</div>
                  <div>💵 Recebido em Dinheiro: R$ {(selectedJornada.resumo_fechamento.recebidoDinheiro || 0).toFixed(2).replace('.', ',')}</div>
                  <div>⚡ Recebido via PIX: R$ {(selectedJornada.resumo_fechamento.recebidoPix || 0).toFixed(2).replace('.', ',')}</div>
                  <div>💳 Recebido em Cartão: R$ {(selectedJornada.resumo_fechamento.recebidoCartao || 0).toFixed(2).replace('.', ',')}</div>
                  <div style={{ borderTop: '1px dashed #6ee7b7', paddingTop: '6px', marginTop: '4px', fontWeight: 800, color: '#047857' }}>
                    💵 Dinheiro Entregue ao Caixa: R$ {(selectedJornada.resumo_fechamento.saldoDinheiroDevolver || 0).toFixed(2).replace('.', ',')}
                  </div>
                </div>
              )}

              {/* Stops summary */}
              <div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.92rem', fontWeight: 800, color: '#1e293b' }}>
                  Paradas da Rota ({selectedJornada.paradas?.length || 0})
                </h4>
                <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                  {(selectedJornada.paradas || []).map((p, idx) => {
                    const order = orders.find(o => String(o.id) === String(p.pedidoId))
                    return (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          borderBottom: '1px solid #f1f5f9',
                          fontSize: '0.82rem'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontWeight: 800, color: '#64748b' }}>#{p.ordem || idx + 1}</span>
                          <span>{order?.customer?.nome || order?.nome || `Pedido #${p.pedidoId}`}</span>
                        </div>
                        <span style={{
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 700,
                          fontSize: '0.72rem',
                          background: p.statusLogistico === 'entregue' ? '#dcfce7' : (p.statusLogistico === 'tentativa_sem_sucesso' ? '#fee2e2' : '#f1f5f9'),
                          color: p.statusLogistico === 'entregue' ? '#15803d' : (p.statusLogistico === 'tentativa_sem_sucesso' ? '#b91c1c' : '#475569')
                        }}>
                          {p.statusLogistico === 'entregue' ? 'Entregue' : (p.statusLogistico === 'tentativa_sem_sucesso' ? `Falha: ${p.motivoFalha || 'Não entregue'}` : 'Pendente')}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="mr-modal-footer">
              <button
                type="button"
                className="mr-btn mr-btn-secondary"
                onClick={() => setSelectedJornada(null)}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

