const STORAGE = { profile: "cognify-profile", tasks: "cognify-plan", chat: "cognify-chat" };
const byId = (id) => document.getElementById(id);
STORAGE.done = "cognify-plan-done";
STORAGE.progress = "cognify-progress";
STORAGE.studyPending = "cognify-study-pending";
STORAGE.flashcards = "cognify-flashcards";
STORAGE.flashcardsPending = "cognify-flashcards-pending";
const LEGACY_STORAGE = { ...STORAGE };
const LEGACY_DATA_OWNER = "cognify-legacy-data-owner";
const safeRead = (key, fallback) => {
  try { const value = JSON.parse(localStorage.getItem(key)); return value == null ? fallback : value; }
  catch { return fallback; }
};
const safeWrite = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const SUBJECT_GROUPS = {
  "Science": ["Mathematics", "Further Mathematics", "Biology", "Chemistry", "Physics", "Computer Science", "Basic Science", "Agricultural Science"],
  "Arts & Humanities": ["English", "Literature", "History", "Geography", "Government & Civics", "French", "Yoruba", "Igbo", "Hausa", "Civic Education", "Religious Studies", "Art & Design"],
  "Commercial & Finance": ["Economics", "Accounting", "Commerce", "Business Studies", "Financial Literacy", "Entrepreneurship", "Office Practice"]
};
const DEFAULT_SUBJECTS = ["Mathematics", "Biology", "Physics", "English"];
const SUBJECT_OPTIONS = Object.values(SUBJECT_GROUPS).flat();
function normalizeSubjects(value, fallback = DEFAULT_SUBJECTS) {
  const selected = Array.isArray(value) ? [...new Set(value.filter((subject) => SUBJECT_OPTIONS.includes(subject)))] : [];
  return selected.length ? selected : [...fallback];
}
function newFlashcardId() { return window.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2); }
function normalizeFlashcards(value) {
  if (!Array.isArray(value)) return [];
  const today = localDateKey(new Date());
  return value.slice(0, 500).map((card) => {
    if (!card || typeof card !== "object") return null;
    const front = typeof card.front === "string" ? card.front.trim().slice(0, 240) : "";
    const back = typeof card.back === "string" ? card.back.trim().slice(0, 700) : "";
    const dueDate = typeof card.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(card.dueDate) && Number.isFinite(new Date(card.dueDate).getTime()) ? card.dueDate : today;
    if (!front || !back) return null;
    return {
      id: typeof card.id === "string" && card.id ? card.id : newFlashcardId(),
      subject: SUBJECT_OPTIONS.includes(card.subject) ? card.subject : DEFAULT_SUBJECTS[0],
      front,
      back,
      createdAt: Number.isFinite(card.createdAt) ? card.createdAt : Date.now(),
      dueDate,
      intervalDays: Number.isFinite(card.intervalDays) ? Math.max(0, Math.min(30, Math.floor(card.intervalDays))) : 0,
      reviewCount: Number.isFinite(card.reviewCount) ? Math.max(0, Math.floor(card.reviewCount)) : 0
    };
  }).filter(Boolean);
}
function emptyLearningProgress() { return { activeDays: [], dailyTaskMinutes: {}, quiz: { answered: 0, correct: 0, bySubject: {} }, completedLessons: [] }; }
function normalizeLearningProgress(value) {
  const fresh = emptyLearningProgress();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fresh;
  const quiz = value.quiz && typeof value.quiz === "object" ? value.quiz : {};
  return {
    activeDays: Array.isArray(value.activeDays) ? [...new Set(value.activeDays.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)))] : fresh.activeDays,
    dailyTaskMinutes: value.dailyTaskMinutes && typeof value.dailyTaskMinutes === "object" && !Array.isArray(value.dailyTaskMinutes) ? value.dailyTaskMinutes : fresh.dailyTaskMinutes,
    quiz: {
      answered: Number.isFinite(quiz.answered) ? Math.max(0, quiz.answered) : 0,
      correct: Number.isFinite(quiz.correct) ? Math.max(0, quiz.correct) : 0,
      bySubject: quiz.bySubject && typeof quiz.bySubject === "object" && !Array.isArray(quiz.bySubject) ? quiz.bySubject : {}
    },
    completedLessons: Array.isArray(value.completedLessons) ? [...new Set(value.completedLessons.filter((subject) => typeof subject === "string"))] : fresh.completedLessons
  };
}
const profile = { name: "Student", level: "simple", ...safeRead(STORAGE.profile, {}) };
profile.subjects = normalizeSubjects(profile.subjects);
let activeSubjects = [...profile.subjects];
let signedInProfile = null;
const THEME_STORAGE_PREFIX = "cognify-theme:";
const THEME_PRESETS = {
  lavender: { label: "Lavender", accent: "#6758dd" },
  ocean: { label: "Ocean", accent: "#1686a2" },
  forest: { label: "Forest", accent: "#368253" },
  sunset: { label: "Sunset", accent: "#d66d4f" },
  rose: { label: "Rose", accent: "#c65079" }
};
const DEFAULT_THEME = { mode: "light", palette: "lavender", customColor: "#6758dd" };
function themeStorageKey() { return THEME_STORAGE_PREFIX + (signedInProfile?.id || "guest"); }
function normalizeTheme(value) {
  return {
    mode: ["light", "dark", "custom"].includes(value?.mode) ? value.mode : DEFAULT_THEME.mode,
    palette: Object.hasOwn(THEME_PRESETS, value?.palette) ? value.palette : DEFAULT_THEME.palette,
    customColor: /^#[\da-f]{6}$/i.test(value?.customColor || "") ? value.customColor : DEFAULT_THEME.customColor
  };
}
let themePreference = normalizeTheme(safeRead(themeStorageKey(), DEFAULT_THEME));
let accountMode = "login";
let pendingVerificationEmail = "";
let pendingPasswordResetToken = "";
let tutorReady = false;
let selectedSubject = "All subjects";
let chatHistory = safeRead(STORAGE.chat, []);
let learningProgress = emptyLearningProgress();
let sending = false;
let quizIndex = 0;
let quizScore = 0;
let quizAnswered = false;
let quizQuestionSource = "sample";
let quizLoadNote = "";
let quizSubject = "All subjects";
let toastTimer;
let flashcards = normalizeFlashcards(safeRead(STORAGE.flashcards, []));
let flashcardFilterSubject = "All subjects";
let flashcardSessionQueue = [];
let flashcardSessionIndex = 0;
let flashcardSessionReviewed = 0;
let flashcardSessionAgain = 0;
let flashcardSessionActive = false;
let flashcardRevealed = false;
let editingFlashcardId = null;
let generatedFlashcards = [];
let generatedFlashcardSubject = "";
let generatingFlashcards = false;
let flashcardGeneratorMessage = "One AI use is counted for each generated set.";
let flashcardSyncTimer = null;
let flashcardSyncRun = 0;
let flashcardSyncInFlight = false;
let flashcardSyncQueued = false;
let flashcardSyncReady = false;
let flashcardLocalRevision = 0;
let studySyncTimer = null;
let studySyncRun = 0;
let studySyncInFlight = false;
let studySyncQueued = false;
let studySyncReady = false;
let studyLocalRevision = 0;

function renderThemeControls() {
  const paletteOptions = byId("themePaletteOptions");
  if (!paletteOptions) return;
  document.querySelectorAll("[data-theme-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeMode === themePreference.mode));
  });
  paletteOptions.replaceChildren();
  Object.entries(THEME_PRESETS).forEach(([key, palette]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-palette-option";
    button.dataset.themePalette = key;
    button.setAttribute("aria-label", palette.label + " color theme");
    const selectedPalette = themePreference.palette === key && (themePreference.mode !== "custom" || themePreference.customColor.toLowerCase() === palette.accent.toLowerCase());
    button.setAttribute("aria-pressed", String(selectedPalette));
    button.style.setProperty("--swatch-color", palette.accent);
    const swatch = document.createElement("span");
    swatch.className = "theme-swatch";
    swatch.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = palette.label;
    button.append(swatch, label);
    paletteOptions.append(button);
  });
  const customControl = byId("customThemeControl");
  const customColor = byId("customThemeColor");
  if (customControl) customControl.hidden = themePreference.mode !== "custom";
  if (customColor) customColor.value = themePreference.customColor;
}

function applyTheme(persist = false) {
  const root = document.documentElement;
  const palette = THEME_PRESETS[themePreference.palette] || THEME_PRESETS.lavender;
  const dark = themePreference.mode === "dark";
  const accent = themePreference.mode === "custom" ? themePreference.customColor : palette.accent;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.setProperty("--purple", accent);
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-strong", `color-mix(in srgb, ${accent} 82%, ${dark ? "white" : "#17172b"})`);
  root.style.setProperty("--accent-soft", `color-mix(in srgb, ${accent} ${dark ? "24%" : "12%"}, ${dark ? "#202236" : "white"})`);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = dark ? "#171925" : "#f8f8fc";
  if (persist) safeWrite(themeStorageKey(), themePreference);
  renderThemeControls();
}

function loadThemePreference() {
  themePreference = normalizeTheme(safeRead(themeStorageKey(), DEFAULT_THEME));
  applyTheme(false);
}

function firstName() { return (signedInProfile?.name || profile.name).trim().split(/\s+/)[0] || "Student"; }
function initials() { return (signedInProfile?.name || profile.name).trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() || "S"; }
function syncBillingUI(billing = signedInProfile?.billing) {
  if (!billing) return;
  const premium = billing.plan === "premium";
  byId("dashboardPlan").textContent = billing.suspended ? "Access paused" : premium ? "Premium plan" : "Free plan";
  byId("dashboardPlanBadge").textContent = billing.suspended ? "PAUSED" : premium ? "PREMIUM" : "FREE";
  byId("dashboardUsage").textContent = premium
    ? billing.usageUsed + " AI uses this period · Unlimited access"
    : billing.usageUsed + " / " + billing.usageLimit + " uses used · " + billing.usageRemaining + " left";
  byId("dashboardUsageFill").style.width = premium ? "100%" : Math.min(100, billing.usageUsed / Math.max(1, billing.usageLimit) * 100) + "%";
  byId("dashboardUsageReset").textContent = premium
    ? (billing.cancelAtPeriodEnd ? "Access ends " : "Next renewal ") + (billing.subscriptionExpiresAt ? new Date(billing.subscriptionExpiresAt).toLocaleDateString() : "date unavailable")
    : "Free AI allowance resets " + new Date(billing.usageResetAt).toLocaleDateString() + ".";
  byId("dashboardUpgrade").hidden = premium;
  byId("dashboardManage").hidden = !premium;
  byId("accountPlanName").textContent = billing.suspended ? "Access paused" : premium ? "Premium plan" : "Free plan";
  byId("accountPlanUsage").textContent = premium ? "Unlimited AI access" : billing.usageUsed + " / " + billing.usageLimit + " AI uses · " + billing.usageRemaining + " left";
  byId("accountPlanAction").textContent = premium ? "View subscription details" : "Upgrade to Premium";
  byId("accountPlanAction").href = premium ? "/subscription" : "/pricing";
  byId("accountManageLink").hidden = !premium;
  const role = byId("profileRole");
  if (role && signedInProfile) role.textContent = premium ? "Premium plan" : "Free plan";
}
async function refreshBilling() {
  if (!signedInProfile) return;
  try {
    const response = await fetch("/api/billing/status", { headers: { Accept: "application/json" } });
    const result = await response.json();
    if (response.ok) { signedInProfile.billing = result.billing; syncBillingUI(result.billing); }
  } catch {}
}
function syncProfile() {
  document.querySelectorAll("[data-user-name]").forEach((node, index) => {
    node.textContent = index === 0 ? profile.name : firstName();
  });
  document.querySelectorAll("[data-first-name]").forEach((node) => { node.textContent = firstName(); });
  [byId("sidebarAvatar"), byId("topAvatar")].forEach((node) => { if (node) node.textContent = initials(); });
  byId("nameSetting").value = profile.name;
  byId("levelSetting").value = profile.level;
  renderSubjectOptions();
  renderSubjectCards();
  renderFlashcards();
  updateFlashcardGeneratorControls();
  const subjectNavCount = byId("subjectNavCount");
  if (subjectNavCount) subjectNavCount.textContent = String(activeSubjects.length);
  const welcome = byId("tutorWelcomeMessage");
  if (welcome) welcome.textContent = "Hey " + firstName() + "! 👋 What are you learning today? I can explain tricky ideas, walk through an example, or help you practice — at your pace.";
  if (byId("profileRole")) byId("profileRole").textContent = signedInProfile ? (signedInProfile.billing?.plan === "premium" ? "Premium plan" : "Free plan") : "Create your profile";
  if (byId("topProfile")) byId("topProfile").setAttribute("aria-label", signedInProfile ? "Manage your profile" : "Create or sign in to your profile");
}

function syncAccountModal() {
  const signedIn = Boolean(signedInProfile);
  byId("accountSignedOut").hidden = signedIn;
  byId("accountSignedIn").hidden = !signedIn;
  if (signedIn) {
    byId("accountTitle").textContent = "Your profile";
    byId("accountName").textContent = signedInProfile.name;
    byId("accountEmailLabel").textContent = signedInProfile.email;
    byId("accountAvatar").textContent = initials();
    syncBillingUI(signedInProfile.billing);
  } else setAccountMode(accountMode);
}

