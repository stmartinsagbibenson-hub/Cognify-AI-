# Cognify

Cognify is a friendly study space for students: a learning dashboard, subject lessons, a daily planner, short practice quizzes, and a step-by-step AI tutor. Free accounts work without a payment method. Premium adds unlimited AI tutoring and AI-generated practice. New profiles verify their email before signing in.

For persistent storage, production environment settings, provider dashboards, and rollback guidance, see [DEPLOYMENT.md](DEPLOYMENT.md). The release smoke checks are tracked in [PRELAUNCH_CHECKLIST.md](PRELAUNCH_CHECKLIST.md).

## Run the app

Cognify uses Node.js 22.13 or later, including its built-in SQLite module. No package installation is needed.

1. Copy `.env.example` to `.env` if it does not already exist.
2. Create a Google OAuth 2.0 Web application client. Add `http://localhost:3000` as an authorized JavaScript origin and `http://localhost:3000/auth/google/callback` as an authorized redirect URI.
3. Add the Google client ID and secret to `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`. Cognify derives the callback URI from `APP_URL`.
4. Add a Groq API key to `GROQ_API_KEY` for live AI answers and generated practice.
5. Start the server with `node server.mjs` (or `npm.cmd start` in PowerShell).
6. Open [http://localhost:3000](http://localhost:3000).

Google sign-in requests only the OpenID Connect `openid email profile` scopes. The server checks Google's signed identity token before creating or linking a Cognify profile. See Google's [OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect) and [web server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server).

Run `npm.cmd run doctor` in PowerShell to check local settings and see the dashboard values derived from `APP_URL`. It never prints secret values and does not contact providers. The production server also requires Resend and admin settings at startup.

Without a Groq key, the dashboard, planner, lessons, and sample quizzes remain available. The tutor shows preview explanations. Without Paystack keys, free accounts work and the pricing page explains that checkout is not configured.

## Email verification and delivery

Signup checks email syntax in the browser and server, then sends a single-use verification link through Resend. The link expires after 24 hours. Unverified profiles cannot sign in; students can request a fresh link from the signup flow. Existing profiles are treated as verified when this migration is applied.

1. Create a [Resend account](https://resend.com/) and add a sending domain you control.
2. Add the DNS records Resend provides and wait until the domain is verified.
3. Create a Resend API key. Put it in `RESEND_API_KEY` in `.env`.
4. Set `EMAIL_FROM` to a sender on that verified domain, for example `Cognify <hello@yourdomain.com>`.
5. Keep `EMAIL_PROVIDER=resend` and restart Cognify. New profile creation is disabled until email delivery is configured.

Resend sends verification and welcome messages through its [email API](https://resend.com/docs/api-reference/emails/send); keep the API key in the server environment and never put it in browser code. Verification tokens are stored as hashes and removed after use or expiry.

Students can request a password reset from the sign-in window. Reset links are single-use, expire after one hour, and signing in is required again on every device after a password change. This uses the same Resend sender configuration.

## Plans and usage

- New accounts start on Free with 15 AI uses every 30 days. One use is a successful tutor answer or one generated practice set. Change the initial value with `FREE_USAGE_LIMIT` or update it later from `/admin`.
- The use limit is checked and reserved in SQLite on the server before an AI request. Successful results are recorded; failed upstream requests release the reservation.
- Premium removes the free AI cap while the subscription is active. A cancellation takes effect at the end of the paid period; provider expiry or a terminal cancellation returns the account to Free.
- The dashboard displays the plan and remaining usage. Use **Plans** at `/pricing` and **My subscription** at `/subscription` to upgrade or manage a subscription.
- The first run creates `data/cognify.sqlite` with users, sessions, subscriptions, payments, usage records, webhook receipts, and settings. Existing `data/accounts.json` accounts and valid sessions are migrated automatically and the original file is kept as a backup.
- The first values of `FREE_USAGE_LIMIT` and `PREMIUM_PRICE_NGN` initialize the database settings. An administrator can change them from `/admin`; those settings persist in SQLite. A changed Premium price creates a new Paystack plan for future subscriptions; current subscribers keep the amount in their existing plan.

## Paystack setup

Cognify uses Paystack for hosted checkout so the app never receives or stores raw card numbers. Paystack supports cards across its markets; Nigerian Verve cards and bank direct debit are available where enabled for the merchant and customer. Subscription renewals use recurring card or eligible Nigerian bank-debit authorization. Availability depends on your Paystack account and enabled payment channels. See Paystack’s [subscription guide](https://paystack.com/docs/payments/subscriptions/) and [payment channels](https://paystack.com/docs/payments/payment-channels/).

1. **Create and activate a Paystack merchant account.** Register your business on [Paystack](https://paystack.com/) and complete the verification steps required for live collections.
2. **Get API keys.** In the Paystack Dashboard, open **Settings → API Keys & Webhooks**. Copy the **test secret key** first and put it in `PAYSTACK_SECRET_KEY` in your private `.env`, with `PAYSTACK_MODE=test`. Never place a secret key in browser code or share it. Cognify reads this key on the server and disables live keys outside production.
3. **Set the webhook URL.** Make Cognify reachable over HTTPS, then enter `https://YOUR_DOMAIN/api/paystack/webhook` in the Paystack test-mode webhook setting. Use the same endpoint in live mode after activation. Enable subscription and transaction events, especially `charge.success`, `subscription.create`, `subscription.not_renew`, `subscription.disable`, `invoice.payment_failed`, and `charge.failed`; enable refund events if you use Paystack refunds. Paystack signs each webhook with its secret key, and Cognify verifies the signature against the original request body before processing it. Localhost cannot receive provider webhooks; for local checkout work, use a secure public tunnel and set `APP_URL` to its HTTPS origin.
4. **Create the monthly Premium plan.** Cognify creates a monthly NGN plan on Paystack using `PREMIUM_PRICE_NGN` the first time an authenticated user starts checkout. You can also create a monthly NGN plan in the dashboard and set its plan code in `PAYSTACK_PLAN_CODE` before the first app start. Make sure the plan amount matches the configured price. If an administrator changes the price later, Cognify creates a new plan automatically for future signups.
5. **Test in sandbox mode.** Keep Paystack in Test Mode and use a test secret key. Complete checkout with Paystack’s current [test cards and payment instructions](https://paystack.com/docs/payments/test-payments/). Confirm that the webhook endpoint is reachable and returns HTTP 200. The browser return page only displays provider-verified status; Premium is granted by the signed server webhook, not by a browser success message.
6. **Switch to live payments.** Finish Paystack account activation, use your HTTPS production domain in `APP_URL`, set `COOKIE_SECURE=true`, configure the live webhook endpoint in the live dashboard, and set `PAYSTACK_MODE=live` with the live secret key. Clear `PAYSTACK_PLAN_CODE` or use a live-mode plan code: test and live plans are separate. Validate checkout and webhook behavior in test mode before launch; do not use live credentials for testing or run a live checkout as a smoke test.

The provider adapter is in `payment-provider.mjs`; entitlements, usage accounting, payment history, and subscriptions are provider-independent SQLite records. A replacement provider can implement the adapter interface without replacing the app’s access-control logic.

## Admin access

Create the admin sign-in account while Cognify is still private, set `ADMIN_EMAIL` in the host's secret settings, and set `ADMIN_ACCESS_KEY` to a private random secret (for example, generate 32 random bytes with `openssl rand -hex 32`). Restart the server, sign in with that account, open `/admin`, and enter the key. Cognify checks it with a constant-time comparison, rate-limits unlock attempts, clears the field after submission, and uses a short-lived HttpOnly grant cookie for admin requests. The admin page shows users, plans, usage, subscription state, payment history, active subscriptions, and suspend/restore controls. Keep `.env` and the database private and back up the database securely.

For backup, migration, rollback, provider test scripts, and Docker deployment, use [DEPLOYMENT.md](DEPLOYMENT.md).

## Existing app features

- Responsive desktop and mobile student dashboard
- Personalized subject cards with selections across science, arts and humanities, and commercial and finance subjects
- AI tutor chat with subject and explanation-level preferences
- Five-question practice rounds with Groq-generated questions and built-in samples as fallback
- Editable study plan, progress chart, saved display name, and learner settings
- HTTP-only account sessions and salted scrypt password hashes
- Single-use password reset links sent through the configured email provider; resets expire after one hour and sign out existing sessions
- Server-side rate limiting and input validation for AI endpoints

Study-plan checkmarks, custom goals, and chat history stay in the current browser and are separated by account. On first sign-in after this update, an existing student can keep the browser's previous saved study state; a newly created profile starts with an empty plan and chat. These items do not sync across devices.
