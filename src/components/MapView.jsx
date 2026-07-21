import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './MapView.css'

const GEO_CACHE_KEY = 'thsm_geo_cache'

const BR_CITIES = {
  'acre': ['ac', -9.02, -70.81], 'alagoas': ['al', -9.57, -36.55], 'amapa': ['ap', 0.03, -51.05],
  'amazonas': ['am', -3.07, -61.66], 'bahia': ['ba', -12.96, -38.51], 'ceara': ['ce', -3.73, -38.53],
  'distrito federal': ['df', -15.78, -47.92], 'espirito santo': ['es', -20.29, -40.30],
  'goias': ['go', -16.64, -49.29], 'maranhao': ['ma', -2.54, -44.28],
  'mato grosso': ['mt', -15.61, -56.10], 'mato grosso do sul': ['ms', -20.46, -54.61],
  'minas gerais': ['mg', -19.92, -43.94], 'para': ['pa', -1.47, -48.49],
  'paraiba': ['pb', -7.12, -34.88], 'parana': ['pr', -25.43, -49.27],
  'pernambuco': ['pe', -8.05, -34.89], 'piaui': ['pi', -5.09, -42.80],
  'rio de janeiro': ['rj', -22.91, -43.20], 'rio grande do norte': ['rn', -5.80, -35.21],
  'rio grande do sul': ['rs', -30.03, -51.23], 'rondonia': ['ro', -8.76, -63.90],
  'roraima': ['rr', 2.82, -60.67], 'santa catarina': ['sc', -27.60, -48.55],
  'sao paulo': ['sp', -23.55, -46.63], 'sergipe': ['se', -10.91, -37.07],
  'tocantins': ['to', -10.18, -48.33],
  'belo horizonte': ['mg', -19.92, -43.94], 'sao paulo': ['sp', -23.55, -46.63],
  'rio de janeiro': ['rj', -22.91, -43.20], 'brasilia': ['df', -15.78, -47.92],
  'salvador': ['ba', -12.97, -38.50], 'fortaleza': ['ce', -3.73, -38.54],
  'recife': ['pe', -8.05, -34.88], 'porto alegre': ['rs', -30.03, -51.23],
  'curitiba': ['pr', -25.43, -49.27], 'manaus': ['am', -3.12, -60.02],
  'belem': ['pa', -1.47, -48.48], 'goiania': ['go', -16.64, -49.29],
  'guarulhos': ['sp', -23.46, -46.53], 'campinas': ['sp', -22.91, -47.06],
  'sao luis': ['ma', -2.53, -44.28], 'sao goncalo': ['rj', -22.82, -43.05],
  'maceio': ['al', -9.66, -35.74], 'duque de caxias': ['rj', -22.78, -43.31],
  'natal': ['rn', -5.79, -35.20], 'campo grande': ['ms', -20.44, -54.65],
  'teresina': ['pi', -5.09, -42.80], 'sao bernardo do campo': ['sp', -23.69, -46.56],
  'joao pessoa': ['pb', -7.12, -34.88], 'nova iguaçu': ['rj', -22.75, -43.45],
  'jaboatao dos guararapes': ['pe', -8.11, -35.02], 'contagem': ['mg', -19.93, -44.05],
  'santo andre': ['sp', -23.67, -46.54], 'osasco': ['sp', -23.53, -46.79],
  'ribeirao preto': ['sp', -21.17, -47.81], 'uberlandia': ['mg', -18.92, -48.28],
  'sorocaba': ['sp', -23.50, -47.46], 'aracaju': ['se', -10.91, -37.07],
  'cuiaba': ['mt', -15.61, -56.10], 'feira de santana': ['ba', -12.26, -38.97],
  'joinville': ['sc', -26.30, -48.85], 'londrina': ['pr', -23.31, -51.16],
  'juiz de fora': ['mg', -21.76, -43.35], 'niteroi': ['rj', -22.88, -43.10],
  'belford roxo': ['rj', -22.76, -43.40], 'campos dos goytacazes': ['rj', -21.75, -41.33],
  'sao jose dos campos': ['sp', -23.22, -45.89], 'porto velho': ['ro', -8.76, -63.90],
  'macapa': ['ap', 0.03, -51.05], 'palmas': ['to', -10.18, -48.33],
  'boa vista': ['rr', 2.82, -60.67], 'rio branco': ['ac', -9.97, -67.81],
  'vitoria': ['es', -20.29, -40.30], 'florianopolis': ['sc', -27.60, -48.55],
  'santos': ['sp', -23.96, -46.33], 'taubate': ['sp', -23.03, -45.56],
  'pindamonhangaba': ['sp', -22.92, -45.46], 'jacarei': ['sp', -23.31, -45.97],
  'sao jose dos pinhais': ['pr', -25.53, -49.21], 'cachoeiro de itapemirim': ['es', -20.85, -41.11],
  'colatina': ['es', -19.54, -40.63], 'linhares': ['es', -19.39, -40.07],
  'nova friburgo': ['rj', -22.29, -42.53], 'teresopolis': ['rj', -22.41, -42.97],
  'petropolis': ['rj', -22.51, -43.18], 'macaé': ['rj', -22.37, -41.78],
  'cabo frio': ['rj', -22.88, -42.02], 'angra dos reis': ['rj', -23.01, -44.32],
  'barra mansa': ['rj', -22.55, -44.17], 'resende': ['rj', -22.47, -44.45],
  'volta redonda': ['rj', -22.53, -44.10], 'itaipava': ['rj', -22.41, -43.31],
  'barbacena': ['mg', -21.23, -43.77], 'ubá': ['mg', -21.12, -42.94],
  'ubá/mg': ['mg', -21.12, -42.94], 'ubá / mg': ['mg', -21.12, -42.94],
  'leopoldina': ['mg', -21.53, -42.64], 'cataguases': ['mg', -21.38, -42.69],
  'muriaé': ['mg', -21.13, -42.37], 'visconde do rio branco': ['mg', -21.01, -42.84],
  'almirante soares': ['rj', -22.88, -43.10],
}

