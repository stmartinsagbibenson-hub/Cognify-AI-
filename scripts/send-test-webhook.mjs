import "../env.mjs";
import { createHmac, randomUUID } from "node:crypto";

const target = (process.argv[2] || process.env.APP_URL || process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
const key = process.env.PAYSTACK_SECRET_KEY || "";
if (process.env.NODE_ENV === "production" || process.env.PAYSTACK_MODE !== "test" || !key.startsWith("sk_test_")) {
  console.error("Webhook test requires NODE_ENV other than production, PAYSTACK_MODE=test, and an sk_test_ key.");
  process.exit(2);
}
let url;
try { url = new URL("/api/paystack/webhook", target); }
catch { console.error("Usage: npm run webhook:test -- http://localhost:3000"); process.exit(2); }
const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
  console.error("Use HTTPS for a remote staging URL; plain HTTP is allowed only for localhost.");
  process.exit(2);
}

const raw = JSON.stringify({ event: "cognify.test", data: { reference: "cognify_test_" + randomUUID() } });
const signature = createHmac("sha512", key).update(raw).digest("hex");
for (let attempt = 1; attempt <= 2; attempt += 1) {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": signature }, body: raw, signal: AbortSignal.timeout(10_000) });
    const body = await response.text();
    if (response.status !== 200) throw new Error("HTTP " + response.status);
    console.log("Signed test webhook delivery " + attempt + ": HTTP 200 (" + (body || "acknowledged") + ").");
  } catch (error) {
    console.error("Test webhook delivery " + attempt + " failed (" + (error.name || "request error") + ").");
    process.exitCode = 1;
    break;
  }
}
