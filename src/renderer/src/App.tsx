import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Download, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { Dashboard } from './components/Dashboard'
import { PaidLeave } from './components/PaidLeave'
import { Approvals } from './components/Approvals'
import { Settings } from './components/Settings'
import { MonthlyClose } from './components/MonthlyClose'
import { ManagerOvertime } from './components/ManagerOvertime'
// import { TimeClock } from './components/TimeClock'  // v1.0.8 以降で有効化

type MainView = 'overtime' | 'paid-leave' | 'monthly-close' | 'approvals'
type AppView = MainView | 'manager-overtime'

const TAB_LABELS: Record<MainView, string> = {
  'overtime': '残業申請',
  'paid-leave': '有給申請',
  'monthly-close': '月次締め',
  'approvals': '申請・承認',
}

const MANAGER_ROLES = new Set(['company_admin', 'admin', 'attendance_manager'])

type AutoApprovalApproveScope = {
  applicantKey?: string
  itemKey?: string
  requestId?: number
}

type PermissionPersonGroup = {
  personKey: string
  applicantName: string
  applicantId: string | number | null
  items: any[]
}

function permissionPersonKey(item: any): string {
  const applicantId = item?.applicantId ?? item?.employeeId ?? item?.employeeNumber
  if (applicantId != null && String(applicantId).trim() !== '') {
    return `id:${String(applicantId).trim()}`
  }

  const applicantName = String(item?.applicantName || item?.employeeName || '')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase()
  if (applicantName) return `name:${applicantName}`

  return `request:${String(item?.requestId ?? item?.applicationNumber ?? item?.key ?? '')}`
}

function groupPermissionItems(items: any[]): PermissionPersonGroup[] {
  const groups = new Map<string, PermissionPersonGroup>()

  for (const item of items) {
    const personKey = permissionPersonKey(item)
    const group: PermissionPersonGroup = groups.get(personKey) || {
      personKey,
      applicantName: item?.applicantName || item?.employeeName || '',
      applicantId: item?.applicantId ?? item?.employeeId ?? item?.employeeNumber ?? null,
      items: [],
    }
    group.items.push(item)
    groups.set(personKey, group)
  }

  return Array.from(groups.values())
}

function formatNoticeDate(value?: string): string {
  if (!value) return '—'
  return value.replace(/-/g, '/')
}

function formatNoticeTime(item: any): string {
  return item?.startAt && item?.endAt ? `${item.startAt}–${item.endAt}` : '—'
}

