// ═══════════════════════════════════════════════════════════
// FUMUGOLD — useARIAData v3.0
// Agrega dados clínica (local) + WhatsApp (Supabase) para a ARIA
// Refresh automático a cada 30s
// ═══════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react';
import { fetchFromSupabase } from '../supabase_sync.js';

const REFRESH_MS = 30000;

export function useARIAData(clinicData = {}) {
  const {
    patients      = [],
    appointments  = [],
    invoices      = [],
    notifications = [],
  } = clinicData;

  const [raw,     setRaw]     = useState(null);
  const [kpis,    setKpis]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [lastAt,  setLastAt]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const today   = new Date().toISOString().split('T')[0];
      const since7  = new Date(Date.now() - 7  * 86400000).toISOString();
      const since14 = new Date(Date.now() - 14 * 86400000).toISOString();
      const since1h = new Date(Date.now() - 3600000).toISOString();

      // Tenta carregar dados WhatsApp do Supabase
      const [waConvs, routing, queue, alerts] = await Promise.all([
        fetchFromSupabase('fg_whatsapp_conversations', {
          select:  'id,data,updated_at',
          orderBy: { col: 'updated_at', asc: false },
          limit:   300,
        }),
        fetchFromSupabase('message_routing', {
          select:  'phone,contact_name,message,categoria,sentimento,urgencia,necessita_humano,timestamp',
          orderBy: { col: 'timestamp', asc: false },
          limit:   500,
        }).catch(() => []),
        fetchFromSupabase('live_chat_queue', {
          select:  'ticket_id,phone,contact_name,last_message,categoria,status,priority,wait_since',
          orderBy: { col: 'wait_since', asc: true },
          limit:   100,
        }).catch(() => []),
        fetchFromSupabase('urgent_alerts', {
          select:  'id,phone,contact_name,message,urgencia,resolved,timestamp',
          filters: [{ col: 'resolved', op: 'eq', val: 'false' }],
          limit:   50,
        }).catch(() => []),
      ]);

      // ── KPIs WhatsApp via fg_whatsapp_conversations ────
      const clientes    = waConvs.map(r => ({ ...r.data, _updated: r.updated_at }));
      const totalClientes       = clientes.length;
      const vipCount            = clientes.filter(c => c.is_vip).length;
      const ativos7d            = clientes.filter(c => c._updated >= since7).length;
      const inativos14d         = clientes.filter(c => !c._updated || c._updated < since14).length;
      const totalMsgsHistorico  = clientes.reduce((s, c) => s + ((c.msgs || []).length), 0);

      // Routing (tabela separada — pode não existir)
      const msgsHoje       = routing.filter(r => (r.timestamp || '').startsWith(today)).length;
      const msgsUltimaHora = routing.filter(r => (r.timestamp || '') >= since1h).length;

      const sentPos    = routing.filter(r => r.sentimento === 'positivo').length;
      const sentNeg    = routing.filter(r => r.sentimento === 'negativo').length;
      const sentTotal  = routing.length || 1;
      const pctPos     = Math.round(sentPos / sentTotal * 100);
      const pctNeg     = Math.round(sentNeg / sentTotal * 100);

      const catCount = {};
      routing.forEach(r => { if (r.categoria) catCount[r.categoria] = (catCount[r.categoria] || 0) + 1; });
      const topCats = Object.entries(catCount).sort((a, b) => b[1] - a[1]).slice(0, 5);

      const alertasCriticos  = alerts.filter(a => a.urgencia === 'critica').length;
      const totalAlertas     = alerts.length;
      const aguardandoHumano = queue.filter(q => q.status === 'waiting').length;

      // ── KPIs Clínica (dados do ClinicContext local) ────
      const totalPacientes = patients.length;
      const consultasHoje  = appointments.filter(a => (a.data || a.date || '').slice(0, 10) === today).length;
      const consultasConf  = appointments.filter(a => (a.data || a.date || '').slice(0, 10) === today && (a.estado || a.status) === 'confirmed').length;
      const consultasPend  = appointments.filter(a => (a.data || a.date || '').slice(0, 10) === today && (a.estado || a.status) === 'pending').length;
      const totalFaturado  = invoices.reduce((s, i) => s + (Number(i.amount || i.valor) || 0), 0);
      const totalRecebido  = invoices.filter(i => ['paid', 'pago'].includes(i.status || i.estado)).reduce((s, i) => s + (Number(i.amount || i.valor) || 0), 0);
      const totalPendente  = totalFaturado - totalRecebido;

      const agendaHoje = appointments
        .filter(a => (a.data || a.date || '').slice(0, 10) === today)
        .slice(0, 8)
        .map(a => ({
          hora:          a.time || a.hora || '--:--',
          paciente_nome: a.patient || a.pacienteNome || a.nome || '?',
          medico:        a.dr || a.medico || '?',
          status:        a.status || a.estado || 'pending',
        }));

      setRaw({ clientes, routing, queue, alerts, agendaHoje, chatQueue: queue });
      setKpis({
        totalClientes, vipCount, ativos7d, inativos14d, totalMsgsHistorico,
        msgsHoje, msgsUltimaHora, pctPos, pctNeg, topCats,
        alertasCriticos, totalAlertas, aguardandoHumano,
        totalPacientes, consultasHoje, consultasConf, consultasPend,
        totalFaturado, totalRecebido, totalPendente,
      });
      setLastAt(new Date());

    } catch (e) {
      setError(e.message);
      // Fallback — só dados locais
      setRaw({ clientes: [], routing: [], queue: [], alerts: [], agendaHoje: [], chatQueue: [] });
      setKpis({
        totalClientes: 0, vipCount: 0, ativos7d: 0, inativos14d: 0, totalMsgsHistorico: 0,
        msgsHoje: 0, msgsUltimaHora: 0, pctPos: 0, pctNeg: 0, topCats: [],
        alertasCriticos: 0, totalAlertas: 0, aguardandoHumano: 0,
        totalPacientes: patients.length, consultasHoje: 0, consultasConf: 0, consultasPend: 0,
        totalFaturado: 0, totalRecebido: 0, totalPendente: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [patients.length, appointments.length, invoices.length]);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  return { raw, kpis, loading, error, lastAt, refresh: load };
}

// ── buildARIASystemPrompt ─────────────────────────────────
export function buildARIASystemPrompt(kpis, raw) {
  if (!kpis) {
    return `És a ARIA — Assistente de Inteligência da FumuGold em Luanda, Angola.
Responde SEMPRE em Português de Angola. És directa, precisa e profissional.
Se não tens dados em tempo real, analisa o que sabes sobre o sistema FumuGold
e doenças comuns em Angola (malária, tuberculose, VIH, drepanocitose).`;
  }

  const now   = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Luanda' });
  const today = new Date().toISOString().split('T')[0];

  const agendaStr = (raw?.agendaHoje || [])
    .map(a => `  • ${a.hora} — ${a.paciente_nome} c/ ${a.medico} (${a.status})`)
    .join('\n') || '  Nenhuma agendada';

  const alertasStr = (raw?.alerts || []).slice(0, 5)
    .map(a => `  • ${a.contact_name || a.phone}: ${(a.message || '').slice(0, 60)}`)
    .join('\n') || '  Nenhum';

  const filaStr = (raw?.chatQueue || []).filter(q => q.status === 'waiting').slice(0, 5)
    .map(q => `  • ${q.contact_name || q.phone} — ${q.categoria || '?'}`)
    .join('\n') || '  Nenhuma';

  const catsStr = (kpis.topCats || []).map(([c, n]) => `${c}: ${n}`).join(', ') || 'N/D';

  return `És a ARIA — Assistente de Inteligência da FumuGold em Luanda, Angola.
Responde SEMPRE em Português de Angola. Directa, precisa, profissional.
Tens acesso a dados em TEMPO REAL — nunca inventas números.
Data/hora: ${now}

══════════════ DADOS REAIS DA FUMUGOLD ══════════════

📱 WHATSAPP:
  Clientes: ${kpis.totalClientes} | VIPs: ${kpis.vipCount} | Activos 7d: ${kpis.ativos7d}
  Inativos +14d (churn): ${kpis.inativos14d}
  Msgs hoje: ${kpis.msgsHoje} | Última hora: ${kpis.msgsUltimaHora}
  Categorias: ${catsStr}
  Sentimento: ${kpis.pctPos}% positivo · ${kpis.pctNeg}% negativo

⚠️ URGÊNCIAS:
  Aguardando humano: ${kpis.aguardandoHumano}
  Alertas críticos: ${kpis.alertasCriticos} / ${kpis.totalAlertas} total
${alertasStr !== '  Nenhum' ? alertasStr : ''}
  Fila:
${filaStr}

🏥 CLÍNICA:
  Pacientes: ${kpis.totalPacientes}
  Consultas hoje: ${kpis.consultasHoje} (${kpis.consultasConf} conf · ${kpis.consultasPend} pend)
  Agenda hoje:
${agendaStr}

💰 FINANCEIRO:
  Faturado: ${(kpis.totalFaturado / 1000).toFixed(1)}K AOA
  Recebido: ${(kpis.totalRecebido / 1000).toFixed(1)}K AOA
  Pendente: ${(kpis.totalPendente / 1000).toFixed(1)}K AOA

════════════════════════════════════════════════════

REGRAS:
- Usa SEMPRE os dados acima. Nunca inventas.
- Para acções (enviar msg, criar consulta): confirma antes.
- Se info não está nos dados: diz "não tenho essa informação agora".
- Formato: Markdown. Números exactos.`;
}
