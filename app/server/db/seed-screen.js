// Seed a handful of cases that are waiting for the screenteam, so the
// /screen-list page is non-empty during demos.
import { db, audit } from './index.js';
import { runMatching } from '../rules.js';
import { runCompletenessCheck } from '../agents/completeness.js';

// Helper: ISO datetime N dagen geleden (UTC). Spreidt cases over urgentie-buckets
// ('vandaag', '>3 dagen', '>1 week') zodat filter-resultaten altijd zichtbaar zijn.
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const samples = [
  {
    ref_code: 'ZD-2026-810233', channel: 'zorgdomein',
    initials: 'M.V.', age: 34, postcode: '3511AB', insurer: 'CZ',
    daysAgo: 0,         // vandaag → urgentie "Vandaag binnen"
    forceAdvice: 'twijfel',
    text: `Verwijzing GGZ — Zorgdomein. Cliënt M.V., 34 jaar, postcode 3511AB Utrecht. Verzekeraar: CZ. AGB: 73732118.
Hulpvraag: cliënt meldt zich met aandachtsproblemen en concentratiestoornissen op werk. Vermoeden ADHD bij volwassene.
Klachten: somberheid, mild verhoogde spanning, sociale teruggetrokkenheid laatste maanden. Comorbiditeit angstklachten mogelijk.
Voorgeschiedenis: kortdurende coaching 2023, geen DSM-diagnose.
Geen psychose, geen suïcidaliteit, geen verslavingsproblematiek.
Vraag: diagnostiek ADHD, eventueel behandeltraject.
Getekend door huisarts.`,
    tags: [
      { name:'ADHD', category:'klachtprofiel', evidence:'Vermoeden ADHD' },
      { name:'angst', category:'klachtprofiel', evidence:'angstklachten mogelijk' },
      { name:'depressie', category:'klachtprofiel', evidence:'somberheid' },
      { name:'diagnostiek', category:'procedureel', evidence:'diagnostiek ADHD' },
      { name:'volwassenen', category:'doelgroep', evidence:'34 jaar' }
    ],
    reason: 'Meervoudige problematiek (ADHD + angst + somberheid) — secretariaat vraagt klinische beoordeling.',
    questions: [
      { text: 'Wat is op dit moment de klacht waar je zelf het meeste last van hebt — de aandachtsproblemen, de angst/paniekaanvallen, of de somberheid?', source: 'o.b.v. tags: ADHD + angst + somberheid', origin: 'generated',
        answer: 'De aandachtsproblemen zijn nu het zwaarst — vooral op werk loop ik vast. De angst en somberheid komen voor maar zijn op de achtergrond; het is de focus en planning die me echt belemmert.' },
      { text: 'Wanneer ben je voor het eerst tegen de aandachts- of concentratieproblemen aangelopen? Speelden die ook al op school?', source: 'DSM-criterium: ADHD vereist symptomen vóór 12 jr', origin: 'generated',
        answer: 'Op de middelbare school al — ik moest veel langer doen over huiswerk dan klasgenoten en raakte snel afgeleid. Toen werd er niets mee gedaan, het werd weggewuifd als "dromerig".' },
      { text: 'De therapeut bij wie je nu loopt — heeft die ADHD specifiek besproken, of kwam het naar aanleiding van iets anders ter sprake?', source: 'brief: "daar mogelijkheid van ADHD besproken"', origin: 'generated',
        answer: 'Het kwam ter sprake doordat ik vertelde over mijn werkproblemen en het patroon van niet afmaken. Mijn Gestalt-therapeut opperde toen dat het ADHD zou kunnen zijn. Geen formele beoordeling gedaan.' },
      { text: 'Hoe ervaar je je nieuwe baan op dit moment? Speelt de spanning vooral op het werk, of ook daarbuiten?', source: 'brief: "spanning/angst bij nieuwe baan"', origin: 'generated',
        answer: 'Voornamelijk op werk — veel deadlines en moet snel schakelen tussen taken. Thuis is het rustiger, maar dan pieker ik wel over wat ik niet af heb gekregen.' },
      { text: 'Heeft het ooit zo somber geweest dat je dacht het niet meer aan te kunnen? Wat hielp toen?', source: 'journaal: meerdere P03 episodes', origin: 'generated',
        answer: 'Een paar keer, vooral tijdens een burn-out vier jaar geleden. POH-GGZ-gesprekken en regelmatig wandelen hielpen toen. Geen actieve suïcidale gedachten gehad, op geen enkel moment.' },
      { text: 'Wat verwacht je zelf van een diagnostisch traject — duidelijkheid over wat er aan de hand is, of vooral een richting voor behandeling?', source: 'verwachtingsmanagement', origin: 'generated',
        answer: 'Vooral duidelijkheid. Als ik weet wat het is kan ik beter accepteren wat er speelt en gerichter ondersteuning zoeken. Behandeling komt voor mij daarna.' },
      { text: 'Heb je een voorkeur voor een mannelijke of vrouwelijke behandelaar?', source: 'eigen toevoeging', origin: 'user',
        answer: 'Geen sterke voorkeur — fijn als ze ervaring hebben met ADHD bij vrouwen, dat is voor mij het belangrijkste criterium.' }
    ]
  },
  {
    ref_code: 'ZV-2026-008844', channel: 'zivver',
    initials: 'P.B.', age: 41, postcode: '1012JS', insurer: 'VGZ',
    daysAgo: 2,         // recent, voor urgentie "Vandaag" (≤3 dagen)
    forceAdvice: 'twijfel',
    text: `Verwijsbrief — verstuurd via ZIVVER. P.B., 41 jaar, Amsterdam.
Hulpvraag: angst- en paniekklachten met somatische uitingen. Cliënt heeft langere tijd somberheid en interpersoonlijke moeilijkheden.
Voorgeschiedenis: psychotherapie in 2019 zonder vervolg. Borderline-trekken eerder benoemd door huisarts, maar niet vastgesteld.
Geen actieve psychose. Geen suïcidaliteit op moment van schrijven.
Vraag: behandeling angst en stemmingsklachten, mogelijk persoonlijkheidsdiagnostiek.`,
    tags: [
      { name:'angst', category:'klachtprofiel', evidence:'paniekklachten' },
      { name:'depressie', category:'klachtprofiel', evidence:'somberheid' },
      { name:'persoonlijkheidsproblematiek', category:'klachtprofiel', evidence:'borderline-trekken' },
      { name:'behandeling', category:'procedureel', evidence:'behandeling angst' },
      { name:'volwassenen', category:'doelgroep', evidence:'41 jaar' }
    ],
    reason: 'Persoonlijkheidsproblematiek vermoed naast angst — vraagt screenteam-beoordeling.',
    questions: [
      { text: 'Hoe vaak treden de paniekaanvallen op en in welke situaties komen ze het meest voor?', source: 'tag: angst/paniek', origin: 'generated',
        answer: 'Twee tot drie keer per week, vooral in sociale werksituaties en bij confrontaties. Soms ook \'s nachts.' },
      { text: 'De borderline-trekken werden eerder door je huisarts benoemd — herken je dat patroon zelf?', source: 'brief: borderline-trekken, niet vastgesteld', origin: 'generated',
        answer: 'Deels — de stemmingswisselingen en heftige reacties herken ik, maar ik twijfel of het echt past. Wil daar liever duidelijkheid over.' },
      { text: 'Wat ging er in 2019 mis dat de psychotherapie zonder vervolg bleef?', source: 'voorgeschiedenis incompleet', origin: 'generated',
        answer: 'De klik met de behandelaar was niet goed, en de therapie voelde alsof we vastliepen. Ben gestopt na vijf sessies.' },
      { text: 'Wat zou voor jou helpen om beter om te gaan met spanning op werk?', source: 'eigen toevoeging', origin: 'user',
        answer: null }
    ]
  },
  {
    ref_code: 'MB-2026-002319', channel: 'mailbox',
    initials: 'A.E.', age: 28, postcode: '2511CK', insurer: 'Menzis',
    daysAgo: 5,         // urgentie ">3 dagen"
    forceAdvice: 'twijfel',
    text: `Verwijzing huisarts. A.E., 28 jaar, Den Haag.
Cliënt vraagt hulp voor klachten van angst en stemmingsproblemen. Cliënt geeft aan dat eerdere behandelingen culturele factoren niet voldoende meewogen.
Hulpvraag is breed geformuleerd; concrete klachtenduur en ernst niet duidelijk uit brief af te leiden.
Geen psychose, geen suïcidaliteit. Geen verslaving.
Vraag aan Forta: behandeling, mogelijk diagnostiek.`,
    tags: [
      { name:'angst', category:'klachtprofiel', evidence:'angstklachten' },
      { name:'depressie', category:'klachtprofiel', evidence:'stemmingsproblemen' },
      { name:'behandeling', category:'procedureel', evidence:'behandeling' },
      { name:'volwassenen', category:'doelgroep', evidence:'28 jaar' }
    ],
    reason: 'Onduidelijke hulpvraag + interculturele context — telefonische uitvraag nodig.',
    questions: [
      { text: 'Hoe lang spelen de angst- en stemmingsklachten al, en is er een specifieke aanleiding?', source: 'klachtenduur niet duidelijk in brief', origin: 'generated',
        answer: 'Anderhalf jaar, sinds een ingrijpende familiekwestie waarbij ik tussen twee culturen kwam te staan.' },
      { text: 'Je gaf eerder aan dat culturele factoren onvoldoende werden meegewogen — kun je een voorbeeld noemen?', source: 'brief: culturele factoren niet meegewogen', origin: 'generated',
        answer: 'Mijn vorige therapeut zag mijn relatie met mijn ouders als ongezond, terwijl het in mijn cultuur juist normaal en gewenst is om dicht bij familie te blijven.' },
      { text: 'Wat zou voor jou belangrijk zijn in een behandelaar?', source: 'eigen toevoeging', origin: 'user',
        answer: 'Iemand die naar mijn achtergrond luistert en niet meteen oordeelt. Bilinguale begeleiding zou een plus zijn.' },
      { text: 'Heb je een voorkeur voor online of fysieke afspraken?', source: 'zorgtype-keuze', origin: 'generated',
        answer: null }
    ]
  },
  {
    ref_code: 'ZD-2026-810240', channel: 'zorgdomein',
    initials: 'L.B.', age: 29, postcode: '3811NV', insurer: 'Zilveren Kruis',
    daysAgo: 8,         // urgentie ">1 week"
    forceAdvice: 'nee', // rood
    text: `Verwijzing — L.B., 29 jaar, Amersfoort.
Hulpvraag: cliënt zoekt behandeling persoonlijkheidsproblematiek (cluster B-trekken volgens huisarts).
Comorbiditeit: alcoholgebruik, mogelijk overschrijdend. Cliënt drinkt gemiddeld 5-6 eenheden per dag.
Voorgeschiedenis: 2 eerdere behandeltrajecten zonder duurzaam effect.
Geen psychose. Geen acute suïcidaliteit, wel periodes van suïcidale gedachten in verleden.
Vraag: schemagerichte therapie of vergelijkbaar.`,
    tags: [
      { name:'persoonlijkheidsproblematiek', category:'klachtprofiel', evidence:'cluster B-trekken' },
      { name:'verslaving', category:'comorbiditeit', evidence:'alcoholgebruik 5-6 per dag' },
      { name:'behandeling', category:'procedureel', evidence:'schemagerichte therapie' },
      { name:'volwassenen', category:'doelgroep', evidence:'29 jaar' }
    ],
    reason: 'Persoonlijkheid + verslaving — combinatie vraagt klinische afweging vóór match.',
    questions: [
      { text: 'Hoeveel alcohol drink je gemiddeld per dag, en op welke momenten van de dag?', source: 'brief: 5-6 eenheden per dag', origin: 'generated',
        answer: 'Vijf tot zes glazen, vooral \'s avonds na werk om te ontspannen. In het weekend soms meer.' },
      { text: 'Heb je eerder hulp gezocht specifiek om te minderen of stoppen met drinken?', source: 'verslaving als comorbiditeit', origin: 'generated',
        answer: 'Niet specifiek voor de alcohol — wel voor de stemmingsklachten. Mijn vorige therapeut wees op het drinken maar ik vond toen niet dat het problematisch was.' },
      { text: 'De schemagerichte therapie waar je naar vraagt — wie heeft dat geadviseerd?', source: 'brief: schemagerichte therapie of vergelijkbaar', origin: 'generated',
        answer: 'Mijn vorige psycholoog gaf aan dat dit een passende vervolgstap zou zijn voor de cluster-B trekken.' },
      { text: 'Zijn er in het verleden periodes van actieve suïcidale gedachten of plannen geweest?', source: 'brief: periodes suïcidale gedachten in verleden', origin: 'generated',
        answer: 'In het verleden ja, vooral rond mijn dertigste. Geen concrete plannen, wel periodes van wanhoop. Het laatste jaar niet meer.' },
      { text: 'Hoe gemotiveerd ben je om aan de alcohol-comorbiditeit te werken naast de persoonlijkheidsproblematiek?', source: 'eigen toevoeging — combinatieperspectief', origin: 'user',
        answer: null }
    ]
  },
  {
    ref_code: 'MB-2026-002322', channel: 'mailbox',
    initials: 'F.D.', age: 58, postcode: '3011AA', insurer: 'CZ',
    daysAgo: 10,        // urgentie ">1 week"
    forceAdvice: 'nee', // rood — ziekenhuisverwijzing valt vaak af
    text: `Verwijzing neuroloog UMC. F.D., 58 jaar, Rotterdam.
Patiënt is recent in beeld geweest bij neurologie wegens cognitieve klachten. Geen organische verklaring gevonden.
Neuroloog vraagt of GGZ-traject psychogeen verklaringsmodel kan onderzoeken. Cliënt heeft eerder depressieve episode.
Geen psychose, geen suïcidaliteit.`,
    tags: [
      { name:'depressie', category:'klachtprofiel', evidence:'eerdere depressieve episode' },
      { name:'somatische comorbiditeit', category:'comorbiditeit', evidence:'cognitieve klachten' },
      { name:'volwassenen', category:'doelgroep', evidence:'58 jaar' }
    ],
    reason: 'Ziekenhuisverwijzing — onduidelijk of GGZ-vraag passend is. Conform FO is ~9 op 10 niet passend.',
    is_hospital_referral: true,
    forceKnockout: true,
    questions: [
      { text: 'Wat verwacht je zelf van een psychologische beoordeling — een verklaring voor de klachten of direct behandeling?', source: 'verwachtingsmanagement', origin: 'generated',
        answer: 'Vooral een verklaring — de neuroloog vond niets organisch, dus ik wil weten waar het wel vandaan komt.' },
      { text: 'Hoe lang ervaar je de cognitieve klachten al, en is er een aanleiding geweest?', source: 'brief: cognitieve klachten geen organische verklaring', origin: 'generated',
        answer: 'Ongeveer een half jaar. Begon na een drukke periode op werk, daarvoor functioneerde ik prima.' },
      { text: 'Was de eerdere depressieve episode lang geleden, en is die destijds behandeld?', source: 'brief: eerdere depressieve episode', origin: 'generated',
        answer: 'Acht jaar geleden, met medicatie (SSRI) en gesprekken. Daarna stabiel tot nu.' },
      { text: 'Heb je twijfels over een GGZ-traject ten opzichte van bijvoorbeeld een geheugenpolikliniek?', source: 'eigen toevoeging — passendheid GGZ', origin: 'user',
        answer: null }
    ]
  }
];

