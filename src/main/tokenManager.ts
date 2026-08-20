import axios from 'axios'

import { shell } from 'electron'
import http from 'http'
import url from 'url'

// ─── Token Data Interface ─────────────────────────────────────────
export interface TokenData {
  access_token: string
  refresh_token: string
  created_at: number // UNIX timestamp (seconds)
  expires_in: number // typically 86400 (24h)
  expires_at: number // UNIX timestamp (seconds), calculated as created_at + expires_in
}

// ─── Constants ────────────────────────────────────────────────────
const TOKEN_ENDPOINT = 'https://accounts.secure.freee.co.jp/public_api/token'
const AUTH_ENDPOINT = 'https://accounts.secure.freee.co.jp/public_api/authorize'

const LOCAL_REDIRECT_URI = 'http://localhost:18080/callback'
const EXPIRY_BUFFER_SECONDS = 300 // refresh 5 minutes before expiry
// freee のリフレッシュトークン有効期間（APIレスポンスに含まれないため 90日で推定）
const REFRESH_TOKEN_VALIDITY_SECONDS = 90 * 24 * 60 * 60

// ─── Token Manager Class ─────────────────────────────────────────
export class TokenManager {
  private store: any

  constructor(store: any) {
    this.store = store
  }

  // ── Getters / Setters ───────────────────────────────────────────
  getTokenData(): TokenData | null {
    const accessToken = this.store.get('access_token') as string | undefined
    const refreshToken = this.store.get('refresh_token') as string | undefined
    const createdAt = this.store.get('created_at') as number | undefined
    const expiresIn = this.store.get('expires_in') as number | undefined
    let expiresAt = this.store.get('expires_at') as number | undefined

    if (!accessToken || !refreshToken || createdAt == null || expiresIn == null) {
      return null
    }

    // Fallback calculation for expires_at if it's missing from store
    if (expiresAt == null) {
      expiresAt = createdAt + expiresIn
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      created_at: createdAt,
      expires_in: expiresIn,
      expires_at: expiresAt
    }
  }

  saveTokenData(data: TokenData): void {
    this.store.set('access_token', data.access_token)
    this.store.set('refresh_token', data.refresh_token)
    this.store.set('created_at', data.created_at)
    this.store.set('expires_in', data.expires_in)
    this.store.set('expires_at', data.expires_at)

    // Also keep legacy ACCESS_TOKEN key in sync for backward compatibility
    this.store.set('ACCESS_TOKEN', data.access_token)
  }

  getClientId(): string {
    return (this.store.get('CLIENT_ID') as string) || ''
  }

  getClientSecret(): string {
    return (this.store.get('CLIENT_SECRET') as string) || ''
  }

  // ── Token Expiry Check ──────────────────────────────────────────
  isTokenExpiredOrNear(tokenData: TokenData): boolean {
    const now = Math.floor(Date.now() / 1000)
    // Return true if token is expired or will expire within 5 minutes
    return now >= tokenData.expires_at - EXPIRY_BUFFER_SECONDS
  }

  // ── Core: Get Valid Access Token ────────────────────────────────
  // This is the function that should be called before every API request.
  // It checks whether the token is still valid and refreshes it if needed.
  async getValidAccessToken(): Promise<string> {
    const tokenData = this.getTokenData()

    // If no token data at all, user needs to authenticate
    if (!tokenData) {
      throw new TokenAuthRequiredError('トークン情報が見つかりません。認証が必要です。')
    }

    // If token is still valid, return it
    if (!this.isTokenExpiredOrNear(tokenData)) {
      console.log('[TokenManager] Access token is still valid.')
      return tokenData.access_token
    }

    // Token expired or near expiry → refresh
    console.log('[TokenManager] Access token expired or near expiry. Refreshing...')
    return await this.refreshAccessToken(tokenData.refresh_token)
  }

  // ── Refresh Token Flow ──────────────────────────────────────────
  async refreshAccessToken(refreshToken: string): Promise<string> {
    const clientId = this.getClientId()
    const clientSecret = this.getClientSecret()

    if (!clientId || !clientSecret) {
      throw new TokenAuthRequiredError(
        'Client ID / Client Secret が設定されていません。設定画面から入力してください。'
      )
    }

    try {
      const res = await axios.post(TOKEN_ENDPOINT, {
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken
      })

      // freee API returns created_at and expires_in in the response body
      const createdAt = res.data.created_at || Math.floor(Date.now() / 1000)
      const expiresIn = res.data.expires_in || 86400

      const newTokenData: TokenData = {
        access_token: res.data.access_token,
        refresh_token: res.data.refresh_token, // Token Rotation: new refresh token
        created_at: createdAt,
        expires_in: expiresIn,
        expires_at: createdAt + expiresIn
      }

      this.saveTokenData(newTokenData)
      console.log('[TokenManager] Token refreshed successfully.')
      return newTokenData.access_token
    } catch (err: any) {
      const status = err.response?.status
      const errorBody = err.response?.data

      console.error('[TokenManager] Refresh failed:', status, errorBody)

      // 401 or invalid_grant → refresh token is itself expired / revoked
      if (
        status === 401 ||
        errorBody?.error === 'invalid_grant' ||
        errorBody?.error === 'invalid_request'
      ) {
        // Clear stored tokens since they are no longer valid
        this.clearTokenData()
        throw new TokenAuthRequiredError(
          'リフレッシュトークンが無効です。再度ログイン（認可）が必要です。'
        )
      }

      throw new Error(`トークンの更新に失敗しました: ${err.message}`)
    }
  }

