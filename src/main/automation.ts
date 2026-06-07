import { chromium, Page, BrowserContext } from 'playwright-core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { checkNonWorkingDay } from './holidays';

export interface MonthlyClosePayload {
    email: string;
    password: string;
    companyId: number;
    applicantId: number;
    /** 対象月の初日。例: "2026-03-01" */
    targetDate: string;
    comment: string;
    routeId: number;
    routeName: string;
    departmentId?: number;
    departmentName?: string;
}

export interface PaidLeavePayload {
    email: string;
    password: string;
    companyId: number;
    targetDate: string;
    /** 全日: full_day, 午前半休: am_half, 午後半休: pm_half */
    leaveUnit: 'full_day' | 'am_half' | 'pm_half';
    comment: string;
    routeId: number;
    routeName: string;
    departmentId?: number;
    departmentName?: string;
}

export interface AutomationPayload {
  email: string;
  password: string;
  companyId: number;
  targetDate: string;
  startAt: string;
  endAt: string;
  comment: string;
  routeId: number;
  /** 申請経路の表示名（comboboxで完全一致選択するため必須）。例: ① 残業申請 (Over Time) */
  routeName: string;
  departmentId?: number;
  /** 部署の表示名（comboboxで選択する場合に使用）。例: Hospitality, - RMS */
  departmentName?: string;
}

export interface ManagerOvertimeBrowserPayload {
    email: string;
    password: string;
    year: number;
    month: number;
    thresholdMins: number;
    headless?: boolean;
}

export interface ManagerOvertimeBrowserItem {
    employeeId: number;
    employeeNumber: string;
    employeeName: string;
    canReadSummary: boolean;
    overThreshold: boolean;
    workDays: number;
    totalWorkMins: number;
    normalWorkMins: number;
    legalOvertimeMins: number;
    overtimeMins: number;
    totalOvertimeMins: number;
    prescribedHolidayWorkMins: number;
    holidayWorkMins: number;
    latenightWorkMins: number;
    absenceDays: number;
    paidHolidays: number;
    paidHolidaysLeft: number;
    latenessEarlyLeavingMins: number;
}

export interface ManagerOvertimeBrowserResult {
    source: 'web';
    url: string;
    items: ManagerOvertimeBrowserItem[];
}

// セッション保存先（ログイン済みCookieを再利用してログインをスキップ）
const SESSION_PATH = path.join(os.homedir(), '.overtime-app', 'browser-session.json');

function loadSessionState(): object | null {
    try {
        if (fs.existsSync(SESSION_PATH)) {
            return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
        }
    } catch { /* ignore */ }
    return null;
}

async function saveSessionState(context: BrowserContext): Promise<void> {
    try {
        const state = await context.storageState();
        fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
        fs.writeFileSync(SESSION_PATH, JSON.stringify(state));
        console.log('[RPA] Session saved.');
    } catch (e) {
        console.warn('[RPA] Failed to save session:', e);
    }
}

/** エラー時のページ状態記録（スクリーンショット）*/
async function logPageState(page: Page, label: string) {
    try {
        const screenshotPath = `rpa_debug_${label}_${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.log(`[RPA DEBUG] ${label} | URL: ${page.url()} | Screenshot: ${screenshotPath}`);
    } catch { /* ignore */ }
}

/**
 * Vibe カスタムコンボボックスの高速処理。
 * - React native setter でキーボードタイピングを排除（charDelay 0）
 * - オプション探索・クリックは Playwright locator（React synthetic event 発火）
 */
async function handleCombobox(page: Page, selector: string, valueText: string) {
    const trimmed = (valueText || '').trim();
    if (!trimmed) return;
    console.log(`[RPA] Combobox: ${selector} -> "${trimmed}"`);

    try {
        // 1. フォーカス（JS evaluate でスクロールなし）
        await page.evaluate((sel) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            if (!el) throw new Error(`Not found: ${sel}`);
            el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            el.focus();
            el.click();
        }, selector);

        // 2. React native setter で検索文字列を注入（keyboard.type より高速）
        //    先頭の装飾文字（①②...）を除いた最初の6文字を検索キーにする
        const searchKey = trimmed.replace(/^[\s①-⑩・\-]+/, '').slice(0, 6).trim() || trimmed.slice(0, 6);
        await page.evaluate(({ sel, val }) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            if (!el) return;
            // まず既存値をクリア
            const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (nativeSet) { nativeSet.call(el, ''); }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            // 検索値を注入
            if (nativeSet) { nativeSet.call(el, val); } else { el.value = val; }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, { sel: selector, val: searchKey });

        // 3. 視覚的リストボックスが開くまで待つ
        //    aria-controls は ARIA 用（クリックハンドラなし）。
        //    実際に React イベントハンドラがあるのは .vb-comboBox__listBox--open 内のオプション。
        const visualItemSel = '.vb-comboBox__listBox--open [role="option"]';
        await page.waitForSelector(visualItemSel, { state: 'attached', timeout: 2000 }).catch(() => {});

        // 4. テキスト照合 + React フルイベントシーケンス発火（evaluate 1回で完結）
        //    vb-scrollPortal の pointer-events 遮断は evaluate + dispatchEvent では関係ない
        const clicked = await page.evaluate(({ optSel, target }: { optSel: string; target: string }) => {
            const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
            const options = Array.from(document.querySelectorAll<HTMLElement>(optSel));
            if (!options.length) return { ok: false, text: '' };
            const t = norm(target);
            let chosen: HTMLElement | null = null;
            for (const opt of options) {
                const txt = norm(opt.textContent || '');
                if (txt === t) { chosen = opt; break; }
            }
            if (!chosen) {
                for (const opt of options) {
                    if (norm(opt.textContent || '').includes(t)) { chosen = opt; break; }
                }
            }
            if (!chosen) chosen = options[0];

            // React 17+ root-delegation: bubbles:true でルートまで届く
            for (const evtType of ['pointerover','mouseover','pointerdown','mousedown',
                                   'pointerup','mouseup','click']) {
                chosen.dispatchEvent(new MouseEvent(evtType, {
                    bubbles: true, cancelable: true, view: window,
                    buttons: evtType.endsWith('down') ? 1 : 0
                }));
            }
            return { ok: true, text: chosen.textContent?.trim() ?? '' };
        }, { optSel: visualItemSel, target: trimmed });

        if (clicked.ok) {
            console.log(`[RPA] Selected: "${clicked.text}"`);
        } else {
            // オプションが出なかった場合、少し待ってリトライ（SPA初期化遅延対策）
            console.warn(`[RPA] No options found for ${selector}, retrying after 1s...`);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(1000);
            await page.evaluate((sel) => {
                const el = document.querySelector(sel) as HTMLInputElement | null;
                if (el) { el.scrollIntoView({ block: 'nearest' }); el.focus(); el.click(); }
            }, selector);
            const retrySearchKey = trimmed.replace(/^[\s①-⑩・\-]+/, '').slice(0, 6).trim() || trimmed.slice(0, 6);
            await page.evaluate(({ sel, val }) => {
                const el = document.querySelector(sel) as HTMLInputElement | null;
                if (!el) return;
                const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
                if (nativeSet) { nativeSet.call(el, ''); }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                if (nativeSet) { nativeSet.call(el, val); } else { el.value = val; }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, { sel: selector, val: retrySearchKey });
            await page.waitForSelector(visualItemSel, { state: 'attached', timeout: 3000 }).catch(() => {});
            const retryClicked = await page.evaluate(({ optSel, target }: { optSel: string; target: string }) => {
                const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
                const options = Array.from(document.querySelectorAll<HTMLElement>(optSel));
                if (!options.length) return { ok: false, text: '' };
                let chosen = options.find(o => norm(o.textContent || '') === norm(target)) || options.find(o => norm(o.textContent || '').includes(norm(target))) || options[0];
                if (!chosen) return { ok: false, text: '' };
                for (const evtType of ['pointerover','mouseover','pointerdown','mousedown','pointerup','mouseup','click']) {
                    chosen.dispatchEvent(new MouseEvent(evtType, { bubbles: true, cancelable: true, view: window, buttons: evtType.endsWith('down') ? 1 : 0 }));
                }
                return { ok: true, text: chosen.textContent?.trim() ?? '' };
            }, { optSel: visualItemSel, target: trimmed });
            if (retryClicked.ok) {
                console.log(`[RPA] Retry selected: "${retryClicked.text}"`);
            } else {
                console.warn(`[RPA] Retry also failed, pressing Enter as fallback`);
                await page.keyboard.press('Enter');
            }
        }

        // 6. Tab でフォーム検証トリガー
        await page.keyboard.press('Tab');

    } catch (err) {
        console.warn(`[RPA] Combobox fallback for ${selector}:`, err);
        try {
            await page.evaluate((sel) => {
                const el = document.querySelector(sel) as HTMLElement | null;
                if (el) { el.focus(); el.click(); }
            }, selector);
            await page.keyboard.type(trimmed, { delay: 0 });
            await page.waitForTimeout(300);
            await page.keyboard.press('Enter');
            await page.keyboard.press('Tab');
        } catch { /* ignore */ }
    }
}

/** 複数セレクタを並列で試し、最初に見つかったセレクタ文字列を返す */
async function findSelector(page: Page, selectors: string[], timeout = 8000): Promise<string | null> {
    return Promise.any(
        selectors.map(sel =>
            page.waitForSelector(sel, { state: 'visible', timeout }).then(() => sel)
        )
    ).catch(() => null);
}

/**
 * React native setter でフォームフィールドに値を確実に注入する。
 * keyboard.type は DOM キーイベントのみでReact state 更新が保証されないため、
 * native setter + dispatchEvent を使用し React の onChange を確実に発火させる。
 * 最大 maxRetry 回リトライし、入力値が一致したことを確認する。
 */
async function fillInputReliably(page: Page, selector: string, value: string, maxRetry = 3): Promise<boolean> {
    for (let attempt = 0; attempt < maxRetry; attempt++) {
        await page.evaluate(({ sel, val }) => {
            const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
            if (!el) return;
            el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            el.focus();
            el.click();
            const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const nativeSet = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (nativeSet) { nativeSet.call(el, val); } else { el.value = val; }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        }, { sel: selector, val: value });

        // Tab でフォーカスを移動して React validation を発火
        await page.keyboard.press('Tab');

        // 入力値を確認
        const actual = await page.evaluate((sel) => {
            const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
            return el?.value ?? '';
        }, selector);

        if (actual === value) return true;
        console.warn(`[RPA] fillInputReliably: attempt ${attempt + 1} failed for ${selector}: expected "${value}", got "${actual}"`);
        // 少し待ってリトライ
        await page.waitForTimeout(150);
    }
    return false;
}

/** ログイン処理（セッション保存まで）。セッションが既に有効な場合はスキップ。 */
async function doLogin(page: Page, context: BrowserContext, email: string, password: string, savedSession: object | null): Promise<void> {
    const loginUrl = 'https://accounts.secure.freee.co.jp/login/hr';
    // セッション確認はトップページで行う（フォームURLへの遷移は呼び出し元に任せる）
    const checkUrl = 'https://p.secure.freee.co.jp/';

    if (savedSession) {
        await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    }

    const needsLogin = !savedSession || page.url().includes('accounts.secure.freee.co.jp') || page.url().includes('login');
    if (!needsLogin) return;

    console.log('[RPA] Login required. Navigating to login page...');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    const emailSel = await findSelector(page, [
        'input#loginIdField', 'input[name="user[email]"]', 'input#user_email',
        'input[type="email"]', 'input[placeholder*="メール"]'
    ]);
    if (!emailSel) throw new Error('メールアドレス入力欄が見つかりませんでした。');
    await page.fill(emailSel, email);

    let passwordSel = await findSelector(page, [
        'input#passwordField', 'input[name="user[password]"]', 'input#user_password',
        'input[type="password"]'
    ], 3000);
    if (!passwordSel) {
        const nextBtn = await page.$('input[type="submit"][value*="次へ"], button:has-text("次へ")');
        if (nextBtn) {
            await nextBtn.click();
            passwordSel = await findSelector(page, ['input[type="password"]'], 5000);
        }
    }
    if (!passwordSel) throw new Error('パスワード入力欄が見つかりませんでした。');
    await page.fill(passwordSel, password);

    const loginSel = await findSelector(page, [
        'input[type="submit"]', 'button[type="submit"]:has-text("ログイン")',
        'button:has-text("ログイン")', '.vb-button--appearancePrimary'
    ], 5000);
    if (!loginSel) throw new Error('ログインボタンが見つかりませんでした。');

    await Promise.all([
        page.waitForURL(url => !url.toString().includes('accounts.secure.freee.co.jp'), { timeout: 20000 }).catch(() => {}),
        page.click(loginSel)
    ]);

    await page.waitForURL(url => {
        const u = url.toString();
        return (u.includes('secure.freee.co.jp') || u.includes('p.secure.freee.co.jp'))
               && !u.includes('accounts.secure.freee.co.jp');
    }, { timeout: 20000 }).catch(async () => {
        if (page.url().includes('accounts.secure.freee.co.jp')) {
            const loginError = await page.textContent('.vb-flash--error, .alert-danger').catch(() => null);
            throw new Error(loginError || 'ログイン後の遷移がタイムアウトしました。');
        }
    });
    console.log(`[RPA] Login confirmed. URL: ${page.url()}`);
    await saveSessionState(context);
}

/**
 * バックグラウンドで事前ログインを行い、セッションを保存する。
 * アプリ起動時・設定保存時に呼び出すことで、初回申請の待ち時間を短縮する。
 */
export async function preLoginViaBrowser(email: string, password: string): Promise<void> {
    console.log('[RPA] Pre-login started...');
    const savedSession = loadSessionState();
    const browser = await chromium.launch({
        channel: 'msedge',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }).catch(() => chromium.launch({
        channel: 'chrome',
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }));
    try {
        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ...(savedSession ? { storageState: savedSession as any } : {})
        });
        const page = await context.newPage();
        await page.route('**/*', (route) => {
            if (['image', 'media', 'font'].includes(route.request().resourceType())) route.abort();
            else route.continue();
        });
        await doLogin(page, context, email, password, savedSession);
        console.log('[RPA] Pre-login complete. Session saved.');
    } catch (e) {
        console.warn('[RPA] Pre-login failed (will retry on first submit):', e);
    } finally {
        await browser.close();
    }
}

export async function fetchManagerOvertimeSummariesViaBrowser(
    payload: ManagerOvertimeBrowserPayload
): Promise<ManagerOvertimeBrowserResult> {
    console.log('[RPA] Fetching manager overtime summaries from freee web UI...');
    const savedSession = loadSessionState();
    const browser = await chromium.launch({
        channel: 'msedge',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }).catch(() => chromium.launch({
        channel: 'chrome',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }));

    let context: BrowserContext | null = null;
    try {
        context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            ...(savedSession ? { storageState: savedSession as any } : {})
        });
        const page = await context.newPage();
        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'media', 'font'].includes(type)) route.abort();
            else route.continue();
        });

        await doLogin(page, context, payload.email, payload.password, savedSession);
        await page.goto(`https://p.secure.freee.co.jp/#home/${payload.year}/${payload.month}`, {
            waitUntil: 'domcontentloaded',
            timeout: 45000
        }).catch(() => {});
        await page.waitForFunction(() => Boolean(document.body?.innerText?.trim()), { timeout: 20000 }).catch(() => {});

        await page.evaluate(() => {
            const nav = Array.from(document.querySelectorAll('li[data-testid]')).find(
                (el) => el.getAttribute('data-testid') === '\u30b0\u30ed\u30ca\u30d3_\u52e4\u6020'
            );
            const trigger = nav?.querySelector('button, a') as HTMLElement | null;
            trigger?.click();
        });
        await page.waitForTimeout(1500);

        const workRecordsHref = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
            const link = links.find((a) => {
                const href = a.getAttribute('href') || '';
                return /#work_records\/\d+\/\d+\/\d+/.test(href) && !href.includes('/employees/');
            });
            return link?.getAttribute('href') || '';
        });
        if (!workRecordsHref) {
            throw new Error('freee Web UIの勤怠情報リンクを検出できませんでした。');
        }

        await page.evaluate((href) => {
            const links = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
            const link = links.find((a) => a.getAttribute('href') === href);
            link?.click();
        }, workRecordsHref);
        await page.waitForFunction(() => {
            const rows = Array.from(document.querySelectorAll('tr'));
            return rows.some((row) => row.querySelectorAll('td').length >= 10);
        }, { timeout: 30000 });

        const targetHref = workRecordsHref.replace(
            /#work_records\/(\d+)\/\d+\/\d+.*/,
            `#work_records/$1/${payload.year}/${payload.month}?page=1&per=100&sortBy=num&sortDirection=ASC`
        );
        const targetUrl = new URL(targetHref, 'https://p.secure.freee.co.jp').toString();
        if (page.url() !== targetUrl) {
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
            await page.waitForTimeout(3000);
            await page.waitForFunction(() => {
                const rows = Array.from(document.querySelectorAll('tr'));
                return rows.some((row) => row.querySelectorAll('td').length >= 10);
            }, { timeout: 30000 });
        }

        const items = await page.evaluate((thresholdMins) => {
            const timeToMinutes = (value: string): number => {
                const match = String(value || '').match(/(-?\d+)\s*:\s*(\d+)/);
                if (!match) return 0;
                return Number(match[1]) * 60 + Number(match[2]);
            };
            const daysToNumber = (value: string): number => {
                const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
                return match ? Number(match[0]) : 0;
            };
            const text = (el: Element | null | undefined): string =>
                (el?.textContent || '').replace(/\s+/g, ' ').trim();
            const rows = Array.from(document.querySelectorAll('tr'));
            return rows.map((row) => {
                const cells = Array.from(row.querySelectorAll('td')).map(text);
                if (cells.length < 13) return null;
                const href = (Array.from(row.querySelectorAll('a[href]')) as HTMLAnchorElement[])
                    .map((a) => a.getAttribute('href') || '')
                    .find((value) => /\/employees\/\d+/.test(value)) || '';
                const idMatch = href.match(/\/employees\/(\d+)/);
                const employeeId = idMatch ? Number(idMatch[1]) : 0;
                const overtimeMins = timeToMinutes(cells[8]);
                const holidayWorkMins = timeToMinutes(cells[9]);
                const totalOvertimeMins = overtimeMins + holidayWorkMins;
                return {
                    employeeId,
                    employeeNumber: cells[1] || '',
                    employeeName: cells[0] || `ID:${employeeId}`,
                    canReadSummary: true,
                    overThreshold: overtimeMins >= thresholdMins,
                    workDays: daysToNumber(cells[5]),
                    totalWorkMins: timeToMinutes(cells[6]),
                    normalWorkMins: timeToMinutes(cells[7]),
                    legalOvertimeMins: 0,
                    overtimeMins,
                    totalOvertimeMins,
                    prescribedHolidayWorkMins: 0,
                    holidayWorkMins,
                    latenightWorkMins: timeToMinutes(cells[10]),
                    absenceDays: daysToNumber(cells[11]),
                    paidHolidays: 0,
                    paidHolidaysLeft: 0,
                    latenessEarlyLeavingMins: timeToMinutes(cells[12])
                };
            }).filter((item): item is ManagerOvertimeBrowserItem => Boolean(item && item.employeeName));
        }, payload.thresholdMins);

        if (items.length === 0) {
            throw new Error('freee Web UIの勤怠一覧から従業員データを読み取れませんでした。');
        }

        await saveSessionState(context);
        return { source: 'web', url: page.url(), items };
    } finally {
        await context?.close().catch(() => {});
        await browser.close().catch(() => {});
    }
}

