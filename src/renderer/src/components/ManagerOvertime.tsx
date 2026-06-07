import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, ShieldCheck, Users } from 'lucide-react'

const NOTICE_THRESHOLD_HOUR_OPTIONS = Array.from({ length: 11 }, (_, index) => 30 + index * 5)
const DEFAULT_NOTICE_THRESHOLD_HOURS = [30, 65]

function formatMinutes(value?: number): string {
  const mins = Math.max(0, Math.round(Number(value || 0)))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}時間${m > 0 ? ` ${m}分` : ''}`
}

function formatDays(value?: number): string {
  const n = Number(value || 0)
  return `${Number.isInteger(n) ? n : n.toFixed(1)}日`
}

function monthLabel(year: number, month: number): string {
  return `${year}年${month}月`
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export function ManagerOvertime() {
  const now = new Date()
  const initialMonth = shiftMonth(now.getFullYear(), now.getMonth() + 1, -1)
  const [year, setYear] = useState(initialMonth.year)
  const [month, setMonth] = useState(initialMonth.month)
  const [noticeThresholdHours, setNoticeThresholdHours] = useState<number[]>(DEFAULT_NOTICE_THRESHOLD_HOURS)
  const [overOnly, setOverOnly] = useState(true)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ManagerOvertimeSummaryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selectedNoticeThresholdHours = useMemo(
    () => [...noticeThresholdHours].sort((a, b) => a - b),
    [noticeThresholdHours],
  )
  const minNoticeThresholdMins = Math.min(...selectedNoticeThresholdHours) * 60
  const noticeThresholdLabel = selectedNoticeThresholdHours.map((hour) => `${hour}時間`).join(' / ')

  const load = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.fetchManagerOvertimeSummaries({
        year,
        month,
        thresholdMins: minNoticeThresholdMins,
      })
      setData(result)
    } catch (e: any) {
      setError(e?.message || '残業状況を取得できませんでした。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, minNoticeThresholdMins])

  const readableItems = data?.items.filter((item) => item.canReadSummary) || []
  const overtimeMinutesOf = (item: ManagerOvertimeSummaryItem): number => Number(item.overtimeMins || 0)
  const hitNoticeThresholds = (item: ManagerOvertimeSummaryItem): number[] => {
    const overtime = overtimeMinutesOf(item)
    return selectedNoticeThresholdHours.filter((hour) => overtime >= hour * 60)
  }
  const visibleItems = useMemo(() => {
    const items = [...readableItems].sort((a, b) => overtimeMinutesOf(b) - overtimeMinutesOf(a))
    return overOnly ? items.filter((item) => hitNoticeThresholds(item).length > 0) : items
  }, [readableItems, overOnly, selectedNoticeThresholdHours])
  const unreadableCount = data?.items.filter((item) => !item.canReadSummary).length || 0
  const overCount = readableItems.filter((item) => hitNoticeThresholds(item).length > 0).length
  const maxOvertime = readableItems.reduce((max, item) => Math.max(max, overtimeMinutesOf(item)), 0)

  const moveMonth = (delta: number): void => {
    const next = shiftMonth(year, month, delta)
    setYear(next.year)
    setMonth(next.month)
  }

  const toggleNoticeThresholdHour = (hour: number): void => {
    setNoticeThresholdHours((prev) => {
      if (prev.includes(hour)) {
        return prev.length > 1 ? prev.filter((value) => value !== hour) : prev
      }
      return [...prev, hour].sort((a, b) => a - b)
    })
  }

  return (
    <div className="h-full overflow-auto bg-[#f7f9fa]">
      <div className="border-b border-gray-200 bg-white">
        <div className="px-6 py-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-[260px] flex-1">
            <div className="flex items-center gap-2 text-[#0f172a]">
              <Users size={20} className="text-[#007B7E]" />
              <h1 className="text-xl font-bold">残業状況</h1>
            </div>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">
              Manager権限で取得できる月次勤怠を一覧表示します。
            </p>
          </div>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-[#007B7E] bg-white px-3 text-sm font-semibold text-[#007B7E] hover:bg-[#eefafa] disabled:opacity-50"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              更新
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex h-10 items-center rounded-md border border-gray-300 bg-white">
              <button
                type="button"
                onClick={() => moveMonth(-1)}
                className="inline-flex h-full w-10 items-center justify-center rounded-l-md text-gray-600 hover:bg-gray-50"
                title="前月"
              >
                <ChevronLeft size={17} />
              </button>
              <div className="inline-flex h-full min-w-[130px] items-center justify-center border-x border-gray-300 px-4 text-sm font-semibold text-gray-800">
                {monthLabel(year, month)}
              </div>
              <button
                type="button"
                onClick={() => moveMonth(1)}
                className="inline-flex h-full w-10 items-center justify-center rounded-r-md text-gray-600 hover:bg-gray-50"
                title="翌月"
              >
                <ChevronRight size={17} />
              </button>
            </div>

            <div className="flex min-h-10 min-w-[360px] flex-1 flex-wrap items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700">
              <span className="shrink-0 font-semibold text-gray-700">通知する時間外労働</span>
            {NOTICE_THRESHOLD_HOUR_OPTIONS.map((hour) => {
              const checked = noticeThresholdHours.includes(hour)
              return (
                <label
                  key={hour}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs cursor-pointer ${
                    checked
                      ? 'border-[#007B7E] bg-[#e9f7f7] text-[#007B7E]'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleNoticeThresholdHour(hour)}
                    className="h-3 w-3 accent-[#007B7E]"
                  />
                  {hour}時間
                </label>
              )
            })}
              <span className="shrink-0 text-xs text-gray-400">選択中: {noticeThresholdLabel}</span>
            </div>

            <button
              type="button"
              onClick={() => setOverOnly((v) => !v)}
              className={`h-10 shrink-0 rounded-md border px-4 text-sm font-semibold transition-colors ${
                overOnly
                  ? 'border-[#007B7E] bg-[#e9f7f7] text-[#007B7E]'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              通知対象のみ
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        {error && (
          <div className="border border-red-200 bg-red-50 rounded-md p-4 text-sm text-red-800 flex gap-3">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {data && !data.manager && (
          <div className="border border-amber-200 bg-amber-50 rounded-md p-4 text-sm text-amber-800 flex gap-3">
            <ShieldCheck size={18} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Manager権限ではありません</div>
              <div className="mt-1">現在のロール: {data.userInfo?.role || '不明'}</div>
            </div>
          </div>
        )}

        {data?.manager && data.error && (
          <div className="border border-amber-200 bg-amber-50 rounded-md p-4 text-sm text-amber-900 flex gap-3">
            <AlertTriangle size={18} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Managerロールは検出しましたが、他の人の勤怠集計を取得できませんでした。</div>
              <div className="mt-1">現在のロール: {data.userInfo?.role || '不明'}</div>
              <div className="mt-1">API応答: {data.error.status || '-'} / {data.error.message}</div>
              <div className="mt-2 text-xs text-amber-800">
                ロール判定はログイン情報から可能ですが、実際の閲覧可否はfreee APIの権限と連携アプリの許可範囲で最終判定されます。
              </div>
            </div>
          </div>
        )}

        {data?.manager && !data.error && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white border border-gray-200 rounded-md p-3">
                <div className="text-xs text-gray-500">取得人数</div>
                <div className="mt-1 text-xl font-bold text-gray-900">{readableItems.length}人</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-md p-3">
                <div className="text-xs text-gray-500">通知対象者</div>
                <div className="mt-1 text-xl font-bold text-red-700">{overCount}人</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-md p-3">
                <div className="text-xs text-gray-500">最大時間外労働</div>
                <div className="mt-1 text-xl font-bold text-gray-900">{formatMinutes(maxOvertime)}</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-md p-3">
                <div className="text-xs text-gray-500">読取不可</div>
                <div className="mt-1 text-xl font-bold text-gray-900">{unreadableCount}人</div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-[1180px] w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">従業員</th>
                      <th className="px-3 py-2 text-right font-semibold">労働日数</th>
                      <th className="px-3 py-2 text-right font-semibold">総勤務時間</th>
                      <th className="px-3 py-2 text-right font-semibold">所定内労働</th>
                      <th className="px-3 py-2 text-right font-semibold">法定内残業</th>
                      <th className="px-3 py-2 text-right font-semibold">時間外労働</th>
                      <th className="px-3 py-2 text-right font-semibold">法定休日労働</th>
                      <th className="px-3 py-2 text-right font-semibold">深夜労働</th>
                      <th className="px-3 py-2 text-right font-semibold">欠勤</th>
                      <th className="px-3 py-2 text-right font-semibold">有休取得</th>
                      <th className="px-3 py-2 text-right font-semibold">有休残</th>
                      <th className="px-3 py-2 text-right font-semibold">遅刻早退</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loading && visibleItems.length === 0 && (
                      <tr>
                        <td colSpan={12} className="px-4 py-8 text-center text-gray-500">読み込み中...</td>
                      </tr>
                    )}
                    {!loading && visibleItems.length === 0 && (
                      <tr>
                        <td colSpan={12} className="px-4 py-8 text-center text-gray-500">
                          {overOnly ? '通知対象の従業員はいません。' : '表示できる勤怠集計がありません。'}
                        </td>
                      </tr>
                    )}
                    {visibleItems.map((item) => {
                      const hitHours = hitNoticeThresholds(item)
                      const isNoticeTarget = hitHours.length > 0
                      return (
                        <tr key={item.employeeId} className={isNoticeTarget ? 'bg-red-50/70' : 'hover:bg-gray-50'}>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <div className="font-semibold text-gray-900">{item.employeeName}</div>
                            <div className="text-xs text-gray-400">ID:{item.employeeId}{item.employeeNumber ? ` / ${item.employeeNumber}` : ''}</div>
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{formatDays(item.workDays)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{formatMinutes(item.totalWorkMins)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{formatMinutes(item.normalWorkMins)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{formatMinutes(item.legalOvertimeMins)}</td>
                          <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${isNoticeTarget ? 'text-red-700' : 'text-gray-900'}`}>
                            {formatMinutes(item.overtimeMins)}
                            {isNoticeTarget && (
                              <div className="mt-0.5 text-[10px] font-semibold text-red-600">
                                通知: {hitHours.map((hour) => `${hour}時間`).join(' / ')}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{formatMinutes(item.holidayWorkMins)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{formatMinutes(item.latenightWorkMins)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{formatDays(item.absenceDays)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{formatDays(item.paidHolidays)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{formatDays(item.paidHolidaysLeft)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{formatMinutes(item.latenessEarlyLeavingMins)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
