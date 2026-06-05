// Seed: business_modes + rules (JSON-DSL)
// Idempotent: gebruikt INSERT OR REPLACE / OR IGNORE zodat herhaalde runs OK zijn.
// Reproduceert exact het gedrag van de oude hardcoded rules.js zodat scores
// gelijk blijven (parity-check).
import { db } from './index.js';

console.log('Seeding rules + business_modes…');

// ============ business_modes ============
const modes = [
  { id: 'snelste_hulp',     name: 'Snelste hulp',
    description: 'Cliënt zo snel mogelijk geholpen',
    weights:    { relevance: 1.0, criteria: 1.0, wachttijd: 1.5, reistijd: 1.0, plafond: 1.0, balans: 0,   voorkeur: 1.0 },
    thresholds: { ja_drempel: 18, twijfel_drempel: 6 },
    is_default: 1 },
  { id: 'labelbalans',      name: 'Labelbalans',
    description: 'Onderbezette labels krijgen voorkeur',
    weights:    { relevance: 1.0, criteria: 1.0, wachttijd: 1.0, reistijd: 1.0, plafond: 1.0, balans: 1.0, voorkeur: 1.0 },
    thresholds: { ja_drempel: 18, twijfel_drempel: 6 } },
  { id: 'match_kwaliteit',  name: 'Match-kwaliteit',
    description: 'Best inhoudelijke match telt zwaarst',
    weights:    { relevance: 1.5, criteria: 1.5, wachttijd: 0.2, reistijd: 0.5, plafond: 0.5, balans: 0,   voorkeur: 1.0 },
    thresholds: { ja_drempel: 18, twijfel_drempel: 6 } },
  { id: 'custom',           name: 'Custom',
    description: 'Vrij configureerbare modus',
    weights:    { relevance: 1.0, criteria: 1.0, wachttijd: 1.0, reistijd: 1.0, plafond: 1.0, balans: 0,   voorkeur: 1.0 },
    thresholds: { ja_drempel: 18, twijfel_drempel: 6 } }
];

const upsertMode = db.prepare(`
  INSERT INTO business_modes (id, name, description, weights_json, thresholds_json, is_default)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    weights_json = excluded.weights_json,
    thresholds_json = excluded.thresholds_json,
    is_default = excluded.is_default,
    updated_at = datetime('now')
`);
for (const m of modes) {
  upsertMode.run(m.id, m.name, m.description, JSON.stringify(m.weights), JSON.stringify(m.thresholds), m.is_default || 0);
}

// ============ rules ============
// Reproduceert de oude server/rules.js exact:
//   Knockouts: leeftijd-mismatch, hard exclusion, missing required, plafond overschreden
//   Soft:      incl_required +8, incl_desired +5, doelgroep +3, excl_soft -3,
//              wachttijd <12wk +3 / >16wk -3,
//              reistijd <30m +3 / 30-60m -3 / >60m -5,
//              plafond 80-99% benut -3 / >=100% -8,
//              online → neutraal (geen reistijd-tag)
//   Modus-modifier: labelbalans → bezetting <60% +4

