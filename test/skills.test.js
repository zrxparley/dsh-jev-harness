/**
 * 技能目录 / 刷新 / pick（对应旧的临时脚本 test-skills.mjs）。
 *
 * - 内置快照必须稳定是 39 条；
 * - list / status 走 catalog；
 * - pick 交给 JEV 判定器（这里 stub），返回的 id 必须能落到 catalog 里；
 * - refresh 走真实的 gunzip + ustar 解析 + catalog.json 落盘；
 * - 刷新失败要报错，不能把旧目录悄悄清空。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  boot, bufferResponse, callRoute, fileExists, jsonResponse, makeHome, readFixture,
  readJsonFile, removeHome, stubFetch, textResponse, writeStore,
} from './helpers/harness.js'
import { skillMarkdown, tarGz } from './helpers/tar.js'

const STATUS = '/api/jev-harness/status'
const REFRESH = '/api/jev-harness/skills/refresh'

function tarFromFixture(fixture) {
  return tarGz(fixture.skills.map((entry) => ({
    path: `${fixture.root}/skills/${entry.id}/SKILL.md`,
    content: skillMarkdown(entry.id, entry.description),
  })))
}

test('内置目录 39 条，list / status 都读同一份 catalog', async () => {
  const home = makeHome('skills-list')
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes, tools } = await boot({ home })

    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.skills.count, 39, '内置快照应该是 39 个技能')
    assert.equal(status.skills.source, 'bundled')
    assert.equal(status.skills.auto, true, '自动挂载 skill 默认开')

    const skillTool = tools.get('harness_skill')
    assert.ok(skillTool, 'harness_skill 工具没注册')

    const list = await skillTool.execute({ action: 'list' }, {})
    assert.equal(list.ok, true)
    const lines = String(list.text).split('\n')
    assert.equal(lines.length, 39, `list 行数应为 39，实际 ${lines.length}`)
    assert.ok(lines.every((line) => line.includes(' — ')), '每行应为「id — description」')
    assert.ok(String(list.note).startsWith('39 skills (bundled)'))

    const state = await skillTool.execute({ action: 'status' }, {})
    assert.equal(state.ok, true)
    const parsed = JSON.parse(state.text)
    assert.equal(parsed.count, 39)
    assert.equal(parsed.source, 'bundled')
    assert.equal(parsed.autoMount, true)
    assert.equal(parsed.dir, path.join(home, 'jev-harness-skills'), '缓存目录必须落在 DSH_HOME 下')

    assert.deepEqual(stub.urls(), [], '读目录不该发网络请求')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('pick 交给 JEV 判定器：题目里要有 none 和候选 id，选中结果原样返回', async () => {
  const home = makeHome('skills-pick')
  writeStore(home)
  let asked = null
  const stub = stubFetch((url, init) => {
    if (!url.includes('/systemone')) return undefined
    const payload = JSON.parse(init.body)
    asked = payload.questions.skill
    return jsonResponse({
      model: 'jev-9.9.9',
      answers: { skill: { choice: 'engineering/tdd', confidence: 0.88 } },
      usage: { input_tokens: 5, output_tokens: 1 },
    })
  })
  try {
    const { tools } = await boot({ home })
    const tool = tools.get('harness_skill')
    const pick = await tool.execute({ action: 'pick', task: 'build this feature test-first, red green refactor' }, {})

    assert.ok(asked, 'pick 没有去问 JEV 判定器')
    assert.ok('none' in asked.criteria, '判定题目里必须有 none 选项')
    assert.ok('engineering/tdd' in asked.criteria, '判定题目里必须有候选技能')
    assert.equal(Object.keys(asked.criteria).length, 40, '应该是 none + 39 个候选')
    assert.equal(pick.ok, true)
    assert.equal(pick.model, 'engineering/tdd')
    assert.equal(pick.text, 'engineering/tdd')
    assert.ok(String(pick.note).includes('jev-9.9.9') || String(pick.note).length > 0)
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('refresh 解析真实 tarball，重写 catalog.json 并让 list 跟随', async () => {
  const home = makeHome('skills-refresh')
  writeStore(home)
  const fixture = readFixture('skills-tar.json')
  const tarball = tarFromFixture(fixture)
  const stub = stubFetch((url) => {
    if (url.startsWith('https://codeload.github.com/')) return bufferResponse(tarball)
    if (url.includes('api.github.com')) return jsonResponse({ sha: fixture.commit })
    return undefined
  })
  try {
    const { routes, tools } = await boot({ home })

    const refreshed = await callRoute(routes, REFRESH, { method: 'POST' })
    assert.equal(refreshed.status, 200)
    assert.equal(refreshed.body.ok, true, `刷新失败：${refreshed.body.error || ''}`)
    assert.equal(refreshed.body.count, 3)
    assert.equal(refreshed.body.added, 3)
    assert.equal(refreshed.body.removed, 0, '首次刷新时本地还没有 catalog 文件，没有可移除的旧条目')

    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.skills.count, 3, '刷新后目录应变成 tarball 里的 3 条')
    assert.equal(status.skills.source, 'refreshed')
    assert.equal(status.skills.cached, 3, '正文应缓存成 3 个 .md')

    const catalogFile = path.join(home, 'jev-harness-skills', 'catalog.json')
    assert.ok(fileExists(catalogFile), 'catalog.json 没有落盘')
    const catalog = readJsonFile(catalogFile)
    assert.deepEqual(
      catalog.skills.map((entry) => entry.id),
      ['engineering/alpha', 'engineering/beta', 'engineering/gamma'],
    )
    assert.equal(catalog.snapshot.commit, fixture.commit.slice(0, 7), '快照里存的是 7 位短 commit')

    const list = await tools.get('harness_skill').execute({ action: 'list' }, {})
    assert.equal(String(list.text).split('\n').length, 3, 'list 应跟随刷新后的目录')

    // 只允许打这两个域名
    for (const url of stub.urls()) {
      assert.ok(
        url.startsWith('https://codeload.github.com/') || url.startsWith('https://api.github.com/'),
        `刷新时出现未预期的网络请求：${url}`,
      )
    }
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('refresh 拿到 HTTP 500 时要明确报错，且不动已有目录', async () => {
  const home = makeHome('skills-refresh-fail')
  writeStore(home)
  const stub = stubFetch((url) => {
    if (url.startsWith('https://codeload.github.com/')) return textResponse('upstream down', 500)
    return undefined
  })
  try {
    const { routes } = await boot({ home })
    const refreshed = await callRoute(routes, REFRESH, { method: 'POST' })
    assert.equal(refreshed.status, 500)
    assert.equal(refreshed.body.ok, false)
    assert.ok(String(refreshed.body.error).includes('500'), `错误里应带状态码：${refreshed.body.error}`)

    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.skills.count, 39, '刷新失败不该清空内置目录')
    assert.equal(status.skills.source, 'bundled')
    assert.equal(fileExists(path.join(home, 'jev-harness-skills', 'catalog.json')), false, '失败时不该写 catalog')
  } finally {
    stub.restore()
    removeHome(home)
  }
})