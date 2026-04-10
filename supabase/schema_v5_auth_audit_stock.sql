-- ═══════════════════════════════════════════════════════════
-- FumuGold V5 — Auditoria remota + Stock (executar após schema_v4)
-- Inclui fg_audit_logs (se ainda não existir) + fg_stock_items
-- Auth: use Supabase Dashboard → Authentication; metadata opcional:
--   user_metadata: { "nome": "...", "role": "medico", "clinic_id": "clinic_xxx" }
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fg_audit_logs (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_updated  ON fg_audit_logs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON fg_audit_logs((data->>'action'));
CREATE INDEX IF NOT EXISTS idx_audit_user     ON fg_audit_logs((data->>'user'));
CREATE INDEX IF NOT EXISTS idx_audit_clinic   ON fg_audit_logs((data->>'clinic_id'));
CREATE INDEX IF NOT EXISTS idx_audit_severity ON fg_audit_logs((data->>'severity'));

CREATE TABLE IF NOT EXISTS fg_stock_items (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_updated ON fg_stock_items(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_clinic  ON fg_stock_items((data->>'clinic_id'));

-- RLS alinhado ao schema_v4 (ajustar quando migrar para auth.uid())
DO $$
DECLARE
  tbl TEXT;
  tbls TEXT[] := ARRAY['fg_audit_logs','fg_stock_items'];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "rls_anon_read" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "rls_anon_write" ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY "rls_anon_read" ON %I FOR SELECT TO anon, authenticated USING (true)',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "rls_anon_write" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      tbl
    );
  END LOOP;
END $$;
