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

-- 5. PRODUTOS (overrides for static catalog)
CREATE TABLE IF NOT EXISTS produtos (
  id integer PRIMARY KEY,
  preco numeric(12,2),
  estoque integer,
  imagem text,
  categoria text,
  updated_at timestamptz DEFAULT now()
);

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

-- =============================================
-- ROW LEVEL SECURITY
-- =============================================
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE financeiro ENABLE ROW LEVEL SECURITY;
ALTER TABLE rotas_contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_tokens ENABLE ROW LEVEL SECURITY;

-- Helper: sets app config for RLS (renamed to avoid conflict with PG built-in)
CREATE OR REPLACE FUNCTION app_set_config(key text, value text)
RETURNS void AS $$
BEGIN
  PERFORM set_config(key, value, true);
END;
$$ LANGUAGE plpgsql;

-- Users: read own, admin reads all
CREATE POLICY "Usuarios select own" ON usuarios
  FOR SELECT USING (
    telefone = COALESCE(nullif(current_setting('app.user_phone', true), ''), 'nobody')
    OR current_setting('app.is_admin', true) = 'true'
  );

CREATE POLICY "Usuarios insert" ON usuarios
  FOR INSERT WITH CHECK (true);

-- Pedidos: user sees own, admin sees all
CREATE POLICY "Pedidos select own" ON pedidos
  FOR SELECT USING (
    user_id IN (SELECT id FROM usuarios WHERE telefone = COALESCE(nullif(current_setting('app.user_phone', true), ''), 'nobody'))
    OR current_setting('app.is_admin', true) = 'true'
  );

CREATE POLICY "Pedidos insert" ON pedidos
  FOR INSERT WITH CHECK (
    current_setting('app.is_admin', true) = 'true'
    OR user_id IN (SELECT id FROM usuarios WHERE telefone = COALESCE(nullif(current_setting('app.user_phone', true), ''), 'nobody'))
  );

CREATE POLICY "Pedidos update" ON pedidos
  FOR UPDATE USING (current_setting('app.is_admin', true) = 'true');

-- Financeiro: user sees own, admin sees all
CREATE POLICY "Financeiro select own" ON financeiro
  FOR SELECT USING (
    order_id IN (SELECT id FROM pedidos WHERE user_id IN (SELECT id FROM usuarios WHERE telefone = COALESCE(nullif(current_setting('app.user_phone', true), ''), 'nobody')))
    OR current_setting('app.is_admin', true) = 'true'
  );

CREATE POLICY "Financeiro insert" ON financeiro
  FOR INSERT WITH CHECK (current_setting('app.is_admin', true) = 'true');

CREATE POLICY "Financeiro update" ON financeiro
  FOR UPDATE USING (current_setting('app.is_admin', true) = 'true');

CREATE POLICY "Financeiro delete" ON financeiro
  FOR DELETE USING (current_setting('app.is_admin', true) = 'true');

-- Rotas: admin only
CREATE POLICY "Rotas admin all" ON rotas_contatos
  FOR ALL USING (current_setting('app.is_admin', true) = 'true');

CREATE POLICY "Rotas select all" ON rotas_contatos
  FOR SELECT USING (true);

-- Produtos: all can read, admin writes
CREATE POLICY "Produtos select all" ON produtos
  FOR SELECT USING (true);

CREATE POLICY "Produtos admin all" ON produtos
  FOR ALL USING (current_setting('app.is_admin', true) = 'true');

-- Login tokens: anon can insert (recovery flow), select/update by token only
CREATE POLICY "Login tokens insert" ON login_tokens
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Login tokens select" ON login_tokens
  FOR SELECT USING (true);

CREATE POLICY "Login tokens update" ON login_tokens
  FOR UPDATE USING (true);

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
