import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PaystackProvider } from "../payment-provider.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tempDir = await mkdtemp(path.join(os.tmpdir(), "cognify-smoke-"));
const dbPath = path.join(tempDir, "smoke.sqlite");
const capturePath = path.join(tempDir, "provider-capture.json");
const smokeSecret = "sk_test_cognify_smoke_only_do_not_use_for_payments";

async function unusedPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookiePair(response, name) {
  const headers = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  const header = headers.find((item) => item.startsWith(name + "=")) || "";
  return header.split(";", 1)[0];
}

function combineCookies(...cookies) { return cookies.filter(Boolean).join("; "); }

async function readCapture() {
  try { return JSON.parse(await readFile(capturePath, "utf8")); }
  catch { return { emails: [], nonce: "" }; }
}

async function writeCapture(value) { await writeFile(capturePath, JSON.stringify(value)); }

function tokenFromMail(message, param) {
  const match = message?.text?.match(new RegExp("[?#]" + param + "=([a-f0-9]{64})", "i"));
  assert(match, "Mock email did not contain a " + param + " link.");
  return match[1];
}

const port = await unusedPort();
const origin = "http://127.0.0.1:" + port;
const env = {
  ...process.env,
  NODE_ENV: "test",
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--import=./scripts/provider-mocks.mjs"].filter(Boolean).join(" "),
  PORT: String(port), HOST: "127.0.0.1", TRUST_PROXY: "true", COOKIE_SECURE: "false",
  APP_URL: origin, PUBLIC_APP_URL: "", GOOGLE_REDIRECT_URI: "",
  GOOGLE_CLIENT_ID: "smoke-google-client", GOOGLE_CLIENT_SECRET: "smoke-google-secret",
  GROQ_API_KEY: "smoke-groq-key", GROQ_MODEL: "smoke-model",
  EMAIL_PROVIDER: "resend", RESEND_API_KEY: "smoke-resend-key", EMAIL_FROM: "Cognify <hello@example.test>",
  PAYMENT_PROVIDER: "paystack", PAYSTACK_MODE: "test", PAYSTACK_SECRET_KEY: smokeSecret, PAYSTACK_PLAN_CODE: "",
  ADMIN_EMAIL: "smoke-admin@example.com", ADMIN_ACCESS_KEY: "cognify-smoke-admin-key-0123456789abcdef",
  FREE_USAGE_LIMIT: "15", PREMIUM_PRICE_NGN: "3200", DATABASE_PATH: dbPath,
  SKIP_LEGACY_ACCOUNT_IMPORT: "true", SMOKE_CAPTURE_PATH: capturePath, ALLOW_PRODUCTION_TEST_EMAIL: "false"
};
let serverProcess;
let stdout = "";
let stderr = "";

