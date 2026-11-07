import React, { useState, useMemo } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { clientMatchesSearch, isCityOrGeneric } from '../lib/search'
import './OrderReportModal.css'

const STATUS_CONFIG = {
  'pre-pedido': { label: 'Pré-Pedido', color: '#8b5cf6', bg: '#ede9fe' },
  'pendente': { label: 'Pendente', color: '#d97706', bg: '#fef3c7' },
  'confirmado': { label: 'Confirmado', color: '#2563eb', bg: '#dbeafe' },
  'em-andamento': { label: 'Em Andamento', color: '#4f46e5', bg: '#e0e7ff' },
  'em-rota': { label: 'Em Rota', color: '#0284c7', bg: '#e0f2fe' },
  'entregue': { label: 'Entregue (Praça)', color: '#059669', bg: '#d1fae5' },
  'acerto': { label: 'Acerto (Motoristas)', color: '#7c3aed', bg: '#f3e8ff' },
  'concluido': { label: 'Concluído (Pago)', color: '#16a34a', bg: '#dcfce7' },
  'calote_parcial': { label: 'Calote Parcial', color: '#d97706', bg: '#fef3c7' },
  'calote': { label: 'Calote 100%', color: '#dc2626', bg: '#fee2e2' },
  'cancelado': { label: 'Cancelado', color: '#94a3b8', bg: '#f1f5f9' }
};

// Helper financeiro oficial THSM por comanda
export function getOrderFinancialDetails(o) {
  const isTest = Boolean(o?.isTest || o?.is_test || (o?.customer?.nome && o.customer.nome.toLowerCase().includes('teste')));

  // Preço de tabela dos itens
  let valorItens = 0;
  if (o?.valor_itens !== undefined && Number(o.valor_itens) > 0) {
    valorItens = Number(o.valor_itens);
  } else {
    const items = o?.originalItems || o?.items || [];
    valorItens = items.reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0);
  }
  valorItens = Math.round(valorItens * 100) / 100;

  // Desconto concedido
  let desconto = 0;
  if (o?.desconto !== undefined && Number(o.desconto) >= 0) {
    desconto = Number(o.desconto);
  } else if (o?.descontoPercent) {
    desconto = Math.round(((Number(o.descontoPercent) / 100) * valorItens) * 100) / 100;
  }
  desconto = Math.round(desconto * 100) / 100;

  // Total líquido (valor_itens - desconto)
  let totalLiquido = 0;
  if (o?.total_liquido !== undefined && Number(o.total_liquido) >= 0) {
    totalLiquido = Number(o.total_liquido);
  } else if (valorItens > 0) {
    totalLiquido = Math.max(0, Math.round((valorItens - desconto) * 100) / 100);
  } else {
    totalLiquido = Number(o?.totalAcerto || o?.total || o?.totalPago || 0);
  }
  totalLiquido = Math.round(totalLiquido * 100) / 100;

  // Motivo do desconto
  let motivoDesconto = o?.motivo_desconto || '';
  if (!motivoDesconto) {
    if (desconto > 0) {
      if (Number(o?.descontoPercent) === 30 || Math.round((desconto / (valorItens || 1)) * 100) === 30) {
        motivoDesconto = 'Desconto revendedora (30%)';
      } else if (o?.cupom) {
        motivoDesconto = `Cupom (${o.cupom})`;
      } else if (o?.descontoPercent) {
        motivoDesconto = `Desconto percentual (${o.descontoPercent}%)`;
      } else {
        motivoDesconto = 'Ajuste manual (R$)';
      }
    } else {
      motivoDesconto = 'Sem desconto';
    }
  }

  // Motivo de pedido zerado
  let motivoZerado = o?.motivo_zerado || '';
  if (!motivoZerado && totalLiquido === 0) {
    if (o?.isBrinde || (o?.customer?.nome && o.customer.nome.toLowerCase().includes('brinde')) || (o?.observacoes && o.observacoes.toLowerCase().includes('brinde'))) {
      motivoZerado = 'Brinde';
    } else {
      motivoZerado = 'Devolução total';
    }
  }

  const totalPago = Number(o?.total_pago !== undefined ? o.total_pago : (o?.totalPago || (o?.status === 'concluido' ? totalLiquido : 0)));
  const saldoEmAberto = Number(o?.saldo_em_aberto !== undefined ? o.saldo_em_aberto : (o?.valorEmAberto || Math.max(0, totalLiquido - totalPago)));

  return {
    isTest,
    valorItens,
    desconto,
    totalLiquido,
    motivoDesconto,
    motivoZerado: totalLiquido === 0 ? (motivoZerado || 'Devolução total') : '-',
    totalPago: Math.round(totalPago * 100) / 100,
    saldoEmAberto: Math.round(saldoEmAberto * 100) / 100
  };
}

