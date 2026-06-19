import { contextBridge, ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
  // Store
  storeGet: (key: string) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: any) => ipcRenderer.invoke('store-set', key, value),

  // ID→名前マッピング
  nameMapGetAll: () => ipcRenderer.invoke('name-map-get-all'),
  nameMapSet: (id: string, name: string) => ipcRenderer.invoke('name-map-set', id, name),
  nameMapDelete: (id: string) => ipcRenderer.invoke('name-map-delete', id),
  nameMapClear: () => ipcRenderer.invoke('name-map-clear'),

  // API calls (token is now managed automatically in main process)
  fetchRoutes: (companyId: number) => ipcRenderer.invoke('api-fetch-routes', companyId),
  fetchDepartments: (companyId: number) => ipcRenderer.invoke('api-fetch-departments', companyId),
  submitOvertime: (payload: any) => ipcRenderer.invoke('api-submit-overtime', payload),
  submitOvertimeWeb: (payload: any) => ipcRenderer.invoke('api-web-submit-overtime', payload),
  submitOvertimeWebBatch: (payload: any) => ipcRenderer.invoke('api-web-submit-overtime-batch', payload),
  submitWorkTime: (payload: any) => ipcRenderer.invoke('api-submit-work-time', payload),
  onOvertimeBatchProgress: (callback: (progress: any) => void) => {
    const listener = (_e: any, progress: any): void => callback(progress)
    ipcRenderer.on('overtime-batch-progress', listener)
    return () => ipcRenderer.removeListener('overtime-batch-progress', listener)
  },
  fetchApprovals: (options?: { limit?: number; statuses?: string[] }) =>
    ipcRenderer.invoke('api-fetch-approvals', options),
  fetchMyRequests: (options?: { months?: number }) =>
    ipcRenderer.invoke('api-fetch-my-requests', options),
  cancelRequestWeb: (payload: any) => ipcRenderer.invoke('api-cancel-request-web', payload),
  deleteRequestWeb: (payload: any) => ipcRenderer.invoke('api-delete-request-web', payload),
  cancelRequestWebBatch: (payload: any) => ipcRenderer.invoke('api-cancel-request-web-batch', payload),
  onCancelBatchProgress: (callback: (progress: any) => void) => {
    const listener = (_e: any, progress: any): void => callback(progress)
    ipcRenderer.on('cancel-batch-progress', listener)
    return () => ipcRenderer.removeListener('cancel-batch-progress', listener)
  },
  deleteRequestApi: (payload: any) => ipcRenderer.invoke('api-delete-request-api', payload),
  submitPaidLeave: (payload: any) => ipcRenderer.invoke('api-submit-paid-leave', payload),
  submitPaidLeaveWeb: (payload: any) => ipcRenderer.invoke('api-web-submit-paid-leave', payload),
  submitPaidLeaveWebBatch: (payload: any) => ipcRenderer.invoke('api-web-submit-paid-leave-batch', payload),
  submitHolidayWorkWebBatch: (payload: any) => ipcRenderer.invoke('api-web-submit-holiday-work-batch', payload),
  onPaidLeaveBatchProgress: (callback: (progress: any) => void) => {
    const listener = (_e: any, progress: any): void => callback(progress)
    ipcRenderer.on('paid-leave-batch-progress', listener)
    return () => ipcRenderer.removeListener('paid-leave-batch-progress', listener)
  },
  onHolidayWorkBatchProgress: (callback: (progress: any) => void) => {
    const listener = (_e: any, progress: any): void => callback(progress)
    ipcRenderer.on('holiday-work-batch-progress', listener)
    return () => ipcRenderer.removeListener('holiday-work-batch-progress', listener)
  },
  submitMonthlyClose: (payload: any) => ipcRenderer.invoke('api-submit-monthly-close', payload),
  submitMonthlyCloseWeb: (payload: any) => ipcRenderer.invoke('api-web-submit-monthly-close', payload),

  // 打刻
  fetchTimeClocks: (payload: any) => ipcRenderer.invoke('api-fetch-time-clocks', payload),
  fetchAvailableClockTypes: (payload: any) => ipcRenderer.invoke('api-fetch-available-clock-types', payload),
  submitTimeClock: (payload: any) => ipcRenderer.invoke('api-submit-time-clock', payload),
  submitTimeClockWeb: (payload: any) => ipcRenderer.invoke('api-web-submit-time-clock', payload),

  // ユーザー情報取得（companyId, applicantId, employeeId を API から自動解決）
  getUserInfo: () => ipcRenderer.invoke('api-get-user-info'),
  fetchManagerOvertimeSummaries: (options?: { year?: number; month?: number; thresholdMins?: number }) =>
    ipcRenderer.invoke('api-fetch-manager-overtime-summaries', options),

  // Web pre-login
  preLogin: () => ipcRenderer.invoke('api-pre-login'),

  // ログイン確認
  verifyLogin: (payload?: { email?: string; password?: string }) =>
    ipcRenderer.invoke('api-verify-login', payload),
  getLoginVerified: () => ipcRenderer.invoke('api-get-login-verified'),
  resetLoginVerified: () => ipcRenderer.invoke('api-reset-login-verified'),

  // 承認 / 差戻し
  approvalAction: (payload: any) => ipcRenderer.invoke('api-approval-action', payload),
  approvalBatch: (payloads: any[], options?: { comment?: string; action?: 'approve' | 'feedback' }) =>
    ipcRenderer.invoke('api-approval-batch', payloads, options),
  onApprovalBatchProgress: (callback: (progress: { current: number; total: number; type: string; id: number }) => void) => {
    const listener = (_e: any, progress: any): void => callback(progress)
    ipcRenderer.on('approval-batch-progress', listener)
    return () => ipcRenderer.removeListener('approval-batch-progress', listener)
  },

  // Token management
  getValidToken: () => ipcRenderer.invoke('token-get-valid'),
  getTokenStatus: () => ipcRenderer.invoke('token-status'),
  startAuthFlow: () => ipcRenderer.invoke('token-start-auth'),
  exchangeAuthCode: (code: string) => ipcRenderer.invoke('token-exchange-code', code),
  forceRefreshToken: () => ipcRenderer.invoke('token-force-refresh'),

  // App version
  getAppVersion: () => ipcRenderer.invoke('app-version'),

  // Auto approval
  getAutoApprovalStatus: (type?: 'overtime' | 'paid_holiday' | 'work_time') =>
    ipcRenderer.invoke('auto-approval-status', type),
  setAutoApprovalEnabled: (type: 'overtime' | 'paid_holiday' | 'work_time', enabled: boolean) =>
    ipcRenderer.invoke('auto-approval-set-enabled', type, enabled),
  setAutoApprovalHours: (type: 'overtime' | 'paid_holiday' | 'work_time', hours: Array<number | string>) =>
    ipcRenderer.invoke('auto-approval-set-hours', type, hours),
  setAutoApprovalRoutes: (type: 'overtime' | 'paid_holiday' | 'work_time', routeIds: number[], enabled?: boolean) =>
    ipcRenderer.invoke('auto-approval-set-routes', type, routeIds, enabled),
  getAutoApprovalNotifications: () => ipcRenderer.invoke('auto-approval-notifications-get'),
  clearAutoApprovalNotifications: () => ipcRenderer.invoke('auto-approval-notifications-clear'),
  approveAutoApprovalNotification: (
    notificationId: string,
    scope?: { applicantKey?: string; itemKey?: string; requestId?: number },
  ) => ipcRenderer.invoke('auto-approval-notification-approve', notificationId, scope),

  // Auto-update
  onUpdateAvailable: (callback: (version: string) => void) =>
    ipcRenderer.on('update-available', (_e, version) => callback(version)),
  onUpdateDownloaded: (callback: (version: string) => void) =>
    ipcRenderer.on('update-downloaded', (_e, version) => callback(version)),
  installUpdate: () => ipcRenderer.send('install-update')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
