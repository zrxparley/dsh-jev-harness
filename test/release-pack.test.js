/**
 * 发布态 smoke：按 package.json 的 `files` 打一个 tarball，解包后从解出来的
 * lib/client.js 装载客户端，断言 main + sidebar 两个槽位真的注册出来。
 *
 * 本机没有 npm（不能 `npm pack`），所以用系统 tar 复刻「打包 → 解包 → 装载」
 * 这一步，至少能抓住「打包漏文件」「客户端在发布树里挂不上」这类问题。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REPO, readFixture } from './helpers/harness.js'
import { loadClient, applyClient } from './helpers/client.js'

const FALLBACK_REACT = {
  createElement() { return null },
  useState() { return [undefined, () => {}] },
  useEffect() {},
  useCallback(fn) { return fn },
  useRef() { return { current: null } },
}

/** 展开 package.json 的 files（只有 locale/*.json 一个通配）。 */
function packFiles() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  const out = ['package.json']
  for (const entry of pkg.files || []) {
    if (!entry.includes('*')) { out.push(entry); continue }
    const dir = path.dirname(entry)
    const ext = path.extname(entry)
    for (const name of fs.readdirSync(path.join(REPO, dir))) {
      if (path.extname(name) === ext) out.push(path.join(dir, name))
    }
  }
  return out
}

test('按 files 打包解包后，客户端仍能挂载 main + sidebar', () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-pack-'))
  const tarball = path.join(stage, 'pkg.tgz')
  const unpacked = path.join(stage, 'unpacked')
  fs.mkdirSync(unpacked)
  try {
    const files = packFiles()
    const tar = spawnSync('tar', ['-czf', tarball, ...files], { cwd: REPO, encoding: 'utf8' })
    assert.equal(tar.status, 0, `tar 打包失败：${tar.stderr || ''}`)

    const extract = spawnSync('tar', ['-xzf', tarball, '-C', unpacked], { encoding: 'utf8' })
    assert.equal(extract.status, 0, `tar 解包失败：${extract.stderr || ''}`)

    // 发布树必须带上客户端与宿主半边
    for (const required of ['package.json', 'index.js', 'skills.js', 'lib/client.js', 'cordis.patch.yml']) {
      assert.ok(fs.existsSync(path.join(unpacked, required)), `发布树缺少 ${required}`)
    }

    const loaded = loadClient(
      { react: FALLBACK_REACT, server: null, jsx: {} },
      { boot: { rev: 'r1', entries: [{ id: '@zrxparley/dsh-jev-harness', url: '/x.js', rev: 'r1' }], batches: [] }, clientPath: path.join(unpacked, 'lib', 'client.js') },
    )
    assert.equal(loaded.id, '@zrxparley/dsh-jev-harness', '发布态应注册到包名，而不是 @local')

    const { registrations } = applyClient(loaded)
    const names = registrations.map((entry) => entry.def.name)
    assert.ok(names.includes('main'), '发布态没有注册 main 槽位')
    assert.ok(names.includes('sidebar.panellist'), '发布态没有注册 sidebar.panellist 槽位')
    assert.ok(registrations.every((entry) => typeof entry.comp === 'function'), '每个槽位都要拿到组件')
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
})

test('打包清单与实际引用一致：client 里没有对未打包文件的 require', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
  const source = fs.readFileSync(path.join(REPO, 'lib', 'client.js'), 'utf8')
  const required = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1])
  for (const spec of required) {
    assert.ok(['react', 'react/jsx-runtime', 'react-dom'].includes(spec), `客户端 require 了非宿主依赖：${spec}`)
  }
  assert.ok(pkg.files.includes('lib/client.js'))
})