// Idempotent: remove previous demo screenteam-cases (safe to identify by ref_code prefix)
const existing = db.prepare(`SELECT id FROM cases WHERE ref_code IN (${samples.map(()=>'?').join(',')})`).all(...samples.map(s=>s.ref_code));
const insertCase = db.prepare(`INSERT INTO cases (ref_code, channel, patient_initials, patient_age, postcode, insurer_name, raw_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'wacht_screenteam', ?, ?)`);
const insertExtraction = db.prepare(`INSERT INTO case_extractions (case_id, fields_json, tags_json, llm_confidence) VALUES (?, ?, ?, 0.6)`);
const insertCompleteness = db.prepare(`INSERT INTO completeness_results (case_id, items_json, is_complete, summary_text) VALUES (?, ?, 1, NULL)`);
const insertKnockout = db.prepare(`INSERT INTO knockout_results (case_id, triggered, criterion, reasoning) VALUES (?, ?, ?, ?)`);
const insertMatch = db.prepare(`INSERT INTO match_runs (case_id, modus, options_json, advice) VALUES (?, 'snelste_hulp', ?, ?)`);
const insertDecision = db.prepare(`INSERT INTO decisions (case_id, actor_role, actor_name, outcome, motivation) VALUES (?, 'secretariaat', 'Maria Boom', 'doorzetten_screenteam', ?)`);
const insertQuestion = db.prepare(`INSERT INTO case_questions (case_id, position, text, source, answer, origin) VALUES (?, ?, ?, ?, ?, ?)`);
const deleteCase = db.prepare(`DELETE FROM cases WHERE id = ?`);

