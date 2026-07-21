import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './MapView.css'

const CIDADE = {
  'belo horizonte': [-19.92, -43.94], 'sao paulo': [-23.55, -46.63], 'rio de janeiro': [-22.91, -43.20],
  'brasilia': [-15.78, -47.92], 'salvador': [-12.97, -38.50], 'fortaleza': [-3.73, -38.54],
  'recife': [-8.05, -34.88], 'porto alegre': [-30.03, -51.23], 'curitiba': [-25.43, -49.27],
  'manaus': [-3.12, -60.02], 'belem': [-1.47, -48.48], 'goiania': [-16.64, -49.29],
  'contagem': [-19.93, -44.05], 'barbacena': [-21.23, -43.77], 'ubá': [-21.12, -42.94],
  'leopoldina': [-21.53, -42.64], 'cataguases': [-21.38, -42.69], 'muriaé': [-21.13, -42.37],
  'juiz de fora': [-21.76, -43.35], 'niteroi': [-22.88, -43.10], 'vitoria': [-20.29, -40.30],
  'campos dos goytacazes': [-21.75, -41.33], 'macaé': [-22.37, -41.78],
  'nova friburgo': [-22.29, -42.53], 'petropolis': [-22.51, -43.18],
  'volta redonda': [-22.53, -44.10], 'barra mansa': [-22.55, -44.17],
  'resende': [-22.47, -44.45], 'visconde do rio branco': [-21.01, -42.84],
  'sao jose dos pinhais': [-25.53, -49.21], 'pindamonhangaba': [-22.92, -45.46],
  'taubate': [-23.03, -45.56], 'jacarei': [-23.31, -45.97], 'guaratingueta': [-22.82, -45.19],
  'aparecida': [-22.85, -45.23], 'cruzeiro': [-22.58, -44.96],
  'cachoeira paulista': [-22.68, -45.01], 'lorena': [-22.73, -45.12],
  'sao jose dos campos': [-23.22, -45.89], 'campinas': [-22.91, -47.06],
  'sao paulo': [-23.55, -46.63], 'ribeirao preto': [-21.17, -47.81],
  'uberlandia': [-18.92, -48.28], 'governador valadares': [-18.85, -41.95],
  'ipatinga': [-19.47, -42.55], 'sete lagoas': [-19.46, -44.25],
  'divinopolis': [-20.15, -44.90], 'vicosa': [-20.75, -42.88],
  'sao joao del rei': [-21.14, -44.26], 'andrelândia': [-21.74, -44.31],
  'lima duarte': [-21.84, -43.80], 'tres coracoes': [-21.70, -45.26],
  'varginha': [-21.55, -45.43], 'pouso alegre': [-22.23, -45.93],
  'passos': [-20.72, -46.61], 'poços de caldas': [-21.79, -46.57],
  'sao joao del-rei': [-21.14, -44.26], 'conselheiro lafaiete': [-20.66, -43.78],
}

const ESTADO = {
  'mg': [-19.92, -43.94], 'rj': [-22.91, -43.20], 'sp': [-23.55, -46.63],
  'es': [-20.29, -40.30], 'ba': [-12.96, -38.51], 'df': [-15.78, -47.92],
  'go': [-16.64, -49.29], 'pr': [-25.43, -49.27], 'sc': [-27.60, -48.55],
  'rs': [-30.03, -51.23], 'pe': [-8.05, -34.89], 'ce': [-3.73, -38.54],
  'ma': [-2.54, -44.28], 'pa': [-1.47, -48.49], 'am': [-3.07, -61.66],
  'ac': [-9.02, -70.81], 'al': [-9.57, -36.55], 'ap': [0.03, -51.05],
  'mt': [-15.61, -56.10], 'ms': [-20.46, -54.61], 'pb': [-7.12, -34.88],
  'pi': [-5.09, -42.80], 'rn': [-5.80, -35.21], 'ro': [-8.76, -63.90],
  'rr': [2.82, -60.67], 'se': [-10.91, -37.07], 'to': [-10.18, -48.33],
}

function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim() }
function cityCoord(cidade, estado) {
  if (!cidade) return null
  const m = CIDADE[norm(cidade)]
  if (m) return m
  const uf = (estado || '').toLowerCase()
  return ESTADO[uf] || null
}

