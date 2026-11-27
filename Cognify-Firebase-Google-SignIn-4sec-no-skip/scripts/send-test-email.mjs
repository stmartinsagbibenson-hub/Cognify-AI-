import "../env.mjs";
import { randomUUID } from "node:crypto";
import { createEmailProvider } from "../email-provider.mjs";

const recipient = process.argv[2]?.trim();
if (!recipient || !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,63}$/.test(recipient)) {
  console.error("Usage: npm run email:test -- you@yourdomain.com");
  process.exit(2);
}
if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_TEST_EMAIL !== "true") {
  console.error("Test email sending is disabled in production. Set ALLOW_PRODUCTION_TEST_EMAIL=true only for this explicit check, then remove it.");
  process.exit(2);
}

const provider = createEmailProvider();
if (!provider.configured) {
  console.error("Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM first.");
  process.exit(1);
}

try {
  const result = await provider.send({
    to: recipient,
    subject: "Cognify email delivery check",
    idempotencyKey: "cognify-test-email-" + randomUUID(),
    text: "This is a test message to confirm Cognify can send email through Resend.",
    html: "<p>This is a test message to confirm Cognify can send email through Resend.</p>"
  });
  if (!result.sent) throw new Error("Resend did not accept the test message.");
  console.log("Resend accepted a test email for " + recipient + ". Check that inbox and its spam folder.");
} catch (error) {
  console.error("Test email failed (" + (error.status || error.name || "provider error") + "). Check the Resend sender and key settings.");
  process.exitCode = 1;
}
