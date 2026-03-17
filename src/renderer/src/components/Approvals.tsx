import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, ExternalLink, Clock, CalendarDays, User } from 'lucide-react'

interface ApprovalItem {
  type: 'overtime' | 'paid_holiday' | 'monthly_attendance'
  id: number
  applicantId: number
  applicantName: string
  targetDate: string
  startAt?: string
  endAt?: string
  comment: string
  usageType?: string
  routeName?: string
  departmentName?: string
  isSelf?: boolean
}

const TYPE_LABEL: Record<ApprovalItem['type'], string> = {
  overtime: '残業',
  paid_holiday: '有給',
  monthly_attendance: '月次締め',
}

const TYPE_COLOR: Record<ApprovalItem['type'], string> = {
  overtime: 'bg-orange-100 text-orange-700',
  paid_holiday: 'bg-green-100 text-green-700',
  monthly_attendance: 'bg-blue-100 text-blue-700',
}

function formatTargetDate(type: ApprovalItem['type'], targetDate: string): string {
  if (!targetDate) return '—'
  if (type === 'monthly_attendance') {
    // "2026-03" → "2026年03月"
    const [y, m] = targetDate.split('-')
    return y && m ? `${y}年${m}月` : targetDate
  }
  // "2026-03-15" → "2026/03/15"
  return targetDate.replace(/-/g, '/')
}

export function Approvals() {
  const [items, setItems] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<number | null>(null)

  useEffect(() => {
    window.api.storeGet('COMPANY_ID').then((id: any) => setCompanyId(Number(id)))
  }, [])

  const fetchApprovals = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const data = await (window.api as any).fetchApprovals(companyId)
      setItems(data || [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (companyId) fetchApprovals()
  }, [companyId, fetchApprovals])

  const openInFreee = (id: number) => {
    window.open(`https://p.secure.freee.co.jp/approval_requests#/requests/${id}`, '_blank')
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <div className="px-6 pt-4 pb-3 shrink-0 flex items-center justify-between">
        <h2 className="text-base font-bold text-gray-800">承認待ち一覧</h2>
        <button
          onClick={fetchApprovals}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#007B7E] border border-[#007B7E] rounded-lg hover:bg-[#007b7e10] disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          更新
        </button>
      </div>

      {/* エラー */}
      {error && (
        <div className="mx-6 mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg shrink-0">
          <p className="text-sm text-red-700"><span className="font-semibold">エラー:</span> {error}</p>
        </div>
      )}

      {/* リスト */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            読み込み中...
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400">
            <CalendarDays size={32} className="mb-2 opacity-40" />
            <p className="text-sm">承認待ちの申請はありません</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <div
                key={`${item.type}-${item.id}`}
                className={`bg-white rounded-xl border px-4 py-3 ${item.isSelf ? 'border-[#007B7E]/40' : 'border-gray-200'}`}
              >
                {/* 1行目: バッジ + 申請者 + 日付 + 確認ボタン */}
                <div className="flex items-center gap-2 mb-2">
                  <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-bold ${TYPE_COLOR[item.type]}`}>
                    {TYPE_LABEL[item.type]}
                  </span>
                  {item.isSelf && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-bold bg-[#007b7e15] text-[#007B7E] border border-[#007B7E]/30">
                      自分
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-sm font-semibold text-gray-800 truncate">
                    <User size={13} className="shrink-0 text-gray-400" />
                    {item.applicantName}
                  </span>
                  <span className="ml-auto shrink-0 text-xs font-semibold text-gray-600">
                    {formatTargetDate(item.type, item.targetDate)}
                  </span>
                </div>

                {/* 2行目: 時間（残業のみ） */}
                {item.type === 'overtime' && item.startAt && item.endAt && (
                  <div className="flex items-center gap-1 text-xs text-gray-600 mb-1.5">
                    <Clock size={11} className="shrink-0" />
                    <span>{item.startAt} ～ {item.endAt}</span>
                  </div>
                )}

                {/* 取得単位（有給のみ） */}
                {item.type === 'paid_holiday' && item.usageType && (
                  <div className="text-xs text-gray-600 mb-1.5">
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded font-medium">{item.usageType}</span>
                  </div>
                )}

                {/* 申請経路 */}
                {item.routeName ? (
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="shrink-0 text-xs text-gray-400">経路:</span>
                    <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded-full truncate">{item.routeName}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="shrink-0 text-xs text-gray-400">経路:</span>
                    <span className="text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">未設定</span>
                  </div>
                )}

                {/* 部門 */}
                {item.departmentName && (
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="shrink-0 text-xs text-gray-400">部門:</span>
                    <span className="text-xs text-gray-600 truncate">{item.departmentName}</span>
                  </div>
                )}

                {/* コメント */}
                {item.comment && (
                  <p className="text-xs text-gray-500 mb-1.5 line-clamp-2">{item.comment}</p>
                )}

                {/* 確認ボタン */}
                <div className="flex justify-end mt-2">
                  <button
                    onClick={() => openInFreee(item.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-[#007B7E] border border-[#007B7E] rounded-lg hover:bg-[#007b7e10] transition-colors"
                  >
                    <ExternalLink size={12} />
                    freeeで確認
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