async function bindAccountStorage(user, isNewAccount = false) {
  resetFlashcardSyncState();
  flashcardSyncReady = false;
  resetStudySyncState();
  studySyncReady = false;
  const accountKeys = Object.fromEntries(Object.keys(LEGACY_STORAGE).map((key) => [key, "cognify-account-" + user.id + "-" + key]));
  let hasAccountData = false;
  try { hasAccountData = Object.values(accountKeys).some((key) => localStorage.getItem(key) !== null); } catch {}
  let legacyOwner = null;
  try { legacyOwner = localStorage.getItem(LEGACY_DATA_OWNER); } catch {}

  // Only migrate browser state already claimed by this same profile. Unowned legacy
  // data may belong to a different person using this browser.
  if (!isNewAccount && !hasAccountData && legacyOwner === user.id) {
    let migrated = false;
    for (const key of ["tasks", "chat", "done", "progress", "flashcards"]) {
      try {
        const legacyValue = localStorage.getItem(LEGACY_STORAGE[key]);
        if (legacyValue !== null) {
          localStorage.setItem(accountKeys[key], legacyValue);
          if (key === "flashcards") localStorage.setItem(accountKeys.flashcardsPending, "true");
          if (["tasks", "done", "progress"].includes(key)) localStorage.setItem(accountKeys.studyPending, "true");
          migrated = true;
        }
      } catch {}
    }
    if (migrated) { try { localStorage.setItem(LEGACY_DATA_OWNER, user.id); } catch {} }
  }

  Object.assign(STORAGE, accountKeys);
  profile.name = user.name || "Student";
  profile.level = user.level || "simple";
  activeSubjects = normalizeSubjects(user.subjects);
  profile.subjects = [...activeSubjects];
  safeWrite(STORAGE.profile, { name: profile.name, level: profile.level, subjects: profile.subjects });
  if (isNewAccount) {
    safeWrite(STORAGE.tasks, []);
    safeWrite(STORAGE.chat, []);
    safeWrite(STORAGE.done, []);
    safeWrite(STORAGE.progress, emptyLearningProgress());
    safeWrite(STORAGE.studyPending, false);
    safeWrite(STORAGE.flashcards, []);
    safeWrite(STORAGE.flashcardsPending, false);
  }
  customTasks = safeRead(STORAGE.tasks, []);
  chatHistory = safeRead(STORAGE.chat, []);
  flashcards = normalizeFlashcards(safeRead(STORAGE.flashcards, []));
  learningProgress = normalizeLearningProgress(safeRead(STORAGE.progress, emptyLearningProgress()));
  document.querySelectorAll("#taskList .custom-task-row").forEach((row) => row.remove());
  document.querySelectorAll("#taskList .task-check").forEach((checkbox) => { checkbox.checked = false; });
  byId("chatMessages").replaceChildren();
  restoreTasks();
  renderHistory();
  renderDashboardProgress();
  renderSubjectOptions();
  renderSubjectCards();
  flashcardFilterSubject = "All subjects";
  flashcardSessionQueue = [];
  flashcardSessionIndex = 0;
  flashcardSessionReviewed = 0;
  flashcardSessionAgain = 0;
  flashcardSessionActive = false;
  flashcardRevealed = false;
  editingFlashcardId = null;
  resetFlashcardForm();
  clearGeneratedFlashcards();
  renderFlashcards();
  await Promise.all([
    syncFlashcardsFromServer(user.id, flashcardSyncRun),
    syncStudyStateFromServer(user.id, studySyncRun)
  ]);
}

function clearSignedOutStudyView() {
  resetFlashcardSyncState();
  flashcardSyncReady = false;
  resetStudySyncState();
  studySyncReady = false;
  Object.assign(STORAGE, LEGACY_STORAGE);
  customTasks = [];
  chatHistory = [];
  flashcards = [];
  flashcardSessionQueue = [];
  flashcardSessionIndex = 0;
  flashcardSessionReviewed = 0;
  flashcardSessionAgain = 0;
  flashcardSessionActive = false;
  flashcardRevealed = false;
  editingFlashcardId = null;
  flashcardFilterSubject = "All subjects";
  learningProgress = emptyLearningProgress();
  document.querySelectorAll("#taskList .custom-task-row").forEach((row) => row.remove());
  document.querySelectorAll("#taskList .task-check").forEach((checkbox) => { checkbox.checked = false; });
  byId("chatMessages").replaceChildren();
  byId("starterPrompts").hidden = false;
  resetFlashcardForm();
  clearGeneratedFlashcards();
  setFlashcardSyncStatus("Sign in to sync this deck across devices.");
  setStudySyncStatus("Sign in to sync your planner and progress.");
  renderFlashcards();
  updatePlanProgress();
  renderDashboardProgress();
}

function setAccountMode(mode) {
  accountMode = mode;
  const signingUp = mode === "signup";
  byId("accountForm").hidden = false;
  byId("accountSwitchRow").hidden = false;
  byId("verificationPending").hidden = true;
  byId("passwordResetRequest").hidden = true;
  byId("passwordResetRequestNotice").hidden = true;
  byId("forgotPasswordButton").hidden = signingUp;
  byId("accountTitle").textContent = signingUp ? "Create your profile" : "Welcome back";
  byId("accountIntro").textContent = signingUp
    ? "Save your name and learning preferences. Verify your inbox to finish creating your profile."
    : "Sign in to open your saved learning profile.";
  byId("accountEmailHint").textContent = signingUp
    ? "Use an inbox you can access; you’ll need to verify it before signing in."
    : "Enter the email address linked to your profile.";
  byId("signupFields").hidden = !signingUp;
  byId("accountPassword").autocomplete = signingUp ? "new-password" : "current-password";
  byId("accountPassword").placeholder = signingUp ? "At least 10 characters" : "Your password";
  byId("accountSubmit").textContent = signingUp ? "Create my profile" : "Sign in";
  byId("accountSwitchText").textContent = signingUp ? "Already have a profile?" : "New to Cognify?";
  byId("accountModeSwitch").textContent = signingUp ? "Sign in" : "Create a profile";
  byId("accountError").hidden = true;
  byId("accountPassword").value = "";
}

function openAccount() {
  syncAccountModal();
  openModal("accountModal");
  window.setTimeout(() => {
    const focusTarget = signedInProfile ? byId("accountPreferences") : byId(accountMode === "signup" ? "signupName" : "accountEmail");
    focusTarget.focus();
  }, 110);
}

function showAuthGate(message) {
  document.body.classList.add("auth-required");
  signedInProfile = null;
  syncAccountModal();
  openModal("accountModal");
  window.setTimeout(() => byId("accountEmail").focus(), 110);
  if (message) {
    byId("accountError").textContent = message;
    byId("accountError").hidden = false;
  }
}

async function configureGoogleSignIn() {
  const button = byId("googleSignInButton");
  const status = byId("googleSignInStatus");
  try {
    const response = await fetch("/api/auth/providers", { headers: { Accept: "application/json" } });
    const result = await response.json();
    const enabled = response.ok && result.google === true;
    button.disabled = !enabled;
    status.hidden = enabled;
    if (enabled) button.addEventListener("click", () => { window.location.assign("/auth/google/start"); }, { once: true });
  } catch {
    button.disabled = true;
    status.textContent = "Cognify could not check Google sign-in. Refresh and try again.";
  }
}

function handleGoogleSignInResult() {
  const url = new URL(window.location.href);
  const result = url.searchParams.get("google_error");
  if (!result) return;
  history.replaceState(null, document.title, url.pathname + url.hash);
  setAccountMode("login");
  if (result === "not_configured") {
    showAuthGate("Google sign-in needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server.");
  } else if (result === "cancelled") {
    showAuthGate("Google sign-in was cancelled. You can try again or use your email and password.");
  } else {
    showAuthGate("Google sign-in couldn't be completed. Please try again.");
  }
}

function showEmailVerificationPending(email, deliveryStatus = "sent") {
  pendingVerificationEmail = email;
  byId("verificationMessage").textContent = deliveryStatus === "pending"
    ? "Verify your email to sign in. If your link expired or you can’t find the message, request a fresh link for " + email + "."
    : deliveryStatus === "sent"
      ? "We sent a verification link to " + email + ". Open it to finish creating your profile."
      : "Your profile is saved, but we couldn't send the verification email. Try again now. We’ll send a fresh link to " + email + ".";
  byId("accountForm").hidden = true;
  byId("forgotPasswordButton").hidden = true;
  byId("accountSwitchRow").hidden = true;
  byId("verificationPending").hidden = false;
}

async function handleEmailVerificationLink() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = fragment.get("verifyEmail");
  if (!token) return false;
  history.replaceState(null, document.title, window.location.pathname + window.location.search);
  try {
    const response = await fetch("/api/auth/verify-email", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ token })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "We couldn't verify this email. Request a new link.");
    if (!signedInProfile) {
      setAccountMode("login");
      syncAccountModal();
      openModal("accountModal");
      byId("accountEmail").value = result.email || "";
    }
    showToast("Your email is verified. Sign in to continue.", "success");
  } catch (error) {
    if (!signedInProfile) {
      setAccountMode("login");
      syncAccountModal();
      openModal("accountModal");
    }
    showToast(error.message || "We couldn't verify this email. Request a new link.", "error");
  }
  return true;
}

async function handlePasswordResetLink() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = fragment.get("resetPassword");
  if (!token) return false;
  history.replaceState(null, document.title, window.location.pathname + window.location.search);
  pendingPasswordResetToken = token;
  byId("passwordResetForm").reset();
  byId("passwordResetError").hidden = true;
  openModal("passwordResetModal");
  return true;
}

async function restoreAccountSession() {
  showAuthGate();
  try {
    const response = await fetch("/api/auth/session", { headers: { Accept: "application/json" } });
    const result = await response.json();
    if (!response.ok) throw new Error("Session check returned HTTP " + response.status + ".");
    if (!result.profile) return;
    signedInProfile = result.profile;
    loadThemePreference();
    await bindAccountStorage(result.profile, false);
    syncProfile();
    syncBillingUI(signedInProfile.billing);
    document.body.classList.remove("auth-required");
    closeModal();
  } catch (error) {
    console.error("Cognify account session restore failed:", error);
    showAuthGate("Cognify couldn't restore your session: " + (error?.message || "Please reload and try again."));
  }
}

function showToast(message, variant) {
  const region = byId("toastRegion");
  region.replaceChildren();
  const toast = document.createElement("div");
  toast.className = "toast" + (variant ? " " + variant : "");
  toast.textContent = message;
  region.append(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 3400);
}

async function checkTutorStatus() {
  try {
    const response = await fetch("/api/status", { headers: { Accept: "application/json" } });
    const result = await response.json();
    tutorReady = response.ok && result.configured === true;
  } catch { tutorReady = false; }
  const status = byId("tutorStatus");
  const dot = document.querySelector(".panel-status-dot");
  status.textContent = tutorReady ? "Groq AI configured" : "Preview mode · connect an AI key";
  byId("tutorPrivacyText").textContent = tutorReady
    ? "AI Buddy, practice questions, and flashcard sets are generated by Groq."
    : "Preview chats stay on this device. Groq powers practice questions and flashcards when configured.";
  dot.classList.toggle("ready", tutorReady);
  updateFlashcardGeneratorControls();
}

