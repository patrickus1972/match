// Extraction agent — LLM extracts structured fields + tags from a referral letter.
// Implements FO §4.8: anonimisering before LLM call.
import { MOCK_MODE, runStructured } from './client.js';
import { db } from '../db/index.js';
import { redactFull, detectPII } from './redactie.js';

const TAXONOMY_CATEGORIES = ['doelgroep','klachtprofiel','comorbiditeit','procedureel','exclusie','zorgtype'];

function loadTaxonomy() {
  const rows = db.prepare(`SELECT name, category, synonyms FROM tags WHERE status='actief'`).all();
  return rows.map(r => ({ name: r.name, category: r.category, synonyms: JSON.parse(r.synonyms) }));
}

const tool = {
  name: 'extract_referral',
  description: 'Extract structured fields and Forta tags from a Dutch GGZ referral letter (verwijsbrief).',
  input_schema: {
    type: 'object',
    properties: {
      patient_initials: { type: 'string', description: 'Initials, e.g. "J.K."; empty string if not found.' },
      patient_age: { type: 'integer', description: '0 if unknown' },
      postcode: { type: 'string', description: '4-digit Dutch postcode portion or full code; "" if missing' },
      insurer_name: { type: 'string' },
      agb_referrer: { type: 'string' },
      letter_date: { type: 'string', description: 'ISO date or empty' },
      signature_present: { type: 'boolean' },
      hulpvraag: { type: 'string', description: '1-3 sentence summary of the hulpvraag' },
      dsm_suspicion: { type: 'string', description: 'Free text of suspected DSM-5 diagnosis or empty' },
      contact_phone: { type: 'string' },
      contact_email: { type: 'string' },
      is_hospital_referral: { type: 'boolean', description: 'true when referral comes from a hospital (often unsuited for GGZ).' },
      tags: {
        type: 'array',
        description: 'Tags from the Forta taxonomy that apply to this letter. Only use names from the provided taxonomy.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            category: { type: 'string', enum: TAXONOMY_CATEGORIES },
            evidence: { type: 'string', description: 'Short quote from the letter that supports the tag.' }
          },
          required: ['name','category','evidence']
        }
      },
      llm_confidence: { type: 'number', description: '0-1 overall confidence in this extraction.' }
    },
    required: ['hulpvraag','tags','llm_confidence','signature_present','is_hospital_referral']
  }
};

const system = `Je bent een extractie-agent voor Forta Match. Je leest Nederlandse verwijsbrieven (GGZ) en extraheert
gestructureerde velden plus tags uit een vaste taxonomie. Je raadt nooit; bij twijfel laat je een veld leeg of zet je een lagere confidence.
Tags MOGEN ALLEEN namen bevatten die exact in de meegeleverde taxonomie voorkomen — geen synoniemen of vrije tekst.`;

