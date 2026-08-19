import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zncuyrimrkzbidvxyonk.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuY3V5cmltcmt6Ymlkdnh5b25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NTMzOTksImV4cCI6MjA5OTMyOTM5OX0.gJ_NxaMO7fTpxwdFNNU4Phnn9E4qtOlyaMGugryL1iE'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function run() {
  const tel = '5532999921819'
  console.log('Fetching user...')
  const { data: user } = await supabase.from('usuarios').select('id').eq('telefone', tel).single()
  console.log('User ID:', user?.id)
  
  if (user) {
    const { data: ordersById } = await supabase.from('pedidos').select('*').eq('user_id', user.id)
    console.log('Orders by user_id:', ordersById?.length)
  }

  // Find by json
  const { data: ordersByTel, error } = await supabase.from('pedidos').select('*').contains('data', { customer: { telefone: tel } })
  console.log('Orders by contains:', ordersByTel?.length, error)
  
  const { data: ordersByOr, error: err2 } = await supabase.from('pedidos').select('*').or(`user_id.eq.${user?.id || '0'}`)
  // Let's test if we can do an OR query with contains? No, OR doesn't support contains easily in supabase js.
}
run()
