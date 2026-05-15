import { useEffect, useState, useCallback } from 'react'

let cache: Record<string, string> = {}
let initialized = false
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((l) => l())
}

async function loadInitial(): Promise<void> {
  if (initialized) return
  initialized = true
  try {
    cache = await window.api.nameMapGetAll()
    notify()
  } catch {
    // Initialize as empty if backend call fails — non-fatal for UI.
    initialized = false
  }
}

export interface UseNameMapResult {
  all: Record<string, string>
  resolve: (id: string | number | null | undefined) => string | null
  setName: (id: string, name: string) => Promise<{ success: boolean; message?: string }>
  removeName: (id: string) => Promise<{ success: boolean }>
  clearAll: () => Promise<{ success: boolean }>
  refresh: () => Promise<void>
}

export function useNameMap(): UseNameMapResult {
  const [, force] = useState(0)

  useEffect(() => {
    const listener = (): void => force((n) => n + 1)
    listeners.add(listener)
    loadInitial()
    return () => {
      listeners.delete(listener)
    }
  }, [])

  const resolve = useCallback((id: string | number | null | undefined): string | null => {
    if (id === null || id === undefined || id === '') return null
    return cache[String(id)] ?? null
  }, [])

  const setName = useCallback(
    async (id: string, name: string): Promise<{ success: boolean; message?: string }> => {
      const res = await window.api.nameMapSet(id, name)
      if (res.success) {
        cache = { ...cache, [String(id).trim()]: name.trim() }
        notify()
      }
      return res
    },
    []
  )

  const removeName = useCallback(async (id: string): Promise<{ success: boolean }> => {
    const res = await window.api.nameMapDelete(id)
    if (res.success) {
      const key = String(id).trim()
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(cache)) {
        if (k !== key) next[k] = v
      }
      cache = next
      notify()
    }
    return res
  }, [])

  const clearAll = useCallback(async (): Promise<{ success: boolean }> => {
    const res = await window.api.nameMapClear()
    if (res.success) {
      cache = {}
      notify()
    }
    return res
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    cache = await window.api.nameMapGetAll()
    notify()
  }, [])

  return { all: cache, resolve, setName, removeName, clearAll, refresh }
}

/**
 * "ID:123" 形式の表示文字列から ID 部分だけを抜き出す。
 * マッチしなければ null を返す。
 */
export function extractIdFromDisplay(display: string): string | null {
  const match = display.match(/^ID:(\d+)$/)
  return match ? match[1] : null
}
