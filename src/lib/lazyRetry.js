import { lazy } from 'react'

/**
 * Lazy loads a component with automatic page reload retry if a stale chunk / module
 * script error occurs following a new production build/deployment.
 */
export function lazyRetry(componentImport) {
  return lazy(async () => {
    try {
      return await componentImport()
    } catch (err) {
      const msg = String(err?.message || err || '')
      const isChunkError = /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk/i.test(msg)
      if (isChunkError) {
        const key = 'thsm_chunk_reload_lock'
        const last = sessionStorage.getItem(key)
        const now = Date.now()
        if (!last || now - Number(last) > 15000) {
          sessionStorage.setItem(key, String(now))
          window.location.reload()
          return new Promise(() => {}) // Wait until reload begins
        }
      }
      throw err
    }
  })
}
