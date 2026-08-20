import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle, Clock, Send, X } from 'lucide-react'
import { BatchResult, Route, useFreee } from '../hooks/useFreee'
import { useLoginVerified, checkLoginGate } from '../hooks/useLoginVerified'
import { DEPARTMENTS } from '../utils/departments'
import { isNonBusinessDay } from '../utils/holidays'
import { DateModeToggle, DateStepper, MultiDateCalendar } from './ui/RequestControls'

const TIME_OPTIONS = Array.from({ length: 55 }, (_, index) => {
    const totalMinutes = index * 30
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
})

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

function generateDateList(startDate: string, endDate: string): string[] {
    const dates: string[] = []
    const current = new Date(startDate)
    const end = new Date(endDate)
    while (current <= end) {
        const dateStr = dateToStr(current)
        if (isNonBusinessDay(dateStr)) dates.push(dateStr)
        current.setDate(current.getDate() + 1)
    }
    return dates
}

function nextNonBusinessDate(from = new Date()): string {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
    for (let i = 0; i < 370; i++) {
        const dateStr = dateToStr(d)
        if (isNonBusinessDay(dateStr)) return dateStr
        d.setDate(d.getDate() + 1)
    }
    return dateToStr(from)
}

export function HolidayWork() {
    const { fetchRoutes, submitHolidayWorkBatch, loading, error, clearError, batchProgress } = useFreee()
    const { status: loginStatus } = useLoginVerified()

    const [companyId, setCompanyId] = useState(0)
    const [rangeMode, setRangeMode] = useState(false)
    const [multiMode, setMultiMode] = useState(false)
    const [date, setDate] = useState('')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [selectedDates, setSelectedDates] = useState<string[]>([])
    const [startAt, setStartAt] = useState('09:00')
    const [endAt, setEndAt] = useState('18:00')
    const [comment, setComment] = useState('')
    const [routes, setRoutes] = useState<Route[]>([])
    const [selectedRouteId, setSelectedRouteId] = useState<number>(0)
    const [success, setSuccess] = useState(false)
    const [fetchError, setFetchError] = useState<string | null>(null)
    const [batchResult, setBatchResult] = useState<BatchResult | null>(null)
    const [hasToken, setHasToken] = useState(false)

    const handleDateFromChange = (newFrom: string) => {
        setDateFrom(newFrom)
        const f = strToDate(newFrom)
        const t = strToDate(dateTo)
        if (f && t && f > t) setDateTo(newFrom)
    }

    const handleDateToChange = (newTo: string) => {
        setDateTo(newTo)
        const f = strToDate(dateFrom)
        const t = strToDate(newTo)
        if (f && t && t < f) setDateFrom(newTo)
    }

    const handleRangeModeChange = (checked: boolean) => {
        setRangeMode(checked)
        if (checked) setMultiMode(false)
        setBatchResult(null)
    }

    const handleMultiModeChange = (checked: boolean) => {
        setMultiMode(checked)
        if (checked) setRangeMode(false)
        setBatchResult(null)
    }

    const removeSelectedDate = (target: string) => {
        setSelectedDates(prev => prev.filter(d => d !== target))
        setBatchResult(null)
    }

    const handleSelectedDatesChange = (dates: string[]) => {
        setSelectedDates(dates)
        setBatchResult(null)
    }

    const previewDates = useMemo(() => {
        if (!rangeMode || !dateFrom || !dateTo) return []
        return generateDateList(dateFrom, dateTo)
    }, [rangeMode, dateFrom, dateTo])

    const targetDates = useMemo(() => {
        if (rangeMode) return previewDates
        if (multiMode) return selectedDates
        return date ? [date] : []
    }, [rangeMode, multiMode, previewDates, selectedDates, date])

    const isBatchMode = rangeMode || multiMode
    const rangeStartDate = useMemo(() => strToDate(dateFrom), [dateFrom])
    const rangeEndDate = useMemo(() => strToDate(dateTo), [dateTo])
    const isHolidayWorkDate = (d: Date): boolean => isNonBusinessDay(dateToStr(d))
    const hasInvalidHolidayWorkDate = targetDates.some(d => !isNonBusinessDay(d))

    useEffect(() => {
        const todayStr = nextNonBusinessDate()
        setDate(todayStr)
        setDateFrom(todayStr)
        setDateTo(todayStr)

        async function init() {
            let cId = 0
            try {
                const info = await window.api.getUserInfo()
                cId = info.companyId
                setCompanyId(info.companyId)
            } catch { /* token未設定時は0のまま */ }

            const tokenResult = await window.api.getValidToken()
            if (tokenResult.success && cId) {
                try {
                    const rts = await fetchRoutes(cId)
                    setRoutes(rts)
                    const [lastRoute, lastStartAt, lastEndAt] = await Promise.all([
                        window.api.storeGet('LAST_HOLIDAY_WORK_ROUTE_ID'),
                        window.api.storeGet('LAST_HOLIDAY_WORK_START_TIME'),
                        window.api.storeGet('LAST_HOLIDAY_WORK_END_TIME'),
                    ])
                    if (lastRoute && rts.some((r: Route) => r.id === lastRoute)) setSelectedRouteId(lastRoute)
                    else if (rts.length > 0) setSelectedRouteId(rts[0].id)
                    if (lastStartAt && TIME_OPTIONS.includes(String(lastStartAt))) setStartAt(String(lastStartAt))
                    if (lastEndAt && TIME_OPTIONS.includes(String(lastEndAt))) setEndAt(String(lastEndAt))
                } catch {
                    setFetchError('経路の取得に失敗しました。設定を確認してください。')
                }
            } else if (!cId) {
                setFetchError('初期設定が完了していません。設定画面から入力してください。')
            }
            const status = await window.api.getTokenStatus()
            setHasToken(status.hasToken)
        }
        init()
    }, [fetchRoutes])

    const handleSubmit = async () => {
        if (!companyId || !selectedRouteId) return
        const gate = checkLoginGate(loginStatus)
        if (!gate.ok) {
            window.alert(gate.message || 'メールアドレス・パスワードを確認してください。')
            return
        }
        if (targetDates.length === 0) return

        setSuccess(false)
        setBatchResult(null)

        try {
            const defaultDeptId = await window.api.storeGet('DEFAULT_DEPARTMENT_ID')
            const deptId = defaultDeptId ? Number(defaultDeptId) : undefined
            const selectedRoute = routes.find(r => r.id === selectedRouteId)
            const routeName = selectedRoute?.name ?? ''
            const departmentName = deptId ? DEPARTMENTS.find(d => d.id === deptId)?.name : undefined

            const result = await submitHolidayWorkBatch(
                companyId,
                targetDates,
                startAt,
                endAt,
                selectedRouteId,
                comment,
                deptId,
                routeName,
                departmentName,
            )
            setBatchResult(result)
            if (result.succeeded > 0) {
                setSuccess(true)
                setTimeout(() => setSuccess(false), isBatchMode ? 8000 : 5000)
            }

            await window.api.storeSet('LAST_HOLIDAY_WORK_ROUTE_ID', selectedRouteId)
            await window.api.storeSet('LAST_HOLIDAY_WORK_START_TIME', startAt)
            await window.api.storeSet('LAST_HOLIDAY_WORK_END_TIME', endAt)
        } catch (err) {
            console.error(err)
        }
    }

    const isConfigured = companyId && hasToken
    const isCommentEmpty = !comment.trim()

    const buttonLabel = () => {
        if (loading && batchProgress) return `申請中...（${batchProgress.current}/${batchProgress.total}）`
        if (targetDates.length > 0) return `${targetDates.length}件を申請`
        return '申請する'
    }

    return (
        <div className="px-6 pt-4 pb-6 max-w-md mx-auto h-full flex flex-col">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex-1 overflow-y-auto">
                {fetchError && (
                    <div className="mb-4 bg-amber-50 text-amber-800 p-3 rounded-xl text-sm border border-amber-200">{fetchError}</div>
                )}

                <div className="space-y-4">
                    <div>
                        <div className="mb-2 space-y-2">
                            <label className="text-sm font-semibold text-gray-700">申請対象日</label>
                            <DateModeToggle
                                rangeMode={rangeMode}
                                multiMode={multiMode}
                                onRangeModeChange={handleRangeModeChange}
                                onMultiModeChange={handleMultiModeChange}
                            />
                        </div>

                        {!rangeMode && !multiMode ? (
                            <>
                                <DateStepper value={date} onChange={setDate} filterDate={isHolidayWorkDate} />
                                <p className={`mt-1.5 text-xs flex items-center gap-1 h-4 ${hasInvalidHolidayWorkDate ? 'text-amber-600' : 'text-gray-400'}`}>
                                    <AlertTriangle size={12} />休日出勤申請は土日祝日のみ選択できます
                                </p>
                            </>
                        ) : multiMode ? (
                            <div className="space-y-2">
                                <MultiDateCalendar selectedDates={selectedDates} onChange={handleSelectedDatesChange} filterDate={isHolidayWorkDate} />
                                <div className="min-h-8 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5">
                                    {selectedDates.length > 0 ? (
                                        <div className="flex flex-wrap gap-1.5">
                                            {selectedDates.map(d => (
                                                <span key={d} className="inline-flex items-center gap-1 rounded-full bg-white border border-gray-200 px-2 py-1 text-xs text-gray-700">
                                                    {formatDisplay(d)}
                                                    <button type="button" onClick={() => removeSelectedDate(d)} className="text-gray-400 hover:text-red-500" title="削除">
                                                        <X size={12} />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className="text-xs text-gray-400">申請する日付を追加してください</span>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs text-[#007B7E] font-semibold w-6 text-center shrink-0">開始</span>
                                    <div className="flex-1">
                                        <DateStepper value={dateFrom} onChange={handleDateFromChange} startDate={rangeStartDate} endDate={rangeEndDate} filterDate={isHolidayWorkDate} />
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs text-[#007B7E] font-semibold w-6 text-center shrink-0">終了</span>
                                    <div className="flex-1">
                                        <DateStepper value={dateTo} onChange={handleDateToChange} startDate={rangeStartDate} endDate={rangeEndDate} filterDate={isHolidayWorkDate} />
                                    </div>
                                </div>
                                {previewDates.length > 0 && (
                                    <div className="flex justify-end">
                                        <span className="text-xs text-[#007B7E] font-bold bg-[#f0fafa] px-2 py-0.5 rounded-full">
                                            {previewDates.length}日分
                                        </span>
                                    </div>
                                )}
                                {previewDates.length === 0 && (
                                    <p className="text-xs text-amber-600 flex items-center gap-1">
                                        <AlertTriangle size={12} />範囲内に土日祝日がありません
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex space-x-3">
                        <div className="flex-1">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">開始時間</label>
                            <div className="relative">
                                <Clock className="absolute left-3 top-3.5 text-gray-400" size={16} />
                                <select value={startAt} onChange={e => setStartAt(e.target.value)} className="w-full pl-9 p-3 border border-gray-300 rounded-xl appearance-none focus:ring-2 focus:ring-[#007B7E] outline-none bg-white text-sm">
                                    {TIME_OPTIONS.map(t => <option key={`hw-s-${t}`} value={t}>{t}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="flex-1">
                            <label className="block text-sm font-semibold text-gray-700 mb-2">終了時間</label>
                            <div className="relative">
                                <Clock className="absolute left-3 top-3.5 text-gray-400" size={16} />
                                <select value={endAt} onChange={e => setEndAt(e.target.value)} className="w-full pl-9 p-3 border border-gray-300 rounded-xl appearance-none focus:ring-2 focus:ring-[#007B7E] outline-none bg-white text-sm">
                                    {TIME_OPTIONS.map(t => <option key={`hw-e-${t}`} value={t}>{t}</option>)}
                                </select>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            申請理由（コメント）<span className="text-red-500 ml-0.5">*</span>
                        </label>
                        <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            placeholder="休日出勤の理由を入力してください（必須）"
                            rows={3}
                            className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#007B7E] focus:border-[#007B7E] outline-none resize-none text-sm"
                        />
                    </div>

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

                    {(error && !success) && (
                        <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm border border-red-200 break-words flex items-start gap-2">
                            <span className="flex-1"><strong>エラー:</strong> {error}</span>
                            <button onClick={clearError} className="shrink-0 p-0.5 hover:bg-red-100 rounded transition-colors" title="閉じる">
                                <X size={14} />
                            </button>
                        </div>
                    )}

                    {batchResult && batchResult.failed.length > 0 && (
                        <div className="bg-amber-50 text-amber-800 p-3 rounded-xl text-sm border border-amber-200">
                            <div className="flex items-center gap-1.5 font-semibold mb-1">
                                <AlertTriangle size={14} />{batchResult.failed.length}件が失敗
                            </div>
                            <ul className="text-xs space-y-0.5 ml-5 list-disc">
                                {batchResult.failed.map(f => <li key={f.date}>{f.date}</li>)}
                            </ul>
                        </div>
                    )}

                    {success && (
                        <div className="bg-emerald-50 text-emerald-700 p-4 rounded-2xl text-sm border border-emerald-100 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500 shadow-sm">
                            <div className="bg-emerald-500 p-1 rounded-full text-white">
                                <CheckCircle size={14} strokeWidth={3} />
                            </div>
                            <span className="font-semibold">
                                {batchResult ? `${batchResult.succeeded}件の休日出勤申請が完了しました。` : '休日出勤申請が完了しました。'}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            <div className="mt-3">
                <button
                    onClick={handleSubmit}
                    disabled={loading || !isConfigured || !selectedRouteId || isCommentEmpty || targetDates.length === 0 || hasInvalidHolidayWorkDate}
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
