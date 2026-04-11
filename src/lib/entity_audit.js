// ═══════════════════════════════════════════════════════════
// FUMUGOLD — Auditoria por diff (PEP / agenda / faturação)
// ═══════════════════════════════════════════════════════════

import { logAction, AUDIT_ACTIONS } from './audit_log.js';

function stableStringify(obj) {
  if (obj instanceof Date) return obj.toISOString();
  if (obj === undefined) return 'null';
  if (typeof obj !== 'object' || obj === null) return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function _changedKeys(a, b) {
  if (!a || !b) return [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  keys.forEach((k) => {
    try {
      if (stableStringify(a[k]) !== stableStringify(b[k])) out.push(k);
    } catch {
      out.push(k);
    }
  });
  return out;
}

export function auditPatientsDiff(prev, next) {
  const pm = new Map((prev || []).map((p) => [String(p.id), p]));
  const nm = new Map((next || []).map((p) => [String(p.id), p]));
  for (const [id, n] of nm) {
    const o = pm.get(id);
    if (!o) {
      logAction(AUDIT_ACTIONS.PATIENT_CREATE, { patientId: id, nome: n.nome }, 'info');
    } else {
      const keys = _changedKeys(o, n);
      if (keys.length)
        logAction(AUDIT_ACTIONS.PATIENT_EDIT, { patientId: id, keys }, 'info');
    }
  }
  for (const [id] of pm) {
    if (!nm.has(id)) logAction(AUDIT_ACTIONS.PATIENT_DELETE, { patientId: id }, 'warn');
  }
}

export function auditAppointmentsDiff(prev, next) {
  const pm = new Map((prev || []).map((p, i) => [String(p.id ?? i), p]));
  const nm = new Map((next || []).map((p, i) => [String(p.id ?? i), p]));
  for (const [id, n] of nm) {
    const o = pm.get(id);
    if (!o) logAction(AUDIT_ACTIONS.APPOINTMENT_CREATE, { appointmentId: id, patient: n.patient }, 'info');
    else {
      const keys = _changedKeys(o, n);
      if (keys.length) logAction(AUDIT_ACTIONS.APPOINTMENT_EDIT, { appointmentId: id, keys }, 'info');
    }
  }
  for (const [id, o] of pm) {
    if (!nm.has(id)) logAction(AUDIT_ACTIONS.APPOINTMENT_DELETE, { appointmentId: id, patient: o.patient }, 'info');
  }
}

export function auditPrescriptionsDiff(prev, next) {
  const pm = new Map((prev || []).map((p, i) => [String(p.id ?? i), p]));
  const nm = new Map((next || []).map((p, i) => [String(p.id ?? i), p]));
  for (const [id, n] of nm) {
    const o = pm.get(id);
    if (!o) logAction(AUDIT_ACTIONS.PRESCRIPTION_CREATE, { id, patient: n.patient, med: n.med }, 'info');
    else {
      const keys = _changedKeys(o, n);
      if (keys.length) logAction(AUDIT_ACTIONS.PRESCRIPTION_EDIT, { id, keys }, 'info');
    }
  }
  for (const [id] of pm) {
    if (!nm.has(id)) logAction(AUDIT_ACTIONS.PRESCRIPTION_DELETE, { id }, 'info');
  }
}

export function auditLabDiff(prev, next) {
  const pm = new Map((prev || []).map((p, i) => [String(p.id ?? i), p]));
  const nm = new Map((next || []).map((p, i) => [String(p.id ?? i), p]));
  for (const [id, n] of nm) {
    const o = pm.get(id);
    if (!o) logAction(AUDIT_ACTIONS.LAB_CREATE, { id, patient: n.patient, exam: n.exam }, 'info');
    else {
      const keys = _changedKeys(o, n);
      if (keys.length) logAction(AUDIT_ACTIONS.LAB_EDIT, { id, keys }, 'info');
    }
  }
  for (const [id] of pm) {
    if (!nm.has(id)) logAction(AUDIT_ACTIONS.LAB_DELETE, { id }, 'info');
  }
}

export function auditInvoicesDiff(prev, next) {
  const pm = new Map((prev || []).map((p) => [String(p.id), p]));
  const nm = new Map((next || []).map((p) => [String(p.id), p]));
  for (const [id, n] of nm) {
    const o = pm.get(id);
    if (!o) logAction(AUDIT_ACTIONS.INVOICE_CREATE, { invoiceId: id, patient: n.patient, total: n.total }, 'info');
    else {
      const keys = _changedKeys(o, n);
      if (keys.length) logAction(AUDIT_ACTIONS.INVOICE_EDIT, { invoiceId: id, keys, status: n.status }, 'info');
    }
  }
  for (const [id, o] of pm) {
    if (!nm.has(id)) logAction(AUDIT_ACTIONS.INVOICE_VOID, { invoiceId: id, patient: o.patient }, 'warn');
  }
}

export function auditStockDiff(prev, next) {
  const pm = new Map((prev || []).map((p) => [String(p.id), p]));
  const nm = new Map((next || []).map((p) => [String(p.id), p]));
  for (const [id, n] of nm) {
    const o = pm.get(id);
    if (!o) logAction(AUDIT_ACTIONS.STOCK_ADJUST, { stockId: id, nome: n.nome, qty: n.qty, type: 'create' }, 'info');
    else if (o.qty !== n.qty) {
      logAction(AUDIT_ACTIONS.STOCK_ADJUST, { stockId: id, nome: n.nome, from: o.qty, to: n.qty }, 'info');
    }
  }
  for (const [id] of pm) {
    if (!nm.has(id)) logAction(AUDIT_ACTIONS.STOCK_ADJUST, { stockId: id, type: 'remove' }, 'info');
  }
}
