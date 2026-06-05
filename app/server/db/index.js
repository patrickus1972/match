import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'forta.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

export function audit(actor, action, entity, entityId, payload) {
  db.prepare('INSERT INTO audit_log (actor, action, entity, entity_id, payload) VALUES (?, ?, ?, ?, ?)')
    .run(actor, action, entity ?? null, entityId == null ? null : String(entityId), payload ? JSON.stringify(payload) : null);
}

export function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')`).run(key, value);
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
