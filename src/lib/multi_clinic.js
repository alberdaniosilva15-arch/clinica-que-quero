// ═══════════════════════════════════════════════════════════
// FUMUGOLD — Multi-Clínica v1.0
// Isolamento total por clinic_id em todas as operações
// RLS via Supabase Row-Level Security
// Zero impacto no V3 visual
// ═══════════════════════════════════════════════════════════
import { fetchFromSupabase, patchSupabase } from '../supabase_sync.js';
// ── Constantes ────────────────────────────────────────────
const CLINIC_KEY    = 'fg_clinic_id';
const CLINIC_META   = 'fg_clinic_meta';
const SESSION_KEY   = 'fg_session';
const DEFAULT_CLINIC = 'clinic_default';

// ── getClinicId ───────────────────────────────────────────
// Obtém o clinic_id activo. Prioridade:
//   1. clinic_id injectado na sessão
//   2. localStorage directo
//   3. env var (para instalações single-tenant)
//   4. default
export function getClinicId() {
  try {
    // Da sessão activa
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const sess = JSON.parse(raw);
      if (sess?.clinic_id) return sess.clinic_id;
    }
    // Directo
    const direct = localStorage.getItem(CLINIC_KEY);
    if (direct) return direct;
  } catch {}

  // Env var (para plataforma SaaS)
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CLINIC_ID)
      return import.meta.env.VITE_CLINIC_ID;
  } catch {}

  return DEFAULT_CLINIC;
}

// ── setClinicId ───────────────────────────────────────────
export function setClinicId(id) {
  try { localStorage.setItem(CLINIC_KEY, id); return true; } catch { return false; }
}

// ── getClinicMeta ─────────────────────────────────────────
export function getClinicMeta() {
  try {
    return JSON.parse(localStorage.getItem(CLINIC_META) || 'null') || {
      id:      getClinicId(),
      name:    'FumuGold Clínica',
      city:    'Luanda',
      country: 'Angola',
      phone:   '',
      email:   '',
      nif:     '',
      logo:    null,
    };
  } catch { return null; }
}

export function setClinicMeta(meta) {
  try { localStorage.setItem(CLINIC_META, JSON.stringify({ ...getClinicMeta(), ...meta })); return true; } catch { return false; }
}

// ── withClinicId ──────────────────────────────────────────
// Wrapper: adiciona clinic_id a qualquer objecto
export function withClinicId(obj) {
  return { ...obj, clinic_id: getClinicId() };
}

// ── filterByClinic ────────────────────────────────────────
// Filtra array de registos pelo clinic_id activo
export function filterByClinic(arr) {
  const cid = getClinicId();
  if (!arr?.length) return [];
  // Se nenhum registo tem clinic_id, assume que são todos da clínica local (migração)
  const hasClinics = arr.some(r => r.clinic_id);
  if (!hasClinics) return arr;
  return arr.filter(r => !r.clinic_id || r.clinic_id === cid);
}

// ── isolatedStorageGet / Set ──────────────────────────────
// Wrap do window.storage com prefixo clinic_id
// Garante que dados de clínicas diferentes não se misturam
export async function isolatedGet(key) {
  const cid = getClinicId();
  const prefixed = `${cid}:${key}`;
  try {
    const r = await window.storage.get(prefixed);
    // Fallback: tenta sem prefixo (dados migrados da versão anterior)
    if (!r) return window.storage.get(key);
    return r;
  } catch { return null; }
}

export async function isolatedSet(key, value) {
  const cid = getClinicId();
  const prefixed = `${cid}:${key}`;
  try { return window.storage.set(prefixed, value); } catch { return null; }
}

// ── Supabase: headers com clinic_id ──────────────────────
export function clinicHeaders(baseHeaders = {}) {
  return {
    ...baseHeaders,
    'X-Clinic-ID': getClinicId(),  // Usado pelo n8n e backend
  };
}

