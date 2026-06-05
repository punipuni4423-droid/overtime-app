import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Download, AlertTriangle, X } from 'lucide-react'
import { Dashboard } from './components/Dashboard'
import { PaidLeave } from './components/PaidLeave'
import { Approvals } from './components/Approvals'
import { Settings } from './components/Settings'
import { MonthlyClose } from './components/MonthlyClose'
// import { TimeClock } from './components/TimeClock'  // v1.0.8 以降で有効化

type MainView = 'overtime' | 'paid-leave' | 'monthly-close' | 'approvals'

const TAB_LABELS: Record<MainView, string> = {
  'overtime': '残業申請',
  'paid-leave': '有給申請',
  'monthly-close': '月次締め',
  'approvals': '申請・承認',
}

function App() {
  const [view, setView] = useState<MainView | 'settings'>('overtime')
  const [prevView, setPrevView] = useState<MainView>('overtime')
  const [updateInfo, setUpdateInfo] = useState<{ version: string; downloaded: boolean } | null>(null)
  const [autoApprovalNotifications, setAutoApprovalNotifications] = useState<any[]>([])

  useEffect(() => {
    window.api.onUpdateAvailable((version) => setUpdateInfo({ version, downloaded: false }))
    window.api.onUpdateDownloaded((version) => setUpdateInfo({ version, downloaded: true }))
  }, [])

  useEffect(() => {
    window.api
      .getUserInfo()
      .then((info) => window.api.fetchRoutes(info.companyId))
      .catch(() => {
        // 認証前の起動では取得できないため、設定画面や申請画面で再取得する
      })
  }, [])

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

  const openSettings = () => {
    setPrevView((view === 'settings' ? prevView : view) as MainView)
    setView('settings')
  }

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
          <div className="w-full max-w-xl bg-white border border-red-200 rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-start gap-3 px-4 py-3 bg-red-50 border-b border-red-100">
              <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-red-800">自動承認エラー</div>
                <div className="text-xs text-red-700 mt-0.5">
                  承認経路が一致しない申請があるため、自動承認を停止しました。
                </div>
              </div>
              <button
                onClick={clearAutoApprovalNotifications}
                className="p-1 rounded hover:bg-red-100 text-red-700"
                title="閉じる"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto px-4 py-3 text-xs text-gray-700 space-y-3">
              {autoApprovalNotifications.map((notice) => (
                <div key={notice.id || notice.createdAt} className="border border-gray-200 rounded-lg p-3">
                  <div className="font-semibold text-gray-800">{notice.title || notice.requestTypeLabel}</div>
                  <div className="mt-1 text-gray-500">{notice.message}</div>
                  {(notice.items || []).map((item: any) => (
                    <div key={item.key || item.requestId} className="mt-2 p-2 bg-gray-50 rounded border border-gray-100">
                      <div>申請No. {item.applicationNumber ?? item.requestId}</div>
                      <div className="mt-0.5">現在の経路: {item.routeName || item.routeId || '未設定'}</div>
                    </div>
                  ))}
                </div>
              ))}
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
      </div>
    </div>
  )
}

export default App