export async function submitOvertimeViaBrowser(payload: AutomationPayload & { headless?: boolean }) {

    console.log('[RPA] Starting Playwright automation...');

    const savedSession = loadSessionState();
    if (savedSession) {
        console.log('[RPA] Found saved session, will attempt to skip login.');
    }

    const browser = await chromium.launch({
        channel: 'msedge',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }).catch(() => chromium.launch({
        channel: 'chrome',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }));

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(savedSession ? { storageState: savedSession as any } : {})
    });
    const page = await context.newPage();

    // 画像・フォント・メディアをブロックしてページ読み込みを高速化
    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) {
            route.abort();
        } else {
            route.continue();
        }
    });

    try {
        const overtimeUrlVibe = 'https://p.secure.freee.co.jp/approval_requests#/requests/new?type=ApprovalRequest::OvertimeWork';
        const overtimeUrlLegacy = `https://secure.freee.co.jp/hr/businesses/${payload.companyId}/approval_requests/overtime_works/new`;

        await doLogin(page, context, payload.email, payload.password, savedSession);

        // 残業申請フォームへ遷移
        await page.goto(overtimeUrlVibe, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        // レガシー URL フォールバック
        if (!page.url().includes('p.secure.freee.co.jp') && !page.url().includes('overtime_work')) {
            await page.goto(overtimeUrlLegacy, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        console.log('[RPA] Form URL:', page.url());

        // 日付正規化
        const normalizedDate = payload.targetDate.includes('-') && payload.targetDate.length >= 10
            ? payload.targetDate.slice(0, 10)
            : payload.targetDate.replace(/\//g, '-').slice(0, 10);

        // 対象日フィールドが出るまで待つ（SPA描画完了の代わり）
        const dateFieldSel = await findSelector(page,
            ['input#approval-request-fields-date', 'input[name="approval_request[target_date]"]'],
            25000
        );
        if (!dateFieldSel) {
            await logPageState(page, 'date_field_not_found');
            throw new Error('対象日入力欄が見つかりませんでした。');
        }

        // React が date フィールドに event handler を attach するまで待機
        // DOM に要素があっても React が未マウントだと入力が無視される（1件目・4件目失敗の原因）
        console.log('[RPA] Waiting for React to fully mount on form...');
        await page.waitForFunction((sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            return Object.keys(el).some(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
        }, dateFieldSel, { timeout: 10000 }).catch(() => {
            console.warn('[RPA] React fiber not detected on date field, proceeding anyway...');
        });
        console.log('[RPA] Form is ready for input.');

        // 申請理由セレクタを取得（時間フィールドは日付入力後に再取得する）
        const reasonSel = await findSelector(page, [
            '[data-test="申請理由"]', '[data-testid="申請理由"]',
            'input[aria-label="申請の理由を入力"]', 'textarea[name="approval_request[comment]"]'
        ], 5000);

        // 日付を入力（native setter で React state を確実に更新）
        const dateOk = await fillInputReliably(page, dateFieldSel, normalizedDate);
        if (!dateOk) throw new Error(`対象日の入力に失敗しました: ${normalizedDate}`);
        console.log(`[RPA] Date filled: ${normalizedDate}`);

        // 日付変更後に時間フィールドが表示されるまで待機
        await page.waitForFunction((dateSel) => {
            const dateEl = document.querySelector(dateSel);
            const candidates = Array.from(document.querySelectorAll('input')).filter((el) => {
                if (el === dateEl) return false;
                if (el.getAttribute('role') === 'combobox') return false;
                if (['hidden', 'checkbox', 'radio'].includes((el as HTMLInputElement).type)) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            });
            return candidates.length >= 2;
        }, dateFieldSel, { timeout: 5000 }).catch(() => {
            console.warn('[RPA] Time fields not appeared after 5s, proceeding with discovery...');
        });

        // 時間フィールドを動的に発見（ID に依存しない）
        const timeFieldSelectors = await page.evaluate((dateSel: string) => {
            const dateEl = document.querySelector(dateSel);
            const candidates = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
                .filter(el => {
                    if (el === dateEl) return false;
                    if (el.getAttribute('role') === 'combobox') return false;
                    if (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                });
            return candidates.slice(0, 2).map(el => {
                if (el.id) return `#${el.id}`;
                if (el.name) return `input[name="${el.name}"]`;
                const parent = el.parentElement;
                return parent?.id ? `#${parent.id} input` : null;
            }).filter(Boolean) as string[];
        }, dateFieldSel);

        console.log(`[RPA] Discovered time fields: ${JSON.stringify(timeFieldSelectors)}`);

        // 時間フィールドに native setter で入力（リトライ付き）
        const timeValues = [payload.startAt, payload.endAt];
        for (let i = 0; i < Math.min(timeFieldSelectors.length, 2); i++) {
            const ok = await fillInputReliably(page, timeFieldSelectors[i], timeValues[i]);
            console.log(`[RPA] Time[${i}] filled: ${timeValues[i]} -> ${timeFieldSelectors[i]} (ok=${ok})`);
        }

        // 特定セレクタでも再試行（動的発見で見つからなかった場合のフォールバック）
        if (timeFieldSelectors.length < 2) {
            console.warn('[RPA] Dynamic discovery found < 2 fields, trying specific selectors...');
            const fallbackStart = await findSelector(page, [
                'input#approval-request-fields-started-at',
                'input[name="approval_request[start_at]"]',
                'input[aria-label*="開始"]', 'input[aria-label*="start"]'
            ], 2000);
            const fallbackEnd = await findSelector(page, [
                'input#approval-request-fields-end-at',
                'input[name="approval_request[end_at]"]',
                'input[aria-label*="終了"]', 'input[aria-label*="end"]'
            ], 2000);
            if (fallbackStart) {
                await fillInputReliably(page, fallbackStart, payload.startAt);
                console.log(`[RPA] Start fallback filled: ${payload.startAt}`);
            }
            if (fallbackEnd) {
                await fillInputReliably(page, fallbackEnd, payload.endAt);
                console.log(`[RPA] End fallback filled: ${payload.endAt}`);
            }
        }
        console.log(`[RPA] Date/Times filled: ${normalizedDate} ${payload.startAt}-${payload.endAt}`);

        // 申請理由（native setter）
        if (reasonSel) {
            await fillInputReliably(page, reasonSel, payload.comment || '');
            console.log('[RPA] Reason filled');
        }

        // 申請経路
        const routeDisplayName = payload.routeName?.trim() || '残業申請';
        const routeInput = await page.$('input#approval-request-fields-route-id');
        if (routeInput) {
            await handleCombobox(page, 'input#approval-request-fields-route-id', routeDisplayName);
        } else {
            await page.selectOption('select[name="approval_request[approval_flow_route_id]"]', payload.routeId.toString()).catch(() => {});
        }

        // 部署
        if (payload.departmentId || payload.departmentName) {
            const deptDisplayName = payload.departmentName?.trim();
            const deptInput = await page.$('input#approval-request-fields-group-id');
            if (deptInput && deptDisplayName) {
                await handleCombobox(page, 'input#approval-request-fields-group-id', deptDisplayName);
            } else if (payload.departmentId) {
                await page.selectOption('select[name="approval_request[department_id]"]', payload.departmentId.toString()).catch(() => {});
            }
        }

        // === 送信前フィールド全検証・再入力 ===
        console.log('[RPA] Verifying all fields before submit...');

        // 日付の確認
        const dateActual = await page.evaluate((sel) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            return el?.value || '';
        }, dateFieldSel);
        if (dateActual !== normalizedDate) {
            console.warn(`[RPA] Date wrong: expected "${normalizedDate}", got "${dateActual}". Re-filling...`);
            await fillInputReliably(page, dateFieldSel, normalizedDate);
            // 時間フィールド再表示待ち
            await page.waitForFunction((dateSel) => {
                const dateEl = document.querySelector(dateSel);
                return Array.from(document.querySelectorAll('input')).filter(el => {
                    if (el === dateEl) return false;
                    if (el.getAttribute('role') === 'combobox') return false;
                    if (['hidden', 'checkbox', 'radio'].includes((el as HTMLInputElement).type)) return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                }).length >= 2;
            }, dateFieldSel, { timeout: 5000 }).catch(() => {});

            // 日付再入力後に申請経路・部署も再設定（コンボボックスの React state がリセットされるため）
            console.log('[RPA] Re-setting route/department after date re-fill...');
            const routeInput2 = await page.$('input#approval-request-fields-route-id');
            if (routeInput2) {
                await handleCombobox(page, 'input#approval-request-fields-route-id', routeDisplayName);
            }
            if (payload.departmentId || payload.departmentName) {
                const deptDisplayName2 = payload.departmentName?.trim();
                const deptInput2 = await page.$('input#approval-request-fields-group-id');
                if (deptInput2 && deptDisplayName2) {
                    await handleCombobox(page, 'input#approval-request-fields-group-id', deptDisplayName2);
                }
            }
        } else {
            console.log(`[RPA] Date OK: ${dateActual}`);
        }

        // 時間フィールドの確認と再入力（native setter でリトライ）
        const verifyTimeFields = await page.evaluate((dateSel: string) => {
            const dateEl = document.querySelector(dateSel);
            const candidates = Array.from(document.querySelectorAll<HTMLInputElement>('input'))
                .filter(el => {
                    if (el === dateEl) return false;
                    if (el.getAttribute('role') === 'combobox') return false;
                    if (['hidden', 'checkbox', 'radio'].includes(el.type)) return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                });
            return candidates.slice(0, 2).map(el => ({
                sel: el.id ? `#${el.id}` : (el.name ? `input[name="${el.name}"]` : ''),
                val: el.value
            })).filter(x => x.sel);
        }, dateFieldSel);

        const verifyTimeValues = [payload.startAt, payload.endAt];
        for (let i = 0; i < Math.min(verifyTimeFields.length, 2); i++) {
            const { sel, val } = verifyTimeFields[i];
            const expected = verifyTimeValues[i];
            if (!val || val !== expected) {
                console.warn(`[RPA] Time[${i}] wrong: expected "${expected}", got "${val}". Re-filling...`);
                await fillInputReliably(page, sel, expected);
                console.log(`[RPA] Time[${i}] re-filled: ${expected}`);
            } else {
                console.log(`[RPA] Time[${i}] OK: ${val}`);
            }
        }
        console.log('[RPA] Verification complete.');

        // フォーム検証トリガー（body クリックで blur → React validation）
        await page.evaluate(() => {
            document.body.click();
            const el = document.activeElement as HTMLElement | null;
            if (el?.blur) el.blur();
        });

        // 申請ボタンが有効になるまで待つ（最大15秒）
        console.log('[RPA] Waiting for submit button...');
        const enabledSubmitSel = await findSelector(page, [
            'button[type="submit"].vb-button--appearancePrimary:has-text("申請"):not(.vb-button--disabled)',
            'button.vb-button--appearancePrimary:has-text("申請"):not(.vb-button--disabled)',
            'button[type="submit"]:has-text("申請"):not([disabled])',
        ], 15000);

        if (!enabledSubmitSel) {
            await logPageState(page, 'submit_button_still_disabled');
            throw new Error('申請ボタンが有効になりませんでした（15秒待機）。必須項目を確認してください。');
        }

        console.log('[RPA] Submitting...');
        const urlBeforeSubmit = page.url();
        await page.click(enabledSubmitSel);

        // 申請後の成功判定: 取り下げボタン / URL変化(新規→詳細) / エラー表示 を race
        console.log('[RPA] Waiting for success or error...');
        const successOrError = await Promise.race([
            page.waitForSelector('button:has-text("申請を取り下げる")', { state: 'visible', timeout: 15000 }).then(() => 'withdraw' as const).catch(() => null),
            page.waitForFunction((prevUrl) => {
                // URL が /new から /requests/ID に変わったら成功
                return window.location.href !== prevUrl && !window.location.href.includes('/new');
            }, urlBeforeSubmit, { timeout: 15000 }).then(() => 'url_changed' as const).catch(() => null),
            page.waitForSelector('.vb-messageBlock__inner--alert, [role="alert"]', { state: 'visible', timeout: 15000 }).then(() => 'error' as const).catch(() => null),
        ]);

        console.log(`[RPA] Result: ${successOrError}`);

        if (successOrError === 'error') {
            const vbErrorText = await page.evaluate(() => {
                for (const sel of ['.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content', '.vb-message__content', '.vb-flash--error', '[role="alert"]']) {
                    const el = document.querySelector(sel);
                    if (el?.textContent?.trim()) return el.textContent.trim();
                }
                return null;
            });
            if (vbErrorText && (vbErrorText.includes('申請できませんでした') || vbErrorText.includes('すでに') || vbErrorText.includes('エラー') || vbErrorText.includes('失敗') || vbErrorText.includes('必須'))) {
                throw new Error(vbErrorText);
            }
            // エラーセレクタが見つかったが実際のエラーではない → 成功扱い
        } else if (successOrError === null) {
            // 全てタイムアウト → 念のためエラーチェック
            const vbErrorText = await page.evaluate(() => {
                for (const sel of ['.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content', '.vb-message__content', '[role="alert"]']) {
                    const el = document.querySelector(sel); if (el?.textContent?.trim()) return el.textContent.trim();
                }
                return null;
            });
            if (vbErrorText && (vbErrorText.includes('申請できませんでした') || vbErrorText.includes('エラー') || vbErrorText.includes('失敗'))) {
                throw new Error(vbErrorText);
            }
            throw new Error('申請の成功を確認できませんでした（15秒タイムアウト）。');
        }
        // 'withdraw' or 'url_changed' → 成功

        console.log('[RPA] Application successful!');
        return { success: true, message: 'Web経由で申請が完了しました。' };

    } catch (error: any) {
        console.error('[RPA] Error:', error.message);
        await logPageState(page, `final_error_${error.name || 'error'}`);
        // セッションが原因でエラーになった可能性があれば削除
        if (error.message.includes('ログイン') || error.message.includes('タイムアウト')) {
            try { fs.unlinkSync(SESSION_PATH); console.log('[RPA] Session cleared due to auth error.'); } catch { /* ignore */ }
        }
        throw new Error(`ブラウザ自動操作中にエラーが発生しました: ${error.message}`);
    } finally {
        console.log('[RPA] Closing browser.');
        await browser.close();
    }
}

// ─────────────────────────────────────────────────────────────
// 打刻 Web 自動操作
// ─────────────────────────────────────────────────────────────
export interface TimeClockWebPayload {
    email: string;
    password: string;
    companyId: number;
    employeeId: number;
    targetDate: string;           // "2026-03-19"
    clockIn: string;              // "09:00"
    clockOut: string;             // "18:00"
    breaks: { start: string; end: string }[];
    headless?: boolean;
}

export async function submitTimeClockViaBrowser(payload: TimeClockWebPayload) {
    console.log('[RPA] Starting TimeClock automation...');
    const [year, month] = payload.targetDate.split('-');
    const dayNum = parseInt(payload.targetDate.split('-')[2], 10);

    const savedSession = loadSessionState();
    if (savedSession) console.log('[RPA] Found saved session, will attempt to skip login.');

    const browser = await chromium.launch({
        channel: 'msedge',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }).catch(() => chromium.launch({
        channel: 'chrome',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }));

    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(savedSession ? { storageState: savedSession as any } : {})
    });
    const page = await context.newPage();

    // 画像・フォント・メディアをブロックしてページ読み込みを高速化
    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) route.abort();
        else route.continue();
    });

    try {
        await doLogin(page, context, payload.email, payload.password, savedSession);

        // ── Step 1: 勤怠管理ページ（ハッシュルーティング）へ移動 ──────
        const monthInt = parseInt(month, 10); // 先頭ゼロ除去 (03 → 3)
        const workRecordsHash = `#work_records/${year}/${monthInt}/employees/${payload.employeeId}?page=1&per=100&sortBy=num&sortDirection=ASC`;
        const workRecordsUrl = `https://p.secure.freee.co.jp/${workRecordsHash}`;
        console.log('[RPA] Navigating to work_records URL:', workRecordsUrl);

        // SPAのベースページをロードしてからハッシュ変更（直接gotoでも動作する）
        await page.goto(workRecordsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(4000);
        await logPageState(page, 'timeclock_01_work_records');

        // ── Step 2: テーブルビューに切り替え ────────────────────────────
        const tableBtn = await page.$('button:has-text("テーブル")');
        if (tableBtn) {
            await tableBtn.click();
            await page.waitForTimeout(2000);
            console.log('[RPA] Switched to table view.');
            await logPageState(page, 'timeclock_02_table_view');
        } else {
            console.warn('[RPA] Table view button not found, continuing with current view.');
        }

        // ── Step 3: 対象日の編集ボタンをクリック ─────────────────────────
        const dayStr = String(dayNum); // "19"
        console.log(`[RPA] Looking for day ${dayStr} edit button...`);

        // テーブル行から対象日の編集ボタン/リンクを探す
        const editClicked = await page.evaluate(({ date, day }: any) => {
            const dayInt = parseInt(day, 10);

            // 方法A: data-date 属性 → 同じ行の編集ボタン/リンク
            for (const attr of [`[data-date="${date}"]`, `[data-date="${date.replace(/-/g, '/')}"]`]) {
                const cell = document.querySelector(attr);
                if (cell) {
                    const row = cell.closest('tr, [role="row"]');
                    if (row) {
                        const editBtn = row.querySelector('a[href*="edit"], a[href*="/edit"], button') as HTMLElement | null;
                        if (editBtn) { editBtn.click(); return `data-date row editBtn: ${editBtn.textContent?.trim() || editBtn.getAttribute('href')}`; }
                    }
                    (cell as HTMLElement).click();
                    return `data-date click: ${attr}`;
                }
            }

            // 方法B: テーブル行のテキストマッチ → 編集リンク
            const allRows = Array.from(document.querySelectorAll('tr, [role="row"]'));
            for (const row of allRows) {
                const text = (row.textContent || '').trim();
                const hasDay = text.match(new RegExp(`(^|\\D)${dayInt}(日|\\s|$|\\D)`));
                if (hasDay) {
                    const editLink = row.querySelector('a[href*="edit"]') as HTMLAnchorElement | null;
                    if (editLink) { editLink.click(); return `row editLink: ${editLink.getAttribute('href')}`; }
                    const btn = row.querySelector('button:not([disabled])') as HTMLElement | null;
                    if (btn) { btn.click(); return `row btn: ${btn.textContent?.trim()}`; }
                }
            }

            // 方法C: href に /19 または /19/edit を含むリンク
            const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
            const editLink = links.find(a => {
                const h = a.getAttribute('href') || '';
                return h.includes(`/${day}/edit`) || h.includes(`/${day}$`);
            });
            if (editLink) { editLink.click(); return `direct link: ${editLink.getAttribute('href')}`; }

            return null;
        }, { date: payload.targetDate, day: dayStr });

        console.log(`[RPA] Edit click result: ${editClicked}`);
        await page.waitForTimeout(3000);
        await logPageState(page, 'timeclock_03_after_edit_click');

        // ── Step 4: 時刻入力フィールドを収集 ─────────────────────────────
        const dumpInputs = async () => {
            return page.evaluate(() => {
                return Array.from(document.querySelectorAll<HTMLInputElement>('input, [contenteditable="true"]'))
                    .filter(el => {
                        if (el instanceof HTMLInputElement && ['hidden', 'checkbox', 'radio', 'file', 'submit', 'button'].includes(el.type)) return false;
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    })
                    .map(el => ({
                        tag: el.tagName,
                        id: (el as any).id,
                        name: (el as HTMLInputElement).name,
                        placeholder: (el as HTMLInputElement).placeholder,
                        value: (el as HTMLInputElement).value,
                        ariaLabel: el.getAttribute('aria-label') || '',
                        textContent: el.textContent?.trim().slice(0, 30) || '',
                        sel: (el as any).id ? `#${(el as any).id}` : ((el as HTMLInputElement).name ? `input[name="${(el as HTMLInputElement).name}"]` : ''),
                    }));
            });
        };

        const timeInputs = await dumpInputs();
        console.log('[RPA] All visible inputs:', JSON.stringify(timeInputs));

        const findTimeSel = (fields: typeof timeInputs, keywords: string[]): string | null => {
            for (const kw of keywords) {
                const found = fields.find(f =>
                    f.ariaLabel.includes(kw) || f.placeholder.includes(kw) ||
                    f.name.includes(kw) || f.id.includes(kw) || f.textContent.includes(kw)
                );
                if (found?.sel) return found.sel;
            }
            return null;
        };

        const clockInSel  = findTimeSel(timeInputs, ['clock_in', 'clockIn', '出勤', '開始', 'work_start', 'start']);
        const clockOutSel = findTimeSel(timeInputs, ['clock_out', 'clockOut', '退勤', '終了', 'work_end', 'end']);

        if (clockInSel) {
            await fillInputReliably(page, clockInSel, payload.clockIn);
            console.log(`[RPA] Clock-in filled: ${payload.clockIn} -> ${clockInSel}`);
        } else {
            console.warn('[RPA] Clock-in field not found by label, trying positional...');
            if (timeInputs[0]?.sel) await fillInputReliably(page, timeInputs[0].sel, payload.clockIn);
        }

        if (clockOutSel) {
            await fillInputReliably(page, clockOutSel, payload.clockOut);
            console.log(`[RPA] Clock-out filled: ${payload.clockOut} -> ${clockOutSel}`);
        } else {
            console.warn('[RPA] Clock-out field not found by label, trying positional...');
            if (timeInputs[1]?.sel) await fillInputReliably(page, timeInputs[1].sel, payload.clockOut);
        }

        // 休憩時間の入力
        for (let i = 0; i < payload.breaks.length; i++) {
            const brk = payload.breaks[i];
            console.log(`[RPA] Filling break[${i}]: ${brk.start}-${brk.end}`);

            if (i > 0) {
                const addBreakBtn = await page.$('button:has-text("休憩を追加"), button:has-text("追加"), button[aria-label*="休憩"]');
                if (addBreakBtn) {
                    await addBreakBtn.click();
                    await page.waitForTimeout(500);
                    console.log(`[RPA] Break add button clicked for break[${i}]`);
                }
            }

            const updatedInputs = await dumpInputs();
            const breakStartSel = findTimeSel(updatedInputs, [`break_begin_${i}`, `break_start_${i}`, '休憩開始', 'break_start', 'break_begin']);
            const breakEndSel   = findTimeSel(updatedInputs, [`break_end_${i}`, '休憩終了', 'break_end']);

            if (breakStartSel) { await fillInputReliably(page, breakStartSel, brk.start); console.log(`[RPA] Break[${i}] start: ${brk.start}`); }
            if (breakEndSel)   { await fillInputReliably(page, breakEndSel,   brk.end);   console.log(`[RPA] Break[${i}] end:   ${brk.end}`); }
        }

        await logPageState(page, 'timeclock_05_before_save');

        // ── Step 6: 保存ボタンをクリック ────────────────────────────────
        const saveBtnSel = await findSelector(page, [
            'button:has-text("保存")',
            'button:has-text("登録")',
            'button:has-text("確定")',
            'button:has-text("更新")',
            'button[type="submit"]:not([disabled])',
            '.vb-button--appearancePrimary:not(.vb-button--disabled)',
        ], 5000);

        if (!saveBtnSel) {
            await logPageState(page, 'timeclock_save_btn_not_found');
            // 保存ボタンが見つからない場合、現在ページの状態をすべてダンプ
            const pageText = await page.evaluate(() => document.body?.textContent?.slice(0, 3000) || '');
            console.warn('[RPA] Page text when save not found:', pageText);
            const allBtns = await page.evaluate(() =>
                Array.from(document.querySelectorAll('button, [role="button"]'))
                    .map(b => ({ text: b.textContent?.trim(), cls: b.className }))
            );
            console.warn('[RPA] All buttons:', JSON.stringify(allBtns));
            throw new Error('保存ボタンが見つかりませんでした。ログのボタン一覧・スクリーンショットを確認してください。');
        }

        await page.click(saveBtnSel);
        console.log('[RPA] Save button clicked.');
        await page.waitForTimeout(2000);

        const errText = await page.evaluate(() =>
            document.querySelector('.vb-message__content, .vb-flash--error, [role="alert"]')?.textContent || null
        );
        if (errText && (errText.includes('エラー') || errText.includes('失敗') || errText.includes('必須'))) {
            throw new Error(errText.trim());
        }

        await logPageState(page, 'timeclock_06_after_save');
        console.log('[RPA] TimeClock submission successful!');
        return { success: true, message: 'Web経由で打刻を登録しました。' };

    } catch (error: any) {
        console.error('[RPA] TimeClock Error:', error.message);
        await logPageState(page, `timeclock_error_${Date.now()}`);
        if (error.message.includes('ログイン') || error.message.includes('タイムアウト')) {
            try { fs.unlinkSync(SESSION_PATH); } catch { /* ignore */ }
        }
        throw new Error(`打刻自動操作中にエラーが発生しました: ${error.message}`);
    } finally {
        console.log('[RPA] Closing browser.');
        await browser.close();
    }
}

