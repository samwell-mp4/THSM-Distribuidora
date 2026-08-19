import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zncuyrimrkzbidvxyonk.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuY3V5cmltcmt6Ymlkdnh5b25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NTMzOTksImV4cCI6MjA5OTMyOTM5OX0.gJ_NxaMO7fTpxwdFNNU4Phnn9E4qtOlyaMGugryL1iE'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function run() {
  const { data: users, error } = await supabase.from('usuarios').select('*')
  if (error) {
    console.error('Error fetching users:', error)
    return
  }
  console.log(`Found ${users.length} users. Phones:`, users.slice(0, 5).map(u => u.telefone))

  for (const u of users) {
    const newEndereco = { ...(u.endereco || {}), senha: '1234' }
    const { error: updateError } = await supabase.from('usuarios').update({ endereco: newEndereco }).eq('telefone', u.telefone)
    if (updateError) {
      console.error(`Error updating user ${u.telefone}:`, updateError)
    }
  }
  console.log('Finished updating passwords.')
}

run()
