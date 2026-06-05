// DSL evaluator for the rules engine.
// Four condition types: fact_compare, tag_intersect, computed, composite (and/or/not).
// Four action types: knockout, score_delta, score_multiplier, warning.
//
// Pure, deterministic, no eval. Conditions return either true/false, or an
// "outcome" object describing matched items so actions can use them
// (e.g. per_occurrence scoring with the matched tag's name + weight).

import { COMPUTED_FUNCTIONS, isKnownComputed } from './computed.js';

// -------- fact resolution --------
// Supports dot-notation against the eval context, e.g. "client.leeftijd",
// "label.wachttijd_dagen", "label.location.is_online".
export function resolveFact(path, ctx) {
  if (path == null) return undefined;
  const parts = String(path).split('.');
  let cur = ctx;
  for (const p of parts) {
    if (cur == null) return undefined;
    // "label.location" resolves to the active __location for this iteration
    if (cur === ctx.label && p === 'location') { cur = ctx.label.__location; continue; }
    cur = cur[p];
  }
  return cur;
}

// Resolves a "value" expression that can be a literal, or a reference
// like { "from_label_field": "leeftijd_min" }, or {"fact": "client.leeftijd"}.
function resolveValue(v, ctx) {
  if (v == null || typeof v !== 'object') return v;
  if ('from_label_field' in v) return ctx.label?.[v.from_label_field];
  if ('from_client_field' in v) return ctx.client?.[v.from_client_field];
  if ('fact' in v) return resolveFact(v.fact, ctx);
  if ('literal' in v) return v.literal;
  return v; // raw object — caller may handle (e.g. between range)
}

// -------- comparison ops --------
const OPS = {
  eq:  (a, b) => a === b,
  neq: (a, b) => a !== b,
  lt:  (a, b) => Number(a) <  Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  gt:  (a, b) => Number(a) >  Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  between: (a, range) => a != null && a >= range.from && a <= range.to,
  not_between: (a, range) => a != null && (a < range.from || a > range.to),
  contains:     (a, b) => Array.isArray(a) ? a.includes(b) : String(a).includes(b),
  not_contains: (a, b) => Array.isArray(a) ? !a.includes(b) : !String(a).includes(b)
};

// -------- condition evaluation --------
// Returns either { matched: false } or { matched: true, hits: [...], computedResult: <any>, threshold: <obj?> }
export function evaluateCondition(cond, ctx) {
  if (!cond || typeof cond !== 'object') return { matched: false };

  switch (cond.type) {
    case 'fact_compare': return evalFactCompare(cond, ctx);
    case 'tag_intersect': return evalTagIntersect(cond, ctx);
    case 'computed':      return evalComputed(cond, ctx);
    case 'and':           return evalComposite(cond, ctx, 'and');
    case 'or':            return evalComposite(cond, ctx, 'or');
    case 'not':           return evalNot(cond, ctx);
    default:
      // Onbekend type — defensief false retourneren ipv throw
      return { matched: false, error: `unknown_condition_type:${cond.type}` };
  }
}

function evalFactCompare(cond, ctx) {
  const a = resolveFact(cond.fact, ctx);
  let b;
  if (cond.value && typeof cond.value === 'object' && ('from' in cond.value || 'to' in cond.value
      || 'from_label_field' in cond.value || 'to_label_field' in cond.value)) {
    // between/not_between range
    const from = 'from_label_field' in cond.value ? ctx.label?.[cond.value.from_label_field] : cond.value.from;
    const to   = 'to_label_field'   in cond.value ? ctx.label?.[cond.value.to_label_field]   : cond.value.to;
    b = { from, to };
  } else {
    b = resolveValue(cond.value, ctx);
  }
  const op = OPS[cond.op];
  if (!op) return { matched: false, error: `unknown_op:${cond.op}` };
  // Null/undefined facts ≠ truthy unless explicitly null-check
  if (a == null && !(cond.op === 'eq' && b == null) && !(cond.op === 'neq')) return { matched: false };
  let matched = op(a, b);
  if (cond.negate) matched = !matched;
  return { matched, factValue: a };
}