const rules = [
  // -------- Hard rules --------
  {
    rule_id: 'rule_age_min',
    name: 'Leeftijd onder doelgroep-min',
    kind: 'hard',
    sort_order: 10,
    condition: {
      type: 'and',
      conditions: [
        { type: 'fact_compare', fact: 'label.leeftijd_min', op: 'neq', value: null },
        { type: 'fact_compare', fact: 'client.leeftijd', op: 'gt', value: 0 },
        { type: 'fact_compare', fact: 'client.leeftijd', op: 'lt', value: { from_label_field: 'leeftijd_min' } }
      ]
    },
    action: { type: 'knockout', motivation_template: 'Leeftijd {{client.leeftijd}} < min {{label.leeftijd_min}}' },
    motivation: 'Onder leeftijdsgrens'
  },
  {
    rule_id: 'rule_age_max',
    name: 'Leeftijd boven doelgroep-max',
    kind: 'hard',
    sort_order: 11,
    condition: {
      type: 'and',
      conditions: [
        { type: 'fact_compare', fact: 'label.leeftijd_max', op: 'neq', value: null },
        { type: 'fact_compare', fact: 'client.leeftijd', op: 'gt', value: 0 },
        { type: 'fact_compare', fact: 'client.leeftijd', op: 'gt', value: { from_label_field: 'leeftijd_max' } }
      ]
    },
    action: { type: 'knockout', motivation_template: 'Leeftijd {{client.leeftijd}} > max {{label.leeftijd_max}}' },
    motivation: 'Boven leeftijdsgrens'
  },
  {
    rule_id: 'rule_hard_exclusion',
    name: 'Harde exclusietag aanwezig',
    kind: 'hard',
    sort_order: 20,
    condition: {
      type: 'tag_intersect',
      referral_tags: 'all_extracted',
      label_field: 'excl_hard',
      min_overlap: 1
    },
    action: { type: 'knockout', motivation_template: 'Hard exclusie: {{tag.name}}' },
    motivation: 'Harde exclusie geraakt'
  },
  {
    rule_id: 'rule_required_missing',
    name: 'Verplichte inclusietag ontbreekt',
    kind: 'hard',
    sort_order: 30,
    condition: {
      type: 'tag_intersect',
      referral_tags: 'all_extracted',
      label_field: 'incl_required',
      min_overlap: 'all',
      negate: true
    },
    action: { type: 'knockout', motivation_template: 'Verplichte inclusietag(s) ontbreken' },
    motivation: 'Required tags niet allemaal aanwezig'
  },
  {
    rule_id: 'rule_plafond_exceeded',
    name: 'Plafond bij verzekeraar overschreden',
    kind: 'hard',
    sort_order: 40,
    condition: {
      type: 'and',
      conditions: [
        { type: 'fact_compare', fact: 'label.kind', op: 'neq', value: 'sociaal_domein' },
        { type: 'computed', compute: 'plafond_pct_benut', args: {},
          thresholds: [ { if: 'result >= 1', delta: 0, tag: '' } ] }
      ]
    },
    action: { type: 'knockout', motivation_template: 'Plafond {{client.insurer_name}} bereikt' },
    motivation: 'Plafond bereikt'
  },

  // -------- Soft rules (per_occurrence over tags) --------
  {
    rule_id: 'rule_incl_required_score',
    name: 'Verplichte inclusietag-score',
    kind: 'soft',
    sort_order: 100,
    condition: {
      type: 'tag_intersect',
      referral_tags: 'all_extracted',
      label_field: 'incl_required',
      min_overlap: 1
    },
    action: {
      type: 'score_delta', delta: 8, per_occurrence: true, dim: 'relevance',
      score_tag_template: '{{tag.name}} +{{delta}}', score_tag_type: 'positive'
    }
  },
  {
    rule_id: 'rule_incl_desired_score',
    name: 'Gewenste inclusietag-score',
    kind: 'soft',
    sort_order: 110,
    condition: {
      type: 'tag_intersect',
      referral_tags: 'all_extracted',
      label_field: 'incl_desired',
      min_overlap: 1
    },
    action: {
      type: 'score_delta', delta: 5, per_occurrence: true, dim: 'relevance',
      score_tag_template: '{{tag.name}} +{{delta}}', score_tag_type: 'positive'
    }
  },
  {
    rule_id: 'rule_doelgroep_score',
    name: 'Doelgroep-match score',
    kind: 'soft',
    sort_order: 120,
    condition: {
      type: 'tag_intersect',
      referral_tags: 'all_extracted',
      label_field: 'doelgroep',
      min_overlap: 1
    },
    action: {
      type: 'score_delta', delta: 3, per_occurrence: true, dim: 'relevance',
      score_tag_template: '{{tag.name}} +{{delta}}', score_tag_type: 'positive'
    }
  },
  {
    rule_id: 'rule_excl_soft',
    name: 'Zachte exclusietag (comorbiditeit) — penalty',
    kind: 'soft',
    sort_order: 200,
    condition: {
      type: 'tag_intersect',
      referral_tags: 'all_extracted',
      label_field: 'excl_soft',
      min_overlap: 1
    },
    action: {
      type: 'score_delta', delta: -3, per_occurrence: true, dim: 'criteria',
      score_tag_template: 'Comorbiditeit {{tag.name}} {{delta}}', score_tag_type: 'negative'
    }
  },
  {
    rule_id: 'rule_wachttijd_kort',
    name: 'Wachttijd korter dan 12 weken',
    kind: 'soft',
    sort_order: 300,
    condition: {
      type: 'and',
      conditions: [
        { type: 'fact_compare', fact: 'label.wachttijd_dagen', op: 'neq', value: null },
        { type: 'fact_compare', fact: 'label.wachttijd_dagen', op: 'lt', value: 84 }
      ]
    },
    action: {
      type: 'score_delta', delta: 3, dim: 'wachttijd',
      score_tag_template: 'Wachttijd <12 wkn +{{delta}}', score_tag_type: 'positive'
    }
  },
  {
    rule_id: 'rule_wachttijd_lang',
    name: 'Wachttijd langer dan 16 weken',
    kind: 'soft',
    sort_order: 310,
    condition: {
      type: 'and',
      conditions: [
        { type: 'fact_compare', fact: 'label.wachttijd_dagen', op: 'neq', value: null },
        { type: 'fact_compare', fact: 'label.wachttijd_dagen', op: 'gt', value: 112 }
      ]
    },
    action: {
      type: 'score_delta', delta: -3, dim: 'wachttijd',
      score_tag_template: 'Wachttijd >16 wkn {{delta}}', score_tag_type: 'negative'
    }
  },
  {
    rule_id: 'rule_reistijd',
    name: 'Reistijd buckets (<30 / 30-60 / >60)',
    kind: 'soft',
    sort_order: 400,
    condition: {
      type: 'computed', compute: 'travel_time_minutes', args: {},
      thresholds: [
        { if: 'result < 30',  delta: 3,  tag: 'Reistijd <30 min +{{delta}}',  type: 'positive' },
        { if: 'result > 30 and result <= 60', delta: -3, tag: 'Reistijd >30 min {{delta}}', type: 'negative' },
        { if: 'result > 60', delta: -5, tag: 'Reistijd >60 min {{delta}}', type: 'negative' }
      ]
    },
    action: { type: 'score_delta', delta: 0, dim: 'reistijd' }
  },
  {
    rule_id: 'rule_plafond_warning',
    name: 'Plafond verzekeraar bijna of volledig benut',
    kind: 'soft',
    sort_order: 500,
    condition: {
      type: 'computed', compute: 'plafond_pct_benut', args: {},
      thresholds: [
        { if: 'result >= 0.8 and result < 1', delta: -3, tag: 'Plafond {{client.insurer_name}} bijna bereikt {{delta}}', type: 'warning' }
      ]
    },
    action: { type: 'score_delta', delta: 0, dim: 'plafond' }
  },

  // -------- Modus-modifier --------
  {
    rule_id: 'rule_labelbalans_bonus',
    name: 'Labelbalans-modus: bonus voor lage bezetting',
    kind: 'modus_modifier',
    sort_order: 600,
    applies_to_mode: 'labelbalans',
    condition: {
      type: 'computed', compute: 'bezetting_pct', args: {},
      thresholds: [ { if: 'result < 0.6', delta: 4, tag: 'Onderbezet +{{delta}}', type: 'positive' } ]
    },
    action: { type: 'score_delta', delta: 0, dim: 'balans' }
  }
];

const upsertRule = db.prepare(`
  INSERT INTO rules (rule_id, name, description, kind, active, sort_order, applies_to_mode,
                     condition_json, action_json, motivation, version)
  VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 'rules_v0.1')
  ON CONFLICT(rule_id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    kind = excluded.kind,
    sort_order = excluded.sort_order,
    applies_to_mode = excluded.applies_to_mode,
    condition_json = excluded.condition_json,
    action_json = excluded.action_json,
    motivation = excluded.motivation,
    updated_at = datetime('now')
`);

for (const r of rules) {
  upsertRule.run(
    r.rule_id, r.name, r.description || '', r.kind, r.sort_order,
    r.applies_to_mode || null,
    JSON.stringify(r.condition),
    JSON.stringify(r.action),
    r.motivation || ''
  );
}

console.log(`Seed-rules done — ${modes.length} modes, ${rules.length} rules.`);
