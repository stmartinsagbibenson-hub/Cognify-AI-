const RESEND_API = "https://api.resend.com/emails";

// Keep account email delivery behind a small adapter so another provider can be added later.
export class ResendEmailProvider {
  constructor(apiKey, fromAddress) {
    this.apiKey = apiKey;
    this.fromAddress = fromAddress;
  }

  get configured() { return Boolean(this.apiKey && this.fromAddress); }

  async send(message) {
    if (!this.configured) return { sent: false, status: "not_configured" };
    const response = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + this.apiKey,
        "Content-Type": "application/json",
        ...(message.idempotencyKey ? { "Idempotency-Key": message.idempotencyKey } : {})
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text
      }),
      signal: AbortSignal.timeout(10_000)
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || typeof result?.id !== "string") {
      const error = new Error("The email provider did not accept the message.");
      error.status = response.status;
      throw error;
    }
    return { sent: true, id: result.id, status: "sent" };
  }
}

export function createEmailProvider() {
  const providerName = (process.env.EMAIL_PROVIDER || "resend").toLowerCase();
  if (providerName !== "resend") throw new Error("Unsupported EMAIL_PROVIDER. This build supports resend; add another adapter in email-provider.mjs to change providers.");
  return new ResendEmailProvider(process.env.RESEND_API_KEY || "", process.env.EMAIL_FROM || "");
}
