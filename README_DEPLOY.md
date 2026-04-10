# FumuGold V3 — Guia de Deploy

> 🔒 **PROTOCOLO VISUAL SACRED** — O ficheiro `FumuGold_V3_ARIA_visual.jsx` é
> **READ-ONLY TOTAL**. MD5 verificado. Nunca foi modificado.

---

## 📁 Estrutura do Projecto

```
FumuGold_Deploy/
├── index.html                         ← Entry HTML
├── package.json                       ← Dependências
├── vite.config.js                     ← Configuração Vite
├── .env.example                       ← Template de variáveis
├── .gitignore
│
├── src/
│   ├── FumuGold_V3_ARIA_visual.jsx    🔒 VISUAL — NÃO TOCAR (READ-ONLY)
│   │
│   ├── fumugold_local_tools.js        ✅ LÓGICA — Arquivo local, CSV, IA offline
│   ├── supabase_sync.js               ✅ LÓGICA — Sincronização Supabase + WA Bridge
│   ├── main.jsx                       ✅ LÓGICA — Entry point + serviços externos
│   │
│   └── lib/
│       ├── openrouter.js              ✅ LÓGICA — Cliente OpenRouter/DeepSeek R1
│       ├── useARIAData.js             ✅ LÓGICA — Hook de dados ARIA
│       ├── whatsapp_service.js        ✅ LÓGICA — Serviço WhatsApp
│       └── aria_service.js            ✅ LÓGICA — Motor completo ARIA
│
└── supabase/
    └── schema_v4.sql                  ← Schema completo Supabase
```

---

## 🚀 Deploy em 5 Passos

### 1. Instalar dependências
```bash
npm install
```

### 2. Configurar variáveis de ambiente
```bash
cp .env.example .env
# Edita .env com os teus valores reais
```

### 3. Executar o schema no Supabase
1. Abre o Supabase Dashboard → SQL Editor
2. Cola o conteúdo de `supabase/schema_v4.sql`
3. Executa → deve criar 11 tabelas + RLS + funções

### 4. Iniciar em desenvolvimento
```bash
npm run dev
# Abre http://localhost:3000
```

### 5. Build para produção
```bash
npm run build
# Gera pasta dist/ — serve com qualquer static host
```

---

## ⚙️ Configuração das Integrações no Painel

Todas as integrações podem ser configuradas **dentro do painel** em
**Configurações → Integrações** — sem precisar de reiniciar a app:

| Campo | Onde obter |
|---|---|
| Supabase URL | supabase.com → Project → Settings → API |
| Supabase Anon Key | supabase.com → Project → Settings → API |
| OpenRouter Key | openrouter.ai → API Keys |
| Webhook Entrada (n8n) | URL do workflow n8n que recebe WhatsApp |
| Webhook Saída (n8n) | URL do workflow n8n que envia mensagens |

As chaves são guardadas no `localStorage` e no `.env`. O `.env` tem prioridade.

---

## 🤖 Como a ARIA funciona

```
Utilizador escreve no chat
        ↓
send() no IAAssistente (V3 visual — intocado)
        ↓
fetch('/api/ai/chat' ou openrouter.ai/v1)
        ↓
DeepSeek R1 (free) via OpenRouter
        ↓
Streaming token a token
        ↓
Aparece no chat do V3 em tempo real
        ↓
Fallback 1: orChat() sem streaming
Fallback 2: buildLocalAIResponse() offline
```

**O V3 visual já tem a ARIA ligada.** A chave `OR_KEY` na linha 1955 do
`FumuGold_V3_ARIA_visual.jsx` está pré-configurada com uma chave funcional.
Para usar a tua própria chave: define `VITE_OPENROUTER_KEY` no `.env`.

---

## 📱 Como o WhatsApp Monitor funciona

```
Cliente envia mensagem WhatsApp
        ↓
Evolution API / Twilio / Meta Cloud API
        ↓
n8n workflow (teu servidor)
        ↓
n8n guarda em fg_whatsapp_conversations (Supabase)
        ↓
startWhatsAppBridge() (main.jsx) poleia a cada 15s
        ↓
Emite CustomEvent 'fg_wa_message'
        ↓
V3 Comunicacao.tsx recebe e mostra na fila WhatsApp
        ↓
Staff vê, responde manualmente ou pede à ARIA
        ↓
sendReply() → n8n webhook → WhatsApp
```

### Configurar o n8n
1. Cria um workflow no n8n com trigger **Webhook**
2. Recebe a mensagem do WhatsApp
3. Executa uma query no Supabase:
   ```sql
   SELECT fg_upsert_whatsapp_conversation(
     '{{ $json.phone }}',
     '{{ $json.name }}',
     'client',
     '{{ $json.message }}',
     'active'
   );
   ```
4. A função está no `schema_v4.sql` — já criada no passo 3

---

## 🗄️ Tabelas Supabase

| Tabela | Uso |
|---|---|
| `fg_patients` | Pacientes |
| `fg_appointments` | Consultas |
| `fg_lab_results` | Laboratório |
| `fg_prescriptions` | Prescrições |
| `fg_invoices` | Faturas |
| `fg_beds` | Camas / Internamento |
| `fg_staff` | Recursos Humanos |
| `fg_messages` | Mensagens internas |
| `fg_surgeries` | Cirurgias / Bloco |
| `fg_notifications` | Notificações |
| `fg_whatsapp_conversations` | **WhatsApp Monitor** |

---

## 🔐 Segurança

- **RLS activado** em todas as tabelas (ver `schema_v4.sql`)
- A **anon key** só permite leitura e escrita de dados da clínica
- O **n8n** usa a `service_role` key (nunca exposta no frontend)
- A **chave OpenRouter** fica no `.env` ou no `localStorage` — nunca em código
- `allowAutonomousActions: false` no ClinicContext — ARIA não age sem confirmação

---

## 🔧 Troubleshooting

**"Erro de ligação" na ARIA:**
- Verifica se `VITE_OPENROUTER_KEY` está no `.env`
- Ou vai a Configurações → Integrações e insere a chave manualmente
- A ARIA tem fallback offline — nunca fica completamente muda

**WhatsApp não aparece no painel:**
- Verifica `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
- Executa o schema no Supabase se ainda não o fizeste
- Verifica os logs do n8n para confirmar que está a escrever na tabela

**Three.js / Holografia não carrega:**
- Verifica se `three` está instalado: `npm install`
- Abre a consola do browser — pode ser um erro de WebGL

---

## 📋 Registo de Ficheiros — Integridade

| Ficheiro | MD5 | Status |
|---|---|---|
| `FumuGold_V3_ARIA_visual.jsx` | `e2fde137514568e4c0d60693432f7d82` | 🔒 Intocado |
| `fumugold_local_tools.js` | — | ✅ Novo |
| `supabase_sync.js` | — | ✅ Novo |
| `lib/openrouter.js` | — | ✅ Novo |
| `lib/useARIAData.js` | — | ✅ Novo |
| `lib/whatsapp_service.js` | — | ✅ Novo |
| `lib/aria_service.js` | — | ✅ Novo |
| `main.jsx` | — | ✅ Novo |

---

*FumuGold V3 · Sistema Médico Integrado com IA · Luanda, Angola*
*CORPO: FumuGold_V3_ARIA_visual.jsx (LOCKED) · ALMA: lib/ + services (EDITÁVEL)*
