// ═══════════════════════════════════════════════════════════
// FUMUGOLD — Clinical Flow v3.0
// Máquina de estados para o percurso do paciente
// Integra com localStorage (V3) + Supabase
// ═══════════════════════════════════════════════════════════
import { fetchFromSupabase, patchSupabase, upsertSupabase } from '../supabase_sync.js';
import { logAction } from './audit_log.js';

// ── Estados possíveis ─────────────────────────────────────
export const FLOW_STATES = {
  WAITING:      'waiting',      // Chegou, aguarda triagem
  TRIAGE:       'triage',       // Em triagem
  WAITING_DR:   'waiting_dr',   // Triagem feita, aguarda médico
  CONSULTATION: 'consultation', // Em consulta
  EXAMS:        'exams',        // Aguarda exames
  PRESCRIPTION: 'prescription', // A receber prescrição
  BILLING:      'billing',      // No caixa / a pagar
  COMPLETE:     'complete',     // Alta — fluxo concluído
};

const FLOW_ORDER = [
  FLOW_STATES.WAITING,
  FLOW_STATES.TRIAGE,
  FLOW_STATES.WAITING_DR,
  FLOW_STATES.CONSULTATION,
  FLOW_STATES.EXAMS,
  FLOW_STATES.PRESCRIPTION,
  FLOW_STATES.BILLING,
  FLOW_STATES.COMPLETE,
];

const STATE_LABELS = {
  waiting:      '⏳ Aguarda Triagem',
  triage:       '🩺 Em Triagem',
  waiting_dr:   '👤 Aguarda Médico',
  consultation: '🏥 Em Consulta',
  exams:        '🔬 Aguarda Exames',
  prescription: '💊 Prescrição',
  billing:      '💰 No Caixa',
  complete:     '✅ Concluído',
};

const STORAGE_KEY = 'fg_clinical_flows';

// ── Persistência local ────────────────────────────────────
function _loadFlows() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}

function _saveFlows(flows) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(flows)); } catch {}
}

// ── createFlow ────────────────────────────────────────────
// Inicia o percurso clínico para um paciente
export async function createFlow({ patientId, patientName, appointmentId = null, priority = 'normal', channel = 'presencial' }) {
  const flow = {
    id:            `flow_${Date.now()}`,
    patientId,
    patientName,
    appointmentId,
    priority,       // 'urgente' | 'alta' | 'normal' | 'baixa'
    channel,        // 'presencial' | 'whatsapp' | 'telefone'
    state:          FLOW_STATES.WAITING,
    history:        [{ state: FLOW_STATES.WAITING, ts: new Date().toISOString(), by: 'sistema' }],
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
    estimatedWait:  _estimateWait(priority),
    notes:          '',
  };

  const flows = _loadFlows();
  flows.push(flow);
  _saveFlows(flows);

  // Sync Supabase
  try {
    await _syncFlowToSupabase(flow);
  } catch { /* offline */ }

  await logAction('FLOW_CREATE', { flowId: flow.id, patient: patientName, priority });

  return flow;
}

// ── advanceFlow ───────────────────────────────────────────
// Avança para o próximo estado
export async function advanceFlow(flowId, options = {}) {
  const { by = 'staff', notes = '', skipTo = null } = options;
  const flows = _loadFlows();
  const idx   = flows.findIndex(f => f.id === flowId);
  if (idx < 0) throw new Error(`Fluxo ${flowId} não encontrado.`);

  const flow = flows[idx];
  const currentIdx = FLOW_ORDER.indexOf(flow.state);

  const nextState = skipTo && FLOW_STATES[skipTo.toUpperCase()]
    ? FLOW_STATES[skipTo.toUpperCase()]
    : FLOW_ORDER[currentIdx + 1];

  if (!nextState) throw new Error('Fluxo já concluído.');

  const updated = {
    ...flow,
    state:     nextState,
    updatedAt: new Date().toISOString(),
    notes:     notes || flow.notes,
    history:   [
      ...flow.history,
      { state: nextState, ts: new Date().toISOString(), by, notes },
    ],
    // Marca tempo de espera total quando chega ao médico
    ...(nextState === FLOW_STATES.CONSULTATION
      ? { actualWait: Math.round((Date.now() - new Date(flow.createdAt).getTime()) / 60000) }
      : {}),
    // Marca hora de conclusão
    ...(nextState === FLOW_STATES.COMPLETE
      ? { completedAt: new Date().toISOString() }
      : {}),
  };

  flows[idx] = updated;
  _saveFlows(flows);

  try { await _syncFlowToSupabase(updated); } catch {}

  await logAction('FLOW_ADVANCE', { flowId, from: flow.state, to: nextState, by });

  // Emite evento para outros componentes
  window.dispatchEvent(new CustomEvent('fg_flow_update', { detail: updated }));

  return updated;
}

