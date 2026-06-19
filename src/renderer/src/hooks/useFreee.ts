import { useState, useCallback } from 'react'
import type { LeaveUnit } from '../../../shared/leaveUnit'

export const API_RESTRICTION_ERROR = '役職、部門を利用する申請はWebから'
const FRIEENDLY_ERROR_MAP = {
    [API_RESTRICTION_ERROR]: '【API制限エラー】この申請経路は部門・役職の判定が必要なため、APIからは実行できません。承認者が個人指定されている経路を選択するか、freeeのWeb画面から申請してください。'
}

function formatFreeeError(errString: string): string {
    for (const [key, msg] of Object.entries(FRIEENDLY_ERROR_MAP)) {
        if (errString.includes(key)) return msg
    }
    return errString
}


export interface Route {
    id: number;
    name: string;
    definition_type?: string;
}

export interface Department {
    id: number;
    name: string;
}

export interface BatchResult {
    total: number;
    succeeded: number;
    failed: { date: string; error: string }[];
}

// Module-level cache — survives tab switches within the same session
const _routesCache = new Map<number, Route[]>()
const _departmentsCache = new Map<number, Department[]>()

export function useFreee() {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Progress tracking for batch submissions
    const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null)

    const fetchRoutes = useCallback(async (companyId: number): Promise<Route[]> => {
        if (_routesCache.has(companyId)) return _routesCache.get(companyId)!
        setLoading(true)
        setError(null)
        try {
            const data = await window.api.fetchRoutes(companyId)
            let routes: any[] = []
            if (typeof data === 'object' && !Array.isArray(data)) {
                routes = data.approval_flow_routes || data.routes || []
            } else {
                routes = data
            }
            const result = routes.map((r: any) => ({
                id: r.id,
                name: r.name,
                definition_type: r.definition_type
            }))
            _routesCache.set(companyId, result)
            return result
        } catch (err: any) {
            setError(err.message)
            throw err
        } finally {
            setLoading(false)
        }
    }, [])

    const fetchDepartments = useCallback(async (companyId: number): Promise<Department[]> => {
        if (_departmentsCache.has(companyId)) return _departmentsCache.get(companyId)!
        setLoading(true)
        setError(null)
        try {
            const data = await window.api.fetchDepartments(companyId)
            let depts: any[] = []
            if (typeof data === 'object' && !Array.isArray(data)) {
                depts = data.departments || []
            } else {
                depts = data
            }
            const result = depts.map((d: any) => ({ id: d.id, name: d.name }))
            _departmentsCache.set(companyId, result)
            return result
        } catch (err: any) {
            setError(err.message)
            throw err
        } finally {
            setLoading(false)
        }
    }, [])

    const submitOvertime = useCallback(async (
        companyId: number,
        applicantId: number,
        targetDate: string,
        startAt: string,
        endAt: string,
        routeId: number,
        comment: string,
        departmentId?: number,
        useWeb?: boolean,
        routeName?: string,
        departmentName?: string
    ) => {
        setLoading(true)
        setError(null)
        try {
            const payload: any = {
                company_id: companyId,
                applicant_id: applicantId,
                target_date: targetDate,
                start_at: startAt,
                end_at: endAt,
                comment: comment,
                approval_flow_route_id: routeId
            }
            if (departmentId) {
                payload.department_id = departmentId
            }

            if (useWeb) {
              return await window.api.submitOvertimeWeb({
                companyId,
                applicantId,
                targetDate,
                startAt,
                endAt,
                comment,
                routeId,
                departmentId,
                routeName: routeName ?? '',
                departmentName
              })
            }
            const data = await window.api.submitOvertime(payload)
            return data
        } catch (err: any) {
            const formattedMsg = formatFreeeError(err.message)
            setError(formattedMsg)
            throw new Error(formattedMsg)
        } finally {
            setLoading(false)
        }
    }, [])

    const submitOvertimeWeb = useCallback(async (
        companyId: number,
        applicantId: number,
        targetDate: string,
        startAt: string,
        endAt: string,
        routeId: number,
        comment: string,
        departmentId?: number,
        routeName?: string,
        departmentName?: string
    ) => {
        setLoading(true)
        setError(null)
        try {
            const payload = {
                companyId,
                applicantId,
                targetDate,
                startAt,
                endAt,
                comment,
                routeId,
                departmentId,
                routeName: routeName ?? '',
                departmentName
            }
            const data = await window.api.submitOvertimeWeb(payload)
            return data
        } catch (err: any) {
            setError(err.message)
            throw err
        } finally {
            setLoading(false)
        }
    }, [])

    // ─── Batch submit: single browser instance for Web, sequential API for non-Web ───
    const submitBatch = useCallback(async (
        companyId: number,
        applicantId: number,
        dates: string[],
        startAt: string,
        endAt: string,
        routeId: number,
        comment: string,
        departmentId?: number,
        useWeb?: boolean,
        routeName?: string,
        departmentName?: string
    ): Promise<BatchResult> => {
        setLoading(true)
        setError(null)
        setBatchProgress({ current: 0, total: dates.length })

        try {
            if (useWeb) {
                // Web バッチ: ブラウザ1回起動でまとめて処理
                const unsubscribe = window.api.onOvertimeBatchProgress((p) => {
                    setBatchProgress({ current: p.current, total: p.total })
                })
                try {
                    const result = await window.api.submitOvertimeWebBatch({
                        companyId,
                        items: dates.map(d => ({ targetDate: d, startAt, endAt })),
                        comment,
                        routeId,
                        routeName: routeName ?? '',
                        departmentId,
                        departmentName
                    })
                    if (result.failed.length > 0) setError(formatFreeeError(result.failed[0].error))
                    return result
                } finally {
                    unsubscribe()
                }
            }

            // API 経由: 従来のループ処理（最初の日付でAPI制限エラーの場合はWebバッチにフォールバック）
            const result: BatchResult = { total: dates.length, succeeded: 0, failed: [] }

            for (let i = 0; i < dates.length; i++) {
                setBatchProgress({ current: i + 1, total: dates.length })
                try {
                    const payload: any = {
                        company_id: companyId,
                        applicant_id: applicantId,
                        target_date: dates[i],
                        start_at: startAt,
                        end_at: endAt,
                        comment: comment,
                        approval_flow_route_id: routeId
                    }
                    if (departmentId) payload.department_id = departmentId

                    try {
                        await window.api.submitOvertime(payload)
                    } catch (apiErr: any) {
                        if (apiErr.message.includes('役職、部門を利用する申請はWebから')) {
                            // API制限 → 残り全てをWebバッチにフォールバック
                            const remainingDates = dates.slice(i)
                            const unsubscribe = window.api.onOvertimeBatchProgress((p) => {
                                setBatchProgress({ current: i + p.current, total: dates.length })
                            })
                            try {
                                const webResult = await window.api.submitOvertimeWebBatch({
                                    companyId,
                                    items: remainingDates.map(d => ({ targetDate: d, startAt, endAt })),
                                    comment,
                                    routeId,
                                    routeName: routeName ?? '',
                                    departmentId,
                                    departmentName
                                })
                                result.succeeded += webResult.succeeded
                                result.failed.push(...webResult.failed)
                            } finally {
                                unsubscribe()
                            }
                            break // ループ終了（Webバッチが残り全てを処理済み）
                        } else {
                            throw apiErr
                        }
                    }
                    result.succeeded++
                } catch (err: any) {
                    const formattedMsg = formatFreeeError(err.message)
                    result.failed.push({ date: dates[i], error: formattedMsg })
                }
            }

            if (result.failed.length > 0) setError(result.failed[0].error)
            return result
        } finally {
            setLoading(false)
            setBatchProgress(null)
        }
    }, [])

    const submitPaidLeaveWeb = useCallback(async (
        companyId: number,
        targetDate: string,
        leaveUnit: LeaveUnit,
        startAt: string | undefined,
        endAt: string | undefined,
        routeId: number,
        comment: string,
        departmentId?: number,
        routeName?: string,
        departmentName?: string
    ) => {
        setLoading(true)
        setError(null)
        try {
            const payload = { companyId, targetDate, leaveUnit, startAt, endAt, comment, routeId, departmentId, routeName: routeName ?? '', departmentName }
            return await (window.api as any).submitPaidLeaveWeb(payload)
        } catch (err: any) {
            setError(err.message)
            throw err
        } finally {
            setLoading(false)
        }
    }, [])

    const submitPaidLeaveBatch = useCallback(async (
        companyId: number,
        dates: string[],
        leaveUnit: LeaveUnit,
        _startAt: string | undefined,
        _endAt: string | undefined,
        routeId: number,
        comment: string,
        departmentId?: number,
        routeName?: string,
        departmentName?: string
    ): Promise<BatchResult> => {
        setLoading(true)
        setError(null)
        setBatchProgress({ current: 0, total: dates.length })

        const unsubscribe = window.api.onPaidLeaveBatchProgress((p) => {
            setBatchProgress({ current: p.current, total: p.total })
        })
        try {
            const result = await window.api.submitPaidLeaveWebBatch({
                companyId,
                items: dates.map(d => ({ targetDate: d })),
                leaveUnit,
                comment,
                routeId,
                routeName: routeName ?? '',
                departmentId,
                departmentName
            })
            if (result.failed.length > 0) setError(result.failed[0].error)
            return result
        } finally {
            unsubscribe()
            setLoading(false)
            setBatchProgress(null)
        }
    }, [])

    const submitHolidayWorkBatch = useCallback(async (
        companyId: number,
        dates: string[],
        startAt: string,
        endAt: string,
        routeId: number,
        comment: string,
        departmentId?: number,
        routeName?: string,
        departmentName?: string
    ): Promise<BatchResult> => {
        setLoading(true)
        setError(null)
        setBatchProgress({ current: 0, total: dates.length })

        const unsubscribe = window.api.onHolidayWorkBatchProgress((p) => {
            setBatchProgress({ current: p.current, total: p.total })
        })
        try {
            const result = await window.api.submitHolidayWorkWebBatch({
                companyId,
                items: dates.map(d => ({ targetDate: d, startAt, endAt })),
                comment,
                routeId,
                routeName: routeName ?? '',
                departmentId,
                departmentName
            })
            if (result.failed.length > 0) setError(result.failed[0].error)
            return result
        } finally {
            unsubscribe()
            setLoading(false)
            setBatchProgress(null)
        }
    }, [])

    const clearError = useCallback(() => setError(null), [])

    return { fetchRoutes, fetchDepartments, submitOvertime, submitOvertimeWeb, submitBatch, submitPaidLeaveWeb, submitPaidLeaveBatch, submitHolidayWorkBatch, loading, error, clearError, batchProgress }
}
