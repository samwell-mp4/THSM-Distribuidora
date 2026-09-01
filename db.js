import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// Parse Postgres bigint (int8) as JS number to avoid string/number ID mismatches
pg.types.setTypeParser(pg.types.builtins.INT8, (val) => parseInt(val, 10));
// Parse Postgres numeric as JS float
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (val) => parseFloat(val));

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:Sa03146555!@plug_sales_dispatch_app_thsm_distribuidora_postgress:5432/plug_sales_dispatch_app?sslmode=disable';

export const pool = new pg.Pool({
  connectionString
});

export async function initDb() {
  console.log('Initializing Postgres database...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Create pgcrypto and uuid-ossp to ensure gen_random_uuid is available
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    // 1. USUARIOS
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        telefone text UNIQUE NOT NULL,
        nome text NOT NULL,
        email text DEFAULT '',
        endereco jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now()
      )
    `);

    // 2. PEDIDOS
    await client.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id bigint PRIMARY KEY,
        user_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
        status text NOT NULL DEFAULT 'pendente',
        created_at timestamptz DEFAULT now(),
        data jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    
    // Indices for PEDIDOS
    await client.query('CREATE INDEX IF NOT EXISTS idx_pedidos_user_id ON pedidos(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_pedidos_created_at ON pedidos(created_at DESC)');

    // 3. FINANCEIRO
    await client.query(`
      CREATE TABLE IF NOT EXISTS financeiro (
        id text PRIMARY KEY,
        order_id bigint NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text DEFAULT 'pendente'
      )
    `);
    
    // Indices for FINANCEIRO
    await client.query('CREATE INDEX IF NOT EXISTS idx_financeiro_order_id ON financeiro(order_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_financeiro_status ON financeiro(status)');

    // 4. ROTAS_CONTATOS
    await client.query(`
      CREATE TABLE IF NOT EXISTS rotas_contatos (
        id serial PRIMARY KEY,
        rota text,
        cidade text,
        push_name text,
        remote_jid text,
        profile_picture text,
        created_at timestamptz DEFAULT now()
      )
    `);

    // 4b. ROTAS_EDITS
    await client.query(`
      CREATE TABLE IF NOT EXISTS rotas_edits (
        id bigint PRIMARY KEY,
        rota text NOT NULL DEFAULT '',
        acao text NOT NULL DEFAULT 'adicionar',
        contato jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now()
      )
    `);

    // 5. PRODUTOS
    await client.query(`
      CREATE TABLE IF NOT EXISTS produtos (
        id bigint PRIMARY KEY,
        nome text DEFAULT '',
        descricao text DEFAULT '',
        preco numeric(12,2),
        preco_custo numeric(12,2),
        estoque integer,
        imagem text,
        categoria text,
        variantes jsonb DEFAULT '{}'::jsonb,
        "semDevolucao" boolean DEFAULT false,
        deleted boolean DEFAULT false,
        updated_at timestamptz DEFAULT now()
      )
    `);

    // Safely check if column semdevolucao exists before altering to avoid aborting postgres transaction
    const colCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'produtos' AND column_name = 'semdevolucao'
    `);
    if (colCheck.rows && colCheck.rows.length > 0) {
      await client.query('ALTER TABLE produtos RENAME COLUMN semdevolucao TO "semDevolucao"');
      console.log('Renamed column semdevolucao to "semDevolucao" case-sensitive.');
    }

    // 5b. DESPESAS
    await client.query(`
      CREATE TABLE IF NOT EXISTS despesas (
        id bigint PRIMARY KEY,
        status text DEFAULT 'pendente',
        data jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_despesas_status ON despesas(status)');

    // 6. LOGIN TOKENS
    await client.query(`
      CREATE TABLE IF NOT EXISTS login_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        telefone text NOT NULL,
        token text UNIQUE NOT NULL,
        expires_at timestamptz NOT NULL,
        used boolean DEFAULT false,
        created_at timestamptz DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_login_tokens_token ON login_tokens(token)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_login_tokens_expires ON login_tokens(expires_at)');

    // 7. LEADS
    await client.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nome text NOT NULL,
        telefone text UNIQUE NOT NULL,
        email text DEFAULT '',
        endereco jsonb DEFAULT '{}'::jsonb,
        created_at timestamptz DEFAULT now()
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_leads_telefone ON leads(telefone)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC)');

    // 8. PRODUTOS DELETADOS (Tombstone Tracking Table)
    await client.query(`
      CREATE TABLE IF NOT EXISTS produtos_deletados (
        id bigint PRIMARY KEY,
        created_at timestamptz DEFAULT now()
      )
    `);

    // Migration: Move existing null/deleted products to produtos_deletados and clean them up
    await client.query(`
      INSERT INTO produtos_deletados (id)
      SELECT id FROM produtos WHERE deleted = true OR nome IS NULL OR nome = ''
      ON CONFLICT (id) DO NOTHING
    `);

    await client.query(`
      DELETE FROM produtos WHERE deleted = true OR nome IS NULL OR nome = ''
    `);

    // 9. FLUXO_WHATSAPP
    await client.query(`
      CREATE TABLE IF NOT EXISTS fluxo_whatsapp (
        id bigint PRIMARY KEY,
        telefone text,
        fluxo text,
        etapa text,
        ultima_pergunta text,
        concluido boolean DEFAULT false,
        dados jsonb DEFAULT '{}'::jsonb,
        criado_em timestamptz,
        atualizado_em timestamptz,
        ultima_interacao timestamptz
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_fluxo_whatsapp_telefone ON fluxo_whatsapp(telefone)');

    await importFluxoWhatsappCsv(client);

    // RLS: disable RLS since this is a trusted backend
    await client.query('ALTER TABLE usuarios DISABLE ROW LEVEL SECURITY');
    await client.query('ALTER TABLE pedidos DISABLE ROW LEVEL SECURITY');
    await client.query('ALTER TABLE financeiro DISABLE ROW LEVEL SECURITY');
    await client.query('ALTER TABLE rotas_contatos DISABLE ROW LEVEL SECURITY');
    await client.query('ALTER TABLE rotas_edits DISABLE ROW LEVEL SECURITY');
    await client.query('ALTER TABLE produtos DISABLE ROW LEVEL SECURITY');
    await client.query('ALTER TABLE despesas DISABLE ROW LEVEL SECURITY');
    await client.query('ALTER TABLE login_tokens DISABLE ROW LEVEL SECURITY');
    await client.query('ALTER TABLE leads DISABLE ROW LEVEL SECURITY');

    // Create Functions
    await client.query(`
      CREATE OR REPLACE FUNCTION admin_delete_order(ord_id bigint)
      RETURNS void
      AS $$
      BEGIN
        DELETE FROM financeiro WHERE order_id = ord_id;
        DELETE FROM pedidos WHERE id = ord_id;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION admin_delete_user(user_phone text)
      RETURNS text
      AS $$
      DECLARE
        uid uuid;
      BEGIN
        SELECT id INTO uid FROM usuarios WHERE telefone = user_phone;
        IF uid IS NULL THEN RETURN 'Usuario nao encontrado'; END IF;
        DELETE FROM financeiro WHERE order_id IN (SELECT id FROM pedidos WHERE user_id = uid);
        DELETE FROM pedidos WHERE user_id = uid;
        DELETE FROM usuarios WHERE id = uid;
        RETURN 'ok';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION admin_delete_products(product_ids bigint[])
      RETURNS void
      AS $$
      BEGIN
        DELETE FROM produtos WHERE id = ANY(product_ids);
        INSERT INTO produtos_deletados (id)
        SELECT DISTINCT id FROM unnest(product_ids) AS t(id)
        ON CONFLICT (id) DO NOTHING;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION sync_rotas_contatos(data jsonb)
      RETURNS void AS $$
      BEGIN
        DELETE FROM rotas_contatos;
        INSERT INTO rotas_contatos (rota, cidade, push_name, remote_jid, profile_picture)
        SELECT
          (item->>'rota')::text,
          (item->>'cidade')::text,
          (item->>'pushName')::text,
          (item->>'remoteJid')::text,
          (item->>'profilePicture')::text
        FROM jsonb_array_elements(data) AS item;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query('COMMIT');
    console.log('Database schema checked/created successfully.');
    await normalizeUserPhones(client);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to initialize database schema:', err.message);
  } finally {
    client.release();
  }
}

