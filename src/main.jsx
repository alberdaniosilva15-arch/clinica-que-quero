// ═══════════════════════════════════════════════════════════
// FUMUGOLD — Entry Point v3.2 (Supabase Auth + PWA)
// ═══════════════════════════════════════════════════════════
import * as THREE from 'three';
window.THREE = THREE;

// ── Storage reactivo ──────────────────────────────────────
;(function(){
  if(window._fg_storage_ok)return;
  window._fg_storage_ok=true;
  const _cbs={};
  window.storage={
    get:    async k=>{try{const v=localStorage.getItem(k);return v?{key:k,value:v}:null;}catch{return null;}},
    set:    async(k,v)=>{try{const s=typeof v==='string'?v:JSON.stringify(v);localStorage.setItem(k,s);(_cbs[k]||[]).forEach(fn=>{try{fn(s);}catch{}});return{key:k,value:s};}catch{return null;}},
    delete: async k=>{try{localStorage.removeItem(k);return{key:k,deleted:true};}catch{return null;}},
    list:   async p=>{try{const ks=Object.keys(localStorage).filter(k=>!p||k.startsWith(p));return{keys:ks};}catch{return{keys:[]};}},
    _subscribe:(key,fn)=>{if(!_cbs[key])_cbs[key]=[];_cbs[key].push(fn);return()=>{_cbs[key]=(_cbs[key]||[]).filter(f=>f!==fn);};},
  };
})();

// ── Multi-clínica ─────────────────────────────────────────
import { installClinicInterceptor, getClinicId, migrateLocalData } from './lib/multi_clinic.js';
installClinicInterceptor();

// ── ARIA Bridge ───────────────────────────────────────────
import { installARIABridge, updateClinicSnapshot } from './lib/aria_bridge_v2.js';
installARIABridge();

// ── Supabase Auth ─────────────────────────────────────────
import {
  getSupabaseClient, getInitialSession, subscribeAuth,
  mapSupabaseUserToAppSession, signOutSupabase,
} from './lib/supabase_auth.js';

// ── React ─────────────────────────────────────────────────
import React from 'react';
import { createRoot } from 'react-dom/client';
import FumuGold from './FumuGold_V3_ARIA_visual.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';

// ── Serviços ──────────────────────────────────────────────
import { startWhatsAppRealtime }                              from './lib/whatsapp_realtime.js';
import { installBillingUI, exportInvoicePDF, exportAllPDF }  from './lib/billing_service.js';
import { createInvoice, addPayment, getBillingStats, exportInvoiceXML, createFromFlow } from './lib/billing_advanced.js';
import { createFlow, advanceFlow, getActiveFlows, getTodayStats } from './lib/clinical_flow.js';
import { logAction, setCurrentUser, validateRLS, getLogs, clearOldLogs } from './lib/audit_log.js';
import { addEvolution, getEvolutions, addVitalSigns, getEHRSummary, buildEHRContext } from './lib/ehr_service.js';
import { calculate, checkInteractions, formatResult, getDrugList } from './lib/dosage_calculator.js';
import { processIncoming, classify, suggestReply, saveWASettings } from './lib/whatsapp_ai.js';
import { aiRouter, clinicalReason, quickReply, saveGroqKey } from './lib/ai_router.js';
import { getClinicMeta, setClinicMeta } from './lib/multi_clinic.js';

// ── Guard de autenticação ─────────────────────────────────
async function initAuth(){
  const client=getSupabaseClient();
  if(!client){
    const dev=JSON.parse(localStorage.getItem('fg_session')||'null');
    if(dev?._dev){window.__fg_session=dev;return true;}
    window.location.replace('./login.html');return false;
  }
  const session=await getInitialSession();
  if(!session){window.location.replace('./login.html');return false;}
  const app=mapSupabaseUserToAppSession(session);
  window.__fg_session=app;
  if(app?.clinic_id)localStorage.setItem('fg_clinic_id',app.clinic_id);
  setCurrentUser(app?.nome||app?.email||'?');
  return true;
}

// ── PWA: escuta mensagens do SW (sync offline) ────────────
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message',e=>{
    if(e.data?.type==='FG_SYNC_START'){
      updateClinicSnapshot();
    }
  });
}

// ── Bootstrap ─────────────────────────────────────────────
(async()=>{
  const ok=await initAuth();
  if(!ok)return;

  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        <FumuGold/>
      </ErrorBoundary>
    </React.StrictMode>
  );

  window.addEventListener('load',()=>{
    setTimeout(async()=>{
      updateClinicSnapshot();
      try{migrateLocalData();}catch{}
      try{startWhatsAppRealtime();}catch(e){console.warn('[FG] WA:',e.message);}
      try{installBillingUI();}catch(e){console.warn('[FG] Billing:',e.message);}
      try{clearOldLogs(30);}catch{}
      validateRLS().catch(()=>{});

      subscribeAuth((event,session)=>{
        if(event==='SIGNED_OUT'||(!session&&event==='TOKEN_REFRESHED')){
          window.location.replace('./login.html');
        }
        if(event==='TOKEN_REFRESHED'&&session){
          window.__fg_session=mapSupabaseUserToAppSession(session);
        }
      });

      window.__fg={
        version:'3.2.0',
        auth:{
          getSession:()=>window.__fg_session,
          signOut:async()=>{
            await signOutSupabase();
            localStorage.removeItem('fg_session');
            localStorage.removeItem('fg_clinic_id');
            window.location.replace('./login.html');
          },
          getClient:getSupabaseClient,
        },
        clinic:{getId:getClinicId,getMeta:getClinicMeta,setMeta:setClinicMeta},
        billing:{create:createInvoice,createFromFlow,addPayment,exportPDF:exportInvoicePDF,exportAll:exportAllPDF,exportXML:exportInvoiceXML,getStats:getBillingStats,getInvoices:()=>JSON.parse(localStorage.getItem('clinic_invoices')||'[]')},
        flow:{create:createFlow,advance:advanceFlow,getActive:getActiveFlows,getStats:getTodayStats},
        ehr:{addEvolution,getEvolutions,addVitalSigns,getSummary:getEHRSummary,buildContext:buildEHRContext},
        dosage:{calculate,checkInteractions,format:formatResult,drugs:getDrugList},
        wa:{process:processIncoming,classify,suggest:suggestReply,saveSettings:saveWASettings},
        ai:{router:aiRouter,clinical:clinicalReason,quick:quickReply,saveGroqKey,getMetrics:()=>aiRouter.getMetrics()},
        audit:{log:logAction,getLogs,setUser:setCurrentUser,validateRLS},
        utils:{refresh:updateClinicSnapshot},
      };

      console.info('%cFumuGold V3.2 ✓','color:#D4AF37;font-family:monospace;font-size:13px;font-weight:bold;letter-spacing:2px');
      console.info('%cAuth: Supabase | PWA: activo | Clínica: '+getClinicId(),'color:#00FF88;font-size:10px;font-family:monospace');
    },2500);
  });
})();