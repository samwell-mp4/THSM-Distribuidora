import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zncuyrimrkzbidvxyonk.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuY3V5cmltcmt6Ymlkdnh5b25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NTMzOTksImV4cCI6MjA5OTMyOTM5OX0.gJ_NxaMO7fTpxwdFNNU4Phnn9E4qtOlyaMGugryL1iE'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function run() {
  let allUsers = []
  let offset = 0
  while (true) {
    const { data } = await supabase.from('usuarios').select('*').range(offset, offset + 999)
    if (!data || data.length === 0) break
    allUsers.push(...data)
    offset += 1000
  }
  console.log('Total users fetched:', allUsers.length)
  let count = 0;
  for (const u of allUsers) {
    if (u.endereco?.senha !== '1234') {
      const newEndereco = { ...(u.endereco || {}), senha: '1234' }
      await supabase.from('usuarios').update({ endereco: newEndereco }).eq('telefone', u.telefone)
      count++
    }
  }
  console.log(`Updated ${count} users.`)
}

run()
