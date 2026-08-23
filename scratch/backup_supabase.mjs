import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';

const SUPABASE_URL = 'https://zncuyrimrkzbidvxyonk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuY3V5cmltcmt6Ymlkdnh5b25rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NTMzOTksImV4cCI6MjA5OTMyOTM5OX0.gJ_NxaMO7fTpxwdFNNU4Phnn9E4qtOlyaMGugryL1iE';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLES = [
  'usuarios',
  'pedidos',
  'financeiro',
  'rotas_contatos',
  'rotas_edits',
  'produtos',
  'despesas',
  'login_tokens',
  'leads'
];

async function fetchAll(table) {
  let all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    console.log(`  Fetching ${table} (offset: ${offset})...`);
    const { data, error } = await supabase.from(table).select('*').range(offset, offset + limit - 1);
    if (error) {
      console.error(`Error fetching ${table}:`, error);
      throw error;
    }
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < limit) break;
    offset += limit;
  }
  return all;
}

async function run() {
  const backupDir = path.join('scratch', 'backup');
  await fs.mkdir(backupDir, { recursive: true });

  console.log('Starting full database backup from Supabase...');
  for (const table of TABLES) {
    try {
      const data = await fetchAll(table);
      const filePath = path.join(backupDir, `${table}.json`);
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`Saved ${data.length} records from table "${table}" to ${filePath}`);
    } catch (err) {
      console.error(`Failed to back up table "${table}":`, err);
    }
  }
  console.log('Backup process completed.');
}

run().catch(console.error);
