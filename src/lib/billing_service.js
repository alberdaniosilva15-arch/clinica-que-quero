// ═══════════════════════════════════════════════════════════
// FUMUGOLD — Billing Service v3.0
// PDF gerado em HTML puro (sem libs externas)
// Injecta botão "PDF" via MutationObserver (zero JSX)
// Registo de pagamentos via localStorage + Supabase
// ═══════════════════════════════════════════════════════════
import { fetchFromSupabase, patchSupabase, upsertSupabase } from '../supabase_sync.js';
import { logAction } from './audit_log.js';

// ── Cores FumuGold (replicadas para o PDF) ────────────────
const C = {
  gold: '#D4AF37', bg: '#040301', text: '#EEE4C0',
  green: '#00FF88', amber: '#FF9900', red: '#FF2525',
};

// ── getInvoices ───────────────────────────────────────────
export function getInvoices() {
  try { return JSON.parse(localStorage.getItem('clinic_invoices') || '[]'); } catch { return []; }
}

// ── getInvoice ────────────────────────────────────────────
export function getInvoice(id) {
  return getInvoices().find(inv => inv.id === id) || null;
}

// ── recordPayment ─────────────────────────────────────────
// Actualiza o valor pago de uma fatura no localStorage + Supabase
export async function recordPayment(invoiceId, amountPaid, method = 'Dinheiro') {
  const invoices = getInvoices();
  const idx      = invoices.findIndex(inv => inv.id === invoiceId);
  if (idx < 0) throw new Error(`Fatura ${invoiceId} não encontrada.`);

  const inv = invoices[idx];
  const newPago = Math.min(inv.total, (inv.pago || 0) + amountPaid);
  const newPend = inv.total - newPago;
  const newStat = newPago >= inv.total ? 'Pago' : newPago > 0 ? 'Parcial' : 'Pendente';

  const updated = {
    ...inv,
    pago:      newPago,
    pendente:  newPend,
    status:    newStat,
    lastPayment:   { amount: amountPaid, method, ts: new Date().toISOString() },
  };

  invoices[idx] = updated;
  localStorage.setItem('clinic_invoices', JSON.stringify(invoices));

  // B6-FIX: upsertSupabase (POST + merge-duplicates) — funciona para registos novos E existentes
  try {
    await upsertSupabase('fg_invoices', {
      id:         invoiceId,
      data:       updated,
      updated_at: new Date().toISOString(),
    });
  } catch { /* offline — dados guardados localmente */ }

  await logAction('PAYMENT', { invoiceId, amountPaid, method, newStatus: newStat });

  return updated;
}

// ── exportInvoicePDF ──────────────────────────────────────
// Gera PDF da fatura via janela de impressão do browser
export function exportInvoicePDF(invoiceIdOrObj) {
  const inv = typeof invoiceIdOrObj === 'string'
    ? getInvoice(invoiceIdOrObj)
    : invoiceIdOrObj;

  if (!inv) { alert('Fatura não encontrada.'); return; }

  const html = _buildInvoiceHTML(inv);
  const win  = window.open('', '_blank', 'width=800,height=900');
  if (!win) { alert('Bloqueador de pop-ups activo. Permite pop-ups para exportar PDF.'); return; }

  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch {} }, 600);

  logAction('PDF_EXPORT', { invoiceId: inv.id, patient: inv.patient });
}

// ── exportAllPDF ──────────────────────────────────────────
// Exporta lista de faturas como relatório PDF
export function exportAllPDF(filter = 'all') {
  const invoices = getInvoices().filter(inv => {
    if (filter === 'all')     return true;
    if (filter === 'pending') return inv.status === 'Pendente';
    if (filter === 'paid')    return inv.status === 'Pago';
    return true;
  });
  if (!invoices.length) { alert('Sem faturas para exportar.'); return; }

  const html = _buildReportHTML(invoices);
  const win  = window.open('', '_blank', 'width=900,height=950');
  if (!win) { alert('Bloqueador de pop-ups activo.'); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch {} }, 600);
}

