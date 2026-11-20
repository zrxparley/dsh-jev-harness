import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  boot, callRoute, makeHome, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'
import { REPO } from './helpers/harness.js'

const METHOD_GUARDS = [
  ['/api/jev-harness/token', 'POST'],
  ['/api/jev-harness/status', 'POST'],
  ['/api/jev-harness/credentials/migrate', 'GET'],
  ['/api/jev-harness/credentials/cleanup', 'GET'],
  ['/api/jev-harness/selfcheck', 'GET'],
  ['/api/jev-harness/save', 'GET'],
  ['/api/jev-harness/export', 'POST'],
  ['/api/jev-harness/toggle', 'GET'],
  ['/api/jev-harness/skills/refresh', 'GET'],
  ['/api/jev-harness/stats', 'POST'],
  ['/api/jev-harness/dsh/models', 'POST'],
  ['/api/jev-harness/test', 'GET'],
]

async function checkMethodGuardLocale({ home, services, expected }) {
  writeStore(home)
  const stub = stubFetch(() => undefined)
  try {
    const { routes } = await boot({ home, services })
    const failures = []
    for (const [pathname, method] of METHOD_GUARDS) {
      const response = await callRoute(routes, pathname, { method, url: pathname })
      if (response.status !== 405 || response.body?.ok !== false || response.body?.error !== expected) {
        failures.push({ pathname, status: response.status, body: response.body })
      }
    }
    assert.deepEqual(failures, [], `12 处 405 都应返回 ${expected}`)
  } finally {
    stub.restore()
    removeHome(home)
  }
}

test('#20: 所有 405 响应默认返回中文', async () => {
  await checkMethodGuardLocale({
    home: makeHome('method-locale-zh'),
    services: {},
    expected: '请求方法不允许',
  })
})

test('#20: 所有 405 响应随 en locale 返回英文', async () => {
  const messages = JSON.parse(fs.readFileSync(path.join(REPO, 'locale', 'en.json'), 'utf8'))
  await checkMethodGuardLocale({
    home: makeHome('method-locale-en'),
    services: {
      locale: {
        bind(namespace) {
          assert.equal(namespace, 'jev-harness')
          return (key) => messages[key] || key
        },
      },
    },
    expected: 'Method not allowed',
  })
})

test('#20: index.js 不再硬编码英文 405 文案', () => {
  const source = fs.readFileSync(path.join(REPO, 'index.js'), 'utf8')
  assert.equal(source.includes("error: 'method not allowed'"), false)
})
