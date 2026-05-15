import { useEffect, useState, useCallback } from 'react'

interface MyRequestRaw {
  type: 'overtime' | 'paid_holiday' | 'monthly_attendance'
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

interface State {
  approvals: ApprovalItem[]
  myRequests: MyRequestRaw[]
  loading: boolean
  error: string | null
  lastFetchedAt: number
  /** 自分の申請の表示期間（±N ヶ月）。デフォルト 1 */
  months: number
}

const initialState: State = {
  approvals: [],
  myRequests: [],
  loading: false,
  error: null,
  lastFetchedAt: 0,
  months: 1,
}

let state: State = initialState
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((l) => l())
}

function setState(patch: Partial<State>): void {
  state = { ...state, ...patch }
  notify()
}

async function load(force: boolean, months: number): Promise<void> {
  if (inflight) return inflight
  if (!force && state.lastFetchedAt > 0 && state.months === months) return
  setState({ loading: true, error: null, months })
  inflight = (async () => {
    try {
      const [approvals, myRequests] = await Promise.all([
        window.api.fetchApprovals({ limit: 50 }),
        (
          window.api as unknown as {
            fetchMyRequests: (opts?: { months?: number }) => Promise<MyRequestRaw[]>
          }
        ).fetchMyRequests({ months }),
      ])
      setState({
        approvals: Array.isArray(approvals) ? approvals : [],
        myRequests: Array.isArray(myRequests) ? myRequests : [],
        loading: false,
        lastFetchedAt: Date.now(),
        error: null,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : '取得に失敗しました'
      setState({ loading: false, error: message })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export function useApprovalsCache(): {
  approvals: ApprovalItem[]
  myRequests: MyRequestRaw[]
  loading: boolean
  error: string | null
  lastFetchedAt: number
  months: number
  refresh: () => Promise<void>
  ensureLoaded: () => Promise<void>
  setMonths: (months: number) => Promise<void>
  removeApprovals: (keys: Array<{ type: string; id: number }>) => void
} {
  const [, force] = useState(0)

  useEffect(() => {
    const listener = (): void => force((n) => n + 1)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    await load(true, state.months)
  }, [])

  const ensureLoaded = useCallback(async (): Promise<void> => {
    await load(false, state.months)
  }, [])

  // 期間変更: キャッシュを使わず必ず再取得
  const setMonths = useCallback(async (months: number): Promise<void> => {
    if (months === state.months) return
    await load(true, months)
  }, [])

  // 一括承認後など、特定のアイテムだけキャッシュから消したいとき
  const removeApprovals = useCallback(
    (keys: Array<{ type: string; id: number }>): void => {
      const keySet = new Set(keys.map((k) => `${k.type}-${k.id}`))
      const next = state.approvals.filter((it) => !keySet.has(`${it.type}-${it.id}`))
      setState({ approvals: next })
    },
    [],
  )

  return {
    approvals: state.approvals,
    myRequests: state.myRequests,
    loading: state.loading,
    error: state.error,
    lastFetchedAt: state.lastFetchedAt,
    months: state.months,
    refresh,
    ensureLoaded,
    setMonths,
    removeApprovals,
  }
}
