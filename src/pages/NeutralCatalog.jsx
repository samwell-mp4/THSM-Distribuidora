import React, { useState, useMemo, useCallback } from 'react'
import { searchMatches } from '../lib/search'
import { formatImageUrl } from '../lib/supabase'
import './NeutralCatalog.css'

function formatPreco(v) {
  return `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`
}

export default function NeutralCatalog({ produtos = [], onVoltar }) {
  // Query params support for revendedor customization (e.g. ?titulo=Minha+Loja&contato=...)
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const customTitle = params.get('titulo') || 'Catálogo de Produtos'
  const customSub = params.get('sub') || 'Confira nossos produtos e valores atualizados'

  const [search, setSearch] = useState('')
  const [categoria, setCategoria] = useState('TODOS')
  const [sortBy, setSortBy] = useState('nome-asc')
  const [onlyInStock, setOnlyInStock] = useState(false)
  const [viewMode, setViewMode] = useState('grid') // 'grid' | 'list'
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [toast, setToast] = useState(null)
  const [imageErrors, setImageErrors] = useState({})

  const showToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }, [])

  const handleImageError = useCallback((id) => {
    setImageErrors(prev => ({ ...prev, [id]: true }))
  }, [])

  // Categories list
  const categorias = useMemo(() => [
    'TODOS',
    ...[...new Set((produtos || []).map(p => p?.categoria).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'))
  ], [produtos])

  // Filtered & sorted products
  const filteredProducts = useMemo(() => {
    const list = (produtos || []).filter(p => {
      if (!p || p.deleted) return false
      if (categoria !== 'TODOS' && p.categoria !== categoria) return false
      if (onlyInStock && Number(p.estoque) <= 0) return false
      if (search.trim()) {
        const matchesName = searchMatches(p.nome, search)
        const matchesCat = searchMatches(p.categoria, search)
        const matchesCode = searchMatches(p.id, search)
        if (!matchesName && !matchesCat && !matchesCode) return false
      }
      return true
    })

    list.sort((a, b) => {
      if (sortBy === 'nome-asc') return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR')
      if (sortBy === 'nome-desc') return String(b.nome || '').localeCompare(String(a.nome || ''), 'pt-BR')
      if (sortBy === 'preco-asc') return (Number(a.preco) || 0) - (Number(b.preco) || 0)
      if (sortBy === 'preco-desc') return (Number(b.preco) || 0) - (Number(a.preco) || 0)
      return 0
    })

    return list
  }, [produtos, categoria, onlyInStock, search, sortBy])

  // Share link handler
  const handleShare = useCallback(() => {
    const url = window.location.href
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(() => showToast('Link do catálogo copiado para a área de transferência!'))
        .catch(() => showToast('Não foi possível copiar o link automaticamente.'))
    } else {
      showToast('Link do catálogo: ' + url)
    }
  }, [showToast])

  // Print / PDF handler
  const handlePrint = useCallback(() => {
    window.print()
  }, [])

  return (
    <div className="neutral-catalog-root">
      {toast && (
        <div className="neutral-toast">
          <i className="fa-solid fa-check-circle" style={{ color: '#4ade80' }}></i>
          <span>{toast}</span>
        </div>
      )}

      {/* HEADER (Sem Marca / White-Label) */}
      <header className="neutral-header">
        <div className="neutral-header-inner">
          <div className="neutral-brand-info">
            <h1>
              <i className="fa-solid fa-box-open"></i>
              {customTitle}
            </h1>
            <p>{customSub}</p>
          </div>

          <div className="neutral-header-actions no-print">
            <button className="neutral-btn" onClick={handleShare} title="Copiar link para enviar a clientes">
              <i className="fa-solid fa-share-nodes"></i>
              <span>Compartilhar</span>
            </button>
            <button className="neutral-btn neutral-btn-primary" onClick={handlePrint} title="Imprimir catálogo ou salvar em PDF">
              <i className="fa-solid fa-print"></i>
              <span>Salvar em PDF / Imprimir</span>
            </button>
            {onVoltar && (
              <button className="neutral-btn" onClick={onVoltar} title="Voltar para a Loja Principal">
                <i className="fa-solid fa-arrow-left"></i>
                <span>Voltar</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <div className="neutral-container">
        {/* CONTROLS & SEARCH */}
        <div className="neutral-controls no-print">
          <div className="neutral-search-row">
            <div className="neutral-search-box">
              <i className="fa-solid fa-search"></i>
              <input
                type="text"
                className="neutral-search-input"
                placeholder="Buscar produto por nome, código ou categoria..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="neutral-search-clear" onClick={() => setSearch('')}>
                  <i className="fa-solid fa-times"></i>
                </button>
              )}
            </div>

            <select className="neutral-sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="nome-asc">Nome (A - Z)</option>
              <option value="nome-desc">Nome (Z - A)</option>
              <option value="preco-asc">Menor Preço</option>
              <option value="preco-desc">Maior Preço</option>
            </select>

            <div className="neutral-view-toggle">
              <button
                className={`neutral-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
                title="Grade de fotos"
              >
                <i className="fa-solid fa-grip"></i>
              </button>
              <button
                className={`neutral-view-btn ${viewMode === 'list' ? 'active' : ''}`}
                onClick={() => setViewMode('list')}
                title="Lista detalhada"
              >
                <i className="fa-solid fa-list"></i>
              </button>
            </div>
          </div>

          {/* CATEGORIES PILLS */}
          <div className="neutral-cat-pills">
            {categorias.map(cat => (
              <button
                key={cat}
                className={`neutral-cat-pill ${categoria === cat ? 'active' : ''}`}
                onClick={() => setCategoria(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* RESULTS META */}
        <div className="neutral-meta-bar">
          <span>Mostrando <strong>{filteredProducts.length}</strong> produtos</span>
          {categoria !== 'TODOS' && <span>Categoria: <strong>{categoria}</strong></span>}
        </div>

        {/* PRODUCTS VIEW */}
        {filteredProducts.length === 0 ? (
          <div className="neutral-empty">
            <i className="fa-solid fa-box-open"></i>
            <h3>Nenhum produto encontrado</h3>
            <p>Tente buscar por outro termo ou escolher outra categoria.</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="neutral-grid">
            {filteredProducts.map(p => {
              const hasImg = p.imagem && !imageErrors[p.id]
              return (
                <div key={p.id} className="neutral-card" onClick={() => setSelectedProduct(p)}>
                  <div className="neutral-card-img-wrap">
                    {hasImg ? (
                      <img
                        src={formatImageUrl(p.imagem)}
                        alt={p.nome}
                        loading="lazy"
                        onError={() => handleImageError(p.id)}
                      />
                    ) : (
                      <div className="neutral-card-img-fallback">
                        <i className="fa-solid fa-image"></i>
                      </div>
                    )}
                    {p.categoria && <span className="neutral-card-badge">{p.categoria}</span>}
                  </div>

                  <div className="neutral-card-body">
                    <h3 className="neutral-card-title" title={p.nome}>{p.nome}</h3>
                    <div className="neutral-card-price-row">
                      <span className="neutral-card-price-label">Preço</span>
                      <span className="neutral-card-price">{formatPreco(p.preco)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="neutral-list">
            {filteredProducts.map(p => {
              const hasImg = p.imagem && !imageErrors[p.id]
              return (
                <div key={p.id} className="neutral-list-item" onClick={() => setSelectedProduct(p)}>
                  {hasImg ? (
                    <img
                      className="neutral-list-thumb"
                      src={formatImageUrl(p.imagem)}
                      alt={p.nome}
                      loading="lazy"
                      onError={() => handleImageError(p.id)}
                    />
                  ) : (
                    <div className="neutral-list-thumb-fallback">
                      <i className="fa-solid fa-image"></i>
                    </div>
                  )}

                  <div className="neutral-list-info">
                    <h3 className="neutral-list-title">{p.nome}</h3>
                    <span className="neutral-list-cat">{p.categoria || 'Geral'}</span>
                  </div>

                  <div className="neutral-list-price">
                    {formatPreco(p.preco)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <footer className="neutral-footer no-print">
        <span>Catálogo de Produtos &bull; Preços e disponibilidade sujeitos a alteração</span>
      </footer>

      {/* PRODUCT DETAIL MODAL */}
      {selectedProduct && (
        <div className="neutral-modal-backdrop" onClick={() => setSelectedProduct(null)}>
          <div className="neutral-modal" onClick={e => e.stopPropagation()}>
            <button className="neutral-modal-close" onClick={() => setSelectedProduct(null)} title="Fechar">
              <i className="fa-solid fa-times"></i>
            </button>

            <div className="neutral-modal-img-wrap">
              {selectedProduct.imagem && !imageErrors[selectedProduct.id] ? (
                <img src={formatImageUrl(selectedProduct.imagem)} alt={selectedProduct.nome} />
              ) : (
                <div className="neutral-card-img-fallback" style={{ fontSize: '3.5rem' }}>
                  <i className="fa-solid fa-image"></i>
                </div>
              )}
            </div>

            <div className="neutral-modal-content">
              {selectedProduct.categoria && (
                <span className="neutral-modal-cat">{selectedProduct.categoria}</span>
              )}
              <h2 className="neutral-modal-title">{selectedProduct.nome}</h2>

              <div className="neutral-modal-price-box">
                <span>Valor Unitário</span>
                <strong>{formatPreco(selectedProduct.preco)}</strong>
              </div>

              {selectedProduct.descricao && (
                <p className="neutral-modal-desc">{selectedProduct.descricao}</p>
              )}

              {selectedProduct.variantes && typeof selectedProduct.variantes === 'object' && Object.keys(selectedProduct.variantes).length > 0 && (
                <div className="neutral-modal-variants">
                  <h4>Variações / Opções Disponíveis:</h4>
                  <div className="neutral-variant-chips">
                    {Object.entries(selectedProduct.variantes).map(([k, val]) => (
                      <span key={k} className="neutral-variant-chip">
                        {k}: {Array.isArray(val) ? val.join(', ') : String(val)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
