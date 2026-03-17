import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Download } from 'lucide-react'
import { Dashboard } from './components/Dashboard'
import { PaidLeave } from './components/PaidLeave'
import { MyRequests } from './components/MyRequests'
import { Settings } from './components/Settings'
import { MonthlyClose } from './components/MonthlyClose'

type MainView = 'overtime' | 'paid-leave' | 'monthly-close' | 'my-requests'

const TAB_LABELS: Record<MainView, string> = {
  'overtime': '残業申請',
  'paid-leave': '有給申請',
  'monthly-close': '月次締め',
  'my-requests': '申請確認',
}

function App() {
  const [view, setView] = useState<MainView | 'settings'>('overtime')
  const [prevView, setPrevView] = useState<MainView>('overtime')
  const [updateInfo, setUpdateInfo] = useState<{ version: string; downloaded: boolean } | null>(null)

  useEffect(() => {
    window.api.onUpdateAvailable((version) => setUpdateInfo({ version, downloaded: false }))
    window.api.onUpdateDownloaded((version) => setUpdateInfo({ version, downloaded: true }))
  }, [])

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
        {view === 'my-requests' && <MyRequests />}
      </div>
    </div>
  )
}

export default App
