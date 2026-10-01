import { chromium, type Page } from 'playwright-core'
import type { CancelAction, CancelItem, CancelPhase, RequestKind } from '../shared/requestCancellation'
import type { CancellationState } from './requestCancellation'
import { doLogin, loadSessionState, rpaBrowserLaunchArgs } from './automation'

const typeNames: Record<RequestKind, string> = {
  overtime: 'OvertimeWork', paid_holiday: 'PaidHoliday', holiday_work: 'HolidayWork',
  monthly_attendance: 'MonthlyAttendance', work_time: 'WorkTime',
}
const withdrawSelector = 'button:has-text("申請を取り下げる")'
const deleteSelector = 'button.vb-button--appearanceSecondary:has-text("削除")'
const dangerSelector = 'button.vb-button--danger:has-text("削除")'

// 書き込みを行う前の画面復旧だけを許可。クリック後は上位でサーバー状態を照合する。
export async function performCancellationInPage(
  page: Page, item: CancelItem, action: CancelAction,
  read: () => Promise<CancellationState | null>, phase: (value: CancelPhase) => void,
): Promise<void> {
  const targetHash = `#/requests/${item.requestId}`
  const isTarget = (): boolean => {
    const url = new URL(page.url())
    return url.origin === 'https://p.secure.freee.co.jp'
      && (url.hash === targetHash || url.hash.startsWith(`${targetHash}?`))
  }
  const detailUrl = `https://p.secure.freee.co.jp/approval_requests${targetHash}?type=ApprovalRequest::${typeNames[item.requestType]}`
  const selector = action === 'withdraw' ? withdrawSelector : deleteSelector
  const open = async (): Promise<void> => {
    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    // ハッシュだけの遷移では古いDOMが残るため、対象切替時には読み込み直す。
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  }
  if (!isTarget()) await open()
  try {
    await page.locator(selector).waitFor({ state: 'visible', timeout: 4000 })
    if (!isTarget()) throw new Error('対象詳細が表示されていません。')
  } catch {
    phase('refreshing')
    await page.goto('https://p.secure.freee.co.jp/approval_requests#/requests', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.getByRole('heading', { name: '申請一覧', exact: true }).waitFor({ timeout: 10000 })
    await open()
    await page.locator(selector).waitFor({ state: 'visible', timeout: 6000 })
  }
  if (!isTarget()) throw new Error('申請IDが一致しません。操作を中止しました。')
  const state = await read()
  if (!state || (action === 'withdraw' ? state.status !== 'in_progress' : !['draft', 'feedback'].includes(state.status))) {
    throw new Error('操作前に申請の状態が変わりました。操作を中止しました。')
  }
  phase(action === 'withdraw' ? 'withdrawing' : 'deleting')
  await page.locator(selector).click({ timeout: 5000 })
  if (action === 'delete') {
    try {
      await page.locator(dangerSelector).waitFor({ state: 'visible', timeout: 3000 })
    } catch {
      if (await read() === null) return
      throw new Error('削除の確認画面を確認できません。削除完了とは扱っていません。')
    }
    if (!isTarget()) throw new Error('削除確認の対象ページが変わりました。')
    const latest = await read()
    if (!latest || !['draft', 'feedback'].includes(latest.status)) throw new Error('削除確定前に申請状態が変わりました。')
    await page.locator(dangerSelector).click({ timeout: 5000 })
  }
}

export async function createCancellationBrowser(email: string, password: string, headless: boolean) {
  const savedSession = loadSessionState()
  const launchOptions = { headless, args: rpaBrowserLaunchArgs(headless) }
  const browser = await chromium.launch({ channel: 'msedge', ...launchOptions }).catch(() => chromium.launch({ channel: 'chrome', ...launchOptions }))
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(savedSession ? { storageState: savedSession as never } : {}) })
    const page = await context.newPage()
    await doLogin(page, context, email, password, savedSession)
    // パスを一度確認した後は同じ詳細エンドポイントだけを利用する。
    const holidayPaths = new Map<number, string>()
    return {
      act: (item: CancelItem, action: CancelAction, read: () => Promise<CancellationState | null>, phase: (value: CancelPhase) => void) =>
        performCancellationInPage(page, item, action, read, phase),
      readHoliday: async (id: number): Promise<Record<string, any> | null> => {
        const known = holidayPaths.get(id)
        const paths = known ? [known] : [
          `/api/p/employees/approval_requests/requests/${id}`,
          `/api/p/employees/approval_requests/${id}`,
        ]
        for (const path of paths) {
          const response = await context.request.get(`https://p.secure.freee.co.jp${path}`, {
            params: { type: 'ApprovalRequest::HolidayWork' }, timeout: 10000, maxRedirects: 0,
          })
          if (response.status() === 404) {
            if (known) return null
            continue
          }
          if (!response.ok()) throw new Error(`休日出勤の状態確認に失敗しました（HTTP ${response.status()}）。`)
          const body = await response.json()
          const record = body.approval_request || body
          if (Number(record.id) !== id || record.type !== 'ApprovalRequest::HolidayWork') throw new Error('休日出勤の対象を確認できません。')
          holidayPaths.set(id, path)
          return record
        }
        throw new Error('休日出勤の詳細を確認できません。一覧を更新してください。')
      },
      close: () => browser.close(),
    }
  } catch (error) {
    await browser.close()
    throw error
  }
}
