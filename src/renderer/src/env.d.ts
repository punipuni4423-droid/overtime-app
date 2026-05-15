/// <reference types="vite/client" />

interface TokenResult {
  success: boolean
  token?: string
  authRequired?: boolean
  message?: string
  tokenData?: any
}

interface TokenStatus {
  hasToken: boolean
  isExpired: boolean
  expiresAt: string | null
  remainingMinutes: number | null
  refreshExpiresAt: string | null
  refreshIsExpired: boolean
}

interface ApprovalLog {
  userId: number | null
  userName: string
  action: string
  updatedAt: string
}

interface ApprovalItem {
  type: 'overtime' | 'paid_holiday' | 'monthly_attendance' | 'work_time'
  requestType: string
  id: number
  requestId: number
  applicationNumber: number | null
  applicantId: number | null
  applicantName: string
  approverIds: number[]
  approverNames: string[]
  targetDate: string
  startAt: string
  endAt: string
  issueDate: string
  comment: string
  status: string
  revokeStatus: string | null
  passedAutoCheck: boolean | null
  approvalFlowRouteId: number | null
  routeName: string
  currentStepId: number | null
  currentRound: number | null
  approvalFlowLogs: ApprovalLog[]
  usageType: string
  holidayType: string
  values: any
  departmentName: string
  isSelf: boolean
  isApprover: boolean
}

interface Window {
  api: {
    // Store
    storeGet: (key: string) => Promise<any>
    storeSet: (key: string, value: any) => Promise<void>

    // ID→名前マッピング
    nameMapGetAll: () => Promise<Record<string, string>>
    nameMapSet: (id: string, name: string) => Promise<{ success: boolean; message?: string }>
    nameMapDelete: (id: string) => Promise<{ success: boolean }>
    nameMapClear: () => Promise<{ success: boolean }>

    // ユーザー情報（API自動解決）
    getUserInfo: () => Promise<{ companyId: number; applicantId: number; employeeId: number }>

    // API calls (token auto-managed)
    fetchRoutes: (companyId: number) => Promise<any>
    fetchDepartments: (companyId: number) => Promise<any>
    submitOvertime: (payload: any) => Promise<any>
    submitOvertimeWeb: (payload: any) => Promise<any>
    submitOvertimeWebBatch: (payload: {
      companyId: number
      items: Array<{ targetDate: string; startAt: string; endAt: string }>
      comment: string
      routeId: number
      routeName: string
      departmentId?: number
      departmentName?: string
    }) => Promise<{ total: number; succeeded: number; failed: Array<{ date: string; error: string }> }>
    onOvertimeBatchProgress: (
      callback: (progress: { current: number; total: number; date: string; success: boolean; error?: string }) => void
    ) => () => void
    fetchApprovals: (options?: { limit?: number; statuses?: string[] }) => Promise<ApprovalItem[]>
    submitPaidLeave: (payload: any) => Promise<any>
    submitPaidLeaveWeb: (payload: any) => Promise<any>
    submitPaidLeaveWebBatch: (payload: {
      companyId: number
      items: Array<{ targetDate: string }>
      leaveUnit: 'full_day' | 'am_half' | 'pm_half'
      comment: string
      routeId: number
      routeName: string
      departmentId?: number
      departmentName?: string
    }) => Promise<{ total: number; succeeded: number; failed: Array<{ date: string; error: string }> }>
    onPaidLeaveBatchProgress: (
      callback: (progress: { current: number; total: number; date: string; success: boolean; error?: string }) => void
    ) => () => void
    cancelRequestWebBatch: (payload: {
      items: Array<{ requestType: 'overtime' | 'paid_holiday' | 'monthly_attendance'; requestId: number }>
      action: 'withdraw' | 'delete'
    }) => Promise<{ total: number; succeeded: number; failed: Array<{ requestId: number; error: string }> }>
    onCancelBatchProgress: (
      callback: (progress: { current: number; total: number; requestId: number; success: boolean; error?: string }) => void
    ) => () => void
    submitMonthlyClose: (payload: any) => Promise<any>
    submitMonthlyCloseWeb: (payload: any) => Promise<any>

    // ログイン確認
    verifyLogin: (payload?: {
      email?: string
      password?: string
    }) => Promise<{ success: boolean; message?: string; verifiedAt?: number }>
    getLoginVerified: () => Promise<{
      verified: boolean
      verifiedAt: number
      hasCredentials: boolean
    }>
    resetLoginVerified: () => Promise<{ success: boolean }>

    // 承認 / 差戻し
    approvalAction: (payload: {
      type: 'overtime' | 'paid_holiday' | 'monthly_attendance' | 'work_time'
      id: number
      targetRound: number
      targetStepId: number
      action: 'approve' | 'feedback' | 'cancel' | 'force_feedback'
    }) => Promise<{ success: boolean; status?: number; data?: unknown; message?: string }>
    approvalBatch: (
      payloads: Array<{
        type: 'overtime' | 'paid_holiday' | 'monthly_attendance' | 'work_time'
        id: number
        targetRound: number
        targetStepId: number
        action: 'approve' | 'feedback' | 'cancel' | 'force_feedback'
      }>,
      options?: { comment?: string; action?: 'approve' | 'feedback' }
    ) => Promise<{
      total: number
      succeeded: number
      failed: number
      results: Array<{
        payload: { type: string; id: number; action: string }
        success: boolean
        status?: number
        message?: string
      }>
    }>
    onApprovalBatchProgress: (
      callback: (progress: { current: number; total: number; type: string; id: number }) => void
    ) => () => void

    // Token management
    getValidToken: () => Promise<TokenResult>
    getTokenStatus: () => Promise<TokenStatus>
    startAuthFlow: () => Promise<TokenResult>
    exchangeAuthCode: (code: string) => Promise<TokenResult>
    forceRefreshToken: () => Promise<TokenResult>

    // App version
    getAppVersion: () => Promise<string>

    // Auto-update
    onUpdateAvailable: (callback: (version: string) => void) => void
    onUpdateDownloaded: (callback: (version: string) => void) => void
    installUpdate: () => void
  }
}
