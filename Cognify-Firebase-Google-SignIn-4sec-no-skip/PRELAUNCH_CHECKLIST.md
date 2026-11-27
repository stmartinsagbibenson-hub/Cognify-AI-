# Cognify prelaunch checklist

Update the Result column after each run. The automated local smoke suite uses isolated temporary SQLite storage and mocked providers; it never reads the existing `data/accounts.json`, sends email, calls Groq/Google, or contacts Paystack. A mock pass does not replace provider-mode staging checks.

## Local checks

| Check | Result | Evidence / next action |
| --- | --- | --- |
| Node.js 22.13+ and package engine | PASS | Runtime is Node 24.19.0; `package.json` declares `>=22.13` and startup enforces it. |
| Config doctor | NEEDS | `npm.cmd run doctor` reports 5 local gaps: canonical `APP_URL`, Resend, admin credentials, the old Google callback override, and a local Paystack live-key/mode mismatch. No secret values were printed. |
| Production startup validation | PASS | Smoke test confirms invalid production settings fail before SQLite opens. |
| `/healthz` and database query | PASS | `npm.cmd run smoke`; response contains no database or secret details. |
| Signup and verification email | PASS (mock) | Mock Resend accepts the message; the smoke test extracts and consumes the single-use token. |
| Password reset | PASS (mock) | Mock Resend reset link is consumed; old password is replaced and new sign-in succeeds. |
| Google sign-in | PASS (mock) | Mock Google validates state, nonce, signature, audience, callback derived from `APP_URL`, and cookie session. Production OAuth still requires Google Console verification. |
| Non-admin blocked from admin routes | PASS | Smoke test attempts admin overview and unlock as a non-admin profile. |
| Admin unlock and throttling | PASS | Smoke test rejects a wrong key, rate-limits repeated failures, and accepts the configured test key into a short-lived HttpOnly cookie without returning the key. |
| AI tutor and rate limits | PASS (mock) | Mock Groq response, upstream 429 handling, and Cognify's own AI request limit all passed. Real Groq access remains a staging check. |
| AI flashcards and account sync | NOT VERIFIED | Check Groq generation, edit/select/save, first-login migration, review updates, and deck restore on a second browser session. |
| Paystack test checkout | PASS (mock) | Mock test-mode initialization returns a checkout reference; a saved plan without the active mode is ignored and replaced. No live key is used. |
| Signed webhook and duplicate delivery | PASS (mock) | Test checks HMAC SHA512 over raw JSON, quick HTTP 200, invalid-signature rejection, webhook-confirmed Premium access, and exactly one successful payment after duplicate delivery. |
| SQLite backup | PASS | Smoke test runs `VACUUM INTO` and checks the snapshot with `PRAGMA integrity_check`. |
| Docker build and runtime | NOT VERIFIED | Docker CLI is not installed in this environment. Build after choosing the host; mount `/app/data` and supply required production secrets. |

## Provider and production checks

| Check | Result | Owner action |
| --- | --- | --- |
| Resend verified sender | Pending | Add the domain's SPF/DKIM records, wait for Resend verification, set `EMAIL_FROM`, and send a test to an owner-selected inbox. |
| Real signup and reset delivery | Pending | Repeat signup, verification, and password reset in staging with the real Resend sender. |
| Google production OAuth | Pending | Add the exact `APP_URL` origin and `APP_URL/auth/google/callback` redirect in Google Cloud Console; test a real account. |
| Groq production request | Pending | Use a staging key and verify tutor, practice, and flashcard generation plus an upstream error/rate-limit response. |
| Paystack TEST checkout | Pending | Set `PAYSTACK_MODE=test` with an `sk_test_...` key, register the staging webhook, complete a test checkout, and verify Premium is granted by the webhook. Deliver the same event twice. |
| Live Paystack configuration | Pending | After staging passes and the merchant is activated, set `PAYSTACK_MODE=live` and the live key only in production, register the live webhook and plan code. Do not use live credentials for testing. |
| Production host and persistent disk | Pending | Choose a host, mount a writable persistent disk at the `DATABASE_PATH` parent, and keep one app instance. |
| Database migration | Pending | Back up first; decide whether to migrate existing real accounts or keep a fresh production database. Do not copy test accounts or subscriptions unintentionally. |
| Backup restore | Pending | Restore a snapshot to a non-production copy and verify integrity and an owner-approved account check. |
| HTTPS, cookies, and proxy | Pending | Set `APP_URL=https://...`, `COOKIE_SECURE=true`; set `TRUST_PROXY=true` only if the trusted proxy overwrites forwarding headers. Confirm admin/session cookies are Secure and HttpOnly. |
| Browser and responsive pass | Pending | Verify signup/login, tutor/practice/flashcards, cross-device deck sync, pricing, payment return, subscription page, and admin page on current desktop and mobile browsers. |
| Rollback and support readiness | Pending | Keep the prior image/build and database snapshot; record how to restore and reconcile Paystack events. |

## Local commands

```powershell
npm.cmd run doctor
npm.cmd run smoke
npm.cmd run db:backup
```

The local email and webhook helper commands are documented in `DEPLOYMENT.md`. The email helper needs an explicit recipient; the webhook helper requires test-mode credentials and refuses `NODE_ENV=production`.
