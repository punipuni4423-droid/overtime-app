import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const APP_NAME = "freee-auto-approve";
const HR_API_BASE = "https://api.freee.co.jp/hr/api/v1";
const TOKEN_ENDPOINT = "https://accounts.secure.freee.co.jp/public_api/token";
const APPDATA_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "overtime-app");
const CONFIG_PATH = path.join(APPDATA_DIR, "config.json");
const LOG_DIR = path.join(APPDATA_DIR, "logs");
const NOTIFICATION_PATH = path.join(APPDATA_DIR, "auto-approval-notifications.json");
const SESSION_PATH = path.join(os.homedir(), ".overtime-app", "browser-session.json");
const EXECUTE = process.argv.includes("--execute");
const DRY_RUN = process.argv.includes("--dry-run") || !EXECUTE;

const REQUEST_TYPES = {
  overtime: {
    label: "残業申請",
    pathSegment: "overtime_works",
    detailKey: "overtime_work",
    approvalType: "ApprovalRequest::OvertimeWork",
    expectedRouteIds: [881216],
    expectedRouteNames: ["① 残業申請 （Over Time）"]
  },
  paid_holiday: {
    label: "有給申請",
    pathSegment: "paid_holidays",
    detailKey: "paid_holiday",
    approvalType: "ApprovalRequest::PaidHoliday",
    expectedRouteIds: [881725],
    expectedRouteNames: ["②遅刻・早退・ 休暇申請（Leave Request）"]
  },
  work_time: {
    label: "勤務時間修正",
    pathSegment: "work_times",
    detailKey: "work_time",
    approvalType: "ApprovalRequest::WorkTime",
    expectedRouteIds: [1406896],
    expectedRouteNames: [
      "① 残業申請 （Over Time）",
      "① 残業申請 ・打刻修正（Over Time・Time card correction）"
    ]
  }
};

function parseRequestTypes() {
  const typeIndex = process.argv.indexOf("--type");
  const rawType = typeIndex >= 0 ? process.argv[typeIndex + 1] : "work_time";
  if (rawType === "all") return Object.keys(REQUEST_TYPES);
  if (!REQUEST_TYPES[rawType]) {
    throw new Error(`自動承認の対象種別が不正です: ${rawType || "(empty)"}`);
  }
  return [rawType];
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logLine(message, extra = undefined) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const line = JSON.stringify({
    at: nowIso(),
    app: APP_NAME,
    message,
    ...(extra === undefined ? {} : { extra })
  });
  fs.appendFileSync(path.join(LOG_DIR, "auto-approve-requests.log"), `${line}\n`, "utf8");
  console.log(line);
}

function showErrorWindow(title, message) {
  const safeTitle = String(title || "freee自動承認エラー").replace(/'@/g, "' @");
  const safeMessage = String(message || "不明なエラーが発生しました。").replace(/'@/g, "' @");
  const command = `
Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(@'
${safeMessage}
'@, @'
${safeTitle}
'@, 'OK', 'Error') | Out-Null
`;
  const encoded = Buffer.from(command, "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoProfile", "-STA", "-EncodedCommand", encoded], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
}

function readConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function writeConfig(config) {
  const backupPath = `${CONFIG_PATH}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(CONFIG_PATH, backupPath);
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function normalizeRouteIds(routeIds) {
  const source = Array.isArray(routeIds) ? routeIds : [];
  return Array.from(new Set(source.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))).sort((a, b) => a - b);
}

function getAllowedRouteIds(config, typeKey, typeConfig) {
  const configured = normalizeRouteIds(config.AUTO_APPROVAL_ALLOWED_ROUTE_IDS?.[typeKey]);
  return configured.length > 0 ? configured : typeConfig.expectedRouteIds;
}

function normalizeRouteName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[①１]/g, "1")
    .replace(/[\s・,，、()（）\-_/]/g, "");
}

function routeMatches(request, typeConfig, allowedRouteIds) {
  const routeId = Number(request.approval_flow_route_id);
  const idOk = allowedRouteIds.includes(routeId);
  return idOk;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    const error = new Error(`HTTP ${response.status}: ${detail}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function refreshAccessToken(config) {
  if (!config.CLIENT_ID || !config.CLIENT_SECRET || !config.refresh_token) {
    throw new Error("OAuth設定またはrefresh_tokenが見つかりません。既存アプリでfreee認証をやり直してください。");
  }
  const data = await requestJson(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: config.CLIENT_ID,
      client_secret: config.CLIENT_SECRET,
      refresh_token: config.refresh_token
    })
  });
  const createdAt = data.created_at || Math.floor(Date.now() / 1000);
  const expiresIn = data.expires_in || 21600;
  config.access_token = data.access_token;
  config.refresh_token = data.refresh_token;
  config.created_at = createdAt;
  config.expires_in = expiresIn;
  config.expires_at = createdAt + expiresIn;
  config.ACCESS_TOKEN = data.access_token;
  writeConfig(config);
  logLine("token refreshed");
  return config.access_token;
}

