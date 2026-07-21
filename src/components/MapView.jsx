import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './MapView.css'

const CIDADE_COORDS = {
  'belo horizonte': [-19.92, -43.94], 'sao paulo': [-23.55, -46.63], 'rio de janeiro': [-22.91, -43.20],
  'brasilia': [-15.78, -47.92], 'salvador': [-12.97, -38.50], 'fortaleza': [-3.73, -38.54],
  'recife': [-8.05, -34.88], 'porto alegre': [-30.03, -51.23], 'curitiba': [-25.43, -49.27],
  'manaus': [-3.12, -60.02], 'belem': [-1.47, -48.48], 'goiania': [-16.64, -49.29],
  'guarulhos': [-23.46, -46.53], 'campinas': [-22.91, -47.06], 'sao luis': [-2.53, -44.28],
  'sao goncalo': [-22.82, -43.05], 'maceio': [-9.66, -35.74], 'duque de caxias': [-22.78, -43.31],
  'natal': [-5.79, -35.20], 'campo grande': [-20.44, -54.65], 'teresina': [-5.09, -42.80],
  'sao bernardo do campo': [-23.69, -46.56], 'joao pessoa': [-7.12, -34.88],
  'nova iguaçu': [-22.75, -43.45], 'jaboatao dos guararapes': [-8.11, -35.02],
  'contagem': [-19.93, -44.05], 'santo andre': [-23.67, -46.54], 'osasco': [-23.53, -46.79],
  'ribeirao preto': [-21.17, -47.81], 'uberlandia': [-18.92, -48.28], 'sorocaba': [-23.50, -47.46],
  'aracaju': [-10.91, -37.07], 'cuiaba': [-15.61, -56.10], 'feira de santana': [-12.26, -38.97],
  'joinville': [-26.30, -48.85], 'londrina': [-23.31, -51.16], 'juiz de fora': [-21.76, -43.35],
  'niteroi': [-22.88, -43.10], 'belford roxo': [-22.76, -43.40],
  'campos dos goytacazes': [-21.75, -41.33], 'sao jose dos campos': [-23.22, -45.89],
  'porto velho': [-8.76, -63.90], 'macapa': [0.03, -51.05], 'palmas': [-10.18, -48.33],
  'boa vista': [2.82, -60.67], 'rio branco': [-9.97, -67.81], 'vitoria': [-20.29, -40.30],
  'florianopolis': [-27.60, -48.55], 'santos': [-23.96, -46.33], 'taubate': [-23.03, -45.56],
  'pindamonhangaba': [-22.92, -45.46], 'jacarei': [-23.31, -45.97],
  'sao jose dos pinhais': [-25.53, -49.21], 'cachoeiro de itapemirim': [-20.85, -41.11],
  'colatina': [-19.54, -40.63], 'linhares': [-19.39, -40.07], 'nova friburgo': [-22.29, -42.53],
  'teresopolis': [-22.41, -42.97], 'petropolis': [-22.51, -43.18], 'macaé': [-22.37, -41.78],
  'cabo frio': [-22.88, -42.02], 'angra dos reis': [-23.01, -44.32],
  'barra mansa': [-22.55, -44.17], 'resende': [-22.47, -44.45], 'volta redonda': [-22.53, -44.10],
  'barbacena': [-21.23, -43.77], 'ubá': [-21.12, -42.94], 'leopoldina': [-21.53, -42.64],
  'cataguases': [-21.38, -42.69], 'muriaé': [-21.13, -42.37],
  'visconde do rio branco': [-21.01, -42.84], 'almirante tamandaré': [-25.33, -49.31],
  'colombo': [-25.29, -49.22], 'pinhais': [-25.45, -49.19], 'araucaria': [-25.59, -49.41],
  'campo largo': [-25.46, -49.53], 'guarapuava': [-25.39, -51.46],
  'ponta grossa': [-25.10, -50.16], 'cascavel': [-24.96, -53.46],
  'foz do iguaçu': [-25.55, -54.59], 'maringa': [-23.43, -51.94],
  'itu': [-23.27, -47.30], 'salto': [-23.20, -47.29], 'indaiatuba': [-23.09, -47.22],
  'itatiba': [-23.01, -46.84], 'braganca paulista': [-22.95, -46.54],
  'jundiai': [-23.19, -46.88], 'valinhos': [-22.97, -47.00], 'vinhedo': [-23.03, -47.00],
  'hortolandia': [-22.86, -47.22], 'sumaré': [-22.82, -47.27], 'americana': [-22.74, -47.33],
  'santa barbara d\'oeste': [-22.76, -47.41], 'nova odessa': [-22.78, -47.30],
  'piracicaba': [-22.73, -47.65], 'sao carlos': [-22.02, -47.89],
  'araraquara': [-21.79, -48.18], 'sao jose do rio preto': [-20.82, -49.38],
  'presidente prudente': [-22.12, -51.39], 'bauru': [-22.32, -49.07],
  'marilia': [-22.22, -49.95], 'franca': [-20.54, -47.40],
  'governador valadares': [-18.85, -41.95], 'divinopolis': [-20.15, -44.90],
  'ipatinga': [-19.47, -42.55], 'coronel fabriciano': [-19.52, -42.62],
  'timoteo': [-19.58, -42.65], 'sete lagoas': [-19.46, -44.25],
  'montes claros': [-16.73, -43.87], 'uberaba': [-19.75, -47.95],
  'poços de caldas': [-21.79, -46.57], 'passos': [-20.72, -46.61],
  'almirante soares': [-22.88, -43.10], 'conselheiro lafaiete': [-20.66, -43.78],
  'ouro branco': [-20.52, -43.69], 'mariana': [-20.38, -43.42],
  'vicosa': [-20.75, -42.88], 'ponte nova': [-20.41, -42.91],
  'rio pomba': [-21.27, -42.64], 'sao joao del rei': [-21.14, -44.26],
  'tres coracoes': [-21.70, -45.26], 'varginha': [-21.55, -45.43],
  'pouso alegre': [-22.23, -45.93], 'itajuba': [-22.43, -45.45],
  'lorena': [-22.73, -45.12], 'cachoeira paulista': [-22.68, -45.01],
  'guaratingueta': [-22.82, -45.19], 'aparecida': [-22.85, -45.23],
  'cruzeiro': [-22.58, -44.96], 'silveiras': [-22.66, -44.85],
  'lavrinhas': [-22.57, -44.90], 'queluz': [-22.54, -44.78],
  'itajubá': [-22.43, -45.45], 'delfim moreira': [-22.52, -45.28],
  'santa rita do sapucai': [-22.25, -45.70], 'pocos de caldas': [-21.79, -46.57],
  'andrelândia': [-21.74, -44.31], 'lima duarte': [-21.84, -43.80],
  'bom jardim de minas': [-21.97, -44.19], 'sao joao del-rei': [-21.14, -44.26],
  'tiradentes': [-21.11, -44.18], 'lagoa dourada': [-20.90, -44.01],
  'carandai': [-20.95, -43.81], 'senhora dos remedios': [-21.03, -43.56],
  'rio espera': [-20.85, -43.48], 'laticínio': [-20.85, -43.48],
}

