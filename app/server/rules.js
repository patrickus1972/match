// Rules engine — laadt rules + modes uit DB en evalueert via de DSL.
// Output-vorm identiek aan de oude rules.js (advice, options[], breakdown[]).
//
// LABEL-SPECIFIC RULES:
// - Rules with label_id = NULL are global (apply to all labels)
// - Rules with label_id = X only apply when evaluating label X
// - Label-specific rules are evaluated AFTER global rules
//
// LABEL-SPECIFIC TAG WEIGHTS:
// - label_tags.weight_override overrides tags.weight for that label
// - Allows labels to value certain tags higher/lower than default

import { db, getSetting } from './db/index.js';
import { evaluateCondition, evaluateAction } from './dsl.js';

// -------- DB loaders --------
function loadActiveMode(modusId) {
  const id = modusId || getSetting('business_modus', 'snelste_hulp');
  let row = db.prepare(`SELECT * FROM business_modes WHERE id = ?`).get(id);
  if (!row) row = db.prepare(`SELECT * FROM business_modes WHERE is_default = 1 LIMIT 1`).get();
  if (!row) {
    // Last-resort default
    return { id: 'snelste_hulp', weights: { relevance:1, criteria:1, wachttijd:1.5, reistijd:1, plafond:1, balans:1, voorkeur:1 },
             thresholds: { ja_drempel: 18, twijfel_drempel: 6 } };
  }
  return {
    id: row.id,
    name: row.name,
    weights: JSON.parse(row.weights_json),
    thresholds: JSON.parse(row.thresholds_json)
  };
}

