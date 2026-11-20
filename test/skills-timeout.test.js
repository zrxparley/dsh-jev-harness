/**
 * 技能刷新第二个请求必须有预算（issue #30）。
 *
 * 红（修复前）：codeload 的 tar 下载有超时，但 `api.github.com` 的 commit 请求
 * 没有 signal；上游挂住时 `/skills/refresh` 会无限挂起。
 * 绿：整个 refresh 共用 `timeoutMs` 总预算，commit 取不到就降级 `commit:null`，
 * 目录刷新照常完成。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  boot, bufferResponse, callRoute, jsonResponse, makeHome, readFixture, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'
import { skillMarkdown, tarGz } from './helpers/tar.js'

const REFRESH = '/api/jev-harness/skills/refresh'
const fixture = readFixture('skills-tar.json')

function tarball() {
  return tarGz(fixture.skills.map((entry) => ({
    path: `${fixture.root}/skills/${entry.id}/SKILL.md`,
    content: skillMarkdown(entry.id, entry.description),
  })))
}

/** 永不主动返回、但像真 fetch 一样响应 abort。 */
function hangingFetch(init) {
  return new Promise((_resolve, reject) => {
    const signal = init && init.signal
    if (!signal) return
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
  })
}

test('commit 请求挂住：刷新在总预算内完成，commit 降级为 null', async () => {
  const home = makeHome('skills-timeout')
  // #33: timeoutMs is now store-first, so the small total budget is set via the
  // store (not boot config) — the test still asserts "done within budget + commit:null".
  writeStore(home, { timeoutMs: 300 })
  const stub = stubFetch((url, init) => {
    if (String(url).includes('codeload.github.com')) return bufferResponse(tarball())
    if (String(url).includes('api.github.com')) return hangingFetch(init)
    return undefined
  })
  try {
    const { routes } = await boot({ home })
    const startedAt = Date.now()
    const refreshed = await callRoute(routes, REFRESH, { method: 'POST' })
    const elapsed = Date.now() - startedAt

    assert.equal(refreshed.status, 200, `刷新不该因为 commit 挂住而失败：${refreshed.body && refreshed.body.error}`)
    assert.equal(refreshed.body.ok, true)
    assert.equal(refreshed.body.count, 20, '目录本身要刷新成功')
    assert.equal(refreshed.body.commit, null, '取不到 commit 时必须是 null，不是 ref 冒充')
    const catalog = JSON.parse(fs.readFileSync(path.join(home, 'jev-harness-skills', 'catalog.json'), 'utf8'))
    assert.equal(catalog.snapshot.commit, null, '快照里也不许把 ref 当 sha 存')
    assert.ok(elapsed < 1500, `整个刷新应有总预算，实际 ${elapsed}ms`)
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('commit 正常返回时仍然记录 7 位短 sha', async () => {
  const home = makeHome('skills-commit-ok')
  writeStore(home)
  const stub = stubFetch((url) => {
    if (String(url).includes('codeload.github.com')) return bufferResponse(tarball())
    if (String(url).includes('api.github.com')) return jsonResponse({ sha: 'deadbeefcafe' })
    return undefined
  })
  try {
    const { routes } = await boot({ home })
    const refreshed = await callRoute(routes, REFRESH, { method: 'POST' })
    assert.equal(refreshed.status, 200)
    assert.equal(refreshed.body.commit, 'deadbee')
    const catalog = JSON.parse(fs.readFileSync(path.join(home, 'jev-harness-skills', 'catalog.json'), 'utf8'))
    assert.equal(catalog.snapshot.commit, 'deadbee')
  } finally {
    stub.restore()
    removeHome(home)
  }
})
