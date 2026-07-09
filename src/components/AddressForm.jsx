import { useState, useEffect, useCallback } from 'react'

const IBGE_ESTADOS = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados'
const IBGE_CIDADES = (uf) => `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`
const VIACEP = (cep) => `https://viacep.com.br/ws/${cep}/json/`

const ESTADOS_BR = [
  { sigla: 'AC', nome: 'Acre' },
  { sigla: 'AL', nome: 'Alagoas' },
  { sigla: 'AP', nome: 'Amapá' },
  { sigla: 'AM', nome: 'Amazonas' },
  { sigla: 'BA', nome: 'Bahia' },
  { sigla: 'CE', nome: 'Ceará' },
  { sigla: 'DF', nome: 'Distrito Federal' },
  { sigla: 'ES', nome: 'Espírito Santo' },
  { sigla: 'GO', nome: 'Goiás' },
  { sigla: 'MA', nome: 'Maranhão' },
  { sigla: 'MT', nome: 'Mato Grosso' },
  { sigla: 'MS', nome: 'Mato Grosso do Sul' },
  { sigla: 'MG', nome: 'Minas Gerais' },
  { sigla: 'PA', nome: 'Pará' },
  { sigla: 'PB', nome: 'Paraíba' },
  { sigla: 'PR', nome: 'Paraná' },
  { sigla: 'PE', nome: 'Pernambuco' },
  { sigla: 'PI', nome: 'Piauí' },
  { sigla: 'RJ', nome: 'Rio de Janeiro' },
  { sigla: 'RN', nome: 'Rio Grande do Norte' },
  { sigla: 'RS', nome: 'Rio Grande do Sul' },
  { sigla: 'RO', nome: 'Rondônia' },
  { sigla: 'RR', nome: 'Roraima' },
  { sigla: 'SC', nome: 'Santa Catarina' },
  { sigla: 'SP', nome: 'São Paulo' },
  { sigla: 'SE', nome: 'Sergipe' },
  { sigla: 'TO', nome: 'Tocantins' },
]

export default function AddressForm({ value, onChange }) {
  const [cep, setCep] = useState(value.cep || '')
  const [estado, setEstado] = useState(value.estado || '')
  const [cidade, setCidade] = useState(value.cidade || '')
  const [bairro, setBairro] = useState(value.bairro || '')
  const [rua, setRua] = useState(value.rua || '')
  const [numero, setNumero] = useState(value.numero || '')
  const [complemento, setComplemento] = useState(value.complemento || '')
  const [cidades, setCidades] = useState([])
  const [loadingCep, setLoadingCep] = useState(false)
  const [loadingCidades, setLoadingCidades] = useState(false)
  const [cepError, setCepError] = useState('')

  const emitChange = useCallback((updates) => {
    onChange({ cep, estado, cidade, bairro, rua, numero, complemento, ...updates })
  }, [cep, estado, cidade, bairro, rua, numero, complemento, onChange])

  // Sync from value prop
  useEffect(() => {
    setCep(value.cep || '')
    setEstado(value.estado || '')
    setCidade(value.cidade || '')
    setBairro(value.bairro || '')
    setRua(value.rua || '')
    setNumero(value.numero || '')
    setComplemento(value.complemento || '')
  }, [value.cep, value.estado, value.cidade, value.bairro, value.rua, value.numero, value.complemento])

  // Load cities when estado changes
  useEffect(() => {
    if (!estado) { setCidades([]); return }
    setLoadingCidades(true)
    fetch(IBGE_CIDADES(estado))
      .then(r => r.json())
      .then(data => {
        setCidades(data.map(c => c.nome).sort())
        setLoadingCidades(false)
      })
      .catch(() => { setCidades([]); setLoadingCidades(false) })
  }, [estado])

  // Busca CEP
  const buscarCep = useCallback(() => {
    const nums = cep.replace(/\D/g, '')
    if (nums.length !== 8) { setCepError('CEP inválido'); return }
    setCepError('')
    setLoadingCep(true)
    fetch(VIACEP(nums))
      .then(r => r.json())
      .then(data => {
        if (data.erro) { setCepError('CEP não encontrado'); setLoadingCep(false); return }
        const novoEstado = data.uf
        const novaCidade = data.localidade
        const novoBairro = data.bairro
        const novaRua = data.logradouro
        setEstado(novoEstado)
        setCidade(novaCidade)
        setBairro(novoBairro)
        setRua(novaRua)
        onChange({
          cep: nums,
          estado: novoEstado,
          cidade: novaCidade,
          bairro: novoBairro,
          rua: novaRua,
          numero,
          complemento
        })
        setLoadingCep(false)
      })
      .catch(() => { setCepError('Erro ao buscar CEP'); setLoadingCep(false) })
  }, [cep, onChange])

  const handleCepBlur = () => {
    const nums = cep.replace(/\D/g, '')
    if (nums.length === 8) buscarCep()
  }

  const formatCep = (v) => {
    const nums = v.replace(/\D/g, '').slice(0, 8)
    if (nums.length <= 5) return nums
    return `${nums.slice(0, 5)}-${nums.slice(5)}`
  }

  return (
    <div className="address-form">
      <div className="cep-row">
        <div className="form-group cep-field">
          <label>CEP</label>
          <div className="cep-input-wrap">
            <input
              type="text"
              placeholder="_____-___"
              value={formatCep(cep)}
              onChange={e => setCep(e.target.value)}
              onBlur={handleCepBlur}
              maxLength={9}
            />
            <button
              type="button"
              className="cep-search-btn"
              onClick={buscarCep}
              disabled={loadingCep || cep.replace(/\D/g, '').length !== 8}
              title="Buscar CEP"
            >
              {loadingCep ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-location-dot"></i>}
            </button>
          </div>
          {cepError && <span className="cep-error">{cepError}</span>}
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Estado</label>
          <select value={estado} onChange={e => { setEstado(e.target.value); setCidade('') }}>
            <option value="">Selecione...</option>
            {ESTADOS_BR.map(e => (
              <option key={e.sigla} value={e.sigla}>{e.nome} ({e.sigla})</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Cidade</label>
          <select value={cidade} onChange={e => setCidade(e.target.value)} disabled={!estado || loadingCidades}>
            <option value="">{loadingCidades ? 'Carregando...' : 'Selecione...'}</option>
            {cidades.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group" style={{ flex: 2 }}>
          <label>Logradouro</label>
          <input type="text" placeholder="Rua, Avenida..." value={rua} onChange={e => setRua(e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 0.6 }}>
          <label>Número</label>
          <input type="text" placeholder="Nº" value={numero} onChange={e => setNumero(e.target.value)} />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group" style={{ flex: 1.5 }}>
          <label>Bairro</label>
          <input type="text" placeholder="Bairro" value={bairro} onChange={e => setBairro(e.target.value)} />
        </div>
        <div className="form-group" style={{ flex: 1 }}>
          <label>Complemento</label>
          <input type="text" placeholder="Apto, Bloco..." value={complemento} onChange={e => setComplemento(e.target.value)} />
        </div>
      </div>

      {/* Hidden input for full address text */}
      <input type="hidden" value={[rua, numero, bairro, cidade, estado].filter(Boolean).join(', ')} />
    </div>
  )
}
