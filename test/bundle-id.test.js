/**
 * 客户端 bundle id 与宿主 module loader 的契约（issue #27）。
 *
 * 结论（代码依据）：loader 的 `register()` 用 `stripClientSuffix(registration.id)`
 * 作 factories 的键，`materialize(id)` 再用 boot manifest 的行 id 去取；两者不一致
 * 就是 "no registered factory"，面板不挂载。所以 id 必须等于安装包名，
 * 而包名随安装方式变（本地 bundle `@local/jev-harness` / npm `@zrxparley/dsh-jev-harness`）。
 *
 * 这里锁三件事：从 manifest 取对的 id、`/client` 后缀会被剥掉、没有 manifest 时回退本地 id。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient } from './helpers/client.js'

const FALLBACK_REACT = {
  createElement() { return null },
  useState() { return [undefined, () => {}] },
  useEffect() {},
  useCallback(fn) { return fn },
  useRef() { return { current: null } },
}

function loadWithManifest(entries) {
  const boot = entries === undefined ? undefined : { rev: 'r1', entries, batches: [] }
  return loadClient({ react: FALLBACK_REACT, server: null, jsx: {} }, { boot })
}

test('安装为 npm 包时，注册 id 跟随 manifest 的包名', () => {
  const loaded = loadWithManifest([
    { id: '@zrxparley/dsh-jev-harness', url: '/client-modules/x.js', rev: 'r1' },
  ])
  assert.equal(loaded.id, '@zrxparley/dsh-jev-harness')
})

test('安装为本地 bundle 时，注册 id 是本地包名', () => {
  const loaded = loadWithManifest([{ id: '@local/jev-harness', url: '/x.js', rev: 'r1' }])
  assert.equal(loaded.id, '@local/jev-harness')
})

test('manifest 行 id 带 /client 后缀时按 loader 规则剥掉', () => {
  const loaded = loadWithManifest([{ id: '@zrxparley/dsh-jev-harness/client', url: '/x.js', rev: 'r1' }])
  assert.equal(loaded.id, '@zrxparley/dsh-jev-harness')
})

test('没有 manifest（单元测试 / 旧宿主）时回退本地 id', () => {
  assert.equal(loadWithManifest(undefined).id, '@local/jev-harness')
  assert.equal(loadWithManifest([]).id, '@local/jev-harness')
  assert.equal(loadWithManifest([{ id: 'react', url: '/r.js', rev: 'r1' }]).id, '@local/jev-harness')
})

test('manifest 里有多个 entry 时只认自己那一行', () => {
  const loaded = loadWithManifest([
    { id: 'react', url: '/react.js', rev: 'r1' },
    { id: '@deepseek-ai/dsh-client-ui-slots', url: '/slots.js', rev: 'r1' },
    { id: '@zrxparley/dsh-jev-harness', url: '/jev.js', rev: 'r1' },
  ])
  assert.equal(loaded.id, '@zrxparley/dsh-jev-harness')
})
