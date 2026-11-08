import { createHmac, timingSafeEqual } from "node:crypto";

const PAYSTACK_API = "https://api.paystack.co";

// Billing code depends on this small interface, so the provider can be replaced without changing entitlements.
export class PaystackProvider {
  constructor(secretKey, mode, production) {
    this.secretKey = secretKey;
    this.mode = mode;
    this.production = production;
    this.keyMode = secretKey.startsWith("sk_test_") ? "test" : secretKey.startsWith("sk_live_") ? "live" : "";
  }
  get configured() {
    return Boolean(this.keyMode && this.keyMode === this.mode && this.keyMode === (this.production ? "live" : "test"));
  }

  async request(path, body) {
    const response = await fetch(PAYSTACK_API + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: "Bearer " + this.secretKey, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.status) {
      const error = new Error("The payment provider could not complete that request.");
      error.status = response.status;
      throw error;
    }
    return result.data;
  }

  createMonthlyPlan(amountMinor) {
    return this.request("/plan", { name: "Cognify Premium Monthly", interval: "monthly", amount: amountMinor, currency: "NGN", send_invoices: true });
  }

  initializeSubscription({ email, planCode, reference, callbackUrl, userId }) {
    return this.request("/transaction/initialize", {
      email,
      plan: planCode,
      reference,
      callback_url: callbackUrl,
      channels: ["card", "bank"],
      metadata: JSON.stringify({ userId, product: "cognify-premium-monthly", custom_filters: { recurring: true } })
    });
  }

  verifyTransaction(reference) {
    return this.request("/transaction/verify/" + encodeURIComponent(reference));
  }

  disableSubscription(subscriptionCode, emailToken) {
    return this.request("/subscription/disable", { code: subscriptionCode, token: emailToken });
  }

  verifyWebhook(rawBody, signature) {
    if (!this.secretKey || typeof signature !== "string" || !/^[a-f0-9]{128}$/i.test(signature)) return false;
    const expected = createHmac("sha512", this.secretKey).update(rawBody).digest();
    const supplied = Buffer.from(signature, "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
}

export function createPaymentProvider() {
  const providerName = (process.env.PAYMENT_PROVIDER || "paystack").toLowerCase();
  if (providerName !== "paystack") throw new Error("Unsupported PAYMENT_PROVIDER. This build supports paystack; add another adapter in payment-provider.mjs to change providers.");
  const secretKey = process.env.PAYSTACK_SECRET_KEY || "";
  const mode = (process.env.PAYSTACK_MODE || "").toLowerCase();
  const production = process.env.NODE_ENV === "production";
  const keyMode = secretKey.startsWith("sk_test_") ? "test" : secretKey.startsWith("sk_live_") ? "live" : "";
  if (!keyMode) console.warn("Paystack is disabled: PAYSTACK_SECRET_KEY is missing or has an unrecognized format.");
  else if (!mode || !["test", "live"].includes(mode)) console.warn("Paystack is disabled: set PAYSTACK_MODE explicitly to test or live.");
  else if (mode !== keyMode) console.warn("Paystack is disabled: PAYSTACK_MODE does not match the configured key type.");
  if (!production && keyMode === "live") console.warn("Paystack live key detected outside production; checkout and webhook processing are disabled. Use a test key for validation.");
  if (production && keyMode === "test") console.warn("WARNING: Paystack is using a test key in production. Payment features are disabled until a live key and PAYSTACK_MODE=live are configured.");
  return new PaystackProvider(secretKey, mode, production);
}
