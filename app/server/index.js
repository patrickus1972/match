import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';

import { db, audit, getSetting, setSetting } from './db/index.js';
import { extractReferral, extractAdditionalTags } from './agents/extraction.js';
import { runCompletenessCheck, runSimpleCompletenessCheck, generateTerugstuurbrief } from './agents/completeness.js';
import { runKnockoutScan } from './agents/knockout.js';
import { feedbackTurn, summarizeFeedback } from './agents/feedback.js';
import { runMatching } from './rules.js';
import { MOCK_MODE } from './agents/client.js';
import { requireRole, requireAuth, optionalAuth, registerAuthRoutes, ROLES } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const UPLOAD_DIR = path.resolve(__dirname, '../data/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Auth mode: 'enforce' = require auth, 'optional' = allow anonymous, 'disabled' = no auth
const AUTH_MODE = process.env.AUTH_MODE || 'optional';

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use(express.static(PUBLIC_DIR));

// Register auth routes (/api/auth/login, /api/auth/me, /api/auth/logout)
registerAuthRoutes(app);

// Optional: Add user context to all requests if token present
app.use(optionalAuth);

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 15 * 1024 * 1024 } });

// ---------- Status / health ----------
app.get('/api/status', (_, res) => {
  res.json({
    mock_mode: MOCK_MODE,
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    modus: getSetting('business_modus', 'snelste_hulp')
  });
});

// ---------- Cases ----------
function generateRefCode(channel) {
  const prefix = channel === 'zorgdomein' ? 'ZD' : channel === 'zivver' ? 'ZV' : 'MB';
  const n = Math.floor(Math.random() * 900000) + 100000;
  return `${prefix}-2026-${n}`;
}