function openTutor() {
  document.body.classList.add("tutor-open");
  byId("tutorPanel").setAttribute("aria-hidden", "false");
  window.setTimeout(() => byId("tutorInput").focus(), 180);
  renderHistory();
  checkTutorStatus();
}
function closeTutor() {
  document.body.classList.remove("tutor-open");
  byId("tutorPanel").setAttribute("aria-hidden", "true");
}
function formatMathExpression(expression) {
  const commands = {
    times: "×", cdot: "·", div: "÷", pm: "±", le: "≤", leq: "≤",
    ge: "≥", geq: "≥", neq: "≠", ne: "≠", approx: "≈", pi: "π",
    infty: "∞", sum: "∑", alpha: "α", beta: "β", theta: "θ", Delta: "Δ"
  };
  return String(expression || "")
    .replace(/\\(?:text|mathrm|mathbf|mathit)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1) / ($2)")
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
    .replace(/\\left|\\right/g, "")
    .replace(/\\(?:,|;|:|!|quad|qquad)/g, " ")
    .replace(/\\([a-zA-Z]+)/g, (match, name) => commands[name] || match)
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function appendMarkdownInline(container, text) {
  const tokenPattern = /(\\\([^\n]*?\\\)|\$[^$\n]+\$|\[[^\]\n]+\]\([^)]+\)|\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_)/g;
  let cursor = 0;
  let match;
  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > cursor) container.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    const mathMatch = token.match(/^\\\((.*?)\\\)$|^\$([^$]+)\$$/);
    if (mathMatch) {
      const formula = document.createElement("span");
      formula.className = "answer-equation-inline";
      formula.textContent = formatMathExpression(mathMatch[1] ?? mathMatch[2]);
      container.append(formula);
      cursor = tokenPattern.lastIndex;
      continue;
    }
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      let link;
      try {
        const url = new URL(linkMatch[2], window.location.origin);
        if (["http:", "https:"].includes(url.protocol)) {
          link = document.createElement("a");
          link.href = url.toString();
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = linkMatch[1];
        }
      } catch {}
      container.append(link || document.createTextNode(token));
      cursor = tokenPattern.lastIndex;
      continue;
    }
    const strong = token.startsWith("**") || token.startsWith("__");
    const code = token.startsWith("`");
    const markerSize = strong || code ? 2 * Number(strong) + Number(code) : 1;
    const element = document.createElement(strong ? "strong" : code ? "code" : "em");
    element.textContent = token.slice(markerSize, -markerSize);
    container.append(element);
    cursor = tokenPattern.lastIndex;
  }
  if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)));
}
function splitMarkdownTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  return trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
function renderAssistantMarkdown(container, markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let paragraph = [];
  let list = null;
  let codeLines = null;
  let codeLanguage = "";
  const appendCodeBlock = () => {
    const pre = document.createElement("pre");
    if (codeLanguage) pre.dataset.language = codeLanguage;
    const code = document.createElement("code");
    code.textContent = codeLines.join("\n");
    pre.append(code);
    container.append(pre);
    codeLines = null;
    codeLanguage = "";
  };
  const appendEquation = (expression) => {
    const equation = document.createElement("div");
    equation.className = "answer-equation";
    equation.setAttribute("role", "math");
    equation.textContent = formatMathExpression(expression);
    container.append(equation);
  };
  const appendTable = (headerCells, separatorCells, rows) => {
    const alignments = separatorCells.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left");
    const wrapper = document.createElement("div");
    wrapper.className = "answer-table-wrap";
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Answer table; scroll horizontally to see all columns");
    wrapper.tabIndex = 0;
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headerCells.forEach((value, index) => {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.style.textAlign = alignments[index] || "left";
      appendMarkdownInline(cell, value);
      headerRow.append(cell);
    });
    head.append(headerRow);
    const body = document.createElement("tbody");
    rows.forEach((row) => {
      const tableRow = document.createElement("tr");
      headerCells.forEach((_, index) => {
        const cell = document.createElement("td");
        cell.style.textAlign = alignments[index] || "left";
        appendMarkdownInline(cell, row[index] || "");
        tableRow.append(cell);
      });
      body.append(tableRow);
    });
    table.append(head, body);
    wrapper.append(table);
    container.append(wrapper);
  };
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const node = document.createElement("p");
    appendMarkdownInline(node, paragraph.join(" ").trim());
    container.append(node);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    container.append(list);
    list = null;
  };
  const flushTextBlocks = () => { flushParagraph(); flushList(); };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (codeLines) {
      if (/^```/.test(trimmed)) {
        appendCodeBlock();
      } else codeLines.push(line);
      continue;
    }
    const codeFence = trimmed.match(/^```([a-z0-9_+-]*)\s*$/i);
    if (codeFence) {
      flushTextBlocks();
      codeLines = [];
      codeLanguage = codeFence[1].slice(0, 20);
      continue;
    }
    const oneLineMath = trimmed.match(/^\\\[([\s\S]*?)\\\]$|^\$\$([\s\S]*?)\$\$$/);
    if (oneLineMath) {
      flushTextBlocks();
      appendEquation(oneLineMath[1] ?? oneLineMath[2]);
      continue;
    }
    if (trimmed === "\\[" || trimmed === "$$") {
      flushTextBlocks();
      const closing = trimmed === "\\[" ? "\\]" : "$$";
      const expression = [];
      lineIndex += 1;
      while (lineIndex < lines.length && lines[lineIndex].trim() !== closing) {
        expression.push(lines[lineIndex].trim());
        lineIndex += 1;
      }
      appendEquation(expression.join(" "));
      continue;
    }
    if (!trimmed) { flushTextBlocks(); continue; }

    const tableHeader = splitMarkdownTableRow(trimmed);
    const tableSeparator = splitMarkdownTableRow(lines[lineIndex + 1] || "");
    if (tableHeader && tableSeparator && tableSeparator.length === tableHeader.length && tableSeparator.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      flushTextBlocks();
      const rows = [];
      lineIndex += 2;
      while (lineIndex < lines.length) {
        const row = splitMarkdownTableRow(lines[lineIndex]);
        if (!row) { lineIndex -= 1; break; }
        rows.push(row.slice(0, tableHeader.length));
        lineIndex += 1;
      }
      appendTable(tableHeader, tableSeparator, rows);
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flushTextBlocks();
      const node = document.createElement("h" + Math.min(4, heading[1].length));
      appendMarkdownInline(node, heading[2]);
      container.append(node);
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushTextBlocks();
      container.append(document.createElement("hr"));
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const tag = ordered ? "ol" : "ul";
      if (list && list.tagName.toLowerCase() !== tag) flushList();
      if (!list) list = document.createElement(tag);
      const item = document.createElement("li");
      appendMarkdownInline(item, (unordered || ordered)[1]);
      list.append(item);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushTextBlocks();
      const blockquote = document.createElement("blockquote");
      appendMarkdownInline(blockquote, quote[1]);
      container.append(blockquote);
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushTextBlocks();
  if (codeLines) appendCodeBlock();
}
function renderMessage(role, content, isTyping) {
  const list = byId("chatMessages");
  const message = document.createElement("div");
  message.className = "chat-message " + (role === "user" ? "user-message" : "assistant-message");
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  if (role === "user") avatar.textContent = initials();
  else {
    const face = document.createElement("span");
    face.className = "mini-face";
    face.innerHTML = "<i></i><i></i><b></b>";
    avatar.append(face);
  }
  const body = document.createElement("div");
  body.className = "message-content";
  if (role === "user") {
    const label = document.createElement("span");
    label.className = "message-sender";
    label.textContent = "You · just now";
    body.append(label);
  } else {
    const label = document.createElement("span");
    label.className = "message-sender";
    label.textContent = "Your study buddy · just now";
    body.append(label);
  }
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  if (isTyping) {
    bubble.classList.add("typing-indicator");
    bubble.setAttribute("aria-label", "Tutor is thinking");
    bubble.innerHTML = "<i></i><i></i><i></i>";
  } else if (role === "assistant") renderAssistantMarkdown(bubble, content);
  else bubble.textContent = content;
  body.append(bubble);
  if (role === "assistant" && !isTyping) {
    const tools = document.createElement("div");
    tools.className = "message-tools";
    const note = document.createElement("span");
    note.textContent = "✦ Take your time — ask a follow-up if you need one";
    tools.append(note);
    body.append(tools);
  }
  message.append(avatar, body);
  list.append(message);
  byId("chatScroll").scrollTop = byId("chatScroll").scrollHeight;
  return message;
}
function renderHistory() {
  const list = byId("chatMessages");
  if (!list || list.children.length > 0) return;
  chatHistory.slice(-16).forEach((item) => renderMessage(item.role, item.content));
  byId("starterPrompts").hidden = chatHistory.length > 0;
}
function setTutorSubject(subject) {
  selectedSubject = subject;
  byId("composeSubject").textContent = subject;
  byId("subjectPicker").setAttribute("aria-label", "Selected subject: " + subject + ". Change subject.");
}

function explainOffline(question) {
  const text = question.trim();
  const equation = text.match(/(-?\d*\.?\d*)\s*x\s*([+-]\s*\d+(?:\.\d+)?)?\s*=\s*(-?\d+(?:\.\d+)?)/i);
  if (equation) {
    const rawA = equation[1];
    const a = rawA === "" || rawA === "+" ? 1 : rawA === "-" ? -1 : Number(rawA);
    const b = equation[2] ? Number(equation[2].replace(/\s/g, "")) : 0;
    const c = Number(equation[3]);
    if (a !== 0) {
      const moved = c - b;
      const answer = moved / a;
      const bText = b > 0 ? " + " + b : b < 0 ? " − " + Math.abs(b) : "";
      return "Let's solve it like a balanced scale: whatever we do to one side, we do to the other.\n\n1. Start with: " + a + "x" + bText + " = " + c + "\n2. Move the number beside x by subtracting it from both sides: " + a + "x = " + c + (b < 0 ? " + " + Math.abs(b) : b > 0 ? " − " + b : "") + " = " + moved + ".\n3. Divide both sides by " + a + ": x = " + moved + " ÷ " + a + " = " + Number(answer.toFixed(4)) + ".\n\nCheck: substitute x = " + Number(answer.toFixed(4)) + " back into the original equation.\n\nWant to try one yourself: what would you do first in 3x − 4 = 11?";
    }
  }
  const lower = text.toLowerCase();
  if (lower.includes("photosynthesis") || lower.includes("plant")) {
    return "Think of a leaf as a tiny solar-powered kitchen. It uses light energy to turn water and carbon dioxide into sugar (food) and oxygen.\n\nThe simple equation is: carbon dioxide + water + light → glucose + oxygen.\n\nFor example, a plant on a sunny windowsill takes in CO₂ from the air and water through its roots. The leaf uses sunlight to make sugar, which helps the plant grow.\n\nQuick check: which part supplies the energy for this process?";
  }
  if (lower.includes("fraction")) {
    return "A fraction is a part of a whole. The bottom number (denominator) tells us how many equal parts make the whole; the top number (numerator) tells us how many parts we have.\n\nExample: 3/4 means 3 pieces when a whole is split into 4 equal pieces. To add fractions with matching bottoms, add the tops: 1/4 + 2/4 = 3/4.\n\nQuick check: what does the 4 tell you in 3/4?";
  }
  if (lower.includes("force") || lower.includes("newton") || lower.includes("motion")) {
    return "A force is a push or pull that can change an object's motion. Newton's second law connects three ideas: force, mass, and acceleration.\n\nThe rule is F = m × a. If a 2 kg ball speeds up at 3 m/s², the force is 2 × 3 = 6 newtons. A heavier object needs more force to get the same acceleration.\n\nQuick check: if the mass stays the same but you push harder, what happens to its acceleration?";
  }
  const previewName = selectedSubject === "All subjects" ? "this question" : "this " + selectedSubject.toLowerCase() + " question";
  return "Let's work through " + previewName + " together.\n\n1. First, identify what the question is asking you to find.\n2. List the facts, ideas, or formulas that might help.\n3. Solve one small step at a time, and check whether your answer makes sense.\n\nThis is preview mode, so I can show a few sample explanations here. Connect an AI API key to get open-ended, personalized tutoring for any topic.\n\nWhat subject or part would you like to start with?";
}

async function askTutor(question) {
  const clean = question.trim();
  if (!clean || sending) return;
  sending = true;
  const send = byId("sendButton");
  send.disabled = true;
  byId("starterPrompts").hidden = true;
  const priorHistory = chatHistory.slice(-10);
  chatHistory.push({ role: "user", content: clean });
  renderMessage("user", clean);
  const typing = renderMessage("assistant", "", true);
  try {
    await checkTutorStatus();
    let answer;
    if (tutorReady) {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ message: clean, history: priorHistory, subject: selectedSubject, level: profile.level })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { const error = new Error(result.error || "The tutor could not answer just now. Please try again."); error.code = result.code; throw error; }
      if (result.billing && signedInProfile) { signedInProfile.billing = result.billing; syncBillingUI(result.billing); }
      answer = result.answer;
    } else {
      await new Promise((resolve) => setTimeout(resolve, 600));
      answer = explainOffline(clean);
    }
    typing.remove();
    renderMessage("assistant", answer);
    chatHistory.push({ role: "assistant", content: answer });
    chatHistory = chatHistory.slice(-16);
    safeWrite(STORAGE.chat, chatHistory);
  } catch (error) {
    typing.remove();
    if (error.code === "usage_limit_reached") { window.location.assign("/pricing?limit=reached"); return; }
    renderMessage("assistant", error.message || "I couldn't reach the tutor. Check your connection and try again.");
    chatHistory.pop();
    safeWrite(STORAGE.chat, chatHistory);
  } finally {
    sending = false;
    send.disabled = false;
    byId("tutorInput").focus();
  }
}

function openModal(id) {
  closeTutor();
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.classList.toggle("modal-active", modal.id === id);
    modal.setAttribute("aria-hidden", modal.id === id ? "false" : "true");
  });
  document.body.classList.add("modal-open");
  const modal = byId(id);
  const focusTarget = modal.querySelector("input,select,button");
  if (focusTarget) window.setTimeout(() => focusTarget.focus(), 80);
}
function closeModal() {
  if (document.body.classList.contains("auth-required")) return;
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.classList.remove("modal-active");
    modal.setAttribute("aria-hidden", "true");
  });
  document.body.classList.remove("modal-open");
}

