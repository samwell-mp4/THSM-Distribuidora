import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    try {
      console.error('[ErrorBoundary]', error, info)
      const msg = String(error?.message || error || '')
      const isChunkError = /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk/i.test(msg)

      if (isChunkError) {
        const lastReload = sessionStorage.getItem('thsm_last_chunk_reload')
        const now = Date.now()
        // If not reloaded within the last 15 seconds, reload automatically to get the newest assets
        if (!lastReload || now - Number(lastReload) > 15000) {
          sessionStorage.setItem('thsm_last_chunk_reload', String(now))
          window.location.reload()
          return
        }
      }

      const erros = JSON.parse(localStorage.getItem('thsm_erros') || '[]').slice(-19)
      erros.push({ msg, hora: new Date().toISOString() })
      localStorage.setItem('thsm_erros', JSON.stringify(erros))
    } catch {}
  }

  render() {
    if (this.state.error) {
      const msg = String(this.state.error?.message || this.state.error || '')
      const isChunkError = /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk/i.test(msg)

      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f7f9', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '1rem' }}>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '2rem', maxWidth: '440px', textAlign: 'center', boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '2.2rem', marginBottom: '0.5rem' }}>{isChunkError ? '🔄' : '⚠️'}</div>
            <h2 style={{ fontSize: '1.15rem', margin: '0 0 0.35rem', color: '#111827', fontWeight: 700 }}>
              {isChunkError ? 'Atualização do Sistema Disponível' : 'Algo deu errado'}
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 1rem', lineHeight: 1.4 }}>
              {isChunkError
                ? 'Uma nova versão do sistema foi publicada no servidor. Clique no botão abaixo para carregar a versão mais recente.'
                : 'Ocorreu um erro inesperado. Seus dados não foram perdidos.'}
            </p>
            {msg && (
              <p style={{ fontSize: '0.72rem', color: isChunkError ? '#4338ca' : '#dc2626', background: isChunkError ? '#eef2ff' : '#fef2f2', border: `1px solid ${isChunkError ? '#c7d2fe' : '#fee2e2'}`, borderRadius: '8px', padding: '0.5rem 0.75rem', margin: '0 0 1.25rem', wordBreak: 'break-word' }}>
                {msg}
              </p>
            )}
            <div style={{ display: 'flex', gap: '0.65rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  try {
                    sessionStorage.removeItem('thsm_last_chunk_reload')
                    sessionStorage.removeItem('thsm_chunk_reload_lock')
                  } catch {}
                  window.location.reload()
                }}
                style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '10px', padding: '0.7rem 1.4rem', fontSize: '0.9rem', cursor: 'pointer', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <span>Recarregar Página</span>
              </button>
              {!isChunkError && (
                <button
                  onClick={() => { this.setState({ error: null }) }}
                  style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '10px', padding: '0.7rem 1.2rem', fontSize: '0.9rem', cursor: 'pointer', fontWeight: 600 }}
                >
                  Tentar novamente
                </button>
              )}
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