const ESTADO_CENTRO = {
  'ac': [-9.02, -70.81], 'al': [-9.57, -36.55], 'ap': [0.03, -51.05], 'am': [-3.07, -61.66],
  'ba': [-12.96, -38.51], 'ce': [-3.73, -38.53], 'df': [-15.78, -47.92], 'es': [-20.29, -40.30],
  'go': [-16.64, -49.29], 'ma': [-2.54, -44.28], 'mt': [-15.61, -56.10], 'ms': [-20.46, -54.61],
  'mg': [-19.92, -43.94], 'pa': [-1.47, -48.49], 'pb': [-7.12, -34.88], 'pr': [-25.43, -49.27],
  'pe': [-8.05, -34.89], 'pi': [-5.09, -42.80], 'rj': [-22.91, -43.20], 'rn': [-5.80, -35.21],
  'rs': [-30.03, -51.23], 'ro': [-8.76, -63.90], 'rr': [2.82, -60.67], 'sc': [-27.60, -48.55],
  'sp': [-23.55, -46.63], 'se': [-10.91, -37.07], 'to': [-10.18, -48.33],
}

function norm(n) {
  return n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '').trim()
}

function cidadeCoords(cidade, estado) {
  if (!cidade) return null
  const match = CIDADE_COORDS[norm(cidade)]
  if (match) return match
  const uf = (estado || '').toLowerCase()
  return ESTADO_CENTRO[uf] || null
}

function hasAddr(e) {
  return !!(e?.rua && e?.cidade)
}

function fullAddr(e) {
  return [e.rua, e.numero, e.bairro, e.cidade, e.estado].filter(Boolean).join(', ')
}

function pinIcon(color = '#2563eb', size = 26) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:${Math.round(size*0.42)}px;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25);cursor:pointer;pointer-events:auto"><i class="fa-solid fa-user"></i></div>`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
    popupAnchor: [0, -(size/2+4)]
  })
}

const ROTA_CORES = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#8b5cf6', '#ec4899']