function cleanAndNormalizePhone(phone) {
  if (!phone) return ''
  let digits = String(phone).replace(/\D/g, '')
  if (!digits) return ''
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2)
  }
  if (digits.length === 10) {
    digits = digits.slice(0, 2) + '9' + digits.slice(2)
  }
  return '55' + digits
}

async function normalizeUserPhones(client) {
  console.log('Normalizing and deduplicating user phone numbers...');
  try {
    const { rows: users } = await client.query('SELECT id, telefone FROM usuarios');
    const toDelete = [];
    const toUpdatePhone = [];
    const phoneToUser = new Map();

    for (const user of users) {
      const originalPhone = user.telefone;
      const normalized = cleanAndNormalizePhone(originalPhone);
      if (!normalized) continue;

      const existingUser = phoneToUser.get(normalized);
      if (existingUser) {
        // Move orders referencing duplicate user to the main counterpart user
        await client.query('UPDATE pedidos SET user_id = $1 WHERE user_id = $2', [existingUser.id, user.id]);
        toDelete.push(user.id);
      } else {
        phoneToUser.set(normalized, user);
        if (originalPhone !== normalized) {
          toUpdatePhone.push({ id: user.id, normalized });
        }
      }
    }
    if (toDelete.length > 0) {
      await client.query('DELETE FROM usuarios WHERE id = ANY($1)', [toDelete]);
      console.log(`Deduplication: Deleted ${toDelete.length} duplicate user records.`);
    }
    for (const item of toUpdatePhone) {
      await client.query('UPDATE usuarios SET telefone = $1 WHERE id = $2', [item.normalized, item.id]);
    }
    if (toUpdatePhone.length > 0) {
      console.log(`Normalization: Updated ${toUpdatePhone.length} user phones with 55 and 9-digit DDD format.`);
    }
  } catch (err) {
    console.error('Failed to normalize user phones:', err.message);
  }
}