// ── getActiveFlows ────────────────────────────────────────
export function getActiveFlows() {
  return _loadFlows()
    .filter(f => f.state !== FLOW_STATES.COMPLETE)
    .sort((a, b) => _priorityScore(b.priority) - _priorityScore(a.priority)
      || new Date(a.createdAt) - new Date(b.createdAt)
    );
}

// ── getFlowsByState ───────────────────────────────────────
export function getFlowsByState(state) {
  return _loadFlows().filter(f => f.state === state);
}

// ── getTodayStats ─────────────────────────────────────────
export function getTodayStats() {
  const today = new Date().toISOString().slice(0, 10);
  const flows  = _loadFlows().filter(f => f.createdAt.startsWith(today));
  const done   = flows.filter(f => f.state === FLOW_STATES.COMPLETE);

  const avgWait = done.length > 0
    ? Math.round(done.reduce((s, f) => s + (f.actualWait || 0), 0) / done.length)
    : 0;

  return {
    total:       flows.length,
    active:      flows.filter(f => f.state !== FLOW_STATES.COMPLETE).length,
    complete:    done.length,
    urgent:      flows.filter(f => f.priority === 'urgente').length,
    avgWaitMin:  avgWait,
    byState:     FLOW_ORDER.reduce((acc, s) => ({
      ...acc,
      [s]: { count: flows.filter(f => f.state === s).length, label: STATE_LABELS[s] },
    }), {}),
  };
}

// ── getStateLabel ─────────────────────────────────────────
export function getStateLabel(state) {
  return STATE_LABELS[state] || state;
}

// ── getFlowTimeline ───────────────────────────────────────
export function getFlowTimeline(flowId) {
  const flow = _loadFlows().find(f => f.id === flowId);
  if (!flow) return null;

  return FLOW_ORDER.map(state => {
    const entry = flow.history.find(h => h.state === state);
    return {
      state,
      label:    STATE_LABELS[state],
      done:     !!entry,
      active:   flow.state === state,
      ts:       entry?.ts || null,
      by:       entry?.by || null,
      notes:    entry?.notes || null,
    };
  });
}

// ── generateARIAFlowContext ───────────────────────────────
// Gera contexto dos fluxos activos para injectar na ARIA
export function generateARIAFlowContext() {
  const stats = getTodayStats();
  const active = getActiveFlows().slice(0, 5);

  let ctx = `\n🏥 FLUXO CLÍNICO (hoje):
  Total: ${stats.total} | Activos: ${stats.active} | Concluídos: ${stats.complete}
  Tempo médio de espera: ${stats.avgWaitMin}min | Urgentes: ${stats.urgent}`;

  if (active.length > 0) {
    ctx += '\n  Em atendimento:';
    active.forEach(f => {
      ctx += `\n    • ${f.patientName} — ${STATE_LABELS[f.state]} (${f.priority})`;
    });
  }

  return ctx;
}

// ── Helpers privados ──────────────────────────────────────
function _priorityScore(p) {
  return { urgente: 4, alta: 3, normal: 2, baixa: 1 }[p] || 2;
}

function _estimateWait(priority) {
  const base = { urgente: 5, alta: 15, normal: 30, baixa: 60 };
  return base[priority] || 30;
}

// B5-FIX: upsertSupabase — cria OU actualiza (PATCH só funciona em registos existentes)
async function _syncFlowToSupabase(flow) {
  await upsertSupabase('fg_clinical_flows', {
    id:         flow.id,
    data:       flow,
    updated_at: flow.updatedAt || new Date().toISOString(),
  });
}
