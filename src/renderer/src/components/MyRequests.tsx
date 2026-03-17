import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Clock, CalendarDays, Trash2, RotateCcw, CheckSquare, Square } from 'lucide-react'

interface MyRequest {
    type: 'overtime' | 'paid_holiday' | 'monthly_attendance'
    id: number
    status: string
    targetDate: string
    startAt?: string
    endAt?: string
    comment?: string
    usageType?: string
    routeName?: string
}

const TYPE_LABEL: Record<MyRequest['type'], string> = {
    overtime: '残業',
    paid_holiday: '有給',
    monthly_attendance: '月次締め',
}

const TYPE_COLOR: Record<MyRequest['type'], string> = {
    overtime: 'bg-orange-100 text-orange-700',
    paid_holiday: 'bg-green-100 text-green-700',
    monthly_attendance: 'bg-blue-100 text-blue-700',
}

const STATUS_LABEL: Record<string, string> = {
    in_progress: '承認待ち',
    draft: '下書き',
}

const STATUS_COLOR: Record<string, string> = {
    in_progress: 'bg-yellow-50 text-yellow-700 border-yellow-300',
    draft: 'bg-gray-100 text-gray-500 border-gray-300',
}

function formatTargetDate(type: MyRequest['type'], targetDate: string): string {
    if (!targetDate) return '—'
    if (type === 'monthly_attendance') {
        const [y, m] = targetDate.split('-')
        return y && m ? `${y}年${m}月` : targetDate
    }
    return targetDate.replace(/-/g, '/')
}

type FilterType = 'in_progress' | 'draft' | 'all'

const FILTER_BUTTONS: { key: FilterType; label: string }[] = [
    { key: 'in_progress', label: '承認待ち' },
    { key: 'draft', label: '下書き' },
    { key: 'all', label: '全て' },
]

