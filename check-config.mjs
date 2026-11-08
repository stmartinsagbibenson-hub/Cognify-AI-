import "./env.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, constants, stat } from "node:fs/promises";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const production = process.env.NODE_ENV === "production";
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
const supportedNode = major > 22 || (major === 22 && minor >= 13);
const checks = [];
function check(name, ready, readyMessage, missingMessage) {
  checks.push({ name, ready: Boolean(ready), message: ready ? readyMessage : missingMessage });
}

function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,63}$/.test(value || ""); }
function validSender(value) {
  const match = String(value || "").trim().match(/^(?:[^<>\r\n]*<)?([^<>\s]+@[^<>\s]+)(?:>)?$/);
  if (!match || !validEmail(match[1])) return false;
  const domain = match[1].split("@").at(-1).toLowerCase();
  return domain !== "example.com" && !domain.endsWith(".example") && !domain.endsWith(".test");
}
function parseAppUrl() {
  try {
    const url = new URL(process.env.APP_URL || process.env.PUBLIC_APP_URL || "");
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

check("Node.js", supportedNode, "supported version", "install Node.js 22.13 or later");
check("Google sign-in", Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()),
  "OAuth web client credentials are set", "set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
check("Groq AI", Boolean(process.env.GROQ_API_KEY?.trim()), "API key is set", "set GROQ_API_KEY to enable live tutoring and generated practice");

const emailProvider = (process.env.EMAIL_PROVIDER || "resend").toLowerCase();
const emailReady = emailProvider === "resend" && Boolean(process.env.RESEND_API_KEY?.trim()) && validSender(process.env.EMAIL_FROM);
check("Email delivery", emailReady, "Resend key and a non-placeholder sender are set",
  emailProvider === "resend" ? "set RESEND_API_KEY and EMAIL_FROM to an address on your verified domain" : "set EMAIL_PROVIDER=resend; this build supports Resend");
check("Admin access", validEmail(process.env.ADMIN_EMAIL) && (process.env.ADMIN_ACCESS_KEY || "").length >= 32,
  "admin email and 32+ character key are set", "set ADMIN_EMAIL and generate ADMIN_ACCESS_KEY with: openssl rand -hex 32");

const host = (process.env.HOST || (production ? "0.0.0.0" : "127.0.0.1")).trim();
const publicBind = !["127.0.0.1", "localhost", "::1"].includes(host);
check("Host binding", !production || publicBind, host + (production ? "" : " (development default)"), "set HOST=0.0.0.0 on the production host");
const port = process.env.PORT || "3000";
check("PORT", /^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535, "valid port is set", "set PORT to an integer from 1 to 65535");
check("Runtime mode", true, production ? "production" : "development defaults (set NODE_ENV=production on the public host)", "set NODE_ENV");
check("Trusted proxy", !process.env.TRUST_PROXY || ["true", "false"].includes(process.env.TRUST_PROXY),
  process.env.TRUST_PROXY === "true" ? "enabled; reverse proxy headers are trusted" : "disabled", "set TRUST_PROXY to true or false");

const databasePath = path.resolve(ROOT, process.env.DATABASE_PATH || "data/cognify.sqlite");
let databaseReady = true;
try {
  const existing = await stat(databasePath).catch(() => null);
  if (existing?.isDirectory()) databaseReady = false;
  const parent = await stat(path.dirname(databasePath));
  databaseReady &&= parent.isDirectory();
  await access(path.dirname(databasePath), constants.W_OK);
} catch { databaseReady = false; }
check("SQLite path", databaseReady, "database path resolves to a writable directory", "set DATABASE_PATH under writable persistent storage");

const appUrl = parseAppUrl();
const localAppUrl = appUrl && ["localhost", "127.0.0.1", "::1"].includes(appUrl.hostname);
const validAppUrl = appUrl && (appUrl.protocol === "https:" || (appUrl.protocol === "http:" && localAppUrl));
const canonicalAppUrlSet = Boolean(process.env.APP_URL?.trim());
const appUrlReady = canonicalAppUrlSet && Boolean(validAppUrl && (!production || appUrl.protocol === "https:"));
check("APP_URL", appUrlReady,
  appUrl ? appUrl.origin + (production ? " (HTTPS)" : "") : "local or public origin is set",
  !canonicalAppUrlSet ? "set APP_URL; PUBLIC_APP_URL is only a deprecated compatibility alias" : "set APP_URL to the app origin (HTTPS in production)");
if (appUrl && process.env.GOOGLE_REDIRECT_URI) {
  check("Google callback", process.env.GOOGLE_REDIRECT_URI.trim() === new URL("/auth/google/callback", appUrl).toString(),
    "matches APP_URL", "remove GOOGLE_REDIRECT_URI; Cognify derives it from APP_URL");
}
const cookiesNeedSecure = production || appUrl?.protocol === "https:";
check("Secure cookies", !cookiesNeedSecure || process.env.COOKIE_SECURE === "true",
  process.env.COOKIE_SECURE === "true" ? "enabled" : "not required for this local URL",
  "set COOKIE_SECURE=true for public HTTPS");

const secretKey = process.env.PAYSTACK_SECRET_KEY || "";
const keyMode = secretKey.startsWith("sk_test_") ? "test" : secretKey.startsWith("sk_live_") ? "live" : "";
const configuredMode = (process.env.PAYSTACK_MODE || "").toLowerCase();
const expectedMode = production ? "live" : "test";
const paymentReady = Boolean(keyMode && configuredMode === keyMode && configuredMode === expectedMode);
const paymentMissingMessage = !keyMode ? "set a valid PAYSTACK_SECRET_KEY"
  : !production && keyMode === "live" ? "live keys are disabled outside production; use an sk_test_... key with PAYSTACK_MODE=test"
    : production && keyMode === "test" ? "test keys are disabled in production; use an sk_live_... key with PAYSTACK_MODE=live"
      : !configuredMode ? "set PAYSTACK_MODE explicitly to " + expectedMode
        : configuredMode !== keyMode ? "PAYSTACK_MODE does not match the key prefix; use a matching " + expectedMode + " key"
          : "live keys are disabled outside production; test keys are disabled in production";
check("Paystack mode", paymentReady, configuredMode + " mode matches the key and " + (production ? "production" : "non-production") + " environment",
  paymentMissingMessage);

console.log("Local configuration");
let missing = 0;
for (const item of checks) {
  console.log((item.ready ? "[OK]   " : "[NEEDS] ") + item.name + ": " + item.message);
  if (!item.ready) missing += 1;
}

console.log("\nProvider dashboards and release checks (not verified by this script)");
if (appUrl) {
  console.log("[MANUAL] Google Cloud Console: authorized JavaScript origin " + appUrl.origin);
  console.log("[MANUAL] Google Cloud Console: authorized redirect URI " + new URL("/auth/google/callback", appUrl).toString());
  console.log("[MANUAL] Paystack Dashboard: webhook URL " + new URL("/api/paystack/webhook", appUrl).toString());
} else {
  console.log("[MANUAL] Set APP_URL first; use APP_URL as the Google origin and append /auth/google/callback for the redirect URI.");
  console.log("[MANUAL] Register APP_URL/api/paystack/webhook in Paystack after the host is reachable over HTTPS.");
}
console.log("[MANUAL] Verify the sender domain in Resend by publishing its SPF/DKIM records; then confirm the sender is marked verified.");
console.log("[MANUAL] Test Google OAuth and Paystack in their test modes, then configure production credentials and live webhooks separately.");
console.log("[MANUAL] Confirm the selected host has persistent disk mounted at the directory containing DATABASE_PATH and take a backup.");
console.log("\nThis check reads local settings only. It does not contact providers, verify DNS, or register webhooks.");
if (missing) {
  console.log(missing + " local configuration item(s) need attention.");
  process.exitCode = 1;
} else {
  console.log("Local configuration checks pass. Complete the manual dashboard and release checks above before launch.");
}
