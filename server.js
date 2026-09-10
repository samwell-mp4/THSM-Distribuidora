import express from 'express'
import fs from 'fs'
import path from 'path'
import { initDb, executeQuery, restoreDbData, pool, reconcileOrdersUsersDb, recoverMissingProductPrices } from './db.js'

// Initialize database schema
initDb().catch(err => console.error('Database initialization error:', err));

const app = express()
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

// Image static serving and upstream proxy fallback
const FOTOS_DIR = path.resolve('public/fotos')
if (!fs.existsSync(FOTOS_DIR)) {
  fs.mkdirSync(FOTOS_DIR, { recursive: true })
}

const handleImageRequest = async (req, res) => {
  try {
    const filename = req.params.filename
    if (!filename || !/^[a-zA-Z0-9_\-\.]+$/.test(filename)) {
      return res.status(400).send('Invalid image name')
    }

    const localFile = path.join(FOTOS_DIR, filename)

    // 1. Return from disk if present
    if (fs.existsSync(localFile)) {
      const stat = fs.statSync(localFile)
      if (stat.size > 200) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.setHeader('Content-Type', filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg')
        return fs.createReadStream(localFile).pipe(res)
      }
    }

    // 2. Fetch upstream from Minha Rota with required Referer
    const upstreamUrl = `https://thsmdistribuidora.minharota.net/controller/fotos/${filename}`
    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        'Referer': 'https://thsmdistribuidora.minharota.net/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).send('Imagem não encontrada')
    }

    const contentType = upstreamRes.headers.get('content-type') || (filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg')
    const buffer = Buffer.from(await upstreamRes.arrayBuffer())

    if (buffer.length > 200) {
      fs.writeFile(localFile, buffer, (err) => {
        if (err) console.error('Error caching image to public/fotos:', err)
      })
      // Also write to dist/fotos if dist exists
      const distFile = path.resolve('dist/fotos', filename)
      if (fs.existsSync(path.resolve('dist/fotos'))) {
        fs.writeFile(distFile, buffer, () => {})
      }
    }

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('Content-Type', contentType)
    res.send(buffer)
  } catch (err) {
    console.error('Image proxy error:', err.message)
    res.status(502).send('Error retrieving image')
  }
}

app.get('/fotos/:filename', handleImageRequest)
app.get('/api/foto/:filename', handleImageRequest)
app.get('/controller/fotos/:filename', handleImageRequest)


// GET API endpoint for fluxo_whatsapp (PostgREST / Supabase REST compatibility & API endpoint)
const handleFluxoWhatsappQuery = async (req, res) => {
  try {
    let rawPhone = req.query.telefone || req.query.phone || ''
    if (typeof rawPhone === 'string' && rawPhone.startsWith('eq.')) {
      rawPhone = rawPhone.slice(3)
    }

    const cleanDigits = String(rawPhone || '').replace(/\D/g, '')
    const normPhone = cleanDigits ? (cleanDigits.startsWith('55') ? cleanDigits : '55' + cleanDigits) : ''
    const rawNo55 = cleanDigits ? cleanDigits.replace(/^55/, '') : ''

    let sql = 'SELECT * FROM "fluxo_whatsapp"'
    const params = []

    if (rawPhone) {
      params.push(
        String(rawPhone),
        `${String(rawPhone).replace(/@.*$/, '')}@s.whatsapp.net`,
        normPhone,
        `${normPhone}@s.whatsapp.net`,
        rawNo55,
        `${rawNo55}@s.whatsapp.net`
      )
      sql += ' WHERE "telefone" = $1 OR "telefone" = $2 OR "telefone" = $3 OR "telefone" = $4 OR "telefone" = $5 OR "telefone" = $6'
    }

    sql += ' ORDER BY "id" DESC LIMIT 50'
    const result = await pool.query(sql, params.length ? params : undefined)
    res.json(result.rows || [])
  } catch (err) {
    console.error('Error querying fluxo_whatsapp:', err.message)
    res.status(500).json({ error: err.message })
  }
}

app.get('/rest/v1/fluxo_whatsapp', handleFluxoWhatsappQuery)
app.get('/api/fluxo_whatsapp', handleFluxoWhatsappQuery)