export async function extractReferral(letterText, options = {}) {
  const { skipRedaction = false } = options;

  // Apply PII redaction before sending to LLM (FO §4.8)
  let textToProcess = letterText;
  let redactionResult = null;

  if (!MOCK_MODE && !skipRedaction) {
    redactionResult = redactFull(letterText);
    textToProcess = redactionResult.text;

    // Log redaction stats for audit
    if (redactionResult.totalRedacted > 0) {
      console.log(`[redactie] Redacted ${redactionResult.totalRedacted} PII items:`, redactionResult.stats);
    }

    // Warn on high-confidence PII (BSN, email)
    if (redactionResult.hadHighConfidencePII) {
      console.warn(`[redactie] High-confidence PII detected and redacted:`, redactionResult.warnings);
    }
  }

  if (MOCK_MODE) return mockExtraction(letterText); // Mock uses original for demo purposes

  const taxonomy = loadTaxonomy();
  const userMsg = `Taxonomie (gebruik alleen deze tagnamen):\n${taxonomy.map(t=>`- ${t.name} [${t.category}] (synoniemen: ${t.synonyms.join(', ') || '—'})`).join('\n')}\n\nVerwijsbrief:\n"""\n${textToProcess}\n"""`;

  const result = await runStructured({ system, user: userMsg, tool, maxTokens: 2000 });

  // Post-process: if postcode is empty, try to detect city name and map to postcode
  if (!result.postcode || result.postcode === '') {
    const cityPostcodes = {
      'amsterdam': '1012JS', 'rotterdam': '3011AA', 'den haag': '2511AA', 'utrecht': '3511AB',
      'eindhoven': '5611AA', 'tilburg': '5038AA', 'groningen': '9711AA', 'almere': '1315AA',
      'breda': '4811AA', 'nijmegen': '6511AA', 'enschede': '7511AA', 'haarlem': '2011AA',
      'arnhem': '6811AA', 'zaanstad': '1506AA', 'amersfoort': '3811AA', 'apeldoorn': '7311AA',
      'hoofddorp': '2132AA', 's-hertogenbosch': '5211AA', 'den bosch': '5211AA',
      'maastricht': '6211AA', 'leiden': '2311AA', 'dordrecht': '3311AA', 'zoetermeer': '2711AA',
      'zwolle': '8011AA', 'deventer': '7411AA', 'delft': '2611AA', 'alkmaar': '1811AA',
      'heerlen': '6411AA', 'venlo': '5911AA', 'leeuwarden': '8911AA', 'hilversum': '1211AA'
    };
    const lowerText = letterText.toLowerCase();
    const cityMatch = Object.keys(cityPostcodes).find(city =>
      new RegExp(`\\b${city}\\b`, 'i').test(lowerText)
    );
    if (cityMatch) {
      result.postcode = cityPostcodes[cityMatch];
      console.log(`[extraction] Mapped city "${cityMatch}" to postcode ${result.postcode}`);
    }
  }

  // Attach redaction metadata to result
  if (redactionResult) {
    result._redaction = {
      applied: true,
      stats: redactionResult.stats,
      totalRedacted: redactionResult.totalRedacted
    };
  }

  return result;
}

// Extract additional tags from screenteam question answers
// This is a lighter-weight extraction that focuses on finding new tags from the conversation
export async function extractAdditionalTags(questionAnswers, existingTags = []) {
  if (!questionAnswers || questionAnswers.length === 0) return [];

  const answeredQuestions = questionAnswers.filter(q => q.answer && q.answer.trim());
  if (answeredQuestions.length === 0) return [];

  const conversationText = answeredQuestions
    .map(q => `Vraag: ${q.text}\nAntwoord: ${q.answer}`)
    .join('\n\n');

  if (MOCK_MODE) {
    return mockTagExtraction(conversationText, existingTags);
  }

  const taxonomy = loadTaxonomy();
  const existingTagNames = existingTags.map(t => t.name);

  const tool = {
    name: 'extract_additional_tags',
    description: 'Extract additional Forta tags from screenteam phone conversation notes.',
    input_schema: {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          description: 'New tags discovered from the conversation. Only include tags NOT already in the existing list.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              category: { type: 'string', enum: TAXONOMY_CATEGORIES },
              evidence: { type: 'string', description: 'Quote from the conversation that supports this tag.' }
            },
            required: ['name','category','evidence']
          }
        }
      },
      required: ['tags']
    }
  };

  const system = `Je bent een extractie-agent voor Forta Match. Je analyseert notities van een screenteam-telefoongesprek en extraheert aanvullende tags die relevant zijn voor de matching. Tags MOGEN ALLEEN namen bevatten die exact in de meegeleverde taxonomie voorkomen.`;

  const userMsg = `Taxonomie (gebruik alleen deze tagnamen):\n${taxonomy.map(t=>`- ${t.name} [${t.category}]`).join('\n')}\n\nAl toegekende tags (niet herhalen):\n${existingTagNames.join(', ') || '(geen)'}\n\nTelefoongesprek notities:\n"""\n${conversationText}\n"""`;

  try {
    const result = await runStructured({ system, user: userMsg, tool, maxTokens: 1000 });
    return result.tags || [];
  } catch (e) {
    console.error('[extractAdditionalTags] Error:', e);
    return [];
  }
}

