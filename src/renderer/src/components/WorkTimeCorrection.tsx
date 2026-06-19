import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle, Clock, Plus, Send, Trash2, X } from 'lucide-react'
import { Route, useFreee } from '../hooks/useFreee'
import { DEPARTMENTS } from '../utils/departments'

const TIME_OPTIONS = Array.from({ length: 96 }, (_, index) => {
  const totalMinutes = index * 30
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
})

function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return y && m && d ? `${y}/${m}/${d}` : dateStr
}

function minutesValue(value: string): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

type TimeRange = {
  id: number
  start: string
  end: string
}

let rangeId = 1

function TimeSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="relative">
      <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-9 p-3 border border-gray-300 rounded-xl appearance-none focus:ring-2 focus:ring-[#007B7E] outline-none bg-white text-sm"
      >
        {TIME_OPTIONS.map((time) => (
          <option key={time} value={time}>
            {time}
          </option>
        ))}
      </select>
    </div>
  )
}

export function WorkTimeCorrection() {
  const { fetchRoutes, loading } = useFreee()
  const [companyId, setCompanyId] = useState(0)
  const [applicantId, setApplicantId] = useState(0)
  const [targetDate, setTargetDate] = useState(() => dateToStr(new Date()))
  const [clockIn, setClockIn] = useState('09:00')
  const [clockOut, setClockOut] = useState('18:00')
  const [breaks, setBreaks] = useState<TimeRange[]>([
    { id: rangeId++, start: '12:00', end: '13:00' },
  ])
  const [latenessMins, setLatenessMins] = useState('')
  const [earlyLeavingMins, setEarlyLeavingMins] = useState('')
  const [comment, setComment] = useState('')
  const [routes, setRoutes] = useState<Route[]>([])
  const [selectedRouteId, setSelectedRouteId] = useState(0)
  const [hasToken, setHasToken] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  const selectedRoute = routes.find((route) => route.id === selectedRouteId)
  const isIncompatibleRoute =
    selectedRoute?.definition_type === 'department' || selectedRoute?.definition_type === 'position'
  const isCommentEmpty = !comment.trim()

  useEffect(() => {
    async function init(): Promise<void> {
      let cId = 0
      try {
        const info = await window.api.getUserInfo()
        cId = info.companyId
        setCompanyId(info.companyId)
        setApplicantId(info.applicantId)
      } catch {
        // 認証前は下の fetchError で案内する
      }

      const [lastRoute, lastComment, lastClockIn, lastClockOut, tokenResult] = await Promise.all([
        window.api.storeGet('LAST_WORK_TIME_ROUTE_ID'),
        window.api.storeGet('LAST_WORK_TIME_COMMENT'),
        window.api.storeGet('LAST_WORK_TIME_CLOCK_IN'),
        window.api.storeGet('LAST_WORK_TIME_CLOCK_OUT'),
        window.api.getValidToken(),
      ])
      if (lastComment) setComment(String(lastComment))
      if (lastClockIn && TIME_OPTIONS.includes(String(lastClockIn))) setClockIn(String(lastClockIn))
      if (lastClockOut && TIME_OPTIONS.includes(String(lastClockOut))) setClockOut(String(lastClockOut))

      if (tokenResult.success && cId) {
        try {
          const routeData = await fetchRoutes(cId)
          setRoutes(routeData)
          if (lastRoute && routeData.some((route) => route.id === lastRoute)) {
            setSelectedRouteId(lastRoute)
          } else if (routeData.length > 0) {
            setSelectedRouteId(routeData[0].id)
          }
        } catch {
          setFetchError('経路の取得に失敗しました。設定を確認してください。')
        }
      } else if (tokenResult.authRequired) {
        setFetchError(tokenResult.message || '認証が必要です。設定画面からOAuth認証を行ってください。')
      } else if (!cId) {
        setFetchError('初期設定が完了していません。右上の設定画面から入力してください。')
      }

      const status = await window.api.getTokenStatus()
      setHasToken(status.hasToken)
    }
    init()
  }, [fetchRoutes])

  const addBreak = (): void => {
    setBreaks((prev) => [...prev, { id: rangeId++, start: '15:00', end: '15:15' }])
  }

  const removeBreak = (id: number): void => {
    setBreaks((prev) => prev.filter((item) => item.id !== id))
  }

  const updateBreak = (id: number, key: 'start' | 'end', value: string): void => {
    setBreaks((prev) => prev.map((item) => (item.id === id ? { ...item, [key]: value } : item)))
  }

  const breakRecords = useMemo(
    () => breaks.map((item) => ({ clockInAt: item.start, clockOutAt: item.end })),
    [breaks],
  )

  const handleSubmit = async (): Promise<void> => {
    if (!companyId || !applicantId || !selectedRouteId) return
    setSubmitting(true)
    setSubmitError(null)
    setSuccess(false)

    try {
      const defaultDeptId = await window.api.storeGet('DEFAULT_DEPARTMENT_ID')
      const deptId = defaultDeptId ? Number(defaultDeptId) : undefined
      const departmentName = deptId ? DEPARTMENTS.find((dept) => dept.id === deptId)?.name : undefined
      await window.api.submitWorkTime({
        companyId,
        applicantId,
        targetDate,
        routeId: selectedRouteId,
        routeName: selectedRoute?.name || '',
        departmentId: deptId,
        departmentName,
        comment,
        workRecords: [{ clockInAt: clockIn, clockOutAt: clockOut }],
        breakRecords,
        latenessMins: minutesValue(latenessMins),
        earlyLeavingMins: minutesValue(earlyLeavingMins),
      })
      await Promise.all([
        window.api.storeSet('LAST_WORK_TIME_ROUTE_ID', selectedRouteId),
        window.api.storeSet('LAST_WORK_TIME_COMMENT', comment),
        window.api.storeSet('LAST_WORK_TIME_CLOCK_IN', clockIn),
        window.api.storeSet('LAST_WORK_TIME_CLOCK_OUT', clockOut),
      ])
      setSuccess(true)
      setTimeout(() => setSuccess(false), 5000)
    } catch (err) {
      const message = err instanceof Error ? err.message : '勤怠時間修正申請に失敗しました。'
      setSubmitError(message)
    } finally {
      setSubmitting(false)
    }
  }

  const isConfigured = companyId && applicantId && hasToken

  return (
    <div className="px-6 pt-4 pb-6 max-w-md mx-auto h-full flex flex-col">
      <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex-1 overflow-y-auto">
        {fetchError && (
          <div className="mb-4 bg-amber-50 text-amber-800 p-3 rounded-xl text-sm border border-amber-200">
            {fetchError}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">申請対象日</label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#007B7E] outline-none bg-white text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">修正後の勤務時間</label>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <TimeSelect value={clockIn} onChange={setClockIn} />
              </div>
              <span className="text-gray-400 text-sm shrink-0">〜</span>
              <div className="flex-1">
                <TimeSelect value={clockOut} onChange={setClockOut} />
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-gray-700">休憩時間</label>
              <button
                type="button"
                onClick={addBreak}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-[#007B7E] border border-[#007B7E] rounded-lg hover:bg-[#007b7e10]"
              >
                <Plus size={12} />
                追加
              </button>
            </div>
            <div className="space-y-2">
              {breaks.length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-400 bg-gray-50 rounded-xl border border-gray-200">
                  休憩なし
                </div>
              )}
              {breaks.map((item, index) => (
                <div key={item.id} className="flex items-center gap-2">
                  <span className="w-10 text-xs text-gray-500 shrink-0">休憩{index + 1}</span>
                  <div className="flex-1">
                    <TimeSelect value={item.start} onChange={(value) => updateBreak(item.id, 'start', value)} />
                  </div>
                  <span className="text-gray-400 text-sm shrink-0">〜</span>
                  <div className="flex-1">
                    <TimeSelect value={item.end} onChange={(value) => updateBreak(item.id, 'end', value)} />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeBreak(item.id)}
                    className="shrink-0 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
                    title="削除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">遅刻分</label>
              <input
                type="number"
                min={0}
                value={latenessMins}
                onChange={(e) => setLatenessMins(e.target.value)}
                placeholder="0"
                className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#007B7E] outline-none bg-white text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">早退分</label>
              <input
                type="number"
                min={0}
                value={earlyLeavingMins}
                onChange={(e) => setEarlyLeavingMins(e.target.value)}
                placeholder="0"
                className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#007B7E] outline-none bg-white text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              修正理由（コメント）<span className="text-red-500 ml-0.5">*</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="修正理由を入力してください（必須）"
              rows={2}
              className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#007B7E] focus:border-[#007B7E] outline-none resize-none text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">申請経路</label>
            <select
              value={selectedRouteId}
              onChange={(e) => setSelectedRouteId(Number(e.target.value))}
              disabled={routes.length === 0}
              className={`w-full p-3 border rounded-xl focus:ring-2 focus:ring-[#007B7E] outline-none bg-white disabled:bg-gray-50 text-sm transition-all duration-300 ${
                isIncompatibleRoute ? 'border-amber-400' : 'border-gray-300'
              }`}
            >
              <option value={0} disabled>経路を選択してください</option>
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name}
                  {route.definition_type === 'department' || route.definition_type === 'position'
                    ? ' (API制限の可能性)'
                    : ''}
                </option>
              ))}
            </select>
          </div>

          {isIncompatibleRoute && (
            <div className="bg-amber-50 text-amber-800 p-3 rounded-xl text-sm border border-amber-200 flex items-start gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>この経路はAPI申請に失敗する場合があります。</span>
            </div>
          )}

          {submitError && !success && (
            <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm border border-red-200 break-words flex items-start gap-2">
              <span className="flex-1"><strong>エラー:</strong> {submitError}</span>
              <button
                type="button"
                onClick={() => setSubmitError(null)}
                className="shrink-0 p-0.5 hover:bg-red-100 rounded transition-colors"
                title="閉じる"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {success && (
            <div className="bg-emerald-50 text-emerald-700 p-4 rounded-2xl text-sm border border-emerald-100 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500 shadow-sm">
              <div className="bg-emerald-500 p-1 rounded-full text-white">
                <CheckCircle size={14} strokeWidth={3} />
              </div>
              <span className="font-semibold">{formatDisplayDate(targetDate)} の勤怠時間修正申請が完了しました。</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        <button
          onClick={handleSubmit}
          disabled={loading || submitting || !isConfigured || !selectedRouteId || isCommentEmpty}
          className="w-full bg-[#007B7E] hover:bg-[#006669] text-white disabled:bg-gray-300 disabled:cursor-not-allowed p-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98]"
        >
          {submitting || loading ? (
            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <Send size={18} />
              <span>勤怠時間修正を申請する</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
