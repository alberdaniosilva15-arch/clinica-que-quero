// ═══════════════════════════════════════════════════════════
// FUMUGOLD — WhatsApp AI v1.0
// IA responde automaticamente via Groq (rápido)
// Classifica, prioriza e escala urgências
// Fluxo: n8n → Supabase → WhatsApp AI → resposta automática
// ═══════════════════════════════════════════════════════════
import { aiRouter, waReply }   from './ai_router.js';
import { logAction }           from './audit_log.js';
import { getClinicMeta }       from './multi_clinic.js';
import { fetchFromSupabase, patchSupabase } from '../supabase_sync.js';

// Env vars no top-level (Vite substitui em compile time — try/catch seria código morto)
const _ENV_N8N = import.meta.env.VITE_N8N_WEBHOOK || '';

// ── Categorias de mensagens ───────────────────────────────
export const WA_CATEGORIES = {
  EMERGENCY:    { id: 'emergency',   label: '🔴 Emergência',   priority: 0, autoReply: false, escalate: true  },
  APPOINTMENT:  { id: 'appointment', label: '📅 Agendamento',  priority: 1, autoReply: true,  escalate: false },
  EXAM_RESULT:  { id: 'exam_result', label: '🔬 Resultado',    priority: 2, autoReply: true,  escalate: false },
  PRESCRIPTION: { id: 'prescription',label: '💊 Prescrição',   priority: 2, autoReply: true,  escalate: false },
  PAYMENT:      { id: 'payment',     label: '💰 Pagamento',    priority: 3, autoReply: true,  escalate: false },
  INFO:         { id: 'info',        label: '💬 Informação',   priority: 3, autoReply: true,  escalate: false },
  COMPLAINT:    { id: 'complaint',   label: '⚠️ Reclamação',   priority: 2, autoReply: false, escalate: true  },
  GENERAL:      { id: 'general',     label: '💬 Geral',        priority: 4, autoReply: true,  escalate: false },
};

// ── Padrões de classificação (rápido, sem IA) ─────────────
const PATTERNS = [
  { cat: 'EMERGENCY',   regex: /emerg|urgente|grave|soc[oa]rro|estou passando?|não consigo respirar|tontur|desmaiou|sangr/ },
  { cat: 'APPOINTMENT', regex: /consul|agend|marc|remarc|desmarca|horário|vaga|médico disponível|próxima consulta/ },
  { cat: 'EXAM_RESULT', regex: /resultado|exame|análise|laboratório|laudo|teste|antígeno|pcr|hemograma/ },
  { cat: 'PRESCRIPTION',regex: /receita|medicamento|prescri|farmácia|remédio|dose|comprimido/ },
  { cat: 'PAYMENT',     regex: /pagar|fatura|pagamento|conta|saldo|valor|quanto fica|preço/ },
  { cat: 'COMPLAINT',   regex: /reclamação|reclamar|descontente|péssimo|mal atendid|demora|espera muito/ },
];

// ── classify ──────────────────────────────────────────────
// Classifica mensagem: primeiro tenta padrões, depois IA se ambíguo
export async function classify(message, useAI = false) {
  const text = (message || '').toLowerCase();

  // Classificação por regex (instantânea)
  for (const { cat, regex } of PATTERNS) {
    if (regex.test(text)) {
      return { ...WA_CATEGORIES[cat], confidence: 'high', method: 'pattern' };
    }
  }

  // Classificação por IA (Groq, ~500ms)
  if (useAI) {
    try {
      const result = await aiRouter.chat({
        messages: [{ role: 'user', content: `Classifica esta mensagem WhatsApp de um cliente de clínica médica em Angola:\n"${message}"\n\nResponde APENAS com uma destas categorias: emergency, appointment, exam_result, prescription, payment, complaint, general` }],
        intent: 'classify', maxTokens: 20, temperature: 0,
      });
      const cat = result.content?.trim().toLowerCase().replace(/[^a-z_]/g, '');
      const found = Object.values(WA_CATEGORIES).find(c => c.id === cat);
      if (found) return { ...found, confidence: 'medium', method: 'ai' };
    } catch {}
  }

  return { ...WA_CATEGORIES.GENERAL, confidence: 'low', method: 'fallback' };
}

