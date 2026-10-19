// 配布アプリを空の設定で起動し、送信せず入力欄を確認する。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { _electron as electron } from 'playwright-core'

const root = await mkdtemp(join(tmpdir(), 'freee-minute-release-'))
const userData = join(root, 'profile')
const roaming = join(root, 'roaming')
await mkdir(roaming)
// 起動時の既存自動承認タスク移行を、この試験プロセスでは実行させない。
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !['path', 'appdata', 'electron_run_as_node', 'node_options'].includes(key.toLowerCase())))
env.PATH = process.env.PATH.split(';').filter((entry) => !/powershell/i.test(entry)).join(';')
env.APPDATA = roaming
assert.ok(spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0'], { env }).error,
  'PowerShellが見つかる環境では既存タスクを保護できないため中止')
const app = await electron.launch({
  executablePath: resolve('dist/win-unpacked/残業申請ツール.exe'),
  args: [`--user-data-dir=${userData}`], env, timeout: 60000,
})
try {
  const actual = await app.evaluate(({ app }) => ({ version: app.getVersion(), userData: app.getPath('userData'), packaged: app.isPackaged }))
  assert.equal(actual.version, '1.0.18')
  assert.equal(actual.packaged, true)
  assert.equal(actual.userData.toLowerCase(), userData.toLowerCase())
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '勤怠時間修正', exact: true }).click()
  const start = page.getByRole('textbox', { name: '出勤時刻', exact: true })
  const end = page.getByRole('textbox', { name: '退勤時刻', exact: true })
  assert.equal(await start.getAttribute('type'), 'text')
  assert.equal(await start.getAttribute('list'), null)
  await start.fill('09:07')
  await end.fill('18:43')
  assert.equal(await start.inputValue(), '09:07')
  assert.equal(await end.inputValue(), '18:43')
  assert.equal(await start.getAttribute('aria-invalid'), 'false')
  assert.equal(await page.getByRole('textbox', { name: '休憩1 開始時刻' }).inputValue(), '12:00')
  assert.equal(await page.getByRole('textbox', { name: '休憩1 終了時刻' }).inputValue(), '13:00')
  await end.fill('25:07')
  assert.equal(await end.getAttribute('aria-invalid'), 'false')
  await start.fill('09:60')
  assert.equal(await start.getAttribute('aria-invalid'), 'true')
  assert.equal(await page.getByRole('button', { name: '勤怠時間修正を申請する' }).isDisabled(), true)
  await start.fill('09:07')
  await end.fill('18:43')
  await page.screenshot({ path: join(root, 'packaged-minute-input.png') })
  const result = { result: 'PASS', ...actual, screenshot: join(root, 'packaged-minute-input.png'),
    scope: '配布用実アプリ・空設定。入力のみ。freeeへの申請送信なし。既存設定と自動承認タスクは隔離。' }
  await writeFile(join(root, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} finally {
  await app.close()
}
