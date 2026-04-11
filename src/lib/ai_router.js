// ═══════════════════════════════════════════════════════════
// FUMUGOLD — AI Router v1.0
// Tier 1: DeepSeek R1 (OpenRouter) — raciocínio clínico
// Tier 2: Groq Llama 3.1 70B — respostas rápidas (<1s)
// Tier 3: Gemma local via Groq — fallback rápido
// Tier 4: Análise offline — zero rede
// ═══════════════════════════════════════════════════════════

// ── Modelos ───────────────────────────────────────────────
export const AI_MODELS = {
  // Tier 1 — Raciocínio profundo (OpenRouter)
  DEEPSEEK_R1:    'deepseek/deepseek-r1:free',
  DEEPSEEK_V3:    'deepseek/deepseek-chat-v3-0324:free',

  // Tier 2 — Velocidade (Groq — <1s)
  GROQ_LLAMA70B:  'llama-3.1-70b-versatile',
  GROQ_LLAMA8B:   'llama-3.1-8b-instant',
  GROQ_MIXTRAL:   'mixtral-8x7b-32768',
  GROQ_GEMMA:     'gemma2-9b-it',

  // Tier 3 — Raciocínio rápido Groq
  GROQ_R1_DISTILL: 'deepseek-r1-distill-llama-70b',

  // Tier NVIDIA NIM (Enterprise)
  NVIDIA_LLAMA70B: 'meta/llama-3.1-70b-instruct',
};

// B11-FIX: import.meta.env lido no top-level (Vite substitui em compile time)
// try/catch em import.meta.env nunca executa — o catch era código morto
const _ENV_OR_KEY     = import.meta.env.VITE_OPENROUTER_KEY  || '';
const _ENV_GROQ_KEY   = import.meta.env.VITE_GROQ_KEY        || '';
const _ENV_NVIDIA_KEY = import.meta.env.VITE_NVIDIA_KEY      || '';

// ── Classe AIRouter ───────────────────────────────────────
class AIRouter {
  constructor() {
    this._metrics = {
      calls:    0,
      errors:   0,
      avgMs:    0,
      byModel:  {},
    };
  }

  // B11-FIX: usa constantes top-level — localStorage como fallback real
  _orKey()     { return _ENV_OR_KEY     || localStorage.getItem('fg_openrouter_key') || ''; }
  _groqKey()   { return _ENV_GROQ_KEY   || localStorage.getItem('fg_groq_key')       || ''; }
  _nvidiaKey() { return _ENV_NVIDIA_KEY || ''; }

  _orUrl()     { return 'https://openrouter.ai/api/v1/chat/completions'; }
  _groqUrl()   { return 'https://api.groq.com/openai/v1/chat/completions'; }
  _nvidiaUrl() { return 'https://integrate.api.nvidia.com/v1/chat/completions'; }

  // ── Método central: chat com routing automático ─────────
  async chat(opts = {}) {
    const {
      messages,
      systemPrompt  = '',
      intent        = 'general',   // 'clinical_reason' | 'quick_reply' | 'wa_reply' | 'dosage' | 'general'
      maxTokens     = 800,
      temperature   = 0.3,
      stream        = false,
      onChunk,
      onDone,
    } = opts;

    const t0 = Date.now();
    this._metrics.calls++;

    // Decide o tier baseado na intenção
    const tier = this._selectTier(intent);

    let result;
    let usedModel = '';

    try {
      switch (tier) {
        case 0:
          ({ result, usedModel } = await this._callNvidia(messages, systemPrompt, maxTokens, temperature, stream, onChunk, onDone));
          break;
        case 1:
          ({ result, usedModel } = await this._callDeepSeek(messages, systemPrompt, maxTokens, temperature, stream, onChunk, onDone));
          break;
        case 2:
          ({ result, usedModel } = await this._callGroq(messages, systemPrompt, maxTokens, temperature, stream, onChunk, onDone, AI_MODELS.GROQ_LLAMA70B));
          break;
        case 3:
          ({ result, usedModel } = await this._callGroq(messages, systemPrompt, maxTokens, temperature, stream, onChunk, onDone, AI_MODELS.GROQ_GEMMA));
          break;
        default:
          if (this._nvidiaKey()) {
             ({ result, usedModel } = await this._callNvidia(messages, systemPrompt, maxTokens, temperature, stream, onChunk, onDone));
          } else {
             ({ result, usedModel } = await this._callDeepSeek(messages, systemPrompt, maxTokens, temperature, stream, onChunk, onDone));
          }
      }
    } catch (e) {
      this._metrics.errors++;
      // Cascata de fallback
      result = await this._fallbackCascade(messages, systemPrompt, maxTokens, temperature, e.message, stream, onChunk, onDone);
      usedModel = result.model || 'fallback';
    }

    const elapsed = Date.now() - t0;
    this._updateMetrics(usedModel, elapsed);

    return { content: result.content || result, model: usedModel, ms: elapsed };
  }

