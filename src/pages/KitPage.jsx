import { useMemo } from 'react'

function formatPreco(v) {
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`
}

export default function KitPage({ kit, produtos, onVoltar }) {
  const kitProdutos = useMemo(() => {
    return (kit?.produtoIds || []).map(id => produtos.find(p => p.id === id)).filter(Boolean)
  }, [kit, produtos])

  if (!kit) {
    return (
      <div className="kit-error">
        <i className="fa-solid fa-box-open"></i>
        <h2>Kit não encontrado</h2>
        <p>O link que você acessou é inválido ou expirou.</p>
        <button className="kit-btn" onClick={onVoltar}>Ir para o Catálogo</button>
      </div>
    )
  }

  return (
    <div className="kit-page">
      <div className="kit-hero">
        <div className="kit-hero-content">
          <span className="kit-badge">Kit Especial</span>
          <h1>{kit.nome}</h1>
          {kit.descricao && <p className="kit-desc">{kit.descricao}</p>}
        </div>
      </div>

      <div className="kit-body">
        {kit.prazoTexto && (
          <div className="kit-prazo-card">
            <div className="kit-prazo-icon"><i className="fa-solid fa-calendar-check"></i></div>
            <div className="kit-prazo-texto">{kit.prazoTexto}</div>
          </div>
        )}

        <h2 className="kit-subtitle">
          <i className="fa-solid fa-cube"></i> Produtos do Kit
        </h2>

        {kitProdutos.length === 0 ? (
          <div className="kit-empty">
            <p>Nenhum produto selecionado neste kit.</p>
          </div>
        ) : (
          <div className="kit-grid">
            {kitProdutos.map((p, i) => (
              <div key={p.id} className="kit-card" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="kit-card-img">
                  {p.imagem ? (
                    <img src={p.imagem} alt={p.nome} loading="lazy" onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }} />
                  ) : null}
                  <div className="kit-card-img-fallback" style={{ display: p.imagem ? 'none' : 'flex' }}>
                    <i className="fa-solid fa-image"></i>
                  </div>
                </div>
                <div className="kit-card-body">
                  <h3>{p.nome}</h3>
                  <span className="kit-card-cat">{p.categoria}</span>
                  <div className="kit-card-preco">{formatPreco(p.preco)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {kit.observacoes && (
          <div className="kit-obs">
            <i className="fa-solid fa-clipboard"></i>
            <div>
              <strong>Observações:</strong>
              <p>{kit.observacoes}</p>
            </div>
          </div>
        )}

        <div className="kit-footer-cta">
          <button className="kit-btn kit-btn-primary" onClick={onVoltar}>
            <i className="fa-solid fa-arrow-left"></i> Ver Catálogo Completo
          </button>
        </div>
      </div>
    </div>
  )
}
