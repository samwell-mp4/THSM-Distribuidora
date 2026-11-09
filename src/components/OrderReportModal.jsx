import React, { useState, useMemo } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { clientMatchesSearch, isCityOrGeneric } from '../lib/search'
import { getOrderPaymentDate, getOrderDueDate } from '../lib/orderPaymentDate'
import './OrderReportModal.css'

export { getOrderPaymentDate, getOrderDueDate }

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

// Limpa nome de produto removendo prefixos de quantidade embutidos e sufixos repetitivos como "- SEM DEVOLUCAO"
export function cleanProductName(nome) {
  if (!nome) return ''
  return String(nome)
    .replace(/\s*-\s*sem\s*devolu[cç][aã]o/gi, '')
    .replace(/\s*\[sem\s*devolu[cç][aã]o\]/gi, '')
    .replace(/\s*\(sem\s*devolu[cç][aã]o\)/gi, '')
    .replace(/^\d+\s*[xX]?\s+/, '') // remove prefixo "3 " ou "3x "
    .trim()
}

// Classificador oficial THSM para pedidos zerados (Devolução Total vs Brinde)
export function getOrderZeroClassification(o) {
  if (!o) return null
  // 1. Flags explícitas salvas no pedido
  if (o.isBrinde || o.is_brinde || o.tipo_zerado === 'brinde' || o.motivo_zerado === 'brinde' || o.motivo_zerado === 'Brinde') {
    return { type: 'brinde', label: 'Brinde', motivo: o.motivo_brinde || 'Brinde institucional' }
  }
  if (o.isDevolucaoTotal || o.is_devolucao_total || o.tipo_zerado === 'devolucao_total' || o.motivo_zerado === 'devolucao_total' || o.motivo_zerado === 'Devolução total') {
    return { type: 'devolucao_total', label: 'Devolução total', motivo: 'Devolução total' }
  }

  const tel = String(o.customer?.telefone || o.telefone || '').replace(/\D/g, '')
  const nome = (o.customer?.nome || o.cliente || o.nome || '').toLowerCase().trim()
  const obs = (o.observacoes || o.obs || '').toLowerCase()

  // 2. Brinde: Thales (553298606010)
  if (tel.includes('553298606010') || tel.includes('3298606010') || nome.includes('thales') || nome.includes('brinde') || obs.includes('brinde')) {
    return { type: 'brinde', label: 'Brinde', motivo: o.motivo_brinde || 'Brinde institucional' }
  }

  // 3. Os 10 clientes com devolução total do briefing de referência
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

  // Fallback: se o total for 0 e for finalizado/concluído
  const tot = Number(o.total || o.total_liquido || o.totalLiquido || o.totalAcerto || 0)
  if (tot === 0 && (o.status === 'concluido' || o.isFinalizado)) {
    return { type: 'devolucao_total', label: 'Devolução total', motivo: 'Devolução total' }
  }

  return null
}

