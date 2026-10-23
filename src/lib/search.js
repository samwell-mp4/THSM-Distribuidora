/**
 * Utilitário de normalização de busca sem acentos e sem cedilha (ç/c)
 */
export function normalizeSearch(str) {
  if (str === null || str === undefined) return ''
  return String(str)
    .replace(/ç/g, 'c')
    .replace(/Ç/g, 'c')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ç/g, 'c')
    .trim()
}

/**
 * Retorna true se target contém query ignorando maiúsculas, acentos e cedilha
 */
export function searchMatches(target, query) {
  const q = normalizeSearch(query)
  if (!q) return true
  const t = normalizeSearch(target)
  return t.includes(q)
}
