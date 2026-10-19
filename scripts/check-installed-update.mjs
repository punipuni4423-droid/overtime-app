// 既存の旧版を空設定・専用キャッシュで起動し、実際の公開更新元からの取得を確認。
// 終了時インストールを避けるため、検証プロセスは終了コード1で終了する。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { _electron as electron } from 'playwright-core'

const root = await mkdtemp(join(tmpdir(), 'freee-update-discovery-'))
const expectedVersion = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version
const roaming = join(root, 'roaming')
const local = join(root, 'local')
await mkdir(roaming)
await mkdir(local)
const installed = join(process.env.LOCALAPPDATA, 'Programs', 'overtime-app', '残業申請ツール.exe')
const liveConfig = join(process.env.APPDATA, 'overtime-app', 'config.json')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const before = hash(await readFile(liveConfig))
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !['path', 'appdata', 'localappdata', 'electron_run_as_node', 'node_options', 'gh_token', 'github_token'].includes(key.toLowerCase())))
env.PATH = process.env.PATH.split(';').filter((entry) => !/powershell/i.test(entry)).join(';')
env.APPDATA = roaming
env.LOCALAPPDATA = local
assert.ok(spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0'], { env }).error,
  '既存タスクを保護できないため中止')
const app = await electron.launch({ executablePath: installed,
  args: [`--user-data-dir=${join(root, 'profile')}`], env, timeout: 60000 })
try {
  const actual = await app.evaluate(({ app }) => ({ version: app.getVersion(), userData: app.getPath('userData') }))
  assert.notEqual(actual.version, expectedVersion, '更新前の旧版で確認する')
  assert.equal(actual.userData.toLowerCase(), join(root, 'profile').toLowerCase())
  console.log(`旧版v${actual.version}を空設定で起動。公開GitHubからの更新ダウンロードを待機。`)
  const page = await app.firstWindow()
  const updateButton = page.getByRole('button', { name: '再起動して更新', exact: true })
  await updateButton.waitFor({ state: 'visible', timeout: 60000 })
  assert.equal(await page.getByText(`v${expectedVersion} の準備完了 — 今すぐ再起動して適用できます`, { exact: true }).isVisible(), true)
  const pending = join(local, 'overtime-app-updater', 'pending')
  const names = await readdir(pending)
  const downloaded = names.find((name) => name.endsWith('.exe'))
  assert.ok(downloaded, '更新ファイルを専用キャッシュにダウンロード済み')
  const downloadedHash = hash(await readFile(join(pending, downloaded)))
  assert.equal(downloadedHash, hash(await readFile(resolve(`dist/overtime-app_Setup_${expectedVersion}.exe`))))
  assert.equal(hash(await readFile(liveConfig)), before, '実設定が変わっていない')
  const screenshot = join(root, 'update-ready.png')
  await page.screenshot({ path: screenshot })
  const result = { result: 'PASS', from: actual.version, available: expectedVersion,
    authenticated: false, sha256: downloadedHash, screenshot,
    checks: ['既存旧版から公開GitHubへ接続', '新バージョン検出', '実ダウンロードとSHA256一致', '再起動して更新ボタン表示', '実設定不変'],
    untested: '更新ボタンの押下と実インストールは行っていない' }
  await writeFile(join(root, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  // autoInstallOnAppQuit=trueのため通常のapp.close()は使用しない。
  await app.evaluate(({ app }) => app.exit(1)).catch(() => {})
  assert.equal(hash(await readFile(liveConfig)), before)
}
