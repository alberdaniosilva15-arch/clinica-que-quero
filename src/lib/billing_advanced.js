// ═══════════════════════════════════════════════════════════
// FUMUGOLD — Billing Advanced v1.0
// Facturação Angola: NIF, IVA, INSS, Seguradoras
// Geração automática de fatura do fluxo clínico
// Exportação PDF premium + XML (compatível EFatura Angola)
// ═══════════════════════════════════════════════════════════
import { getClinicId, getClinicMeta } from './multi_clinic.js';
import { logAction } from './audit_log.js';

// ── Tabela de preços padrão (AOA) ─────────────────────────
export const PRICE_TABLE = {
  // Consultas
  'Consulta Geral':           8_000,
  'Consulta Especialidade':  15_000,
  'Consulta Urgência':       12_000,
  'Consulta Domicílio':      25_000,
  'Teleconsulta':             5_000,
  // Procedimentos
  'Penso Simples':            3_000,
  'Penso Complexo':           8_000,
  'Injecção IM/IV':           2_500,
  'Soro IV (montagem)':       5_000,
  'Nebulização':              4_000,
  'ECG':                      8_000,
  'Ecografia Abdominal':     25_000,
  'Raio-X':                  15_000,
  // Laboratório
  'Hemograma':                5_000,
  'TDR Malária':              3_000,
  'Glicemia':                 2_000,
  'Urinalise':                3_500,
  'Perfil Hepático':         12_000,
  'CD4':                     15_000,
  // Internamento
  'Internamento/dia':        25_000,
  'Internamento UCI/dia':    80_000,
  // Cirurgia
  'Cirurgia Menor':          50_000,
  'Cirurgia Média':         150_000,
  'Cirurgia Major':         400_000,
  // Medicação (dispensação)
  'Medicação Avulso':         5_000,
  'Kit ARV (mensal)':        20_000,
  'Kit Antipalúdico':         8_000,
};

// ── Taxas Angola ──────────────────────────────────────────
const TAX_RATES = {
  IVA:    0.14,    // IVA Angola 14%
  INSS_E: 0.03,    // Contribuição INSS Empregado 3%
  INSS_P: 0.08,    // Contribuição INSS Patronal 8%
  ISE:    0,       // Isenção Serviços de Saúde (Lei 7/19 Angola — saúde isenta IVA)
};

// ── Seguradoras Angola ────────────────────────────────────
export const INSURERS = {
  ENSA:           { name: 'ENSA',           code: 'ENSA',   discount: 0.15 },
  INSS:           { name: 'INSS',           code: 'INSS',   discount: 0.20 },
  AAA:            { name: 'AAA Seguros',    code: 'AAA',    discount: 0.10 },
  BESA:           { name: 'BESA',           code: 'BESA',   discount: 0.10 },
  GLOBAL:         { name: 'Global Seguros', code: 'GLOB',   discount: 0.10 },
  PARTICULAR:     { name: 'Particular',     code: 'PART',   discount: 0 },
};