function hashId(id) { let h = 0; for (let i = 0; i < (id+'').length; i++) { h = ((h << 5) - h) + (id+'').charCodeAt(i); h |= 0 } return Math.abs(h) }
function jitter(seed) { return (hashId(seed) % 200 - 100) / 10000 }
function hasAddr(e) { return !!(e?.rua && e?.cidade) }
function fullAddr(e) { return [e.rua, e.numero, e.bairro, e.cidade, e.estado].filter(Boolean).join(', ') }
function fmt(v) { return `R$ ${Number(v).toFixed(2).replace('.', ',')}` }
function fmtDate(d) { if (!d) return '—'; return new Date(d + (d.length <= 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR') }
function fmtKm(m) { return `${(m / 1000).toFixed(1)} km` }
function fmtTime(s) { const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60); return h > 0 ? `${h}h ${m}min` : `${m}min` }

function makeIcon(color, size) {
  const s = size || 26
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:${s}px;height:${s}px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:${Math.round(s*0.42)}px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25);cursor:pointer"><i class="fa-solid fa-user"></i></div>`,
    iconSize: [s, s],
    iconAnchor: [s/2, s/2],
    popupAnchor: [0, -(s/2+4)]
  })
}

const ROTA_CORES = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#8b5cf6', '#ec4899']

