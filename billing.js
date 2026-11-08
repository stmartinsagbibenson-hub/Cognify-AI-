const byId = (id) => document.getElementById(id);
let viewer = null;
let pricing = null;
const path = window.location.pathname;

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "Cognify couldn't complete that request.");
    error.status = response.status;
    throw error;
  }
  return result;
}
function adminApi(url, options = {}) {
  return api(url, options);
}
function showNotice(message, tone = "info") {
  const region = byId("billingNotice");
  region.textContent = message;
  region.className = "billing-notice" + (tone === "info" ? "" : " " + tone);
  region.hidden = !message;
}
function money(value, currency = "NGN") {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}
function date(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not available";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
function statusLabel(value) {
  const labels = { active: "Active", "non-renewing": "Ends after this period", attention: "Payment needs attention", inactive: "No active subscription", expired: "Expired", cancelled: "Cancelled", completed: "Completed", refunded: "Refunded", pending: "Pending" };
  return labels[String(value || "").toLowerCase()] || String(value || "Pending").replaceAll("_", " ");
}
function textCell(primary, secondary) {
  const cell = document.createElement("td");
  const strong = document.createElement("strong");
  strong.textContent = primary || "—";
  cell.append(strong);
  if (secondary) { const small = document.createElement("small"); small.textContent = secondary; cell.append(small); }
  return cell;
}
function plainCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  return cell;
}
function setRouteView() {
  const page = path === "/admin" ? "adminPage" : path === "/subscription" ? "subscriptionPage" : path.startsWith("/payment/") ? "paymentPage" : "pricingPage";
  byId(page).hidden = false;
  document.querySelector(`[data-nav-${page.replace("Page", "").toLowerCase()}]`)?.classList.add("active");
  document.title = path === "/admin" ? "Cognify admin" : path === "/subscription" ? "Your Cognify subscription" : path.startsWith("/payment/") ? "Payment confirmation · Cognify" : "Cognify plans";
}
function renderPricing(config) {
  pricing = config;
  byId("premiumPrice").textContent = money(config.premiumPriceNgn);
  const free = byId("freeFeatureList");
  const premium = byId("premiumFeatureList");
  free.replaceChildren(...config.freeFeatures.map((item) => makeFeature(item)));
  premium.replaceChildren(...config.premiumFeatures.map((item) => makeFeature(item)));
  const button = byId("upgradeButton");
  if (!viewer) {
    button.textContent = "Sign in to upgrade";
    button.disabled = false;
  } else if (viewer.billing?.plan === "premium") {
    button.textContent = "Manage my subscription";
    button.disabled = false;
  } else if (!config.paymentConfigured) {
    button.textContent = "Checkout is being set up";
    button.disabled = true;
  }
  const freeButton = byId("freePlanButton");
  if (viewer) {
    freeButton.textContent = viewer.billing?.plan === "free" ? "Your current plan" : "Free plan";
    freeButton.href = viewer.billing?.plan === "premium" ? "/subscription" : "/";
  } else { freeButton.href = "/?signup=1&next=%2Fpricing"; }
}
function makeFeature(label) {
  const li = document.createElement("li");
  li.textContent = label;
  return li;
}
function renderSubscription(billing) {
  if (!viewer) {
    byId("currentPlanName").textContent = "Sign in required";
    byId("subscriptionDescription").textContent = "Sign in to see your plan, usage, and receipts.";
    byId("subscriptionUpgrade").textContent = "Go to sign in";
    byId("subscriptionUpgrade").href = "/?signup=0";
    byId("subscriptionUsage").replaceChildren();
    byId("subscriptionDates").replaceChildren();
    byId("paymentHistory").innerHTML = '<p class="empty-state">Sign in to view your payment history.</p>';
    return;
  }
  const premium = billing.plan === "premium";
  byId("currentPlanName").textContent = premium ? "Premium" : "Free";
  const status = byId("subscriptionStatus");
  status.textContent = billing.suspended ? "Access paused" : statusLabel(premium ? billing.subscriptionStatus : "inactive");
  status.className = "status-pill " + (billing.suspended ? "status-attention" : premium ? (billing.subscriptionStatus === "attention" ? "status-attention" : "status-active") : "status-free");
  byId("subscriptionDescription").textContent = billing.suspended
    ? (billing.suspensionReason || "Your Cognify access has been paused by an administrator.")
    : premium ? "You have full access to Cognify’s AI learning features." : "Your account is on the free plan. Upgrade any time for unlimited AI learning.";
  const usage = byId("subscriptionUsage");
  const usedTile = document.createElement("div"); usedTile.className = "usage-tile";
  const usedLabel = document.createElement("span"); usedLabel.textContent = "AI sessions used";
  const usedValue = document.createElement("strong"); usedValue.textContent = premium ? String(billing.usageUsed) + " this period" : billing.usageUsed + " / " + billing.usageLimit;
  usedTile.append(usedLabel, usedValue);
  const remainingTile = document.createElement("div"); remainingTile.className = "usage-tile";
  const remainingLabel = document.createElement("span"); remainingLabel.textContent = premium ? "Plan access" : "Free sessions left";
  const remainingValue = document.createElement("strong"); remainingValue.textContent = premium ? "Unlimited" : String(billing.usageRemaining);
  remainingTile.append(remainingLabel, remainingValue);
  usage.replaceChildren(usedTile, remainingTile);
  const dates = byId("subscriptionDates");
  dates.replaceChildren();
  if (premium) {
    dates.append(dateRow(billing.cancelAtPeriodEnd ? "Access ends" : "Next renewal", date(billing.subscriptionExpiresAt)));
    dates.append(dateRow("Started", date(billing.subscriptionStartedAt)));
  } else {
    dates.append(dateRow("Usage resets", date(billing.usageResetAt)));
    dates.append(dateRow("Premium price", pricing ? money(pricing.premiumPriceNgn) + " / month" : "Loading…"));
  }
  byId("subscriptionUpgrade").textContent = premium ? "View plan details" : "Upgrade to Premium";
  byId("subscriptionUpgrade").href = "/pricing";
  const cancel = byId("cancelSubscription");
  cancel.hidden = !premium || billing.cancelAtPeriodEnd || !billing.subscriptionExpiresAt;
  byId("cancelNote").hidden = !premium || !billing.cancelAtPeriodEnd;
}
function dateRow(label, value) {
  const row = document.createElement("div");
  const name = document.createElement("span"); name.textContent = label;
  const time = document.createElement("strong"); time.textContent = value;
  row.append(name, time); return row;
}
function renderPayments(items, target = byId("paymentHistory")) {
  target.replaceChildren();
  if (!items?.length) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = "No payments yet."; target.append(empty); return; }
  for (const payment of items) {
    const row = document.createElement("div"); row.className = "payment-row";
    const amount = document.createElement("strong"); amount.textContent = money(Number(payment.amountMinor) / 100, payment.currency);
    const created = document.createElement("span"); created.textContent = date(payment.paidAt || payment.createdAt);
    const status = document.createElement("span"); status.className = "payment-status " + (payment.status === "succeeded" ? "succeeded" : ["failed", "refunded"].includes(payment.status) ? payment.status : ""); status.textContent = statusLabel(payment.status);
    row.append(amount, created, status); target.append(row);
  }
}
async function loadSubscription() {
  if (!viewer) { renderSubscription(null); return; }
  const [status, history] = await Promise.all([api("/api/billing/status"), api("/api/billing/history")]);
  viewer.billing = status.billing;
  renderSubscription(status.billing);
  renderPayments(history.payments);
}
function renderAdmin(data) {
  byId("adminGate").hidden = true;
  byId("adminDenied").hidden = true;
  byId("adminContent").hidden = false;
  byId("adminFreeLimit").value = data.settings.freeUsageLimit;
  byId("adminPremiumPrice").value = data.settings.premiumPriceNgn;
  byId("userCount").textContent = String(data.users.length) + " accounts";
  const users = byId("usersTable"); users.replaceChildren();
  for (const user of data.users) {
    const row = document.createElement("tr");
    row.append(textCell(user.name, user.email));
    row.append(plainCell(user.plan.toUpperCase()));
    row.append(plainCell(user.plan === "premium" ? String(user.usageUsed) + " used" : user.usageUsed + " / " + data.settings.freeUsageLimit));
    row.append(plainCell(statusLabel(user.subscriptionStatus)));
    row.append(plainCell(user.suspendedAt ? "Paused" : "Active"));
    const actionCell = document.createElement("td");
    const action = document.createElement("button"); action.className = "table-action " + (user.suspendedAt ? "restore" : "suspend"); action.textContent = user.suspendedAt ? "Restore" : "Suspend";
    action.addEventListener("click", () => changeUserAccess(user));
    actionCell.append(action); row.append(actionCell); users.append(row);
  }
  const subscriptions = byId("subscriptionsTable"); subscriptions.replaceChildren();
  for (const item of data.activeSubscriptions) {
    const row = document.createElement("tr");
    row.append(textCell(item.name, item.email)); row.append(plainCell(statusLabel(item.status)));
    row.append(plainCell(money(Number(item.amountMinor) / 100, item.currency) + " / month")); row.append(plainCell(date(item.expiresAt))); subscriptions.append(row);
  }
  if (!data.activeSubscriptions.length) subscriptions.append(emptyTableRow(4, "No active subscriptions yet."));
  const payments = byId("adminPaymentsTable"); payments.replaceChildren();
  for (const item of data.payments) {
    const row = document.createElement("tr");
    row.append(textCell(item.name, item.email)); row.append(plainCell(item.reference));
    row.append(plainCell(money(Number(item.amountMinor) / 100, item.currency))); row.append(plainCell(statusLabel(item.status)));
    row.append(plainCell(date(item.paidAt || item.createdAt))); payments.append(row);
  }
  if (!data.payments.length) payments.append(emptyTableRow(5, "No payment records yet."));
}
function emptyTableRow(span, message) {
  const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = span; cell.textContent = message; cell.className = "empty-state"; row.append(cell); return row;
}
async function changeUserAccess(user) {
  const action = user.suspendedAt ? "restore" : "suspend";
  let reason = "";
  if (action === "suspend") reason = window.prompt("Why is this account being paused?", "Manually paused by an administrator.") || "";
  if (action === "suspend" && !reason.trim()) return;
  try {
    await adminApi("/api/admin/users/" + encodeURIComponent(user.id) + "/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
    await loadAdmin(); showNotice(action === "suspend" ? "Account access paused." : "Account access restored.", "success");
  } catch (error) { showNotice(error.message, "error"); }
}
async function loadAdmin() {
  try { renderAdmin(await adminApi("/api/admin/overview")); }
  catch (error) {
    byId("adminContent").hidden = true;
    byId("adminGate").hidden = false;
    byId("adminDenied").textContent = error.status === 403 ? "Sign in with the configured admin account, then unlock the control room." : error.message;
    byId("adminDenied").hidden = false;
  }
}
function setPaymentResult(state, message) {
  const icon = byId("paymentResultIcon");
  const title = byId("paymentResultTitle");
  const description = byId("paymentResultMessage");
  const action = byId("paymentResultAction");
  const retry = byId("paymentRetryLink");
  icon.className = "payment-result-icon" + (state === "success" ? " success" : state === "failure" ? " failed" : "");
  icon.textContent = state === "success" ? "✓" : state === "failure" ? "!" : "…";
  title.textContent = state === "success" ? "Premium is ready" : state === "failure" ? "Payment not completed" : "Checking your payment";
  description.textContent = message;
  action.hidden = state !== "success";
  retry.hidden = state !== "failure";
}
async function pollPaymentPage(reference, failurePage) {
  if (failurePage) {
    setPaymentResult("failure", "Your account is still on the Free plan. You can return to the plans page and try again.");
    return;
  }
  setPaymentResult("pending", "We’re waiting for Paystack’s signed confirmation before changing your plan.");
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const result = await api("/api/billing/checkout-status?reference=" + encodeURIComponent(reference));
      if (result.status === "succeeded" && result.billing?.plan === "premium") {
        setPaymentResult("success", "Your payment has been confirmed by Paystack and Premium is active on your account.");
        byId("paymentResultAction").href = "/subscription?payment=success";
        return;
      }
      if (result.status === "failed") {
        window.location.replace("/payment/failure?reference=" + encodeURIComponent(reference));
        return;
      }
      if (result.status === "review_required") {
        setPaymentResult("failure", "Paystack reported an amount that needs review. Premium was not enabled. Please contact Cognify support.");
        return;
      }
    } catch (error) {
      if (error.status === 401) { setPaymentResult("pending", "Sign in to confirm your payment. Premium will remain locked until Cognify verifies it."); const link = byId("paymentRetryLink"); link.href = "/?signup=0&next=" + encodeURIComponent(window.location.pathname + window.location.search); link.textContent = "Sign in to continue"; link.hidden = false; return; }
    }
    await new Promise((resolve) => setTimeout(resolve, 2200));
  }
  setPaymentResult("pending", "Your payment is still being confirmed. This page will not unlock Premium until the signed Paystack webhook arrives. Refresh in a moment or open subscription settings.");
  byId("paymentResultAction").hidden = false;
  byId("paymentResultAction").textContent = "Open subscription settings";
}
async function initialize() {
  setRouteView();
  try {
    const [config, session] = await Promise.all([api("/api/billing/pricing"), api("/api/auth/session")]);
    viewer = session.profile;
    renderPricing(config);
    byId("adminPage").hidden = path !== "/admin";
    document.querySelector('[data-nav-admin]').hidden = !viewer?.billing?.isAdmin;
    byId("adminEmail").value = viewer?.email || "";
    if (path === "/subscription") await loadSubscription();
    if (path === "/admin") await loadAdmin();
    const query = new URLSearchParams(window.location.search);
    if (path === "/payment/success" && query.get("reference")) await pollPaymentPage(query.get("reference"), false);
    if (path === "/payment/success" && !query.get("reference")) setPaymentResult("pending", "We could not find a checkout reference. Open subscription settings to check your account.");
    if (path === "/payment/failure" && query.get("reference")) await pollPaymentPage(query.get("reference"), true);
    if (path === "/payment/failure" && !query.get("reference")) setPaymentResult("failure", "Your account is still on the Free plan. You can return to the plans page and try again.");
    if (query.get("payment") === "success") showNotice("Your Premium subscription is active.", "success");
    if (query.get("limit") === "reached") showNotice("You’ve reached your free AI limit for this period. Upgrade to keep learning with full access.");
  } catch (error) { showNotice(error.message || "Cognify could not load your billing details.", "error"); }
}