// ── generateAutoReply ─────────────────────────────────────
// Gera resposta automática baseada na categoria
export async function generateAutoReply(message, category, clientContext = {}) {
  const cat     = WA_CATEGORIES[category?.id?.toUpperCase() || 'GENERAL'];
  const clinic  = getClinicMeta();
  const clinicName = clinic?.name || 'FumuGold';

  // Categorias que não têm auto-reply
  if (!cat?.autoReply) return null;

  // Templates rápidos para categorias comuns (sem IA)
  const TEMPLATES = {
    APPOINTMENT: `Olá! 👋 Recebemos o seu pedido de ${clinicName}.\n\nPara agendar a sua consulta, responda com:\n• Nome completo\n• Data pretendida\n• Tipo de consulta\n\nOu ligue-nos directamente. Respondemos em breve! 🙏`,

    PAYMENT: `Olá! Para informações sobre pagamentos, pode contactar a nossa recepção ou enviar o seu número de fatura.\n\nAceitamos: Dinheiro, Transferência bancária, Multicaixa.\n\n${clinicName} — sempre ao seu serviço. 😊`,

    EXAM_RESULT: `Olá! Os resultados dos seus exames estão disponíveis.\n\nPor questões de privacidade, os resultados são entregues:\n• Pessoalmente na recepção\n• Via portal seguro (se disponível)\n• Na consulta com o seu médico\n\nPrecisa de ajuda adicional? Estamos aqui! 🏥`,
  };

  if (TEMPLATES[category?.id?.toUpperCase()]) {
    return { text: TEMPLATES[category.id.toUpperCase()], method: 'template', category };
  }

  // IA para categorias sem template
  try {
    const contextStr = clientContext.name
      ? `Cliente: ${clientContext.name}. Histórico: ${clientContext.totalMsgs || 0} mensagens.`
      : '';

    const result = await waReply(message, contextStr);
    return { text: result.content || result, method: 'ai', category };
  } catch {
    return {
      text:   `Olá! Recebemos a sua mensagem. Um membro da nossa equipa responderá em breve.\n\n${clinicName} 🏥`,
      method: 'fallback', category,
    };
  }
}

// ── processIncoming ───────────────────────────────────────
// Processa mensagem recebida: classifica + auto-reply + escalada
export async function processIncoming(message, phone, clientContext = {}) {
  const t0 = Date.now();

  // 1. Classifica
  const category = await classify(message, false); // pattern first
  const shouldEscalate = category.escalate || category.id === 'emergency';

  // 2. Gera resposta automática (se aplicável)
  let autoReply = null;
  const settings = _getSettings();

  if (settings.autoReplyEnabled && category.autoReply && !shouldEscalate) {
    autoReply = await generateAutoReply(message, category, clientContext);
  }

  // 3. Envia resposta automática
  if (autoReply?.text) {
    await _sendReply(phone, autoReply.text, 'ARIA Auto');
  }

  // 4. Marca para humano se necessário
  if (shouldEscalate) {
    await _escalateToHuman(phone, message, category);
  }

  // 5. Cria alerta se emergência
  if (category.id === 'emergency') {
    window.dispatchEvent(new CustomEvent('fg_emergency_alert', {
      detail: { phone, message, category, ts: new Date().toISOString() },
    }));
  }

  const ms = Date.now() - t0;
  await logAction('WA:PROCESS', { phone, category: category.id, autoReplied: !!autoReply, escalated: shouldEscalate, ms });

  return { category, autoReply, escalated: shouldEscalate, ms };
}

