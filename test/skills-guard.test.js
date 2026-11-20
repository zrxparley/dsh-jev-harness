/**
 * 技能目录刷新的护栏（issue #28）。
 *
 * 红命令（修复前实测）：4 条目的 tar 里放 1 个坏 size 头 → refresh 返回
 * `ok:true, count:3`，/status 从 39 变 3，catalog.json 被永久覆盖。
 *
 * 这里锁四条：
 * - 坏 size / 空 tar / HTML 错误页 → 失败且保留原目录
 * - 缺 frontmatter description → 完整性校验不过，不落盘
 * - 数量腰斩 → 拒绝覆盖
 * - catalog 原子替换：rename 失败时旧目录原样保留
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  boot, bufferResponse, callRoute, jsonResponse, makeHome, readFixture,
  removeHome, stubFetch, textResponse, writeStore,
} from './helpers/harness.js'
import { skillMarkdown, tarEntry, tarGz, tarHeader } from './helpers/tar.js'

const STATUS = '/api/jev-harness/status'
const REFRESH = '/api/jev-harness/skills/refresh'
const fixture = readFixture('skills-tar.json')

function validTar() {
  return tarGz(fixture.skills.map((entry) => ({
    path: `${fixture.root}/skills/${entry.id}/SKILL.md`,
    content: skillMarkdown(entry.id, entry.description),
  })))
}

async function statusOf(routes) {
  return (await callRoute(routes, STATUS, { url: STATUS })).body.skills
}

/** 起一个 home，stub 只回答 codeload/commit，其余交给用例。 */
async function withHome(tarball, run) {
  const home = makeHome('skills-guard')
  writeStore(home)
  const stub = stubFetch((url) => {
    if (String(url).includes('codeload.github.com')) return bufferResponse(tarball)
    if (String(url).includes('api.github.com')) return jsonResponse({ sha: 'deadbeefcafe' })
    return undefined
  })
  try {
    const { routes } = await boot({ home })
    await run({ routes, home })
  } finally {
    stub.restore()
    removeHome(home)
  }
}

test('坏 size 的 tar：refresh 失败，39 条原样保留，catalog 不落盘', async () => {
  const bad = Buffer.concat([
    tarEntry('repo-main/skills/engineering/alpha/SKILL.md', skillMarkdown('engineering/alpha', 'first')),
    tarEntry('repo-main/skills/engineering/beta/SKILL.md', skillMarkdown('engineering/beta', 'second')),
    tarHeader('repo-main/skills/engineering/gamma/SKILL.md', 10, { corruptSize: true }),
    tarEntry('repo-main/skills/engineering/gamma/SKILL.md', skillMarkdown('engineering/gamma', 'third')),
  ])
  await withHome(zlib.gzipSync(bad), async ({ routes, home }) => {
    const before = await statusOf(routes)
    assert.equal(before.count, 39)

    const refreshed = await callRoute(routes, REFRESH, { method: 'POST' })
    assert.equal(refreshed.status, 500)
    assert.equal(refreshed.body.ok, false)
    assert.match(String(refreshed.body.error), /size 字段非法/)

    const after = await statusOf(routes)
    assert.equal(after.count, 39, '失败后目录必须原样保留')
    assert.equal(after.source, 'bundled')
    assert.equal(fs.existsSync(path.join(home, 'jev-harness-skills', 'catalog.json')), false, '失败时不许写 catalog')
  })
})

test('空 tar 与 HTML 错误页：同样失败且保留原目录', async () => {
  await withHome(zlib.gzipSync(Buffer.alloc(0)), async ({ routes }) => {
    const refreshed = await callRoute(routes, REFRESH, { method: 'POST' })
    assert.equal(refreshed.status, 500)
    assert.match(String(refreshed.body.error), /no skills found/)
    assert.equal((await statusOf(routes)).count, 39)
  })

  await withHome(Buffer.from('<html><body>502 Bad Gateway</body></html>'), async ({ routes }) => {
    const refreshed = await callRoute(routes, REFRESH, { method: 'POST' })
    assert.equal(refreshed.status, 500)
    assert.equal(refreshed.body.ok, false)
    assert.equal((await statusOf(routes)).count, 39)
  })
})

test('SKILL.md 缺 frontmatter description：完整性校验不过，不落盘', async () => {
  const entries = fixture.skills.map((entry) => ({
    path: `${fixture.root}/skills/${entry.id}/SKILL.md`,
    content: entry.id === 'engineering/skill-07'
      ? `---\nname: skill-07\n---\n# incomplete\n`
      : skillMarkdown(entry.id, entry.description),
  }))
  await withHome(tarGz(entries), async ({ routes, home }) => {
    const refreshed = await callRoute(routes, REFRESH, { method: 'POST' })
    assert.equal(refreshed.status, 500)
    assert.match(String(refreshed.body.error), /技能目录不完整/)
    assert.match(String(refreshed.body.error), /engineering\/skill-07/)
    assert.equal((await statusOf(routes)).count, 39)
    assert.equal(fs.existsSync(path.join(home, 'jev-harness-skills', 'catalog.json')), false)
  })
})

test('数量腰斩（20 条覆盖 39 条）：拒绝替换并保留原目录', async () => {
  const few = fixture.skills.slice(0, 9)
  const tarball = tarGz(few.map((entry) => ({
    path: `${fixture.root}/skills/${entry.id}/SKILL.md`,
    content: skillMarkdown(entry.id, entry.description),
  })))
  await withHome(tarball, async ({ routes }) => {
    const refreshed = await callRoute(routes, REFRESH, { method: 'POST' })
    assert.equal(refreshed.status, 500)
    assert.match(String(refreshed.body.error), /拒绝用 9 条覆盖现有 39 条/)
    assert.equal((await statusOf(routes)).count, 39)
  })
})

test('catalog 原子替换：rename 失败时旧目录原样保留、不残留 tmp', async () => {
  await withHome(validTar(), async ({ routes, home }) => {
    const first = await callRoute(routes, REFRESH, { method: 'POST' })
    assert.equal(first.status, 200, '先做一次正常刷新')
    const catalogFile = path.join(home, 'jev-harness-skills', 'catalog.json')
    const before = fs.readFileSync(catalogFile, 'utf8')

    const realRename = fs.renameSync
    fs.renameSync = () => {
      const error = new Error('EROFS: read-only file system')
      error.code = 'EROFS'
      throw error
    }
    let second
    try {
      second = await callRoute(routes, REFRESH, { method: 'POST' })
    } finally {
      fs.renameSync = realRename
    }

    assert.equal(second.status, 500)
    assert.match(String(second.body.error), /原目录保留/)
    assert.equal(fs.readFileSync(catalogFile, 'utf8'), before, 'rename 失败不许顶掉旧 catalog')
    const leftovers = fs.readdirSync(path.join(home, 'jev-harness-skills')).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(leftovers, [])
    assert.equal((await statusOf(routes)).count, 20)
  })
})