// ── installBillingUI ──────────────────────────────────────
// Injeta botões PDF no painel Financeiro via MutationObserver
// Chamado em main.jsx — zero impacto no V3 visual
export function installBillingUI() {
  if (typeof window === 'undefined') return;

  let _injected = false;
  let _lastInvoiceCount = -1;

  const inject = () => {
    const invoices = getInvoices();
    if (!invoices.length) return;

    // Detecta se o tab Financeiro está visível (tabela de faturas)
    const tables = document.querySelectorAll('table');
    const ftTable = Array.from(tables).find(t => {
      const headers = t.querySelectorAll('th');
      return Array.from(headers).some(th => th.textContent.trim() === 'Nº Fatura');
    });

    if (!ftTable) { _injected = false; return; }
    if (_injected && invoices.length === _lastInvoiceCount) return;

    _injected          = true;
    _lastInvoiceCount  = invoices.length;

    // Remove botões anteriores
    document.querySelectorAll('.fg-pdf-btn').forEach(el => el.remove());

    // Injeta botão "PDF" em cada linha da tabela
    const rows = ftTable.querySelectorAll('tbody tr');
    rows.forEach((row, idx) => {
      const inv = invoices[idx];
      if (!inv) return;

      // Verifica se já tem botão
      if (row.querySelector('.fg-pdf-btn')) return;

      const td = document.createElement('td');
      td.style.cssText = 'padding: 9px 6px; border-bottom: 1px solid rgba(212,175,55,0.1);';

      const btn = document.createElement('button');
      btn.className   = 'fg-pdf-btn';
      btn.textContent = '📄';
      btn.title       = `Exportar PDF — ${inv.id}`;
      btn.style.cssText = `
        background: rgba(212,175,55,0.08);
        border: 1px solid rgba(212,175,55,0.3);
        color: #D4AF37;
        border-radius: 2px;
        padding: 3px 7px;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.15s;
      `;
      btn.onmouseenter = () => { btn.style.background = 'rgba(212,175,55,0.2)'; };
      btn.onmouseleave = () => { btn.style.background = 'rgba(212,175,55,0.08)'; };
      btn.onclick = (e) => { e.stopPropagation(); exportInvoicePDF(inv); };

      td.appendChild(btn);
      row.appendChild(td);
    });

    // Injeta cabeçalho extra
    const thead = ftTable.querySelector('thead tr');
    if (thead && !thead.querySelector('.fg-pdf-th')) {
      const th = document.createElement('th');
      th.className  = 'fg-pdf-th';
      th.textContent = 'PDF';
      th.style.cssText = `
        padding: 6px 10px;
        font-family: Orbitron, monospace;
        font-size: 7px;
        color: rgba(106,90,50,0.8);
        text-align: left;
        border-bottom: 1px solid rgba(212,175,55,0.25);
        letter-spacing: 1px;
      `;
      thead.appendChild(th);
    }

    // Botão "Exportar Todos" — injecta junto ao botão "+ EMITIR"
    const emitirBtn = Array.from(document.querySelectorAll('button')).find(
      b => b.textContent.trim() === '+ EMITIR'
    );
    if (emitirBtn && !document.getElementById('fg-export-all-btn')) {
      const exportBtn = document.createElement('button');
      exportBtn.id = 'fg-export-all-btn';
      exportBtn.textContent = '📊 EXPORTAR';
      exportBtn.style.cssText = `
        font-family: Orbitron, monospace;
        font-size: 7px;
        padding: 4px 12px;
        background: rgba(0,204,255,0.08);
        border: 1px solid rgba(0,204,255,0.4);
        color: #00CCFF;
        border-radius: 1px;
        cursor: pointer;
        letter-spacing: 1px;
        margin-right: 6px;
      `;
      exportBtn.onclick = () => exportAllPDF('all');
      emitirBtn.parentNode.insertBefore(exportBtn, emitirBtn);
    }
  };

  // B8-FIX: guarda referência para poder desligar
  const observer = new MutationObserver(() => inject());
  observer.observe(document.body, { childList: true, subtree: true });

  // B9-FIX: guarda referência para poder limpar
  const pollInterval = setInterval(inject, 2000);

  // Retorna cleanup function (chamado em main.jsx beforeunload se necessário)
  installBillingUI._cleanup = () => {
    observer.disconnect();
    clearInterval(pollInterval);
  };

  console.info('[FumuGold] Billing UI activo — botões PDF prontos.');
}

