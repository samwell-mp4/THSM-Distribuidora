import React, { useState, useMemo } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import './OrderReportModal.css'

const STATUS_CONFIG = {
  'pre-pedido': { label: 'Pré-Pedido', color: '#8b5cf6', bg: '#ede9fe' },
  'pendente': { label: 'Pendente', color: '#d97706', bg: '#fef3c7' },
  'confirmado': { label: 'Confirmado', color: '#2563eb', bg: '#dbeafe' },
  'em-andamento': { label: 'Em Andamento', color: '#4f46e5', bg: '#e0e7ff' },
  'em-rota': { label: 'Em Rota', color: '#0284c7', bg: '#e0f2fe' },
  'entregue': { label: 'Entregue', color: '#059669', bg: '#d1fae5' },
  'concluido': { label: 'Concluído', color: '#16a34a', bg: '#dcfce7' },
  'cancelado': { label: 'Cancelado', color: '#dc2626', bg: '#fee2e2' }
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
  const n = norm(nome).replace(/sem/, ' devol')
  return norm(nome).includes('semdevolu') || norm(nome).includes('sem-devolu') || norm(nome).includes('sem devolu') || norm(nome).includes('s/devolu')
}

// Verifica se um item é sem devolução
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
  if (!isOpen) return null

  // Escopo de dados: 'tela', 'selecionados', 'custom'
  const hasSelected = selectedOrderIds && selectedOrderIds.size > 0
  const [scope, setScope] = useState(hasSelected ? 'selecionados' : 'custom')

  // Filtros customizados
  const [selectedStatuses, setSelectedStatuses] = useState([
    'pendente', 'confirmado', 'em-andamento', 'em-rota', 'entregue', 'concluido'
  ])
  const [selectedClientPhone, setSelectedClientPhone] = useState('TODOS')
  const [clientSearch, setClientSearch] = useState('')
  const [selectedCity, setSelectedCity] = useState('TODAS')
  const [selectedRoute, setSelectedRoute] = useState('TODAS')
  const [selectedPayment, setSelectedPayment] = useState('TODOS')
  const [devolucaoFilter, setDevolucaoFilter] = useState('todos') // 'todos', 'com_sem_dev', 'apenas_sem_dev', 'apenas_com_dev'
  const [dateType, setDateType] = useState('date') // 'date' ou 'vencimento'
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
    rotas.forEach(r => { if (r.rota) set.add(r.rota.trim()) })
    orders.forEach(o => {
      const r = o.customer?.endereco?.rota
      if (r) set.add(r.trim())
    })
    return ['TODAS', ...Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))]
  }, [rotas, orders])

  // Normalização de status
  const getResolvedStatus = (o) => {
    if (o.status === 'entregue' && isFinalizada(o)) return 'concluido'
    return o.status || 'pendente'
  }

  // Lista filtrada de pedidos
  const targetOrders = useMemo(() => {
    let list = []
    if (scope === 'selecionados') {
      list = orders.filter(o => selectedOrderIds.has(o.id))
    } else if (scope === 'tela') {
      list = filteredOrdersFromScreen || []
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

        // 5. Forma de Pagamento
        if (selectedPayment !== 'TODOS') {
          const pag = o.pagamento || ''
          if (pag !== selectedPayment) return false
        }

        // 6. Datas
        const orderDate = dateType === 'vencimento' ? (o.dataVencimento || '') : (o.date || '')
        if (startDate && orderDate && orderDate < startDate) return false
        if (endDate && orderDate && orderDate > endDate) return false

        return true
      })
    }

    // Filtro adicional de Devolução
    if (devolucaoFilter !== 'todos') {
      list = list.filter(o => {
        const devStats = getOrderDevolucaoStats(o, produtos)
        if (devolucaoFilter === 'com_sem_dev') return devStats.hasSemDev
        if (devolucaoFilter === 'apenas_sem_dev') return devStats.hasSemDev && devStats.qtdComDev === 0
        if (devolucaoFilter === 'apenas_com_dev') return !devStats.hasSemDev
        return true
      })
    }

    return [...list].sort((a, b) => {
      const ta = new Date(a.date || 0).getTime()
      const tb = new Date(b.date || 0).getTime()
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
    isFinalizada
  ])

  // Resumo estatístico geral
  const reportStats = useMemo(() => {
    const totalPedidos = targetOrders.length
    let faturamentoTotal = 0
    let totalItens = 0
    let totalQtdSemDev = 0
    let totalQtdComDev = 0
    let totalValorSemDev = 0
    let totalValorComDev = 0

    const statusMap = {}
    Object.keys(STATUS_CONFIG).forEach(s => {
      statusMap[s] = { count: 0, total: 0 }
    })

    const pagMap = { avista: 0, aprazo: 0, misto: 0, outro: 0 }

    targetOrders.forEach(o => {
      const dev = getOrderDevolucaoStats(o, produtos)
      faturamentoTotal += dev.totalBruto
      totalItens += dev.qtdTotal
      totalQtdSemDev += dev.qtdSemDev
      totalQtdComDev += dev.qtdComDev
      totalValorSemDev += dev.totalSemDev
      totalValorComDev += dev.totalComDev

      const st = getResolvedStatus(o)
      if (!statusMap[st]) statusMap[st] = { count: 0, total: 0 }
      statusMap[st].count += 1
      statusMap[st].total += dev.totalBruto

      const p = o.pagamento || 'outro'
      if (pagMap[p] !== undefined) pagMap[p] += dev.totalBruto
      else pagMap.outro += dev.totalBruto
    })

    const ticketMedio = totalPedidos > 0 ? faturamentoTotal / totalPedidos : 0

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
      faturamentoTotal,
      ticketMedio,
      totalItens,
      totalQtdSemDev,
      totalQtdComDev,
      totalValorSemDev,
      totalValorComDev,
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
      case 'pendentes':
        setSelectedStatuses(['pre-pedido', 'pendente'])
        break
      case 'concluidos':
        setSelectedStatuses(['entregue', 'concluido'])
        break
      case 'rota':
        setSelectedStatuses(['em-rota'])
        break
      case 'pendentes_a_concluidos':
        setSelectedStatuses(['pendente', 'confirmado', 'em-andamento', 'em-rota', 'entregue', 'concluido'])
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
    if (!clientSearch) return usuarios.slice(0, 50)
    const t = clientSearch.toLowerCase().trim()
    return usuarios.filter(u =>
      (u.nome && u.nome.toLowerCase().includes(t)) ||
      (u.telefone && u.telefone.includes(t))
    ).slice(0, 50)
  }, [usuarios, clientSearch])

  // ==========================================
  // GERAÇÃO DE PDF PROFISSIONAL COM ENDEREÇO COMPLETO E PRODUTOS
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

      // 1. Cabeçalho Corporativo THSM
      doc.setFillColor(15, 23, 42) // #0f172a
      doc.rect(0, 0, pageWidth, 24, 'F')

      doc.setTextColor(255, 255, 255)
      doc.setFontSize(14)
      doc.setFont('helvetica', 'bold')
      doc.text('THSM DISTRIBUIDORA', 14, 11)

      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(203, 213, 225)
      doc.text('RELATÓRIO GERENCIAL DE PEDIDOS COM ENDEREÇO E ITENS', 14, 17)

      doc.setFontSize(8)
      doc.text(`Emitido em: ${nowStr}`, pageWidth - 14, 11, { align: 'right' })
      doc.text(`Total de Pedidos: ${reportStats.totalPedidos}`, pageWidth - 14, 17, { align: 'right' })

      let currentY = 28

      // 2. Metadados dos Filtros
      doc.setFillColor(241, 245, 249)
      doc.rect(14, currentY, pageWidth - 28, 12, 'F')
      doc.setDrawColor(226, 232, 240)
      doc.rect(14, currentY, pageWidth - 28, 12, 'S')

      doc.setFontSize(7.5)
      doc.setTextColor(71, 85, 105)
      doc.setFont('helvetica', 'bold')

      const statusDesc = selectedStatuses.length === Object.keys(STATUS_CONFIG).length
        ? 'Todos os Status'
        : selectedStatuses.map(s => STATUS_CONFIG[s]?.label || s).join(', ')

      const dateDesc = startDate || endDate
        ? `${startDate ? formatDateBR(startDate) : 'Início'} até ${endDate ? formatDateBR(endDate) : 'Hoje'}`
        : 'Todo o Período'

      const devDesc = devolucaoFilter === 'todos' ? 'Todos os produtos' : devolucaoFilter === 'com_sem_dev' ? 'Com itens SEM devolução' : devolucaoFilter === 'apenas_sem_dev' ? 'Apenas SEM devolução' : 'Apenas COM devolução'

      const filterLine = `Filtros: Status: ${statusDesc} | Devolução: ${devDesc} | Período: ${dateDesc} | Cidade: ${selectedCity} | Rota: ${selectedRoute}`
      doc.text(filterLine.slice(0, 150), 17, currentY + 7.5)

      currentY += 16

      // 3. Resumo Executivo e KPIs
      if (includeSummary) {
        doc.setFontSize(10)
        doc.setFont('helvetica', 'bold')
        doc.setTextColor(15, 23, 42)
        doc.text('RESUMO EXECUTIVO (COM QUEBRA DE DEVOLUÇÃO)', 14, currentY)
        currentY += 4

        const cardW = (pageWidth - 28 - 12) / 5
        const cardH = 14
        const kpis = [
          { label: 'TOTAL PEDIDOS', val: String(reportStats.totalPedidos), color: [2, 132, 199] },
          { label: 'TOTAL BRUTO', val: formatCurrency(reportStats.faturamentoTotal), color: [16, 185, 129] },
          { label: 'SEM DEVOLUÇÃO', val: formatCurrency(reportStats.totalValorSemDev), color: [220, 38, 38] },
          { label: 'COM DEVOLUÇÃO', val: formatCurrency(reportStats.totalValorComDev), color: [79, 70, 229] },
          { label: 'ITENS (TOTAL)', val: `${reportStats.totalItens} un (${reportStats.totalQtdSemDev} s/ dev)`, color: [245, 158, 11] }
        ]

        kpis.forEach((kpi, idx) => {
          const kpiX = 14 + idx * (cardW + 3)
          doc.setFillColor(248, 250, 252)
          doc.rect(kpiX, currentY, cardW, cardH, 'F')
          doc.setDrawColor(226, 232, 240)
          doc.rect(kpiX, currentY, cardW, cardH, 'S')

          doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2])
          doc.rect(kpiX, currentY, 2.5, cardH, 'F')

          doc.setFontSize(6.2)
          doc.setTextColor(100, 116, 139)
          doc.setFont('helvetica', 'bold')
          doc.text(kpi.label, kpiX + 4.5, currentY + 5)

          doc.setFontSize(8.5)
          doc.setTextColor(15, 23, 42)
          doc.text(kpi.val, kpiX + 4.5, currentY + 11)
        })

        currentY += cardH + 5
      }

      // 4. Tabela de Pedidos
      doc.setFontSize(10)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(15, 23, 42)
      doc.text('RELAÇÃO DE PEDIDOS E ITENS', 14, currentY)
      currentY += 3

      const tableHeaders = [
        'Data',
        'Cliente / Telefone',
        'Status',
        'Endereço Completo / Cidade',
        'Rota',
        'Qtd Itens',
        'Total S/ Dev',
        'Total C/ Dev',
        'Total Bruto'
      ]

      const tableBody = []

      targetOrders.forEach(o => {
        const dev = getOrderDevolucaoStats(o, produtos)
        const dateStr = formatDateBR(o.date)
        const clienteStr = `${o.customer?.nome || 'Não informado'}\n${o.customer?.telefone || '-'}`
        const resStatus = getResolvedStatus(o)
        const statusLabel = STATUS_CONFIG[resStatus]?.label || resStatus
        const enderecoCompleto = formatFullAddress(o.customer?.endereco)
        const rotaStr = o.customer?.endereco?.rota || '-'

        let qtdStr = `${dev.qtdTotal} un`
        if (dev.qtdSemDev > 0) qtdStr += `\n(${dev.qtdSemDev} s/dev)`

        // Linha principal do pedido
        tableBody.push([
          dateStr,
          clienteStr,
          statusLabel,
          enderecoCompleto,
          rotaStr,
          qtdStr,
          formatCurrency(dev.totalSemDev),
          formatCurrency(dev.totalComDev),
          formatCurrency(dev.totalBruto)
        ])

        // Se detalhamento de itens ativado, adiciona linha com todos os produtos descritos
        if (includeItemsDetail && o.items && o.items.length > 0) {
          const itemsText = o.items.map(item => {
            const isSem = checkItemSemDevolucao(item, produtos)
            const sub = Number(item.preco || 0) * Number(item.qty || 1)
            return `• ${item.qty || 1}x ${item.nome} (${formatCurrency(sub)})${isSem ? ' [SEM DEVOLUÇÃO]' : ''}`
          }).join('\n')

          tableBody.push([
            { content: '', styles: { cellPadding: 1 } },
            { content: `PRODUTOS DO PEDIDO #${String(o.id).slice(-6)}:\n${itemsText}`, colSpan: 8, styles: { fontSize: 6.5, textColor: [51, 65, 85], fontStyle: 'italic', fillColor: [248, 250, 252] } }
          ])
        }
      })

      // Linha de Totalizador
      const footRow = [
        'TOTAL GERAL',
        `${reportStats.totalPedidos} pedidos`,
        '',
        '',
        '',
        `${reportStats.totalItens} un (${reportStats.totalQtdSemDev} s/dev)`,
        formatCurrency(reportStats.totalValorSemDev),
        formatCurrency(reportStats.totalValorComDev),
        formatCurrency(reportStats.faturamentoTotal)
      ]

      autoTable(doc, {
        startY: currentY,
        head: [tableHeaders],
        body: tableBody,
        foot: [footRow],
        theme: 'striped',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontSize: 7.2,
          fontStyle: 'bold',
          cellPadding: 2
        },
        bodyStyles: {
          fontSize: 6.8,
          cellPadding: 2,
          textColor: [15, 23, 42]
        },
        footStyles: {
          fillColor: [226, 232, 240],
          textColor: [15, 23, 42],
          fontStyle: 'bold',
          fontSize: 7.2,
          cellPadding: 2
        },
        columnStyles: {
          0: { cellWidth: 16 }, // Data
          1: { cellWidth: 32 }, // Cliente/Tel
          2: { cellWidth: 18 }, // Status
          3: { cellWidth: 'auto' }, // Endereço Completo
          4: { cellWidth: 18 }, // Rota
          5: { cellWidth: 18, halign: 'center' }, // Qtd
          6: { cellWidth: 22, halign: 'right' }, // Total Sem Dev
          7: { cellWidth: 22, halign: 'right' }, // Total Com Dev
          8: { cellWidth: 24, halign: 'right', fontStyle: 'bold', textColor: [16, 185, 129] } // Total Bruto
        },
        margin: { left: 14, right: 14 }
      })

      // Rodapé em todas as páginas
      const totalPages = doc.internal.getNumberOfPages()
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i)
        doc.setFontSize(7.5)
        doc.setTextColor(148, 163, 184)
        doc.setDrawColor(226, 232, 240)
        doc.line(14, pageHeight - 10, pageWidth - 14, pageHeight - 10)
        doc.text('THSM Distribuidora — Sistema de Gestão Comercial', 14, pageHeight - 6)
        doc.text(`Página ${i} de ${totalPages}`, pageWidth - 14, pageHeight - 6, { align: 'right' })
      }

      const fileName = `Relatorio_Pedidos_THSM_${new Date().toISOString().split('T')[0]}.pdf`
      doc.save(fileName)
      showToast('Relatório PDF gerado e baixado com sucesso!', 'success')
    } catch (err) {
      console.error('Erro ao gerar PDF:', err)
      showToast('Erro ao gerar arquivo PDF. Verifique o console.', 'error')
    }
  }

  // ==========================================
  // EXPORTAÇÃO EXCEL PROFISSIONAL (.xlsx) IDÊNTICA À FOTO DO USUÁRIO
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
      // ABA 1: RELATÓRIO DE PEDIDOS (FORMATO EXATO DA FOTO DO USUÁRIO)
      // ==========================================
      const excelHeaders = [
        'data do pedido',
        'cliente',
        'status',
        'telefone',
        'endereço completo / cidade',
        'rota',
        'quantidade itens',
        'quantidade itens sem devolução',
        'quantidade de itens com devolução',
        'total sem devolução',
        'total com devolução',
        'total bruto'
      ]

      const mainSheetData = [excelHeaders]

      targetOrders.forEach(o => {
        const dev = getOrderDevolucaoStats(o, produtos)
        const dateStr = formatDateBR(o.date)
        const resStatus = getResolvedStatus(o)
        const statusLabel = STATUS_CONFIG[resStatus]?.label || resStatus
        const enderecoCompleto = formatFullAddress(o.customer?.endereco)
        const rotaStr = o.customer?.endereco?.rota || '-'

        // Linha Principal do Pedido
        mainSheetData.push([
          dateStr,
          o.customer?.nome || '-',
          statusLabel,
          o.customer?.telefone || '-',
          enderecoCompleto,
          rotaStr,
          dev.qtdTotal,
          dev.qtdSemDev,
          dev.qtdComDev,
          dev.totalSemDev,
          dev.totalComDev,
          dev.totalBruto
        ])

        // Linhas dos Produtos (como na foto: Qtd Nome | Preço | Tipo)
        if (o.items && o.items.length > 0) {
          o.items.forEach(item => {
            const isSem = checkItemSemDevolucao(item, produtos)
            const subtotal = Number(item.preco || 0) * Number(item.qty || 1)
            mainSheetData.push([
              '',
              '',
              `${item.qty || 1} ${item.nome}`,
              subtotal,
              isSem ? 'SEM DEVOLUÇÃO' : 'COM DEVOLUÇÃO',
              '',
              '',
              '',
              '',
              '',
              '',
              ''
            ])
          })
        }

        // Linha em branco separadora entre pedidos
        mainSheetData.push([])
      })

      // Linha final de TOTAL GERAL
      mainSheetData.push([
        'TOTAL GERAL',
        `${reportStats.totalPedidos} pedido(s)`,
        '',
        '',
        '',
        '',
        reportStats.totalItens,
        reportStats.totalQtdSemDev,
        reportStats.totalQtdComDev,
        reportStats.totalValorSemDev,
        reportStats.totalValorComDev,
        reportStats.faturamentoTotal
      ])

      const wsMain = XLSX.utils.aoa_to_sheet(mainSheetData)
      wsMain['!cols'] = [
        { wch: 14 }, // data do pedido
        { wch: 28 }, // cliente
        { wch: 28 }, // status / produto
        { wch: 16 }, // telefone / subtotal
        { wch: 45 }, // endereço completo / cidade
        { wch: 14 }, // rota
        { wch: 18 }, // quantidade itens
        { wch: 28 }, // quantidade itens sem devolução
        { wch: 30 }, // quantidade de itens com devolução
        { wch: 20 }, // total sem devolução
        { wch: 20 }, // total com devolução
        { wch: 18 }  // total bruto
      ]
      XLSX.utils.book_append_sheet(wb, wsMain, 'Relatório de Pedidos')

      // ==========================================
      // ABA 2: RESUMO EXECUTIVO (KPIS GERAIS)
      // ==========================================
      const resumoData = [
        ['THSM DISTRIBUIDORA - RESUMO EXECUTIVO DE PEDIDOS'],
        [`Gerado em: ${nowStr}`],
        [],
        ['INDICADORES GERAIS'],
        ['Total de Pedidos', reportStats.totalPedidos],
        ['Total Bruto Faturado (R$)', reportStats.faturamentoTotal],
        ['Total SEM Devolução (R$)', reportStats.totalValorSemDev],
        ['Total COM Devolução (R$)', reportStats.totalValorComDev],
        ['Ticket Médio (R$)', reportStats.ticketMedio],
        ['Total de Itens Vendidos', reportStats.totalItens],
        ['Qtd Itens SEM Devolução', reportStats.totalQtdSemDev],
        ['Qtd Itens COM Devolução', reportStats.totalQtdComDev],
        [],
        ['DISTRIBUIÇÃO POR STATUS'],
        ['Status', 'Qtd Pedidos', 'Valor Total (R$)', '% Participação']
      ]

      reportStats.porStatus.forEach(st => {
        resumoData.push([st.label, st.count, st.total, Number(st.percent.toFixed(2))])
      })

      const wsResumo = XLSX.utils.aoa_to_sheet(resumoData)
      wsResumo['!cols'] = [{ wch: 35 }, { wch: 24 }, { wch: 22 }, { wch: 18 }]
      XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo Geral')

      // ==========================================
      // ABA 3: ITENS DETALHADOS (TABELA PLANA)
      // ==========================================
      const itensHeaders = [
        'ID Pedido',
        'Data Pedido',
        'Cliente',
        'Telefone',
        'Endereço Completo',
        'Cidade',
        'Rota',
        'Produto',
        'Quantidade',
        'Preço Unitário (R$)',
        'Subtotal (R$)',
        'Sem Devolução'
      ]

      const itensRows = []
      targetOrders.forEach(o => {
        (o.items || []).forEach(item => {
          const isSem = checkItemSemDevolucao(item, produtos)
          itensRows.push([
            o.id,
            o.date ? formatDateBR(o.date) : '-',
            o.customer?.nome || '-',
            o.customer?.telefone || '-',
            formatFullAddress(o.customer?.endereco),
            o.customer?.endereco?.cidade || '-',
            o.customer?.endereco?.rota || '-',
            item.nome || '-',
            Number(item.qty) || 1,
            Number(item.preco) || 0,
            (Number(item.preco) || 0) * (Number(item.qty) || 1),
            isSem ? 'Sim' : 'Não'
          ])
        })
      })

      if (itensRows.length > 0) {
        const wsItens = XLSX.utils.aoa_to_sheet([itensHeaders, ...itensRows])
        wsItens['!cols'] = [
          { wch: 14 },
          { wch: 12 },
          { wch: 26 },
          { wch: 16 },
          { wch: 45 },
          { wch: 16 },
          { wch: 14 },
          { wch: 32 },
          { wch: 12 },
          { wch: 16 },
          { wch: 16 },
          { wch: 16 }
        ]
        XLSX.utils.book_append_sheet(wb, wsItens, 'Itens Detalhados')
      }

      const fileName = `Relatorio_Pedidos_THSM_${new Date().toISOString().split('T')[0]}.xlsx`
      XLSX.writeFile(wb, fileName)
      showToast('Planilha Excel (.xlsx) exportada com sucesso no formato padrão!', 'success')
    } catch (err) {
      console.error('Erro ao exportar Excel:', err)
      showToast('Erro ao exportar para Excel. Verifique o console.', 'error')
    }
  }

  // ==========================================
  // IMPRESSÃO / SALVAR PDF NATIVO VIA BROWSER
  // ==========================================
  const handlePrintView = () => {
    if (targetOrders.length === 0) {
      showToast('Nenhum pedido para imprimir.', 'error')
      return
    }

    const printWin = window.open('', '_blank', 'width=1200,height=800')
    if (!printWin) {
      showToast('Por favor, permita pop-ups para abrir a visualização de impressão.', 'warning')
      return
    }

    const nowStr = new Date().toLocaleString('pt-BR')
    const statusDesc = selectedStatuses.map(s => STATUS_CONFIG[s]?.label || s).join(', ')

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Relatório de Pedidos - THSM Distribuidora</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
          body { padding: 24px; color: #0f172a; background: #fff; }
          .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 2px solid #0f172a; margin-bottom: 16px; }
          .header h1 { font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 4px; }
          .header p { font-size: 11px; color: #64748b; }
          .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 14px; font-size: 11px; margin-bottom: 16px; line-height: 1.5; color: #334155; }
          .kpi-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 20px; }
          .kpi-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; border-left: 4px solid #0284c7; }
          .kpi-box .val { font-size: 15px; font-weight: 800; color: #0f172a; }
          .kpi-box .lbl { font-size: 9.5px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 20px; }
          th { background: #0f172a; color: #fff; padding: 8px 6px; text-align: left; font-weight: 700; font-size: 9.5px; }
          td { padding: 7px 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
          tr.order-row { background: #ffffff; }
          tr.items-row { background: #f8fafc; }
          .items-container { padding: 4px 8px 8px; font-size: 9.5px; color: #475569; }
          .item-line { margin-bottom: 3px; }
          .badge-nodev { background: #fee2e2; color: #dc2626; font-size: 8.5px; font-weight: 700; padding: 1px 4px; border-radius: 3px; margin-left: 4px; }
          .status-tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; }
          .td-right { text-align: right; }
          .footer-total { background: #e2e8f0; font-weight: 800; }
          .footer-note { text-align: center; font-size: 9px; color: #94a3b8; margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
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
            <p>RELATÓRIO GERENCIAL DE PEDIDOS COM ENDEREÇO E PRODUTOS</p>
          </div>
          <div style="text-align: right;">
            <p><strong>Emissão:</strong> ${nowStr}</p>
            <p><strong>Total:</strong> ${reportStats.totalPedidos} pedidos</p>
          </div>
        </div>

        <div class="meta-box">
          <strong>Filtros aplicados:</strong> Status: ${statusDesc} | Cidade: ${selectedCity} | Rota: ${selectedRoute} | ${startDate ? `De ${formatDateBR(startDate)}` : ''} ${endDate ? `até ${formatDateBR(endDate)}` : ''}
        </div>

        <div class="kpi-row">
          <div class="kpi-box" style="border-left-color: #0284c7;">
            <div class="val">${reportStats.totalPedidos}</div>
            <div class="lbl">Total Pedidos</div>
          </div>
          <div class="kpi-box" style="border-left-color: #10b981;">
            <div class="val">${formatCurrency(reportStats.faturamentoTotal)}</div>
            <div class="lbl">Total Bruto</div>
          </div>
          <div class="kpi-box" style="border-left-color: #dc2626;">
            <div class="val">${formatCurrency(reportStats.totalValorSemDev)}</div>
            <div class="lbl">Sem Devolução</div>
          </div>
          <div class="kpi-box" style="border-left-color: #4f46e5;">
            <div class="val">${formatCurrency(reportStats.totalValorComDev)}</div>
            <div class="lbl">Com Devolução</div>
          </div>
          <div class="kpi-box" style="border-left-color: #f59e0b;">
            <div class="val">${reportStats.totalItens} un</div>
            <div class="lbl">Total de Itens</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Cliente / Tel</th>
              <th>Status</th>
              <th>Endereço Completo / Destino</th>
              <th>Rota</th>
              <th class="td-right">Qtd Itens</th>
              <th class="td-right">Total S/ Dev</th>
              <th class="td-right">Total C/ Dev</th>
              <th class="td-right">Total Bruto</th>
            </tr>
          </thead>
          <tbody>
            ${targetOrders.map(o => {
              const resStatus = getResolvedStatus(o)
              const cfg = STATUS_CONFIG[resStatus] || { label: resStatus, color: '#333', bg: '#eee' }
              const dev = getOrderDevolucaoStats(o, produtos)
              const enderecoStr = formatFullAddress(o.customer?.endereco)

              const itemsHtml = (o.items || []).map(i => {
                const isSem = checkItemSemDevolucao(i, produtos)
                const sub = (Number(i.preco) || 0) * (Number(i.qty) || 1)
                return `<div class="item-line">• <strong>${i.qty}x ${i.nome}</strong> - ${formatCurrency(sub)} ${isSem ? '<span class="badge-nodev">SEM DEVOLUÇÃO</span>' : ''}</div>`
              }).join('')

              return `
                <tr class="order-row">
                  <td>${formatDateBR(o.date)}</td>
                  <td><strong>${o.customer?.nome || '-'}</strong><br><small style="color:#64748b;">${o.customer?.telefone || '-'}</small></td>
                  <td><span class="status-tag" style="background:${cfg.bg};color:${cfg.color};">${cfg.label}</span></td>
                  <td>${enderecoStr}</td>
                  <td><strong>${o.customer?.endereco?.rota || '-'}</strong></td>
                  <td class="td-right">${dev.qtdTotal} un</td>
                  <td class="td-right">${formatCurrency(dev.totalSemDev)}</td>
                  <td class="td-right">${formatCurrency(dev.totalComDev)}</td>
                  <td class="td-right" style="font-weight:700;color:#059669;">${formatCurrency(dev.totalBruto)}</td>
                </tr>
                ${itemsHtml ? `
                <tr class="items-row">
                  <td></td>
                  <td colspan="8">
                    <div class="items-container">
                      <strong style="color:#0f172a;display:block;margin-bottom:3px;">PRODUTOS:</strong>
                      ${itemsHtml}
                    </div>
                  </td>
                </tr>
                ` : ''}
              `
            }).join('')}
            <tr class="footer-total">
              <td colspan="5">TOTAL GERAL (${reportStats.totalPedidos} pedidos)</td>
              <td class="td-right">${reportStats.totalItens} un</td>
              <td class="td-right">${formatCurrency(reportStats.totalValorSemDev)}</td>
              <td class="td-right">${formatCurrency(reportStats.totalValorComDev)}</td>
              <td class="td-right">${formatCurrency(reportStats.faturamentoTotal)}</td>
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

  return (
    <div className="order-report-overlay" onClick={onClose}>
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
              className={`report-scope-btn ${scope === 'custom' ? 'active' : ''}`}
              onClick={() => setScope('custom')}
            >
              <i className="fa-solid fa-sliders"></i>
              Personalizar Filtros no Relatório
            </button>
            <button
              className={`report-scope-btn ${scope === 'tela' ? 'active' : ''}`}
              onClick={() => setScope('tela')}
            >
              <i className="fa-solid fa-desktop"></i>
              Usar Filtros Atuais da Tela ({filteredOrdersFromScreen.length})
            </button>
            <button
              className={`report-scope-btn ${scope === 'selecionados' ? 'active' : ''}`}
              onClick={() => setScope('selecionados')}
              disabled={!hasSelected}
              style={{ opacity: hasSelected ? 1 : 0.5, cursor: hasSelected ? 'pointer' : 'not-allowed' }}
            >
              <i className="fa-solid fa-check-square"></i>
              Apenas Selecionados ({selectedOrderIds.size})
            </button>
          </div>

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
                <div className="report-status-presets">
                  <button
                    type="button"
                    className="report-preset-chip"
                    onClick={() => applyStatusPreset('todos')}
                  >
                    Todos os Status
                  </button>
                  <button
                    type="button"
                    className="report-preset-chip active"
                    onClick={() => applyStatusPreset('pendentes_a_concluidos')}
                    title="Pendentes, confirmados, em rota, entregues e concluídos"
                  >
                    ⚡ Pendentes &gt; Concluídos
                  </button>
                  <button
                    type="button"
                    className="report-preset-chip"
                    onClick={() => applyStatusPreset('pendentes')}
                  >
                    Apenas Pendentes
                  </button>
                  <button
                    type="button"
                    className="report-preset-chip"
                    onClick={() => applyStatusPreset('rota')}
                  >
                    Apenas Em Rota
                  </button>
                  <button
                    type="button"
                    className="report-preset-chip"
                    onClick={() => applyStatusPreset('concluidos')}
                  >
                    Apenas Concluídos
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
                    <option value="todos">Todos os Pedidos (Mistos e Normais)</option>
                    <option value="com_sem_dev">Contém Itens SEM Devolução</option>
                    <option value="apenas_sem_dev">Apenas 100% SEM Devolução</option>
                    <option value="apenas_com_dev">Apenas COM Devolução (Normais)</option>
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
                      <option value="date">Data de Emissão do Pedido</option>
                      <option value="vencimento">Data de Vencimento</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <button type="button" className="report-preset-chip" onClick={() => applyDatePreset('today')}>Hoje</button>
                    <button type="button" className="report-preset-chip" onClick={() => applyDatePreset('last7')}>7 dias</button>
                    <button type="button" className="report-preset-chip" onClick={() => applyDatePreset('this_month')}>Este Mês</button>
                    <button type="button" className="report-preset-chip" onClick={() => applyDatePreset('clear')}>Limpar</button>
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

          {/* CARDS DE RESUMO (KPIS COM SEM DEVOLUÇÃO E COM DEVOLUÇÃO) */}
          <div className="report-kpi-grid">
            <div className="report-kpi-card" style={{ borderLeft: '4px solid #0284c7' }}>
              <div className="report-kpi-icon" style={{ background: '#e0f2fe', color: '#0284c7' }}>
                <i className="fa-solid fa-clipboard-list"></i>
              </div>
              <div>
                <div className="report-kpi-val">{reportStats.totalPedidos}</div>
                <div className="report-kpi-label">Pedidos Filtrados</div>
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
                <div className="report-kpi-label">Total Bruto</div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeft: '4px solid #dc2626' }}>
              <div className="report-kpi-icon" style={{ background: '#fee2e2', color: '#dc2626' }}>
                <i className="fa-solid fa-ban"></i>
              </div>
              <div>
                <div className="report-kpi-val" style={{ color: '#dc2626' }}>
                  {formatCurrency(reportStats.totalValorSemDev)}
                </div>
                <div className="report-kpi-label">Total Sem Devolução</div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeft: '4px solid #4f46e5' }}>
              <div className="report-kpi-icon" style={{ background: '#e0e7ff', color: '#4f46e5' }}>
                <i className="fa-solid fa-rotate-left"></i>
              </div>
              <div>
                <div className="report-kpi-val" style={{ color: '#4f46e5' }}>
                  {formatCurrency(reportStats.totalValorComDev)}
                </div>
                <div className="report-kpi-label">Total Com Devolução</div>
              </div>
            </div>

            <div className="report-kpi-card" style={{ borderLeft: '4px solid #f59e0b' }}>
              <div className="report-kpi-icon" style={{ background: '#fef3c7', color: '#d97706' }}>
                <i className="fa-solid fa-boxes-stacked"></i>
              </div>
              <div>
                <div className="report-kpi-val">{reportStats.totalItens} un</div>
                <div className="report-kpi-label">Itens ({reportStats.totalQtdSemDev} s/ dev)</div>
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
                Descrever Todos os Produtos/Itens em cada Pedido
              </label>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>Orientação do PDF:</span>
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
                      <th>Data</th>
                      <th>Cliente</th>
                      <th>Status</th>
                      <th>Endereço Completo</th>
                      <th>Rota</th>
                      <th>Qtd Itens</th>
                      <th style={{ textAlign: 'right' }}>Sem Dev.</th>
                      <th style={{ textAlign: 'right' }}>Com Dev.</th>
                      <th style={{ textAlign: 'right' }}>Total Bruto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targetOrders.slice(0, 50).map(o => {
                      const st = getResolvedStatus(o)
                      const cfg = STATUS_CONFIG[st] || { label: st, color: '#333', bg: '#eee' }
                      const dev = getOrderDevolucaoStats(o, produtos)
                      const endStr = formatFullAddress(o.customer?.endereco)

                      return (
                        <React.Fragment key={o.id}>
                          <tr>
                            <td>{formatDateBR(o.date)}</td>
                            <td><strong>{o.customer?.nome || '-'}</strong><br /><small style={{ color: '#64748b' }}>{o.customer?.telefone || '-'}</small></td>
                            <td>
                              <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: '4px', background: cfg.bg, color: cfg.color, fontWeight: 700 }}>
                                {cfg.label}
                              </span>
                            </td>
                            <td style={{ maxWidth: '280px', fontSize: '0.72rem', color: '#334155' }}>{endStr}</td>
                            <td><strong>{o.customer?.endereco?.rota || '-'}</strong></td>
                            <td>{dev.qtdTotal} un</td>
                            <td style={{ textAlign: 'right', color: '#dc2626' }}>{formatCurrency(dev.totalSemDev)}</td>
                            <td style={{ textAlign: 'right', color: '#4f46e5' }}>{formatCurrency(dev.totalComDev)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: '#059669' }}>
                              {formatCurrency(dev.totalBruto)}
                            </td>
                          </tr>
                          {includeItemsDetail && o.items && o.items.length > 0 && (
                            <tr style={{ background: '#f8fafc' }}>
                              <td></td>
                              <td colSpan="8" style={{ padding: '0.3rem 0.65rem', fontSize: '0.7rem', color: '#475569' }}>
                                <strong style={{ color: '#0f172a' }}>Itens: </strong>
                                {o.items.map((i, idx) => {
                                  const isSem = checkItemSemDevolucao(i, produtos)
                                  return (
                                    <span key={idx} style={{ marginRight: '8px' }}>
                                      {i.qty}x {i.nome} ({formatCurrency(i.preco * i.qty)})
                                      {isSem && <span style={{ color: '#dc2626', fontWeight: 700, marginLeft: '2px' }}>[S/ DEV]</span>}
                                    </span>
                                  )
                                })}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
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
          <div className="order-report-footer-left">
            <span><strong>{reportStats.totalPedidos}</strong> pedidos • <strong>{formatCurrency(reportStats.faturamentoTotal)}</strong> (S/ Dev: {formatCurrency(reportStats.totalValorSemDev)})</span>
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
