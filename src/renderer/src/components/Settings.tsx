import { useState, useEffect } from 'react'
import { Save, ArrowLeft, KeyRound, RefreshCw, ShieldCheck, ShieldAlert, LogIn, Building2, CheckCircle, Globe, Clock } from 'lucide-react'
import { DEPARTMENTS } from '../utils/departments'

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
        await window.api.storeSet('CLIENT_ID', clientId)
        await window.api.storeSet('CLIENT_SECRET', clientSecret)
        if (defaultDepartmentId) {
            await window.api.storeSet('DEFAULT_DEPARTMENT_ID', parseInt(defaultDepartmentId, 10))
        } else {
            await window.api.storeSet('DEFAULT_DEPARTMENT_ID', null)
        }
        await window.api.storeSet('FREEE_EMAIL', freeeEmail)
        await window.api.storeSet('FREEE_PASSWORD', freeePassword)
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
        // メール・パスワードが設定されていれば事前ログイン（バックグラウンド）
        if (freeeEmail && freeePassword) {
            ;(window.api as any).preLogin().catch(() => {})
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
        <div className="h-screen overflow-y-auto custom-scrollbar bg-[#f7f9fa] flex flex-col">
            <div className="max-w-md mx-auto w-full p-6 md:p-8">
                <div className="flex items-center mb-6">
                    <button 
                        onClick={onBack} 
                        className="p-2 mr-3 rounded-full hover:bg-white hover:shadow-sm transition-all text-gray-600 hover:text-[#007B7E]"
                    >
                        <ArrowLeft size={24} />
                    </button>
                    <h1 className="text-2xl font-bold text-gray-800 tracking-tight">設定</h1>
                </div>

                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
                    <div className="p-6 md:p-8 space-y-8">


                    {/* ── OAuth Credentials Section ── */}
                    <div>
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
                                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#007B7E] focus:bg-white focus:border-[#007B7E] outline-none transition-all text-sm shadow-sm"
                                    placeholder="freee アプリの Client ID"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Client Secret</label>
                                <input
                                    type="password"
                                    value={clientSecret}
                                    onChange={e => setClientSecret(e.target.value)}
                                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-[#007B7E] focus:bg-white focus:border-[#007B7E] outline-none transition-all text-sm shadow-sm"
                                    placeholder="freee アプリの Client Secret"
                                />
                            </div>
                        </div>
                    </div>

                    {/* ── Token Status Section ── */}
                    <div>
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
                                    <div className="p-3 rounded-xl text-sm border bg-emerald-50 text-emerald-700 border-emerald-200">
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
                                    <div className="p-3 rounded-xl text-sm border bg-amber-50 text-amber-700 border-amber-200">
                                        <div className="flex items-center gap-2 font-semibold">
                                            <ShieldAlert size={14} />
                                            <span>再認証が必要です</span>
                                        </div>
                                        <p className="mt-1 text-xs">リフレッシュトークンの有効期限が切れました。下のボタンから再認証してください。</p>
                                    </div>
                                ) : (
                                    <div className="p-3 rounded-xl text-sm border bg-red-50 text-red-700 border-red-200">
                                        <div className="flex items-center gap-2 font-semibold">
                                            <ShieldAlert size={14} />
                                            <span>未認証</span>
                                        </div>
                                        <p className="mt-1 text-xs">下のボタンからOAuth認証を行ってください（初回のみ）。</p>
                                    </div>
                                )}

                                {/* アクセストークン詳細（折りたたみ感） */}
                                {tokenStatus.hasToken && !tokenStatus.refreshIsExpired && (
                                    <div className="px-3 py-2 rounded-lg text-xs border bg-gray-50 text-gray-500 border-gray-200 flex items-center gap-1.5">
                                        <Clock size={11} className="shrink-0" />
                                        {tokenStatus.isExpired
                                            ? 'アクセストークン：期限切れ（次回API使用時に自動更新）'
                                            : `アクセストークン有効期限：${tokenStatus.expiresAt}`
                                        }
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="flex gap-2 mt-3">
                            {/* OAuth認証ボタン：未認証またはリフレッシュトークン期限切れ時のみ有効 */}
                            <button
                                onClick={handleStartAuth}
                                disabled={authLoading || !clientId || !clientSecret || (tokenStatus?.hasToken && !tokenStatus?.refreshIsExpired)}
                                className="flex-1 bg-[#007B7E] hover:bg-[#006669] disabled:bg-gray-200 disabled:cursor-not-allowed text-white p-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all text-sm active:scale-[0.98]"
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
                                    className="bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-700 p-3 rounded-xl font-medium flex items-center justify-center gap-1 transition-all text-sm active:scale-[0.98]"
                                    title="アクセストークンを手動更新"
                                >
                                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                                </button>
                            )}
                        </div>

                        {authMessage && (
                            <div className="mt-2 text-sm text-emerald-700 bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                                {authMessage}
                            </div>
                        )}

                        {authError && (
                            <div className="mt-2 text-sm text-red-700 bg-red-50 p-3 rounded-xl border border-red-200">
                                {authError}
                            </div>
                        )}
                    </div>

                    <div className="border-t border-gray-100"></div>

                    {/* ── アカウント情報（自動取得） ── */}
                    <div className="space-y-3 pb-2">
                        <h2 className="text-base font-bold text-gray-800 mb-2">アカウント情報</h2>
                        <p className="text-xs text-gray-500 -mt-1">OAuth認証後、APIから自動取得されます（手動入力不要）</p>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Company ID</label>
                                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 font-mono">
                                    {companyId || '---'}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">User ID</label>
                                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 font-mono">
                                    {applicantId || '---'}
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 mb-1">Employee ID</label>
                                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-700 font-mono">
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
                                className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#007B7E] focus:border-[#007B7E] outline-none transition bg-white text-sm"
                            >
                                <option value="">未設定</option>
                                {DEPARTMENTS.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="border-t border-gray-100"></div>

                    {/* ── Web Login Section ── */}
                    <div className="space-y-3 pb-2">
                        <div className="flex items-center gap-2 mb-2">
                            <Globe size={16} className="text-[#007B7E]" />
                            <h2 className="text-base font-bold text-gray-800">Web版自動操作用ログイン情報</h2>
                        </div>
                        <p className="text-xs text-gray-500 -mt-1">API非対応の申請経路（部門・役職ベース）を使用する場合に必要です。</p>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">メールアドレス</label>
                            <input
                                type="email"
                                value={freeeEmail}
                                onChange={e => setFreeeEmail(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#007B7E] focus:border-[#007B7E] outline-none transition text-sm"
                                placeholder="freee ログイン用メールアドレス"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 mb-1">パスワード</label>
                            <input
                                type="password"
                                value={freeePassword}
                                onChange={e => setFreeePassword(e.target.value)}
                                className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#007B7E] focus:border-[#007B7E] outline-none transition text-sm"
                                placeholder="freee ログイン用パスワード"
                            />
                        </div>
                    </div>
                    </div>

                    {/* ── Save Button at the Bottom of Card ── */}
                    <div className="p-6 bg-gray-50/50 border-t border-gray-100 rounded-b-3xl">
                        <button
                            onClick={handleSave}
                            className="w-full bg-[#007B7E] hover:bg-[#006669] text-white p-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all shadow-lg shadow-[#007b7e30] active:scale-[0.98] hover:translate-y-[-1px]"
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
                
                {/* Version */}
                <div className="text-center text-xs text-gray-400 mt-2 mb-2">
                    バージョン {appVersion || '---'}
                </div>

                {/* Extra padding at bottom */}
                <div className="h-10"></div>
            </div>
        </div>
    )
}


