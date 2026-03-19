import { useState, useEffect, useCallback, useMemo } from 'react'
import { CheckCircle, ChevronLeft, ChevronRight, AlertTriangle, Clock, RefreshCw, LogIn, Plus, X } from 'lucide-react'
import { isJapaneseHoliday } from '../utils/holidays'

// ─── 定数 ───────────────────────────────────────────────────────
// 30分刻みの時刻選択肢
const TIME_OPTIONS: string[] = []
for (let h = 0; h < 24; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:00`)
  TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:30`)
}

// ─── ユーティリティ ──────────────────────────────────────────────
function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  const dow = ['日', '月', '火', '水', '木', '金', '土']
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return `${y}/${m}/${d}（${dow[date.getDay()]}）`
}

function formatTimeDisplay(isoStr: string): string {
  const d = new Date(isoStr)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ─── 時刻セレクト ────────────────────────────────────────────────
function TimeSelect({
  value,
  onChange,
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  return (
    <div className={`relative ${className}`}>
      <Clock size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full pl-7 pr-2 py-2 border border-gray-300 rounded-lg appearance-none bg-white text-sm focus:outline-none focus:ring-1 focus:ring-[#007B7E] focus:border-[#007B7E]"
      >
        {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  )
}

// ─── カレンダー（日曜始まり・祝日対応・単日選択） ────────────────────
function SingleDateCalendar({
  selectedDate,
  onChange,
}: {
  selectedDate: string
  onChange: (dateStr: string) => void
}) {
  const today = new Date()
  const [viewYear, setViewYear] = useState(() => new Date(selectedDate).getFullYear())
  const [viewMonth, setViewMonth] = useState(() => new Date(selectedDate).getMonth())

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const firstDay = new Date(viewYear, viewMonth, 1)
  const lastDay = new Date(viewYear, viewMonth + 1, 0)
  const startOffset = firstDay.getDay() // 0=日曜始まり
  const rows = Math.ceil((startOffset + lastDay.getDate()) / 7)
  const todayStr = dateToStr(today)

  const holidaySet = useMemo(() => {
    const s = new Set<string>()
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const ds = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (isJapaneseHoliday(ds)) s.add(ds)
    }
    return s
  }, [viewYear, viewMonth, lastDay])

  const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden select-none">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
        <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-200 transition-colors">
          <ChevronLeft size={14} />
        </button>
        <span className="text-sm font-bold text-gray-700">{viewYear}年 {viewMonth + 1}月</span>
        <button onClick={nextMonth} className="p-1 rounded hover:bg-gray-200 transition-colors">
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-7 border-b border-gray-100">
        {DOW_LABELS.map((d, i) => (
          <div key={d} className={`text-center text-[11px] py-1 font-semibold ${
            i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-500'
          }`}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {Array.from({ length: rows * 7 }).map((_, idx) => {
          const dayNum = idx - startOffset + 1
          if (dayNum < 1 || dayNum > lastDay.getDate()) return <div key={idx} className="aspect-square" />
          const mm = String(viewMonth + 1).padStart(2, '0')
          const dd = String(dayNum).padStart(2, '0')
          const dateStr = `${viewYear}-${mm}-${dd}`
          const isSelected = dateStr === selectedDate
          const isToday = dateStr === todayStr
          const dow = idx % 7
          const isHoliday = holidaySet.has(dateStr)

          const textColor = isSelected ? 'text-white'
            : (dow === 0 || isHoliday) ? 'text-red-500'
            : dow === 6 ? 'text-blue-500'
            : 'text-gray-700'

          return (
            <button
              key={idx}
              onClick={() => onChange(dateStr)}
              className={`
                aspect-square flex items-center justify-center text-[12px] font-medium transition-colors relative
                ${isSelected ? 'bg-[#007B7E] font-bold'
                  : isToday ? 'bg-[#e0f7f7] hover:bg-[#c0efef]'
                  : 'hover:bg-gray-100'}
                ${textColor}
              `}
              title={isHoliday ? '祝日' : undefined}
            >
              {dayNum}
              {isToday && !isSelected && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#007B7E]" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── メインコンポーネント ────────────────────────────────────────
interface BreakPeriod {
  id: number
  start: string
  end: string
}

let breakIdCounter = 1

export function TimeClock() {
  const [companyId, setCompanyId] = useState(0)
  const [employeeId, setEmployeeId] = useState(0)

  const today = dateToStr(new Date())
  const [selectedDate, setSelectedDate] = useState(today)

  // 勤務時間
  const [clockIn, setClockIn] = useState('09:00')
  const [clockOut, setClockOut] = useState('18:00')
  // 休憩時間（複数対応）
  const [breaks, setBreaks] = useState<BreakPeriod[]>([
    { id: breakIdCounter++, start: '12:00', end: '13:00' }
  ])

  // 本日の打刻履歴
  const [todayClocks, setTodayClocks] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const isToday = selectedDate === today

  const loadTodayClocks = useCallback(async (cId: number, eId: number) => {
    if (!cId || !eId) return
    setLoadingHistory(true)
    try {
      const data = await (window.api as any).fetchTimeClocks({
        companyId: cId, employeeId: eId, fromDate: today, toDate: today,
      })
      const records = Array.isArray(data) ? data : []
      setTodayClocks(records.sort((a: any, b: any) => a.datetime.localeCompare(b.datetime)))
    } catch (e: any) {
      console.warn('[TimeClock] history fetch failed:', e.message)
    } finally {
      setLoadingHistory(false)
    }
  }, [today])

  useEffect(() => {
    async function init() {
      try {
        const info = await window.api.getUserInfo()
        const cId = info.companyId
        const eId = info.employeeId
        setCompanyId(cId)
        setEmployeeId(eId)
        if (!cId || !eId) {
          setFetchError('初期設定が完了していません。設定画面から入力してください。')
          return
        }
        await loadTodayClocks(cId, eId)
      } catch {
        setFetchError('ユーザー情報の取得に失敗しました。認証を確認してください。')
      }
    }
    init()
  }, [loadTodayClocks])

  // 休憩の追加・削除
  const addBreak = () => {
    setBreaks(prev => [...prev, { id: breakIdCounter++, start: '15:00', end: '15:15' }])
  }
  const removeBreak = (id: number) => {
    setBreaks(prev => prev.filter(b => b.id !== id))
  }
  const updateBreak = (id: number, field: 'start' | 'end', value: string) => {
    setBreaks(prev => prev.map(b => b.id === id ? { ...b, [field]: value } : b))
  }

  const handleSubmit = async () => {
    if (!companyId || !employeeId) return
    setSubmitting(true)
    setError(null)
    setSuccess(false)

    try {
      await (window.api as any).submitTimeClockWeb({
        companyId,
        employeeId,
        targetDate: selectedDate,
        clockIn,
        clockOut,
        breaks: breaks.map(b => ({ start: b.start, end: b.end })),
      })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 8000)
      await loadTodayClocks(companyId, employeeId)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const isConfigured = companyId > 0 && employeeId > 0

  const CLOCK_TYPE_LABELS: Record<string, string> = {
    clock_in: '出勤', break_begin: '休憩開始', break_end: '休憩終了', clock_out: '退勤',
  }
  const clockTypeColors: Record<string, string> = {
    clock_in: 'bg-emerald-100 text-emerald-700',
    break_begin: 'bg-amber-100 text-amber-700',
    break_end: 'bg-blue-100 text-blue-700',
    clock_out: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {fetchError && (
        <div className="mx-4 mt-3 bg-amber-50 text-amber-800 p-3 rounded-xl text-sm border border-amber-200">
          {fetchError}
        </div>
      )}

      <div className="flex-1 flex gap-4 px-4 py-3 overflow-hidden">
        {/* ─── 左列: カレンダー ─── */}
        <div className="w-[275px] shrink-0 flex flex-col gap-3">
          <SingleDateCalendar selectedDate={selectedDate} onChange={setSelectedDate} />

          {/* 選択日ラベル */}
          <div className={`text-center text-sm font-semibold py-2 rounded-xl border ${
            isToday
              ? 'text-[#007B7E] bg-[#f0fafa] border-[#c0efef]'
              : 'text-amber-700 bg-amber-50 border-amber-200'
          }`}>
            {formatDateLabel(selectedDate)}
            {!isToday && <span className="block text-xs font-normal mt-0.5">過去日付の打刻修正</span>}
          </div>

          {/* 本日の打刻履歴 */}
          <div className="bg-white border border-gray-200 rounded-xl p-3 flex-1 overflow-y-auto min-h-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-600">本日の打刻履歴</span>
              <button
                onClick={() => loadTodayClocks(companyId, employeeId)}
                disabled={loadingHistory}
                className="p-0.5 text-gray-400 hover:text-[#007B7E] transition-colors"
              >
                <RefreshCw size={12} className={loadingHistory ? 'animate-spin' : ''} />
              </button>
            </div>
            {loadingHistory ? (
              <p className="text-xs text-gray-400 text-center py-2">読み込み中...</p>
            ) : todayClocks.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-3">本日の打刻はありません</p>
            ) : (
              <div className="space-y-1.5">
                {todayClocks.map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${clockTypeColors[r.type] || 'bg-gray-100 text-gray-600'}`}>
                      {CLOCK_TYPE_LABELS[r.type] || r.type}
                    </span>
                    <span className="text-xs font-mono text-gray-700">{formatTimeDisplay(r.datetime)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── 右列: 勤務時間設定 ─── */}
        <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-y-auto">

          {/* 勤務時間 */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <label className="block text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
              <Clock size={14} className="text-[#007B7E]" />
              勤務時間
            </label>
            <div className="flex items-center gap-2">
              <TimeSelect value={clockIn} onChange={setClockIn} className="flex-1" />
              <span className="text-gray-400 text-sm shrink-0">〜</span>
              <TimeSelect value={clockOut} onChange={setClockOut} className="flex-1" />
            </div>
          </div>

          {/* 休憩時間 */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                <Clock size={14} className="text-amber-500" />
                休憩時間
              </label>
              <button
                onClick={addBreak}
                className="flex items-center gap-1 text-xs text-[#007B7E] font-semibold px-2 py-1 rounded-lg bg-[#f0fafa] hover:bg-[#c0efef] transition-colors border border-[#c0efef]"
              >
                <Plus size={12} />
                休憩を追加
              </button>
            </div>

            {breaks.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-2">休憩なし</p>
            ) : (
              <div className="space-y-2">
                {breaks.map((brk, i) => (
                  <div key={brk.id} className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 shrink-0 w-10">休憩{i + 1}</span>
                    <TimeSelect value={brk.start} onChange={v => updateBreak(brk.id, 'start', v)} className="flex-1" />
                    <span className="text-gray-400 text-sm shrink-0">〜</span>
                    <TimeSelect value={brk.end} onChange={v => updateBreak(brk.id, 'end', v)} className="flex-1" />
                    <button
                      onClick={() => removeBreak(brk.id)}
                      className="shrink-0 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="削除"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* エラー */}
          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm border border-red-200 whitespace-pre-line">
              <div className="flex items-start gap-1.5">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* 成功 */}
          {success && (
            <div className="bg-emerald-50 text-emerald-700 p-3 rounded-xl text-sm border border-emerald-100 flex items-center gap-2 shadow-sm">
              <div className="bg-emerald-500 p-1 rounded-full text-white shrink-0">
                <CheckCircle size={13} strokeWidth={3} />
              </div>
              <span className="font-semibold">Web経由で打刻を登録しました！</span>
            </div>
          )}

          {/* 送信ボタン */}
          <button
            onClick={handleSubmit}
            disabled={submitting || !isConfigured}
            className="w-full bg-[#007B7E] hover:bg-[#006669] text-white disabled:bg-gray-300 disabled:cursor-not-allowed p-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98]"
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">ブラウザで打刻登録中...</span>
              </>
            ) : (
              <>
                <LogIn size={16} />
                <span>Web経由で打刻を登録（{formatDateLabel(selectedDate)}）</span>
              </>
            )}
          </button>

          <p className="text-xs text-gray-400 text-center">
            freeeのWeb画面をバックグラウンドで操作して打刻を登録します
          </p>
        </div>
      </div>
    </div>
  )
}
