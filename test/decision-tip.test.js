/**
 * #36：悬停芯片看「这次是谁干的」。
 *
 * 已经落地的那部分（v1.7.0 的 decision trace）在这里被锁住，本轮补的是缺口：
 *   - 悬停延迟必须 ≤300ms（显式常量，代码级锁）；
 *   - 浮层第一行随最近一次调用变化（kimi ↔ dsf）；
 *   - heuristic 明确写「JEV 未参与」，不冒充判定；
 *   - decisions 落库含 task 摘要（≤120 字）与判定器 probabilities，
 *     但不含任何 API key、不含完整 prompt；
 *   - 面板行可展开 task 摘要与 probabilities（收起时不渲染）；
 *   - 落库失败不影响主调用；
 *   - 环形容量按 #41 口径（单会话 50 / 全局 500），不是 issue 里旧的 12。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  boot, callRoute, chatResponse, jsonResponse, makeHome, readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'
import {
  applyClient, loadClient, render, requireReactOrSkip, visibleText,
} from './helpers/client.js'

const STATUS = '/api/jev-harness/status'
const { pkgs: reactPkgs, skip } = requireReactOrSkip()

/** 三条 fixture 决策：最新的是 dsf 执行，中间 kimi 决策，最旧是启发式兜底。 */
// 用本地时间构造，断言里的 13:xx 才不会随时区漂移。
const atLocal = (hour, minute) => new Date(2026, 10, 19, hour, minute, 0).toISOString()
const DECISIONS = [
  {
    t: atLocal(13, 35), task: '把这句话翻成英文', tier: 'execution', asked: 'auto',
    source: 'jev', choice: 'execution', confidence: 0.91, provider: 'dsf', model: 'deepseek-v4.1-flash-1017',
    host: { provider: 'titigate', model: 'deepseek-v4.1-flash-1017' }, skill: 'none',
    ok: true, ms: 2100, pt: 120, ct: 40, probabilities: { decision: 0.09, execution: 0.91 },
  },
  {
    t: atLocal(13, 30), task: '用一句话回答：这个流量看板为什么显示 0', tier: 'decision', asked: 'auto',
    source: 'jev', choice: 'decision', confidence: 0.88, provider: 'kimi', model: 'kimi-k3.1-pro',
    host: { provider: 'titigate', model: 'kimi-k3.1-pro' }, skill: 'code-review',
    ok: true, ms: 8300, pt: 400, ct: 194, probabilities: { decision: 0.88, execution: 0.12 },
  },
  {
    t: atLocal(13, 20), task: '整理这段要点', tier: 'execution', asked: 'auto',
    source: 'heuristic', choice: 'execution', degraded: true, provider: 'dsf', model: 'deepseek-v4.1-flash-1017',
    skill: 'none', ok: true, ms: 1200, pt: 80, ct: 20,
  },
]

function clientSeam() {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const seam = loaded.exports.__test
  assert.ok(seam, 'client 没有导出 __test 测试缝')
  return seam
}

test('#36: 悬停浮层渲染最近 3 条，第一行是最近一次调用', { skip }, () => {
  const { DecisionTip } = clientSeam()
  const html = render(reactPkgs, DecisionTip, { decisions: DECISIONS })
  const text = visibleText(html)

  assert.ok(text.includes('最近决策 · 谁在干活'), '浮层标题')
  assert.ok(text.includes('最近 3 条'), '三行 fixture 应显示「最近 3 条」')
  // 第一行确实是最新那条（dsf 执行），不是最旧的。
  const firstDsf = text.indexOf('deepseek-v4.1-flash-1017')
  const firstKimi = text.indexOf('kimi-k3.1-pro')
  assert.ok(firstDsf >= 0 && firstKimi >= 0, '两条模型都应出现')
  assert.ok(firstDsf < firstKimi, '第一行必须是最新那条（dsf），旧的在后面')
  assert.ok(text.includes('13:35'), '第一行带时间')
  assert.ok(text.includes('JEV 判定 execution (0.91)'), '第一行写出 tier 与置信度')
  assert.ok(text.includes('160 tokens · 2100ms'), '第一行带 token 与耗时')
  // 三行都渲染出来，且不许出现 undefined / NaN 这类占位垃圾。
  assert.equal((text.match(/JEV 判定/g) || []).length, 2, '两条 JEV 判定 + 一条启发式 = 三行')
  assert.ok(!/undefined|NaN/.test(text), `浮层不许出现 undefined/NaN：${text.slice(0, 300)}`)
})