db.transaction(() => {
  for (const e of existing) deleteCase.run(e.id);

  for (const s of samples) {
    const ts = daysAgo(s.daysAgo ?? 0);
    const r = insertCase.run(s.ref_code, s.channel, s.initials, s.age, s.postcode, s.insurer, s.text, ts, ts);
    const id = r.lastInsertRowid;

    const fields = {
      patient_initials: s.initials, patient_age: s.age, postcode: s.postcode,
      insurer_name: s.insurer, agb_referrer: '94001234', letter_date: new Date().toISOString().slice(0,10),
      signature_present: true,
      hulpvraag: s.text.split('Hulpvraag:')[1]?.split('\n')[0]?.trim().slice(0, 200) || s.text.slice(0, 200),
      dsm_suspicion: s.tags.find(t => t.category === 'klachtprofiel')?.name || '',
      contact_phone: '06-12345678', contact_email: '',
      is_hospital_referral: !!s.is_hospital_referral, tags: s.tags, llm_confidence: 0.6
    };
    insertExtraction.run(id, JSON.stringify(fields), JSON.stringify(s.tags));

    const items = [
      { field: 'patient_initials', label:'Naam + BSN cliënt', status:'ok', message:'Aanwezig' },
      { field: 'agb_referrer', label:'AGB-code verwijzer', status:'ok', message:'Aanwezig' },
      { field: 'letter_date', label:'Datum verwijsbrief', status:'ok', message:'Geldig' },
      { field: 'signature_present', label:'Handtekening arts', status:'ok', message:'Aanwezig' },
      { field: 'dsm_suspicion', label:'Vermoedelijke DSM-5', status:'ok', message:fields.dsm_suspicion },
      { field: 'postcode', label:'Locatievoorkeur cliënt', status:'ok', message:s.postcode },
      { field: 'hulpvraag', label:'Hulpvraag', status:'ok', message:'Voldoende lengte' },
      { field: 'contact_phone', label:'Contactgegevens', status:'ok', message:'Aanwezig' }
    ];
    insertCompleteness.run(id, JSON.stringify(items));
    if (s.forceKnockout) {
      insertKnockout.run(id, 1, 'buiten_kader', 'Ziekenhuiscontext — primaire vraag mogelijk somatisch / buiten Forta-kader.');
    } else {
      insertKnockout.run(id, 0, null, 'Geen hard criterium getriggerd, maar complexiteit aanwezig.');
    }

    const matchResult = runMatching(fields);
    // forceAdvice laat een case bewust in een specifieke filter-bucket vallen
    const advice = s.forceAdvice || (matchResult.advice === 'ja' ? 'twijfel' : matchResult.advice);
    insertMatch.run(id, JSON.stringify(matchResult.options), advice);

    insertDecision.run(id, s.reason);

    if (s.questions) {
      s.questions.forEach((q, i) => insertQuestion.run(id, i + 1, q.text, q.source || '', q.answer || null, q.origin || 'generated'));
    }

    audit('secretariaat','case.doorzetten_screenteam','case', id, { reason: s.reason });
  }
})();

console.log(`Seed-screen done — ${samples.length} cases waiting for screenteam.`);
