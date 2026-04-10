// ═══════════════════════════════════════════════════════════
// FUMUGOLD — WhatsApp Realtime v3.1  [CORRIGIDO]
// FIX E3: require() removido — import estático no topo
// Supabase Realtime WebSocket + polling fallback
// ═══════════════════════════════════════════════════════════
import { fetchFromSupabase } from '../supabase_sync.js';

const _ENV_URL = import.meta.env.VITE_SUPABASE_URL       || '';
const _ENV_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY  || '';

function _cfg() {
  return {
    url: _ENV_URL || localStorage.getItem('fg_supabase_url') || '',
    key: _ENV_KEY || localStorage.getItem('fg_supabase_key') || '',
  };
}

// ── Supabase Realtime via Phoenix WebSocket ───────────────
class SupabaseRealtime {
  constructor(table, onData) {
    this.table   = table;
    this.onData  = onData;
    this.ws      = null;
    this.ref     = 1;
    this.hbTimer = null;
    this.retries = 0;
    this.maxRetry = 10;
    this.dead    = false;
  }

  connect() {
    if (this.dead) return false;
    const { url, key } = _cfg();
    if (!url || !key) return false;

    const wsUrl = `${url.replace('https://','wss://').replace('http://','ws://')}/realtime/v1/websocket?apikey=${key}&vsn=1.0.0`;
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.onopen    = () => { this.retries = 0; this._join(); this._startHB(); console.info('[WA Realtime] Ligado.'); };
      this.ws.onmessage = (ev) => { try { this._handle(JSON.parse(ev.data)); } catch {} };
      this.ws.onerror   = () => {};
      this.ws.onclose   = () => {
        this._stopHB();
        if (!this.dead) {
          const delay = Math.min(1000 * Math.pow(2, this.retries++), 30000);
          if (this.retries <= this.maxRetry) setTimeout(() => this.connect(), delay);
        }
      };
      return true;
    } catch { return false; }
  }

  _join() {
    this._send({ topic:`realtime:public:${this.table}`, event:'phx_join',
      payload:{ config:{ broadcast:{self:false}, presence:{key:''},
        postgres_changes:[{event:'*',schema:'public',table:this.table}] } },
      ref: String(this.ref++) });
  }

  _handle(msg) {
    if (msg.event === 'postgres_changes') {
      const { type, record } = msg.payload || {};
      if ((type === 'INSERT' || type === 'UPDATE') && record) this.onData(record, type);
    }
  }

  _startHB() {
    this.hbTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN)
        this._send({ topic:'phoenix', event:'heartbeat', payload:{}, ref:String(this.ref++) });
    }, 25000);
  }

  _stopHB()  { if (this.hbTimer) { clearInterval(this.hbTimer); this.hbTimer = null; } }
  _send(obj) { if (this.ws?.readyState === WebSocket.OPEN) try { this.ws.send(JSON.stringify(obj)); } catch {} }

  disconnect() { this.dead = true; this._stopHB(); try { this.ws?.close(); } catch {} }
}

// ── Overlay panel DOM ─────────────────────────────────────
let _el   = null;
let _msgs = [];
const MAX = 15;

function _installOverlay() {
  if (_el || typeof document === 'undefined') return;
  _el = document.createElement('div');
  _el.id = 'fg-wa-overlay';
  document.body.appendChild(_el);
  _render();
}

