import React, { useState } from 'react'

export default function DespesasJornadaModal({
  isOpen,
  onClose,
  jornada,
  onAddDespesa
}) {
  const [categoria, setCategoria] = useState('combustivel')
  const [valor, setValor] = useState('')
  const [formaPagamento, setFormaPagamento] = useState('dinheiro_caixa')
  const [descricao, setDescricao] = useState('')
  const [comprovanteUrl, setComprovanteUrl] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  if (!isOpen) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    setErrorMsg('')

    const val = Number(String(valor).replace(',', '.'))
    if (!valor || isNaN(val) || val <= 0) {
      setErrorMsg('Informe um valor de despesa válido maior que zero.')
      return
    }

    if (!descricao.trim()) {
      setErrorMsg('Informe a descrição ou nome do estabelecimento.')
      return
    }

    const now = new Date()
    const offset = now.getTimezoneOffset() * 60000
    const localISOTime = new Date(now.getTime() - offset).toISOString().slice(0, 10)

    const novaDespesa = {
      id: Date.now(),
      jornadaId: jornada?.id || null,
      categoria, // combustivel, pedagio, alimentacao, estacionamento, manutencao, outros
      valor: Math.round(val * 100) / 100,
      formaPagamento, // dinheiro_caixa, pix, cartao_empresa, outro
      descricao: descricao.trim(),
      estabelecimento: descricao.trim(),
      comprovanteUrl: comprovanteUrl || '',
      status: 'pago',
      paidDate: localISOTime,
      createdAt: Date.now(),
      data: {
        categoria,
        valor: Math.round(val * 100) / 100,
        formaPagamento,
        descricao: descricao.trim(),
        jornadaId: jornada?.id || null,
        origem: 'central_rotas'
      }
    }

    onAddDespesa(novaDespesa)
    onClose()
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      setComprovanteUrl(event.target.result)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="mr-modal-overlay" onClick={onClose}>
      <div className="mr-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="mr-modal-header">
          <h3>
            <i className="fa-solid fa-receipt" style={{ color: '#f59e0b' }}></i>
            Lançar Despesa da Rota
          </h3>
          <button
            type="button"
            className="mr-reorder-btn"
            onClick={onClose}
            title="Fechar"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="mr-form-group">
                <label className="mr-form-label">Categoria *</label>
                <select
                  className="mr-form-select"
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  required
                >
                  <option value="combustivel">⛽ Combustível</option>
                  <option value="pedagio">🛣️ Pedágio</option>
                  <option value="alimentacao">🍽️ Alimentação</option>
                  <option value="estacionamento">🅿️ Estacionamento</option>
                  <option value="manutencao">🔧 Manutenção</option>
                  <option value="outros">📦 Outros</option>
                </select>
              </div>

              <div className="mr-form-group">
                <label className="mr-form-label">Valor (R$) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="mr-form-input"
                  placeholder="0,00"
                  value={valor}
                  onChange={(e) => setValor(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="mr-form-group">
              <label className="mr-form-label">Forma de Pagamento Utilizada *</label>
              <select
                className="mr-form-select"
                value={formaPagamento}
                onChange={(e) => setFormaPagamento(e.target.value)}
                required
              >
                <option value="dinheiro_caixa">💵 Dinheiro do Caixa (Desconta do acerto final)</option>
                <option value="cartao_empresa">💳 Cartão da Empresa (Não desconta do acerto físico)</option>
                <option value="pix">⚡ PIX da Empresa (Conta THSM)</option>
                <option value="outro">Outro meio</option>
              </select>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                {formaPagamento === 'dinheiro_caixa'
                  ? '⚠️ O valor será abatido do dinheiro físico que o entregador prestará contas.'
                  : 'ℹ️ Essa despesa não será abatida do dinheiro físico do entregador.'}
              </span>
            </div>

            <div className="mr-form-group">
              <label className="mr-form-label">Descrição / Estabelecimento *</label>
              <input
                type="text"
                className="mr-form-input"
                placeholder="Ex: Posto Ipiranga - 30L Gasolina"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                required
              />
            </div>

            <div className="mr-form-group">
              <label className="mr-form-label">Foto do Cupom / Comprovante (Opcional)</label>
              <input
                type="file"
                accept="image/*"
                className="mr-form-input"
                onChange={handleFileChange}
              />
              {comprovanteUrl && (
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <img
                    src={comprovanteUrl}
                    alt="Comprovante"
                    style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #e2e8f0' }}
                  />
                  <button
                    type="button"
                    className="mr-btn mr-btn-danger"
                    style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                    onClick={() => setComprovanteUrl('')}
                  >
                    Remover Foto
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mr-modal-footer">
            <button
              type="button"
              className="mr-btn mr-btn-secondary"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="mr-btn mr-btn-primary mr-btn-lg"
            >
              <i className="fa-solid fa-plus"></i> Salvar Despesa
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

