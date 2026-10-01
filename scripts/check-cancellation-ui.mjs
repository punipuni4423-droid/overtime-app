// 127.0.0.1:5186 のレンダラー専用Viteを使用。実freee通信はすべて遮断。
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
const baseUrl = process.env.WORK_TIME_TEST_URL || 'http://127.0.0.1:5186'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } })
  const errors = []; let external = 0
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(baseUrl).origin) { external++; return route.abort() }
    if (url.pathname === '/src/main.tsx') {
      const response = await route.fetch()
      const body = (await response.text()).replace(/import App from ["'][^"']+["'];?/, 'import { Approvals as App } from "/src/components/Approvals.tsx";')
      return route.fulfill({ response, body })
    }
    return route.continue()
  })
  await page.addInitScript(() => {
    const records = [123, 124].map(id => ({ type: 'overtime', id, status: 'in_progress', targetDate: '2030-01-02', comment: `検証${id}`, applicationNumber: id }))
    window.uiTest = { reads: 0, submits: 0 }
    window.api = {
      nameMapGetAll: async () => ({}), getLoginVerified: async () => ({ verified: true, hasCredentials: true }),
      fetchApprovals: async () => [],
      fetchMyRequests: async () => {
        window.uiTest.reads++
        if (window.uiTest.finished) await new Promise(resolve => { window.uiTest.releaseRefresh = resolve })
        return window.uiTest.finished ? [{ ...records[1], status: 'draft' }] : records
      },
      onCancelBatchProgress: listener => { window.uiTest.progress = listener; return () => {} },
      cancelRequestWebBatch: async payload => {
        window.uiTest.submits++; window.uiTest.payload = payload
        await new Promise(resolve => { window.uiTest.finishOperation = resolve })
        window.uiTest.finished = true
        return { total: 2, succeeded: 1, failed: [{ requestType: 'overtime', requestId: 124, withdrawn: true, error: '取り下げ済み・削除未完了: 検証エラー' }] }
      },
    }
  })
  page.on('dialog', dialog => dialog.accept())
  await page.goto(baseUrl)
  await page.getByRole('button', { name: 'すべて選択', exact: true }).click()
  const remove = page.getByRole('button', { name: '削除（2件）', exact: true })
  await remove.click()
  await page.waitForFunction(() => window.uiTest.finishOperation)
  await page.evaluate(() => window.uiTest.progress({ current: 0, total: 2, phase: 'waiting', requestType: 'overtime', requestId: 123 }))
  await page.getByText(/状態の更新を確認中/).waitFor()
  assert.equal(await remove.isDisabled(), true)
  await page.evaluate(() => window.uiTest.finishOperation())
  await page.waitForFunction(() => window.uiTest.releaseRefresh)
  const failedRemove = page.getByRole('button', { name: '削除（1件）', exact: true })
  assert.equal(await failedRemove.isDisabled(), true, '一覧更新完了前は再操作不可')
  await page.evaluate(() => window.uiTest.releaseRefresh())
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('削除（1件）') && !b.disabled))
  await page.getByText('1件選択中', { exact: true }).waitFor()
  await page.getByText(/取り下げ済み・削除未完了: 検証エラー/).waitFor()
  await page.getByText('1件の削除が完了しました。', { exact: true }).waitFor()
  assert.equal(await page.getByText('検証123', { exact: true }).count(), 0)
  await page.getByText('検証124', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.uiTest.submits), 1)
  assert.equal(external, 0); assert.deepEqual(errors, [])
  const screenshot = join(tmpdir(), 'freee-cancellation-ui.png')
  await page.screenshot({ path: screenshot, fullPage: true })
  console.log(JSON.stringify({ result: 'PASS', screenshot, checks: ['phase progress', 'no reentry until refresh', 'failed selection retained', 'partial results visible', 'fresh list'], externalRequests: external }))
} finally { await browser.close() }