test('#36: 连续两次 kimi / dsf，浮层第一条跟着换', { skip }, () => {
  const { DecisionTip, decisionsOf } = clientSeam()
  const tipFirst = (list) => {
    const text = visibleText(render(reactPkgs, DecisionTip, { decisions: decisionsOf({ decisions: list }) }))
    return { text, firstLine: text.slice(0, text.indexOf('13:3') + 5) }
  }
  const afterKimi = tipFirst([DECISIONS[1], DECISIONS[2]])
  assert.ok(afterKimi.text.startsWith('最近决策') || afterKimi.text.includes('kimi-k3.1-pro'))
  assert.ok(afterKimi.text.indexOf('kimi-k3.1-pro') < afterKimi.text.indexOf('deepseek-v4.1-flash-1017') ||
    !afterKimi.text.includes('deepseek-v4.1-flash-1017'), 'kimi 那条必须在最前')

  const afterDsf = tipFirst([DECISIONS[0], DECISIONS[1]])
  const dsfAt = afterDsf.text.indexOf('deepseek-v4.1-flash-1017')
  const kimiAt = afterDsf.text.indexOf('kimi-k3.1-pro')
  assert.ok(dsfAt >= 0 && dsfAt < kimiAt, '换成 dsf 后第一行必须是 dsf')
  assert.ok(afterDsf.text.includes('JEV 判定 execution'), '第一行判定随之变化')
})

test('#36: heuristic 明确写「JEV 未参与」，不冒充判定', { skip }, () => {
  const { DecisionTip } = clientSeam()
  const html = render(reactPkgs, DecisionTip, { decisions: [DECISIONS[2]] })
  const text = visibleText(html)
  assert.ok(text.includes('启发式 execution（JEV 未参与）'), `必须写明 JEV 未参与：${text}`)
  assert.ok(text.includes('已降级'), '降级要标出来')
  assert.ok(!text.includes('JEV 判定'), '启发式这条不许写成「JEV 判定」')
})

test('#36: 无决策记录时显示「还没有走过 JEV」，不是空白浮层', { skip }, () => {
  const { DecisionTip } = clientSeam()
  const text = visibleText(render(reactPkgs, DecisionTip, { decisions: [] }))
  assert.ok(text.includes('还没有走过 JEV'), `空态文案缺失：${text}`)
  assert.ok(text.includes('最近决策 · 谁在干活'), '浮层标题仍在，别给一个空壳')
})

test('#36: 隐私边界——浮层只渲染白名单字段，不泄漏 key 与完整 prompt', { skip }, () => {
  const { DecisionTip, DecisionRow } = clientSeam()
  const leaky = {
    ...DECISIONS[1],
    apiKey: 'sk-live-THIS-MUST-NOT-RENDER',
    prompt: '这是完整系统提示词，绝不应该出现在浮层里',
    messages: [{ role: 'user', content: '完整对话也不该出现' }],
  }
  const tip = visibleText(render(reactPkgs, DecisionTip, { decisions: [leaky] }))
  const row = visibleText(render(reactPkgs, DecisionRow, { d: leaky, index: 0, expanded: true }))
  for (const text of [tip, row]) {
    assert.ok(!text.includes('sk-live-THIS-MUST-NOT-RENDER'), 'API key 泄漏到浮层')
    assert.ok(!text.includes('绝不应该出现在浮层里'), '完整 prompt 泄漏到浮层')
    assert.ok(!text.includes('完整对话也不该出现'), '完整 messages 泄漏到浮层')
  }
  assert.ok(tip.includes('kimi-k3.1-pro'), '白名单字段仍然要显示')
})