// ─────────────────────────────────────────────────────────────
// 有給申請 Web 自動操作
// ─────────────────────────────────────────────────────────────
export async function submitPaidLeaveViaBrowser(payload: PaidLeavePayload & { headless?: boolean }) {
    console.log('[RPA] Starting Paid Leave automation...');
    console.log(`[RPA Debug] payload.leaveUnit = "${payload.leaveUnit}"`);

    // 土日祝日チェック（ブラウザ起動前に弾く）
    const normalizedDateEarly = payload.targetDate.slice(0, 10).replace(/\//g, '-')
    const nonWorking = checkNonWorkingDay(normalizedDateEarly)
    if (nonWorking.isNonWorking) {
        throw new Error(`${normalizedDateEarly} は${nonWorking.reason}のため申請できません。`)
    }

    const savedSession = loadSessionState();
    if (savedSession) console.log('[RPA] Found saved session, will attempt to skip login.');

    const browser = await chromium.launch({
        channel: 'msedge',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }).catch(() => chromium.launch({
        channel: 'chrome',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }));
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(savedSession ? { storageState: savedSession as any } : {})
    });
    const page = await context.newPage();

    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) route.abort();
        else route.continue();
    });

    try {
        const paidLeaveUrl = 'https://p.secure.freee.co.jp/approval_requests#/requests/new?type=ApprovalRequest::PaidHoliday';
        const paidLeaveLegacyUrl = `https://secure.freee.co.jp/hr/businesses/${payload.companyId}/approval_requests/paid_holidays/new`;

        await doLogin(page, context, payload.email, payload.password, savedSession);

        // 有給申請フォームへ遷移
        await page.goto(paidLeaveUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        if (!page.url().includes('p.secure.freee.co.jp')) {
            await page.goto(paidLeaveLegacyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        console.log('[RPA] Paid Leave Form URL:', page.url());

        const normalizedDate = payload.targetDate.includes('-') && payload.targetDate.length >= 10
            ? payload.targetDate.slice(0, 10)
            : payload.targetDate.replace(/\//g, '-').slice(0, 10);

        // フォーム上の全入力要素をログ出力（デバッグ用）
        const formFields = await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input, select, textarea'))
                .map(el => ({ tag: el.tagName, id: el.id, name: (el as HTMLInputElement).name, type: (el as HTMLInputElement).type, ariaLabel: el.getAttribute('aria-label') || '' }));
            return inputs;
        });
        console.log('[RPA] Form fields found:', JSON.stringify(formFields, null, 2));

        // 日付フィールド + React マウント待機
        const dateFieldSel = await findSelector(page,
            ['input#approval-request-fields-date', 'input[name="approval_request[target_date]"]',
             'input[type="date"]', 'input[id*="date"]'],
            25000
        );
        if (!dateFieldSel) throw new Error('対象日入力欄が見つかりませんでした。');

        console.log('[RPA] Waiting for React to fully mount...');
        await page.waitForFunction((sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            return Object.keys(el).some(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
        }, dateFieldSel, { timeout: 10000 }).catch(() => {
            console.warn('[RPA] React fiber not detected, proceeding anyway...');
        });
        console.log('[RPA] Form is ready for input.');

        // 日付入力（native setter でリトライ付き）
        const dateOkPL = await fillInputReliably(page, dateFieldSel, normalizedDate);
        if (!dateOkPL) throw new Error(`対象日の入力に失敗しました: ${normalizedDate}`);
        console.log(`[RPA] Date filled: ${normalizedDate}`);

        // 日付入力後、フォーム再レンダリングを待機（select要素が遅延出現するため）
        await page.waitForTimeout(2000);

        // 申請理由（native setter）
        const reasonSelPL = await findSelector(page, [
            '[data-test="申請理由"]', '[data-testid="申請理由"]',
            'input[aria-label="申請の理由を入力"]', 'textarea[name="approval_request[comment]"]'
        ], 5000);
        if (reasonSelPL && payload.comment) {
            await fillInputReliably(page, reasonSelPL, payload.comment);
            console.log('[RPA] Reason filled');
        }

        // 申請経路
        const routeDisplayName = payload.routeName?.trim() || '有給申請';
        const routeInput = await page.$('input#approval-request-fields-route-id');
        if (routeInput) {
            await handleCombobox(page, 'input#approval-request-fields-route-id', routeDisplayName);
        }

        // 部署
        if (payload.departmentId || payload.departmentName) {
            const deptDisplayName = payload.departmentName?.trim();
            const deptInput = await page.$('input#approval-request-fields-group-id');
            if (deptInput && deptDisplayName) {
                await handleCombobox(page, 'input#approval-request-fields-group-id', deptDisplayName);
            }
        }

        // ─── 送信前検証（日付） ───
        console.log('[RPA] Verifying date before leave unit selection...');
        const dateActual = await page.evaluate((sel) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            return el?.value || '';
        }, dateFieldSel);
        if (dateActual !== normalizedDate) {
            console.warn(`[RPA] Date wrong: "${dateActual}", re-filling...`);
            await fillInputReliably(page, dateFieldSel, normalizedDate);
            // 日付再入力後はフォーム再描画されるため十分待つ
            await page.waitForTimeout(3000);
        } else {
            console.log(`[RPA] Date OK: ${dateActual}`);
        }

        // ─── 取得単位の選択（他フィールド確定後の最終ステップ） ───
        // 日付・経路の入力でフォームが再描画されるため、select操作は必ず最後に行う
        const { LEAVE_UNIT_TO_WEB } = await import('../shared/leaveUnit');
        const unitValue = LEAVE_UNIT_TO_WEB[payload.leaveUnit] || 'full';
        const unitSelectSel = '#approval-request-fields-usage_day';

        // select要素の出現を最大15秒待機
        console.log(`[RPA] Waiting for leave unit select element (target: "${unitValue}")...`);
        const unitSelectFound = await page.waitForSelector(unitSelectSel, { timeout: 15000 }).catch(() => null);

        if (unitSelectFound) {
            console.log(`[RPA] Leave unit select found, setting to "${unitValue}"...`);

            // Playwright selectOption で選択
            await page.selectOption(unitSelectSel, unitValue).catch(() => {});
            await page.waitForTimeout(500);

            // React native setter + イベント発火（補完）
            await page.evaluate(({ sel, val }) => {
                const el = document.querySelector(sel) as HTMLSelectElement | null;
                if (!el) return;
                const nativeSet = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
                if (nativeSet) { nativeSet.call(el, val); } else { el.value = val; }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, { sel: unitSelectSel, val: unitValue });
            await page.waitForTimeout(500);

            // 選択結果を確認
            let selectedVal = await page.evaluate((sel) => {
                const el = document.querySelector(sel) as HTMLSelectElement | null;
                return el?.value || '';
            }, unitSelectSel);

            if (selectedVal !== unitValue) {
                console.warn(`[RPA] Leave unit mismatch, retrying: got "${selectedVal}", want "${unitValue}"`);
                await page.click(unitSelectSel);
                await page.waitForTimeout(300);
                await page.selectOption(unitSelectSel, unitValue).catch(() => {});
                await page.waitForTimeout(500);
                selectedVal = await page.evaluate((sel) => {
                    const el = document.querySelector(sel) as HTMLSelectElement | null;
                    return el?.value || '';
                }, unitSelectSel);
            }
            console.log(`[RPA] Leave unit selected: "${selectedVal}" (expected: "${unitValue}")`);

            if (selectedVal !== unitValue) {
                throw new Error(`取得単位の選択に失敗しました。期待: ${unitValue}, 実際: ${selectedVal}`);
            }
        } else {
            console.warn('[RPA] Leave unit select NOT found after 15s wait, trying combobox...');
            const { LEAVE_UNIT_LABELS } = await import('../shared/leaveUnit');
            const unitComboSel = await page.evaluate(() => {
                const excludeIds = ['approval-request-fields-route-id', 'approval-request-fields-group-id', 'approval-request-fields-date'];
                const combos = Array.from(document.querySelectorAll<HTMLInputElement>('input[role="combobox"]'));
                for (const el of combos) {
                    if (!excludeIds.includes(el.id)) return el.id ? `#${el.id}` : null;
                }
                return null;
            });
            if (unitComboSel) await handleCombobox(page, unitComboSel, LEAVE_UNIT_LABELS[payload.leaveUnit] || '全休');
        }

        // ─── 最終検証: 申請直前にselect値を再確認 ───
        const finalUnitCheck = await page.evaluate((sel) => {
            const el = document.querySelector(sel) as HTMLSelectElement | null;
            return el ? { value: el.value, text: el.options[el.selectedIndex]?.textContent?.trim() } : null;
        }, unitSelectSel);
        console.log(`[RPA] Final leave unit check: ${JSON.stringify(finalUnitCheck)}`);

        // 申請ボタン有効待ち
        console.log('[RPA] Waiting for submit button...');
        const enabledSubmitSel = await findSelector(page, [
            'button[type="submit"].vb-button--appearancePrimary:has-text("申請"):not(.vb-button--disabled)',
            'button.vb-button--appearancePrimary:has-text("申請"):not(.vb-button--disabled)',
            'button[type="submit"]:has-text("申請"):not([disabled])',
        ], 15000);

        if (!enabledSubmitSel) {
            await logPageState(page, 'paid_leave_submit_disabled');
            throw new Error('申請ボタンが有効になりませんでした。必須項目を確認してください。');
        }

        console.log('[RPA] Submitting paid leave...');
        const plUrlBefore = page.url();
        await page.click(enabledSubmitSel);

        // 申請後の成功判定: 取り下げボタン / URL変化 / エラー表示 を race
        const plResult = await Promise.race([
            page.waitForSelector('button:has-text("申請を取り下げる")', { state: 'visible', timeout: 15000 }).then(() => 'withdraw' as const).catch(() => null),
            page.waitForFunction((prevUrl) => window.location.href !== prevUrl && !window.location.href.includes('/new'), plUrlBefore, { timeout: 15000 }).then(() => 'url_changed' as const).catch(() => null),
            page.waitForSelector('.vb-messageBlock__inner--alert, [role="alert"]', { state: 'visible', timeout: 15000 }).then(() => 'error' as const).catch(() => null),
        ]);

        if (plResult === 'error') {
            const vbErrorText = await page.evaluate(() => {
                for (const sel of ['.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content', '.vb-message__content', '.vb-flash--error', '[role="alert"]']) {
                    const el = document.querySelector(sel); if (el?.textContent?.trim()) return el.textContent.trim();
                }
                return null;
            });
            if (vbErrorText && (vbErrorText.includes('申請できませんでした') || vbErrorText.includes('すでに') || vbErrorText.includes('エラー') || vbErrorText.includes('失敗') || vbErrorText.includes('必須'))) {
                throw new Error(vbErrorText);
            }
        } else if (plResult === null) {
            const vbErrorText = await page.evaluate(() => {
                for (const sel of ['.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content', '.vb-message__content', '[role="alert"]']) {
                    const el = document.querySelector(sel); if (el?.textContent?.trim()) return el.textContent.trim();
                }
                return null;
            });
            if (vbErrorText && (vbErrorText.includes('申請できませんでした') || vbErrorText.includes('エラー') || vbErrorText.includes('失敗'))) throw new Error(vbErrorText);
            throw new Error('有給申請の成功を確認できませんでした（15秒タイムアウト）。');
        }

        console.log('[RPA] Paid leave application successful!');
        return { success: true, message: '有給申請が完了しました。' };

    } catch (error: any) {
        console.error('[RPA] Paid Leave Error:', error.message);
        // 申請済み・土日祝日などのビジネスエラーはそのままスロー（二重ラップしない）
        const isBusinessError = error.message.includes('申請中もしくは承認') ||
            error.message.includes('申請できません') ||
            error.message.includes('すでに')
        if (isBusinessError) throw error;
        await logPageState(page, `paid_leave_error_${error.name || 'error'}`);
        if (error.message.includes('ログイン') || error.message.includes('タイムアウト')) {
            try { fs.unlinkSync(SESSION_PATH); } catch { /* ignore */ }
        }
        throw new Error(`有給申請中にエラーが発生しました: ${error.message}`);
    } finally {
        console.log('[RPA] Closing browser.');
        await browser.close();
    }
}

// ─────────────────────────────────────────────────────────────
// 月次締め申請 Web 自動操作
// ─────────────────────────────────────────────────────────────
export async function submitMonthlyCloseViaBrowser(payload: MonthlyClosePayload & { headless?: boolean }) {
    console.log('[RPA] Starting Monthly Close automation...');

    const savedSession = loadSessionState();
    if (savedSession) console.log('[RPA] Found saved session, will attempt to skip login.');

    const browser = await chromium.launch({
        channel: 'msedge',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }).catch(() => chromium.launch({
        channel: 'chrome',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }));
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(savedSession ? { storageState: savedSession as any } : {})
    });
    const page = await context.newPage();

    await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) route.abort();
        else route.continue();
    });

    try {
        // 月次締め申請フォームへ直接ナビゲート
        const formUrl = `https://p.secure.freee.co.jp/approval_requests#/requests/new?type=ApprovalRequest::MonthlyAttendance&target_date=${payload.targetDate}&destination=work_records`;

        await doLogin(page, context, payload.email, payload.password, savedSession);

        // 月次締め申請フォームへ遷移
        await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

        console.log('[RPA] Monthly close form URL:', page.url());

        // 申請経路コンボボックスが表示されるまで待機（フォームが開いた証拠）
        const routeInputSel = await findSelector(page, [
            'input#approval-request-fields-route-id',
        ], 15000);

        if (!routeInputSel) {
            await logPageState(page, 'monthly_close_form_not_found');
            throw new Error('申請フォームが見つかりませんでした。ページ上の「申請」ボタンを確認してください。');
        }
        console.log('[RPA] Approval form is visible.');

        // 申請経路を選択
        const routeDisplayName = payload.routeName?.trim() || '';
        if (routeDisplayName) {
            await handleCombobox(page, 'input#approval-request-fields-route-id', routeDisplayName);
        }

        // 部署を選択（必要な場合）
        if (payload.departmentName || payload.departmentId) {
            const deptInput = await page.$('input#approval-request-fields-group-id');
            if (deptInput) {
                const deptDisplayName = payload.departmentName?.trim();
                if (deptDisplayName) {
                    await handleCombobox(page, 'input#approval-request-fields-group-id', deptDisplayName);
                } else if (payload.departmentId) {
                    await page.selectOption('select[name="approval_request[department_id]"]', payload.departmentId.toString()).catch(() => {});
                }
            }
        }

        // コメント（存在する場合のみ）
        if (payload.comment) {
            const commentSel = await findSelector(page, [
                'textarea[name="approval_request[comment]"]',
                '[data-test="申請理由"]',
                '[data-testid="申請理由"]',
                'input[aria-label="申請の理由を入力"]',
                'textarea[aria-label*="コメント"]',
            ], 3000).catch(() => null);
            if (commentSel) {
                await fillInputReliably(page, commentSel, payload.comment);
                console.log('[RPA] Comment filled');
            }
        }

        // フォーム検証トリガー
        await page.evaluate(() => {
            document.body.click();
            const el = document.activeElement as HTMLElement | null;
            if (el?.blur) el.blur();
        });

        // 申請ボタン有効待ち（最大15秒）
        console.log('[RPA] Waiting for submit button...');
        const enabledSubmitSel = await findSelector(page, [
            'button[type="submit"].vb-button--appearancePrimary:has-text("申請"):not(.vb-button--disabled)',
            'button.vb-button--appearancePrimary:has-text("申請"):not(.vb-button--disabled)',
            'button[type="submit"]:has-text("申請"):not([disabled])',
        ], 15000);

        if (!enabledSubmitSel) {
            await logPageState(page, 'monthly_close_submit_disabled');
            throw new Error('申請ボタンが有効になりませんでした（15秒待機）。必須項目を確認してください。');
        }

        console.log('[RPA] Submitting monthly close...');
        await page.click(enabledSubmitSel);

        // 申請後、成功 or エラーを race で待つ（最大20秒）
        const mcResult = await Promise.race([
            page.waitForSelector('button:has-text("申請を取り下げる")', { state: 'visible', timeout: 20000 }).then(() => 'success' as const).catch(() => null),
            page.waitForSelector('.vb-messageBlock__inner--alert, [role="alert"]', { state: 'visible', timeout: 20000 }).then(() => 'error' as const).catch(() => null),
        ]);

        if (mcResult === 'error' || mcResult === null) {
            const vbErrorText = await page.evaluate(() => {
                for (const sel of ['.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content', '.vb-message__content', '[role="alert"]']) {
                    const el = document.querySelector(sel); if (el?.textContent?.trim()) return el.textContent.trim();
                }
                return null;
            });
            if (vbErrorText && (vbErrorText.includes('すでに') || vbErrorText.includes('エラー') || vbErrorText.includes('失敗'))) {
                throw new Error(vbErrorText);
            }
            if (mcResult === null) console.log('[RPA] withdraw button not found (20s timeout, proceeding)');
        }

        console.log('[RPA] Monthly close application successful!');
        return { success: true, message: '月次締め申請が完了しました。' };

    } catch (error: any) {
        console.error('[RPA] Monthly Close Error:', error.message);
        const isBusinessError = error.message.includes('申請中もしくは承認') ||
            error.message.includes('申請できません') ||
            error.message.includes('すでに');
        if (isBusinessError) throw error;
        await logPageState(page, `monthly_close_error_${error.name || 'error'}`);
        if (error.message.includes('ログイン') || error.message.includes('タイムアウト')) {
            try { fs.unlinkSync(SESSION_PATH); } catch { /* ignore */ }
        }
        throw new Error(`月次締め申請中にエラーが発生しました: ${error.message}`);
    } finally {
        console.log('[RPA] Closing browser.');
        await browser.close();
    }
}

