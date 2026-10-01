export type RequestKind = 'overtime' | 'paid_holiday' | 'holiday_work' | 'monthly_attendance' | 'work_time'
export type CancelAction = 'withdraw' | 'delete'
export type CancelPhase = 'checking' | 'withdrawing' | 'waiting' | 'deleting' | 'verifying' | 'refreshing' | 'completed'

export interface CancelItem {
  requestType: RequestKind
  requestId: number
}

export interface CancelProgress extends CancelItem {
  current: number
  total: number
  phase: CancelPhase
  success?: boolean
  error?: string
}

export interface CancelFailure extends CancelItem {
  error: string
  withdrawn: boolean
}

export interface CancelResult {
  total: number
  succeeded: number
  failed: CancelFailure[]
}

export const CANCEL_PHASE_LABEL: Record<CancelPhase, string> = {
  checking: '最新状態を確認中',
  withdrawing: '取り下げ中',
  waiting: '状態の更新を確認中',
  deleting: '削除中',
  verifying: '削除完了を確認中',
  refreshing: '一覧から開き直しています',
  completed: '処理完了',
}
