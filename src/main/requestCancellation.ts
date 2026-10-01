import type { CancelAction, CancelItem, CancelPhase, CancelProgress, CancelResult } from '../shared/requestCancellation'

export interface CancellationState {
  id: number
  status: string
  applicantId: number
  routeId: number | null
  targetDate: string
  currentRound: number | null
  currentStepId: number | null
}

export class CancellationApiError extends Error {
  constructor(message: string, public status?: number) { super(message) }
}

export interface CancellationDependencies {
  companyId: number
  applicantId: number
  read: (item: CancelItem) => Promise<CancellationState | null>
  cancel: (item: CancelItem, state: CancellationState) => Promise<void>
  delete: (item: CancelItem) => Promise<void>
  browser: (
    item: CancelItem, action: CancelAction,
    read: () => Promise<CancellationState | null>, phase: (phase: CancelPhase) => void,
  ) => Promise<void>
  delay?: (ms: number) => Promise<void>
  onProgress?: (progress: CancelProgress) => void
}

const kinds = new Set(['overtime', 'paid_holiday', 'holiday_work', 'monthly_attendance', 'work_time'])
const active = new Set<string>()
const deletable = (state: CancellationState): boolean => ['draft', 'feedback'].includes(state.status)
const unsupported = (error: unknown): boolean => error instanceof CancellationApiError
  && error.status === 400 && /役職、部門を利用する申請はWebから/.test(error.message)
const conflict = (error: unknown): boolean => error instanceof CancellationApiError
  && error.status === 400 && /申請が更新されています/.test(error.message)

export async function cancelRequests(
  input: CancelItem[], action: CancelAction, deps: CancellationDependencies,
): Promise<CancelResult> {
  if (!['delete', 'withdraw'].includes(action) || !Array.isArray(input)) throw new Error('不正な操作です。')
  const unique = new Map<string, CancelItem>()
  for (const item of input) {
    if (!item || !kinds.has(item.requestType) || !Number.isSafeInteger(item.requestId) || item.requestId <= 0) {
      throw new Error('申請種別またはIDが不正です。')
    }
    unique.set(`${deps.companyId}:${item.requestType}:${item.requestId}`, item)
  }
  // バッチ全体を先に予約。同じ申請に別ウィンドウから操作が重なるのを防ぐ。
  const keys = [...unique.keys()]
  if (keys.some((key) => active.has(key))) throw new Error('同じ申請を処理中です。完了後に一覧を更新してください。')
  keys.forEach((key) => active.add(key))
  const result: CancelResult = { total: unique.size, succeeded: 0, failed: [] }
  const delay = deps.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  let completed = 0
  const emit = (progress: CancelProgress): void => {
    // ウィンドウ終了などの通知失敗で、確定済みの操作結果を書き換えない。
    try { deps.onProgress?.(progress) } catch { /* 状態確認は継続する */ }
  }
  try {
    for (const item of unique.values()) {
      let withdrawn = false
      const phase = (value: CancelPhase): void => emit({ ...item, current: completed, total: result.total, phase: value })
      try {
        phase('checking')
        const original = await deps.read(item)
        if (!original) throw new Error('対象が見つかりません。一覧を更新してください。')
        const checkIdentity = (state: CancellationState | null): CancellationState | null => {
          if (state && (state.id !== item.requestId || state.applicantId !== deps.applicantId
            || state.routeId !== original.routeId || state.targetDate !== original.targetDate)) {
            throw new Error('申請者または申請内容が変わりました。操作を中止しました。')
          }
          return state
        }
        checkIdentity(original)
        const read = async (): Promise<CancellationState | null> => checkIdentity(await deps.read(item))
        const withdrawInBrowser = async (): Promise<void> => {
          try { await deps.browser(item, 'withdraw', read, phase) } catch (error) {
            // クリック成立後の画面タイムアウトも、書き込みを繰り返さず再照合する。
            const latest = await read()
            if (!latest || !deletable(latest)) throw error
          }
        }
        const waitFor = async (deleted: boolean): Promise<CancellationState | null> => {
          // 最大10回・15秒を超えて確認要求を開始しない。各GETも10秒で打ち切る。
          const deadline = Date.now() + 15000
          for (let attempt = 0; attempt < 10; attempt++) {
            if (Date.now() >= deadline) break
            const state = await read()
            if (deleted ? !state : state && deletable(state)) return state
            if (!state || !['in_progress', 'draft', 'feedback'].includes(state.status)) {
              throw new Error('申請の状態が変わりました。操作を中止しました。')
            }
            if (attempt < 9) await delay(500)
          }
          throw new Error(deleted ? '削除完了を確認できません。一覧を更新して状態を確認してください。' : '取り下げの完了を確認できません。削除は行っていません。')
        }

        let state = original
        let webOnly = item.requestType === 'holiday_work'
        if (state.status === 'in_progress') {
          phase('withdrawing')
          if (webOnly || state.currentRound == null || state.currentStepId == null) {
            webOnly = true
            await withdrawInBrowser()
          } else {
            try {
              await deps.cancel(item, state)
            } catch (error) {
              // 応答不明も含め、次の書き込みより先にサーバー状態を照合する。
              const latest = await read()
              if (latest && deletable(latest)) {
                state = latest
              } else if (latest?.status === 'in_progress' && unsupported(error)) {
                webOnly = true
                await withdrawInBrowser()
              } else if (latest?.status === 'in_progress' && conflict(error)
                && latest.currentRound != null && latest.currentStepId != null) {
                // 更新競合に限り、最新ステップで1回だけ再試行。
                try { await deps.cancel(item, latest) } catch (retryError) {
                  const afterRetry = await read()
                  if (!afterRetry || !deletable(afterRetry)) throw retryError
                }
              } else {
                throw error
              }
            }
          }
          phase('waiting')
          state = (await waitFor(false))!
          withdrawn = true
        }
        if (!deletable(state)) throw new Error('承認済みなど、取り下げ・削除できない状態です。')
        if (action === 'delete') {
          // 取り下げ後・操作直前にも状態を取得。途中の再申請・承認を見逃さない。
          const latest = await read()
          if (!latest || !deletable(latest)) throw new Error('削除前に申請の状態が変わりました。操作を中止しました。')
          phase('deleting')
          try {
            if (webOnly) await deps.browser(item, 'delete', read, phase)
            else await deps.delete(item)
          } catch (error) {
            const after = await read()
            if (after && deletable(after) && !webOnly && unsupported(error)) {
              try { await deps.browser(item, 'delete', read, phase) } catch (browserError) {
                if (await read()) throw browserError
              }
            } else if (after) {
              // 403・429・更新競合・通信断ではDELETEを繰り返さない。
              throw error
            }
            // 存在確認済み対象が404なら、応答喪失後も削除は成立している。
          }
          phase('verifying')
          await waitFor(true)
        }
        result.succeeded++
        completed++
        emit({ ...item, current: completed, total: result.total, phase: 'completed', success: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : '操作に失敗しました。'
        const failure = { ...item, withdrawn, error: withdrawn && action === 'delete' ? `取り下げ済み・削除未完了: ${message}` : message }
        result.failed.push(failure)
        completed++
        emit({ ...item, current: completed, total: result.total, phase: 'completed', success: false, error: failure.error })
      }
    }
    return result
  } finally {
    keys.forEach((key) => active.delete(key))
  }
}
