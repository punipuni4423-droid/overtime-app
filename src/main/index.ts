import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import axios from 'axios'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import { TokenManager, TokenAuthRequiredError } from './tokenManager'
import { submitOvertimeViaBrowser, submitPaidLeaveViaBrowser, submitMonthlyCloseViaBrowser, preLoginViaBrowser, cancelRequestViaBrowser, submitTimeClockViaBrowser } from './automation'

const store = new Store({
  defaults: {
    ACCESS_TOKEN: '',
    COMPANY_ID: 0,
    APPLICANT_ID: 0,
    LAST_END_TIME: '20:00',
    LAST_ROUTE_ID: null,
    LAST_DEPARTMENT_ID: null,
    DEFAULT_DEPARTMENT_ID: null,
    last_comment: '残業申請ツール開発に伴う、API動作確認テスト',
    CLIENT_ID: '',
    CLIENT_SECRET: '',
    access_token: '',
    refresh_token: '',
    created_at: 0,
    expires_in: 0,
    expires_at: 0
  }
})

const tokenManager = new TokenManager(store)

// ─── ユーザー情報の一元取得ヘルパー ──────────────────────────────────
// COMPANY_ID / APPLICANT_ID をストアから取得し、未設定の場合はAPIから自動解決して保存する。
// アップデートでデフォルト値が変わっても、このヘルパーを通じて常に正しい値が得られる。
// ユーザー情報キャッシュ（セッション中のみ有効、store には保存しない）
let _cachedUserInfo: { companyId: number; applicantId: number; employeeId: number } | null = null

async function getUserInfo(token: string): Promise<{ companyId: number; applicantId: number; employeeId: number }> {
  if (_cachedUserInfo) return _cachedUserInfo

  const res = await axios.get('https://api.freee.co.jp/hr/api/v1/users/me', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  })
  const userId: number = res.data.id  // user_id（申請者ID）
  const companies: any[] = res.data.companies || []
  if (companies.length === 0) throw new Error('freeeの会社情報が取得できませんでした。再認証してください。')
  const company = companies[0]
  const companyId: number = company.id
  const employeeId: number = company.employee_id  // employee_id（従業員ID）

  if (!companyId) throw new Error('会社IDが取得できませんでした。再認証してください。')
  if (!userId) throw new Error('申請者IDが取得できませんでした。再認証してください。')

  _cachedUserInfo = { companyId, applicantId: userId, employeeId }
  console.log(`[UserInfo] companyId=${companyId}, applicantId(userId)=${userId}, employeeId=${employeeId}`)
  return _cachedUserInfo
}

import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 550,
    height: 800,
    resizable: false,
    show: false,
    autoHideMenuBar: true,
    title: 'freee申請ツール',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow = win

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Check if running in dev mode via environment variable set by electron-vite
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── RPA ヘッドレス設定 ───────────────────────────────────────────
// 開発時(npm run dev): ブラウザ表示 (headless=false)
// リリース版(パッケージ後): バックグラウンド (headless=true)
const RPA_HEADLESS = true  // v1.0.7: 常にバックグラウンド動作（デバッグ時は false に変更）

