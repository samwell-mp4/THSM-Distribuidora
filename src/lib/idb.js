// Simple, robust native IndexedDB storage for THSM large collections (orders, products, financial)
const DB_NAME = 'thsm_indexed_db'
const DB_VERSION = 1
const STORE_NAME = 'keyval'

let dbPromise = null

function getDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return resolve(null)
    }
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = (err) => {
        console.warn('IndexedDB open error:', err)
        resolve(null)
      }
    } catch (e) {
      console.warn('IndexedDB exception:', e)
      resolve(null)
    }
  })
  return dbPromise
}

export async function idbGet(key, def = null) {
  try {
    const db = await getDB()
    if (!db) return def
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const req = tx.objectStore(STORE_NAME).get(key)
        req.onsuccess = () => resolve(req.result !== undefined ? req.result : def)
        req.onerror = () => resolve(def)
      } catch {
        resolve(def)
      }
    })
  } catch {
    return def
  }
}

export async function idbSet(key, val) {
  try {
    const db = await getDB()
    if (!db) return false
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const req = tx.objectStore(STORE_NAME).put(val, key)
        req.onsuccess = () => resolve(true)
        req.onerror = () => resolve(false)
      } catch {
        resolve(false)
      }
    })
  } catch {
    return false
  }
}
