import "./env.mjs";
import { databasePath } from "./config.mjs";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.dirname(databasePath);
await mkdir(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 1 CHECK (email_verified IN (0,1)),
    google_sub TEXT UNIQUE,
    subjects_json TEXT NOT NULL DEFAULT '["Mathematics","Biology","Physics","English"]',
    email_verification_token_hash TEXT,
    email_verification_expires_at TEXT,
    email_verification_sent_at TEXT,
    level TEXT NOT NULL DEFAULT 'simple',
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    current_plan TEXT NOT NULL DEFAULT 'free' CHECK (current_plan IN ('free','premium')),
    usage_used INTEGER NOT NULL DEFAULT 0 CHECK (usage_used >= 0),
    usage_period_started_at TEXT NOT NULL,
    usage_reset_at TEXT NOT NULL,
    subscription_status TEXT NOT NULL DEFAULT 'inactive',
    subscription_started_at TEXT,
    subscription_expires_at TEXT,
    provider_customer_id TEXT,
    provider_subscription_id TEXT,
    suspended_at TEXT,
    suspension_reason TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    sent_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_subscription_id TEXT NOT NULL UNIQUE,
    provider_customer_id TEXT,
    provider_plan_code TEXT,
    provider_email_token TEXT,
    status TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    started_at TEXT,
    expires_at TEXT,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    provider_reference TEXT NOT NULL UNIQUE,
    provider_transaction_id TEXT,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    channel TEXT,
    paid_at TEXT,
    verification_status TEXT NOT NULL DEFAULT 'unverified',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    period_started_at TEXT NOT NULL,
    consumed_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','consumed'))
  );
  CREATE TABLE IF NOT EXISTS flashcard_decks (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    cards_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS study_workspaces (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    custom_tasks_json TEXT NOT NULL DEFAULT '[]',
    done_json TEXT NOT NULL DEFAULT '[]',
    progress_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS webhook_events (
    event_key TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    received_at TEXT NOT NULL,
    processed_at TEXT,
    error TEXT,
    payload_json TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_password_resets_expiry ON password_resets(expires_at);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id,status);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry ON subscriptions(status,expires_at);
  CREATE INDEX IF NOT EXISTS idx_payments_user_date ON payments(user_id,created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_payments_subscription ON payments(subscription_id);
  CREATE INDEX IF NOT EXISTS idx_usage_user_period ON usage_records(user_id,period_started_at,status);
  CREATE INDEX IF NOT EXISTS idx_usage_reserved ON usage_records(status,consumed_at);
`);

const webhookColumns = new Set(db.prepare("PRAGMA table_info(webhook_events)").all().map((column) => column.name));
if (!webhookColumns.has("payload_json")) db.exec("ALTER TABLE webhook_events ADD COLUMN payload_json TEXT");
if (!webhookColumns.has("attempts")) db.exec("ALTER TABLE webhook_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
if (!webhookColumns.has("next_attempt_at")) db.exec("ALTER TABLE webhook_events ADD COLUMN next_attempt_at TEXT");
db.prepare("UPDATE webhook_events SET status='pending' WHERE status='processing'").run();

// Keep simple forward-compatible migrations for existing Cognify database files.
const userColumns = new Set(db.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
if (!userColumns.has("usage_period_started_at")) {
  db.exec("ALTER TABLE users ADD COLUMN usage_period_started_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'");
}
if (!userColumns.has("email_verified")) db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1 CHECK (email_verified IN (0,1))");
if (!userColumns.has("email_verification_token_hash")) db.exec("ALTER TABLE users ADD COLUMN email_verification_token_hash TEXT");
if (!userColumns.has("email_verification_expires_at")) db.exec("ALTER TABLE users ADD COLUMN email_verification_expires_at TEXT");
if (!userColumns.has("email_verification_sent_at")) db.exec("ALTER TABLE users ADD COLUMN email_verification_sent_at TEXT");
if (!userColumns.has("google_sub")) db.exec("ALTER TABLE users ADD COLUMN google_sub TEXT");
if (!userColumns.has("subjects_json")) db.exec("ALTER TABLE users ADD COLUMN subjects_json TEXT NOT NULL DEFAULT '[\"Mathematics\",\"Biology\",\"Physics\",\"English\"]'");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL");

function setting(key) {
  return db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value;
}
function setInitialSetting(key, value) {
  db.prepare("INSERT OR IGNORE INTO app_settings(key,value,updated_at) VALUES(?,?,?)").run(key, String(value), new Date().toISOString());
}

const configuredFreeLimit = Number.parseInt(process.env.FREE_USAGE_LIMIT || "15", 10);
const configuredPriceNgn = Number.parseInt(process.env.PREMIUM_PRICE_NGN || "3200", 10);
setInitialSetting("free_usage_limit", Number.isInteger(configuredFreeLimit) && configuredFreeLimit > 0 ? configuredFreeLimit : 15);
setInitialSetting("premium_price_minor", Number.isInteger(configuredPriceNgn) && configuredPriceNgn >= 50 ? configuredPriceNgn * 100 : 320000);
setInitialSetting("currency", "NGN");
setInitialSetting("paystack_plan_code", process.env.PAYSTACK_PLAN_CODE || "");

export function getSetting(key) { return setting(key); }
export function setSetting(key, value) {
  db.prepare(`INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(key, String(value), new Date().toISOString());
}

const activePaystackMode = (process.env.PAYSTACK_MODE || "").toLowerCase();
const environmentPlanCode = process.env.PAYSTACK_PLAN_CODE?.trim() || "";
if (environmentPlanCode && ["test", "live"].includes(activePaystackMode)) {
  setSetting("paystack_plan_code", environmentPlanCode);
  setSetting("paystack_plan_mode", activePaystackMode);
}

// Preserve existing student accounts and browser sessions when moving from the original JSON store.
const legacyFile = path.join(ROOT, "data", "accounts.json");
if (process.env.SKIP_LEGACY_ACCOUNT_IMPORT !== "true" && setting("legacy_accounts_migrated") !== "true") {
  if (existsSync(legacyFile)) {
    try {
      const legacy = JSON.parse(await readFile(legacyFile, "utf8"));
      db.exec("BEGIN IMMEDIATE");
      const insertUser = db.prepare(`INSERT OR IGNORE INTO users
        (id,name,email,level,salt,password_hash,created_at,usage_period_started_at,usage_reset_at)
        VALUES(?,?,?,?,?,?,?,?,?)`);
      const insertSession = db.prepare("INSERT OR IGNORE INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)");
      const ids = new Set();
      for (const user of Array.isArray(legacy.users) ? legacy.users : []) {
        if (!user?.id || !user.email || !user.salt || !user.passwordHash) continue;
        const createdAt = user.createdAt || new Date().toISOString();
        insertUser.run(user.id, user.name || "Student", user.email, user.level || "simple", user.salt, user.passwordHash, createdAt, createdAt, new Date(Date.now() + 30 * 86400_000).toISOString());
        ids.add(user.id);
      }
      const now = Date.now();
      for (const session of Array.isArray(legacy.sessions) ? legacy.sessions : []) {
        if (ids.has(session.userId) && session.tokenHash && Number(session.expiresAt) > now) insertSession.run(session.tokenHash, session.userId, session.expiresAt);
      }
      db.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES('legacy_accounts_migrated','true',?) ON CONFLICT(key) DO UPDATE SET value='true',updated_at=excluded.updated_at").run(new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  } else {
    setSetting("legacy_accounts_migrated", "true");
  }
}

db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