// Mock tag extraction for conversation text
function mockTagExtraction(text, existingTags) {
  const lower = text.toLowerCase();
  const existingNames = new Set(existingTags.map(t => t.name.toLowerCase()));
  const newTags = [];

  const maybeAdd = (name, category, evidence) => {
    if (!existingNames.has(name.toLowerCase())) {
      newTags.push({ name, category, evidence });
      existingNames.add(name.toLowerCase());
    }
  };

  // Simple pattern matching for common terms in conversation
  if (/concentratie|aandacht|focus/.test(lower)) maybeAdd('ADHD', 'klachtprofiel', 'concentratieproblemen besproken');
  if (/angst|paniek|bang/.test(lower)) maybeAdd('angst', 'klachtprofiel', 'angstklachten besproken');
  if (/somber|depressie|stemming|verdriet/.test(lower)) maybeAdd('depressie', 'klachtprofiel', 'stemmingsklachten besproken');
  if (/trauma|nachtmerries|flashback/.test(lower)) maybeAdd('trauma', 'klachtprofiel', 'trauma besproken');
  if (/diagnose|diagnostiek|onderzoek|duidelijkheid/.test(lower)) maybeAdd('diagnostiek', 'procedureel', 'diagnostiekvraag besproken');
  if (/behandel|therapie|hulp/.test(lower)) maybeAdd('behandeling', 'procedureel', 'behandelvraag besproken');
  if (/online|beeldbel|afstand/.test(lower)) maybeAdd('online', 'zorgtype', 'voorkeur online besproken');
  if (/werk|overbelast|stress|burnout/.test(lower)) maybeAdd('werkgerelateerd', 'klachtprofiel', 'werkgerelateerde stress besproken');

  return newTags;
}

