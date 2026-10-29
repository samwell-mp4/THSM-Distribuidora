import React, { useState, useEffect, useCallback, useMemo } from 'react'
import './ModuloRotas.css'
import JornadaAberturaModal from './JornadaAberturaModal'
import MontagemRota from './MontagemRota'
import ModoEntregador from './ModoEntregador'
import DespesasJornadaModal from './DespesasJornadaModal'
import FechamentoJornadaModal from './FechamentoJornadaModal'
import HistoricoJornadas from './HistoricoJornadas'
import { getAllJornadas, upsertJornada, deleteJornada as dbDeleteJornada } from '../../lib/supabase'

const STORAGE_JORNADA_ATIVA = 'thsm_jornada_ativa'
const STORAGE_HISTORICO_JORNADAS = 'thsm_jornadas_historico'

export default function CentralRotas({
  orders = [],
  financial = [],
  despesas = [],
  setDespesas,
  openAcertoModal,
  updateOrderStatus,
  usuarios = [],
  produtosAtuais = [],
  showToast,
  renderContatosTab // Render prop to preserve WhatsApp Contatos view
}) {
  const [subTab, setSubTab] = useState(() => {
    return sessionStorage.getItem('thsm_rotas_subtab') || 'operacao'
  })

  // Active Journey
  const [jornadaAtiva, setJornadaAtiva] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_JORNADA_ATIVA)
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  // History of closed journeys
  const [historico, setHistorico] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_HISTORICO_JORNADAS)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  // View mode inside 'operacao': 'entregador' or 'montagem'
  const [viewMode, setViewMode] = useState(() => {
    const saved = localStorage.getItem(STORAGE_JORNADA_ATIVA)
    if (saved) {
      try {
        const j = JSON.parse(saved)
        if (j.paradas && j.paradas.length > 0) return 'entregador'
      } catch {}
    }
    return 'montagem'
  })

  // Modals
  const [showAberturaModal, setShowAberturaModal] = useState(false)
  const [showDespesasModal, setShowDespesasModal] = useState(false)
  const [showFechamentoModal, setShowFechamentoModal] = useState(false)

  // Save subTab in session
  const handleSelectSubTab = (tab) => {
    setSubTab(tab)
    sessionStorage.setItem('thsm_rotas_subtab', tab)
  }

  // Initial fetch from PostgreSQL
  useEffect(() => {
    async function carregarJornadasDoBanco() {
      const dbJornadas = await getAllJornadas()
      if (Array.isArray(dbJornadas) && dbJornadas.length > 0) {
        const aberta = dbJornadas.find(j => j.status === 'aberta')
        const fechadas = dbJornadas.filter(j => j.status !== 'aberta')

        if (aberta && !jornadaAtiva) {
          setJornadaAtiva(aberta)
          localStorage.setItem(STORAGE_JORNADA_ATIVA, JSON.stringify(aberta))
        }

        if (fechadas.length > 0) {
          setHistorico(fechadas)
          localStorage.setItem(STORAGE_HISTORICO_JORNADAS, JSON.stringify(fechadas))
        }
      }
    }
    carregarJornadasDoBanco()
  }, [])

  // Persist active journey helper
  const salvarJornadaAtiva = useCallback((jornada) => {
    setJornadaAtiva(jornada)
    if (jornada) {
      localStorage.setItem(STORAGE_JORNADA_ATIVA, JSON.stringify(jornada))
      upsertJornada(jornada)
    } else {
      localStorage.removeItem(STORAGE_JORNADA_ATIVA)
    }
  }, [])

  // Start new journey
  const handleStartJornada = (novaJornada) => {
    salvarJornadaAtiva(novaJornada)
    setShowAberturaModal(false)
    setViewMode('montagem')
    showToast?.(`Jornada aberta com sucesso! Motorista: ${novaJornada.operador}`)
  }

  // Save stops from MontagemRota
  const handleSaveRotaStops = (jornadaAtualizada) => {
    salvarJornadaAtiva(jornadaAtualizada)
    
    // Set status of eligible orders to 'em-rota'
    if (jornadaAtualizada.paradas) {
      jornadaAtualizada.paradas.forEach(p => {
        const order = orders.find(o => String(o.id) === String(p.pedidoId))
        if (order && order.status !== 'em-rota' && order.status !== 'entregue' && order.status !== 'concluido') {
          updateOrderStatus(order.id, 'em-rota')
        }
      })
    }

    setViewMode('entregador')
    showToast?.('Rota montada e pronta para entrega!')
  }

  // Add expense linked to journey and central despesas
  const handleAddDespesa = (novaDespesa) => {
    if (setDespesas) {
      setDespesas(prev => [novaDespesa, ...prev])
    }

    if (jornadaAtiva) {
      const updatedDespesasIds = [...(jornadaAtiva.despesas_ids || []), novaDespesa.id]
      const updatedJornada = {
        ...jornadaAtiva,
        despesas_ids: updatedDespesasIds
      }
      salvarJornadaAtiva(updatedJornada)
    }

    showToast?.(`Despesa de R$ ${novaDespesa.valor.toFixed(2)} lançada e sincronizada!`)
  }

  // Confirm closure
  const handleConfirmFechamento = (jornadaFechada) => {
    // Save to PostgreSQL
    upsertJornada(jornadaFechada)

    // Move to history
    setHistorico(prev => {
      const next = [jornadaFechada, ...prev.filter(j => j.id !== jornadaFechada.id)]
      localStorage.setItem(STORAGE_HISTORICO_JORNADAS, JSON.stringify(next))
      return next
    })

    // Clear active journey
    salvarJornadaAtiva(null)
    setShowFechamentoModal(false)
    setViewMode('montagem')
    setSubTab('historico')

    showToast?.('Jornada encerrada e prestação de contas concluída com sucesso!')
  }

  // Reopen journey
  const handleReabrirJornada = (jornada) => {
    if (jornadaAtiva) {
      showToast?.('Já existe uma jornada em aberto. Feche ou cancele a atual antes de reabrir outra.', 'warning')
      return
    }

    const reaberta = {
      ...jornada,
      status: 'aberta',
      finalizou_em: null
    }

    salvarJornadaAtiva(reaberta)
    setHistorico(prev => {
      const next = prev.filter(j => j.id !== jornada.id)
      localStorage.setItem(STORAGE_HISTORICO_JORNADAS, JSON.stringify(next))
      return next
    })
    setSubTab('operacao')
    setViewMode('entregador')
    showToast?.(`Jornada de ${jornada.operador} reaberta para correções.`)
  }

  // Delete journey from history
  const handleExcluirJornada = async (id) => {
    await dbDeleteJornada(id)
    setHistorico(prev => {
      const next = prev.filter(j => j.id !== id)
      localStorage.setItem(STORAGE_HISTORICO_JORNADAS, JSON.stringify(next))
      return next
    })
    showToast?.('Registro de jornada excluído com sucesso.')
  }

  // Summary counts for badges
  const totalParadasAtivas = jornadaAtiva?.paradas?.length || 0
  const totalEntreguesAtivas = jornadaAtiva?.paradas?.filter(p => p.statusLogistico === 'entregue').length || 0

  return (
    <div className="mr-container">
      {/* Subtabs Switcher */}
      <div className="mr-subtabs">
        <button
          type="button"
          className={`mr-subtab-btn ${subTab === 'operacao' ? 'active' : ''}`}
          onClick={() => handleSelectSubTab('operacao')}
        >
          <i className="fa-solid fa-truck-fast"></i>
          Operação do Dia
          {jornadaAtiva && (
            <span className="mr-badge-pill">
              {totalEntreguesAtivas}/{totalParadasAtivas}
            </span>
          )}
        </button>

        <button
          type="button"
          className={`mr-subtab-btn ${subTab === 'historico' ? 'active' : ''}`}
          onClick={() => handleSelectSubTab('historico')}
        >
          <i className="fa-solid fa-clock-rotate-left"></i>
          Histórico e Fechamentos
          {historico.length > 0 && (
            <span className="mr-badge-pill" style={{ background: '#64748b' }}>
              {historico.length}
            </span>
          )}
        </button>

        <button
          type="button"
          className={`mr-subtab-btn ${subTab === 'contatos' ? 'active' : ''}`}
          onClick={() => handleSelectSubTab('contatos')}
        >
          <i className="fa-brands fa-whatsapp"></i>
          Contatos & Cidades WhatsApp
        </button>
      </div>

      {/* SUBTAB 1: OPERAÇÃO DO DIA */}
      {subTab === 'operacao' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {!jornadaAtiva ? (
            /* Nenhum jornada aberta */
            <div className="mr-empty-jornada-card">
              <div className="mr-empty-icon">
                <i className="fa-solid fa-route"></i>
              </div>
              <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#1e293b' }}>
                Nenhuma Jornada Aberta no Momento
              </h2>
              <p style={{ margin: 0, color: '#64748b', maxWidth: '480px', fontSize: '0.92rem' }}>
                Abra a jornada de hoje informando o motorista, veículo e o KM inicial para selecionar os pedidos e iniciar as entregas.
              </p>
              <button
                type="button"
                className="mr-btn mr-btn-primary mr-btn-lg"
                onClick={() => setShowAberturaModal(true)}
              >
                <i className="fa-solid fa-play"></i> Abrir Jornada do Entregador
              </button>
            </div>
          ) : (
            /* Jornada Aberta: Modo Montagem ou Modo Entregador */
            <div>
              {viewMode === 'montagem' ? (
                <MontagemRota
                  jornada={jornadaAtiva}
                  orders={orders}
                  financial={financial}
                  onSaveRota={handleSaveRotaStops}
                  onCancel={() => {
                    if (jornadaAtiva.paradas && jornadaAtiva.paradas.length > 0) {
                      setViewMode('entregador')
                    } else {
                      showToast?.('Selecione os pedidos para montar a rota.')
                    }
                  }}
                  showToast={showToast}
                />
              ) : (
                <ModoEntregador
                  jornada={jornadaAtiva}
                  orders={orders}
                  financial={financial}
                  onUpdateJornada={salvarJornadaAtiva}
                  onOpenAcertoModal={openAcertoModal}
                  onOpenDespesasModal={() => setShowDespesasModal(true)}
                  onOpenFechamentoModal={() => setShowFechamentoModal(true)}
                  onVoltarMontagem={() => setViewMode('montagem')}
                  onUpdateOrderStatus={updateOrderStatus}
                  showToast={showToast}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* SUBTAB 2: HISTÓRICO */}
      {subTab === 'historico' && (
        <HistoricoJornadas
          historico={historico}
          orders={orders}
          despesas={despesas}
          onReabrirJornada={handleReabrirJornada}
          onExcluirJornada={handleExcluirJornada}
          showToast={showToast}
        />
      )}

      {/* SUBTAB 3: CONTATOS WHATSAPP (Preservado 100%) */}
      {subTab === 'contatos' && (
        <div>
          {renderContatosTab && renderContatosTab()}
        </div>
      )}

      {/* MODAIS GLOBAIS */}
      <JornadaAberturaModal
        isOpen={showAberturaModal}
        onClose={() => setShowAberturaModal(false)}
        onStartJornada={handleStartJornada}
        defaultOperador="Administrador"
      />

      <DespesasJornadaModal
        isOpen={showDespesasModal}
        onClose={() => setShowDespesasModal(false)}
        jornada={jornadaAtiva}
        onAddDespesa={handleAddDespesa}
      />

      <FechamentoJornadaModal
        isOpen={showFechamentoModal}
        onClose={() => setShowFechamentoModal(false)}
        jornada={jornadaAtiva}
        orders={orders}
        despesas={despesas}
        onConfirmFechamento={handleConfirmFechamento}
        showToast={showToast}
      />
    </div>
  )
}

