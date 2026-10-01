// レンダラー専用Viteサーバーに対して実行。Electron/freeeへは接続しない。
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const baseUrl = process.env.WORK_TIME_TEST_URL || 'http://127.0.0.1:5186'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } })
  const errors = []
  const externalRequests = []
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message) })
  await page.route('**/*', async (route) => {
    if (new URL(route.request().url()).origin !== new URL(baseUrl).origin) {
      externalRequests.push(route.request().url())
      return route.abort()
    }
    if (new URL(route.request().url()).pathname === '/src/main.tsx') {
      const response = await route.fetch()
      const body = (await response.text()).replace(
        /import App from ["'][^"']+["'];?/,
        'import { WorkTimeCorrection as App } from "/src/components/WorkTimeCorrection.tsx";',
      )
      return route.fulfill({ response, body })
    }
    await route.continue()
  })
  await page.addInitScript(() => {
    const defaults = { LAST_WORK_TIME_CLOCK_IN: '08:31', LAST_WORK_TIME_CLOCK_OUT: '18:02' }
    window.testSubmissions = []
    window.api = {
      getUserInfo: async () => ({ companyId: 1, applicantId: 2 }),
      storeGet: async (key) => JSON.parse(localStorage.getItem(key) || 'null') ?? defaults[key],
      storeSet: async (key, value) => localStorage.setItem(key, JSON.stringify(value)),
      getValidToken: async () => ({ success: true }),
      getTokenStatus: async () => ({ hasToken: true }),
      fetchRoutes: async () => [{ id: 3, name: '検証用経路', definition_type: 'person' }],
      submitWorkTime: async (payload) => { window.testSubmissions.push(payload) },
    }
  })
  await page.goto(baseUrl)
  const clockIn = page.getByRole('textbox', { name: '出勤時刻', exact: true })
  const clockOut = page.getByRole('textbox', { name: '退勤時刻', exact: true })
  const submit = page.getByRole('button', { name: '勤怠時間修正を申請する' })
  const comment = page.getByPlaceholder('修正理由を入力してください（必須）')
  await page.waitForFunction(() => document.querySelector('[aria-label="出勤時刻"]')?.value === '08:31')
  assert.equal(await clockOut.inputValue(), '18:02')
  assert.equal(await submit.isDisabled(), true, '理由必須を維持')
  await comment.fill('ローカル検証')
  await clockIn.fill('')
  await clockIn.pressSequentially('09:07')
  await clockOut.fill('18:43')
  await page.getByRole('textbox', { name: '休憩1 開始時刻' }).fill('12:01')
  await page.getByRole('textbox', { name: '休憩1 終了時刻' }).fill('12:59')
  await page.getByRole('button', { name: '追加', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '休憩2 終了時刻' }).inputValue(), '15:15')
  assert.equal(await submit.isEnabled(), true)
  await submit.click()
  await page.waitForFunction(() => window.testSubmissions.length === 1)
  const payload = await page.evaluate(() => window.testSubmissions[0])
  assert.deepEqual(payload.workRecords, [{ clockInAt: '09:07', clockOutAt: '18:43' }])
  assert.deepEqual(payload.breakRecords, [
    { clockInAt: '12:01', clockOutAt: '12:59' },
    { clockInAt: '15:00', clockOutAt: '15:15' },
  ])
  assert.equal(payload.routeId, 3)
  await page.waitForFunction(() => localStorage.getItem('LAST_WORK_TIME_CLOCK_OUT') === '"18:43"')
  await page.reload()
  await page.waitForFunction(() => document.querySelector('[aria-label="出勤時刻"]')?.value === '09:07')
  assert.equal(await clockOut.inputValue(), '18:43', '分単位の保存値を復元')
  for (const invalid of ['', '09:60', '48:00', 'abc', '9:7', '12:345']) {
    await clockIn.fill(invalid)
    assert.equal(await submit.isDisabled(), true, `不正値を拒否: ${invalid}`)
    assert.equal(await clockIn.getAttribute('aria-invalid'), 'true')
  }
  await clockIn.fill('00:00')
  await clockOut.fill('47:59')
  assert.equal(await submit.isEnabled(), true, '境界時刻を入力可能')
  await clockIn.fill('23:58')
  await clockOut.fill('25:07')
  const breakEnd = page.getByRole('textbox', { name: '休憩1 終了時刻' })
  await breakEnd.fill('24:60')
  assert.equal(await submit.isDisabled(), true, '休憩の不正値を拒否')
  await breakEnd.fill('24:17')
  await page.getByRole('button', { name: '削除', exact: true }).click()
  assert.equal(await page.getByText('休憩なし', { exact: true }).isVisible(), true)
  await submit.click()
  await page.waitForFunction(() => window.testSubmissions.length === 1)
  const overnight = await page.evaluate(() => window.testSubmissions[0])
  assert.deepEqual(overnight.workRecords, [{ clockInAt: '23:58', clockOutAt: '25:07' }])
  assert.deepEqual(overnight.breakRecords, [])
  await page.getByRole('button', { name: '追加', exact: true }).click()
  await page.setViewportSize({ width: 448, height: 820 })
  const screenshot = join(tmpdir(), 'freee-work-time-minute-input.png')
  await page.screenshot({ path: screenshot, fullPage: true })
  const fits = await page.getByRole('textbox', { name: '休憩1 終了時刻' }).evaluate((input) => {
    const style = getComputedStyle(input)
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    context.font = style.font
    return context.measureText(input.value).width <= input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  })
  assert.equal(fits, true, '休憩時刻が入力欄に収まる')
  assert.deepEqual(errors, [])
  assert.deepEqual(externalRequests, [], '外部送信なし')
  console.log(JSON.stringify({ result: 'PASS', screenshot, externalRequests: 0,
    checks: ['minute input and payload', 'saved values restored', 'invalid/empty blocked', 'overnight and bounds', 'break add/remove/repeat', 'comment and route preserved', 'narrow layout'] }))
} finally {
  await browser.close()
}
