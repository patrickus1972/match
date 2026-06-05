// Completeness agent — checks the referral against the Forta volledigheidschecklist.
// Implements FO §3.3.1-3.3.7: algemene velden + label-specifieke velden.
import { MOCK_MODE, runStructured } from './client.js';
import { db } from '../db/index.js';

// ============ VALIDATORS ============

// BSN elfproef (11-proof) — FO §3.3.1
export function validateBSN(bsn) {
  if (!bsn || typeof bsn !== 'string') return { valid: false, reason: 'BSN ontbreekt' };
  const clean = bsn.replace(/[\s.-]/g, '');
  if (!/^\d{9}$/.test(clean)) return { valid: false, reason: 'BSN moet 9 cijfers zijn' };
  const digits = clean.split('').map(Number);
  // Weights: 9,8,7,6,5,4,3,2,-1
  const weights = [9, 8, 7, 6, 5, 4, 3, 2, -1];
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  if (sum % 11 !== 0) return { valid: false, reason: 'BSN voldoet niet aan elfproef' };
  return { valid: true };
}

// AGB-code format check (8 digits, starts with specific patterns)
export function validateAGB(agb) {
  if (!agb || typeof agb !== 'string') return { valid: false, reason: 'AGB-code ontbreekt' };
  const clean = agb.replace(/[\s.-]/g, '');
  if (!/^\d{8}$/.test(clean)) return { valid: false, reason: 'AGB-code moet 8 cijfers zijn' };
  // Valid AGB prefixes for healthcare providers
  const validPrefixes = ['01', '03', '04', '05', '06', '07', '08', '09', '14', '22', '24', '25', '30', '40', '50', '60', '70', '80', '90', '94'];
  const prefix = clean.slice(0, 2);
  if (!validPrefixes.includes(prefix)) return { valid: false, reason: `AGB-prefix ${prefix} onbekend` };
  return { valid: true };
}

// Date validation (not older than 6 months) — FO §3.3.1
export function validateLetterDate(dateStr) {
  if (!dateStr) return { valid: false, reason: 'Datum ontbreekt' };
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return { valid: false, reason: 'Ongeldige datumnotatie' };
  const monthsAgo = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (monthsAgo > 6) return { valid: false, reason: 'Verwijsbrief ouder dan 6 maanden' };
  if (monthsAgo < 0) return { valid: false, reason: 'Datum ligt in de toekomst' };
  return { valid: true };
}

// Dutch postcode validation
export function validatePostcode(pc) {
  if (!pc || typeof pc !== 'string') return { valid: false, reason: 'Postcode ontbreekt' };
  const clean = pc.replace(/\s/g, '').toUpperCase();
  if (!/^\d{4}[A-Z]{2}$/.test(clean)) return { valid: false, reason: 'Postcode formaat ongeldig (verwacht: 1234AB)' };
  return { valid: true };
}

// Phone validation (Dutch formats)
export function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') return { valid: false, reason: 'Telefoonnummer ontbreekt' };
  const clean = phone.replace(/[\s\-().]/g, '');
  // Dutch mobile (06...) or landline (0xx...)
  if (!/^(0[1-9]\d{8}|06\d{8}|\+31[1-9]\d{8})$/.test(clean)) {
    return { valid: false, reason: 'Telefoonnummer formaat ongeldig' };
  }
  return { valid: true };
}

// Email validation
export function validateEmail(email) {
  if (!email || typeof email !== 'string') return { valid: false, reason: 'E-mail ontbreekt' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, reason: 'E-mail formaat ongeldig' };
  }
  return { valid: true };
}

// ============ FIELD DEFINITIONS ============

// Algemene velden — FO §3.3.1
const GENERAL_FIELDS = [
  { key: 'patient_name', label: 'Naam cliënt', required: true, validate: v => v?.trim().length > 1 },
  { key: 'bsn', label: 'BSN cliënt', required: true, validate: v => validateBSN(v).valid, validateMsg: v => validateBSN(v).reason },
  { key: 'birth_date', label: 'Geboortedatum', required: true, validate: v => v && !isNaN(new Date(v).getTime()) },
  { key: 'postcode', label: 'Adres / postcode', required: true, validate: v => validatePostcode(v).valid, validateMsg: v => validatePostcode(v).reason },
  { key: 'contact_phone', label: 'Contactgegevens cliënt', required: true, validate: v => validatePhone(v).valid || validateEmail(v).valid },
  { key: 'agb_referrer', label: 'AGB-code verwijzer', required: true, validate: v => validateAGB(v).valid, validateMsg: v => validateAGB(v).reason },
  { key: 'signature_present', label: 'Handtekening arts', required: true, validate: v => v === true },
  { key: 'letter_date', label: 'Datum verwijsbrief', required: true, validate: v => validateLetterDate(v).valid, validateMsg: v => validateLetterDate(v).reason },
  { key: 'insurer_name', label: 'Verzekeraar', required: true, validate: v => v?.trim().length > 1 },
  { key: 'dsm_suspicion', label: 'DSM-vermoeden of diagnose', required: true, validate: v => v?.trim().length > 2 },
  { key: 'klacht_beschrijving', label: 'Klachtbeschrijving', required: false, validate: v => !v || v.trim().split(/\s+/).length >= 5 },
  { key: 'hulpvraag', label: 'Hulpvraag', required: true, validate: v => v?.trim().split(/\s+/).length >= 8, warnIf: v => v?.trim().split(/\s+/).length < 15 },
  { key: 'ggz_verwijzer', label: 'GGZ-bevoegde verwijzer', required: false, validate: v => v !== false }, // false = hospital referral
  { key: 'soort_ggz', label: 'Soort GGZ (basis/specialistisch)', required: false, validate: v => !v || ['basis', 'specialistisch', 'beide'].includes(v?.toLowerCase()) },
  { key: 'procedure_voorstel', label: 'Procedurevoorstel', required: false, validate: v => !v || ['diagnostiek', 'behandeling', 'second opinion', 'beide'].includes(v?.toLowerCase()) },
  { key: 'suicidaliteit_check', label: 'Suïcidaliteit-check', required: true, validate: v => v === true || v === false || v === 'nee' || v === 'ja' }
];