// ─────────────────────────────────────────────────────────────
// 申請取り下げ・削除 Web 自動操作
// ─────────────────────────────────────────────────────────────
export interface CancelRequestPayload {
    email: string;
    password: string;
    requestType: 'overtime' | 'paid_holiday' | 'monthly_attendance';
    requestId: number;
    action: 'withdraw' | 'delete';
    headless?: boolean;
}

export async function cancelRequestViaBrowser(payload: CancelRequestPayload): Promise<{ success: boolean; message: string }> {
    const { email, password, requestId, action } = payload;

    const savedSession = loadSessionState();
    const browser = await chromium.launch({
        channel: 'msedge',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    }).catch(() => chromium.launch({
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    }));

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(savedSession ? { storageState: savedSession as any } : {}),
    });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
        if (['image', 'media', 'font'].includes(route.request().resourceType())) route.abort();
        else route.continue();
    });

    try {
        // ─── ログイン ───────────────────────────────────────────
        await doLogin(page, context, email, password, savedSession);
        await saveSessionState(context);

        // ─── 申請一覧ページへ移動 ─────────────────────────────────
        // freeeはSPA（ハッシュルーティング）を使用しているため、一覧から対象申請へ遷移する
        const listUrl = 'https://p.secure.freee.co.jp/approval_requests#/my_requests';
        console.log(`[RPA] Navigating to my_requests list: ${listUrl}`);
        await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // SPAのレンダリング待ち
        await page.waitForTimeout(2000);

        // ─── 対象申請へのリンクを探してクリック ─────────────────────
        // freeeはhrefに申請IDを含むリンクを生成する（例: #/my_requests/123 または #/requests/123）
        console.log(`[RPA] Looking for request link with ID: ${requestId}`);
        let targetLink = await page.$(`a[href*="${requestId}"]`);

        if (!targetLink) {
            // ハッシュURLの形式が異なる可能性があるため、直接詳細URLも試みる
            const detailUrl = `https://p.secure.freee.co.jp/approval_requests#/requests/${requestId}`;
            console.log(`[RPA] Link not found in list, trying detail URL: ${detailUrl}`);
            await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);
        } else {
            console.log(`[RPA] Found link, clicking...`);
            await targetLink.click();
            await page.waitForTimeout(2000);
        }

        console.log(`[RPA] Current URL: ${page.url()}`);

        // ─── アクション実行 ─────────────────────────────────────
        if (action === 'withdraw') {
            // 取り下げ（in_progress のみ）
            const btn = await page.waitForSelector(
                'button:has-text("申請を取り下げる")',
                { state: 'visible', timeout: 15000 }
            ).catch(() => null);
            if (!btn) throw new Error('「申請を取り下げる」ボタンが見つかりませんでした。申請が承認待ち状態でない可能性があります。');
            await btn.click();
            // freee は確認ダイアログなしで直接取り下げが完了する
            // 「削除」ボタンが出現するまで待機（draft状態への遷移完了を示す）
            await page.waitForSelector('button.vb-button--appearanceSecondary:has-text("削除"), button:has-text("再申請")', { state: 'visible', timeout: 10000 }).catch(() => {});
            console.log('[RPA] Withdrawal complete.');
            return { success: true, message: '申請を取り下げました。' };
        } else {
            // 削除（in_progress の場合は「取り下げ → 削除」、draft は直接削除）
            // まず「申請を取り下げる」ボタンがあれば先に取り下げ処理を行う
            const withdrawBtn = await page.$('button:has-text("申請を取り下げる")');
            if (withdrawBtn) {
                console.log('[RPA] in_progress item detected: withdrawing first before delete...');
                await withdrawBtn.click();
                // 取り下げ後に「削除」ボタンが出現するまで待機
                await page.waitForSelector('button.vb-button--appearanceSecondary:has-text("削除"), button:has-text("再申請")', { state: 'visible', timeout: 10000 }).catch(() => {});
                console.log('[RPA] Withdrawal complete, now proceeding to delete...');
            }

            // 削除ボタンをクリック（テキスト「削除」、class vb-button--appearanceSecondary）
            const deleteBtn = await page.waitForSelector(
                'button.vb-button--appearanceSecondary:has-text("削除")',
                { state: 'visible', timeout: 10000 }
            ).catch(() => null);
            if (!deleteBtn) throw new Error('「削除」ボタンが見つかりませんでした。');
            await deleteBtn.click();
            // 確認ダイアログ: danger スタイルの「削除」ボタンが出現する
            const dangerDeleteBtn = await page.waitForSelector(
                'button.vb-button--danger:has-text("削除")',
                { state: 'visible', timeout: 5000 }
            ).catch(() => null);
            if (dangerDeleteBtn) {
                console.log('[RPA] Delete confirmation dialog found, clicking danger delete button...');
                await dangerDeleteBtn.click();
                await page.waitForTimeout(2000);
            } else {
                // ダイアログなしで直接削除された場合
                await page.waitForTimeout(1500);
            }
            return { success: true, message: '申請を削除しました。' };
        }
    } catch (error: any) {
        console.error('[RPA] Cancel/Delete request error:', error.message);
        await logPageState(page, `cancel_${action}_error`);
        if (error.message.includes('ログイン') || error.message.includes('タイムアウト')) {
            try { fs.unlinkSync(SESSION_PATH); } catch { /* ignore */ }
        }
        throw new Error(`操作に失敗しました: ${error.message}`);
    } finally {
        await browser.close();
    }
}

