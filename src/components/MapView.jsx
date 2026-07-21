import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './MapView.css'

const GEO_CACHE_KEY = 'thsm_geo_cache'

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
  'almirante tamandaré': [-25.33, -49.31], 'sao jose dos pinhais': [-25.53, -49.21],
  'pindamonhangaba': [-22.92, -45.46], 'taubate': [-23.03, -45.56],
  'jacarei': [-23.31, -45.97], 'guaratingueta': [-22.82, -45.19],
  'aparecida': [-22.85, -45.23], 'cruzeiro': [-22.58, -44.96],
  'cachoeira paulista': [-22.68, -45.01], 'lorena': [-22.73, -45.12],
  'sao jose dos campos': [-23.22, -45.89], 'campinas': [-22.91, -47.06],
  'sao paulo': [-23.55, -46.63], 'ribeirao preto': [-21.17, -47.81],
  'uberlandia': [-18.92, -48.28], 'governador valadares': [-18.85, -41.95],
  'ipatinga': [-19.47, -42.55], 'coronel fabriciano': [-19.52, -42.62],
  'timoteo': [-19.58, -42.65], 'sete lagoas': [-19.46, -44.25],
  'divinopolis': [-20.15, -44.90], 'cons. lafaiete': [-20.66, -43.78],
  'ouro branco': [-20.52, -43.69], 'mariana': [-20.38, -43.42],
  'vicosa': [-20.75, -42.88], 'ponte nova': [-20.41, -42.91],
  'ubá': [-21.12, -42.94], 'rio pomba': [-21.27, -42.64],
  'sao joao del rei': [-21.14, -44.26], 'andrelândia': [-21.74, -44.31],
  'lima duarte': [-21.84, -43.80], 'bom jardim de minas': [-21.97, -44.19],
  'carandai': [-20.95, -43.81], 'rio espera': [-20.85, -43.48],
  'tres coracoes': [-21.70, -45.26], 'varginha': [-21.55, -45.43],
  'pouso alegre': [-22.23, -45.93], 'passos': [-20.72, -46.61],
  'poços de caldas': [-21.79, -46.57], 'almirante soares': [-22.88, -43.10],
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

function norm(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim()
}

function cityCoord(cidade, estado) {
  if (!cidade) return null
  const m = CIDADE[norm(cidade)]
  if (m) return m
  const uf = (estado || '').toLowerCase()
  return ESTADO[uf] || null
}

function hashId(id) {
  let h = 0
  for (let i = 0; i < (id+'').length; i++) { h = ((h << 5) - h) + (id+'').charCodeAt(i); h |= 0 }
  return Math.abs(h)
}

function jitter(seed) {
  return (hashId(seed) % 200 - 100) / 10000
}

function hasAddr(e) { return !!(e?.rua && e?.cidade) }
function fullAddr(e) { return [e.rua, e.numero, e.bairro, e.cidade, e.estado].filter(Boolean).join(', ') }
function fmt(v) { return `R$ ${Number(v).toFixed(2).replace('.', ',')}` }
function fmtDate(d) { if (!d) return '—'; return new Date(d + (d.length <= 10 ? 'T12:00:00' : '')).toLocaleDateString('pt-BR') }

function makeIcon(color, size, pulse) {
  const s = size || 26
  const shadow = pulse ? 'box-shadow:0 0 0 4px rgba(37,99,235,0.2),0 2px 8px rgba(0,0,0,0.3)' : 'box-shadow:0 2px 6px rgba(0,0,0,0.25)'
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:${s}px;height:${s}px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:${Math.round(s*0.42)}px;border:2px solid white;${shadow};cursor:pointer"><i class="fa-solid fa-user"></i></div>`,
    iconSize: [s, s],
    iconAnchor: [s/2, s/2],
    popupAnchor: [0, -(s/2+4)]
  })
}

const ROTA_CORES = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#8b5cf6', '#ec4899']