// Upload single (PDF or pasted text). For pilot we accept both.
app.post('/api/cases', upload.single('file'), async (req, res) => {
  try {
    const channel = req.body.channel || 'mailbox';
    let raw_text = req.body.text || '';
    if (req.file) {
      if (req.file.mimetype === 'application/pdf') {
        const { default: pdf } = await import('pdf-parse');
        const buf = fs.readFileSync(req.file.path);
        const parsed = await pdf(buf);
        raw_text = parsed.text;
      } else {
        raw_text = fs.readFileSync(req.file.path, 'utf8');
      }
    }
    // In MOCK-modus: als de PDF-inhoud klein/onsamenhangend lijkt (geen
    // herkenbare verwijsbrief-fraseologie), vervangen we de tekst door een
    // realistische mock-verwijsbrief zodat de demo altijd een fatsoenlijk
    // brief-format toont. In LIVE-modus respecteren we de PDF altijd.
    if (MOCK_MODE && req.file) {
      const t = (raw_text || '').toLowerCase();
      // Stricter check: must look like an actual medical referral letter
      // - Should start with "Geachte" or contain patient-specific language
      // - Should NOT be a document about Forta Match itself
      const isAboutFortaMatch = /forta\s*(match|groep)|matching\s*en\s*doorverwijzing|labels\s*van\s*de/i.test(raw_text);
      const hasReferralStructure = /^[\s\n]*geachte\s+(collega|dokter|arts)/i.test(raw_text) ||
        (/hulpvraag[:\s]/i.test(t) && /cli[eë]nt|pati[eë]nt/i.test(t));
      const looksLikeReferral = !isAboutFortaMatch && hasReferralStructure && t.length > 200;
      if (!looksLikeReferral) {
        const idx = Math.floor(Math.random() * INTERN_MOCK_TRANSCRIPTS.length);
        raw_text = INTERN_MOCK_TRANSCRIPTS[idx];
      }
    }
    if (!raw_text || raw_text.trim().length < 30) {
      return res.status(400).json({ error: 'Geen brieftekst ontvangen (te kort).' });
    }
    const ref_code = generateRefCode(channel);
    const result = db.prepare(`INSERT INTO cases (ref_code, channel, raw_text) VALUES (?, ?, ?)`)
      .run(ref_code, channel, raw_text);
    const case_id = result.lastInsertRowid;
    audit('secretariaat','case.created','case', case_id, { ref_code, channel });

    // Run extraction immediately (synchronous)
    const extraction = await extractReferral(raw_text);
    db.prepare(`INSERT INTO case_extractions (case_id, fields_json, tags_json, llm_confidence) VALUES (?, ?, ?, ?)`)
      .run(case_id, JSON.stringify(extraction), JSON.stringify(extraction.tags || []), extraction.llm_confidence || null);

    // Patient details into the case row for convenience
    db.prepare(`UPDATE cases SET patient_initials=?, patient_age=?, postcode=?, insurer_name=?, status='klaar_voor_match', updated_at=datetime('now') WHERE id=?`)
      .run(extraction.patient_initials || null, extraction.patient_age || null, extraction.postcode || null, extraction.insurer_name || null, case_id);

    // Volledigheidscheck
    const comp = runCompletenessCheck(extraction);
    db.prepare(`INSERT INTO completeness_results (case_id, items_json, is_complete, summary_text) VALUES (?, ?, ?, ?)`)
      .run(case_id, JSON.stringify(comp.items), comp.isComplete ? 1 : 0, comp.summary || null);
    if (!comp.isComplete) {
      db.prepare(`UPDATE cases SET status='incompleet' WHERE id=?`).run(case_id);
    }

    // Knockout scan
    const ko = await runKnockoutScan(extraction);
    db.prepare(`INSERT INTO knockout_results (case_id, triggered, criterion, reasoning) VALUES (?, ?, ?, ?)`)
      .run(case_id, ko.triggered ? 1 : 0, ko.criterion || null, ko.reasoning || null);

    res.json({ case_id, ref_code, extraction, completeness: comp, knockout: ko });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Interne aanvraag (mock-verwijsbrief in MOCK_MODE) ----------
// Realistische verwijsbrief-teksten zodat de volledigheidscheck en matching
// op herkenbare GGZ-verwijzing input draaien wanneer er geen Anthropic API
// key beschikbaar is. Opzet volgt het format dat huisartsen gebruiken
// (aanhef, persoonsgegevens, hulpvraag, klachten, exclusies, ondertekening).
const INTERN_MOCK_TRANSCRIPTS = [
`Geachte collega,

Hierbij verwijs ik mevrouw M. Jansen (geboortejaar 1995, 29 jaar), wonende te Utrecht (3511 AB), voor verdere diagnostiek bij vermoeden van ADHD.

Hulpvraag: Cliënte meldt zich met langdurige concentratieproblemen en moeite met plannen en organiseren op het werk. Klachten zijn aanwezig vanaf de jeugd. Zij volgde recent een coachingstraject en wenst nu nadere diagnostiek voor vaststelling van ADHD en eventuele behandeling.

Voorgeschiedenis: In het verleden kortdurend paniekklachten gehad (2019), inmiddels in remissie. Geen actuele suïcidaliteit, geen psychotische symptomen, geen verslavingsproblematiek.

Verzekeraar: Zilveren Kruis.
Telefoon cliënte: 06-12345678
E-mail: mjansen@example.nl

Met vriendelijke groet,
J. Klein, huisarts
AGB-code: 94001234
Praktijk Klein, Utrecht
Datum: ${new Date().toISOString().slice(0,10)}`,

`Geachte collega,

Op verzoek van patiënt verwijs ik de heer P. de Vries (geboortejaar 1979, 45 jaar) uit Eindhoven (5611 AB) voor behandeling bij vermoeden van een persoonlijkheidsproblematiek (mogelijk borderline-trekken).

Hulpvraag: Patiënt rapporteert al langere tijd somberheidsklachten, prikkelbaarheid en relationele moeilijkheden. Hij heeft expliciete motivatie voor behandeling.

Voorgeschiedenis: Eerder kortdurend onder behandeling bij POH-GGZ (2022) voor depressieve klachten. Geen actieve suïcidaliteit, geen psychose, geen verslaving.

Verzekeraar: VGZ.
Telefoon: 06-98765432

Met vriendelijke groet,
A. de Boer, huisarts
AGB-code: 94005678
Datum: ${new Date().toISOString().slice(0,10)}`,

`Geachte collega,

Bij dezen verwijs ik de heer T. el Hamoudi (geboortejaar 1989, 34 jaar) uit Amsterdam (1015 CN) voor behandeling van angst- en stemmingsklachten.

Hulpvraag: Patiënt ervaart sinds een halfjaar toenemende angstklachten met paniekaanvallen en periodes van somberheid. Werk en relaties komen onder druk te staan. Cliënt heeft voorkeur voor online behandeling vanwege flexibiliteit.

Voorgeschiedenis: Eerder gesprekken bij POH-GGZ (2023) met goed resultaat, klachten zijn nu opnieuw verergerd. Geen suïcidaliteit, geen psychotische symptomen, geen middelenproblematiek.

Verzekeraar: CZ.
Telefoon: 06-55667788
E-mail: t.elhamoudi@example.nl

Met vriendelijke groet,
S. Visser, huisarts
AGB-code: 94009012
Datum: ${new Date().toISOString().slice(0,10)}`
];

app.post('/api/cases/intern/transcribe', upload.single('audio'), async (req, res) => {
  // NOTE: Transcription now happens client-side via Web Speech API (browser-native).
  // This endpoint is kept as a fallback for browsers without speech recognition support.
  // It returns a sample transcript that the user should edit manually.
  try {
    const idx = Math.floor(Math.random() * INTERN_MOCK_TRANSCRIPTS.length);
    const transcript = INTERN_MOCK_TRANSCRIPTS[idx];
    audit('secretariaat','case.intern.transcribed', null, null, { audio_received: !!req.file, length: transcript.length, fallback: true });
    res.json({ transcript, mock: true, fallback: true, message: 'Spraakherkenning niet beschikbaar — gebruik Chrome of Edge voor live transcriptie.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cases/intern', async (req, res) => {
  try {
    const text = (req.body?.text || '').trim();
    if (text.length < 20) return res.status(400).json({ error: 'Bericht te kort.' });
    const ref_code = `IN-2026-${Math.floor(Math.random()*900000)+100000}`;
    const result = db.prepare(`INSERT INTO cases (ref_code, channel, raw_text) VALUES (?, 'intern', ?)`).run(ref_code, text);
    const case_id = result.lastInsertRowid;
    audit('secretariaat','case.intern.created','case', case_id, { ref_code });

    const extraction = await extractReferral(text);
    db.prepare(`INSERT INTO case_extractions (case_id, fields_json, tags_json, llm_confidence) VALUES (?, ?, ?, ?)`)
      .run(case_id, JSON.stringify(extraction), JSON.stringify(extraction.tags || []), extraction.llm_confidence || null);
    db.prepare(`UPDATE cases SET patient_initials=?, patient_age=?, postcode=?, insurer_name=?, status='klaar_voor_match', updated_at=datetime('now') WHERE id=?`)
      .run(extraction.patient_initials || null, extraction.patient_age || null, extraction.postcode || null, extraction.insurer_name || null, case_id);

    const comp = runCompletenessCheck(extraction);
    db.prepare(`INSERT INTO completeness_results (case_id, items_json, is_complete, summary_text) VALUES (?, ?, ?, ?)`)
      .run(case_id, JSON.stringify(comp.items), comp.isComplete ? 1 : 0, comp.summary || null);
    if (!comp.isComplete) db.prepare(`UPDATE cases SET status='incompleet' WHERE id=?`).run(case_id);

    const ko = await runKnockoutScan(extraction);
    db.prepare(`INSERT INTO knockout_results (case_id, triggered, criterion, reasoning) VALUES (?, ?, ?, ?)`)
      .run(case_id, ko.triggered ? 1 : 0, ko.criterion || null, ko.reasoning || null);

    res.json({ case_id, ref_code, extraction, completeness: comp, knockout: ko });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cases', (_, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.ref_code, c.channel, c.patient_initials, c.patient_age, c.status, c.created_at,
      (SELECT triggered FROM knockout_results WHERE case_id=c.id ORDER BY id DESC LIMIT 1) AS knockout,
      (SELECT advice FROM match_runs WHERE case_id=c.id ORDER BY id DESC LIMIT 1) AS advice,
      (SELECT outcome FROM decisions WHERE case_id=c.id ORDER BY id DESC LIMIT 1) AS last_outcome,
      (SELECT motivation FROM decisions WHERE case_id=c.id ORDER BY id DESC LIMIT 1) AS last_motivation
    FROM cases c
    ORDER BY c.created_at DESC LIMIT 100
  `).all();
  res.json(rows);
});

app.get('/api/cases/:id', (req, res) => {
  const id = +req.params.id;
  const row = db.prepare(`SELECT * FROM cases WHERE id=?`).get(id);
  if (!row) return res.status(404).end();
  const extraction = db.prepare(`SELECT * FROM case_extractions WHERE case_id=?`).get(id);
  const completeness = db.prepare(`SELECT * FROM completeness_results WHERE case_id=? ORDER BY id DESC LIMIT 1`).get(id);
  const knockout = db.prepare(`SELECT * FROM knockout_results WHERE case_id=? ORDER BY id DESC LIMIT 1`).get(id);
  const lastMatch = db.prepare(`SELECT * FROM match_runs WHERE case_id=? ORDER BY id DESC LIMIT 1`).get(id);
  const decision = db.prepare(`SELECT * FROM decisions WHERE case_id=? ORDER BY id DESC LIMIT 1`).get(id);
  res.json({
    ...row,
    extraction: extraction ? { ...extraction, fields: JSON.parse(extraction.fields_json), tags: JSON.parse(extraction.tags_json) } : null,
    completeness: completeness ? { ...completeness, items: JSON.parse(completeness.items_json) } : null,
    knockout,
    last_match: lastMatch ? { ...lastMatch, options: JSON.parse(lastMatch.options_json) } : null,
    decision
  });
});

// Re-run completeness (e.g. after edit) — not required for pilot but handy
app.post('/api/cases/:id/recheck', async (req, res) => {
  const id = +req.params.id;
  const ext = db.prepare(`SELECT * FROM case_extractions WHERE case_id=?`).get(id);
  if (!ext) return res.status(404).end();
  const extraction = JSON.parse(ext.fields_json);
  const comp = runCompletenessCheck(extraction);
  db.prepare(`INSERT INTO completeness_results (case_id, items_json, is_complete, summary_text) VALUES (?, ?, ?, ?)`)
    .run(id, JSON.stringify(comp.items), comp.isComplete ? 1 : 0, comp.summary || null);
  res.json(comp);
});

// Generate terugstuurbrief via LLM (or fallback to deterministic summary)
app.post('/api/cases/:id/terugstuurbrief', async (req, res) => {
  const id = +req.params.id;
  const ext = db.prepare(`SELECT fields_json FROM case_extractions WHERE case_id=?`).get(id);
  const compRow = db.prepare(`SELECT * FROM completeness_results WHERE case_id=? ORDER BY id DESC LIMIT 1`).get(id);
  if (!ext || !compRow) return res.status(404).end();
  const extraction = JSON.parse(ext.fields_json);
  const items = JSON.parse(compRow.items_json);
  const missing = items.filter(i => i.status === 'missing').map(i => i.label);
  let mail = await generateTerugstuurbrief(missing, extraction);
  if (!mail) mail = { subject: 'Aanvullende gegevens nodig voor verwijzing', body: compRow.summary_text || '' };
  audit('secretariaat','case.terugstuurbrief.generated','case', id, { missing });
  res.json(mail);
});

// ---------- Verkennend gesprek (ephemeral, geen case) ----------
// Lichte endpoint die op vrije tekst extractie + matching draait zonder een
// case te persisteren. Frontend gebruikt het voor de "Aanbod verkennen" dialoog:
// gebruiker stelt een vraag, krijgt direct te zien welke labels in scope komen,
// kan info toevoegen en de hele lijst opvragen.
app.post('/api/explore', async (req, res) => {
  try {
    const text = (req.body?.text || '').trim();
    console.log('[explore] Received text:', text);
    if (text.length < 5) return res.status(400).json({ error: 'Tekst te kort.' });
    const extraction = await extractReferral(text);
    console.log('[explore] Extraction result:', JSON.stringify(extraction, null, 2));
    const result = runMatching(extraction, { modus: req.body?.modus });
    console.log('[explore] Matching result: advice=', result.advice, 'options=', result.options?.length);
    const live = result.options.filter(o => !o.knockedOut);
    audit('secretariaat','explore.match', null, null, { advice: result.advice, n: live.length });
    res.json({
      advice: result.advice,
      tags: extraction.tags || [],
      patient_age: extraction.patient_age,
      postcode: extraction.postcode,
      hulpvraag: extraction.hulpvraag,
      top: live.slice(0, 5),
      all: result.options,
      mock: MOCK_MODE
    });
  } catch (err) {
    console.error('[explore] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Matching ----------
app.post('/api/cases/:id/match', async (req, res) => {
  const id = +req.params.id;
  const ext = db.prepare(`SELECT * FROM case_extractions WHERE case_id=?`).get(id);
  if (!ext) return res.status(404).end();

  const baseTags = JSON.parse(ext.tags_json);
  let enrichedTags = [...baseTags];

  // Check if there are screenteam question answers to incorporate
  const questions = db.prepare(`SELECT text, answer FROM case_questions WHERE case_id=? AND answer IS NOT NULL AND answer != ''`).all(id);
  if (questions.length > 0) {
    try {
      const additionalTags = await extractAdditionalTags(questions, baseTags);
      if (additionalTags.length > 0) {
        // Mark additional tags as coming from screenteam conversation
        const markedTags = additionalTags.map(t => ({ ...t, source: 'screenteam' }));
        enrichedTags = [...baseTags, ...markedTags];
        console.log(`[match] Enriched with ${additionalTags.length} tags from screenteam: ${additionalTags.map(t => t.name).join(', ')}`);
      }
    } catch (e) {
      console.error('[match] Failed to extract additional tags:', e);
      // Continue with base tags only
    }
  }

  const extraction = { ...JSON.parse(ext.fields_json), tags: enrichedTags };
  const result = runMatching(extraction, { modus: req.body?.modus });

  // Include enrichment info and full tag list in result
  result.enrichedFromScreenteam = questions.length > 0;
  result.additionalTagCount = enrichedTags.length - baseTags.length;
  result.tags = enrichedTags;

  db.prepare(`INSERT INTO match_runs (case_id, modus, options_json, advice) VALUES (?, ?, ?, ?)`)
    .run(id, result.modus, JSON.stringify(result.options), result.advice);
  audit('secretariaat','case.match.run','case', id, { modus: result.modus, advice: result.advice, enrichedFromScreenteam: result.enrichedFromScreenteam });
  res.json(result);
});

// ---------- Decisions ----------
app.post('/api/cases/:id/decision', (req, res) => {
  const id = +req.params.id;
  const { actor_role = 'secretariaat', actor_name = 'Maria Boom', outcome, label_id = null, location_id = null, motivation = '' } = req.body || {};
  if (!['match','afwijzen','doorzetten_screenteam','niet_bereikbaar','terug_naar_secretariaat'].includes(outcome)) {
    return res.status(400).json({ error: 'invalid outcome' });
  }

  // Use transaction to ensure plafond update is atomic with decision
  const result = db.transaction(() => {
    // Insert decision
    db.prepare(`INSERT INTO decisions (case_id, actor_role, actor_name, outcome, label_id, location_id, motivation) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, actor_role, actor_name, outcome, label_id, location_id, motivation);

    // Update case status
    const newStatus =
      outcome === 'doorzetten_screenteam'    ? 'wacht_screenteam' :
      outcome === 'terug_naar_secretariaat'  ? 'klaar_voor_match' :
      /* match | afwijzen | niet_bereikbaar */ 'besloten';
    db.prepare(`UPDATE cases SET status=?, updated_at=datetime('now') WHERE id=?`).run(newStatus, id);

    // FO §3.6.5: Increment plafond_used when a match is confirmed
    let plafondUpdated = null;
    if (outcome === 'match' && label_id) {
      const caseRow = db.prepare(`SELECT insurer_name FROM cases WHERE id=?`).get(id);
      const insurerName = caseRow?.insurer_name;

      if (insurerName) {
        // Find the contract for this label + insurer and increment usage
        const updateResult = db.prepare(`
          UPDATE insurer_contracts
          SET plafond_used = plafond_used + 1
          WHERE label_id = ?
            AND insurer_id = (SELECT id FROM insurers WHERE LOWER(name) = LOWER(?))
            AND has_contract = 1
        `).run(label_id, insurerName);

        if (updateResult.changes > 0) {
          // Get updated plafond info for audit
          const contractInfo = db.prepare(`
            SELECT ic.plafond_used, ic.plafond_max, i.name AS insurer_name
            FROM insurer_contracts ic
            JOIN insurers i ON i.id = ic.insurer_id
            WHERE ic.label_id = ? AND LOWER(i.name) = LOWER(?)
          `).get(label_id, insurerName);

          plafondUpdated = {
            insurer: insurerName,
            label_id,
            new_used: contractInfo?.plafond_used,
            max: contractInfo?.plafond_max,
            pct: contractInfo?.plafond_max ? Math.round((contractInfo.plafond_used / contractInfo.plafond_max) * 100) : null
          };
        }
      }
    }

    return { newStatus, plafondUpdated };
  })();

  // Audit the decision
  audit(actor_role, 'case.decision', 'case', id, { outcome, label_id, location_id });

  // Audit plafond increment separately if it happened
  if (result.plafondUpdated) {
    audit(actor_role, 'plafond.incremented', 'insurer_contracts', label_id, result.plafondUpdated);

    // Warn if plafond is getting close to limit
    if (result.plafondUpdated.pct >= 90) {
      console.warn(`[plafond] Warning: ${result.plafondUpdated.insurer} plafond for label ${label_id} at ${result.plafondUpdated.pct}%`);
    }
  }

  res.json({ ok: true, plafondUpdated: result.plafondUpdated });
});

// ---------- Screenteam list ----------
app.get('/api/screen/cases', (_, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.ref_code, c.patient_initials, c.patient_age, c.created_at,
      (SELECT advice FROM match_runs WHERE case_id=c.id ORDER BY id DESC LIMIT 1) AS advice,
      (SELECT motivation FROM decisions WHERE case_id=c.id AND outcome='doorzetten_screenteam' ORDER BY id DESC LIMIT 1) AS reason,
      (SELECT triggered FROM knockout_results WHERE case_id=c.id ORDER BY id DESC LIMIT 1) AS knockout,
      (SELECT tags_json   FROM case_extractions WHERE case_id=c.id) AS tags_json
    FROM cases c
    WHERE c.status = 'wacht_screenteam'
    ORDER BY c.created_at ASC
  `).all();
  // tags_json mee-parsen zodat frontend type/comorbiditeit kan afleiden
  res.json(rows.map(r => ({
    ...r,
    tags: r.tags_json ? JSON.parse(r.tags_json) : [],
    tags_json: undefined
  })));
});

// ---------- Case questions (voorbereide vragen screenteam) ----------
app.get('/api/cases/:id/questions', (req, res) => {
  const id = +req.params.id;
  const rows = db.prepare(`SELECT id, position, text, source, answer, origin FROM case_questions WHERE case_id=? ORDER BY position`).all(id);
  res.json(rows);
});

app.post('/api/cases/:id/questions', (req, res) => {
  const id = +req.params.id;
  const { text, source = 'eigen toevoeging', origin = 'user' } = req.body || {};
  if (!text || !text.trim()) return res.status(400).json({ error: 'text verplicht' });
  if (!db.prepare(`SELECT 1 FROM cases WHERE id=?`).get(id)) return res.status(404).end();
  const max = db.prepare(`SELECT COALESCE(MAX(position), 0) AS m FROM case_questions WHERE case_id=?`).get(id).m;
  const r = db.prepare(`INSERT INTO case_questions (case_id, position, text, source, origin) VALUES (?, ?, ?, ?, ?)`)
    .run(id, max + 1, text.trim(), source, origin);
  audit('screenteam','case.question.added','case_question', r.lastInsertRowid, { case_id: id });
  res.json(db.prepare(`SELECT id, position, text, source, answer, origin FROM case_questions WHERE id=?`).get(r.lastInsertRowid));
});

app.put('/api/cases/:id/questions/:qid', (req, res) => {
  const id = +req.params.id, qid = +req.params.qid;
  const body = req.body || {};
  const hasText = Object.prototype.hasOwnProperty.call(body, 'text');
  const hasAnswer = Object.prototype.hasOwnProperty.call(body, 'answer');
  if (!hasText && !hasAnswer) return res.status(400).json({ error: 'text of answer verplicht' });
  if (hasText && (!body.text || !body.text.trim())) return res.status(400).json({ error: 'text mag niet leeg zijn' });

  const current = db.prepare(`SELECT text, answer FROM case_questions WHERE id=? AND case_id=?`).get(qid, id);
  if (!current) return res.status(404).end();
  const nextText = hasText ? body.text.trim() : current.text;
  // empty-string or explicit null clears the answer; undefined leaves it untouched
  const nextAnswer = hasAnswer
    ? (body.answer == null || String(body.answer).trim() === '' ? null : String(body.answer).trim())
    : current.answer;

  db.prepare(`UPDATE case_questions SET text=?, answer=?, updated_at=datetime('now') WHERE id=? AND case_id=?`)
    .run(nextText, nextAnswer, qid, id);
  audit('screenteam','case.question.edited','case_question', qid, { case_id: id, edited: { text: hasText, answer: hasAnswer } });
  res.json(db.prepare(`SELECT id, position, text, source, answer, origin FROM case_questions WHERE id=?`).get(qid));
});

app.delete('/api/cases/:id/questions/:qid', (req, res) => {
  const id = +req.params.id, qid = +req.params.qid;
  const changed = db.transaction(() => {
    const row = db.prepare(`SELECT position FROM case_questions WHERE id=? AND case_id=?`).get(qid, id);
    if (!row) return 0;
    db.prepare(`DELETE FROM case_questions WHERE id=?`).run(qid);
    db.prepare(`UPDATE case_questions SET position = position - 1 WHERE case_id=? AND position > ?`).run(id, row.position);
    return 1;
  })();
  if (!changed) return res.status(404).end();
  audit('screenteam','case.question.deleted','case_question', qid, { case_id: id });
  res.json({ ok: true });
});

// ---------- Belkaartje (print-view voor screenteam-belgesprek) ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

app.get('/api/cases/:id/belkaartje', (req, res) => {
  const id = +req.params.id;
  const c = db.prepare(`SELECT * FROM cases WHERE id=?`).get(id);
  if (!c) return res.status(404).send('Case niet gevonden');
  const ext = db.prepare(`SELECT fields_json FROM case_extractions WHERE case_id=?`).get(id);
  const fields = ext ? JSON.parse(ext.fields_json) : {};
  const tags = fields.tags || [];
  const questions = db.prepare(`SELECT position, text, source FROM case_questions WHERE case_id=? ORDER BY position`).all(id);
  const dec = db.prepare(`SELECT motivation FROM decisions WHERE case_id=? AND outcome='doorzetten_screenteam' ORDER BY id DESC LIMIT 1`).get(id);

  const tagsByCat = (cat) => tags.filter(t => t.category === cat);
  const klacht = tagsByCat('klachtprofiel');
  const exclusie = tagsByCat('exclusie');
  const procedureel = tagsByCat('procedureel');
  const veiligheidLabels = exclusie.length
    ? exclusie.map(t => `<span class="chip danger">⚠ ${escapeHtml(t.name)}</span>`).join('')
    : '<span class="chip safe">✓ Geen psychose · geen acute suïcidaliteit · geen forensisch profiel</span>';

  const now = new Date().toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' });

  const html = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<title>Belkaartje · ${escapeHtml(c.ref_code)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm 14mm 14mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1a1410; font-size: 11.5pt; line-height: 1.45; background: #fff; }
  h1, h2, h3, h4 { font-family: Georgia, 'Times New Roman', serif; font-weight: 500; letter-spacing: -0.01em; margin: 0; }
  h1 { font-size: 22pt; }
  h2 { font-size: 13pt; margin-top: 14px; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #1a1410; }
  .meta { color: #555; font-size: 9.5pt; }
  .mono { font-family: 'SF Mono', Consolas, Monaco, monospace; font-size: 10pt; }
  header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 8px; border-bottom: 2px solid #1a1410; margin-bottom: 6px; }
  header .left { display: flex; flex-direction: column; gap: 2px; }
  header .right { text-align: right; }
  header .eyebrow { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.12em; color: #5C1A2E; font-weight: 600; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; font-size: 10.5pt; margin-top: 4px; }
  .grid2 .label { color: #555; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.05em; }
  .grid2 .value { font-weight: 500; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .chip { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 9.5pt; border: 1px solid #999; }
  .chip.danger { border-color: #A8331F; background: #fbe9e4; color: #A8331F; font-weight: 500; }
  .chip.safe { border-color: #2D6A4F; background: #e8f3ec; color: #2D6A4F; }
  .chip.muted { border-color: #bbb; color: #555; }
  .reason { background: #fef9ef; border-left: 3px solid #B8893A; padding: 6px 10px; font-size: 10.5pt; margin-top: 4px; font-style: italic; }
  ol.questions { list-style: none; counter-reset: q; padding: 0; margin: 6px 0 0; }
  ol.questions li { counter-increment: q; display: grid; grid-template-columns: 26px 14px 1fr; gap: 6px; padding: 7px 0; border-bottom: 1px dashed #ccc; page-break-inside: avoid; }
  ol.questions li::before { content: counter(q) "."; font-weight: 600; color: #5C1A2E; }
  ol.questions .check { width: 11px; height: 11px; border: 1.2px solid #555; border-radius: 2px; margin-top: 3px; }
  ol.questions .qtext { font-size: 10.5pt; line-height: 1.4; }
  ol.questions .source { display: block; font-size: 8.5pt; color: #777; font-style: italic; margin-top: 2px; }
  .notes-lines { margin-top: 6px; }
  .notes-lines .line { border-bottom: 1px solid #888; height: 18px; }
  footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid #ccc; font-size: 8.5pt; color: #777; display: flex; justify-content: space-between; }
  @media print { .no-print { display: none !important; } }
</style>
</head>
<body>
<header>
  <div class="left">
    <span class="eyebrow">Forta Match · Belkaartje</span>
    <h1>Telefonische uitvraag</h1>
  </div>
  <div class="right">
    <div class="mono">${escapeHtml(c.ref_code)}</div>
    <div class="meta">Geprint ${escapeHtml(now)}</div>
  </div>
</header>

<h2>Cliënt &amp; verwijzer</h2>
<div class="grid2">
  <div><div class="label">Cliënt</div><div class="value">${escapeHtml(c.patient_initials || '—')}${c.patient_age ? ' · ' + c.patient_age + ' jr' : ''}</div></div>
  <div><div class="label">Telefoon</div><div class="value">${escapeHtml(fields.contact_phone || '—')}</div></div>
  <div><div class="label">Postcode / regio</div><div class="value">${escapeHtml(c.postcode || fields.postcode || '—')}</div></div>
  <div><div class="label">Verzekeraar</div><div class="value">${escapeHtml(c.insurer_name || fields.insurer_name || '—')}</div></div>
  <div><div class="label">Verwijzer (AGB)</div><div class="value">${escapeHtml(fields.agb_referrer || '—')}</div></div>
  <div><div class="label">Kanaal</div><div class="value">${escapeHtml(c.channel)}</div></div>
</div>

<h2>Klachtprofiel &amp; veiligheid</h2>
<div class="chips">
  ${klacht.length ? klacht.map(t => `<span class="chip">${escapeHtml(t.name)}</span>`).join('') : '<span class="chip muted">Geen klachtprofiel-tag</span>'}
  ${procedureel.length ? procedureel.map(t => `<span class="chip muted">${escapeHtml(t.name)}</span>`).join('') : ''}
</div>
<div class="chips" style="margin-top:6px;">
  ${veiligheidLabels}
</div>
${dec?.motivation ? `<div class="reason"><strong>Reden doorzetten:</strong> ${escapeHtml(dec.motivation)}</div>` : ''}
${fields.hulpvraag ? `<div style="margin-top:6px;font-size:10.5pt;"><strong>Hulpvraag:</strong> ${escapeHtml(fields.hulpvraag)}</div>` : ''}

<h2>Voorbereide vragen</h2>
${questions.length === 0
  ? '<p class="meta" style="margin-top:6px;">Geen vragen voorbereid voor deze case.</p>'
  : `<ol class="questions">${questions.map(q => `
    <li>
      <span></span>
      <span class="check"></span>
      <span class="qtext">${escapeHtml(q.text)}${q.source ? `<span class="source">${escapeHtml(q.source)}</span>` : ''}</span>
    </li>`).join('')}</ol>`}

<h2>Notities tijdens gesprek</h2>
<div class="notes-lines">
  ${'<div class="line"></div>'.repeat(8)}
</div>

<footer>
  <span>Forta Match · interne werkkopie · niet voor delen buiten Forta</span>
  <span>${escapeHtml(c.ref_code)}</span>
</footer>

<script>
  // Auto-open print dialog as soon as the page is rendered
  window.addEventListener('load', () => { setTimeout(() => window.print(), 200); });
<\/script>
</body>
</html>`;

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// ---------- Feedback ----------
app.post('/api/cases/:id/feedback/turn', async (req, res) => {
  const id = +req.params.id;
  const transcript = req.body?.transcript || [];
  const cs = db.prepare(`SELECT c.ref_code, c.patient_initials, c.patient_age FROM cases c WHERE c.id=?`).get(id);
  const lastMatch = db.prepare(`SELECT options_json, advice FROM match_runs WHERE case_id=? ORDER BY id DESC LIMIT 1`).get(id);
  const ctx = { case: cs, advice: lastMatch?.advice, top_options: lastMatch ? JSON.parse(lastMatch.options_json).filter(o=>!o.knockedOut).slice(0,3) : [] };
  const next = await feedbackTurn({ caseContext: ctx, transcript });
  res.json(next);
});

app.post('/api/cases/:id/feedback/save', async (req, res) => {
  const id = +req.params.id;
  const { actor_role = 'secretariaat', actor_name = 'Maria Boom', transcript = [] } = req.body || {};
  const cs = db.prepare(`SELECT c.ref_code FROM cases c WHERE c.id=?`).get(id);
  const lastMatch = db.prepare(`SELECT options_json, advice FROM match_runs WHERE case_id=? ORDER BY id DESC LIMIT 1`).get(id);
  const ctx = { case: cs, advice: lastMatch?.advice };
  const summary = await summarizeFeedback({ caseContext: ctx, transcript });
  const r = db.prepare(`INSERT INTO feedback_sessions (case_id, actor_role, actor_name, transcript_json, summary_json) VALUES (?, ?, ?, ?, ?)`)
    .run(id, actor_role, actor_name, JSON.stringify(transcript), JSON.stringify(summary));
  audit(actor_role, 'feedback.saved', 'case', id, summary);
  res.json({ id: r.lastInsertRowid, summary });
});

// ---------- Beheer: labels CRUD ----------
// Protected routes: require 'beheer' role when AUTH_MODE='enforce'
const adminAuth = AUTH_MODE === 'enforce' ? requireRole('beheer') : (req, res, next) => next();

app.get('/api/labels', adminAuth, (_, res) => {
  const labels = db.prepare(`SELECT * FROM labels ORDER BY name`).all();
  const tags = db.prepare(`SELECT lt.label_id, lt.role, t.name FROM label_tags lt JOIN tags t ON t.id = lt.tag_id`).all();
  const locs = db.prepare(`SELECT * FROM locations`).all();
  res.json(labels.map(l => ({
    ...l,
    tags: tags.filter(t => t.label_id === l.id),
    locations: locs.filter(loc => loc.label_id === l.id)
  })));
});

app.post('/api/labels', adminAuth, (req, res) => {
  const { code, name, description = '', age_min = 18, age_max = 75, treatment_form = 'beide', status = 'actief' } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'code & name verplicht' });
  const r = db.prepare(`INSERT INTO labels (code, name, description, age_min, age_max, treatment_form, status) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(code, name, description, age_min, age_max, treatment_form, status);
  audit('beheer','label.created','label', r.lastInsertRowid, { code, name });
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/labels/:id', adminAuth, (req, res) => {
  const id = +req.params.id;
  const { name, description, age_min, age_max, treatment_form, status } = req.body || {};
  db.prepare(`UPDATE labels SET name=COALESCE(?,name), description=COALESCE(?,description),
    age_min=COALESCE(?,age_min), age_max=COALESCE(?,age_max),
    treatment_form=COALESCE(?,treatment_form), status=COALESCE(?,status), updated_at=datetime('now') WHERE id=?`)
    .run(name ?? null, description ?? null, age_min ?? null, age_max ?? null, treatment_form ?? null, status ?? null, id);
  audit('beheer','label.updated','label', id, req.body);
  res.json({ ok: true });
});

// ---------- Beheer: tags CRUD ----------
app.get('/api/tags', adminAuth, (_, res) => {
  const rows = db.prepare(`SELECT * FROM tags ORDER BY category, name`).all();
  res.json(rows.map(r => ({ ...r, synonyms: JSON.parse(r.synonyms) })));
});

app.post('/api/tags', adminAuth, (req, res) => {
  const { name, category, synonyms = [], weight = 1, status = 'actief' } = req.body || {};
  if (!name || !category) return res.status(400).json({ error: 'name & category verplicht' });
  const r = db.prepare(`INSERT INTO tags (name, category, synonyms, weight, status) VALUES (?, ?, ?, ?, ?)`)
    .run(name, category, JSON.stringify(synonyms), weight, status);
  audit('beheer','tag.created','tag', r.lastInsertRowid, { name, category });
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/tags/:id', adminAuth, (req, res) => {
  const id = +req.params.id;
  const { name, category, synonyms, weight, status } = req.body || {};
  db.prepare(`UPDATE tags SET
    name=COALESCE(?,name), category=COALESCE(?,category),
    synonyms=COALESCE(?,synonyms), weight=COALESCE(?,weight), status=COALESCE(?,status),
    updated_at=datetime('now') WHERE id=?`)
    .run(name ?? null, category ?? null, synonyms ? JSON.stringify(synonyms) : null, weight ?? null, status ?? null, id);
  audit('beheer','tag.updated','tag', id, req.body);
  res.json({ ok: true });
});

app.delete('/api/tags/:id', adminAuth, (req, res) => {
  const id = +req.params.id;
  db.prepare(`DELETE FROM tags WHERE id=?`).run(id);
  audit('beheer','tag.deleted','tag', id, null);
  res.json({ ok: true });
});

// ---------- Beheer: business modus ----------
app.get('/api/modus', adminAuth, (_, res) => res.json({ modus: getSetting('business_modus', 'snelste_hulp') }));
app.put('/api/modus', adminAuth, (req, res) => {
  const { modus } = req.body || {};
  if (!['snelste_hulp','labelbalans','match_kwaliteit','custom'].includes(modus)) return res.status(400).json({ error: 'invalid modus' });
  setSetting('business_modus', modus);
  audit('beheer','modus.changed','setting','business_modus', { modus });
  res.json({ ok: true });
});

// Forta-voorkeur CRUD
app.get('/api/voorkeuren', adminAuth, (_, res) => {
  const rows = db.prepare(`
    SELECT fp.*, l.name AS label_name, loc.name AS location_name
    FROM forta_preferences fp
    JOIN labels l ON l.id = fp.label_id
    LEFT JOIN locations loc ON loc.id = fp.location_id
  `).all();
  res.json(rows);
});

app.post('/api/voorkeuren', adminAuth, (req, res) => {
  const { label_id, location_id = null, boost, reason = '', expires_at } = req.body || {};
  if (!label_id || !boost || !expires_at) return res.status(400).json({ error: 'label_id, boost, expires_at verplicht' });
  const days = Math.ceil((new Date(expires_at) - Date.now()) / (1000*60*60*24));
  if (days > 90) return res.status(400).json({ error: 'expires_at mag max 90 dagen in toekomst liggen' });
  const r = db.prepare(`INSERT INTO forta_preferences (label_id, location_id, boost, reason, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .run(label_id, location_id, boost, reason, expires_at);
  audit('beheer','voorkeur.created','voorkeur', r.lastInsertRowid, { label_id, boost, expires_at });
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/voorkeuren/:id', adminAuth, (req, res) => {
  const id = +req.params.id;
  db.prepare(`DELETE FROM forta_preferences WHERE id=?`).run(id);
  audit('beheer','voorkeur.deleted','voorkeur', id, null);
  res.json({ ok: true });
});

// ---------- Audit log ----------
app.get('/api/audit', adminAuth, (_, res) => {
  res.json(db.prepare(`SELECT * FROM audit_log ORDER BY id DESC LIMIT 200`).all());
});

// ---------- Dashboard ----------
app.get('/api/dashboard', adminAuth, (_, res) => {
  const counts = db.prepare(`SELECT status, COUNT(*) AS n FROM cases GROUP BY status`).all();
  const advice = db.prepare(`SELECT advice, COUNT(*) AS n FROM match_runs GROUP BY advice`).all();
  const feedback = db.prepare(`SELECT COUNT(*) AS n FROM feedback_sessions`).get();
  const overrides = db.prepare(`
    SELECT COUNT(*) AS n FROM decisions d
    LEFT JOIN match_runs m ON m.case_id = d.case_id
    WHERE m.advice = 'ja' AND d.outcome IN ('afwijzen','doorzetten_screenteam')
  `).get();
  res.json({ cases_by_status: counts, advice_distribution: advice, feedback_count: feedback?.n ?? 0, override_count: overrides?.n ?? 0 });
});

// ---------- Rules CRUD ----------
// Helper to get label_ids for a rule
function getRuleLabelIds(ruleId) {
  return db.prepare(`SELECT label_id FROM rule_labels WHERE rule_id = ?`).all(ruleId).map(r => r.label_id);
}

// Helper to update label_ids for a rule
function setRuleLabelIds(ruleId, labelIds) {
  db.prepare(`DELETE FROM rule_labels WHERE rule_id = ?`).run(ruleId);
  if (labelIds && labelIds.length > 0) {
    const insert = db.prepare(`INSERT INTO rule_labels (rule_id, label_id) VALUES (?, ?)`);
    for (const labelId of labelIds) {
      insert.run(ruleId, labelId);
    }
  }
}

app.get('/api/rules', adminAuth, (_, res) => {
  const rows = db.prepare(`SELECT * FROM rules WHERE archived_at IS NULL ORDER BY kind, sort_order, id`).all();
  // Load all rule_labels at once for efficiency
  const allRuleLabels = db.prepare(`SELECT rule_id, label_id FROM rule_labels`).all();
  const labelMap = {};
  for (const rl of allRuleLabels) {
    if (!labelMap[rl.rule_id]) labelMap[rl.rule_id] = [];
    labelMap[rl.rule_id].push(rl.label_id);
  }
  res.json(rows.map(r => ({
    ...r,
    label_ids: labelMap[r.id] || [],
    condition: JSON.parse(r.condition_json),
    action: JSON.parse(r.action_json)
  })));
});

app.get('/api/rules/:id', adminAuth, (req, res) => {
  const row = db.prepare(`SELECT * FROM rules WHERE id = ?`).get(+req.params.id);
  if (!row) return res.status(404).json({ error: 'Rule not found' });
  res.json({
    ...row,
    label_ids: getRuleLabelIds(row.id),
    condition: JSON.parse(row.condition_json),
    action: JSON.parse(row.action_json)
  });
});

app.post('/api/rules', adminAuth, (req, res) => {
  const { rule_id, name, description = '', kind, sort_order = 100, applies_to_mode = null, label_ids = [], condition, action, motivation = '' } = req.body || {};
  if (!rule_id || !name || !kind || !condition || !action) {
    return res.status(400).json({ error: 'rule_id, name, kind, condition, action are required' });
  }
  if (!['hard', 'soft', 'modus_modifier', 'voorkeur'].includes(kind)) {
    return res.status(400).json({ error: 'kind must be hard, soft, modus_modifier, or voorkeur' });
  }
  const r = db.prepare(`
    INSERT INTO rules (rule_id, name, description, kind, sort_order, applies_to_mode, condition_json, action_json, motivation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(rule_id, name, description, kind, sort_order, applies_to_mode, JSON.stringify(condition), JSON.stringify(action), motivation);

  // Set label associations
  if (label_ids && label_ids.length > 0) {
    setRuleLabelIds(r.lastInsertRowid, label_ids);
  }

  audit('beheer', 'rule.created', 'rule', r.lastInsertRowid, { rule_id, name, kind, label_ids });
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/rules/:id', adminAuth, (req, res) => {
  const id = +req.params.id;
  const existing = db.prepare(`SELECT * FROM rules WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: 'Rule not found' });

  const { name, description, kind, active, sort_order, applies_to_mode, condition, action, motivation } = req.body || {};

  db.prepare(`
    UPDATE rules SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      kind = COALESCE(?, kind),
      active = COALESCE(?, active),
      sort_order = COALESCE(?, sort_order),
      applies_to_mode = COALESCE(?, applies_to_mode),
      condition_json = COALESCE(?, condition_json),
      action_json = COALESCE(?, action_json),
      motivation = COALESCE(?, motivation),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name ?? null,
    description ?? null,
    kind ?? null,
    active ?? null,
    sort_order ?? null,
    applies_to_mode ?? null,
    condition ? JSON.stringify(condition) : null,
    action ? JSON.stringify(action) : null,
    motivation ?? null,
    id
  );

  // Update label associations if label_ids is provided
  if ('label_ids' in (req.body || {})) {
    setRuleLabelIds(id, req.body.label_ids || []);
  }

  audit('beheer', 'rule.updated', 'rule', id, req.body);
  res.json({ ok: true });
});

app.delete('/api/rules/:id', adminAuth, (req, res) => {
  const id = +req.params.id;
  // Soft delete by setting archived_at
  db.prepare(`UPDATE rules SET archived_at = datetime('now'), active = 0 WHERE id = ?`).run(id);
  audit('beheer', 'rule.archived', 'rule', id, null);
  res.json({ ok: true });
});

// Toggle rule active state
app.post('/api/rules/:id/toggle', adminAuth, (req, res) => {
  const id = +req.params.id;
  const row = db.prepare(`SELECT active FROM rules WHERE id = ?`).get(id);
  if (!row) return res.status(404).json({ error: 'Rule not found' });
  const newActive = row.active ? 0 : 1;
  db.prepare(`UPDATE rules SET active = ?, updated_at = datetime('now') WHERE id = ?`).run(newActive, id);
  audit('beheer', 'rule.toggled', 'rule', id, { active: newActive });
  res.json({ ok: true, active: newActive });
});

// ---------- Business Modes CRUD ----------
app.get('/api/business-modes', adminAuth, (_, res) => {
  const rows = db.prepare(`SELECT * FROM business_modes ORDER BY is_default DESC, id`).all();
  res.json(rows.map(r => ({
    ...r,
    weights: JSON.parse(r.weights_json),
    thresholds: JSON.parse(r.thresholds_json)
  })));
});

app.put('/api/business-modes/:id', adminAuth, (req, res) => {
  const id = req.params.id;
  const { name, description, weights, thresholds, is_default } = req.body || {};

  // If setting as default, unset others first
  if (is_default) {
    db.prepare(`UPDATE business_modes SET is_default = 0`).run();
  }

  db.prepare(`
    UPDATE business_modes SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      weights_json = COALESCE(?, weights_json),
      thresholds_json = COALESCE(?, thresholds_json),
      is_default = COALESCE(?, is_default),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name ?? null,
    description ?? null,
    weights ? JSON.stringify(weights) : null,
    thresholds ? JSON.stringify(thresholds) : null,
    is_default ?? null,
    id
  );
  audit('beheer', 'business_mode.updated', 'business_mode', id, req.body);
  res.json({ ok: true });
});

// ---------- Rule Simulation (test rules against sample data) ----------
app.post('/api/rules/simulate', adminAuth, async (req, res) => {
  const { text, extraction: providedExtraction } = req.body || {};

  let extraction = providedExtraction;
  if (!extraction && text) {
    // Run extraction on provided text
    const { extractReferral } = await import('./agents/extraction.js');
    extraction = await extractReferral(text);
  }

  if (!extraction) {
    return res.status(400).json({ error: 'Provide either text or extraction object' });
  }

  const { runMatching } = await import('./rules.js');
  const result = runMatching(extraction, { modus: req.body?.modus });

  res.json({
    extraction,
    modus: result.modus,
    advice: result.advice,
    options: result.options.slice(0, 10), // Top 10
    total_options: result.options.length,
    knocked_out: result.options.filter(o => o.knockedOut).length
  });
});

// ---------- Label-specific Rules ----------
// Get rules for a specific label (global + label-specific)
app.get('/api/labels/:id/rules', adminAuth, (req, res) => {
  const labelId = +req.params.id;
  const globalRules = db.prepare(`
    SELECT * FROM rules WHERE active = 1 AND archived_at IS NULL AND label_id IS NULL
    ORDER BY kind, sort_order, id
  `).all();
  const labelRules = db.prepare(`
    SELECT * FROM rules WHERE active = 1 AND archived_at IS NULL AND label_id = ?
    ORDER BY kind, sort_order, id
  `).all(labelId);

  res.json({
    global: globalRules.map(r => ({ ...r, condition: JSON.parse(r.condition_json), action: JSON.parse(r.action_json) })),
    labelSpecific: labelRules.map(r => ({ ...r, condition: JSON.parse(r.condition_json), action: JSON.parse(r.action_json) }))
  });
});

// ---------- Label Tag Weight Overrides ----------
// Get tag weights for a label
app.get('/api/labels/:id/tags', adminAuth, (req, res) => {
  const labelId = +req.params.id;
  const tags = db.prepare(`
    SELECT lt.*, t.name, t.category, t.weight AS default_weight,
           COALESCE(lt.weight_override, t.weight) AS effective_weight
    FROM label_tags lt
    JOIN tags t ON t.id = lt.tag_id
    WHERE lt.label_id = ?
    ORDER BY lt.role, t.name
  `).all(labelId);
  res.json(tags);
});

// Update tag weight override for a label
app.put('/api/labels/:labelId/tags/:tagId', adminAuth, (req, res) => {
  const labelId = +req.params.labelId;
  const tagId = +req.params.tagId;
  const { role, weight_override } = req.body || {};

  if (!role) {
    return res.status(400).json({ error: 'role is required' });
  }

  db.prepare(`
    UPDATE label_tags SET weight_override = ?
    WHERE label_id = ? AND tag_id = ? AND role = ?
  `).run(weight_override, labelId, tagId, role);

  audit('beheer', 'label_tag.weight_updated', 'label_tag', `${labelId}:${tagId}:${role}`, { weight_override });
  res.json({ ok: true });
});

// ---------- Label Scoring Configuration ----------
// Get label scoring config
app.get('/api/labels/:id/scoring', adminAuth, (req, res) => {
  const labelId = +req.params.id;
  const label = db.prepare(`SELECT scoring_config_json, extraction_hints FROM labels WHERE id = ?`).get(labelId);
  if (!label) return res.status(404).json({ error: 'Label not found' });

  res.json({
    scoring_config: label.scoring_config_json ? JSON.parse(label.scoring_config_json) : null,
    extraction_hints: label.extraction_hints
  });
});

// Update label scoring config
app.put('/api/labels/:id/scoring', adminAuth, (req, res) => {
  const labelId = +req.params.id;
  const { scoring_config, extraction_hints } = req.body || {};

  db.prepare(`
    UPDATE labels SET
      scoring_config_json = COALESCE(?, scoring_config_json),
      extraction_hints = COALESCE(?, extraction_hints),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    scoring_config ? JSON.stringify(scoring_config) : null,
    extraction_hints ?? null,
    labelId
  );

  audit('beheer', 'label.scoring_updated', 'label', labelId, { scoring_config, extraction_hints });
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Forta Match running on http://localhost:${port}  (mode: ${MOCK_MODE ? 'MOCK' : 'LIVE'})`);
});
