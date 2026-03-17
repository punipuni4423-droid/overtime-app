import { useState, useEffect } from 'react'
import { Send, CheckCircle, AlertTriangle, ChevronLeft, ChevronRight, LogIn, RefreshCw, Clock } from 'lucide-react'
import { useFreee, Route } from '../hooks/useFreee'
import { DEPARTMENTS } from '../utils/departments'
import { isNonBusinessDay } from '../utils/holidays'

// ─── 締め日・申請可能期間ユーティリティ ───

function toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 毎月15日（休日の場合は前の営業日）の実際の締め日を返す */
function getActualClosingDay(year: number, month: number): Date {
    const d = new Date(year, month - 1, 15)
    while (isNonBusinessDay(toDateStr(d))) {
        d.setDate(d.getDate() - 1)
    }
    return d
}

/** 指定日の N 営業日後を返す */
function addBusinessDays(date: Date, days: number): Date {
    const d = new Date(date)
    let remaining = days
    while (remaining > 0) {
        d.setDate(d.getDate() + 1)
        if (!isNonBusinessDay(toDateStr(d))) remaining--
    }
    return d
}

/**
 * 今日の日付に基づいて月次締め申請が可能かどうかを判定する。
 * - 締め日（毎月15日 or 前営業日）の7日前〜締め日後3営業日が申請可能期間
 * - 申請対象月 = 締め日が属する月（例：2/15 → 2月）
 */
function checkApplicationPeriod(today: Date): {
    isOpen: boolean
    targetYear: number
    targetMonth: number
    windowStart: Date
    windowEnd: Date
    closingDay: Date
} {
    const year = today.getFullYear()
    const month = today.getMonth() + 1
    const todayMidnight = new Date(year, today.getMonth(), today.getDate())

    const closingDay = getActualClosingDay(year, month)
    const windowStart = new Date(closingDay)
    windowStart.setDate(windowStart.getDate() - 7)
    const windowEnd = addBusinessDays(closingDay, 3)

    const startMidnight = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate())
    const endMidnight = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), windowEnd.getDate())

    const isOpen = todayMidnight >= startMidnight && todayMidnight <= endMidnight

    return { isOpen, targetYear: year, targetMonth: month, windowStart, windowEnd, closingDay }
}

/** 次の申請可能期間の開始日を返す（現在が期間外のとき表示用） */
function getNextWindowStart(today: Date): { date: Date; month: number; year: number } {
    const year = today.getFullYear()
    const month = today.getMonth() + 1
    const todayMidnight = new Date(year, today.getMonth(), today.getDate())

    const closingDay = getActualClosingDay(year, month)
    const windowStart = new Date(closingDay)
    windowStart.setDate(windowStart.getDate() - 7)
    const startMidnight = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate())

    if (todayMidnight < startMidnight) {
        return { date: windowStart, month, year }
    }
    // 今月の期間を過ぎた → 翌月
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    const nextClosingDay = getActualClosingDay(nextYear, nextMonth)
    const nextWindowStart = new Date(nextClosingDay)
    nextWindowStart.setDate(nextWindowStart.getDate() - 7)
    return { date: nextWindowStart, month: nextMonth, year: nextYear }
}

function MonthStepper({
    year,
    month,
    onChange,
}: {
    year: number
    month: number
    onChange: (year: number, month: number) => void
}) {
    const handlePrev = () => {
        if (month === 1) onChange(year - 1, 12)
        else onChange(year, month - 1)
    }
    const handleNext = () => {
        if (month === 12) onChange(year + 1, 1)
        else onChange(year, month + 1)
    }

    const btnBase =
        'flex items-center justify-center w-9 border-y border-r border-gray-300 bg-white text-gray-400 hover:text-[#007B7E] hover:bg-[#f0fafa] active:bg-[#e0f5f5] transition-colors'

    return (
        <div className="flex items-stretch">
            <div className="flex-1 px-3 py-2.5 border border-gray-300 rounded-l-xl text-sm bg-white flex items-center">
                <span className="font-semibold text-gray-700">
                    {year}年{String(month).padStart(2, '0')}月
                </span>
            </div>
            <button type="button" onClick={handlePrev} className={btnBase} title="前月">
                <ChevronLeft size={14} strokeWidth={2.5} />
            </button>
            <button type="button" onClick={handleNext} className={`${btnBase} rounded-r-xl`} title="翌月">
                <ChevronRight size={14} strokeWidth={2.5} />
            </button>
        </div>
    )
}

