// ═══════════════════════════════════════════════════════════
// FUMUGOLD — Entry Point FINAL v3.1
// Ordem de inicialização crítica:
//   1. window.storage reactivo
//   2. Multi-clínica interceptor
//   3. ARIA Bridge v2 (DeepSeek + Groq)
//   4. React + V3 LOCKED render
//   5. Serviços pós-render (WA AI, Billing, EHR, etc.)
// ═══════════════════════════════════════════════════════════

// ── 0. THREE.js global ─────────────────────────────────────
import * as THREE from 'three';
window.THREE = THREE;

// ── 1. Storage reactivo ───────────────────────────────────
;(function() {
  if (typeof window === 'undefined' || window._fg_storage_ok) return;
  window._fg_storage_ok = true;
  const _cbs = {};
  window.storage = {
    get:    async (k) => { try { const v=localStorage.getItem(k); return v?{key:k,value:v}:null; } catch { return null; } },
    set:    async (k,v) => { try { const s=typeof v==='string'?v:JSON.stringify(v); localStorage.setItem(k,s); (_cbs[k]||[]).forEach(fn=>{try{fn(s);}catch{}}); return {key:k,value:s}; } catch { return null; } },
    delete: async (k) => { try { localStorage.removeItem(k); return {key:k,deleted:true}; } catch { return null; } },
    list:   async (p) => { try { const ks=Object.keys(localStorage).filter(k=>!p||k.startsWith(p)); return {keys:ks}; } catch { return {keys:[]}; } },
    _subscribe: (key,fn) => { if(!_cbs[key])_cbs[key]=[]; _cbs[key].push(fn); return ()=>{ _cbs[key]=(_cbs[key]||[]).filter(f=>f!==fn); }; },
  };
})();

// ── 2. Multi-clínica interceptor ──────────────────────────
import { installClinicInterceptor, getClinicId, migrateLocalData } from './lib/multi_clinic.js';
installClinicInterceptor();

// ── 3. ARIA Bridge v2 ─────────────────────────────────────
import { installARIABridge, updateClinicSnapshot } from './lib/aria_bridge_v2.js';
installARIABridge();

// ── 4. React + V3 ─────────────────────────────────────────
import React from 'react';
import { createRoot } from 'react-dom/client';
import FumuGold from './FumuGold_V3_ARIA_visual.jsx';

// ── 5. Serviços ───────────────────────────────────────────
import { startWhatsAppRealtime }                        from './lib/whatsapp_realtime.js';
import { installBillingUI, exportInvoicePDF, exportAllPDF } from './lib/billing_service.js';
import { createInvoice, addPayment, getBillingStats, exportInvoiceXML, createFromFlow } from './lib/billing_advanced.js';
import { createFlow, advanceFlow, getActiveFlows, getTodayStats } from './lib/clinical_flow.js';
import { logAction, setCurrentUser, validateRLS, getLogs, clearOldLogs } from './lib/audit_log.js';
import { addEvolution, getEvolutions, addVitalSigns, getEHRSummary, buildEHRContext } from './lib/ehr_service.js';
import { calculate, checkInteractions, formatResult, getDrugList } from './lib/dosage_calculator.js';
import { processIncoming, classify, suggestReply, saveWASettings } from './lib/whatsapp_ai.js';
import { aiRouter, clinicalReason, quickReply, saveGroqKey } from './lib/ai_router.js';
import { getClinicMeta, setClinicMeta } from './lib/multi_clinic.js';

// ── Render ────────────────────────────────────────────────
createRoot(document.getElementById('root')).render(
  <React.StrictMode><FumuGold /></React.StrictMode>
);

// ── Serviços pós-render ───────────────────────────────────
let _stopWA = null;

window.addEventListener('load', () => {
  setTimeout(async () => {

    // Snapshot inicial ARIA
    updateClinicSnapshot();

    // Migração multi-clínica (adiciona clinic_id a dados existentes)
    try { migrateLocalData(); } catch {}

    // WhatsApp Realtime
    try { _stopWA = startWhatsAppRealtime(); }
    catch (e) { console.warn('[FG] WA Realtime:', e.message); }

    // Billing UI (botões PDF nas tabelas)
    try { installBillingUI(); }
    catch (e) { console.warn('[FG] Billing UI:', e.message); }

    // Audit cleanup
    try { clearOldLogs(30); } catch {}

    // RLS validation em background
    const supaUrl = localStorage.getItem('fg_supabase_url') || '';
    if (supaUrl) validateRLS().catch(() => {});

    // ── API global window.__fg ────────────────────────────
    window.__fg = {
      version: '3.1.0',
      clinic: {
        getId:    getClinicId,
        getMeta:  getClinicMeta,
        setMeta:  setClinicMeta,
      },
      billing: {
        create:         createInvoice,
        createFromFlow, // B10-FIX: importado estaticamente acima (não await import())
        addPayment,
        exportPDF:      exportInvoicePDF,
        exportAll:      exportAllPDF,
        exportXML:      exportInvoiceXML,
        getStats:       getBillingStats,
        getInvoices:    () => JSON.parse(localStorage.getItem('clinic_invoices') || '[]'),
      },
      flow: {
        create:    createFlow,
        advance:   advanceFlow,
        getActive: getActiveFlows,
        getStats:  getTodayStats,
      },
      ehr: {
        addEvolution,
        getEvolutions,
        addVitalSigns,
        getSummary: getEHRSummary,
        buildContext: buildEHRContext,
      },
      dosage: {
        calculate,
        checkInteractions,
        format: formatResult,
        drugs:  getDrugList,
      },
      wa: {
        process:     processIncoming,
        classify,
        suggest:     suggestReply,
        saveSettings: saveWASettings,
      },
      ai: {
        router:    aiRouter,
        clinical:  clinicalReason,
        quick:     quickReply,
        saveGroqKey,
        getMetrics: () => aiRouter.getMetrics(),
      },
      audit: {
        log:         logAction,
        getLogs,
        setUser:     setCurrentUser,
        validateRLS,
      },
      utils: {
        refresh: updateClinicSnapshot,
        stopWA:  () => _stopWA?.(),
      },
    };

    console.info('%cFumuGold V3.1 — Sistema Clínico Inteligente ✓',
      'color:#D4AF37;font-family:monospace;font-size:13px;font-weight:bold;letter-spacing:2px');
    console.info('%cARIA v2 · Multi-Clínica · EHR · Dosagem · WA AI · Billing Angola',
      'color:#00FF88;font-size:10px;font-family:monospace');
    console.info('%cAPI: window.__fg  |  Clínica: ' + getClinicId(),
      'color:#9A8A5A;font-size:10px;font-family:monospace');

  }, 2500);
});

window.addEventListener('beforeunload', () => { try { _stopWA?.(); } catch {} });