test('#36: 面板决策行收起不渲染明细，展开才显示 task 与 probabilities', { skip }, () => {
  const { DecisionRow } = clientSeam()
  const collapsed = visibleText(render(reactPkgs, DecisionRow, { d: DECISIONS[1], index: 0, expanded: false, onToggle: () => {} }))
  assert.ok(collapsed.includes('kimi-k3.1-pro'), '收起时仍显示一行摘要')
  assert.ok(!collapsed.includes('判据：'), '收起时不该渲染 probabilities')
  assert.ok(!collapsed.includes('任务：'), '收起时不该渲染 task 摘要')

  const expanded = visibleText(render(reactPkgs, DecisionRow, { d: DECISIONS[1], index: 0, expanded: true, onToggle: () => {} }))
  assert.ok(expanded.includes('任务：用一句话回答：这个流量看板为什么显示 0'), '展开显示 task 摘要')
  assert.ok(expanded.includes('判据：decision 0.88 · execution 0.12'), `展开显示完整 probabilities：${expanded}`)
  assert.ok(!/undefined|NaN/.test(expanded), '展开态也不许有 undefined/NaN')
})

test('#36: 悬停延迟 ≤300ms，且真的接了定时器与清理', () => {
  const { HOVER_OPEN_DELAY_MS } = clientSeam()
  assert.equal(typeof HOVER_OPEN_DELAY_MS, 'number')
  assert.ok(HOVER_OPEN_DELAY_MS > 0, '不能是 0（鼠标扫过就弹会闪）')
  assert.ok(HOVER_OPEN_DELAY_MS <= 300, `验收要求 300ms 内出现，实际 ${HOVER_OPEN_DELAY_MS}`)

  const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  assert.equal((source.match(/onMouseEnter: openHover/g) || []).length, 1, 'onMouseEnter 必须走 openHover')
  assert.equal((source.match(/onMouseLeave: closeHover/g) || []).length, 1, 'onMouseLeave 必须走 closeHover')
  assert.ok(/setTimeout\(\(\) => \{[\s\S]{0,120}setHover\(true\)/.test(source), '定时器到点才 setHover(true)')
  assert.ok(source.includes('hoverTimer.current = setTimeout'), '悬停用定时器而不是立即打开')
  assert.ok(source.includes('clearTimeout(hoverTimer.current)'), '离开与卸载都要清定时器')
  assert.ok(/hover \? h\(DecisionTip/.test(source), 'hover 状态必须渲染 DecisionTip')
})

/* ------------------------------- 宿主侧 ------------------------------- */

function judgeStub(probabilities) {
  return (url, init) => {
    if (!url.includes('/systemone')) return undefined
    const payload = init.body ? JSON.parse(init.body) : {}
    const answers = {}
    if (payload.questions?.tier) {
      answers.tier = { choice: 'execution', confidence: 0.91 }
      if (probabilities) answers.tier.probabilities = probabilities
    }
    if (payload.questions?.skill) answers.skill = { choice: 'none', confidence: 0.91 }
    if (payload.questions?.difficulty) answers.difficulty = { choice: 'normal', confidence: 0.91 }
    return jsonResponse({ model: 'jev-test', answers, usage: { input_tokens: 5, output_tokens: 1 } })
  }
}
const chatStub = (url) => {
  if (url.includes('/chat/completions')) return chatResponse('完成')
  if (url.includes('/models')) return jsonResponse({ data: [{ id: 'm1' }] })
  return undefined
}

test('#36: 连续两次 decision / execution，/status 第一条随之变化（新的在前）', async () => {
  const home = makeHome('trace-flip')
  writeStore(home)
  const stub = stubFetch((url, init) => judgeStub()(url, init) ?? chatStub(url))
  try {
    const { tools, routes } = await boot({ home })
    const call = tools.get('harness_call')

    await call.execute({ task: '这个方案风险在哪', tier: 'decision' }, {})
    let status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.decisions[0].provider, 'kimi', '第一次应是 kimi 决策')
    assert.equal(status.decisions[0].tier, 'decision')

    await call.execute({ task: '把这段整理成列表', tier: 'execution' }, {})
    status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.decisions.length, 2, '/status 带回两条决策')
    assert.equal(status.decisions[0].provider, 'dsf', '最新一条必须是 dsf 执行')
    assert.equal(status.decisions[0].tier, 'execution')
    assert.equal(status.decisions[1].provider, 'kimi', '旧的在后 → 浮层第一行就是最新那条')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#36: 决策落库带 task 摘要（≤120 字），不含 API key 与完整 prompt', async () => {
  const home = makeHome('trace-privacy')
  writeStore(home)
  const stub = stubFetch((url, init) => judgeStub()(url, init) ?? chatStub(url))
  const longTask = `这是完整任务正文的开头。${'x'.repeat(300)}这里是第 200 字之后的内容，绝不该进账本。`
  try {
    const { tools } = await boot({ home })
    await tools.get('harness_call').execute({ task: longTask, tier: 'auto' }, {})
    const usage = readJsonFile(path.join(home, 'jev-harness-usage.json'))
    const decision = usage.decisions[0]
    assert.ok(decision.task && decision.task.length > 0, '决策要带 task 摘要')
    assert.ok(decision.task.length <= 120, `task 摘要上限 120 字，实际 ${decision.task.length}`)
    const raw = JSON.stringify(usage)
    assert.ok(!raw.includes('这里是第 200 字之后的内容'), '完整 prompt 不许进账本')
    for (const key of ['test-jev-key', 'test-kimi-key', 'test-dsf-key']) {
      assert.ok(!raw.includes(key), `账本里出现了密钥：${key}`)
    }
    assert.ok(!raw.includes('authorization'), '账本里不该有请求头')
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#36: 判定器的 probabilities 会落库，且被裁剪（≤8 项、非数字丢弃）', async () => {
  const home = makeHome('trace-probabilities')
  writeStore(home)
  const stub = stubFetch((url, init) => judgeStub({
    decision: 0.09, execution: 0.91, extra: 'not-a-number',
    k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, k6: 6, k7: 7, k8: 8,
  })(url, init) ?? chatStub(url))
  try {
    const { tools } = await boot({ home })
    await tools.get('harness_call').execute({ task: '整理成列表', tier: 'auto' }, {})
    const usage = readJsonFile(path.join(home, 'jev-harness-usage.json'))
    const probs = usage.decisions[0].probabilities
    assert.ok(probs && typeof probs === 'object', 'probabilities 应落库')
    assert.equal(probs.decision, 0.09)
    assert.equal(probs.execution, 0.91)
    assert.ok(!('extra' in probs), '非数字值必须丢弃')
    assert.ok(Object.keys(probs).length <= 8, `最多保留 8 项，实际 ${Object.keys(probs).length}`)
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#36: 账本写不进去时主调用照常返回（记账失败不打断调用）', async () => {
  const home = makeHome('trace-readonly')
  writeStore(home)
  const stub = stubFetch((url, init) => judgeStub()(url, init) ?? chatStub(url))
  try {
    const { tools } = await boot({ home })
    fs.chmodSync(home, 0o500) // 目录不可写：临时文件写不进去
    try {
      const out = await tools.get('harness_call').execute({ task: '整理成列表', tier: 'execution' }, {})
      assert.equal(out.ok, true, '记账失败不许影响主调用')
      assert.equal(out.text, '完成')
    } finally {
      fs.chmodSync(home, 0o700)
    }
  } finally {
    stub.restore(); removeHome(home)
  }
})

test('#36: 环形容量按 #41 口径（单会话 50 / 全局 500），不是旧的 12', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'index.js'), 'utf8')
  assert.match(source, /const DECISIONS_PER_SESSION = 50\b/, '单会话保留条数应为 50')
  assert.match(source, /const DECISIONS_MAX = 500\b/, '全局上限应为 500')
  assert.ok(!/DECISIONS_MAX = 12\b/.test(source), '旧的 12 条口径必须已被取代')
})