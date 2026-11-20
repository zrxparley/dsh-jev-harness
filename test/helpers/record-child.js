/**
 * 子进程：往同一个 DSH_HOME 里连续记 N 条执行层调用。
 * 由 usage-integrity.test.js 的「双进程各 50 次」用例拉起，用来验证跨进程不丢更新。
 *
 * 用法：node test/helpers/record-child.js <DSH_HOME> [count]
 */
import { boot, chatResponse, stubFetch } from './harness.js'

const home = process.argv[2]
const count = Number(process.argv[3] || 50)
if (!home) {
  console.error('usage: record-child.js <DSH_HOME> [count]')
  process.exit(2)
}

stubFetch((url) => (String(url).includes('/chat/completions') ? chatResponse('ok', { prompt: 1, completion: 1 }) : undefined))

const { tools } = await boot({ home })
const call = tools.get('harness_call')
if (!call) {
  console.error('harness_call 未注册')
  process.exit(1)
}

for (let i = 0; i < count; i += 1) {
  const result = await call.execute({ task: `load ${i}`, tier: 'execution', skill: 'off' }, {})
  if (!result.ok) {
    console.error(`call ${i} failed: ${result.note}`)
    process.exit(1)
  }
}
process.exit(0)