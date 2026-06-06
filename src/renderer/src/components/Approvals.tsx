import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  RefreshCw,
  ExternalLink,
  CalendarDays,
  Pencil,
  CheckCircle2,
  AlertTriangle,
  CheckSquare,
  Square,
  RotateCcw,
  Trash2,
  ShieldCheck,
  X,
  Clock3,
  ListChecks,
  Power,
} from 'lucide-react'
import { useNameMap } from '../hooks/useNameMap'
import { NameMapEditModal } from './NameMapEditModal'
import { useApprovalsCache } from '../hooks/useApprovalsCache'
import { useLoginVerified, checkLoginGate } from '../hooks/useLoginVerified'

type ApprovalType = 'overtime' | 'paid_holiday' | 'monthly_attendance' | 'work_time'
type AutoApprovalType = 'overtime' | 'paid_holiday' | 'work_time'
type AutoApprovalHour = number | string

const TYPE_LABEL: Record<ApprovalType, string> = {
  overtime: '残業',
  paid_holiday: '有給',
  monthly_attendance: '月次締め',
  work_time: '勤務修正',
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: '承認待ち',
  approved: '承認済み',
  feedback: '差戻し',
  draft: '下書き',
  rejected: '却下',
  denied: '却下',
  withdrawn: '取り下げ',
}

const STATUS_COLOR: Record<string, string> = {
  in_progress: 'bg-yellow-50 text-yellow-700 border-yellow-300',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  feedback: 'bg-amber-50 text-amber-700 border-amber-300',
  draft: 'bg-gray-100 text-gray-500 border-gray-300',
  rejected: 'bg-red-50 text-red-700 border-red-300',
  denied: 'bg-red-50 text-red-700 border-red-300',
  withdrawn: 'bg-gray-100 text-gray-500 border-gray-300',
}

type StatusFilter = 'in_progress' | 'approved' | 'mine_to_approve' | 'feedback'
type SubTab = 'overtime' | 'paid_holiday' | 'monthly_attendance' | 'work_time'

const FILTER_BUTTONS: { key: StatusFilter; label: string }[] = [
  { key: 'in_progress', label: '承認待ち' },
  { key: 'approved', label: '承認済み' },
  { key: 'mine_to_approve', label: '自分が承認者' },
  { key: 'feedback', label: '差戻し' },
]

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'overtime', label: '残業申請' },
  { key: 'paid_holiday', label: '有給申請' },
  { key: 'work_time', label: '勤務時間修正' },
  { key: 'monthly_attendance', label: '月次締め' },
]

const AUTO_APPROVAL_TAB_LABELS: Partial<Record<SubTab, string>> = {
  overtime: '残業申請',
  paid_holiday: '有給申請',
  work_time: '勤務時間修正',
}

const AUTO_APPROVAL_HOURS: AutoApprovalHour[] = [
  ...Array.from({ length: 16 }, (_, i) => i + 9),
].sort((a, b) => autoApprovalMinutes(a) - autoApprovalMinutes(b))

function autoApprovalMinutes(value: AutoApprovalHour): number {
  if (typeof value === 'string') {
    const [hh, mm] = value.split(':').map(Number)
    return hh * 60 + mm
  }
  return value * 60
}

function formatAutoApprovalHour(value: AutoApprovalHour): string {
  if (typeof value === 'string') return value
  return value === 24 ? '24:00' : `${value}:00`
}

function sameAutoApprovalHour(a: AutoApprovalHour, b: AutoApprovalHour): boolean {
  return String(a) === String(b)
}

interface ApprovalRouteOption {
  id: number
  name: string
}

function formatTargetDate(type: ApprovalType, targetDate: string): string {
  if (!targetDate) return '—'
  if (type === 'monthly_attendance') {
    const [y, m] = targetDate.split('-')
    return y && m ? `${y}年${m}月` : targetDate
  }
  return targetDate.replace(/-/g, '/')
}