  // ── Tier selector ────────────────────────────────────────
  _selectTier(intent) {
    // Se tiver NVIDIA NIM, é o Tier 0 (Prioridade máxima/Enterprise)
    if (this._nvidiaKey()) return 0;

    // Clínico complexo → DeepSeek R1 (Tier 1)
    if (['clinical_reason', 'dosage', 'diagnosis'].includes(intent)) return 1;
    // Resposta rápida → Groq (Tier 2)
    if (['quick_reply', 'wa_reply', 'classify', 'summary'].includes(intent)) return 2;
    // Groq rápido (Tier 2) se tivermos chave, senão DeepSeek (Tier 1)
    return this._groqKey() ? 2 : 1;
  }

  // ── Tier 0: NVIDIA NIM ──────────────────────────────────
  async _callNvidia(messages, systemPrompt, maxTokens, temperature, stream, onChunk, onDone) {
    const key = this._nvidiaKey();
    const allMsgs = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const res = await fetch(this._nvidiaUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: AI_MODELS.NVIDIA_LLAMA70B,
        messages: allMsgs,
        max_tokens: maxTokens,
        temperature,
        stream
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) throw new Error(`NVIDIA NIM ${res.status}`);

    if (stream && res.body) {
      const content = await this._readStream(res.body, onChunk, onDone, false);
      return { content, model: AI_MODELS.NVIDIA_LLAMA70B };
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    return { content, model: AI_MODELS.NVIDIA_LLAMA70B };
  }

  // ── Tier 1: DeepSeek via OpenRouter ─────────────────────
  async _callDeepSeek(messages, systemPrompt, maxTokens, temperature, stream, onChunk, onDone) {
    const key = this._orKey();
    const allMsgs = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const endpoint = key ? this._orUrl() : '/api/ai/chat';
    const headers  = {
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://fumugold.app',
      'X-Title': 'FumuGold ARIA',
    };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const model = AI_MODELS.DEEPSEEK_R1;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages: allMsgs, max_tokens: maxTokens, temperature, stream }),
      signal: AbortSignal.timeout(45000),
    });

    if (!res.ok) throw new Error(`DeepSeek ${res.status}`);

    if (stream && res.body) {
      const content = await this._readStream(res.body, onChunk, onDone, true); // true = filter <think>
      return { content, model };
    }

    const data    = await res.json();
    const content = this._stripThink(data.choices?.[0]?.message?.content || '');
    return { content, model };
  }

  // ── Tier 2/3: Groq ───────────────────────────────────────
  async _callGroq(messages, systemPrompt, maxTokens, temperature, stream, onChunk, onDone, model) {
    const key = this._groqKey();
    if (!key) throw new Error('Groq key não configurada');

    const allMsgs = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const res = await fetch(this._groqUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({ model, messages: allMsgs, max_tokens: maxTokens, temperature, stream }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`Groq ${res.status}`);

    if (stream && res.body) {
      const content = await this._readStream(res.body, onChunk, onDone, false);
      return { content, model };
    }

    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    return { content, model };
  }

  // ── Fallback cascade ──────────────────────────────────────
  async _fallbackCascade(messages, systemPrompt, maxTokens, temperature, prevError, stream, onChunk, onDone) {
    const attempts = [];

    // Tenta Groq se não foi o erro inicial
    if (!prevError.includes('Groq') && this._groqKey()) {
      try {
        return await this._callGroq(messages, systemPrompt, maxTokens, temperature, stream, onChunk, onDone, AI_MODELS.GROQ_GEMMA);
      } catch (e) { attempts.push(`Groq: ${e.message}`); }
    }

    // Tenta DeepSeek V3 free
    try {
      const key = this._orKey();
      if (key) {
        const allMsgs = systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages;
        const res = await fetch(this._orUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': 'https://fumugold.app' },
          body: JSON.stringify({ model: AI_MODELS.DEEPSEEK_V3, messages: allMsgs, max_tokens: Math.min(maxTokens, 600), temperature }),
          signal: AbortSignal.timeout(20000),
        });
        if (res.ok) {
          const d = await res.json();
          return { content: d.choices?.[0]?.message?.content || '', model: AI_MODELS.DEEPSEEK_V3 };
        }
      }
    } catch (e) { attempts.push(`DeepSeek V3: ${e.message}`); }

    // Fallback offline
    const lastMsg = messages[messages.length - 1]?.content || '';
    return { content: this._offlineResponse(lastMsg), model: 'offline' };
  }

  // ── Stream reader ─────────────────────────────────────────
  async _readStream(body, onChunk, onDone, filterThink = false) {
    const reader  = body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';
    let   full    = '';
    let   inThink = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (json === '[DONE]') { onDone?.(); return full; }
        try {
          const delta = JSON.parse(json).choices?.[0]?.delta?.content || '';
          if (!delta) continue;

          if (filterThink) {
            let out = '';
            let i   = 0;
            while (i < delta.length) {
              if (!inThink && delta.slice(i, i+7) === '<think>') { inThink = true; i += 7; continue; }
              if (inThink  && delta.slice(i, i+8) === '</think>') { inThink = false; i += 8; continue; }
              if (!inThink) out += delta[i];
              i++;
            }
            if (out) { full += out; onChunk?.(out); }
          } else {
            full += delta;
            onChunk?.(delta);
          }
        } catch {}
      }
    }
    onDone?.();
    return full;
  }

  // ── Resposta offline ──────────────────────────────────────
  _offlineResponse(prompt) {
    const p = (prompt || '').toLowerCase();
    const now = new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    if (/malária|paludismo/.test(p))
      return `▸ ARIA (offline) · ${now}\n\n**Malária** — Protocolo Angola:\n• Arteméter + Lumefantrina (AL) 3 dias\n• Artesunato IV formas graves\n• Realizar TDR antes de tratar\n• Crianças < 5 anos: dose ajustada por peso`;

    if (/dose|dosagem|peso/.test(p))
      return `▸ ARIA (offline) · ${now}\n\nSem acesso à IA online. Para cálculo de dosagem, consulta o serviço dosage_calculator disponível localmente.`;

    return `▸ ARIA (offline) · ${now}\n\nSem conexão à IA online. Verifica a chave OpenRouter/Groq em Configurações → Integrações.\n\nPara emergências clínicas, consulta os protocolos locais.`;
  }

  _stripThink(text = '') { return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }

  _updateMetrics(model, ms) {
    this._metrics.avgMs = Math.round((this._metrics.avgMs * (this._metrics.calls - 1) + ms) / this._metrics.calls);
    if (!this._metrics.byModel[model]) this._metrics.byModel[model] = { calls: 0, avgMs: 0 };
    const m = this._metrics.byModel[model];
    m.calls++;
    m.avgMs = Math.round((m.avgMs * (m.calls - 1) + ms) / m.calls);
  }

  getMetrics() { return this._metrics; }
}