export default function MapView({ usuarios }) {
  const mapRef = useRef(null)
  const mapEl = useRef(null)
  const markers = useRef(null)
  const rotasLayer = useRef(null)
  const [pts, setPts] = useState([])
  const [sel, setSel] = useState(new Set())
  const [rotas, setRotas] = useState([])
  const [calcRota, setCalcRota] = useState(false)

  const users = useMemo(() => usuarios.filter(u => hasAddr(u.endereco || {})), [usuarios])

  useEffect(() => {
    if (mapEl.current) return
    const m = L.map(mapRef.current, { zoomControl: false }).setView([-21.5, -44.5], 7)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m)
    L.control.zoom({ position: 'topright' }).addTo(m)
    markers.current = L.layerGroup().addTo(m)
    rotasLayer.current = L.layerGroup().addTo(m)
    mapEl.current = m
    return () => { m.remove(); mapEl.current = null }
  }, [])

  useEffect(() => {
    if (!mapEl.current || !users.length) return
    const m = mapEl.current
    const g = markers.current
    g.clearLayers()

    const items = []
    const bounds = L.latLngBounds()
    let hasBounds = false

    for (const u of users) {
      const id = u.telefone || u.id
      const e = u.endereco || {}
      const coords = cidadeCoords(e.cidade, e.estado)
      if (!coords) continue

      items.push({ id, user: u, coords })

      const isSel = sel.has(id)
      const mk = L.marker(coords, { icon: pinIcon(isSel ? '#dc2626' : '#2563eb', isSel ? 30 : 26) })
      mk.bindPopup(`
        <div style="font-size:12px;line-height:1.5">
          <b>${u.nome || u.pushName || '—'}</b><br/>
          <span style="color:#666">${u.telefone || ''}</span><br/>
          <span style="color:#888;font-size:11px">${fullAddr(e)}</span>
        </div>
      `)
      mk.on('click', () => {
        setSel(prev => {
          const n = new Set(prev)
          n.has(id) ? n.delete(id) : n.add(id)
          return n
        })
      })
      mk.addTo(g)
      bounds.extend(coords)
      hasBounds = true
    }

    setPts(items)
    if (hasBounds) m.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 })
  }, [users, sel])

  useEffect(() => {
    if (!mapEl.current) return
    const g = rotasLayer.current
    g.clearLayers()
    rotas.forEach((coords, i) => {
      const c = ROTA_CORES[i % ROTA_CORES.length]
      L.polyline(coords, { color: c, weight: 4, opacity: 0.6 }).addTo(g)
      const s = coords[0], e = coords[coords.length-1]
      L.marker(s, { icon: L.divIcon({ className: '', html: `<div style="background:#16a34a;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:9px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.2)"><i class="fa-solid fa-play"></i></div>`, iconSize: [18,18], iconAnchor: [9,9] }) }).addTo(g)
      L.marker(e, { icon: L.divIcon({ className: '', html: `<div style="background:#dc2626;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:9px;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.2)"><i class="fa-solid fa-flag-checkered"></i></div>`, iconSize: [18,18], iconAnchor: [9,9] }) }).addTo(g)
    })
  }, [rotas])

  const tracarRota = useCallback(async () => {
    const selected = pts.filter(p => sel.has(p.id))
    if (selected.length < 2) return
    setCalcRota(true)
    try {
      const str = selected.map(p => `${p.coords[1]},${p.coords[0]}`).join(';')
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${str}?overview=full&geometries=geojson`)
      const d = await r.json()
      if (d.code === 'Ok' && d.routes?.length > 0) {
        setRotas(d.routes.map(r => r.geometry.coordinates.map(c => [c[1], c[0]])))
      }
    } catch {}
    setCalcRota(false)
  }, [pts, sel])

  const toggleSel = (id) => {
    setSel(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  return (
    <div className="mv">
      <div className="mv-top">
        <div>
          <div className="mv-title"><i className="fa-solid fa-map"></i> Mapa de Usuários</div>
          <div className="mv-sub">{users.length} usuários · {pts.length} no mapa · {sel.size} selecionados</div>
        </div>
        <div className="mv-actions">
          {sel.size >= 2 && (
            <button className="mbtn mbtn-red" disabled={calcRota} onClick={tracarRota}>
              <i className={`fa-solid ${calcRota ? 'fa-spinner fa-spin' : 'fa-route'}`}></i> Traçar Rota
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
        <div className="mv-list-header">
          <i className="fa-solid fa-list"></i> Usuários no mapa
          <span className="mv-list-count">{sel.size} selecionados</span>
        </div>
        <div className="mv-list-body">
          {pts.map(p => {
            const isSel = sel.has(p.id)
            return (
              <div key={p.id} className={`mv-item ${isSel ? 'sel' : ''}`} onClick={() => toggleSel(p.id)} onDblClick={() => mapEl.current?.setView(p.coords, 15)}>
                <div className="mv-av" style={{ background: isSel ? '#dc2626' : '#2563eb' }}><i className="fa-solid fa-user"></i></div>
                <div className="mv-info">
                  <b>{p.user.nome || p.user.pushName || '—'}</b>
                  <span>{fullAddr(p.user.endereco || {})}</span>
                </div>
              </div>
            )
          })}
          {pts.length === 0 && <div className="mv-empty">Nenhum usuário com endereço completo</div>}
        </div>
      </div>
    </div>
  )
}