// Label-specifieke velden — FO §3.3.2-3.3.5
const LABEL_SPECIFIC_FIELDS = {
  // Psytrec (PTSS-zorg) — FO §3.3.2
  'psytrec': [
    { key: 'trauma_context', label: 'Trauma-context benoemd', required: true, validate: v => v?.trim().length > 5 },
    { key: 'taalvoorkeur', label: 'Taalvoorkeur (NL/EN)', required: false, validate: v => !v || ['nl', 'en', 'nederlands', 'engels'].includes(v?.toLowerCase()) }
  ],

  // Impegno (WMO-zorg) — FO §3.3.3
  'impegno': [
    { key: 'woongemeente', label: 'Woongemeente cliënt', required: true, validate: v => v?.trim().length > 2 },
    { key: 'wmo_indicatie', label: 'WMO-indicatie of -beschikking', required: true, validate: v => v === true || v?.trim().length > 2 },
    { key: 'wmo_consulent', label: 'WMO-consulent (naam + contact)', required: true, validate: v => v?.trim().length > 3 },
    { key: 'onderzoeksvraag_consulent', label: 'Onderzoeksvraag consulent', required: true, validate: v => v?.trim().length > 10 },
    { key: 'adres_type', label: 'Adrestype (woonadres)', required: false, validate: v => !v || v === 'woonadres' }
  ],

  // Dr. Bosman (kind, jeugd) — FO §3.3.4
  'dr_bosman': [
    { key: 'gezagshebbende_ouders', label: 'Gezagshebbende ouder(s)', required: true, condition: ext => (ext.patient_age || 99) < 18, validate: v => v?.trim().length > 2 },
    { key: 'beide_ouder_handtekeningen', label: 'Handtekening beide ouders', required: true, condition: ext => (ext.patient_age || 99) < 18 && ext.tweeoudergezag === true, validate: v => v === true },
    { key: 'voogdij_situatie', label: 'Voogdij-situatie (GI/BJZ)', required: false, condition: ext => ext.onder_voogdij === true, validate: v => v?.trim().length > 3 },
    { key: 'school_leerplicht', label: 'School / leerplichtsituatie', required: true, condition: ext => (ext.patient_age || 99) < 18, validate: v => v?.trim().length > 2 },
    { key: 'dsm_historie', label: 'DSM-historie benoemd', required: false, validate: v => v !== undefined },
    { key: 'heraanmelding', label: 'Heraanmelding-status', required: false, validate: v => v === true || v === false || v === undefined }
  ],

  // Human Concern (eetstoornissen) — FO §3.3.5
  'human_concern': [
    { key: 'bmi', label: 'BMI of gewicht vermeld', required: true, validate: v => (typeof v === 'number' && v > 10 && v < 60) || (typeof v === 'string' && /\d/.test(v)) },
    { key: 'gewichtsverloop', label: 'Gewichtsverloop benoemd', required: false, validate: v => !v || v?.trim().length > 5 },
    { key: 'motivatie_client', label: 'Motivatie cliënt benoemd', required: false, validate: v => !v || v?.trim().length > 5 }
  ]
};

// Conditionele velden — FO §3.3.6
const CONDITIONAL_FIELDS = [
  { key: 'meervoudige_aanvraag', label: 'Meervoudige aanvraag-detectie', condition: ext => ext.aantal_clienten > 1, validate: v => v === true },
  { key: 'ouder_contact', label: 'Ouder/verzorger contact', condition: ext => (ext.patient_age || 99) < 18, validate: v => v?.trim().length > 5 },
  { key: 'taalvoorkeur_anderstalig', label: 'Taalvoorkeur (bij anderstalig)', condition: ext => ext.anderstalig === true, validate: v => v?.trim().length > 1 }
];