function evalTagIntersect(cond, ctx) {
  // referral_tags: "all_extracted" | "by_category:<name>"
  const briefTagsAll = ctx.tagging?.tags || [];
  let briefTags = briefTagsAll;
  if (cond.referral_tags && cond.referral_tags.startsWith('by_category:')) {
    const cat = cond.referral_tags.split(':')[1];
    briefTags = briefTagsAll.filter(t => t.category === cat);
  }
  // label_field: "inclusie_verplicht" | "inclusie_gewenst" | "exclusie_hard" | "exclusie_zacht" | "doelgroep"
  const labelTags = ctx.label?.__tags_by_role?.[cond.label_field] || [];
  const briefNames = new Set(briefTags.map(t => t.name));
  const hits = labelTags.filter(lt => briefNames.has(lt.name));

  let matched;
  if (cond.min_overlap === 'all') {
    // Trivially-true op een lege labelTags-lijst (er is niets om aan te voldoen).
    // Zonder deze regel zou een label zónder verplichte tags onterecht een
    // knockout krijgen via {min_overlap:'all', negate:true}.
    matched = hits.length === labelTags.length;
  } else {
    const min = Number(cond.min_overlap || 1);
    matched = hits.length >= min;
  }
  if (cond.negate) matched = !matched;
  return { matched, hits };
}

function evalComputed(cond, ctx) {
  if (!isKnownComputed(cond.compute)) {
    return { matched: false, error: `unknown_computed:${cond.compute}` };
  }
  const fn = COMPUTED_FUNCTIONS[cond.compute];
  const result = fn(cond.args || {}, ctx);
  if (result == null) return { matched: false, computedResult: null };

  // Als er thresholds zijn, kies de eerste die past en geef hem mee terug
  if (Array.isArray(cond.thresholds)) {
    const hit = matchThreshold(cond.thresholds, result);
    return { matched: hit != null, computedResult: result, threshold: hit };
  }
  return { matched: true, computedResult: result };
}

// Threshold expressies: { "if": "result < 30", ... }. Beperkte parser, geen eval.
function matchThreshold(thresholds, result) {
  for (const t of thresholds) {
    const expr = String(t.if || '').trim();
    if (evalThresholdExpr(expr, result)) return t;
  }
  return null;
}

function evalThresholdExpr(expr, result) {
  // Splits op " and " — beide kanten moeten waar zijn
  const parts = expr.split(/\s+and\s+/i).map(p => p.trim());
  for (const p of parts) {
    if (!evalSimple(p, result)) return false;
  }
  return true;
}

