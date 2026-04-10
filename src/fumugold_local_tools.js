// ═══════════════════════════════════════════════════════════
// FUMUGOLD LOCAL TOOLS v3.0 — PRODUÇÃO
// Importado directamente por FumuGold_V3_ARIA_visual.jsx
// NÃO ALTERAR O NOME OU LOCALIZAÇÃO DESTE FICHEIRO
// ═══════════════════════════════════════════════════════════

export const LOCAL_ARCHIVE_HISTORY_KEY = 'fg_archive_history';
export const LOCAL_SNAPSHOT_KEY        = 'fg_snapshot_latest';

// ── parseJSONSafe ─────────────────────────────────────────
export function parseJSONSafe(str, fallback = null) {
  if (str == null) return fallback;
  try { return JSON.parse(str); } catch (_) { return fallback; }
}

// ── downloadFile ──────────────────────────────────────────
export function downloadFile(content, filename, mimeType = 'application/octet-stream') {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── buildClinicDataBundle ─────────────────────────────────
export function buildClinicDataBundle(data = {}, reason = 'manual') {
  const {
    patients       = [],
    appointments   = [],
    labResults     = [],
    prescriptions  = [],
    invoices       = [],
    beds           = [],
    staff          = [],
    messages       = [],
    surgeries      = [],
    notifications  = [],
    stock          = [],
  } = data;

  return {
    meta: {
      version:     '3.1',
      generatedAt: new Date().toISOString(),
      reason,
      source:      'FumuGold V3 ARIA',
      totals: {
        patients:      patients.length,
        appointments:  appointments.length,
        labResults:    labResults.length,
        prescriptions: prescriptions.length,
        invoices:      invoices.length,
        beds:          beds.length,
        staff:         staff.length,
        messages:      messages.length,
        surgeries:     surgeries.length,
        notifications: notifications.length,
        stock:         stock.length,
      },
    },
    patients, appointments, labResults, prescriptions,
    invoices, beds, staff, messages, surgeries, notifications,
    stock,
  };
}

// ── buildBundleCSV ────────────────────────────────────────
export function buildBundleCSV(bundle) {
  if (!bundle?.meta) return '';
  const lines = [];
  const { meta, patients = [], appointments = [] } = bundle;

  lines.push('FUMUGOLD SNAPSHOT CSV');
  lines.push(`Gerado em:,${meta.generatedAt}`);
  lines.push(`Motivo:,${meta.reason}`);
  lines.push('');
  lines.push('RESUMO');
  lines.push('Entidade,Total');
  Object.entries(meta.totals || {}).forEach(([k, v]) => lines.push(`${k},${v}`));
  lines.push('');

  if (patients.length > 0) {
    lines.push('PACIENTES');
    const cols = ['id', 'nome', 'idade', 'genero', 'diagnostico', 'estado'];
    lines.push(cols.join(','));
    patients.forEach(p => {
      lines.push(cols.map(c => `"${String(p[c] || '').replace(/"/g, '""')}"`).join(','));
    });
    lines.push('');
  }

  if (appointments.length > 0) {
    lines.push('CONSULTAS');
    const cols2 = ['id', 'pacienteNome', 'data', 'hora', 'tipo', 'estado'];
    lines.push(cols2.join(','));
    appointments.forEach(a => {
      lines.push(cols2.map(c => `"${String(a[c] || '').replace(/"/g, '""')}"`).join(','));
    });
    lines.push('');
  }

  return lines.join('\n');
}

// ── persistArchiveBundle ──────────────────────────────────
export async function persistArchiveBundle(bundle, opts = {}) {
  const { writeToFolder = false, format = 'json' } = opts;
  const key       = LOCAL_ARCHIVE_HISTORY_KEY;
  const stamp     = bundle?.meta?.generatedAt || new Date().toISOString();
  const safeStamp = stamp.replace(/[:.]/g, '-').slice(0, 19);

  try {
    const raw     = localStorage.getItem(key);
    const history = parseJSONSafe(raw, []);
    const entry   = {
      id:          `arc_${Date.now()}`,
      generatedAt: stamp,
      reason:      bundle?.meta?.reason || 'manual',
      totals:      bundle?.meta?.totals || {},
      format,
    };
    const updated = [entry, ...history].slice(0, 50);
    localStorage.setItem(key, JSON.stringify(updated));

    if (writeToFolder) {
      const filename = `fumugold_archive_${safeStamp}.${format}`;
      const content  = format === 'csv'
        ? buildBundleCSV(bundle)
        : JSON.stringify(bundle, null, 2);
      const mime = format === 'csv' ? 'text/csv' : 'application/json';
      downloadFile(content, filename, mime);
    }

    return {
      ok:           true,
      historyCount: updated.length,
      folderError:  writeToFolder
        ? 'Browser não suporta acesso a pastas. Ficheiro descarregado para Downloads.'
        : '',
    };
  } catch (e) {
    return {
      ok:           false,
      historyCount: 0,
      folderError:  String(e?.message || 'Erro ao guardar arquivo local'),
    };
  }
}

// ── buildLocalAIResponse ──────────────────────────────────
// Fallback offline — usado quando não há rede ou quando a API falha
export function buildLocalAIResponse(prompt = '', bundle = {}) {
  const now    = new Date();
  const hora   = now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
  const data   = now.toLocaleDateString('pt-PT', { weekday: 'long', day: 'numeric', month: 'long' });
  const totals = bundle?.meta?.totals || {};

  const pts  = totals.patients      || 0;
  const apts = totals.appointments  || 0;
  const labs = totals.labResults    || 0;
  const rxs  = totals.prescriptions || 0;

  const analysis = _analyseClinicData(bundle);

  const response = [
    `▸ ANÁLISE IA LOCAL · ${data} ${hora}`,
    `▸ Prompt: "${prompt}"`,
    '',
    '📊 ESTADO DA CLÍNICA:',
    `• ${pts} pacientes registados | ${apts} consultas agendadas`,
    `• ${labs} resultados laboratoriais | ${rxs} prescrições activas`,
    '',
    '🔍 PRIORIDADES OPERACIONAIS:',
    ...analysis.priorities.map((p, i) => `${i + 1}. ${p}`),
    '',
    '⚠️ ALERTAS:',
    ...analysis.alerts.map(a => `• ${a}`),
    '',
    '✅ RECOMENDAÇÕES:',
    ...analysis.recommendations.map(r => `• ${r}`),
    '',
    '─────────────────────────────────',
    '⚡ Modo offline — análise gerada localmente.',
  ].join('\n');

  return { ok: true, response, prompt, timestamp: now.toISOString() };
}

// ── _analyseClinicData (privado) ──────────────────────────
function _analyseClinicData(bundle) {
  const patients      = bundle?.patients      || [];
  const appointments  = bundle?.appointments  || [];
  const beds          = bundle?.beds          || [];
  const notifications = bundle?.notifications || [];
  const priorities    = [];
  const alerts        = [];
  const recommendations = [];

  const criticos = patients.filter(p =>
    p.estado === 'critico' || p.prioridade === 'urgente' || p.severity === 'critico'
  );
  if (criticos.length > 0) {
    priorities.push(`${criticos.length} paciente(s) em estado crítico — verificação imediata`);
    alerts.push(`URGENTE: ${criticos.length} paciente(s) precisam de atenção`);
  }

  const hoje     = new Date().toISOString().slice(0, 10);
  const consHoje = appointments.filter(a => (a.data || '').slice(0, 10) === hoje);
  if (consHoje.length > 0) {
    priorities.push(`${consHoje.length} consulta(s) agendada(s) para hoje`);
  }

  const camasOcupadas = beds.filter(b => b.estado === 'ocupada' || b.occupied).length;
  const camasTotal    = beds.length;
  if (camasTotal > 0) {
    const taxa = Math.round((camasOcupadas / camasTotal) * 100);
    priorities.push(`Taxa de ocupação: ${taxa}% (${camasOcupadas}/${camasTotal} camas)`);
    if (taxa > 85) alerts.push(`LOTAÇÃO CRÍTICA: ${taxa}% — considerar transferências urgentes`);
  }

  const naoLidas = notifications.filter(n => !n.lida && !n.read).length;
  if (naoLidas > 0) alerts.push(`${naoLidas} notificação(ões) por ler`);

  if (priorities.length === 0) {
    priorities.push('Operação normal — sem prioridades urgentes detectadas');
  }

  recommendations.push('Verificar exames laboratoriais pendentes');
  recommendations.push('Confirmar stock de medicamentos essenciais');
  recommendations.push('Actualizar registos de pacientes internados');

  if (camasTotal > 0 && camasOcupadas / camasTotal > 0.7) {
    recommendations.push('Rever alta médica de pacientes estáveis para libertar camas');
  }

  return { priorities, alerts, recommendations };
}
