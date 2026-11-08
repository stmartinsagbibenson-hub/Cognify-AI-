# Cognify deployment guide

This guide covers the generic Docker image and production setup. Platform-specific configuration is intentionally pending the owner's host choice; Cognify must use one persistent SQLite volume and one running application instance.

## Runtime and environment

Use Node.js 22.13 or later. The `Dockerfile` uses the official Node 22 image and runs the server as the non-root `node` user. The host should route public HTTPS traffic to container port `3000` and mount persistent storage at `/app/data`.

Set these values in the host's secret/environment settings. Do not copy real values into this repository.

| Variable | Production value / purpose |
| --- | --- |
| `NODE_ENV` | `production`; enables production startup validation. |
| `HOST` | `0.0.0.0` so the host can reach the server. |
| `PORT` | The port injected by the host, or `3000`. |
| `APP_URL` | Public HTTPS origin, for example `https://study.example.org`, with no path. OAuth and checkout links derive from it. |
| `DATABASE_PATH` | Persistent volume path, for example `/app/data/cognify.sqlite`. |
| `COOKIE_SECURE` | `true` for HTTPS. |
| `TRUST_PROXY` | Leave `false` unless a trusted proxy overwrites `X-Forwarded-Proto` and `X-Forwarded-For`; set `true` only in that case. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Production OAuth web client values. |
| `GROQ_API_KEY` | Server-side AI key. |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | Use `resend`, a Resend API key, and a sender on the verified domain. |
| `PAYMENT_PROVIDER`, `PAYSTACK_MODE`, `PAYSTACK_SECRET_KEY` | Use `paystack`, `live`, and a live key only in production. A test key is disabled in production. |
| `PAYSTACK_PLAN_CODE` | Optional mode-specific plan code; leave blank to let Cognify create a monthly NGN plan. Cognify stores the mode with a created plan and replaces an untagged/mismatched saved plan before checkout. Never copy a test plan code into production. |
| `ADMIN_EMAIL`, `ADMIN_ACCESS_KEY` | The admin account address and a private key of at least 32 characters. Generate with `openssl rand -hex 32`. |
| `FREE_USAGE_LIMIT`, `PREMIUM_PRICE_NGN` | Initial SQLite settings; the admin page can change them later. |
| `PUBLIC_APP_URL` | Deprecated compatibility alias. Use `APP_URL`. |
| `GOOGLE_REDIRECT_URI` | Deprecated. Cognify derives the callback from `APP_URL`; remove this variable. |
| `ALLOW_PRODUCTION_TEST_EMAIL` | Keep `false`; only temporarily set `true` if the owner explicitly runs the test-email script against production. |
| `SKIP_LEGACY_ACCOUNT_IMPORT` | Keep unset/false in production. It exists only to isolate automated smoke-test databases. |

The application validates required production email, admin, OAuth, AI, HTTPS origin, secure-cookie, runtime, and port settings before opening the database. Production startup requires canonical `APP_URL`; the old `PUBLIC_APP_URL` name is accepted only as a compatibility fallback outside production. Paystack also requires the key prefix and `PAYSTACK_MODE` to match the environment; mismatched payment settings disable checkout and webhook processing without exposing the key.

### Reverse proxy and HTTPS

Terminate TLS at the host or trusted reverse proxy, set `APP_URL` to the public HTTPS origin, and set `COOKIE_SECURE=true`. OAuth callbacks, verification/reset links, and Paystack return URLs come from `APP_URL`, so they do not depend on the internal HTTP connection between proxy and Node.

When `TRUST_PROXY=true`, Cognify uses the first `X-Forwarded-Proto` value for secure-cookie/HSTS decisions and the first valid `X-Forwarded-For` address for rate limits. Only enable it if the proxy removes client-supplied forwarding headers and writes its own. The cookie remains `Secure` whenever `COOKIE_SECURE=true`, even if the internal proxy hop uses HTTP. The app sets HSTS only when the direct TLS connection is encrypted or the trusted forwarded protocol is HTTPS.

