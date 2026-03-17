import { useState, useEffect, useMemo, useRef } from 'react'
import { Send, CheckCircle, CalendarRange, AlertTriangle, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { useFreee, Route, BatchResult } from '../hooks/useFreee'
import { isNonBusinessDay } from '../utils/holidays'
import { DEPARTMENTS } from '../utils/departments'
import DatePicker, { registerLocale } from 'react-datepicker'
import { ja } from 'date-fns/locale/ja'

registerLocale('ja', ja)

function dateToStr(d: Date | null): string {
    if (!d) return ''
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
}

function strToDate(s: string): Date | null {
    if (!s) return null
    const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
    if (!m) return null
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function formatDisplay(dateStr: string): string {
    const d = strToDate(dateStr)
    if (!d) return dateStr
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

function shiftDate(dateStr: string, days: number): string {
    const d = strToDate(dateStr)
    if (!d) return dateStr
    d.setDate(d.getDate() + days)
    return dateToStr(d)
}

function generateDateList(startDate: string, endDate: string, excludeHolidays: boolean): string[] {
    const dates: string[] = []
    const current = new Date(startDate)
    const end = new Date(endDate)
    while (current <= end) {
        const dateStr = dateToStr(current)
        if (!excludeHolidays || !isNonBusinessDay(dateStr)) dates.push(dateStr)
        current.setDate(current.getDate() + 1)
    }
    return dates
}

type LeaveUnit = 'full_day' | 'am_half' | 'pm_half'

const LEAVE_UNIT_LABELS: Record<LeaveUnit, string> = {
    full_day: '全休',
    am_half:  '午前休',
    pm_half:  '午後休',
}

function DateStepper({ value, onChange, startDate, endDate }: {
    value: string
    onChange: (v: string) => void
    startDate?: Date | null
    endDate?: Date | null
}) {
    const [inputText, setInputText] = useState(formatDisplay(value))
    const [calendarOpen, setCalendarOpen] = useState(false)
    const pickerRef = useRef<DatePicker>(null)

    useEffect(() => { setInputText(formatDisplay(value)) }, [value])

    const handleInputBlur = () => {
        const parsed = strToDate(inputText.replace(/\//g, '-'))
        if (parsed) onChange(dateToStr(parsed))
        else setInputText(formatDisplay(value))
    }

    const btnBase = "flex items-center justify-center w-9 border-y border-r border-gray-300 bg-white text-gray-400 hover:text-[#007B7E] hover:bg-[#f0fafa] active:bg-[#e0f5f5] transition-colors"

    return (
        <div className="relative flex items-stretch">
            <input
                type="text"
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onBlur={handleInputBlur}
                onKeyDown={e => e.key === 'Enter' && handleInputBlur()}
                placeholder="yyyy/mm/dd"
                className="flex-1 min-w-0 px-3 py-2.5 border border-gray-300 rounded-l-xl text-sm outline-none focus:border-[#007B7E] focus:ring-1 focus:ring-[#007B7E] transition bg-white"
            />
            <button type="button" onClick={() => onChange(shiftDate(value, -1))} className={btnBase} title="前日">
                <ChevronLeft size={14} strokeWidth={2.5} />
            </button>
            <button type="button" onClick={() => onChange(shiftDate(value, 1))} className={btnBase} title="翌日">
                <ChevronRight size={14} strokeWidth={2.5} />
            </button>
            <button
                type="button"
                onClick={() => setCalendarOpen(!calendarOpen)}
                className={`${btnBase} rounded-r-xl ${calendarOpen ? 'text-[#007B7E] bg-[#f0fafa]' : ''}`}
                title="カレンダー"
            >
                <Calendar size={14} strokeWidth={2} />
            </button>
            {calendarOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setCalendarOpen(false)} />
                    <div className="absolute top-full right-0 z-50 mt-1.5 shadow-xl rounded-xl">
                        <DatePicker
                            ref={pickerRef}
                            selected={strToDate(value)}
                            onChange={(d: Date | null) => { if (d) onChange(dateToStr(d)); setCalendarOpen(false) }}
                            startDate={startDate}
                            endDate={endDate}
                            locale="ja"
                            inline
                        />
                    </div>
                </>
            )}
        </div>
    )
}

export function PaidLeave() {
    const { fetchRoutes, submitPaidLeaveWeb, submitPaidLeaveBatch, loading, error, batchProgress } = useFreee()

    const [companyId, setCompanyId] = useState(0)

    const [rangeMode, setRangeMode] = useState(false)
    const [date, setDate] = useState('')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [excludeHolidays, setExcludeHolidays] = useState(true)

    const [leaveUnit, setLeaveUnit] = useState<LeaveUnit>('full_day')
    const [comment, setComment] = useState('')

    const [routes, setRoutes] = useState<Route[]>([])
    const [selectedRouteId, setSelectedRouteId] = useState<number>(0)
    const [success, setSuccess] = useState(false)
    const [fetchError, setFetchError] = useState<string | null>(null)
    const [batchResult, setBatchResult] = useState<BatchResult | null>(null)
    const [hasToken, setHasToken] = useState(false)

    const handleDateFromChange = (newFrom: string) => {
        setDateFrom(newFrom)
        const f = strToDate(newFrom), t = strToDate(dateTo)
        if (f && t && f > t) setDateTo(newFrom)
    }

    const handleDateToChange = (newTo: string) => {
        setDateTo(newTo)
        const f = strToDate(dateFrom), t = strToDate(newTo)
        if (f && t && t < f) setDateFrom(newTo)
    }

    const previewDates = useMemo(() => {
        if (!rangeMode || !dateFrom || !dateTo) return []
        return generateDateList(dateFrom, dateTo, excludeHolidays)
    }, [rangeMode, dateFrom, dateTo, excludeHolidays])

    const rangeStartDate = useMemo(() => strToDate(dateFrom), [dateFrom])
    const rangeEndDate = useMemo(() => strToDate(dateTo), [dateTo])

    useEffect(() => {
        const today = new Date()
        const todayStr = dateToStr(today)
        setDate(todayStr)
        setDateFrom(todayStr)
        setDateTo(todayStr)

        async function init() {
            const c = await window.api.storeGet('COMPANY_ID')
            setCompanyId(Number(c) || 0)

            const tokenResult = await window.api.getValidToken()
            if (tokenResult.success && c) {
                try {
                    const rts = await fetchRoutes(Number(c))
                    setRoutes(rts)
                    const lastRoute = await window.api.storeGet('LAST_PAID_LEAVE_ROUTE_ID')
                    if (lastRoute && rts.some((r: Route) => r.id === lastRoute)) setSelectedRouteId(lastRoute)
                    else if (rts.length > 0) setSelectedRouteId(rts[0].id)
                } catch {
                    setFetchError('経路の取得に失敗しました。設定を確認してください。')
                }
            } else if (!c) {
                setFetchError('初期設定が完了していません。設定画面から入力してください。')
            }
            const status = await window.api.getTokenStatus()
            setHasToken(status.hasToken)
        }
        init()
    }, [fetchRoutes])

    const handleSubmit = async () => {
        if (!companyId || !selectedRouteId) return
        setSuccess(false)
        setBatchResult(null)

        try {
            const defaultDeptId = await window.api.storeGet('DEFAULT_DEPARTMENT_ID')
            const deptId = defaultDeptId ? Number(defaultDeptId) : undefined
            const selectedRoute = routes.find(r => r.id === selectedRouteId)
            const routeName = selectedRoute?.name ?? ''
            const departmentName = deptId ? DEPARTMENTS.find(d => d.id === deptId)?.name : undefined

            if (rangeMode) {
                const dates = generateDateList(dateFrom, dateTo, excludeHolidays)
                if (dates.length === 0) return
                const result = await submitPaidLeaveBatch(companyId, dates, leaveUnit, undefined, undefined, selectedRouteId, comment, deptId, routeName, departmentName)
                setBatchResult(result)
                if (result.succeeded > 0) { setSuccess(true); setTimeout(() => setSuccess(false), 8000) }
            } else {
                await submitPaidLeaveWeb(companyId, date, leaveUnit, undefined, undefined, selectedRouteId, comment, deptId, routeName, departmentName)
                setSuccess(true)
                setTimeout(() => setSuccess(false), 5000)
            }

            await window.api.storeSet('LAST_PAID_LEAVE_ROUTE_ID', selectedRouteId)
        } catch (err) {
            console.error(err)
        }
    }

    const isConfigured = companyId && hasToken

    const buttonLabel = () => {
        if (loading && batchProgress) return `申請中...（${batchProgress.current}/${batchProgress.total}）`
        if (rangeMode && previewDates.length > 0) return `${previewDates.length}件を一括申請`
        return '申請する'
    }

    return (
        <div className="px-6 pt-4 pb-6 max-w-md mx-auto h-full flex flex-col">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex-1 overflow-y-auto">
                {fetchError && (
                    <div className="mb-4 bg-amber-50 text-amber-800 p-3 rounded-xl text-sm border border-amber-200">{fetchError}</div>
                )}

                <div className="space-y-4">

                    {/* ─── Date Section ─── */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-semibold text-gray-700">申請対象日</label>
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input type="checkbox" checked={rangeMode} onChange={e => { setRangeMode(e.target.checked); setBatchResult(null) }} className="w-3.5 h-3.5 rounded accent-[#007B7E]" />
                                <span className="text-xs text-gray-500 flex items-center gap-1">
                                    <CalendarRange size={12} />期間で指定
                                </span>
                            </label>
                        </div>

                        {!rangeMode ? (
                            <DateStepper value={date} onChange={setDate} />
                        ) : (
                            <div className="space-y-2">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs text-[#007B7E] font-semibold w-6 text-center shrink-0">開始</span>
                                    <div className="flex-1">
                                        <DateStepper value={dateFrom} onChange={handleDateFromChange} startDate={rangeStartDate} endDate={rangeEndDate} />
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs text-[#007B7E] font-semibold w-6 text-center shrink-0">終了</span>
                                    <div className="flex-1">
                                        <DateStepper value={dateTo} onChange={handleDateToChange} startDate={rangeStartDate} endDate={rangeEndDate} />
                                    </div>
                                </div>
                                <div className="flex items-center justify-between pt-0.5">
                                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                        <input type="checkbox" checked={excludeHolidays} onChange={e => setExcludeHolidays(e.target.checked)} className="w-3.5 h-3.5 rounded accent-[#007B7E]" />
                                        <span className="text-xs text-gray-500">土日祝日は除く</span>
                                    </label>
                                    {previewDates.length > 0 && (
                                        <span className="text-xs text-[#007B7E] font-bold bg-[#f0fafa] px-2 py-0.5 rounded-full">
                                            {previewDates.length}日分
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ─── Leave Unit ─── */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">取得単位</label>
                        <div className="grid grid-cols-3 gap-1.5">
                            {(Object.keys(LEAVE_UNIT_LABELS) as LeaveUnit[]).map(unit => (
                                <button
                                    key={unit}
                                    type="button"
                                    onClick={() => setLeaveUnit(unit)}
                                    className={`py-2.5 text-sm font-semibold rounded-lg border transition-all ${
                                        leaveUnit === unit
                                            ? 'bg-[#007B7E] text-white border-[#007B7E]'
                                            : 'bg-white text-gray-600 border-gray-300 hover:border-[#007B7E] hover:text-[#007B7E]'
                                    }`}
                                >
                                    {LEAVE_UNIT_LABELS[unit]}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ─── Comment ─── */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">申請理由（コメント）</label>
                        <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="申請理由を入力してください" rows={2} className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#007B7E] focus:border-[#007B7E] outline-none resize-none text-sm" />
                    </div>

                    {/* ─── Route ─── */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">申請経路</label>
                        <select
                            value={selectedRouteId}
                            onChange={e => setSelectedRouteId(Number(e.target.value))}
                            disabled={routes.length === 0}
                            className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#007B7E] outline-none bg-white disabled:bg-gray-50 text-sm"
                        >
                            <option value={0} disabled>経路を選択してください</option>
                            {routes.map(r => (
                                <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* ─── Error ─── */}
                    {(error && !success) && (
                        <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm border border-red-200 break-words">
                            <strong>エラー:</strong> {error}
                        </div>
                    )}

                    {/* ─── Batch failures ─── */}
                    {batchResult && batchResult.failed.length > 0 && (
                        <div className="bg-amber-50 text-amber-800 p-3 rounded-xl text-sm border border-amber-200">
                            <div className="flex items-center gap-1.5 font-semibold mb-1"><AlertTriangle size={14} />{batchResult.failed.length}件が失敗</div>
                            <ul className="text-xs space-y-0.5 ml-5 list-disc">
                                {batchResult.failed.map(f => <li key={f.date}>{f.date}</li>)}
                            </ul>
                        </div>
                    )}

                    {/* ─── Success ─── */}
                    {success && (
                        <div className="bg-emerald-50 text-emerald-700 p-4 rounded-2xl text-sm border border-emerald-100 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500 shadow-sm">
                            <div className="bg-emerald-500 p-1 rounded-full text-white">
                                <CheckCircle size={14} strokeWidth={3} />
                            </div>
                            <span className="font-semibold">
                                {batchResult ? `${batchResult.succeeded}件の有給申請が完了しました！` : '有給申請が完了しました！'}
                            </span>
                        </div>
                    )}

                </div>
            </div>

            {/* ─── Submit Button ─── */}
            <div className="mt-3">
                <button
                    onClick={handleSubmit}
                    disabled={loading || !isConfigured || !selectedRouteId || (rangeMode && previewDates.length === 0)}
                    className="w-full bg-[#007B7E] hover:bg-[#006669] text-white disabled:bg-gray-300 disabled:cursor-not-allowed p-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98]"
                >
                    {loading ? (
                        <>
                            <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            {batchProgress && <span className="text-sm">{buttonLabel()}</span>}
                        </>
                    ) : (
                        <>
                            <Send size={18} />
                            <span>{buttonLabel()}</span>
                        </>
                    )}
                </button>
            </div>
        </div>
    )
}