const tasks = [
  { id: "algebra", title: "Practice equations", detail: "Mathematics · 15 min", color: "math" },
  { id: "cells", title: "Review cell structures", detail: "Biology · 10 min", color: "bio" },
  { id: "read", title: "Read for 10 minutes", detail: "English · 10 min", color: "english" }
];
let customTasks = safeRead(STORAGE.tasks, []);
function createCustomTask(task) {
  const row = document.createElement("label");
  row.className = "task-row custom-task-row";
  const input = document.createElement("input");
  input.className = "task-check";
  input.type = "checkbox";
  input.dataset.task = task.id;
  input.checked = task.done === true;
  const check = document.createElement("span");
  check.className = "task-custom";
  check.setAttribute("aria-hidden", "true");
  check.innerHTML = "<svg viewBox=\"0 0 14 14\"><path d=\"m2.4 7.2 3 3L11.7 4\"/></svg>";
  const detail = document.createElement("span");
  detail.className = "task-detail";
  const title = document.createElement("strong");
  title.textContent = task.title;
  const small = document.createElement("small");
  small.textContent = "Personal goal · whenever you’re ready";
  detail.append(title, small);
  const dot = document.createElement("span");
  dot.className = "task-subject-dot dot-math";
  row.append(input, check, detail, dot);
  return row;
}
function attachTaskEvents() {
  document.querySelectorAll(".task-check").forEach((checkbox) => {
    checkbox.onchange = () => { saveTaskState(); updatePlanProgress(); };
  });
}
function saveTaskState() {
  const checked = [...document.querySelectorAll(".task-check:checked")];
  const today = localDateKey(new Date());
  safeWrite(STORAGE.done, { date: today, tasks: checked.map((input) => input.dataset.task) });
  customTasks = customTasks.map((task) => {
    const input = document.querySelector('[data-task="' + CSS.escape(task.id) + '"]');
    return { ...task, done: input ? input.checked : task.done };
  });
  learningProgress.dailyTaskMinutes[today] = Object.fromEntries(checked.map((input) => {
    const estimate = input.closest(".task-row")?.querySelector(".task-detail small")?.textContent.match(/(\d+)\s*min/i);
    return [input.dataset.task, estimate ? Number(estimate[1]) : 0];
  }));
  if (checked.length) recordLearningActivity(today);
  saveStudyStateLocally();
  renderDashboardProgress();
}
function updatePlanProgress() {
  const all = [...document.querySelectorAll(".task-check")];
  const done = all.filter((input) => input.checked).length;
  const percent = all.length ? Math.round(done / all.length * 100) : 0;
  byId("planDone").textContent = done;
  byId("planPercent").textContent = percent + "%";
  byId("planProgressFill").style.width = percent + "%";
}
function localDateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}
function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function recordLearningActivity(day = localDateKey(new Date())) {
  if (!learningProgress.activeDays.includes(day)) learningProgress.activeDays.push(day);
}
function addLocalDays(dayKey, days) {
  const date = dateFromKey(dayKey);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}
