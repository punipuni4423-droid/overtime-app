import { useState, useCallback } from 'react'

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

    // ─── Batch submit: sequential execution with progress ───
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
                if (departmentId) {
                    payload.department_id = departmentId
                }

                if (useWeb) {
                  await window.api.submitOvertimeWeb({
                    companyId,
                    applicantId,
                    targetDate: dates[i],
                    startAt,
                    endAt,
                    comment,
                    routeId,
                    departmentId,
                    routeName: routeName ?? '',
                    departmentName
                  })
                } else {
                  try {
                    await window.api.submitOvertime(payload)
                  } catch (apiErr: any) {
                    if (apiErr.message.includes('役職、部門を利用する申請はWebから')) {
                      await window.api.submitOvertimeWeb({
                        companyId,
                        applicantId,
                        targetDate: dates[i],
                        startAt,
                        endAt,
                        comment,
                        routeId,
                        departmentId,
                        routeName: routeName ?? '',
                        departmentName
                      })
                    } else {
                      throw apiErr
                    }
                  }
                }
                result.succeeded++
            } catch (err: any) {
                const formattedMsg = formatFreeeError(err.message)
                result.failed.push({ date: dates[i], error: formattedMsg })
            }
        }

        if (result.failed.length > 0) {
            setError(result.failed[0].error)
        }

        setLoading(false)
        setBatchProgress(null)
        return result
    }, [])

    const submitPaidLeaveWeb = useCallback(async (
        companyId: number,
        targetDate: string,
        leaveUnit: 'full_day' | 'am_half' | 'pm_half',
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
        leaveUnit: 'full_day' | 'am_half' | 'pm_half',
        startAt: string | undefined,
        endAt: string | undefined,
        routeId: number,
        comment: string,
        departmentId?: number,
        routeName?: string,
        departmentName?: string
    ): Promise<BatchResult> => {
        setLoading(true)
        setError(null)
        setBatchProgress({ current: 0, total: dates.length })

        const result: BatchResult = { total: dates.length, succeeded: 0, failed: [] }
        for (let i = 0; i < dates.length; i++) {
            setBatchProgress({ current: i + 1, total: dates.length })
            try {
                const batchPayload = {
                    companyId, targetDate: dates[i], leaveUnit, startAt, endAt,
                    comment, routeId, departmentId, routeName: routeName ?? '', departmentName
                }
                await (window.api as any).submitPaidLeaveWeb(batchPayload)
                result.succeeded++
            } catch (err: any) {
                result.failed.push({ date: dates[i], error: err.message })
            }
        }
        if (result.failed.length > 0) setError(result.failed[0].error)
        setLoading(false)
        setBatchProgress(null)
        return result
    }, [])

    return { fetchRoutes, fetchDepartments, submitOvertime, submitOvertimeWeb, submitBatch, submitPaidLeaveWeb, submitPaidLeaveBatch, loading, error, batchProgress }
}
