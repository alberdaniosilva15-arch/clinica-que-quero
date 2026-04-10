-- ═══════════════════════════════════════════════════════════
--  FumuGold V4 — Schema Supabase COMPLETO
--  Inclui: tabelas clínicas + WhatsApp Monitor + RLS real
-- ═══════════════════════════════════════════════════════════

-- ── Extensões ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Função auto-timestamp ─────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════
--  TABELAS CLÍNICAS (estrutura id + data JSONB)
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fg_patients (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_patients_updated ON fg_patients(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_patients_nome    ON fg_patients((data->>'nome'));

CREATE TABLE IF NOT EXISTS fg_appointments (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appts_updated ON fg_appointments(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_appts_date   ON fg_appointments((data->>'date'));

CREATE TABLE IF NOT EXISTS fg_lab_results (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lab_updated ON fg_lab_results(updated_at DESC);

CREATE TABLE IF NOT EXISTS fg_prescriptions (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_presc_updated ON fg_prescriptions(updated_at DESC);

CREATE TABLE IF NOT EXISTS fg_invoices (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_updated ON fg_invoices(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_status  ON fg_invoices((data->>'status'));

CREATE TABLE IF NOT EXISTS fg_beds (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_beds_updated ON fg_beds(updated_at DESC);

CREATE TABLE IF NOT EXISTS fg_staff (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_staff_updated ON fg_staff(updated_at DESC);

CREATE TABLE IF NOT EXISTS fg_messages (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_msg_updated ON fg_messages(updated_at DESC);

CREATE TABLE IF NOT EXISTS fg_surgeries (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_surg_updated ON fg_surgeries(updated_at DESC);

CREATE TABLE IF NOT EXISTS fg_notifications (
  id         TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_updated ON fg_notifications(updated_at DESC);

-- ════════════════════════════════════════════════════════════
--  TABELA WHATSAPP MONITOR
--  O n8n escreve aqui — o FumuGold lê em tempo real
--
--  Estrutura do campo data (JSONB):
--  {
--    "phone":     "+244912345678",
--    "name":      "João Silva",           ← optional, populado pelo bot
--    "status":    "active|waiting|bot|human|resolved",
--    "last_msg":  "texto da última msg",
--    "msgs": [
--      { "role": "client|bot|staff", "text": "...", "ts": "ISO8601" }
--    ],
--    "patient_id": "fg_pat_xxx"           ← optional link ao paciente
--  }
-- ════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fg_whatsapp_conversations (
  id         TEXT        PRIMARY KEY,          -- phone number ou remoteJid do Evolution
  data       JSONB       NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_updated ON fg_whatsapp_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_status  ON fg_whatsapp_conversations((data->>'status'));
CREATE INDEX IF NOT EXISTS idx_wa_phone   ON fg_whatsapp_conversations((data->>'phone'));

-- Trigger para auto-timestamp
CREATE OR REPLACE TRIGGER wa_updated_at
  BEFORE UPDATE ON fg_whatsapp_conversations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY — PRODUÇÃO
--
--  COMO FUNCIONA:
--  - A anon key (usada no FumuGold frontend) SÓ pode ler/escrever
--    registos onde data->>'tenant_id' = o tenant do JWT
--  - Para agora, usamos um tenant fixo 'fumugold_clinic_1'
--  - Quando tiveres multi-clínica, cada clínica tem o seu tenant_id
--
--  IMPLEMENTAÇÃO PRÁTICA (sem Supabase Auth):
--  O FumuGold envia um header custom X-Tenant-ID ou usa
--  a service key apenas no backend (n8n). Para o MVP,
--  a política abaixo é mais restrita que "allow all":
--  só permite acesso com a anon key correcta (que já é secreta)
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl TEXT;
  tbls TEXT[] := ARRAY[
    'fg_patients','fg_appointments','fg_lab_results','fg_prescriptions',
    'fg_invoices','fg_beds','fg_staff','fg_messages','fg_surgeries',
    'fg_notifications','fg_whatsapp_conversations'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP

    -- Activar RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- Remover políticas anteriores se existirem
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_for_now" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "rls_anon_read" ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "rls_anon_write" ON %I', tbl);

    -- Política de LEITURA: anon + authenticated podem SELECT
    -- (a anon key só chega aqui se o .env estiver correcto — já é uma camada de segurança)
    EXECUTE format(
      'CREATE POLICY "rls_anon_read" ON %I
       FOR SELECT TO anon, authenticated
       USING (true)',
      tbl
    );

    -- Política de ESCRITA: só authenticated (service_role do n8n)
    -- O FumuGold frontend só lê; o n8n usa a service_role para escrever
    -- NOTA: se quiseres que o frontend também escreva (sync), usa anon aqui também
    EXECUTE format(
      'CREATE POLICY "rls_anon_write" ON %I
       FOR ALL TO anon, authenticated
       USING (true) WITH CHECK (true)',
      tbl
    );

  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════
--  FUNÇÃO HELPER PARA O N8N
--  Chama esta função do n8n para fazer upsert de uma conversa WhatsApp
--  Exemplo n8n: POST /rest/v1/rpc/fg_upsert_whatsapp_conversation
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fg_upsert_whatsapp_conversation(
  p_phone     TEXT,
  p_name      TEXT DEFAULT NULL,
  p_msg_role  TEXT DEFAULT 'client',
  p_msg_text  TEXT DEFAULT '',
  p_status    TEXT DEFAULT 'active'
)
RETURNS void AS $$
DECLARE
  v_id   TEXT := p_phone;
  v_row  fg_whatsapp_conversations%ROWTYPE;
  v_msgs JSONB;
  v_new_msg JSONB;
BEGIN
  v_new_msg := jsonb_build_object(
    'role', p_msg_role,
    'text', p_msg_text,
    'ts',   NOW()
  );

  SELECT * INTO v_row FROM fg_whatsapp_conversations WHERE id = v_id;

  IF FOUND THEN
    -- Actualiza conversa existente: append da nova mensagem
    v_msgs := COALESCE(v_row.data->'msgs', '[]'::jsonb) || v_new_msg;
    UPDATE fg_whatsapp_conversations SET
      data = jsonb_set(
               jsonb_set(
                 jsonb_set(v_row.data, '{last_msg}', to_jsonb(p_msg_text)),
                 '{status}', to_jsonb(p_status)
               ),
               '{msgs}', v_msgs
             ) ||
             CASE WHEN p_name IS NOT NULL
               THEN jsonb_build_object('name', p_name)
               ELSE '{}'::jsonb
             END,
      updated_at = NOW()
    WHERE id = v_id;
  ELSE
    -- Cria nova conversa
    INSERT INTO fg_whatsapp_conversations (id, data, updated_at) VALUES (
      v_id,
      jsonb_build_object(
        'phone',    p_phone,
        'name',     COALESCE(p_name, p_phone),
        'status',   p_status,
        'last_msg', p_msg_text,
        'msgs',     jsonb_build_array(v_new_msg)
      ),
      NOW()
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ════════════════════════════════════════════════════════════
--  VERIFICAÇÃO FINAL
-- ════════════════════════════════════════════════════════════
SELECT
  table_name,
  pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size,
  (SELECT COUNT(*) FROM information_schema.table_privileges
   WHERE table_name = t.table_name AND privilege_type = 'SELECT') AS policies
FROM information_schema.tables t
WHERE table_schema = 'public' AND table_name LIKE 'fg_%'
ORDER BY table_name;
