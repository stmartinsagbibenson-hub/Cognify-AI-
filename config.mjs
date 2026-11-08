import "./env.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const nodeVersion = process.versions.node.split(".").map(Number);
const nodeSupported = nodeVersion[0] > 22 || (nodeVersion[0] === 22 && nodeVersion[1] >= 13);

export const isProduction = process.env.NODE_ENV === "production";
export const port = Number(process.env.PORT || 3000);
export const host = process.env.HOST?.trim() || (isProduction ? "0.0.0.0" : "127.0.0.1");
export const databasePath = path.resolve(ROOT, process.env.DATABASE_PATH || "data/cognify.sqlite");
export const appUrl = process.env.APP_URL?.trim() || process.env.PUBLIC_APP_URL?.trim() || "";
export const trustProxy = process.env.TRUST_PROXY === "true";

export function parsedAppUrl() {
  try {
    const url = new URL(appUrl);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,63}$/.test(value || "");
}

function validSender(value) {
  const match = String(value || "").trim().match(/^(?:[^<>\r\n]*<)?([^<>\s]+@[^<>\s]+)(?:>)?$/);
  if (!match || !validEmail(match[1])) return false;
  const domain = match[1].split("@").at(-1).toLowerCase();
  return domain !== "example.com" && !domain.endsWith(".example") && !domain.endsWith(".test");
}

export function validateStartupConfig() {
  const issues = [];
  if (!nodeSupported) issues.push("Install Node.js 22.13 or later.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) issues.push("Set PORT to an integer from 1 to 65535.");
  if (process.env.TRUST_PROXY && !["true", "false"].includes(process.env.TRUST_PROXY)) {
    issues.push("Set TRUST_PROXY to true or false.");
  }
  if (isProduction) {
    if (!process.env.APP_URL?.trim()) issues.push("Set APP_URL to the public site origin; PUBLIC_APP_URL is a deprecated compatibility alias.");
    if (process.env.SKIP_LEGACY_ACCOUNT_IMPORT === "true") issues.push("Unset SKIP_LEGACY_ACCOUNT_IMPORT in production.");
    const publicUrl = parsedAppUrl();
    if (!publicUrl || publicUrl.protocol !== "https:") issues.push("Set APP_URL to the HTTPS origin of the production site.");
    if (publicUrl && process.env.GOOGLE_REDIRECT_URI
      && process.env.GOOGLE_REDIRECT_URI.trim() !== new URL("/auth/google/callback", publicUrl).toString()) {
      issues.push("Remove GOOGLE_REDIRECT_URI or update it to match APP_URL; Cognify derives the callback URL from APP_URL.");
    }
    if (host === "127.0.0.1" || host === "localhost" || host === "::1") issues.push("Set HOST=0.0.0.0 so the production host can reach Cognify.");
    if (process.env.COOKIE_SECURE !== "true") issues.push("Set COOKIE_SECURE=true for production HTTPS cookies.");
    if ((process.env.EMAIL_PROVIDER || "resend").toLowerCase() !== "resend"
      || !process.env.RESEND_API_KEY?.trim() || !validSender(process.env.EMAIL_FROM)) {
      issues.push("Configure EMAIL_PROVIDER=resend, RESEND_API_KEY, and EMAIL_FROM using an address on your verified sending domain.");
    }
    if (!validEmail(process.env.ADMIN_EMAIL) || (process.env.ADMIN_ACCESS_KEY || "").length < 32) {
      issues.push("Set a valid ADMIN_EMAIL and an ADMIN_ACCESS_KEY of at least 32 characters.");
    }
    if (!process.env.GOOGLE_CLIENT_ID?.trim() || !process.env.GOOGLE_CLIENT_SECRET?.trim()) {
      issues.push("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for production sign-in.");
    }
    if (!process.env.GROQ_API_KEY?.trim()) issues.push("Set GROQ_API_KEY to enable the production tutor and generated practice.");
  }
  if (issues.length) throw new Error("Cognify startup configuration is invalid:\n- " + issues.join("\n- "));
}

validateStartupConfig();
