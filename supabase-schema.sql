-- =============================================
-- THSM DISTRIBUIDORA — Supabase Schema
-- =============================================

-- 1. USUARIOS
CREATE TABLE IF NOT EXISTS usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone text UNIQUE NOT NULL,
  nome text NOT NULL,
  email text DEFAULT '',
  endereco jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- 2. PEDIDOS
CREATE TABLE IF NOT EXISTS pedidos (
  id bigint PRIMARY KEY,
  user_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pendente',
  created_at timestamptz DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pedidos_user_id ON pedidos(user_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_pedidos_created_at ON pedidos(created_at DESC);

-- 3. FINANCEIRO
CREATE TABLE IF NOT EXISTS financeiro (
  id text PRIMARY KEY,
  order_id bigint NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text DEFAULT 'pendente'
);

CREATE INDEX IF NOT EXISTS idx_financeiro_order_id ON financeiro(order_id);
CREATE INDEX IF NOT EXISTS idx_financeiro_status ON financeiro(status);

-- 4. ROTAS_CONTATOS (from webhook)
CREATE TABLE IF NOT EXISTS rotas_contatos (
  id serial PRIMARY KEY,
  rota text,
  cidade text,
  push_name text,
  remote_jid text,
  profile_picture text,
  created_at timestamptz DEFAULT now()
);

-- 5. PRODUTOS (overrides for static catalog + new products)
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
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE produtos ADD COLUMN IF NOT EXISTS nome text DEFAULT '';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS descricao text DEFAULT '';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS variantes jsonb DEFAULT '{}'::jsonb;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_custo numeric(12,2);
ALTER TABLE produtos ALTER COLUMN id TYPE bigint;

-- 5b. DESPESAS (expense records)
CREATE TABLE IF NOT EXISTS despesas (
  id bigint PRIMARY KEY,
  status text DEFAULT 'pendente',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_despesas_status ON despesas(status);

-- 6. LOGIN TOKENS (for auto-login links)
CREATE TABLE IF NOT EXISTS login_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone text NOT NULL,
  token text UNIQUE NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_tokens_token ON login_tokens(token);
CREATE INDEX IF NOT EXISTS idx_login_tokens_expires ON login_tokens(expires_at);

-- 7. LEADS (site registrations from landing page)
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  telefone text UNIQUE NOT NULL,
  email text DEFAULT '',
  endereco jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_telefone ON leads(telefone);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at DESC);

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE financeiro ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotas_contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE despesas ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

-- Helper: sets app config for RLS (renamed to avoid conflict with PG built-in)
CREATE OR REPLACE FUNCTION app_set_config(key text, value text)
RETURNS void AS $$
BEGIN
  PERFORM set_config(key, value, true);
END;
$$ LANGUAGE plpgsql;

-- Admin: delete order bypassing RLS
CREATE OR REPLACE FUNCTION admin_delete_order(ord_id bigint)
RETURNS void
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM financeiro WHERE order_id = ord_id;
  DELETE FROM pedidos WHERE id = ord_id;
END;
$$ LANGUAGE plpgsql;

-- Admin: delete user by phone (with orders and financial)
CREATE OR REPLACE FUNCTION admin_delete_user(user_phone text)
RETURNS text
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  deleted integer;
BEGIN
  SELECT id INTO uid FROM usuarios WHERE telefone = user_phone;
  IF uid IS NULL THEN RETURN 'Usuario nao encontrado'; END IF;
  DELETE FROM financeiro WHERE order_id IN (SELECT id FROM pedidos WHERE user_id = uid);
  DELETE FROM pedidos WHERE user_id = uid;
  DELETE FROM usuarios WHERE id = uid;
  RETURN 'ok';
END;
$$ LANGUAGE plpgsql;

-- Users: read own, admin reads all
DROP POLICY IF EXISTS "Usuarios select own" ON usuarios;
CREATE POLICY "Usuarios select own" ON usuarios
  FOR SELECT USING (
    telefone = COALESCE(nullif(current_setting('app.user_phone', true), ''), 'nobody')
    OR current_setting('app.is_admin', true) = 'true'
  );

DROP POLICY IF EXISTS "Usuarios insert" ON usuarios;
CREATE POLICY "Usuarios insert" ON usuarios
  FOR INSERT WITH CHECK (true);

-- Pedidos: user sees own, admin sees all
DROP POLICY IF EXISTS "Pedidos select own" ON pedidos;
CREATE POLICY "Pedidos select own" ON pedidos
  FOR SELECT USING (
    user_id IN (SELECT id FROM usuarios WHERE telefone = COALESCE(nullif(current_setting('app.user_phone', true), ''), 'nobody'))
    OR current_setting('app.is_admin', true) = 'true'
  );

DROP POLICY IF EXISTS "Pedidos insert" ON pedidos;
CREATE POLICY "Pedidos insert" ON pedidos
  FOR INSERT WITH CHECK (
    current_setting('app.is_admin', true) = 'true'
    OR user_id IN (SELECT id FROM usuarios WHERE telefone = COALESCE(nullif(current_setting('app.user_phone', true), ''), 'nobody'))
  );

DROP POLICY IF EXISTS "Pedidos update" ON pedidos;
CREATE POLICY "Pedidos update" ON pedidos
  FOR UPDATE USING (current_setting('app.is_admin', true) = 'true');

-- Financeiro: user sees own, admin sees all
DROP POLICY IF EXISTS "Financeiro select own" ON financeiro;
CREATE POLICY "Financeiro select own" ON financeiro
  FOR SELECT USING (
    order_id IN (SELECT id FROM pedidos WHERE user_id IN (SELECT id FROM usuarios WHERE telefone = COALESCE(nullif(current_setting('app.user_phone', true), ''), 'nobody')))
    OR current_setting('app.is_admin', true) = 'true'
  );

DROP POLICY IF EXISTS "Financeiro insert" ON financeiro;
CREATE POLICY "Financeiro insert" ON financeiro
  FOR INSERT WITH CHECK (current_setting('app.is_admin', true) = 'true');

DROP POLICY IF EXISTS "Financeiro update" ON financeiro;
CREATE POLICY "Financeiro update" ON financeiro
  FOR UPDATE USING (current_setting('app.is_admin', true) = 'true');

DROP POLICY IF EXISTS "Financeiro delete" ON financeiro;
CREATE POLICY "Financeiro delete" ON financeiro
  FOR DELETE USING (current_setting('app.is_admin', true) = 'true');

-- Rotas: admin only
DROP POLICY IF EXISTS "Rotas admin all" ON rotas_contatos;
CREATE POLICY "Rotas admin all" ON rotas_contatos
  FOR ALL USING (current_setting('app.is_admin', true) = 'true');

DROP POLICY IF EXISTS "Rotas select all" ON rotas_contatos;
CREATE POLICY "Rotas select all" ON rotas_contatos
  FOR SELECT USING (true);

-- Produtos: all can read, admin writes
DROP POLICY IF EXISTS "Produtos select all" ON produtos;
CREATE POLICY "Produtos select all" ON produtos
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Produtos admin all" ON produtos;
CREATE POLICY "Produtos admin all" ON produtos
  FOR ALL USING (current_setting('app.is_admin', true) = 'true');

-- Despesas: admin only (full access)
DROP POLICY IF EXISTS "Despesas select admin" ON despesas;
CREATE POLICY "Despesas select admin" ON despesas
  FOR SELECT USING (current_setting('app.is_admin', true) = 'true');

DROP POLICY IF EXISTS "Despesas insert admin" ON despesas;
CREATE POLICY "Despesas insert admin" ON despesas
  FOR INSERT WITH CHECK (current_setting('app.is_admin', true) = 'true');

DROP POLICY IF EXISTS "Despesas update admin" ON despesas;
CREATE POLICY "Despesas update admin" ON despesas
  FOR UPDATE USING (current_setting('app.is_admin', true) = 'true');

DROP POLICY IF EXISTS "Despesas delete admin" ON despesas;
CREATE POLICY "Despesas delete admin" ON despesas
  FOR DELETE USING (current_setting('app.is_admin', true) = 'true');

-- Login tokens: anon can insert (recovery flow), select/update by token only
DROP POLICY IF EXISTS "Login tokens insert" ON login_tokens;
CREATE POLICY "Login tokens insert" ON login_tokens
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Login tokens select" ON login_tokens;
CREATE POLICY "Login tokens select" ON login_tokens
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Login tokens update" ON login_tokens;
CREATE POLICY "Login tokens update" ON login_tokens
  FOR UPDATE USING (true);

-- Leads: anon can insert, admin can select all
DROP POLICY IF EXISTS "Leads insert" ON leads;
CREATE POLICY "Leads insert" ON leads
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Leads select" ON leads;
CREATE POLICY "Leads select" ON leads
  FOR SELECT USING (current_setting('app.is_admin', true) = 'true');

-- =============================================
-- FUNCTION: sync contatos from webhook
-- =============================================
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