app.whenReady().then(() => {
  // Set app user model id for windows
  if (process.platform === 'win32') {
    app.setAppUserModelId(app.isPackaged ? 'com.electron' : process.execPath)
  }

  // Dev tools shortcut (F12) in development
  app.on('browser-window-created', (_, window) => {
    if (!app.isPackaged) {
    window.webContents.on('before-input-event', (_event, input) => {
        if (input.type === 'keyDown' && input.code === 'F12') {
          const wc = window.webContents
          if (wc.isDevToolsOpened()) {
            wc.closeDevTools()
          } else {
            wc.openDevTools({ mode: 'undocked' })
          }
        }
      })
    }
  })

  // ─── 起動時にユーザー情報を自動解決 ─────────────────────────────
  // トークンが有効な場合、COMPANY_ID/APPLICANT_IDが未設定なら自動取得して保存する
  tokenManager.getValidAccessToken()
    .then(token => getUserInfo(token))
    .catch(() => { /* トークン未設定またはリフレッシュ不可の場合は無視 */ })

  ipcMain.on('ping', () => console.log('pong'))
  ipcMain.handle('app-version', () => app.getVersion())

  // ─── ユーザー情報取得（フロントエンド共通） ─────────────────────
  ipcMain.handle('api-get-user-info', async () => {
    const token = await tokenManager.getValidAccessToken()
    return await getUserInfo(token)
  })

  // ─── Settings Store IPC ───────────────────────────────────────
  ipcMain.handle('store-get', (_, key) => store.get(key))
  ipcMain.handle('store-set', (_, key, val) => store.set(key, val))

  // ─── Token Management IPC ────────────────────────────────────
  // Get a valid access token (auto-refreshes if needed)
  ipcMain.handle('token-get-valid', async () => {
    try {
      const token = await tokenManager.getValidAccessToken()
      return { success: true, token }
    } catch (err: any) {
      if (err instanceof TokenAuthRequiredError) {
        return { success: false, authRequired: true, message: err.message }
      }
      return { success: false, authRequired: false, message: err.message }
    }
  })

  // Get token status for display in UI
  ipcMain.handle('token-status', () => {
    return tokenManager.getTokenStatus()
  })

  // Start OAuth2 authorization flow
  ipcMain.handle('token-start-auth', async () => {
    try {
      const tokenData = await tokenManager.startAuthFlow()

      // 認証完了後、ユーザー情報を自動取得して保存
      try {
        await getUserInfo(tokenData.access_token)
      } catch (e: any) {
        console.warn('[Auth] Failed to auto-fetch user info:', e.message)
      }

      return { success: true, tokenData }
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  })

  // Exchange authorization code manually (fallback)
  ipcMain.handle('token-exchange-code', async (_, code: string) => {
    try {
      const tokenData = await tokenManager.exchangeCodeForTokens(code)
      return { success: true, tokenData }
    } catch (err: any) {
      return { success: false, message: err.message }
    }
  })

  // Force refresh token (for testing)
  ipcMain.handle('token-force-refresh', async () => {
    try {
      const tokenData = tokenManager.getTokenData()
      if (!tokenData) {
        return { success: false, message: 'トークン情報がありません。' }
      }
      const newToken = await tokenManager.refreshAccessToken(tokenData.refresh_token)
      return { success: true, token: newToken }
    } catch (err: any) {
      if (err instanceof TokenAuthRequiredError) {
        return { success: false, authRequired: true, message: err.message }
      }
      return { success: false, authRequired: false, message: err.message }
    }
  })

  // ─── API IPC (with auto token refresh) ────────────────────────
  ipcMain.handle('api-fetch-routes', async (_, companyId) => {
    const token = await tokenManager.getValidAccessToken()
    const url = 'https://api.freee.co.jp/hr/api/v1/approval_flow_routes'
    console.log(`[API Call] GET ${url}`)
    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        params: { company_id: companyId }
      })
      return res.data
    } catch (err: any) {
      console.error(`[API Error] GET ${url} - Status: ${err.response?.status} - ${err.message}`)
      throw new Error(err.response?.data ? JSON.stringify(err.response.data) : err.message)
    }
  })

  ipcMain.handle('api-fetch-departments', async (_, companyId) => {
    const token = await tokenManager.getValidAccessToken()
    const url = 'https://api.freee.co.jp/api/v1/departments'
    console.log(`[API Call] GET ${url}`)
    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        params: { company_id: companyId }
      })
      return res.data
    } catch (err: any) {
      console.error(`[API Error] GET ${url} - Status: ${err.response?.status} - ${err.message}`)
      throw new Error(err.response?.data ? JSON.stringify(err.response.data) : err.message)
    }
  })

  ipcMain.handle('api-submit-overtime', async (_, payload) => {
    const token = await tokenManager.getValidAccessToken()
    const url = 'https://api.freee.co.jp/hr/api/v1/approval_requests/overtime_works'
    console.log(`[API Call] POST ${url}`)
    try {
      const res = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      })
      return res.data
    } catch (err: any) {
      console.error(`[API Error] POST ${url} - Status: ${err.response?.status} - ${err.message}`)
      throw new Error(err.response?.data ? JSON.stringify(err.response.data) : err.message)
    }
  })

  // ─── 事前ログイン IPC ─────────────────────────────────────────
  ipcMain.handle('api-pre-login', async () => {
    const email = store.get('FREEE_EMAIL') as string
    const password = store.get('FREEE_PASSWORD') as string
    if (!email || !password) return { success: false, message: 'メール・パスワード未設定' }
    try {
      await preLoginViaBrowser(email, password)
      return { success: true }
    } catch (e: any) {
      return { success: false, message: e.message }
    }
  })

  ipcMain.handle('api-web-submit-overtime', async (_, payload) => {
    try {
      const email = await store.get('FREEE_EMAIL')
      const password = await store.get('FREEE_PASSWORD')
      if (!email || !password) {
        throw new Error('Web版申請にはメールアドレスとパスワードの設定が必要です。設定画面から入力してください。')
      }
      return await submitOvertimeViaBrowser({
        ...payload,
        email,
        password,
        headless: RPA_HEADLESS
      })
    } catch (error: any) {
      console.error('Web Submit Error:', error)
      throw error
    }
  })

  ipcMain.handle('api-fetch-approvals', async () => {
    const token = await tokenManager.getValidAccessToken()
    const { companyId, applicantId: myApplicantId } = await getUserInfo(token)
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    const params = { company_id: companyId }

    // 従業員名マップ（ページネーションで全件取得）
    const employeeMap: Record<string, string> = {}
    try {
      let offset = 0
      const limit = 100
      while (true) {
        const empRes = await axios.get('https://api.freee.co.jp/hr/api/v1/employees', {
          headers, params: { ...params, limit, offset }
        })
        const employees: any[] = empRes.data.employees || []
        for (const emp of employees) {
          const name = [emp.last_name, emp.first_name].filter(Boolean).join(' ') || emp.display_name || String(emp.id)
          employeeMap[String(emp.id)] = name
        }
        console.log(`[API] employees fetched: offset=${offset}, count=${employees.length}, total so far=${Object.keys(employeeMap).length}`)
        if (employees.length < limit) break
        offset += limit
      }
    } catch (e: any) {
      console.warn('[API] employees fetch failed:', e.message)
    }

    // 申請経路マップ
    const routeMap: Record<string, string> = {}
    try {
      const routeRes = await axios.get('https://api.freee.co.jp/hr/api/v1/approval_flow_routes', { headers, params })
      const routes: any[] = routeRes.data.approval_flow_routes || []
      for (const r of routes) routeMap[String(r.id)] = r.name
      console.log(`[API] routes fetched: ${routes.length}`)
    } catch (e: any) { console.warn('[API] routes fetch failed:', e.message) }

    // 部門マップ
    const deptMap: Record<string, string> = {}
    try {
      const deptRes = await axios.get('https://api.freee.co.jp/api/v1/departments', { headers, params })
      const depts: any[] = deptRes.data.departments || []
      for (const d of depts) deptMap[String(d.id)] = d.name
    } catch (e: any) { console.warn('[API] depts fetch failed:', e.message) }

    const results: any[] = []

    // 残業申請（自分の申請も含む: status=in_progressのみ）
    try {
      const res = await axios.get('https://api.freee.co.jp/hr/api/v1/approval_requests/overtime_works', { headers, params })
      const items: any[] = res.data.overtime_works || (Array.isArray(res.data) ? res.data : [])
      for (const item of items) {
        if (item.status !== 'in_progress') continue
        const applicantId = item.applicant_id ?? item.employee_id
        const applicantName = item.applicant_name
          || employeeMap[String(applicantId)]
          || `ID:${applicantId}`
        results.push({
          type: 'overtime',
          id: item.id,
          applicantId,
          applicantName,
          targetDate: item.target_date || '',
          startAt: item.start_at || '',
          endAt: item.end_at || '',
          comment: item.comment || '',
          routeName: routeMap[String(item.approval_flow_route_id)] || '',
          departmentName: item.department_id ? (deptMap[String(item.department_id)] || '') : '',
          isSelf: String(applicantId) === String(myApplicantId),
        })
      }
    } catch (e: any) { console.warn('[API] overtime_works fetch failed:', e.message) }

    // 有給申請
    const usageTypeLabel: Record<string, string> = {
      full_day: '全休', morning_half: '午前休', afternoon_half: '午後休',
      full: '全休', morning: '午前休', afternoon: '午後休',
    }
    try {
      const res = await axios.get('https://api.freee.co.jp/hr/api/v1/approval_requests/paid_holidays', { headers, params })
      const items: any[] = res.data.paid_holidays || (Array.isArray(res.data) ? res.data : [])
      for (const item of items) {
        if (item.status !== 'in_progress') continue
        const applicantId = item.applicant_id ?? item.employee_id
        const applicantName = item.applicant_name
          || employeeMap[String(applicantId)]
          || `ID:${applicantId}`
        results.push({
          type: 'paid_holiday',
          id: item.id,
          applicantId,
          applicantName,
          targetDate: item.target_date || '',
          comment: item.comment || '',
          usageType: usageTypeLabel[item.usage_type] || item.usage_type || '',
          routeName: routeMap[String(item.approval_flow_route_id)] || '',
          departmentName: item.department_id ? (deptMap[String(item.department_id)] || '') : '',
          isSelf: String(applicantId) === String(myApplicantId),
        })
      }
    } catch (e: any) { console.warn('[API] paid_holidays fetch failed:', e.message) }

    // 月次締め申請
    try {
      const res = await axios.get('https://api.freee.co.jp/hr/api/v1/approval_requests/monthly_attendances', { headers, params })
      const rawItems = res.data
      const items: any[] = rawItems.monthly_attendances || rawItems.approval_requests || (Array.isArray(rawItems) ? rawItems : [])
      if (items.length > 0) {
        console.log('[API] monthly_attendances first item keys:', Object.keys(items[0]))
        console.log('[API] monthly_attendances first item:', JSON.stringify(items[0]).slice(0, 500))
      }
      for (const item of items) {
        if (item.status !== 'in_progress') continue
        // target_year/target_month または target_date を柔軟に処理
        let targetDate = ''
        if (item.target_year && item.target_month) {
          targetDate = `${item.target_year}-${String(item.target_month).padStart(2, '0')}`
        } else if (item.target_date) {
          targetDate = String(item.target_date).slice(0, 7)
        }
        // applicant_id または employee_id のどちらかを使用
        const applicantId = item.applicant_id ?? item.employee_id
        const applicantName = item.applicant_name
          || employeeMap[String(applicantId)]
          || `ID:${applicantId}`
        results.push({
          type: 'monthly_attendance',
          id: item.id,
          applicantId,
          applicantName,
          targetDate,
          comment: item.comment || '',
          routeName: routeMap[String(item.approval_flow_route_id)] || '',
          departmentName: item.department_id ? (deptMap[String(item.department_id)] || '') : '',
          isSelf: String(applicantId) === String(myApplicantId),
        })
      }
    } catch (e: any) { console.warn('[API] monthly_attendances fetch failed:', e.message) }

    return results.sort((a, b) => (a.targetDate || '').localeCompare(b.targetDate || ''))
  })

  // ─── 自分の申請一覧取得 ────────────────────────────────────────
  ipcMain.handle('api-fetch-my-requests', async () => {
    const token = await tokenManager.getValidAccessToken()
    const { companyId, applicantId: myApplicantId } = await getUserInfo(token)
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    // サーバー側で applicant_id フィルタ + limit=100 で自分の申請のみ取得
    const params = { company_id: companyId, applicant_id: myApplicantId, limit: 100 }
    console.log(`[MY-REQ] Fetching requests for companyId=${companyId}, applicantId(userId)=${myApplicantId}`)
    // 除外ステータス（承認済み・却下・取り下げ済みは非表示）
    // draft（下書き）は含める：フロント側でフィルタリングする
    const excludeStatuses = ['approved', 'denied', 'feedback_waiting', 'withdrawn', 'feedback']

    const routeMap: Record<string, string> = {}
    try {
      const routeRes = await axios.get('https://api.freee.co.jp/hr/api/v1/approval_flow_routes', {
        headers, params: { company_id: companyId }
      })
      const routes: any[] = routeRes.data.approval_flow_routes || []
      for (const r of routes) routeMap[String(r.id)] = r.name
    } catch (e: any) { console.warn('[API] routes fetch failed:', e.message) }

    const results: any[] = []

    // 残業申請
    try {
      const res = await axios.get('https://api.freee.co.jp/hr/api/v1/approval_requests/overtime_works', { headers, params })
      const items: any[] = res.data.overtime_works || (Array.isArray(res.data) ? res.data : [])
      console.log(`[MY-REQ] overtime total=${items.length}`)
      for (const item of items) {
        console.log(`[MY-REQ] overtime id=${item.id} status="${item.status}"`)
        if (excludeStatuses.includes(item.status)) continue
        results.push({
          type: 'overtime', id: item.id, status: item.status,
          targetDate: item.target_date || '',
          startAt: item.start_at || '', endAt: item.end_at || '',
          comment: item.comment || '',
          routeName: routeMap[String(item.approval_flow_route_id)] || '',
        })
      }
    } catch (e: any) { console.warn('[API] my overtime fetch failed:', e.message) }

    // 有給申請
    const usageTypeLabel: Record<string, string> = {
      full_day: '全休', morning_half: '午前半休', afternoon_half: '午後半休',
      full: '全休', morning: '午前半休', afternoon: '午後半休',
    }
    try {
      const res = await axios.get('https://api.freee.co.jp/hr/api/v1/approval_requests/paid_holidays', { headers, params })
      const items: any[] = res.data.paid_holidays || (Array.isArray(res.data) ? res.data : [])
      console.log(`[MY-REQ] paid_holidays total=${items.length}`)
      for (const item of items) {
        console.log(`[MY-REQ] paid_holiday id=${item.id} status="${item.status}"`)
        if (excludeStatuses.includes(item.status)) continue
        results.push({
          type: 'paid_holiday', id: item.id, status: item.status,
          targetDate: item.target_date || '',
          usageType: usageTypeLabel[item.usage_type] || item.usage_type || '',
          comment: item.comment || '',
          routeName: routeMap[String(item.approval_flow_route_id)] || '',
        })
      }
    } catch (e: any) { console.warn('[API] my paid_holidays fetch failed:', e.message) }

    // 月次締め申請
    try {
      const res = await axios.get('https://api.freee.co.jp/hr/api/v1/approval_requests/monthly_attendances', { headers, params })
      const rawItems = res.data
      const items: any[] = rawItems.monthly_attendances || rawItems.approval_requests || (Array.isArray(rawItems) ? rawItems : [])
      console.log(`[MY-REQ] monthly_attendances total=${items.length}`)
      for (const item of items) {
        console.log(`[MY-REQ] monthly_attendance id=${item.id} status="${item.status}"`)
        if (excludeStatuses.includes(item.status)) continue
        let targetDate = ''
        if (item.target_year && item.target_month) {
          targetDate = `${item.target_year}-${String(item.target_month).padStart(2, '0')}`
        } else if (item.target_date) {
          targetDate = String(item.target_date).slice(0, 7)
        }
        results.push({
          type: 'monthly_attendance', id: item.id, status: item.status,
          targetDate, comment: item.comment || '',
          routeName: routeMap[String(item.approval_flow_route_id)] || '',
        })
      }
    } catch (e: any) { console.warn('[API] my monthly_attendances fetch failed:', e.message) }

    return results.sort((a, b) => (b.targetDate || '').localeCompare(a.targetDate || ''))
  })

  // ─── 申請取り下げ（Web） ──────────────────────────────────────
  ipcMain.handle('api-cancel-request-web', async (_, payload) => {
    try {
      const email = await store.get('FREEE_EMAIL')
      const password = await store.get('FREEE_PASSWORD')
      if (!email || !password) {
        throw new Error('Web版操作にはメールアドレスとパスワードの設定が必要です。設定画面から入力してください。')
      }
      return await cancelRequestViaBrowser({ ...payload, email, password, action: 'withdraw', headless: RPA_HEADLESS })
    } catch (error: any) {
      console.error('Cancel request error:', error)
      throw error
    }
  })

  // ─── 申請削除（Web） ──────────────────────────────────────────
  ipcMain.handle('api-delete-request-web', async (_, payload) => {
    try {
      const email = await store.get('FREEE_EMAIL')
      const password = await store.get('FREEE_PASSWORD')
      if (!email || !password) {
        throw new Error('Web版操作にはメールアドレスとパスワードの設定が必要です。設定画面から入力してください。')
      }
      return await cancelRequestViaBrowser({ ...payload, email, password, action: 'delete', headless: RPA_HEADLESS })
    } catch (error: any) {
      console.error('Delete request error:', error)
      throw error
    }
  })

  // ─── 申請削除（REST API直接 - draft専用・高速） ─────────────────
  ipcMain.handle('api-delete-request-api', async (_, payload) => {
    const { requestType, requestId, companyId } = payload
    const typePathMap: Record<string, string> = {
      overtime: 'overtime_works',
      paid_holiday: 'paid_holidays',
      monthly_attendance: 'monthly_attendances',
    }
    const typePath = typePathMap[requestType]
    if (!typePath) throw new Error(`不明な申請タイプ: ${requestType}`)
    const token = await tokenManager.getValidAccessToken()
    const url = `https://api.freee.co.jp/hr/api/v1/approval_requests/${typePath}/${requestId}`
    console.log(`[API Call] DELETE ${url}`)
    try {
      await axios.delete(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        params: { company_id: companyId }
      })
      return { success: true, message: '申請を削除しました。' }
    } catch (err: any) {
      console.error(`[API Error] DELETE ${url} - Status: ${err.response?.status} - ${err.message}`)
      throw new Error(err.response?.data ? JSON.stringify(err.response.data) : err.message)
    }
  })

  ipcMain.handle('api-submit-paid-leave', async (_, payload) => {
    const token = await tokenManager.getValidAccessToken()
    const url = 'https://api.freee.co.jp/hr/api/v1/approval_requests/paid_holidays'
    console.log(`[API Call] POST ${url}`)
    // freee HR API の usage_type 値（APIリファレンス準拠）
    const usageTypeMap: Record<string, string> = {
      'full_day': 'full_day',
      'am_half': 'morning_half',
      'pm_half': 'afternoon_half'
    }
    const { applicantId: resolvedApplicantId } = await getUserInfo(token)
    const applicantId = payload.applicantId ?? resolvedApplicantId
    const apiPayload: any = {
      company_id: payload.companyId,
      applicant_id: applicantId,
      target_date: payload.targetDate,
      approval_flow_route_id: payload.routeId,
      comment: payload.comment,
      usage_type: usageTypeMap[payload.leaveUnit] || 'full'
    }
    if (payload.departmentId) apiPayload.department_id = payload.departmentId
    try {
      const res = await axios.post(url, apiPayload, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      })
      return res.data
    } catch (err: any) {
      console.error(`[API Error] POST ${url} - Status: ${err.response?.status} - ${err.message}`)
      throw new Error(err.response?.data ? JSON.stringify(err.response.data) : err.message)
    }
  })

  ipcMain.handle('api-web-submit-paid-leave', async (_, payload) => {
    try {
      const email = await store.get('FREEE_EMAIL')
      const password = await store.get('FREEE_PASSWORD')
      if (!email || !password) {
        throw new Error('Web版申請にはメールアドレスとパスワードの設定が必要です。設定画面から入力してください。')
      }
      return await submitPaidLeaveViaBrowser({
        ...payload,
        email,
        password,
        headless: RPA_HEADLESS
      })
    } catch (error: any) {
      console.error('Paid Leave Web Submit Error:', error)
      throw error
    }
  })

  // ─── 月次締め申請 API ──────────────────────────────────────────
  ipcMain.handle('api-submit-monthly-close', async (_, payload) => {
    const token = await tokenManager.getValidAccessToken()
    const url = 'https://api.freee.co.jp/hr/api/v1/approval_requests/monthly_attendances'
    console.log(`[API Call] POST ${url}`)
    const { applicantId: resolvedApplicantId2 } = await getUserInfo(token)
    const applicantId = payload.applicantId ?? resolvedApplicantId2
    // freee HR API は target_date ではなく target_year / target_month を要求する
    const [targetYear, targetMonth] = (payload.targetDate as string).split('-').map(Number)
    const apiPayload: any = {
      company_id: payload.companyId,
      applicant_id: applicantId,
      target_year: targetYear,
      target_month: targetMonth,
      approval_flow_route_id: payload.routeId,
      comment: payload.comment,
    }
    if (payload.departmentId) apiPayload.department_id = payload.departmentId
    try {
      const res = await axios.post(url, apiPayload, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      })
      return res.data
    } catch (err: any) {
      console.error(`[API Error] POST ${url} - Status: ${err.response?.status} - ${err.message}`)
      throw new Error(err.response?.data ? JSON.stringify(err.response.data) : err.message)
    }
  })

  ipcMain.handle('api-web-submit-monthly-close', async (_, payload) => {
    try {
      const email = await store.get('FREEE_EMAIL')
      const password = await store.get('FREEE_PASSWORD')
      if (!email || !password) {
        throw new Error('Web版申請にはメールアドレスとパスワードの設定が必要です。設定画面から入力してください。')
      }
      return await submitMonthlyCloseViaBrowser({
        ...payload,
        email,
        password,
        headless: RPA_HEADLESS
      })
    } catch (error: any) {
      console.error('Monthly Close Web Submit Error:', error)
      throw error
    }
  })

  // ─── 打刻 Web 自動操作 ────────────────────────────────────────
  ipcMain.handle('api-web-submit-time-clock', async (_, payload) => {
    try {
      const email = store.get('FREEE_EMAIL') as string
      const password = store.get('FREEE_PASSWORD') as string
      if (!email || !password) {
        throw new Error('Web版操作にはメールアドレスとパスワードの設定が必要です。設定画面から入力してください。')
      }
      return await submitTimeClockViaBrowser({ ...payload, email, password, headless: RPA_HEADLESS })
    } catch (error: any) {
      console.error('TimeClock Web Submit Error:', error)
      throw error
    }
  })

  // ─── 打刻 API ──────────────────────────────────────────────────
  ipcMain.handle('api-fetch-time-clocks', async (_, { companyId, employeeId, fromDate, toDate }) => {
    const token = await tokenManager.getValidAccessToken()
    const url = `https://api.freee.co.jp/hr/api/v1/employees/${employeeId}/time_clocks`
    console.log(`[API Call] GET ${url}`)
    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        params: { company_id: companyId, from_date: fromDate, to_date: toDate, limit: 100 }
      })
      return res.data
    } catch (err: any) {
      console.error(`[API Error] GET ${url} - Status: ${err.response?.status} - ${err.message}`)
      throw new Error(err.response?.data ? JSON.stringify(err.response.data) : err.message)
    }
  })

  ipcMain.handle('api-fetch-available-clock-types', async (_, { companyId, employeeId, date }) => {
    const token = await tokenManager.getValidAccessToken()
    const url = `https://api.freee.co.jp/hr/api/v1/employees/${employeeId}/time_clocks/available_types`
    console.log(`[API Call] GET ${url}`)
    try {
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        params: { company_id: companyId, date }
      })
      return res.data
    } catch (err: any) {
      console.error(`[API Error] GET ${url} - Status: ${err.response?.status} - ${err.message}`)
      throw new Error(err.response?.data ? JSON.stringify(err.response.data) : err.message)
    }
  })

  ipcMain.handle('api-submit-time-clock', async (_, { companyId, employeeId, type, baseDate, datetime }) => {
    const token = await tokenManager.getValidAccessToken()
    const url = `https://api.freee.co.jp/hr/api/v1/employees/${employeeId}/time_clocks`
    console.log(`[API Call] POST ${url} type=${type} base_date=${baseDate} datetime=${datetime || '(none)'}`)
    const body: any = { company_id: companyId, type, base_date: baseDate }
    if (datetime) body.datetime = datetime
    try {
      const res = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json'
        }
      })
      return res.data
    } catch (err: any) {
      console.error(`[API Error] POST ${url} - Status: ${err.response?.status} - ${err.message}`)
      throw new Error(err.response?.data ? JSON.stringify(err.response.data) : err.message)
    }
  })

  createWindow()

  // ─── 自動更新（パッケージ済みビルドのみ） ─────────────────────
  if (app.isPackaged) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update-available', info.version)
    })

    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update-downloaded', info.version)
    })

    autoUpdater.checkForUpdates().catch((e) =>
      console.error('[AutoUpdater] checkForUpdates failed:', e.message, e.stack)
    )
  }

  ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall()
  })

  // アプリ起動時にバックグラウンドで事前ログイン（初回申請の待ち時間を短縮）
  const startupEmail = store.get('FREEE_EMAIL') as string
  const startupPassword = store.get('FREEE_PASSWORD') as string
  if (startupEmail && startupPassword) {
    setTimeout(() => {
      preLoginViaBrowser(startupEmail, startupPassword).catch(e =>
        console.warn('[Startup] Pre-login failed:', e.message)
      )
    }, 5000)
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
