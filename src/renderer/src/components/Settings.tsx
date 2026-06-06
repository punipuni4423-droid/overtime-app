import { useState, useEffect } from 'react'
import { Save, ArrowLeft, KeyRound, RefreshCw, ShieldCheck, ShieldAlert, LogIn, Building2, CheckCircle, Globe, Clock, Users, Pencil, Trash2, Plus, X } from 'lucide-react'
import { DEPARTMENTS } from '../utils/departments'
import { useNameMap } from '../hooks/useNameMap'
import { useLoginVerified } from '../hooks/useLoginVerified'
import { NameMapEditModal } from './NameMapEditModal'

interface Props {
    onBack: () => void;
}

export function Settings({ onBack }: Props) {
    const [clientId, setClientId] = useState('')
    const [clientSecret, setClientSecret] = useState('')
    const [companyId, setCompanyId] = useState('')
    const [applicantId, setApplicantId] = useState('')
    const [employeeId, setEmployeeId] = useState('')
    const [defaultDepartmentId, setDefaultDepartmentId] = useState('')
    const [freeeEmail, setFreeeEmail] = useState('')
    const [freeePassword, setFreeePassword] = useState('')
    const [saved, setSaved] = useState(false)

    // Token status
    const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null)
    const [authLoading, setAuthLoading] = useState(false)
    const [authMessage, setAuthMessage] = useState<string | null>(null)
    const [authError, setAuthError] = useState<string | null>(null)
    const [refreshing, setRefreshing] = useState(false)
    const [appVersion, setAppVersion] = useState('')

    // ログイン確認
    const { status: loginStatus, refresh: refreshLogin, reset: resetLogin } = useLoginVerified()
    const [verifying, setVerifying] = useState(false)
    const [verifyMessage, setVerifyMessage] = useState<string | null>(null)
    const [verifyError, setVerifyError] = useState<string | null>(null)

    useEffect(() => {
        async function load() {
            const ci = await window.api.storeGet('CLIENT_ID')
            const cs = await window.api.storeGet('CLIENT_SECRET')
            const dd = await window.api.storeGet('DEFAULT_DEPARTMENT_ID')
            const fe = await window.api.storeGet('FREEE_EMAIL')
            const fp = await window.api.storeGet('FREEE_PASSWORD')
            setClientId(ci || '')
            setClientSecret(cs || '')
            setDefaultDepartmentId(dd?.toString() || '')
            // ユーザー情報をAPIから自動取得
            try {
                const info = await window.api.getUserInfo()
                setCompanyId(info.companyId?.toString() || '')
                setApplicantId(info.applicantId?.toString() || '')
                setEmployeeId(info.employeeId?.toString() || '')
            } catch { /* トークン未設定時は空のまま */ }
            setFreeeEmail(fe || '')
            setFreeePassword(fp || '')

            const status = await window.api.getTokenStatus()
            setTokenStatus(status)
            const ver = await window.api.getAppVersion()
            setAppVersion(ver)
        }
        load()
    }, [])

    const handleSave = async () => {
        const prevEmail = (await window.api.storeGet('FREEE_EMAIL')) || ''
        const prevPassword = (await window.api.storeGet('FREEE_PASSWORD')) || ''
        await window.api.storeSet('CLIENT_ID', clientId)
        await window.api.storeSet('CLIENT_SECRET', clientSecret)
        if (defaultDepartmentId) {
            await window.api.storeSet('DEFAULT_DEPARTMENT_ID', parseInt(defaultDepartmentId, 10))
        } else {
            await window.api.storeSet('DEFAULT_DEPARTMENT_ID', null)
        }
        await window.api.storeSet('FREEE_EMAIL', freeeEmail)
        await window.api.storeSet('FREEE_PASSWORD', freeePassword)

        // メール／パスワードが変更された場合は確認状態をリセット（再確認を促す）
        if (prevEmail !== freeeEmail || prevPassword !== freeePassword) {
            await resetLogin()
        } else {
            await refreshLogin()
        }
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
    }

    const handleVerifyLogin = async (): Promise<void> => {
        setVerifyError(null)
        setVerifyMessage(null)
        const email = freeeEmail.trim()
        if (!email || !freeePassword) {
            setVerifyError('メールアドレスとパスワードを入力してください。')
            return
        }
        // 確認前に最新の入力内容をストアに保存（古い情報での確認を防止）
        await window.api.storeSet('FREEE_EMAIL', email)
        await window.api.storeSet('FREEE_PASSWORD', freeePassword)

        setVerifying(true)
        try {
            const result = await window.api.verifyLogin({ email, password: freeePassword })
            if (result.success) {
                setVerifyMessage(result.message || 'ログインに成功しました。')
            } else {
                setVerifyError(result.message || 'ログインに失敗しました。入力内容を確認してください。')
            }
            await refreshLogin()
        } catch (err) {
            const message = err instanceof Error ? err.message : 'ログイン確認中にエラーが発生しました。'
            setVerifyError(message)
        } finally {
            setVerifying(false)
        }
    }

    const handleStartAuth = async () => {
        // First save the client credentials
        await window.api.storeSet('CLIENT_ID', clientId)
        await window.api.storeSet('CLIENT_SECRET', clientSecret)

        setAuthLoading(true)
        setAuthError(null)
        setAuthMessage('ブラウザで認証画面を開いています...')

        try {
            const result = await window.api.startAuthFlow()
            if (result.success) {
                setAuthMessage('✅ 認証が完了しました！トークンが保存されました。')
                const status = await window.api.getTokenStatus()
                setTokenStatus(status)
            } else {
                setAuthError(result.message || '認証に失敗しました。')
                setAuthMessage(null)
            }
        } catch (err: any) {
            setAuthError(err.message || '認証に失敗しました。')
            setAuthMessage(null)
        } finally {
            setAuthLoading(false)
        }
    }

    const handleForceRefresh = async () => {
        setRefreshing(true)
        setAuthError(null)
        try {
            const result = await window.api.forceRefreshToken()
            if (result.success) {
                setAuthMessage('トークンを更新しました。')
                setTimeout(() => setAuthMessage(null), 3000)
            } else {
                setAuthError(result.message || 'トークン更新に失敗しました。')
            }
            const status = await window.api.getTokenStatus()
            setTokenStatus(status)
        } catch (err: any) {
            setAuthError(err.message)
        } finally {
            setRefreshing(false)
        }
    }

    return (
        <div className="h-screen overflow-y-auto custom-scrollbar bg-[#f7f9fa]">
            <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-6">
                <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between gap-3 border-b border-gray-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur md:-mx-6 md:px-6">
                    <div className="flex min-w-0 items-center">
                    <button 
                        onClick={onBack} 
                        className="mr-3 rounded-lg p-2 text-gray-600 transition-all hover:bg-gray-100 hover:text-[#007B7E]"
                    >
                        <ArrowLeft size={24} />
                    </button>
                        <div className="min-w-0">
                            <h1 className="text-xl font-bold tracking-tight text-gray-800">設定</h1>
                            <div className="text-xs text-gray-400">バージョン {appVersion || '---'}</div>
                        </div>
                    </div>
                    <button
                        onClick={handleSave}
                        className="shrink-0 rounded-lg bg-[#007B7E] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-[#006669] active:scale-[0.98]"
                    >
                        {saved ? '保存しました' : '設定を保存'}
                    </button>
                </div>

                <div className="flex flex-col">
                    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">


                    {/* ── OAuth Credentials Section ── */}
                    <div className="order-1 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-4">
                            <KeyRound size={18} className="text-[#007B7E]" />
                            <h2 className="text-base font-bold text-gray-800">OAuth2 認証情報</h2>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Client ID</label>
                                <input
                                    type="text"
                                    value={clientId}
                                    onChange={e => setClientId(e.target.value)}
                                    className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm shadow-sm outline-none transition-all focus:border-[#007B7E] focus:bg-white focus:ring-2 focus:ring-[#007B7E]"
                                    placeholder="freee アプリの Client ID"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Client Secret</label>
                                <input
                                    type="password"
                                    value={clientSecret}
                                    onChange={e => setClientSecret(e.target.value)}
                                    className="w-full rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm shadow-sm outline-none transition-all focus:border-[#007B7E] focus:bg-white focus:ring-2 focus:ring-[#007B7E]"
                                    placeholder="freee アプリの Client Secret"
                                />
                            </div>
                        </div>
                    </div>

                    {/* ── Token Status Section ── */}
                    <div className="order-2 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                            {tokenStatus?.hasToken && !tokenStatus?.refreshIsExpired ? (
                                <ShieldCheck size={18} className="text-emerald-600" />
                            ) : (
                                <ShieldAlert size={18} className="text-red-500" />
                            )}
                            <h2 className="text-base font-bold text-gray-800">認証状態</h2>
                        </div>

                        {tokenStatus && (
                            <div className="space-y-2">
                                {/* リフレッシュトークン状態（メイン表示） */}
                                {tokenStatus.hasToken && !tokenStatus.refreshIsExpired ? (
                                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                                        <div className="flex items-center gap-2 font-semibold">
                                            <ShieldCheck size={14} />
                                            <span>認証済み（ログイン中）</span>
                                        </div>
                                        <p className="mt-1 text-xs text-emerald-600">
                                            次回再認証の目安：{tokenStatus.refreshExpiresAt}頃
                                        </p>
                                        <p className="mt-0.5 text-xs text-emerald-500">
                                            アクセストークンは期限切れ時に自動更新されます
                                        </p>
                                    </div>
                                ) : tokenStatus.hasToken && tokenStatus.refreshIsExpired ? (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                                        <div className="flex items-center gap-2 font-semibold">
                                            <ShieldAlert size={14} />
                                            <span>再認証が必要です</span>
                                        </div>
                                        <p className="mt-1 text-xs">リフレッシュトークンの有効期限が切れました。下のボタンから再認証してください。</p>
                                    </div>
                                ) : (
                                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                        <div className="flex items-center gap-2 font-semibold">
                                            <ShieldAlert size={14} />
                                            <span>未認証</span>
                                        </div>
                                        <p className="mt-1 text-xs">下のボタンからOAuth認証を行ってください（初回のみ）。</p>
                                    </div>
                                )}

                                {/* アクセストークン詳細（折りたたみ感） */}
                                {tokenStatus.hasToken && !tokenStatus.refreshIsExpired && (
                                    <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
                                        <Clock size={11} className="shrink-0" />
                                        {tokenStatus.isExpired
                                            ? 'アクセストークン：期限切れ（次回API使用時に自動更新）'
                                            : `アクセストークン有効期限：${tokenStatus.expiresAt}`
                                        }
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="mt-3 flex gap-2">
                            {/* OAuth認証ボタン：未認証またはリフレッシュトークン期限切れ時のみ有効 */}
                            <button
                                onClick={handleStartAuth}
                                disabled={authLoading || !clientId || !clientSecret || (tokenStatus?.hasToken && !tokenStatus?.refreshIsExpired)}
                                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#007B7E] p-3 text-sm font-bold text-white transition-all hover:bg-[#006669] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-gray-200"
                            >
                                {authLoading ? (
                                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                ) : (
                                    <>
                                        <LogIn size={16} />
                                        <span>{tokenStatus?.hasToken && !tokenStatus?.refreshIsExpired ? '認証済み' : 'OAuth認証を開始（初回のみ）'}</span>
                                    </>
                                )}
                            </button>

                            {tokenStatus?.hasToken && (
                                <button
                                    onClick={handleForceRefresh}
                                    disabled={refreshing}
                                    className="flex items-center justify-center gap-1 rounded-lg bg-gray-100 p-3 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 active:scale-[0.98] disabled:bg-gray-50"
                                    title="アクセストークンを手動更新"
                                >
                                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                                </button>
                            )}
                        </div>

                        {authMessage && (
                            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                                {authMessage}
                            </div>
                        )}

                        {authError && (
                            <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                {authError}
                            </div>
                        )}
                    </div>

                    <div className="hidden"></div>

                    {/* ── アカウント情報（自動取得） ── */}
                    <div className="order-3 space-y-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <h2 className="text-base font-bold text-gray-800 mb-2">アカウント情報</h2>
                        <p className="text-xs text-gray-500 -mt-1">OAuth認証後、APIから自動取得されます（手動入力不要）</p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Company ID</label>
                                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-sm text-gray-700">
                                    {companyId || '---'}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">User ID</label>
                                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-sm text-gray-700">
                                    {applicantId || '---'}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Employee ID</label>
                                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-sm text-gray-700">
                                    {employeeId || '---'}
                                </div>
                            </div>
                        </div>
                        <div>
                            <div className="flex items-center gap-1.5 mb-1">
                                <Building2 size={14} className="text-[#007B7E]" />
                                <label className="block text-sm font-semibold text-gray-700">デフォルト部門</label>
                            </div>
                            <select
                                value={defaultDepartmentId}
                                onChange={e => setDefaultDepartmentId(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm outline-none transition focus:border-[#007B7E] focus:ring-2 focus:ring-[#007B7E]"
                            >
                                <option value="">未設定</option>
                                {DEPARTMENTS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="hidden"></div>

                    {/* ── ID→名前マッピング ── */}
                    <NameMapSection />

                    <div className="hidden"></div>

                    {/* ── Web Login Section ── */}
                    <div className="order-4 space-y-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                            <Globe size={16} className="text-[#007B7E]" />
                            <h2 className="text-base font-bold text-gray-800">Web版自動操作用ログイン情報</h2>
                        </div>
                        <p className="text-xs text-gray-500 -mt-1">
                            API非対応の申請経路（部門・役職ベース）を使用する場合に必要です。<br />
                            <strong className="text-amber-700">入力後は必ず「ログイン確認」を実行してください。</strong>未確認の状態では申請ボタンを押せません。
                        </p>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">メールアドレス</label>
                            <input
                                type="email"
                                value={freeeEmail}
                                onChange={e => setFreeeEmail(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 p-3 text-sm outline-none transition focus:border-[#007B7E] focus:ring-2 focus:ring-[#007B7E]"
                                placeholder="freee ログイン用メールアドレス"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">パスワード</label>
                            <input
                                type="password"
                                value={freeePassword}
                                onChange={e => setFreeePassword(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 p-3 text-sm outline-none transition focus:border-[#007B7E] focus:ring-2 focus:ring-[#007B7E]"
                                placeholder="freee ログイン用パスワード"
                            />
                        </div>

                        {/* ログイン確認状態 */}
                        {loginStatus.hasCredentials && (
                            <div
                                className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
                                    loginStatus.verified
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                        : 'bg-amber-50 text-amber-700 border-amber-200'
                                }`}
                            >
                                {loginStatus.verified ? (
                                    <>
                                        <CheckCircle size={14} className="shrink-0 mt-0.5" />
                                        <div>
                                            <div className="font-semibold">ログイン確認済み</div>
                                            <div className="opacity-80 mt-0.5">
                                                {loginStatus.verifiedAt
                                                    ? `確認時刻: ${new Date(loginStatus.verifiedAt).toLocaleString('ja-JP')}`
                                                    : ''}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <ShieldAlert size={14} className="shrink-0 mt-0.5" />
                                        <div>
                                            <div className="font-semibold">未確認</div>
                                            <div className="opacity-80 mt-0.5">
                                                ログイン確認を実行してください。確認できるまで申請ボタンは押せません。
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* ログイン確認ボタン */}
                        <button
                            onClick={handleVerifyLogin}
                            disabled={verifying || !freeeEmail.trim() || !freeePassword}
                            className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 p-3 text-sm font-bold text-white transition-all hover:bg-amber-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-gray-200"
                        >
                            {verifying ? (
                                <>
                                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    <span>ログイン確認中...（数十秒かかる場合があります）</span>
                                </>
                            ) : (
                                <>
                                    <LogIn size={16} />
                                    <span>ログイン確認</span>
                                </>
                            )}
                        </button>

                        {verifyMessage && (
                            <div className="text-xs text-emerald-700 bg-emerald-50 p-2.5 rounded-lg border border-emerald-200 flex items-start gap-1.5">
                                <CheckCircle size={13} className="shrink-0 mt-0.5" />
                                <span>{verifyMessage}</span>
                            </div>
                        )}
                        {verifyError && (
                            <div className="text-xs text-red-700 bg-red-50 p-2.5 rounded-lg border border-red-200 flex items-start gap-1.5">
                                <X size={13} className="shrink-0 mt-0.5" />
                                <span className="whitespace-pre-wrap">{verifyError}</span>
                            </div>
                        )}
                    </div>
                    </div>

                    {/* ── Save Button at the Bottom of Card ── */}
                    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <button
                            onClick={handleSave}
                            className="flex w-full items-center justify-center gap-3 rounded-lg bg-[#007B7E] p-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-[#006669] active:scale-[0.98]"
                        >
                            {saved ? (
                                <>
                                    <CheckCircle size={20} className="animate-in zoom-in duration-300" />
                                    <span>設定を保存しました</span>
                                </>
                            ) : (
                                <>
                                    <Save size={20} />
                                    <span>設定を保存する</span>
                                </>
                            )}
                        </button>
                    </div>
                </div>
                
                {/* Extra padding at bottom */}
                <div className="h-4"></div>
            </div>
        </div>
    )
}


function NameMapSection() {
    const { all, setName, removeName, clearAll } = useNameMap()
    const [newId, setNewId] = useState('')
    const [newName, setNewName] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [editTarget, setEditTarget] = useState<{ id: string; currentName: string } | null>(null)

    const entries = Object.entries(all).sort(([a], [b]) => a.localeCompare(b, 'ja', { numeric: true }))
    const count = entries.length

    const handleAdd = async (): Promise<void> => {
        setError(null)
        const trimmedId = newId.trim()
        const trimmedName = newName.trim()
        if (!trimmedId) {
            setError('ID を入力してください')
            return
        }
        if (!trimmedName) {
            setError('名前を入力してください')
            return
        }
        if (!/^\d+$/.test(trimmedId)) {
            setError('ID は数字で入力してください')
            return
        }
        try {
            const res = await setName(trimmedId, trimmedName)
            if (res.success) {
                setNewId('')
                setNewName('')
            } else {
                setError(res.message || '追加に失敗しました')
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : '追加に失敗しました'
            setError(message)
        }
    }

    const handleDelete = async (id: string): Promise<void> => {
        if (!confirm(`ID:${id} (${all[id]}) の登録を削除しますか？`)) return
        await removeName(id)
    }

    const handleClearAll = async (): Promise<void> => {
        if (!confirm(`登録中の ${count} 件すべてを削除しますか？この操作は取り消せません。`)) return
        await clearAll()
    }

    return (
        <div className="order-5 space-y-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex items-center gap-2 mb-2">
                <Users size={16} className="text-[#007B7E]" />
                <h2 className="text-base font-bold text-gray-800">ID→名前マッピング</h2>
                <span className="ml-auto text-xs text-gray-500">登録 {count} 件</span>
            </div>
            <p className="text-xs text-gray-500 -mt-1">
                APIで取得できなかったユーザーの名前を「ID:xxx」表示の代わりに表示します。
            </p>

            {/* 新規追加 */}
            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)_auto]">
                    <input
                        type="text"
                        inputMode="numeric"
                        value={newId}
                        onChange={(e) => setNewId(e.target.value)}
                        placeholder="ID（数字）"
                        className="w-full rounded-lg border border-gray-300 bg-white p-2.5 font-mono text-sm outline-none transition focus:border-[#007B7E] focus:ring-2 focus:ring-[#007B7E]"
                    />
                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                handleAdd()
                            }
                        }}
                        placeholder="表示名（例: 山田 太郎）"
                        className="min-w-0 rounded-lg border border-gray-300 bg-white p-2.5 text-sm outline-none transition focus:border-[#007B7E] focus:ring-2 focus:ring-[#007B7E]"
                    />
                    <button
                        onClick={handleAdd}
                        disabled={!newId.trim() || !newName.trim()}
                        className="flex items-center gap-1 px-3 py-2 text-sm font-bold text-white bg-[#007B7E] rounded-lg hover:bg-[#006669] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    >
                        <Plus size={14} />
                        追加
                    </button>
                </div>
                {error && (
                    <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        {error}
                    </div>
                )}
            </div>

            {/* 一覧 */}
            {count === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 py-4 text-center text-xs text-gray-400">
                    登録された名前はありません
                </div>
            ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 w-24">ID</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">名前</th>
                                <th className="px-3 py-2 w-20"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map(([id, name], idx) => (
                                <tr
                                    key={id}
                                    className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
                                >
                                    <td className="px-3 py-2 text-xs font-mono text-gray-700">{id}</td>
                                    <td className="px-3 py-2 text-sm text-gray-800 truncate">{name}</td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                onClick={() => setEditTarget({ id, currentName: name })}
                                                className="p-1.5 rounded text-gray-400 hover:text-[#007B7E] hover:bg-[#007b7e10] transition-colors"
                                                title="編集"
                                            >
                                                <Pencil size={12} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(id)}
                                                className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                title="削除"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* 全件クリア */}
            {count > 0 && (
                <div className="flex justify-end">
                    <button
                        onClick={handleClearAll}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-600 border border-red-200 bg-white rounded-lg hover:bg-red-50 transition-colors"
                    >
                        <Trash2 size={12} />
                        全件クリア
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
