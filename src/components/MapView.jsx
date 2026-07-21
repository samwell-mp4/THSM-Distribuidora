import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import './MapView.css'

const GM_KEY = 'AIzaSyAfq_6M0nELuVLp3Vqz8RrFpyejRQbLJlE'

const CIDADE = {
  'belo horizonte': [-19.92, -43.94], 'contagem': [-19.93, -44.05], 'betim': [-19.97, -44.20],
  'ibirite': [-20.02, -44.06], 'nova lima': [-19.99, -43.85], 'santa luzia': [-19.77, -43.85],
  'sabara': [-19.89, -43.81], 'caete': [-19.88, -43.67], 'ribeirao das neves': [-19.77, -44.09],
  'esmeraldas': [-19.76, -44.31], 'lagoa santa': [-19.63, -43.89], 'pedro leopoldo': [-19.62, -44.04],
  'vespasiano': [-19.69, -43.92], 'matheus leme': [-19.55, -44.07],
  'araxa': [-19.59, -46.94], 'uberlandia': [-18.92, -48.28], 'uberaba': [-19.75, -47.94],
  'patos de minas': [-18.59, -46.52], 'patrocinio': [-18.94, -46.99],
  'araguari': [-18.65, -48.19], 'ituiutaba': [-18.97, -49.46],
  'governador valadares': [-18.85, -41.95], 'ipatinga': [-19.47, -42.55],
  'coronel fabriciano': [-19.52, -42.63], 'timoteo': [-19.58, -42.65],
  'vale do aco': [-19.52, -42.63],
  'juiz de fora': [-21.76, -43.35], 'ubá': [-21.12, -42.94], 'muriaé': [-21.13, -42.37],
  'leopoldina': [-21.53, -42.64], 'cataguases': [-21.38, -42.69], 'vicosa': [-20.75, -42.88],
  'barbacena': [-21.23, -43.77], 'sao joao del rei': [-21.14, -44.26],
  'sao joao del-rei': [-21.14, -44.26], 'andrelândia': [-21.74, -44.31],
  'lima duarte': [-21.84, -43.80], 'conselheiro lafaiete': [-20.66, -43.78],
  'divinopolis': [-20.15, -44.90], 'itabira': [-19.62, -43.23],
  'sete lagoas': [-19.46, -44.25], 'unaí': [-16.36, -46.90],
  'paracatu': [-17.22, -46.88], 'pirapora': [-17.35, -44.94],
  'montes claros': [-16.73, -43.87], 'januaria': [-15.49, -44.35],
  'januaba': [-15.80, -43.31],
  'pouso alegre': [-22.23, -45.93], 'passos': [-20.72, -46.61],
  'poços de caldas': [-21.79, -46.57], 'varginha': [-21.55, -45.43],
  'tres coracoes': [-21.70, -45.26], 'itajuba': [-22.43, -45.46],
  'alfenas': [-21.43, -45.95], 'machado': [-21.68, -45.92],
  'campo belo': [-20.90, -45.28], 'formiga': [-20.47, -45.43],
  'bom despacho': [-19.74, -45.26], 'luz': [-19.79, -45.69],
  'abelardo luz': [-19.79, -45.69],
  'sao paulo': [-23.55, -46.63], 'campinas': [-22.91, -47.06],
  'ribeirao preto': [-21.17, -47.81], 'sao jose dos campos': [-23.22, -45.89],
  'sorocaba': [-23.50, -47.46], 'santos': [-23.96, -46.33],
  'jundiai': [-23.19, -46.88], 'taubate': [-23.03, -45.56],
  'pindamonhangaba': [-22.92, -45.46], 'jacarei': [-23.31, -45.97],
  'guaratingueta': [-22.82, -45.19], 'aparecida': [-22.85, -45.23],
  'cruzeiro': [-22.58, -44.96], 'cachoeira paulista': [-22.68, -45.01],
  'lorena': [-22.73, -45.12], 'sao jose dos pinhais': [-25.53, -49.21],
  'rio de janeiro': [-22.91, -43.20], 'niteroi': [-22.88, -43.10],
  'campos dos goytacazes': [-21.75, -41.33], 'macaé': [-22.37, -41.78],
  'nova friburgo': [-22.29, -42.53], 'petropolis': [-22.51, -43.18],
  'volta redonda': [-22.53, -44.10], 'barra mansa': [-22.55, -44.17],
  'resende': [-22.47, -44.45], 'visconde do rio branco': [-21.01, -42.84],
  'vitoria': [-20.29, -40.30],
  'brasilia': [-15.78, -47.92],
  'salvador': [-12.97, -38.50], 'fortaleza': [-3.73, -38.54],
  'recife': [-8.05, -34.88], 'porto alegre': [-30.03, -51.23],
  'curitiba': [-25.43, -49.27], 'manaus': [-3.12, -60.02],
  'belem': [-1.47, -48.48], 'goiania': [-16.64, -49.29],
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
function queryAddr(e) { return [e.rua, e.numero, e.bairro, e.cidade, e.estado].filter(Boolean).join(', ') }
function queryBairro(e) { return [e.bairro, e.cidade, e.estado].filter(Boolean).join(', ') }
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

function makeIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="12" fill="${color}" stroke="#fff" stroke-width="2.5"/></svg>`
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new google.maps.Size(26, 26), anchor: new google.maps.Point(13, 13) }
}
function makeIconSel() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#dc2626" stroke="#fff" stroke-width="2.5"/></svg>`
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new google.maps.Size(32, 32), anchor: new google.maps.Point(16, 16) }
}