async function waitForHealth() {
  const end = Date.now() + 12_000;
  let lastResult = "no response";
  while (Date.now() < end) {
    if (serverProcess.exitCode !== null) throw new Error("Server exited during startup.");
    try {
      const response = await fetch(origin + "/healthz", { headers: { "X-Forwarded-Proto": "https" }, signal: AbortSignal.timeout(500) });
      lastResult = "HTTP " + response.status + ": " + await response.text();
      if (response.status === 200) return;
    } catch (error) { lastResult = error.name + ": " + error.message + (error.cause?.code ? " (" + error.cause.code + ")" : ""); }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Server did not become healthy within 12 seconds (" + lastResult + ").");
}

async function call(route, { method = "GET", cookie = "", body, headers = {}, redirect = "manual" } = {}) {
  const requestHeaders = { Origin: origin, "X-Forwarded-Proto": "https", ...headers };
  if (cookie) requestHeaders.Cookie = cookie;
  const options = { method, headers: requestHeaders, redirect, signal: AbortSignal.timeout(10_000) };
  if (body !== undefined) {
    requestHeaders["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(origin + route, options);
  const text = await response.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch {}
  return { response, json, text };
}

async function signupAndVerify(email, name) {
  const signup = await call("/api/auth/signup", { method: "POST", body: { email, name, password: "smoke-password-123", level: "simple" } });
  assert(signup.response.status === 201 && signup.json.verificationEmailStatus === "sent", "Signup did not queue a verification email.");
  const capture = await readCapture();
  const token = tokenFromMail(capture.emails.at(-1), "verifyEmail");
  const verification = await call("/api/auth/verify-email", { method: "POST", body: { token } });
  assert(verification.response.status === 200 && verification.json.verified, "Email verification failed.");
}

async function login(email, password) {
  const result = await call("/api/auth/login", { method: "POST", body: { email, password } });
  assert(result.response.status === 200 && result.json.profile, "Login failed for " + email + ".");
  const cookie = cookiePair(result.response, "cognify_session");
  assert(cookie && result.response.headers.get("set-cookie").includes("Secure"), "Login did not set a Secure session cookie behind the trusted proxy.");
  return cookie;
}

async function run() {
  const seedDb = new DatabaseSync(dbPath);
  seedDb.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)");
  seedDb.prepare("INSERT INTO app_settings(key,value,updated_at) VALUES('paystack_plan_code','PLN_LEGACY_UNKNOWN',?)").run(new Date().toISOString());
  seedDb.close();
  await writeCapture({ emails: [], nonce: "" });
  const guardedDatabasePath = path.join(tempDir, "must-not-open.sqlite");
  const invalidProduction = spawnSync(process.execPath, ["server.mjs"], {
    cwd: ROOT, encoding: "utf8", timeout: 8_000,
    env: { ...env, NODE_ENV: "production", PORT: "31991", HOST: "0.0.0.0", APP_URL: "http://localhost:31991",
      COOKIE_SECURE: "false", RESEND_API_KEY: "invalid-test-value", EMAIL_FROM: "invalid-sender",
      ADMIN_EMAIL: "invalid-admin", ADMIN_ACCESS_KEY: "short", DATABASE_PATH: guardedDatabasePath,
      SKIP_LEGACY_ACCOUNT_IMPORT: "true", NODE_OPTIONS: "" }
  });
  assert(invalidProduction.status !== 0 && invalidProduction.stderr.includes("Cognify startup configuration is invalid")
    && !existsSync(guardedDatabasePath), "Production configuration was not rejected before the database opened.");
  console.log("PASS invalid production configuration fails before opening SQLite.");

  serverProcess = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  serverProcess.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-6000); });
  serverProcess.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-6000); });
  await waitForHealth();
  console.log("PASS /healthz responds and can query SQLite.");
  const proxyHealth = await fetch(origin + "/healthz", { headers: { "X-Forwarded-Proto": "https" } });
  assert(proxyHealth.headers.get("strict-transport-security")?.includes("max-age="), "Trusted HTTPS proxy protocol did not enable HSTS.");
  assert(new PaystackProvider("sk_live_smoke_only", "live", false).configured === false
    && new PaystackProvider("sk_test_smoke_only", "test", false).configured === true
    && new PaystackProvider("sk_test_smoke_only", "test", true).configured === false,
  "Paystack key mode guard did not isolate live and test credentials.");
  console.log("PASS trusted-proxy HTTPS handling, Secure cookies, HSTS, and Paystack key-mode isolation.");

  await signupAndVerify("smoke-admin@example.com", "Smoke Admin");
  let adminSession = await login("smoke-admin@example.com", "smoke-password-123");
  const resetRequest = await call("/api/auth/request-password-reset", { method: "POST", body: { email: "smoke-admin@example.com" } });
  assert(resetRequest.response.status === 200, "Password reset request failed.");
  let capture = await readCapture();
  const resetToken = tokenFromMail(capture.emails.at(-1), "resetPassword");
  const reset = await call("/api/auth/reset-password", { method: "POST", body: { token: resetToken, password: "smoke-password-456" } });
  assert(reset.response.status === 200, "Password reset completion failed.");
  adminSession = await login("smoke-admin@example.com", "smoke-password-456");
  console.log("PASS signup, verification email, password reset, and re-login with mock Resend.");

  const start = await fetch(origin + "/auth/google/start", { headers: { "X-Forwarded-Proto": "https" }, redirect: "manual" });
  assert(start.status === 303, "Google sign-in did not start with a redirect.");
  const stateCookie = cookiePair(start, "cognify_google_oauth");
  const authUrl = new URL(start.headers.get("location"));
  assert(authUrl.searchParams.get("redirect_uri") === origin + "/auth/google/callback", "Google callback URI was not derived from APP_URL.");
  const oauthState = JSON.parse(Buffer.from(stateCookie.split("=", 2)[1], "base64url").toString("utf8"));
  capture = await readCapture();
  capture.nonce = oauthState.nonce;
  await writeCapture(capture);
  const callback = new URL("/auth/google/callback", origin);
  callback.searchParams.set("code", "smoke-google-code");
  callback.searchParams.set("state", authUrl.searchParams.get("state"));
  const googleCallback = await fetch(callback, { headers: { Cookie: stateCookie, "X-Forwarded-Proto": "https" }, redirect: "manual" });
  assert(googleCallback.status === 303, "Mock Google callback did not finish.");
  const googleSession = cookiePair(googleCallback, "cognify_session");
  const googleProfile = await call("/api/auth/session", { cookie: googleSession });
  assert(googleProfile.response.status === 200 && googleProfile.json.profile?.email === "google-smoke@example.com", "Google sign-in did not create a session.");
  console.log("PASS Google OAuth state, nonce, ID-token signature, and session flow with mock Google.");

  const deniedOverview = await call("/api/admin/overview", { cookie: googleSession });
  const deniedUnlock = await call("/api/admin/unlock", { method: "POST", cookie: googleSession, body: { key: env.ADMIN_ACCESS_KEY } });
  assert(deniedOverview.response.status === 403 && deniedUnlock.response.status === 403, "A non-admin account reached an admin route.");
  const badUnlock = await call("/api/admin/unlock", { method: "POST", cookie: adminSession, body: { key: "wrong-key" } });
  assert(badUnlock.response.status === 403, "An invalid admin key was accepted.");
  const rateIp = "198.51.100.77";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await call("/api/admin/unlock", { method: "POST", cookie: adminSession, headers: { "X-Forwarded-For": rateIp }, body: { key: "wrong-key" } });
  }
  const rateLimitedAdmin = await call("/api/admin/unlock", { method: "POST", cookie: adminSession, headers: { "X-Forwarded-For": rateIp }, body: { key: "wrong-key" } });
  assert(rateLimitedAdmin.response.status === 429, "Admin unlock attempts were not rate-limited.");
  const unlocked = await call("/api/admin/unlock", { method: "POST", cookie: adminSession, body: { key: env.ADMIN_ACCESS_KEY } });
  const adminGrant = cookiePair(unlocked.response, "cognify_admin");
  assert(unlocked.response.status === 200 && adminGrant && unlocked.response.headers.get("set-cookie").includes("HttpOnly")
    && !JSON.stringify(unlocked.json).includes(env.ADMIN_ACCESS_KEY), "Admin unlock did not issue a protected cookie without returning the key.");
  const overview = await call("/api/admin/overview", { cookie: combineCookies(adminSession, adminGrant) });
  assert(overview.response.status === 200, "Unlocked admin account could not view the control room.");
  console.log("PASS admin key unlock, constant-time credential check, and non-admin denial.");

  const tutor = await call("/api/tutor", { method: "POST", cookie: adminSession, body: { message: "Explain fractions in one sentence.", subject: "Mathematics", history: [] } });
  assert(tutor.response.status === 200 && tutor.json.answer?.includes("Mock tutor answer"), "Mock Groq tutor request failed.");
  const upstreamRate = await call("/api/tutor", { method: "POST", cookie: adminSession, body: { message: "smoke-provider-rate-limit", subject: "Mathematics", history: [] } });
  assert(upstreamRate.response.status === 503 && upstreamRate.json.error?.includes("free-tier limit"), "Groq rate-limit error was not handled helpfully.");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const followup = await call("/api/tutor", { method: "POST", cookie: adminSession, body: { message: "A short study question " + attempt, subject: "Mathematics", history: [] } });
    assert(followup.response.status === 200, "Groq follow-up smoke request failed.");
  }
  const localRate = await call("/api/tutor", { method: "POST", cookie: adminSession, body: { message: "one more question", subject: "Mathematics", history: [] } });
  assert(localRate.response.status === 429, "Cognify's AI request rate limit was not enforced.");
  console.log("PASS authenticated Groq response, provider rate-limit handling, and Cognify AI rate limit.");

  const checkout = await call("/api/billing/checkout", { method: "POST", cookie: adminSession, body: {} });
  assert(checkout.response.status === 200 && checkout.json.reference, "Paystack test checkout initialization failed.");
  capture = await readCapture();
  assert(capture.planCreated && capture.planCodeUsed === "PLN_SMOKE_TEST", "Checkout reused an untagged plan code from another Paystack mode.");
  const rawEvent = JSON.stringify({ event: "charge.success", data: {
    reference: checkout.json.reference,
    subscription: { subscription_code: "SUB_SMOKE_TEST" },
    customer: { email: "smoke-admin@example.com" }, amount: 320000, currency: "NGN"
  } });
  const signature = createHmac("sha512", smokeSecret).update(rawEvent).digest("hex");
  const webhookStart = Date.now();
  const webhook = await fetch(origin + "/api/paystack/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": signature }, body: rawEvent
  });
  assert(webhook.status === 200 && Date.now() - webhookStart < 1500, "Signed webhook was not acknowledged quickly.");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const status = await call("/api/billing/status", { cookie: adminSession });
    if (status.json.billing?.plan === "premium") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const duplicate = await fetch(origin + "/api/paystack/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": signature }, body: rawEvent
  });
  assert(duplicate.status === 200, "Duplicate webhook delivery was not acknowledged.");
  await new Promise((resolve) => setTimeout(resolve, 150));
  const billing = await call("/api/billing/status", { cookie: adminSession });
  const history = await call("/api/billing/history", { cookie: adminSession });
  const succeeded = history.json.payments?.filter((payment) => payment.status === "succeeded") || [];
  assert(billing.json.billing?.plan === "premium" && succeeded.length === 1, "Webhook did not grant Premium exactly once.");
  const badSignature = await fetch(origin + "/api/paystack/webhook", {
    method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": "0".repeat(128) }, body: rawEvent
  });
  assert(badSignature.status === 401, "Webhook accepted an invalid signature.");
  console.log("PASS Paystack test checkout, raw-body signature, quick acknowledgement, verified Premium grant, and duplicate delivery idempotency.");

  const backupPath = path.join(tempDir, "backup.sqlite");
  const backup = spawnSync(process.execPath, ["scripts/backup-db.mjs", backupPath], {
    cwd: ROOT, env: { ...env, DATABASE_PATH: dbPath }, encoding: "utf8", timeout: 15_000
  });
  assert(backup.status === 0 && backup.stdout.includes("integrity-checked"), "SQLite backup helper did not create and validate a snapshot: " + (backup.stderr || backup.stdout));
  console.log("PASS online SQLite backup snapshot and integrity check.");
  console.log("All local smoke flows passed. External provider behavior still needs a staging check with test credentials.");
}

try {
  await run();
} catch (error) {
  console.error("Smoke test failed: " + (error?.message || "unexpected error"));
  if (stdout.trim()) console.error("Server output:\n" + stdout.trim());
  if (stderr.trim()) console.error("Server errors:\n" + stderr.trim());
  process.exitCode = 1;
} finally {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => serverProcess.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000))
    ]);
  }
  await rm(tempDir, { recursive: true, force: true });
}