const STATE_CENTERS = {
  'ac': [-9.02, -70.81], 'al': [-9.57, -36.55], 'ap': [0.03, -51.05], 'am': [-3.07, -61.66],
  'ba': [-12.96, -38.51], 'ce': [-3.73, -38.53], 'df': [-15.78, -47.92], 'es': [-20.29, -40.30],
  'go': [-16.64, -49.29], 'ma': [-2.54, -44.28], 'mt': [-15.61, -56.10], 'ms': [-20.46, -54.61],
  'mg': [-19.92, -43.94], 'pa': [-1.47, -48.49], 'pb': [-7.12, -34.88], 'pr': [-25.43, -49.27],
  'pe': [-8.05, -34.89], 'pi': [-5.09, -42.80], 'rj': [-22.91, -43.20], 'rn': [-5.80, -35.21],
  'rs': [-30.03, -51.23], 'ro': [-8.76, -63.90], 'rr': [2.82, -60.67], 'sc': [-27.60, -48.55],
  'sp': [-23.55, -46.63], 'se': [-10.91, -37.07], 'to': [-10.18, -48.33],
}

function getGeoCache() {
  try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}') } catch { return {} }
}

function setGeoCache(cache) {
  localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache))
}

function normalizeCity(name) {
  if (!name) return ''
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim()
}

function getCityCoords(cidade, estado) {
  if (!cidade) return null
  const key = normalizeCity(cidade)
  const match = BR_CITIES[key]
  if (match) return [match[1], match[2]]
  const uf = (estado || '').toLowerCase()
  if (STATE_CENTERS[uf]) return STATE_CENTERS[uf]
  return null
}

function hasCompleteAddress(e) {
  return !!(e?.rua && e?.cidade)
}

