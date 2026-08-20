import { useState, useEffect, useCallback } from 'react'
import { X, Save, Trash2 } from 'lucide-react'
import { useNameMap } from '../hooks/useNameMap'

interface NameMapEditModalProps {
  id: string
  currentName?: string
  onClose: () => void
  onSaved?: () => void
}

export function NameMapEditModal({
  id,
  currentName,
  onClose,
  onSaved
}: NameMapEditModalProps) {
  const { all, setName, removeName } = useNameMap()
  const existing = all[id] ?? currentName ?? ''
  const [name, setNameInput] = useState<string>(existing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 初期表示時に既存値があれば入力欄にセット
  useEffect(() => {
    setNameInput(all[id] ?? currentName ?? '')
  }, [id, currentName, all])

  // Escでキャンセル
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSave = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('名前を入力してください')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await setName(id, trimmed)
      if (res.success) {
        onSaved?.()
        onClose()
      } else {
        setError(res.message || '保存に失敗しました')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存に失敗しました'
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [name, id, setName, onSaved, onClose])

  const handleDelete = useCallback(async () => {
    if (!confirm(`ID:${id} の登録を削除しますか？`)) return
    setSaving(true)
    setError(null)
    try {
      const res = await removeName(id)
      if (res.success) {
        onSaved?.()
        onClose()
      } else {
        setError('削除に失敗しました')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '削除に失敗しました'
      setError(message)
    } finally {
      setSaving(false)
    }
  }, [id, removeName, onSaved, onClose])

  const hasExisting = Boolean(all[id])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-[92%] max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-800">ID→名前 登録</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="閉じる"
          >
            <X size={18} />
          </button>
        </div>

        {/* 本文 */}
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">ID</label>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 font-mono">
              {id}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">表示名</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSave()
                }
              }}
              autoFocus
              className="w-full p-3 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#007B7E] focus:border-[#007B7E] outline-none transition-all text-sm"
              placeholder="例: 山田 太郎"
            />
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center gap-2">
          {hasExisting && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-red-600 border border-red-200 bg-white rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              <Trash2 size={12} />
              削除
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-3 py-2 text-xs font-semibold text-gray-600 border border-gray-300 bg-white rounded-lg hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="flex items-center gap-1 px-3 py-2 text-xs font-bold text-white bg-[#007B7E] rounded-lg hover:bg-[#006669] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              <Save size={12} />
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
