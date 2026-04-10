// ═══════════════════════════════════════════════════════════
// FUMUGOLD — ARIA Bridge v2.1  [CORRIGIDO]
// FIX E4: duplo proxy corrigido — um proxy intercepta AMBOS endpoints
// FIX:    import.meta.env no top-level
// ═══════════════════════════════════════════════════════════

const OR_ENDPOINT   = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

let _snapshot  = null;
let _installed = false;

export function updateClinicSnapshot() {
  try {
    const ls = k => { try { return JSON.parse(localStorage.getItem(k)||'null'); } catch { return null; } };
    const patients      = ls('clinic_patients')      || [];
    const appointments  = ls('clinic_appointments')  || [];
    const invoices      = ls('clinic_invoices')      || [];
    const beds          = ls('clinic_beds')           || [];
    const notifications = ls('clinic_notifications') || [];
    const messages      = ls('clinic_messages')      || [];

    const today = new Date().toISOString().slice(0,10);
    const hora  = new Date().toLocaleTimeString('pt-PT',{timeZone:'Africa/Luanda',hour:'2-digit',minute:'2-digit'});

    const totalPac   = patients.filter(p=>p.tipo==='Paciente').length;
    const criticos   = patients.filter(p=>p.risco==='alto'||p.status==='Crítico').length;
    const consHoje   = appointments.filter(a=>(a.date||'').slice(0,10)===today).length;
    const consConf   = appointments.filter(a=>(a.date||'').slice(0,10)===today&&(a.status==='confirmed'||a.status==='Confirmada')).length;
    const camasOcup  = beds.filter(b=>b.status==='Ocupada').length;
    const camasTotal = beds.length;
    const totalFat   = invoices.reduce((s,i)=>s+(i.total||0),0);
    const totalPago  = invoices.reduce((s,i)=>s+(i.pago||0),0);
    const fatPend    = invoices.filter(i=>i.status==='Pendente').length;
    const waQueue    = messages.filter(m=>m.channel==='WhatsApp'&&m.unread).length;
    const unreadNotif= notifications.filter(n=>!n.read).length;

    const pacCriticos = patients.filter(p=>p.risco==='alto'||p.status==='Crítico').slice(0,3).map(p=>`${p.nome}(${p.diag||'?'})`);
    const proxConsultas = appointments.filter(a=>(a.date||'').slice(0,10)===today).slice(0,4)
      .map(a=>`${a.time||'--'} ${a.patient||a.nome||'?'}`);

    _snapshot = { hora, totalPac, criticos, pacCriticos, consHoje, consConf, proxConsultas,
                  camasOcup, camasTotal, totalFat, totalPago, fatPend, waQueue, unreadNotif };
  } catch(e) { console.warn('[ARIA Bridge]', e.message); }
}

function _buildContext(s) {
  if (!s) return '';
  const taxa = s.camasTotal > 0 ? Math.round(s.camasOcup/s.camasTotal*100) : 0;
  return `\n\n══════════ DADOS REAIS FUMUGOLD · ${s.hora} ══════════` +
    `\n🏥 Pacientes: ${s.totalPac} | Críticos: ${s.criticos}${s.pacCriticos.length?' — '+s.pacCriticos.join(', '):''}` +
    `\n📅 Consultas hoje: ${s.consHoje} (${s.consConf} confirmadas)${s.proxConsultas.length?' | '+s.proxConsultas.join(' · '):''}` +
    `\n🛏️ Internamento: ${s.camasOcup}/${s.camasTotal} camas (${taxa}%)` +
    `\n💰 Faturado: ${(s.totalFat/1000).toFixed(1)}K AOA | Recebido: ${(s.totalPago/1000).toFixed(1)}K AOA | ${s.fatPend} pendentes` +
    `\n📱 WhatsApp: ${s.waQueue} por responder | 🔔 ${s.unreadNotif} notificações` +
    `\n══════════════════════════════════════════════════`;
}

function _injectContext(body) {
  if (!Array.isArray(body?.messages) || !body.messages.length) return body;
  updateClinicSnapshot();
  const ctx = _buildContext(_snapshot);
  if (!ctx) return body;

  const msgs   = [...body.messages];
  const sysIdx = msgs.findIndex(m => m.role === 'system');
  if (sysIdx >= 0) {
    msgs[sysIdx] = { ...msgs[sysIdx], content: msgs[sysIdx].content + ctx };
  } else {
    msgs.unshift({ role: 'system', content: `Dados da clínica em tempo real:${ctx}` });
  }
  return { ...body, messages: msgs };
}

// FIX E4: UM único proxy intercepta AMBOS os endpoints
// O segundo proxy em v2 capturava window.fetch (já era o proxy!) → loop
export function installARIABridge() {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;

  const _originalFetch = window.fetch.bind(window); // captura o fetch NATIVO uma vez

  window.fetch = function fgARIAProxy(input, init, ...rest) {
    const url = typeof input === 'string' ? input : (input?.url || '');

    // Intercepta OpenRouter e Groq no mesmo proxy
    if ((url === OR_ENDPOINT || url === GROQ_ENDPOINT) && init?.body) {
      try {
        const body    = JSON.parse(init.body);
        const patched = _injectContext(body);
        if (patched !== body) init = { ...init, body: JSON.stringify(patched) };
      } catch { /* corpo inválido — passa sem alterar */ }
    }

    return _originalFetch(input, init, ...rest);
  };

  setInterval(updateClinicSnapshot, 60000);
  updateClinicSnapshot();
  console.info('[FumuGold] ARIA Bridge v2.1 activo — OR + Groq intercept');
}
