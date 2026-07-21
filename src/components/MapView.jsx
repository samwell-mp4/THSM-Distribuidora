import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './MapView.css'

const GEO_CACHE_KEY = 'thsm_geo_cache'
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving'

function getGeoCache() {
  try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}') } catch { return {} }
}

function setGeoCache(cache) {
  localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache))
}

function hasCompleteAddress(e) {
  return !!(e?.rua && e?.cidade)
}

function buildFullAddress(e) {
  return [e.rua, e.numero, e.bairro, e.cidade, e.estado].filter(Boolean).join(', ')
}

function getMarkerIcon(color = '#2563eb') {
  return L.divIcon({
    className: 'map-marker-icon',
    html: `<div style="background:${color};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:13px;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3)"><i class="fa-solid fa-user"></i></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16]
  })
}

function getSelectedIcon() {
  return L.divIcon({
    className: 'map-marker-icon',
    html: `<div style="background:#dc2626;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:14px;border:3px solid #fca5a5;box-shadow:0 2px 12px rgba(220,38,38,0.5)"><i class="fa-solid fa-user"></i></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18]
  })
}

function getRouteColor(index) {
  const colors = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#8b5cf6', '#ec4899', '#06b6d4']
  return colors[index % colors.length]
}

export default function MapView({ usuarios }) {
  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const markersLayer = useRef(null)
  const routesLayer = useRef(null)
  const [geocodedUsers, setGeocodedUsers] = useState([])
  const [geocoding, setGeocoding] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [selectedUsers, setSelectedUsers] = useState(new Set())
  const [routes, setRoutes] = useState([])
  const [routing, setRouting] = useState(false)
  const [viewMode, setViewMode] = useState('all')

  const completeUsers = useMemo(() => {
    return usuarios.filter(u => hasCompleteAddress(u.endereco || {}))
  }, [usuarios])

  const geocodeAll = useCallback(async () => {
    if (completeUsers.length === 0) return
    setGeocoding(true)
    const cache = getGeoCache()
    const toGeocode = completeUsers.filter(u => {
      const addr = buildFullAddress(u.endereco).toLowerCase()
      return !cache[addr]
    })
    setProgress({ done: 0, total: toGeocode.length })

    const results = []
    let idx = 0
    for (const u of completeUsers) {
      const addr = buildFullAddress(u.endereco)
      const cacheKey = addr.toLowerCase()
      let coords = cache[cacheKey]

      if (!coords && toGeocode.includes(u)) {
        await new Promise(r => setTimeout(r, 1100))
        try {
          const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`
          const res = await fetch(url, { headers: { 'User-Agent': 'THSM-Distribuidora/1.0' } })
          const data = await res.json()
          if (data && data.length > 0) {
            coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
            cache[cacheKey] = coords
            setGeoCache(cache)
          }
        } catch { /* skip failed geocodes */ }
        idx++
        setProgress({ done: idx, total: toGeocode.length })
      }

      results.push({ user: u, coords })
    }

    setGeocodedUsers(results)
    setGeocoding(false)
  }, [completeUsers])

  useEffect(() => {
    if (mapInstance.current) return
    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false
    }).setView([-15.8, -47.9], 5)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(map)

    L.control.zoom({ position: 'topright' }).addTo(map)

    markersLayer.current = L.layerGroup().addTo(map)
    routesLayer.current = L.layerGroup().addTo(map)

    mapInstance.current = map
    return () => { map.remove(); mapInstance.current = null }
  }, [])

  useEffect(() => {
    if (!geocodedUsers.length || !mapInstance.current) return
    const map = mapInstance.current
    const layer = markersLayer.current
    layer.clearLayers()

    const hasCoords = geocodedUsers.filter(u => u.coords)
    if (hasCoords.length === 0) return

    const bounds = L.latLngBounds()
    const uid = (u) => u.user.telefone || u.user.id

    hasCoords.forEach(item => {
      const isSelected = selectedUsers.has(uid(item))
      const marker = L.marker([item.coords.lat, item.coords.lng], {
        icon: isSelected ? getSelectedIcon() : getMarkerIcon()
      })

      const nome = item.user.nome || item.user.pushName || '—'
      const addr = buildFullAddress(item.user.endereco || {})
      marker.bindPopup(`
        <div style="font-size:13px;line-height:1.5;min-width:180px">
          <strong style="font-size:14px">${nome}</strong><br/>
          <span style="color:#666">${item.user.telefone || ''}</span><br/>
          <span style="color:#888;font-size:12px">${addr}</span>
        </div>
      `)

      marker.on('click', () => {
        const id = uid(item)
        setSelectedUsers(prev => {
          const next = new Set(prev)
          next.has(id) ? next.delete(id) : next.add(id)
          return next
        })
      })

      marker.addTo(layer)
      bounds.extend([item.coords.lat, item.coords.lng])
    })

    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
  }, [geocodedUsers, selectedUsers])

  const traceRoutes = useCallback(async () => {
    const selected = geocodedUsers.filter(u => selectedUsers.has(u.user.telefone || u.user.id))
    if (selected.length < 2) return

    setRouting(true)
    const coordsStr = selected.map(u => `${u.coords.lng},${u.coords.lat}`).join(';')
    const url = `${OSRM_BASE}/${coordsStr}?overview=full&geometries=geojson`

    try {
      const res = await fetch(url)
      const data = await res.json()
      if (data.code === 'Ok' && data.routes?.length > 0) {
        setRoutes(data.routes.map(r => r.geometry.coordinates.map(c => [c[1], c[0]])))
      }
    } catch { /* ignore */ }
    setRouting(false)
  }, [geocodedUsers, selectedUsers])

  useEffect(() => {
    if (!mapInstance.current) return
    const layer = routesLayer.current
    layer.clearLayers()

    routes.forEach((coords, i) => {
      const polyline = L.polyline(coords, {
        color: getRouteColor(i),
        weight: 5,
        opacity: 0.7
      })
      polyline.addTo(layer)

      const start = coords[0]
      const end = coords[coords.length - 1]
      L.marker([start[0], start[1]], {
        icon: L.divIcon({
          className: 'route-start-icon',
          html: `<div style="background:#16a34a;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;border:2px solid white"><i class="fa-solid fa-play"></i></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        })
      }).addTo(layer)

      L.marker([end[0], end[1]], {
        icon: L.divIcon({
          className: 'route-end-icon',
          html: `<div style="background:#dc2626;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;border:2px solid white"><i class="fa-solid fa-flag-checkered"></i></div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        })
      }).addTo(layer)
    })
  }, [routes])

  const clearRoutes = () => {
    setRoutes([])
    setSelectedUsers(new Set())
  }

  const selectAll = () => {
    setSelectedUsers(new Set(geocodedUsers.map(u => u.user.telefone || u.user.id)))
  }

  return (
    <div className="map-view">
      <div className="map-view-header">
        <div>
          <h2><i className="fa-solid fa-map"></i> Mapa de Usuários</h2>
          <p className="map-view-subtitle">
            {completeUsers.length} usuários com endereço completo
            {geocodedUsers.length > 0 && ` · ${geocodedUsers.filter(u => u.coords).length} geolocalizados`}
          </p>
        </div>
        <div className="map-view-actions">
          <button className="map-btn map-btn-sec" onClick={() => { setGeocodedUsers([]); geocodeAll() }}
            disabled={geocoding}>
            <i className={`fa-solid ${geocoding ? 'fa-spinner fa-spin' : 'fa-map-pin'}`}></i>
            {geocoding ? ` Geocodificando (${progress.done}/${progress.total})` : ' Geolocalizar'}
          </button>
          <button className="map-btn map-btn-sec" onClick={() => setViewMode(viewMode === 'all' ? 'geocoded' : 'all')}>
            <i className="fa-solid fa-filter"></i> {viewMode === 'all' ? 'Com coordenadas' : 'Todos'}
          </button>
          {geocodedUsers.filter(u => u.coords).length > 0 && (
            <>
              <button className="map-btn map-btn-sec" onClick={selectAll}>
                <i className="fa-solid fa-check-double"></i> Selecionar todos
              </button>
              <button className="map-btn map-btn-danger" onClick={clearRoutes}>
                <i className="fa-solid fa-xmark"></i> Limpar
              </button>
              {selectedUsers.size >= 2 && (
                <button className="map-btn map-btn-primary" onClick={traceRoutes} disabled={routing}>
                  <i className={`fa-solid ${routing ? 'fa-spinner fa-spin' : 'fa-route'}`}></i>
                  {routing ? ' Calculando...' : ` Traçar Rota (${selectedUsers.size})`}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {geocoding && (
        <div className="map-geocoding-bar">
          <div className="map-geocoding-progress" style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}></div>
          <span>Geocodificando endereços... {progress.done}/{progress.total}</span>
        </div>
      )}

      <div className="map-container" ref={mapRef}></div>

      {geocodedUsers.length > 0 && (
        <div className="map-user-list">
          <h4>
            <i className="fa-solid fa-list"></i> Usuários no mapa
            <span className="map-user-count">{selectedUsers.size} selecionados</span>
          </h4>
          <div className="map-user-scroll">
            {geocodedUsers.filter(u => viewMode === 'geocoded' ? u.coords : true).map(item => {
              const id = item.user.telefone || item.user.id
              const isSelected = selectedUsers.has(id)
              return (
                <div key={id}
                  className={`map-user-item ${isSelected ? 'selected' : ''} ${!item.coords ? 'no-coords' : ''}`}
                  onClick={() => {
                    if (item.coords) {
                      mapInstance.current?.setView([item.coords.lat, item.coords.lng], 16)
                      setSelectedUsers(prev => {
                        const next = new Set(prev)
                        next.has(id) ? next.delete(id) : next.add(id)
                        return next
                      })
                    }
                  }}>
                  <div className="map-user-avatar" style={{ background: isSelected ? '#dc2626' : item.coords ? '#2563eb' : '#9ca3af' }}>
                    <i className="fa-solid fa-user"></i>
                  </div>
                  <div className="map-user-info">
                    <strong>{item.user.nome || item.user.pushName || '—'}</strong>
                    <span>{buildFullAddress(item.user.endereco || {})}</span>
                  </div>
                  {!item.coords && <span className="map-user-no-coords">Sem local</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {geocodedUsers.length === 0 && !geocoding && (
        <div className="map-empty">
          <i className="fa-solid fa-map-location-dot"></i>
          <h3>Clique em "Geolocalizar"</h3>
          <p>Para visualizar os usuários no mapa, clique no botão acima para geocodificar os endereços.</p>
        </div>
      )}
    </div>
  )
}
