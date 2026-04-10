// ═══════════════════════════════════════════════════════════
// FUMUGOLD — Audit Log & Security v3.0
// Regista todas as acções críticas
// Local (localStorage) + Supabase (quando disponível)
// RLS validation helper
// ═══════════════════════════════════════════════════════════

const AUDIT_KEY    = 'fg_audit_log';
const MAX_LOCAL    = 500;
let   _sessionId   = null;
let   _currentUser = null;

import { getClinicId } from './multi_clinic.js';

// B12-FIX: leitura no top-level — try/catch em import.meta.env não funciona em Vite
const _ENV_SUPA_URL = import.meta.env.VITE_SUPABASE_URL       || '';
const _ENV_SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY  || '';

// ── Tipos de acções rastreadas ────────────────────────────
export const AUDIT_ACTIONS = {
  // Auth
  LOGIN:         'AUTH:LOGIN',
  LOGOUT:        'AUTH:LOGOUT',
  LOGIN_FAIL:    'AUTH:LOGIN_FAIL',
  // Pacientes
  PATIENT_VIEW:  'PATIENT:VIEW',
  PATIENT_CREATE:'PATIENT:CREATE',
  PATIENT_EDIT:  'PATIENT:EDIT',
  PATIENT_DELETE:'PATIENT:DELETE',
  APPOINTMENT_CREATE: 'APPOINTMENT:CREATE',
  APPOINTMENT_EDIT:   'APPOINTMENT:EDIT',
  APPOINTMENT_DELETE: 'APPOINTMENT:DELETE',
  PRESCRIPTION_CREATE: 'PRESCRIPTION:CREATE',
  PRESCRIPTION_EDIT:   'PRESCRIPTION:EDIT',
  PRESCRIPTION_DELETE: 'PRESCRIPTION:DELETE',
  LAB_CREATE: 'LAB:CREATE',
  LAB_EDIT:   'LAB:EDIT',
  LAB_DELETE: 'LAB:DELETE',
  INVOICE_EDIT: 'BILLING:INVOICE_EDIT',
  INVOICE_VOID: 'BILLING:INVOICE_VOID',
  STOCK_ADJUST: 'STOCK:ADJUST',
  // Facturas
  PAYMENT:       'BILLING:PAYMENT',
  PDF_EXPORT:    'BILLING:PDF_EXPORT',
  INVOICE_CREATE:'BILLING:INVOICE_CREATE',
  // ARIA
  ARIA_QUERY:    'ARIA:QUERY',
  // WhatsApp
  WA_REPLY:      'WA:REPLY',
  WA_RESOLVE:    'WA:RESOLVE',
  // Fluxo clínico
  FLOW_CREATE:   'FLOW:CREATE',
  FLOW_ADVANCE:  'FLOW:ADVANCE',
  // Configurações
  CONFIG_CHANGE: 'CONFIG:CHANGE',
  SUPA_SYNC:     'SUPA:SYNC',
  // Segurança
  RATE_LIMIT:    'SEC:RATE_LIMIT',
  INVALID_ACCESS:'SEC:INVALID_ACCESS',
};

