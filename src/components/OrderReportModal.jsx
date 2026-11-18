import React, { useState, useMemo } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { clientMatchesSearch, isCityOrGeneric } from '../lib/search'
import { getOrderPaymentDate, getOrderDueDate } from '../lib/orderPaymentDate'
import './OrderReportModal.css'

export { getOrderPaymentDate, getOrderDueDate }

export const STATUS_CONFIG = {
  'pre-pedido': { label: 'Pré-Pedido', color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
  'pendente': { label: 'Pendente', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  'confirmado': { label: 'Confirmado', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
  'em-andamento': { label: 'Em Andamento', color: '#4f46e5', bg: '#eef2ff', border: '#c7d2fe' },
  'em-rota': { label: 'Em Rota', color: '#0284c7', bg: '#f0f9ff', border: '#bae6fd' },
  'entregue': { label: 'Entregue (Praça)', color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
  'acerto': { label: 'Acerto (Motoristas)', color: '#9333ea', bg: '#faf5ff', border: '#e9d5ff' },
  'concluido': { label: 'Concluído (Pago)', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  'calote_parcial': { label: 'Calote Parcial', color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
  'calote': { label: 'Calote 100%', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  'cancelado': { label: 'Cancelado', color: '#64748b', bg: '#f8fafc', border: '#cbd5e1' }
}

// Limpa nome de produto removendo prefixos de quantidade embutidos e sufixos repetitivos
export function cleanProductName(nome) {
  if (!nome) return ''
  return String(nome)
    .replace(/\s*-\s*sem\s*devolu[cç][aã]o/gi, '')
    .replace(/\s*\[sem\s*devolu[cç][aã]o\]/gi, '')
    .replace(/\s*\(sem\s*devolu[cç][aã]o\)/gi, '')
    .replace(/^\d+\s*[xX]?\s+/, '')
    .trim()
}

// Classificador oficial THSM para pedidos zerados (Devolução Total vs Brinde)
export function getOrderZeroClassification(o) {
  if (!o) return null
  if (o.isBrinde || o.is_brinde || o.tipo_zerado === 'brinde' || o.motivo_zerado === 'brinde' || o.motivo_zerado === 'Brinde') {
    return { type: 'brinde', label: 'Brinde', motivo: o.motivo_brinde || 'Brinde institucional' }
  }
  if (o.isDevolucaoTotal || o.is_devolucao_total || o.tipo_zerado === 'devolucao_total' || o.motivo_zerado === 'devolucao_total' || o.motivo_zerado === 'Devolução total') {
    return { type: 'devolucao_total', label: 'Devolução total', motivo: 'Devolução total' }
  }

  const tel = String(o.customer?.telefone || o.telefone || '').replace(/\D/g, '')
  const nome = (o.customer?.nome || o.cliente || o.nome || '').toLowerCase().trim()
  const obs = (o.observacoes || o.obs || '').toLowerCase()

  if (tel.includes('553298606010') || tel.includes('3298606010') || nome.includes('thales') || nome.includes('brinde') || obs.includes('brinde')) {
    return { type: 'brinde', label: 'Brinde', motivo: o.motivo_brinde || 'Brinde institucional' }
  }

  const targetDevPhones = [
    '5514991814227', '5514997576133', '5519999000609', '5516981630468',
    '5514997612794', '5514998713479', '5532991388848', '5532998446843',
    '5532999988609', '553298438631'
  ]
  if (targetDevPhones.some(p => tel.includes(p.slice(-8)))) {
    return { type: 'devolucao_total', label: 'Devolução total', motivo: 'Devolução total' }
  }
  const targetDevNames = [
    'larissa vitória', 'lúcia helena', 'eliana da silva', 'lavinia de sousa',
    'sonia goes', 'lissania lopes', 'crislaine oliveira', 'alessandra da costa',
    'jessica de almeida', 'danielle neves'
  ]
  if (targetDevNames.some(n => nome.includes(n))) {
    return { type: 'devolucao_total', label: 'Devolução total', motivo: 'Devolução total' }
  }

  const tot = Number(o.total || o.total_liquido || o.totalLiquido || o.totalAcerto || 0)
  if (tot === 0 && (o.status === 'concluido' || o.isFinalizado)) {
    return { type: 'devolucao_total', label: 'Devolução total', motivo: 'Devolução total' }
  }

  return null
}

// Helper financeiro oficial THSM por comanda
export function getOrderFinancialDetails(o) {
  const isTest = Boolean(o?.isTest || o?.is_test || (o?.customer?.nome && o.customer.nome.toLowerCase().includes('teste')))
  const zeroClass = getOrderZeroClassification(o)

  if (zeroClass) {
    return {
      isTest,
      isZero: true,
      zeroType: zeroClass.type,
      valorItens: 0,
      desconto: 0,
      totalLiquido: 0,
      motivoDesconto: 'Sem desconto',
      motivoZerado: zeroClass.label,
      totalPago: 0,
      saldoEmAberto: 0
    }
  }

  let valorItens = 0
  if (o?.valor_itens !== undefined && Number(o.valor_itens) > 0) {
    valorItens = Number(o.valor_itens)
  } else {
    const items = (Array.isArray(o?.items) && o.items.length > 0)
      ? o.items
      : (Array.isArray(o?.originalItems) && o.originalItems.length > 0 ? o.originalItems : [])
    valorItens = items.reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0)
  }
  valorItens = Math.round(valorItens * 100) / 100

  let totalLiquido = 0
  if (o?.total_liquido !== undefined && Number(o.total_liquido) >= 0) {
    totalLiquido = Number(o.total_liquido)
  } else if (o?.total !== undefined && Number(o.total) >= 0) {
    totalLiquido = Number(o.total)
  } else if (o?.totalAcerto !== undefined && Number(o.totalAcerto) >= 0) {
    totalLiquido = Number(o.totalAcerto)
  } else {
    totalLiquido = valorItens
  }
  totalLiquido = Math.round(totalLiquido * 100) / 100

  let desconto = 0
  if (o?.desconto !== undefined && Number(o.desconto) >= 0) {
    desconto = Number(o.desconto)
  } else if (valorItens > 0 && totalLiquido < valorItens) {
    desconto = Math.max(0, Math.round((valorItens - totalLiquido) * 100) / 100)
  } else if (o?.descontoPercent) {
    desconto = Math.round(((Number(o.descontoPercent) / 100) * valorItens) * 100) / 100
  }
  desconto = Math.round(desconto * 100) / 100

  if (valorItens > 0 && totalLiquido === 0 && desconto === 0) {
    totalLiquido = valorItens
  } else if (valorItens > 0 && desconto > 0 && Math.abs((valorItens - desconto) - totalLiquido) > 0.05) {
    totalLiquido = Math.max(0, Math.round((valorItens - desconto) * 100) / 100)
  }

  let motivoDesconto = o?.motivo_desconto || ''
  if (!motivoDesconto) {
    if (desconto > 0) {
      const pctCalc = Math.round((desconto / (valorItens || 1)) * 100)
      if (Number(o?.descontoPercent) === 30 || pctCalc === 30) {
        motivoDesconto = 'Desconto revendedora (30%)'
      } else if (o?.cupom) {
        motivoDesconto = `Cupom (${o.cupom})`
      } else if (o?.descontoPercent) {
        motivoDesconto = `Desconto percentual (${o.descontoPercent}%)`
      } else {
        motivoDesconto = 'Ajuste manual (R$)'
      }
    } else {
      motivoDesconto = 'Sem desconto'
    }
  }

  const totalPago = Number(o?.total_pago !== undefined ? o.total_pago : (o?.totalPago || (o?.status === 'concluido' ? totalLiquido : 0)))
  const saldoEmAberto = Number(o?.saldo_em_aberto !== undefined ? o.saldo_em_aberto : (o?.valorEmAberto || Math.max(0, totalLiquido - totalPago)))

  return {
    isTest,
    isZero: false,
    zeroType: null,
    valorItens,
    desconto,
    totalLiquido,
    motivoDesconto,
    motivoZerado: '-',
    totalPago: Math.round(totalPago * 100) / 100,
    saldoEmAberto: Math.round(saldoEmAberto * 100) / 100
  }
}

export function formatCurrency(val) {
  return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatDateBR(dateStr) {
  if (!dateStr) return '-'
  try {
    const parts = String(dateStr).split('T')[0].split('-')
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`
    return new Date(dateStr).toLocaleDateString('pt-BR')
  } catch {
    return dateStr
  }
}

const norm = (v) => (v || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '')
const isNoDevName = (nome) => {
  return norm(nome).includes('semdevolu') || norm(nome).includes('sem-devolu') || norm(nome).includes('sem devolu') || norm(nome).includes('s/devolu')
}

export function getItemCost(item, produtos = []) {
  if (item?.preco_custo != null && Number(item.preco_custo) > 0) return Number(item.preco_custo)
  if (item?.custo_unitario_pedido != null && Number(item.custo_unitario_pedido) > 0) return Number(item.custo_unitario_pedido)
  const p = produtos.find(prod => prod && (prod.id === item?.id || String(prod.id) === String(item?.id) || norm(prod.nome) === norm(item?.nome)))
  return Number(p?.preco_custo || p?.custo || p?.cost || 0)
}

export function checkItemSemDevolucao(item, produtos = []) {
  if (item?.semDevolucao === true || item?.semDevolucao === 1) return true
  const p = produtos.find(prod => prod.id === item?.id || String(prod.id) === String(item?.id) || norm(prod.nome) === norm(item?.nome))
  if (p?.semDevolucao) return true
  return isNoDevName(item?.nome)
}

export function formatFullAddress(endereco) {
  if (!endereco) return '-'
  if (typeof endereco === 'string') return endereco.trim() || '-'
  const parts = []
  const ruaNum = [endereco.rua || endereco.logradouro, endereco.numero ? `nº ${endereco.numero}` : ''].filter(Boolean).join(', ')
  if (ruaNum) parts.push(ruaNum)
  if (endereco.complemento) parts.push(endereco.complemento)
  if (endereco.bairro) parts.push(endereco.bairro)
  const cidUf = [endereco.cidade, endereco.estado || endereco.uf].filter(Boolean).join('/')
  if (cidUf) parts.push(cidUf)
  if (endereco.cep) parts.push(`CEP: ${endereco.cep}`)
  if (endereco.pontoReferencia) parts.push(`Ref: ${endereco.pontoReferencia}`)
  return parts.length > 0 ? parts.join(' - ') : '-'
}

export function getOrderDevolucaoStats(order, produtos = []) {
  let qtdTotal = 0
  let qtdSemDev = 0
  let qtdComDev = 0
  let totalSemDev = 0
  let totalComDev = 0

  const items = (Array.isArray(order.items) && order.items.length > 0)
    ? order.items
    : (Array.isArray(order.originalItems) && order.originalItems.length > 0 ? order.originalItems : [])

  items.forEach(i => {
    const qty = Number(i.qty) || 1
    const preco = Number(i.preco) || 0
    const subtotal = Math.round(preco * qty * 100) / 100
    qtdTotal += qty

    if (checkItemSemDevolucao(i, produtos)) {
      qtdSemDev += qty
      totalSemDev += subtotal
    } else {
      qtdComDev += qty
      totalComDev += subtotal
    }
  })

  totalSemDev = Math.round(totalSemDev * 100) / 100
  totalComDev = Math.round(totalComDev * 100) / 100
  const totalBruto = Math.round((totalSemDev + totalComDev) * 100) / 100

  return {
    qtdTotal,
    qtdSemDev,
    qtdComDev,
    totalSemDev,
    totalComDev,
    totalBruto,
    hasSemDev: qtdSemDev > 0,
    hasComDev: qtdComDev > 0
  }
}

// Mecanismo confiável de impressão via iframe oculto (imune ao bloqueio de popups no Safari/iPad/Chrome)
function printReportViaIframe(htmlContent) {
  try {
    let iframe = document.getElementById('thsm-report-print-iframe')
    if (iframe) {
      document.body.removeChild(iframe)
    }
    iframe = document.createElement('iframe')
    iframe.id = 'thsm-report-print-iframe'
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    iframe.style.opacity = '0'
    iframe.style.pointerEvents = 'none'
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow.document
    doc.open()
    doc.write(htmlContent)
    doc.close()

    setTimeout(() => {
      try {
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
      } catch (err) {
        console.warn('Iframe print fallthrough to window.open', err)
        fallbackPrintWindow(htmlContent)
      }
    }, 400)
  } catch (err) {
    console.warn('Iframe print error, falling back', err)
    fallbackPrintWindow(htmlContent)
  }
}

function fallbackPrintWindow(htmlContent) {
  const win = window.open('', '_blank', 'width=1200,height=800')
  if (!win) {
    alert('Pop-up bloqueado pelo navegador. Por favor, autorize pop-ups ou utilize o botão "Baixar PDF" para obter o arquivo diretamente.')
    return
  }
  win.document.open()
  win.document.write(htmlContent)
  win.document.close()
  setTimeout(() => {
    try {
      win.focus()
      win.print()
    } catch (e) {
      console.error(e)
    }
  }, 400)
}

export default function OrderReportModal({
  isOpen,
  onClose,
  orders = [],
  financial = [],
  produtos = [],
  filteredOrdersFromScreen = [],
  selectedOrderIds = new Set(),
  usuarios = [],
  rotas = [],
  isFinalizada = () => false,
  showToast = () => {}
}) {
  const hasSelected = selectedOrderIds && selectedOrderIds.size > 0
  const [scope, setScope] = useState(hasSelected ? 'selecionados' : 'todos')

  // Filtros personalizados
  const [selectedStatuses, setSelectedStatuses] = useState(() => Object.keys(STATUS_CONFIG))
  const [financialStatus, setFinancialStatus] = useState('todos') // 'todos', 'aberto', 'pago', 'zerados'
  const [selectedPayment, setSelectedPayment] = useState('TODOS')
  const [selectedCity, setSelectedCity] = useState('TODAS')
  const [selectedRoute, setSelectedRoute] = useState('TODAS')
  const [selectedClientPhone, setSelectedClientPhone] = useState('TODOS')
  const [clientSearch, setClientSearch] = useState('')
  const [devolucaoFilter, setDevolucaoFilter] = useState('todos')
  const [excludeTests, setExcludeTests] = useState(true)

  // Filtros de Data
  const [dateType, setDateType] = useState('vencimento') // 'vencimento', 'date', 'pagamento'
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Opções de saída
  const [includePrices, setIncludePrices] = useState(true)
  const [multilineItems, setMultilineItems] = useState(true)
  const [showPreviewTable, setShowPreviewTable] = useState(false)
  const [activeTab, setActiveTab] = useState('filtros') // 'filtros', 'kpis'

  // Cidades e Rotas únicas
  const cidadesUnicas = useMemo(() => {
    const set = new Set()
    orders.forEach(o => {
      const c = o.customer?.endereco?.cidade
      if (c) set.add(c.trim())
    })
    return ['TODAS', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [orders])

  const rotasUnicas = useMemo(() => {
    const set = new Set()
    rotas.forEach(r => { if (r.rota && !isCityOrGeneric(r.rota, cidadesUnicas)) set.add(r.rota.trim()) })
    orders.forEach(o => {
      const r = o.customer?.endereco?.rota
      if (r && !isCityOrGeneric(r, cidadesUnicas)) set.add(r.trim())
    })
    return ['TODAS', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [rotas, orders, cidadesUnicas])

  // Normalização de status
  const getResolvedStatus = (o) => {
    if (o.isCalote || o.status === 'calote' || o.motivoEncerramento === 'calote_100') return 'calote'
    if (o.status === 'calote_parcial' || o.status === 'parcial' || (Boolean(o.isFinalizado) && Number(o.valorEmAberto) > 0 && Number(o.totalPago) > 0)) return 'calote_parcial'
    if (o.status === 'concluido' || (isFinalizada(o) && !o.isCalote && o.status !== 'calote')) return 'concluido'
    if (o.status === 'acerto') return 'acerto'
    if (o.status === 'entregue') return 'entregue'
    return o.status || 'pendente'
  }

  // Contagem dinâmica de status de acordo com o escopo base
  const statusCounts = useMemo(() => {
    const baseList = scope === 'selecionados'
      ? orders.filter(o => selectedOrderIds && selectedOrderIds.has(String(o.id)))
      : scope === 'tela'
        ? (filteredOrdersFromScreen || [])
        : (orders || [])

    const counts = {}
    Object.keys(STATUS_CONFIG).forEach(s => { counts[s] = 0 })

    baseList.forEach(o => {
      if (excludeTests) {
        if (o?.isTest || o?.is_test) return
        const nome = (o?.customer?.nome || o?.cliente || o?.nome || '').toLowerCase().trim()
        if (nome.includes('teste') || nome === 'usuário' || nome === 'usuario') return
      }
      const st = getResolvedStatus(o)
      if (counts[st] !== undefined) counts[st] += 1
      else counts[st] = 1
    })

    return counts
  }, [orders, scope, selectedOrderIds, filteredOrdersFromScreen, excludeTests])

  // Filtragem e deduplicação de pedidos
  const targetOrders = useMemo(() => {
    let list = []
    if (scope === 'selecionados') {
      const selSet = new Set([...selectedOrderIds].map(String))
      list = orders.filter(o => selSet.has(String(o.id)))
    } else if (scope === 'tela') {
      list = filteredOrdersFromScreen || []
    } else if (scope === 'todos') {
      list = orders || []
    } else {
      // Escopo 'custom'
      list = orders.filter(o => {
        const resolvedStatus = getResolvedStatus(o)

        // 1. Status
        if (selectedStatuses.length > 0 && !selectedStatuses.includes(resolvedStatus)) {
          return false
        }

        // 2. Situação Financeira (Saldo em aberto, Quitado ou Zerados)
        if (financialStatus !== 'todos') {
          const fin = getOrderFinancialDetails(o)
          if (financialStatus === 'aberto' && fin.saldoEmAberto <= 0) return false
          if (financialStatus === 'pago' && (fin.saldoEmAberto > 0 || fin.totalLiquido <= 0)) return false
          if (financialStatus === 'zerados' && !fin.isZero) return false
        }

        // 3. Cliente
        if (selectedClientPhone !== 'TODOS') {
          const orderPhone = (o.customer?.telefone || '').replace(/\D/g, '')
          const targetPhone = selectedClientPhone.replace(/\D/g, '')
          if (!orderPhone.includes(targetPhone) && o.user_id !== selectedClientPhone) {
            return false
          }
        }

        // 4. Cidade
        if (selectedCity !== 'TODAS') {
          const c = o.customer?.endereco?.cidade || ''
          if (c.toLowerCase() !== selectedCity.toLowerCase()) return false
        }

        // 5. Rota
        if (selectedRoute !== 'TODAS') {
          const r = o.customer?.endereco?.rota || ''
          if (r.toLowerCase() !== selectedRoute.toLowerCase()) return false
        }

        // 6. Forma de Pagamento
        if (selectedPayment !== 'TODOS') {
          const pagModality = (o.pagamento || '').toLowerCase()
          const pMethod = (o.paymentMethod || o.payment?.method || '').toLowerCase()
          const splits = o.paymentSplits || {}

          if (selectedPayment === 'avista') {
            if (pagModality !== 'avista') return false
          } else if (selectedPayment === 'aprazo') {
            if (pagModality !== 'aprazo') return false
          } else if (selectedPayment === 'misto') {
            if (pagModality !== 'misto') return false
          } else if (selectedPayment === 'pix') {
            const hasPix = pMethod === 'pix' || Number(splits.pix) > 0
            if (!hasPix) return false
          } else if (selectedPayment === 'dinheiro') {
            const hasDin = pMethod === 'dinheiro' || Number(splits.dinheiro) > 0
            if (!hasDin) return false
          } else if (selectedPayment === 'cartao') {
            const hasCard = pMethod.includes('cartao') || Number(splits.cartao) > 0 || Number(splits.cartao_credito) > 0 || Number(splits.cartao_debito) > 0
            if (!hasCard) return false
          } else {
            if (pagModality !== selectedPayment && pMethod !== selectedPayment) return false
          }
        }

        // 7. Intervalo de Datas
        const rawDate = dateType === 'pagamento'
          ? getOrderPaymentDate(o)
          : dateType === 'date'
            ? (o.date || o.createdAt || o.dataInicio || o.created_at || '')
            : getOrderDueDate(o, financial)
        const orderDateOnly = rawDate ? String(rawDate).split('T')[0].split(' ')[0] : ''
        if (startDate && orderDateOnly && orderDateOnly < startDate) return false
        if (endDate && orderDateOnly && orderDateOnly > endDate) return false

        return true
      })
    }

    // Exclusão de testes
    if (excludeTests) {
      list = list.filter(o => {
        if (!o) return false
        if (o?.isTest || o?.is_test) return false
        const nome = (o?.customer?.nome || o?.cliente || o?.nome || '').toLowerCase().trim()
        if (nome.includes('teste') || nome === 'usuário' || nome === 'usuario') return false
        return true
      })
    }

    // Deduplicação estrita de pedidos por ID
    const seenIds = new Set()
    list = list.filter(o => {
      if (!o || !o.id) return false
      const idStr = String(o.id)
      if (seenIds.has(idStr)) return false
      seenIds.add(idStr)
      return true
    })

    // Filtro de Devolução (Sem / Com Devolução)
    if (devolucaoFilter === 'sem_dev') {
      list = list.map(o => {
        const rawItems = o.items || []
        const semDevItems = rawItems.filter(i => checkItemSemDevolucao(i, produtos))
        if (semDevItems.length === 0) return null

        const subtotalSemDev = Math.round(semDevItems.reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 1), 0) * 100) / 100
        return {
          ...o,
          _rawItems: rawItems,
          items: semDevItems,
          valor_itens: subtotalSemDev,
          total: subtotalSemDev,
          total_liquido: subtotalSemDev,
          totalAcerto: subtotalSemDev,
          totalPago: o.status === 'concluido' ? subtotalSemDev : (Number(o.totalPago) > subtotalSemDev ? subtotalSemDev : Number(o.totalPago || 0)),
          isFilteredByDev: true
        }
      }).filter(Boolean)
    } else if (devolucaoFilter === 'apenas_com_dev') {
      list = list.map(o => {
        const rawItems = o.items || []
        const comDevItems = rawItems.filter(i => !checkItemSemDevolucao(i, produtos))
        if (comDevItems.length === 0) return null

        const subtotalComDev = Math.round(comDevItems.reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 1), 0) * 100) / 100
        return {
          ...o,
          _rawItems: rawItems,
          items: comDevItems,
          valor_itens: subtotalComDev,
          total: subtotalComDev,
          total_liquido: subtotalComDev,
          totalAcerto: subtotalComDev,
          totalPago: o.status === 'concluido' ? subtotalComDev : (Number(o.totalPago) > subtotalComDev ? subtotalComDev : Number(o.totalPago || 0)),
          isFilteredByDev: true
        }
      }).filter(Boolean)
    }

    // Ordenação com Data de Vencimento prioritária
    return [...list].sort((a, b) => {
      const getD = (x) => dateType === 'pagamento'
        ? getOrderPaymentDate(x)
        : dateType === 'date'
          ? (x.date || x.createdAt || x.dataInicio || x.created_at || '')
          : getOrderDueDate(x, financial)
      const ta = new Date(getD(a) || 0).getTime()
      const tb = new Date(getD(b) || 0).getTime()
      return tb - ta
    })
  }, [
    orders,
    financial,
    produtos,
    scope,
    filteredOrdersFromScreen,
    selectedOrderIds,
    selectedStatuses,
    financialStatus,
    selectedClientPhone,
    selectedCity,
    selectedRoute,
    selectedPayment,
    devolucaoFilter,
    dateType,
    startDate,
    endDate,
    excludeTests,
    isFinalizada
  ])

  // Estatísticas oficiais THSM
  const reportStats = useMemo(() => {
    const totalPedidos = targetOrders.length
    let faturamentoTotal = 0
    let valorItensTotal = 0
    let descontosTotal = 0
    let saldoEmAbertoTotal = 0
    let totalItens = 0
    let totalQtdSemDev = 0
    let totalQtdComDev = 0
    let totalValorSemDev = 0
    let totalValorComDev = 0
    let vendaNaoRecebida = 0
    let calotePrejuizoCusto = 0
    let pedidosVendaCount = 0
    let pedidosDevolucaoTotalCount = 0
    let pedidosBrindeCount = 0
    let pedidosZeradosTotalCount = 0
    let calotesCount = 0

    const valoresLiquidosVendas = []
    const statusMap = {}
    Object.keys(STATUS_CONFIG).forEach(s => {
      statusMap[s] = { count: 0, total: 0 }
    })

    targetOrders.forEach(o => {
      const dev = getOrderDevolucaoStats(o, produtos)
      const fin = getOrderFinancialDetails(o)
      const st = getResolvedStatus(o)

      totalItens += dev.qtdTotal
      totalQtdSemDev += dev.qtdSemDev
      totalQtdComDev += dev.qtdComDev
      saldoEmAbertoTotal += fin.saldoEmAberto

      if (!statusMap[st]) statusMap[st] = { count: 0, total: 0 }
      statusMap[st].count += 1

      if (fin.isZero) {
        if (fin.zeroType === 'brinde') pedidosBrindeCount += 1
        else pedidosDevolucaoTotalCount += 1
        pedidosZeradosTotalCount += 1
      } else if (st === 'concluido' || isFinalizada(o)) {
        pedidosVendaCount += 1
        faturamentoTotal += fin.totalLiquido
        valorItensTotal += fin.valorItens
        descontosTotal += fin.desconto
        statusMap[st].total += fin.totalLiquido
        valoresLiquidosVendas.push(fin.totalLiquido)

        totalValorSemDev += dev.totalSemDev
        totalValorComDev += dev.totalComDev
      } else if (st === 'calote') {
        const caloteVenda = Number(o.caloteTotalVenda || fin.valorItens || o.totalOriginal || o.total || 0)
        vendaNaoRecebida += caloteVenda
        statusMap[st].total += caloteVenda
        calotesCount += 1
        calotePrejuizoCusto += Number(o.caloteTotalCusto || 0)
      } else {
        statusMap[st].total += fin.totalLiquido
      }
    })

    const ticketMedio = pedidosVendaCount > 0 ? (faturamentoTotal / pedidosVendaCount) : 0

    valoresLiquidosVendas.sort((a, b) => a - b)
    let ticketMediana = 0
    if (pedidosVendaCount > 0) {
      const mid = Math.floor(pedidosVendaCount / 2)
      if (pedidosVendaCount % 2 === 1) {
        ticketMediana = valoresLiquidosVendas[mid]
      } else {
        ticketMediana = (valoresLiquidosVendas[mid - 1] + valoresLiquidosVendas[mid]) / 2
      }
    }

    return {
      totalPedidos,
      pedidosVendaCount,
      pedidosDevolucaoTotalCount,
      pedidosBrindeCount,
      pedidosZeradosTotalCount,
      faturamentoTotal: Math.round(faturamentoTotal * 100) / 100,
      valorItensTotal: Math.round(valorItensTotal * 100) / 100,
      descontosTotal: Math.round(descontosTotal * 100) / 100,
      saldoEmAbertoTotal: Math.round(saldoEmAbertoTotal * 100) / 100,
      ticketMedio: Math.round(ticketMedio * 100) / 100,
      ticketMediana: Math.round(ticketMediana * 100) / 100,
      calotesCount,
      vendaNaoRecebida: Math.round(vendaNaoRecebida * 100) / 100,
      calotePrejuizoCusto: Math.round(calotePrejuizoCusto * 100) / 100,
      totalItens,
      totalQtdSemDev,
      totalQtdComDev,
      totalValorSemDev: Math.round(totalValorSemDev * 100) / 100,
      totalValorComDev: Math.round(totalValorComDev * 100) / 100
    }
  }, [targetOrders, produtos, isFinalizada])

  // Presets de status
  const applyStatusPreset = (preset) => {
    switch (preset) {
      case 'todos':
        setSelectedStatuses(Object.keys(STATUS_CONFIG))
        break
      case 'ativos':
        setSelectedStatuses(['pre-pedido', 'pendente', 'confirmado', 'em-andamento', 'em-rota', 'acerto', 'entregue'])
        break
      case 'concluidos':
        setSelectedStatuses(['concluido'])
        break
      case 'calotes':
        setSelectedStatuses(['calote_parcial', 'calote'])
        break
      case 'cancelados':
        setSelectedStatuses(['cancelado'])
        break
      default:
        break
    }
  }

  const toggleStatus = (statusKey) => {
    setSelectedStatuses(prev => {
      if (prev.includes(statusKey)) {
        return prev.filter(s => s !== statusKey)
      } else {
        return [...prev, statusKey]
      }
    })
  }

  const selectAllStatuses = () => setSelectedStatuses(Object.keys(STATUS_CONFIG))
  const deselectAllStatuses = () => setSelectedStatuses([])

  // Presets de data
  const applyDatePreset = (preset) => {
    const today = new Date()
    const formatDateYMD = (d) => {
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    if (preset === 'today') {
      const str = formatDateYMD(today)
      setStartDate(str)
      setEndDate(str)
    } else if (preset === 'yesterday') {
      const yest = new Date()
      yest.setDate(today.getDate() - 1)
      const str = formatDateYMD(yest)
      setStartDate(str)
      setEndDate(str)
    } else if (preset === 'last7') {
      const past = new Date()
      past.setDate(today.getDate() - 7)
      setStartDate(formatDateYMD(past))
      setEndDate(formatDateYMD(today))
    } else if (preset === 'last30') {
      const past = new Date()
      past.setDate(today.getDate() - 30)
      setStartDate(formatDateYMD(past))
      setEndDate(formatDateYMD(today))
    } else if (preset === 'this_month') {
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      setStartDate(formatDateYMD(first))
      setEndDate(formatDateYMD(today))
    } else if (preset === 'last_month') {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const last = new Date(today.getFullYear(), today.getMonth(), 0)
      setStartDate(formatDateYMD(first))
      setEndDate(formatDateYMD(last))
    } else if (preset === 'clear') {
      setStartDate('')
      setEndDate('')
    }
  }

  const filteredClients = useMemo(() => {
    if (!usuarios) return []
    if (!clientSearch) return []
    return usuarios.filter(u => clientMatchesSearch(u, clientSearch)).slice(0, 30)
  }, [usuarios, clientSearch])

  // ==========================================
  // GERAÇÃO DE PDF FORMATADO COM AUTO-TABLE
  // ==========================================
  const handleGeneratePDF = () => {
    if (targetOrders.length === 0) {
      showToast('Nenhum pedido encontrado com os filtros selecionados.', 'error')
      return
    }

    try {
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      })

      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const nowStr = new Date().toLocaleString('pt-BR')

      // Cabeçalho Corporativo THSM
      const headerH = 13
      doc.setFillColor(15, 23, 42)
      doc.rect(0, 0, pageWidth, headerH, 'F')

      doc.setTextColor(255, 255, 255)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('THSM DISTRIBUIDORA', 10, 8)

      doc.setFontSize(7.5)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(148, 163, 184)
      doc.text('RELATÓRIO GERENCIAL DE PEDIDOS COM ENDEREÇO E PRODUTOS (POR VENCIMENTO)', 65, 8)

      doc.setFontSize(7)
      doc.setTextColor(203, 213, 225)
      doc.text(`Emissão: ${nowStr}   |   Total: ${reportStats.totalPedidos} pedidos`, pageWidth - 10, 8, { align: 'right' })

      let currentY = 15.5

      // Metadados dos Filtros
      doc.setFillColor(241, 245, 249)
      doc.rect(10, currentY, pageWidth - 20, 6, 'F')
      doc.setDrawColor(226, 232, 240)
      doc.rect(10, currentY, pageWidth - 20, 6, 'S')

      doc.setFontSize(6.8)
      doc.setTextColor(71, 85, 105)
      doc.setFont('helvetica', 'bold')

      const statusDesc = selectedStatuses.length === Object.keys(STATUS_CONFIG).length
        ? 'Todos os Status'
        : selectedStatuses.map(s => STATUS_CONFIG[s]?.label || s).join(', ')

      const dateDesc = startDate || endDate
        ? `${startDate ? formatDateBR(startDate) : 'Início'} até ${endDate ? formatDateBR(endDate) : 'Hoje'}`
        : 'Todo o Período'

      const scopeDesc = scope === 'todos' ? 'Todos os Pedidos' : scope === 'selecionados' ? 'Selecionados' : scope === 'tela' ? 'Filtros da Tela' : 'Personalizado'
      const filterLine = `Escopo: ${scopeDesc} | Base: Data de Vencimento | Período: ${dateDesc} | Status: ${statusDesc} | Cidade: ${selectedCity} | Rota: ${selectedRoute}`
      doc.text(filterLine.slice(0, 165), 13, currentY + 4)

      currentY += 8.5

      // KPIs no PDF
      const cardCount = 6
      const gap = 2
      const totalW = pageWidth - 20
      const cardW = (totalW - (gap * (cardCount - 1))) / cardCount
      const cardH = 8.5
      const kpis = [
        { label: 'TOTAL PEDIDOS', val: `${reportStats.totalPedidos} ped (${reportStats.pedidosVendaCount} v)`, color: [2, 132, 199] },
        { label: 'VALOR ITENS (TABELA)', val: formatCurrency(reportStats.valorItensTotal), color: [59, 130, 246] },
        { label: 'DESCONTOS CONCEDIDOS', val: `- ${formatCurrency(reportStats.descontosTotal)}`, color: [99, 102, 241] },
        { label: 'TOTAL LÍQUIDO FATURADO', val: formatCurrency(reportStats.faturamentoTotal), color: [16, 185, 129] },
        { label: 'TICKET MÉDIO (MEDIANA)', val: `${formatCurrency(reportStats.ticketMedio)}`, color: [14, 165, 233] },
        { label: 'TOTAL PEÇAS (S/D • C/D)', val: `${reportStats.totalItens} un (${reportStats.totalQtdSemDev} • ${reportStats.totalQtdComDev})`, color: [245, 158, 11] }
      ]

      kpis.forEach((kpi, idx) => {
        const kpiX = 10 + idx * (cardW + gap)
        doc.setFillColor(248, 250, 252)
        doc.rect(kpiX, currentY, cardW, cardH, 'F')
        doc.setDrawColor(226, 232, 240)
        doc.rect(kpiX, currentY, cardW, cardH, 'S')

        doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2])
        doc.rect(kpiX, currentY, 2, cardH, 'F')

        doc.setFontSize(4.8)
        doc.setTextColor(100, 116, 139)
        doc.setFont('helvetica', 'bold')
        doc.text(kpi.label, kpiX + 3.2, currentY + 3)

        doc.setFontSize(6.5)
        doc.setTextColor(15, 23, 42)
        doc.text(kpi.val, kpiX + 3.2, currentY + 6.8)
      })

      currentY += cardH + 3.5

      // Tabela de Pedidos
      const showVal = includePrices !== false
      const tableHeaders = showVal ? [
        '# / Vencimento',
        'Cliente / Tel',
        'Status / Tipo',
        'Endereço Completo / Destino',
        'Rota',
        'Qtd',
        'Produtos / Itens Descritos',
        'Valor Tabela',
        'Desconto',
        'Total Líquido'
      ] : [
        '# / Vencimento',
        'Cliente / Tel',
        'Status / Tipo',
        'Endereço Completo / Destino',
        'Rota',
        'Qtd',
        'Produtos / Itens Descritos'
      ]

      const tableBody = []

      targetOrders.forEach(o => {
        const dev = getOrderDevolucaoStats(o, produtos)
        const dataVenc = getOrderDueDate(o, financial)
        const dateStr = formatDateBR(dataVenc)
        const numId = `#${String(o.id).slice(-6)}`
        const numDataStr = `${numId}\n${dateStr}`
        const clienteStr = `${o.customer?.nome || 'Não informado'}\n${o.customer?.telefone || '-'}`
        const resStatus = getResolvedStatus(o)
        const fin = getOrderFinancialDetails(o)
        const tipoBadge = fin.isZero ? (fin.zeroType === 'brinde' ? ' [Brinde]' : ' [Dev. Total]') : ''
        const statusLabel = `${STATUS_CONFIG[resStatus]?.label || resStatus}${tipoBadge}`
        const enderecoCompleto = formatFullAddress(o.customer?.endereco)
        const rotaStr = o.customer?.endereco?.rota || '-'

        let qtdStr = `${dev.qtdTotal} un`
        if (dev.qtdSemDev > 0) qtdStr += `\n(${dev.qtdSemDev} s/d)`

        let prodsInline = '-'
        if (o.items && o.items.length > 0) {
          if (multilineItems) {
            prodsInline = o.items.map(i => {
              const isSem = checkItemSemDevolucao(i, produtos)
              return `• ${i.qty || 1}x ${cleanProductName(i.nome)}${isSem ? ' [S/DEV]' : ''}`
            }).join('\n')
          } else {
            prodsInline = o.items.map(i => {
              const isSem = checkItemSemDevolucao(i, produtos)
              return `${i.qty || 1}x ${cleanProductName(i.nome)}${isSem ? ' [S/DEV]' : ''}`
            }).join(' • ')
          }
        }

        if (showVal) {
          tableBody.push([
            numDataStr,
            clienteStr,
            statusLabel,
            enderecoCompleto,
            rotaStr,
            qtdStr,
            prodsInline,
            fin.isZero ? 'R$ 0,00' : formatCurrency(fin.valorItens),
            fin.isZero ? 'R$ 0,00' : (fin.desconto > 0 ? `- ${formatCurrency(fin.desconto)}` : '-'),
            resStatus === 'calote' ? `Calote: ${formatCurrency(o.caloteTotalVenda || fin.valorItens)}` : formatCurrency(fin.totalLiquido)
          ])
        } else {
          tableBody.push([
            numDataStr,
            clienteStr,
            statusLabel,
            enderecoCompleto,
            rotaStr,
            qtdStr,
            prodsInline
          ])
        }
      })

      const footRow = showVal ? [
        'TOTAL GERAL',
        `${reportStats.totalPedidos} ped (${reportStats.pedidosVendaCount} vendas)`,
        '',
        '',
        '',
        `${reportStats.totalItens} un`,
        `Sem Dev: ${reportStats.totalQtdSemDev} un • Com Dev: ${reportStats.totalQtdComDev} un`,
        formatCurrency(reportStats.valorItensTotal),
        `- ${formatCurrency(reportStats.descontosTotal)}`,
        formatCurrency(reportStats.faturamentoTotal)
      ] : [
        'TOTAL GERAL',
        `${reportStats.totalPedidos} ped (${reportStats.pedidosVendaCount} vendas)`,
        '',
        '',
        '',
        `${reportStats.totalItens} un`,
        `Sem Dev: ${reportStats.totalQtdSemDev} un • Com Dev: ${reportStats.totalQtdComDev} un`
      ]

      const colStyles = {
        0: { cellWidth: 16 },
        1: { cellWidth: 34 },
        2: { cellWidth: 17 },
        3: { cellWidth: 44 },
        4: { cellWidth: 14 },
        5: { cellWidth: 10, halign: 'center' },
        6: { cellWidth: 92 },
        7: { cellWidth: 16, halign: 'right' },
        8: { cellWidth: 15, halign: 'right', textColor: [99, 102, 241] },
        9: { cellWidth: 19, halign: 'right', fontStyle: 'bold', textColor: [16, 185, 129] }
      }

      autoTable(doc, {
        startY: currentY,
        head: [tableHeaders],
        body: tableBody,
        foot: [footRow],
        theme: 'striped',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontSize: 6.5,
          fontStyle: 'bold',
          cellPadding: 1.5
        },
        bodyStyles: {
          fontSize: 6.0,
          cellPadding: 1.2,
          textColor: [15, 23, 42],
          valign: 'top'
        },
        footStyles: {
          fillColor: [226, 232, 240],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          fontSize: 6.5,
          cellPadding: 1.5
        },
        columnStyles: colStyles,
        margin: { left: 10, right: 10, top: 10, bottom: 8 }
      })

      const totalPages = doc.internal.getNumberOfPages()
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i)
        doc.setFontSize(6.8)
        doc.setTextColor(148, 163, 184)
        doc.setDrawColor(226, 232, 240)
        doc.line(10, pageHeight - 7, pageWidth - 10, pageHeight - 7)
        doc.text('THSM Distribuidora — Sistema Comercial e Logística (Base Vencimento)', 10, pageHeight - 4)
        doc.text(`Página ${i} de ${totalPages}`, pageWidth - 10, pageHeight - 4, { align: 'right' })
      }

      const fileName = `Relatorio_Pedidos_THSM_${new Date().toISOString().split('T')[0]}.pdf`
      doc.save(fileName)
      showToast(`Relatório PDF baixado com sucesso (${totalPages} pág)!`, 'success')
    } catch (err) {
      console.error('Erro ao gerar PDF:', err)
      showToast('Erro ao gerar PDF. Verifique o console.', 'error')
    }
  }

  // ==========================================
  // EXPORTAÇÃO EXCEL EM FORMATO TABELA PLANA
  // ==========================================
  const handleExportExcel = () => {
    if (targetOrders.length === 0) {
      showToast('Nenhum pedido encontrado com os filtros selecionados.', 'error')
      return
    }

    try {
      const wb = XLSX.utils.book_new()
      const nowStr = new Date().toLocaleString('pt-BR')

      // ABA 1: PEDIDOS
      const excelHeaders = [
        'id_pedido',
        'data_vencimento',
        'data_pedido',
        'cliente',
        'telefone',
        'status',
        'tipo_pedido',
        'motivo_zerado',
        'cidade',
        'bairro',
        'rota',
        'endereco_completo',
        'quantidade_itens',
        'qtd_sem_devolucao',
        'qtd_com_devolucao',
        'valor_itens',
        'desconto',
        'motivo_desconto',
        'total_liquido',
        'saldo_em_aberto',
        'forma_pagamento',
        'resumo_itens'
      ]

      const mainSheetData = [excelHeaders]

      targetOrders.forEach(o => {
        const fin = getOrderFinancialDetails(o)
        const dev = getOrderDevolucaoStats(o, produtos)
        const dataVenc = getOrderDueDate(o, financial)
        const dataVencStr = formatDateBR(dataVenc)
        const dateStr = formatDateBR(o.date || o.createdAt || dataVenc)
        const resStatus = getResolvedStatus(o)
        const statusLabel = STATUS_CONFIG[resStatus]?.label || resStatus
        const enderecoCompleto = formatFullAddress(o.customer?.endereco)
        const rotaStr = o.customer?.endereco?.rota || '-'
        const cidadeStr = o.customer?.endereco?.cidade || '-'
        const bairroStr = o.customer?.endereco?.bairro || '-'
        const tipoPedido = fin.isZero
          ? (fin.zeroType === 'brinde' ? 'Brinde' : 'Devolução Total')
          : (resStatus === 'calote' ? 'Calote 100%' : 'Venda Normal')

        const resumoItens = (o.items || []).map(i => `${i.qty || 1}x ${cleanProductName(i.nome)}`).join(multilineItems ? '\r\n' : ' • ') || '-'

        mainSheetData.push([
          o.id,
          dataVencStr,
          dateStr,
          o.customer?.nome || '-',
          o.customer?.telefone || '-',
          statusLabel,
          tipoPedido,
          fin.motivoZerado,
          cidadeStr,
          bairroStr,
          rotaStr,
          enderecoCompleto,
          dev.qtdTotal,
          dev.qtdSemDev,
          dev.qtdComDev,
          fin.valorItens,
          fin.desconto,
          fin.motivoDesconto,
          fin.totalLiquido,
          fin.saldoEmAberto,
          o.pagamento || o.paymentMethod || 'Não informado',
          resumoItens
        ])
      })

      const wsMain = XLSX.utils.aoa_to_sheet(mainSheetData)
      XLSX.utils.book_append_sheet(wb, wsMain, 'Pedidos (Tabela Plana)')

      // ABA 2: ITENS DETALHADOS
      const itensHeaders = [
        'id_pedido',
        'data_vencimento',
        'cliente',
        'telefone',
        'status_pedido',
        'produto_nome',
        'tipo_devolucao',
        'quantidade',
        'preco_unitario',
        'subtotal',
        'status_item'
      ]

      const itensRows = []
      targetOrders.forEach(o => {
        const fin = getOrderFinancialDetails(o)
        const dataVenc = getOrderDueDate(o, financial)
        const dataVencStr = formatDateBR(dataVenc)
        const resStatus = getResolvedStatus(o)
        const statusLabel = STATUS_CONFIG[resStatus]?.label || resStatus

        const items = (Array.isArray(o.items) && o.items.length > 0)
          ? o.items
          : (Array.isArray(o.originalItems) && o.originalItems.length > 0 ? o.originalItems : [])

        items.forEach(i => {
          const isSem = checkItemSemDevolucao(i, produtos)
          const prodNome = cleanProductName(i.nome || i.displayName)
          const qty = Number(i.qty || 1)
          const precoUnit = Number(i.preco || 0)
          const subtotal = Math.round(qty * precoUnit * 100) / 100
          const statusItem = fin.isZero
            ? (fin.zeroType === 'brinde' ? 'Brinde' : 'Devolvido')
            : (resStatus === 'calote' ? 'Calote' : 'Vendido')

          itensRows.push([
            o.id,
            dataVencStr,
            o.customer?.nome || '-',
            o.customer?.telefone || '-',
            statusLabel,
            prodNome,
            isSem ? 'SEM DEVOLUÇÃO' : 'COM DEVOLUÇÃO',
            qty,
            precoUnit,
            subtotal,
            statusItem
          ])
        })
      })

      if (itensRows.length > 0) {
        const wsItens = XLSX.utils.aoa_to_sheet([itensHeaders, ...itensRows])
        XLSX.utils.book_append_sheet(wb, wsItens, 'Itens Detalhados')
      }

      // ABA 3: RESUMO EXECUTIVO
      const resumoData = [
        ['THSM DISTRIBUIDORA - RESUMO EXECUTIVO DE PEDIDOS'],
        [`Gerado em: ${nowStr}`],
        [`Base de cálculo: DATA DE VENCIMENTO | Pedidos de teste: ${excludeTests ? 'Excluídos' : 'Incluídos'}`],
        [],
        ['1. VOLUME DE PEDIDOS'],
        ['Total de Pedidos Registrados', reportStats.totalPedidos],
        ['Pedidos de Venda (com valor > R$ 0)', reportStats.pedidosVendaCount],
        ['Pedidos com Devolução Total (não vendeu nada)', reportStats.pedidosDevolucaoTotalCount],
        ['Pedidos Brinde (sem faturamento)', reportStats.pedidosBrindeCount],
        ['Total de Pedidos Zerados', reportStats.pedidosZeradosTotalCount],
        ['Total de Peças Enviadas', reportStats.totalItens],
        ['  - Peças SEM Devolução', reportStats.totalQtdSemDev],
        ['  - Peças COM Devolução', reportStats.totalQtdComDev],
        [],
        ['2. FATURAMENTO E VALORES'],
        ['Valor dos Itens (Preço de Tabela)', reportStats.valorItensTotal],
        ['Descontos Concedidos', -reportStats.descontosTotal],
        ['Total Líquido Faturado', reportStats.faturamentoTotal],
        ['Saldo em Aberto Pendente', reportStats.saldoEmAbertoTotal],
        ['Ticket Médio Líquido', reportStats.ticketMedio],
        ['Mediana do Ticket', reportStats.ticketMediana]
      ]

      const wsResumo = XLSX.utils.aoa_to_sheet(resumoData)
      XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo Geral')

      const fileName = `Relatorio_Pedidos_THSM_${new Date().toISOString().split('T')[0]}.xlsx`
      XLSX.writeFile(wb, fileName)
      showToast('Planilha Excel (.xlsx) exportada com sucesso!', 'success')
    } catch (err) {
      console.error('Erro ao exportar Excel:', err)
      showToast('Erro ao exportar para Excel.', 'error')
    }
  }

  // ==========================================
  // IMPRESSÃO ULTRA-ROBUSTA (IFRAME + FALLBACK)
  // ==========================================
  const handlePrintView = () => {
    if (targetOrders.length === 0) {
      showToast('Nenhum pedido para imprimir com os filtros selecionados.', 'error')
      return
    }

    const nowStr = new Date().toLocaleString('pt-BR')
    const showVal = includePrices !== false

    const statusDesc = selectedStatuses.length === Object.keys(STATUS_CONFIG).length
      ? 'Todos os Status'
      : selectedStatuses.map(s => STATUS_CONFIG[s]?.label || s).join(', ')

    const dateDesc = startDate || endDate
      ? `${startDate ? formatDateBR(startDate) : 'Início'} até ${endDate ? formatDateBR(endDate) : 'Hoje'}`
      : 'Todo o Período'

    const scopeDesc = scope === 'todos' ? 'Todos os Pedidos' : scope === 'selecionados' ? `Selecionados (${targetOrders.length})` : scope === 'tela' ? 'Filtros da Tela' : 'Personalizado'

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>THSM Distribuidora — Relatório de Pedidos ${!showVal ? '(Romaneio)' : ''}</title>
        <style>
          @page { size: landscape; margin: 8mm; }
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 8.5px;
            color: #0f172a;
            margin: 0;
            padding: 8px;
            line-height: 1.25;
            background: #ffffff;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 6px;
            margin-bottom: 8px;
          }
          .header h1 {
            font-size: 14px;
            font-weight: 800;
            margin: 0;
            color: #0f172a;
            letter-spacing: 0.5px;
          }
          .header p {
            font-size: 8px;
            color: #475569;
            margin: 2px 0 0 0;
            font-weight: 600;
          }
          .header-meta {
            text-align: right;
            font-size: 8px;
            color: #334155;
          }
          .meta-box {
            background: #f8fafc;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 5px 8px;
            margin-bottom: 8px;
            font-size: 8px;
            color: #334155;
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
          }
          .meta-item {
            display: inline-flex;
            align-items: center;
            gap: 4px;
          }
          .meta-item strong {
            color: #0f172a;
          }
          .kpi-row {
            display: flex;
            gap: 6px;
            margin-bottom: 8px;
          }
          .kpi-box {
            flex: 1;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-left: 3px solid #0284c7;
            padding: 4px 6px;
            border-radius: 4px;
          }
          .kpi-box .val {
            font-size: 9.5px;
            font-weight: 800;
            color: #0f172a;
          }
          .kpi-box .lbl {
            font-size: 6.8px;
            text-transform: uppercase;
            color: #64748b;
            font-weight: 700;
            margin-top: 2px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 8px;
            font-size: 8px;
          }
          tr {
            page-break-inside: avoid;
          }
          th {
            background: #0f172a;
            color: #ffffff;
            padding: 5px 6px;
            text-align: left;
            font-weight: 700;
            font-size: 8px;
            white-space: nowrap;
          }
          td {
            padding: 4px 6px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: top;
            font-size: 8px;
            line-height: 1.3;
          }
          tr:nth-child(even) {
            background: #f8fafc;
          }
          .td-right { text-align: right; }
          .td-center { text-align: center; }
          .footer-total {
            background: #e2e8f0 !important;
            font-weight: 800;
            font-size: 8.5px;
          }
          .badge-status {
            display: inline-block;
            padding: 1px 5px;
            border-radius: 3px;
            font-size: 7.5px;
            font-weight: 700;
            white-space: nowrap;
          }
          .badge-semdev {
            color: #b45309;
            font-weight: 700;
            font-size: 7px;
            margin-left: 2px;
          }
          .prod-item-row {
            margin: 1.5px 0;
            line-height: 1.25;
          }
          @media print {
            body { padding: 0; }
            .no-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        <div class="no-print" style="background: #0f172a; color: #ffffff; padding: 10px 16px; margin: -8px -8px 12px -8px; display: flex; justify-content: space-between; align-items: center; border-radius: 6px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
            <strong style="font-size: 13px; color: #38bdf8;">THSM DISTRIBUIDORA</strong>
            <span style="font-size: 12px; color: #64748b;">|</span>
            <span style="font-size: 12px; color: #cbd5e1;">Prévia de Impressão (${targetOrders.length} pedidos)</span>
          </div>
          <div style="display: flex; gap: 10px;">
            <button onclick="window.print()" style="background: #0284c7; color: #ffffff; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 700;">
              🖨️ Imprimir Agora
            </button>
            <button onclick="window.close()" style="background: #334155; color: #ffffff; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
              Fechar
            </button>
          </div>
        </div>

        <div class="header">
          <div>
            <h1>THSM DISTRIBUIDORA</h1>
            <p>${showVal ? 'RELATÓRIO GERENCIAL DE PEDIDOS COM ENDEREÇO, PRODUTOS E VALORES FINANCEIROS' : 'ROMANEIO LOGÍSTICO DE ENTREGA E CONFERÊNCIA (SEM EXIBIÇÃO DE VALORES)'}</p>
          </div>
          <div class="header-meta">
            <div><strong>Emissão:</strong> ${nowStr}</div>
            <div><strong>Total:</strong> ${reportStats.totalPedidos} pedidos (${reportStats.pedidosVendaCount} vendas, ${reportStats.pedidosZeradosTotalCount} zerados)</div>
          </div>
        </div>

        <div class="meta-box">
          <div class="meta-item"><span>Escopo:</span> <strong>${scopeDesc}</strong></div>
          <div class="meta-item"><span>Base:</span> <strong>Data de Vencimento</strong></div>
          <div class="meta-item"><span>Período:</span> <strong>${dateDesc}</strong></div>
          <div class="meta-item"><span>Status:</span> <strong>${statusDesc}</strong></div>
          ${selectedCity !== 'TODAS' ? `<div class="meta-item"><span>Cidade:</span> <strong>${selectedCity}</strong></div>` : ''}
          ${selectedRoute !== 'TODAS' ? `<div class="meta-item"><span>Rota:</span> <strong>${selectedRoute}</strong></div>` : ''}
          ${excludeTests ? `<div class="meta-item"><strong style="color: #059669;">(Sem pedidos de teste)</strong></div>` : ''}
        </div>

        <div class="kpi-row">
          <div class="kpi-box" style="border-left-color: #0284c7;">
            <div class="val">${reportStats.totalPedidos}</div>
            <div class="lbl">Total Pedidos (${reportStats.pedidosVendaCount} v)</div>
          </div>
          <div class="kpi-box" style="border-left-color: #3b82f6;">
            <div class="val">${formatCurrency(reportStats.valorItensTotal)}</div>
            <div class="lbl">Valor Itens (Tabela)</div>
          </div>
          <div class="kpi-box" style="border-left-color: #6366f1;">
            <div class="val">- ${formatCurrency(reportStats.descontosTotal)}</div>
            <div class="lbl">Descontos Concedidos</div>
          </div>
          <div class="kpi-box" style="border-left-color: #10b981;">
            <div class="val">${formatCurrency(reportStats.faturamentoTotal)}</div>
            <div class="lbl">Total Líquido Faturado</div>
          </div>
          <div class="kpi-box" style="border-left-color: #0284c7;">
            <div class="val">${formatCurrency(reportStats.ticketMedio)}</div>
            <div class="lbl">Ticket Médio (Med ${formatCurrency(reportStats.ticketMediana)})</div>
          </div>
          <div class="kpi-box" style="border-left-color: #f59e0b;">
            <div class="val">${reportStats.totalItens} un</div>
            <div class="lbl">Itens (${reportStats.totalQtdSemDev} s/d • ${reportStats.totalQtdComDev} c/d)</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th># / Vencimento</th>
              <th>Cliente / Tel</th>
              <th>Status / Tipo</th>
              <th>Endereço Completo / Destino</th>
              <th>Rota</th>
              <th class="td-center">Qtd</th>
              <th>Produtos / Itens Descritos</th>
              ${showVal ? `
                <th class="td-right">Valor Tabela</th>
                <th class="td-right">Desconto</th>
                <th class="td-right">Total Líquido</th>
              ` : ''}
            </tr>
          </thead>
          <tbody>
            ${targetOrders.map(o => {
              const resStatus = getResolvedStatus(o)
              const cfg = STATUS_CONFIG[resStatus] || { label: resStatus, color: '#333', bg: '#eee', border: '#ccc' }
              const dev = getOrderDevolucaoStats(o, produtos)
              const fin = getOrderFinancialDetails(o)
              const enderecoStr = formatFullAddress(o.customer?.endereco)
              const dataVenc = getOrderDueDate(o, financial)
              const orderItems = o.items || []
              let prodsContent = '-'
              if (orderItems.length > 0) {
                if (multilineItems) {
                  prodsContent = orderItems.map(i => {
                    const isSem = checkItemSemDevolucao(i, produtos)
                    const semDevBadge = isSem ? ' <span class="badge-semdev">[S/DEV]</span>' : ''
                    return `<div class="prod-item-row">• <strong>${i.qty || 1}x</strong> ${cleanProductName(i.nome)}${semDevBadge}</div>`
                  }).join('')
                } else {
                  prodsContent = orderItems.map(i => {
                    const isSem = checkItemSemDevolucao(i, produtos)
                    return `${i.qty || 1}x ${cleanProductName(i.nome)}${isSem ? ' [S/DEV]' : ''}`
                  }).join(' • ')
                }
              }

              return `
                <tr>
                  <td><strong>#${String(o.id).slice(-6)}</strong><br /><small style="color: #64748b;">${formatDateBR(dataVenc)}</small></td>
                  <td><strong>${o.customer?.nome || '-'}</strong><br /><small style="color: #64748b;">${o.customer?.telefone || '-'}</small></td>
                  <td>
                    <span class="badge-status" style="background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.border || cfg.color};">
                      ${cfg.label}
                    </span>
                    ${fin.isZero ? `<br /><small style="color:#64748b;font-weight:600;">(${fin.motivoZerado})</small>` : ''}
                  </td>
                  <td style="max-width: 250px;">${enderecoStr}</td>
                  <td><strong>${o.customer?.endereco?.rota || '-'}</strong></td>
                  <td class="td-center">${dev.qtdTotal} un</td>
                  <td>${prodsContent}</td>
                  ${showVal ? `
                    <td class="td-right">${fin.isZero ? 'R$ 0,00' : formatCurrency(fin.valorItens)}</td>
                    <td class="td-right" style="color:#6366f1;">${fin.isZero ? 'R$ 0,00' : (fin.desconto > 0 ? `- ${formatCurrency(fin.desconto)}` : '-')}</td>
                    <td class="td-right" style="font-weight:800;color:${resStatus === 'calote' ? '#dc2626' : '#059669'};">
                      ${resStatus === 'calote' ? `Calote: ${formatCurrency(o.caloteTotalVenda || fin.valorItens)}` : formatCurrency(fin.totalLiquido)}
                    </td>
                  ` : ''}
                </tr>
              `
            }).join('')}
          </tbody>
          ${showVal ? `
            <tfoot>
              <tr class="footer-total">
                <td>TOTAL</td>
                <td>${reportStats.totalPedidos} ped (${reportStats.pedidosVendaCount} v)</td>
                <td></td>
                <td></td>
                <td></td>
                <td class="td-center">${reportStats.totalItens} un</td>
                <td>Sem Dev: ${reportStats.totalQtdSemDev} un • Com Dev: ${reportStats.totalQtdComDev} un</td>
                <td class="td-right">${formatCurrency(reportStats.valorItensTotal)}</td>
                <td class="td-right" style="color:#6366f1;">- ${formatCurrency(reportStats.descontosTotal)}</td>
                <td class="td-right" style="color:#059669;">${formatCurrency(reportStats.faturamentoTotal)}</td>
              </tr>
            </tfoot>
          ` : ''}
        </table>

        <div style="text-align:center;font-size:8px;color:#94a3b8;margin-top:10px;border-top:1px solid #e2e8f0;padding-top:6px;">
          Balanço THSM: Valor dos Itens (${formatCurrency(reportStats.valorItensTotal)}) − Descontos (${formatCurrency(reportStats.descontosTotal)}) = Total Líquido (${formatCurrency(reportStats.faturamentoTotal)})
        </div>
      </body>
      </html>
    `

    printReportViaIframe(htmlContent)
  }

  if (!isOpen) return null

  return (
    <div className="order-report-overlay" onClick={onClose}>
      <div className="order-report-modal" onClick={e => e.stopPropagation()}>
        {/* CABEÇALHO MODERNO */}
        <div className="order-report-header">
          <div className="order-report-header-title">
            <div className="order-report-icon-badge">
              <i className="fa-solid fa-file-invoice-dollar"></i>
            </div>
            <div>
              <h3>Relatório de Pedidos & Faturamento</h3>
              <p>Controle financeiro, romaneio e conferência de entregas (Base Vencimento)</p>
            </div>
          </div>
          <button
            type="button"
            className="order-report-close-btn"
            onClick={onClose}
            title="Fechar (Esc)"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* CORPO DO MODAL */}
        <div className="order-report-body">
          {/* SELETOR DE ESCOPO / ORIGEM */}
          <div className="report-scope-selector">
            <button
              type="button"
              className={`report-scope-btn ${scope === 'todos' ? 'active' : ''}`}
              onClick={() => setScope('todos')}
            >
              <i className="fa-solid fa-layer-group"></i>
              Todos os Pedidos ({orders.length})
            </button>
            <button
              type="button"
              className={`report-scope-btn ${scope === 'tela' ? 'active' : ''}`}
              onClick={() => setScope('tela')}
            >
              <i className="fa-solid fa-filter"></i>
              Filtros da Tela ({filteredOrdersFromScreen.length})
            </button>
            <button
              type="button"
              className={`report-scope-btn ${scope === 'selecionados' ? 'active' : ''}`}
              onClick={() => setScope('selecionados')}
              disabled={!selectedOrderIds || selectedOrderIds.size === 0}
            >
              <i className="fa-solid fa-square-check"></i>
              Selecionados ({selectedOrderIds ? selectedOrderIds.size : 0})
            </button>
            <button
              type="button"
              className={`report-scope-btn ${scope === 'custom' ? 'active' : ''}`}
              onClick={() => setScope('custom')}
            >
              <i className="fa-solid fa-sliders"></i>
              Filtros Personalizados
            </button>
          </div>

          {/* BANNER INFORMATIVO DO ESCOPO */}
          <div className="report-scope-banner">
            <div className="rsb-info">
              <i className="fa-solid fa-circle-info"></i>
              <span>
                {scope === 'todos' && `Puxando toda a base de pedidos da distribuidora (${orders.length} pedidos).`}
                {scope === 'tela' && `Puxando pedidos conforme filtros e buscas ativos na tela principal (${filteredOrdersFromScreen.length} pedidos).`}
                {scope === 'selecionados' && `Puxando apenas os ${selectedOrderIds.size} pedido(s) marcados na lista.`}
                {scope === 'custom' && `Filtros personalizados ativos. Configure os critérios abaixo.`}
              </span>
            </div>
            <div className="rsb-stats">
              <strong>{targetOrders.length}</strong> pedido(s) filtrados ({reportStats.pedidosVendaCount} vendas, {reportStats.pedidosZeradosTotalCount} zerados)
            </div>
          </div>

          {/* PAINEL DE FILTROS PERSONALIZADOS (LIMPO, ORGANIZADO E MODERNO) */}
          {scope === 'custom' && (
            <div className="report-filter-panel">
              {/* SEÇÃO 1: PERÍODO E DATA */}
              <div className="report-filter-section">
                <div className="report-filter-section-head">
                  <div className="rfsh-title">
                    <i className="fa-regular fa-calendar-days"></i>
                    <span>Período & Base de Data</span>
                  </div>
                  <div className="report-date-presets">
                    <button type="button" className="report-chip-btn" onClick={() => applyDatePreset('today')}>Hoje</button>
                    <button type="button" className="report-chip-btn" onClick={() => applyDatePreset('yesterday')}>Ontem</button>
                    <button type="button" className="report-chip-btn" onClick={() => applyDatePreset('last7')}>7 dias</button>
                    <button type="button" className="report-chip-btn" onClick={() => applyDatePreset('last30')}>30 dias</button>
                    <button type="button" className="report-chip-btn" onClick={() => applyDatePreset('this_month')}>Este Mês</button>
                    <button type="button" className="report-chip-btn" onClick={() => applyDatePreset('last_month')}>Mês Passado</button>
                    <button type="button" className="report-chip-btn" onClick={() => applyDatePreset('clear')}>Todo o Período</button>
                  </div>
                </div>

                <div className="report-filter-row">
                  <div className="report-filter-group" style={{ flex: '1.2' }}>
                    <label className="report-filter-label">Base de Cálculo de Data:</label>
                    <select
                      className="report-filter-select"
                      value={dateType}
                      onChange={e => setDateType(e.target.value)}
                    >
                      <option value="vencimento">★ Data de Vencimento (Padrão Oficial THSM)</option>
                      <option value="pagamento">Data de Pagamento / Quitação Real</option>
                      <option value="date">Data de Emissão do Pedido</option>
                    </select>
                  </div>

                  <div className="report-filter-group" style={{ flex: '1' }}>
                    <label className="report-filter-label">Data Inicial (De):</label>
                    <input
                      type="date"
                      className="report-filter-input"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                    />
                  </div>

                  <div className="report-filter-group" style={{ flex: '1' }}>
                    <label className="report-filter-label">Data Final (Até):</label>
                    <input
                      type="date"
                      className="report-filter-input"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* SEÇÃO 2: STATUS DOS PEDIDOS (MULTI-SELECT COM CONTADORES) */}
              <div className="report-filter-section">
                <div className="report-filter-section-head">
                  <div className="rfsh-title">
                    <i className="fa-solid fa-list-check"></i>
                    <span>Status dos Pedidos ({selectedStatuses.length} selecionados)</span>
                  </div>
                  <div className="report-status-actions">
                    <button type="button" className="report-chip-btn" onClick={() => applyStatusPreset('todos')}>
                      Todos
                    </button>
                    <button type="button" className="report-chip-btn" onClick={() => applyStatusPreset('ativos')}>
                      ⚡ Ativos
                    </button>
                    <button type="button" className="report-chip-btn" onClick={() => applyStatusPreset('concluidos')}>
                      Concluídos
                    </button>
                    <button type="button" className="report-chip-btn" onClick={() => applyStatusPreset('calotes')}>
                      Calotes / Aberto
                    </button>
                    <button type="button" className="report-chip-btn" onClick={() => applyStatusPreset('cancelados')}>
                      Cancelados
                    </button>
                    <button type="button" className="report-link-btn" onClick={selectAllStatuses}>
                      Marcar Todos
                    </button>
                    <button type="button" className="report-link-btn" onClick={deselectAllStatuses}>
                      Limpar
                    </button>
                  </div>
                </div>

                {/* GRID DE STATUS COM BADGES CLICÁVEIS */}
                <div className="report-status-grid">
                  {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                    const isSelected = selectedStatuses.includes(key)
                    const count = statusCounts[key] || 0
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`report-status-card-btn ${isSelected ? 'active' : ''}`}
                        style={{
                          '--status-color': cfg.color,
                          '--status-bg': cfg.bg,
                          '--status-border': cfg.border || cfg.color
                        }}
                        onClick={() => toggleStatus(key)}
                      >
                        <div className="rsc-left">
                          <span className="rsc-indicator"></span>
                          <span className="rsc-label">{cfg.label}</span>
                        </div>
                        <span className="rsc-count">{count}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* SEÇÃO 3: FINANCEIRO, PAGAMENTO & LOGÍSTICA */}
              <div className="report-filter-section">
                <div className="report-filter-section-head">
                  <div className="rfsh-title">
                    <i className="fa-solid fa-wallet"></i>
                    <span>Financeiro, Pagamento & Região</span>
                  </div>
                </div>

                <div className="report-filter-grid">
                  <div className="report-filter-group">
                    <label className="report-filter-label">Situação Financeira:</label>
                    <select
                      className="report-filter-select"
                      value={financialStatus}
                      onChange={e => setFinancialStatus(e.target.value)}
                    >
                      <option value="todos">Todos os Pedidos</option>
                      <option value="aberto">⚠️ Apenas com Saldo em Aberto (Pendência)</option>
                      <option value="pago">✓ Apenas Quitados / 100% Pagos</option>
                      <option value="zerados">○ Apenas Zerados (Devolução Total / Brinde)</option>
                    </select>
                  </div>

                  <div className="report-filter-group">
                    <label className="report-filter-label">Forma de Pagamento:</label>
                    <select
                      className="report-filter-select"
                      value={selectedPayment}
                      onChange={e => setSelectedPayment(e.target.value)}
                    >
                      <option value="TODOS">Todas as Formas</option>
                      <option value="avista">À Vista</option>
                      <option value="aprazo">A Prazo</option>
                      <option value="misto">Misto</option>
                      <option value="pix">Pix</option>
                      <option value="dinheiro">Dinheiro</option>
                      <option value="cartao">Cartão</option>
                    </select>
                  </div>

                  <div className="report-filter-group">
                    <label className="report-filter-label">Cidade de Destino:</label>
                    <select
                      className="report-filter-select"
                      value={selectedCity}
                      onChange={e => setSelectedCity(e.target.value)}
                    >
                      {cidadesUnicas.map(c => (
                        <option key={c} value={c}>{c === 'TODAS' ? 'Todas as Cidades' : c}</option>
                      ))}
                    </select>
                  </div>

                  <div className="report-filter-group">
                    <label className="report-filter-label">Rota de Entrega:</label>
                    <select
                      className="report-filter-select"
                      value={selectedRoute}
                      onChange={e => setSelectedRoute(e.target.value)}
                    >
                      {rotasUnicas.map(r => (
                        <option key={r} value={r}>{r === 'TODAS' ? 'Todas as Rotas' : r}</option>
                      ))}
                    </select>
                  </div>

                  <div className="report-filter-group">
                    <label className="report-filter-label">Filtro de Devolução (Itens):</label>
                    <select
                      className="report-filter-select"
                      value={devolucaoFilter}
                      onChange={e => setDevolucaoFilter(e.target.value)}
                    >
                      <option value="todos">Todos os Produtos</option>
                      <option value="sem_dev">Apenas Itens SEM Devolução</option>
                      <option value="apenas_com_dev">Apenas Itens COM Devolução</option>
                    </select>
                  </div>

                  <div className="report-filter-group">
                    <label className="report-filter-label">Cliente Específico:</label>
                    <div className="report-client-search-wrap">
                      <input
                        type="text"
                        className="report-filter-input"
                        placeholder="Buscar por nome ou telefone..."
                        value={clientSearch}
                        onChange={e => {
                          setClientSearch(e.target.value)
                          if (!e.target.value) setSelectedClientPhone('TODOS')
                        }}
                      />
                      {clientSearch && (
                        <button
                          type="button"
                          className="report-input-clear-btn"
                          onClick={() => { setClientSearch(''); setSelectedClientPhone('TODOS') }}
                        >
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      )}
                      {clientSearch && filteredClients.length > 0 && (
                        <div className="report-client-dropdown">
                          <div
                            className="rcd-item rcd-item-all"
                            onClick={() => { setSelectedClientPhone('TODOS'); setClientSearch('') }}
                          >
                            (Todos os clientes)
                          </div>
                          {filteredClients.map(u => (
                            <div
                              key={u.id}
                              className="rcd-item"
                              onClick={() => {
                                setSelectedClientPhone(u.telefone || u.id)
                                setClientSearch(`${u.nome || u.pushName || ''} (${u.telefone || ''})`)
                              }}
                            >
                              <strong>{u.nome || u.pushName}</strong> <span className="rcd-tel">({u.telefone})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="report-filter-options-bar">
                  <label className="report-checkbox-label">
                    <input
                      type="checkbox"
                      checked={excludeTests}
                      onChange={e => setExcludeTests(e.target.checked)}
                    />
                    <span>Excluir pedidos de teste (nomes com "teste" ou flags internas)</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* CARDS DE RESUMO EXECUTIVO (MÉTRICAS OFICIAIS THSM) */}
          <div className="report-kpi-grid">
            <div className="report-kpi-card" style={{ borderLeftColor: '#0284c7' }}>
              <div className="report-kpi-icon" style={{ background: '#e0f2fe', color: '#0284c7' }}>
                <i className="fa-solid fa-clipboard-list"></i>
              </div>
              <div className="report-kpi-content">
                <div className="report-kpi-val">{reportStats.totalPedidos}</div>
                <div className="report-kpi-label">Total Pedidos</div>
                <div className="report-kpi-sub">
                  <strong>{reportStats.pedidosVendaCount}</strong> vendas • <strong>{reportStats.pedidosZeradosTotalCount}</strong> zerados
                </div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeftColor: '#10b981', background: '#f0fdf4' }}>
              <div className="report-kpi-icon" style={{ background: '#d1fae5', color: '#059669' }}>
                <i className="fa-solid fa-dollar-sign"></i>
              </div>
              <div className="report-kpi-content">
                <div className="report-kpi-val text-success" style={{ fontSize: '1.25rem', color: '#059669' }}>
                  {formatCurrency(reportStats.faturamentoTotal)}
                </div>
                <div className="report-kpi-label" style={{ fontWeight: 800, color: '#065f46' }}>
                  Total Líquido Faturado
                </div>
                <div className="report-kpi-sub" style={{ color: '#047857' }}>
                  Receita real pós-descontos
                </div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeftColor: '#3b82f6' }}>
              <div className="report-kpi-icon" style={{ background: '#dbeafe', color: '#2563eb' }}>
                <i className="fa-solid fa-tags"></i>
              </div>
              <div className="report-kpi-content">
                <div className="report-kpi-val" style={{ color: '#1d4ed8' }}>
                  {formatCurrency(reportStats.valorItensTotal)}
                </div>
                <div className="report-kpi-label">Valor Itens (Tabela)</div>
                <div className="report-kpi-sub">Preço cheio de catálogo</div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeftColor: '#6366f1' }}>
              <div className="report-kpi-icon" style={{ background: '#e0e7ff', color: '#4f46e5' }}>
                <i className="fa-solid fa-receipt"></i>
              </div>
              <div className="report-kpi-content">
                <div className="report-kpi-val" style={{ color: '#4f46e5' }}>
                  - {formatCurrency(reportStats.descontosTotal)}
                </div>
                <div className="report-kpi-label">Descontos Concedidos</div>
                <div className="report-kpi-sub">Revendedora 30%, cupons</div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeftColor: '#f59e0b' }}>
              <div className="report-kpi-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
                <i className="fa-solid fa-boxes-stacked"></i>
              </div>
              <div className="report-kpi-content">
                <div className="report-kpi-val" style={{ color: '#b45309' }}>
                  {reportStats.totalItens} un
                </div>
                <div className="report-kpi-label">Total de Peças</div>
                <div className="report-kpi-sub">
                  {reportStats.totalQtdSemDev} s/d • {reportStats.totalQtdComDev} c/d
                </div>
              </div>
            </div>
          </div>

          {/* BANNER DO BALANÇO DE CONFERÊNCIA THSM */}
          <div className="report-balance-banner">
            <div className="rbb-left">
              <i className="fa-solid fa-scale-balanced"></i>
              <span>
                <strong>Balanço THSM:</strong> Valor Itens (<strong>{formatCurrency(reportStats.valorItensTotal)}</strong>) − Descontos (<strong>{formatCurrency(reportStats.descontosTotal)}</strong>) = Total Líquido (<strong>{formatCurrency(reportStats.faturamentoTotal)}</strong>)
              </span>
            </div>
            <div className="rbb-right">
              <i className="fa-solid fa-check-double"></i> Números 100% integrados
            </div>
          </div>

          {/* PRÉVIA DOS PEDIDOS RETRÁTIL */}
          <div className="report-preview-collapse">
            <div
              className="report-preview-header"
              onClick={() => setShowPreviewTable(v => !v)}
            >
              <div className="rph-title">
                <i className="fa-solid fa-table-list"></i>
                <span>Pré-visualização dos Pedidos ({targetOrders.length} pedidos)</span>
              </div>
              <div className="rph-actions">
                <span className="rph-badge">
                  {showPreviewTable ? 'Recolher Tabela' : 'Expandir Tabela'}
                </span>
                <i className={`fa-solid ${showPreviewTable ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
              </div>
            </div>

            {showPreviewTable && (
              <div className="report-preview-table-wrap">
                <table className="report-preview-table">
                  <thead>
                    <tr>
                      <th># / Vencimento</th>
                      <th>Cliente / Tel</th>
                      <th>Status / Tipo</th>
                      <th>Endereço Completo</th>
                      <th>Rota</th>
                      <th>Qtd</th>
                      <th>Produtos / Itens Descritos</th>
                      <th style={{ textAlign: 'right' }}>Valor Tabela</th>
                      <th style={{ textAlign: 'right' }}>Desconto</th>
                      <th style={{ textAlign: 'right' }}>Total Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetOrders.slice(0, 50).map(o => {
                      const st = getResolvedStatus(o)
                      const cfg = STATUS_CONFIG[st] || { label: st, color: '#333', bg: '#eee', border: '#ccc' }
                      const dev = getOrderDevolucaoStats(o, produtos)
                      const fin = getOrderFinancialDetails(o)
                      const endStr = formatFullAddress(o.customer?.endereco)
                      const dataVenc = getOrderDueDate(o, financial)

                      return (
                        <tr key={o.id}>
                          <td><strong>#{String(o.id).slice(-6)}</strong><br /><small style={{ color: '#64748b' }}>{formatDateBR(dataVenc)}</small></td>
                          <td><strong>{o.customer?.nome || '-'}</strong><br /><small style={{ color: '#64748b' }}>{o.customer?.telefone || '-'}</small></td>
                          <td>
                            <span
                              className="rsc-tag"
                              style={{
                                background: cfg.bg,
                                color: cfg.color,
                                border: `1px solid ${cfg.border || cfg.color}`
                              }}
                            >
                              {cfg.label}
                            </span>
                            {fin.isZero && (
                              <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '2px' }}>
                                ({fin.motivoZerado})
                              </div>
                            )}
                          </td>
                          <td style={{ maxWidth: '240px', fontSize: '0.72rem', color: '#334155' }}>{endStr}</td>
                          <td><strong>{o.customer?.endereco?.rota || '-'}</strong></td>
                          <td>{dev.qtdTotal} un</td>
                          <td style={{ minWidth: '160px' }}>
                            {multilineItems ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '0.72rem', color: '#334155' }}>
                                {(o.items && o.items.length > 0) ? o.items.map((i, idx) => {
                                  const isSem = checkItemSemDevolucao(i, produtos)
                                  return (
                                    <div key={idx} style={{ lineHeight: '1.25' }}>
                                      • <strong>{i.qty || 1}x</strong> {cleanProductName(i.nome)}
                                      {isSem && <span className="badge-semdev">[S/DEV]</span>}
                                    </div>
                                  )
                                }) : '-'}
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.72rem', color: '#334155', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {(o.items && o.items.length > 0) ? o.items.map(i => {
                                  const isSem = checkItemSemDevolucao(i, produtos)
                                  return `${i.qty || 1}x ${cleanProductName(i.nome)}${isSem ? ' [S/DEV]' : ''}`
                                }).join(' • ') : '-'}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right', color: '#475569', fontWeight: 600 }}>
                            {fin.isZero ? 'R$ 0,00' : formatCurrency(fin.valorItens)}
                          </td>
                          <td style={{ textAlign: 'right', color: '#6366f1', fontWeight: 600 }}>
                            {fin.isZero ? 'R$ 0,00' : (fin.desconto > 0 ? `- ${formatCurrency(fin.desconto)}` : '-')}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 800, color: st === 'calote' ? '#dc2626' : '#059669' }}>
                            {st === 'calote' ? `Calote: ${formatCurrency(o.caloteTotalVenda || fin.valorItens)}` : formatCurrency(fin.totalLiquido)}
                          </td>
                        </tr>
                      )
                    })}
                    {targetOrders.length > 50 && (
                      <tr>
                        <td colSpan="10" style={{ textAlign: 'center', padding: '0.65rem', color: '#64748b', fontStyle: 'italic' }}>
                          E mais {targetOrders.length - 50} pedidos (todos incluídos na Impressão, PDF e Excel)...
                        </td>
                      </tr>
                    )}
                    {targetOrders.length === 0 && (
                      <tr>
                        <td colSpan="10" style={{ textAlign: 'center', padding: '1rem', color: '#94a3b8' }}>
                          Nenhum pedido encontrado para os filtros selecionados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* RODAPÉ E AÇÕES COM DESIGN LIMPO */}
        <div className="order-report-footer">
          <div className="order-report-footer-toggles">
            <label className="report-toggle-pill">
              <input
                type="checkbox"
                checked={includePrices}
                onChange={e => setIncludePrices(e.target.checked)}
              />
              <i className={`fa-solid ${includePrices ? 'fa-dollar-sign' : 'fa-eye-slash'}`}></i>
              <span>{includePrices ? 'Com Valores (R$)' : 'Romaneio sem valores'}</span>
            </label>

            <label className="report-toggle-pill">
              <input
                type="checkbox"
                checked={multilineItems}
                onChange={e => setMultilineItems(e.target.checked)}
              />
              <i className={`fa-solid ${multilineItems ? 'fa-bars-staggered' : 'fa-grip-lines'}`}></i>
              <span>{multilineItems ? 'Múltiplas Linhas' : '1 Linha por pedido'}</span>
            </label>
          </div>

          <div className="order-report-footer-actions">
            <button
              type="button"
              className="report-btn report-btn-secondary"
              onClick={onClose}
            >
              Cancelar
            </button>

            <button
              type="button"
              className="report-btn report-btn-print"
              onClick={handlePrintView}
              title="Imprimir relatório diretamente na impressora ou salvar PDF no navegador"
            >
              <i className="fa-solid fa-print"></i>
              Imprimir Relatório
            </button>

            <button
              type="button"
              className="report-btn report-btn-excel"
              onClick={handleExportExcel}
              title="Exportar planilha Excel (.xlsx)"
            >
              <i className="fa-solid fa-file-excel"></i>
              Exportar Excel
            </button>

            <button
              type="button"
              className="report-btn report-btn-pdf"
              onClick={handleGeneratePDF}
              title="Baixar arquivo PDF formatado para impressão em folhas A4"
            >
              <i className="fa-solid fa-file-pdf"></i>
              Baixar PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
