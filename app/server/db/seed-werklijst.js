// Seed cases die op de secretariaat-werklijst zichtbaar zijn — verdeeld over
// alle filter-buckets (groen, oranje, rood, incompleet, besluit) zodat elke
// filter-chip altijd resultaten geeft.
import { db, audit } from './index.js';
import { runMatching } from '../rules.js';

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// Bucket → (advice + knockout + status) combinatie die renderWerklijst() in
// public/app.js naar het juiste filter mapt:
//   groen      : status klaar_voor_match, advice='ja', knockout=0
//   oranje     : status klaar_voor_match, advice='twijfel'
//   rood       : status klaar_voor_match, advice='nee' of knockout=1
//   incompleet : status='incompleet'
//   besluit    : status='besloten' + decisions-row
const samples = [
  // ---- groen (advice ja) ----
  { ref: 'VB-2026-1041', channel: 'zorgdomein', init: 'M.K.',  age: 34, pc: '3511AB', ins: 'CZ',
    days: 0, bucket: 'groen', dsm: 'ADHD', tags: ['ADHD','behandeling','volwassenen'],
    hulpvraag: 'Cliënt vraagt behandeling voor eerder vastgestelde ADHD bij volwassenen. Stabiele voorgeschiedenis.' },
  { ref: 'VB-2026-1040', channel: 'zivver', init: 'P.V.', age: 41, pc: '1012JS', ins: 'VGZ',
    days: 0, bucket: 'groen', dsm: 'angst', tags: ['angst','depressie','behandeling','volwassenen'],
    hulpvraag: 'Behandeling angst- en stemmingsklachten gewenst, geen complicerende factoren.' },
  { ref: 'VB-2026-1034', channel: 'zorgdomein', init: 'B.J.', age: 36, pc: '1211AA', ins: 'Zilveren Kruis',
    days: 3, bucket: 'groen', dsm: 'eetstoornis', tags: ['eetstoornis','behandeling','volwassenen'],
    hulpvraag: 'Aanmelding eetstoornisbehandeling, motivatie hoog, geen comorbide verslaving.' },

  // ---- oranje (advice twijfel) ----
  { ref: 'VB-2026-1038', channel: 'zorgdomein', init: 'L.B.', age: 29, pc: '3811NV', ins: 'Zilveren Kruis',
    days: 1, bucket: 'oranje', dsm: 'persoonlijkheidsproblematiek', tags: ['persoonlijkheidsproblematiek','behandeling','volwassenen'],
    hulpvraag: 'Cluster B-trekken, eerdere therapie zonder duurzaam effect. Schemagericht traject overwogen.' },
  { ref: 'VB-2026-1036', channel: 'zivver', init: 'D.S.', age: 52, pc: '1012JS', ins: 'Menzis',
    days: 1, bucket: 'oranje', dsm: 'trauma', tags: ['trauma','behandeling','volwassenen'],
    hulpvraag: 'EMDR-traject overwogen na recente traumatische gebeurtenis, voorgeschiedenis stabiel.' },

  // ---- rood (advice nee) ----
  { ref: 'VB-2026-1037', channel: 'mailbox', init: 'F.D.', age: 58, pc: '3011AA', ins: 'CZ',
    days: 1, bucket: 'rood', dsm: 'depressie', tags: ['depressie','volwassenen','somatische comorbiditeit'],
    hulpvraag: 'Ziekenhuisverwijzing — neuroloog vraagt psychogene route, GGZ-passendheid onzeker.',
    is_hospital: true },
  { ref: 'VB-2026-1033', channel: 'mailbox', init: 'D.K.', age: 52, pc: '1012JS', ins: 'CZ',
    days: 3, bucket: 'rood', dsm: 'depressie', tags: ['depressie','volwassenen','somatische comorbiditeit'],
    hulpvraag: 'Neurologische verwijzing UMC, cognitieve klachten zonder organische verklaring.',
    is_hospital: true },

  // ---- incompleet ----
  { ref: 'VB-2026-1039', channel: 'mailbox', init: '—',  age: null, pc: null, ins: null,
    days: 0, bucket: 'incompleet', dsm: 'trauma', tags: ['trauma'],
    hulpvraag: 'Trauma vermoed, brief mist contactgegevens en ondertekening.' },
  { ref: 'VB-2026-1035', channel: 'zivver', init: 'A.E.', age: 28, pc: '2511CK', ins: null,
    days: 2, bucket: 'incompleet', dsm: 'angst', tags: ['angst','volwassenen'],
    hulpvraag: 'Brief mist DSM-5 vermoeden en verzekeraar.' },

  // ---- besluit genomen ----
  { ref: 'VB-2026-1030', channel: 'zorgdomein', init: 'R.H.', age: 39, pc: '3511AB', ins: 'Zilveren Kruis',
    days: 5, bucket: 'besluit', dsm: 'ADHD', tags: ['ADHD','diagnostiek','volwassenen'],
    hulpvraag: 'Diagnostiek ADHD afgerond, match aan Forta-locatie Utrecht.',
    outcome: 'match' },
  { ref: 'VB-2026-1029', channel: 'mailbox', init: 'T.W.', age: 45, pc: '5611AA', ins: 'DSW',
    days: 6, bucket: 'besluit', dsm: 'depressie', tags: ['depressie','behandeling','volwassenen'],
    hulpvraag: 'Behandeling depressie, geen contract met DSW — afgewezen met doorverwijzing.',
    outcome: 'afwijzen' },
];