// ─────────────────────────────────────────────────────────────
// バッチ取り下げ・削除 Web 自動操作（ブラウザ1回起動）
// ─────────────────────────────────────────────────────────────
export interface CancelBatchPayload {
    email: string;
    password: string;
    items: Array<{
        requestType: 'overtime' | 'paid_holiday' | 'monthly_attendance';
        requestId: number;
    }>;
    action: 'withdraw' | 'delete';
    headless?: boolean;
    onProgress?: (progress: { current: number; total: number; requestId: number; success: boolean; error?: string }) => void;
}

export interface CancelBatchResult {
    total: number;
    succeeded: number;
    failed: Array<{ requestId: number; error: string }>;
}

const CANCEL_TYPE_NAME_MAP: Record<string, string> = {
    overtime: 'OvertimeWork',
    paid_holiday: 'PaidHoliday',
    monthly_attendance: 'MonthlyAttendance',
};

export async function cancelRequestBatchViaBrowser(payload: CancelBatchPayload): Promise<CancelBatchResult> {
    const { email, password, items, action, onProgress } = payload;
    const total = items.length;
    const failed: Array<{ requestId: number; error: string }> = [];
    let succeeded = 0;

    if (total === 0) return { total: 0, succeeded: 0, failed: [] };

    console.log(`[RPA CancelBatch] Starting cancel batch: ${total} items, action=${action}`);

    const savedSession = loadSessionState();
    const browser = await chromium.launch({
        channel: 'msedge',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    }).catch(() => chromium.launch({
        channel: 'chrome',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    }));

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(savedSession ? { storageState: savedSession as any } : {}),
    });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
        if (['image', 'media', 'font'].includes(route.request().resourceType())) route.abort();
        else route.continue();
    });

    try {
        await doLogin(page, context, email, password, savedSession);
        await saveSessionState(context);

        for (let i = 0; i < total; i++) {
            const item = items[i];
            console.log(`[RPA CancelBatch] [${i + 1}/${total}] Processing requestId=${item.requestId} type=${item.requestType}`);

            try {
                // セッション切れチェック
                if (page.url().includes('accounts.secure.freee.co.jp') || page.url().includes('login')) {
                    console.log('[RPA CancelBatch] Session expired, re-logging in...');
                    await doLogin(page, context, email, password, null);
                    await saveSessionState(context);
                }

                // 申請詳細ページへ遷移
                const typeName = CANCEL_TYPE_NAME_MAP[item.requestType];
                if (!typeName) throw new Error(`不明な申請タイプ: ${item.requestType}`);
                const detailUrl = `https://p.secure.freee.co.jp/approval_requests#/requests/${item.requestId}?type=ApprovalRequest::${typeName}&_t=${Date.now()}`;
                console.log(`[RPA CancelBatch] Navigating to: ${detailUrl}`);
                await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

                // ログインリダイレクトの再チェック
                if (page.url().includes('accounts.secure.freee.co.jp') || page.url().includes('login')) {
                    console.log('[RPA CancelBatch] Redirected to login, re-logging in...');
                    await doLogin(page, context, email, password, null);
                    await saveSessionState(context);
                    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                }

                // SPA レンダリング待ち
                await page.waitForTimeout(2500);
                console.log(`[RPA CancelBatch] Current URL: ${page.url()}`);

                if (action === 'withdraw') {
                    // 取り下げ
                    const btn = await page.waitForSelector(
                        'button:has-text("申請を取り下げる")',
                        { state: 'visible', timeout: 15000 }
                    ).catch(() => null);
                    if (!btn) throw new Error('「申請を取り下げる」ボタンが見つかりませんでした。申請が承認待ち状態でない可能性があります。');
                    await btn.click();
                    // freee は確認ダイアログなしで直接取り下げ完了
                    await page.waitForSelector('button.vb-button--appearanceSecondary:has-text("削除"), button:has-text("再申請")', { state: 'visible', timeout: 10000 }).catch(() => {});
                } else {
                    // 削除: in_progress の場合は取り下げ → 削除、draft は直接削除
                    const withdrawBtn = await page.$('button:has-text("申請を取り下げる")');
                    if (withdrawBtn) {
                        console.log('[RPA CancelBatch] in_progress: withdrawing first...');
                        await withdrawBtn.click();
                        await page.waitForSelector('button.vb-button--appearanceSecondary:has-text("削除"), button:has-text("再申請")', { state: 'visible', timeout: 10000 }).catch(() => {});
                        console.log('[RPA CancelBatch] Withdrawal complete, deleting...');
                    }

                    // 削除ボタン（テキスト「削除」、class vb-button--appearanceSecondary）
                    const deleteBtn = await page.waitForSelector(
                        'button.vb-button--appearanceSecondary:has-text("削除")',
                        { state: 'visible', timeout: 10000 }
                    ).catch(() => null);
                    if (!deleteBtn) throw new Error('「削除」ボタンが見つかりませんでした。');
                    await deleteBtn.click();
                    // 確認ダイアログ: danger スタイルの「削除」ボタン
                    const dangerDeleteBtn = await page.waitForSelector(
                        'button.vb-button--danger:has-text("削除")',
                        { state: 'visible', timeout: 5000 }
                    ).catch(() => null);
                    if (dangerDeleteBtn) {
                        await dangerDeleteBtn.click();
                        await page.waitForTimeout(1500);
                    } else {
                        await page.waitForTimeout(1000);
                    }
                }

                succeeded++;
                console.log(`[RPA CancelBatch] [${i + 1}/${total}] Success: requestId=${item.requestId}`);
                onProgress?.({ current: i + 1, total, requestId: item.requestId, success: true });
            } catch (err: any) {
                const errorMsg = err.message || String(err);
                console.error(`[RPA CancelBatch] [${i + 1}/${total}] Failed: requestId=${item.requestId} - ${errorMsg}`);
                await logPageState(page, `cancel_batch_${action}_${item.requestId}_error`);
                failed.push({ requestId: item.requestId, error: errorMsg });
                onProgress?.({ current: i + 1, total, requestId: item.requestId, success: false, error: errorMsg });
            }
        }

        return { total, succeeded, failed };
    } catch (error: any) {
        console.error('[RPA CancelBatch] Fatal error:', error.message);
        if (error.message.includes('ログイン') || error.message.includes('タイムアウト')) {
            try { fs.unlinkSync(SESSION_PATH); } catch { /* ignore */ }
        }
        throw new Error(`バッチ操作に失敗しました: ${error.message}`);
    } finally {
        await browser.close();
    }
}

// ─────────────────────────────────────────────────────────────
// 承認 / 差戻し Web 自動操作
// API では役職指定/部門指定経路の承認ができない（freee 仕様）ため、
// この経路に該当する申請の承認・差戻しは RPA 経由で実行する。
// ─────────────────────────────────────────────────────────────

export interface ApproveBatchItem {
    requestType: 'overtime' | 'paid_holiday' | 'monthly_attendance' | 'work_time';
    requestId: number;
}

export interface ApproveBatchPayload {
    email: string;
    password: string;
    items: ApproveBatchItem[];
    /** 'approve' | 'feedback' */
    action: 'approve' | 'feedback';
    /** 差戻し時のコメント（共通）。承認時は不要。*/
    comment?: string;
    /** 進捗コールバック（main プロセスから renderer へイベント送信用） */
    onProgress?: (progress: { current: number; total: number; requestId: number; success: boolean; message?: string }) => void;
    headless?: boolean;
}

export interface ApproveBatchResult {
    total: number;
    succeeded: number;
    failed: number;
    results: Array<{
        requestType: string;
        requestId: number;
        success: boolean;
        message?: string;
    }>;
}

/**
 * 単一申請ページで承認 or 差戻し操作を実行する。
 * 既に詳細ページに遷移済みの page を受け取り、
 * 操作完了までをハンドリングする。
 *
 * freee の実 DOM:
 * - 承認ボタン: <button class="vb-button vb-button--appearancePrimary"><span class="vb-button__text">承認</span></button>
 * - 差戻しボタン: <button class="vb-button vb-button--appearanceSecondary"><span class="vb-button__text">申請者へ差し戻す</span></button>
 */
/**
 * 完了検出の最適化:
 *  A) 操作APIのレスポンスを `waitForResponse` で監視 → 反映即座に成功判定
 *  D) クリックした element 自体の `waitForElementState('hidden')` でフォールバック
 *  両方を Promise.race で競争させ、どちらか早いほうで完了とする。
 */
