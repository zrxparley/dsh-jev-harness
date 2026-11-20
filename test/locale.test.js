/**
 * #20 locale takes effect. Verifies:
 *   - switching to `en` turns the page title, buttons and empty states English
 *     (and the Chinese strings are gone);
 *   - no hardcoded Chinese UI strings remain in lib/client.js (comments excluded);
 *   - times render with hour12:false (no AM/PM).
 *
 * The English locale is injected BOTH as the load-time default table and as the
 * bound message set, mirroring a host whose locale is `en`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  applyClient, findSlot, loadClient, render, requireReactOrSkip, resolveReact, visibleText,
} from './helpers/client.js'
import { REPO } from './helpers/harness.js'

const reactPkgs = resolveReact()
const { skip } = requireReactOrSkip(reactPkgs)
const enTable = JSON.parse(fs.readFileSync(path.join(REPO, 'locale', 'en.json'), 'utf8'))

function renderEnglish(compProps = {}) {
  const loaded = loadClient(reactPkgs, { defaultLocale: enTable })
  const { registrations } = applyClient(loaded, { messages: enTable })
  const main = findSlot(registrations, 'main')
  return visibleText(render(reactPkgs, main.comp, compProps))
}

test('#20: 切到 en 后页面标题与副标题变英文', { skip }, () => {
  const text = renderEnglish()
  assert.ok(text.includes('JEV tiered harness'), `英文标题应在，实际：${text.slice(0, 80)}`)
  assert.ok(text.includes('Decision/quality tasks to Kimi'), '英文副标题应在')
  assert.ok(!text.includes('JEV 分级调度 Harness'), '不应再有中文标题')
  assert.ok(!text.includes('把决策/高质量任务交给'), '不应再有中文副标题')
})

test('#20: 切到 en 后设置项与按钮变英文', { skip }, () => {
  const loaded = loadClient(reactPkgs, { defaultLocale: enTable })
  const { registrations } = applyClient(loaded, { messages: enTable })
  const HarnessConfig = loaded.exports.__test.HarnessConfig
  const text = visibleText(render(reactPkgs, HarnessConfig, { __initialState: 'ready' }))
  assert.ok(text.includes('Master switch'), 'Master switch 应为英文')
  assert.ok(text.includes('Judge confidence threshold'), '阈值标签应为英文')
  assert.ok(text.includes('Save threshold'), '保存按钮应为英文')
  assert.ok(!text.includes('总开关'), '不应再有中文「总开关」')
  assert.ok(!text.includes('判定置信度阈值'), '不应再有中文阈值标签')
})

test('#20: lib/client.js 里没有硬编码的界面中文（除注释）', () => {
  const src = fs.readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8')
  const lines = src.split('\n')
  let inBlock = false
  const offenders = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const st = l.trim()
    if (st.includes('/*') && !st.includes('*/')) inBlock = true
    if (st.includes('*/')) { inBlock = false; continue }
    if (inBlock) continue
    if (st.startsWith('//') || st.startsWith('*') || st.startsWith('/*')) continue
    if (/[一-鿿]/.test(l)) offenders.push(`${i + 1}: ${st.slice(0, 80)}`)
  }
  assert.deepEqual(offenders, [], `代码里不应再有硬编码中文（除注释）：\n${offenders.join('\n')}`)
})

test('#20: 时间显示用 hour12:false，不出现 AM/PM', () => {
  const src = fs.readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8')
  // every toLocaleTimeString call must pin hour12:false
  const calls = src.match(/toLocaleTimeString\([^)]*\)/g) || []
  for (const c of calls) {
    assert.ok(/hour12:\s*false/.test(c), `时间格式化必须固定 hour12:false：${c}`)
  }
  // and the rendered time string must not carry AM/PM
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const view = loaded.exports.__test.TrafficBoardView
  const data = { ok: true, grain: 'hour', windowHours: 24, peak: 1, buckets: [], totals: {}, today: {}, recent: [{ t: new Date().toISOString(), g: 'dsf', tool: 'call', ok: true, kind: 'ok', ms: 10 }] }
  const text = visibleText(render(reactPkgs, view, { data, hours: 24, error: '', onRange: () => {} }))
  assert.ok(!/\b[AP]M\b/.test(text), `界面时间不应出现 AM/PM：${text.slice(0, 200)}`)
})