async function getValidAccessToken(config) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Number(config.expires_at || 0);
  if (config.access_token && expiresAt - 300 > now) {
    return config.access_token;
  }
  return await refreshAccessToken(config);
}

async function freeeGet(token, endpoint, params) {
  const url = new URL(`${HR_API_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return await requestJson(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
}

function loadSessionState() {
  try {
    if (!fs.existsSync(SESSION_PATH)) return null;
    return JSON.parse(fs.readFileSync(SESSION_PATH, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    logLine("browser session load failed", { error: error.message });
    return null;
  }
}

async function saveSessionState(context) {
  fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
  const state = await context.storageState();
  fs.writeFileSync(SESSION_PATH, JSON.stringify(state), "utf8");
}

async function findSelector(page, selectors, timeout = 10000) {
  const deadline = Date.now() + timeout;
  for (const selector of selectors) {
    const remaining = Math.max(300, deadline - Date.now());
    const handle = await page.waitForSelector(selector, { state: "attached", timeout: remaining }).catch(() => null);
    if (handle) return selector;
  }
  return null;
}

async function doLogin(page, context, email, password, savedSession) {
  const loginUrl = "https://accounts.secure.freee.co.jp/login/hr";
  const checkUrl = "https://p.secure.freee.co.jp/";
  if (savedSession) {
    await page.goto(checkUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
  }
  const needsLogin = !savedSession || page.url().includes("accounts.secure.freee.co.jp") || page.url().includes("login");
  if (!needsLogin) return;

  logLine("browser login required");
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  const emailSelector = await findSelector(page, [
    "input#loginIdField",
    'input[name="user[email]"]',
    "input#user_email",
    'input[type="email"]',
    'input[placeholder*="メール"]'
  ], 10000);
  if (!emailSelector) throw new Error("メールアドレス入力欄が見つかりませんでした。");
  await page.fill(emailSelector, email);

  let passwordSelector = await findSelector(page, [
    "input#passwordField",
    'input[name="user[password]"]',
    "input#user_password",
    'input[type="password"]'
  ], 3000);
  if (!passwordSelector) {
    const nextButton = await page.$('input[type="submit"][value*="次へ"], button:has-text("次へ")');
    if (nextButton) {
      await nextButton.click();
      passwordSelector = await findSelector(page, ['input[type="password"]'], 5000);
    }
  }
  if (!passwordSelector) throw new Error("パスワード入力欄が見つかりませんでした。");
  await page.fill(passwordSelector, password);

  const loginSelector = await findSelector(page, [
    'input[type="submit"]',
    'button[type="submit"]:has-text("ログイン")',
    'button:has-text("ログイン")',
    ".vb-button--appearancePrimary"
  ], 5000);
  if (!loginSelector) throw new Error("ログインボタンが見つかりませんでした。");
  await Promise.all([
    page.waitForURL((url) => !url.toString().includes("accounts.secure.freee.co.jp"), { timeout: 20000 }).catch(() => {}),
    page.click(loginSelector)
  ]);
  if (page.url().includes("accounts.secure.freee.co.jp")) {
    const loginError = await page.textContent(".vb-flash--error, .alert-danger").catch(() => null);
    throw new Error(loginError || "ログイン後の遷移がタイムアウトしました。");
  }
  await saveSessionState(context);
  logLine("browser login confirmed");
}

function buildApproverListUrl(typeConfig) {
  const params = new URLSearchParams({
    type: typeConfig.approvalType,
    status: "in_progress",
    per: "100"
  });
  return `https://p.secure.freee.co.jp/approval_requests#/approvals?${params.toString()}`;
}

async function approveViaWebBulk(config, typeConfig, candidates) {
  if (candidates.length === 0) return new Map();
  const email = String(config.FREEE_EMAIL || "").trim();
  const password = String(config.FREEE_PASSWORD || "");
  if (!email || !password) {
    throw new Error("Web一括承認には既存アプリ設定のFREEE_EMAIL/FREEE_PASSWORDが必要です。");
  }

  const { chromium } = await import("playwright-core");
  const debugMode = process.env.RPA_DEBUG === "1" || process.env.RPA_DEBUG === "true";
  const savedSession = loadSessionState();
  const browser = await chromium.launch({
    channel: "msedge",
    headless: !debugMode,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
  }).catch(() => chromium.launch({
    headless: !debugMode,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
  }));

  const attempts = new Map();
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ...(savedSession ? { storageState: savedSession } : {})
    });
    const page = await context.newPage();
    if (!debugMode) {
      await page.route("**/*", (route) => {
        if (["image", "media", "font"].includes(route.request().resourceType())) route.abort();
        else route.continue();
      });
    }
    await doLogin(page, context, email, password, savedSession);
    await saveSessionState(context);

    const url = buildApproverListUrl(typeConfig);
    logLine("browser approvals list opened", { type: typeConfig.label, url });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const listReady = await page.waitForSelector(
      '[data-testid="一括承認ボタン"], button[data-test="一括承認ボタン"], button:has-text("一括承認")',
      { state: "attached", timeout: 15000 }
    ).catch(() => null);
    if (!listReady) throw new Error(`${typeConfig.label}の承認一覧で一括承認ボタンが見つかりませんでした。`);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    const checkedIds = [];
    for (const decision of candidates) {
      const id = String(decision.summary.id);
      const selectors = [
        `tr:has(a[href*="approvals/${id}?"]) input.vb-checkBoxCell__input[type="checkbox"]`,
        `tr:has(a[href*="approvals/${id}?"]) input[type="checkbox"][aria-label="この行を選択"]`,
        `tr:has(a[href*="approvals/${id}"]) input[type="checkbox"]`
      ];
      let checked = false;
      for (const selector of selectors) {
        const checkbox = page.locator(selector).first();
        if (await checkbox.count() > 0) {
          await checkbox.click({ timeout: 3000 });
          checked = true;
          checkedIds.push(id);
          break;
        }
      }
      attempts.set(id, { checked, apiSuccess: false });
      if (!checked) logLine("browser row not found", decision.summary);
    }

    if (checkedIds.length === 0) return attempts;

    const responsePromise = page.waitForResponse((response) => {
      const method = response.request().method();
      if (method === "GET" || method === "OPTIONS") return false;
      const responseUrl = response.url();
      return responseUrl.includes("freee.co.jp") && responseUrl.includes("approval");
    }, { timeout: 15000 }).catch(() => null);

    const bulkButton = page.locator('[data-testid="一括承認ボタン"], button[data-test="一括承認ボタン"], button:has-text("一括承認")').first();
    await bulkButton.click({ timeout: 5000 });
    const confirmButton = await page.waitForSelector(
      'div[role="dialog"] button.vb-button--appearancePrimary:not(:disabled), div[role="dialog"] button:has-text("承認"):not(:disabled), div[role="dialog"] button:has-text("OK"):not(:disabled), div[role="dialog"] button:has-text("はい"):not(:disabled)',
      { state: "visible", timeout: 3000 }
    ).catch(() => null);
    if (confirmButton) await confirmButton.click();

    const response = await responsePromise;
    const apiSuccess = response ? response.status() >= 200 && response.status() < 300 : false;
    for (const id of checkedIds) {
      attempts.set(id, { checked: true, apiSuccess });
    }
    await page.waitForTimeout(2000);
    return attempts;
  } finally {
    await browser.close();
  }
}

