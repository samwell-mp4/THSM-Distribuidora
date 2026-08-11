import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import './Admin.css'
import { supabase, syncAllForAdmin, getAllUsers, upsertOrders, upsertFinancial, upsertOrder, upsertUser,
  deleteOrder as supabaseDeleteOrder, deleteUserByTelefone, syncContatosToUsuarios, getAllLeads,
  upsertProducts, upsertDespesas, generateLoginToken, getAllRotaEdits, upsertRotaEdits, deleteRotaEdit as supabaseDeleteRotaEdit,
  deleteProducts as supabaseDeleteProducts } from '../lib/supabase'

const STORAGE_PRODUCTS = 'thsm_admin_produtos'
const STORAGE_ORDERS = 'thsm_admin_orders'
const STORAGE_FINANCIAL = 'thsm_admin_financeiro'
const STORAGE_DESPESAS = 'thsm_admin_despesas'
const STORAGE_CUSTOM_ROTAS = 'thsm_custom_rotas'
const STORAGE_CUSTOM_CATS = 'thsm_custom_categorias'
const STORAGE_CUSTOM_TIPOS = 'thsm_custom_despesa_tipos'
const WEBHOOK_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/novo-pedido'
const LISTA_CONTATOS_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/lista-contatos'
const ALERTAR_ROTAS_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/alertar-rotas'
const WHATSAPP_FORCE_URL = 'https://plug-sales-dispatch-app-n8n-2.hx8235.easypanel.host/webhook/whatsapp-force'

const LS = {
  get(key, def) {
    try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : def } catch { return def }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)) } catch (e) { console.warn('LS.set quota/falha:', key, e) }
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
  'entregue': 'Concluído',
  'cancelado': 'Cancelado'
}

function hoje() {
  return new Date().toISOString().split('T')[0]
}

function formatDate(str) {
  if (!str) return '-'
  const d = new Date(str + (str.length <= 10 ? 'T12:00:00' : ''))
  return d.toLocaleDateString('pt-BR')
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
  const msgDatas = `📅 Data do pedido: ${dataPedido}
📅 Vencimento: ${dataVencimento}`
  const msgItems = order.items.map(i => `  • ${i.nome} (${i.qty}x) — R$ ${i.preco.toFixed(2)}`).join('\n')
  const msgPagamento = order.pagamento === 'avista' ? 'À Vista' : order.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'

  const templates = {
    'pre-pedido': `⏳ *PRÉ-PEDIDO EM ANÁLISE* ⏳
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
${msgDatas}
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
💰 Total: R$ ${order.total.toFixed(2)}
━━━━━━━━━━━━━━━━━━
${msgItems}
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
💰 Total: R$ ${order.total.toFixed(2)}
━━━━━━━━━━━━━━━━━━
📦 *ITENS:*
${msgItems}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido já foi separado. Só aguardar a entrega.
🔗 Acesse seu pedido: ${link}`,

    'entregue': extra.returnedItems?.length > 0
      ? `✅ *PEDIDO FINALIZADO* ✅
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
${msgDatas}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido foi finalizado!
📦 Itens entregues:
${order.items.map(i => `  • ${i.nome} (${i.qty}x) — R$ ${(i.preco * i.qty).toFixed(2)}`).join('\n')}
📦 Itens devolvidos:
${extra.returnedItems.map(i => `  • ${i.nome} (${i.returnedQty}x) — R$ ${(i.preco * (i.returnedQty || 0)).toFixed(2)}`).join('\n')}
💰 Total cobrado: R$ ${order.total.toFixed(2)}
━━━━━━━━━━━━━━━━━━
⚠️ *Importante:* Produtos embalados/lacrados não podem ser abertos. Não aceitamos devolução de produtos violados.
Você tem até 24 horas para nos informar se houver algum item faltando ou com avaria.
━━━━━━━━━━━━━━━━━━
📲 *Confirme o recebimento:* Clique no link abaixo para visualizar sua comanda e confirmar os itens recebidos:
${link}
━━━━━━━━━━━━━━━━━━
Obrigado pela preferência! 🎉`
      : `✅ *PEDIDO ENTREGUE* ✅
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
${msgDatas}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido foi entregue com sucesso! 🎉
${order.items.length > 0 ? `📦 Itens:\n${order.items.map(i => `  • ${i.nome} (${i.qty}x) — R$ ${(i.preco * i.qty).toFixed(2)}`).join('\n')}\n` : ''}
⚠️ *Importante:* Produtos embalados/lacrados não podem ser abertos. Não aceitamos devolução de produtos violados.
Você tem até 24 horas para nos informar se houver algum item faltando ou com avaria.
━━━━━━━━━━━━━━━━━━
📲 *Confirme o recebimento:* Clique no link abaixo para visualizar sua comanda e confirmar os itens recebidos:
${link}
━━━━━━━━━━━━━━━━━━
Obrigado pela preferência! 🎉`,

    'cancelado': `❌ *PEDIDO CANCELADO* ❌
━━━━━━━━━━━━━━━━━━
📋 Pedido: ${id}
👤 Cliente: ${nome}
${msgDatas}
━━━━━━━━━━━━━━━━━━
Olá ${nome}, seu pedido foi cancelado.
Em caso de dúvidas, entre em contato conosco.
━━━━━━━━━━━━━━━━━━`
  }

  return templates[newStatus] || `📋 *Atualização do Pedido ${id}* 📋\n━━━━━━━━━━━━━━━━━━\nStatus: ${newStatus}\n🔗 ${link}`
}

function sendStatusWebhook(order, newStatus, extra = {}) {
  const whatsappMessage = buildStatusWhatsApp(order, newStatus, extra)
  const returnedItems = extra.returnedItems || order.returnedItems || []
  const rawPhone = (order.customer?.telefone || '').replace(/\D/g, '')
  const telefone = rawPhone.startsWith('55') ? rawPhone : '55' + rawPhone
  const customer = { ...order.customer, telefone }
  fetch(WEBHOOK_STATUS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'atualizacao-pedido',
      whatsappMessage,
      order: {
        id: order.id,
        date: order.date,
        status: newStatus,
        pagamento: order.pagamento,
        total: order.total,
        totalAvista: order.totalAvista,
        totalAprazo: order.totalAprazo,
        customer,
        items: order.items.map(i => ({ nome: i.nome, qty: i.qty, preco: i.preco, tipo: i.tipo })),
        ...(returnedItems.length > 0 ? { returnedItems: returnedItems.map(i => ({ nome: i.nome, returnedQty: i.returnedQty || i.qty, preco: i.preco })) } : {})
      }
    })
  }).catch(() => {})
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
        whatsappMessage = `🚚 *PASSANDO NA SUA CIDADE!* 🚚\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n📋 Pedido #${lastOrder.id.toString().slice(-6)}\n📅 Data: ${formatDate(lastOrder.date || lastOrder.createdAt)}\n📅 Vencimento: ${formatDate(lastOrder.dataVencimento)}\n📌 Status: ${lastOrder.status}\n💵 Total: ${formatPreco(lastOrder.total)}\n${itens}${extras}\n━━━━━━━━━━━━━━━━━━\nEstamos na sua região! Seu pedido está em aberto.\n🔗 Acesse sua conta: ${loginLink}`
      } else {
        whatsappMessage = `🚚 *PASSANDO NA SUA CIDADE!* 🚚\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n━━━━━━━━━━━━━━━━━━\nEstamos passando na sua cidade! Aproveite para fazer seu pedido.\n🔗 Faça já seu pedido: ${loginLink}`
      }
    } else if (tipo === 'atualizacao') {
      if (lastOrder) {
        const itens = lastOrder.items?.slice(0, 3).map(i => `  • ${i.nome} (${i.qty}x) — ${formatPreco(i.preco * i.qty)}`).join('\n') || ''
        const extras = lastOrder.items?.length > 3 ? `\n  ...e mais ${lastOrder.items.length - 3} item(ns)` : ''
        const dataPedido = formatDate(lastOrder.date || lastOrder.createdAt)
        const dataVencimento = formatDate(lastOrder.dataVencimento)
        const finRecords = JSON.parse(localStorage.getItem('thsm_admin_financeiro') || '[]')
          .filter(f => f.orderId === lastOrder.id && f.status === 'pendente')
        const vencimentos = finRecords.slice(0, 2).map(f => `  📅 ${f.itemName}: ${formatDate(f.dueDate)} — ${formatPreco(f.value)}`).join('\n')
        const vencExtras = finRecords.length > 2 ? `\n  ...e mais ${finRecords.length - 2} parcela(s)` : ''
        whatsappMessage = `📋 *ATUALIZAÇÃO DO PEDIDO* 📋\n━━━━━━━━━━━━━━━━━━\n👤 ${nome}\n📋 Pedido: #${lastOrder.id.toString().slice(-6)}\n📅 Data: ${dataPedido}\n📅 Vencimento: ${dataVencimento}\n📌 Status: ${lastOrder.status}\n${itens}${extras}\n💵 Total: ${formatPreco(lastOrder.total)}${vencimentos ? `\n━━━━━━━━━━━━━━━━━━\n📆 *Pendências:*\n${vencimentos}${vencExtras}` : ''}\n━━━━━━━━━━━━━━━━━━\n🔗 Acompanhe seu pedido: ${loginLink}`
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
  }).catch(() => {})
}

import AddressForm from '../components/AddressForm'
import MapView from '../components/MapView'
import CentralAnalise from '../components/CentralAnalise'