// Load global rules (label_id IS NULL) and optionally label-specific rules
function loadActiveRules(labelId = null) {
  // Global rules
  const globalRows = db.prepare(`
    SELECT * FROM rules
    WHERE active = 1 AND archived_at IS NULL AND label_id IS NULL
    ORDER BY sort_order ASC, id ASC
  `).all();

  // Label-specific rules (if labelId provided)
  let labelRows = [];
  if (labelId) {
    labelRows = db.prepare(`
      SELECT * FROM rules
      WHERE active = 1 AND archived_at IS NULL AND label_id = ?
      ORDER BY sort_order ASC, id ASC
    `).get(labelId) ? db.prepare(`
      SELECT * FROM rules
      WHERE active = 1 AND archived_at IS NULL AND label_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(labelId) : [];
  }

  const mapRule = r => ({
    rule_id: r.rule_id,
    name: r.name,
    kind: r.kind,
    sort_order: r.sort_order,
    applies_to_mode: r.applies_to_mode,
    label_id: r.label_id,
    condition: JSON.parse(r.condition_json),
    action: JSON.parse(r.action_json),
    motivation: r.motivation,
    isLabelSpecific: r.label_id != null
  });

  return {
    global: globalRows.map(mapRule),
    labelSpecific: labelRows.map(mapRule)
  };
}

// Load all active rules grouped by label for efficient batch processing
// Uses rule_labels junction table for multi-label support
function loadAllActiveRules() {
  // Load all active rules
  const rows = db.prepare(`
    SELECT * FROM rules
    WHERE active = 1 AND archived_at IS NULL
    ORDER BY sort_order ASC, id ASC
  `).all();

  // Load all rule-label associations
  const ruleLabelRows = db.prepare(`SELECT rule_id, label_id FROM rule_labels`).all();

  // Build a map: rule.id -> [label_ids]
  const ruleLabelMap = {};
  for (const rl of ruleLabelRows) {
    if (!ruleLabelMap[rl.rule_id]) ruleLabelMap[rl.rule_id] = [];
    ruleLabelMap[rl.rule_id].push(rl.label_id);
  }

  const global = [];
  const byLabel = {};

  for (const r of rows) {
    const labelIds = ruleLabelMap[r.id] || [];
    const isGlobal = labelIds.length === 0;

    const mapped = {
      rule_id: r.rule_id,
      name: r.name,
      kind: r.kind,
      sort_order: r.sort_order,
      applies_to_mode: r.applies_to_mode,
      label_ids: labelIds,
      condition: JSON.parse(r.condition_json),
      action: JSON.parse(r.action_json),
      motivation: r.motivation,
      isLabelSpecific: !isGlobal
    };

    if (isGlobal) {
      global.push(mapped);
    } else {
      // Add this rule to each label it applies to
      for (const labelId of labelIds) {
        if (!byLabel[labelId]) byLabel[labelId] = [];
        byLabel[labelId].push(mapped);
      }
    }
  }

  return { global, byLabel };
}

function loadLabelsFull() {
  const labels = db.prepare(`SELECT * FROM labels WHERE status = 'actief'`).all();
  // Include weight_override for label-specific tag weights
  const tagsByLabel = db.prepare(`
    SELECT lt.label_id, lt.role, t.name, t.weight AS default_weight, t.category,
           lt.weight_override,
           COALESCE(lt.weight_override, t.weight) AS weight
    FROM label_tags lt JOIN tags t ON t.id = lt.tag_id
  `).all();
  const locsByLabel = db.prepare(`SELECT * FROM locations`).all();
  const prefs = db.prepare(`SELECT * FROM forta_preferences WHERE date(expires_at) >= date('now')`).all();
  const contractsByLabel = db.prepare(`
    SELECT ic.label_id, i.name AS insurer_name, ic.has_contract, ic.plafond_max, ic.plafond_used
    FROM insurer_contracts ic JOIN insurers i ON i.id = ic.insurer_id
  `).all();
  return labels.map(l => {
    const lt = tagsByLabel.filter(t => t.label_id === l.id);
    const tagsByRole = {
      incl_required: lt.filter(t => t.role === 'incl_required'),
      incl_desired:  lt.filter(t => t.role === 'incl_desired'),
      excl_hard:     lt.filter(t => t.role === 'excl_hard'),
      excl_soft:     lt.filter(t => t.role === 'excl_soft'),
      doelgroep:     lt.filter(t => t.role === 'doelgroep')
    };
    // Parse label-specific scoring config if present
    let scoringConfig = null;
    if (l.scoring_config_json) {
      try { scoringConfig = JSON.parse(l.scoring_config_json); } catch {}
    }
    return {
      ...l,
      __tags: lt,
      __tags_by_role: tagsByRole,
      __locations: locsByLabel.filter(loc => loc.label_id === l.id),
      __prefs: prefs.filter(p => p.label_id === l.id),
      __contracts: contractsByLabel.filter(c => c.label_id === l.id),
      __scoring_config: scoringConfig,
      __extraction_hints: l.extraction_hints
    };
  });
}

// -------- Eval context per label×location --------
// De DSL kijkt naar { client, label, tagging, mode, completeness }.
// label.__location wijst naar de huidige locatie zodat reistijd / wachttijd-rules
// kunnen kijken naar fysieke locatie-eigenschappen.
function buildCtx({ extraction, label, location, mode }) {
  const labelView = {
    ...label,
    __location: location,
    __contracts: label.__contracts,
    __tags_by_role: label.__tags_by_role,
    leeftijd_min: label.age_min,                  // alias zodat DSL ".leeftijd_min" werkt
    leeftijd_max: label.age_max,
    behandelvorm: label.treatment_form,
    wachttijd_dagen: location?.wachttijd_dagen,
    location: location || {}
  };
  return {
    client: {
      leeftijd: extraction.patient_age || 0,
      postcode: extraction.postcode || '',
      insurer_name: extraction.insurer_name || ''
    },
    label: labelView,
    tagging: { tags: extraction.tags || [] },
    completeness: null,
    mode
  };
}

// -------- Main entry --------
export function runMatching(extraction, opts = {}) {
  const mode = loadActiveMode(opts.modus);

  // Load ALL rules (global + per-label) in one query for efficiency
  const allRules = loadAllActiveRules();

  // Separate global rules by kind
  const globalHard  = allRules.global.filter(r => r.kind === 'hard');
  const globalSoft  = allRules.global.filter(r => r.kind === 'soft');
  const globalModus = allRules.global.filter(r => r.kind === 'modus_modifier' &&
    (!r.applies_to_mode || r.applies_to_mode === mode.id));

  const labels = loadLabelsFull();
  const options = [];

  for (const L of labels) {
    // Get label-specific rules for this label
    const labelRules = allRules.byLabel[L.id] || [];
    const labelHard  = labelRules.filter(r => r.kind === 'hard');
    const labelSoft  = labelRules.filter(r => r.kind === 'soft');
    const labelModus = labelRules.filter(r => r.kind === 'modus_modifier' &&
      (!r.applies_to_mode || r.applies_to_mode === mode.id));

    // Combine global + label-specific rules (label-specific come AFTER global)
    const hardRules  = [...globalHard, ...labelHard];
    const softRules  = [...globalSoft, ...labelSoft];
    const modusRules = [...globalModus, ...labelModus];

    // Get label-specific thresholds if configured
    const thresholds = L.__scoring_config?.thresholds || mode.thresholds;

    for (const loc of L.__locations) {
      const ctx = buildCtx({ extraction, label: L, location: loc, mode });
      const breakdown = [];

      // 1. Hard rules (global first, then label-specific)
      let knockedOut = false;
      let knockoutReason = null;
      let knockoutRule = null;
      for (const rule of hardRules) {
        const outcome = evaluateCondition(rule.condition, ctx);
        if (outcome.matched) {
          const res = evaluateAction(rule.action, outcome, ctx);
          knockedOut = true;
          knockoutReason = res.knockout || rule.motivation || rule.name;
          knockoutRule = rule.rule_id;
          break;
        }
      }
      if (knockedOut) {
        options.push({
          label_id: L.id, label_code: L.code, label_name: L.name, kind: L.kind || 'forta',
          location_id: loc.id, location_name: loc.name, is_online: !!loc.is_online,
          knockedOut: true, knockoutReason, knockoutRule,
          totalScore: -999, breakdown: [],
          wachttijd_dagen: loc.wachttijd_dagen, reisMin: null,
          hasLabelSpecificRules: labelRules.length > 0
        });
        continue;
      }

      // 2. Soft rules (global first, then label-specific)
      let totalScore = 0;
      for (const rule of softRules) {
        const outcome = evaluateCondition(rule.condition, ctx);
        if (!outcome.matched) continue;
        const res = evaluateAction(rule.action, outcome, ctx);
        totalScore += res.delta;
        for (const st of res.scoreTags) {
          breakdown.push({
            tag: st.tag,
            kind: normalizeKind(st.kind),
            dim: st.dim || null,
            rule_id: rule.rule_id,
            isLabelSpecific: rule.isLabelSpecific
          });
        }
      }

      // 3. Modus-modifier rules (global first, then label-specific)
      for (const rule of modusRules) {
        const outcome = evaluateCondition(rule.condition, ctx);
        if (!outcome.matched) continue;
        const res = evaluateAction(rule.action, outcome, ctx);
        totalScore += res.delta;
        for (const st of res.scoreTags) {
          breakdown.push({
            tag: st.tag,
            kind: normalizeKind(st.kind),
            dim: st.dim || 'balans',
            rule_id: rule.rule_id,
            isLabelSpecific: rule.isLabelSpecific
          });
        }
      }

      // 4. Forta-voorkeur (blijft als aparte concept, niet in rules-tabel)
      const matchingPref = L.__prefs.find(p => p.location_id == null || p.location_id === loc.id);
      if (matchingPref) {
        const prefWeight = Number(mode.weights?.voorkeur ?? 1);
        const delta = Math.round(matchingPref.boost * prefWeight);
        totalScore += delta;
        breakdown.push({
          tag: `Forta-voorkeur ${delta > 0 ? '+' + delta : delta}`,
          kind: 'pos',
          dim: 'voorkeur',
          note: matchingPref.reason,
          rule_id: 'forta_voorkeur'
        });
      }

      // Compute reisMin voor display (frontend gebruikt dit naast breakdown)
      const reisMin = loc.is_online ? null : computeReisMin(ctx.client.postcode, loc.postcode);

      options.push({
        label_id: L.id, label_code: L.code, label_name: L.name, label_description: L.description,
        kind: L.kind || 'forta',
        location_id: loc.id, location_name: loc.name, is_online: !!loc.is_online,
        wachttijd_dagen: loc.wachttijd_dagen, reisMin,
        totalScore, breakdown, knockedOut: false,
        hasLabelSpecificRules: labelRules.length > 0,
        labelThresholds: thresholds !== mode.thresholds ? thresholds : null
      });
    }
  }

  // Rangschikken: live opties op score desc, knockouts onderaan
  options.sort((a, b) => {
    if (a.knockedOut && !b.knockedOut) return 1;
    if (!a.knockedOut && b.knockedOut) return -1;
    return b.totalScore - a.totalScore;
  });

  // Advies bepalen via drempels uit de actieve modus
  // (label-specific thresholds are already applied per-option during scoring)
  const live = options.filter(o => !o.knockedOut);
  let advice = 'nee';
  if (live.length > 0) {
    // Use the top match's label-specific thresholds if available, otherwise mode thresholds
    const topThresholds = live[0].labelThresholds || mode.thresholds;
    if (live[0].totalScore >= topThresholds.ja_drempel) advice = 'ja';
    else if (live[0].totalScore >= topThresholds.twijfel_drempel) advice = 'twijfel';
  }

  return { modus: mode.id, advice, options };
}

// -------- Helpers --------
function normalizeKind(k) {
  if (k === 'pos' || k === 'positive') return 'pos';
  if (k === 'neg' || k === 'negative') return 'neg';
  if (k === 'business') return 'pos';
  if (k === 'warning') return 'neg';
  return 'neutral';
}

// Pure helper voor display — gebruikt dezelfde tabel als computed/travel_time_minutes.
import { COMPUTED_FUNCTIONS } from './computed.js';
function computeReisMin(fromPC, toPC) {
  return COMPUTED_FUNCTIONS.travel_time_minutes({}, {
    client: { postcode: fromPC },
    label: { __location: { postcode: toPC, is_online: false } }
  });
}