async function waitForApprovalCompletion(token, companyId, typeConfig, requestId, currentUserId, attempts = 8, intervalMs = 2000) {
  let refreshed = null;
  let stillCurrentApprover = true;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(intervalMs);
    const detail = await freeeGet(token, `/approval_requests/${typeConfig.pathSegment}/${requestId}`, { company_id: companyId });
    refreshed = detail[typeConfig.detailKey] || detail;
    stillCurrentApprover = isCurrentApprover(refreshed, currentUserId);
    if (refreshed.status === "approved" || !stillCurrentApprover) {
      return { completed: true, approved: refreshed.status === "approved", stillCurrentApprover, refreshed };
    }
  }
  return { completed: false, approved: false, stillCurrentApprover, refreshed };
}

function isCurrentApprover(request, currentUserId) {
  const myId = String(currentUserId);
  const currentStepId = request.current_step_id;
  const steps = Array.isArray(request.approval_flow_steps) ? request.approval_flow_steps : [];
  if (steps.length > 0 && currentStepId != null) {
    const currentStep = steps.find((step) => String(step.id) === String(currentStepId));
    if (currentStep) {
      const stepApproverIds = Array.isArray(currentStep.approver_ids) ? currentStep.approver_ids : currentStep.approver_id != null ? [currentStep.approver_id] : [];
      if (stepApproverIds.length > 0) return stepApproverIds.some((id) => String(id) === myId);
    }
  }
  const approverIds = Array.isArray(request.approver_ids) ? request.approver_ids.map(String) : [];
  return approverIds.includes(myId);
}

