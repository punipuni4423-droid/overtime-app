import { contextBridge, ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
  // Store
  storeGet: (key: string) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: any) => ipcRenderer.invoke('store-set', key, value),

  // API calls (token is now managed automatically in main process)
  fetchRoutes: (companyId: number) => ipcRenderer.invoke('api-fetch-routes', companyId),
  fetchDepartments: (companyId: number) => ipcRenderer.invoke('api-fetch-departments', companyId),
  submitOvertime: (payload: any) => ipcRenderer.invoke('api-submit-overtime', payload),
  submitOvertimeWeb: (payload: any) => ipcRenderer.invoke('api-web-submit-overtime', payload),
  fetchApprovals: (companyId: number) => ipcRenderer.invoke('api-fetch-approvals', companyId),
  fetchMyRequests: (companyId: number) => ipcRenderer.invoke('api-fetch-my-requests', companyId),
  cancelRequestWeb: (payload: any) => ipcRenderer.invoke('api-cancel-request-web', payload),
  deleteRequestWeb: (payload: any) => ipcRenderer.invoke('api-delete-request-web', payload),
  deleteRequestApi: (payload: any) => ipcRenderer.invoke('api-delete-request-api', payload),
  submitPaidLeave: (payload: any) => ipcRenderer.invoke('api-submit-paid-leave', payload),
  submitPaidLeaveWeb: (payload: any) => ipcRenderer.invoke('api-web-submit-paid-leave', payload),
  submitMonthlyClose: (payload: any) => ipcRenderer.invoke('api-submit-monthly-close', payload),
  submitMonthlyCloseWeb: (payload: any) => ipcRenderer.invoke('api-web-submit-monthly-close', payload),

  // Web pre-login
  preLogin: () => ipcRenderer.invoke('api-pre-login'),

  // Token management
  getValidToken: () => ipcRenderer.invoke('token-get-valid'),
  getTokenStatus: () => ipcRenderer.invoke('token-status'),
  startAuthFlow: () => ipcRenderer.invoke('token-start-auth'),
  exchangeAuthCode: (code: string) => ipcRenderer.invoke('token-exchange-code', code),
  forceRefreshToken: () => ipcRenderer.invoke('token-force-refresh'),

  // App version
  getAppVersion: () => ipcRenderer.invoke('app-version'),

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