// Trigger database restore from local JSON backups
app.get('/api/restore-db', async (req, res) => {
  try {
    const results = await restoreDbData()
    res.json({ success: true, results })
  } catch (err) {
    console.error('API /api/restore-db error:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

// Endpoint to reconcile orders missing user_id
app.all('/api/reconcile-orders', async (req, res) => {
  try {
    const result = await reconcileOrdersUsersDb()
    res.json({ success: true, result })
  } catch (err) {
    console.error('API /api/reconcile-orders error:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

// Endpoint to recover missing product prices from order history
app.all('/api/recover-prices', async (req, res) => {
  try {
    const result = await recoverMissingProductPrices()
    res.json({ success: true, result })
  } catch (err) {
    console.error('API /api/recover-prices error:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

// Temporary test endpoint to inspect database rows
app.get('/api/test-db', async (req, res) => {
  try {
    const result = await executeQuery({ action: 'select', table: 'produtos' })
    const sample = result.data.filter(p => !p.nome || p.deleted)
    res.json({ total: result.data.length, sample: sample.slice(0, 10) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DB Query Proxy Endpoint
app.post('/api/db', async (req, res) => {
  try {
    const result = await executeQuery(req.body)
    if (result.error) {
      return res.status(400).json(result)
    }
    res.json(result)
  } catch (err) {
    console.error('API /api/db error:', err.message)
    res.status(500).json({ data: null, error: { message: err.message } })
  }
})

// Create user endpoint (WhatsApp Bot Integration)
app.post('/api/criar-usuario', async (req, res) => {
  try {
    const body = req.body
    const dados = typeof body.dados === 'string' ? JSON.parse(body.dados) : (body.dados || {})

    let rawPhone = (body.telefone || '').replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '')
    if (!rawPhone) return res.status(400).json({ error: 'telefone é obrigatório' })
    if (rawPhone.startsWith('55') && (rawPhone.length === 12 || rawPhone.length === 13)) rawPhone = rawPhone.slice(2)
    if (rawPhone.length === 10) rawPhone = rawPhone.slice(0, 2) + '9' + rawPhone.slice(2)
    const telefone = '55' + rawPhone

    const nome = dados.nome || body.nome || ''

    // Check if user already exists (to preserve existing password)
    const { data: existing } = await executeQuery({
      action: 'select',
      table: 'usuarios',
      args: 'endereco',
      filters: [{ type: 'eq', column: 'telefone', value: telefone }],
      maybeSingle: true
    })
    const existingSenha = existing?.endereco?.senha || ''

    // Generate password: padrao unico 1234
    const senha = existingSenha || '1234'

    const endereco = {
      ...(existing?.endereco || {}),
      rua: dados.logradouro || dados.rua || '',
      numero: dados.numero || '',
      bairro: dados.bairro || '',
      cidade: dados.cidade || '',
      estado: dados.estado || '',
      cep: dados.cep || '',
      revende: dados.revende || '',
      trabalha_fora: dados.trabalha_fora || '',
      horario_trabalho: dados.horario_trabalho || '',
      origem: existing?.endereco?.origem || 'BOT',
      senha
    }

    const { data, error } = await executeQuery({
      action: 'upsert',
      table: 'usuarios',
      args: {
        values: { telefone, nome, endereco },
        options: { onConflict: 'telefone' }
      },
      single: true
    })

    if (error) {
      console.error('DB error during user creation:', error.message)
      return res.status(500).json({ error: error.message })
    }

    const loginLink = `https://thsmdistribuidora.com/?login=${Buffer.from(telefone).toString('base64')}`

    res.json({ success: true, usuario: data, senha_gerada: existingSenha ? false : true, loginLink })
  } catch (err) {
    console.error('Server error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.use(express.static('dist'))

// Express Error Handling Middleware to catch aborted requests gracefully
app.use((err, req, res, next) => {
  if (err && (err.type === 'request.aborted' || err.code === 'ECONNABORTED' || err.message?.includes('aborted'))) {
    // Client aborted request before completion; ignore gracefully without logging noise
    return
  }
  if (err) {
    console.error('Express error:', err.message || err)
    if (!res.headersSent) {
      res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' })
    }
  } else {
    next()
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
