import { useState, useMemo } from 'react'
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

const STATUS_LABELS = {
  'pre-pedido': 'Pré-Pedido',
  'pendente': 'Pendente',
  'confirmado': 'Confirmado',
  'em-andamento': 'Em Andamento',
  'em-rota': 'Em Rota',
  'entregue': 'Concluído',
  'cancelado': 'Cancelado',
}

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

function TabelaPaginada({ cols, rows, per = 12, startPage = 1 }) {
  const [page, setPage] = useState(startPage)
  const total = rows.length
  const pages = Math.max(1, Math.ceil(total / per))
  const cur = Math.min(page, pages)
  const slice = rows.slice((cur - 1) * per, cur * per)
  return (
    <div>
      <div className="ca-tbl-wrap">
        <table className="ca-tbl">
          <thead>
            <tr>{cols.map((c, i) => <th key={i} className={c.num ? 'ca-th-num' : ''}>{c.label}</th>)}</tr>
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

  const ordersWin = useMemo(() => orders.filter(o => o.status !== 'cancelado' && fit(o.date || '', win)), [orders, win])
  const ordersPrev = useMemo(() => orders.filter(o => o.status !== 'cancelado' && fit(o.date || '', prevWin)), [orders, prevWin])
  const finWin = useMemo(() => financial.filter(f => f.status !== 'cancelado' && fit(f.dueDate || '', win)), [financial, win])
  const finPrev = useMemo(() => financial.filter(f => f.status !== 'cancelado' && fit(f.dueDate || '', prevWin)), [financial, prevWin])
  const despWin = useMemo(() => despesas.filter(d => fit(d.dueDate || '', win)), [despesas, win])

  const agg = (list) => {
    let bruto = 0, desc = 0, qty = 0, custo = 0, n = 0
    list.forEach(o => {
      bruto += o.total || 0
      desc += o.desconto || 0
      n += 1
      ;(o.items || []).forEach(i => {
        qty += Number(i.qty) || 0
        custo += (Number(i.preco_custo) || Number(i.custo) || 0) * (Number(i.qty) || 0)
      })
    })
    const liq = Math.max(0, bruto - desc)
    return { bruto, liq, desc, custo, qty, n, ticket: n ? liq / n : 0, lucro: liq - custo, margem: bruto ? ((liq - custo) / bruto) * 100 : 0 }
  }

  const cur = useMemo(() => agg(ordersWin), [ordersWin])
  const prev = useMemo(() => agg(ordersPrev), [ordersPrev])

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
      if (!map[k]) map[k] = { mes: k, bruto: 0, liq: 0, custo: 0, n: 0, desc: 0, frete: 0, qtd: 0 }
      map[k].bruto += o.total || 0
      map[k].desc += o.desconto || 0
      map[k].frete += o.frete || 0
      map[k].n += 1
      ;(o.items || []).forEach(i => {
        map[k].custo += (Number(i.preco_custo) || Number(i.custo) || 0) * (Number(i.qty) || 0)
        map[k].qtd += Number(i.qty) || 0
      })
    })
    return Object.values(map).sort((a, b) => a.mes.localeCompare(b.mes)).map(m => {
      const liq = Math.max(0, m.bruto - m.desc)
      return { ...m, liq, lucro: liq - m.custo, margem: m.bruto ? ((liq - m.custo) / m.bruto) * 100 : 0 }
    })
  }, [ordersWin])

  const prodRank = useMemo(() => {
    const map = {}
    ordersWin.forEach(o => {
      ;(o.items || []).forEach(i => {
        const name = i.displayName || i.nome || i.produto || 'Produto'
        if (!map[name]) map[name] = { nome: name, qty: 0, bruto: 0, custo: 0 }
        map[name].qty += Number(i.qty) || 0
        map[name].bruto += (Number(i.preco) || 0) * (Number(i.qty) || 0)
        map[name].custo += (Number(i.preco_custo) || Number(i.custo) || 0) * (Number(i.qty) || 0)
      })
    })
    return Object.values(map).map(p => ({ ...p, lucro: p.bruto - p.custo, margem: p.bruto ? ((p.bruto - p.custo) / p.bruto) * 100 : 0 })).sort((a, b) => b.bruto - a.bruto)
  }, [ordersWin])

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
      const k = (d.dueDate || '').slice(0, 7)
      if (!k) return
      if (!map[k]) map[k] = { mes: k, receitas: 0, gastos: 0 }
      map[k].gastos += d.value || 0
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
        <Kpi icon="fa-sack-dollar" label="Faturamento" value={formatPreco(cur.bruto)} change={delta(cur.bruto, prev.bruto)} hint={`${cur.n} pedido(s) no período`} />
        <Kpi icon="fa-receipt" label="Ticket médio" value={formatPreco(cur.ticket)} change={delta(cur.ticket, prev.ticket)} hint="Valor médio por pedido" />
        <Kpi icon="fa-cart-shopping" label="Pedidos" value={fmtNum(cur.n)} change={delta(cur.n, prev.n)} hint="Total no período" />
        <Kpi icon="fa-arrow-trend-up" label="Margem média" value={`${cur.margem.toFixed(1)}%`} change={delta(cur.lucro, prev.lucro)} hint="Lucro / bruto" />
      </div>
      <div className="ca-grid">
        <Card title="Faturamento por mês" icon="fa-chart-column">
          <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.bruto} color="#4f46e5" />
        </Card>
        <Card title="Formas de pagamento" icon="fa-wallet">
          <Donut data={pagMetodo} center="Previsto" />
        </Card>
      </div>
      <div className="ca-grid">
        <Card title="Despesas do período" icon="fa-money-bill-wave">
          <div className="ca-desp">
            <span className="ca-desp-val">{formatPreco(despTotal)}</span>
            <span className="ca-desp-pct">{cur.bruto ? `equivalem a ${((despTotal / cur.bruto) * 100).toFixed(1)}% do faturamento` : 'sem faturamento no período'}</span>
          </div>
        </Card>
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
        <Kpi icon="fa-sack-dollar" label="Faturamento" value={formatPreco(cur.liq)} change={delta(cur.liq, prev.liq)} hint={`${formatPreco(cur.desc)} em descontos`} />
        <Kpi icon="fa-boxes-stacked" label="Itens vendidos" value={fmtNum(cur.qty)} change={delta(cur.qty, prev.qty)} hint="Total de unidades" />
        <Kpi icon="fa-money-bill-trend-up" label="Lucro bruto" value={formatPreco(cur.lucro)} change={delta(cur.lucro, prev.lucro)} hint="Líquido menos custo" />
        <Kpi icon="fa-file-invoice" label="Desconto médio" value={`${cur.bruto ? ((cur.desc / cur.bruto) * 100).toFixed(1) : '0'}%`} change={null} hint="Sobre o bruto" />
      </div>
      <div className="ca-grid">
        <Card title="Ticket médio por mês" icon="fa-chart-line">
          <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.ticket} color="#10b981" />
        </Card>
        <Card title="Pedidos por mês" icon="fa-chart-column">
          <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.n} color="#0ea5e9" />
        </Card>
      </div>
      <Card title="Últimos pedidos" icon="fa-list">
        <div className="ca-tbl-wrap">
          <table className="ca-tbl">
            <thead><tr><th>Data</th><th>Cliente</th><th className="ca-th-num">Itens</th><th className="ca-th-num">Total</th><th>Status</th></tr></thead>
            <tbody>
              {[...ordersWin].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 15).map((o, i) => (
                <tr key={i}>
                  <td>{formatDate(o.date)}</td>
                  <td>{o.customer?.nome || '-'}</td>
                  <td className="ca-td-num">{fmtNum((o.items || []).reduce((s, x) => s + (Number(x.qty) || 0), 0))}</td>
                  <td className="ca-td-num"><strong>{formatPreco(o.total)}</strong></td>
                  <td><span className={`ca-status ca-status-${o.status || 'pendente'}`}>{o.status || 'pendente'}</span></td>
                </tr>
              ))}
              {ordersWin.length === 0 && <tr><td colSpan="5" className="ca-empty-cell">Nenhum pedido no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )

  const renderProdutos = () => {
    const top = prodRank.slice(0, 10)
    const bestMargem = prodRank.filter(p => p.bruto > 0).sort((a, b) => b.margem - a.margem).slice(0, 10)
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
          <Card title="Melhor margem" icon="fa-gauge-high">
            <HBar data={bestMargem} getLabel={p => p.nome} getValue={p => p.margem} fmt={v => `${v.toFixed(1)}%`} maxVal={Math.max(1, ...bestMargem.map(p => p.margem))} />
          </Card>
          <Card title="Ranking completo" icon="fa-table-list">
            <TabelaPaginada per={15} cols={[
              { key: 'nome', label: 'Produto' },
              { key: 'qty', label: 'Qtd', num: true },
              { key: 'bruto', label: 'Faturamento', num: true, render: r => formatPreco(r.bruto) },
              { key: 'margem', label: 'Margem', num: true, render: r => <span className="ca-margem-badge">{r.margem.toFixed(1)}%</span> },
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
    const lucro = cur.liq - cur.custo
    const margem = cur.liq ? (lucro / cur.liq) * 100 : 0
    const perfMargem = prodRank.filter(p => p.bruto > 0).sort((a, b) => b.margem - a.margem).slice(0, 8)
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
            { key: 'nome', label: 'Produto' },
            { key: 'vend', label: 'Vendidos', num: true },
            { key: 'estoque', label: 'Estoque', num: true },
            { key: 'cober', label: 'Cobertura', num: true, render: r => r.vend ? `${r.cober.toFixed(1)}x` : '-' },
          ]} rows={giroEstoque} />
        </Card>
      </>
    )
  }

  const RELATORIOS = [
    { id: 'vendas', label: 'Relação detalhada das vendas', icon: 'fa-file-invoice-dollar' },
    { id: 'produtos_vendidos', label: 'Produtos vendidos', icon: 'fa-box-open' },
    { id: 'vendas_mes', label: 'Vendas por período', icon: 'fa-chart-column' },
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
      const bruto = o.total || 0
      const desc = o.desconto || 0
      const qtd = (o.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0)
      return {
        _k: o.id,
        pedido: `#${String(o.id).slice(-6)}`,
        cliente: o.customer?.nome || '-',
        data: formatDate(o.date),
        itens: qtd,
        bruto,
        desc,
        liq: Math.max(0, bruto - desc),
        frete: o.frete || 0,
        pag: o.pagamento === 'avista' ? 'À Vista' : o.pagamento === 'aprazo' ? 'A Prazo' : 'Misto',
        status: o.status,
      }
    }).sort((a, b) => (b.data || '').localeCompare(a.data || ''))
  }, [ordersWin])

  const linhasProduto = useMemo(() => {
    const out = []
    ordersWin.forEach(o => {
      ;(o.items || []).forEach(i => {
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
      if (!map[s]) map[s] = { _k: s, status: s, qty: 0, valor: 0 }
      map[s].qty += 1
      map[s].valor += o.total || 0
    })
    return Object.values(map).sort((a, b) => b.qty - a.qty)
  }, [ordersWin])

  const despPorTipo = useMemo(() => {
    const map = {}
    despWin.forEach(d => {
      const t = d.tipo || 'Outros'
      if (!map[t]) map[t] = { _k: t, tipo: t, pago: 0, pendente: 0, total: 0, qty: 0 }
      map[t].total += d.value || 0
      map[t].qty += 1
      if (d.status === 'pago') map[t].pago += d.value || 0
      else map[t].pendente += d.value || 0
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

  const renderRelatorios = () => {
    const rep = relatorio
    if (rep === 'vendas') {
      return (
        <>
          <div className="ca-kpis">
            <Kpi icon="fa-sack-dollar" label="Valor bruto" value={formatPreco(linhasVenda.reduce((s, r) => s + r.bruto, 0))} change={null} hint="Pedidos no período" />
            <Kpi icon="fa-tags" label="Descontos" value={formatPreco(linhasVenda.reduce((s, r) => s + r.desc, 0))} change={null} hint="Total aplicado" />
            <Kpi icon="fa-hand-holding-dollar" label="Valor líquido" value={formatPreco(linhasVenda.reduce((s, r) => s + r.liq, 0))} change={null} hint="Bruto - desconto" />
            <Kpi icon="fa-clipboard-list" label="Pedidos" value={fmtNum(linhasVenda.length)} change={null} hint="No período" />
          </div>
          <Card title="Relação detalhada das vendas" icon="fa-file-invoice-dollar">
            <TabelaPaginada per={15} cols={[
              { key: 'pedido', label: 'Pedido' },
              { key: 'cliente', label: 'Cliente' },
              { key: 'data', label: 'Data' },
              { key: 'itens', label: 'Itens', num: true },
              { key: 'bruto', label: 'Bruto', num: true, render: r => formatPreco(r.bruto) },
              { key: 'desc', label: 'Desc.', num: true, render: r => r.desc ? formatPreco(r.desc) : '-' },
              { key: 'liq', label: 'Líquido', num: true, render: r => <strong>{formatPreco(r.liq)}</strong> },
              { key: 'frete', label: 'Frete', num: true, render: r => r.frete ? formatPreco(r.frete) : '-' },
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
          <Card title="Vendas por período" icon="fa-chart-column">
            <BarChart data={serie} getLabel={d => monthLabel(d.mes)} getValue={d => d.bruto} color="#4f46e5" />
          </Card>
          <Card title="Vendas por período" icon="fa-table-list">
            <TabelaPaginada per={20} cols={[
              { key: 'mes', label: 'Mês', render: r => <strong>{monthLabel(r.mes)}</strong> },
              { key: 'n', label: 'Pedidos', num: true },
              { key: 'bruto', label: 'Bruto', num: true, render: r => formatPreco(r.bruto) },
              { key: 'desc', label: 'Desconto', num: true, render: r => formatPreco(r.desc) },
              { key: 'liq', label: 'Líquido', num: true, render: r => formatPreco(r.liq) },
              { key: 'qtd', label: 'Qtd itens', num: true },
            ]} rows={serie} />
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
        <Card title="Pedidos por status" icon="fa-list-check">
          <Donut data={statusOrders.map(s => ({ label: reqStatus(s), value: s.qty }))} center="Pedidos" />
        </Card>
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
            <TabelaPaginada per={15} cols={[
              { key: 'd', label: 'Data', num: false, render: r => r.dueDate ? formatDate(r.dueDate) : '-' },
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
          </span>
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