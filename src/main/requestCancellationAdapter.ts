import axios from 'axios'
import type { CancelItem, RequestKind } from '../shared/requestCancellation'
import { CancellationApiError, type CancellationDependencies, type CancellationState } from './requestCancellation'
import { createCancellationBrowser } from './requestCancellationBrowser'

const paths: Partial<Record<RequestKind, string>> = {
  overtime: 'overtime_works', paid_holiday: 'paid_holidays', monthly_attendance: 'monthly_attendances', work_time: 'work_times',
}

export function createCancellationAdapter(options: {
  companyId: number; applicantId: number; employeeId: number; headless: boolean
  getToken: () => Promise<string>
  getCredentials: () => { email: string; password: string }
}) {
  let browser: ReturnType<typeof createCancellationBrowser> | undefined
  const getBrowser = (): ReturnType<typeof createCancellationBrowser> => {
    if (!browser) {
      const { email, password } = options.getCredentials()
      if (!email || !password) throw new Error('この経路のWeb操作には、設定画面のログイン情報が必要です。')
      browser = createCancellationBrowser(email, password, options.headless)
    }
    return browser
  }
  const url = (item: CancelItem): string => {
    if (!paths[item.requestType]) throw new Error('この申請種別はWeb操作が必要です。')
    return `https://api.freee.co.jp/hr/api/v1/approval_requests/${paths[item.requestType]}/${item.requestId}`
  }
  const config = async () => ({
    headers: { Authorization: `Bearer ${await options.getToken()}`, Accept: 'application/json', 'FREEE-VERSION': '2022-02-01' },
    timeout: 10000,
  })
  const wrapError = (error: unknown): never => {
    if (axios.isAxiosError(error)) {
      const body = error.response?.data
      const message = typeof body === 'string' ? body : body ? JSON.stringify(body) : '通信に失敗しました。結果を確認してください。'
      throw new CancellationApiError(message, error.response?.status)
    }
    throw error
  }
  const deps: CancellationDependencies = {
    companyId: options.companyId, applicantId: options.applicantId,
    read: async (item): Promise<CancellationState | null> => {
      let record: Record<string, any>
      if (item.requestType === 'holiday_work') {
        const value = await (await getBrowser()).readHoliday(item.requestId)
        if (!value) return null
        const employee = Number(value.applicant_employee_id ?? value.employee_id)
        if (employee !== options.employeeId) throw new Error('本人の休日出勤申請であることを確認できません。')
        record = { ...value, applicant_id: options.applicantId }
      } else {
        try {
          const response = await axios.get(url(item), { ...await config(), params: { company_id: options.companyId } })
          const key = paths[item.requestType]!.replace(/s$/, '')
          record = response.data?.[key] || response.data
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 404) return null
          return wrapError(error)
        }
      }
      if (!record || Number(record.id) !== item.requestId || typeof record.status !== 'string') throw new Error('申請詳細の形式が不正です。')
      if (record.company_id != null && Number(record.company_id) !== options.companyId) throw new Error('対象事業所が一致しません。')
      return {
        id: Number(record.id), status: record.status, applicantId: Number(record.applicant_id),
        routeId: record.approval_flow_route_id == null ? null : Number(record.approval_flow_route_id),
        targetDate: String(record.target_date ?? record.date ?? `${record.target_year ?? ''}-${record.target_month ?? ''}`),
        currentRound: record.current_round ?? null, currentStepId: record.current_step_id ?? null,
      }
    },
    cancel: async (item, state) => {
      try {
        await axios.post(`${url(item)}/actions`, {
          company_id: options.companyId, approval_action: 'cancel',
          target_round: state.currentRound, target_step_id: state.currentStepId,
        }, await config())
      } catch (error) { wrapError(error) }
    },
    delete: async (item) => {
      try { await axios.delete(url(item), { ...await config(), params: { company_id: options.companyId } }) }
      catch (error) { wrapError(error) }
    },
    browser: async (item, action, read, phase) => (await getBrowser()).act(item, action, read, phase),
  }
  return { deps, close: async (): Promise<void> => { if (browser) await (await browser.catch(() => null))?.close() } }
}
