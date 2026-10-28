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
 * Remove qualquer caractere não numérico
 */
export function cleanDigits(str) {
  return String(str || '').replace(/\D/g, '')
}

/**
 * Compara dois números de telefone considerando DDI 55, DDD e 9º dígito
 */
export function phonesMatch(p1, p2) {
  const d1 = cleanDigits(p1)
  const d2 = cleanDigits(p2)
  if (!d1 || !d2) return false
  if (d1 === d2) return true

  // Para ser uma comparação de telefone válida, d1 (telefone salvo) deve ter pelo menos 8 dígitos
  // e d2 (termo de busca) deve ter pelo menos 4 dígitos
  if (d1.length < 8 || d2.length < 4) return false

  // Remove DDI 55 do Brasil se presente
  const s1 = d1.startsWith('55') && d1.length > 10 ? d1.slice(2) : d1
  const s2 = d2.startsWith('55') && d2.length > 10 ? d2.slice(2) : d2
  if (s1 === s2) return true

  // Se o telefone no banco contém o termo buscado
  if (s1.includes(s2)) return true

  // Se a busca contém o telefone completo no banco (ambos >= 8 dígitos)
  if (s2.includes(s1) && s1.length >= 8) return true

  // Comparação considerando 8 vs 9 dígitos (ex: 32 988074415 vs 32 88074415)
  if (s1.length === 11 && s2.length === 10) {
    if (s1.slice(0, 2) === s2.slice(0, 2) && s1.slice(3) === s2.slice(2)) return true
  }
  if (s2.length === 11 && s1.length === 10) {
    if (s2.slice(0, 2) === s1.slice(0, 2) && s2.slice(3) === s1.slice(2)) return true
  }

  return false
}

/**
 * Retorna true se target contém query ignorando maiúsculas, acentos, pontuação e ordem das palavras
 */
export function searchMatches(target, query) {
  if (query === null || query === undefined || query === '') return true
  if (target === null || target === undefined) return false

  const q = normalizeSearch(query)
  if (!q) return true
  const t = normalizeSearch(target)
  if (!t) return false

  // 1. Verificação direta por substring
  if (t.includes(q)) return true

  // 2. Busca por múltiplos termos (palavras em qualquer ordem)
  // Ex: "claudia sjdr" encontra "Claudia Cristina SJDR"
  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length > 1 && tokens.every(tok => t.includes(tok))) {
    return true
  }

  return false
}

/**
 * Busca inteligente em todos os campos de um cliente/usuário
 * Suporta múltiplos termos, busca por nome, apelido, telefone (formatado ou não), cidade, bairro, rua, CEP, CPF/CNPJ
 */
export function clientMatchesSearch(client, query) {
  if (!query || !String(query).trim()) return true
  if (!client) return false

  const q = normalizeSearch(query)
  if (!q) return true

  const nome = client.nome || ''
  const pushName = client.pushName || ''
  const apelido = client.apelido || ''
  const email = client.email || ''
  const doc = client.cpf || client.cnpj || client.documento || client.endereco?.cpf || ''
  const end = client.endereco || {}
  const cidade = end.cidade || client.cidade || ''
  const bairro = end.bairro || client.bairro || ''
  const rua = end.rua || end.logradouro || client.rua || ''
  const numero = end.numero || client.numero || ''
  const complemento = end.complemento || client.complemento || ''
  const cep = end.cep || client.cep || ''
  const rota = end.rota || client.rota || ''
  const rawTel = client.telefone || client.phone || client.whatsapp || ''
  const telDigits = cleanDigits(rawTel)

  // Texto unificado contendo todas as propriedades do cliente
  const unified = normalizeSearch([nome, pushName, apelido, email, doc, cidade, bairro, rua, numero, complemento, cep, rota, rawTel, telDigits].filter(Boolean).join(' '))

  // 1. Substring direta no texto unificado
  if (unified.includes(q)) return true

  // Se a busca tem "nº", "n°", "numero", remover para tentar substring limpa
  const qCleanPrefix = q.replace(/\b(n[º°\.]?|num|numero)\s*/gi, '').trim()
  if (qCleanPrefix && qCleanPrefix !== q && unified.includes(qCleanPrefix)) return true

  // 2. Tokens: TODAS as palavras digitadas na query devem existir nos dados do cliente
  // Exemplo: "claudia barbacena" acha Claudia cuja cidade é Barbacena
  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length > 0 && tokens.every(tok => {
    if (/^(n[º°\.]?|num|numero)$/i.test(tok)) return true
    const tokDigits = cleanDigits(tok)
    if (tokDigits.length >= 3 && phonesMatch(telDigits, tokDigits)) {
      return true
    }
    return unified.includes(tok)
  })) {
    return true
  }

  // 3. Verificação de dígitos do telefone / documento / cep
  const qDigits = cleanDigits(q)
  if (qDigits.length >= 3) {
    if (phonesMatch(telDigits, qDigits)) return true
    const docDigits = cleanDigits(doc)
    if (docDigits && docDigits.includes(qDigits)) return true
    const cepDigits = cleanDigits(cep)
    if (cepDigits && cepDigits.includes(qDigits)) return true
  }

  // 4. Verificação direta do número de endereço
  if (numero && String(numero).trim()) {
    const numNorm = normalizeSearch(numero)
    if (numNorm === q || (qCleanPrefix && numNorm === qCleanPrefix) || (qDigits && cleanDigits(numero) === qDigits)) return true
  }

  return false
}