// ── summarizeConversation ─────────────────────────────────
export async function summarizeConversation(messages = []) {
  if (!messages.length) return 'Sem mensagens.';
  const transcript = messages.slice(-20)
    .map(m => `${m.role === 'client' ? 'Cliente' : 'FumuGold'}: ${m.text || m.content || ''}`)
    .join('\n');

  const result = await aiRouter.chat({
    messages: [{ role: 'user', content: `Resume esta conversa WhatsApp médica em 2-3 linhas: assunto, estado, próximo passo.\n\n${transcript}` }],
    intent: 'summary', maxTokens: 150, temperature: 0.2,
  });
  return result.content || result;
}

// ── suggestReply ──────────────────────────────────────────
// Sugere respostas para o staff (não envia automaticamente)
export async function suggestReply(conversation, category) {
  const lastMsg = conversation[conversation.length - 1]?.text || '';
  const catCtx  = `Categoria: ${category?.label || 'Geral'}`;

  const result = await aiRouter.chat({
    messages: [{ role: 'user', content: `Sugere 3 respostas diferentes (curtas, profissionais) para este cliente:\n"${lastMsg}"\n${catCtx}` }],
    intent: 'quick_reply', maxTokens: 300, temperature: 0.6,
  });

  const text = result.content || result;
  // Separa sugestões numeradas
  return text.split(/\n\d+[.)]\s+/).filter(s => s.trim().length > 10).slice(0, 3);
}

// ── getWAStats ────────────────────────────────────────────
export async function getWAStats() {
  try {
    const convs = await fetchFromSupabase('fg_whatsapp_conversations', {
      select: 'id,data,updated_at',
      orderBy: { col: 'updated_at', asc: false },
      limit: 200,
    });

    const today = new Date().toISOString().slice(0, 10);

    const stats = {
      total:         convs.length,
      activeToday:   convs.filter(c => c.updated_at?.startsWith(today)).length,
      waiting:       convs.filter(c => c.data?.status === 'waiting').length,
      emergency:     convs.filter(c => c.data?.urgencia === 'critica').length,
      avgResponseMs: 0,
    };

    return stats;
  } catch { return { total: 0, activeToday: 0, waiting: 0, emergency: 0 }; }
}

// ── Config ────────────────────────────────────────────────
function _getSettings() {
  try {
    return JSON.parse(localStorage.getItem('fg_wa_settings') || '{}');
  } catch { return {}; }
}

export function saveWASettings(settings) {
  try { localStorage.setItem('fg_wa_settings', JSON.stringify({ ..._getSettings(), ...settings })); return true; } catch { return false; }
}

// ── Helpers ───────────────────────────────────────────────
async function _sendReply(phone, text, staffName) {
  const webhook = _n8nUrl();
  if (!webhook) return;
  try {
    await fetch(`${webhook}/webhook/fumugold-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message: text, staff: staffName, ts: new Date().toISOString() }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {}
}

// B7-FIX: usa PATCH com merge do campo data usando jsonb_set via RPC
// Em vez de substituir data inteiro, faz merge dos campos específicos
async function _escalateToHuman(phone, message, category) {
  try {
    // Lê a conversa actual primeiro para fazer merge seguro
    // Utiliza fetchFromSupabase importado estaticamente
    const rows = await fetchFromSupabase('fg_whatsapp_conversations', {
      filters: [{ col: 'id', op: 'eq', val: phone }],
      limit: 1,
    });

    const current = rows[0]?.data || {};
    const merged  = {
      ...current,
      status:   'waiting',
      urgencia: category.id === 'emergency' ? 'critica' : 'normal',
      last_msg: message,
    };

    // Utiliza patchSupabase importado estaticamente
    await patchSupabase(
      'fg_whatsapp_conversations',
      { col: 'id', op: 'eq', val: phone },
      { data: merged, updated_at: new Date().toISOString() }
    );
  } catch {}
}

function _n8nUrl() {
  return (_ENV_N8N || localStorage.getItem('fg_n8n_webhook') || '').replace(/\/$/, '');
}
