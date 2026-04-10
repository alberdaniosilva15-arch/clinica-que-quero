// ═══════════════════════════════════════════════════════════
// FUMUGOLD — Dosage Calculator v1.0
// Cálculo inteligente de dosagens
// Base: peso · idade · condição · função renal · alergias
// Protocolos angolanos + WHO
// ═══════════════════════════════════════════════════════════

// ── Base de dados de medicamentos ─────────────────────────
export const DRUG_DB = {
  // ─── ANTIPARASITÁRIOS (Angola Top)
  artemether_lumefantrine: {
    name:   'Arteméter + Lumefantrina (AL)',
    class:  'Antipalúdico',
    angola: true,
    forms:  ['Oral'],
    dosing: {
      adult:  { dose: '4 comp (80/480mg)', freq: '2×/dia', duration: '3 dias', max: '4 comp/toma' },
      ped: {
        rule:  'weight_band',
        bands: [
          { min: 5,  max: 14, dose: '1 comp', freq: '2×/dia', duration: '3 dias' },
          { min: 15, max: 24, dose: '2 comp', freq: '2×/dia', duration: '3 dias' },
          { min: 25, max: 34, dose: '3 comp', freq: '2×/dia', duration: '3 dias' },
          { min: 35, max: 999, dose: '4 comp', freq: '2×/dia', duration: '3 dias' },
        ],
      },
    },
    contraindications: ['Gravidez 1º trimestre (relativo)'],
    notes: 'Tomar com alimentos gordurosos. TDR antes de tratar.',
  },

  artesunate_iv: {
    name:  'Artesunato IV',
    class: 'Antipalúdico (formas graves)',
    angola: true,
    forms: ['IV'],
    dosing: {
      adult: { dose: '2,4 mg/kg', freq: '0h, 12h, 24h, depois 24/24h', duration: '≥ 24h + AL oral' },
      ped:   { rule: 'mg_per_kg', mgPerKg: 2.4, freq: '0h, 12h, 24h', max: null },
    },
    notes: 'Malária cerebral / grave. Transferir para AL oral quando tolerado.',
  },

  metronidazole: {
    name:  'Metronidazol',
    class: 'Antiprotozoário / Anaeróbios',
    forms: ['Oral', 'IV', 'Tópico'],
    dosing: {
      adult: { dose: '500 mg', freq: '3×/dia', duration: '7–10 dias' },
      ped:   { rule: 'mg_per_kg', mgPerKg: 7.5, freq: '3×/dia', max: 500 },
    },
    renalAdjust: false,
    notes: 'Não tomar álcool. Tricomoníase: 2g dose única.',
  },

  // ─── ANTIBIÓTICOS
  amoxicillin: {
    name:  'Amoxicilina',
    class: 'Betalactâmico',
    forms: ['Oral'],
    dosing: {
      adult: { dose: '500–1000 mg', freq: '3×/dia', duration: '5–10 dias' },
      ped:   { rule: 'mg_per_kg', mgPerKg: 25, freq: '3×/dia', max: 500 },
    },
    renalAdjust: true,
    contraindications: ['Alergia penicilinas'],
  },

  ceftriaxone: {
    name:  'Ceftriaxona',
    class: 'Cefalosporina 3ª',
    forms: ['IV', 'IM'],
    dosing: {
      adult: { dose: '1–2 g', freq: '1×/dia', duration: 'Conforme infecção' },
      ped:   { rule: 'mg_per_kg', mgPerKg: 50, freq: '1×/dia', max: 2000 },
    },
    renalAdjust: false,
    notes: 'Pneumonia grave, meningite, sepsis.',
  },

  azithromycin: {
    name:  'Azitromicina',
    class: 'Macrólido',
    forms: ['Oral', 'IV'],
    dosing: {
      adult: { dose: '500 mg', freq: '1×/dia', duration: '3–5 dias' },
      ped:   { rule: 'mg_per_kg', mgPerKg: 10, freq: '1×/dia', max: 500, duration: '3 dias' },
    },
  },

  // ─── ANTIVIRAIS / ARV
  tfv_3tc_dtg: {
    name:  'TDF + 3TC + DTG',
    class: 'ARV - Linha 1 (VIH)',
    angola: true,
    forms: ['Oral'],
    dosing: {
      adult: { dose: '1 comp', freq: '1×/dia', duration: 'Indefinido' },
      notes: 'Peso > 35 kg. Não ajustar renal (TDF: ajustar se TFG < 50).',
    },
    renalAdjust: true,
    notes: 'Protocolo INLS Angola 2023. Monitorizar CV e CD4.',
  },

  // ─── ANTIPALÚDICOS PROFILAXIA
  sulfadoxine_pyrimethamine: {
    name:  'Sulfadoxina + Pirimetamina (SP)',
    class: 'Antipalúdico (TIP)',
    angola: true,
    forms: ['Oral'],
    dosing: {
      adult: { dose: '3 comp (500/25mg)', freq: 'Dose única', duration: 'TIP: 3 doses gravidez' },
      ped:   {
        rule: 'weight_band',
        bands: [
          { min: 5, max: 10, dose: '½ comp', freq: 'Dose única' },
          { min: 10, max: 20, dose: '1 comp', freq: 'Dose única' },
          { min: 20, max: 999, dose: '2 comp', freq: 'Dose única' },
        ],
      },
    },
    contraindications: ['Alergia sulfonamidas', '< 5 kg'],
  },

  // ─── ANALGÉSICOS
  paracetamol: {
    name:  'Paracetamol',
    class: 'Analgésico / Antipirético',
    forms: ['Oral', 'IV', 'Supositório'],
    dosing: {
      adult: { dose: '500–1000 mg', freq: '4–6×/dia', duration: 'SOS', max: '4000 mg/dia' },
      ped:   { rule: 'mg_per_kg', mgPerKg: 15, freq: 'a cada 4-6h', max: 1000, maxDay: 75 },
    },
    renalAdjust: false,
    notes: 'Dose máx 4g/dia adulto. Hepatotoxicidade por overdose.',
  },

  ibuprofen: {
    name:  'Ibuprofeno',
    class: 'AINE',
    forms: ['Oral'],
    dosing: {
      adult: { dose: '400–600 mg', freq: '3×/dia', duration: 'SOS', max: '2400 mg/dia' },
      ped:   { rule: 'mg_per_kg', mgPerKg: 10, freq: '3×/dia', max: 400, minAge: 3 },
    },
    contraindications: ['Úlcera gástrica', 'IRC', 'Gravidez 3º tri'],
    renalAdjust: true,
  },

  // ─── ANTI-HIPERTENSIVOS
  amlodipine: {
    name:  'Amlodipina',
    class: 'Bloqueador Cálcio',
    forms: ['Oral'],
    dosing: {
      adult: { dose: '5–10 mg', freq: '1×/dia', duration: 'Crónico' },
    },
    renalAdjust: false,
    notes: 'Início 5 mg, titular conforme TA.',
  },

  // ─── ANTI-TUBERCULOSE
  hrze: {
    name:  'HRZE (Rifampicina + Isoniazida + Pirazinamida + Etambutol)',
    class: 'Tuberculostático',
    angola: true,
    forms: ['Oral'],
    dosing: {
      adult: {
        rule:  'weight_band',
        bands: [
          { min: 30, max: 39, dose: '2 comp HRZE 150/75/400/275', freq: '1×/dia', duration: '2 meses' },
          { min: 40, max: 54, dose: '3 comp HRZE', freq: '1×/dia', duration: '2 meses' },
          { min: 55, max: 69, dose: '4 comp HRZE', freq: '1×/dia', duration: '2 meses' },
          { min: 70, max: 999, dose: '5 comp HRZE', freq: '1×/dia', duration: '2 meses' },
        ],
      },
    },
    notes: 'Fase intensiva 2 meses. Fase manutenção: HR 4 meses. DOT obrigatório.',
  },
};

