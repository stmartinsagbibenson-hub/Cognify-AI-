import "../env.mjs";
import { DatabaseSync } from "node:sqlite";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databasePath } from "../config.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.resolve(process.argv[2] || path.join(ROOT, "..", "data", "backups", "cognify-" + stamp + ".sqlite"));
if (path.resolve(destination) === path.resolve(databasePath)) throw new Error("Backup destination must differ from DATABASE_PATH.");
await stat(databasePath);
await mkdir(path.dirname(destination), { recursive: true });
try { await access(destination); throw new Error("Backup destination already exists; choose a new path."); }
catch (error) { if (error.code !== "ENOENT") throw error; }

const source = new DatabaseSync(databasePath);
try {
  source.exec("PRAGMA busy_timeout=5000;");
  const escaped = destination.replace(/'/g, "''");
  source.exec("VACUUM INTO '" + escaped + "'");
} finally { source.close(); }

const backup = new DatabaseSync(destination, { readOnly: true });
try {
  const result = backup.prepare("PRAGMA integrity_check").get();
  if (result.integrity_check !== "ok") throw new Error("Backup integrity check failed.");
} finally { backup.close(); }
console.log("SQLite backup created and integrity-checked: " + destination);