function flashcardsForFilter() {
  return flashcardFilterSubject === "All subjects"
    ? flashcards
    : flashcards.filter((card) => card.subject === flashcardFilterSubject);
}
function fillSelect(select, values, includeAll = false, currentValue = "") {
  if (!select) return;
  select.replaceChildren();
  if (includeAll) {
    const allOption = document.createElement("option");
    allOption.value = "All subjects";
    allOption.textContent = "All subjects";
    select.append(allOption);
  }
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
  if ([...select.options].some((option) => option.value === currentValue)) select.value = currentValue;
}
function renderFlashcardSelects() {
  const filterSubjects = [...new Set([...activeSubjects, ...flashcards.map((card) => card.subject)])];
  fillSelect(byId("flashcardFilter"), filterSubjects, true, flashcardFilterSubject);
  if (![...byId("flashcardFilter").options].some((option) => option.value === flashcardFilterSubject)) {
    flashcardFilterSubject = "All subjects";
    byId("flashcardFilter").value = flashcardFilterSubject;
  }
  const selectedSubject = byId("flashcardSubject").value || activeSubjects[0] || DEFAULT_SUBJECTS[0];
  fillSelect(byId("flashcardSubject"), SUBJECT_OPTIONS, false, selectedSubject);
  if (![...byId("flashcardSubject").options].some((option) => option.value === selectedSubject)) {
    byId("flashcardSubject").value = activeSubjects[0] || DEFAULT_SUBJECTS[0];
  }
  const generatorSubject = byId("flashcardGenerateSubject").value || activeSubjects[0] || DEFAULT_SUBJECTS[0];
  fillSelect(byId("flashcardGenerateSubject"), SUBJECT_OPTIONS, false, generatorSubject);
}
function setFlashcardSyncStatus(message) {
  const status = byId("flashcardSyncStatus");
  if (status) status.textContent = message;
}
function resetFlashcardSyncState() {
  clearTimeout(flashcardSyncTimer);
  flashcardSyncTimer = null;
  flashcardSyncRun += 1;
  flashcardSyncInFlight = false;
  flashcardSyncQueued = false;
  flashcardLocalRevision = 0;
}
function saveFlashcardsLocally() {
  safeWrite(STORAGE.flashcards, flashcards);
  safeWrite(STORAGE.flashcardsPending, true);
  flashcardLocalRevision += 1;
  if (!signedInProfile) {
    setFlashcardSyncStatus("Saved in this browser. Sign in to sync across devices.");
  } else if (!flashcardSyncReady) {
    flashcardSyncQueued = true;
    setFlashcardSyncStatus("Saved here. Waiting for your account deck to load…");
  } else {
    setFlashcardSyncStatus("Saving your deck to your account…");
    scheduleFlashcardSync();
  }
}
function scheduleFlashcardSync(delay = 450) {
  if (!signedInProfile) return;
  if (!flashcardSyncReady || flashcardSyncInFlight) { flashcardSyncQueued = true; return; }
  clearTimeout(flashcardSyncTimer);
  const userId = signedInProfile.id;
  const run = flashcardSyncRun;
  flashcardSyncTimer = window.setTimeout(() => { pushFlashcardsToServer(userId, run); }, delay);
}
async function pushFlashcardsToServer(userId, run) {
  if (run !== flashcardSyncRun || signedInProfile?.id !== userId) return;
  if (!flashcardSyncReady) { flashcardSyncQueued = true; return; }
  if (flashcardSyncInFlight) { flashcardSyncQueued = true; return; }
  flashcardSyncInFlight = true;
  flashcardSyncTimer = null;
  const revision = flashcardLocalRevision;
  const deckSnapshot = flashcards.map((card) => ({ ...card }));
  try {
    const response = await fetch("/api/flashcards", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ cards: deckSnapshot }),
      signal: AbortSignal.timeout(10_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Your deck couldn't sync right now.");
    if (run !== flashcardSyncRun || signedInProfile?.id !== userId) return;
    if (flashcardLocalRevision === revision) safeWrite(STORAGE.flashcardsPending, false);
    setFlashcardSyncStatus("Synced " + result.cardCount + (result.cardCount === 1 ? " card to your account." : " cards to your account."));
  } catch {
    if (run === flashcardSyncRun && signedInProfile?.id === userId) {
      setFlashcardSyncStatus("Saved on this device. Account sync will retry when you make another change or reopen Cognify.");
    }
  } finally {
    if (run === flashcardSyncRun) {
      flashcardSyncInFlight = false;
      if (signedInProfile?.id === userId && (flashcardSyncQueued || flashcardLocalRevision !== revision)) {
        flashcardSyncQueued = false;
        scheduleFlashcardSync(200);
      }
    }
  }
}
async function syncFlashcardsFromServer(userId, run) {
  const localRevision = flashcardLocalRevision;
  setFlashcardSyncStatus("Loading your account deck…");
  try {
    const response = await fetch("/api/flashcards", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Your account deck couldn't be loaded.");
    if (run !== flashcardSyncRun || signedInProfile?.id !== userId) return;
    const hasPendingChanges = safeRead(STORAGE.flashcardsPending, false) === true;
    if (result.stored === true && Array.isArray(result.cards) && !hasPendingChanges) {
      flashcards = normalizeFlashcards(result.cards);
      safeWrite(STORAGE.flashcards, flashcards);
      renderFlashcards();
      flashcardSyncReady = true;
      setFlashcardSyncStatus("Synced " + flashcards.length + (flashcards.length === 1 ? " card to your account." : " cards to your account."));
      if (flashcardLocalRevision !== localRevision) scheduleFlashcardSync(0);
      return;
    }
    flashcardSyncReady = true;
    flashcardSyncQueued = false;
    setFlashcardSyncStatus(hasPendingChanges ? "Syncing your latest browser changes to your account…" : "Saving this browser’s deck to your account…");
    await pushFlashcardsToServer(userId, run);
  } catch {
    if (run !== flashcardSyncRun || signedInProfile?.id !== userId) return;
    flashcardSyncReady = true;
    flashcardSyncQueued = false;
    setFlashcardSyncStatus("Your deck is saved in this browser. Account sync will be available when the server is updated and reachable.");
  }
}
function setStudySyncStatus(message) {
  const status = byId("studySyncStatus");
  if (status) status.textContent = message;
}
function resetStudySyncState() {
  clearTimeout(studySyncTimer);
  studySyncTimer = null;
  studySyncRun += 1;
  studySyncInFlight = false;
  studySyncQueued = false;
  studyLocalRevision = 0;
}
function saveStudyStateLocally() {
  safeWrite(STORAGE.tasks, customTasks);
  safeWrite(STORAGE.done, safeRead(STORAGE.done, []));
  safeWrite(STORAGE.progress, learningProgress);
  safeWrite(STORAGE.studyPending, true);
  studyLocalRevision += 1;
  if (!signedInProfile) {
    setStudySyncStatus("Saved in this browser. Sign in to sync across devices.");
  } else if (!studySyncReady) {
    studySyncQueued = true;
    setStudySyncStatus("Saved here. Waiting for your account study data to load…");
  } else {
    setStudySyncStatus("Saving your planner and progress to your account…");
    scheduleStudySync();
  }
}
function scheduleStudySync(delay = 450) {
  if (!signedInProfile) return;
  if (!studySyncReady || studySyncInFlight) { studySyncQueued = true; return; }
  clearTimeout(studySyncTimer);
  const userId = signedInProfile.id;
  const run = studySyncRun;
  studySyncTimer = window.setTimeout(() => { pushStudyStateToServer(userId, run); }, delay);
}
async function pushStudyStateToServer(userId, run) {
  if (run !== studySyncRun || signedInProfile?.id !== userId) return;
  if (!studySyncReady) { studySyncQueued = true; return; }
  if (studySyncInFlight) { studySyncQueued = true; return; }
  studySyncInFlight = true;
  studySyncTimer = null;
  const revision = studyLocalRevision;
  const state = {
    customTasks: customTasks.map((task) => ({ ...task })),
    done: safeRead(STORAGE.done, []),
    progress: JSON.parse(JSON.stringify(learningProgress))
  };
  try {
    const response = await fetch("/api/study/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(state),
      signal: AbortSignal.timeout(10_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Your planner couldn't sync right now.");
    if (run !== studySyncRun || signedInProfile?.id !== userId) return;
    if (studyLocalRevision === revision) safeWrite(STORAGE.studyPending, false);
    setStudySyncStatus("Planner and progress synced to your account.");
  } catch {
    if (run === studySyncRun && signedInProfile?.id === userId) {
      setStudySyncStatus("Saved on this device. Planner sync will retry when you make another change or reopen Cognify.");
    }
  } finally {
    if (run === studySyncRun) {
      studySyncInFlight = false;
      if (signedInProfile?.id === userId && (studySyncQueued || studyLocalRevision !== revision)) {
        studySyncQueued = false;
        scheduleStudySync(200);
      }
    }
  }
}
function renderAccountStudyState() {
  document.querySelectorAll("#taskList .custom-task-row").forEach((row) => row.remove());
  document.querySelectorAll("#taskList .task-check").forEach((checkbox) => { checkbox.checked = false; });
  restoreTasks();
  renderDashboardProgress();
  renderSubjectCards();
}
async function syncStudyStateFromServer(userId, run) {
  const localRevision = studyLocalRevision;
  setStudySyncStatus("Loading your planner and progress…");
  try {
    const response = await fetch("/api/study/workspace", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Your account study data couldn't be loaded.");
    if (run !== studySyncRun || signedInProfile?.id !== userId) return;
    const hasPendingChanges = safeRead(STORAGE.studyPending, false) === true;
    if (result.stored === true && Array.isArray(result.customTasks) && !hasPendingChanges) {
      customTasks = result.customTasks;
      learningProgress = normalizeLearningProgress(result.progress);
      safeWrite(STORAGE.tasks, customTasks);
      safeWrite(STORAGE.done, result.done);
      safeWrite(STORAGE.progress, learningProgress);
      renderAccountStudyState();
      studySyncReady = true;
      setStudySyncStatus("Planner and progress synced to your account.");
      if (studyLocalRevision !== localRevision) scheduleStudySync(0);
      return;
    }
    studySyncReady = true;
    studySyncQueued = false;
    setStudySyncStatus(hasPendingChanges ? "Syncing your latest browser changes to your account…" : "Saving this browser’s planner and progress to your account…");
    await pushStudyStateToServer(userId, run);
  } catch {
    if (run !== studySyncRun || signedInProfile?.id !== userId) return;
    studySyncReady = true;
    studySyncQueued = false;
    setStudySyncStatus("Your planner is saved in this browser. Account sync will be available when the server is updated and reachable.");
  }
}
function updateFlashcardGeneratorControls() {
  const button = byId("flashcardGenerateButton");
  if (!button) return;
  const status = byId("flashcardGenerateStatus");
  button.disabled = generatingFlashcards || !signedInProfile || !tutorReady || generatedFlashcards.length > 0;
  button.textContent = generatingFlashcards ? "Generating cards…" : "Generate cards";
  if (generatingFlashcards) status.textContent = "Groq is creating your set…";
  else if (!signedInProfile) status.textContent = "Sign in to generate AI flashcards.";
  else if (!tutorReady) status.textContent = "Groq is not configured on this server yet.";
  else status.textContent = flashcardGeneratorMessage;
}
function updateGeneratedFlashcardActions() {
  const selected = generatedFlashcards.filter((card) => card.selected);
  const valid = selected.every((card) => card.front.trim() && card.back.trim());
  byId("flashcardGeneratedCount").textContent = selected.length + " of " + generatedFlashcards.length + " selected";
  byId("flashcardAddSelected").disabled = selected.length === 0 || !valid;
  if (selected.length && !valid) flashcardGeneratorMessage = "Selected cards need a prompt and an answer.";
  else if (flashcardGeneratorMessage === "Selected cards need a prompt and an answer.") flashcardGeneratorMessage = "Edit the prompts or answers, then add the cards you want.";
  updateFlashcardGeneratorControls();
}
function renderGeneratedFlashcards() {
  const preview = byId("flashcardGeneratedPreview");
  const list = byId("flashcardGeneratedList");
  if (!preview || !list) return;
  list.replaceChildren();
  preview.hidden = generatedFlashcards.length === 0;
  byId("flashcardGeneratedSubject").textContent = generatedFlashcardSubject ? "For " + generatedFlashcardSubject : "";
  generatedFlashcards.forEach((card, index) => {
    const item = document.createElement("article");
    item.className = "flashcard-generated-item";
    const heading = document.createElement("div");
    heading.className = "flashcard-generated-item-heading";
    const label = document.createElement("label");
    label.className = "flashcard-generated-select";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = card.selected;
    checkbox.dataset.generatedIndex = String(index);
    checkbox.setAttribute("aria-label", "Include flashcard " + (index + 1));
    const number = document.createElement("span");
    number.textContent = "Card " + (index + 1);
    label.append(checkbox, number);
    heading.append(label);
    const frontLabel = document.createElement("label");
    frontLabel.className = "flashcard-generated-field";
    frontLabel.textContent = "Front · prompt";
    const front = document.createElement("textarea");
    front.value = card.front;
    front.maxLength = 240;
    front.rows = 2;
    front.dataset.generatedIndex = String(index);
    front.dataset.generatedField = "front";
    front.setAttribute("aria-label", "Edit prompt for card " + (index + 1));
    frontLabel.append(front);
    const backLabel = document.createElement("label");
    backLabel.className = "flashcard-generated-field";
    backLabel.textContent = "Back · answer";
    const back = document.createElement("textarea");
    back.value = card.back;
    back.maxLength = 700;
    back.rows = 3;
    back.dataset.generatedIndex = String(index);
    back.dataset.generatedField = "back";
    back.setAttribute("aria-label", "Edit answer for card " + (index + 1));
    backLabel.append(back);
    item.append(heading, frontLabel, backLabel);
    list.append(item);
  });
  updateGeneratedFlashcardActions();
  updateFlashcardGeneratorControls();
}
function clearGeneratedFlashcards(message = "One AI use is counted for each generated set.") {
  generatedFlashcards = [];
  generatedFlashcardSubject = "";
  flashcardGeneratorMessage = message;
  renderGeneratedFlashcards();
}
async function generateFlashcards(event) {
  event.preventDefault();
  if (generatingFlashcards || generatedFlashcards.length || !signedInProfile || !tutorReady) return;
  const subject = byId("flashcardGenerateSubject").value;
  const topic = byId("flashcardGenerateTopic").value.trim();
  const count = Number(byId("flashcardGenerateCount").value);
  if (!subject || !topic) {
    flashcardGeneratorMessage = "Choose a subject and enter a topic first.";
    updateFlashcardGeneratorControls();
    return;
  }
  generatingFlashcards = true;
  updateFlashcardGeneratorControls();
  try {
    const response = await fetch("/api/flashcards/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ subject, topic, count })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = response.status === 404
        ? "Cognify's server needs a restart to load AI flashcards. In the project folder, run npm.cmd run dev, then reload the app."
        : result.error || "Groq couldn't generate this set. Please try again.";
      const error = new Error(message);
      error.code = result.code;
      throw error;
    }
    if (!Array.isArray(result.cards) || result.cards.length !== count || result.cards.some((card) => !card || typeof card.front !== "string" || typeof card.back !== "string")) {
      throw new Error("Groq returned an incomplete set. Please try again.");
    }
    if (result.billing && signedInProfile) {
      signedInProfile.billing = result.billing;
      syncBillingUI(result.billing);
    }
    generatedFlashcardSubject = subject;
    generatedFlashcards = result.cards.map((card) => ({ front: card.front, back: card.back, selected: true }));
    flashcardGeneratorMessage = "Edit the prompts or answers, then add the cards you want.";
    byId("flashcardGenerateTopic").value = "";
    renderGeneratedFlashcards();
  } catch (error) {
    if (error.code === "usage_limit_reached") { window.location.assign("/pricing?limit=reached"); return; }
    flashcardGeneratorMessage = error.message || "Groq couldn't generate this set. Please try again.";
    updateFlashcardGeneratorControls();
  } finally {
    generatingFlashcards = false;
    updateFlashcardGeneratorControls();
  }
}
function saveSelectedGeneratedFlashcards() {
  const selected = generatedFlashcards.filter((card) => card.selected);
  if (!selected.length || selected.some((card) => !card.front.trim() || !card.back.trim())) {
    flashcardGeneratorMessage = "Each selected card needs a prompt and an answer.";
    updateFlashcardGeneratorControls();
    return;
  }
  if (flashcards.length + selected.length > 500) {
    flashcardGeneratorMessage = "Your deck can hold up to 500 cards. Remove a few before adding this set.";
    updateFlashcardGeneratorControls();
    return;
  }
  const subject = generatedFlashcardSubject;
  const today = localDateKey(new Date());
  const now = Date.now();
  flashcards.push(...selected.map((card, index) => ({
    id: newFlashcardId() + "-" + index,
    subject,
    front: card.front.trim(),
    back: card.back.trim(),
    createdAt: now + index,
    dueDate: today,
    intervalDays: 0,
    reviewCount: 0
  })));
  flashcardFilterSubject = subject;
  flashcardSessionQueue = [];
  flashcardSessionIndex = 0;
  flashcardSessionActive = false;
  flashcardRevealed = false;
  saveFlashcardsLocally();
  clearGeneratedFlashcards("Added " + selected.length + " AI-generated " + (selected.length === 1 ? "card" : "cards") + " to your deck.");
  renderFlashcards();
  showToast(selected.length + (selected.length === 1 ? " card was" : " cards were") + " added to your deck.", "success");
}
function formatFlashcardDueDate(dayKey) {
  const today = localDateKey(new Date());
  if (dayKey <= today) return "Ready to review";
  return "Due " + dateFromKey(dayKey).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function renderFlashcardSummary(filteredCards) {
  const today = localDateKey(new Date());
  const dueCount = flashcards.filter((card) => card.dueDate <= today).length;
  const totalCount = flashcards.length;
  byId("flashcardDueSummary").textContent = dueCount + " due today";
  byId("flashcardTotalSummary").textContent = totalCount + (totalCount === 1 ? " card in your deck" : " cards in your deck");
  byId("flashcardLibraryCount").textContent = filteredCards.length + (filteredCards.length === 1 ? " card" : " cards");
  byId("flashcardNavCount").textContent = String(totalCount);

  const filteredDue = filteredCards.filter((card) => card.dueDate <= today).length;
  const subjectName = flashcardFilterSubject === "All subjects" ? "Your deck" : flashcardFilterSubject;
  const dueMessage = filteredDue
    ? filteredDue + (filteredDue === 1 ? " card is" : " cards are") + " ready to review today."
    : "No cards are due today.";
  byId("flashcardReadyText").textContent = subjectName + " has " + filteredCards.length + (filteredCards.length === 1 ? " card. " : " cards. ") + dueMessage + " You can also review the full set.";
  const dueButton = byId("flashcardReviewDue");
  dueButton.textContent = filteredDue ? "Review due (" + filteredDue + ")" : "No cards due";
  dueButton.disabled = filteredDue === 0;
  byId("flashcardReviewAll").textContent = "Review all (" + filteredCards.length + ")";
  byId("flashcardReviewAll").disabled = filteredCards.length === 0;
}
function renderFlashcardList(filteredCards) {
  const list = byId("flashcardList");
  list.replaceChildren();
  if (!filteredCards.length) {
    const empty = document.createElement("p");
    empty.className = "flashcard-list-empty";
    empty.textContent = flashcards.length ? "No cards for this subject yet." : "Your saved cards will appear here.";
    list.append(empty);
    return;
  }
  [...filteredCards].sort((a, b) => b.createdAt - a.createdAt).forEach((card) => {
    const item = document.createElement("article");
    item.className = "flashcard-list-item";
    const meta = document.createElement("div");
    meta.className = "flashcard-list-meta";
    const subject = document.createElement("span");
    subject.className = "flashcard-subject-tag";
    subject.textContent = card.subject;
    const due = document.createElement("span");
    due.className = "flashcard-due-tag";
    due.textContent = formatFlashcardDueDate(card.dueDate);
    const front = document.createElement("strong");
    front.textContent = card.front;
    const back = document.createElement("p");
    back.textContent = card.back;
    const actions = document.createElement("div");
    actions.className = "flashcard-list-actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.dataset.flashcardAction = "edit";
    edit.dataset.flashcardId = card.id;
    edit.textContent = "Edit";
    edit.setAttribute("aria-label", "Edit flashcard: " + card.front);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "flashcard-delete-button";
    remove.dataset.flashcardAction = "delete";
    remove.dataset.flashcardId = card.id;
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", "Delete flashcard: " + card.front);
    actions.append(edit, remove);
    meta.append(subject, due);
    item.append(meta, front, back, actions);
    list.append(item);
  });
}
function renderFlashcardSession(filteredCards) {
  const empty = byId("flashcardEmptyState");
  const ready = byId("flashcardReadyPanel");
  const session = byId("flashcardSessionView");
  const hasCards = filteredCards.length > 0;
  empty.hidden = hasCards || flashcardSessionActive;
  const emptyHeading = empty.querySelector("h4");
  const emptyCopy = empty.querySelector("p");
  emptyHeading.textContent = flashcards.length ? "No cards for this subject yet" : "Your first card is a small step";
  emptyCopy.textContent = flashcards.length
    ? "Add a card for this subject or choose another subject from the filter."
    : "Add a question and its answer. Your cards will be ready here whenever you want to practice.";
  ready.hidden = !hasCards || flashcardSessionActive;
  session.hidden = !flashcardSessionActive;
  if (!flashcardSessionActive) return;

  const complete = flashcardSessionIndex >= flashcardSessionQueue.length;
  const activeCardPanel = byId("flashcardActiveCard");
  const completePanel = byId("flashcardSessionComplete");
  activeCardPanel.hidden = complete;
  completePanel.hidden = !complete;
  if (complete) {
    byId("flashcardCompleteText").textContent = "You reviewed " + flashcardSessionReviewed + (flashcardSessionReviewed === 1 ? " card." : " cards.") + (flashcardSessionAgain ? " " + flashcardSessionAgain + (flashcardSessionAgain === 1 ? " is" : " are") + " ready to try again today." : " Your remembered cards are scheduled for another day.");
    return;
  }

  const card = flashcards.find((item) => item.id === flashcardSessionQueue[flashcardSessionIndex]);
  if (!card) {
    flashcardSessionQueue = flashcardSessionQueue.filter((id) => flashcards.some((item) => item.id === id));
    flashcardSessionIndex = Math.min(flashcardSessionIndex, flashcardSessionQueue.length);
    return renderFlashcardSession(filteredCards);
  }
  byId("flashcardSessionLabel").textContent = "Card " + (flashcardSessionIndex + 1) + " of " + flashcardSessionQueue.length + " · " + card.subject;
  byId("flashcardProgressFill").style.width = Math.round((flashcardSessionIndex + 1) / flashcardSessionQueue.length * 100) + "%";
  byId("flashcardFaceLabel").textContent = flashcardRevealed ? "ANSWER" : "QUESTION";
  byId("flashcardFaceText").textContent = flashcardRevealed ? card.back : card.front;
  byId("flashcardFaceHint").textContent = flashcardRevealed ? "Choose how well you remembered" : "Select to reveal the answer";
  byId("flashcardFace").classList.toggle("is-answer", flashcardRevealed);
  byId("flashcardFace").setAttribute("aria-expanded", String(flashcardRevealed));
  byId("flashcardFace").setAttribute("aria-label", flashcardRevealed ? "Show the question" : "Show the answer");
  byId("flashcardRating").hidden = !flashcardRevealed;
}
function renderFlashcards() {
  if (!byId("flashcardList")) return;
  renderFlashcardSelects();
  const filteredCards = flashcardsForFilter();
  renderFlashcardSummary(filteredCards);
  renderFlashcardList(filteredCards);
  renderFlashcardSession(filteredCards);
}
function startFlashcardSession(dueOnly = true) {
  const today = localDateKey(new Date());
  const cards = [...flashcardsForFilter()].filter((card) => !dueOnly || card.dueDate <= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt - b.createdAt);
  if (!cards.length) return;
  flashcardSessionQueue = cards.map((card) => card.id);
  flashcardSessionIndex = 0;
  flashcardSessionReviewed = 0;
  flashcardSessionAgain = 0;
  flashcardSessionActive = true;
  flashcardRevealed = false;
  renderFlashcards();
  byId("flashcardFace").focus({ preventScroll: true });
}
function rateFlashcard(remembered) {
  if (!flashcardSessionActive || !flashcardRevealed) return;
  const card = flashcards.find((item) => item.id === flashcardSessionQueue[flashcardSessionIndex]);
  if (!card) return;
  const today = localDateKey(new Date());
  card.reviewCount += 1;
  if (remembered) {
    card.intervalDays = Math.min(card.intervalDays ? card.intervalDays * 2 : 1, 30);
    card.dueDate = addLocalDays(today, card.intervalDays);
  } else {
    card.intervalDays = 0;
    card.dueDate = today;
    flashcardSessionAgain += 1;
  }
  saveFlashcardsLocally();
  flashcardSessionReviewed += 1;
  flashcardSessionIndex += 1;
  flashcardRevealed = false;
  recordLearningActivity();
  saveStudyStateLocally();
  renderDashboardProgress();
  renderFlashcards();
  if (flashcardSessionActive && flashcardSessionIndex >= flashcardSessionQueue.length) byId("flashcardRestart").focus({ preventScroll: true });
  else if (flashcardSessionActive) byId("flashcardFace").focus({ preventScroll: true });
}
function resetFlashcardForm() {
  const form = byId("flashcardForm");
  if (!form) return;
  form.reset();
  editingFlashcardId = null;
  byId("flashcardFormKicker").textContent = "BUILD YOUR DECK";
  byId("flashcardFormTitle").textContent = "Create a flashcard";
  byId("flashcardSave").textContent = "Save card";
  byId("flashcardCancelEdit").hidden = true;
  byId("flashcardFormNote").textContent = "";
  const firstSubject = activeSubjects[0] || DEFAULT_SUBJECTS[0];
  if ([...byId("flashcardSubject").options].some((option) => option.value === firstSubject)) byId("flashcardSubject").value = firstSubject;
}
function editFlashcard(id) {
  const card = flashcards.find((item) => item.id === id);
  if (!card) return;
  editingFlashcardId = card.id;
  byId("flashcardSubject").value = card.subject;
  byId("flashcardFront").value = card.front;
  byId("flashcardBack").value = card.back;
  byId("flashcardFormKicker").textContent = "UPDATE YOUR DECK";
  byId("flashcardFormTitle").textContent = "Edit flashcard";
  byId("flashcardSave").textContent = "Save changes";
  byId("flashcardCancelEdit").hidden = false;
  byId("flashcardFormNote").textContent = "Editing this card keeps its review schedule.";
  byId("flashcardFront").focus();
}
function deleteFlashcard(id) {
  const card = flashcards.find((item) => item.id === id);
  if (!card || !window.confirm("Delete this flashcard? This cannot be undone.")) return;
  flashcards = flashcards.filter((item) => item.id !== id);
  if (editingFlashcardId === id) resetFlashcardForm();
  flashcardSessionQueue = [];
  flashcardSessionIndex = 0;
  flashcardSessionActive = false;
  flashcardRevealed = false;
  saveFlashcardsLocally();
  renderFlashcards();
  showToast("Flashcard deleted.");
}
function recordQuizAnswer(subject, correct) {
  const quiz = learningProgress.quiz;
  quiz.answered += 1;
  if (correct) quiz.correct += 1;
  if (subject && subject !== "All subjects") {
    const result = quiz.bySubject[subject] || { answered: 0, correct: 0 };
    result.answered += 1;
    if (correct) result.correct += 1;
    quiz.bySubject[subject] = result;
  }
  recordLearningActivity();
  saveStudyStateLocally();
  renderDashboardProgress();
}
function renderDashboardProgress() {
  const progress = learningProgress;
  const now = new Date();
  const today = localDateKey(now);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + index);
    return localDateKey(day);
  });
  const minutesForDay = (day) => Object.values(progress.dailyTaskMinutes[day] || {}).reduce((sum, minutes) => sum + (Number(minutes) || 0), 0);
  const weekMinutes = weekDates.map(minutesForDay);
  const totalMinutes = weekMinutes.reduce((sum, minutes) => sum + minutes, 0);
  const statCards = [...document.querySelectorAll(".stat-card")];
  if (statCards.length >= 3) {
    statCards[0].querySelector(".stat-label").textContent = "Planned study time this week";
    statCards[0].querySelector("strong").textContent = totalMinutes >= 60 ? Math.floor(totalMinutes / 60) + "h " + (totalMinutes % 60 ? totalMinutes % 60 + "m" : "") : totalMinutes + "m";
    statCards[0].querySelector(".stat-note").textContent = totalMinutes ? "From completed study plan tasks" : "Complete a study task to start your record";
    statCards[1].querySelector(".stat-label").textContent = "Practice answers correct";
    statCards[1].querySelector("strong").innerHTML = progress.quiz.correct + " <small>/ " + progress.quiz.answered + "</small>";
    statCards[1].querySelector(".stat-note").textContent = progress.quiz.answered ? "Your personal practice record" : "Try a practice round to begin";
  }
  const activeDays = new Set(progress.activeDays);
  let streak = 0;
  const streakAnchor = activeDays.has(today) ? now : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  for (let offset = 0; offset < progress.activeDays.length + 1; offset += 1) {
    const day = new Date(streakAnchor);
    day.setDate(streakAnchor.getDate() - offset);
    if (!activeDays.has(localDateKey(day))) break;
    streak += 1;
  }
  let bestStreak = 0;
  let runningStreak = 0;
  let previous = null;
  for (const key of [...activeDays].sort()) {
    const day = dateFromKey(key);
    const gap = previous ? Math.round((day - previous) / 86_400_000) : 0;
    runningStreak = gap === 1 ? runningStreak + 1 : 1;
    bestStreak = Math.max(bestStreak, runningStreak);
    previous = day;
  }
  statCards[2]?.querySelector("strong") && (statCards[2].querySelector("strong").textContent = streak + (streak === 1 ? " day" : " days"));
  if (statCards[2]) statCards[2].querySelector(".stat-note").textContent = "Your best is " + bestStreak + (bestStreak === 1 ? " day" : " days");
  const headerStreak = document.querySelector(".header-streak");
  if (headerStreak) {
    headerStreak.querySelector("strong").textContent = streak + (streak === 1 ? " day streak" : " day streak");
    headerStreak.querySelector("small").textContent = streak ? "Keep your rhythm going" : "Your first day starts today";
  }
  const streakCard = document.querySelector(".streak-card");
  if (streakCard) {
    const number = streakCard.querySelector(".streak-number");
    number.firstChild.textContent = String(streak) + " ";
    number.querySelector("small").textContent = streak === 1 ? "day" : "days";
    streakCard.querySelector(".streak-title").textContent = streak ? "You're on a roll!" : "A fresh start";
    streakCard.querySelector(".streak-copy").textContent = streak ? "A little learning each day adds up." : "Complete a study activity to build your streak.";
    const dots = [...streakCard.querySelectorAll(".streak-week span")];
    dots.forEach((dot, index) => {
      dot.classList.toggle("done", activeDays.has(weekDates[index]));
      dot.classList.toggle("today", weekDates[index] === today);
    });
    streakCard.setAttribute("aria-label", "Study streak: " + streak + " days");
  }
  const chartDays = [...document.querySelectorAll(".bar-column")];
  const chartMax = Math.max(60, ...weekMinutes);
  chartDays.forEach((column, index) => {
    const minutes = weekMinutes[index] || 0;
    const bar = column.querySelector(".bar");
    bar.style.setProperty("--bar-height", minutes ? Math.max(5, Math.round(minutes / chartMax * 100)) + "%" : "0%");
    bar.dataset.minutes = minutes + " min";
    column.classList.toggle("selected-day", weekDates[index] === today);
    column.querySelector("small").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(dateFromKey(weekDates[index])).slice(0, 1);
  });
  const chartWrap = document.querySelector(".chart-wrap");
  if (chartWrap) chartWrap.setAttribute("aria-label", "Completed study plan minutes this week: " + weekMinutes.map((minutes, index) => new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(dateFromKey(weekDates[index])) + " " + minutes).join(", "));
  const chartFooter = document.querySelector(".chart-footer strong");
  const chartCaption = document.querySelector(".chart-footer > span");
  if (chartCaption) chartCaption.innerHTML = '<i class="chart-legend"></i>Minutes from completed tasks';
  if (chartFooter) chartFooter.innerHTML = (totalMinutes >= 60 ? Math.floor(totalMinutes / 60) + "h " + (totalMinutes % 60 ? totalMinutes % 60 + "m" : "") : totalMinutes + "m") + " <small>planned</small>";
  document.querySelectorAll(".subject-card").forEach((card) => {
    const subject = card.querySelector("h3")?.textContent.trim();
    const completed = progress.completedLessons.includes(subject) ? 1 : 0;
    const tag = card.querySelector(".subject-tag");
    if (tag) tag.textContent = completed ? "LESSON COMPLETE" : "READY TO STUDY";
    const progressRow = card.querySelector(".progress-row");
    if (!progressRow) return;
    const totalLessons = Number(card.querySelector("p")?.textContent.match(/(\d+)\s+lessons?/i)?.[1]) || 1;
    const percent = Math.round(completed / totalLessons * 100);
    const progressLabel = progressRow.querySelector("span");
    const progressValue = progressRow.querySelector("strong");
    if (progressLabel) progressLabel.textContent = "Lessons completed";
    if (progressValue) progressValue.textContent = completed + " / " + totalLessons;
    const progressFill = card.querySelector(".progress-track span");
    if (progressFill) progressFill.style.width = percent + "%";
  });
}
function restoreTasks() {
  const savedDone = safeRead(STORAGE.done, []);
  const taskIds = Array.isArray(savedDone) ? savedDone : savedDone?.date === localDateKey(new Date()) ? savedDone.tasks : [];
  const completed = new Set(Array.isArray(taskIds) ? taskIds : []);
  tasks.forEach((task) => {
    const input = document.querySelector('[data-task="' + task.id + '"]');
    input.checked = completed.has(task.id);
  });
  customTasks = customTasks.map((task) => ({ ...task, done: completed.has(task.id) }));
  customTasks.forEach((task) => byId("taskList").append(createCustomTask(task)));
  attachTaskEvents();
  updatePlanProgress();
}
function renderQuiz() {
  const container = byId("quizContent");
  if (quizIndex >= quizQuestions.length) {
    const note = quizScore === quizQuestions.length ? "Perfect score! You’re building a strong foundation." : "Every question you try helps you learn. Want another round?";
    container.innerHTML = '<div class="quiz-result"><span class="quiz-result-icon">✦</span><h3>' + quizScore + ' out of ' + quizQuestions.length + ' — nice work!</h3><p>' + note + '</p><button class="modal-primary quiz-next" id="quizRestart">Try again</button></div>';
    byId("quizRestart").addEventListener("click", startQuiz);
    return;
  }
  const question = quizQuestions[quizIndex];
  quizAnswered = false;
  container.replaceChildren();
  const intro = document.createElement("p");
  intro.className = "quiz-intro";
  intro.textContent = quizQuestionSource === "groq"
    ? "Fresh questions generated by Groq. Take your time and learn from each explanation."
    : quizLoadNote || "A few low-pressure Cognify questions to help it stick. You can take your time.";
  const progress = document.createElement("div");
  progress.className = "quiz-progress-row";
  progress.innerHTML = '<span>QUESTION ' + (quizIndex + 1) + ' OF ' + quizQuestions.length + '</span><strong>' + quizScore + ' correct so far</strong>';
  const track = document.createElement("div");
  track.className = "quiz-progress-track";
  const fill = document.createElement("span");
  fill.style.width = Math.round((quizIndex + 1) / quizQuestions.length * 100) + "%";
  track.append(fill);
  const title = document.createElement("h3");
  title.className = "quiz-question";
  title.textContent = question.question;
  const choices = document.createElement("div");
  choices.className = "quiz-choices";
  const feedback = document.createElement("p");
  feedback.className = "quiz-feedback";
  feedback.setAttribute("aria-live", "polite");
  const next = document.createElement("button");
  next.className = "modal-primary quiz-next";
  next.textContent = quizIndex === quizQuestions.length - 1 ? "See how I did" : "Next question →";
  next.disabled = true;
  question.options.forEach((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "quiz-choice";
    button.textContent = String.fromCharCode(65 + index) + ".  " + option;
    button.addEventListener("click", () => {
      if (quizAnswered) return;
      quizAnswered = true;
      next.disabled = false;
      choices.querySelectorAll("button").forEach((choice) => { choice.disabled = true; });
      const correct = index === question.answer;
      if (correct) {
        quizScore += 1;
        button.classList.add("correct");
        feedback.textContent = "That’s right! " + question.explanation;
      } else {
        button.classList.add("incorrect");
        choices.children[question.answer].classList.add("correct");
        feedback.textContent = "Not quite, and that’s okay. " + question.explanation;
      }
      recordQuizAnswer(quizSubject, correct);
      progress.querySelector("strong").textContent = quizScore + " correct so far";
    });
    choices.append(button);
  });
  next.addEventListener("click", () => { quizIndex += 1; renderQuiz(); });
  container.append(intro, progress, track, title, choices, feedback, next);
}
async function startQuiz() {
  quizIndex = 0;
  quizScore = 0;
  quizAnswered = false;
  quizSubject = selectedSubject;
  openModal("quizModal");
  const container = byId("quizContent");
  container.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "quiz-intro";
  loading.textContent = "Finding a fresh set of questions…";
  container.append(loading);
  try {
    const category = selectedSubject !== "All subjects" ? "&category=" + encodeURIComponent(selectedSubject) : "";
    const response = await fetch("/api/quiz/questions?limit=5" + category, { headers: { Accept: "application/json" } });
    const result = await response.json();
    if (!response.ok) { const error = new Error(result.error || "Groq isn't available right now."); error.code = result.code; throw error; }
    if (result.billing && signedInProfile) { signedInProfile.billing = result.billing; syncBillingUI(result.billing); }
    if (!Array.isArray(result.questions) || result.questions.length === 0) throw new Error("Groq didn't generate questions for this subject yet.");
    quizQuestions = result.questions;
    quizQuestionSource = "groq";
    quizLoadNote = "";
  } catch (error) {
    if (error.code === "usage_limit_reached") { window.location.assign("/pricing?limit=reached"); return; }
    quizQuestions = sampleQuizQuestions;
    quizQuestionSource = "sample";
    quizLoadNote = "Groq is unavailable for this round, so here are Cognify’s sample practice questions. " + (error.message || "Please try again later.");
  }
  renderQuiz();
}

const sampleQuizQuestions = [
  { question: "What should you do to both sides of an equation to keep it balanced?", options: ["Add 1 every time", "Do the same operation to each side", "Change the signs"], answer: 1, explanation: "An equation is like a balanced scale. The same change on both sides keeps it equal." },
  { question: "What is one main job of the cell membrane?", options: ["Control what enters and leaves the cell", "Make sunlight", "Store the cell's DNA only"], answer: 0, explanation: "The cell membrane is a boundary that helps control what moves in and out." },
  { question: "If the same mass accelerates faster, what happened to the net force?", options: ["It decreased", "It stayed zero", "It increased"], answer: 2, explanation: "Newton’s second law says force equals mass multiplied by acceleration." },
  { question: "What does the denominator in 3/4 tell you?", options: ["How many parts we have", "How many equal parts make the whole", "How many wholes there are"], answer: 1, explanation: "The denominator tells us how many equal pieces the whole is split into." },
  { question: "Which sentence is a strong topic sentence?", options: ["Dogs", "Dogs make loyal companions because they are social and attentive", "I saw a dog yesterday"], answer: 1, explanation: "A topic sentence tells the reader the main idea that a paragraph will support." }
];
let quizQuestions = sampleQuizQuestions;

function addCustomTask() {
  const addButton = byId("addTaskButton");
  const existing = byId("newTaskInput");
  if (existing) { existing.focus(); return; }
  const form = document.createElement("form");
  form.className = "add-task-form";
  form.id = "newTaskForm";
  const input = document.createElement("input");
  input.id = "newTaskInput";
  input.maxLength = 55;
  input.required = true;
  input.placeholder = "A small goal to work on…";
  input.setAttribute("aria-label", "New study goal");
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Add";
  form.append(input, submit);
  addButton.insertAdjacentElement("beforebegin", form);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;
    const task = { id: "personal-" + Date.now().toString(36), title, done: false };
    customTasks.push(task);
    saveStudyStateLocally();
    byId("taskList").append(createCustomTask(task));
    attachTaskEvents();
    updatePlanProgress();
    form.remove();
    showToast("Added to today's plan.", "success");
  });
  input.focus();
}

