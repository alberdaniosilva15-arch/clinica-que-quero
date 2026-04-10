// ═══════════════════════════════════════════════════════════
// FUMUGOLD — Supabase Auth (sessão real + JWT para REST)
// Não importa supabase_sync (evita ciclos).
// ═══════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

let _client = null;

function _url() {
  try {
    return import.meta.env.VITE_SUPABASE_URL || (typeof localStorage !== 'undefined' && localStorage.getItem('fg_supabase_url')) || '';
  } catch {
    return import.meta.env.VITE_SUPABASE_URL || '';
  }
}

function _anon() {
  try {
    return import.meta.env.VITE_SUPABASE_ANON_KEY || (typeof localStorage !== 'undefined' && localStorage.getItem('fg_supabase_key')) || '';
  } catch {
    return import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  }
}

/** Cliente singleton; null se URL/key em falta */
export function getSupabaseClient() {
  const url = _url().replace(/\/$/, '');
  const key = _anon();
  if (!url || !key) return null;
  if (_client) return _client;
  _client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'fg_sb_auth',
      storage: typeof localStorage !== 'undefined' ? localStorage : undefined,
    },
  });
  return _client;
}

export function resetSupabaseClient() {
  _client = null;
}

export function getAccessToken() {
  try {
    const c = getSupabaseClient();
    if (!c) return null;
    return c.auth.getSession().then(({ data }) => data.session?.access_token || null);
  } catch {
    return Promise.resolve(null);
  }
}

/** Versão síncrona a partir do storage interno do Supabase (após hidratação) */
export function getAccessTokenSync() {
  try {
    const raw = localStorage.getItem('fg_sb_auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.access_token || null;
  } catch {
    return null;
  }
}

export function mapSupabaseUserToAppSession(sbSession) {
  const u = sbSession?.user;
  if (!u) return null;
  const meta = u.user_metadata || {};
  const app = u.app_metadata || {};
  let clinicId =
    meta.clinic_id ||
    app.clinic_id ||
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_CLINIC_ID) ||
    'clinic_default';
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('fg_clinic_id'))
      clinicId = localStorage.getItem('fg_clinic_id');
  } catch { /* ignore */ }

  return {
    authProvider: 'supabase',
    userId: u.id,
    email: u.email || '',
    nome: meta.full_name || meta.nome || u.email?.split('@')[0] || 'Utilizador',
    role: meta.role || app.role || 'staff',
    clinic_id: clinicId,
    access_token: sbSession.access_token,
    refresh_token: sbSession.refresh_token,
    ts: Date.now(),
  };
}

export async function signInWithEmailPassword(email, password) {
  const c = getSupabaseClient();
  if (!c) return { ok: false, error: 'Supabase não configurado (URL/key).' };
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  return { ok: true, session: data.session };
}

export async function signOutSupabase() {
  try {
    const c = getSupabaseClient();
    if (c) await c.auth.signOut();
  } catch { /* ignore */ }
  resetSupabaseClient();
}

export async function getInitialSession() {
  const c = getSupabaseClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session || null;
}

export function subscribeAuth(callback) {
  const c = getSupabaseClient();
  if (!c) return () => {};
  const { data: sub } = c.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
  return () => sub?.subscription?.unsubscribe?.();
}
