-- ═══════════════════════════════════════════════════════════
-- FumuGold V3 — Schema Additions
-- Executa DEPOIS do schema_v4.sql
-- Novas tabelas: fg_clinical_flows + fg_audit_logs
-- ═══════════════════════════════════════════════════════════

-- ── fg_clinical_flows ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS fg_clinical_flows (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flows_updated ON fg_clinical_flows(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_flows_state   ON fg_clinical_flows((data->>'state'));
CREATE INDEX IF NOT EXISTS idx_flows_patient ON fg_clinical_flows((data->>'patientId'));

CREATE OR REPLACE TRIGGER flows_updated_at
  BEFORE UPDATE ON fg_clinical_flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── fg_audit_logs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fg_audit_logs (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_updated  ON fg_audit_logs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON fg_audit_logs((data->>'action'));
CREATE INDEX IF NOT EXISTS idx_audit_user     ON fg_audit_logs((data->>'user'));
CREATE INDEX IF NOT EXISTS idx_audit_severity ON fg_audit_logs((data->>'severity'));

CREATE OR REPLACE TRIGGER audit_updated_at
  BEFORE UPDATE ON fg_audit_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS para novas tabelas ────────────────────────────────
DO $$
DECLARE tbl TEXT;
        tbls TEXT[] := ARRAY['fg_clinical_flows','fg_audit_logs'];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "rls_anon_read"  ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "rls_anon_write" ON %I', tbl);
    EXECUTE format('CREATE POLICY "rls_anon_read"  ON %I FOR SELECT TO anon, authenticated USING (true)', tbl);
    EXECUTE format('CREATE POLICY "rls_anon_write" ON %I FOR ALL    TO anon, authenticated USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;

-- ── View de auditoria: últimas 100 acções críticas ────────
CREATE OR REPLACE VIEW fg_audit_recent AS
SELECT
  id,
  data->>'action'    AS action,
  data->>'severity'  AS severity,
  data->>'user'      AS "user",
  data->>'ts'        AS ts,
  data->'details'    AS details
FROM fg_audit_logs
WHERE (data->>'severity') IN ('warn','error','critical')
ORDER BY updated_at DESC
LIMIT 100;

-- ── View de fluxo clínico activo ──────────────────────────
CREATE OR REPLACE VIEW fg_flow_active AS
SELECT
  id,
  data->>'patientName' AS patient,
  data->>'state'       AS state,
  data->>'priority'    AS priority,
  data->>'createdAt'   AS created_at,
  updated_at
FROM fg_clinical_flows
WHERE (data->>'state') NOT IN ('complete')
ORDER BY
  CASE data->>'priority'
    WHEN 'urgente' THEN 1
    WHEN 'alta'    THEN 2
    WHEN 'normal'  THEN 3
    ELSE 4
  END,
  updated_at ASC;

-- ── Limpeza automática de logs antigos (>90 dias) ─────────
-- Executar via cron job no Supabase ou manualmente:
-- DELETE FROM fg_audit_logs WHERE updated_at < NOW() - INTERVAL '90 days';

-- ── Verificação final ─────────────────────────────────────
SELECT table_name,
       pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('fg_clinical_flows', 'fg_audit_logs')
ORDER BY table_name;
