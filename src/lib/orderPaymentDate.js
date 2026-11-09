// Obtém a data efetiva de pagamento/quitação do pedido (para métricas e relatórios financeiros)
export function getOrderPaymentDate(o) {
  if (!o) return ''
  // 1. Histórico de pagamentos (data do último pagamento registrado)
  if (Array.isArray(o.paymentHistory) && o.paymentHistory.length > 0) {
    for (let idx = o.paymentHistory.length - 1; idx >= 0; idx--) {
      const ph = o.paymentHistory[idx]
      if (ph && ph.data) {
        const raw = String(ph.data).trim()
        const d = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0]
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
      }
    }
  }
  // 2. finalizadoAt (timestamp numérico em ms ou ISO string)
  if (o.finalizadoAt) {
    try {
      const d = typeof o.finalizadoAt === 'number'
        ? new Date(o.finalizadoAt).toISOString().split('T')[0]
        : String(o.finalizadoAt).split('T')[0].split(' ')[0]
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
    } catch {}
  }
  // 3. finalizada_em
  if (o.finalizada_em) {
    const d = String(o.finalizada_em).split('T')[0].split(' ')[0]
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  }
  // 4. paidDate ou paidAt ou dataPagamento
  const pd = o.paidDate || o.paidAt || o.dataPagamento || o.payment?.paidDate
  if (pd) {
    const d = String(pd).split('T')[0].split(' ')[0]
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  }
  // 5. deliveredAt para comandas concluídas ou calote
  if (o.deliveredAt && (o.status === 'concluido' || o.status === 'calote' || o.status === 'calote_parcial')) {
    try {
      const d = typeof o.deliveredAt === 'number'
        ? new Date(o.deliveredAt).toISOString().split('T')[0]
        : String(o.deliveredAt).split('T')[0].split(' ')[0]
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
    } catch {}
  }
  // 6. dataAcerto
  if (o.dataAcerto) {
    const d = String(o.dataAcerto).split('T')[0].split(' ')[0]
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  }
  // 7. Fallback: data de emissão / criação do pedido
  const raw = o.date || o.createdAt || o.dataInicio || o.created_at || ''
  return raw ? String(raw).split('T')[0].split(' ')[0] : ''
}

// Obtém a data de vencimento da comanda (calculada sempre a DATA DE VENCIMENTO)
export function getOrderDueDate(o, financial = []) {
  if (!o) return ''
  // 1. dataVencimento direta no pedido
  if (o.dataVencimento) {
    const raw = String(o.dataVencimento).trim()
    const d = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0]
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  }
  // 2. vencimento no pedido
  if (o.vencimento) {
    const raw = String(o.vencimento).trim()
    const d = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0]
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  }
  // 3. dueDate na tabela financial
  if (Array.isArray(financial) && financial.length > 0) {
    const f = financial.find(x => String(x.orderId || x.order_id) === String(o.id))
    if (f?.dueDate) {
      const raw = String(f.dueDate).trim()
      const d = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0]
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
    }
  }
  // 4. Fallback: data do pedido / criação
  const fallback = o.date || o.createdAt || o.dataInicio || o.created_at || ''
  if (fallback) {
    const raw = String(fallback).trim()
    const d = raw.includes('T') ? raw.split('T')[0] : raw.split(' ')[0]
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  }
  return ''
}