export async function executeQuery(queryDesc) {
  const { action, table, args, filters, orders, range, single, maybeSingle, count, head, name } = queryDesc;
  
  if (action === 'rpc') {
    const paramNames = Object.keys(args || {});
    const paramPlaceholders = paramNames.map((k, i) => `"${k}" => $${i + 1}`);
    const paramValues = paramNames.map(k => args[k]);
    const sql = `SELECT * FROM "${name}"(${paramPlaceholders.join(', ')})`;
    try {
      const res = await pool.query(sql, paramValues);
      let data = res.rows;
      if (res.rows.length === 1 && Object.keys(res.rows[0]).length === 1) {
        data = Object.values(res.rows[0])[0];
      }
      return { data, error: null };
    } catch (err) {
      console.error(`RPC error for ${name}:`, err.message);
      return { data: null, error: { message: err.message } };
    }
  }

  const formatColumn = (col) => {
    if (col.includes('->') || col.includes('->>')) {
      const match = col.match(/^([a-zA-Z0-9_]+)(.*)$/);
      if (match) {
        const base = match[1];
        const rest = match[2];
        const formattedRest = rest
          .replace(/->>([a-zA-Z0-9_]+)/g, "->>'$1'")
          .replace(/->([a-zA-Z0-9_]+)/g, "->'$1'");
        return `"${base}"${formattedRest}`;
      }
    }
    return `"${col}"`;
  };

  const values = [];
  const whereConds = [];

  const parseOrFilter = (orValue) => {
    const parts = orValue.split(',');
    const conds = [];
    for (const part of parts) {
      const match = part.match(/^([^.]+)\.([^.]+)\.(.*)$/);
      if (match) {
        const col = formatColumn(match[1]);
        const op = match[2];
        const val = match[3];
        if (op === 'eq') {
          values.push(val);
          conds.push(`${col} = $${values.length}`);
        } else if (op === 'ilike') {
          values.push(val);
          conds.push(`${col} ILIKE $${values.length}`);
        } else if (op === 'in') {
          const cleanVal = val.replace(/^\((.*)\)$/, '$1');
          const arrayVals = cleanVal.split('|');
          values.push(arrayVals);
          conds.push(`${col} = ANY($${values.length})`);
        }
      }
    }
    return conds.length ? `(${conds.join(' OR ')})` : null;
  };

  if (filters && filters.length > 0) {
    for (const f of filters) {
      if (f.type === 'eq') {
        const col = formatColumn(f.column);
        values.push(f.value);
        whereConds.push(`${col} = $${values.length}`);
      } else if (f.type === 'in') {
        const col = formatColumn(f.column);
        values.push(f.value);
        whereConds.push(`${col} = ANY($${values.length})`);
      } else if (f.type === 'ilike') {
        const col = formatColumn(f.column);
        values.push(f.value);
        whereConds.push(`${col} ILIKE $${values.length}`);
      } else if (f.type === 'or') {
        const orSql = parseOrFilter(f.value);
        if (orSql) whereConds.push(orSql);
      }
    }
  }

  const whereClause = whereConds.length ? `WHERE ${whereConds.join(' AND ')}` : '';

  try {
    if (action === 'select') {
      let selectCols = '*';
      if (args && args !== '*') {
        selectCols = args.split(',').map(c => formatColumn(c.trim())).join(', ');
      }

      let orderClause = '';
      if (orders && orders.length > 0) {
        const ords = orders.map(o => `${formatColumn(o.column)} ${o.ascending ? 'ASC' : 'DESC'}`);
        orderClause = `ORDER BY ${ords.join(', ')}`;
      }

      let limitOffsetClause = '';
      if (range) {
        const limit = range.to - range.from + 1;
        const offset = range.from;
        limitOffsetClause = `LIMIT ${limit} OFFSET ${offset}`;
      }

      let countVal = 0;
      if (count === 'exact') {
        const countSql = `SELECT COUNT(*) FROM "${table}" ${whereClause}`;
        const countRes = await pool.query(countSql, values);
        countVal = parseInt(countRes.rows[0].count, 10);
      }

      if (head) {
        return { data: [], count: countVal, error: null };
      }

      if (table === 'produtos') {
        const unionSql = `
          SELECT id, nome, descricao, preco, preco_custo, estoque, imagem, categoria, variantes, "semDevolucao", updated_at, false AS deleted
          FROM "produtos" ${whereClause}
          UNION ALL
          SELECT id, NULL::text, NULL::text, NULL::numeric, NULL::numeric, NULL::integer, NULL::text, NULL::text, NULL::jsonb, NULL::boolean, NULL::timestamptz, true AS deleted
          FROM "produtos_deletados"
          ${orderClause} ${limitOffsetClause}
        `;
        const res = await pool.query(unionSql, values);
        let data = res.rows;
        if (single) {
          if (data.length === 0) return { data: null, error: { message: 'Row not found' } };
          data = data[0];
        } else if (maybeSingle) {
          data = data.length > 0 ? data[0] : null;
        }
        return { data, count: data.length, error: null };
      }

      const sql = `SELECT ${selectCols} FROM "${table}" ${whereClause} ${orderClause} ${limitOffsetClause}`;
      const res = await pool.query(sql, values);
      let data = res.rows;
      if (single) {
        if (data.length === 0) {
          return { data: null, error: { message: 'Row not found' } };
        }
        data = data[0];
      } else if (maybeSingle) {
        data = data.length > 0 ? data[0] : null;
      }

      return { data, count: countVal, error: null };
    }

    if (action === 'insert') {
      const isArray = Array.isArray(args);
      const rows = isArray ? args : [args];
      if (rows.length === 0) {
        return { data: isArray ? [] : null, error: null };
      }

      const keys = Object.keys(rows[0]);
      const colsStr = keys.map(k => `"${k}"`).join(', ');

      const valuePlaceholders = [];
      for (const row of rows) {
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

      const sql = `INSERT INTO "${table}" (${colsStr}) VALUES ${valuePlaceholders.join(', ')} RETURNING *`;
      const res = await pool.query(sql, values);
      const data = isArray ? res.rows : res.rows[0];
      return { data, error: null };
    }

    if (action === 'upsert') {
      const inputValues = args.values;
      const options = args.options || {};
      const isArray = Array.isArray(inputValues);
      const rows = isArray ? inputValues : [inputValues];
      if (rows.length === 0) {
        return { data: isArray ? [] : null, error: null };
      }

      // Fast-path 1: Targeted UPDATE by primary key UUID "id" if present (prevents user cross-contamination)
      if (!isArray && inputValues.id) {
        const updateKeys = Object.keys(inputValues).filter(k => k !== 'id' && k !== 'created_at');
        if (updateKeys.length > 0) {
          const updateValues = [];
          const setPhrases = updateKeys.map((k, i) => {
            let val = inputValues[k];
            if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
            updateValues.push(val);
            return `"${k}" = $${i + 1}`;
          });
          updateValues.push(inputValues.id);
          const updateSql = `UPDATE "${table}" SET ${setPhrases.join(', ')} WHERE "id" = $${updateValues.length} RETURNING *;`;
          try {
            const updateRes = await pool.query(updateSql, updateValues);
            if (updateRes.rows && updateRes.rows.length > 0) {
              let data = updateRes.rows[0];
              if (single) data = Array.isArray(data) ? data[0] : data;
              return { data, error: null };
            }
          } catch (err) {
            console.error('Targeted UPDATE by ID error in upsert:', err.message);
          }
        }
      }

      // Fast-path 2: Targeted UPDATE by single normalized phone number if id is not present
      if (!isArray && options.onConflict === 'telefone' && inputValues.telefone && !inputValues.id) {
        const normTel = cleanAndNormalizePhone(inputValues.telefone);
        const updateKeys = Object.keys(inputValues).filter(k => k !== 'telefone' && k !== 'id' && k !== 'created_at');
        if (updateKeys.length > 0) {
          const updateValues = [];
          const setPhrases = updateKeys.map((k, i) => {
            let val = inputValues[k];
            if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
            updateValues.push(val);
            return `"${k}" = $${i + 1}`;
          });
          updateValues.push(normTel);
          const updateSql = `UPDATE "${table}" SET ${setPhrases.join(', ')} WHERE "telefone" = $${updateValues.length} RETURNING *;`;
          try {
            const updateRes = await pool.query(updateSql, updateValues);
            if (updateRes.rows && updateRes.rows.length > 0) {
              let data = updateRes.rows[0];
              if (single) data = Array.isArray(data) ? data[0] : data;
              return { data, error: null };
            }
          } catch (err) {
            console.error('Targeted UPDATE by phone error in upsert:', err.message);
          }
        }
      }


      const keys = Object.keys(rows[0]);
      const colsStr = keys.map(k => `"${k}"`).join(', ');

      const valuePlaceholders = [];
      for (const row of rows) {
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

      const conflictCol = options.onConflict || 'id';
      let onConflictClause = '';
      if (options.ignoreDuplicates) {
        onConflictClause = `ON CONFLICT ("${conflictCol}") DO NOTHING`;
      } else {
        const updateCols = keys.filter(k => k !== conflictCol && k !== 'id' && k !== 'created_at');
        if (updateCols.length > 0) {
          const updateSets = updateCols.map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');
          onConflictClause = `ON CONFLICT ("${conflictCol}") DO UPDATE SET ${updateSets}`;
        } else {
          onConflictClause = `ON CONFLICT ("${conflictCol}") DO NOTHING`;
        }
      }

      const sql = `INSERT INTO "${table}" (${colsStr}) VALUES ${valuePlaceholders.join(', ')} ${onConflictClause} RETURNING *`;
      const res = await pool.query(sql, values);
      let data = isArray ? res.rows : res.rows[0];
      
      if (!data || (isArray && data.length === 0)) {
        data = inputValues;
      }
      if (single) {
        data = Array.isArray(data) ? data[0] : data;
      }

      return { data, error: null };
    }

    if (action === 'update') {
      const keys = Object.keys(args);
      if (keys.length === 0) {
        return { data: null, error: { message: 'No columns to update' } };
      }

      const setPhrases = [];
      for (const key of keys) {
        let val = args[key];
        if (typeof val === 'object' && val !== null) {
          val = JSON.stringify(val);
        }
        values.push(val);
        setPhrases.push(`"${key}" = $${values.length}`);
      }

      const sql = `UPDATE "${table}" SET ${setPhrases.join(', ')} ${whereClause} RETURNING *`;
      const res = await pool.query(sql, values);
      return { data: res.rows, error: null };
    }

    if (action === 'delete') {
      const sql = `DELETE FROM "${table}" ${whereClause} RETURNING *`;
      const res = await pool.query(sql, values);
      if (table === 'produtos' && res.rows.length > 0) {
        const deletedIds = res.rows.map(r => r.id);
        await pool.query(
          `INSERT INTO "produtos_deletados" (id) SELECT DISTINCT id FROM unnest($1::bigint[]) ON CONFLICT DO NOTHING`,
          [deletedIds]
        );
      }
      return { data: res.rows, error: null };
    }

    return { data: null, error: { message: `Unsupported action: ${action}` } };
  } catch (err) {
    console.error(`Database error on table ${table}, action ${action}:`, err.message);
    return { data: null, error: { message: err.message, code: err.code } };
  }
}

export async function restoreDbData() {
  console.log('Restoring database from backups, purging existing tables...');
  
  // Clean all tables in reverse dependency order
  await pool.query('DELETE FROM financeiro');
  await pool.query('DELETE FROM pedidos');
  await pool.query('DELETE FROM usuarios');
  await pool.query('DELETE FROM rotas_contatos');
  await pool.query('DELETE FROM rotas_edits');
  await pool.query('DELETE FROM produtos');
  await pool.query('DELETE FROM produtos_deletados');
  await pool.query('DELETE FROM despesas');
  await pool.query('DELETE FROM login_tokens');
  await pool.query('DELETE FROM leads');

  const tables = [
    { name: 'usuarios', pkey: 'id' },
    { name: 'pedidos', pkey: 'id' },
    { name: 'financeiro', pkey: 'id' },
    { name: 'rotas_contatos', pkey: 'id' },
    { name: 'rotas_edits', pkey: 'id' },
    { name: 'produtos', pkey: 'id' },
    { name: 'despesas', pkey: 'id' },
    { name: 'login_tokens', pkey: 'id' },
    { name: 'leads', pkey: 'id' }
  ];

  const results = [];
  for (const table of tables) {
    const filePath = path.join('scratch', 'backup', `${table.name}.json`);
    try {
      await fs.access(filePath);
    } catch {
      results.push(`Table "${table.name}": no backup file found.`);
      continue;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    let rows = JSON.parse(content);
    if (rows.length === 0) {
      results.push(`Table "${table.name}": 0 rows to restore.`);
      continue;
    }

    // Normalize rows keys (e.g. semdevolucao -> "semDevolucao")
    rows = rows.map(row => {
      const normalized = {};
      for (const k of Object.keys(row)) {
        if (k === 'semdevolucao') {
          normalized['semDevolucao'] = row[k];
        } else {
          normalized[k] = row[k];
        }
      }
      return normalized;
    });

    const CHUNK_SIZE = 100;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
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

      const updateCols = keys.filter(k => k !== table.pkey);
      let onConflict = '';
      if (updateCols.length > 0) {
        const updateSets = updateCols.map(k => `"${k}" = EXCLUDED."${k}"`).join(', ');
        onConflict = `ON CONFLICT ("${table.pkey}") DO UPDATE SET ${updateSets}`;
      } else {
        onConflict = `ON CONFLICT ("${table.pkey}") DO NOTHING`;
      }

      const sql = `INSERT INTO "${table.name}" (${colsStr}) VALUES ${valuePlaceholders.join(', ')} ${onConflict}`;
      await pool.query(sql, values);
    }
    results.push(`Table "${table.name}": successfully restored ${rows.length} rows.`);
  }
  return results;
}

export async function importFluxoWhatsappCsv(clientArg) {
  const csvPath = path.resolve('fluxo_whatsapp.csv');
  try {
    const exists = await fs.access(csvPath).then(() => true).catch(() => false);
    if (!exists) {
      console.log('fluxo_whatsapp.csv not found, skipping CSV import.');
      return;
    }

    const client = clientArg || pool;
    const content = await fs.readFile(csvPath, 'utf8');
    const lines = content.split(/\r?\n/);
    if (lines.length <= 1) return;

    console.log(`Importing ${lines.length - 1} records from fluxo_whatsapp.csv...`);
    let count = 0;
    let currentLine = '';

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      currentLine += (currentLine ? '\n' : '') + line;
      const quoteCount = (currentLine.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) continue;

      const cols = [];
      let inQuotes = false;
      let field = '';
      for (let j = 0; j < currentLine.length; j++) {
        const char = currentLine[j];
        if (char === '"') {
          if (inQuotes && currentLine[j + 1] === '"') {
            field += '"';
            j++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          cols.push(field);
          field = '';
        } else {
          field += char;
        }
      }
      cols.push(field);
      currentLine = '';

      if (cols.length >= 10) {
        const id = parseInt(cols[0], 10);
        if (isNaN(id)) continue;
        const telefone = cols[1]?.trim() || '';
        const fluxo = cols[2]?.trim() || '';
        const etapa = cols[3]?.trim() || '';
        const ultima_pergunta = cols[4]?.trim() || '';
        const concluido = cols[5]?.trim() === 'true';
        let dados = '{}';
        try {
          if (cols[6]?.trim()) {
            JSON.parse(cols[6].trim());
            dados = cols[6].trim();
          }
        } catch {}
        const criado_em = cols[7]?.trim() || null;
        const atualizado_em = cols[8]?.trim() || null;
        const ultima_interacao = cols[9]?.trim() || null;

        await client.query(`
          INSERT INTO fluxo_whatsapp (id, telefone, fluxo, etapa, ultima_pergunta, concluido, dados, criado_em, atualizado_em, ultima_interacao)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO UPDATE SET
            telefone = EXCLUDED.telefone,
            fluxo = EXCLUDED.fluxo,
            etapa = EXCLUDED.etapa,
            ultima_pergunta = EXCLUDED.ultima_pergunta,
            concluido = EXCLUDED.concluido,
            dados = EXCLUDED.dados,
            criado_em = EXCLUDED.criado_em,
            atualizado_em = EXCLUDED.atualizado_em,
            ultima_interacao = EXCLUDED.ultima_interacao
        `, [id, telefone, fluxo, etapa, ultima_pergunta, concluido, dados, criado_em, atualizado_em, ultima_interacao]);
        count++;
      }
    }
    console.log(`Imported/Updated ${count} rows into fluxo_whatsapp table.`);
  } catch (err) {
    console.error('Error importing fluxo_whatsapp.csv:', err.message);
  }
}
