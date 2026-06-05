import { db, setSetting } from './index.js';

console.log('Seeding Forta Match…');

// Wipe (idempotent reseed) — seed-relevant tables + demo cases.
// Foreign keys are disabled during the wipe so the delete order can't trigger
// constraint failures when the database already contains related rows.
const tables = ['forta_preferences','insurer_contracts','insurers','label_tags','locations','labels','tags',
                'case_questions','feedback_sessions','decisions','match_runs','knockout_results','completeness_results','case_extractions','cases'];
db.pragma('foreign_keys = OFF');
db.transaction(() => {
  for (const t of tables) db.prepare(`DELETE FROM ${t}`).run();
})();
db.pragma('foreign_keys = ON');

const insertTag = db.prepare('INSERT INTO tags (name, category, synonyms, weight) VALUES (?, ?, ?, ?)');
const tagIds = {};
const tags = [
  // doelgroep
  ['volwassenen','doelgroep',['18+','adult'],1],
  ['jongvolwassenen','doelgroep',['18-30','young adult'],1],
  ['ouderen','doelgroep',['65+'],1],
  // klachtprofiel
  ['ADHD','klachtprofiel',['AD/HD','ADD','aandachtstekortstoornis'],1],
  ['autisme','klachtprofiel',['ASS','autismespectrum','PDD-NOS'],1],
  ['angst','klachtprofiel',['paniekstoornis','sociale angst','GAS'],1],
  ['depressie','klachtprofiel',['stemmingsklachten','somberheid','dysthymie'],1],
  ['trauma','klachtprofiel',['PTSS','trauma-gerelateerd'],1],
  ['persoonlijkheidsproblematiek','klachtprofiel',['borderline','BPS'],1],
  ['eetstoornis','klachtprofiel',['anorexia','boulimia','binge eating'],1],
  // comorbiditeit
  ['verslaving','comorbiditeit',['middelenmisbruik','alcohol','drugs'],1],
  ['somatische comorbiditeit','comorbiditeit',['lichamelijke klachten'],1],
  // procedureel
  ['diagnostiek','procedureel',['onderzoek','assessment'],1],
  ['behandeling','procedureel',['therapie','traject'],1],
  // exclusie
  ['actieve psychose','exclusie',['psychotisch','wanen'],1],
  ['acute suïcidaliteit','exclusie',['suïcidegevaar','suïcidaal acuut'],1],
  ['forensisch','exclusie',['forensisch profiel','justitieel'],1],
  ['primair somatisch','exclusie',['hoofdklacht somatisch'],1],
  // zorgtype
  ['online','zorgtype',['beeldbellen','digitaal'],1],
  ['groep','zorgtype',['groepstherapie'],1],
  ['individueel','zorgtype',['individuele therapie'],1],
  // locatie tags worden niet gebruikt (locatie zit in locations)
];
for (const [name, cat, syn, w] of tags) {
  const info = insertTag.run(name, cat, JSON.stringify(syn), w);
  tagIds[name] = info.lastInsertRowid;
}

const insertLabel = db.prepare(`INSERT INTO labels
  (code, name, description, age_min, age_max, treatment_form, kind, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'actief')`);