async function performApprovalAction(
    page: Page,
    action: 'approve' | 'feedback',
    debug?: boolean
): Promise<{ success: boolean; message?: string }> {
    await page
        .waitForSelector('button.vb-button', { state: 'attached', timeout: 8000 })
        .catch(() => {});

    if (debug) {
        const allButtons = await page.$$eval('button', (btns) =>
            btns.map((b) => ({
                text: (b.textContent || '').trim().slice(0, 50),
                cls: (b.className || '').toString(),
                visible: !!(b as HTMLElement).offsetParent,
            }))
        );
        console.log('[RPA DEBUG] all buttons on page:', JSON.stringify(allButtons, null, 2));
    }

    /** 直近のエラートーストを取得 */
    const collectErrorToast = async (): Promise<string | null> => {
        const errMsg = await page
            .textContent('.vb-flash--error, .vb-toast--error, [role="alert"]')
            .catch(() => null);
        return errMsg && errMsg.trim() ? errMsg.trim().slice(0, 200) : null;
    };

    type RaceResult =
        | { kind: 'response'; response: import('playwright-core').Response }
        | { kind: 'gone' };

    /**
     * 承認/差戻しの API 応答を監視。
     * freee ドメイン内の非 GET リクエストかつ approval_request を含む URL に限定。
     * `Promise.any` の素材として使うため、resolve は値、失敗は reject のままにする。
     */
    const watchApiResponse = (timeout: number): Promise<RaceResult> =>
        page
            .waitForResponse(
                (response) => {
                    const method = response.request().method();
                    if (method === 'GET' || method === 'OPTIONS') return false;
                    const url = response.url();
                    if (!url.includes('freee.co.jp')) return false;
                    return url.includes('approval_request');
                },
                { timeout }
            )
            .then((response) => ({ kind: 'response' as const, response }));

    /**
     * クリック後に完了を検知する race ヘルパー。
     * - [A] freee API レスポンスの捕捉 (8s 上限)
     * - [D] クリックされた element 自体が hidden / detached になる (5s 上限)
     * Promise.any: 最初に成功した方が採用され、両方 reject した時のみ catch。
     * これにより「片方が null タイムアウトしたせいで race が壊れる」HIGH バグを回避。
     */
    const waitForCompletion = async (
        clickedEl: import('playwright-core').ElementHandle<Element | SVGElement>
    ): Promise<RaceResult | null> => {
        const responsePromise = watchApiResponse(8000);
        const elementGonePromise = clickedEl
            .waitForElementState('hidden', { timeout: 5000 })
            .then(() => ({ kind: 'gone' as const }));

        try {
            return await Promise.any([responsePromise, elementGonePromise]);
        } catch {
            // 両方失敗 = 真のタイムアウト
            return null;
        } finally {
            // pending なリスナー残留防止: 失敗 promise を消費 (no-op で吸収)
            responsePromise.catch(() => {});
            elementGonePromise.catch(() => {});
        }
    };

    /** RaceResult を最終結果に変換 */
    const interpretResult = async (
        result: RaceResult | null,
        successLabel: string,
        timeoutLabel: string
    ): Promise<{ success: boolean; message?: string }> => {
        if (result?.kind === 'response') {
            const status = result.response.status();
            if (status >= 400) {
                const body = await result.response.text().catch(() => '');
                return {
                    success: false,
                    message: `API ${status}: ${body.slice(0, 200)}`,
                };
            }
            // 念のため UI 反映の一瞬だけ待つ
            await page.waitForTimeout(200);
            return { success: true, message: successLabel };
        }
        if (result?.kind === 'gone') {
            const err = await collectErrorToast();
            if (err) return { success: false, message: `エラー表示: ${err}` };
            return { success: true, message: successLabel };
        }
        const err = await collectErrorToast();
        if (err) return { success: false, message: `エラー表示: ${err}` };
        return { success: false, message: timeoutLabel };
    };

    if (action === 'approve') {
        const approveBtn = await page
            .waitForSelector(
                'button.vb-button--appearancePrimary:has-text("承認"), button:has-text("承認する"), button.vb-button:has(span.vb-button__text:has-text("承認"))',
                { state: 'visible', timeout: 8000 }
            )
            .catch(() => null);
        if (!approveBtn) {
            return {
                success: false,
                message:
                    '「承認」ボタンが見つかりませんでした。承認権限がないか、既に処理済みの可能性があります。',
            };
        }
        await approveBtn.scrollIntoViewIfNeeded().catch(() => {});
        await approveBtn.click();

        // 確認モーダルがあれば即クリック
        const confirmBtn = await page
            .waitForSelector(
                'div[role="dialog"] button.vb-button--appearancePrimary:not(:disabled), div[role="dialog"] button:has-text("承認"):not(:disabled), button:has-text("はい"):not(:disabled), button:has-text("OK"):not(:disabled)',
                { state: 'visible', timeout: 1500 }
            )
            .catch(() => null);
        if (confirmBtn) {
            await confirmBtn.click();
            // モーダル経由の場合は確定ボタンの方が消えるため、そちらを監視
            const result = await waitForCompletion(confirmBtn);
            return interpretResult(
                result,
                '承認しました',
                '承認の完了検出がタイムアウトしました（処理は反映されている可能性あり）。'
            );
        }

        // モーダルなし: 元の承認ボタンが消える
        const result = await waitForCompletion(approveBtn);
        return interpretResult(
            result,
            '承認しました',
            '承認の完了検出がタイムアウトしました（処理は反映されている可能性あり）。'
        );
    }

    // ── 差戻し（コメント入力なし、即送信） ──
    const feedbackBtn = await page
        .waitForSelector(
            'button.vb-button--appearanceSecondary:has-text("申請者へ差し戻す"), button:has-text("申請者へ差し戻す"), button:has-text("差し戻す"), button:has-text("差戻し"), button.vb-button:has(span.vb-button__text:has-text("差し戻す"))',
            { state: 'visible', timeout: 8000 }
        )
        .catch(() => null);
    if (!feedbackBtn) {
        return {
            success: false,
            message:
                '「差し戻す」ボタンが見つかりませんでした。承認権限がないか、既に処理済みの可能性があります。',
        };
    }
    await feedbackBtn.scrollIntoViewIfNeeded().catch(() => {});
    await feedbackBtn.click();

    const submitBtn = await page
        .waitForSelector(
            'div[role="dialog"] button.vb-button--appearancePrimary:not(:disabled), div[role="dialog"] button:has-text("差し戻す"):not(:disabled), button:has-text("差し戻す"):not(:disabled):not(.vb-button--appearanceSecondary), button:has-text("送信"):not(:disabled), button:has-text("OK"):not(:disabled), button:has-text("はい"):not(:disabled)',
            { state: 'visible', timeout: 4000 }
        )
        .catch(() => null);
    if (!submitBtn) {
        return {
            success: false,
            message: '差戻しの確定ボタン（モーダル内）が見つかりませんでした。',
        };
    }
    await submitBtn.click();

    // モーダル内の確定ボタンが対象（差戻し処理後にモーダルは閉じられる想定）
    const result = await waitForCompletion(submitBtn);
    return interpretResult(
        result,
        '差し戻しました',
        '差戻しの完了検出がタイムアウトしました（処理は反映されている可能性あり）。'
    );
}

/**
 * 承認/差戻しのバッチ実行。
 * 1つのブラウザインスタンスを再利用し、複数の申請を順次処理する。
 * 各件の進捗は onProgress コールバックで通知。
 *
 * 環境変数 RPA_DEBUG=1 が設定されている場合、ヘッドレスを無効化しブラウザを表示する。
 * セレクタミスマッチ等の調査時に有用。
 */
const TYPE_NAME_MAP: Record<ApproveBatchItem['requestType'], string> = {
    overtime: 'OvertimeWork',
    paid_holiday: 'PaidHoliday',
    monthly_attendance: 'MonthlyAttendance',
    work_time: 'WorkTime',
};

function buildApproverDetailUrl(item: ApproveBatchItem): string {
    const typeName = TYPE_NAME_MAP[item.requestType];
    const params = new URLSearchParams({
        type: `ApprovalRequest::${typeName}`,
        status: 'in_progress',
    });
    return `https://p.secure.freee.co.jp/approval_requests#/approvals/${item.requestId}?${params.toString()}`;
}

/** 一括承認用の一覧 URL を生成（種別フィルタ付き） */
function buildApproverListUrl(typeKey: ApproveBatchItem['requestType']): string {
    const typeName = TYPE_NAME_MAP[typeKey];
    const params = new URLSearchParams({
        type: `ApprovalRequest::${typeName}`,
        status: 'in_progress',
        per: '100',
    });
    return `https://p.secure.freee.co.jp/approval_requests#/approvals?${params.toString()}`;
}

/**
 * freee Web の「一括承認」UI を使った高速一括承認。
 * 詳細ページ遷移なしで、一覧 → 該当行のチェックボックス → 一括承認ボタンの3ステップで完了。
 *
 * フロー:
 *  1. 種別ごとに承認待ち一覧へ遷移
 *  2. 行 DOM の `a[href*="/approvals/{id}"]` で該当行を特定し checkbox にチェック
 *  3. data-testid="一括承認ボタン" を押下
 *  4. (確認モーダルがあれば確定) → API レスポンス待機
 *  5. 一覧から消えた ID を成功扱い、残った ID を失敗扱い
 *
 * @param payload 入力 (action は 'approve' のみ対応)
 * @returns 各 ID の成否
 */