function openSubjectMenu() {
  const current = document.querySelector(".subject-menu");
  if (current) { current.remove(); return; }
  const menu = document.createElement("div");
  menu.className = "subject-menu";
  ["All subjects", ...activeSubjects].forEach((subject) => {
    const option = document.createElement("button");
    option.type = "button";
    option.textContent = subject;
    option.setAttribute("aria-pressed", String(subject === selectedSubject));
    option.addEventListener("click", () => { setTutorSubject(subject); menu.remove(); });
    menu.append(option);
  });
  byId("tutorPanel").append(menu);
}

function openLesson(subject) {
  const lessons = {
    Mathematics: ["Linear equations", "An equation says that two sides have the same value. Imagine a balanced seesaw: if you take weight from one side, take the same weight from the other.", "Solve 2x + 5 = 13: subtract 5 from each side to get 2x = 8. Then divide each side by 2, so x = 4. Substitute 4 into the original to check: 2 × 4 + 5 = 13."],
    Biology: ["How cells work", "Cells are the smallest living building blocks. An animal cell has a membrane that controls what moves in and out, a nucleus that stores instructions, and mitochondria that release usable energy.", "Think of a cell like a small town: the membrane is its border, the nucleus is its library of plans, and mitochondria are the power stations. Plant cells also have chloroplasts that capture light for photosynthesis."],
    Physics: ["Forces and motion", "A force is a push or pull. It can change how fast something moves or the direction it travels. Mass is how much matter an object contains.", "Newton’s second law is F = m × a. If a 2 kg ball accelerates at 3 m/s², the force is 2 × 3 = 6 newtons. A bigger mass needs a bigger force for the same acceleration."],
    English: ["Writing a clear paragraph", "A strong paragraph usually starts with one clear main idea. Supporting details help explain that idea, and an example can make it easier to picture.", "Topic sentence: 'Daily reading can improve vocabulary.' Detail: readers meet unfamiliar words in context. Example: a student can infer a new word's meaning from the sentences around it."]
  };
  const lesson = lessons[subject] || lessons.Mathematics;
  byId("lessonSubject").textContent = subject.toUpperCase() + " · YOUR NEXT LESSON";
  byId("lessonTitle").textContent = lesson[0];
  const content = byId("lessonContent");
  content.replaceChildren();
  const intro = document.createElement("p");
  intro.textContent = lesson[1];
  const heading = document.createElement("h3");
  heading.textContent = "See it in an example";
  const example = document.createElement("div");
  example.className = "lesson-example";
  example.textContent = lesson[2];
  const check = document.createElement("p");
  check.textContent = "Take a moment to put the idea in your own words. You can ask your tutor for another example whenever you're ready.";
  const complete = document.createElement("button");
  complete.type = "button";
  complete.className = "modal-primary lesson-complete";
  complete.textContent = learningProgress.completedLessons.includes(subject) ? "Lesson completed ✓" : "Mark lesson complete";
  complete.disabled = learningProgress.completedLessons.includes(subject);
  complete.addEventListener("click", () => {
    if (!learningProgress.completedLessons.includes(subject)) learningProgress.completedLessons.push(subject);
    recordLearningActivity();
    saveStudyStateLocally();
    renderDashboardProgress();
    renderSubjectCards();
    complete.textContent = "Lesson completed ✓";
    complete.disabled = true;
    showToast("Your lesson progress has been saved.", "success");
  });
  content.append(intro, heading, example, check, complete);
  byId("lessonAskButton").dataset.subject = subject;
  byId("lessonAskButton").dataset.ask = "Teach me more about " + lesson[0].toLowerCase() + ", with a fresh example.";
  openModal("lessonModal");
}