// ─── createInvoice ────────────────────────────────────────
export function createInvoice({
  patientId,
  patientName,
  patientNIF  = '',
  items       = [],   // [{ description, quantity, unitPrice }] or [string labels]
  insurer     = 'PARTICULAR',
  paidAmount  = 0,
  paymentMethod = 'Dinheiro',
  clinician   = '',
  flowId      = null,
  notes       = '',
}) {
  const clinic    = getClinicMeta();
  const invoiceNum = `FT-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

  // Normaliza items
  const lineItems = items.map(item => {
    if (typeof item === 'string') {
      return {
        description: item,
        quantity:    1,
        unitPrice:   PRICE_TABLE[item] || 0,
        subtotal:    PRICE_TABLE[item] || 0,
      };
    }
    const subtotal = (item.quantity || 1) * (item.unitPrice || 0);
    return { ...item, subtotal };
  }).filter(i => i.subtotal > 0);

  const subtotalBruto = lineItems.reduce((s, i) => s + i.subtotal, 0);

  // Desconto seguradora
  const ins        = INSURERS[insurer] || INSURERS.PARTICULAR;
  const discount   = Math.round(subtotalBruto * ins.discount);
  const subtotalNet = subtotalBruto - discount;

  // IVA — Saúde isenta em Angola (Lei 7/19)
  const iva        = 0; // Math.round(subtotalNet * TAX_RATES.IVA);
  const total      = subtotalNet + iva;
  const paid       = Math.min(paidAmount, total);
  const pending    = total - paid;
  const status     = paid >= total ? 'Pago' : paid > 0 ? 'Parcial' : 'Pendente';

  const invoice = {
    id:             invoiceNum,
    patientId,
    patient:        patientName,
    patientNIF,
    clinic_id:      getClinicId(),
    clinicName:     clinic?.name || 'FumuGold',
    clinicNIF:      clinic?.nif  || '',
    date:           new Date().toLocaleDateString('pt-PT'),
    dateISO:        new Date().toISOString(),
    clinician,
    insurer:        ins.name,
    insurerCode:    ins.code,
    items:          lineItems,
    subtotalBruto,
    discount,
    subtotalNet,
    iva,
    total,
    pago:           paid,
    pendente:       pending,
    paymentMethod,
    status,
    notes,
    flowId,
    payments:       paid > 0 ? [{ amount: paid, method: paymentMethod, ts: new Date().toISOString() }] : [],
  };

  // Persiste no localStorage (mesma estrutura do V3)
  _saveInvoice(invoice);
  logAction('BILLING:INVOICE_CREATE', { id: invoiceNum, total, patientName });

  return invoice;
}

// ─── createFromFlow ───────────────────────────────────────
// Cria fatura automaticamente a partir do fluxo clínico
export function createFromFlow(flow, extras = {}) {
  if (!flow) return null;

  // Mapeia estados do fluxo para itens da fatura
  const items = [];
  const history = flow.history || [];

  if (history.some(h => h.state === 'consultation'))  items.push('Consulta Geral');
  if (history.some(h => h.state === 'exams'))         items.push('Hemograma', 'TDR Malária');
  if (history.some(h => h.state === 'prescription'))  items.push('Medicação Avulso');

  if (!items.length) items.push('Consulta Geral');

  return createInvoice({
    patientId:   flow.patientId,
    patientName: flow.patientName,
    items:       [...items, ...(extras.items || [])],
    insurer:     extras.insurer || 'PARTICULAR',
    paidAmount:  extras.paidAmount || 0,
    flowId:      flow.id,
    clinician:   flow.clinician || '',
    ...extras,
  });
}

// ─── addPayment ───────────────────────────────────────────
export async function addPayment(invoiceId, amount, method = 'Dinheiro') {
  const invoices = _loadInvoices();
  const idx      = invoices.findIndex(i => i.id === invoiceId);
  if (idx < 0) throw new Error(`Fatura ${invoiceId} não encontrada`);

  const inv     = invoices[idx];
  const newPaid = Math.min(inv.total, (inv.pago || 0) + amount);
  const payment = { amount, method, ts: new Date().toISOString() };

  invoices[idx] = {
    ...inv,
    pago:     newPaid,
    pendente: inv.total - newPaid,
    status:   newPaid >= inv.total ? 'Pago' : 'Parcial',
    payments: [...(inv.payments || []), payment],
  };

  localStorage.setItem('clinic_invoices', JSON.stringify(invoices));
  logAction('BILLING:PAYMENT', { invoiceId, amount, method });

  return invoices[idx];
}

// ─── getStats ─────────────────────────────────────────────
export function getBillingStats(period = 'month') {
  const invoices = _loadInvoices();
  const now      = new Date();

  const filtered = invoices.filter(inv => {
    if (!inv.dateISO) return true;
    const d = new Date(inv.dateISO);
    if (period === 'today') return d.toDateString() === now.toDateString();
    if (period === 'week')  return (now - d) < 7 * 86400000;
    if (period === 'month') return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    return true;
  });

  const total    = filtered.reduce((s, i) => s + (i.total || 0), 0);
  const received = filtered.reduce((s, i) => s + (i.pago  || 0), 0);
  const pending  = total - received;

  const byInsurer = {};
  filtered.forEach(inv => {
    const k = inv.insurerCode || 'PART';
    if (!byInsurer[k]) byInsurer[k] = { count: 0, total: 0, received: 0 };
    byInsurer[k].count++;
    byInsurer[k].total    += inv.total || 0;
    byInsurer[k].received += inv.pago  || 0;
  });

  return {
    count: filtered.length, total, received, pending,
    byInsurer,
    avgTicket: filtered.length ? Math.round(total / filtered.length) : 0,
    paidRate:  total ? Math.round(received / total * 100) : 0,
  };
}

// ─── exportXML (compatibilidade EFatura Angola) ───────────
export function exportInvoiceXML(invoice) {
  const clinic = getClinicMeta();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FaturaSimplificada xmlns="urn:fumugold:invoice:1.0">
  <Emitente>
    <Nome>${_escXML(clinic?.name || 'FumuGold')}</Nome>
    <NIF>${_escXML(clinic?.nif || '')}</NIF>
    <Endereco>${_escXML(clinic?.city || 'Luanda')}, Angola</Endereco>
  </Emitente>
  <Cliente>
    <Nome>${_escXML(invoice.patient)}</Nome>
    <NIF>${_escXML(invoice.patientNIF || '')}</NIF>
  </Cliente>
  <Documento tipo="FT" numero="${invoice.id}" data="${invoice.dateISO}">
    <Linhas>
${invoice.items.map(item => `      <Linha>
        <Descricao>${_escXML(item.description)}</Descricao>
        <Quantidade>${item.quantity || 1}</Quantidade>
        <PrecoUnitario>${item.unitPrice || 0}</PrecoUnitario>
        <Subtotal>${item.subtotal || 0}</Subtotal>
        <Taxa>ISE</Taxa>
      </Linha>`).join('\n')}
    </Linhas>
    <Totais>
      <BaseIncidencia>${invoice.subtotalNet}</BaseIncidencia>
      <Desconto>${invoice.discount}</Desconto>
      <IVA>${invoice.iva}</IVA>
      <Total>${invoice.total}</Total>
      <Pago>${invoice.pago}</Pago>
      <Pendente>${invoice.pendente}</Pendente>
    </Totais>
    <EstadoPagamento>${invoice.status}</EstadoPagamento>
  </Documento>
</FaturaSimplificada>`;

  const blob = new Blob([xml], { type: 'application/xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${invoice.id}.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Helpers ──────────────────────────────────────────────
function _loadInvoices() {
  try { return JSON.parse(localStorage.getItem('clinic_invoices') || '[]'); } catch { return []; }
}

function _saveInvoice(invoice) {
  const all = _loadInvoices();
  const idx = all.findIndex(i => i.id === invoice.id);
  if (idx >= 0) all[idx] = invoice;
  else all.unshift(invoice);
  localStorage.setItem('clinic_invoices', JSON.stringify(all));
}

function _escXML(str = '') {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
