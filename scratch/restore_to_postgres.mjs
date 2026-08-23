import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:Sa03146555!@plug_sales_dispatch_app_thsm_distribuidora_postgress:5432/plug_sales_dispatch_app?sslmode=disable';

const pool = new pg.Pool({ connectionString });

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function restoreTable(table, pkey) {
  const filePath = path.join('scratch', 'backup', `${table}.json`);
  if (!(await fileExists(filePath))) {
    console.log(`Skipping table "${table}": backup file not found.`);
    return;
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const rows = JSON.parse(content);
  if (rows.length === 0) {
    console.log(`Table "${table}" has 0 records in backup. Skipping.`);
    return;
  }

  console.log(`Restoring ${rows.length} records into table "${table}"...`);

  // We will restore in chunks to avoid query parameter limit issues
  const CHUNK_SIZE = 100;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    
    // For each chunk, build a batch upsert query
    const keys = Object.keys(chunk[0]);
    const colsStr = keys.map(k => `"${k}"`).join(', ');
    
    const values = [];
    const valuePlaceholders = [];
    
    for (const row of chunk) {
      const placeholders = [];
      for (const key of keys) {
        let val = row[key];
        if (typeof val === 'object' && val !== null) {
          val = JSON.stringify(val);
        }
        values.push(val);
        placeholders.push(`$${values.length}`);
      }
      valuePlaceholders.push(`(${placeholders.join(', ')})`);
    }

    const updateCols = keys.filter(k => k !== pkey);
    let onConflict = '';
    if (updateCols.length > 0) {
      const updateSets = updateCols.map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');
      onConflict = `ON CONFLICT ("${pkey}") DO UPDATE SET ${updateSets}`;
    } else {
      onConflict = `ON CONFLICT ("${pkey}") DO NOTHING`;
    }

    const sql = `INSERT INTO "${table}" (${colsStr}) VALUES ${valuePlaceholders.join(', ')} ${onConflict}`;
    
    try {
      await pool.query(sql, values);
    } catch (err) {
      console.error(`Error inserting chunk in table "${table}" (offset ${i}):`, err.message);
      console.error('SQL query:', sql);
      throw err;
    }
  }
  console.log(`Successfully restored table "${table}".`);
}

async function run() {
  console.log('Testing connection to target database...');
  try {
    await pool.query('SELECT 1');
    console.log('Connection successful.');
  } catch (err) {
    console.error('Could not connect to target database. Verify credentials/network:', err.message);
    process.exit(1);
  }

  try {
    // Correct foreign-key order
    await restoreTable('usuarios', 'id');
    await restoreTable('pedidos', 'id');
    await restoreTable('financeiro', 'id');
    await restoreTable('rotas_contatos', 'id');
    await restoreTable('rotas_edits', 'id');
    await restoreTable('produtos', 'id');
    await restoreTable('despesas', 'id');
    await restoreTable('login_tokens', 'id');
    await restoreTable('leads', 'id');
    console.log('Database restore completed successfully!');
  } catch (err) {
    console.error('Restore failed:', err);
  } finally {
    await pool.end();
  }
}

run();