// ── setCurrentUser ────────────────────────────────────────
export function setCurrentUser(user) {
  _currentUser = user;
  if (!_sessionId) _sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── logAction ─────────────────────────────────────────────
export async function logAction(action, details = {}, severity = 'info') {
  const entry = {
    id:        `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    action,
    severity,  // 'info' | 'warn' | 'error' | 'critical'
    user:      _currentUser?.user || _currentUser || 'unknown',
    sessionId: _sessionId || 'no-session',
    details:   { ...details, clinic_id: details.clinic_id ?? getClinicId() },
    ts:        new Date().toISOString(),
    ua:        navigator?.userAgent?.slice(0, 120) || '',
  };

  // Sempre guarda localmente (sem bloquear)
  _saveLocal(entry);

  // Sync Supabase assíncrono (sem bloquear UI)
  _syncToSupabase(entry).catch(() => {});

  // Log crítico também vai para console
  if (severity === 'critical' || severity === 'error') {
    console.error(`[AUDIT ${severity.toUpperCase()}]`, action, details);
  }

  return entry;
}

// ── getLogs ───────────────────────────────────────────────
export function getLogs(opts = {}) {
  const { action, severity, limit = 100, since = null } = opts;
  let logs = _loadLocal();

  if (action)   logs = logs.filter(l => l.action === action || l.action.startsWith(action));
  if (severity) logs = logs.filter(l => l.severity === severity);
  if (since)    logs = logs.filter(l => l.ts >= since);

  return logs.slice(0, limit);
}

// ── getSecurityAlerts ─────────────────────────────────────
export function getSecurityAlerts() {
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  return getLogs({ severity: 'critical', since })
    .concat(getLogs({ severity: 'error', since }))
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 20);
}

// ── Rate Limiter ──────────────────────────────────────────
const _rateCounts = {};

export function checkRateLimit(action, maxPerMinute = 10) {
  const key = `${action}_${Math.floor(Date.now() / 60000)}`;
  _rateCounts[key] = (_rateCounts[key] || 0) + 1;

  if (_rateCounts[key] > maxPerMinute) {
    logAction(AUDIT_ACTIONS.RATE_LIMIT, { action, count: _rateCounts[key] }, 'warn');
    return false; // bloqueado
  }
  return true; // permitido
}

// ── validateRLS ───────────────────────────────────────────
// Verifica se a anon key do Supabase consegue ler/escrever
export async function validateRLS() {
  const results = {};
  const tables  = ['fg_patients', 'fg_appointments', 'fg_invoices', 'fg_whatsapp_conversations', 'fg_stock_items', 'fg_audit_logs'];

  const url = _supabaseUrl();
  const key = _supabaseKey();
  if (!url || !key) return { ok: false, reason: 'Supabase não configurado' };

  for (const table of tables) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal:  AbortSignal.timeout(5000),
      });
      results[table] = { readable: res.ok || res.status === 200, status: res.status };
    } catch (e) {
      results[table] = { readable: false, error: e.message };
    }
  }

  const allOk = Object.values(results).every(r => r.readable);
  await logAction('SEC:RLS_CHECK', { results }, allOk ? 'info' : 'warn');

  return { ok: allOk, results };
}

// ── clearOldLogs ──────────────────────────────────────────
export function clearOldLogs(olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
  const logs   = _loadLocal().filter(l => l.ts >= cutoff);
  localStorage.setItem(AUDIT_KEY, JSON.stringify(logs));
  return logs.length;
}

// ── Helpers privados ──────────────────────────────────────
function _loadLocal() {
  try { return JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]'); } catch { return []; }
}

function _saveLocal(entry) {
  try {
    const logs    = _loadLocal();
    const updated = [entry, ...logs].slice(0, MAX_LOCAL);
    localStorage.setItem(AUDIT_KEY, JSON.stringify(updated));
  } catch { /* storage cheio */ }
}

async function _syncToSupabase(entry) {
  const url = _supabaseUrl();
  const key = _supabaseKey();
  if (!url || !key) return;

  try {
    await fetch(`${url.replace(/\/$/, '')}/rest/v1/fg_audit_logs`, {
      method:  'POST',
      headers: {
        apikey:         key,
        Authorization:  `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer:         'return=minimal',
      },
      body:   JSON.stringify({
        id:      entry.id,
        data:    entry,
        updated_at: entry.ts,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* silencioso — log local já feito */ }
}

// B12-FIX: usa constantes top-level com localStorage como fallback real
function _supabaseUrl() { return _ENV_SUPA_URL || localStorage.getItem('fg_supabase_url') || ''; }
function _supabaseKey() { return _ENV_SUPA_KEY || localStorage.getItem('fg_supabase_key') || ''; }
