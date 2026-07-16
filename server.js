import express from 'express'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zncuyrimrkzbidvxyonk.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuY3V5cmltcmt6Ymlkdnh5b25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NTMzOTksImV4cCI6MjA5OTMyOTM5OX0.gJ_NxaMO7fTpxwdFNNU4Phnn9E4qtOlyaMGugryL1iE'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const app = express()
app.use(express.json())

app.post('/api/criar-usuario', async (req, res) => {
  try {
    const body = req.body
    const dados = typeof body.dados === 'string' ? JSON.parse(body.dados) : (body.dados || {})

    const telefone = (body.telefone || '').replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '')
    if (!telefone) return res.status(400).json({ error: 'telefone é obrigatório' })

    const nome = dados.nome || body.nome || ''

    // Check if user already exists (to preserve existing password)
    const { data: existing } = await supabase.from('usuarios').select('endereco').eq('telefone', telefone).maybeSingle()
    const existingSenha = existing?.endereco?.senha || ''

    // Generate password: FirstName + last 4 digits of phone
    const primeiroNome = (nome.split(' ')[0] || '').trim()
    const ultimos4 = telefone.slice(-4)
    const senha = existingSenha || `${primeiroNome}${ultimos4}`

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
      senha
    }

    const { data, error } = await supabase
      .from('usuarios')
      .upsert({ telefone, nome, endereco }, { onConflict: 'telefone' })
      .select()
      .single()

    if (error) {
      console.error('Supabase error:', error)
      return res.status(500).json({ error: error.message })
    }

    const loginLink = `${process.env.BASE_URL || 'https://thsmdistribuidora.plugsales.app'}/?login=${Buffer.from(telefone).toString('base64')}`

    res.json({ success: true, usuario: data, senha_gerada: existingSenha ? false : true, loginLink })
  } catch (err) {
    console.error('Server error:', err)
    res.status(500).json({ error: err.message })
  }
})

app.use(express.static('dist'))

app.get('*', (_req, res) => {
  res.sendFile('index.html', { root: 'dist' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