export function MonthlyClose() {
    const { fetchRoutes, loading } = useFreee()

    const now = new Date()
    // 申請可能期間を判定し、対象月（当月）をデフォルトに設定
    const period = checkApplicationPeriod(now)

    const [year, setYear] = useState(period.targetYear)
    const [month, setMonth] = useState(period.targetMonth)
    const [comment, setComment] = useState('')

    const [routes, setRoutes] = useState<Route[]>([])
    const [selectedRouteId, setSelectedRouteId] = useState(0)
    const [companyId, setCompanyId] = useState(0)
    const [applicantId, setApplicantId] = useState(0)
    const [hasToken, setHasToken] = useState(false)
    const [fetchError, setFetchError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)
    const [isWebSuccess, setIsWebSuccess] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [isSwitchingToWeb, setIsSwitchingToWeb] = useState(false)

    const selectedRoute = routes.find(r => r.id === selectedRouteId)
    const isIncompatibleRoute =
        selectedRoute?.definition_type === 'department' || selectedRoute?.definition_type === 'position'

    useEffect(() => {
        async function init() {
            const c = await window.api.storeGet('COMPANY_ID')
            const a = await window.api.storeGet('APPLICANT_ID')
            const lastRoute = await window.api.storeGet('LAST_MONTHLY_CLOSE_ROUTE_ID')

            setCompanyId(Number(c) || 0)
            setApplicantId(Number(a) || 0)

            const tokenResult = await window.api.getValidToken()
            if (tokenResult.success && c) {
                try {
                    const rts = await fetchRoutes(Number(c))
                    setRoutes(rts)
                    if (lastRoute && rts.some(r => r.id === lastRoute)) {
                        setSelectedRouteId(lastRoute)
                    } else if (rts.length > 0) {
                        setSelectedRouteId(rts[0].id)
                    }
                } catch {
                    setFetchError('経路の取得に失敗しました。設定を確認してください。')
                }
            } else if (tokenResult.authRequired) {
                setFetchError(tokenResult.message || '認証が必要です。設定画面からOAuth認証を行ってください。')
            } else if (!c) {
                setFetchError('初期設定が完了していません。右上の設定画面から入力してください。')
            }

            const status = await window.api.getTokenStatus()
            setHasToken(status.hasToken)
        }
        init()
    }, [fetchRoutes])

    const targetDate = `${year}-${String(month).padStart(2, '0')}-01`

    const handleSubmit = async () => {
        if (!companyId || !applicantId || !selectedRouteId) return
        setIsSubmitting(true)
        setSubmitError(null)
        setSuccess(false)

        try {
            const defaultDeptId = await window.api.storeGet('DEFAULT_DEPARTMENT_ID')
            const deptId = defaultDeptId ? Number(defaultDeptId) : undefined
            const routeName = selectedRoute?.name ?? ''
            const departmentName = deptId ? DEPARTMENTS.find(d => d.id === deptId)?.name : undefined

            const payload = {
                companyId,
                applicantId,
                targetDate,
                routeId: selectedRouteId,
                comment,
                departmentId: deptId,
                routeName,
                departmentName,
            }

            // API経由で申請を試みる（経路がAPI対応の場合）
            if (!isIncompatibleRoute) {
                try {
                    await (window.api as any).submitMonthlyClose(payload)
                    setSuccess(true)
                    setIsWebSuccess(false)
                    setTimeout(() => setSuccess(false), 5000)
                    await window.api.storeSet('LAST_MONTHLY_CLOSE_ROUTE_ID', selectedRouteId)
                    return
                } catch (err: any) {
                    const msg: string = err.message || ''
                    if (msg.includes('役職、部門を利用する申請はWebから') || msg.includes('API制限')) {
                        // Web経由へフォールバック
                    } else {
                        throw err
                    }
                }
            }

            // Web経由（Playwright）で申請
            setIsSwitchingToWeb(true)
            try {
                await (window.api as any).submitMonthlyCloseWeb(payload)
                setSuccess(true)
                setIsWebSuccess(true)
                setTimeout(() => setSuccess(false), 5000)
                await window.api.storeSet('LAST_MONTHLY_CLOSE_ROUTE_ID', selectedRouteId)
            } finally {
                setIsSwitchingToWeb(false)
            }
        } catch (err: any) {
            setSubmitError(err.message)
        } finally {
            setIsSubmitting(false)
        }
    }

    const isConfigured = companyId && applicantId && hasToken
    const isWindowOpen = period.isOpen
    const nextWindow = !isWindowOpen ? getNextWindowStart(now) : null

    return (
        <div className="px-6 pt-4 pb-6 max-w-md mx-auto h-full flex flex-col">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex-1 overflow-y-auto">
                {fetchError && (
                    <div className="mb-4 bg-amber-50 text-amber-800 p-3 rounded-xl text-sm border border-amber-200">
                        {fetchError}
                    </div>
                )}

                <div className="space-y-4">
                    {/* 対象年月 */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">対象年月</label>
                        <MonthStepper
                            year={year}
                            month={month}
                            onChange={(y, m) => {
                                setYear(y)
                                setMonth(m)
                            }}
                        />
                    </div>

                    {/* コメント */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            コメント<span className="text-gray-400 font-normal ml-1 text-xs">（任意）</span>
                        </label>
                        <textarea
                            value={comment}
                            onChange={e => setComment(e.target.value)}
                            placeholder="コメントを入力してください（任意）"
                            rows={2}
                            className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#007B7E] focus:border-[#007B7E] outline-none resize-none text-sm"
                        />
                    </div>

                    {/* 申請経路 */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">申請経路</label>
                        <select
                            value={selectedRouteId}
                            onChange={e => setSelectedRouteId(Number(e.target.value))}
                            disabled={routes.length === 0}
                            className={`w-full p-3 border rounded-xl focus:ring-2 focus:ring-[#007B7E] outline-none bg-white disabled:bg-gray-50 text-sm transition-all duration-300 ${
                                isIncompatibleRoute ? 'border-amber-400' : 'border-gray-300'
                            }`}
                        >
                            <option value={0} disabled>経路を選択してください</option>
                            {routes.map(r => (
                                <option key={r.id} value={r.id}>
                                    {r.name}
                                    {r.definition_type === 'department' || r.definition_type === 'position'
                                        ? ' (Web専用)'
                                        : ''}
                                </option>
                            ))}
                        </select>
                        {isIncompatibleRoute && (
                            <div className="mt-2 flex items-start gap-1.5 p-2 bg-blue-50 text-blue-800 rounded-lg text-xs leading-relaxed border border-blue-200 animate-in fade-in slide-in-from-top-1 duration-300">
                                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                                <span>
                                    この経路はAPI非対応ですが、<b>Web版自動操作</b>
                                    （バックグラウンド）で申請可能です。
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Web切替中 */}
                    {isSwitchingToWeb && (
                        <div className="bg-blue-50 text-blue-700 p-4 rounded-2xl text-sm border border-blue-100 flex items-center gap-3 animate-pulse">
                            <RefreshCw size={16} className="animate-spin text-blue-500" />
                            <span className="font-semibold italic">
                                API制限のため、Web経由での代行申請に切り替えています...
                            </span>
                        </div>
                    )}

                    {/* エラー */}
                    {submitError && !success && (
                        <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm border border-red-200 break-words">
                            <strong>エラー:</strong> {submitError}
                        </div>
                    )}

                    {/* 申請期間外メッセージ */}
                    {!isWindowOpen && (
                        <div className="bg-gray-50 text-gray-600 p-3 rounded-xl text-sm border border-gray-200 flex items-start gap-2">
                            <Clock size={15} className="shrink-0 mt-0.5 text-gray-400" />
                            <div>
                                <div className="font-semibold text-gray-700">現在は申請受付期間外です</div>
                                <div className="text-xs mt-0.5 text-gray-500">
                                    月次締め申請は締め日（毎月15日）の<b>1週間前〜締め日後3営業日</b>のみ可能です。
                                    {nextWindow && (
                                        <span>
                                            {' '}次の受付開始：<b>{nextWindow.year}年{String(nextWindow.month).padStart(2, '0')}月{String(nextWindow.date.getDate()).padStart(2, '0')}日</b>
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 成功 */}
                    {success && (
                        <div className="bg-emerald-50 text-emerald-700 p-4 rounded-2xl text-sm border border-emerald-100 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500 shadow-sm shadow-emerald-100/50">
                            <div className="bg-emerald-500 p-1 rounded-full text-white">
                                <CheckCircle size={14} strokeWidth={3} />
                            </div>
                            <span className="font-semibold">
                                {isWebSuccess ? 'Web経由で申請が完了しました！' : '月次締め申請が完了しました！'}
                            </span>
                        </div>
                    )}
                </div>
            </div>

            {/* 申請ボタン */}
            <div className="mt-3">
                <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || loading || !isConfigured || !selectedRouteId || !isWindowOpen}
                    className="w-full bg-[#007B7E] hover:bg-[#006669] text-white disabled:bg-gray-300 disabled:cursor-not-allowed p-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-md active:scale-[0.98]"
                >
                    {isSubmitting || loading ? (
                        <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                        <>
                            {isIncompatibleRoute ? <LogIn size={18} /> : <Send size={18} />}
                            <span>{isIncompatibleRoute ? 'Web版で申請代行' : '月次締め申請する'}</span>
                        </>
                    )}
                </button>
            </div>
        </div>
    )
}
