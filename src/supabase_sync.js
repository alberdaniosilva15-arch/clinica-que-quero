// ═══════════════════════════════════════════════════════════
// FUMUGOLD — Supabase Sync v3.1  [CORRIGIDO]
// FIX E9:  patchSupabase — col usa URLSearchParams (não encodeURIComponent manual)
// FIX E10: upsertSupabase — novo helper POST + merge-duplicates
// FIX E11: fetchFromSupabase — URLSearchParams para todos os filtros
// FIX:     import.meta.env lido no top-level (constante Vite)
// ═══════════════════════════════════════════════════════════

import { getAccessTokenSync } from './lib/supabase_auth.js';

// Vite substitui import.meta.env.X em compile time — leitura segura no top-level
const _ENV_URL = import.meta.env.VITE_SUPABASE_URL       || '';
const _ENV_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY  || '';

function _tenantId() {
  try {
    return (
      localStorage.getItem('fg_clinic_id') ||
      (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CLINIC_ID) ||
      'clinic_default'
    );
  } catch {
    return 'clinic_default';
  }
}

function _bearer(anonKey) {
  const t = getAccessTokenSync();
  return t && String(t).length > 20 ? t : anonKey;
}

function _getCreds(overrides = {}) {
  return {
    supabaseUrl:     overrides.supabaseUrl     || _ENV_URL || localStorage.getItem('fg_supabase_url')    || '',
    supabaseAnonKey: overrides.supabaseAnonKey || _ENV_KEY || localStorage.getItem('fg_supabase_key')    || '',
  };
}

