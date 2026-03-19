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

interface Window {
  api: {
    // Store
    storeGet: (key: string) => Promise<any>
    storeSet: (key: string, value: any) => Promise<void>

    // ユーザー情報（API自動解決）
    getUserInfo: () => Promise<{ companyId: number; applicantId: number; employeeId: number }>

    // API calls (token auto-managed)
    fetchRoutes: (companyId: number) => Promise<any>
    fetchDepartments: (companyId: number) => Promise<any>
    submitOvertime: (payload: any) => Promise<any>
    submitOvertimeWeb: (payload: any) => Promise<any>
    fetchApprovals: (companyId: number) => Promise<any>
    submitPaidLeave: (payload: any) => Promise<any>
    submitPaidLeaveWeb: (payload: any) => Promise<any>
    submitMonthlyClose: (payload: any) => Promise<any>
    submitMonthlyCloseWeb: (payload: any) => Promise<any>

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