function formatCurrency(val) {
  return Number(val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDateBR(dateStr) {
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

// Verifica se um item é sem devolução
export function getItemCost(item, produtos = []) {
  if (item?.preco_custo != null && Number(item.preco_custo) > 0) return Number(item.preco_custo)
  if (item?.custo_unitario_pedido != null && Number(item.custo_unitario_pedido) > 0) return Number(item.custo_unitario_pedido)
  const norm = (v) => (v || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '')
  const p = produtos.find(prod => prod && (prod.id === item?.id || String(prod.id) === String(item?.id) || norm(prod.nome) === norm(item?.nome)))
  return Number(p?.preco_custo || p?.custo || p?.cost || 0)
}

export function checkItemSemDevolucao(item, produtos = []) {
  if (item?.semDevolucao === true || item?.semDevolucao === 1) return true
  const p = produtos.find(prod => prod.id === item?.id || String(prod.id) === String(item?.id) || norm(prod.nome) === norm(item?.nome))
  if (p?.semDevolucao) return true
  return isNoDevName(item?.nome)
}

// Formata o endereço completo do cliente
export function formatFullAddress(endereco) {
  if (!endereco) return '-'
  if (typeof endereco === 'string') return endereco.trim() || '-'
  const parts = []
  const ruaNum = [endereco.rua || endereco.logradouro, endereco.numero ? `nº ${endereco.numero}` : ''].filter(Boolean).join(', ')
  if (ruaNum) parts.push(ruaNum)
  if (endereco.complemento) parts.push(`(${endereco.complemento})`)
  if (endereco.bairro) parts.push(`Bairro ${endereco.bairro}`)
  const cidUf = [endereco.cidade, endereco.estado].filter(Boolean).join('/')
  if (cidUf) parts.push(cidUf)
  if (endereco.cep) parts.push(`CEP: ${endereco.cep}`)
  if (endereco.pontoReferencia) parts.push(`Ref: ${endereco.pontoReferencia}`)
  return parts.length > 0 ? parts.join(' - ') : '-'
}

// Calcula estatísticas de devolução para um pedido
export function getOrderDevolucaoStats(order, produtos = []) {
  let qtdTotal = 0
  let qtdSemDev = 0
  let qtdComDev = 0
  let totalSemDev = 0
  let totalComDev = 0

  const items = order.items || []
  items.forEach(i => {
    const qty = Number(i.qty) || 1
    const preco = Number(i.preco) || 0
    const subtotal = preco * qty
    qtdTotal += qty

    if (checkItemSemDevolucao(i, produtos)) {
      qtdSemDev += qty
      totalSemDev += subtotal
    } else {
      qtdComDev += qty
      totalComDev += subtotal
    }
  })

  const totalBruto = Number(order.total) || (totalSemDev + totalComDev)

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

export default function OrderReportModal({
  isOpen,
  onClose,
  orders = [],
  produtos = [],
  filteredOrdersFromScreen = [],
  selectedOrderIds = new Set(),
  usuarios = [],
  rotas = [],
  isFinalizada = () => false,
  showToast = () => {}
}) {
  // Escopo de dados: 'todos', 'tela', 'selecionados', 'custom'
  const hasSelected = selectedOrderIds && selectedOrderIds.size > 0
  const [scope, setScope] = useState(hasSelected ? 'selecionados' : 'todos')
  const [density, setDensity] = useState('compact') // 'compact' ou 'detailed'

  // Filtros customizados (inicia com todos os status marcados para puxar 100% dos pedidos)
  const [selectedStatuses, setSelectedStatuses] = useState(() => Object.keys(STATUS_CONFIG))
  const [selectedClientPhone, setSelectedClientPhone] = useState('TODOS')
  const [clientSearch, setClientSearch] = useState('')
  const [selectedCity, setSelectedCity] = useState('TODAS')
  const [selectedRoute, setSelectedRoute] = useState('TODAS')
  const [selectedPayment, setSelectedPayment] = useState('TODOS')
  const [devolucaoFilter, setDevolucaoFilter] = useState('todos') // 'todos', 'com_sem_dev', 'apenas_sem_dev', 'apenas_com_dev'
  const [excludeTests, setExcludeTests] = useState(true)
  const [includePrices, setIncludePrices] = useState(true)
  const [dateType, setDateType] = useState('pagamento') // 'pagamento', 'date' ou 'vencimento'
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Opções de relatório
  const [includeSummary, setIncludeSummary] = useState(true)
  const [includeItemsDetail, setIncludeItemsDetail] = useState(true) // Padrão ligado para descrever os itens como na foto do usuário!
  const [orientation, setOrientation] = useState('landscape') // 'landscape' para caber endereço completo e itens perfeitamente
  const [showPreviewTable, setShowPreviewTable] = useState(false)

  // Lista única de cidades e rotas
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
  // Normalização de status
  const getResolvedStatus = (o) => {
    if (o.isCalote || o.status === 'calote' || o.motivoEncerramento === 'calote_100') return 'calote'
    if (o.status === 'calote_parcial' || o.status === 'parcial' || (Boolean(o.isFinalizado) && Number(o.valorEmAberto) > 0 && Number(o.totalPago) > 0)) return 'calote_parcial'
    if (o.status === 'concluido' || (isFinalizada(o) && !o.isCalote && o.status !== 'calote')) return 'concluido'
    if (o.status === 'acerto') return 'acerto'
    if (o.status === 'entregue') return 'entregue'
    return o.status || 'pendente'
  }

  // Lista filtrada de pedidos
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

        // 2. Cliente
        if (selectedClientPhone !== 'TODOS') {
          const orderPhone = (o.customer?.telefone || '').replace(/\D/g, '')
          const targetPhone = selectedClientPhone.replace(/\D/g, '')
          if (!orderPhone.includes(targetPhone) && o.user_id !== selectedClientPhone) {
            return false
          }
        }

        // 3. Cidade
        if (selectedCity !== 'TODAS') {
          const c = o.customer?.endereco?.cidade || ''
          if (c.toLowerCase() !== selectedCity.toLowerCase()) return false
        }

        // 4. Rota
        if (selectedRoute !== 'TODAS') {
          const r = o.customer?.endereco?.rota || ''
          if (r.toLowerCase() !== selectedRoute.toLowerCase()) return false
        }

        // 5. Forma de Pagamento (modalidade ou meio de pagamento)
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

        // 6. Datas (ignora hora e ISO para nunca cortar a data final)
        const rawDate = dateType === 'pagamento'
          ? getOrderPaymentDate(o)
          : dateType === 'vencimento'
            ? (o.dataVencimento || o.vencimento || '')
            : (o.date || o.createdAt || o.dataInicio || o.created_at || '')
        const orderDateOnly = rawDate ? String(rawDate).split('T')[0].split(' ')[0] : ''
        if (startDate && orderDateOnly && orderDateOnly < startDate) return false
        if (endDate && orderDateOnly && orderDateOnly > endDate) return false

        return true
      })
    }

    // Filtro de pedidos de teste
    if (excludeTests) {
      list = list.filter(o => !o?.isTest && !o?.is_test && !(o?.customer?.nome && o.customer.nome.toLowerCase().includes('teste')))
    }

    // Filtro adicional de Devolução (Sem / Com Devolução)
    if (devolucaoFilter === 'sem_dev' || devolucaoFilter === 'com_sem_dev' || devolucaoFilter === 'apenas_sem_dev') {
      // Contém itens sem devolução: mostra todos os pedidos com pelo menos 1 item sem devolução, e mostra SÓ o item sem devolução
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
          isFilteredByDev: true,
          filteredDevType: 'sem_dev'
        }
      }).filter(Boolean)
    } else if (devolucaoFilter === 'com_dev' || devolucaoFilter === 'apenas_com_dev') {
      // Contém item com devolução: mostra todos os pedidos com pelo menos 1 item com devolução, e mostra SÓ o item com devolução
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
          isFilteredByDev: true,
          filteredDevType: 'com_dev'
        }
      }).filter(Boolean)
    }

    return [...list].sort((a, b) => {
      const getD = (x) => dateType === 'pagamento' ? getOrderPaymentDate(x) : (x.date || x.createdAt || x.created_at || '')
      const ta = new Date(getD(a) || 0).getTime()
      const tb = new Date(getD(b) || 0).getTime()
      return tb - ta
    })
  }, [
    orders,
    produtos,
    scope,
    filteredOrdersFromScreen,
    selectedOrderIds,
    selectedStatuses,
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

  // Resumo estatístico geral (fórmulas oficiais THSM)
  const reportStats = useMemo(() => {
    const totalPedidos = targetOrders.length
    let faturamentoTotal = 0
    let valorItensTotal = 0
    let descontosTotal = 0
    let totalItens = 0
    let totalQtdSemDev = 0
    let totalQtdComDev = 0
    let totalValorSemDev = 0
    let totalValorComDev = 0
    let vendaNaoRecebida = 0
    let calotePrejuizoCusto = 0
    let pagosComValorCount = 0
    let pagosZeradosCount = 0
    let calotesCount = 0

    const statusMap = {}
    Object.keys(STATUS_CONFIG).forEach(s => {
      statusMap[s] = { count: 0, total: 0 }
    })

    const pagMap = { avista: 0, aprazo: 0, misto: 0, outro: 0 }

    targetOrders.forEach(o => {
      const dev = getOrderDevolucaoStats(o, produtos)
      const fin = getOrderFinancialDetails(o)
      const st = getResolvedStatus(o)

      totalItens += dev.qtdTotal
      totalQtdSemDev += dev.qtdSemDev
      totalQtdComDev += dev.qtdComDev
      totalValorSemDev += dev.totalSemDev
      totalValorComDev += dev.totalComDev

      if (!statusMap[st]) statusMap[st] = { count: 0, total: 0 }
      statusMap[st].count += 1

      if (st === 'concluido') {
        // Pedido pago oficial
        faturamentoTotal += fin.totalLiquido
        valorItensTotal += fin.valorItens
        descontosTotal += fin.desconto
        statusMap[st].total += fin.totalLiquido
        if (fin.totalLiquido > 0) {
          pagosComValorCount += 1
        } else {
          pagosZeradosCount += 1
        }
      } else if (st === 'calote') {
        // Calote 100%
        const caloteVenda = Number(o.caloteTotalVenda || fin.valorItens || o.totalOriginal || o.total || 0)
        vendaNaoRecebida += caloteVenda
        statusMap[st].total += caloteVenda
        calotesCount += 1
        calotePrejuizoCusto += Number(o.caloteTotalCusto || 0)
      } else {
        statusMap[st].total += fin.totalLiquido
      }

      const p = o.pagamento || 'outro'
      if (pagMap[p] !== undefined) pagMap[p] += fin.totalLiquido
      else pagMap.outro += fin.totalLiquido
    })

    // Ticket médio oficial dos pedidos pagos com valor (R$ 260,51 para os 221 pedidos)
    const ticketMedio = pagosComValorCount > 0 ? (faturamentoTotal / pagosComValorCount) : 0

    const porStatus = Object.entries(statusMap)
      .filter(([_, data]) => data.count > 0)
      .map(([statusKey, data]) => ({
        key: statusKey,
        label: STATUS_CONFIG[statusKey]?.label || statusKey,
        color: STATUS_CONFIG[statusKey]?.color || '#64748b',
        bg: STATUS_CONFIG[statusKey]?.bg || '#f1f5f9',
        count: data.count,
        total: data.total,
        percent: faturamentoTotal > 0 ? (data.total / faturamentoTotal) * 100 : 0
      }))
      .sort((a, b) => b.total - a.total)

    return {
      totalPedidos,
      faturamentoTotal: Math.round(faturamentoTotal * 100) / 100,
      valorItensTotal: Math.round(valorItensTotal * 100) / 100,
      descontosTotal: Math.round(descontosTotal * 100) / 100,
      ticketMedio: Math.round(ticketMedio * 100) / 100,
      pagosComValorCount,
      pagosZeradosCount,
      calotesCount,
      vendaNaoRecebida: Math.round(vendaNaoRecebida * 100) / 100,
      calotePrejuizoCusto: Math.round(calotePrejuizoCusto * 100) / 100,
      totalItens,
      totalQtdSemDev,
      totalQtdComDev,
      totalValorSemDev,
      totalValorComDev,
      porStatus,
      pagMap
    }
  }, [targetOrders, produtos, isFinalizada])

  // Presets de status (com Calotes 100%, Calote Parcial e Inadimplência)
  const applyStatusPreset = (preset) => {
    switch (preset) {
      case 'todos':
        setSelectedStatuses(Object.keys(STATUS_CONFIG))
        break
      case 'pendentes_a_concluidos':
        setSelectedStatuses(['pre-pedido', 'pendente', 'confirmado', 'em-andamento', 'em-rota', 'acerto', 'entregue', 'concluido'])
        break
      case 'calotes':
        setSelectedStatuses(['calote'])
        break
      case 'calote_parcial':
        setSelectedStatuses(['calote_parcial'])
        break
      case 'inadimplencia':
        setSelectedStatuses(['calote', 'calote_parcial'])
        break
      case 'concluidos':
        setSelectedStatuses(['concluido'])
        break
      case 'entregues':
        setSelectedStatuses(['entregue'])
        break
      case 'acertos':
        setSelectedStatuses(['acerto'])
        break
      case 'rota':
        setSelectedStatuses(['em-rota'])
        break
      case 'pendentes':
        setSelectedStatuses(['pre-pedido', 'pendente'])
        break
      case 'cancelados':
        setSelectedStatuses(['cancelado'])
        break
      default:
        break
    }
  }

  const toggleStatusTag = (statusKey) => {
    setSelectedStatuses(prev => {
      if (prev.includes(statusKey)) {
        return prev.filter(s => s !== statusKey)
      } else {
        return [...prev, statusKey]
      }
    })
  }

  // Presets de data
  const applyDatePreset = (preset) => {
    const today = new Date()
    const formatDateYMD = (d) => d.toISOString().split('T')[0]

    if (preset === 'today') {
      const str = formatDateYMD(today)
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
    } else if (preset === 'last60') {
      const past = new Date()
      past.setDate(today.getDate() - 60)
      setStartDate(formatDateYMD(past))
      setEndDate(formatDateYMD(today))
    } else if (preset === 'last90') {
      const past = new Date()
      past.setDate(today.getDate() - 90)
      setStartDate(formatDateYMD(past))
      setEndDate(formatDateYMD(today))
    } else if (preset === 'this_month') {
      const first = new Date(today.getFullYear(), today.getMonth(), 1)
      setStartDate(formatDateYMD(first))
      setEndDate(formatDateYMD(today))
    } else if (preset === 'clear') {
      setStartDate('')
      setEndDate('')
    }
  }

  const filteredClients = useMemo(() => {
    if (!usuarios) return []
    if (!clientSearch) return usuarios.slice(0, 50)
    return usuarios.filter(u => clientMatchesSearch(u, clientSearch)).slice(0, 100)
  }, [usuarios, clientSearch])

  // ==========================================
  // GERAÇÃO DE PDF ULTRA-COMPACTO E PROFISSIONAL (POUCAS PÁGINAS)
  // ==========================================
  const handleGeneratePDF = () => {
    if (targetOrders.length === 0) {
      showToast('Nenhum pedido encontrado com os filtros selecionados.', 'error')
      return
    }

    try {
      const doc = new jsPDF({
        orientation: orientation === 'landscape' ? 'landscape' : 'portrait',
        unit: 'mm',
        format: 'a4'
      })

      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()
      const nowStr = new Date().toLocaleString('pt-BR')

      // 1. Cabeçalho Corporativo THSM Ultra-Compacto (12mm)
      const headerH = 12
      doc.setFillColor(15, 23, 42) // #0f172a
      doc.rect(0, 0, pageWidth, headerH, 'F')

      doc.setTextColor(255, 255, 255)
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.text('THSM DISTRIBUIDORA', 10, 7.5)

      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(148, 163, 184)
      doc.text('RELATÓRIO GERENCIAL DE PEDIDOS COM ENDEREÇO E PRODUTOS', 64, 7.5)

      doc.setFontSize(6.8)
      doc.setTextColor(203, 213, 225)
      doc.text(`Emissão: ${nowStr}   |   Total: ${reportStats.totalPedidos} pedidos`, pageWidth - 10, 7.5, { align: 'right' })

      let currentY = 14.5

      // 2. Metadados dos Filtros (Faixa compacta 5.5mm)
      doc.setFillColor(241, 245, 249)
      doc.rect(10, currentY, pageWidth - 20, 5.5, 'F')
      doc.setDrawColor(226, 232, 240)
      doc.rect(10, currentY, pageWidth - 20, 5.5, 'S')

      doc.setFontSize(6.5)
      doc.setTextColor(71, 85, 105)
      doc.setFont('helvetica', 'bold')

      const statusDesc = selectedStatuses.length === Object.keys(STATUS_CONFIG).length
        ? 'Todos os Status'
        : selectedStatuses.map(s => STATUS_CONFIG[s]?.label || s).join(', ')

      const dateDesc = startDate || endDate
        ? `${startDate ? formatDateBR(startDate) : 'Início'} até ${endDate ? formatDateBR(endDate) : 'Hoje'}`
        : 'Todo o Período'

      const devDesc = devolucaoFilter === 'todos'
        ? 'Todos os pedidos (com e sem devolução)'
        : (devolucaoFilter === 'sem_dev' || devolucaoFilter === 'com_sem_dev' || devolucaoFilter === 'apenas_sem_dev')
          ? 'Contém itens SEM devolução (mostrando só itens s/ dev)'
          : 'Contém item COM devolução (mostrando só itens c/ dev)'
      const scopeDesc = scope === 'todos' ? 'Todos os Pedidos' : scope === 'selecionados' ? 'Selecionados' : scope === 'tela' ? 'Filtros da Tela' : 'Personalizado'

      const filterLine = `Escopo: ${scopeDesc} | Status: ${statusDesc} | Devolução: ${devDesc} | Período: ${dateDesc} | Cidade: ${selectedCity} | Rota: ${selectedRoute}`
      doc.text(filterLine.slice(0, 160), 13, currentY + 3.8)

      currentY += 7.5

      // 3. Resumo Executivo e KPIs Compacto (8mm de altura)
      if (includeSummary) {
        const cardCount = 5
        const gap = 2.5
        const totalW = pageWidth - 20
        const cardW = (totalW - (gap * (cardCount - 1))) / cardCount
        const cardH = 8
        const kpis = [
          { label: 'TOTAL PEDIDOS', val: `${reportStats.totalPedidos} pedidos`, color: [2, 132, 199] },
          { label: 'TOTAL BRUTO', val: formatCurrency(reportStats.faturamentoTotal), color: [16, 185, 129] },
          { label: 'SEM DEVOLUÇÃO', val: formatCurrency(reportStats.totalValorSemDev), color: [220, 38, 38] },
          { label: 'COM DEVOLUÇÃO', val: formatCurrency(reportStats.totalValorComDev), color: [79, 70, 229] },
          { label: 'TOTAL DE ITENS', val: `${reportStats.totalItens} un (${reportStats.totalQtdSemDev} s/dev)`, color: [245, 158, 11] }
        ]

        kpis.forEach((kpi, idx) => {
          const kpiX = 10 + idx * (cardW + gap)
          doc.setFillColor(248, 250, 252)
          doc.rect(kpiX, currentY, cardW, cardH, 'F')
          doc.setDrawColor(226, 232, 240)
          doc.rect(kpiX, currentY, cardW, cardH, 'S')

          doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2])
          doc.rect(kpiX, currentY, 2, cardH, 'F')

          doc.setFontSize(5.2)
          doc.setTextColor(100, 116, 139)
          doc.setFont('helvetica', 'bold')
          doc.text(kpi.label, kpiX + 3.5, currentY + 3.2)

          doc.setFontSize(7.2)
          doc.setTextColor(15, 23, 42)
          doc.text(kpi.val, kpiX + 3.5, currentY + 6.6)
        })

        currentY += cardH + 3
      }

      // 4. Tabela de Pedidos (Com ou Sem Valores)
      const showVal = includePrices !== false
      const tableHeaders = showVal ? [
        '# / Data',
        'Cliente / Tel',
        'Status',
        'Endereço Completo / Destino',
        'Rota',
        'Qtd',
        'Produtos / Itens',
        'Preço Tabela',
        'Total Líquido'
      ] : [
        '# / Data',
        'Cliente / Tel',
        'Status',
        'Endereço Completo / Destino',
        'Rota',
        'Qtd',
        'Produtos / Itens Descritos'
      ]

      const tableBody = []

      targetOrders.forEach(o => {
        const dev = getOrderDevolucaoStats(o, produtos)
        const dateStr = formatDateBR(o.date || o.createdAt)
        const numId = `#${String(o.id).slice(-6)}`
        const numDataStr = `${numId}\n${dateStr}`
        const clienteStr = `${o.customer?.nome || 'Não informado'}\n${o.customer?.telefone || '-'}`
        const resStatus = getResolvedStatus(o)
        const statusLabel = STATUS_CONFIG[resStatus]?.label || resStatus
        const enderecoCompleto = formatFullAddress(o.customer?.endereco)
        const rotaStr = o.customer?.endereco?.rota || '-'

        let qtdStr = `${dev.qtdTotal} un`
        if (dev.qtdSemDev > 0) qtdStr += `\n(${dev.qtdSemDev} s/d)`

        // Formatação dos produtos inline super compacta
        let prodsInline = '-'
        if (o.items && o.items.length > 0) {
          prodsInline = o.items.map(i => {
            const isSem = checkItemSemDevolucao(i, produtos)
            return `${i.qty || 1}x ${i.nome}${isSem ? ' [S/DEV]' : ''}`
          }).join(' • ')
        }

        // Linha do pedido (com ou sem valores)
        const fin = getOrderFinancialDetails(o)
        if (showVal) {
          tableBody.push([
            numDataStr,
            clienteStr,
            statusLabel,
            enderecoCompleto,
            rotaStr,
            qtdStr,
            prodsInline,
            formatCurrency(fin.valorItens),
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

        // Se density === 'detailed', adiciona sublinha detalhada
        if (density === 'detailed' && includeItemsDetail && o.items && o.items.length > 0) {
          const itemsDetailedText = o.items.map(item => {
            const isSem = checkItemSemDevolucao(item, produtos)
            const sub = Number(item.preco || 0) * Number(item.qty || 1)
            return `• ${item.qty || 1}x ${item.nome} (${formatCurrency(sub)})${isSem ? ' [SEM DEVOLUÇÃO]' : ''}`
          }).join('\n')

          tableBody.push([
            { content: '', styles: { cellPadding: 1 } },
            { content: `PRODUTOS DO PEDIDO ${numId}:\n${itemsDetailedText}`, colSpan: 8, styles: { fontSize: 6, textColor: [51, 65, 85], fontStyle: 'italic', fillColor: [248, 250, 252] } }
          ])
        }
      })

      // Linha de Totalizador (com ou sem valores)
      const footRow = showVal ? [
        'TOTAL GERAL',
        `${reportStats.totalPedidos} pedido(s)`,
        '',
        '',
        '',
        `${reportStats.totalItens} un`,
        `Sem Dev: ${reportStats.totalQtdSemDev} un`,
        formatCurrency(reportStats.valorItensTotal),
        formatCurrency(reportStats.faturamentoTotal)
      ] : [
        'TOTAL GERAL',
        `${reportStats.totalPedidos} pedido(s)`,
        '',
        '',
        '',
        `${reportStats.totalItens} un`,
        `Sem Dev: ${reportStats.totalQtdSemDev} un`
      ]

      const colStyles = orientation === 'landscape' ? {
        0: { cellWidth: 17 }, // # / Data
        1: { cellWidth: 36 }, // Cliente / Tel
        2: { cellWidth: 17 }, // Status
        3: { cellWidth: 46 }, // Endereço Completo
        4: { cellWidth: 15 }, // Rota
        5: { cellWidth: 11, halign: 'center' }, // Qtd
        6: { cellWidth: 93 }, // Produtos (inline compact)
        7: { cellWidth: 18, halign: 'right' }, // S/ Dev
        8: { cellWidth: 24, halign: 'right', fontStyle: 'bold', textColor: [16, 185, 129] } // Total Bruto
      } : {
        0: { cellWidth: 15 },
        1: { cellWidth: 30 },
        2: { cellWidth: 15 },
        3: { cellWidth: 35 },
        4: { cellWidth: 14 },
        5: { cellWidth: 10, halign: 'center' },
        6: { cellWidth: 41 },
        7: { cellWidth: 15, halign: 'right' },
        8: { cellWidth: 19, halign: 'right', fontStyle: 'bold', textColor: [16, 185, 129] }
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
          fontSize: 6.8,
          fontStyle: 'bold',
          cellPadding: 1.5
        },
        bodyStyles: {
          fontSize: 6.2,
          cellPadding: 1.2,
          textColor: [15, 23, 42],
          valign: 'middle'
        },
        footStyles: {
          fillColor: [226, 232, 240],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          fontSize: 6.8,
          cellPadding: 1.5
        },
        columnStyles: colStyles,
        margin: { left: 10, right: 10, top: 10, bottom: 8 }
      })

      // Rodapé em todas as páginas
      const totalPages = doc.internal.getNumberOfPages()
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i)
        doc.setFontSize(6.8)
        doc.setTextColor(148, 163, 184)
        doc.setDrawColor(226, 232, 240)
        doc.line(10, pageHeight - 7, pageWidth - 10, pageHeight - 7)
        doc.text('THSM Distribuidora — Sistema Comercial e Logística', 10, pageHeight - 4)
        doc.text(`Página ${i} de ${totalPages}`, pageWidth - 10, pageHeight - 4, { align: 'right' })
      }

      const fileName = `Relatorio_Pedidos_THSM_${new Date().toISOString().split('T')[0]}.pdf`
      doc.save(fileName)
      showToast(`Relatório PDF gerado (${totalPages} pág) e baixado com sucesso!`, 'success')
    } catch (err) {
      console.error('Erro ao gerar PDF:', err)
      showToast('Erro ao gerar arquivo PDF. Verifique o console.', 'error')
    }
  }

  // ==========================================
  // EXPORTAÇÃO EXCEL PROFISSIONAL (.xlsx) EM TABELA PLANA (PADRÃO OFICIAL THSM)
  // ==========================================
  const handleExportExcel = () => {
    if (targetOrders.length === 0) {
      showToast('Nenhum pedido encontrado com os filtros selecionados.', 'error')
      return
    }

    try {
      const wb = XLSX.utils.book_new()
      const nowStr = new Date().toLocaleString('pt-BR')

      // ==========================================
      // ABA 1: RELATÓRIO DE PEDIDOS (TABELA PLANA - 1 LINHA POR PEDIDO)
      // ==========================================
      const excelHeaders = [
        'id_pedido',
        'data_pedido',
        'cliente',
        'telefone',
        'status',
        'pedido_teste',
        'cidade',
        'rota',
        'endereco_completo',
        'quantidade_itens',
        'valor_itens',
        'desconto',
        'motivo_desconto',
        'total_liquido',
        'total_pago',
        'saldo_em_aberto',
        'motivo_zerado',
        'resumo_itens'
      ]

      const mainSheetData = [excelHeaders]

      targetOrders.forEach(o => {
        const fin = getOrderFinancialDetails(o)
        const dev = getOrderDevolucaoStats(o, produtos)
        const dateStr = formatDateBR(o.date || o.createdAt)
        const resStatus = getResolvedStatus(o)
        const statusLabel = STATUS_CONFIG[resStatus]?.label || resStatus
        const enderecoCompleto = formatFullAddress(o.customer?.endereco)
        const rotaStr = o.customer?.endereco?.rota || '-'
        const cidadeStr = o.customer?.endereco?.cidade || '-'

        const resumoItens = (o.items || []).map(i => `${i.qty || 1}x ${i.nome}`).join(' • ') || '-'

        // Linha plana do Pedido (sem linhas em branco intermediárias para garantir compatibilidade com Tabelas Dinâmicas)
        mainSheetData.push([
          o.id,
          dateStr,
          o.customer?.nome || '-',
          o.customer?.telefone || '-',
          statusLabel,
          fin.isTest ? 'Sim' : 'Não',
          cidadeStr,
          rotaStr,
          enderecoCompleto,
          dev.qtdTotal,
          fin.valorItens,
          fin.desconto,
          fin.motivoDesconto,
          fin.totalLiquido,
          fin.totalPago,
          fin.saldoEmAberto,
          fin.motivoZerado,
          resumoItens
        ])
      })

      const wsMain = XLSX.utils.aoa_to_sheet(mainSheetData)
      wsMain['!cols'] = [
        { wch: 14 }, // id_pedido
        { wch: 14 }, // data_pedido
        { wch: 28 }, // cliente
        { wch: 16 }, // telefone
        { wch: 18 }, // status
        { wch: 14 }, // pedido_teste
        { wch: 18 }, // cidade
        { wch: 14 }, // rota
        { wch: 45 }, // endereco_completo
        { wch: 16 }, // quantidade_itens
        { wch: 18 }, // valor_itens
        { wch: 16 }, // desconto
        { wch: 28 }, // motivo_desconto
        { wch: 18 }, // total_liquido
        { wch: 16 }, // total_pago
        { wch: 16 }, // saldo_em_aberto
        { wch: 18 }, // motivo_zerado
        { wch: 50 }  // resumo_itens
      ]
      XLSX.utils.book_append_sheet(wb, wsMain, 'Pedidos (Tabela Plana)')

      // ==========================================
      // ABA 2: RELATÓRIO DEDICADO DE CALOTES (100% E PARCIAL)
      // ==========================================
      const caloteOrders = targetOrders.filter(o => {
        const resSt = getResolvedStatus(o)
        const fin = getOrderFinancialDetails(o)
        return resSt === 'calote' || resSt === 'calote_parcial' || Number(fin.saldoEmAberto) > 0 || o.isCalote
      })

      const caloteHeaders = [
        'id_pedido',
        'data_pedido',
        'cliente',
        'telefone',
        'tipo_calote',
        'cidade',
        'rota',
        'endereco_completo',
        'quantidade_itens',
        'valor_itens_tabela',
        'desconto',
        'total_a_cobrar',
        'total_pago',
        'saldo_devedor_aberto',
        'prejuizo_custo_estimado',
        'venda_nao_recebida',
        'resumo_itens'
      ]

      const caloteRows = caloteOrders.map(o => {
        const fin = getOrderFinancialDetails(o)
        const dev = getOrderDevolucaoStats(o, produtos)
        const resSt = getResolvedStatus(o)
        const tipoCalote = resSt === 'calote' ? 'Calote 100%' : (resSt === 'calote_parcial' ? 'Calote Parcial' : 'Saldo Aberto')
        const dateStr = formatDateBR(o.date || o.createdAt)
        const resumoItens = (o.items || []).map(i => `${i.qty || 1}x ${i.nome}`).join(' • ') || '-'
        const prejuizoCusto = Number(o.caloteTotalCusto || (o.items || []).reduce((acc, i) => acc + (Number(getItemCost(i, produtos)) * (Number(i.caloteQty || i.qty) || 0)), 0)) || 0

        return [
          o.id,
          dateStr,
          o.customer?.nome || '-',
          o.customer?.telefone || '-',
          tipoCalote,
          o.customer?.endereco?.cidade || '-',
          o.customer?.endereco?.rota || '-',
          formatFullAddress(o.customer?.endereco),
          dev.qtdTotal,
          fin.valorItens,
          fin.desconto,
          fin.totalLiquido,
          fin.totalPago,
          fin.saldoEmAberto,
          prejuizoCusto > 0 ? prejuizoCusto : 'Pendente de custo',
          Number(o.caloteTotalVenda || fin.valorItens),
          resumoItens
        ]
      })

      if (caloteRows.length > 0) {
        const wsCalote = XLSX.utils.aoa_to_sheet([caloteHeaders, ...caloteRows])
        wsCalote['!cols'] = [
          { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 18 },
          { wch: 18 }, { wch: 14 }, { wch: 45 }, { wch: 16 }, { wch: 18 },
          { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 22 },
          { wch: 20 }, { wch: 50 }
        ]
        XLSX.utils.book_append_sheet(wb, wsCalote, 'Calotes (100% e Parcial)')
      }

      // ==========================================
      // ABA 3: MERCADORIA NA PRAÇA & ACERTOS EM ABERTO
      // ==========================================
      const pracaOrders = targetOrders.filter(o => {
        const resSt = getResolvedStatus(o)
        return resSt === 'entregue' || resSt === 'acerto'
      })

      if (pracaOrders.length > 0) {
        const pracaHeaders = [
          'id_pedido',
          'data_pedido',
          'cliente',
          'telefone',
          'status',
          'cidade',
          'rota',
          'endereco_completo',
          'quantidade_pecas',
          'valor_consignado_tabela',
          'data_vencimento',
          'resumo_itens'
        ]
        const pracaRows = pracaOrders.map(o => {
          const resSt = getResolvedStatus(o)
          const fin = getOrderFinancialDetails(o)
          const dev = getOrderDevolucaoStats(o, produtos)
          return [
            o.id,
            formatDateBR(o.date || o.createdAt),
            o.customer?.nome || '-',
            o.customer?.telefone || '-',
            resSt === 'entregue' ? 'Entregue (Praça)' : 'Acerto (Motoristas)',
            o.customer?.endereco?.cidade || '-',
            o.customer?.endereco?.rota || '-',
            formatFullAddress(o.customer?.endereco),
            dev.qtdTotal,
            fin.valorItens,
            formatDateBR(o.dataVencimento || o.vencimento),
            (o.items || []).map(i => `${i.qty || 1}x ${i.nome}`).join(' • ') || '-'
          ]
        })
        const wsPraca = XLSX.utils.aoa_to_sheet([pracaHeaders, ...pracaRows])
        wsPraca['!cols'] = [
          { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 20 },
          { wch: 18 }, { wch: 14 }, { wch: 45 }, { wch: 16 }, { wch: 22 },
          { wch: 16 }, { wch: 50 }
        ]
        XLSX.utils.book_append_sheet(wb, wsPraca, 'Mercadoria na Praça (Aberto)')
      }

      // ==========================================
      // ABA 4: VENDAS CONCLUÍDAS (PAGAS)
      // ==========================================
      const pagasOrders = targetOrders.filter(o => getResolvedStatus(o) === 'concluido')
      if (pagasOrders.length > 0) {
        const pagasHeaders = [
          'id_pedido',
          'data_pedido',
          'cliente',
          'telefone',
          'cidade',
          'rota',
          'quantidade_itens',
          'valor_itens_tabela',
          'desconto',
          'motivo_desconto',
          'receita_liquida_paga',
          'forma_pagamento',
          'motivo_zerado'
        ]
        const pagasRows = pagasOrders.map(o => {
          const fin = getOrderFinancialDetails(o)
          const dev = getOrderDevolucaoStats(o, produtos)
          return [
            o.id,
            formatDateBR(o.date || o.createdAt),
            o.customer?.nome || '-',
            o.customer?.telefone || '-',
            o.customer?.endereco?.cidade || '-',
            o.customer?.endereco?.rota || '-',
            dev.qtdTotal,
            fin.valorItens,
            fin.desconto,
            fin.motivoDesconto,
            fin.totalLiquido,
            o.paymentMethod || o.pagamento || 'pix',
            fin.motivoZerado
          ]
        })
        const wsPagas = XLSX.utils.aoa_to_sheet([pagasHeaders, ...pagasRows])
        wsPagas['!cols'] = [
          { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 16 }, { wch: 18 },
          { wch: 14 }, { wch: 16 }, { wch: 18 }, { wch: 14 }, { wch: 26 },
          { wch: 20 }, { wch: 18 }, { wch: 18 }
        ]
        XLSX.utils.book_append_sheet(wb, wsPagas, 'Vendas Pagas (Concluídos)')
      }

      // ==========================================
      // ABA 5: ITENS DOS PEDIDOS (TABELA PLANA DETALHADA)
      // ==========================================
      const itensHeaders = [
        'id_pedido',
        'data_pedido',
        'cliente',
        'status_pedido',
        'pedido_teste',
        'cidade',
        'rota',
        'produto',
        'quantidade',
        'preco_unitario',
        'subtotal',
        'custo_unitario',
        'custo_total',
        'quantidade_devolvida',
        'tipo_devolucao'
      ]

      const itensRows = []
      targetOrders.forEach(o => {
        const isTest = Boolean(o?.isTest || o?.is_test || (o?.customer?.nome && o.customer.nome.toLowerCase().includes('teste')))
        const resStatus = getResolvedStatus(o)
        const statusLabel = STATUS_CONFIG[resStatus]?.label || resStatus
        const dateStr = formatDateBR(o.date || o.createdAt)

        ;(o.items || []).forEach(item => {
          const isSem = checkItemSemDevolucao(item, produtos)
          const qty = Number(item.qty) || 1
          const preco = Number(item.preco) || 0
          const subtotal = Math.round(preco * qty * 100) / 100
          const custoUnit = Number(item.preco_custo || item.custo_unitario_pedido || getItemCost(item, produtos)) || 0
          const custoTotal = Math.round(custoUnit * qty * 100) / 100
          const retQty = Number(item.returnedQty || item.caloteDevolvidoQty || 0)

          itensRows.push([
            o.id,
            dateStr,
            o.customer?.nome || '-',
            statusLabel,
            isTest ? 'Sim' : 'Não',
            o.customer?.endereco?.cidade || '-',
            o.customer?.endereco?.rota || '-',
            item.nome || '-',
            qty,
            preco,
            subtotal,
            custoUnit > 0 ? custoUnit : 'Indisponível',
            custoTotal > 0 ? custoTotal : 'Indisponível',
            retQty,
            isSem ? 'SEM DEVOLUÇÃO' : 'COM DEVOLUÇÃO'
          ])
        })
      })

      if (itensRows.length > 0) {
        const wsItens = XLSX.utils.aoa_to_sheet([itensHeaders, ...itensRows])
        wsItens['!cols'] = [
          { wch: 14 }, { wch: 12 }, { wch: 26 }, { wch: 18 }, { wch: 14 },
          { wch: 16 }, { wch: 14 }, { wch: 32 }, { wch: 12 }, { wch: 18 },
          { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 20 }
        ]
        XLSX.utils.book_append_sheet(wb, wsItens, 'Itens (Tabela Plana)')
      }

      // ==========================================
      // ABA 3: RESUMO EXECUTIVO (MÉTRICAS OFICIAIS THSM)
      // ==========================================
      const resumoData = [
        ['THSM DISTRIBUIDORA - RESUMO EXECUTIVO DE PEDIDOS'],
        [`Gerado em: ${nowStr}`],
        [`Pedidos de teste: ${excludeTests ? 'Excluídos' : 'Incluídos'}`],
        [],
        ['1. VOLUME DE PEDIDOS'],
        ['Total de Pedidos no Escopo', reportStats.totalPedidos],
        ['Pedidos Concluídos Pagos', reportStats.pagosComValorCount + reportStats.pagosZeradosCount],
        ['  - Pagos com Valor (> R$ 0,00)', reportStats.pagosComValorCount],
        ['  - Pagos Zerados (Devolução total / Brinde)', reportStats.pagosZeradosCount],
        ['Pedidos em Calote Total (100%)', reportStats.calotesCount],
        ['Total de Peças / Itens', reportStats.totalItens],
        ['Qtd Peças SEM Devolução', reportStats.totalQtdSemDev],
        ['Qtd Peças COM Devolução', reportStats.totalQtdComDev],
        [],
        ['2. FATURAMENTO E RECEBIMENTOS'],
        ['Valor dos Itens dos Pagos (Preço de Tabela)', reportStats.valorItensTotal],
        ['Descontos Concedidos nos Pagos', reportStats.descontosTotal],
        ['Receita Líquida Recebida (Faturamento Real)', reportStats.faturamentoTotal],
        ['Venda Não Recebida (Calotes a Preço de Venda)', reportStats.vendaNaoRecebida],
        ['Ticket Médio dos Pagos com Valor', reportStats.ticketMedio],
        [],
        ['3. CUSTO E LUCRO REAL'],
        ['Prejuízo Calote a Preço de Custo', reportStats.calotePrejuizoCusto > 0 ? reportStats.calotePrejuizoCusto : 'Pendente de custo unitário'],
        [],
        ['4. DISTRIBUIÇÃO POR STATUS'],
        ['Status', 'Qtd Pedidos', 'Valor Total (R$)', '% Participação']
      ]

      reportStats.porStatus.forEach(st => {
        resumoData.push([st.label, st.count, st.total, Number(st.percent.toFixed(2))])
      })

      const wsResumo = XLSX.utils.aoa_to_sheet(resumoData)
      wsResumo['!cols'] = [{ wch: 42 }, { wch: 26 }, { wch: 22 }, { wch: 18 }]
      XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo Geral (THSM)')

      const fileName = `relatorio_thsm_${new Date().toISOString().split('T')[0]}.xlsx`
      XLSX.writeFile(wb, fileName)
      showToast('Planilha Excel (.xlsx) exportada com sucesso em formato de tabela plana!', 'success')
    } catch (err) {
      console.error('Erro ao exportar Excel:', err)
      showToast('Erro ao exportar para Excel. Verifique o console.', 'error')
    }
  }

  // ==========================================
  // IMPRESSÃO / SALVAR PDF NATIVO VIA BROWSER ULTRA-COMPACTO (COM OU SEM VALORES)
  // ==========================================
  const handlePrintView = () => {
    if (targetOrders.length === 0) {
      showToast('Nenhum pedido para imprimir.', 'error')
      return
    }

    const printWin = window.open('', '_blank', 'width=1200,height=800')
    if (!printWin) {
      showToast('Pop-up bloqueado pelo navegador. Autorize pop-ups para imprimir.', 'error')
      return
    }

    const nowStr = new Date().toLocaleString('pt-BR')
    const showVal = includePrices !== false

    const statusDesc = selectedStatuses.length === Object.keys(STATUS_CONFIG).length
      ? 'Todos os Status'
      : selectedStatuses.map(s => STATUS_CONFIG[s]?.label || s).join(', ')

    const devDesc = devolucaoFilter === 'todos'
      ? 'Todos os pedidos (com e sem devolução)'
      : (devolucaoFilter === 'sem_dev' || devolucaoFilter === 'com_sem_dev' || devolucaoFilter === 'apenas_sem_dev')
        ? 'Contém itens SEM devolução (mostrando só itens s/ dev)'
        : 'Contém item COM devolução (mostrando só itens c/ dev)'

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>THSM Distribuidora — Relatório de Pedidos ${!showVal ? '(Romaneio Sem Valores)' : ''}</title>
        <style>
          @page { size: landscape; margin: 6mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 8px; color: #0f172a; margin: 0; padding: 4px; line-height: 1.2; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 4px; margin-bottom: 6px; }
          .header h1 { font-size: 13px; font-weight: 800; margin: 0; color: #0f172a; letter-spacing: 0.5px; }
          .header p { font-size: 7.5px; color: #64748b; margin: 1px 0 0 0; }
          .meta-box { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 3px 6px; margin-bottom: 6px; font-size: 7.5px; }
          .kpi-row { display: flex; gap: 4px; margin-bottom: 6px; }
          .kpi-box { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-left: 3px solid #0284c7; padding: 3px 5px; border-radius: 3px; }
          .kpi-box .val { font-size: 9px; font-weight: 800; color: #0f172a; }
          .kpi-box .lbl { font-size: 6.5px; text-transform: uppercase; color: #64748b; font-weight: 700; margin-top: 1px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 7.5px; }
          tr { page-break-inside: avoid; }
          th { background: #0f172a; color: #fff; padding: 4px 5px; text-align: left; font-weight: 700; font-size: 8px; white-space: nowrap; }
          td { padding: 3px 5px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; font-size: 7.8px; line-height: 1.25; }
          tr:nth-child(even) { background: #f8fafc; }
          .status-tag { display: inline-block; padding: 1px 4px; border-radius: 3px; font-size: 7.5px; font-weight: 700; white-space: nowrap; }
          .badge-nodev { background: #fee2e2; color: #dc2626; font-size: 7px; font-weight: 700; padding: 0 3px; border-radius: 2px; margin-left: 2px; }
          .td-right { text-align: right; }
          .td-center { text-align: center; }
          .footer-total { background: #e2e8f0 !important; font-weight: 800; font-size: 8.5px; }
          .footer-note { text-align: center; font-size: 7.5px; color: #94a3b8; margin-top: 8px; border-top: 1px solid #e2e8f0; padding-top: 4px; }
          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>THSM DISTRIBUIDORA</h1>
            <p>${showVal ? 'RELATÓRIO GERENCIAL DE PEDIDOS COM ENDEREÇO, PRODUTOS E VALORES FINANCEIROS' : 'ROMANEIO LOGÍSTICO DE ENTREGA E CONFERÊNCIA (SEM EXIBIÇÃO DE VALORES)'}</p>
          </div>
          <div style="text-align: right; font-size: 8.5px; color: #334155;">
            <p><strong>Emissão:</strong> ${nowStr}   |   <strong>Total:</strong> ${reportStats.totalPedidos} pedidos ${!showVal ? '• <span style="color:#dc2626;font-weight:700;">SEM VALORES</span>' : ''}</p>
          </div>
        </div>

        <div class="meta-box">
          <strong>Filtros:</strong> Status: ${statusDesc} | Devolução: ${devDesc} | Cidade: ${selectedCity} | Rota: ${selectedRoute} | ${startDate ? `De ${formatDateBR(startDate)}` : ''} ${endDate ? `até ${formatDateBR(endDate)}` : ''} ${excludeTests ? '• (Sem pedidos de teste)' : ''}
        </div>

        <div class="kpi-row">
          <div class="kpi-box" style="border-left-color: #0284c7;">
            <div class="val">${reportStats.totalPedidos}</div>
            <div class="lbl">Total Pedidos</div>
          </div>
          <div class="kpi-box" style="border-left-color: #f59e0b;">
            <div class="val">${reportStats.totalItens} un</div>
            <div class="lbl">Total Peças/Itens</div>
          </div>
          <div class="kpi-box" style="border-left-color: #dc2626;">
            <div class="val">${reportStats.totalQtdSemDev} un</div>
            <div class="lbl">Itens Sem Devolução</div>
          </div>
          ${showVal ? `
            <div class="kpi-box" style="border-left-color: #10b981;">
              <div class="val">${formatCurrency(reportStats.faturamentoTotal)}</div>
              <div class="lbl">Receita Líquida (Pagos)</div>
            </div>
            <div class="kpi-box" style="border-left-color: #6366f1;">
              <div class="val">${formatCurrency(reportStats.descontosTotal)}</div>
              <div class="lbl">Descontos Concedidos</div>
            </div>
            <div class="kpi-box" style="border-left-color: #0284c7;">
              <div class="val">${formatCurrency(reportStats.ticketMedio)}</div>
              <div class="lbl">Ticket Médio (Pagos c/ valor)</div>
            </div>
            <div class="kpi-box" style="border-left-color: #dc2626;">
              <div class="val">${formatCurrency(reportStats.vendaNaoRecebida)}</div>
              <div class="lbl">Calotes (${reportStats.calotesCount} pedidos)</div>
            </div>
          ` : `
            <div class="kpi-box" style="border-left-color: #10b981;">
              <div class="val">${reportStats.pagosComValorCount + reportStats.pagosZeradosCount}</div>
              <div class="lbl">Pedidos Pagos / Concluídos</div>
            </div>
            <div class="kpi-box" style="border-left-color: #dc2626;">
              <div class="val">${reportStats.calotesCount}</div>
              <div class="lbl">Pedidos em Calote</div>
            </div>
          `}
        </div>

        <table>
          <thead>
            <tr>
              <th># / Data</th>
              <th>Cliente / Tel</th>
              <th>Status</th>
              <th>Endereço Completo / Destino</th>
              <th>Rota</th>
              <th class="td-center">Qtd</th>
              <th>Produtos / Itens Descritos</th>
              ${showVal ? `
                <th class="td-right">Preço Tabela</th>
                <th class="td-right">Desconto</th>
                <th class="td-right">Total Líquido</th>
              ` : ''}
            </tr>
          </thead>
          <tbody>
            ${targetOrders.map(o => {
              const resStatus = getResolvedStatus(o)
              const cfg = STATUS_CONFIG[resStatus] || { label: resStatus, color: '#333', bg: '#eee' }
              const dev = getOrderDevolucaoStats(o, produtos)
              const fin = getOrderFinancialDetails(o)
              const enderecoStr = formatFullAddress(o.customer?.endereco)
              const prodsInline = (o.items || []).map(i => {
                const isSem = checkItemSemDevolucao(i, produtos)
                return `${i.qty || 1}x ${i.nome}${isSem ? '<span class="badge-nodev">S/DEV</span>' : ''}`
              }).join(' • ') || '-'

              return `
                <tr>
                  <td><strong>#${String(o.id).slice(-6)}</strong><br><span style="color:#64748b;">${formatDateBR(o.date || o.createdAt)}</span></td>
                  <td><strong>${o.customer?.nome || '-'}</strong><br><small style="color:#64748b;">${o.customer?.telefone || '-'}</small></td>
                  <td><span class="status-tag" style="background:${cfg.bg};color:${cfg.color};">${cfg.label}</span></td>
                  <td style="max-width: 250px;">${enderecoStr}</td>
                  <td><strong>${o.customer?.endereco?.rota || '-'}</strong></td>
                  <td class="td-center">${dev.qtdTotal} un</td>
                  <td>${prodsInline}</td>
                  ${showVal ? `
                    <td class="td-right" style="color:#475569;font-weight:600;">${formatCurrency(fin.valorItens)}</td>
                    <td class="td-right" style="color:#d97706;font-weight:600;">${fin.desconto > 0 ? `-${formatCurrency(fin.desconto)}` : '-'}</td>
                    <td class="td-right" style="font-weight:700;color:${resStatus === 'calote' ? '#dc2626' : '#059669'};">
                      ${resStatus === 'calote' ? `Calote: ${formatCurrency(o.caloteTotalVenda || fin.valorItens)}` : formatCurrency(fin.totalLiquido)}
                    </td>
                  ` : ''}
                </tr>
              `
            }).join('')}
            <tr class="footer-total">
              <td colspan="5">TOTAL GERAL (${reportStats.totalPedidos} pedidos)</td>
              <td class="td-center">${reportStats.totalItens} un</td>
              <td>Sem Dev: ${reportStats.totalQtdSemDev} un ${showVal ? `(${formatCurrency(reportStats.totalValorSemDev)})` : ''}</td>
              ${showVal ? `
                <td class="td-right">${formatCurrency(reportStats.valorItensTotal)}</td>
                <td class="td-right">-${formatCurrency(reportStats.descontosTotal)}</td>
                <td class="td-right">${formatCurrency(reportStats.faturamentoTotal)}</td>
              ` : ''}
            </tr>
          </tbody>
        </table>

        <div class="footer-note">
          THSM Distribuidora — Documento emitido para controle operacional e logístico de entregas.
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 300);
          };
        </script>
      </body>
      </html>
    `

    printWin.document.open()
    printWin.document.write(htmlContent)
    printWin.document.close()
  }

  if (!isOpen) return null

  return (
    <div className="order-report-overlay">
      <div className="order-report-modal" onClick={e => e.stopPropagation()}>
        {/* HEADER */}
        <div className="order-report-header">
          <div className="order-report-header-title">
            <div className="order-report-icon-badge">
              <i className="fa-solid fa-file-invoice-dollar"></i>
            </div>
            <div>
              <h3>Emitir Relatório de Pedidos</h3>
              <p>Relatório com endereço completo, pedidos descritos e controle Sem/Com Devolução</p>
            </div>
          </div>
          <button className="order-report-close-btn" onClick={onClose} title="Fechar">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        {/* BODY */}
        <div className="order-report-body">
          {/* SELETOR DE ESCOPO */}
          <div className="report-scope-selector">
            <button
              className={`report-scope-btn ${scope === 'todos' ? 'active' : ''}`}
              onClick={() => setScope('todos')}
            >
              <i className="fa-solid fa-list-check"></i>
              Todos os Pedidos ({orders.length})
            </button>
            <button
              className={`report-scope-btn ${scope === 'tela' ? 'active' : ''}`}
              onClick={() => setScope('tela')}
            >
              <i className="fa-solid fa-desktop"></i>
              Filtros da Tela ({filteredOrdersFromScreen.length})
            </button>
            <button
              className={`report-scope-btn ${scope === 'selecionados' ? 'active' : ''}`}
              onClick={() => setScope('selecionados')}
              disabled={!hasSelected}
              style={{ opacity: hasSelected ? 1 : 0.5, cursor: hasSelected ? 'pointer' : 'not-allowed' }}
            >
              <i className="fa-solid fa-check-square"></i>
              Selecionados ({selectedOrderIds.size})
            </button>
            <button
              className={`report-scope-btn ${scope === 'custom' ? 'active' : ''}`}
              onClick={() => setScope('custom')}
            >
              <i className="fa-solid fa-sliders"></i>
              Filtros Personalizados
            </button>
          </div>

          {scope !== 'custom' && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '0.5rem 0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem', color: '#166534' }}>
              <span>
                <i className="fa-solid fa-circle-check" style={{ marginRight: '6px', color: '#16a34a' }}></i>
                {scope === 'todos' && `Puxando 100% de todos os pedidos cadastrados no sistema (${orders.length} pedidos).`}
                {scope === 'tela' && `Puxando pedidos conforme os filtros atualmente ativos na tela (${filteredOrdersFromScreen.length} pedidos).`}
                {scope === 'selecionados' && `Puxando apenas os ${selectedOrderIds.size} pedido(s) selecionados com caixa de marcação.`}
              </span>
              <span style={{ fontWeight: 700, color: '#15803d' }}>
                {targetOrders.length} pedido(s) incluídos no relatório
              </span>
            </div>
          )}

          {/* PAINEL DE FILTROS PERSONALIZADOS */}
          {scope === 'custom' && (
            <div className="report-filter-panel">
              <div className="report-filter-panel-title">
                <i className="fa-solid fa-filter"></i>
                Configuração dos Filtros
              </div>

              {/* STATUS MULTI-SELECT & PRESETS */}
              <div style={{ marginBottom: '1rem' }}>
                <span className="report-filter-label" style={{ display: 'block', marginBottom: '0.4rem' }}>
                  Filtrar por Status dos Pedidos:
                </span>
                <div className="report-status-presets" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  <button
                    type="button"
                    className={`report-preset-chip ${selectedStatuses.length === Object.keys(STATUS_CONFIG).length ? 'active' : ''}`}
                    onClick={() => applyStatusPreset('todos')}
                  >
                    Todos os Status
                  </button>
                  <button
                    type="button"
                    className="report-preset-chip"
                    onClick={() => applyStatusPreset('pendentes_a_concluidos')}
                    title="Pré-pedidos, pendentes, confirmados, em rota, acertos e concluídos"
                  >
                    ⚡ Pedidos Ativos
                  </button>
                  <button
                    type="button"
                    className={`report-preset-chip ${selectedStatuses.length === 1 && selectedStatuses[0] === 'calote' ? 'active' : ''}`}
                    style={{ borderColor: '#dc2626', color: '#b91c1c', fontWeight: 700 }}
                    onClick={() => applyStatusPreset('calotes')}
                    title="Filtrar apenas calotes integrais (100% de perda)"
                  >
                    <i className="fa-solid fa-triangle-exclamation" style={{ color: '#dc2626', marginRight: '4px' }}></i>
                    Apenas Calotes 100%
                  </button>
                  <button
                    type="button"
                    className={`report-preset-chip ${selectedStatuses.length === 1 && selectedStatuses[0] === 'calote_parcial' ? 'active' : ''}`}
                    style={{ borderColor: '#d97706', color: '#b45309', fontWeight: 700 }}
                    onClick={() => applyStatusPreset('calote_parcial')}
                    title="Filtrar pedidos com pagamento parcial e saldo em aberto"
                  >
                    <i className="fa-solid fa-clock-rotate-left" style={{ color: '#d97706', marginRight: '4px' }}></i>
                    Apenas Calote Parcial
                  </button>
                  <button
                    type="button"
                    className={`report-preset-chip ${selectedStatuses.length === 2 && selectedStatuses.includes('calote') && selectedStatuses.includes('calote_parcial') ? 'active' : ''}`}
                    style={{ borderColor: '#991b1b', color: '#991b1b', fontWeight: 800, background: '#fef2f2' }}
                    onClick={() => applyStatusPreset('inadimplencia')}
                    title="Filtrar todos os calotes (100% integral e Parciais com saldo em aberto)"
                  >
                    <i className="fa-solid fa-shield-halved" style={{ color: '#dc2626', marginRight: '4px' }}></i>
                    Todos os Calotes (100% + Parcial)
                  </button>
                  <button
                    type="button"
                    className={`report-preset-chip ${selectedStatuses.length === 1 && selectedStatuses[0] === 'entregue' ? 'active' : ''}`}
                    onClick={() => applyStatusPreset('entregues')}
                    title="Mercadoria colocada na praça / consignada em aberto"
                  >
                    Apenas Entregues (Praça)
                  </button>
                  <button
                    type="button"
                    className={`report-preset-chip ${selectedStatuses.length === 1 && selectedStatuses[0] === 'acerto' ? 'active' : ''}`}
                    onClick={() => applyStatusPreset('acertos')}
                  >
                    Apenas Acertos
                  </button>
                  <button
                    type="button"
                    className={`report-preset-chip ${selectedStatuses.length === 1 && selectedStatuses[0] === 'concluido' ? 'active' : ''}`}
                    onClick={() => applyStatusPreset('concluidos')}
                    style={{ borderColor: '#16a34a', color: '#15803d' }}
                  >
                    Apenas Concluídos (Pagos)
                  </button>
                  <button
                    type="button"
                    className={`report-preset-chip ${selectedStatuses.length === 1 && selectedStatuses[0] === 'em-rota' ? 'active' : ''}`}
                    onClick={() => applyStatusPreset('rota')}
                  >
                    Apenas Em Rota
                  </button>
                  <button
                    type="button"
                    className="report-preset-chip"
                    onClick={() => applyStatusPreset('pendentes')}
                  >
                    Apenas Pendentes
                  </button>
                </div>

                <div className="report-status-chips-grid">
                  {Object.entries(STATUS_CONFIG).map(([statusKey, cfg]) => {
                    const isSelected = selectedStatuses.includes(statusKey)
                    return (
                      <span
                        key={statusKey}
                        className={`report-status-tag ${!isSelected ? 'inactive' : ''}`}
                        style={{
                          backgroundColor: isSelected ? cfg.bg : undefined,
                          color: isSelected ? cfg.color : undefined,
                          borderColor: isSelected ? cfg.color : undefined
                        }}
                        onClick={() => toggleStatusTag(statusKey)}
                      >
                        <i className={`fa-solid ${isSelected ? 'fa-check' : 'fa-plus'}`} style={{ fontSize: '0.65rem' }}></i>
                        {cfg.label}
                      </span>
                    )
                  })}
                </div>
              </div>

              {/* GRID COM DEMAIS FILTROS */}
              <div className="report-filter-grid">
                {/* FILTRO DE DEVOLUÇÃO (SEM DEVOLUÇÃO / COM DEVOLUÇÃO) */}
                <div className="report-filter-group">
                  <label className="report-filter-label" style={{ color: '#dc2626' }}>
                    <i className="fa-solid fa-rotate-left" style={{ marginRight: '4px' }}></i>
                    Filtro Sem / Com Devolução:
                  </label>
                  <select
                    className="report-filter-select"
                    value={devolucaoFilter}
                    onChange={e => setDevolucaoFilter(e.target.value)}
                    style={{ borderColor: devolucaoFilter !== 'todos' ? '#dc2626' : undefined, fontWeight: devolucaoFilter !== 'todos' ? 700 : 400 }}
                  >
                    <option value="todos">Todos os pedidos (com e sem devolução)</option>
                    <option value="sem_dev">Contém itens sem devolução (mostra só itens sem devolução)</option>
                    <option value="com_dev">Contém item com devolução (mostra só itens com devolução)</option>
                  </select>
                </div>

                {/* FILTRO DE CLIENTE */}
                <div className="report-filter-group">
                  <label className="report-filter-label">Cliente Específico:</label>
                  <select
                    className="report-filter-select"
                    value={selectedClientPhone}
                    onChange={e => setSelectedClientPhone(e.target.value)}
                  >
                    <option value="TODOS">Todos os Clientes</option>
                    {filteredClients.map(u => (
                      <option key={u.id || u.telefone} value={u.telefone || u.id}>
                        {u.nome} ({u.telefone || 'sem tel'})
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Pesquisar cliente..."
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      marginTop: '0.2rem'
                    }}
                  />
                </div>

                {/* FILTRO DE ROTA */}
                <div className="report-filter-group">
                  <label className="report-filter-label">Rota de Entrega:</label>
                  <select
                    className="report-filter-select"
                    value={selectedRoute}
                    onChange={e => setSelectedRoute(e.target.value)}
                  >
                    {rotasUnicas.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                {/* FILTRO DE CIDADE */}
                <div className="report-filter-group">
                  <label className="report-filter-label">Cidade / Destino:</label>
                  <select
                    className="report-filter-select"
                    value={selectedCity}
                    onChange={e => setSelectedCity(e.target.value)}
                  >
                    {cidadesUnicas.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* FORMA DE PAGAMENTO */}
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
                    <option value="pix">PIX</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="cartao">Cartão</option>
                  </select>
                </div>
              </div>

              {/* FILTRO DE DATA */}
              <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px dashed #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="report-filter-label">Filtrar por Período:</span>
                    <select
                      value={dateType}
                      onChange={e => setDateType(e.target.value)}
                      style={{ fontSize: '0.72rem', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    >
                      <option value="pagamento">Data de Pagamento / Quitação</option>
                      <option value="date">Data de Emissão do Pedido</option>
                      <option value="vencimento">Data de Vencimento</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    <button type="button" className="report-preset-chip" onClick={() => applyDatePreset('today')}>Hoje</button>
                    <button type="button" className="report-preset-chip" onClick={() => applyDatePreset('last7')}>7 dias</button>
                    <button type="button" className="report-preset-chip" onClick={() => applyDatePreset('last30')}>30 dias</button>
                    <button type="button" className="report-preset-chip" onClick={() => applyDatePreset('last60')}>60 dias</button>
                    <button type="button" className="report-preset-chip" onClick={() => applyDatePreset('last90')}>90 dias</button>
                    <button type="button" className="report-preset-chip" onClick={() => applyDatePreset('this_month')}>Este Mês</button>
                    <button type="button" className="report-preset-chip" onClick={() => applyDatePreset('clear')}>Sem Limite (Todos)</button>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <input
                    type="date"
                    className="report-filter-input"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                  />
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>até</span>
                  <input
                    type="date"
                    className="report-filter-input"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {/* CARDS DE RESUMO (KPIS OFICIAIS THSM) */}
          <div className="report-kpi-grid">
            <div className="report-kpi-card" style={{ borderLeft: '4px solid #0284c7' }}>
              <div className="report-kpi-icon" style={{ background: '#e0f2fe', color: '#0284c7' }}>
                <i className="fa-solid fa-clipboard-list"></i>
              </div>
              <div>
                <div className="report-kpi-val">{reportStats.totalPedidos}</div>
                <div className="report-kpi-label">Pedidos no Escopo</div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeft: '4px solid #10b981' }}>
              <div className="report-kpi-icon" style={{ background: '#d1fae5', color: '#10b981' }}>
                <i className="fa-solid fa-dollar-sign"></i>
              </div>
              <div>
                <div className="report-kpi-val" style={{ color: '#059669' }}>
                  {formatCurrency(reportStats.faturamentoTotal)}
                </div>
                <div className="report-kpi-label">Faturamento Líquido (Pagos)</div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeft: '4px solid #6366f1' }}>
              <div className="report-kpi-icon" style={{ background: '#e0e7ff', color: '#4f46e5' }}>
                <i className="fa-solid fa-receipt"></i>
              </div>
              <div>
                <div className="report-kpi-val" style={{ color: '#4f46e5' }}>
                  {formatCurrency(reportStats.descontosTotal)}
                </div>
                <div className="report-kpi-label">Descontos Concedidos</div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeft: '4px solid #0284c7' }}>
              <div className="report-kpi-icon" style={{ background: '#e0f2fe', color: '#0284c7' }}>
                <i className="fa-solid fa-arrow-trend-up"></i>
              </div>
              <div>
                <div className="report-kpi-val" style={{ color: '#0369a1' }}>
                  {formatCurrency(reportStats.ticketMedio)}
                </div>
                <div className="report-kpi-label">Ticket Médio ({reportStats.pagosComValorCount} pagos c/ valor)</div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeft: '4px solid #dc2626' }}>
              <div className="report-kpi-icon" style={{ background: '#fee2e2', color: '#dc2626' }}>
                <i className="fa-solid fa-triangle-exclamation"></i>
              </div>
              <div>
                <div className="report-kpi-val" style={{ color: '#dc2626' }}>
                  {formatCurrency(reportStats.vendaNaoRecebida)}
                </div>
                <div className="report-kpi-label">Calotes ({reportStats.calotesCount} pedidos)</div>
              </div>
            </div>
          </div>

          {/* RESUMO POR STATUS */}
          {reportStats.porStatus.length > 0 && (
            <div className="report-status-breakdown">
              <div className="report-breakdown-title">
                <span>Distribuição por Status</span>
                <span>{reportStats.porStatus.length} status com pedidos</span>
              </div>
              <div className="report-breakdown-bars">
                {reportStats.porStatus.map(st => (
                  <div key={st.key} className="report-breakdown-item">
                    <span className="report-breakdown-name">
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: st.color, display: 'inline-block' }}></span>
                      {st.label} ({st.count})
                    </span>
                    <div className="report-breakdown-bar-bg">
                      <div
                        className="report-breakdown-bar-fill"
                        style={{ width: `${st.percent}%`, background: st.color }}
                      ></div>
                    </div>
                    <div className="report-breakdown-values">
                      <strong>{formatCurrency(st.total)}</strong>
                      <span style={{ color: '#94a3b8', width: '38px', textAlign: 'right' }}>{st.percent.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* OPÇÕES ADICIONAIS DO RELATÓRIO */}
          <div className="report-options-row">
            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
              <label className="report-checkbox-label">
                <input
                  type="checkbox"
                  checked={includeSummary}
                  onChange={e => setIncludeSummary(e.target.checked)}
                />
                Incluir Resumo Executivo e KPIs
              </label>

              <label className="report-checkbox-label">
                <input
                  type="checkbox"
                  checked={includeItemsDetail}
                  onChange={e => setIncludeItemsDetail(e.target.checked)}
                />
                Descrever Produtos/Itens em cada Pedido
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>Formato:</span>
                <select
                  value={density}
                  onChange={e => setDensity(e.target.value)}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 600, background: '#f8fafc' }}
                >
                  <option value="compact">Compacto (1 linha/pedido - Recomendado)</option>
                  <option value="detailed">Detalhado (com quebra por produto)</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>Orientação:</span>
                <select
                  value={orientation}
                  onChange={e => setOrientation(e.target.value)}
                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                >
                  <option value="landscape">Paisagem (Horizontal - Recomendado)</option>
                  <option value="portrait">Retrato (Vertical)</option>
                </select>
              </div>
            </div>
          </div>

          {/* PRÉVIA DOS PEDIDOS COM ENDEREÇO COMPLETO E PRODUTOS */}
          <div className="report-preview-collapse">
            <div
              className="report-preview-header"
              onClick={() => setShowPreviewTable(v => !v)}
            >
              <span>
                <i className="fa-solid fa-table-list" style={{ marginRight: '6px', color: '#0284c7' }}></i>
                Pré-visualização dos Pedidos e Endereços ({targetOrders.length})
              </span>
              <i className={`fa-solid ${showPreviewTable ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
            </div>

            {showPreviewTable && (
              <div className="report-preview-table-wrap">
                <table className="report-preview-table">
                  <thead>
                    <tr>
                      <th># / Data</th>
                      <th>Cliente / Tel</th>
                      <th>Status</th>
                      <th>Endereço Completo</th>
                      <th>Rota</th>
                      <th>Qtd</th>
                      <th style={{ textAlign: 'right' }}>Preço Tabela</th>
                      <th style={{ textAlign: 'right' }}>Desconto</th>
                      <th style={{ textAlign: 'right' }}>Total Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetOrders.slice(0, 50).map(o => {
                      const st = getResolvedStatus(o)
                      const cfg = STATUS_CONFIG[st] || { label: st, color: '#333', bg: '#eee' }
                      const dev = getOrderDevolucaoStats(o, produtos)
                      const endStr = formatFullAddress(o.customer?.endereco)
                      const prodsInline = (o.items || []).map(i => {
                        const isSem = checkItemSemDevolucao(i, produtos)
                        return `${i.qty || 1}x ${i.nome}${isSem ? ' [S/DEV]' : ''}`
                      }).join(' • ') || '-'

                      return (
                        <tr key={o.id}>
                          <td><strong>#{String(o.id).slice(-6)}</strong><br /><small style={{ color: '#64748b' }}>{formatDateBR(o.date || o.createdAt)}</small></td>
                          <td><strong>{o.customer?.nome || '-'}</strong><br /><small style={{ color: '#64748b' }}>{o.customer?.telefone || '-'}</small></td>
                          <td>
                            <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: '4px', background: cfg.bg, color: cfg.color, fontWeight: 700 }}>
                              {cfg.label}
                            </span>
                          </td>
                          <td style={{ maxWidth: '240px', fontSize: '0.72rem', color: '#334155' }}>{endStr}</td>
                          <td><strong>{o.customer?.endereco?.rota || '-'}</strong></td>
                          <td>{dev.qtdTotal} un</td>
                          <td style={{ textAlign: 'right', color: '#475569', fontWeight: 600 }}>
                            {formatCurrency(getOrderFinancialDetails(o).valorItens)}
                          </td>
                          <td style={{ textAlign: 'right', color: '#d97706', fontWeight: 600 }} title={getOrderFinancialDetails(o).motivoDesconto}>
                            {getOrderFinancialDetails(o).desconto > 0 ? `- ${formatCurrency(getOrderFinancialDetails(o).desconto)}` : '-'}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 800, color: st === 'calote' ? '#dc2626' : '#059669' }}>
                            {st === 'calote' ? `Calote: ${formatCurrency(o.caloteTotalVenda || getOrderFinancialDetails(o).valorItens)}` : formatCurrency(getOrderFinancialDetails(o).totalLiquido)}
                            {getOrderFinancialDetails(o).totalLiquido === 0 && (
                              <div style={{ fontSize: '0.65rem', color: '#64748b' }}>({getOrderFinancialDetails(o).motivoZerado})</div>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                    {targetOrders.length > 50 && (
                      <tr>
                        <td colSpan="9" style={{ textAlign: 'center', padding: '0.65rem', color: '#64748b', fontStyle: 'italic' }}>
                          E mais {targetOrders.length - 50} pedidos (todos incluídos no PDF e no Excel)...
                        </td>
                      </tr>
                    )}
                    {targetOrders.length === 0 && (
                      <tr>
                        <td colSpan="9" style={{ textAlign: 'center', padding: '1rem', color: '#94a3b8' }}>
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

        {/* FOOTER COM BOTÕES */}
        <div className="order-report-footer">
          <div className="order-report-footer-left" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
            <span><strong>{reportStats.totalPedidos}</strong> pedidos {includePrices && <>• <strong>{formatCurrency(reportStats.faturamentoTotal)}</strong> (S/ Dev: {formatCurrency(reportStats.totalValorSemDev)})</>}</span>
            <label className="report-checkbox-label" style={{ fontWeight: 700, fontSize: '0.78rem', color: includePrices ? '#059669' : '#dc2626', background: includePrices ? '#f0fdf4' : '#fef2f2', padding: '0.25rem 0.6rem', borderRadius: '6px', border: `1px solid ${includePrices ? '#bbf7d0' : '#fecdd3'}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', userSelect: 'none' }} title="Clique para alternar entre relatório com valores ou romaneio de entrega sem valores (ocultar R$)">
              <input
                type="checkbox"
                checked={includePrices}
                onChange={e => setIncludePrices(e.target.checked)}
              />
              <i className={`fa-solid ${includePrices ? 'fa-dollar-sign' : 'fa-eye-slash'}`}></i>
              <span>{includePrices ? 'Com Valores (R$)' : 'Sem Valores (Romaneio)'}</span>
            </label>
          </div>

          <div className="order-report-footer-actions">
            <button
              type="button"
              className="report-action-btn report-btn-cancel"
              onClick={onClose}
            >
              Cancelar
            </button>

            <button
              type="button"
              className="report-action-btn report-btn-print"
              onClick={handlePrintView}
              title="Abrir visualização para imprimir ou salvar como PDF no navegador"
            >
              <i className="fa-solid fa-print"></i>
              Imprimir / Visualizar
            </button>

            <button
              type="button"
              className="report-action-btn report-btn-excel"
              onClick={handleExportExcel}
              title="Exportar planilha Excel com pedidos, endereço completo e produtos descritos"
            >
              <i className="fa-solid fa-file-excel"></i>
              Exportar Excel (.xlsx)
            </button>

            <button
              type="button"
              className="report-action-btn report-btn-pdf"
              onClick={handleGeneratePDF}
              title="Baixar arquivo PDF formatado com Resumo, Endereço Completo e Itens"
            >
              <i className="fa-solid fa-file-pdf"></i>
              Baixar Relatório PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