function formatNoticeMinutes(value?: number): string {
  const mins = Math.max(0, Math.round(Number(value || 0)))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}時間${m > 0 ? ` ${m}分` : ''}`
}

function App() {
  const [view, setView] = useState<AppView | 'settings'>('overtime')
  const [prevView, setPrevView] = useState<AppView>('overtime')
  const [updateInfo, setUpdateInfo] = useState<{ version: string; downloaded: boolean } | null>(null)
  const [autoApprovalNotifications, setAutoApprovalNotifications] = useState<any[]>([])
  const [approvingNotificationId, setApprovingNotificationId] = useState<string | null>(null)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const isManager = MANAGER_ROLES.has(userInfo?.role || '')

  useEffect(() => {
    window.api.onUpdateAvailable((version) => setUpdateInfo({ version, downloaded: false }))
    window.api.onUpdateDownloaded((version) => setUpdateInfo({ version, downloaded: true }))
  }, [])

  useEffect(() => {
    window.api
      .getUserInfo()
      .then((info) => {
        setUserInfo(info)
        return window.api.fetchRoutes(info.companyId)
      })
      .catch(() => {
        // 認証前の起動では取得できないため、設定画面や申請画面で再取得する
      })
  }, [])

  useEffect(() => {
    if (view === 'manager-overtime' && userInfo && !isManager) {
      setView('overtime')
    }
  }, [isManager, userInfo, view])

  useEffect(() => {
    let cancelled = false
    const loadNotifications = async (): Promise<void> => {
      try {
        const notices = await window.api.getAutoApprovalNotifications()
        if (!cancelled) setAutoApprovalNotifications(Array.isArray(notices) ? notices : [])
      } catch {
        // 通知取得の失敗は通常操作を妨げない
      }
    }
    loadNotifications()
    const timer = window.setInterval(loadNotifications, 30000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const clearAutoApprovalNotifications = async (): Promise<void> => {
    await window.api.clearAutoApprovalNotifications()
    setAutoApprovalNotifications([])
  }

  const approveAutoApprovalNotification = async (
    notificationId: string,
    scope?: AutoApprovalApproveScope,
  ): Promise<void> => {
    const pendingKey = `${notificationId}:${scope?.applicantKey || scope?.itemKey || scope?.requestId || 'all'}`
    setApprovingNotificationId(pendingKey)
    try {
      const result = await window.api.approveAutoApprovalNotification(notificationId, scope)
      if (Array.isArray(result?.notifications)) {
        setAutoApprovalNotifications(result.notifications)
      } else {
        const notices = await window.api.getAutoApprovalNotifications()
        setAutoApprovalNotifications(Array.isArray(notices) ? notices : [])
      }
      if (!result?.success && result?.message) {
        window.alert(result.message)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '承認に失敗しました。'
      window.alert(message)
    } finally {
      setApprovingNotificationId(null)
    }
  }

  const openSettings = () => {
    setPrevView((view === 'settings' ? prevView : view) as AppView)
    setView('settings')
  }

  const hasAutoApprovalErrors = autoApprovalNotifications.some((notice) => notice.kind === 'route_mismatch')
  const hasAutoApprovalPermission = autoApprovalNotifications.some(
    (notice) => notice.kind === 'overtime_threshold_permission',
  )
  const notificationTone = hasAutoApprovalErrors ? 'error' : hasAutoApprovalPermission ? 'warning' : 'success'

  if (view === 'settings') {
    return (
      <div className="h-screen overflow-hidden bg-[#f7f9fa] font-sans selection:bg-[#007B7E] selection:text-white">
        <Settings onBack={() => setView(prevView)} />
      </div>
    )
  }

  return (
    <div className="h-screen overflow-hidden bg-[#f7f9fa] font-sans selection:bg-[#007B7E] selection:text-white flex flex-col">
      {/* アップデート通知バナー */}
      {updateInfo && (
        <div className={`shrink-0 flex items-center justify-between px-4 py-2 text-sm ${
          updateInfo.downloaded ? 'bg-[#007B7E] text-white' : 'bg-amber-50 text-amber-800 border-b border-amber-200'
        }`}>
          <div className="flex items-center gap-2">
            <Download size={14} />
            {updateInfo.downloaded
              ? `v${updateInfo.version} の準備完了 — 今すぐ再起動して適用できます`
              : `v${updateInfo.version} をダウンロード中...`
            }
          </div>
          {updateInfo.downloaded && (
            <button
              onClick={() => window.api.installUpdate()}
              className="ml-4 px-3 py-1 bg-white text-[#007B7E] rounded-lg text-xs font-bold hover:bg-gray-100 transition-colors"
            >
              再起動して更新
            </button>
          )}
        </div>
      )}
      {autoApprovalNotifications.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4">
          <div
            className={`w-full max-w-3xl bg-white rounded-lg shadow-xl overflow-hidden border ${
              notificationTone === 'error'
                ? 'border-red-200'
                : notificationTone === 'warning'
                  ? 'border-amber-200'
                  : 'border-emerald-200'
            }`}
          >
            <div
              className={`flex items-start gap-3 px-4 py-3 border-b ${
                notificationTone === 'error'
                  ? 'bg-red-50 border-red-100'
                  : notificationTone === 'warning'
                    ? 'bg-amber-50 border-amber-100'
                    : 'bg-emerald-50 border-emerald-100'
              }`}
            >
              {notificationTone === 'error' ? (
                <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
              ) : notificationTone === 'warning' ? (
                <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={`text-sm font-bold ${
                    notificationTone === 'error'
                      ? 'text-red-800'
                      : notificationTone === 'warning'
                        ? 'text-amber-800'
                        : 'text-emerald-800'
                  }`}
                >
                  {notificationTone === 'error'
                    ? '自動承認の確認が必要です'
                    : notificationTone === 'warning'
                      ? '残業時間の許可が必要です'
                      : '自動承認が完了しました'}
                </div>
                <div
                  className={`text-xs mt-0.5 ${
                    notificationTone === 'error'
                      ? 'text-red-700'
                      : notificationTone === 'warning'
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                  }`}
                >
                  {notificationTone === 'error'
                    ? '承認経路が一致しない申請があります。'
                    : notificationTone === 'warning'
                      ? '通知対象の残業時間を超過している申請は、許可した場合のみ承認します。'
                      : '承認した申請の詳細を確認してください。'}
                </div>
              </div>
              <button
                onClick={clearAutoApprovalNotifications}
                className={`p-1 rounded ${
                  notificationTone === 'error'
                    ? 'hover:bg-red-100 text-red-700'
                    : notificationTone === 'warning'
                      ? 'hover:bg-amber-100 text-amber-700'
                      : 'hover:bg-emerald-100 text-emerald-700'
                }`}
                title="閉じる"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-4 py-3 text-xs text-gray-700 space-y-3">
              {autoApprovalNotifications.map((notice) => {
                const completed = notice.kind === 'auto_approval_completed'
                const permission = notice.kind === 'overtime_threshold_permission'
                return (
                  <div
                    key={notice.id || notice.createdAt}
                    className={`border rounded-lg p-3 ${
                      completed
                        ? 'border-emerald-200 bg-emerald-50/40'
                        : permission
                          ? 'border-amber-200 bg-amber-50/40'
                          : 'border-red-200 bg-red-50/40'
                    }`}
                  >
                    <div className="font-semibold text-gray-800">{notice.title || notice.requestTypeLabel}</div>
                    <div className="mt-1 text-gray-500">{notice.message}</div>
                    <div className="mt-2 space-y-2">
                      {permission ? (
                        groupPermissionItems(notice.items || []).map((group) => {
                          const pendingKey = `${String(notice.id)}:${group.personKey}`
                          const applicantLabel =
                            group.applicantName || (group.applicantId != null ? `ID:${group.applicantId}` : '申請者未設定')
                          return (
                            <div key={group.personKey} className="p-2 bg-white rounded border border-amber-100">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="font-semibold text-gray-800">{applicantLabel}</span>
                                    {group.applicantId != null && (
                                      <span className="text-[10px] text-gray-400">ID:{group.applicantId}</span>
                                    )}
                                    <span className="text-[10px] text-amber-700">{group.items.length}件</span>
                                  </div>
                                </div>
                                <button
                                  onClick={() => approveAutoApprovalNotification(String(notice.id), { applicantKey: group.personKey })}
                                  disabled={approvingNotificationId === pendingKey}
                                  className="px-3 py-1.5 bg-amber-500 text-white rounded-lg text-xs font-bold hover:bg-amber-600 disabled:opacity-50 transition-colors"
                                >
                                  {approvingNotificationId === pendingKey ? '承認中...' : 'この人を許可して承認'}
                                </button>
                              </div>
                              <div className="mt-2 space-y-2">
                                {group.items.map((item: any) => (
                                  <div key={item.key || item.requestId} className="rounded border border-gray-100 bg-gray-50 p-2">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                      <span className="font-mono text-[11px] text-gray-500">
                                        申請No. {item.applicationNumber ?? item.requestId}
                                      </span>
                                    </div>
                                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                                      <div>対象日: {formatNoticeDate(item.targetDate)}</div>
                                      {(item.startAt || item.endAt) && <div>時間: {formatNoticeTime(item)}</div>}
                                      {(item.holidayType || item.usageType) && (
                                        <div>取得単位: {[item.holidayType, item.usageType].filter(Boolean).join(' / ')}</div>
                                      )}
                                      <div>申請日: {formatNoticeDate(item.issueDate)}</div>
                                      <div className="sm:col-span-2">申請経路: {item.routeName || item.routeId || '未設定'}</div>
                                      <div className="sm:col-span-2 font-semibold text-amber-800">
                                        残業合計: {item.totalOvertimeText || formatNoticeMinutes(item.totalOvertimeMins)}
                                        {item.thresholdHours ? ` / ${item.thresholdHours}時間超過` : ''}
                                      </div>
                                      <div className="sm:col-span-2">コメント: {item.comment || '—'}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })
                      ) : (
                        (notice.items || []).map((item: any) => (
                          <div key={item.key || item.requestId} className="p-2 bg-white rounded border border-gray-100">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span className="font-mono text-[11px] text-gray-500">
                                申請No. {item.applicationNumber ?? item.requestId}
                              </span>
                              <span className="font-semibold text-gray-800">
                                {item.applicantName || (item.applicantId ? `ID:${item.applicantId}` : '')}
                              </span>
                              {item.applicantId != null && (
                                <span className="text-[10px] text-gray-400">ID:{item.applicantId}</span>
                              )}
                            </div>
                            {completed ? (
                              <div className="mt-2 grid gap-1 sm:grid-cols-2">
                                <div>対象日: {formatNoticeDate(item.targetDate)}</div>
                                {(item.startAt || item.endAt) && <div>時間: {formatNoticeTime(item)}</div>}
                                {(item.holidayType || item.usageType) && (
                                  <div>取得単位: {[item.holidayType, item.usageType].filter(Boolean).join(' / ')}</div>
                                )}
                                <div>申請日: {formatNoticeDate(item.issueDate)}</div>
                                <div className="sm:col-span-2">申請経路: {item.routeName || item.routeId || '未設定'}</div>
                                <div className="sm:col-span-2">コメント: {item.comment || '—'}</div>
                              </div>
                            ) : (
                              <div className="mt-1">現在の経路: {item.routeName || item.routeId || '未設定'}</div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={clearAutoApprovalNotifications}
                className="px-3 py-1.5 bg-[#007B7E] text-white rounded-lg text-xs font-bold hover:bg-[#006669] transition-colors"
              >
                確認
              </button>
            </div>
          </div>
        </div>
      )}
      {/* タブヘッダー */}
      <div className="flex items-center bg-white border-b border-gray-200 px-3 shrink-0">
        {(Object.keys(TAB_LABELS) as MainView[]).map(tab => (
          <button
            key={tab}
            onClick={() => setView(tab)}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors mr-1 ${
              view === tab
                ? 'border-[#007B7E] text-[#007B7E]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        {isManager && (
          <button
            onClick={() => setView('manager-overtime')}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors mr-1 ${
              view === 'manager-overtime'
                ? 'border-[#007B7E] text-[#007B7E]'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            残業状況
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={openSettings}
          className="p-2 text-gray-500 hover:text-[#007B7E] hover:bg-[#007b7e15] rounded-full transition-colors"
        >
          <SettingsIcon size={20} />
        </button>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-hidden">
        {view === 'overtime' && <Dashboard />}
        {view === 'paid-leave' && <PaidLeave />}
        {view === 'monthly-close' && <MonthlyClose />}
        {view === 'approvals' && <Approvals />}
        {view === 'manager-overtime' && <ManagerOvertime />}
      </div>
    </div>
  )
}

export default App