const ins = {
  case: db.prepare(`INSERT INTO cases (ref_code, channel, patient_initials, patient_age, postcode, insurer_name, raw_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  extraction: db.prepare(`INSERT INTO case_extractions (case_id, fields_json, tags_json, llm_confidence) VALUES (?, ?, ?, 0.7)`),
  completeness: db.prepare(`INSERT INTO completeness_results (case_id, items_json, is_complete, summary_text) VALUES (?, ?, ?, ?)`),
  knockout: db.prepare(`INSERT INTO knockout_results (case_id, triggered, criterion, reasoning) VALUES (?, ?, ?, ?)`),
  match: db.prepare(`INSERT INTO match_runs (case_id, modus, options_json, advice) VALUES (?, 'snelste_hulp', ?, ?)`),
  decision: db.prepare(`INSERT INTO decisions (case_id, actor_role, actor_name, outcome, motivation) VALUES (?, 'secretariaat', 'Maria Boom', ?, ?)`),
};

function rawText(s) {
  return `Verwijsbrief — ${s.ref}
Cliënt: ${s.init}${s.age ? ', ' + s.age + ' jaar' : ''}${s.pc ? ', postcode ' + s.pc : ''}.
Verzekeraar: ${s.ins || '—'}.
${s.is_hospital ? 'Verwezen door ziekenhuis (specialistische context).\n' : ''}Hulpvraag: ${s.hulpvraag}
Vermoedelijke DSM-5: ${s.dsm}.`;
}

function buildFields(s) {
  return {
    patient_initials: s.init || '',
    patient_age: s.age || 0,
    postcode: s.pc || '',
    insurer_name: s.ins || '',
    agb_referrer: s.bucket === 'incompleet' ? '' : '94001234',
    letter_date: s.bucket === 'incompleet' && !s.pc ? '' : new Date().toISOString().slice(0,10),
    signature_present: s.bucket !== 'incompleet',
    hulpvraag: s.hulpvraag,
    dsm_suspicion: s.dsm,
    contact_phone: s.bucket === 'incompleet' ? '' : '06-12345678',
    contact_email: '',
    is_hospital_referral: !!s.is_hospital,
    tags: s.tags.map(name => ({ name, category: categoryOf(name), evidence: name })),
    llm_confidence: 0.7
  };
}

function categoryOf(name) {
  if (['ADHD','autisme','angst','depressie','trauma','persoonlijkheidsproblematiek','eetstoornis'].includes(name)) return 'klachtprofiel';
  if (['diagnostiek','behandeling'].includes(name)) return 'procedureel';
  if (['volwassenen','jongvolwassenen','ouderen'].includes(name)) return 'doelgroep';
  if (['verslaving','somatische comorbiditeit'].includes(name)) return 'comorbiditeit';
  if (['actieve psychose','acute suïcidaliteit','forensisch','primair somatisch'].includes(name)) return 'exclusie';
  return 'zorgtype';
}

function statusForBucket(b) {
  if (b === 'incompleet') return 'incompleet';
  if (b === 'besluit')    return 'besloten';
  return 'klaar_voor_match';
}

// Idempotent: schoonmaken al gebeurd in seed.js wipe — hier dus puur inserts.
db.transaction(() => {
  for (const s of samples) {
    const ts = daysAgo(s.days ?? 0);
    const r = ins.case.run(s.ref, s.channel, s.init, s.age, s.pc, s.ins, rawText(s), statusForBucket(s.bucket), ts, ts);
    const id = r.lastInsertRowid;

    const fields = buildFields(s);
    ins.extraction.run(id, JSON.stringify(fields), JSON.stringify(fields.tags));

    const items = [
      { field:'patient_initials', label:'Naam + BSN cliënt', status: s.init === '—' ? 'missing' : 'ok', message: s.init === '—' ? 'Ontbreekt' : 'Aanwezig' },
      { field:'agb_referrer',     label:'AGB-code verwijzer', status: fields.agb_referrer ? 'ok' : 'missing', message: fields.agb_referrer ? 'Aanwezig' : 'Ontbreekt' },
      { field:'letter_date',      label:'Datum verwijsbrief', status: fields.letter_date ? 'ok' : 'missing', message: fields.letter_date ? 'Geldig' : 'Ontbreekt' },
      { field:'signature_present',label:'Handtekening arts',  status: fields.signature_present ? 'ok' : 'missing', message: fields.signature_present ? 'Aanwezig' : 'Ontbreekt' },
      { field:'dsm_suspicion',    label:'Vermoedelijke DSM-5', status:'ok', message: fields.dsm_suspicion },
      { field:'postcode',         label:'Locatievoorkeur cliënt', status: fields.postcode ? 'ok' : 'missing', message: fields.postcode || 'Ontbreekt' },
      { field:'hulpvraag',        label:'Hulpvraag',           status:'ok', message:'Voldoende lengte' },
      { field:'contact_phone',    label:'Contactgegevens',     status: fields.contact_phone ? 'ok' : 'missing', message: fields.contact_phone || 'Ontbreekt' },
    ];
    const isComplete = items.every(i => i.status !== 'missing') ? 1 : 0;
    ins.completeness.run(id, JSON.stringify(items), isComplete, isComplete ? null : 'Aanvullende gegevens nodig.');

    ins.knockout.run(id, s.is_hospital ? 1 : 0, s.is_hospital ? 'buiten_kader' : null, s.is_hospital ? 'Ziekenhuiscontext — niet passend voor Forta GGZ.' : null);

    const advice = s.bucket === 'groen' ? 'ja' : s.bucket === 'oranje' ? 'twijfel' : s.bucket === 'rood' ? 'nee' : null;
    if (advice) {
      const matchResult = runMatching(fields);
      ins.match.run(id, JSON.stringify(matchResult.options), advice);
    }

    if (s.bucket === 'besluit') {
      ins.decision.run(id, s.outcome || 'match', s.outcome === 'afwijzen' ? 'Geen contract verzekeraar.' : 'Goede inhoudelijke match.');
    }

    audit('secretariaat', 'case.seeded', 'case', id, { bucket: s.bucket });
  }
})();

console.log(`Seed-werklijst done — ${samples.length} demo-cases over alle filter-buckets.`);
