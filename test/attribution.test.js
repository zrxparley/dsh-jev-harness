/**
 * #23 轮次级归属：本轮谁处理的 + 「未经 JEV」诚实态。
 *
 * 关键约束（Chief 的口径）：主面板拿不到 sessionId，不能把全局最近一条冒充本轮。
 * 所以：有会话作用域才写「本轮」，否则写「最近一次已记录决策（全局）」。
 */
import fs from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  boot, callRoute, chatResponse, jsonResponse, makeHome, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'
import { applyClient, loadClient, render, requireReactOrSkip, visibleText } from './helpers/client.js'

const STATUS = '/api/jev-harness/status'
const { pkgs: reactPkgs, skip } = requireReactOrSkip()

test('#23: /status?session= 只回该会话的决策，并标明作用域', async () => {
  const home = makeHome('attr-scope')
  writeStore(home)
  const judge = (url, init) => {
    if (!String(url).includes('/systemone')) return undefined
    const payload = init && init.body ? JSON.parse(init.body) : {}
    const answers = {}
    if (payload.questions?.tier) answers.tier = { choice: 'execution', confidence: 0.9 }
    if (payload.questions?.skill) answers.skill = { choice: 'none', confidence: 0.9 }
    if (payload.questions?.difficulty) answers.difficulty = { choice: 'normal', confidence: 0.9 }
    return jsonResponse({ model: 'jev-test', answers, usage: { input_tokens: 1, output_tokens: 1 } })
  }
  const stub = stubFetch((url, init) => judge(url, init) ?? (String(url).includes('/chat/completions') ? chatResponse('ok') : undefined))
  try {
    const { tools, routes } = await boot({ home })
    await tools.get('harness_call').execute({ task: '整理成列表', tier: 'auto', skill: 'off' }, { sessionId: 'sess-A' })
    await tools.get('harness_call').execute({ task: '整理成列表', tier: 'auto', skill: 'off' }, { sessionId: 'sess-B' })

    const scoped = (await callRoute(routes, STATUS, { url: `${STATUS}?session=sess-A` })).body
    assert.equal(scoped.scope.filtered, true)
    assert.equal(scoped.scope.session, 'sess-A')
    assert.ok(scoped.decisions.length >= 1)
    assert.ok(scoped.decisions.every((d) => d.session === 'sess-A'), '不能混入别的会话')

    const global = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(global.scope.filtered, false, '不带 session 时明确标 global')
    assert.ok(global.decisions.length >= 2)
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#23: 归属文案——jev 显示 Kimi/Flash，非 jev 是琥珀「未经 JEV」', { skip }, () => {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const { roundAttribution } = loaded.exports.__test

  // 给 helper 一份 /status 的形状；helper 内部走模块级 T（测试环境默认 zh 表）
  const kimi = roundAttribution({ scope: { filtered: true }, decisions: [{ source: 'jev', tier: 'decision', provider: 'kimi', ok: true, ms: 2100 }] })
  assert.equal(kimi.tone, 'ok')
  assert.match(kimi.text, /Kimi/)
  assert.equal(kimi.detail, ' · 2.1s')

  const flash = roundAttribution({ scope: { filtered: true }, decisions: [{ source: 'jev', tier: 'execution', provider: 'dsf', ok: true, ms: 1400 }] })
  assert.match(flash.text, /Flash/)

  const heuristic = roundAttribution({ scope: { filtered: true }, decisions: [{ source: 'heuristic', provider: 'dsf', ok: true, ms: 10 }] })
  assert.equal(heuristic.tone, 'warn', '未经 JEV 必须是琥珀')

  const empty = roundAttribution({ scope: { filtered: true }, decisions: [] })
  assert.equal(empty.tone, 'warn', '本会话还没走过 JEV 也是琥珀')
  assert.match(empty.text, /^本轮：/, '空记录态也要带「本轮：」前缀')

  // 50ms 以下不显示 0.0s（四舍五入会骗人）
  const tooFast = roundAttribution({ scope: { filtered: true }, decisions: [{ source: 'jev', tier: 'execution', provider: 'dsf', ok: true, ms: 12 }] })
  assert.equal(tooFast.detail, '', 'ms<50 不显示 0.0s')
  const fast = roundAttribution({ scope: { filtered: true }, decisions: [{ source: 'jev', tier: 'execution', provider: 'dsf', ok: true, ms: 50 }] })
  assert.equal(fast.detail, ' · 0.1s', '刚好 50ms 显示 0.1s')

  const global = roundAttribution({ scope: { filtered: false }, decisions: [{ source: 'jev', provider: 'kimi', tier: 'decision', ok: true }] })
  assert.equal(global.tone, 'ok')
  assert.ok(!/本轮/.test(global.text), '没会话作用域时不许写「本轮」')
  assert.match(global.text, /最近一次已记录决策/)
})

test('#23: 模型座是可点按钮，点开面板；文案带本轮归属', { skip }, () => {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const { ModelLockView } = loaded.exports.__test
  let opened = 0
  const html = render(reactPkgs, ModelLockView, {
    attribution: { tone: 'ok', text: '本轮：Kimi 判断', detail: ' · 2.1s' },
    onOpen: () => { opened += 1 },
  })
  assert.ok(/<button/.test(html), '模型座必须是真的按钮，不是死 span')
  assert.ok(/min-height:32px/.test(html), '点击区要 ≥32（#22）')
  const text = visibleText(html)
  assert.match(text, /本轮：Kimi 判断/)
  assert.match(text, /2\.1s/)
  assert.ok(/打开 JEV 面板/.test(html), 'title/aria 要说明它能点开面板')
  assert.equal(opened, 0, '静态渲染不触发点击')
  // 静态渲染不会序列化事件处理器，所以「点了真的开会话面板」用源码级断言锁住。
  const src = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(/onClick: onOpen,/.test(src), '模型座必须把点击接到 onOpen')
  assert.ok(/onOpen: \(\) => \{ try \{ openPanel\(\) \}/.test(src), 'onOpen 必须真的调 openPanel()')

  const warn = visibleText(render(reactPkgs, ModelLockView, {
    attribution: { tone: 'warn', text: '本轮：未经 JEV · 由 DSH 模型回答', detail: '' },
    onOpen: () => {},
  }))
  assert.match(warn, /未经 JEV/)
})