export default function Admin({ produtos, onVoltar }) {
  const [tab, setTab] = useState(() => sessionStorage.getItem('thsm_admin_tab') || 'dashboard')
  useEffect(() => { sessionStorage.setItem('thsm_admin_tab', tab) }, [tab])
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [orders, setOrders] = useState(() => LS.get(STORAGE_ORDERS, []))
  const [prodChanges, setProdChanges] = useState(() => LS.get(STORAGE_PRODUCTS, {}))
  const [financial, setFinancial] = useState(() => LS.get(STORAGE_FINANCIAL, []))
  const [toast, setToast] = useState(null)
  const [orderFilter, setOrderFilter] = useState('todos')
  const [prodSearch, setProdSearch] = useState('')
  const [prodPage, setProdPage] = useState(1)
  const [editingProd, setEditingProd] = useState(null)
  const [prodViewMode, setProdViewMode] = useState('visual')
  const [prodCart, setProdCart] = useState({})
  const [prodCartOpen, setProdCartOpen] = useState(false)
  const [prodImageErrors, setProdImageErrors] = useState({})
  const [showAddOrder, setShowAddOrder] = useState(false)
  const [preselectedUserForOrder, setPreselectedUserForOrder] = useState(null)
  const [showOrderDetail, setShowOrderDetail] = useState(null)
  const [showRotaDue, setShowRotaDue] = useState(null)
  const [rotaDueDate, setRotaDueDate] = useState('')
  const [showDeliveryModal, setShowDeliveryModal] = useState(null)
  const [returnQuantities, setReturnQuantities] = useState({})
  const [payQuantities, setPayQuantities] = useState({})
  const [identityPreview, setIdentityPreview] = useState('')
  const [addressPreview, setAddressPreview] = useState('')
  const [finFilter, setFinFilter] = useState('todos')
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
  const [usuarios, setUsuarios] = useState(() => LS.get('thsm_usuarios', []))
  const [syncingUsers, setSyncingUsers] = useState(false)
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
  const [newProducts, setNewProducts] = useState(() => LS.get('thsm_admin_new_products', []))
  const [deletedProdIds, setDeletedProdIds] = useState(() => LS.get('thsm_admin_deleted_products', []))
  const PROD_PER_PAGE = 20

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

  const firstOrdersSync = useRef(true)
  const firstProdsSync = useRef(true)
  useEffect(() => {
    if (firstOrdersSync.current) { firstOrdersSync.current = false; return }
    if (orders.length === 0) return
    const t = setTimeout(() => { upsertOrders(orders) }, 900)
    return () => clearTimeout(t)
  }, [orders])
  useEffect(() => {
    if (firstProdsSync.current) { firstProdsSync.current = false; return }
    LS.set(STORAGE_PRODUCTS, prodChanges)
    if (Object.keys(prodChanges).length === 0) return
    const t = setTimeout(() => upsertProducts(prodChanges), 700)
    return () => clearTimeout(t)
  }, [prodChanges])
  useEffect(() => {
    if (newProducts.length > 0) {
      const obj = {}
      newProducts.forEach(p => {
        const { _new, ...clean } = p
        obj[p.id] = clean
      })
      upsertProducts(obj)
    }
  }, [newProducts])
  useEffect(() => { LS.set(STORAGE_CUSTOM_ROTAS, customRotas) }, [customRotas])
  useEffect(() => { LS.set(STORAGE_CUSTOM_CATS, customCategorias) }, [customCategorias])
  useEffect(() => { LS.set(STORAGE_CUSTOM_TIPOS, customDespesaTipos) }, [customDespesaTipos])
  useEffect(() => {
    const compact = orders.map(o => {
      if ((o.identityPhoto && o.identityPhoto.length > 5000) || (o.addressProof && o.addressProof.length > 5000)) {
        return o.identityPhoto?.startsWith('data:') || o.addressProof?.startsWith('data:')
          ? { ...o, identityPhoto: o.identityPhoto?.startsWith('data:') ? '' : o.identityPhoto, addressProof: o.addressProof?.startsWith('data:') ? '' : o.addressProof }
          : o
      }
      return o
    })
    LS.set(STORAGE_ORDERS, compact)
  }, [orders])
  useEffect(() => {
    LS.set(STORAGE_FINANCIAL, financial)
    if (financial.length === 0) return
    const t = setTimeout(() => {
      const doUpsert = () => upsertFinancial(financial)
      if (orders.length > 0) {
        upsertOrders(orders).then(doUpsert).catch(doUpsert)
      } else {
        doUpsert()
      }
    }, 1400)
    return () => clearTimeout(t)
  }, [financial, orders])
  useEffect(() => {
    LS.set(STORAGE_DESPESAS, despesas)
    if (despesas.length > 0) upsertDespesas(despesas)
  }, [despesas])

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
    setSyncingUsers(true)
    syncAllForAdmin().then(({ orders: o, financial: f, users: u, rotas: r, products: p, despesas: d, rotaEdits: re }) => {
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
          const map = new Map()
          o.forEach(ord => map.set(ord.id, ord))
          prev.forEach(ord => map.set(ord.id, ord))
          return Array.from(map.values())
        })
      }
      if (f.length) {
        setFinancial(prev => {
          const map = new Map()
          f.forEach(fin => map.set(fin.id, fin))
          prev.forEach(fin => map.set(fin.id, fin))
          const merged = Array.from(map.values())
          LS.set(STORAGE_FINANCIAL, merged)
          return merged
        })
      }
      if (d.length) {
        setDespesas(prev => {
          const map = new Map()
          d.forEach(des => map.set(des.id, des))
          prev.forEach(des => map.set(des.id, des))
          const merged = Array.from(map.values())
          LS.set(STORAGE_DESPESAS, merged)
          return merged
        })
      }
      LS.set('thsm_usuarios', u); setUsuarios(u)
      if (r.length) { setRotas(r) } else { fetchRotas() }
      if (p.length) {
        const fromDB = {}
        const variantsDB = {}
        const prodIdsFromJSON = new Set(produtos.map(x => x.id))
        const newsFromDB = []
        p.forEach(prod => {
          if (!prodIdsFromJSON.has(prod.id)) {
            newsFromDB.push({ id: prod.id, nome: prod.nome || '', preco: prod.preco || 0, estoque: prod.estoque || 0, imagem: prod.imagem || '', categoria: prod.categoria || '', descricao: '', variantes: prod.variantes || {}, semDevolucao: !!prod.semDevolucao })
          }
          const override = {}
          if (prod.preco !== null) override.preco = prod.preco
          if (prod.estoque !== null) override.estoque = prod.estoque
          if (prod.imagem !== null && typeof prod.imagem === 'string' && !prod.imagem.startsWith('data:') && prod.imagem.length < 2048) override.imagem = prod.imagem
          if (prod.categoria !== null) override.categoria = prod.categoria
          if (prod.preco_custo !== null) override.preco_custo = prod.preco_custo
          if (Object.keys(override).length > 0) fromDB[prod.id] = override
          if (prod.variantes && Object.keys(prod.variantes).length > 0) {
            variantsDB[prod.id] = prod.variantes
          }
        })
        if (newsFromDB.length > 0) {
          setNewProducts(prev => {
            const map = new Map()
            newsFromDB.forEach(np => map.set(np.id, np))
            prev.forEach(np => map.set(np.id, np))
            const merged = Array.from(map.values())
            LS.set('thsm_admin_new_products', merged)
            return merged
          })
        }
        if (Object.keys(variantsDB).length > 0) {
          try {
            const existing = JSON.parse(localStorage.getItem('thsm_prod_variants') || '{}')
            localStorage.setItem('thsm_prod_variants', JSON.stringify({ ...existing, ...variantsDB }))
          } catch {}
        }
        setProdChanges(prev => {
          const merged = { ...fromDB, ...prev }
          const novoJson = JSON.stringify(merged)
          if (novoJson.length > 400000) {
            const compact = {}
            Object.entries(merged).forEach(([id, o]) => { if (o.imagem && o.imagem.startsWith('data:')) o = { ...o, imagem: '' }; compact[id] = o })
            LS.set(STORAGE_PRODUCTS, compact)
          } else {
            LS.set(STORAGE_PRODUCTS, merged)
          }
          return merged
        })
      }
    }).catch(e => { console.error('syncAllForAdmin error:', e) })
      .finally(() => setSyncingUsers(false))
    getAllLeads().then(setLeads).catch(() => {})
    // Reenvia leads salvos localmente (fallback quando site ficou offline)
    ;(async () => {
      try {
        const pendentes = JSON.parse(localStorage.getItem('thsm_pending_leads') || '[]')
        if (!pendentes.length) return
        const enviados = []
        for (const lead of pendentes) {
          const { error } = await supabase.from('leads').insert(lead)
          if (!error || error.code === '23505') enviados.push(lead)
        }
        if (enviados.length) localStorage.setItem('thsm_pending_leads', JSON.stringify(pendentes.filter(p => !enviados.includes(p))))
      } catch {}
    })()
  }, [])

  // Auto-expand first rota when rotas load
  useEffect(() => {
    if (rotas.length > 0 && !expandedRota) setExpandedRota(rotas[0].rota)
  }, [rotas, expandedRota])

  useEffect(() => { LS.set('thsm_admin_new_products', newProducts) }, [newProducts])
  useEffect(() => { LS.set('thsm_admin_deleted_products', deletedProdIds) }, [deletedProdIds])

  const produtosAtuais = useMemo(() => {
    const base = produtos.map(p => ({
      ...p,
      ...(prodChanges[p.id] || {})
    }))
    const news = newProducts.map(p => ({ ...p, ...(prodChanges[p.id] || {}) }))
    return [...news, ...base].filter(p => !deletedProdIds.includes(p.id))
  }, [produtos, prodChanges, newProducts, deletedProdIds])

  // =============================================
  // ORDERS
  // =============================================
  const [savingOrder, setSavingOrder] = useState(false)
  const addOrder = async (data) => {
    if (savingOrder) return
    setSavingOrder(true)
    const items = data.items
    const totalAvista = items.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
    const totalAprazo = items.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
    const orderId = Date.now()
    let order = {
      id: orderId,
      date: data.dataPedido || hoje(),
      customer: { nome: data.nome, telefone: data.telefone, cpf: data.cpf || '', endereco: data.endereco || { cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' } },
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
    setOrders(prev => [order, ...prev])

    // Upsert user to Supabase and update local list
    const existingUser = usuarios.find(u => u.telefone === data.telefone)
    const mergedEndereco = { ...(existingUser?.endereco || {}), ...(data.endereco || {}), cpf: data.cpf || existingUser?.endereco?.cpf || '', origem: existingUser?.endereco?.origem || 'Admin' }
    const savedUser = await upsertUser({
      telefone: data.telefone,
      nome: data.nome,
      email: data.email || '',
      endereco: mergedEndereco
    })
    if (savedUser) {
      order = { ...order, user_id: savedUser.id }
      setOrders(prev => prev.map(o => o.id === orderId ? order : o))
      upsertOrder(order)
      setUsuarios(prev => {
        const idx = prev.findIndex(u => u.telefone === savedUser.telefone)
        if (idx >= 0) {
          const updated = [...prev]
          updated[idx] = savedUser
          return updated
        }
        return [savedUser, ...prev]
      })
    }

    // Create financial records for "a prazo" items
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
        precoCusto: (i.preco_custo || 0) * i.qty,
        dueDate,
        paidDate: concluido ? hoje() : null,
        status: concluido ? 'pago' : 'pendente'
      }
    })
    if (finRecords.length > 0) {
      setFinancial(prev => [...finRecords, ...prev])
    }

    showToast('Pedido adicionado com sucesso!')
    setShowAddOrder(false)
    setSavingOrder(false)
    sendStatusWebhook(order, order.status)
  }

  const updateOrderStatus = (id, status, skipWebhook = false) => {
    const order = orders.find(o => o.id === id)
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status, deliveredAt: status === 'entregue' ? Date.now() : o.deliveredAt } : o))
    if (status === 'entregue') {
      setFinancial(prev => prev.map(f => f.orderId === id && f.status !== 'pago' ? { ...f, status: 'pago', paidDate: hoje() } : f))
    }
    showToast(`Pedido #${id} atualizado para "${status}"`)
    const STATUS_ORDER = ['pre-pedido', 'pendente', 'confirmado', 'em-andamento', 'em-rota', 'entregue']
    const prevIndex = STATUS_ORDER.indexOf(order?.status)
    const nextIndex = STATUS_ORDER.indexOf(status)
    const isAdvance = prevIndex !== -1 && nextIndex > prevIndex
    const isNewOrder = prevIndex === -1 && STATUS_ORDER.includes(status)
    if (order && !skipWebhook && (isAdvance || isNewOrder)) sendStatusWebhook(order, status)
  }

  const updateOrderDue = (id, due) => {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, dataVencimento: due || null } : o))
    setFinancial(prev => prev
      .filter(f => f.orderId === id && f.status !== 'pago' && f.status !== 'cancelado')
      .map(f => ({ ...f, dueDate: due || f.dueDate })))
    showToast('Data de vencimento atualizada!')
  }

  const preApprovarPedido = (orderId, rejectedItemIds, replacements = [], dataVencimento = null) => {
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    const rejected = new Set(rejectedItemIds)
    let remainingItems = order.items.filter((_, idx) => !rejected.has(idx))
    if (replacements.length > 0) {
      remainingItems = [...remainingItems, ...replacements]
    }
    if (remainingItems.length === 0) { showToast('Não é possível aprovar um pedido sem itens', 'error'); return }
    const totalAvista = remainingItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
    const totalAprazo = remainingItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
    const now = Date.now()
    const updatedOrder = {
      ...order,
      items: remainingItems,
      totalAvista,
      totalAprazo,
      total: totalAvista + totalAprazo,
      status: 'pendente',
      preApprovedAt: now,
      dataVencimento: dataVencimento || order.dataVencimento || null,
      rejectedItems: rejectedItemIds.length > 0 ? rejectedItemIds.map(idx => order.items[idx]) : []
    }
    setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o))
    // Create financial records for approved a-prazo items
    const finRecords = remainingItems.filter(i => i.tipo === 'aprazo').map(i => {
      const dueDate = dataVencimento || (() => {
        const d = new Date((order.date || hoje()) + 'T12:00:00')
        d.setDate(d.getDate() + 60)
        return d.toISOString().split('T')[0]
      })()
      return {
        id: orderId + '-' + i.id,
        orderId,
        customerName: order.customer?.nome || '',
        itemName: i.nome,
        qty: i.qty,
        value: i.preco * i.qty,
        precoCusto: (i.preco_custo || 0) * i.qty,
        dueDate,
        paidDate: null,
        status: 'pendente'
      }
    })
    if (finRecords.length > 0) setFinancial(prev => [...finRecords, ...prev])
    showToast(`Pedido #${orderId} revisado e enviado para "Pendente"`)
    setShowOrderDetail(null)
  }

  const updateOrderCustomer = (id, customerData) => {
    const telefone = customerData.telefone?.replace(/\D/g, '') || ''
    setOrders(prev => prev.map(o => o.id === id ? { ...o, customer: customerData } : o))
    setShowOrderDetail(prev => prev?.id === id ? { ...prev, customer: customerData } : prev)
    if (telefone) {
      const existingUser = usuarios.find(u => u.telefone === telefone)
      upsertUser({
        telefone,
        nome: customerData.nome,
        email: customerData.email || '',
        endereco: { ...(existingUser?.endereco || {}), ...customerData.endereco, cpf: customerData.cpf || existingUser?.endereco?.cpf || '' }
      }).then(saved => {
        if (saved) {
          setUsuarios(prev => prev.map(u => u.telefone === saved.telefone ? saved : u))
          setOrders(prev => prev.map(o =>
            o.customer?.telefone?.replace(/\D/g, '') === telefone
              ? { ...o, customer: { ...o.customer, nome: customerData.nome } }
              : o
          ))
        }
      })
    }
    showToast('Dados do cliente atualizados!')
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

  const cloneOrder = (original) => {
    const newId = Date.now()
    const newOrder = {
      ...original,
      id: newId,
      date: hoje(),
      createdAt: Date.now(),
      status: 'pendente',
      preApprovedAt: null,
      pre_approved_at: null
    }
    setOrders(prev => [newOrder, ...prev])
    const finRecords = original.items.filter(i => i.tipo === 'aprazo').map(i => {
      const origFin = financial.find(f => f.id === original.id + '-' + i.id)
      const dueDate = origFin?.dueDate || (() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().split('T')[0] })()
      return {
        id: newId + '-' + i.id,
        orderId: newId,
        customerName: original.customer?.nome || '',
        itemName: i.nome,
        qty: i.qty,
        value: i.preco * i.qty,
        precoCusto: (i.preco_custo || 0) * i.qty,
        dueDate,
        paidDate: null,
        status: 'pendente'
      }
    })
    if (finRecords.length > 0) setFinancial(prev => [...finRecords, ...prev])
    showToast(`Pedido #${original.id} clonado como #${newId.toString().slice(-6)}!`)
  }

  const handleDeliveryFile = (e, type) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      if (type === 'identity') setIdentityPreview(ev.target.result)
      else setAddressPreview(ev.target.result)
    }
    reader.readAsDataURL(file)
  }

  const finalizarComDevolucao = (orderId) => {
    const order = orders.find(o => o.id === orderId)
    if (!order) return
    const returnedItems = []
    const remainingItems = order.items.filter(i => {
      const qty = returnQuantities[i.id] || 0
      if (qty > 0) returnedItems.push({ ...i, returnedQty: Math.min(qty, i.qty) })
      return (i.qty - (returnQuantities[i.id] || 0)) > 0
    })
    const adjustedItems = remainingItems.map(i => ({
      ...i,
      qty: i.qty - (returnQuantities[i.id] || 0)
    }))
    const totalAvista = adjustedItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
    const totalAprazo = adjustedItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
    const totalBase = totalAvista + totalAprazo
    const desconto = deliveryDiscountType === 'percent'
      ? (Math.min(100, Number(deliveryDiscount) || 0) / 100) * totalBase
      : Math.max(0, Math.min(Number(deliveryDiscount) || 0, totalBase))
    const totalCobrar = Math.round((totalBase - desconto) * 100) / 100
    const totalPago = Math.max(0, Math.min(Number(deliveryPaid) || 0, totalCobrar))
    const totalReembolso = order.items.reduce((s, i) => s + i.preco * (returnQuantities[i.id] || 0), 0)
    const updatedOrder = {
      ...order,
      items: adjustedItems,
      totalAvista,
      totalAprazo,
      total: totalCobrar,
      desconto: Math.round(desconto * 100) / 100,
      totalPago,
      status: 'entregue',
      returnedItems,
      totalReembolso,
      dataInicio: deliveryDataInicio || order.dataInicio || order.date || null,
      dataVencimento: deliveryDataVenc || order.dataVencimento || null,
      identityPhoto: identityPreview || order.identityPhoto || '',
      addressProof: addressPreview || order.addressProof || '',
      deliveredAt: Date.now(),
      paymentMethod: deliveryPayment,
      paymentSplits: deliverySplits
    }
    setOrders(prev => prev.map(o => o.id === orderId ? updatedOrder : o))
    // Sync financeiro: update existing, create for missing items, apply desconto + pagamento
    setFinancial(prev => {
      const existingIds = new Set(prev.filter(f => f.orderId === orderId).map(f => f.id))
      const templates = adjustedItems.map(i => ({
        id: orderId + '-' + i.id,
        orderId,
        customerName: order.customer?.nome || '',
        itemName: i.nome,
        qty: i.qty,
        baseValue: i.preco * i.qty,
        precoCusto: (i.preco_custo || 0) * i.qty,
        avista: i.tipo === 'avista',
        value: i.preco * i.qty,
        paid: 0
      }))
      if (desconto > 0 && totalBase > 0) {
        let remaining = desconto
        templates.forEach((t, idx) => {
          const d = idx === templates.length - 1 ? remaining : Math.min(remaining, Math.round((t.baseValue / totalBase) * desconto * 100) / 100)
          t.value = Math.max(0, t.baseValue - d)
          remaining = Math.round((remaining - d) * 100) / 100
        })
      }
      if (totalPago > 0 && totalCobrar > 0) {
        let remaining = totalPago
        templates.forEach((t, idx) => {
          if (remaining <= 0) return
          const share = idx === templates.length - 1 ? remaining : Math.min(remaining, Math.round((t.value / totalCobrar) * totalPago * 100) / 100)
          t.paid = share
          t.value = Math.max(0, Math.round((t.value - share) * 100) / 100)
          remaining = Math.round((remaining - share) * 100) / 100
        })
      }
      const dueDate = deliveryDataVenc || hoje()
      const newRecords = templates
        .filter(t => !existingIds.has(t.id))
        .map(t => ({
          id: t.id,
          orderId,
          customerName: t.customerName,
          itemName: t.itemName,
          qty: t.qty,
          value: t.value,
          precoCusto: t.precoCusto,
          dueDate: t.avista ? hoje() : dueDate,
          paidDate: t.value <= 0 ? hoje() : null,
          status: t.value <= 0 ? 'pago' : 'pendente',
          paymentMethod: deliveryPayment
        }))
      const updated = prev.map(f => {
        if (f.orderId !== orderId) return f
        const item = order.items.find(i => f.id === orderId + '-' + i.id)
        if (!item) return f
        const returnedQty = returnQuantities[item.id] || 0
        if (returnedQty >= item.qty) return { ...f, status: 'cancelado', paidDate: hoje() }
        const t = templates.find(x => x.id === f.id)
        if (!t) return f
        return { ...f, qty: t.qty, value: t.value, precoCusto: t.precoCusto, dueDate: t.avista ? hoje() : (deliveryDataVenc || f.dueDate), status: t.value <= 0 ? 'pago' : 'pendente', paidDate: t.value <= 0 ? hoje() : null, paymentMethod: deliveryPayment }
      })
      return [...updated, ...newRecords]
    })
    const refundMsg = totalReembolso > 0 ? ` — Reembolso: ${formatPreco(totalReembolso)}` : ''
    const discountMsg = desconto > 0 ? ` — Desconto: ${formatPreco(desconto)}` : ''
    const paidMsg = totalPago > 0 ? ` — Pago: ${formatPreco(totalPago)}` : ''
    showToast(`Pedido #${orderId} finalizado!${refundMsg}${discountMsg}${paidMsg} WhatsApp enviado para o cliente com link de confirmação.`)
    sendStatusWebhook(updatedOrder, 'entregue', { returnedItems })
    setShowDeliveryModal(null)
    setReturnQuantities({})
    setPayQuantities({})
    setDeliveryDiscount('')
    setDeliveryPaid('')
    setDeliveryDataVenc('')
    setIdentityPreview('')
    setAddressPreview('')
  }

  const deleteOrder = (id) => {
    if (!confirm('Excluir este pedido?')) return
    setOrders(prev => prev.filter(o => o.id !== id))
    setFinancial(prev => prev.filter(f => f.orderId !== id))
    supabaseDeleteOrder(id)
    showToast('Pedido excluído')
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
      telefone: editUserData.telefone,
      nome: editUserData.nome,
      email: editUserData.email || '',
      endereco: { ...(editUserData.endereco || {}) }
    }
    if (editUserData.senha) payload.endereco.senha = editUserData.senha
    else if (selectedUserDetail?.endereco?.senha) payload.endereco.senha = selectedUserDetail.endereco.senha

    const saved = await upsertUser(payload)
    if (saved) {
      setUsuarios(prev => prev.map(u => u.telefone === saved.telefone ? saved : u))
      setSelectedUserDetail(saved)
      setEditingUser(false)
      setEditUserData(null)
      showToast('Usuário atualizado com sucesso!')
    } else {
      showToast('Erro ao salvar usuário', 'error')
    }
  }

  const mudarSenha = async () => {
    if (!pwTarget) return
    const nova = (pwNew || '').trim()
    if (nova.length < 3) { showToast('A senha deve ter pelo menos 3 caracteres', 'error'); return }
    const saved = await upsertUser({
      telefone: pwTarget.telefone,
      nome: pwTarget.nome,
      email: pwTarget.email || '',
      endereco: { ...(pwTarget.endereco || {}), senha: nova }
    })
    if (saved) {
      setUsuarios(prev => prev.map(u => u.telefone === saved.telefone ? saved : u))
      if (selectedUserDetail?.telefone === saved.telefone) setSelectedUserDetail(saved)
      setPwTarget(null)
      setPwNew('')
      showToast(`Senha de ${saved.nome} alterada com sucesso!`)
    } else {
      showToast('Erro ao alterar a senha', 'error')
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
      .sort((a, b) => (b.createdAt || b.date || 0) - (a.createdAt || a.date || 0))
  }, [orders, selectedUserDetail])

  const rotaDeTelefone = useMemo(() => {
    const map = {}
    rotas.forEach(r => {
      const phone = normalizePhone((r.remoteJid || '').replace(/@.*/, ''))
      if (phone) map[phone] = r.rota || 'Sem rota'
    })
    usuarios.forEach(u => {
      const phone = normalizePhone(u.telefone)
      if (phone && u.endereco?.rota) map[phone] = u.endereco.rota
    })
    return map
  }, [rotas, usuarios])

  const rotaDeOrder = (o) => {
    const phone = normalizePhone(o.customer?.telefone)
    return phone ? (rotaDeTelefone[phone] || 'Sem rota') : 'Sem rota'
  }

  const getOrderDue = (o) => o.dataVencimento || financial.find(f => f.orderId === o.id)?.dueDate || ''

  const filteredOrders = useMemo(() => {
    const isFinalizada = o => o.status === 'entregue' && (o.paymentMethod || o.payment || (financial.some(f => f.orderId === o.id) && financial.filter(f => f.orderId === o.id).every(f => f.status === 'pago' || f.status === 'cancelado')))
    let result = orders
    if (orderFilter === 'concluidos') result = result.filter(o => isFinalizada(o))
    else if (orderFilter === 'entregue') result = result.filter(o => o.status === 'entregue' && !isFinalizada(o))
    else if (orderFilter !== 'todos') result = result.filter(o => o.status === orderFilter)
    if (selectedUserEmail) result = result.filter(o => o.customer?.email === selectedUserEmail)
    const t = orderSearch.toLowerCase().trim()
    if (t) result = result.filter(o =>
      o.customer?.nome?.toLowerCase().includes(t) ||
      o.customer?.telefone?.includes(t) ||
      (o.customer?.endereco?.cidade || '').toLowerCase().includes(t)
    )
    if (orderDateStart) result = result.filter(o => (o.date || '') >= orderDateStart)
    if (orderDateEnd) result = result.filter(o => (o.date || '') <= orderDateEnd)
    if (orderDueStart) result = result.filter(o => (getOrderDue(o) || '') >= orderDueStart)
    if (orderDueEnd) result = result.filter(o => (getOrderDue(o) || '') <= orderDueEnd)
    if (orderCityFilter !== 'TODAS') result = result.filter(o => o.customer?.endereco?.cidade === orderCityFilter)
    if (orderRoutesSelected.size > 0) {
      result = result.filter(o => orderRoutesSelected.has(rotaDeOrder(o)))
    }
    result = [...result].sort((a, b) => {
      let va, vb
      switch (orderSort.field) {
        case 'cliente': va = a.customer?.nome || ''; vb = b.customer?.nome || ''; return orderSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'telefone': va = a.customer?.telefone || ''; vb = b.customer?.telefone || ''; return orderSort.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
        case 'regiao': va = a.customer?.endereco?.cidade || ''; vb = b.customer?.endereco?.cidade || ''; return orderSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'data': return orderSort.dir === 'asc' ? (a.date || '').localeCompare(b.date || '') : (b.date || '').localeCompare(a.date || '')
        case 'itens': va = a.items?.reduce((s, i) => s + i.qty, 0) || 0; vb = b.items?.reduce((s, i) => s + i.qty, 0) || 0; return orderSort.dir === 'asc' ? va - vb : vb - va
        case 'total': return orderSort.dir === 'asc' ? (a.total || 0) - (b.total || 0) : (b.total || 0) - (a.total || 0)
        default: return (b.createdAt || 0) - (a.createdAt || 0)
      }
    })
    return result
  }, [orders, orderFilter, selectedUserEmail, orderSearch, orderSort, orderDateStart, orderDateEnd, orderDueStart, orderDueEnd, orderCityFilter, orderRoutesSelected, rotaDeTelefone, financial])

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
    if (action === 'delete' && !confirm(`Excluir ${selectedIds.size} pedido(s)?`)) return
    selectedIds.forEach(id => {
      const order = orders.find(o => o.id === id)
      if (action === 'confirm') {
        if (order?.status === 'pre-pedido') updateOrderStatus(id, 'pendente', true)
        else if (order?.status === 'pendente') updateOrderStatus(id, 'em-rota')
        else updateOrderStatus(id, 'em-rota')
      } else if (action === 'delete') {
        setOrders(prev => prev.filter(o => o.id !== id))
        setFinancial(prev => prev.filter(f => f.orderId !== id))
        supabaseDeleteOrder(id)
      }
    })
    if (action === 'delete') showToast(`${selectedIds.size} pedido(s) excluído(s)`)
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
      ;(order.items || []).forEach(i => {
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
    const msg = buildStatusWhatsApp(o, o.status)
    const raw = (o.customer?.telefone || '').replace(/\D/g, '')
    const telefone = raw.startsWith('55') ? raw : '55' + raw
    if (!telefone) return
    fetch(WHATSAPP_FORCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telefone, message: msg })
    }).then(() => showToast('WhatsApp enviado!', 'success')).catch(() => {})
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
    const faturamento = ordersIn.filter(o => o.status !== 'cancelado').reduce((s, o) => s + (o.total || 0), 0)
    const aReceber = financial.filter(f => f.status === 'pendente' && inRange(f.dueDate || '')).reduce((s, f) => s + (f.value || 0), 0)
    const recebido = financial.filter(f => f.status === 'pago' && inRange(f.paidDate || '')).reduce((s, f) => s + (f.value || 0), 0)
    return { total, pendentes, entregues, faturamento, aReceber, recebido }
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
    const isFinalizada = o => o.status === 'entregue' && (o.paymentMethod || o.payment || (financial.some(f => f.orderId === o.id) && financial.filter(f => f.orderId === o.id).every(f => f.status === 'pago' || f.status === 'cancelado')))
    const concluidos = orders.filter(isFinalizada)
    const faturamentoTotal = concluidos.reduce((s, o) => s + (o.total || 0), 0)
    let lucroTotal = 0
    const qtyByProduto = {}
    concluidos.forEach(o => {
      ;(o.items || []).forEach(i => {
        const qty = Number(i.qty) || 0
        const preco = Number(i.preco) || 0
        const custo = Number(i.preco_custo) || Number(i.custo) || 0
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

  // Usuarios filter & pagination
  const filteredUsuarios = useMemo(() => {
    let result = usuarios
    const t = userSearch.toLowerCase().trim()
    const tEnd = userEnderecoSearch.toLowerCase().trim()
    if (selectedUserEmail || t || userCityFilter !== 'TODAS' || userOrigemFilter !== 'TODAS' || tEnd) {
      result = usuarios.filter(u => {
        if (userCityFilter !== 'TODAS') {
          const cidade = (u.endereco?.cidade || u.endereco?.cidade || '').toLowerCase()
          if (cidade !== userCityFilter.toLowerCase()) return false
        }
        if (userOrigemFilter !== 'TODAS') {
          const origem = u.endereco?.origem || ''
          if (origem !== userOrigemFilter) return false
        }
        if (tEnd) {
          const e = u.endereco || {}
          const addrStr = [e.rua, e.numero, e.bairro, e.cidade, e.estado, e.cep, e.complemento].filter(Boolean).join(' ').toLowerCase()
          if (!addrStr.includes(tEnd)) return false
        }
        if (t && !u.nome?.toLowerCase().includes(t) && !u.telefone?.includes(t) && !(u.email || '').toLowerCase().includes(t)) return false
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
  }, [usuarios, userSearch, userCityFilter, userOrigemFilter, userEnderecoSearch, userSort, selectedUserEmail])

  const paginatedUsuarios = useMemo(() => {
    const start = (userPage - 1) * USER_PAGE_SIZE
    return filteredUsuarios.slice(start, start + USER_PAGE_SIZE)
  }, [filteredUsuarios, userPage])

  const totalUserPages = useMemo(() => Math.ceil(filteredUsuarios.length / USER_PAGE_SIZE), [filteredUsuarios])

  useEffect(() => { setUserPage(1) }, [userSearch, userCityFilter, userOrigemFilter, userEnderecoSearch, selectedUserEmail])

  const userCities = useMemo(() => {
    const cidades = [...new Set(usuarios.map(u => u.endereco?.cidade).filter(Boolean))]
    return ['TODAS', ...cidades.sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [usuarios])

  // =============================================
  // PRODUCTS
  // =============================================
  const updateProduct = (id, changes) => {
    setProdChanges(prev => {
      const next = { ...prev, [id]: { ...(prev[id] || {}), ...changes } }
      LS.set(STORAGE_PRODUCTS, next)
      return next
    })
    showToast('Produto atualizado!')
    if (editingProd) setEditingProd(null)
  }

  const categoriasProd = useMemo(() => ['TODOS', ...[...new Set([...produtosAtuais.map(p => p.categoria), ...customCategorias].filter(Boolean))].sort()], [produtosAtuais, customCategorias])

  const addDespesaTipo = (tipo) => {
    if (!tipo) return
    setCustomDespesaTipos(prev => prev.includes(tipo) ? prev : [...prev, tipo])
    showToast(`Tipo "${tipo}" criado!`)
  }

  const filteredProds = useMemo(() => {
    const t = prodSearch.toLowerCase().trim()
    const [pMin, pMax] = prodPriceRange
    return produtosAtuais.filter(p => {
      if (t && !p.nome.toLowerCase().includes(t) && !p.categoria.toLowerCase().includes(t)) return false
      if (prodCatFilter !== 'TODOS' && p.categoria !== prodCatFilter) return false
      if (prodStockFilter === 'in' && p.estoque <= 0) return false
      if (prodStockFilter === 'out' && p.estoque > 0) return false
      if (p.preco < pMin || p.preco > pMax) return false
      return true
    }).sort((a, b) => {
      let va, vb
      switch (prodSort.field) {
        case 'nome': va = a.nome; vb = b.nome; return prodSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'categoria': va = a.categoria; vb = b.categoria; return prodSort.dir === 'asc' ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR')
        case 'preco': return prodSort.dir === 'asc' ? a.preco - b.preco : b.preco - a.preco
        case 'estoque': return prodSort.dir === 'asc' ? (a.estoque || 0) - (b.estoque || 0) : (b.estoque || 0) - (a.estoque || 0)
        default: return a.nome.localeCompare(b.nome, 'pt-BR')
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
    setProdCart(prev => {
      const existing = prev[p.id]
      if (existing) return { ...prev, [p.id]: { ...existing, qty: existing.qty + 1 } }
      return { ...prev, [p.id]: { id: p.id, nome: p.nome, preco: p.preco, preco_custo: p.preco_custo, imagem: p.imagem, tipo: 'aprazo', qty: 1, semDevolucao: !!p.semDevolucao } }
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

  const deleteSelectedProducts = (ids) => {
    const idList = [...ids]
    if (idList.length === 0) return
    if (!confirm(`Excluir permanentemente ${idList.length} produto(s)?\nEsta ação não pode ser desfeita.`)) return
    setDeletedProdIds(prev => [...prev, ...idList])
    setNewProducts(prev => prev.filter(p => !idList.includes(p.id)))
    supabaseDeleteProducts(idList)
    showToast(`${idList.length} produto(s) excluído(s)`)
    setProdSelectedIds(new Set())
  }

  const bulkProdAction = (action) => {
    if (prodSelectedIds.size === 0) { showToast('Selecione pelo menos um produto', 'error'); return }
    if (action === 'zerar') {
      if (!confirm(`Zerar estoque de ${prodSelectedIds.size} produto(s)?`)) return
      prodSelectedIds.forEach(id => updateProduct(id, { estoque: 0 }))
      showToast(`Estoque zerado para ${prodSelectedIds.size} produto(s)`)
    } else if (action === 'ocultar') {
      if (!confirm(`Marcar ${prodSelectedIds.size} produto(s) como indisponível?`)) return
      prodSelectedIds.forEach(id => updateProduct(id, { estoque: 0 }))
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
      prodSelectedIds.forEach(id => updateProduct(id, { semDevolucao: target }))
      showToast(`${prodSelectedIds.size} produto(s) marcados como ${target ? 'SEM DEVOLUÇÃO' : 'COM devolução'}`)
    }
    setProdSelectedIds(new Set())
  }

  const applyBulkPrice = () => {
    const val = parseFloat(bulkPriceValue)
    if (isNaN(val) || val < 0) { showToast('Valor inválido', 'error'); return }
    if (!confirm(`Definir preço R$ ${val.toFixed(2).replace('.', ',')} para ${prodSelectedIds.size} produto(s)?`)) return
    prodSelectedIds.forEach(id => updateProduct(id, { preco: val }))
    showToast(`Preço atualizado para ${prodSelectedIds.size} produto(s)`)
    setProdSelectedIds(new Set())
    setShowBulkPrice(false)
    setBulkPriceValue('')
  }

  const applyBulkStock = () => {
    const val = parseInt(bulkStockValue, 10)
    if (isNaN(val) || val < 0) { showToast('Valor inválido', 'error'); return }
    if (!confirm(`Definir estoque ${val} para ${prodSelectedIds.size} produto(s)?`)) return
    prodSelectedIds.forEach(id => updateProduct(id, { estoque: val }))
    showToast(`Estoque atualizado para ${prodSelectedIds.size} produto(s)`)
    setProdSelectedIds(new Set())
    setShowBulkStock(false)
    setBulkStockValue('')
  }

  // =============================================
  // FINANCIAL
  // =============================================
  const filteredFin = useMemo(() => {
    let result = financial
    if (finFilter !== 'todos') result = result.filter(f => f.status === finFilter)
    result = result.filter(f => inPeriod(f.dueDate, finPeriod, finPeriodMonth, finRangeStart, finRangeEnd))
    return result
  }, [financial, finFilter, finPeriod, finPeriodMonth, finRangeStart, finRangeEnd])

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
    const t = filterRotaSearch.toLowerCase().trim()
    if (t) result = result.filter(g =>
      g.rota.toLowerCase().includes(t) ||
      Object.values(g.cidades).some(c => c.cidade.toLowerCase().includes(t)) ||
      Object.values(g.cidades).some(c => c.contatos.some(ct => ct.pushName?.toLowerCase().includes(t)))
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
                      <td>{o.customer.nome}</td>
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
            <div className="admin-header-row">
              <div>
                <h1>Pedidos</h1>
                <p className="admin-subtitle">Gerencie todos os pedidos recebidos</p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {selectedUserEmail && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--accent)', background: 'var(--accent-bg)', padding: '0.3rem 0.6rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <i className="fa-solid fa-user"></i> {selectedUserEmail}
                    <button style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: '0' }} onClick={() => setSelectedUserEmail(null)}>
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </span>
                )}
                <button className="admin-btn admin-btn-primary" onClick={() => setShowAddOrder(true)}>
                  <i className="fa-solid fa-plus"></i> Novo Pedido
                </button>
              </div>
            </div>

            {orderFilter === 'concluidos' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginBottom: '1rem', background: 'var(--card-bg)', border: '1px solid var(--admin-border)', borderRadius: '12px', padding: '1rem' }}>
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
                { id: 'entregue', label: 'Entregues', count: orders.filter(o => o.status === 'entregue' && !(o.paymentMethod || o.payment || (financial.some(f => f.orderId === o.id) && financial.filter(f => f.orderId === o.id).every(f => f.status === 'pago' || f.status === 'cancelado')))).length },
                { id: 'concluidos', label: 'Concluídos', count: orders.filter(o => o.status === 'entregue' && (o.paymentMethod || o.payment || (financial.some(f => f.orderId === o.id) && financial.filter(f => f.orderId === o.id).every(f => f.status === 'pago' || f.status === 'cancelado')))).length },
                { id: 'cancelado', label: 'Cancelados', count: orders.filter(o => o.status === 'cancelado').length },
              ].map(t => (
                <button key={t.id} className={`admin-tab ${orderFilter === t.id ? 'active' : ''}`} onClick={() => setOrderFilter(t.id)}>
                  {t.label} {t.count > 0 && <span className="tab-count">{t.count}</span>}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.65rem', marginBottom: '0.85rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="admin-search-prod" style={{ flex: '1', minWidth: '180px' }}>
                <i className="fa-solid fa-search"></i>
                <input type="text" placeholder="Buscar por nome, telefone ou cidade..." value={orderSearch} onChange={e => setOrderSearch(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>
                <span>Data:</span>
                <input type="date" value={orderDateStart} onChange={e => setOrderDateStart(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', maxWidth: '130px' }} />
                <span>—</span>
                <input type="date" value={orderDateEnd} onChange={e => setOrderDateEnd(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', maxWidth: '130px' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>
                <span>Vencimento:</span>
                <input type="date" value={orderDueStart} onChange={e => setOrderDueStart(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', maxWidth: '130px' }} />
                <span>—</span>
                <input type="date" value={orderDueEnd} onChange={e => setOrderDueEnd(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', maxWidth: '130px' }} />
              </div>
              <select value={orderCityFilter} onChange={e => setOrderCityFilter(e.target.value)} style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.78rem', background: 'white', cursor: 'pointer', maxWidth: '150px' }}>
                {cidadesOrders.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowOrderRouteFilter(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.35rem 0.6rem', borderRadius: '6px', border: `1px solid ${orderRoutesSelected.size > 0 ? 'var(--accent)' : 'var(--admin-border)'}`, fontSize: '0.78rem', background: orderRoutesSelected.size > 0 ? 'var(--accent-bg)' : 'white', color: orderRoutesSelected.size > 0 ? 'var(--accent)' : 'var(--admin-text)', cursor: 'pointer', fontWeight: orderRoutesSelected.size > 0 ? 700 : 400 }}>
                  <i className="fa-solid fa-route"></i>
                  {orderRoutesSelected.size > 0 ? `${orderRoutesSelected.size} rota(s)` : 'Rotas'}
                  <i className="fa-solid fa-chevron-down" style={{ fontSize: '0.6rem' }}></i>
                </button>
                {showOrderRouteFilter && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 60, minWidth: '220px', maxHeight: '300px', overflowY: 'auto', background: 'white', border: '1px solid var(--admin-border)', borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.12)', padding: '0.5rem' }}>
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
              {selectedIds.size > 0 && (
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', fontWeight: 600 }}>{selectedIds.size} selecionado(s)</span>
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
            </div>

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: '36px' }}>
                      <input type="checkbox" checked={filteredOrders.length > 0 && selectedIds.size === filteredOrders.length} onChange={toggleSelectAll} style={{ cursor: 'pointer', width: '15px', height: '15px' }} />
                    </th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('cliente')}>Cliente {sortIcon('cliente')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('telefone')}>Telefone {sortIcon('telefone')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('regiao')}>Região {sortIcon('regiao')}</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('data')}>Data {sortIcon('data')}</th>
                    <th>Vencimento</th>
                    <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('itens')}>Itens {sortIcon('itens')}</th>
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
                      <td style={{ fontWeight: 600 }}>{o.customer?.nome || '-'}</td>
                      <td>{o.customer?.telefone || '-'}</td>
                      <td>{[o.customer.endereco?.cidade, o.customer.endereco?.estado].filter(Boolean).join('/') || '-'}</td>
                      <td>{formatDate(o.date)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <input type="date" value={o.dataVencimento || ''} placeholder="Definir"
                          onChange={e => updateOrderDue(o.id, e.target.value)}
                          style={{ padding: '0.2rem 0.3rem', borderRadius: '5px', border: '1px solid var(--admin-border)', fontSize: '0.72rem', background: 'white', color: 'var(--admin-text)', width: '120px' }} />
                      </td>
                      <td>{o.items.reduce((s, i) => s + i.qty, 0)} itens</td>
                      <td className="td-price">{formatPreco(o.total)}</td>
                      <td>{o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto'}</td>
                      <td><span className={`status-tag status-${o.status}`}>{o.status}</span></td>
                      <td>
                        <div className="td-actions">
                          <button className="action-btn action-green" title="Enviar WhatsApp" onClick={() => sendWhatsApp(o)}><i className="fa-brands fa-whatsapp"></i></button>
                          <button className="action-btn" title="Ver detalhes" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-eye"></i></button>
                          {o.status === 'pre-pedido' && <button className="action-btn" style={{ color: '#8b5cf6', borderColor: '#8b5cf6' }} title="Revisar" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-clipboard-check"></i></button>}
                          {o.status === 'pre-pedido' && <button className="action-btn action-confirm" title="Confirmar (Próxima etapa)" onClick={() => updateOrderStatus(o.id, 'pendente')}><i className="fa-solid fa-check"></i></button>}
                          {o.status === 'pendente' && <button className="action-btn action-confirm" title="Editar" onClick={() => setShowOrderDetail(o)}><i className="fa-solid fa-pen"></i></button>}
                          {o.status === 'pendente' && <button className="action-btn action-deliver" title="Em Rota (Próxima etapa)" onClick={() => { setShowRotaDue(o); setRotaDueDate(o.dataVencimento || '') }}><i className="fa-solid fa-truck"></i></button>}
                          {o.status === 'pendente' && (
                            <button className="action-btn" style={{ color: '#f59e0b', borderColor: '#f59e0b' }} title="Voltar para Pré-Pedido" onClick={() => updateOrderStatus(o.id, 'pre-pedido')}><i className="fa-solid fa-undo"></i></button>
                          )}
                          {o.status === 'em-rota' && (
                            <button className="action-btn action-confirm" title="Concluir (Próxima etapa)" onClick={() => updateOrderStatus(o.id, 'entregue')}><i className="fa-solid fa-check-double"></i></button>
                          )}
                          {o.status === 'em-rota' && (
                            <button className="action-btn" style={{ color: '#f59e0b', borderColor: '#f59e0b' }} title="Voltar para Pendente" onClick={() => updateOrderStatus(o.id, 'pendente')}><i className="fa-solid fa-undo"></i></button>
                          )}
                          {o.status === 'entregue' && (
                            <button className="action-btn" style={{ color: '#f59e0b', borderColor: '#f59e0b' }} title="Voltar para Em Rota" onClick={() => updateOrderStatus(o.id, 'em-rota')}><i className="fa-solid fa-undo"></i></button>
                          )}
                          {o.status === 'entregue' && (
                            <button className="action-btn action-confirm" title="Finalizar Pedido" onClick={() => { setShowDeliveryModal(o); setReturnQuantities({}); setPayQuantities({}); setIdentityPreview(''); setAddressPreview(''); setDeliveryPayment('pix'); setDeliverySplits({ pix: '', dinheiro: '', cartao: '' }); setDeliveryDiscount(''); setDeliveryDiscountType('reais'); setDeliveryPaid(''); setDeliveryDataInicio(o.date || hoje()); setDeliveryDataVenc(o.dataVencimento || '') }}><i className="fa-solid fa-check"></i></button>
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
                  {paginatedOrders.length === 0 && <tr><td colSpan="11" className="td-empty">Nenhum pedido encontrado</td></tr>}
                </tbody>
              </table>
            </div>
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
                <button className="admin-btn" style={{ background: '#2563eb', color: 'white', borderColor: '#2563eb', fontSize: '0.78rem', padding: '0.35rem 0.7rem' }} onClick={() => setEditingProd({ id: Date.now(), nome: '', preco: 0, estoque: 0, imagem: '', categoria: '', descricao: '', variantes: {}, _new: true })}>
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
                {categoriasProd.map(c => <option key={c} value={c}>{c}</option>)}
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
                          <img src={p.imagem} alt={p.nome} loading="lazy" onError={() => toggleProdImageError(p.id)} />
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
                        <th style={{width: '50px'}}>Foto</th>
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
                              {p.imagem ? <img src={p.imagem} alt={p.nome} /> : <i className="fa-solid fa-image"></i>}
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
                          {item.imagem ? <img src={item.imagem} alt={item.nome} /> : <i className="fa-solid fa-image"></i>}
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
                      onClick={editingUser ? saveUserEdit : () => { setEditingUser(true); setEditUserData({ ...selectedUserDetail }) }}>
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
                          <input type="number" min="0" step="0.01" placeholder="Sem limite" value={editUserData.endereco?.limitePreco ?? ''} onChange={e => setEditUserData(p => ({ ...p, endereco: { ...(p.endereco || {}), limitePreco: e.target.value === '' ? null : Number(e.target.value) } }))}
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
                  const ultimoPedido = userOrdersDetail.length > 0 ? userOrdersDetail.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] : null
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
      setOrders(prev => prev.map(o => toUpdate.some(t => t.id === o.id) ? { ...o, status: 'em-rota' } : o))
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
                            <th>Cliente</th>
                            <th>Item</th>
                            <th>Qtd</th>
                            <th>Valor</th>
                            <th>Custo</th>
                            <th>Vencimento</th>
                            <th>Dias</th>
                            <th>Status</th>
                            <th>Forma</th>
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
          usuarios={usuarios}
          initialCart={prodCart}
          preselectedUser={preselectedUserForOrder}
          onSave={(order) => { addOrder(order); clearProdCart() }}
          onClose={() => { setShowAddOrder(false); setPreselectedUserForOrder(null); clearProdCart() }}
        />
      )}

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
                if (rotaDueDate) updateOrderDue(showRotaDue.id, rotaDueDate)
                updateOrderStatus(showRotaDue.id, 'em-rota')
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
          financial={financial.filter(f => f.orderId === showOrderDetail.id)}
          produtos={produtosAtuais}
          onClose={() => setShowOrderDetail(null)}
          onStatusChange={(s) => { updateOrderStatus(showOrderDetail.id, s); setShowOrderDetail(null) }}
          onUpdateDue={(due) => updateOrderDue(showOrderDetail.id, due)}
          onPreApprovar={(rejectedIds, replacements, venc) => preApprovarPedido(showOrderDetail.id, rejectedIds, replacements, venc)}
          onOpenDelivery={(order) => { setShowDeliveryModal(order); setReturnQuantities({}); setPayQuantities({}); setIdentityPreview(''); setAddressPreview(''); setDeliveryPayment('pix'); setDeliverySplits({ pix: '', dinheiro: '', cartao: '' }); setDeliveryDiscount(''); setDeliveryDiscountType('reais'); setDeliveryPaid(''); setDeliveryDataInicio(order.date || hoje()); setDeliveryDataVenc(order.dataVencimento || '') }}
          onEditAndConfirm={(editedItems, currentStatus) => {
            const totalAvista = editedItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
            const totalAprazo = editedItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
            const newStatus = currentStatus === 'entregue' || currentStatus === 'em-rota' ? 'entregue' : 'em-rota'
            const updatedOrder = {
              ...showOrderDetail,
              items: editedItems,
              totalAvista,
              totalAprazo,
              total: totalAvista + totalAprazo,
              status: newStatus,
              deliveredAt: newStatus === 'entregue' ? Date.now() : showOrderDetail.deliveredAt
            }
            setOrders(prev => prev.map(o => o.id === showOrderDetail.id ? updatedOrder : o))
            setFinancial(prev => {
              const existingIds = new Set(prev.filter(f => f.orderId === showOrderDetail.id).map(f => f.id))
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
                  dueDate: hoje(),
                  paidDate: newStatus === 'entregue' ? hoje() : null,
                  status: newStatus === 'entregue' ? 'pago' : (i.tipo === 'aprazo' ? 'pendente' : 'pago'),
                  paymentMethod: showOrderDetail.paymentMethod || ''
                }))
              const updated = prev.map(f => {
                if (f.orderId !== showOrderDetail.id) return f
                const item = editedItems.find(i => f.id === showOrderDetail.id + '-' + i.id)
                if (!item) return f
                return {
                  ...f,
                  qty: item.qty,
                  value: item.preco * item.qty,
                  precoCusto: (item.preco_custo || 0) * item.qty,
                  status: newStatus === 'entregue' ? 'pago' : f.status,
                  paidDate: newStatus === 'entregue' ? hoje() : f.paidDate
                }
              })
              return [...updated, ...newRecords]
            })
            showToast(currentStatus === 'em-rota' ? `Pedido #${showOrderDetail.id} finalizado e enviado para Entregues!` : `Pedido #${showOrderDetail.id} enviado para a rota!`)
            setShowOrderDetail(null)
            const ESTADOS = ['pre-pedido', 'pendente', 'confirmado', 'em-andamento', 'em-rota', 'entregue']
            const idxFrom = ESTADOS.indexOf(currentStatus)
            const idxTo = ESTADOS.indexOf(newStatus)
            if ((ESTADOS.includes(currentStatus) && idxTo > idxFrom) || (!ESTADOS.includes(currentStatus) && ESTADOS.includes(newStatus))) {
              sendStatusWebhook(updatedOrder, newStatus)
            }
          }}
          onEditSave={(editedItems) => {
            const totalAvista = editedItems.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
            const totalAprazo = editedItems.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
            const currentStatus = showOrderDetail.status
            const updatedOrder = {
              ...showOrderDetail,
              items: editedItems,
              totalAvista,
              totalAprazo,
              total: totalAvista + totalAprazo
            }
            setOrders(prev => prev.map(o => o.id === showOrderDetail.id ? updatedOrder : o))
            setFinancial(prev => {
              const existingIds = new Set(prev.filter(f => f.orderId === showOrderDetail.id).map(f => f.id))
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
                  dueDate: hoje(),
                  paidDate: showOrderDetail.deliveredAt ? hoje() : null,
                  status: showOrderDetail.status === 'entregue' ? 'pago' : (i.tipo === 'aprazo' ? 'pendente' : 'pago'),
                  paymentMethod: showOrderDetail.paymentMethod || ''
                }))
              const updated = prev.map(f => {
                if (f.orderId !== showOrderDetail.id) return f
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
              return [...updated, ...newRecords]
            })
            showToast('Itens salvos com sucesso!')
            setShowOrderDetail({ ...updatedOrder, items: editedItems.map(i => ({ ...i })) })
          }}
          onUpdateCustomer={(id, customerData) => updateOrderCustomer(id, customerData)}
          onCancelOrder={(id) => cancelOrder(id)}
        />
      )}

      {/* MODAL DELIVERY (UNIFIED FINALIZATION) */}
      {showDeliveryModal && (
        <div className="admin-overlay" onClick={() => setShowDeliveryModal(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '540px' }}>
            <div className="admin-modal-header">
              <h3><i className="fa-solid fa-check-circle"></i> Finalizar Pedido</h3>
              <button className="admin-modal-close" onClick={() => setShowDeliveryModal(null)}><i className="fa-solid fa-xmark"></i></button>
            </div>
            <div className="admin-modal-body">
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '0.5rem 0.75rem', marginBottom: '0.75rem' }}>
                <p style={{ fontSize: '0.78rem', color: '#1e40af', margin: 0 }}>
                  <i className="fa-solid fa-info-circle"></i> Após finalizar, o cliente receberá um link no WhatsApp para confirmar a entrega.
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

              {showDeliveryModal.items.map((i, idx) => {
                const maxQty = i.qty
                return (
                  <div key={idx} style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--admin-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{i.nome} ({i.qty}x)</span>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{formatPreco(i.preco * i.qty)}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', marginBottom: '0.35rem' }}>
                      {i.preco.toFixed(2).replace('.', ',')} /un — {i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.82rem' }}>
                        <span style={{ color: 'var(--admin-text-sec)' }}>Devolver:</span>
                        <input type="number" min="0" max={maxQty} step="1" value={returnQuantities[i.id] || ''}
                          placeholder="0"
                          onChange={e => {
                            const val = e.target.value === '' ? '' : Math.min(Number(e.target.value), maxQty)
                            setReturnQuantities(prev => ({ ...prev, [i.id]: val }))
                          }}
                          style={{ width: '50px', padding: '0.25rem 0.35rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', textAlign: 'center' }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* Auto-calc summary */}
              {(() => {
                const totalOriginal = showDeliveryModal.items.reduce((s, i) => s + i.preco * i.qty, 0)
                const totalDevolvido = showDeliveryModal.items.reduce((s, i) => s + i.preco * (returnQuantities[i.id] || 0), 0)
                const base = totalOriginal - totalDevolvido
                const desconto = deliveryDiscountType === 'percent'
                  ? (Math.min(100, Number(deliveryDiscount) || 0) / 100) * base
                  : Math.max(0, Math.min(Number(deliveryDiscount) || 0, base))
                const totalCobrar = Math.round((base - desconto) * 100) / 100
                const totalPago = Math.max(0, Math.min(Number(deliveryPaid) || 0, totalCobrar))
                const faltaPagar = totalCobrar - totalPago
                return (
                  <div style={{ background: '#f9fafb', borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1rem', marginTop: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem' }}>
                      <span>Total original</span>
                      <span>{formatPreco(totalOriginal)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.25rem', color: 'var(--danger)' }}>
                      <span><i className="fa-solid fa-rotate-left"></i> Total devolvido</span>
                      <span style={{ fontWeight: 700 }}>{formatPreco(totalDevolvido)}</span>
                    </div>
                    <div style={{ marginTop: '0.4rem', paddingTop: '0.35rem', borderTop: '1px solid var(--admin-border)' }}>
                      <p style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', marginBottom: '0.35rem' }}>
                        <i className="fa-solid fa-percent"></i> Desconto
                      </p>
                      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.4rem' }}>
                        <button type="button" className={`pag-chip ${deliveryDiscountType === 'reais' ? 'active' : ''}`} onClick={() => { setDeliveryDiscountType('reais'); setDeliveryDiscount('') }}>R$ Real</button>
                        <button type="button" className={`pag-chip ${deliveryDiscountType === 'percent' ? 'active' : ''}`} onClick={() => { setDeliveryDiscountType('percent'); setDeliveryDiscount('') }}>% Porcentagem</button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ fontSize: '0.82rem', color: 'var(--admin-text-sec)' }}>
                          {deliveryDiscountType === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'}
                        </span>
                        <input type="number" min="0" step={deliveryDiscountType === 'percent' ? '0.5' : '0.01'} max={deliveryDiscountType === 'percent' ? 100 : undefined}
                          placeholder="0" autoComplete="off"
                          value={deliveryDiscount}
                          onChange={e => {
                            const raw = e.target.value
                            if (raw === '') { setDeliveryDiscount(''); return }
                            const num = Number(raw)
                            if (!isNaN(num)) setDeliveryDiscount(num < 0 ? '0' : String(num))
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', marginTop: '0.4rem', paddingTop: '0.35rem', borderTop: '1px solid var(--admin-border)' }}>
                      <span style={{ fontSize: '0.82rem', color: 'var(--admin-text-sec)' }}>
                        <i className="fa-solid fa-hand-holding-dollar"></i> Quanto o cliente pagou
                      </span>
                      <input type="number" min="0" step="0.01" placeholder="0,00" autoComplete="off"
                        value={deliveryPaid}
                        onChange={e => {
                          const raw = e.target.value
                          if (raw === '') { setDeliveryPaid(''); return }
                          const num = Number(raw)
                          if (!isNaN(num)) setDeliveryPaid(num < 0 ? '0' : String(num))
                        }}
                        style={{ width: '110px', padding: '0.3rem 0.4rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.85rem', textAlign: 'right' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '0.3rem', color: faltaPagar > 0 ? 'var(--danger)' : 'var(--success)' }}>
                      <span style={{ fontWeight: 600 }}>{totalPago > 0 ? 'Falta pagar' : 'Saldo devedor'}</span>
                      <span style={{ fontWeight: 800 }}>{formatPreco(faltaPagar)}</span>
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

              {/* Payment method */}
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                  <i className="fa-solid fa-credit-card"></i> Forma de pagamento do cliente
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {Object.entries(PAG_METHODS).map(([id, conf]) => (
                    <button key={id} type="button"
                      className={`pag-chip ${deliveryPayment === id ? 'active' : ''}`}
                      onClick={() => { setDeliveryPayment(id); setDeliverySplits({ pix: '', dinheiro: '', cartao: '' }) }}>
                      <i className={`fa-solid ${conf.icon}`}></i> {conf.label}
                    </button>
                  ))}
                </div>
                {deliveryPayment.includes('+') && (
                  <div style={{ marginTop: '0.5rem', background: '#f9fafb', borderRadius: '8px', padding: '0.5rem 0.75rem' }}>
                    <p style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)', marginBottom: '0.4rem' }}>
                      <i className="fa-solid fa-arrows-left-right"></i> Divida o valor pago em cada forma:
                    </p>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      {deliveryPayment.split('+').map(m => (
                        <div key={m} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <span style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>{PAG_METHODS[m].label}:</span>
                          <input type="number" min="0" step="0.01" placeholder="0,00"
                            value={deliverySplits[m] || ''}
                            onChange={e => setDeliverySplits(prev => ({ ...prev, [m]: e.target.value }))}
                            style={{ width: '90px', padding: '0.25rem 0.35rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.82rem' }} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Document upload (optional) */}
              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setShowDeliveryModal(null)}>Cancelar</button>
                <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }}
                  onClick={() => finalizarComDevolucao(showDeliveryModal.id)}>
                  <i className="fa-solid fa-check"></i> Finalizar Pedido
                </button>
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
                <input type="number" step="0.01" min="0" placeholder="0,00" value={bulkPriceValue} onChange={e => setBulkPriceValue(e.target.value)} autoFocus />
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
                    const t = newRotaSearch.toLowerCase().trim()
                    if (!t) return false
                    return (r.pushName || '').toLowerCase().includes(t) || (r.remoteJid || '').includes(t) || (r.cidade || '').toLowerCase().includes(t)
                  }).slice(0, 30).map((r, i) => {
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
                  {newRotaSearch && rotas.filter(r => (r.pushName || '').toLowerCase().includes(newRotaSearch.toLowerCase())).length === 0 && (
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
            if (editingProd._new) {
              const newId = editingProd.id
              setNewProducts(prev => {
                const exists = prev.find(p => p.id === newId)
                if (exists) return prev.map(p => p.id === newId ? { ...p, ...changes, _new: true } : p)
                return [{ ...changes, id: newId, _new: true }, ...prev]
              })
              setEditingProd(null)
            } else {
              updateProduct(editingProd.id, changes)
            }
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

  const ORDER_STATUS = ['pre-pedido', 'pendente', 'confirmado', 'em-andamento', 'em-rota', 'entregue']
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
      ;(o.items || []).forEach(i => {
        if (itemTipoF !== 'todos' && (i.tipo || '') !== itemTipoF) return
        arr.push({
          produto: i.displayName || i.nome || i.produto || 'Produto',
          qty: Number(i.qty) || 0,
          preco: Number(i.preco) || 0,
          preco_custo: Number(i.preco_custo) || Number(i.custo) || 0,
          cliente: o.customer?.nome || '-',
          data: o.date || '',
          tipo: i.tipo === 'avista' ? 'À Vista' : 'A Prazo'
        })
      })
    })
    return arr
  }, [ordersF, itemTipoF])

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
      ;(o.items || []).forEach(i => {
        map[k].qtd += Number(i.qty) || 0
        map[k].custo += (Number(i.preco_custo) || Number(i.custo) || 0) * (Number(i.qty) || 0)
      })
    })
    return Object.values(map).sort((a, b) => a.mes.localeCompare(b.mes))
  }, [ordersF])

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
      ;(o.items || []).forEach(i => {
        arr.push({
          data: o.date || '',
          descricao: `Pedido #${String(o.id).slice(-6)}`,
          produto: i.displayName || i.nome || i.produto || 'Produto',
          sku: i.id || '',
          qty: Number(i.qty) || 0,
          tipo: 'Saída',
          custoMedio: Number(i.preco_custo) || 0
        })
      })
    })
    return arr.sort((a, b) => b.data.localeCompare(a.data))
  }, [ordersF])

  const inativos = useMemo(() => {
    const arr = usuarios.map(u => {
      const pedidosUser = orders.filter(o => o.customer?.telefone === u.telefone || o.user_id === u.id)
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
                const pedidosUser = orders.filter(o => o.customer?.telefone === u.telefone || o.user_id === u.id)
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

function AddOrderModal({ produtos, usuarios, initialCart, preselectedUser, onSave, onClose }) {
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
  const [cart, setCart] = useState(() => {
    if (initialCart && Object.keys(initialCart).length > 0) {
      return Object.fromEntries(
        Object.entries(initialCart).map(([id, item]) => [id, { ...item, tipo: item.tipo || 'avista' }])
      )
    }
    return {}
  })
  const [search, setSearch] = useState('')
  const [prodPage, setProdPage] = useState(1)

  const filteredUsers = useMemo(() => {
    const t = userSearch.toLowerCase().trim()
    if (!t) return []
    return usuarios.filter(u =>
      u.nome?.toLowerCase().includes(t) ||
      u.telefone?.includes(t) ||
      (u.email || '').toLowerCase().includes(t)
    ).slice(0, 20)
  }, [usuarios, userSearch])

  useEffect(() => {
    if (preselectedUser) {
      pickUser(preselectedUser)
    }
  }, [])

  const pickUser = (u) => {
    setSelectedUser(u)
    setNome(u.nome || '')
    setTelefone(u.telefone || '')
    setCpf(u.endereco?.cpf || '')
    setEndereco(u.endereco || { cep: '', estado: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' })
    setUserSearch('')
    setShowNewForm(false)
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
    const t = search.toLowerCase().trim()
    return t ? produtos.filter(p => p.nome.toLowerCase().includes(t)) : produtos
  }, [produtos, search])

  const paginatedProds = useMemo(() => {
    const start = (prodPage - 1) * 10
    return filteredProds.slice(start, start + 10)
  }, [filteredProds, prodPage])

  const totalPages = Math.ceil(filteredProds.length / 10)
  useEffect(() => { setProdPage(1) }, [search])

  const cartItems = useMemo(() => Object.values(cart).filter(i => i.qty > 0), [cart])
  const cartTotal = useMemo(() => cartItems.reduce((s, i) => s + i.preco * i.qty, 0), [cartItems])

  const addItem = (p) => {
    setCart(prev => ({ ...prev, [p.id]: { id: p.id, nome: p.nome, preco: p.preco, preco_custo: p.preco_custo, imagem: p.imagem, qty: (prev[p.id]?.qty || 0) + 1, tipo: 'aprazo', semDevolucao: !!p.semDevolucao } }))
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
    const num = Number(String(val).replace(',', '.'))
    setCart(prev => prev[id] ? { ...prev, [id]: { ...prev[id], preco: isNaN(num) ? 0 : num } } : prev)
  }

  const setItemCusto = (id, val) => {
    const num = Number(String(val).replace(',', '.'))
    setCart(prev => prev[id] ? { ...prev, [id]: { ...prev[id], preco_custo: isNaN(num) ? 0 : num } } : prev)
  }

  const valorPagoNum = Number(String(valorPago).replace(',', '.')) || 0
  const troco = valorPagoNum - cartTotal

  const handleSave = () => {
    if (saving || cartItems.length === 0 || !nome.trim() || !telefone.trim() || !cpf.trim()) return
    setSaving(true)
    const isConcluido = orderStatus === 'entregue'
    onSave({
      nome: nome.trim(),
      telefone: normalizePhone(telefone),
      cpf: cpf.trim(),
      endereco,
      dataPedido,
      pagamento: pagamento === 'misto' ? 'misto' : (pagamento === 'aprazo' ? 'aprazo' : 'avista'),
      items: cartItems.map(i => ({ ...i, tipo: pagamento === 'aprazo' ? 'aprazo' : (pagamento === 'avista' ? 'avista' : i.tipo) })),
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
              { id: 'em-rota', label: 'Em Rota' },
              { id: 'entregue', label: 'Concluído' },
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
                      <i className="fa-solid fa-search"></i>
                      <input type="text" placeholder="Digite nome, telefone ou email..." value={userSearch} onChange={e => setUserSearch(e.target.value)} style={{ width: '100%' }} />
                    </div>
                    {filteredUsers.length > 0 && (
                      <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid var(--admin-border)', borderRadius: '8px', marginTop: '0.4rem' }}>
                        {filteredUsers.map(u => (
                          <div key={u.id} className="add-prod-row" style={{ cursor: 'pointer', padding: '0.5rem 0.7rem' }} onClick={() => pickUser(u)}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{u.nome}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-sec)' }}>{u.telefone} {u.email ? `· ${u.email}` : ''} {u.endereco?.cidade ? `· ${u.endereco.cidade}` : ''}</div>
                            </div>
                            <i className="fa-solid fa-chevron-right" style={{ color: 'var(--admin-text-sec)', fontSize: '0.75rem' }}></i>
                          </div>
                        ))}
                      </div>
                    )}
                    {userSearch && filteredUsers.length === 0 && (
                      <p style={{ fontSize: '0.82rem', color: 'var(--admin-text-sec)', marginTop: '0.4rem' }}>
                        Nenhum cliente encontrado. <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', marginLeft: '0.3rem' }} onClick={resetForm}><i className="fa-solid fa-plus"></i> Adicionar Novo</button>
                      </p>
                    )}
                    {!userSearch && (
                      <p style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)', marginTop: '0.5rem' }}>
                        Ou <button className="admin-btn" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={resetForm}><i className="fa-solid fa-plus"></i> Adicionar Novo Cliente</button>
                      </p>
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
                    <label>CPF *</label>
                    <input type="text" placeholder="000.000.000-00" value={cpf} onChange={e => setCpf(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Endereço</label>
                    <AddressForm value={endereco} onChange={(a) => setEndereco(a)} />
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
                    <label>CPF *</label>
                    <input type="text" placeholder="000.000.000-00" value={cpf} onChange={e => setCpf(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Endereço</label>
                    <AddressForm value={endereco} onChange={(a) => setEndereco(a)} />
                  </div>
                </div>
              )}

              <button className="admin-btn admin-btn-primary" disabled={!nome.trim() || !telefone.trim() || !cpf.trim()} onClick={() => setStep(2)} style={{ marginTop: '0.75rem' }}>
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
                  return (
                    <div key={p.id} className={`add-prod-row ${inCart ? 'in-cart' : ''}`}>
                      <div className="add-prod-info">
                        <span className="add-prod-name">{p.nome}</span>
                        <span className="add-prod-price">{formatPreco(p.preco)}</span>
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
                  {cartItems.map(i => (
                    <div key={i.id} className="add-prod-cart-item">
                      <span className="add-prod-cart-name">{i.nome} ({i.qty}x)</span>
                      <div className="add-prod-cart-fields">
                        <label>Preço (R$)
                          <input type="number" step="0.01" min="0" value={i.preco} onChange={e => setItemPreco(i.id, e.target.value)} onClick={e => e.stopPropagation()} />
                        </label>
                        <label>Custo (R$)
                          <input type="number" step="0.01" min="0" value={i.preco_custo ?? ''} placeholder="0" onChange={e => setItemCusto(i.id, e.target.value)} onClick={e => e.stopPropagation()} />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {cartItems.length > 0 && (
                <div className="add-prod-summary">
                  <span>{cartItems.length} itens adicionados</span>
                  <span>Total: <strong>{formatPreco(cartTotal)}</strong></span>
                </div>
              )}

              <div className="modal-actions">
                <button className="admin-btn admin-btn-sec" onClick={() => setStep(1)}><i className="fa-solid fa-arrow-left"></i> Voltar</button>
                <button className="admin-btn admin-btn-primary" disabled={cartItems.length === 0} onClick={() => setStep(3)}>
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
                      <input type="number" step="0.01" min="0" placeholder={String(cartTotal.toFixed(2)).replace('.', ',')} value={valorPago} onChange={e => setValorPago(e.target.value)} />
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
function OrderDetailModal({ order, financial, produtos, onClose, onStatusChange, onUpdateDue, onPreApprovar, onEditAndConfirm, onEditSave, onOpenDelivery, onUpdateCustomer, onCancelOrder }) {
  const [rejectedItems, setRejectedItems] = useState(new Set())
  const [editMode, setEditMode] = useState(false)
  const [editedItems, setEditedItems] = useState(order.items.map(i => ({ ...i })))
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
  const [editCustomer, setEditCustomer] = useState({
    nome: order.customer?.nome || '',
    email: order.customer?.email || '',
    telefone: order.customer?.telefone || '',
    cpf: order.customer?.cpf || '',
    endereco: { ...(order.customer?.endereco || {}) }
  })

  const toggleReject = (idx) => {
    setRejectedItems(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx); else next.add(idx)
      return next
    })
  }

  const changeQty = (idx, delta) => {
    setEditedItems(prev => prev.map((item, i) => i === idx ? { ...item, qty: Math.max(0, item.qty + delta) } : item))
  }

  const removeItem = (idx) => {
    setEditedItems(prev => prev.filter((_, i) => i !== idx))
  }

  const addItemToEdit = (p) => {
    setAddCart(prev => ({
      ...prev,
      [p.id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, tipo: 'aprazo', qty: (prev[p.id]?.qty || 0) + 1, semDevolucao: !!p.semDevolucao }
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
    const newItems = Object.values(addCart).filter(i => i.qty > 0)
    if (newItems.length === 0) return
    setEditedItems(prev => [...prev, ...newItems])
    setAddCart({})
    setAddSearch('')
  }

  const handleEditConfirm = () => {
    const validItems = editedItems.filter(i => i.qty > 0)
    if (validItems.length === 0) { return }
    onEditAndConfirm(validItems, order.status)
  }

  const handleEditSave = () => {
    const validItems = editedItems.filter(i => i.qty > 0)
    if (validItems.length === 0) { return }
    onEditSave(validItems)
  }

  const editTotal = editedItems.filter(i => i.qty > 0).reduce((s, i) => s + i.preco * i.qty, 0)

  const filteredAddProds = useMemo(() => {
    const t = addSearch.toLowerCase().trim()
    if (!t) return []
    return produtos.filter(p => p.nome.toLowerCase().includes(t)).slice(0, 10)
  }, [produtos, addSearch])

  const filteredPreAddProds = useMemo(() => {
    const t = preAddSearch.toLowerCase().trim()
    if (!t) return []
    return produtos.filter(p => p.nome.toLowerCase().includes(t)).slice(0, 10)
  }, [produtos, preAddSearch])

  const addToPreReplacement = (p) => {
    setPreAddCart(prev => ({
      ...prev,
      [p.id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, tipo: 'aprazo', qty: (prev[p.id]?.qty || 0) + 1 }
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
    const newItems = Object.values(preAddCart).filter(i => i.qty > 0)
    if (newItems.length === 0) return
    setPreReplacements(prev => [...prev, ...newItems])
    setPreAddCart({})
    setPreAddSearch('')
  }

  if (editMode) {
    return (
      <div className="admin-overlay" onClick={() => { setEditMode(false); setEditedItems(order.items.map(i => ({ ...i }))); setAddCart({}) }}>
        <div className="admin-modal admin-modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: '550px' }}>
          <div className="admin-modal-header">
            <h3><i className="fa-solid fa-pen"></i> Editar Itens — Pedido #{order.id.toString().slice(-6)}</h3>
            <button className="admin-modal-close" onClick={() => { setEditMode(false); setEditedItems(order.items.map(i => ({ ...i }))); setAddCart({}) }}><i className="fa-solid fa-xmark"></i></button>
          </div>
          <div className="admin-modal-body">
            <div className="detail-section">
              <h4>Itens do Pedido</h4>
              {editedItems.map((i, idx) => (
                <div key={idx} className="detail-item" style={{ opacity: i.qty <= 0 ? 0.4 : 1 }}>
                  <div style={{ flex: 1 }}>
                    <span className="detail-item-name" style={{ textDecoration: i.qty <= 0 ? 'line-through' : 'none' }}>{i.displayName || i.nome || 'Produto'}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.15rem' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--admin-text-sec)' }}>Preço:</span>
                      <input type="number" step="0.01" min="0" value={i.preco}
                        onChange={e => {
                          const val = parseFloat(e.target.value)
                          if (!isNaN(val) && val >= 0) {
                            setEditedItems(prev => prev.map((item, ii) => ii === idx ? { ...item, preco: val } : item))
                          }
                        }}
                        style={{ width: '80px', padding: '0.2rem 0.35rem', borderRadius: '6px', border: '1px solid var(--admin-border)', fontSize: '0.82rem', textAlign: 'right' }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <span className={`split-badge ${i.tipo === 'avista' ? 'vista' : 'aprazo'}`}>
                      {i.tipo === 'avista' ? 'À Vista' : 'A Prazo'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px', border: '1px solid var(--admin-border)', borderRadius: '6px', padding: '2px' }}>
                      <button className="qty-btn-sm" onClick={() => changeQty(idx, -1)}><i className="fa-solid fa-minus"></i></button>
                      <span style={{ minWidth: '20px', textAlign: 'center', fontSize: '0.82rem', fontWeight: 600 }}>{i.qty}</span>
                      <button className="qty-btn-sm" onClick={() => changeQty(idx, 1)}><i className="fa-solid fa-plus"></i></button>
                    </div>
                    <button className="action-btn action-delete" title="Remover" onClick={() => removeItem(idx)}><i className="fa-solid fa-trash"></i></button>
                  </div>
                </div>
              ))}
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
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Total: <strong style={{ color: 'var(--accent)', fontSize: '1.1rem' }}>{formatPreco(editTotal)}</strong></span>
                <span style={{ fontSize: '0.78rem', color: 'var(--admin-text-sec)' }}>{editedItems.filter(i => i.qty > 0).length} itens</span>
              </div>
            </div>

            <div className="modal-actions">
              <button className="admin-btn admin-btn-sec" onClick={() => { setEditMode(false); setEditedItems(order.items.map(i => ({ ...i }))); setAddCart({}) }}>Cancelar</button>
              <button className="admin-btn" style={{ background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }} disabled={editedItems.filter(i => i.qty > 0).length === 0} onClick={handleEditSave}>
                <i className="fa-solid fa-save"></i> Salvar
              </button>
              <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} disabled={editedItems.filter(i => i.qty > 0).length === 0} onClick={handleEditConfirm}>
                <i className="fa-solid fa-check"></i> {order.status === 'em-rota' ? 'Salvar e Finalizar Entrega' : 'Salvar e Enviar para Rota'}
              </button>
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
          <h3><i className="fa-solid fa-receipt"></i> Pedido #{order.id.toString().slice(-6)}</h3>
          <button className="admin-modal-close" onClick={onClose}><i className="fa-solid fa-xmark"></i></button>
        </div>
        <div className="admin-modal-body">
          <div className="detail-section">
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                Cliente
                {!customerEdit && order.status !== 'entregue' && order.status !== 'cancelado' && (
                  <button className="action-btn" title="Editar dados do cliente" onClick={() => setCustomerEdit(true)} style={{ color: '#2563eb', fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}>
                    <i className="fa-solid fa-pencil"></i>
                  </button>
                )}
              </h4>
            {customerEdit ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
            <h4>Itens</h4>
            {order.items.map((i, idx) => {
              const isRejected = rejectedItems.has(idx)
              return (
                <div key={idx} className="detail-item" style={{ opacity: isRejected ? 0.5 : 1 }}>
                  <div>
                    <span className="detail-item-name" style={{ textDecoration: isRejected ? 'line-through' : 'none' }}>{i.nome}</span>
                    <span className="detail-item-qty">{i.qty}x {formatPreco(i.preco)}</span>
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
                  {order.items[idx].nome} ({order.items[idx].qty}x)
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
                          <button className="add-prod-add" style={{ fontSize: '0.7rem', padding: '0.25rem 0.5rem' }} onClick={() => { setPreAddCart({ [p.id]: { id: p.id, nome: p.nome, preco: p.preco, imagem: p.imagem, tipo: 'aprazo', qty: 1, semDevolucao: !!p.semDevolucao } }) }}>
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
                  <i className="fa-solid fa-check"></i> Adicionar ao pedido
                </button>
              )}
              {preReplacements.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <p style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--success)', marginBottom: '0.25rem' }}>Produtos substitutos adicionados:</p>
                  {preReplacements.map((r, i) => (
                    <p key={i} style={{ fontSize: '0.8rem', color: 'var(--admin-text)', marginBottom: '0.15rem' }}>
                      {r.nome} ({r.qty}x) — {formatPreco(r.preco * r.qty)}
                    </p>
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
                const kept = order.items.filter((_, i) => !rejectedSet.has(i))
                const all = [...kept, ...preReplacements]
                const av = all.filter(i => i.tipo === 'avista').reduce((s, i) => s + i.preco * i.qty, 0)
                const ap = all.filter(i => i.tipo === 'aprazo').reduce((s, i) => s + i.preco * i.qty, 0)
                return (
                  <>
                    <span style={{ color: 'var(--danger)' }}>Itens recusados: {rejectedItems.size}</span>
                    <span>Substitutos: {preReplacements.length} itens</span>
                    <span>Total <strong style={{ color: 'var(--accent)' }}>{formatPreco(av + ap)}</strong></span>
                    {ap > 0 && <span>📋 A prazo: <strong style={{ color: 'var(--warning)' }}>{formatPreco(ap)}</strong></span>}
                  </>
                )
              })()}
              {order.status !== 'pre-pedido' && (
                <span>Total: <strong>{formatPreco(order.total)}</strong></span>
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

          <div className="modal-actions">
            {(order.status === 'pendente' || order.status === 'em-rota') && (
              <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }}
                onClick={() => { setEditMode(true); setEditedItems(order.items.map(i => ({ ...i }))) }}>
                <i className="fa-solid fa-pen"></i> Editar Itens
              </button>
            )}
            {order.status === 'pendente' && (
              <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} onClick={() => onStatusChange('pre-pedido')}>
                <i className="fa-solid fa-undo"></i> Voltar para Pré-Pedido
              </button>
            )}
            {order.status === 'em-rota' && (
              <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} onClick={() => onStatusChange('pendente')}>
                <i className="fa-solid fa-undo"></i> Voltar para Pendente
              </button>
            )}
            {order.status === 'entregue' && (
              <button className="admin-btn" style={{ background: '#f59e0b', color: 'white', borderColor: '#f59e0b' }} onClick={() => onStatusChange('em-rota')}>
                <i className="fa-solid fa-undo"></i> Voltar para Em Rota
              </button>
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
              <button className="admin-btn" style={{ background: 'var(--success)', color: 'white', borderColor: 'var(--success)' }} onClick={onClose}>
                <i className="fa-solid fa-check-double"></i> Concluir
              </button>
            )}
            {order.status !== 'entregue' && order.status !== 'cancelado' && (
              <button className="admin-btn" style={{ background: 'var(--danger)', color: 'white', borderColor: 'var(--danger)' }} onClick={() => { if (confirm('Tem certeza que deseja cancelar esta comanda?')) { onCancelOrder?.(order.id) } }}>
                <i className="fa-solid fa-ban"></i> Cancelar Comanda
              </button>
            )}
            <button className="admin-btn admin-btn-sec" onClick={onClose}>Fechar</button>
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
    const q = search.toLowerCase().trim()
    return q ? produtos.filter(p => p.nome.toLowerCase().includes(q) || (p.categoria || '').toLowerCase().includes(q)) : produtos
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
  const [preco, setPreco] = useState(String(product.preco))
  const [precoCusto, setPrecoCusto] = useState(String(product.preco_custo ?? ''))
  const [estoque, setEstoque] = useState(String(product.estoque))
  const [imagem, setImagem] = useState(product.imagem || '')
  const [categoria, setCategoria] = useState(product.categoria)
  const [descricao, setDescricao] = useState(product.descricao || '')
  const [variantes, setVariantes] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('thsm_prod_variants') || '{}')
      return saved[product.id] || product.variantes || {}
    } catch { return product.variantes || {} }
  })
  const [semDevolucao, setSemDevolucao] = useState(!!product.semDevolucao)
  const [newVarTypeName, setNewVarTypeName] = useState('')

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      if (typeof reader.result === 'string') setImagem(reader.result)
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
    if (!nome.trim() || preco === '' || isNaN(Number(preco))) return
    const cleaned = {}
    Object.entries(variantes).forEach(([k, v]) => {
      const opts = v.filter(o => o.trim())
      if (opts.length > 0) cleaned[k] = opts
    })
    try {
      const all = JSON.parse(localStorage.getItem('thsm_prod_variants') || '{}')
      if (Object.keys(cleaned).length > 0) all[product.id] = cleaned
      else delete all[product.id]
      localStorage.setItem('thsm_prod_variants', JSON.stringify(all))
    } catch {}
    onSave({ nome: nome.trim(), preco: Number(preco), preco_custo: precoCusto === '' ? null : Number(precoCusto), estoque: Number(estoque), imagem, categoria, descricao, variantes: cleaned, semDevolucao })
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
            <label>Nome do produto <span style={{color:'var(--danger)'}}>*</span></label>
            <input type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Camiseta Masculina" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Preço (R$) <span style={{color:'var(--danger)'}}>*</span></label>
              <input type="number" step="0.01" min="0" value={preco} onChange={e => setPreco(e.target.value)} placeholder="0,00" />
            </div>
            <div className="form-group">
              <label>Preço de Custo (R$)</label>
              <input type="number" step="0.01" min="0" value={precoCusto} onChange={e => setPrecoCusto(e.target.value)} placeholder="0,00" />
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
  const [value, setValue] = useState(despesa ? String(despesa.value) : '')
  const [dueDate, setDueDate] = useState(despesa?.dueDate || hoje())
  const [paymentMethod, setPaymentMethod] = useState(despesa?.paymentMethod || 'pix')
  const [status, setStatus] = useState(despesa?.status || 'pendente')

  const tiposDisponiveis = useMemo(() => {
    const merged = [...new Set([...DESPESA_TIPOS, ...customTipos])]
    if (tipo && !merged.includes(tipo)) merged.push(tipo)
    return merged
  }, [customTipos, tipo])

  const handleSave = () => {
    const val = Number(value)
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
              <input type="number" step="0.01" min="0" value={value} onChange={e => setValue(e.target.value)} placeholder="0,00" />
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