const insertLoc = db.prepare(`INSERT INTO locations
  (label_id, name, postcode, address, agb_org, is_online, capacity_per_month, current_load_pct, wachttijd_dagen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insertLabelTag = db.prepare('INSERT INTO label_tags (label_id, tag_id, role) VALUES (?, ?, ?)');

const insertLabelWithStatus = db.prepare(`INSERT INTO labels
  (code, name, description, age_min, age_max, treatment_form, kind, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

function makeLabel({ code, name, description, ageRange = [18,75], form = 'beide', kind = 'forta', status = 'actief', incl_req = [], incl_des = [], excl_h = [], excl_s = [], doelgroep = ['volwassenen'], locations = [] }) {
  const info = (status === 'actief'
    ? insertLabel.run(code, name, description, ageRange[0], ageRange[1], form, kind)
    : insertLabelWithStatus.run(code, name, description, ageRange[0], ageRange[1], form, kind, status));
  const labelId = info.lastInsertRowid;
  for (const t of incl_req) insertLabelTag.run(labelId, tagIds[t], 'incl_required');
  for (const t of incl_des) insertLabelTag.run(labelId, tagIds[t], 'incl_desired');
  for (const t of excl_h)   insertLabelTag.run(labelId, tagIds[t], 'excl_hard');
  for (const t of excl_s)   insertLabelTag.run(labelId, tagIds[t], 'excl_soft');
  for (const t of doelgroep) insertLabelTag.run(labelId, tagIds[t], 'doelgroep');
  for (const loc of locations) insertLoc.run(labelId, loc.name, loc.postcode ?? null, loc.address ?? null, loc.agb ?? null, loc.online ? 1 : 0, loc.cap ?? 30, loc.load ?? 70, loc.wacht ?? 56);
  return labelId;
}

const labels = [];
labels.push(makeLabel({
  code: 'ADHD-DIAG-VOL',
  name: 'ADHD diagnostiek volwassenen',
  description: 'Diagnostisch traject ADHD bij volwassenen, 2 sessies.',
  form: 'diagnostiek',
  incl_req: ['ADHD','diagnostiek'],
  incl_des: ['jongvolwassenen'],
  excl_h:   ['actieve psychose','forensisch'],
  excl_s:   ['verslaving'],
  locations: [
    { name: 'Utrecht',   postcode: '3511AB', address: 'Voorstraat 1, Utrecht', agb: '94001234', cap: 40, load: 65, wacht: 49 },
    { name: 'Amsterdam', postcode: '1012JS', address: 'Damrak 50, Amsterdam',  agb: '94001235', cap: 35, load: 80, wacht: 84 },
    { name: 'Online',    online: true, cap: 50, load: 60, wacht: 21 }
  ]
}));

labels.push(makeLabel({
  code: 'ADHD-BEH-VOL',
  name: 'ADHD behandeling volwassenen',
  description: 'CGT + medicatie-begeleiding ADHD volwassenen.',
  form: 'behandeling',
  incl_req: ['ADHD','behandeling'],
  excl_h:   ['actieve psychose'],
  excl_s:   ['verslaving'],
  locations: [
    { name: 'Utrecht', postcode: '3511AB', cap: 30, load: 75, wacht: 70 },
    { name: 'Online',  online: true, cap: 40, load: 55, wacht: 28 }
  ]
}));

labels.push(makeLabel({
  code: 'ANGST-DEP',
  name: 'Angst & depressie',
  description: 'Behandeling stemmings- en angstklachten.',
  form: 'behandeling',
  incl_req: ['behandeling'],
  incl_des: ['angst','depressie'],
  excl_h:   ['actieve psychose','acute suïcidaliteit','forensisch'],
  excl_s:   ['eetstoornis'],
  locations: [
    { name: 'Utrecht',   postcode: '3511AB', cap: 50, load: 70, wacht: 35 },
    { name: 'Rotterdam', postcode: '3011AA', cap: 40, load: 90, wacht: 98 },
    { name: 'Online',    online: true, cap: 60, load: 50, wacht: 14 }
  ]
}));

labels.push(makeLabel({
  code: 'TRAUMA-EMDR',
  name: 'Trauma & EMDR',
  description: 'EMDR-behandeling voor enkelvoudig en complex trauma.',
  form: 'behandeling',
  incl_req: ['trauma','behandeling'],
  excl_h:   ['actieve psychose','acute suïcidaliteit'],
  excl_s:   ['verslaving','persoonlijkheidsproblematiek'],
  locations: [
    { name: 'Utrecht',   postcode: '3511AB', cap: 25, load: 88, wacht: 91 },
    { name: 'Eindhoven', postcode: '5611AA', cap: 25, load: 60, wacht: 42 }
  ]
}));

labels.push(makeLabel({
  code: 'AUTISME-DIAG',
  name: 'Autisme diagnostiek volwassenen',
  description: 'Diagnostiek autismespectrum bij volwassenen.',
  form: 'diagnostiek',
  incl_req: ['autisme','diagnostiek'],
  excl_h:   ['actieve psychose'],
  locations: [
    { name: 'Utrecht', postcode: '3511AB', cap: 20, load: 72, wacht: 84 }
  ]
}));

labels.push(makeLabel({
  code: 'PERS-BEH',
  name: 'Persoonlijkheid behandeling',
  description: 'Schemagerichte therapie persoonlijkheidsproblematiek.',
  form: 'behandeling',
  incl_req: ['persoonlijkheidsproblematiek','behandeling'],
  excl_h:   ['actieve psychose','acute suïcidaliteit','forensisch'],
  excl_s:   ['verslaving'],
  locations: [
    { name: 'Utrecht', postcode: '3511AB', cap: 20, load: 85, wacht: 105 }
  ]
}));

labels.push(makeLabel({
  code: 'EETSTOORNIS-VOL',
  name: 'Eetstoornis behandeling volwassenen',
  description: 'Multidisciplinair traject anorexia, boulimia, BED.',
  form: 'behandeling',
  status: 'inactief',
  incl_req: ['eetstoornis','behandeling'],
  excl_h:   ['actieve psychose','acute suïcidaliteit'],
  excl_s:   ['verslaving'],
  locations: [
    { name: 'Utrecht', postcode: '3511AB', cap: 15, load: 95, wacht: 140 }
  ]
}));

labels.push(makeLabel({
  code: 'JEUGD-DIAG',
  name: 'Jeugd diagnostiek (pre-FO)',
  description: 'Pilot-label dat vóór de scope-keuze volwassenen is opgesteld. Bewaard voor referentie.',
  form: 'diagnostiek',
  status: 'archief',
  ageRange: [12, 18],
  incl_req: ['diagnostiek'],
  doelgroep: ['jongvolwassenen'],
  locations: [
    { name: 'Utrecht', postcode: '3511AB', cap: 10, load: 0, wacht: 0 }
  ]
}));

// ---------- Sociaal domein — alternatieve trajecten buiten Forta/Zvw ----------
// Deze labels hebben geen verzekeraarscontracten; rules-engine slaat plafond over.
const sociaalLabels = [];

sociaalLabels.push(makeLabel({
  code: 'POH-GGZ',
  name: 'POH-GGZ huisartsenpraktijk',
  description: 'Kortdurende gesprekken bij milde klachten via Praktijkondersteuner GGZ.',
  form: 'behandeling',
  kind: 'sociaal_domein',
  incl_des: ['angst','depressie'],
  excl_h:   ['actieve psychose','acute suïcidaliteit'],
  locations: [
    { name: 'Huisartsenpost regio Utrecht', postcode: '3511AB', cap: 60, load: 55, wacht: 14 },
    { name: 'Huisartsenpost regio Amsterdam', postcode: '1012JS', cap: 50, load: 70, wacht: 21 },
    { name: 'Online intake POH-GGZ', online: true, cap: 80, load: 45, wacht: 7 }
  ]
}));

sociaalLabels.push(makeLabel({
  code: 'WMO-BUURT',
  name: 'Buurtteam / WMO welzijn',
  description: 'Ondersteuning bij levensvragen, eenzaamheid, schulden, mantelzorg.',
  form: 'behandeling',
  kind: 'sociaal_domein',
  incl_des: ['depressie'],
  excl_h:   ['actieve psychose','acute suïcidaliteit','forensisch'],
  locations: [
    { name: 'Buurtteam Utrecht-Centrum', postcode: '3511AB', cap: 40, load: 60, wacht: 10 },
    { name: 'Buurtteam Rotterdam-Noord', postcode: '3011AA', cap: 35, load: 65, wacht: 14 }
  ]
}));

sociaalLabels.push(makeLabel({
  code: 'MZ-COACH',
  name: 'Maatschappelijk werk',
  description: 'Korte trajecten rond werk, relaties, financiën, life-events.',
  form: 'behandeling',
  kind: 'sociaal_domein',
  incl_des: ['angst','depressie'],
  excl_h:   ['actieve psychose','acute suïcidaliteit'],
  locations: [
    { name: 'AMW Utrecht', postcode: '3511AB', cap: 30, load: 70, wacht: 28 },
    { name: 'AMW Online', online: true, cap: 50, load: 50, wacht: 5 }
  ]
}));

// Insurers + contracts (alleen voor Forta-labels — sociaal domein wordt niet via Zvw vergoed)
const insertIns = db.prepare('INSERT INTO insurers (name) VALUES (?)');
const insurerIds = {};
for (const n of ['Zilveren Kruis','VGZ','CZ','Menzis','DSW']) insurerIds[n] = insertIns.run(n).lastInsertRowid;

const insertContract = db.prepare(`INSERT INTO insurer_contracts
  (insurer_id, label_id, has_contract, plafond_max, plafond_used) VALUES (?, ?, ?, ?, ?)`);
for (const lid of labels) {
  insertContract.run(insurerIds['Zilveren Kruis'], lid, 1, 200, 145);
  insertContract.run(insurerIds['VGZ'],            lid, 1, 180, 162); // ~90% benut
  insertContract.run(insurerIds['CZ'],             lid, 1, 150, 60);
  insertContract.run(insurerIds['Menzis'],         lid, 1, 100, 40);
  insertContract.run(insurerIds['DSW'],            lid, 0, null, 0);  // geen contract
}

// One active Forta-voorkeur (90 dagen vooruit)
const utrechtAdhdLoc = db.prepare(`SELECT id FROM locations WHERE label_id = ? AND name = 'Utrecht'`).get(labels[1]);
if (utrechtAdhdLoc) {
  const exp = new Date(); exp.setDate(exp.getDate() + 60);
  db.prepare(`INSERT INTO forta_preferences (label_id, location_id, boost, reason, expires_at)
              VALUES (?, ?, ?, ?, ?)`).run(labels[1], utrechtAdhdLoc.id, 5, 'Onderbezetting Utrecht — opstart-boost', exp.toISOString().slice(0,10));
}

// Default modus
setSetting('business_modus', 'snelste_hulp');

console.log(`Done. Forta-labels: ${labels.length}, sociaal-domein-labels: ${sociaalLabels.length}, tags: ${Object.keys(tagIds).length}.`);

// Chain demo cases so één `npm run reset` ook werklijst + screenteam vult
await import('./seed-screen.js');
await import('./seed-werklijst.js');
