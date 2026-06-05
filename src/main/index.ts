import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import { dirname, join } from 'path'
import axios from 'axios'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import { TokenManager, TokenAuthRequiredError } from './tokenManager'
import { submitOvertimeViaBrowser, submitPaidLeaveViaBrowser, submitMonthlyCloseViaBrowser, preLoginViaBrowser, cancelRequestViaBrowser, cancelRequestBatchViaBrowser, submitTimeClockViaBrowser, approveBatchViaBrowser, approveBulkViaBrowser, submitOvertimeBatchViaBrowser, submitPaidLeaveBatchViaBrowser } from './automation'

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
    expires_at: 0,
    ID_NAME_MAP: {} as Record<string, string>,
    LOGIN_VERIFIED: false,
    LOGIN_VERIFIED_AT: 0,
    LOGIN_VERIFIED_EMAIL: '',
    AUTO_APPROVAL_ALLOWED_ROUTE_IDS: {} as Record<string, number[]>
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

type AutoApprovalTypeKey = 'overtime' | 'paid_holiday' | 'work_time'
type AutoApprovalHour = number | string

const AUTO_APPROVAL_SCRIPT = app.isPackaged
  ? join(process.resourcesPath, 'auto-approval', 'auto-approve-work-time.mjs')
  : join(__dirname, '../../scripts/auto-approve-work-time.mjs')
const AUTO_APPROVAL_WORKDIR = app.isPackaged ? dirname(AUTO_APPROVAL_SCRIPT) : join(__dirname, '../..')
const AUTO_APPROVAL_NOTIFICATION_PATH = join(
  process.env.APPDATA || join(os.homedir(), 'AppData', 'Roaming'),
  'overtime-app',
  'auto-approval-notifications.json',
)

const AUTO_APPROVAL_TYPES: Record<
  AutoApprovalTypeKey,
  { taskName: string; label: string; description: string; defaultRouteIds: number[] }
> = {
  overtime: {
    taskName: 'freee-overtime-auto-approve',
    label: '残業申請',
    description: 'freee残業申請を、正しい申請経路の場合のみ自動承認する',
    defaultRouteIds: [881216],
  },
  paid_holiday: {
    taskName: 'freee-paid-holiday-auto-approve',
    label: '有給申請',
    description: 'freee有給申請を、正しい申請経路の場合のみ自動承認する',
    defaultRouteIds: [881725],
  },
  work_time: {
    taskName: 'freee-work-time-auto-approve',
    label: '勤務時間修正',
    description: 'freee勤務時間修正申請を、正しい申請経路の場合のみ自動承認する',
    defaultRouteIds: [1406896],
  },
}

function getAutoApprovalType(type?: string): { key: AutoApprovalTypeKey; taskName: string; label: string; description: string; defaultRouteIds: number[] } {
  const key = (type || 'work_time') as AutoApprovalTypeKey
  const config = AUTO_APPROVAL_TYPES[key]
  if (!config) throw new Error(`自動承認の対象種別が不正です: ${key}`)
  return { key, ...config }
}

function psSingleQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

function normalizeAutoApprovalHours(hours: unknown): AutoApprovalHour[] {
  const source = Array.isArray(hours) ? hours : [12, 24]
  const normalized = Array.from(
    new Set(
      source
        .map((h) => {
          if (typeof h === 'string' && /^\d{1,2}:\d{2}$/.test(h)) {
            const [hh, mm] = h.split(':').map(Number)
            if (Number.isInteger(hh) && Number.isInteger(mm) && hh >= 9 && hh <= 23 && mm >= 0 && mm <= 59) {
              return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
            }
          }
          const hour = Number(h)
          return Number.isInteger(hour) && hour >= 9 && hour <= 24 ? hour : null
        })
        .filter((h): h is AutoApprovalHour => h !== null),
    ),
  ).sort((a, b) => {
    const toMinutes = (value: AutoApprovalHour): number => {
      if (typeof value === 'string') {
        const [hh, mm] = value.split(':').map(Number)
        return hh * 60 + mm
      }
      return value * 60
    }
    return toMinutes(a) - toMinutes(b)
  })
  return normalized.length > 0 ? normalized : [12, 24]
}

function psAutoApprovalTimeArray(values: unknown): string {
  return normalizeAutoApprovalHours(values).map((value) => psSingleQuote(value)).join(',')
}

function normalizeAutoApprovalRouteIds(routeIds: unknown): number[] {
  const source = Array.isArray(routeIds) ? routeIds : []
  return Array.from(
    new Set(source.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
  ).sort((a, b) => a - b)
}

function getAutoApprovalAllowedRouteIds(type: string): number[] {
  const target = getAutoApprovalType(type)
  const allSettings = (store.get('AUTO_APPROVAL_ALLOWED_ROUTE_IDS') as Record<string, number[]>) || {}
  const configured = normalizeAutoApprovalRouteIds(allSettings[target.key])
  return configured.length > 0 ? configured : target.defaultRouteIds
}

function setAutoApprovalAllowedRouteIds(type: string, routeIds: unknown): number[] {
  const target = getAutoApprovalType(type)
  const normalized = normalizeAutoApprovalRouteIds(routeIds)
  if (normalized.length === 0) throw new Error('承認経路を1つ以上選択してください。')
  const allSettings = (store.get('AUTO_APPROVAL_ALLOWED_ROUTE_IDS') as Record<string, number[]>) || {}
  store.set('AUTO_APPROVAL_ALLOWED_ROUTE_IDS', { ...allSettings, [target.key]: normalized })
  return normalized
}

function runPowerShellJson(script: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `PowerShell exited with code ${code}`))
        return
      }
      const text = stdout.trim()
      if (!text) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(text))
      } catch (error: any) {
        reject(new Error(`PowerShell JSON parse failed: ${error.message}\n${text}`))
      }
    })
  })
}