// ── _buildInvoiceHTML ─────────────────────────────────────
function _buildInvoiceHTML(inv) {
  const now   = new Date().toLocaleString('pt-PT');
  const total = (inv.total || 0).toLocaleString('pt-AO');
  const pago  = (inv.pago  || 0).toLocaleString('pt-AO');
  const pend  = (inv.pendente || 0).toLocaleString('pt-AO');
  const stCol = inv.status === 'Pago' ? '#00AA55' : inv.status === 'Parcial' ? '#FF9900' : '#FF2525';

  // B4-FIX: trata items como string OU objecto {description, quantity, unitPrice, subtotal}
  const itemsHTML = (inv.items || ['Consulta']).map(item => {
    const desc    = typeof item === 'string' ? item : (item.description || '—');
    const qty     = typeof item === 'object'  ? (item.quantity  || 1)  : 1;
    const price   = typeof item === 'object'  ? (item.subtotal  || 0)  : '';
    const priceStr = price ? `${Number(price).toLocaleString('pt-AO')} AOA` : 'Incluído';
    return `<tr>
        <td style="padding:6px 0;border-bottom:1px solid #eee">${desc}</td>
        <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:center">${qty}</td>
        <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;color:#555">${priceStr}</td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8"/>
  <title>Fatura ${inv.id} — FumuGold</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Rajdhani:wght@400;600&display=swap');
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family: 'Rajdhani', sans-serif; background:#fff; color:#222; padding:40px; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:32px; padding-bottom:20px; border-bottom:3px solid #D4AF37; }
    .logo { font-family:'Cinzel',serif; font-size:28px; color:#8B6914; font-weight:700; letter-spacing:4px; }
    .logo-sub { font-size:9px; color:#aaa; letter-spacing:3px; margin-top:3px; }
    .invoice-num { font-family:'Cinzel',serif; font-size:20px; color:#D4AF37; }
    .badge { display:inline-block; padding:4px 12px; border-radius:2px; font-size:11px; font-weight:700; background:${stCol}22; color:${stCol}; border:1px solid ${stCol}66; margin-top:4px; }
    .section { margin-bottom:24px; }
    .section-title { font-family:'Cinzel',serif; font-size:10px; letter-spacing:2px; color:#999; margin-bottom:8px; text-transform:uppercase; }
    .info-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
    .info-item label { font-size:10px; color:#999; display:block; margin-bottom:2px; letter-spacing:1px; }
    .info-item span { font-size:14px; color:#222; }
    table { width:100%; border-collapse:collapse; margin-bottom:20px; }
    th { background:#f5f0e0; color:#8B6914; font-size:10px; letter-spacing:1px; padding:8px; text-align:left; }
    .totals { margin-top:20px; border-top:2px solid #D4AF37; padding-top:16px; }
    .total-row { display:flex; justify-content:space-between; padding:6px 0; }
    .total-row.main { font-family:'Cinzel',serif; font-size:16px; color:#D4AF37; font-weight:700; }
    .footer { margin-top:40px; padding-top:16px; border-top:1px solid #eee; font-size:10px; color:#aaa; text-align:center; }
    @media print { body { padding:20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">FUMUGOLD</div>
      <div class="logo-sub">SISTEMA MÉDICO INTEGRADO · ANGOLA</div>
    </div>
    <div style="text-align:right">
      <div class="invoice-num">${inv.id}</div>
      <div class="badge">${inv.status || 'Pendente'}</div>
      <div style="font-size:11px;color:#999;margin-top:6px">Emitida: ${inv.date || '—'}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Dados do Paciente</div>
    <div class="info-grid">
      <div class="info-item"><label>Nome</label><span>${inv.patient || '—'}</span></div>
      <div class="info-item"><label>Seguradora</label><span>${inv.seguro || 'Particular'}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Serviços Prestados</div>
    <table>
      <thead><tr><th>Descrição</th><th style="text-align:center">Qtd</th><th style="text-align:right">Valor</th></tr></thead>
      <tbody>${itemsHTML}</tbody>
    </table>
  </div>

  <div class="totals">
    <div class="total-row"><span>Subtotal</span><span>${total} AOA</span></div>
    <div class="total-row" style="color:green"><span>Pago</span><span>${pago} AOA</span></div>
    <div class="total-row" style="color:${inv.pendente > 0 ? '#FF6600' : 'green'}"><span>Pendente</span><span>${pend} AOA</span></div>
    <div class="total-row main"><span>TOTAL</span><span>${total} AOA</span></div>
  </div>

  ${inv.lastPayment ? `
  <div class="section" style="margin-top:20px">
    <div class="section-title">Último Pagamento</div>
    <div class="info-grid">
      <div class="info-item"><label>Valor</label><span>${(inv.lastPayment.amount||0).toLocaleString('pt-AO')} AOA</span></div>
      <div class="info-item"><label>Método</label><span>${inv.lastPayment.method || '—'}</span></div>
    </div>
  </div>` : ''}

  <div class="footer">
    FumuGold — Sistema Médico Integrado · Luanda, Angola<br/>
    Documento gerado em ${now} · ${inv.id}
  </div>
</body>
</html>`;
}

// ── _buildReportHTML ──────────────────────────────────────
function _buildReportHTML(invoices) {
  const total   = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const pago    = invoices.reduce((s, i) => s + (i.pago || 0), 0);
  const pend    = total - pago;
  const rows    = invoices.map((inv, i) => {
    const stCol = inv.status === 'Pago' ? '#00AA55' : inv.status === 'Parcial' ? '#FF9900' : '#FF2525';
    return `<tr style="background:${i % 2 === 0 ? '#fafafa' : '#fff'}">
      <td style="padding:8px">${inv.id}</td>
      <td style="padding:8px">${inv.patient || '—'}</td>
      <td style="padding:8px">${inv.date || '—'}</td>
      <td style="padding:8px;text-align:right">${(inv.total||0).toLocaleString('pt-AO')}</td>
      <td style="padding:8px;text-align:right;color:green">${(inv.pago||0).toLocaleString('pt-AO')}</td>
      <td style="padding:8px;text-align:right;color:${stCol}">${(inv.pendente||0).toLocaleString('pt-AO')}</td>
      <td style="padding:8px"><span style="color:${stCol};font-weight:700">${inv.status||'—'}</span></td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"/>
  <title>Relatório Financeiro — FumuGold</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700&family=Rajdhani:wght@400;600&display=swap');
    body { font-family:'Rajdhani',sans-serif; padding:30px; color:#222; }
    h1 { font-family:'Cinzel',serif; color:#8B6914; letter-spacing:4px; margin-bottom:4px; }
    .sub { color:#aaa; font-size:11px; letter-spacing:2px; margin-bottom:24px; }
    .kpis { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; margin-bottom:28px; }
    .kpi { background:#f9f5e8; border:1px solid #D4AF3755; border-radius:4px; padding:14px; }
    .kpi-val { font-family:'Cinzel',serif; font-size:20px; color:#D4AF37; }
    .kpi-lbl { font-size:10px; color:#aaa; letter-spacing:1px; }
    table { width:100%; border-collapse:collapse; }
    th { background:#f5f0e0; color:#8B6914; font-size:10px; letter-spacing:1px; padding:9px; text-align:left; }
    @media print { body { padding:16px; } }
  </style></head>
  <body>
    <h1>RELATÓRIO FINANCEIRO</h1>
    <div class="sub">FUMUGOLD · ${new Date().toLocaleDateString('pt-PT')} · ${invoices.length} faturas</div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-val">${(total/1000).toFixed(1)}K AOA</div><div class="kpi-lbl">TOTAL FATURADO</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#00AA55">${(pago/1000).toFixed(1)}K AOA</div><div class="kpi-lbl">RECEBIDO</div></div>
      <div class="kpi"><div class="kpi-val" style="color:#FF6600">${(pend/1000).toFixed(1)}K AOA</div><div class="kpi-lbl">PENDENTE</div></div>
    </div>
    <table><thead><tr>
      <th>Nº Fatura</th><th>Paciente</th><th>Data</th>
      <th style="text-align:right">Total</th><th style="text-align:right">Pago</th>
      <th style="text-align:right">Pendente</th><th>Estado</th>
    </tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}