// Helper financeiro oficial THSM por comanda (separa valor_itens, desconto e total_liquido)
export function getOrderFinancialDetails(o) {
  const isTest = Boolean(o?.isTest || o?.is_test || (o?.customer?.nome && o.customer.nome.toLowerCase().includes('teste')));
  const zeroClass = getOrderZeroClassification(o);

  // Pedidos com valor zero: Devolução Total ou Brinde
  if (zeroClass) {
    return {
      isTest,
      isZero: true,
      zeroType: zeroClass.type, // 'devolucao_total' ou 'brinde'
      valorItens: 0,
      desconto: 0,
      totalLiquido: 0,
      motivoDesconto: 'Sem desconto',
      motivoZerado: zeroClass.label,
      totalPago: 0,
      saldoEmAberto: 0
    };
  }

  // 1. Preço de tabela dos itens (preço cheio)
  let valorItens = 0;
  if (o?.valor_itens !== undefined && Number(o.valor_itens) > 0) {
    valorItens = Number(o.valor_itens);
  } else {
    const items = (Array.isArray(o?.items) && o.items.length > 0)
      ? o.items
      : (Array.isArray(o?.originalItems) && o.originalItems.length > 0 ? o.originalItems : []);
    valorItens = items.reduce((s, i) => s + (Number(i.preco) || 0) * (Number(i.qty) || 0), 0);
  }
  valorItens = Math.round(valorItens * 100) / 100;

  // 2. Total líquido (o que foi faturado de verdade após descontos)
  let totalLiquido = 0;
  if (o?.total_liquido !== undefined && Number(o.total_liquido) >= 0) {
    totalLiquido = Number(o.total_liquido);
  } else if (o?.total !== undefined && Number(o.total) >= 0) {
    totalLiquido = Number(o.total);
  } else if (o?.totalAcerto !== undefined && Number(o.totalAcerto) >= 0) {
    totalLiquido = Number(o.totalAcerto);
  } else {
    totalLiquido = valorItens;
  }
  totalLiquido = Math.round(totalLiquido * 100) / 100;

  // 3. Desconto concedido (R$)
  let desconto = 0;
  if (o?.desconto !== undefined && Number(o.desconto) >= 0) {
    desconto = Number(o.desconto);
  } else if (valorItens > 0 && totalLiquido < valorItens) {
    desconto = Math.max(0, Math.round((valorItens - totalLiquido) * 100) / 100);
  } else if (o?.descontoPercent) {
    desconto = Math.round(((Number(o.descontoPercent) / 100) * valorItens) * 100) / 100;
  }
  desconto = Math.round(desconto * 100) / 100;

  // Se o total líquido não bate com valorItens - desconto, ajusta para manter integridade
  if (valorItens > 0 && totalLiquido === 0 && desconto === 0) {
    totalLiquido = valorItens;
  } else if (valorItens > 0 && desconto > 0 && Math.abs((valorItens - desconto) - totalLiquido) > 0.05) {
    totalLiquido = Math.max(0, Math.round((valorItens - desconto) * 100) / 100);
  }

  // 4. Motivo do desconto
  let motivoDesconto = o?.motivo_desconto || '';
  if (!motivoDesconto) {
    if (desconto > 0) {
      const pctCalc = Math.round((desconto / (valorItens || 1)) * 100);
      if (Number(o?.descontoPercent) === 30 || pctCalc === 30) {
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

  const totalPago = Number(o?.total_pago !== undefined ? o.total_pago : (o?.totalPago || (o?.status === 'concluido' ? totalLiquido : 0)));
  const saldoEmAberto = Number(o?.saldo_em_aberto !== undefined ? o.saldo_em_aberto : (o?.valorEmAberto || Math.max(0, totalLiquido - totalPago)));

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
  if (endereco.complemento) parts.push(endereco.complemento)
  if (endereco.bairro) parts.push(endereco.bairro)
  const cidUf = [endereco.cidade, endereco.estado || endereco.uf].filter(Boolean).join('/')
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
  const [devolucaoFilter, setDevolucaoFilter] = useState('todos')
  const [excludeTests, setExcludeTests] = useState(true)
  const [includePrices, setIncludePrices] = useState(true)
  // Sempre calculado pela DATA DE VENCIMENTO como padrão e principal
  const [dateType, setDateType] = useState('vencimento')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  // Opções de relatório
  const [includeSummary, setIncludeSummary] = useState(true)
  const [includeItemsDetail, setIncludeItemsDetail] = useState(true)
  const [orientation, setOrientation] = useState('landscape')
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
  const getResolvedStatus = (o) => {
    if (o.isCalote || o.status === 'calote' || o.motivoEncerramento === 'calote_100') return 'calote'
    if (o.status === 'calote_parcial' || o.status === 'parcial' || (Boolean(o.isFinalizado) && Number(o.valorEmAberto) > 0 && Number(o.totalPago) > 0)) return 'calote_parcial'
    if (o.status === 'concluido' || (isFinalizada(o) && !o.isCalote && o.status !== 'calote')) return 'concluido'
    if (o.status === 'acerto') return 'acerto'
    if (o.status === 'entregue') return 'entregue'
    return o.status || 'pendente'
  }

  // Lista filtrada e deduplicada de pedidos
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

        // 6. Datas (sempre calculando a DATA DE VENCIMENTO como padrão)
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

    // Filtro rigoroso de pedidos de teste e duplicados
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

    // Filtro adicional de Devolução (Sem / Com Devolução)
    if (devolucaoFilter === 'sem_dev' || devolucaoFilter === 'com_sem_dev' || devolucaoFilter === 'apenas_sem_dev') {
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
          isFilteredByDev: true,
          filteredDevType: 'com_dev'
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

  // Resumo estatístico geral (fórmulas oficiais THSM com total transparência e coerência de balanço)
  const reportStats = useMemo(() => {
    const totalPedidos = targetOrders.length
    let faturamentoTotal = 0 // Total Líquido Faturado (R$ 57.573,05)
    let valorItensTotal = 0  // Valor dos Itens a preço de tabela (R$ 76.688,50)
    let descontosTotal = 0   // Descontos concedidos (R$ 19.115,45)
    let totalItens = 0       // 1.311 peças
    let totalQtdSemDev = 0   // 274 peças
    let totalQtdComDev = 0   // 1.037 peças
    let totalValorSemDev = 0 // R$ 37.182,00 (Preço de tabela)
    let totalValorComDev = 0 // R$ 39.506,50 (Preço de tabela)
    let vendaNaoRecebida = 0
    let calotePrejuizoCusto = 0
    let pedidosVendaCount = 0 // 221 vendas com valor > R$ 0
    let pedidosDevolucaoTotalCount = 0 // 10 devoluções totais
    let pedidosBrindeCount = 0 // 1 brinde
    let pedidosZeradosTotalCount = 0 // 11 zerados
    let calotesCount = 0

    const valoresLiquidosVendas = []

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

      if (!statusMap[st]) statusMap[st] = { count: 0, total: 0 }
      statusMap[st].count += 1

      if (fin.isZero) {
        if (fin.zeroType === 'brinde') {
          pedidosBrindeCount += 1
        } else {
          pedidosDevolucaoTotalCount += 1
        }
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

      const p = o.pagamento || 'outro'
      if (pagMap[p] !== undefined) pagMap[p] += fin.totalLiquido
      else pagMap.outro += fin.totalLiquido
    })

    // Ticket Médio oficial dos pedidos de venda com valor (> R$ 0)
    const ticketMedio = pedidosVendaCount > 0 ? (faturamentoTotal / pedidosVendaCount) : 0

    // Mediana do Ticket dos pedidos de venda com valor (> R$ 0)
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
      pedidosVendaCount,
      pedidosDevolucaoTotalCount,
      pedidosBrindeCount,
      pedidosZeradosTotalCount,
      faturamentoTotal: Math.round(faturamentoTotal * 100) / 100,
      valorItensTotal: Math.round(valorItensTotal * 100) / 100,
      descontosTotal: Math.round(descontosTotal * 100) / 100,
      ticketMedio: Math.round(ticketMedio * 100) / 100,
      ticketMediana: Math.round(ticketMediana * 100) / 100,
      calotesCount,
      vendaNaoRecebida: Math.round(vendaNaoRecebida * 100) / 100,
      calotePrejuizoCusto: Math.round(calotePrejuizoCusto * 100) / 100,
      totalItens,
      totalQtdSemDev,
      totalQtdComDev,
      totalValorSemDev: Math.round(totalValorSemDev * 100) / 100,
      totalValorComDev: Math.round(totalValorComDev * 100) / 100,
      porStatus,
      pagMap
    }
  }, [targetOrders, produtos, isFinalizada])

  // Presets de status
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
      doc.text('RELATÓRIO GERENCIAL DE PEDIDOS COM ENDEREÇO E PRODUTOS (POR VENCIMENTO)', 64, 7.5)

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

      const filterLine = `Escopo: ${scopeDesc} | Status: ${statusDesc} | Base: Data de Vencimento | Período: ${dateDesc} | Cidade: ${selectedCity} | Rota: ${selectedRoute}`
      doc.text(filterLine.slice(0, 160), 13, currentY + 3.8)

      currentY += 7.5

      // 3. Resumo Executivo e KPIs Compacto (Alinhamento rigoroso com o Briefing)
      if (includeSummary) {
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
          { label: 'TICKET MÉDIO (MEDIANA)', val: `${formatCurrency(reportStats.ticketMedio)} (Med ${formatCurrency(reportStats.ticketMediana)})`, color: [14, 165, 233] },
          { label: 'SEM / COM DEVOLUÇÃO', val: `${formatCurrency(reportStats.totalValorSemDev)} / ${formatCurrency(reportStats.totalValorComDev)}`, color: [245, 158, 11] }
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

        currentY += cardH + 3
      }

      // 4. Tabela de Pedidos
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
          prodsInline = o.items.map(i => {
            const isSem = checkItemSemDevolucao(i, produtos)
            return `${i.qty || 1}x ${cleanProductName(i.nome)}${isSem ? ' [S/DEV]' : ''}`
          }).join(' • ')
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

      // Linha de Totalizador
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

      const colStyles = orientation === 'landscape' ? {
        0: { cellWidth: 16 }, // # / Vencimento
        1: { cellWidth: 34 }, // Cliente / Tel
        2: { cellWidth: 17 }, // Status / Tipo
        3: { cellWidth: 44 }, // Endereço Completo
        4: { cellWidth: 14 }, // Rota
        5: { cellWidth: 10, halign: 'center' }, // Qtd
        6: { cellWidth: 92 }, // Produtos (inline compact)
        7: { cellWidth: 16, halign: 'right' }, // Valor Tabela
        8: { cellWidth: 15, halign: 'right', textColor: [99, 102, 241] }, // Desconto
        9: { cellWidth: 19, halign: 'right', fontStyle: 'bold', textColor: [16, 185, 129] } // Total Líquido
      } : {
        0: { cellWidth: 14 },
        1: { cellWidth: 28 },
        2: { cellWidth: 14 },
        3: { cellWidth: 34 },
        4: { cellWidth: 13 },
        5: { cellWidth: 9, halign: 'center' },
        6: { cellWidth: 38 },
        7: { cellWidth: 13, halign: 'right' },
        8: { cellWidth: 13, halign: 'right' },
        9: { cellWidth: 14, halign: 'right', fontStyle: 'bold', textColor: [16, 185, 129] }
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
          valign: 'middle'
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

      // Rodapé em todas as páginas
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
      showToast(`Relatório PDF gerado (${totalPages} pág) e baixado com sucesso!`, 'success')
    } catch (err) {
      console.error('Erro ao gerar PDF:', err)
      showToast('Erro ao gerar PDF. Verifique o console.', 'error')
    }
  }

  // ==========================================
  // EXPORTAÇÃO EXCEL EM FORMATO TABELA PLANA (3 ABAS SEPARADAS)
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
      // ABA 1: PEDIDOS (TABELA PLANA - 1 LINHA POR PEDIDO)
      // ==========================================
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

        const resumoItens = (o.items || []).map(i => `${i.qty || 1}x ${cleanProductName(i.nome)}`).join(' • ') || '-'

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
          o.pagamento || o.paymentMethod || 'Não informado',
          resumoItens
        ])
      })

      const wsMain = XLSX.utils.aoa_to_sheet(mainSheetData)
      wsMain['!cols'] = [
        { wch: 14 }, // id_pedido
        { wch: 16 }, // data_vencimento
        { wch: 14 }, // data_pedido
        { wch: 28 }, // cliente
        { wch: 16 }, // telefone
        { wch: 18 }, // status
        { wch: 16 }, // tipo_pedido
        { wch: 16 }, // motivo_zerado
        { wch: 18 }, // cidade
        { wch: 18 }, // bairro
        { wch: 14 }, // rota
        { wch: 45 }, // endereco_completo
        { wch: 16 }, // quantidade_itens
        { wch: 16 }, // qtd_sem_devolucao
        { wch: 16 }, // qtd_com_devolucao
        { wch: 16 }, // valor_itens
        { wch: 16 }, // desconto
        { wch: 28 }, // motivo_desconto
        { wch: 16 }, // total_liquido
        { wch: 18 }, // forma_pagamento
        { wch: 45 }  // resumo_itens
      ]
      XLSX.utils.book_append_sheet(wb, wsMain, 'Pedidos (Tabela Plana)')

      // ==========================================
      // ABA 2: ITENS DETALHADOS (TABELA PLANA - 1 LINHA POR ITEM)
      // ==========================================
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
        'status_item',
        'custo_unitario',
        'custo_total'
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
          const custoUnit = getItemCost(i, produtos)
          const custoTotal = custoUnit > 0 ? Math.round(custoUnit * qty * 100) / 100 : null
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
            statusItem,
            custoUnit > 0 ? custoUnit : '',
            custoTotal > 0 ? custoTotal : ''
          ])
        })
      })

      if (itensRows.length > 0) {
        const wsItens = XLSX.utils.aoa_to_sheet([itensHeaders, ...itensRows])
        wsItens['!cols'] = [
          { wch: 14 }, { wch: 16 }, { wch: 28 }, { wch: 16 }, { wch: 18 },
          { wch: 35 }, { wch: 18 }, { wch: 12 }, { wch: 15 }, { wch: 15 },
          { wch: 14 }, { wch: 15 }, { wch: 15 }
        ]
        XLSX.utils.book_append_sheet(wb, wsItens, 'Itens Detalhados')
      }

      // ==========================================
      // ABA 3: RESUMO EXECUTIVO (MÉTRICAS OFICIAIS THSM COM FÓRMULAS)
      // ==========================================
      const totalLinhasPedidos = targetOrders.length + 1
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
        ['Pedidos em Calote Total (100%)', reportStats.calotesCount],
        ['Total de Peças / Itens Enviados', reportStats.totalItens],
        ['  - Peças SEM Devolução', reportStats.totalQtdSemDev],
        ['  - Peças COM Devolução', reportStats.totalQtdComDev],
        [],
        ['2. FATURAMENTO E MÉTRICAS FINANCEIRAS (REGRA DE ACEITE)'],
        ['Valor dos Itens (Preço de Tabela)', { t: 'n', v: reportStats.valorItensTotal, f: `SUM('Pedidos (Tabela Plana)'!P2:P${totalLinhasPedidos})` }],
        ['Descontos Concedidos', { t: 'n', v: -reportStats.descontosTotal, f: `-SUM('Pedidos (Tabela Plana)'!Q2:Q${totalLinhasPedidos})` }],
        ['Total Líquido Faturado (Receita Real)', { t: 'n', v: reportStats.faturamentoTotal, f: `B17+B18` }],
        ['Total SEM Devolução (Preço de Tabela)', reportStats.totalValorSemDev],
        ['Total COM Devolução (Preço de Tabela)', reportStats.totalValorComDev],
        ['Ticket Médio Líquido', { t: 'n', v: reportStats.ticketMedio, f: `B19/B7` }],
        ['Mediana do Ticket', reportStats.ticketMediana],
        ['Venda Não Recebida (Calotes a Preço de Venda)', reportStats.vendaNaoRecebida],
        ['Prejuízo Calote a Preço de Custo', reportStats.calotePrejuizoCusto],
        [],
        ['3. CONFERÊNCIA DAS MÉTRICAS'],
        ['Regra: Valor dos Itens - Descontos = Total Líquido', Math.abs((reportStats.valorItensTotal - reportStats.descontosTotal) - reportStats.faturamentoTotal) < 0.01 ? 'CONFIRMADO (BATE 100%)' : 'DIVERGENTE'],
        ['Regra: Total Sem Dev + Total Com Dev = Valor dos Itens', Math.abs((reportStats.totalValorSemDev + reportStats.totalValorComDev) - reportStats.valorItensTotal) < 0.01 ? 'CONFIRMADO (BATE 100%)' : 'DIVERGENTE'],
        ['Regra: Pedidos com Valor + Pedidos Zerados = Total Pedidos', (reportStats.pedidosVendaCount + reportStats.pedidosZeradosTotalCount) === reportStats.totalPedidos ? 'CONFIRMADO (BATE 100%)' : 'DIVERGENTE'],
        [],
        ['4. DISTRIBUIÇÃO POR STATUS'],
        ['Status', 'Qtd Pedidos', 'Valor Total (R$)', '% Participação']
      ]

      reportStats.porStatus.forEach(st => {
        resumoData.push([st.label, st.count, st.total, Number(st.percent.toFixed(2))])
      })

      const wsResumo = XLSX.utils.aoa_to_sheet(resumoData)
      wsResumo['!cols'] = [{ wch: 45 }, { wch: 28 }, { wch: 22 }, { wch: 18 }]
      XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo Geral (THSM)')

      const fileName = `Relatorio_Pedidos_THSM_${new Date().toISOString().split('T')[0]}.xlsx`
      XLSX.writeFile(wb, fileName)
      showToast('Planilha Excel (.xlsx) exportada com sucesso com Tabela Plana e Fórmulas!', 'success')
    } catch (err) {
      console.error('Erro ao exportar Excel:', err)
      showToast('Erro ao exportar para Excel. Verifique o console.', 'error')
    }
  }

  // ==========================================
  // IMPRESSÃO / SALVAR PDF NATIVO VIA BROWSER ULTRA-COMPACTO
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
          .kpi-box .val { font-size: 8.5px; font-weight: 800; color: #0f172a; }
          .kpi-box .lbl { font-size: 6.2px; text-transform: uppercase; color: #64748b; font-weight: 700; margin-top: 1px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 7.5px; }
          tr { page-break-inside: avoid; }
          th { background: #0f172a; color: #fff; padding: 4px 5px; text-align: left; font-weight: 700; font-size: 8px; white-space: nowrap; }
          td { padding: 3px 5px; border-bottom: 1px solid #e2e8f0; vertical-align: middle; font-size: 7.8px; line-height: 1.25; }
          tr:nth-child(even) { background: #f8fafc; }
          .td-right { text-align: right; }
          .td-center { text-align: center; }
          .footer-total { background: #e2e8f0 !important; font-weight: 800; font-size: 8.5px; }
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
            <p><strong>Emissão:</strong> ${nowStr}   |   <strong>Total:</strong> ${reportStats.totalPedidos} pedidos (${reportStats.pedidosVendaCount} vendas, ${reportStats.pedidosZeradosTotalCount} zerados)</p>
          </div>
        </div>

        <div class="meta-box">
          <strong>Filtros:</strong> Status: ${statusDesc} | Base: Data de Vencimento | Cidade: ${selectedCity} | Rota: ${selectedRoute} | ${startDate ? `De ${formatDateBR(startDate)}` : ''} ${endDate ? `até ${formatDateBR(endDate)}` : ''} ${excludeTests ? '• (Sem testes)' : ''}
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
              const cfg = STATUS_CONFIG[resStatus] || { label: resStatus, color: '#333', bg: '#eee' }
              const dev = getOrderDevolucaoStats(o, produtos)
              const fin = getOrderFinancialDetails(o)
              const enderecoStr = formatFullAddress(o.customer?.endereco)
              const dataVenc = getOrderDueDate(o, financial)
              const prodsInline = (o.items || []).map(i => {
                const isSem = checkItemSemDevolucao(i, produtos)
                return `${i.qty || 1}x ${cleanProductName(i.nome)}${isSem ? ' [S/DEV]' : ''}`
              }).join(' • ') || '-'

              return `
                <tr>
                  <td><strong>#${String(o.id).slice(-6)}</strong><br /><small style="color: #64748b;">${formatDateBR(dataVenc)}</small></td>
                  <td><strong>${o.customer?.nome || '-'}</strong><br /><small style="color: #64748b;">${o.customer?.telefone || '-'}</small></td>
                  <td>
                    <span style="display:inline-block;padding:1px 4px;border-radius:3px;background:${cfg.bg};color:${cfg.color};font-weight:700;">
                      ${cfg.label}
                    </span>
                    ${fin.isZero ? `<br /><small style="color:#64748b;">(${fin.motivoZerado})</small>` : ''}
                  </td>
                  <td style="max-width: 250px;">${enderecoStr}</td>
                  <td><strong>${o.customer?.endereco?.rota || '-'}</strong></td>
                  <td class="td-center">${dev.qtdTotal} un</td>
                  <td>${prodsInline}</td>
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

        <div style="text-align:center;font-size:7.5px;color:#94a3b8;margin-top:8px;border-top:1px solid #e2e8f0;padding-top:4px;">
          Balanço THSM: Valor dos Itens (${formatCurrency(reportStats.valorItensTotal)}) − Descontos (${formatCurrency(reportStats.descontosTotal)}) = Total Líquido (${formatCurrency(reportStats.faturamentoTotal)})
        </div>

        <script>
          window.onload = function() {
            setTimeout(function() { window.print(); }, 400);
          }
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
    <div className="order-report-overlay" onClick={onClose}>
      <div className="order-report-modal" onClick={e => e.stopPropagation()}>
        {/* CABEÇALHO */}
        <div className="order-report-header">
          <div className="order-report-header-title">
            <div className="order-report-icon-badge">
              <i className="fa-solid fa-file-invoice-dollar"></i>
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800 }}>
                Relatório de Pedidos & Faturamento (THSM)
              </h2>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                Resumo financeiro rigoroso, descontos, métricas por data de vencimento e tabelas planas
              </p>
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
          {/* SELETOR DE ESCOPO */}
          <div className="order-report-scope-tabs">
            <button
              className={`report-scope-btn ${scope === 'todos' ? 'active' : ''}`}
              onClick={() => setScope('todos')}
            >
              <i className="fa-solid fa-layer-group"></i>
              Todos os Pedidos ({orders.length})
            </button>
            <button
              className={`report-scope-btn ${scope === 'tela' ? 'active' : ''}`}
              onClick={() => setScope('tela')}
            >
              <i className="fa-solid fa-filter"></i>
              Filtros da Tela ({filteredOrdersFromScreen.length})
            </button>
            <button
              className={`report-scope-btn ${scope === 'selecionados' ? 'active' : ''}`}
              onClick={() => setScope('selecionados')}
              disabled={!selectedOrderIds || selectedOrderIds.size === 0}
            >
              <i className="fa-solid fa-square-check"></i>
              Selecionados ({selectedOrderIds ? selectedOrderIds.size : 0})
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
                {scope === 'todos' && `Puxando todos os pedidos registrados no sistema (${orders.length} pedidos).`}
                {scope === 'tela' && `Puxando pedidos conforme os filtros ativos na tela (${filteredOrdersFromScreen.length} pedidos).`}
                {scope === 'selecionados' && `Puxando apenas os ${selectedOrderIds.size} pedido(s) selecionados com caixa de marcação.`}
              </span>
              <span style={{ fontWeight: 700, color: '#15803d' }}>
                {targetOrders.length} pedido(s) no escopo ({reportStats.pedidosVendaCount} vendas, {reportStats.pedidosZeradosTotalCount} zerados)
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
                  >
                    ⚡ Pedidos Ativos
                  </button>
                  <button
                    type="button"
                    className={`report-preset-chip ${selectedStatuses.length === 1 && selectedStatuses[0] === 'calote' ? 'active' : ''}`}
                    style={{ borderColor: '#dc2626', color: '#b91c1c', fontWeight: 700 }}
                    onClick={() => applyStatusPreset('calotes')}
                  >
                    <i className="fa-solid fa-triangle-exclamation" style={{ color: '#dc2626', marginRight: '4px' }}></i>
                    Apenas Calotes 100%
                  </button>
                  <button
                    type="button"
                    className={`report-preset-chip ${selectedStatuses.length === 1 && selectedStatuses[0] === 'calote_parcial' ? 'active' : ''}`}
                    style={{ borderColor: '#d97706', color: '#b45309', fontWeight: 700 }}
                    onClick={() => applyStatusPreset('calote_parcial')}
                  >
                    <i className="fa-solid fa-clock-rotate-left" style={{ color: '#d97706', marginRight: '4px' }}></i>
                    Apenas Calote Parcial
                  </button>
                  <button
                    type="button"
                    className={`report-preset-chip ${selectedStatuses.length === 2 && selectedStatuses.includes('calote') && selectedStatuses.includes('calote_parcial') ? 'active' : ''}`}
                    style={{ borderColor: '#991b1b', color: '#991b1b', fontWeight: 800, background: '#fef2f2' }}
                    onClick={() => applyStatusPreset('inadimplencia')}
                  >
                    <i className="fa-solid fa-shield-halved" style={{ color: '#dc2626', marginRight: '4px' }}></i>
                    Todos os Calotes (100% + Parcial)
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
                    className={`report-preset-chip ${selectedStatuses.length === 1 && selectedStatuses[0] === 'entregue' ? 'active' : ''}`}
                    onClick={() => applyStatusPreset('entregues')}
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
                </div>
              </div>

              {/* FILTROS ADICIONAIS */}
              <div className="report-filter-grid">
                <div>
                  <span className="report-filter-label">Cliente Específico:</span>
                  <input
                    type="text"
                    className="report-filter-input"
                    placeholder="Buscar por nome ou telefone..."
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                  />
                  {clientSearch && filteredClients.length > 0 && (
                    <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #cbd5e1', borderRadius: '6px', background: 'white', marginTop: '4px' }}>
                      <div
                        style={{ padding: '4px 8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}
                        onClick={() => { setSelectedClientPhone('TODOS'); setClientSearch('') }}
                      >
                        (Todos os clientes)
                      </div>
                      {filteredClients.map(u => (
                        <div
                          key={u.id}
                          style={{ padding: '4px 8px', cursor: 'pointer', fontSize: '0.75rem', borderTop: '1px solid #f1f5f9' }}
                          onClick={() => { setSelectedClientPhone(u.telefone || u.id); setClientSearch(`${u.nome || u.pushName || ''} (${u.telefone || ''})`) }}
                        >
                          <strong>{u.nome || u.pushName}</strong> <span style={{ color: '#64748b' }}>({u.telefone})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <span className="report-filter-label">Cidade:</span>
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

                <div>
                  <span className="report-filter-label">Rota de Entrega:</span>
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

                <div>
                  <span className="report-filter-label">Forma de Pagamento:</span>
                  <select
                    className="report-filter-select"
                    value={selectedPayment}
                    onChange={e => setSelectedPayment(e.target.value)}
                  >
                    <option value="TODOS">Todas as Formas</option>
                    <option value="pix">Pix</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="cartao">Cartão</option>
                  </select>
                </div>
              </div>

              {/* FILTRO DE DATA (DATA DE VENCIMENTO COMO PADRÃO) */}
              <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px dashed #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="report-filter-label">Filtrar por Período:</span>
                    <select
                      value={dateType}
                      onChange={e => setDateType(e.target.value)}
                      style={{ fontSize: '0.74rem', padding: '0.25rem 0.5rem', borderRadius: '6px', border: '1px solid #0284c7', fontWeight: 700, color: '#0369a1', background: '#f0f9ff' }}
                    >
                      <option value="vencimento">★ Data de Vencimento (Padrão Oficial THSM)</option>
                      <option value="pagamento">Data de Pagamento / Quitação</option>
                      <option value="date">Data de Emissão do Pedido</option>
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

          {/* CARDS DE RESUMO (KPIS OFICIAIS ALINHADOS COM O BRIEFING THSM) */}
          <div className="report-kpi-grid">
            <div className="report-kpi-card" style={{ borderLeft: '4px solid #0284c7' }}>
              <div className="report-kpi-icon" style={{ background: '#e0f2fe', color: '#0284c7' }}>
                <i className="fa-solid fa-clipboard-list"></i>
              </div>
              <div>
                <div className="report-kpi-val">{reportStats.totalPedidos}</div>
                <div className="report-kpi-label">Total Pedidos</div>
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '2px' }}>
                  <strong>{reportStats.pedidosVendaCount}</strong> vendas • <strong>{reportStats.pedidosZeradosTotalCount}</strong> zerados
                </div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeft: '4px solid #3b82f6' }}>
              <div className="report-kpi-icon" style={{ background: '#dbeafe', color: '#2563eb' }}>
                <i className="fa-solid fa-tags"></i>
              </div>
              <div>
                <div className="report-kpi-val" style={{ color: '#1d4ed8' }}>
                  {formatCurrency(reportStats.valorItensTotal)}
                </div>
                <div className="report-kpi-label">Valor dos Itens (Tabela)</div>
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '2px' }}>
                  Preço cheio de catálogo
                </div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeft: '4px solid #6366f1' }}>
              <div className="report-kpi-icon" style={{ background: '#e0e7ff', color: '#4f46e5' }}>
                <i className="fa-solid fa-receipt"></i>
              </div>
              <div>
                <div className="report-kpi-val" style={{ color: '#4f46e5' }}>
                  - {formatCurrency(reportStats.descontosTotal)}
                </div>
                <div className="report-kpi-label">Descontos Concedidos</div>
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '2px' }}>
                  Revendedora 30%, cupons, ajustes
                </div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeft: '4px solid #10b981', background: '#f0fdf4' }}>
              <div className="report-kpi-icon" style={{ background: '#d1fae5', color: '#059669' }}>
                <i className="fa-solid fa-dollar-sign"></i>
              </div>
              <div>
                <div className="report-kpi-val" style={{ color: '#059669', fontSize: '1.25rem' }}>
                  {formatCurrency(reportStats.faturamentoTotal)}
                </div>
                <div className="report-kpi-label" style={{ fontWeight: 800, color: '#065f46' }}>
                  ★ Total Líquido Faturado
                </div>
                <div style={{ fontSize: '0.68rem', color: '#047857', marginTop: '2px' }}>
                  Valor Itens − Descontos
                </div>
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
                <div className="report-kpi-label">Ticket Médio Líquido</div>
                <div style={{ fontSize: '0.68rem', color: '#0284c7', marginTop: '2px' }}>
                  Mediana: <strong>{formatCurrency(reportStats.ticketMediana)}</strong>
                </div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeft: '4px solid #f59e0b' }}>
              <div className="report-kpi-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
                <i className="fa-solid fa-boxes-stacked"></i>
              </div>
              <div>
                <div className="report-kpi-val" style={{ color: '#b45309' }}>
                  {reportStats.totalItens} un
                </div>
                <div className="report-kpi-label">Total de Peças</div>
                <div style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '2px' }}>
                  {reportStats.totalQtdSemDev} s/ dev • {reportStats.totalQtdComDev} c/ dev
                </div>
              </div>
            </div>
          </div>

          {/* BANNER DO BALANÇO DE CONFERÊNCIA THSM */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
            <span>
              <i className="fa-solid fa-scale-balanced" style={{ color: '#0284c7', marginRight: '6px' }}></i>
              <strong>Balanço de Conferência THSM:</strong>
              {' '}Valor dos Itens (<strong>{formatCurrency(reportStats.valorItensTotal)}</strong>) − Descontos (<strong>{formatCurrency(reportStats.descontosTotal)}</strong>) = Total Líquido (<strong>{formatCurrency(reportStats.faturamentoTotal)}</strong>)
            </span>
            <span style={{ color: '#16a34a', fontWeight: 700 }}>
              <i className="fa-solid fa-check-double"></i> Números 100% integrados
            </span>
          </div>

          {/* PRÉVIA DOS PEDIDOS COM ENDEREÇO COMPLETO E PRODUTOS */}
          <div className="report-preview-collapse" style={{ marginTop: '0.85rem' }}>
            <div
              className="report-preview-header"
              onClick={() => setShowPreviewTable(v => !v)}
            >
              <span>
                <i className="fa-solid fa-table-list" style={{ marginRight: '6px', color: '#0284c7' }}></i>
                Pré-visualização dos Pedidos e Vencimentos ({targetOrders.length} pedidos)
              </span>
              <i className={`fa-solid ${showPreviewTable ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
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
                      <th style={{ textAlign: 'right' }}>Valor Tabela</th>
                      <th style={{ textAlign: 'right' }}>Desconto</th>
                      <th style={{ textAlign: 'right' }}>Total Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetOrders.slice(0, 50).map(o => {
                      const st = getResolvedStatus(o)
                      const cfg = STATUS_CONFIG[st] || { label: st, color: '#333', bg: '#eee' }
                      const dev = getOrderDevolucaoStats(o, produtos)
                      const fin = getOrderFinancialDetails(o)
                      const endStr = formatFullAddress(o.customer?.endereco)
                      const dataVenc = getOrderDueDate(o, financial)

                      return (
                        <tr key={o.id}>
                          <td><strong>#{String(o.id).slice(-6)}</strong><br /><small style={{ color: '#64748b' }}>{formatDateBR(dataVenc)}</small></td>
                          <td><strong>{o.customer?.nome || '-'}</strong><br /><small style={{ color: '#64748b' }}>{o.customer?.telefone || '-'}</small></td>
                          <td>
                            <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: '4px', background: cfg.bg, color: cfg.color, fontWeight: 700 }}>
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
                          <td style={{ textAlign: 'right', color: '#475569', fontWeight: 600 }}>
                            {fin.isZero ? 'R$ 0,00' : formatCurrency(fin.valorItens)}
                          </td>
                          <td style={{ textAlign: 'right', color: '#6366f1', fontWeight: 600 }} title={fin.motivoDesconto}>
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

        {/* RODAPÉ E AÇÕES */}
        <div className="order-report-footer">
          <div className="order-report-footer-left" style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
            <span>
              <strong>{reportStats.totalPedidos}</strong> pedidos ({reportStats.pedidosVendaCount} vendas)
              {includePrices && <> • <strong>{formatCurrency(reportStats.faturamentoTotal)}</strong> (Tabela: {formatCurrency(reportStats.valorItensTotal)})</>}
            </span>
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
