import { useState, useMemo, useCallback } from 'react'
import './CentralAnalise.css'

function formatPreco(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)
}
function fmtNum(v) {
  return new Intl.NumberFormat('pt-BR').format(Number(v) || 0)
}
function fmtK(v) {
  const n = Number(v) || 0
  if (Math.abs(n) >= 1000000) return (n / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'M'
  if (Math.abs(n) >= 1000) return (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k'
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}
function formatDate(str) {
  if (!str) return '-'
  const d = new Date(str + (str.length <= 10 ? 'T12:00:00' : ''))
  return d.toLocaleDateString('pt-BR')
}
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const hoje = today
function addDays(dt, n) {
  const d = new Date(dt + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function monthLabel(s) {
  if (!s) return ''
  const parts = s.split('-')
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${months[Number(parts[1]) - 1]}/${parts[0].slice(2)}`
}

const PERIODOS = [
  { id: '7d', label: '7 dias' },
  { id: '30d', label: '30 dias' },
  { id: 'mes', label: 'Este mês' },
  { id: 'mes-ant', label: 'Mês passado' },
  { id: 'ano', label: 'Este ano' },
  { id: 'todo', label: 'Todo período' },
  { id: 'custom', label: 'Personalizado' },
]

const PAL = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316']

const normStr = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

const STATUS_LABELS = {
  'pre-pedido': 'Pré-Pedido',
  'pendente': 'Pendente',
  'confirmado': 'Confirmado',
  'em-andamento': 'Em Andamento',
  'em-rota': 'Em Rota',
  'acerto': 'Acerto',
  'entregue': 'Entregue',
  'concluido': 'Concluído',
  'cancelado': 'Cancelado',
}

const STATUS_OPTIONS = [
  { id: 'todos', label: 'Todos os Status (exceto cancelados)' },
  { id: 'concluido', label: 'Concluído / Acertado' },
  { id: 'calote', label: 'Inadimplência / Calote 100%' },
  { id: 'em-rota', label: 'Em Rota' },
  { id: 'acerto', label: 'Em Acerto' },
  { id: 'entregue', label: 'Entregue' },
  { id: 'pendente', label: 'Pendente' },
  { id: 'pre-pedido', label: 'Pré-Pedido' },
  { id: 'confirmado', label: 'Confirmado' },
  { id: 'em-andamento', label: 'Em Andamento' },
  { id: 'cancelado', label: 'Cancelado' },
]

function Paginacao({ total, per, page, onPage }) {
  const pages = Math.max(1, Math.ceil(total / per))
  if (pages <= 1) return null
  const nums = []
  const lo = Math.max(1, page - 2)
  const hi = Math.min(pages, page + 2)
  for (let i = lo; i <= hi; i++) nums.push(i)
  return (
    <div className="ca-paginacao">
      <button className="ca-page-btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <i className="fa-solid fa-chevron-left"></i>
      </button>
      {lo > 1 && <span className="ca-page-dots">…</span>}
      {nums.map(n => (
        <button key={n} className={`ca-page-num ${n === page ? 'ca-page-on' : ''}`} onClick={() => onPage(n)}>{n}</button>
      ))}
      {hi < pages && <span className="ca-page-dots">…</span>}
      <button className="ca-page-btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <i className="fa-solid fa-chevron-right"></i>
      </button>
      <span className="ca-page-info">{total} registro(s)</span>
    </div>
  )
}

function TabelaPaginada({ cols, rows, per = 12, startPage = 1, defaultSortKey = null, defaultSortDir = 'desc' }) {
  const [page, setPage] = useState(startPage)
  const [sortKey, setSortKey] = useState(defaultSortKey)
  const [sortDir, setSortDir] = useState(defaultSortDir)

  const handleHeaderClick = (colKey) => {
    if (!colKey) return
    if (sortKey === colKey) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(colKey)
      setSortDir('desc')
    }
    setPage(1)
  }

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows
    const colDef = cols.find(c => c.key === sortKey)
    return [...rows].sort((a, b) => {
      let valA = a[sortKey]
      let valB = b[sortKey]
      if (valA == null && valB == null) return 0
      if (valA == null) return 1
      if (valB == null) return -1

      if (typeof valA === 'number' || typeof valB === 'number' || colDef?.num) {
        const numA = Number(valA) || 0
        const numB = Number(valB) || 0
        return sortDir === 'asc' ? numA - numB : numB - numA
      }

      const strA = String(valA).toLowerCase()
      const strB = String(valB).toLowerCase()
      return sortDir === 'asc' ? strA.localeCompare(strB, 'pt-BR') : strB.localeCompare(strA, 'pt-BR')
    })
  }, [rows, sortKey, sortDir, cols])

  const total = sortedRows.length
  const pages = Math.max(1, Math.ceil(total / per))
  const cur = Math.min(page, pages)
  const slice = sortedRows.slice((cur - 1) * per, cur * per)
  return (
    <div>
      <div className="ca-tbl-wrap">
        <table className="ca-tbl">
          <thead>
            <tr>
              {cols.map((c, i) => {
                const isSorted = sortKey === c.key
                return (
                  <th
                    key={i}
                    className={`${c.num ? 'ca-th-num' : ''} ca-th-sortable`}
                    onClick={() => handleHeaderClick(c.key)}
                    style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                    title={`Ordenar por ${c.label} (${isSorted ? (sortDir === 'asc' ? 'Crescente' : 'Decrescente') : 'Clique para ordenar'})`}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', justifyContent: c.num ? 'flex-end' : 'flex-start', width: '100%' }}>
                      <span>{c.label}</span>
                      <i
                        className={`fa-solid ${isSorted ? (sortDir === 'asc' ? 'fa-arrow-up-short-wide' : 'fa-arrow-down-wide-short') : 'fa-sort'}`}
                        style={{
                          fontSize: '0.72rem',
                          opacity: isSorted ? 1 : 0.35,
                          color: isSorted ? 'var(--accent, #6366f1)' : 'inherit'
                        }}
                      />
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, ri) => (
              <tr key={row._k ?? ri}>
                {cols.map((c, ci) => (
                  <td key={ci} className={c.num ? 'ca-td-num' : ''}>
                    {c.render ? c.render(row) : row[c.key] ?? '-'}
                  </td>
                ))}
              </tr>
            ))}
            {slice.length === 0 && (
              <tr><td colSpan={cols.length} className="ca-empty-cell">Sem dados no período selecionado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Paginacao total={total} per={per} page={cur} onPage={setPage} />
    </div>
  )
}

const SUBPAGES = [
  { id: 'geral', label: 'Visão Geral', icon: 'fa-gauge-high' },
  { id: 'vendas', label: 'Vendas', icon: 'fa-cart-shopping' },
  { id: 'produtos', label: 'Produtos', icon: 'fa-box-open' },
  { id: 'servicos', label: 'Serviços', icon: 'fa-briefcase' },
  { id: 'financeiro', label: 'Financeiro', icon: 'fa-coins' },
  { id: 'clientes', label: 'Clientes', icon: 'fa-users' },
  { id: 'performance', label: 'Performance', icon: 'fa-arrow-trend-up' },
  { id: 'relatorios', label: 'Relatórios', icon: 'fa-table-list' },
]

function BarChart({ data, getLabel, getValue, color = '#4f46e5', fmt = fmtK }) {
  const sData = useMemo(() => [...data].reverse(), [data])
  const max = Math.max(1, ...sData.map(d => Math.max(0, getValue(d))))
  return (
    <div className="ca-bars">
      {sData.map((d, i) => {
        const v = Math.max(0, getValue(d))
        return (
          <div key={i} className="ca-bar-col" title={`${getLabel(d)}: ${formatPreco(v)}`}>
            <span className="ca-bar-val">{fmt(v)}</span>
            <div className="ca-bar" style={{ height: `${Math.max(2, (v / max) * 150)}px`, background: `linear-gradient(180deg, ${color}, ${color}77)` }}></div>
            <span className="ca-bar-label">{getLabel(d)}</span>
          </div>
        )
      })}
      {sData.length === 0 && <div className="ca-empty">Sem dados no período</div>}
    </div>
  )
}

function HBar({ data, getLabel, getValue, fmt = fmtK, maxVal }) {
  const max = maxVal || Math.max(1, ...data.map(getValue))
  return (
    <div className="ca-hbar">
      {data.map((d, i) => (
        <div key={i} className="ca-hbar-row">
          <span className="ca-hbar-label">{getLabel(d)}</span>
          <div className="ca-hbar-track">
            <div className="ca-hbar-fill" style={{ width: `${Math.max(2, (getValue(d) / max) * 100)}%`, background: PAL[i % PAL.length] }}></div>
          </div>
          <span className="ca-hbar-val">{fmt(getValue(d))}</span>
        </div>
      ))}
      {data.length === 0 && <div className="ca-empty">Sem dados no período</div>}
    </div>
  )
}

function Donut({ data, center }) {
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0) || 1
  let acc = 0
  const segs = data.map((d, i) => {
    const from = (acc / total) * 360
    acc += Number(d.value) || 0
    const to = (acc / total) * 360
    return `${PAL[i % PAL.length]} ${from.toFixed(2)}deg ${to.toFixed(2)}deg`
  }).join(', ')
  return (
    <div className="ca-donut-wrap">
      <div className="ca-donut" style={{ background: `conic-gradient(${segs})` }}>
        <div className="ca-donut-hole">
          <strong>{fmtK(total)}</strong>
          <span>{center || 'Total'}</span>
        </div>
      </div>
      <div className="ca-donut-legend">
        {data.map((d, i) => (
          <div key={i} className="ca-leg">
            <span className="ca-leg-dot" style={{ background: PAL[i % PAL.length] }}></span>
            <span className="ca-leg-label">{d.label}</span>
            <span className="ca-leg-val">{fmtK(d.value)}</span>
            <span className="ca-leg-pct">{total ? ((Number(d.value) || 0) / total * 100).toFixed(1) : 0}%</span>
          </div>
        ))}
        {data.length === 0 && <div className="ca-empty">Sem dados</div>}
      </div>
    </div>
  )
}

export default function CentralAnalise({ orders, financial, despesas, produtos, usuarios, onBack }) {
  const [page, setPage] = useState('geral')
  const [periodo, setPeriodo] = useState('mes')
  const [cstStart, setCstStart] = useState(addDays(today(), -30))
  const [cstEnd, setCstEnd] = useState(today())
  const [statusFilter, setStatusFilter] = useState('todos')
  const [relatorio, setRelatorio] = useState('vendas')

  const win = useMemo(() => {
    const t = today()
    const d = new Date()
    if (periodo === '7d') return { start: addDays(t, -6), end: t }
    if (periodo === '30d') return { start: addDays(t, -29), end: t }
    if (periodo === 'mes') return { start: t.slice(0, 7) + '-01', end: t }
    if (periodo === 'mes-ant') {
      const dd = new Date(d.getFullYear(), d.getMonth(), 0)
      const last = dd.getDate()
      return { start: `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-01`, end: `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}` }
    }
    if (periodo === 'ano') return { start: `${d.getFullYear()}-01-01`, end: t }
    if (periodo === 'custom') return { start: cstStart || '', end: cstEnd || '' }
    return { start: '', end: '' }
  }, [periodo, cstStart, cstEnd])

  const prevWin = useMemo(() => {
    if (!win.start || !win.end) return { start: '', end: '' }
    const diff = Math.round((new Date(win.end + 'T12:00:00') - new Date(win.start + 'T12:00:00')) / 86400000) || 30
    const end = addDays(win.start, -1)
    return { start: addDays(end, -diff), end }
  }, [win])

  const fit = (dt, w) => {
    if (!dt) return false
    if (w.start && dt < w.start) return false
    if (w.end && dt > w.end) return false
    return true
  }

  const matchStatus = (o, st) => {
    if (!st || st === 'todos') return o.status !== 'cancelado'
    if (st === 'concluido') return (o.status === 'concluido' || o.isFinalizado === true || o.status === 'acerto') && !o.isCalote && o.status !== 'calote' && o.motivoEncerramento !== 'calote_100'
    if (st === 'calote') return !!(o.isCalote || o.status === 'calote' || o.motivoEncerramento === 'calote_100')
    return o.status === st
  }

  const normDespesas = useMemo(() => {
    return (despesas || []).map(d => {
      if (!d) return null
      const numVal = Number(d.value !== undefined && d.value !== null && d.value !== '' ? d.value : (d.valor !== undefined && d.valor !== null && d.valor !== '' ? d.valor : (d.data?.valor || d.data?.value || 0))) || 0
      const cleanVal = Math.round(numVal * 100) / 100
      const dateStr = d.dueDate || d.paidDate || d.date || d.data?.dueDate || d.data?.paidDate || d.data?.date || (d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : '')
      const tipoStr = d.tipo || d.categoria || d.data?.categoria || d.data?.tipo || 'Outros'
      const descStr = d.descricao || d.estabelecimento || d.data?.descricao || '-'
      const statusStr = d.status || (d.paidDate ? 'pago' : 'pendente')
      const pmStr = d.paymentMethod || d.formaPagamento || d.data?.formaPagamento || 'pix'
      return {
        ...d,
        value: cleanVal,
        valor: cleanVal,
        dueDate: dateStr,
        paidDate: d.paidDate || (statusStr === 'pago' ? dateStr : null),
        date: dateStr,
        tipo: tipoStr,
        categoria: d.categoria || tipoStr,
        descricao: descStr,
        status: statusStr,
        paymentMethod: pmStr,
        formaPagamento: d.formaPagamento || pmStr
      }
    }).filter(Boolean)
  }, [despesas])

  const ordersWin = useMemo(() => orders.filter(o => matchStatus(o, statusFilter) && fit(o.date || '', win)), [orders, win, statusFilter])
  const ordersPrev = useMemo(() => orders.filter(o => matchStatus(o, statusFilter) && fit(o.date || '', prevWin)), [orders, prevWin, statusFilter])
  const finWin = useMemo(() => financial.filter(f => f.status !== 'cancelado' && fit(f.dueDate || '', win)), [financial, win])
  const finPrev = useMemo(() => financial.filter(f => f.status !== 'cancelado' && fit(f.dueDate || '', prevWin)), [financial, prevWin])
  const despWin = useMemo(() => normDespesas.filter(d => fit(d.dueDate || d.paidDate || d.date || '', win)), [normDespesas, win])

  const prodCostMap = useMemo(() => {
    const map = new Map()
      ; (produtos || []).forEach(p => {
        if (p) {
          const c = Number(p.preco_custo) || Number(p.custo) || Number(p.precoCusto) || 0
          if (p.id != null) map.set(String(p.id), c)
          if (p.nome) {
            map.set(p.nome.trim().toLowerCase(), c)
            map.set(normStr(p.nome), c)
          }
          if (p.displayName) {
            map.set(p.displayName.trim().toLowerCase(), c)
            map.set(normStr(p.displayName), c)
          }
        }
      })
    return map
  }, [produtos])

  const getItemCost = useCallback((i) => {
    if (!i) return 0
    if (i.preco_custo !== null && i.preco_custo !== undefined && i.preco_custo !== '') {
      const n = Number(i.preco_custo)
      if (!isNaN(n) && n >= 0) return n
    }
    if (i.custo !== null && i.custo !== undefined && i.custo !== '') {
      const n = Number(i.custo)
      if (!isNaN(n) && n >= 0) return n
    }
    if (i.precoCusto !== null && i.precoCusto !== undefined && i.precoCusto !== '') {
      const n = Number(i.precoCusto)
      if (!isNaN(n) && n >= 0) return n
    }
    if (i.id != null && prodCostMap.has(String(i.id))) return prodCostMap.get(String(i.id))
    const raw = (i.nome || i.displayName || i.produto || '').trim().toLowerCase()
    if (raw && prodCostMap.has(raw)) return prodCostMap.get(raw)
    const normalized = normStr(i.nome || i.displayName || i.produto || '')
    if (normalized && prodCostMap.has(normalized)) return prodCostMap.get(normalized)
    return 0
  }, [prodCostMap])

  const agg = (list) => {
    let desc = 0, n = 0
    let mercadoriaColocada = 0
    let faturamentoConcluido = 0
    let descConcluido = 0
    let pedidosConcluidos = 0
    let pedidosCalote = 0
    let totalItensColocados = 0
    let totalItensVendidos = 0
    let totalItensDevolvidos = 0
    let totalItensCalote = 0
    let caloteTotalCusto = 0
    let caloteTotalVenda = 0
    let custoConcluido = 0

    list.forEach(o => {
      n += 1
      const isConcluido = o.status === 'concluido' || o.isFinalizado === true || o.status === 'acerto'
      const isCalote = !!(o.isCalote || o.status === 'calote' || o.motivoEncerramento === 'calote_100')
      const vOriginal = Number(o.totalOriginal || o.totalConsignado || o.total) || 0
      mercadoriaColocada += vOriginal

      let itensPedido = 0
        ; (o.items || []).forEach(i => {
          itensPedido += Number(i.qty) || 0
        })
      totalItensColocados += itensPedido

      if (isCalote) {
        pedidosCalote += 1
        const pecas = Number(o.calotePecas) || itensPedido
        const cCusto = Number(o.caloteTotalCusto) || (o.items || []).reduce((s, i) => s + getItemCost(i) * (Number(i.qty) || 0), 0)
        const cVenda = Number(o.caloteTotalVenda) || vOriginal
        totalItensCalote += pecas
        caloteTotalCusto += cCusto
        caloteTotalVenda += cVenda
        const devPecasCalote = (o.returnedItems || []).reduce((s, r) => s + (Number(r.returnedQty || r.qty) || 0), 0)
        totalItensDevolvidos += devPecasCalote
      } else if (isConcluido) {
        pedidosConcluidos += 1
        const fat = Number(o.totalAcerto ?? o.totalPago ?? o.total) || 0
        faturamentoConcluido += fat
        const d = Number(o.desconto) || 0
        descConcluido += d
        desc += d

        const retMap = {}
          ; (o.returnedItems || []).forEach(r => {
            if (!r) return
            const k = r.id != null ? String(r.id) : (r.nome || '')
            retMap[k] = (retMap[k] || 0) + (Number(r.returnedQty || r.qty) || 0)
          })

          ; (o.items || []).forEach(i => {
            const k = i.id != null ? String(i.id) : (i.nome || '')
            const totalQ = Number(i.qty) || 0
            const retQ = retMap[k] || 0
            const soldQ = Math.max(0, totalQ - retQ)
            totalItensVendidos += soldQ
            totalItensDevolvidos += retQ
            custoConcluido += getItemCost(i) * soldQ
          })
      } else {
        desc += Number(o.desconto) || 0
      }
    })

    const faturamentoConcluidoLiq = Math.max(0, faturamentoConcluido - descConcluido)
    const taxaConversao = totalItensColocados > 0 ? (totalItensVendidos / totalItensColocados) * 100 : 0
    const taxaCalote = totalItensColocados > 0 ? (totalItensCalote / totalItensColocados) * 100 : 0
    const taxaCaloteVenda = mercadoriaColocada > 0 ? (caloteTotalVenda / mercadoriaColocada) * 100 : 0
    const mediaPecasPorCalote = pedidosCalote > 0 ? Math.round(totalItensCalote / pedidosCalote) : 0
    const mediaCustoPorCalote = pedidosCalote > 0 ? Math.round((caloteTotalCusto / pedidosCalote) * 100) / 100 : 0
    const mediaVendaPorCalote = pedidosCalote > 0 ? Math.round((caloteTotalVenda / pedidosCalote) * 100) / 100 : 0
    const lucroConcluido = faturamentoConcluidoLiq - custoConcluido
    const margemConcluida = faturamentoConcluido ? (lucroConcluido / faturamentoConcluido) * 100 : 0

    return {
      bruto: faturamentoConcluido,
      liq: faturamentoConcluidoLiq,
      desc,
      descConcluido,
      custo: custoConcluido,
      qty: totalItensVendidos,
      n,
      ticket: pedidosConcluidos ? faturamentoConcluido / pedidosConcluidos : 0,
      lucro: lucroConcluido,
      margem: margemConcluida,
      mercadoriaColocada,
      faturamentoConcluido,
      faturamentoConcluidoLiq,
      pedidosConcluidos,
      pedidosCalote,
      totalItensColocados,
      totalItensVendidos,
      totalItensDevolvidos,
      totalItensCalote,
      caloteTotalCusto,
      caloteTotalVenda,
      taxaConversao,
      taxaCalote,
      taxaCaloteVenda,
      mediaPecasPorCalote,
      mediaCustoPorCalote,
      mediaVendaPorCalote,
      custoConcluido,
      lucroConcluido,
      margemConcluida
    }
  }

  const cur = useMemo(() => agg(ordersWin), [ordersWin, prodCostMap, getItemCost])
  const prev = useMemo(() => agg(ordersPrev), [ordersPrev, prodCostMap, getItemCost])

  const delta = (c, p) => {
    if (!p) return null
    if (c === p) return 0
    return ((c - p) / Math.abs(p)) * 100
  }

  const serie = useMemo(() => {
    const map = {}
    ordersWin.forEach(o => {
      const k = (o.date || '').slice(0, 7)
      if (!k) return
      if (!map[k]) map[k] = {
        mes: k,
        bruto: 0,
        liq: 0,
        custo: 0,
        n: 0,
        nConcluidos: 0,
        desc: 0,
        frete: 0,
        qtd: 0,
        itensColocados: 0,
        itensVendidos: 0,
        calotePecas: 0,
        caloteCusto: 0,
        caloteVenda: 0,
        pedidosCalote: 0,
        faturamentoConcluido: 0,
        mercadoriaColocada: 0,
      }
      const isConcluido = o.status === 'concluido' || o.isFinalizado === true || o.status === 'acerto'
      const isCalote = !!(o.isCalote || o.status === 'calote' || o.motivoEncerramento === 'calote_100')
      const vOriginal = Number(o.totalOriginal || o.totalConsignado || o.total) || 0
      map[k].mercadoriaColocada += vOriginal

      let itensPedido = 0
        ; (o.items || []).forEach(i => {
          itensPedido += Number(i.qty) || 0
        })
      map[k].itensColocados += itensPedido
      map[k].n += 1

      if (isCalote) {
        map[k].pedidosCalote += 1
        const pecas = Number(o.calotePecas) || itensPedido
        const cCusto = Number(o.caloteTotalCusto) || (o.items || []).reduce((s, i) => s + getItemCost(i) * (Number(i.qty) || 0), 0)
        const cVenda = Number(o.caloteTotalVenda) || vOriginal
        map[k].calotePecas += pecas
        map[k].caloteCusto += cCusto
        map[k].caloteVenda += cVenda
      } else if (isConcluido) {
        map[k].nConcluidos += 1
        const fat = Number(o.totalAcerto ?? o.totalPago ?? o.total) || 0
        map[k].faturamentoConcluido += fat
        map[k].bruto += fat
        map[k].desc += Number(o.desconto) || 0
        map[k].frete += o.frete || 0

        const retMap = {}
          ; (o.returnedItems || []).forEach(r => {
            if (!r) return
            const key = r.id != null ? String(r.id) : (r.nome || '')
            retMap[key] = (retMap[key] || 0) + (Number(r.returnedQty || r.qty) || 0)
          })

          ; (o.items || []).forEach(i => {
            const key = i.id != null ? String(i.id) : (i.nome || '')
            const totalQ = Number(i.qty) || 0
            const retQ = retMap[key] || 0
            const soldQ = Math.max(0, totalQ - retQ)
            map[k].itensVendidos += soldQ
            map[k].qtd += soldQ
            map[k].custo += getItemCost(i) * soldQ
          })
      } else {
        map[k].desc += o.desconto || 0
        map[k].frete += o.frete || 0
      }
    })
    return Object.values(map).sort((a, b) => a.mes.localeCompare(b.mes)).map(m => {
      const liq = Math.max(0, m.faturamentoConcluido - m.desc)
      return {
        ...m,
        liq,
        lucro: liq - m.custo,
        margem: m.faturamentoConcluido ? ((liq - m.custo) / m.faturamentoConcluido) * 100 : 0,
        taxaConversao: m.itensColocados > 0 ? (m.itensVendidos / m.itensColocados) * 100 : 0,
        taxaCalotePecas: m.itensColocados > 0 ? (m.calotePecas / m.itensColocados) * 100 : 0,
        taxaCaloteVenda: m.mercadoriaColocada > 0 ? (m.caloteVenda / m.mercadoriaColocada) * 100 : 0,
        mediaPecasPorCalote: m.pedidosCalote > 0 ? Math.round(m.calotePecas / m.pedidosCalote) : 0,
        ticket: m.nConcluidos > 0 ? m.faturamentoConcluido / m.nConcluidos : 0
      }
    })
  }, [ordersWin, prodCostMap, getItemCost])

  const prodRank = useMemo(() => {
    const map = {}
    ordersWin.forEach(o => {
      const isConcluido = o.status === 'concluido' || o.isFinalizado === true || o.status === 'acerto'
      const isCalote = !!(o.isCalote || o.status === 'calote' || o.motivoEncerramento === 'calote_100')

      const retMap = {}
      if (isConcluido && Array.isArray(o.returnedItems)) {
        o.returnedItems.forEach(r => {
          if (!r) return
          const k = r.id != null ? String(r.id) : (r.nome || '')
          retMap[k] = (retMap[k] || 0) + (Number(r.returnedQty || r.qty) || 0)
        })
      }

      ; (o.items || []).forEach(i => {
        const name = i.displayName || i.nome || i.produto || 'Produto'
        if (!map[name]) map[name] = { nome: name, qty: 0, bruto: 0, custo: 0, hasCost: false, itensColocados: 0 }
        const totalQ = Number(i.qty) || 0
        map[name].itensColocados += totalQ

        let q = totalQ
        if (isConcluido) {
          const k = i.id != null ? String(i.id) : (i.nome || '')
          const retQ = retMap[k] || 0
          q = Math.max(0, totalQ - retQ)
        } else if (isCalote) {
          q = 0
        }

        const c = getItemCost(i)
        map[name].qty += q
        map[name].bruto += (Number(i.preco) || 0) * q
        if (c > 0) {
          map[name].custo += c * q
          map[name].hasCost = true
        }
      })
    })
    return Object.values(map).map(p => {
      const hasValidCost = p.hasCost && p.custo > 0
      // Considerar a comissão padrão de 30% do consignado
      const comissao = p.bruto * 0.30
      const receitaLiquida = p.bruto - comissao
      const lucro = hasValidCost ? (receitaLiquida - p.custo) : 0
      const margem = (hasValidCost && p.bruto > 0) ? (lucro / p.bruto) * 100 : null
      return {
        ...p,
        comissao,
        receitaLiquida,
        lucro,
        margem: margem !== null ? margem : 0,
        hasCost: hasValidCost
      }
    }).sort((a, b) => b.bruto - a.bruto)
  }, [ordersWin, prodCostMap, getItemCost])

  const cliRank = useMemo(() => {
    const map = {}
    ordersWin.forEach(o => {
      const name = o.customer?.nome || 'Sem nome'
      if (!map[name]) map[name] = { nome: name, pedidos: 0, itens: 0, bruto: 0 }
      map[name].pedidos += 1
      map[name].bruto += o.total || 0
      map[name].itens += (o.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0)
    })
    return Object.values(map).map(c => ({ ...c, ticket: c.pedidos ? c.bruto / c.pedidos : 0 })).sort((a, b) => b.bruto - a.bruto)
  }, [ordersWin])

  const finSit = useMemo(() => {
    const pago = finWin.filter(f => f.status === 'pago').reduce((s, f) => s + (f.value || 0), 0)
    const aberto = finWin.filter(f => f.status === 'pendente' && !(f.dueDate && f.dueDate < today())).reduce((s, f) => s + (f.value || 0), 0)
    const vencido = finWin.filter(f => f.status === 'pendente' && f.dueDate && f.dueDate < today()).reduce((s, f) => s + (f.value || 0), 0)
    return { pago, aberto, vencido, total: pago + aberto + vencido }
  }, [finWin])

  const pagMetodo = useMemo(() => {
    const map = {}
    finWin.forEach(f => {
      const m = f.paymentMethod || 'pix'
      if (!map[m]) map[m] = { label: m, value: 0 }
      map[m].value += f.value || 0
    })
    const labels = { pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão', 'pix+dinheiro': 'Pix + Dinheiro', 'pix+cartao': 'Pix + Cartão', 'cartao+dinheiro': 'Cartão + Dinheiro' }
    return Object.values(map).map(m => ({ ...m, label: labels[m.label] || m.label })).sort((a, b) => b.value - a.value)
  }, [finWin])

  const despTotal = useMemo(() => Number(despWin.reduce((s, d) => s + (d.value || 0), 0)), [despWin])

  const finPrevTotal = useMemo(() => finPrev.reduce((s, f) => s + (f.value || 0), 0), [finPrev])

  const finCliPorCliente = useMemo(() => {
    const map = {}
    finWin.forEach(f => {
      const name = f.customerName || 'Sem nome'
      if (!map[name]) map[name] = { nome: name, aberto: 0, pago: 0, vencido: 0 }
      const v = f.value || 0
      if (f.status === 'pago') map[name].pago += v
      else {
        map[name].aberto += v
        if (f.dueDate && f.dueDate < today()) map[name].vencido += v
      }
    })
    return Object.values(map).sort((a, b) => (b.aberto + b.vencido) - (a.aberto + a.vencido))
  }, [finWin])

  const caixaSerie = useMemo(() => {
    const map = {}
    finWin.forEach(f => {
      const k = (f.dueDate || '').slice(0, 7)
      if (!k) return
      if (!map[k]) map[k] = { mes: k, receitas: 0, gastos: 0 }
      map[k].receitas += f.value || 0
    })
    despWin.forEach(d => {
      const k = (d.dueDate || d.paidDate || d.date || '').slice(0, 7)
      if (!k) return
      if (!map[k]) map[k] = { mes: k, receitas: 0, gastos: 0 }
      map[k].gastos += Number(d.value) || 0
    })
    return Object.values(map).sort((a, b) => a.mes.localeCompare(b.mes)).map(m => ({ ...m, resultado: m.receitas - m.gastos }))
  }, [finWin, despWin])

  const inativos = useMemo(() => {
    return usuarios.map(u => {
      const pds = orders.filter(o => o.customer?.telefone === u.telefone || o.user_id === u.id)
      return { nome: u.nome || '-', tele: u.telefone || '-', ultima: pds.map(o => o.date || '').filter(Boolean).sort().pop() || '' }
    }).filter(u => !u.ultima || u.ultima < addDays(today(), -60)).sort((a, b) => a.ultima.localeCompare(b.ultima)).slice(0, 10)
  }, [usuarios, orders])

  const insights = useMemo(() => {
    const out = []
    const dBr = delta(cur.bruto, prev.bruto)
    if (dBr !== null) {
      out.push({ icon: 'fa-chart-line', tone: dBr >= 0 ? 'good' : 'bad', title: 'Evolução do faturamento', text: `O faturamento ${dBr >= 0 ? 'subiu' : 'caiu'} ${Math.abs(dBr).toFixed(1)}% em relação ao período anterior (${formatPreco(cur.bruto)} contra ${formatPreco(prev.bruto)}).` })
    } else {
      out.push({ icon: 'fa-chart-line', tone: 'neut', title: 'Faturamento', text: `${formatPreco(cur.bruto)} gerados no período.` })
    }
    const dTk = delta(cur.ticket, prev.ticket)
    if (dTk !== null) {
      out.push({ icon: 'fa-receipt', tone: dTk >= 0 ? 'good' : 'bad', title: 'Ticket médio', text: `Ticket médio de ${formatPreco(cur.ticket)} (${dTk >= 0 ? '+' : ''}${dTk.toFixed(1)}% vs período anterior).` })
    }
    out.push({ icon: 'fa-percent', tone: cur.margem >= 25 ? 'good' : cur.margem >= 10 ? 'neut' : 'bad', title: 'Margem atual', text: `Margem média de ${cur.margem.toFixed(1)}% sobre ${cur.n ? `${fmtNum(cur.n)} pedidos` : 'os dados disponíveis'}.` })
    if (prodRank[0]) {
      const pct = cur.bruto ? (prodRank[0].bruto / cur.bruto) * 100 : 0
      out.push({ icon: 'fa-box-open', tone: 'neut', title: 'Destaque de produto', text: `"${prodRank[0].nome}" é o mais vendido, com ${pct.toFixed(1)}% do faturamento (${formatPreco(prodRank[0].bruto)}).` })
    }
    if (cliRank[0]) {
      out.push({ icon: 'fa-user', tone: 'neut', title: 'Principal cliente', text: `"${cliRank[0].nome}" lidera com ${cliRank[0].pedidos} pedido(s) e ${formatPreco(cliRank[0].bruto)} no período.` })
    }
    if (finSit.vencido > 0) {
      const pct = finSit.total ? (finSit.vencido / finSit.total) * 100 : 0
      out.push({ icon: 'fa-triangle-exclamation', tone: pct > 15 ? 'bad' : 'neut', title: 'Risco de vencidos', text: `${formatPreco(finSit.vencido)} em contas vencidas (${pct.toFixed(1)}% do previsto do período).` })
    } else {
      out.push({ icon: 'fa-shield', tone: 'good', title: 'Atrasos', text: 'Nenhuma conta vencida no período. Bom controle financeiro.' })
    }
    if (despTotal > 0) {
      const pctDesp = cur.bruto ? (despTotal / cur.bruto) * 100 : 0
      out.push({ icon: 'fa-money-bill-wave', tone: pctDesp > 30 ? 'bad' : pctDesp > 15 ? 'neut' : 'good', title: 'Custo com despesas', text: `Despesas de ${formatPreco(despTotal)} no período${cur.bruto ? ` (${pctDesp.toFixed(1)}% do faturamento)` : ''}.` })
    }
    return out.slice(0, 6)
  }, [cur, prev, prodRank, cliRank, finSit, despTotal])

  const Kpi = ({ icon, label, value, change, hint }) => (
    <div className="ca-kpi">
      <div className="ca-kpi-top">
        <span className="ca-kpi-ico"><i className={`fa-solid ${icon}`}></i></span>
        {change !== null && change !== undefined && (
          <span className={`ca-kpi-chg ${change >= 0 ? 'ca-chg-good' : 'ca-chg-bad'}`}>
            <i className={`fa-solid ${change >= 0 ? 'fa-caret-up' : 'fa-caret-down'}`}></i> {Math.abs(change).toFixed(1)}%
          </span>
        )}
      </div>
      <strong className="ca-kpi-val">{value}</strong>
      <div className="ca-kpi-meta">
        <span>{label}</span>
        {hint && <em>{hint}</em>}
      </div>
    </div>
  )

  const Card = ({ title, icon, children }) => (
    <div className="ca-card">
      <div className="ca-card-head">
        <span className="ca-card-ico"><i className={`fa-solid ${icon}`}></i></span>
        <h3>{title}</h3>
      </div>
      <div className="ca-card-body">{children}</div>
    </div>
  )

  const renderGeral = () => (
    <>
      <div className="ca-kpis">
        <Kpi
          icon="fa-sack-dollar"
          label="Faturamento Real (Concluído)"
          value={formatPreco(cur.faturamentoConcluido)}
          change={delta(cur.faturamentoConcluido, prev.faturamentoConcluido)}
          hint={`${cur.pedidosConcluidos} pedido(s) concluído(s)`}
        />
        <Kpi
          icon="fa-truck-ramp-box"
          label="Mercadoria Colocada (Praça)"
          value={formatPreco(cur.mercadoriaColocada)}
          change={delta(cur.mercadoriaColocada, prev.mercadoriaColocada)}
          hint={`${fmtNum(cur.totalItensColocados)} peças distribuídas`}
        />
        <Kpi
          icon="fa-chart-pie"
          label="Conversão / Giro"
          value={`${cur.taxaConversao.toFixed(1)}%`}
          change={delta(cur.taxaConversao, prev.taxaConversao)}
          hint={`${fmtNum(cur.totalItensVendidos)} de ${fmtNum(cur.totalItensColocados)} peças vendidas`}
        />
        <Kpi
          icon="fa-arrow-trend-up"
          label="Margem Média Real"
          value={`${cur.margemConcluida.toFixed(1)}%`}
          change={delta(cur.lucroConcluido, prev.lucroConcluido)}
          hint={`Lucro: ${formatPreco(cur.lucroConcluido)}`}
        />
      </div>
      <div className="ca-grid">
        <Card title="Faturamento por mês (Vendas Concluídas)" icon="fa-chart-column">
          <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.faturamentoConcluido} color="#4f46e5" />
        </Card>
        <Card title="Mercadoria Colocada por mês (Praça)" icon="fa-truck-ramp-box">
          <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.mercadoriaColocada} color="#0ea5e9" />
        </Card>
      </div>
      <div className="ca-grid">
        <Card title="Formas de pagamento" icon="fa-wallet">
          <Donut data={pagMetodo} center="Previsto" />
        </Card>
        <Card title="Despesas do período" icon="fa-money-bill-wave">
          <div className="ca-desp">
            <span className="ca-desp-val">{formatPreco(despTotal)}</span>
            <span className="ca-desp-pct">{cur.faturamentoConcluido ? `equivalem a ${((despTotal / cur.faturamentoConcluido) * 100).toFixed(1)}% do faturamento real` : 'sem faturamento concluído no período'}</span>
          </div>
        </Card>
      </div>
      <div className="ca-grid">
        <Card title="Insights automáticos" icon="fa-lightbulb">
          <div className="ca-insights">
            {insights.map((ins, i) => (
              <div key={i} className={`ca-ins ca-ins-${ins.tone}`}>
                <i className={`fa-solid ${ins.icon}`}></i>
                <div>
                  <strong>{ins.title}</strong>
                  <span>{ins.text}</span>
                </div>
              </div>
            ))}
            {insights.length === 0 && <div className="ca-empty">Sem dados suficientes para gerar insights.</div>}
          </div>
        </Card>
      </div>
    </>
  )

  const renderVendas = () => (
    <>
      <div className="ca-kpis">
        <Kpi
          icon="fa-sack-dollar"
          label="Faturamento Real (Líquido)"
          value={formatPreco(cur.faturamentoConcluidoLiq)}
          change={delta(cur.faturamentoConcluidoLiq, prev.faturamentoConcluidoLiq)}
          hint={`${formatPreco(cur.descConcluido)} em descontos`}
        />
        <Kpi
          icon="fa-truck-ramp-box"
          label="Mercadoria Colocada"
          value={formatPreco(cur.mercadoriaColocada)}
          change={delta(cur.mercadoriaColocada, prev.mercadoriaColocada)}
          hint={`${fmtNum(cur.totalItensColocados)} peças distribuídas`}
        />
        <Kpi
          icon="fa-boxes-stacked"
          label="Itens vendidos"
          value={fmtNum(cur.totalItensVendidos)}
          change={delta(cur.totalItensVendidos, prev.totalItensVendidos)}
          hint={`${cur.taxaConversao.toFixed(1)}% de conversão`}
        />
        <Kpi
          icon="fa-money-bill-trend-up"
          label="Lucro Real Concluído"
          value={formatPreco(cur.lucroConcluido)}
          change={delta(cur.lucroConcluido, prev.lucroConcluido)}
          hint={`Margem: ${cur.margemConcluida.toFixed(1)}%`}
        />
      </div>
      <div className="ca-grid">
        <Card title="Ticket médio por mês (Concluídos)" icon="fa-chart-line">
          <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.ticket} color="#10b981" />
        </Card>
        <Card title="Pedidos concluídos por mês" icon="fa-chart-column">
          <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.nConcluidos || d.n} color="#0ea5e9" />
        </Card>
      </div>
      <Card title="Últimos pedidos" icon="fa-list">
        <TabelaPaginada
          per={15}
          cols={[
            { key: 'date', label: 'Data', render: o => formatDate(o.date) },
            { key: 'clienteNome', label: 'Cliente', render: o => o.customer?.nome || '-' },
            { key: 'totalPecas', label: 'Itens', num: true, render: o => fmtNum(o.totalPecas) },
            { key: 'colocado', label: 'Mercadoria Colocada', num: true, render: o => formatPreco(o.colocado) },
            { key: 'fatReal', label: 'Faturado Real', num: true, render: o => o.fatReal !== -1 ? <strong style={{ color: '#059669' }}>{formatPreco(o.fatReal)}</strong> : <span style={{ color: '#94a3b8' }}>-</span> },
            { key: 'status', label: 'Status', render: o => <span className={`ca-status ca-status-${o.status || 'pendente'}`}>{reqStatus(o)}</span> }
          ]}
          rows={ordersWin.map((o, idx) => {
            const isConcluido = o.status === 'concluido' || o.isFinalizado === true || o.status === 'acerto'
            const fatReal = isConcluido ? (Number(o.totalAcerto ?? o.totalPago ?? o.total) || 0) : null
            const colocado = Number(o.totalOriginal || o.totalConsignado || o.total) || 0
            const totalPecas = (o.items || []).reduce((s, x) => s + (Number(x.qty) || 0), 0)
            return {
              _k: o.id || idx,
              ...o,
              clienteNome: o.customer?.nome || '',
              totalPecas,
              colocado,
              fatReal: fatReal !== null ? fatReal : -1
            }
          })}
        />
      </Card>
    </>
  )

  const renderProdutos = () => {
    const top = prodRank.slice(0, 10)
    const bestMargem = prodRank.filter(p => p.hasCost && p.custo > 0 && p.bruto > 0 && p.margem > 0).sort((a, b) => b.margem - a.margem).slice(0, 10)
    const bestQty = prodRank.filter(p => p.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 10)
    return (
      <>
        <div className="ca-kpis">
          <Kpi icon="fa-box-open" label="Produtos distintos" value={fmtNum(prodRank.length)} change={null} hint="Com venda no período" />
          <Kpi icon="fa-boxes-stacked" label="Unidades vendidas" value={fmtNum(cur.qty)} change={delta(cur.qty, prev.qty)} hint="Total no período" />
          <Kpi icon="fa-tag" label="Produto líder" value={prodRank[0]?.nome || '-'} change={null} hint={prodRank[0] ? formatPreco(prodRank[0].bruto) : ''} />
          <Kpi icon="fa-sack-dollar" label="Faturamento bruto" value={formatPreco(cur.bruto)} change={delta(cur.bruto, prev.bruto)} hint="Todos os itens" />
        </div>
        <div className="ca-grid">
          <Card title="Mais vendidos (faturamento)" icon="fa-ranking-star">
            <HBar data={top} getLabel={p => p.nome} getValue={p => p.bruto} />
          </Card>
          <Card title="Mais vendidos (quantidade)" icon="fa-cubes">
            <HBar data={bestQty} getLabel={p => p.nome} getValue={p => p.qty} fmt={fmtNum} maxVal={Math.max(1, ...bestQty.map(p => p.qty))} />
          </Card>
        </div>
        <div className="ca-grid">
          <Card title="Melhor margem (itens com custo cadastrado)" icon="fa-gauge-high">
            {bestMargem.length > 0 ? (
              <HBar data={bestMargem} getLabel={p => p.nome} getValue={p => p.margem} fmt={v => `${v.toFixed(1)}%`} maxVal={Math.max(1, ...bestMargem.map(p => p.margem))} />
            ) : (
              <div className="ca-empty" style={{ padding: '1rem', color: '#64748b' }}>Cadastre o custo dos produtos para calcular margens reais.</div>
            )}
          </Card>
          <Card title="Ranking completo" icon="fa-table-list">
            <TabelaPaginada per={15} cols={[
              { key: 'nome', label: 'Produto' },
              { key: 'qty', label: 'Qtd', num: true },
              { key: 'bruto', label: 'Faturamento', num: true, render: r => formatPreco(r.bruto) },
              { key: 'margem', label: 'Margem', num: true, render: r => r.hasCost ? <span className="ca-margem-badge">{r.margem.toFixed(1)}%</span> : <span style={{ fontSize: '0.72rem', color: '#64748b', background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>Sem custo</span> },
            ]} rows={prodRank} />
          </Card>
        </div>
      </>
    )
  }

  const renderServicos = () => (
    <Card title="Serviços" icon="fa-briefcase">
      <div className="ca-empty ca-empty-lg">
        <i className="fa-solid fa-briefcase"></i>
        <p>Nenhum serviço registrado ainda.</p>
        <span>O módulo de serviços será ativado quando houver vendas de serviços no sistema.</span>
      </div>
    </Card>
  )

  const renderFinanceiro = () => (
    <>
      <div className="ca-kpis">
        <Kpi icon="fa-hand-holding-dollar" label="Previsto" value={formatPreco(finSit.total)} change={delta(finSit.total, finPrevTotal)} hint="A receber no período" />
        <Kpi icon="fa-circle-check" label="Recebido" value={formatPreco(finSit.pago)} change={null} hint="Contas pagas" />
        <Kpi icon="fa-hourglass-half" label="Em aberto" value={formatPreco(finSit.aberto)} change={null} hint="Dentro da data" />
        <Kpi icon="fa-triangle-exclamation" label="Vencido" value={formatPreco(finSit.vencido)} change={null} hint={`${formatPreco(despTotal)} em despesas`} />
      </div>
      <div className="ca-grid">
        <Card title="Situação das contas" icon="fa-chart-pie">
          <Donut
            data={[
              { label: 'Recebido', value: finSit.pago },
              { label: 'Em aberto', value: finSit.aberto },
              { label: 'Vencido', value: finSit.vencido },
            ]}
            center="Contas"
          />
        </Card>
        <Card title="Por forma de pagamento" icon="fa-chart-pie">
          <Donut data={pagMetodo} center="Previsto" />
        </Card>
      </div>
      <div className="ca-grid">
        <Card title="Caixa mensal" icon="fa-coins">
          <TabelaPaginada per={12} cols={[
            { key: 'mes', label: 'Mês', render: r => <strong>{monthLabel(r.mes)}</strong> },
            { key: 'receitas', label: 'Receitas', num: true, render: r => formatPreco(r.receitas) },
            { key: 'gastos', label: 'Despesas', num: true, render: r => formatPreco(r.gastos) },
            { key: 'resultado', label: 'Resultado', num: true, render: r => <span className={r.resultado >= 0 ? 'ca-t-good' : 'ca-t-bad'}>{formatPreco(r.resultado)}</span> },
          ]} rows={caixaSerie} />
        </Card>
        <Card title="Saldo por cliente" icon="fa-user-clock">
          <TabelaPaginada per={12} cols={[
            { key: 'nome', label: 'Cliente' },
            { key: 'aberto', label: 'Em aberto', num: true, render: r => formatPreco(r.aberto) },
            { key: 'vencido', label: 'Vencido', num: true, render: r => <span className={r.vencido ? 'ca-t-bad' : ''}>{formatPreco(r.vencido)}</span> },
          ]} rows={finCliPorCliente} />
        </Card>
      </div>
      <div className="ca-grid">
        <Card title="Recebimentos em atraso" icon="fa-clock-rotate-left">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px' }}>
              <span style={{ fontSize: '11px', color: '#b45309', fontWeight: 600, display: 'block' }}>Recebido em Atraso</span>
              <strong style={{ fontSize: '1.05rem', color: '#b45309' }}>{formatPreco(atrasosStats.totalValorAtraso)}</strong>
            </div>
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px' }}>
              <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 600, display: 'block' }}>Média de Demora</span>
              <strong style={{ fontSize: '1.05rem', color: '#dc2626' }}>{atrasosStats.mediaDias} dias</strong>
            </div>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px' }}>
              <span style={{ fontSize: '11px', color: '#166534', fontWeight: 600, display: 'block' }}>Quitações em Atraso</span>
              <strong style={{ fontSize: '1.05rem', color: '#166534' }}>{atrasosStats.countPagosComAtraso} títulos</strong>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px' }}>
              <span style={{ fontSize: '11px', color: '#475569', fontWeight: 600, display: 'block' }}>Vencidos Hoje (Aguardando)</span>
              <strong style={{ fontSize: '1.05rem', color: '#475569' }}>{formatPreco(atrasosStats.totalPendenteAtraso)}</strong>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
            Métrica de pontualidade: quando o cliente atrasa, a média é de <strong>{atrasosStats.mediaDias} dias após o vencimento</strong> para o recebimento entrar no caixa.
          </p>
        </Card>
      </div>
    </>
  )

  const renderClientes = () => (
    <>
      <div className="ca-kpis">
        <Kpi icon="fa-users" label="Clientes ativos" value={fmtNum(cliRank.length)} change={null} hint="Com compra no período" />
        <Kpi icon="fa-repeat" label="Ticket por ativo" value={formatPreco(cliRank.length ? cur.bruto / cliRank.length : 0)} change={null} hint="Faturamento / clientes" />
        <Kpi icon="fa-user-plus" label="Inativos (+60d)" value={fmtNum(inativos.length)} change={null} hint="Top de inativos" />
        <Kpi icon="fa-sack-dollar" label="Faturamento" value={formatPreco(cur.bruto)} change={delta(cur.bruto, prev.bruto)} hint="No período" />
      </div>
      <div className="ca-grid">
        <Card title="Ranking de clientes" icon="fa-ranking-star">
          <HBar data={cliRank.slice(0, 8)} getLabel={c => c.nome} getValue={c => c.bruto} />
        </Card>
        <Card title="Clientes inativos" icon="fa-person-circle-minus">
          <div className="ca-inativos">
            {inativos.map((u, i) => (
              <div className="ca-inat" key={i}>
                <strong>{u.nome}</strong>
                <span>{u.tele}</span>
                <em>Último pedido: {u.ultima ? formatDate(u.ultima) : 'nunca'}</em>
              </div>
            ))}
            {inativos.length === 0 && <div className="ca-empty">Nenhum cliente inativo no período.</div>}
          </div>
        </Card>
      </div>
      <Card title="Detalhamento por cliente" icon="fa-table-list">
        <TabelaPaginada per={15} cols={[
          { key: 'nome', label: 'Cliente' },
          { key: 'pedidos', label: 'Pedidos', num: true },
          { key: 'itens', label: 'Itens', num: true },
          { key: 'bruto', label: 'Faturamento', num: true, render: r => formatPreco(r.bruto) },
          { key: 'ticket', label: 'Ticket', num: true, render: r => formatPreco(r.ticket) },
        ]} rows={cliRank} />
      </Card>
    </>
  )

  const renderPerformance = () => {
    const lucro = cur.lucroConcluido
    const margem = cur.margemConcluida
    const perfMargem = prodRank.filter(p => p.hasCost && p.custo > 0 && p.bruto > 0 && p.margem > 0).sort((a, b) => b.margem - a.margem).slice(0, 8)
    const classes = { A: 0, B: 0, C: 0 }
    let totalBruto = prodRank.reduce((s, p) => s + p.bruto, 0)
    let acc = 0
    prodRank.forEach(p => {
      acc += p.bruto
      const pct = totalBruto ? (acc / totalBruto) * 100 : 0
      const key = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C'
      classes[key] += p.bruto
    })
    return (
      <>
        <div className="ca-kpis">
          <Kpi icon="fa-sack-dollar" label="Lucro líquido" value={formatPreco(lucro)} change={delta(lucro, prev.liq - prev.custo)} hint="Líquido - custo" />
          <Kpi icon="fa-percent" label="Margem líquida" value={`${margem.toFixed(1)}%`} change={null} hint="Lucro / receita" />
          <Kpi icon="fa-boxes-packing" label="CMV" value={`${cur.bruto ? ((cur.custo / cur.bruto) * 100).toFixed(1) : '0'}%`} change={null} hint={`Custo total ${formatPreco(cur.custo)}`} />
          <Kpi icon="fa-cubes" label="Unidades giradas" value={fmtNum(prodRank.reduce((s, p) => s + p.qty, 0))} change={null} hint="Vendido no período" />
        </div>
        <div className="ca-grid">
          <Card title="Curva ABC do faturamento" icon="fa-chart-pie">
            <Donut
              data={[
                { label: 'Classe A (até 80%)', value: classes.A },
                { label: 'Classe B (80-95%)', value: classes.B },
                { label: 'Classe C (restante)', value: classes.C },
              ]}
              center="Faturamento"
            />
          </Card>
          <Card title="Margem por produto" icon="fa-percent">
            <HBar data={perfMargem} getLabel={p => p.nome} getValue={p => p.margem} fmt={v => `${v.toFixed(1)}%`} maxVal={Math.max(1, ...perfMargem.map(p => p.margem))} />
          </Card>
        </div>
        <Card title="Giro de estoque" icon="fa-rotate">
          <TabelaPaginada per={15} cols={[
            { key: 'produto', label: 'Produto' },
            { key: 'vendido', label: 'Vendidos', num: true },
            { key: 'estoque', label: 'Estoque', num: true },
            { key: 'giro', label: 'Giro', num: true, render: r => r.giro !== null ? `${r.giro.toFixed(2)}x` : '-' },
          ]} rows={giroEstoque} />
        </Card>
      </>
    )
  }

  const RELATORIOS = [
    { id: 'vendas', label: 'Relação detalhada das vendas', icon: 'fa-file-invoice-dollar' },
    { id: 'produtos_vendidos', label: 'Produtos vendidos', icon: 'fa-box-open' },
    { id: 'vendas_mes', label: 'Vendas por período', icon: 'fa-chart-column' },
    { id: 'itens_mes', label: 'Itens vendidos por mês', icon: 'fa-cubes' },
    { id: 'conversao_giro', label: 'Itens deixados x % Vendidos', icon: 'fa-percent' },
    { id: 'inadimplencia_calote', label: 'Inadimplência e Calotes (Custo e Venda)', icon: 'fa-triangle-exclamation' },
    { id: 'atrasos', label: 'Recebimentos em atraso', icon: 'fa-clock-rotate-left' },
    { id: 'motivos_recusa', label: 'Motivos de recusa/devolução (Encomenda vs Planejamento)', icon: 'fa-clipboard-question' },
    { id: 'compras_sugestao', label: 'Sugestão / Relatório de Compras', icon: 'fa-cart-flatbed' },
    { id: 'custo', label: 'Custo da mercadoria', icon: 'fa-calculator' },
    { id: 'cmv', label: 'Análise de custo (CMV)', icon: 'fa-scale-balanced' },
    { id: 'lucro_mes', label: 'Lucro e margem por mês', icon: 'fa-chart-line' },
    { id: 'pagamentos', label: 'Formas de pagamento', icon: 'fa-credit-card' },
    { id: 'status', label: 'Pedidos por status', icon: 'fa-list-check' },
    { id: 'clientes', label: 'Análise de vendas por cliente', icon: 'fa-user-chart' },
    { id: 'fin_cliente', label: 'Situação financeira por cliente', icon: 'fa-coins' },
    { id: 'caixa', label: 'Fluxo de caixa', icon: 'fa-money-bill-trend-up' },
    { id: 'despesas', label: 'Relatório de despesas', icon: 'fa-receipt' },
    { id: 'impostos', label: 'Relatório de impostos', icon: 'fa-scale-balanced' },
    { id: 'inativos', label: 'Clientes inativos', icon: 'fa-user-clock' },
    { id: 'relacao_clientes', label: 'Relação de clientes', icon: 'fa-users' },
    { id: 'posicao', label: 'Posição de estoque', icon: 'fa-boxes-stacked' },
    { id: 'giro', label: 'Giro de estoque', icon: 'fa-rotate' },
  ]

  const reqStatus = (o) => STATUS_LABELS[o.status] || o.status || 'Pendente'

  const linhasVenda = useMemo(() => {
    return ordersWin.map(o => {
      const isConcluido = o.status === 'concluido' || o.isFinalizado === true || o.status === 'acerto'
      const vOriginal = Number(o.totalOriginal || o.totalConsignado || o.total) || 0
      const fatConcluido = isConcluido ? (Number(o.totalAcerto ?? o.totalPago ?? o.total) || 0) : 0
      const desc = Number(o.desconto) || 0
      const qtd = (o.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0)
      return {
        _k: o.id,
        pedido: `#${String(o.id).slice(-6)}`,
        cliente: o.customer?.nome || '-',
        data: formatDate(o.date),
        itens: qtd,
        mercadoriaColocada: vOriginal,
        fatConcluido,
        bruto: isConcluido ? fatConcluido : vOriginal,
        desc,
        liq: isConcluido ? Math.max(0, fatConcluido - desc) : Math.max(0, vOriginal - desc),
        frete: o.frete || 0,
        pag: o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto',
        status: o.status,
      }
    }).sort((a, b) => (b.data || '').localeCompare(a.data || ''))
  }, [ordersWin])

  const linhasProduto = useMemo(() => {
    const out = []
    ordersWin.forEach(o => {
      ; (o.items || []).forEach(i => {
        out.push({
          _k: `${o.id}-${i.index ?? out.length}`,
          produto: i.displayName || i.nome || i.produto || 'Produto',
          qty: Number(i.qty) || 0,
          valor: (Number(i.preco) || 0) * (Number(i.qty) || 0),
          cliente: o.customer?.nome || '-',
          data: formatDate(o.date),
          tipo: i.tipo === 'avista' ? 'À Vista' : 'A Prazo',
        })
      })
    })
    return out.sort((a, b) => (b.data || '').localeCompare(a.data || ''))
  }, [ordersWin])

  const statusOrders = useMemo(() => {
    const map = {}
    ordersWin.forEach(o => {
      const s = o.status || 'pendente'
      const vOriginal = Number(o.totalOriginal || o.totalConsignado || o.total) || 0
      const isConcluido = o.status === 'concluido' || o.isFinalizado === true || o.status === 'acerto'
      const fat = isConcluido ? (Number(o.totalAcerto ?? o.totalPago ?? o.total) || 0) : 0
      if (!map[s]) map[s] = { _k: s, status: s, qty: 0, valor: 0, faturado: 0 }
      map[s].qty += 1
      map[s].valor += vOriginal
      map[s].faturado += fat
    })
    return Object.values(map).sort((a, b) => b.qty - a.qty)
  }, [ordersWin])

  const despPorTipo = useMemo(() => {
    const map = {}
    despWin.forEach(d => {
      const t = d.tipo || d.categoria || 'Outros'
      if (!map[t]) map[t] = { _k: t, tipo: t, pago: 0, pendente: 0, total: 0, qty: 0 }
      const v = Number(d.value) || 0
      map[t].total += v
      map[t].qty += 1
      if (d.status === 'pago') map[t].pago += v
      else map[t].pendente += v
    })
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [despWin])

  const relacaoClientes = useMemo(() => {
    return usuarios.map(u => {
      const pds = orders.filter(o => o.customer?.telefone === u.telefone || o.user_id === u.id)
      const ult = pds.map(o => o.date || '').filter(Boolean).sort().pop() || ''
      return {
        _k: u.id || u.telefone,
        nome: u.nome || '-',
        tele: u.telefone || '-',
        cidade: u.endereco?.cidade || '-',
        rota: u.endereco?.rota || '-',
        pedidos: pds.length,
        ult,
      }
    })
  }, [usuarios, orders])

  const posicaoEstoque = useMemo(() => {
    return produtos.map(p => {
      const estoque = Number(p.estoque) || 0
      const preco = Number(p.preco) || 0
      const custo = Number(p.preco_custo) || Number(p.custo) || 0
      return {
        _k: p.id,
        produto: p.displayName || p.nome || p.id,
        estoque,
        vvenda: preco * estoque,
        vcusto: custo * estoque,
        cmedio: custo,
      }
    }).sort((a, b) => b.vvenda - a.vvenda)
  }, [produtos])

  const giroEstoque = useMemo(() => {
    return produtos.map(p => {
      const nome = p.displayName || p.nome || p.id
      const vendido = prodRank.find(x => x.nome === nome)?.qty || 0
      const estoque = Number(p.estoque) || 0
      return {
        _k: p.id,
        produto: nome,
        estoque,
        vendido,
        giro: vendido > 0 && estoque > 0 ? vendido / estoque : null,
      }
    }).filter(p => p.vendido > 0).sort((a, b) => b.vendido - a.vendido)
  }, [produtos, prodRank])

  const dadosImpostos = useMemo(() => {
    const bruto = ordersWin.reduce((s, o) => s + (o.total || 0), 0)
    const desc = ordersWin.reduce((s, o) => s + (o.desconto || 0), 0)
    const liq = Math.max(0, bruto - desc)
    return { bruto, desc, liq, imp: liq * 0.18 }
  }, [ordersWin])

  const linhasCalote = useMemo(() => {
    return ordersWin.filter(o => o.isCalote || o.status === 'calote' || o.motivoEncerramento === 'calote_100').map(o => {
      const pecas = Number(o.calotePecas) || (o.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0)
      const custo = Number(o.caloteTotalCusto) || (o.items || []).reduce((s, i) => s + getItemCost(i) * (Number(i.qty) || 0), 0)
      const venda = Number(o.caloteTotalVenda) || Number(o.totalOriginal || o.total) || 0
      return {
        _k: o.id,
        pedido: `#${String(o.id).slice(-6)}`,
        cliente: o.customer?.nome || '-',
        telefone: o.customer?.telefone || '-',
        cidade: o.customer?.endereco?.cidade || '-',
        data: formatDate(o.date),
        pecas,
        custo,
        venda
      }
    })
  }, [ordersWin, getItemCost])

  const atrasosStats = useMemo(() => {
    let totalValorAtraso = 0
    let totalDiasAtraso = 0
    let countPagosComAtraso = 0
    const linhasAtraso = []

    let totalPendenteAtraso = 0
    let totalDiasPendenteAtraso = 0
    let countPendenteAtraso = 0
    const linhasPendentes = []

    const hojeStr = hoje()
    const hojeTime = new Date(hojeStr + 'T12:00:00').getTime()
    const orderIdsCovered = new Set()

    financial.forEach(f => {
      if (f.orderId) orderIdsCovered.add(String(f.orderId))
      const due = f.dueDate ? f.dueDate.split('T')[0] : ''
      const paid = f.paidDate ? f.paidDate.split('T')[0] : ''
      const val = Number(f.value) || 0

      if (f.status === 'pago' && paid && due && paid > due) {
        const diffMs = new Date(paid + 'T12:00:00').getTime() - new Date(due + 'T12:00:00').getTime()
        const dias = Math.max(1, Math.round(diffMs / 86400000))
        totalValorAtraso += val
        totalDiasAtraso += dias
        countPagosComAtraso += 1
        linhasAtraso.push({
          _k: f.id,
          cliente: f.customerName || '-',
          valor: val,
          dueDate: formatDate(due),
          paidDate: formatDate(paid),
          diasAtraso: dias,
          metodo: f.paymentMethod || '-'
        })
      } else if (f.status === 'pendente' && due && due < hojeStr) {
        const diffMs = hojeTime - new Date(due + 'T12:00:00').getTime()
        const dias = Math.max(1, Math.round(diffMs / 86400000))
        totalPendenteAtraso += val
        totalDiasPendenteAtraso += dias
        countPendenteAtraso += 1
        linhasPendentes.push({
          _k: f.id,
          cliente: f.customerName || '-',
          valor: val,
          dueDate: formatDate(due),
          diasAtraso: dias,
          metodo: f.paymentMethod || '-'
        })
      }
    })

    // Complementar com pedidos concluídos com atraso que não foram fatiados no financial
    orders.forEach(o => {
      if (orderIdsCovered.has(String(o.id))) return
      const due = o.dataVencimento ? o.dataVencimento.split('T')[0] : ''
      if (!due) return
      const isConcluido = o.status === 'concluido' || o.isFinalizado === true
      const payDate = o.finalizadoAt ? new Date(o.finalizadoAt).toISOString().split('T')[0] : (o.date ? o.date.split('T')[0] : '')
      const val = Number(o.totalPago ?? o.totalAcerto ?? o.total) || 0

      if (isConcluido && payDate && payDate > due) {
        const diffMs = new Date(payDate + 'T12:00:00').getTime() - new Date(due + 'T12:00:00').getTime()
        const dias = Math.max(1, Math.round(diffMs / 86400000))
        totalValorAtraso += val
        totalDiasAtraso += dias
        countPagosComAtraso += 1
        linhasAtraso.push({
          _k: `order-${o.id}`,
          cliente: o.customer?.nome || '-',
          valor: val,
          dueDate: formatDate(due),
          paidDate: formatDate(payDate),
          diasAtraso: dias,
          metodo: o.paymentMethod || '-'
        })
      } else if (!isConcluido && o.status !== 'cancelado' && o.status !== 'calote' && due < hojeStr) {
        const pendVal = Number(o.valorEmAberto ?? o.total) || 0
        if (pendVal > 0) {
          const diffMs = hojeTime - new Date(due + 'T12:00:00').getTime()
          const dias = Math.max(1, Math.round(diffMs / 86400000))
          totalPendenteAtraso += pendVal
          totalDiasPendenteAtraso += dias
          countPendenteAtraso += 1
          linhasPendentes.push({
            _k: `order-pend-${o.id}`,
            cliente: o.customer?.nome || '-',
            valor: pendVal,
            dueDate: formatDate(due),
            diasAtraso: dias,
            metodo: o.paymentMethod || '-'
          })
        }
      }
    })

    const mediaDias = countPagosComAtraso > 0 ? Math.round(totalDiasAtraso / countPagosComAtraso) : 0
    const mediaDiasPendentes = countPendenteAtraso > 0 ? Math.round(totalDiasPendenteAtraso / countPendenteAtraso) : 0

    return {
      totalValorAtraso,
      countPagosComAtraso,
      mediaDias,
      totalPendenteAtraso,
      countPendenteAtraso,
      mediaDiasPendentes,
      linhasAtraso: linhasAtraso.sort((a, b) => b.diasAtraso - a.diasAtraso),
      linhasPendentes: linhasPendentes.sort((a, b) => b.diasAtraso - a.diasAtraso)
    }
  }, [financial, orders])

  const motivosDevolucaoStats = useMemo(() => {
    const counts = {
      nao_encomendado: { label: 'Teria sido encomenda', qty: 0, valor: 0 },
      mau_planejamento: { label: 'Mau planejamento THSM', qty: 0, valor: 0 },
      avaria: { label: 'Avaria / Defeito', qty: 0, valor: 0 },
      outro: { label: 'Outro motivo', qty: 0, valor: 0 }
    }
    const produtosMotivos = {}

    ordersWin.forEach(o => {
      ; (o.returnedItems || []).forEach(r => {
        if (!r) return
        const mot = r.motivoDevolucao || 'mau_planejamento'
        const q = Number(r.returnedQty || r.qty) || 0
        const p = Number(r.preco) || 0
        if (!counts[mot]) counts[mot] = { label: mot, qty: 0, valor: 0 }
        counts[mot].qty += q
        counts[mot].valor += p * q

        const prodNome = r.displayName || r.nome || 'Produto'
        if (!produtosMotivos[prodNome]) produtosMotivos[prodNome] = { nome: prodNome, nao_encomendado: 0, mau_planejamento: 0, avaria: 0, total: 0 }
        produtosMotivos[prodNome].total += q
        if (produtosMotivos[prodNome][mot] !== undefined) produtosMotivos[prodNome][mot] += q
      })
    })

    return {
      counts,
      porProduto: Object.values(produtosMotivos).sort((a, b) => b.total - a.total)
    }
  }, [ordersWin])

  const comprasSugestao = useMemo(() => {
    const demandMap = {}
    ordersWin.forEach(o => {
      ; (o.items || []).forEach(i => {
        const prodNome = i.displayName || i.nome || i.produto || 'Produto'
        if (!demandMap[prodNome]) demandMap[prodNome] = 0
        demandMap[prodNome] += Number(i.qty) || 0
      })
    })

    return (produtos || []).map(p => {
      const nome = p.displayName || p.nome || p.id
      const demandado = demandMap[nome] || 0
      const estoqueAtual = Number(p.estoque) || 0
      const custo = Number(p.preco_custo) || Number(p.custo) || Number(p.precoCusto) || 0
      const precoVenda = Number(p.preco) || 0
      const comprarQtd = Math.max(0, demandado - estoqueAtual)
      const custoCompra = comprarQtd * custo

      return {
        _k: p.id,
        produto: nome,
        categoria: p.categoria || 'Geral',
        demandado,
        estoqueAtual,
        comprarQtd,
        custoUnit: custo,
        custoTotal: custoCompra,
        precoVenda,
        status: comprarQtd > 0 ? (estoqueAtual === 0 ? 'critico' : 'comprar') : 'ok'
      }
    }).sort((a, b) => b.comprarQtd - a.comprarQtd || b.demandado - a.demandado)
  }, [produtos, ordersWin])

  const renderRelatorios = () => {
    const rep = relatorio
    if (rep === 'vendas') {
      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-sack-dollar" label="Faturamento Real (Concluído)" value={formatPreco(cur.faturamentoConcluido)} change={null} hint={`${cur.pedidosConcluidos} pedido(s) concluído(s)`} />
            <Kpi icon="fa-truck-ramp-box" label="Mercadoria Colocada (Praça)" value={formatPreco(cur.mercadoriaColocada)} change={null} hint={`${fmtNum(cur.totalItensColocados)} peças distribuídas`} />
            <Kpi icon="fa-tags" label="Descontos" value={formatPreco(cur.desc)} change={null} hint="Total aplicado" />
            <Kpi icon="fa-clipboard-list" label="Pedidos" value={`${cur.pedidosConcluidos} de ${cur.n}`} change={null} hint="Concluídos vs total" />
          </div>
          <Card title="Relação detalhada das vendas (Concluído vs Colocado)" icon="fa-file-invoice-dollar">
            <TabelaPaginada per={15} cols={[
              { key: 'pedido', label: 'Pedido' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'data', label: 'Data' },
              { key: 'itens', label: 'Itens', num: true },
              { key: 'mercadoriaColocada', label: 'Mercadoria Colocada', num: true, render: r => formatPreco(r.mercadoriaColocada) },
              { key: 'fatConcluido', label: 'Faturado Real', num: true, render: r => r.fatConcluido > 0 ? <strong style={{ color: '#059669' }}>{formatPreco(r.fatConcluido)}</strong> : <span style={{ color: '#94a3b8' }}>-</span> },
              { key: 'desc', label: 'Desc.', num: true, render: r => r.desc ? formatPreco(r.desc) : '-' },
              { key: 'pag', label: 'Pagamento' },
              { key: 'status', label: 'Status', render: r => <span className={`ca-status ca-status-${r.status || 'pendente'}`}>{reqStatus(r)}</span> },
            ]} rows={linhasVenda} />
          </Card>
        </>
      )
    }
    if (rep === 'produtos_vendidos') {
      const totalValor = linhasProduto.reduce((s, r) => s + r.valor, 0)
      const totalQty = linhasProduto.reduce((s, r) => s + r.qty, 0)
      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-boxes-stacked" label="Linhas" value={fmtNum(linhasProduto.length)} change={null} hint="Itens no período" />
            <Kpi icon="fa-cubes" label="Quantidade vendida" value={fmtNum(totalQty)} change={null} hint="Unidades" />
            <Kpi icon="fa-sack-dollar" label="Valor total" value={formatPreco(totalValor)} change={null} hint="Soma dos itens" />
          </div>
          <Card title="Produtos vendidos" icon="fa-box-open">
            <TabelaPaginada per={15} cols={[
              { key: 'produto', label: 'Produto' },
              { key: 'qty', label: 'Qtd', num: true },
              { key: 'valor', label: 'Valor total', num: true, render: r => formatPreco(r.valor) },
              { key: 'cliente', label: 'Cliente' },
              { key: 'data', label: 'Data da venda' },
              { key: 'tipo', label: 'Tipo do item' },
            ]} rows={linhasProduto} />
          </Card>
        </>
      )
    }
    if (rep === 'vendas_mes') {
      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-sack-dollar" label="Faturamento Real (Concluído)" value={formatPreco(cur.faturamentoConcluido)} change={null} hint={`${cur.pedidosConcluidos} pedido(s) concluído(s)`} />
            <Kpi icon="fa-truck-ramp-box" label="Mercadoria Colocada (Praça)" value={formatPreco(cur.mercadoriaColocada)} change={null} hint="Total bruto consignado" />
            <Kpi icon="fa-percent" label="Taxa de Efetivação / Giro" value={`${cur.taxaConversao.toFixed(1)}%`} change={null} hint={`${fmtNum(cur.totalItensVendidos)} peças vendidas`} />
            <Kpi icon="fa-clipboard-check" label="Pedidos Concluídos" value={fmtNum(cur.pedidosConcluidos)} change={null} hint={`De ${cur.n} pedidos no filtro`} />
          </div>
          <div className="ca-grid">
            <Card title="Faturamento Real por mês (Concluído)" icon="fa-chart-column">
              <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.faturamentoConcluido} color="#4f46e5" />
            </Card>
            <Card title="Mercadoria Colocada por mês (Praça)" icon="fa-truck-ramp-box">
              <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.mercadoriaColocada} color="#0ea5e9" />
            </Card>
          </div>
          <Card title="Vendas Concluídas vs Mercadoria Colocada por mês" icon="fa-table-list">
            <TabelaPaginada per={20} cols={[
              { key: 'mes', label: 'Mês', render: r => <strong>{monthLabel(r.mes)}</strong> },
              { key: 'nConcluidos', label: 'Concluídos', num: true, render: r => `${fmtNum(r.nConcluidos || 0)} / ${fmtNum(r.n)}` },
              { key: 'faturamentoConcluido', label: 'Faturamento Real (Concluído)', num: true, render: r => <strong style={{ color: '#059669' }}>{formatPreco(r.faturamentoConcluido)}</strong> },
              { key: 'mercadoriaColocada', label: 'Mercadoria Colocada (Praça)', num: true, render: r => formatPreco(r.mercadoriaColocada) },
              { key: 'taxaConversao', label: '% Efetivação (Giro)', num: true, render: r => <span className={`ca-margem-badge ${r.taxaConversao >= 50 ? 'ca-t-good' : 'ca-t-bad'}`}>{r.taxaConversao.toFixed(1)}%</span> },
              { key: 'desc', label: 'Descontos', num: true, render: r => formatPreco(r.desc) },
              { key: 'liq', label: 'Líquido Real', num: true, render: r => <strong>{formatPreco(r.liq)}</strong> },
            ]} rows={serie} />
          </Card>
        </>
      )
    }
    if (rep === 'itens_mes') {
      const totalItensVendidos = serie.reduce((s, r) => s + (r.itensVendidos || r.qtd || 0), 0)
      const mediaItensMes = serie.length ? Math.round(totalItensVendidos / serie.length) : 0
      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-cubes" label="Total itens vendidos" value={fmtNum(totalItensVendidos)} change={null} hint="Soma de todos os meses" />
            <Kpi icon="fa-chart-line" label="Média mensal" value={`${fmtNum(mediaItensMes)} un/mês`} change={null} hint="Média de giro" />
            <Kpi icon="fa-calendar-days" label="Meses computados" value={fmtNum(serie.length)} change={null} hint="Período selecionado" />
          </div>
          <Card title="Itens vendidos por mês" icon="fa-cubes">
            <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.itensVendidos || d.qtd} color="#059669" />
          </Card>
          <Card title="Histórico mensal de unidades vendidas" icon="fa-table-list">
            <TabelaPaginada per={20} cols={[
              { key: 'mes', label: 'Mês', render: r => <strong>{monthLabel(r.mes)}</strong> },
              { key: 'itensVendidos', label: 'Itens vendidos', num: true, render: r => <strong>{fmtNum(r.itensVendidos || r.qtd)} un</strong> },
              { key: 'itensColocados', label: 'Itens deixados (consignados)', num: true, render: r => `${fmtNum(r.itensColocados || r.qtd)} un` },
              { key: 'taxaConversao', label: 'Taxa de conversão', num: true, render: r => <span className="ca-margem-badge">{r.taxaConversao ? `${r.taxaConversao.toFixed(1)}%` : '-'}</span> },
              { key: 'pedidos', label: 'Pedidos concluídos', num: true, render: r => fmtNum(r.n) },
              { key: 'faturamento', label: 'Faturamento', num: true, render: r => formatPreco(r.bruto) },
            ]} rows={serie} />
          </Card>
        </>
      )
    }
    if (rep === 'conversao_giro') {
      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-truck-ramp-box" label="Itens deixados na praça" value={`${fmtNum(cur.totalItensColocados)} un`} change={null} hint="Consignado total distribuído" />
            <Kpi icon="fa-box-check" label="Itens vendidos efetivos" value={`${fmtNum(cur.totalItensVendidos)} un`} change={null} hint="Pós-acertos e quitações" />
            <Kpi icon="fa-percent" label="Taxa de conversão (% Vendido)" value={`${cur.taxaConversao.toFixed(1)}%`} change={null} hint="Vendidos / Deixados" />
            <Kpi icon="fa-rotate-left" label="Itens devolvidos / sobras" value={`${fmtNum(cur.totalItensDevolvidos)} un`} change={null} hint="Devoluções de consignação" />
          </div>

          <div className="ca-formula-banner success">
            <h4><i className="fa-solid fa-percent"></i> Relação: Total de Itens Deixados × % de Itens Vendidos</h4>
            <p>
              De um total de <strong>{fmtNum(cur.totalItensColocados)} itens deixados</strong> na praça no período, <strong>{fmtNum(cur.totalItensVendidos)} itens foram efetivamente vendidos</strong>, representando uma <strong>conversão (giro) de {cur.taxaConversao.toFixed(1)}%</strong>. Os <strong>{fmtNum(cur.totalItensDevolvidos)} itens restantes</strong> retornaram como sobra/devolução.
            </p>
          </div>

          <div className="ca-grid">
            <Card title="Itens Vendidos por mês" icon="fa-chart-column">
              <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.itensVendidos} color="#059669" />
            </Card>
            <Card title="Giro de Praça (% Conversão mensal)" icon="fa-percent">
              <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.taxaConversao} color="#4f46e5" />
            </Card>
          </div>

          <Card title="Histórico mensal: Itens deixados x % de itens vendidos" icon="fa-percent">
            <TabelaPaginada per={20} cols={[
              { key: 'mes', label: 'Mês', render: r => <strong>{monthLabel(r.mes)}</strong> },
              { key: 'itensColocados', label: 'Deixados (Praça)', num: true, render: r => `${fmtNum(r.itensColocados)} un` },
              { key: 'itensVendidos', label: 'Vendidos', num: true, render: r => <strong style={{ color: '#059669' }}>{fmtNum(r.itensVendidos)} un</strong> },
              { key: 'devolvidos', label: 'Devolvidos / Sobra', num: true, render: r => `${fmtNum(Math.max(0, (r.itensColocados || 0) - (r.itensVendidos || 0)))} un` },
              { key: 'taxaConversao', label: '% Vendido (Giro)', num: true, render: r => <span className={`ca-margem-badge ${r.taxaConversao >= 50 ? 'ca-t-good' : 'ca-t-bad'}`}>{r.taxaConversao.toFixed(1)}%</span> },
            ]} rows={serie} />
          </Card>
        </>
      )
    }
    if (rep === 'inadimplencia_calote') {
      const taxaInadimplenciaPecas = cur.totalItensColocados > 0 ? (cur.totalItensCalote / cur.totalItensColocados) * 100 : 0
      const taxaInadimplenciaVenda = cur.mercadoriaColocada > 0 ? (cur.caloteTotalVenda / cur.mercadoriaColocada) * 100 : 0
      const margemPerdida = Math.max(0, cur.caloteTotalVenda - cur.caloteTotalCusto)

      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-triangle-exclamation" label="Pessoas / Pedidos com Calote" value={`${fmtNum(cur.pedidosCalote)} pessoas`} change={null} hint={`Média de ${cur.mediaPecasPorCalote} itens / pessoa`} />
            <Kpi icon="fa-box-open" label="Peças perdidas (Calote)" value={`${fmtNum(cur.totalItensCalote)} un`} change={null} hint={`${taxaInadimplenciaPecas.toFixed(1)}% das ${fmtNum(cur.totalItensColocados)} peças deixadas`} />
            <Kpi icon="fa-hand-holding-dollar" label="Prejuízo real de mercadoria (Custo)" value={formatPreco(cur.caloteTotalCusto)} change={null} hint="Prejuízo direto tirado do bolso" />
            <Kpi icon="fa-file-invoice-dollar" label="Faturamento não recebido (Venda)" value={formatPreco(cur.caloteTotalVenda)} change={null} hint={`${taxaInadimplenciaVenda.toFixed(1)}% da praça colocada`} />
          </div>

          {/* PAINEL DIDÁTICO DAS 3 RELAÇÕES SOLICITADAS */}
          <div className="ca-formula-grid">
            <div className="ca-formula-banner danger">
              <h4><i className="fa-solid fa-boxes-stacked"></i> 1. Total Itens Deixados × Pessoas com Calote</h4>
              <p>
                <strong>{fmtNum(cur.pedidosCalote)} pessoas</strong> deram calote (média de <strong>{cur.mediaPecasPorCalote} itens</strong> por pessoa).
                Logo, calote em <strong>{fmtNum(cur.totalItensCalote)} itens</strong> perdidos. Comparado aos <strong>{fmtNum(cur.totalItensColocados)} itens deixados</strong> na praça, a taxa de <strong>inadimplência física de itens é de {taxaInadimplenciaPecas.toFixed(1)}%</strong>.
              </p>
            </div>

            <div className="ca-formula-banner warning">
              <h4><i className="fa-solid fa-file-invoice-dollar"></i> 2. Total de Calote em R$ (Faturamento)</h4>
              <p>
                De <strong>{formatPreco(cur.mercadoriaColocada)}</strong> em mercadorias colocadas na praça, <strong>{formatPreco(cur.caloteTotalVenda)}</strong> não foram recebidos por calote.
                Isso representa <strong>{taxaInadimplenciaVenda.toFixed(1)}% de perda sobre o faturamento potencial</strong>.
              </p>
            </div>

            <div className="ca-formula-banner">
              <h4><i className="fa-solid fa-hand-holding-dollar"></i> 3. Total de Calote em R$ (Custo Real vs Potencial)</h4>
              <p>
                Você tomou <strong>{formatPreco(cur.caloteTotalCusto)}</strong> de calote em <strong>custo de fábrica/reposição</strong> (custo direto saído do bolso), comparado com o faturamento que poderia ser de <strong>{formatPreco(cur.caloteTotalVenda)}</strong> (margem bruta de lucro que deixou de entrar: <strong>{formatPreco(margemPerdida)}</strong>).
              </p>
            </div>
          </div>

          {/* HISTÓRICO MENSAL DE INADIMPLÊNCIA E CALOTES */}
          <Card title="Histórico mensal de inadimplência e calotes" icon="fa-chart-column">
            <TabelaPaginada per={12} cols={[
              { key: 'mes', label: 'Mês', render: r => <strong>{monthLabel(r.mes)}</strong> },
              { key: 'pedidosCalote', label: 'Pessoas com Calote', num: true, render: r => `${fmtNum(r.pedidosCalote || 0)} pessoas` },
              { key: 'itensColocados', label: 'Peças Deixadas (Praça)', num: true, render: r => `${fmtNum(r.itensColocados || 0)} un` },
              { key: 'calotePecas', label: 'Peças Caloteadas', num: true, render: r => <strong style={{ color: '#dc2626' }}>{fmtNum(r.calotePecas || 0)} un</strong> },
              { key: 'taxaCalotePecas', label: '% Inadimplência (Peças)', num: true, render: r => <span className={`ca-margem-badge ${(r.taxaCalotePecas || 0) > 10 ? 'ca-t-bad' : 'ca-t-good'}`}>{(r.taxaCalotePecas || 0).toFixed(1)}%</span> },
              { key: 'caloteVenda', label: 'Venda Perdida (R$)', num: true, render: r => formatPreco(r.caloteVenda || 0) },
              { key: 'caloteCusto', label: 'Prejuízo Real Custo (R$)', num: true, render: r => <strong style={{ color: '#b91c1c' }}>{formatPreco(r.caloteCusto || 0)}</strong> },
            ]} rows={serie.filter(s => (s.calotePecas || 0) > 0 || (s.pedidosCalote || 0) > 0 || (s.itensColocados || 0) > 0)} />
          </Card>

          {/* TABELA DE PEDIDOS COM CALOTE REGISTRADO */}
          <Card title="Relação detalhada de pessoas e pedidos com Calote 100%" icon="fa-triangle-exclamation">
            <TabelaPaginada per={15} cols={[
              { key: 'pedido', label: 'Pedido' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'telefone', label: 'Telefone' },
              { key: 'cidade', label: 'Cidade' },
              { key: 'data', label: 'Data' },
              { key: 'pecas', label: 'Peças caloteadas', num: true, render: r => <strong style={{ color: '#dc2626' }}>{r.pecas} un</strong> },
              { key: 'custo', label: 'Prejuízo Real (Custo)', num: true, render: r => <strong style={{ color: '#b91c1c' }}>{formatPreco(r.custo)}</strong> },
              { key: 'venda', label: 'Venda perdida (Faturamento)', num: true, render: r => formatPreco(r.venda) },
            ]} rows={linhasCalote} />
          </Card>
        </>
      )
    }
    if (rep === 'atrasos') {
      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-clock-rotate-left" label="Total recebido em atraso" value={formatPreco(atrasosStats.totalValorAtraso)} change={null} hint="Quitações após vencimento" />
            <Kpi icon="fa-hourglass-end" label="Média de dias de atraso" value={`${atrasosStats.mediaDias} dias`} change={null} hint="Demora média para pagar" />
            <Kpi icon="fa-receipt" label="Pagamentos em atraso" value={`${fmtNum(atrasosStats.countPagosComAtraso)} títulos`} change={null} hint="Títulos quitados com atraso" />
            <Kpi icon="fa-triangle-exclamation" label="Vencidos pendentes hoje" value={formatPreco(atrasosStats.totalPendenteAtraso)} change={null} hint={`${atrasosStats.countPendenteAtraso} títulos aguardando`} />
          </div>

          <div className="ca-formula-banner warning">
            <h4><i className="fa-solid fa-clock"></i> Métrica de Recebimentos em Atraso</h4>
            <p>
              Você recebeu <strong>{formatPreco(atrasosStats.totalValorAtraso)}</strong> ({atrasosStats.countPagosComAtraso} quitações) que foram pagas após a data de vencimento original.
              Em média, quando o cliente atrasa, a demora é de <strong>{atrasosStats.mediaDias} dias após o vencimento</strong> para o dinheiro entrar.
            </p>
          </div>

          <Card title="Relação de recebimentos quitados com atraso" icon="fa-clock-rotate-left">
            <TabelaPaginada per={15} cols={[
              { key: 'cliente', label: 'Cliente' },
              { key: 'valor', label: 'Valor recebido', num: true, render: r => <strong style={{ color: '#059669' }}>{formatPreco(r.valor)}</strong> },
              { key: 'dueDate', label: 'Vencimento original' },
              { key: 'paidDate', label: 'Data do pagamento' },
              { key: 'diasAtraso', label: 'Dias de atraso', num: true, render: r => <span style={{ color: '#dc2626', fontWeight: 700 }}>+{r.diasAtraso} dias</span> },
              { key: 'metodo', label: 'Forma' },
            ]} rows={atrasosStats.linhasAtraso} />
          </Card>

          {atrasosStats.linhasPendentes.length > 0 && (
            <Card title="Títulos atualmente em atraso (Vencidos aguardando quitação)" icon="fa-triangle-exclamation">
              <TabelaPaginada per={15} cols={[
                { key: 'cliente', label: 'Cliente' },
                { key: 'valor', label: 'Valor em aberto', num: true, render: r => <strong style={{ color: '#b91c1c' }}>{formatPreco(r.valor)}</strong> },
                { key: 'dueDate', label: 'Venceu em' },
                { key: 'diasAtraso', label: 'Dias vencido hoje', num: true, render: r => <span style={{ color: '#dc2626', fontWeight: 700 }}>+{r.diasAtraso} dias</span> },
                { key: 'metodo', label: 'Forma prevista' },
              ]} rows={atrasosStats.linhasPendentes} />
            </Card>
          )}
        </>
      )
    }
    if (rep === 'motivos_recusa') {
      const counts = motivosDevolucaoStats.counts
      const totalDev = Object.values(counts).reduce((s, c) => s + c.qty, 0)
      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-boxes-stacked" label="Total peças devolvidas" value={`${fmtNum(totalDev)} un`} change={null} hint="Devoluções registradas" />
            <Kpi icon="fa-clipboard-question" label="Teria sido encomenda" value={`${fmtNum(counts.nao_encomendado?.qty || 0)} un`} change={null} hint={formatPreco(counts.nao_encomendado?.valor || 0)} />
            <Kpi icon="fa-arrows-split-up-and-left" label="Mau planejamento THSM" value={`${fmtNum(counts.mau_planejamento?.qty || 0)} un`} change={null} hint={formatPreco(counts.mau_planejamento?.valor || 0)} />
            <Kpi icon="fa-triangle-exclamation" label="Avaria / Defeito" value={`${fmtNum(counts.avaria?.qty || 0)} un`} change={null} hint={formatPreco(counts.avaria?.valor || 0)} />
          </div>
          <Card title="Motivos de devolução por produto" icon="fa-clipboard-question">
            <TabelaPaginada per={15} cols={[
              { key: 'nome', label: 'Produto' },
              { key: 'nao_encomendado', label: 'Teria sido encomenda', num: true, render: r => r.nao_encomendado > 0 ? <strong style={{ color: '#d97706' }}>{r.nao_encomendado} un</strong> : '-' },
              { key: 'mau_planejamento', label: 'Mau planejamento THSM', num: true, render: r => r.mau_planejamento > 0 ? <strong style={{ color: '#dc2626' }}>{r.mau_planejamento} un</strong> : '-' },
              { key: 'avaria', label: 'Avaria / Defeito', num: true, render: r => r.avaria > 0 ? `${r.avaria} un` : '-' },
              { key: 'total', label: 'Total devolvido', num: true, render: r => <strong>{r.total} un</strong> },
            ]} rows={motivosDevolucaoStats.porProduto} />
          </Card>
        </>
      )
    }
    if (rep === 'compras_sugestao') {
      const totalComprarQtd = comprasSugestao.reduce((s, c) => s + c.comprarQtd, 0)
      const custoTotalCompras = comprasSugestao.reduce((s, c) => s + c.custoTotal, 0)
      const itensComprarCount = comprasSugestao.filter(c => c.comprarQtd > 0).length
      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-cart-shopping" label="Peças a comprar" value={`${fmtNum(totalComprarQtd)} un`} change={null} hint="Necessidade imediata" />
            <Kpi icon="fa-sack-dollar" label="Investimento estimado" value={formatPreco(custoTotalCompras)} change={null} hint="Custo total de reposição" />
            <Kpi icon="fa-boxes-stacked" label="Produtos com reposição" value={fmtNum(itensComprarCount)} change={null} hint="Com estoque insuficiente" />
          </div>
          <Card title="Relatório e Sugestão de Compras (Demanda Real x Estoque)" icon="fa-cart-flatbed">
            <TabelaPaginada per={20} cols={[
              { key: 'produto', label: 'Produto' },
              { key: 'categoria', label: 'Categoria' },
              { key: 'demandado', label: 'Demandado (Pedidos)', num: true, render: r => `${fmtNum(r.demandado)} un` },
              { key: 'estoqueAtual', label: 'Estoque Atual', num: true, render: r => <strong style={{ color: r.estoqueAtual <= 0 ? '#dc2626' : '#334155' }}>{fmtNum(r.estoqueAtual)} un</strong> },
              { key: 'comprarQtd', label: 'Sugestão de Compra', num: true, render: r => r.comprarQtd > 0 ? <strong style={{ color: '#b91c1c', background: '#fee2e2', padding: '2px 8px', borderRadius: '4px' }}>+{r.comprarQtd} un</strong> : <span style={{ color: '#059669', fontSize: '0.8rem' }}>Suficiente</span> },
              { key: 'custoUnit', label: 'Custo Unitário', num: true, render: r => r.custoUnit > 0 ? formatPreco(r.custoUnit) : <span style={{ color: '#94a3b8' }}>-</span> },
              { key: 'custoTotal', label: 'Custo Total Compra', num: true, render: r => r.custoTotal > 0 ? <strong>{formatPreco(r.custoTotal)}</strong> : '-' },
              { key: 'status', label: 'Situação', render: r => r.status === 'critico' ? <span className="ca-status ca-status-cancelado">Esgotado</span> : r.status === 'comprar' ? <span className="ca-status ca-status-acerto">Comprar</span> : <span className="ca-status ca-status-entregue">Estoque OK</span> },
            ]} rows={comprasSugestao} />
          </Card>
        </>
      )
    }
    if (rep === 'custo' || rep === 'cmv') {
      const cmvKpis = {
        custoTotal: prodRank.reduce((s, p) => s + p.custo, 0),
        bruto: prodRank.reduce((s, p) => s + p.bruto, 0),
        qty: prodRank.reduce((s, p) => s + p.qty, 0),
      }
      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-boxes-packing" label="Custo total" value={formatPreco(cmvKpis.custoTotal)} change={null} hint="Gasto com mercadorias" />
            <Kpi icon="fa-sack-dollar" label="Valor bruto" value={formatPreco(cmvKpis.bruto)} change={null} hint="Soma das vendas" />
            <Kpi icon="fa-coins" label="Custo médio" value={cmvKpis.qty ? formatPreco(cmvKpis.custoTotal / cmvKpis.qty) : '-'} change={null} hint="Por unidade vendida" />
            <Kpi icon="fa-percent" label="Margem média" value={`${(cmvKpis.bruto ? ((cmvKpis.bruto - cmvKpis.custoTotal) / cmvKpis.bruto) * 100 : 0).toFixed(1)}%`} change={null} hint="Bruto - custo / bruto" />
          </div>
          <Card title={rep === 'cmv' ? 'Análise de custo (CMV) por produto' : 'Custo da mercadoria por item'} icon="fa-calculator">
            <TabelaPaginada per={15} cols={[
              { key: 'nome', label: 'Produto' },
              { key: 'qty', label: 'Qtd', num: true },
              { key: 'custo', label: 'Custo', num: true, render: r => formatPreco(r.custo) },
              { key: 'bruto', label: 'Bruto', num: true, render: r => formatPreco(r.bruto) },
              { key: 'lucro', label: 'Lucro', num: true, render: r => <span className={r.lucro >= 0 ? 'ca-t-good' : 'ca-t-bad'}>{formatPreco(r.lucro)}</span> },
              { key: 'margem', label: 'Margem', num: true, render: r => <span className="ca-margem-badge">{r.margem.toFixed(1)}%</span> },
            ]} rows={prodRank} />
          </Card>
        </>
      )
    }
    if (rep === 'lucro_mes') {
      return (
        <Card title="Lucro e margem por mês" icon="fa-chart-line">
          <TabelaPaginada per={20} cols={[
            { key: 'mes', label: 'Mês', render: r => <strong>{monthLabel(r.mes)}</strong> },
            { key: 'bruto', label: 'Faturamento', num: true, render: r => formatPreco(r.bruto) },
            { key: 'custo', label: 'Custo', num: true, render: r => formatPreco(r.custo) },
            { key: 'liq', label: 'Lucro bruto', num: true, render: r => <span className={r.lucro >= 0 ? 'ca-t-good' : 'ca-t-bad'}>{formatPreco(r.lucro)}</span> },
            { key: 'margem', label: 'Margem', num: true, render: r => <span className="ca-margem-badge">{r.margem.toFixed(1)}%</span> },
          ]} rows={serie} />
        </Card>
      )
    }
    if (rep === 'pagamentos') {
      return (
        <Card title="Formas de pagamento" icon="fa-credit-card">
          <Donut data={pagMetodo} center="Previsto" />
        </Card>
      )
    }
    if (rep === 'status') {
      return (
        <>
          <div className="ca-grid">
            <Card title="Distribuição por status" icon="fa-list-check">
              <Donut data={statusOrders.map(s => ({ label: reqStatus(s), value: s.qty }))} center="Pedidos" />
            </Card>
            <Card title="Resumo dos status no período" icon="fa-chart-pie">
              <div className="ca-kpis" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <Kpi icon="fa-truck-ramp-box" label="Mercadoria Colocada (Total)" value={formatPreco(cur.mercadoriaColocada)} change={null} hint="Soma de todos os pedidos" />
                <Kpi icon="fa-sack-dollar" label="Faturamento Concluído" value={formatPreco(cur.faturamentoConcluido)} change={null} hint={`${cur.pedidosConcluidos} pedido(s) concluído(s)`} />
              </div>
            </Card>
          </div>
          <Card title="Relação de pedidos por status" icon="fa-table-list">
            <TabelaPaginada per={15} cols={[
              { key: 'status', label: 'Status', render: r => <span className={`ca-status ca-status-${r.status || 'pendente'}`}>{reqStatus(r)}</span> },
              { key: 'qty', label: 'Quantidade de Pedidos', num: true, render: r => <strong>{fmtNum(r.qty)}</strong> },
              { key: 'valor', label: 'Mercadoria Colocada (Praça)', num: true, render: r => formatPreco(r.valor) },
              { key: 'faturado', label: 'Faturamento Concluído', num: true, render: r => r.faturado > 0 ? <strong style={{ color: '#059669' }}>{formatPreco(r.faturado)}</strong> : <span style={{ color: '#94a3b8' }}>-</span> },
            ]} rows={statusOrders} />
          </Card>
        </>
      )
    }
    if (rep === 'clientes') {
      return (
        <Card title="Análise de vendas por cliente" icon="fa-user-chart">
          <TabelaPaginada per={15} cols={[
            { key: 'nome', label: 'Cliente' },
            { key: 'pedidos', label: 'Pedidos', num: true },
            { key: 'itens', label: 'Itens', num: true },
            { key: 'bruto', label: 'Faturamento', num: true, render: r => formatPreco(r.bruto) },
            { key: 'ticket', label: 'Ticket médio', num: true, render: r => formatPreco(r.ticket) },
          ]} rows={cliRank} />
        </Card>
      )
    }
    if (rep === 'fin_cliente') {
      return (
        <Card title="Situação financeira por cliente" icon="fa-coins">
          <TabelaPaginada per={15} cols={[
            { key: 'nome', label: 'Cliente' },
            { key: 'aberto', label: 'Em aberto', num: true, render: r => formatPreco(r.aberto) },
            { key: 'pago', label: 'Pago', num: true, render: r => formatPreco(r.pago) },
            { key: 'vencido', label: 'Vencido', num: true, render: r => <span className={r.vencido ? 'ca-t-bad' : ''}>{formatPreco(r.vencido)}</span> },
          ]} rows={finCliPorCliente} />
        </Card>
      )
    }
    if (rep === 'caixa') {
      return (
        <Card title="Fluxo de caixa" icon="fa-money-bill-trend-up">
          <TabelaPaginada per={20} cols={[
            { key: 'mes', label: 'Mês', render: r => <strong>{monthLabel(r.mes)}</strong> },
            { key: 'receitas', label: 'Receitas', num: true, render: r => formatPreco(r.receitas) },
            { key: 'gastos', label: 'Despesas', num: true, render: r => formatPreco(r.gastos) },
            { key: 'resultado', label: 'Resultado', num: true, render: r => <span className={r.resultado >= 0 ? 'ca-t-good' : 'ca-t-bad'}>{formatPreco(r.resultado)}</span> },
          ]} rows={caixaSerie} />
        </Card>
      )
    }
    if (rep === 'despesas') {
      const totalDesp = despWin.reduce((s, d) => s + (d.value || 0), 0)
      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-receipt" label="Total de despesas" value={formatPreco(totalDesp)} change={null} hint="No período" />
            <Kpi icon="fa-file-invoice" label="Lançamentos" value={fmtNum(despWin.length)} change={null} hint="Despesas registradas" />
          </div>
          <Card title="Despesas por tipo" icon="fa-chart-pie">
            <TabelaPaginada per={15} cols={[
              { key: 'tipo', label: 'Tipo' },
              { key: 'qty', label: 'Qtd', num: true },
              { key: 'pendente', label: 'Pendente', num: true, render: r => formatPreco(r.pendente) },
              { key: 'pago', label: 'Pago', num: true, render: r => formatPreco(r.pago) },
              { key: 'total', label: 'Total', num: true, render: r => <strong>{formatPreco(r.total)}</strong> },
            ]} rows={despPorTipo} />
          </Card>
          <Card title="Lançamentos de despesas" icon="fa-list">
            <TabelaPaginada per={15} defaultSortKey="dueDate" defaultSortDir="desc" cols={[
              { key: 'dueDate', label: 'Data', num: false, render: r => (r.dueDate || r.paidDate || r.date) ? formatDate(r.dueDate || r.paidDate || r.date) : '-' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'descricao', label: 'Descrição', render: r => r.descricao || '-' },
              { key: 'value', label: 'Valor', num: true, render: r => formatPreco(r.value) },
              { key: 'status', label: 'Status', render: r => <span className={`ca-status ca-status-${r.status || 'pendente'}`}>{r.status || 'pendente'}</span> },
            ]} rows={despWin} />
          </Card>
        </>
      )
    }
    if (rep === 'impostos') {
      return (
        <Card title="Relatório de impostos" icon="fa-scale-balanced">
          <div className="ca-tbl-wrap">
            <table className="ca-tbl">
              <thead><tr><th>Base de cálculo</th><th className="ca-th-num">Valor bruto</th><th className="ca-th-num">Valor líquido</th><th className="ca-th-num">Desconto</th><th className="ca-th-num">Impostos est. (18%)</th></tr></thead>
              <tbody>
                <tr>
                  <td>Vendas no período</td>
                  <td className="ca-td-num">{formatPreco(dadosImpostos.bruto)}</td>
                  <td className="ca-td-num">{formatPreco(dadosImpostos.liq)}</td>
                  <td className="ca-td-num">{formatPreco(dadosImpostos.desc)}</td>
                  <td className="ca-td-num ca-t-bad">{formatPreco(dadosImpostos.imp)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )
    }
    if (rep === 'inativos') {
      return (
        <Card title="Clientes inativos" icon="fa-user-clock">
          <TabelaPaginada per={15} cols={[
            { key: 'nome', label: 'Cliente' },
            { key: 'tele', label: 'Telefone' },
            { key: 'ultima', label: 'Última venda', render: r => r.ultima ? <span className="ca-margem-badge">{formatDate(r.ultima)}</span> : <span className="ca-status ca-status-cancelado">Sem vendas</span> },
          ]} rows={inativos} />
        </Card>
      )
    }
    if (rep === 'relacao_clientes') {
      return (
        <Card title="Relação de clientes" icon="fa-users">
          <TabelaPaginada per={15} cols={[
            { key: 'nome', label: 'Cliente' },
            { key: 'tele', label: 'Telefone' },
            { key: 'cidade', label: 'Cidade' },
            { key: 'rota', label: 'Rota' },
            { key: 'pedidos', label: 'Pedidos', num: true },
            { key: 'ult', label: 'Último pedido', render: r => r.ult ? formatDate(r.ult) : <span className="ca-status ca-status-cancelado">Lead</span> },
          ]} rows={relacaoClientes} />
        </Card>
      )
    }
    if (rep === 'posicao') {
      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-boxes-stacked" label="Produtos" value={fmtNum(posicaoEstoque.length)} change={null} hint="Em estoque" />
            <Kpi icon="fa-sack-dollar" label="Valor à venda" value={formatPreco(posicaoEstoque.reduce((s, p) => s + p.vvenda, 0))} change={null} hint="Preço x estoque" />
            <Kpi icon="fa-hand-holding-dollar" label="Valor a custo" value={formatPreco(posicaoEstoque.reduce((s, p) => s + p.vcusto, 0))} change={null} hint="Custo x estoque" />
          </div>
          <Card title="Posição de estoque" icon="fa-boxes-stacked">
            <TabelaPaginada per={15} cols={[
              { key: 'produto', label: 'Produto' },
              { key: 'estoque', label: 'Estoque', num: true },
              { key: 'vvenda', label: 'Valor à venda', num: true, render: r => formatPreco(r.vvenda) },
              { key: 'vcusto', label: 'Valor a custo', num: true, render: r => formatPreco(r.vcusto) },
              { key: 'cmedio', label: 'Custo médio', num: true, render: r => formatPreco(r.cmedio) },
            ]} rows={posicaoEstoque} />
          </Card>
        </>
      )
    }
    if (rep === 'giro') {
      return (
        <Card title="Giro de estoque" icon="fa-rotate">
          <TabelaPaginada per={15} cols={[
            { key: 'produto', label: 'Produto' },
            { key: 'estoque', label: 'Estoque', num: true },
            { key: 'vendido', label: 'Vendido (período)', num: true },
            { key: 'giro', label: 'Giro', num: true, render: r => r.giro !== null ? <span className="ca-margem-badge">{r.giro.toFixed(2)}x</span> : '-' },
          ]} rows={giroEstoque} />
        </Card>
      )
    }
    return null
  }

  const renderRelatoriosPagina = () => (
    <>
      <div className="ca-rep-nav">
        {RELATORIOS.map(r => (
          <button key={r.id} className={`ca-rep-pill ${relatorio === r.id ? 'ca-rep-pill-on' : ''}`} onClick={() => setRelatorio(r.id)}>
            <i className={`fa-solid ${r.icon}`}></i>
            {r.label}
          </button>
        ))}
      </div>
      <div className="ca-content-inner">
        {renderRelatorios()}
      </div>
    </>
  )

  const curLabel = (PERIODOS.find(p => p.id === periodo) || {}).label || ''

  return (
    <div className="ca-shell">
      <div className="ca-topbar">
        <button className="ca-back" onClick={onBack}><i className="fa-solid fa-arrow-left"></i> Voltar</button>
        <div className="ca-title-block">
          <h1>Central de Análises</h1>
          <span className="ca-periodo-label">
            {periodo === 'custom' ? `${formatDate(cstStart)} – ${formatDate(cstEnd)}` : curLabel}
            {prevWin.start && ` · anterior: ${formatDate(prevWin.start)} a ${formatDate(prevWin.end)}`}
            {statusFilter !== 'todos' && ` · Filtro: ${STATUS_OPTIONS.find(s => s.id === statusFilter)?.label || statusFilter}`}
          </span>
        </div>
        <button className="ca-back ca-btn-print" onClick={() => window.print()} title="Imprimir Relatório de Análise" style={{ background: '#0284c7', color: '#fff' }}>
          <i className="fa-solid fa-print"></i> Imprimir / PDF
        </button>
        <div className="ca-status-filter-wrap" title="Filtrar pedidos por status">
          <i className="fa-solid fa-filter" style={{ color: '#64748b', fontSize: '11px' }}></i>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>Status:</span>
          <select
            className="ca-status-select"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="ca-periodos">
          {PERIODOS.map(p => (
            <button key={p.id} className={`ca-peri ${periodo === p.id ? 'ca-peri-on' : ''}`} onClick={() => setPeriodo(p.id)}>{p.label}</button>
          ))}
        </div>
        {periodo === 'custom' && (
          <div className="ca-custom">
            <input type="date" value={cstStart} onChange={e => setCstStart(e.target.value)} />
            <span>até</span>
            <input type="date" value={cstEnd} onChange={e => setCstEnd(e.target.value)} />
          </div>
        )}
      </div>
      <div className="ca-subnav">
        {SUBPAGES.map(s => (
          <button key={s.id} className={`ca-pill ${page === s.id ? 'ca-pill-on' : ''}`} onClick={() => setPage(s.id)}>
            <i className={`fa-solid ${s.icon}`}></i> {s.label}
          </button>
        ))}
      </div>
      <div className="ca-content">
        {page === 'geral' ? renderGeral()
          : page === 'vendas' ? renderVendas()
            : page === 'produtos' ? renderProdutos()
              : page === 'servicos' ? renderServicos()
                : page === 'financeiro' ? renderFinanceiro()
                  : page === 'clientes' ? renderClientes()
                    : page === 'performance' ? renderPerformance()
                      : page === 'relatorios' ? renderRelatoriosPagina()
                        : renderPerformance()}
      </div>
    </div>
  )
}