// ═══════════════════════════════════════════════════════════
// FUMUGOLD — Contrato mínimo de dados (JSONB + campos obrigatórios)
// Mantém flexibilidade: campos extra preservados.
// ═══════════════════════════════════════════════════════════

function _tenant() {
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

export function withTenant(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const tid = _tenant();
  if (obj.clinic_id) return { ...obj };
  return { ...obj, clinic_id: tid };
}

export function resolvePatientIdByName(patients, name) {
  if (!name || !Array.isArray(patients)) return null;
  const n = String(name).trim().toLowerCase();
  const p = patients.find((x) => String(x.nome || '').trim().toLowerCase() === n);
  return p != null ? p.id : null;
}

/** @returns {{ ok: boolean, errors: string[], normalized: array }} */
export function validatePatientList(list) {
  if (!Array.isArray(list)) return { ok: false, errors: ['patients: não é array'], normalized: [] };
  const errors = [];
  const normalized = list.map((p, i) => {
    const row = withTenant({ ...p });
    const nome = String(row.nome ?? '').trim();
    if (!nome) errors.push(`Paciente #${i + 1}: nome obrigatório`);
    if (row.id === undefined || row.id === null || row.id === '')
      errors.push(`Paciente "${nome || i}": id obrigatório`);
    return { ...row, nome: nome || row.nome };
  });
  return { ok: errors.length === 0, errors, normalized };
}

export function validateAppointmentList(list, patients = []) {
  if (!Array.isArray(list)) return { ok: false, errors: ['appointments: não é array'], normalized: [] };
  const errors = [];
  const normalized = list.map((a, i) => {
    const row = withTenant({ ...a });
    if (!String(row.patient ?? '').trim()) errors.push(`Consulta #${i + 1}: paciente obrigatório`);
    if (!String(row.date ?? '').trim()) errors.push(`Consulta #${i + 1}: data obrigatória`);
    if (!String(row.time ?? '').trim()) errors.push(`Consulta #${i + 1}: hora obrigatória`);
    const pid = row.patient_id ?? resolvePatientIdByName(patients, row.patient);
    return { ...row, patient_id: pid ?? row.patient_id ?? null };
  });
  return { ok: errors.length === 0, errors, normalized };
}

export function validatePrescriptionList(list, patients = []) {
  if (!Array.isArray(list)) return { ok: false, errors: ['prescriptions: não é array'], normalized: [] };
  const errors = [];
  const normalized = list.map((r, i) => {
    const row = withTenant({ ...r });
    if (!String(row.patient ?? '').trim()) errors.push(`Prescrição #${i + 1}: paciente obrigatório`);
    if (!String(row.med ?? '').trim()) errors.push(`Prescrição #${i + 1}: medicamento obrigatório`);
    const pid = row.patient_id ?? resolvePatientIdByName(patients, row.patient);
    return { ...row, patient_id: pid ?? row.patient_id ?? null };
  });
  return { ok: errors.length === 0, errors, normalized };
}

export function validateLabList(list, patients = []) {
  if (!Array.isArray(list)) return { ok: false, errors: ['labResults: não é array'], normalized: [] };
  const errors = [];
  const normalized = list.map((r, i) => {
    const row = withTenant({ ...r });
    if (!String(row.patient ?? '').trim()) errors.push(`Exame #${i + 1}: paciente obrigatório`);
    if (!String(row.exam ?? '').trim()) errors.push(`Exame #${i + 1}: tipo de exame obrigatório`);
    const pid = row.patient_id ?? resolvePatientIdByName(patients, row.patient);
    return { ...row, patient_id: pid ?? row.patient_id ?? null };
  });
  return { ok: errors.length === 0, errors, normalized };
}

export const INVOICE_STATUSES = ['Pago', 'Pendente', 'Parcial', 'Cancelada', 'Rascunho'];

export function validateInvoiceList(list, patients = []) {
  if (!Array.isArray(list)) return { ok: false, errors: ['invoices: não é array'], normalized: [] };
  const errors = [];
  const normalized = list.map((inv, i) => {
    const row = withTenant({
      saftReady: false,
      currency: 'AOA',
      ...inv,
    });
    if (!String(row.patient ?? '').trim()) errors.push(`Fatura #${i + 1}: paciente obrigatório`);
    if (!String(row.id ?? '').trim()) errors.push(`Fatura #${i + 1}: id obrigatório`);
    const total = Number(row.total);
    if (!Number.isFinite(total) || total < 0) errors.push(`Fatura #${i + 1}: total inválido`);
    const pago = Number(row.pago ?? 0);
    const pend = Number(row.pendente ?? Math.max(0, total - pago));
    if (!INVOICE_STATUSES.includes(row.status)) {
      row.status = 'Pendente';
    }
    const pid = row.patient_id ?? resolvePatientIdByName(patients, row.patient);
    return {
      ...row,
      total,
      pago: Number.isFinite(pago) ? pago : 0,
      pendente: Number.isFinite(pend) ? pend : Math.max(0, total - pago),
      patient_id: pid ?? row.patient_id ?? null,
    };
  });
  return { ok: errors.length === 0, errors, normalized };
}

export function validateStockList(list) {
  if (!Array.isArray(list)) return { ok: false, errors: ['stock: não é array'], normalized: [] };
  const errors = [];
  const normalized = list.map((s, i) => {
    const row = withTenant({ ...s });
    if (!String(row.nome ?? '').trim()) errors.push(`Stock #${i + 1}: nome obrigatório`);
    const qty = Number(row.qty ?? 0);
    if (!Number.isFinite(qty) || qty < 0) errors.push(`Stock #${i + 1}: quantidade inválida`);
    return { ...row, qty: Number.isFinite(qty) ? qty : 0 };
  });
  return { ok: errors.length === 0, errors, normalized };
}

/** Encadeia validações dependentes de pacientes (prescrições, labs, consultas, faturas) */
export function validateAllClinical(patients, appointments, prescriptions, labResults, invoices) {
  const p = validatePatientList(patients);
  if (!p.ok) return { ok: false, errors: p.errors, patients: p.normalized, appointments, prescriptions, labResults, invoices };

  const a = validateAppointmentList(appointments, p.normalized);
  const rx = validatePrescriptionList(prescriptions, p.normalized);
  const lab = validateLabList(labResults, p.normalized);
  const inv = validateInvoiceList(invoices, p.normalized);

  const errors = [...a.errors, ...rx.errors, ...lab.errors, ...inv.errors];
  return {
    ok: errors.length === 0,
    errors,
    patients: p.normalized,
    appointments: a.normalized,
    prescriptions: rx.normalized,
    labResults: lab.normalized,
    invoices: inv.normalized,
  };
}
