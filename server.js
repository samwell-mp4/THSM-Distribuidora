import express from 'express'
import { initDb, executeQuery, restoreDbData } from './db.js'

// Initialize database schema
initDb().catch(err => console.error('Database initialization error:', err));

const app = express()
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

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
