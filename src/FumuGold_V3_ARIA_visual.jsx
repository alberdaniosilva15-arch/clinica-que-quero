import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import * as THREE from "three";
import {
  LOCAL_ARCHIVE_HISTORY_KEY,
  LOCAL_SNAPSHOT_KEY,
  buildBundleCSV,
  buildClinicDataBundle,
  buildLocalAIResponse,
  downloadFile,
  parseJSONSafe,
  persistArchiveBundle,
} from "./fumugold_local_tools.js";
import { probeSupabase, syncClinicToSupabase } from "./supabase_sync.js";
import {
  getSupabaseClient,
  signInWithEmailPassword,
  signOutSupabase,
  getInitialSession,
  mapSupabaseUserToAppSession,
  subscribeAuth,
} from "./lib/supabase_auth.js";
import { setClinicId } from "./lib/multi_clinic.js";
import {
  validatePatientList,
  validateAppointmentList,
  validatePrescriptionList,
  validateLabList,
  validateInvoiceList,
  validateStockList,
} from "./lib/clinical_validators.js";
import {
  auditPatientsDiff,
  auditAppointmentsDiff,
  auditPrescriptionsDiff,
  auditLabDiff,
  auditInvoicesDiff,
  auditStockDiff,
} from "./lib/entity_audit.js";
import { useDebouncedEffect } from './hooks/useDebouncedEffect.js';
import { setCurrentUser, logAction, AUDIT_ACTIONS } from "./lib/audit_log.js";


/* ═══════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════ */
const G = {
  gold:'#D4AF37', goldL:'#F5D060', goldD:'#8B6914',
  bg:'#040301', bg2:'rgba(10,7,1,0.97)', bg3:'rgba(16,11,2,0.93)',
  red:'#FF2525', teal:'#00CCFF', green:'#00FF88',
  amber:'#FF9900', purple:'#AA55FF', blue:'#0088FF',
  text:'#EEE4C0', dim:'#6A5A32', dimL:'#9A8A5A',
  border:'rgba(212,175,55,0.25)', borderB:'rgba(212,175,55,0.55)',
};

const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Orbitron:wght@400;500;700;900&family=Rajdhani:wght@300;400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;scrollbar-width:thin;scrollbar-color:#D4AF37 #080600;}
::-webkit-scrollbar{width:4px;height:4px;}::-webkit-scrollbar-track{background:#080600;}::-webkit-scrollbar-thumb{background:#D4AF37;border-radius:2px;}
body{background:#040301;}input,textarea,select{outline:none;}button{cursor:pointer;border:none;}
@keyframes shimmer{0%{background-position:-300% center;}100%{background-position:300% center;}}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
@keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
@keyframes pulseRed{0%,100%{box-shadow:0 0 6px #FF2525,0 0 18px rgba(255,37,37,0.2);}50%{box-shadow:0 0 16px #FF2525,0 0 36px rgba(255,37,37,0.5);}}
@keyframes float{0%,100%{transform:translateY(0);}50%{transform:translateY(-5px);}}
@keyframes blink{0%,100%{opacity:1;}50%{opacity:0.3;}}
@keyframes spin{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
@keyframes scanLine{0%{top:-5%;}100%{top:105%;}}
@keyframes pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.04);}}
.shimmer{background:linear-gradient(90deg,#8B6914 20%,#F5D060 50%,#8B6914 80%);background-size:300%;animation:shimmer 4s linear infinite;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}
.blink{animation:blink 2s ease-in-out infinite;}
.fade-in{animation:fadeIn 0.4s ease;}
.fade-up{animation:fadeUp 0.4s ease;}
.float{animation:float 4s ease-in-out infinite;}
.gold-border{border:1px solid rgba(212,175,55,0.35);}
@keyframes glitch{0%,100%{clip-path:inset(40% 0 61% 0);transform:translate(-2px,0);}20%{clip-path:inset(92% 0 1% 0);transform:translate(1px,0);}60%{clip-path:inset(25% 0 58% 0);transform:translate(-1px,0);}80%{clip-path:inset(54% 0 7% 0);transform:translate(0,0);}}
@keyframes borderFlow{0%,100%{opacity:0.3;}50%{opacity:1;}}
@keyframes holoPulse{0%,100%{opacity:0.5;box-shadow:0 0 20px rgba(212,175,55,0.1);}50%{opacity:0.9;box-shadow:0 0 60px rgba(212,175,55,0.35),0 0 100px rgba(212,175,55,0.1);}}
@keyframes neuralPulse{0%,100%{opacity:0.04;}50%{opacity:0.22;}}
@keyframes rotateHex{from{transform:rotate(0deg);}to{transform:rotate(360deg);}}
@keyframes breathe{0%,100%{transform:scale(1);}50%{transform:scale(1.06);}}
@keyframes countReveal{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
@keyframes scanPulse{0%{opacity:0.6;transform:scaleX(1);}50%{opacity:1;transform:scaleX(1.02);}100%{opacity:0.6;transform:scaleX(1);}}
@keyframes borderGlow{0%,100%{border-color:rgba(212,175,55,0.2);box-shadow:none;}50%{border-color:rgba(212,175,55,0.8);box-shadow:0 0 12px rgba(212,175,55,0.3);}}
@keyframes particleOrbit{from{transform:rotate(0deg) translateX(60px) rotate(0deg);}to{transform:rotate(360deg) translateX(60px) rotate(-360deg);}}
@keyframes typeOn{from{width:0;overflow:hidden;}to{width:100%;overflow:hidden;}}
@keyframes entryReveal{0%{opacity:0;transform:translateY(30px) scale(0.96);}100%{opacity:1;transform:translateY(0) scale(1);}}
@keyframes sidePulse{0%,100%{box-shadow:inset 2px 0 8px rgba(212,175,55,0.0);}50%{box-shadow:inset 2px 0 8px rgba(212,175,55,0.15);}}
.panel-hover:hover{border-color:rgba(212,175,55,0.45)!important;box-shadow:0 0 20px rgba(212,175,55,0.08);}
`;

/* ═══════════════════════════════════════════════════════════
   DATA
═══════════════════════════════════════════════════════════ */
const DISEASES = {
/* ── ANGOLA / AFRICA TOP 50 ── */
  malaria:{label:'Malária (Paludismo)',cat:'Parasitário · Angola #1',sev:'CRÍTICA',sevC:'#FF2020',parts:['head','brain','abdomen','spleen'],
    sintomas:['Febre intermitente ≥ 38°C com calafrios intensos','Cefaleia frontal intensa e mialgia generalizada','Esplenomegalia — baço aumentado palpável','Anemia hemolítica grave com palidez cutânea','Malária cerebral: convulsões e coma (forma grave)'],
    descricao:'Infecção por Plasmodium falciparum (90% em Angola) transmitida pelo Anopheles. Principal causa de mortalidade infantil.',
    trat:'• Arteméter+Lumefantrina (AL) 3 dias\n• Artesunato IV nas formas graves\n• TDR antes de tratar\n• Prevenção: mosquiteiro + DEET',
    urg:'CRÍTICA — Tratamento nas primeiras 24h'},
  tuberculose:{label:'Tuberculose Pulmonar',cat:'Infeccioso · Angola #2',sev:'ALTA',sevC:'#FF8C00',parts:['chest','lung_L','lung_R'],
    sintomas:['Tosse produtiva > 3 semanas com hemoptise','Suores nocturnos profusos e febre vespertina','Perda de peso > 10% em 2 meses','Astenia progressiva e anorexia','Dispneia e dor pleurítica nas formas avançadas'],
    descricao:'Mycobacterium tuberculosis. Angola: 370/100.000 hab. Frequentemente coinfecção VIH.',
    trat:'• HRZE 2 meses + HR 4 meses\n• DOT (tratamento supervisionado)\n• Isolamento respiratório\n• Notificação obrigatória',
    urg:'ALTA — Internamento se forma grave ou BK+'},
  hiv_sida:{label:'VIH/SIDA',cat:'Infeccioso · Angola #3',sev:'CRÍTICA',sevC:'#FF2020',parts:['abdomen','chest','head','spleen'],
    sintomas:['Infecções oportunistas recorrentes (PCP, toxoplasmose)','Perda ponderal severa > 10%','Candidíase oral (Síndrome do emagrecimento)','Linfadenopatia generalizada persistente','Diarreia crónica e febre prolongada'],
    descricao:'Vírus da imunodeficiência humana — prevalência Angola ~2%. Destrói linfócitos CD4.',
    trat:'• TARV: TDF+3TC+DTG (linha 1)\n• Profilaxia cotrimoxazol se CD4<200\n• Monitorização CV 6/6m\n• PrEP para profilaxia',
    urg:'CRÍTICA — CD4<200: internamento urgente'},
  febre_amarela:{label:'Febre Amarela',cat:'Viral · Angola endémico',sev:'CRÍTICA',sevC:'#FF2020',parts:['abdomen','liver','kidney_L','kidney_R','chest'],
    sintomas:['Febre bifásica com remissão aparente ("sorriso da morte")','Icterícia intensa — febre amarela do fígado','Hemorragia: epistaxe, gengivorragia, melena','Vómito negro (hematémese escura)','Insuficiência hepática e renal simultâneas'],
    descricao:'Flavivírus transmitido por Aedes aegypti. Surto Angola 2016: >400 mortos. Vacina obrigatória.',
    trat:'• Suporte intensivo — sem antiviral\n• Hidratação agressiva IV\n• Vitamina K e plasma fresco\n• Vacina 17D (dose única, protecção vitalícia)',
    urg:'EMERGÊNCIA — Mortalidade 20–60% fase tóxica'},
  dengue:{label:'Dengue',cat:'Viral · Angola emergente',sev:'ALTA',sevC:'#FF8C00',parts:['head','chest','abdomen','skin','knee_L','knee_R','hand_L','hand_R'],
    sintomas:['Febre alta súbita 39–40°C ("febre quebra-ossos")','Dor retro-ocular intensa com movimentos oculares','Exantema maculopapular generalizado no D3-D5','Plaquetopenia grave < 100.000 — risco hemorrágico','Sinal do torniquete positivo (petéquias)'],
    descricao:'Flavivírus DENV 1–4, vector Aedes aegypti. Sem imunidade cruzada entre serotipos.',
    trat:'• Paracetamol — NUNCA AAS/ibuprofeno\n• Hidratação oral vigorosa\n• Dengue hemorrágico: internamento\n• Monitorização diária plaquetas',
    urg:'Plaquetas < 20.000 ou hemorragia: urgência'},
  colera:{label:'Cólera',cat:'Bacteriano · Angola endémico',sev:'CRÍTICA',sevC:'#FF2020',parts:['abdomen','stomach','kidney_L','kidney_R'],
    sintomas:['Diarreia "água de arroz" — 20 litros/dia','Vómitos incoercíveis sem náusea prévia','Desidratação severa em < 2h com oligúria','Cãibras musculares intensas por hipocaliémia','Colapso hemodinâmico — choque hipovolémico'],
    descricao:'Vibrio cholerae O1/O139. Epidemias em Angola por saneamento deficiente. CFR < 1% com SRO.',
    trat:'• SRO agressiva oral ou IV (Lactato Ringer)\n• Doxiciclina 300 mg dose única (adultos)\n• Azitromicina 20 mg/kg (crianças)\n• Notificação IMEDIATA à DPS',
    urg:'EMERGÊNCIA — Desidratação mata em horas'},
  febre_tifoide:{label:'Febre Tifóide',cat:'Bacteriano · Angola',sev:'ALTA',sevC:'#FF8C00',parts:['abdomen','stomach','spleen'],
    sintomas:['Febre em escada progressiva 38–40°C','Bradicárdia relativa (pulso lento para febre)','Roséolas tifóideas no abdómen D7-D10','Hepatoesplenomegalia com dor abdominal difusa','Complicação: perfuração intestinal (D2-D3 semana)'],
    descricao:'Salmonella typhi. Transmissão fecal-oral por água/alimentos contaminados.',
    trat:'• Ciprofloxacina 500mg 2×/dia 7-10d\n• Azitromicina se resistência\n• Repouso absoluto e dieta mole\n• Vacina Typhim Vi para prevenção',
    urg:'ALTA — Perfuração intestinal: cirurgia urgente'},
  meningite:{label:'Meningite Bacteriana',cat:'Neurológico · Angola',sev:'CRÍTICA',sevC:'#FF2020',parts:['head','brain','neck'],
    sintomas:['Tríade clássica: febre + cefaleia intensa + rigidez da nuca','Sinal de Kernig e Brudzinski positivos','Fotofobia e fonofobia marcadas','Petéquias e púrpura (meningocócica)','Alteração estado consciência — Glasgow < 13'],
    descricao:'Neisseria meningitidis / Streptococcus pneumoniae. Mortalidade 20–30% se não tratada em 24h.',
    trat:'• Ceftriaxona 2g IV 12/12h IMEDIATO\n• Dexametasona 0,15 mg/kg IV antes ATB\n• PL para diagnóstico se sem papila\n• Quimioprofilaxia contactos: rifampicina',
    urg:'EMERGÊNCIA — Tratar antes de confirmar diagnóstico'},
  esquistossomose:{label:'Esquistossomíase (Bilharziose)',cat:'Parasitário · Angola',sev:'MODERADA',sevC:'#FFD700',parts:['abdomen','liver','bladder','kidney_L','kidney_R'],
    sintomas:['Dermatite cercariana — prurido com banho em água doce','Febre de Katayama: febre, urticária, eosinofilia','Hematúria macroscópica — urina "coca-cola"','Hepatoesplenomegalia com hipertensão portal','Cistite crónica com disúria e polaciúria'],
    descricao:'Schistosoma haematobium (urinário) e mansoni (intestinal). Zonas rurais fluviais de Angola.',
    trat:'• Praziquantel 40 mg/kg dose única\n• Repetir 4-6 semanas\n• Evitar contacto com água doce estagnada',
    urg:'MODERADA — Tratamento em massa endémica'},
  drepanocitose:{label:'Drepanocitose (Anemia Falciforme)',cat:'Hematológico · Angola #1 genético',sev:'CRÍTICA',sevC:'#FF2020',parts:['chest','abdomen','spleen','bone_pelvis','head','hand_L','hand_R','knee_L','knee_R'],
    sintomas:['Crises vaso-oclusivas — dor óssea lancinante','Síndrome torácico agudo com dispneia e febre','Sequestro esplénico agudo em crianças','Acidente vascular cerebral em jovens','Priapismo, úlceras de perna, osteomielite'],
    descricao:'Mutação β-globina (HbSS). Prevalência Angola 20-25% portadores. Doença hereditária mais comum.',
    trat:'• Hidroxiureia 15–35 mg/kg/dia\n• Ácido fólico diário profilático\n• Penicilina profilática até 5 anos\n• Transfusão na crise grave\n• Transplante CMO (curativo)',
    urg:'Crise grave: analgesia + O₂ + hidrat. IV urgente'},
  reumatismo:{label:'Febre Reumática',cat:'Reumatológico · Angola',sev:'ALTA',sevC:'#FF8C00',parts:['heart','chest','knee_L','knee_R','hand_L','hand_R'],
    sintomas:['Poliartrite migratória assimétrica pós-amigdalite','Cardite reumática — sopro cardíaco novo','Coreia de Sydenham — movimentos involuntários','Eritema marginado — exantema característico','Nódulos subcutâneos de Aschoff'],
    descricao:'Resposta imune ao Streptococcus pyogenes (EGA). Sequela: doença valvular reumática.',
    trat:'• Penicilina G benzatina 1.200.000 UI IM\n• AAS 80–100 mg/kg para artrite\n• Prednisona 1–2 mg/kg se cardite\n• Profilaxia secundária: penicilina benzatina mensal',
    urg:'ALTA — Cardite: repouso e cardiologia'},
  tripanossomiase:{label:'Tripanossomíase Africana (Doença do Sono)',cat:'Parasitário · Angola Norte',sev:'CRÍTICA',sevC:'#FF2020',parts:['head','brain','spleen','abdomen'],
    sintomas:['Cancro de inoculação no local da picada da mosca tsé-tsé','Linfadenopatia cervical posterior (sinal de Winterbottom)','Febre irregular, cefaleia, prurido intenso','Distúrbios do sono invertido — sonolência diurna','Fase II: confusão mental, coma, morte sem tratamento'],
    descricao:'Trypanosoma brucei gambiense. Angola: foco no Kwanza Norte e Uíge. Sub-notificada.',
    trat:'• Fase I: Pentamidina IM 7 dias\n• Fase II: Nifurtimox+Eflornithine (NECT)\n• Fenecer a mosca tsé-tsé\n• Notificação OMS obrigatória',
    urg:'CRÍTICA — Fase II cerebral sem tratamento = fatal'},
  oncocercose:{label:'Oncocercose (Cegueira dos Rios)',cat:'Parasitário · Angola',sev:'MODERADA',sevC:'#FFD700',parts:['eye_L','eye_R','skin'],
    sintomas:['Prurido cutâneo intenso crónico (oncodermite)','Nódulos subcutâneos (oncocercomas) palpáveis','Alterações da pele — "pele de leopardo" e "pele seca"','Lesões oculares progressivas — ceratite punctata','Cegueira irreversível nas formas avançadas'],
    descricao:'Onchocerca volvulus transmitida por Simulium spp. (borrachudo). Afecta rios rápidos de Angola.',
    trat:'• Ivermectina 150 µg/kg 1×/ano (distribuição comunitária)\n• Doxiciclina 6 semanas (mata Wolbachia endossimbionte)\n• Cirurgia nodulectomia',
    urg:'MODERADA — Prevenção é fundamental'},
  filariose:{label:'Filariose Linfática',cat:'Parasitário · Angola',sev:'MODERADA',sevC:'#FFD700',parts:['foot_L','foot_R','abdomen','pelvis'],
    sintomas:['Linfedema progressivo do escroto/extremidades inferiores','Elefantíase — linfedema crónico desfigurante','Quilúria — urina leitosa por quilomícrons','Hidrocoele — acumulação linfática escrotal','Febre linfangítica recorrente com linfadenite'],
    descricao:'Wuchereria bancrofti transmitida por Culex quinquefasciatus. Endémica em cidades costeiras.',
    trat:'• DEC 6 mg/kg/dia 12 dias\n• Albendazol 400 mg\n• Programa MDA: DEC+Albendazol anuais\n• Higiene dos membros afectados',
    urg:'MODERADA — Tratamento precoce evita sequelas'},
  amebíase:{label:'Amebíase Intestinal',cat:'Parasitário · Angola',sev:'ALTA',sevC:'#FF8C00',parts:['abdomen','liver','stomach'],
    sintomas:['Diarreia mucossanguinolenta (disenteria amebiana)','Cólicas abdominais intensas com tenesmo rectal','Febre baixa e mal-estar geral','Abcesso hepático amebiano — dor hipocôndrio D com febre alta','Icterícia e hepatomegalia no abcesso'],
    descricao:'Entamoeba histolytica. Transmissão fecal-oral em Angola por saneamento deficiente.',
    trat:'• Metronidazol 750 mg 3×/dia 10 dias\n• Seguido de Paromomicina 500 mg 3×/dia 7 dias\n• Abcesso: drenagem percutânea se > 5cm',
    urg:'Abcesso hepático: hospitalização urgente'},
  giardíase:{label:'Giardíase',cat:'Parasitário',sev:'MODERADA',sevC:'#FFD700',parts:['abdomen','stomach'],
    sintomas:['Diarreia crónica gordurosa e fétida (esteatorréia)','Distensão abdominal e flatulência excessiva','Cólicas periumbilicais pós-prandiais','Perda de peso e malnutrição em crianças','Síndrome de má absorção vitamínica'],
    descricao:'Giardia lamblia. Principal parasita intestinal em crianças angolanas < 5 anos.',
    trat:'• Metronidazol 250 mg 3×/dia 5-7 dias\n• Tinidazol 2g dose única (alternativa)\n• Fervura da água > 1 minuto',
    urg:'MODERADA — Tratar toda a família'},
  leishmaniose:{label:'Leishmaniose Visceral (Kala-azar)',cat:'Parasitário · Angola',sev:'CRÍTICA',sevC:'#FF2020',parts:['abdomen','spleen','liver','bone_pelvis'],
    sintomas:['Febre irregular prolongada meses sem causa aparente','Esplenomegalia maciça — baço até região pélvica','Pancitopenia — anemia, leucopenia, plaquetopenia','Emagrecimento severo e distensão abdominal','Hiperpigmentação cutânea ("kala-azar" = febre negra)'],
    descricao:'Leishmania donovani/infantum transmitida por flebótomos (mariposas do verão). Mortal sem tratamento.',
    trat:'• Anfotericina B lipossomal 3 mg/kg D1-5,D14,D21\n• Antimoniato de meglumina IM 28 dias\n• Miltefosina oral 2,5 mg/kg/dia 28 dias',
    urg:'CRÍTICA — Mortalidade > 90% sem tratamento'},
  sarampo:{label:'Sarampo',cat:'Viral · Angola surtos',sev:'ALTA',sevC:'#FF8C00',parts:['head','chest','lung_L','lung_R','skin'],
    sintomas:['Febre alta > 38,5°C por 3-5 dias','Tosse, coriza e conjuntivite (síndrome 3C)','Manchas de Koplik na mucosa jugal (patognomónico)','Exantema maculopapular craniocaudal D4','Complicações: pneumonia, encefalite, desnutrição'],
    descricao:'Paramyxovírus. Angola: epidemias recorrentes por baixa cobertura vacinal (< 70%).',
    trat:'• Isolamento respiratório 5 dias exantema\n• Vitamina A 200.000 UI 2 dias (criança)\n• Suporte sintomático\n• Vacina SCR previne 100%',
    urg:'ALTA — Criança < 5 anos: risco pneumonia fatal'},
  varicela:{label:'Varicela (Catapora)',cat:'Viral',sev:'MODERADA',sevC:'#FFD700',parts:['skin','chest','head'],
    sintomas:['Exantema vesicular pruriginoso em "céu estrelado"','Vesículas em vários estádios simultâneos','Febre baixa e mal-estar precede exantema 1-2 dias','Lesões mucosas orais e genitais','Complicação: pneumonia varicela em adultos'],
    descricao:'Vírus Varicela-Zóster (VVZ). Altamente contagioso. Reactivação = herpes zoster (zona).',
    trat:'• Aciclovir 800 mg 5×/dia 7 dias (adulto)\n• Loção calamina para prurido\n• Cortar unhas para evitar infecção bacteriana\n• Isolamento até todas as crostas',
    urg:'Adultos e imunodeprimidos: tratamento imediato'},
  herpes_zoster:{label:'Herpes Zoster (Zona)',cat:'Neurológico/Viral',sev:'MODERADA',sevC:'#FFD700',parts:['chest','skin','head'],
    sintomas:['Dor neuropática unilateral intensa pré-eruptiva','Vesículas em faixa seguindo dermátomo (herpes zoster)','Alodínia intensa — dor ao toque ligeiro','Nevralgia pós-herpética meses após cura','Zoster oftálmico: risco de cegueira'],
    descricao:'Reactivação do VVZ latente nos gânglios dorsais. Risco em idosos e imunodeprimidos (VIH).',
    trat:'• Aciclovir 800 mg 5×/dia 7-10 dias\n• Valaciclovir 1g 3×/dia (melhor biodisponibilidade)\n• Analgesia: gabapentina 300-1200 mg/dia\n• Vacina Shingrix (2 doses) previne 90%',
    urg:'Zoster oftálmico: oftalmologia urgente'},
  malnutricao:{label:'Malnutrição Proteico-Calórica',cat:'Nutricional · Angola',sev:'CRÍTICA',sevC:'#FF2020',parts:['abdomen','head','chest','foot_L','foot_R'],
    sintomas:['Kwashiorkor: edema bilateral, cabelo vermelho, dermatose','Marasmo: emaciação total, "velho em criança"','Perda muscular severa e fraqueza extrema','Infecções recorrentes por imunodepressão','Atraso crescimento — altura < 3 percentil'],
    descricao:'Principal causa de morte infantil < 5 anos em Angola (36% crianças com atraso crescimento).',
    trat:'• ATPU (Alimento Terapêutico Pronto a Usar)\n• Refeições F-75 seguido de F-100 (internamento)\n• Vitamina A, ferro, zinco, ácido fólico\n• Tratamento infecções associadas',
    urg:'CRÍTICA — Internamento se MUAC < 115 mm'},
  anemia_nutricional:{label:'Anemia por Deficiência de Ferro',cat:'Hematológico · Angola',sev:'MODERADA',sevC:'#FFD700',parts:['chest','heart','head','abdomen'],
    sintomas:['Palidez palmar, conjuntival e ungueal marcada','Astenia crónica e dispneia de esforço progressiva','Pica — desejo de comer terra, gelo, cal','Glossite e queilite angular — língua lisa e vermelha','Taquicardia e sopro anémico por alto débito'],
    descricao:'Mais comum: deficiência ferro. Angola: 70% crianças < 5 anos e 55% grávidas anémicas.',
    trat:'• Sulfato ferroso 200 mg 3×/dia 3 meses\n• Vitamina C para absorção\n• Transfusão se Hb < 7 g/dL sintomática\n• Tratar causa base (ancilostomíase, etc.)',
    urg:'Hb < 5 g/dL ou sintomas cardíacos: urgência'},
  septicemia:{label:'Septicemia (Sépsis)',cat:'Crítico',sev:'CRÍTICA',sevC:'#FF2020',parts:['heart','chest','abdomen','kidney_L','kidney_R','head'],
    sintomas:['Febre > 38,3°C ou hipotermia < 36°C','Taquicardia > 90 bpm e taquipneia > 20','Hipotensão refractária — PAS < 90 mmHg','Alteração estado mental e oligúria','Lactato > 2 mmol/L — sinal de hipoperfusão'],
    descricao:'Resposta sistémica desregulada a infecção. Mortalidade 20-40%. Bundles de 1h e 3h diminuem mortalidade.',
    trat:'• Hemocultura ANTES de ATB\n• ATB largo espectro < 1h (Piperacilina-Tazobactam)\n• Ressuscitação com 30 mL/kg SF em 3h\n• Noradrenalina se MAP < 65 mmHg',
    urg:'EMERGÊNCIA — Cada hora de atraso +7% mortalidade'},
  apendicite:{label:'Apendicite Aguda',cat:'Cirúrgico',sev:'CRÍTICA',sevC:'#FF2020',parts:['abdomen','pelvis'],
    sintomas:['Dor periumbilical que migra para FID (ponto de McBurney)','Sinal de Blumberg positivo — defesa involuntária','Náuseas, vómitos e anorexia','Febre 37,5–38,5°C com leucocitose','Rovsing positivo — dor FID na palpação FIE'],
    descricao:'Obstrução luminal do apêndice com distensão, isquémia e perfuração se > 72h.',
    trat:'• Cirurgia — apendicectomia laparoscópica\n• ATB pré-op: Cefazolina + Metronidazol\n• Nada por via oral (jejum)\n• Analgesia IV (ketorolac ou morfina)',
    urg:'EMERGÊNCIA — Perfuração: peritonite fecal'},
  ulcera_peptica:{label:'Úlcera Péptica (H. pylori)',cat:'Gastrointestinal',sev:'MODERADA',sevC:'#FFD700',parts:['abdomen','stomach'],
    sintomas:['Dor epigástrica em queimação 2-4h pós-refeição','Melhora com antiácidos e alimentos (duodenal)','Piora com alimentos (gástrica)','Hematémese ou melenas — complicação hemorrágica','Náuseas, vómitos e perda de peso'],
    descricao:'Helicobacter pylori (80% úlceras duodenais). AINEs: 20%. Risco: tabaco, stress, álcool.',
    trat:'• Erradicação H.pylori: Omeprazol+Claritromicina+Amoxicilina 14 dias\n• IBP 8 semanas para cicatrização\n• Endoscopia de controlo\n• Suspender AINEs',
    urg:'Hemorragia ou perfuração: endoscopia urgente'},
  epilepsia:{label:'Epilepsia',cat:'Neurológico',sev:'ALTA',sevC:'#FF8C00',parts:['head','brain'],
    sintomas:['Crises convulsivas tónico-clónicas generalizadas','Ausências — interrupção súbita da consciência','Aura pré-ictal: sensações visuais, olfativas, epigástricas','Estado pós-ictal: confusão e sono pós-crise','Estado epiléptico: crise > 5 min ou sem recuperação'],
    descricao:'Neurónios com hiperexcitabilidade sincronizada anormal. Angola: muitas causas por malária cerebral e NCC.',
    trat:'• Ácido Valpróico 500–2000 mg/dia\n• Carbamazepina 400–1600 mg/dia\n• Lamotrigina em mulheres grávidas\n• Estado epiléptico: Diazepam 0,2 mg/kg IV',
    urg:'Status epilepticus > 5 min: emergência'},
  insuf_cardiaca:{label:'Insuficiência Cardíaca',cat:'Cardiovascular',sev:'ALTA',sevC:'#FF8C00',parts:['heart','chest','lung_L','lung_R','foot_L','foot_R'],
    sintomas:['Dispneia de esforço progressiva → ortopneia','Edema maleolar bilateral — sinal de godet','Estertores crepitantes bibasais — pulmão húmido','Turgência venosa jugular — congestão venosa','Fadiga extrema e intolerância ao exercício'],
    descricao:'Incapacidade cardíaca de manter débito adequado. HTA, cardiopatia isquémica e reumática são as principais causas em Angola.',
    trat:'• Furosemida 40–80 mg/dia (diurético)\n• IECA/ARA-II (enalapril/losartan)\n• Beta-bloqueante (carvedilol)\n• Espironolactona 25–50 mg',
    urg:'Edema agudo pulmão: posição sentado + furosemida IV'},
  asma:{label:'Asma Brônquica',cat:'Respiratório',sev:'MODERADA',sevC:'#FFD700',parts:['chest','lung_L','lung_R'],
    sintomas:['Dispneia episódica com pieira audível','Tosse seca noturna/madrugada','Opressão torácica após exercício ou alérgenos','Expiração prolongada com sibilos difusos','Crise grave: cianose, uso musculatura acessória, SpO₂ < 90%'],
    descricao:'Inflamação crónica das vias aéreas com broncoespasmo reversível. Prevalência ↑ em zonas urbanas de Luanda.',
    trat:'• SABA (salbutamol) SOS — alívio rápido\n• CSI (beclometasona) dose mínima eficaz\n• LABA + CSI se não controlada\n• Evitar desencadeantes: ácaros, fumo, poluição',
    urg:'Crise severa: nebulização + corticoide IV urgente'},
  dpoc:{label:'DPOC (Doença Pulmonar Obstrutiva Crónica)',cat:'Respiratório',sev:'ALTA',sevC:'#FF8C00',parts:['chest','lung_L','lung_R'],
    sintomas:['Tosse produtiva crónica matinal > 3 meses/ano','Dispneia progressiva de esforço (escala MRC ≥ 2)','Exacerbações infecciosas recorrentes','Sibilos e pieira na ausculta','Síndrome do barril — caixa torácica aumentada'],
    descricao:'Obstrução irreversível. Angola: biomassa (carvão, lenha) é principal factor de risco — > tabaco.',
    trat:'• LAMA (tiotrópio) ou LABA (salmeterol)\n• CSI se exacerbações frequentes\n• Reabilitação pulmonar\n• O₂ > 15h/dia se SpO₂ crónica < 88%',
    urg:'Exacerbação grave: O₂ controlado + ATB + corticoide'},
  diabetes1:{label:'Diabetes Mellitus Tipo 1',cat:'Endócrino',sev:'CRÍTICA',sevC:'#FF2020',parts:['abdomen','pancreas','eye_L','eye_R','kidney_L','kidney_R'],
    sintomas:['Poliúria osmótica com enurese nocturna','Polidipsia intensa e polifagia com perda de peso','CAD: respiração de Kussmaul e hálito cetónico','Visão turva por variações glicémicas','Cetoacidose diabética — pH < 7,3, cetona +'],
    descricao:'Destruição autoimune das células β pancreáticas. Insulino-dependente. Início em jovens.',
    trat:'• Insulina basal (glargina) + bolus prandial\n• Monitorização glicémica 4-6×/dia\n• Bomba de insulina (CSII) — padrão ouro\n• HbA1c alvo < 7%',
    urg:'CAD: insulina IV + SF + KCl em UCI'},
  gota:{label:'Gota',cat:'Reumatológico/Metabólico',sev:'MODERADA',sevC:'#FFD700',parts:['foot_L','foot_R','knee_L','knee_R','hand_L','hand_R'],
    sintomas:['Artrite monoarticular hiperaguda — metatarsofalângica 1ª ("podagra")','Dor excruciante, edema, rubor e calor local','Crise nocturna com resolução espontânea 7-10 dias','Tofos gotosos — depósitos urato subcutâneos','Nefrolitíase por cálculos de urato'],
    descricao:'Hiperuricemia (>6,8 mg/dL) com deposição cristais monourato de sódio. Álcool, carnes vermelhas, frutos mar precipitam.',
    trat:'• Crise: Colchicina 0,5 mg 3×/dia ou AINE\n• Profilaxia: Alopurinol 100–300 mg/dia\n• Dieta hipoprotéica + evitar álcool\n• Hidratação > 2 L/dia',
    urg:'Crise aguda: iniciar colchicina nas primeiras 12h'},
  osteoporose:{label:'Osteoporose',cat:'Ortopédico/Metabólico',sev:'MODERADA',sevC:'#FFD700',parts:['bone_pelvis','chest','head'],
    sintomas:['Fractura com trauma mínimo (fragility fracture)','Dor dorsal crónica por fracturas vertebrais silenciosas','Diminuição de altura > 4 cm','Cifose progressiva ("corcova de viúva")','Fractura da anca — morbilidade major em idosos'],
    descricao:'DMO T-score ≤ -2,5 DP. Risco ↑ menopause, corticóides, imobilização, VIH+TARV.',
    trat:'• Bifosfonatos: alendronato 70 mg/semana\n• Cálcio 1000–1200 mg/dia + Vitamina D 800 UI\n• Denosumab 60 mg SC 6/6 meses\n• Exercício de resistência',
    urg:'Fractura anca: cirurgia nas primeiras 48h'},
  lombalgia:{label:'Lombalgia Crónica',cat:'Ortopédico/Neurológico',sev:'MODERADA',sevC:'#FFD700',parts:['abdomen','pelvis','shin_L','shin_R'],
    sintomas:['Dor lombar crónica > 12 semanas com irradiação','Ciática — irradiação em faixa pela face posterior do membro','Parestesias e fraqueza do membro inferior','Limitação funcional marcada — incapacidade de sentar','Sinal de Lasègue positivo (elevação da perna estendida < 60°)'],
    descricao:'Hérnia discal lombar L4-L5 ou L5-S1. Estenose espinal. Segunda causa de incapacidade em Angola.',
    trat:'• AINE + miorrelaxante (ciclobenzaprina)\n• Fisioterapia e escola da postura\n• Infiltrações epidurais de corticoide\n• Cirurgia se défice neurológico',
    urg:'Síndrome cauda equina: cirurgia emergente 24h'},
  migrânea:{label:'Enxaqueca (Migrânea)',cat:'Neurológico',sev:'MODERADA',sevC:'#FFD700',parts:['head','brain'],
    sintomas:['Cefaleia unilateral pulsátil intensa 4-72h','Fotofobia, fonofobia e náuseas associadas','Aura visual: escotomas cintilantes, hemianopsia','Agravamento com actividade física rotineira','Prodromo: bostejo, irritabilidade, desejo alimentar'],
    descricao:'Disfunção neurovascular trigeminal. 3× mais comum em mulheres. Afecta 12% população.',
    trat:'• Crise: Triptanos (sumatriptano 50 mg)\n• Profilaxia: Topiramato 50-100 mg/dia\n• Propranolol 40-160 mg/dia\n• Evitar desencadeantes: stress, jejum, álcool',
    urg:'Cefaleia em trovoada: urgência (excluir HSA)'},
  depressao:{label:'Depressão Major',cat:'Psiquiátrico',sev:'ALTA',sevC:'#FF8C00',parts:['head','brain','chest'],
    sintomas:['Humor deprimido persistente > 2 semanas','Anedonia — perda de prazer em actividades habituais','Insónia ou hipersónia com fadiga matinal','Sentimentos de culpa, inutilidade e pensamentos de morte','Alterações psicomotoras: agitação ou retardo'],
    descricao:'Transtorno do humor por disfunção serotoninérgica/dopaminérgica. Prevalência Angola 5-8%.',
    trat:'• ISRS: Sertralina 50-200 mg/dia (1ª linha)\n• Psicoterapia cognitivo-comportamental\n• Venlafaxina 75-225 mg/dia se refractária\n• ECT nas formas graves refractárias',
    urg:'Ideação suicida activa: internamento psiquiátrico'},
  esquizofrenia:{label:'Esquizofrenia',cat:'Psiquiátrico',sev:'ALTA',sevC:'#FF8C00',parts:['head','brain'],
    sintomas:['Alucinações auditivas — vozes que comentam actos','Ideias delirantes persecutórias e de referência','Discurso desorganizado e pensamento tangencial','Embotamento afectivo e autismo social','Sintomas negativos: abulia, alogia, anedonia'],
    descricao:'Psicose crónica por hiperdopaminergia mesocortical. Início 15-25 anos. Estigma elevado em Angola.',
    trat:'• Antipsicótico: Risperidona 4-8 mg/dia\n• Olanzapina 10-20 mg/dia (2ª geração)\n• Depôt: Paliperidona palmitato 1×/mês\n• Reabilitação psicossocial',
    urg:'Psicose aguda: internamento e contenção'},
  candidíase:{label:'Candidíase (oral/vaginal/sistémica)',cat:'Fúngico',sev:'MODERADA',sevC:'#FFD700',parts:['abdomen','chest','head'],
    sintomas:['Placas brancas removíveis na mucosa oral (muguet)','Prurido e corrimento vaginal branco e grumoso','Disúria e eritema vaginal (candidíase vulvovaginal)','Candidémia: febre persistente em doente internado','Candida esofágica: odinofagia em imunodeprimido'],
    descricao:'Candida albicans. Risco: antibioterapia, diabetes, VIH, corticoterapia, cateter venoso central.',
    trat:'• Oral/vaginal: Fluconazol 150 mg dose única\n• Esofágica: Fluconazol 200 mg/dia 14-21 dias\n• Candidémia: Equinocandina IV (caspofungina)\n• Nistatina oral suspensão local',
    urg:'Candidémia: retirar CVC e equinocandina IV'},
  infcao_urinaria:{label:'Infecção Urinária (ITU)',cat:'Urológico/Infeccioso',sev:'MODERADA',sevC:'#FFD700',parts:['bladder','kidney_L','kidney_R','pelvis'],
    sintomas:['Disúria — ardor e dor na micção','Polaquiúria — micções frequentes e urgentes','Urina turva, fétida e com hematúria','Pielonefrite: febre alta + lombalgias + calafrios','Criança: febre sem foco em < 2 anos'],
    descricao:'E. coli (85%). Mais comum em mulheres. Pielonefrite necessita tratamento parentérico.',
    trat:'• Cistite: Nitrofurantoína 100 mg 2×/dia 5 dias\n• Pielonefrite: Ciprofloxacina 500 mg 7-14 dias\n• Cultura urina SEMPRE antes de tratar\n• Beber > 2 L água/dia',
    urg:'Pielonefrite com choque: hospitalização urgente'},
  prostata:{label:'Hiperplasia Benigna da Próstata',cat:'Urológico',sev:'MODERADA',sevC:'#FFD700',parts:['pelvis','bladder','abdomen'],
    sintomas:['LUTS: hesitação, jato fraco e intermitente','Nictúria ≥ 2× por noite com urgência','Esvaziamento incompleto e gotejamento terminal','Retenção urinária aguda — globo vesical','PSA elevado e próstata aumentada no TR'],
    descricao:'Hiperplasia adenomiomatosa de zona transicional prostática. Afecta 50% homens > 50 anos.',
    trat:'• Alfa-bloqueante: Tansulosina 0,4 mg noite\n• 5-alfa-redutase: Finasterida 5 mg/dia\n• RTU-P (cirurgia endoscópica) se refractário\n• Cateterismo intermitente na retenção',
    urg:'Retenção aguda: algaliação imediata'},
  endometriose:{label:'Endometriose',cat:'Ginecológico',sev:'MODERADA',sevC:'#FFD700',parts:['pelvis','abdomen'],
    sintomas:['Dismenorreia progressiva — dor menstrual intensa','Dispareunia profunda — dor na relação sexual','Dor pélvica crónica não cíclica','Infertilidade (50% dos casos de endometriose severa)','Disúria/disquezia menstrual — bexiga e recto'],
    descricao:'Tecido endometrial ectópico. Atraso diagnóstico médio: 7-11 anos. Prevalência 10% mulheres.',
    trat:'• DIU-LNG (Mirena) — 1ª linha hormonal\n• Dígestrel 75 mcg/dia contínuo\n• Análogos GnRH: Triptorelina 3,75 mg/mês\n• Cirurgia laparoscópica (excisão lesões)',
    urg:'Endometrioma roto: cirurgia urgente'},
  cancro_colo:{label:'Cancro do Colo do Útero',cat:'Oncológico · Angola alta incidência',sev:'CRÍTICA',sevC:'#FF2020',parts:['pelvis','abdomen'],
    sintomas:['Sangramento vaginal pós-coital (sinal de alarme)','Corrimento vaginal fétido e sanguinolento','Dor pélvica persistente irradiando para coxas','Hematúria e rectorragia (invasão órgãos adjacentes)','Edema membros inferiores (compressão linfática)'],
    descricao:'HPV 16/18 (99% casos). Angola: incidência 47/100.000 — uma das mais altas do mundo.',
    trat:'• Estádio I-II: Radioterapia + Quimio (cisplatina)\n• Cirurgia: histerectomia radical (Wertheim)\n• Estádio IV: Bevacizumab + quimio paliativa\n• Vacina HPV (9–14 anos) previne 90%',
    urg:'CRÍTICA — Rastreio citologia cada 3 anos'},
  cancro_mama:{label:'Cancro da Mama',cat:'Oncológico',sev:'CRÍTICA',sevC:'#FF2020',parts:['chest'],
    sintomas:['Nódulo mamário indolor de consistência dura','Retracção do mamilo ou da pele (sinal de casca de laranja)','Adenopatia axilar ipsilateral endurecida','Corrimento mamilar sanguinolento espontâneo','Mama inflamatória: eritema + calor + edema difuso'],
    descricao:'2ª neoplasia feminina em Angola. Triple negativo mais frequente em jovens africanas — pior prognóstico.',
    trat:'• Cirurgia: mastectomia ou tumorectomia + esvaziamento\n• Quimio adjuvante: AC-T (antraciclinas)\n• Trastuzumab se HER2+\n• Hormonoterapia: tamoxifeno 5-10 anos',
    urg:'CRÍTICA — Auto-exame mensal + mamografia > 40 anos'},
  cancro_prostata:{label:'Cancro da Próstata',cat:'Oncológico',sev:'CRÍTICA',sevC:'#FF2020',parts:['pelvis','abdomen','bone_pelvis'],
    sintomas:['LUTS obstrutivos: retenção, jato fraco (estádio avançado)','Hematospermia e hematúria','Dor óssea intensa (metástases vertebrais)','PSA > 10 ng/mL com endurecimento prostático ao TR','Perda peso e astenia nas formas metastáticas'],
    descricao:'Neoplasia mais comum no homem angolano > 60 anos. Afro-descendentes: risco 2× maior.',
    trat:'• Localizado: Prostatectomia radical ou RT\n• Hormono-sensível: Deprivação androgénica (LHRH agonista)\n• Castração-resistente: Enzalutamida, Abiraterona\n• Ossos: Ácido zoledrónico IV',
    urg:'CRÍTICA — PSA > 10 + TR suspeito: biopsia urgente'},
  cancro_colon:{label:'Cancro Colo-Rectal',cat:'Oncológico',sev:'CRÍTICA',sevC:'#FF2020',parts:['abdomen','pelvis'],
    sintomas:['Sangue nas fezes — rectorragia ou hematoquézia','Alteração hábito intestinal: obstipação/diarreia nova','Dor abdominal persistente e distensão','Síndrome rectal: tenesmo e sensação esvaziamento incompleto','Perda de peso involuntária e anemia microcítica'],
    descricao:'90% adenocarcinoma. Rastreio com colonoscopia > 50 anos reduz mortalidade 60%.',
    trat:'• Cirurgia: hemicolectomia ou ressecção anterior\n• Quimio adjuvante: FOLFOX/FOLFIRI\n• Bevacizumab + cetuximab (metastático)\n• RT pré-op no rectal localmente avançado',
    urg:'Obstrução ou perfuração: cirurgia emergente'},
  cancro_hepatico:{label:'Carcinoma Hepatocelular',cat:'Oncológico · Angola',sev:'CRÍTICA',sevC:'#FF2020',parts:['abdomen','liver'],
    sintomas:['Dor em hipocôndrio direito com massa palpável','Icterícia progressiva e ascite de novo','Perda de peso e anorexia severas','AFP sérica muito elevada (> 400 ng/mL)','Síndrome de Budd-Chiari por trombose venosa'],
    descricao:'Cirrose VHB/VHC + aflatoxina são os principais factores em Angola. Incidência muito alta (> 50/100.000).',
    trat:'• Ressecável: hepatectomia parcial\n• Não ressecável: TACE ou ablação RF\n• Sorafenib ou Lenvatinib (sistémico)\n• Transplante hepático (critérios de Milão)',
    urg:'CRÍTICA — Prognóstico sombrio se diagnosticado tarde'},
  cirrose:{label:'Cirrose Hepática',cat:'Hepático',sev:'ALTA',sevC:'#FF8C00',parts:['abdomen','liver','spleen'],
    sintomas:['Icterícia e prurido generalizado por colestase','Ascite com "abdómen de batráquio"','Varizes esofágicas com hematemese massiva','Encefalopatia hepática — desorientação e asterixis','Síndrome hepatorrenal — IRA no cirrótico'],
    descricao:'Fibrose hepática irreversível. Causas Angola: VHB (50%), álcool (30%), VHC (15%).',
    trat:'• Diuréticos: Espironolactona + Furosemida\n• Propranolol profilaxia varizes\n• Lactulose 3×/dia (encefalopatia)\n• Transplante hepático (único tratamento curativo)',
    urg:'Hemorragia variceal: endoscopia + Terlipressina IV'},
  pancreatite:{label:'Pancreatite Aguda',cat:'Gastrointestinal',sev:'ALTA',sevC:'#FF8C00',parts:['abdomen','pancreas','spine'],
    sintomas:['Dor epigástrica intensa em cinturão irradiando dorso','Náuseas e vómitos incoercíveis','Sinal de Cullen (umbilical) e Grey-Turner (flanco) — formas necróticas','Lipase/amilase > 3× VR confirmam diagnóstico','Febre, íleo e distensão nas formas graves'],
    descricao:'Álcool (40%) e colelitíase (40%) são as principais causas. Mortalidade 10-30% na forma necrótica.',
    trat:'• Nada via oral + analgesia IV (morfina)\n• Hidratação agressiva RL 250-500 mL/h\n• Nutrição entérica precoce (< 48h)\n• ATB só se necrose infectada (imipenem)',
    urg:'Pancreatite necrótica: UCI + cirurgia'},
  colelitíase:{label:'Colelitíase / Colecistite',cat:'Gastrointestinal/Cirúrgico',sev:'MODERADA',sevC:'#FFD700',parts:['abdomen','liver'],
    sintomas:['Cólica biliar: dor FSD pós-refeição gorda irradiando escápula','Náuseas, vómitos e intolerância a gorduras','Colecistite aguda: febre + Murphy positivo','Icterícia obstrutiva (coledocolitíase)','Sinal de Charcot: febre + icterícia + dor (colangite)'],
    descricao:'Cálculos de colesterol (80%) ou bilirrubinato (20%). Mais frequente em mulheres, grávidas e obesas.',
    trat:'• Colecistectomia laparoscópica (electiva)\n• Colecistite aguda: ATB + colecistectomia < 72h\n• CPRE para coledocolitíase\n• Dieta hipolipídica até cirurgia',
    urg:'Colangite séptica: CPRE de urgência'},
  calc_renal:{label:'Nefrolitíase (Cálculo Renal)',cat:'Urológico',sev:'MODERADA',sevC:'#FFD700',parts:['kidney_L','kidney_R','abdomen','pelvis'],
    sintomas:['Cólica nefrética: dor lombar irradiando à virilha e testículo','Hematúria macro ou microscópica intensa','Náuseas e vómitos reflexos','Disúria e urgência miccional com saída de cálculo','Febre + cólica: obstrução infectada — emergência'],
    descricao:'Oxalato de cálcio (80%). Risco: desidratação (comum em Angola), dieta rica em proteína animal.',
    trat:'• Analgesia: Cetoprofeno 100 mg IV ou IM\n• Hidratação generosa ≥ 3L/dia\n• < 5 mm: expulsão espontânea 80%\n• > 10 mm: Litotrícia (ESWL) ou ureteroscopia',
    urg:'Obstrução infectada (pionefrose): drenagem urgente'},
  ovario_pq:{label:'Síndrome do Ovário Poliquístico (SOP)',cat:'Ginecológico/Endócrino',sev:'MODERADA',sevC:'#FFD700',parts:['pelvis','abdomen'],
    sintomas:['Oligomenorreia/amenorreia — ciclos > 35 dias ou ausentes','Hiperandrogenismo: hirsutismo, acne e alopecia androgénica','Infertilidade anovulatória','Ovários poliquísticos na ecografia (> 12 folículos < 9 mm)','Resistência insulínica: acantose nigricans, obesidade central'],
    descricao:'Endocrinopatia mais comum em mulheres em idade fértil (10%). Risco cardiovascular e DM2 a longo prazo.',
    trat:'• ACO: Etinilestradiol + Ciproterona (antiandrogénico)\n• Metformina 500-1500 mg/dia (RI)\n• Clomifeno (indução ovulação)\n• Espironolactona para hirsutismo',
    urg:'MODERADA — Seguimento endocrinológico regular'},
  eclampsia:{label:'Pré-eclâmpsia / Eclâmpsia',cat:'Obstétrico · Angola',sev:'CRÍTICA',sevC:'#FF2020',parts:['head','brain','kidney_L','kidney_R','heart'],
    sintomas:['PA ≥ 140/90 após 20 semanas de gravidez','Proteinúria ≥ 300 mg/24h (pré-eclâmpsia)','Cefaleia frontal intensa e escotomas visuais','Eclâmpsia: convulsões tónico-clónicas na grávida','Síndrome HELLP: hemólise + trombocitopenia + enzimas ↑'],
    descricao:'Principal causa de mortalidade materna em Angola. Resolução definitiva: expulsão do feto-placenta.',
    trat:'• Sulfato de Magnésio 4g IV (prevenção/trat convulsões)\n• Anti-hipertensivo: Labetalol IV ou Nifedipina oral\n• Parto/cesariana se > 37 sem ou instabilidade\n• UCI materna nas formas graves',
    urg:'EMERGÊNCIA — Ligar 112 e transporte imediato ao hospital'},
  fibroma:{label:'Fibroma Uterino (Mioma)',cat:'Ginecológico',sev:'MODERADA',sevC:'#FFD700',parts:['pelvis','abdomen'],
    sintomas:['Menorragia — sangramento menstrual abundante + anemia','Dismenorreia progressiva e dor pélvica crónica','Sintomas compressivos: polaquiúria e obstipação','Infertilidade e abortamentos de repetição','Massa pélvica palpável com útero irregular aumentado'],
    descricao:'Tumor benigno miometrial mais comum. Angola: prevalência altíssima (70-80% mulheres afrodescendentes).',
    trat:'• Análogos GnRH: Triptorelina pré-op (redução tumor)\n• Miomectomia laparoscópica (preserva fertilidade)\n• Embolização artérias uterinas (EAU)\n• Histerectomia (prole completa)',
    urg:'Torsão ou infecção: cirurgia urgente'},
  lupus:{label:'Lúpus Eritematoso Sistémico',cat:'Reumatológico/Imunológico',sev:'ALTA',sevC:'#FF8C00',parts:['skin','kidney_L','kidney_R','heart','head','knee_L','knee_R','hand_L','hand_R'],
    sintomas:['Rash malar em asa de borboleta — fotossensível','Artrite não erosiva simétrica de pequenas articulações','Nefrite lúpica: proteinúria, hematúria e IRA','Serosite: pleurite e pericardite','ANA + anti-dsDNA elevados — marcadores imunológicos'],
    descricao:'Doença autoimune sistémica com deposição de imunocomplexos. 9× mais comum em mulheres; pior em afrodescendentes.',
    trat:'• Hidroxicloroquina 200-400 mg/dia (base do trat)\n• Corticoides na actividade\n• Micofenolato mofetil (nefrite lúpica)\n• Belimumab (anticorpo anti-BLyS)',
    urg:'Nefrite lúpica activa: biopsia renal urgente'},
  trombose:{label:'Trombose Venosa Profunda (TVP)',cat:'Vascular',sev:'ALTA',sevC:'#FF8C00',parts:['shin_L','shin_R','knee_L','knee_R','chest','foot_L','foot_R'],
    sintomas:['Edema unilateral assimétrico de membro inferior','Dor à palpação do trajecto venoso (sinal de Homans)','Calor e eritema ao longo da veia trombosada','Embolia pulmonar: dispneia súbita + dor torácica + taquicardia','Score Wells ≥ 2: alta probabilidade clínica'],
    descricao:'Tríade de Virchow: estase + hipercoagulabilidade + lesão endotelial. Risco: pós-op, gravidez, imobilização.',
    trat:'• HBPM: Enoxaparina 1 mg/kg 2×/dia\n• NOAC: Rivaroxabano 15 mg 2×/dia × 21 dias\n• Anticoagulação 3 meses mínimo\n• Meia de compressão graduada',
    urg:'Embolia pulmonar maciça: trombolítico rtPA IV'},
  sinusite:{label:'Sinusite Aguda Bacteriana',cat:'ORL',sev:'MODERADA',sevC:'#FFD700',parts:['head'],
    sintomas:['Dor facial/cefálica piorando com inclinação para a frente','Rinorreia purulenta persistente > 10 dias','Obstrução nasal marcada com anosmia','Febre > 38°C com mal-estar geral','Sinal de percussão ou compressão sinusal positivo'],
    descricao:'Streptococcus pneumoniae + Haemophilus influenzae após rinite viral > 10 dias. Mais comum em adultos jovens.',
    trat:'• Amoxicilina-Ácido Clavulânico 875/125 mg 2×/dia 7-10 dias\n• Descongestionante nasal tópico (oximetazolina) < 5 dias\n• Lavagem nasal com SF\n• Corticóide nasal (mometasona)',
    urg:'Celulite orbitária ou meningite: urgência'},
  otite:{label:'Otite Média Aguda',cat:'ORL',sev:'MODERADA',sevC:'#FFD700',parts:['head'],
    sintomas:['Otalgia intensa de instalação súbita, especialmente nocturna','Febre ≥ 38°C com irritabilidade (lactente)','Hipoacusia e sensação de ouvido tapado','Otorreia purulenta se perfuração espontânea','Otoscopia: tímpano abaulado e eritematoso'],
    descricao:'Streptococcus pneumoniae + H. influenzae. Mais frequente em crianças < 3 anos.',
    trat:'• Amoxicilina 80–90 mg/kg/dia 5-10 dias\n• AMOX-CLAV se falha 48-72h\n• Analgesia: ibuprofeno/paracetamol\n• Paracentese se dor intratável',
    urg:'Mastoidite (complicação): otorrinolaringologia urgente'},
  amigdalite:{label:'Amigdalite Estreptocócica',cat:'ORL/Infeccioso',sev:'MODERADA',sevC:'#FFD700',parts:['head','neck'],
    sintomas:['Odinofagia intensa com disfagia','Febre alta > 38,5°C com calafrios','Amígdalas edemaciadas com exsudado purulento branco','Adenopatia cervical anterior dolorosa (ângulo mandibular)','Score McIsaac ≥ 3: alta probabilidade EGA'],
    descricao:'Streptococcus pyogenes (EGA). Risco sequela: febre reumática se não tratada com ATB.',
    trat:'• Penicilina V 500 mg 3×/dia 10 dias\n• Amoxicilina 50 mg/kg/dia 10 dias\n• Alérgicos: Azitromicina 5 dias\n• Amigdalectomia se ≥ 7 episódios/ano',
    urg:'Abcesso periamigdalino: drenagem urgente'},
  conjuntivite:{label:'Conjuntivite Infecciosa',cat:'Oftalmológico',sev:'BAIXA',sevC:'#00CC66',parts:['eye_L','eye_R','head'],
    sintomas:['Hiperémia conjuntival bilateral intensa','Secreção mucopurulenta (bacteriana) ou aquosa (viral)','Prurido e lacrimejo com sensação de areia','Quemose — edema da conjuntiva','Blefaroespasmo e fotofobia ligeira'],
    descricao:'Viral (adenovírus — 80%) ou bacteriana (S. aureus, H. influenzae). Altamente contagiosa.',
    trat:'• Viral: higiene das mãos + compressa fria\n• Bacteriana: Tobramicina 0,3% colírio 5×/dia 7 dias\n• Neonatal por gonococo: ceftriaxona IV urgente\n• Não usar lentes de contacto',
    urg:'Recém-nascido com secreção ocular: urgência'},
  tracoma:{label:'Tracoma (Cegueira por Chlamydia)',cat:'Oftalmológico · Angola endémico',sev:'ALTA',sevC:'#FF8C00',parts:['eye_L','eye_R'],
    sintomas:['Conjuntivite folicular crónica recorrente na infância','Pannus corneal — vascularização corneal superior','Entropion e triquíase — pestanas que arranhham córnea','Opacidade corneal progressiva — cegueira gradual','Fotofobia, lacrimejo e dor ocular crónica'],
    descricao:'Chlamydia trachomatis serovares A-C. 2ª causa de cegueira evitável no mundo. Endémica em zonas rurais de Angola.',
    trat:'• Azitromicina 1g dose única ou pomada tetraciclina 6 sem\n• Cirurgia de triquíase (inversão pálpebra)\n• Estratégia SAFE (Cirurgia + ATB + Facial + Ambiental)',
    urg:'Triquíase activa: cirurgia para evitar cegueira'},
  dermAtite:{label:'Dermatite Atópica (Eczema)',cat:'Dermatológico',sev:'MODERADA',sevC:'#FFD700',parts:['skin','head','chest'],
    sintomas:['Prurido intenso com exacerbação nocturna','Placas eritematosas escamosas em flexuras (cotovelos, joelhos)','Pele seca (xerose) com liquenificação crónica','Infecções bacterianas secundárias (S. aureus)','Associação com asma e rinite alérgica (marcha atópica)'],
    descricao:'Disfunção barreira cutânea + resposta Th2 excessiva. Início < 5 anos na maioria.',
    trat:'• Emolientes frequentes base do tratamento\n• Corticóide tópico moderado (hidrocortisona 1%)\n• Tacrolimus/pimecrolimus poupar esteróides\n• Dupilumab sc para formas graves',
    urg:'Eczema herpeticum (Kaposi): aciclovir urgente'},
  psoriase:{label:'Psoríase',cat:'Dermatológico',sev:'MODERADA',sevC:'#FFD700',parts:['skin','head','knee_L','knee_R','hand_L','hand_R'],
    sintomas:['Placas eritematossquamosas prateadas bem delimitadas','Localização preferencial: cotovelos, joelhos, couro cabeludo','Prurido variável — pode ser intenso','Unhas: picaduras, onicólise e discromia ungueal','Artrite psoriática em 30% — deformante e erosiva'],
    descricao:'Hiperproliferação epidérmica por resposta Th17. Prevalência 2-3%. Crónica com exacerbações.',
    trat:'• Corticóide + análogo vitamina D (calcipotriol) tópico\n• Fototerapia UVB narrow-band\n• Metotrexato 15 mg/semana\n• Biológicos: secukinumab, ixekizumab (IL-17)',
    urg:'Psoríase eritrodérmica ou pustulosa: hospitalização'},
  gonorreia:{label:'Gonorreia (IST)',cat:'Infeccioso/IST',sev:'ALTA',sevC:'#FF8C00',parts:['pelvis','abdomen','head'],
    sintomas:['Corrimento uretral purulento amarelo-esverdeado (homem)','Corrimento vaginal purulento e disúria (mulher)','Muitas mulheres assintomáticas — diagnóstico tardio','DIP: dor pélvica aguda + febre (complicação grave)','Artrite gonocócica: mono ou oligoartrite séptica'],
    descricao:'Neisseria gonorrhoeae. IST mais comum em Angola. Resistência crescente à ciprofloxacina.',
    trat:'• Ceftriaxona 500 mg IM dose única\n• Azitromicina 1g oral (coinfecção Chlamydia)\n• Tratar parceiro(s) simultaneamente\n• Preservativo previne 98%',
    urg:'DIP com abcesso tubo-ovárico: cirurgia urgente'},
  sifilis:{label:'Sífilis (IST)',cat:'Infeccioso/IST',sev:'ALTA',sevC:'#FF8C00',parts:['skin','head','brain','heart','pelvis','bone_pelvis'],
    sintomas:['Cancro duro indolor — úlcera genital limpa (sífilis primária)','Roséola sifilítica — exantema palmo-plantar (sífilis secundária)','Condiloma lata, alopecia e linfadenopatia generalizada','Goma sifilítica e sífilis cardiovascular/nervosa (terciária)','Sífilis congénita: abortamento, hidropisia, sequelas graves'],
    descricao:'Treponema pallidum. Incidência crescente em Angola. Obrigatório rastrear em grávidas.',
    trat:'• Penicilina G Benzatina 2.400.000 UI IM\n• Neurossífilis: Penicilina G Cristalina IV 10-14 dias\n• Grávida: rastreio VDRL no 1º e 3º trimestre\n• Tratar parceiro simultâneo',
    urg:'Sífilis congénita: notificação e tratamento imediato'},
  raiva:{label:'Raiva (Hidrofobia)',cat:'Viral · Angola',sev:'CRÍTICA',sevC:'#FF2020',parts:['head','brain','neck','chest'],
    sintomas:['Prodromo: dor, parestesias no local da mordedura','Hidrofobia — espasmo faríngeo ao ver/sentir água','Aerofobia — corrente de ar desencadeia espasmo','Agitação extrema e agressividade','Coma e morte inevitável após sintomas neurológicos'],
    descricao:'Lyssavirus. 100% fatal após sintomas. Angola: exposição frequente por cão e morcego. Profilaxia salva vidas.',
    trat:'• PROFILAXIA PÓS-EXPOSIÇÃO: lavar ferida 15 min c/água+sabão\n• Imunoglobulina anti-rábica + vacina × 4 doses\n• Sem profilaxia: morte inevitável em 7-14 dias',
    urg:'EMERGÊNCIA — Iniciar profilaxia nas primeiras 24h'},
  tetano:{label:'Tétano',cat:'Infeccioso · Angola',sev:'CRÍTICA',sevC:'#FF2020',parts:['head','neck','chest','abdomen','spine'],
    sintomas:['Trismo — espasmo dos masseteres com dificuldade de abrir a boca','Riso sardónico — espasmo facial característico','Opisthotonus — espasmo extensor generalizado do dorso','Convulsões por estímulos mínimos (luz, som, toque)','Disfagia, disfonia e paragem respiratória'],
    descricao:'Clostridium tetani (esporos na terra). Angola: cobertura DTP baixa < 60% crianças. Mortalidade 50%.',
    trat:'• IMUNOGLOBULINA TETÂNICA 3000-6000 UI IM urgente\n• Metronidazol 500 mg 4×/dia 10 dias\n• Diazepam IV para espasmos\n• UCI + ventilação mecânica frequentemente necessária',
    urg:'EMERGÊNCIA — UCI obrigatória'},
  diarreia_aguda:{label:'Gastroenterite Aguda Infecciosa',cat:'Gastrointestinal · Angola',sev:'MODERADA',sevC:'#FFD700',parts:['abdomen','stomach'],
    sintomas:['Diarreia líquida > 3 dejecções/dia de instalação súbita','Vómitos incoercíveis com náuseas','Cólicas abdominais difusas peri e intra-dejeccionais','Febre variável (bacteriana > viral)','Sinais de desidratação: sede + oligúria + mucosas secas'],
    descricao:'Rotavírus (crianças) e Norovírus (adultos) mais comuns. Bacterianas: E. coli, Salmonella, Campylobacter.',
    trat:'• Soro de Reidratação Oral (SRO) — principal tratamento\n• Zinco 20 mg/dia 10-14 dias em crianças\n• ATB só se sanguinolenta + febre: ciprofloxacina\n• Probióticos: reduzem duração 1 dia',
    urg:'Criança < 5 anos com desidratação grave: hospitalização'},
  desidratacao:{label:'Desidratação Severa',cat:'Urgência · Angola',sev:'CRÍTICA',sevC:'#FF2020',parts:['kidney_L','kidney_R','heart','head','abdomen'],
    sintomas:['Mucosas secas, olhos encovados e pele com turgor diminuído','Taquicardia compensatória > 100 bpm','Hipotensão ortostática e oligúria < 0,5 mL/kg/h','Fontanela deprimida em lactentes','Glasgow diminuído — letargia e confusão mental'],
    descricao:'Desequilíbrio hidroelectrolítico. Causa principal: diarreia e vómitos (muito frequente em Angola).',
    trat:'• SRO 75 mL/kg em 4h (desidratação moderada)\n• Soro Fisiológico 20 mL/kg IV bolus rápido (grave)\n• Monitorizar diurese e sinais vitais\n• Tratar causa base',
    urg:'Choque hipovolémico: ressuscitação IV imediata'},
  hipertiroidismo:{label:'Hipertiroidismo / Doença de Graves',cat:'Endócrino',sev:'MODERADA',sevC:'#FFD700',parts:['neck','thyroid','heart','eye_L','eye_R'],
    sintomas:['Taquicardia persistente > 100 bpm em repouso','Perda de peso com apetite mantido ou aumentado','Tremor fino das extremidades e nervosismo','Exoftalmia bilateral (doença de Graves)','Intolerância ao calor e sudorese excessiva'],
    descricao:'TSH suprimida + T3/T4 elevados. Graves: anticorpos anti-receptor TSH. Afecta mais mulheres.',
    trat:'• Antitiróideu: Metimazol 20-40 mg/dia\n• Beta-bloqueante: Propranolol (sintomas adrenérgicos)\n• Iodo radioactivo 131I (tratamento definitivo)\n• Tiroidectomia total',
    urg:'Tempestade tiróideia: UCI + Propranolol + Metimazol IV'},
  hipotiroidismo:{label:'Hipotiroidismo',cat:'Endócrino',sev:'MODERADA',sevC:'#FFD700',parts:['neck','thyroid','heart','head'],
    sintomas:['Astenia crónica profunda e sonolência excessiva','Intolerância ao frio e pele seca com bradilalia','Obstipação crónica e ganho de peso sem alteração dieta','Bradicárdia e voz rouca com cabelo fino/seco','TSH elevada + T4 livre baixa confirma diagnóstico'],
    descricao:'Tireoidite de Hashimoto (autoimune) mais frequente. Hipotiroidismo congénito causa cretinismo.',
    trat:'• Levotiroxina (LT4) 1,6 µg/kg/dia em jejum\n• Monitorizar TSH 6-8 semanas após início\n• Gravidez: aumentar dose 30%\n• Rever anualmente (dose pode variar)',
    urg:'Coma mixedematoso: LT4 IV + corticoide emergente'},
  obezidade:{label:'Obesidade / Síndrome Metabólico',cat:'Endócrino/Metabólico',sev:'CRÓNICA',sevC:'#4DBBFF',parts:['abdomen','heart','knee_L','knee_R'],
    sintomas:['IMC ≥ 30 kg/m² (obesidade) ou ≥ 35 (obesidade grave)','Acantose nigricans — pele escurecida nas dobras','Síndrome de apneia obstrutiva do sono — roncopatia','Dispneia de esforço precoce e artralgia por carga','Perímetro abdominal > 102 cm H / > 88 cm M'],
    descricao:'Epidemia crescente em Luanda. Síndrome metabólico: obesidade + HTA + dislipidemia + DM2.',
    trat:'• Défice calórico 500-1000 kcal/dia\n• Actividade física aeróbia 150 min/semana\n• Orlistato 120 mg 3×/dia\n• Cirurgia bariátrica se IMC > 40 ou > 35 com comorbilidades',
    urg:'Obesidade + dispneia aguda: SAOS grave urgente'},
  neuropatia:{label:'Neuropatia Periférica',cat:'Neurológico',sev:'MODERADA',sevC:'#FFD700',parts:['foot_L','foot_R','hand_L','hand_R','shin_L','shin_R'],
    sintomas:['Parestesias em luva e meia — formigueiros progressivos','Alodínia — dor ao toque ligeiro nos pés','Fraqueza muscular distal (síndrome de andar em algodão)','Reflexos aquilianos ausentes bilateral','Úlceras neurotróficas plantares indolores (pé diabético)'],
    descricao:'Diabetes (causa mais comum em Angola), VIH, desnutrição B12, álcool, ARV (ddI/d4T).',
    trat:'• Tratar causa base (controlo glicémico)\n• Gabapentina 300-1200 mg/dia\n• Amitriptilina 10-75 mg noite\n• Ácido alfa-lipoico 600 mg/dia',
    urg:'Úlcera pé diabético infectada: hospitalização'},
  alzheimer:{label:'Doença de Alzheimer',cat:'Neurológico',sev:'CRÓNICA',sevC:'#4DBBFF',parts:['head','brain'],
    sintomas:['Amnésia recente progressiva — esquece eventos recentes','Desorientação espacial e temporal gradual','Afasia, apraxia e agnosia (fases avançadas)','Alterações comportamentais: agitação e agressividade','Perda total autonomia nas actividades diárias'],
    descricao:'Demência por depósito amilóide e emaranhados tau. Causa 60-70% das demências. Progressiva e irreversível.',
    trat:'• Inibidor AChE: Donepezilo 5-10 mg/dia\n• Memantina 20 mg/dia (fases moderadas-graves)\n• Lecanemab (anticorpo anti-amilóide — novo)\n• Apoio cuidador e estimulação cognitiva',
    urg:'CRÓNICA — Segurança domiciliar crucial'},
  parkinson:{label:'Doença de Parkinson',cat:'Neurológico',sev:'CRÓNICA',sevC:'#4DBBFF',parts:['head','brain','hand_L','hand_R'],
    sintomas:['Tremor de repouso assimétrico (pílula de rolar)','Bradicínesia — lentidão progressiva de movimentos','Rigidez em roda dentada dos membros','Instabilidade postural com marcha festinante','Micrografia e hipomimia (face de máscara)'],
    descricao:'Perda neurónios dopaminérgicos da substância negra. Corpos de Lewy. Causa desconhecida.',
    trat:'• Levodopa/Carbidopa 100/25 mg 3×/dia (gold standard)\n• Pramipexol (agonista dopaminérgico)\n• IMAO-B: Selegilina ou Rasagilina\n• DBS (estimulação cerebral profunda)',
    urg:'CRÓNICA — Ajuste regular de medicação'},
  esclerose_mult:{label:'Esclerose Múltipla',cat:'Neurológico/Imunológico',sev:'ALTA',sevC:'#FF8C00',parts:['head','brain','spine','eye_L'],
    sintomas:['Neurite óptica: perda visão monocular com dor ao movimento','Fraqueza/espasticidade num ou vários membros','Ataxia cerebelosa com disartria','Sintoma de Lhermitte: choque eléctrico na flexão cervical','Disfunção vesical e fadiga desproporcional'],
    descricao:'Doença desmielinizante autoimune do SNC. Recidivante-remitente (85%). Mais em mulheres 20-40 anos.',
    trat:'• Surto: Metilprednisolona 1g/dia IV × 5 dias\n• Modificadores doença: Natalizumab, Ocrelizumab, Siponimod\n• Interferão β-1a/1b\n• Fisioterapia e reabilitação',
    urg:'Surto grave: neurologista e corticoide IV urgente'},
  fibrilacao:{label:'Fibrilação Auricular',cat:'Cardiovascular',sev:'ALTA',sevC:'#FF8C00',parts:['heart','chest','head','brain'],
    sintomas:['Palpitações irregulares "coração aos saltos"','Dispneia de esforço e fadiga fácil','AVC isquémico por trombo auricular (risco 5×)','Hipotensão e síncope na FC muito rápida','ECG: ausência de ondas P + intervalo R-R irregular'],
    descricao:'Arritmia mais comum. CHA₂DS₂VASc guia anticoagulação. HTA + cardiopatia reumática: causas em Angola.',
    trat:'• Anticoagulação: Rivaroxabano ou Warfarina\n• Controlo frequência: Bisoprolol ou digoxina\n• Cardioversão eléctrica se < 48h\n• Ablação por cateter em doentes seleccionados',
    urg:'AVC + FA: anticoagular com urgência'},
  angina:{label:'Angina de Peito Instável',cat:'Cardiovascular',sev:'CRÍTICA',sevC:'#FF2020',parts:['heart','chest','arm_L'],
    sintomas:['Dor precordial em aperto em repouso ou mínimo esforço','Irradiação para mandíbula, pescoço e braço esquerdo','Duração < 20 min com alívio com nitroglicerina','ECG: infradesnivelamento ST ou inversão T','Troponina normal ou ligeiramente elevada'],
    descricao:'SCASEST — aterosclerose coronária com rotura de placa sem oclusão total. Risco EAM em 72h.',
    trat:'• AAS 300 mg + Ticagrelor 180 mg imediato\n• Fondaparinux 2,5 mg SC\n• Nitroglicerina sublingual + beta-bloqueante\n• Coronariografia + PCI nas primeiras 24-72h',
    urg:'EMERGÊNCIA — Risco de evolução para EAM'},
  aneurisma:{label:'Aneurisma Aórtico',cat:'Vascular/Cardiovascular',sev:'CRÍTICA',sevC:'#FF2020',parts:['abdomen','chest'],
    sintomas:['Dor abdominal ou torácica súbita e excruciante','Massa pulsátil palpável periumbilical (AAA)','Síncope e colapso hemodinâmico (rotura)','Dor dorsal irradiando para ambos os flancos','Sinais isquémicos periféricos por embolização'],
    descricao:'Dilatação arterial > 50% do diâmetro normal. HTA + tabaco: factores de risco principais.',
    trat:'• Assintomático < 5,5 cm: vigilância ecografia 6/6 meses\n• Cirurgia (EVAR ou aberta) se ≥ 5,5 cm ou expansão rápida\n• Rotura: cirurgia emergente (mortalidade 40-50%)\n• Controlo rigoroso HTA',
    urg:'Rotura: bloco operatório imediato'},
  embolia_pulm:{label:'Embolia Pulmonar',cat:'Respiratório/Vascular',sev:'CRÍTICA',sevC:'#FF2020',parts:['chest','lung_L','lung_R','heart'],
    sintomas:['Dispneia súbita inexplicável sem causa aparente','Dor torácica pleurítica aguda','Taquicardia > 100 bpm e taquipneia > 20','Hemoptise e síncope (formas maciças)','Sinais TVP: edema assimétrico membro inferior'],
    descricao:'Oclusão artéria pulmonar por trombo (90% TVP). Wells Score + D-dímeros orientam diagnóstico.',
    trat:'• Heparina não fraccionada IV bolus + perfusão\n• HBPM: Enoxaparina 1 mg/kg 2×/dia\n• Trombólise sistémica se instabilidade hemodinâmica\n• NOAC (rivaroxabano) para longo prazo',
    urg:'EP maciça com choque: trombólise emergente'},
  leishmaniose_cut:{label:'Leishmaniose Cutânea (Bouba/Botão Oriental)',cat:'Parasitário · Angola',sev:'MODERADA',sevC:'#FFD700',parts:['skin','head'],
    sintomas:['Pápula indolente no local da picada do flebótomo','Evolução para úlcera com bordos endurecidos ("cratérica")','Lesão indolente de cura espontânea em 3-18 meses','Cicatriz definitiva e desfigurante','Forma mucosa: destruição do septo nasal (Leishmania braziliensis)'],
    descricao:'Leishmania major / tropica. Transmitida por flebótomos fêmea. Endémica em zonas áridas de Angola.',
    trat:'• Antimoniato meglumina intralesional ou sistémico\n• Miltefosina oral 2,5 mg/kg/dia 28 dias\n• Fluconazol 200 mg/dia 6 semanas (alternativa)\n• Crioterapia local em lesões únicas pequenas',
    urg:'MODERADA — Forma mucosa: tratamento sistémico obrigatório'},
  lepra:{label:'Lepra (Hanseníase)',cat:'Bacteriano · Angola',sev:'ALTA',sevC:'#FF8C00',parts:['skin','hand_L','hand_R','foot_L','foot_R','eye_L','eye_R'],
    sintomas:['Máculas hipocrómicas com perda de sensibilidade','Espessamento de nervos periféricos palpáveis','Anestesia das mãos e pés — "mãos de luva"','Madarose — queda das sobrancelhas e cílios','Lagoftalmo e úlceras por anestesia corneal'],
    descricao:'Mycobacterium leprae. Bacilo de crescimento lentíssimo. Notificação obrigatória. Angola ainda notifica casos.',
    trat:'• Paucibacilar: Rifampicina + Dapsona 6 meses\n• Multibacilar: Rifampicina + Clofazimina + Dapsona 12 meses\n• Fisioterapia para deformidades\n• Protecção cutânea e ocular',
    urg:'Reacção hanseniana tipo 2 (ENH): prednisona urgente'},
  meningite_tb:{label:'Meningite Tuberculosa',cat:'Neurológico/Infeccioso',sev:'CRÍTICA',sevC:'#FF2020',parts:['head','brain','neck'],
    sintomas:['Cefaleia subaguda progressiva 1-4 semanas','Febre moderada com meningismo e rigidez nuca','Pares cranianos: ptose, estrabismo, diplopia','Hidrocefalia com hipertensão intracraniana','LCR: linfocitose + proteínas ↑ + glicose ↓'],
    descricao:'Mycobacterium tuberculosis com disseminação hematogénica. Mortalidade 30% e sequelas em 50% sobreviventes.',
    trat:'• HRZE 2 meses + HR 10 meses\n• Dexametasona 0,3-0,4 mg/kg/dia 6-8 semanas\n• Drenagem hidrocefalia se necessário\n• DOT supervisionado',
    urg:'CRÍTICA — Iniciar tratamento empírico sem aguardar confirmação'},
  sarampo_comp:{label:'Sarampo Complicado / Encefalite',cat:'Neurológico/Viral',sev:'CRÍTICA',sevC:'#FF2020',parts:['head','brain','chest','lung_L','lung_R'],
    sintomas:['Febre persistente após exantema (D5+) — sinal de complicação','Convulsões e alteração do estado mental','Pneumonia de sarampo com insuficiência respiratória','SSPE: encefalite progressiva anos após sarampo','Cegueira por queratite e deficiência vitamina A'],
    descricao:'Complicação grave: pneumonia (30%), encefalite (0,1%), SSPE (7-11/100.000). Crianças malnutridas em Angola.',
    trat:'• Vitamina A 200.000 UI 2 dias (OBRIGATÓRIO)\n• ATB para pneumonia secundária\n• Suporte UTI para encefalite\n• Ribavirina para casos graves (evidência limitada)',
    urg:'Encefalite pós-sarampo: UTI pediátrica urgente'},
  dengue_hemor:{label:'Dengue Hemorrágico (DSS)',cat:'Viral/Crítico',sev:'CRÍTICA',sevC:'#FF2020',parts:['abdomen','chest','skin','heart'],
    sintomas:['Queda abrupta da febre com deterioração clínica (D4-D5) — fase crítica','Hemorragias: petéquias, equimoses, epistaxe, melenas','Derrame pleural e ascite por extravasamento capilar','Hipotensão progressiva evoluindo para choque','Plaquetas < 20.000/µL e hemoconcentração > 20%'],
    descricao:'Reinfecção por segundo serotipo DENV com resposta imune amplificada (ADE). Mortalidade > 20% sem suporte.',
    trat:'• Monitorização horária dos sinais vitais\n• Cristaloides 10 mL/kg bolus repetidos\n• Transfusão plaquetas se < 20.000 + hemorragia\n• UTI obrigatória — sem antiviral eficaz',
    urg:'EMERGÊNCIA — Choque por dengue: UTI imediata'},
/* ── ADICIONAIS FREQUENTES ── */
  infarto:{label:'Enfarte do Miocárdio (EAM-ST)',cat:'Cardiovascular',sev:'CRÍTICA',sevC:'#FF2020',parts:['heart','chest','arm_L'],
    sintomas:['Dor precordial intensa em aperto irradiando para braço esquerdo','Diaforese profusa — suores frios e pele pálida','Dispneia súbita com sensação de morte iminente','Náuseas intensas, vómitos e epigastralgia','Síncope por low output cardíaco'],
    descricao:'Oclusão coronária aguda por trombo com necrose isquémica irreversível do miocárdio. ECG: supradesnivelamento ST.',
    trat:'• AAS 300 mg mastigado AGORA\n• Nitroglicerina sublingual 0,5 mg\n• Morfina 2–4 mg IV se dor intratável\n• PTCA primária < 90 min da chegada',
    urg:'EMERGÊNCIA — Ligue 112 imediatamente'},
  avc:{label:'AVC — Acidente Vascular Cerebral',cat:'Neurológico',sev:'CRÍTICA',sevC:'#FF2020',parts:['head','brain'],
    sintomas:['Hemiplegia súbita de um lado do corpo','Afasia — incapacidade de falar/compreender','Amaurose fugaz ou diplopia súbita','Cefaleia explosiva intensa','Ataxia e queda súbita'],
    descricao:'Interrupção fluxo cerebral por trombo (80%) ou hemorragia (20%). Janela terapêutica tPA: 4,5h.',
    trat:'• FAST: Face · Arms · Speech · Time\n• tPA 0,9 mg/kg IV < 4,5 h\n• Trombectomia mecânica < 24 h\n• Unidade AVC',
    urg:'CRÍTICA — Ambulância IMEDIATA'},
  pneumonia:{label:'Pneumonia Bacteriana',cat:'Respiratório',sev:'ALTA',sevC:'#FF8C00',parts:['chest','lung_L','lung_R'],
    sintomas:['Tosse com expectoração purulenta','Febre 38–40°C com calafrios','Dispneia e dor torácica pleurítica','Crepitações à auscultação','Cianose nas formas graves'],
    descricao:'S. pneumoniae mais frequente. Consolidação lobar com compromisso da hematose. CURB-65 guia internamento.',
    trat:'• Amoxicilina 1g 3×/dia (ambulatório)\n• Azitromicina 500mg (atípicos)\n• Internamento: Ceftriaxona IV\n• O₂ se SpO₂ < 94%',
    urg:'ALTA — CURB-65 ≥ 2: internamento urgente'},
  diabetes:{label:'Diabetes Mellitus Tipo 2',cat:'Endócrino',sev:'CRÓNICA',sevC:'#4DBBFF',parts:['abdomen','pancreas','foot_L','foot_R','eye_L','eye_R','kidney_L','kidney_R'],
    sintomas:['Poliúria — micção excessiva nocturna','Polidipsia — sede incontrolável','Astenia crónica e sonolência','Úlceras plantares (pé diabético)','Neuropatia: formigueiros nos pés'],
    descricao:'Resistência à insulina com hiperglicemia crónica (>126 mg/dL). Prevalência Angola 4,2% — crescente.',
    trat:'• Metformina 850–1000 mg 2×/dia\n• SGLT2i (empagliflozina) + GLP-1 RA\n• HbA1c < 7%\n• Rastreio complicações anual',
    urg:'CRÓNICA — Controlo rigoroso evita complicações'},
  hipertensao:{label:'Hipertensão Arterial',cat:'Cardiovascular',sev:'CRÓNICA',sevC:'#4DBBFF',parts:['heart','brain','kidney_L','kidney_R'],
    sintomas:['Cefaleia occipital matinal','Tonturas e zumbidos','Palpitações irregulares','Epistaxe espontânea','Visão turva transitória'],
    descricao:'PA ≥ 140/90 mmHg cronicamente com lesão em órgãos-alvo. Principal factor de risco cardiovascular em Angola.',
    trat:'• IECA + Diurético tiazídico\n• BCC Amlodipina 5–10 mg\n• Alvo: < 130/80 mmHg\n• Redução sal < 5g/dia',
    urg:'PA > 180/120: urgência hospitalar'},
  covid19:{label:'COVID-19',cat:'Infeccioso/Respiratório',sev:'ALTA',sevC:'#FF8C00',parts:['chest','lung_L','lung_R','head'],
    sintomas:['Anosmia e ageusia súbitas','Febre ≥ 37,8°C com mialgia','Tosse seca irritativa','SpO₂ < 94% (alarme grave)','Fadiga e brain fog prolongados'],
    descricao:'SARS-CoV-2 com pneumonite viral bilateral e resposta inflamatória sistémica.',
    trat:'• Paxlovid < 5 dias sintomas (risco alto)\n• Dexametasona 6 mg/dia se O₂\n• Monitorização SpO₂ diária\n• Ventilação prona se ARDS',
    urg:'SpO₂ < 94%: urgência hospitalar'},
  artrite:{label:'Artrite Reumatoide',cat:'Reumatológico',sev:'CRÓNICA',sevC:'#4DBBFF',parts:['hand_L','hand_R','knee_L','knee_R'],
    sintomas:['Artralgia poliarticular simétrica','Rigidez matinal > 1 hora','Calor, rubor articular','Deformidades articulares progressivas','Anti-CCP e FR positivos'],
    descricao:'Sinovite erosiva autoimune com destruição articular progressiva. Tratamento precoce previne sequelas.',
    trat:'• Metotrexato 15–20 mg/semana (ancora)\n• Anti-TNF: Adalimumab, Etanercept\n• JAK inibidores: Baricitinib\n• Fisioterapia intensiva',
    urg:'CRÓNICA — Reumatologista urgente se artrite activa'},
  hepatite:{label:'Hepatite Viral B / C',cat:'Hepático · Angola endémico',sev:'MODERADA',sevC:'#FFD700',parts:['abdomen','liver','spleen','skin'],
    sintomas:['Icterícia — pele e escleróticas amarelas','Dor no hipocôndrio direito','Colúria (urina cor de chá)','Náuseas e anorexia','Prurido generalizado'],
    descricao:'VHB: Angola hiperendémica (14% portadores). VHC 2%. Risco cirrose e carcinoma hepatocelular.',
    trat:'• VHC: Sofosbuvir+Velpatasvir 12 semanas (cura 95%)\n• VHB: Tenofovir indefinidamente\n• Ecografia semestral + AFP\n• Vacina VHB 3 doses para não infectados',
    urg:'MODERADA — Hepatologia com urgência'},
  irc:{label:'Insuficiência Renal Crónica',cat:'Nefrológico',sev:'ALTA',sevC:'#FF8C00',parts:['kidney_L','kidney_R','abdomen','heart'],
    sintomas:['Edema periférico e facial','Oligúria — redução urinária progressiva','Astenia e anemia urémica','Prurido generalizado refractário','HTA resistente ao tratamento'],
    descricao:'TFG < 60 mL/min > 3 meses. Causas Angola: HTA + DM2 + glomerulonefrite pós-estreptocócica.',
    trat:'• Hemodiálise 3×/semana\n• Transplante renal (gold standard)\n• Dieta hipoproteica 0,8 g/kg\n• Eritropoietina + ferro IV',
    urg:'TFG < 15 ou urémia sintomática: nefrologia urgente'},
  cancro:{label:'Neoplasia Pulmonar',cat:'Oncológico',sev:'CRÍTICA',sevC:'#FF2020',parts:['chest','lung_L','lung_R'],
    sintomas:['Tosse com hemoptise inexplicável','Dor torácica unilateral sorda','Perda de peso > 10% em 6 meses','Rouquidão persistente','Dispneia por derrame pleural'],
    descricao:'Adenocarcinoma (40%), Escamoso (30%). > 80% tabaco. Angola: biomassa também factor de risco.',
    trat:'• Cirurgia: lobectomia se ressecável\n• Pembrolizumab (imunoterapia)\n• SABR em inoperáveis\n• Quimio: Platina + Pemetrexedo',
    urg:'CRÍTICA — Oncologia urgente'},
};

const PATIENTS_DEFAULT = [];
const APPOINTMENTS_DEFAULT = [];
const LAB_RESULTS_DEFAULT = [];
const PRESCRIPTIONS_DEFAULT = [];
const INVOICES_DEFAULT = [];
const BEDS_DEFAULT = [
  {id:'A-01',ward:'Medicina Interna',patient:null,status:'Livre',cor:'#00FF88'},
  {id:'A-02',ward:'Medicina Interna',patient:null,status:'Livre',cor:'#00FF88'},
  {id:'A-03',ward:'Medicina Interna',patient:null,status:'Livre',cor:'#00FF88'},
  {id:'A-04',ward:'Medicina Interna',patient:null,status:'Livre',cor:'#00FF88'},
  {id:'B-01',ward:'Pneumologia',patient:null,status:'Livre',cor:'#00FF88'},
  {id:'B-02',ward:'Pneumologia',patient:null,status:'Livre',cor:'#00FF88'},
  {id:'B-03',ward:'Pneumologia',patient:null,status:'Livre',cor:'#00FF88'},
  {id:'B-04',ward:'Pneumologia',patient:null,status:'Livre',cor:'#00FF88'},
  {id:'C-01',ward:'Cardiologia',patient:null,status:'Livre',cor:'#00FF88'},
  {id:'C-02',ward:'Cardiologia',patient:null,status:'Livre',cor:'#00FF88'},
  {id:'C-03',ward:'Cardiologia',patient:null,status:'Livre',cor:'#00FF88'},
  {id:'C-04',ward:'Cardiologia',patient:null,status:'Livre',cor:'#00FF88'},
];
const STAFF_DEFAULT = [
  {id:1,nome:'',cargo:'Médico',turno:'Manhã',folga:'Sab/Dom',ferias:'—',tel:'',status:'Serviço',initials:'MD',cor:'#00AAFF'},
];
const MESSAGES_DEFAULT = [];
const SURGERIES_DEFAULT = [];
const NOTIFICATIONS_DEFAULT = [];
const STOCK_DEFAULT = [
  { id: 'stk_met', nome: 'Metformina 850mg', sku: 'MET850', qty: 200, minQty: 40, unit: 'cp' },
  { id: 'stk_los', nome: 'Losartan 50mg', sku: 'LOS50', qty: 120, minQty: 30, unit: 'cp' },
  { id: 'stk_aml', nome: 'Amlodipina 10mg', sku: 'AML10', qty: 90, minQty: 20, unit: 'cp' },
  { id: 'stk_atv', nome: 'Atorvastatina 20mg', sku: 'ATV20', qty: 60, minQty: 15, unit: 'cp' },
];
const INTEGRATIONS_DEFAULT = {
  supabaseUrl: '',
  supabaseAnonKey: '',
  supabaseServiceRole: '',
  n8nWebhookIn: '',
  n8nWebhookOut: '',
  whatsappProvider: 'Evolution API',
  autoSync: false,
  syncStatus: 'idle',
  lastSyncAt: null,
  localAIEnabled: true,
  allowAutonomousActions: false,
  localArchiveEnabled: true,
  archiveFrequencyMin: 15,
  archiveFormat: 'json',
  archiveToFolder: false,
  archiveFolderName: '',
  lastArchiveAt: null,
  archiveCount: 0,
  lastArchiveError: '',
};

/* ── CLINIC GLOBAL CONTEXT ── */
const ClinicCtx = React.createContext(null);

function ClinicProvider({children, setTab, threeRef, session}) {
  const auditEnabledRef = useRef(false);
  const patientsRef = useRef(PATIENTS_DEFAULT);

  const [patients,    setPatientsRaw]    = useState(PATIENTS_DEFAULT);
  const [appointments,setAppointmentsRaw]= useState(APPOINTMENTS_DEFAULT);
  const [labResults,  setLabResultsRaw]  = useState(LAB_RESULTS_DEFAULT);
  const [prescriptions,setPrescriptionsRaw]=useState(PRESCRIPTIONS_DEFAULT);
  const [invoices,    setInvoicesRaw]    = useState(INVOICES_DEFAULT);
  const [stockItems,  setStockItemsRaw]  = useState(STOCK_DEFAULT);
  const [beds,        setBeds]        = useState(BEDS_DEFAULT);
  const [staff,       setStaff]       = useState(STAFF_DEFAULT);
  const [messages,    setMessages]    = useState(MESSAGES_DEFAULT);
  const [surgeries,   setSurgeries]   = useState(SURGERIES_DEFAULT);
  const [notifications,setNotificationsRaw]=useState(NOTIFICATIONS_DEFAULT);
  const [integrations,setIntegrations]=useState(INTEGRATIONS_DEFAULT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { patientsRef.current = patients; }, [patients]);

  useEffect(() => {
    if (session?.nome || session?.email) {
      setCurrentUser({ user: session.nome || session.email, id: session.userId, role: session.role });
    }
  }, [session]);

  const addNotification = useCallback((type, msg) => {
    setNotificationsRaw((prev) => [
      { id: Date.now(), type, msg, time: new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }), read: false },
      ...prev.slice(0, 19),
    ]);
  }, []);

  const emitValidation = useCallback((errors) => {
    window.dispatchEvent(new CustomEvent('fg_validation_error', { detail: { errors } }));
  }, []);

  useEffect(() => {
    const h = (e) => {
      const err = e.detail?.errors;
      if (Array.isArray(err)) addNotification('alerta', err.join('; '));
    };
    window.addEventListener('fg_validation_error', h);
    return () => window.removeEventListener('fg_validation_error', h);
  }, [addNotification]);

  const setPatients = useCallback((fn, opts) => {
    setPatientsRaw((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      if (opts?.skipGuard) return next;
      const v = validatePatientList(next);
      if (!v.ok) {
        queueMicrotask(() => emitValidation(v.errors));
        return prev;
      }
      if (auditEnabledRef.current && !opts?.skipAudit) auditPatientsDiff(prev, v.normalized);
      return v.normalized;
    });
  }, [emitValidation]);

  const setAppointments = useCallback((fn, opts) => {
    setAppointmentsRaw((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      if (opts?.skipGuard) return next;
      const v = validateAppointmentList(next, patientsRef.current);
      if (!v.ok) {
        queueMicrotask(() => emitValidation(v.errors));
        return prev;
      }
      if (auditEnabledRef.current && !opts?.skipAudit) auditAppointmentsDiff(prev, v.normalized);
      return v.normalized;
    });
  }, [emitValidation]);

  const setPrescriptions = useCallback((fn, opts) => {
    setPrescriptionsRaw((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      if (opts?.skipGuard) return next;
      const v = validatePrescriptionList(next, patientsRef.current);
      if (!v.ok) {
        queueMicrotask(() => emitValidation(v.errors));
        return prev;
      }
      if (auditEnabledRef.current && !opts?.skipAudit) auditPrescriptionsDiff(prev, v.normalized);
      return v.normalized;
    });
  }, [emitValidation]);

  const setLabResults = useCallback((fn, opts) => {
    setLabResultsRaw((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      if (opts?.skipGuard) return next;
      const v = validateLabList(next, patientsRef.current);
      if (!v.ok) {
        queueMicrotask(() => emitValidation(v.errors));
        return prev;
      }
      if (auditEnabledRef.current && !opts?.skipAudit) auditLabDiff(prev, v.normalized);
      return v.normalized;
    });
  }, [emitValidation]);

  const setInvoices = useCallback((fn, opts) => {
    setInvoicesRaw((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      if (opts?.skipGuard) return next;
      const v = validateInvoiceList(next, patientsRef.current);
      if (!v.ok) {
        queueMicrotask(() => emitValidation(v.errors));
        return prev;
      }
      if (auditEnabledRef.current && !opts?.skipAudit) auditInvoicesDiff(prev, v.normalized);
      return v.normalized;
    });
  }, [emitValidation]);

  const setStock = useCallback((fn, opts) => {
    setStockItemsRaw((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      if (opts?.skipGuard) return next;
      const v = validateStockList(next);
      if (!v.ok) {
        queueMicrotask(() => emitValidation(v.errors));
        return prev;
      }
      if (auditEnabledRef.current && !opts?.skipAudit) auditStockDiff(prev, v.normalized);
      return v.normalized;
    });
  }, [emitValidation]);

  /* Load from storage once on mount */
  useEffect(()=>{
    const load = async () => {
      auditEnabledRef.current = false;
      try {
        const keys = ['patients','appointments','labResults','prescriptions',
                      'invoices','stock','beds','staff','messages','surgeries','notifications','integrations'];
        const setters = {patients:setPatientsRaw,appointments:setAppointmentsRaw,
          labResults:setLabResultsRaw,prescriptions:setPrescriptionsRaw,
          invoices:setInvoicesRaw,stock:setStockItemsRaw,beds:setBeds,staff:setStaff,
          messages:setMessages,surgeries:setSurgeries,notifications:setNotificationsRaw,
          integrations:setIntegrations};
        for(const k of keys){
          try {
            const r = await window.storage.get('clinic_'+k);
            if(r && r.value){
              const parsed = JSON.parse(r.value);
              if(k==='integrations') setters[k]({...INTEGRATIONS_DEFAULT,...parsed,allowAutonomousActions:false});
              else setters[k](parsed);
            }
          } catch(e){}
        }
      } catch(e){}
      auditEnabledRef.current = true;
      setLoaded(true);
    };
    load();
  },[]);

  /* Save to storage whenever data changes (only after initial load) */
  useDebouncedEffect(()=>{ if(loaded) window.storage.set('clinic_patients', JSON.stringify(patients)); },[patients,loaded], 500);
  useDebouncedEffect(()=>{ if(loaded) window.storage.set('clinic_appointments', JSON.stringify(appointments)); },[appointments,loaded], 500);
  useDebouncedEffect(()=>{ if(loaded) window.storage.set('clinic_labResults', JSON.stringify(labResults)); },[labResults,loaded], 500);
  useDebouncedEffect(()=>{ if(loaded) window.storage.set('clinic_prescriptions', JSON.stringify(prescriptions)); },[prescriptions,loaded], 500);
  useDebouncedEffect(()=>{ if(loaded) window.storage.set('clinic_invoices', JSON.stringify(invoices)); },[invoices,loaded], 500);
  useDebouncedEffect(()=>{ if(loaded) window.storage.set('clinic_stock', JSON.stringify(stockItems)); },[stockItems,loaded], 500);
  useDebouncedEffect(()=>{ if(loaded) window.storage.set('clinic_beds', JSON.stringify(beds)); },[beds,loaded], 500);
  useDebouncedEffect(()=>{ if(loaded) window.storage.set('clinic_staff', JSON.stringify(staff)); },[staff,loaded], 500);
  useDebouncedEffect(()=>{ if(loaded) window.storage.set('clinic_messages', JSON.stringify(messages)); },[messages,loaded], 500);
  useDebouncedEffect(()=>{ if(loaded) window.storage.set('clinic_surgeries', JSON.stringify(surgeries)); },[surgeries,loaded], 500);
  useDebouncedEffect(()=>{ if(loaded) window.storage.set('clinic_notifications', JSON.stringify(notifications)); },[notifications,loaded], 500);
  useDebouncedEffect(()=>{ if(loaded) window.storage.set('clinic_integrations', JSON.stringify(integrations)); },[integrations,loaded], 500);

  const lastArchiveTsRef = useRef(0);
  const lastSupaSyncTsRef = useRef(0);

  useEffect(()=>{
    if(!integrations?.lastArchiveAt) return;
    const t = Date.parse(integrations.lastArchiveAt);
    if(!Number.isNaN(t) && t>lastArchiveTsRef.current) lastArchiveTsRef.current=t;
  },[integrations.lastArchiveAt]);

  useEffect(()=>{
    if(!loaded) return;

    const bundle = buildClinicDataBundle({
      patients,appointments,labResults,prescriptions,invoices,
      beds,staff,messages,surgeries,notifications,stock:stockItems,
    },'autosnapshot');

    window.storage.set(LOCAL_SNAPSHOT_KEY, JSON.stringify(bundle));

    if(!integrations.localArchiveEnabled) return;

    const freqMin = Math.max(1, Number(integrations.archiveFrequencyMin)||15);
    const freqMs = freqMin*60*1000;
    const now = Date.now();

    if(now-lastArchiveTsRef.current<freqMs) return;
    lastArchiveTsRef.current = now;

    (async()=>{
      const res = await persistArchiveBundle(bundle,{
        writeToFolder:!!integrations.archiveToFolder,
        format:integrations.archiveFormat||'json',
      });
      setIntegrations(prev=>({
        ...prev,
        lastArchiveAt:bundle.meta.generatedAt,
        archiveCount:Math.max((prev.archiveCount||0)+1,res.historyCount||0),
        lastArchiveError:res.folderError||'',
      }));
    })();
  },[
    loaded,
    patients,appointments,labResults,prescriptions,invoices,
    beds,staff,messages,surgeries,notifications,stockItems,
    integrations.localArchiveEnabled,
    integrations.archiveFrequencyMin,
    integrations.archiveFormat,
    integrations.archiveToFolder,
  ]);

  useEffect(()=>{
    if(!loaded || !integrations.autoSync) return;
    if(!integrations.supabaseUrl || !integrations.supabaseAnonKey) return;

    const now=Date.now();
    const everyMs=3*60*1000;
    if(now-lastSupaSyncTsRef.current<everyMs) return;
    lastSupaSyncTsRef.current=now;

    const payload={
      patients,appointments,labResults,prescriptions,invoices,
      beds,staff,messages,surgeries,notifications,stock:stockItems,
    };

    (async()=>{
      const result = await syncClinicToSupabase({
        supabaseUrl:integrations.supabaseUrl,
        supabaseAnonKey:integrations.supabaseAnonKey,
        tableMap:integrations.tableMap||{},
      },payload);

      setIntegrations(prev=>({
        ...prev,
        syncStatus:result.ok?'ready':'error',
        lastSyncAt:new Date().toISOString(),
      }));
    })();
  },[
    loaded,
    patients,appointments,labResults,prescriptions,invoices,
    beds,staff,messages,surgeries,notifications,stockItems,
    integrations.autoSync,
    integrations.supabaseUrl,
    integrations.supabaseAnonKey,
  ]);

  /* Navigate to 3D hologram and highlight disease */
  const viewPatient3D = (patient) => {
    if(!patient || !patient.diagKey) return;
    const d = DISEASES[patient.diagKey];
    if(!d) return;
    setTab('holografia');
    setTimeout(()=>{
      threeRef.current?.highlight(d.parts, d.sevC);
    }, 500);
  };

  /* Only render children once data is loaded */
  if(!loaded) return (
    <div style={{width:'100%',height:'100vh',background:G.bg,color:G.text,
      display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&family=Cinzel:wght@400;600&family=Rajdhani:wght@400;600&display=swap');`}</style>
      <div style={{fontFamily:'Orbitron',fontSize:13,color:G.gold,letterSpacing:4}}>◈ FUMUGOLD</div>
      <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,letterSpacing:2,marginTop:-8}}>CARREGANDO DADOS DO SISTEMA...</div>
      <div style={{width:220,height:2,background:`${G.gold}15`,borderRadius:2,overflow:'hidden',marginTop:8}}>
        <div style={{height:'100%',background:G.gold,borderRadius:2,
          animation:'scanLine 1.2s linear infinite',width:'45%'}}/>
      </div>
    </div>
  );

  return (
    <ClinicCtx.Provider value={{
      patients,setPatients,
      appointments,setAppointments,
      labResults,setLabResults,
      prescriptions,setPrescriptions,
      invoices,setInvoices,
      stockItems,setStock,
      beds,setBeds,
      staff,setStaff,
      messages,setMessages,
      surgeries,setSurgeries,
      notifications,setNotifications:setNotificationsRaw,
      integrations,setIntegrations,
      addNotification,
      viewPatient3D,
    }}>
      {children}
    </ClinicCtx.Provider>
  );
}
const useClinic = () => React.useContext(ClinicCtx);

/* ═══════════════════════════════════════════════════════════
   UTILITY COMPONENTS
═══════════════════════════════════════════════════════════ */
const Corners = ({sz=14,col=G.gold,op=0.7}) => (
  <>
    {[[0,0],[1,0],[0,1],[1,1]].map(([r,b],i)=>(
      <div key={i} style={{position:'absolute',
        ...(r?{right:-1}:{left:-1}), ...(b?{bottom:-1}:{top:-1}),
        width:sz, height:sz, borderStyle:'solid', borderColor:col,
        borderWidth:0, ...(r?{borderRightWidth:1.5}:{borderLeftWidth:1.5}),
        ...(b?{borderBottomWidth:1.5}:{borderTopWidth:1.5}),
        opacity:op, pointerEvents:'none'}} />
    ))}
  </>
);

const Panel = ({children,style={},glow=false,noPad=false}) => (
  <div className="panel-hover" style={{
    background:`linear-gradient(135deg,rgba(10,7,1,0.98),rgba(6,4,0,0.97))`,
    border:`1px solid ${G.border}`,borderRadius:3,
    position:'relative',padding:noPad?0:undefined,
    boxShadow:glow?`0 0 30px rgba(212,175,55,0.1),0 4px 24px rgba(0,0,0,0.5)`:`0 4px 20px rgba(0,0,0,0.4)`,
    transition:'border-color 0.25s,box-shadow 0.25s',...style}}>
    <Corners/>
    {children}
  </div>
);

const Badge = ({text,col=G.gold,small=false,pulse=false}) => (
  <span style={{fontFamily:'Orbitron',
    fontSize:small?6:7,padding:small?'2px 5px':'3px 7px',
    background:`${col}14`,border:`1px solid ${col}44`,
    borderRadius:2,color:col,letterSpacing:1,whiteSpace:'nowrap',
    display:'inline-flex',alignItems:'center',gap:4,
    boxShadow:`0 0 8px ${col}18`}}>
    {pulse&&<span style={{width:4,height:4,borderRadius:'50%',background:col,
      boxShadow:`0 0 4px ${col}`,display:'inline-block',
      animation:'blink 1.5s ease-in-out infinite'}}/>}
    {text}
  </span>
);

const Dot = ({col,pulse=false}) => (
  <div style={{width:7,height:7,borderRadius:'50%',background:col,flexShrink:0,
    boxShadow:`0 0 6px ${col}`,
    animation:pulse?'blink 2s ease-in-out infinite':undefined}}/>
);

const VitalWave = ({color=G.gold,amp=1,h=50}) => {
  const pts = useMemo(()=>{
    const arr=[];
    for(let x=0;x<=220;x+=5){
      const y = h/2 + (
        (x>30&&x<60)?-18*amp*Math.sin((x-30)/30*Math.PI):
        (x>90&&x<110)?14*amp*Math.sin((x-90)/20*Math.PI):
        (x>130&&x<170)?-10*amp*Math.sin((x-130)/40*Math.PI):0
      );
      arr.push(`${x},${y}`);
    }
    return arr.join(' ');
  },[amp,h]);
  return(
    <svg width="100%" height={h} viewBox={`0 0 220 ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`wg${amp}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0"/>
          <stop offset="30%" stopColor={color} stopOpacity="1"/>
          <stop offset="70%" stopColor={color} stopOpacity="1"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
        <filter id="glow2"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      <polyline points={pts} fill="none" stroke={`url(#wg${amp})`} strokeWidth="1.5" filter="url(#glow2)"/>
      <circle r="4" fill={color} opacity="0.9" filter="url(#glow2)">
        <animateMotion dur="3s" repeatCount="indefinite"
          path={`M0,${h/2} ${pts.split(' ').slice(1).map(p=>`L${p}`).join(' ')}`}/>
      </circle>
    </svg>
  );
};

const Ring = ({val,max,col,size=56,label,unit=''}) => {
  const r=20,c=Math.PI*2*r,pct=val/max,dash=pct*c;
  return(
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4}}>
      <svg width={size} height={size} viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={r} fill="none" stroke={`${col}20`} strokeWidth="3"/>
        <circle cx="28" cy="28" r={r} fill="none" stroke={col} strokeWidth="3"
          strokeDasharray={`${dash} ${c-dash}`} strokeDashoffset={c/4}
          strokeLinecap="round" style={{filter:`drop-shadow(0 0 4px ${col})`}}/>
        <text x="28" y="31" textAnchor="middle" fill={col} fontSize="9" fontFamily="Orbitron" fontWeight="700">
          {Math.round(pct*100)}%
        </text>
      </svg>
      {label&&<span style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim,textAlign:'center'}}>{label}</span>}
    </div>
  );
};

const BarChart = ({data,h=60}) => (
  <div style={{display:'flex',alignItems:'flex-end',gap:5,height:h,paddingTop:4}}>
    {data.map(({label,val,col},i)=>{
      const mx=Math.max(...data.map(d=>d.val));
      return(
        <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
          <div style={{fontFamily:'Orbitron',fontSize:7,color:col}}>{val}</div>
          <div style={{width:'100%',height:`${(val/mx)*(h*0.75)}px`,
            background:`${col}15`,border:`1px solid ${col}44`,borderRadius:1,position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',bottom:0,left:0,right:0,
              height:`${Math.min(val/mx,1)*100}%`,
              background:`linear-gradient(0deg,${col}88,${col}22)`,animation:`fadeUp 0.5s ease`}}/>
          </div>
          <div style={{fontFamily:'Rajdhani',fontSize:8,color:G.dim,textAlign:'center',lineHeight:1.1}}>{label}</div>
        </div>
      );
    })}
  </div>
);

const Modal = ({open,onClose,title,children,width=500}) => {
  if(!open)return null;
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(2,1,0,0.88)',zIndex:1000,
      display:'flex',alignItems:'center',justifyContent:'center',animation:'fadeIn 0.2s ease'}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <Panel style={{width,maxWidth:'95vw',maxHeight:'90vh',overflow:'auto',animation:'fadeUp 0.25s ease'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
          padding:'14px 18px',borderBottom:`1px solid ${G.border}`}}>
          <div style={{fontFamily:'Cinzel',fontSize:12,color:G.gold,letterSpacing:2}}>{title}</div>
          <button onClick={onClose} style={{background:'none',color:G.dim,fontSize:16,
            padding:'0 4px',lineHeight:1,transition:'color 0.2s'}}
            onMouseEnter={e=>e.target.style.color=G.red}
            onMouseLeave={e=>e.target.style.color=G.dim}>✕</button>
        </div>
        <div style={{padding:18}}>{children}</div>
      </Panel>
    </div>
  );
};

const FormRow = ({label,children}) => (
  <div style={{display:'grid',gridTemplateColumns:'120px 1fr',alignItems:'center',gap:10,marginBottom:10}}>
    <label style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,textAlign:'right'}}>{label}</label>
    {children}
  </div>
);

const GInput = ({value,onChange,placeholder,type='text',style={}}) => (
  <input type={type} value={value} onChange={onChange} placeholder={placeholder}
    style={{background:'rgba(212,175,55,0.05)',border:`1px solid ${G.border}`,
      borderRadius:2,padding:'7px 10px',color:G.text,fontFamily:'Rajdhani',fontSize:12,
      width:'100%',...style}}/>
);

const GSelect = ({value,onChange,options}) => (
  <select value={value} onChange={onChange}
    style={{background:'#080500',border:`1px solid ${G.border}`,borderRadius:2,
      padding:'7px 10px',color:G.text,fontFamily:'Rajdhani',fontSize:12,width:'100%'}}>
    {options.map(o=>{
      const val=typeof o==='object'?o.v:o;
      const lbl=typeof o==='object'?o.l:o;
      return <option key={val} value={val}>{lbl}</option>;
    })}
  </select>
);

const StatCard = ({label,val,sub,ic,col,i=0}) => {
  const [visible,setVisible]=useState(false);
  useEffect(()=>{const t=setTimeout(()=>setVisible(true),(i||0)*80+100);return()=>clearTimeout(t);},[]);
  return(
    <div className="panel-hover" style={{flex:1,padding:'14px 16px',
      border:`1px solid ${G.border}`,borderRadius:3,
      background:`linear-gradient(135deg,rgba(10,7,1,0.98),rgba(6,4,0,0.98))`,
      position:'relative',overflow:'hidden',
      opacity:visible?1:0,transform:visible?'translateY(0)':'translateY(14px)',
      transition:`opacity 0.4s ${(i||0)*0.07}s ease, transform 0.4s ${(i||0)*0.07}s ease`}}>
      {/* Top accent bar */}
      <div style={{position:'absolute',top:0,left:0,right:0,height:2,
        background:`linear-gradient(90deg,transparent,${col},transparent)`,
        opacity:0.7,animation:'scanPulse 3s ease-in-out infinite'}}/>
      {/* Corner glow */}
      <div style={{position:'absolute',bottom:-20,right:-20,width:60,height:60,
        borderRadius:'50%',background:col,opacity:0.04,filter:'blur(20px)'}}/>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div style={{flex:1}}>
          <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,letterSpacing:2.5,
            textTransform:'uppercase',marginBottom:6}}>{label}</div>
          <div style={{fontFamily:'Orbitron',fontSize:24,fontWeight:900,color:col,lineHeight:1,
            textShadow:`0 0 20px ${col}66`,
            animation:visible?'countReveal 0.5s ease':'none'}}>{val}</div>
          {sub&&<div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dimL,marginTop:5,lineHeight:1.3}}>{sub}</div>}
        </div>
        <div style={{width:36,height:36,borderRadius:'50%',
          background:`${col}12`,border:`1px solid ${col}33`,
          display:'flex',alignItems:'center',justifyContent:'center',
          fontSize:16,flexShrink:0,
          boxShadow:`0 0 12px ${col}22`}}>{ic}</div>
      </div>
    </div>
  );
};

const SectionHeader = ({title,action,actionLabel}) => (
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
    fontFamily:'Cinzel',fontSize:10,color:G.gold,letterSpacing:2.5,
    marginBottom:12,paddingBottom:8,position:'relative'}}>
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <div style={{width:6,height:6,borderRadius:1,background:G.gold,
        boxShadow:`0 0 8px ${G.gold}`,transform:'rotate(45deg)'}}/>
      <span style={{textShadow:`0 0 12px ${G.gold}44`}}>{title}</span>
    </div>
    {action&&<button onClick={action}
      style={{fontFamily:'Orbitron',fontSize:7,padding:'5px 12px',
        background:`linear-gradient(135deg,${G.gold}18,${G.gold}08)`,
        border:`1px solid ${G.gold}55`,color:G.gold,borderRadius:2,letterSpacing:1,
        transition:'all 0.2s'}}
      onMouseEnter={e=>{e.target.style.background=`linear-gradient(135deg,${G.gold}28,${G.gold}14)`;e.target.style.boxShadow=`0 0 12px ${G.gold}33`;}}
      onMouseLeave={e=>{e.target.style.background=`linear-gradient(135deg,${G.gold}18,${G.gold}08)`;e.target.style.boxShadow='none';}}>
      + {actionLabel}
    </button>}
    <div style={{position:'absolute',bottom:0,left:0,right:0,height:1,
      background:`linear-gradient(90deg,${G.gold}66,${G.gold}22,transparent)`}}/>
  </div>
);

/* ═══════════════════════════════════════════════════════════
   FILE UPLOAD COMPONENT
═══════════════════════════════════════════════════════════ */
function FileUploader({files, onAdd, onRemove}) {
  const [drag, setDrag] = useState(false);
  const inRef = useRef();

  const handleFiles = (fileList) => {
    Array.from(fileList).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        onAdd({
          id: Date.now() + Math.random(),
          name: file.name,
          type: file.type,
          size: file.size,
          data: reader.result,
          date: new Date().toLocaleDateString('pt-PT'),
          category: file.type.startsWith('image/') ? 'Imagem' :
                    file.type === 'application/pdf' ? 'PDF' : 'Documento',
        });
      };
      reader.readAsDataURL(file);
    });
  };

  const fmtSize = b => b > 1048576 ? `${(b/1048576).toFixed(1)} MB` : `${(b/1024).toFixed(0)} KB`;

  return(
    <div>
      {/* Drop zone */}
      <div onDragOver={e=>{e.preventDefault();setDrag(true)}}
        onDragLeave={()=>setDrag(false)}
        onDrop={e=>{e.preventDefault();setDrag(false);handleFiles(e.dataTransfer.files)}}
        onClick={()=>inRef.current.click()}
        style={{border:`2px dashed ${drag?G.gold:G.border}`,borderRadius:3,
          padding:'24px 16px',textAlign:'center',cursor:'pointer',
          background:drag?`${G.gold}07`:'rgba(212,175,55,0.02)',
          transition:'all 0.2s',marginBottom:12}}>
        <input ref={inRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
          style={{display:'none'}} onChange={e=>handleFiles(e.target.files)}/>
        <div style={{fontSize:24,marginBottom:8}}>📎</div>
        <div style={{fontFamily:'Cinzel',fontSize:10,color:drag?G.gold:G.dim,letterSpacing:2}}>
          {drag?'SOLTAR AQUI':'ARRASTAR FICHEIROS'}
        </div>
        <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,marginTop:4}}>
          Imagens, PDFs, Documentos · Clique ou arraste
        </div>
      </div>

      {/* File list */}
      {files.length===0?(
        <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.dim,textAlign:'center',padding:16}}>
          Nenhum ficheiro associado
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {files.map(f=>(
            <div key={f.id} style={{display:'flex',gap:10,alignItems:'center',
              background:'rgba(212,175,55,0.04)',border:`1px solid ${G.border}`,
              borderRadius:2,padding:'8px 10px'}}>
              {/* Preview or icon */}
              {f.type.startsWith('image/')?(
                <img src={f.data} alt={f.name}
                  style={{width:40,height:40,objectFit:'cover',borderRadius:2,
                    border:`1px solid ${G.border}`,flexShrink:0}}/>
              ):(
                <div style={{width:40,height:40,background:'rgba(212,175,55,0.08)',
                  border:`1px solid ${G.border}`,borderRadius:2,flexShrink:0,
                  display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>
                  {f.category==='PDF'?'📄':f.category==='Documento'?'📝':'📊'}
                </div>
              )}
              <div style={{flex:1,overflow:'hidden'}}>
                <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,
                  whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{f.name}</div>
                <div style={{display:'flex',gap:8,marginTop:2}}>
                  <Badge text={f.category} col={G.gold} small/>
                  <span style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>{fmtSize(f.size)}</span>
                  <span style={{fontFamily:'Rajdhani',fontSize:9,color:G.dim}}>{f.date}</span>
                </div>
              </div>
              <div style={{display:'flex',gap:6}}>
                {f.type.startsWith('image/')&&(
                  <a href={f.data} download={f.name}
                    style={{fontSize:12,opacity:0.6,textDecoration:'none',cursor:'pointer'}}
                    title="Ver/Download">👁</a>
                )}
                {f.type==='application/pdf'&&(
                  <a href={f.data} target="_blank" rel="noreferrer"
                    style={{fontSize:12,opacity:0.6,textDecoration:'none'}}
                    title="Abrir PDF">🔗</a>
                )}
                <button onClick={()=>onRemove(f.id)}
                  style={{background:'none',color:G.dim,fontSize:12,padding:'0 2px',
                    transition:'color 0.2s'}}
                  onMouseEnter={e=>e.target.style.color=G.red}
                  onMouseLeave={e=>e.target.style.color=G.dim}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD
═══════════════════════════════════════════════════════════ */
function Dashboard({setTab}) {
  const {
    patients,
    appointments,
    labResults,
    notifications,
    beds,
    invoices,
    prescriptions,
    messages,
    staff,
    integrations,
    addNotification,
  } = useClinic();

  const [liveTime,setLiveTime] = useState(new Date());
  const [period,setPeriod] = useState('7d');
  const [riskFilter,setRiskFilter] = useState('all');

  useEffect(()=>{
    const t = setInterval(()=>setLiveTime(new Date()), 1000);
    return ()=>clearInterval(t);
  },[]);

  const parseDate = useCallback((value)=>{
    if(!value) return null;
    if(value instanceof Date) return value;
    const raw = String(value).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00`);
    if(/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
      const [d,m,y] = raw.split('/');
      return new Date(`${y}-${m}-${d}T00:00:00`);
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  },[]);

  const rangeDays = period==='today' ? 1 : period==='30d' ? 30 : 7;
  const rangeStart = useMemo(()=>{
    const d = new Date(liveTime);
    d.setHours(0,0,0,0);
    d.setDate(d.getDate() - (rangeDays - 1));
    return d;
  },[liveTime,rangeDays]);

  const inRange = useCallback((value)=>{
    const d = parseDate(value);
    if(!d) return false;
    return d >= rangeStart && d <= liveTime;
  },[liveTime,parseDate,rangeStart]);

  const todayISO = useMemo(()=>{
    const y = liveTime.getFullYear();
    const m = String(liveTime.getMonth()+1).padStart(2,'0');
    const d = String(liveTime.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  },[liveTime]);

  const filteredAppointments = useMemo(
    ()=>appointments.filter(a=>inRange(a.date || todayISO)),
    [appointments,inRange,todayISO]
  );

  const activePatients = useMemo(
    ()=>patients.filter(p=>p.tipo==='Paciente' && p.status!=='Alta Completa'),
    [patients]
  );

  const triageQueue = useMemo(()=>(
    filteredAppointments
      .filter(a=>['Aguarda','Confirmada','Em curso'].includes(a.status))
      .sort((a,b)=>String(a.time||'99:99').localeCompare(String(b.time||'99:99')))
  ),[filteredAppointments]);

  const criticalLabs = useMemo(
    ()=>labResults.filter(r=>r.alert && inRange(r.date || todayISO)),
    [labResults,inRange,todayISO]
  );

  const unreadAlerts = useMemo(
    ()=>notifications.filter(n=>!n.read),
    [notifications]
  );

  const bedsOccupied = useMemo(
    ()=>beds.filter(b=>b.status==='Ocupada').length,
    [beds]
  );

  const invoiceTotals = useMemo(()=>{
    const total = invoices.reduce((sum,inv)=>sum+(inv.total||0),0);
    const paid = invoices.reduce((sum,inv)=>sum+(inv.pago||0),0);
    const pending = invoices.reduce((sum,inv)=>sum+(inv.pendente||0),0);
    return {total,paid,pending};
  },[invoices]);

  const collectionRate = invoiceTotals.total>0
    ? Math.round((invoiceTotals.paid / invoiceTotals.total) * 100)
    : 0;

  const statusColors = {
    'Em curso': G.green,
    Confirmada: G.gold,
    Aguarda: G.amber,
    Faltou: G.red,
  };

  const riskPatients = useMemo(()=>{
    const labByPatient = new Set(criticalLabs.map(r=>r.patient));
    const evalRisk = (p)=>{
      let score = 0;
      if(Number(p.fc)>120 || (Number(p.fc)>0 && Number(p.fc)<50)) score += 3;
      if(Number(p.spo2)>0 && Number(p.spo2)<93) score += 4;
      if(String(p.temp||'').trim() && Number(p.temp)>=38.2) score += 2;
      if(String(p.pa||'').includes('/')) {
        const [sys,dia] = String(p.pa).split('/').map(Number);
        if((sys && sys>=170) || (dia && dia>=105)) score += 3;
      }
      if(labByPatient.has(p.nome)) score += 3;
      if(p.status==='Atenção' || p.status==='Em Tratamento') score += 2;
      return score;
    };

    return activePatients
      .map(p=>({
        ...p,
        risk: evalRisk(p),
      }))
      .filter(p=>p.risk>0)
      .sort((a,b)=>b.risk-a.risk)
      .filter(p=>riskFilter==='all' ? true : riskFilter==='high' ? p.risk>=7 : p.risk<7)
      .slice(0,8);
  },[activePatients,criticalLabs,riskFilter]);

  const avgQueuePressure = triageQueue.length * 12 + criticalLabs.length * 8;
  const predictedNoShow = Math.round((filteredAppointments.filter(a=>a.status==='Confirmada').length * 0.12) * 10) / 10;
  const occupancyRate = beds.length>0 ? Math.round((bedsOccupied / beds.length) * 100) : 0;

  const detectChannel = useCallback((m)=>{
    const text = `${m.from||''} ${m.msg||''} ${m.channel||''}`.toLowerCase();
    if(text.includes('whatsapp') || text.includes('+244') || text.includes('+55') || m.channel==='whatsapp') return 'WhatsApp';
    if(m.type==='lab' || text.includes('lab')) return 'Laboratorio';
    if(m.type==='agenda' || text.includes('consulta')) return 'Agenda';
    return 'Interno';
  },[]);

  const channelStats = useMemo(()=>{
    const base = {WhatsApp:0,Interno:0,Agenda:0,Laboratorio:0};
    messages.forEach(m=>{ base[detectChannel(m)] = (base[detectChannel(m)]||0)+1; });
    return base;
  },[detectChannel,messages]);

  const omniInbox = useMemo(()=>{
    const raw = messages
      .map(m=>({
        id: m.id || Date.now()+Math.random(),
        from: m.from || 'Sistema',
        msg: m.msg || 'Sem conteúdo',
        time: m.time || '--:--',
        channel: detectChannel(m),
        unread: !!m.unread,
        priority: m.type==='alerta' ? 'alta' : m.type==='lab' ? 'media' : 'normal',
      }))
      .sort((a,b)=>String(b.time).localeCompare(String(a.time)));

    if(raw.length>0) return raw.slice(0,8);

    return [
      {id:'seed1',from:'WhatsApp Bot',msg:'Sem mensagens novas no momento.',time:liveTime.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}),channel:'WhatsApp',unread:false,priority:'normal'},
      {id:'seed2',from:'Sistema',msg:'Integração n8n pronta para recebimento.',time:liveTime.toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}),channel:'Interno',unread:false,priority:'normal'},
    ];
  },[detectChannel,liveTime,messages]);

  const integrationReady = Boolean(
    integrations?.supabaseUrl && integrations?.supabaseAnonKey && integrations?.n8nWebhookIn
  );

  const goTab = (tabName, note) => {
    if(note) addNotification('info', note);
    setTab(tabName);
  };

  const periodBtn = (id,label)=>(
    <button key={id} onClick={()=>setPeriod(id)}
      style={{
        fontFamily:'Orbitron',
        fontSize:7,
        padding:'4px 10px',
        borderRadius:2,
        background:period===id?`${G.gold}1c`:'transparent',
        border:`1px solid ${period===id?G.gold:G.border}`,
        color:period===id?G.gold:G.dim,
        letterSpacing:1,
      }}>
      {label}
    </button>
  );

  return(
    <div style={{padding:12,display:'flex',flexDirection:'column',gap:10,height:'100%',overflowY:'auto'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',padding:'8px 12px',
        background:'rgba(6,4,0,0.88)',border:`1px solid ${G.border}`,borderRadius:2}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <Dot col={G.green} pulse/>
          <span style={{fontFamily:'Orbitron',fontSize:8,color:G.green,letterSpacing:1.5}}>COMMAND CENTER ONLINE</span>
        </div>
        <div style={{display:'flex',gap:6,marginLeft:6}}>{['today','7d','30d'].map(id=>periodBtn(id,id==='today'?'HOJE':id.toUpperCase()))}</div>
        <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <Badge text={integrationReady?'SUPABASE + N8N OK':'INTEGRACAO PENDENTE'} col={integrationReady?G.green:G.amber} pulse={!integrationReady}/>
          <span style={{fontFamily:'Orbitron',fontSize:8,color:G.goldL,letterSpacing:1.2}}>{liveTime.toLocaleTimeString('pt-PT')}</span>
        </div>
      </div>

      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <StatCard label="Pacientes Ativos" val={activePatients.length} sub={`${patients.filter(p=>p.tipo==='Paciente').length} total`} ic="PS" col={G.gold} i={0}/>
        <StatCard label="Fila Clinica" val={triageQueue.length} sub={`${avgQueuePressure} min de pressao`} ic="Q" col={G.teal} i={1}/>
        <StatCard label="Risco Elevado" val={riskPatients.filter(p=>p.risk>=7).length} sub={`${criticalLabs.length} alertas de lab`} ic="!" col={G.red} i={2}/>
        <StatCard label="Ocupacao Camas" val={`${bedsOccupied}/${beds.length}`} sub={`${occupancyRate}% ocupacao`} ic="BED" col={G.purple} i={3}/>
        <StatCard label="Recebimento" val={`${collectionRate}%`} sub={`${(invoiceTotals.paid||0).toLocaleString('pt-AO')} AOA`} ic="$" col={G.green} i={4}/>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:10,alignItems:'start'}}>
        <Panel style={{padding:14,minHeight:360}}>
          <SectionHeader title="Fluxo Assistencial" action={()=>goTab('agendamento','Abrindo agenda operacional.')} actionLabel="ABRIR AGENDA"/>
          {triageQueue.length===0?(
            <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.dim,padding:'14px 0',textAlign:'center'}}>Sem fila clinica no periodo selecionado.</div>
          ):(
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {triageQueue.slice(0,8).map((a,i)=>(
                <div key={`${a.patient}-${i}`} style={{display:'grid',gridTemplateColumns:'52px 1fr auto',gap:10,alignItems:'center',
                  padding:'8px 0',borderBottom:`1px solid ${G.border}15`}}>
                  <div style={{fontFamily:'Orbitron',fontSize:11,color:G.gold}}>{a.time||'--:--'}</div>
                  <div>
                    <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,fontWeight:600}}>{a.patient||'Paciente sem nome'}</div>
                    <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{a.doctor||'Sem medico'} · {a.specialty||'Clinica geral'}</div>
                  </div>
                  <Badge text={a.status||'Aguarda'} col={statusColors[a.status]||G.dim}/>
                </div>
              ))}
            </div>
          )}

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:8,marginTop:12}}>
            <div style={{padding:10,border:`1px solid ${G.border}`,borderRadius:2,background:'rgba(212,175,55,0.03)'}}>
              <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,letterSpacing:1}}>PREVISAO NO-SHOW</div>
              <div style={{fontFamily:'Orbitron',fontSize:18,color:G.amber,marginTop:6}}>{predictedNoShow}</div>
              <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>consultas potencialmente ausentes</div>
            </div>
            <div style={{padding:10,border:`1px solid ${G.border}`,borderRadius:2,background:'rgba(212,175,55,0.03)'}}>
              <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,letterSpacing:1}}>ALERTAS NAO LIDOS</div>
              <div style={{fontFamily:'Orbitron',fontSize:18,color:unreadAlerts.length>0?G.red:G.green,marginTop:6}}>{unreadAlerts.length}</div>
              <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>pendencias para equipe clinica</div>
            </div>
          </div>
        </Panel>

        <Panel style={{padding:14,minHeight:360}}>
          <SectionHeader title="Radar de Risco"/>
          <div style={{display:'flex',gap:6,marginBottom:10}}>
            {[['all','TODOS'],['high','ALTO'],['medium','MODERADO']].map(([id,label])=>(
              <button key={id} onClick={()=>setRiskFilter(id)} style={{fontFamily:'Orbitron',fontSize:7,padding:'4px 9px',
                borderRadius:2,background:riskFilter===id?`${G.gold}18`:'transparent',
                border:`1px solid ${riskFilter===id?G.gold:G.border}`,color:riskFilter===id?G.gold:G.dim}}>{label}</button>
            ))}
          </div>

          {riskPatients.length===0?(
            <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.dim,padding:'10px 0',textAlign:'center'}}>Nenhum paciente com score de risco no momento.</div>
          ):(riskPatients.map((p,i)=>{
            const col = p.risk>=7 ? G.red : G.amber;
            return(
              <div key={p.id||i} style={{padding:'8px 0',borderBottom:`1px solid ${G.border}15`,display:'grid',gridTemplateColumns:'1fr auto',gap:8}}>
                <div>
                  <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,fontWeight:600}}>{p.nome}</div>
                  <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>FC {p.fc||'--'} · SpO2 {p.spo2||'--'} · PA {p.pa||'--/--'}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <Badge text={`R${p.risk}`} col={col}/>
                  <button onClick={()=>goTab('pacientes',`Abrindo prontuario de ${p.nome}.`)} style={{fontFamily:'Orbitron',fontSize:7,padding:'4px 8px',
                    background:'transparent',border:`1px solid ${G.border}`,color:G.dim,borderRadius:1}}>ABRIR</button>
                </div>
              </div>
            );
          }))}

          <div style={{marginTop:12}}>
            <VitalWave color={riskPatients.some(p=>p.risk>=7)?G.red:G.green} amp={riskPatients.some(p=>p.risk>=7)?1.3:0.7} h={44}/>
          </div>
        </Panel>

        <Panel style={{padding:14,minHeight:360}}>
          <SectionHeader title="Inbox Omnichannel" action={()=>goTab('comunicacao','Abrindo central de comunicacao.')} actionLabel="ABRIR CHAT"/>

          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6,marginBottom:10}}>
            {Object.entries(channelStats).map(([k,v])=>(
              <div key={k} style={{padding:'6px 4px',border:`1px solid ${G.border}`,borderRadius:2,textAlign:'center'}}>
                <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>{k.toUpperCase().slice(0,8)}</div>
                <div style={{fontFamily:'Orbitron',fontSize:13,color:G.gold,marginTop:2}}>{v}</div>
              </div>
            ))}
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:7}}>
            {omniInbox.map((item)=>{
              const col = item.priority==='alta' ? G.red : item.priority==='media' ? G.amber : G.teal;
              return(
                <div key={item.id} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8,padding:'7px 0',borderBottom:`1px solid ${G.border}15`,opacity:item.unread?1:0.85}}>
                  <div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,fontWeight:600}}>{item.from}</span>
                      <Badge text={item.channel} col={col} small/>
                    </div>
                    <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,lineHeight:1.35,marginTop:2}}>{item.msg}</div>
                  </div>
                  <div style={{fontFamily:'Orbitron',fontSize:8,color:G.dim}}>{item.time}</div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:10}}>
        <Panel style={{padding:14}}>
          <SectionHeader title="Ciclo de Receita" action={()=>goTab('financeiro','Abrindo modulo financeiro.')} actionLabel="VER FINANCEIRO"/>
          {invoices.length===0?(
            <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.dim,padding:'10px 0',textAlign:'center'}}>Sem faturas no periodo.</div>
          ):(
            <>
              <BarChart data={[
                {label:'Faturado',val:invoiceTotals.total||1,col:G.gold},
                {label:'Recebido',val:invoiceTotals.paid||1,col:G.green},
                {label:'Pendente',val:invoiceTotals.pending||1,col:G.amber},
              ]} h={72}/>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginTop:10}}>
                <div style={{padding:8,border:`1px solid ${G.border}`,borderRadius:2}}>
                  <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>FATURADO</div>
                  <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.gold,marginTop:3}}>{invoiceTotals.total.toLocaleString('pt-AO')} AOA</div>
                </div>
                <div style={{padding:8,border:`1px solid ${G.border}`,borderRadius:2}}>
                  <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>RECEBIDO</div>
                  <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.green,marginTop:3}}>{invoiceTotals.paid.toLocaleString('pt-AO')} AOA</div>
                </div>
                <div style={{padding:8,border:`1px solid ${G.border}`,borderRadius:2}}>
                  <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>PENDENTE</div>
                  <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.amber,marginTop:3}}>{invoiceTotals.pending.toLocaleString('pt-AO')} AOA</div>
                </div>
              </div>
            </>
          )}
        </Panel>

        <Panel style={{padding:14}}>
          <SectionHeader title="Capacidade Clinica"/>
          <div style={{display:'flex',justifyContent:'space-around'}}>
            <Ring val={bedsOccupied} max={Math.max(beds.length,1)} col={G.amber} label="Camas"/>
            <Ring val={criticalLabs.length} max={Math.max(labResults.length,1)} col={G.red} label="Labs criticos"/>
            <Ring val={prescriptions.filter(r=>r.status==='Activa').length} max={Math.max(prescriptions.length,1)} col={G.teal} label="Rx ativa"/>
          </div>
          <div style={{marginTop:10,fontFamily:'Rajdhani',fontSize:11,color:G.dim,lineHeight:1.45}}>
            Staff online: {staff.filter(s=>s.status==='Servico' || s.status==='Serviço' || s.status==='ServiÃ§o').length} ·
            Leitos livres: {Math.max(beds.length-bedsOccupied,0)}
          </div>
        </Panel>

        <Panel style={{padding:14}}>
          <SectionHeader title="Acoes Rapidas"/>
          <div style={{display:'flex',flexDirection:'column',gap:7}}>
            <button onClick={()=>goTab('pacientes','Abrindo cadastro de pacientes.')} style={{padding:'8px 10px',textAlign:'left',fontFamily:'Rajdhani',fontSize:12,
              background:`${G.gold}10`,border:`1px solid ${G.border}`,color:G.text,borderRadius:2}}>Novo paciente / prontuario</button>
            <button onClick={()=>goTab('agendamento','Abrindo agenda para nova consulta.')} style={{padding:'8px 10px',textAlign:'left',fontFamily:'Rajdhani',fontSize:12,
              background:`${G.teal}10`,border:`1px solid ${G.border}`,color:G.text,borderRadius:2}}>Nova consulta e triagem</button>
            <button onClick={()=>goTab('laboratorio','Abrindo painel laboratorial.')} style={{padding:'8px 10px',textAlign:'left',fontFamily:'Rajdhani',fontSize:12,
              background:`${G.amber}10`,border:`1px solid ${G.border}`,color:G.text,borderRadius:2}}>Registrar resultado de laboratorio</button>
            <button onClick={()=>{addNotification('crit','Escalada manual: rever fila critica imediatamente.');}} style={{padding:'8px 10px',textAlign:'left',fontFamily:'Rajdhani',fontSize:12,
              background:`${G.red}10`,border:`1px solid ${G.red}66`,color:G.red,borderRadius:2}}>Escalar fila critica</button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
/* ═══════════════════════════════════════════════════════════
   HOLOGRAFIA 3D — ATLAS 3D SKETCHFAB INTEGRADO
═══════════════════════════════════════════════════════════ */

const ATLAS_MODELS = {
  body_xr:      {id:'e89f83cd30ad48c980c7e1a152c6b172',label:'Corpo Completo XR',       icon:'🧬',parts:['head','chest','abdomen','pelvis','spine']},
  body_full:    {id:'9306344c4b554268a520c72c0d988b5b',label:'Anatomia Humana Completa', icon:'👤',parts:['head','chest','abdomen','pelvis','spine']},
  body_organs:  {id:'8a43f3a308994699a4000b17004d5220',label:'Órgãos Internos',          icon:'🫀',parts:['abdomen','stomach','liver','spleen','pancreas']},
  body_holo:    {id:'f62ec13f32114cc093f282ab0dbce4ae',label:'Holograma Corpo Completo', icon:'💠',parts:['head','chest','abdomen','pelvis','spine','arm_L','arm_R']},
  muscles_bones:{id:'db7be21587804a32ab3a99e165c56e19',label:'Músculos e Ossos',         icon:'💪',parts:['chest','abdomen','pelvis','spine','knee_L','knee_R','bone_pelvis']},
  stomach:      {id:'e0f1952de7204654ba469c3e887a029b',label:'Estômago Realista',         icon:'🟡',parts:['stomach','abdomen']},
  brain:        {id:'c9c9d4d671b94345952d012cc2ea7a24',label:'Cérebro Humano',            icon:'🧠',parts:['brain','head']},
  lungs:        {id:'ce09f4099a68467880f46e61eb9a3531',label:'Pulmões Realistas',         icon:'🫁',parts:['lung_L','lung_R','chest']},
  liver:        {id:'6c4e9bd0d49f4828b804259330c0c6c4',label:'Fígado e Vesícula',         icon:'🔴',parts:['liver','abdomen']},
  kidney:       {id:'e1476ceb1e3b4412af5418eee9c5ed08',label:'Rim Humano',                icon:'🫘',parts:['kidney_L','kidney_R','abdomen']},
  eye:          {id:'b42d09ed18034063a528d9b1a2a9654a',label:'Olho Humano',               icon:'👁', parts:['eye_L','eye_R','head']},
  spine:        {id:'bcd9eee09ce044ef98a69c315aa792e2',label:'Coluna Vertebral',          icon:'🦴',parts:['spine','neck','pelvis']},
  reproductive: {id:'17bdcd1c2e9046d1abde72eff5c2cd0d',label:'Sistema Reprodutivo',      icon:'🔵',parts:['pelvis','abdomen']},
  pelvis:       {id:'c24dc91c4aae4114abe1aaf5f71fb03a',label:'Pelve e Coxas',             icon:'🦵',parts:['pelvis','bone_pelvis','thigh_L','thigh_R','knee_L','knee_R']},
};

const PART_TO_MODEL = {
  brain:'brain',    head:'brain',
  lung_L:'lungs',   lung_R:'lungs',    chest:'lungs',
  heart:'body_xr',
  liver:'liver',    spleen:'liver',
  stomach:'stomach',pancreas:'body_organs',abdomen:'body_organs',
  kidney_L:'kidney',kidney_R:'kidney', bladder:'kidney',
  eye_L:'eye',      eye_R:'eye',
  spine:'spine',    neck:'spine',
  pelvis:'pelvis',  bone_pelvis:'pelvis',thigh_L:'pelvis',thigh_R:'pelvis',
  knee_L:'muscles_bones',knee_R:'muscles_bones',
  hand_L:'muscles_bones',hand_R:'muscles_bones',
  foot_L:'muscles_bones',foot_R:'muscles_bones',
  shin_L:'muscles_bones',shin_R:'muscles_bones',
  skin:'body_holo', thyroid:'spine',
  arm_L:'muscles_bones',arm_R:'muscles_bones',
};

function getBestModelForDisease(parts){
  if(!parts||!parts.length)return'body_xr';
  const priority=['brain','lungs','liver','kidney','stomach','eye','spine','pelvis','muscles_bones','body_organs','body_xr'];
  for(const prio of priority){
    const m=ATLAS_MODELS[prio];
    if(m&&parts.some(p=>m.parts.includes(p)))return prio;
  }
  for(const part of parts){const mk=PART_TO_MODEL[part];if(mk)return mk;}
  return'body_xr';
}

function Holografia({threeRef}) {
  const [query,setQuery]=useState('');
  const [sel,setSel]=useState(null);
  const [sugs,setSugs]=useState([]);
  const [scanning,setScanning]=useState(false);
  const [vitals,setVitals]=useState({hr:72,spo2:98.0,temp:36.6,bp:'120/80',rr:16});
  const [infoOpen,setInfoOpen]=useState(true);
  const [atlasModel,setAtlasModel]=useState('body_xr');
  const [atlasOpen,setAtlasOpen]=useState(false);
  const [iframeKey,setIframeKey]=useState(0);
  const vitRef=useRef();

  useEffect(()=>{
    vitRef.current=setInterval(()=>{
      setVitals(v=>({
        hr:Math.max(58,Math.min(108,(v.hr+(Math.random()-0.5)*2.5)|0)),
        spo2:parseFloat(Math.max(94,Math.min(100,v.spo2+(Math.random()-0.48)*0.4)).toFixed(1)),
        temp:parseFloat(Math.max(36.0,Math.min(38.2,v.temp+(Math.random()-0.5)*0.08)).toFixed(1)),
        bp:`${Math.max(100,Math.min(150,(+v.bp.split('/')[0])+(Math.random()-0.5)*3|0))}/${Math.max(62,Math.min(92,(+v.bp.split('/')[1])+(Math.random()-0.5)*2|0))}`,
        rr:Math.max(13,Math.min(22,(v.rr+(Math.random()-0.5)*1.2)|0)),
      }));
    },2400);
    return()=>clearInterval(vitRef.current);
  },[]);

  useEffect(()=>{
    const t1=setTimeout(()=>threeRef.current?.resize?.(),80);
    const t2=setTimeout(()=>threeRef.current?.resize?.(),400);
    return()=>{clearTimeout(t1);clearTimeout(t2);};
  },[]);

  const pick=key=>{
    setSel(key);setQuery(DISEASES[key].label);setSugs([]);setInfoOpen(true);
    setScanning(true);setTimeout(()=>setScanning(false),1800);
    threeRef.current?.highlight(DISEASES[key].parts,DISEASES[key].sevC);
    setTimeout(()=>threeRef.current?.resize?.(),60);
    const best=getBestModelForDisease(DISEASES[key].parts);
    if(best!==atlasModel){setAtlasModel(best);setIframeKey(k=>k+1);}
  };
  const clear=()=>{setSel(null);setQuery('');threeRef.current?.reset();};

  useEffect(()=>{
    if(query.length<2){setSugs([]);return;}
    const q=query.toLowerCase();
    setSugs(Object.entries(DISEASES).filter(([k,d])=>
      d.label.toLowerCase().includes(q)||d.cat.toLowerCase().includes(q)||k.includes(q)
    ).slice(0,10));
  },[query]);

  const D=sel?DISEASES[sel]:null;
  const totalDiseases=Object.keys(DISEASES).length;
  const currentModel=ATLAS_MODELS[atlasModel];
  const sketchfabUrl=currentModel?.id
    ?`https://sketchfab.com/models/${currentModel.id}/embed?autospin=0&autostart=1&ui_theme=dark&ui_infos=0&ui_watermark=0&ui_ar=0&ui_help=0&ui_settings=0&ui_stop=0&preload=1`
    :null;

  const CATS=[
    {label:'Angola Top',keys:['malaria','tuberculose','hiv_sida','febre_amarela','drepanocitose','colera']},
    {label:'Cardiovascular',keys:['infarto','avc','hipertensao','insuf_cardiaca','fibrilacao','angina']},
    {label:'Respiratório',keys:['pneumonia','covid19','asma','dpoc','embolia_pulm','tuberculose']},
    {label:'Parasitário',keys:['malaria','esquistossomose','tripanossomiase','filariose','amebíase','leishmaniose']},
    {label:'Oncológico',keys:['cancro','cancro_mama','cancro_colo','cancro_colon','cancro_prostata','cancro_hepatico']},
  ];
  const [catIdx,setCatIdx]=useState(0);
  const [wireframe,setWireframe]=useState(false);
  const [sysFilter,setSysFilter]=useState('all');
  const SYSTEMS={
    all:{label:'TODOS OS SISTEMAS',parts:[],col:G.teal},
    cardio:{label:'CARDIOVASCULAR',parts:['heart','lung_L','lung_R','thyroid','chest','arm_L'],col:'#FF4455'},
    neuro:{label:'NEUROLÓGICO',parts:['brain','head','spine'],col:'#AA44FF'},
    digestivo:{label:'DIGESTIVO',parts:['stomach','liver','pancreas','spleen','bladder'],col:'#FF8800'},
    renal:{label:'RENAL',parts:['kidney_L','kidney_R','bladder'],col:'#00AAFF'},
    musculo:{label:'MÚSCULO-ESQUELÉTICO',parts:['chest','abdomen','pelvis','spine','knee_L','knee_R'],col:'#44FF88'},
    oftalmo:{label:'OFTALMOLÓGICO',parts:['eye_L','eye_R'],col:'#FFDD00'},
    reprodutivo:{label:'REPRODUTIVO',parts:['pelvis','abdomen'],col:'#FF88CC'},
  };

  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',padding:0,position:'relative'}}>
    {/* CONTROLS BAR */}
    <div style={{display:'flex',alignItems:'center',gap:6,padding:'5px 10px',
      background:'rgba(4,3,1,0.96)',borderBottom:`1px solid ${G.border}`,
      flexShrink:0,flexWrap:'wrap'}}>
      <div style={{fontFamily:'Cinzel',fontSize:8,color:G.dim,letterSpacing:2,marginRight:4}}>SISTEMA:</div>
      {Object.entries(SYSTEMS).map(([k,s])=>(
        <button key={k} onClick={()=>{setSysFilter(k);if(k!=='all')threeRef.current?.highlight(s.parts,s.col);else clear();}}
          style={{fontFamily:'Orbitron',fontSize:7,padding:'4px 9px',borderRadius:2,letterSpacing:0.5,
            background:sysFilter===k?`${s.col}18`:'transparent',
            border:`1px solid ${sysFilter===k?s.col:G.border+'55'}`,
            color:sysFilter===k?s.col:G.dim,transition:'all 0.15s',whiteSpace:'nowrap'}}
          onMouseEnter={e=>{e.target.style.borderColor=s.col;e.target.style.color=s.col;}}
          onMouseLeave={e=>{if(sysFilter!==k){e.target.style.borderColor=G.border+'55';e.target.style.color=G.dim;}}}>
          {s.label.split(' ')[0]}
        </button>
      ))}
      <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center'}}>
        <button onClick={()=>setAtlasOpen(o=>!o)}
          style={{fontFamily:'Orbitron',fontSize:7,padding:'4px 10px',borderRadius:2,
            background:atlasOpen?`${G.gold}20`:'transparent',
            border:`1px solid ${atlasOpen?G.gold:G.border+'55'}`,
            color:atlasOpen?G.gold:G.dim,letterSpacing:0.5,display:'flex',alignItems:'center',gap:4}}>
          {currentModel?.icon} ATLAS 3D {atlasOpen?'▲':'▼'}
        </button>
        <button onClick={()=>{setWireframe(w=>!w);}}
          style={{fontFamily:'Orbitron',fontSize:7,padding:'4px 9px',borderRadius:2,
            background:wireframe?`${G.teal}18`:'transparent',
            border:`1px solid ${wireframe?G.teal:G.border+'55'}`,
            color:wireframe?G.teal:G.dim,letterSpacing:0.5}}>
          ⟡ WIRE
        </button>
        <button onClick={()=>{threeRef.current?.reset();setSel(null);setQuery('');setSysFilter('all');}}
          style={{fontFamily:'Orbitron',fontSize:7,padding:'4px 9px',borderRadius:2,
            background:'transparent',border:`1px solid ${G.border+'55'}`,color:G.dim,letterSpacing:0.5}}
          onMouseEnter={e=>{e.target.style.color=G.gold;e.target.style.borderColor=G.gold;}}
          onMouseLeave={e=>{e.target.style.color=G.dim;e.target.style.borderColor=G.border+'55';}}>
          ↺ RESET
        </button>
      </div>
    </div>

    {/* ATLAS 3D PANEL */}
    {atlasOpen&&(
      <div style={{background:'rgba(2,1,0,0.98)',borderBottom:`1px solid ${G.border}`,
        padding:'10px 12px',flexShrink:0,animation:'fadeUp 0.25s ease'}}>
        <div style={{display:'flex',gap:5,marginBottom:8,flexWrap:'wrap'}}>
          {Object.entries(ATLAS_MODELS).map(([k,m])=>(
            <button key={k} onClick={()=>{setAtlasModel(k);setIframeKey(i=>i+1);}}
              style={{fontFamily:'Rajdhani',fontSize:9,padding:'4px 10px',borderRadius:2,
                background:atlasModel===k?`${G.gold}18`:'rgba(212,175,55,0.04)',
                border:`1px solid ${atlasModel===k?G.gold:G.border+'33'}`,
                color:atlasModel===k?G.gold:G.dim,transition:'all 0.15s',
                display:'flex',alignItems:'center',gap:4,whiteSpace:'nowrap'}}>
              <span style={{fontSize:12}}>{m.icon}</span>{m.label}
            </button>
          ))}
        </div>
        <div style={{position:'relative',width:'100%',height:460,borderRadius:4,overflow:'hidden',
          border:`1px solid ${G.border}`,background:'#000'}}>
          <div style={{position:'absolute',left:0,right:0,height:40,
            background:'linear-gradient(to bottom,transparent,rgba(0,200,255,0.04),transparent)',
            animation:'scanLine 6s linear infinite',pointerEvents:'none',zIndex:3}}/>
          <div style={{position:'absolute',top:8,left:12,zIndex:4,pointerEvents:'none',
            fontFamily:'Cinzel',fontSize:10,color:G.gold,letterSpacing:2,
            textShadow:`0 0 12px ${G.gold}AA`}}>
            {currentModel?.icon} {currentModel?.label?.toUpperCase()}
            {D&&<span style={{color:D.sevC,marginLeft:10,fontFamily:'Orbitron',fontSize:8}}>● {D.label.slice(0,28).toUpperCase()}</span>}
          </div>
          <div style={{position:'absolute',top:6,left:6,width:12,height:12,borderTop:`1px solid ${G.gold}`,borderLeft:`1px solid ${G.gold}`,opacity:0.5,zIndex:4}}/>
          <div style={{position:'absolute',top:6,right:6,width:12,height:12,borderTop:`1px solid ${G.gold}`,borderRight:`1px solid ${G.gold}`,opacity:0.5,zIndex:4}}/>
          <div style={{position:'absolute',bottom:6,left:6,width:12,height:12,borderBottom:`1px solid ${G.gold}`,borderLeft:`1px solid ${G.gold}`,opacity:0.5,zIndex:4}}/>
          <div style={{position:'absolute',bottom:6,right:6,width:12,height:12,borderBottom:`1px solid ${G.gold}`,borderRight:`1px solid ${G.gold}`,opacity:0.5,zIndex:4}}/>
          {sketchfabUrl?(
            <iframe key={iframeKey} title={currentModel?.label} src={sketchfabUrl}
              allowFullScreen mozAllowFullScreen={true} webkitAllowFullScreen={true}
              allow="autoplay; fullscreen; xr-spatial-tracking"
              style={{width:'100%',height:'100%',border:'none',display:'block'}}/>
          ):(
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
              height:'100%',color:G.dim,fontFamily:'Rajdhani',fontSize:13,gap:8}}>
              <div style={{fontSize:32}}>❤️</div>
              <div>Coração — modelo FBX local</div>
            </div>
          )}
        </div>
        {D&&(
          <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:6}}>
            <span style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,letterSpacing:1,marginRight:4}}>ZONAS:</span>
            {D.parts.map(p=>(
              <span key={p} onClick={()=>{const mk=PART_TO_MODEL[p]||'body_xr';setAtlasModel(mk);setIframeKey(i=>i+1);}}
                style={{fontFamily:'Orbitron',fontSize:7,padding:'2px 7px',borderRadius:1,
                  background:`${D.sevC}18`,border:`1px solid ${D.sevC}44`,color:D.sevC,
                  letterSpacing:0.5,cursor:'pointer'}}>
                {p.replace(/_/g,' ').toUpperCase()} ▶
              </span>
            ))}
          </div>
        )}
      </div>
    )}

    <div style={{display:'flex',gap:0,flex:1,minHeight:0,position:'relative'}}>
      {/* LEFT PANEL */}
      <div style={{width:150,flexShrink:0,display:'flex',flexDirection:'column',gap:5,padding:6,
        background:'rgba(4,3,1,0.98)',borderRight:`1px solid ${G.border}`,zIndex:10,overflowY:'auto'}}>
        <Panel style={{padding:10}}>
          <div style={{fontFamily:'Cinzel',fontSize:8,color:G.gold,letterSpacing:2,marginBottom:6}}>⬡ {totalDiseases} PATOLOGIAS</div>
          <div style={{position:'relative'}}>
            <input value={query} onChange={e=>setQuery(e.target.value)}
              onFocus={()=>{if(query.length<2)setSugs(Object.entries(DISEASES).slice(0,10));}}
              onBlur={()=>setTimeout(()=>setSugs([]),200)}
              placeholder="🔍 Pesquisar..."
              style={{width:'100%',background:'rgba(212,175,55,0.06)',border:`1px solid ${G.border}`,
                borderRadius:2,padding:'6px 24px 6px 8px',color:G.text,fontFamily:'Rajdhani',fontSize:11}}/>
            {sel&&<button onClick={clear} style={{position:'absolute',right:5,top:'50%',transform:'translateY(-50%)',
              background:'none',color:G.dim,fontSize:12}}>✕</button>}
            {sugs.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#0D0900',
                border:`1px solid ${G.border}`,borderRadius:2,zIndex:500,maxHeight:240,overflowY:'auto',
                boxShadow:'0 8px 24px rgba(0,0,0,0.9)'}}>
                {sugs.map(([k,d])=>(
                  <div key={k} onMouseDown={()=>pick(k)}
                    style={{padding:'6px 9px',cursor:'pointer',borderBottom:`1px solid ${G.border}15`}}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(212,175,55,0.1)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.text,lineHeight:1.3}}>{d.label}</div>
                    <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,marginTop:1}}>{d.cat.split('·')[0].trim()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
        <Panel style={{padding:8}}>
          <div style={{display:'flex',flexWrap:'wrap',gap:3,marginBottom:7}}>
            {CATS.map((c,i)=>(
              <button key={i} onClick={()=>setCatIdx(i)}
                style={{fontSize:6,fontFamily:'Orbitron',padding:'2px 5px',borderRadius:1,
                  background:catIdx===i?`${G.gold}18`:'transparent',
                  border:`1px solid ${catIdx===i?G.gold:G.border}33`,
                  color:catIdx===i?G.gold:G.dim,letterSpacing:0.3,whiteSpace:'nowrap'}}>
                {c.label}
              </button>
            ))}
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:3}}>
            {CATS[catIdx].keys.map(k=>{
              const d=DISEASES[k];if(!d)return null;
              return(
                <button key={k} onClick={()=>pick(k)}
                  style={{width:'100%',textAlign:'left',padding:'5px 8px',borderRadius:2,
                    background:sel===k?`${d.sevC}14`:'rgba(212,175,55,0.03)',
                    border:`1px solid ${sel===k?d.sevC:G.border}33`,
                    display:'flex',alignItems:'center',gap:6,transition:'all 0.15s'}}>
                  <div style={{width:5,height:5,borderRadius:'50%',background:d.sevC,flexShrink:0,
                    boxShadow:`0 0 4px ${d.sevC}`,animation:sel===k?'blink 1.5s ease-in-out infinite':undefined}}/>
                  <span style={{fontFamily:'Rajdhani',fontSize:10,color:sel===k?G.text:G.dim,
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:1.2}}>{d.label}</span>
                </button>
              );
            })}
          </div>
        </Panel>
        <Panel style={{padding:9,flex:1,overflow:'auto'}}>
          <div style={{fontFamily:'Cinzel',fontSize:7,color:G.dim,letterSpacing:2,marginBottom:6}}>MAPA CORPORAL</div>
          {[['🧠 Cabeça/Cérebro',['head','brain']],['👁 Olhos',['eye_L','eye_R']],
            ['🫁 Pulmões',['lung_L','lung_R']],['❤️ Coração',['heart']],
            ['🫀 Tórax',['chest']],['🔴 Fígado',['liver']],
            ['🟤 Pâncreas',['pancreas']],['⭕ Baço',['spleen']],
            ['🫘 Rins',['kidney_L','kidney_R']],['🫙 Bexiga',['bladder']],
            ['🟡 Estômago',['stomach']],['🦴 Pelve',['bone_pelvis','pelvis']],
            ['✋ Mãos',['hand_L','hand_R']],['🦵 Joelhos',['knee_L','knee_R']],
            ['🦶 Pés',['foot_L','foot_R']],['🌐 Coluna',['spine']],
            ['🦋 Tiróide',['thyroid']],['🔴 Pele',['skin']],
          ].map(([lbl,parts])=>{
            const hit=D&&parts.some(p=>D.parts.includes(p));
            return(
              <div key={lbl} style={{display:'flex',alignItems:'center',gap:5,padding:'2px 0',
                borderBottom:`1px solid ${G.border}10`,cursor:'pointer'}}
                onClick={()=>{
                  const mk=PART_TO_MODEL[parts[0]]||'body_xr';
                  setAtlasModel(mk);setAtlasOpen(true);setIframeKey(i=>i+1);
                }}>
                <div style={{width:6,height:6,borderRadius:'50%',flexShrink:0,
                  background:hit?D.sevC:G.gold,opacity:hit?1:0.25,
                  boxShadow:hit?`0 0 8px ${D.sevC}`:undefined,
                  animation:hit?'blink 1.5s ease-in-out infinite':undefined}}/>
                <span style={{fontFamily:'Rajdhani',fontSize:9,color:hit?G.text:G.dim,lineHeight:1.3,flex:1}}>{lbl}</span>
                {hit&&<span style={{fontSize:6,color:D.sevC}}>▶</span>}
              </div>
            );
          })}
        </Panel>
        <Panel style={{padding:8}}>
          <div style={{fontFamily:'Orbitron',fontSize:7,color:D?D.sevC:G.dim,letterSpacing:1,marginBottom:3}}>
            {D?`● ${D.sev}`:'● STANDBY'}
          </div>
          <VitalWave color={D?D.sevC:G.gold} amp={D?1.5:0.6} h={32}/>
        </Panel>
      </div>

      {/* CENTER CANVAS */}
      <div style={{flex:1,position:'relative',overflow:'hidden',
        background:'radial-gradient(ellipse at 50% 20%, #080500 0%, #010100 70%, #000000 100%)'}}>
        <div id="three-canvas" style={{width:'100%',height:'100%'}}/>
        <div style={{position:'absolute',top:12,left:14,pointerEvents:'none',
          fontFamily:'Cinzel',fontSize:11,color:G.gold,letterSpacing:3,
          textShadow:`0 0 16px ${G.gold}BB`}}>
          FUMUGOLD · HOLOGRAMA MÉDICO 3D
        </div>
        {scanning&&(
          <div style={{position:'absolute',top:0,left:0,right:0,height:2,
            background:`linear-gradient(to right,transparent,${D?D.sevC:G.teal},transparent)`,
            animation:'scanLine 1.8s linear 1',zIndex:10}}/>
        )}
        {D&&(
          <div style={{position:'absolute',bottom:12,left:'50%',transform:'translateX(-50%)',
            background:'rgba(4,3,1,0.92)',border:`1px solid ${D.sevC}66`,borderRadius:2,
            padding:'5px 14px',fontFamily:'Orbitron',fontSize:8,color:D.sevC,
            letterSpacing:1,animation:'fadeUp 0.3s ease',display:'flex',alignItems:'center',gap:6,
            boxShadow:`0 0 20px ${D.sevC}22`}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:D.sevC,animation:'blink 1s ease-in-out infinite'}}/>
            {D.label.toUpperCase()}
            <span style={{color:G.dim,marginLeft:4}}>· {D.parts.length} ZONAS</span>
          </div>
        )}
        <div style={{position:'absolute',top:12,right:12}}
          onClick={()=>setAtlasOpen(o=>!o)}>
          <div style={{background:'rgba(4,3,1,0.85)',border:`1px solid ${G.border}`,borderRadius:2,
            padding:'3px 8px',fontFamily:'Orbitron',fontSize:7,color:G.dim,letterSpacing:1,
            cursor:'pointer',display:'flex',gap:5,alignItems:'center'}}>
            <span>{currentModel?.icon}</span>
            <span style={{color:G.gold}}>{atlasOpen?'▲':'▼'} ATLAS</span>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL */}
      {D&&infoOpen&&(
        <div style={{width:220,flexShrink:0,background:'rgba(4,3,1,0.98)',
          borderLeft:`1px solid ${G.border}`,overflowY:'auto',animation:'fadeUp 0.3s ease'}}>
          <div style={{padding:'10px 11px',borderBottom:`1px solid ${G.border}`,
            background:`${D.sevC}08`,position:'sticky',top:0,zIndex:5}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:4}}>
              <div>
                <div style={{fontFamily:'Cinzel',fontSize:9,color:D.sevC,letterSpacing:1.5,marginBottom:2}}>{D.sev}</div>
                <div style={{fontFamily:'Rajdhani',fontSize:13,color:G.text,fontWeight:600,lineHeight:1.3}}>{D.label}</div>
                <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,marginTop:2,letterSpacing:0.5}}>{D.cat}</div>
              </div>
              <button onClick={()=>setInfoOpen(false)} style={{background:'none',color:G.dim,fontSize:14,padding:2,flexShrink:0}}>✕</button>
            </div>
            <div style={{marginTop:6,display:'flex',alignItems:'center',gap:4,
              background:'rgba(212,175,55,0.06)',border:`1px solid ${G.border}33`,
              borderRadius:2,padding:'3px 7px',cursor:'pointer'}}
              onClick={()=>setAtlasOpen(o=>!o)}>
              <span style={{fontSize:11}}>{currentModel?.icon}</span>
              <span style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,letterSpacing:0.5}}>{currentModel?.label?.slice(0,20)}</span>
              <span style={{color:G.gold,fontSize:7,marginLeft:'auto'}}>3D ▶</span>
            </div>
          </div>
          <div style={{padding:'10px 11px',display:'flex',flexDirection:'column',gap:9}}>
            <div>
              <div style={{fontFamily:'Cinzel',fontSize:7,color:G.gold,letterSpacing:2,marginBottom:5}}>⬡ ZONAS AFECTADAS</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                {D.parts.map(p=>(
                  <span key={p} onClick={()=>{const mk=PART_TO_MODEL[p]||'body_xr';setAtlasModel(mk);setAtlasOpen(true);setIframeKey(i=>i+1);}}
                    style={{fontFamily:'Orbitron',fontSize:7,padding:'2px 6px',borderRadius:1,
                      background:`${D.sevC}15`,border:`1px solid ${D.sevC}44`,color:D.sevC,
                      letterSpacing:0.5,cursor:'pointer'}}>
                    {p.replace(/_/g,' ').toUpperCase()} ▶
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div style={{fontFamily:'Cinzel',fontSize:7,color:G.gold,letterSpacing:2,marginBottom:4}}>⬡ PATOLOGIA</div>
              <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dimL,lineHeight:1.6}}>{D.descricao}</div>
            </div>
            <div>
              <div style={{fontFamily:'Cinzel',fontSize:7,color:G.gold,letterSpacing:2,marginBottom:5}}>⬡ SINTOMAS</div>
              {D.sintomas.map((s,i)=>(
                <div key={i} style={{display:'flex',gap:6,marginBottom:4,alignItems:'flex-start'}}>
                  <div style={{width:5,height:5,borderRadius:'50%',background:D.sevC,flexShrink:0,marginTop:3,boxShadow:`0 0 4px ${D.sevC}`}}/>
                  <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.text,lineHeight:1.4}}>{s}</span>
                </div>
              ))}
            </div>
            <div style={{height:1,background:G.border}}/>
            <div>
              <div style={{fontFamily:'Cinzel',fontSize:7,color:G.gold,letterSpacing:2,marginBottom:4}}>⬡ TERAPÊUTICA</div>
              <pre style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,lineHeight:1.6,whiteSpace:'pre-wrap'}}>{D.trat}</pre>
            </div>
            <div style={{padding:'7px 10px',background:`${D.sevC}10`,border:`1px solid ${D.sevC}44`,borderRadius:2,
              ...(D.sevC==='#FF2020'?{animation:'pulseRed 2s ease-in-out infinite'}:{})}}>
              <div style={{fontFamily:'Orbitron',fontSize:7,color:D.sevC,letterSpacing:1}}>⚠ {D.urg}</div>
            </div>
          </div>
        </div>
      )}
      {D&&!infoOpen&&(
        <button onClick={()=>setInfoOpen(true)}
          style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',
            background:'rgba(4,3,1,0.9)',border:`1px solid ${D.sevC}66`,color:D.sevC,
            borderRadius:2,padding:'8px 6px',fontFamily:'Orbitron',fontSize:8,zIndex:20,
            writingMode:'vertical-rl',letterSpacing:1}}>
          INFO ▶
        </button>
      )}
    </div>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════
   IA ASSISTENTE — OPENROUTER + AVATAR 3D
═══════════════════════════════════════════════════════════ */
const OR_KEY = import.meta.env.VITE_OPENROUTER_API_KEY || '';
const OR_MODEL = 'deepseek/deepseek-r1:free';
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

const IA_AVATAR_ID = 'f62ec13f32114cc093f282ab0dbce4ae'; // Holograma corpo - avatar da IA

const SYSTEM_PROMPT = `És a ARIA — Assistente de Inteligência Artificial do sistema FumuGold, uma plataforma médica clínica avançada em Angola.
Respondes SEMPRE em português de Angola.
Tens conhecimento de:
- Gestão clínica: pacientes, consultas, internamentos, laboratório, prescrições
- Doenças comuns em Angola: malária, tuberculose, VIH/SIDA, drepanocitose, febre amarela
- Protocolos médicos e terapêuticas
- Análise de KPIs da clínica: pacientes críticos, faturas pendentes, ocupação de camas
- O sistema FumuGold e todos os seus módulos
Sês concisa, profissional e útil. Nunca inventas dados clínicos. Quando não sabes algo, dizes claramente.`;

function IAAssistente({kpis}) {
  const [msgs, setMsgs] = useState([
    {role:'assistant', content:'Olá! Sou a ARIA, a tua assistente de IA do FumuGold. Como posso ajudar hoje?', ts: new Date()}
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [avatarAnim, setAvatarAnim] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(true);
  const bottomRef = useRef();
  const inputRef = useRef();

  useEffect(()=>{
    bottomRef.current?.scrollIntoView({behavior:'smooth'});
  },[msgs]);

  const SUGGESTIONS = [
    'Resumo operacional de hoje',
    'Pacientes em risco crítico',
    'Faturas pendentes',
    'Protocolo da malária',
    'Ocupação das camas',
    'Doenças mais comuns em Angola',
  ];

  const send = async (text) => {
    const q = text || input.trim();
    if (!q || loading) return;
    setInput('');
    setLoading(true);
    setAvatarAnim(true);

    const userMsg = {role:'user', content: q, ts: new Date()};
    const newMsgs = [...msgs, userMsg];
    setMsgs(newMsgs);

    // Contexto dos KPIs actuais
    const kpiContext = kpis ? `

Dados actuais da clínica:
- Pacientes: ${kpis.totalPatients||0}
- Consultas hoje: ${kpis.totalAppointments||0}
- Faturas pendentes: ${kpis.pendingInvoices||0}
- Pacientes críticos: ${kpis.criticalPatients||0}
- Camas ocupadas: ${kpis.occupiedBeds||0}
- Notificações: ${kpis.unreadNotifications||0}` : '';

    try {
      const res = await fetch(OR_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OR_KEY}`,
          'HTTP-Referer': 'https://fumugold.app',
          'X-Title': 'FumuGold Clinical AI',
        },
        body: JSON.stringify({
          model: OR_MODEL,
          messages: [
            {role:'system', content: SYSTEM_PROMPT + kpiContext},
            ...newMsgs.slice(-8).map(m=>({role:m.role, content:m.content}))
          ],
          max_tokens: 600,
          temperature: 0.7,
        })
      });

      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content || 'Não consegui obter resposta. Tenta novamente.';
      setMsgs(p=>[...p, {role:'assistant', content: reply, ts: new Date()}]);
    } catch(e) {
      setMsgs(p=>[...p, {role:'assistant', content:'Erro de ligação. Verifica a tua conexão à internet.', ts: new Date(), err:true}]);
    }
    setLoading(false);
    setTimeout(()=>setAvatarAnim(false), 2000);
    setTimeout(()=>inputRef.current?.focus(), 100);
  };

  const fmtTime = d => d ? new Date(d).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}) : '';

  return (
    <div style={{display:'flex',height:'100%',background:G.bg,overflow:'hidden'}}>

      {/* AVATAR PANEL */}
      {avatarOpen && (
        <div style={{width:320,flexShrink:0,background:'rgba(2,1,0,0.98)',
          borderRight:`1px solid ${G.border}`,display:'flex',flexDirection:'column',
          position:'relative',overflow:'hidden'}}>
          {/* Scan line */}
          <div style={{position:'absolute',left:0,right:0,height:40,
            background:'linear-gradient(to bottom,transparent,rgba(0,200,255,0.05),transparent)',
            animation:'scanLine 5s linear infinite',pointerEvents:'none',zIndex:3}}/>
          {/* Header */}
          <div style={{padding:'10px 14px',borderBottom:`1px solid ${G.border}`,
            background:'rgba(4,3,1,0.95)',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
            <div style={{width:8,height:8,borderRadius:'50%',background:loading?G.amber:G.green,
              boxShadow:`0 0 8px ${loading?G.amber:G.green}`,
              animation:loading?'blink 0.5s ease-in-out infinite':'blink 3s ease-in-out infinite'}}/>
            <div>
              <div style={{fontFamily:'Cinzel',fontSize:10,color:G.gold,letterSpacing:2}}>ARIA</div>
              <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,letterSpacing:1}}>
                {loading?'A PROCESSAR...':'IA CLÍNICA · ONLINE'}
              </div>
            </div>
            <button onClick={()=>setAvatarOpen(false)}
              style={{marginLeft:'auto',background:'none',color:G.dim,fontSize:12}}>✕</button>
          </div>

          {/* 3D Avatar iframe */}
          <div style={{flex:1,position:'relative',background:'#000',minHeight:0}}>
            <iframe
              title="ARIA Avatar"
              src={`https://sketchfab.com/models/${IA_AVATAR_ID}/embed?autospin=1&autostart=1&ui_theme=dark&ui_infos=0&ui_watermark=0&ui_ar=0&ui_help=0&ui_settings=0&ui_stop=0&ui_animations=0&preload=1&camera=0`}
              allowFullScreen
              allow="autoplay; fullscreen; xr-spatial-tracking"
              style={{width:'100%',height:'100%',border:'none',display:'block',
                filter:avatarAnim?'hue-rotate(30deg) brightness(1.2)':'none',
                transition:'filter 0.5s'}}
            />
            {/* Overlay info */}
            <div style={{position:'absolute',bottom:10,left:0,right:0,
              display:'flex',justifyContent:'center',pointerEvents:'none'}}>
              <div style={{background:'rgba(4,3,1,0.85)',border:`1px solid ${G.border}`,
                borderRadius:2,padding:'4px 12px',fontFamily:'Orbitron',fontSize:7,
                color:loading?G.amber:G.teal,letterSpacing:1,
                animation:loading?'blink 0.8s ease-in-out infinite':undefined}}>
                {loading?'● PROCESSANDO RESPOSTA':'● ARIA · PRONTA'}
              </div>
            </div>
          </div>

          {/* KPIs rápidos */}
          {kpis && (
            <div style={{padding:'8px 10px',borderTop:`1px solid ${G.border}`,
              display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:4,flexShrink:0}}>
              {[
                {label:'Pacientes',val:kpis.totalPatients||0,col:G.teal},
                {label:'Críticos',val:kpis.criticalPatients||0,col:G.red},
                {label:'Pendentes',val:kpis.pendingInvoices||0,col:G.amber},
              ].map(({label,val,col})=>(
                <div key={label} style={{background:`${col}10`,border:`1px solid ${col}33`,
                  borderRadius:2,padding:'4px 6px',textAlign:'center'}}>
                  <div style={{fontFamily:'Orbitron',fontSize:11,color:col,fontWeight:700}}>{val}</div>
                  <div style={{fontFamily:'Rajdhani',fontSize:8,color:G.dim}}>{label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CHAT PANEL */}
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>
        {/* Chat header */}
        <div style={{padding:'10px 14px',borderBottom:`1px solid ${G.border}`,
          background:'rgba(4,3,1,0.96)',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          {!avatarOpen && (
            <button onClick={()=>setAvatarOpen(true)}
              style={{background:'rgba(212,175,55,0.1)',border:`1px solid ${G.border}`,
                borderRadius:2,color:G.gold,fontFamily:'Orbitron',fontSize:7,
                padding:'4px 8px',letterSpacing:1}}>
              ⬡ AVATAR
            </button>
          )}
          <div style={{fontFamily:'Cinzel',fontSize:10,color:G.gold,letterSpacing:2}}>
            ARIA — Assistente Clínica IA
          </div>
          <div style={{marginLeft:'auto',fontFamily:'Orbitron',fontSize:7,color:G.dim,letterSpacing:1}}>
            {OR_MODEL.split('/')[1]?.toUpperCase()} · OPENROUTER
          </div>
        </div>

        {/* Messages */}
        <div style={{flex:1,overflowY:'auto',padding:'12px 14px',display:'flex',flexDirection:'column',gap:10}}>
          {msgs.map((m,i)=>(
            <div key={i} style={{display:'flex',gap:8,
              flexDirection:m.role==='user'?'row-reverse':'row',
              alignItems:'flex-start'}}>
              {/* Avatar dot */}
              <div style={{width:28,height:28,borderRadius:'50%',flexShrink:0,
                background:m.role==='user'?`${G.gold}22`:`${G.teal}22`,
                border:`1px solid ${m.role==='user'?G.gold:G.teal}44`,
                display:'flex',alignItems:'center',justifyContent:'center',
                fontFamily:'Orbitron',fontSize:8,
                color:m.role==='user'?G.gold:G.teal}}>
                {m.role==='user'?'U':'A'}
              </div>
              {/* Bubble */}
              <div style={{maxWidth:'75%',
                background:m.role==='user'?`${G.gold}0A`:`${G.teal}08`,
                border:`1px solid ${m.role==='user'?G.gold:m.err?G.red:G.teal}22`,
                borderRadius:m.role==='user'?'8px 2px 8px 8px':'2px 8px 8px 8px',
                padding:'8px 12px'}}>
                <div style={{fontFamily:'Rajdhani',fontSize:12,
                  color:m.err?G.red:G.text,lineHeight:1.65,whiteSpace:'pre-wrap'}}>
                  {m.content}
                </div>
                <div style={{fontFamily:'Orbitron',fontSize:6,color:G.dim,
                  marginTop:4,textAlign:m.role==='user'?'right':'left'}}>
                  {fmtTime(m.ts)}
                </div>
              </div>
            </div>
          ))}
          {loading && (
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <div style={{width:28,height:28,borderRadius:'50%',
                background:`${G.teal}22`,border:`1px solid ${G.teal}44`,
                display:'flex',alignItems:'center',justifyContent:'center',
                fontFamily:'Orbitron',fontSize:8,color:G.teal}}>A</div>
              <div style={{background:`${G.teal}08`,border:`1px solid ${G.teal}22`,
                borderRadius:'2px 8px 8px 8px',padding:'10px 16px',
                display:'flex',gap:5,alignItems:'center'}}>
                {[0,1,2].map(j=>(
                  <div key={j} style={{width:6,height:6,borderRadius:'50%',
                    background:G.teal,animation:`blink 1.2s ease-in-out ${j*0.2}s infinite`}}/>
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        {/* Suggestions */}
        {msgs.length<=2 && (
          <div style={{padding:'0 14px 8px',display:'flex',gap:5,flexWrap:'wrap'}}>
            {SUGGESTIONS.map(s=>(
              <button key={s} onClick={()=>send(s)}
                style={{fontFamily:'Rajdhani',fontSize:10,padding:'4px 10px',
                  background:'rgba(212,175,55,0.06)',border:`1px solid ${G.border}`,
                  borderRadius:2,color:G.dimL,cursor:'pointer',transition:'all 0.15s'}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=G.gold;e.currentTarget.style.color=G.gold;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=G.border;e.currentTarget.style.color=G.dimL;}}>
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{padding:'10px 14px',borderTop:`1px solid ${G.border}`,
          background:'rgba(4,3,1,0.96)',display:'flex',gap:8,flexShrink:0}}>
          <input
            ref={inputRef}
            value={input}
            onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}}
            placeholder="Pergunta à ARIA... (Enter para enviar)"
            disabled={loading}
            style={{flex:1,background:'rgba(212,175,55,0.06)',
              border:`1px solid ${G.border}`,borderRadius:2,
              padding:'8px 12px',color:G.text,fontFamily:'Rajdhani',fontSize:13,
              opacity:loading?0.5:1}}
          />
          <button onClick={()=>send()} disabled={loading||!input.trim()}
            style={{background:loading?'transparent':`${G.gold}18`,
              border:`1px solid ${loading?G.border:G.gold}`,
              borderRadius:2,color:loading?G.dim:G.gold,
              fontFamily:'Orbitron',fontSize:8,padding:'8px 16px',
              letterSpacing:1,cursor:loading?'default':'pointer',
              transition:'all 0.15s'}}>
            {loading?'...':'ENVIAR'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   AGENDAMENTO — CALENDAR
═══════════════════════════════════════════════════════════ */
function Agendamento() {
  const [view,setView]=useState('week');
  const [modalOpen,setModalOpen]=useState(false);
  const {appointments:appts,setAppointments:setAppts,patients,staff} = useClinic();
  const [form,setForm]=useState({patient:'',doctor:'',specialty:'',date:new Date().toISOString().split('T')[0],time:'09:00',room:'Consultório 1',type:'Consulta',notes:''});
  const days=['08/03','09/03','10/03','11/03','12/03','13/03','14/03'];
  const dayLabels=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const hours=['08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00'];
  const stCol={Confirmada:G.gold,'Em curso':G.green,Aguarda:G.dim,Cancelada:G.red};

  const today2025 = new Date().getFullYear();
  const getApptForSlot=(day,hour)=>appts.find(a=>{
    const d=a.date||'';
    return (d.endsWith(day.split('/')[0]+'/'+day.split('/')[1])||d.includes(day.split('/').reverse().join('-')))&&a.time===hour;
  });

  const saveAppt = () => {
    const pid = patients.find((x)=>String(x.nome||'').trim()===String(form.patient||'').trim())?.id ?? null;
    setAppts(p=>[...p,{...form,id:Date.now(),patient_id:pid,status:'Confirmada',
      initials:form.patient.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(),
      cor:G.gold}]);
    setModalOpen(false);
    setForm({...form,patient:'',specialty:'',notes:''});
  };

  return(<>
    <div style={{display:'flex',gap:10,height:'100%',padding:10}}>
      {/* Sidebar */}
      <div style={{width:220,flexShrink:0,display:'flex',flexDirection:'column',gap:8}}>
        <Panel style={{padding:14}}>
          <SectionHeader title="AGENDAMENTO" action={()=>setModalOpen(true)} actionLabel="NOVA"/>
          <div style={{display:'flex',gap:4,marginBottom:12}}>
            {['week','list'].map(v=>(
              <button key={v} onClick={()=>setView(v)}
                style={{flex:1,padding:'5px 0',fontFamily:'Orbitron',fontSize:7,letterSpacing:1,
                  background:view===v?`${G.gold}14`:'transparent',
                  border:`1px solid ${view===v?G.gold:G.border}`,
                  color:view===v?G.gold:G.dim,borderRadius:1}}>
                {v==='week'?'SEMANA':'LISTA'}
              </button>
            ))}
          </div>
          {/* Mini stats */}
          {[['Total Semana',appts.length],['Confirmadas',appts.filter(a=>a.status==='Confirmada').length],
            ['Aguarda',appts.filter(a=>a.status==='Aguarda').length],['Em Curso',appts.filter(a=>a.status==='Em curso').length]
          ].map(([l,v])=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',
              borderBottom:`1px solid ${G.border}15`}}>
              <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{l}</span>
              <span style={{fontFamily:'Orbitron',fontSize:11,color:G.gold,fontWeight:700}}>{v}</span>
            </div>
          ))}
        </Panel>
        <Panel style={{padding:12,flex:1,overflow:'auto'}}>
          <div style={{fontFamily:'Cinzel',fontSize:8,color:G.dim,letterSpacing:2,marginBottom:8}}>PRÓXIMAS</div>
          {appts.slice(0,6).map((a,i)=>(
            <div key={i} style={{padding:'7px 0',borderBottom:`1px solid ${G.border}15`}}>
              <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:2}}>
                <div style={{width:22,height:22,borderRadius:'50%',background:`${a.cor}18`,
                  border:`1px solid ${a.cor}55`,display:'flex',alignItems:'center',justifyContent:'center',
                  fontFamily:'Cinzel',fontSize:8,color:a.cor,flexShrink:0}}>{a.initials}</div>
                <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.text,
                  overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.patient}</span>
              </div>
              <div style={{fontFamily:'Orbitron',fontSize:8,color:G.dim,paddingLeft:28}}>
                {a.date.split('-').reverse().join('/')} {a.time} · {a.specialty}
              </div>
            </div>
          ))}
        </Panel>
        <Panel style={{padding:12}}>
          <div style={{fontFamily:'Cinzel',fontSize:8,color:G.dim,letterSpacing:2,marginBottom:8}}>SALAS</div>
          {['Consultório 1','Consultório 2','Consultório 3','Consultório 4','Sala Tratamento'].map((r,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'4px 0',borderBottom:`1px solid ${G.border}15`}}>
              <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{r}</span>
              <Dot col={i<3?G.green:G.dim} pulse={i===0}/>
            </div>
          ))}
        </Panel>
      </div>

      {/* Calendar */}
      <Panel style={{flex:1,overflow:'auto',padding:14}} noPad>
        <div style={{padding:'12px 14px',borderBottom:`1px solid ${G.border}`,
          display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontFamily:'Cinzel',fontSize:10,color:G.gold,letterSpacing:2}}>⬡ CALENDÁRIO SEMANAL — MARÇO 2025</div>
          <div style={{fontFamily:'Orbitron',fontSize:8,color:G.dim}}>Semana 10</div>
        </div>
        <div style={{overflowX:'auto'}}>
          {view==='week'?(
            <table style={{width:'100%',borderCollapse:'collapse',minWidth:600}}>
              <thead>
                <tr>
                  <th style={{width:50,padding:'8px',fontFamily:'Orbitron',fontSize:7,color:G.dim,
                    borderBottom:`1px solid ${G.border}`}}></th>
                  {days.map((d,i)=>(
                    <th key={i} style={{padding:'8px 4px',fontFamily:'Orbitron',fontSize:8,
                      color:i===2?G.gold:G.dim,borderBottom:`1px solid ${G.border}`,
                      background:i===2?`${G.gold}06`:undefined,textAlign:'center'}}>
                      <div>{dayLabels[i]}</div>
                      <div style={{fontSize:11,color:i===2?G.gold:G.text,fontWeight:i===2?700:400}}>{d}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hours.map(h=>(
                  <tr key={h}>
                    <td style={{padding:'6px 8px',fontFamily:'Orbitron',fontSize:8,color:G.dim,
                      borderRight:`1px solid ${G.border}`,textAlign:'right',verticalAlign:'top'}}>{h}</td>
                    {days.map((d,i)=>{
                      const a=getApptForSlot(d,h);
                      return(
                        <td key={i} style={{padding:3,borderBottom:`1px solid ${G.border}15`,
                          borderRight:`1px solid ${G.border}15`,background:i===2?`${G.gold}04`:undefined,
                          verticalAlign:'top',minHeight:36}}>
                          {a&&(
                            <div style={{background:`${a.cor}12`,border:`1px solid ${a.cor}44`,
                              borderRadius:2,padding:'4px 6px',cursor:'pointer'}}>
                              <div style={{fontFamily:'Rajdhani',fontSize:10,color:a.cor,fontWeight:600,
                                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{a.patient}</div>
                              <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,marginTop:1}}>{a.specialty}</div>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ):(
            <div style={{padding:14}}>
              {appts.map((a,i)=>(
                <div key={i} style={{display:'flex',gap:12,alignItems:'center',
                  padding:'10px 0',borderBottom:`1px solid ${G.border}15`,
                  animation:`fadeUp ${0.2+i*0.05}s ease`}}>
                  <div style={{fontFamily:'Orbitron',fontSize:11,color:G.gold,width:45,flexShrink:0}}>
                    {a.time}
                  </div>
                  <div style={{width:36,height:36,borderRadius:'50%',background:`${a.cor}18`,
                    border:`1.5px solid ${a.cor}77`,display:'flex',alignItems:'center',
                    justifyContent:'center',fontFamily:'Cinzel',fontSize:12,color:a.cor,flexShrink:0}}>
                    {a.initials}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:'Rajdhani',fontSize:13,color:G.text,fontWeight:600}}>{a.patient}</div>
                    <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{a.doctor} · {a.specialty} · {a.room}</div>
                  </div>
                  <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,width:70,textAlign:'right'}}>
                    {a.date.split('-').reverse().join('/')}
                  </div>
                  <Badge text={a.status} col={stCol[a.status]||G.dim}/>
                  <Badge text={a.type} col={G.teal} small/>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <Modal open={modalOpen} onClose={()=>setModalOpen(false)} title="NOVA CONSULTA" width={480}>
        <FormRow label="Paciente"><GSelect value={form.patient} onChange={e=>{const p=patients.find(pt=>pt.nome===e.target.value);setForm({...form,patient:e.target.value,initials:(p?.initials||e.target.value.split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase()),cor:p?.cor||G.gold});}} options={['', ...patients.filter(p=>p.tipo==='Paciente').map(p=>p.nome)]}/></FormRow>
        <FormRow label="Médico"><GSelect value={form.doctor} onChange={e=>setForm({...form,doctor:e.target.value})} options={['', ...staff.filter(s=>s.cargo?.toLowerCase().includes('méd')).map(s=>s.nome.length>20?s.nome.split(' ').slice(0,3).join(' '):s.nome)]}/></FormRow>
        <FormRow label="Especialidade"><GInput value={form.specialty} onChange={e=>setForm({...form,specialty:e.target.value})} placeholder="Ex: Cardiologia"/></FormRow>
        <FormRow label="Data"><GInput type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></FormRow>
        <FormRow label="Hora"><GInput type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/></FormRow>
        <FormRow label="Sala"><GSelect value={form.room} onChange={e=>setForm({...form,room:e.target.value})} options={['Consultório 1','Consultório 2','Consultório 3','Consultório 4','Sala Tratamento']}/></FormRow>
        <FormRow label="Tipo"><GSelect value={form.type} onChange={e=>setForm({...form,type:e.target.value})} options={['Consulta','Seguimento','Urgência','Rastreio','ECG','Alta']}/></FormRow>
        <FormRow label="Notas"><GInput value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Observações"/></FormRow>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
          <button onClick={()=>setModalOpen(false)}
            style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:'transparent',
              border:`1px solid ${G.border}`,color:G.dim,borderRadius:1}}>CANCELAR</button>
          <button onClick={saveAppt}
            style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:`${G.gold}18`,
              border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1}}>AGENDAR</button>
        </div>
      </Modal>
    </div>
  </>);
}

/* ═══════════════════════════════════════════════════════════
   PACIENTES — PEP + FILE UPLOAD
═══════════════════════════════════════════════════════════ */
function Pacientes() {
  const {patients,setPatients,prescriptions,labResults,viewPatient3D,addNotification} = useClinic();
  const [sel,setSel]=useState(null);
  const [ptab,setPtab]=useState('info');
  const [noteVal,setNoteVal]=useState('');
  const [vfc,setVfc]=useState('');
  const [vspo2,setVspo2]=useState('');
  const [vpa,setVpa]=useState('');
  const [vtemp,setVtemp]=useState('');
  const [nextAlarm,setNextAlarm]=useState(null);
  const [alarmH,setAlarmH]=useState(2);
  const [search,setSearch]=useState('');
  const [modalOpen,setModalOpen]=useState(false);
  const [form,setForm]=useState({nome:'',idade:'',genero:'M',sangue:'A+',bairro:'',seguro:'',num_seg:'',email:'',num:'',alergia:'',diag:'',diagKey:'',obs:'',peso:'',altura:'',pa:'',fc:'',spo2:'',temp:''});
  const [diagSearch,setDiagSearch]=useState('');
  const [diagSugs,setDiagSugs]=useState([]);

  const P=sel?patients.find(p=>p.id===sel):null;
  const alarmKey = sel?('vital_alarm_'+sel):null;

  useEffect(()=>{
    setNoteVal(P?.obs||'');
    setVfc(P?.fc>0?String(P.fc):'');
    setVspo2(P?.spo2>0?String(P.spo2):'');
    setVpa(P?.pa?String(P.pa):'');
    setVtemp(P?.temp?String(P.temp):'');

    if(!alarmKey){
      setNextAlarm(null);
      return;
    }
    try{
      const raw=localStorage.getItem(alarmKey);
      setNextAlarm(raw?parseInt(raw):null);
    }catch(_){
      setNextAlarm(null);
    }
  },[P?.id,alarmKey]);

  useEffect(()=>{
    if(!nextAlarm||!alarmKey||!P?.nome) return;
    const check=setInterval(()=>{
      if(Date.now()>=nextAlarm){
        addNotification('warn','Atualizar sinais vitais de '+P.nome);
        try{localStorage.removeItem(alarmKey);}catch{}
        setNextAlarm(null);
      }
    },30000);
    return()=>clearInterval(check);
  },[nextAlarm,alarmKey,P,addNotification]);
  const statusCol={Activo:G.green,Atenção:G.amber,'Em Tratamento':G.purple,Serviço:G.blue,'Alta Provisória':G.gold,'Alta Completa':G.gold};
  const filtered = patients.filter(p=>
    p.nome.toLowerCase().includes(search.toLowerCase())||
    (p.diag||'').toLowerCase().includes(search.toLowerCase())
  );

  // Diagnóstico search
  useEffect(()=>{
    if(diagSearch.length<2){setDiagSugs([]);return;}
    const q=diagSearch.toLowerCase();
    setDiagSugs(Object.entries(DISEASES).filter(([k,d])=>
      d.label.toLowerCase().includes(q)||d.cat.toLowerCase().includes(q)
    ).slice(0,8));
  },[diagSearch]);

  const addFile = (file) => setPatients(prev=>prev.map(p=>p.id===sel?{...p,files:[...p.files,file]}:p));
  const removeFile = (fileId) => setPatients(prev=>prev.map(p=>p.id===sel?{...p,files:p.files.filter(f=>f.id!==fileId)}:p));

  const savePatient = () => {
    if(!form.nome.trim()) return;
    setPatients(p=>[...p,{
      ...form,
      id:Date.now(),
      tipo:'Paciente',
      status:'Activo',
      consultas:0,
      ultima:new Date().toLocaleDateString('pt-PT'),
      proxima:'—',
      compras:[],
      files:[],
      fc:parseInt(form.fc)||0,
      spo2:parseInt(form.spo2)||0,
      initials:form.nome.split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase(),
      cor:['#D4AF37','#FF8C00','#00AAFF','#AA55FF','#FF5555','#00CC88','#FFD700','#FF9944'][
        Math.floor(Math.random()*8)
      ]
    }]);
    setModalOpen(false);
    setForm({nome:'',idade:'',genero:'M',sangue:'A+',bairro:'',seguro:'',num_seg:'',email:'',num:'',alergia:'',diag:'',diagKey:'',obs:'',peso:'',altura:'',pa:'',fc:'',spo2:'',temp:''});
  };

  const PTABS=[{id:'info',label:'INFO'},{id:'clinico',label:'CLÍNICO'},
               {id:'ficheiros',label:'FICHEIROS'},
               {id:'historico',label:'HISTÓRICO'},{id:'vitais',label:'VITAIS'}];

  return(
    <div style={{display:'flex',gap:10,height:'100%',padding:10}}>
      {/* List */}
      <div style={{width:240,flexShrink:0,display:'flex',flexDirection:'column',gap:8}}>
        <Panel style={{padding:12}}>
          <SectionHeader title={`PACIENTES (${filtered.length})`} action={()=>setModalOpen(true)} actionLabel="NOVO"/>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="🔍 Pesquisar por nome ou diagnóstico..."
            style={{width:'100%',background:'rgba(212,175,55,0.05)',border:`1px solid ${G.border}`,
              borderRadius:2,padding:'7px 9px',color:G.text,fontFamily:'Rajdhani',fontSize:12}}/>
        </Panel>
        <Panel style={{flex:1,overflow:'auto'}}>
          {patients.length===0?(
            <div style={{padding:20,textAlign:'center'}}>
              <div style={{fontSize:28,opacity:0.15,marginBottom:10}}>◈</div>
              <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.dim,lineHeight:1.6}}>
                Sem pacientes registados.<br/>Clique <b style={{color:G.gold}}>+ NOVO</b> para adicionar.
              </div>
            </div>
          ):filtered.map((p,i)=>(
            <div key={p.id} onClick={()=>{setSel(p.id);setPtab('info');}}
              style={{display:'flex',gap:8,alignItems:'center',padding:'10px 12px',cursor:'pointer',
                background:sel===p.id?`${p.cor}09`:'transparent',
                borderLeft:sel===p.id?`2px solid ${p.cor}`:'2px solid transparent',
                borderBottom:`1px solid ${G.border}15`,transition:'all 0.15s',
                animation:`fadeUp ${0.15+i*0.04}s ease`}}>
              <div style={{width:36,height:36,borderRadius:'50%',flexShrink:0,
                background:`${p.cor}18`,border:`1.5px solid ${p.cor}55`,
                overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',
                fontFamily:'Cinzel',fontSize:12,fontWeight:700,color:p.cor}}>
                {p.avatar?<img src={p.avatar} alt={p.initials} style={{width:'100%',height:'100%',objectFit:'cover'}}/>:p.initials}
              </div>
              <div style={{flex:1,overflow:'hidden'}}>
                <div style={{fontFamily:'Rajdhani',fontSize:12,fontWeight:600,color:G.text,
                  whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.nome}</div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:2}}>
                  <span style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim}}>
                    {p.idade>0?`${p.idade}a · ${p.tipo}`:p.tipo}
                  </span>
                  <Badge text={p.status} col={statusCol[p.status]||G.gold} small/>
                </div>
              </div>
            </div>
          ))}
        </Panel>
      </div>

      {/* Detail */}
      {P?(
        <div style={{flex:1,display:'flex',flexDirection:'column',gap:8,overflow:'hidden'}}>
          {/* Header */}
          <Panel style={{padding:'14px 18px'}}>
            <div style={{display:'flex',gap:14,alignItems:'center'}}>
              <div style={{width:58,height:58,borderRadius:'50%',flexShrink:0,
                background:`${P.cor}18`,border:`2.5px solid ${P.cor}`,
                overflow:'hidden',cursor:'pointer',position:'relative'}}
                onClick={()=>{const input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setPatients(prev=>prev.map(p=>p.id===sel?{...p,avatar:ev.target.result}:p));r.readAsDataURL(f);};input.click();}}
                title="Clique para alterar foto">
                {P.avatar?(
                  <img src={P.avatar} alt={P.nome} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                ):(
                  <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',
                    fontFamily:'Cinzel',fontSize:22,fontWeight:700,color:P.cor}}>{P.initials}</div>
                )}
              </div>
              <div style={{flex:1}}>
                <div style={{fontFamily:'Cinzel',fontSize:15,color:G.text}}>{P.nome}</div>
                <div style={{fontFamily:'Orbitron',fontSize:8,color:G.dim,letterSpacing:1,marginTop:3}}>
                  {P.tipo.toUpperCase()} · {P.sangue!=='—'?`${P.sangue} · `:''}ID#{P.id.toString().padStart(4,'0')}
                </div>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                {P.alergia!=='—'&&P.alergia&&(
                  <div style={{background:'rgba(255,37,37,0.08)',border:'1px solid rgba(255,37,37,0.3)',
                    borderRadius:2,padding:'4px 8px'}}>
                    <span style={{fontFamily:'Orbitron',fontSize:7,color:G.red}}>⚠ ALERGIA: </span>
                    <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.text}}>{P.alergia}</span>
                  </div>
                )}
                <button onClick={()=>{
                    const pwd=prompt('Senha de confirmação para apagar o paciente:');
                    if(pwd==='fumugold2025'){
                      if(confirm(`Confirma apagamento permanente de ${P.nome}?`)){
                        setPatients(prev=>prev.filter(p=>p.id!==sel));
                        setSel(null);
                      }
                    } else if(pwd!==null){
                      alert('Senha incorrecta.');
                    }
                  }}
                  style={{padding:'5px 10px',fontFamily:'Orbitron',fontSize:7,letterSpacing:1,
                    background:'rgba(255,37,37,0.08)',border:'1px solid rgba(255,37,37,0.3)',color:G.red,
                    borderRadius:2,cursor:'pointer'}} title="Apagar paciente">
                  🗑 APAGAR
                </button>
                {P.diagKey&&DISEASES[P.diagKey]&&(
                  <button onClick={()=>viewPatient3D(P)}
                    style={{padding:'5px 12px',fontFamily:'Orbitron',fontSize:7,letterSpacing:1,
                      background:`${G.gold}12`,border:`1px solid ${G.gold}55`,color:G.gold,
                      borderRadius:2,cursor:'pointer',transition:'all 0.2s'}}
                    onMouseEnter={e=>e.currentTarget.style.background=`${G.gold}25`}
                    onMouseLeave={e=>e.currentTarget.style.background=`${G.gold}12`}>
                    ⬡ VER 3D
                  </button>
                )}
                <Badge text={P.status} col={statusCol[P.status]||G.gold}/>
              </div>
            </div>
          </Panel>

          {/* Sub-tabs */}
          <div style={{display:'flex',gap:4}}>
            {PTABS.map(t=>(
              <button key={t.id} onClick={()=>setPtab(t.id)}
                style={{padding:'5px 14px',fontFamily:'Orbitron',fontSize:7,letterSpacing:1.5,
                  background:ptab===t.id?`${G.gold}14`:'transparent',
                  border:`1px solid ${ptab===t.id?G.gold:G.border}`,
                  color:ptab===t.id?G.gold:G.dim,borderRadius:1,
                  ...(t.id==='ficheiros'&&P.files&&P.files.length>0?{borderColor:G.teal,color:ptab===t.id?G.teal:G.dim}:{})}}>
                {t.label} {t.id==='ficheiros'&&P.files&&P.files.length>0?`(${P.files.length})`:''}
              </button>
            ))}
          </div>

          <div style={{flex:1,overflow:'auto'}}>
            {ptab==='info'&&(
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <Panel style={{padding:14}}>
                  <SectionHeader title="DADOS PESSOAIS"/>
                  {[['Nome',P.nome],['Idade',`${P.idade} anos`],['Género',P.genero==='F'?'Feminino':'Masculino'],
                    ['Grupo Sangue',P.sangue],['Bairro',P.bairro],['Telefone',P.num],['Email',P.email]
                  ].map(([l,v])=>(
                    <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:`1px solid ${G.border}15`}}>
                      <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{l}</span>
                      <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.text,textAlign:'right',maxWidth:'60%'}}>{v}</span>
                    </div>
                  ))}
                </Panel>
                <Panel style={{padding:14}}>
                  <SectionHeader title="SEGURO & COBERTURA"/>
                  {[['Seguradora',P.seguro],['Nº Apólice',P.num_seg],
                    ['Peso',P.peso!=='—'?`${P.peso} kg`:'—'],['Altura',P.altura!=='—'?`${P.altura} cm`:'—'],
                    ['IMC',P.peso!=='—'&&P.altura!=='—'?`${(parseFloat(P.peso)/Math.pow(parseFloat(P.altura)/100,2)).toFixed(1)} kg/m²`:'—'],
                  ].map(([l,v])=>(
                    <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:`1px solid ${G.border}15`}}>
                      <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{l}</span>
                      <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.text}}>{v}</span>
                    </div>
                  ))}
                  <div style={{marginTop:10,padding:8,background:'rgba(212,175,55,0.04)',borderRadius:2,
                    fontFamily:'Rajdhani',fontSize:11,color:G.dim,lineHeight:1.5}}>{P.obs}</div>
                </Panel>
                <Panel style={{padding:14,gridColumn:'1/-1'}}>
                  <SectionHeader title="PRESCRIÇÕES ACTIVAS"/>
                  <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                    {prescriptions.filter(rx=>rx.patient===P.nome&&rx.status==='Activa').map((rx,i)=>(
                      <div key={i} style={{background:'rgba(212,175,55,0.06)',border:`1px solid ${G.border}`,
                        borderRadius:2,padding:'6px 10px'}}>
                        <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,fontWeight:600}}>{rx.med}</div>
                        <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,marginTop:2}}>{rx.dose} · {rx.via}</div>
                      </div>
                    ))}
                    {prescriptions.filter(rx=>rx.patient===P.nome).length===0&&(
                      <span style={{fontFamily:'Rajdhani',fontSize:12,color:G.dim}}>Sem prescrições activas</span>
                    )}
                  </div>
                </Panel>
              </div>
            )}

            {ptab==='clinico'&&(
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <Panel style={{padding:14}}>
                  <SectionHeader title="DIAGNÓSTICO & CONSULTAS"/>
                  {[['Diagnóstico Principal',P.diag],['Última Consulta',P.ultima],
                    ['Próxima Consulta',P.proxima],[`Nº Consultas`,`${P.consultas} registadas`]
                  ].map(([l,v])=>(
                    <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:`1px solid ${G.border}15`}}>
                      <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{l}</span>
                      <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.text,textAlign:'right',maxWidth:'60%',lineHeight:1.3}}>{v}</span>
                    </div>
                  ))}
                </Panel>
                <Panel style={{padding:14}}>
                  <SectionHeader title="ÚLTIMOS RESULTADOS"/>
                  {labResults.filter(r=>r.patient===P.nome).slice(0,2).map((r,i)=>(
                    <div key={i} style={{padding:'8px 0',borderBottom:`1px solid ${G.border}15`}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                        <span style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,fontWeight:600}}>{r.exam}</span>
                        <Badge text={r.alert?'⚠ ALERTA':'Normal'} col={r.alert?G.red:G.green} small/>
                      </div>
                      <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>{r.date}</div>
                    </div>
                  ))}
                  {labResults.filter(r=>r.patient===P.nome).length===0&&(
                    <span style={{fontFamily:'Rajdhani',fontSize:12,color:G.dim}}>Sem resultados</span>
                  )}
                </Panel>
                <Panel style={{padding:14,gridColumn:'1/-1'}}>
                  <SectionHeader title="NOTAS CLÍNICAS"/>
                  <>
                    <textarea value={noteVal} onChange={e=>setNoteVal(e.target.value)} rows={5}
                      style={{width:'100%',background:'rgba(212,175,55,0.04)',border:`1px solid ${G.border}`,
                        borderRadius:2,padding:10,color:G.text,fontFamily:'Rajdhani',fontSize:12,
                        lineHeight:1.6,resize:'vertical',marginBottom:8}}/>
                    <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                      <button onClick={()=>setPatients(prev=>prev.map(p=>p.id===sel?{...p,obs:noteVal}:p))}
                        style={{fontFamily:'Orbitron',fontSize:7,padding:'6px 16px',background:`${G.gold}18`,
                          border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1,cursor:'pointer'}}>
                        GUARDAR NOTAS
                      </button>
                    </div>
                  </>
                </Panel>
              </div>
            )}

            {ptab==='ficheiros'&&(
              <Panel style={{padding:14}}>
                <SectionHeader title="FICHEIROS DO PACIENTE"/>
                <div style={{marginBottom:10,fontFamily:'Rajdhani',fontSize:12,color:G.dim,lineHeight:1.6}}>
                  Carregue imagens, PDFs, resultados de exames, RX, TAC e outros documentos clínicos.
                </div>
                <FileUploader
                  files={P.files||[]}
                  onAdd={addFile}
                  onRemove={removeFile}
                />
              </Panel>
            )}

            {ptab==='historico'&&(
              <Panel style={{padding:14}}>
                <SectionHeader title="HISTÓRICO CLÍNICO"/>
                <div style={{position:'relative',paddingLeft:20}}>
                  <div style={{position:'absolute',left:6,top:0,bottom:0,width:1,background:G.border}}/>
                  {[
                    {date:P.ultima,title:'Última consulta — '+P.diag,desc:P.obs,col:G.gold},
                    {date:'15/01/2025',title:'Análises laboratoriais',desc:'Resultados dentro dos parâmetros de controlo esperados.',col:G.teal},
                    {date:'10/12/2024',title:'Consulta de rotina',desc:'Avaliação de resposta terapêutica. Sem intercorrências.',col:G.green},
                    {date:'05/11/2024',title:'Prescrição renovada',desc:`Renovação de medicação crónica por ${P.consultas} meses.`,col:G.amber},
                  ].map((ev,i)=>(
                    <div key={i} style={{position:'relative',paddingBottom:16,paddingLeft:16,
                      animation:`fadeUp ${0.2+i*0.08}s ease`}}>
                      <div style={{position:'absolute',left:-2,top:3,width:9,height:9,borderRadius:'50%',
                        background:ev.col,boxShadow:`0 0 6px ${ev.col}`,zIndex:1}}/>
                      <div style={{fontFamily:'Orbitron',fontSize:8,color:ev.col,marginBottom:3}}>{ev.date}</div>
                      <div style={{fontFamily:'Rajdhani',fontSize:13,color:G.text,fontWeight:600,marginBottom:4}}>{ev.title}</div>
                      <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,lineHeight:1.5}}>{ev.desc}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            )}

            {ptab==='vitais'&&(
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {P.fc>0?(
                  <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10}}>
                    {[['Frequência Cardíaca',`${P.fc} BPM`,G.green,'normal'],
                      ['SpO₂',`${P.spo2}%`,P.spo2>=95?G.green:G.red,P.spo2>=95?'normal':'crítico'],
                      ['Pressão Arterial',P.pa||'—',G.amber,'reg.'],
                      ['Temperatura',P.temp?`${P.temp} °C`:'—',G.green,'normal'],
                    ].map(([l,v,c,s])=>(
                      <Panel key={l} style={{padding:16}}>
                        <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,marginBottom:6}}>{l}</div>
                        <div style={{fontFamily:'Orbitron',fontSize:26,fontWeight:700,color:c,lineHeight:1}}>{v}</div>
                        <div style={{marginTop:8}}><Badge text={s} col={c}/></div>
                        <div style={{marginTop:8}}><VitalWave color={c} amp={0.8} h={35}/></div>
                      </Panel>
                    ))}
                  </div>
                ):(
                  <Panel style={{padding:16}}>
                    <div style={{fontFamily:'Cinzel',fontSize:10,color:G.dim,marginBottom:12}}>ACTUALIZAR SINAIS VITAIS</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                      <FormRow label="FC (bpm)"><GInput type="number" value={vfc} onChange={e=>setVfc(e.target.value)} placeholder="72"/></FormRow>
                      <FormRow label="SpO2 (%)"><GInput type="number" value={vspo2} onChange={e=>setVspo2(e.target.value)} placeholder="98"/></FormRow>
                      <FormRow label="PA (mmHg)"><GInput value={vpa} onChange={e=>setVpa(e.target.value)} placeholder="120/80"/></FormRow>
                      <FormRow label="Temp C"><GInput value={vtemp} onChange={e=>setVtemp(e.target.value)} placeholder="36.5"/></FormRow>
                      <div style={{gridColumn:'1/-1',textAlign:'right'}}>
                        <button onClick={()=>{if(!vfc)return;setPatients(prev=>prev.map(p=>p.id===sel?{...p,fc:parseInt(vfc),spo2:parseInt(vspo2)||0,pa:vpa,temp:vtemp}:p));}}
                          style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:`${G.gold}18`,border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1,cursor:'pointer'}}>
                          REGISTAR VITAIS
                        </button>
                      </div>
                    </div>
                  </Panel>
                )}
                {/* Vitals alarm */}
                <Panel style={{padding:14}}>
                  <div style={{fontFamily:'Cinzel',fontSize:9,color:G.gold,letterSpacing:2,marginBottom:10}}>⏰ ALARME DE ACTUALIZAÇÃO</div>
                  <>
                    <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
                      <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>Proximo alarme em</span>
                      <GSelect value={alarmH} onChange={e=>setAlarmH(parseInt(e.target.value)||2)} options={[1,2,3,4,6,8,12,24].map(h=>({v:h,l:`${h}h`}))}/>
                      <button onClick={()=>{
                        const t=Date.now()+alarmH*3600000;
                        if(alarmKey){
                          try{localStorage.setItem(alarmKey,t);}catch{}
                        }
                        setNextAlarm(t);
                        addNotification('info','Alarme de vitais de '+P.nome+' em '+alarmH+'h');
                      }}
                        style={{fontFamily:'Orbitron',fontSize:7,padding:'5px 12px',background:`${G.teal}14`,
                          border:`1px solid ${G.teal}`,color:G.teal,borderRadius:1,cursor:'pointer'}}>
                        ACTIVAR
                      </button>
                    </div>
                    {nextAlarm&&<div style={{fontFamily:'Rajdhani',fontSize:11,color:G.green,padding:'6px 8px',background:`${G.green}08`,borderRadius:2}}>
                      Alarme as {new Date(nextAlarm).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})}
                    </div>}
                  </>
                </Panel>
              </div>
            )}
          </div>
        </div>
      ):(
        <Panel style={{flex:1,display:'flex',flexDirection:'column',justifyContent:'center',
          alignItems:'center',textAlign:'center',padding:20}}>
          <div style={{fontSize:40,opacity:0.1,marginBottom:14}}>◈</div>
          <div style={{fontFamily:'Cinzel',fontSize:11,color:G.dim,lineHeight:1.8}}>
            Seleccione um paciente para ver o perfil completo
          </div>
        </Panel>
      )}

      <Modal open={modalOpen} onClose={()=>setModalOpen(false)} title="NOVO PACIENTE" width={560}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
          <div style={{gridColumn:'1/-1'}}>
            <FormRow label="Nome Completo *"><GInput value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})} placeholder="Nome completo do paciente"/></FormRow>
          </div>
          <div>
            <FormRow label="Idade"><GInput type="number" value={form.idade} onChange={e=>setForm({...form,idade:e.target.value})} placeholder="Anos"/></FormRow>
          </div>
          <div>
            <FormRow label="Género"><GSelect value={form.genero} onChange={e=>setForm({...form,genero:e.target.value})} options={['M','F']}/></FormRow>
          </div>
          <div>
            <FormRow label="Grupo Sanguíneo"><GSelect value={form.sangue} onChange={e=>setForm({...form,sangue:e.target.value})} options={['A+','A-','B+','B-','AB+','AB-','O+','O-','?']}/></FormRow>
          </div>
          <div>
            <FormRow label="Telefone"><GInput value={form.num} onChange={e=>setForm({...form,num:e.target.value})} placeholder="+244 ..."/></FormRow>
          </div>
        </div>
        <FormRow label="Email"><GInput value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="email@..."/></FormRow>
        <FormRow label="Bairro / Município"><GInput value={form.bairro} onChange={e=>setForm({...form,bairro:e.target.value})} placeholder="Bairro, Luanda"/></FormRow>
        <FormRow label="Seguro / Número"><GInput value={form.seguro} onChange={e=>setForm({...form,seguro:e.target.value})} placeholder="ENSA, INSS, AAA..."/></FormRow>
        <FormRow label="Alergias"><GInput value={form.alergia} onChange={e=>setForm({...form,alergia:e.target.value})} placeholder="Penicilina, AINEs... (ou deixar vazio)"/></FormRow>

        {/* Diagnosis with searchable disease list */}
        <FormRow label="Diagnóstico Principal">
          <div style={{position:'relative'}}>
            <input value={diagSearch||form.diag} onChange={e=>{setDiagSearch(e.target.value);setForm({...form,diag:e.target.value,diagKey:''});}}
              placeholder="Pesquisar diagnóstico (ex: malária, diabetes...)"
              style={{width:'100%',background:'rgba(212,175,55,0.05)',border:`1px solid ${G.border}`,
                borderRadius:2,padding:'7px 9px',color:G.text,fontFamily:'Rajdhani',fontSize:12}}/>
            {diagSugs.length>0&&(
              <div style={{position:'absolute',top:'100%',left:0,right:0,background:'#0D0900',
                border:`1px solid ${G.border}`,zIndex:300,maxHeight:180,overflowY:'auto',
                boxShadow:'0 8px 24px rgba(0,0,0,0.9)'}}>
                {diagSugs.map(([k,d])=>(
                  <div key={k} onMouseDown={()=>{
                    setForm({...form,diag:d.label,diagKey:k});
                    setDiagSearch(d.label);
                    setDiagSugs([]);
                  }}
                    style={{padding:'7px 10px',cursor:'pointer',borderBottom:`1px solid ${G.border}15`,
                      display:'flex',alignItems:'center',gap:8}}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(212,175,55,0.1)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{width:6,height:6,borderRadius:'50%',background:d.sevC,flexShrink:0}}/>
                    <div>
                      <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text}}>{d.label}</div>
                      <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>{d.cat}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </FormRow>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,marginTop:4}}>
          <FormRow label="PA (mmHg)"><GInput value={form.pa} onChange={e=>setForm({...form,pa:e.target.value})} placeholder="120/80"/></FormRow>
          <FormRow label="FC (bpm)"><GInput type="number" value={form.fc} onChange={e=>setForm({...form,fc:e.target.value})} placeholder="72"/></FormRow>
          <FormRow label="SpO₂ (%)"><GInput type="number" value={form.spo2} onChange={e=>setForm({...form,spo2:e.target.value})} placeholder="98"/></FormRow>
          <FormRow label="Temp °C"><GInput value={form.temp} onChange={e=>setForm({...form,temp:e.target.value})} placeholder="36.5"/></FormRow>
        </div>

        <FormRow label="Observações Clínicas">
          <textarea value={form.obs} onChange={e=>setForm({...form,obs:e.target.value})} rows={3}
            placeholder="Observações, história clínica, notas..."
            style={{width:'100%',background:'rgba(212,175,55,0.05)',border:`1px solid ${G.border}`,
              borderRadius:2,padding:'7px 9px',color:G.text,fontFamily:'Rajdhani',fontSize:12,
              resize:'vertical',minHeight:56}}/>
        </FormRow>

        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
          <button onClick={()=>{setModalOpen(false);setDiagSugs([]);}}
            style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:'transparent',
              border:`1px solid ${G.border}`,color:G.dim,borderRadius:1}}>CANCELAR</button>
          <button onClick={savePatient} disabled={!form.nome.trim()}
            style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:`${G.gold}18`,
              border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1,
              opacity:form.nome.trim()?1:0.4}}>◈ REGISTAR PACIENTE</button>
        </div>
      </Modal>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PRESCRIÇÕES
═══════════════════════════════════════════════════════════ */
function Prescricoes() {
  const {prescriptions:rxs,setPrescriptions:setRxs,patients,addNotification,staff,setStock} = useClinic();
  const [modalOpen,setModalOpen]=useState(false);
  const [form,setForm]=useState({patient:'',med:'',dose:'',via:'Oral',duracao:'30 dias',medico:''});
  const [filter,setFilter]=useState('all');

  const INTERACTIONS = [
    {meds:['Metformina','Losartan'],level:'baixo',desc:'Possível potenciação do efeito hipoglicémico'},
    {meds:['Atorvastatina','AAS'],level:'baixo',desc:'Risco aumentado de miopatia — monitorizar CPK'},
    {meds:['Metotrexato','AINEs'],level:'alto',desc:'⚠ CONTRAINDICADO — toxicidade MTX aumentada'},
  ];

  const filtered = filter==='all'?rxs:rxs.filter(r=>r.status===filter);

  const saveRx = () => {
    if(!form.patient||!form.med)return;
    const pid = patients.find((x)=>String(x.nome||'').trim()===String(form.patient||'').trim())?.id ?? null;
    setRxs(p=>[...p,{...form,id:Date.now(),patient_id:pid,data:new Date().toLocaleDateString('pt-PT'),status:'Activa',renovavel:true}]);
    const token = String(form.med).split(/[\s,]+/)[0].toLowerCase();
    if (token && setStock) {
      setStock((prev) => prev.map((s) => {
        const nm = String(s.nome || '').toLowerCase();
        if (!nm.includes(token) && !(token.length > 3 && nm.startsWith(token.slice(0, 4)))) return s;
        const nq = Math.max(0, (Number(s.qty) || 0) - 1);
        if (nq < (Number(s.minQty) || 0)) addNotification('alerta', `Stock baixo: ${s.nome} (restam ${nq})`);
        return { ...s, qty: nq };
      }));
    }
    addNotification('info',`Nova prescrição: ${form.med} para ${form.patient}`);
    setModalOpen(false);
    setForm({patient:'',med:'',dose:'',via:'Oral',duracao:'30 dias',medico:''});
  };

  return(
    <div style={{display:'flex',gap:10,height:'100%',padding:10}}>
      <div style={{flex:1,display:'flex',flexDirection:'column',gap:10,overflow:'hidden'}}>
        <Panel style={{padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <SectionHeader title={`RECEITUÁRIO (${rxs.length})`}/>
            <div style={{display:'flex',gap:6}}>
              {['all','Activa','Expirada'].map(f=>(
                <button key={f} onClick={()=>setFilter(f)}
                  style={{fontFamily:'Orbitron',fontSize:7,padding:'4px 10px',
                    background:filter===f?`${G.gold}14`:'transparent',
                    border:`1px solid ${filter===f?G.gold:G.border}`,
                    color:filter===f?G.gold:G.dim,borderRadius:1}}>
                  {f==='all'?'TODAS':f.toUpperCase()}
                </button>
              ))}
              <button onClick={()=>setModalOpen(true)}
                style={{fontFamily:'Orbitron',fontSize:7,padding:'4px 12px',background:`${G.gold}14`,
                  border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1}}>+ NOVA</button>
            </div>
          </div>
          <div style={{overflowX:'auto',overflowY:'auto',maxHeight:'calc(100vh - 280px)'}}>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead style={{position:'sticky',top:0,zIndex:10,background:'#080500'}}>
                <tr>
                  {['Paciente','Medicamento','Dose','Via','Duração','Médico','Data','Estado'].map(h=>(
                    <th key={h} style={{padding:'6px 8px',fontFamily:'Orbitron',fontSize:7,color:G.dim,
                      letterSpacing:1,textAlign:'left',borderBottom:`1px solid ${G.border}`,
                      whiteSpace:'nowrap',background:'#080500'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((rx,i)=>(
                  <tr key={i} style={{animation:`fadeUp ${0.2+i*0.04}s ease`}}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(212,175,55,0.04)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{padding:'8px',fontFamily:'Rajdhani',fontSize:12,color:G.text,borderBottom:`1px solid ${G.border}10`}}>{rx.patient}</td>
                    <td style={{padding:'8px',fontFamily:'Rajdhani',fontSize:12,color:G.goldL,fontWeight:600,borderBottom:`1px solid ${G.border}10`}}>{rx.med}</td>
                    <td style={{padding:'8px',fontFamily:'Rajdhani',fontSize:11,color:G.dim,borderBottom:`1px solid ${G.border}10`}}>{rx.dose}</td>
                    <td style={{padding:'8px',borderBottom:`1px solid ${G.border}10`}}><Badge text={rx.via} col={G.teal} small/></td>
                    <td style={{padding:'8px',fontFamily:'Rajdhani',fontSize:11,color:G.dim,borderBottom:`1px solid ${G.border}10`}}>{rx.duracao}</td>
                    <td style={{padding:'8px',fontFamily:'Rajdhani',fontSize:11,color:G.dim,borderBottom:`1px solid ${G.border}10`}}>{rx.medico}</td>
                    <td style={{padding:'8px',fontFamily:'Orbitron',fontSize:8,color:G.dim,borderBottom:`1px solid ${G.border}10`}}>{rx.data}</td>
                    <td style={{padding:'8px',borderBottom:`1px solid ${G.border}10`}}>
                      <div style={{display:'flex',gap:4,alignItems:'center'}}>
                        <Badge text={rx.status} col={rx.status==='Activa'?G.green:G.dim} small/>
                        {rx.renovavel&&<Badge text="↺" col={G.gold} small/>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div style={{width:240,flexShrink:0,display:'flex',flexDirection:'column',gap:10}}>
        <Panel style={{padding:14}}>
          <SectionHeader title="INTERACÇÕES"/>
          {INTERACTIONS.map((it,i)=>(
            <div key={i} style={{padding:'8px 0',borderBottom:`1px solid ${G.border}15`}}>
              <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:4}}>
                <Badge text={it.level==='alto'?'⚠ ALTO':'BAIXO'} col={it.level==='alto'?G.red:G.amber} small/>
              </div>
              <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.teal,marginBottom:2}}>
                {it.meds.join(' + ')}
              </div>
              <div style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim,lineHeight:1.4}}>{it.desc}</div>
            </div>
          ))}
        </Panel>
        <Panel style={{padding:14}}>
          <SectionHeader title="ESTATÍSTICAS"/>
          <BarChart data={[
            {label:'Oral',val:12,col:G.gold},{label:'SC/IM',val:4,col:G.teal},
            {label:'Inal.',val:2,col:G.green},{label:'Tóp.',val:1,col:G.purple},
          ]} h={50}/>
        </Panel>
        <Panel style={{padding:14}}>
          <SectionHeader title="RENOVAÇÕES"/>
          {rxs.filter(r=>r.renovavel&&r.status==='Activa').slice(0,4).map((r,i)=>(
            <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'5px 0',borderBottom:`1px solid ${G.border}15`}}>
              <div style={{overflow:'hidden',flex:1,marginRight:8}}>
                <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.text,
                  overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.med}</div>
                <div style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim}}>{r.patient}</div>
              </div>
              <button style={{fontFamily:'Orbitron',fontSize:7,padding:'3px 8px',
                background:`${G.gold}14`,border:`1px solid ${G.gold}44`,color:G.gold,borderRadius:1}}>
                ↺
              </button>
            </div>
          ))}
        </Panel>
      </div>

      <Modal open={modalOpen} onClose={()=>setModalOpen(false)} title="NOVA PRESCRIÇÃO" width={460}>
        <FormRow label="Paciente"><GSelect value={form.patient} onChange={e=>setForm({...form,patient:e.target.value})} options={['',  ...patients.filter(p=>p.tipo==='Paciente').map(p=>p.nome)]}/></FormRow>
        <FormRow label="Medicamento"><GInput value={form.med} onChange={e=>setForm({...form,med:e.target.value})} placeholder="Nome + dose (ex: Amlodipina 10mg)"/></FormRow>
        <FormRow label="Posologia"><GInput value={form.dose} onChange={e=>setForm({...form,dose:e.target.value})} placeholder="Ex: 1cp 2x/dia"/></FormRow>
        <FormRow label="Via"><GSelect value={form.via} onChange={e=>setForm({...form,via:e.target.value})} options={['Oral','IV','SC','IM','Inalatório','Tópico','Sublingual','Rectal']}/></FormRow>
        <FormRow label="Duração"><GSelect value={form.duracao} onChange={e=>setForm({...form,duracao:e.target.value})} options={['7 dias','10 dias','14 dias','21 dias','30 dias','60 dias','90 dias','Indefinido']}/></FormRow>
        <FormRow label="Médico"><GSelect value={form.medico} onChange={e=>setForm({...form,medico:e.target.value})} options={['Dra. M. Oliveira','Dr. A. Ngola']}/></FormRow>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
          <button onClick={()=>setModalOpen(false)} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:'transparent',border:`1px solid ${G.border}`,color:G.dim,borderRadius:1}}>CANCELAR</button>
          <button onClick={saveRx} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:`${G.gold}18`,border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1}}>PRESCREVER</button>
        </div>
      </Modal>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   LABORATÓRIO
═══════════════════════════════════════════════════════════ */
function Laboratorio() {
  const {labResults:results,setLabResults:setResults,patients,addNotification} = useClinic();
  const [sel,setSel]=useState(null);
  const [modalOpen,setModalOpen]=useState(false);
  const [form,setForm]=useState({patient:'',exam:'',date:new Date().toLocaleDateString('pt-PT')});

  const R=sel?results.find(r=>r.id===sel):null;

  return(
    <div style={{display:'flex',gap:10,height:'100%',padding:10}}>
      <div style={{flex:1,overflow:'auto'}}>
        <Panel style={{padding:14,marginBottom:10}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <SectionHeader title={`LABORATÓRIO & EXAMES (${results.length})`}/>
            <button onClick={()=>setModalOpen(true)}
              style={{fontFamily:'Orbitron',fontSize:7,padding:'4px 12px',background:`${G.gold}14`,
                border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1}}>+ PEDIDO</button>
          </div>
        </Panel>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:10}}>
          {results.map((r,i)=>(
            <Panel key={i} style={{padding:14,cursor:'pointer',
              border:`1px solid ${sel===r.id?G.gold:r.alert?`${G.red}44`:G.border}`,
              background:sel===r.id?`${G.gold}06`:r.alert?`${G.red}04`:undefined,
              animation:`fadeUp ${0.2+i*0.05}s ease`}}
              onClick={()=>setSel(sel===r.id?null:r.id)}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                <div>
                  <div style={{fontFamily:'Rajdhani',fontSize:13,color:G.text,fontWeight:600,marginBottom:2}}>{r.exam}</div>
                  <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{r.patient}</div>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}>
                  <Badge text={r.alert?'⚠ ALERTA':'Normal'} col={r.alert?G.red:G.green} small/>
                  <Badge text={r.status} col={G.teal} small/>
                </div>
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                {Object.entries(r.resultado).slice(0,3).map(([k,v])=>(
                  <div key={k} style={{background:'rgba(212,175,55,0.06)',border:`1px solid ${G.border}`,
                    borderRadius:2,padding:'3px 7px'}}>
                    <span style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>{k}: </span>
                    <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.text,fontWeight:600}}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,marginTop:8}}>{r.date}</div>
            </Panel>
          ))}
        </div>
      </div>

      {/* Detail */}
      {R&&(
        <div style={{width:270,flexShrink:0,display:'flex',flexDirection:'column',gap:8}}>
          <Panel style={{padding:14,animation:'fadeUp 0.25s ease'}}>
            <div style={{fontFamily:'Cinzel',fontSize:11,color:G.goldL,marginBottom:4}}>{R.exam}</div>
            <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,marginBottom:10}}>{R.patient} · {R.date}</div>
            {R.alert&&<div style={{background:'rgba(255,37,37,0.08)',border:'1px solid rgba(255,37,37,0.3)',
              borderRadius:2,padding:'6px 10px',marginBottom:10,fontFamily:'Orbitron',fontSize:8,color:G.red}}>
              ⚠ VALORES FORA DO INTERVALO DE REFERÊNCIA
            </div>}
            <div style={{fontFamily:'Cinzel',fontSize:8,color:G.gold,letterSpacing:2,marginBottom:8}}>⬡ RESULTADOS</div>
            {Object.entries(R.resultado).map(([k,v])=>{
              const ref=R.ref[k];
              return(
                <div key={k} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                  padding:'6px 0',borderBottom:`1px solid ${G.border}15`}}>
                  <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{k}</span>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontFamily:'Orbitron',fontSize:11,color:G.text,fontWeight:700}}>{v}</div>
                    {ref&&<div style={{fontFamily:'Rajdhani',fontSize:9,color:G.dim}}>Ref: {ref}</div>}
                  </div>
                </div>
              );
            })}
          </Panel>
          <Panel style={{padding:12}}>
            <div style={{fontFamily:'Cinzel',fontSize:8,color:G.dim,letterSpacing:2,marginBottom:6}}>TENDÊNCIA</div>
            <VitalWave color={R.alert?G.red:G.green} amp={R.alert?1.3:0.8} h={40}/>
          </Panel>
        </div>
      )}

      <Modal open={modalOpen} onClose={()=>setModalOpen(false)} title="PEDIDO DE EXAME" width={440}>
        <FormRow label="Paciente"><GSelect value={form.patient} onChange={e=>setForm({...form,patient:e.target.value})} options={['', ...patients.filter(p=>p.tipo==='Paciente').map(p=>p.nome)]}/></FormRow>
        <FormRow label="Exame"><GSelect value={form.exam} onChange={e=>setForm({...form,exam:e.target.value})} options={['Hemograma Completo','Perfil Lipídico','HbA1c','Função Renal','Função Hepática','Marcadores Inflamatórios','Espirometria','ECG','Rx Tórax','Ecografia Abdominal','TAC','RMN']}/></FormRow>
        <FormRow label="Data"><GInput type="date" value={form.date||new Date().toISOString().split('T')[0]} onChange={e=>setForm({...form,date:e.target.value})}/></FormRow>
        <FormRow label="Urgência"><GSelect value={form.urg||'Normal'} onChange={e=>setForm({...form,urg:e.target.value})} options={['Normal','Urgente','Emergência']}/></FormRow>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
          <button onClick={()=>setModalOpen(false)} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:'transparent',border:`1px solid ${G.border}`,color:G.dim,borderRadius:1}}>CANCELAR</button>
          <button onClick={()=>{if(!form.patient||!form.exam)return;const d=form.date||new Date().toISOString().split('T')[0];const parts=d.split('-');const fmtDate=parts.length===3?`${parts[2]}/${parts[1]}/${parts[0]}`:d;const pid=patients.find((x)=>String(x.nome||'').trim()===String(form.patient||'').trim())?.id??null;setResults(p=>[...p,{id:Date.now(),patient:form.patient,patient_id:pid,exam:form.exam,date:fmtDate,status:'Pendente',urg:form.urg||'Normal',resultado:{},ref:{},alert:false}]);addNotification('info',`Pedido de ${form.exam} para ${form.patient}`);setModalOpen(false);setForm({patient:'',exam:'',date:new Date().toISOString().split('T')[0]});}} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:`${G.gold}18`,border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1}}>SOLICITAR</button>
        </div>
      </Modal>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   FINANCEIRO & FATURAÇÃO
═══════════════════════════════════════════════════════════ */
function Financeiro() {
  const {invoices:invs,setInvoices:setInvs,patients} = useClinic();
  const [sel,setSel]=useState(null);
  const [modalOpen,setModalOpen]=useState(false);

  const total = invs.reduce((s,i)=>s+i.total,0);
  const pago = invs.reduce((s,i)=>s+i.pago,0);
  const pendente = invs.reduce((s,i)=>s+i.pendente,0);

  const fmt = n => n.toLocaleString('pt-AO')+' AOA';
  const stCol={Pago:G.green,Pendente:G.red,Parcial:G.amber};
  const I=sel?invs.find(i=>i.id===sel):null;

  return(
    <div style={{display:'flex',gap:10,height:'100%',padding:10}}>
      <div style={{flex:1,display:'flex',flexDirection:'column',gap:10,overflow:'hidden'}}>
        <div style={{display:'flex',gap:8}}>
          <StatCard label="Total Faturado" val={`${(total/1000).toFixed(0)}K`} sub="AOA" ic="💰" col={G.gold} i={0}/>
          <StatCard label="Total Recebido" val={`${(pago/1000).toFixed(0)}K`} sub="AOA" ic="✅" col={G.green} i={1}/>
          <StatCard label="Pendente" val={`${(pendente/1000).toFixed(0)}K`} sub="AOA" ic="⏳" col={G.amber} i={2}/>
          <StatCard label="Faturas" val={invs.length} sub={`${invs.filter(i=>i.status==='Pendente').length} pendentes`} ic="📄" col={G.teal} i={3}/>
        </div>

        <Panel style={{padding:14,flex:1,overflow:'auto'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <SectionHeader title="FATURAS"/>
            <button onClick={()=>setModalOpen(true)}
              style={{fontFamily:'Orbitron',fontSize:7,padding:'4px 12px',background:`${G.gold}14`,
                border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1,marginBottom:12}}>+ EMITIR</button>
          </div>
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead>
              <tr>
                {['Nº Fatura','Paciente','Data','Total','Seguro','Pago','Pendente','Estado'].map(h=>(
                  <th key={h} style={{padding:'6px 10px',fontFamily:'Orbitron',fontSize:7,color:G.dim,
                    textAlign:'left',borderBottom:`1px solid ${G.border}`,letterSpacing:1}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invs.map((inv,i)=>(
                <tr key={i} onClick={()=>setSel(sel===inv.id?null:inv.id)}
                  style={{cursor:'pointer',animation:`fadeUp ${0.2+i*0.05}s ease`,
                    background:sel===inv.id?`${G.gold}07`:'transparent'}}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(212,175,55,0.04)'}
                  onMouseLeave={e=>e.currentTarget.style.background=sel===inv.id?`${G.gold}07`:'transparent'}>
                  <td style={{padding:'9px 10px',fontFamily:'Orbitron',fontSize:9,color:G.gold,borderBottom:`1px solid ${G.border}10`}}>{inv.id}</td>
                  <td style={{padding:'9px 10px',fontFamily:'Rajdhani',fontSize:12,color:G.text,borderBottom:`1px solid ${G.border}10`}}>{inv.patient}</td>
                  <td style={{padding:'9px 10px',fontFamily:'Orbitron',fontSize:8,color:G.dim,borderBottom:`1px solid ${G.border}10`}}>{inv.date}</td>
                  <td style={{padding:'9px 10px',fontFamily:'Rajdhani',fontSize:12,color:G.text,fontWeight:600,borderBottom:`1px solid ${G.border}10`}}>{fmt(inv.total)}</td>
                  <td style={{padding:'9px 10px',fontFamily:'Rajdhani',fontSize:11,color:G.dim,borderBottom:`1px solid ${G.border}10`}}>{inv.seguro}</td>
                  <td style={{padding:'9px 10px',fontFamily:'Rajdhani',fontSize:12,color:G.green,borderBottom:`1px solid ${G.border}10`}}>{fmt(inv.pago)}</td>
                  <td style={{padding:'9px 10px',fontFamily:'Rajdhani',fontSize:12,color:inv.pendente>0?G.amber:G.green,borderBottom:`1px solid ${G.border}10`}}>{fmt(inv.pendente)}</td>
                  <td style={{padding:'9px 10px',borderBottom:`1px solid ${G.border}10`}}><Badge text={inv.status} col={stCol[inv.status]||G.dim}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div style={{width:240,flexShrink:0,display:'flex',flexDirection:'column',gap:10}}>
        {I?(
          <Panel style={{padding:14,animation:'fadeUp 0.25s ease'}}>
            <div style={{fontFamily:'Cinzel',fontSize:11,color:G.gold,marginBottom:3}}>{I.id}</div>
            <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,marginBottom:8}}>{I.patient}</div>
            <Badge text={I.status} col={stCol[I.status]||G.dim}/>
            <div style={{marginTop:12,fontFamily:'Cinzel',fontSize:8,color:G.dim,letterSpacing:2,marginBottom:6}}>ITENS</div>
            {I.items.map((item,j)=>(
              <div key={j} style={{display:'flex',gap:6,padding:'4px 0',borderBottom:`1px solid ${G.border}15`}}>
                <Dot col={G.gold}/>
                <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{item}</span>
              </div>
            ))}
            <div style={{marginTop:12}}>
              {[['Total',fmt(I.total),G.gold],['Pago',fmt(I.pago),G.green],['Pendente',fmt(I.pendente),I.pendente>0?G.amber:G.green]].map(([l,v,c])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:`1px solid ${G.border}15`}}>
                  <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{l}</span>
                  <span style={{fontFamily:'Orbitron',fontSize:10,color:c,fontWeight:700}}>{v}</span>
                </div>
              ))}
            </div>
          </Panel>
        ):(
          <Panel style={{padding:14}}>
            <div style={{fontFamily:'Cinzel',fontSize:8,color:G.dim,letterSpacing:2,marginBottom:10}}>RESUMO MENSAL</div>
            <BarChart data={[
              {label:'Jan',val:120000,col:G.gold},{label:'Fev',val:145000,col:G.gold},
              {label:'Mar',val:98500,col:G.teal}
            ]} h={60}/>
          </Panel>
        )}
        <Panel style={{padding:14}}>
          <div style={{fontFamily:'Cinzel',fontSize:8,color:G.dim,letterSpacing:2,marginBottom:10}}>POR SEGURADORA</div>
          {[['ENSA','3 faturas',G.gold],['INSS','1 fatura',G.teal],['AAA Seguros','2 faturas',G.amber],['Particular','1 fatura',G.dim]].map(([s,n,c])=>(
            <div key={s} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:`1px solid ${G.border}15`}}>
              <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{s}</span>
              <span style={{fontFamily:'Orbitron',fontSize:8,color:c}}>{n}</span>
            </div>
          ))}
        </Panel>
      </div>

      {modalOpen&&<FinanceiroModal patients={patients} setInvs={setInvs} onClose={()=>setModalOpen(false)}/>}
    </div>
  );
}

function FinanceiroModal({patients, setInvs, onClose}) {
  const [fPat,setFPat]=useState('');
  const [fDate,setFDate]=useState(new Date().toISOString().split('T')[0]);
  const [fSeg,setFSeg]=useState('Particular');
  const [fItems,setFItems]=useState([]);
  const [fTotal,setFTotal]=useState('');
  const [fPago,setFPago]=useState('');
  const PRICES={'Consulta':8000,'Análises':5000,'Medicação':3000,'Procedimento':12000,'Imagiologia':15000,'Internamento/dia':25000,'Cirurgia':80000};
  const autoTotal=fItems.reduce((s,i)=>s+(PRICES[i]||0),0);
  return(
    <Modal open={true} onClose={onClose} title="EMITIR FATURA" width={480}>
      <FormRow label="Paciente *"><GSelect value={fPat} onChange={e=>setFPat(e.target.value)} options={['', ...patients.filter(p=>p.tipo==='Paciente').map(p=>p.nome)]}/></FormRow>
      <FormRow label="Data"><GInput type="date" value={fDate} onChange={e=>setFDate(e.target.value)}/></FormRow>
      <FormRow label="Seguradora"><GSelect value={fSeg} onChange={e=>setFSeg(e.target.value)} options={['ENSA','INSS','AAA Seguros','Particular','BESA','Global Seguros']}/></FormRow>
      <div style={{marginBottom:10}}>
        <div style={{fontFamily:'Cinzel',fontSize:8,color:G.dim,letterSpacing:2,marginBottom:6}}>ITENS / SERVIÇOS</div>
        {Object.entries(PRICES).map(([item,price])=>(
          <label key={item} style={{display:'flex',gap:8,alignItems:'center',padding:'4px 0',cursor:'pointer'}}>
            <input type="checkbox" checked={fItems.includes(item)} onChange={e=>setFItems(p=>e.target.checked?[...p,item]:p.filter(x=>x!==item))} style={{accentColor:G.gold}}/>
            <span style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,flex:1}}>{item}</span>
            <span style={{fontFamily:'Orbitron',fontSize:9,color:G.gold}}>{price.toLocaleString('pt-AO')} AOA</span>
          </label>
        ))}
      </div>
      <div style={{display:'flex',gap:10,marginBottom:10}}>
        <FormRow label="Total (AOA)"><GInput type="number" value={fTotal||autoTotal} onChange={e=>setFTotal(e.target.value)} placeholder={String(autoTotal)}/></FormRow>
        <FormRow label="Pago (AOA)"><GInput type="number" value={fPago} onChange={e=>setFPago(e.target.value)} placeholder="0"/></FormRow>
      </div>
      {autoTotal>0&&<div style={{fontFamily:'Orbitron',fontSize:9,color:G.gold,marginBottom:10}}>Total: {autoTotal.toLocaleString('pt-AO')} AOA</div>}
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
        <button onClick={onClose} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:'transparent',border:`1px solid ${G.border}`,color:G.dim,borderRadius:1}}>CANCELAR</button>
        <button onClick={()=>{
          if(!fPat)return;
          const total=parseInt(fTotal)||autoTotal;
          const pago=parseInt(fPago)||0;
          const d=fDate.split('-');
          const pat = patients.find((x)=>String(x.nome||'').trim()===String(fPat||'').trim());
          const patient_id = pat?.id ?? null;
          setInvs(p=>[...p,{id:`FT-${String(Date.now()).slice(-6)}`,patient:fPat,patient_id,date:d.length===3?`${d[2]}/${d[1]}/${d[0]}`:fDate,total,pago,pendente:Math.max(0,total-pago),seguro:fSeg,items:fItems.length?fItems:['Consulta'],status:pago>=total?'Pago':pago>0?'Parcial':'Pendente',currency:'AOA',saftReady:false}]);
          onClose();
        }} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:`${G.gold}18`,border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1}}>◈ EMITIR FATURA</button>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════
   INTERNAMENTO — BED MAP
═══════════════════════════════════════════════════════════ */
function Internamento() {
  const {beds,setBeds,patients} = useClinic();
  const [sel,setSel] = useState(null);

  const wards = [...new Set(beds.map(b=>b.ward))];
  const B=sel?beds.find(b=>b.id===sel):null;

  const bedStats = {
    total:beds.length,
    ocupadas:beds.filter(b=>b.status==='Ocupada').length,
    livres:beds.filter(b=>b.status==='Livre').length,
    limpeza:beds.filter(b=>b.status==='Limpeza').length,
    reservadas:beds.filter(b=>b.status==='Reservada').length,
  };

  return(
    <div style={{display:'flex',gap:10,height:'100%',padding:10}}>
      <div style={{flex:1,display:'flex',flexDirection:'column',gap:10,overflow:'auto'}}>
        {/* Stats */}
        <div style={{display:'flex',gap:8}}>
          {[
            ['Total',bedStats.total,'🏥',G.gold],
            ['Ocupadas',bedStats.ocupadas,'🔴',G.red],
            ['Livres',bedStats.livres,'🟢',G.green],
            ['Limpeza',bedStats.limpeza,'🟡',G.amber],
            ['Reservadas',bedStats.reservadas,'🔵',G.teal],
          ].map(([l,v,ic,c],i)=>(
            <StatCard key={l} label={l} val={v} ic={ic} col={c} i={i}/>
          ))}
        </div>

        {/* Bed grid by ward */}
        {wards.map(ward=>(
          <Panel key={ward} style={{padding:14}}>
            <SectionHeader title={`ENFERMARIA — ${ward.toUpperCase()}`}/>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
              {beds.filter(b=>b.ward===ward).map((bed,i)=>(
                <div key={bed.id} onClick={()=>setSel(sel===bed.id?null:bed.id)}
                  style={{background:sel===bed.id?`${bed.cor}14`:`${bed.cor}06`,
                    border:`1.5px solid ${sel===bed.id?bed.cor:`${bed.cor}55`}`,
                    borderRadius:3,padding:'12px 14px',cursor:'pointer',
                    transition:'all 0.2s',animation:`fadeUp ${0.2+i*0.06}s ease`}}>
                  <Corners sz={8} col={bed.cor} op={0.6}/>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <span style={{fontFamily:'Orbitron',fontSize:12,color:bed.cor,fontWeight:700}}>#{bed.id}</span>
                    <Dot col={bed.cor} pulse={bed.status==='Ocupada'}/>
                  </div>
                  <Badge text={bed.status} col={bed.cor}/>
                  {bed.patient&&(
                    <div style={{marginTop:8}}>
                      <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.text,fontWeight:600,
                        overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{bed.patient}</div>
                      <div style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim,marginTop:2}}>{bed.diag}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      {/* Detail */}
      <div style={{width:240,flexShrink:0,display:'flex',flexDirection:'column',gap:10}}>
        {B?(
          <Panel style={{padding:14,animation:'fadeUp 0.25s ease'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div style={{fontFamily:'Cinzel',fontSize:12,color:G.gold}}>CAMA #{B.id}</div>
              <Badge text={B.status} col={B.cor}/>
            </div>
            {B.patient?(
              <>
                <div style={{marginBottom:12}}>
                  {[['Paciente',B.patient],['Diagnóstico',B.diag||'—'],['Entrada',B.entrada||'—'],['Médico',B.medico||'—'],['Ward',B.ward]].map(([l,v])=>(
                    <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:`1px solid ${G.border}15`}}>
                      <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{l}</span>
                      <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.text,textAlign:'right',maxWidth:'55%',lineHeight:1.3}}>{v}</span>
                    </div>
                  ))}
                </div>
                <VitalWave color={G.red} amp={1.1} h={40}/>
                <div style={{display:'flex',gap:6,marginTop:10,flexWrap:'wrap'}}>
                  {['Livre','Limpeza','Reservada','Ocupada'].map(st=>(
                    <button key={st} onClick={()=>setBeds(p=>p.map(b=>b.id===sel?{...b,status:st,cor:st==='Livre'?G.green:st==='Ocupada'?G.red:st==='Limpeza'?G.amber:G.blue,patient:st==='Livre'?null:b.patient}:b))}
                      style={{fontFamily:'Orbitron',fontSize:6,padding:'4px 8px',background:B.status===st?`${G.gold}14`:'transparent',border:`1px solid ${B.status===st?G.gold:G.border}`,color:B.status===st?G.gold:G.dim,borderRadius:1,cursor:'pointer'}}>
                      {st}
                    </button>
                  ))}
                  <button onClick={()=>setBeds(p=>p.map(b=>b.id===sel?{...b,status:'Livre',cor:G.green,patient:null,diag:null,entrada:null,medico:null}:b))}
                    style={{fontFamily:'Orbitron',fontSize:6,padding:'4px 8px',background:'rgba(255,37,37,0.08)',border:'1px solid rgba(255,37,37,0.3)',color:G.red,borderRadius:1,cursor:'pointer'}}>
                    🗑 ALTA
                  </button>
                </div>
              </>
            ):(
              <div>
                <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,marginBottom:10}}>
                  Cama livre — Assign paciente:
                </div>
                <GSelect value="" onChange={e=>{if(!e.target.value)return;const p=patients.find(pt=>pt.nome===e.target.value);setBeds(prev=>prev.map(b=>b.id===sel?{...b,patient:e.target.value,status:'Ocupada',cor:G.red,diag:p?.diag||'—',entrada:new Date().toLocaleDateString('pt-PT'),medico:'—'}:b));}} options={['Assign paciente...', ...patients.filter(p=>p.tipo==='Paciente').map(p=>p.nome)]}/>
                <div style={{display:'flex',gap:6,marginTop:8}}>
                  {['Livre','Limpeza','Reservada'].map(st=>(
                    <button key={st} onClick={()=>setBeds(p=>p.map(b=>b.id===sel?{...b,status:st,cor:st==='Livre'?G.green:st==='Limpeza'?G.amber:G.blue}:b))}
                      style={{fontFamily:'Orbitron',fontSize:6,padding:'4px 8px',background:B.status===st?`${G.gold}14`:'transparent',border:`1px solid ${B.status===st?G.gold:G.border}`,color:B.status===st?G.gold:G.dim,borderRadius:1,cursor:'pointer'}}>
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        ):(
          <Panel style={{padding:14}}>
            <SectionHeader title="SELECCIONAR CAMA"/>
            <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.dim,lineHeight:1.6}}>
              Clique numa cama para ver detalhes e gerir o internamento.
            </div>
          </Panel>
        )}

        <Panel style={{padding:14}}>
          <SectionHeader title="OCUPAÇÃO"/>
          <div style={{marginBottom:8}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>Taxa Ocupação</span>
              <span style={{fontFamily:'Orbitron',fontSize:10,color:G.amber}}>{Math.round(bedStats.ocupadas/bedStats.total*100)}%</span>
            </div>
            <div style={{height:6,background:`${G.gold}15`,borderRadius:3,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${bedStats.ocupadas/bedStats.total*100}%`,
                background:`linear-gradient(90deg,${G.amber},${G.red})`,borderRadius:3}}/>
            </div>
          </div>
          <Ring val={bedStats.ocupadas} max={bedStats.total} col={G.amber} size={80} label="Camas Ocupadas"/>
        </Panel>

        <Panel style={{padding:14}}>
          <SectionHeader title="INTERNAMENTOS ACTIVOS"/>
          {beds.filter(b=>b.status==='Ocupada').map((b,i)=>(
            <div key={i} style={{padding:'6px 0',borderBottom:`1px solid ${G.border}15`}}>
              <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,fontWeight:600}}>{b.patient}</div>
              <div style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim}}>{b.id} · Entrada: {b.entrada}</div>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   RECURSOS HUMANOS
═══════════════════════════════════════════════════════════ */
function RecursosHumanos() {
  const {staff:STAFF,setStaff} = useClinic();
  const [sel,setSel]=useState(null);
  const [staffModalOpen,setStaffModalOpen]=useState(false);
  const [staffForm,setStaffForm]=useState({nome:'',cargo:'',turno:'Manhã',folga:'',ferias:'',tel:'',status:'Serviço'});
  const days=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  const S=sel?STAFF.find(s=>s.id===sel):null;
  const statusCol={Serviço:G.green,Folga:G.amber};

  const schedule = {
    1:['M','M','M','M','M','F','F'],
    2:['M','T','M','T','M','T','F'],
    3:['M','M','M','M','M','F','F'],
    4:['F','F','T','T','T','N','N'],
    5:['M','M','M','M','M','F','F'],
    6:['M','M','T','M','T','M','F'],
  };
  const shiftCol={M:'#D4AF37',T:'#00CCFF',N:'#AA55FF',F:`${G.dim}55`};
  const shiftLabel={M:'Manhã',T:'Tarde',N:'Noite',F:'Folga'};

  return(<>
    <div style={{display:'flex',gap:10,height:'100%',padding:10}}>
      <div style={{flex:1,display:'flex',flexDirection:'column',gap:10,overflow:'auto'}}>
        {/* Staff cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:9}}>
          {STAFF.map((s,i)=>(
            <Panel key={s.id} style={{padding:14,cursor:'pointer',
              border:`1px solid ${sel===s.id?s.cor:G.border}`,
              background:sel===s.id?`${s.cor}08`:undefined,
              animation:`fadeUp ${0.2+i*0.06}s ease`}}
              onClick={()=>setSel(s.id===sel?null:s.id)}>
              <Corners col={sel===s.id?s.cor:G.gold} op={sel===s.id?0.8:0.25}/>
              <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:10}}>
                <div style={{width:42,height:42,borderRadius:'50%',
                  background:`${s.cor}18`,border:`2px solid ${s.cor}77`,
                  display:'flex',alignItems:'center',justifyContent:'center',
                  fontFamily:'Cinzel',fontSize:14,fontWeight:700,color:s.cor,flexShrink:0}}>{s.initials}</div>
                <div style={{overflow:'hidden'}}>
                  <div style={{fontFamily:'Rajdhani',fontSize:12,fontWeight:600,color:G.text,
                    whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.nome}</div>
                  <div style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim,marginTop:2}}>{s.cargo.split('—')[0]}</div>
                </div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim}}>{s.turno}</span>
                <Badge text={s.status} col={statusCol[s.status]||G.gold} small/>
              </div>
            </Panel>
          ))}
        </div>

        {/* Weekly schedule */}
        <Panel style={{padding:14}}>
          <SectionHeader title="ESCALA SEMANAL — MARÇO 2025"/>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',minWidth:500}}>
              <thead>
                <tr>
                  <th style={{width:140,padding:'6px 10px',fontFamily:'Orbitron',fontSize:7,color:G.dim,textAlign:'left',borderBottom:`1px solid ${G.border}`}}>FUNCIONÁRIO</th>
                  {days.map((d,i)=>(
                    <th key={i} style={{padding:'6px 8px',fontFamily:'Orbitron',fontSize:7,color:G.dim,textAlign:'center',borderBottom:`1px solid ${G.border}`}}>{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STAFF.map((s,i)=>(
                  <tr key={i}>
                    <td style={{padding:'8px 10px',fontFamily:'Rajdhani',fontSize:12,color:G.text,borderBottom:`1px solid ${G.border}15`}}>
                      <div style={{display:'flex',gap:6,alignItems:'center'}}>
                        <div style={{width:6,height:6,borderRadius:'50%',background:s.cor,flexShrink:0}}/>
                        {s.nome.split(' ')[0]} {s.nome.split(' ').slice(-1)}
                      </div>
                    </td>
                    {(schedule[s.id]||Array(7).fill('M')).map((sh,j)=>(
                      <td key={j} style={{padding:'6px 4px',textAlign:'center',borderBottom:`1px solid ${G.border}15`}}>
                        <div style={{display:'inline-block',padding:'3px 6px',borderRadius:2,
                          background:`${shiftCol[sh]}18`,border:`1px solid ${shiftCol[sh]}44`,
                          fontFamily:'Orbitron',fontSize:7,color:shiftCol[sh]}}>
                          {sh}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{display:'flex',gap:12,marginTop:10}}>
              {Object.entries(shiftLabel).map(([k,l])=>(
                <div key={k} style={{display:'flex',gap:4,alignItems:'center'}}>
                  <div style={{width:5,height:5,borderRadius:'50%',background:shiftCol[k]}}/>
                  <span style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim}}>{l}</span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div style={{width:230,flexShrink:0,display:'flex',flexDirection:'column',gap:10}}>
        {S?(
          <Panel style={{padding:14,animation:'fadeUp 0.25s ease'}}>
            <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:12}}>
              <div style={{width:46,height:46,borderRadius:'50%',
                background:`${S.cor}18`,border:`2px solid ${S.cor}`,
                display:'flex',alignItems:'center',justifyContent:'center',
                fontFamily:'Cinzel',fontSize:16,fontWeight:700,color:S.cor}}>{S.initials}</div>
              <div>
                <div style={{fontFamily:'Cinzel',fontSize:11,color:G.text}}>{S.nome}</div>
                <Badge text={S.status} col={statusCol[S.status]||G.gold}/>
              </div>
            </div>
            {[['Cargo',S.cargo],['Turno',S.turno],['Folga',S.folga],['Férias',S.ferias],['Contacto',S.tel]].map(([l,v])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'5px 0',borderBottom:`1px solid ${G.border}15`}}>
                <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{l}</span>
                <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.text,textAlign:'right',maxWidth:'55%',lineHeight:1.3}}>{v}</span>
              </div>
            ))}
          </Panel>
        ):null}

        <Panel style={{padding:14}}>
          <SectionHeader title="EQUIPA" action={()=>setStaffModalOpen(true)} actionLabel="+ NOVO"/>
          {[['Médicos',2,G.blue],['Enfermeiros',2,G.teal],['Técnicos',1,G.amber],['Admin',1,G.gold]].map(([l,n,c])=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:`1px solid ${G.border}15`}}>
              <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{l}</span>
              <span style={{fontFamily:'Orbitron',fontSize:11,color:c,fontWeight:700}}>{n}</span>
            </div>
          ))}
        </Panel>
        <Panel style={{padding:14}}>
          <SectionHeader title="PRESENÇAS HOJE"/>
          <div style={{marginBottom:8}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>Em Serviço</span>
              <span style={{fontFamily:'Orbitron',fontSize:10,color:G.green}}>5/6</span>
            </div>
            <div style={{height:5,background:`${G.gold}15`,borderRadius:3,overflow:'hidden'}}>
              <div style={{height:'100%',width:'83%',background:`linear-gradient(90deg,${G.green},${G.teal})`,borderRadius:3}}/>
            </div>
          </div>
        </Panel>
      </div>
    </div>

    {/* Staff creation modal */}
    <Modal open={staffModalOpen} onClose={()=>setStaffModalOpen(false)} title="NOVO FUNCIONÁRIO" width={420}>
      <FormRow label="Nome Completo *"><GInput value={staffForm.nome} onChange={e=>setStaffForm({...staffForm,nome:e.target.value})} placeholder="Nome completo"/></FormRow>
      <FormRow label="Cargo"><GSelect value={staffForm.cargo} onChange={e=>setStaffForm({...staffForm,cargo:e.target.value})} options={['Médico','Médica','Enfermeiro','Enfermeira','Técnico Laboratório','Recepcionista','Administrador','Auxiliar']}/></FormRow>
      <FormRow label="Turno"><GSelect value={staffForm.turno} onChange={e=>setStaffForm({...staffForm,turno:e.target.value})} options={['Manhã','Tarde','Noite','Manhã/Tarde']}/></FormRow>
      <FormRow label="Folga"><GInput value={staffForm.folga} onChange={e=>setStaffForm({...staffForm,folga:e.target.value})} placeholder="Sáb/Dom"/></FormRow>
      <FormRow label="Férias"><GInput value={staffForm.ferias} onChange={e=>setStaffForm({...staffForm,ferias:e.target.value})} placeholder="Julho"/></FormRow>
      <FormRow label="Telefone"><GInput value={staffForm.tel} onChange={e=>setStaffForm({...staffForm,tel:e.target.value})} placeholder="+244 ..."/></FormRow>
      <FormRow label="Estado"><GSelect value={staffForm.status} onChange={e=>setStaffForm({...staffForm,status:e.target.value})} options={['Serviço','Folga','Férias','Baixa']}/></FormRow>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
        <button onClick={()=>setStaffModalOpen(false)} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:'transparent',border:`1px solid ${G.border}`,color:G.dim,borderRadius:1}}>CANCELAR</button>
        <button onClick={()=>{if(!staffForm.nome.trim())return;setStaff(p=>[...p,{...staffForm,id:Date.now(),nivel:'Clínico',initials:staffForm.nome.split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase(),cor:['#D4AF37','#00AAFF','#00CC88','#FF9944','#AA55FF'][Math.floor(Math.random()*5)]}]);setStaffModalOpen(false);setStaffForm({nome:'',cargo:'',turno:'Manhã',folga:'',ferias:'',tel:'',status:'Serviço'});}} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:`${G.gold}18`,border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1}}>◈ ADICIONAR</button>
      </div>
    </Modal>
  </>);
}

/* ═══════════════════════════════════════════════════════════
   ANALYTICS & BI
═══════════════════════════════════════════════════════════ */
function Analytics() {
  const {patients,appointments,prescriptions,labResults,invoices,beds} = useClinic();
  
  // Real calculations
  const totalPac = patients.filter(p=>p.tipo==='Paciente').length;
  const activePac = patients.filter(p=>p.tipo==='Paciente'&&p.status!=='Alta Completa').length;
  const totalAppts = appointments.length;
  const alertLabs = labResults.filter(r=>r.alert).length;
  const totalInv = invoices.reduce((s,i)=>s+i.total,0);
  const paidInv = invoices.reduce((s,i)=>s+i.pago,0);
  
  // Diagnoses distribution
  const diagCounts={};
  patients.filter(p=>p.diag&&p.diagKey).forEach(p=>{ diagCounts[p.diag]=(diagCounts[p.diag]||0)+1; });
  const top5Diag=Object.entries(diagCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  
  // Specialty distribution from appointments
  const specCounts={};
  appointments.forEach(a=>{ if(a.specialty) specCounts[a.specialty]=(specCounts[a.specialty]||0)+1; });
  const specEntries=Object.entries(specCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const specTotal=specEntries.reduce((s,[,v])=>s+v,0)||1;
  const specCols=[G.red,G.gold,G.teal,G.purple,G.amber];
  
  // Age groups
  const ageGroups={'0-17':0,'18-35':0,'36-50':0,'51-65':0,'65+':0};
  patients.filter(p=>p.tipo==='Paciente'&&p.idade).forEach(p=>{
    const a=parseInt(p.idade);
    if(a<=17)ageGroups['0-17']++;
    else if(a<=35)ageGroups['18-35']++;
    else if(a<=50)ageGroups['36-50']++;
    else if(a<=65)ageGroups['51-65']++;
    else ageGroups['65+']++;
  });
  const ageTotal=Object.values(ageGroups).reduce((s,v)=>s+v,0)||1;
  const ageCols=[G.teal,G.gold,G.amber,G.red,G.purple];
  
  return(
    <div style={{padding:10,display:'flex',flexDirection:'column',gap:10,height:'100%',overflowY:'auto'}}>
      <div style={{display:'flex',gap:8}}>
        <StatCard label="Total Pacientes" val={totalPac} sub={`${activePac} activos`} ic="🧬" col={G.gold} i={0}/>
        <StatCard label="Consultas" val={totalAppts} sub="total agendadas" ic="📋" col={G.teal} i={1}/>
        <StatCard label="Alertas Lab." val={alertLabs} sub={`${labResults.length} exames`} ic="⚠" col={G.red} i={2}/>
        <StatCard label="Faturação" val={totalInv>0?`${(totalInv/1000).toFixed(0)}K AOA`:'0 AOA'} sub={paidInv>0?`${Math.round(paidInv/totalInv*100)}% pago`:'—'} ic="💰" col={G.amber} i={3}/>
      </div>

      <div style={{display:'flex',gap:10}}>
        <Panel style={{flex:2,padding:14}}>
          <SectionHeader title="CONSULTAS POR STATUS"/>
          {appointments.length===0?(
            <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,padding:'8px 0',textAlign:'center'}}>Sem consultas registadas</div>
          ):(()=>{
            const stats={Confirmada:0,'Em curso':0,Aguarda:0,Cancelada:0};
            appointments.forEach(a=>{stats[a.status]=(stats[a.status]||0)+1;});
            const statCols={Confirmada:G.gold,'Em curso':G.green,Aguarda:G.dim,Cancelada:G.red};
            return <BarChart data={Object.entries(stats).filter(([,v])=>v>0).map(([l,v])=>({label:l,val:v,col:statCols[l]||G.dim}))} h={80}/>;
          })()}
        </Panel>
        <Panel style={{flex:1,padding:14}}>
          <SectionHeader title="ESPECIALIDADES"/>
          {specEntries.length===0?(
            <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,textAlign:'center',padding:'8px 0'}}>Sem dados</div>
          ):specEntries.map(([l,v],i)=>(
            <div key={l} style={{marginBottom:8}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'70%'}}>{l}</span>
                <span style={{fontFamily:'Orbitron',fontSize:9,color:specCols[i%specCols.length]}}>{Math.round(v/specTotal*100)}%</span>
              </div>
              <div style={{height:4,background:`${specCols[i%specCols.length]}15`,borderRadius:2,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${v/specTotal*100}%`,background:specCols[i%specCols.length],borderRadius:2}}/>
              </div>
            </div>
          ))}
        </Panel>
      </div>

      <div style={{display:'flex',gap:10}}>
        <Panel style={{flex:1,padding:14}}>
          <SectionHeader title="OCUPAÇÃO CLÍNICA"/>
          <div style={{display:'flex',justifyContent:'space-around',padding:'8px 0'}}>
            <Ring val={activePac} max={Math.max(totalPac,1)} col={G.green} size={64} label="Pac. Activos"/>
            <Ring val={beds.filter(b=>b.status==='Ocupada').length} max={beds.length} col={G.amber} size={64} label="Camas Ocup."/>
            <Ring val={prescriptions.filter(r=>r.status==='Activa').length} max={Math.max(prescriptions.length,1)} col={G.teal} size={64} label="Prescrições"/>
            <Ring val={alertLabs} max={Math.max(labResults.length,1)} col={G.red} size={64} label="Alertas"/>
          </div>
        </Panel>
        <Panel style={{flex:1,padding:14}}>
          <SectionHeader title="MORBILIDADE — DIAGNÓSTICOS"/>
          {top5Diag.length===0?(
            <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,textAlign:'center',padding:'8px 0'}}>Sem diagnósticos registados</div>
          ):top5Diag.map(([l,v],i)=>(
            <div key={l} style={{marginBottom:7}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'72%'}}>{l}</span>
                <span style={{fontFamily:'Orbitron',fontSize:9,color:specCols[i%specCols.length]}}>{v} pac.</span>
              </div>
              <div style={{height:4,background:`${specCols[i%specCols.length]}15`,borderRadius:2,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${v/Math.max(...top5Diag.map(([,x])=>x))*100}%`,background:specCols[i%specCols.length],borderRadius:2}}/>
              </div>
            </div>
          ))}
        </Panel>
      </div>

      <div style={{display:'flex',gap:10}}>
        <Panel style={{flex:1,padding:14}}>
          <SectionHeader title="FATURAÇÃO POR ESTADO"/>
          {invoices.length===0?(
            <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,padding:'8px 0',textAlign:'center'}}>Sem faturas registadas</div>
          ):(()=>{
            const byS={Pago:0,Pendente:0,Parcial:0};
            invoices.forEach(inv=>{byS[inv.status]=(byS[inv.status]||0)+inv.total;});
            const sc2={Pago:G.green,Pendente:G.red,Parcial:G.amber};
            return <><BarChart data={Object.entries(byS).filter(([,v])=>v>0).map(([l,v])=>({label:l,val:v,col:sc2[l]||G.dim}))} h={70}/>
              <div style={{marginTop:8,fontFamily:'Orbitron',fontSize:8,color:G.gold}}>Total: {totalInv.toLocaleString('pt-AO')} AOA</div></>;
          })()}
        </Panel>
        <Panel style={{flex:1,padding:14}}>
          <SectionHeader title="DISTRIBUIÇÃO ETÁRIA"/>
          {patients.filter(p=>p.tipo==='Paciente').length===0?(
            <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,padding:'8px 0',textAlign:'center'}}>Sem pacientes registados</div>
          ):Object.entries(ageGroups).map(([l,v],i)=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:`1px solid ${G.border}15`}}>
              <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{l} anos</span>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <div style={{width:60,height:4,background:`${ageCols[i]}15`,borderRadius:2,overflow:'hidden'}}>
                  <div style={{height:'100%',width:`${Math.round(v/ageTotal*100)}%`,background:ageCols[i],borderRadius:2}}/>
                </div>
                <span style={{fontFamily:'Orbitron',fontSize:8,color:ageCols[i],width:28,textAlign:'right'}}>{v}</span>
              </div>
            </div>
          ))}
        </Panel>
      </div>

      <Panel style={{padding:14}}>
        <SectionHeader title="MONITOR EM TEMPO REAL"/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
          {[['Cardíaco',G.red,1.2],['Resp.',G.teal,0.8],['Neurológico',G.purple,0.6],['Metabólico',G.amber,1.0]].map(([l,c,a])=>(
            <div key={l}>
              <div style={{fontFamily:'Orbitron',fontSize:7,color:c,letterSpacing:1,marginBottom:4}}>{l.toUpperCase()}</div>
              <VitalWave color={c} amp={a} h={40}/>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   COMUNICAÇÃO — CHAT
═══════════════════════════════════════════════════════════ */
function Comunicacao() {
  const {messages:msgs,setMessages:setMsgs,notifications,staff:STAFF,addNotification} = useClinic();
  const [input,setInput]=useState('');
  const [selChat,setSelChat]=useState(1);
  const [channelFilter,setChannelFilter]=useState('all');
  const [composeChannel,setComposeChannel]=useState('Interno');
  const [composeType,setComposeType]=useState('normal');
  const chatRef=useRef();

  const inferChannel = useCallback((m)=>{
    if(m.channel) return m.channel;
    const text = `${m.from||''} ${m.msg||''}`.toLowerCase();
    if(text.includes('whatsapp') || text.includes('+244') || text.includes('+55')) return 'WhatsApp';
    if((m.type||'')==='lab') return 'Laboratorio';
    if((m.type||'')==='agenda') return 'Agenda';
    return 'Interno';
  },[]);

  const normalized = useMemo(()=>(
    msgs.map((m,i)=>(
      {
        ...m,
        id: m.id || `${Date.now()}-${i}`,
        from: m.from || 'Sistema',
        msg: m.msg || 'Sem conteudo',
        initials: m.initials || 'SI',
        cor: m.cor || G.gold,
        time: m.time || '--:--',
        type: m.type || 'normal',
        channel: inferChannel(m),
        unread: !!m.unread,
      }
    ))
  ),[inferChannel,msgs]);

  const visibleMessages = useMemo(()=>(
    normalized.filter(m=>channelFilter==='all' ? true : m.channel===channelFilter)
  ),[channelFilter,normalized]);

  const unreadCount = normalized.filter(m=>m.unread).length;
  const whatsappQueue = normalized.filter(m=>m.channel==='WhatsApp').length;
  const criticalCount = normalized.filter(m=>m.type==='alerta').length;

  const send = () => {
    if(!input.trim()) return;
    setMsgs(prev=>[...prev,{id:Date.now(),from:'Dr. Admin',initials:'DA',cor:G.gold,
      msg:input.trim(),time:new Date().toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}),
      unread:false,type:composeType,channel:composeChannel}]);
    setInput('');
    setTimeout(()=>{if(chatRef.current)chatRef.current.scrollTop=chatRef.current.scrollHeight;},40);
  };

  const injectWhatsApp = () => {
    const pool = [
      'Ola, gostaria de remarcar a consulta de cardiologia.',
      'Tenho resultado de exame, posso enviar foto?',
      'Preciso de segunda via da receita, por favor.',
    ];
    const msg = pool[Math.floor(Math.random()*pool.length)];
    setMsgs(prev=>[...prev,{id:Date.now(),from:'+244 923 000 112',initials:'WA',cor:G.green,
      msg,time:new Date().toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'}),
      unread:true,type:'agenda',channel:'WhatsApp'}]);
    addNotification('info','Nova mensagem recebida via WhatsApp.');
  };

  const markAllRead = () => setMsgs(prev=>prev.map(m=>({...m,unread:false})));

  return(
    <div style={{display:'flex',gap:10,height:'100%',padding:10}}>
      <div style={{width:240,flexShrink:0,display:'flex',flexDirection:'column',gap:8}}>
        <Panel style={{padding:12}}>
          <SectionHeader title="INBOX CRM" action={injectWhatsApp} actionLabel="SIMULAR WA"/>
          <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:6}}>
            <div style={{padding:6,border:`1px solid ${G.border}`,borderRadius:2}}>
              <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>NAO LIDAS</div>
              <div style={{fontFamily:'Orbitron',fontSize:14,color:unreadCount>0?G.red:G.green}}>{unreadCount}</div>
            </div>
            <div style={{padding:6,border:`1px solid ${G.border}`,borderRadius:2}}>
              <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>WHATSAPP</div>
              <div style={{fontFamily:'Orbitron',fontSize:14,color:G.green}}>{whatsappQueue}</div>
            </div>
          </div>
        </Panel>

        <Panel style={{padding:10}}>
          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
            {[['all','TODOS'],['WhatsApp','WA'],['Interno','INTERNO'],['Agenda','AGENDA'],['Laboratorio','LAB']].map(([id,label])=>(
              <button key={id} onClick={()=>setChannelFilter(id)} style={{fontFamily:'Orbitron',fontSize:7,padding:'3px 8px',
                background:channelFilter===id?`${G.gold}18`:'transparent',border:`1px solid ${channelFilter===id?G.gold:G.border}`,
                color:channelFilter===id?G.gold:G.dim,borderRadius:1}}>{label}</button>
            ))}
          </div>
          <button onClick={markAllRead} style={{marginTop:8,width:'100%',fontFamily:'Orbitron',fontSize:7,padding:'5px 8px',
            background:'transparent',border:`1px solid ${G.border}`,color:G.dim,borderRadius:2}}>MARCAR TODAS COMO LIDAS</button>
        </Panel>

        <Panel style={{flex:1,overflow:'auto'}}>
          {STAFF.map((s,i)=>(
            <div key={i} onClick={()=>setSelChat(s.id)}
              style={{display:'flex',gap:8,alignItems:'center',padding:'10px 12px',cursor:'pointer',
                background:selChat===s.id?`${s.cor}09`:'transparent',
                borderLeft:selChat===s.id?`2px solid ${s.cor}`:'2px solid transparent',
                borderBottom:`1px solid ${G.border}15`}}>
              <div style={{width:30,height:30,borderRadius:'50%',background:`${s.cor}18`,border:`1.5px solid ${s.cor}55`,
                display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Cinzel',fontSize:10,color:s.cor}}>{s.initials}</div>
              <div style={{flex:1,overflow:'hidden'}}>
                <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.nome}</div>
                <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>{s.cargo?.split('·')[0]||'Equipe'}</div>
              </div>
              <Dot col={s.status==='Serviço'||s.status==='Servico'||s.status==='ServiÃ§o'?G.green:G.amber}/>
            </div>
          ))}
        </Panel>
      </div>

      <Panel style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{padding:'12px 14px',borderBottom:`1px solid ${G.border}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontFamily:'Cinzel',fontSize:10,color:G.gold,letterSpacing:2}}>CENTRAL OMNICHANNEL</div>
          <div style={{display:'flex',gap:6}}>
            <GSelect value={composeChannel} onChange={e=>setComposeChannel(e.target.value)} options={['Interno','WhatsApp','Agenda','Laboratorio']}/>
            <GSelect value={composeType} onChange={e=>setComposeType(e.target.value)} options={[{v:'normal',l:'Normal'},{v:'agenda',l:'Agenda'},{v:'lab',l:'Lab'},{v:'alerta',l:'Alerta'}]}/>
          </div>
        </div>

        <div ref={chatRef} style={{flex:1,overflow:'auto',padding:14,display:'flex',flexDirection:'column',gap:8}}>
          {visibleMessages.length===0 ? (
            <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.dim,textAlign:'center',paddingTop:20}}>Sem mensagens para este filtro.</div>
          ) : visibleMessages.map((m,i)=>{
            const mine = m.from==='Dr. Admin';
            const typeCol={alerta:G.red,info:G.teal,agenda:G.gold,lab:G.amber,normal:G.dim};
            const chCol={WhatsApp:G.green,Interno:G.teal,Agenda:G.gold,Laboratorio:G.amber};
            return(
              <div key={`${m.id}-${i}`} style={{display:'flex',gap:8,flexDirection:mine?'row-reverse':'row'}}>
                <div style={{width:28,height:28,borderRadius:'50%',flexShrink:0,background:`${m.cor}18`,border:`1.5px solid ${m.cor}55`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Cinzel',fontSize:9,color:m.cor}}>{m.initials}</div>
                <div style={{maxWidth:'74%'}}>
                  <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,marginBottom:3,textAlign:mine?'right':'left'}}>{m.from} · {m.time}</div>
                  <div style={{background:mine?`${G.gold}12`:`${typeCol[m.type]||G.dim}08`,border:`1px solid ${mine?`${G.gold}33`:`${typeCol[m.type]||G.dim}22`}`,borderRadius:mine?'8px 2px 8px 8px':'2px 8px 8px 8px',padding:'8px 12px'}}>
                    <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,lineHeight:1.45}}>{m.msg}</div>
                    <div style={{display:'flex',gap:4,marginTop:5,flexWrap:'wrap'}}>
                      <Badge text={m.channel} col={chCol[m.channel]||G.dim} small/>
                      {m.type!=='normal'&&<Badge text={m.type.toUpperCase()} col={typeCol[m.type]||G.dim} small/>}
                      {m.unread&&<Badge text="NOVA" col={G.red} small pulse/>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{padding:'10px 14px',borderTop:`1px solid ${G.border}`,display:'flex',gap:8,alignItems:'center'}}>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}
            placeholder="Escrever mensagem operacional..."
            style={{flex:1,background:'rgba(212,175,55,0.05)',border:`1px solid ${G.border}`,borderRadius:2,padding:'8px 12px',color:G.text,fontFamily:'Rajdhani',fontSize:12}}/>
          <button onClick={send} style={{padding:'8px 16px',background:`${G.gold}18`,border:`1px solid ${G.gold}55`,color:G.gold,fontFamily:'Orbitron',fontSize:8,borderRadius:2,letterSpacing:1}}>ENVIAR</button>
        </div>
      </Panel>

      <div style={{width:240,flexShrink:0,display:'flex',flexDirection:'column',gap:8}}>
        <Panel style={{padding:14}}>
          <SectionHeader title="SLA OPERACIONAL"/>
          {[['Fila WhatsApp',whatsappQueue,whatsappQueue>4?G.red:G.green],['Mensagens Criticas',criticalCount,criticalCount>0?G.red:G.amber],['Nao lidas',unreadCount,unreadCount>0?G.amber:G.green]].map(([l,v,c])=>(
            <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:`1px solid ${G.border}15`}}>
              <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{l}</span>
              <span style={{fontFamily:'Orbitron',fontSize:10,color:c}}>{v}</span>
            </div>
          ))}
        </Panel>

        <Panel style={{padding:14,flex:1,overflow:'auto'}}>
          <SectionHeader title="NOTIFICACOES"/>
          {notifications.map((n,i)=>{
            const c=n.type==='crit'?G.red:n.type==='warn'?G.amber:n.type==='ok'?G.green:G.teal;
            return(
              <div key={i} style={{display:'flex',gap:8,padding:'8px 0',borderBottom:`1px solid ${G.border}15`,opacity:n.read?0.6:1}}>
                <div style={{width:3,background:c,flexShrink:0,borderRadius:2}}/>
                <div>
                  <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,lineHeight:1.4}}>{n.msg}</div>
                  <div style={{fontFamily:'Orbitron',fontSize:7,color:c,marginTop:2}}>{n.time}</div>
                </div>
              </div>
            );
          })}
        </Panel>
      </div>
    </div>
  );
}
/* ═══════════════════════════════════════════════════════════
   BLOCO OPERATÓRIO
═══════════════════════════════════════════════════════════ */
function BlocoOperatorio() {
  const [sels,setSels]=useState(null);
  const [surgModal,setSurgModal]=useState(false);
  const [surgForm,setSurgForm]=useState({patient:'',proc:'',surgeon:'',date:new Date().toISOString().split('T')[0],time:'08:00',sala:'BO-1',anest:'Geral',duracao:'60 min'});
  const [checklist,setChecklist]=useState({consOk:false,jejumOk:false,anestOk:false,convOk:false,matOk:false,identOk:false,equipeOk:false,safetyOk:false});

  const stCol={Agendada:G.gold,Confirmada:G.green,'Em curso':G.red};
  const {surgeries:SURGERIES_DATA,setSurgeries,patients,staff} = useClinic();
  const S=sels?SURGERIES_DATA.find(s=>s.id===sels):null;
  const allChecked = Object.values(checklist).every(Boolean);

  const rooms = [
    {id:'BO-1',name:'Bloco Op. 1',status:SURGERIES_DATA.some(s=>s.sala==='BO-1'&&s.status==='Em curso')?'Em Uso':'Disponível',
      col:SURGERIES_DATA.some(s=>s.sala==='BO-1'&&s.status==='Em curso')?G.red:G.green},
    {id:'BO-2',name:'Bloco Op. 2',status:'Disponível',col:G.green},
    {id:'BO-3',name:'Bloco Op. 3',status:'Manutenção',col:G.amber},
  ];

  return(
    <div style={{display:'flex',gap:10,height:'100%',padding:10}}>
      <div style={{flex:1,display:'flex',flexDirection:'column',gap:10,overflow:'auto'}}>
        {/* Room status */}
        <div style={{display:'flex',gap:8}}>
          {rooms.map((r,i)=>(
            <Panel key={r.id} style={{flex:1,padding:14,border:`1px solid ${r.col}44`}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                <div style={{fontFamily:'Cinzel',fontSize:11,color:r.col}}>{r.name}</div>
                <Dot col={r.col} pulse={r.status==='Em Uso'}/>
              </div>
              <Badge text={r.status} col={r.col}/>
              {r.status==='Em Uso'&&<div style={{marginTop:6,fontFamily:'Rajdhani',fontSize:10,color:G.dim}}>Intervenção em curso</div>}
            </Panel>
          ))}
        </div>

        {/* Surgeries list */}
        <Panel style={{padding:14}}>
          <SectionHeader title="AGENDA CIRÚRGICA" action={()=>setSurgModal(true)} actionLabel="+ MARCAR"/>
          {SURGERIES_DATA.map((s,i)=>(
            <div key={i} onClick={()=>setSels(sels===s.id?null:s.id)}
              style={{display:'flex',gap:12,alignItems:'center',padding:'11px 0',
                borderBottom:`1px solid ${G.border}15`,cursor:'pointer',
                background:sels===s.id?`${G.gold}06`:'transparent',
                animation:`fadeUp ${0.2+i*0.07}s ease`}}>
              <div style={{fontFamily:'Orbitron',fontSize:11,color:G.gold,width:45,flexShrink:0}}>{s.time}</div>
              <div style={{flex:1}}>
                <div style={{fontFamily:'Rajdhani',fontSize:13,color:G.text,fontWeight:600}}>{s.proc}</div>
                <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,marginTop:2}}>{s.patient} · {s.surgeon} · {s.anest}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontFamily:'Orbitron',fontSize:8,color:G.dim}}>{s.date.split('-').reverse().join('/')}</div>
                <div style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim,marginTop:2}}>{s.sala} · {s.duracao}</div>
              </div>
              <Badge text={s.status} col={stCol[s.status]||G.dim}/>
            </div>
          ))}
        </Panel>
      </div>

      {/* Checklist */}
      <div style={{width:250,flexShrink:0,display:'flex',flexDirection:'column',gap:10}}>
        <Panel style={{padding:14}}>
          <SectionHeader title="CHECKLIST CIRÚRGICO"/>
          {[
            ['consOk','Consentimento informado'],
            ['jejumOk','Jejum ≥ 6h confirmado'],
            ['anestOk','Avaliação anestesista'],
            ['convOk','Convocatória entregue'],
            ['identOk','Identificação verificada'],
            ['matOk','Material esterilizado'],
            ['equipeOk','Equipa completa presente'],
            ['safetyOk','Safety check WHO'],
          ].map(([key,label])=>(
            <label key={key} style={{display:'flex',gap:10,alignItems:'center',padding:'6px 0',
              borderBottom:`1px solid ${G.border}15`,cursor:'pointer'}}>
              <input type="checkbox" checked={checklist[key]}
                onChange={e=>setChecklist({...checklist,[key]:e.target.checked})}
                style={{accentColor:G.gold,width:14,height:14}}/>
              <span style={{fontFamily:'Rajdhani',fontSize:12,
                color:checklist[key]?G.green:G.dim,
                textDecoration:checklist[key]?'line-through':undefined}}>{label}</span>
            </label>
          ))}
          <div style={{marginTop:12,padding:'8px 10px',
            background:allChecked?`${G.green}08`:`${G.amber}06`,
            border:`1px solid ${allChecked?G.green:G.amber}44`,borderRadius:2}}>
            <div style={{fontFamily:'Orbitron',fontSize:8,color:allChecked?G.green:G.amber,letterSpacing:1}}>
              {allChecked?'✓ BLOCO PRONTO':'⚠ VERIFICAÇÃO PENDENTE'}
            </div>
          </div>
        </Panel>

        {S&&(
          <Panel style={{padding:14,animation:'fadeUp 0.25s ease'}}>
            <div style={{fontFamily:'Cinzel',fontSize:11,color:G.goldL,marginBottom:8,lineHeight:1.35}}>{S.proc}</div>
            {[['Paciente',S.patient],['Cirurgião',S.surgeon],['Data',S.date.split('-').reverse().join('/')],
              ['Hora',S.time],['Sala',S.sala],['Duração',S.duracao],['Anestesia',S.anest]].map(([l,v])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:`1px solid ${G.border}15`}}>
                <span style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim}}>{l}</span>
                <span style={{fontFamily:'Rajdhani',fontSize:10,color:G.text,textAlign:'right',maxWidth:'55%',lineHeight:1.3}}>{v}</span>
              </div>
            ))}
          </Panel>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CONFIGURAÇÕES
═══════════════════════════════════════════════════════════ */
function Configuracoes() {
  const {staff,setStaff,notifications,patients,appointments,labResults,prescriptions,invoices,stockItems,setStock,beds,messages,surgeries,integrations,setIntegrations,addNotification} = useClinic();
  const [ctab,setCtab]=useState('sistema');
  const [userModalOpen,setUserModalOpen]=useState(false);
  const [userForm,setUserForm]=useState({nome:'',cargo:'Médico',turno:'Manhã',tel:'',status:'Activo',nivel:'Clínico'});
  const [deleteModal,setDeleteModal]=useState(null); // patient to delete
  const [deletePass,setDeletePass]=useState('');
  const ADMIN_PASS = import.meta.env.VITE_ADMIN_PASS || 'fumugold2025';
  const [settings,setSettings]=useState({
    clinicName:'FUMUGOLD ClÃ­nica',clinicPhone:'+244 222 000 111',clinicEmail:'info@fumugold.ao',
    clinicAddress:'Rua da MissÃ£o 45, Luanda',lang:'PortuguÃªs',timezone:'Africa/Luanda',
    notifEmail:true,notifSMS:true,notifWhatsApp:true,
    autoBackup:true,backupFreq:'DiÃ¡rio',darkMode:true,
  });
  const [integPing,setIntegPing]=useState({status:'idle',msg:''});
  const [aiPrompt,setAiPrompt]=useState('Gerar prioridades operacionais do dia.');
  const [aiResult,setAiResult]=useState(null);
  const [archiveBusy,setArchiveBusy]=useState(false);
  const [archiveHistory,setArchiveHistory]=useState([]);
  const [supaBusy,setSupaBusy]=useState(false);
  const [syncReport,setSyncReport]=useState(null);

  const bundleData = useMemo(()=>buildClinicDataBundle({
    patients,appointments,labResults,prescriptions,invoices,
    beds,staff,messages,surgeries,notifications,stock:stockItems,
  },'manual'),[
    patients,appointments,labResults,prescriptions,invoices,
    beds,staff,messages,surgeries,notifications,stockItems,
  ]);

  const refreshArchiveHistory = useCallback(async()=>{
    try{
      const r = await window.storage.get(LOCAL_ARCHIVE_HISTORY_KEY);
      setArchiveHistory(parseJSONSafe(r?.value,[]).slice(0,8));
    }catch(_){
      setArchiveHistory([]);
    }
  },[]);

  useEffect(()=>{ if(ctab==='integracoes') refreshArchiveHistory(); },[ctab,refreshArchiveHistory]);

  const runManualArchive = async(reason='manual')=>{
    setArchiveBusy(true);
    const manualBundle = buildClinicDataBundle({
      patients,appointments,labResults,prescriptions,invoices,
      beds,staff,messages,surgeries,notifications,stock:stockItems,
    },reason);
    const res = await persistArchiveBundle(manualBundle,{
      writeToFolder:!!integrations.archiveToFolder,
      format:integrations.archiveFormat||'json',
    });

    setIntegrations(prev=>({
      ...prev,
      allowAutonomousActions:false,
      lastArchiveAt:manualBundle.meta.generatedAt,
      archiveCount:Math.max((prev.archiveCount||0)+1,res.historyCount||0),
      lastArchiveError:res.folderError||'',
    }));

    setIntegPing({
      status:res.ok?'ok':'warn',
      msg:res.ok
        ? 'Arquivo local gerado com sucesso (' + manualBundle.meta.generatedAt.replace('T',' ').slice(0,16) + ').'
        : (res.folderError||'Falha ao gerar arquivo local.'),
    });

    await refreshArchiveHistory();
    setArchiveBusy(false);
  };

  const exportSnapshotJSON = ()=>{
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    downloadFile(JSON.stringify(bundleData,null,2),'fumugold_snapshot_' + stamp + '.json','application/json;charset=utf-8');
    setIntegPing({status:'ok',msg:'Snapshot JSON exportado para o PC via download local.'});
  };

  const exportSnapshotCSV = ()=>{
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    downloadFile(buildBundleCSV(bundleData),'fumugold_snapshot_' + stamp + '.csv','text/csv;charset=utf-8');
    setIntegPing({status:'ok',msg:'Resumo CSV exportado para o PC via download local.'});
  };

  const runLocalAI = ()=>{
    if(!integrations.localAIEnabled){
      setIntegPing({status:'warn',msg:'Ative a IA local para gerar analises.'});
      return;
    }
    const result = buildLocalAIResponse(aiPrompt,bundleData);
    setAiResult(result);
  };

  const runSupabaseProbe = async()=>{
    setSupaBusy(true);
    const probe = await probeSupabase({
      supabaseUrl:integrations.supabaseUrl,
      supabaseAnonKey:integrations.supabaseAnonKey,
    });

    setIntegPing({status:probe.ok?'ok':'warn',msg:probe.message});
    setIntegrations(prev=>({
      ...prev,
      syncStatus:probe.ok?'ready':'pending',
      lastSyncAt:probe.ok?new Date().toISOString():prev.lastSyncAt,
    }));
    setSupaBusy(false);
  };

  const runSupabaseSync = async()=>{
    setSupaBusy(true);

    const result = await syncClinicToSupabase({
      supabaseUrl:integrations.supabaseUrl,
      supabaseAnonKey:integrations.supabaseAnonKey,
      tableMap:integrations.tableMap||{},
    },{
      patients,appointments,labResults,prescriptions,invoices,
      beds,staff,messages,surgeries,notifications,stock:stockItems,
    });

    setSyncReport(result);
    setIntegrations(prev=>({
      ...prev,
      syncStatus:result.ok?'ready':'error',
      lastSyncAt:new Date().toISOString(),
    }));

    setIntegPing({
      status:result.ok?'ok':'warn',
      msg:result.message,
    });

    setSupaBusy(false);
  };

  const pickLocalFolder = async()=>{
    try{
      if(typeof window.showDirectoryPicker!=='function'){
        setIntegPing({status:'warn',msg:'Navegador sem suporte a seletor de pasta local. Use exportacao por download.'});
        return;
      }
      const dirHandle = await window.showDirectoryPicker({mode:'readwrite'});
      window.__fgArchiveDirHandle = dirHandle;
      setIntegrations(prev=>({...prev,archiveToFolder:true,archiveFolderName:dirHandle.name||'Pasta local'}));
      setIntegPing({status:'ok',msg:'Pasta local conectada: ' + (dirHandle.name||'Pasta local')});
    }catch(_){
      setIntegPing({status:'warn',msg:'Selecao de pasta cancelada.'});
    }
  };

  // Real audit derived from actual data
  const AUDIT = [
    ...patients.slice(0,3).map(p=>({user:'Sistema',action:`Registo paciente — ${p.nome}`,time:p.ultima||'—',type:'write'})),
    ...appointments.slice(0,3).map(a=>({user:a.doctor||'—',action:`Agendamento — ${a.patient}`,time:a.time||'—',type:'write'})),
    ...prescriptions.slice(0,2).map(rx=>({user:rx.medico||'—',action:`Prescrição ${rx.med} — ${rx.patient}`,time:rx.data||'—',type:'write'})),
    ...labResults.slice(0,2).map(r=>({user:'Lab',action:`Exame ${r.exam} — ${r.patient}`,time:r.date||'—',type:'read'})),
  ].slice(0,15);

  const CTABS=[{id:'sistema',label:'SISTEMA'},{id:'utilizadores',label:'UTILIZADORES'},
               {id:'notificacoes',label:'NOTIFICAÇÕES'},{id:'auditoria',label:'AUDITORIA'},
               {id:'integracoes',label:'INTEGRAÇÕES'},{id:'seguranca',label:'SEGURANÇA'}];

  const Toggle = ({val,onChange}) => (
    <div onClick={()=>onChange(!val)} style={{width:36,height:20,borderRadius:10,cursor:'pointer',
      background:val?`${G.gold}50`:`${G.dim}30`,border:`1px solid ${val?G.gold:G.dim}55`,
      position:'relative',transition:'all 0.2s'}}>
      <div style={{position:'absolute',top:2,left:val?16:2,width:14,height:14,
        borderRadius:'50%',background:val?G.gold:G.dim,transition:'left 0.2s'}}/>
    </div>
  );

  return(<>
    <div style={{display:'flex',gap:10,height:'100%',padding:10}}>
      <div style={{width:180,flexShrink:0}}>
        <Panel style={{padding:8}}>
          {CTABS.map(t=>(
            <button key={t.id} onClick={()=>setCtab(t.id)}
              style={{width:'100%',padding:'8px 12px',marginBottom:3,textAlign:'left',
                fontFamily:'Orbitron',fontSize:7,letterSpacing:1.5,
                background:ctab===t.id?`${G.gold}14`:'transparent',
                border:`1px solid ${ctab===t.id?G.gold:'transparent'}`,
                color:ctab===t.id?G.gold:G.dim,borderRadius:2}}>
              {t.label}
            </button>
          ))}
        </Panel>
      </div>

      <div style={{flex:1,overflow:'auto'}}>
        {ctab==='sistema'&&(
          <>
          <Panel style={{padding:20}}>
            <SectionHeader title="CONFIGURAÇÕES DO SISTEMA"/>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
              <div>
                <div style={{fontFamily:'Cinzel',fontSize:9,color:G.dim,letterSpacing:2,marginBottom:12}}>DADOS DA CLÍNICA</div>
                {[['Nome',settings.clinicName,'clinicName'],['Telefone',settings.clinicPhone,'clinicPhone'],
                  ['Email',settings.clinicEmail,'clinicEmail'],['Endereço',settings.clinicAddress,'clinicAddress']
                ].map(([l,v,k])=>(
                  <FormRow key={k} label={l}>
                    <GInput value={v} onChange={e=>setSettings({...settings,[k]:e.target.value})} placeholder={l}/>
                  </FormRow>
                ))}
              </div>
              <div>
                <div style={{fontFamily:'Cinzel',fontSize:9,color:G.dim,letterSpacing:2,marginBottom:12}}>SISTEMA & LOCALIZAÇÃO</div>
                <FormRow label="Idioma"><GSelect value={settings.lang} onChange={e=>setSettings({...settings,lang:e.target.value})} options={['Português','English','Français']}/></FormRow>
                <FormRow label="Fuso Horário"><GSelect value={settings.timezone} onChange={e=>setSettings({...settings,timezone:e.target.value})} options={['Africa/Luanda','Europe/Lisbon','UTC']}/></FormRow>
                <FormRow label="Backup Freq."><GSelect value={settings.backupFreq} onChange={e=>setSettings({...settings,backupFreq:e.target.value})} options={['Horário','Diário','Semanal']}/></FormRow>
                <FormRow label="Backup Auto">
                  <div style={{display:'flex',alignItems:'center'}}><Toggle val={settings.autoBackup} onChange={v=>setSettings({...settings,autoBackup:v})}/></div>
                </FormRow>
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:20,
              borderTop:`1px solid ${G.border}`,paddingTop:16}}>
              <button style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 18px',background:`${G.gold}18`,
                border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1}}>GUARDAR</button>
            </div>
          </Panel>
          <Panel style={{padding:20,marginTop:10}}>
            <SectionHeader title="STOCK FARMÁCIA (PILOTO)"/>
            <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,marginBottom:14,lineHeight:1.5}}>
              Sincroniza com Supabase (<code style={{color:G.teal}}>fg_stock_items</code>). Ao gravar uma prescrição, desconta 1 unidade quando o medicamento corresponde ao nome do artigo.
            </div>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  {['Artigo','Qtd','Mín.','Un.',''].map((h)=>(
                    <th key={h} style={{padding:'6px 8px',fontFamily:'Orbitron',fontSize:7,color:G.dim,textAlign:'left',borderBottom:`1px solid ${G.border}`}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(stockItems||[]).map((s)=>(
                  <tr key={s.id}>
                    <td style={{padding:'8px',fontFamily:'Rajdhani',fontSize:12,color:G.text,borderBottom:`1px solid ${G.border}10`}}>{s.nome}</td>
                    <td style={{padding:'8px',borderBottom:`1px solid ${G.border}10`}}>
                      <GInput type="number" value={s.qty} onChange={(e)=>setStock((prev)=>prev.map((x)=>x.id===s.id?{...x,qty:Math.max(0,parseInt(e.target.value,10)||0)}:x))} style={{width:72}}/>
                    </td>
                    <td style={{padding:'8px',borderBottom:`1px solid ${G.border}10`}}>
                      <GInput type="number" value={s.minQty} onChange={(e)=>setStock((prev)=>prev.map((x)=>x.id===s.id?{...x,minQty:Math.max(0,parseInt(e.target.value,10)||0)}:x))} style={{width:56}}/>
                    </td>
                    <td style={{padding:'8px',fontFamily:'Orbitron',fontSize:9,color:G.dim,borderBottom:`1px solid ${G.border}10`}}>{s.unit||'—'}</td>
                    <td style={{padding:'8px',borderBottom:`1px solid ${G.border}10`}}>
                      <button type="button" onClick={()=>setStock((prev)=>prev.filter((x)=>x.id!==s.id))} style={{background:'none',color:G.red,fontSize:11,cursor:'pointer'}}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" onClick={()=>setStock((p)=>[...p,{id:`stk_${Date.now()}`,nome:'Novo artigo',sku:'',qty:0,minQty:0,unit:'cp'}])}
              style={{marginTop:12,fontFamily:'Orbitron',fontSize:7,padding:'6px 14px',background:`${G.gold}12`,border:`1px solid ${G.gold}55`,color:G.gold,borderRadius:1}}>+ ARTIGO</button>
          </Panel>
          </>
        )}

        {ctab==='utilizadores'&&(
          <Panel style={{padding:20}}>
            <SectionHeader title="GESTÃO DE UTILIZADORES" action={()=>setUserModalOpen(true)} actionLabel="+ NOVO"/>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  {['Nome','Cargo','Nível','Estado','Acções'].map(h=>(
                    <th key={h} style={{padding:'7px 10px',fontFamily:'Orbitron',fontSize:7,color:G.dim,
                      textAlign:'left',borderBottom:`1px solid ${G.border}`,letterSpacing:1}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(()=>{
            const saveNewUser=()=>{if(!userForm.nome.trim())return;setStaff(p=>[...p,{...userForm,id:Date.now(),initials:userForm.nome.split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase(),cor:['#D4AF37','#00AAFF','#00CC88','#FF9944','#AA55FF'][Math.floor(Math.random()*5)],ferias:'—',folga:'—'}]);setUserModalOpen(false);setUserForm({nome:'',cargo:'Médico',turno:'Manhã',tel:'',status:'Activo',nivel:'Clínico'});};
            return null;
          })()||null}
          {staff.map((u,i)=>(

                  <tr key={i} onMouseEnter={e=>e.currentTarget.style.background='rgba(212,175,55,0.03)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{padding:'9px 10px',fontFamily:'Rajdhani',fontSize:12,color:G.text,borderBottom:`1px solid ${G.border}10`}}>{u.nome}</td>
                    <td style={{padding:'9px 10px',fontFamily:'Rajdhani',fontSize:12,color:G.dim,borderBottom:`1px solid ${G.border}10`}}>{u.cargo?.split('—')[0]||u.cargo}</td>
                    <td style={{padding:'9px 10px',borderBottom:`1px solid ${G.border}10`}}><Badge text={u.nivel||'Clínico'} col={(u.nivel||'')==='Super Admin'?G.red:(u.nivel||'')==='Clínico'?G.teal:G.gold} small/></td>
                    <td style={{padding:'9px 10px',borderBottom:`1px solid ${G.border}10`}}><Badge text={u.status||'Activo'} col={u.status==='Folga'?G.amber:G.green} small/></td>
                    <td style={{padding:'9px 10px',borderBottom:`1px solid ${G.border}10`}}>
                      <div style={{display:'flex',gap:6}}>
                        <button onClick={()=>{const n=prompt('Novo nome:',u.nome);if(n)setStaff(p=>p.map(s=>s.id===u.id?{...s,nome:n}:s));}} style={{background:'none',color:G.dim,fontSize:11,cursor:'pointer'}} title='Editar'>✏</button>
                        <button onClick={()=>{const p=prompt('Nova senha:');if(p)alert('Senha actualizada (integrar com auth system)');}} style={{background:'none',color:G.dim,fontSize:11,cursor:'pointer'}} title='Senha'>🔑</button>
                        <button onClick={()=>{if(confirm(`Remover ${u.nome}?`))setStaff(p=>p.filter(s=>s.id!==u.id));}} style={{background:'none',color:G.red,fontSize:11,cursor:'pointer'}} title='Remover'>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}

        {ctab==='notificacoes'&&(
          <Panel style={{padding:20}}>
            <SectionHeader title="CONFIGURAÇÕES DE NOTIFICAÇÕES"/>
            {[['Email','notifEmail','Enviar alertas clínicos por email'],
              ['SMS','notifSMS','Notificações SMS para pacientes'],
              ['WhatsApp','notifWhatsApp','Mensagens automáticas WhatsApp'],
            ].map(([l,k,desc])=>(
              <div key={k} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                padding:'14px 0',borderBottom:`1px solid ${G.border}15`}}>
                <div>
                  <div style={{fontFamily:'Rajdhani',fontSize:13,color:G.text,fontWeight:600,marginBottom:3}}>{l}</div>
                  <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{desc}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontFamily:'Orbitron',fontSize:8,color:settings[k]?G.green:G.dim}}>
                    {settings[k]?'ACTIVO':'INACTIVO'}
                  </span>
                  <div style={{display:'flex',alignItems:'center'}}>
                    <div onClick={()=>setSettings({...settings,[k]:!settings[k]})}
                      style={{width:40,height:22,borderRadius:11,cursor:'pointer',
                        background:settings[k]?`${G.gold}50`:`${G.dim}30`,
                        border:`1px solid ${settings[k]?G.gold:G.dim}55`,
                        position:'relative',transition:'all 0.2s'}}>
                      <div style={{position:'absolute',top:3,left:settings[k]?19:3,width:14,height:14,
                        borderRadius:'50%',background:settings[k]?G.gold:G.dim,transition:'left 0.2s'}}/>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </Panel>
        )}

        {ctab==='auditoria'&&(
          <Panel style={{padding:20}}>
            <SectionHeader title="LOG DE AUDITORIA"/>
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr>
                  {['Utilizador','Acção','Hora','Tipo'].map(h=>(
                    <th key={h} style={{padding:'6px 10px',fontFamily:'Orbitron',fontSize:7,color:G.dim,
                      textAlign:'left',borderBottom:`1px solid ${G.border}`}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {AUDIT.map((a,i)=>{
                  const tc={read:G.teal,write:G.gold,auth:G.green};
                  return(
                    <tr key={i} onMouseEnter={e=>e.currentTarget.style.background='rgba(212,175,55,0.03)'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <td style={{padding:'8px 10px',fontFamily:'Rajdhani',fontSize:12,color:G.text,borderBottom:`1px solid ${G.border}10`}}>{a.user}</td>
                      <td style={{padding:'8px 10px',fontFamily:'Rajdhani',fontSize:11,color:G.dim,borderBottom:`1px solid ${G.border}10`}}>{a.action}</td>
                      <td style={{padding:'8px 10px',fontFamily:'Orbitron',fontSize:8,color:G.dim,borderBottom:`1px solid ${G.border}10`}}>{a.time}</td>
                      <td style={{padding:'8px 10px',borderBottom:`1px solid ${G.border}10`}}><Badge text={a.type.toUpperCase()} col={tc[a.type]||G.dim} small/></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        )}

        {ctab==='integracoes'&&(
          <Panel style={{padding:20}}>
            <SectionHeader title="CENTRO DE INTEGRAÇÕES"/>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18}}>
              <div>
                <div style={{fontFamily:'Cinzel',fontSize:9,color:G.dim,letterSpacing:2,marginBottom:10}}>SUPABASE</div>
                <FormRow label="Project URL"><GInput value={integrations.supabaseUrl||''} onChange={e=>setIntegrations({...integrations,supabaseUrl:e.target.value})} placeholder="https://xxxx.supabase.co"/></FormRow>
                <FormRow label="Anon Key"><GInput value={integrations.supabaseAnonKey||''} onChange={e=>setIntegrations({...integrations,supabaseAnonKey:e.target.value})} placeholder="eyJ..."/></FormRow>
                <FormRow label="Service Key"><GInput type="password" value={integrations.supabaseServiceRole||''} onChange={e=>setIntegrations({...integrations,supabaseServiceRole:e.target.value})} placeholder="service_role (opcional)"/></FormRow>
              </div>
              <div>
                <div style={{fontFamily:'Cinzel',fontSize:9,color:G.dim,letterSpacing:2,marginBottom:10}}>N8N + WHATSAPP</div>
                <FormRow label="Webhook Entrada"><GInput value={integrations.n8nWebhookIn||''} onChange={e=>setIntegrations({...integrations,n8nWebhookIn:e.target.value})} placeholder="https://n8n.../whatsapp-webhook"/></FormRow>
                <FormRow label="Webhook Saída"><GInput value={integrations.n8nWebhookOut||''} onChange={e=>setIntegrations({...integrations,n8nWebhookOut:e.target.value})} placeholder="https://n8n.../send"/></FormRow>
                <FormRow label="Provider"><GSelect value={integrations.whatsappProvider||'Evolution API'} onChange={e=>setIntegrations({...integrations,whatsappProvider:e.target.value})} options={['Evolution API','Twilio','Meta Cloud API']}/></FormRow>
                <FormRow label="Auto Sync">
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <Toggle val={!!integrations.autoSync} onChange={v=>setIntegrations({...integrations,autoSync:v})}/>
                    <span style={{fontFamily:'Orbitron',fontSize:8,color:integrations.autoSync?G.green:G.dim}}>{integrations.autoSync?'ATIVO':'INATIVO'}</span>
                  </div>
                </FormRow>
              </div>
            </div>

            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16,borderTop:`1px solid ${G.border}`,paddingTop:14}}>
              <button onClick={runSupabaseProbe} disabled={supaBusy}
                style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 14px',background:`${G.teal}14`,border:`1px solid ${G.teal}`,color:G.teal,borderRadius:1,opacity:supaBusy?0.6:1}}>
                {supaBusy?'A TESTAR...':'TESTAR SUPABASE'}
              </button>
              <button onClick={runSupabaseSync} disabled={supaBusy}
                style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 14px',background:`${G.green}14`,border:`1px solid ${G.green}`,color:G.green,borderRadius:1,opacity:supaBusy?0.6:1}}>
                {supaBusy?'A SINCRONIZAR...':'SYNC SUPABASE'}
              </button>
              <button onClick={()=>{
                setIntegPing({status:'ok',msg:'ConfiguraÃ§Ãµes guardadas localmente com sucesso.'});
                setIntegrations({...integrations,lastSyncAt:new Date().toISOString()});
              }} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 14px',background:`${G.gold}18`,border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1}}>GUARDAR</button>
            </div>

            <div style={{marginTop:14,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
              <div style={{padding:10,border:`1px solid ${G.border}`,borderRadius:2,background:'rgba(212,175,55,0.03)'}}>
                <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>MENSAGENS CRM</div>
                <div style={{fontFamily:'Orbitron',fontSize:16,color:G.gold,marginTop:5}}>{messages.length}</div>
              </div>
              <div style={{padding:10,border:`1px solid ${G.border}`,borderRadius:2,background:'rgba(212,175,55,0.03)'}}>
                <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>STATUS SYNC</div>
                <div style={{fontFamily:'Orbitron',fontSize:12,color:integrations.syncStatus==='ready'?G.green:G.amber,marginTop:7}}>{(integrations.syncStatus||'idle').toUpperCase()}</div>
              </div>
              <div style={{padding:10,border:`1px solid ${G.border}`,borderRadius:2,background:'rgba(212,175,55,0.03)'}}>
                <div style={{fontFamily:'Orbitron',fontSize:7,color:G.dim}}>ÚLTIMO SYNC</div>
                <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,marginTop:5}}>{integrations.lastSyncAt?new Date(integrations.lastSyncAt).toLocaleString('pt-PT'):'--'}</div>
              </div>
            </div>

            {integPing.msg && (
              <div style={{marginTop:12,padding:'9px 10px',borderRadius:2,
                background:integPing.status==='ok'?`${G.green}10`:`${G.amber}10`,
                border:`1px solid ${integPing.status==='ok'?G.green:G.amber}66`,
                fontFamily:'Rajdhani',fontSize:12,color:integPing.status==='ok'?G.green:G.amber}}>
                {integPing.msg}
              </div>
            )}

            {syncReport && (
              <div style={{marginTop:10,padding:10,border:'1px solid '+G.border,borderRadius:2,background:'rgba(212,175,55,0.03)'}}>
                <div style={{fontFamily:'Rajdhani',fontSize:12,color:syncReport.ok?G.green:G.amber,fontWeight:600}}>{syncReport.message}</div>
                <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,marginTop:4}}>
                  Enviados: {syncReport.sent||0} · Falhas: {syncReport.failed||0}
                </div>
                <div style={{marginTop:6,display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:6}}>
                  {(syncReport.details||[]).slice(0,6).map(d=>(
                    <div key={d.table} style={{padding:'6px 8px',border:'1px solid '+G.border,borderRadius:2}}>
                      <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.text}}>{d.datasetKey}</div>
                      <div style={{fontFamily:'Rajdhani',fontSize:10,color:d.ok?G.green:G.amber}}>{d.ok?'OK':'ERRO'} · {d.sent||0} reg.</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{marginTop:14,display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div style={{padding:12,border:'1px solid '+G.border,borderRadius:2,background:'rgba(212,175,55,0.03)'}}>
                <div style={{fontFamily:'Cinzel',fontSize:10,color:G.gold,letterSpacing:1.6,marginBottom:10}}>IA LOCAL ASSISTIVA</div>

                <FormRow label="Ativar IA Local">
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <Toggle val={!!integrations.localAIEnabled} onChange={v=>setIntegrations({...integrations,localAIEnabled:v,allowAutonomousActions:false})}/>
                    <span style={{fontFamily:'Orbitron',fontSize:8,color:integrations.localAIEnabled?G.green:G.dim}}>{integrations.localAIEnabled?'ATIVA':'INATIVA'}</span>
                  </div>
                </FormRow>

                <FormRow label="Autonomia">
                  <span style={{fontFamily:'Orbitron',fontSize:8,color:G.red}}>BLOQUEADA</span>
                </FormRow>

                <textarea value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)}
                  placeholder="Peca um resumo, prioridades clinicas ou riscos financeiros..."
                  style={{marginTop:8,width:'100%',minHeight:76,resize:'vertical',background:'rgba(212,175,55,0.05)',border:'1px solid '+G.border,borderRadius:2,padding:'8px 10px',color:G.text,fontFamily:'Rajdhani',fontSize:12,lineHeight:1.4}}/>

                <div style={{display:'flex',gap:8,marginTop:8}}>
                  <button onClick={runLocalAI} style={{fontFamily:'Orbitron',fontSize:8,padding:'7px 12px',background:'rgba(0,204,255,0.12)',border:'1px solid '+G.teal,color:G.teal,borderRadius:1}}>ANALISAR</button>
                  <button onClick={()=>{setAiPrompt('Gerar prioridades operacionais do dia.');setAiResult(null);}} style={{fontFamily:'Orbitron',fontSize:8,padding:'7px 12px',background:'transparent',border:'1px solid '+G.border,color:G.dim,borderRadius:1}}>LIMPAR</button>
                </div>

                {aiResult && (
                  <div style={{marginTop:10,padding:10,border:'1px solid '+G.border,borderRadius:2,background:'rgba(0,0,0,0.25)'}}>
                    <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,lineHeight:1.45}}>{aiResult.summary}</div>
                    <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,marginTop:6}}>{aiResult.guardrail}</div>

                    <div style={{marginTop:8,display:'grid',gap:6}}>
                      {aiResult.suggestions.map(s=>(
                        <div key={s.id} style={{padding:'7px 8px',border:'1px solid '+G.border,borderRadius:2}}>
                          <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,fontWeight:600}}>{s.title}</div>
                          <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,marginTop:2}}>{s.detail}</div>
                          <button onClick={()=>addNotification('warn','IA local recomenda: '+s.title+' - '+s.detail)} style={{marginTop:6,fontFamily:'Orbitron',fontSize:7,padding:'5px 10px',background:'rgba(212,175,55,0.14)',border:'1px solid '+G.gold,color:G.gold,borderRadius:1}}>ENVIAR PARA ALERTAS</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div style={{padding:12,border:'1px solid '+G.border,borderRadius:2,background:'rgba(212,175,55,0.03)'}}>
                <div style={{fontFamily:'Cinzel',fontSize:10,color:G.gold,letterSpacing:1.6,marginBottom:10}}>ARQUIVAMENTO LOCAL (PC)</div>

                <FormRow label="Auto Arquivo">
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <Toggle val={!!integrations.localArchiveEnabled} onChange={v=>setIntegrations({...integrations,localArchiveEnabled:v})}/>
                    <span style={{fontFamily:'Orbitron',fontSize:8,color:integrations.localArchiveEnabled?G.green:G.dim}}>{integrations.localArchiveEnabled?'ATIVO':'INATIVO'}</span>
                  </div>
                </FormRow>

                <FormRow label="Freq (min)">
                  <GSelect value={String(integrations.archiveFrequencyMin||15)} onChange={e=>setIntegrations({...integrations,archiveFrequencyMin:Number(e.target.value)||15})} options={['5','15','30','60']}/>
                </FormRow>

                <FormRow label="Formato">
                  <GSelect value={integrations.archiveFormat||'json'} onChange={e=>setIntegrations({...integrations,archiveFormat:e.target.value})} options={['json','csv']}/>
                </FormRow>

                <FormRow label="Pasta Local">
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <button onClick={pickLocalFolder} style={{fontFamily:'Orbitron',fontSize:7,padding:'6px 10px',background:'rgba(0,204,255,0.12)',border:'1px solid '+G.teal,color:G.teal,borderRadius:1}}>SELECIONAR</button>
                    <span style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{integrations.archiveFolderName||'nao definida'}</span>
                  </div>
                </FormRow>

                <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,marginTop:8}}>
                  <button onClick={()=>runManualArchive('manual')} disabled={archiveBusy} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 10px',background:'rgba(212,175,55,0.14)',border:'1px solid '+G.gold,color:G.gold,borderRadius:1,opacity:archiveBusy?0.6:1}}>{archiveBusy?'A GUARDAR...':'ARQUIVAR AGORA'}</button>
                  <button onClick={exportSnapshotJSON} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 10px',background:'transparent',border:'1px solid '+G.border,color:G.text,borderRadius:1}}>EXPORTAR JSON</button>
                  <button onClick={exportSnapshotCSV} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 10px',background:'transparent',border:'1px solid '+G.border,color:G.text,borderRadius:1}}>EXPORTAR CSV</button>
                  <button onClick={refreshArchiveHistory} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 10px',background:'transparent',border:'1px solid '+G.border,color:G.text,borderRadius:1}}>ATUALIZAR HIST.</button>
                </div>

                <div style={{marginTop:10,padding:10,border:'1px solid '+G.border,borderRadius:2,background:'rgba(0,0,0,0.25)'}}>
                  <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text}}>Ultimo arquivo: {integrations.lastArchiveAt?new Date(integrations.lastArchiveAt).toLocaleString('pt-PT'):'--'}</div>
                  <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim,marginTop:2}}>Total historico: {archiveHistory.length} registros recentes</div>
                  {integrations.lastArchiveError && <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.amber,marginTop:4}}>Erro pasta local: {integrations.lastArchiveError}</div>}
                </div>

                <div style={{marginTop:8,maxHeight:120,overflowY:'auto',border:'1px solid '+G.border,borderRadius:2}}>
                  {archiveHistory.length===0 ? (
                    <div style={{padding:10,fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>Sem historico local ainda.</div>
                  ) : archiveHistory.map(item=>(
                    <div key={item.id} style={{padding:'7px 9px',borderBottom:'1px solid '+G.border+'22'}}>
                      <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.text}}>{new Date(item.generatedAt).toLocaleString('pt-PT')} · {item.reason}</div>
                      <div style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim}}>Pacientes: {item.kpis?.totalPatients||0} · Consultas: {item.kpis?.totalAppointments||0}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        )}

        {ctab==='seguranca'&&(
          <Panel style={{padding:20}}>
            <SectionHeader title="SEGURANÇA & ACESSO"/>
            {[['Autenticação 2FA','Activada','Verificação dupla por SMS',G.green],
              ['Sessões Activas','2','Luanda · Chrome',G.teal],
              ['Última Alteração de Senha','15/01/2025','Recomendado: 90 dias',G.gold],
              ['Nível de Encriptação','AES-256','Dados em repouso e em trânsito',G.green],
              ['Certificado SSL','Válido até 2026','TLS 1.3',G.green],
              ['LGPD / Protecção Dados','Conforme','Política privacidade actualizada',G.green],
            ].map(([l,v,desc,c])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                padding:'12px 0',borderBottom:`1px solid ${G.border}15`}}>
                <div>
                  <div style={{fontFamily:'Rajdhani',fontSize:13,color:G.text,fontWeight:600,marginBottom:2}}>{l}</div>
                  <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>{desc}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontFamily:'Orbitron',fontSize:10,color:c,fontWeight:700}}>{v}</div>
                </div>
              </div>
            ))}
          </Panel>
        )}
      </div>
    </div>
    {userModalOpen&&(
      <Modal open={true} onClose={()=>setUserModalOpen(false)} title="NOVO UTILIZADOR" width={420}>
        <FormRow label="Nome *"><GInput value={userForm.nome} onChange={e=>setUserForm({...userForm,nome:e.target.value})} placeholder="Nome completo"/></FormRow>
        <FormRow label="Cargo"><GSelect value={userForm.cargo} onChange={e=>setUserForm({...userForm,cargo:e.target.value})} options={['Médico','Enfermeiro','Técnico Lab','Administrativo','Director','Recepcionista']}/></FormRow>
        <FormRow label="Turno"><GSelect value={userForm.turno} onChange={e=>setUserForm({...userForm,turno:e.target.value})} options={['Manhã','Tarde','Noite','Rotativo']}/></FormRow>
        <FormRow label="Tel"><GInput value={userForm.tel} onChange={e=>setUserForm({...userForm,tel:e.target.value})} placeholder="+244 9XX XXX XXX"/></FormRow>
        <FormRow label="Estado"><GSelect value={userForm.status} onChange={e=>setUserForm({...userForm,status:e.target.value})} options={['Activo','Serviço','Folga','Inactivo']}/></FormRow>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
          <button onClick={()=>setUserModalOpen(false)} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:'transparent',border:`1px solid ${G.border}`,color:G.dim,borderRadius:1}}>CANCELAR</button>
          <button onClick={()=>{if(!userForm.nome.trim())return;const ini=userForm.nome.split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase();const col=['#D4AF37','#00AAFF','#00CC88','#FF9944','#AA55FF'][Math.floor(Math.random()*5)];setStaff(p=>[...p,{...userForm,id:Date.now(),initials:ini,cor:col,ferias:'—',folga:'—'}]);setUserModalOpen(false);setUserForm({nome:'',cargo:'Médico',turno:'Manhã',tel:'',status:'Activo',nivel:'Clínico'});}} style={{fontFamily:'Orbitron',fontSize:7,padding:'7px 16px',background:`${G.gold}18`,border:`1px solid ${G.gold}`,color:G.gold,borderRadius:1}}>◈ CRIAR</button>
        </div>
      </Modal>
    )}
  </>);
}

/* ═══════════════════════════════════════════════════════════
   THREE.JS HOOK — ENHANCED HOLOGRAPHIC ENGINE
═══════════════════════════════════════════════════════════ */
function useThreeJS(threeRef, cleanupRef) {
  useEffect(()=>{
    let animId, ren, scene, cam, body, meshMap={};
    let scan, scan2, scan3, pts, orbitRings=[], pillars=[], markerGroup;
    let drag=false, px=0, py=0, ry=0, rx=0, t=0;
    let pl1, pl2, pl3, topSpot, heartLight, rimLight;
    let dnaGroup, neuralGroup, energyField, labelGroup;
    let hoveredMesh=null, raycaster, mouse;
    let labelSprites={};
    let glowGroup, vasGroup;

    const makeSprite=(text,col='#D4AF37')=>{
      const cv=document.createElement('canvas');
      cv.width=280;cv.height=60;
      const c=cv.getContext('2d');
      c.clearRect(0,0,280,60);
      c.fillStyle='rgba(4,3,0,0.92)';
      c.roundRect?c.roundRect(0,0,280,60,3):c.fillRect(0,0,280,60);
      c.fill();
      // Glow border
      c.shadowColor=col;c.shadowBlur=6;
      c.strokeStyle=col;c.lineWidth=0.8;
      c.strokeRect(0.4,0.4,279.2,59.2);
      c.shadowBlur=0;
      // Left accent bar
      c.fillStyle=col;c.fillRect(0,0,3,60);
      c.fillStyle=col;c.font='bold 12px Orbitron,monospace';
      c.textAlign='left';c.textBaseline='middle';
      c.shadowColor=col;c.shadowBlur=8;
      c.fillText(text,12,30);
      const tex=new THREE.CanvasTexture(cv);
      const mat=new THREE.SpriteMaterial({map:tex,transparent:true,opacity:0,depthTest:false});
      const sp=new THREE.Sprite(mat);
      sp.scale.set(0.62,0.135,1);
      return sp;
    };

    const setup=()=>{
      const cont=document.getElementById('three-canvas');
      if(!cont||cont.children.length>0)return;
      const rect=cont.getBoundingClientRect();
      let W=rect.width||900, H=rect.height||700;
      if(W<20)W=900;if(H<20)H=700;

      scene=new THREE.Scene();
      scene.fog=new THREE.FogExp2(0x010100,0.042);

      cam=new THREE.PerspectiveCamera(42,W/H,0.01,80);
      cam.position.set(0,0.6,5.2);cam.lookAt(0,0.55,0);
      let camZ=5.2;

      ren=new THREE.WebGLRenderer({antialias:true,alpha:true,logarithmicDepthBuffer:true,powerPreference:'high-performance',precision:'highp'});
      ren.setSize(W,H);ren.setPixelRatio(Math.min(window.devicePixelRatio,2));
      ren.toneMapping=THREE.ACESFilmicToneMapping;
      ren.toneMappingExposure=1.22;
      if('outputColorSpace' in ren) ren.outputColorSpace=THREE.SRGBColorSpace;      ren.setClearColor(0x000000,0);
      ren.shadowMap&&(ren.shadowMap.enabled=false);
      cont.appendChild(ren.domElement);

      raycaster=new THREE.Raycaster();
      mouse=new THREE.Vector2();

      /* ════ LIGHTING — cinematic ════ */
      scene.add(new THREE.AmbientLight(0x050403,2.0));
      // Key light — warm gold top
      const key=new THREE.DirectionalLight(0xFFDD88,0.9);key.position.set(2,8,4);scene.add(key);
      // Fill — deep blue left
      pl1=new THREE.PointLight(0x0044CC,4.5,18);pl1.position.set(-4,2,1);scene.add(pl1);
      // Rim — cyan right-back
      pl2=new THREE.PointLight(0x00FFDD,2.8,12);pl2.position.set(3,1,-2);scene.add(pl2);
      // Ground bounce — warm amber
      pl3=new THREE.PointLight(0xFF8800,1.6,10);pl3.position.set(0,-2.5,2);scene.add(pl3);
      // Top spot — electric blue
      topSpot=new THREE.SpotLight(0x0088FF,8,22,Math.PI/6,0.55,1.4);
      topSpot.position.set(0,7,0);topSpot.target.position.set(0,0.6,0);
      scene.add(topSpot);scene.add(topSpot.target);
      // Heart glow light
      heartLight=new THREE.PointLight(0xFF1122,0,1.5);
      heartLight.position.set(-0.083,1.226,0.08);scene.add(heartLight);
      // Rim backlight
      rimLight=new THREE.PointLight(0xAA44FF,1.8,14);
      rimLight.position.set(0,1.2,-3);scene.add(rimLight);

      /* ════ ENERGY FIELD (outer aura shell) ════ */
      const efGeo=new THREE.SphereGeometry(2.0,32,32);
      const efMat=new THREE.MeshBasicMaterial({color:0x001133,wireframe:false,transparent:true,
        opacity:0.0,side:THREE.BackSide});
      energyField=new THREE.Mesh(efGeo,efMat);
      energyField.position.y=0.4;scene.add(energyField);
      // Wireframe shell
      const efWire=new THREE.Mesh(new THREE.SphereGeometry(2.05,18,12),
        new THREE.MeshBasicMaterial({color:0x00CCFF,wireframe:true,transparent:true,opacity:0.012}));
      efWire.position.y=0.4;scene.add(efWire);

      /* ════ FLOOR ════ */
      // Main grid
      const gr=new THREE.GridHelper(22,44,0xD4AF37,0x0A0600);
      gr.position.y=-1.65;gr.material.opacity=0.20;gr.material.transparent=true;scene.add(gr);
      // Secondary finer grid
      const gr2=new THREE.GridHelper(12,60,0x002244,0x001122);
      gr2.position.y=-1.648;gr2.material.opacity=0.35;gr2.material.transparent=true;scene.add(gr2);
      // Projection platform disc
      const platGeo=new THREE.CylinderGeometry(0.85,0.92,0.018,80);
      const platMat=new THREE.MeshPhongMaterial({
        color:0xD4AF37,emissive:0xD4AF37,emissiveIntensity:0.5,
        transparent:true,opacity:0.22,shininess:200
      });
      const plat=new THREE.Mesh(platGeo,platMat);plat.position.y=-1.64;scene.add(plat);
      // Platform glow rings
      [[0.85,0.014,0xD4AF37,0.9],[0.65,0.009,0x00CCFF,0.65],[0.48,0.007,0xD4AF37,0.4],[0.30,0.005,0xAA44FF,0.3]].forEach(([r,th,col,op])=>{
        const m=new THREE.Mesh(new THREE.TorusGeometry(r,th,8,90),
          new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:op}));
        m.rotation.x=Math.PI/2;m.position.y=-1.64;scene.add(m);orbitRings.push({mesh:m,baseOp:op,type:'floor'});
      });
      // Body scan rings
      [[0.82,0.007,0x00CCFF,0.18,0,Math.PI/2+0.35,'mid'],
       [0.66,0.006,0xD4AF37,0.14,0.80,Math.PI/2-0.25,'chest'],
       [0.52,0.007,0xAA44FF,0.22,1.69,Math.PI/2,'head']
      ].forEach(([r,th,col,op,y,rx,type])=>{
        const m=new THREE.Mesh(new THREE.TorusGeometry(r,th,6,72),
          new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:op}));
        m.rotation.x=rx;m.position.y=y;scene.add(m);orbitRings.push({mesh:m,baseOp:op,type});
      });
      // Vertical hologram pillars
      [[-1.2,-0.5,0xD4AF37,0.10],[1.2,-0.5,0xD4AF37,0.10],
       [-1.2,0.5,0x00CCFF,0.07],[1.2,0.5,0x00CCFF,0.07],
       [0,1.4,0xAA44FF,0.06]].forEach(([x,z,col,op])=>{
        const m=new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006,4.8,5),
          new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:op}));
        m.position.set(x,0.4,z);scene.add(m);pillars.push(m);
      });

      /* ════ BODY CONSTRUCTION — LATHE + proper geometry ════ */
      body=new THREE.Group();scene.add(body);
      glowGroup=new THREE.Group();scene.add(glowGroup);

      // Material factories
      const M=(col,op,emC,emI=0.6)=>new THREE.MeshPhongMaterial({
        color:col,emissive:new THREE.Color(emC),emissiveIntensity:emI,
        transparent:true,opacity:op,shininess:180,side:THREE.DoubleSide,depthWrite:false,
      });
      const wire=(geo,col,op=0.85)=>new THREE.LineSegments(
        new THREE.EdgesGeometry(geo,12),
        new THREE.LineBasicMaterial({color:col,transparent:true,opacity:op})
      );
      const part=(name,geo,x,y,z,rx=0,ry=0,rz=0,col,op,wc,ec,emI=0.58)=>{
        const mesh=new THREE.Mesh(geo,M(col,op,ec,emI));
        mesh.position.set(x,y,z);mesh.rotation.set(rx,ry,rz);mesh.name=name;
        mesh.add(wire(geo,wc,0.75));body.add(mesh);meshMap[name]=mesh;return mesh;
      };

      /* ── TORSO (LatheGeometry — proper body silhouette) ── */
      const torsoProfile=[
        new THREE.Vector2(0.20,0.56),  // hip base
        new THREE.Vector2(0.265,0.66), // hip max
        new THREE.Vector2(0.235,0.74), // hip upper
        new THREE.Vector2(0.195,0.83), // waist
        new THREE.Vector2(0.215,0.94), // lower ribs
        new THREE.Vector2(0.265,1.06), // ribcage
        new THREE.Vector2(0.280,1.18), // chest
        new THREE.Vector2(0.285,1.28), // pectoral
        new THREE.Vector2(0.260,1.36), // upper chest
        new THREE.Vector2(0.095,1.44), // neck base
        new THREE.Vector2(0.082,1.52), // neck
      ];
      const torsoGeo=new THREE.LatheGeometry(torsoProfile,28);
      const torsoMesh=new THREE.Mesh(torsoGeo,M(0x004466,0.38,0x001133,0.55));
      torsoMesh.name='torso';
      torsoMesh.add(wire(torsoGeo,0xD4AF37,0.55));
      body.add(torsoMesh);meshMap['torso']=torsoMesh;
      meshMap['chest']=torsoMesh;meshMap['abdomen']=torsoMesh;meshMap['pelvis']=torsoMesh;meshMap['neck']=torsoMesh;

      /* ── HEAD (slightly ellipsoidal) ── */
      const headGeo=new THREE.SphereGeometry(0.188,28,28);
      const headMesh=new THREE.Mesh(headGeo,M(0x003355,0.48,0x001144,0.62));
      headMesh.scale.y=1.12;
      headMesh.position.set(0,1.694,0);headMesh.name='head';
      headMesh.add(wire(headGeo,0x22AAFF,0.65));
      body.add(headMesh);meshMap['head']=headMesh;

      /* ── BRAIN (inner, glowing) ── */
      part('brain',new THREE.SphereGeometry(0.128,22,22),0,1.74,0,0,0,0,0x001144,0.30,0x0055CC,0x000A22,0.58);

      /* ── EYES ── */
      part('eye_L',new THREE.SphereGeometry(0.030,12,12),-0.077,1.700,0.165,0,0,0,0x001166,0.90,0x0099FF,0x001133,0.85);
      part('eye_R',new THREE.SphereGeometry(0.030,12,12),0.077,1.700,0.165,0,0,0,0x001166,0.90,0x0099FF,0x001133,0.85);

      /* ── HEART (multi-sphere, anatomical) ── */
      const heartGroup=new THREE.Group();heartGroup.position.set(-0.083,1.226,0.072);
      const hGeo=new THREE.SphereGeometry(0.092,18,18);
      const hMesh=new THREE.Mesh(hGeo,M(0xAA0022,0.86,0xFF1133,1.1));
      hMesh.name='heart';hMesh.add(wire(hGeo,0xFF3355,0.9));heartGroup.add(hMesh);
      // Ventricle bumps
      [[-0.032,0.028,0],[0.028,0.022,0]].forEach(([ox,oy,oz])=>{
        const vg=new THREE.SphereGeometry(0.052,10,10);
        const vm=new THREE.Mesh(vg,M(0x880018,0.7,0xFF1133,0.9));
        vm.position.set(ox,oy,oz);heartGroup.add(vm);
      });
      heartGroup.name='heart';body.add(heartGroup);meshMap['heart']=hMesh;

      /* ── LUNGS ── */
      // Left lung (custom shape: tall, slightly curved)
      const lungLGeo=new THREE.SphereGeometry(0.115,18,18);
      const lungLMesh=new THREE.Mesh(lungLGeo,M(0x001A44,0.60,0x0055BB,0x001133,0.68));
      lungLMesh.scale.set(0.82,1.32,0.82);
      lungLMesh.position.set(-0.170,1.224,0.018);lungLMesh.name='lung_L';
      lungLMesh.add(wire(lungLGeo,0x0066CC,0.6));body.add(lungLMesh);meshMap['lung_L']=lungLMesh;
      const lungRMesh=lungLMesh.clone();
      lungRMesh.material=M(0x001A44,0.60,0x0055BB,0x001133,0.68);
      lungRMesh.position.set(0.170,1.224,0.018);lungRMesh.name='lung_R';
      const eR=lungRMesh.children[0];
      body.add(lungRMesh);meshMap['lung_R']=lungRMesh;

      /* ── LIVER ── */
      const livGeo=new THREE.SphereGeometry(0.098,16,16);
      const livMesh=new THREE.Mesh(livGeo,M(0x663300,0.62,0xAA5500,0x221100,0.65));
      livMesh.scale.set(1.35,0.72,0.88);
      livMesh.position.set(0.10,0.90,0.03);livMesh.name='liver';
      livMesh.add(wire(livGeo,0xBB6600,0.5));body.add(livMesh);meshMap['liver']=livMesh;

      /* ── KIDNEYS ── */
      [[- 0.178,0.84,-0.045,'kidney_L'],[0.178,0.84,-0.045,'kidney_R']].forEach(([x,y,z,nm])=>{
        const kg=new THREE.SphereGeometry(0.064,16,16);
        const km=new THREE.Mesh(kg,M(0x552200,0.62,0xAA5500,0x221100,0.65));
        km.scale.set(0.75,1.2,0.68);
        km.position.set(x,y,z);km.name=nm;
        km.add(wire(kg,0x996633,0.5));body.add(km);meshMap[nm]=km;
      });

      /* ── STOMACH ── */
      part('stomach',new THREE.SphereGeometry(0.082,14,14),-0.065,0.935,0.04,0,0,0,0x333300,0.52,0x888800,0x1A1A00,0.58);
      /* ── SPLEEN ── */
      part('spleen',new THREE.SphereGeometry(0.070,14,14),-0.200,0.88,-0.02,0,0,-0.2,0x440022,0.58,0xAA0055,0x220011,0.64);
      /* ── PANCREAS ── */
      part('pancreas',new THREE.SphereGeometry(0.058,12,12),0.02,0.88,-0.04,0,0,0.3,0x443300,0.55,0xBB7700,0x221800,0.58);
      /* ── BLADDER ── */
      part('bladder',new THREE.SphereGeometry(0.060,12,12),0,0.62,0.07,0,0,0,0x003355,0.55,0x006699,0x001122,0.58);
      /* ── THYROID ── */
      part('thyroid',new THREE.SphereGeometry(0.038,12,12),0,1.494,0.076,0,0,0,0x004444,0.68,0x00BBAA,0x001111,0.76);
      /* ── SPINE (tube) ── */
      const spineGeo=new THREE.CylinderGeometry(0.022,0.024,1.70,8);
      part('spine',spineGeo,0,0.68,-0.118,0,0,0,0x334422,0.50,0x88CC44,0x111800,0.58);

      /* ── SHOULDERS (round) ── */
      part('shoulder_L',new THREE.SphereGeometry(0.088,16,16),-0.332,1.375,0,0,0,0,0x003D55,0.45,0xD4AF37,0x001020,0.5);
      part('shoulder_R',new THREE.SphereGeometry(0.088,16,16),0.332,1.375,0,0,0,0,0x003D55,0.45,0xD4AF37,0x001020,0.5);
      /* ── UPPER ARMS ── */
      part('arm_L',new THREE.CylinderGeometry(0.062,0.052,0.38,14),-0.385,1.09,0,0,0,0.24,0x003D55,0.44,0xD4AF37,0x001020,0.5);
      part('arm_R',new THREE.CylinderGeometry(0.062,0.052,0.38,14),0.385,1.09,0,0,0,-0.24,0x003D55,0.44,0xD4AF37,0x001020,0.5);
      /* ── FOREARMS ── */
      part('forearm_L',new THREE.CylinderGeometry(0.050,0.042,0.34,12),-0.445,0.72,0,0,0,0.12,0x003D55,0.42,0xD4AF37,0x001020,0.5);
      part('forearm_R',new THREE.CylinderGeometry(0.050,0.042,0.34,12),0.445,0.72,0,0,0,-0.12,0x003D55,0.42,0xD4AF37,0x001020,0.5);
      /* ── HANDS ── */
      part('hand_L',new THREE.SphereGeometry(0.058,12,12),-0.470,0.555,0,0,0,0,0x003D55,0.44,0xD4AF37,0x001020,0.5);
      part('hand_R',new THREE.SphereGeometry(0.058,12,12),0.470,0.555,0,0,0,0,0x003D55,0.44,0xD4AF37,0x001020,0.5);
      /* ── PELVIS BONES ── */
      const pelvisGeo=new THREE.TorusGeometry(0.22,0.06,8,30,Math.PI*1.4);
      part('bone_pelvis',pelvisGeo,0,0.64,-0.06,Math.PI/2+0.3,0,0,0x334433,0.25,0x88CC55,0x111811,0.38);
      /* ── THIGHS ── */
      part('thigh_L',new THREE.CylinderGeometry(0.098,0.078,0.46,16),-0.142,0.375,0,0,0,0.055,0x003D55,0.44,0xD4AF37,0x001020,0.5);
      part('thigh_R',new THREE.CylinderGeometry(0.098,0.078,0.46,16),0.142,0.375,0,0,0,-0.055,0x003D55,0.44,0xD4AF37,0x001020,0.5);
      /* ── KNEES ── */
      part('knee_L',new THREE.SphereGeometry(0.065,14,14),-0.152,0.100,0.028,0,0,0,0x003D55,0.44,0xD4AF37,0x001020,0.5);
      part('knee_R',new THREE.SphereGeometry(0.065,14,14),0.152,0.100,0.028,0,0,0,0x003D55,0.44,0xD4AF37,0x001020,0.5);
      /* ── SHINS ── */
      part('shin_L',new THREE.CylinderGeometry(0.065,0.052,0.42,14),-0.152,-0.172,0,0,0,0,0x003D55,0.44,0xD4AF37,0x001020,0.5);
      part('shin_R',new THREE.CylinderGeometry(0.065,0.052,0.42,14),0.152,-0.172,0,0,0,0,0x003D55,0.44,0xD4AF37,0x001020,0.5);
      /* ── FEET ── */
      part('foot_L',new THREE.SphereGeometry(0.062,12,12),-0.152,-0.408,0.052,0.3,0,0,0x003D55,0.44,0xD4AF37,0x001020,0.5);
      part('foot_R',new THREE.SphereGeometry(0.062,12,12),0.152,-0.408,0.052,0.3,0,0,0x003D55,0.44,0xD4AF37,0x001020,0.5);
      /* ── SKIN OVERLAY (nearly transparent, just for depth) ── */
      part('skin',new THREE.SphereGeometry(0.38,22,22),0,1.3,0,0,0,0,0x112233,0.04,0x224488,0x111122,0.18);
      meshMap['joint']=meshMap['knee_L'];

      /* ════ VASCULAR SYSTEM (arteries + veins) ════ */
      vasGroup=new THREE.Group();scene.add(vasGroup);
      const artMat2=new THREE.LineBasicMaterial({color:0xFF1122,transparent:true,opacity:0.20});
      const veinMat2=new THREE.LineBasicMaterial({color:0x1155EE,transparent:true,opacity:0.16});
      const ARTERIES=[
        [[-.083,1.23,.08],[-.05,1.0,.04],[0,.80,.0],[0,.60,-.05]],  // Aorta
        [[-.083,1.23,.08],[-.18,1.22,.02],[-.24,1.08,.0]],           // L pulm
        [[-.083,1.23,.08],[.17,1.22,.02],[.24,1.08,.0]],             // R pulm
        [[0,.80,.0],[-.04,1.3,.05],[0,1.70,.0]],                    // L carotid
        [[0,.80,.0],[.04,1.3,.05],[0,1.70,.0]],                     // R carotid
        [[0,.75,.0],[.10,.90,.03],[.20,.84,-.04]],                  // Hepatic
        [[0,.75,.0],[-.18,.84,-.04]],                               // L renal
        [[0,.75,.0],[.18,.84,-.04]],                                // R renal
        [[-.332,1.375,.0],[-.42,1.05,.0],[-.47,.55,.0]],            // L brachial
        [[.332,1.375,.0],[.42,1.05,.0],[.47,.55,.0]],               // R brachial
        [[0,.60,-.02],[-.14,.38,.0],[-.152,-.17,.0]],               // L femoral
        [[0,.60,-.02],[.14,.38,.0],[.152,-.17,.0]],                 // R femoral
      ];
      ARTERIES.forEach(pts=>{
        const p3=pts.map(p=>new THREE.Vector3(...p));
        const geo=new THREE.BufferGeometry().setFromPoints(p3);
        vasGroup.add(new THREE.Line(geo,artMat2.clone()));
      });
      const VEINS=[
        [[-.083,1.23,.08],[0,.95,.0],[0,.60,.0]],
        [[.20,.84,-.04],[.08,.76,.0],[0,.60,.0]],
        [[-.18,.84,-.04],[-.08,.76,.0],[0,.60,.0]],
        [[-.47,.55,.0],[-.42,1.0,.0],[-.33,1.37,.0]],
        [[.47,.55,.0],[.42,1.0,.0],[.33,1.37,.0]],
        [[-.152,-.17,.0],[-.152,.1,.0],[-.14,.38,.0]],
        [[.152,-.17,.0],[.152,.1,.0],[.14,.38,.0]],
      ];
      VEINS.forEach(pts=>{
        const p3=pts.map(p=>new THREE.Vector3(...p));
        vasGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(p3),veinMat2.clone()));
      });

      /* ════ DNA HELIX (above head) ════ */
      dnaGroup=new THREE.Group();dnaGroup.position.set(0,2.08,0);
      const helixR=0.11,helixH=0.78,turns=3.5,HN=100;
      const dpts1=[],dpts2=[];
      for(let i=0;i<=HN;i++){
        const a=(i/HN)*Math.PI*2*turns,y=(i/HN)*helixH;
        dpts1.push(new THREE.Vector3(Math.cos(a)*helixR,y,Math.sin(a)*helixR));
        dpts2.push(new THREE.Vector3(Math.cos(a+Math.PI)*helixR,y,Math.sin(a+Math.PI)*helixR));
      }
      dnaGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(dpts1),
        new THREE.LineBasicMaterial({color:0x00CCFF,transparent:true,opacity:0.9})));
      dnaGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(dpts2),
        new THREE.LineBasicMaterial({color:0xD4AF37,transparent:true,opacity:0.9})));
      for(let i=0;i<=HN;i+=6){
        const a=(i/HN)*Math.PI*2*turns,y=(i/HN)*helixH;
        const p1=new THREE.Vector3(Math.cos(a)*helixR,y,Math.sin(a)*helixR);
        const p2=new THREE.Vector3(Math.cos(a+Math.PI)*helixR,y,Math.sin(a+Math.PI)*helixR);
        dnaGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1,p2]),
          new THREE.LineBasicMaterial({color:0x44FFAA,transparent:true,opacity:0.3})));
        const sg=new THREE.SphereGeometry(0.010,6,6);
        const s1=new THREE.Mesh(sg,new THREE.MeshBasicMaterial({color:0x00CCFF}));s1.position.copy(p1);dnaGroup.add(s1);
        const s2=new THREE.Mesh(sg,new THREE.MeshBasicMaterial({color:0xD4AF37}));s2.position.copy(p2);dnaGroup.add(s2);
      }
      scene.add(dnaGroup);

      /* ════ NEURAL CONNECTIONS ════ */
      neuralGroup=new THREE.Group();
      const OP={
        brain:[0,1.74,0],heart:[-0.083,1.226,0.08],
        lung_L:[-0.170,1.224,0.018],lung_R:[0.170,1.224,0.018],
        liver:[0.10,0.90,0.03],kidney_L:[-0.178,0.84,-0.045],
        kidney_R:[0.178,0.84,-0.045],stomach:[-0.065,0.935,0.04],
        spleen:[-0.200,0.88,-0.02],bladder:[0,0.62,0.07],
        spine:[0,0.68,-0.118],thyroid:[0,1.494,0.076],
      };
      const CONN=[['brain','heart'],['brain','thyroid'],['heart','lung_L'],['heart','lung_R'],
        ['heart','liver'],['heart','kidney_L'],['heart','kidney_R'],['heart','spleen'],
        ['liver','stomach'],['brain','spine'],['spine','bladder'],['kidney_L','bladder'],['kidney_R','bladder']];
      CONN.forEach(([a,b])=>{
        const pa=OP[a],pb=OP[b];if(!pa||!pb)return;
        const l=new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...pa),new THREE.Vector3(...pb)]),
          new THREE.LineBasicMaterial({color:0x0066FF,transparent:true,opacity:0.055})
        );l.userData={baseOp:0.055};neuralGroup.add(l);
      });
      scene.add(neuralGroup);

      /* ════ ORGAN LABELS ════ */
      labelGroup=new THREE.Group();
      const NAMES={head:'CABEÇA',brain:'CÉREBRO',heart:'CORAÇÃO',
        lung_L:'PULMÃO ESQ',lung_R:'PULMÃO DIR',liver:'FÍGADO',
        kidney_L:'RIM ESQ',kidney_R:'RIM DIR',stomach:'ESTÔMAGO',
        spleen:'BAÇO',bladder:'BEXIGA',spine:'COLUNA',
        thyroid:'TIRÓIDE',shoulder_L:'OMBRO ESQ',shoulder_R:'OMBRO DIR',
        knee_L:'JOELHO ESQ',knee_R:'JOELHO DIR',
        hand_L:'MÃO ESQ',hand_R:'MÃO DIR',foot_L:'PÉ ESQ',foot_R:'PÉ DIR',
        forearm_L:'ANTEBRAÇO E',forearm_R:'ANTEBRAÇO D',
      };
      Object.entries(NAMES).forEach(([name,label])=>{
        const m=meshMap[name];if(!m)return;
        const sp=makeSprite(label,0xD4AF37);
        const pos=m.position.clone?m.position.clone():new THREE.Vector3(...Object.values(m.position));
        sp.position.set(pos.x+0.24,pos.y+0.06,pos.z);
        sp.userData={organ:name};
        labelGroup.add(sp);labelSprites[name]=sp;
      });
      scene.add(labelGroup);

      /* ════ SCAN BEAMS (triple, phase-offset) ════ */
      const mkScan=(col,op,thick=0.04)=>{
        const m=new THREE.Mesh(new THREE.PlaneGeometry(2.4,thick),
          new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:op,side:THREE.DoubleSide}));
        m.position.set(0,-1.65,0.18);scene.add(m);return m;
      };
      scan=mkScan(0xD4AF37,0.42);
      scan2=mkScan(0x00AAFF,0.26,0.028);
      scan3=mkScan(0x00FF88,0.16,0.018);

      /* ════ PARTICLES ════ */
      const pN=680,pPos=new Float32Array(pN*3),pCol=new Float32Array(pN*3);
      for(let i=0;i<pN;i++){
        const a=Math.random()*Math.PI*2,r=1.4+Math.random()*3.2;
        pPos[i*3]=Math.cos(a)*r;pPos[i*3+1]=(Math.random()-0.08)*5.2;pPos[i*3+2]=Math.sin(a)*r;
        const c=Math.random();
        if(c<0.40){pCol[i*3]=0.83;pCol[i*3+1]=0.686;pCol[i*3+2]=0.216;}
        else if(c<0.68){pCol[i*3]=0;pCol[i*3+1]=0.8;pCol[i*3+2]=1;}
        else if(c<0.86){pCol[i*3]=0.67;pCol[i*3+1]=0.27;pCol[i*3+2]=1;}
        else{pCol[i*3]=0.1;pCol[i*3+1]=0.35;pCol[i*3+2]=0.95;}
      }
      const pGeo=new THREE.BufferGeometry();
      pGeo.setAttribute('position',new THREE.BufferAttribute(pPos,3));
      pGeo.setAttribute('color',new THREE.BufferAttribute(pCol,3));
      pts=new THREE.Points(pGeo,new THREE.PointsMaterial({size:0.022,transparent:true,opacity:0.52,vertexColors:true}));
      scene.add(pts);

      /* ════ MARKERS ════ */
      markerGroup=new THREE.Group();scene.add(markerGroup);

      /* ════ CONTROLS ════ */
      const el=ren.domElement;
      const dn=e=>{drag=true;px=e.clientX??e.touches?.[0]?.clientX??0;py=e.clientY??e.touches?.[0]?.clientY??0;};
      const up=()=>{drag=false;};
      const mv=e=>{
        if(!drag)return;
        const cx=e.clientX??e.touches?.[0]?.clientX??px;
        const cy=e.clientY??e.touches?.[0]?.clientY??py;
        ry+=(cx-px)*0.010;rx=Math.max(-0.55,Math.min(0.55,rx+(cy-py)*0.007));
        body.rotation.y=ry;body.rotation.x=rx;px=cx;py=cy;
      };
      el.addEventListener('mousedown',dn);el.addEventListener('mouseup',up);el.addEventListener('mousemove',mv);
      el.addEventListener('touchstart',dn,{passive:true});el.addEventListener('touchend',up);el.addEventListener('touchmove',mv,{passive:true});
      const wh=e=>{e.preventDefault();camZ=Math.max(1.6,Math.min(10.0,camZ+e.deltaY*0.004));cam.position.z=camZ;};
      el.addEventListener('wheel',wh,{passive:false});

      /* ════ HOVER ════ */
      const onMove=e=>{
        const rect=el.getBoundingClientRect();
        mouse.x=((e.clientX-rect.left)/rect.width)*2-1;
        mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
        raycaster.setFromCamera(mouse,cam);
        const meshes=Object.values(meshMap).filter(m=>m&&m.isMesh);
        const hits=raycaster.intersectObjects(meshes);
        Object.values(labelSprites).forEach(s=>{s.material.opacity=Math.max(0,s.material.opacity-0.06);});
        if(hits.length>0&&!drag){
          const nm=hits[0].object.name;
          if(labelSprites[nm])labelSprites[nm].material.opacity=Math.min(0.96,labelSprites[nm].material.opacity+0.35);
          hoveredMesh=hits[0].object;
          el.style.cursor='crosshair';
        } else {hoveredMesh=null;el.style.cursor='grab';}
      };
      el.addEventListener('mousemove',onMove,{passive:true});

      /* ════ CLICK ════ */
      const onClick=e=>{
        if(drag)return;
        const rect=el.getBoundingClientRect();
        mouse.x=((e.clientX-rect.left)/rect.width)*2-1;
        mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
        raycaster.setFromCamera(mouse,cam);
        const hits=raycaster.intersectObjects(Object.values(meshMap).filter(m=>m&&m.isMesh));
        if(hits.length>0&&threeRef.current){
          const nm=hits[0].object.name;
          if(nm)threeRef.current.highlight([nm],'#FF4040');
        }
      };
      el.addEventListener('click',onClick);

      /* ════ ANIMATION LOOP ════ */
      const NC=0x003D55,NEC=0x001020,NEI=0.55;
      const loop=()=>{
        animId=requestAnimationFrame(loop);t+=0.016;

        // ── HEARTBEAT 72 BPM ──
        if(meshMap.heart){
          const hb=Math.pow(Math.max(0,Math.sin(t*3.77)),8);
          const sc=1+hb*0.28;
          // Find heart group or mesh
          const hg=body.children.find(c=>c.name==='heart')||meshMap.heart;
          if(hg.scale)hg.scale.setScalar(sc);
          heartLight.intensity=hb*16;heartLight.distance=0.6+hb*1.4;
        }

        // ── LUNG BREATHING ──
        const breathe=1+Math.sin(t*0.42)*0.07;
        if(meshMap.lung_L)meshMap.lung_L.scale.set(breathe,breathe*0.88,breathe);
        if(meshMap.lung_R)meshMap.lung_R.scale.set(breathe,breathe*0.88,breathe);

        // ── AUTO ROTATE ──
        if(!drag){ry+=0.0020;body.rotation.y=ry;}

        // ── DNA ──
        if(dnaGroup){dnaGroup.rotation.y=t*0.95;dnaGroup.position.y=2.08+Math.sin(t*0.52)*0.042;}

        // ── ENERGY FIELD ──
        if(energyField){
          const ef=1+Math.sin(t*0.28)*0.025;
          energyField.scale.setScalar(ef);
          energyField.rotation.y=t*0.07;
        }

        // ── SCAN BEAMS ──
        scan.position.y=-1.65+(Math.sin(t*0.35)+1)*2.05;
        scan.material.opacity=0.08+Math.abs(Math.sin(t*1.85))*0.32;
        scan2.position.y=-1.65+(Math.sin(t*0.35+Math.PI*0.67)+1)*2.05;
        scan2.material.opacity=0.05+Math.abs(Math.sin(t*2.2))*0.22;
        scan3.position.y=-1.65+(Math.sin(t*0.35+Math.PI*1.33)+1)*2.05;
        scan3.material.opacity=0.03+Math.abs(Math.sin(t*2.6))*0.14;

        // ── FLOOR RINGS ──
        orbitRings[0]&&(orbitRings[0].mesh.rotation.z=t*0.38);
        orbitRings[1]&&(orbitRings[1].mesh.rotation.z=-t*0.55);
        orbitRings[2]&&(orbitRings[2].mesh.rotation.z=t*0.22);
        orbitRings[3]&&(orbitRings[3].mesh.rotation.z=-t*0.18);
        // Body rings
        orbitRings[4]&&(orbitRings[4].mesh.rotation.y=t*0.32,orbitRings[4].mesh.material.opacity=0.10+Math.sin(t*0.9)*0.08);
        orbitRings[5]&&(orbitRings[5].mesh.rotation.y=-t*0.38,orbitRings[5].mesh.material.opacity=0.08+Math.sin(t*1.2)*0.08);
        orbitRings[6]&&(orbitRings[6].mesh.rotation.y=t*0.55,orbitRings[6].mesh.material.opacity=0.14+Math.sin(t*1.4)*0.10);

        // ── PILLARS FLICKER ──
        pillars.forEach((p,i)=>{p.material.opacity=0.05+Math.sin(t*1.6+i*1.2)*0.07;});

        // ── PARTICLES ──
        pts.rotation.y+=0.00040;

        // ── LIGHT SWEEP ──
        pl1.position.set(Math.sin(t*0.22)*4.0,2.0+Math.sin(t*0.16)*0.6,Math.cos(t*0.22)*3.2);
        pl2.position.set(Math.cos(t*0.15)*3.6,0.8+Math.sin(t*0.20)*0.5,Math.sin(t*0.15)*2.8);
        rimLight.intensity=1.6+Math.sin(t*0.6)*0.4;

        // ── NEURAL PULSE ──
        if(neuralGroup){
          const np=0.035+Math.sin(t*1.9)*0.028+Math.sin(t*3.1)*0.015;
          neuralGroup.children.forEach((l,i)=>{
            const base=l.userData.baseOp||0.055;
            l.material.opacity=np*(0.6+0.4*Math.sin(t*2.2+i*0.65));
          });
        }

        // ── VASCULAR PULSE (arteries) ──
        if(vasGroup){
          const vp=Math.pow(Math.max(0,Math.sin(t*3.77)),4);
          vasGroup.children.forEach((l,i)=>{
            if(i%2===0)l.material.opacity=0.14+vp*0.18;
            else l.material.opacity=0.10+Math.sin(t*0.8+i)*0.06;
          });
        }

        // ── AFFECTED ORGANS BREATHE ──
        Object.values(meshMap).forEach(m=>{
          if(m.userData.hit){
            const pulse=0.5+Math.sin(t*4.8+m.position.x*4)*0.48;
            m.material.opacity=0.72+pulse*0.26;
            m.material.emissiveIntensity=1.1+pulse*1.0;
            if(m.children[0])m.children[0].material.opacity=0.7+pulse*0.3;
          }
        });

        // ── MARKER RINGS ──
        markerGroup.children.forEach((c,i)=>{
          if(c.isLight)return;
          c.rotation.y=t*1.5+i*1.4;c.rotation.x=t*1.0+i*1.0;
          c.material.opacity=0.15+Math.sin(t*3.8+i*0.9)*0.25;
        });

        ren.render(scene,cam);
      };
      loop();

      /* ════ RESIZE ════ */
      const rs=()=>{
        const c=document.getElementById('three-canvas');
        if(!c)return;
        const r=c.getBoundingClientRect();
        const nW=r.width||c.clientWidth,nH=r.height||c.clientHeight;
        if(nW<20||nH<20)return;
        cam.aspect=nW/nH;cam.updateProjectionMatrix();ren.setSize(nW,nH);
      };
      window.addEventListener('resize',rs);
      let ro=null;
      if(typeof ResizeObserver!=='undefined'){ro=new ResizeObserver(()=>rs());ro.observe(cont);}

      const NC2=0x003D55,NE2=0x001020,NEI2=0.55;

      threeRef.current={
        resize:rs,

        highlight(names,sevColorHex){
          const raw=sevColorHex?sevColorHex.replace(/^#/,''):'FF2020';
          const sc=parseInt(raw,16);
          Object.values(meshMap).forEach(m=>{
            m.material.color.setHex(NC2);m.material.emissive.setHex(NE2);
            m.material.opacity=0.44;m.material.emissiveIntensity=NEI2;
            m.userData.hit=false;
            if(m.children[0])m.children[0].material.color.setHex(0xD4AF37);
          });
          while(markerGroup.children.length)markerGroup.remove(markerGroup.children[0]);
          names.forEach((n,i)=>{
            const m=meshMap[n];if(!m)return;
            setTimeout(()=>{
              m.material.color.setHex(sc);m.material.emissive.setHex(sc);
              m.material.emissiveIntensity=1.0;m.material.opacity=0.94;
              m.userData.hit=true;
              if(m.children[0])m.children[0].material.color.setHex(sc);
              // Orbiting rings
              const orb=new THREE.Mesh(new THREE.TorusGeometry(0.22+i*0.028,0.009,8,54),
                new THREE.MeshBasicMaterial({color:sc,transparent:true,opacity:0.65}));
              orb.position.copy(m.position);markerGroup.add(orb);
              const orb2=new THREE.Mesh(new THREE.TorusGeometry(0.16+i*0.020,0.006,6,40),
                new THREE.MeshBasicMaterial({color:sc,transparent:true,opacity:0.42}));
              orb2.position.copy(m.position);orb2.rotation.x=Math.PI/3;markerGroup.add(orb2);
              const orb3=new THREE.Mesh(new THREE.TorusGeometry(0.12+i*0.015,0.004,4,30),
                new THREE.MeshBasicMaterial({color:sc,transparent:true,opacity:0.28}));
              orb3.position.copy(m.position);orb3.rotation.z=Math.PI/4;markerGroup.add(orb3);
              // Glow sphere
              const glow=new THREE.Mesh(new THREE.SphereGeometry(0.14,10,10),
                new THREE.MeshBasicMaterial({color:sc,transparent:true,opacity:0.07,side:THREE.BackSide}));
              glow.position.copy(m.position);markerGroup.add(glow);
              // Point light
              const pl=new THREE.PointLight(sc,12,1.1);pl.isLight=true;
              pl.position.copy(m.position);markerGroup.add(pl);
              if(labelSprites[n])labelSprites[n].material.opacity=0.97;
            },i*220);
          });
          orbitRings[0]&&(orbitRings[0].mesh.material.color.setHex(sc),orbitRings[0].mesh.material.opacity=1.0);
          orbitRings[6]&&(orbitRings[6].mesh.material.color.setHex(sc),orbitRings[6].mesh.material.opacity=0.65);
          topSpot&&topSpot.color.setHex(sc);
          if(neuralGroup)neuralGroup.children.forEach(l=>{l.userData.baseOp=0.20;});
        },

        reset(){
          Object.values(meshMap).forEach(m=>{
            m.material.color.setHex(NC2);m.material.emissive.setHex(NE2);
            m.material.opacity=0.44;m.material.emissiveIntensity=NEI2;
            m.userData.hit=false;
            if(m.children[0])m.children[0].material.color.setHex(0xD4AF37);
            if(m.name!=='lung_L'&&m.name!=='lung_R'&&m.name!=='heart')m.scale.setScalar(1);
          });
          while(markerGroup.children.length)markerGroup.remove(markerGroup.children[0]);
          orbitRings[0]&&(orbitRings[0].mesh.material.color.setHex(0xD4AF37),orbitRings[0].mesh.material.opacity=0.9);
          orbitRings[6]&&(orbitRings[6].mesh.material.color.setHex(0xAA44FF),orbitRings[6].mesh.material.opacity=0.22);
          topSpot&&topSpot.color.setHex(0x0088FF);
          Object.values(labelSprites).forEach(s=>{s.material.opacity=0;});
          if(neuralGroup)neuralGroup.children.forEach(l=>{l.userData.baseOp=0.055;});
        }
      };

      cleanupRef.current=()=>{
        cancelAnimationFrame(animId);
        window.removeEventListener('resize',rs);
        if(ro)ro.disconnect();
        el.removeEventListener('mousedown',dn);el.removeEventListener('mouseup',up);el.removeEventListener('mousemove',mv);
        el.removeEventListener('touchstart',dn);el.removeEventListener('touchend',up);el.removeEventListener('touchmove',mv);
        el.removeEventListener('wheel',wh);el.removeEventListener('mousemove',onMove);el.removeEventListener('click',onClick);
        if(cont.contains(ren.domElement))cont.removeChild(ren.domElement);
        ren.dispose();threeRef.current=null;
      };
    };

    let retryCount=0;
    const trySetup=()=>{
      const cont=document.getElementById('three-canvas');
      if(cont&&cont.children.length===0&&cont.getBoundingClientRect().width>20){setup();}
      else if(retryCount<30){retryCount++;setTimeout(trySetup,200);}
    };
    const tim=setTimeout(trySetup,300);
    return()=>{clearTimeout(tim);cleanupRef.current?.();};
  },[]);
}

/* ═══════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════ */
function AppInner({tab, setTab, threeRef, session, onLogout}) {
  const [sideOpen,setSideOpen]=useState(true);
  const [time,setTime]=useState(new Date());
  const [notifOpen,setNotifOpen]=useState(false);
  const [globalQuery,setGlobalQuery]=useState('');
  const [searchOpen,setSearchOpen]=useState(false);
  const [uiScale,setUiScale]=useState(1.08);
  const cleanupRef=useRef(null);

  const {notifications,patients,appointments,messages} = useClinic();

  useEffect(()=>{
    (async()=>{
      try{
        const r = await window.storage.get('clinic_ui_scale');
        const n = Number(r?.value);
        if(!Number.isNaN(n) && n>=0.95 && n<=1.3) setUiScale(n);
      }catch(_){ }
    })();
  },[]);

  const changeUiScale = (next)=>{
    const n = Math.max(0.95,Math.min(1.3,Number(next)||1.08));
    setUiScale(n);
    try{ window.storage.set('clinic_ui_scale', String(n)); }catch(_){ }
  };

  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t);},[]);
  useThreeJS(threeRef,cleanupRef);

  // Force canvas resize whenever we switch TO holografia tab
  useEffect(()=>{
    if(tab==='holografia'){
      const t1=setTimeout(()=>threeRef.current?.resize?.(),80);
      const t2=setTimeout(()=>threeRef.current?.resize?.(),350);
      return()=>{clearTimeout(t1);clearTimeout(t2);};
    }
  },[tab]);

  const unreadCount = notifications.filter(n=>!n.read).length;

  const searchHits = useMemo(()=>{
    const q = globalQuery.trim().toLowerCase();
    if(!q) return [];

    const pHits = patients
      .filter(p=>`${p.nome||''} ${p.diag||''}`.toLowerCase().includes(q))
      .slice(0,4)
      .map(p=>({id:`p-${p.id}`,title:p.nome||'Paciente',sub:p.diag||'Prontuário',tab:'pacientes'}));

    const aHits = appointments
      .filter(a=>`${a.patient||''} ${a.doctor||''} ${a.specialty||''}`.toLowerCase().includes(q))
      .slice(0,4)
      .map((a,i)=>({id:`a-${i}-${a.time||''}`,title:a.patient||'Consulta',sub:`${a.time||'--:--'} · ${a.specialty||'Agenda'}`,tab:'agendamento'}));

    const mHits = messages
      .filter(m=>`${m.from||''} ${m.msg||''}`.toLowerCase().includes(q))
      .slice(0,4)
      .map((m,i)=>({id:`m-${i}-${m.id||''}`,title:m.from||'Mensagem',sub:m.msg||'Canal interno',tab:'comunicacao'}));

    return [...pHits,...aHits,...mHits].slice(0,8);
  },[appointments,globalQuery,messages,patients]);

  const selectSearchHit = (hit) => {
    setTab(hit.tab);
    setGlobalQuery('');
    setSearchOpen(false);
  };

  const NAV = [
    {id:'dashboard',label:'Dashboard',ic:'◇',group:'main'},
    {id:'holografia',label:'Holografia 3D',ic:'⬡',group:'main'},
    {id:'agendamento',label:'Agendamento',ic:'📅',group:'clinico'},
    {id:'pacientes',label:'Pacientes',ic:'◈',group:'clinico'},
    {id:'prescricoes',label:'Prescrições',ic:'💊',group:'clinico'},
    {id:'laboratorio',label:'Laboratório',ic:'🔬',group:'clinico'},
    {id:'financeiro',label:'Financeiro',ic:'💰',group:'gestao'},
    {id:'internamento',label:'Internamento',ic:'🏥',group:'gestao'},
    {id:'rh',label:'Recursos Humanos',ic:'👔',group:'gestao'},
    {id:'analytics',label:'Analytics & BI',ic:'📈',group:'relatorios'},
    {id:'comunicacao',label:'Comunicação',ic:'💬',group:'relatorios'},
    {id:'bloco',label:'Bloco Operatório',ic:'🔪',group:'advanced'},
    {id:'configuracoes',label:'Configurações',ic:'⚙',group:'advanced'},
    {id:'ia',label:'ARIA · IA Clínica',ic:'🤖',group:'advanced'},
  ];

  const groups = {
    main:'PRINCIPAL',
    clinico:'CLÍNICO',
    gestao:'GESTÃO',
    relatorios:'RELATÓRIOS',
    advanced:'AVANÇADO'
  };

  const W = sideOpen ? 185 : 54;

  const renderTab = () => {
    switch(tab) {
      case 'dashboard': return <Dashboard setTab={setTab}/>;
      case 'holografia': return <Holografia threeRef={threeRef}/>;
      case 'agendamento': return <Agendamento/>;
      case 'pacientes': return <Pacientes/>;
      case 'prescricoes': return <Prescricoes/>;
      case 'laboratorio': return <Laboratorio/>;
      case 'financeiro': return <Financeiro/>;
      case 'internamento': return <Internamento/>;
      case 'rh': return <RecursosHumanos/>;
      case 'analytics': return <Analytics/>;
      case 'comunicacao': return <Comunicacao/>;
      case 'bloco': return <BlocoOperatorio/>;
      case 'configuracoes': return <Configuracoes/>;
      case 'ia': return <IAAssistente kpis={null}/>;
      default: return <Dashboard setTab={setTab}/>;
    }
  };

  // Keep 3D canvas alive
  const show3D = tab==='holografia';

  let prevGroup = null;

  return(
    <div style={{width:'100%',height:'100vh',background:G.bg,color:G.text,
      fontFamily:'Rajdhani,sans-serif',display:'flex',flexDirection:'column',overflow:'hidden',zoom:uiScale}}>
      <style>{STYLE}</style>

      {/* HEADER */}
      <header style={{height:50,background:`linear-gradient(90deg,#060400,#0C0800,#060400)`,
        borderBottom:`1px solid ${G.border}`,display:'flex',alignItems:'center',
        padding:'0 14px',gap:12,flexShrink:0,position:'relative',zIndex:100}}>
        <button onClick={()=>setSideOpen(o=>!o)}
          style={{background:'none',color:G.dim,fontSize:14,padding:'4px 6px',
            borderRadius:2,transition:'color 0.2s'}}
          onMouseEnter={e=>e.target.style.color=G.gold}
          onMouseLeave={e=>e.target.style.color=G.dim}>☰</button>

        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <svg width="30" height="30" viewBox="0 0 36 36">
            <polygon points="18,1 35,9.5 35,26.5 18,35 1,26.5 1,9.5" fill="none" stroke="#D4AF37" strokeWidth="1.5"/>
            <polygon points="18,7 30,13 30,23 18,29 6,23 6,13" fill="#D4AF3708" stroke="#F5D060" strokeWidth="0.8"/>
            <text x="18" y="23" textAnchor="middle" fill="#F5D060" fontSize="9" fontFamily="Cinzel" fontWeight="900">F</text>
          </svg>
          <div>
            <div className="shimmer" style={{fontFamily:'Cinzel',fontSize:14,fontWeight:700,letterSpacing:3}}>FUMUGOLD</div>
            <div style={{fontFamily:'Orbitron',fontSize:5.5,color:G.dim,letterSpacing:2.5,marginTop:-1}}>SISTEMA MÉDICO INTEGRADO</div>
          </div>
        </div>

        <div style={{width:1,height:24,background:G.border,margin:'0 4px'}}/>

        {/* Breadcrumb */}
        <div style={{fontFamily:'Orbitron',fontSize:8,color:G.dim,letterSpacing:1}}>
          {NAV.find(n=>n.id===tab)?.label||'Dashboard'}
        </div>

        <div style={{marginLeft:'auto',display:'flex',gap:12,alignItems:'center'}}>
                    {/* Global search */}
          <div style={{position:'relative'}}>
            <input value={globalQuery} onChange={e=>{setGlobalQuery(e.target.value);setSearchOpen(true);}}
              onFocus={()=>setSearchOpen(true)}
              onBlur={()=>setTimeout(()=>setSearchOpen(false),140)}
              placeholder="Pesquisar paciente, agenda ou mensagem..."
              style={{background:'rgba(212,175,55,0.05)',border:`1px solid ${G.border}`,
                borderRadius:2,padding:'5px 10px',color:G.text,
                fontFamily:'Rajdhani',fontSize:11,width:210}}/>
            {searchOpen && globalQuery.trim() && (
              <div style={{position:'absolute',top:'100%',left:0,right:0,marginTop:4,
                background:'#0A0700',border:`1px solid ${G.border}`,borderRadius:2,
                boxShadow:'0 8px 24px rgba(0,0,0,0.75)',zIndex:220,maxHeight:240,overflowY:'auto'}}>
                {searchHits.length===0 ? (
                  <div style={{padding:'10px 12px',fontFamily:'Rajdhani',fontSize:11,color:G.dim}}>Sem resultados.</div>
                ) : searchHits.map(hit=>(
                  <button key={hit.id} onMouseDown={()=>selectSearchHit(hit)}
                    style={{width:'100%',textAlign:'left',padding:'9px 12px',background:'transparent',
                      border:'none',borderBottom:`1px solid ${G.border}15`,cursor:'pointer'}}>
                    <div style={{fontFamily:'Rajdhani',fontSize:12,color:G.text,fontWeight:600}}>{hit.title}</div>
                    <div style={{fontFamily:'Rajdhani',fontSize:10,color:G.dim}}>{hit.sub}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{fontFamily:'Orbitron',fontSize:10,color:G.dim,letterSpacing:1}}>
            {time.toLocaleTimeString('pt-PT')}
          </div>

          <div style={{display:'flex',alignItems:'center',gap:6,border:'1px solid '+G.border,borderRadius:12,padding:'3px 6px'}}>
            <button onClick={()=>changeUiScale(uiScale-0.04)} style={{background:'none',color:G.dim,fontFamily:'Orbitron',fontSize:8,padding:'0 4px'}}>A-</button>
            <span style={{fontFamily:'Orbitron',fontSize:8,color:G.gold,minWidth:36,textAlign:'center'}}>{Math.round(uiScale*100)}%</span>
            <button onClick={()=>changeUiScale(uiScale+0.04)} style={{background:'none',color:G.dim,fontFamily:'Orbitron',fontSize:8,padding:'0 4px'}}>A+</button>
          </div>

          {/* Notifications bell */}
          <div style={{position:'relative'}}>
            <button onClick={()=>setNotifOpen(o=>!o)}
              style={{background:'none',fontSize:14,position:'relative',padding:'2px 4px',color:G.dim,
                transition:'color 0.2s'}}
              onMouseEnter={e=>e.target.style.color=G.gold}
              onMouseLeave={e=>e.target.style.color=notifOpen?G.gold:G.dim}>
              🔔
            </button>
            {unreadCount>0&&(
              <div style={{position:'absolute',top:-2,right:-2,width:14,height:14,borderRadius:'50%',
                background:G.red,display:'flex',alignItems:'center',justifyContent:'center',
                fontFamily:'Orbitron',fontSize:7,color:'white',animation:'blink 2s ease-in-out infinite'}}>
                {unreadCount}
              </div>
            )}
            {notifOpen&&(
              <div style={{position:'absolute',top:'100%',right:0,width:280,background:'#0A0700',
                border:`1px solid ${G.border}`,borderRadius:2,zIndex:200,marginTop:4,
                boxShadow:'0 8px 32px rgba(0,0,0,0.8)',animation:'fadeUp 0.2s ease'}}>
                <div style={{padding:'10px 14px',borderBottom:`1px solid ${G.border}`,
                  fontFamily:'Cinzel',fontSize:9,color:G.gold,letterSpacing:2}}>⬡ NOTIFICAÇÕES</div>
                {notifications.map((n,i)=>{
                  const c=n.type==='crit'?G.red:n.type==='warn'?G.amber:n.type==='ok'?G.green:G.teal;
                  return(
                    <div key={i} style={{padding:'10px 14px',borderBottom:`1px solid ${G.border}15`,
                      opacity:n.read?0.5:1}}>
                      <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.text,lineHeight:1.4}}>{n.msg}</div>
                      <div style={{fontFamily:'Orbitron',fontSize:7,color:c,marginTop:3}}>{n.time}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{display:'flex',alignItems:'center',gap:5}}>
            <div style={{width:6,height:6,borderRadius:'50%',background:G.green,
              boxShadow:`0 0 8px ${G.green}`,animation:'blink 3s ease-in-out infinite'}}/>
            <span style={{fontFamily:'Orbitron',fontSize:7,color:G.dim,letterSpacing:1}}>ONLINE</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,
            background:'rgba(212,175,55,0.06)',border:`1px solid ${G.border}`,
            borderRadius:20,padding:'4px 10px 4px 6px',cursor:'default'}}>
            <div style={{width:24,height:24,borderRadius:'50%',background:`${G.gold}18`,
              border:`1.5px solid ${G.gold}66`,display:'flex',alignItems:'center',
              justifyContent:'center',fontFamily:'Cinzel',fontSize:9,color:G.gold,
              boxShadow:`0 0 10px ${G.gold}22`}}>
              {session?.nome?session.nome.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase():'DR'}
            </div>
            <div>
              <div style={{fontFamily:'Rajdhani',fontSize:11,color:G.text,fontWeight:600,lineHeight:1}}>
                {session?.nome?.split(' ')[0]||'Admin'}
              </div>
              <div style={{fontFamily:'Orbitron',fontSize:6,color:G.dim,letterSpacing:1}}>{session?.role?.toUpperCase()||'ADMIN'}</div>
            </div>
          </div>
          <button onClick={onLogout}
            style={{fontFamily:'Orbitron',fontSize:7,padding:'5px 10px',
              background:'transparent',border:`1px solid ${G.red}44`,color:`${G.red}88`,
              borderRadius:2,letterSpacing:1,transition:'all 0.2s'}}
            onMouseEnter={e=>{e.target.style.background=`${G.red}12`;e.target.style.color=G.red;e.target.style.borderColor=G.red;}}
            onMouseLeave={e=>{e.target.style.background='transparent';e.target.style.color=`${G.red}88`;e.target.style.borderColor=`${G.red}44`;}}>
            SAIR ⏻
          </button>
        </div>
      </header>

      <div style={{flex:1,display:'flex',overflow:'hidden'}}>
        {/* SIDEBAR */}
        <nav style={{width:W,flexShrink:0,background:`linear-gradient(180deg,#060400,#040200)`,
          borderRight:`1px solid ${G.border}`,overflowY:'auto',overflowX:'hidden',
          transition:'width 0.2s',position:'relative',zIndex:50}}>
          {NAV.map((item,i)=>{
            const showGroup = sideOpen && item.group !== prevGroup;
            prevGroup = item.group;
            return(
              <div key={item.id}>
                {showGroup&&(
                  <div style={{padding:'12px 12px 4px',fontFamily:'Orbitron',fontSize:6,
                    color:`${G.gold}44`,letterSpacing:2,whiteSpace:'nowrap',
                    overflow:'hidden',borderTop:i>0?`1px solid ${G.border}15`:undefined}}>
                    {groups[item.group]}
                  </div>
                )}
                <button onClick={()=>setTab(item.id)}
                  style={{width:'100%',display:'flex',alignItems:'center',
                    gap:sideOpen?10:0,padding:sideOpen?'9px 14px':'9px 0',
                    justifyContent:sideOpen?'flex-start':'center',
                    background:tab===item.id?`${G.gold}10`:'transparent',
                    borderLeft:tab===item.id?`2px solid ${G.gold}`:'2px solid transparent',
                    color:tab===item.id?G.gold:G.dim,transition:'all 0.15s',
                    textAlign:'left',whiteSpace:'nowrap',overflow:'hidden'}}>
                  <span style={{fontSize:13,flexShrink:0}}>{item.ic}</span>
                  {sideOpen&&<span style={{fontFamily:'Rajdhani',fontSize:12,fontWeight:600,
                    overflow:'hidden',textOverflow:'ellipsis'}}>{item.label}</span>}
                  {sideOpen&&tab===item.id&&<div style={{marginLeft:'auto',width:4,height:4,borderRadius:'50%',background:G.gold,flexShrink:0}}/>}
                </button>
              </div>
            );
          })}
          {/* Bottom info */}
          {sideOpen&&(
            <div style={{padding:'16px 12px',borderTop:`1px solid ${G.border}`,marginTop:8}}>
              <div style={{fontFamily:'Orbitron',fontSize:6,color:`${G.dim}77`,letterSpacing:2,marginBottom:4}}>FUMUGOLD v3.0</div>
              <div style={{fontFamily:'Rajdhani',fontSize:10,color:`${G.dim}55`}}>Luanda · Angola</div>
            </div>
          )}
        </nav>

        {/* CONTENT */}
        <div style={{flex:1,overflow:'hidden',position:'relative'}}>
          {/* Holografia: always mounted, visibility toggled so canvas keeps its real size */}
          <div style={{position:'absolute',inset:0,
            visibility:show3D?'visible':'hidden',
            pointerEvents:show3D?'auto':'none',
            zIndex:show3D?2:0}}>
            <Holografia threeRef={threeRef}/>
          </div>

          {/* Other tabs */}
          {!show3D&&(
            <div style={{position:'absolute',inset:0,overflow:'hidden',zIndex:1}} className="fade-in">
              {renderTab()}
            </div>
          )}
        </div>
      </div>
    </div>

  );
}

/* ═══════════════════════════════════════════════════════════
   LOGIN SCREEN - IMPERIAL THEME v8.0
 ═══════════════════════════════════════════════════════════ */
function LoginScreen({onLogin}) {
  const [user,setUser]=useState('');
  const [pass,setPass]=useState('');
  const [err,setErr]=useState('');
  const [loading,setLoading]=useState(false);
  const [showPass,setShowPass]=useState(false);
  const canvasRef=useRef(null);
  const rendererRef=useRef(null);
  const [isFTL,setIsFTL]=useState(false);
  const [loginComplete,setLoginComplete]=useState(false);

  const ACCOUNTS=[
    {user:'admin',pass:'fumugold2025',role:'admin',nome:'Administrador Sistema',dept:'Gestão & TI',clinic_id:'clinic_default'},
    {user:'dr.oliveira',pass:'clinica123',role:'medico',nome:'Dra. Mariana Oliveira',dept:'Cardiologia',clinic_id:'clinic_default'},
    {user:'dr.ngola',pass:'clinica123',role:'medico',nome:'Dr. António Ngola',dept:'Medicina Interna',clinic_id:'clinic_default'},
  ];

  useEffect(()=>{
    if(typeof window === 'undefined' || !window.THREE) return;
    const THREE = window.THREE;
    if(!canvasRef.current) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.01);

    const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 18;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    canvasRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambient);

    const frontLight = new THREE.DirectionalLight(0xffffff, 2.5);
    frontLight.position.set(2, 5, 10);
    scene.add(frontLight);

    const fillLight = new THREE.PointLight(0xD4AF37, 1.5, 30);
    fillLight.position.set(-8, -5, 5);
    scene.add(fillLight);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    (() => {
      const ew=256, eh=128, d=new Float32Array(ew*eh*4);
      for(let y=0;y<eh;y++) for(let x=0;x<ew;x++){
        const i=(y*ew+x)*4, u=x/ew, v=y/eh;
        const k=Math.exp(-((u-.2)**2+(v-.3)**2)*20)*2;
        const f=Math.exp(-((u-.7)**2+(v-.6)**2)*15)*1.5;
        d[i]=k*1.1+f*.8; d[i+1]=k*.85+f*.85; d[i+2]=k*.2+f*.9; d[i+3]=1;
      }
      const t=new THREE.DataTexture(d,ew,eh,THREE.RGBAFormat,THREE.FloatType);
      t.mapping=THREE.EquirectangularReflectionMapping; t.needsUpdate=true;
      scene.environment = pmremGenerator.fromEquirectangular(t).texture;
      t.dispose(); pmremGenerator.dispose();
    })();

    const goldMat = new THREE.MeshPhysicalMaterial({
      color: 0xD4AF37, metalness: 1.0, roughness: 0.08,
      clearcoat: 1.0, clearcoatRoughness: 0.05,
      emissive: 0x442200, emissiveIntensity: 0.4,
      envMapIntensity: 2.5
    });

    function createDNA(x) {
      const group = new THREE.Group();
      for (let i = 0; i < 60; i++) {
        const t = i / 60;
        const angle = t * Math.PI * 6;
        const y = (t - 0.5) * 15;
        const s1 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 24), goldMat);
        s1.position.set(Math.cos(angle)*2, y, Math.sin(angle)*2); group.add(s1);
        const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 24), goldMat);
        s2.position.set(Math.cos(angle + Math.PI)*2, y, Math.sin(angle + Math.PI)*2); group.add(s2);
        if (i%2===0) {
          const line = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 4), goldMat);
          line.position.set(0, y, 0); line.rotation.z = Math.PI/2; line.rotation.y = -angle; group.add(line);
        }
      }
      group.position.x = x; return group;
    }
    const dnaL = createDNA(-6); const dnaR = createDNA(6);
    scene.add(dnaL, dnaR);

    const starCount = 6000;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    for(let i=0; i < starCount * 3; i++) {
      starPos[i] = (Math.random() - 0.5) * 120;
      if(i%3 === 2) starPos[i] = Math.random() * -1000;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.25, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, sizeAttenuation: true
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);

    let mX = 0, mY = 0;
    let warpAcceleration = 0.01;
    let animationId;

    document.addEventListener('mousemove', (e) => {
      mX = (e.clientX - window.innerWidth/2) * 0.005;
      mY = (e.clientY - window.innerHeight/2) * 0.005;
    });

    function animate() {
      animationId = requestAnimationFrame(animate);
      const t = Date.now() * 0.001;
      
      camera.position.x += (mX - camera.position.x) * 0.05;
      camera.position.y += (-mY - camera.position.y) * 0.05;
      
      if (isFTL) {
        warpAcceleration = THREE.MathUtils.lerp(warpAcceleration, 25, 0.01);
        
        const positions = starField.geometry.attributes.position.array;
        for(let i=0; i < starCount; i++) {
          positions[i*3 + 2] += warpAcceleration;
          if(positions[i*3 + 2] > 20) {
            positions[i*3 + 2] = -1000;
            positions[i*3] = (Math.random() - 0.5) * 120;
            positions[i*3+1] = (Math.random() - 0.5) * 120;
          }
        }
        starField.geometry.attributes.position.needsUpdate = true;
        starMat.opacity = 1;
        camera.fov = THREE.MathUtils.lerp(camera.fov, 140, 0.005);
        camera.updateProjectionMatrix();
      } else {
        dnaL.rotation.y = t * 0.3; dnaR.rotation.y = -t * 0.3;
        dnaL.position.y = Math.sin(t*0.5)*0.3; dnaR.position.y = Math.cos(t*0.5)*0.3;
      }
      
      camera.lookAt(0,0,0);
      renderer.render(scene, camera);
    }
    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
    };
  }, [isFTL]);

  useEffect(() => {
    if(loginComplete) {
      setIsFTL(true);
      const timeout = setTimeout(() => {
        setLoginComplete(false);
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [loginComplete]);

  const login=async()=>{
    if(!user.trim()||!pass.trim()){setErr('Identificação requerida');return;}
    setLoading(true);setErr('');
    const u = user.trim();
    const p = pass;
    const client = getSupabaseClient();
    if (client) {
      const email = u.includes('@') ? u : `${u}@fumugold.local`;
      const res = await signInWithEmailPassword(email, p);
      if (res.ok && res.session) {
        const s = mapSupabaseUserToAppSession(res.session);
        if (s?.clinic_id) setClinicId(s.clinic_id);
        try { await window.storage.set('fg_session', JSON.stringify(s)); } catch (e) {}
        await logAction(AUDIT_ACTIONS.LOGIN, { provider: 'supabase', email: s.email }, 'info');
        setLoginComplete(true);
        setTimeout(() => onLogin(s), 4500);
        setLoading(false);
        return;
      }
      if (res.error && !res.error.includes('Invalid login')) {
        setErr('Supabase: ' + res.error);
        setLoading(false);
        return;
      }
    }
    await new Promise(r=>setTimeout(r,600));
    const acc=ACCOUNTS.find(a=>a.user===u.toLowerCase()&&a.pass===p);
    if(acc){
      if (acc.clinic_id) setClinicId(acc.clinic_id);
      try{await window.storage.set('fg_session',JSON.stringify({...acc,authProvider:'demo',clinic_id:acc.clinic_id||'clinic_default',ts:Date.now()}));}catch(e){}
      await logAction(AUDIT_ACTIONS.LOGIN, { provider: 'demo', user: acc.user }, 'info');
      setLoginComplete(true);
      setTimeout(() => onLogin({...acc,authProvider:'demo',clinic_id:acc.clinic_id||'clinic_default'}), 4500);
    } else {
      setErr('Credenciais inválidas');
      await logAction(AUDIT_ACTIONS.LOGIN_FAIL, { user: u }, 'warn');
    }
    setLoading(false);
  };

  return(
    <div style={{position:'fixed',inset:0,background:'#000',overflow:'hidden'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Plus+Jakarta+Sans:wght@200;400;600&family=Playfair+Display:ital,wght@1,500&display=swap');
        .cursor-dot { position:fixed; z-index:9999; width:6px; height:6px; background:#FFD700; border-radius:50%; transform:translate(-50%,-50%); pointer-events:none; box-shadow: 0 0 15px #D4AF37; }
        .cursor-ring { position:fixed; z-index:9998; width:40px; height:40px; border:1px solid #996515; border-radius:50%; transform:translate(-50%,-50%); pointer-events:none; transition: all 0.3s; }
        @keyframes pulse { 0%, 100% { opacity:0.3; } 50% { opacity:1; } }
        @keyframes warp-blink { to { visibility:hidden; } }
        .f-input { width:100%; background:transparent; border:none; border-bottom:1px solid rgba(212,175,55,0.2); color:#FFD700; font-size:15px; padding:10px 0; outline:none; transition:0.4s; font-family:'Plus Jakarta Sans', sans-serif; font-weight:300; }
        .f-input:focus { border-bottom-color: #D4AF37; background: rgba(212,175,55,0.03); }
        .f-btn { width:100%; padding:22px; border:1px solid #D4AF37; background:transparent; color:#D4AF37; font-family:'Bebas Neue', sans-serif; font-size:18px; letter-spacing:0.4em; cursor:pointer; transition: 0.5s; overflow:hidden; position:relative; }
        .f-btn:hover { background: #D4AF37; color: #000; box-shadow: 0 0 40px rgba(212,175,55,0.4); letter-spacing: 0.5em; }
        .f-btn:disabled { opacity:0.5; cursor:not-allowed; }
        input, button { cursor: pointer; }
      `}</style>
      
      <div className="cursor-dot" id="cd"></div>
      <div className="cursor-ring" id="cr"></div>

      <div ref={canvasRef} style={{position:'fixed',inset:0,zIndex:0}}/>

      <div style={{position:'fixed',top:40,left:50,zIndex:50,opacity:loginComplete?0:1,transition:'opacity 0.7s'}}>
        <div style={{fontFamily:'Bebas Neue',fontSize:28,letterSpacing:'0.4em',color:'#D4AF37',textShadow:'0 0 30px rgba(212,175,55,0.5)'}}>FUMUGOLD</div>
        <div style={{fontSize:8,letterSpacing:'0.5em',color:'#996515',textTransform:'uppercase',marginTop:5,fontWeight:600}}>Clinical System v8.0 Gateway</div>
      </div>

      <div style={{
        position:'fixed',top:'50%',left:'50%',transform:'translate(-50%, -50%) perspective(1000px)',zIndex:40,
        width:440,padding:60,opacity:loginComplete?0:1,transition:'all 1s ease',
        background:'rgba(10, 10, 10, 0.6)',border:'1px solid rgba(212, 175, 55, 0.25)',
        backdropFilter:'blur(40px) saturate(180%)',borderRadius:1,
        boxShadow:'0 50px 100px rgba(0,0,0,0.9)'
      }}>
        <div style={{position:'absolute',top:0,left:'10%',right:'10%',height:1,
          background:'linear-gradient(90deg, transparent, #FFD700, transparent)',
          boxShadow:'0 0 15px #D4AF37'}}/>
        
        <div style={{fontFamily:'Playfair Display',fontSize:48,color:'#fff',lineHeight:1,marginBottom:10,fontWeight:300}}>
          Imperial<br/><em style={{color:'#D4AF37',fontStyle:'italic'}}>Access</em>
        </div>
        <div style={{fontSize:9,letterSpacing:'0.3em',color:'#996515',textTransform:'uppercase',marginBottom:40,borderBottom:'1px solid rgba(212,175,55,0.1)',paddingBottom:20,fontWeight:600}}>
          Protocolo de Segurança Ativo • Angola 2025
        </div>
        
        <div style={{marginBottom:35}}>
          <label style={{display:'block',fontSize:8,letterSpacing:'0.2em',color:'#996515',textTransform:'uppercase',marginBottom:10,fontWeight:600}}>Identificação de Elite</label>
          <input type="text" className="f-input" placeholder="OPERADOR_OURO" value={user} onChange={e=>{setUser(e.target.value);setErr('');}} onKeyDown={e=>e.key==='Enter'&&login()}/>
        </div>
        
        <div style={{marginBottom:35}}>
          <label style={{display:'block',fontSize:8,letterSpacing:'0.2em',color:'#996515',textTransform:'uppercase',marginBottom:10,fontWeight:600}}>Cripto-Chave Neural</label>
          <div style={{position:'relative'}}>
            <input type={showPass?'text':'password'} className="f-input" placeholder="••••••••••••" value={pass} onChange={e=>{setPass(e.target.value);setErr('');}} onKeyDown={e=>e.key==='Enter'&&login()}/>
            <button onClick={()=>setShowPass(!showPass)} style={{position:'absolute',right:0,bottom:10,background:'none',color:showPass?'#D4AF37':'rgba(153,101,21,0.45)',fontSize:13,border:'none',cursor:'pointer'}}>
              {showPass?'◎':'●'}
            </button>
          </div>
        </div>
        
        {err && (
          <div style={{fontFamily:'Plus Jakarta Sans',fontSize:12,color:'#FF4444',marginBottom:14,padding:'8px 12px',borderRadius:2,background:'rgba(255,37,37,0.05)',border:'1px solid rgba(255,37,37,0.22)',display:'flex',alignItems:'center',gap:7}}>
            <span style={{fontSize:13}}>⚠</span>{err}
          </div>
        )}
        
        <button onClick={login} disabled={loading} className="f-btn">
          {loading ? (
            <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:10}}>
              <span style={{display:'inline-block',animation:'spin 0.7s linear infinite',fontSize:13}}>◈</span>
              VERIFICANDO CHAVE NEURAL...
            </span>
          ) : (
            <span>Entrar no Sistema</span>
          )}
        </button>
      </div>

      {loginComplete && (
        <div style={{position:'fixed',bottom:'10vh',left:'50%',transform:'translateX(-50%)',zIndex:90,
          fontFamily:'Bebas Neue',fontSize:12,letterSpacing:'1em',color:'#FFD700',textTransform:'uppercase',
          animation:'warp-blink 0.8s steps(2) infinite',textShadow:'0 0 10px #D4AF37'}}>
          FTL JUMP ACTIVE • REDIRECTING
        </div>
      )}

      <script dangerouslySetInnerHTML={{__html:`
        document.addEventListener('mousemove', function(e) {
          document.getElementById('cd').style.left = e.clientX + 'px';
          document.getElementById('cd').style.top = e.clientY + 'px';
          document.getElementById('cr').style.left = e.clientX + 'px';
          document.getElementById('cr').style.top = e.clientY + 'px';
        });
        document.querySelectorAll('input, button').forEach(function(el) {
          el.addEventListener('mouseenter', function() { document.getElementById('cr').style.width = '55px'; });
          el.addEventListener('mouseleave', function() { document.getElementById('cr').style.width = '40px'; });
        });
      `}}/>
    </div>
  );
}

export default function FumuGold() {
  const [tab,setTab]=useState('dashboard');
  const [session,setSession]=useState(null);
  const [checkingAuth,setCheckingAuth]=useState(true);
  const threeRef=useRef(null);

  useEffect(()=>{
    let cancelled=false;
    const unsub = subscribeAuth((event, sbSess) => {
      if (event === 'SIGNED_OUT') setSession(null);
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && sbSess) {
        const s = mapSupabaseUserToAppSession(sbSess);
        if (s?.clinic_id) setClinicId(s.clinic_id);
        setSession(s);
        try { window.storage.set('fg_session', JSON.stringify(s)); } catch (_) {}
      }
    });

    (async () => {
      try {
        getSupabaseClient();
        const sb = await getInitialSession();
        if (!cancelled && sb) {
          const s = mapSupabaseUserToAppSession(sb);
          if (s?.clinic_id) setClinicId(s.clinic_id);
          setSession(s);
          setCheckingAuth(false);
          return;
        }
      } catch (_) {}

      try {
        const r = await window.storage.get('fg_session');
        if (r && r.value) {
          const s = JSON.parse(r.value);
          if (s.authProvider === 'demo' && s.ts && Date.now() - s.ts < 86400000) {
            if (s.clinic_id) setClinicId(s.clinic_id);
            setSession(s);
          }
        }
      } catch (_) {}
      if (!cancelled) setCheckingAuth(false);
    })();

    return () => { cancelled = true; try { unsub?.(); } catch (_) {} };
  }, []);

  if(checkingAuth) return null;
  if(!session) return <LoginScreen onLogin={setSession}/>;

  return (
    <ClinicProvider setTab={setTab} threeRef={threeRef} session={session}>
      <AppInner tab={tab} setTab={setTab} threeRef={threeRef} session={session}
        onLogout={async()=>{
          await signOutSupabase();
          try{await window.storage.delete('fg_session');}catch(e){}
          setSession(null);
        }}/>
    </ClinicProvider>
  );
}







