import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://zncuyrimrkzbidvxyonk.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuY3V5cmltcmt6Ymlkdnh5b25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NTMzOTksImV4cCI6MjA5OTMyOTM5OX0.gJ_NxaMO7fTpxwdFNNU4Phnn9E4qtOlyaMGugryL1iE'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function run() {
  const tel = '5532999921819'
  const user_id = 'af6f4dbf-226b-4624-bd47-b47809865474'
  
  const { data, error } = await supabase.from('pedidos').select('*').or(`user_id.eq.${user_id},data->customer->>telefone.eq.${tel}`)
  console.log('Orders by OR:', data?.length, error)
}
run()