  // ── Exchange Authorization Code for Tokens ──────────────────────
  async exchangeCodeForTokens(code: string): Promise<TokenData> {
    const clientId = this.getClientId()
    const clientSecret = this.getClientSecret()

    if (!clientId || !clientSecret) {
      throw new Error('Client ID / Client Secret が設定されていません。')
    }

    const res = await axios.post(TOKEN_ENDPOINT, {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
      redirect_uri: LOCAL_REDIRECT_URI
    })

    const createdAt = res.data.created_at || Math.floor(Date.now() / 1000)
    const expiresIn = res.data.expires_in || 86400

    const tokenData: TokenData = {
      access_token: res.data.access_token,
      refresh_token: res.data.refresh_token,
      created_at: createdAt,
      expires_in: expiresIn,
      expires_at: createdAt + expiresIn
    }

    this.saveTokenData(tokenData)
    console.log('[TokenManager] Initial tokens obtained via authorization code.')
    return tokenData
  }

  // ── Start OAuth2 Auth Flow (Open Browser) ───────────────────────
  // Opens the browser for the user to authorize the app.
  // Returns a promise that resolves with the token data once the callback is received.
  async startAuthFlow(): Promise<TokenData> {
    const clientId = this.getClientId()
    if (!clientId) {
      throw new Error('Client ID が設定されていません。設定画面から入力してください。')
    }

    return new Promise<TokenData>((resolve, reject) => {
      // Start a temporary local HTTP server to capture the OAuth callback
      const server = http.createServer(async (req, res) => {
        try {
          const parsedUrl = url.parse(req.url || '', true)
          if (parsedUrl.pathname === '/callback') {
            const code = parsedUrl.query.code as string
            if (!code) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
              res.end('<html><body><h2>❌ 認可コードが取得できませんでした。</h2></body></html>')
              server.close()
              reject(new Error('認可コードがありません。'))
              return
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(
              '<html><body style="font-family:sans-serif;text-align:center;padding:60px;">' +
                '<h2 style="color:#007B7E;">✅ 認証完了！</h2>' +
                '<p>このタブを閉じて、アプリに戻ってください。</p>' +
                '</body></html>'
            )

            server.close()

            // Exchange code for tokens
            const tokenData = await this.exchangeCodeForTokens(code)
            resolve(tokenData)
          }
        } catch (err) {
          server.close()
          reject(err)
        }
      })

      server.listen(18080, () => {
        const authUrl =
          `${AUTH_ENDPOINT}?client_id=${encodeURIComponent(clientId)}` +
          `&redirect_uri=${encodeURIComponent(LOCAL_REDIRECT_URI)}` +
          `&response_type=code`

        console.log('[TokenManager] Opening browser for OAuth2 authorization...')
        shell.openExternal(authUrl)
      })

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close()
        reject(new Error('認証がタイムアウトしました。もう一度お試しください。'))
      }, 5 * 60 * 1000)
    })
  }

  // ── Clear Token Data ────────────────────────────────────────────
  clearTokenData(): void {
    this.store.delete('access_token' as any)
    this.store.delete('refresh_token' as any)
    this.store.delete('created_at' as any)
    this.store.delete('expires_in' as any)
    this.store.delete('expires_at' as any)
  }

  // ── Get Token Status for UI ─────────────────────────────────────
  getTokenStatus(): {
    hasToken: boolean
    isExpired: boolean
    expiresAt: string | null
    remainingMinutes: number | null
    refreshExpiresAt: string | null
    refreshIsExpired: boolean
  } {
    const tokenData = this.getTokenData()
    if (!tokenData) {
      return { hasToken: false, isExpired: true, expiresAt: null, remainingMinutes: null, refreshExpiresAt: null, refreshIsExpired: true }
    }

    const now = Math.floor(Date.now() / 1000)

    // アクセストークン有効期限
    const expiresAtUnix = tokenData.expires_at
    const isExpired = now >= expiresAtUnix
    const remainingSeconds = expiresAtUnix - now
    const remainingMinutes = Math.max(0, Math.floor(remainingSeconds / 60))
    const d = new Date(expiresAtUnix * 1000)
    const expiresAt = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

    // リフレッシュトークン有効期限（created_at + 90日で推定）
    // リフレッシュ更新のたびに created_at がリセットされるため、最後の更新から 90日が目安
    const refreshExpiresAtUnix = tokenData.created_at + REFRESH_TOKEN_VALIDITY_SECONDS
    const refreshIsExpired = now >= refreshExpiresAtUnix
    const rd = new Date(refreshExpiresAtUnix * 1000)
    const refreshExpiresAt = `${rd.getFullYear()}年${rd.getMonth() + 1}月${rd.getDate()}日`

    return { hasToken: true, isExpired, expiresAt, remainingMinutes, refreshExpiresAt, refreshIsExpired }
  }
}

// ─── Custom Error ─────────────────────────────────────────────────
export class TokenAuthRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenAuthRequiredError'
  }
}
