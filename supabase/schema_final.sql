-- ═══════════════════════════════════════════════════════════
-- FumuGold — Schema Final COMPLETO
-- Multi-Clínica + EHR + Audit + WhatsApp
-- Executa este ficheiro no Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- ── Extensões ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Função auto-timestamp ─────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════
--  MULTI-CLÍNICA
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fg_clinics (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clinics_updated ON fg_clinics(updated_at DESC);

-- ════════════════════════════════════════════════════════════
--  TABELAS CLÍNICAS (clinic_id em todos os dados JSONB)
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE
  tbl  TEXT;
  tbls TEXT[] := ARRAY[
    'fg_patients','fg_appointments','fg_lab_results','fg_prescriptions',
    'fg_invoices','fg_beds','fg_staff','fg_messages','fg_surgeries','fg_notifications'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I (
        id         TEXT        PRIMARY KEY,
        data       JSONB       NOT NULL DEFAULT ''{}'',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )', tbl);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_updated ON %I(updated_at DESC)', tbl, tbl);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_clinic  ON %I((data->>''clinic_id''))', tbl, tbl);
    EXECUTE format('CREATE OR REPLACE TRIGGER %s_ts BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()', tbl, tbl);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════
--  WHATSAPP CONVERSATIONS
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fg_whatsapp_conversations (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_updated  ON fg_whatsapp_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_status   ON fg_whatsapp_conversations((data->>'status'));
CREATE INDEX IF NOT EXISTS idx_wa_clinic   ON fg_whatsapp_conversations((data->>'clinic_id'));
CREATE OR REPLACE TRIGGER wa_ts BEFORE UPDATE ON fg_whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════
--  EHR (Prontuário Electrónico)
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fg_ehr_records (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ehr_patient ON fg_ehr_records((data->>'patientId'));
CREATE INDEX IF NOT EXISTS idx_ehr_clinic  ON fg_ehr_records((data->>'clinic_id'));
CREATE INDEX IF NOT EXISTS idx_ehr_type    ON fg_ehr_records((data->>'type'));
CREATE INDEX IF NOT EXISTS idx_ehr_updated ON fg_ehr_records(updated_at DESC);
CREATE OR REPLACE TRIGGER ehr_ts BEFORE UPDATE ON fg_ehr_records FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════
--  FLUXO CLÍNICO
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fg_clinical_flows (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flows_state   ON fg_clinical_flows((data->>'state'));
CREATE INDEX IF NOT EXISTS idx_flows_patient ON fg_clinical_flows((data->>'patientId'));
CREATE INDEX IF NOT EXISTS idx_flows_clinic  ON fg_clinical_flows((data->>'clinic_id'));
CREATE INDEX IF NOT EXISTS idx_flows_updated ON fg_clinical_flows(updated_at DESC);
CREATE OR REPLACE TRIGGER flows_ts BEFORE UPDATE ON fg_clinical_flows FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════
--  AUDIT LOGS
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fg_audit_logs (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_action   ON fg_audit_logs((data->>'action'));
CREATE INDEX IF NOT EXISTS idx_audit_clinic   ON fg_audit_logs((data->>'clinic_id'));
CREATE INDEX IF NOT EXISTS idx_audit_severity ON fg_audit_logs((data->>'severity'));
CREATE INDEX IF NOT EXISTS idx_audit_updated  ON fg_audit_logs(updated_at DESC);
CREATE OR REPLACE TRIGGER audit_ts BEFORE UPDATE ON fg_audit_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY — MULTI-CLÍNICA
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE
  tbl  TEXT;
  tbls TEXT[] := ARRAY[
    'fg_clinics','fg_patients','fg_appointments','fg_lab_results','fg_prescriptions',
    'fg_invoices','fg_beds','fg_staff','fg_messages','fg_surgeries','fg_notifications',
    'fg_whatsapp_conversations','fg_ehr_records','fg_clinical_flows','fg_audit_logs'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "rls_read"  ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "rls_write" ON %I', tbl);

    -- Leitura: qualquer autenticado (a filtragem por clinic_id é no frontend)
    EXECUTE format(
      'CREATE POLICY "rls_read" ON %I FOR SELECT TO anon, authenticated USING (true)',
      tbl
    );

    -- Escrita: anon + authenticated (n8n usa service_role que bypassa RLS)
    EXECUTE format(
      'CREATE POLICY "rls_write" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      tbl
    );
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════
--  FUNÇÃO UPSERT WHATSAPP (para o n8n)
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fg_upsert_whatsapp_conversation(
  p_phone     TEXT,
  p_name      TEXT DEFAULT NULL,
  p_msg_role  TEXT DEFAULT 'client',
  p_msg_text  TEXT DEFAULT '',
  p_status    TEXT DEFAULT 'active',
  p_clinic_id TEXT DEFAULT 'clinic_default'
)
RETURNS void AS $$
DECLARE
  v_id      TEXT := p_phone;
  v_row     fg_whatsapp_conversations%ROWTYPE;
  v_msgs    JSONB;
  v_new_msg JSONB;
BEGIN
  v_new_msg := jsonb_build_object('role', p_msg_role, 'text', p_msg_text, 'ts', NOW());

  SELECT * INTO v_row FROM fg_whatsapp_conversations WHERE id = v_id;

  IF FOUND THEN
    v_msgs := COALESCE(v_row.data->'msgs', '[]'::jsonb) || v_new_msg;
    -- Limita a 200 mensagens por conversa
    IF jsonb_array_length(v_msgs) > 200 THEN
      v_msgs := (SELECT jsonb_agg(e) FROM (SELECT jsonb_array_elements(v_msgs) AS e LIMIT 200 OFFSET (jsonb_array_length(v_msgs) - 200)) t);
    END IF;
    UPDATE fg_whatsapp_conversations SET
      data = jsonb_set(
               jsonb_set(jsonb_set(v_row.data, '{last_msg}', to_jsonb(p_msg_text)), '{status}', to_jsonb(p_status)),
               '{msgs}', v_msgs
             ) || CASE WHEN p_name IS NOT NULL THEN jsonb_build_object('name', p_name) ELSE '{}'::jsonb END,
      updated_at = NOW()
    WHERE id = v_id;
  ELSE
    INSERT INTO fg_whatsapp_conversations (id, data, updated_at) VALUES (
      v_id,
      jsonb_build_object(
        'phone', p_phone, 'name', COALESCE(p_name, p_phone),
        'status', p_status, 'last_msg', p_msg_text,
        'clinic_id', p_clinic_id,
        'msgs', jsonb_build_array(v_new_msg)
      ),
      NOW()
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ════════════════════════════════════════════════════════════
--  VIEWS DE OPERAÇÃO
-- ════════════════════════════════════════════════════════════

-- Fluxo clínico activo por clínica
CREATE OR REPLACE VIEW fg_flow_active AS
SELECT
  id,
  data->>'clinic_id'   AS clinic_id,
  data->>'patientName' AS patient,
  data->>'state'       AS state,
  data->>'priority'    AS priority,
  updated_at
FROM fg_clinical_flows
WHERE (data->>'state') NOT IN ('complete')
ORDER BY
  CASE data->>'priority' WHEN 'urgente' THEN 1 WHEN 'alta' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
  updated_at ASC;

-- Alertas de auditoria recentes
CREATE OR REPLACE VIEW fg_audit_critical AS
SELECT
  id,
  data->>'clinic_id' AS clinic_id,
  data->>'action'    AS action,
  data->>'severity'  AS severity,
  data->>'user'      AS "user",
  data->>'ts'        AS ts
FROM fg_audit_logs
WHERE (data->>'severity') IN ('warn','error','critical')
ORDER BY updated_at DESC
LIMIT 200;

-- WhatsApp aguardando humano
CREATE OR REPLACE VIEW fg_wa_waiting AS
SELECT
  id AS phone,
  data->>'clinic_id'    AS clinic_id,
  data->>'name'         AS name,
  data->>'last_msg'     AS last_msg,
  data->>'status'       AS status,
  updated_at
FROM fg_whatsapp_conversations
WHERE data->>'status' IN ('waiting', 'active')
ORDER BY updated_at DESC;

-- ════════════════════════════════════════════════════════════
--  CRON: Limpeza automática (Supabase pg_cron — opcional)
-- ════════════════════════════════════════════════════════════
-- Activa pg_cron no Supabase Dashboard > Extensions se necessário
-- SELECT cron.schedule('cleanup-audit', '0 3 * * *',
--   'DELETE FROM fg_audit_logs WHERE updated_at < NOW() - INTERVAL ''90 days''');

-- ════════════════════════════════════════════════════════════
--  VERIFICAÇÃO FINAL
-- ════════════════════════════════════════════════════════════
SELECT
  table_name,
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size,
  (SELECT COUNT(*) FROM information_schema.policies WHERE table_name = t.table_name) AS rls_policies
FROM information_schema.tables t
WHERE table_schema = 'public' AND table_name LIKE 'fg_%'
ORDER BY table_name;