// ============ MAIN CHECK FUNCTION ============

export function runCompletenessCheck(extraction, options = {}) {
  const { labelCode = null, skipLabelSpecific = false } = options;
  const items = [];

  // 1. Check general fields
  for (const f of GENERAL_FIELDS) {
    const value = extraction?.[f.key];
    const isValid = f.validate(value);
    const hasValue = value != null && value !== '' && value !== false;

    let status = 'ok';
    let message = 'Aanwezig';

    if (f.required && !hasValue) {
      status = 'missing';
      message = 'Ontbreekt';
    } else if (f.required && hasValue && !isValid) {
      status = 'missing';
      message = f.validateMsg ? f.validateMsg(value) : 'Ongeldig formaat';
    } else if (hasValue && !isValid) {
      status = 'warn';
      message = f.validateMsg ? f.validateMsg(value) : 'Ongeldig formaat';
    } else if (f.warnIf && hasValue && f.warnIf(value)) {
      status = 'warn';
      message = 'Kort — eventueel uitvragen';
    }

    items.push({ field: f.key, label: f.label, status, message, required: f.required });
  }

  // 2. Check conditional fields
  for (const f of CONDITIONAL_FIELDS) {
    if (!f.condition(extraction)) continue;
    const value = extraction?.[f.key];
    const isValid = f.validate(value);
    const hasValue = value != null && value !== '';

    let status = hasValue && isValid ? 'ok' : 'missing';
    let message = hasValue && isValid ? 'Aanwezig' : 'Ontbreekt (conditioneel verplicht)';

    items.push({ field: f.key, label: f.label, status, message, required: true, conditional: true });
  }

  // 3. Check label-specific fields if label is known
  if (!skipLabelSpecific && labelCode) {
    const labelKey = labelCode.toLowerCase().replace(/[^a-z_]/g, '_');
    const labelFields = LABEL_SPECIFIC_FIELDS[labelKey] || [];

    for (const f of labelFields) {
      // Skip if condition not met
      if (f.condition && !f.condition(extraction)) continue;

      const value = extraction?.[f.key];
      const isValid = f.validate(value);
      const hasValue = value != null && value !== '';

      let status = 'ok';
      let message = 'Aanwezig';

      if (f.required && !hasValue) {
        status = 'missing';
        message = 'Ontbreekt';
      } else if (f.required && hasValue && !isValid) {
        status = 'missing';
        message = 'Ongeldig formaat';
      } else if (!f.required && hasValue && !isValid) {
        status = 'warn';
        message = 'Ongeldig formaat';
      }

      items.push({ field: f.key, label: f.label, status, message, required: f.required, labelSpecific: labelKey });
    }
  }

  const isComplete = items.filter(i => i.required !== false).every(i => i.status !== 'missing');
  const missingLabels = items.filter(i => i.status === 'missing').map(i => i.label);
  const warnLabels = items.filter(i => i.status === 'warn').map(i => i.label);

  const summary = isComplete
    ? null
    : `Geachte verwijzer,\n\nVoor de aanmelding van uw cliënt missen wij nog onderstaande gegevens:\n\n${missingLabels.map(l => '• ' + l).join('\n')}\n\nMogen wij u vragen deze aan te vullen?\n\nMet vriendelijke groet,\nSecretariaat Forta`;

  return {
    items,
    isComplete,
    missingCount: missingLabels.length,
    warnCount: warnLabels.length,
    summary,
    checkVersion: 'v2.0-fo-compliant'
  };
}

// Simplified check for backwards compatibility (uses general fields only)
export function runSimpleCompletenessCheck(extraction) {
  return runCompletenessCheck(extraction, { skipLabelSpecific: true });
}

// Optional: LLM-generated terugstuurbrief (if API key present and check failed)
export async function generateTerugstuurbrief(missingFields, extraction) {
  if (MOCK_MODE) return null;
  const tool = {
    name: 'generate_terugstuurbrief',
    description: 'Schrijf een korte, vriendelijke Nederlandse e-mail aan de verwijzer met daarin een opsomming van de ontbrekende velden.',
    input_schema: {
      type: 'object',
      properties: { subject: { type: 'string' }, body: { type: 'string' } },
      required: ['subject', 'body']
    }
  };
  const userMsg = `Ontbrekende velden: ${missingFields.join(', ')}\nCliëntinitialen: ${extraction?.patient_initials || 'onbekend'}\nAGB: ${extraction?.agb_referrer || 'onbekend'}\nSchrijf een professionele, beknopte mail (max 8 regels).`;
  return runStructured({
    system: 'Je bent een secretariaatsmedewerker die professionele Nederlandse mail schrijft.',
    user: userMsg, tool, maxTokens: 600
  });
}

// Export validators for use elsewhere
export const validators = {
  validateBSN,
  validateAGB,
  validateLetterDate,
  validatePostcode,
  validatePhone,
  validateEmail
};
