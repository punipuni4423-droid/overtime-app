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
            console.warn(`[RPA] No options found for ${selector}, pressing Enter`);
            await page.keyboard.press('Enter');
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
        console.log(`[RPA] Date filled: ${normalizedDate} (ok=${dateOk})`);

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
        await page.click(enabledSubmitSel);

        // 申請後、成功（「申請を取り下げる」ボタン出現）またはエラーメッセージを待つ
        await page.waitForTimeout(2000);

        // エラーメッセージ確認（freee の各種エラー表示に対応）
        const vbErrorText = await page.evaluate(() => {
            // vb-messageBlock (FloatingMessage) — 「申請できませんでした」等
            const msgBlock = document.querySelector('.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content');
            if (msgBlock?.textContent?.trim()) return msgBlock.textContent.trim();
            // vb-message__content — 従来のエラー表示
            const msgContent = document.querySelector('.vb-message__content');
            if (msgContent?.textContent?.trim()) return msgContent.textContent.trim();
            // vb-flash--error — レガシーエラー
            const flash = document.querySelector('.vb-flash--error');
            if (flash?.textContent?.trim()) return flash.textContent.trim();
            // role="alert"
            const alert = document.querySelector('[role="alert"]');
            if (alert?.textContent?.trim()) return alert.textContent.trim();
            return null;
        });

        if (vbErrorText && (
            vbErrorText.includes('申請できませんでした') ||
            vbErrorText.includes('すでに') ||
            vbErrorText.includes('申請中もしくは承認') ||
            vbErrorText.includes('エラー') ||
            vbErrorText.includes('失敗') ||
            vbErrorText.includes('必須') ||
            vbErrorText.includes('修正')
        )) {
            console.warn(`[RPA] Form error: ${vbErrorText}`);
            throw new Error(vbErrorText);
        }

        // 成功確認: 「申請を取り下げる」ボタンが出現するか確認
        const withdrawBtnFound = await page.waitForSelector(
            'button:has-text("申請を取り下げる")',
            { state: 'visible', timeout: 10000 }
        ).catch(() => null);

        if (!withdrawBtnFound) {
            // ボタンが出なかった場合、再度エラーチェック
            const lateError = await page.evaluate(() => {
                const el = document.querySelector('.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content, .vb-message__content, [role="alert"]');
                return el?.textContent?.trim() || null;
            });
            if (lateError) {
                console.warn(`[RPA] Late error detected: ${lateError}`);
                throw new Error(lateError);
            }
            console.log('[RPA] withdraw button not found, but no error detected.');
        }

        if (vbErrorText?.trim() && !vbErrorText.includes('申請できませんでした')) {
            console.log(`[RPA] Info message (not error): ${vbErrorText.trim()}`);
        }

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
        console.log(`[RPA] Date filled: ${normalizedDate} (ok=${dateOkPL})`);

        // 取得内容の選択（ネイティブ select: id="approval-request-fields-usage_day"）
        // 選択肢: full（全休）/ morning（午前休）/ afternoon（午後休）
        const unitValueMap: Record<string, string> = {
            'full_day': 'full',
            'am_half':  'morning',
            'pm_half':  'afternoon',
        };
        const unitValue = unitValueMap[payload.leaveUnit] || 'full';

        const unitSelectSel = '#approval-request-fields-usage_day';
        const unitSelectExists = await page.$(unitSelectSel);
        if (unitSelectExists) {
            // React native setter で変更を React に通知（selectOption だけでは React onChange が発火しない）
            await page.evaluate(({ sel, val }) => {
                const el = document.querySelector(sel) as HTMLSelectElement | null;
                if (!el) return;
                const nativeSet = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
                if (nativeSet) { nativeSet.call(el, val); } else { el.value = val; }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, { sel: unitSelectSel, val: unitValue });
            // 選択結果を確認
            const selectedVal = await page.evaluate((sel) => {
                const el = document.querySelector(sel) as HTMLSelectElement | null;
                return el?.value || '';
            }, unitSelectSel);
            console.log(`[RPA] Leave unit selected: "${selectedVal}" (expected: "${unitValue}", leaveUnit: ${payload.leaveUnit})`);
        } else {
            // フォールバック: コンボボックス方式
            console.warn('[RPA] Native select not found, trying combobox...');
            const unitLabelMap: Record<string, string> = {
                'full_day': '全休', 'am_half': '午前休', 'pm_half': '午後休'
            };
            const unitComboSel = await page.evaluate(() => {
                const excludeIds = ['approval-request-fields-route-id', 'approval-request-fields-group-id', 'approval-request-fields-date'];
                const combos = Array.from(document.querySelectorAll<HTMLInputElement>('input[role="combobox"]'));
                for (const el of combos) {
                    if (!excludeIds.includes(el.id)) return el.id ? `#${el.id}` : null;
                }
                return null;
            });
            if (unitComboSel) await handleCombobox(page, unitComboSel, unitLabelMap[payload.leaveUnit] || '全休');
        }

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

        // 送信前検証（日付）
        console.log('[RPA] Verifying fields before submit...');
        const dateActual = await page.evaluate((sel) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            return el?.value || '';
        }, dateFieldSel);
        if (dateActual !== normalizedDate) {
            console.warn(`[RPA] Date wrong: "${dateActual}", re-filling...`);
            await fillInputReliably(page, dateFieldSel, normalizedDate);
        } else {
            console.log(`[RPA] Date OK: ${dateActual}`);
        }

        // フォーム検証トリガー
        await page.evaluate(() => {
            document.body.click();
            const el = document.activeElement as HTMLElement | null;
            if (el?.blur) el.blur();
        });

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
        await page.click(enabledSubmitSel);

        // 申請後、成功またはエラーを待つ
        await page.waitForTimeout(2000);

        // エラーメッセージ確認（freee の各種エラー表示に対応）
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

        if (vbErrorText && (
            vbErrorText.includes('申請できませんでした') ||
            vbErrorText.includes('すでに') ||
            vbErrorText.includes('申請中もしくは承認') ||
            vbErrorText.includes('エラー') ||
            vbErrorText.includes('失敗') ||
            vbErrorText.includes('必須') ||
            vbErrorText.includes('修正')
        )) {
            console.warn(`[RPA] Form error: ${vbErrorText}`);
            throw new Error(vbErrorText);
        }

        // 成功確認
        const withdrawBtnFound = await page.waitForSelector(
            'button:has-text("申請を取り下げる")',
            { state: 'visible', timeout: 10000 }
        ).catch(() => null);

        if (!withdrawBtnFound) {
            const lateError = await page.evaluate(() => {
                const el = document.querySelector('.vb-messageBlock__inner--alert .vb-messageBlockInternalMessage__content, .vb-message__content, [role="alert"]');
                return el?.textContent?.trim() || null;
            });
            if (lateError) {
                console.warn(`[RPA] Late error detected: ${lateError}`);
                throw new Error(lateError);
            }
            console.log('[RPA] withdraw button not found, but no error detected.');
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

        // 申請後に「申請を取り下げる」ボタンを待つ（タイムアウトは無視）
        await page.waitForSelector('button:has-text("申請を取り下げる")', { state: 'visible', timeout: 15000 }).catch(() => {
            console.log('[RPA] withdraw button not found (ignored)');
        });

        // エラーメッセージ確認
        const vbErrorText = await page.evaluate(() => document.querySelector('.vb-message__content')?.textContent || null);
        const isActualError = vbErrorText && (
            vbErrorText.includes('すでに') ||
            vbErrorText.includes('申請中もしくは承認') ||
            vbErrorText.includes('エラー') ||
            vbErrorText.includes('失敗')
        );
        if (isActualError) {
            console.warn(`[RPA] Form error: ${vbErrorText!.trim()}`);
            throw new Error(vbErrorText!.trim());
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
            await page.waitForTimeout(1500);
            const confirmBtn = await page.$('button:has-text("取り下げる"), button:has-text("はい"), button:has-text("OK")');
            if (confirmBtn) await confirmBtn.click();
            await page.waitForTimeout(1000);
            return { success: true, message: '申請を取り下げました。' };
        } else {
            // 削除（in_progress の場合は「取り下げ → 削除」の2ステップ）
            // まず「申請を取り下げる」ボタンがあれば先に取り下げ処理を行う
            const withdrawBtn = await page.$('button:has-text("申請を取り下げる")');
            if (withdrawBtn) {
                console.log('[RPA] in_progress item detected: withdrawing first before delete...');
                await withdrawBtn.click();
                await page.waitForTimeout(1500);
                const withdrawConfirm = await page.$('button:has-text("取り下げる"), button:has-text("はい"), button:has-text("OK")');
                if (withdrawConfirm) await withdrawConfirm.click();
                // 取り下げ後のページ更新（削除ボタンが出現するまで）を待機
                await page.waitForTimeout(2000);
                console.log('[RPA] Withdrawal complete, now proceeding to delete...');
            }

            // 削除ボタンをクリック
            const deleteBtn = await page.waitForSelector(
                'button:has-text("削除する"), button:has-text("削除"), a:has-text("削除")',
                { state: 'visible', timeout: 15000 }
            ).catch(() => null);
            if (!deleteBtn) throw new Error('「削除」ボタンが見つかりませんでした。');
            await deleteBtn.click();
            await page.waitForTimeout(1500);
            const deleteConfirm = await page.$('button:has-text("削除する"), button:has-text("はい"), button:has-text("OK")');
            if (deleteConfirm) await deleteConfirm.click();
            await page.waitForTimeout(1000);
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