export async function probeSupabase(overrideCreds = {}) {
  const { supabaseUrl, supabaseAnonKey } = _getCreds(overrideCreds);
  if (!supabaseUrl || !supabaseAnonKey)
    return { ok: false, message: 'Credenciais não configuradas.', latency: null };

  const base = supabaseUrl.replace(/\/$/, '');
  try {
    const t0  = Date.now();
    const bearer = _bearer(supabaseAnonKey);
    const res = await fetch(`${base}/rest/v1/`, {
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${bearer}` },
      signal:  AbortSignal.timeout(8000),
    });
    const latency = Date.now() - t0;
    return res.ok || [200, 404].includes(res.status)
      ? { ok: true,  message: `✓ Supabase acessível · ${latency}ms`, latency }
      : { ok: false, message: `Supabase erro ${res.status}.`, latency };
  } catch (e) {
    return { ok: false, message: e.name.includes('bort') ? 'Timeout (>8s).' : `Erro: ${e.message}`, latency: null };
  }
}

export async function syncClinicToSupabase(credsIn = {}, data = {}) {
  const creds = { ..._getCreds(credsIn), ...credsIn };
  const { supabaseUrl, supabaseAnonKey, tableMap = {} } = creds;
  if (!supabaseUrl || !supabaseAnonKey)
    return { ok: false, message: 'Credenciais não configuradas.', synced: {}, errors: [], total: 0 };

  const base    = supabaseUrl.replace(/\/$/, '');
  const bearer  = _bearer(supabaseAnonKey);
  const tenant  = _tenantId();
  const headers = {
    apikey: supabaseAnonKey, Authorization: `Bearer ${bearer}`,
    'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  const DEFAULT_MAP = {
    patients:'fg_patients', appointments:'fg_appointments', labResults:'fg_lab_results',
    prescriptions:'fg_prescriptions', invoices:'fg_invoices', beds:'fg_beds',
    staff:'fg_staff', messages:'fg_messages', surgeries:'fg_surgeries', notifications:'fg_notifications',
    stock:'fg_stock_items',
  };
  const resolvedMap = { ...DEFAULT_MAP, ...tableMap };
  const synced = {}, errors = [];
  let total = 0;

  for (const [key, table] of Object.entries(resolvedMap)) {
    const raw = data[key];
    if (!Array.isArray(raw) || raw.length === 0) { synced[key] = 0; continue; }
    const rows = raw.map((item, idx) => ({
      id: String(item.id || `${key}_${idx}_${Date.now()}`),
      data: { ...item, clinic_id: item.clinic_id || tenant },
      updated_at: new Date().toISOString(),
    }));
    try {
      const res = await fetch(`${base}/rest/v1/${table}`, {
        method: 'POST', headers, body: JSON.stringify(rows), signal: AbortSignal.timeout(15000),
      });
      if (res.ok || [200,201,204].includes(res.status)) { synced[key] = rows.length; total += rows.length; }
      else { errors.push(`${key}→${table}: ${res.status}`); synced[key] = 0; }
    } catch (e) { errors.push(`${key}: ${e.message}`); synced[key] = 0; }
  }
  return {
    ok: errors.length === 0 && total > 0,
    message: errors.length === 0 && total > 0 ? `✓ ${total} registos` : errors.length > 0 ? `⚠ ${errors[0]}` : 'Sem dados.',
    synced, errors, total, timestamp: new Date().toISOString(),
  };
}

// FIX E11: URLSearchParams — não encodeURIComponent manual no col
export async function fetchFromSupabase(table, opts = {}) {
  const { supabaseUrl, supabaseAnonKey } = _getCreds();
  if (!supabaseUrl || !supabaseAnonKey) return [];

  const { select = '*', filters = [], orderBy = null, limit = 200 } = opts;
  const p = new URLSearchParams();
  p.set('select', select);
  for (const { col, op, val } of filters) p.set(col, `${op}.${val}`);
  if (orderBy) p.set('order', `${orderBy.col}.${orderBy.asc !== false ? 'asc' : 'desc'}`);
  if (limit)   p.set('limit', String(limit));

  try {
    const bearer = _bearer(supabaseAnonKey);
    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}?${p}`, {
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${bearer}` },
      signal:  AbortSignal.timeout(10000),
    });
    if (!res.ok) { console.warn('[SUPA]', table, res.status); return []; }
    return await res.json();
  } catch (e) { console.warn('[SUPA]', table, e.message); return []; }
}

// FIX E10: upsert = POST com merge-duplicates (para novos + existentes)
export async function upsertSupabase(table, record) {
  const { supabaseUrl, supabaseAnonKey } = _getCreds();
  if (!supabaseUrl || !supabaseAnonKey) return false;
  const bearer = _bearer(supabaseAnonKey);
  try {
    const rows = Array.isArray(record) ? record : [record];
    const res  = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey, Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows), signal: AbortSignal.timeout(10000),
    });
    return res.ok || [200,201,204].includes(res.status);
  } catch (e) { console.warn('[SUPA upsert]', table, e.message); return false; }
}

// FIX E9: URLSearchParams — col não é URL-encoded manualmente
export async function patchSupabase(table, filter, patch) {
  const { supabaseUrl, supabaseAnonKey } = _getCreds();
  if (!supabaseUrl || !supabaseAnonKey) return false;
  const bearer = _bearer(supabaseAnonKey);

  const { col, op, val } = filter;
  const p = new URLSearchParams();
  p.set(col, `${op}.${val}`);

  try {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}?${p}`, {
      method: 'PATCH',
      headers: {
        apikey: supabaseAnonKey, Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch), signal: AbortSignal.timeout(10000),
    });
    return res.ok || [200,204].includes(res.status);
  } catch (e) { console.warn('[SUPA patch]', table, e.message); return false; }
}

export function saveSupaCreds(url, key) {
  try { localStorage.setItem('fg_supabase_url', url); localStorage.setItem('fg_supabase_key', key); return true; }
  catch { return false; }
}

export function startWhatsAppBridge(intervalMs = 15000) {
  let lastCheck = new Date(Date.now() - 60000).toISOString();
  const poll = async () => {
    try {
      const rows = await fetchFromSupabase('fg_whatsapp_conversations', {
        filters: [{ col: 'updated_at', op: 'gte', val: lastCheck }],
        orderBy: { col: 'updated_at', asc: false }, limit: 20,
      });
      if (!rows.length) return;
      lastCheck = new Date().toISOString();
      rows.forEach(row => {
        const d = row.data || {};
        const t = (d.last_msg||'').toLowerCase();
        const type = /emerg|socorro/.test(t)?'alerta':/consul|agendar/.test(t)?'agenda':/exame|result/.test(t)?'lab':'normal';
        window.dispatchEvent(new CustomEvent('fg_wa_message', { detail: {
          id:`wa_${row.id}_${Date.now()}`, from:d.name||d.phone||row.id, initials:'WA',
          cor:'#00FF88', msg:d.last_msg||'', time:new Date(row.updated_at).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}),
          unread:true, type, channel:'WhatsApp', phone:d.phone||row.id, waStatus:d.status||'active',
        }}));
      });
    } catch {}
  };
  poll();
  const timer = setInterval(poll, intervalMs);
  return () => clearInterval(timer);
}