function evalSimple(expr, result) {
  // "result <op> <number>" — alleen result aan de linkerkant ondersteund
  const m = expr.match(/^result\s*(<=|>=|<|>|==|!=)\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return false;
  const op = m[1];
  const n = Number(m[2]);
  switch (op) {
    case '<':  return result <  n;
    case '<=': return result <= n;
    case '>':  return result >  n;
    case '>=': return result >= n;
    case '==': return result === n;
    case '!=': return result !== n;
  }
  return false;
}

function evalComposite(cond, ctx, kind) {
  const parts = (cond.conditions || []).map(c => evaluateCondition(c, ctx));
  if (kind === 'and') return { matched: parts.every(p => p.matched), children: parts };
  if (kind === 'or')  return { matched: parts.some(p  => p.matched), children: parts };
  return { matched: false };
}

function evalNot(cond, ctx) {
  const inner = evaluateCondition(cond.conditions?.[0] || cond.condition, ctx);
  return { matched: !inner.matched };
}

// -------- action evaluation --------
// Applies an action given the outcome of a condition. Returns:
//   { delta, scoreTags, knockout, warning, multiplier } — caller adds them up.
export function evaluateAction(action, outcome, ctx) {
  const result = { delta: 0, scoreTags: [], knockout: null, multiplier: 1, warning: null };
  if (!action || !outcome?.matched) return result;

  switch (action.type) {
    case 'knockout': {
      result.knockout = renderTemplate(action.motivation_template || '', ctx, outcome);
      return result;
    }
    case 'warning': {
      result.warning = renderTemplate(action.warning_text || '', ctx, outcome);
      if (action.score_tag_template) {
        result.scoreTags.push({
          tag: renderTemplate(action.score_tag_template, ctx, outcome),
          kind: 'warning',
          dim: action.dim || null
        });
      }
      return result;
    }
    case 'score_multiplier': {
      result.multiplier = Number(action.multiplier || 1);
      return result;
    }
    case 'score_delta': {
      // Computed met threshold → gebruik threshold-specifieke delta/tag
      if (outcome.threshold) {
        const t = outcome.threshold;
        const dim = action.dim || null;
        const weight = dim && ctx.mode?.weights ? Number(ctx.mode.weights[dim] ?? 1) : 1;
        const delta = Math.round(Number(t.delta || 0) * weight);
        if (delta !== 0 || t.tag) {
          result.delta += delta;
          if (t.tag) result.scoreTags.push({
            tag: renderTemplate(t.tag, ctx, outcome, { delta }),
            kind: t.type || (delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'neutral'),
            dim
          });
        }
        return result;
      }
      // Tag_intersect met per_occurrence → één delta per matchende tag
      if (action.per_occurrence && Array.isArray(outcome.hits)) {
        for (const hit of outcome.hits) {
          const weight = Number(hit.weight || 1);
          const modWeight = action.dim && ctx.mode?.weights
            ? Number(ctx.mode.weights[action.dim] ?? 1) : 1;
          const delta = Math.round(Number(action.delta || 0) * weight * modWeight);
          result.delta += delta;
          if (action.score_tag_template) {
            result.scoreTags.push({
              tag: renderTemplate(action.score_tag_template, ctx, outcome, { delta, tag: hit }),
              kind: action.score_tag_type || (delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'neutral'),
              dim: action.dim || null
            });
          }
        }
        return result;
      }
      // Standaard score_delta — één keer toepassen
      const dim = action.dim || null;
      const weight = dim && ctx.mode?.weights ? Number(ctx.mode.weights[dim] ?? 1) : 1;
      const delta = Math.round(Number(action.delta || 0) * weight);
      result.delta += delta;
      if (action.score_tag_template) {
        result.scoreTags.push({
          tag: renderTemplate(action.score_tag_template, ctx, outcome, { delta }),
          kind: action.score_tag_type || (delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'neutral'),
          dim
        });
      }
      return result;
    }
    default:
      return result;
  }
}

// Mustache-light template renderer. Supports {{tag.name}}, {{client.leeftijd}},
// {{label.name}}, {{delta}}, etc. Geen filters of conditionals.
function renderTemplate(tpl, ctx, outcome, extras = {}) {
  if (!tpl) return '';
  return String(tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    if (path === 'delta') return String(extras.delta ?? '');
    if (path.startsWith('tag.')) {
      const tag = extras.tag || outcome.hits?.[0] || {};
      const key = path.slice(4);
      return String(tag[key] ?? '');
    }
    const v = resolveFact(path, ctx);
    return v == null ? '' : String(v);
  });
}

// -------- DSL validation (for beheer-API) --------
export function validateRuleBody(body) {
  const errs = [];
  if (!body || typeof body !== 'object') return ['rule_body_missing'];
  if (!body.condition) errs.push('condition_missing');
  else validateCondition(body.condition, errs, 'condition');
  if (!body.action) errs.push('action_missing');
  else validateAction(body.action, errs, 'action');
  return errs;
}

function validateCondition(c, errs, path) {
  if (!c || typeof c !== 'object') { errs.push(`${path}:not_object`); return; }
  const KNOWN = ['fact_compare', 'tag_intersect', 'computed', 'and', 'or', 'not'];
  if (!KNOWN.includes(c.type)) { errs.push(`${path}:unknown_type:${c.type}`); return; }
  if (c.type === 'fact_compare') {
    if (!c.fact) errs.push(`${path}:fact_missing`);
    if (!OPS[c.op]) errs.push(`${path}:unknown_op:${c.op}`);
  }
  if (c.type === 'tag_intersect') {
    if (!c.label_field) errs.push(`${path}:label_field_missing`);
  }
  if (c.type === 'computed') {
    if (!isKnownComputed(c.compute)) errs.push(`${path}:unknown_computed:${c.compute}`);
  }
  if (c.type === 'and' || c.type === 'or' || c.type === 'not') {
    (c.conditions || []).forEach((cc, i) => validateCondition(cc, errs, `${path}.conditions[${i}]`));
  }
}

function validateAction(a, errs, path) {
  const KNOWN = ['knockout', 'score_delta', 'score_multiplier', 'warning'];
  if (!KNOWN.includes(a.type)) errs.push(`${path}:unknown_type:${a.type}`);
}
