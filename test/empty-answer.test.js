/**
 * 空正文提示（issue #31）。
 *
 * 红点（修复前）：content='' + reasoning_content 200 字 + completion_tokens 40
 * 会写出 `spent 67 of 40`——reasoning 估算混进真实计数；而且 harness_review
 * 完全没有这条提示。
 *
 * 验收：reasoning 数字 ≤ completion；review 也有同样提示；两条路径共用一个函数。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  REPO, boot, jsonResponse, makeHome, removeHome, stubFetch, writeStore,
} from './helpers/harness.js'

function emptyReply({ completion = 40, reasoningChars = 200, reasoningTokens } = {}) {
  const usage = { prompt_tokens: 10, completion_tokens: completion, total_tokens: 50 }
  if (reasoningTokens !== undefined) usage.completion_tokens_details = { reasoning_tokens: reasoningTokens }
  return jsonResponse({
    choices: [{ message: { content: '', reasoning_content: '想'.repeat(reasoningChars) } }],
    usage,
  })
}

async function bootWith(reply) {
  const home = makeHome('empty-answer')
  writeStore(home)
  const stub = stubFetch((url) => (String(url).includes('/chat/completions') ? reply : undefined))
  const { tools } = await boot({ home })
  return { home, stub, tools }
}

function numbers(note) {
  const match = String(note).match(/spent (?:about )?(\d+) of (\d+) completion tokens/)
  assert.ok(match, `note 里没有用量说明：${note}`)
  return { used: Number(match[1]), total: Number(match[2]) }
}

test('chat 路径：reasoning 数字不得大于 completion 总数，估算要写 about', async () => {
  const { home, stub, tools } = await bootWith(emptyReply({ completion: 40, reasoningChars: 200 }))
  try {
    const result = await tools.get('harness_call').execute({ task: '评审', tier: 'execution', skill: 'off' }, {})
    assert.equal(result.ok, true)
    const { used, total } = numbers(result.note)
    assert.equal(total, 40)
    assert.ok(used <= total, `reasoning ${used} 不得大于 completion ${total}（旧版会写 67 of 40）`)
    assert.match(result.note, /about \d+ of 40/, '没有精确数字时必须写 about（约）')
    assert.match(result.note, /maxTokens 600/, 'retry 建议应为 max(600, 2×40)=600')
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('网关给出 reasoning_tokens 时用精确值，不加 about', async () => {
  const { home, stub, tools } = await bootWith(emptyReply({ completion: 40, reasoningChars: 200, reasoningTokens: 30 }))
  try {
    const result = await tools.get('harness_call').execute({ task: '评审', tier: 'execution', skill: 'off' }, {})
    const { used, total } = numbers(result.note)
    assert.equal(used, 30)
    assert.equal(total, 40)
    assert.equal(/about/.test(result.note), false, '有精确值就不要写 about')
    assert.match(result.note, /maxTokens 600/)
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('harness_review 在同场景下给出同样的提示（之前完全没有）', async () => {
  const { home, stub, tools } = await bootWith(emptyReply({ completion: 40, reasoningChars: 200 }))
  try {
    const result = await tools.get('harness_review').execute({ task: '评审这个方案', draft: '草稿' }, {})
    assert.equal(result.ok, true)
    assert.match(String(result.note), /empty content/, `review 必须提示空正文：${result.note}`)
    const { used, total } = numbers(result.note)
    assert.equal(total, 40)
    assert.ok(used <= 40)
  } finally {
    stub.restore()
    removeHome(home)
  }
})

test('两条路径共用同一个 emptyAnswerNote（代码只有一处定义）', () => {
  const source = fs.readFileSync(path.join(REPO, 'index.js'), 'utf8')
  assert.equal((source.match(/function emptyAnswerNote\(/g) || []).length, 1)
  assert.ok((source.match(/emptyAnswerNote\(/g) || []).length >= 3, '定义 + 两条路径的调用')
  assert.equal(source.includes('spent ${answer.reasoningTokens'), false, '旧的矛盾拼接必须删掉')
})