async function getAutoApprovalStatus(type?: string): Promise<any> {
  const target = getAutoApprovalType(type)
  const script = `
$ErrorActionPreference = 'Stop'
$TaskName = ${psSingleQuote(target.taskName)}
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  [pscustomobject]@{
    exists = $false
    enabled = $false
    state = 'Missing'
    hours = @(12, 24)
    nextRunTime = ''
    lastRunTime = ''
    lastTaskResult = $null
  } | ConvertTo-Json -Compress
  exit 0
}
$info = Get-ScheduledTaskInfo -TaskName $TaskName
$hours = @($task.Triggers | ForEach-Object {
  if ($_.StartBoundary) {
    $dt = [DateTime]::Parse($_.StartBoundary)
    if ($dt.Minute -eq 0) {
      if ($dt.Hour -eq 0) { '24' } else { [string]$dt.Hour }
    } else {
      '{0:D2}:{1:D2}' -f $dt.Hour, $dt.Minute
    }
  }
} | Sort-Object -Unique)
if ($hours.Count -eq 0) { $hours = @(12, 24) }
[pscustomobject]@{
  exists = $true
  enabled = ($task.State -ne 'Disabled')
  state = $task.State.ToString()
  hours = $hours
  nextRunTime = if ($info.NextRunTime) { $info.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }
  lastRunTime = if ($info.LastRunTime -and $info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }
  lastTaskResult = $info.LastTaskResult
} | ConvertTo-Json -Compress
`
  const status = await runPowerShellJson(script)
  return {
    ...status,
    type: target.key,
    label: target.label,
    hours: normalizeAutoApprovalHours(status?.hours),
    allowedRouteIds: getAutoApprovalAllowedRouteIds(target.key),
  }
}

async function configureAutoApproval(type: string | undefined, { enabled, hours }: { enabled: boolean; hours: unknown }): Promise<any> {
  const target = getAutoApprovalType(type)
  const normalizedHours = normalizeAutoApprovalHours(hours)
  const timeList = psAutoApprovalTimeArray(normalizedHours)
  const isEnabled = enabled !== false
  const script = `
$ErrorActionPreference = 'Stop'
$TaskName = ${psSingleQuote(target.taskName)}
$ScriptPath = ${psSingleQuote(AUTO_APPROVAL_SCRIPT)}
$WorkDir = ${psSingleQuote(AUTO_APPROVAL_WORKDIR)}
$RequestType = ${psSingleQuote(target.key)}
$Times = @(${timeList})
$NodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $NodeCommand) { throw "node.exe が見つかりません。Node.jsをインストールしてください。" }
$Node = $NodeCommand.Source
if (-not (Test-Path $ScriptPath)) { throw "auto approval script not found: $ScriptPath" }
$action = New-ScheduledTaskAction -Execute $Node -Argument ('"' + $ScriptPath + '" --execute --type ' + $RequestType) -WorkingDirectory $WorkDir
$triggers = @()
foreach ($time in $Times) {
  $text = [string]$time
  if ($text.Contains(':')) {
    $parts = $text.Split(':')
    $actualHour = [int]$parts[0]
    $minute = [int]$parts[1]
  } else {
    $hour = [int]$text
    $actualHour = if ($hour -eq 24) { 0 } else { $hour }
    $minute = 0
  }
  $triggerTime = (Get-Date).Date.AddHours($actualHour).AddMinutes($minute)
  $triggers += New-ScheduledTaskTrigger -Daily -At $triggerTime
}
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description ${psSingleQuote(target.description)} -Force | Out-Null
if (${isEnabled ? '$true' : '$false'}) {
  Enable-ScheduledTask -TaskName $TaskName | Out-Null
} else {
  Disable-ScheduledTask -TaskName $TaskName | Out-Null
}
$task = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
[pscustomobject]@{
  exists = $true
  enabled = ($task.State -ne 'Disabled')
  state = $task.State.ToString()
  hours = $Times
  nextRunTime = if ($info.NextRunTime) { $info.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }
  lastRunTime = if ($info.LastRunTime -and $info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }
  lastTaskResult = $info.LastTaskResult
} | ConvertTo-Json -Compress
`
  const status = await runPowerShellJson(script)
  return {
    ...status,
    type: target.key,
    label: target.label,
    hours: normalizeAutoApprovalHours(status?.hours),
    allowedRouteIds: getAutoApprovalAllowedRouteIds(target.key),
  }
}

function readAutoApprovalNotifications(): any[] {
  try {
    if (!fs.existsSync(AUTO_APPROVAL_NOTIFICATION_PATH)) return []
    const raw = fs.readFileSync(AUTO_APPROVAL_NOTIFICATION_PATH, 'utf8').replace(/^\uFEFF/, '')
    const data = JSON.parse(raw)
    if (Array.isArray(data)) return data
    if (Array.isArray(data.notifications)) return data.notifications
  } catch (error: any) {
    console.warn('[AutoApproval] notification read failed:', error.message)
  }
  return []
}

function clearAutoApprovalNotifications(): any[] {
  try {
    if (fs.existsSync(AUTO_APPROVAL_NOTIFICATION_PATH)) {
      fs.writeFileSync(AUTO_APPROVAL_NOTIFICATION_PATH, JSON.stringify({ notifications: [] }, null, 2), 'utf8')
    }
  } catch (error: any) {
    console.warn('[AutoApproval] notification clear failed:', error.message)
    throw error
  }
  return []
}

