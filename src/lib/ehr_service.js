// ═══════════════════════════════════════════════════════════
// FUMUGOLD — EHR Service v1.0
// Prontuário Electrónico do Paciente
// Histórico médico · Evolução clínica · Prescrições · Exames
// Armazena em localStorage (camada V3) + Supabase sync
// ═══════════════════════════════════════════════════════════
import { getClinicId }    from './multi_clinic.js';
import { logAction }      from './audit_log.js';
import { upsertSupabase } from '../supabase_sync.js';

const KEYS = {
  EVOLUTIONS:    'fg_ehr_evolutions',
  HISTORY:       'fg_ehr_history',
  VITAL_SERIES:  'fg_ehr_vitals',
  ALLERGIES:     'fg_ehr_allergies',
  PROBLEMS:      'fg_ehr_problems',
};

// ── Tipos de eventos EHR ──────────────────────────────────
export const EHR_TYPES = {
  CONSULTATION: 'consultation',
  EVOLUTION:    'evolution',
  EXAM_ORDER:   'exam_order',
  EXAM_RESULT:  'exam_result',
  PRESCRIPTION: 'prescription',
  PROCEDURE:    'procedure',
  HOSPITALIZATION: 'hospitalization',
  DISCHARGE:    'discharge',
  ALLERGY:      'allergy',
  PROBLEM:      'problem',
};

// ─── PRONTUÁRIO BASE ──────────────────────────────────────

// Obtém ou cria prontuário de um paciente
export function getPatientRecord(patientId) {
  const all = _load(KEYS.HISTORY);
  return all.find(r => r.patientId === patientId && r.clinic_id === getClinicId()) || null;
}

// Cria ou actualiza prontuário base
export function upsertPatientRecord(patientId, data) {
  const all = _load(KEYS.HISTORY);
  const idx = all.findIndex(r => r.patientId === patientId && r.clinic_id === getClinicId());

  const record = {
    id:         `ehr_${patientId}`,
    patientId,
    clinic_id:  getClinicId(),
    updatedAt:  new Date().toISOString(),
    ...data,
  };

  if (idx >= 0) all[idx] = { ...all[idx], ...record };
  else          all.push(record);

  _save(KEYS.HISTORY, all);
  _syncRecord(record);
  return record;
}

// ─── EVOLUÇÃO CLÍNICA ─────────────────────────────────────

