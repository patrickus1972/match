-- Forta Match — SQLite schema
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  category     TEXT NOT NULL CHECK (category IN ('doelgroep','klachtprofiel','comorbiditeit','locatie','zorgtype','procedureel','exclusie')),
  synonyms     TEXT NOT NULL DEFAULT '[]', -- JSON array
  weight       REAL NOT NULL DEFAULT 1.0,
  status       TEXT NOT NULL DEFAULT 'actief' CHECK (status IN ('actief','inactief')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS labels (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  age_min         INTEGER,
  age_max         INTEGER,
  treatment_form  TEXT NOT NULL DEFAULT 'beide' CHECK (treatment_form IN ('diagnostiek','behandeling','beide')),
  kind            TEXT NOT NULL DEFAULT 'forta' CHECK (kind IN ('forta','sociaal_domein')),
  status          TEXT NOT NULL DEFAULT 'actief' CHECK (status IN ('actief','inactief','archief')),
  extraction_hints TEXT,                            -- Label-specific extraction instructions (JSON)
  scoring_config_json TEXT,                         -- Label-specific scoring config {"thresholds":{...},"weights":{...}}
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label_id      INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,                          -- e.g. "Utrecht", "Online"
  postcode      TEXT,                                   -- NULL when online
  address       TEXT,
  agb_org       TEXT,
  agb_practitioner TEXT,
  is_online     INTEGER NOT NULL DEFAULT 0,
  capacity_per_month INTEGER NOT NULL DEFAULT 0,
  current_load_pct REAL NOT NULL DEFAULT 0,            -- 0-100
  wachttijd_dagen INTEGER,                              -- NULL = unknown
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Each label has tags with a role (incl_required, incl_desired, excl_hard, excl_soft, doelgroep)
-- weight_override allows label-specific tag weights (overrides tags.weight)
CREATE TABLE IF NOT EXISTS label_tags (
  label_id       INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  tag_id         INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('incl_required','incl_desired','excl_hard','excl_soft','doelgroep')),
  weight_override REAL,  -- NULL = use default tag weight
  PRIMARY KEY (label_id, tag_id, role)
);

CREATE TABLE IF NOT EXISTS insurers (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS insurer_contracts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  insurer_id   INTEGER NOT NULL REFERENCES insurers(id),
  label_id     INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  has_contract INTEGER NOT NULL DEFAULT 1,
  plafond_max  INTEGER,                  -- NULL = no plafond
  plafond_used INTEGER NOT NULL DEFAULT 0,
  UNIQUE (insurer_id, label_id)
);

-- Forta-voorkeur (business tag) per label-locatie, met gewicht en vervaldatum
CREATE TABLE IF NOT EXISTS forta_preferences (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label_id    INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE, -- NULL = applies to all locations
  boost       INTEGER NOT NULL CHECK (boost BETWEEN -20 AND 20),
  reason      TEXT NOT NULL DEFAULT '',
  expires_at  TEXT NOT NULL,             -- ISO date
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per ingested referral letter
CREATE TABLE IF NOT EXISTS cases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_code        TEXT NOT NULL UNIQUE,    -- e.g. ZD194240016
  channel         TEXT NOT NULL DEFAULT 'mailbox' CHECK (channel IN ('zorgdomein','zivver','mailbox','intern')),
  patient_initials TEXT,
  patient_age     INTEGER,
  postcode        TEXT,
  insurer_name    TEXT,
  raw_text        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'nieuw' CHECK (status IN ('nieuw','incompleet','klaar_voor_match','wacht_screenteam','besloten')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Result of LLM extraction agent
CREATE TABLE IF NOT EXISTS case_extractions (
  case_id      INTEGER PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  fields_json  TEXT NOT NULL,        -- structured fields (BSN-stand-in, AGB, hulpvraag, dsm, …)
  tags_json    TEXT NOT NULL,        -- list of {name, category, evidence}
  llm_confidence REAL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS completeness_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  items_json  TEXT NOT NULL,        -- [{field, status: 'ok'|'warn'|'missing', message}]
  is_complete INTEGER NOT NULL,
  summary_text TEXT,                 -- generated text for terugstuurbrief
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS knockout_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  triggered   INTEGER NOT NULL,
  criterion   TEXT,                  -- 'diagnostiek_vs_behandeling'|'buiten_kader'|'acute_suicidaliteit'
  reasoning   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Snapshot of a matching run (rules-engine output)
CREATE TABLE IF NOT EXISTS match_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  modus       TEXT NOT NULL,         -- snelste_hulp|labelbalans|match_kwaliteit|custom
  options_json TEXT NOT NULL,         -- ranked list with score breakdowns
  advice      TEXT NOT NULL CHECK (advice IN ('ja','twijfel','nee')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS decisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  actor_role  TEXT NOT NULL CHECK (actor_role IN ('secretariaat','screenteam')),
  actor_name  TEXT NOT NULL,
  outcome     TEXT NOT NULL CHECK (outcome IN ('match','afwijzen','doorzetten_screenteam','niet_bereikbaar','terug_naar_secretariaat')),
  label_id    INTEGER REFERENCES labels(id),
  location_id INTEGER REFERENCES locations(id),
  motivation  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback_sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  actor_role  TEXT NOT NULL,
  actor_name  TEXT NOT NULL,
  transcript_json TEXT NOT NULL,    -- conversation turns
  summary_json TEXT,                 -- structured summary across 4 categories
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  payload     TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Voorbereide vragen voor het screenteam (per case)
CREATE TABLE IF NOT EXISTS case_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  text        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT '',
  answer      TEXT,                                -- captured during telephone-uitvraag
  origin      TEXT NOT NULL DEFAULT 'generated' CHECK (origin IN ('generated','user')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_label_tags_role ON label_tags(role);
CREATE INDEX IF NOT EXISTS idx_match_runs_case ON match_runs(case_id);
CREATE INDEX IF NOT EXISTS idx_case_questions_case ON case_questions(case_id, position);

-- ====== Rules engine: DSL-driven configuration ======

-- Business modi met weights per dimensie + drempels — voorheen MODUS_WEIGHTS in code
CREATE TABLE IF NOT EXISTS business_modes (
  id              TEXT PRIMARY KEY,                 -- 'snelste_hulp', 'labelbalans', ...
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  weights_json    TEXT NOT NULL,                    -- {"relevance":1.0,"wachttijd":1.5,...}
  thresholds_json TEXT NOT NULL,                    -- {"ja_drempel":18,"twijfel_drempel":6}
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rules met JSON-DSL conditions + actions
-- Rules without entries in rule_labels are global (apply to all labels)
-- Rules with entries in rule_labels only apply to those specific labels
CREATE TABLE IF NOT EXISTS rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id         TEXT NOT NULL UNIQUE,             -- bv. 'rule_age_mismatch'
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL CHECK (kind IN ('hard','soft','modus_modifier','voorkeur')),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort_order      INTEGER NOT NULL DEFAULT 100,
  applies_to_mode TEXT,                              -- nullable; alleen voor kind='modus_modifier'
  label_id        INTEGER REFERENCES labels(id),     -- DEPRECATED: use rule_labels table instead
  condition_json  TEXT NOT NULL,                     -- DSL condition tree
  action_json     TEXT NOT NULL,                     -- DSL action
  motivation      TEXT NOT NULL DEFAULT '',
  version         TEXT NOT NULL DEFAULT 'rules_v0.1',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at     TEXT
);

-- Junction table for rules that apply to specific labels (many-to-many)
-- A rule with NO entries here is global (applies to all labels)
-- A rule with entries here ONLY applies to those specific labels
CREATE TABLE IF NOT EXISTS rule_labels (
  rule_id   INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  label_id  INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (rule_id, label_id)
);

-- Snapshot van complete rules-state op moment van publish (voor replay)
CREATE TABLE IF NOT EXISTS rules_snapshots (
  version         TEXT PRIMARY KEY,
  snapshot_json   TEXT NOT NULL,
  motivation      TEXT,
  published_by    TEXT NOT NULL DEFAULT 'system',
  published_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_kind_active ON rules(kind, active);
CREATE INDEX IF NOT EXISTS idx_rules_sort ON rules(sort_order);
CREATE INDEX IF NOT EXISTS idx_rules_label ON rules(label_id);
