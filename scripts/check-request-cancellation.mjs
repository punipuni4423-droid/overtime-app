// 外部通信・Electron起動・実データを使わない、製品コードの回帰テスト。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { chromium } from 'playwright-core'

function moduleFrom(path, dependencies = {}, extra = '') {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8') + extra
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, require: (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`)
    return dependencies[name]
  }, setTimeout, URL, console, window: dependencies.window }, { filename: path })
  return exports
}
const { cancelRequests, CancellationApiError } = moduleFrom('src/main/requestCancellation.ts')
const item = { requestType: 'overtime', requestId: 123 }
const initial = () => ({ id: 123, status: 'in_progress', applicantId: 2, routeId: 3, targetDate: '2030-01-02', currentRound: 4, currentStepId: 5 })
function fixture(overrides = {}) {
  const f = { state: initial(), calls: [], progress: [] }
  f.deps = {
    companyId: 1, applicantId: 2, delay: async () => {},
    read: async () => { f.calls.push('read'); return f.state && { ...f.state } },
    cancel: async (_, state) => { f.calls.push(['cancel', state.currentRound, state.currentStepId]); f.state.status = 'draft' },
    delete: async () => { f.calls.push('delete'); f.state = null },
    browser: async (_, action) => { f.calls.push(`browser:${action}`); if (action === 'withdraw') f.state.status = 'draft'; else f.state = null },
    onProgress: (p) => f.progress.push(p), ...overrides,
  }
  f.run = (action = 'delete', items = [item]) => cancelRequests(items, action, f.deps)
  return f
}
let passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }
await test('一覧の古いステップを無視し、取り下げ確認後に削除する', async () => {
  const f = fixture(); const result = await f.run('delete', [{ ...item, currentRound: 99, currentStepId: 99 }])
  assert.equal(result.succeeded, 1); assert.deepEqual(f.calls, ['read', ['cancel', 4, 5], 'read', 'read', 'delete', 'read'])
  assert.equal(f.progress.at(-1).current, 1)
})
await test('API制限だけWebへ切替、同じ詳細で取り下げと削除', async () => {
  const f = fixture(); f.deps.cancel = async () => { throw new CancellationApiError('役職、部門を利用する申請はWebから', 400) }
  assert.equal((await f.run()).succeeded, 1)
  assert.deepEqual(f.calls.filter(x => typeof x === 'string' && x.startsWith('browser')), ['browser:withdraw', 'browser:delete'])
})
await test('取り下げの応答喪失は状態照合で解決', async () => {
  const f = fixture(); f.deps.cancel = async () => { f.state.status = 'draft'; throw new Error('timeout') }
  assert.equal((await f.run()).succeeded, 1)
})
await test('Web取り下げ応答喪失を両入口で照合し、成立済みなら削除まで継続', async () => {
  for (const restricted of [false, true]) {
    const f = fixture()
    if (restricted) f.deps.cancel = async () => { throw new CancellationApiError('役職、部門を利用する申請はWebから', 400) }
    else f.state.currentStepId = null
    let withdrawals = 0
    f.deps.browser = async (_, action) => {
      if (action === 'withdraw') { withdrawals++; f.state.status = 'draft'; throw new Error('browser timeout') }
      f.state = null
    }
    assert.equal((await f.run()).succeeded, 1); assert.equal(withdrawals, 1)
  }
  const f = fixture(); f.state.currentStepId = null; f.deps.browser = async () => { throw new Error('browser timeout') }
  assert.equal((await f.run()).failed[0].withdrawn, false); assert.equal(f.calls.includes('delete'), false)
})
await test('更新競合だけ最新ステップで一度再試行', async () => {
  const f = fixture(); let count = 0
  f.deps.cancel = async (_, state) => { if (++count === 1) { f.state.currentStepId = 6; throw new CancellationApiError('申請が更新されています', 400) } assert.equal(state.currentStepId, 6); f.state.status = 'draft' }
  assert.equal((await f.run()).succeeded, 1); assert.equal(count, 2)
})
await test('承認済み・他人・対象変更・初回404では書き込まない', async () => {
  for (const change of [s => { s.status = 'approved' }, s => { s.applicantId = 8 }, s => { s.id = 9 }, () => null]) {
    const f = fixture(); const changed = change(f.state); if (changed === null) f.state = null
    assert.equal((await f.run()).failed.length, 1); assert.deepEqual(f.calls, ['read'])
  }
  const f = fixture(); let reads = 0
  f.deps.read = async () => ({ ...f.state, routeId: ++reads > 1 ? 9 : 3 })
  assert.equal((await f.run()).failed.length, 1); assert.equal(f.calls.includes('delete'), false)
})
await test('取り下げ未反映を成功にせず、削除しない', async () => {
  const f = fixture(); f.deps.cancel = async () => {}
  assert.equal((await f.run()).succeeded, 0); assert.equal(f.calls.includes('delete'), false)
})
await test('DELETE応答喪失の404は成功、403・429・通信断では再送しない', async () => {
  for (const status of [403, 429, undefined]) {
    const f = fixture(); let deletes = 0
    f.deps.delete = async () => { deletes++; throw new CancellationApiError('failure', status) }
    const result = await f.run(); assert.equal(result.failed[0].withdrawn, true)
    assert.match(result.failed[0].error, /取り下げ済み・削除未完了/); assert.equal(deletes, 1)
    assert.equal(f.calls.some(x => String(x).startsWith('browser')), false)
  }
  const f = fixture(); f.deps.delete = async () => { f.state = null; throw new Error('response lost') }
  assert.equal((await f.run()).succeeded, 1)
})
await test('DELETEの2xxだけでは成功にしない', async () => {
  const f = fixture(); f.deps.delete = async () => {}
  assert.equal((await f.run()).failed.length, 1)
})
await test('API制限後のWeb削除の応答喪失も404照合で成功を判定', async () => {
  for (const deleted of [true, false]) {
    const f = fixture(); f.state.status = 'draft'; let clicks = 0
    f.deps.delete = async () => { throw new CancellationApiError('役職、部門を利用する申請はWebから', 400) }
    f.deps.browser = async () => { clicks++; if (deleted) f.state = null; throw new Error('browser timeout') }
    const result = await f.run(); assert.equal(result.succeeded, deleted ? 1 : 0); assert.equal(clicks, 1)
  }
})
await test('取り下げのみでは削除しない・draftの削除では取り下げない', async () => {
  const f = fixture(); assert.equal((await f.run('withdraw')).succeeded, 1); assert.equal(f.calls.includes('delete'), false)
  const g = fixture(); g.state.status = 'draft'; assert.equal((await g.run()).succeeded, 1); assert.equal(g.calls.some(Array.isArray), false)
})
await test('重複排除・同一対象の同時操作を拒否し、ロックを解放', async () => {
  const f = fixture(); let release
  const gate = new Promise(resolve => { release = resolve }); const read = f.deps.read
  f.deps.read = async () => { await gate; return read() }
  const first = f.run('delete', [item, item]); await assert.rejects(f.run(), /処理中/); release()
  assert.equal((await first).total, 1); f.state = initial(); assert.equal((await f.run()).succeeded, 1)
})
await test('同じIDでも種別ごとの失敗を識別・後続処理を継続', async () => {
  const f = fixture(); f.deps.read = async (i) => i.requestType === 'paid_holiday' ? { ...initial(), status: 'approved' } : f.state && { ...f.state }
  const result = await f.run('delete', [{ ...item, requestType: 'paid_holiday' }, item])
  assert.equal(result.succeeded, 1); assert.equal(result.failed[0].requestType, 'paid_holiday')
})
await test('操作後refreshは進行中の古い一覧取得を使い回さない', async () => {
  let release; let reads = 0
  const pending = new Promise(resolve => { release = resolve })
  const { load, getState } = moduleFrom('src/renderer/src/hooks/useApprovalsCache.ts', { react: {}, window: { api: {
    fetchApprovals: async () => [], fetchMyRequests: async () => { if (++reads === 1) { await pending; return [{ id: 123 }] } return [] },
  } } }, '\nexport { load }; export const getState = () => state;')
  const first = load(false, 1); const refresh = load(true, 1); release(); await Promise.all([first, refresh])
  assert.equal(reads, 2); assert.equal(getState().myRequests.length, 0)
})

const { performCancellationInPage } = moduleFrom('src/main/requestCancellationBrowser.ts', { 'playwright-core': {}, './automation': {} })
await test('HTTPアダプターの詳細変換・最新ステップ・404/403・Web遅延起動', async () => {
  const calls = []; let mode = 200; let browserStarts = 0
  const record = { id: 123, status: 'in_progress', applicant_id: 2, company_id: 1, approval_flow_route_id: 3, target_date: '2030-01-02', current_round: 4, current_step_id: 5 }
  const axios = { isAxiosError: e => e.http === true,
    get: async (url, config) => {
      calls.push(['get', url, config]); if (mode !== 200) throw { http: true, response: { status: mode, data: { message: 'fixture' } } }
      const key = url.split('/').at(-2).replace(/s$/, '')
      return { data: { [key]: record } }
    },
    post: async (...args) => { calls.push(['post', ...args]) },
    delete: async (...args) => { calls.push(['delete', ...args]) },
  }
  const { createCancellationAdapter } = moduleFrom('src/main/requestCancellationAdapter.ts', {
    axios: { default: axios }, './requestCancellation': { CancellationApiError },
    './requestCancellationBrowser': { createCancellationBrowser: async () => {
      browserStarts++; return { readHoliday: async () => ({ ...record, applicant_employee_id: 7 }), close: async () => {} }
    } },
  })
  const adapter = createCancellationAdapter({ companyId: 1, applicantId: 2, employeeId: 7, headless: true, getToken: async () => 'fixture-token', getCredentials: () => ({ email: 'fixture', password: 'fixture' }) })
  for (const requestType of ['overtime', 'paid_holiday', 'monthly_attendance', 'work_time']) {
    const state = await adapter.deps.read({ ...item, requestType })
    assert.equal(state.applicantId, 2); assert.equal(state.currentStepId, 5)
  }
  const state = await adapter.deps.read(item); await adapter.deps.cancel(item, state); await adapter.deps.delete(item)
  const post = calls.find(c => c[0] === 'post'); assert.equal(post[2].target_round, 4); assert.equal(post[2].target_step_id, 5)
  assert.equal(post[3].timeout, 10000); assert.equal(browserStarts, 0)
  mode = 404; assert.equal(await adapter.deps.read(item), null)
  mode = 403; await assert.rejects(adapter.deps.read(item), e => e.status === 403)
  mode = 200; record.company_id = 9; await assert.rejects(adapter.deps.read(item), /事業所/); record.company_id = 1
  const holiday = await adapter.deps.read({ ...item, requestType: 'holiday_work' })
  assert.equal(holiday.applicantId, 2); assert.equal(browserStarts, 1); await adapter.close()
})
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  for (const stale of [false, true]) await test(`実ブラウザーの確認ダイアログ・一覧復旧 stale=${stale}`, async () => {
    const page = await browser.newPage(); let visitedList = false; let writes = 0; const f = fixture()
    page.on('pageerror', error => console.error(error.message))
    await page.exposeFunction('mutateFixture', (action) => { writes++; if (action === 'withdraw') f.state.status = 'draft'; else f.state = null })
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><body><main></main><script>
      function render() { document.querySelector('main').innerHTML = location.hash === '#/requests' ? '<h1>申請一覧</h1>' : '<button id="withdraw">申請を取り下げる</button><button class="vb-button--appearanceSecondary" id="delete">削除</button>'; }
      window.addEventListener('hashchange', render); render();
      document.addEventListener('click', async e => {
        if(e.target.id==='withdraw') { await window.mutateFixture('withdraw'); document.querySelector('#withdraw').remove(); }
        if(e.target.id==='delete') document.querySelector('main').insertAdjacentHTML('beforeend','<button class="vb-button--danger" id="confirm">削除</button>');
        if(e.target.id==='confirm') { await window.mutateFixture('delete'); location.hash='#/requests'; }
      });
    </script></body></html>` }))
    const phases = []
    page.on('framenavigated', () => { if (page.url().endsWith('#/requests')) visitedList = true })
    await page.goto('https://p.secure.freee.co.jp/approval_requests#/requests/123?type=ApprovalRequest::OvertimeWork')
    assert.equal(await page.locator('#withdraw').count(), 1, await page.content())
    await performCancellationInPage(page, item, 'withdraw', () => f.deps.read(item), p => phases.push(p))
    await page.waitForFunction(() => !document.querySelector('#withdraw'))
    if (stale) await page.locator('#delete').evaluate(el => el.remove())
    await performCancellationInPage(page, item, 'delete', () => f.deps.read(item), p => phases.push(p))
    await page.waitForFunction(() => location.hash === '#/requests')
    assert.equal(writes, 2); assert.equal(f.state, null); assert.equal(phases.includes('refreshing'), stale)
    assert.equal(visitedList, true); await page.close()
  })
} finally { await browser.close() }
console.log(`${passed} tests passed; all browser requests fulfilled locally, no live freee operations.`)
