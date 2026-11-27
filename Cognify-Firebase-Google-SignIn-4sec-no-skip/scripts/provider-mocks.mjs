import { createSign, generateKeyPairSync } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "cognify-smoke-key";
jwk.alg = "RS256";
jwk.use = "sig";

async function readCapture() {
  try { return JSON.parse(await readFile(process.env.SMOKE_CAPTURE_PATH, "utf8")); }
  catch { return { emails: [], nonce: "" }; }
}

async function saveEmail(message) {
  const capture = await readCapture();
  capture.emails.push(message);
  await writeFile(process.env.SMOKE_CAPTURE_PATH, JSON.stringify(capture));
}

async function signedGoogleToken() {
  const capture = await readCapture();
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: jwk.kid })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({
    iss: "https://accounts.google.com",
    aud: "smoke-google-client",
    sub: "cognify-smoke-google-user",
    email: "google-smoke@example.com",
    email_verified: true,
    name: "Google Smoke Student",
    nonce: capture.nonce,
    iat: now,
    exp: now + 600
  })).toString("base64url");
  const message = header + "." + claims;
  const signer = createSign("RSA-SHA256");
  signer.update(message);
  return message + "." + signer.sign(privateKey).toString("base64url");
}

const jsonResponse = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const body = typeof options.body === "string" ? options.body : "";

  if (url.hostname === "api.resend.com" && url.pathname === "/emails") {
    await saveEmail(JSON.parse(body));
    return jsonResponse({ id: "email_smoke_accepted" });
  }
  if (url.hostname === "api.groq.com" && url.pathname === "/openai/v1/responses") {
    if (body.includes("smoke-provider-rate-limit")) return jsonResponse({ error: { code: "rate_limit_exceeded" } }, 429);
    return jsonResponse({ output_text: "Mock tutor answer: break the question into smaller steps." });
  }
  if (url.hostname === "api.paystack.co") {
    if (url.pathname === "/plan") {
      const request = JSON.parse(body);
      const capture = await readCapture();
      capture.planCreated = true;
      await writeFile(process.env.SMOKE_CAPTURE_PATH, JSON.stringify(capture));
      return jsonResponse({ status: true, data: { plan_code: "PLN_SMOKE_TEST", amount: request.amount, currency: request.currency } });
    }
    if (url.pathname === "/transaction/initialize") {
      const request = JSON.parse(body);
      const capture = await readCapture();
      capture.planCodeUsed = request.plan;
      await writeFile(process.env.SMOKE_CAPTURE_PATH, JSON.stringify(capture));
      return jsonResponse({ status: true, data: { authorization_url: "https://checkout.example.test/authorize", reference: request.reference } });
    }
    if (url.pathname.startsWith("/transaction/verify/")) {
      const reference = decodeURIComponent(url.pathname.slice("/transaction/verify/".length));
      const paidAt = new Date().toISOString();
      return jsonResponse({ status: true, data: {
        status: "success", reference, amount: 320000, currency: "NGN", id: "txn_smoke_test",
        paid_at: paidAt, channel: "card", customer: { email: "smoke-admin@example.com", customer_code: "CUS_SMOKE_TEST" },
        subscription: { subscription_code: "SUB_SMOKE_TEST", status: "active", amount: 320000, created_at: paidAt,
          next_payment_date: new Date(Date.now() + 30 * 86_400_000).toISOString(), email_token: "mock-email-token" },
        plan: { plan_code: "PLN_SMOKE_TEST", amount: 320000, currency: "NGN" }
      } });
    }
  }
  if (url.hostname === "www.googleapis.com" && url.pathname === "/oauth2/v3/certs") {
    return jsonResponse({ keys: [jwk] }, 200, { "Cache-Control": "public, max-age=3600" });
  }
  if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
    return jsonResponse({ id_token: await signedGoogleToken() });
  }
  if (url.hostname === "accounts.google.com" || url.hostname === "googleapis.com") {
    return jsonResponse({ error: "Unexpected external request in the smoke test." }, 501);
  }
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return originalFetch(input, options);
  return jsonResponse({ error: "Unexpected external request in the smoke test." }, 501);
};