## Persistent SQLite storage

Set `DATABASE_PATH` to a writable file beneath the host volume mount. Cognify enables foreign keys, WAL journaling, a 5-second busy timeout, and `synchronous=NORMAL`. Keep exactly one application instance: SQLite WAL files are local to one filesystem and Cognify does not replicate data between hosts. Do not horizontally scale this app. A shared or ephemeral filesystem is not a suitable production database volume.

The generic Docker image uses `/app/data/cognify.sqlite`. Mount the host's persistent disk at `/app/data` and make it writable by the container's `node` user. The `/healthz` endpoint performs a read-only `SELECT 1` and returns only `{"status":"ok"}` or `{"status":"unavailable"}`.

## Backup and restore

Create a consistent SQLite snapshot while Cognify is running:

```powershell
npm.cmd run db:backup
```

The script uses SQLite `VACUUM INTO`, checks the snapshot with `PRAGMA integrity_check`, and writes it beneath `data/backups/`. Copy the resulting file to storage outside the host volume and retain at least one known-good backup before each release. Do not copy just the live `.sqlite` file while the app is writing; WAL changes may still be in `-wal`.

To restore, stop Cognify, keep a copy of the current database, place the selected backup at the configured `DATABASE_PATH`, ensure the parent directory is writable, then start one instance and verify `/healthz` and the owner-approved account/payment checks. Restore can discard changes made after the backup; reconcile payments in the Paystack dashboard before using an older database snapshot.

## Move existing local data

Do this manually; Cognify has not migrated any data to a production host.

1. Keep the local app running and create a snapshot with `npm.cmd run db:backup`.
2. Check that the command reports an integrity-checked snapshot. Store a second copy outside this workspace before transferring it.
3. Decide whether local accounts are real owner/student data or test accounts. Use a separate staging database for tests. If test accounts must be excluded, make that decision on a backup copy before migration; do not delete rows from the only local database.
4. Stop the production service before placing the snapshot at the production `DATABASE_PATH`. Preserve the destination's previous database separately if one exists.
5. Start Cognify with the persistent volume mounted. Check `/healthz`, verify the expected total account count without copying personal email addresses into logs, then sign in with an owner-approved account and review subscription/payment records in the admin page.
6. If the existing `data/accounts.json` file is the only source, Cognify's additive first-run importer reads it from the app's `data/` directory. Keep that file private and make a backup before the first startup. Do not set `SKIP_LEGACY_ACCOUNT_IMPORT=true` outside isolated smoke tests.

## Google OAuth

In Google Cloud Console, configure the production OAuth 2.0 **Web application** client:

- Authorized JavaScript origin: exactly the `APP_URL` origin, for example `https://study.example.org`.
- Authorized redirect URI: exactly `APP_URL/auth/google/callback`, for example `https://study.example.org/auth/google/callback`.

Do not include a trailing slash on the origin. Cognify derives the callback URI from `APP_URL`; remove any old `GOOGLE_REDIRECT_URI` override. Add local/staging origins separately if needed.

## Resend email

1. Create a Resend API key and store it as `RESEND_API_KEY` in the host's secret settings.
2. Add the sending domain in Resend and publish the exact SPF/DKIM DNS records Resend provides.
3. Wait until Resend marks the domain verified; set `EMAIL_FROM` to a sender on that domain.
4. Run `npm.cmd run email:test -- you@yourdomain.com` in a non-production environment and check the inbox and spam folder. The script requires a recipient argument and reports only the result category, not the API key or provider response body.

For an explicit production delivery check only, set `ALLOW_PRODUCTION_TEST_EMAIL=true` temporarily, run the script with the owner's chosen recipient, then remove the variable and restart. Test sends are disabled in production by default.

## Paystack setup and safe validation

