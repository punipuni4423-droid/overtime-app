import { _electron as electron } from 'playwright-core'
import electronPath from 'electron'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'docs', 'manual', 'images')

const tabs = [
  { key: '01-overtime', label: '\u6b8b\u696d\u7533\u8acb', waitMs: 1800 },
  { key: '02-paid-leave', label: '\u6709\u7d66\u7533\u8acb', waitMs: 1800 },
  { key: '03-holiday-work', label: '\u4f11\u65e5\u51fa\u52e4\u7533\u8acb', waitMs: 1800 },
  { key: '04-work-time-correction', label: '\u52e4\u6020\u6642\u9593\u4fee\u6b63', waitMs: 1800 },
  { key: '05-monthly-close', label: '\u6708\u6b21\u7de0\u3081', waitMs: 1800 },
  { key: '06-approvals', label: '\u7533\u8acb\u30fb\u627f\u8a8d', waitMs: 4000 },
  { key: '07-manager-overtime', label: '\u6b8b\u696d\u72b6\u6cc1', waitMs: 4000 },
]

const masks = {
  '01-overtime.png': [
    { x: 472, y: 326, w: 330, h: 22, label: 'sample comment' },
  ],
  '02-paid-leave.png': [
    { x: 472, y: 399, w: 330, h: 22, label: 'sample comment' },
  ],
  '03-holiday-work.png': [
    { x: 472, y: 399, w: 330, h: 22, label: 'sample comment' },
  ],
  '04-work-time-correction.png': [
    { x: 472, y: 465, w: 330, h: 22, label: 'sample comment' },
  ],
  '05-monthly-close.png': [
    { x: 472, y: 329, w: 330, h: 22, label: 'sample comment' },
  ],
  '08-settings.png': [
    { x: 104, y: 184, w: 502, h: 47, label: 'client id' },
    { x: 104, y: 268, w: 502, h: 47, label: 'client secret' },
    { x: 104, y: 473, w: 159, h: 47, label: 'company id' },
    { x: 276, y: 473, w: 159, h: 47, label: 'user id' },
    { x: 447, y: 473, w: 159, h: 47, label: 'employee id' },
    { x: 664, y: 492, w: 502, h: 47, label: 'mail address' },
    { x: 664, y: 576, w: 502, h: 47, label: 'password' },
  ],
}

function maskSvg(rects) {
  const parts = rects.map((rect) => `
    <rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" rx="8" fill="#f8fafc" stroke="#d1d5db"/>
    <text x="${rect.x + 14}" y="${rect.y + Math.round(rect.h / 2) + 5}" font-family="Arial, sans-serif" font-size="14" fill="#64748b">${rect.label}</text>
  `).join('')
  return Buffer.from(`<svg width="1280" height="900">${parts}</svg>`)
}

async function maskImage(fileName) {
  const rects = masks[fileName]
  if (!rects) return
  const input = path.join(outDir, fileName)
  const tmp = `${input}.tmp`
  await sharp(input).composite([{ input: maskSvg(rects), left: 0, top: 0 }]).png().toFile(tmp)
  await fs.rename(tmp, input)
}

async function main() {
  await fs.mkdir(outDir, { recursive: true })

  const app = await electron.launch({
    executablePath: electronPath,
    args: ['.'],
    env: { ...process.env, RPA_DEBUG: '' },
  })

  try {
    const win = await app.firstWindow()
    await win.setViewportSize({ width: 1280, height: 900 })
    await win.waitForLoadState('domcontentloaded').catch(() => {})
    await win.waitForFunction(() => !!window.api, null, { timeout: 20000 })
    await win.waitForTimeout(2500)

    for (const tab of tabs) {
      const loc = win.getByText(tab.label, { exact: true })
      await loc.waitFor({ state: 'visible', timeout: 15000 })
      await loc.click()
      await win.waitForTimeout(tab.waitMs)
      await win.screenshot({ path: path.join(outDir, `${tab.key}.png`), fullPage: false })
    }

    const settingsButton = win.locator('button.p-2.text-gray-500').last()
    await settingsButton.waitFor({ state: 'visible', timeout: 10000 })
    await settingsButton.click()
    await win.waitForTimeout(1800)
    await win.screenshot({ path: path.join(outDir, '08-settings.png'), fullPage: false })
  } finally {
    await app.close()
  }

  for (const fileName of Object.keys(masks)) {
    await maskImage(fileName)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