export function MyRequests() {
    const [items, setItems] = useState<MyRequest[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [companyId, setCompanyId] = useState<number | null>(null)
    const [filterType, setFilterType] = useState<FilterType>('in_progress')
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [operating, setOperating] = useState(false)
    const [opProgress, setOpProgress] = useState<{ current: number; total: number } | null>(null)
    const [opError, setOpError] = useState<string | null>(null)
    const [opSuccess, setOpSuccess] = useState<string | null>(null)

    useEffect(() => {
        window.api.storeGet('COMPANY_ID').then((id: any) => setCompanyId(Number(id)))
    }, [])

    const fetchRequests = useCallback(async () => {
        if (!companyId) return
        setLoading(true)
        setError(null)
        setSelected(new Set())
        setOpError(null)
        setOpSuccess(null)
        try {
            const data = await (window.api as any).fetchMyRequests(companyId)
            setItems(data || [])
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [companyId])

    useEffect(() => {
        if (companyId) fetchRequests()
    }, [companyId, fetchRequests])

    const filteredItems = filterType === 'all' ? items : items.filter(item => item.status === filterType)

    const itemKey = (item: MyRequest) => `${item.type}-${item.id}`

    const toggleSelect = (key: string) => {
        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    const allFilteredSelected = filteredItems.length > 0 && filteredItems.every(item => selected.has(itemKey(item)))

    const toggleAll = () => {
        if (allFilteredSelected) {
            // フィルター中のアイテムのみ解除
            setSelected(prev => {
                const next = new Set(prev)
                filteredItems.forEach(item => next.delete(itemKey(item)))
                return next
            })
        } else {
            // フィルター中のアイテムのみ選択（他のフィルターの選択は保持）
            setSelected(prev => {
                const next = new Set(prev)
                filteredItems.forEach(item => next.add(itemKey(item)))
                return next
            })
        }
    }

    const selectedItems = items.filter(item => selected.has(itemKey(item)))
    // 取り下げ対象：in_progress のみ（draft は取り下げ不可）
    const selectedInProgress = selectedItems.filter(i => i.status === 'in_progress')

    const handleOperation = async (action: 'withdraw' | 'delete') => {
        // 取り下げは in_progress のみ対象
        const itemsToProcess = action === 'withdraw' ? selectedInProgress : selectedItems
        if (itemsToProcess.length === 0) return
        setOperating(true)
        setOpError(null)
        setOpSuccess(null)
        setOpProgress({ current: 0, total: itemsToProcess.length })

        const errors: string[] = []
        let successCount = 0

        for (let i = 0; i < itemsToProcess.length; i++) {
            const item = itemsToProcess[i]
            setOpProgress({ current: i + 1, total: itemsToProcess.length })
            try {
                if (action === 'withdraw') {
                    // in_progress のみここに来る
                    await (window.api as any).cancelRequestWeb({ requestType: item.type, requestId: item.id })
                } else {
                    // draft → REST API直接削除（高速）
                    // in_progress → ブラウザで「取り下げ→削除」の2ステップ
                    if (item.status === 'draft') {
                        await (window.api as any).deleteRequestApi({ requestType: item.type, requestId: item.id, companyId })
                    } else {
                        await (window.api as any).deleteRequestWeb({ requestType: item.type, requestId: item.id })
                    }
                }
                successCount++
            } catch (err: any) {
                errors.push(`${TYPE_LABEL[item.type]} ${formatTargetDate(item.type, item.targetDate)}: ${err.message}`)
            }
        }

        setOperating(false)
        setOpProgress(null)

        if (errors.length > 0) setOpError(errors.join('\n'))
        if (successCount > 0) {
            const actionLabel = action === 'withdraw' ? '取り下げ' : '削除'
            setOpSuccess(`${successCount}件の${actionLabel}が完了しました。`)
            setTimeout(() => setOpSuccess(null), 5000)
        }

        await fetchRequests()
    }

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* ヘッダー */}
            <div className="px-6 pt-4 pb-2 shrink-0 flex items-center justify-between">
                <h2 className="text-base font-bold text-gray-800">自分の申請一覧</h2>
                <button
                    onClick={fetchRequests}
                    disabled={loading || operating}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#007B7E] border border-[#007B7E] rounded-lg hover:bg-[#007b7e10] disabled:opacity-50 transition-colors"
                >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    更新
                </button>
            </div>

            {/* フィルター */}
            <div className="px-6 pb-2 shrink-0 flex gap-1.5">
                {FILTER_BUTTONS.map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => { setFilterType(key); setSelected(new Set()) }}
                        disabled={operating}
                        className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                            filterType === key
                                ? 'bg-[#007B7E] text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                    >
                        {label}
                        {key !== 'all' && (
                            <span className="ml-1 opacity-70">
                                ({items.filter(i => i.status === key).length})
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* エラー */}
            {error && (
                <div className="mx-6 mb-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg shrink-0">
                    <p className="text-sm text-red-700"><span className="font-semibold">エラー:</span> {error}</p>
                </div>
            )}

            {/* 全選択 */}
            {filteredItems.length > 0 && !loading && (
                <div className="px-6 pb-2 shrink-0">
                    <button
                        onClick={toggleAll}
                        disabled={operating}
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
                    >
                        {allFilteredSelected
                            ? <CheckSquare size={14} className="text-[#007B7E]" />
                            : <Square size={14} />
                        }
                        <span>{allFilteredSelected ? 'すべて解除' : 'すべて選択'}</span>
                        {selected.size > 0 && (
                            <span className="text-[#007B7E] font-semibold">（{selected.size}件選択中）</span>
                        )}
                    </button>
                </div>
            )}

            {/* リスト */}
            <div className="flex-1 overflow-y-auto px-6 pb-3">
                {loading && items.length === 0 ? (
                    <div className="flex items-center justify-center h-32 text-gray-400 text-sm">読み込み中...</div>
                ) : filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-gray-400">
                        <CalendarDays size={32} className="mb-2 opacity-40" />
                        <p className="text-sm">{items.length === 0 ? '申請中の申請はありません' : 'このカテゴリの申請はありません'}</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2.5">
                        {filteredItems.map(item => {
                            const key = itemKey(item)
                            const isSelected = selected.has(key)
                            return (
                                <div
                                    key={key}
                                    onClick={() => !operating && toggleSelect(key)}
                                    className={`bg-white rounded-xl border px-4 py-3 cursor-pointer transition-all ${
                                        isSelected
                                            ? 'border-[#007B7E] shadow-sm bg-[#007b7e04]'
                                            : 'border-gray-200 hover:border-gray-300'
                                    } ${operating ? 'opacity-60 cursor-not-allowed' : ''}`}
                                >
                                    <div className="flex items-start gap-2.5">
                                        {/* チェックボックス */}
                                        <div className="mt-0.5 shrink-0">
                                            {isSelected
                                                ? <CheckSquare size={16} className="text-[#007B7E]" />
                                                : <Square size={16} className="text-gray-300" />
                                            }
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {/* バッジ + ステータス + 日付 */}
                                            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                                                <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-bold ${TYPE_COLOR[item.type]}`}>
                                                    {TYPE_LABEL[item.type]}
                                                </span>
                                                <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium border ${STATUS_COLOR[item.status] || 'bg-gray-100 text-gray-500 border-gray-300'}`}>
                                                    {STATUS_LABEL[item.status] || item.status}
                                                </span>
                                                <span className="ml-auto text-sm font-bold text-gray-700">
                                                    {formatTargetDate(item.type, item.targetDate)}
                                                </span>
                                            </div>

                                            {/* 時間帯（残業のみ） */}
                                            {item.type === 'overtime' && item.startAt && item.endAt && (
                                                <div className="flex items-center gap-1 text-xs text-gray-600 mb-1">
                                                    <Clock size={11} className="shrink-0" />
                                                    <span>{item.startAt} ～ {item.endAt}</span>
                                                </div>
                                            )}

                                            {/* 取得区分（有給のみ） */}
                                            {item.type === 'paid_holiday' && item.usageType && (
                                                <div className="text-xs text-gray-600 mb-1">
                                                    <span className="bg-gray-100 px-1.5 py-0.5 rounded font-medium">{item.usageType}</span>
                                                </div>
                                            )}

                                            {/* 申請経路 */}
                                            {item.routeName && (
                                                <div className="flex items-center gap-1 mb-1">
                                                    <span className="text-xs text-gray-400">経路:</span>
                                                    <span className="text-xs text-gray-600 font-medium truncate">{item.routeName}</span>
                                                </div>
                                            )}

                                            {/* コメント */}
                                            {item.comment && (
                                                <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{item.comment}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* 操作フィードバック */}
            {(opError || opSuccess || opProgress) && (
                <div className="px-6 shrink-0">
                    {opProgress && operating && (
                        <div className="mb-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 flex items-center gap-2">
                            <span className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
                            処理中 ({opProgress.current}/{opProgress.total})...
                        </div>
                    )}
                    {opError && (
                        <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 whitespace-pre-wrap">{opError}</div>
                    )}
                    {opSuccess && (
                        <div className="mb-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">{opSuccess}</div>
                    )}
                </div>
            )}

            {/* アクションボタン */}
            <div className="px-6 pb-4 pt-2 shrink-0 flex gap-2">
                <button
                    onClick={() => handleOperation('withdraw')}
                    disabled={operating || selectedInProgress.length === 0}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-all active:scale-[0.98]"
                >
                    <RotateCcw size={15} />
                    <span>取り下げ{selectedInProgress.length > 0 ? `（${selectedInProgress.length}件）` : ''}</span>
                </button>
                <button
                    onClick={() => handleOperation('delete')}
                    disabled={operating || selectedItems.length === 0}
                    className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-500 hover:bg-red-600 disabled:bg-gray-200 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition-all active:scale-[0.98]"
                >
                    <Trash2 size={15} />
                    <span>削除{selectedItems.length > 0 ? `（${selectedItems.length}件）` : ''}</span>
                </button>
            </div>
        </div>
    )
}
