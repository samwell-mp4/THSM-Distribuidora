-- =============================================
-- THSM DISTRIBUIDORA — RUN THIS IN SUPABASE SQL EDITOR
-- Fixes: (1) disable RLS so app writes work, (2) add missing variantes column
-- =============================================

-- 1. Add missing columns to produtos (safe, no-op if present)
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS nome text DEFAULT '';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS descricao text DEFAULT '';
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS variantes jsonb DEFAULT '{}'::jsonb;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS preco_custo numeric(12,2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS semDevolucao boolean DEFAULT false;
ALTER TABLE produtos ALTER COLUMN id TYPE bigint;

-- 2. Disable RLS on all tables (writes must work with the app's anon key)
ALTER TABLE usuarios DISABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos DISABLE ROW LEVEL SECURITY;
ALTER TABLE financeiro DISABLE ROW LEVEL SECURITY;
ALTER TABLE rotas_contatos DISABLE ROW LEVEL SECURITY;
ALTER TABLE produtos DISABLE ROW LEVEL SECURITY;
ALTER TABLE despesas DISABLE ROW LEVEL SECURITY;
ALTER TABLE login_tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE leads DISABLE ROW LEVEL SECURITY;

-- 3. Verify: should return the produtos columns including 'variantes'
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'produtos' ORDER BY ordinal_position;