function _render() {
  if (!_el) return;
  const count = _msgs.filter(m => m.unread).length;
  _el.innerHTML = `<div style="position:fixed;bottom:20px;right:20px;z-index:99999;width:300px;font-family:'Rajdhani',sans-serif;">
    <button id="fg-wa-tog" style="width:100%;display:flex;align-items:center;justify-content:space-between;
      background:rgba(4,3,1,0.97);border:1px solid rgba(0,255,136,0.4);border-radius:4px 4px 0 0;
      padding:8px 12px;cursor:pointer;color:#EEE4C0;font-family:Orbitron,monospace;font-size:9px;letter-spacing:1.5px;">
      <span>📱 WHATSAPP LIVE</span>
      ${count>0?`<span style="background:#00FF88;color:#040301;border-radius:8px;padding:2px 7px;font-size:9px;font-weight:700">${count}</span>`:''}
    </button>
    <div id="fg-wa-list" style="display:none;background:rgba(4,3,1,0.97);
      border:1px solid rgba(0,255,136,0.25);border-top:none;border-radius:0 0 4px 4px;
      max-height:320px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#00FF88 #080600;">
      ${_msgs.length===0
        ? '<div style="padding:16px;text-align:center;color:rgba(106,90,50,0.6);font-size:11px;">Nenhuma mensagem</div>'
        : _msgs.map(m=>`<div style="padding:10px 12px;border-bottom:1px solid rgba(212,175,55,0.08);">
            <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
              <span style="font-size:11px;font-weight:600;color:${m.unread?'#EEE4C0':'#6A5A32'}">${m.from}</span>
              <span style="font-size:9px;color:#6A5A32">${m.time}</span>
            </div>
            <div style="font-size:11px;color:#9A8A5A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.msg}</div>
          </div>`).join('')}
    </div>
  </div>`;

  const tog  = _el.querySelector('#fg-wa-tog');
  const list = _el.querySelector('#fg-wa-list');
  if (tog && list) {
    tog.onclick = () => {
      const showing = list.style.display !== 'none';
      list.style.display = showing ? 'none' : 'block';
      if (!showing) { _msgs = _msgs.map(m=>({...m,unread:false})); _render(); }
    };
  }
}

function _processRecord(record) {
  const d    = record.data || {};
  const msgs = Array.isArray(d.msgs) ? d.msgs : [];
  const last = msgs[msgs.length-1];
  const text = last?.text || d.last_msg || '';
  const t    = text.toLowerCase();
  const type = /emerg|socorro/.test(t)?'alerta':/consul|agendar/.test(t)?'agenda':/exame/.test(t)?'lab':'normal';

  const msg = {
    id:       `wa_${record.id}_${Date.now()}`,
    from:     d.name || d.phone || record.id,
    initials: 'WA', cor: '#00FF88',
    msg:      text,
    time:     new Date().toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}),
    unread:   true, type, channel: 'WhatsApp',
    phone:    d.phone || record.id,
    waStatus: d.status || 'active',
  };

  _msgs = [msg, ..._msgs].slice(0, MAX);
  _render();

  window.dispatchEvent(new CustomEvent('fg_wa_message', { detail: msg }));
  window.dispatchEvent(new CustomEvent('fg_wa_update',  { detail: { record } }));

  _notify(msg);
}

// ── Browser notifications ─────────────────────────────────
let _notifPerm = 'default';
async function _reqNotif() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') { _notifPerm = Notification.permission; return; }
  try { _notifPerm = await Notification.requestPermission(); } catch {}
}
function _notify(msg) {
  if (_notifPerm !== 'granted') return;
  try { new Notification(`📱 ${msg.from}`, { body: msg.msg.slice(0,80), tag:`fg_wa_${msg.phone}` }); } catch {}
}

// ── startWhatsAppRealtime ─────────────────────────────────
export function startWhatsAppRealtime() {
  if (typeof window === 'undefined') return () => {};

  _installOverlay();
  _reqNotif();

  const rt        = new SupabaseRealtime('fg_whatsapp_conversations', _processRecord);
  const connected = rt.connect();

  // FIX E3: polling fallback usa import estático (não require)
  let pollTimer = null;
  if (!connected) {
    let lastCheck = new Date(Date.now() - 60000).toISOString();
    pollTimer = setInterval(async () => {
      try {
        const rows = await fetchFromSupabase('fg_whatsapp_conversations', {
          filters: [{ col: 'updated_at', op: 'gte', val: lastCheck }],
          orderBy: { col: 'updated_at', asc: false }, limit: 10,
        });
        if (rows.length > 0) { lastCheck = new Date().toISOString(); rows.forEach(r => _processRecord(r)); }
      } catch {}
    }, 15000);
  }

  console.info(`[FumuGold] WhatsApp ${connected ? 'Realtime WebSocket' : 'Polling fallback'} activo.`);

  return () => {
    rt.disconnect();
    if (pollTimer) clearInterval(pollTimer);
    _el?.remove();
    _el = null;
  };
}