function buildDecision(typeKey, typeConfig, request, currentUserId, allowedRouteIds) {
  const routeName = request.approval_flow_route_name || "";
  const statusOk = request.status === "in_progress";
  const approverOk = isCurrentApprover(request, currentUserId);
  const routeOk = routeMatches(request, typeConfig, allowedRouteIds);
  const autoCheckOk = request.passed_auto_check !== false;
  const reasons = [];
  if (!statusOk) reasons.push(`status=${request.status}`);
  if (!approverOk) reasons.push("current user is not an approver");
  if (!routeOk) reasons.push(`route=${request.approval_flow_route_id || "(empty)"} ${routeName || "(empty)"}`);
  if (!autoCheckOk) reasons.push("passed_auto_check=false");
  return {
    approve: statusOk && approverOk && routeOk && autoCheckOk,
    routeMismatch: statusOk && approverOk && !routeOk,
    reasons,
    summary: {
      type: typeKey,
      typeLabel: typeConfig.label,
      id: request.id,
      applicationNumber: request.application_number,
      status: request.status,
      applicantId: request.applicant_id,
      targetDate: request.target_date,
      issueDate: request.issue_date,
      routeId: request.approval_flow_route_id,
      routeName,
      expectedRouteIds: allowedRouteIds,
      expectedRouteNames: typeConfig.expectedRouteNames,
      currentStepId: request.current_step_id,
      currentRound: request.current_round ?? 0,
      passedAutoCheck: request.passed_auto_check
    }
  };
}

function readNotifications() {
  try {
    if (!fs.existsSync(NOTIFICATION_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(NOTIFICATION_PATH, "utf8").replace(/^\uFEFF/, ""));
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.notifications)) return data.notifications;
  } catch (error) {
    logLine("notification read failed", { error: error.message });
  }
  return [];
}

function writeNotifications(notifications) {
  fs.mkdirSync(path.dirname(NOTIFICATION_PATH), { recursive: true });
  fs.writeFileSync(NOTIFICATION_PATH, JSON.stringify({ notifications: notifications.slice(-50) }, null, 2), "utf8");
}

function appendRouteMismatchNotification(typeKey, typeConfig, mismatches) {
  if (mismatches.length === 0) return;
  const current = readNotifications();
  const existingKeys = new Set();
  for (const notification of current) {
    for (const item of notification.items || []) {
      if (item.key) existingKeys.add(item.key);
    }
  }
  const items = mismatches.map((decision) => {
    const s = decision.summary;
    return {
      key: `${typeKey}-${s.id}-${s.routeId || "none"}`,
      applicationNumber: s.applicationNumber,
      requestId: s.id,
      targetDate: s.targetDate || s.issueDate || "",
      routeId: s.routeId ?? null,
      routeName: s.routeName || "",
      expectedRouteIds: s.expectedRouteIds,
      expectedRouteNames: s.expectedRouteNames
    };
  }).filter((item) => !existingKeys.has(item.key));
  if (items.length === 0) return;
  current.push({
    id: `${Date.now()}-${typeKey}`,
    createdAt: nowIso(),
    kind: "route_mismatch",
    requestType: typeKey,
    requestTypeLabel: typeConfig.label,
    title: `${typeConfig.label}の申請経路エラー`,
    message: "正しい申請経路ではないため、自動承認を停止しました。",
    items
  });
  writeNotifications(current);
  logLine("route mismatch notification queued", { type: typeKey, count: items.length });
}