// ── Singleton ─────────────────────────────────────────────
export const aiRouter = new AIRouter();

// ── Helpers de alto nível ────────────────────────────────

// Raciocínio clínico profundo (DeepSeek R1)
export function clinicalReason(messages, systemPrompt, opts = {}) {
  return aiRouter.chat({ messages, systemPrompt, intent: 'clinical_reason', maxTokens: 1200, temperature: 0.2, ...opts });
}

// Resposta rápida (Groq <1s)
export function quickReply(messages, systemPrompt, opts = {}) {
  return aiRouter.chat({ messages, systemPrompt, intent: 'quick_reply', maxTokens: 400, temperature: 0.4, ...opts });
}

// Resposta WhatsApp (curta, directa)
export function waReply(clientMsg, context = '', opts = {}) {
  return aiRouter.chat({
    messages: [{ role: 'user', content: clientMsg }],
    systemPrompt: `És a ARIA da FumuGold. Resposta CURTA (2-3 frases) em Português de Angola. ${context}`,
    intent: 'wa_reply', maxTokens: 200, temperature: 0.5, ...opts,
  });
}

// Dosagem (ver dosage_calculator.js)
export function dosageReason(prompt, patientContext = '') {
  return aiRouter.chat({
    messages: [{ role: 'user', content: prompt }],
    systemPrompt: `És um farmacologista clínico. Calculas dosagens baseadas em peso, idade e condição. ${patientContext}`,
    intent: 'dosage', maxTokens: 500, temperature: 0.1,
  });
}

// Guardar chave Groq
export function saveGroqKey(key) {
  try { localStorage.setItem('fg_groq_key', key); return true; } catch { return false; }
}
