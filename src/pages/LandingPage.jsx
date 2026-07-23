import { useState } from 'react'
import { supabase } from '../lib/supabase'
import './LandingPage.css'

const STEPS = [
  { id: 1, label: 'Dados Pessoais' },
  { id: 2, label: 'Endereço' },
  { id: 3, label: 'Finalizar' }
]

export default function LandingPage({ onVerCatalogo }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ nome: '', telefone: '', email: '', cpf: '' })
  const [endereco, setEndereco] = useState({ cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' })
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)

  const update = (field, val) => setForm(prev => ({ ...prev, [field]: val }))
  const updateAddr = (field, val) => setEndereco(prev => ({ ...prev, [field]: val }))

  const formatPhone = (v) => {
    const nums = v.replace(/\D/g, '').slice(0, 11)
    if (nums.length <= 2) return `(${nums}`
    if (nums.length <= 7) return `(${nums.slice(0, 2)}) ${nums.slice(2)}`
    return `(${nums.slice(0, 2)}) ${nums.slice(2, 7)}-${nums.slice(7)}`
  }

  const lookupCep = async (cep) => {
    const clean = cep.replace(/\D/g, '')
    if (clean.length !== 8) return
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`)
      const data = await res.json()
      if (!data.erro) {
        setEndereco(prev => ({
          ...prev,
          cep: clean,
          estado: data.uf || '',
          cidade: data.localidade || '',
          bairro: data.bairro || '',
          rua: data.logradouro || '',
          complemento: data.complemento || ''
        }))
      }
    } catch {}
  }

  const canStep1 = form.nome.trim().length >= 3 && form.telefone.replace(/\D/g, '').length >= 11 && form.cpf.trim().length >= 11
  const canStep2 = endereco.cep && endereco.cidade && endereco.rua && endereco.numero

  const handleSubmit = async () => {
    if (!canStep1 || !canStep2) return
    setSending(true)
    const raw = form.telefone.replace(/\D/g, '')
    const telefone = raw.startsWith('55') ? raw : '55' + raw
    const { error } = await supabase.from('leads').insert({
      nome: form.nome.trim(),
      telefone,
      cpf: form.cpf.trim(),
      email: form.email.trim(),
      endereco: { ...endereco }
    })
    setSending(false)
    if (error) {
      if (error.code === '23505') {
        setSent(true)
        return
      }
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="lp-wrap">
        <div className="lp-hero">
          <div className="lp-hero-bg" />
          <div className="lp-hero-content" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="lp-success">
              <div className="lp-success-icon">
                <i className="fa-solid fa-check"></i>
              </div>
              <h2>Cadastro Recebido!</h2>
              <p>Recebemos sua solicitação para revender consignado. Em breve nossa equipe entrará em contato via WhatsApp para dar continuidade.</p>
              <button className="lp-btn lp-btn-primary" onClick={onVerCatalogo}>
                <i className="fa-solid fa-store"></i> Ver Catálogo
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="lp-wrap">
      <div className="lp-hero">
        <div className="lp-hero-bg" />
        <div className="lp-hero-content">
          <div className="lp-badge">REVENDER CONSIGNADO</div>
          <h1 className="lp-title">Transforme sua <span>venda</span> sem investir nada</h1>
          <p className="lp-subtitle">
            Receba os produtos, venda no seu ritmo e só pague pelo que vender. Sem risco, sem estoque mínimo.
          </p>

          <div className="lp-stats">
            <div className="lp-stat">
              <span className="lp-stat-num">0</span>
              <span className="lp-stat-label">Investimento Inicial</span>
            </div>
            <div className="lp-stat">
              <span className="lp-stat-num">100%</span>
              <span className="lp-stat-label">Suporte WhatsApp</span>
            </div>
            <div className="lp-stat">
              <span className="lp-stat-num">+500</span>
              <span className="lp-stat-label">Produtos</span>
            </div>
          </div>

          <div className="lp-form-card">
            <div className="lp-steps">
              {STEPS.map(s => (
                <div key={s.id} className={`lp-step ${step === s.id ? 'active' : ''} ${step > s.id ? 'done' : ''}`}>
                  <div className="lp-step-circle">{step > s.id ? <i className="fa-solid fa-check"></i> : s.id}</div>
                  <span>{s.label}</span>
                </div>
              ))}
            </div>

            {step === 1 && (
              <div className="lp-step-form">
                <h3>Dados Pessoais</h3>
                <div className="lp-field">
                  <label>Nome completo *</label>
                  <input type="text" placeholder="Seu nome" value={form.nome} onChange={e => update('nome', e.target.value)} />
                </div>
                <div className="lp-field">
                  <label>Telefone / WhatsApp *</label>
                  <input type="text" placeholder="(31) 99999-9999" value={formatPhone(form.telefone)} onChange={e => update('telefone', e.target.value)} />
                </div>
                <div className="lp-field">
                  <label>CPF *</label>
                  <input type="text" placeholder="000.000.000-00" value={form.cpf} onChange={e => update('cpf', e.target.value)} />
                </div>
                <div className="lp-field">
                  <label>Email</label>
                  <input type="email" placeholder="seu@email.com" value={form.email} onChange={e => update('email', e.target.value)} />
                </div>
                <button className="lp-btn lp-btn-primary" disabled={!canStep1} onClick={() => setStep(2)}>
                  Próximo <i className="fa-solid fa-arrow-right"></i>
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="lp-step-form">
                <h3>Endereço</h3>
                <div className="lp-field">
                  <label>CEP *</label>
                  <input type="text" placeholder="00000-000" value={endereco.cep} onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 8); setEndereco(prev => ({ ...prev, cep: v })); if (v.length === 8) lookupCep(v) }} />
                </div>
                <div className="lp-row">
                  <div className="lp-field">
                    <label>Estado *</label>
                    <input type="text" placeholder="MG" value={endereco.estado} onChange={e => updateAddr('estado', e.target.value)} />
                  </div>
                  <div className="lp-field" style={{ flex: 2 }}>
                    <label>Cidade *</label>
                    <input type="text" placeholder="Sua cidade" value={endereco.cidade} onChange={e => updateAddr('cidade', e.target.value)} />
                  </div>
                </div>
                <div className="lp-field">
                  <label>Bairro *</label>
                  <input type="text" placeholder="Seu bairro" value={endereco.bairro} onChange={e => updateAddr('bairro', e.target.value)} />
                </div>
                <div className="lp-row">
                  <div className="lp-field" style={{ flex: 3 }}>
                    <label>Rua / Logradouro *</label>
                    <input type="text" placeholder="Nome da rua" value={endereco.rua} onChange={e => updateAddr('rua', e.target.value)} />
                  </div>
                  <div className="lp-field" style={{ flex: 1 }}>
                    <label>Número *</label>
                    <input type="text" placeholder="S/N" value={endereco.numero} onChange={e => updateAddr('numero', e.target.value)} />
                  </div>
                </div>
                <div className="lp-field">
                  <label>Complemento</label>
                  <input type="text" placeholder="Apto, bloco, etc" value={endereco.complemento} onChange={e => updateAddr('complemento', e.target.value)} />
                </div>
                <div className="lp-actions">
                  <button className="lp-btn lp-btn-sec" onClick={() => setStep(1)}><i className="fa-solid fa-arrow-left"></i> Voltar</button>
                  <button className="lp-btn lp-btn-primary" disabled={!canStep2} onClick={() => setStep(3)}>
                    Próximo <i className="fa-solid fa-arrow-right"></i>
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="lp-step-form">
                <h3>Confirmar Cadastro</h3>
                <div className="lp-review">
                  <div className="lp-review-block">
                    <strong>Nome</strong>
                    <span>{form.nome}</span>
                  </div>
                  <div className="lp-review-block">
                    <strong>Telefone</strong>
                    <span>{form.telefone}</span>
                  </div>
                  <div className="lp-review-block">
                    <strong>CPF</strong>
                    <span>{form.cpf}</span>
                  </div>
                  {form.email && (
                    <div className="lp-review-block">
                      <strong>Email</strong>
                      <span>{form.email}</span>
                    </div>
                  )}
                  <div className="lp-review-block">
                    <strong>Endereço</strong>
                    <span>{[endereco.rua, endereco.numero, endereco.bairro, endereco.cidade, endereco.estado].filter(Boolean).join(', ')}</span>
                  </div>
                </div>
                <p className="lp-disclaimer">
                  Ao finalizar, você concorda em receber contato da nossa equipe via WhatsApp para dar continuidade ao processo de cadastro como revendedor consignado.
                </p>
                <div className="lp-actions">
                  <button className="lp-btn lp-btn-sec" onClick={() => setStep(2)}><i className="fa-solid fa-arrow-left"></i> Voltar</button>
                  <button className="lp-btn lp-btn-primary" disabled={sending} onClick={handleSubmit}>
                    {sending ? <><i className="fa-solid fa-spinner fa-spin"></i> Enviando...</> : <><i className="fa-solid fa-check"></i> Finalizar Cadastro</>}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="lp-footer-text">
            Já é cliente? <button className="lp-link-btn" onClick={onVerCatalogo}>Acesse o catálogo completo</button>
          </div>
        </div>
      </div>

      <div className="lp-section lp-benefits">
        <h2>Por que revender consignado?</h2>
        <div className="lp-benefits-grid">
          <div className="lp-benefit">
            <div className="lp-benefit-icon" style={{ background: '#dbeafe', color: '#2563eb' }}>
              <i className="fa-solid fa-hand-holding-dollar"></i>
            </div>
            <h3>Sem investimento</h3>
            <p>Você recebe os produtos sem pagar nada adiantado. Só paga pelo que vender.</p>
          </div>
          <div className="lp-benefit">
            <div className="lp-benefit-icon" style={{ background: '#d1fae5', color: '#059669' }}>
              <i className="fa-solid fa-cube"></i>
            </div>
            <h3>+500 produtos</h3>
            <p>Catálogo completo com variedade de categorias para você oferecer aos seus clientes.</p>
          </div>
          <div className="lp-benefit">
            <div className="lp-benefit-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
              <i className="fa-solid fa-headset"></i>
            </div>
            <h3>Suporte total</h3>
            <p>Equipe dedicada no WhatsApp para ajudar em cada etapa, desde a escolha dos produtos até a venda.</p>
          </div>
          <div className="lp-benefit">
            <div className="lp-benefit-icon" style={{ background: '#f3e8ff', color: '#7c3aed' }}>
              <i className="fa-solid fa-truck"></i>
            </div>
            <h3>Entrega organizada</h3>
            <p>Rotas de entrega programadas para sua região. Receba os produtos com regularidade.</p>
          </div>
        </div>
      </div>

      <div className="lp-section lp-how">
        <h2>Como funciona</h2>
        <div className="lp-how-steps">
          <div className="lp-how-step">
            <div className="lp-how-num">1</div>
            <h3>Cadastre-se</h3>
            <p>Preencha o formulário acima com seus dados. Leva menos de 2 minutos.</p>
          </div>
          <div className="lp-how-connector"><i className="fa-solid fa-arrow-down"></i></div>
          <div className="lp-how-step">
            <div className="lp-how-num">2</div>
            <h3>Escolha os produtos</h3>
            <p>Nossa equipe entra em contato para você selecionar os itens do catálogo.</p>
          </div>
          <div className="lp-how-connector"><i className="fa-solid fa-arrow-down"></i></div>
          <div className="lp-how-step">
            <div className="lp-how-num">3</div>
            <h3>Receba e venda</h3>
            <p>Recebemos os produtos no endereço cadastrado. Venda no seu ritmo.</p>
          </div>
          <div className="lp-how-connector"><i className="fa-solid fa-arrow-down"></i></div>
          <div className="lp-how-step">
            <div className="lp-how-num">4</div>
            <h3>Pague só o que vender</h3>
            <p>Acerta apenas os produtos vendidos. Devolve o que não vender, sem custo.</p>
          </div>
        </div>
      </div>

      <div className="lp-section lp-cta">
        <h2>Pronto para começar?</h2>
        <p>Preencha o formulário acima e nossa equipe entrará em contato.</p>
        <button className="lp-btn lp-btn-primary lp-btn-lg" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <i className="fa-solid fa-pen"></i> Quero Revender
        </button>
      </div>

      <footer className="lp-footer">
        <p>THSM Distribuidora &copy; 2026. Todos os direitos reservados.</p>
      </footer>
    </div>
  )
}
