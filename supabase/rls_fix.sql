-- Extensões
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Função auto-timestamp (se não existir)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── Tabela de perfis (liga Supabase Auth → clínica) ───────
CREATE TABLE IF NOT EXISTS fg_user_profiles (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL DEFAULT 'staff',
  clinic_id  TEXT        NOT NULL DEFAULT 'clinic_default',
  nome       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER fg_user_profiles_ts
  BEFORE UPDATE ON fg_user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE fg_user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_own"        ON fg_user_profiles;
DROP POLICY IF EXISTS "profile_admin"      ON fg_user_profiles;

CREATE POLICY "profile_own" ON fg_user_profiles
  FOR ALL TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profile_admin" ON fg_user_profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM fg_user_profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin','director')
    )
  );

-- ── Funções auxiliares (usadas pelas políticas RLS) ───────
CREATE OR REPLACE FUNCTION fg_my_clinic()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT clinic_id FROM fg_user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION fg_my_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM fg_user_profiles WHERE id = auth.uid();
$$;

-- ── RLS em todas as tabelas clínicas ──────────────────────
DO $$
DECLARE
  tbl TEXT;
  tbls TEXT[] := ARRAY[
    'fg_patients','fg_appointments','fg_lab_results','fg_prescriptions',
    'fg_invoices','fg_beds','fg_staff','fg_messages','fg_surgeries',
    'fg_notifications','fg_whatsapp_conversations','fg_ehr_records',
    'fg_clinical_flows','fg_audit_logs','fg_stock_items','fg_clinics'
  ];
BEGIN
  FOREACH tbl IN ARRAY tbls LOOP

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "rls_clinic_select"  ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "rls_clinic_insert"  ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "rls_clinic_update"  ON %I', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "rls_clinic_delete"  ON %I', tbl);

    EXECUTE format(
      $q$CREATE POLICY "rls_clinic_select" ON %I
         FOR SELECT TO authenticated
         USING (
           (data->>'clinic_id') = fg_my_clinic()
           OR fg_my_role() IN ('admin','director')
         )$q$,
      tbl
    );

    EXECUTE format(
      $q$CREATE POLICY "rls_clinic_insert" ON %I
         FOR INSERT TO authenticated
         WITH CHECK (
           (data->>'clinic_id') = fg_my_clinic()
         )$q$,
      tbl
    );

    EXECUTE format(
      $q$CREATE POLICY "rls_clinic_update" ON %I
         FOR UPDATE TO authenticated
         USING ((data->>'clinic_id') = fg_my_clinic())
         WITH CHECK ((data->>'clinic_id') = fg_my_clinic())$q$,
      tbl
    );

    EXECUTE format(
      $q$CREATE POLICY "rls_clinic_delete" ON %I
         FOR DELETE TO authenticated
         USING (
           (data->>'clinic_id') = fg_my_clinic()
           AND fg_my_role() IN ('admin','director')
         )$q$,
      tbl
    );

  END LOOP;
END $$;

-- ── Trigger: auto-criar perfil quando utilizador é criado ─
CREATE OR REPLACE FUNCTION fg_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO fg_user_profiles (id, role, clinic_id, nome)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role',      'staff'),
    COALESCE(NEW.raw_user_meta_data->>'clinic_id', 'clinic_default'),
    COALESCE(NEW.raw_user_meta_data->>'nome',      split_part(NEW.email,'@',1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION fg_handle_new_user();