// --- Mock fallback (used when ANTHROPIC_API_KEY is missing) ---
function mockExtraction(text) {
  const lower = text.toLowerCase();
  const tags = [];
  const push = (name, category, ev) => tags.push({ name, category, evidence: ev });
  // crude negation check: don't match if "geen", "niet", "geen aanwijzingen voor" precedes the keyword (within 25 chars)
  const has = (re) => {
    const m = lower.match(re);
    if (!m) return false;
    const idx = m.index;
    const before = lower.slice(Math.max(0, idx - 25), idx);
    if (/(geen|niet|zonder|geen aanwijzingen voor|geen sprake van)\b[^.]{0,20}$/.test(before)) return false;
    return true;
  };
  if (has(/(adhd|aandachtstekort|ad\/hd)/)) push('ADHD','klachtprofiel', 'ADHD genoemd in brief');
  if (has(/(autisme|ass|autismespectrum)/)) push('autisme','klachtprofiel', 'autisme genoemd');
  if (has(/(angst|paniek|sociale angst)/)) push('angst','klachtprofiel', 'angstklachten');
  if (has(/(depressie|somber|stemming)/)) push('depressie','klachtprofiel', 'stemmingsklachten');
  if (has(/(trauma|ptss|nachtmerries)/)) push('trauma','klachtprofiel', 'trauma');
  if (has(/(borderline|persoonlijkheid)/)) push('persoonlijkheidsproblematiek','klachtprofiel','persoonlijkheidssignalen');
  if (has(/(verslav|alcohol|drugs|cannabis)/)) push('verslaving','comorbiditeit','middelengebruik');
  if (has(/(diagnostiek|onderzoek|assessment|vermoeden|vermoed)/)) push('diagnostiek','procedureel','diagnostiek gevraagd');
  if (has(/(behandel|therapie|hulp|klachten)/)) push('behandeling','procedureel','behandeling gevraagd');
  if (has(/(psychose|wanen)/)) push('actieve psychose','exclusie','psychotische signalen');
  if (has(/(suïcid|suicid|zelfmoord)/)) push('acute suïcidaliteit','exclusie','suïcidale uitingen');
  if (has(/(forensisch|justitie|reclassering)/)) push('forensisch','exclusie','forensisch profiel');
  if (has(/(online|beeldbel)/)) push('online','zorgtype','voorkeur online');
  if (!tags.find(t=>t.category==='doelgroep')) push('volwassenen','doelgroep','volwassen patiënt aangenomen');
  // Bij verkennende korte vragen wordt vaak geen expliciete procedurele
  // intentie genoemd. Als er wel een klachtprofiel staat maar geen
  // diagnostiek/behandeling, nemen we behandeling als veilige default —
  // anders vallen alle Forta-labels af op de incl_required-knock-out.
  if (tags.some(t => t.category === 'klachtprofiel') && !tags.some(t => t.category === 'procedureel')) {
    push('behandeling', 'procedureel', 'default — behandelvraag aangenomen');
  }

  const ageMatch = text.match(/(\d{1,2})\s*(jaar|jr|j\.)/i);
  const postcodeMatch = text.match(/\b(\d{4}\s?[A-Z]{0,2})\b/);

  // Map city names to representative postcodes for location matching
  const cityPostcodes = {
    'amsterdam': '1012JS', 'rotterdam': '3011AA', 'den haag': '2511AA', 'utrecht': '3511AB',
    'eindhoven': '5611AA', 'tilburg': '5038AA', 'groningen': '9711AA', 'almere': '1315AA',
    'breda': '4811AA', 'nijmegen': '6511AA', 'enschede': '7511AA', 'haarlem': '2011AA',
    'arnhem': '6811AA', 'zaanstad': '1506AA', 'amersfoort': '3811AA', 'apeldoorn': '7311AA',
    'hoofddorp': '2132AA', 's-hertogenbosch': '5211AA', 'den bosch': '5211AA',
    'maastricht': '6211AA', 'leiden': '2311AA', 'dordrecht': '3311AA', 'zoetermeer': '2711AA',
    'zwolle': '8011AA', 'deventer': '7411AA', 'delft': '2611AA', 'alkmaar': '1811AA',
    'heerlen': '6411AA', 'venlo': '5911AA', 'leeuwarden': '8911AA', 'hilversum': '1211AA'
  };
  const cityMatch = Object.keys(cityPostcodes).find(city =>
    new RegExp(`\\b${city}\\b`, 'i').test(text)
  );
  const detectedPostcode = postcodeMatch
    ? postcodeMatch[1].toUpperCase().replace(/\s/,'')
    : (cityMatch ? cityPostcodes[cityMatch] : '3511AB');

  return {
    patient_initials: (text.match(/\b([A-Z]\.[A-Z]\.)/) || ['',''])[1] || 'J.K.',
    patient_age: ageMatch ? parseInt(ageMatch[1],10) : 28,
    postcode: detectedPostcode,
    insurer_name: /(zilveren kruis|vgz|cz|menzis|dsw)/i.exec(text)?.[1] ?? 'Zilveren Kruis',
    agb_referrer: (text.match(/AGB[:\s]*(\d{6,8})/i) || ['','94001234'])[1],
    letter_date: new Date().toISOString().slice(0,10),
    signature_present: /(getekend|handtekening)/i.test(text) || true,
    hulpvraag: text.split(/[.\n]/).find(s => s.length > 30)?.trim().slice(0,240) ?? 'Cliënt vraagt diagnostiek en behandeling.',
    dsm_suspicion: tags.find(t=>t.category==='klachtprofiel')?.name ?? '',
    contact_phone: '06-12345678',
    contact_email: 'patient@example.com',
    is_hospital_referral: /(ziekenhuis|hospital|umc)/i.test(text),
    tags,
    llm_confidence: 0.55
  };
}