// ── calculate ─────────────────────────────────────────────
// Cálculo principal de dosagem
export function calculate(drugKey, patient) {
  const drug = DRUG_DB[drugKey];
  if (!drug) return { error: `Medicamento "${drugKey}" não encontrado na base de dados.` };

  const {
    weight    = null,
    age       = null,
    ageMonths = null,
    renalGFR  = null,
    pregnant  = false,
    allergies = [],
  } = patient;

  // Verificações de segurança
  const warnings = [];
  const errors   = [];

  // Alergias
  if (drug.contraindications) {
    drug.contraindications.forEach(ci => {
      allergies.forEach(alg => {
        if (ci.toLowerCase().includes(alg.toLowerCase())) {
          errors.push(`⛔ CONTRAINDICADO: Alergia a ${alg} — ${ci}`);
        }
      });
    });
  }

  // Gravidez
  if (pregnant && drug.contraindications?.some(c => c.toLowerCase().includes('gravidez'))) {
    warnings.push('⚠️ Verificar contraindicações na gravidez.');
  }

  // Renal adjustment
  if (drug.renalAdjust && renalGFR && renalGFR < 50) {
    warnings.push(`⚠️ Função renal reduzida (TFG: ${renalGFR}). Verificar ajuste de dose.`);
  }

  // Determina se é adulto ou pediátrico
  const ageYears = age || (ageMonths ? ageMonths / 12 : null);
  const isPed    = ageYears !== null && ageYears < 18 && weight !== null;

  let dosing;

  if (isPed && drug.dosing.ped) {
    dosing = _pedDose(drug.dosing.ped, weight, ageYears);
  } else {
    dosing = _adultDose(drug.dosing.adult, weight);
  }

  return {
    drug:      drug.name,
    class:     drug.class,
    dosing,
    warnings,
    errors,
    notes:     drug.notes || '',
    isPed,
    weight,
    ageYears,
    timestamp: new Date().toISOString(),
  };
}