export async function approveBulkViaBrowser(payload: ApproveBatchPayload): Promise<ApproveBatchResult> {
    const { email, password, items, headless, onProgress } = payload;
    const total = items.length;
    if (total === 0) return { total: 0, succeeded: 0, failed: 0, results: [] };

    const debugMode = process.env.RPA_DEBUG === '1' || process.env.RPA_DEBUG === 'true';
    const effectiveHeadless = debugMode ? false : headless !== false;

    const savedSession = loadSessionState();
    const browser = await chromium.launch({
        channel: 'msedge',
        headless: effectiveHeadless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    }).catch(() => chromium.launch({
        headless: effectiveHeadless,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    }));
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(savedSession ? { storageState: savedSession as any } : {}),
    });
    const page = await context.newPage();
    if (!debugMode) {
        await page.route('**/*', (route) => {
            if (['image', 'media', 'font'].includes(route.request().resourceType())) route.abort();
            else route.continue();
        });
    }

    const results: ApproveBatchResult['results'] = [];

    try {
        await doLogin(page, context, email, password, savedSession);
        await saveSessionState(context);

        // 種別ごとにグルーピング
        const byType: Record<string, ApproveBatchItem[]> = {};
        for (const item of items) {
            (byType[item.requestType] ||= []).push(item);
        }

        let processedCount = 0;

        for (const typeKey of Object.keys(byType) as ApproveBatchItem['requestType'][]) {
            const typeItems = byType[typeKey];
            const targetIds = typeItems.map((it) => String(it.requestId));
            const url = buildApproverListUrl(typeKey);
            console.log(`[RPA bulk] ${typeKey}: navigating to ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // 一覧描画 + 一括承認ボタンの可視化を待つ
            const listReady = await page.waitForSelector(
                '[data-testid="一括承認ボタン"], button[data-test="一括承認ボタン"], button:has-text("一括承認")',
                { state: 'attached', timeout: 12000 }
            ).catch(() => null);
            if (!listReady) {
                console.warn(`[RPA bulk] ${typeKey}: 一括承認ボタンが見つかりません`);
                for (const item of typeItems) {
                    results.push({
                        requestType: item.requestType,
                        requestId: item.requestId,
                        success: false,
                        message: '一括承認ボタンが見つからない（権限/種別不一致の可能性）',
                    });
                }
                continue;
            }
            // SPA hydration 余裕
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

            if (debugMode) {
                await logPageState(page, `bulk_${typeKey}_list`);
            }

            // 各 ID に対応する行のチェックボックスを順次クリック
            // freee の一覧テーブルでは:
            //   - 行内に a[href*="approvals/{id}"] のリンクがある（#approvals/ 形式）
            //   - チェックボックスは input.vb-checkBoxCell__input[type="checkbox"][aria-label="この行を選択"]
            const checkedIds: string[] = [];
            for (const id of targetIds) {
                // href は "approvals/ID?" の形式（# 付きハッシュルーティング）
                const cbSelectors = [
                    `tr:has(a[href*="approvals/${id}?"]) input.vb-checkBoxCell__input[type="checkbox"]`,
                    `tr:has(a[href*="approvals/${id}?"]) input[type="checkbox"][aria-label="この行を選択"]`,
                    `tr:has(a[href*="approvals/${id}"]) input[type="checkbox"]`,
                ];
                let found = false;
                for (const sel of cbSelectors) {
                    const cb = page.locator(sel).first();
                    if (await cb.count() > 0) {
                        try {
                            await cb.click({ timeout: 3000 });
                            checkedIds.push(id);
                            found = true;
                            console.log(`[RPA bulk] ${typeKey}: ID ${id} checked`);
                            break;
                        } catch (e: any) {
                            console.warn(`[RPA bulk] ${typeKey}: ID ${id} click failed with ${sel}: ${e?.message}`);
                        }
                    }
                }
                if (!found) {
                    console.warn(`[RPA bulk] ${typeKey}: ID ${id} の行が一覧に見つかりません`);
                }
            }

            if (checkedIds.length === 0) {
                for (const item of typeItems) {
                    results.push({
                        requestType: item.requestType,
                        requestId: item.requestId,
                        success: false,
                        message: '該当行が一覧に見つかりませんでした',
                    });
                }
                continue;
            }

            // API レスポンス監視を開始してから一括承認ボタンを押下
            const responsePromise = page.waitForResponse(
                (response) => {
                    const method = response.request().method();
                    if (method === 'GET' || method === 'OPTIONS') return false;
                    const u = response.url();
                    return u.includes('freee.co.jp') && u.includes('approval');
                },
                { timeout: 15000 }
            ).catch(() => null);

            const bulkBtn = page.locator(
                '[data-testid="一括承認ボタン"], button[data-test="一括承認ボタン"]'
            ).first();
            try {
                await bulkBtn.click({ timeout: 5000 });
            } catch (e: any) {
                console.error(`[RPA bulk] ${typeKey}: 一括承認ボタン押下失敗: ${e?.message}`);
                for (const item of typeItems) {
                    results.push({
                        requestType: item.requestType,
                        requestId: item.requestId,
                        success: false,
                        message: `一括承認ボタン押下失敗: ${e?.message || ''}`,
                    });
                }
                continue;
            }

            // 確認モーダル（出ない仕様だが念のため）
            const confirmBtn = await page.waitForSelector(
                'div[role="dialog"] button.vb-button--appearancePrimary:not(:disabled), div[role="dialog"] button:has-text("承認"):not(:disabled), div[role="dialog"] button:has-text("OK"):not(:disabled), div[role="dialog"] button:has-text("はい"):not(:disabled)',
                { state: 'visible', timeout: 1500 }
            ).catch(() => null);
            if (confirmBtn) {
                await confirmBtn.click();
            }

            const apiResp = await responsePromise;
            // APIレスポンスで成功判定（多段階承認の場合も一覧からIDが消えないためレスポンスで判定）
            const apiSuccess = apiResp ? apiResp.status() >= 200 && apiResp.status() < 300 : false;
            console.log(`[RPA bulk] ${typeKey}: API response status=${apiResp?.status() ?? 'timeout'}, success=${apiSuccess}`);

            if (debugMode) {
                await page.waitForTimeout(1500);
                await logPageState(page, `bulk_${typeKey}_after`);
            }

            for (const item of typeItems) {
                const idStr = String(item.requestId);
                const wasChecked = checkedIds.includes(idStr);
                const success = wasChecked && apiSuccess;
                results.push({
                    requestType: item.requestType,
                    requestId: item.requestId,
                    success,
                    message: success
                        ? '承認しました（一括）'
                        : !wasChecked
                            ? '該当行が一覧に見つかりませんでした'
                            : apiSuccess ? '承認しました（一括）' : '一括承認のAPIレスポンスが失敗しました',
                });
                processedCount++;
                onProgress?.({
                    current: processedCount,
                    total,
                    requestId: item.requestId,
                    success,
                    message: success ? '承認完了' : '失敗',
                });
            }
        }

        const succeeded = results.filter((r) => r.success).length;
        return { total, succeeded, failed: total - succeeded, results };
    } finally {
        if (debugMode) {
            console.log('[RPA bulk] DEBUG: 終了前2秒待機');
            await page.waitForTimeout(2000);
        }
        await browser.close();
    }
}

export async function approveBatchViaBrowser(
    payload: ApproveBatchPayload
): Promise<ApproveBatchResult> {
    const { email, password, items, action, headless, onProgress } = payload;
    const total = items.length;
    const results: ApproveBatchResult['results'] = [];

    if (total === 0) {
        return { total: 0, succeeded: 0, failed: 0, results: [] };
    }

    // 環境変数で headless モードを上書きできるようにする
    const debugMode = process.env.RPA_DEBUG === '1' || process.env.RPA_DEBUG === 'true';
    const effectiveHeadless = debugMode ? false : headless !== false;
    if (debugMode) {
        console.log('[RPA] DEBUG MODE: ブラウザを表示し、詳細ログを出力します。');
    }

    const savedSession = loadSessionState();
    const browser = await chromium
        .launch({
            channel: 'msedge',
            headless: effectiveHeadless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
        })
        .catch(() =>
            chromium.launch({
                headless: effectiveHeadless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                ],
            })
        );

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(savedSession ? { storageState: savedSession as any } : {}),
    });
    const page = await context.newPage();
    // デバッグモード時は画像も読み込む（目視確認のため）
    if (!debugMode) {
        await page.route('**/*', (route) => {
            if (['image', 'media', 'font'].includes(route.request().resourceType()))
                route.abort();
            else route.continue();
        });
    }

    try {
        // ─── ログイン（共有セッション） ─────────────────────────
        await doLogin(page, context, email, password, savedSession);
        await saveSessionState(context);

        for (let i = 0; i < total; i++) {
            const item = items[i];
            const detailUrl = buildApproverDetailUrl(item);
            console.log(`[RPA] [${i + 1}/${total}] ${action} request ${item.requestId}...`);

            try {
                await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                // 承認/差戻しボタンの可視化を待つ（最大8秒、見えなければ追加2.5秒固定）
                const btnFound = await page
                    .waitForSelector(
                        'button.vb-button--appearancePrimary:has-text("承認"), button.vb-button--appearanceSecondary:has-text("申請者へ差し戻す"), button:has-text("差し戻す")',
                        { state: 'visible', timeout: 8000 }
                    )
                    .then(() => true)
                    .catch(() => false);
                if (!btnFound) {
                    console.warn(`[RPA] Buttons not visible after 8s, waiting additional 2.5s for ID ${item.requestId}`);
                    await page.waitForTimeout(2500);
                }

                if (debugMode) {
                    console.log(`[RPA DEBUG] page URL: ${page.url()}`);
                    await logPageState(page, `approval_${action}_before_${item.requestId}`);
                }

                const result = await performApprovalAction(page, action, debugMode);
                results.push({
                    requestType: item.requestType,
                    requestId: item.requestId,
                    success: result.success,
                    message: result.message,
                });
                onProgress?.({
                    current: i + 1,
                    total,
                    requestId: item.requestId,
                    success: result.success,
                    message: result.message,
                });

                if (!result.success) {
                    await logPageState(page, `approval_${action}_failed_${item.requestId}`);
                }

                // 次のアイテム前にモーダル後始末（差戻しの場合）
                await page.keyboard.press('Escape').catch(() => {});
            } catch (e: any) {
                const message = e?.message || '不明なエラー';
                console.error(`[RPA] item ${item.requestId} failed:`, message);
                await logPageState(page, `approval_${action}_error_${item.requestId}`);
                results.push({
                    requestType: item.requestType,
                    requestId: item.requestId,
                    success: false,
                    message,
                });
                onProgress?.({
                    current: i + 1,
                    total,
                    requestId: item.requestId,
                    success: false,
                    message,
                });
            }
        }

        const succeeded = results.filter((r) => r.success).length;
        return { total, succeeded, failed: total - succeeded, results };
    } finally {
        // デバッグモード時のみ最後に2秒だけ結果確認時間を取る（処理速度を優先）
        if (debugMode) {
            console.log('[RPA] DEBUG: 終了前2秒待機');
            await page.waitForTimeout(2000);
        }
        await browser.close();
    }
}

// ─────────────────────────────────────────────────────────────
// バッチ残業申請 Web 自動操作（ブラウザ1回起動、ログイン1回）
// ─────────────────────────────────────────────────────────────
export interface OvertimeBatchPayload {
    email: string;
    password: string;
    companyId: number;
    items: Array<{ targetDate: string; startAt: string; endAt: string }>;
    comment: string;
    routeId: number;
    routeName: string;
    departmentId?: number;
    departmentName?: string;
    headless?: boolean;
    onProgress?: (progress: { current: number; total: number; date: string; success: boolean; error?: string }) => void;
}

export interface BatchSubmitResult {
    total: number;
    succeeded: number;
    failed: Array<{ date: string; error: string }>;
}

export async function submitOvertimeBatchViaBrowser(payload: OvertimeBatchPayload): Promise<BatchSubmitResult> {
    const { email, password, items, onProgress } = payload;
    const total = items.length;
    const failed: Array<{ date: string; error: string }> = [];
    let succeeded = 0;

    if (total === 0) return { total: 0, succeeded: 0, failed: [] };

    console.log(`[RPA Batch] Starting overtime batch: ${total} items`);

    const savedSession = loadSessionState();
    const browser = await chromium.launch({
        channel: 'msedge',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }).catch(() => chromium.launch({
        channel: 'chrome',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }));

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(savedSession ? { storageState: savedSession as any } : {})
    });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
        if (['image', 'media', 'font'].includes(route.request().resourceType())) route.abort();
        else route.continue();
    });

    try {
        await doLogin(page, context, email, password, savedSession);
        await saveSessionState(context);

        const overtimeUrl = 'https://p.secure.freee.co.jp/approval_requests#/requests/new?type=ApprovalRequest::OvertimeWork';
        const overtimeLegacyUrl = `https://secure.freee.co.jp/hr/businesses/${payload.companyId}/approval_requests/overtime_works/new`;

        for (let i = 0; i < total; i++) {
            const item = items[i];
            const normalizedDate = item.targetDate.includes('-') && item.targetDate.length >= 10
                ? item.targetDate.slice(0, 10)
                : item.targetDate.replace(/\//g, '-').slice(0, 10);

            console.log(`[RPA Batch] [${i + 1}/${total}] Processing: ${normalizedDate}`);

            try {
                // セッション切れチェック
                if (page.url().includes('accounts.secure.freee.co.jp') || page.url().includes('login')) {
                    console.log('[RPA Batch] Session expired, re-logging in...');
                    await doLogin(page, context, email, password, null);
                    await saveSessionState(context);
                }

                // 新規フォームに遷移（SPAキャッシュバイパスのため _t パラメータ付加）
                const batchOvertimeUrl = `${overtimeUrl}&_t=${Date.now()}`;
                await page.goto(batchOvertimeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                if (!page.url().includes('p.secure.freee.co.jp') && !page.url().includes('overtime_work')) {
                    await page.goto(overtimeLegacyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                }

                // ログインリダイレクトの再チェック
                if (page.url().includes('accounts.secure.freee.co.jp') || page.url().includes('login')) {
                    console.log('[RPA Batch] Redirected to login, re-logging in...');
                    await doLogin(page, context, email, password, null);
                    await saveSessionState(context);
                    await page.goto(batchOvertimeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                }

                console.log(`[RPA Batch] Form URL: ${page.url()}`);

                // ─── フォーム入力開始 ───
                const dateFieldSel = await findSelector(page,
                    ['input#approval-request-fields-date', 'input[name="approval_request[target_date]"]'],
                    25000
                );
                if (!dateFieldSel) throw new Error('対象日入力欄が見つかりませんでした。');

                // React マウント待機（フォームが完全に初期化されるまで）
                await page.waitForFunction((sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return false;
                    return Object.keys(el).some(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
                }, dateFieldSel, { timeout: 10000 }).catch(() => {});
                // SPA描画安定待ち（フォームフィールドの初期化完了を保証）
                await page.waitForTimeout(1000);

                // 日付入力
                const dateOk = await fillInputReliably(page, dateFieldSel, normalizedDate);
                if (!dateOk) throw new Error(`対象日の入力に失敗しました: ${normalizedDate}`);

                // 時間フィールド待機
                await page.waitForFunction((dateSel) => {
                    const dateEl = document.querySelector(dateSel);
                    return Array.from(document.querySelectorAll('input')).filter(el => {
                        if (el === dateEl) return false;
                        if (el.getAttribute('role') === 'combobox') return false;
                        if (['hidden', 'checkbox', 'radio'].includes((el as HTMLInputElement).type)) return false;
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    }).length >= 2;
                }, dateFieldSel, { timeout: 5000 }).catch(() => {});

                // 時間フィールド動的発見
                const timeFieldSelectors = await page.evaluate((dateSel: string) => {
                    const dateEl = document.querySelector(dateSel);
                    return Array.from(document.querySelectorAll<HTMLInputElement>('input'))
                        .filter(el => {
                            if (el === dateEl) return false;
                            if (el.getAttribute('role') === 'combobox') return false;
                            if (['hidden', 'checkbox', 'radio'].includes(el.type)) return false;
                            const rect = el.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0;
                        })
                        .slice(0, 2)
                        .map(el => {
                            if (el.id) return `#${el.id}`;
                            if (el.name) return `input[name="${el.name}"]`;
                            const parent = el.parentElement;
                            return parent?.id ? `#${parent.id} input` : null;
                        })
                        .filter(Boolean) as string[];
                }, dateFieldSel);

                // 時間入力
                const timeValues = [item.startAt, item.endAt];
                for (let t = 0; t < Math.min(timeFieldSelectors.length, 2); t++) {
                    const ok = await fillInputReliably(page, timeFieldSelectors[t], timeValues[t]);
                    if (!ok) throw new Error(`時刻の入力に失敗しました: ${timeValues[t]}`);
                }

                // フォールバック
                if (timeFieldSelectors.length < 2) {
                    const fbStart = await findSelector(page, ['input#approval-request-fields-started-at', 'input[name="approval_request[start_at]"]'], 2000);
                    const fbEnd = await findSelector(page, ['input#approval-request-fields-end-at', 'input[name="approval_request[end_at]"]'], 2000);
                    if (fbStart) { const ok = await fillInputReliably(page, fbStart, item.startAt); if (!ok) throw new Error('開始時刻の入力に失敗しました'); }
                    if (fbEnd) { const ok = await fillInputReliably(page, fbEnd, item.endAt); if (!ok) throw new Error('終了時刻の入力に失敗しました'); }
                }

                // 申請理由
                const reasonSel = await findSelector(page, [
                    '[data-test="申請理由"]', '[data-testid="申請理由"]',
                    'input[aria-label="申請の理由を入力"]', 'textarea[name="approval_request[comment]"]'
                ], 5000);
                if (reasonSel && payload.comment) {
                    await fillInputReliably(page, reasonSel, payload.comment);
                }

                // 申請経路
                const routeDisplayName = payload.routeName?.trim() || '残業申請';
                const routeInput = await page.$('input#approval-request-fields-route-id');
                if (routeInput) {
                    await handleCombobox(page, 'input#approval-request-fields-route-id', routeDisplayName);
                } else {
                    await page.selectOption('select[name="approval_request[approval_flow_route_id]"]', payload.routeId.toString()).catch(() => {});
                }

                // 部署
                if (payload.departmentId || payload.departmentName) {
                    const deptDisplayName = payload.departmentName?.trim();
                    const deptInput = await page.$('input#approval-request-fields-group-id');
                    if (deptInput && deptDisplayName) {
                        await handleCombobox(page, 'input#approval-request-fields-group-id', deptDisplayName);
                    } else if (payload.departmentId) {
                        await page.selectOption('select[name="approval_request[department_id]"]', payload.departmentId.toString()).catch(() => {});
                    }
                }

                // 送信前検証: 日付
                const dateActual = await page.evaluate((sel) => {
                    const el = document.querySelector(sel) as HTMLInputElement | null;
                    return el?.value || '';
                }, dateFieldSel);
                if (dateActual !== normalizedDate) {
                    console.warn(`[RPA Batch] Date wrong: "${dateActual}", re-filling...`);
                    const reOk = await fillInputReliably(page, dateFieldSel, normalizedDate);
                    if (!reOk) throw new Error(`対象日の再入力に失敗しました: ${normalizedDate}`);
                    await page.waitForTimeout(2000);
                    // 日付変更後は全フィールドが再描画されるため再入力
                    // 時間フィールド再入力
                    const retryTimeFields = await page.evaluate((dateSel: string) => {
                        const dateEl = document.querySelector(dateSel);
                        return Array.from(document.querySelectorAll<HTMLInputElement>('input'))
                            .filter(el => { if (el === dateEl || el.getAttribute('role') === 'combobox') return false; if (['hidden','checkbox','radio'].includes(el.type)) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
                            .slice(0, 2).map(el => el.id ? `#${el.id}` : (el.name ? `input[name="${el.name}"]` : '')).filter(Boolean);
                    }, dateFieldSel);
                    for (let t = 0; t < Math.min(retryTimeFields.length, 2); t++) {
                        await fillInputReliably(page, retryTimeFields[t], timeValues[t]);
                    }
                    // 申請理由再入力
                    const reasonSel2 = await findSelector(page, ['[data-test="申請理由"]', '[data-testid="申請理由"]', 'input[aria-label="申請の理由を入力"]', 'textarea[name="approval_request[comment]"]'], 3000);
                    if (reasonSel2 && payload.comment) await fillInputReliably(page, reasonSel2, payload.comment);
                    // 経路・部署再入力
                    const routeInput2 = await page.$('input#approval-request-fields-route-id');
                    if (routeInput2) await handleCombobox(page, 'input#approval-request-fields-route-id', routeDisplayName);
                    if (payload.departmentName?.trim()) {
                        const deptInput2 = await page.$('input#approval-request-fields-group-id');
                        if (deptInput2) await handleCombobox(page, 'input#approval-request-fields-group-id', payload.departmentName.trim());
                    }
                }

                // 送信前検証: 時間
                const verifyTimeFields = await page.evaluate((dateSel: string) => {
                    const dateEl = document.querySelector(dateSel);
                    return Array.from(document.querySelectorAll<HTMLInputElement>('input'))
                        .filter(el => {
                            if (el === dateEl) return false;
                            if (el.getAttribute('role') === 'combobox') return false;
                            if (['hidden', 'checkbox', 'radio'].includes(el.type)) return false;
                            const rect = el.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0;
                        })
                        .slice(0, 2)
                        .map(el => ({ sel: el.id ? `#${el.id}` : (el.name ? `input[name="${el.name}"]` : ''), val: el.value }))
                        .filter(x => x.sel);
                }, dateFieldSel);
                for (let t = 0; t < Math.min(verifyTimeFields.length, 2); t++) {
                    const { sel, val } = verifyTimeFields[t];
                    const expected = timeValues[t];
                    if (!val || val !== expected) {
                        const ok = await fillInputReliably(page, sel, expected);
                        if (!ok) throw new Error(`時刻の再入力に失敗しました: ${expected}`);
                    }
                }

                // blur でバリデーション発火
                await page.evaluate(() => { document.body.click(); (document.activeElement as HTMLElement | null)?.blur?.(); });

                // 申請ボタン
                const enabledSubmitSel = await findSelector(page, [
                    'button[type="submit"].vb-button--appearancePrimary:has-text("申請"):not(.vb-button--disabled)',
                    'button.vb-button--appearancePrimary:has-text("申請"):not(.vb-button--disabled)',
                    'button[type="submit"]:has-text("申請"):not([disabled])',
                ], 15000);
                if (!enabledSubmitSel) throw new Error('申請ボタンが有効になりませんでした。');

                await page.click(enabledSubmitSel);
                await page.waitForTimeout(2000);

                // エラーチェック
                const vbErrorText = await page.evaluate(() => {
                    const msgBlock = document.querySelector('.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content');
                    if (msgBlock?.textContent?.trim()) return msgBlock.textContent.trim();
                    const msgContent = document.querySelector('.vb-message__content');
                    if (msgContent?.textContent?.trim()) return msgContent.textContent.trim();
                    const flash = document.querySelector('.vb-flash--error');
                    if (flash?.textContent?.trim()) return flash.textContent.trim();
                    const alert = document.querySelector('[role="alert"]');
                    if (alert?.textContent?.trim()) return alert.textContent.trim();
                    return null;
                });
                if (vbErrorText && (vbErrorText.includes('申請できませんでした') || vbErrorText.includes('すでに') || vbErrorText.includes('エラー') || vbErrorText.includes('失敗') || vbErrorText.includes('必須'))) {
                    throw new Error(vbErrorText);
                }

                // 成功確認（race: 取り下げボタン / URL変化 / エラー、最大15秒）
                const urlBeforeBatch = page.url();
                const batchSuccessOrError = await Promise.race([
                    page.waitForSelector('button:has-text("申請を取り下げる")', { state: 'visible', timeout: 15000 }).then(() => 'withdraw' as const).catch(() => null),
                    page.waitForFunction((prevUrl) => window.location.href !== prevUrl && !window.location.href.includes('/new'), urlBeforeBatch, { timeout: 15000 }).then(() => 'url_changed' as const).catch(() => null),
                    page.waitForSelector('.vb-messageBlock__inner--alert, [role="alert"]', { state: 'visible', timeout: 15000 }).then(() => 'error' as const).catch(() => null),
                ]);
                if (batchSuccessOrError === 'error') {
                    const errText = await page.evaluate(() => {
                        for (const sel of ['.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content', '.vb-message__content', '[role="alert"]']) {
                            const el = document.querySelector(sel); if (el?.textContent?.trim()) return el.textContent.trim();
                        }
                        return null;
                    });
                    if (errText && (errText.includes('申請できませんでした') || errText.includes('すでに') || errText.includes('エラー') || errText.includes('失敗'))) throw new Error(errText);
                } else if (batchSuccessOrError === null) {
                    const errText = await page.evaluate(() => { for (const sel of ['.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content', '.vb-message__content', '[role="alert"]']) { const el = document.querySelector(sel); if (el?.textContent?.trim()) return el.textContent.trim(); } return null; });
                    if (errText && (errText.includes('申請できませんでした') || errText.includes('エラー') || errText.includes('失敗'))) throw new Error(errText);
                    throw new Error('申請の成功を確認できませんでした（15秒タイムアウト）。');
                }

                console.log(`[RPA Batch] [${i + 1}/${total}] SUCCESS: ${normalizedDate}`);
                succeeded++;
                onProgress?.({ current: i + 1, total, date: normalizedDate, success: true });

            } catch (e: any) {
                const msg = e?.message || '不明なエラー';
                console.error(`[RPA Batch] [${i + 1}/${total}] FAILED: ${item.targetDate} - ${msg}`);
                failed.push({ date: item.targetDate, error: msg });
                onProgress?.({ current: i + 1, total, date: item.targetDate, success: false, error: msg });
            }
        }

        return { total, succeeded, failed };
    } finally {
        console.log('[RPA Batch] Closing browser.');
        await browser.close();
    }
}

// ─────────────────────────────────────────────────────────────
// バッチ有給申請 Web 自動操作（ブラウザ1回起動、ログイン1回）
// ─────────────────────────────────────────────────────────────
export interface PaidLeaveBatchPayload {
    email: string;
    password: string;
    companyId: number;
    items: Array<{ targetDate: string }>;
    leaveUnit: 'full_day' | 'am_half' | 'pm_half';
    comment: string;
    routeId: number;
    routeName: string;
    departmentId?: number;
    departmentName?: string;
    headless?: boolean;
    onProgress?: (progress: { current: number; total: number; date: string; success: boolean; error?: string }) => void;
}

export async function submitPaidLeaveBatchViaBrowser(payload: PaidLeaveBatchPayload): Promise<BatchSubmitResult> {
    const { email, password, items, onProgress } = payload;
    const total = items.length;
    const failed: Array<{ date: string; error: string }> = [];
    let succeeded = 0;

    if (total === 0) return { total: 0, succeeded: 0, failed: [] };

    console.log(`[RPA Batch] Starting paid leave batch: ${total} items`);

    const savedSession = loadSessionState();
    const browser = await chromium.launch({
        channel: 'msedge',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }).catch(() => chromium.launch({
        channel: 'chrome',
        headless: payload.headless !== false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    }));

    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(savedSession ? { storageState: savedSession as any } : {})
    });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
        if (['image', 'media', 'font'].includes(route.request().resourceType())) route.abort();
        else route.continue();
    });

    try {
        await doLogin(page, context, email, password, savedSession);
        await saveSessionState(context);

        const paidLeaveUrl = 'https://p.secure.freee.co.jp/approval_requests#/requests/new?type=ApprovalRequest::PaidHoliday';
        const paidLeaveLegacyUrl = `https://secure.freee.co.jp/hr/businesses/${payload.companyId}/approval_requests/paid_holidays/new`;

        const { LEAVE_UNIT_TO_WEB, LEAVE_UNIT_LABELS } = await import('../shared/leaveUnit');
        const unitValue = LEAVE_UNIT_TO_WEB[payload.leaveUnit] || 'full';

        for (let i = 0; i < total; i++) {
            const item = items[i];
            const normalizedDate = item.targetDate.includes('-') && item.targetDate.length >= 10
                ? item.targetDate.slice(0, 10)
                : item.targetDate.replace(/\//g, '-').slice(0, 10);

            console.log(`[RPA Batch] [${i + 1}/${total}] Processing paid leave: ${normalizedDate}`);

            try {
                // 土日祝日チェック
                const nonWorking = checkNonWorkingDay(normalizedDate);
                if (nonWorking.isNonWorking) {
                    throw new Error(`${normalizedDate} は${nonWorking.reason}のため申請できません。`);
                }

                // セッション切れチェック
                if (page.url().includes('accounts.secure.freee.co.jp') || page.url().includes('login')) {
                    await doLogin(page, context, email, password, null);
                    await saveSessionState(context);
                }

                // 新規フォームに遷移（SPAキャッシュバイパスのため _t パラメータ付加）
                const batchPaidLeaveUrl = `${paidLeaveUrl}&_t=${Date.now()}`;
                await page.goto(batchPaidLeaveUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                if (!page.url().includes('p.secure.freee.co.jp')) {
                    await page.goto(paidLeaveLegacyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                }

                // ログインリダイレクトの再チェック
                if (page.url().includes('accounts.secure.freee.co.jp') || page.url().includes('login')) {
                    await doLogin(page, context, email, password, null);
                    await saveSessionState(context);
                    await page.goto(batchPaidLeaveUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                }

                // 日付フィールド + React マウント待機
                const dateFieldSel = await findSelector(page,
                    ['input#approval-request-fields-date', 'input[name="approval_request[target_date]"]',
                     'input[type="date"]', 'input[id*="date"]'],
                    25000
                );
                if (!dateFieldSel) throw new Error('対象日入力欄が見つかりませんでした。');

                await page.waitForFunction((sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return false;
                    return Object.keys(el).some(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
                }, dateFieldSel, { timeout: 10000 }).catch(() => {});
                // SPA描画安定待ち
                await page.waitForTimeout(1000);

                // 日付入力
                const dateOk = await fillInputReliably(page, dateFieldSel, normalizedDate);
                if (!dateOk) throw new Error(`対象日の入力に失敗しました: ${normalizedDate}`);
                await page.waitForTimeout(2000);

                // 申請理由
                const reasonSel = await findSelector(page, [
                    '[data-test="申請理由"]', '[data-testid="申請理由"]',
                    'input[aria-label="申請の理由を入力"]', 'textarea[name="approval_request[comment]"]'
                ], 5000);
                if (reasonSel && payload.comment) {
                    await fillInputReliably(page, reasonSel, payload.comment);
                }

                // 申請経路
                const routeDisplayName = payload.routeName?.trim() || '有給申請';
                const routeInput = await page.$('input#approval-request-fields-route-id');
                if (routeInput) {
                    await handleCombobox(page, 'input#approval-request-fields-route-id', routeDisplayName);
                }

                // 部署
                if (payload.departmentId || payload.departmentName) {
                    const deptDisplayName = payload.departmentName?.trim();
                    const deptInput = await page.$('input#approval-request-fields-group-id');
                    if (deptInput && deptDisplayName) {
                        await handleCombobox(page, 'input#approval-request-fields-group-id', deptDisplayName);
                    }
                }

                // 日付検証
                const dateActual = await page.evaluate((sel) => {
                    const el = document.querySelector(sel) as HTMLInputElement | null;
                    return el?.value || '';
                }, dateFieldSel);
                if (dateActual !== normalizedDate) {
                    console.warn(`[RPA Batch] Date wrong: "${dateActual}", re-filling...`);
                    const reOk = await fillInputReliably(page, dateFieldSel, normalizedDate);
                    if (!reOk) throw new Error(`対象日の再入力に失敗しました: ${normalizedDate}`);
                    await page.waitForTimeout(3000);
                    // 日付変更後は全フィールドが再描画されるため再入力
                    const reasonSel2 = await findSelector(page, ['[data-test="申請理由"]', '[data-testid="申請理由"]', 'input[aria-label="申請の理由を入力"]', 'textarea[name="approval_request[comment]"]'], 3000);
                    if (reasonSel2 && payload.comment) await fillInputReliably(page, reasonSel2, payload.comment);
                    const routeInput2 = await page.$('input#approval-request-fields-route-id');
                    if (routeInput2) await handleCombobox(page, 'input#approval-request-fields-route-id', routeDisplayName);
                    if (payload.departmentName?.trim()) {
                        const deptInput2 = await page.$('input#approval-request-fields-group-id');
                        if (deptInput2) await handleCombobox(page, 'input#approval-request-fields-group-id', payload.departmentName.trim());
                    }
                }

                // 取得単位の選択
                const unitSelectSel = '#approval-request-fields-usage_day';
                const unitSelectFound = await page.waitForSelector(unitSelectSel, { timeout: 15000 }).catch(() => null);

                if (unitSelectFound) {
                    await page.selectOption(unitSelectSel, unitValue).catch(() => {});
                    await page.waitForTimeout(500);
                    await page.evaluate(({ sel, val }) => {
                        const el = document.querySelector(sel) as HTMLSelectElement | null;
                        if (!el) return;
                        const nativeSet = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
                        if (nativeSet) { nativeSet.call(el, val); } else { el.value = val; }
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }, { sel: unitSelectSel, val: unitValue });
                    await page.waitForTimeout(500);

                    const selectedVal = await page.evaluate((sel) => {
                        const el = document.querySelector(sel) as HTMLSelectElement | null;
                        return el?.value || '';
                    }, unitSelectSel);
                    if (selectedVal !== unitValue) {
                        await page.click(unitSelectSel);
                        await page.waitForTimeout(300);
                        await page.selectOption(unitSelectSel, unitValue).catch(() => {});
                        await page.waitForTimeout(500);
                        const retryVal = await page.evaluate((sel) => (document.querySelector(sel) as HTMLSelectElement | null)?.value || '', unitSelectSel);
                        if (retryVal !== unitValue) throw new Error(`取得単位の選択に失敗しました。期待: ${unitValue}, 実際: ${retryVal}`);
                    }
                } else {
                    const unitComboSel = await page.evaluate(() => {
                        const excludeIds = ['approval-request-fields-route-id', 'approval-request-fields-group-id', 'approval-request-fields-date'];
                        const combos = Array.from(document.querySelectorAll<HTMLInputElement>('input[role="combobox"]'));
                        for (const el of combos) { if (!excludeIds.includes(el.id)) return el.id ? `#${el.id}` : null; }
                        return null;
                    });
                    if (unitComboSel) await handleCombobox(page, unitComboSel, LEAVE_UNIT_LABELS[payload.leaveUnit] || '全休');
                }

                // 申請ボタン
                const enabledSubmitSel = await findSelector(page, [
                    'button[type="submit"].vb-button--appearancePrimary:has-text("申請"):not(.vb-button--disabled)',
                    'button.vb-button--appearancePrimary:has-text("申請"):not(.vb-button--disabled)',
                    'button[type="submit"]:has-text("申請"):not([disabled])',
                ], 15000);
                if (!enabledSubmitSel) throw new Error('申請ボタンが有効になりませんでした。');

                await page.click(enabledSubmitSel);
                await page.waitForTimeout(2000);

                // 成功確認（race: 取り下げボタン / URL変化 / エラー、最大15秒）
                const plUrlBeforeBatch = page.url();
                const plBatchResult = await Promise.race([
                    page.waitForSelector('button:has-text("申請を取り下げる")', { state: 'visible', timeout: 15000 }).then(() => 'withdraw' as const).catch(() => null),
                    page.waitForFunction((prevUrl) => window.location.href !== prevUrl && !window.location.href.includes('/new'), plUrlBeforeBatch, { timeout: 15000 }).then(() => 'url_changed' as const).catch(() => null),
                    page.waitForSelector('.vb-messageBlock__inner--alert, [role="alert"]', { state: 'visible', timeout: 15000 }).then(() => 'error' as const).catch(() => null),
                ]);
                if (plBatchResult === 'error') {
                    const errText = await page.evaluate(() => { for (const sel of ['.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content', '.vb-message__content', '[role="alert"]']) { const el = document.querySelector(sel); if (el?.textContent?.trim()) return el.textContent.trim(); } return null; });
                    if (errText && (errText.includes('申請できませんでした') || errText.includes('すでに') || errText.includes('エラー') || errText.includes('失敗'))) throw new Error(errText);
                } else if (plBatchResult === null) {
                    const errText = await page.evaluate(() => { for (const sel of ['.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content', '.vb-message__content', '[role="alert"]']) { const el = document.querySelector(sel); if (el?.textContent?.trim()) return el.textContent.trim(); } return null; });
                    if (errText && (errText.includes('申請できませんでした') || errText.includes('エラー') || errText.includes('失敗'))) throw new Error(errText);
                    throw new Error('有給申請の成功を確認できませんでした（15秒タイムアウト）。');
                }

                console.log(`[RPA Batch] [${i + 1}/${total}] SUCCESS: ${normalizedDate}`);
                succeeded++;
                onProgress?.({ current: i + 1, total, date: normalizedDate, success: true });

            } catch (e: any) {
                const msg = e?.message || '不明なエラー';
                console.error(`[RPA Batch] [${i + 1}/${total}] FAILED: ${item.targetDate} - ${msg}`);
                failed.push({ date: item.targetDate, error: msg });
                onProgress?.({ current: i + 1, total, date: item.targetDate, success: false, error: msg });
            }
        }

        return { total, succeeded, failed };
    } finally {
        console.log('[RPA Batch] Closing browser.');
        await browser.close();
    }
}
