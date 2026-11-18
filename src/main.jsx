import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

// Vite preload error handler: automatically reloads the page when a deploy updates chunk hashes
window.addEventListener('vite:preloadError', (event) => {
  console.warn('[Vite] Preload error detected, reloading page to fetch latest bundle...', event)
  try {
    sessionStorage.removeItem('thsm_last_chunk_reload')
    sessionStorage.removeItem('thsm_chunk_reload_lock')
  } catch {}
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