// ── fetchClinicData ───────────────────────────────────────
// Leitura do Supabase com filtro clinic_id automático
export async function fetchClinicData(table, opts = {}) {
  // B1-FIX: path corrigido de './supabase_sync.js' para '../supabase_sync.js'
  // dynamic import removed
  if (!fetchFromSupabase) return [];

  const cid = getClinicId();
  const clinicFilter = cid !== DEFAULT_CLINIC
    ? [{ col: 'data->>clinic_id', op: 'eq', val: cid }, ...(opts.filters || [])]
    : (opts.filters || []);

  return fetchFromSupabase(table, { ...opts, filters: clinicFilter });
}

// ── migrateLocalData ──────────────────────────────────────
// Adiciona clinic_id a dados locais que não têm
// Chamado uma vez quando se configura multi-clínica
export function migrateLocalData() {
  const cid = getClinicId();
  const keys = [
    'clinic_patients', 'clinic_appointments', 'clinic_labResults',
    'clinic_prescriptions', 'clinic_invoices', 'clinic_beds',
    'clinic_staff', 'clinic_messages', 'clinic_surgeries',
    'clinic_stock',
  ];

  let migrated = 0;
  keys.forEach(key => {
    try {
      const raw  = localStorage.getItem(key);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return;

      const updated = data.map(item => {
        if (item.clinic_id) return item;
        migrated++;
        return { ...item, clinic_id: cid };
      });

      localStorage.setItem(key, JSON.stringify(updated));
    } catch {}
  });

  console.info(`[FumuGold] Migração multi-clínica: ${migrated} registos actualizados com clinic_id="${cid}"`);
  return migrated;
}

// ── listClinics ───────────────────────────────────────────
// Para plataformas SaaS — lista clínicas do Supabase
export async function listClinics() {
  try {
    // dynamic import removed
    return fetchFromSupabase('fg_clinics', {
      select: 'id,data',
      orderBy: { col: 'updated_at', asc: false },
      limit: 50,
    });
  } catch { return []; }
}

// ── createClinic ──────────────────────────────────────────
export async function createClinic(meta) {
  const id = `clinic_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const clinic = { id, ...meta, createdAt: new Date().toISOString() };

  try {
    // B1-FIX: path corrigido
    // dynamic import removed
    await patchSupabase('fg_clinics', { col: 'id', op: 'eq', val: id }, {
      id,
      data: clinic,
      updated_at: new Date().toISOString(),
    });
  } catch {}

  return clinic;
}

// ── installClinicInterceptor ──────────────────────────────
// Intercepta o window.storage do V3 para isolar por clínica
// Instalado ANTES do render em main.jsx
export function installClinicInterceptor() {
  if (typeof window === 'undefined' || window._fg_clinic_interceptor) return;
  window._fg_clinic_interceptor = true;

  const CLINIC_KEYS = [
    'clinic_patients', 'clinic_appointments', 'clinic_labResults',
    'clinic_prescriptions', 'clinic_invoices', 'clinic_beds',
    'clinic_staff', 'clinic_messages', 'clinic_surgeries',
    'clinic_notifications', 'clinic_integrations', 'clinic_stock',
  ];

  const cid = getClinicId();
  if (cid === DEFAULT_CLINIC) {
    console.info('[FumuGold] Multi-clínica: modo single-tenant (clinic_default)');
    return;
  }

  // Patch window.storage para prefixar keys de dados clínicos
  const origGet = window.storage.get.bind(window.storage);
  const origSet = window.storage.set.bind(window.storage);

  window.storage.get = async (key) => {
    const targetKey = CLINIC_KEYS.includes(key) ? `${cid}:${key}` : key;
    const result = await origGet(targetKey);
    // Fallback sem prefixo para dados migrados
    if (!result && CLINIC_KEYS.includes(key)) return origGet(key);
    return result;
  };

  window.storage.set = async (key, value) => {
    const targetKey = CLINIC_KEYS.includes(key) ? `${cid}:${key}` : key;
    return origSet(targetKey, value);
  };

  console.info(`[FumuGold] Multi-clínica activo — clinic_id: "${cid}"`);
}