export default function MapView({ usuarios, orders, financial, onMarkOnWay, onViewUser }) {
  const mapRef = useRef(null)
  const map = useRef(null)
  const mkLayer = useRef(null)
  const rtLayer = useRef(null)
  const markersRef = useRef({})
  const initialFit = useRef(false)
  const [items, setItems] = useState([])
  const [sel, setSel] = useState(new Set())
  const [rotas, setRotas] = useState([])
  const [rotaMeta, setRotaMeta] = useState(null)
  const [calc, setCalc] = useState(false)

  const users = useMemo(() => usuarios.filter(u => hasAddr(u.endereco || {})), [usuarios])

  // Init map
  useEffect(() => {
    if (map.current) return
    const m = L.map(mapRef.current, { zoomControl: false }).setView([-21.5, -44.5], 7)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m)
    L.control.zoom({ position: 'topright' }).addTo(m)
    mkLayer.current = L.layerGroup().addTo(m)
    rtLayer.current = L.layerGroup().addTo(m)
    map.current = m
    return () => { m.remove(); map.current = null; markersRef.current = {} }
  }, [])

  // Build items once from users
  useEffect(() => {
    if (!users.length) { setItems([]); return }
    const result = []
    for (const u of users) {
      const id = u.telefone || u.id
      const cc = cityCoord(u.endereco.cidade, u.endereco.estado)
      if (cc) result.push({ id, user: u, coords: [cc[0] + jitter(id), cc[1] + jitter(id + 1)] })
      else result.push({ id, user: u, coords: null })
    }
    setItems(result)
    initialFit.current = false
  }, [users])

  const buildPopupHTML = useCallback((user) => {
    const nome = user.nome || user.pushName || '—'
    const addr = fullAddr(user.endereco || {})
    const tel = user.telefone || ''
    const uOrders = (orders || []).filter(o => o.customer?.telefone === user.telefone || o.user_id === user.id)
    const totalPed = uOrders.length
    const totalGasto = uOrders.reduce((s, o) => s + o.total, 0)
    const pendentes = uOrders.filter(o => !['entregue', 'cancelado'].includes(o.status)).length
    const ultimo = uOrders.length > 0 ? uOrders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] : null
    const ultimoData = ultimo ? fmtDate(ultimo.date || ultimo.createdAt) : '—'
    const finPend = (financial || []).filter(f => f.telefone === user.telefone || f.userId === user.id).filter(f => f.status === 'pendente')
    const saldoPend = finPend.reduce((s, f) => s + (f.value || f.valor || 0), 0)
    const email = user.email || ''

    return `<div class="mp">
  <div class="mp-h">
    <div class="mp-av">${nome.charAt(0).toUpperCase()}</div>
    <div class="mp-hi"><b>${nome}</b><span>${tel}${email ? ' · ' + email : ''}</span></div>
  </div>
  <div class="mp-s"><i class="fa-solid fa-location-dot"></i> ${addr}</div>
  <div class="mp-grid">
    <div><span>Pedidos</span><strong>${totalPed}</strong></div>
    <div><span>Total</span><strong>${fmt(totalGasto)}</strong></div>
    <div><span>Pendentes</span><strong class="c1">${pendentes}</strong></div>
    <div><span>Último</span><strong>${ultimoData}</strong></div>
    ${saldoPend > 0 ? `<div><span>Saldo Pend.</span><strong class="c2">${fmt(saldoPend)}</strong></div>` : ''}
  </div>
  <div class="mp-actions">
    <button class="mp-btn wa" data-action="whatsapp"><i class="fa-brands fa-whatsapp"></i> WhatsApp</button>
    <button class="mp-btn gm" data-action="gmap"><i class="fa-solid fa-location-dot"></i> Maps</button>
    ${pendentes > 0 ? `<button class="mp-btn rt" data-action="rota"><i class="fa-solid fa-truck"></i> A Caminho</button>` : ''}
    ${saldoPend > 0 ? `<button class="mp-btn fn" data-action="saldo"><i class="fa-solid fa-coins"></i> Saldo Pend.</button>` : ''}
    <button class="mp-btn vi" data-action="view"><i class="fa-solid fa-eye"></i> Ver Pedidos</button>
  </div>
</div>`
  }, [orders, financial])

  const bindPopupActions = useCallback((popupEl, user) => {
    if (!popupEl) return
    const tel = (user.telefone || '').replace(/\D/g, '')

    popupEl.querySelector('[data-action="whatsapp"]')?.addEventListener('click', (e) => {
      e.stopPropagation()
      if (tel) window.open(`https://wa.me/55${tel}?text=${encodeURIComponent('Olá, tudo bem? Sou da THSM Distribuidora.')}`, '_blank')
    })
    popupEl.querySelector('[data-action="gmap"]')?.addEventListener('click', (e) => {
      e.stopPropagation()
      window.open(`https://www.google.com/maps/search/${encodeURIComponent(fullAddr(user.endereco || {}))}`, '_blank')
    })
    popupEl.querySelector('[data-action="rota"]')?.addEventListener('click', (e) => {
      e.stopPropagation(); onMarkOnWay?.(user)
      const mk = markersRef.current[user.telefone || user.id]
      mk?.closePopup()
    })
    popupEl.querySelector('[data-action="saldo"]')?.addEventListener('click', (e) => {
      e.stopPropagation()
      const finPend = (financial || []).filter(f => f.telefone === user.telefone || f.userId === user.id).filter(f => f.status === 'pendente')
      const total = finPend.reduce((s, f) => s + (f.value || f.valor || 0), 0)
      const msg = finPend.map(f => `• ${f.itemName || f.descricao || 'Item'} - ${fmt(f.value || f.valor || 0)} (vence ${fmtDate(f.dueDate || f.vencimento)})`).join('\n')
      alert(`Saldo pendente de ${user.nome || user.pushName || '—'}: ${fmt(total)}\n\n${msg || 'Nenhum registro pendente'}`)
    })
    popupEl.querySelector('[data-action="view"]')?.addEventListener('click', (e) => {
      e.stopPropagation(); onViewUser?.(user)
      const mk = markersRef.current[user.telefone || user.id]
      mk?.closePopup()
    })
  }, [financial, onMarkOnWay, onViewUser])

  // Sync markers with items + selection
  useEffect(() => {
    if (!map.current) return
    const g = mkLayer.current
    const bounds = L.latLngBounds()
    let has = false
    const currentIds = new Set()

    for (const item of items) {
      if (!item.coords) continue
      const id = item.id
      currentIds.add(id)
      const isSel = sel.has(id)
      let mk = markersRef.current[id]

      if (!mk) {
        mk = L.marker(item.coords, { icon: makeIcon(isSel ? '#dc2626' : '#2563eb', isSel ? 30 : 26) })
        mk.bindPopup(buildPopupHTML(item.user))

        mk.on('popupopen', () => {
          const el = mk.getPopup()?.getElement()
          if (el) bindPopupActions(el, item.user)
        })

        mk.on('click', () => {
          map.current.setView(item.coords, 15)
          mk.openPopup()
          setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
        })

        g.addLayer(mk)
        markersRef.current[id] = mk
      } else {
        mk.setLatLng(item.coords)
        mk.setIcon(makeIcon(isSel ? '#dc2626' : '#2563eb', isSel ? 30 : 26))
      }

      bounds.extend(item.coords)
      has = true
    }

    // Remove stale markers
    for (const id of Object.keys(markersRef.current)) {
      if (!currentIds.has(id)) {
        g.removeLayer(markersRef.current[id])
        delete markersRef.current[id]
      }
    }

    if (has && !initialFit.current) {
      map.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 })
      initialFit.current = true
    }
  }, [items, sel, buildPopupHTML, bindPopupActions])

  // Routes layer
  useEffect(() => {
    if (!map.current) return
    const g = rtLayer.current
    g.clearLayers()
    rotas.forEach((coords, i) => {
      const c = ROTA_CORES[i % ROTA_CORES.length]
      L.polyline(coords, { color: c, weight: 4, opacity: 0.6 }).addTo(g)
      L.marker(coords[0], { icon: L.divIcon({ className: '', html: '<div style="background:#16a34a;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:9px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.2)"><i class="fa-solid fa-play"></i></div>', iconSize: [18,18], iconAnchor: [9,9] }) }).addTo(g)
      L.marker(coords[coords.length-1], { icon: L.divIcon({ className: '', html: '<div style="background:#dc2626;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:9px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.2)"><i class="fa-solid fa-flag-checkered"></i></div>', iconSize: [18,18], iconAnchor: [9,9] }) }).addTo(g)
    })
  }, [rotas])

  const tracar = useCallback(async () => {
    const selPts = items.filter(p => sel.has(p.id) && p.coords)
    if (selPts.length < 2) return
    setCalc(true); setRotaMeta(null)
    try {
      const str = selPts.map(p => `${p.coords[1]},${p.coords[0]}`).join(';')
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${str}?overview=full&geometries=geojson&alternatives=true`)
      const d = await r.json()
      if (d.code === 'Ok' && d.routes?.length > 0) {
        setRotas(d.routes.map(r => r.geometry.coordinates.map(c => [c[1], c[0]])))
        setRotaMeta(d.routes.map(r => ({ distancia: r.distance, duracao: r.duration })))
      }
    } catch {}
    setCalc(false)
  }, [items, sel])

  const sorted = useMemo(() => { const w = items.filter(i => i.coords); const wo = items.filter(i => !i.coords); return [...w, ...wo] }, [items])
  const toggle = (id) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const openGmapsRoute = () => {
    const selected = items.filter(p => sel.has(p.id) && p.coords)
    const addresses = selected.map(p => fullAddr(p.user.endereco || {}))
    if (addresses.length >= 2) window.open(`https://www.google.com/maps/dir/${addresses.map(a => encodeURIComponent(a)).join('/')}`, '_blank')
  }

  return (
    <div className="mv">
      <div className="mv-top">
        <div>
          <div className="mv-tit"><i className="fa-solid fa-map"></i> Mapa</div>
          <div className="mv-sub">{users.length} usuários · {items.filter(i => i.coords).length} no mapa · {sel.size} selecionados</div>
        </div>
        <div className="mv-actions">
          {rotaMeta && rotaMeta.map((r, i) => (
            <span key={i} className="mv-ri" style={{ color: ROTA_CORES[i % ROTA_CORES.length] }}>
              <i className="fa-solid fa-road"></i> {fmtKm(r.distancia)} · {fmtTime(r.duracao)}{i === 0 ? '' : ` (alt.${i})`}
            </span>
          ))}
          {sel.size >= 2 && (
            <>
              <button className="mbtn mbtn-gm" onClick={openGmapsRoute}><i className="fa-solid fa-location-dot"></i> Maps</button>
              <button className="mbtn mbtn-red" disabled={calc} onClick={tracar}>
                <i className={`fa-solid ${calc ? 'fa-spinner fa-spin' : 'fa-route'}`}></i> Rota ({sel.size})
              </button>
            </>
          )}
          {sel.size > 0 && (
            <button className="mbtn mbtn-sec" onClick={() => { setSel(new Set()); setRotas([]); setRotaMeta(null) }}>
              <i className="fa-solid fa-xmark"></i> Limpar
            </button>
          )}
        </div>
      </div>
      <div className="mv-map" ref={mapRef}></div>
      <div className="mv-list">
        <div className="mv-lh"><i className="fa-solid fa-list"></i> Usuários <span className="mv-lc">{sel.size} selecionados</span></div>
        <div className="mv-lb">
          {sorted.filter(i => i.coords).map(p => {
            const isSel = sel.has(p.id)
            return (
              <div key={p.id} className={`mv-i ${isSel ? 's' : ''}`} onClick={() => { map.current?.setView(p.coords, 15); toggle(p.id) }}>
                <div className="mv-av" style={{ background: isSel ? '#dc2626' : '#2563eb' }}><i className="fa-solid fa-user"></i></div>
                <div className="mv-if">
                  <b>{p.user.nome || p.user.pushName || '—'}</b>
                  <span>{fullAddr(p.user.endereco || {})}</span>
                </div>
              </div>
            )
          })}
          {items.filter(i => i.coords).length === 0 && <div className="mv-e">Nenhum usuário com endereço</div>}
        </div>
      </div>
    </div>
  )
}