export default function MapView({ usuarios, orders }) {
  const mapRef = useRef(null)
  const map = useRef(null)
  const mkLayer = useRef(null)
  const rtLayer = useRef(null)
  const [items, setItems] = useState([])
  const [sel, setSel] = useState(new Set())
  const [rotas, setRotas] = useState([])
  const [calc, setCalc] = useState(false)
  const [geoStatus, setGeoStatus] = useState('')

  const users = useMemo(() => usuarios.filter(u => hasAddr(u.endereco || {})), [usuarios])

  useEffect(() => {
    if (map.current) return
    const m = L.map(mapRef.current, { zoomControl: false }).setView([-21.5, -44.5], 7)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m)
    L.control.zoom({ position: 'topright' }).addTo(m)
    const mg = L.layerGroup().addTo(m)
    const rg = L.layerGroup().addTo(m)
    mkLayer.current = mg
    rtLayer.current = rg
    map.current = m
    return () => { m.remove(); map.current = null }
  }, [])

  const buildPopup = useCallback((user) => {
    const nome = user.nome || user.pushName || '—'
    const addr = fullAddr(user.endereco || {})
    const telefone = user.telefone || '—'
    const userOrders = (orders || []).filter(o => o.customer?.telefone === user.telefone || o.user_id === user.id)
    const totalPedidos = userOrders.length
    const totalGasto = userOrders.reduce((s, o) => s + o.total, 0)
    const pendentes = userOrders.filter(o => !['entregue', 'cancelado'].includes(o.status)).length
    const ultimo = userOrders.length > 0 ? userOrders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] : null

    let html = `<div style="font-size:13px;line-height:1.6;min-width:220px;max-width:300px">`
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px"><b style="font-size:14px">${nome}</b></div>`
    html += `<span style="color:#666">${telefone}</span><br/>`
    html += `<span style="color:#888;font-size:12px">${addr}</span>`
    html += `<hr style="margin:6px 0;border:none;border-top:1px solid #e5e7eb"/>`
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;font-size:12px">`
    html += `<span style="color:#6b7280">Pedidos:</span><span style="font-weight:500">${totalPedidos}</span>`
    html += `<span style="color:#6b7280">Total:</span><span style="font-weight:500">${fmt(totalGasto)}</span>`
    html += `<span style="color:#6b7280">Pendentes:</span><span style="font-weight:500;color:#d97706">${pendentes}</span>`
    html += `<span style="color:#6b7280">Último:</span><span style="font-weight:500">${ultimo ? fmtDate(ultimo.date || ultimo.createdAt) : '—'}</span>`
    html += `</div>`
    html += `</div>`
    return html
  }, [orders])

  const updateMarkers = useCallback((newItems, selected) => {
    if (!map.current) return
    const g = mkLayer.current
    g.clearLayers()
    const bounds = L.latLngBounds()
    let has = false

    for (const item of newItems) {
      if (!item.coords) continue
      const isSel = selected.has(item.id)
      const refined = item.refined
      const color = isSel ? '#dc2626' : refined ? '#2563eb' : '#8b5cf6'
      const size = isSel ? 30 : refined ? 26 : 22
      const mk = L.marker(item.coords, { icon: makeIcon(color, size, refined) })
      const user = item.user

      mk.bindPopup(buildPopup(user))

      mk.on('click', () => {
        map.current.setView(item.coords, 15)
        setSel(prev => {
          const n = new Set(prev)
          n.has(item.id) ? n.delete(item.id) : n.add(item.id)
          return n
        })
      })
      g.addLayer(mk)
      bounds.extend(item.coords)
      has = true
    }
    if (has) map.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 })
  }, [buildPopup])

  useEffect(() => { updateMarkers(items, sel) }, [items, sel, updateMarkers])

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

  const process = useCallback(async () => {
    if (!users.length) return
    const cache = getGeoCache()
    const result = []
    const toRefine = []

    for (const u of users) {
      const id = u.telefone || u.id
      const addr = fullAddr(u.endereco || {})
      const cacheKey = addr.toLowerCase()
      const cached = cache[cacheKey]

      if (cached) {
        result.push({ id, user: u, coords: [cached.lat, cached.lng], refined: true })
        continue
      }

      const cc = cityCoord(u.endereco.cidade, u.endereco.estado)
      if (cc) {
        const jx = jitter(id)
        const jy = jitter(id + 1)
        result.push({ id, user: u, coords: [cc[0] + jx, cc[1] + jy], refined: false })
        toRefine.push(u)
      } else {
        result.push({ id, user: u, coords: null, refined: false })
      }
    }

    setItems(result)
    setGeoStatus(toRefine.length > 0 ? `Refinando ${toRefine.length} endereços...` : '')

    if (toRefine.length === 0) return

    let idx = 0
    for (const u of toRefine) {
      const id = u.telefone || u.id
      const addr = fullAddr(u.endereco || {})
      const cacheKey = addr.toLowerCase()

      try {
        await new Promise(r => setTimeout(r, 1200))
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`
        const res = await fetch(url, { headers: { 'User-Agent': 'THSM-Distribuidora/1.0' } })
        const data = await res.json()
        if (data && data.length > 0) {
          const lat = parseFloat(data[0].lat)
          const lng = parseFloat(data[0].lon)
          const cache = getGeoCache()
          cache[cacheKey] = { lat, lng }
          setGeoCache(cache)

          setItems(prev => {
            const next = [...prev]
            const i = next.findIndex(p => p.id === id)
            if (i >= 0) { next[i] = { ...next[i], coords: [lat, lng], refined: true } }
            return next
          })
        }
      } catch {}
      idx++
      setGeoStatus(`Refinando ${idx}/${toRefine.length}...`)
    }
    setGeoStatus('')
  }, [users])

  useEffect(() => { process() }, [process])

  const sorted = useMemo(() => {
    const w = items.filter(i => i.coords)
    const wo = items.filter(i => !i.coords)
    return [...w, ...wo]
  }, [items])

  const tracar = useCallback(async () => {
    const selPts = items.filter(p => sel.has(p.id) && p.coords)
    if (selPts.length < 2) return
    setCalc(true)
    try {
      const str = selPts.map(p => `${p.coords[1]},${p.coords[0]}`).join(';')
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${str}?overview=full&geometries=geojson`)
      const d = await r.json()
      if (d.code === 'Ok' && d.routes?.length > 0) setRotas(d.routes.map(r => r.geometry.coordinates.map(c => [c[1], c[0]])))
    } catch {}
    setCalc(false)
  }, [items, sel])

  const toggle = (id) => setSel(prev => {
    const n = new Set(prev)
    n.has(id) ? n.delete(id) : n.add(id)
    return n
  })

  return (
    <div className="mv">
      <div className="mv-top">
        <div>
          <div className="mv-tit"><i className="fa-solid fa-map"></i> Mapa</div>
          <div className="mv-sub">
            {users.length} usuários · {items.filter(i => i.coords).length} no mapa
            {geoStatus && <span style={{color:'#d97706',marginLeft:'8px'}}><i className="fa-solid fa-spinner fa-spin"></i> {geoStatus}</span>}
          </div>
        </div>
        <div className="mv-actions">
          {sel.size >= 2 && (
            <button className="mbtn mbtn-red" disabled={calc} onClick={tracar}>
              <i className={`fa-solid ${calc ? 'fa-spinner fa-spin' : 'fa-route'}`}></i> Rota ({sel.size})
            </button>
          )}
          {sel.size > 0 && (
            <button className="mbtn mbtn-sec" onClick={() => { setSel(new Set()); setRotas([]) }}>
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
                <div className="mv-av" style={{ background: isSel ? '#dc2626' : p.refined ? '#2563eb' : '#8b5cf6' }}>
                  <i className="fa-solid fa-user"></i>
                </div>
                <div className="mv-if">
                  <b>{p.user.nome || p.user.pushName || '—'}</b>
                  <span>{fullAddr(p.user.endereco || {})}</span>
                </div>
                {!p.refined && <span style={{fontSize:'0.65rem',color:'#8b5cf6',background:'#f5f3ff',padding:'2px 6px',borderRadius:'4px',flexShrink:0}}>Cidade</span>}
              </div>
            )
          })}
          {items.filter(i => i.coords).length === 0 && <div className="mv-e">Nenhum usuário com endereço</div>}
        </div>
      </div>
    </div>
  )
}

function getGeoCache() {
  try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}') } catch { return {} }
}

function setGeoCache(cache) {
  localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache))
}