// ── calculateFromText ─────────────────────────────────────
// Cálculo a partir de texto livre (para ARIA)
export function calculateFromText(text, patient) {
  const t = text.toLowerCase();
  const drugKey = Object.entries(DRUG_DB).find(([k, d]) =>
    t.includes(k.replace(/_/g, ' ')) ||
    t.includes(d.name.toLowerCase()) ||
    t.includes(d.class.toLowerCase())
  )?.[0];

  if (!drugKey) {
    return {
      error:    'Medicamento não identificado.',
      available: Object.values(DRUG_DB).map(d => d.name),
    };
  }

  return calculate(drugKey, patient);
}

// ── checkInteractions ─────────────────────────────────────
export function checkInteractions(drugs = []) {
  const INTERACTIONS = [
    { pair: ['metronidazole', 'warfarin'],       level: 'high',   desc: 'Potenciação efeito anticoagulante — monitorizar INR' },
    { pair: ['ibuprofen', 'artesunate_iv'],      level: 'moderate', desc: 'AINEs podem reduzir eficácia artesunato' },
    { pair: ['tfv_3tc_dtg', 'rifampicin'],       level: 'high',   desc: 'Rifampicina reduz DTG — dobrar dose DTG' },
    { pair: ['artemether_lumefantrine', 'halofantrine'], level: 'high', desc: '⛔ Intervalo QTc — contraindicado' },
    { pair: ['metronidazole', 'alcohol'],         level: 'high',   desc: 'Reacção dissulfiram — náuseas/vómitos graves' },
    { pair: ['amoxicillin', 'methotrexate'],      level: 'high',   desc: '⚠️ Toxicidade MTX aumentada' },
    { pair: ['amlodipine', 'clarithromycin'],     level: 'moderate', desc: 'Inibição CYP3A4 — hipotensão' },
    { pair: ['ibuprofen', 'amlodipine'],          level: 'moderate', desc: 'AINEs podem reduzir efeito anti-hipertensivo' },
    { pair: ['paracetamol', 'alcohol'],           level: 'moderate', desc: 'Hepatotoxicidade aumentada em uso crónico de álcool' },
  ];

  const found = [];
  for (let i = 0; i < drugs.length; i++) {
    for (let j = i + 1; j < drugs.length; j++) {
      const pair = [drugs[i], drugs[j]];
      const inter = INTERACTIONS.find(ix =>
        ix.pair.every(p => pair.some(d => d.includes(p) || p.includes(d)))
      );
      if (inter) found.push({ drugs: pair, ...inter });
    }
  }

  return found;
}

// ── formatResult ─────────────────────────────────────────
export function formatResult(result) {
  if (result.error) return `❌ ${result.error}`;

  const lines = [
    `💊 **${result.drug}** (${result.class})`,
    result.isPed
      ? `👶 Dose pediátrica (${result.weight}kg, ${result.ageYears?.toFixed(1)}a)`
      : '👤 Dose adulto',
    '',
  ];

  if (result.dosing) {
    if (result.dosing.dose)     lines.push(`• Dose: **${result.dosing.dose}**`);
    if (result.dosing.freq)     lines.push(`• Frequência: ${result.dosing.freq}`);
    if (result.dosing.duration) lines.push(`• Duração: ${result.dosing.duration}`);
    if (result.dosing.max)      lines.push(`• Máximo: ${result.dosing.max}`);
  }

  if (result.errors.length)   { lines.push(''); result.errors.forEach(e => lines.push(e)); }
  if (result.warnings.length) { lines.push(''); result.warnings.forEach(w => lines.push(w)); }
  if (result.notes)           lines.push(`\n📝 ${result.notes}`);

  return lines.join('\n');
}

// ── getDrugList ───────────────────────────────────────────
export function getDrugList() {
  return Object.entries(DRUG_DB).map(([key, d]) => ({
    key, name: d.name, class: d.class, angola: d.angola || false,
  }));
}

// ─── Helpers privados ─────────────────────────────────────
function _adultDose(adult, weight) {
  if (!adult) return null;
  if (adult.rule === 'weight_band' && weight) {
    const band = adult.bands?.find(b => weight >= b.min && weight <= b.max);
    return band || adult;
  }
  return adult;
}

function _pedDose(ped, weight, ageYears) {
  if (!ped) return null;

  if (ped.rule === 'mg_per_kg' && weight) {
    const rawDose = ped.mgPerKg * weight;
    const dose    = ped.max ? Math.min(rawDose, ped.max) : rawDose;
    return {
      dose:     `${Math.round(dose)} mg (${ped.mgPerKg} mg/kg)`,
      freq:     ped.freq,
      duration: ped.duration || '',
      max:      ped.max ? `${ped.max} mg/dose` : null,
      maxDay:   ped.maxDay ? `${ped.maxDay} mg/kg/dia` : null,
    };
  }

  if (ped.rule === 'weight_band') {
    const band = ped.bands?.find(b => weight >= b.min && weight <= b.max);
    return band || null;
  }

  return ped;
}
