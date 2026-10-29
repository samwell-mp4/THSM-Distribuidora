import React, { useState, useEffect } from 'react'

export default function JornadaAberturaModal({
  isOpen,
  onClose,
  onStartJornada,
  defaultOperador = 'Administrador'
}) {
  const [dataHora, setDataHora] = useState('')
  const [operador, setOperador] = useState(defaultOperador)
  const [veiculo, setVeiculo] = useState('')
  const [kmInicial, setKmInicial] = useState('')
  const [combustivel, setCombustivel] = useState('cheio')
  const [observacao, setObservacao] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (isOpen) {
      const now = new Date()
      // format to datetime-local (YYYY-MM-DDTHH:mm)
      const offset = now.getTimezoneOffset() * 60000
      const localISOTime = new Date(now.getTime() - offset).toISOString().slice(0, 16)
      setDataHora(localISOTime)
      setOperador(defaultOperador || 'Administrador')
      // Try to read last vehicle used from localStorage
      const lastVeiculo = localStorage.getItem('thsm_last_veiculo') || ''
      setVeiculo(lastVeiculo)
      const lastKm = localStorage.getItem('thsm_last_km') || ''
      setKmInicial(lastKm)
      setCombustivel('cheio')
      setObservacao('')
      setErrorMsg('')
    }
  }, [isOpen, defaultOperador])

  if (!isOpen) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    setErrorMsg('')

    const km = Number(kmInicial)
    if (kmInicial === '' || isNaN(km) || km < 0) {
      setErrorMsg('Informe um KM inicial válido (número maior ou igual a zero).')
      return
    }

    if (!operador.trim()) {
      setErrorMsg('Informe o nome do operador / motorista.')
      return
    }

    if (veiculo.trim()) {
      localStorage.setItem('thsm_last_veiculo', veiculo.trim())
    }

    const novaJornada = {
      id: 'jornada_' + Date.now(),
      data: dataHora ? dataHora.split('T')[0] : new Date().toISOString().split('T')[0],
      status: 'aberta',
      operador: operador.trim(),
      veiculo: veiculo.trim() || 'Veículo padrão',
      km_inicial: km,
      km_final: null,
      combustivel_inicial: combustivel,
      iniciou_em: dataHora ? new Date(dataHora).toISOString() : new Date().toISOString(),
      finalizou_em: null,
      observacao_inicial: observacao.trim(),
      observacao_final: '',
      pedidos_ids: [],
      paradas: [],
      despesas_ids: [],
      resumo_fechamento: null
    }

    onStartJornada(novaJornada)
  }

  return (
    <div className="mr-modal-overlay" onClick={onClose}>
      <div className="mr-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="mr-modal-header">
          <h3>
            <i className="fa-solid fa-truck-fast" style={{ color: '#10b981' }}></i>
            Abrir Jornada de Entrega
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

        <form onSubmit={handleSubmit}>
          <div className="mr-modal-body">
            {errorMsg && (
              <div style={{
                background: '#fef2f2',
                color: '#dc2626',
                border: '1px solid #fecaca',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <i className="fa-solid fa-circle-exclamation"></i>
                {errorMsg}
              </div>
            )}

            <div className="mr-form-group">
              <label className="mr-form-label">Data e Hora de Saída *</label>
              <input
                type="datetime-local"
                className="mr-form-input"
                value={dataHora}
                onChange={(e) => setDataHora(e.target.value)}
                required
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="mr-form-group">
                <label className="mr-form-label">Motorista / Operador *</label>
                <input
                  type="text"
                  className="mr-form-input"
                  placeholder="Nome do condutor"
                  value={operador}
                  onChange={(e) => setOperador(e.target.value)}
                  required
                />
              </div>

              <div className="mr-form-group">
                <label className="mr-form-label">Veículo (Identificação / Placa)</label>
                <input
                  type="text"
                  className="mr-form-input"
                  placeholder="Ex: Fiat Fiorino - ABC-1234"
                  value={veiculo}
                  onChange={(e) => setVeiculo(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div className="mr-form-group">
                <label className="mr-form-label">KM Inicial do Veículo *</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  className="mr-form-input"
                  placeholder="Ex: 45210"
                  value={kmInicial}
                  onChange={(e) => setKmInicial(e.target.value)}
                  required
                />
              </div>

              <div className="mr-form-group">
                <label className="mr-form-label">Nível de Combustível</label>
                <select
                  className="mr-form-select"
                  value={combustivel}
                  onChange={(e) => setCombustivel(e.target.value)}
                >
                  <option value="cheio">Cheio (100%)</option>
                  <option value="3/4">3/4 Tanque</option>
                  <option value="1/2">1/2 Meio Tanque</option>
                  <option value="1/4">1/4 Reserva</option>
                  <option value="vazio">Vazio</option>
                </select>
              </div>
            </div>

            <div className="mr-form-group">
              <label className="mr-form-label">Observações de Saída (Opcional)</label>
              <textarea
                rows="2"
                className="mr-form-textarea"
                placeholder="Ex: Pneu estepe conferido, rota região norte..."
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
              />
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
              <i className="fa-solid fa-play"></i> Iniciar Jornada
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