function buildFullAddress(e) {
  return [e.rua, e.numero, e.bairro, e.cidade, e.estado].filter(Boolean).join(', ')
}

function getMarkerIcon(color = '#2563eb', size = 28) {
  const s = size
  return L.divIcon({
    className: 'mmi',
    html: `<div style="background:${color};width:${s}px;height:${s}px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:${Math.round(s*0.45)}px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3)"><i class="fa-solid fa-user"></i></div>`,
    iconSize: [s, s],
    iconAnchor: [s/2, s/2],
    popupAnchor: [0, -(s/2+4)]
  })
}

function getSelectedIcon() {
  return L.divIcon({
    className: 'mmi',
    html: `<div style="background:#dc2626;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:15px;border:3px solid #fca5a5;box-shadow:0 2px 12px rgba(220,38,38,0.5)"><i class="fa-solid fa-user"></i></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -21]
  })
}

const ROUTE_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#8b5cf6', '#ec4899', '#06b6d4']

export default function MapView({ usuarios }) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markersLayer = useRef(null)
  const routesLayer = useRef(null)
  const [items, setItems] = useState([])
  const [geocoding, setGeocoding] = useState(true)
  const [progress, setProgress] = useState({ done: 0, total: 0, city: 0 })
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [routes, setRoutes] = useState([])
  const [routing, setRouting] = useState(false)
  const [showCity, setShowCity] = useState(true)

  const completeUsers = useMemo(() => {
    return usuarios.filter(u => hasCompleteAddress(u.endereco || {}))
  }, [usuarios])

  useEffect(() => {
    if (mapInstance.current) return
    const map = L.map(mapRef.current, { zoomControl: false, attributionControl: false }).setView([-15.8, -47.9], 5)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    L.control.zoom({ position: 'topright' }).addTo(map)
    markersLayer.current = L.layerGroup().addTo(map)
    routesLayer.current = L.layerGroup().addTo(map)
    mapInstance.current = map
    return () => { map.remove(); mapInstance.current = null }
  }, [])

  const updateMarkers = useCallback((newItems, sel) => {
    if (!mapInstance.current) return
    const map = mapInstance.current
    const layer = markersLayer.current
    layer.clearLayers()

    const withCoords = newItems.filter(i => i.coords)
    if (withCoords.length === 0) return

    const bounds = L.latLngBounds()
    withCoords.forEach(item => {
      const isSel = sel.has(item.id)
      const marker = L.marker([item.coords[0], item.coords[1]], {
        icon: isSel ? getSelectedIcon() : getMarkerIcon(item.cityLevel ? '#9ca3af' : '#2563eb', item.cityLevel ? 24 : 28)
      })
      const nome = item.user.nome || item.user.pushName || '—'
      const addr = buildFullAddress(item.user.endereco || {})
      marker.bindPopup(`
        <div style="font-size:13px;line-height:1.5;min-width:180px">
          <strong style="font-size:14px">${nome}</strong><br/>
          <span style="color:#666">${item.user.telefone || ''}</span><br/>
          <span style="color:#888;font-size:12px">${addr}</span>
          ${item.cityLevel ? '<br/><span style="color:#9ca3af;font-size:11px">📍 posição aproximada (cidade)</span>' : ''}
        </div>
      `)
      marker.on('click', () => {
        setSelectedIds(prev => {
          const next = new Set(prev)
          next.has(item.id) ? next.delete(item.id) : next.add(item.id)
          return next
        })
      })
      marker.addTo(layer)
      bounds.extend(item.coords)
    })

    if (withCoords.length === 1) {
      map.setView(withCoords[0].coords, 14)
    } else {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
    }
  }, [])

  useEffect(() => {
    updateMarkers(items, selectedIds)
  }, [items, selectedIds, updateMarkers])

  useEffect(() => {
    if (!mapInstance.current) return
    const layer = routesLayer.current
    layer.clearLayers()
    routes.forEach((coords, i) => {
      const polyline = L.polyline(coords, { color: ROUTE_COLORS[i % ROUTE_COLORS.length], weight: 5, opacity: 0.7 }).addTo(layer)
      const start = coords[0]; const end = coords[coords.length - 1]
      L.marker([start[0], start[1]], { icon: L.divIcon({ className: 'rsi', html: '<div style="background:#16a34a;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;border:2px solid white"><i class="fa-solid fa-play"></i></div>', iconSize: [20,20], iconAnchor: [10,10] }) }).addTo(layer)
      L.marker([end[0], end[1]], { icon: L.divIcon({ className: 'rei', html: '<div style="background:#dc2626;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;border:2px solid white"><i class="fa-solid fa-flag-checkered"></i></div>', iconSize: [20,20], iconAnchor: [10,10] }) }).addTo(layer)
    })
  }, [routes])

  const processUsers = useCallback(async () => {
    if (completeUsers.length === 0) { setGeocoding(false); return }
    setGeocoding(true)

    const cache = getGeoCache()
    const result = []
    let cityCount = 0

    for (const u of completeUsers) {
      const id = u.telefone || u.id
      const addr = buildFullAddress(u.endereco)
      const cacheKey = addr.toLowerCase()
      let coords = cache[cacheKey]

      if (coords) {
        result.push({ id, user: u, coords: [coords.lat, coords.lng], cityLevel: false })
        continue
      }

      const cc = getCityCoords(u.endereco.cidade, u.endereco.estado)
      if (cc) {
        cityCount++
        result.push({ id, user: u, coords: cc, cityLevel: true })
      } else {
        result.push({ id, user: u, coords: null, cityLevel: false })
      }
    }

    setItems(result)
    setProgress(p => ({ ...p, city: cityCount }))
    setGeocoding(false)

    const toGeocode = result.filter(i => i.cityLevel)
    if (toGeocode.length === 0) return

    setGeocoding(true)
    setProgress({ done: 0, total: toGeocode.length, city: cityCount })

    let idx = 0
    for (const item of toGeocode) {
      const addr = buildFullAddress(item.user.endereco)
      const cacheKey = addr.toLowerCase()
      try {
        await new Promise(r => setTimeout(r, 1100))
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`
        const res = await fetch(url, { headers: { 'User-Agent': 'THSM-Distribuidora/1.0' } })
        const data = await res.json()
        if (data && data.length > 0) {
          const lat = parseFloat(data[0].lat); const lng = parseFloat(data[0].lon)
          const c = getGeoCache(); c[cacheKey] = { lat, lng }; setGeoCache(c)
          item.coords = [lat, lng]; item.cityLevel = false
        }
      } catch { /* ignore */ }
      idx++
      setProgress({ done: idx, total: toGeocode.length, city: cityCount })
      setItems([...result])
    }
    setGeocoding(false)
  }, [completeUsers])

  useEffect(() => { processUsers() }, [processUsers])

  const sortedItems = useMemo(() => {
    const withCoords = items.filter(i => i.coords)
    const without = items.filter(i => !i.coords)
    return [...withCoords, ...without]
  }, [items])

  const traceRoutes = useCallback(async () => {
    const selected = items.filter(i => selectedIds.has(i.id) && i.coords)
    if (selected.length < 2) return
    setRouting(true)
    const coordsStr = selected.map(i => `${i.coords[1]},${i.coords[0]}`).join(';')
    try {
      const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`)
      const data = await res.json()
      if (data.code === 'Ok' && data.routes?.length > 0) {
        setRoutes(data.routes.map(r => r.geometry.coordinates.map(c => [c[1], c[0]])))
      }
    } catch { /* ignore */ }
    setRouting(false)
  }, [items, selectedIds])

  return (
    <div className="map-view">
      <div className="map-view-header">
        <div>
          <h2><i className="fa-solid fa-map"></i> Mapa de Usuários</h2>
          <p className="map-view-subtitle">
            {completeUsers.length} usuários com endereço completo
            {' · '}{items.filter(i => i.coords && !i.cityLevel).length} geolocalizados
            {' · '}{items.filter(i => i.coords && i.cityLevel).length} por cidade
            {items.filter(i => !i.coords).length > 0 && ` · ${items.filter(i => !i.coords).length} sem local`}
          </p>
        </div>
        <div className="map-view-actions">
          <button className={`map-btn ${showCity ? 'map-btn-primary' : 'map-btn-sec'}`}
            onClick={() => setShowCity(p => !p)}>
            <i className="fa-solid fa-city"></i> Mostrar cidade
          </button>
          {items.filter(i => selectedIds.has(i.id) && i.coords).length >= 2 && (
            <button className="map-btn map-btn-danger" onClick={traceRoutes} disabled={routing}>
              <i className={`fa-solid ${routing ? 'fa-spinner fa-spin' : 'fa-route'}`}></i>
              {routing ? ' Calculando...' : ` Traçar Rota (${selectedIds.size})`}
            </button>
          )}
          <button className="map-btn map-btn-sec" onClick={() => { setSelectedIds(new Set()); setRoutes([]) }}>
            <i className="fa-solid fa-xmark"></i> Limpar
          </button>
          <button className="map-btn map-btn-sec" disabled={geocoding} onClick={processUsers}>
            <i className={`fa-solid ${geocoding ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i>
            {geocoding ? ` Refinando (${progress.done}/${progress.total})` : ' Re-geolocalizar'}
          </button>
        </div>
      </div>

      {geocoding && progress.total > 0 && (
        <div className="map-geocoding-bar">
          <div className="map-geocoding-progress" style={{ width: `${(progress.done / progress.total) * 100}%` }}></div>
          <span>Geocodificando endereços precisos... {progress.done}/{progress.total}</span>
        </div>
      )}

      <div className="map-container" ref={mapRef}></div>

      <div className="map-user-list">
        <h4>
          <i className="fa-solid fa-list"></i> Usuários {geocoding && <span className="map-geocoding-msg">(carregando...)</span>}
          <span className="map-user-count">{selectedIds.size} selecionados</span>
        </h4>
        <div className="map-user-scroll">
          {sortedItems.filter(i => showCity ? true : i.coords && !i.cityLevel).map(item => {
            const isSel = selectedIds.has(item.id)
            return (
              <div key={item.id}
                className={`map-user-item ${isSel ? 'selected' : ''} ${!item.coords ? 'no-coords' : ''} ${item.cityLevel ? 'city-level' : ''}`}
                onClick={() => {
                  if (item.coords) {
                    mapInstance.current?.setView(item.coords, Math.min(mapInstance.current.getZoom() + 1, 16))
                    setSelectedIds(prev => {
                      const next = new Set(prev)
                      next.has(item.id) ? next.delete(item.id) : next.add(item.id)
                      return next
                    })
                  }
                }}>
                <div className="map-user-avatar" style={{ background: isSel ? '#dc2626' : item.coords ? (item.cityLevel ? '#9ca3af' : '#2563eb') : '#e5e7eb', color: !item.coords ? '#9ca3af' : 'white' }}>
                  <i className="fa-solid fa-user"></i>
                </div>
                <div className="map-user-info">
                  <strong>{item.user.nome || item.user.pushName || '—'}</strong>
                  <span>{buildFullAddress(item.user.endereco || {})}</span>
                </div>
                {item.cityLevel && <span className="map-user-badge badge-city">Cidade</span>}
                {!item.coords && <span className="map-user-badge badge-none">Sem local</span>}
              </div>
            )
          })}
          {sortedItems.length === 0 && !geocoding && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--admin-text-sec)' }}>
              <i className="fa-solid fa-map-location-dot" style={{ fontSize: '2rem', opacity: 0.3, marginBottom: '0.5rem', display: 'block' }}></i>
              Nenhum usuário com endereço completo encontrado
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
