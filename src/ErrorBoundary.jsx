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
      const erros = JSON.parse(localStorage.getItem('thsm_erros') || '[]').slice(-19)
      erros.push({ msg: String(error?.message || error), hora: new Date().toISOString() })
      localStorage.setItem('thsm_erros', JSON.stringify(erros))
    } catch {}
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f6f7f9', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '1rem' }}>
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '14px', padding: '2rem', maxWidth: '420px', textAlign: 'center', boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
            <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.35rem', color: '#111827' }}>Algo deu errado</h2>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 1rem' }}>
              Ocorreu um erro inesperado. Seus dados não foram perdidos.
            </p>
            {this.state.error?.message && (
              <p style={{ fontSize: '0.72rem', color: '#dc2626', background: '#fef2f2', borderRadius: '8px', padding: '0.5rem 0.75rem', margin: '0 0 1rem', wordBreak: 'break-word' }}>
                {String(this.state.error.message)}
              </p>
            )}
            <button
              onClick={() => { this.setState({ error: null }) }}
              style={{ background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '10px', padding: '0.65rem 1.25rem', fontSize: '0.9rem', cursor: 'pointer', fontWeight: 600 }}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}