const ROTA_CORES = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#8b5cf6', '#ec4899']

export default function MapView({ usuarios, orders, financial, onMarkOnWay, onViewUser }) {
  const mapRef = useRef(null)
  const gMap = useRef(null)
  const infoWin = useRef(null)
  const dirRender = useRef(null)
  const markersRef = useRef({})
  const polyRef = useRef([])
  const initialFit = useRef(false)
  const gmReady = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [items, setItems] = useState([])
  const [sel, setSel] = useState(new Set())
  const [rotas, setRotas] = useState([])
  const [rotaMeta, setRotaMeta] = useState(null)
  const [calc, setCalc] = useState(false)
  const [filtroCidade, setFiltroCidade] = useState('TODAS')
  const [filtroEstado, setFiltroEstado] = useState('TODOS')
  const [filtroSearch, setFiltroSearch] = useState('')
  const [geoStatus, setGeoStatus] = useState(0)
  const [geoError, setGeoError] = useState(null)
  const csvInputRef = useRef(null)
  const [csvMsg, setCsvMsg] = useState(null)

  const users = useMemo(() => usuarios.filter(u => hasAddr(u.endereco || {})), [usuarios])

  const cidades = useMemo(() => {
    const s = new Set(users.map(u => u.endereco?.cidade).filter(Boolean))
    return ['TODAS', ...Array.from(s).sort()]
  }, [users])

  const estados = useMemo(() => {
    const s = new Set(users.map(u => (u.endereco?.estado || '').toUpperCase()).filter(Boolean))
    return ['TODOS', ...Array.from(s).sort()]
  }, [users])

  const filtered = useMemo(() => {
    let r = items
    if (filtroCidade !== 'TODAS') r = r.filter(i => (i.user.endereco?.cidade || '').toLowerCase() === filtroCidade.toLowerCase())
    if (filtroEstado !== 'TODOS') r = r.filter(i => (i.user.endereco?.estado || '').toUpperCase() === filtroEstado)
    if (filtroSearch) {
      const t = filtroSearch.toLowerCase()
      r = r.filter(i => (i.user.nome || i.user.pushName || '').toLowerCase().includes(t) || (i.user.telefone || '').includes(t))
    }
    return r
  }, [items, filtroCidade, filtroEstado, filtroSearch])

  // Load Google Maps API
  useEffect(() => {
    if (window.google?.maps) { gmReady.current = true; setLoaded(true); return }
    window.initMapView = () => { gmReady.current = true; setLoaded(true) }
    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GM_KEY}&callback=initMapView&libraries=maps`
    s.async = true; s.defer = true
    document.head.appendChild(s)
  }, [])

  // Init map
  useEffect(() => {
    if (!loaded || !mapRef.current || gMap.current) return
    const m = new google.maps.Map(mapRef.current, {
      center: { lat: -21.5, lng: -44.5 }, zoom: 7,
      mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
      styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }]
    })
    infoWin.current = new google.maps.InfoWindow()
    dirRender.current = new google.maps.DirectionsRenderer({ suppressMarkers: true, polylineOptions: { strokeWeight: 4, strokeOpacity: 0.6 } })
    gMap.current = m
    return () => { gMap.current = null; markersRef.current = {} }
  }, [loaded])

  // Build items from users + geocode (Google Maps Geocoding API)
  useEffect(() => {
    if (!users.length) { setItems([]); setGeoStatus(0); return }
    const raw = localStorage.getItem('thsm_geocode_cache') || '{}'
    let cache = JSON.parse(raw)
    if (cache._ver !== 2) {
      cache = { _ver: 2 }
      localStorage.setItem('thsm_geocode_cache', JSON.stringify(cache))
    }
    const r = []
    const toGeo = []
    for (const u of users) {
      const id = u.telefone || u.id
      const addrAi = queryAddr(u.endereco)
      if (cache[addrAi]) {
        r.push({ id, user: u, coords: cache[addrAi] })
      } else {
        const cc = cityCoord(u.endereco.cidade, u.endereco.estado)
        if (cc) r.push({ id, user: u, coords: [cc[0] + jitter(id), cc[1] + jitter(id + 1)], fallback: true })
        else r.push({ id, user: u, coords: null, fallback: true })
        toGeo.push({ id, user: u, addrAi })
      }
    }
    setItems(r)
    setGeoStatus(prev => prev || toGeo.length ? 1 : 0)
    initialFit.current = false
    if (!toGeo.length) return
    let done = 0
    const total = toGeo.length
    function geocodeOne(item) {
      const { id, addrAi } = item
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addrAi)}&key=${GM_KEY}&region=br&language=pt-BR`
      return fetch(url)
        .then(res => res.json())
        .then(data => {
          if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
            const loc = data.results[0].geometry.location
            const coords = [loc.lat, loc.lng]
            cache[addrAi] = coords
            localStorage.setItem('thsm_geocode_cache', JSON.stringify(cache))
            setItems(prev => prev.map(i => i.id === id ? { ...i, coords, fallback: false } : i))
          } else if (data.status === 'REQUEST_DENIED') {
            setGeoError('Geocoding API não ativada. Ative no console.cloud.google.com.')
            setTimeout(() => setGeoError(null), 10000)
          } else if (data.status === 'OVER_QUERY_LIMIT') {
            setGeoError('Limite de geocode excedido. Tente novamente mais tarde.')
            setTimeout(() => setGeoError(null), 10000)
          } else {
            console.warn('Geocode falhou para', addrAi, data.status)
          }
        })
        .catch(e => console.error('Geocode error for', addrAi, e))
        .finally(() => { done++; setGeoStatus(Math.round((done / total) * 100)) })
    }
    const PAR = 10
    let gIdx = 0
    function worker() { if (gIdx >= total) return; geocodeOne(toGeo[gIdx++]).finally(worker) }
    for (let i = 0; i < Math.min(PAR, total); i++) worker()
  }, [users])

  const buildPopup = useCallback((user) => {
    const nome = user.nome || user.pushName || '—'
    const addr = fullAddr(user.endereco || {})
    const tel = (user.telefone || '').replace(/\D/g, '')
    const email = user.email || ''
    const uOrders = (orders || []).filter(o => o.customer?.telefone === user.telefone || o.user_id === user.id)
    const totalPed = uOrders.length
    const totalGasto = uOrders.reduce((s, o) => s + o.total, 0)
    const pendentes = uOrders.filter(o => !['entregue', 'cancelado'].includes(o.status)).length
    const ultimo = uOrders.length > 0 ? uOrders.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] : null
    const ultimoData = ultimo ? fmtDate(ultimo.date || ultimo.createdAt) : '—'
    const finPend = (financial || []).filter(f => f.telefone === user.telefone || f.userId === user.id).filter(f => f.status === 'pendente')
    const saldoPend = finPend.reduce((s, f) => s + (f.value || f.valor || 0), 0)
    const userId = user.id
    const userTel = user.telefone || ''
    return `<div class="mp" data-id="${userId}" data-tel="${tel}" data-nome="${nome}" data-addr="${addr}">
  <div class="mp-h">
    <div class="mp-av">${nome.charAt(0).toUpperCase()}</div>
    <div class="mp-hi"><b>${nome}</b><span>${user.telefone || ''}${email ? ' · ' + email : ''}</span></div>
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
    ${tel ? `<button class="mp-btn wa" data-action="whatsapp"><i class="fa-brands fa-whatsapp"></i> WhatsApp</button>` : ''}
    <button class="mp-btn gm" data-action="gmap"><i class="fa-solid fa-location-dot"></i> Maps</button>
    ${pendentes > 0 ? `<button class="mp-btn rt" data-action="rota"><i class="fa-solid fa-truck"></i> A Caminho</button>` : ''}
    ${saldoPend > 0 ? `<button class="mp-btn fn" data-action="saldo"><i class="fa-solid fa-coins"></i> Saldo Pend.</button>` : ''}
    <button class="mp-btn vi" data-action="view"><i class="fa-solid fa-eye"></i> Ver Pedidos</button>
  </div>
</div>`
  }, [orders, financial])

  // Sync markers
  useEffect(() => {
    if (!gMap.current) return
    const m = gMap.current
    const bounds = new google.maps.LatLngBounds()
    let has = false
    const currentIds = new Set()
    const iw = infoWin.current

    for (const item of filtered) {
      if (!item.coords) continue
      const id = item.id
      currentIds.add(id)
      const isSel = sel.has(id)
      let mk = markersRef.current[id]

      if (!mk) {
        mk = new google.maps.Marker({
          position: { lat: item.coords[0], lng: item.coords[1] },
          map: m,
          icon: isSel ? makeIconSel() : makeIcon(isSel ? '#dc2626' : '#2563eb'),
          zIndex: isSel ? 100 : 1
        })
        mk.addListener('click', () => {
          if (iw) {
            const html = buildPopup(item.user)
            iw.setContent(html)
            iw.open({ anchor: mk, map: m })
            google.maps.event.addListenerOnce(iw, 'domready', () => {
              const el = iw.getContent()
              if (!el || typeof el === 'string') return
              const root = typeof el === 'string' ? null : el
              const attach = (parent) => {
                if (!parent) return
                parent.onclick = (e) => {
                  const btn = e.target.closest('[data-action]')
                  if (!btn) return; e.stopPropagation()
                  const action = btn.dataset.action
                  const nome = parent.dataset.nome
                  const tel = parent.dataset.tel
                  const addr = parent.dataset.addr
                  if (action === 'whatsapp' && tel) {
                    window.open(`https://wa.me/55${tel}?text=${encodeURIComponent('Olá, tudo bem? Sou da THSM Distribuidora.')}`, '_blank')
                  } else if (action === 'gmap') {
                    window.open(`https://www.google.com/maps/search/${encodeURIComponent(addr)}`, '_blank')
                  } else if (action === 'rota') {
                    onMarkOnWay?.(item.user); iw.close()
                  } else if (action === 'saldo') {
                    const finPend = (financial || []).filter(f => f.telefone === item.user.telefone || f.userId === item.user.id).filter(f => f.status === 'pendente')
                    const total = finPend.reduce((s, f) => s + (f.value || f.valor || 0), 0)
                    const msg = finPend.map(f => `• ${f.itemName || f.descricao || 'Item'} - ${fmt(f.value || f.valor || 0)} (vence ${fmtDate(f.dueDate || f.vencimento)})`).join('\n')
                    alert(`Saldo pendente de ${nome}: ${fmt(total)}\n\n${msg || 'Nenhum registro pendente'}`)
                  } else if (action === 'view') {
                    onViewUser?.(item.user); iw.close()
                  }
                }
              }
              // Find the mp element
              const mp = typeof el === 'string' ? null : el.querySelector?.('.mp')
              attach(mp || el)
            })
          }
          m.panTo({ lat: item.coords[0], lng: item.coords[1] })
          m.setZoom(15)
          setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
        })
        markersRef.current[id] = mk
      } else {
        mk.setPosition({ lat: item.coords[0], lng: item.coords[1] })
        mk.setIcon(isSel ? makeIconSel() : makeIcon('#2563eb'))
        mk.setZIndex(isSel ? 100 : 1)
      }
      bounds.extend({ lat: item.coords[0], lng: item.coords[1] })
      has = true
    }

    for (const id of Object.keys(markersRef.current)) {
      if (!currentIds.has(id)) {
        markersRef.current[id].setMap(null)
        delete markersRef.current[id]
      }
    }

    if (has && !initialFit.current) {
      m.fitBounds(bounds)
      google.maps.event.addListenerOnce(m, 'idle', () => { if (m.getZoom() > 12) m.setZoom(12) })
      initialFit.current = true
    }
  }, [filtered, sel, buildPopup, onMarkOnWay, onViewUser, financial])

  // Zoom to filter
  const itemsRef = useRef(items)
  itemsRef.current = items
  useEffect(() => {
    if (!gMap.current || !itemsRef.current.length) return
    const m = gMap.current
    const it = itemsRef.current
    let target = null
    if (filtroCidade !== 'TODAS') {
      const found = it.find(i => (i.user.endereco?.cidade || '').toLowerCase() === filtroCidade.toLowerCase())
      const ec = found ? cityCoord(found.user.endereco.cidade, found.user.endereco.estado) : null
      if (ec) target = { coords: ec, zoom: 12 }
    } else if (filtroEstado !== 'TODOS') {
      const ec = ESTADO[filtroEstado.toLowerCase()]
      if (ec) target = { coords: ec, zoom: 8 }
    }
    if (target) { m.setCenter({ lat: target.coords[0], lng: target.coords[1] }); m.setZoom(target.zoom) }
    else if (filtroCidade === 'TODAS' && filtroEstado === 'TODOS') {
      const bounds = new google.maps.LatLngBounds()
      let has = false
      for (const item of it) {
        if (!item.coords) continue
        bounds.extend({ lat: item.coords[0], lng: item.coords[1] })
        has = true
      }
      if (has) { m.fitBounds(bounds); google.maps.event.addListenerOnce(m, 'idle', () => { if (m.getZoom() > 12) m.setZoom(12) }) }
    }
  }, [filtroCidade, filtroEstado])

  // Routes
  useEffect(() => {
    if (!gMap.current) return
    const m = gMap.current
    polyRef.current.forEach(p => p.setMap(null))
    polyRef.current = []
    if (!rotas.length) { dirRender.current?.setMap(null); return }
    // Use DirectionsRenderer for the first route, polylines for alternatives
    rotas.forEach((coords, i) => {
      const c = ROTA_CORES[i % ROTA_CORES.length]
      const path = coords.map(crd => ({ lat: crd[0], lng: crd[1] }))
      const poly = new google.maps.Polyline({ path, strokeColor: c, strokeWeight: 4, strokeOpacity: 0.6, map: m })
      polyRef.current.push(poly)
    })
  }, [rotas])

  const tracar = useCallback(async () => {
    const selPts = items.filter(p => sel.has(p.id) && p.coords)
    if (selPts.length < 2) return
    setCalc(true); setRotaMeta(null)
    try {
      const waypoints = selPts.slice(1, -1).map(p => ({ location: { lat: p.coords[0], lng: p.coords[1] }, stopover: true }))
      const origin = { lat: selPts[0].coords[0], lng: selPts[0].coords[1] }
      const dest = { lat: selPts[selPts.length - 1].coords[0], lng: selPts[selPts.length - 1].coords[1] }
      const ds = new google.maps.DirectionsService()
      ds.route({
        origin, destination: dest,
        waypoints: waypoints.length > 0 ? waypoints : undefined,
        travelMode: google.maps.TravelMode.DRIVING,
        provideRouteAlternatives: true
      }, (result, status) => {
        if (status === 'OK' && result.routes.length > 0) {
          const routes = result.routes.map(r => ({
            coords: r.overview_path.map(p => [p.lat(), p.lng()]),
            distancia: r.legs.reduce((s, l) => s + l.distance.value, 0),
            duracao: r.legs.reduce((s, l) => s + l.duration.value, 0)
          }))
          setRotas(routes.map(r => r.coords))
          setRotaMeta(routes.map(r => ({ distancia: r.distancia, duracao: r.duracao })))
        }
        setCalc(false)
      })
    } catch { setCalc(false) }
  }, [items, sel])

  const sorted = useMemo(() => {
    const w = filtered.filter(i => i.coords)
    const wo = filtered.filter(i => !i.coords)
    return [...w, ...wo]
  }, [filtered])

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
          <div className="mv-sub">{users.length} usuários · {filtered.filter(i => i.coords).length} no mapa · {sel.size} selecionados{geoStatus > 0 && geoStatus < 100 ? ` · Geocodificando ${geoStatus}%` : ''}{csvMsg ? ` · ${csvMsg.v}` : ''}{geoError ? ` · ⚠️ ${geoError}` : ''}</div>
        </div>
        <div className="mv-actions">
          <button className="mbtn" onClick={() => {
            const BOM = '\uFEFF'
            const cab = 'Nome;Telefone;Endereço\n'
            const linhas = items.map(i => {
              const e = i.user.endereco || {}
              const addr = [e.rua, e.numero, e.bairro, e.cidade, e.estado].filter(Boolean).join(', ')
              const nome = `"${(i.user.nome || i.user.pushName || '').replace(/"/g, '""')}"`
              const tel = i.user.telefone || ''
              return `${nome};${tel};"${addr.replace(/"/g, '""')}"`
            }).join('\n')
            const blob = new Blob([BOM + cab + linhas], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href = url; a.download = 'usuarios.csv'; a.click()
            URL.revokeObjectURL(url)
          }}><i className="fa-solid fa-download"></i> CSV</button>
          <button className="mbtn" onClick={() => csvInputRef.current?.click()}><i className="fa-solid fa-upload"></i> Importar</button>
          <input ref={csvInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => {
            const file = e.target.files?.[0]
            if (!file) return
            const reader = new FileReader()
            reader.onload = (ev) => {
              const txt = ev.target.result
              const linhas = txt.split('\n').map(l => l.trim()).filter(Boolean)
              if (linhas.length < 2) { setCsvMsg({ t: 'erro', v: 'CSV vazio' }); return }
              const cabecalho = linhas[0].toLowerCase()
              const colsHeader = cabecalho.split(';').map(c => c.trim())
              const idxNome = colsHeader.findIndex(c => c.includes('nome'))
              const idxTel = colsHeader.findIndex(c => c.includes('telefone') || c.includes('tel'))
              const idxLat = colsHeader.findIndex(c => c.includes('lat'))
              const idxLng = colsHeader.findIndex(c => c.includes('lon') || c.includes('lng'))
              if (idxLat < 0 || idxLng < 0) { setCsvMsg({ t: 'erro', v: 'CSV precisa ter colunas Latitude e Longitude' }); return }
              const cache = JSON.parse(localStorage.getItem('thsm_geocode_cache') || '{}')
              let importados = 0; let naoMatch = 0
              for (let i = 1; i < linhas.length; i++) {
                const raw = linhas[i]
                const cols = raw.split(';').map(c => c.replace(/^"|"$/g, '').trim())
                if (cols.length <= Math.max(idxLat, idxLng)) continue
                const lat = parseFloat(cols[idxLat].replace(',', '.'))
                const lng = parseFloat(cols[idxLng].replace(',', '.'))
                if (isNaN(lat) || isNaN(lng)) continue
                const nomeCSV = (cols[idxNome] || '').toLowerCase().trim()
                const telCSV = (cols[idxTel] || '').replace(/\D/g, '')
                const endCSV = (cols[idxNome + 1 === idxTel ? idxTel + 1 : 2] || '').toLowerCase().trim()
                const item = items.find(p => {
                  if (telCSV) {
                    const telUser = (p.user.telefone || '').replace(/\D/g, '')
                    if (telUser.endsWith(telCSV) || telCSV.endsWith(telUser)) return true
                  }
                  if (nomeCSV) {
                    const nomeUser = (p.user.nome || p.user.pushName || '').toLowerCase().trim()
                    if (nomeUser === nomeCSV || nomeUser.includes(nomeCSV) || nomeCSV.includes(nomeUser)) return true
                  }
                  if (endCSV && endCSV.length > 5) {
                    const addrUser = queryAddr(p.user.endereco).toLowerCase()
                    if (addrUser.includes(endCSV) || endCSV.includes(addrUser)) return true
                  }
                  return false
                })
                if (!item) { naoMatch++; continue }
                const addrKey = queryAddr(item.user.endereco)
                const bairroKey = queryBairro(item.user.endereco)
                cache[addrKey] = [lat, lng]
                if (bairroKey !== addrKey) cache[bairroKey] = [lat, lng]
                importados++
              }
              localStorage.setItem('thsm_geocode_cache', JSON.stringify(cache))
              const msg = `${importados} coordenadas importadas de ${linhas.length - 1} linhas${naoMatch > 0 ? ` (${naoMatch} sem match)` : ''}`
              setCsvMsg({ t: naoMatch === 0 ? 'ok' : 'aviso', v: msg })
              setItems(prev => prev.map(i => {
                const addrKey = queryAddr(i.user.endereco)
                const bairroKey = queryBairro(i.user.endereco)
                const c = cache[addrKey] || cache[bairroKey]
                return c ? { ...i, coords: c, fallback: false } : i
              }))
              setTimeout(() => setCsvMsg(null), 5000)
            }
            reader.readAsText(file)
            e.target.value = ''
          }} />
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

      {geoStatus > 0 && geoStatus < 100 && (
        <div style={{ width: '100%', height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${geoStatus}%`, height: '100%', background: '#6366f1', borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
      )}
      <div className="mv-filters">
        <div className="mv-search">
          <i className="fa-solid fa-search"></i>
          <input type="text" placeholder="Buscar nome ou telefone..." value={filtroSearch} onChange={e => setFiltroSearch(e.target.value)} />
        </div>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="TODOS">Todos estados</option>
          {estados.filter(e => e !== 'TODOS').map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={filtroCidade} onChange={e => setFiltroCidade(e.target.value)}>
          <option value="TODAS">Todas cidades</option>
          {cidades.filter(c => c !== 'TODAS').map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="mv-map" ref={mapRef}></div>

      <div className="mv-list">
        <div className="mv-lh"><i className="fa-solid fa-list"></i> Usuários <span className="mv-lc">{sel.size} selecionados</span></div>
        <div className="mv-lb">
          {sorted.filter(i => i.coords).map(p => {
            const isSel = sel.has(p.id)
            return (
              <div key={p.id} className={`mv-i ${isSel ? 's' : ''}`} onClick={() => {
                if (gMap.current) { gMap.current.setCenter({ lat: p.coords[0], lng: p.coords[1] }); gMap.current.setZoom(15) }
                toggle(p.id)
              }}>
                <div className="mv-av" style={{ background: isSel ? '#dc2626' : '#2563eb' }}><i className="fa-solid fa-user"></i></div>
                <div className="mv-if">
                  <b>{p.user.nome || p.user.pushName || '—'}</b>
                  <span>{fullAddr(p.user.endereco || {})}</span>
                </div>
              </div>
            )
          })}
          {sorted.filter(i => i.coords).length === 0 && <div className="mv-e">Nenhum usuário encontrado</div>}
        </div>
      </div>
    </div>
  )
}
