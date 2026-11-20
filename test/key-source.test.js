/**
 * #21 密钥字段：来源可见、可清除、env 值不被回写。
 *
 * 三层证据：
 *   1. 纯函数 keySourceLabel：env / 本机 / 未设置 / 来源未知 四种文案；
 *   2. 纯函数 buildSavePayload：没改过的字段（含 env 生效值）不进 payload；
 *   3. 端到端：环境变量提供密钥时保存，`jev-harness.json` 里不出现该密钥。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  boot, callRoute, makeHome, readJsonFile, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'
import { applyClient, loadClient, render, requireReactOrSkip, visibleText } from './helpers/client.js'

const SAVE = '/api/jev-harness/save'
const STATUS = '/api/jev-harness/status'
const { pkgs: reactPkgs, skip } = requireReactOrSkip()

test('#21: 来源文案覆盖 env / 本机 / 未设置 / 来源未知', { skip }, () => {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const { keySourceLabel } = loaded.exports.__test
  const zh = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'locale', 'zh.json'), 'utf8'))
  const t = (key, fallback, params) => {
    const template = typeof zh[key] === 'string' ? zh[key] : fallback
    return params && params.p0 !== undefined ? String(template).replace('{p0}', params.p0) : template
  }
  assert.equal(typeof keySourceLabel, 'function')

  assert.equal(keySourceLabel({ keySource: 'env', keyEnv: 'KIMI_API_KEY', keySet: true }, t), '来自环境变量 KIMI_API_KEY')
  assert.equal(keySourceLabel({ keySource: 'settings', keySet: true }, t), '已保存（留空不修改）· 本机')
  assert.equal(keySourceLabel({ keySource: 'config', keySet: true }, t), '来自插件配置')
  assert.equal(keySourceLabel({ keySource: 'none', keySet: false }, t), '尚未设置')
  assert.match(keySourceLabel({ keySet: true }, t), /来源未知/, '说不清来源时不许冒充「本机」')
})

test('#21: 保存载荷只带用户改过的字段（env 生效值不回写）', { skip }, () => {
  const loaded = loadClient(reactPkgs)
  applyClient(loaded)
  const { buildSavePayload } = loaded.exports.__test

  // 表单回填的是生效值（可能来自 env），基线与之相同 → 一个字段都不该提交。
  const form = {
    jev: { baseUrl: 'https://env-jev/v1', model: 'jev-env', apiKey: '', keySet: true },
    kimi: { baseUrl: 'https://env-kimi/v1', model: 'kimi-env', apiKey: '', keySet: true },
    dsf: { baseUrl: 'https://env-dsf/v1', model: 'dsf-env', apiKey: '', keySet: true },
  }
  const baseline = {
    jev: { baseUrl: 'https://env-jev/v1', model: 'jev-env' },
    kimi: { baseUrl: 'https://env-kimi/v1', model: 'kimi-env' },
    dsf: { baseUrl: 'https://env-dsf/v1', model: 'dsf-env' },
  }
  const plain = (value) => JSON.parse(JSON.stringify(value)) // client 在 vm 里跑，跨 realm 对象原型不同
  const untouched = buildSavePayload(form, baseline, {})
  assert.deepEqual(plain(untouched), {}, '没改过就不许提交任何网关字段')

  // 只改了 kimi 的地址 + 输入了 dsf 的密钥
  const edited = buildSavePayload({
    ...form,
    kimi: { ...form.kimi, baseUrl: 'https://mine.test/v1' },
    dsf: { ...form.dsf, apiKey: 'sk-new-key' },
  }, baseline, { routeMode: 'dsh' })
  assert.deepEqual(plain(edited).kimi, { baseUrl: 'https://mine.test/v1' }, '改过的地址要提交')
  assert.deepEqual(plain(edited).dsf, { apiKey: 'sk-new-key' }, '输入的密钥要提交')
  assert.ok(!('jev' in edited), '没改的网关不出现')
  assert.equal(edited.routeMode, 'dsh')
})

test('#21: 环境变量里的密钥保存后不会写进 jev-harness.json', async () => {
  const home = makeHome('key-env')
  writeStore(home, { kimiApiKey: '' })
  const previous = process.env.KIMI_API_KEY
  process.env.KIMI_API_KEY = 'sk-from-env-must-not-persist'
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.gateways.kimi.keySet, true, 'env 提供的密钥应被视为已设置')
    assert.equal(status.gateways.kimi.keyFromSettings, false, '但它不是本机保存的')

    // 模拟面板保存：客户端只提交用户改动（这里没有任何改动）。
    const saved = await callRoute(routes, SAVE, { method: 'POST', url: SAVE, body: { enabled: true } })
    assert.equal(saved.status, 200)
    const store = readJsonFile(path.join(home, 'jev-harness.json'))
    assert.ok(!store.kimiApiKey, 'env 密钥不许落盘到 jev-harness.json')
    assert.ok(!JSON.stringify(store).includes('sk-from-env-must-not-persist'), 'store 里不能出现 env 的值')
    // 明文也不许出现在响应里
    assert.ok(!JSON.stringify(saved.body).includes('sk-from-env-must-not-persist'))
  } finally {
    if (previous === undefined) delete process.env.KIMI_API_KEY
    else process.env.KIMI_API_KEY = previous
    stub.restore(); removeHome(home)
  }
})

test('#21: 面板渲染出常驻来源说明与显示/隐藏按钮', { skip }, () => {
  const stub = stubFetch(() => ({ ok: true, status: 200, json: async () => ({ ok: true, enabled: true, gateways: {}, route: {}, decisions: [], skills: {} }) }))
  const loaded = loadClient(reactPkgs)
  const applied = applyClient(loaded)
  try {
    const main = applied.registrations.find((entry) => entry.def && entry.def.name === 'main')
    const html = render(reactPkgs, main.comp)
    const text = visibleText(html)
    assert.equal((text.match(/尚未设置/g) || []).length, 3, '三个密钥字段都要有常驻来源说明')
    assert.match(text, /显示/, '要有「显示」按钮')
    assert.ok(!/本地保存|已保存（留空不修改）/.test(text), '初始态没有本机密钥，不该显示「已保存」')
  } finally {
    stub.restore()
  }
})

test('#21: /status 如实报告密钥来源（env / 本机 / 未设置）', async () => {
  const home = makeHome('key-source-field')
  writeStore(home, { kimiApiKey: '', dsfApiKey: '', jevApiKey: 'sk-saved-locally' })
  const prev = process.env.KIMI_API_KEY
  process.env.KIMI_API_KEY = 'sk-from-env'
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home })
    const status = (await callRoute(routes, STATUS, { url: STATUS })).body
    assert.equal(status.gateways.kimi.keySource, 'env')
    assert.equal(status.gateways.kimi.keyEnv, 'KIMI_API_KEY')
    assert.equal(status.gateways.kimi.keyFromSettings, false, 'env 来源不算本机设置')
    assert.equal(status.gateways.jev.keySource, 'settings')
    assert.equal(status.gateways.dsf.keySource, 'none')
    assert.equal(status.gateways.dsf.keyEnv, 'DSF_API_KEY', '即使没设置，也要能说出变量名')
  } finally {
    if (prev === undefined) delete process.env.KIMI_API_KEY
    else process.env.KIMI_API_KEY = prev
    stub.restore(); removeHome(home)
  }
})
