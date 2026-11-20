/**
 * 账本持久化（issue #25）：损坏隔离、原子写、跨进程并发、只读盘不冒泡。
 *
 * 四条验收原文：
 * - 截断 JSON 后 /stats 返回 warning，原文件改名 *.corrupt-<ts>.json
 * - 再次 recordUsage 后 totals 从 1 起算，不出现「假 0 且无痕」
 * - 两个子进程各记 50 次，最终 totals.dsf.calls === 100
 * - 面板在账本损坏时显示一条可见提示（这里测渲染，见 traffic-board 的 warning 用例）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  REPO, boot, callRoute, chatResponse, fileExists, makeHome, readJsonFile,
  removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

const STATS = '/api/jev-harness/stats'
const CHILD = path.join(REPO, 'test', 'helpers', 'record-child.js')

function chatStub() {
  return stubFetch((url) => (String(url).includes('/chat/completions') ? chatResponse('完成') : undefined))
}

function runChild(home, count) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CHILD, home, String(count)], {
      env: { ...process.env, DSH_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`子进程退出码 ${code}：${stderr.slice(-400)}`))
    })
  })
}

test('截断的账本：/stats 给 warning，原文件被隔离，下次记账从 1 起算', async () => {
  const home = makeHome('usage-corrupt')
  writeStore(home)
  const truncated = '{"version":1,"hours":{'
  const ledgerFile = path.join(home, 'jev-harness-usage.json')
  fs.writeFileSync(ledgerFile, truncated, { mode: 0o600 })

  const stub = chatStub()
  try {
    const { routes, tools } = await boot({ home })

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.ok, true)
    assert.ok(stats.warning, '账本损坏时 /stats 必须带回 warning')
    assert.equal(stats.warning.code, 'usage-ledger-corrupt')
    assert.ok(String(stats.warning.message).includes('损坏'))
    assert.ok(stats.warning.backup, 'warning 必须指出隔离后的备份文件')
    assert.ok(fileExists(stats.warning.backup), '备份文件不在磁盘上')
    assert.equal(fs.readFileSync(stats.warning.backup, 'utf8'), truncated, '备份必须是原始损坏内容，不是重写过的')
    assert.equal(fileExists(ledgerFile), false, '损坏的原文件应被移走，而不是留着继续骗人')
    assert.equal(stats.totals.dsf.calls, 0, '隔离后旧数据不可恢复，这里就该是 0')

    const backups = fs.readdirSync(home).filter((name) => /^jev-harness-usage\.corrupt-.+\.json$/.test(name))
    assert.equal(backups.length, 1, `应只有 1 个隔离文件，实际：${backups.join(', ')}`)

    // 再次记账：新账本从 0 写到 1，而不是继续「假 0」
    const recorded = await tools.get('harness_call').execute({ task: '重新开始', tier: 'execution', skill: 'off' }, {})
    assert.equal(recorded.ok, true)

    const after = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(after.totals.dsf.calls, 1, '下一次记账必须从 1 起算')
    assert.equal(after.totals.dsf.tokens, 140)
    assert.ok(after.warning, '提示是粘性的：重启前一直可见，避免刷新一次就消失')
    assert.equal(readJsonFile(ledgerFile).days !== undefined, true, '新账本应是合法 JSON')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('rename 失败（只读盘）：原账本保持完好，不留下 .tmp，调用照常成功', async () => {
  const home = makeHome('usage-rename-fail')
  writeStore(home)
  const ledgerFile = path.join(home, 'jev-harness-usage.json')
  const stub = chatStub()
  const realRenameSync = fs.renameSync
  try {
    const { routes, tools } = await boot({ home })
    await tools.get('harness_call').execute({ task: 'first', tier: 'execution', skill: 'off' }, {})
    const before = readJsonFile(ledgerFile)

    fs.renameSync = (from, to) => {
      const error = new Error('EROFS: read-only file system')
      error.code = 'EROFS'
      error.path = String(to)
      throw error
    }
    const recorded = await tools.get('harness_call').execute({ task: 'second', tier: 'execution', skill: 'off' }, {})
    fs.renameSync = realRenameSync

    assert.equal(recorded.ok, true, '写账本失败不许影响调用结果')
    assert.deepEqual(readJsonFile(ledgerFile), before, '原子写失败时旧账本必须原样保留')
    const leftovers = fs.readdirSync(home).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(leftovers, [], `不该留下临时文件：${leftovers.join(', ')}`)

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.totals.dsf.calls, 1, '这一次没写进去，账目仍是 1')
    assert.equal(stats.warning, null, '写失败不是损坏，不该误报 warning')
  } finally {
    fs.renameSync = realRenameSync
    stub.restore()
    removeHome(home)
  }
})

test('EROFS 落在 writeFileSync 上也不冒泡：调用成功、账本不动', async () => {
  const home = makeHome('usage-eros')
  writeStore(home)
  const ledgerFile = path.join(home, 'jev-harness-usage.json')
  const stub = chatStub()
  const realWriteFileSync = fs.writeFileSync
  try {
    const { routes, tools } = await boot({ home })
    await tools.get('harness_call').execute({ task: 'first', tier: 'execution', skill: 'off' }, {})
    const before = fs.readFileSync(ledgerFile, 'utf8')

    fs.writeFileSync = (file, ...rest) => {
      if (String(file).includes('jev-harness-usage')) {
        const error = new Error('EROFS: read-only file system')
        error.code = 'EROFS'
        throw error
      }
      return realWriteFileSync(file, ...rest)
    }
    // 只要这里 reject，用例就直接失败 —— 这正是「不冒泡」的断言
    const result = await tools.get('harness_call').execute({ task: 'second', tier: 'execution', skill: 'off' }, {})
    fs.writeFileSync = realWriteFileSync

    assert.equal(result.ok, true, '记账写盘失败不许把调用打成失败')
    assert.equal(fs.readFileSync(ledgerFile, 'utf8'), before, '写不进去就保持原样')

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.totals.dsf.calls, 1)
    assert.equal(stats.warning, null)
  } finally {
    fs.writeFileSync = realWriteFileSync
    stub.restore()
    removeHome(home)
  }
})

test('两个子进程各记 50 次，合计正好 100 次', async () => {
  const home = makeHome('usage-concurrent')
  writeStore(home)
  const stub = chatStub()
  try {
    const { routes } = await boot({ home })

    await Promise.all([runChild(home, 50), runChild(home, 50)])

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.warning, null, '并发写入不该把账本弄坏')
    assert.equal(stats.totals.dsf.calls, 100, `并发丢账：只记到 ${stats.totals.dsf.calls} 次`)
    const summed = stats.buckets.reduce((sum, bucket) => sum + bucket.gateways.dsf.calls, 0)
    assert.equal(summed, 100, '小时桶里的合计也必须是 100')

    const ledger = readJsonFile(path.join(home, 'jev-harness-usage.json'))
    assert.equal(ledger.recent.length, 40, '明细环形缓冲应封顶 40 条')
    const leftovers = fs.readdirSync(home).filter((name) => name.endsWith('.tmp') || name.endsWith('.lock'))
    assert.deepEqual(leftovers, [], `不该留下临时文件或锁：${leftovers.join(', ')}`)
  } finally {
    stub.restore()
    removeHome(home)
  }
})
test('崩溃遗留的陈旧锁（超过 10s）会被清掉，不拖慢记账', async () => {
  const home = makeHome('usage-stale-lock')
  writeStore(home)
  const lockFile = path.join(home, 'jev-harness-usage.json.lock')
  const stub = chatStub()
  try {
    const { routes, tools } = await boot({ home })
    const call = tools.get('harness_call')
    await call.execute({ task: 'first', tier: 'execution', skill: 'off' }, {})

    fs.writeFileSync(lockFile, 'stale', { mode: 0o600 })
    const old = new Date(Date.now() - 20000)
    fs.utimesSync(lockFile, old, old)

    const startedAt = Date.now()
    const recorded = await call.execute({ task: 'second', tier: 'execution', skill: 'off' }, {})
    const elapsed = Date.now() - startedAt

    assert.equal(recorded.ok, true)
    // 主断言：清理没发生的话锁文件会留在原地并被退化直写绕过 —— 与耗时无关。
    assert.equal(fileExists(lockFile), false, '陈旧锁文件没有被删除')
    // 次断言：只排除「等到超时」这一种，给重载 CI 留足余量。
    assert.ok(elapsed < 3000, `陈旧锁不该走超时路径，实际等了 ${elapsed}ms`)

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.totals.dsf.calls, 2)
    assert.equal(stats.warning, null)
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('锁被活进程占着：两次记账各等 2s 后退化直写，调用不被拖死也不丢这一笔', async () => {
  const home = makeHome('usage-lock-timeout')
  writeStore(home)
  const lockFile = path.join(home, 'jev-harness-usage.json.lock')
  const stub = chatStub()
  try {
    const { routes, tools } = await boot({ home })
    const call = tools.get('harness_call')
    await call.execute({ task: 'first', tier: 'execution', skill: 'off' }, {})

    // 一个「活着」的持锁者：mtime 新鲜，不会被当成陈旧锁清掉
    fs.writeFileSync(lockFile, 'held by another process', { mode: 0o600 })

    const startedAt = Date.now()
    const recorded = await call.execute({ task: 'second', tier: 'execution', skill: 'off' }, {})
    const elapsed = Date.now() - startedAt

    assert.equal(recorded.ok, true, '拿不到锁也不许把调用打成失败')
    // 一次 harness_call 写两份记录（decision + usage），因此是 2 × 2s ≈ 4s。
    // 下界只用来区分「真的等了」与「立刻退化」，不锁死具体毫秒数。
    assert.ok(elapsed >= 2000, `应等待锁超时后再退化直写，实际 ${elapsed}ms`)
    assert.ok(elapsed < 15000, `不该无限等待，实际 ${elapsed}ms`)
    assert.equal(fileExists(lockFile), true, '别人的锁不该被我们删掉')

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.totals.dsf.calls, 2, '退化直写也要把这笔记上')
    assert.equal(stats.warning, null)
  } finally {
    try { fs.unlinkSync(lockFile) } catch { /* 已删 */ }
    stub.restore()
    removeHome(home)
  }
})