async function fetchRequestDetails(token, companyId, typeConfig) {
  const list = await freeeGet(token, `/approval_requests/${typeConfig.pathSegment}`, {
    company_id: companyId,
    status: "in_progress",
    limit: 100,
    offset: 0
  });
  const rawItems = Array.isArray(list[typeConfig.pathSegment]) ? list[typeConfig.pathSegment] : [];
  const details = [];
  for (const raw of rawItems) {
    const detail = await freeeGet(token, `/approval_requests/${typeConfig.pathSegment}/${raw.id}`, { company_id: companyId });
    details.push(detail[typeConfig.detailKey] || detail);
  }
  return details;
}

async function runForType(typeKey, config, token, companyId, currentUserId) {
  const typeConfig = REQUEST_TYPES[typeKey];
  const allowedRouteIds = getAllowedRouteIds(config, typeKey, typeConfig);
  logLine(DRY_RUN ? "dry run started" : "execution started", {
    type: typeKey,
    label: typeConfig.label,
    companyId,
    currentUserId,
    expectedRouteIds: allowedRouteIds,
    expectedRouteNames: typeConfig.expectedRouteNames
  });

  const requests = await fetchRequestDetails(token, companyId, typeConfig);
  const decisions = requests.map((request) => buildDecision(typeKey, typeConfig, request, currentUserId, allowedRouteIds));
  const candidates = decisions.filter((decision) => decision.approve);
  const skipped = decisions.filter((decision) => !decision.approve);
  const routeMismatches = skipped.filter((decision) => decision.routeMismatch);
  appendRouteMismatchNotification(typeKey, typeConfig, routeMismatches);

  for (const decision of candidates) {
    logLine("candidate", decision.summary);
  }
  for (const decision of skipped) {
    logLine("skipped", { ...decision.summary, reasons: decision.reasons });
  }

  const results = [];
  if (!DRY_RUN) {
    const webAttempts = await approveViaWebBulk(config, typeConfig, candidates);
    for (const decision of candidates) {
      const item = decision.summary;
      try {
        const attempt = webAttempts.get(String(item.id));
        if (!attempt?.checked) {
          throw new Error(attempt?.error || "Web承認一覧で対象行が見つからなかったため未実行です。");
        }
        const status = await waitForApprovalCompletion(token, companyId, typeConfig, item.id, currentUserId, 8, 2000);
        if (!status.completed) {
          throw new Error(`Web一括承認後も現在の承認者のままです: ${status.refreshed?.status || "(empty)"}`);
        }
        results.push({ id: item.id, applicationNumber: item.applicationNumber, success: true });
        logLine("approved", { type: typeKey, id: item.id, applicationNumber: item.applicationNumber, via: "web_bulk" });
      } catch (error) {
        results.push({ id: item.id, applicationNumber: item.applicationNumber, success: false, error: error.message });
        logLine("approval failed", { type: typeKey, id: item.id, applicationNumber: item.applicationNumber, error: error.message });
      }
    }
  }

  const failed = results.filter((result) => !result.success);
  const resultSummary = {
    type: typeKey,
    dryRun: DRY_RUN,
    scanned: decisions.length,
    candidates: candidates.length,
    skipped: skipped.length,
    routeMismatches: routeMismatches.length,
    approved: results.filter((result) => result.success).length,
    failed: failed.length
  };
  logLine("finished", resultSummary);
  return { typeKey, typeConfig, failed, resultSummary };
}

async function main() {
  const typeKeys = parseRequestTypes();
  const config = readConfig();
  const token = await getValidAccessToken(config);
  const me = await freeeGet(token, "/users/me");
  const companyId = Number(config.COMPANY_ID || me.companies?.[0]?.id);
  const currentUserId = Number(me.id);
  if (!companyId || !currentUserId) throw new Error("company_idまたはcurrent_user_idを取得できませんでした。");

  const allResults = [];
  for (const typeKey of typeKeys) {
    allResults.push(await runForType(typeKey, config, token, companyId, currentUserId));
  }

  const failed = allResults.flatMap((result) => result.failed.map((item) => ({ ...item, typeLabel: result.typeConfig.label })));
  if (failed.length > 0) {
    showErrorWindow(
      "freee自動承認エラー",
      `自動承認で ${failed.length} 件失敗しました。\n\n` +
        failed.map((item) => `${item.typeLabel} #${item.applicationNumber ?? item.id}: ${item.error}`).join("\n")
    );
    process.exitCode = 2;
  }
}

main().catch((error) => {
  logLine("fatal error", { error: error.message, stack: error.stack });
  showErrorWindow("freee自動承認エラー", error.message);
  process.exitCode = 1;
});
