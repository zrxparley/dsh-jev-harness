/**
 * #32 技能缓存：失效键 + 完整性校验 + 原子写。
 *
 * 旧行为（issue 证据）：命中条件只是「文件存在且非空」，一次半写留下的截断
 * `.md` 会被永久当成有效正文注入给模型，而且没有任何日志或 UI 提示。
 *
 * 这里锁四件事：
 *   1. 截断缓存 → 视为未命中、重取、覆盖；
 *   2. 没有 `repo@ref` 短哈希的旧缓存 → 不再命中；
 *   3. 换 skillsRef → 旧缓存不命中，且「已缓存 N 条」不把旧 ref 算进来；
 *   4. 正文既没有 frontmatter 也没有 `#` 标题 → 同样视为未命中。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  boot, makeHome, removeHome, stubFetch, textResponse, writeStore,
} from './helpers/harness.js'

const ID = 'engineering/tdd'
const FULL = '---\nname: tdd\ndescription: Test-driven development\n---\n\n# TDD\n\n先写测试再写实现。\n'
const REPO = 'mattpocock/skills'

const tagOf = (ref, repo = REPO) => crypto.createHash('sha256').update(`${repo}@${ref}`).digest('hex').slice(0, 8)
const cacheDir = (home) => path.join(home, 'jev-harness-skills')
const cacheFile = (home, ref = 'main') => path.join(cacheDir(home), `engineering__tdd.${tagOf(ref)}.md`)

function stubSkills() {
  const stub = stubFetch((url) => (url.includes('raw.githubusercontent.com') ? textResponse(FULL) : undefined))
  return stub
}

test('#32: 被截断的缓存正文视为未命中，重新拉取并覆盖', async () => {
  const home = makeHome('cache-truncated')
  writeStore(home)
  fs.mkdirSync(cacheDir(home), { recursive: true })
  // 半写文件：frontmatter 只写了一半，正文全丢（进程被杀 / 磁盘满的产物）。
  fs.writeFileSync(cacheFile(home), '---\nname: tdd\ndescription: Test-')
  const stub = stubSkills()
  try {
    const { tools } = await boot({ home })
    const first = await tools.get('harness_skill').execute({ action: 'read', id: ID }, {})
    assert.equal(first.text, FULL, '必须返回刚拉到的完整正文，而不是残文')
    assert.equal(stub.urls().length, 1, '截断缓存必须触发一次重取')
    assert.match(String(first.note), /fetched and cached/)
    assert.equal(fs.readFileSync(cacheFile(home), 'utf8'), FULL, '缓存文件应被完整正文覆盖')

    const second = await tools.get('harness_skill').execute({ action: 'read', id: ID }, {})
    assert.equal(second.text, FULL)
    assert.equal(stub.urls().length, 1, '修好之后第二次应命中缓存')
    assert.match(String(second.note), /served from cache/)

    const leftovers = fs.readdirSync(cacheDir(home)).filter((f) => f.endsWith('.tmp'))
    assert.deepEqual(leftovers, [], '原子写不应留下 .tmp 残留')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('#32: 没有 repo@ref 短哈希的旧缓存文件不再被命中', async () => {
  const home = makeHome('cache-untagged')
  writeStore(home)
  fs.mkdirSync(cacheDir(home), { recursive: true })
  // 旧命名：只有 id，没有任何失效键。
  fs.writeFileSync(path.join(cacheDir(home), 'engineering__tdd.md'), FULL)
  const stub = stubSkills()
  try {
    const { tools } = await boot({ home })
    const out = await tools.get('harness_skill').execute({ action: 'read', id: ID }, {})
    assert.equal(out.text, FULL)
    assert.equal(stub.urls().length, 1, '旧命名缓存没有失效键，必须重取而不是直接信任')
    assert.match(String(out.note), /fetched and cached/)
    assert.ok(fs.existsSync(cacheFile(home, 'main')), '应写出带 repo@ref 短哈希的新缓存')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('#32: 切换 skillsRef 后旧缓存不命中，且「已缓存」只数当前 ref', async () => {
  const home = makeHome('cache-ref-switch')
  writeStore(home)
  const stub = stubSkills()
  let first
  try {
    first = await boot({ home, config: { skillsRef: 'main' } })
    await first.tools.get('harness_skill').execute({ action: 'read', id: ID }, {})
    assert.equal(stub.urls().length, 1)
    assert.ok(fs.existsSync(cacheFile(home, 'main')), 'main 分支的缓存应落盘')
    if (typeof first.dispose === 'function') first.dispose()

    const second = await boot({ home, config: { skillsRef: 'dev' } })
    const out = await second.tools.get('harness_skill').execute({ action: 'read', id: ID }, {})
    assert.equal(out.text, FULL)
    assert.equal(stub.urls().length, 2, '换 ref 后必须重新拉取')
    assert.match(String(out.note), /fetched and cached/)
    assert.ok(fs.existsSync(cacheFile(home, 'dev')), 'dev 分支的缓存应另存一份')
    assert.ok(fs.existsSync(cacheFile(home, 'main')), '旧 ref 的缓存不删，只是不再命中')

    const state = await second.tools.get('harness_skill').execute({ action: 'status' }, {})
    assert.equal(JSON.parse(state.text).cached, 1, '「已缓存」只算当前 skillsRef，不算旧分支残留')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('#32: 既无 frontmatter 也无标题的缓存正文视为未命中', async () => {
  const home = makeHome('cache-no-shape')
  writeStore(home)
  fs.mkdirSync(cacheDir(home), { recursive: true })
  // 长度足够（>16 字节），但既不是 frontmatter 也没有 `#` 标题 —— 不是一份 SKILL.md。
  fs.writeFileSync(cacheFile(home), '这是一段普通文字没有任何结构信息也没有井号标题长度足够超过十六字节。')
  const stub = stubSkills()
  try {
    const { tools } = await boot({ home })
    const out = await tools.get('harness_skill').execute({ action: 'read', id: ID }, {})
    assert.equal(out.text, FULL)
    assert.equal(stub.urls().length, 1, '没有 SKILL.md 结构的正文必须重取')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('#32: 空文件与超短缓存同样不命中', async () => {
  const home = makeHome('cache-empty')
  writeStore(home)
  fs.mkdirSync(cacheDir(home), { recursive: true })
  fs.writeFileSync(cacheFile(home), '')
  const stub = stubSkills()
  try {
    const { tools } = await boot({ home })
    const out = await tools.get('harness_skill').execute({ action: 'read', id: ID }, {})
    assert.equal(out.text, FULL)
    assert.equal(stub.urls().length, 1, '空缓存必须重取')
    fs.writeFileSync(cacheFile(home), '# 短') // 有标题但不足 16 字节
    const again = await tools.get('harness_skill').execute({ action: 'read', id: ID }, {})
    assert.equal(again.text, FULL)
    assert.equal(stub.urls().length, 2, '超短缓存同样必须重取')
  } finally {
    stub.restore()
    removeHome(home)
  }
})