// Adiciona nota de evolução SOAP
export async function addEvolution(patientId, evolution) {
  const entry = {
    id:         `ev_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
    patientId,
    clinic_id:  getClinicId(),
    type:       EHR_TYPES.EVOLUTION,
    ts:         new Date().toISOString(),
    date:       new Date().toLocaleDateString('pt-PT'),
    author:     evolution.author || _getSessionUser(),
    // SOAP
    subjective: evolution.subjective || evolution.S || '',  // Queixas do paciente
    objective:  evolution.objective  || evolution.O || '',  // Exame físico
    assessment: evolution.assessment || evolution.A || '',  // Avaliação
    plan:       evolution.plan       || evolution.P || '',  // Plano
    // Extra
    vitals:     evolution.vitals || null,
    diagnoses:  evolution.diagnoses || [],
    notes:      evolution.notes || '',
    icd10:      evolution.icd10 || '',
  };

  const all = _load(KEYS.EVOLUTIONS);
  all.unshift(entry);
  _save(KEYS.EVOLUTIONS, all.slice(0, 1000)); // máx 1000 evoluções
  _syncRecord(entry);

  await logAction('EHR:EVOLUTION', { patientId, author: entry.author });
  return entry;
}

// Obtém evoluções de um paciente (mais recente primeiro)
export function getEvolutions(patientId, limit = 20) {
  return _load(KEYS.EVOLUTIONS)
    .filter(e => e.patientId === patientId && e.clinic_id === getClinicId())
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, limit);
}

// ─── SINAIS VITAIS (SÉRIE TEMPORAL) ──────────────────────

export function addVitalSigns(patientId, vitals) {
  const entry = {
    patientId,
    clinic_id: getClinicId(),
    ts:        new Date().toISOString(),
    fc:     Number(vitals.fc   || 0),
    spo2:   Number(vitals.spo2 || 0),
    pa:     vitals.pa     || '',
    temp:   Number(vitals.temp || 0),
    fr:     Number(vitals.fr   || 0),
    peso:   Number(vitals.peso || 0),
    glicemia: Number(vitals.glicemia || 0),
    author: vitals.author || _getSessionUser(),
  };

  const all = _load(KEYS.VITAL_SERIES);
  const patSeries = all.filter(v => v.patientId === patientId).concat(entry).slice(-100); // últimas 100
  const others    = all.filter(v => v.patientId !== patientId);
  _save(KEYS.VITAL_SERIES, [...others, ...patSeries]);
  return entry;
}

export function getVitalSeries(patientId, limit = 24) {
  return _load(KEYS.VITAL_SERIES)
    .filter(v => v.patientId === patientId && v.clinic_id === getClinicId())
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, limit)
    .reverse();
}

// ─── PROBLEMAS ACTIVOS ────────────────────────────────────

export function addProblem(patientId, problem) {
  const entry = {
    id:        `prob_${Date.now()}`,
    patientId,
    clinic_id: getClinicId(),
    ts:        new Date().toISOString(),
    label:     problem.label || '',
    icd10:     problem.icd10 || '',
    status:    problem.status || 'active',  // active | resolved | chronic
    severity:  problem.severity || 'moderate',
    since:     problem.since || new Date().toLocaleDateString('pt-PT'),
    notes:     problem.notes || '',
  };

  const all = _load(KEYS.PROBLEMS);
  all.unshift(entry);
  _save(KEYS.PROBLEMS, all);
  return entry;
}

export function getProblems(patientId, status = null) {
  const all = _load(KEYS.PROBLEMS).filter(p => p.patientId === patientId && p.clinic_id === getClinicId());
  return status ? all.filter(p => p.status === status) : all;
}

export function resolveProblem(problemId) {
  const all = _load(KEYS.PROBLEMS);
  const idx = all.findIndex(p => p.id === problemId);
  if (idx >= 0) { all[idx].status = 'resolved'; all[idx].resolvedAt = new Date().toISOString(); }
  _save(KEYS.PROBLEMS, all);
}

// ─── ALERGIAS ─────────────────────────────────────────────

export function addAllergy(patientId, allergy) {
  const entry = {
    id:        `alg_${Date.now()}`,
    patientId,
    clinic_id: getClinicId(),
    substance: allergy.substance || '',      // ex: "Penicilina"
    reaction:  allergy.reaction  || '',      // ex: "Anafilaxia"
    severity:  allergy.severity  || 'high',  // high | moderate | low
    confirmed: allergy.confirmed !== false,
    ts:        new Date().toISOString(),
  };

  const all = _load(KEYS.ALLERGIES);
  // Evita duplicados
  if (all.find(a => a.patientId === patientId && a.substance.toLowerCase() === entry.substance.toLowerCase())) return null;
  all.unshift(entry);
  _save(KEYS.ALLERGIES, all);
  return entry;
}

export function getAllergies(patientId) {
  return _load(KEYS.ALLERGIES)
    .filter(a => a.patientId === patientId && a.clinic_id === getClinicId());
}

// ─── SUMMARY DO PRONTUÁRIO ────────────────────────────────

export function getEHRSummary(patientId) {
  const evolutions = getEvolutions(patientId, 5);
  const vitals     = getVitalSeries(patientId, 3);
  const problems   = getProblems(patientId, 'active');
  const allergies  = getAllergies(patientId);
  const record     = getPatientRecord(patientId);

  const lastVitals = vitals[vitals.length - 1] || null;
  const lastEvol   = evolutions[0] || null;

  return {
    patientId,
    record,
    summary: {
      totalEvolutions:      evolutions.length,
      activeProblemsCount:  problems.length,          // B2-FIX: renomeado (era duplicado)
      allergiesCount:       allergies.length,
      lastConsultation:     lastEvol?.date || null,
      lastVitals,
      activeProblems:       problems.slice(0, 5),     // lista dos activos
      criticalAllergies:    allergies.filter(a => a.severity === 'high'),
    },
    recent: {
      evolutions: evolutions.slice(0, 3),
      vitals:     vitals.slice(-5),
    },
  };
}

// ─── CONTEXTO ARIA ────────────────────────────────────────

export function buildEHRContext(patientId) {
  const summary = getEHRSummary(patientId);
  if (!summary.record && !summary.summary.totalEvolutions) return '';

  const { summary: s, recent } = summary;
  const lv = s.lastVitals;

  return `
📋 PRONTUÁRIO ELECTRÓNICO:
  Consultas registadas: ${s.totalEvolutions}
  Problemas activos: ${s.activeProblems.map(p => p.label).join(', ') || 'Nenhum'}
  Alergias: ${s.criticalAllergies.map(a => `${a.substance} (${a.reaction})`).join(', ') || 'Sem alergias conhecidas'}
${lv ? `  Últimos sinais vitais (${new Date(lv.ts).toLocaleDateString('pt-PT')}):
    FC: ${lv.fc||'—'} bpm | SpO₂: ${lv.spo2||'—'}% | Temp: ${lv.temp||'—'}°C | PA: ${lv.pa||'—'}` : ''}
${recent.evolutions[0] ? `  Última evolução (${recent.evolutions[0].date}):
    A: ${recent.evolutions[0].assessment?.slice(0,100) || '—'}
    P: ${recent.evolutions[0].plan?.slice(0,100) || '—'}` : ''}`;
}

// ─── Helpers privados ─────────────────────────────────────

function _load(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}

function _save(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

function _getSessionUser() {
  try {
    const s = JSON.parse(localStorage.getItem('fg_session') || 'null');
    return s?.nome || s?.user || 'staff';
  } catch { return 'staff'; }
}

async function _syncRecord(record) {
  try {
    await upsertSupabase('fg_ehr_records', {
      id:         record.id,
      data:       record,
      updated_at: record.updatedAt || record.ts || new Date().toISOString(),
    });
  } catch { /* offline — dados guardados localmente */ }
}