test('账本读不出来（EACCES）：给 unreadable warning，不隔离也不假装成空账本', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root 下 chmod 000 拦不住读取' : false }, async () => {
  const home = makeHome('usage-eacces')
  writeStore(home)
  const ledgerFile = path.join(home, 'jev-harness-usage.json')
  const stub = chatStub()
  try {
    const { routes, tools } = await boot({ home })
    await tools.get('harness_call').execute({ task: 'first', tier: 'execution', skill: 'off' }, {})
    const before = fs.readFileSync(ledgerFile, 'utf8')
    fs.chmodSync(ledgerFile, 0o000)

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.ok, true)
    assert.ok(stats.warning, '读不出来也必须给 warning，不能显示成干净的 0')
    assert.equal(stats.warning.code, 'usage-ledger-unreadable')
    assert.equal(stats.warning.backup, null)
    assert.equal(stats.totals.dsf.calls, 0)
    assert.equal(fileExists(ledgerFile), true, '读失败不是损坏，不许把文件挪走')

    fs.chmodSync(ledgerFile, 0o600)
    assert.equal(fs.readFileSync(ledgerFile, 'utf8'), before, '整个过程账本内容不能被改写')
  } finally {
    try { fs.chmodSync(ledgerFile, 0o600) } catch { /* 已经恢复 */ }
    stub.restore()
    removeHome(home)
  }
})

test('三个子进程各记 20 次，合计正好 60 次（>2 进程）', async () => {
  const home = makeHome('usage-concurrent3')
  writeStore(home)
  const stub = chatStub()
  try {
    const { routes } = await boot({ home })
    await Promise.all([runChild(home, 20), runChild(home, 20), runChild(home, 20)])

    const stats = (await callRoute(routes, STATS, { url: `${STATS}?hours=24` })).body
    assert.equal(stats.warning, null)
    assert.equal(stats.totals.dsf.calls, 60, `三进程并发丢账：只记到 ${stats.totals.dsf.calls} 次`)
    const leftovers = fs.readdirSync(home).filter((name) => name.endsWith('.tmp') || name.endsWith('.lock'))
    assert.deepEqual(leftovers, [])
  } finally {
    stub.restore()
    removeHome(home)
  }
})