function setActiveNav(name) {
  document.querySelectorAll("[data-nav]").forEach((button) => {
    const active = button.dataset.nav === name;
    button.classList.toggle("active", active);
    if (active && button.classList.contains("nav-item")) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}
function navigate(name) {
  setActiveNav(name);
  if (name === "tutor") { openTutor(); return; }
  if (name === "practice") { startQuiz(); return; }
  if (name === "home") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  const target = name === "subjects" ? byId("subjectsSection") : name === "flashcards" ? byId("flashcardsSection") : byId("plannerCard");
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSubjectOptions() {
  const container = byId("subjectOptions");
  if (!container) return;
  container.replaceChildren();
  for (const [department, subjects] of Object.entries(SUBJECT_GROUPS)) {
    const group = document.createElement("section");
    group.className = "subject-option-group";
    const heading = document.createElement("h3");
    heading.textContent = department;
    const list = document.createElement("div");
    list.className = "subject-option-grid";
    for (const subject of subjects) {
      const label = document.createElement("label");
      label.className = "subject-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "subjects";
      checkbox.value = subject;
      checkbox.checked = activeSubjects.includes(subject);
      const name = document.createElement("span");
      name.textContent = subject;
      label.append(checkbox, name);
      list.append(label);
    }
    group.append(heading, list);
    container.append(group);
  }
}

function renderSubjectCards() {
  const grid = byId("subjectGrid");
  if (!grid) return;
  const sampleSubjects = new Set(["Mathematics", "Biology", "Physics", "English"]);
  grid.replaceChildren();
  activeSubjects.forEach((subject, index) => {
    const card = document.createElement("article");
    card.className = "subject-card";
    const top = document.createElement("div");
    top.className = "subject-card-top";
    const icon = document.createElement("span");
    icon.className = "subject-icon subject-theme-" + (index % 4);
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = subject.slice(0, 1).toUpperCase();
    const tag = document.createElement("span");
    tag.className = "subject-tag" + (learningProgress.completedLessons.includes(subject) ? " subject-complete" : "");
    tag.textContent = learningProgress.completedLessons.includes(subject) ? "LESSON COMPLETE" : "READY TO STUDY";
    top.append(icon, tag);
    const title = document.createElement("h3");
    title.textContent = subject;
    const groupName = Object.entries(SUBJECT_GROUPS).find(([, names]) => names.includes(subject))?.[0] || "Your subjects";
    const description = document.createElement("p");
    description.textContent = groupName + " · Personalized tutoring";
    const ask = document.createElement("button");
    ask.type = "button";
    ask.className = "subject-action";
    ask.dataset.ask = "Help me get started with " + subject + ". What are the key topics, and can you explain one with an example?";
    ask.textContent = "Ask your tutor";
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";
    ask.append(arrow);
    card.append(top, title, description, ask);
    if (sampleSubjects.has(subject)) {
      const lesson = document.createElement("button");
      lesson.type = "button";
      lesson.className = "subject-action subject-lesson";
      lesson.dataset.lesson = "lesson";
      lesson.textContent = "View sample lesson";
      const lessonArrow = document.createElement("span");
      lessonArrow.setAttribute("aria-hidden", "true");
      lessonArrow.textContent = "→";
      lesson.append(lessonArrow);
      card.append(lesson);
    }
    grid.append(card);
  });
  grid.querySelectorAll("[data-ask]").forEach((button) => {
    button.addEventListener("click", () => {
      const cardSubject = button.closest(".subject-card")?.querySelector("h3")?.textContent;
      if (cardSubject) setTutorSubject(cardSubject);
      openTutor();
      byId("tutorInput").value = button.dataset.ask;
      byId("tutorInput").focus();
    });
  });
  grid.querySelectorAll("[data-lesson]").forEach((button) => {
    button.addEventListener("click", () => openLesson(button.closest(".subject-card").querySelector("h3").textContent));
  });
}

function openLearningPreferences() {
  renderSubjectOptions();
  renderThemeControls();
  byId("subjectPreferenceError").hidden = true;
  openModal("settingsModal");
}

function initDate() {
  const node = byId("welcomeDate");
  if (!node) return;
  const now = new Date();
  const hour = now.getHours();
  byId("greetingWord").textContent = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  node.textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(now).toUpperCase();
}

applyTheme(false);
syncProfile();
initDate();
restoreTasks();
renderHistory();
checkTutorStatus();
restoreAccountSession().then(async () => {
  if (await handleEmailVerificationLink()) return;
  if (await handlePasswordResetLink()) return;
  handleGoogleSignInResult();
  const query = new URLSearchParams(window.location.search);
  if (query.get("signup") === "1" && !signedInProfile) { setAccountMode("signup"); syncAccountModal(); openModal("accountModal"); }
});
configureGoogleSignIn();

document.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
["heroAskButton", "tutorCardButton"].forEach((id) => byId(id).addEventListener("click", openTutor));
byId("closeTutorButton").addEventListener("click", closeTutor);
byId("drawerScrim").addEventListener("click", closeTutor);
byId("tutorForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = byId("tutorInput");
  const question = input.value;
  if (!question.trim() || sending) return;
  input.value = "";
  input.style.height = "auto";
  askTutor(question);
});
byId("tutorInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); byId("tutorForm").requestSubmit(); }
});
byId("tutorInput").addEventListener("input", (event) => {
  event.currentTarget.style.height = "auto";
  event.currentTarget.style.height = Math.min(event.currentTarget.scrollHeight, 120) + "px";
});
document.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => {
  const input = byId("tutorInput");
  input.value = button.dataset.prompt;
  input.style.height = "auto";
  openTutor();
  askTutor(input.value);
  input.value = "";
}));
byId("subjectPicker").addEventListener("click", openSubjectMenu);
byId("practiceCardButton").addEventListener("click", startQuiz);
byId("flashcardFilter").addEventListener("change", (event) => {
  flashcardFilterSubject = event.currentTarget.value;
  flashcardSessionQueue = [];
  flashcardSessionIndex = 0;
  flashcardSessionActive = false;
  flashcardRevealed = false;
  renderFlashcards();
});
byId("flashcardGeneratorForm").addEventListener("submit", generateFlashcards);
byId("flashcardGeneratedList").addEventListener("input", (event) => {
  const field = event.target.closest("[data-generated-field]");
  if (!field) return;
  const card = generatedFlashcards[Number(field.dataset.generatedIndex)];
  if (!card) return;
  card[field.dataset.generatedField] = field.value;
  updateGeneratedFlashcardActions();
});
byId("flashcardGeneratedList").addEventListener("change", (event) => {
  const checkbox = event.target.closest("input[data-generated-index]");
  if (!checkbox) return;
  const card = generatedFlashcards[Number(checkbox.dataset.generatedIndex)];
  if (!card) return;
  card.selected = checkbox.checked;
  updateGeneratedFlashcardActions();
});
byId("flashcardAddSelected").addEventListener("click", saveSelectedGeneratedFlashcards);
byId("flashcardDiscardGenerated").addEventListener("click", () => clearGeneratedFlashcards());
byId("flashcardReviewDue").addEventListener("click", () => startFlashcardSession(true));
byId("flashcardReviewAll").addEventListener("click", () => startFlashcardSession(false));
byId("flashcardFace").addEventListener("click", () => {
  if (!flashcardSessionActive || flashcardSessionIndex >= flashcardSessionQueue.length) return;
  flashcardRevealed = !flashcardRevealed;
  renderFlashcards();
});
byId("flashcardAgain").addEventListener("click", () => rateFlashcard(false));
byId("flashcardRemembered").addEventListener("click", () => rateFlashcard(true));
byId("flashcardRestart").addEventListener("click", () => startFlashcardSession(false));
byId("flashcardFinish").addEventListener("click", () => {
  flashcardSessionActive = false;
  flashcardSessionQueue = [];
  flashcardSessionIndex = 0;
  flashcardRevealed = false;
  renderFlashcards();
});
byId("flashcardForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const subject = byId("flashcardSubject").value;
  const front = byId("flashcardFront").value.trim();
  const back = byId("flashcardBack").value.trim();
  if (!subject || !front || !back) {
    byId("flashcardFormNote").textContent = "Add a subject, a prompt, and an answer to save this card.";
    return;
  }
  const existing = editingFlashcardId ? flashcards.find((card) => card.id === editingFlashcardId) : null;
  if (existing) {
    existing.subject = subject;
    existing.front = front;
    existing.back = back;
  } else {
    flashcards.push({ id: newFlashcardId(), subject, front, back, createdAt: Date.now(), dueDate: localDateKey(new Date()), intervalDays: 0, reviewCount: 0 });
  }
  flashcardSessionQueue = [];
  flashcardSessionIndex = 0;
  flashcardSessionActive = false;
  flashcardRevealed = false;
  saveFlashcardsLocally();
  resetFlashcardForm();
  renderFlashcards();
  showToast(existing ? "Flashcard updated." : "Flashcard saved.", "success");
});
byId("flashcardCancelEdit").addEventListener("click", resetFlashcardForm);
byId("flashcardList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-flashcard-action]");
  if (!button) return;
  if (button.dataset.flashcardAction === "edit") editFlashcard(button.dataset.flashcardId);
  if (button.dataset.flashcardAction === "delete") deleteFlashcard(button.dataset.flashcardId);
});
document.querySelectorAll(".modal-close").forEach((button) => button.addEventListener("click", closeModal));
byId("modalScrim").addEventListener("click", closeModal);
byId("settingsOpen").addEventListener("click", openLearningPreferences);
[...document.querySelectorAll("[data-theme-mode]")].forEach((button) => button.addEventListener("click", () => {
  themePreference.mode = button.dataset.themeMode;
  applyTheme(true);
}));
byId("themePaletteOptions").addEventListener("click", (event) => {
  const button = event.target.closest("[data-theme-palette]");
  if (!button || !THEME_PRESETS[button.dataset.themePalette]) return;
  themePreference.palette = button.dataset.themePalette;
  if (themePreference.mode === "custom") themePreference.customColor = THEME_PRESETS[themePreference.palette].accent;
  applyTheme(true);
});
byId("customThemeColor").addEventListener("input", (event) => {
  themePreference.mode = "custom";
  themePreference.customColor = event.currentTarget.value;
  applyTheme(true);
});
["profileSettings", "topProfile"].forEach((id) => byId(id).addEventListener("click", openAccount));
byId("profileRole").addEventListener("click", openAccount);
byId("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorRegion = byId("subjectPreferenceError");
  errorRegion.hidden = true;
  const selected = [...document.querySelectorAll('#subjectOptions input[name="subjects"]:checked')].map((input) => input.value);
  if (!selected.length) {
    errorRegion.textContent = "Choose at least one subject to continue.";
    errorRegion.hidden = false;
    return;
  }
  const nextProfile = {
    name: byId("nameSetting").value.trim() || profile.name,
    level: byId("levelSetting").value,
    subjects: normalizeSubjects(selected)
  };
  if (signedInProfile) {
    try {
      const response = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(nextProfile) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your profile couldn't be saved.");
      signedInProfile = result.profile;
      syncBillingUI(signedInProfile.billing);
      nextProfile.subjects = normalizeSubjects(signedInProfile.subjects);
    } catch (error) {
      errorRegion.textContent = error.message || "Your profile couldn't be saved. Please try again.";
      errorRegion.hidden = false;
      return;
    }
  }
  profile.name = nextProfile.name;
  profile.level = nextProfile.level;
  profile.subjects = [...nextProfile.subjects];
  activeSubjects = [...nextProfile.subjects];
  if (selectedSubject !== "All subjects" && !activeSubjects.includes(selectedSubject)) setTutorSubject("All subjects");
  safeWrite(STORAGE.profile, profile);
  syncProfile();
  closeModal();
  showToast("Your learning preferences are saved.", "success");
});
byId("forgotPasswordButton").addEventListener("click", () => {
  byId("resetRequestEmail").value = byId("accountEmail").value.trim();
  byId("accountTitle").textContent = "Reset your password";
  byId("accountIntro").textContent = "We’ll email a secure link if this address belongs to a verified profile.";
  byId("accountForm").hidden = true;
  byId("forgotPasswordButton").hidden = true;
  byId("accountSwitchRow").hidden = true;
  byId("verificationPending").hidden = true;
  byId("passwordResetRequest").hidden = false;
  byId("passwordResetRequestNotice").hidden = true;
  byId("resetRequestEmail").focus();
});
byId("passwordResetBackButton").addEventListener("click", () => {
  byId("accountEmail").value = byId("resetRequestEmail").value.trim();
  setAccountMode("login");
  syncAccountModal();
});
byId("passwordResetRequestForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = byId("passwordResetRequestButton");
  const notice = byId("passwordResetRequestNotice");
  button.disabled = true;
  notice.hidden = true;
  try {
    const response = await fetch("/api/auth/request-password-reset", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: byId("resetRequestEmail").value.trim() })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "We couldn't send a reset link. Please try again later.");
    notice.textContent = result.message || "If a verified profile exists for that address, you’ll receive a reset link shortly.";
    notice.hidden = false;
  } catch (error) {
    notice.textContent = error.message || "We couldn't send a reset link. Please try again later.";
    notice.hidden = false;
  } finally { button.disabled = false; }
});
byId("accountForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = byId("accountSubmit");
  const errorRegion = byId("accountError");
  button.disabled = true;
  errorRegion.hidden = true;
  try {
    const body = { email: byId("accountEmail").value.trim(), password: byId("accountPassword").value };
    if (accountMode === "signup") { body.name = byId("signupName").value.trim(); body.level = byId("signupLevel").value; }
    const response = await fetch(accountMode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.emailVerificationRequired) {
        showEmailVerificationPending(body.email, "pending");
        return;
      }
      throw new Error(result.error || "We couldn't open your profile. Please try again.");
    }
    if (result.verificationRequired) {
      showEmailVerificationPending(body.email, result.verificationEmailStatus);
      return;
    }
    signedInProfile = result.profile;
    loadThemePreference();
    await bindAccountStorage(result.profile, result.created === true);
    byId("accountForm").reset();
    syncProfile();
    syncBillingUI(signedInProfile.billing);
    document.body.classList.remove("auth-required");
    closeModal();
    showToast("Welcome back, " + firstName() + ".", "success");
    const nextPage = new URLSearchParams(window.location.search).get("next");
    if (nextPage) {
      const nextUrl = new URL(nextPage, window.location.origin);
      if (nextUrl.origin === window.location.origin) window.location.assign(nextUrl.pathname + nextUrl.search + nextUrl.hash);
    }
  } catch (error) { errorRegion.textContent = error.message; errorRegion.hidden = false; }
  finally { button.disabled = false; }
});
byId("resendVerificationButton").addEventListener("click", async () => {
  const button = byId("resendVerificationButton");
  button.disabled = true;
  try {
    const response = await fetch("/api/auth/resend-verification", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email: pendingVerificationEmail })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "We couldn't resend the verification link. Please try again.");
    byId("verificationMessage").textContent = result.message || "If this profile needs verification, a fresh link has been sent.";
  } catch (error) {
    byId("verificationMessage").textContent = error.message || "We couldn't resend the verification link. Please try again.";
  } finally {
    window.setTimeout(() => { button.disabled = false; }, 15_000);
  }
});
byId("verificationSignInButton").addEventListener("click", () => {
  setAccountMode("login");
  syncAccountModal();
  byId("accountEmail").value = pendingVerificationEmail;
  byId("accountPassword").focus();
});
byId("passwordResetForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = byId("passwordResetSubmit");
  const errorRegion = byId("passwordResetError");
  button.disabled = true;
  errorRegion.hidden = true;
  try {
    const response = await fetch("/api/auth/reset-password", {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token: pendingPasswordResetToken, password: byId("newAccountPassword").value })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "This reset link is invalid or expired. Request a new one.");
    pendingPasswordResetToken = "";
    signedInProfile = null;
    loadThemePreference();
    clearSignedOutStudyView();
    profile.name = "Student";
    profile.level = "simple";
    profile.subjects = [...DEFAULT_SUBJECTS];
    activeSubjects = [...DEFAULT_SUBJECTS];
    safeWrite(STORAGE.profile, profile);
    syncProfile();
    byId("accountEmail").value = result.email || "";
    setAccountMode("login");
    byId("passwordResetForm").reset();
    showAuthGate();
    showToast("Password updated. Sign in with your new password.", "success");
  } catch (error) {
    errorRegion.textContent = error.message || "We couldn't update your password. Request a new link and try again.";
    errorRegion.hidden = false;
  } finally { button.disabled = false; }
});
byId("accountModeSwitch").addEventListener("click", () => setAccountMode(accountMode === "signup" ? "login" : "signup"));
byId("accountPreferences").addEventListener("click", openLearningPreferences);
byId("accountSignOut").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error();
  } catch { showToast("You couldn’t be signed out just now. Please try again.", "error"); return; }
  clearSignedOutStudyView();
  signedInProfile = null; profile.name = "Student"; profile.level = "simple"; profile.subjects = [...DEFAULT_SUBJECTS]; activeSubjects = [...DEFAULT_SUBJECTS]; accountMode = "login";
  loadThemePreference();
  safeWrite(STORAGE.profile, profile); syncProfile(); showAuthGate();
});
byId("lessonAskButton").addEventListener("click", (event) => {
  const question = event.currentTarget.dataset.ask;
  const subject = event.currentTarget.dataset.subject;
  closeModal();
  setTutorSubject(subject);
  openTutor();
  byId("tutorInput").value = question;
  byId("tutorInput").focus();
});
byId("allSubjectsButton").addEventListener("click", openLearningPreferences);
byId("weekFilter").addEventListener("click", () => {
  const previous = byId("weekFilter").dataset.previous === "true";
  byId("weekFilter").dataset.previous = String(!previous);
  byId("weekFilter").innerHTML = previous ? 'This week <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 6 4.5 4.5L12.5 6"/></svg>' : 'Last week <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 6 4.5 4.5L12.5 6"/></svg>';
  const minutes = previous ? [35, 52, 27, 64, 46, 58, 12] : [41, 33, 58, 22, 49, 36, 55];
  document.querySelectorAll(".bar").forEach((bar, index) => {
    bar.style.setProperty("--bar-height", Math.round(minutes[index] / 64 * 100) + "%");
    bar.dataset.minutes = minutes[index] + " min";
  });
});
byId("newChatButton").addEventListener("click", () => {
  chatHistory = [];
  safeWrite(STORAGE.chat, chatHistory);
  byId("chatMessages").replaceChildren();
  byId("starterPrompts").hidden = false;
  showToast("A new conversation is ready.");
});
byId("planMore").addEventListener("click", () => openModal("settingsModal"));
byId("notificationsButton").addEventListener("click", (event) => {
  const existing = document.querySelector(".notification-popover");
  if (existing) { existing.remove(); return; }
  const popover = document.createElement("div");
  popover.className = "notification-popover";
  const streak = document.querySelector(".stat-card:last-child strong")?.textContent || "0 days";
  const message = document.createElement("p");
  message.textContent = streak.startsWith("0")
    ? "Check off one small goal or finish a lesson to start your personal streak."
    : "Your " + streak + " streak is going strong. Check off one small goal today to keep it going.";
  const heading = document.createElement("strong");
  heading.textContent = "You’re building a lovely learning habit ✦";
  popover.replaceChildren(heading, message);
  event.currentTarget.parentElement.append(popover);
  setTimeout(() => { if (popover.isConnected) popover.remove(); }, 5000);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (document.body.classList.contains("modal-open")) closeModal();
  else closeTutor();
  document.querySelector(".subject-menu")?.remove();
});

byId("addTaskButton").addEventListener("click", addCustomTask);



