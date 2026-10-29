import React, { useState, useMemo, useEffect } from 'react'

export default function FechamentoJornadaModal({
  isOpen,
  onClose,
  jornada,
  orders = [],
  despesas = [],
  onConfirmFechamento,
  showToast
}) {
  const [kmFinal, setKmFinal] = useState('')
  const [observacoesFinais, setObservacoesFinais] = useState('')
  const [dinheiroDeclarado, setDinheiroDeclarado] = useState('')
  const [showSummaryView, setShowSummaryView] = useState(false)
  const [closedSnapshot, setClosedSnapshot] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  // Reset modal state whenever isOpen opens or active jornada changes
  useEffect(() => {
    if (isOpen && jornada) {
      setShowSummaryView(false)
      setClosedSnapshot(null)
      setKmFinal(jornada?.km_final != null ? String(jornada.km_final) : '')
      setDinheiroDeclarado('')
      setObservacoesFinais(jornada?.observacao_final || '')
      setErrorMsg('')
    }
  }, [isOpen, jornada?.id])

  // Orders in this journey
  const jornadaOrders = useMemo(() => {
    if (!jornada) return []
    const ids = new Set((jornada.paradas || []).map(p => String(p.pedidoId)))
    return orders.filter(o => ids.has(String(o.id)))
  }, [jornada, orders])

  // Despesas linked to this journey
  const rotaDespesas = useMemo(() => {
    if (!jornada) return []
    return despesas.filter(d => {
      if (d.jornadaId && String(d.jornadaId) === String(jornada.id)) return true
      if (d.data?.jornadaId && String(d.data.jornadaId) === String(jornada.id)) return true
      if (jornada.despesas_ids && jornada.despesas_ids.includes(d.id)) return true
      return false
    })
  }, [jornada, despesas])

  // Financial breakdown calculations
  const finReport = useMemo(() => {
    let totalFaturado = 0
    let totalRecebido = 0
    let recebidoDinheiro = 0
    let recebidoPix = 0
    let recebidoCartao = 0
    let totalAReceber = 0
    let entreguesCount = 0
    let pendentesCount = 0
    let falhasCount = 0

    const paradas = jornada?.paradas || []
    paradas.forEach(p => {
      if (p.statusLogistico === 'entregue') entreguesCount++
      else if (p.statusLogistico === 'tentativa_sem_sucesso') falhasCount++
      else pendentesCount++
    })

    jornadaOrders.forEach(o => {
      const orderTotal = Number(o.totalAcerto != null ? o.totalAcerto : (o.total || o.totalNota || 0))
      totalFaturado += orderTotal

      const pago = Number(o.totalPago || 0)
      totalRecebido += pago

      // Breakdown by payment method
      const splits = o.paymentSplits || {}
      if (splits && Object.keys(splits).length > 0) {
        Object.entries(splits).forEach(([method, val]) => {
          const num = Number(String(val).replace(',', '.')) || 0
          const m = method.toLowerCase()
          if (m.includes('dinheiro')) recebidoDinheiro += num
          else if (m.includes('pix')) recebidoPix += num
          else if (m.includes('cartao') || m.includes('cartão')) recebidoCartao += num
          else recebidoPix += num
        })
      } else {
        const pm = (o.paymentMethod || '').toLowerCase()
        if (pm.includes('dinheiro')) recebidoDinheiro += pago
        else if (pm.includes('pix')) recebidoPix += pago
        else if (pm.includes('cartao') || pm.includes('cartão')) recebidoCartao += pago
        else if (pago > 0) recebidoPix += pago
      }

      const emAberto = Number(o.valorEmAberto != null ? o.valorEmAberto : Math.max(0, orderTotal - pago))
      totalAReceber += emAberto
    })

    // Expenses breakdown
    let totalDespesas = 0
    let despesasDinheiroCaixa = 0
    let despesasCartaoEmpresa = 0
    let despesasPix = 0

    rotaDespesas.forEach(d => {
      const v = Number(d.valor || d.data?.valor || 0)
      totalDespesas += v
      const fp = d.formaPagamento || d.data?.formaPagamento || 'dinheiro_caixa'
      if (fp === 'dinheiro_caixa') despesasDinheiroCaixa += v
      else if (fp === 'cartao_empresa') despesasCartaoEmpresa += v
      else if (fp === 'pix') despesasPix += v
      else despesasCartaoEmpresa += v
    })

    // Cash that driver must hand in: only cash payments received minus expenses paid in cash from cashbox
    const saldoDinheiroDevolver = Math.max(0, Math.round((recebidoDinheiro - despesasDinheiroCaixa) * 100) / 100)

    return {
      totalFaturado,
      totalRecebido,
      recebidoDinheiro,
      recebidoPix,
      recebidoCartao,
      totalAReceber,
      totalDespesas,
      despesasDinheiroCaixa,
      despesasCartaoEmpresa,
      despesasPix,
      saldoDinheiroDevolver,
      entreguesCount,
      pendentesCount,
      falhasCount
    }
  }, [jornada, jornadaOrders, rotaDespesas])

  if (!isOpen || !jornada) return null

  const kmIni = Number(jornada.km_inicial || 0)
  const kmFin = kmFinal !== '' ? Number(kmFinal) : null
  const kmPercorrido = kmFin != null ? Math.max(0, kmFin - kmIni) : 0

  const handleProcederFechamento = (e) => {
    e.preventDefault()
    setErrorMsg('')

    if (kmFinal === '' || isNaN(kmFin) || kmFin < 0) {
      setErrorMsg('Informe o KM final do veículo.')
      return
    }

    if (kmFin < kmIni) {
      setErrorMsg(`O KM final (${kmFin}) não pode ser inferior ao KM inicial (${kmIni}). Verifique o odômetro.`)
      return
    }

    if (finReport.pendentesCount > 0) {
      if (!window.confirm(`Atenção: Existem ${finReport.pendentesCount} pedido(s) ainda pendente(s) na rota. Deseja fechar a jornada mesmo assim?`)) {
        return
      }
    }

    const agora = new Date().toISOString()
    const resumo = {
      ...finReport,
      kmInicial: kmIni,
      kmFinal: kmFin,
      kmPercorrido,
      dinheiroDeclarado: dinheiroDeclarado !== '' ? Number(dinheiroDeclarado) : finReport.saldoDinheiroDevolver,
      diferencaDinheiro: dinheiroDeclarado !== '' ? (Number(dinheiroDeclarado) - finReport.saldoDinheiroDevolver) : 0,
      fechadoEm: agora,
      observacoesFinais: observacoesFinais.trim()
    }

    setClosedSnapshot(resumo)
    setShowSummaryView(true)
  }

  const handleFinalizar = () => {
    const updatedJornada = {
      ...jornada,
      status: 'fechada',
      km_final: kmFin,
      finalizou_em: new Date().toISOString(),
      observacao_final: observacoesFinais.trim(),
      resumo_fechamento: closedSnapshot
    }

    setShowSummaryView(false)
    setClosedSnapshot(null)
    onConfirmFechamento(updatedJornada)
  }

  const handleClose = () => {
    setShowSummaryView(false)
    setClosedSnapshot(null)
    setErrorMsg('')
    onClose()
  }

  const gerarTextoCompartilhamento = () => {
    const s = closedSnapshot || finReport
    return `*📋 PRESTAÇÃO DE CONTAS - JORNADA THSM*
━━━━━━━━━━━━━━━━━━━━
*Data:* ${jornada.data}
*Motorista:* ${jornada.operador}
*Veículo:* ${jornada.veiculo}
*KM:* ${kmIni} ➔ ${kmFin || '—'} (${kmPercorrido} km rodados)
━━━━━━━━━━━━━━━━━━━━
*ENTREGAS:*
✅ Concluídas: ${finReport.entreguesCount}
⚠️ Falhas: ${finReport.falhasCount}
⏳ Pendentes: ${finReport.pendentesCount}
━━━━━━━━━━━━━━━━━━━━
*FINANCEIRO:*
💰 Total Faturado: R$ ${finReport.totalFaturado.toFixed(2)}
💵 Dinheiro Recebido: R$ ${finReport.recebidoDinheiro.toFixed(2)}
⚡ PIX Recebido: R$ ${finReport.recebidoPix.toFixed(2)}
💳 Cartão Recebido: R$ ${finReport.recebidoCartao.toFixed(2)}
--------------------
⛽ Despesas Dinheiro Caixa: R$ ${finReport.despesasDinheiroCaixa.toFixed(2)}
🏢 Despesas Cartão Empresa: R$ ${finReport.despesasCartaoEmpresa.toFixed(2)}
--------------------
*💵 DINHEIRO A ENTREGAR AO CAIXA:* *R$ ${finReport.saldoDinheiroDevolver.toFixed(2)}*
${s.dinheiroDeclarado !== undefined ? `*Declarado pelo motorista:* R$ ${Number(s.dinheiroDeclarado).toFixed(2)}` : ''}
━━━━━━━━━━━━━━━━━━━━`
  }

  const copiarRelatorio = () => {
    const texto = gerarTextoCompartilhamento()
    navigator.clipboard.writeText(texto).then(() => {
      showToast?.('Relatório copiado para a área de transferência!')
    }).catch(() => {
      showToast?.('Erro ao copiar.', 'error')
    })
  }

  return (
    <div className="mr-modal-overlay" onClick={handleClose}>
      <div className="mr-modal-box" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
        <div className="mr-modal-header">
          <h3>
            <i className="fa-solid fa-flag-checkered" style={{ color: '#059669' }}></i>
            {showSummaryView ? 'Comprovante de Fechamento da Jornada' : 'Fechamento de Jornada e Prestação de Contas'}
          </h3>
          <button
            type="button"
            className="mr-reorder-btn"
            onClick={handleClose}
            title="Fechar"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {!showSummaryView ? (
          <form onSubmit={handleProcederFechamento} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <div className="mr-modal-body">
              {errorMsg && (
                <div style={{
                  background: '#fef2f2',
                  color: '#dc2626',
                  border: '1px solid #fecaca',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '0.85rem'
                }}>
                  {errorMsg}
                </div>
              )}

              {/* Paradas Status Review */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '10px',
                textAlign: 'center'
              }}>
                <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '10px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#065f46', fontWeight: 600 }}>ENTREGUES</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#047857' }}>{finReport.entreguesCount}</div>
                </div>
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', padding: '10px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#92400e', fontWeight: 600 }}>PENDENTES</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#b45309' }}>{finReport.pendentesCount}</div>
                </div>
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '10px', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 600 }}>FALHAS/NÃO ENTREGUES</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#dc2626' }}>{finReport.falhasCount}</div>
                </div>
              </div>

              {/* Odômetro */}
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                padding: '14px',
                borderRadius: '8px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '10px',
                alignItems: 'center'
              }}>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>KM INICIAL</label>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#1e293b' }}>{kmIni} km</div>
                </div>
                <div className="mr-form-group">
                  <label className="mr-form-label" style={{ fontSize: '0.75rem' }}>KM FINAL *</label>
                  <input
                    type="number"
                    min={kmIni}
                    className="mr-form-input"
                    placeholder="Ex: 45340"
                    value={kmFinal}
                    onChange={(e) => setKmFinal(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>DISTÂNCIA</label>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#059669' }}>
                    {kmPercorrido > 0 ? `${kmPercorrido} km` : '—'}
                  </div>
                </div>
              </div>

              {/* Resumo Financeiro Completo e Claro */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#1e293b' }}>
                  Demonstrativo de Recebimentos e Caixa
                </h4>

                <div className="mr-finance-summary-grid">
                  <div className="mr-fin-box">
                    <div className="mr-fin-box-lbl">Total Faturado na Rota</div>
                    <div className="mr-fin-box-val">R$ {finReport.totalFaturado.toFixed(2).replace('.', ',')}</div>
                  </div>
                  <div className="mr-fin-box">
                    <div className="mr-fin-box-lbl">Total Recebido (Geral)</div>
                    <div className="mr-fin-box-val">R$ {finReport.totalRecebido.toFixed(2).replace('.', ',')}</div>
                  </div>
                </div>

                <div style={{
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                    <span>💵 <strong>Recebido em Dinheiro (Espécie):</strong></span>
                    <strong style={{ color: '#059669' }}>R$ {finReport.recebidoDinheiro.toFixed(2).replace('.', ',')}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                    <span>⚡ <strong>Recebido via PIX:</strong></span>
                    <strong>R$ {finReport.recebidoPix.toFixed(2).replace('.', ',')}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                    <span>💳 <strong>Recebido no Cartão THSM:</strong></span>
                    <strong>R$ {finReport.recebidoCartao.toFixed(2).replace('.', ',')}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', borderTop: '1px dashed #cbd5e1', paddingTop: '6px' }}>
                    <span style={{ color: '#dc2626' }}>⛽ (-) Despesas pagas em Dinheiro do Caixa:</span>
                    <strong style={{ color: '#dc2626' }}>- R$ {finReport.despesasDinheiroCaixa.toFixed(2).replace('.', ',')}</strong>
                  </div>
                  {finReport.despesasCartaoEmpresa > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#64748b' }}>
                      <span>💳 <em>Despesas no Cartão da Empresa (Não descontadas do caixa):</em></span>
                      <span>R$ {finReport.despesasCartaoEmpresa.toFixed(2).replace('.', ',')}</span>
                    </div>
                  )}
                </div>

                {/* Bloco Destaque: Dinheiro Físico a Entregar */}
                <div style={{
                  background: '#ecfdf5',
                  border: '2px solid #10b981',
                  borderRadius: '10px',
                  padding: '14px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#065f46', textTransform: 'uppercase' }}>
                      Saldo em Dinheiro Físico a Entregar ao Caixa:
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#047857' }}>
                      (Dinheiro em espécie recebido menos despesas pagas com esse dinheiro)
                    </span>
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#065f46' }}>
                    R$ {finReport.saldoDinheiroDevolver.toFixed(2).replace('.', ',')}
                  </div>
                </div>

                <div className="mr-form-group" style={{ marginTop: '4px' }}>
                  <label className="mr-form-label">Valor em dinheiro entregue pelo motorista (caso divirja)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="mr-form-input"
                    placeholder={`Padrão: ${finReport.saldoDinheiroDevolver.toFixed(2)}`}
                    value={dinheiroDeclarado}
                    onChange={(e) => setDinheiroDeclarado(e.target.value)}
                  />
                </div>

                <div className="mr-form-group">
                  <label className="mr-form-label">Observações Finais do Fechamento</label>
                  <textarea
                    rows="2"
                    className="mr-form-textarea"
                    placeholder="Ex: Todas as notas assinadas, cliente X reagendado..."
                    value={observacoesFinais}
                    onChange={(e) => setObservacoesFinais(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="mr-modal-footer">
              <button
                type="button"
                className="mr-btn mr-btn-secondary"
                onClick={handleClose}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="mr-btn mr-btn-primary mr-btn-lg"
              >
                Revisar e Fechar Jornada
              </button>
            </div>
          </form>
        ) : (
          /* Summary Snapshot View */
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <div className="mr-modal-body">
              <div style={{
                background: '#f0fdf4',
                border: '1px solid #86efac',
                padding: '16px',
                borderRadius: '10px',
                textAlign: 'center'
              }}>
                <i className="fa-solid fa-circle-check" style={{ fontSize: '2.5rem', color: '#10b981', marginBottom: '8px' }}></i>
                <h3 style={{ margin: 0, color: '#065f46', fontWeight: 800 }}>Jornada Pronta para Encerramento</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#047857' }}>
                  Confira o resumo final e confirme o fechamento. O registro ficará salvo no histórico.
                </p>
              </div>

              <pre style={{
                background: '#1e293b',
                color: '#f8fafc',
                padding: '14px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                margin: 0,
                lineHeight: 1.5
              }}>
                {gerarTextoCompartilhamento()}
              </pre>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="mr-btn mr-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={copiarRelatorio}
                >
                  <i className="fa-solid fa-copy"></i> Copiar Resumo
                </button>
                <button
                  type="button"
                  className="mr-btn mr-btn-secondary"
                  style={{ flex: 1 }}
                  onClick={() => {
                    const texto = encodeURIComponent(gerarTextoCompartilhamento())
                    window.open(`https://api.whatsapp.com/send?text=${texto}`, '_blank')
                  }}
                >
                  <i className="fa-brands fa-whatsapp" style={{ color: '#16a34a' }}></i> Enviar WhatsApp
                </button>
              </div>
            </div>

            <div className="mr-modal-footer">
              <button
                type="button"
                className="mr-btn mr-btn-secondary"
                onClick={() => setShowSummaryView(false)}
              >
                Voltar
              </button>
              <button
                type="button"
                className="mr-btn mr-btn-primary mr-btn-lg"
                onClick={handleFinalizar}
              >
                <i className="fa-solid fa-lock"></i> Confirmar e Salvar Fechamento
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

