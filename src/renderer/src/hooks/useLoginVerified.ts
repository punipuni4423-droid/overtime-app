import { useEffect, useState, useCallback } from 'react'

interface LoginStatus {
  verified: boolean
  verifiedAt: number
  hasCredentials: boolean
}

const initial: LoginStatus = { verified: false, verifiedAt: 0, hasCredentials: false }
let cache: LoginStatus = initial
let initialized = false
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((l) => l())
}

async function refreshFromMain(): Promise<LoginStatus> {
  const status = await window.api.getLoginVerified()
  cache = status
  notify()
  return status
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return
  initialized = true
  await refreshFromMain()
}

export function useLoginVerified(): {
  status: LoginStatus
  refresh: () => Promise<LoginStatus>
  reset: () => Promise<void>
} {
  const [, force] = useState(0)

  useEffect(() => {
    const listener = (): void => force((n) => n + 1)
    listeners.add(listener)
    ensureInitialized()
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const refresh = useCallback(async (): Promise<LoginStatus> => {
    return await refreshFromMain()
  }, [])

  const reset = useCallback(async (): Promise<void> => {
    await window.api.resetLoginVerified()
    await refreshFromMain()
  }, [])

  return { status: cache, refresh, reset }
}

/**
 * 申請ボタンをクリックしようとしたときに呼ぶ。
 * 未確認の状態（credentials があるが verified=false）なら警告を出して false を返す。
 * verified もしくは credentials なしなら true を返す（後者は API モードで動く想定）。
 */
export function checkLoginGate(status: LoginStatus): { ok: boolean; message?: string } {
  if (!status.hasCredentials) {
    return { ok: true }
  }
  if (!status.verified) {
    return {
      ok: false,
      message:
        '設定画面でメールアドレス・パスワードを確認してください。\n（設定 → Web版自動操作用ログイン情報 → ログイン確認）',
    }
  }
  return { ok: true }
}