byId("upgradeButton").addEventListener("click", async () => {
  if (!viewer) { window.location.assign("/?signup=0&next=%2Fpricing"); return; }
  if (viewer.billing?.plan === "premium") { window.location.assign("/subscription"); return; }
  const button = byId("upgradeButton"); button.disabled = true; button.textContent = "Opening secure checkout…";
  try {
    const result = await api("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    window.location.assign(result.authorizationUrl);
  } catch (error) { showNotice(error.message, "error"); button.disabled = false; button.textContent = "Upgrade to Premium ↗"; }
});
byId("cancelSubscription").addEventListener("click", async () => {
  if (!window.confirm("Cancel the next renewal? Your Premium access will stay on until the current paid period ends.")) return;
  const button = byId("cancelSubscription"); button.disabled = true; button.textContent = "Cancelling…";
  try {
    const result = await api("/api/billing/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    viewer.billing = result.billing; renderSubscription(result.billing); showNotice("Your subscription will not renew. Premium stays available until " + date(result.billing.subscriptionExpiresAt) + ".", "success");
  } catch (error) { showNotice(error.message, "error"); button.disabled = false; button.textContent = "Cancel renewal"; }
});
byId("adminKeyForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const keyField = byId("adminKey");
  button.disabled = true;
  try {
    await api("/api/admin/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: keyField.value }) });
    keyField.value = "";
    await loadAdmin();
  } catch (error) {
    keyField.value = "";
    byId("adminDenied").textContent = error.message;
    byId("adminDenied").hidden = false;
  } finally { button.disabled = false; }
});
byId("adminSettingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]"); button.disabled = true;
  try {
    const result = await adminApi("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ freeUsageLimit: Number(byId("adminFreeLimit").value), premiumPriceNgn: Number(byId("adminPremiumPrice").value) }) });
    pricing = result.settings;
    showNotice("Plan settings saved. New Premium checkouts will use the updated price.", "success");
    await loadAdmin();
  } catch (error) { showNotice(error.message, "error"); }
  finally { button.disabled = false; }
});

initialize();