import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 800,
    minWidth: 550,
    minHeight: 600,
    resizable: true,
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
const RPA_HEADLESS = true  // バックグラウンド動作

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

  ipcMain.handle('auto-approval-status', async (_, type?: string) => {
    return await getAutoApprovalStatus(type)
  })

  ipcMain.handle('auto-approval-set-enabled', async (_, type: string | boolean, enabled?: boolean) => {
    if (typeof type === 'boolean' && enabled === undefined) {
      enabled = type
      type = 'work_time'
    }
    return await configureAutoApproval(type as string, {
      enabled: !!enabled,
      hours: (await getAutoApprovalStatus(type as string)).hours,
    })
  })

  ipcMain.handle('auto-approval-set-hours', async (_, type: string | unknown[], hours?: unknown[]) => {
    if (Array.isArray(type) && hours === undefined) {
      hours = type
      type = 'work_time'
    }
    const current = await getAutoApprovalStatus(type as string)
    return await configureAutoApproval(type as string, { enabled: !!current.enabled, hours })
  })

  ipcMain.handle('auto-approval-set-routes', async (_, type: string | unknown[], routeIds?: unknown[]) => {
    if (Array.isArray(type) && routeIds === undefined) {
      routeIds = type
      type = 'work_time'
    }
    setAutoApprovalAllowedRouteIds(type as string, routeIds)
    return await getAutoApprovalStatus(type as string)
  })

  ipcMain.handle('auto-approval-notifications-get', async () => {
    return readAutoApprovalNotifications()
  })

  ipcMain.handle('auto-approval-notifications-clear', async () => {
    return clearAutoApprovalNotifications()
  })

  // ─── ユーザー情報取得（フロントエンド共通） ─────────────────────
  ipcMain.handle('api-get-user-info', async () => {
    const token = await tokenManager.getValidAccessToken()
    return await getUserInfo(token)
  })

  // ─── Settings Store IPC ───────────────────────────────────────
  ipcMain.handle('store-get', (_, key) => store.get(key))
  ipcMain.handle('store-set', (_, key, val) => store.set(key, val))

  // ─── ID→名前マッピング IPC ────────────────────────────────────
  ipcMain.handle('name-map-get-all', (): Record<string, string> => {
    return (store.get('ID_NAME_MAP') as Record<string, string>) || {}
  })

  ipcMain.handle(
    'name-map-set',
    (_, id: string, name: string): { success: boolean; message?: string } => {
      const trimmedId = String(id || '').trim()
      const trimmedName = String(name || '').trim()
      if (!trimmedId) return { success: false, message: 'IDが空です' }
      if (!trimmedName) return { success: false, message: '名前を入力してください' }
      const current = (store.get('ID_NAME_MAP') as Record<string, string>) || {}
      const updated: Record<string, string> = { ...current, [trimmedId]: trimmedName }
      store.set('ID_NAME_MAP', updated)
      return { success: true }
    }
  )

  ipcMain.handle('name-map-delete', (_, id: string): { success: boolean } => {
    const key = String(id || '').trim()
    const current = (store.get('ID_NAME_MAP') as Record<string, string>) || {}
    if (!(key in current)) return { success: true }
    const { [key]: _removed, ...rest } = current
    store.set('ID_NAME_MAP', rest)
    return { success: true }
  })

  ipcMain.handle('name-map-clear', (): { success: boolean } => {
    store.set('ID_NAME_MAP', {})
    return { success: true }
  })

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

  // ─── ログイン確認 IPC（手動テスト用） ────────────────────────
  // 設定画面の「ログイン確認」ボタンから呼び出される。
  // 成功時のみ LOGIN_VERIFIED=true をストアに保存し、申請ボタンの活性化条件にする。
  ipcMain.handle('api-verify-login', async (_, payload?: { email?: string; password?: string }) => {
    const email = (payload?.email ?? (store.get('FREEE_EMAIL') as string) ?? '').trim()
    const password = payload?.password ?? (store.get('FREEE_PASSWORD') as string) ?? ''
    if (!email || !password) {
      return { success: false, message: 'メールアドレスとパスワードを入力してください。' }
    }
    try {
      await preLoginViaBrowser(email, password)
      store.set('LOGIN_VERIFIED', true)
      store.set('LOGIN_VERIFIED_AT', Date.now())
      store.set('LOGIN_VERIFIED_EMAIL', email)
      return { success: true, message: 'ログインに成功しました。', verifiedAt: Date.now() }
    } catch (e: any) {
      store.set('LOGIN_VERIFIED', false)
      const message = e?.message || 'ログインに失敗しました。'
      return { success: false, message }
    }
  })

  // ─── ログイン確認状態取得 ────────────────────────────────────
  // メールアドレスが変わっていれば未確認扱いに自動リセット
  ipcMain.handle('api-get-login-verified', () => {
    const verified = !!store.get('LOGIN_VERIFIED')
    const verifiedEmail = (store.get('LOGIN_VERIFIED_EMAIL') as string) || ''
    const currentEmail = (store.get('FREEE_EMAIL') as string) || ''
    const valid = verified && verifiedEmail === currentEmail && !!currentEmail
    return {
      verified: valid,
      verifiedAt: (store.get('LOGIN_VERIFIED_AT') as number) || 0,
      hasCredentials: !!currentEmail && !!(store.get('FREEE_PASSWORD') as string),
    }
  })

  // ─── ログイン確認状態リセット ────────────────────────────────
  // メール/パスワード変更時にフロントから呼ぶ
  ipcMain.handle('api-reset-login-verified', () => {
    store.set('LOGIN_VERIFIED', false)
    store.set('LOGIN_VERIFIED_AT', 0)
    return { success: true }
  })

  // ─── 承認/差戻し API ──────────────────────────────────────────
  // freee HR API の `/actions` エンドポイントを呼ぶ。
  // approval_action: 'approve' | 'feedback' | 'cancel' | 'force_feedback'
  type ApprovalActionType =
    | 'overtime'
    | 'paid_holiday'
    | 'monthly_attendance'
    | 'work_time'
  const TYPE_PATH_MAP: Record<ApprovalActionType, string> = {
    overtime: 'overtime_works',
    paid_holiday: 'paid_holidays',
    monthly_attendance: 'monthly_attendances',
    work_time: 'work_times'
  }

  interface ApprovalActionPayload {
    type: ApprovalActionType
    id: number
    targetRound: number
    targetStepId: number
    action: 'approve' | 'feedback' | 'cancel' | 'force_feedback'
  }

  async function executeApprovalAction(
    payload: ApprovalActionPayload
  ): Promise<{ success: boolean; status?: number; data?: unknown; message?: string }> {
    const token = await tokenManager.getValidAccessToken()
    const { companyId } = await getUserInfo(token)
    const path = TYPE_PATH_MAP[payload.type]
    if (!path) return { success: false, message: `不明な申請種別: ${payload.type}` }
    const url = `https://api.freee.co.jp/hr/api/v1/approval_requests/${path}/${payload.id}/actions`
    const body = {
      company_id: companyId,
      approval_action: payload.action,
      target_round: payload.targetRound,
      target_step_id: payload.targetStepId
    }
    console.log(`[API Call] POST ${url} action=${payload.action}`)
    try {
      const res = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'FREEE-VERSION': '2022-02-01'
        }
      })
      return { success: true, status: res.status, data: res.data }
    } catch (err: unknown) {
      const axErr = err as { response?: { status?: number; data?: unknown }; message?: string }
      const message = axErr.response?.data
        ? typeof axErr.response.data === 'string'
          ? axErr.response.data
          : JSON.stringify(axErr.response.data)
        : axErr.message || '不明なエラー'
      console.error(
        `[API Error] POST ${url} status=${axErr.response?.status} message=${message}`
      )
      return {
        success: false,
        status: axErr.response?.status,
        message
      }
    }
  }

  // 単発（API 経路）。役職指定経路では失敗するため、UI からは基本 batch を使う想定。
  ipcMain.handle('api-approval-action', async (_, payload: ApprovalActionPayload) => {
    return await executeApprovalAction(payload)
  })

  /**
   * 一括承認/差戻し。
   * freee 仕様により役職指定/部門指定の申請経路は API では承認できないため、
   * RPA (Web画面自動操作) でブラウザ経由で実行する。
   * UI 側ではログイン確認済み (LOGIN_VERIFIED=true) を前提とする。
   */
  ipcMain.handle(
    'api-approval-batch',
    async (
      event,
      payloads: ApprovalActionPayload[],
      options?: { comment?: string; action?: 'approve' | 'feedback' }
    ) => {
      if (!Array.isArray(payloads) || payloads.length === 0) {
        return { total: 0, succeeded: 0, failed: 0, results: [] }
      }
      // 全件同じ action である前提（UI 側で承認/差戻しを別ボタンに分けている）
      const action = options?.action || (payloads[0].action as 'approve' | 'feedback')
      const email = (store.get('FREEE_EMAIL') as string) || ''
      const password = (store.get('FREEE_PASSWORD') as string) || ''
      if (!email || !password) {
        return {
          total: payloads.length,
          succeeded: 0,
          failed: payloads.length,
          results: payloads.map((p) => ({
            payload: { type: p.type, id: p.id, action },
            success: false,
            message:
              '設定画面でメールアドレス・パスワードを入力し「ログイン確認」を完了してください。',
          })),
        }
      }

      const items = payloads.map((p) => ({
        requestType: p.type,
        requestId: p.id,
      }))

      const sendProgress = (
        current: number,
        total: number,
        requestId: number,
      ): void => {
        event.sender.send('approval-batch-progress', {
          current,
          total,
          type: payloads.find((p) => p.id === requestId)?.type || '',
          id: requestId,
        })
      }

      try {
        // 承認 (approve): 一括 UI を使い、失敗 ID は per-item にフォールバック
        // 差戻し (feedback): 既存 per-item 方式（一括 UI なし想定）
        if (action === 'approve') {
          console.log('[RPA] Approve via BULK UI')
          const bulkResult = await approveBulkViaBrowser({
            email,
            password,
            items,
            action: 'approve',
            headless: RPA_HEADLESS,
            onProgress: (p) => sendProgress(p.current, p.total, p.requestId),
          })
          // 一括方式で失敗した ID は per-item にフォールバック
          const failedItems = bulkResult.results
            .filter((r) => !r.success)
            .map((r) => ({ requestType: r.requestType as any, requestId: r.requestId }))
          let fallbackResults: typeof bulkResult.results = []
          if (failedItems.length > 0) {
            console.log(`[RPA] Falling back to per-item for ${failedItems.length} items`)
            const fallback = await approveBatchViaBrowser({
              email,
              password,
              items: failedItems,
              action: 'approve',
              headless: RPA_HEADLESS,
              onProgress: (p) => sendProgress(p.current, p.total, p.requestId),
            })
            fallbackResults = fallback.results
          }
          // bulkResult.results を fallback の成功で上書き
          const finalById = new Map<number, (typeof bulkResult.results)[number]>()
          for (const r of bulkResult.results) finalById.set(r.requestId, r)
          for (const r of fallbackResults) {
            if (r.success) finalById.set(r.requestId, r)
          }
          const finalResults = Array.from(finalById.values())
          const succeeded = finalResults.filter((r) => r.success).length
          return {
            total: finalResults.length,
            succeeded,
            failed: finalResults.length - succeeded,
            results: finalResults.map((r) => ({
              payload: { type: r.requestType, id: r.requestId, action },
              success: r.success,
              message: r.message,
            })),
          }
        }

        // feedback (差戻し): per-item 方式
        const rpaResult = await approveBatchViaBrowser({
          email,
          password,
          items,
          action,
          headless: RPA_HEADLESS,
          onProgress: (p) => sendProgress(p.current, p.total, p.requestId),
        })
        return {
          total: rpaResult.total,
          succeeded: rpaResult.succeeded,
          failed: rpaResult.failed,
          results: rpaResult.results.map((r) => ({
            payload: { type: r.requestType, id: r.requestId, action },
            success: r.success,
            message: r.message,
          })),
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : '実行に失敗しました'
        console.error('[RPA] approveBatch fatal:', message)
        return {
          total: payloads.length,
          succeeded: 0,
          failed: payloads.length,
          results: payloads.map((p) => ({
            payload: { type: p.type, id: p.id, action },
            success: false,
            message,
          })),
        }
      }
    }
  )

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

  ipcMain.handle('api-web-submit-overtime-batch', async (event, payload) => {
    try {
      const email = await store.get('FREEE_EMAIL')
      const password = await store.get('FREEE_PASSWORD')
      if (!email || !password) {
        throw new Error('Web版申請にはメールアドレスとパスワードの設定が必要です。設定画面から入力してください。')
      }
      return await submitOvertimeBatchViaBrowser({
        ...payload,
        email,
        password,
        headless: RPA_HEADLESS,
        onProgress: (p) => event.sender.send('overtime-batch-progress', p)
      })
    } catch (error: any) {
      console.error('Overtime Batch Web Submit Error:', error)
      throw error
    }
  })

  ipcMain.handle('api-web-submit-paid-leave-batch', async (event, payload) => {
    try {
      const email = await store.get('FREEE_EMAIL')
      const password = await store.get('FREEE_PASSWORD')
      if (!email || !password) {
        throw new Error('Web版申請にはメールアドレスとパスワードの設定が必要です。設定画面から入力してください。')
      }
      return await submitPaidLeaveBatchViaBrowser({
        ...payload,
        email,
        password,
        headless: RPA_HEADLESS,
        onProgress: (p) => event.sender.send('paid-leave-batch-progress', p)
      })
    } catch (error: any) {
      console.error('Paid Leave Batch Web Submit Error:', error)
      throw error
    }
  })

  ipcMain.handle('api-fetch-approvals', async (_, options?: { limit?: number; statuses?: string[] }) => {
    const token = await tokenManager.getValidAccessToken()
    const { companyId, applicantId: myApplicantId } = await getUserInfo(token)
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    const params = { company_id: companyId }
    const perTypeLimit = options?.limit ?? 50

    // 手動ID→名前マッピング（API取得失敗時のフォールバック / 上書き）
    const manualMap: Record<string, string> = (store.get('ID_NAME_MAP') as Record<string, string>) || {}

    // 従業員名マップ（ページネーションで全件取得 / 複数キーで登録）
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
          const name = [emp.last_name, emp.first_name].filter(Boolean).join(' ')
            || emp.display_name
            || String(emp.id)
          // 実レスポンスに存在するキーだけマップ化する
          if (emp.id !== undefined && emp.id !== null) employeeMap[String(emp.id)] = name
          if (emp.user_id !== undefined && emp.user_id !== null) employeeMap[String(emp.user_id)] = name
          if (emp.employee_id !== undefined && emp.employee_id !== null) employeeMap[String(emp.employee_id)] = name
        }
        console.log(`[API] employees fetched: offset=${offset}, count=${employees.length}, mapped keys=${Object.keys(employeeMap).length}`)
        if (employees.length < limit) break
        offset += limit
      }
    } catch (e: any) {
      console.warn('[API] employees fetch failed:', e.message)
    }

    const resolveName = (id: number | string | undefined | null): string => {
      if (id === undefined || id === null || id === '') return '—'
      const key = String(id)
      // フォールバック順:
      // 1) employeeMap（API成功時）
      // 2) manualMap（手動登録）
      // 3) ID:${key}（最終フォールバック）
      return employeeMap[key] || manualMap[key] || `ID:${key}`
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

    const usageTypeLabel: Record<string, string> = {
      full_day: '全休', morning_half: '午前休', afternoon_half: '午後休',
      full: '全休', morning: '午前休', afternoon: '午後休',
      hourly: '時間単位',
    }
    const holidayTypeLabel: Record<string, string> = {
      paid_holiday: '有給',
      special_holiday: '特別休暇',
      compensation_holiday: '代休',
      substitute_holiday: '振休',
    }

    type ApprovalLog = {
      userId: number | null
      userName: string
      action: string
      updatedAt: string
    }

    type ApprovalItem = {
      type: 'overtime' | 'paid_holiday' | 'monthly_attendance' | 'work_time'
      requestType: string
      id: number
      requestId: number
      applicationNumber: number | null
      applicantId: number | null
      applicantName: string
      approverIds: number[]
      approverNames: string[]
      targetDate: string
      startAt: string
      endAt: string
      issueDate: string
      comment: string
      status: string
      revokeStatus: string | null
      passedAutoCheck: boolean | null
      approvalFlowRouteId: number | null
      routeName: string
      currentStepId: number | null
      currentRound: number | null
      approvalFlowLogs: ApprovalLog[]
      usageType: string
      holidayType: string
      values: any
      departmentName: string
      isSelf: boolean
      isApprover: boolean
    }

    type FetchTypeKey = 'overtime' | 'paid_holiday' | 'monthly_attendance' | 'work_time'
    const TYPE_PATH: Record<FetchTypeKey, string> = {
      overtime: 'overtime_works',
      paid_holiday: 'paid_holidays',
      monthly_attendance: 'monthly_attendances',
      work_time: 'work_times',
    }
    const RESPONSE_KEY: Record<FetchTypeKey, string> = {
      overtime: 'overtime_works',
      paid_holiday: 'paid_holidays',
      monthly_attendance: 'monthly_attendances',
      work_time: 'work_times',
    }

    const buildItem = (typeKey: FetchTypeKey, raw: any, detail: any | null): ApprovalItem => {
      const item = detail || raw
      const fallback = raw || {}
      const merged = (key: string) => (item && item[key] !== undefined ? item[key] : fallback[key])

      const applicantId: number | null = merged('applicant_id') ?? merged('employee_id') ?? null
      const approverIds: number[] = Array.isArray(merged('approver_ids')) ? merged('approver_ids') : []
      const approverNames = approverIds.map((id) => resolveName(id))
      const logsRaw: any[] = Array.isArray(merged('approval_flow_logs')) ? merged('approval_flow_logs') : []
      const approvalFlowLogs: ApprovalLog[] = logsRaw.map((log) => ({
        userId: log.user_id ?? null,
        userName: resolveName(log.user_id),
        action: log.action || '',
        updatedAt: log.updated_at || '',
      }))

      let targetDate = merged('target_date') || ''
      if (typeKey === 'monthly_attendance') {
        if (item?.target_year && item?.target_month) {
          targetDate = `${item.target_year}-${String(item.target_month).padStart(2, '0')}`
        } else if (typeof targetDate === 'string') {
          targetDate = targetDate.slice(0, 7)
        }
      }

      const routeId = merged('approval_flow_route_id') ?? null
      const routeName = merged('approval_flow_route_name')
        || (routeId ? (routeMap[String(routeId)] || '') : '')

      const usageRaw = merged('usage_type')
      const holidayRaw = merged('holiday_type')

      return {
        type: typeKey,
        requestType: TYPE_PATH[typeKey],
        id: merged('id'),
        requestId: merged('id'),
        applicationNumber: merged('application_number') ?? null,
        applicantId,
        applicantName: merged('applicant_name') || resolveName(applicantId),
        approverIds,
        approverNames,
        targetDate: targetDate || '',
        startAt: merged('start_at') || '',
        endAt: merged('end_at') || '',
        issueDate: merged('issue_date') || '',
        comment: merged('comment') || '',
        status: merged('status') || '',
        revokeStatus: merged('revoke_status') ?? null,
        passedAutoCheck: typeof merged('passed_auto_check') === 'boolean' ? merged('passed_auto_check') : null,
        approvalFlowRouteId: routeId,
        routeName,
        currentStepId: merged('current_step_id') ?? null,
        currentRound: merged('current_round') ?? null,
        approvalFlowLogs,
        usageType: usageRaw ? (usageTypeLabel[usageRaw] || usageRaw) : '',
        holidayType: holidayRaw ? (holidayTypeLabel[holidayRaw] || holidayRaw) : '',
        values: merged('values') ?? null,
        departmentName: merged('department_id') ? (deptMap[String(merged('department_id'))] || '') : '',
        isSelf: applicantId !== null && String(applicantId) === String(myApplicantId),
        isApprover: (() => {
          const myId = String(myApplicantId)

          // 1) approval_flow_logs に自分の approve アクションがあれば既承認 → false
          const alreadyApproved = approvalFlowLogs.some(
            (log) => log.userId !== null && String(log.userId) === myId && log.action === 'approve'
          )
          if (alreadyApproved) return false

          // 2) 詳細レスポンスに approval_flow_steps がある場合、current_step_id のステップの承認者か確認
          const steps: any[] = Array.isArray(detail?.approval_flow_steps) ? detail.approval_flow_steps : []
          const currentStepId = merged('current_step_id')

          if (steps.length > 0 && currentStepId != null) {
            const currentStep = steps.find((s: any) => s.id === currentStepId)
            if (currentStep) {
              const stepApproverIds: number[] = Array.isArray(currentStep.approver_ids)
                ? currentStep.approver_ids
                : (currentStep.approver_id != null ? [currentStep.approver_id] : [])
              return stepApproverIds.some((id: number) => String(id) === myId)
            }
          }

          // 3) フォールバック: steps が取得できない場合（月次締め等）
          // approverIds に自分が含まれていれば承認者と判定する
          return approverIds.some((id) => String(id) === myId)
        })(),
      }
    }

    const fetchListAndDetails = async (typeKey: FetchTypeKey): Promise<ApprovalItem[]> => {
      const path = TYPE_PATH[typeKey]
      const respKey = RESPONSE_KEY[typeKey]
      const url = `https://api.freee.co.jp/hr/api/v1/approval_requests/${path}`
      let listItems: any[] = []
      try {
        const res = await axios.get(url, { headers, params: { ...params, limit: perTypeLimit } })
        const data = res.data
        listItems = data?.[respKey]
          || data?.approval_requests
          || (Array.isArray(data) ? data : [])
        console.log(`[API] ${path} list fetched: ${listItems.length}`)
      } catch (e: any) {
        console.warn(`[API] ${path} list fetch failed:`, e.response?.status, e.message)
        return []
      }

      // 詳細APIを並列取得（失敗しても一覧データだけで表示できるようにする）
      const detailPromises = listItems.map(async (raw) => {
        const id = raw?.id
        if (!id) return { raw, detail: null }
        try {
          const detRes = await axios.get(`${url}/${id}`, { headers, params })
          const detailData = detRes.data?.[respKey.replace(/s$/, '')] || detRes.data
          // デバッグ: approval_flow_steps の有無を確認（初回のみ）
          if (id === listItems[0]?.id) {
            console.log(`[API] ${path}/${id} detail keys:`, Object.keys(detailData || {}))
            console.log(`[API] ${path}/${id} approval_flow_steps:`, JSON.stringify(detailData?.approval_flow_steps || 'NOT_FOUND'))
            console.log(`[API] ${path}/${id} current_step_id:`, detailData?.current_step_id)
            console.log(`[API] ${path}/${id} approval_flow_logs:`, JSON.stringify(detailData?.approval_flow_logs || []))
          }
          return { raw, detail: detailData }
        } catch (e: any) {
          console.warn(`[API] ${path}/${id} detail fetch failed:`, e.response?.status, e.message)
          return { raw, detail: null }
        }
      })
      const settled = await Promise.all(detailPromises)
      return settled.map(({ raw, detail }) => buildItem(typeKey, raw, detail))
    }

    const allTypes: FetchTypeKey[] = ['overtime', 'paid_holiday', 'monthly_attendance', 'work_time']
    const fetched = await Promise.all(allTypes.map((t) => fetchListAndDetails(t)))
    const results: ApprovalItem[] = ([] as ApprovalItem[]).concat(...fetched)

    // ステータスフィルタ（指定がある場合）
    const filtered = options?.statuses?.length
      ? results.filter((r) => options.statuses!.includes(r.status))
      : results

    // 申請日が新しい順、なければ対象日順
    return filtered.sort((a, b) => {
      const ai = a.issueDate || a.targetDate || ''
      const bi = b.issueDate || b.targetDate || ''
      return bi.localeCompare(ai)
    })
  })

  // ─── 自分の申請一覧取得 ────────────────────────────────────────
  ipcMain.handle('api-fetch-my-requests', async (_, options?: { months?: number }) => {
    const token = await tokenManager.getValidAccessToken()
    const { companyId, applicantId: myApplicantId } = await getUserInfo(token)
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    // サーバー側で applicant_id フィルタ + limit=100 で自分の申請のみ取得
    const params = { company_id: companyId, applicant_id: myApplicantId, limit: 100 }
    const months = Math.max(1, Math.min(6, options?.months ?? 1))
    console.log(
      `[MY-REQ] Fetching companyId=${companyId} applicantId=${myApplicantId} months=±${months}`,
    )
    // 除外ステータス（取下げ・却下系）。承認済み(approved)は表示する。
    const excludeStatuses = ['denied', 'feedback_waiting', 'withdrawn']

    // 期間: 今日から ±N ヶ月（target_date でフィルタ）
    const today = new Date()
    const fromDate = new Date(today)
    fromDate.setMonth(fromDate.getMonth() - months)
    const toDate = new Date(today)
    toDate.setMonth(toDate.getMonth() + months)
    const formatYmd = (d: Date): string =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const fromStr = formatYmd(fromDate)
    const toStr = formatYmd(toDate)
    console.log(`[MY-REQ] Date filter: ${fromStr} ～ ${toStr}`)

    const routeMap: Record<string, string> = {}
    try {
      const routeRes = await axios.get('https://api.freee.co.jp/hr/api/v1/approval_flow_routes', {
        headers, params: { company_id: companyId }
      })
      const routes: any[] = routeRes.data.approval_flow_routes || []
      for (const r of routes) routeMap[String(r.id)] = r.name
      console.log(`[MY-REQ] routes fetched: ${routes.length}`)
    } catch (e: any) { console.warn('[API] routes fetch failed:', e.message) }

    const usageTypeLabel: Record<string, string> = {
      full_day: '全休', morning_half: '午前半休', afternoon_half: '午後半休',
      full: '全休', morning: '午前半休', afternoon: '午後半休',
    }

    /**
     * 一覧 + 詳細 API を併用して route_name を確実に取得する。
     * api-fetch-approvals と同じパターン: 詳細を Promise.all で並列フェッチ。
     */
    /** 申請の対象日が ±months 範囲内か判定 */
    const isWithinDateRange = (item: any): boolean => {
      // monthly_attendance: target_year/target_month を YYYY-MM-01 とみなす
      if (item.target_year && item.target_month) {
        const ymd = `${item.target_year}-${String(item.target_month).padStart(2, '0')}-01`
        return ymd >= fromStr && ymd <= toStr
      }
      const td = item.target_date
      if (!td) return true // 対象日がない場合は範囲外で除外しない
      return td >= fromStr && td <= toStr
    }

    const fetchListAndDetails = async (
      pathSegment: string,
      listKey: string,
    ): Promise<Array<{ raw: any; detail: any | null }>> => {
      const url = `https://api.freee.co.jp/hr/api/v1/approval_requests/${pathSegment}`
      let listItems: any[] = []
      try {
        const res = await axios.get(url, { headers, params })
        const data = res.data
        listItems = data?.[listKey] || data?.approval_requests || (Array.isArray(data) ? data : [])
        console.log(`[MY-REQ] ${pathSegment} list: ${listItems.length}`)
      } catch (e: any) {
        console.warn(`[MY-REQ] ${pathSegment} list fetch failed:`, e.response?.status, e.message)
        return []
      }
      // ステータス除外 + 日付範囲フィルタ
      const filtered = listItems
        .filter((it) => !excludeStatuses.includes(it.status))
        .filter((it) => isWithinDateRange(it))
      console.log(`[MY-REQ] ${pathSegment} after filter: ${filtered.length}`)
      // 詳細APIを並列取得（失敗しても一覧データだけで継続）
      const detailKey = listKey.replace(/s$/, '')
      const detailPromises = filtered.map(async (raw) => {
        if (!raw?.id) return { raw, detail: null }
        try {
          const detRes = await axios.get(`${url}/${raw.id}`, {
            headers,
            params: { company_id: companyId },
          })
          return { raw, detail: detRes.data?.[detailKey] || detRes.data }
        } catch (e: any) {
          console.warn(
            `[MY-REQ] ${pathSegment}/${raw.id} detail failed:`,
            e.response?.status,
            e.message,
          )
          return { raw, detail: null }
        }
      })
      return Promise.all(detailPromises)
    }

    /** 詳細 → 一覧 の順で値を取得（詳細優先） */
    const merged = (raw: any, detail: any | null, key: string): any =>
      detail && detail[key] !== undefined ? detail[key] : raw?.[key]

    /** 申請経路名を: 詳細 approval_flow_route_name → routeMap[id] → '' で解決 */
    const resolveRouteName = (raw: any, detail: any | null): string => {
      const fromDetail = detail?.approval_flow_route_name
      if (fromDetail) return String(fromDetail)
      const routeId = merged(raw, detail, 'approval_flow_route_id')
      if (routeId) return routeMap[String(routeId)] || ''
      return ''
    }

    // 4種別を並列でフェッチ
    const [overtimeData, paidHolidayData, workTimeData, monthlyData] = await Promise.all([
      fetchListAndDetails('overtime_works', 'overtime_works'),
      fetchListAndDetails('paid_holidays', 'paid_holidays'),
      fetchListAndDetails('work_times', 'work_times'),
      fetchListAndDetails('monthly_attendances', 'monthly_attendances'),
    ])

    const results: any[] = []

    // 残業申請
    for (const { raw, detail } of overtimeData) {
      results.push({
        type: 'overtime',
        id: raw.id,
        status: merged(raw, detail, 'status') || raw.status,
        applicationNumber: merged(raw, detail, 'application_number') ?? null,
        targetDate: merged(raw, detail, 'target_date') || '',
        startAt: merged(raw, detail, 'start_at') || '',
        endAt: merged(raw, detail, 'end_at') || '',
        comment: merged(raw, detail, 'comment') || '',
        routeName: resolveRouteName(raw, detail),
      })
    }

    // 有給申請
    for (const { raw, detail } of paidHolidayData) {
      const usageRaw = merged(raw, detail, 'usage_type')
      results.push({
        type: 'paid_holiday',
        id: raw.id,
        status: merged(raw, detail, 'status') || raw.status,
        applicationNumber: merged(raw, detail, 'application_number') ?? null,
        targetDate: merged(raw, detail, 'target_date') || '',
        usageType: usageRaw ? (usageTypeLabel[usageRaw] || usageRaw) : '',
        comment: merged(raw, detail, 'comment') || '',
        routeName: resolveRouteName(raw, detail),
      })
    }

    // 勤務時間修正
    for (const { raw, detail } of workTimeData) {
      results.push({
        type: 'work_time',
        id: raw.id,
        status: merged(raw, detail, 'status') || raw.status,
        applicationNumber: merged(raw, detail, 'application_number') ?? null,
        targetDate: merged(raw, detail, 'target_date') || '',
        startAt: merged(raw, detail, 'start_at') || '',
        endAt: merged(raw, detail, 'end_at') || '',
        comment: merged(raw, detail, 'comment') || '',
        routeName: resolveRouteName(raw, detail),
      })
    }

    // 月次締め申請
    for (const { raw, detail } of monthlyData) {
      let targetDate = ''
      const year = merged(raw, detail, 'target_year')
      const month = merged(raw, detail, 'target_month')
      const td = merged(raw, detail, 'target_date')
      if (year && month) {
        targetDate = `${year}-${String(month).padStart(2, '0')}`
      } else if (td) {
        targetDate = String(td).slice(0, 7)
      }
      results.push({
        type: 'monthly_attendance',
        id: raw.id,
        status: merged(raw, detail, 'status') || raw.status,
        applicationNumber: merged(raw, detail, 'application_number') ?? null,
        targetDate,
        comment: merged(raw, detail, 'comment') || '',
        routeName: resolveRouteName(raw, detail),
      })
    }

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

  // ─── 申請バッチ取り下げ・削除（Web） ─────────────────────────────
  ipcMain.handle('api-cancel-request-web-batch', async (event, payload) => {
    try {
      const email = await store.get('FREEE_EMAIL')
      const password = await store.get('FREEE_PASSWORD')
      if (!email || !password) {
        throw new Error('Web版操作にはメールアドレスとパスワードの設定が必要です。設定画面から入力してください。')
      }
      return await cancelRequestBatchViaBrowser({
        ...payload,
        email,
        password,
        headless: RPA_HEADLESS,
        onProgress: (p) => event.sender.send('cancel-batch-progress', p)
      })
    } catch (error: any) {
      console.error('Cancel batch error:', error)
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
    // freee HR API: values[].type で取得単位を指定（公式スキーマ準拠）
    const { LEAVE_UNIT_TO_API } = await import('../shared/leaveUnit')
    const apiType = LEAVE_UNIT_TO_API[payload.leaveUnit as keyof typeof LEAVE_UNIT_TO_API] || 'full'
    const { applicantId: resolvedApplicantId } = await getUserInfo(token)
    const applicantId = payload.applicantId ?? resolvedApplicantId
    const apiPayload: any = {
      company_id: payload.companyId,
      applicant_id: applicantId,
      target_date: payload.targetDate,
      approval_flow_route_id: payload.routeId,
      comment: payload.comment,
      values: [{ type: apiType }]
    }
    if (payload.departmentId) apiPayload.department_id = payload.departmentId
    console.log(`[API Debug paid_leave] payload.leaveUnit = "${payload.leaveUnit}"`)
    console.log(`[API Debug paid_leave] apiType = "${apiType}"`)
    console.log(`[API Debug paid_leave] Full apiPayload =`, JSON.stringify(apiPayload, null, 2))
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
      console.log(`[RPA Debug] payload.leaveUnit = "${payload.leaveUnit}"`)
      console.log(`[RPA Debug] Full payload keys:`, Object.keys(payload))
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

  // 起動時の事前ログインは「過去にログイン確認済み」の場合のみ実行する。
  // 未確認の状態では無条件リトライによるアカウントロックを防ぐため自動ログインしない。
  const startupEmail = (store.get('FREEE_EMAIL') as string) || ''
  const startupPassword = (store.get('FREEE_PASSWORD') as string) || ''
  const verifiedEmail = (store.get('LOGIN_VERIFIED_EMAIL') as string) || ''
  const isVerified = !!store.get('LOGIN_VERIFIED') && verifiedEmail === startupEmail
  if (startupEmail && startupPassword && isVerified) {
    setTimeout(() => {
      preLoginViaBrowser(startupEmail, startupPassword).catch((e) => {
        console.warn('[Startup] Auto pre-login failed; clearing verified flag:', e.message)
        store.set('LOGIN_VERIFIED', false)
      })
    }, 5000)
  } else if (startupEmail && startupPassword && !isVerified) {
    console.log('[Startup] Skipping auto pre-login (login not verified). Use Settings → ログイン確認.')
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