1. Use a separate staging configuration with `NODE_ENV=staging`, `PAYSTACK_MODE=test`, and a `sk_test_...` key. Never use the local live key for testing. Cognify refuses to use live keys outside production.
2. Set staging `APP_URL` to its HTTPS address. If testing a local server, use a secure tunnel and set `APP_URL` to the tunnel origin. Set `TRUST_PROXY=true` only if the tunnel/proxy overwrites forwarding headers.
3. In Paystack **Test Mode**, register `https://<staging-domain>/api/paystack/webhook` and enable the transaction/subscription events used by Cognify: `charge.success`, `charge.failed`, `subscription.create`, `subscription.not_renew`, `subscription.disable`, and `invoice.payment_failed`; enable refund events if refunds are used.
4. Complete a Paystack test checkout. Confirm the callback page keeps Premium locked until the signed webhook is processed, then confirm a duplicate delivery does not create another successful payment.
5. `npm.cmd run webhook:test -- https://<staging-domain>` sends the same signed, harmless test event twice and checks for two HTTP 200 acknowledgements. It requires `PAYSTACK_MODE=test` and a `sk_test_...` key and refuses production mode. This checks signature handling/idempotent acknowledgement; the checkout test checks subscription state.
6. After staging passes and the merchant account is activated, configure production with `NODE_ENV=production`, `PAYSTACK_MODE=live`, a live secret key, a live webhook registration at `https://<your-domain>/api/paystack/webhook`, and a live-mode plan code or blank plan setting. Do not run a live checkout as a test. Keep the staging test key and plan code separate from production.

Paystack signs the original webhook body with HMAC SHA512. Cognify verifies the signature before saving the event, acknowledges quickly after persisting it, then processes it from a retryable SQLite queue. The browser return page only displays status; Premium is granted from the signed webhook after transaction verification with Paystack. An explicit `PAYSTACK_PLAN_CODE` is applied when the app starts; if the persisted code has no matching `PAYSTACK_MODE`, Cognify ignores it and creates a fresh plan for the active mode.

## Host choice and platform setup

No host-specific file has been generated yet. Choose one platform first; then host-specific configuration can be added without guessing at the deployment target.

| Option | Fit for Cognify | Tradeoffs and cost awareness |
| --- | --- | --- |
| Render | Simplest managed web-service setup; paid web services can mount a persistent disk and use the generic Dockerfile. | Compute is separate. Persistent disks are currently listed at $0.25/GB/month. Disk-backed services run one instance and deploy with a brief instance swap, so keep Cognify at one instance. [Render disks](https://render.com/docs/disks), [pricing](https://render.com/pricing). |
| Railway | Straightforward Docker deploy with a service volume. | Usage-based CPU/RAM/egress is billed on top of the plan; volumes are currently listed at $0.15/GB/month. Check plan volume limits and set usage alerts. [Railway volumes](https://docs.railway.com/volumes/reference), [pricing plans](https://docs.railway.com/pricing/plans). |
| Fly.io | Docker-based deployment with more control over Machines and regions. | Requires more operations work. Volumes are currently listed at $0.15/GB/month and billed separately from compute; volumes attach one-to-one with Machines and do not automatically replicate. Keep one Machine for SQLite. [Fly volumes](https://docs.fly.io/volumes/overview), [pricing](https://fly.io/docs/about/pricing/). |

Prices and included allowances change; confirm the current plan, compute, storage, backups, and bandwidth costs before creating a paid service. No paid hosting plan has been selected or created.

## Release and rollback

Before each release, run the local checks in `PRELAUNCH_CHECKLIST.md`, create a database snapshot, verify the host health check, and keep the prior container image/build available. To roll back, stop the app before restoring a database snapshot; do not let two app versions write to the same SQLite file simultaneously. If provider events or live transactions arrived after that snapshot, reconcile them with Paystack before restoring database state. No remote deploy or live transaction is performed by these repository changes.