function formatShortDate(date: string): string {
  if (!date) return '—'
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return date
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`
}

function displayName(
  rawName: string,
  id: number | string | null | undefined,
  resolve: (id: string | number | null | undefined) => string | null,
): string {
  if (id === null || id === undefined) return rawName
  if (rawName.startsWith('ID:')) {
    const overridden = resolve(id)
    if (overridden) return overridden
  }
  return rawName
}

interface EditTarget {
  id: string
  currentName: string
}

interface MyRequestRaw {
  type: 'overtime' | 'paid_holiday' | 'monthly_attendance' | 'work_time'
  id: number
  status: string
  targetDate: string
  startAt?: string
  endAt?: string
  comment?: string
  usageType?: string
  routeName?: string
  applicationNumber: number | null
}

const MONTHS_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '±1ヶ月' },
  { value: 2, label: '±2ヶ月' },
  { value: 3, label: '±3ヶ月' },
  { value: 4, label: '±4ヶ月' },
  { value: 5, label: '±5ヶ月' },
  { value: 6, label: '±6ヶ月' },
]

export function Approvals(): React.JSX.Element {
  const cache = useApprovalsCache()
  const { resolve } = useNameMap()
  const { status: loginStatus } = useLoginVerified()
  const [filter, setFilter] = useState<StatusFilter>('in_progress')
  const [subTab, setSubTab] = useState<SubTab>('overtime')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [opRunning, setOpRunning] = useState(false)
  const [opProgress, setOpProgress] = useState<{ current: number; total: number } | null>(null)
  const [opMessage, setOpMessage] = useState<string | null>(null)
  const [opError, setOpError] = useState<string | null>(null)
  const [routes, setRoutes] = useState<ApprovalRouteOption[]>([])
  const [autoApproval, setAutoApproval] = useState<{
    loading: boolean
    saving: boolean
    expanded: boolean
    routeExpanded: boolean
    enabled: boolean
    hours: AutoApprovalHour[]
    pendingHours: AutoApprovalHour[]
    allowedRouteIds: number[]
    pendingRouteIds: number[]
    nextRunTime: string
    message: string | null
    error: string | null
  }>({
    loading: false,
    saving: false,
    expanded: false,
    routeExpanded: false,
    enabled: false,
    hours: [12, 24],
    pendingHours: [12, 24],
    allowedRouteIds: [],
    pendingRouteIds: [],
    nextRunTime: '',
    message: null,
    error: null,
  })

  // マウント時にフェッチ（タブ切替で再マウントされるため毎回最新データを取得）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cache.refresh() }, [])

  // タブ切替時は選択をクリア（誤操作防止）
  const setFilterAndReset = useCallback((f: StatusFilter): void => {
    setFilter(f)
    setSelected(new Set())
    setOpMessage(null)
    setOpError(null)
  }, [])

  const setSubTabAndReset = useCallback((t: SubTab): void => {
    setSubTab(t)
    setSelected(new Set())
  }, [])

  const loadAutoApproval = useCallback(async (): Promise<void> => {
    if (!AUTO_APPROVAL_TAB_LABELS[subTab]) return
    setAutoApproval((prev) => ({ ...prev, loading: true, error: null, message: null }))
    try {
      const [status, userInfo] = await Promise.all([
        window.api.getAutoApprovalStatus(subTab as AutoApprovalType),
        window.api.getUserInfo(),
      ])
      const routeData = await window.api.fetchRoutes(userInfo.companyId)
      const nextRoutes = (routeData?.approval_flow_routes || routeData?.routes || [])
        .map((route: any) => ({ id: Number(route.id), name: String(route.name || '') }))
        .filter((route: ApprovalRouteOption) => Number.isInteger(route.id) && route.id > 0)
      const hours = Array.isArray(status?.hours) && status.hours.length > 0 ? status.hours : [12, 24]
      const allowedRouteIds = Array.isArray(status?.allowedRouteIds) ? status.allowedRouteIds : []
      setRoutes(nextRoutes)
      setAutoApproval((prev) => ({
        ...prev,
        loading: false,
        enabled: !!status?.enabled,
        hours,
        pendingHours: hours,
        allowedRouteIds,
        pendingRouteIds: allowedRouteIds,
        nextRunTime: status?.nextRunTime || '',
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : '自動承認設定の取得に失敗しました'
      setAutoApproval((prev) => ({ ...prev, loading: false, error: message }))
    }
  }, [subTab])

  useEffect(() => {
    if (filter === 'mine_to_approve' && AUTO_APPROVAL_TAB_LABELS[subTab]) {
      loadAutoApproval()
    }
  }, [filter, subTab, loadAutoApproval])

  const toggleAutoApprovalEnabled = async (): Promise<void> => {
    if (!AUTO_APPROVAL_TAB_LABELS[subTab]) return
    setAutoApproval((prev) => ({ ...prev, saving: true, error: null, message: null }))
    try {
      const status = await window.api.setAutoApprovalEnabled(
        subTab as AutoApprovalType,
        !autoApproval.enabled,
      )
      const hours = Array.isArray(status?.hours) && status.hours.length > 0 ? status.hours : [12, 24]
      const allowedRouteIds = Array.isArray(status?.allowedRouteIds) ? status.allowedRouteIds : []
      setAutoApproval((prev) => ({
        ...prev,
        saving: false,
        enabled: !!status?.enabled,
        hours,
        pendingHours: hours,
        allowedRouteIds,
        pendingRouteIds: allowedRouteIds,
        nextRunTime: status?.nextRunTime || '',
        message: status?.enabled ? '自動承認を有効化しました。' : '自動承認を無効化しました。',
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : '自動承認設定の保存に失敗しました'
      setAutoApproval((prev) => ({ ...prev, saving: false, error: message }))
    }
  }

  const toggleAutoApprovalHour = (hour: AutoApprovalHour): void => {
    setAutoApproval((prev) => {
      const exists = prev.pendingHours.some((value) => sameAutoApprovalHour(value, hour))
      const pendingHours = exists
        ? prev.pendingHours.filter((value) => !sameAutoApprovalHour(value, hour))
        : [...prev.pendingHours, hour].sort((a, b) => autoApprovalMinutes(a) - autoApprovalMinutes(b))
      return { ...prev, pendingHours, error: null, message: null }
    })
  }

  const saveAutoApprovalHours = async (): Promise<void> => {
    if (!AUTO_APPROVAL_TAB_LABELS[subTab]) return
    if (autoApproval.pendingHours.length === 0) {
      setAutoApproval((prev) => ({ ...prev, error: '実行時刻を1つ以上選択してください。' }))
      return
    }
    setAutoApproval((prev) => ({ ...prev, saving: true, error: null, message: null }))
    try {
      const status = await window.api.setAutoApprovalHours(
        subTab as AutoApprovalType,
        autoApproval.pendingHours,
      )
      const hours = Array.isArray(status?.hours) && status.hours.length > 0 ? status.hours : [12, 24]
      setAutoApproval((prev) => ({
        ...prev,
        saving: false,
        hours,
        pendingHours: hours,
        nextRunTime: status?.nextRunTime || '',
        message: '実行時刻を保存しました。',
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : '実行時刻の保存に失敗しました'
      setAutoApproval((prev) => ({ ...prev, saving: false, error: message }))
    }
  }

  const toggleAutoApprovalRoute = (routeId: number): void => {
    setAutoApproval((prev) => {
      const exists = prev.pendingRouteIds.includes(routeId)
      const pendingRouteIds = exists
        ? prev.pendingRouteIds.filter((id) => id !== routeId)
        : [...prev.pendingRouteIds, routeId].sort((a, b) => a - b)
      return { ...prev, pendingRouteIds, error: null, message: null }
    })
  }

  const saveAutoApprovalRoutes = async (): Promise<void> => {
    if (!AUTO_APPROVAL_TAB_LABELS[subTab]) return
    if (autoApproval.pendingRouteIds.length === 0) {
      setAutoApproval((prev) => ({ ...prev, error: '承認経路を1つ以上選択してください。' }))
      return
    }
    setAutoApproval((prev) => ({ ...prev, saving: true, error: null, message: null }))
    try {
      const status = await window.api.setAutoApprovalRoutes(
        subTab as AutoApprovalType,
        autoApproval.pendingRouteIds,
      )
      const allowedRouteIds = Array.isArray(status?.allowedRouteIds) ? status.allowedRouteIds : []
      setAutoApproval((prev) => ({
        ...prev,
        saving: false,
        allowedRouteIds,
        pendingRouteIds: allowedRouteIds,
        message: '承認経路を保存しました。',
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : '承認経路の保存に失敗しました'
      setAutoApproval((prev) => ({ ...prev, saving: false, error: message }))
    }
  }

  // 自分の申請（旧 MyRequests）の一覧
  const myRequestsBySubTab = useMemo(() => {
    return cache.myRequests.filter((r) => r.type === subTab)
  }, [cache.myRequests, subTab])

  // 承認関連の一覧
  const approvalsBySubTab = useMemo(() => {
    return cache.approvals.filter((it) => it.type === subTab)
  }, [cache.approvals, subTab])

  const filtered = useMemo(() => {
    if (filter === 'mine_to_approve') {
      return approvalsBySubTab.filter((it) => it.isApprover && it.status === 'in_progress')
    }
    if (filter === 'in_progress') {
      // 「承認待ち」= 自分の申請のうち承認済み以外（in_progress / draft / feedback）
      return myRequestsBySubTab.filter((r) => r.status !== 'approved')
    }
    if (filter === 'approved') {
      // 「承認済み」= 自分の申請のうち承認済みのみ
      return myRequestsBySubTab.filter((r) => r.status === 'approved')
    }
    return approvalsBySubTab.filter((it) => it.status === 'feedback')
  }, [filter, myRequestsBySubTab, approvalsBySubTab])

  const counts = useMemo(() => {
    const allFeedback = cache.approvals.filter((it) => it.status === 'feedback')
    const allApprover = cache.approvals.filter(
      (it) => it.isApprover && it.status === 'in_progress',
    )
    const myPending = cache.myRequests.filter((r) => r.status !== 'approved')
    const myApproved = cache.myRequests.filter((r) => r.status === 'approved')
    return {
      in_progress: myPending.length,
      approved: myApproved.length,
      mine_to_approve: allApprover.length,
      feedback: allFeedback.length,
    }
  }, [cache.approvals, cache.myRequests])

  const subCounts = useMemo(() => {
    if (filter === 'in_progress' || filter === 'approved') {
      const baseMine =
        filter === 'in_progress'
          ? cache.myRequests.filter((r) => r.status !== 'approved')
          : cache.myRequests.filter((r) => r.status === 'approved')
      return {
        overtime: baseMine.filter((r) => r.type === 'overtime').length,
        paid_holiday: baseMine.filter((r) => r.type === 'paid_holiday').length,
        work_time: baseMine.filter((r) => r.type === 'work_time').length,
        monthly_attendance: baseMine.filter((r) => r.type === 'monthly_attendance').length,
      }
    }
    const baseFilter = (it: ApprovalItem): boolean => {
      if (filter === 'mine_to_approve') return it.isApprover && it.status === 'in_progress'
      if (filter === 'feedback') return it.status === 'feedback'
      return false
    }
    return {
      overtime: cache.approvals.filter((it) => baseFilter(it) && it.type === 'overtime').length,
      paid_holiday: cache.approvals.filter((it) => baseFilter(it) && it.type === 'paid_holiday')
        .length,
      work_time: cache.approvals.filter((it) => baseFilter(it) && it.type === 'work_time').length,
      monthly_attendance: cache.approvals.filter(
        (it) => baseFilter(it) && it.type === 'monthly_attendance',
      ).length,
    }
  }, [filter, cache.approvals, cache.myRequests])

  const openInFreee = (id: number): void => {
    window.open(
      `https://p.secure.freee.co.jp/approval_requests#/requests/${id}`,
      '_blank',
    )
  }

  const itemKey = (type: string, id: number): string => `${type}-${id}`

  const toggleSelect = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // 全選択（現在表示中の selectable のみ）
  const selectableKeys = useMemo(() => {
    if (filter === 'mine_to_approve') {
      return (filtered as ApprovalItem[]).map((it) => itemKey(it.type, it.id))
    }
    if (filter === 'in_progress') {
      // 承認待ち = 自分の申請。全件チェック可能
      return (filtered as MyRequestRaw[]).map((r) => itemKey(r.type, r.id))
    }
    return []
  }, [filter, filtered])

  const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k))

  const toggleAll = (): void => {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        selectableKeys.forEach((k) => next.delete(k))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        selectableKeys.forEach((k) => next.add(k))
        return next
      })
    }
  }

  // 一括承認 / 一括差戻し（自分が承認者のみ）
  // コメント入力なし - confirm() のみで実行
  const handleBulkApproval = async (action: 'approve' | 'feedback'): Promise<void> => {
    const selectedItems = (filtered as ApprovalItem[]).filter((it) =>
      selected.has(itemKey(it.type, it.id)),
    )
    if (selectedItems.length === 0) return

    // ログイン確認（RPA に必要）
    const gate = checkLoginGate(loginStatus)
    if (!gate.ok) {
      window.alert(gate.message || 'メールアドレス・パスワードを確認してください。')
      return
    }
    if (!loginStatus.hasCredentials) {
      window.alert(
        '一括承認/差戻しはWeb画面自動操作で行われるため、設定画面で「メールアドレス・パスワード」を入力し「ログイン確認」を実行してください。',
      )
      return
    }

    const actionLabel = action === 'approve' ? '承認' : '差戻し'
    const confirmMessage =
      `${selectedItems.length}件を${actionLabel}します。よろしいですか？\n\n` +
      selectedItems
        .slice(0, 5)
        .map(
          (it) =>
            `• ${TYPE_LABEL[it.type]} ${displayName(it.applicantName, it.applicantId, resolve)} ${formatTargetDate(it.type, it.targetDate)}`,
        )
        .join('\n') +
      (selectedItems.length > 5 ? `\n…他 ${selectedItems.length - 5} 件` : '')

    if (!window.confirm(confirmMessage)) return

    setOpRunning(true)
    setOpError(null)
    setOpMessage(null)
    setOpProgress({ current: 0, total: selectedItems.length })

    const unsubscribe = window.api.onApprovalBatchProgress((p) => {
      setOpProgress({ current: p.current, total: p.total })
    })

    try {
      const payloads = selectedItems
        .filter(
          (it) =>
            it.type === 'overtime' ||
            it.type === 'paid_holiday' ||
            it.type === 'monthly_attendance' ||
            it.type === 'work_time',
        )
        .map((it) => ({
          type: it.type as 'overtime' | 'paid_holiday' | 'monthly_attendance' | 'work_time',
          id: it.id,
          targetRound: it.currentRound ?? 0,
          targetStepId: it.currentStepId ?? 0,
          action,
        }))

      const result = await window.api.approvalBatch(payloads, { action })
      const succeededKeys = result.results
        .filter((r) => r.success)
        .map((r) => ({ type: r.payload.type, id: r.payload.id }))
      cache.removeApprovals(succeededKeys)

      if (result.failed === 0) {
        setOpMessage(`${result.succeeded}件の${actionLabel}が完了しました。`)
      } else if (result.succeeded === 0) {
        const errs = result.results
          .filter((r) => !r.success)
          .map((r) => `${TYPE_LABEL[r.payload.type as ApprovalType]} #${r.payload.id}: ${r.message || ''}`)
          .join('\n')
        setOpError(`${result.failed}件すべて失敗しました。\n\n${errs}`)
      } else {
        const errs = result.results
          .filter((r) => !r.success)
          .map((r) => `${TYPE_LABEL[r.payload.type as ApprovalType]} #${r.payload.id}: ${r.message || ''}`)
          .join('\n')
        setOpError(
          `成功 ${result.succeeded}件 / 失敗 ${result.failed}件\n\n失敗した申請:\n${errs}`,
        )
      }
      setSelected(new Set())
    } catch (err) {
      const message = err instanceof Error ? err.message : '実行に失敗しました'
      setOpError(message)
    } finally {
      unsubscribe()
      setOpRunning(false)
      setOpProgress(null)
    }
  }

  // 自分の申請の取り下げ・削除（バッチ版 — ブラウザ1回起動で全件処理）
  const handleMineOperation = async (action: 'withdraw' | 'delete'): Promise<void> => {
    const selectedItems = (filtered as MyRequestRaw[]).filter((r) =>
      selected.has(itemKey(r.type, r.id)),
    )
    const itemsToProcess =
      action === 'withdraw'
        ? selectedItems.filter((i) => i.status === 'in_progress')
        : selectedItems
    if (itemsToProcess.length === 0) return

    const actionLabel = action === 'withdraw' ? '取り下げ' : '削除'
    if (!window.confirm(`${itemsToProcess.length}件を${actionLabel}します。よろしいですか？`)) {
      return
    }

    setOpRunning(true)
    setOpError(null)
    setOpMessage(null)
    setOpProgress({ current: 0, total: itemsToProcess.length })

    const unsubscribe = window.api.onCancelBatchProgress((p) => {
      setOpProgress({ current: p.current, total: p.total })
    })

    try {
      const batchItems = itemsToProcess.map((item) => ({
        requestType: item.type as 'overtime' | 'paid_holiday' | 'monthly_attendance',
        requestId: item.id,
      }))

      const result = await window.api.cancelRequestWebBatch({
        items: batchItems,
        action,
      })

      if (result.failed.length > 0) {
        const errorMessages = result.failed.map((f) => {
          const item = itemsToProcess.find((i) => i.id === f.requestId)
          const label = item
            ? `${TYPE_LABEL[item.type]} ${formatTargetDate(item.type, item.targetDate)}`
            : `ID:${f.requestId}`
          return `${label}: ${f.error}`
        })
        setOpError(errorMessages.join('\n'))
      }
      if (result.succeeded > 0) {
        setOpMessage(`${result.succeeded}件の${actionLabel}が完了しました。`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '実行に失敗しました'
      setOpError(message)
    } finally {
      unsubscribe()
      setOpRunning(false)
      setOpProgress(null)
      setSelected(new Set())
      await cache.refresh()
    }
  }

  const isTableMode = true // 全フィルタ表形式で統一

  // ───────────────────── render ─────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <div className="px-6 pt-4 pb-2 shrink-0 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-800">申請・承認</h2>
        <div className="flex items-center gap-3">
          {cache.lastFetchedAt > 0 && (
            <span className="text-[11px] text-gray-400">
              最終更新: {new Date(cache.lastFetchedAt).toLocaleTimeString('ja-JP')}
            </span>
          )}
          <button
            onClick={() => cache.refresh()}
            disabled={cache.loading || opRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#007B7E] border border-[#007B7E] rounded-lg hover:bg-[#007b7e10] disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={cache.loading ? 'animate-spin' : ''} />
            更新
          </button>
        </div>
      </div>

      {/* 主フィルタ */}
      <div className="px-6 pb-2 shrink-0 flex items-center gap-1.5 flex-wrap">
        {FILTER_BUTTONS.map((btn) => (
          <button
            key={btn.key}
            onClick={() => setFilterAndReset(btn.key)}
            className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-colors ${
              filter === btn.key
                ? 'bg-[#007B7E] text-white border-[#007B7E]'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {btn.label}
            <span className="ml-1 opacity-70">({counts[btn.key]})</span>
          </button>
        ))}
      </div>

      {/* 子タブ（種別） */}
      {isTableMode && (
        <div className="px-6 pb-2 shrink-0 flex items-center gap-1 border-b border-gray-200">
          {SUB_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSubTabAndReset(tab.key)}
              className={`px-3 py-1.5 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                subTab === tab.key
                  ? 'border-[#007B7E] text-[#007B7E]'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              <span className="ml-1 opacity-70">({subCounts[tab.key]})</span>
            </button>
          ))}
        </div>
      )}

      {filter === 'mine_to_approve' && AUTO_APPROVAL_TAB_LABELS[subTab] && (
        <div className="mx-6 mt-3 mb-1 px-4 py-3 bg-white border border-gray-200 rounded-lg shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Power size={15} className={autoApproval.enabled ? 'text-[#007B7E]' : 'text-gray-400'} />
                <span className="text-sm font-semibold text-gray-800">
                  {AUTO_APPROVAL_TAB_LABELS[subTab]} 自動承認
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full border ${
                    autoApproval.enabled
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-gray-50 text-gray-500 border-gray-200'
                  }`}
                >
                  {autoApproval.enabled ? '有効' : '無効'}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                {autoApproval.hours.map(formatAutoApprovalHour).join(' / ')}
                {autoApproval.nextRunTime ? ` ・ 次回 ${autoApproval.nextRunTime}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={toggleAutoApprovalEnabled}
                disabled={autoApproval.loading || autoApproval.saving}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50 ${
                  autoApproval.enabled
                    ? 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    : 'bg-[#007B7E] text-white border-[#007B7E] hover:bg-[#006669]'
                }`}
              >
                <Power size={13} />
                {autoApproval.enabled ? '無効化' : '有効化'}
              </button>
              <button
                onClick={() => setAutoApproval((prev) => ({ ...prev, expanded: !prev.expanded, error: null, message: null }))}
                disabled={autoApproval.loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#007B7E] border border-[#007B7E] rounded-lg hover:bg-[#007b7e10] disabled:opacity-50"
              >
                <Clock3 size={13} />
                時間設定
              </button>
              <button
                onClick={() => setAutoApproval((prev) => ({ ...prev, routeExpanded: !prev.routeExpanded, error: null, message: null }))}
                disabled={autoApproval.loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#007B7E] border border-[#007B7E] rounded-lg hover:bg-[#007b7e10] disabled:opacity-50"
              >
                <ListChecks size={13} />
                経路設定
              </button>
            </div>
          </div>

          {autoApproval.expanded && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(82px, 1fr))' }}>
                {AUTO_APPROVAL_HOURS.map((hour) => {
                  const checked = autoApproval.pendingHours.some((value) => sameAutoApprovalHour(value, hour))
                  return (
                    <label
                      key={String(hour)}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded border text-xs cursor-pointer ${
                        checked
                          ? 'bg-[#007b7e10] border-[#007B7E] text-[#007B7E]'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAutoApprovalHour(hour)}
                        className="w-3 h-3 accent-[#007B7E]"
                      />
                      {formatAutoApprovalHour(hour)}
                    </label>
                  )
                })}
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  onClick={saveAutoApprovalHours}
                  disabled={autoApproval.saving}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-[#007B7E] rounded-lg hover:bg-[#006669] disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>
          )}

          {autoApproval.routeExpanded && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <div className="max-h-44 overflow-y-auto grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                {routes.map((route) => {
                  const checked = autoApproval.pendingRouteIds.includes(route.id)
                  return (
                    <label
                      key={route.id}
                      className={`flex items-start gap-2 px-2 py-1.5 rounded border text-xs cursor-pointer ${
                        checked
                          ? 'bg-[#007b7e10] border-[#007B7E] text-[#007B7E]'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAutoApprovalRoute(route.id)}
                        className="mt-0.5 w-3 h-3 accent-[#007B7E]"
                      />
                      <span className="min-w-0">
                        <span className="font-mono text-[10px] text-gray-400 mr-1">{route.id}</span>
                        {route.name}
                      </span>
                    </label>
                  )
                })}
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  onClick={saveAutoApprovalRoutes}
                  disabled={autoApproval.saving || routes.length === 0}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-[#007B7E] rounded-lg hover:bg-[#006669] disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>
          )}

          {(autoApproval.message || autoApproval.error) && (
            <div
              className={`mt-2 px-3 py-2 rounded-lg border text-xs flex items-start gap-2 ${
                autoApproval.error
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}
            >
              <span className="flex-1">{autoApproval.error || autoApproval.message}</span>
              <button
                onClick={() => setAutoApproval((prev) => ({ ...prev, error: null, message: null }))}
                className="shrink-0 p-0.5 rounded hover:bg-white/70"
                title="閉じる"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* エラー */}
      {cache.error && (
        <div className="mx-6 mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg shrink-0">
          <p className="text-sm text-red-700">
            <span className="font-semibold">エラー:</span> {cache.error}
          </p>
        </div>
      )}

      {/* 期間選択（自分の申請: 承認待ち / 承認済み） */}
      {(filter === 'in_progress' || filter === 'approved') && (
        <div className="px-6 pt-2 shrink-0 flex items-center gap-2">
          <span className="text-xs text-gray-500">表示期間 (今日から):</span>
          <div className="flex items-center gap-1">
            {MONTHS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => cache.setMonths(opt.value)}
                disabled={cache.loading || opRunning}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-colors disabled:opacity-50 ${
                  cache.months === opt.value
                    ? 'bg-[#007B7E] text-white border-[#007B7E]'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 全選択チェックボックス（in_progress / mine_to_approve のみ） */}
      {(filter === 'mine_to_approve' || filter === 'in_progress') && filtered.length > 0 && (
        <div className="px-6 pt-2 shrink-0 flex items-center gap-3">
          <button
            onClick={toggleAll}
            disabled={opRunning}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            {allSelected ? (
              <CheckSquare size={14} className="text-[#007B7E]" />
            ) : (
              <Square size={14} />
            )}
            <span>{allSelected ? 'すべて解除' : 'すべて選択'}</span>
          </button>
          {selected.size > 0 && (
            <span className="text-xs text-[#007B7E] font-semibold">
              {selected.size}件選択中
            </span>
          )}
        </div>
      )}

      {/* リスト */}
      <div className="flex-1 overflow-y-auto px-6 pb-3 pt-2">
        {cache.loading && cache.lastFetchedAt === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            読み込み中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400">
            <CalendarDays size={32} className="mb-2 opacity-40" />
            <p className="text-sm">該当する申請はありません</p>
          </div>
        ) : filter === 'in_progress' || filter === 'approved' ? (
          <MyRequestsTable
            items={filtered as MyRequestRaw[]}
            subTab={subTab}
            selected={selected}
            selectable={filter === 'in_progress'}
            onToggle={toggleSelect}
            onOpen={openInFreee}
            disabled={opRunning}
          />
        ) : (
          <ApprovalsTable
            items={filtered as ApprovalItem[]}
            subTab={subTab}
            selected={selected}
            selectable={filter === 'mine_to_approve'}
            onToggle={toggleSelect}
            onOpen={openInFreee}
            resolve={resolve}
            onEditName={(target) => setEditTarget(target)}
            disabled={opRunning}
          />
        )}
      </div>

      {/* 進捗 / 結果バナー */}
      {(opRunning || opMessage || opError) && (
        <div className="px-6 shrink-0">
          {opProgress && opRunning && (
            <div className="mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
              処理中 ({opProgress.current}/{opProgress.total})...
            </div>
          )}
          {opError && (
            <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 whitespace-pre-wrap flex items-start gap-2">
              <span className="flex-1">{opError}</span>
              <button onClick={() => setOpError(null)} className="shrink-0 p-0.5 hover:bg-red-100 rounded transition-colors" title="閉じる">
                <X size={13} />
              </button>
            </div>
          )}
          {opMessage && (
            <div className="mb-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex items-start gap-2">
              <CheckCircle2 size={13} className="shrink-0 mt-0.5" />
              <span>{opMessage}</span>
            </div>
          )}
        </div>
      )}

      {/* 一括アクションバー（自分が承認者：選択中のみ） */}
      {filter === 'mine_to_approve' && selected.size > 0 && (
        <div className="px-6 pb-4 pt-2 shrink-0 flex gap-2 border-t border-gray-100 bg-white">
          <button
            onClick={() => handleBulkApproval('approve')}
            disabled={opRunning}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#007B7E] hover:bg-[#006669] disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-all active:scale-[0.98] shadow-md"
          >
            <ShieldCheck size={16} />
            <span>承認（{selected.size}件）</span>
          </button>
          <button
            onClick={() => handleBulkApproval('feedback')}
            disabled={opRunning}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-all active:scale-[0.98] shadow-md"
          >
            <AlertTriangle size={16} />
            <span>差戻し（{selected.size}件）</span>
          </button>
        </div>
      )}

      {/* 一括アクションバー（承認待ち = 自分の申請：選択中のみ） */}
      {filter === 'in_progress' && selected.size > 0 && (
        <div className="px-6 pb-4 pt-2 shrink-0 flex gap-2 border-t border-gray-100 bg-white">
          <button
            onClick={() => handleMineOperation('withdraw')}
            disabled={opRunning}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-all active:scale-[0.98] shadow-md"
          >
            <RotateCcw size={16} />
            <span>取り下げ（{selected.size}件）</span>
          </button>
          <button
            onClick={() => handleMineOperation('delete')}
            disabled={opRunning}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-500 hover:bg-red-600 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-all active:scale-[0.98] shadow-md"
          >
            <Trash2 size={16} />
            <span>削除（{selected.size}件）</span>
          </button>
        </div>
      )}

      {editTarget && (
        <NameMapEditModal
          id={editTarget.id}
          currentName={editTarget.currentName}
          onClose={() => setEditTarget(null)}
        />
      )}

    </div>
  )
}

interface ApprovalsTableProps {
  items: ApprovalItem[]
  subTab: SubTab
  selected: Set<string>
  selectable: boolean
  onToggle: (key: string) => void
  onOpen: (id: number) => void
  resolve: (id: string | number | null | undefined) => string | null
  onEditName: (target: EditTarget) => void
  disabled: boolean
}

function ApprovalsTable({
  items,
  subTab,
  selected,
  selectable,
  onToggle,
  onOpen,
  resolve,
  onEditName,
  disabled,
}: ApprovalsTableProps): React.JSX.Element {
  // 列構成（残業：申請者→対象日→残業時間→申請日→申請経路→コメント→操作）
  type Col = { key: string; label: string; width: string }
  const buildColumns = (): Col[] => {
    if (subTab === 'overtime' || subTab === 'work_time') {
      return [
        { key: 'appNo', label: '申請No.', width: '8%' },
        { key: 'applicant', label: '申請者', width: '18%' },
        { key: 'targetDate', label: '対象日', width: '9%' },
        { key: 'overtime', label: subTab === 'work_time' ? '修正時間' : '残業時間', width: '12%' },
        { key: 'issueDate', label: '申請日', width: '9%' },
        { key: 'route', label: '申請経路', width: '18%' },
        { key: 'comment', label: 'コメント', width: '18%' },
        { key: 'action', label: '操作', width: '8%' },
      ]
    }
    if (subTab === 'paid_holiday') {
      return [
        { key: 'appNo', label: '申請No.', width: '8%' },
        { key: 'applicant', label: '申請者', width: '18%' },
        { key: 'usage', label: '取得単位', width: '12%' },
        { key: 'targetDate', label: '対象日', width: '9%' },
        { key: 'issueDate', label: '申請日', width: '9%' },
        { key: 'route', label: '申請経路', width: '18%' },
        { key: 'comment', label: 'コメント', width: '18%' },
        { key: 'action', label: '操作', width: '8%' },
      ]
    }
    return [
      { key: 'appNo', label: '申請No.', width: '8%' },
      { key: 'applicant', label: '申請者', width: '20%' },
      { key: 'targetDate', label: '対象月', width: '12%' },
      { key: 'issueDate', label: '申請日', width: '10%' },
      { key: 'route', label: '申請経路', width: '20%' },
      { key: 'comment', label: 'コメント', width: '22%' },
      { key: 'action', label: '操作', width: '8%' },
    ]
  }
  const columns = buildColumns()

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-xs table-fixed">
        <colgroup>
          {selectable && <col style={{ width: '36px' }} />}
          {columns.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead className="bg-gray-50 text-gray-600">
          <tr className="border-b border-gray-200">
            {selectable && <th className="px-2 py-2"></th>}
            {columns.map((c) => (
              <th key={c.key} className="text-left font-semibold px-2 py-2">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const key = `${item.type}-${item.id}`
            const isSelected = selected.has(key)
            const applicantDisplay = displayName(item.applicantName, item.applicantId, resolve)
            const needsEdit =
              applicantDisplay.startsWith('ID:') &&
              item.applicantId !== null &&
              item.applicantId !== undefined
            const targetText =
              item.type === 'monthly_attendance'
                ? formatTargetDate(item.type, item.targetDate)
                : formatShortDate(item.targetDate)
            const issueText = formatShortDate(item.issueDate)
            const overtimeText = item.startAt && item.endAt ? `${item.startAt}–${item.endAt}` : '—'
            const usageText =
              [item.holidayType, item.usageType].filter(Boolean).join(' / ') || '—'
            return (
              <tr
                key={key}
                className={`border-b border-gray-100 last:border-0 align-top transition-colors ${
                  isSelected ? 'bg-[#007b7e0a]' : 'hover:bg-[#007b7e08]'
                }`}
              >
                {selectable && (
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => !disabled && onToggle(key)}
                      disabled={disabled}
                      className="text-gray-400 hover:text-[#007B7E] disabled:opacity-50"
                    >
                      {isSelected ? (
                        <CheckSquare size={16} className="text-[#007B7E]" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                  </td>
                )}
                <td className="px-2 py-2 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                  {item.applicationNumber !== null ? `#${item.applicationNumber}` : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-gray-800 truncate" title={applicantDisplay}>
                      {applicantDisplay}
                    </span>
                    {needsEdit && (
                      <button
                        onClick={() =>
                          onEditName({ id: String(item.applicantId), currentName: '' })
                        }
                        className="shrink-0 p-0.5 text-gray-400 hover:text-[#007B7E] transition-colors"
                        title="名前を登録"
                      >
                        <Pencil size={10} />
                      </button>
                    )}
                  </div>
                  {item.applicantId !== null && (
                    <div className="text-[10px] text-gray-400 truncate">ID:{item.applicantId}</div>
                  )}
                </td>
                {(subTab === 'overtime' || subTab === 'work_time') && (
                  <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{targetText}</td>
                )}
                {(subTab === 'overtime' || subTab === 'work_time') && (
                  <td className="px-2 py-2 font-mono text-gray-700 whitespace-nowrap">
                    {overtimeText}
                  </td>
                )}
                {subTab === 'paid_holiday' && (
                  <td className="px-2 py-2 text-gray-700 truncate" title={usageText}>
                    {usageText}
                  </td>
                )}
                {subTab !== 'overtime' && subTab !== 'work_time' && (
                  <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{targetText}</td>
                )}
                <td className="px-2 py-2 text-gray-500 whitespace-nowrap">{issueText}</td>
                <td className="px-2 py-2">
                  {item.routeName ? (
                    <span className="text-gray-700 truncate block" title={item.routeName}>
                      {item.routeName}
                    </span>
                  ) : (
                    <span className="text-amber-600">未設定</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  {item.comment ? (
                    <span
                      className="text-gray-600 line-clamp-2 whitespace-pre-wrap break-words"
                      title={item.comment}
                    >
                      {item.comment}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <button
                    onClick={() => onOpen(item.id)}
                    className="inline-flex items-center gap-0.5 text-[11px] text-[#007B7E] hover:text-[#005f61] transition-colors"
                    title="freeeで確認"
                  >
                    <ExternalLink size={11} />
                    <span>確認</span>
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface MyRequestsTableProps {
  items: MyRequestRaw[]
  subTab: SubTab
  selected: Set<string>
  selectable: boolean
  onToggle: (key: string) => void
  onOpen: (id: number) => void
  disabled: boolean
}

function MyRequestsTable({
  items,
  subTab,
  selected,
  selectable,
  onToggle,
  onOpen,
  disabled,
}: MyRequestsTableProps): React.JSX.Element {
  type Col = { key: string; label: string; width: string }
  const buildColumns = (): Col[] => {
    if (subTab === 'overtime' || subTab === 'work_time') {
      return [
        { key: 'appNo', label: '申請No.', width: '8%' },
        { key: 'status', label: '状態', width: '12%' },
        { key: 'targetDate', label: '対象日', width: '12%' },
        { key: 'overtime', label: subTab === 'work_time' ? '修正時間' : '残業時間', width: '14%' },
        { key: 'route', label: '申請経路', width: '20%' },
        { key: 'comment', label: 'コメント', width: '26%' },
        { key: 'action', label: '操作', width: '8%' },
      ]
    }
    if (subTab === 'paid_holiday') {
      return [
        { key: 'appNo', label: '申請No.', width: '8%' },
        { key: 'status', label: '状態', width: '12%' },
        { key: 'targetDate', label: '対象日', width: '12%' },
        { key: 'usage', label: '取得単位', width: '14%' },
        { key: 'route', label: '申請経路', width: '20%' },
        { key: 'comment', label: 'コメント', width: '26%' },
        { key: 'action', label: '操作', width: '8%' },
      ]
    }
    return [
      { key: 'appNo', label: '申請No.', width: '8%' },
      { key: 'status', label: '状態', width: '14%' },
      { key: 'targetDate', label: '対象月', width: '14%' },
      { key: 'route', label: '申請経路', width: '24%' },
      { key: 'comment', label: 'コメント', width: '32%' },
      { key: 'action', label: '操作', width: '8%' },
    ]
  }
  const columns = buildColumns()

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <table className="w-full text-xs table-fixed">
        <colgroup>
          {selectable && <col style={{ width: '36px' }} />}
          {columns.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead className="bg-gray-50 text-gray-600">
          <tr className="border-b border-gray-200">
            {selectable && <th className="px-2 py-2"></th>}
            {columns.map((c) => (
              <th key={c.key} className="text-left font-semibold px-2 py-2">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const key = `${item.type}-${item.id}`
            const isSelected = selected.has(key)
            const targetText =
              item.type === 'monthly_attendance'
                ? formatTargetDate(item.type, item.targetDate)
                : formatShortDate(item.targetDate)
            const overtimeText = item.startAt && item.endAt ? `${item.startAt}–${item.endAt}` : '—'
            const statusLabel = STATUS_LABEL[item.status] || item.status
            const statusClass =
              STATUS_COLOR[item.status] || 'bg-gray-100 text-gray-600 border-gray-300'
            return (
              <tr
                key={key}
                className={`border-b border-gray-100 last:border-0 align-top transition-colors ${
                  isSelected ? 'bg-[#007b7e0a]' : 'hover:bg-[#007b7e08]'
                }`}
              >
                {selectable && (
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => !disabled && onToggle(key)}
                      disabled={disabled}
                      className="text-gray-400 hover:text-[#007B7E] disabled:opacity-50"
                    >
                      {isSelected ? (
                        <CheckSquare size={16} className="text-[#007B7E]" />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                  </td>
                )}
                <td className="px-2 py-2 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                  {item.applicationNumber !== null ? `#${item.applicationNumber}` : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-2 py-2">
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold border ${statusClass}`}
                  >
                    {statusLabel}
                  </span>
                </td>
                <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{targetText}</td>
                {(subTab === 'overtime' || subTab === 'work_time') && (
                  <td className="px-2 py-2 font-mono text-gray-700 whitespace-nowrap">
                    {overtimeText}
                  </td>
                )}
                {subTab === 'paid_holiday' && (
                  <td className="px-2 py-2 text-gray-700 truncate" title={item.usageType || ''}>
                    {item.usageType || '—'}
                  </td>
                )}
                <td className="px-2 py-2">
                  {item.routeName ? (
                    <span className="text-gray-700 truncate block" title={item.routeName}>
                      {item.routeName}
                    </span>
                  ) : (
                    <span className="text-amber-600">未設定</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  {item.comment ? (
                    <span
                      className="text-gray-600 line-clamp-2 whitespace-pre-wrap break-words"
                      title={item.comment}
                    >
                      {item.comment}
                    </span>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <button
                    onClick={() => onOpen(item.id)}
                    className="inline-flex items-center gap-0.5 text-[11px] text-[#007B7E] hover:text-[#005f61] transition-colors"
                    title="freeeで確認"
                  >
                    <ExternalLink size={11} />
                    <span>確認</span>
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
