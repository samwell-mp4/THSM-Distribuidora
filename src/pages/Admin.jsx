import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import './Admin.css'
import {
  supabase, syncAllForAdmin, getAllUsers, upsertOrders, upsertFinancial, upsertOrder, upsertUser,
  deleteOrder as supabaseDeleteOrder, deleteUserByTelefone, syncContatosToUsuarios, getAllLeads,
  upsertProducts, upsertDespesas, generateLoginToken, getAllRotaEdits, upsertRotaEdits, deleteRotaEdit as supabaseDeleteRotaEdit,
  deleteProducts as supabaseDeleteProducts, flushPendingOrders, deleteOnlyFinancialByOrder, samePhone, normTel, normalizePhoneDigits,
  formatImageUrl, reconcileOrdersUsers, saveUserViaWebhook
} from '../lib/supabase'
import { compressImageDataUrl, capPhotoSize } from '../lib/image'
import { idbGet, idbSet } from '../lib/idb'
import { searchMatches, normalizeSearch, clientMatchesSearch, phonesMatch, cleanDigits } from '../lib/search'

const STORAGE_PRODUCTS = 'thsm_admin_produtos'
const STORAGE_ORDERS = 'thsm_admin_orders'
const STORAGE_FINANCIAL = 'thsm_admin_financeiro'
const STORAGE_DESPESAS = 'thsm_admin_despesas'
const STORAGE_CUSTOM_ROTAS = 'thsm_custom_rotas'
const STORAGE_CUSTOM_CATS = 'thsm_custom_categorias'
const STORAGE_CUSTOM_TIPOS = 'thsm_custom_despesa_tipos'
const STORAGE_DELETED_ORDERS = 'thsm_deleted_order_ids'
const WEBHOOK_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/novo-pedido'
const LISTA_CONTATOS_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/lista-contatos'
const ALERTAR_ROTAS_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/alertar-rotas'
const WHATSAPP_FORCE_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/whatsapp-force'
const ADMIN_NOTIFY_PHONES = ['5531988868362', '5532988157834']
const LS = {
  get(key, def) {
    try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : def } catch { return def }
  },
  set(key, val) {
    if (key === STORAGE_ORDERS || key === STORAGE_FINANCIAL || key === STORAGE_PRODUCTS || key === 'thsm_usuarios') {
      idbSet(key, val).catch(() => {})
    }
    try {
      localStorage.setItem(key, JSON.stringify(val))
    } catch (e) {
      // LocalStorage quota reached (typically 5MB); remove bloated key from localStorage so stale data never persists
      try { localStorage.removeItem(key) } catch {}
      console.warn('LocalStorage quota limit reached for key (persisted in IndexedDB):', key)
    }
  }
}

function formatPreco(v) {
  return `R$ ${Number(v).toFixed(2).replace('.', ',')}`
}

const STATUS_LABELS = {
  'pre-pedido': 'Pré-Pedido',
  'pendente': 'Pendente',
  'confirmado': 'Confirmado',
  'em-andamento': 'Em Andamento',
  'em-rota': 'Em Rota',
  'entregue': 'Entregue',
  'acerto': 'Acerto',
  'concluido': 'Concluído',
  'cancelado': 'Cancelado'
}

function hoje() {
  return new Date().toISOString().split('T')[0]
}

function cleanDecimalInput(val) {
  if (val == null) return ''
  let str = String(val).replace(/\./g, ',').replace(/[^0-9,]/g, '')
  const parts = str.split(',')
  if (parts.length > 2) {
    str = parts[0] + ',' + parts.slice(1).join('')
  }
  return str
}

function parseDecimalToNumber(val) {
  if (val == null || val === '') return 0
  const clean = String(val).replace(/\s/g, '').replace(',', '.')
  const num = parseFloat(clean)
  return isNaN(num) ? 0 : num
}

function formatDate(str) {
  if (!str) return '-'
  const d = new Date(str + (str.length <= 10 ? 'T12:00:00' : ''))
  return d.toLocaleDateString('pt-BR')
}

function getOrderTime(o) {
  if (!o) return 0
  if (typeof o.createdAt === 'number') return o.createdAt
  if (o.created_at) {
    const t = new Date(o.created_at).getTime()
    if (!isNaN(t)) return t
  }
  if (o.date) {
    const t = new Date(o.date + 'T12:00:00').getTime()
    if (!isNaN(t)) return t
  }
  return Number(o.id) || 0
}

function getItemCost(item, produtosList = []) {
  if (!item) return 0
  if (item.preco_custo !== null && item.preco_custo !== undefined && item.preco_custo !== '') {
    const n = Number(String(item.preco_custo).replace(',', '.'))
    if (!isNaN(n) && n >= 0) return n
  }
  if (item.custo !== null && item.custo !== undefined && item.custo !== '') {
    const n = Number(String(item.custo).replace(',', '.'))
    if (!isNaN(n) && n >= 0) return n
  }
  if (Array.isArray(produtosList) && produtosList.length > 0) {
    const prod = produtosList.find(p => p && (
      (item.id != null && String(p.id) === String(item.id)) ||
      (item.nome && p.nome && p.nome.trim().toLowerCase() === item.nome.trim().toLowerCase()) ||
      (item.displayName && p.nome && p.nome.trim().toLowerCase() === item.displayName.trim().toLowerCase()) ||
      (item.nome && p.displayName && p.displayName.trim().toLowerCase() === item.nome.trim().toLowerCase())
    ))
    if (prod) {
      if (prod.preco_custo !== null && prod.preco_custo !== undefined && prod.preco_custo !== '') {
        const n = Number(String(prod.preco_custo).replace(',', '.'))
        if (!isNaN(n) && n >= 0) return n
      }
      if (prod.custo !== null && prod.custo !== undefined && prod.custo !== '') {
        const n = Number(String(prod.custo).replace(',', '.'))
        if (!isNaN(n) && n >= 0) return n
      }
    }
  }
  return 0
}

function getOrderBaseItems(order, produtosList = []) {
  if (!order) return []
  let rawItems = []
  if (Array.isArray(order.items) && order.items.length > 0) {
    const map = new Map()
    order.items.forEach(i => {
      const key = String(i.id != null ? i.id : i.nome)
      map.set(key, { ...i })
    })
    ;(order.returnedItems || []).forEach(r => {
      const key = String(r.id != null ? r.id : r.nome)
      const existing = map.get(key)
      const retQty = Number(r.returnedQty || r.qty || 0)
      if (existing) {
        existing.qty = Number(existing.qty || 0) + retQty
      } else {
        map.set(key, { ...r, qty: retQty })
      }
    })
    rawItems = Array.from(map.values())
  } else if (Array.isArray(order.originalItems) && order.originalItems.length > 0) {
    rawItems = order.originalItems.map(i => ({ ...i }))
  } else if (Array.isArray(order.itens) && order.itens.length > 0) {
    rawItems = order.itens.map(i => ({ ...i }))
  }

  return rawItems.map(i => {
    const c = (i.preco_custo !== null && i.preco_custo !== undefined && i.preco_custo !== '')
      ? Number(String(i.preco_custo).replace(',', '.'))
      : getItemCost(i, produtosList)
    return { ...i, preco_custo: c > 0 ? c : null }
  })
}

function diffDays(a, b) {
  return Math.floor((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / (1000 * 60 * 60 * 24))
}

function normalizePhone(v) {
  const nums = String(v || '').replace(/\D/g, '')
  if (!nums) return ''
  return nums.startsWith('55') ? nums : '55' + nums
}

const WEBHOOK_STATUS_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/novo-pedido'

function buildOrderLink(orderId) {
  return `${window.location.origin}${window.location.pathname}?pedido=${orderId}`
}

const PAG_METHODS = {
  pix: { label: 'Pix', icon: 'fa-qrcode' },
  dinheiro: { label: 'Dinheiro', icon: 'fa-money-bill-wave' },
  cartao: { label: 'Cartão', icon: 'fa-credit-card' },
  'pix+dinheiro': { label: 'Pix + Dinheiro', icon: 'fa-arrows-left-right' },
  'pix+cartao': { label: 'Pix + Cartão', icon: 'fa-arrows-left-right' },
  'cartao+dinheiro': { label: 'Cartão + Dinheiro', icon: 'fa-arrows-left-right' }
}

const PAG_SINGLE = ['pix', 'dinheiro', 'cartao']

const DESPESA_TIPOS = ['Alimentação', 'Combustível', 'Transporte', 'Material', 'Energia', 'Água', 'Internet', 'Aluguel', 'Salários', 'Impostos', 'Marketing', 'Manutenção', 'Embalagens', 'Outros']

function formatPagamento(m) {
  if (!m) return null
  return PAG_METHODS[m] || null
}

function inPeriod(date, period, month, rangeStart, rangeEnd) {
  if (!date) return period === 'all'
  if (period === 'month') return String(date).startsWith(month || '')
  if (period === 'range') {
    const okStart = !rangeStart || date >= rangeStart
    const okEnd = !rangeEnd || date <= rangeEnd
    return okStart && okEnd
  }
  return true
}

function PeriodFilter({ period, onChange, month, onMonth, rangeStart, onRangeStart, rangeEnd, onRangeEnd, label = 'Filtro' }) {
  const [open, setOpen] = useState(false)
  const opts = [
    { id: 'all', label: 'Período total' },
    { id: 'month', label: 'Por mês' },
    { id: 'range', label: 'Por data' },
  ]
  return (
    <div style={{ position: 'relative' }}>
      <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.35rem 0.6rem', borderColor: period !== 'all' ? 'var(--accent)' : undefined, color: period !== 'all' ? 'var(--accent)' : undefined, fontWeight: period !== 'all' ? 700 : 400 }} onClick={() => setOpen(v => !v)}>
        <i className="fa-solid fa-calendar-days"></i> {label}
        {period !== 'all' && <span style={{ marginLeft: '0.3rem', background: 'var(--accent)', color: 'white', borderRadius: '10px', padding: '0.05rem 0.4rem', fontSize: '0.7rem' }}>1</span>}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 60, minWidth: '230px', background: 'white', border: '1px solid var(--admin-border)', borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.12)', padding: '0.6rem' }}>
          {opts.map(o => (
            <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.2rem', cursor: 'pointer', fontSize: '0.8rem' }}>
              <input type="radio" name={`pf-${label}`} checked={period === o.id} onChange={() => { onChange(o.id); setOpen(false) }} style={{ cursor: 'pointer' }} />
              {o.label}
            </label>
          ))}
          {period === 'month' && (
            <input type="month" value={month} onChange={e => onMonth(e.target.value)} style={{ width: '100%', marginTop: '0.4rem', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.8rem' }} />
          )}
          {period === 'range' && (
            <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.4rem', alignItems: 'center', fontSize: '0.78rem' }}>
              <input type="date" value={rangeStart} onChange={e => onRangeStart(e.target.value)} style={{ flex: 1, minWidth: 0, padding: '0.3rem 0.4rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem' }} />
              <span style={{ color: 'var(--admin-text-sec)' }}>—</span>
              <input type="date" value={rangeEnd} onChange={e => onRangeEnd(e.target.value)} style={{ flex: 1, minWidth: 0, padding: '0.3rem 0.4rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem' }} />
            </div>
          )}
          {period !== 'all' && (
            <button className="admin-btn admin-btn-sec" style={{ width: '100%', marginTop: '0.4rem', fontSize: '0.75rem', padding: '0.3rem 0.5rem' }} onClick={() => { onChange('all'); onRangeStart(''); onRangeEnd(''); onMonth(''); setOpen(false) }}>
              <i className="fa-solid fa-xmark"></i> Limpar filtro
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function buildStatusWhatsApp(order, newStatus, extra = {}) {
  const link = buildOrderLink(order.id)
  const nome = order.customer?.nome || 'Cliente'
  const id = `#${order.id.toString().slice(-6)}`
  function formatDate(str) {
    if (!str) return '—'
    const d = new Date(String(str).length <= 10 ? str + 'T12:00:00' : str)
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR')
  }
  const dataPedido = formatDate(order.date || order.dataInicio || order.createdAt)
  const dataVencimento = formatDate(order.dataVencimento)

  function formatTelefone(tel) {
    if (!tel) return '—'
    const clean = String(tel).replace(/\D/g, '')
    const semDdi = clean.startsWith('55') && clean.length >= 12 ? clean.slice(2) : clean
    if (semDdi.length === 11) {
      return `(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 7)}-${semDdi.slice(7)}`
    }
    if (semDdi.length === 10) {
      return `(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 6)}-${semDdi.slice(6)}`
    }
    return tel
  }

  function formatEndereco(end) {
    if (!end) return '—'
    if (typeof end === 'string') return end.trim() || '—'
    const partes = [
      end.rua ? (end.numero ? `${end.rua}, ${end.numero}` : end.rua) : '',
      end.complemento,
      end.bairro,
      end.cidade ? (end.estado ? `${end.cidade} - ${end.estado}` : end.cidade) : '',
      end.cep ? `CEP: ${end.cep}` : ''
    ].filter(Boolean)
    return partes.length > 0 ? partes.join(', ') : '—'
  }

  const telFormatado = formatTelefone(order.customer?.telefone || order.telefone)
  const endFormatado = formatEndereco(order.customer?.endereco || order.endereco)

  const msgDatas = `📅 Data do pedido: ${dataPedido}
📅 Vencimento: ${dataVencimento}
📞 Telefone: ${telFormatado}
🏠 Endereço: ${endFormatado}`

  const formatBr = (n) => Number(n || 0).toFixed(2).replace('.', ',')

  const formatItemRow = (i) => {
    const unitPrice = formatBr(i.preco)
    const itemTotal = formatBr(Number(i.preco || 0) * (Number(i.qty) || 0))
    return `  • ${i.nome} — ${i.qty}x *R$ ${unitPrice}* = *R$ ${itemTotal}*`
  }

  const formatReturnedItemRow = (i) => {
    const unitPrice = formatBr(i.preco)
    const qty = Number(i.returnedQty || i.qty) || 0
    const itemTotal = formatBr(Number(i.preco || 0) * qty)
    return `  • ${i.nome} — ${qty}x *R$ ${unitPrice}* = *R$ ${itemTotal}*`
  }

  const totalQty = order.items.reduce((s, i) => s + (Number(i.qty) || 0), 0)
  const msgItems = order.items.map(formatItemRow).join('\n\n')
  const msgPagamento = order.pagamento === 'avista' ? 'À Vista' : order.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'

  const templates = {
    'pre-pedido': `⏳ *PRÉ-PEDIDO EM ANÁLISE* ⏳
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
${msgDatas}
━━━━━━━━━━━━━━━━━━
${msgItems}
━━━━━━━━━━━━━━━━━━
📦 *Total de itens:* *${totalQty}*
💰 *Valor Total:* *R$ ${formatBr(order.total)}*
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pré-pedido foi recebido e está em análise pela nossa equipe.
Em breve você receberá a confirmação.
━━━━━━━━━━━━━━━━━━
🔗 Acompanhe seu pedido: ${link}`,

    'pendente': `🆕 *PEDIDO RECEBIDO* 🆕
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
${msgDatas}
💳 Pagamento: ${msgPagamento}
━━━━━━━━━━━━━━━━━━
${msgItems}
━━━━━━━━━━━━━━━━━━
📦 *Total de itens:* *${totalQty}*
💰 *Valor Total:* *R$ ${formatBr(order.total)}*
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido foi recebido com sucesso!
Em breve confirmaremos seu pedido.
━━━━━━━━━━━━━━━━━━
🔗 Acompanhe seu pedido: ${link}`,

    'confirmado': `✅ *PEDIDO CONFIRMADO* ✅
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
${msgDatas}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido foi confirmado!
Em breve entraremos em contato para combinar a entrega.
━━━━━━━━━━━━━━━━━━
🔗 Acompanhe seu pedido: ${link}`,

    'em-andamento': `📋 *PEDIDO EM ANDAMENTO* 📋
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
${msgDatas}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido está em andamento e sendo preparado para entrega.
━━━━━━━━━━━━━━━━━━
🔗 Acompanhe seu pedido: ${link}`,

    'em-rota': `🚚 *PEDIDO EM ROTA* 🚚
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
${msgDatas}
💳 Pagamento: ${msgPagamento}
━━━━━━━━━━━━━━━━━━
📦 *ITENS:*

${msgItems}
━━━━━━━━━━━━━━━━━━
📦 *Total de itens:* *${totalQty}*
💰 *Valor Total:* *R$ ${formatBr(order.total)}*
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido já foi separado. Só aguardar a entrega.
🔗 Acesse seu pedido: ${link}`,

    'entregue': `✅ *PEDIDO ENTREGUE* ✅
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
${msgDatas}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido foi entregue com sucesso! 🎉
${order.items.length > 0 ? `📦 *ITENS:*\n\n${order.items.map(formatItemRow).join('\n\n')}
━━━━━━━━━━━━━━━━━━
📦 *Total de itens:* *${totalQty}*
💰 *Valor Total:* *R$ ${formatBr(order.total)}*` : ''}
━━━━━━━━━━━━━━━━━━
⚠️ *Importante:* Produtos embalados/lacrados não podem ser abertos. Não aceitamos devolução de produtos violados.
Você tem até 24 horas para nos informar se houver algum item faltando ou com avaria.
━━━━━━━━━━━━━━━━━━
📲 *Confirme o recebimento:* Clique no link abaixo para visualizar sua comanda e confirmar os itens recebidos:
${link}
━━━━━━━━━━━━━━━━━━
Obrigado pela preferência! 🎉`,

    'acerto': (() => {
      const returned = (extra.returnedItems || order.returnedItems || []).filter(i => (Number(i.returnedQty || i.qty) || 0) > 0)
      
      let remaining = []
      if (extra.remainingItems) {
        remaining = extra.remainingItems.filter(i => (Number(i.qty) || 0) > 0)
      } else {
        const base = extra.originalItems || order.originalItems || (order.items || [])
        const retMap = new Map()
        returned.forEach(r => {
          const key = String(r.id || r.nome)
          retMap.set(key, (retMap.get(key) || 0) + (Number(r.returnedQty || r.qty) || 0))
        })
        base.forEach(i => {
          const key = String(i.id || i.nome)
          const retQty = retMap.get(key) || 0
          const initialQty = Number(i.qty) || 0
          const keptQty = Math.max(0, initialQty - retQty)
          if (keptQty > 0) {
            remaining.push({ ...i, qty: keptQty })
          }
        })
      }
      const totalQtyPaid = remaining.reduce((s, i) => s + (Number(i.qty) || 0), 0)

      const devolvidosBlock = returned.length > 0
        ? `📦 *ITENS DEVOLVIDOS*\n\n${returned.map(formatReturnedItemRow).join('\n\n')}\n\n`
        : ''

      const pagosBlock = remaining.length > 0
        ? `📦 *ITENS PAGOS / MANTIDOS*\n\n${remaining.map(formatItemRow).join('\n\n')}\n\n`
        : (returned.length > 0 ? `📦 *ITENS PAGOS / MANTIDOS*\n  • Nenhum (devolução total dos itens)\n\n` : `📦 *ITENS PAGOS / MANTIDOS*\n  • Nenhum item\n\n`)

      const totalOriginalNum = Number(
        extra.totalOriginal != null
          ? extra.totalOriginal
          : (order.totalOriginal != null
              ? order.totalOriginal
              : (order.totalNota != null ? order.totalNota : (Number(order.total || 0) + returned.reduce((s, i) => s + (Number(i.preco || 0) * Number(i.returnedQty || i.qty || 0)), 0))))
      )
      const totalDevolvidoNum = Number(
        extra.totalDevolvido != null
          ? extra.totalDevolvido
          : returned.reduce((s, i) => s + (Number(i.preco || 0) * Number(i.returnedQty || i.qty || 0)), 0)
      )
      const descontoNum = Number(extra.desconto != null ? extra.desconto : (order.desconto || 0))
      const descPct = extra.descontoPercent != null ? extra.descontoPercent : (order.descontoPercent || null)
      const totalAcertoNum = Number(
        extra.totalAcerto != null
          ? extra.totalAcerto
          : (extra.totalComanda != null ? extra.totalComanda : (order.totalAcerto != null ? order.totalAcerto : (order.total || 0)))
      )

      const pm = (order.paymentMethod || extra.paymentMethod || '').toLowerCase()
      const splits = order.paymentSplits || extra.paymentSplits || {}
      const totalPagoNum = Number(extra.totalPago != null ? extra.totalPago : (order.totalPago != null ? order.totalPago : 0))
      const valorEmAbertoNum = Number(extra.valorEmAberto != null ? extra.valorEmAberto : Math.max(0, Math.round((totalAcertoNum - totalPagoNum) * 100) / 100))

      let paymentLines = []
      if (totalPagoNum > 0) {
        if (pm.includes('+')) {
          pm.split('+').forEach(m => {
            const val = Number(String(splits[m] || 0).replace(',', '.')) || 0
            const label = PAG_METHODS[m]?.label || m.toUpperCase()
            if (val > 0) paymentLines.push(`💰 *PAGOU NO ${label.toUpperCase()}:* *R$ ${formatBr(val)}*`)
          })
        } else if (pm) {
          const label = PAG_METHODS[pm]?.label || pm.toUpperCase()
          paymentLines.push(`💰 *PAGOU NO ${label.toUpperCase()}:* *R$ ${formatBr(totalPagoNum)}*`)
        }
        paymentLines.push(`💰 *TOTAL PAGO:* *R$ ${formatBr(totalPagoNum)}*`)
      } else {
        paymentLines.push(`💰 *TOTAL PAGO:* *R$ 0,00*`)
      }

      if (valorEmAbertoNum > 0) {
        paymentLines.push(`⚠️ *VALOR EM ABERTO:* *R$ ${formatBr(valorEmAbertoNum)}*`)
        const vencDate = formatDate(order.dataVencimento || extra.dataVencimento)
        if (vencDate && vencDate !== '—') {
          paymentLines.push(`📅 *DATA DE VENCIMENTO DO SALDO:* *${vencDate}*`)
        }
      } else {
        paymentLines.push(remaining.length === 0 && returned.length > 0
          ? `✅ *VALOR EM ABERTO:* *R$ 0,00* (Comanda quitada por devolução total)`
          : `✅ *VALOR EM ABERTO:* *R$ 0,00* (Totalmente quitado)`)
      }

      const paymentSection = paymentLines.join('\n')

      return `✅ *ACERTO DE PEDIDO* ✅
━━━━━━━━━━━━━━━━━━
📋 *Pedido:* ${id}
👤 *Cliente:* ${nome}
${msgDatas}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, confira o resumo do seu acerto:

${devolvidosBlock}${pagosBlock}━━━━━━━━━━━━━━━━━━
📦 *TOTAL DE ITENS PAGOS:* *${totalQtyPaid}*

💰 *VALOR TOTAL DA VENDA:* *R$ ${formatBr(totalOriginalNum)}*${totalDevolvidoNum > 0 ? `\n📦 *TOTAL DEVOLVIDO:* *- R$ ${formatBr(totalDevolvidoNum)}*` : ''}${descontoNum > 0 ? `\n🏷️ *DESCONTO${descPct ? ` (${descPct}%)` : ''}:* *- R$ ${formatBr(descontoNum)}*` : ''}
💰 *TOTAL DO ACERTO:* *R$ ${formatBr(totalAcertoNum)}*
━━━━━━━━━━━━━━━━━━
💳 *DETALHES DO PAGAMENTO:*
${paymentSection}
━━━━━━━━━━━━━━━━━━
⚠️ *Importante:* Produtos embalados/lacrados não podem ser abertos. Não aceitamos devolução de produtos violados.
Você tem até 24 horas para nos informar se houver algum item faltando ou com avaria.
━━━━━━━━━━━━━━━━━━`
    })(),

    'concluido': (() => {
      const returned = (extra.returnedItems || order.returnedItems || []).filter(i => (Number(i.returnedQty || i.qty) || 0) > 0)
      
      let remaining = []
      if (extra.remainingItems) {
        remaining = extra.remainingItems.filter(i => (Number(i.qty) || 0) > 0)
      } else {
        const base = extra.originalItems || order.originalItems || (order.items || [])
        const retMap = new Map()
        returned.forEach(r => {
          const key = String(r.id || r.nome)
          retMap.set(key, (retMap.get(key) || 0) + (Number(r.returnedQty || r.qty) || 0))
        })
        base.forEach(i => {
          const key = String(i.id || i.nome)
          const retQty = retMap.get(key) || 0
          const initialQty = Number(i.qty) || 0
          const keptQty = Math.max(0, initialQty - retQty)
          if (keptQty > 0) {
            remaining.push({ ...i, qty: keptQty })
          }
        })
      }
      const totalQtyPaid = remaining.reduce((s, i) => s + (Number(i.qty) || 0), 0)

      const devolvidosBlock = returned.length > 0
        ? `📦 *ITENS DEVOLVIDOS*\n\n${returned.map(formatReturnedItemRow).join('\n\n')}\n\n`
        : ''

      const pagosBlock = remaining.length > 0
        ? remaining.map(formatItemRow).join('\n\n')
        : (returned.length > 0 ? '  • Nenhum (devolução total dos itens)' : '  • Nenhum item')

      const totalOriginalNum = Number(
        extra.totalOriginal != null
          ? extra.totalOriginal
          : (order.totalOriginal != null
              ? order.totalOriginal
              : (order.totalNota != null ? order.totalNota : (Number(order.total || 0) + returned.reduce((s, i) => s + (Number(i.preco || 0) * Number(i.returnedQty || i.qty || 0)), 0))))
      )
      const totalDevolvidoNum = Number(
        extra.totalDevolvido != null
          ? extra.totalDevolvido
          : returned.reduce((s, i) => s + (Number(i.preco || 0) * Number(i.returnedQty || i.qty || 0)), 0)
      )
      const descontoNum = Number(extra.desconto != null ? extra.desconto : (order.desconto || 0))
      const descPct = extra.descontoPercent != null ? extra.descontoPercent : (order.descontoPercent || null)
      const totalAcertoNum = Number(
        extra.totalAcerto != null
          ? extra.totalAcerto
          : (extra.totalComanda != null ? extra.totalComanda : (order.totalAcerto != null ? order.totalAcerto : (order.total || 0)))
      )

      const pm = (order.paymentMethod || extra.paymentMethod || 'pix').toLowerCase()
      const splits = order.paymentSplits || extra.paymentSplits || {}
      const totalPagoNum = Number(extra.totalPago != null ? extra.totalPago : (order.totalPago != null ? order.totalPago : order.total)) || 0
      const valorEmAbertoNum = Number(extra.valorEmAberto != null ? extra.valorEmAberto : Math.max(0, Math.round((totalAcertoNum - totalPagoNum) * 100) / 100))

      let paymentLines = []
      if (totalPagoNum > 0) {
        if (pm.includes('+')) {
          pm.split('+').forEach(m => {
            const val = Number(String(splits[m] || 0).replace(',', '.')) || 0
            const label = PAG_METHODS[m]?.label || m.toUpperCase()
            if (val > 0) paymentLines.push(`💰 *PAGOU NO ${label.toUpperCase()}:* *R$ ${formatBr(val)}*`)
          })
        } else {
          const label = PAG_METHODS[pm]?.label || (pm ? pm.toUpperCase() : 'PIX')
          paymentLines.push(`💰 *PAGOU NO ${label.toUpperCase()}:* *R$ ${formatBr(totalPagoNum)}*`)
        }
        paymentLines.push(`💰 *VALOR TOTAL PAGO:* *R$ ${formatBr(totalPagoNum)}*`)
      } else {
        paymentLines.push(`💰 *VALOR TOTAL PAGO:* *R$ 0,00*`)
      }

      if (valorEmAbertoNum > 0) {
        paymentLines.push(`⚠️ *VALOR EM ABERTO:* *R$ ${formatBr(valorEmAbertoNum)}*`)
        const vencDate = formatDate(order.dataVencimento || extra.dataVencimento)
        if (vencDate && vencDate !== '—') {
          paymentLines.push(`📅 *DATA DE VENCIMENTO DO SALDO:* *${vencDate}*`)
        }
      } else {
        paymentLines.push(remaining.length === 0 && returned.length > 0
          ? `✅ *VALOR EM ABERTO:* *R$ 0,00* (Comanda quitada por devolução total)`
          : `✅ *VALOR EM ABERTO:* *R$ 0,00* (Totalmente quitado)`)
      }

      const paymentSection = paymentLines.join('\n')
      const devolucaoLine = returned.length > 0 ? `\n\n*DEVOLUÇÃO REALIZADA ✅*` : ''

      return `✅ *PEDIDO FINALIZADO* ✅
━━━━━━━━━━━━━━━━━━
📋 *Pedido:* ${id}
👤 *Cliente:* ${nome}
${msgDatas}
━━━━━━━━━━━━━━━━━━
${devolvidosBlock}📦 *ITENS PAGOS / MANTIDOS*

${pagosBlock}

━━━━━━━━━━━━━━━━━━
📦 *TOTAL DE ITENS PAGOS:* *${totalQtyPaid}*

💰 *VALOR TOTAL DA VENDA:* *R$ ${formatBr(totalOriginalNum)}*${totalDevolvidoNum > 0 ? `\n📦 *TOTAL DEVOLVIDO:* *- R$ ${formatBr(totalDevolvidoNum)}*` : ''}${descontoNum > 0 ? `\n🏷️ *DESCONTO${descPct ? ` (${descPct}%)` : ''}:* *- R$ ${formatBr(descontoNum)}*` : ''}
💰 *TOTAL DO ACERTO:* *R$ ${formatBr(totalAcertoNum)}*
━━━━━━━━━━━━━━━━━━
💳 *DETALHES DO PAGAMENTO:*
${paymentSection}${devolucaoLine}
━━━━━━━━━━━━━━━━━━
📲 *Acesse sua comanda:* ${link}
━━━━━━━━━━━━━━━━━━
Obrigado pela preferência! 🎉`
    })(),

    'cancelado': `❌ *PEDIDO CANCELADO* ❌
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
${msgDatas}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido foi cancelado.
Em caso de dúvidas, entre em contato conosco.
━━━━━━━━━━━━━━━━━━`,

    'acerto': `🤝 *PEDIDO EM ACERTO* 🤝
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
${msgDatas}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido está na etapa de Acerto de devoluções e valores.
🔗 ${link}`
  }

  return templates[newStatus] || `📋 *Atualização do Pedido ${id}* 📋\n━━━━━━━━━━━━━━━━━━\nStatus: ${newStatus}\n🔗 ${link}`
}

function sendStatusWebhook(order, newStatus, extra = {}) {
  try {
    if (order?.status === 'pre-pedido' && newStatus === 'pendente') return
    const whatsappMessage = buildStatusWhatsApp(order, newStatus, extra)
    const returnedItems = extra.returnedItems || order.returnedItems || []
    const rawPhone = (order.customer?.telefone || '').replace(/\D/g, '')
    const telefone = rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone
    const customer = { ...order.customer, telefone }
    const itemsList = Array.isArray(order?.items) ? order.items : (Array.isArray(order?.itens) ? order.itens : [])
    fetch(WEBHOOK_STATUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'atualizacao-pedido',
        whatsappMessage,
        adminPhones: ADMIN_NOTIFY_PHONES,
        admin_phones: ADMIN_NOTIFY_PHONES,
        order: {
          id: order.id,
          date: order.date,
          status: newStatus,
          pagamento: order.pagamento,
          total: order.total,
          totalAvista: order.totalAvista,
          totalAprazo: order.totalAprazo,
          customer,
          items: itemsList.map(i => ({ nome: i.nome, qty: i.qty, preco: i.preco, tipo: i.tipo })),
          ...(returnedItems.length > 0 ? { returnedItems: returnedItems.map(i => ({ nome: i.nome, returnedQty: i.returnedQty || i.qty, preco: i.preco })) } : {})
        }
      })
    }).catch(() => { })

    // Notificação espelho para os administradores
    ADMIN_NOTIFY_PHONES.forEach(adminTel => {
      fetch(WHATSAPP_FORCE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telefone: adminTel,
          message: `🔔 *[STATUS PEDIDO - THSM DISTRIBUIDORA]*\n\n${whatsappMessage}`
        })
      }).catch(() => { })
    })
  } catch (err) {
    console.warn('Erro ao disparar sendStatusWebhook:', err)
  }
}

function sendAlertRota(tipo, contatos, orders, customText = '') {
  function formatDate(str) {
    if (!str) return '-'
    const d = new Date(str + (str.length <= 10 ? 'T12:00:00' : ''))
    return d.toLocaleDateString('pt-BR')
  }
  function formatPreco(v) {
    return `R$ ${Number(v).toFixed(2).replace('.', ',')}`
  }
  function formatTelefone(tel) {
    if (!tel) return '—'
    const clean = String(tel).replace(/\D/g, '')
    const semDdi = clean.startsWith('55') && clean.length >= 12 ? clean.slice(2) : clean
    if (semDdi.length === 11) {
      return `(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 7)}-${semDdi.slice(7)}`
    }
    if (semDdi.length === 10) {
      return `(${semDdi.slice(0, 2)}) ${semDdi.slice(2, 6)}-${semDdi.slice(6)}`
    }
    return tel
  }

  function formatEndereco(end) {
    if (!end) return '—'
    if (typeof end === 'string') return end.trim() || '—'
    const partes = [
      end.rua ? (end.numero ? `${end.rua}, ${end.numero}` : end.rua) : '',
      end.complemento,
      end.bairro,
      end.cidade ? (end.estado ? `${end.cidade} - ${end.estado}` : end.cidade) : '',
      end.cep ? `CEP: ${end.cep}` : ''
    ].filter(Boolean)
    return partes.length > 0 ? partes.join(', ') : '—'
  }

  const contacts = contatos.map((c) => {
    const telefone = c.remoteJid?.replace(/@.*/, '').replace(/\D/g, '') || ''
    const normalizedPhone = telefone.startsWith('55') ? telefone : '55' + telefone
    let loginLink = ''
    if (telefone) {
      loginLink = `${window.location.origin}${window.location.pathname}?login=${btoa(normalizedPhone)}`
    }
    const userOrders = (orders || []).filter(o => {
      const ot = o.customer?.telefone || ''
      return ot === normalizedPhone || ot === telefone
    })
    const openOrders = userOrders.filter(o => !['entregue', 'cancelado'].includes(o.status))
    const lastOrder = openOrders[0]
    let whatsappMessage = ''
    const nome = c.pushName || c.nome || 'Cliente'
    if (tipo === 'personalizado') {
      whatsappMessage = customText
    } else if (tipo === 'alerta') {
      if (lastOrder) {
        const itens = lastOrder.items?.slice(0, 3).map(i => `  • ${i.nome} (${i.qty}x)`).join('\n') || ''
        const extras = lastOrder.items?.length > 3 ? `\n  ...e mais ${lastOrder.items.length - 3} item(ns)` : ''
        const telContact = formatTelefone(lastOrder.customer?.telefone || normalizedPhone)
        const endContact = formatEndereco(lastOrder.customer?.endereco)
        whatsappMessage = `🚚 *PASSANDO NA SUA CIDADE!* 🚚\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n📋 Pedido #${lastOrder.id.toString().slice(-6)}\n📅 Data: ${formatDate(lastOrder.date || lastOrder.createdAt)}\n📅 Vencimento: ${formatDate(lastOrder.dataVencimento)}\n📞 Telefone: ${telContact}\n🏠 Endereço: ${endContact}\n📌 Status: ${lastOrder.status}\n💵 Total: ${formatPreco(lastOrder.total)}\n${itens}${extras}\n━━━━━━━━━━━━━━━━━━\nEstamos na sua região! Seu pedido está em aberto.\n🔗 Acesse sua conta: ${loginLink}`
      } else {
        whatsappMessage = `🚚 *PASSANDO NA SUA CIDADE!* 🚚\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nEstamos passando na sua cidade! Aproveite para fazer seu pedido.\n🔗 Faça já seu pedido: ${loginLink}`
      }
    } else if (tipo === 'atualizacao') {
      if (lastOrder) {
        const itens = lastOrder.items?.slice(0, 3).map(i => `  • ${i.nome} (${i.qty}x) — ${formatPreco(i.preco * i.qty)}`).join('\n') || ''
        const extras = lastOrder.items?.length > 3 ? `\n  ...e mais ${lastOrder.items.length - 3} item(ns)` : ''
        const dataPedido = formatDate(lastOrder.date || lastOrder.createdAt)
        const dataVencimento = formatDate(lastOrder.dataVencimento)
        const telContact = formatTelefone(lastOrder.customer?.telefone || normalizedPhone)
        const endContact = formatEndereco(lastOrder.customer?.endereco)
        const finRecords = JSON.parse(localStorage.getItem('thsm_admin_financeiro') || '[]')
          .filter(f => f.orderId === lastOrder.id && f.status === 'pendente')
        const vencimentos = finRecords.slice(0, 2).map(f => `  📅 ${f.itemName}: ${formatDate(f.dueDate)} — ${formatPreco(f.value)}`).join('\n')
        const vencExtras = finRecords.length > 2 ? `\n  ...e mais ${finRecords.length - 2} parcela(s)` : ''
        whatsappMessage = `📋 *ATUALIZAÇÃO DO PEDIDO* 📋\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n📋 Pedido: #${lastOrder.id.toString().slice(-6)}\n📅 Data: ${dataPedido}\n📅 Vencimento: ${dataVencimento}\n📞 Telefone: ${telContact}\n🏠 Endereço: ${endContact}\n📌 Status: ${lastOrder.status}\n${itens}${extras}\n💵 Total: ${formatPreco(lastOrder.total)}${vencimentos ? `\n━━━━━━━━━━━━━━━━━━\n📆 *Pendências:*\n${vencimentos}${vencExtras}` : ''}\n━━━━━━━━━━━━━━━━━━\n🔗 Acompanhe seu pedido: ${loginLink}`
      } else {
        whatsappMessage = `📋 *ATUALIZAÇÃO* 📋\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nVocê ainda não tem pedidos conosco.\nAproveite para fazer seu pedido agora!\n🔗 Fazer pedido: ${loginLink}`
      }
    }
    return {
      remoteJid: c.remoteJid,
      pushName: c.pushName || c.nome || '',
      cidade: c.cidade || '',
      rota: c.rota || '',
      telefone: normalizedPhone,
      loginLink,
      whatsappMessage
    }
  })
  const payload = {
    event: tipo === 'alerta' ? 'alertar-rotas' : tipo === 'atualizacao' ? 'atualizacao-pedidos' : 'personalizado',
    contacts,
    ...(tipo === 'personalizado' && customText ? { message: customText } : {})
  }
  fetch(ALERTAR_ROTAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => { })
}

import AddressForm from '../components/AddressForm'
import MapView from '../components/MapView'
import CentralAnalise from '../components/CentralAnalise'
import OrderReportModal from '../components/OrderReportModal'

export default function Admin({ produtos, refreshProducts, onVoltar }) {
  const [tab, setTab] = useState(() => sessionStorage.getItem('thsm_admin_tab') || 'dashboard')
  useEffect(() => { sessionStorage.setItem('thsm_admin_tab', tab) }, [tab])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [orders, setOrders] = useState(() => LS.get(STORAGE_ORDERS, []))
  useEffect(() => {
    idbGet(STORAGE_ORDERS).then(cached => {
      if (Array.isArray(cached) && cached.length > 0) {
        setOrders(prev => {
          if (!prev || prev.length === 0) return cached
          const orderMap = new Map()
          cached.forEach(o => { if (o && o.id != null) orderMap.set(String(o.id), o) })
          prev.forEach(o => {
            if (!o || o.id == null) return
            const id = String(o.id)
            const c = orderMap.get(id)
            if (!c) {
              orderMap.set(id, o)
            } else {
              const pTime = Number(o.lastModified || o.updatedAt || getOrderTime(o) || 0)
              const cTime = Number(c.lastModified || c.updatedAt || getOrderTime(c) || 0)
              if (pTime > cTime) {
                orderMap.set(id, o)
              }
            }
          })
          return Array.from(orderMap.values())
        })
      }
    }).catch(() => {})
  }, [])

  const [deletedOrderIds, setDeletedOrderIds] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DELETED_ORDERS)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const deletedOrderIdsRef = useRef(new Set(deletedOrderIds.map(String)))
  useEffect(() => {
    deletedOrderIdsRef.current = new Set(deletedOrderIds.map(String))
    try {
      localStorage.setItem(STORAGE_DELETED_ORDERS, JSON.stringify(deletedOrderIds))
    } catch {}
  }, [deletedOrderIds])

  const [financial, setFinancial] = useState(() => LS.get(STORAGE_FINANCIAL, []))
  const [toast, setToast] = useState(null)

  const isFinalizada = useCallback((o) => {
    if (!o) return false
    return o.status === 'concluido' || o.isFinalizado === true
  }, [])

  const revertToEntregue = async (orderId) => {
    const order = orders.find(o => String(o.id) === String(orderId))
    if (!order) return
    if (!confirm('Deseja voltar este pedido para Entregues?')) return
    const updated = {
      ...order,
      status: 'entregue',
      isFinalizado: false,
      lastModified: Date.now(),
      updatedAt: Date.now()
    }
    setOrders(prev => {
      const next = prev.map(o => String(o.id) === String(orderId) ? updated : o)
      LS.set(STORAGE_ORDERS, next)
      return next
    })
    await upsertOrder(updated)
    showToast(`Pedido #${orderId} voltou para Entregues!`)
    sendStatusWebhook(updated, 'entregue')
  }

  const revertOrderFinalization = async (orderId) => {
    const order = orders.find(o => String(o.id) === String(orderId))
    if (!order) return
    if (!confirm('Deseja voltar este pedido para Acertos? (Isso irá reverter as devoluções e pagamentos)')) return

    // 1. Restore items (add back returned quantities)
    const baseItems = getOrderBaseItems(order)

    const totalAvista = baseItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0)
    const totalAprazo = baseItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0)

    const updatedOrder = {
      ...order,
      items: baseItems,
      itens: baseItems,
      originalItems: baseItems.map(i => ({ ...i })),
      totalAvista: Math.round(totalAvista * 100) / 100,
      totalAprazo: Math.round(totalAprazo * 100) / 100,
      total: Math.round((totalAvista + totalAprazo) * 100) / 100,
      desconto: 0,
      totalPago: 0,
      status: 'acerto',
      isFinalizado: false,
      returnedItems: [],
      totalReembolso: 0,
      paymentMethod: '',
      paymentSplits: null,
      payment: null,
      lastModified: Date.now(),
      updatedAt: Date.now()
    }

    setOrders(prev => {
      const next = prev.map(o => String(o.id) === String(orderId) ? updatedOrder : o)
      LS.set(STORAGE_ORDERS, next)
      return next
    })
    await upsertOrder(updatedOrder)

    // 2. Revert financial records in DB and State
    await deleteOnlyFinancialByOrder(orderId)

    setFinancial(prev => {
      const otherRecords = prev.filter(f => String(f.orderId) !== String(orderId))
      const orderAprazoItems = baseItems.filter(i => i.tipo === 'aprazo')

      const restoredFinancial = orderAprazoItems.map(i => {
        const existing = prev.find(f => String(f.id) === String(orderId + '-' + i.id))
        return {
          id: orderId + '-' + i.id,
          orderId,
          customerName: order.customer?.nome || '',
          itemName: i.nome,
          qty: i.qty,
          value: Math.round((Number(i.preco) || 0) * (Number(i.qty) || 0) * 100) / 100,
          precoCusto: Math.round(getItemCost(i, produtosAtuais) * (Number(i.qty) || 0) * 100) / 100,
          dueDate: existing?.dueDate || order.dataVencimento || hoje(),
          paidDate: null,
          status: 'pendente',
          paymentMethod: ''
        }
      })

      const newFin = [...otherRecords, ...restoredFinancial]
      LS.set(STORAGE_FINANCIAL, newFin)
      upsertFinancial(restoredFinancial) // upsert only the new restored ones
      return newFin
    })

    showToast(`Pedido #${orderId} voltou para Acertos! Pagamentos e devoluções revertidos.`)
    sendStatusWebhook(updatedOrder, 'acerto')
  }

  const [orderFilter, setOrderFilter] = useState('todos')
  const [prodSearch, setProdSearch] = useState('')
  const [prodPage, setProdPage] = useState(1)
  const [editingProd, setEditingProd] = useState(null)
  const [prodViewMode, setProdViewMode] = useState('visual')
  const [prodCart, setProdCart] = useState({})
  const [prodCartOpen, setProdCartOpen] = useState(false)
  const [prodImageErrors, setProdImageErrors] = useState({})
  const [showAddOrder, setShowAddOrder] = useState(false)
  const [showOrderReportModal, setShowOrderReportModal] = useState(false)
  const [preselectedUserForOrder, setPreselectedUserForOrder] = useState(null)
  const [showOrderDetail, setShowOrderDetail] = useState(null)
  const [showRotaDue, setShowRotaDue] = useState(null)
  const [rotaDueDate, setRotaDueDate] = useState('')
  const [showDeliveryModal, setShowDeliveryModal] = useState(null)
  const [deliveryModalMode, setDeliveryModalMode] = useState('acerto')
  const [returnQuantities, setReturnQuantities] = useState({})
  const [payQuantities, setPayQuantities] = useState({})
  const [identityPreview, setIdentityPreview] = useState('')
  const [addressPreview, setAddressPreview] = useState('')
  const [finFilter, setFinFilter] = useState('todos')
  const [finSort, setFinSort] = useState({ key: null, direction: 'asc' })
  const [finEdit, setFinEdit] = useState(null)
  const [finView, setFinView] = useState('lista')
  const [finTab, setFinTab] = useState('receber')
  const [finPeriod, setFinPeriod] = useState('all')
  const [finPeriodMonth, setFinPeriodMonth] = useState(hoje().slice(0, 7))
  const [finRangeStart, setFinRangeStart] = useState('')
  const [finRangeEnd, setFinRangeEnd] = useState('')
  const [despesas, setDespesas] = useState(() => LS.get(STORAGE_DESPESAS, []))
  const [despesaFilter, setDespesaFilter] = useState('todas')
  const [despPeriod, setDespPeriod] = useState('all')
  const [despPeriodMonth, setDespPeriodMonth] = useState(hoje().slice(0, 7))
  const [despRangeStart, setDespRangeStart] = useState('')
  const [despRangeEnd, setDespRangeEnd] = useState('')
  const [showDespesaModal, setShowDespesaModal] = useState(false)
  const [editingDespesa, setEditingDespesa] = useState(null)
  const [quitarFinTarget, setQuitarFinTarget] = useState(null)
  const [quitarPayment, setQuitarPayment] = useState('pix')
  const [deliveryPayment, setDeliveryPayment] = useState('pix')
  const [deliverySplits, setDeliverySplits] = useState({ pix: '', dinheiro: '', cartao: '' })
  const [deliveryDiscount, setDeliveryDiscount] = useState('')
  const [deliveryDiscountType, setDeliveryDiscountType] = useState('reais')
  const [deliveryPaid, setDeliveryPaid] = useState('')
  const [deliveryDataInicio, setDeliveryDataInicio] = useState(() => hoje())
  const [deliveryDataVenc, setDeliveryDataVenc] = useState('')
  const [usuarios, setUsuarios] = useState(() => {
    const cached = LS.get('thsm_usuarios', [])
    return Array.isArray(cached) ? cached : []
  })

  // Carrega usuários do IndexedDB imediatamente se localStorage estiver vazio ou limitado por cota
  useEffect(() => {
    idbGet('thsm_usuarios').then(cached => {
      if (Array.isArray(cached) && cached.length > 0) {
        setUsuarios(prev => {
          const prevArr = Array.isArray(prev) ? prev : []
          if (prevArr.length === 0) return cached
          const map = new Map()
          cached.forEach(u => { if (u) map.set(u.id || u.telefone, u) })
          prevArr.forEach(u => { if (u) map.set(u.id || u.telefone, u) })
          return Array.from(map.values())
        })
      }
    }).catch(() => {})
  }, [])

  const [syncingUsers, setSyncingUsers] = useState(false)
  const [isInitialSyncing, setIsInitialSyncing] = useState(true)
  const [selectedUserEmail, setSelectedUserEmail] = useState(null)
  const [selectedUserDetail, setSelectedUserDetail] = useState(null)
  const [recoverLinkUser, setRecoverLinkUser] = useState(null)
  const [recoverLink, setRecoverLink] = useState('')
  const [pwTarget, setPwTarget] = useState(null)
  const [pwNew, setPwNew] = useState('')
  const [editingUser, setEditingUser] = useState(false)
  const [editUserData, setEditUserData] = useState(null)
  const [userSearch, setUserSearch] = useState('')
  const [userCityFilter, setUserCityFilter] = useState('TODAS')
  const [userOrigemFilter, setUserOrigemFilter] = useState('TODAS')
  const [userEnderecoSearch, setUserEnderecoSearch] = useState('')
  const [userSort, setUserSort] = useState({ field: 'nome', dir: 'asc' })
  const [userPage, setUserPage] = useState(1)
  const [selectedUserIds, setSelectedUserIds] = useState(new Set())
  const [userMsgMenu, setUserMsgMenu] = useState(null)
  const USER_PAGE_SIZE = 50
  const PROD_PER_PAGE = 50
  const [prodCatFilter, setProdCatFilter] = useState('TODOS')
  const [customCategorias, setCustomCategorias] = useState(() => LS.get(STORAGE_CUSTOM_CATS, []))
  const [customDespesaTipos, setCustomDespesaTipos] = useState(() => LS.get(STORAGE_CUSTOM_TIPOS, []))
  const [prodStockFilter, setProdStockFilter] = useState('todos')
  const [prodPriceRange, setProdPriceRange] = useState([0, 5000])
  const [prodSort, setProdSort] = useState({ field: 'nome', dir: 'asc' })
  const [prodSelectedIds, setProdSelectedIds] = useState(new Set())
  const [showBulkPrice, setShowBulkPrice] = useState(false)
  const [bulkPriceValue, setBulkPriceValue] = useState('')
  const [showBulkStock, setShowBulkStock] = useState(false)
  const [bulkStockValue, setBulkStockValue] = useState('')
  const [leads, setLeads] = useState([])
  const [orderSearch, setOrderSearch] = useState('')
  const [orderSort, setOrderSort] = useState({ field: 'createdAt', dir: 'desc' })
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [orderDateStart, setOrderDateStart] = useState('')
  const [orderDateEnd, setOrderDateEnd] = useState('')
  const [orderDueStart, setOrderDueStart] = useState('')
  const [orderDueEnd, setOrderDueEnd] = useState('')
  const [orderCityFilter, setOrderCityFilter] = useState('TODAS')
  const [orderRoutesSelected, setOrderRoutesSelected] = useState(() => new Set())
  const [showOrderRouteFilter, setShowOrderRouteFilter] = useState(false)
  const [mobileOrdersFilterOpen, setMobileOrdersFilterOpen] = useState(false)
  const [dashPeriod, setDashPeriod] = useState('month')
  const [dashCustomStart, setDashCustomStart] = useState('')
  const [dashCustomEnd, setDashCustomEnd] = useState('')
  const [orderPage, setOrderPage] = useState(1)
  const ORDER_PAGE_SIZE = 50
  const [semDevReport, setSemDevReport] = useState(null)
  const [semDevGroups, setSemDevGroups] = useState({})
  const [rotas, setRotas] = useState([])
  const [rotasLoading, setRotasLoading] = useState(false)
  const [importingRotas, setImportingRotas] = useState(false)
  const [rotasError, setRotasError] = useState(null)
  const [expandedRota, setExpandedRota] = useState(null)
  const [filterCidade, setFilterCidade] = useState('TODAS')
  const [filterRota, setFilterRota] = useState('TODAS')
  const [filterRotaSearch, setFilterRotaSearch] = useState('')
  const [filterTipo, setFilterTipo] = useState('TODOS')
  const [customMsgRota, setCustomMsgRota] = useState(null)
  const [customMsgText, setCustomMsgText] = useState('')
  const [showNewRota, setShowNewRota] = useState(false)
  const [newRotaName, setNewRotaName] = useState('')
  const [newRotaSearch, setNewRotaSearch] = useState('')
  const [newRotaSelected, setNewRotaSelected] = useState([])
  const [newContactPhone, setNewContactPhone] = useState('')
  const [newContactName, setNewContactName] = useState('')
  const [editCustomContact, setEditCustomContact] = useState(null)
  const [editContactName, setEditContactName] = useState('')
  const [editContactPhone, setEditContactPhone] = useState('')
  const [editContactCity, setEditContactCity] = useState('')
  const [rotaContactModal, setRotaContactModal] = useState(null)
  const [showRestoreRota, setShowRestoreRota] = useState(null)
  const [customRotas, setCustomRotas] = useState(() => LS.get(STORAGE_CUSTOM_ROTAS, []))
  const [rotaEdits, setRotaEdits] = useState(() => LS.get('thsm_rota_edits', []))
  const [kits, setKits] = useState(() => LS.get('thsm_kits', []))
  const [showKitModal, setShowKitModal] = useState(false)
  const [editingKit, setEditingKit] = useState(null)
  // States removidos: newProducts, deletedProdIds
  const [reconcilingOrders, setReconcilingOrders] = useState(false)

  const handleReconcileOrders = async () => {
    if (reconcilingOrders) return
    setReconcilingOrders(true)
    showToast('Iniciando conciliação de pedidos...')
    try {
      const res = await reconcileOrdersUsers()
      if (res.error) {
        showToast(`Erro na conciliação: ${res.error}`, 'error')
      } else if (res.pedidosAtualizados === 0 && res.totalSemId === 0) {
        showToast('Todos os pedidos já possuem ID de usuário vinculado!')
      } else {
        showToast(`Conciliados ${res.pedidosAtualizados} pedido(s)! (${res.novosUsuarios} novos usuários cadastrados)`)
        // Atualiza pedidos e usuários na tela
        const [o, u] = await Promise.all([
          supabase.from('pedidos').select('*'),
          getAllUsers()
        ])
        if (o.data) {
          const fixed = o.data.map(r => r.data && typeof r.data === 'object' ? { ...r.data, user_id: r.user_id, status: r.status } : r)
          setOrders(fixed)
          LS.set(STORAGE_ORDERS, fixed)
        }
        if (u) {
          setUsuarios(u)
          LS.set('thsm_usuarios', u)
        }
      }
    } catch (e) {
      console.error(e)
      showToast('Erro ao conciliar pedidos.', 'error')
    } finally {
      setReconcilingOrders(false)
    }
  }

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  const buildAddressString = (e) => {
    return [e.rua, e.numero, e.bairro, e.cidade, e.estado].filter(Boolean).join(', ')
  }

  const openGoogleMaps = (addr) => {
    if (addr) window.open(`https://www.google.com/maps/search/${encodeURIComponent(addr)}`, '_blank')
  }

  const openRoutePlanning = (users) => {
    const addresses = users.map(u => buildAddressString(u.endereco || {})).filter(Boolean)
    if (addresses.length === 0) return showToast('Nenhum endereço válido selecionado', 'error')
    window.open(`https://www.google.com/maps/dir/${addresses.map(a => encodeURIComponent(a)).join('/')}`, '_blank')
  }

  const USER_MSG_TEMPLATES = [
    { key: 'passando', label: 'Passando na sua cidade', icon: 'fa-truck', msg: (nome) => `🚚 *PASSANDO NA SUA CIDADE!* 🚚\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nEstamos passando na sua cidade! Aproveite para fazer seu pedido.\n🔗 Faça já seu pedido: ${window.location.origin}${window.location.pathname}` },
    { key: 'acerto', label: 'Acerto financeiro', icon: 'fa-coins', msg: (nome) => `💰 *ACERTO FINANCEIRO* 💰\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nOlá! Passando para lembrar sobre o acerto financeiro pendente.\n🔗 Acesse sua conta: ${window.location.origin}${window.location.pathname}?login=` },
    { key: 'pedido', label: 'Novidades no catálogo', icon: 'fa-tag', msg: (nome) => `🛍️ *NOVIDADES NO CATÁLOGO!* 🛍️\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nTemos novidades incríveis no catálogo! Venha conferir.\n🔗 Ver catálogo: ${window.location.origin}${window.location.pathname}` },
    { key: 'personalizado', label: 'Personalizado', icon: 'fa-pen', msg: (nome) => '' },
  ]

  const sendUserWhatsApp = (u, templateKey) => {
    const phone = (u.telefone || '').replace(/\D/g, '')
    if (!phone) return showToast('Usuário sem telefone', 'error')
    const nome = u.nome || u.pushName || 'Cliente'
    const template = USER_MSG_TEMPLATES.find(t => t.key === templateKey)
    if (!template) return
    if (templateKey === 'personalizado') {
      const msg = prompt('Digite a mensagem:')
      if (msg) window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`, '_blank')
      return
    }
    const msg = template.msg(nome)
    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`, '_blank')
    setUserMsgMenu(null)
  }

  const firstProdsSync = useRef(true)
  const ordersSigRef = useRef(null)
  useEffect(() => {
    if (isInitialSyncing) return
    if (orders.length === 0) return
    const sig = {}
    orders.forEach(o => { if (o && o.id != null) sig[o.id] = JSON.stringify(o) })
    const prev = ordersSigRef.current
    let dirty = orders
    if (prev) dirty = orders.filter(o => prev[o.id] !== sig[o.id])
    ordersSigRef.current = sig
    if (dirty.length === 0) return
    const t = setTimeout(() => { upsertOrders(dirty) }, 350)
    return () => clearTimeout(t)
  }, [orders, isInitialSyncing])
  useEffect(() => {
    flushPendingOrders()
  }, [])
  // Removido sync local antigo de prodChanges e newProducts
  useEffect(() => { LS.set(STORAGE_CUSTOM_ROTAS, customRotas) }, [customRotas])
  useEffect(() => { LS.set(STORAGE_CUSTOM_CATS, customCategorias) }, [customCategorias])
  useEffect(() => { LS.set(STORAGE_CUSTOM_TIPOS, customDespesaTipos) }, [customDespesaTipos])
  useEffect(() => {
    if (orders.length === 0 && isInitialSyncing) return
    const compact = orders.map(o => {
      if (!o.identityPhoto && !o.addressProof) return o
      return {
        ...o,
        identityPhoto: '',
        addressProof: ''
      }
    })
    LS.set(STORAGE_ORDERS, compact)
  }, [orders, isInitialSyncing])

  useEffect(() => {
    LS.set(STORAGE_FINANCIAL, financial)
  }, [financial])
  useEffect(() => {
    LS.set(STORAGE_DESPESAS, despesas)
    if (isInitialSyncing) return
    if (despesas.length > 0) upsertDespesas(despesas)
  }, [despesas, isInitialSyncing])

  const fetchRotas = useCallback(async () => {
    setRotasLoading(true)
    setRotasError(null)
    try {
      let allContacts = []
      let offset = 0
      const PAGE_SIZE = 1000
      const MAX_PAGES = 10
      const seen = new Set()

      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetch(LISTA_CONTATOS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset, limit: PAGE_SIZE })
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const arr = Array.isArray(data) ? data : (data.code === 0 ? [] : [data])
        if (arr.length === 0) break

        const newContacts = arr.filter(c => {
          const key = c.remoteJid || c.pushName || Math.random()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })

        if (newContacts.length === 0) break

        allContacts = allContacts.concat(newContacts)
        offset += arr.length

        if (arr.length < PAGE_SIZE) break
      }

      setRotas(allContacts)
    } catch (e) {
      setRotasError(e.message)
    } finally {
      setRotasLoading(false)
    }
  }, [])

  const rotaEditForAdd = (rota, jid) => rotaEdits.find(e =>
    e.acao === 'adicionar' && e.rota === rota && (
      (jid && e.contato?.remoteJid === jid) ||
      (e.contato?.telefone && normalizePhone(e.contato.telefone) === normalizePhone(String(jid || '').replace(/@.*/, '')))
    )
  )

  const addRotaEdit = (rota, acao, contato) => {
    setRotaEdits(prev => [...prev, { id: Date.now() + Math.floor(Math.random() * 1000), rota, acao, contato, created_at: new Date().toISOString() }])
  }

  const removeRotaEdit = (id) => {
    setRotaEdits(prev => prev.filter(e => e.id !== id))
    supabaseDeleteRotaEdit(id)
  }

  const confirmRotaContact = ({ rota, mode, oldContact, novoNome, novoTelefone, novoCidade, custom }) => {
    const nums = novoTelefone.replace(/\D/g, '')
    const normalized = nums.startsWith('55') ? nums : '55' + nums
    const jid = oldContact?.remoteJid || `${normalized}@s.whatsapp.net`
    if (custom) {
      setCustomRotas(prev => prev.map(cr => {
        if (cr.rota !== rota) return cr
        if (mode === 'add') {
          return { ...cr, cidades: [{ ...(cr.cidades[0] || { cidade: 'Personalizado', contatos: [] }), cidade: novoCidade || 'Personalizado', contatos: [...(cr.cidades[0]?.contatos || []), { remoteJid: `${normalized}@s.whatsapp.net`, pushName: novoNome, nome: novoNome, cidade: novoCidade || 'Personalizado' }] }, ...cr.cidades.slice(1)] }
        }
        return {
          ...cr,
          cidades: cr.cidades.map(cid => ({
            ...cid,
            contatos: cid.contatos.map(x => x.remoteJid === jid ? {
              ...x,
              pushName: novoNome || x.pushName,
              nome: novoNome || x.nome,
              remoteJid: `${normalized}@s.whatsapp.net`,
              telefone: normalized,
              cidade: novoCidade || x.cidade
            } : x)
          }))
        }
      }))
    } else if (mode === 'edit') {
      const existingAdd = rotaEditForAdd(rota, jid)
      if (existingAdd) {
        setRotaEdits(prev => prev.map(e => e.id === existingAdd.id
          ? { ...e, contato: { ...e.contato, nome: novoNome, telefone: normalized, pushName: novoNome, remoteJid: `${normalized}@s.whatsapp.net`, cidade: novoCidade } }
          : e))
      } else {
        const oldTel = normalizePhone((oldContact?.remoteJid || oldContact?.telefone || '').replace(/@.*/, ''))
        addRotaEdit(rota, 'remover', { nome: oldContact?.pushName || '', telefone: oldTel, remoteJid: oldContact?.remoteJid })
        addRotaEdit(rota, 'adicionar', { nome: novoNome, telefone: normalized, pushName: novoNome, remoteJid: `${normalized}@s.whatsapp.net`, cidade: novoCidade })
      }
    } else {
      addRotaEdit(rota, 'adicionar', { nome: novoNome, telefone: normalized, pushName: novoNome, remoteJid: `${normalized}@s.whatsapp.net`, cidade: novoCidade })
    }
    showToast(`${mode === 'edit' ? 'Contato atualizado' : 'Contato adicionado'} à rota "${rota}"`)
    setRotaContactModal(null)
  }

  const confirmRotaRemove = (rota, contato, custom) => {
    if (!confirm(`Remover ${contato.pushName || 'contato'} da rota "${rota}"?`)) return
    if (custom) {
      setCustomRotas(prev => prev.map(cr => cr.rota === rota ? { ...cr, cidades: cr.cidades.map(cid => ({ ...cid, contatos: cid.contatos.filter(x => x.remoteJid !== contato.remoteJid) })).filter(cid => cid.contatos.length > 0) } : cr).filter(cr => cr.cidades.length > 0))
    } else {
      const tel = normalizePhone((contato.remoteJid || contato.telefone || '').replace(/@.*/, ''))
      const existingAdd = rotaEditForAdd(rota, contato.remoteJid)
      if (existingAdd) removeRotaEdit(existingAdd.id)
      else addRotaEdit(rota, 'remover', { nome: contato.pushName || '', telefone: tel, remoteJid: contato.remoteJid })
    }
    showToast('Contato removido da rota')
  }

  const confirmRotaEdit = (rota, contato, custom) => {
    if (custom) {
      setEditCustomContact({ contato, rotaName: rota })
      setEditContactName(contato.pushName || contato.nome || '')
      setEditContactPhone((contato.remoteJid || '').replace(/@.*/, '').replace(/\D/g, ''))
      setEditContactCity(contato.cidade || '')
    } else {
      setRotaContactModal({
        rota,
        mode: 'edit',
        contato,
        custom: false,
        nomeState: contato.pushName || contato.nome || '',
        phoneState: (contato.remoteJid || '').replace(/@.*/, '').replace(/\D/g, ''),
        cityState: contato.cidade || ''
      })
    }
  }

  useEffect(() => {
    if (rotaEdits.length > 0) upsertRotaEdits(rotaEdits)
  }, [rotaEdits])
  useEffect(() => { LS.set('thsm_rota_edits', rotaEdits) }, [rotaEdits])

  useEffect(() => {
    let isSyncing = false
    const doSync = () => {
      if (isSyncing) return
      isSyncing = true
      syncAllForAdmin().then(({ orders: o, financial: f, users: u, rotas: r, products: p, despesas: d, rotaEdits: re, deletedOrderIds: serverDel }) => {
        if (serverDel && serverDel.length) {
          setDeletedOrderIds(prev => {
            const next = Array.from(new Set([...prev.map(String), ...serverDel.map(String)]))
            return next
          })
          try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_DELETED_ORDERS) || '[]')
            const next = Array.from(new Set([...saved.map(String), ...serverDel.map(String)]))
            localStorage.setItem(STORAGE_DELETED_ORDERS, JSON.stringify(next))
          } catch {}
        }
        if (re.length) setRotaEdits(prev => {
          const map = new Map()
          re.forEach(edit => map.set(edit.id, edit))
          prev.forEach(edit => map.set(edit.id, edit))
          const merged = Array.from(map.values())
          LS.set('thsm_rota_edits', merged)
          return merged
        })
        if (o.length) {
          setOrders(prev => {
            const del = new Set([
              ...(deletedOrderIdsRef.current ? Array.from(deletedOrderIdsRef.current).map(String) : []),
              ...(serverDel ? serverDel.map(String) : [])
            ])
            const map = new Map()
            // 1. Put all incoming remote orders in map (excluding deleted ones)
            o.forEach(ord => {
              if (ord && ord.id != null && !del.has(String(ord.id))) {
                map.set(String(ord.id), ord)
              }
            })

            // 2. Reconcile with local orders
            prev.forEach(localOrd => {
              if (!localOrd || localOrd.id == null) return
              const localIdStr = String(localOrd.id)
              // If deleted, never restore!
              if (del.has(localIdStr)) return

              const remoteOrd = map.get(localIdStr)
              if (!remoteOrd) {
                // If it is a pending unsynced local order, keep it; otherwise discard
                let isPending = false
                try {
                  const pending = JSON.parse(localStorage.getItem('thsm_pending_orders') || '[]')
                  isPending = pending.some(p => String(p.id) === localIdStr)
                } catch {}
                if (localOrd.isLocal || localOrd._pendingSync || isPending) {
                  map.set(localIdStr, localOrd)
                }
                return
              }

              const localTime = Number(localOrd.lastModified || localOrd.updatedAt || localOrd.preApprovedAt || localOrd.createdAt || 0)
              const remoteTime = Number(remoteOrd.lastModified || remoteOrd.updatedAt || remoteOrd.preApprovedAt || remoteOrd.createdAt || 0)

              // If local edits are newer or equal, keep local modifications and persist
              if (localTime >= remoteTime) {
                const preserved = {
                  ...remoteOrd,
                  ...localOrd,
                  items: (Array.isArray(localOrd.items) && localOrd.items.length > 0) ? localOrd.items : remoteOrd.items,
                  itens: (Array.isArray(localOrd.items) && localOrd.items.length > 0) ? localOrd.items : (localOrd.itens || remoteOrd.itens),
                  originalItems: (Array.isArray(localOrd.originalItems) && localOrd.originalItems.length > 0)
                    ? localOrd.originalItems
                    : ((Array.isArray(localOrd.items) && localOrd.items.length > 0) ? localOrd.items : remoteOrd.originalItems),
                  total: localOrd.total !== undefined ? localOrd.total : remoteOrd.total
                }
                map.set(localIdStr, preserved)
                if (localTime > remoteTime) {
                  upsertOrder(preserved)
                }
              }
            })

            const merged = Array.from(map.values()).filter(ord => !del.has(String(ord.id)))
            LS.set(STORAGE_ORDERS, merged)
            return merged
          })
        }
        if (f.length) {
          setFinancial(prev => {
            const map = new Map()
            prev.forEach(fin => map.set(fin.id, fin))
            f.forEach(fin => map.set(fin.id, fin))
            const merged = Array.from(map.values())
            LS.set(STORAGE_FINANCIAL, merged)
            return merged
          })
        }
        if (d.length) {
          setDespesas(prev => {
            const map = new Map()
            prev.forEach(des => map.set(des.id, des))
            d.forEach(des => map.set(des.id, des))
            const merged = Array.from(map.values())
            LS.set(STORAGE_DESPESAS, merged)
            return merged
          })
        }
        if (u.length) { LS.set('thsm_usuarios', u); setUsuarios(u) }
        if (r.length) { setRotas(r) } else { fetchRotas() }
        if (p && p.length) {
          if (typeof refreshProducts === 'function') refreshProducts()
        }
      }).catch(e => { console.error('syncAllForAdmin error:', e) })
        .finally(() => {
          isSyncing = false
          setSyncingUsers(false)
          setIsInitialSyncing(false)
        })
    }

    setSyncingUsers(true)
    doSync()
    const pollInterval = setInterval(doSync, 60000)

    getAllLeads().then(setLeads).catch(() => { })
      // Reenvia leads salvos localmente (fallback quando site ficou offline)
      ; (async () => {
        try {
          const pendentes = JSON.parse(localStorage.getItem('thsm_pending_leads') || '[]')
          if (!pendentes.length) return
          const enviados = []
          for (const lead of pendentes) {
            const { error } = await supabase.from('leads').insert(lead)
            if (!error || error.code === '23505') enviados.push(lead)
          }
          if (enviados.length) localStorage.setItem('thsm_pending_leads', JSON.stringify(pendentes.filter(p => !enviados.includes(p))))
        } catch { }
      })()

    return () => clearInterval(pollInterval)
  }, [])

  // Auto-expand first rota when rotas load
  useEffect(() => {
    if (rotas.length > 0 && !expandedRota) setExpandedRota(rotas[0].rota)
  }, [rotas, expandedRota])

  const [adminLocalProds, setAdminLocalProds] = useState(null)
  useEffect(() => { setAdminLocalProds(produtos || []) }, [produtos])

  const produtosAtuais = useMemo(() => {
    return adminLocalProds || produtos || []
  }, [adminLocalProds, produtos])

  // Map of known product prices from orders history and current products
  const productPriceMap = useMemo(() => {
    const map = new Map()
    if (orders && Array.isArray(orders)) {
      for (const o of orders) {
        const items = o.items || o.data?.items || []
        for (const i of items) {
          const p = Number(i.preco)
          if (p > 0) {
            if (i.id != null && !map.has(String(i.id))) map.set(String(i.id), p)
            const n = String(i.nome || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            if (n && !map.has(n)) map.set(n, p)
          }
        }
      }
    }
    for (const p of (produtosAtuais || [])) {
      const val = Number(p.preco)
      if (val > 0) {
        map.set(String(p.id), val)
        const n = String(p.nome || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        if (n) map.set(n, val)
      }
    }
    return map
  }, [orders, produtosAtuais])

  // =============================================
  // ORDERS
  // =============================================
  const [savingOrder, setSavingOrder] = useState(false)
  const addOrder = async (data) => {
    if (savingOrder) return
    setSavingOrder(true)
    try {
      const items = (data.items || []).map(i => {
        const cost = (i.preco_custo != null && i.preco_custo !== '')
          ? Number(String(i.preco_custo).replace(',', '.'))
          : getItemCost(i, produtosAtuais)
        return {
          ...i,
          preco: Number(String(i.preco).replace(',', '.')) || 0,
          preco_custo: cost > 0 ? cost : null,
          qty: Number(i.qty) || 1
        }
      })

      // Batch update cost in background ONLY for items where cost was explicitly modified by user
      const changedCosts = {}
      items.forEach(i => {
        if (i.id != null && i.preco_custo != null && !isNaN(i.preco_custo) && i.preco_custo >= 0) {
          const orig = produtosAtuais.find(p => p.id === i.id || String(p.id) === String(i.id))
          if (orig && Number(orig.preco_custo) !== Number(i.preco_custo)) {
            changedCosts[i.id] = { ...orig, preco_custo: i.preco_custo }
          }
        }
      })
      if (Object.keys(changedCosts).length > 0) {
        upsertProducts(changedCosts).catch(e => console.warn('Erro batch update preco_custo:', e))
      }

      const totalAvista = items.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
      const totalAprazo = items.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
      const orderId = Date.now()

      const existingUser = (usuarios || []).find(u => u && (u.telefone === data.telefone || samePhone(u.telefone, data.telefone)))

      let order = {
        id: orderId,
        user_id: existingUser?.id || null,
        date: data.dataPedido || hoje(),
        customer: {
          nome: data.nome,
          telefone: data.telefone,
          cpf: data.cpf || existingUser?.cpf || existingUser?.endereco?.cpf || '',
          endereco: data.endereco || { cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' }
        },
        items,
        pagamento: data.pagamento,
        totalAvista,
        totalAprazo,
        total: totalAvista + totalAprazo,
        status: data.status || 'pendente',
        createdAt: Date.now(),
        dataVencimento: data.dataVencimento || null,
        deliveredAt: data.status === 'entregue' ? Date.now() : null,
        deliveryDataInicio: data.status === 'entregue' ? (data.dataPedido || hoje()) : null,
        payment: data.payment || null
      }

      // Optimistic update: Save to UI state and close modal immediately!
      setOrders(prev => {
        const next = [order, ...prev]
        LS.set(STORAGE_ORDERS, next)
        return next
      })
      setShowAddOrder(false)
      showToast('Pedido adicionado com sucesso!')

      // Financial records for "a prazo" items
      const finRecords = items.filter(i => i.tipo === 'aprazo').map(i => {
        const dueDate = data.dataVencimento || hoje()
        const concluido = order.status === 'entregue'
        return {
          id: order.id + '-' + i.id,
          orderId: order.id,
          customerName: data.nome,
          itemName: i.nome,
          qty: i.qty,
          value: i.preco * i.qty,
          precoCusto: (i.preco_custo || getItemCost(i, produtosAtuais)) * i.qty,
          dueDate,
          paidDate: concluido ? hoje() : null,
          status: concluido ? 'pago' : 'pendente'
        }
      })
      if (finRecords.length > 0) {
        setFinancial(prev => {
          const next = [...finRecords, ...prev]
          LS.set(STORAGE_FINANCIAL, next)
          return next
        })
      }

      // Background persistence (User, Order, Financial, Webhook)
      (async () => {
        try {
          const mergedEndereco = {
            ...(existingUser?.endereco || {}),
            ...(data.endereco || {}),
            cpf: data.cpf || existingUser?.endereco?.cpf || '',
            origem: existingUser?.endereco?.origem || 'Admin'
          }
          const savedUser = await upsertUser({
            id: existingUser?.id,
            telefone: data.telefone,
            nome: data.nome,
            email: data.email || '',
            endereco: mergedEndereco,
            cpf: data.cpf || existingUser?.cpf || ''
          })

          if (savedUser?.id && savedUser.id !== order.user_id) {
            order = { ...order, user_id: savedUser.id }
            setOrders(prev => {
              const next = prev.map(o => o.id === orderId ? order : o)
              LS.set(STORAGE_ORDERS, next)
              return next
            })
            setUsuarios(prev => {
              const idx = prev.findIndex(u => samePhone(u.telefone, savedUser.telefone))
              if (idx >= 0) {
                const updated = [...prev]
                updated[idx] = savedUser
                return updated
              }
              return [savedUser, ...prev]
            })
          }

          await Promise.all([
            upsertOrder(order),
            finRecords.length > 0 ? upsertFinancial(finRecords) : Promise.resolve()
          ])

          sendStatusWebhook(order, order.status)
        } catch (bgErr) {
          console.error('Erro na persistência em segundo plano do pedido:', bgErr)
        }
      })()

    } catch (err) {
      console.error('Erro addOrder:', err)
      showToast('Erro ao salvar pedido: ' + (err.message || 'Tente novamente'), 'error')
    } finally {
      setSavingOrder(false)
    }
  }

  const updateOrderStatus = (id, status, skipWebhook = false, customDue = null, overrideOrder = null) => {
    const order = overrideOrder || orders.find(o => String(o.id) === String(id))
    if (!order) return

    const now = Date.now()
    const finalDue = customDue !== null ? (customDue || null) : (order.dataVencimento || null)
    const activeItems = (Array.isArray(order.items) && order.items.length > 0)
      ? order.items
      : ((Array.isArray(order.originalItems) && order.originalItems.length > 0) ? order.originalItems : (order.itens || []))

    let updated = {
      ...order,
      items: activeItems,
      itens: activeItems,
      originalItems: (Array.isArray(order.originalItems) && order.originalItems.length > 0) ? order.originalItems : activeItems,
      status,
      isFinalizado: status === 'concluido' ? true : (status === 'entregue' || status === 'acerto' ? false : order.isFinalizado),
      dataVencimento: finalDue,
      deliveredAt: status === 'entregue' ? (order.deliveredAt || now) : order.deliveredAt,
      lastModified: now,
      updatedAt: now
    }

    if (status !== 'entregue' && status !== 'acerto' && status !== 'concluido') {
      updated = {
        ...updated,
        desconto: 0,
        totalPago: 0,
        returnedItems: [],
        totalReembolso: 0,
        paymentMethod: '',
        paymentSplits: null,
        payment: null
      }

      deleteOnlyFinancialByOrder(id).then(() => {
        setFinancial(prev => {
          const otherRecords = prev.filter(f => String(f.orderId) !== String(id))
          const orderAprazoItems = activeItems.filter(i => i.tipo === 'aprazo')
          const restoredFinancial = orderAprazoItems.map(i => ({
            id: id + '-' + i.id,
            orderId: id,
            customerName: order.customer?.nome || '',
            itemName: i.nome,
            qty: i.qty,
            value: i.preco * i.qty,
            precoCusto: (i.preco_custo || getItemCost(i, produtosAtuais)) * i.qty,
            dueDate: finalDue || hoje(),
            paidDate: null,
            status: 'pendente',
            paymentMethod: ''
          }))
          upsertFinancial(restoredFinancial)
          return [...otherRecords, ...restoredFinancial]
        })
      })
    }

    setOrders(prev => {
      const next = prev.map(o => String(o.id) === String(id) ? updated : o)
      LS.set(STORAGE_ORDERS, next)
      return next
    })
    upsertOrder(updated)
    showToast(`Pedido #${id} atualizado para "${status}"`)
    const STATUS_ORDER = ['pre-pedido', 'pendente', 'confirmado', 'em-andamento', 'em-rota', 'entregue', 'acerto', 'concluido']
    const prevIndex = STATUS_ORDER.indexOf(order?.status)
    const nextIndex = STATUS_ORDER.indexOf(status)
    const isAdvance = prevIndex !== -1 && nextIndex > prevIndex
    const isNewOrder = prevIndex === -1 && STATUS_ORDER.includes(status)
    const isPreToPendente = order?.status === 'pre-pedido' && status === 'pendente'
    if (updated && !skipWebhook && !isPreToPendente && (isAdvance || isNewOrder)) sendStatusWebhook(updated, status)
  }

  const updateOrderDue = (id, due) => {
    setOrders(prev => {
      const next = prev.map(o => String(o.id) === String(id) ? { ...o, dataVencimento: due || null, lastModified: Date.now() } : o)
      LS.set(STORAGE_ORDERS, next)
      return next
    })
    setFinancial(prev => prev
      .filter(f => String(f.orderId) === String(id) && f.status !== 'pago' && f.status !== 'cancelado')
      .map(f => ({ ...f, dueDate: due || f.dueDate })))
    showToast('Data de vencimento atualizada!')
  }

  const updateOrderRota = async (id, rota) => {
    const order = orders.find(o => String(o.id) === String(id))
    if (!order) return
    const updatedCustomer = {
      ...(order.customer || {}),
      endereco: {
        ...(order.customer?.endereco || {}),
        rota: rota || ''
      }
    }
    const updated = {
      ...order,
      customer: updatedCustomer,
      lastModified: Date.now(),
      updatedAt: Date.now()
    }
    setOrders(prev => {
      const next = prev.map(o => String(o.id) === String(id) ? updated : o)
      LS.set(STORAGE_ORDERS, next)
      return next
    })
    await upsertOrder(updated)

    // Sincroniza também a rota no cadastro do usuário
    const userPhone = normalizePhone(order.customer?.telefone)
    const existingUser = usuarios.find(u => (order.user_id && u.id === order.user_id) || (userPhone && normalizePhone(u.telefone) === userPhone))
    if (existingUser) {
      const updatedUser = {
        ...existingUser,
        endereco: {
          ...(existingUser.endereco || {}),
          rota: rota || ''
        }
      }
      setUsuarios(prev => prev.map(u => u.id === existingUser.id ? updatedUser : u))
      upsertUser(updatedUser).catch(() => {})
    }

    showToast(rota ? `Rota do pedido #${id} definida para "${rota}"` : `Rota do pedido #${id} removida`)
  }

  const preApprovarPedido = (orderId, rejectedItemIds, replacements = [], dataVencimento = null) => {
    const order = orders.find(o => String(o.id) === String(orderId))
    if (!order) return

    const rejected = new Set(rejectedItemIds)
    let remainingItems = order.items.filter((_, idx) => !rejected.has(idx))
    if (replacements.length > 0) {
      remainingItems = [...remainingItems, ...replacements]
    }
    if (remainingItems.length === 0) { showToast('Não é possível aprovar um pedido sem itens', 'error'); return }

    const resolvedRemaining = remainingItems.map(i => {
      const cost = (i.preco_custo != null && i.preco_custo !== '')
        ? Number(String(i.preco_custo).replace(',', '.'))
        : getItemCost(i, produtosAtuais)
      return {
        ...i,
        preco: Number(String(i.preco).replace(',', '.')) || 0,
        preco_custo: cost > 0 ? cost : null
      }
    })

    const totalAvista = Math.round(resolvedRemaining.filter(i => i.tipo === 'avista').reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0) * 100) / 100
    const totalAprazo = Math.round(resolvedRemaining.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0) * 100) / 100
    const now = Date.now()
    const updatedOrder = {
      ...order,
      items: resolvedRemaining,
      totalAvista,
      totalAprazo,
      total: Math.round((totalAvista + totalAprazo) * 100) / 100,
      status: 'pendente',
      preApprovedAt: now,
      lastModified: now,
      updatedAt: now,
      dataVencimento: dataVencimento || order.dataVencimento || null,
      rejectedItems: rejectedItemIds.length > 0 ? rejectedItemIds.map(idx => order.items[idx]) : []
    }
    setOrders(prev => {
      const next = prev.map(o => String(o.id) === String(orderId) ? updatedOrder : o)
      LS.set(STORAGE_ORDERS, next)
      return next
    })
    upsertOrder(updatedOrder)
    // Create financial records for approved a-prazo items
    const finRecords = resolvedRemaining.filter(i => i.tipo === 'aprazo').map(i => {
      const dueDate = dataVencimento || (() => {
        const d = new Date((order.date || hoje()) + 'T12:00:00')
        d.setDate(d.getDate() + 60)
        return d.toISOString().split('T')[0]
      })()
      const itemVal = Math.round((Number(i.preco) || 0) * (Number(i.qty) || 0) * 100) / 100
      const costVal = Math.round((Number(i.preco_custo || getItemCost(i, produtosAtuais)) || 0) * (Number(i.qty) || 0) * 100) / 100
      return {
        id: orderId + '-' + i.id,
        orderId,
        customerName: order.customer?.nome || '',
        itemName: i.nome,
        qty: i.qty,
        value: itemVal,
        precoCusto: costVal,
        dueDate,
        paidDate: null,
        status: 'pendente'
      }
    })
    if (finRecords.length > 0) {
      setFinancial(prev => {
        const next = [...finRecords, ...prev]
        LS.set(STORAGE_FINANCIAL, next)
        return next
      })
      upsertFinancial(finRecords)
    }
    showToast(`Pedido #${orderId} revisado e enviado para "Pendente"`)
    setShowOrderDetail(null)
  }

  const updateOrderCustomer = async (id, customerData) => {
    const order = orders.find(o => String(o.id) === String(id))
    if (!order) return

    const rawPhone = (customerData.telefone || order.customer?.telefone || '').replace(/\D/g, '')
    const normPhone = rawPhone ? (rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone) : ''

    const cleanCpf = customerData.cpf || customerData.endereco?.cpf || order.customer?.cpf || order.customer?.endereco?.cpf || ''
    const cleanEndereco = {
      ...(customerData.endereco || {}),
      cpf: cleanCpf
    }

    const updatedCustomer = {
      ...order.customer,
      id: customerData.id || order.user_id || order.customer?.id || null,
      nome: customerData.nome !== undefined ? customerData.nome : (order.customer?.nome || ''),
      email: customerData.email !== undefined ? customerData.email : (order.customer?.email || ''),
      telefone: normPhone || order.customer?.telefone || '',
      cpf: cleanCpf,
      endereco: cleanEndereco
    }

    const now = Date.now()
    const updatedOrder = {
      ...order,
      customer: updatedCustomer,
      user_id: customerData.id || order.user_id || null,
      lastModified: now,
      updatedAt: now
    }

    // 1. Instantly update React state & localStorage
    setOrders(prev => {
      const next = prev.map(o => String(o.id) === String(id) ? updatedOrder : o)
      LS.set(STORAGE_ORDERS, next)
      return next
    })
    setShowOrderDetail(prev => (prev && String(prev.id) === String(id)) ? { ...prev, customer: updatedCustomer, user_id: updatedOrder.user_id } : prev)

    // 2. Persist order immediately to PostgreSQL
    await upsertOrder(updatedOrder)

    // 3. Post to Webhook att-user (n8n) and save user
    if (normPhone) {
      try {
        const userPayload = {
          id: customerData.id || order.user_id || null,
          nome: updatedCustomer.nome,
          email: updatedCustomer.email,
          telefone: normPhone,
          cpf: cleanCpf,
          endereco: cleanEndereco
        }
        const savedUser = await saveUserViaWebhook(userPayload)
        if (savedUser?.id && savedUser.id !== updatedOrder.user_id) {
          const finalOrder = { ...updatedOrder, user_id: savedUser.id }
          setOrders(prev => {
            const next = prev.map(o => String(o.id) === String(id) ? finalOrder : o)
            LS.set(STORAGE_ORDERS, next)
            return next
          })
          await upsertOrder(finalOrder)
        }
        if (savedUser) {
          setUsuarios(prev => {
            const idx = prev.findIndex(u => samePhone(u.telefone, normPhone) || (savedUser.id && u.id === savedUser.id))
            if (idx >= 0) {
              const updated = [...prev]
              updated[idx] = { ...updated[idx], ...savedUser }
              LS.set('thsm_usuarios', updated)
              return updated
            }
            const updated = [savedUser, ...prev]
            LS.set('thsm_usuarios', updated)
            return updated
          })
        }
      } catch (webhookErr) {
        console.error('[updateOrderCustomer] Erro ao enviar webhook att-user:', webhookErr)
      }
    }

    showToast('Dados do cliente atualizados e salvos com sucesso!')
  }

  const cancelOrder = (id) => {
    const order = orders.find(o => o.id === id)
    if (!order) return
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status: 'cancelado' } : o))
    setFinancial(prev => prev.map(f => f.orderId === id ? { ...f, status: 'cancelado' } : f))
    setShowOrderDetail(null)
    showToast(`Pedido #${id} cancelado!`)
    sendStatusWebhook(order, 'cancelado')
  }

  const cloneOrder = async (original) => {
    try {
      const origItems = (Array.isArray(original?.items) && original.items.length > 0)
        ? original.items
        : ((Array.isArray(original?.originalItems) && original.originalItems.length > 0) ? original.originalItems : (original?.itens || []))
      const clonedItems = origItems.map(i => ({ ...i }))
      const newId = Date.now()
      const newOrder = {
        ...original,
        id: newId,
        date: hoje(),
        createdAt: Date.now(),
        items: clonedItems,
        itens: clonedItems,
        originalItems: clonedItems.map(i => ({ ...i })),
        status: 'pendente',
        preApprovedAt: null,
        pre_approved_at: null,
        lastModified: Date.now(),
        updatedAt: Date.now()
      }
      setOrders(prev => {
        const next = [newOrder, ...prev]
        LS.set(STORAGE_ORDERS, next)
        return next
      })
      const finRecords = clonedItems.filter(i => i.tipo === 'aprazo').map(i => {
        const origFin = financial.find(f => f.id === original.id + '-' + i.id)
        const dueDate = origFin?.dueDate || (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0] })()
        return {
          id: newId + '-' + i.id,
          orderId: newId,
          customerName: original.customer?.nome || '',
          itemName: i.nome,
          qty: i.qty,
          value: (Number(i.preco) || 0) * (Number(i.qty) || 0),
          precoCusto: ((i.preco_custo != null && i.preco_custo !== '') ? Number(i.preco_custo) : getItemCost(i, produtosAtuais)) * (Number(i.qty) || 0),
          dueDate,
          paidDate: null,
          status: 'pendente'
        }
      })
      if (finRecords.length > 0) {
        setFinancial(prev => {
          const next = [...finRecords, ...prev]
          LS.set(STORAGE_FINANCIAL, next)
          return next
        })
        upsertFinancial(finRecords)
      }
      await upsertOrder(newOrder)
      showToast(`Pedido #${String(original.id).slice(-6)} clonado como #${String(newId).slice(-6)} com sucesso!`)
    } catch (err) {
      console.error('Erro ao clonar pedido:', err)
      showToast('Erro ao clonar pedido', 'error')
    }
  }

  const handleDeliveryFile = (e, type) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const compressed = await compressImageDataUrl(ev.target.result)
      if (type === 'identity') setIdentityPreview(compressed)
      else setAddressPreview(compressed)
    }
    reader.readAsDataURL(file)
  }

  const openAcertoModal = (orderParam, mode = 'acerto') => {
    const freshOrder = orders.find(ord => String(ord.id) === String(orderParam?.id)) || orderParam
    const o = { ...freshOrder, ...orderParam }
    const baseItems = getOrderBaseItems(o, produtosAtuais)
    const retMap = {}
    const priceMap = {}
    const costMap = {}
    baseItems.forEach((i, idx) => {
      const key = i.id != null ? String(i.id) : (i.nome ? String(i.nome) : String(idx))
      priceMap[key] = String(i.preco != null ? i.preco : '')
      const c = (i.preco_custo != null && i.preco_custo !== '') ? i.preco_custo : getItemCost(i, produtosAtuais)
      costMap[key] = c > 0 ? String(c) : ''
    })
    if (o.returnedItems && o.returnedItems.length > 0) {
      o.returnedItems.forEach(r => {
        const key = r.id != null ? String(r.id) : (r.nome ? String(r.nome) : '')
        if (key) {
          retMap[key] = r.returnedQty || r.qty || 0
        }
      })
    }
    setReturnQuantities(retMap)
    setDeliveryItemPrices(priceMap)
    setDeliveryItemCosts(costMap)
    setPayQuantities({})
    setIdentityPreview(o.identityPhoto || '')
    setAddressPreview(o.addressProof || '')

    const pm = o.paymentMethod || 'pix'
    setDeliveryPayment(pm)
    setDeliverySplits(o.paymentSplits || { pix: '', dinheiro: '', cartao: '' })

    if (o.descontoPercent != null) {
      setDeliveryDiscountType('percent')
      setDeliveryDiscount(String(o.descontoPercent))
    } else if (o.desconto > 0) {
      setDeliveryDiscountType('reais')
      setDeliveryDiscount(String(o.desconto))
    } else {
      setDeliveryDiscountType('percent')
      setDeliveryDiscount('30')
    }

    if (o.totalPago != null && o.totalPago !== '' && Number(o.totalPago) > 0) {
      setDeliveryPaid(String(o.totalPago))
    } else {
      setDeliveryPaid('')
    }

    setDeliveryDataInicio(o.dataInicio || o.date || hoje())
    setDeliveryDataVenc(o.dataVencimento || '')
    setDeliveryModalMode(mode)
    setShowDeliveryModal({ ...o, baseItems })
  }

  const salvarAcerto = async (orderId, finalize = false) => {
    const order = orders.find(o => String(o.id) === String(orderId)) || showDeliveryModal
    if (!order) return

    const baseItems = (Array.isArray(showDeliveryModal?.baseItems) && showDeliveryModal.baseItems.length > 0)
      ? showDeliveryModal.baseItems
      : getOrderBaseItems(order, produtosAtuais)
    const returnedItems = []
    const remainingItems = []

    baseItems.forEach((i, idx) => {
      const key = i.id != null ? String(i.id) : (i.nome ? String(i.nome) : String(idx))
      const pRaw = deliveryItemPrices[key] !== undefined ? String(deliveryItemPrices[key]).replace(',', '.') : String(i.preco || 0)
      const unitPreco = Math.round((Number(pRaw) || 0) * 100) / 100
      const cRaw = deliveryItemCosts[key] !== undefined ? String(deliveryItemCosts[key]).replace(',', '.') : ''
      const unitCusto = cRaw !== '' ? (Math.round((Number(cRaw) || 0) * 100) / 100) : getItemCost(i, produtosAtuais)

      if (cRaw !== '') {
        const prod = produtosAtuais.find(p => p && (String(p.id) === String(i.id)))
        if (prod && Number(prod.preco_custo) !== unitCusto) {
          updateProduct(prod.id, { preco_custo: unitCusto })
        }
      }

      const maxQty = Number(i.qty) || 0
      const retQty = Math.max(0, Math.min(maxQty, Number(returnQuantities[key] ?? (i.nome ? returnQuantities[i.nome] : 0)) || 0))
      if (retQty > 0) {
        returnedItems.push({ ...i, preco: unitPreco, preco_custo: unitCusto > 0 ? unitCusto : null, returnedQty: retQty })
      }
      const keptQty = maxQty - retQty
      if (keptQty > 0) {
        remainingItems.push({ ...i, preco: unitPreco, preco_custo: unitCusto > 0 ? unitCusto : null, qty: keptQty })
      }
    })

    const totalAvista = Math.round(remainingItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0) * 100) / 100
    const totalAprazo = Math.round(remainingItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0) * 100) / 100
    const totalBase = Math.round((totalAvista + totalAprazo) * 100) / 100

    const discountNum = Number(String(deliveryDiscount).replace(',', '.')) || 0
    const desconto = Math.round((deliveryDiscountType === 'percent'
      ? (Math.min(100, Math.max(0, discountNum)) / 100) * totalBase
      : Math.max(0, Math.min(discountNum, totalBase))) * 100) / 100

    const totalCobrar = Math.round((totalBase - desconto) * 100) / 100

    const isSplit = deliveryPayment.includes('+')
    let totalPagoCalc = 0
    if (isSplit) {
      totalPagoCalc = deliveryPayment.split('+').reduce((sum, m) => {
        return sum + (Number(String(deliverySplits[m] || 0).replace(',', '.')) || 0)
      }, 0)
    } else {
      totalPagoCalc = Number(String(deliveryPaid || 0).replace(',', '.')) || 0
    }
    const totalPago = Math.round(totalPagoCalc * 100) / 100
    const totalReembolso = Math.round(returnedItems.reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.returnedQty) || 0), 0) * 100) / 100

    const totalOriginal = Math.round(baseItems.reduce((s, i, idx) => {
      const key = i.id != null ? String(i.id) : (i.nome ? String(i.nome) : String(idx))
      const pRaw = deliveryItemPrices[key] !== undefined ? String(deliveryItemPrices[key]).replace(',', '.') : String(i.preco || 0)
      return s + (Number(pRaw) || 0) * (Number(i.qty) || 0)
    }, 0) * 100) / 100
    const valorEmAberto = Math.max(0, Math.round((totalCobrar - totalPago) * 100) / 100)

    const now = Date.now()
    const newStatus = finalize ? 'concluido' : 'acerto'

    const updatedOrder = {
      ...order,
      originalItems: baseItems.map((i, idx) => {
        const key = i.id != null ? String(i.id) : (i.nome ? String(i.nome) : String(idx))
        const pRaw = deliveryItemPrices[key] !== undefined ? String(deliveryItemPrices[key]).replace(',', '.') : String(i.preco || 0)
        const unitPreco = Math.round((Number(pRaw) || 0) * 100) / 100
        const cRaw = deliveryItemCosts[key] !== undefined ? String(deliveryItemCosts[key]).replace(',', '.') : ''
        const unitCusto = cRaw !== '' ? (Math.round((Number(cRaw) || 0) * 100) / 100) : getItemCost(i, produtosAtuais)
        return {
          ...i,
          preco: unitPreco,
          preco_custo: unitCusto > 0 ? unitCusto : null
        }
      }),
      items: remainingItems,
      itens: remainingItems,
      totalOriginal,
      totalNota: totalOriginal,
      totalAcerto: totalCobrar,
      totalAvista,
      totalAprazo,
      total: totalCobrar,
      desconto,
      descontoPercent: deliveryDiscountType === 'percent' ? discountNum : (order.descontoPercent || null),
      totalPago,
      valorEmAberto,
      status: newStatus,
      isFinalizado: finalize,
      returnedItems,
      totalReembolso,
      dataInicio: deliveryDataInicio || order.dataInicio || order.date || null,
      dataVencimento: deliveryDataVenc || order.dataVencimento || null,
      identityPhoto: identityPreview || order.identityPhoto || '',
      addressProof: addressPreview || order.addressProof || '',
      deliveredAt: order.deliveredAt || now,
      finalizadoAt: finalize ? now : (order.finalizadoAt || null),
      paymentMethod: deliveryPayment,
      paymentSplits: isSplit ? deliverySplits : (deliveryPayment ? { [deliveryPayment]: totalPago } : null),
      lastModified: now,
      updatedAt: now
    }

    setOrders(prev => {
      const next = prev.map(o => String(o.id) === String(orderId) ? updatedOrder : o)
      LS.set(STORAGE_ORDERS, next)
      return next
    })
    await upsertOrder(updatedOrder)

    // Sync financial records
    setFinancial(prev => {
      const otherRecords = prev.filter(f => String(f.orderId) !== String(orderId))
      const existingRecords = prev.filter(f => String(f.orderId) === String(orderId))
      const aprazoItems = remainingItems.filter(i => i.tipo === 'aprazo')
      const dueDate = deliveryDataVenc || order.dataVencimento || hoje()

      const newFinancial = aprazoItems.map(i => {
        const existing = existingRecords.find(f => String(f.id) === String(orderId + '-' + i.id))
        const itemVal = Math.round((Number(i.preco) || 0) * (Number(i.qty) || 0) * 100) / 100
        const unitCusto = getItemCost(i, produtosAtuais)
        return {
          id: orderId + '-' + i.id,
          orderId,
          customerName: order.customer?.nome || '',
          itemName: i.nome,
          qty: i.qty,
          value: itemVal,
          precoCusto: Math.round((unitCusto || 0) * (Number(i.qty) || 0) * 100) / 100,
          dueDate: existing?.dueDate || dueDate,
          paidDate: finalize ? hoje() : (existing?.paidDate || null),
          status: finalize ? 'pago' : (existing?.status || 'pendente'),
          paymentMethod: deliveryPayment
        }
      })

      const combined = [...otherRecords, ...newFinancial]
      LS.set(STORAGE_FINANCIAL, combined)
      if (newFinancial.length > 0) upsertFinancial(newFinancial)
      return combined
    })

    const webhookExtra = {
      returnedItems,
      remainingItems,
      items: remainingItems,
      originalItems: baseItems,
      totalOriginal,
      totalDevolvido: totalReembolso,
      desconto,
      descontoPercent: deliveryDiscountType === 'percent' ? discountNum : (order.descontoPercent || null),
      totalComanda: totalCobrar,
      totalAcerto: totalCobrar,
      paymentSplits: isSplit ? deliverySplits : (deliveryPayment ? { [deliveryPayment]: totalPago } : null),
      paymentMethod: deliveryPayment,
      totalPago,
      valorEmAberto,
      dataVencimento: deliveryDataVenc || order.dataVencimento || null
    }

    if (finalize) {
      showToast(`Pedido #${orderId} finalizado com sucesso! WhatsApp enviado ao cliente.`)
      sendStatusWebhook(updatedOrder, 'concluido', webhookExtra)
    } else {
      showToast(`Pedido #${orderId} atualizado na etapa de Acertos! WhatsApp enviado ao cliente.`)
      sendStatusWebhook(updatedOrder, 'acerto', webhookExtra)
    }

    setShowDeliveryModal(null)
    setReturnQuantities({})
    setDeliveryItemPrices({})
    setDeliveryItemCosts({})
    setPayQuantities({})
    setDeliveryDiscount('')
    setDeliveryPaid('')
    setDeliveryDataVenc('')
    setIdentityPreview('')
    setAddressPreview('')
  }

  const deleteOrder = (id) => {
    if (!confirm('Excluir este pedido?')) return
    const idStr = String(id)
    setOrders(prev => {
      const next = prev.filter(o => String(o.id) !== idStr)
      LS.set(STORAGE_ORDERS, next)
      return next
    })
    setFinancial(prev => {
      const next = prev.filter(f => String(f.orderId) !== idStr)
      LS.set(STORAGE_FINANCIAL, next)
      return next
    })
    setDeletedOrderIds(prev => {
      const next = prev.map(String).includes(idStr) ? prev : [...prev.map(String), idStr]
      return next
    })
    deletedOrderIdsRef.current?.add?.(idStr)
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_DELETED_ORDERS) || '[]')
      if (!saved.map(String).includes(idStr)) {
        saved.push(idStr)
        localStorage.setItem(STORAGE_DELETED_ORDERS, JSON.stringify(saved))
      }
      const pending = JSON.parse(localStorage.getItem('thsm_pending_orders') || '[]')
      const nextPending = pending.filter(p => String(p.id) !== idStr)
      localStorage.setItem('thsm_pending_orders', JSON.stringify(nextPending))
    } catch {}

    supabaseDeleteOrder(id).then(({ error } = {}) => {
      if (error) showToast('Pedido excluído (aviso: sincronização de exclusão falhou)', 'error')
    })
    showToast('Pedido excluído com sucesso')
  }

  const gerarLinkRecuperacao = async (user) => {
    const telefone = (user.telefone || '').replace(/\D/g, '')
    if (!telefone || telefone.replace(/\D/g, '').length < 11) { showToast('Usuário sem telefone válido', 'error'); return }
    const token = await generateLoginToken(telefone)
    if (!token) { showToast('Erro ao gerar link de recuperação', 'error'); return }
    setRecoverLink(`${window.location.origin}${window.location.pathname}?recover=${token}`)
    setRecoverLinkUser(user)
  }

  const saveUserEdit = async () => {
    if (!editUserData) return
    const payload = {
      ...selectedUserDetail,
      ...editUserData,
      endereco: {
        ...(selectedUserDetail?.endereco || {}),
        ...(editUserData.endereco || {})
      }
    }
    if (payload.endereco?.limitePreco !== undefined) {
      payload.endereco.limitePreco = (payload.endereco.limitePreco === '' || payload.endereco.limitePreco === null)
        ? null
        : parseDecimalToNumber(payload.endereco.limitePreco)
    }
    if (editUserData.senha) payload.endereco.senha = editUserData.senha
    else if (selectedUserDetail?.endereco?.senha) payload.endereco.senha = selectedUserDetail.endereco.senha

    try {
      const response = await fetch('https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/att-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        let responseData = {}
        try { responseData = await response.json() } catch (err) { }

        if (responseData.status === 'erro' || responseData.status === 'error') {
          showToast('Erro retornado pelo webhook: ' + (responseData.message || ''), 'error')
        } else {
          setUsuarios(prev => prev.map(u => u.telefone === payload.telefone ? payload : u))
          setSelectedUserDetail(payload)
          setEditingUser(false)
          setEditUserData(null)
          showToast('Usuário atualizado com sucesso!')
        }
      } else {
        showToast('Erro HTTP ao salvar no webhook', 'error')
      }
    } catch (e) {
      console.error(e)
      showToast('Erro ao salvar. Verifique sua conexão.', 'error')
    }
  }

  const mudarSenha = async () => {
    if (!pwTarget) return
    const nova = (pwNew || '').trim()
    if (nova.length < 3) { showToast('A senha deve ter pelo menos 3 caracteres', 'error'); return }
    const payload = {
      ...pwTarget,
      endereco: { ...(pwTarget.endereco || {}), senha: nova }
    }

    try {
      const response = await fetch('https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/att-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        let responseData = {}
        try { responseData = await response.json() } catch (err) { }

        if (responseData.status === 'erro' || responseData.status === 'error') {
          showToast('Erro retornado pelo webhook: ' + (responseData.message || ''), 'error')
        } else {
          setUsuarios(prev => prev.map(u => u.telefone === payload.telefone ? payload : u))
          if (selectedUserDetail?.telefone === payload.telefone) setSelectedUserDetail(payload)
          setPwTarget(null)
          setPwNew('')
          showToast(`Senha de ${payload.nome} alterada com sucesso!`)
        }
      } else {
        showToast('Erro HTTP ao alterar a senha', 'error')
      }
    } catch (e) {
      console.error(e)
      showToast('Erro de conexão ao alterar a senha', 'error')
    }
  }

  const gerarSenhasUsuarios = async () => {
    if (!confirm('Gerar senha para todos os usuários que não têm? (Senha = primeiro nome + 4 últimos dígitos do telefone)')) return
    const semSenha = usuarios.filter(u => !u.endereco?.senha)
    if (semSenha.length === 0) { showToast('Todos os usuários já têm senha!', 'warning'); return }
    let count = 0
    for (const u of semSenha) {
      const primeiroNome = (u.nome || 'Usuario').split(' ')[0]
      const ultimos4 = (u.telefone || '').replace(/\D/g, '').slice(-4)
      const senha = primeiroNome + ultimos4
      const endereco = { ...(u.endereco || {}), senha }
      const saved = await upsertUser({ telefone: u.telefone, nome: u.nome, email: u.email || '', endereco })
      if (saved) {
        setUsuarios(prev => prev.map(x => x.telefone === saved.telefone ? saved : x))
        count++
      }
    }
    showToast(`${count} senha(s) gerada(s) com sucesso!`)
  }

  const definirSenhasTodos = async () => {
    if (!confirm('Definir a senha 1234 para TODOS os usuários?\n\nIsso sobrescreve qualquer senha atual.')) return
    if (usuarios.length === 0) { showToast('Nenhum usuário cadastrado', 'warning'); return }
    let count = 0
    for (const u of usuarios) {
      const endereco = { ...(u.endereco || {}), senha: '1234' }
      const saved = await upsertUser({ telefone: u.telefone, nome: u.nome, email: u.email || '', endereco })
      if (saved) {
        setUsuarios(prev => prev.map(x => x.telefone === saved.telefone ? saved : x))
        count++
      }
    }
    showToast(`${count} senha(s) definida(s) para 1234!`)
  }

  const handleDeleteUser = async (user) => {
    if (!confirm(`Tem certeza que deseja excluir "${user.nome}" (${user.telefone})?\n\nIsso também excluirá todos os pedidos e financeiro deste usuário.`)) return
    const { error, deletedOrders } = await deleteUserByTelefone(user.telefone)
    if (error) { showToast('Erro ao excluir usuário', 'error'); return }
    setUsuarios(prev => prev.filter(u => u.telefone !== user.telefone))
    if (selectedUserDetail?.telefone === user.telefone) setSelectedUserDetail(null)
    showToast(`Usuário excluído! ${deletedOrders > 0 ? `${deletedOrders} pedido(s) removido(s).` : ''}`)
  }

  const bulkDeleteUsers = async () => {
    if (selectedUserIds.size === 0) { showToast('Selecione pelo menos um usuário', 'error'); return }
    if (!confirm(`Excluir ${selectedUserIds.size} usuário(s)?\n\nIsso também excluirá todos os pedidos e financeiro deles.`)) return
    let ok = 0
    let err = 0
    for (const uid of selectedUserIds) {
      const user = usuarios.find(u => (u.telefone || u.id) === uid)
      if (!user) continue
      const { error } = await deleteUserByTelefone(user.telefone)
      if (error) { err++ } else { ok++ }
    }
    if (ok > 0) setUsuarios(prev => prev.filter(u => !selectedUserIds.has(u.telefone || u.id)))
    if (selectedUserDetail && selectedUserIds.has(selectedUserDetail.telefone || selectedUserDetail.id)) setSelectedUserDetail(null)
    setSelectedUserIds(new Set())
    showToast(err > 0 ? `${ok} excluído(s), ${err} falhou(aram)` : `${ok} usuário(s) excluído(s)`)
  }

  const formatPhone = (v) => {
    const nums = v.replace(/\D/g, '')
    if (nums.length <= 2) return `(${nums}`
    if (nums.length <= 7) return `(${nums.slice(0, 2)}) ${nums.slice(2)}`
    return `(${nums.slice(0, 2)}) ${nums.slice(2, 7)}-${nums.slice(7)}`
  }

  const cidadesOrders = useMemo(() => {
    const cidades = [...new Set(orders.map(o => o.customer?.endereco?.cidade).filter(Boolean))]
    return ['TODAS', ...cidades.sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [orders])

  const userOrdersDetail = useMemo(() => {
    if (!selectedUserDetail) return []
    return orders.filter(o => o.customer?.telefone === selectedUserDetail.telefone || o.user_id === selectedUserDetail.id)
      .sort((a, b) => getOrderTime(b) - getOrderTime(a))
  }, [orders, selectedUserDetail])

  const listaTodasRotas = useMemo(() => {
    const set = new Set()
    rotas.forEach(r => { if (r.rota) set.add(r.rota.trim()) })
    customRotas.forEach(cr => { if (cr.rota) set.add(cr.rota.trim()) })
    orders.forEach(o => {
      const r = o.customer?.endereco?.rota
      if (r) set.add(r.trim())
    })
    usuarios.forEach(u => {
      const r = u.endereco?.rota
      if (r) set.add(r.trim())
    })
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [rotas, customRotas, orders, usuarios])

  const rotaDeTelefone = useMemo(() => {
    const map = {}
    if (Array.isArray(rotas)) {
      rotas.forEach(r => {
        const phone = normalizePhone((r.remoteJid || '').replace(/@.*/, ''))
        if (phone) map[phone] = r.rota || 'Sem rota'
      })
    }
    if (Array.isArray(usuarios)) {
      usuarios.forEach(u => {
        const phone = normalizePhone(u.telefone)
        if (phone && u.endereco?.rota) map[phone] = u.endereco.rota
      })
    }
    return map
  }, [rotas, usuarios])

  const { userMapByPhone, userMapById } = useMemo(() => {
    const byPhone = new Map()
    const byId = new Map()
    if (Array.isArray(usuarios)) {
      for (const u of usuarios) {
        if (!u) continue
        if (u.id) byId.set(String(u.id), u)
        const p = normalizePhone(u.telefone)
        if (p) byPhone.set(p, u)
      }
    }
    return { userMapByPhone: byPhone, userMapById: byId }
  }, [usuarios])

  const getOrderCustomerName = useCallback((o) => {
    if (!o) return '-'
    if (o.customer?.nome && o.customer.nome.trim() && o.customer.nome.trim() !== '-') return o.customer.nome.trim()
    if (o.cliente && o.cliente.trim() && o.cliente.trim() !== '-') return o.cliente.trim()
    if (o.nome && o.nome.trim() && o.nome.trim() !== '-') return o.nome.trim()
    if (o.customerName && o.customerName.trim() && o.customerName.trim() !== '-') return o.customerName.trim()
    if (o.customer?.pushName && o.customer.pushName.trim()) return o.customer.pushName.trim()
    if (o.pushName && o.pushName.trim()) return o.pushName.trim()
    if (o.push_name && o.push_name.trim()) return o.push_name.trim()
    const p = normalizePhone(o.customer?.telefone || o.telefone)
    if (p && userMapByPhone.get(p)?.nome) return userMapByPhone.get(p).nome
    if (o.user_id && userMapById.get(String(o.user_id))?.nome) return userMapById.get(String(o.user_id)).nome
    return o.customer?.telefone || o.telefone || '-'
  }, [userMapByPhone, userMapById])

  const getOrderCustomerPhone = useCallback((o) => {
    if (!o) return ''
    if (o.customer?.telefone && o.customer.telefone.trim()) return o.customer.telefone.trim()
    if (o.telefone && o.telefone.trim()) return o.telefone.trim()
    if (o.user_id && userMapById.get(String(o.user_id))?.telefone) return userMapById.get(String(o.user_id)).telefone
    return ''
  }, [userMapById])

  const rotaDeOrder = useCallback((o) => {
    if (!o) return 'Sem rota'
    if (o.customer?.endereco?.rota) return o.customer.endereco.rota
    if (o.endereco?.rota) return o.endereco.rota
    const phone = normalizePhone(o.customer?.telefone || o.telefone)
    return phone ? (rotaDeTelefone[phone] || 'Sem rota') : 'Sem rota'
  }, [rotaDeTelefone])

  const getOrderDue = useCallback((o) => o.dataVencimento || financial.find(f => f.orderId === o.id)?.dueDate || '', [financial])

  const filteredOrders = useMemo(() => {
    let result = orders
    if (orderFilter === 'concluidos') result = result.filter(o => o.status === 'concluido' || isFinalizada(o))
    else if (orderFilter === 'entregue') result = result.filter(o => o.status === 'entregue' && !isFinalizada(o))
    else if (orderFilter === 'acerto') result = result.filter(o => o.status === 'acerto' && !isFinalizada(o))
    else if (orderFilter !== 'todos') result = result.filter(o => o.status === orderFilter)
    if (selectedUserEmail) result = result.filter(o => o.customer?.email === selectedUserEmail)
    if (orderSearch && orderSearch.trim()) {
      const term = orderSearch.trim()
      const digits = term.replace(/\D/g, '')
      result = result.filter(o => {
        const clientName = getOrderCustomerName(o)
        const clientPhone = getOrderCustomerPhone(o)
        const clientCity = o.customer?.endereco?.cidade || o.endereco?.cidade || ''
        const clientBairro = o.customer?.endereco?.bairro || o.endereco?.bairro || ''
        const clientRua = o.customer?.endereco?.rua || o.endereco?.rua || ''
        const clientRota = o.customer?.endereco?.rota || o.endereco?.rota || rotaDeOrder(o)
        const clientEmail = o.customer?.email || o.email || ''

        const matchCustomer = clientMatchesSearch({
          nome: clientName || o.customer?.nome || o.cliente || o.nome || o.customerName,
          pushName: o.customer?.pushName,
          telefone: clientPhone,
          email: clientEmail,
          endereco: {
            cidade: clientCity,
            bairro: clientBairro,
            rua: clientRua,
            rota: clientRota
          }
        }, term)
        const matchPhone = digits.length >= 2 && phonesMatch(clientPhone, digits)
        const matchId = String(o.id).includes(term.replace(/^#/, ''))
        const matchItems = (Array.isArray(o.items) && o.items.length > 0 ? o.items : (o.itens || [])).some(i => searchMatches(i?.nome, term) || searchMatches(i?.displayName, term))

        return matchCustomer || matchPhone || matchId || matchItems
      })
    }
    if (orderDateStart) result = result.filter(o => ((o.date || o.createdAt || '').split('T')[0]) >= orderDateStart)
    if (orderDateEnd) result = result.filter(o => ((o.date || o.createdAt || '').split('T')[0]) <= orderDateEnd)
    if (orderDueStart) result = result.filter(o => ((getOrderDue(o) || '').split('T')[0]) >= orderDueStart)
    if (orderDueEnd) result = result.filter(o => ((getOrderDue(o) || '').split('T')[0]) <= orderDueEnd)
    if (orderCityFilter !== 'TODAS') result = result.filter(o => (o.customer?.endereco?.cidade || o.endereco?.cidade) === orderCityFilter)
    if (orderRoutesSelected.size > 0) {
      result = result.filter(o => orderRoutesSelected.has(rotaDeOrder(o)))
    }
    result = [...result].sort((a, b) => {
      let va, vb
      switch (orderSort.field) {
        case 'cliente': va = getOrderCustomerName(a) || ''; vb = getOrderCustomerName(b) || ''; return orderSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'telefone': va = getOrderCustomerPhone(a) || ''; vb = getOrderCustomerPhone(b) || ''; return orderSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        case 'regiao': va = a.customer?.endereco?.cidade || ''; vb = b.customer?.endereco?.cidade || ''; return orderSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'rota': va = rotaDeOrder(a) || ''; vb = rotaDeOrder(b) || ''; return orderSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'data': return orderSort.dir === 'asc' ? (a.date || '').localeCompare(b.date || '') : (b.date || '').localeCompare(a.date || '')
        case 'vencimento': return orderSort.dir === 'asc' ? (a.dataVencimento || '').localeCompare(b.dataVencimento || '') : (b.dataVencimento || '').localeCompare(a.dataVencimento || '')
        case 'itens': va = a.items?.reduce((s, i) => s + (Number(i.qty) || 0), 0) || 0; vb = b.items?.reduce((s, i) => s + (Number(i.qty) || 0), 0) || 0; return orderSort.dir === 'asc' ? va - vb : vb - va
        case 'total': return orderSort.dir === 'asc' ? (a.total || 0) - (b.total || 0) : (b.total || 0) - (a.total || 0)
        default: return getOrderTime(b) - getOrderTime(a)
      }
    })
    return result
  }, [orders, orderFilter, selectedUserEmail, orderSearch, orderSort, orderDateStart, orderDateEnd, orderDueStart, orderDueEnd, orderCityFilter, orderRoutesSelected, rotaDeTelefone, financial, listaTodasRotas, getOrderCustomerName, getOrderCustomerPhone, rotaDeOrder, getOrderDue])

  const crossTabSearchMatchesCount = useMemo(() => {
    if (!orderSearch || !orderSearch.trim()) return 0
    if (orderFilter === 'todos') return 0
    const term = orderSearch.trim()
    const digits = term.replace(/\D/g, '')
    return orders.filter(o => {
      const clientName = getOrderCustomerName(o)
      const clientPhone = getOrderCustomerPhone(o)
      const clientCity = o.customer?.endereco?.cidade || o.endereco?.cidade || ''
      const clientBairro = o.customer?.endereco?.bairro || o.endereco?.bairro || ''
      const clientRua = o.customer?.endereco?.rua || o.endereco?.rua || ''
      const clientRota = o.customer?.endereco?.rota || o.endereco?.rota || rotaDeOrder(o)
      const clientEmail = o.customer?.email || o.email || ''

      const matchCustomer = clientMatchesSearch({
        nome: clientName || o.customer?.nome || o.cliente || o.nome || o.customerName,
        pushName: o.customer?.pushName,
        telefone: clientPhone,
        email: clientEmail,
        endereco: {
          cidade: clientCity,
          bairro: clientBairro,
          rua: clientRua,
          rota: clientRota
        }
      }, term)
      const matchPhone = digits.length >= 2 && phonesMatch(clientPhone, digits)
      const matchId = String(o.id).includes(term.replace(/^#/, ''))
      const matchItems = (Array.isArray(o.items) && o.items.length > 0 ? o.items : (o.itens || [])).some(i => searchMatches(i?.nome, term) || searchMatches(i?.displayName, term))

      return matchCustomer || matchPhone || matchId || matchItems
    }).length
  }, [orders, orderSearch, orderFilter, getOrderCustomerName, getOrderCustomerPhone, rotaDeOrder])

  const activeAdvancedFiltersCount = (orderDateStart ? 1 : 0) +
    (orderDateEnd ? 1 : 0) +
    (orderDueStart ? 1 : 0) +
    (orderDueEnd ? 1 : 0) +
    (orderCityFilter !== 'TODAS' ? 1 : 0) +
    (orderRoutesSelected.size > 0 ? 1 : 0)

  const paginatedOrders = useMemo(() => {
    const start = (orderPage - 1) * ORDER_PAGE_SIZE
    return filteredOrders.slice(start, start + ORDER_PAGE_SIZE)
  }, [filteredOrders, orderPage])

  const totalOrderPages = useMemo(() => Math.ceil(filteredOrders.length / ORDER_PAGE_SIZE), [filteredOrders])

  useEffect(() => { setOrderPage(1) }, [orderSearch, orderFilter, orderDateStart, orderDateEnd, orderDueStart, orderDueEnd, orderCityFilter, selectedUserEmail])

  const toggleSort = (field) => {
    setOrderSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' })
  }

  const sortIcon = (field) => {
    if (orderSort.field !== field) return <i className="fa-solid fa-sort" style={{ opacity: 0.3, marginLeft: 3, fontSize: '0.65rem' }}></i>
    return <i className={`fa-solid fa-sort-${orderSort.dir === 'asc' ? 'up' : 'down'}`} style={{ marginLeft: 3, fontSize: '0.65rem' }}></i>
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredOrders.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(filteredOrders.map(o => o.id)))
  }

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const bulkAction = (action) => {
    if (selectedIds.size === 0) { showToast('Selecione pelo menos um pedido', 'error'); return }
    if (action === 'delete') {
      if (!confirm(`Excluir definitivamente ${selectedIds.size} pedido(s)?`)) return
      const idList = Array.from(selectedIds)
      const idStrSet = new Set(idList.map(String))

      setOrders(prev => {
        const next = prev.filter(o => !idStrSet.has(String(o.id)))
        LS.set(STORAGE_ORDERS, next)
        return next
      })
      setFinancial(prev => {
        const next = prev.filter(f => !idStrSet.has(String(f.orderId)))
        LS.set(STORAGE_FINANCIAL, next)
        return next
      })
      setDeletedOrderIds(prev => {
        const next = Array.from(new Set([...prev.map(String), ...idList.map(String)]))
        return next
      })
      idList.forEach(id => {
        deletedOrderIdsRef.current?.add?.(String(id))
        supabaseDeleteOrder(id)
      })
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_DELETED_ORDERS) || '[]')
        const mergedSaved = Array.from(new Set([...saved.map(String), ...idList.map(String)]))
        localStorage.setItem(STORAGE_DELETED_ORDERS, JSON.stringify(mergedSaved))

        const pending = JSON.parse(localStorage.getItem('thsm_pending_orders') || '[]')
        const nextPending = pending.filter(p => !idStrSet.has(String(p.id)))
        localStorage.setItem('thsm_pending_orders', JSON.stringify(nextPending))
      } catch {}

      showToast(`${selectedIds.size} pedido(s) excluído(s)`)
      setSelectedIds(new Set())
      return
    }

    selectedIds.forEach(id => {
      const order = orders.find(o => o.id === id)
      if (action === 'confirm') {
        if (order?.status === 'pre-pedido') updateOrderStatus(id, 'pendente', true)
        else if (order?.status === 'pendente') updateOrderStatus(id, 'em-rota')
        else if (order?.status === 'em-rota') updateOrderStatus(id, 'entregue')
        else if (order?.status === 'entregue') updateOrderStatus(id, 'acerto')
        else updateOrderStatus(id, 'entregue')
      }
    })
    setSelectedIds(new Set())
  }

  const gerarRelatorioSemDevolucao = () => {
    if (selectedIds.size === 0) { showToast('Selecione pelo menos um pedido', 'error'); return }
    const norm = (v) => (v || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '')
    const isNoDevName = (nome) => {
      const n = norm(nome).replace(/sem/, ' devol')
      return norm(nome).includes('semdevolu') || norm(nome).includes('sem-devolu') || norm(nome).includes('sem devolu') || norm(nome).includes('s/devolu')
    }
    const rows = []
    selectedIds.forEach(id => {
      const order = orders.find(o => o.id === id)
      if (!order) return
        ; (order.items || []).forEach(i => {
          const prodAtual = produtosAtuais.find(p => p.id === i.id || p.id === String(i.id) || norm(p.nome) === norm(i.nome))
          const semDev = i.semDevolucao || prodAtual?.semDevolucao || isNoDevName(i.nome)
          if (semDev) {
            rows.push({
              orderId: id,
              cliente: order.customer?.nome || '-',
              telefone: order.customer?.telefone || '-',
              cidade: order.customer?.endereco?.cidade || '',
              produto: i.nome,
              qty: i.qty || 1,
              valor: (i.preco || 0) * (i.qty || 1),
              data: order.date || ''
            })
          }
        })
    })
    if (rows.length === 0) {
      showToast('Nenhum produto SEM DEVOLUÇÃO nos pedidos selecionados', 'error')
      return
    }
    const groupsMap = {}
    rows.forEach(r => {
      const key = (r.telefone || r.cliente || 'sem-contato').trim()
      if (!groupsMap[key]) groupsMap[key] = { cliente: r.cliente, telefone: r.telefone, cidade: r.cidade, rows: [] }
      groupsMap[key].rows.push(r)
    })
    const groups = Object.values(groupsMap)
    const expand = {}
    groups.forEach((g, idx) => { expand[idx] = true })
    setSemDevGroups(expand)
    setSemDevReport({ rows, groups, total: rows.reduce((s, r) => s + r.valor, 0), geradoEm: new Date().toLocaleString('pt-BR') })
    setSelectedIds(new Set())
  }

  const sendWhatsApp = (o) => {
    if (!o) return
    const phone = getOrderCustomerPhone(o)
    const raw = (phone || '').replace(/\D/g, '')
    if (!raw || raw.length < 10) {
      showToast('Cliente sem telefone válido para WhatsApp', 'error')
      return
    }
    const cleanPhone = raw.startsWith('55') ? raw.slice(2) : raw
    const telefoneCom55 = '55' + cleanPhone
    const msg = buildStatusWhatsApp(o, o.status)

    // 1. Disparo de webhook em segundo plano
    try {
      fetch(WHATSAPP_FORCE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: telefoneCom55, message: msg })
      }).then(() => {
        showToast('WhatsApp disparado via sistema!', 'success')
      }).catch(err => {
        console.warn('Falha webhook whatsapp:', err)
      })
    } catch (err) {
      console.warn('Exceção webhook whatsapp:', err)
    }

    // 2. Abrir diretamente o WhatsApp no celular ou navegador
    const waUrl = `https://wa.me/${telefoneCom55}?text=${encodeURIComponent(msg)}`
    window.open(waUrl, '_blank')
  }

  // Stats
  const stats = useMemo(() => {
    const total = orders.length
    const pendentes = orders.filter(o => o.status === 'pendente').length
    const prePedidos = orders.filter(o => o.status === 'pre-pedido').length
    const confirmados = orders.filter(o => o.status === 'confirmado').length
    const emAndamento = orders.filter(o => o.status === 'em-andamento').length
    const emRota = orders.filter(o => o.status === 'em-rota').length
    const entregues = orders.filter(o => o.status === 'entregue').length
    const faturamento = orders.filter(o => o.status !== 'cancelado').reduce((s, o) => s + o.total, 0)
    const aReceber = financial.filter(f => f.status === 'pendente').reduce((s, f) => s + f.value, 0)
    const recebido = financial.filter(f => f.status === 'pago').reduce((s, f) => s + f.value, 0)
    return { total, pendentes, prePedidos, confirmados, emAndamento, entregues, faturamento, aReceber, recebido }
  }, [orders, financial])

  // Filtro de período do Dashboard
  const dashRange = useMemo(() => {
    const h = hoje()
    const d = new Date(h + 'T12:00:00')
    if (dashPeriod === 'day') return [h, h]
    if (dashPeriod === 'month') {
      const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      return [start, end]
    }
    if (dashPeriod === 'year') return [`${d.getFullYear()}-01-01`, `${d.getFullYear()}-12-31`]
    if (dashPeriod === 'custom' && dashCustomStart && dashCustomEnd) return [dashCustomStart, dashCustomEnd]
    return [null, null]
  }, [dashPeriod, dashCustomStart, dashCustomEnd])

  const dashStats = useMemo(() => {
    const [start, end] = dashRange
    const inRange = (dt) => {
      if (!dt) return false
      if (start && end) return dt >= start && dt <= end
      if (start) return dt >= start
      if (end) return dt <= end
      return true
    }
    const ordersIn = orders.filter(o => inRange(o.date || ''))
    const total = ordersIn.length
    const pendentes = ordersIn.filter(o => o.status === 'pendente').length
    const entregues = ordersIn.filter(o => o.status === 'entregue').length
    const acertos = ordersIn.filter(o => o.status === 'acerto').length
    const faturamento = ordersIn.filter(o => o.status !== 'cancelado').reduce((s, o) => s + (o.total || 0), 0)
    const aReceber = financial.filter(f => f.status === 'pendente' && inRange(f.dueDate || '')).reduce((s, f) => s + (f.value || 0), 0)
    const recebido = financial.filter(f => f.status === 'pago' && inRange(f.paidDate || '')).reduce((s, f) => s + (f.value || 0), 0)
    return { total, pendentes, entregues, acertos, faturamento, aReceber, recebido }
  }, [orders, financial, dashRange])

  const dashLastOrders = useMemo(() => {
    const [start, end] = dashRange
    const inRange = (dt) => {
      if (!dt) return false
      if (start && end) return dt >= start && dt <= end
      if (start) return dt >= start
      if (end) return dt <= end
      return true
    }
    return orders.filter(o => inRange(o.date || '')).slice(0, 8)
  }, [orders, dashRange])

  // Métricas das comandas concluídas
  const concluidosStats = useMemo(() => {
    const concluidos = orders.filter(isFinalizada)
    const faturamentoTotal = concluidos.reduce((s, o) => s + (o.total || 0), 0)
    let lucroTotal = 0
    const qtyByProduto = {}
    concluidos.forEach(o => {
      ; (o.items || []).forEach(i => {
        const qty = Number(i.qty) || 0
        const preco = Number(i.preco) || 0
        const custo = getItemCost(i, produtosAtuais)
        lucroTotal += (preco - custo) * qty
        const key = i.displayName || i.nome || i.produto || 'Produto'
        qtyByProduto[key] = (qtyByProduto[key] || 0) + qty
      })
    })
    let maisVendido = null
    let maisVendidoQty = 0
    Object.entries(qtyByProduto).forEach(([nome, qty]) => {
      if (qty > maisVendidoQty) { maisVendidoQty = qty; maisVendido = nome }
    })
    return {
      totalPedidos: concluidos.length,
      faturamentoTotal,
      lucroTotal,
      maisVendido,
      maisVendidoQty
    }
  }, [orders])

  const rotasAgrupadas = useMemo(() => {
    const groups = {}
    rotas.forEach(r => {
      const rotaKey = r.rota || 'Sem rota'
      if (!groups[rotaKey]) groups[rotaKey] = { rota: rotaKey, cidades: {}, total: 0 }
      const cidadeKey = r.cidade || 'Sem cidade'
      if (!groups[rotaKey].cidades[cidadeKey]) groups[rotaKey].cidades[cidadeKey] = { cidade: cidadeKey, contatos: [] }
      groups[rotaKey].cidades[cidadeKey].contatos.push(r)
      groups[rotaKey].total++
    })
    customRotas.forEach(cr => {
      const rotaKey = cr.rota
      if (!groups[rotaKey]) groups[rotaKey] = { rota: rotaKey, cidades: {}, total: 0, _custom: true }
      cr.cidades.forEach(c => {
        const cidadeKey = c.cidade || 'Sem cidade'
        if (!groups[rotaKey].cidades[cidadeKey]) groups[rotaKey].cidades[cidadeKey] = { cidade: cidadeKey, contatos: [] }
        c.contatos.forEach(ct => {
          groups[rotaKey].cidades[cidadeKey].contatos.push(ct)
          groups[rotaKey].total++
        })
      })
    })
    // Aplica edições persistidas (adicionar/remover) sobre as rotas sincronizadas do webhook
    rotaEdits.forEach(e => {
      const rotaKey = e.rota
      if (e.acao === 'remover') {
        const g = groups[rotaKey]
        if (!g) return
        const jid = e.contato?.remoteJid
        const tel = normalizePhone(e.contato?.telefone)
        Object.keys(g.cidades).forEach(k => {
          g.cidades[k].contatos = g.cidades[k].contatos.filter(ct => {
            if (jid && ct.remoteJid && ct.remoteJid === jid) return false
            if (tel && ct.remoteJid) {
              const ctTel = normalizePhone((ct.remoteJid || '').replace(/@.*/, ''))
              if (ctTel && ctTel === tel) return false
            }
            if (tel && ct.telefone && normalizePhone(ct.telefone) === tel) return false
            return true
          })
          if (g.cidades[k].contatos.length === 0) delete g.cidades[k]
        })
      } else if (e.acao === 'adicionar') {
        if (!groups[rotaKey]) groups[rotaKey] = { rota: rotaKey, cidades: {}, total: 0, _edited: true }
        const cidadeKey = e.contato?.cidade || 'Personalizado'
        if (!groups[rotaKey].cidades[cidadeKey]) groups[rotaKey].cidades[cidadeKey] = { cidade: cidadeKey, contatos: [] }
        const tel = normalizePhone(e.contato?.telefone)
        const jid = e.contato?.remoteJid
        const exists = groups[rotaKey].cidades[cidadeKey].contatos.some(ct => {
          if (jid && ct.remoteJid && ct.remoteJid === jid) return true
          if (tel && ct.remoteJid && normalizePhone((ct.remoteJid || '').replace(/@.*/, '')) === tel) return true
          if (tel && ct.telefone && normalizePhone(ct.telefone) === tel) return true
          return false
        })
        if (!exists) {
          const jidFinal = jid || (tel ? `${tel}@s.whatsapp.net` : '')
          groups[rotaKey].cidades[cidadeKey].contatos.push({
            remoteJid: jidFinal,
            pushName: e.contato?.pushName || e.contato?.nome || 'Contato',
            nome: e.contato?.nome || e.contato?.pushName || '',
            telefone: tel,
            cidade: cidadeKey,
            rota: rotaKey,
            profilePicture: '',
            _edited: true
          })
        }
      }
    })
    Object.values(groups).forEach(g => { g.total = Object.values(g.cidades).reduce((s, c) => s + c.contatos.length, 0) })
    return Object.values(groups).map(g => ({
      ...g,
      cidades: Object.values(g.cidades).sort((a, b) => a.cidade.localeCompare(b.cidade, 'pt-BR'))
    }))
  }, [rotas, customRotas, rotaEdits])

  // Consolidar todos os clientes da base (usuarios + pedidos históricos + contatos das rotas)
  // Deduplicação inteligente que preserva clientes distintos mesmo se compartilharem telefone
  const allClientesConsolidados = useMemo(() => {
    const list = []
    const phoneMap = new Map()
    const nameMap = new Map()

    const getCleanPhone = (p) => {
      if (!p) return ''
      let digits = cleanDigits(p)
      if (digits.startsWith('55') && digits.length > 10) digits = digits.slice(2)
      return digits
    }

    const isSamePerson = (nameA, nameB) => {
      if (!nameA || !nameB) return false
      const nA = normalizeSearch(nameA).trim()
      const nB = normalizeSearch(nameB).trim()
      if (nA === nB) return true
      const wordsA = nA.split(/\s+/).filter(w => w.length > 2)
      const wordsB = nB.split(/\s+/).filter(w => w.length > 2)
      if (wordsA.length === 0 || wordsB.length === 0) return false
      return wordsA.every(w => wordsB.includes(w)) || wordsB.every(w => wordsA.includes(w))
    }

    const findMatchIndex = (name, phone, id) => {
      const cleanP = getCleanPhone(phone)
      const normN = normalizeSearch(name || '').trim()

      if (id) {
        const byId = list.findIndex(c => String(c.id) === String(id))
        if (byId !== -1) return byId
      }

      if (cleanP && phoneMap.has(cleanP)) {
        const candidates = phoneMap.get(cleanP)
        for (const idx of candidates) {
          const c = list[idx]
          if (!normN || !c.nome || isSamePerson(c.nome, name)) {
            return idx
          }
        }
      }

      if (normN && nameMap.has(normN)) {
        const candidates = nameMap.get(normN)
        for (const idx of candidates) {
          const c = list[idx]
          const cPhone = getCleanPhone(c.telefone)
          if (!cleanP || !cPhone || cleanP === cPhone) {
            return idx
          }
        }
      }

      return -1
    }

    const mergeClient = (targetIdx, incoming) => {
      const target = list[targetIdx]
      const existingEnd = target.endereco || {}
      const inEnd = incoming.endereco || {}

      let bestName = target.nome || ''
      if ((incoming.nome || '').length > bestName.length && !target.nome?.includes(incoming.nome)) {
        bestName = incoming.nome
      }

      const mergedEnd = {
        cep: target.cep || existingEnd.cep || incoming.cep || inEnd.cep || '',
        cidade: existingEnd.cidade || target.cidade || inEnd.cidade || incoming.cidade || '',
        bairro: existingEnd.bairro || inEnd.bairro || '',
        rua: existingEnd.rua || inEnd.rua || inEnd.logradouro || '',
        numero: existingEnd.numero || inEnd.numero || '',
        complemento: existingEnd.complemento || inEnd.complemento || '',
        estado: existingEnd.estado || inEnd.estado || '',
        cpf: existingEnd.cpf || target.cpf || inEnd.cpf || incoming.cpf || ''
      }

      const updated = {
        ...target,
        nome: bestName,
        telefone: target.telefone || incoming.telefone || '',
        email: target.email || incoming.email || '',
        cpf: target.cpf || incoming.cpf || mergedEnd.cpf || '',
        rota: target.rota || incoming.rota || '',
        cidade: mergedEnd.cidade,
        endereco: mergedEnd
      }

      list[targetIdx] = updated

      const cleanP = getCleanPhone(updated.telefone)
      if (cleanP) {
        if (!phoneMap.has(cleanP)) phoneMap.set(cleanP, [])
        if (!phoneMap.get(cleanP).includes(targetIdx)) phoneMap.get(cleanP).push(targetIdx)
      }
      const normN = normalizeSearch(updated.nome || '').trim()
      if (normN) {
        if (!nameMap.has(normN)) nameMap.set(normN, [])
        if (!nameMap.get(normN).includes(targetIdx)) nameMap.get(normN).push(targetIdx)
      }
    }

    const addClient = (incoming) => {
      const idx = findMatchIndex(incoming.nome, incoming.telefone, incoming.id)
      if (idx !== -1) {
        mergeClient(idx, incoming)
      } else {
        const newIdx = list.length
        list.push(incoming)
        const cleanP = getCleanPhone(incoming.telefone)
        if (cleanP) {
          if (!phoneMap.has(cleanP)) phoneMap.set(cleanP, [])
          phoneMap.get(cleanP).push(newIdx)
        }
        const normN = normalizeSearch(incoming.nome || '').trim()
        if (normN) {
          if (!nameMap.has(normN)) nameMap.set(normN, [])
          nameMap.get(normN).push(newIdx)
        }
      }
    }

    // 1. Clientes registrados na tabela usuarios
    if (Array.isArray(usuarios)) {
      for (const u of usuarios) {
        if (!u) continue
        addClient({
          ...u,
          nome: (u.nome || u.pushName || 'Cliente').trim(),
          telefone: u.telefone || '',
          cidade: u.endereco?.cidade || u.cidade || '',
          source: 'usuario'
        })
      }
    }

    // 2. Clientes encontrados nos pedidos históricos (garante 100% de cobertura de quem já comprou)
    if (Array.isArray(orders)) {
      for (const o of orders) {
        if (!o) continue
        const cust = o.customer || (o.data && o.data.customer) || o
        const rawPhone = cust.telefone || o.telefone || o.phone || cust.phone || ''
        const name = (cust.nome || o.nome || o.cliente || cust.pushName || o.customerName || '').trim()
        const end = cust.endereco || o.endereco || {}
        if (!name && !rawPhone) continue

        addClient({
          id: cust.user_id || o.user_id || `order-cust-${o.id}`,
          nome: name || 'Cliente Sem Nome',
          telefone: rawPhone || '',
          email: cust.email || o.email || '',
          cpf: cust.cpf || end.cpf || o.cpf || '',
          rota: o.rota || cust.rota || '',
          cidade: end.cidade || '',
          endereco: {
            cep: end.cep || '',
            cidade: end.cidade || '',
            bairro: end.bairro || '',
            rua: end.rua || end.logradouro || '',
            numero: end.numero || '',
            complemento: end.complemento || '',
            estado: end.estado || '',
            cpf: end.cpf || cust.cpf || ''
          },
          source: 'pedido'
        })
      }
    }

    // 3. Clientes cadastrados em Rotas (webhook, rotas personalizadas e edições de rota)
    if (Array.isArray(rotasAgrupadas)) {
      for (const group of rotasAgrupadas) {
        if (!group) continue
        const rotaName = group.rota
        const cidades = Array.isArray(group.cidades) ? group.cidades : Object.values(group.cidades || {})
        for (const c of cidades) {
          if (!c) continue
          const contatosList = Array.isArray(c.contatos) ? c.contatos : []
          for (const ct of contatosList) {
            if (!ct) continue
            const name = (ct.nome || ct.pushName || '').trim()
            const rawPhone = ct.telefone || (ct.remoteJid ? ct.remoteJid.replace(/@.*/, '') : '')
            if (!name && !rawPhone) continue

            addClient({
              id: `rota-${ct.remoteJid || rawPhone || Math.random()}`,
              nome: name || 'Contato Rota',
              telefone: rawPhone || '',
              rota: rotaName || ct.rota || '',
              cidade: ct.cidade || c.cidade || '',
              endereco: {
                cidade: ct.cidade || c.cidade || '',
                rua: '',
                bairro: '',
                cep: '',
                numero: '',
                complemento: '',
                estado: ''
              },
              source: 'rota'
            })
          }
        }
      }
    }

    return list.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))
  }, [usuarios, orders, rotasAgrupadas])

  // Usuarios filter & pagination
  const filteredUsuarios = useMemo(() => {
    let result = allClientesConsolidados
    const t = userSearch.toLowerCase().trim()
    const tEnd = userEnderecoSearch.toLowerCase().trim()
    if (selectedUserEmail || t || userCityFilter !== 'TODAS' || userOrigemFilter !== 'TODAS' || tEnd) {
      result = allClientesConsolidados.filter(u => {
        if (userCityFilter !== 'TODAS') {
          const cidade = (u.endereco?.cidade || u.cidade || '').toLowerCase()
          if (cidade !== userCityFilter.toLowerCase()) return false
        }
        if (userOrigemFilter !== 'TODAS') {
          const origem = u.endereco?.origem || u.source || ''
          if (origem !== userOrigemFilter) return false
        }
        if (userEnderecoSearch) {
          const e = u.endereco || {}
          const addrStr = [e.rua, e.numero, e.bairro, e.cidade, e.estado, e.cep, e.complemento].filter(Boolean).join(' ')
          if (!searchMatches(addrStr, userEnderecoSearch)) return false
        }
        if (userSearch && !clientMatchesSearch(u, userSearch)) return false
        return true
      })
    }
    return result.sort((a, b) => {
      let va, vb
      switch (userSort.field) {
        case 'nome': va = a.nome || ''; vb = b.nome || ''; return userSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'telefone': va = a.telefone || ''; vb = b.telefone || ''; return userSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        case 'cidade': va = a.endereco?.cidade || ''; vb = b.endereco?.cidade || ''; return userSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        default: return (a.nome || '').localeCompare(b.nome || '', 'pt-BR')
      }
    })
  }, [allClientesConsolidados, userSearch, userCityFilter, userOrigemFilter, userEnderecoSearch, userSort, selectedUserEmail])

  const paginatedUsuarios = useMemo(() => {
    const start = (userPage - 1) * USER_PAGE_SIZE
    return filteredUsuarios.slice(start, start + USER_PAGE_SIZE)
  }, [filteredUsuarios, userPage])

  const totalUserPages = useMemo(() => Math.ceil(filteredUsuarios.length / USER_PAGE_SIZE), [filteredUsuarios])

  useEffect(() => { setUserPage(1) }, [userSearch, userCityFilter, userOrigemFilter, userEnderecoSearch, selectedUserEmail])

  const userCities = useMemo(() => {
    const cidades = [...new Set((allClientesConsolidados || []).map(u => u.endereco?.cidade || u.cidade).filter(Boolean))]
    return ['TODAS', ...cidades.sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [allClientesConsolidados])

  // =============================================
  // PRODUCTS
  // =============================================
  const updateProduct = async (id, changes) => {
    const existing = produtosAtuais.find(x => x.id === id) || { id }
    const updated = { ...existing, ...changes }
    delete updated._new

    // Immediate optimistic update in Admin
    setAdminLocalProds(prev => {
      const list = prev || produtos || []
      const idx = list.findIndex(x => x.id === id)
      if (idx >= 0) {
        const next = [...list]
        next[idx] = updated
        return next
      }
      return [updated, ...list]
    })

    // Also update cached products in localStorage
    try {
      const cached = JSON.parse(localStorage.getItem('thsm_cached_produtos') || '[]')
      const cIdx = cached.findIndex(x => x.id === id)
      if (cIdx >= 0) cached[cIdx] = updated
      else cached.unshift(updated)
      localStorage.setItem('thsm_cached_produtos', JSON.stringify(cached))
    } catch { }

    const payload = { [id]: updated }
    await upsertProducts(payload)
    showToast('Produto salvo com sucesso!')
    if (editingProd) setEditingProd(null)
    if (typeof refreshProducts === 'function') refreshProducts()
  }

  const updateMultipleProducts = async (payload) => {
    await upsertProducts(payload)
    showToast('Produtos atualizados!')
    if (typeof refreshProducts === 'function') refreshProducts()
  }

  const categoriasProd = useMemo(() => ['TODOS', ...[...new Set([...produtosAtuais.map(p => p.categoria), ...customCategorias].filter(Boolean))].sort()], [produtosAtuais, customCategorias])

  const addDespesaTipo = (tipo) => {
    if (!tipo) return
    setCustomDespesaTipos(prev => prev.includes(tipo) ? prev : [...prev, tipo])
    showToast(`Tipo "${tipo}" criado!`)
  }

  const filteredProds = useMemo(() => {
    const [pMin, pMax] = prodPriceRange
    return (produtosAtuais || []).filter(p => {
      if (!p) return false
      const nome = String(p.nome || p.displayName || '')
      const cat = String(p.categoria || '')
      if (prodSearch && !searchMatches(nome, prodSearch) && !searchMatches(cat, prodSearch) && !searchMatches(p.descricao, prodSearch)) return false
      if (prodCatFilter === 'Encomendas da Empresa') {
        if (!p.semDevolucao) return false
      } else if (prodCatFilter !== 'TODOS' && cat !== prodCatFilter) return false
      if (prodStockFilter === 'in' && (Number(p.estoque) || 0) <= 0) return false
      if (prodStockFilter === 'out' && (Number(p.estoque) || 0) > 0) return false
      const preco = Number(p.preco) || 0
      if (preco < pMin || preco > pMax) return false
      return true
    }).sort((a, b) => {
      let va = String(a?.nome || a?.displayName || '')
      let vb = String(b?.nome || b?.displayName || '')
      switch (prodSort.field) {
        case 'nome':
          return prodSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'categoria':
          va = String(a?.categoria || '')
          vb = String(b?.categoria || '')
          return prodSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'preco':
          return prodSort.dir === 'asc' ? (Number(a?.preco) || 0) - (Number(b?.preco) || 0) : (Number(b?.preco) || 0) - (Number(a?.preco) || 0)
        case 'estoque':
          return prodSort.dir === 'asc' ? (Number(a?.estoque) || 0) - (Number(b?.estoque) || 0) : (Number(b?.estoque) || 0) - (Number(a?.estoque) || 0)
        default:
          return va.localeCompare(vb, 'pt-BR')
      }
    })
  }, [produtosAtuais, prodSearch, prodCatFilter, prodStockFilter, prodPriceRange, prodSort])

  const totalProdPages = Math.ceil(filteredProds.length / PROD_PER_PAGE)
  const paginatedProds = filteredProds.slice((prodPage - 1) * PROD_PER_PAGE, prodPage * PROD_PER_PAGE)
  useEffect(() => { setProdPage(1) }, [prodSearch, prodCatFilter, prodStockFilter, prodPriceRange])

  const toggleProdSort = (field) => {
    setProdSort(prev => prev.field === field ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' })
  }

  const prodSortIcon = (field) => {
    if (prodSort.field !== field) return <i className="fa-solid fa-sort" style={{ opacity: 0.3, marginLeft: 3, fontSize: '0.65rem' }}></i>
    return <i className={`fa-solid fa-sort-${prodSort.dir === 'asc' ? 'up' : 'down'}`} style={{ marginLeft: 3, fontSize: '0.65rem' }}></i>
  }

  const toggleProdSelectAll = () => {
    if (prodSelectedIds.size === filteredProds.length) setProdSelectedIds(new Set())
    else setProdSelectedIds(new Set(filteredProds.map(p => p.id)))
  }

  const toggleProdSelect = (id) => {
    setProdSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const addToProdCart = (p) => {
    const pPrice = Number(p.preco) > 0 ? Number(p.preco) : (productPriceMap?.get(String(p.id)) || productPriceMap?.get(String(p.nome || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')) || 0)
    setProdCart(prev => {
      const existing = prev[p.id]
      if (existing) return { ...prev, [p.id]: { ...existing, qty: existing.qty + 1 } }
      return { ...prev, [p.id]: { id: p.id, nome: p.nome, preco: pPrice, preco_custo: p.preco_custo, imagem: p.imagem, tipo: 'aprazo', qty: 1, semDevolucao: !!p.semDevolucao } }
    })
  }

  const removeFromProdCart = (id) => {
    setProdCart(prev => {
      const existing = prev[id]
      if (!existing) return prev
      if (existing.qty <= 1) {
        const { [id]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [id]: { ...existing, qty: existing.qty - 1 } }
    })
  }

  const prodCartItems = useMemo(() => Object.values(prodCart).filter(i => i.qty > 0), [prodCart])
  const prodCartCount = useMemo(() => prodCartItems.reduce((s, i) => s + i.qty, 0), [prodCartItems])
  const prodCartTotal = useMemo(() => prodCartItems.reduce((s, i) => s + i.preco * i.qty, 0), [prodCartItems])

  const clearProdCart = () => setProdCart({})

  const createOrderFromCart = () => {
    if (prodCartItems.length === 0) { showToast('Carrinho vazio', 'error'); return }
    setShowAddOrder(true)
  }

  const toggleProdImageError = (id) => {
    setProdImageErrors(prev => ({ ...prev, [id]: true }))
  }

  const deleteSelectedProducts = async (ids) => {
    const idList = [...ids]
    if (idList.length === 0) return
    if (!confirm(`Excluir permanentemente ${idList.length} produto(s)?\nEsta ação não pode ser desfeita.`)) return
    await supabaseDeleteProducts(idList)
    showToast(`${idList.length} produto(s) excluído(s)`)
    setProdSelectedIds(new Set())
    if (typeof refreshProducts === 'function') refreshProducts()
  }

  const bulkProdAction = (action) => {
    if (prodSelectedIds.size === 0) { showToast('Selecione pelo menos um produto', 'error'); return }
    const buildPayload = (changes) => {
      const payload = {}
      prodSelectedIds.forEach(id => {
        const p = produtos.find(x => x.id === id) || { id }
        payload[id] = { ...p, ...changes }
      })
      return payload
    }

    if (action === 'zerar') {
      if (!confirm(`Zerar estoque de ${prodSelectedIds.size} produto(s)?`)) return
      updateMultipleProducts(buildPayload({ estoque: 0 }))
      showToast(`Estoque zerado para ${prodSelectedIds.size} produto(s)`)
    } else if (action === 'ocultar') {
      if (!confirm(`Marcar ${prodSelectedIds.size} produto(s) como indisponível?`)) return
      updateMultipleProducts(buildPayload({ estoque: 0 }))
      showToast(`${prodSelectedIds.size} produto(s) marcados como indisponível`)
    } else if (action === 'preco') {
      setShowBulkPrice(true)
      return
    } else if (action === 'estoque') {
      setShowBulkStock(true)
      return
    } else if (action === 'semdev') {
      const allOn = [...prodSelectedIds].every(id => produtosAtuais.find(p => p.id === id)?.semDevolucao)
      const target = !allOn
      if (!confirm(`Marcar ${prodSelectedIds.size} produto(s) como ${target ? 'SEM DEVOLUÇÃO' : 'COM devolução'}?`)) return
      updateMultipleProducts(buildPayload({ semDevolucao: target }))
      showToast(`${prodSelectedIds.size} produto(s) marcados como ${target ? 'SEM DEVOLUÇÃO' : 'COM devolução'}`)
    }
    setProdSelectedIds(new Set())
  }

  const applyBulkPrice = () => {
    const val = parseDecimalToNumber(bulkPriceValue)
    if (isNaN(val) || val < 0) { showToast('Valor inválido', 'error'); return }
    if (!confirm(`Definir preço R$ ${val.toFixed(2).replace('.', ',')} para ${prodSelectedIds.size} produto(s)?`)) return

    const payload = {}
    prodSelectedIds.forEach(id => {
      const p = produtos.find(x => x.id === id) || { id }
      payload[id] = { ...p, preco: val }
    })
    updateMultipleProducts(payload)

    showToast(`Preço atualizado para ${prodSelectedIds.size} produto(s)`)
    setProdSelectedIds(new Set())
    setShowBulkPrice(false)
    setBulkPriceValue('')
  }

  const applyBulkStock = () => {
    const val = parseInt(bulkStockValue, 10)
    if (isNaN(val) || val < 0) { showToast('Valor inválido', 'error'); return }
    if (!confirm(`Definir estoque ${val} para ${prodSelectedIds.size} produto(s)?`)) return

    const payload = {}
    prodSelectedIds.forEach(id => {
      const p = produtos.find(x => x.id === id) || { id }
      payload[id] = { ...p, estoque: val }
    })
    updateMultipleProducts(payload)

    showToast(`Estoque atualizado para ${prodSelectedIds.size} produto(s)`)
    setProdSelectedIds(new Set())
    setShowBulkStock(false)
    setBulkStockValue('')
  }

  // =============================================
  // FINANCIAL
  // =============================================
  const handleFinSort = (key) => {
    setFinSort(prev => {
      if (prev.key === key) {
        if (prev.direction === 'asc') return { key, direction: 'desc' }
        return { key: null, direction: 'asc' }
      }
      return { key, direction: 'asc' }
    })
  }

  const renderSortIcon = (key) => {
    if (finSort.key !== key) return <i className="fa-solid fa-sort" style={{ opacity: 0.3, marginLeft: '5px' }}></i>
    return <i className={`fa-solid fa-sort-${finSort.direction === 'asc' ? 'up' : 'down'}`} style={{ marginLeft: '5px' }}></i>
  }

  const filteredFin = useMemo(() => {
    let result = financial
    if (finFilter !== 'todos') result = result.filter(f => f.status === finFilter)
    result = result.filter(f => inPeriod(f.dueDate, finPeriod, finPeriodMonth, finRangeStart, finRangeEnd))
    if (finSort.key) {
      result = [...result].sort((a, b) => {
        let valA = a[finSort.key]
        let valB = b[finSort.key]
        if (finSort.key === 'customerName' || finSort.key === 'itemName' || finSort.key === 'paymentMethod' || finSort.key === 'status') {
          valA = (valA || '').toLowerCase()
          valB = (valB || '').toLowerCase()
        } else if (finSort.key === 'dueDate') {
          valA = new Date(valA || '2099-12-31').getTime()
          valB = new Date(valB || '2099-12-31').getTime()
        } else if (finSort.key === 'qty' || finSort.key === 'value' || finSort.key === 'custo') {
          valA = Number(valA || 0)
          valB = Number(valB || 0)
        }
        if (valA < valB) return finSort.direction === 'asc' ? -1 : 1
        if (valA > valB) return finSort.direction === 'asc' ? 1 : -1
        return 0
      })
    }
    return result
  }, [financial, finFilter, finPeriod, finPeriodMonth, finRangeStart, finRangeEnd, finSort])

  const finTotal = useMemo(() => {
    const pendente = financial.filter(f => f.status === 'pendente').reduce((s, f) => s + f.value, 0)
    const pago = financial.filter(f => f.status === 'pago').reduce((s, f) => s + f.value, 0)
    const atrasado = financial.filter(f => f.status === 'pendente' && diffDays(f.dueDate, hoje()) > 0).reduce((s, f) => s + f.value, 0)
    return { pendente, pago, atrasado }
  }, [financial])

  const filteredDespesas = useMemo(() => {
    let result = despesas
    if (despesaFilter !== 'todas') result = result.filter(d => d.status === despesaFilter)
    result = result.filter(d => inPeriod(d.dueDate, despPeriod, despPeriodMonth, despRangeStart, despRangeEnd))
    return result
  }, [despesas, despesaFilter, despPeriod, despPeriodMonth, despRangeStart, despRangeEnd])

  const despesasPendentes = useMemo(() => despesas.filter(d => d.status === 'pendente').reduce((s, d) => s + d.value, 0), [despesas])

  const finTotalFiltered = useMemo(() => filteredFin.reduce((s, f) => s + f.value, 0), [filteredFin])
  const despesasTotalFiltered = useMemo(() => filteredDespesas.reduce((s, d) => s + d.value, 0), [filteredDespesas])

  const quitarFin = (id) => {
    const target = financial.find(f => f.id === id)
    if (!target) return
    setQuitarPayment('pix')
    setQuitarFinTarget(target)
  }

  const confirmQuitarFin = () => {
    if (!quitarFinTarget) return
    setFinancial(prev => prev.map(f => f.id === quitarFinTarget.id ? { ...f, status: 'pago', paidDate: hoje(), paymentMethod: quitarPayment || f.paymentMethod } : f))
    showToast('Conta marcada como paga!')
    setQuitarFinTarget(null)
  }

  const updateDueDate = (id, newDate) => {
    setFinancial(prev => prev.map(f => f.id === id ? { ...f, dueDate: newDate } : f))
    showToast('Vencimento atualizado!')
  }

  const saveDespesa = (data) => {
    if (editingDespesa) {
      setDespesas(prev => prev.map(d => d.id === editingDespesa.id ? { ...d, ...data } : d))
      showToast('Despesa atualizada!')
    } else {
      setDespesas(prev => [{ ...data, id: Date.now(), status: data.status || 'pendente', paidDate: data.status === 'pago' ? hoje() : null, createdAt: Date.now() }, ...prev])
      showToast('Despesa adicionada!')
    }
    setShowDespesaModal(false)
    setEditingDespesa(null)
  }

  const quitarDespesa = (id) => {
    setDespesas(prev => prev.map(d => d.id === id ? { ...d, status: 'pago', paidDate: hoje() } : d))
    showToast('Despesa marcada como paga!')
  }

  const deleteDespesa = (id) => {
    if (!confirm('Excluir esta despesa?')) return
    setDespesas(prev => prev.filter(d => d.id !== id))
    showToast('Despesa excluída')
  }

  // =============================================
  // SIDEBAR
  // =============================================
  const cidadesRotas = useMemo(() => {
    const cidades = [...new Set(rotas.map(r => r.cidade).filter(Boolean))]
    return ['TODAS', ...cidades.sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [rotas])

  const rotasUnicas = useMemo(() => {
    const rotasList = [...new Set([...rotas.map(r => r.rota), ...customRotas.map(cr => cr.rota), ...rotaEdits.map(e => e.acao === 'adicionar' ? e.rota : null)].filter(Boolean))]
    return ['TODAS', ...rotasList.sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [rotas, customRotas, rotaEdits])

  const clientPhones = useMemo(() => {
    const set = new Set()
    usuarios.forEach(u => {
      const phone = normalizePhone(String(u.telefone || ''))
      if (phone) set.add(phone)
    })
    return set
  }, [usuarios])

  const isClienteContato = (ct) => {
    const phone = normalizePhone(String(ct.remoteJid || ct.telefone || '').replace(/@.*/, ''))
    return phone ? clientPhones.has(phone) : false
  }

  const rotasFiltradas = useMemo(() => {
    let result = rotasAgrupadas
    if (filterCidade !== 'TODAS') result = result.filter(g => Object.values(g.cidades).some(c => c.cidade === filterCidade))
    if (filterRota !== 'TODAS') result = result.filter(g => g.rota === filterRota)
    if (filterRotaSearch.trim()) result = result.filter(g =>
      searchMatches(g.rota, filterRotaSearch) ||
      Object.values(g.cidades).some(c => searchMatches(c.cidade, filterRotaSearch)) ||
      Object.values(g.cidades).some(c => c.contatos.some(ct => clientMatchesSearch(ct, filterRotaSearch)))
    )
    return result
  }, [rotasAgrupadas, filterCidade, filterRota, filterRotaSearch])

  const rotaStats = useMemo(() => {
    const totalContatos = rotas.length
    const totalRotas = rotasAgrupadas.length
    const totalCidades = cidadesRotas.length - 1
    return { totalContatos, totalRotas, totalCidades }
  }, [rotas, rotasAgrupadas, cidadesRotas])

  const sidebar = [
    { id: 'dashboard', icon: 'fa-chart-pie', label: 'Dashboard' },
    { id: 'pedidos', icon: 'fa-clipboard-list', label: 'Pedidos', count: stats.prePedidos + stats.pendentes },
    { id: 'produtos', icon: 'fa-boxes', label: 'Produtos' },
    { id: 'rotas', icon: 'fa-route', label: 'Rotas', count: rotaStats.totalRotas },
    { id: 'financeiro', icon: 'fa-coins', label: 'Financeiro', count: financial.filter(f => f.status === 'pendente').length },
    { id: 'usuarios', icon: 'fa-users', label: 'Usuários', count: usuarios.length },
    { id: 'leads', icon: 'fa-file-pen', label: 'Inscrições', count: leads.length },
    { id: 'mapa', icon: 'fa-map', label: 'Mapa' },
    { id: 'analises', icon: 'fa-chart-pie', label: 'Análises' },
  ]

  // Injects data-label into .admin-table cells (used by mobile card layout)
  useEffect(() => {
    const labelTables = () => {
      document.querySelectorAll('.admin table.admin-table, .admin .admin-table').forEach(table => {
        const thead = table.querySelector('thead')
        if (!thead) return
        const headers = [...thead.querySelectorAll('th')].map(th => th.textContent.trim())
        table.querySelectorAll('tbody tr').forEach(row => {
          const cells = [...row.querySelectorAll('td')]
          cells.forEach((td, idx) => {
            if (td.dataset.label) return
            const label = headers[idx]
            if (label) td.dataset.label = label
          })
        })
      })
    }
    labelTables()
    const root = document.querySelector('.admin')
    if (!root) return
    const mo = new MutationObserver(labelTables)
    mo.observe(root, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [])

  return (
    <div className="admin">
      {toast && (
        <div className={`admin-toast admin-toast-${toast.type}`}>
          <i className={`fa-solid ${toast.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}`}></i>
          {toast.msg}
        </div>
      )}

      {/* SIDEBAR */}
      <aside className="admin-sidebar">
        <div className="admin-logo">
          <img src="/thsmdistribuidora.webp" alt="THSM" style={{ width: '28px', height: '28px', objectFit: 'contain', borderRadius: '4px' }} />
          <div>
            <strong>THSM Admin</strong>
            <span>Painel de Controle</span>
          </div>
        </div>
        <nav className="admin-nav">
          {sidebar.map(s => (
            <button key={s.id} className={`admin-nav-item ${tab === s.id ? 'active' : ''}`} onClick={() => setTab(s.id)}>
              <i className={`fa-solid ${s.icon}`}></i>
              <span>{s.label}</span>
              {s.count > 0 && <span className="admin-badge">{s.count}</span>}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <button className="admin-nav-item" onClick={onVoltar}>
            <i className="fa-solid fa-arrow-left"></i>
            <span>Voltar ao Catálogo</span>
          </button>
        </div>
      </aside>

      {/* CONTENT */}
      <main className="admin-content">
        {/* DASHBOARD */}
        {tab === 'dashboard' && (
          <div className="admin-section">
            <h1>Dashboard</h1>
            <p className="admin-subtitle">Resumo geral do sistema</p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {[
                { id: 'day', label: 'Dia' },
                { id: 'month', label: 'Mês' },
                { id: 'year', label: 'Ano' },
                { id: 'all', label: 'Todo período' },
                { id: 'custom', label: 'Personalizado' },
              ].map(p => (
                <button key={p.id} className={`admin-tab ${dashPeriod === p.id ? 'active' : ''}`} onClick={() => setDashPeriod(p.id)}>
                  {p.label}
                </button>
              ))}
              {dashPeriod === 'custom' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>
                  <input type="date" value={dashCustomStart} onChange={e => setDashCustomStart(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', maxWidth: '130px' }} />
                  <span>—</span>
                  <input type="date" value={dashCustomEnd} onChange={e => setDashCustomEnd(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', maxWidth: '130px' }} />
                </div>
              )}
            </div>

            <div className="admin-cards">
              <div className="admin-card card-blue">
                <i className="fa-solid fa-shopping-bag"></i>
                <div>
                  <strong>{dashStats.total}</strong>
                  <span>Total de Pedidos</span>
                </div>
              </div>
              <div className="admin-card card-yellow">
                <i className="fa-solid fa-hourglass-half"></i>
                <div>
                  <strong>{dashStats.pendentes}</strong>
                  <span>Pendentes</span>
                </div>
              </div>
              <div className="admin-card card-green">
                <i className="fa-solid fa-check-circle"></i>
                <div>
                  <strong>{dashStats.entregues}</strong>
                  <span>Entregues</span>
                </div>
              </div>
              <div className="admin-card card-blue" style={{ cursor: 'pointer' }} onClick={() => { setTab('pedidos'); setOrderFilter('acerto') }}>
                <i className="fa-solid fa-handshake"></i>
                <div>
                  <strong>{dashStats.acertos}</strong>
                  <span>Acertos</span>
                </div>
              </div>
              <div className="admin-card card-purple">
                <i className="fa-solid fa-dollar-sign"></i>
                <div>
                  <strong>{formatPreco(dashStats.faturamento)}</strong>
                  <span>Faturamento Total</span>
                </div>
              </div>
              <div className="admin-card card-red">
                <i className="fa-solid fa-clock"></i>
                <div>
                  <strong>{formatPreco(dashStats.aReceber)}</strong>
                  <span>A Receber (Prazo)</span>
                </div>
              </div>
              <div className="admin-card card-teal">
                <i className="fa-solid fa-sack-dollar"></i>
                <div>
                  <strong>{formatPreco(dashStats.recebido)}</strong>
                  <span>Recebido (Prazo)</span>
                </div>
              </div>
            </div>

            <div className="admin-chart-section">
              <h2>Últimos Pedidos</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Cliente</th>
                      <th>Região</th>
                      <th>Data</th>
                      <th>Total</th>
                      <th>Pagamento</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashLastOrders.map(o => (
                      <tr key={o.id}>
                        <td>#{o.id.toString().slice(-6)}</td>
                        <td style={{ fontWeight: 600 }}>{getOrderCustomerName(o)}</td>
                        <td>{[o.customer.endereco?.cidade, o.customer.endereco?.estado].filter(Boolean).join('/') || '-'}</td>
                        <td>{formatDate(o.date)}</td>
                        <td className="td-price">{formatPreco(o.total)}</td>
                        <td>{o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</td>
                        <td><span className={`status-tag status-${o.status}`}>{o.status}</span></td>
                      </tr>
                    ))}
                    {dashLastOrders.length === 0 && <tr><td colSpan="7" className="td-empty">Nenhum pedido no período</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* PEDIDOS */}
        {tab === 'pedidos' && (
          <div className="admin-section">
            <div className="admin-header-row admin-orders-header-row">
              <div>
                <h1>Pedidos</h1>
                <p className="admin-subtitle">Gerencie todos os pedidos recebidos</p>
              </div>
              <div className="admin-orders-header-actions">
                {selectedUserEmail && (
                  <span className="admin-user-filter-tag">
                    <i className="fa-solid fa-user"></i> {selectedUserEmail}
                    <button style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0 }} onClick={() => setSelectedUserEmail(null)}>
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </span>
                )}
                <button className="admin-btn admin-btn-sec admin-btn-conciliar" disabled={reconcilingOrders} onClick={handleReconcileOrders} title="Localiza pedidos sem ID e vincula aos usuários existentes ou cadastra os novos clientes">
                  <i className={`fa-solid ${reconcilingOrders ? 'fa-spinner fa-spin' : 'fa-link'}`}></i> <span>{reconcilingOrders ? 'Conciliando...' : 'Conciliar'}</span>
                </button>
                <button className="admin-btn admin-btn-relatorio" style={{ background: '#0284c7', color: 'white', borderColor: '#0284c7', fontSize: '0.8rem', padding: '0.45rem 0.85rem' }} onClick={() => setShowOrderReportModal(true)} title="Emitir Relatório de Pedidos em PDF ou Excel com filtros e resumo">
                  <i className="fa-solid fa-file-invoice-dollar"></i> <span>Relatório (PDF / Excel)</span>
                </button>
                <button className="admin-btn admin-btn-primary admin-btn-novo-pedido" onClick={() => setShowAddOrder(true)}>
                  <i className="fa-solid fa-plus"></i> Novo Pedido
                </button>
              </div>
            </div>

            {orderFilter === 'concluidos' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1rem', background: 'var(--card-bg)', border: '1px solid var(--admin-border)', borderRadius: '12px', padding: '1rem' }}>
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Pedidos Concluídos</p>
                  <p style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '0.25rem' }}>{concluidosStats.totalPedidos}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Faturamento Total</p>
                  <p style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '0.25rem', color: 'var(--accent)' }}>{formatPreco(concluidosStats.faturamentoTotal)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Lucro Total</p>
                  <p style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: '0.25rem', color: 'var(--success)' }}>{formatPreco(concluidosStats.lucroTotal)}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Produto Mais Vendido</p>
                  <p style={{ fontSize: '1.05rem', fontWeight: 800, marginTop: '0.25rem', color: 'var(--danger)' }}>
                    {concluidosStats.maisVendido ? `${concluidosStats.maisVendido} (${concluidosStats.maisVendidoQty})` : '—'}
                  </p>
                </div>
              </div>
            )}

            <div className="admin-tabs">
              {[
                { id: 'todos', label: 'Todos', count: orders.length },
                { id: 'pre-pedido', label: 'Pré-Pedidos', count: orders.filter(o => o.status === 'pre-pedido').length },
                { id: 'pendente', label: 'Pendentes', count: orders.filter(o => o.status === 'pendente').length },
                { id: 'em-rota', label: 'Em Rota', count: orders.filter(o => o.status === 'em-rota').length },
                { id: 'entregue', label: 'Entregues', count: orders.filter(o => o.status === 'entregue' && !isFinalizada(o)).length },
                { id: 'acerto', label: 'Acertos', count: orders.filter(o => o.status === 'acerto' && !isFinalizada(o)).length },
                { id: 'concluidos', label: 'Concluídos', count: orders.filter(o => (o.status === 'concluido' || isFinalizada(o))).length },
                { id: 'cancelado', label: 'Cancelados', count: orders.filter(o => o.status === 'cancelado').length },
              ].map(t => (
                <button key={t.id} className={`admin-tab ${orderFilter === t.id ? 'active' : ''}`} onClick={() => setOrderFilter(t.id)}>
                  {t.label} {t.count > 0 && <span className="tab-count">{t.count}</span>}
                </button>
              ))}
            </div>

            {/* SEARCH & FILTERS BAR */}
            <div className="admin-orders-search-wrapper">
              <div className="admin-orders-search-input-box">
                <i className="fa-solid fa-search admin-search-ico"></i>
                <input
                  type="text"
                  placeholder="Buscar por nome, telefone, cidade ou ID..."
                  value={orderSearch}
                  onChange={e => setOrderSearch(e.target.value)}
                  className="admin-orders-search-input"
                />
                {orderSearch && (
                  <button
                    type="button"
                    className="admin-search-clear-btn"
                    onClick={() => setOrderSearch('')}
                    title="Limpar busca"
                  >
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                )}
              </div>

              <button
                type="button"
                className={`admin-filter-toggle-btn ${mobileOrdersFilterOpen || activeAdvancedFiltersCount > 0 ? 'active' : ''}`}
                onClick={() => setMobileOrdersFilterOpen(v => !v)}
              >
                <i className="fa-solid fa-sliders"></i>
                <span>Filtros</span>
                {activeAdvancedFiltersCount > 0 && (
                  <span className="admin-filter-count-badge">{activeAdvancedFiltersCount}</span>
                )}
              </button>
            </div>

            {/* ADVANCED FILTERS PANEL */}
            <div className={`admin-orders-advanced-filters ${mobileOrdersFilterOpen ? 'mobile-open' : ''}`}>
              <div className="admin-filter-item">
                <span className="admin-filter-label">Data:</span>
                <input type="date" value={orderDateStart} onChange={e => setOrderDateStart(e.target.value)} className="admin-filter-input" />
                <span className="admin-filter-sep">—</span>
                <input type="date" value={orderDateEnd} onChange={e => setOrderDateEnd(e.target.value)} className="admin-filter-input" />
              </div>
              <div className="admin-filter-item">
                <span className="admin-filter-label">Vencimento:</span>
                <input type="date" value={orderDueStart} onChange={e => setOrderDueStart(e.target.value)} className="admin-filter-input" />
                <span className="admin-filter-sep">—</span>
                <input type="date" value={orderDueEnd} onChange={e => setOrderDueEnd(e.target.value)} className="admin-filter-input" />
              </div>
              <div className="admin-filter-item">
                <span className="admin-filter-label">Cidade:</span>
                <select value={orderCityFilter} onChange={e => setOrderCityFilter(e.target.value)} className="admin-filter-select">
                  {cidadesOrders.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="admin-filter-item" style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowOrderRouteFilter(v => !v)}
                  className={`admin-route-filter-btn ${orderRoutesSelected.size > 0 ? 'active' : ''}`}
                >
                  <i className="fa-solid fa-route"></i>
                  <span>{orderRoutesSelected.size > 0 ? `${orderRoutesSelected.size} rota(s)` : 'Rotas'}</span>
                  <i className="fa-solid fa-chevron-down" style={{ fontSize: '0.6rem' }}></i>
                </button>
                {showOrderRouteFilter && (
                  <div className="admin-route-filter-dropdown">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--admin-text-sec)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>Filtrar por rota</span>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.72rem', fontWeight: 600 }} onClick={() => setOrderRoutesSelected(new Set())}>Limpar</button>
                    </div>
                    {[...rotasUnicas.filter(r => r !== 'TODAS'), 'Sem rota'].map(r => {
                      const checked = orderRoutesSelected.has(r)
                      return (
                        <label key={r} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.3rem 0.4rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}>
                          <input type="checkbox" checked={checked}
                            onChange={() => setOrderRoutesSelected(prev => {
                              const next = new Set(prev)
                              if (next.has(r)) next.delete(r); else next.add(r)
                              return next
                            })}
                            style={{ cursor: 'pointer', width: '14px', height: '14px' }} />
                          <span>{r}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
              {activeAdvancedFiltersCount > 0 && (
                <button
                  type="button"
                  className="admin-btn admin-btn-sec"
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }}
                  onClick={() => {
                    setOrderDateStart('')
                    setOrderDateEnd('')
                    setOrderDueStart('')
                    setOrderDueEnd('')
                    setOrderCityFilter('TODAS')
                    setOrderRoutesSelected(new Set())
                  }}
                >
                  <i className="fa-solid fa-rotate-left"></i> Limpar Filtros
                </button>
              )}
            </div>

            {/* Desktop selected bulk bar */}
            {selectedIds.size > 0 && (
              <div className="admin-desktop-bulk-bar" style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', fontWeight: 600 }}>{selectedIds.size} selecionado(s)</span>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', background: '#0284c7', color: 'white', borderColor: '#0284c7' }} onClick={() => setShowOrderReportModal(true)} title="Emitir Relatório PDF ou Excel dos pedidos selecionados">
                  <i className="fa-solid fa-file-pdf"></i> Relatório PDF/Excel ({selectedIds.size})
                </button>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} onClick={() => bulkAction('confirm')}>
                  <i className="fa-solid fa-check"></i> Confirmar
                </button>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', background: 'var(--danger)', color: 'white', borderColor: 'var(--danger)' }} onClick={() => bulkAction('delete')}>
                  <i className="fa-solid fa-trash"></i> Excluir
                </button>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', background: '#dc2626', color: 'white', borderColor: '#dc2626' }} onClick={gerarRelatorioSemDevolucao}>
                  <i className="fa-solid fa-file-lines"></i> Relatório Sem Devolução
                </button>
                <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }} onClick={() => setSelectedIds(new Set())}>
                  <i className="fa-solid fa-xmark"></i> Limpar
                </button>
              </div>
            )}

            {/* Active search status banner */}
            {orderSearch && (
              <div className="admin-orders-search-status">
                <span>
                  <i className="fa-solid fa-magnifying-glass"></i>
                  {filteredOrders.length > 0 ? (
                    <> Mostrando <strong>{filteredOrders.length}</strong> pedido(s) encontrado(s) para "<strong>{orderSearch}</strong>"</>
                  ) : (
                    <> Nenhum pedido encontrado na aba <strong>"{orderFilter}"</strong> para "<strong>{orderSearch}</strong>"</>
                  )}
                </span>
                <button type="button" className="admin-search-status-clear" onClick={() => setOrderSearch('')}>
                  Limpar busca <i className="fa-solid fa-xmark"></i>
                </button>
              </div>
            )}

            {/* Cross-tab notice: if not found in current tab but found in other statuses */}
            {orderSearch && filteredOrders.length === 0 && crossTabSearchMatchesCount > 0 && (
              <div className="admin-search-cross-tab-alert">
                <div className="ascta-icon"><i className="fa-solid fa-circle-info"></i></div>
                <div className="ascta-body">
                  <strong>Pessoa/pedido encontrado em outro status!</strong>
                  <p>Não há pedidos na aba "<strong>{orderFilter}</strong>", mas encontramos <strong>{crossTabSearchMatchesCount} pedido(s)</strong> de "{orderSearch}" em outros status.</p>
                </div>
                <button type="button" className="admin-btn admin-btn-primary" onClick={() => setOrderFilter('todos')}>
                  <i className="fa-solid fa-layer-group"></i> Ver em Todos ({crossTabSearchMatchesCount})
                </button>
              </div>
            )}

            {/* DESKTOP TABLE VIEW */}
            <div className="admin-orders-desktop admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: '36px' }}>
                      <input type="checkbox" checked={filteredOrders.length > 0 && selectedIds.size === filteredOrders.length} onChange={toggleSelectAll} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('cliente')}>Cliente {sortIcon('cliente')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('telefone')}>Telefone {sortIcon('telefone')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('regiao')}>Região {sortIcon('regiao')}</th>
                    <th style={{ cursor: 'pointer', minWidth: '130px' }} onClick={() => toggleSort('rota')}>Rota {sortIcon('rota')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('data')}>Data {sortIcon('data')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('vencimento')}>Vencimento {sortIcon('vencimento')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('itens')}>Itens Totais {sortIcon('itens')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('total')}>Total {sortIcon('total')}</th>
                    <th>Pagamento</th>
                    <th>Status</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOrders.map(o => (
                    <tr key={o.id} className={selectedIds.has(o.id) ? 'row-selected' : ''}>
                      <td>
                        <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggleSelect(o.id)} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                      </td>
                      <td style={{ fontWeight: 600 }}>{getOrderCustomerName(o)}</td>
                      <td>{getOrderCustomerPhone(o) || '-'}</td>
                      <td>{[o.customer?.endereco?.cidade, o.customer?.endereco?.estado].filter(Boolean).join('/') || '-'}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <select
                          value={o.customer?.endereco?.rota !== undefined && o.customer?.endereco?.rota !== null ? o.customer.endereco.rota : ((normalizePhone(o.customer?.telefone) ? rotaDeTelefone[normalizePhone(o.customer?.telefone)] : '') || '')}
                          onChange={e => {
                            const val = e.target.value
                            if (val === '__NEW__') {
                              const custom = prompt('Nome da nova rota:')
                              if (custom && custom.trim()) {
                                const trimmed = custom.trim()
                                setCustomRotas(prev => [...prev, { id: 'cr-' + Date.now(), rota: trimmed }])
                                updateOrderRota(o.id, trimmed)
                              }
                            } else {
                              updateOrderRota(o.id, val)
                            }
                          }}
                          style={{
                            padding: '0.2rem 0.35rem',
                            borderRadius: '6px',
                            border: '1px solid var(--admin-border)',
                            fontSize: '0.74rem',
                            background: (o.customer?.endereco?.rota !== undefined && o.customer?.endereco?.rota !== null ? o.customer.endereco.rota : (normalizePhone(o.customer?.telefone) ? rotaDeTelefone[normalizePhone(o.customer?.telefone)] : '')) ? '#eff6ff' : 'white',
                            color: (o.customer?.endereco?.rota !== undefined && o.customer?.endereco?.rota !== null ? o.customer.endereco.rota : (normalizePhone(o.customer?.telefone) ? rotaDeTelefone[normalizePhone(o.customer?.telefone)] : '')) ? '#1d4ed8' : 'var(--admin-text)',
                            fontWeight: (o.customer?.endereco?.rota !== undefined && o.customer?.endereco?.rota !== null ? o.customer.endereco.rota : (normalizePhone(o.customer?.telefone) ? rotaDeTelefone[normalizePhone(o.customer?.telefone)] : '')) ? 600 : 400,
                            maxWidth: '140px',
                            cursor: 'pointer'
                          }}
                        >
                          <option value="">Sem Rota</option>
                          {listaTodasRotas.map(r => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                          <option value="__NEW__">+ Nova Rota...</option>
                        </select>
                      </td>
                      <td>{formatDate(o.date)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <input type="date" value={o.dataVencimento || ''} placeholder="Definir"
                          onChange={e => updateOrderDue(o.id, e.target.value)}
                          style={{ padding: '0.2rem 0.3rem', borderRadius: '5px', border: '1px solid var(--admin-border)', fontSize: '0.72rem', background: 'white', color: 'var(--admin-text)', width: '120px' }} />
                      </td>
                      <td>
                        <strong style={{ color: 'var(--admin-text)' }}>{(Array.isArray(o.items) && o.items.length > 0 ? o.items : (Array.isArray(o.originalItems) && o.originalItems.length > 0 ? o.originalItems : (o.itens || []))).reduce((s, i) => s + (Number(i.qty) || 0), 0)}</strong>
                        <span style={{ fontSize: '0.72rem', color: 'var(--admin-text-sec)', marginLeft: '3px' }}>peças</span>
                      </td>
                      <td className="td-price">{formatPreco(o.total)}</td>
                      <td>{o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</td>
                      <td><span className={`status-tag status-${o.status}`}>{o.status}</span></td>
                      <td>
                        <div className="td-actions">
                          <button className="action-btn action-green" title="Enviar WhatsApp" onClick={() => sendWhatsApp(o)}><i className="fa-brands fa-whatsapp"></i></button>
                          <button className="action-btn" title="Ver detalhes" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-eye"></i></button>
                          {o.status === 'pre-pedido' && <button className="action-btn" style={{ color: '#8b5cf6', borderColor: '#8b5cf6' }} title="Revisar" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-clipboard-check"></i></button>}
                          {o.status === 'pre-pedido' && <button className="action-btn action-confirm" title="Confirmar (Próxima etapa)" onClick={() => updateOrderStatus(o.id, 'pendente')}><i className="fa-solid fa-check"></i></button>}
                          {o.status === 'pre-pedido' && <button className="action-btn action-deliver" title="Enviar direto para Em Rota" onClick={() => { setShowRotaDue(o); setRotaDueDate(o.dataVencimento || '') }}><i className="fa-solid fa-truck"></i></button>}
                          {o.status === 'pendente' && <button className="action-btn action-confirm" title="Editar" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-pen"></i></button>}
                          {o.status === 'pendente' && <button className="action-btn action-deliver" title="Em Rota (Próxima etapa)" onClick={() => { setShowRotaDue(o); setRotaDueDate(o.dataVencimento || '') }}><i className="fa-solid fa-truck"></i></button>}
                          {o.status === 'em-rota' && (
                            <button className="action-btn action-confirm" title="Concluir (Próxima etapa)" onClick={() => updateOrderStatus(o.id, 'entregue')}><i className="fa-solid fa-check-double"></i></button>
                          )}
                          {o.status === 'entregue' && !isFinalizada(o) && (
                            <button className="action-btn" style={{ color: '#f59e0b', borderColor: '#f59e0b' }} title="Voltar para Em Rota" onClick={() => updateOrderStatus(o.id, 'em-rota')}><i className="fa-solid fa-undo"></i></button>
                          )}
                          {o.status === 'entregue' && !isFinalizada(o) && (
                            <button className="action-btn action-confirm" style={{ background: '#6366f1', color: 'white', borderColor: '#6366f1' }} title="Avançar para Acerto" onClick={() => updateOrderStatus(o.id, 'acerto')}><i className="fa-solid fa-handshake"></i></button>
                          )}
                          {o.status === 'acerto' && !isFinalizada(o) && (
                            <button className="action-btn" style={{ color: '#f59e0b', borderColor: '#f59e0b' }} title="Voltar para Entregues" onClick={() => revertToEntregue(o.id)}><i className="fa-solid fa-undo"></i></button>
                          )}
                          {o.status === 'acerto' && !isFinalizada(o) && (
                            <button className="action-btn" style={{ color: '#3b82f6', borderColor: '#3b82f6' }} title="Editar Acerto" onClick={() => openAcertoModal(o, 'acerto')}><i className="fa-solid fa-pen-to-square"></i></button>
                          )}
                          {o.status === 'acerto' && !isFinalizada(o) && (
                            <button className="action-btn action-confirm" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} title="Finalizar Pedido" onClick={() => openAcertoModal(o, 'finalizar')}><i className="fa-solid fa-check-double"></i></button>
                          )}
                          {(o.status === 'concluido' || isFinalizada(o)) && (
                            <button className="action-btn" style={{ color: '#f59e0b', borderColor: '#f59e0b' }} title="Voltar para Acertos" onClick={() => revertOrderFinalization(o.id)}><i className="fa-solid fa-undo"></i></button>
                          )}
                          {(() => {
                            const e = o.customer?.endereco || {}
                            const parts = [e.rua, e.numero, e.bairro, e.cidade, e.estado, e.cep].filter(Boolean)
                            if (parts.length === 0) return null
                            const url = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(parts.join(', '))
                            return <button className="action-btn" style={{ color: '#ea4335', borderColor: '#ea4335' }} title="Abrir no Maps" onClick={() => window.open(url, '_blank')}><i className="fa-solid fa-location-dot"></i></button>
                          })()}
                          <button className="action-btn action-delete" title="Excluir" onClick={() => deleteOrder(o.id)}><i className="fa-solid fa-trash"></i></button>
                          <button className="action-btn" style={{ color: '#8b5cf6', borderColor: '#8b5cf6' }} title="Clonar" onClick={() => cloneOrder(o)}><i className="fa-solid fa-copy"></i></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {paginatedOrders.length === 0 && <tr><td colSpan="12" className="td-empty">Nenhum pedido encontrado</td></tr>}
                </tbody>
              </table>
            </div>

            {/* MOBILE CARDS VIEW (100% RESPONSIVE) */}
            <div className="admin-orders-mobile">
              {paginatedOrders.map(o => {
                const clientName = getOrderCustomerName(o)
                const clientPhone = getOrderCustomerPhone(o)
                const totalPieces = (Array.isArray(o.items) && o.items.length > 0 ? o.items : (Array.isArray(o.originalItems) && o.originalItems.length > 0 ? o.originalItems : (o.itens || []))).reduce((s, i) => s + (Number(i.qty) || 0), 0)
                const e = o.customer?.endereco || o.endereco || {}
                const cityState = [e.cidade, e.estado].filter(Boolean).join('/') || '-'
                const currentRota = e.rota !== undefined && e.rota !== null ? e.rota : ((normalizePhone(clientPhone) ? rotaDeTelefone[normalizePhone(clientPhone)] : '') || '')
                const addressParts = [e.rua, e.numero, e.bairro, e.cidade, e.estado, e.cep].filter(Boolean)
                const mapsUrl = addressParts.length > 0 ? ('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addressParts.join(', '))) : null

                return (
                  <div key={o.id} className={`admin-order-card ${selectedIds.has(o.id) ? 'selected' : ''}`}>
                    {/* Top Row: Checkbox, ID, Date, Status */}
                    <div className="aoc-header">
                      <div className="aoc-header-left">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(o.id)}
                          onChange={() => toggleSelect(o.id)}
                          className="aoc-checkbox"
                        />
                        <span className="aoc-id" onClick={() => setShowOrderDetail(o)} title="Ver detalhes do pedido">
                          #{String(o.id).slice(-6)}
                        </span>
                        <span className="aoc-date">
                          <i className="fa-regular fa-calendar"></i> {formatDate(o.date)}
                        </span>
                      </div>
                      <span className={`status-tag status-${o.status}`}>{o.status}</span>
                    </div>

                    {/* Customer Hero Section */}
                    <div className="aoc-client" onClick={() => setShowOrderDetail(o)}>
                      <div className="aoc-avatar">
                        <i className="fa-solid fa-user"></i>
                      </div>
                      <div className="aoc-client-main">
                        <div className="aoc-client-name" title={clientName}>
                          {clientName}
                        </div>
                        <div className="aoc-client-sub">
                          {clientPhone ? (
                            <button
                              type="button"
                              className="aoc-phone-pill"
                              onClick={(ev) => { ev.stopPropagation(); sendWhatsApp(o) }}
                              title="Enviar WhatsApp"
                            >
                              <i className="fa-brands fa-whatsapp"></i> {clientPhone}
                            </button>
                          ) : (
                            <span className="aoc-no-phone">Sem telefone</span>
                          )}
                          <span className="aoc-city">
                            <i className="fa-solid fa-location-dot"></i> {cityState}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Route & Due date */}
                    <div className="aoc-route-row">
                      <div className="aoc-route-col">
                        <span className="aoc-col-label"><i className="fa-solid fa-route"></i> Rota</span>
                        <select
                          value={currentRota}
                          onChange={ev => {
                            const val = ev.target.value
                            if (val === '__NEW__') {
                              const custom = prompt('Nome da nova rota:')
                              if (custom && custom.trim()) {
                                const trimmed = custom.trim()
                                setCustomRotas(prev => [...prev, { id: 'cr-' + Date.now(), rota: trimmed }])
                                updateOrderRota(o.id, trimmed)
                              }
                            } else {
                              updateOrderRota(o.id, val)
                            }
                          }}
                          className="aoc-select-rota"
                        >
                          <option value="">Sem Rota</option>
                          {listaTodasRotas.map(r => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                          <option value="__NEW__">+ Nova Rota...</option>
                        </select>
                      </div>
                      <div className="aoc-due-col">
                        <span className="aoc-col-label"><i className="fa-regular fa-clock"></i> Vencimento</span>
                        <input
                          type="date"
                          value={o.dataVencimento || ''}
                          placeholder="Definir"
                          onChange={ev => updateOrderDue(o.id, ev.target.value)}
                          className="aoc-date-due"
                        />
                      </div>
                    </div>

                    {/* Metrics row */}
                    <div className="aoc-metrics">
                      <div className="aoc-metric-box">
                        <span className="aoc-metric-label">Itens</span>
                        <span className="aoc-metric-val">{totalPieces} pçs</span>
                      </div>
                      <div className="aoc-metric-box">
                        <span className="aoc-metric-label">Pagamento</span>
                        <span className="aoc-metric-tag">{o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</span>
                      </div>
                      <div className="aoc-metric-box aoc-total-box">
                        <span className="aoc-metric-label">Total</span>
                        <span className="aoc-metric-price">{formatPreco(o.total)}</span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="aoc-actions">
                      <button
                        type="button"
                        className="aoc-btn aoc-btn-wa"
                        title="Conversar no WhatsApp"
                        onClick={(ev) => { ev.stopPropagation(); sendWhatsApp(o) }}
                      >
                        <i className="fa-brands fa-whatsapp"></i> WhatsApp
                      </button>

                      {o.status === 'pre-pedido' && (
                        <>
                          <button
                            type="button"
                            className="aoc-btn aoc-btn-primary"
                            title="Aprovar e enviar para Pendente"
                            onClick={(ev) => { ev.stopPropagation(); updateOrderStatus(o.id, 'pendente') }}
                          >
                            <i className="fa-solid fa-check"></i> Aprovar
                          </button>
                          <button
                            type="button"
                            className="aoc-btn aoc-btn-deliver"
                            title="Enviar direto para Em Rota"
                            onClick={(ev) => { ev.stopPropagation(); setShowRotaDue(o); setRotaDueDate(o.dataVencimento || '') }}
                          >
                            <i className="fa-solid fa-truck"></i> Em Rota
                          </button>
                        </>
                      )}

                      {o.status === 'pendente' && (
                        <button
                          type="button"
                          className="aoc-btn aoc-btn-primary"
                          title="Enviar para Em Rota"
                          onClick={(ev) => { ev.stopPropagation(); setShowRotaDue(o); setRotaDueDate(o.dataVencimento || '') }}
                        >
                          <i className="fa-solid fa-truck"></i> Em Rota
                        </button>
                      )}

                      {o.status === 'em-rota' && (
                        <>
                          <button
                            type="button"
                            className="aoc-btn aoc-btn-success"
                            title="Confirmar Entrega"
                            onClick={(ev) => { ev.stopPropagation(); updateOrderStatus(o.id, 'entregue') }}
                          >
                            <i className="fa-solid fa-check-double"></i> Entregue
                          </button>
                          <button
                            type="button"
                            className="aoc-btn aoc-btn-revert"
                            title="Voltar para Pendente"
                            onClick={(ev) => { ev.stopPropagation(); updateOrderStatus(o.id, 'pendente') }}
                          >
                            <i className="fa-solid fa-undo"></i> Voltar
                          </button>
                        </>
                      )}

                      {o.status === 'entregue' && !isFinalizada(o) && (
                        <>
                          <button
                            type="button"
                            className="aoc-btn aoc-btn-acerto"
                            title="Avançar para Acerto"
                            onClick={(ev) => { ev.stopPropagation(); updateOrderStatus(o.id, 'acerto') }}
                          >
                            <i className="fa-solid fa-handshake"></i> Acerto
                          </button>
                          <button
                            type="button"
                            className="aoc-btn aoc-btn-success"
                            title="Finalizar Pedido"
                            onClick={(ev) => { ev.stopPropagation(); openAcertoModal(o, 'finalizar') }}
                          >
                            <i className="fa-solid fa-check-double"></i> Finalizar
                          </button>
                          <button
                            type="button"
                            className="aoc-btn aoc-btn-revert"
                            title="Voltar para Em Rota"
                            onClick={(ev) => { ev.stopPropagation(); updateOrderStatus(o.id, 'em-rota') }}
                          >
                            <i className="fa-solid fa-undo"></i> Voltar Rota
                          </button>
                        </>
                      )}

                      {o.status === 'acerto' && !isFinalizada(o) && (
                        <>
                          <button
                            type="button"
                            className="aoc-btn aoc-btn-success"
                            title="Finalizar Pedido"
                            onClick={(ev) => { ev.stopPropagation(); openAcertoModal(o, 'finalizar') }}
                          >
                            <i className="fa-solid fa-check-double"></i> Finalizar
                          </button>
                          <button
                            type="button"
                            className="aoc-btn aoc-btn-primary"
                            title="Editar Acerto"
                            onClick={(ev) => { ev.stopPropagation(); openAcertoModal(o, 'acerto') }}
                          >
                            <i className="fa-solid fa-pen-to-square"></i> Editar
                          </button>
                          <button
                            type="button"
                            className="aoc-btn aoc-btn-revert"
                            title="Voltar para Entregues"
                            onClick={(ev) => { ev.stopPropagation(); revertToEntregue(o.id) }}
                          >
                            <i className="fa-solid fa-undo"></i> Voltar
                          </button>
                        </>
                      )}

                      {(o.status === 'concluido' || isFinalizada(o)) && (
                        <>
                          <button
                            type="button"
                            className="aoc-btn aoc-btn-acerto"
                            title="Ver Acerto e Devoluções"
                            onClick={(ev) => { ev.stopPropagation(); openAcertoModal(o, 'finalizar') }}
                          >
                            <i className="fa-solid fa-eye"></i> Ver Acerto
                          </button>
                          <button
                            type="button"
                            className="aoc-btn aoc-btn-revert"
                            title="Voltar para Acertos"
                            onClick={(ev) => { ev.stopPropagation(); revertOrderFinalization(o.id) }}
                          >
                            <i className="fa-solid fa-undo"></i> Voltar Acerto
                          </button>
                        </>
                      )}

                      {o.status === 'cancelado' && (
                        <button
                          type="button"
                          className="aoc-btn aoc-btn-primary"
                          title="Reativar Pedido"
                          onClick={(ev) => { ev.stopPropagation(); updateOrderStatus(o.id, 'pendente') }}
                        >
                          <i className="fa-solid fa-rotate-left"></i> Reativar
                        </button>
                      )}

                      <button
                        type="button"
                        className="aoc-btn aoc-btn-sec"
                        onClick={(ev) => { ev.stopPropagation(); setShowOrderDetail(o) }}
                        title="Ver detalhes da comanda"
                      >
                        <i className="fa-solid fa-eye"></i> Detalhes
                      </button>

                      {mapsUrl && (
                        <button
                          type="button"
                          className="aoc-btn aoc-btn-icon"
                          title="Abrir no Google Maps"
                          onClick={(ev) => { ev.stopPropagation(); window.open(mapsUrl, '_blank') }}
                        >
                          <i className="fa-solid fa-location-dot" style={{ color: '#ea4335' }}></i>
                        </button>
                      )}

                      <button
                        type="button"
                        className="aoc-btn aoc-btn-icon"
                        title="Clonar pedido"
                        onClick={(ev) => { ev.stopPropagation(); cloneOrder(o) }}
                      >
                        <i className="fa-solid fa-copy" style={{ color: '#8b5cf6' }}></i>
                      </button>

                      <button
                        type="button"
                        className="aoc-btn aoc-btn-icon aoc-btn-del"
                        title="Excluir pedido"
                        onClick={(ev) => { ev.stopPropagation(); deleteOrder(o.id) }}
                      >
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  </div>
                )
              })}

              {paginatedOrders.length === 0 && (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', background: 'white', borderRadius: '12px', border: '1px solid var(--admin-border)' }}>
                  <i className="fa-solid fa-box-open" style={{ fontSize: '2rem', color: '#94a3b8', marginBottom: '0.5rem', display: 'block' }}></i>
                  <p style={{ fontWeight: 700, color: 'var(--admin-text)', margin: '0 0 0.25rem' }}>Nenhum pedido encontrado</p>
                  {orderSearch && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', margin: '0 0 0.75rem' }}>Nenhum resultado para "{orderSearch}".</p>
                  )}
                  {orderSearch && (
                    <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }} onClick={() => setOrderSearch('')}>
                      <i className="fa-solid fa-xmark"></i> Limpar busca
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* MOBILE FLOATING BULK BAR */}
            {selectedIds.size > 0 && (
              <div className="admin-orders-mobile-bulk-bar">
                <div className="aombb-info">
                  <strong>{selectedIds.size}</strong> selecionado(s)
                </div>
                <div className="aombb-actions">
                  <button className="admin-btn" style={{ background: '#0284c7', color: 'white', borderColor: '#0284c7', fontSize: '0.74rem', padding: '0.35rem 0.55rem' }} onClick={() => setShowOrderReportModal(true)} title="Relatório">
                    <i className="fa-solid fa-file-pdf"></i>
                  </button>
                  <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)', fontSize: '0.74rem', padding: '0.35rem 0.55rem' }} onClick={() => bulkAction('confirm')}>
                    <i className="fa-solid fa-check"></i>
                  </button>
                  <button className="admin-btn" style={{ background: 'var(--danger)', color: 'white', borderColor: 'var(--danger)', fontSize: '0.74rem', padding: '0.35rem 0.55rem' }} onClick={() => bulkAction('delete')}>
                    <i className="fa-solid fa-trash"></i>
                  </button>
                  <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.74rem', padding: '0.35rem 0.45rem' }} onClick={() => setSelectedIds(new Set())}>
                    <i className="fa-solid fa-xmark"></i>
                  </button>
                </div>
              </div>
            )}

            {totalOrderPages > 1 && (
              <div className="admin-pagination" style={{ marginTop: '0.75rem' }}>
                <button disabled={orderPage === 1} onClick={() => setOrderPage(p => p - 1)}><i className="fa-solid fa-chevron-left"></i></button>
                <span>{orderPage} de {totalOrderPages}</span>
                <button disabled={orderPage === totalOrderPages} onClick={() => setOrderPage(p => p + 1)}><i className="fa-solid fa-chevron-right"></i></button>
              </div>
            )}
          </div>
        )}

        {/* PRODUTOS */}
        {tab === 'produtos' && (
          <div className="admin-section">
            <div className="admin-header-row">
              <div>
                <h1>Produtos</h1>
                <p className="admin-subtitle">{produtosAtuais.length} produtos cadastrados</p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button className="admin-btn" style={{ background: '#2563eb', color: 'white', borderColor: '#2563eb', fontSize: '0.78rem', padding: '0.35rem 0.7rem' }} onClick={() => setEditingProd({ id: Math.floor(Math.random() * 1000000000), nome: '', preco: 0, estoque: 0, imagem: '', categoria: '', descricao: '', variantes: {}, _new: true })}>
                  <i className="fa-solid fa-plus"></i> Novo Produto
                </button>
                <button className="admin-btn" style={{ background: '#059669', color: 'white', borderColor: '#059669', fontSize: '0.78rem', padding: '0.35rem 0.7rem' }} onClick={() => { setEditingKit(null); setShowKitModal(true) }}>
                  <i className="fa-solid fa-toolbox"></i> Montar Kit
                </button>
                {prodCartCount > 0 && (
                  <button className="admin-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6', position: 'relative' }} onClick={() => setProdCartOpen(true)}>
                    <i className="fa-solid fa-shopping-cart"></i> Carrinho
                    <span style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#dc2626', color: 'white', borderRadius: '50%', width: '18px', height: '18px', fontSize: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{prodCartCount}</span>
                  </button>
                )}
                <div style={{ display: 'flex', gap: '0.25rem', background: '#e5e7eb', borderRadius: '8px', padding: '2px' }}>
                  <button className={`admin-btn ${prodViewMode === 'visual' ? 'admin-btn-primary' : 'admin-btn-sec'}`} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', border: 'none' }} onClick={() => setProdViewMode('visual')}>
                    <i className="fa-solid fa-th"></i>
                  </button>
                  <button className={`admin-btn ${prodViewMode === 'tabela' ? 'admin-btn-primary' : 'admin-btn-sec'}`} style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', border: 'none' }} onClick={() => setProdViewMode('tabela')}>
                    <i className="fa-solid fa-list"></i>
                  </button>
                </div>
              </div>
            </div>

            {/* Search + Filter bar */}
            <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="admin-search-prod" style={{ flex: '1', minWidth: '180px' }}>
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar produto..." value={prodSearch} onChange={e => setProdSearch(e.target.value)} style={{ width: '100%' }} />
              </div>
              <select value={prodCatFilter} onChange={e => {
                if (e.target.value === '__nova__') {
                  const nome = prompt('Nome da nova categoria:')
                  if (nome && nome.trim()) {
                    const cat = nome.trim()
                    setCustomCategorias(prev => prev.includes(cat) ? prev : [...prev, cat])
                    setProdCatFilter(cat)
                    showToast(`Categoria "${cat}" criada!`)
                  }
                  return
                }
                setProdCatFilter(e.target.value)
              }} style={{ padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', background: 'white', cursor: 'pointer' }}>
                <option value="Encomendas da Empresa">Encomendas da Empresa</option>
                {categoriasProd.filter(c => c !== 'TODOS').map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__nova__">＋ Nova categoria...</option>
              </select>
              <select value={prodStockFilter} onChange={e => setProdStockFilter(e.target.value)} style={{ padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', background: 'white', cursor: 'pointer' }}>
                <option value="todos">Todos os estoques</option>
                <option value="in">Em estoque</option>
                <option value="out">Indisponível</option>
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>
                <span>Preço:</span>
                <input type="number" min="0" step="1" value={prodPriceRange[0]} onChange={e => setProdPriceRange([Number(e.target.value) || 0, prodPriceRange[1]])} style={{ width: '65px', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem' }} placeholder="Min" />
                <span>—</span>
                <input type="number" min="0" step="1" value={prodPriceRange[1]} onChange={e => setProdPriceRange([prodPriceRange[0], Number(e.target.value) || 5000])} style={{ width: '65px', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem' }} placeholder="Max" />
              </div>
            </div>

            {/* Bulk actions bar */}
            {prodSelectedIds.size > 0 && (
              <div style={{ marginBottom: '0.65rem', padding: '0.5rem 0.75rem', background: 'rgba(37,99,235,0.05)', borderRadius: '8px', border: '1px solid rgba(37,99,235,0.15)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent)' }}>{prodSelectedIds.size} selecionado(s)</span>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: '#dc2626', color: 'white', borderColor: '#dc2626' }} onClick={() => bulkProdAction('zerar')}>
                  <i className="fa-solid fa-ban"></i> Zerar Estoque
                </button>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} onClick={() => bulkProdAction('ocultar')}>
                  <i className="fa-solid fa-eye-slash"></i> Indisponível
                </button>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }} onClick={() => bulkProdAction('preco')}>
                  <i className="fa-solid fa-dollar-sign"></i> Trocar Preço
                </button>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: '#10b981', color: 'white', borderColor: '#10b981' }} onClick={() => bulkProdAction('estoque')}>
                  <i className="fa-solid fa-warehouse"></i> Definir Estoque
                </button>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: '#dc2626', color: 'white', borderColor: '#dc2626' }} onClick={() => bulkProdAction('semdev')}>
                  <i className="fa-solid fa-ban"></i> Sem Devolução
                </button>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', background: '#000', color: 'white', borderColor: '#000' }} onClick={() => deleteSelectedProducts(prodSelectedIds)}>
                  <i className="fa-solid fa-trash"></i> Excluir
                </button>
                <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={() => setProdSelectedIds(new Set())}>
                  <i className="fa-solid fa-xmark"></i> Limpar
                </button>
              </div>
            )}

            {/* Visual Grid View */}
            {prodViewMode === 'visual' && (
              <>
                <div className="admin-prod-grid">
                  {paginatedProds.map((p, i) => (
                    <div key={p.id} className={`admin-prod-card ${prodSelectedIds.has(p.id) ? 'selected' : ''}`} style={{ animationDelay: `${i * 25}ms` }}>
                      <div className="admin-prod-card-check">
                        <input type="checkbox" checked={prodSelectedIds.has(p.id)} onChange={() => toggleProdSelect(p.id)} />
                      </div>
                      <div className="admin-prod-card-img" onClick={() => setEditingProd(p)}>
                        {p.imagem && !prodImageErrors[p.id] ? (
                          <img src={formatImageUrl(p.imagem)} alt={p.nome} loading="lazy" onError={() => toggleProdImageError(p.id)} />
                        ) : (
                          <div className="admin-prod-card-img-fallback"><i className="fa-solid fa-image"></i></div>
                        )}
                        <div className="admin-prod-card-badges">
                          {p.estoque <= 0 ? <span className="admin-badge out">Indisponível</span>
                            : p.estoque <= 5 ? <span className="admin-badge low">Últimas {p.estoque}</span>
                              : <span className="admin-badge in">Disponível</span>}
                          {p.semDevolucao && <span className="admin-badge nodev">SEM DEVOLUÇÃO</span>}
                        </div>
                        <div className="admin-prod-card-cat">{p.categoria}</div>
                      </div>
                      <div className="admin-prod-card-body">
                        <h3 className="admin-prod-card-title" onClick={() => setEditingProd(p)}>{p.nome}</h3>
                        <div className="admin-prod-card-price">{formatPreco(p.preco)}</div>
                        {p.preco_custo != null && <div className="admin-prod-card-custo" style={{ fontSize: '0.72rem', color: 'var(--admin-text-sec)', marginTop: '0.15rem' }}>Custo: {formatPreco(p.preco_custo)}</div>}
                        {prodCart[p.id] ? (
                          <div className="admin-cart-item-qty" style={{ justifyContent: 'center' }}>
                            <button className="qty-btn-sm" onClick={() => removeFromProdCart(p.id)}><i className="fa-solid fa-minus"></i></button>
                            <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{prodCart[p.id].qty}</span>
                            <button className="qty-btn-sm" onClick={() => addToProdCart(p)} disabled={p.estoque <= 0}><i className="fa-solid fa-plus"></i></button>
                          </div>
                        ) : (
                          <button className={`admin-prod-card-btn ${prodCart[p.id] ? 'in-cart' : ''}`} onClick={() => addToProdCart(p)} disabled={p.estoque <= 0}>
                            <i className="fa-solid fa-plus"></i> Adicionar
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {paginatedProds.length === 0 && (
                    <div className="admin-prod-empty">
                      <i className="fa-solid fa-box-open"></i>
                      <h3>Nenhum produto encontrado</h3>
                      <p>Tente ajustar os filtros</p>
                    </div>
                  )}
                </div>

                {totalProdPages > 1 && (
                  <div className="admin-pagination">
                    <button disabled={prodPage === 1} onClick={() => setProdPage(p => p - 1)}><i className="fa-solid fa-chevron-left"></i></button>
                    <span>{prodPage} de {totalProdPages}</span>
                    <button disabled={prodPage === totalProdPages} onClick={() => setProdPage(p => p + 1)}><i className="fa-solid fa-chevron-right"></i></button>
                  </div>
                )}
              </>
            )}

            {/* Table View */}
            {prodViewMode === 'tabela' && (
              <>
                <div className="admin-table-wrap">
                  <table className="admin-table table-prod">
                    <thead>
                      <tr>
                        <th style={{ width: '36px' }}>
                          <input type="checkbox" checked={filteredProds.length > 0 && prodSelectedIds.size === filteredProds.length} onChange={toggleProdSelectAll} style={{ cursor: 'pointer', width: '15px', height: '15px' }} title={prodSelectedIds.size === filteredProds.length ? 'Desmarcar todos' : `Selecionar todos (${filteredProds.length} produtos)`} />
                        </th>
                        <th style={{ width: '50px' }}>Foto</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => toggleProdSort('nome')}>Produto {prodSortIcon('nome')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => toggleProdSort('categoria')}>Categoria {prodSortIcon('categoria')}</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => toggleProdSort('preco')}>Preço {prodSortIcon('preco')}</th>
                        <th style={{ cursor: 'pointer' }}>Custo</th>
                        <th style={{ cursor: 'pointer' }} onClick={() => toggleProdSort('estoque')}>Estoque {prodSortIcon('estoque')}</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedProds.map(p => (
                        <tr key={p.id} className={prodSelectedIds.has(p.id) ? 'row-selected' : ''}>
                          <td>
                            <input type="checkbox" checked={prodSelectedIds.has(p.id)} onChange={() => toggleProdSelect(p.id)} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                          </td>
                          <td>
                            <div className="prod-thumb">
                              {p.imagem ? <img src={formatImageUrl(p.imagem)} alt={p.nome} /> : <i className="fa-solid fa-image"></i>}
                            </div>
                          </td>
                          <td className="td-prod-name">{p.nome}{p.semDevolucao && <span className="prod-nodev-tag">SEM DEVOLUÇÃO</span>}</td>
                          <td><span className="cat-tag">{p.categoria}</span></td>
                          <td className="td-price">{formatPreco(p.preco)}</td>
                          <td className="td-price" style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>{p.preco_custo ? formatPreco(p.preco_custo) : '-'}</td>
                          <td>
                            <span className={`stock-tag ${p.estoque > 0 ? 'in' : 'out'}`}>
                              {p.estoque > 0 ? `${p.estoque} un` : 'Indisponível'}
                            </span>
                          </td>
                          <td>
                            <div className="td-actions">
                              <button className="action-btn action-green" title="Editar" onClick={() => setEditingProd(p)}>
                                <i className="fa-solid fa-pen"></i>
                              </button>
                              <button className="action-btn" title="Zerar estoque" onClick={() => { if (confirm(`Zerar estoque de "${p.nome}"?`)) updateProduct(p.id, { estoque: 0 }) }}>
                                <i className="fa-solid fa-ban" style={{ color: '#dc2626' }}></i>
                              </button>
                              <button className="action-btn" title="Alternar disponibilidade" onClick={() => updateProduct(p.id, { estoque: p.estoque > 0 ? 0 : 1 })}>
                                <i className={`fa-solid ${p.estoque > 0 ? 'fa-eye-slash' : 'fa-eye'}`} style={{ color: p.estoque > 0 ? '#f59e0b' : 'var(--success)' }}></i>
                              </button>
                              <button className="action-btn" title="Excluir" onClick={() => deleteSelectedProducts([p.id])}>
                                <i className="fa-solid fa-trash" style={{ color: '#dc2626' }}></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {paginatedProds.length === 0 && <tr><td colSpan="8" className="td-empty">Nenhum produto encontrado</td></tr>}
                    </tbody>
                  </table>
                </div>

                {totalProdPages > 1 && (
                  <div className="admin-pagination">
                    <button disabled={prodPage === 1} onClick={() => setProdPage(p => p - 1)}><i className="fa-solid fa-chevron-left"></i></button>
                    <span>{prodPage} de {totalProdPages}</span>
                    <button disabled={prodPage === totalProdPages} onClick={() => setProdPage(p => p + 1)}><i className="fa-solid fa-chevron-right"></i></button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* CART DRAWER */}
        {prodCartOpen && (
          <div className="admin-overlay" onClick={() => setProdCartOpen(false)}>
            <div className="admin-cart-drawer" onClick={e => e.stopPropagation()}>
              <div className="admin-cart-header">
                <h3><i className="fa-solid fa-shopping-cart"></i> Carrinho</h3>
                <button className="admin-modal-close" onClick={() => setProdCartOpen(false)}><i className="fa-solid fa-xmark"></i></button>
              </div>
              <div className="admin-cart-body">
                {prodCartItems.length === 0 ? (
                  <div className="admin-cart-empty">
                    <i className="fa-solid fa-cart-plus"></i>
                    <p>Carrinho vazio</p>
                    <p style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>Adicione produtos do catálogo</p>
                  </div>
                ) : (
                  <>
                    {prodCartItems.map(item => (
                      <div key={item.id} className="admin-cart-item">
                        <div className="admin-cart-item-img">
                          {item.imagem ? <img src={formatImageUrl(item.imagem)} alt={item.nome} /> : <i className="fa-solid fa-image"></i>}
                        </div>
                        <div className="admin-cart-item-info">
                          <span className="admin-cart-item-name">{item.nome}</span>
                          <span className="admin-cart-item-price">{formatPreco(item.preco)}</span>
                        </div>
                        <div className="admin-cart-item-qty">
                          <button className="qty-btn-sm" onClick={() => removeFromProdCart(item.id)}><i className="fa-solid fa-minus"></i></button>
                          <span>{item.qty}</span>
                          <button className="qty-btn-sm" onClick={() => addToProdCart({ id: item.id, nome: item.nome, preco: item.preco, imagem: item.imagem })}><i className="fa-solid fa-plus"></i></button>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
              {prodCartItems.length > 0 && (
                <div className="admin-cart-footer">
                  <div className="admin-cart-total">
                    <span>Total:</span>
                    <strong>{formatPreco(prodCartTotal)}</strong>
                  </div>
                  <div className="admin-cart-actions">
                    <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.78rem' }} onClick={clearProdCart}>
                      <i className="fa-solid fa-trash"></i> Limpar
                    </button>
                    <button className="admin-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6', fontSize: '0.78rem' }} onClick={() => { setProdCartOpen(false); createOrderFromCart() }}>
                      <i className="fa-solid fa-file-invoice"></i> Criar Pedido
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* FINANCEIRO */}
        {/* USUÁRIOS */}
        {tab === 'usuarios' && (
          <div className="admin-section">
            {selectedUserDetail ? (
              <>
                <div className="admin-header-row">
                  <div>
                    <button className="admin-btn admin-btn-sec" onClick={() => setSelectedUserDetail(null)} style={{ marginBottom: '0.5rem', fontSize: '0.78rem' }}>
                      <i className="fa-solid fa-arrow-left"></i> Voltar
                    </button>
                    <h1>{selectedUserDetail.nome}</h1>
                    <p className="admin-subtitle">{selectedUserDetail.telefone} &middot; {selectedUserDetail.email || 'sem email'}</p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {!editingUser && (
                      <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }}
                        onClick={() => { setPreselectedUserForOrder(selectedUserDetail); setShowAddOrder(true) }}>
                        <i className="fa-solid fa-plus"></i> Novo Pedido
                      </button>
                    )}
                    {!editingUser && (
                      <button className="admin-btn" style={{ background: '#25d366', color: 'white', borderColor: '#25d366' }}
                        onClick={() => {
                          const u = selectedUserDetail
                          const phone = (u.telefone || '').replace(/\D/g, '')
                          if (phone) {
                            const nome = u.nome || 'Cliente'
                            const msg = `🚚 *PASSANDO NA SUA CIDADE!* 🚚\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nEstamos passando na sua cidade! Aproveite para fazer seu pedido.\n🔗 Faça já seu pedido: ${window.location.origin}${window.location.pathname}`
                            window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`, '_blank')
                          } else {
                            showToast('Usuário sem telefone', 'error')
                          }
                        }}>
                        <i className="fa-brands fa-whatsapp"></i> WhatsApp
                      </button>
                    )}
                    {!editingUser && (
                      <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }}
                        onClick={() => gerarLinkRecuperacao(selectedUserDetail)}>
                        <i className="fa-solid fa-key"></i> Recuperar Senha
                      </button>
                    )}
                    {!editingUser && (
                      <button className="admin-btn" style={{ background: 'var(--danger)', color: 'white', borderColor: 'var(--danger)' }}
                        onClick={() => handleDeleteUser(selectedUserDetail)}>
                        <i className="fa-solid fa-trash-can"></i> Excluir
                      </button>
                    )}
                    <button className="admin-btn" style={{ background: editingUser ? 'var(--success)' : 'var(--accent)', color: 'white', borderColor: editingUser ? 'var(--success)' : 'var(--accent)' }}
                      onClick={editingUser ? saveUserEdit : () => { 
                        setEditingUser(true); 
                        setEditUserData({ 
                          ...selectedUserDetail, 
                          endereco: { 
                            ...(selectedUserDetail?.endereco || {}), 
                            limitePreco: selectedUserDetail?.endereco?.limitePreco != null ? String(selectedUserDetail.endereco.limitePreco).replace('.', ',') : '' 
                          } 
                        }) 
                      }}>
                      <i className={`fa-solid ${editingUser ? 'fa-check' : 'fa-pen'}`}></i> {editingUser ? 'Salvar' : 'Editar'}
                    </button>
                  </div>
                </div>

                {/* Info Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
                  <div className="admin-card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid var(--accent)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'var(--accent-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontSize: '1.1rem' }}>
                        <i className="fa-solid fa-user"></i>
                      </div>
                      <div>
                        {editingUser ? (
                          <input type="text" value={editUserData.nome} onChange={e => setEditUserData(p => ({ ...p, nome: e.target.value }))}
                            style={{ fontWeight: 700, fontSize: '0.95rem', border: '1px solid var(--admin-border)', borderRadius: '6px', padding: '0.25rem 0.5rem', width: '100%' }} />
                        ) : (
                          <strong style={{ fontSize: '0.95rem' }}>{selectedUserDetail.nome}</strong>
                        )}
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Nome</span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid #06b6d4' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#ecfeff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#06b6d4', fontSize: '1.1rem' }}>
                        <i className="fa-solid fa-phone"></i>
                      </div>
                      <div>
                        {editingUser ? (
                          <input type="text" value={editUserData.telefone} onChange={e => setEditUserData(p => ({ ...p, telefone: e.target.value }))}
                            style={{ fontWeight: 700, fontSize: '0.95rem', border: '1px solid var(--admin-border)', borderRadius: '6px', padding: '0.25rem 0.5rem', width: '100%' }} />
                        ) : (
                          <strong style={{ fontSize: '0.95rem' }}>{selectedUserDetail.telefone}</strong>
                        )}
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Telefone</span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid #8b5cf6' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#f5f3ff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6', fontSize: '1.1rem' }}>
                        <i className="fa-solid fa-envelope"></i>
                      </div>
                      <div>
                        {editingUser ? (
                          <input type="email" value={editUserData.email} onChange={e => setEditUserData(p => ({ ...p, email: e.target.value }))}
                            style={{ fontWeight: 700, fontSize: '0.95rem', border: '1px solid var(--admin-border)', borderRadius: '6px', padding: '0.25rem 0.5rem', width: '100%' }} />
                        ) : (
                          <strong style={{ fontSize: '0.95rem' }}>{selectedUserDetail.email || '-'}</strong>
                        )}
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Email</span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid #dc2626' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626', fontSize: '1.1rem' }}>
                        <i className="fa-solid fa-id-card"></i>
                      </div>
                      <div>
                        {editingUser ? (
                          <input type="text" value={editUserData.endereco?.cpf || ''} onChange={e => setEditUserData(p => ({ ...p, endereco: { ...(p.endereco || {}), cpf: e.target.value } }))}
                            style={{ fontWeight: 700, fontSize: '0.95rem', border: '1px solid var(--admin-border)', borderRadius: '6px', padding: '0.25rem 0.5rem', width: '100%' }} placeholder="000.000.000-00" />
                        ) : (
                          <strong style={{ fontSize: '0.95rem' }}>{selectedUserDetail.endereco?.cpf || '-'}</strong>
                        )}
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>CPF</span>
                      </div>
                    </div>
                  </div>
                  <div className="admin-card" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid #f59e0b' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: '#fffbeb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b', fontSize: '1.1rem' }}>
                        <i className="fa-solid fa-calendar"></i>
                      </div>
                      <div>
                        <strong style={{ fontSize: '0.95rem' }}>{formatDate(selectedUserDetail.created_at ? new Date(selectedUserDetail.created_at).toISOString().split('T')[0] : '')}</strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Cadastro</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Password Card */}
                <div style={{ background: '#f9fafb', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.25rem', border: '1px solid var(--admin-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <h4 style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <i className="fa-solid fa-lock" style={{ color: 'var(--admin-text-sec)' }}></i> Senha
                    </h4>
                  </div>
                  {editingUser ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input type="text" placeholder="Nova senha" value={editUserData.senha || ''} onChange={e => setEditUserData(p => ({ ...p, senha: e.target.value }))}
                        style={{ flex: 1, padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.85rem' }} />
                      <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Deixe vazio para manter</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                      <p style={{ fontSize: '0.82rem', color: 'var(--admin-text-sec)', margin: 0 }}>
                        {selectedUserDetail.endereco?.senha ? '••••••••' : 'Nenhuma senha definida'}
                      </p>
                      <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.4rem 0.75rem', background: '#f59e0b', color: 'white', borderColor: '#f59e0b', whiteSpace: 'nowrap' }}
                        onClick={() => { setPwTarget(selectedUserDetail); setPwNew('') }}>
                        <i className="fa-solid fa-key"></i> Mudar Senha
                      </button>
                    </div>
                  )}
                </div>

                {/* Nível e Limites Card */}
                <div style={{ background: '#f9fafb', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.25rem', border: '1px solid var(--admin-border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <h4 style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      <i className="fa-solid fa-star" style={{ color: '#f59e0b' }}></i> Nível do Cliente
                    </h4>
                  </div>
                  {editingUser ? (
                    <select value={editUserData.endereco?.nivel || ''} onChange={e => setEditUserData(p => ({ ...p, endereco: { ...(p.endereco || {}), nivel: e.target.value } }))}
                      style={{ width: '100%', padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.85rem' }}>
                      <option value="">Selecionar nível...</option>
                      <option value="primeiro-comprador">Primeiro Comprador</option>
                      <option value="comprador-antigo">Comprador Antigo</option>
                    </select>
                  ) : (
                    <p style={{ fontSize: '0.82rem' }}>
                      {selectedUserDetail.endereco?.nivel === 'primeiro-comprador' ? <><span style={{ color: '#10b981', fontWeight: 600 }}>●</span> Primeiro Comprador</> :
                        selectedUserDetail.endereco?.nivel === 'comprador-antigo' ? <><span style={{ color: '#8b5cf6', fontWeight: 600 }}>●</span> Comprador Antigo</> :
                          <span style={{ color: 'var(--admin-text-sec)' }}>Nenhum nível definido</span>}
                    </p>
                  )}
                  <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--admin-border)', paddingTop: '0.75rem' }}>
                    <h4 style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                      <i className="fa-solid fa-gavel" style={{ color: '#dc2626' }}></i> Limites
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', display: 'block', marginBottom: '0.2rem' }}>Limite de Pedidos</span>
                        {editingUser ? (
                          <input type="number" min="0" placeholder="Sem limite" value={editUserData.endereco?.limitePedidos ?? ''} onChange={e => setEditUserData(p => ({ ...p, endereco: { ...(p.endereco || {}), limitePedidos: e.target.value === '' ? null : Number(e.target.value) } }))}
                            style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem' }} />
                        ) : (
                          <strong style={{ fontSize: '0.95rem' }}>{selectedUserDetail.endereco?.limitePedidos ?? '—'}</strong>
                        )}
                      </div>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', display: 'block', marginBottom: '0.2rem' }}>Limite de Preço (R$)</span>
                        {editingUser ? (
                          <input type="text" inputMode="decimal" placeholder="Sem limite" value={editUserData.endereco?.limitePreco ?? ''} onChange={e => {
                            const clean = cleanDecimalInput(e.target.value)
                            setEditUserData(p => ({ ...p, endereco: { ...(p.endereco || {}), limitePreco: clean } }))
                          }}
                            style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem' }} />
                        ) : (
                          <strong style={{ fontSize: '0.95rem' }}>{selectedUserDetail.endereco?.limitePreco ? formatPreco(selectedUserDetail.endereco.limitePreco) : '—'}</strong>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Address Card */}
                <div style={{ background: '#f9fafb', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.25rem', border: '1px solid var(--admin-border)' }}>
                  <h4 style={{ fontSize: '0.85rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <i className="fa-solid fa-location-dot"></i> Endereço
                    {(() => {
                      const ec = selectedUserDetail.endereco || {}
                      const addr = buildAddressString(ec)
                      return addr ? <button className="action-btn" style={{ marginLeft: 'auto', color: '#2563eb' }} title="Ver no Google Maps" onClick={() => openGoogleMaps(addr)}><i className="fa-solid fa-location-dot"></i></button> : null
                    })()}
                  </h4>
                  {editingUser ? (
                    <AddressForm value={editUserData.endereco || {}} onChange={(a) => setEditUserData(p => ({ ...p, endereco: a }))} />
                  ) : (
                    (() => {
                      const e = selectedUserDetail.endereco || {}
                      const hasAddr = e.cep || e.rua || e.bairro || e.cidade || e.estado || e.rota
                      if (!hasAddr) return <p style={{ fontSize: '0.82rem', color: 'var(--admin-text-sec)' }}>Nenhum endereço cadastrado</p>
                      return (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.6rem', fontSize: '0.85rem' }}>
                          {e.cep && <div><span style={{ color: 'var(--admin-text-sec)', display: 'block', fontSize: '0.72rem' }}>CEP</span><strong>{e.cep}</strong></div>}
                          {e.rua && <div><span style={{ color: 'var(--admin-text-sec)', display: 'block', fontSize: '0.72rem' }}>Logradouro</span><strong>{e.rua}{e.numero ? `, ${e.numero}` : ''}</strong></div>}
                          {e.bairro && <div><span style={{ color: 'var(--admin-text-sec)', display: 'block', fontSize: '0.72rem' }}>Bairro</span><strong>{e.bairro}</strong></div>}
                          {e.cidade && <div><span style={{ color: 'var(--admin-text-sec)', display: 'block', fontSize: '0.72rem' }}>Cidade</span><strong>{e.cidade}{e.estado ? ` / ${e.estado}` : ''}</strong></div>}
                          {e.complemento && <div><span style={{ color: 'var(--admin-text-sec)', display: 'block', fontSize: '0.72rem' }}>Complemento</span><strong>{e.complemento}</strong></div>}
                          {e.rota && <div><span style={{ color: 'var(--admin-text-sec)', display: 'block', fontSize: '0.72rem' }}>Rota</span><strong style={{ color: '#8b5cf6' }}>{e.rota}</strong></div>}
                        </div>
                      )
                    })()
                  )}
                </div>

                {/* Stats Cards */}
                {(() => {
                  const totalPedidos = userOrdersDetail.length
                  const totalGasto = userOrdersDetail.reduce((s, o) => s + o.total, 0)
                  const ultimoPedido = userOrdersDetail.length > 0 ? userOrdersDetail.sort((a, b) => getOrderTime(b) - getOrderTime(a))[0] : null
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem', marginBottom: '1.25rem' }}>
                      <div className="admin-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid var(--accent)', textAlign: 'center' }}>
                        <strong style={{ fontSize: '1.2rem', color: 'var(--accent)' }}>{totalPedidos}</strong>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Pedidos</span>
                      </div>
                      <div className="admin-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid var(--success)', textAlign: 'center' }}>
                        <strong style={{ fontSize: '1.2rem', color: 'var(--success)' }}>{formatPreco(totalGasto)}</strong>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Total Gasto</span>
                      </div>
                      <div className="admin-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid #8b5cf6', textAlign: 'center' }}>
                        <strong style={{ fontSize: '1.2rem', color: '#8b5cf6' }}>{ultimoPedido ? formatDate(ultimoPedido.date) : '-'}</strong>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Último Pedido</span>
                      </div>
                      <div className="admin-card" style={{ padding: '0.85rem 1rem', borderLeft: '4px solid #f59e0b', textAlign: 'center' }}>
                        <strong style={{ fontSize: '1.2rem', color: '#f59e0b' }}>
                          {(() => {
                            const pend = userOrdersDetail.filter(o => o.status === 'pendente' || o.status === 'pre-pedido').length
                            return pend || '0'
                          })()}
                        </strong>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Pendentes</span>
                      </div>
                    </div>
                  )
                })()}

                {/* Orders from this user */}
                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <i className="fa-solid fa-clipboard-list"></i> Pedidos
                  <span className="cat-tag">{userOrdersDetail.length} pedidos</span>
                  {userOrdersDetail.length > 0 && <span style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>— {formatPreco(userOrdersDetail.reduce((s, o) => s + o.total, 0))}</span>}
                </h3>

                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Data</th>
                        <th>Itens</th>
                        <th>Total</th>
                        <th>Pagamento</th>
                        <th>Status</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userOrdersDetail.map(o => (
                        <tr key={o.id}>
                          <td>#{o.id.toString().slice(-6)}</td>
                          <td>{formatDate(o.date)}</td>
                          <td>{o.items.reduce((s, i) => s + i.qty, 0)} itens</td>
                          <td className="td-price">{formatPreco(o.total)}</td>
                          <td>{o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</td>
                          <td><span className={`status-tag status-${o.status}`}>{STATUS_LABELS[o.status] || o.status}</span></td>
                          <td>
                            <div className="td-actions">
                              <button className="action-btn" title="Ver pedido" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-eye"></i></button>
                              <button className="action-btn action-delete" title="Excluir" onClick={() => { if (confirm(`Excluir pedido #${o.id}?`)) deleteOrder(o.id) }}><i className="fa-solid fa-trash"></i></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {userOrdersDetail.length === 0 && <tr><td colSpan="7" className="td-empty">Nenhum pedido deste usuário</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <div className="admin-header-row">
                  <div>
                    <h1>Usuários</h1>
                    <p className="admin-subtitle">{usuarios.length} usuários cadastrados</p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.78rem', padding: '0.4rem 0.7rem' }}
                      onClick={() => { setSyncingUsers(true); syncAllForAdmin().then(({ users: u }) => { LS.set('thsm_usuarios', u); setUsuarios(u) }).catch(e => console.error('sync error:', e)).finally(() => setSyncingUsers(false)) }}>
                      <i className={`fa-solid ${syncingUsers ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i> {syncingUsers ? 'Sincronizando' : 'Sincronizar'}
                    </button>
                    <button className="admin-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6', fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                      onClick={gerarSenhasUsuarios}>
                      <i className="fa-solid fa-key"></i> Gerar Senhas
                    </button>
                    <button className="admin-btn" style={{ background: '#dc2626', color: 'white', borderColor: '#dc2626', fontSize: '0.82rem', padding: '0.45rem 0.85rem' }}
                      onClick={definirSenhasTodos}>
                      <i className="fa-solid fa-lock"></i> Senha = 1234
                    </button>
                  </div>
                </div>

                {selectedUserEmail && (
                  <div style={{ marginBottom: '1rem', padding: '0.65rem 0.85rem', background: 'var(--accent-bg)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 500 }}>
                      <i className="fa-solid fa-filter"></i> Filtrando pedidos de: <strong>{selectedUserEmail}</strong>
                    </span>
                    <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }} onClick={() => { setSelectedUserEmail(null); setTab('pedidos') }}>
                      <i className="fa-solid fa-xmark"></i> Limpar filtro
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div className="admin-search-prod" style={{ flex: '1', minWidth: '180px' }}>
                    <i className="fa-solid fa-search"></i>
                    <input type="text" placeholder="Buscar por nome, telefone ou email..." value={userSearch} onChange={e => setUserSearch(e.target.value)} style={{ width: '100%' }} />
                  </div>
                  <select value={userCityFilter} onChange={e => setUserCityFilter(e.target.value)} style={{ padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', background: 'white', cursor: 'pointer', maxWidth: '160px' }}>
                    {userCities.map(c => <option key={c} value={c}>{c === 'TODAS' ? 'Todas as cidades' : c}</option>)}
                  </select>
                  <select value={userOrigemFilter} onChange={e => setUserOrigemFilter(e.target.value)} style={{ padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', background: 'white', cursor: 'pointer', maxWidth: '160px' }}>
                    <option value="TODAS">Todas origens</option>
                    <option value="BOT">BOT</option>
                    <option value="Registro do Site">Registro do Site</option>
                    <option value="Admin">Admin</option>
                    <option value="Importado WhatsApp">Importado WhatsApp</option>
                  </select>
                  <div className="admin-search-prod" style={{ minWidth: '160px', maxWidth: '200px' }}>
                    <i className="fa-solid fa-search"></i>
                    <input type="text" placeholder="Buscar endereço..." value={userEnderecoSearch} onChange={e => setUserEnderecoSearch(e.target.value)} style={{ width: '100%' }} />
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', fontSize: '0.78rem' }}>
                    <button className={`admin-btn ${userSort.field === 'nome' ? 'admin-btn-primary' : 'admin-btn-sec'}`} style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }} onClick={() => setUserSort(prev => prev.field === 'nome' ? { field: 'nome', dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field: 'nome', dir: 'asc' })}>
                      Nome {userSort.field === 'nome' && <i className={`fa-solid fa-sort-${userSort.dir === 'asc' ? 'up' : 'down'}`}></i>}
                    </button>
                    <button className={`admin-btn ${userSort.field === 'cidade' ? 'admin-btn-primary' : 'admin-btn-sec'}`} style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem' }} onClick={() => setUserSort(prev => prev.field === 'cidade' ? { field: 'cidade', dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { field: 'cidade', dir: 'asc' })}>
                      Cidade {userSort.field === 'cidade' && <i className={`fa-solid fa-sort-${userSort.dir === 'asc' ? 'up' : 'down'}`}></i>}
                    </button>
                  </div>
                  {selectedUserIds.size > 0 && (
                    <button className="admin-btn" style={{ background: '#dc2626', color: 'white', borderColor: '#dc2626', fontSize: '0.78rem', padding: '0.4rem 0.7rem' }}
                      onClick={() => openRoutePlanning(filteredUsuarios.filter(u => selectedUserIds.has(u.telefone || u.id)))}>
                      <i className="fa-solid fa-route"></i> Traçar Rotas ({selectedUserIds.size})
                    </button>
                  )}
                  {selectedUserIds.size > 0 && (
                    <button className="admin-btn" style={{ background: '#dc2626', color: 'white', borderColor: '#dc2626', fontSize: '0.78rem', padding: '0.4rem 0.7rem' }}
                      onClick={bulkDeleteUsers}>
                      <i className="fa-solid fa-trash-can"></i> Excluir em Massa ({selectedUserIds.size})
                    </button>
                  )}
                </div>

                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th style={{ width: '32px' }}>
                          <input type="checkbox" checked={paginatedUsuarios.length > 0 && paginatedUsuarios.every(u => selectedUserIds.has(u.telefone || u.id))}
                            onChange={e => {
                              if (e.target.checked) {
                                setSelectedUserIds(new Set(paginatedUsuarios.map(u => u.telefone || u.id)))
                              } else {
                                setSelectedUserIds(new Set())
                              }
                            }} />
                        </th>
                        <th>Nome</th>
                        <th>Telefone</th>
                        <th>Email</th>
                        <th>CPF</th>
                        <th>Origem</th>
                        <th>Nível</th>
                        <th>Endereço</th>
                        <th>Cadastro</th>
                        <th>Pedidos</th>
                        <th>Limites</th>
                        <th>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedUsuarios.map(u => {
                        const uid = u.telefone || u.id
                        const userOrders = orders.filter(o => o.customer?.telefone === u.telefone || o.user_id === u.id)
                        const totalGasto = userOrders.reduce((s, o) => s + o.total, 0)
                        const e = u.endereco || {}
                        const endStr = [e.rua && `${e.rua}${e.numero ? `, ${e.numero}` : ''}`, e.bairro, e.cidade].filter(Boolean).join(', ') || '-'
                        const origem = e.origem || '—'
                        const origemColors = { 'BOT': '#8b5cf6', 'Registro do Site': '#16a34a', 'Admin': '#2563eb', 'Importado WhatsApp': '#d97706' }
                        return (
                          <tr key={uid}>
                            <td>
                              <input type="checkbox" checked={selectedUserIds.has(uid)}
                                onChange={e => {
                                  const next = new Set(selectedUserIds)
                                  e.target.checked ? next.add(uid) : next.delete(uid)
                                  setSelectedUserIds(next)
                                }} />
                            </td>
                            <td style={{ fontWeight: 600 }}>{u.nome}</td>
                            <td>{u.telefone}</td>
                            <td>{u.email || '-'}</td>
                            <td style={{ fontSize: '0.78rem' }}>{u.endereco?.cpf || '-'}</td>
                            <td>
                              <span className="origem-badge" style={{ background: `${origemColors[origem] || '#6b7280'}18`, color: origemColors[origem] || '#6b7280', border: `1px solid ${origemColors[origem] || '#6b7280'}30` }}>
                                {origem === 'BOT' ? <i className="fa-solid fa-robot"></i> : origem === 'Registro do Site' ? <i className="fa-solid fa-globe"></i> : origem === 'Admin' ? <i className="fa-solid fa-user-tie"></i> : origem === 'Importado WhatsApp' ? <i className="fa-brands fa-whatsapp"></i> : <i className="fa-solid fa-circle-question"></i>}
                                {' '}{origem}
                              </span>
                            </td>
                            <td>
                              {u.endereco?.nivel === 'primeiro-comprador' ? <span style={{ color: '#10b981', fontWeight: 600, fontSize: '0.78rem' }}>Primeiro Comprador</span> :
                                u.endereco?.nivel === 'comprador-antigo' ? <span style={{ color: '#8b5cf6', fontWeight: 600, fontSize: '0.78rem' }}>Comprador Antigo</span> :
                                  <span style={{ color: 'var(--admin-text-sec)', fontSize: '0.75rem' }}>—</span>}
                            </td>
                            <td style={{ fontSize: '0.78rem', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={endStr}>
                              {endStr}
                            </td>
                            <td>{formatDate(u.created_at ? new Date(u.created_at).toISOString().split('T')[0] : (u.createdAt ? new Date(u.createdAt).toISOString().split('T')[0] : ''))}</td>
                            <td>
                              <span className="cat-tag">{userOrders.length} pedidos</span>
                              {userOrders.length > 0 && (
                                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>
                                  {formatPreco(totalGasto)}
                                </span>
                              )}
                            </td>
                            <td style={{ fontSize: '0.75rem' }}>
                              {u.endereco?.limitePedidos ? <span>P: {u.endereco.limitePedidos}</span> : null}
                              {u.endereco?.limitePreco ? <span>{u.endereco?.limitePedidos ? ' | ' : ''}R$: {formatPreco(u.endereco.limitePreco)}</span> : null}
                              {!u.endereco?.limitePedidos && !u.endereco?.limitePreco ? <span style={{ color: 'var(--admin-text-sec)' }}>—</span> : null}
                            </td>
                            <td style={{ position: 'relative' }}>
                              <div className="td-actions">
                                <button className="action-btn" style={{ color: '#2563eb' }} title="Ver no Google Maps" onClick={() => openGoogleMaps(buildAddressString(e))}>
                                  <i className="fa-solid fa-location-dot"></i>
                                </button>
                                <button className="action-btn" style={{ color: '#8b5cf6' }} title="Ver no Mapa Interativo" onClick={() => { setTab('mapa'); setSelectedUserIds(new Set([u.telefone || u.id])) }}>
                                  <i className="fa-solid fa-map"></i>
                                </button>
                                <button className="action-btn" style={{ color: '#25d366' }} title="Enviar WhatsApp"
                                  onClick={() => setUserMsgMenu(userMsgMenu === u.telefone ? null : u.telefone)}>
                                  <i className="fa-brands fa-whatsapp"></i>
                                </button>
                                <button className="action-btn action-green" title="Ver detalhes do usuário" onClick={() => setSelectedUserDetail(u)}>
                                  <i className="fa-solid fa-user"></i>
                                </button>
                                <button className="action-btn" title="Ver pedidos" onClick={() => { setSelectedUserEmail(u.email || u.telefone); setTab('pedidos') }}>
                                  <i className="fa-solid fa-clipboard-list"></i>
                                </button>
                                <button className="action-btn" style={{ color: 'var(--danger)' }} title="Excluir usuário" onClick={() => handleDeleteUser(u)}>
                                  <i className="fa-solid fa-trash-can"></i>
                                </button>
                              </div>
                              {userMsgMenu === u.telefone && (
                                <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 100, background: 'white', border: '1px solid var(--admin-border)', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', minWidth: '200px', padding: '0.35rem', marginTop: '4px' }}>
                                  {USER_MSG_TEMPLATES.map(t => (
                                    <div key={t.key}
                                      style={{ padding: '0.55rem 0.7rem', cursor: 'pointer', borderRadius: '8px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--admin-text)' }}
                                      onClick={() => sendUserWhatsApp(u, t.key)}
                                      onMouseEnter={e => e.currentTarget.style.background = '#f3f4f6'}
                                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                      <i className={`fa-solid ${t.icon}`} style={{ width: '16px', color: '#25d366' }}></i>
                                      {t.label}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                      {paginatedUsuarios.length === 0 && <tr><td colSpan="10" className="td-empty">Nenhum usuário encontrado</td></tr>}
                    </tbody>
                  </table>
                </div>

                {totalUserPages > 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1rem 0', fontSize: '0.85rem' }}>
                    <button className="admin-btn admin-btn-sec" style={{ padding: '0.35rem 0.75rem', fontSize: '0.82rem' }} disabled={userPage <= 1} onClick={() => setUserPage(p => Math.max(1, p - 1))}>
                      <i className="fa-solid fa-chevron-left"></i> Anterior
                    </button>
                    <span style={{ color: 'var(--admin-text-sec)' }}>
                      Página {userPage} de {totalUserPages} ({filteredUsuarios.length} usuários)
                    </span>
                    <button className="admin-btn admin-btn-sec" style={{ padding: '0.35rem 0.75rem', fontSize: '0.82rem' }} disabled={userPage >= totalUserPages} onClick={() => setUserPage(p => Math.min(totalUserPages, p + 1))}>
                      Próxima <i className="fa-solid fa-chevron-right"></i>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* LEADS */}
        {tab === 'leads' && (
          <div className="admin-section">
            <div className="admin-header-row">
              <div>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <i className="fa-solid fa-file-pen" style={{ color: 'var(--accent)' }}></i>
                  Inscrições do Site
                </h1>
                <p className="admin-subtitle">{leads.length} cadastros recebidos</p>
              </div>
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Telefone</th>
                    <th>Email</th>
                    <th>Cidade</th>
                    <th>Data</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map(l => {
                    const e = l.endereco || {}
                    return (
                      <tr key={l.id}>
                        <td style={{ fontWeight: 600 }}>{l.nome}</td>
                        <td>{l.telefone}</td>
                        <td>{l.email || '-'}</td>
                        <td>{[e.cidade, e.estado].filter(Boolean).join('/') || '-'}</td>
                        <td>{formatDate(l.created_at)}</td>
                      </tr>
                    )
                  })}
                  {leads.length === 0 && <tr><td colSpan="5" className="td-empty">Nenhuma inscrição recebida</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MAPA */}
        {tab === 'mapa' && (
          <div className="admin-section" style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
            <MapView usuarios={usuarios} orders={orders} financial={financial}
              onMarkOnWay={(user) => {
                const userOrders = orders.filter(o => o.customer?.telefone === user.telefone || o.user_id === user.id)
                const toUpdate = userOrders.filter(o => !['entregue', 'cancelado'].includes(o.status))
                if (toUpdate.length === 0) return
                if (confirm(`Marcar ${toUpdate.length} pedido(s) de ${user.nome || user.pushName} como "Em Rota"?`)) {
                  toUpdate.forEach(ord => {
                    updateOrderStatus(ord.id, 'em-rota')
                  })
                }
              }}
              onViewUser={(user) => {
                setSelectedUserDetail(user)
                setTab('usuarios')
              }} />
          </div>
        )}

        {/* ANÁLISES */}
        {tab === 'analises' && (
          <div className="admin-section" style={{ minHeight: '100vh' }}>
            <CentralAnalise
              orders={orders}
              financial={financial}
              despesas={despesas}
              produtos={produtosAtuais}
              usuarios={usuarios}
              onBack={() => setTab('dashboard')}
            />
          </div>
        )}

        {/* ROTAS */}
        {tab === 'rotas' && (
          <div className="admin-section">
            <div className="admin-header-row">
              <div>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="rota-title-icon"><i className="fa-solid fa-route"></i></span>
                  Rotas
                </h1>
                <p className="admin-subtitle">Mapa de rotas e contatos de WhatsApp</p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="admin-btn" style={{ background: '#059669', color: 'white', borderColor: '#059669' }} onClick={() => { setNewRotaName(''); setNewRotaSearch(''); setNewRotaSelected([]); setNewContactPhone(''); setNewContactName(''); setShowNewRota(true) }}>
                  <i className="fa-solid fa-plus"></i> Nova Rota
                </button>
                <button className="admin-btn admin-btn-primary" onClick={fetchRotas} disabled={rotasLoading}>
                  <i className={`fa-solid ${rotasLoading ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i>
                  {rotasLoading ? 'Buscando...' : 'Atualizar'}
                </button>
                <button className="admin-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6' }}
                  disabled={rotas.length === 0 || importingRotas}
                  onClick={async () => {
                    if (importingRotas) return
                    setImportingRotas(true)
                    try {
                      const added = await syncContatosToUsuarios(rotas)
                      if (added > 0) {
                        showToast(`${added} contato(s) importado(s) para usuários!`)
                        const u = await getAllUsers()
                        if (u.length) { setUsuarios(u); LS.set('thsm_usuarios', u) }
                      } else {
                        showToast('Nenhum novo contato para importar', 'warning')
                      }
                    } catch (e) {
                      console.error('Erro ao importar:', e)
                      showToast('Erro ao importar contatos', 'error')
                    } finally {
                      setImportingRotas(false)
                    }
                  }}>
                  <i className={`fa-solid ${importingRotas ? 'fa-spinner fa-spin' : 'fa-users'}`}></i>
                  {importingRotas ? 'Importando...' : 'Importar para Usuários'}
                </button>
              </div>
            </div>

            {rotasError && (
              <div className="rota-error-card">
                <div className="rota-error-icon"><i className="fa-solid fa-exclamation-triangle"></i></div>
                <div className="rota-error-body">
                  <strong>Erro ao carregar</strong>
                  <span>{rotasError}</span>
                  <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }} onClick={fetchRotas}>
                    <i className="fa-solid fa-rotate"></i> Tentar novamente
                  </button>
                </div>
              </div>
            )}

            {rotasLoading && (
              <div className="rota-loading">
                <div className="rota-loading-spinner"><i className="fa-solid fa-spinner fa-spin"></i></div>
                <div className="rota-loading-text">
                  <strong>Sincronizando rotas...</strong>
                  <span>Aguarde enquanto buscamos os dados do WhatsApp</span>
                </div>
              </div>
            )}

            {rotas.length > 0 && !rotasLoading && (
              <>
                {/* STATS CARDS */}
                <div className="rota-stats">
                  <div className="rota-stat-card stat-purple">
                    <div className="rota-stat-icon"><i className="fa-solid fa-route"></i></div>
                    <div className="rota-stat-info">
                      <strong>{rotaStats.totalRotas}</strong>
                      <span>Rotas</span>
                    </div>
                  </div>
                  <div className="rota-stat-card stat-blue">
                    <div className="rota-stat-icon"><i className="fa-solid fa-city"></i></div>
                    <div className="rota-stat-info">
                      <strong>{rotaStats.totalCidades}</strong>
                      <span>Cidades</span>
                    </div>
                  </div>
                  <div className="rota-stat-card stat-green">
                    <div className="rota-stat-icon"><i className="fa-solid fa-users"></i></div>
                    <div className="rota-stat-info">
                      <strong>{rotaStats.totalContatos}</strong>
                      <span>Contatos</span>
                    </div>
                  </div>
                </div>

                {/* FILTERS */}
                <div className="rota-filters">
                  <div className="rota-select-wrap">
                    <i className="fa-solid fa-city"></i>
                    <select value={filterCidade} onChange={e => setFilterCidade(e.target.value)}>
                      <option value="TODAS">Todas as cidades</option>
                      {cidadesRotas.filter(c => c !== 'TODAS').map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="rota-select-wrap">
                    <i className="fa-solid fa-route"></i>
                    <select value={filterRota} onChange={e => setFilterRota(e.target.value)}>
                      <option value="TODAS">Todas as rotas</option>
                      {rotasUnicas.filter(r => r !== 'TODAS').map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="rota-select-wrap">
                    <i className="fa-solid fa-user-tag"></i>
                    <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)}>
                      <option value="TODOS">Todos os contatos</option>
                      <option value="cliente">Clientes</option>
                      <option value="lead">Leads</option>
                    </select>
                  </div>
                  <div className="rota-search-box">
                    <i className="fa-solid fa-search"></i>
                    <input type="text" placeholder="Buscar rota, cidade ou contato..." value={filterRotaSearch} onChange={e => setFilterRotaSearch(e.target.value)} />
                    {filterRotaSearch && <button className="rota-search-clear" onClick={() => setFilterRotaSearch('')}><i className="fa-solid fa-xmark"></i></button>}
                  </div>
                </div>

                {/* ROUTE GRID */}
                {rotasFiltradas.length === 0 ? (
                  <div className="rota-empty">
                    <i className="fa-solid fa-map-location-dot"></i>
                    <h3>Nenhuma rota encontrada</h3>
                    <p>Tente alterar os filtros</p>
                  </div>
                ) : (
                  <div className="rota-grid">
                    {rotasFiltradas.map((grupo) => {
                      const isExpanded = expandedRota === grupo.rota
                      let cidadesVisiveis = filterCidade === 'TODAS'
                        ? grupo.cidades
                        : grupo.cidades.filter(c => c.cidade === filterCidade)
                      if (filterTipo !== 'TODOS') {
                        cidadesVisiveis = cidadesVisiveis
                          .map(c => ({ ...c, contatos: c.contatos.filter(ct => filterTipo === 'cliente' ? isClienteContato(ct) : !isClienteContato(ct)) }))
                          .filter(c => c.contatos.length > 0)
                      }
                      const totalVisivel = cidadesVisiveis.reduce((s, c) => s + c.contatos.length, 0)
                      const allContatos = cidadesVisiveis.flatMap(c => c.contatos)
                      const removedEdits = rotaEdits.filter(e => e.rota === grupo.rota && e.acao === 'remover')
                      return (
                        <div key={grupo.rota} className={`rota-card ${isExpanded ? 'expanded' : ''}`}>
                          <div className="rota-card-main" onClick={() => setExpandedRota(isExpanded ? null : grupo.rota)}>
                            <div className="rota-card-preview">
                              <div className="rota-card-avatar">
                                {allContatos[0]?.profilePicture ? (
                                  <img src={allContatos[0].profilePicture} alt="" onError={e => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<i class=\"fa-solid fa-route\"></i>' }} />
                                ) : (
                                  <i className="fa-solid fa-route"></i>
                                )}
                              </div>
                              <div className="rota-card-meta">
                                <strong className="rota-card-title">{grupo.rota}</strong>
                                <span className="rota-card-subtitle">
                                  <i className="fa-solid fa-users"></i> {totalVisivel} contatos
                                  <span className="rota-dot"></span>
                                  <i className="fa-solid fa-city"></i> {cidadesVisiveis.length} {cidadesVisiveis.length === 1 ? 'cidade' : 'cidades'}
                                </span>
                              </div>
                              <div className="rota-card-actions">
                                <button className="rota-map-btn" title="Ver no Google Maps" onClick={e => { e.stopPropagation(); window.open(`https://www.google.com/maps/search/${encodeURIComponent(grupo.rota)}`, '_blank') }}>
                                  <i className="fa-solid fa-map-location-dot"></i>
                                  <span>Mapa</span>
                                </button>
                                <button className="rota-map-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6' }} title="Alertar Rotas" onClick={e => { e.stopPropagation(); if (confirm(`Enviar alerta para ${totalVisivel} contatos da rota "${grupo.rota}"?`)) { sendAlertRota('alerta', allContatos, orders); showToast(`Alerta enviado para ${totalVisivel} contatos`) } }}>
                                  <i className="fa-solid fa-bullhorn"></i>
                                  <span>Alertar</span>
                                </button>
                                <button className="rota-map-btn" style={{ background: '#059669', color: 'white', borderColor: '#059669' }} title="Atualização Pedidos" onClick={e => { e.stopPropagation(); if (confirm(`Enviar atualização de pedidos para ${totalVisivel} contatos da rota "${grupo.rota}"?`)) { sendAlertRota('atualizacao', allContatos, orders); showToast(`Atualização enviada para ${totalVisivel} contatos`) } }}>
                                  <i className="fa-solid fa-rotate"></i>
                                  <span>Pedidos</span>
                                </button>
                                <button className="rota-map-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} title="Personalizado" onClick={e => { e.stopPropagation(); setCustomMsgRota({ rota: grupo.rota, contatos: allContatos, total: totalVisivel }) }}>
                                  <i className="fa-solid fa-pen"></i>
                                  <span>Custom</span>
                                </button>
                                <button className="rota-map-btn" style={{ background: '#0ea5e9', color: 'white', borderColor: '#0ea5e9' }} title="Adicionar contato à rota" onClick={e => { e.stopPropagation(); setRotaContactModal({ rota: grupo.rota, mode: 'add', custom: !!grupo._custom }) }}>
                                  <i className="fa-solid fa-user-plus"></i>
                                  <span>Adicionar</span>
                                </button>
                                {removedEdits.length > 0 && (
                                  <button className="rota-map-btn" style={{ background: '#f97316', color: 'white', borderColor: '#f97316' }} title="Restaurar contatos removidos desta rota" onClick={e => { e.stopPropagation(); setShowRestoreRota(grupo.rota) }}>
                                    <i className="fa-solid fa-rotate-left"></i>
                                    <span>Restaurar ({removedEdits.length})</span>
                                  </button>
                                )}
                                {grupo._custom && (
                                  <button className="rota-map-btn" style={{ background: '#dc2626', color: 'white', borderColor: '#dc2626' }} title="Excluir rota" onClick={e => { e.stopPropagation(); if (confirm(`Excluir rota "${grupo.rota}"?`)) { setCustomRotas(prev => prev.filter(cr => cr.rota !== grupo.rota)); showToast(`Rota "${grupo.rota}" excluída`) } }}>
                                    <i className="fa-solid fa-trash"></i>
                                    <span>Excluir</span>
                                  </button>
                                )}
                                <span className="rota-expand-icon">
                                  <i className={`fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Subcategory badges */}
                          <div className="rota-subcats">
                            {cidadesVisiveis.map(c => (
                              <span key={c.cidade} className="rota-subcat-badge">
                                <i className="fa-solid fa-city"></i> {c.cidade}
                                <span className="rota-subcat-count">{c.contatos.length}</span>
                              </span>
                            ))}
                          </div>

                          {isExpanded && (
                            <div className="rota-contacts">
                              {cidadesVisiveis.map(c => (
                                <div key={c.cidade} className="rota-subcat-group">
                                  <div className="rota-contacts-header">
                                    <span><i className="fa-solid fa-city"></i> {c.cidade}</span>
                                    <span className="rota-contacts-count">{c.contatos.length} {c.contatos.length === 1 ? 'contato' : 'contatos'}</span>
                                  </div>
                                  <div className="rota-contacts-body">
                                    {c.contatos.map((ct, ci) => (
                                      <div key={ci} className="rota-contact-row">
                                        <div className="rota-contact-avatar">
                                          {ct.profilePicture ? (
                                            <img src={ct.profilePicture} alt={ct.pushName} onError={e => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<i class=\"fa-solid fa-user\"></i>' }} />
                                          ) : (
                                            <i className="fa-solid fa-user"></i>
                                          )}
                                        </div>
                                        <div className="rota-contact-info">
                                          <span className="rota-contact-name">{ct.pushName || 'Sem nome'}</span>
                                          <span className="rota-contact-phone">{ct.remoteJid?.replace(/@.*/, '')}</span>
                                          <span className={`rota-contato-tipo ${isClienteContato(ct) ? 'rota-tipo-cliente' : 'rota-tipo-lead'}`}>
                                            <i className={`fa-solid ${isClienteContato(ct) ? 'fa-user-check' : 'fa-user-plus'}`}></i> {isClienteContato(ct) ? 'Cliente' : 'Lead'}
                                          </span>
                                        </div>
                                        <button
                                          className="rota-whatsapp-btn"
                                          title="Conversar no WhatsApp"
                                          onClick={() => {
                                            const phone = ct.remoteJid?.replace(/@.*/, '').replace(/\D/g, '')
                                            if (phone) window.open(`https://wa.me/${phone}`, '_blank')
                                          }}
                                        >
                                          <i className="fa-brands fa-whatsapp"></i>
                                        </button>
                                        {grupo._custom ? (
                                          <>
                                            <button className="rota-whatsapp-btn" style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }} title="Editar"
                                              onClick={e => { e.stopPropagation(); confirmRotaEdit(grupo.rota, ct, true) }}>
                                              <i className="fa-solid fa-pen" style={{ fontSize: '0.65rem' }}></i>
                                            </button>
                                            <button className="rota-whatsapp-btn" style={{ background: '#dc2626', borderColor: '#dc2626' }} title="Remover"
                                              onClick={e => { e.stopPropagation(); confirmRotaRemove(grupo.rota, ct, true) }}>
                                              <i className="fa-solid fa-trash" style={{ fontSize: '0.65rem' }}></i>
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            <button className="rota-whatsapp-btn" style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }} title="Editar"
                                              onClick={e => { e.stopPropagation(); confirmRotaEdit(grupo.rota, ct, false) }}>
                                              <i className="fa-solid fa-pen" style={{ fontSize: '0.65rem' }}></i>
                                            </button>
                                            <button className="rota-whatsapp-btn" style={{ background: '#dc2626', borderColor: '#dc2626' }} title="Remover"
                                              onClick={e => { e.stopPropagation(); confirmRotaRemove(grupo.rota, ct, false) }}>
                                              <i className="fa-solid fa-trash" style={{ fontSize: '0.65rem' }}></i>
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {rotas.length === 0 && !rotasLoading && !rotasError && (
              <div className="rota-empty-state">
                <div className="rota-empty-icon"><i className="fa-solid fa-route"></i></div>
                <h3>Nenhuma rota carregada</h3>
                <p>Clique em "Atualizar" para buscar as rotas do WhatsApp</p>
                <button className="admin-btn admin-btn-primary" onClick={fetchRotas}>
                  <i className="fa-solid fa-rotate"></i> Atualizar Rotas
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'financeiro' && (
          <div className="admin-section fin-section">
            <div className="fin-header">
              <div>
                <h1>Financeiro</h1>
                <p className="admin-subtitle">Controle de contas a prazo e recebimentos</p>
              </div>
              <div className="fin-header-badge">
                <i className="fa-solid fa-chart-line"></i>
              </div>
            </div>

            <div className="admin-cards fin-cards">
              <div className="admin-card card-red">
                <i className="fa-solid fa-exclamation-triangle"></i>
                <div>
                  <strong>{formatPreco(finTotal.atrasado)}</strong>
                  <span>Em Atraso</span>
                </div>
              </div>
              <div className="admin-card card-yellow">
                <i className="fa-solid fa-clock"></i>
                <div>
                  <strong>{formatPreco(finTotal.pendente)}</strong>
                  <span>A Receber</span>
                </div>
              </div>
              <div className="admin-card card-green">
                <i className="fa-solid fa-check-circle"></i>
                <div>
                  <strong>{formatPreco(finTotal.pago)}</strong>
                  <span>Recebido</span>
                </div>
              </div>
              <div className="admin-card card-purple">
                <i className="fa-solid fa-receipt"></i>
                <div>
                  <strong>{formatPreco(despesasPendentes)}</strong>
                  <span>Despesas a pagar</span>
                </div>
              </div>
            </div>

            <div className="fin-view-toggle fin-segmented">
              <button className={`admin-tab ${finTab === 'receber' ? 'active' : ''}`} onClick={() => setFinTab('receber')}>
                <i className="fa-solid fa-money-bill-trend-up"></i> Contas a Receber
              </button>
              <button className={`admin-tab ${finTab === 'despesas' ? 'active' : ''}`} onClick={() => setFinTab('despesas')}>
                <i className="fa-solid fa-receipt"></i> Despesas
              </button>
              <button className={`admin-tab ${finTab === 'relatorios' ? 'active' : ''}`} onClick={() => setFinTab('relatorios')}>
                <i className="fa-solid fa-chart-simple"></i> Relatórios
              </button>
            </div>

            {finTab === 'receber' && (
              <>
                <div className="fin-view-toggle fin-segmented">
                  <button className={`admin-tab ${finView === 'lista' ? 'active' : ''}`} onClick={() => setFinView('lista')}>
                    <i className="fa-solid fa-table"></i> Lista
                  </button>
                  <button className={`admin-tab ${finView === 'calendario' ? 'active' : ''}`} onClick={() => setFinView('calendario')}>
                    <i className="fa-solid fa-calendar-days"></i> Calendário
                  </button>
                </div>

                <div className="admin-tabs fin-tabs">
                  {[
                    { id: 'todos', label: 'Todas', count: financial.length },
                    { id: 'pendente', label: 'Pendentes', count: financial.filter(f => f.status === 'pendente').length },
                    { id: 'pago', label: 'Pagas', count: financial.filter(f => f.status === 'pago').length },
                  ].map(t => (
                    <button key={t.id} className={`admin-tab ${finFilter === t.id ? 'active' : ''}`} onClick={() => setFinFilter(t.id)}>
                      {t.label} {t.count > 0 && <span className="tab-count">{t.count}</span>}
                    </button>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.6rem' }}>
                  <PeriodFilter
                    period={finPeriod}
                    onChange={setFinPeriod}
                    month={finPeriodMonth}
                    onMonth={setFinPeriodMonth}
                    rangeStart={finRangeStart}
                    onRangeStart={setFinRangeStart}
                    rangeEnd={finRangeEnd}
                    onRangeEnd={setFinRangeEnd}
                    label="Filtrar"
                  />
                </div>

                {finView === 'calendario' && <FinCalendar financial={filteredFin} />}

                {finView === 'lista' && (
                  <div className="fin-table-card">
                    <div className="fin-table-header">
                      <span><i className="fa-solid fa-list-ul"></i> Contas a Receber</span>
                      <span className="fin-table-total"><strong>{formatPreco(finTotalFiltered)}</strong> <small>{filteredFin.length} registro(s)</small></span>
                    </div>
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th onClick={() => handleFinSort('customerName')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>Cliente {renderSortIcon('customerName')}</th>
                            <th onClick={() => handleFinSort('itemName')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>Item {renderSortIcon('itemName')}</th>
                            <th onClick={() => handleFinSort('qty')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>Qtd {renderSortIcon('qty')}</th>
                            <th onClick={() => handleFinSort('value')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>Valor {renderSortIcon('value')}</th>
                            <th onClick={() => handleFinSort('custo')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>Custo {renderSortIcon('custo')}</th>
                            <th onClick={() => handleFinSort('dueDate')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>Vencimento {renderSortIcon('dueDate')}</th>
                            <th>Dias</th>
                            <th onClick={() => handleFinSort('status')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>Status {renderSortIcon('status')}</th>
                            <th onClick={() => handleFinSort('paymentMethod')} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>Forma {renderSortIcon('paymentMethod')}</th>
                            <th>Pagamento</th>
                            <th>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredFin.map(f => {
                            const dias = diffDays(hoje(), f.dueDate)
                            const atrasado = f.status === 'pendente' && dias > 0
                            const pm = formatPagamento(f.paymentMethod)
                            return (
                              <tr key={f.id} className={atrasado ? 'row-overdue' : ''}>
                                <td>{f.customerName}</td>
                                <td className="td-prod-name">{f.itemName}</td>
                                <td>{f.qty}</td>
                                <td className="td-price">{formatPreco(f.value)}</td>
                                <td className="td-price" style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>{f.precoCusto ? formatPreco(f.precoCusto) : '-'}</td>
                                <td>{formatDate(f.dueDate)}</td>
                                <td>
                                  {f.status === 'pago' ? (
                                    <span className="days-ok">Pago</span>
                                  ) : dias > 0 ? (
                                    <span className="days-overdue">+{dias} dias</span>
                                  ) : dias === 0 ? (
                                    <span className="days-today">Vence hoje</span>
                                  ) : (
                                    <span className="days-future">Faltam {Math.abs(dias)} dias</span>
                                  )}
                                </td>
                                <td>
                                  <span className={`status-tag ${atrasado ? 'status-atrasado' : f.status === 'pendente' ? 'status-pendente' : 'status-pago'}`}>
                                    {atrasado ? 'Atrasado' : f.status === 'pendente' ? 'Pendente' : 'Pago'}
                                  </span>
                                </td>
                                <td>
                                  {pm ? <span className="pag-badge"><i className={`fa-solid ${pm.icon}`}></i> {pm.label}</span> : '-'}
                                </td>
                                <td>
                                  {f.paidDate ? formatDate(f.paidDate) : '-'}
                                </td>
                                <td>
                                  <div className="td-actions">
                                    {f.status === 'pendente' && (
                                      <>
                                        <button className="action-btn action-confirm" title="Quitar" onClick={() => quitarFin(f.id)}>
                                          <i className="fa-solid fa-check"></i>
                                        </button>
                                        <button className="action-btn" title="Editar vencimento" onClick={() => setFinEdit(f)}>
                                          <i className="fa-solid fa-calendar"></i>
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                          {filteredFin.length === 0 && <tr><td colSpan="11" className="td-empty">Nenhum registro financeiro</td></tr>}
                        </tbody>
                        <tfoot className="fin-tfoot">
                          <tr>
                            <td colSpan="3">Total</td>
                            <td className="td-price">{formatPreco(finTotalFiltered)}</td>
                            <td colSpan="7"></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {finTab === 'despesas' && (
              <div>
                <div className="fin-toolbar">
                  <span className="fin-toolbar-title"><i className="fa-solid fa-receipt"></i> Despesas</span>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <PeriodFilter
                      period={despPeriod}
                      onChange={setDespPeriod}
                      month={despPeriodMonth}
                      onMonth={setDespPeriodMonth}
                      rangeStart={despRangeStart}
                      onRangeStart={setDespRangeStart}
                      rangeEnd={despRangeEnd}
                      onRangeEnd={setDespRangeEnd}
                      label="Filtrar"
                    />
                    <button className="admin-btn fin-btn-new" onClick={() => { setEditingDespesa(null); setShowDespesaModal(true) }}>
                      <i className="fa-solid fa-plus"></i> Nova Despesa
                    </button>
                  </div>
                </div>

                <div className="admin-tabs fin-tabs">
                  {[
                    { id: 'todas', label: 'Todas', count: despesas.length },
                    { id: 'pendente', label: 'Pendentes', count: despesas.filter(d => d.status === 'pendente').length },
                    { id: 'pago', label: 'Pagas', count: despesas.filter(d => d.status === 'pago').length },
                  ].map(t => (
                    <button key={t.id} className={`admin-tab ${despesaFilter === t.id ? 'active' : ''}`} onClick={() => setDespesaFilter(t.id)}>
                      {t.label} {t.count > 0 && <span className="tab-count">{t.count}</span>}
                    </button>
                  ))}
                </div>

                <div className="fin-table-card">
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Tipo</th>
                          <th>Descrição</th>
                          <th>Valor</th>
                          <th>Vencimento</th>
                          <th>Forma</th>
                          <th>Status</th>
                          <th>Pagamento</th>
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDespesas.map(d => {
                          const atrasado = d.status === 'pendente' && diffDays(d.dueDate, hoje()) > 0
                          const pm = formatPagamento(d.paymentMethod)
                          return (
                            <tr key={d.id} className={atrasado ? 'row-overdue' : ''}>
                              <td><span className="despesa-tipo">{d.tipo}</span></td>
                              <td className="td-prod-name">{d.descricao || '-'}</td>
                              <td className="td-price">{formatPreco(d.value)}</td>
                              <td>{formatDate(d.dueDate)}</td>
                              <td>
                                {pm ? <span className="pag-badge"><i className={`fa-solid ${pm.icon}`}></i> {pm.label}</span> : '-'}
                              </td>
                              <td>
                                <span className={`status-tag ${atrasado ? 'status-atrasado' : d.status === 'pendente' ? 'status-pendente' : 'status-pago'}`}>
                                  {atrasado ? 'Atrasado' : d.status === 'pendente' ? 'Pendente' : 'Pago'}
                                </span>
                              </td>
                              <td>{d.paidDate ? formatDate(d.paidDate) : '-'}</td>
                              <td>
                                <div className="td-actions">
                                  {d.status === 'pendente' && (
                                    <button className="action-btn action-confirm" title="Quitar" onClick={() => quitarDespesa(d.id)}>
                                      <i className="fa-solid fa-check"></i>
                                    </button>
                                  )}
                                  <button className="action-btn" title="Editar" onClick={() => { setEditingDespesa(d); setShowDespesaModal(true) }}>
                                    <i className="fa-solid fa-pen"></i>
                                  </button>
                                  <button className="action-btn action-delete" title="Excluir" onClick={() => deleteDespesa(d.id)}>
                                    <i className="fa-solid fa-trash-can"></i>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                        {filteredDespesas.length === 0 && <tr><td colSpan="8" className="td-empty">Nenhuma despesa cadastrada</td></tr>}
                      </tbody>
                      <tfoot className="fin-tfoot">
                        <tr>
                          <td colSpan="2">Total</td>
                          <td className="td-price">{formatPreco(despesasTotalFiltered)}</td>
                          <td colSpan="5"></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {finTab === 'relatorios' && (
              <RelatoriosPanel orders={orders} financial={financial} despesas={despesas} produtos={produtosAtuais} usuarios={usuarios} rotas={rotas} />
            )}
          </div>
        )}
      </main>

      {/* MODAL ADD ORDER */}
      {showAddOrder && (
        <AddOrderModal
          produtos={produtosAtuais}
          usuarios={allClientesConsolidados}
          orders={orders}
          productPriceMap={productPriceMap}
          initialCart={prodCart}
          preselectedUser={preselectedUserForOrder}
          onSave={(order) => { addOrder(order); clearProdCart() }}
          onClose={() => { setShowAddOrder(false); setPreselectedUserForOrder(null); clearProdCart() }}
        />
      )}

      {/* MODAL DE RELATÓRIO DE PEDIDOS (PDF E EXCEL) */}
      <OrderReportModal
        isOpen={showOrderReportModal}
        onClose={() => setShowOrderReportModal(false)}
        orders={orders}
        produtos={produtosAtuais}
        filteredOrdersFromScreen={filteredOrders}
        selectedOrderIds={selectedIds}
        usuarios={allClientesConsolidados}
        rotas={rotas}
        isFinalizada={isFinalizada}
        showToast={showToast}
      />

      {semDevReport && (
        <div className="admin-overlay semdev-overlay" onClick={() => setSemDevReport(null)}>
          <div className="admin-modal semdev-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-file-lines"></i> Relatório SEM DEVOLUÇÃO</h3>
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', background: '#dc2626', color: 'white', borderColor: '#dc2626' }} onClick={() => window.print()}>
                  <i className="fa-solid fa-print"></i> Imprimir / PDF
                </button>
                <button className="admin-modal-close" onClick={() => setSemDevReport(null)}><i className="fa-solid fa-xmark"></i></button>
              </div>
            </div>
            <div className="admin-modal-body">
              <div className="semdev-print-header" style={{ display: 'none' }}>
                <h2>Relatório SEM DEVOLUÇÃO</h2>
                <p>Gerado em {semDevReport.geradoEm} · Total {formatPreco(semDevReport.total)}</p>
              </div>
              <p className="semdev-summary">
                Gerado em {semDevReport.geradoEm} · {semDevReport.rows.length} item(ns) · <strong>{semDevReport.groups.length} cliente(s)</strong> · Total {formatPreco(semDevReport.total)}
              </p>
              <div className="semdev-groups">
                {semDevReport.groups.map((g, gi) => (
                  <div key={gi} className={`semdev-group ${semDevGroups[gi] ? 'open' : ''}`}>
                    <div className="semdev-group-head" onClick={() => setSemDevGroups(prev => ({ ...prev, [gi]: !prev[gi] }))}>
                      <i className={`fa-solid fa-caret-right semdev-caret ${semDevGroups[gi] ? 'open' : ''}`}></i>
                      <div className="semdev-group-ident">
                        <span className="semdev-group-cliente">{g.cliente || '—'}</span>
                        <span className="semdev-group-meta">{g.telefone || '-'}{g.cidade ? ` · ${g.cidade}` : ''} · {g.rows.length} item(ns) · {formatPreco(g.rows.reduce((s, r) => s + r.valor, 0))}</span>
                      </div>
                    </div>
                    {semDevGroups[gi] && (
                      <table className="admin-table semdev-table">
                        <thead>
                          <tr>
                            <th>Produto</th>
                            <th>Qtd</th>
                            <th>Data</th>
                            <th>Valor</th>
                            <th className="semdev-print-hide" style={{ width: '60px' }}>Ações</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((r, i) => (
                            <tr key={i}>
                              <td>{r.produto}</td>
                              <td>{r.qty}</td>
                              <td>{r.data ? formatDate(r.data) : '-'}</td>
                              <td className="td-price">{formatPreco(r.valor)}</td>
                              <td className="semdev-print-hide">
                                <button className="action-btn" title="Ver pedido original" onClick={() => { const o = orders.find(ord => ord.id === r.orderId); if (o) { setSemDevReport(null); setShowOrderDetail(o) } }}>
                                  <i className="fa-solid fa-eye"></i>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
              <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
                <button className="admin-btn admin-btn-sec" onClick={() => setSemDevReport(null)}>Fechar</button>
                <button className="admin-btn" style={{ background: '#dc2626', color: 'white', borderColor: '#dc2626' }} onClick={() => window.print()}>
                  <i className="fa-solid fa-print"></i> Imprimir / PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DATA VENCIMENTO AO ENVIAR PARA ROTA */}
      {showRotaDue && (
        <div className="admin-overlay" onClick={() => setShowRotaDue(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-truck"></i> Enviar para Rota</h3>
              <button className="admin-modal-close" onClick={() => setShowRotaDue(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                Pedido <strong>#{showRotaDue.id.toString().slice(-6)}</strong> — {showRotaDue.customer?.nome || 'Cliente'}
              </p>
              <div className="detail-section">
                <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                  <i className="fa-solid fa-calendar-day"></i> Data de vencimento das contas a prazo
                </label>
                <input type="date" value={rotaDueDate} onChange={e => setRotaDueDate(e.target.value)}
                  style={{ width: '100%', padding: '0.4rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', background: 'var(--admin-bg)', color: 'var(--admin-text)' }} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="admin-btn admin-btn-sec" onClick={() => setShowRotaDue(null)}>Cancelar</button>
              <button className="admin-btn admin-btn-primary" onClick={() => {
                updateOrderStatus(showRotaDue.id, 'em-rota', false, rotaDueDate || showRotaDue.dataVencimento || null)
                setShowRotaDue(null)
              }}>
                <i className="fa-solid fa-truck"></i> Enviar para Rota
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ORDER DETAIL */}
      {showOrderDetail && (
        <OrderDetailModal
          order={showOrderDetail}
          usuarios={allClientesConsolidados}
          financial={financial.filter(f => String(f.orderId) === String(showOrderDetail.id))}
          produtos={produtosAtuais}
          onClose={() => setShowOrderDetail(null)}
          onStatusChange={(s) => { updateOrderStatus(showOrderDetail.id, s, false, null, showOrderDetail); setShowOrderDetail(null) }}
          onUpdateDue={(due) => updateOrderDue(showOrderDetail.id, due)}
          onPreApprovar={(rejectedIds, replacements, venc) => preApprovarPedido(showOrderDetail.id, rejectedIds, replacements, venc)}
          onOpenDelivery={(order, mode = 'acerto') => { openAcertoModal({ ...(orders.find(o => String(o.id) === String(showOrderDetail.id)) || showOrderDetail), ...showOrderDetail, ...order }, mode); setShowOrderDetail(null) }}
          onEditAndConfirm={(editedItems, currentStatus) => {
            const now = Date.now()
            const totalAvista = Math.round(editedItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0) * 100) / 100
            const totalAprazo = Math.round(editedItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0) * 100) / 100
            const calcTotal = Math.round((totalAvista + totalAprazo) * 100) / 100
            const newStatus = currentStatus === 'acerto' ? 'acerto' : (currentStatus === 'entregue' || currentStatus === 'em-rota' ? 'entregue' : 'em-rota')
            const updatedOrder = {
              ...showOrderDetail,
              items: editedItems,
              itens: editedItems,
              originalItems: editedItems.map(i => ({ ...i })),
              totalAvista,
              totalAprazo,
              total: calcTotal,
              totalNota: calcTotal,
              totalOriginal: calcTotal,
              status: newStatus,
              deliveredAt: (newStatus === 'entregue' || newStatus === 'acerto') ? (showOrderDetail.deliveredAt || now) : showOrderDetail.deliveredAt,
              lastModified: now,
              updatedAt: now
            }
            setOrders(prev => {
              const next = prev.map(o => String(o.id) === String(showOrderDetail.id) ? updatedOrder : o)
              LS.set(STORAGE_ORDERS, next)
              return next
            })
            upsertOrder(updatedOrder)
            setFinancial(prev => {
              const existingIds = new Set(prev.filter(f => String(f.orderId) === String(showOrderDetail.id)).map(f => f.id))
              const newRecords = editedItems
                .filter(i => !existingIds.has(showOrderDetail.id + '-' + i.id))
                .map(i => ({
                  id: showOrderDetail.id + '-' + i.id,
                  orderId: showOrderDetail.id,
                  customerName: showOrderDetail.customer?.nome || '',
                  itemName: i.nome,
                  qty: i.qty,
                  value: Math.round((Number(i.preco) || 0) * (Number(i.qty) || 0) * 100) / 100,
                  precoCusto: Math.round((Number(i.preco_custo) || 0) * (Number(i.qty) || 0) * 100) / 100,
                  dueDate: showOrderDetail.dataVencimento || hoje(),
                  paidDate: null,
                  status: i.tipo === 'aprazo' ? 'pendente' : 'pago',
                  paymentMethod: showOrderDetail.paymentMethod || ''
                }))
              const updated = prev.map(f => {
                if (String(f.orderId) !== String(showOrderDetail.id)) return f
                const item = editedItems.find(i => f.id === showOrderDetail.id + '-' + i.id)
                if (!item) return f
                return {
                  ...f,
                  qty: item.qty,
                  value: Math.round((Number(item.preco) || 0) * (Number(item.qty) || 0) * 100) / 100,
                  precoCusto: Math.round((Number(item.preco_custo) || 0) * (Number(item.qty) || 0) * 100) / 100,
                  status: f.status,
                  paidDate: f.paidDate
                }
              })
              const mergedFin = [...updated, ...newRecords]
              LS.set(STORAGE_FINANCIAL, mergedFin)
              const orderFinRecords = mergedFin.filter(f => String(f.orderId) === String(showOrderDetail.id))
              if (orderFinRecords.length > 0) {
                upsertFinancial(orderFinRecords)
              }
              return mergedFin
            })
            showToast(newStatus === 'entregue' ? `Pedido #${showOrderDetail.id} finalizado e enviado para Entregues!` : (newStatus === 'acerto' ? `Pedido #${showOrderDetail.id} atualizado em Acertos!` : `Pedido #${showOrderDetail.id} enviado para a rota!`))
            setShowOrderDetail(null)
            const ESTADOS = ['pre-pedido', 'pendente', 'confirmado', 'em-andamento', 'em-rota', 'entregue', 'acerto']
            const idxFrom = ESTADOS.indexOf(currentStatus)
            const idxTo = ESTADOS.indexOf(newStatus)
            if ((ESTADOS.includes(currentStatus) && idxTo > idxFrom) || (!ESTADOS.includes(currentStatus) && ESTADOS.includes(newStatus))) {
              sendStatusWebhook(updatedOrder, newStatus)
            }
          }}
          onEditSave={(editedItems) => {
            const now = Date.now()
            const totalAvista = Math.round(editedItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0) * 100) / 100
            const totalAprazo = Math.round(editedItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0) * 100) / 100
            const calcTotal = Math.round((totalAvista + totalAprazo) * 100) / 100
            const updatedOrder = {
              ...showOrderDetail,
              items: editedItems,
              itens: editedItems,
              originalItems: editedItems.map(i => ({ ...i })),
              totalAvista,
              totalAprazo,
              total: calcTotal,
              totalNota: calcTotal,
              totalOriginal: calcTotal,
              lastModified: now,
              updatedAt: now
            }
            setOrders(prev => {
              const next = prev.map(o => String(o.id) === String(showOrderDetail.id) ? updatedOrder : o)
              LS.set(STORAGE_ORDERS, next)
              return next
            })
            upsertOrder(updatedOrder)
            setFinancial(prev => {
              const existingIds = new Set(prev.filter(f => String(f.orderId) === String(showOrderDetail.id)).map(f => f.id))
              const newRecords = editedItems
                .filter(i => !existingIds.has(showOrderDetail.id + '-' + i.id))
                .map(i => ({
                  id: showOrderDetail.id + '-' + i.id,
                  orderId: showOrderDetail.id,
                  customerName: showOrderDetail.customer?.nome || '',
                  itemName: i.nome,
                  qty: i.qty,
                  value: i.preco * i.qty,
                  precoCusto: (i.preco_custo || 0) * i.qty,
                  dueDate: showOrderDetail.dataVencimento || hoje(),
                  paidDate: showOrderDetail.deliveredAt ? hoje() : null,
                  status: showOrderDetail.status === 'entregue' ? 'pago' : (i.tipo === 'aprazo' ? 'pendente' : 'pago'),
                  paymentMethod: showOrderDetail.paymentMethod || ''
                }))
              const updated = prev.map(f => {
                if (String(f.orderId) !== String(showOrderDetail.id)) return f
                const item = editedItems.find(i => f.id === showOrderDetail.id + '-' + i.id)
                if (!item) return f
                return {
                  ...f,
                  qty: item.qty,
                  value: item.preco * item.qty,
                  precoCusto: (item.preco_custo || 0) * item.qty,
                  paidDate: showOrderDetail.status === 'entregue' && !f.paidDate ? hoje() : f.paidDate
                }
              })
              const mergedFin = [...updated, ...newRecords]
              LS.set(STORAGE_FINANCIAL, mergedFin)
              const orderFinRecords = mergedFin.filter(f => String(f.orderId) === String(showOrderDetail.id))
              if (orderFinRecords.length > 0) {
                upsertFinancial(orderFinRecords)
              }
              return mergedFin
            })
            showToast('Itens salvos com sucesso!')
            setShowOrderDetail({ ...updatedOrder, items: editedItems.map(i => ({ ...i })), itens: editedItems.map(i => ({ ...i })), originalItems: editedItems.map(i => ({ ...i })) })
          }}
          onSyncCusto={(prodId, custo) => {
            if (prodId == null) return
            updateProduct(prodId, { preco_custo: custo === null ? null : Number(custo) })
          }}
          onUpdateCustomer={(id, customerData) => updateOrderCustomer(id, customerData)}
          onCancelOrder={(id) => cancelOrder(id)}
        />
      )}

      {/* MODAL ACERTO & FINALIZAÇÃO */}
      {showDeliveryModal && (
        <div className="admin-overlay" onClick={() => setShowDeliveryModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <div className="admin-modal-header">
              <h3>
                <i className={deliveryModalMode === 'finalizar' ? 'fa-solid fa-circle-check' : 'fa-solid fa-handshake'} style={{ color: deliveryModalMode === 'finalizar' ? 'var(--success)' : '#6366f1' }}></i>
                {deliveryModalMode === 'finalizar' ? ' Finalizar Pedido' : ' Acerto do Pedido'} #{showDeliveryModal.id.toString().slice(-6)}
              </h3>
              <button className="admin-modal-close" onClick={() => setShowDeliveryModal(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '0.5rem 0.75rem', marginBottom: '0.75rem' }}>
                <p style={{ fontSize: '0.78rem', color: '#1e40af', margin: 0 }}>
                  <i className="fa-solid fa-info-circle"></i> O cliente receberá a mensagem formatada de <strong>{deliveryModalMode === 'finalizar' ? 'Pedido Finalizado' : 'Acerto'}</strong> no WhatsApp.
                </p>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginTop: '0.35rem' }}>
                  <input type="text" readOnly value={(() => { try { return buildOrderLink(showDeliveryModal.id) } catch { return '' } })()}
                    style={{ flex: 1, fontSize: '0.7rem', padding: '0.2rem 0.35rem', borderRadius: '4px', border: '1px solid #bfdbfe', background: 'white', color: '#1e40af' }}
                    onClick={e => e.target.select()} />
                  <button className="admin-btn" style={{ fontSize: '0.65rem', padding: '0.2rem 0.4rem', background: '#2563eb', color: 'white', borderColor: '#2563eb' }}
                    onClick={() => { navigator.clipboard?.writeText(buildOrderLink(showDeliveryModal.id)); alert('Link copiado!') }}>
                    <i className="fa-solid fa-copy"></i>
                  </button>
                </div>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--admin-text-sec)', marginBottom: '0.75rem' }}>
                Informe a quantidade de itens <strong>devolvidos</strong> (não vendidos). Apenas os itens vendidos serão cobrados.
              </p>

              {(() => {
                const modalBase = (Array.isArray(showDeliveryModal.baseItems) && showDeliveryModal.baseItems.length > 0)
                  ? showDeliveryModal.baseItems
                  : getOrderBaseItems(showDeliveryModal, produtosAtuais)
                return modalBase.map((i, idx) => {
                  const key = i.id != null ? String(i.id) : (i.nome ? String(i.nome) : String(idx))
                  const maxQty = Number(i.qty) || 0
                  const retVal = returnQuantities[key] !== undefined ? returnQuantities[key] : (i.nome && returnQuantities[i.nome] !== undefined ? returnQuantities[i.nome] : '')
                  const currentPrice = deliveryItemPrices[key] !== undefined ? deliveryItemPrices[key] : (i.preco ?? '')
                  const currentPriceNum = Number(String(currentPrice).replace(',', '.')) || 0
                  const currentCost = deliveryItemCosts[key] !== undefined ? deliveryItemCosts[key] : (i.preco_custo ?? (getItemCost(i, produtosAtuais) || ''))
                  return (
                    <div key={key} style={{ padding: '0.65rem 0', borderBottom: '1px solid var(--admin-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{i.nome} ({maxQty}x)</span>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent)' }}>{formatPreco(currentPriceNum * maxQty)}</span>
                      </div>

                      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.45rem', background: '#f8fafc', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.74rem', color: 'var(--admin-text-sec)', margin: 0 }}>
                          <span style={{ fontWeight: 600 }}>Preço: R$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={currentPrice}
                            placeholder="0,00"
                            onChange={e => setDeliveryItemPrices(prev => ({ ...prev, [key]: cleanDecimalInput(e.target.value) }))}
                            style={{ width: '70px', padding: '0.2rem 0.35rem', borderRadius: '4px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', textAlign: 'right', background: 'white' }}
                          />
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.74rem', color: '#059669', margin: 0 }}>
                          <span style={{ fontWeight: 600 }}><i className="fa-solid fa-tag"></i> Custo: R$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={currentCost}
                            placeholder="0,00"
                            onChange={e => setDeliveryItemCosts(prev => ({ ...prev, [key]: cleanDecimalInput(e.target.value) }))}
                            style={{ width: '70px', padding: '0.2rem 0.35rem', borderRadius: '4px', border: '1px solid #10b981', fontSize: '0.78rem', textAlign: 'right', background: 'white' }}
                          />
                        </label>
                        <span className={`split-badge ${i.tipo === 'avista' ? 'vista' : 'aprazo'}`} style={{ fontSize: '0.68rem', padding: '0.1rem 0.35rem' }}>
                          {i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem' }}>
                          <span style={{ color: 'var(--admin-text-sec)', fontWeight: 500 }}>Devolver:</span>
                          <input type="number" min="0" max={maxQty} step="1" value={retVal}
                            placeholder="0"
                            onChange={e => {
                              const raw = e.target.value
                              if (raw === '') {
                                setReturnQuantities(prev => { const n = { ...prev }; delete n[key]; return n })
                                return
                              }
                              const num = Math.max(0, Math.min(Number(raw), maxQty))
                              setReturnQuantities(prev => ({ ...prev, [key]: num }))
                            }}
                            style={{ width: '60px', padding: '0.25rem 0.35rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', textAlign: 'center' }}
                          />
                        </div>
                        <button type="button" className="admin-btn admin-btn-sec" style={{ fontSize: '0.68rem', padding: '0.2rem 0.45rem' }} onClick={() => setReturnQuantities(prev => ({ ...prev, [key]: maxQty }))}>Todos ({maxQty})</button>
                        <button type="button" className="admin-btn admin-btn-sec" style={{ fontSize: '0.68rem', padding: '0.2rem 0.45rem' }} onClick={() => setReturnQuantities(prev => { const n = { ...prev }; delete n[key]; return n })}>Zerar</button>
                      </div>
                    </div>
                  )
                })
              })()}

              {/* Auto-calc summary */}
              {(() => {
                const modalBase = (Array.isArray(showDeliveryModal.baseItems) && showDeliveryModal.baseItems.length > 0)
                  ? showDeliveryModal.baseItems
                  : getOrderBaseItems(showDeliveryModal, produtosAtuais)
                const totalOriginal = modalBase.reduce((s, i, idx) => {
                  const key = i.id != null ? String(i.id) : (i.nome ? String(i.nome) : String(idx))
                  const p = deliveryItemPrices[key] !== undefined ? (Number(String(deliveryItemPrices[key]).replace(',', '.')) || 0) : (Number(i.preco) || 0)
                  return s + p * (Number(i.qty) || 0)
                }, 0)
                const totalDevolvido = modalBase.reduce((s, i, idx) => {
                  const key = i.id != null ? String(i.id) : (i.nome ? String(i.nome) : String(idx))
                  const p = deliveryItemPrices[key] !== undefined ? (Number(String(deliveryItemPrices[key]).replace(',', '.')) || 0) : (Number(i.preco) || 0)
                  const ret = returnQuantities[key] !== undefined ? Number(returnQuantities[key]) : (i.nome && returnQuantities[i.nome] !== undefined ? Number(returnQuantities[i.nome]) : 0)
                  return s + p * (Number(ret) || 0)
                }, 0)
                const base = Math.max(0, totalOriginal - totalDevolvido)
                const discRaw = Number(String(deliveryDiscount).replace(',', '.')) || 0
                const desconto = deliveryDiscountType === 'percent'
                  ? (Math.min(100, Math.max(0, discRaw)) / 100) * base
                  : Math.max(0, Math.min(discRaw, base))
                const totalCobrar = Math.round((base - desconto) * 100) / 100

                const isSplit = deliveryPayment.includes('+')
                let totalPagoCalc = 0
                if (isSplit) {
                  totalPagoCalc = deliveryPayment.split('+').reduce((sum, m) => {
                    return sum + (Number(String(deliverySplits[m] || 0).replace(',', '.')) || 0)
                  }, 0)
                } else {
                  totalPagoCalc = Number(String(deliveryPaid || 0).replace(',', '.')) || 0
                }
                const totalPago = Math.round(totalPagoCalc * 100) / 100
                const faltaPagar = Math.max(0, Math.round((totalCobrar - totalPago) * 100) / 100)

                const pecasOrig = modalBase.reduce((s, i) => s + (Number(i.qty) || 0), 0)
                const pecasDev = modalBase.reduce((s, i, idx) => {
                  const key = i.id != null ? String(i.id) : (i.nome ? String(i.nome) : String(idx))
                  const ret = returnQuantities[key] !== undefined ? Number(returnQuantities[key]) : (i.nome && returnQuantities[i.nome] !== undefined ? Number(returnQuantities[i.nome]) : 0)
                  return s + (Number(ret) || 0)
                }, 0)
                const pecasPagas = Math.max(0, pecasOrig - pecasDev)

                return (
                  <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1rem', marginTop: '0.75rem', border: '1px solid var(--admin-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem' }}>
                      <span>Total original</span>
                      <span><strong>{formatPreco(totalOriginal)}</strong> ({pecasOrig} peças)</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem', color: 'var(--danger)' }}>
                      <span><i className="fa-solid fa-rotate-left"></i> Total devolvido</span>
                      <span style={{ fontWeight: 700 }}>{formatPreco(totalDevolvido)} ({pecasDev} peças)</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem' }}>
                      <span>Itens pagos (subtotal)</span>
                      <span style={{ fontWeight: 600 }}>{formatPreco(base)} ({pecasPagas} peças)</span>
                    </div>

                    <div style={{ marginTop: '0.4rem', paddingTop: '0.35rem', borderTop: '1px solid var(--admin-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                        <p style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', margin: 0 }}>
                          <i className="fa-solid fa-percent"></i> Desconto
                        </p>
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          {['30', '20', '10', '0'].map(pct => (
                            <button key={pct} type="button"
                              className={`pag-chip ${deliveryDiscountType === 'percent' && String(deliveryDiscount) === pct ? 'active' : ''}`}
                              style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem' }}
                              onClick={() => { setDeliveryDiscountType('percent'); setDeliveryDiscount(pct) }}>
                              {pct}%
                            </button>
                          ))}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                        <button type="button" className={`pag-chip ${deliveryDiscountType === 'reais' ? 'active' : ''}`} onClick={() => { setDeliveryDiscountType('reais'); setDeliveryDiscount('') }}>R$ Real</button>
                        <button type="button" className={`pag-chip ${deliveryDiscountType === 'percent' ? 'active' : ''}`} onClick={() => { setDeliveryDiscountType('percent'); setDeliveryDiscount('30') }}>% Porcentagem</button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ fontSize: '0.82rem', color: 'var(--admin-text-sec)' }}>
                          {deliveryDiscountType === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'}
                        </span>
                        <input type="text" inputMode="decimal"
                          placeholder="0" autoComplete="off"
                          value={deliveryDiscount}
                          onChange={e => {
                            const raw = e.target.value.replace(/[^0-9.,]/g, '')
                            setDeliveryDiscount(raw)
                          }}
                          style={{ width: '110px', padding: '0.3rem 0.4rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', textAlign: 'right' }} />
                      </div>
                    </div>
                    {desconto > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginTop: '0.25rem', color: 'var(--preco-desconto, var(--success))' }}>
                        <span>Desconto aplicado</span>
                        <span style={{ fontWeight: 700 }}>- {formatPreco(desconto)}</span>
                      </div>
                    )}
                    <div style={{ borderTop: '1px solid var(--admin-border)', marginTop: '0.35rem', paddingTop: '0.35rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                      <span style={{ fontWeight: 700 }}>Total a cobrar (comanda)</span>
                      <span style={{ fontWeight: 800, color: totalCobrar > 0 ? 'var(--accent)' : 'var(--success)' }}>{formatPreco(totalCobrar)}</span>
                    </div>

                    {/* Forma de Pagamento e Valores */}
                    <div style={{ marginTop: '0.75rem', paddingTop: '0.6rem', borderTop: '1px solid var(--admin-border)' }}>
                      <p style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                        <i className="fa-solid fa-credit-card"></i> Forma de pagamento do cliente
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem' }}>
                        {Object.entries(PAG_METHODS).map(([id, conf]) => (
                          <button key={id} type="button"
                            className={`pag-chip ${deliveryPayment === id ? 'active' : ''}`}
                            onClick={() => {
                              setDeliveryPayment(id)
                              if (!id.includes('+')) {
                                setDeliverySplits({ pix: '', dinheiro: '', cartao: '' })
                                if (totalCobrar > 0 && (!deliveryPaid || deliveryPaid === '0')) {
                                  setDeliveryPaid(String(totalCobrar))
                                }
                              }
                            }}>
                            <i className={`fa-solid ${conf.icon}`}></i> {conf.label}
                          </button>
                        ))}
                      </div>

                      {/* Split Inputs */}
                      {deliveryPayment.includes('+') && (
                        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.6rem 0.75rem', marginBottom: '0.5rem' }}>
                          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                            <i className="fa-solid fa-arrows-left-right"></i> Informe quanto foi pago em cada forma:
                          </p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                            {deliveryPayment.split('+').map(m => {
                              const thisVal = deliverySplits[m] || ''
                              const otherSplitsSum = deliveryPayment.split('+')
                                .filter(x => x !== m)
                                .reduce((s, x) => s + (Number(String(deliverySplits[x] || 0).replace(',', '.')) || 0), 0)
                              const remainingForThis = Math.max(0, Math.round((totalCobrar - otherSplitsSum) * 100) / 100)

                              return (
                                <div key={m} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', background: 'white', padding: '0.35rem 0.6rem', borderRadius: '6px', border: '1px solid var(--admin-border)' }}>
                                  <span style={{ fontSize: '0.82rem', fontWeight: 600, minWidth: '70px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <i className={`fa-solid ${PAG_METHODS[m]?.icon || 'fa-money-bill'}`}></i>
                                    {PAG_METHODS[m]?.label}:
                                  </span>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-sec)' }}>R$</span>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0,00"
                                      value={thisVal}
                                      onChange={e => {
                                        const raw = e.target.value.replace(/[^0-9.,]/g, '')
                                        setDeliverySplits(prev => ({ ...prev, [m]: raw }))
                                      }}
                                      style={{ width: '95px', padding: '0.25rem 0.4rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', textAlign: 'right' }}
                                    />
                                    <button
                                      type="button"
                                      className="admin-btn admin-btn-sec"
                                      title={`Preencher restante (${formatPreco(remainingForThis)})`}
                                      style={{ fontSize: '0.68rem', padding: '0.25rem 0.45rem', whiteSpace: 'nowrap' }}
                                      onClick={() => {
                                        setDeliverySplits(prev => ({ ...prev, [m]: String(remainingForThis) }))
                                      }}>
                                      Restante
                                    </button>
                                    <button
                                      type="button"
                                      className="admin-btn admin-btn-sec"
                                      title="Deixar esta forma em aberto (R$ 0)"
                                      style={{ fontSize: '0.68rem', padding: '0.25rem 0.45rem', whiteSpace: 'nowrap', color: '#b45309', borderColor: '#fcd34d', background: '#fffbeb' }}
                                      onClick={() => {
                                        setDeliverySplits(prev => ({ ...prev, [m]: '0' }))
                                      }}>
                                      Em Aberto
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', paddingTop: '0.4rem', borderTop: '1px solid #e2e8f0', fontSize: '0.82rem' }}>
                            <span>Total pago: <strong style={{ color: totalPago >= totalCobrar ? 'var(--success)' : 'var(--accent)' }}>{formatPreco(totalPago)}</strong></span>
                            <span style={{ color: faltaPagar > 0 ? '#b45309' : 'var(--success)', fontWeight: 700, background: faltaPagar > 0 ? '#fef3c7' : '#dcfce7', padding: '0.2rem 0.55rem', borderRadius: '6px', border: faltaPagar > 0 ? '1px solid #fde68a' : '1px solid #bbf7d0' }}>
                              {faltaPagar > 0 ? `⏳ EM ABERTO (Vencimento): ${formatPreco(faltaPagar)}` : '✅ Quitado'}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Single Input */}
                      {!deliveryPayment.includes('+') && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.6rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--admin-text)' }}>
                            <i className="fa-solid fa-hand-holding-dollar"></i> Quanto o cliente pagou ({PAG_METHODS[deliveryPayment]?.label}):
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-sec)' }}>R$</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder={String(totalCobrar.toFixed(2)).replace('.', ',')}
                              autoComplete="off"
                              value={deliveryPaid}
                              onChange={e => {
                                const raw = e.target.value.replace(/[^0-9.,]/g, '')
                                setDeliveryPaid(raw)
                              }}
                              style={{ width: '95px', padding: '0.25rem 0.4rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', textAlign: 'right' }}
                            />
                            <button
                              type="button"
                              className="admin-btn admin-btn-sec"
                              style={{ fontSize: '0.68rem', padding: '0.25rem 0.45rem', whiteSpace: 'nowrap' }}
                              onClick={() => setDeliveryPaid(String(totalCobrar))}>
                              Pagar total
                            </button>
                            <button
                              type="button"
                              className="admin-btn admin-btn-sec"
                              title="Pagar 50% agora e deixar o restante em aberto até o vencimento"
                              style={{ fontSize: '0.68rem', padding: '0.25rem 0.45rem', whiteSpace: 'nowrap', color: '#2563eb', borderColor: '#bfdbfe', background: '#eff6ff' }}
                              onClick={() => setDeliveryPaid(String((totalCobrar / 2).toFixed(2)))}>
                              Metade (50%)
                            </button>
                            <button
                              type="button"
                              className="admin-btn admin-btn-sec"
                              title="Zerar valor pago para ficar 100% em aberto até o vencimento"
                              style={{ fontSize: '0.68rem', padding: '0.25rem 0.45rem', whiteSpace: 'nowrap', color: '#b45309', borderColor: '#fcd34d', background: '#fffbeb' }}
                              onClick={() => setDeliveryPaid('0')}>
                              Em Aberto
                            </button>
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', marginTop: '0.4rem', padding: '0.4rem 0.65rem', borderRadius: '6px', background: faltaPagar > 0 ? '#fffbeb' : '#f0fdf4', border: faltaPagar > 0 ? '1px solid #fde68a' : '1px solid #bbf7d0', color: faltaPagar > 0 ? '#b45309' : 'var(--success)' }}>
                        <span style={{ fontWeight: 700 }}>
                          {faltaPagar > 0 ? '⏳ EM ABERTO (a pagar no vencimento):' : '✅ Quitado integralmente:'}
                        </span>
                        <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>{formatPreco(faltaPagar)}</span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Datas da comanda */}
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  <i className="fa-solid fa-calendar"></i> Datas da comanda
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '140px' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem', color: 'var(--admin-text-sec)' }}>Data de início</label>
                    <input type="date" value={deliveryDataInicio} onChange={e => setDeliveryDataInicio(e.target.value)}
                      style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.82rem' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: '140px' }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, marginBottom: '0.25rem', color: 'var(--admin-text-sec)' }}>Data de vencimento</label>
                    <input type="date" value={deliveryDataVenc} onChange={e => setDeliveryDataVenc(e.target.value)}
                      style={{ width: '100%', padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.82rem' }} />
                  </div>
                </div>
              </div>

              {/* Modal Actions */}
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="admin-btn admin-btn-sec" onClick={() => setShowDeliveryModal(null)}>Cancelar</button>

                {deliveryModalMode === 'acerto' && (
                  <>
                    <button className="admin-btn" style={{ background: '#6366f1', color: 'white', borderColor: '#6366f1' }}
                      onClick={() => salvarAcerto(showDeliveryModal.id, false)}>
                      <i className="fa-solid fa-handshake"></i> Salvar e Mover para Acertos
                    </button>
                    <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }}
                      onClick={() => salvarAcerto(showDeliveryModal.id, true)}>
                      <i className="fa-solid fa-check-double"></i> Finalizar Pedido Agora
                    </button>
                  </>
                )}

                {deliveryModalMode === 'finalizar' && (
                  <>
                    <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }}
                      onClick={() => salvarAcerto(showDeliveryModal.id, false)}>
                      <i className="fa-solid fa-floppy-disk"></i> Salvar Alterações
                    </button>
                    <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }}
                      onClick={() => salvarAcerto(showDeliveryModal.id, true)}>
                      <i className="fa-solid fa-check-double"></i> Finalizar Pedido
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL BULK PRICE */}
      {showBulkPrice && (
        <div className="admin-overlay" onClick={() => { setShowBulkPrice(false); setBulkPriceValue('') }}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-dollar-sign"></i> Trocar Preço em Massa</h3>
              <button className="admin-modal-close" onClick={() => { setShowBulkPrice(false); setBulkPriceValue('') }}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--admin-text-sec)' }}>
                Defina um novo preço para <strong>{prodSelectedIds.size} produto(s)</strong> selecionado(s):
              </p>
              <div className="form-group">
                <label>Novo preço (R$)</label>
                <input type="text" inputMode="decimal" placeholder="0,00" value={bulkPriceValue} onChange={e => setBulkPriceValue(cleanDecimalInput(e.target.value))} autoFocus />
              </div>
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => { setShowBulkPrice(false); setBulkPriceValue('') }}>Cancelar</button>
                <button className="admin-btn admin-btn-primary" disabled={!bulkPriceValue} onClick={applyBulkPrice}>
                  <i className="fa-solid fa-check"></i> Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBulkStock && (
        <div className="admin-overlay" onClick={() => { setShowBulkStock(false); setBulkStockValue('') }}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-warehouse"></i> Definir Estoque em Massa</h3>
              <button className="admin-modal-close" onClick={() => { setShowBulkStock(false); setBulkStockValue('') }}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--admin-text-sec)' }}>
                Defina a quantidade em estoque para <strong>{prodSelectedIds.size} produto(s)</strong> selecionado(s):
              </p>
              <div className="form-group">
                <label>Quantidade</label>
                <input type="number" step="1" min="0" placeholder="0" value={bulkStockValue} onChange={e => setBulkStockValue(e.target.value)} autoFocus />
              </div>
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => { setShowBulkStock(false); setBulkStockValue('') }}>Cancelar</button>
                <button className="admin-btn admin-btn-primary" disabled={bulkStockValue === ''} onClick={applyBulkStock}>
                  <i className="fa-solid fa-check"></i> Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {customMsgRota && (
        <div className="admin-overlay" onClick={() => { setCustomMsgRota(null); setCustomMsgText('') }}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-pen"></i> Mensagem Personalizada</h3>
              <button className="admin-modal-close" onClick={() => { setCustomMsgRota(null); setCustomMsgText('') }}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--admin-text-sec)' }}>
                Enviar mensagem personalizada para <strong>{customMsgRota.total} contatos</strong> da rota <strong>{customMsgRota.rota}</strong>:
              </p>
              <div className="form-group">
                <label>Texto da mensagem</label>
                <textarea
                  placeholder="Digite a mensagem que será enviada..."
                  value={customMsgText}
                  onChange={e => setCustomMsgText(e.target.value)}
                  rows={5}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit' }}
                  autoFocus
                />
              </div>
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => { setCustomMsgRota(null); setCustomMsgText('') }}>Cancelar</button>
                <button className="admin-btn admin-btn-primary" disabled={!customMsgText.trim()} onClick={() => {
                  sendAlertRota('personalizado', customMsgRota.contatos, orders, customMsgText.trim())
                  showToast(`Mensagem enviada para ${customMsgRota.total} contatos`)
                  setCustomMsgRota(null)
                  setCustomMsgText('')
                }}>
                  <i className="fa-solid fa-paper-plane"></i> Enviar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showNewRota && (
        <div className="admin-overlay" onClick={() => setShowNewRota(false)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-plus-circle"></i> Nova Rota</h3>
              <button className="admin-modal-close" onClick={() => setShowNewRota(false)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <div className="form-group">
                <label>Nome da Rota</label>
                <input type="text" placeholder="Ex: Zona Norte" value={newRotaName} onChange={e => setNewRotaName(e.target.value)} autoFocus />
              </div>
              <div style={{ marginBottom: '0.75rem', padding: '0.65rem', background: '#f9fafb', borderRadius: '8px', border: '1px dashed var(--admin-border)' }}>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.82rem', fontWeight: 600 }}>Adicionar Contato Manual</label>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                  <input type="text" placeholder="Telefone (obrigatório)" value={newContactPhone} onChange={e => setNewContactPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} style={{ flex: 1, minWidth: '140px', padding: '0.4rem 0.55rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.8rem' }} />
                  <input type="text" placeholder="Nome (opcional)" value={newContactName} onChange={e => setNewContactName(e.target.value)} style={{ flex: 1, minWidth: '140px', padding: '0.4rem 0.55rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.8rem' }} />
                  <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.35rem 0.7rem', background: '#059669', color: 'white', borderColor: '#059669' }} disabled={!newContactPhone} onClick={() => {
                    const nums = newContactPhone.replace(/\D/g, '')
                    if (nums.length < 10) { showToast('Telefone inválido — mínimo 10 dígitos', 'error'); return }
                    const normalized = nums.startsWith('55') ? nums : '55' + nums
                    const allExisting = [...rotas, ...newRotaSelected]
                    if (allExisting.some(r => (r.remoteJid || '').includes(normalized))) { showToast('Este telefone já está na lista', 'error'); return }
                    const name = newContactName.trim() || 'Contato'
                    setNewRotaSelected(prev => [...prev, { remoteJid: `${normalized}@s.whatsapp.net`, pushName: name, nome: name, cidade: 'Personalizado' }])
                    setNewContactPhone('')
                    setNewContactName('')
                    showToast(`${name} adicionado à seleção`)
                  }}>
                    <i className="fa-solid fa-plus"></i> Adicionar
                  </button>
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--admin-text-sec)', margin: 0 }}>Digite apenas números — o sistema normaliza automaticamente com 55</p>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', marginBottom: '0.3rem', fontSize: '0.82rem', fontWeight: 600 }}>Buscar Contatos Existentes</label>
                <div className="admin-search-prod" style={{ marginBottom: '0.5rem' }}>
                  <i className="fa-solid fa-search"></i>
                  <input type="text" placeholder="Buscar contatos..." value={newRotaSearch} onChange={e => setNewRotaSearch(e.target.value)} style={{ width: '100%' }} />
                </div>
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: '8px' }}>
                  {rotas.filter(r => {
                    if (!newRotaSearch.trim()) return false
                    const phone = r.remoteJid?.replace(/@.*/, '').replace(/\D/g, '') || ''
                    return clientMatchesSearch({ nome: r.pushName, pushName: r.pushName, telefone: phone, cidade: r.cidade }, newRotaSearch)
                  }).slice(0, 50).map((r, i) => {
                    const phone = r.remoteJid?.replace(/@.*/, '').replace(/\D/g, '') || ''
                    const isSelected = newRotaSelected.some(s => s.remoteJid === r.remoteJid)
                    return (
                      <div key={i} className="add-prod-row" style={{ padding: '0.35rem 0.5rem' }}>
                        <div className="add-prod-info" style={{ flex: 1, minWidth: 0 }}>
                          <span className="add-prod-name" style={{ fontSize: '0.82rem' }}>{r.pushName || 'Sem nome'}</span>
                          <span className="add-prod-price" style={{ fontSize: '0.72rem' }}>{phone} {r.cidade ? `- ${r.cidade}` : ''}</span>
                        </div>
                        <button className={`add-prod-add ${isSelected ? 'in-cart' : ''}`} style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem' }}
                          onClick={() => {
                            if (isSelected) setNewRotaSelected(prev => prev.filter(s => s.remoteJid !== r.remoteJid))
                            else setNewRotaSelected(prev => [...prev, { ...r, cidade: r.cidade || 'Sem cidade' }])
                          }}>
                          {isSelected ? <><i className="fa-solid fa-check"></i> Adicionado</> : <><i className="fa-solid fa-plus"></i> Adicionar</>}
                        </button>
                      </div>
                    )
                  })}
                  {newRotaSearch && rotas.filter(r => {
                    const phone = r.remoteJid?.replace(/@.*/, '').replace(/\D/g, '') || ''
                    return clientMatchesSearch({ nome: r.pushName, pushName: r.pushName, telefone: phone, cidade: r.cidade }, newRotaSearch)
                  }).length === 0 && (
                    <p style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--admin-text-sec)' }}>Nenhum contato encontrado</p>
                  )}
                </div>
              </div>
              {newRotaSelected.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <p style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>{newRotaSelected.length} contato(s) selecionado(s):</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                    {newRotaSelected.map((s, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.5rem', background: '#eef2ff', borderRadius: '50px', fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 500 }}>
                        {s.pushName || s.remoteJid?.replace(/@.*/, '')}
                        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 0, fontSize: '0.75rem' }} onClick={() => setNewRotaSelected(prev => prev.filter(x => x.remoteJid !== s.remoteJid))}>
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setShowNewRota(false)}>Cancelar</button>
                <button className="admin-btn admin-btn-primary" disabled={!newRotaName.trim() || newRotaSelected.length === 0} onClick={() => {
                  const grouped = {}
                  newRotaSelected.forEach(s => {
                    const cid = s.cidade || 'Sem cidade'
                    if (!grouped[cid]) grouped[cid] = { cidade: cid, contatos: [] }
                    grouped[cid].contatos.push(s)
                  })
                  const novaRota = { rota: newRotaName.trim(), cidades: Object.values(grouped) }
                  setCustomRotas(prev => [...prev, novaRota])
                  showToast(`Rota "${newRotaName.trim()}" criada com ${newRotaSelected.length} contato(s)`)
                  setShowNewRota(false)
                  setNewRotaName('')
                  setNewRotaSearch('')
                  setNewRotaSelected([])
                }}>
                  <i className="fa-solid fa-check"></i> Criar Rota
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {rotaContactModal && (
        <div className="admin-overlay" onClick={() => setRotaContactModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-user-plus"></i> {rotaContactModal.mode === 'edit' ? 'Editar Contato' : 'Adicionar Contato'}</h3>
              <button className="admin-modal-close" onClick={() => setRotaContactModal(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--admin-text-sec)' }}>
                Rota: <strong>{(rotaContactModal.rota)}</strong>
              </p>
              <div className="form-group">
                <label>Nome</label>
                <input type="text" placeholder="Nome do contato" value={rotaContactModal.nomeState ?? ''} onChange={e => setRotaContactModal(m => ({ ...m, nomeState: e.target.value }))} autoFocus />
              </div>
              <div className="form-group">
                <label>Telefone (com DDD, só números)</label>
                <input type="text" placeholder="31999999999" value={rotaContactModal.phoneState ?? ''} onChange={e => setRotaContactModal(m => ({ ...m, phoneState: e.target.value.replace(/\D/g, '').slice(0, 11) }))} />
              </div>
              <div className="form-group">
                <label>Cidade</label>
                <input type="text" placeholder="Cidade" value={rotaContactModal.cityState ?? ''} onChange={e => setRotaContactModal(m => ({ ...m, cityState: e.target.value }))} />
              </div>
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setRotaContactModal(null)}>Cancelar</button>
                <button className="admin-btn admin-btn-primary" disabled={(rotaContactModal.phoneState || '').replace(/\D/g, '').length < 10} onClick={() => {
                  confirmRotaContact({
                    rota: rotaContactModal.rota,
                    mode: rotaContactModal.mode,
                    oldContact: rotaContactModal.contato,
                    novoNome: (rotaContactModal.nomeState || '').trim() || 'Sem nome',
                    novoTelefone: rotaContactModal.phoneState || '',
                    novoCidade: (rotaContactModal.cityState || '').trim(),
                    custom: rotaContactModal.custom
                  })
                }}>
                  <i className="fa-solid fa-check"></i> Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRestoreRota && (
        <div className="admin-overlay" onClick={() => setShowRestoreRota(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-rotate-left"></i> Restaurar contatos</h3>
              <button className="admin-modal-close" onClick={() => setShowRestoreRota(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.82rem', color: 'var(--admin-text-sec)' }}>
                Rota: <strong>{showRestoreRota}</strong> — contatos removidos voltarão à rota na próxima sincronização.
              </p>
              {rotaEdits.filter(e => e.rota === showRestoreRota && e.acao === 'remover').map(e => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.75rem', marginBottom: '0.4rem', background: '#fff7ed', borderRadius: '8px', border: '1px solid #fed7aa' }}>
                  <i className="fa-solid fa-user-clock" style={{ color: '#ea580c' }}></i>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{e.contato?.pushName || e.contato?.nome || 'Contato'}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--admin-text-sec)' }}>{e.contato?.remoteJid?.replace(/@.*/, '') || e.contato?.telefone || ''}</div>
                  </div>
                  <button className="admin-btn admin-btn-primary" style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }} onClick={() => {
                    removeRotaEdit(e.id)
                    showToast('Contato restaurado')
                    if (rotaEdits.filter(x => x.rota === showRestoreRota && x.acao === 'remover').length <= 1) setShowRestoreRota(null)
                  }}>
                    <i className="fa-solid fa-rotate-left"></i> Restaurar
                  </button>
                </div>
              ))}
              {rotaEdits.filter(e => e.rota === showRestoreRota && e.acao === 'remover').length === 0 && (
                <p style={{ fontSize: '0.85rem', color: 'var(--admin-text-sec)' }}>Nenhum contato removido nesta rota.</p>
              )}
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setShowRestoreRota(null)}>Fechar</button>
                <button className="admin-btn admin-btn-sec" onClick={() => {
                  rotaEdits.filter(e => e.rota === showRestoreRota && e.acao === 'remover').forEach(e => removeRotaEdit(e.id))
                  showToast('Todos os contatos restaurados')
                  setShowRestoreRota(null)
                }} disabled={rotaEdits.filter(e => e.rota === showRestoreRota && e.acao === 'remover').length === 0}>
                  <i className="fa-solid fa-rotate-left"></i> Restaurar todos
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editCustomContact && (
        <div className="admin-overlay" onClick={() => setEditCustomContact(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-pen"></i> Editar Contato</h3>
              <button className="admin-modal-close" onClick={() => setEditCustomContact(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <div className="form-group">
                <label>Nome</label>
                <input type="text" placeholder="Nome do contato" value={editContactName} onChange={e => setEditContactName(e.target.value)} autoFocus />
              </div>
              <div className="form-group">
                <label>Telefone (com DDD, só números)</label>
                <input type="text" placeholder="31999999999" value={editContactPhone} onChange={e => setEditContactPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} />
              </div>
              <div className="form-group">
                <label>Cidade</label>
                <input type="text" placeholder="Cidade" value={editContactCity} onChange={e => setEditContactCity(e.target.value)} />
              </div>
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setEditCustomContact(null)}>Cancelar</button>
                <button className="admin-btn admin-btn-primary" disabled={!editContactPhone || editContactPhone.replace(/\D/g, '').length < 10} onClick={() => {
                  const nums = editContactPhone.replace(/\D/g, '')
                  const normalized = nums.startsWith('55') ? nums : '55' + nums
                  const oldJid = editCustomContact.contato.remoteJid
                  setCustomRotas(prev => prev.map(cr => cr.rota === editCustomContact.rotaName ? {
                    ...cr,
                    cidades: cr.cidades.map(cid => ({
                      ...cid,
                      contatos: cid.contatos.map(x => x.remoteJid === oldJid ? {
                        ...x,
                        pushName: editContactName.trim() || x.pushName,
                        remoteJid: `${normalized}@s.whatsapp.net`,
                        cidade: editContactCity.trim() || x.cidade
                      } : x)
                    }))
                  } : cr))
                  showToast('Contato atualizado')
                  setEditCustomContact(null)
                }}>
                  <i className="fa-solid fa-check"></i> Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* KIT MODAL */}
      {showKitModal && (
        <KitModal
          produtos={produtosAtuais}
          kit={editingKit}
          onSave={(kit) => {
            const saved = { ...kit, id: kit.id || Date.now().toString(36) + Math.random().toString(36).substring(2, 6), criadoEm: new Date().toISOString() }
            const updated = editingKit ? kits.map(k => k.id === saved.id ? saved : k) : [...kits, saved]
            LS.set('thsm_kits', updated)
            setKits(updated)
            setShowKitModal(false)
            setEditingKit(null)
            showToast(`Kit "${saved.nome}" ${editingKit ? 'atualizado' : 'criado'}! URL: ${window.location.origin}${window.location.pathname}#/kit/${saved.id}`)
          }}
          onClose={() => { setShowKitModal(false); setEditingKit(null) }}
        />
      )}

      {/* Lista de Kits salvos */}
      {kits.length > 0 && tab === 'produtos' && !showKitModal && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <h4 style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#166534' }}>
              <i className="fa-solid fa-toolbox"></i> Kits Criados
            </h4>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {kits.map(kit => (
              <div key={kit.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.3rem 0.65rem', background: 'white', borderRadius: '20px', border: '1px solid #bbf7d0', fontSize: '0.78rem' }}>
                <span style={{ fontWeight: 600 }}>{kit.nome}</span>
                <span style={{ color: 'var(--admin-text-sec)', fontSize: '0.7rem' }}>({(kit.produtoIds || []).length} prod)</span>
                <button style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.75rem', padding: '0.15rem 0.25rem' }} title="Copiar link" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}${window.location.pathname}#/kit/${kit.id}`); showToast('Link copiado!') }}>
                  <i className="fa-solid fa-link"></i>
                </button>
                <button style={{ background: 'none', border: 'none', color: '#f59e0b', cursor: 'pointer', fontSize: '0.75rem', padding: '0.15rem 0.25rem' }} title="Editar" onClick={() => { setEditingKit(kit); setShowKitModal(true) }}>
                  <i className="fa-solid fa-pen"></i>
                </button>
                <button style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.75rem', padding: '0.15rem 0.25rem' }} title="Excluir" onClick={() => { if (confirm(`Excluir kit "${kit.nome}"?`)) { const updated = kits.filter(k => k.id !== kit.id); LS.set('thsm_kits', updated); setKits(updated); showToast('Kit excluído') } }}>
                  <i className="fa-solid fa-trash-can"></i>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL EDIT PRODUCT */}
      {editingProd && (
        <EditProductModal
          product={editingProd}
          categorias={categoriasProd.filter(c => c !== 'TODOS')}
          onAddCategoria={(nome) => {
            if (!nome) return
            setCustomCategorias(prev => prev.includes(nome) ? prev : [...prev, nome])
            showToast(`Categoria "${nome}" criada!`)
          }}
          onSave={(changes) => {
            updateProduct(editingProd.id, changes)
          }}
          onClose={() => setEditingProd(null)}
        />
      )}

      {/* MODAL EDIT FINANCIAL */}
      {finEdit && (
        <div className="admin-overlay" onClick={() => setFinEdit(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="admin-modal-header">
              <h3>Editar Vencimento</h3>
              <button className="admin-modal-close" onClick={() => setFinEdit(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-sec)' }}>{finEdit.itemName} - {formatPreco(finEdit.value)}</p>
              <div className="form-group">
                <label>Nova data de vencimento</label>
                <input type="date" defaultValue={finEdit.dueDate} id="fin-due-input" />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
                <button className="admin-btn" onClick={() => {
                  const val = document.getElementById('fin-due-input').value
                  if (val) updateDueDate(finEdit.id, val)
                  setFinEdit(null)
                }}>Salvar</button>
                <button className="admin-btn admin-btn-sec" onClick={() => setFinEdit(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL QUITAR CONTA (payment method) */}
      {quitarFinTarget && (
        <div className="admin-overlay" onClick={() => setQuitarFinTarget(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-check-circle"></i> Quitar Conta</h3>
              <button className="admin-modal-close" onClick={() => setQuitarFinTarget(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--admin-text-sec)' }}>
                {quitarFinTarget.customerName} - {quitarFinTarget.itemName} - <strong style={{ color: 'var(--admin-text)' }}>{formatPreco(quitarFinTarget.value)}</strong>
              </p>
              <div className="form-group">
                <label>Forma de pagamento</label>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {PAG_SINGLE.map(m => (
                    <button key={m} type="button" className={`pag-chip ${quitarPayment === m ? 'active' : ''}`} onClick={() => setQuitarPayment(m)}>
                      <i className={`fa-solid ${PAG_METHODS[m].icon}`}></i> {PAG_METHODS[m].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="modal-actions" style={{ marginTop: '1rem' }}>
                <button className="admin-btn admin-btn-sec" onClick={() => setQuitarFinTarget(null)}>Cancelar</button>
                <button className="admin-btn admin-btn-primary" onClick={confirmQuitarFin}>
                  <i className="fa-solid fa-check"></i> Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DESPESA */}
      {showDespesaModal && (
        <DespesaModal
          despesa={editingDespesa}
          customTipos={customDespesaTipos}
          onAddTipo={addDespesaTipo}
          onSave={saveDespesa}
          onClose={() => { setShowDespesaModal(false); setEditingDespesa(null) }}
        />
      )}

      {/* RECOVER PASSWORD LINK MODAL */}
      {recoverLinkUser && (
        <div className="admin-overlay" onClick={() => setRecoverLinkUser(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-key"></i> Link de Recuperação</h3>
              <button className="admin-modal-close" onClick={() => setRecoverLinkUser(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ fontSize: '0.85rem', color: 'var(--admin-text-sec)', marginBottom: '0.75rem' }}>
                Link gerado para <strong>{recoverLinkUser.nome}</strong> ({recoverLinkUser.telefone}). Válido por 24 horas.
                {recoverLinkUser.email ? ` Também pode ser enviado por e-mail: ${recoverLinkUser.email}` : ''}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input type="text" readOnly value={recoverLink} style={{ flex: 1, padding: '0.5rem 0.65rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.78rem' }} />
                <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.4rem 0.7rem', whiteSpace: 'nowrap' }}
                  onClick={() => { navigator.clipboard?.writeText(recoverLink); showToast('Link copiado!') }}>
                  <i className="fa-solid fa-copy"></i> Copiar
                </button>
              </div>
              <div className="modal-actions" style={{ marginTop: '1rem' }}>
                <button className="admin-btn admin-btn-sec" onClick={() => setRecoverLinkUser(null)}>Fechar</button>
                <button className="admin-btn" style={{ background: '#25d366', color: 'white', borderColor: '#25d366' }}
                  onClick={() => {
                    const phone = (recoverLinkUser.telefone || '').replace(/\D/g, '')
                    const msg = `Olá, ${recoverLinkUser.nome || 'Cliente'}! Clique no link abaixo para definir uma nova senha:\n${recoverLink}\n\nEste link é válido por 24 horas.`
                    window.open(`https://wa.me/55${phone}?text=${encodeURIComponent(msg)}`, '_blank')
                  }}>
                  <i className="fa-brands fa-whatsapp"></i> Enviar no WhatsApp
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHANGE PASSWORD MODAL */}
      {pwTarget && (
        <div className="admin-overlay" onClick={() => { setPwTarget(null); setPwNew('') }}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-lock"></i> Mudar Senha</h3>
              <button className="admin-modal-close" onClick={() => { setPwTarget(null); setPwNew('') }}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <p style={{ fontSize: '0.85rem', color: 'var(--admin-text-sec)', marginBottom: '0.9rem' }}>
                Definir nova senha para <strong>{pwTarget.nome}</strong> ({pwTarget.telefone}).
              </p>
              <div className="form-group">
                <label>Nova senha</label>
                <input type="text" autoFocus value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="Digite a nova senha"
                  onKeyDown={e => { if (e.key === 'Enter') mudarSenha() }} />
              </div>
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => { setPwTarget(null); setPwNew('') }}>Cancelar</button>
                <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} onClick={mudarSenha}>
                  <i className="fa-solid fa-check"></i> Salvar Senha
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE BOTTOM NAV */}
      <nav className="admin-bottom-nav">
        {sidebar.filter(s => ['dashboard', 'pedidos', 'produtos', 'financeiro', 'usuarios'].includes(s.id)).map(s => (
          <button key={s.id} className={`admin-bottom-item ${tab === s.id ? 'active' : ''}`} onClick={() => setTab(s.id)}>
            <i className={`fa-solid ${s.icon}`}></i>
            <span>{s.label}</span>
            {s.count > 0 && <span className="admin-bottom-badge">{s.count}</span>}
          </button>
        ))}
        <button className={`admin-bottom-item ${mobileMenuOpen ? 'active' : ''}`} onClick={() => setMobileMenuOpen(true)}>
          <i className="fa-solid fa-bars"></i>
          <span>Mais</span>
        </button>
      </nav>

      {/* MOBILE MENU DRAWER */}
      {mobileMenuOpen && (
        <div className="admin-drawer-overlay" onClick={() => setMobileMenuOpen(false)}>
          <div className="admin-drawer" onClick={e => e.stopPropagation()}>
            <div className="admin-drawer-header">
              <strong>THSM Admin</strong>
              <button className="admin-modal-close" onClick={() => setMobileMenuOpen(false)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-drawer-body">
              <div className="admin-drawer-group">
                <span className="admin-drawer-group-label">Navegação</span>
                {sidebar.map(s => (
                  <button key={s.id} className={`admin-bottom-item admin-drawer-item ${tab === s.id ? 'active' : ''}`} onClick={() => { setTab(s.id); setMobileMenuOpen(false) }}>
                    <i className={`fa-solid ${s.icon}`}></i>
                    <span>{s.label}</span>
                    {s.count > 0 && <span className="admin-bottom-badge">{s.count}</span>}
                  </button>
                ))}
              </div>
              <div className="admin-drawer-group">
                <span className="admin-drawer-group-label">Conta</span>
                <button className="admin-bottom-item admin-drawer-item" onClick={onVoltar}>
                  <i className="fa-solid fa-arrow-left"></i>
                  <span>Voltar ao Catálogo</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================
// MODAL: ADD ORDER
// =============================================
const REP_PALETTE = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1']

function fmtK(v) {
  const n = Number(v) || 0
  if (Math.abs(n) >= 1000000) return (n / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M'
  if (Math.abs(n) >= 1000) return (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k'
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

function Donut({ data, size = 168, centerLabel = 'Total' }) {
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0) || 1
  let acc = 0
  const segs = data.map((d, i) => {
    const from = (acc / total) * 360
    acc += Number(d.value) || 0
    const to = (acc / total) * 360
    return `${REP_PALETTE[i % REP_PALETTE.length]} ${from.toFixed(2)}deg ${to.toFixed(2)}deg`
  }).join(', ')
  return (
    <div className="rep-donut-wrap">
      <div className="rep-donut" style={{ width: size, height: size, background: `conic-gradient(${segs})` }}>
        <div className="rep-donut-hole">
          <strong>{fmtK(total)}</strong>
          <span>{centerLabel || 'Total'}</span>
        </div>
      </div>
      <div className="rep-donut-legend">
        {data.map((d, i) => (
          <div key={i} className="rep-legend-item">
            <span className="rep-legend-dot" style={{ background: REP_PALETTE[i % REP_PALETTE.length] }}></span>
            <span className="rep-legend-label">{d.label}</span>
            <span className="rep-legend-val">{fmtK(d.value)}</span>
            <span className="rep-legend-pct">{((Number(d.value) || 0) / total * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Bars({ data, getLabel, getValue, color = '#8b5cf6', height = 200, formatVal }) {
  const max = Math.max(1, ...data.map(getValue))
  const fmt = formatVal || fmtK
  return (
    <div className="rep-bars">
      {data.map((d, i) => {
        const v = getValue(d)
        return (
          <div key={i} className="rep-bar-col">
            <span className="rep-bar-val">{fmt(v)}</span>
            <div className="rep-bar" style={{ height: `${Math.max(3, (v / max) * (height - 34))}px`, background: `linear-gradient(180deg, ${color}, ${color}88)` }} title={`${getLabel(d)}: ${formatPreco(v)}`}></div>
            <span className="rep-bar-label">{getLabel(d)}</span>
          </div>
        )
      })}
      {data.length === 0 && <p className="rep-empty">Sem dados no período</p>}
    </div>
  )
}

function HBar({ data, getLabel, getValue, color }) {
  const max = Math.max(1, ...data.map(getValue))
  return (
    <div className="rep-hb">
      {data.map((d, i) => (
        <div key={i} className="rep-hb-row">
          <span className="rep-hb-label">{getLabel(d)}</span>
          <div className="rep-hb-track">
            <div className="rep-hb-fill" style={{ width: `${Math.max(1.5, (getValue(d) / max) * 100)}%`, background: color || REP_PALETTE[i % REP_PALETTE.length] }}></div>
          </div>
          <span className="rep-hb-val">{fmtK(getValue(d))}</span>
        </div>
      ))}
      {data.length === 0 && <p className="rep-empty">Sem dados no período</p>}
    </div>
  )
}

function MetricaToggle({ options, value, onChange }) {
  return (
    <div className="rep-toggle">
      {options.map(o => (
        <button key={o.id} className={`rep-toggle-btn ${value === o.id ? 'active' : ''}`} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  )
}

function RepKpis({ items }) {
  return (
    <div className="rep-kpis">
      {items.map((it, i) => (
        <div key={i} className="rep-kpi" style={{ '--kpi': it.color || '#8b5cf6' }}>
          <i className={`fa-solid ${it.icon || 'fa-chart-column'}`}></i>
          <div>
            <strong>{it.value}</strong>
            <span>{it.label}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function RepCard({ icon, title, right, children, className = '' }) {
  return (
    <div className={`rep-card ${className}`}>
      <div className="rep-card-head">
        <span className="rep-card-title"><i className={`fa-solid ${icon}`}></i> {title}</span>
        {right}
      </div>
      <div className="rep-card-body">{children}</div>
    </div>
  )
}

function RepTotals({ items }) {
  return (
    <div className="rep-totals">
      {items.map((it, i) => (
        <div key={i} className="rep-total" style={{ '--rep-total': it.color || '#8b5cf6' }}>
          <span>{it.label}</span>
          <strong>{it.value}</strong>
        </div>
      ))}
    </div>
  )
}

function RelatoriosPanel({ orders, financial, despesas, produtos, usuarios, rotas }) {
  const [rep, setRep] = useState('dashboard')
  const [period, setPeriod] = useState('all')
  const [month, setMonth] = useState(hoje().slice(0, 7))
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [grafMetrica, setGrafMetrica] = useState('bruto')
  const [grafMetrica2, setGrafMetrica2] = useState('bruto')
  const [search, setSearch] = useState('')
  const [valorMin, setValorMin] = useState('')
  const [valorMax, setValorMax] = useState('')
  const [statusF, setStatusF] = useState('todos')
  const [pagamentoF, setPagamentoF] = useState('todos')
  const [itemTipoF, setItemTipoF] = useState('todos')

  const ORDER_STATUS = ['pre-pedido', 'pendente', 'confirmado', 'em-andamento', 'em-rota', 'acerto', 'entregue', 'concluido']
  const FIN_LIKE = ['contratos', 'fin_cliente', 'pagamentos', 'caixa', 'despesas']
  const isFinLike = FIN_LIKE.includes(rep)
  const effStatusF = isFinLike ? (statusF === 'pago' || statusF === 'pendente' ? statusF : 'todos') : (ORDER_STATUS.includes(statusF) ? statusF : 'todos')

  const inR = (dt) => dt ? inPeriod(dt, period, month, rangeStart, rangeEnd) : period === 'all'

  const minV = Number(String(valorMin).replace(/\./g, '').replace(/,/g, '.')) || 0
  const maxV = Number(String(valorMax).replace(/\./g, '').replace(/,/g, '.')) || Infinity
  const searchT = search.trim().toLowerCase()

  const ordersBase = useMemo(() => orders.filter(o => o.status !== 'cancelado' && inR(o.date || '')), [orders, period, month, rangeStart, rangeEnd])

  const ordersF = useMemo(() => ordersBase.filter(o => {
    if (effStatusF !== 'todos' && o.status !== effStatusF) return false
    if (pagamentoF !== 'todos' && (o.pagamento || '') !== pagamentoF) return false
    const tot = o.total || 0
    if (tot < minV || tot > maxV) return false
    if (searchT) {
      const hay = `${o.customer?.nome || ''} ${o.customer?.telefone || ''} ${String(o.id)} ${(o.items || []).map(i => `${i.nome || ''} ${i.displayName || ''}`).join(' ')}`.toLowerCase()
      if (!hay.includes(searchT)) return false
    }
    return true
  }), [ordersBase, effStatusF, pagamentoF, minV, maxV, searchT])

  const produtosVendidos = useMemo(() => {
    const arr = []
    ordersF.forEach(o => {
      ; (o.items || []).forEach(i => {
        if (itemTipoF !== 'todos' && (i.tipo || '') !== itemTipoF) return
        arr.push({
          produto: i.displayName || i.nome || i.produto || 'Produto',
          qty: Number(i.qty) || 0,
          preco: Number(i.preco) || 0,
          preco_custo: getItemCost(i, produtos),
          cliente: o.customer?.nome || '-',
          data: o.date || '',
          tipo: i.tipo === 'avista' ? 'À Vista' : 'A Prazo'
        })
      })
    })
    return arr
  }, [ordersF, itemTipoF, produtos])

  const vendasMes = useMemo(() => {
    const map = {}
    ordersF.forEach(o => {
      const k = (o.date || '').slice(0, 7)
      if (!k) return
      if (!map[k]) map[k] = { mes: k, bruto: 0, liq: 0, desconto: 0, frete: 0, custo: 0, qtd: 0, pedidos: 0 }
      const bruto = o.total || 0
      const desc = o.desconto || 0
      map[k].bruto += bruto
      map[k].liq += Math.max(0, bruto - desc)
      map[k].desconto += desc
      map[k].frete += o.frete || 0
      map[k].pedidos += 1
        ; (o.items || []).forEach(i => {
          map[k].qtd += Number(i.qty) || 0
          map[k].custo += getItemCost(i, produtosAtuais) * (Number(i.qty) || 0)
        })
    })
    return Object.values(map).sort((a, b) => a.mes.localeCompare(b.mes))
  }, [ordersF, produtosAtuais])

  const qtdPorProduto = useMemo(() => {
    const map = {}
    produtosVendidos.forEach(p => {
      if (!map[p.produto]) map[p.produto] = { nome: p.produto, qty: 0, bruto: 0, custo: 0 }
      map[p.produto].qty += p.qty
      map[p.produto].bruto += p.preco * p.qty
      map[p.produto].custo += p.preco_custo * p.qty
    })
    return Object.values(map)
  }, [produtosVendidos])

  const linhasAgrupadas = useMemo(() => {
    const map = {}
    produtosVendidos.forEach(p => {
      const k = `${p.produto}||${p.cliente}||${p.data}||${p.tipo}`
      if (!map[k]) map[k] = { ...p }
      else {
        map[k].qty += p.qty
      }
    })
    return Object.values(map)
  }, [produtosVendidos])

  const itensPorCliente = useMemo(() => {
    const map = {}
    ordersF.forEach(o => {
      const nome = o.customer?.nome || '-'
      if (!map[nome]) map[nome] = { cliente: nome, itens: 0, bruto: 0, pedidos: 0 }
      map[nome].itens += (o.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0)
      map[nome].bruto += o.total || 0
      map[nome].pedidos += 1
    })
    return Object.values(map).sort((a, b) => b.bruto - a.bruto)
  }, [ordersF])

  const finBase = useMemo(() => financial.filter(f => f.status !== 'cancelado' && inR(f.dueDate || '')), [financial, period, month, rangeStart, rangeEnd])

  const finRecordsIn = useMemo(() => finBase.filter(f => {
    if (effStatusF !== 'todos' && f.status !== effStatusF) return false
    const v = f.value || 0
    if (v < minV || v > maxV) return false
    if (searchT) {
      const hay = `${f.customerName || ''} ${f.itemName || ''} ${f.paymentMethod || ''}`.toLowerCase()
      if (!hay.includes(searchT)) return false
    }
    return true
  }), [finBase, effStatusF, minV, maxV, searchT])

  const despBase = useMemo(() => despesas.filter(d => inR(d.dueDate || '')), [despesas, period, month, rangeStart, rangeEnd])

  const despIn = useMemo(() => despBase.filter(d => {
    if (effStatusF !== 'todos' && d.status !== effStatusF) return false
    const v = d.value || 0
    if (v < minV || v > maxV) return false
    if (searchT) {
      const hay = `${d.tipo || ''} ${d.descricao || ''} ${d.paymentMethod || ''}`.toLowerCase()
      if (!hay.includes(searchT)) return false
    }
    return true
  }), [despBase, effStatusF, minV, maxV, searchT])

  const fatPorCliente = useMemo(() => {
    const map = {}
    finRecordsIn.forEach(f => {
      if (!map[f.customerName]) map[f.customerName] = { cliente: f.customerName, aberto: 0, pago: 0, vencido: 0, servicos: {} }
      const c = map[f.customerName]
      const item = f.itemName || 'Produto'
      if (!c.servicos[item]) c.servicos[item] = { aberto: 0, pago: 0, vencido: 0 }
      const valor = f.value || 0
      const serv = c.servicos[item]
      if (f.status === 'pago') { c.pago += valor; serv.pago += valor }
      else {
        c.aberto += valor; serv.aberto += valor
        if (f.dueDate && f.dueDate < hoje()) { c.vencido += valor; serv.vencido += valor }
      }
    })
    return Object.values(map)
  }, [finRecordsIn])

  const contratos = useMemo(() => {
    const map = {}
    finRecordsIn.forEach(f => {
      const order = orders.find(o => o.id === f.orderId)
      if (!map[f.customerName]) map[f.customerName] = { cliente: f.customerName, inicio: null, termino: null, aberto: 0, pago: 0, vencido: 0 }
      const c = map[f.customerName]
      const dt = order?.date || ''
      if (dt && (!c.inicio || dt < c.inicio)) c.inicio = dt
      if (f.dueDate && (!c.termino || f.dueDate > c.termino)) c.termino = f.dueDate
      const valor = f.value || 0
      if (f.status === 'pago') c.pago += valor
      else {
        c.aberto += valor
        if (f.dueDate && f.dueDate < hoje()) c.vencido += valor
      }
    })
    return Object.values(map)
  }, [finRecordsIn, orders])

  const pagMetodo = useMemo(() => {
    const map = {}
    finRecordsIn.forEach(f => {
      const m = (f.paymentMethod && PAG_METHODS[f.paymentMethod]?.label) || f.paymentMethod || 'Pix'
      if (!map[m]) map[m] = { label: m, pago: 0, pendente: 0, total: 0 }
      const v = f.value || 0
      map[m].total += v
      if (f.status === 'pago') map[m].pago += v
      else map[m].pendente += v
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [finRecordsIn])

  const statusOrders = useMemo(() => {
    const map = {}
    ordersF.forEach(o => {
      const s = o.status || 'outro'
      if (!map[s]) map[s] = { label: STATUS_LABELS[s] || s, qty: 0, total: 0 }
      map[s].qty += 1
      map[s].total += o.total || 0
    })
    return Object.values(map)
  }, [ordersF])

  const cmvTotal = useMemo(() => {
    const qty = produtosVendidos.reduce((s, p) => s + p.qty, 0) || 1
    const custo = produtosVendidos.reduce((s, p) => s + p.preco_custo * p.qty, 0)
    const bruto = produtosVendidos.reduce((s, p) => s + p.preco * p.qty, 0)
    return { custoMedio: custo / qty, custoTotal: custo, bruto, unitMedio: bruto / qty }
  }, [produtosVendidos])

  const abc = useMemo(() => {
    const totalBruto = qtdPorProduto.reduce((s, p) => s + p.bruto, 0) || 1
    let acum = 0
    return [...qtdPorProduto].sort((a, b) => b.bruto - a.bruto).map(p => {
      acum += p.bruto
      const pct = (acum / totalBruto) * 100
      return { ...p, pctAcum: pct, classe: pct <= 70 ? 'A' : pct <= 90 ? 'B' : 'C' }
    })
  }, [qtdPorProduto])

  const movimento = useMemo(() => {
    const arr = []
    ordersF.forEach(o => {
      ; (o.items || []).forEach(i => {
        arr.push({
          data: o.date || '',
          descricao: `Pedido #${String(o.id).slice(-6)}`,
          produto: i.displayName || i.nome || i.produto || 'Produto',
          sku: i.id || '',
          qty: Number(i.qty) || 0,
          tipo: 'Saída',
          custoMedio: getItemCost(i, produtos)
        })
      })
    })
    return arr.sort((a, b) => b.data.localeCompare(a.data))
  }, [ordersF, produtos])

  const inativos = useMemo(() => {
    const arr = usuarios.map(u => {
      const pedidosUser = orders.filter(o => samePhone(o.customer?.telefone, u.telefone) || (u.id && o.user_id === u.id))
      const ult = pedidosUser.map(o => o.date || '').filter(Boolean).sort().pop() || ''
      return { nome: u.nome || '-', telefone: u.telefone || '-', ultima: ult }
    })
    return arr.sort((a, b) => {
      if (!a.ultima && !b.ultima) return 0
      if (!a.ultima) return -1
      if (!b.ultima) return 1
      return a.ultima.localeCompare(b.ultima)
    }).slice(0, 30)
  }, [usuarios, orders])

  const despPorTipo = useMemo(() => {
    const map = {}
    despIn.forEach(d => {
      const t = d.tipo || 'Outros'
      if (!map[t]) map[t] = { tipo: t, pago: 0, pendente: 0, total: 0, qty: 0 }
      map[t].total += d.value || 0
      map[t].qty += 1
      if (d.status === 'pago') map[t].pago += d.value || 0
      else map[t].pendente += d.value || 0
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [despIn])

  const caixaSerie = useMemo(() => {
    const map = {}
    finRecordsIn.forEach(f => {
      const k = (f.dueDate || '').slice(0, 7)
      if (!k) return
      if (!map[k]) map[k] = { mes: k, receitas: 0, gastos: 0 }
      map[k].receitas += f.value || 0
    })
    despIn.forEach(d => {
      const k = (d.dueDate || '').slice(0, 7)
      if (!k) return
      if (!map[k]) map[k] = { mes: k, receitas: 0, gastos: 0 }
      map[k].gastos += d.value || 0
    })
    return Object.values(map).sort((a, b) => a.mes.localeCompare(b.mes))
  }, [finRecordsIn, despIn])

  const kpis = useMemo(() => {
    const bruto = ordersF.reduce((s, o) => s + (o.total || 0), 0)
    const desc = ordersF.reduce((s, o) => s + (o.desconto || 0), 0)
    const liq = Math.max(0, bruto - desc)
    const pedidos = ordersF.length
    const itens = produtosVendidos.reduce((s, p) => s + p.qty, 0)
    const custo = produtosVendidos.reduce((s, p) => s + p.preco_custo * p.qty, 0)
    const aberto = finRecordsIn.filter(f => f.status === 'pendente').reduce((s, f) => s + (f.value || 0), 0)
    const atrasado = finRecordsIn.filter(f => f.status === 'pendente' && f.dueDate < hoje()).reduce((s, f) => s + (f.value || 0), 0)
    return { bruto, desc, liq, pedidos, itens, custo, aberto, atrasado, ticket: pedidos ? bruto / pedidos : 0 }
  }, [ordersF, produtosVendidos, finRecordsIn])

  const REPORTS = [
    { id: 'dashboard', label: 'Painel geral', icon: 'fa-gauge-high', group: 'Vendas / Financeiro' },
    { id: 'vendas', label: 'Relação detalhada das vendas', icon: 'fa-file-invoice-dollar', group: 'Vendas / Financeiro' },
    { id: 'produtos_vendidos', label: 'Produtos vendidos', icon: 'fa-box-open', group: 'Vendas / Financeiro' },
    { id: 'vendas_mes', label: 'Vendas por período', icon: 'fa-chart-column', group: 'Vendas / Financeiro' },
    { id: 'graf_lucro', label: 'Lucro e margem por mês', icon: 'fa-chart-line', group: 'Vendas / Financeiro' },
    { id: 'pagamentos', label: 'Formas de pagamento', icon: 'fa-credit-card', group: 'Vendas / Financeiro' },
    { id: 'maiores', label: 'Ranking de clientes', icon: 'fa-trophy', group: 'Vendas / Financeiro' },
    { id: 'analise_cliente', label: 'Análise das vendas por cliente', icon: 'fa-user-chart', group: 'Vendas / Financeiro' },
    { id: 'fin_cliente', label: 'Situação por cliente e serviço', icon: 'fa-coins', group: 'Vendas / Financeiro' },
    { id: 'contratos', label: 'Situação dos contratos', icon: 'fa-file-contract', group: 'Vendas / Financeiro' },
    { id: 'orcamentos', label: 'Situação dos orçamentos', icon: 'fa-file-pen', group: 'Vendas / Financeiro' },
    { id: 'status', label: 'Pedidos por status', icon: 'fa-list-check', group: 'Vendas / Financeiro' },
    { id: 'caixa', label: 'Fluxo de caixa', icon: 'fa-money-bill-trend-up', group: 'Vendas / Financeiro' },
    { id: 'despesas', label: 'Relatório de despesas', icon: 'fa-receipt', group: 'Vendas / Financeiro' },
    { id: 'impostos', label: 'Relatório de impostos', icon: 'fa-scale-balanced', group: 'Vendas / Financeiro' },
    { id: 'inativos', label: 'Clientes inativos', icon: 'fa-user-clock', group: 'Vendas / Financeiro' },
    { id: 'clientes', label: 'Relação de clientes', icon: 'fa-users', group: 'Vendas / Financeiro' },
    { id: 'custo_margem', label: 'Custo, margem e lucro por mês', icon: 'fa-calculator', group: 'Estoque' },
    { id: 'cmv', label: 'Análise de custo (CMV)', icon: 'fa-scale-balanced', group: 'Estoque' },
    { id: 'abc', label: 'Curva ABC', icon: 'fa-ranking-star', group: 'Estoque' },
    { id: 'giro', label: 'Giro de estoque', icon: 'fa-rotate', group: 'Estoque' },
    { id: 'posicao', label: 'Posição de estoque', icon: 'fa-boxes-stacked', group: 'Estoque' },
    { id: 'movimentacoes', label: 'Histórico de movimentações', icon: 'fa-arrows-rotate', group: 'Estoque' },
  ]

  const current = REPORTS.find(r => r.id === rep) || REPORTS[0]

  const statusOptions = isFinLike
    ? [{ id: 'todos', label: 'Todos os status' }, { id: 'pago', label: 'Pago' }, { id: 'pendente', label: 'Pendente' }]
    : [{ id: 'todos', label: 'Todos os status' }, ...ORDER_STATUS.map(s => ({ id: s, label: STATUS_LABELS[s] || s }))]

  const pagamentoOptions = [
    { id: 'todos', label: 'Toda forma de pagamento' },
    { id: 'avista', label: 'À Vista' },
    { id: 'aprazo', label: 'A Prazo' },
    { id: 'misto', label: 'Misto' }
  ]

  const renderDashboard = () => {
    return (
      <div className="rep-dash">
        <RepKpis items={[
          { icon: 'fa-sack-dollar', label: 'Faturamento bruto', value: formatPreco(kpis.bruto), color: '#8b5cf6' },
          { icon: 'fa-hand-holding-dollar', label: 'Valor líquido', value: formatPreco(kpis.liq), color: '#10b981' },
          { icon: 'fa-tags', label: 'Descontos', value: formatPreco(kpis.desc), color: '#ef4444' },
          { icon: 'fa-clipboard-list', label: 'Pedidos', value: kpis.pedidos, color: '#3b82f6' },
          { icon: 'fa-box', label: 'Itens vendidos', value: kpis.itens, color: '#f59e0b' },
          { icon: 'fa-receipt', label: 'Ticket médio', value: formatPreco(kpis.ticket), color: '#06b6d4' },
          { icon: 'fa-chart-pie', label: 'Lucro bruto estimado', value: formatPreco(Math.max(0, kpis.bruto - kpis.custo)), color: '#ec4899' },
          { icon: 'fa-hourglass-half', label: 'Em aberto', value: formatPreco(kpis.aberto), color: '#f97316' },
          { icon: 'fa-triangle-exclamation', label: 'Vencidos', value: formatPreco(kpis.atrasado), color: '#dc2626' },
        ]} />

        <div className="rep-grid rep-grid-2">
          <RepCard icon="fa-chart-column" title="Vendas por período" right={
            <MetricaToggle options={[
              { id: 'bruto', label: 'Bruto' }, { id: 'liq', label: 'Líquido' }, { id: 'desconto', label: 'Desconto' },
            ]} value={grafMetrica} onChange={setGrafMetrica} />
          }>
            <Bars data={vendasMes} getLabel={v => v.mes} getValue={v => v[grafMetrica]} color="#8b5cf6" />
          </RepCard>
          <RepCard icon="fa-box-open" title="Top produtos por faturamento" right={
            <MetricaToggle options={[
              { id: 'bruto', label: 'Valor' }, { id: 'qty', label: 'Qtd' },
            ]} value={grafMetrica2} onChange={setGrafMetrica2} />
          }>
            <HBar data={[...qtdPorProduto].sort((a, b) => b[grafMetrica2 === 'qty' ? 'qty' : 'bruto'] - a[grafMetrica2 === 'qty' ? 'qty' : 'bruto']).slice(0, 8)}
              getLabel={p => p.nome} getValue={p => grafMetrica2 === 'qty' ? p.qty : p.bruto} />
          </RepCard>
          <RepCard icon="fa-trophy" title="Top clientes">
            <HBar data={itensPorCliente.slice(0, 8)} getLabel={c => c.cliente} getValue={c => c.bruto} color="#f59e0b" />
          </RepCard>
          <RepCard icon="fa-credit-card" title="Formas de pagamento (previsto)">
            <Donut data={pagMetodo.map(m => ({ label: m.label, value: m.total }))} />
          </RepCard>
        </div>

        <div className="rep-grid rep-grid-2">
          <RepCard icon="fa-list-check" title="Pedidos por status">
            <Donut data={statusOrders.map(s => ({ label: s.label, value: s.qty }))} centerLabel="Pedidos" size={150} />
          </RepCard>
          <RepCard icon="fa-coins" title="A receber por situação">
            <Donut data={[
              { label: 'Pago', value: finRecordsIn.filter(f => f.status === 'pago').reduce((s, f) => s + (f.value || 0), 0) },
              { label: 'Em aberto', value: finRecordsIn.filter(f => f.status === 'pendente').reduce((s, f) => s + (f.value || 0), 0) },
              { label: 'Vencido', value: finRecordsIn.filter(f => f.status === 'pendente' && f.dueDate < hoje()).reduce((s, f) => s + (f.value || 0), 0) },
            ]} centerLabel="Financeiro" size={150} />
          </RepCard>
        </div>
      </div>
    )
  }

  const renderBody = () => {
    if (rep === 'vendas') {
      const totalBruto = ordersF.reduce((s, o) => s + (o.total || 0), 0)
      const totalDesc = ordersF.reduce((s, o) => s + (o.desconto || 0), 0)
      return (
        <div>
          <RepTotals items={[
            { label: 'Pedidos no período', value: ordersF.length, color: '#3b82f6' },
            { label: 'Valor bruto', value: formatPreco(totalBruto), color: '#8b5cf6' },
            { label: 'Descontos', value: formatPreco(totalDesc), color: '#ef4444' },
            { label: 'Valor líquido', value: formatPreco(Math.max(0, totalBruto - totalDesc)), color: '#10b981' },
          ]} />
          <table className="admin-table">
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Data da venda</th><th>Itens</th><th>Valor bruto</th><th>Desconto</th><th>Valor líquido</th><th>Frete</th><th>Pagamento</th><th>Status</th></tr></thead>
            <tbody>
              {ordersF.map(o => {
                const bruto = o.total || 0
                const desc = o.desconto || 0
                const qtd = (o.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0)
                return (
                  <tr key={o.id}>
                    <td className="td-prod-name">#{String(o.id).slice(-6)}</td>
                    <td>{o.customer?.nome || '-'}</td>
                    <td>{formatDate(o.date)}</td>
                    <td>{qtd}</td>
                    <td className="td-price">{formatPreco(bruto)}</td>
                    <td className="td-price" style={{ color: 'var(--danger)' }}>{desc ? formatPreco(desc) : '-'}</td>
                    <td className="td-price">{formatPreco(Math.max(0, bruto - desc))}</td>
                    <td>{o.frete ? formatPreco(o.frete) : '-'}</td>
                    <td>{o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</td>
                    <td><span className={`status-tag status-${o.status}`}>{STATUS_LABELS[o.status] || o.status}</span></td>
                  </tr>
                )
              })}
              {ordersF.length === 0 && <tr><td colSpan="10" className="td-empty">Nenhuma venda no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'produtos_vendidos') {
      const totalQty = linhasAgrupadas.reduce((s, p) => s + p.qty, 0)
      const totalValor = linhasAgrupadas.reduce((s, p) => s + p.preco * p.qty, 0)
      return (
        <div>
          <RepTotals items={[
            { label: 'Linhas', value: linhasAgrupadas.length, color: '#3b82f6' },
            { label: 'Quantidade vendida', value: totalQty, color: '#f59e0b' },
            { label: 'Valor total', value: formatPreco(totalValor), color: '#8b5cf6' },
          ]} />
          <table className="admin-table">
            <thead><tr><th>Produto</th><th>Quantidade</th><th>Valor total</th><th>Cliente</th><th>Data da venda</th><th>Tipo do item</th></tr></thead>
            <tbody>
              {linhasAgrupadas.map((p, i) => (
                <tr key={i}>
                  <td className="td-prod-name">{p.produto}</td>
                  <td>{p.qty}</td>
                  <td className="td-price">{formatPreco(p.preco * p.qty)}</td>
                  <td>{p.cliente}</td>
                  <td>{formatDate(p.data)}</td>
                  <td>{p.tipo}</td>
                </tr>
              ))}
              {linhasAgrupadas.length === 0 && <tr><td colSpan="6" className="td-empty">Nenhum produto vendido no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'servicos') {
      return (
        <div className="rep-empty-full">
          <i className="fa-solid fa-briefcase"></i>
          <h3>Sem módulo de serviços</h3>
          <p>O sistema não cadastra serviços atualmente. Este relatório está preparado para quando o módulo existir.</p>
        </div>
      )
    }
    if (rep === 'custo_margem') {
      return (
        <div>
          <RepTotals items={[
            { label: 'Meses analisados', value: vendasMes.length, color: '#3b82f6' },
            { label: 'Custo total', value: formatPreco(vendasMes.reduce((s, v) => s + v.custo, 0)), color: '#ef4444' },
            { label: 'Lucro bruto', value: formatPreco(vendasMes.reduce((s, v) => s + v.liq - v.custo, 0)), color: '#10b981' },
          ]} />
          <table className="admin-table">
            <thead><tr><th>Mês</th><th>Qtd de itens</th><th>Custo</th><th>Valor bruto</th><th>Valor líquido</th><th>Lucro bruto</th><th>Margem de lucro</th></tr></thead>
            <tbody>
              {vendasMes.map(v => {
                const bruto = v.bruto
                const lucro = v.liq - v.custo
                const margem = bruto > 0 ? (lucro / bruto) * 100 : 0
                return (
                  <tr key={v.mes}>
                    <td>{v.mes}</td>
                    <td>{v.qtd}</td>
                    <td className="td-price">{formatPreco(v.custo)}</td>
                    <td className="td-price">{formatPreco(bruto)}</td>
                    <td className="td-price">{formatPreco(v.liq)}</td>
                    <td className="td-price" style={{ color: lucro >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatPreco(lucro)}</td>
                    <td><span className="rep-badge margem-badge">{margem.toFixed(1)}%</span></td>
                  </tr>
                )
              })}
              {vendasMes.length === 0 && <tr><td colSpan="7" className="td-empty">Sem dados no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'contratos') {
      return (
        <div>
          <RepTotals items={[
            { label: 'Clientes em contrato', value: contratos.length, color: '#3b82f6' },
            { label: 'Valores em aberto', value: formatPreco(contratos.reduce((s, c) => s + c.aberto, 0)), color: '#f59e0b' },
            { label: 'Valores vencidos', value: formatPreco(contratos.reduce((s, c) => s + c.vencido, 0)), color: '#ef4444' },
            { label: 'Valores pagos', value: formatPreco(contratos.reduce((s, c) => s + c.pago, 0)), color: '#10b981' },
          ]} />
          <table className="admin-table">
            <thead><tr><th>Cliente</th><th>Data de início</th><th>Data de término</th><th>Valores em aberto</th><th>Valores pagos</th><th>Valores vencidos</th></tr></thead>
            <tbody>
              {contratos.map(c => (
                <tr key={c.cliente}>
                  <td>{c.cliente}</td>
                  <td>{formatDate(c.inicio)}</td>
                  <td>{formatDate(c.termino)}</td>
                  <td className="td-price">{formatPreco(c.aberto)}</td>
                  <td className="td-price" style={{ color: 'var(--success)' }}>{formatPreco(c.pago)}</td>
                  <td className="td-price" style={{ color: c.vencido > 0 ? 'var(--danger)' : undefined }}>{formatPreco(c.vencido)}</td>
                </tr>
              ))}
              {contratos.length === 0 && <tr><td colSpan="6" className="td-empty">Sem contratos no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'orcamentos') {
      const orcs = orders.filter(o => o.status === 'pre-pedido' && inR(o.date || ''))
      return (
        <div>
          <RepTotals items={[
            { label: 'Orçamentos em análise', value: orcs.length, color: '#3b82f6' },
            { label: 'Valor total', value: formatPreco(orcs.reduce((s, o) => s + (o.total || 0), 0)), color: '#8b5cf6' },
          ]} />
          <table className="admin-table">
            <thead><tr><th>Cliente</th><th>Data do orçamento</th><th>Valor bruto</th><th>Status</th></tr></thead>
            <tbody>
              {orcs.map(o => (
                <tr key={o.id}>
                  <td>{o.customer?.nome || '-'}</td>
                  <td>{formatDate(o.date)}</td>
                  <td className="td-price">{formatPreco(o.total || 0)}</td>
                  <td><span className="status-tag status-pre-pedido">Pré-Pedido</span></td>
                </tr>
              ))}
              {orcs.length === 0 && <tr><td colSpan="4" className="td-empty">Nenhum orçamento em andamento</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'fin_cliente') {
      return (
        <div>
          <RepTotals items={[
            { label: 'Clientes', value: fatPorCliente.length, color: '#3b82f6' },
            { label: 'Aberto', value: formatPreco(fatPorCliente.reduce((s, c) => s + c.aberto, 0)), color: '#f59e0b' },
            { label: 'Pago', value: formatPreco(fatPorCliente.reduce((s, c) => s + c.pago, 0)), color: '#10b981' },
            { label: 'Vencido', value: formatPreco(fatPorCliente.reduce((s, c) => s + c.vencido, 0)), color: '#ef4444' },
          ]} />
          <table className="admin-table">
            <thead><tr><th>Cliente</th><th>Serviço</th><th>Valores em aberto</th><th>Valores pagos</th><th>Valores vencidos</th></tr></thead>
            <tbody>
              {fatPorCliente.map(c => (
                Object.entries(c.servicos).map(([itemName, s]) => (
                  <tr key={c.cliente + itemName}>
                    <td>{c.cliente}</td>
                    <td>{itemName}</td>
                    <td className="td-price">{formatPreco(s.aberto)}</td>
                    <td className="td-price" style={{ color: 'var(--success)' }}>{formatPreco(s.pago)}</td>
                    <td className="td-price" style={{ color: s.vencido > 0 ? 'var(--danger)' : undefined }}>{formatPreco(s.vencido)}</td>
                  </tr>
                ))
              ))}
              {fatPorCliente.length === 0 && <tr><td colSpan="5" className="td-empty">Sem dados no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'vendas_mes') {
      const key = grafMetrica === 'bruto' ? 'bruto' : grafMetrica === 'liq' ? 'liq' : 'desconto'
      return (
        <div>
          <div className="rep-chart-toolbar">
            <MetricaToggle options={[
              { id: 'bruto', label: 'Valor bruto' }, { id: 'liq', label: 'Valor líquido' }, { id: 'desconto', label: 'Desconto' },
            ]} value={grafMetrica} onChange={setGrafMetrica} />
          </div>
          <RepCard icon="fa-chart-column" title="Vendas por período">
            <Bars data={vendasMes} getLabel={v => v.mes} getValue={v => v[key]} color="#8b5cf6" />
          </RepCard>
          <table className="admin-table" style={{ marginTop: '0.75rem' }}>
            <thead><tr><th>Mês</th><th>Pedidos</th><th>Valor bruto</th><th>Valor líquido</th><th>Desconto</th><th>Frete</th><th>Qtd itens</th></tr></thead>
            <tbody>
              {vendasMes.map(v => (
                <tr key={v.mes}>
                  <td><strong>{v.mes}</strong></td>
                  <td>{v.pedidos}</td>
                  <td className="td-price">{formatPreco(v.bruto)}</td>
                  <td className="td-price">{formatPreco(v.liq)}</td>
                  <td className="td-price">{formatPreco(v.desconto)}</td>
                  <td>{v.frete ? formatPreco(v.frete) : '-'}</td>
                  <td>{v.qtd}</td>
                </tr>
              ))}
              {vendasMes.length === 0 && <tr><td colSpan="7" className="td-empty">Sem dados no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'analise_cliente') {
      return (
        <div>
          <table className="admin-table">
            <thead><tr><th>#</th><th>Cliente</th><th>Pedidos</th><th>Quantidade de itens</th><th>Valor bruto</th><th>Ticket médio</th></tr></thead>
            <tbody>
              {itensPorCliente.map((c, i) => (
                <tr key={c.cliente}>
                  <td className="rep-rank">{i + 1}</td>
                  <td>{c.cliente}</td>
                  <td>{c.pedidos}</td>
                  <td>{c.itens}</td>
                  <td className="td-price">{formatPreco(c.bruto)}</td>
                  <td className="td-price">{formatPreco(c.pedidos ? c.bruto / c.pedidos : 0)}</td>
                </tr>
              ))}
              {itensPorCliente.length === 0 && <tr><td colSpan="6" className="td-empty">Sem dados no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'cmv') {
      return (
        <div>
          <RepKpis items={[
            { icon: 'fa-scale-balanced', label: 'Custo total', value: formatPreco(cmvTotal.custoTotal), color: '#ef4444' },
            { icon: 'fa-chart-line', label: 'Valor bruto', value: formatPreco(cmvTotal.bruto), color: '#8b5cf6' },
            { icon: 'fa-coins', label: 'Custo médio', value: formatPreco(cmvTotal.custoMedio), color: '#06b6d4' },
            { icon: 'fa-tag', label: 'Valor unitário médio', value: formatPreco(cmvTotal.unitMedio), color: '#10b981' },
            { icon: 'fa-percent', label: 'Margem média', value: `${(cmvTotal.bruto ? (cmvTotal.bruto - cmvTotal.custoTotal) / cmvTotal.bruto * 100 : 0).toFixed(1)}%`, color: '#f59e0b' },
          ]} />
          <table className="admin-table">
            <thead><tr><th>Produto</th><th>Qtd vendida</th><th>Custo</th><th>Valor bruto</th><th>Lucro</th><th>Margem %</th></tr></thead>
            <tbody>
              {qtdPorProduto.map(p => {
                const lucro = p.bruto - p.custo
                return (
                  <tr key={p.nome}>
                    <td className="td-prod-name">{p.nome}</td>
                    <td>{p.qty}</td>
                    <td className="td-price">{formatPreco(p.custo)}</td>
                    <td className="td-price">{formatPreco(p.bruto)}</td>
                    <td className="td-price" style={{ color: lucro >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatPreco(lucro)}</td>
                    <td><span className="rep-badge margem-badge">{p.bruto ? (lucro / p.bruto * 100).toFixed(1) : 0}%</span></td>
                  </tr>
                )
              })}
              {qtdPorProduto.length === 0 && <tr><td colSpan="6" className="td-empty">Sem dados no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'inativos') {
      return (
        <div>
          <RepCard icon="fa-user-clock" title="Clientes sem vendas há mais tempo" className="rep-mb">
            <p style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', margin: 0 }}>
              Baseado em todos os clientes cadastrados, ordenados pelos que compram há mais tempo.
            </p>
          </RepCard>
          <table className="admin-table">
            <thead><tr><th>#</th><th>Cliente</th><th>Telefone</th><th>Última venda</th></tr></thead>
            <tbody>
              {inativos.map((u, i) => (
                <tr key={u.telefone}>
                  <td className="rep-rank">{i + 1}</td>
                  <td>{u.nome}</td>
                  <td>{u.telefone}</td>
                  <td>{u.ultima ? formatDate(u.ultima) : <span className="rep-badge lead-badge">Sem vendas</span>}</td>
                </tr>
              ))}
              {inativos.length === 0 && <tr><td colSpan="4" className="td-empty">Sem clientes cadastrados</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'graf_lucro') {
      const lucroParams = vendasMes.map(v => ({ mes: v.mes, lucro: v.liq - v.custo, margem: v.bruto > 0 ? ((v.liq - v.custo) / v.bruto) * 100 : 0 }))
      return (
        <div>
          <div className="rep-grid rep-grid-2">
            <RepCard icon="fa-chart-line" title="Lucro bruto por mês">
              <Bars data={lucroParams} getLabel={v => v.mes} getValue={v => v.lucro} color="#059669" formatVal={v => formatPreco(v)} />
            </RepCard>
            <RepCard icon="fa-percent" title="Margem de lucro por mês">
              <Bars data={lucroParams} getLabel={v => v.mes} getValue={v => v.margem} color="#f59e0b" formatVal={v => `${v.toFixed(0)}%`} />
            </RepCard>
          </div>
          <table className="admin-table" style={{ marginTop: '0.75rem' }}>
            <thead><tr><th>Mês</th><th>Faturamento</th><th>Custo</th><th>Lucro bruto</th><th>Margem</th></tr></thead>
            <tbody>
              {lucroParams.map(v => (
                <tr key={v.mes}>
                  <td><strong>{v.mes}</strong></td>
                  <td className="td-price">{formatPreco(vendasMes.find(x => x.mes === v.mes)?.bruto || 0)}</td>
                  <td className="td-price">{formatPreco(vendasMes.find(x => x.mes === v.mes)?.custo || 0)}</td>
                  <td className="td-price" style={{ color: v.lucro >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatPreco(v.lucro)}</td>
                  <td><span className="rep-badge margem-badge">{v.margem.toFixed(1)}%</span></td>
                </tr>
              ))}
              {lucroParams.length === 0 && <tr><td colSpan="5" className="td-empty">Sem dados no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'maiores') {
      const top = itensPorCliente.slice(0, 10)
      return (
        <div>
          <RepCard icon="fa-trophy" title="Ranking de clientes" className="rep-mb">
            <HBar data={top} getLabel={c => c.cliente} getValue={c => c.bruto} color="#f59e0b" />
          </RepCard>
          <table className="admin-table">
            <thead><tr><th>#</th><th>Cliente</th><th>Nº de vendas</th><th>Total vendido</th><th>Ticket médio</th></tr></thead>
            <tbody>
              {top.map((c, i) => (
                <tr key={c.cliente}>
                  <td className="rep-rank">{i + 1}</td>
                  <td>{c.cliente}</td>
                  <td>{c.pedidos}</td>
                  <td className="td-price">{formatPreco(c.bruto)}</td>
                  <td className="td-price">{formatPreco(c.pedidos ? c.bruto / c.pedidos : 0)}</td>
                </tr>
              ))}
              {top.length === 0 && <tr><td colSpan="5" className="td-empty">Sem dados no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'impostos') {
      const bruto = ordersF.reduce((s, o) => s + (o.total || 0), 0)
      const desc = ordersF.reduce((s, o) => s + (o.desconto || 0), 0)
      const liq = Math.max(0, bruto - desc)
      return (
        <div>
          <RepKpis items={[
            { icon: 'fa-file-invoice', label: 'Base bruta', value: formatPreco(bruto), color: '#8b5cf6' },
            { icon: 'fa-tags', label: 'Descontos', value: formatPreco(desc), color: '#ef4444' },
            { icon: 'fa-receipt', label: 'Base líquida', value: formatPreco(liq), color: '#10b981' },
            { icon: 'fa-landmark', label: 'Impostos estimados (18%)', value: formatPreco(liq * 0.18), color: '#f59e0b' },
          ]} />
          <table className="admin-table">
            <thead><tr><th>Base de cálculo</th><th>Valor bruto</th><th>Valor líquido</th><th>Desconto aplicado</th><th>Impostos estimados (18%)</th></tr></thead>
            <tbody>
              <tr>
                <td>Vendas no período</td>
                <td className="td-price">{formatPreco(bruto)}</td>
                <td className="td-price">{formatPreco(liq)}</td>
                <td className="td-price">{formatPreco(desc)}</td>
                <td className="td-price" style={{ color: '#f59e0b' }}>{formatPreco(liq * 0.18)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'clientes') {
      return (
        <div>
          <table className="admin-table">
            <thead><tr><th>Cliente</th><th>Telefone</th><th>Cidade</th><th>Rota</th><th>Nº pedidos</th><th>Último pedido</th></tr></thead>
            <tbody>
              {usuarios.map(u => {
                const pedidosUser = orders.filter(o => samePhone(o.customer?.telefone, u.telefone) || (u.id && o.user_id === u.id))
                const ult = pedidosUser.map(o => o.date || '').filter(Boolean).sort().pop() || null
                const semPedido = pedidosUser.length === 0
                return (
                  <tr key={u.id || u.telefone} style={{ opacity: semPedido ? 0.7 : 1 }}>
                    <td>{u.nome || '-'}</td>
                    <td>{u.telefone || '-'}</td>
                    <td>{u.endereco?.cidade || '-'}</td>
                    <td>{u.endereco?.rota || '-'}</td>
                    <td>{pedidosUser.length}</td>
                    <td>{ult ? formatDate(ult) : <span className="rep-badge lead-badge">Lead</span>}</td>
                  </tr>
                )
              })}
              {usuarios.length === 0 && <tr><td colSpan="6" className="td-empty">Nenhum cliente cadastrado</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'giro') {
      return (
        <div>
          <table className="admin-table">
            <thead><tr><th>Produto</th><th>Estoque atual</th><th>Qtd vendida (período)</th><th>Giro no período</th></tr></thead>
            <tbody>
              {produtos.map(p => {
                const vendido = produtosVendidos.filter(x => x.produto === (p.displayName || p.nome || p.id)).reduce((s, x) => s + x.qty, 0)
                const estoque = Number(p.estoque) || 0
                const giro = vendido > 0 && estoque > 0 ? (vendido / estoque) : null
                return (
                  <tr key={p.id}>
                    <td className="td-prod-name">{p.displayName || p.nome || p.id}</td>
                    <td>{estoque}</td>
                    <td>{vendido}</td>
                    <td>{giro !== null ? <span className="rep-badge giro-badge">{giro.toFixed(2)}x</span> : '-'}</td>
                  </tr>
                )
              })}
              {produtos.length === 0 && <tr><td colSpan="4" className="td-empty">Nenhum produto cadastrado</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'posicao') {
      return (
        <div>
          <RepTotals items={[
            { label: 'Produtos em estoque', value: produtos.length, color: '#3b82f6' },
            { label: 'Valor à venda', value: formatPreco(produtos.reduce((s, p) => s + (Number(p.estoque) || 0) * (Number(p.preco) || 0), 0)), color: '#8b5cf6' },
            { label: 'Valor a custo', value: formatPreco(produtos.reduce((s, p) => s + (Number(p.estoque) || 0) * (Number(p.preco_custo) || Number(p.custo) || 0), 0)), color: '#ef4444' },
          ]} />
          <table className="admin-table">
            <thead><tr><th>Produto</th><th>Estoque total</th><th>Valor à venda</th><th>Valor a custo</th><th>Custo médio</th></tr></thead>
            <tbody>
              {produtos.map(p => {
                const estoque = Number(p.estoque) || 0
                const preco = Number(p.preco) || 0
                const custo = Number(p.preco_custo) || Number(p.custo) || 0
                return (
                  <tr key={p.id}>
                    <td className="td-prod-name">{p.displayName || p.nome || p.id}</td>
                    <td>{estoque}</td>
                    <td className="td-price">{formatPreco(preco * estoque)}</td>
                    <td className="td-price">{formatPreco(custo * estoque)}</td>
                    <td className="td-price">{custo ? formatPreco(custo) : '-'}</td>
                  </tr>
                )
              })}
              {produtos.length === 0 && <tr><td colSpan="5" className="td-empty">Nenhum produto cadastrado</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'abc') {
      const cls = { A: 'rep-cls-a', B: 'rep-cls-b', C: 'rep-cls-c' }
      return (
        <div>
          <RepCard icon="fa-ranking-star" title="Curva ABC dos produtos" className="rep-mb">
            <HBar data={abc} getLabel={p => `${p.classe} · ${p.nome}`} getValue={p => p.bruto} color="#10b981" />
          </RepCard>
          <table className="admin-table">
            <thead><tr><th>Classe</th><th>Produto</th><th>Qtd vendida</th><th>Valor</th><th>% acumulado</th></tr></thead>
            <tbody>
              {abc.map((p, i) => (
                <tr key={i}>
                  <td><span className={`rep-badge ${cls[p.classe]}`}>{p.classe}</span></td>
                  <td className="td-prod-name">{p.nome}</td>
                  <td>{p.qty}</td>
                  <td className="td-price">{formatPreco(p.bruto)}</td>
                  <td>{p.pctAcum.toFixed(1)}%</td>
                </tr>
              ))}
              {abc.length === 0 && <tr><td colSpan="5" className="td-empty">Sem dados no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'movimentacoes') {
      return (
        <div>
          <table className="admin-table">
            <thead><tr><th>Data</th><th>Descrição</th><th>SKU</th><th>Produto</th><th>Quantidade</th><th>Tipo</th><th>Custo médio</th></tr></thead>
            <tbody>
              {movimento.map((m, i) => (
                <tr key={i}>
                  <td>{formatDate(m.data)}</td>
                  <td>{m.descricao}</td>
                  <td>{m.sku}</td>
                  <td className="td-prod-name">{m.produto}</td>
                  <td><span className="rep-badge saida-badge">-{m.qty}</span></td>
                  <td>{m.tipo}</td>
                  <td className="td-price">{formatPreco(m.custoMedio)}</td>
                </tr>
              ))}
              {movimento.length === 0 && <tr><td colSpan="7" className="td-empty">Sem movimentações no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'pagamentos') {
      return (
        <div>
          <RepTotals items={[
            { label: 'Previsto total', value: formatPreco(finRecordsIn.reduce((s, f) => s + (f.value || 0), 0)), color: '#8b5cf6' },
            { label: 'Pago', value: formatPreco(pagMetodo.reduce((s, m) => s + m.pago, 0)), color: '#10b981' },
            { label: 'Pendente', value: formatPreco(pagMetodo.reduce((s, m) => s + m.pendente, 0)), color: '#f59e0b' },
          ]} />
          <div className="rep-grid rep-grid-2">
            <RepCard icon="fa-chart-pie" title="Distribuição por forma de pagamento">
              <Donut data={pagMetodo.map(m => ({ label: m.label, value: m.total }))} />
            </RepCard>
            <div>
              {pagMetodo.map((m, i) => (
                <div key={m.label} className="rep-pag-row">
                  <span className="rep-legend-dot" style={{ background: REP_PALETTE[i % REP_PALETTE.length] }}></span>
                  <span className="rep-pag-label">{m.label}</span>
                  <span className="rep-pag-mini" style={{ color: '#f59e0b' }}>Pend: {formatPreco(m.pendente)}</span>
                  <span className="rep-pag-mini" style={{ color: '#10b981' }}>Pago: {formatPreco(m.pago)}</span>
                  <strong>{formatPreco(m.total)}</strong>
                </div>
              ))}
              {pagMetodo.length === 0 && <p className="rep-empty">Sem registros no período</p>}
            </div>
          </div>
        </div>
      )
    }
    if (rep === 'status') {
      return (
        <div>
          <div className="rep-grid rep-grid-2">
            <RepCard icon="fa-chart-pie" title="Pedidos por status">
              <Donut data={statusOrders.map(s => ({ label: s.label, value: s.qty }))} centerLabel="Pedidos" />
            </RepCard>
            <RepCard icon="fa-sack-dollar" title="Valor por status">
              <Donut data={statusOrders.map(s => ({ label: s.label, value: s.total }))} centerLabel="Valor" />
            </RepCard>
          </div>
          <table className="admin-table" style={{ marginTop: '0.75rem' }}>
            <thead><tr><th>Status</th><th>Pedidos</th><th>Valor total</th><th>% dos pedidos</th></tr></thead>
            <tbody>
              {statusOrders.map(s => {
                const pct = ordersF.length ? (s.qty / ordersF.length) * 100 : 0
                return (
                  <tr key={s.label}>
                    <td><span className={`status-tag status-${Object.keys(STATUS_LABELS).find(k => STATUS_LABELS[k] === s.label) || ''}`}>{s.label}</span></td>
                    <td>{s.qty}</td>
                    <td className="td-price">{formatPreco(s.total)}</td>
                    <td>
                      <div className="rep-pct-track"><div className="rep-pct-fill" style={{ width: `${pct}%` }}></div></div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--admin-text-sec)' }}>{pct.toFixed(1)}%</span>
                    </td>
                  </tr>
                )
              })}
              {statusOrders.length === 0 && <tr><td colSpan="4" className="td-empty">Sem dados no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'caixa') {
      const totRec = caixaSerie.reduce((s, c) => s + c.receitas, 0)
      const totGas = caixaSerie.reduce((s, c) => s + c.gastos, 0)
      return (
        <div>
          <RepKpis items={[
            { icon: 'fa-arrow-trend-up', label: 'Receitas previstas', value: formatPreco(totRec), color: '#10b981' },
            { icon: 'fa-arrow-trend-down', label: 'Despesas', value: formatPreco(totGas), color: '#ef4444' },
            { icon: 'fa-scale-balanced', label: 'Resultado', value: formatPreco(totRec - totGas), color: totRec - totGas >= 0 ? '#3b82f6' : '#dc2626' },
          ]} />
          <RepCard icon="fa-money-bill-trend-up" title="Receitas x Despesas por mês">
            <div className="rep-dual">
              <div className="rep-dual-series rep-dual-rec">
                {caixaSerie.map(c => (
                  <div key={c.mes} className="rep-dual-col">
                    <span className="rep-dual-val">{fmtK(c.receitas)}</span>
                    <div className="rep-dual-bar" style={{ height: `${Math.max(3, (c.receitas / Math.max(1, ...caixaSerie.map(x => x.receitas), 1)) * 130)}px`, background: 'linear-gradient(180deg,#10b981,#059669)' }}></div>
                    <span className="rep-dual-label">{c.mes}</span>
                  </div>
                ))}
              </div>
              <div className="rep-dual-series rep-dual-gas">
                {caixaSerie.map(c => (
                  <div key={c.mes} className="rep-dual-col">
                    <span className="rep-dual-val">{fmtK(c.gastos)}</span>
                    <div className="rep-dual-bar" style={{ height: `${Math.max(3, (c.gastos / Math.max(1, ...caixaSerie.map(x => x.gastos), 1)) * 130)}px`, background: 'linear-gradient(180deg,#ef4444,#b91c1c)' }}></div>
                    <span className="rep-dual-label">{c.mes}</span>
                  </div>
                ))}
              </div>
            </div>
            <p style={{ fontSize: '0.72rem', color: 'var(--admin-text-sec)', marginTop: '0.4rem' }}>
              <span style={{ color: '#10b981' }}>■</span> Receitas &nbsp; <span style={{ color: '#ef4444' }}>■</span> Despesas
            </p>
          </RepCard>
          <table className="admin-table" style={{ marginTop: '0.75rem' }}>
            <thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Resultado</th></tr></thead>
            <tbody>
              {caixaSerie.map(c => {
                const res = c.receitas - c.gastos
                return (
                  <tr key={c.mes}>
                    <td><strong>{c.mes}</strong></td>
                    <td className="td-price" style={{ color: 'var(--success)' }}>{formatPreco(c.receitas)}</td>
                    <td className="td-price" style={{ color: 'var(--danger)' }}>{formatPreco(c.gastos)}</td>
                    <td className="td-price" style={{ color: res >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatPreco(res)}</td>
                  </tr>
                )
              })}
              {caixaSerie.length === 0 && <tr><td colSpan="4" className="td-empty">Sem dados no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    if (rep === 'despesas') {
      const totDesp = despIn.reduce((s, d) => s + (d.value || 0), 0)
      return (
        <div>
          <RepTotals items={[
            { label: 'Lançamentos', value: despIn.length, color: '#3b82f6' },
            { label: 'Despesas pagas', value: formatPreco(despIn.filter(d => d.status === 'pago').reduce((s, d) => s + (d.value || 0), 0)), color: '#10b981' },
            { label: 'A pagar', value: formatPreco(despIn.filter(d => d.status === 'pendente').reduce((s, d) => s + (d.value || 0), 0)), color: '#f59e0b' },
            { label: 'Total do período', value: formatPreco(totDesp), color: '#ef4444' },
          ]} />
          <div className="rep-grid rep-grid-2">
            <RepCard icon="fa-receipt" title="Despesas por tipo">
              <HBar data={despPorTipo.slice(0, 8)} getLabel={d => d.tipo} getValue={d => d.total} color="#ef4444" />
            </RepCard>
            <RepCard icon="fa-chart-pie" title="Distribuição das despesas">
              <Donut data={despPorTipo.slice(0, 8).map(d => ({ label: d.tipo, value: d.total }))} />
            </RepCard>
          </div>
          <table className="admin-table" style={{ marginTop: '0.75rem' }}>
            <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Pagamento</th><th>Valor</th><th>Status</th></tr></thead>
            <tbody>
              {[...despIn].sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || '')).map(d => {
                const pm = formatPagamento(d.paymentMethod)
                return (
                  <tr key={d.id}>
                    <td>{formatDate(d.dueDate)}</td>
                    <td><span className="despesa-tipo">{d.tipo}</span></td>
                    <td>{d.descricao || '-'}</td>
                    <td>{pm ? <span className={`pag-badge pag-badge-${d.paymentMethod}`}>{pm.label}</span> : '-'}</td>
                    <td className="td-price" style={{ color: 'var(--danger)' }}>{formatPreco(d.value)}</td>
                    <td><span className={`rep-badge ${d.status === 'pago' ? 'status-ok-badge' : 'status-pend-badge'}`}>{d.status === 'pago' ? 'Pago' : 'Pendente'}</span></td>
                  </tr>
                )
              })}
              {despIn.length === 0 && <tr><td colSpan="6" className="td-empty">Sem despesas no período</td></tr>}
            </tbody>
          </table>
        </div>
      )
    }
    return <div className="rep-empty-full"><i className="fa-solid fa-chart-simple"></i><h3>Selecione um relatório</h3></div>
  }

  const groups = ['Vendas / Financeiro', 'Estoque']

  return (
    <div className="fin-table-card rep-panel">
      <div className="rep-sidebar">
        <div className="rep-sidebar-head">
          <i className="fa-solid fa-chart-simple"></i>
          <span>Relatórios</span>
        </div>
        {groups.map(g => (
          <div key={g} className="rep-sidebar-group">
            <p>{g}</p>
            <div className="rep-sidebar-items">
              {REPORTS.filter(r => r.group === g).map(r => (
                <button key={r.id} className={`rep-sidebar-item ${rep === r.id ? 'active' : ''}`} onClick={() => setRep(r.id)}>
                  <i className={`fa-solid ${r.icon}`}></i>
                  <span>{r.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rep-main">
        <div className="rep-header">
          <span className="rep-title"><i className={`fa-solid ${current.icon}`}></i> {current.label}</span>
          <div className="rep-header-actions">
            {rep !== 'dashboard' && (
              <span className="rep-counter">{effStatusF !== 'todos' ? 'Filtrado' : ''}</span>
            )}
            <PeriodFilter
              period={period}
              onChange={setPeriod}
              month={month}
              onMonth={setMonth}
              rangeStart={rangeStart}
              onRangeStart={setRangeStart}
              rangeEnd={rangeEnd}
              onRangeEnd={setRangeEnd}
              label="Filtrar período"
            />
          </div>
        </div>

        <div className="rep-filters">
          <div className="rep-filter-search">
            <i className="fa-solid fa-magnifying-glass"></i>
            <input type="text" placeholder="Buscar por cliente, produto ou pedido..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <input className="rep-filter-money" type="text" placeholder="Valor mín." value={valorMin} onChange={e => setValorMin(e.target.value.replace(/[^\d.,]/g, ''))} />
          <input className="rep-filter-money" type="text" placeholder="Valor máx." value={valorMax} onChange={e => setValorMax(e.target.value.replace(/[^\d.,]/g, ''))} />
          <select className="rep-filter-select" value={statusF} onChange={e => setStatusF(e.target.value)}>
            {statusOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {!isFinLike && (
            <select className="rep-filter-select" value={pagamentoF} onChange={e => setPagamentoF(e.target.value)}>
              {pagamentoOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          )}
          {!isFinLike && (
            <select className="rep-filter-select" value={itemTipoF} onChange={e => setItemTipoF(e.target.value)}>
              <option value="todos">Item: À vista ou a prazo</option>
              <option value="avista">Item: À vista</option>
              <option value="aprazo">Item: A prazo</option>
            </select>
          )}
          <button className="rep-filter-clear" title="Limpar filtros" onClick={() => { setSearch(''); setValorMin(''); setValorMax(''); setStatusF('todos'); setPagamentoF('todos'); setItemTipoF('todos') }}>
            <i className="fa-solid fa-broom"></i>
          </button>
        </div>

        <div className="admin-table-wrap rep-body">
          {rep === 'dashboard' ? renderDashboard() : renderBody()}
        </div>
      </div>
    </div>
  )
}

function AddOrderModal({ produtos, usuarios, orders, productPriceMap, initialCart, preselectedUser, onSave, onClose }) {
  const [step, setStep] = useState(1)
  const [showNewForm, setShowNewForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [cpf, setCpf] = useState('')
  const [endereco, setEndereco] = useState({ cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' })
  const [pagamento, setPagamento] = useState('avista')
  const [dataVencimento, setDataVencimento] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [dataPedido, setDataPedido] = useState(hoje())
  const [orderStatus, setOrderStatus] = useState('pendente')
  const [metodoPagamento, setMetodoPagamento] = useState('pix')
  const [valorPago, setValorPago] = useState('')

  const getInitialPrice = useCallback((p) => {
    if (!p) return 0
    const direct = Number(p.preco)
    if (!isNaN(direct) && direct > 0) return direct
    if (productPriceMap) {
      const byId = productPriceMap.get(String(p.id))
      if (byId > 0) return byId
      const n = String(p.nome || p.displayName || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const byName = productPriceMap.get(n)
      if (byName > 0) return byName
    }
    return 0
  }, [productPriceMap])

  const [cart, setCart] = useState(() => {
    if (initialCart && Object.keys(initialCart).length > 0) {
      return Object.fromEntries(
        Object.entries(initialCart).map(([id, item]) => {
          let preco = Number(item.preco)
          if (isNaN(preco) || preco <= 0) {
            preco = getInitialPrice(item)
          }
          return [id, {
            ...item,
            preco: preco > 0 ? String(preco).replace('.', ',') : '',
            preco_custo: (item.preco_custo != null && item.preco_custo !== '') ? String(item.preco_custo).replace('.', ',') : null,
            tipo: item.tipo || 'avista'
          }]
        })
      )
    }
    return {}
  })
  const [search, setSearch] = useState('')
  const [prodPage, setProdPage] = useState(1)

  const filteredUsers = useMemo(() => {
    if (!userSearch?.trim()) return []
    return (usuarios || []).filter(u => clientMatchesSearch(u, userSearch)).slice(0, 100)
  }, [usuarios, userSearch])

  const recentUsers = useMemo(() => {
    if (userSearch?.trim()) return []
    return (usuarios || []).slice(0, 15)
  }, [usuarios, userSearch])

  useEffect(() => {
    if (preselectedUser) {
      pickUser(preselectedUser)
    }
  }, [])

  const pickUser = async (u) => {
    setSelectedUser(u)
    setNome(u.nome || '')
    let rawTel = u.telefone || ''
    const cleanTel = rawTel.replace(/\D/g, '')
    if (cleanTel.startsWith('55') && cleanTel.length > 10) {
      rawTel = cleanTel.slice(2)
    }
    setTelefone(rawTel)
    setCpf(u.endereco?.cpf || u.cpf || '')

    const userEnd = u.endereco || {}
    let initialCep = String(userEnd.cep || u.cep || '').replace(/\D/g, '')

    // 1. Procurar pedidos anteriores do mesmo cliente (pelo nome ou telefone) para obter endereço completo
    const normPhone = cleanTel.startsWith('55') ? cleanTel : (cleanTel ? '55' + cleanTel : '')
    let foundOrder = null
    if (orders && orders.length > 0) {
      foundOrder = orders.find(o => {
        const cust = o.customer || (o.data && o.data.customer) || o
        const oName = (cust.nome || o.nome || o.cliente || '').trim()
        const oPhone = String(cust.telefone || o.telefone || '').replace(/\D/g, '')
        const oNorm = oPhone.startsWith('55') ? oPhone : '55' + oPhone
        const nameMatch = u.nome && oName && normalizeSearch(u.nome) === normalizeSearch(oName)
        return nameMatch && (normPhone ? oNorm === normPhone : true)
      }) || orders.find(o => {
        const cust = o.customer || (o.data && o.data.customer) || o
        const oName = (cust.nome || o.nome || o.cliente || '').trim()
        return u.nome && oName && normalizeSearch(u.nome) === normalizeSearch(oName)
      }) || orders.find(o => {
        const cust = o.customer || (o.data && o.data.customer) || o
        const oPhone = String(cust.telefone || o.telefone || '').replace(/\D/g, '')
        const oNorm = oPhone.startsWith('55') ? oPhone : '55' + oPhone
        return normPhone && oNorm === normPhone
      })
    }

    if (initialCep.length !== 8 && foundOrder) {
      const fCust = foundOrder.customer || (foundOrder.data && foundOrder.data.customer) || foundOrder
      const fCep = String(fCust.endereco?.cep || foundOrder.endereco?.cep || '').replace(/\D/g, '')
      if (fCep.length === 8) initialCep = fCep
    }

    // 2. Check if a valid 8-digit CEP is present inside other address fields
    if (initialCep.length !== 8) {
      const combined = `${userEnd.numero || ''} ${userEnd.rua || ''} ${userEnd.bairro || ''} ${userEnd.complemento || ''}`
      const numMatch = combined.match(/\b\d{5}-?\d{3}\b|\b\d{8}\b/)
      if (numMatch) {
        const cand = numMatch[0].replace(/\D/g, '')
        if (cand.length === 8) initialCep = cand
      }
    }

    const pastEnd = foundOrder ? (foundOrder.customer?.endereco || foundOrder.endereco || {}) : {}

    const nextEnd = {
      cep: initialCep,
      estado: userEnd.estado || pastEnd.estado || '',
      cidade: userEnd.cidade || u.cidade || pastEnd.cidade || '',
      bairro: userEnd.bairro || pastEnd.bairro || '',
      rua: userEnd.rua || userEnd.logradouro || pastEnd.rua || pastEnd.logradouro || '',
      numero: userEnd.numero || pastEnd.numero || '',
      complemento: userEnd.complemento || pastEnd.complemento || ''
    }
    setEndereco(nextEnd)
    setUserSearch('')
    setShowNewForm(false)

    // 3. If CEP is still missing, but rua and cidade and estado are present, query ViaCEP reverse address search
    if (initialCep.length !== 8 && nextEnd.rua && nextEnd.cidade && nextEnd.estado) {
      try {
        const cleanRua = nextEnd.rua.replace(/^(rua|avenida|av\.?|alameda|travessa|praça|r\.)\s+/i, '').trim()
        if (cleanRua.length >= 3) {
          const url = `https://viacep.com.br/ws/${encodeURIComponent(nextEnd.estado)}/${encodeURIComponent(nextEnd.cidade)}/${encodeURIComponent(cleanRua)}/json/`
          const res = await fetch(url)
          if (res.ok) {
            const data = await res.json()
            if (Array.isArray(data) && data.length > 0 && data[0].cep) {
              const fetchedCep = data[0].cep.replace(/\D/g, '')
              setEndereco(prev => ({ ...prev, cep: fetchedCep }))
            }
          }
        }
      } catch (err) {
        // silent fail on network error
      }
    }
  }

  const resetForm = () => {
    setSelectedUser(null)
    setNome('')
    setTelefone('')
    setEndereco({ cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' })
    setShowNewForm(true)
    setUserSearch('')
  }

  const filteredProds = useMemo(() => {
    return search?.trim() ? (produtos || []).filter(p => p && (searchMatches(p.nome, search) || searchMatches(p.displayName, search) || searchMatches(p.categoria, search))) : (produtos || [])
  }, [produtos, search])

  const paginatedProds = useMemo(() => {
    const start = (prodPage - 1) * 10
    return filteredProds.slice(start, start + 10)
  }, [filteredProds, prodPage])

  const totalPages = Math.ceil(filteredProds.length / 10)
  useEffect(() => { setProdPage(1) }, [search])

  const cartItems = useMemo(() => Object.values(cart).filter(i => i.qty > 0), [cart])
  const cartTotal = useMemo(() => cartItems.reduce((s, i) => s + (parseDecimalToNumber(i.preco)) * (Number(i.qty) || 0), 0), [cartItems])

  const addItem = (p) => {
    const resolvedPreco = getInitialPrice(p)
    setCart(prev => {
      const existing = prev[p.id]
      const currentPrice = existing?.preco !== '' && existing?.preco != null && parseDecimalToNumber(existing.preco) > 0 
        ? existing.preco 
        : (resolvedPreco > 0 ? String(resolvedPreco).replace('.', ',') : '')
      const currentCusto = existing?.preco_custo ?? (p.preco_custo != null ? String(p.preco_custo).replace('.', ',') : null)
      return {
        ...prev,
        [p.id]: {
          id: p.id,
          nome: p.nome,
          preco: currentPrice,
          preco_custo: currentCusto,
          imagem: p.imagem,
          qty: (existing?.qty || 0) + 1,
          tipo: existing?.tipo || 'aprazo',
          semDevolucao: !!p.semDevolucao
        }
      }
    })
  }

  const removeItem = (id) => {
    setCart(prev => {
      if (!prev[id] || prev[id].qty <= 1) {
        const { [id]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [id]: { ...prev[id], qty: prev[id].qty - 1 } }
    })
  }

  const setItemTipo = (id, tipo) => {
    setCart(prev => prev[id] ? { ...prev, [id]: { ...prev[id], tipo } } : prev)
  }

  const setItemPreco = (id, val) => {
    const clean = cleanDecimalInput(val)
    setCart(prev => prev[id] ? { ...prev, [id]: { ...prev[id], preco: clean } } : prev)
  }

  const setItemCusto = (id, val) => {
    const clean = cleanDecimalInput(val)
    setCart(prev => prev[id] ? { ...prev, [id]: { ...prev[id], preco_custo: clean } } : prev)
  }

  const valorPagoNum = parseDecimalToNumber(valorPago)
  const troco = valorPagoNum - cartTotal

  const handleSave = () => {
    if (saving || cartItems.length === 0 || !nome.trim() || !telefone.trim()) return
    const zeroPriceItems = cartItems.filter(i => i.preco === '' || !i.preco || parseDecimalToNumber(i.preco) <= 0)
    if (zeroPriceItems.length > 0) {
      alert(`Atenção: O produto "${zeroPriceItems[0].nome}" está com preço zerado. Por favor, volte ao passo 2 e informe o valor unitário antes de salvar o pedido.`)
      setStep(2)
      return
    }
    setSaving(true)
    const isConcluido = orderStatus === 'concluido' || orderStatus === 'entregue'
    onSave({
      nome: nome.trim(),
      telefone: normalizePhone(telefone),
      cpf: cpf.trim(),
      endereco,
      rota: selectedUser?.rota || (selectedUser?.endereco && selectedUser.endereco.rota) || '',
      dataPedido,
      pagamento: pagamento === 'misto' ? 'misto' : (pagamento === 'aprazo' ? 'aprazo' : 'avista'),
      items: cartItems.map(i => ({
        ...i,
        preco: parseDecimalToNumber(i.preco),
        preco_custo: i.preco_custo != null && i.preco_custo !== '' ? parseDecimalToNumber(i.preco_custo) : null,
        tipo: pagamento === 'aprazo' ? 'aprazo' : (pagamento === 'avista' ? 'avista' : i.tipo)
      })),
      dataVencimento: (pagamento === 'aprazo' || pagamento === 'misto') ? dataVencimento : '',
      status: orderStatus,
      payment: isConcluido ? {
        method: metodoPagamento,
        paid: valorPagoNum || cartTotal
      } : null
    })
  }

  const formatPhone = (v) => {
    const nums = v.replace(/\D/g, '').slice(0, 11)
    if (nums.length <= 2) return `(${nums}`
    if (nums.length <= 7) return `(${nums.slice(0, 2)}) ${nums.slice(2)}`
    return `(${nums.slice(0, 2)}) ${nums.slice(2, 7)}-${nums.slice(7)}`
  }

  const normalizePhone = (v) => {
    const nums = v.replace(/\D/g, '')
    return nums.startsWith('55') ? nums : '55' + nums
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal admin-modal-lg" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h3><i className="fa-solid fa-plus-circle"></i> Novo Pedido</h3>
          <button className="admin-modal-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>

        <div className="admin-steps">
          <span className={`step ${step >= 1 ? (step > 1 ? 'done' : 'active') : ''}`}>1. Cliente</span>
          <span className={`step ${step >= 2 ? (step > 2 ? 'done' : 'active') : ''}`}>2. Itens</span>
          <span className={`step ${step >= 3 ? (step > 3 ? 'done' : 'active') : ''}`}>3. Pagamento</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1.5rem', borderBottom: '1px solid var(--admin-border)', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.82rem', fontWeight: 600 }}><i className="fa-solid fa-flag"></i> Status inicial do pedido</label>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {[
              { id: 'pre-pedido', label: 'Pré-Pedido' },
              { id: 'pendente', label: 'Pendente' },
              { id: 'confirmado', label: 'Confirmado' },
              { id: 'em-andamento', label: 'Em Andamento' },
              { id: 'em-rota', label: 'Em Rota' },
              { id: 'entregue', label: 'Entregue' },
              { id: 'acerto', label: 'Acerto' },
              { id: 'concluido', label: 'Concluído' },
              { id: 'cancelado', label: 'Cancelado' },
            ].map(s => (
              <button key={s.id} type="button" className={`pag-chip ${orderStatus === s.id ? 'active' : ''}`}
                style={{ padding: '0.35rem 0.8rem' }}
                onClick={() => setOrderStatus(s.id)}>{s.label}</button>
            ))}
          </div>
        </div>

        <div className="admin-modal-body">
          {step === 1 && (
            <div className="modal-form">
              {!showNewForm && !selectedUser && (
                <>
                  <div className="form-group">
                    <label>Buscar cliente existente</label>
                    <div className="admin-search-prod">
                      <input
                        type="text"
                        placeholder="Digite nome, telefone, cidade ou documento..."
                        value={userSearch}
                        onChange={e => setUserSearch(e.target.value)}
                        style={{ width: '100%' }}
                        autoFocus
                      />
                    </div>
                    {userSearch && filteredUsers.length > 0 && (
                      <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: '8px', marginTop: '0.4rem' }}>
                        <div style={{ padding: '0.35rem 0.6rem', fontSize: '0.72rem', color: 'var(--admin-text-sec)', borderBottom: '1px solid var(--admin-border)', background: 'var(--admin-card-bg)', fontWeight: 600 }}>
                          {filteredUsers.length} cliente(s) encontrado(s):
                        </div>
                        {filteredUsers.map((u, idx) => (
                          <div key={u.id ? `uid-${u.id}` : `${u.nome}-${u.telefone}-${idx}`} className="add-prod-row" style={{ cursor: 'pointer', padding: '0.5rem 0.7rem' }} onClick={() => pickUser(u)}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{u.nome}</span>
                                {u.rota && (
                                  <span style={{ background: '#e0f2fe', color: '#0369a1', borderRadius: '4px', padding: '1px 6px', fontSize: '0.68rem', fontWeight: 600 }}>
                                    <i className="fa-solid fa-route" style={{ fontSize: '0.62rem', marginRight: '3px' }}></i>{u.rota}
                                  </span>
                                )}
                                {u.source && (
                                  <span style={{ background: '#f1f5f9', color: '#475569', borderRadius: '4px', padding: '1px 6px', fontSize: '0.68rem' }}>
                                    {u.source === 'pedido' ? 'histórico' : (u.source === 'rota' ? 'rota' : 'cadastro')}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '2px' }}>
                                <span><i className="fa-solid fa-phone" style={{ fontSize: '0.68rem' }}></i> {u.telefone || 'Sem telefone'}</span>
                                {(u.endereco?.cidade || u.cidade) && <span>· <i className="fa-solid fa-location-dot" style={{ fontSize: '0.68rem' }}></i> {u.endereco?.cidade || u.cidade}{u.endereco?.estado ? `/${u.endereco.estado}` : ''}</span>}
                                {u.email && <span>· {u.email}</span>}
                              </div>
                            </div>
                            <i className="fa-solid fa-chevron-right" style={{ color: 'var(--admin-text-sec)', fontSize: '0.75rem' }}></i>
                          </div>
                        ))}
                      </div>
                    )}
                    {userSearch && filteredUsers.length === 0 && (
                      <p style={{ fontSize: '0.82rem', color: 'var(--admin-text-sec)', marginTop: '0.4rem' }}>
                        Nenhum cliente encontrado para "{userSearch}". <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginLeft: '0.3rem' }} onClick={resetForm}><i className="fa-solid fa-plus"></i> Adicionar Novo</button>
                      </p>
                    )}
                    {!userSearch && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                          <span style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', fontWeight: 500 }}>Clientes recentes / sugeridos:</span>
                          <button className="admin-btn" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }} onClick={resetForm}><i className="fa-solid fa-plus"></i> Novo Cliente</button>
                        </div>
                        <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: '8px' }}>
                          {recentUsers.map((u, idx) => (
                            <div key={u.id ? `uid-recent-${u.id}` : `recent-${u.nome}-${u.telefone}-${idx}`} className="add-prod-row" style={{ cursor: 'pointer', padding: '0.45rem 0.7rem' }} onClick={() => pickUser(u)}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{u.nome}</span>
                                  {u.rota && (
                                    <span style={{ background: '#e0f2fe', color: '#0369a1', borderRadius: '4px', padding: '1px 5px', fontSize: '0.65rem', fontWeight: 600 }}>
                                      {u.rota}
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.73rem', color: 'var(--admin-text-sec)', marginTop: '2px' }}>
                                  {u.telefone} {(u.endereco?.cidade || u.cidade) ? `· ${u.endereco?.cidade || u.cidade}` : ''}
                                </div>
                              </div>
                              <i className="fa-solid fa-chevron-right" style={{ color: 'var(--admin-text-sec)', fontSize: '0.75rem' }}></i>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {(selectedUser || showNewForm) && (
                <>
                  {selectedUser && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.7rem', background: 'var(--accent-bg)', borderRadius: '8px', marginBottom: '0.75rem' }}>
                      <i className="fa-solid fa-user-check" style={{ color: 'var(--accent)' }}></i>
                      <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 500 }}>{selectedUser.nome} — {selectedUser.telefone}</span>
                      <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem' }} onClick={() => { setSelectedUser(null); setShowNewForm(false); setNome(''); setTelefone(''); setCpf(''); setEndereco({ cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' }) }}>
                        <i className="fa-solid fa-xmark"></i> Trocar
                      </button>
                    </div>
                  )}

                  <div className="form-group">
                    <label>Nome do cliente *</label>
                    <input type="text" placeholder="Nome completo" value={nome} onChange={e => setNome(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Telefone / WhatsApp *</label>
                    <input type="text" placeholder="(31) 99999-9999" value={formatPhone(telefone)} onChange={e => setTelefone(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>CPF</label>
                    <input type="text" placeholder="000.000.000-00 (Opcional)" value={cpf} onChange={e => setCpf(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Endereço</label>
                    <AddressForm value={endereco} onChange={(a) => setEndereco(a)} requiredFields={false} />
                  </div>
                </>
              )}

              {showNewForm && !selectedUser && (
                <div className="form-group">
                  <div className="form-group">
                    <label>Nome do cliente *</label>
                    <input type="text" placeholder="Nome completo" value={nome} onChange={e => setNome(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Telefone / WhatsApp *</label>
                    <input type="text" placeholder="(31) 99999-9999" value={formatPhone(telefone)} onChange={e => setTelefone(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>CPF</label>
                    <input type="text" placeholder="000.000.000-00 (Opcional)" value={cpf} onChange={e => setCpf(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Endereço</label>
                    <AddressForm value={endereco} onChange={(a) => setEndereco(a)} requiredFields={false} />
                  </div>
                </div>
              )}

              <button className="admin-btn admin-btn-primary" disabled={!nome.trim() || !telefone.trim()} onClick={() => setStep(2)} style={{ marginTop: '0.75rem' }}>
                Próximo <i className="fa-solid fa-arrow-right"></i>
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="modal-form">
              <div className="admin-search-prod" style={{ marginBottom: '0.75rem' }}>
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>

              <div className="add-prod-list">
                {paginatedProds.map(p => {
                  const inCart = cart[p.id]
                  const initPrice = getInitialPrice(p)
                  return (
                    <div key={p.id} className={`add-prod-row ${inCart ? 'in-cart' : ''}`}>
                      <div className="add-prod-info">
                        <span className="add-prod-name">{p.nome}</span>
                        {initPrice > 0 ? (
                          <span className="add-prod-price">{formatPreco(initPrice)}</span>
                        ) : (
                          <span className="add-prod-price" style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.78rem' }}>
                            <i className="fa-solid fa-triangle-exclamation"></i> Sem preço definido
                          </span>
                        )}
                      </div>
                      {inCart ? (
                        <div className="add-prod-controls">
                          <span className="add-prod-qty">{inCart.qty}x</span>
                          <button className="qty-btn-sm" onClick={() => removeItem(p.id)}><i className="fa-solid fa-minus"></i></button>
                          <button className="qty-btn-sm" onClick={() => addItem(p)}><i className="fa-solid fa-plus"></i></button>
                        </div>
                      ) : (
                        <button className="add-prod-add" onClick={() => addItem(p)}>
                          <i className="fa-solid fa-plus"></i> Adicionar
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {totalPages > 1 && (
                <div className="admin-pagination" style={{ marginTop: '0.75rem' }}>
                  <button disabled={prodPage === 1} onClick={() => setProdPage(p => p - 1)}><i className="fa-solid fa-chevron-left"></i></button>
                  <span>{prodPage}/{totalPages}</span>
                  <button disabled={prodPage === totalPages} onClick={() => setProdPage(p => p + 1)}><i className="fa-solid fa-chevron-right"></i></button>
                </div>
              )}

              {cartItems.length > 0 && (
                <div className="add-prod-cart">
                  <p className="add-prod-cart-title">Itens do pedido — ajuste preço e custo:</p>
                  {cartItems.map(i => {
                    const isZero = i.preco === '' || !i.preco || parseDecimalToNumber(i.preco) <= 0
                    return (
                      <div key={i.id} className={`add-prod-cart-item ${isZero ? 'has-zero-price' : ''}`} style={isZero ? { border: '1.5px solid #ef4444', background: '#fef2f2', borderRadius: '8px', padding: '0.5rem 0.75rem', marginBottom: '0.5rem' } : {}}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                          <span className="add-prod-cart-name" style={{ fontWeight: 600 }}>{i.nome} ({i.qty}x)</span>
                          {isZero && (
                            <span style={{ color: '#ef4444', fontSize: '0.75rem', fontWeight: 700 }}>
                              <i className="fa-solid fa-circle-exclamation"></i> Preço obrigatório!
                            </span>
                          )}
                        </div>
                        <div className="add-prod-cart-fields">
                          <label style={isZero ? { color: '#dc2626', fontWeight: 700 } : {}}>
                            Preço Unitário (R$) *
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0,00 (Obrigatório)"
                              style={isZero ? { borderColor: '#ef4444', background: '#fff' } : {}}
                              value={i.preco === '' ? '' : i.preco}
                              onChange={e => setItemPreco(i.id, e.target.value)}
                              onClick={e => e.stopPropagation()}
                            />
                          </label>
                          <label style={{ color: '#059669', fontWeight: 600 }}>Custo (R$)
                            <input
                              type="text"
                              inputMode="decimal"
                              value={i.preco_custo ?? ''}
                              placeholder="0,00"
                              style={{ borderColor: '#10b981' }}
                              onChange={e => setItemCusto(i.id, e.target.value)}
                              onClick={e => e.stopPropagation()}
                            />
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {cartItems.length > 0 && (
                <div className="add-prod-summary">
                  <span>{cartItems.reduce((s, i) => s + (Number(i.qty) || 0), 0)} {cartItems.reduce((s, i) => s + (Number(i.qty) || 0), 0) === 1 ? 'item adicionado' : 'itens adicionados'} ({cartItems.length} produtos)</span>
                  <span>Total: <strong>{formatPreco(cartTotal)}</strong></span>
                </div>
              )}

              {cartItems.some(i => i.preco === '' || !i.preco || Number(i.preco) <= 0) && (
                <div style={{ background: '#fee2e2', border: '1px solid #ef4444', color: '#b91c1c', borderRadius: '8px', padding: '0.6rem 0.8rem', fontSize: '0.8rem', fontWeight: 600, marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <i className="fa-solid fa-triangle-exclamation"></i>
                  <span>Atenção: produto(s) com preço zerado. Informe o valor unitário acima para avançar.</span>
                </div>
              )}

              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setStep(1)}><i className="fa-solid fa-arrow-left"></i> Voltar</button>
                <button
                  className="admin-btn admin-btn-primary"
                  disabled={cartItems.length === 0}
                  onClick={() => {
                    const zeroItems = cartItems.filter(i => i.preco === '' || !i.preco || Number(i.preco) <= 0)
                    if (zeroItems.length > 0) {
                      alert(`O produto "${zeroItems[0].nome}" está com preço zerado! Por favor, informe o valor unitário no campo destacado em vermelho antes de avançar.`)
                      return
                    }
                    setStep(3)
                  }}
                >
                  Próximo <i className="fa-solid fa-arrow-right"></i>
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="modal-form">
              <div className="form-group">
                <label>Data do Pedido</label>
                <input type="date" value={dataPedido} onChange={e => setDataPedido(e.target.value)} />
              </div>
              <div className="payment-options-admin">
                <label className={`pay-opt ${pagamento === 'avista' ? 'selected' : ''}`}>
                  <input type="radio" name="pag" value="avista" checked={pagamento === 'avista'} onChange={() => setPagamento('avista')} />
                  <i className="fa-solid fa-money-bill-wave"></i>
                  <div><strong>À Vista</strong><span>Pagar tudo agora</span></div>
                </label>
                <label className={`pay-opt ${pagamento === 'aprazo' ? 'selected' : ''}`}>
                  <input type="radio" name="pag" value="aprazo" checked={pagamento === 'aprazo'} onChange={() => setPagamento('aprazo')} />
                  <i className="fa-solid fa-calendar"></i>
                  <div><strong>A Prazo</strong><span>Pagar depois</span></div>
                </label>
                <label className={`pay-opt ${pagamento === 'misto' ? 'selected' : ''}`}>
                  <input type="radio" name="pag" value="misto" checked={pagamento === 'misto'} onChange={() => setPagamento('misto')} />
                  <i className="fa-solid fa-split"></i>
                  <div><strong>Misto</strong><span>Parte agora, parte depois</span></div>
                </label>
              </div>

              {(pagamento === 'aprazo' || pagamento === 'misto') && (
                <div className="form-group">
                  <label>Data de vencimento</label>
                  <input type="date" value={dataVencimento} onChange={e => setDataVencimento(e.target.value)} />
                </div>
              )}

              {pagamento === 'misto' && (
                <div className="split-admin">
                  <p className="split-label">Defina cada item:</p>
                  {cartItems.map(i => (
                    <div key={i.id} className={`split-row-admin ${i.tipo === 'aprazo' ? 'prazo' : 'vista'}`} onClick={() => setItemTipo(i.id, i.tipo === 'avista' ? 'aprazo' : 'avista')}>
                      <span>{i.nome} ({i.qty}x)</span>
                      <span className={`split-badge ${i.tipo === 'avista' ? 'vista' : 'aprazo'}`}>
                        {i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {orderStatus === 'entregue' && (
                <div className="payment-done-admin">
                  <p className="payment-done-title">
                    <i className="fa-solid fa-circle-check"></i> Registro de Pagamento (Concluído)
                  </p>
                  <div className="payment-done-methods">
                    {['pix', 'dinheiro', 'cartao', 'pix+dinheiro', 'pix+cartao', 'cartao+dinheiro'].map(m => (
                      <button key={m} type="button" className={`pay-done-chip ${metodoPagamento === m ? 'active' : ''}`} onClick={() => setMetodoPagamento(m)}>
                        <i className={`fa-solid ${PAG_METHODS[m]?.icon || 'fa-money-bill-wave'}`}></i>
                        {PAG_METHODS[m]?.label || m}
                      </button>
                    ))}
                  </div>
                  <div className="payment-done-values">
                    <label>Valor recebido (R$)
                      <input type="text" inputMode="decimal" placeholder={String(cartTotal.toFixed(2)).replace('.', ',')} value={valorPago} onChange={e => setValorPago(cleanDecimalInput(e.target.value))} />
                    </label>
                    <div className="payment-done-totals">
                      <span>Total do pedido: <strong>{formatPreco(cartTotal)}</strong></span>
                      {valorPagoNum > 0 && (
                        <span className={troco >= 0 ? 'payment-troco-ok' : 'payment-troco-pend'}>
                          {troco >= 0 ? <><i className="fa-solid fa-money-bill-transfer"></i> Troco: {formatPreco(troco)}</> : <><i className="fa-solid fa-triangle-exclamation"></i> Falta: {formatPreco(-troco)}</>}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setStep(2)}><i className="fa-solid fa-arrow-left"></i> Voltar</button>
                <button className="admin-btn admin-btn-primary btn-save-order" disabled={saving || cartItems.length === 0} onClick={handleSave}>
                  {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Salvando...</> : <><i className="fa-solid fa-check"></i> Salvar Pedido</>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================
// MODAL: ORDER DETAIL (with pre-pedido review + pendente edit)
// =============================================
function getOrderRawItems(ord) {
  if (!ord) return []
  if (Array.isArray(ord.items) && ord.items.length > 0) return ord.items
  if (Array.isArray(ord.originalItems) && ord.originalItems.length > 0) return ord.originalItems
  if (Array.isArray(ord.itens) && ord.itens.length > 0) return ord.itens
  return []
}

function OrderDetailModal({ order, financial, produtos, usuarios, onClose, onStatusChange, onUpdateDue, onPreApprovar, onEditAndConfirm, onEditSave, onSyncCusto, onOpenDelivery, onUpdateCustomer, onCancelOrder }) {
  const [rejectedItems, setRejectedItems] = useState(new Set())
  const [editMode, setEditMode] = useState(false)
  const [editedItems, setEditedItems] = useState(() => getOrderRawItems(order).map(i => {
    const c = (i.preco_custo != null && i.preco_custo !== '') ? String(i.preco_custo).replace('.', ',') : (getItemCost(i, produtos) ? String(getItemCost(i, produtos)).replace('.', ',') : '')
    return {
      ...i,
      qty: (i.qty != null && i.qty !== '') ? (Number(i.qty) || 1) : 1,
      preco: (i.preco != null && i.preco !== '') ? String(i.preco).replace('.', ',') : '0',
      preco_custo: c || ''
    }
  }))
  const [addSearch, setAddSearch] = useState('')
  const [addCart, setAddCart] = useState({})
  const [preAddSearch, setPreAddSearch] = useState('')
  const [preAddCart, setPreAddCart] = useState({})
  const [preReplacements, setPreReplacements] = useState([])
  const [preVencimento, setPreVencimento] = useState(() => {
    return order.dataVencimento || (() => {
      const d = new Date()
      d.setDate(d.getDate() + 60)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()
  })
  const [customerEdit, setCustomerEdit] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const filteredUsers = useMemo(() => {
    if (!usuarios || !userSearch?.trim()) return []
    return usuarios.filter(u => clientMatchesSearch(u, userSearch)).slice(0, 100)
  }, [usuarios, userSearch])
  const [editCustomer, setEditCustomer] = useState({
    id: order.user_id || order.customer?.id || null,
    nome: order.customer?.nome || '',
    email: order.customer?.email || '',
    telefone: order.customer?.telefone || '',
    cpf: order.customer?.cpf || order.customer?.endereco?.cpf || '',
    endereco: { ...(order.customer?.endereco || {}) }
  })

  const orderId = order?.id
  useEffect(() => {
    if (order && !editMode) {
      setEditCustomer({
        id: order.user_id || order.customer?.id || null,
        nome: order.customer?.nome || '',
        email: order.customer?.email || '',
        telefone: order.customer?.telefone || '',
        cpf: order.customer?.cpf || order.customer?.endereco?.cpf || '',
        endereco: { ...(order.customer?.endereco || {}) }
      })
      setEditedItems(getOrderRawItems(order).map(i => {
        const c = (i.preco_custo != null && i.preco_custo !== '') ? String(i.preco_custo).replace('.', ',') : (getItemCost(i, produtos) ? String(getItemCost(i, produtos)).replace('.', ',') : '')
        return {
          ...i,
          qty: (i.qty != null && i.qty !== '') ? (Number(i.qty) || 1) : 1,
          preco: (i.preco != null && i.preco !== '') ? String(i.preco).replace('.', ',') : '0',
          preco_custo: c || ''
        }
      }))
    }
  }, [orderId, order, editMode])

  const toggleReject = (idx) => {
    setRejectedItems(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  const changeQty = (idx, delta) => {
    setEditedItems(prev => prev.map((item, i) => i === idx ? { ...item, qty: Math.max(0, (Number(item.qty) || 0) + delta) } : item))
  }

  const setItemQty = (idx, val) => {
    const clean = val === '' ? 0 : Math.max(0, parseInt(val, 10) || 0)
    setEditedItems(prev => prev.map((item, i) => i === idx ? { ...item, qty: clean } : item))
  }

  const resetEditedItems = () => {
    setEditedItems(getOrderRawItems(order).map(i => {
      const c = (i.preco_custo != null && i.preco_custo !== '') ? String(i.preco_custo).replace('.', ',') : (getItemCost(i, produtos) ? String(getItemCost(i, produtos)).replace('.', ',') : '')
      return {
        ...i,
        qty: (i.qty != null && i.qty !== '') ? (Number(i.qty) || 1) : 1,
        preco: (i.preco != null && i.preco !== '') ? String(i.preco).replace('.', ',') : '0',
        preco_custo: c || ''
      }
    }))
  }

  const handleOpenDelivery = (mode = 'acerto') => {
    const raw = getOrderRawItems(order)
    const activeItems = (editedItems && editedItems.length > 0)
      ? editedItems.map(i => ({
          ...i,
          qty: Number(i.qty) || 0,
          preco: parseDecimalToNumber(i.preco),
          preco_custo: (i.preco_custo != null && i.preco_custo !== '') ? parseDecimalToNumber(i.preco_custo) : getItemCost(i, produtos)
        })).filter(i => (Number(i.qty) || 0) > 0)
      : raw
    const orderWithLatest = {
      ...order,
      items: activeItems.length > 0 ? activeItems : raw,
      itens: activeItems.length > 0 ? activeItems : raw,
      originalItems: (Array.isArray(order.originalItems) && order.originalItems.length > 0) ? order.originalItems : (activeItems.length > 0 ? activeItems : raw)
    }
    onOpenDelivery?.(orderWithLatest, mode)
  }

  const setItemPreco = (idx, val) => {
    const clean = cleanDecimalInput(val)
    setEditedItems(prev => prev.map((item, i) => i === idx ? { ...item, preco: clean } : item))
  }

  const setItemCusto = (idx, val) => {
    const clean = cleanDecimalInput(val)
    setEditedItems(prev => prev.map((item, i) => i === idx ? { ...item, preco_custo: clean } : item))
    const prodId = editedItems[idx]?.id
    if (prodId != null) {
      const numCusto = parseDecimalToNumber(clean)
      onSyncCusto?.(prodId, clean === '' ? null : numCusto)
    }
  }

  const removeItem = (idx) => {
    setEditedItems(prev => prev.filter((_, i) => i !== idx))
  }

  const addItemToEdit = (p) => {
    const unitPreco = Number(String(p.preco || 0).replace(',', '.')) || 0
    const rawCusto = (p.preco_custo != null && p.preco_custo !== '') ? Number(String(p.preco_custo).replace(',', '.')) : (getItemCost(p, produtos) || null)
    setAddCart(prev => ({
      ...prev,
      [p.id]: {
        id: p.id,
        nome: p.nome || p.displayName,
        preco: unitPreco,
        preco_custo: rawCusto > 0 ? rawCusto : null,
        imagem: p.imagem,
        tipo: 'aprazo',
        qty: ((prev[p.id]?.qty || 0) + 1),
        semDevolucao: !!p.semDevolucao
      }
    }))
  }

  const removeFromAddCart = (id) => {
    setAddCart(prev => {
      if (!prev[id] || prev[id].qty <= 1) {
        const { [id]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [id]: { ...prev[id], qty: prev[id].qty - 1 } }
    })
  }

  const confirmAddItems = () => {
    const newItems = Object.values(addCart).filter(i => (Number(i.qty) || 0) > 0)
    if (newItems.length === 0) return
    setEditedItems(prev => {
      const copy = [...prev]
      for (const ni of newItems) {
        const existIdx = copy.findIndex(it => (it.id != null && ni.id != null && String(it.id) === String(ni.id)) || (it.nome && ni.nome && it.nome.trim().toLowerCase() === ni.nome.trim().toLowerCase()))
        if (existIdx >= 0) {
          copy[existIdx] = {
            ...copy[existIdx],
            qty: (Number(copy[existIdx].qty) || 0) + (Number(ni.qty) || 1)
          }
        } else {
          copy.push({
            ...ni,
            qty: Number(ni.qty) || 1,
            preco: ni.preco != null ? String(ni.preco).replace('.', ',') : '0',
            preco_custo: ni.preco_custo != null ? String(ni.preco_custo).replace('.', ',') : ''
          })
        }
      }
      return copy
    })
    setAddCart({})
    setAddSearch('')
  }

  const handleEditConfirm = () => {
    const validItems = editedItems.filter(i => (Number(i.qty) || 0) > 0).map(i => ({
      ...i,
      qty: Number(i.qty) || 0,
      preco: parseDecimalToNumber(i.preco),
      preco_custo: (i.preco_custo != null && i.preco_custo !== '') ? parseDecimalToNumber(i.preco_custo) : getItemCost(i, produtos)
    }))
    if (validItems.length === 0) { return }
    onEditAndConfirm(validItems, order.status)
    setEditMode(false)
  }

  const handleEditSave = () => {
    const validItems = editedItems.filter(i => (Number(i.qty) || 0) > 0).map(i => ({
      ...i,
      qty: Number(i.qty) || 0,
      preco: parseDecimalToNumber(i.preco),
      preco_custo: (i.preco_custo != null && i.preco_custo !== '') ? parseDecimalToNumber(i.preco_custo) : getItemCost(i, produtos)
    }))
    if (validItems.length === 0) { return }
    onEditSave(validItems)
    setEditMode(false)
  }

  const editTotal = Math.round(editedItems.filter(i => (Number(i.qty) || 0) > 0).reduce((s, i) => s + parseDecimalToNumber(i.preco) * (Number(i.qty) || 0), 0) * 100) / 100
  const editTotalPieces = editedItems.reduce((s, i) => s + (Number(i.qty) || 0), 0)

  const filteredAddProds = useMemo(() => {
    if (!addSearch) return []
    return (produtos || []).filter(p => p && (searchMatches(p.nome, addSearch) || searchMatches(p.displayName, addSearch) || searchMatches(p.categoria, addSearch))).slice(0, 15)
  }, [produtos, addSearch])

  const filteredPreAddProds = useMemo(() => {
    if (!preAddSearch) return []
    return (produtos || []).filter(p => p && (searchMatches(p.nome, preAddSearch) || searchMatches(p.displayName, preAddSearch) || searchMatches(p.categoria, preAddSearch))).slice(0, 15)
  }, [produtos, preAddSearch])

  const addToPreReplacement = (p) => {
    const unitPreco = Number(String(p.preco || 0).replace(',', '.')) || 0
    const rawCusto = (p.preco_custo != null && p.preco_custo !== '') ? Number(String(p.preco_custo).replace(',', '.')) : (getItemCost(p, produtos) || null)
    setPreAddCart(prev => ({
      ...prev,
      [p.id]: {
        id: p.id,
        nome: p.nome || p.displayName,
        preco: unitPreco,
        preco_custo: rawCusto > 0 ? rawCusto : null,
        imagem: p.imagem,
        tipo: 'aprazo',
        qty: ((prev[p.id]?.qty || 0) + 1),
        semDevolucao: !!p.semDevolucao
      }
    }))
  }

  const removeFromPreCart = (id) => {
    setPreAddCart(prev => {
      if (!prev[id] || prev[id].qty <= 1) {
        const { [id]: _, ...keep } = prev
        return keep
      }
      return { ...prev, [id]: { ...prev[id], qty: prev[id].qty - 1 } }
    })
  }

  const confirmPreReplacements = () => {
    const newItems = Object.values(preAddCart).filter(i => (Number(i.qty) || 0) > 0)
    if (newItems.length === 0) return
    setPreReplacements(prev => {
      const copy = [...prev]
      for (const ni of newItems) {
        const existIdx = copy.findIndex(it => String(it.id) === String(ni.id))
        if (existIdx >= 0) {
          copy[existIdx] = {
            ...copy[existIdx],
            qty: (Number(copy[existIdx].qty) || 0) + (Number(ni.qty) || 1)
          }
        } else {
          copy.push({
            ...ni,
            qty: Number(ni.qty) || 1,
            preco: Number(String(ni.preco).replace(',', '.')) || 0
          })
        }
      }
      return copy
    })
    setPreAddCart({})
    setPreAddSearch('')
  }

  if (editMode) {
    return (
      <div className="admin-overlay" onClick={() => { setEditMode(false); resetEditedItems(); setAddCart({}) }}>
        <div className="admin-modal admin-modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
          <div className="admin-modal-header">
            <h3><i className="fa-solid fa-pen"></i> Editar Itens — Pedido #{order.id.toString().slice(-6)} ({editTotalPieces} {editTotalPieces === 1 ? 'item' : 'itens'})</h3>
            <button className="admin-modal-close" onClick={() => { setEditMode(false); resetEditedItems(); setAddCart({}) }}><i className="fa-solid fa-xmark"></i></button>
          </div>
          <div className="admin-modal-body">
            <div className="detail-section">
              <h4>Itens do Pedido ({editTotalPieces} {editTotalPieces === 1 ? 'item total' : 'itens totais'})</h4>
              {editedItems.map((i, idx) => {
                const itemQty = Number(i.qty) || 0
                const itemPrice = parseDecimalToNumber(i.preco)
                const itemSubtotal = Math.round(itemQty * itemPrice * 100) / 100
                return (
                  <div key={idx} className="detail-item" style={{ opacity: itemQty <= 0 ? 0.4 : 1 }}>
                    <div style={{ flex: 1 }}>
                      <span className="detail-item-name" style={{ textDecoration: itemQty <= 0 ? 'line-through' : 'none' }}>{i.displayName || i.nome || 'Produto'}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--admin-text-sec)', fontWeight: 600 }}>Preço: R$</span>
                        <input type="text" inputMode="decimal" value={i.preco}
                          onChange={e => setItemPreco(idx, e.target.value)}
                          style={{ width: '80px', padding: '0.2rem 0.35rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', textAlign: 'right' }}
                        />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
                        <span style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}><i className="fa-solid fa-tag"></i> Custo: R$</span>
                        <input type="text" inputMode="decimal" value={i.preco_custo ?? ''} placeholder="0,00"
                          onChange={e => setItemCusto(idx, e.target.value)}
                          style={{ width: '80px', padding: '0.2rem 0.35rem', borderRadius: '6px', border: '1px solid #10b981', fontSize: '0.82rem', textAlign: 'right' }}
                        />
                      </div>
                      {itemQty > 1 && (
                        <div style={{ fontSize: '0.74rem', color: 'var(--accent)', fontWeight: 700, marginTop: '0.2rem' }}>
                          <i className="fa-solid fa-calculator"></i> Subtotal: {formatPreco(itemSubtotal)} ({itemQty}x de {formatPreco(itemPrice)})
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span className={`split-badge ${i.tipo === 'avista' ? 'vista' : 'aprazo'}`}>
                        {i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', border: '1px solid var(--admin-border)', borderRadius: '6px', padding: '2px' }}>
                        <button type="button" className="qty-btn-sm" onClick={() => changeQty(idx, -1)}><i className="fa-solid fa-minus"></i></button>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={i.qty}
                          onChange={e => setItemQty(idx, e.target.value)}
                          style={{ width: '38px', textAlign: 'center', fontSize: '0.82rem', fontWeight: 700, border: 'none', background: 'transparent', outline: 'none' }}
                        />
                        <button type="button" className="qty-btn-sm" onClick={() => changeQty(idx, 1)}><i className="fa-solid fa-plus"></i></button>
                      </div>
                      <button className="action-btn action-delete" title="Remover" onClick={() => removeItem(idx)}><i className="fa-solid fa-trash"></i></button>
                    </div>
                  </div>
                )
              })}
              {editedItems.length === 0 && <p style={{ fontSize: '0.85rem', color: 'var(--admin-text-sec)' }}>Nenhum item no pedido</p>}
            </div>

            <div className="detail-section">
              <h4><i className="fa-solid fa-plus-circle"></i> Adicionar Produtos</h4>
              <div className="admin-search-prod" style={{ marginBottom: '0.5rem' }}>
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar produto para adicionar..." value={addSearch} onChange={e => setAddSearch(e.target.value)} style={{ width: '100%' }} />
              </div>
              {filteredAddProds.length > 0 && (
                <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: '8px' }}>
                  {filteredAddProds.map(p => {
                    const inCart = addCart[p.id]
                    return (
                      <div key={p.id} className="add-prod-row" style={{ padding: '0.4rem 0.6rem' }}>
                        <div className="add-prod-info">
                          <span className="add-prod-name">{p.nome}</span>
                          <span className="add-prod-price">{formatPreco(p.preco)}</span>
                        </div>
                        {inCart ? (
                          <div className="add-prod-controls">
                            <span className="add-prod-qty">{inCart.qty}x</span>
                            <button className="qty-btn-sm" onClick={() => removeFromAddCart(p.id)}><i className="fa-solid fa-minus"></i></button>
                            <button className="qty-btn-sm" onClick={() => addItemToEdit(p)}><i className="fa-solid fa-plus"></i></button>
                          </div>
                        ) : (
                          <button className="add-prod-add" onClick={() => addItemToEdit(p)}>
                            <i className="fa-solid fa-plus"></i> Adicionar
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {Object.values(addCart).filter(i => i.qty > 0).length > 0 && (
                <button className="admin-btn admin-btn-primary" style={{ marginTop: '0.5rem', fontSize: '0.82rem' }} onClick={confirmAddItems}>
                  <i className="fa-solid fa-check"></i> Adicionar {Object.values(addCart).reduce((s, i) => s + i.qty, 0)} item(ns) ao pedido
                </button>
              )}
              {!addSearch && <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Digite o nome do produto para buscá-lo no catálogo</p>}
            </div>

            <div className="detail-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>Total: <strong style={{ color: 'var(--accent)', fontSize: '1.2rem', marginLeft: '0.25rem' }}>{formatPreco(editTotal)}</strong></span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--admin-text)' }}>
                  {editTotalPieces} {editTotalPieces === 1 ? 'item' : 'itens'} <span style={{ fontWeight: 400, color: 'var(--admin-text-sec)', fontSize: '0.78rem' }}>({editedItems.filter(i => (Number(i.qty) || 0) > 0).length} produtos)</span>
                </span>
              </div>
            </div>

            <div className="modal-actions">
              <button className="admin-btn admin-btn-sec" onClick={() => { setEditMode(false); resetEditedItems(); setAddCart({}) }}>Cancelar</button>
              <button className="admin-btn" style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }} disabled={editedItems.filter(i => (Number(i.qty) || 0) > 0).length === 0} onClick={handleEditSave}>
                <i className="fa-solid fa-save"></i> Salvar
              </button>
              {order.status !== 'acerto' && order.status !== 'entregue' && (
                <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} disabled={editedItems.filter(i => (Number(i.qty) || 0) > 0).length === 0} onClick={handleEditConfirm}>
                  <i className="fa-solid fa-check"></i> {order.status === 'em-rota' ? 'Salvar e Finalizar Entrega' : 'Salvar e Enviar para Rota'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div className="admin-modal-header">
          <h3><i className="fa-solid fa-receipt"></i> Pedido #{order.id.toString().slice(-6)} <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent)', marginLeft: '0.4rem' }}>({getOrderRawItems(order).reduce((s, i) => s + (Number(i.qty) || 0), 0)} peças totais)</span></h3>
          <button className="admin-modal-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>
        <div className="admin-modal-body">
          <div className="detail-section">
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Cliente
              {!customerEdit && order.status !== 'cancelado' && (
                <button className="action-btn" title="Editar dados do cliente" onClick={() => {
                  setEditCustomer({
                    id: order.user_id || order.customer?.id || null,
                    nome: order.customer?.nome || '',
                    email: order.customer?.email || '',
                    telefone: order.customer?.telefone || '',
                    cpf: order.customer?.cpf || order.customer?.endereco?.cpf || '',
                    endereco: { ...(order.customer?.endereco || {}) }
                  })
                  setCustomerEdit(true)
                }} style={{ color: '#2563eb', fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}>
                  <i className="fa-solid fa-pencil"></i>
                </button>
              )}
            </h4>
            {customerEdit ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ marginBottom: '0.5rem', borderBottom: '1px solid var(--admin-border)', paddingBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.78rem', fontWeight: 600 }}>Buscar outro cliente rapidamente:</label>
                  <input type="text" placeholder="Digite nome, telefone, cidade ou CPF..." value={userSearch} onChange={e => setUserSearch(e.target.value)} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                  {filteredUsers.length > 0 && (
                    <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: '6px', marginTop: '0.2rem', background: 'var(--admin-bg)' }}>
                      <div style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', color: 'var(--admin-text-sec)', borderBottom: '1px solid var(--admin-border)', fontWeight: 600 }}>
                        {filteredUsers.length} cliente(s) encontrado(s):
                      </div>
                      {filteredUsers.map(u => (
                        <div key={u.id || u.telefone} style={{ cursor: 'pointer', padding: '0.4rem 0.6rem', borderBottom: '1px solid var(--admin-border)', fontSize: '0.8rem' }} onClick={() => {
                          setEditCustomer({
                            id: u.id,
                            nome: u.nome || '',
                            email: u.email || '',
                            telefone: u.telefone || '',
                            cpf: u.cpf || u.endereco?.cpf || '',
                            endereco: { ...(u.endereco || {}) }
                          })
                          setUserSearch('')
                        }}>
                          <strong>{u.nome}</strong> - {u.telefone} {u.endereco?.cidade ? `· ${u.endereco.cidade}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>Nome:</strong>
                  <input type="text" value={editCustomer.nome} onChange={e => setEditCustomer(p => ({ ...p, nome: e.target.value }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>Email:</strong>
                  <input type="email" value={editCustomer.email} onChange={e => setEditCustomer(p => ({ ...p, email: e.target.value }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>Telefone:</strong>
                  <input type="text" value={editCustomer.telefone} onChange={e => setEditCustomer(p => ({ ...p, telefone: e.target.value }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>CPF:</strong>
                  <input type="text" value={editCustomer.cpf} onChange={e => setEditCustomer(p => ({ ...p, cpf: e.target.value }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} placeholder="000.000.000-00" />
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>Rua:</strong>
                  <input type="text" value={editCustomer.endereco.rua || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, rua: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <div style={{ flex: 1 }}><strong style={{ fontSize: '0.78rem' }}>Número:</strong>
                    <input type="text" value={editCustomer.endereco.numero || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, numero: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                  </div>
                  <div style={{ flex: 1 }}><strong style={{ fontSize: '0.78rem' }}>Bairro:</strong>
                    <input type="text" value={editCustomer.endereco.bairro || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, bairro: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <div style={{ flex: 1 }}><strong style={{ fontSize: '0.78rem' }}>Cidade:</strong>
                    <input type="text" value={editCustomer.endereco.cidade || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, cidade: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                  </div>
                  <div style={{ width: '70px' }}><strong style={{ fontSize: '0.78rem' }}>UF:</strong>
                    <input type="text" value={editCustomer.endereco.estado || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, estado: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                  </div>
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>CEP:</strong>
                  <input type="text" value={editCustomer.endereco.cep || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, cep: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                </div>
                <div><strong style={{ fontSize: '0.78rem' }}>Complemento:</strong>
                  <input type="text" value={editCustomer.endereco.complemento || ''} onChange={e => setEditCustomer(p => ({ ...p, endereco: { ...p.endereco, complemento: e.target.value } }))} style={{ width: '100%', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', marginTop: '0.2rem' }} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.3rem' }}>
                  <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }} onClick={() => { setCustomerEdit(false); setEditCustomer({ nome: order.customer?.nome || '', email: order.customer?.email || '', telefone: order.customer?.telefone || '', endereco: { ...(order.customer?.endereco || {}) } }) }}>Cancelar</button>
                  <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} onClick={() => { onUpdateCustomer?.(order.id, editCustomer); setCustomerEdit(false) }}><i className="fa-solid fa-check"></i> Salvar Cliente</button>
                </div>
              </div>
            ) : (
              <>
                <p><strong>Nome:</strong> {order.customer?.nome || '-'}</p>
                <p><strong>Email:</strong> {order.customer?.email || '-'}</p>
                <p><strong>Telefone:</strong> {order.customer?.telefone || '-'}</p>
                {order.customer?.cpf && <p><strong>CPF:</strong> {order.customer.cpf}</p>}
                <p><strong>Endereço:</strong> {order.customer?.endereco ? [order.customer.endereco.rua, order.customer.endereco.numero, order.customer.endereco.bairro, order.customer.endereco.cidade, order.customer.endereco.estado].filter(Boolean).join(', ') || '-' : '-'}</p>
                {order.customer?.endereco?.cep && <p><strong>CEP:</strong> {order.customer.endereco.cep}</p>}
                {order.customer?.endereco?.complemento && <p><strong>Complemento:</strong> {order.customer.endereco.complemento}</p>}
              </>
            )}
          </div>

          <div className="detail-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <h4 style={{ margin: 0 }}>Itens ({getOrderRawItems(order).reduce((s, i) => s + (Number(i.qty) || 0), 0)} peças totais)</h4>
              <button className="admin-btn admin-btn-sec" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                onClick={() => { setEditMode(true); resetEditedItems() }}>
                <i className="fa-solid fa-pen"></i> Editar Preços / Custo / Qtd
              </button>
            </div>
            {getOrderRawItems(order).map((i, idx) => {
              const isRejected = rejectedItems.has(idx)
              const c = getItemCost(i, produtos)
              const p = Number(i.preco) || 0
              const q = Number(i.qty) || 0
              return (
                <div key={idx} className="detail-item" style={{ opacity: isRejected ? 0.5 : 1 }}>
                  <div style={{ flex: 1 }}>
                    <span className="detail-item-name" style={{ textDecoration: isRejected ? 'line-through' : 'none' }}>{i.displayName || i.nome}</span>
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.75rem', marginTop: '0.2rem', color: 'var(--admin-text-sec)' }}>
                      <span><strong>{q}x</strong> {formatPreco(p)} = <strong>{formatPreco(p * q)}</strong></span>
                      <span style={{ color: c > 0 ? '#059669' : '#f59e0b', fontWeight: 600 }}>
                        <i className="fa-solid fa-tag"></i> Custo un.: {formatPreco(c)} {c > 0 ? `(total ${formatPreco(c * q)})` : '(sem custo)'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className={`split-badge ${i.tipo === 'avista' ? 'vista' : 'aprazo'}`}>
                      {i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                    </span>
                    {order.status === 'pre-pedido' && (
                      <button className={`action-btn ${isRejected ? 'action-confirm' : 'action-delete'}`}
                        title={isRejected ? 'Re-adicionar item' : 'Recusar item'}
                        onClick={() => toggleReject(idx)}>
                        <i className={`fa-solid ${isRejected ? 'fa-undo' : 'fa-ban'}`}></i>
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {order.status === 'pre-pedido' && rejectedItems.size > 0 && (
            <div className="detail-section" style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.15)' }}>
              <h4 style={{ color: 'var(--danger)' }}><i className="fa-solid fa-ban"></i> Itens Recusados</h4>
              {[...rejectedItems].map(idx => (
                <p key={idx} style={{ fontSize: '0.82rem', color: 'var(--danger)', marginBottom: '0.2rem' }}>
                  {order.items[idx]?.nome || 'Item'} ({order.items[idx]?.qty || 1}x)
                </p>
              ))}
            </div>
          )}

          {order.status === 'pre-pedido' && (
            <div className="detail-section">
              <h4><i className="fa-solid fa-exchange-alt"></i> Adicionar Substitutos</h4>
              <div className="admin-search-prod" style={{ marginBottom: '0.5rem' }}>
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar produto para substituir..." value={preAddSearch} onChange={e => setPreAddSearch(e.target.value)} style={{ width: '100%' }} />
              </div>
              {filteredPreAddProds.length > 0 && (
                <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: '8px' }}>
                  {filteredPreAddProds.map(p => {
                    const inCart = preAddCart[p.id]
                    return (
                      <div key={p.id} className="add-prod-row" style={{ padding: '0.35rem 0.5rem' }}>
                        <div className="add-prod-info">
                          <span className="add-prod-name">{p.nome}</span>
                          <span className="add-prod-price">{formatPreco(p.preco)}</span>
                        </div>
                        {inCart ? (
                          <div className="add-prod-controls">
                            <span className="add-prod-qty">{inCart.qty}x</span>
                            <button className="qty-btn-sm" onClick={() => removeFromPreCart(p.id)}><i className="fa-solid fa-minus"></i></button>
                            <button className="qty-btn-sm" onClick={() => addToPreReplacement(p)}><i className="fa-solid fa-plus"></i></button>
                          </div>
                        ) : (
                          <button className="add-prod-add" style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem' }} onClick={() => addToPreReplacement(p)}>
                            <i className="fa-solid fa-plus"></i> Substituto
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {Object.values(preAddCart).filter(i => i.qty > 0).length > 0 && (
                <button className="admin-btn" style={{ marginTop: '0.4rem', fontSize: '0.78rem', background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6' }} onClick={confirmPreReplacements}>
                  <i className="fa-solid fa-check"></i> Adicionar {Object.values(preAddCart).reduce((s, i) => s + (Number(i.qty) || 0), 0)} substituto(s) ao pedido
                </button>
              )}
              {preReplacements.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--success)', marginBottom: '0.25rem' }}>Produtos substitutos adicionados:</p>
                  {preReplacements.map((r, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--admin-text)', marginBottom: '0.25rem', padding: '0.25rem 0.5rem', background: 'var(--admin-bg)', borderRadius: '6px', border: '1px solid var(--admin-border)' }}>
                      <span>{r.nome} ({r.qty}x) — {formatPreco(Number(r.preco || 0) * Number(r.qty || 0))}</span>
                      <button className="action-btn action-delete" title="Remover substituto" onClick={() => setPreReplacements(prev => prev.filter((_, idx) => idx !== i))} style={{ padding: '2px 6px', fontSize: '0.75rem' }}>
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {!preAddSearch && preReplacements.length === 0 && <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>Digite o nome de um produto para adicionar como substituto aos itens recusados</p>}
            </div>
          )}

          <div className="detail-section">
            <h4>Resumo</h4>
            <div className="detail-summary">
              {order.status === 'pre-pedido' && (() => {
                const rejectedSet = rejectedItems
                const kept = getOrderRawItems(order).filter((_, i) => !rejectedSet.has(i))
                const all = [...kept, ...preReplacements]
                const av = Math.round(all.filter(i => i.tipo === 'avista').reduce((s, i) => s + (Number(String(i.preco).replace(',', '.')) || 0) * (Number(i.qty) || 0), 0) * 100) / 100
                const ap = Math.round(all.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + (Number(String(i.preco).replace(',', '.')) || 0) * (Number(i.qty) || 0), 0) * 100) / 100
                const totalCalculado = Math.round((av + ap) * 100) / 100
                return (
                  <>
                    <span style={{ fontWeight: 600, color: 'var(--accent)' }}>📦 Peças totais: <strong>{all.reduce((s, i) => s + (Number(i.qty) || 0), 0)} peças</strong> ({all.length} produtos)</span>
                    <span style={{ color: 'var(--danger)' }}>Itens recusados: {rejectedItems.size}</span>
                    <span>Substitutos: {preReplacements.length} itens</span>
                    <span>Total <strong style={{ color: 'var(--accent)' }}>{formatPreco(totalCalculado)}</strong></span>
                    {ap > 0 && <span>📋 A prazo: <strong style={{ color: 'var(--warning)' }}>{formatPreco(ap)}</strong></span>}
                  </>
                )
              })()}
              {order.status !== 'pre-pedido' && (
                <span>Total: <strong>{formatPreco(order.total)}</strong> ({getOrderRawItems(order).reduce((s, i) => s + (Number(i.qty) || 0), 0)} peças)</span>
              )}
              <span>Pagamento: {order.pagamento === 'avista' ? 'À Vista' : order.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</span>
              {order.status === 'entregue' && order.payment && (() => {
                const pm = formatPagamento(order.payment.method)
                const falta = (order.total || 0) - (Number(order.payment.paid) || 0)
                return (
                  <span style={{ fontSize: '0.78rem' }}>
                    ✅ Recebido via {pm ? pm.label : order.payment.method}: <strong style={{ color: 'var(--success)' }}>{formatPreco(order.payment.paid)}</strong>
                    {falta > 0 ? <em style={{ color: '#dc2626', marginLeft: '0.4rem' }}>Falta {formatPreco(falta)}</em> : <em style={{ color: 'var(--success)', marginLeft: '0.4rem' }}>Pago integralmente</em>}
                  </span>
                )
              })()}
              <span>Status: <span className={`status-tag status-${order.status}`}>{order.status}</span></span>
            </div>
          </div>

          {financial.length > 0 && (
            <div className="detail-section">
              <h4>Contas a Prazo</h4>
              {financial.map(f => (
                <div key={f.id} className="detail-item">
                  <div>
                    <span className="detail-item-name">{f.itemName}</span>
                    <span className="detail-item-qty">{formatPreco(f.value)} - Vence {formatDate(f.dueDate)}</span>
                  </div>
                  <span className={`status-tag ${f.status === 'pago' ? 'status-pago' : f.status === 'cancelado' ? 'status-cancelado' : 'status-pendente'}`}>
                    {f.status === 'pago' ? 'Pago' : f.status === 'cancelado' ? 'Cancelado' : 'Pendente'}
                  </span>
                </div>
              ))}
            </div>
          )}
          {order.returnedItems?.length > 0 && (
            <div className="detail-section">
              <h4 style={{ color: 'var(--danger)' }}><i className="fa-solid fa-rotate-left"></i> Itens Devolvidos</h4>
              {order.returnedItems.map((i, idx) => (
                <div key={idx} className="detail-item">
                  <span className="detail-item-name">{i.nome}</span>
                  <span className="detail-item-qty">{i.returnedQty}x devolvido</span>
                </div>
              ))}
            </div>
          )}

          {(order.identityPhoto || order.addressProof) && (
            <div className="detail-section">
              <h4><i className="fa-solid fa-file"></i> Documentos</h4>
              {order.identityPhoto && (
                <div style={{ marginBottom: '0.5rem' }}>
                  <p style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.25rem' }}>Identidade</p>
                  <img src={order.identityPhoto} alt="Identidade" style={{ maxWidth: '200px', borderRadius: '6px', border: '1px solid var(--admin-border)', cursor: 'pointer' }} onClick={() => window.open(order.identityPhoto, '_blank')} />
                </div>
              )}
              {order.addressProof && (
                <div>
                  <p style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.25rem' }}>Comprovante de Endereço</p>
                  <img src={order.addressProof} alt="Comprovante" style={{ maxWidth: '200px', borderRadius: '6px', border: '1px solid var(--admin-border)', cursor: 'pointer' }} onClick={() => window.open(order.addressProof, '_blank')} />
                </div>
              )}
            </div>
          )}

          {order.status !== 'cancelado' && (() => {
            const link = buildOrderLink(order.id)
            return (
              <div className="detail-section" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '0.5rem 0.75rem' }}>
                <h4 style={{ fontSize: '0.78rem', color: '#166534' }}><i className="fa-solid fa-link"></i> Link do Pedido</h4>
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <input type="text" readOnly value={link}
                    style={{ flex: 1, fontSize: '0.72rem', padding: '0.25rem 0.4rem', borderRadius: '4px', border: '1px solid #bbf7d0', background: 'white', color: '#166534' }}
                    onClick={e => e.target.select()} />
                  <button className="admin-btn" style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem', background: '#166534', color: 'white', borderColor: '#166534' }}
                    onClick={() => { navigator.clipboard?.writeText(link); alert('Link copiado para a área de transferência!') }}>
                    <i className="fa-solid fa-copy"></i>
                  </button>
                </div>
                <p style={{ fontSize: '0.7rem', color: '#166534', marginTop: '0.25rem' }}>
                  <i className="fa-solid fa-info-circle"></i> Envie este link para o cliente acompanhar e confirmar a entrega
                </p>
              </div>
            )
          })()}

          {order.status !== 'entregue' && order.status !== 'cancelado' && (
            <div className="detail-section">
              <label style={{ fontSize: '0.78rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                <i className="fa-solid fa-calendar-day"></i> Data de vencimento das contas a prazo
              </label>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="date" value={preVencimento} onChange={e => setPreVencimento(e.target.value)}
                  style={{ flex: 1, minWidth: '120px', padding: '0.4rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', background: 'var(--admin-bg)', color: 'var(--admin-text)' }} />
                <button className="admin-btn" style={{ fontSize: '0.74rem', padding: '0.35rem 0.7rem', whiteSpace: 'nowrap' }}
                  onClick={() => onUpdateDue?.(preVencimento)}>
                  <i className="fa-solid fa-check"></i> Salvar vencimento
                </button>
              </div>
            </div>
          )}

          <div className="detail-section" style={{ background: 'var(--admin-card)', borderRadius: '8px', padding: '0.5rem 0.75rem', border: '1px solid var(--admin-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>
                <i className="fa-solid fa-shuffle"></i> Mudar Etapa Diretamente:
              </span>
              <select
                value={order.status}
                onChange={e => {
                  const newStatus = e.target.value
                  if (newStatus !== order.status) {
                    onStatusChange(newStatus)
                  }
                }}
                style={{ padding: '0.3rem 0.6rem', borderRadius: '6px', border: '1px solid var(--admin-border)', background: 'var(--admin-bg)', color: 'var(--admin-text)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
              >
                <option value="pre-pedido">Pré-Pedido</option>
                <option value="pendente">Pendente</option>
                <option value="confirmado">Confirmado</option>
                <option value="em-andamento">Em Andamento</option>
                <option value="em-rota">Em Rota</option>
                <option value="entregue">Entregue</option>
                <option value="acerto">Acerto</option>
                <option value="concluido">Concluído</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
          </div>

          <div className="modal-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', justifyContent: 'flex-end' }}>
            <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }}
              onClick={() => { setEditMode(true); resetEditedItems() }}>
              <i className="fa-solid fa-pen"></i> Editar Itens / Custo
            </button>
            {order.status === 'entregue' && (
              <>
                <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} onClick={() => onStatusChange('em-rota')}>
                  <i className="fa-solid fa-undo"></i> Voltar para Em Rota
                </button>
                <button className="admin-btn" style={{ background: '#6366f1', color: 'white', borderColor: '#6366f1' }} onClick={() => onStatusChange('acerto')}>
                  <i className="fa-solid fa-handshake"></i> Avançar para Acerto
                </button>
              </>
            )}
            {order.status === 'acerto' && (
              <>
                <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} onClick={() => onStatusChange('entregue')}>
                  <i className="fa-solid fa-undo"></i> Voltar para Entregues
                </button>
                <button className="admin-btn" style={{ background: '#6366f1', color: 'white', borderColor: '#6366f1' }} onClick={() => handleOpenDelivery('acerto')}>
                  <i className="fa-solid fa-handshake"></i> Editar Acerto
                </button>
                <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} onClick={() => handleOpenDelivery('finalizar')}>
                  <i className="fa-solid fa-check-double"></i> Finalizar Pedido
                </button>
              </>
            )}
            {order.status === 'concluido' && (
              <>
                <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} onClick={() => { if (confirm('Reabrir comanda e retornar para Acertos?')) onStatusChange('acerto') }}>
                  <i className="fa-solid fa-rotate-left"></i> Reabrir Comanda (Voltar para Acertos)
                </button>
                <button className="admin-btn" style={{ background: '#6366f1', color: 'white', borderColor: '#6366f1' }} onClick={() => handleOpenDelivery('finalizar')}>
                  <i className="fa-solid fa-eye"></i> Ver Acerto / Devoluções
                </button>
              </>
            )}
            {order.status === 'pre-pedido' && (
              <button className="admin-btn" style={{ background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6' }}
                onClick={() => onPreApprovar([...rejectedItems], preReplacements, preVencimento)}>
                <i className="fa-solid fa-clipboard-check"></i> OK
              </button>
            )}
            {order.status === 'pendente' && (
              <button className="admin-btn admin-btn-primary" onClick={() => { onUpdateDue?.(preVencimento); onStatusChange('em-rota') }}>
                <i className="fa-solid fa-truck"></i> Em Rota
              </button>
            )}
            {order.status === 'em-rota' && (
              <button
                type="button"
                className="admin-btn"
                style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }}
                onClick={() => onStatusChange('entregue')}
              >
                <i className="fa-solid fa-check-double"></i> Concluir Entrega
              </button>
            )}
            {(order.customer?.telefone || order.telefone) && (
              <button
                type="button"
                className="admin-btn"
                style={{ background: '#10b981', color: 'white', borderColor: '#059669' }}
                onClick={() => {
                  const raw = (order.customer?.telefone || order.telefone || '').replace(/\D/g, '')
                  const clean = raw.startsWith('55') ? raw.slice(2) : raw
                  if (clean) {
                    const msg = buildStatusWhatsApp(order, order.status)
                    window.open(`https://wa.me/55${clean}?text=${encodeURIComponent(msg)}`, '_blank')
                  }
                }}
              >
                <i className="fa-brands fa-whatsapp"></i> WhatsApp
              </button>
            )}
            {order.status !== 'entregue' && order.status !== 'acerto' && order.status !== 'concluido' && order.status !== 'cancelado' && (
              <button
                type="button"
                className="admin-btn"
                style={{ background: 'var(--danger)', color: 'white', borderColor: 'var(--danger)' }}
                onClick={() => { if (confirm('Tem certeza que deseja cancelar esta comanda?')) { onCancelOrder?.(order.id) } }}
              >
                <i className="fa-solid fa-ban"></i> Cancelar Comanda
              </button>
            )}
            <button type="button" className="admin-btn admin-btn-sec" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================
// MODAL: MONTAR KIT
// =============================================
function KitModal({ produtos, kit, onSave, onClose }) {
  const [nome, setNome] = useState(kit?.nome || '')
  const [descricao, setDescricao] = useState(kit?.descricao || '')
  const [prazoTexto, setPrazoTexto] = useState(kit?.prazoTexto || '')
  const [observacoes, setObservacoes] = useState(kit?.observacoes || '')
  const [selectedIds, setSelectedIds] = useState(new Set(kit?.produtoIds || []))
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    return search?.trim() ? (produtos || []).filter(p => p && (searchMatches(p.nome, search) || searchMatches(p.displayName, search) || searchMatches(p.categoria, search))) : (produtos || [])
  }, [produtos, search])

  const toggle = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal kit-modal" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h3><i className="fa-solid fa-toolbox"></i> {kit ? 'Editar Kit' : 'Montar Novo Kit'}</h3>
          <button className="admin-modal-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>
        <div className="kit-modal-body">
          <div className="kit-modal-fields">
            <div className="form-group">
              <label>Nome do Kit <span className="required-star">*</span></label>
              <input type="text" placeholder="Ex: Kit Dia das Mães" value={nome} onChange={e => setNome(e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label>Descrição</label>
              <textarea rows="2" placeholder="Uma descrição curta e atraente para o kit..." value={descricao} onChange={e => setDescricao(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Texto de Prazo / Pagamento</label>
              <textarea rows="3" placeholder="Explique as condições de pagamento (prazo, parcelamento, etc.)" value={prazoTexto} onChange={e => setPrazoTexto(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Observações (opcional)</label>
              <textarea rows="2" placeholder="Informações extras sobre o kit..." value={observacoes} onChange={e => setObservacoes(e.target.value)} />
            </div>
          </div>

          <div className="kit-modal-produtos">
            <div className="kit-modal-produtos-header">
              <label>Produtos no Kit <span className="selected-count">{selectedIds.size} selecionado{selectedIds.size !== 1 ? 's' : ''}</span></label>
              <div className="admin-search-prod">
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="kit-produtos-lista">
              {filtered.map(p => (
                <label key={p.id} className={`kit-prod-item ${selectedIds.has(p.id) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="kit-prod-nome">{p.nome}</span>
                  <span className="kit-prod-cat">{p.categoria}</span>
                  <span className="kit-prod-preco">R$ {p.preco.toFixed(2).replace('.', ',')}</span>
                </label>
              ))}
              {filtered.length === 0 && <div className="kit-prod-empty">Nenhum produto encontrado</div>}
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="admin-btn admin-btn-sec" onClick={onClose}>Cancelar</button>
          <button className="admin-btn admin-btn-primary" disabled={!nome.trim() || selectedIds.size === 0}
            onClick={() => onSave({
              ...kit,
              nome: nome.trim(),
              descricao: descricao.trim(),
              prazoTexto: prazoTexto.trim(),
              observacoes: observacoes.trim(),
              produtoIds: [...selectedIds]
            })}>
            <i className="fa-solid fa-check"></i> {kit ? 'Atualizar Kit' : 'Criar Kit'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================
// MODAL: EDIT PRODUCT
// =============================================
function EditProductModal({ product, categorias = [], onAddCategoria, onSave, onClose }) {
  const [nome, setNome] = useState(product.nome)
  const formatInitialDecimal = (v) => {
    if (v == null || v === '') return ''
    if (product._new && (v === 0 || v === '0')) return ''
    return String(v).replace('.', ',')
  }
  const [preco, setPreco] = useState(() => formatInitialDecimal(product.preco))
  const [precoCusto, setPrecoCusto] = useState(() => formatInitialDecimal(product.preco_custo))
  const [estoque, setEstoque] = useState(String(product.estoque))
  const [imagem, setImagem] = useState(product.imagem || '')
  const [categoria, setCategoria] = useState(product.categoria)
  const [descricao, setDescricao] = useState(product.descricao || '')
  const [variantes, setVariantes] = useState(() => {
    return product.variantes && typeof product.variantes === 'object' ? product.variantes : {}
  })
  const [semDevolucao, setSemDevolucao] = useState(!!product.semDevolucao)
  const [newVarTypeName, setNewVarTypeName] = useState('')

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = async () => {
      if (typeof reader.result === 'string') {
        const compressed = await compressImageDataUrl(reader.result, 1000, 0.75)
        setImagem(compressed)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const addVariantType = () => {
    const name = newVarTypeName.trim()
    if (!name) return
    setVariantes(prev => ({ ...prev, [name]: [''] }))
    setNewVarTypeName('')
  }

  const removeVariantType = (key) => {
    if (!confirm(`Remover variação "${key}"?`)) return
    setVariantes(prev => {
      const { [key]: _, ...rest } = prev
      return rest
    })
  }

  const renameVariantType = (oldKey, newKey) => {
    const trimmed = newKey.trim()
    if (!trimmed || trimmed === oldKey) return
    if (variantes[trimmed]) return
    setVariantes(prev => {
      const { [oldKey]: val, ...rest } = prev
      return { ...rest, [trimmed]: val }
    })
  }

  const addVariantOption = (type) => {
    setVariantes(prev => ({
      ...prev,
      [type]: [...(prev[type] || []), '']
    }))
  }

  const updateVariantOption = (type, idx, value) => {
    setVariantes(prev => ({
      ...prev,
      [type]: (prev[type] || []).map((v, i) => i === idx ? value : v)
    }))
  }

  const removeVariantOption = (type, idx) => {
    setVariantes(prev => ({
      ...prev,
      [type]: (prev[type] || []).filter((_, i) => i !== idx)
    }))
  }

  const handleSave = () => {
    const numPreco = parseDecimalToNumber(preco)
    if (!nome.trim() || preco === '' || isNaN(numPreco) || numPreco < 0) {
      alert('Por favor, informe um preço válido para o produto.')
      return
    }
    const cleaned = {}
    Object.entries(variantes).forEach(([k, v]) => {
      const opts = v.filter(o => o.trim())
      if (opts.length > 0) cleaned[k] = opts
    })
    const numCusto = precoCusto === '' ? null : parseDecimalToNumber(precoCusto)
    onSave({
      nome: nome.trim(),
      preco: numPreco,
      preco_custo: numCusto,
      estoque: Number(estoque) || 0,
      imagem,
      categoria,
      descricao,
      variantes: cleaned,
      semDevolucao
    })
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
        <div className="admin-modal-header">
          <h3><i className="fa-solid fa-pen"></i> {product._new ? 'Novo Produto' : 'Editar Produto'}</h3>
          <button className="admin-modal-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>
        <div className="admin-modal-body">
          <div className="form-group">
            <label>Nome do produto <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Camiseta Masculina" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Preço (R$) <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input type="text" inputMode="decimal" value={preco} onChange={e => setPreco(cleanDecimalInput(e.target.value))} placeholder="0,00" />
            </div>
            <div className="form-group">
              <label>Preço de Custo (R$)</label>
              <input type="text" inputMode="decimal" value={precoCusto} onChange={e => setPrecoCusto(cleanDecimalInput(e.target.value))} placeholder="0,00" />
            </div>
            <div className="form-group">
              <label>Estoque</label>
              <input type="number" step="1" value={estoque} onChange={e => setEstoque(e.target.value)} placeholder="0" />
            </div>
          </div>

          <div className="form-group">
            <label>Imagem do Produto</label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
              <label className="admin-btn" style={{ cursor: 'pointer', fontSize: '0.78rem', padding: '0.35rem 0.75rem', background: '#f0f0f0', border: '1px solid var(--admin-border)', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <i className="fa-solid fa-upload"></i> Upload
                <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
              </label>
              <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>ou URL:</span>
            </div>
            <input type="text" value={imagem} onChange={e => setImagem(e.target.value)} placeholder="https://...png" />
            {imagem && (
              <div style={{ position: 'relative', display: 'inline-block', marginTop: '0.4rem' }}>
                <img src={imagem} alt="" className="edit-preview" onError={e => e.target.style.display = 'none'} />
                <button className="action-btn action-delete" style={{ position: 'absolute', top: '-6px', right: '-6px', width: '20px', height: '20px', borderRadius: '50%', fontSize: '0.65rem', display: imagem ? 'flex' : 'none' }} onClick={() => setImagem('')}>
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Categoria</label>
            <select
              value={categoria}
              onChange={e => {
                if (e.target.value === '__nova__') {
                  const nome = prompt('Nome da nova categoria:')
                  if (nome && nome.trim()) {
                    const n = nome.trim()
                    setCategoria(n)
                    if (onAddCategoria) onAddCategoria(n)
                  }
                  return
                }
                setCategoria(e.target.value)
              }}
            >
              {categoria && !categorias.includes(categoria) && <option value={categoria}>{categoria}</option>}
              {categorias.map(c => <option key={c} value={c}>{c}</option>)}
              <option value="__nova__">＋ Nova categoria...</option>
            </select>
          </div>
          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', background: semDevolucao ? '#fef2f2' : '#f0fdf4', border: `1px solid ${semDevolucao ? '#fecaca' : '#bbf7d0'}`, borderRadius: '8px', padding: '0.6rem 0.75rem' }}>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: semDevolucao ? '#b91c1c' : '#15803d' }}>
                  {semDevolucao ? 'Sem devolução' : 'Com devolução'}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--admin-text-sec)', marginTop: '0.1rem' }}>
                  {semDevolucao ? 'Cliente confirma que não há troca/devolução no checkout' : 'Produto aceita troca/devolução'}
                </div>
              </div>
              <label className="stock-toggle" style={{ margin: 0 }}>
                <input type="checkbox" checked={semDevolucao} onChange={e => setSemDevolucao(e.target.checked)} />
                <span className="toggle-track"></span>
              </label>
            </div>
          </div>
          <div className="form-group">
            <label>Descrição</label>
            <textarea rows="3" value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descrição detalhada do produto..." style={{ width: '100%', padding: '0.5rem 0.65rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit' }} />
          </div>

          <div className="form-group" style={{ borderTop: '1px solid var(--admin-border)', paddingTop: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.65rem' }}>
              <label style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>
                <i className="fa-solid fa-tags" style={{ color: '#8b5cf6' }}></i> Variações do Produto
              </label>
            </div>

            {Object.keys(variantes).length > 0 && (
              <div style={{ marginBottom: '0.75rem' }}>
                {Object.entries(variantes).map(([type, options]) => (
                  <div key={type} style={{ marginBottom: '0.65rem', padding: '0.65rem 0.75rem', background: '#f9fafb', borderRadius: '10px', border: '1px solid var(--admin-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                      <input
                        type="text"
                        value={type}
                        onChange={e => {
                          const { [type]: val, ...rest } = variantes
                          const key = e.target.value.trim()
                          if (key) {
                            setVariantes({ ...rest, [key]: val })
                          } else {
                            setVariantes({ ...rest, [type]: val })
                          }
                        }}
                        style={{ fontWeight: 700, fontSize: '0.85rem', textTransform: 'uppercase', color: '#8b5cf6', border: '1px solid transparent', borderRadius: '4px', padding: '0.15rem 0.3rem', background: 'transparent', width: '140px' }}
                        onFocus={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.background = 'white' }}
                        onBlur={e => { e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent' }}
                      />
                      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--admin-text-sec)', background: '#e5e7eb', borderRadius: '10px', padding: '0.1rem 0.45rem' }}>{options.filter(o => o.trim()).length} opções</span>
                        <button className="action-btn" style={{ color: '#059669', width: '24px', height: '24px' }} title="Adicionar opção" onClick={() => addVariantOption(type)}>
                          <i className="fa-solid fa-plus"></i>
                        </button>
                        <button className="action-btn action-delete" style={{ width: '24px', height: '24px' }} title="Remover variação" onClick={() => removeVariantType(type)}>
                          <i className="fa-solid fa-trash-can"></i>
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {options.map((opt, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.15rem', background: 'white', borderRadius: '8px', border: '1px solid var(--admin-border)', padding: '0.15rem 0.3rem 0.15rem 0.55rem' }}>
                          <input
                            type="text"
                            value={opt}
                            onChange={e => updateVariantOption(type, idx, e.target.value)}
                            placeholder={`Opção ${idx + 1}`}
                            style={{ width: '80px', padding: '0.25rem 0', border: 'none', fontSize: '0.82rem', background: 'transparent', outline: 'none' }}
                          />
                          {options.length > 1 && (
                            <button className="action-btn action-delete" style={{ padding: '0.1rem', width: '18px', height: '18px' }} title="Remover" onClick={() => removeVariantOption(type, idx)}>
                              <i className="fa-solid fa-xmark"></i>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              <input
                type="text"
                value={newVarTypeName}
                onChange={e => setNewVarTypeName(e.target.value)}
                placeholder="Ex: Cor, Tamanho, Aroma..."
                style={{ flex: 1, padding: '0.4rem 0.65rem', borderRadius: '8px', border: '1px solid var(--admin-border)', fontSize: '0.82rem' }}
                onKeyDown={e => { if (e.key === 'Enter') addVariantType() }}
              />
              <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.35rem 0.7rem', background: '#8b5cf6', color: 'white', borderColor: '#8b5cf6', whiteSpace: 'nowrap' }} onClick={addVariantType} disabled={!newVarTypeName.trim()}>
                <i className="fa-solid fa-plus"></i> Adicionar
              </button>
            </div>
            {Object.keys(variantes).length === 0 && (
              <p style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', marginTop: '0.35rem' }}>
                Digite o nome da variação acima (Cor, Tamanho, etc.) e clique em "Adicionar".
              </p>
            )}
          </div>

          <div className="modal-actions">
            <button className="admin-btn admin-btn-sec" onClick={onClose}>Cancelar</button>
            <button className="admin-btn admin-btn-primary" disabled={!nome.trim() || preco === '' || isNaN(Number(preco))} onClick={handleSave}>
              <i className="fa-solid fa-check"></i> Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================
// FINANCE CALENDAR VIEW
// =============================================
function FinCalendar({ financial }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  const [selectedDay, setSelectedDay] = useState(null)
  const todayStr = hoje()
  const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const mStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
  const firstDow = month.getDay()
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const monthLabel = month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  const billsFor = (day) => day ? financial.filter(f => f.dueDate === `${mStr}-${String(day).padStart(2, '0')}`) : []
  const selectedBills = selectedDay ? financial.filter(f => f.dueDate === selectedDay) : []
  const nav = (delta) => setMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1))
  const goToday = () => setMonth(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1) })
  return (
    <div className="fin-calendar">
      <div className="fin-cal-header">
        <button className="admin-btn" onClick={() => nav(-1)}><i className="fa-solid fa-chevron-left"></i></button>
        <strong>{monthLabel}</strong>
        <button className="admin-btn" onClick={() => nav(1)}><i className="fa-solid fa-chevron-right"></i></button>
        <button className="admin-btn admin-btn-sec cal-today-btn" onClick={goToday}>Hoje</button>
      </div>
      <div className="fin-cal-grid">
        {weekdays.map(w => <div key={w} className="cal-weekday">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={'x' + i} className="cal-day cal-day-empty" />
          const dayStr = `${mStr}-${String(d).padStart(2, '0')}`
          const bills = billsFor(d)
          const pend = bills.filter(b => b.status === 'pendente')
          const pago = bills.filter(b => b.status === 'pago')
          const overdue = pend.length > 0 && dayStr < todayStr
          const hasPend = pend.length > 0
          const isToday = dayStr === todayStr
          const isSelected = selectedDay === dayStr
          return (
            <div
              key={dayStr}
              className={`cal-day ${isToday ? 'cal-today' : ''} ${overdue ? 'cal-overdue' : ''} ${hasPend && !overdue ? 'cal-has-pend' : ''} ${isSelected ? 'cal-selected' : ''}`}
              onClick={() => setSelectedDay(isSelected ? null : dayStr)}
            >
              <span className="cal-day-num">{d}</span>
              {bills.length > 0 && (
                <div className="cal-day-info">
                  {pend.length > 0 && <span className="cal-badge cal-badge-pend">{pend.length} devendo</span>}
                  {pago.length > 0 && <span className="cal-badge cal-badge-paid">{pago.length} pago</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="fin-cal-legend">
        <span><i className="legend-dot dot-overdue" /> Em atraso</span>
        <span><i className="legend-dot dot-pend" /> Pendente</span>
        <span><i className="legend-dot dot-paid" /> Pago</span>
      </div>
      <div className="cal-details">
        <h4>{selectedDay ? formatDate(selectedDay) : 'Selecione um dia para ver as contas'}</h4>
        {selectedDay && selectedBills.length === 0 && <p className="cal-no-bills">Nenhuma conta vence neste dia.</p>}
        {selectedDay && selectedBills.map(f => {
          const overdue = f.status === 'pendente' && f.dueDate < todayStr
          return (
            <div key={f.id} className="cal-detail-item">
              <div className="cal-detail-info">
                <strong>{f.customerName}</strong>
                <span>{f.itemName} ({f.qty}x)</span>
              </div>
              <span className="cal-detail-value">{formatPreco(f.value)}</span>
              <span className={`status-tag ${f.status === 'pago' ? 'status-pago' : f.status === 'cancelado' ? 'status-cancelado' : overdue ? 'status-atrasado' : 'status-pendente'}`}>
                {f.status === 'pago' ? 'Pago' : f.status === 'cancelado' ? 'Cancelado' : overdue ? 'Atrasado' : 'Pendente'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// =============================================
// MODAL: DESPESA (expense)
// =============================================
function DespesaModal({ despesa, customTipos = [], onAddTipo, onSave, onClose }) {
  const [tipo, setTipo] = useState(despesa?.tipo || 'Alimentação')
  const [descricao, setDescricao] = useState(despesa?.descricao || '')
  const [value, setValue] = useState(despesa ? String(despesa.value).replace('.', ',') : '')
  const [dueDate, setDueDate] = useState(despesa?.dueDate || hoje())
  const [paymentMethod, setPaymentMethod] = useState(despesa?.paymentMethod || 'pix')
  const [status, setStatus] = useState(despesa?.status || 'pendente')

  const tiposDisponiveis = useMemo(() => {
    const merged = [...new Set([...DESPESA_TIPOS, ...customTipos])]
    if (tipo && !merged.includes(tipo)) merged.push(tipo)
    return merged
  }, [customTipos, tipo])

  const handleSave = () => {
    const val = parseDecimalToNumber(value)
    if (!tipo.trim() || isNaN(val) || val <= 0) return
    onSave({ tipo: tipo.trim(), descricao: descricao.trim(), value: val, dueDate, paymentMethod, status })
  }

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
        <div className="admin-modal-header">
          <h3><i className="fa-solid fa-receipt"></i> {despesa ? 'Editar Despesa' : 'Nova Despesa'}</h3>
          <button className="admin-modal-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>
        <div className="admin-modal-body">
          <div className="form-group">
            <label>Tipo de despesa</label>
            <select value={tipo} onChange={e => {
              if (e.target.value === '__nova__') {
                const nome = prompt('Nome do novo tipo de despesa:')
                if (nome && nome.trim()) {
                  const n = nome.trim()
                  setTipo(n)
                  if (onAddTipo) onAddTipo(n)
                }
                return
              }
              setTipo(e.target.value)
            }}>
              {tiposDisponiveis.map(t => <option key={t} value={t}>{t}</option>)}
              <option value="__nova__">＋ Novo tipo...</option>
            </select>
          </div>
          <div className="form-group">
            <label>Descrição</label>
            <input type="text" value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Ex: Abastecimento do caminhão, compra de embalagens..." />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Valor (R$) <span style={{ color: 'var(--danger)' }}>*</span></label>
              <input type="text" inputMode="decimal" value={value} onChange={e => setValue(cleanDecimalInput(e.target.value))} placeholder="0,00" />
            </div>
            <div className="form-group">
              <label>Vencimento</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label>Forma de pagamento</label>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {PAG_SINGLE.map(m => (
                <button key={m} type="button" className={`pag-chip ${paymentMethod === m ? 'active' : ''}`} onClick={() => setPaymentMethod(m)}>
                  <i className={`fa-solid ${PAG_METHODS[m].icon}`}></i> {PAG_METHODS[m].label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>Status</label>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {[['pendente', 'Pendente'], ['pago', 'Pago']].map(([v, l]) => (
                <button key={v} type="button" className={`pag-chip ${status === v ? 'active' : ''}`} onClick={() => setStatus(v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="modal-actions">
            <button className="admin-btn admin-btn-sec" onClick={onClose}>Cancelar</button>
            <button className="admin-btn admin-btn-primary" disabled={!value || isNaN(Number(value)) || Number(value) <= 0 || !tipo.trim()} onClick={handleSave}>
              <i className="fa-solid fa-check"></i> Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
