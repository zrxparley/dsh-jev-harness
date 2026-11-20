/**
 * JEV tiered LLM harness — Host plugin for DeepSeek Harness.
 *
 * Exposes four model-facing tools that call OpenAI-compatible gateways directly,
 * so no DSH provider configuration or Host route authorization is required:
 *
 *   harness_call      route a task to the decision or execution tier
 *   harness_classify  decide which tier a task belongs to
 *   harness_review    second-model quality gate
 *   harness_probe     connectivity / model discovery check
 *
 * Base URLs, model IDs and API keys are filled in the plugin's own settings page
 * (Plugins -> JEV Tiered Harness -> 配置). That page is a client half
 * (lib/client.js) talking to the bridge routes registered here:
 *   GET  /api/jev-harness/status   current values (keys reduced to set/unset)
 *   POST /api/jev-harness/save     persist baseUrl / apiKey / model per gateway
 *   POST /api/jev-harness/test     probe each gateway's GET /models
 * Values persist in <DSH_HOME>/jev-harness.json (mode 0600). Fallbacks:
 *   config: jevBaseUrl / kimiBaseUrl / dsfBaseUrl, jevApiKey / kimiApiKey / dsfApiKey
 *   env:    JEV_BASE_URL / KIMI_BASE_URL / DSF_BASE_URL, JEV_API_KEY / KIMI_API_KEY / DSF_API_KEY
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { SKILLS, SKILL_BY_ID, SKILLS_SNAPSHOT } from './skills.js'
import { TIER_CRITERIA, TIER_INSTRUCTIONS, SKILL_NONE_CRITERIA, SKILL_INSTRUCTIONS, DIFFICULTY_CRITERIA, DIFFICULTY_INSTRUCTIONS, CRITERIA_VERSION } from './criteria.js'

const PACKAGE_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version || 'unknown'
  } catch {
    return 'unknown'
  }
})()

export const name = 'jev-harness'
export const inject = ['tools']

/* ------------------------------------------------------------------ config */

function env(name) {
  try {
    const value = process.env?.[name]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : ''
  } catch {
    return ''
  }
}

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/* --------------------------------------------------------------- settings store */

/** The user-editable values, persisted outside the profile so the settings page can own them. */
const STORE_FIELDS = [
  'enabled',
  'skillsAuto',
  'jevBaseUrl', 'jevApiKey', 'jevModel',
  'kimiBaseUrl', 'kimiApiKey', 'kimiModel',
  'dsfBaseUrl', 'dsfApiKey', 'dsfModel',
  'routeMode',
  'decisionProvider', 'decisionModel',
  'executionProvider', 'executionModel',
  'followModel',
  'lowConfidenceThreshold',
  'judgeTimeoutMs',
  'timeoutMs',
  'timeoutProbe', 'timeoutExecution', 'timeoutDecision', 'timeoutReview',
  'historyAuto', 'historyTurns', 'historyMaxChars',
]

/** Booleans are stored as real JSON booleans, not strings. */
const STORE_BOOLEANS = new Set(['enabled', 'skillsAuto', 'followModel', 'historyAuto'])
// #4: numeric store fields must survive readStore (otherwise the threshold is dropped).
const STORE_NUMBERS = new Set(['lowConfidenceThreshold', 'judgeTimeoutMs', 'timeoutMs', 'timeoutProbe', 'timeoutExecution', 'timeoutDecision', 'timeoutReview', 'historyTurns', 'historyMaxChars'])

function truthy(value, fallback) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (['true', 'on', 'yes', '1'].includes(text)) return true
    if (['false', 'off', 'no', '0'].includes(text)) return false
  }
  return fallback
}

function storePath() {
  const home = String(process.env.DSH_HOME || '').trim() || path.join(os.homedir(), '.dsh')
  return path.join(home, 'jev-harness.json')
}

/** Read the saved settings; a missing or unreadable file simply means "nothing saved yet". */
function readStore() {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8')
    const parsed = JSON.parse(raw)
    const out = {}
    if (parsed && typeof parsed === 'object') {
      for (const key of STORE_FIELDS) {
        const value = parsed[key]
        if (STORE_BOOLEANS.has(key)) {
          if (typeof value === 'boolean') out[key] = value
          continue
        }
        if (STORE_NUMBERS.has(key)) {
          if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
          continue
        }
        if (typeof value === 'string' && value.trim() !== '') out[key] = value.trim()
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Merge changed fields into the saved settings and write them back with owner-only permissions. */
function writeStore(patch) {
  const next = { ...readStore() }
  for (const key of STORE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue
    if (STORE_BOOLEANS.has(key)) {
      const flag = truthy(patch[key], undefined)
      if (flag === undefined) continue
      next[key] = flag
      continue
    }
    if (STORE_NUMBERS.has(key)) {
      // #4: numeric fields (threshold) must persist as numbers, not stringified away.
      const v = Number(patch[key])
      if (Number.isFinite(v)) next[key] = v
      continue
    }
    const value = typeof patch[key] === 'string' ? patch[key].trim() : ''
    if (value === '') delete next[key]
    else next[key] = value
  }
  const target = storePath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  try { fs.chmodSync(target, 0o600) } catch { /* best effort on exotic filesystems */ }
  return next
}

/** First non-empty string wins: saved settings, then plugin config, then environment. */
function pick(...values) {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : ''
    if (text !== '') return text
  }
  return ''
}

function resolveConfig(config = {}, store = readStore()) {
  const c = config && typeof config === 'object' ? config : {}
  return {
    // Master switch: OFF means the harness steps aside entirely and the caller
    // must fall back to DSH's own model gateway.
    enabled: store.enabled !== undefined ? truthy(store.enabled, true) : truthy(c.enabled, true),
    jev: {
      base: pick(store.jevBaseUrl, c.jevBaseUrl, env('JEV_BASE_URL')),
      key: pick(store.jevApiKey, c.jevApiKey, env('JEV_API_KEY')),
      model: pick(store.jevModel, c.jevModel, env('JEV_MODEL'), 'jev-latest'),
    },
    kimi: {
      base: pick(store.kimiBaseUrl, c.kimiBaseUrl, env('KIMI_BASE_URL')),
      key: pick(store.kimiApiKey, c.kimiApiKey, env('KIMI_API_KEY')),
      model: pick(store.kimiModel, c.kimiModel, env('KIMI_MODEL'), 'kimi-k3.1-pro'),
    },
    dsf: {
      base: pick(store.dsfBaseUrl, c.dsfBaseUrl, env('DSF_BASE_URL')),
      key: pick(store.dsfApiKey, c.dsfApiKey, env('DSF_API_KEY')),
      model: pick(store.dsfModel, c.dsfModel, env('DSF_MODEL'), 'deepseek-v4.1-flash-1017'),
    },
    skills: {
      // Mount the best-fitting mattpocock/skills skill into each routed call.
      auto: store.skillsAuto !== undefined ? truthy(store.skillsAuto, true) : truthy(c.skillsAuto, true),
      repo: pick(c.skillsRepo, 'mattpocock/skills'),
      ref: pick(c.skillsRef, 'main'),
      maxChars: num(c.skillsMaxChars, 6000),
    },
    // Where the routed work actually runs.
    //   'dsh'    = through DSH's own model gateway (ctx.llm), so the plugin keeps
    //              no model credentials at all; only the JEV judge key is needed.
    //   'direct' = the plugin calls its own OpenAI-compatible gateways.
    routeMode: (() => {
      const mode = pick(store.routeMode, c.routeMode).toLowerCase()
      return mode === 'direct' || mode === 'dsh' ? mode : 'dsh'
    })(),
    // Which model does the strategy (decision) work and which one executes.
    // Empty means "let the plugin pick from whatever THIS DSH install really
    // has" — never a hard-coded provider, because another user's gateway is not
    // this user's gateway.
    decision: {
      provider: pick(store.decisionProvider, c.decisionProvider),
      model: pick(store.decisionModel, c.decisionModel),
    },
    execution: {
      provider: pick(store.executionProvider, c.executionProvider),
      model: pick(store.executionModel, c.executionModel),
    },
    // Mirror the routed decision into DSH's own model selector, so the composer
    // chip shows the model that is actually working instead of a stale one.
    followModel: store.followModel !== undefined ? truthy(store.followModel, true) : truthy(c.followModel, true),
    // #4: below this judge confidence, escalate the task to the decision tier
    // (Kimi) — better to pay for a correct answer than to save on a wrong one.
    // Panel-editable; takes effect on the next call via refresh().
    lowConfidenceThreshold: (() => {
      // NOTE: pick() only passes non-empty strings, so it would drop a numeric
      // threshold. Read the raw values and accept the first finite number.
      const raw = [store.lowConfidenceThreshold, c.lowConfidenceThreshold, env('JEV_LOW_CONFIDENCE')]
      for (const r of raw) {
        const v = Number(r)
        if (r !== undefined && r !== '' && Number.isFinite(v) && v >= 0 && v <= 1) return v
      }
      return 0.6
    })(),
    // #33: generation timeout is dynamic — read the saved store value first so a
    // /save takes effect on the next call's combineSignal (the tool-REGISTRATION
    // timeout is a separate snapshot; see the reload notice in /save).
    timeoutMs: num(store.timeoutMs !== undefined ? store.timeoutMs : c.timeoutMs, 120000),
    // #2: auto conversation history for the adapter. auto = cap to the last N
    // turns within a char budget; off = pass the raw options.messages through.
    // History is used only for inference — never written to disk or the ledger.
    history: {
      auto: store.historyAuto !== undefined ? truthy(store.historyAuto, true) : truthy(c.historyAuto, true),
      turns: num(store.historyTurns, 6),
      maxChars: num(store.historyMaxChars, 8000),
    },
    // #3: per-operation timeouts (probe short, execution mid, decision/review long).
    // Each is panel-overridable via the store; defaults are the safe values.
    timeouts: {
      probe: num(store.timeoutProbe, 10000),
      execution: num(store.timeoutExecution, 45000),
      decision: num(store.timeoutDecision, 120000),
      review: num(store.timeoutReview, 120000),
    },
    // #39：判定超时独立于生成超时，默认 800ms；超时就兜底，不再等。
    judgeTimeoutMs: (() => {
      const raw = [store.judgeTimeoutMs, c.judgeTimeoutMs, env('JEV_JUDGE_TIMEOUT')]
        .find(value => value !== undefined && value !== null && value !== '')
      const parsed = Number(raw)
      return Number.isFinite(parsed) && parsed >= 100 && parsed <= 60000 ? Math.round(parsed) : 800
    })(),
    temperature: Number.isFinite(Number(c.temperature)) ? Number(c.temperature) : 0.2,
  }
}

/* ------------------------------------------------------------- usage ledger */

/**
 * Traffic accounting. Every outbound gateway call lands here so the settings
 * panel can show what actually moved: per-hour buckets for the last 48 hours,
 * per-day totals for the last 30 days, plus the most recent calls verbatim.
 * The ledger is small (a few KB) and lives beside the settings file.
 */
const USAGE_VERSION = 1
const USAGE_HOURS = 48
const USAGE_DAYS = 30
const USAGE_RECENT = 40
const DECISIONS_MAX = 500  // global cap across all sessions (was a flat 12)
const DECISIONS_PER_SESSION = 50  // #41: keep at least the last 50 decisions per session

/**
 * Bridge token (#26 part 2).
 *
 * Per-process random secret. Every bridge route except the bootstrap route
 * requires `Authorization: Bearer <token>`. It is never put in a URL, never
 * written to disk and never echoed by /status.
 *
 * Honest limit: the bootstrap route is gated by the same Origin / Fetch-metadata
 * rules as before, and a local process can forge those headers and then ask for
 * the token too. So this token stops the *unauthenticated script* class, not a
 * determined local attacker; closing that needs a host-provided channel the page
 * can read and a process cannot (DSH exposes none today — __DSH_BOOT__ entries
 * carry only id/url/rev/inject/external/immediately).
 */
const BRIDGE_TOKEN = `${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`

function bearerToken(req) {
  const header = String(req.headers?.authorization || '')
  const match = header.match(/^Bearer\s+(\S+)$/i)
  return match ? match[1] : ''
}

function bridgeAuthorized(req) {
  const supplied = bearerToken(req)
  if (!supplied) return false
  const expected = Buffer.from(BRIDGE_TOKEN)
  const actual = Buffer.from(supplied)
  if (expected.length !== actual.length) return false
  try { return timingSafeEqual(expected, actual) } catch { return false }
}

/**
 * One definition of the bridge state shared by /status and /stats (#13/#15):
 * off → setup → degraded → ready.
 */
function computeBridgeState(live, lastCall) {
  if (!live || !live.enabled) return 'off'
  if (!live.kimi || !live.kimi.base || !live.dsf || !live.dsf.base) return 'setup'
  if (lastCall && lastCall.ok === false) return 'degraded'
  return 'ready'
}

function usagePath() {
  const home = String(process.env.DSH_HOME || '').trim() || path.join(os.homedir(), '.dsh')
  return path.join(home, 'jev-harness-usage.json')
}

const pad2 = (n) => String(n).padStart(2, '0')

/** 本地日键：与小时桶同一套本地时间，禁止 toISOString().slice(0,10)（#14）。 */
export function localDayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** 本地小时键。 */
export function localHourKey(date = new Date()) {
  return `${localDayKey(date)}T${pad2(date.getHours())}`
}

/** 按本地日历回退/前进若干天：用 setDate，跨 DST 不会差一小时。 */
export function addLocalDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function emptyBucket() {
  return {
    calls: 0, ok: 0, fail: 0,
    promptTokens: 0, completionTokens: 0,
    // ms 只累计「真正回答」的调用；probe 单独记，平均耗时默认不含探测（#14）。
    ms: 0, probeCalls: 0, probeMs: 0,
    answered: 0, unanswered: 0, notSent: 0,
  }
}

function emptyUsage() {
  return { version: USAGE_VERSION, hours: {}, days: {}, recent: [], decisions: [] }
}

/**
 * 账本损坏的警告：readUsage() 解析失败时把原文件改名隔离，并记下这条，
 * usageReport() 原样带给面板（新增字段，旧客户端忽略即可）。
 * 进程内粘性保留，避免「面板刷新一次提示就消失」。
 */
let usageWarning = null

/**
 * #7 启动自检：工具注册结果由本进程记录，slot 注册结果由客户端 apply() 上报。
 * 两者合并进 /status.selfCheck —— 面板白屏时用户看不到 console，只能看这里。
 */
const selfCheckState = {
  tools: null,
  slots: null,
  slotsReportedAt: '',
}

function reportToolsSelfCheck(tools) {
  try {
    selfCheckState.tools = tools
  } catch { /* 自检本身绝不影响加载 */ }
}

function reportSlotsSelfCheck(slots) {
  try {
    const failures = Array.isArray(slots && slots.failures) ? slots.failures.slice(0, 32) : []
    const registered = Array.isArray(slots && slots.registered) ? slots.registered.slice(0, 32) : []
    selfCheckState.slots = {
      ok: slots && slots.ok === true && failures.length === 0,
      total: Number.isFinite(Number(slots && slots.total)) ? Number(slots.total) : registered.length + failures.length,
      registered: registered.map(name => String(name).slice(0, 60)),
      failures: failures.map(entry => ({
        name: String((entry && entry.name) || 'unknown').slice(0, 60),
        error: String((entry && entry.error) || '').slice(0, 200),
      })),
    }
    selfCheckState.slotsReportedAt = new Date().toISOString()
  } catch { /* 同上 */ }
}

/** /status.selfCheck 的最终形状（约定：{ok, slots:{ok,failures[]}, tools:{ok,failures[]}}）。 */
function selfCheckPayload() {
  const tools = selfCheckState.tools || {
    ok: false, total: 0, registered: [], failures: [{ name: '(tools)', error: 'apply() has not registered tools yet' }],
  }
  const slots = selfCheckState.slots || { ok: null, reported: false, total: 0, registered: [], failures: [] }
  const slotsOk = slots.ok === null ? true : slots.ok
  return {
    ok: Boolean(tools.ok && slotsOk),
    tools,
    slots: { ...slots, reported: Boolean(selfCheckState.slots), at: selfCheckState.slotsReportedAt || null },
    checkedAt: new Date().toISOString(),
  }
}

function usageStat(file) {
  try {
    const stat = fs.statSync(file)
    return { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs }
  } catch {
    return null
  }
}

function sameStat(before, after) {
  if (before === null || after === null) return before === after
  return before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs
}

/** 把损坏的账本改名为 `<name>.corrupt-<ts>.json`，保留证据而不是覆盖掉。 */
function quarantineUsage(reason) {
  const target = usagePath()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = target.replace(/\.json$/i, `.corrupt-${stamp}.json`)
  let moved = null
  try {
    fs.renameSync(target, backup)
    moved = backup
  } catch { /* 隔离失败（只读盘 / 权限）也要留下警告，不能让统计装没事 */ }
  usageWarning = {
    code: 'usage-ledger-corrupt',
    reason: String(reason || 'unreadable'),
    file: target,
    backup: moved,
    at: new Date().toISOString(),
    message: moved
      ? '用量账本损坏，旧文件已隔离，统计从这一刻重新开始。'
      : '用量账本损坏，旧文件无法隔离（权限或只读盘），统计从这一刻重新开始。',
  }
  return moved
}

function readUsage() {
  const target = usagePath()
  let raw
  try {
    raw = fs.readFileSync(target, 'utf8')
  } catch (err) {
    // 文件不存在是正常状态；其它读错误不该把「读不到」伪装成「没有记录」，
    // 但也不隔离（文件可能是好的，只是此刻读不了）。
    if (err && err.code === 'ENOENT') return emptyUsage()
    usageWarning = {
      code: 'usage-ledger-unreadable',
      reason: String((err && err.code) || err),
      file: target,
      backup: null,
      at: new Date().toISOString(),
      message: '用量账本此刻读不出来，统计可能暂时为空。',
    }
    return emptyUsage()
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    quarantineUsage(err && err.message ? err.message : 'invalid JSON')
    return emptyUsage()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    quarantineUsage('not a ledger object')
    return emptyUsage()
  }
  // #41 migration: pre-partition records have no session. Backfill them as
  // 'legacy' on read so history is preserved and per-session views stay honest
  // (old rows are never misattributed to the current session).
  const backfill = (row) => (row && typeof row === 'object' && !row.session ? { ...row, session: 'legacy' } : row)
  return {
    version: USAGE_VERSION,
    hours: parsed.hours && typeof parsed.hours === 'object' ? parsed.hours : {},
    days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {},
    recent: Array.isArray(parsed.recent) ? parsed.recent.map(backfill) : [],
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions.map(backfill) : [],
  }
}

/** 账本有界：只留最近的桶与环形缓冲。 */
function trimUsage(usage) {
  const hourKeys = Object.keys(usage.hours).sort()
  while (hourKeys.length > USAGE_HOURS) delete usage.hours[hourKeys.shift()]
  const dayKeys = Object.keys(usage.days).sort()
  while (dayKeys.length > USAGE_DAYS) delete usage.days[dayKeys.shift()]
  usage.recent = usage.recent.slice(-USAGE_RECENT)
  // #41: keep the last DECISIONS_PER_SESSION decisions per session, then a global cap.
  if (Array.isArray(usage.decisions) && usage.decisions.length > DECISIONS_PER_SESSION) {
    const bySession = new Map()
    for (const d of usage.decisions) {
      const key = d.session || 'unknown'
      if (!bySession.has(key)) bySession.set(key, [])
      bySession.get(key).push(d)
    }
    const kept = []
    for (const list of bySession.values()) kept.push(...list.slice(-DECISIONS_PER_SESSION))
    kept.sort((a, b) => String(a.t).localeCompare(String(b.t)))
    usage.decisions = kept.slice(-DECISIONS_MAX)
  }
  return usage
}

/** 原子写：同目录 .tmp 写完后 rename 覆盖，进程崩溃不会留下半个账本。 */
function writeUsage(usage) {
  const target = usagePath()
  const tmp = `${target}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`
  try {
    trimUsage(usage)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(usage), { mode: 0o600 })
    fs.renameSync(tmp, target)
  } catch {
    try { fs.unlinkSync(tmp) } catch { /* tmp 不存在或删不掉都不影响调用 */ }
  }
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch { /* 环境不支持就退化成忙等一次 */ }
}

/**
 * 跨进程互斥：同目录 `.lock` 用 O_EXCL 创建。
 * 拿不到就短暂重试；锁文件超过 10s 视为崩溃遗留物直接清掉；
 * 超过 2s 仍未拿到则退化直写 —— 记账永远不许阻塞或打断一次调用。
 */
function withUsageLock(run) {
  const lockFile = `${usagePath()}.lock`
  const deadline = Date.now() + 2000
  let fd = null
  for (;;) {
    try {
      fd = fs.openSync(lockFile, 'wx', 0o600)
      break
    } catch (err) {
      if (!err || err.code !== 'EEXIST') return run()
      try {
        const stat = fs.statSync(lockFile)
        if (Date.now() - stat.mtimeMs > 10000) fs.unlinkSync(lockFile)
      } catch { /* 锁刚被释放 */ }
      if (Date.now() > deadline) return run()
      sleepSync(2)
    }
  }
  try {
    return run()
  } finally {
    try { fs.closeSync(fd) } catch { /* 已经关掉了 */ }
    try { fs.unlinkSync(lockFile) } catch { /* 已经删掉了 */ }
  }
}

/**
 * 读-改-写：在锁内重读 → 修改 → 写前再核对 inode / 大小 / mtime。
 * 文件在读写之间被换掉就丢掉这一轮重来，避免把别人的更新覆盖掉。
 */
function mutateUsage(mutate) {
  return withUsageLock(() => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = usageStat(usagePath())
      const usage = readUsage()
      mutate(usage)
      trimUsage(usage)
      const after = usageStat(usagePath())
      if (attempt === 2 || sameStat(before, after)) {
        writeUsage(usage)
        return true
      }
    }
    return false
  })
}

function bumpBucket(target, event) {
  if (!target) return
  const isProbe = event.tool === 'probe'
  target.calls = (target.calls || 0) + 1
  if (event.ok) target.ok = (target.ok || 0) + 1
  else target.fail = (target.fail || 0) + 1
  target.promptTokens = (target.promptTokens || 0) + (event.promptTokens || 0)
  target.completionTokens = (target.completionTokens || 0) + (event.completionTokens || 0)
  if (isProbe) {
    target.probeCalls = (target.probeCalls || 0) + 1
    target.probeMs = (target.probeMs || 0) + (event.ms || 0)
  } else {
    target.ms = (target.ms || 0) + (event.ms || 0)
  }
  if (event.sent === false) target.notSent = (target.notSent || 0) + 1
  else if (event.ok && event.answered === false) target.unanswered = (target.unanswered || 0) + 1
  else if (event.ok) target.answered = (target.answered || 0) + 1
}

/**
 * Record one routing decision: which tier the judge picked, why, and who actually
 * answered. This is the only place a user can find out "who did this work" —
 * the usage ledger alone only knows gateway counts.
 */
/**
 * #36：判定器返回的 probabilities 不能原样落库（可能很大，也不该无界头字段）。
 * 只保留最多 8 项、键名 ≤24 字符、值必须是有限数字；其它一律丢弃。
 * 它只是模型分数，不含 task 正文、不含任何密钥。
 */
function sanitizeProbabilities(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const entries = Array.isArray(raw) ? raw.map((value, index) => [String(index), value]) : Object.entries(raw)
  const kept = {}
  for (const [key, value] of entries.slice(0, 8)) {
    const n = Number(value)
    if (!Number.isFinite(n)) continue
    kept[String(key).slice(0, 24)] = n
  }
  return Object.keys(kept).length ? kept : undefined
}

function recordDecision(entry) {
  try {
    mutateUsage((usage) => {
      if (!Array.isArray(usage.decisions)) usage.decisions = []
      usage.decisions.push({
        t: new Date(entry.at || Date.now()).toISOString(),
        task: String(entry.task || '').slice(0, 120),
        // #41: every decision carries its session so the ledger can be read
        // per-session. 'unknown' = caller could not supply one (e.g. L1 tools);
        // 'legacy' = pre-partition records backfilled on read.
        session: String(entry.session || 'unknown'),
        tier: entry.tier || '',
        asked: entry.asked || 'auto',
        source: entry.source || 'explicit',
        choice: entry.choice || entry.tier || '',
        confidence: Number.isFinite(entry.confidence) ? Number(entry.confidence) : undefined,
        // #36: judge scores for the tier choice, bounded by sanitizeProbabilities.
        probabilities: sanitizeProbabilities(entry.probabilities),
        provider: entry.provider || '',
        model: entry.model || '',
        host: entry.host && entry.host.provider && entry.host.model
          ? { provider: String(entry.host.provider), model: String(entry.host.model) }
          : null,
        skill: entry.skill || 'none',  // #4: distinguish 'judged none' from 'not asked' — never an ambiguous empty string
        skill2: entry.skill2 || '',      // #11: second mounted skill id ('' if only one)
        skillBytes: Math.round(entry.skillBytes || 0),  // #11: total bytes of mounted skill bodies
        skill1Bytes: Math.round(entry.skill1Bytes || 0),  // #11 fix: bytes of the PRIMARY skill only
        skill2Bytes: Math.round(entry.skill2Bytes || 0),  // #11 fix: bytes of the SECOND skill only
        // #39: tier degradation and skill degradation are separate facts.
        skillSource: entry.skillSource || '',
        skillError: entry.skillError ? String(entry.skillError).slice(0, 160) : '',
        criteriaVersion: entry.criteriaVersion || CRITERIA_VERSION,
        difficulty: entry.difficulty || '',
        escalated: entry.escalated === true,  // #4: was this call upgraded to decision on low confidence?
        degraded: entry.degraded === true,    // #39/#3: judge-layer OR execution-layer degradation
        degradedFrom: entry.degradedFrom || '',  // #3: provider degraded away from (execution failover)
        cooldownSkip: entry.cooldownSkip || '',  // #3: provider skipped while cooling down

        ok: Boolean(entry.ok),
        ms: Math.round(entry.ms || 0),
        pt: entry.pt || 0,
        ct: entry.ct || 0,
        error: entry.error ? String(entry.error).slice(0, 160) : '',
      })

    })
  } catch { /* observability must never break a call */ }
}

/** Record one gateway call: hourly + daily buckets, plus the recent ring. */
function recordUsage(event) {
  try {
    const at = new Date(event.at || Date.now())
    const hourKey = localHourKey(at)
    const dayKey = localDayKey(at)
    mutateUsage((usage) => {
      if (!usage.hours[hourKey]) usage.hours[hourKey] = {}
      if (!usage.days[dayKey]) usage.days[dayKey] = {}
      if (!usage.hours[hourKey][event.gateway]) usage.hours[hourKey][event.gateway] = emptyBucket()
      if (!usage.days[dayKey][event.gateway]) usage.days[dayKey][event.gateway] = emptyBucket()
      bumpBucket(usage.hours[hourKey][event.gateway], event)
      bumpBucket(usage.days[dayKey][event.gateway], event)
      usage.recent.push({
        t: at.toISOString(),
        // #41: per-session read of the traffic ledger. 'unknown' when the caller
        // could not supply a session (e.g. L1 tools); 'legacy' on backfill.
        session: String(event.session || 'unknown'),
        g: event.gateway,
        m: event.model || '',
        tool: event.tool || '',
        ok: Boolean(event.ok),
        // 看板据此区分「未发出 / 失败 / 无回答 / 成功」（#14）。
        sent: event.sent !== false,
        answered: event.sent === false ? false : event.answered !== false,
        kind: event.kind || (event.sent === false ? 'not-sent' : event.ok ? (event.answered === false ? 'no-answer' : 'ok') : 'fail'),
        status: event.status || 0,
        ms: Math.round(event.ms || 0),
        pt: event.promptTokens || 0,
        ct: event.completionTokens || 0,
        // #4: judge auditability — which choice was made, with what confidence,
        // and from which source (jev | heuristic | fallback). Present on judge
        // records; undefined on plain model calls.
        choice: event.choice,
        confidence: Number.isFinite(event.confidence) ? Number(event.confidence) : undefined,
        source: event.source,
        // #3: execution-layer failover marker — the primary provider this call
        // was degraded away from ('' when it ran on the primary).
        degraded: event.degraded || '',
        error: event.error ? String(event.error).slice(0, 160) : '',
      })
    })
  } catch { /* accounting must never break a call */ }
}

/** Shape the ledger for the panel: N hourly buckets, totals, recent calls. */
/**
 * #41 judge-quality metrics for a set of decisions (+ the recent traffic rows).
 * All six indicators the issue asks for:
 *   judgedCount      — decisions that actually went through a judge (not explicit)
 *   heuristicShare   — fraction of judged decisions answered by the heuristic fallback
 *   lowConfidenceShare — fraction of judged decisions with confidence < 0.5
 *   tierDistribution — { decision, execution }
 *   avgJudgeMs       — mean latency of judge-type gateway calls (judge/classify/skill-pick)
 *   judgeToExecutionMsRatio — avgJudgeMs / avg execution (real model call) ms
 */
function judgeQuality(decisions, recent) {
  const judged = (decisions || []).filter(d => d && d.source && d.source !== 'explicit')
  const judgedCount = judged.length
  const heuristicCount = judged.filter(d => d.source === 'heuristic').length
  const lowConf = judged.filter(d => Number.isFinite(d.confidence) && d.confidence < 0.5).length
  const tierDistribution = { decision: 0, execution: 0 }
  for (const d of judged) {
    if (d.tier === 'decision') tierDistribution.decision += 1
    else if (d.tier === 'execution') tierDistribution.execution += 1
  }
  const judgeTools = new Set(['judge', 'classify', 'skill-pick'])
  const judgeMs = (recent || []).filter(r => r && judgeTools.has(r.tool) && Number.isFinite(r.ms)).map(r => r.ms)
  const execMs = (recent || []).filter(r => r && (r.tool === 'call' || r.tool === 'adapter') && Number.isFinite(r.ms)).map(r => r.ms)
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
  const avgJudgeMs = mean(judgeMs)
  const avgExecMs = mean(execMs)
  return {
    judgedCount,
    heuristicShare: judgedCount ? heuristicCount / judgedCount : 0,
    lowConfidenceShare: judgedCount ? lowConf / judgedCount : 0,
    tierDistribution,
    avgJudgeMs: Math.round(avgJudgeMs),
    avgExecutionMs: Math.round(avgExecMs),
    judgeToExecutionMsRatio: avgExecMs > 0 ? Number((avgJudgeMs / avgExecMs).toFixed(3)) : null,
  }
}

/**
 * #41 follow-up: every session id the ledger still holds, with row counts.
 *
 * Why this exists: the panel's session dropdown used to be derived from the
 * 40-row `recent` ring, so any session that had gone quiet silently vanished.
 * decisions + recent are the only rows that carry a session, so aggregate over
 * both. 口径必须说清（不假装完整）：decisions 有全局 500 条上限（trimUsage），
 * 极老的会话会被淘汰 —— 这里列的是「账本里仍保留的会话」，不是「开机以来所有会话」。
 */
function usageSessions(usage) {
  const byId = new Map()
  const bump = (id, field, at) => {
    const key = String(id || 'unknown')
    if (!byId.has(key)) byId.set(key, { id: key, decisions: 0, recent: 0, lastAt: '' })
    const row = byId.get(key)
    row[field] += 1
    if (at && String(at) > row.lastAt) row.lastAt = String(at)
  }
  for (const d of (usage && usage.decisions) || []) bump(d && d.session, 'decisions', d && d.t)
  for (const r of (usage && usage.recent) || []) bump(r && r.session, 'recent', r && r.t)
  return [...byId.values()]
    .map((row) => ({ ...row, total: row.decisions + row.recent }))
    .sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || '') || b.total - a.total)
}

function usageReport(hours = 24) {
  const usage = readUsage()
  const pad = pad2
  const dayGrain = hours > USAGE_HOURS
  const buckets = []
  const source = (key) => (dayGrain ? usage.days[key] : usage.hours[key]) || {}

  if (dayGrain) {
    // Hourly buckets are only retained for USAGE_HOURS, so a multi-day window
    // must be built from the daily rollups or the older days read as zero.
    const days = Math.max(1, Math.ceil(hours / 24))
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (let i = days - 1; i >= 0; i--) {
      // setDate 而不是 getTime()-86400000：DST 那天不会错位（#14）。
      const at = addLocalDays(today, -i)
      const key = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
      const row = { key, label: `${pad(at.getMonth() + 1)}/${pad(at.getDate())}`, day: `${pad(at.getMonth() + 1)}/${pad(at.getDate())}`, gateways: {} }
      const from = source(key)
      for (const gateway of ['jev', 'kimi', 'dsf']) {
        const bucket = from[gateway] || emptyBucket()
        row.gateways[gateway] = {
          calls: bucket.calls || 0,
          tokens: (bucket.promptTokens || 0) + (bucket.completionTokens || 0),
          fail: bucket.fail || 0,
        }
      }
      buckets.push(row)
    }
  } else {
    const now = new Date()
    now.setMinutes(0, 0, 0)
    for (let i = hours - 1; i >= 0; i--) {
      const at = new Date(now.getTime() - i * 3600000)
      const key = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}`
      const row = { key, label: `${pad(at.getHours())}:00`, day: `${pad(at.getMonth() + 1)}/${pad(at.getDate())}`, gateways: {} }
      const from = source(key)
      for (const gateway of ['jev', 'kimi', 'dsf']) {
        const bucket = from[gateway] || emptyBucket()
        row.gateways[gateway] = {
          calls: bucket.calls || 0,
          tokens: (bucket.promptTokens || 0) + (bucket.completionTokens || 0),
          fail: bucket.fail || 0,
        }
      }
      buckets.push(row)
    }
  }

  const totals = {}
  let worst = 0
  for (const gateway of ['jev', 'kimi', 'dsf']) {
    const total = emptyBucket()
    for (const bucket of buckets) {
      const entry = bucket.gateways[gateway]
      const raw = source(bucket.key)[gateway] || emptyBucket()
      total.calls += entry.calls
      total.fail += entry.fail
      total.promptTokens += raw.promptTokens || 0
      total.completionTokens += raw.completionTokens || 0
      total.ms += raw.ms || 0
      total.probeCalls += raw.probeCalls || 0
      total.probeMs += raw.probeMs || 0
      total.answered += raw.answered || 0
      total.unanswered += raw.unanswered || 0
      total.notSent += raw.notSent || 0
    }
    total.ok = total.calls - total.fail
    totals[gateway] = {
      calls: total.calls,
      ok: total.ok,
      fail: total.fail,
      promptTokens: total.promptTokens,
      completionTokens: total.completionTokens,
      tokens: total.promptTokens + total.completionTokens,
      answered: total.answered,
      unanswered: total.unanswered,
      notSent: total.notSent,
      probeCalls: total.probeCalls,
      // 平均耗时排除探测：分母是「真正回答过的调用」，分子不含 probe 的 ms。
      avgMs: (() => {
        // 分母排除探测与未发出的调用：它们没有回答耗时，混进来会稀释均值（#14）。
        const answeredCalls = total.calls - total.probeCalls - total.notSent
        return answeredCalls > 0 ? Math.round(total.ms / answeredCalls) : 0
      })(),
    }
    worst = Math.max(worst, total.calls)
  }

  const today = usage.days[localDayKey(new Date())] || {}
  const todayTotals = {}
  for (const gateway of ['jev', 'kimi', 'dsf']) {
    const bucket = today[gateway] || emptyBucket()
    todayTotals[gateway] = {
      calls: bucket.calls || 0,
      fail: bucket.fail || 0,
      tokens: (bucket.promptTokens || 0) + (bucket.completionTokens || 0),
      answered: bucket.answered || 0,
      unanswered: bucket.unanswered || 0,
      notSent: bucket.notSent || 0,
    }
  }
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    windowHours: hours,
    grain: dayGrain ? 'day' : 'hour',
    peak: worst,
    file: usagePath(),
    // 账本损坏 / 读不出来时的可见信号；正常为 null，旧客户端忽略即可。
    warning: usageWarning,
    buckets,
    totals,
    today: todayTotals,
    recent: usage.recent.slice(-20).reverse(),
  }
}

/* ----------------------------------------------------------------- routing */

/**
 * Returned by every routing tool while the master switch is OFF. The wording is
 * addressed to the calling agent: it must not retry the harness, it must use
 * DSH's own configured model gateway instead.
 */
// #20: bridge 403 的面向用户文案。抽成常量避免 9 处重复，并留稳定 code 便于将来翻译。
const LOCAL_ONLY = { ok: false, error: '仅限本机请求', code: 'local-only' }

const DISABLED_NOTE = 'JEV 分级调度已关闭：本插件不接管路由，任务改用 DSH 自身配置的模型网关完成。需要恢复时在 JEV 设置面板打开总开关。'

const DECISION_WORDS = [
  '决策', '判断', '拍板', '权衡', '取舍', '该不该', '要不要', '是否', '评估', '方案',
  '架构', '风险', '优先级', '评审', '判断对错', '决策质量', '选择哪个', '定夺',
  'decide', 'judge', 'evaluate', 'tradeoff', 'should we', 'choose', 'architecture',
  'risk', 'review', 'verdict', 'which one', 'prioritize', 'assess',
]
const EXECUTION_WORDS = [
  '实现', '写代码', '执行', '转换', '格式化', '提取', '生成', '翻译', '批量', '运行',
  '整理', '列出', '查找', '统计', '改写', '润色', '总结', '复述', '计算', '迁移',
  'implement', 'execute', 'format', 'convert', 'extract', 'translate', 'summarize',
  'batch', 'list', 'count', 'refactor', 'generate', 'rewrite', 'compute',
]

/** Deterministic fallback classifier; fail-safe leans to the quality tier. */
function heuristicTier(task) {
  const text = String(task || '').toLowerCase()
  let d = 0
  let e = 0
  for (const w of DECISION_WORDS) if (text.includes(w.toLowerCase())) d += 1
  for (const w of EXECUTION_WORDS) if (text.includes(w.toLowerCase())) e += 1
  if (d === 0 && e === 0) return { tier: 'decision', reason: 'no strong signal; defaulted to quality tier' }
  if (d > e) return { tier: 'decision', reason: `decision cues ${d} > execution cues ${e}` }
  if (e > d) return { tier: 'execution', reason: `execution cues ${e} > decision cues ${d}` }
  return { tier: 'decision', reason: 'tie; defaulted to quality tier' }
}

/* ------------------------------------------------------ jev/auto adapter */

/**
 * Provider adapter that exposes ONE model, `jev/auto` (#37).
 *
 * Flow: DSH hands us messages → ask JEV for the tier → delegate to a REAL
 * provider/model from a whitelist → pass the upstream stream through untouched.
 *
 * Hard rules baked in here:
 * - never route `jev` to `jev` (recursion guard);
 * - JEV failure/timeout/off → fall back to a real default model, never break
 *   the conversation (#39);
 * - same session+turn reuses the first judgement (tool round trips);
 * - every decision goes to the decision ledger with the real provider/model.
 *
 * All side effects are injected so the whole adapter is testable offline.
 */
/**
 * #2: bound the conversation history handed to the routed model. Keeps the
 * LAST `turns` user/assistant exchanges and at most `maxChars` characters of
 * text, so a long session never dumps its whole history (and its cost) into
 * every call. Any system messages are preserved. Returns a NEW array — the
 * input is never mutated, and nothing here is written to disk or the ledger.
 */
export function capHistory(messages, turns = 6, maxChars = 8000) {
  const list = Array.isArray(messages) ? messages : []
  const system = list.filter(m => m && m.role === 'system')
  const rest = list.filter(m => m && m.role !== 'system')
  // one "turn" = a user message plus whatever follows it up to the next user.
  const userIdx = []
  for (let i = 0; i < rest.length; i++) if (rest[i] && rest[i].role === 'user') userIdx.push(i)
  const startIdx = userIdx.length > turns ? userIdx[userIdx.length - turns - 1] + 1 : 0
  let kept = rest.slice(startIdx)
  // enforce the char budget from the newest end backwards.
  const textOf = (m) => typeof m.content === 'string' ? m.content
    : Array.isArray(m.content) ? m.content.filter(p => p && p.type === 'text').map(p => p.text || '').join('\n') : ''
  let total = kept.reduce((sum, m) => sum + textOf(m).length, 0)
  while (total > maxChars && kept.length > 1) {
    total -= textOf(kept[0]).length
    kept = kept.slice(1)
  }
  // final hard trim on the oldest remaining message if a single one is over budget.
  if (total > maxChars && kept.length === 1) {
    const only = kept[0]
    const text = textOf(only).slice(0, maxChars)
    kept = [{ ...only, content: text }]
  }
  return [...system, ...kept]
}

export function createJevAdapter(deps) {
  const {
    llm, decide, resolveBinding, fallbackBinding,
    recordUsage, recordDecision, maxChars = 160,
  } = deps
  const readConfig = deps.getConfig || (() => deps.cfg)
  const cache = new Map()
  const CACHE_TTL = 10 * 60 * 1000
  const CACHE_MAX = 64

  /** 本轮的判定对象 = 最后一条 user 消息（不是会话第一条）。 */
  function lastUserText(messages) {
    const list = Array.isArray(messages) ? messages : []
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const message = list[i]
      if (!message || message.role !== 'user') continue
      if (typeof message.content === 'string') return message.content
      if (Array.isArray(message.content)) {
        return message.content.filter(part => part && part.type === 'text').map(part => part.text || '').join('\n')
      }
    }
    return ''
  }

  /**
   * 缓存粒度是「本轮」，不是整段会话：key 用最后一条 user 的序号+文本。
   * 工具往返只是追加 assistant/tool 消息，最后一条 user 不变 → 复用；
   * 用户发来新请求 → 序号变化 → 必须重新判定（Verifier 抓的跨轮命中）。
   */
  function cacheKey(options, task) {
    const session = String((options && options.sessionId) || 'no-session')
    const messages = Array.isArray(options && options.messages) ? options.messages : []
    let lastUserIndex = -1
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i] && messages[i].role === 'user') { lastUserIndex = i; break }
    }
    return `${session}::${lastUserIndex}::${task.slice(0, maxChars)}`
  }

  async function choose(options) {
    const cfg = readConfig()
    const task = lastUserText(options && options.messages)
    const key = cacheKey(options, task)
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_TTL) return { ...hit.value, cached: true }

    let tier = 'execution'
    let source = 'jev'
    let confidence
    let reason = ''
    let degraded = false
    let judgeError = ''
    if (!cfg.enabled) {
      source = 'off'
      reason = 'switch is OFF'
    } else {
      const judged = await decide(task)
      confidence = judged.confidence
      reason = judged.reason || ''
      if (judged.source === 'jev') {
        tier = judged.tier
        source = 'jev'
      } else if (!cfg.jev || !cfg.jev.base) {
        // 没有配置判定器：本地启发式仍然给出一个 tier，但要如实标注。
        tier = judged.tier
        source = 'heuristic'
      } else {
        // 判定器挂了：不猜 tier，直接走默认模型，并如实标记降级（#39）。
        source = 'fallback'
        degraded = true
        judgeError = judged.error || reason || '判定失败'
      }
    }

    let binding = null
    if (source === 'jev' || source === 'heuristic') {
      binding = await resolveBinding(tier === 'decision' ? 'kimi' : 'dsf', { exclude: ['jev'] })
      if (!binding || !binding.provider || !binding.model || binding.provider === 'jev') {
        // 白名单里没有可用的真实模型 → 宁可走默认模型，也不许 jev→jev。
        binding = await fallbackBinding()
        source = 'fallback'
        reason = reason || 'no real provider available'
      }
    } else {
      binding = await fallbackBinding()
    }

    const value = { tier, source, confidence, reason, binding, degraded, error: judgeError }
    cache.set(key, { at: Date.now(), value })
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
    return { ...value, cached: false }
  }

  async function* streamRouted(options) {
    const startedAt = Date.now()
    const decided = await choose(options)
    const binding = decided.binding
    if (!binding || !binding.provider || !binding.model) {
      throw new Error('jev/auto: 没有可委派的真实模型（也没有默认模型）')
    }
    const target = await llm.prepareCall({ provider: binding.provider, model: binding.model }, options && options.signal)
    const delegated = {
      ...options,
      ...(target.config || {}),
      provider: binding.provider,
      model: binding.model,
    }
    // #2: cap the conversation history to the last N turns within a char budget
    // (auto). Off keeps the raw options.messages. This bounds cost and never
    // writes history to disk or the ledger.
    const historyCfg = (readConfig() && readConfig().history) || { auto: true, turns: 6, maxChars: 8000 }
    if (historyCfg.auto && Array.isArray(options && options.messages)) {
      delegated.messages = capHistory(options.messages, historyCfg.turns, historyCfg.maxChars)
    }
    let firstChunk = true
    let promptTokens = 0
    let completionTokens = 0
    try {
      for await (const chunk of target.stream(delegated)) {
        firstChunk = false
        if (chunk && chunk.type === 'usage' && chunk.usage) {
          const usage = chunk.usage
          promptTokens = Number(usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens) || promptTokens
          completionTokens = Number(usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens) || completionTokens
        }
        yield chunk
      }
    } catch (err) {
      recordUsage({
        gateway: binding.key || binding.provider, model: binding.model, tool: 'adapter',
        ok: false, status: 0, ms: Date.now() - startedAt, error: String((err && err.message) || err).slice(0, 160),
        session: String((options && options.sessionId) || 'unknown'),
      })
      throw err
    }
    recordUsage({
      gateway: binding.key || binding.provider, model: binding.model, tool: 'adapter',
      ok: true, status: 200, ms: Date.now() - startedAt,
      promptTokens, completionTokens,
      session: String((options && options.sessionId) || 'unknown'),
    })
    recordDecision({
      session: String((options && options.sessionId) || 'unknown'),
      task: lastUserText(options && options.messages), tier: decided.tier, asked: 'auto',
      source: decided.source, choice: decided.tier, confidence: decided.confidence,
      probabilities: decided.probabilities,
      provider: binding.key || binding.provider, model: binding.model,
      host: { provider: binding.provider, model: binding.model }, skill: 'none',
      ok: true, ms: Date.now() - startedAt, pt: promptTokens, ct: completionTokens,
      escalated: false, degraded: decided.degraded === true, error: decided.error || '',
    })
    void firstChunk
  }

  const adapter = {
    providerInfo(provider) { return { id: provider, name: 'JEV 自动分流' } },
    providerRetryPolicy() { return undefined },
    imageRequestPricing() { return undefined },
    imageRequestTarget(_provider, _model, image) { return { width: image.width, height: image.height, maxBytes: image.bytes } },
    async listModels(provider) {
      return provider === 'jev' ? [{ id: 'auto', name: 'JEV 自动分流 · auto' }] : []
    },
    async resolveModel(provider, model) {
      return { provider, id: model, name: model === 'auto' ? 'JEV 自动分流 · auto' : model }
    },
    async prepareCall(provider, model) {
      return { model: await adapter.resolveModel(provider, model), stream: (options) => streamRouted(options) }
    },
    stream(options) { return streamRouted(options) },
    // 测试缝：清缓存 / 读缓存大小
    __test: { cacheSize: () => cache.size, clear: () => cache.clear() },
  }
  return adapter
}

/* ----------------------------------------------------------------- http */

function chatUrl(base) {
  let b = String(base || '').trim().replace(/\/+$/, '')
  if (!b) return ''
  if (/\/chat\/completions$/i.test(b)) return b
  if (/\/v\d+$/i.test(b)) return `${b}/chat/completions`
  return `${b}/v1/chat/completions`
}

function modelsUrl(base) {
  const u = chatUrl(base)
  return u ? u.replace(/\/chat\/completions$/i, '/models') : ''
}

/* ------------------------------------------------- circuit breaker (#3) */

/**
 * Execution-layer circuit breaker, per gateway provider. Process-level state:
 * 3 consecutive failures on a provider opens a 10-minute cooldown during which
 * that provider is skipped WITHOUT spending a timeout. After the cooldown a
 * single trial is allowed (half-open); success closes the breaker again.
 *
 * This is for EXECUTION gateways (kimi/dsf), separate from the judge-layer
 * degradation in #39 (which is about the JEV judge itself being unreachable).
 */
const BREAKER_THRESHOLD = 3
const BREAKER_COOLDOWN_MS = num(env('JEV_BREAKER_COOLDOWN_MS'), 10 * 60 * 1000)
const gatewayBreakers = new Map()

function breakerOf(provider) {
  if (!gatewayBreakers.has(provider)) gatewayBreakers.set(provider, { fails: 0, cooldownUntil: 0 })
  return gatewayBreakers.get(provider)
}

/** Remaining cooldown ms for a provider (0 if it is available for a call). */
function breakerCooldownMs(provider) {
  const b = breakerOf(provider)
  return Math.max(0, b.cooldownUntil - Date.now())
}

function breakerRecordSuccess(provider) {
  const b = breakerOf(provider)
  b.fails = 0
  b.cooldownUntil = 0
}

/** Record a failure; returns true if this failure opened the cooldown. */
function breakerRecordFailure(provider) {
  const b = breakerOf(provider)
  b.fails += 1
  if (b.fails >= BREAKER_THRESHOLD) {
    b.cooldownUntil = Date.now() + BREAKER_COOLDOWN_MS
    return true
  }
  return false
}

/** Test seam: reset all breakers between cases. */
function __resetBreakers() { gatewayBreakers.clear() }

/**
 * #3 execution-layer failover: try the primary provider, on failure degrade to
 * the backup, honouring the circuit breaker. `makeCall(provider)` performs one
 * attempt and returns whatever the caller needs (answer/binding/model).
 *
 * Returns:
 *   { outcome, degradedFrom, cooldownSkip, cooldownMs, error }
 *   - outcome: the makeCall result (primary or backup), or null if both failed
 *   - degradedFrom: the provider that failed and was degraded away from ('' if none)
 *   - cooldownSkip: provider skipped because it was cooling down ('' if none)
 *   - error: set only when BOTH providers failed (caller surfaces call failed)
 */
async function executeWithFailover({ primary, backup, makeCall, onCooldown }) {
  const cooldownMs = breakerCooldownMs(primary)
  if (cooldownMs > 0) {
    // Primary is cooling down: skip it WITHOUT spending a timeout (#3).
    if (onCooldown) onCooldown(primary, cooldownMs)
    try {
      const outcome = await makeCall(backup)
      breakerRecordSuccess(backup)
      return { outcome, degradedFrom: '', cooldownSkip: primary, cooldownMs, error: null }
    } catch (err) {
      breakerRecordFailure(backup)
      return { outcome: null, degradedFrom: '', cooldownSkip: primary, cooldownMs, error: err }
    }
  }
  try {
    const outcome = await makeCall(primary)
    breakerRecordSuccess(primary)
    return { outcome, degradedFrom: '', cooldownSkip: '', cooldownMs: 0, error: null }
  } catch (err) {
    // #3: an unconfigured gateway is a CONFIG problem, not a gateway failure.
    // Degrading would just hit another unconfigured gateway and double the
    // not-sent records, so surface it directly without failing over.
    if (err && err.code === 'JEV_NOT_CONFIGURED') {
      return { outcome: null, degradedFrom: '', cooldownSkip: '', cooldownMs: 0, error: err }
    }
    // #3: 4xx (unknown model id, unauthorized, bad params) is a CONFIG error, not a
    // gateway outage — the backup would reject it too. Only degrade on real faults
    // (network error, timeout, 5xx).
    if (err && Number.isFinite(err.httpStatus) && err.httpStatus >= 400 && err.httpStatus < 500) {
      return { outcome: null, degradedFrom: '', cooldownSkip: '', cooldownMs: 0, error: err }
    }
    breakerRecordFailure(primary)
    // degrade to the backup and mark it (#3).
    try {
      const outcome = await makeCall(backup)
      breakerRecordSuccess(backup)
      return { outcome, degradedFrom: primary, cooldownSkip: '', cooldownMs: 0, error: null }
    } catch (err2) {
      breakerRecordFailure(backup)
      return { outcome: null, degradedFrom: primary, cooldownSkip: '', cooldownMs: 0, error: err2 }
    }
  }
}

/* ------------------------------------------------- tiered timeouts (#3) */

/**
 * Per-operation timeouts, each overridable from the panel (store) with a sane
 * default. probe is short (a dead gateway must not block 120s), execution is
 * mid, decision/review are long (reasoning models).
 */
function timeoutFor(kind, cfg) {
  const store = cfg && cfg.timeouts ? cfg.timeouts : {}
  switch (kind) {
    case 'probe': return num(store.probe, 10000)
    case 'execution': return num(store.execution, 45000)
    case 'review': return num(store.review, 120000)
    case 'decision':
    default: return num(store.decision, 120000)
  }
}

function combineSignal(cfgTimeout, execSignal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfgTimeout)
  const onAbort = () => controller.abort()
  if (execSignal) {
    if (execSignal.aborted) controller.abort()
    else execSignal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer)
      if (execSignal) execSignal.removeEventListener('abort', onAbort)
    },
  }
}

/** 模型 id 报错时回捞网关真实可用的 id（#29）；失败就当没有，不影响主错误。 */
async function listGatewayModels(route, cfg2) {
  const url = modelsUrl(route.base)
  if (!url) return []
  const link = combineSignal(timeoutFor('probe', cfg2), undefined)
  try {
    const res = await fetch(url, {
      headers: route.key ? { authorization: `Bearer ${route.key}` } : {},
      signal: link.signal,
    })
    if (!res.ok) return []
    const body = JSON.parse(await res.text())
    return (Array.isArray(body?.data) ? body.data : []).map(model => model?.id).filter(Boolean)
  } catch {
    return []
  } finally {
    link.dispose()
  }
}

async function chat(route, messages, opts, cfg, exec) {
  const url = chatUrl(route.base)
  if (!url) {
    // 请求根本没发出去，也要留下一条可见记录（#14：状态「未发出」）。
    recordUsage({
      gateway: opts.provider,
      model: route.model,
      tool: opts.tool || 'call', degraded: opts.degraded || '',
      ok: false,
      sent: false,
      status: 0,
      ms: 0,
      error: '未发出：没有配置网关地址',
    })
    const notConfigured = new Error(`no base URL configured for ${opts.provider}; set it in plugin settings or ${opts.provider.toUpperCase()}_BASE_URL`)
    notConfigured.code = 'JEV_NOT_CONFIGURED'
    throw notConfigured
  }
  const temperature = Number.isFinite(opts.temperature) ? opts.temperature : cfg.temperature

  let startedAt = 0
  const send = async (keepTemperature) => {
    startedAt = Date.now()
    const link = combineSignal(timeoutFor(opts.provider === 'kimi' ? 'decision' : 'execution', cfg), exec?.signal)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(route.key ? { authorization: `Bearer ${route.key}` } : {}),
        },
        body: JSON.stringify({
          model: route.model,
          messages,
          ...(keepTemperature ? { temperature } : {}),
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
          stream: false,
        }),
        signal: link.signal,
      })
      const raw = await res.text()
      return { res, raw, startedAt }
    } finally {
      link.dispose()
    }
  }

  let res, raw
  try {
    ;({ res, raw } = await send(true))
    // Some reasoning models (kimi-k3 family) reject sampling parameters outright
    // with "Parameter 'temperature'=0.2 is not supported". Retry once without it
    // rather than surfacing a hard failure for a purely cosmetic parameter.
    if (!res.ok && res.status === 400 && /temperature/i.test(raw)) {
      ;({ res, raw } = await send(false))
    }
  } catch (err) {
    // #34/#14: fetch reject 或超时（abort）也要落一条失败记录 —— 否则看板上
    // 「失败凭空消失」。与 5xx 分支同一口径：每个真正发过的请求记一条。
    recordUsage({
      gateway: opts.provider,
      model: route.model,
      tool: opts.tool || 'call', degraded: opts.degraded || '',
      ok: false,
      status: 0,
      ms: startedAt ? Date.now() - startedAt : 0,
      error: shortError(err),
    })
    throw err
  }
  if (!res.ok) {
    recordUsage({
      gateway: opts.provider,
      model: route.model,
      tool: opts.tool || 'call', degraded: opts.degraded || '',
      ok: false,
      status: res.status,
      ms: Date.now() - startedAt,
      error: raw.slice(0, 160),
    })
    let detail = `HTTP ${res.status} from ${opts.provider}: ${raw.slice(0, 300)}`
    const looksLikeModelId = res.status === 404 || /model[^"]{0,48}(not found|does not exist|unknown|invalid)/i.test(raw)
    if (looksLikeModelId) {
      const available = await listGatewayModels(route, cfg)
      detail += available.length
        ? `\n${opts.provider} 不认识模型 id「${route.model}」，可用模型 id 示例：${available.slice(0, 8).join(', ')}${available.length > 8 ? ` …（共 ${available.length} 个）` : ''}`
        : `\n${opts.provider} 不认识模型 id「${route.model}」；该网关没返回模型列表，去设置页点「测试连通」看真实 id。`
    }
    const httpErr = new Error(detail)
    httpErr.httpStatus = res.status
    throw httpErr
  }
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    // 200 但正文不是 JSON（例如代理回了 <html>502</html>）：这不是成功，落失败记录。
    recordUsage({
      gateway: opts.provider,
      model: route.model,
      tool: opts.tool || 'call', degraded: opts.degraded || '',
      ok: false,
      status: res.status,
      ms: startedAt ? Date.now() - startedAt : 0,
      error: shortError(new Error(`non-JSON response from ${opts.provider}: ${raw.slice(0, 160)}`)),
    })
    throw new Error(`non-JSON response from ${opts.provider}: ${raw.slice(0, 300)}`)
  }
  const usageTotals = body?.usage || {}
  const message = body?.choices?.[0]?.message || {}
  const text = message.content
  // HTTP 200 不等于答出内容：空正文记 ok+answered:false，看板显示「无回答」（#14）。
  recordUsage({
    gateway: opts.provider,
    model: route.model,
    tool: opts.tool || 'call', degraded: opts.degraded || '',
    ok: true,
    answered: typeof text === 'string' && text.trim() !== '',
    status: res.status,
    ms: Date.now() - startedAt,
    promptTokens: Number(usageTotals.prompt_tokens) || 0,
    completionTokens: Number(usageTotals.completion_tokens) || 0,
  })
  const reasoning = message.reasoning_content || message.reasoning
  const usage = body?.usage || {}
  const details = usage.completion_tokens_details || {}
  const finalText = typeof text === 'string' ? text : (text == null ? '' : JSON.stringify(text))
  const emptyNote = emptyAnswerNote({
    text: finalText,
    completionTokens: Number(usage.completion_tokens) || 0,
    reasoningTokens: Number(details.reasoning_tokens) || undefined,
    reasoningChars: typeof reasoning === 'string' ? reasoning.length : 0,
  })
  return {
    text: finalText,
    emptyNote,
    promptTokens: Number(usage.prompt_tokens) || 0,
    completionTokens: Number(usage.completion_tokens) || 0,
    totalTokens: Number(usage.total_tokens) || 0,
    // Reasoning models bill their thinking here; an empty `text` next to a
    // non-zero `reasoningTokens` means the budget ran out mid-thought.
    reasoningTokens: Number(details.reasoning_tokens) || (typeof reasoning === 'string' ? Math.ceil(reasoning.length / 3) : 0),
  }
}

/**
 * Route one call through DSH's own model gateway (`ctx.llm`). The plugin then
 * keeps no kimi/dsf credentials at all — the Host already holds the provider
 * key — and whatever the user configured in DSH Models is what actually runs.
 */
/**
 * 空正文提示（#31）：两条路径（chat / dshChat）共用一份，数字口径也共用。
 * - reasoning 数绝不大于 completion 总数；
 * - 拿不到网关的 reasoning_tokens 时用字数估算，并明确写「about」；
 * - retry 建议 max(600, 2×观测值)，给出具体数字。
 */
function emptyAnswerNote(answer) {
  const text = String((answer && answer.text) || '').trim()
  if (text) return ''
  const completion = Math.max(0, Number(answer && answer.completionTokens) || 0)
  if (completion <= 0) return ''
  const reported = Number(answer && answer.reasoningTokens)
  const estimated = Math.max(0, Math.ceil((Number(answer && answer.reasoningChars) || 0) / 3))
  const exact = Number.isFinite(reported) && reported > 0
  const used = Math.min(completion, exact ? reported : estimated)
  const retry = Math.max(600, used * 2)
  return ` — empty content: the model spent ${exact ? '' : 'about '}${used} of ${completion} completion tokens on reasoning and never reached an answer; retry with maxTokens ${retry}`
}

async function dshChat(llm, binding, opts, cfg, exec) {
  if (!llm || typeof llm.prepareCall !== 'function') {
    recordUsage({
      gateway: binding.key, model: binding.model, tool: opts.tool || 'call', degraded: opts.degraded || '',
      ok: false, sent: false, status: 0, ms: 0, error: '未发出：该宿主没有 llm 服务',
    })
    throw new Error('DSH model service (llm) is unavailable — switch the route to 直连 or configure a gateway')
  }
  const startedAt = Date.now()
  const link = combineSignal(timeoutFor(binding.key === 'kimi' ? 'decision' : 'execution', cfg), exec && exec.signal)
  try {
    const maxTokens = opts.maxTokens || 1200
    const controls = { maxTokens }
    if (Number.isFinite(opts.temperature)) controls.temperature = opts.temperature
    let call
    try {
      call = await llm.prepareCall({ provider: binding.provider, model: binding.model, ...controls }, link.signal)
    } catch (err) {
      // Some models (kimi-k3 family) reject sampling controls outright.
      if (!/temperature/i.test(String((err && err.message) || ''))) throw err
      call = await llm.prepareCall({ provider: binding.provider, model: binding.model, maxTokens }, link.signal)
    }
    const message = {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: opts.user }],
      source: { kind: 'jev-harness' },
    }
    const options = {
      ...call.config,
      messages: [message],
      system: opts.system || '',
      purpose: 'jev-harness',
      signal: link.signal,
    }
    let text = ''
    let reasoningChars = 0
    let inputTokens = 0
    let outputTokens = 0
    for await (const chunk of call.stream(options)) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta') text += String(chunk.text || '')
      else if (chunk.type === 'reasoning-delta') reasoningChars += String(chunk.text || '').length
      else if (chunk.type === 'usage' && chunk.usage && typeof chunk.usage === 'object') {
        const u = chunk.usage
        inputTokens = Number(u.inputTokens ?? u.input_tokens ?? u.promptTokens ?? u.prompt_tokens) || inputTokens
        outputTokens = Number(u.outputTokens ?? u.output_tokens ?? u.completionTokens ?? u.completion_tokens) || outputTokens
      }
    }
    const trimmed = text.trim()
    const reasoningTokens = reasoningChars > 0 ? Math.ceil(reasoningChars / 3) : 0
    recordUsage({
      gateway: binding.key, model: binding.model, tool: opts.tool || 'call', degraded: opts.degraded || '', ok: true,
      answered: trimmed !== '', status: 200,
      ms: Date.now() - startedAt, promptTokens: inputTokens, completionTokens: outputTokens,
    })
    return {
      text: trimmed,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
      reasoningTokens: trimmed ? reasoningTokens : (outputTokens || reasoningTokens),
      reasoningChars,
      emptyNote: emptyAnswerNote({ text: trimmed, completionTokens: outputTokens, reasoningChars }),
    }
  } catch (err) {
    recordUsage({
      gateway: binding.key, model: binding.model, tool: opts.tool || 'call', degraded: opts.degraded || '', ok: false, status: 0,
      ms: Date.now() - startedAt, error: shortError(err),
    })
    throw err
  } finally {
    link.dispose()
  }
}

function result(overrides = {}) {
  return {
    ok: false,
    tier: '',
    provider: '',
    model: '',
    text: '',
    note: '',
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    ...overrides,
  }
}

function shortError(err) {
  if (err?.name === 'AbortError') return 'cancelled or timed out'
  return String(err?.message || err).slice(0, 600)
}

/* ------------------------------------------------------------ tool schemas */

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'tier', 'provider', 'model', 'text', 'note', 'promptTokens', 'completionTokens', 'totalTokens'],
  properties: {
    ok: { type: 'boolean' },
    tier: { type: 'string' },
    provider: { type: 'string' },
    model: { type: 'string' },
    text: { type: 'string' },
    note: { type: 'string' },
    promptTokens: { type: 'integer' },
    completionTokens: { type: 'integer' },
    totalTokens: { type: 'integer' },
    reasoningTokens: { type: 'integer' },
  },
}

function render(title) {
  return (_args, value) => [{
    type: 'text',
    text: `${title}\n${JSON.stringify(value, null, 2)}`,
  }]
}

/* ------------------------------------------------------------------- apply */

export function apply(ctx, config = {}) {
  let cfg = resolveConfig(config)

  /** Re-read the saved settings so a change made in the settings page applies to the next call. */
  function refresh() {
    cfg = resolveConfig(config)
    return cfg
  }

  /** Pick the concrete route for a tier. JEV is only used for auto-classification. */
  function routeFor(tier) {
    return tier === 'decision' ? { key: 'kimi', route: cfg.kimi } : { key: 'dsf', route: cfg.dsf }
  }

  async function decideTier(task, context) {
    if (cfg.jev.base) {
      const startedAt = Date.now()
      try {
        // The JEV gateway is not an OpenAI chat endpoint: it exposes a single
        // POST /v1/systemone that answers typed questions (noul / choice /
        // score / box) about a `state` payload. A `choice` question is exactly
        // a router, and confidence/probabilities come back with it.
        const base = String(cfg.jev.base).replace(/\/+$/, '')
        const url = /\/v1$/.test(base) ? `${base}/systemone` : `${base}/v1/systemone`
        // 判定用独立超时（默认 800ms），慢判定不许拖死整轮（#39）。
        const link = combineSignal(cfg.judgeTimeoutMs, undefined)
        let raw, res
        try {
          res = await fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(cfg.jev.key ? { authorization: `Bearer ${cfg.jev.key}` } : {}),
            },
            body: JSON.stringify({
              model: cfg.jev.model || 'jev-latest',
              state: context ? { task, context } : { task },
              questions: {
                tier: {
                  type: 'choice',
                  instructions: TIER_INSTRUCTIONS,
                  criteria: { ...TIER_CRITERIA },
                },
              },
            }),
            signal: link.signal,
          })
          raw = await res.text()
        } finally {
          link.dispose()
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`)
        const body = JSON.parse(raw)
        const answer = body && body.answers && body.answers.tier
        recordUsage({
          gateway: 'jev', model: cfg.jev.model, tool: 'classify', ok: true, status: res.status,
          ms: Date.now() - startedAt,
          promptTokens: Number(body?.usage?.input_tokens) || 0,
          completionTokens: Number(body?.usage?.output_tokens) || 0,
        })
        const choice = answer && (answer.choice || answer.noul)
        const tier = choice === 'decision' || choice === 'execution' ? choice : undefined
        if (tier) {
          const confidence = Number(answer.confidence)
          return {
            tier,
            source: 'jev',
            choice: tier,
            confidence: Number.isFinite(confidence) ? confidence : undefined,
            probabilities: sanitizeProbabilities(answer.probabilities),
            model: body.model || cfg.jev.model,
            reason: `jev ${body.model || cfg.jev.model} choice=${tier}` +
              (Number.isFinite(confidence) ? ` (confidence ${confidence.toFixed(2)})` : ''),
          }
        }
        return {
          ...heuristicTier(task), source: 'heuristic', degraded: true,
          error: 'JEV 返回了不可用的 choice',
          reason: 'jev returned no usable choice; used heuristic',
        }
      } catch (err) {
        recordUsage({
          gateway: 'jev', model: cfg.jev.model, tool: 'classify', ok: false, status: 0,
          ms: Date.now() - startedAt, error: shortError(err),
        })
        return {
          ...heuristicTier(task), source: 'heuristic', degraded: true,
          error: shortError(err),
          reason: `jev router failed (${shortError(err)}); used heuristic`,
        }
      }
    }
    return { ...heuristicTier(task), source: 'heuristic' }
  }

  /* ------------------------------------------------------- skills routing */

  /**
   * Catalog of mattpocock/skills. The snapshot is bundled in skills.js so routing
   * costs zero network calls; `harness_skill action=refresh` rebuilds a local
   * catalog.json from the live repo and that file wins when present.
   */
  const SKILLS_URL_REPO = 'mattpocock/skills'

  function dshHome() {
    return String(process.env.DSH_HOME || '').trim() || path.join(os.homedir(), '.dsh')
  }

  function skillsDir() {
    const dir = path.join(dshHome(), 'jev-harness-skills')
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }) } catch { /* best effort */ }
    return dir
  }

  function skillsCatalogFile() {
    return path.join(skillsDir(), 'catalog.json')
  }

  /** Bundled snapshot, overridden by a refreshed catalog.json when it parses. */
  function skillCatalog() {
    try {
      const raw = fs.readFileSync(skillsCatalogFile(), 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed?.skills) && parsed.skills.length > 0) {
        return { snapshot: parsed.snapshot || parsed, skills: parsed.skills, source: 'refreshed' }
      }
    } catch { /* fall back to the bundled snapshot */ }
    return { snapshot: SKILLS_SNAPSHOT, skills: SKILLS, source: 'bundled' }
  }

  function skillById(id) {
    const found = skillCatalog().skills.find(s => s.id === id)
    return found || SKILL_BY_ID.get(id) || null
  }

  /** 缓存失效键：`repo@ref` 的短哈希，换仓库/换分支后旧缓存自然不命中（#32）。 */
  function skillCacheTag(cfg2) {
    const repo = String((cfg2 && cfg2.skills && cfg2.skills.repo) || SKILLS_URL_REPO)
    const ref = String((cfg2 && cfg2.skills && cfg2.skills.ref) || 'main')
    return createHash('sha256').update(`${repo}@${ref}`).digest('hex').slice(0, 8)
  }

  function skillCacheBase(skill) {
    return String(skill.id).replace(/[^a-zA-Z0-9._-]+/g, '__')
  }

  /** `<id>.<repo@ref 前 8 位>.md` —— 文件名本身就是失效键，不用读内容判断版本。 */
  function skillCacheFile(skill, cfg2) {
    return path.join(skillsDir(), `${skillCacheBase(skill)}.${skillCacheTag(cfg2)}.md`)
  }

  const SKILL_CACHE_MIN_BYTES = 16

  /**
   * 最低完整性检查（#32）：非空、≥16 字节、含 YAML frontmatter 或 `#` 标题。
   * 半写文件（进程被杀、磁盘满）过不了这几条，按「未命中」重取，
   * 绝不把截断正文静默注入给模型。
   */
  function skillBodyLooksComplete(text) {
    if (typeof text !== 'string') return false
    const trimmed = text.trim()
    if (Buffer.byteLength(trimmed, 'utf8') < SKILL_CACHE_MIN_BYTES) return false
    if (/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/.test(trimmed)) return true
    return /^#{1,6}\s+\S/m.test(trimmed)
  }

  /** 临时文件 + rename：写一半不会留下一个「看起来有效」的缓存（#32）。 */
  function writeSkillCacheAtomic(file, text) {
    const temp = `${file}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`
    try {
      fs.writeFileSync(temp, text, { mode: 0o600 })
      fs.renameSync(temp, file)
    } catch (err) {
      try { fs.unlinkSync(temp) } catch { /* 已 rename 或本来就没写成 */ }
      throw err
    }
  }

  function skillRawUrl(skill, cfg2) {
    const repo = cfg2.skills.repo || SKILLS_URL_REPO
    const ref = cfg2.skills.ref || 'main'
    return `https://raw.githubusercontent.com/${repo}/${ref}/${skill.path}`
  }

  /** #11: a sibling document lives next to the skill's SKILL.md (e.g. mocking.md). */
  function siblingRawUrl(skill, sibling, cfg2) {
    const repo = cfg2.skills.repo || SKILLS_URL_REPO
    const ref = cfg2.skills.ref || 'main'
    const dir = String(skill.path).replace(/[^/]+$/, '')
    const name = String(sibling || '').replace(/^\/+/, '')
    return `https://raw.githubusercontent.com/${repo}/${ref}/${dir}${name}`
  }

  /** Read a skill body from the local cache, fetching once and persisting it. */
  async function skillBody(skill, cfg2, exec) {
    const cached = skillCacheFile(skill, cfg2)
    try {
      const text = fs.readFileSync(cached, 'utf8')
      if (skillBodyLooksComplete(text)) return { text, cached: true, complete: true }
      // 完整性不通过 = 未命中：坏文件删掉再重取（#32）。
      try { fs.unlinkSync(cached) } catch { /* 删不掉也照样重取并覆盖 */ }
    } catch { /* miss */ }
    const link = combineSignal(cfg2.timeoutMs, exec && exec.signal)
    let raw, res
    try {
      res = await fetch(skillRawUrl(skill, cfg2), { signal: link.signal })
      raw = await res.text()
    } finally {
      link.dispose()
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${skill.path}`)
    // 拉回来的正文同样过一遍完整性检查：不合格就不落盘，免得下次又读到残文。
    const complete = skillBodyLooksComplete(raw)
    if (complete) {
      try { writeSkillCacheAtomic(cached, raw) } catch { /* cache is optional */ }
    }
    return { text: raw, cached: false, complete }
  }

  const SKILL_NONE = 'none'

  /**
   * Score every catalog skill against the task by token overlap, best-first:
   * [{ skill, score }]. Shared by the heuristic fallback and by #38 candidate
   * slimming (top-N before asking JEV).
   */
  function scoreSkills(task) {
    const words = new Set(String(task).toLowerCase().split(/[^a-z0-9一-鿿]+/).filter(w => w.length > 2))
    const scored = []
    for (const skill of skillCatalog().skills) {
      const hay = `${skill.id} ${skill.name} ${skill.description}`.toLowerCase()
      let score = 0
      for (const w of words) if (hay.includes(w)) score += w.length
      scored.push({ skill, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored
  }

  /** Token-overlap fallback used when the JEV judge is unreachable. */
  function heuristicSkill(task) {
    const best = scoreSkills(task)[0]
    if (!best || best.score < 6) return { id: SKILL_NONE, confidence: 0, source: 'heuristic', reason: 'no skill matched the wording' }
    return { id: best.skill.id, confidence: 0, reason: `local keyword match on ${best.skill.id}` }
  }

  /**
   * Slim the catalog to the top-N candidates by local keyword score (#38). Pads
   * with the highest-score entries so N candidates go to JEV regardless of
   * catalog size — decouples the request body from catalog growth (39 -> 200).
   */
  /**
   * #11 top-2: pick the SECOND skill to mount alongside the primary choice.
   * Preference order:
   *   1. the judge's own probabilities — the highest-probability candidate that is
   *      NOT the primary choice and whose probability >= 0.4 (the lower bar);
   *   2. otherwise, the next-best local keyword score (>= 6, same bar as
   *      heuristicSkill) that is also not the primary choice;
   *   3. null when nothing clears the bar (so we never mount a weak second).
   * Candidates always come from the slimmed top-8 set, never the whole catalog.
   */
  function selectSecondSkill(primaryId, skillAns, task) {
    // #11 fix (Verifier): the second skill must come from THIS ROUND's slimmed
    // candidate set (slimSkills top-8), not merely exist in the catalog. A judge
    // that returns an id outside the slim set must NOT be mounted, or #38's
    // slimming would be bypassed.
    const candidates = new Set(slimSkills(task, 8).map(s => s.id))
    const probs = skillAns && skillAns.probabilities
    if (probs && typeof probs === 'object') {
      let best = null
      let bestP = 0
      for (const [id, p] of Object.entries(probs)) {
        const prob = Number(p)
        if (!Number.isFinite(prob) || id === primaryId || id === SKILL_NONE) continue
        if (!candidates.has(id)) continue  // outside this round's slim set -> never mount
        if (prob >= 0.4 && prob > bestP && skillById(id)) { best = id; bestP = prob }
      }
      if (best) return best
    }
    // Fallback: next-best local keyword score, excluding the primary, and also
    // restricted to this round's slim set.
    const scored = scoreSkills(task)
    for (const entry of scored) {
      if (entry.skill.id === primaryId || !candidates.has(entry.skill.id)) continue
      if (entry.score >= 6) return entry.skill.id
      break
    }
    return null
  }

  function slimSkills(task, n = 8) {
    const scored = scoreSkills(task)
    const top = scored.slice(0, n).filter(e => e.score > 0)
    const chosen = top.length > 0 ? top : scored.slice(0, n)
    return chosen.map(e => e.skill)
  }

  /**
   * Ask the JEV gateway which skill fits, as one `choice` question over the
   * catalog (plus `none`). Falls back to the keyword matcher.
   */
  async function pickSkill(task, context, cfg2, exec) {
    if (!cfg2.jev.base) return heuristicSkill(task)
    // #38: slim to top-8 candidates by local keyword score before asking JEV,
    // so the request body does not grow with the catalog (39 -> 200 same size).
    const criteria = { [SKILL_NONE]: SKILL_NONE_CRITERIA }
    for (const skill of slimSkills(task, 8)) {
      criteria[skill.id] = `${skill.description.slice(0, 240)}`
    }
    const startedAt = Date.now()
    try {
      const base = String(cfg2.jev.base).replace(/\/+$/, '')
      const url = /\/v1$/.test(base) ? `${base}/systemone` : `${base}/v1/systemone`
      // 技能判定同样是判定请求：用 judgeTimeoutMs，别用生成超时（#39）。
      const link = combineSignal(cfg2.judgeTimeoutMs, exec && exec.signal)
      let raw, res
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(cfg2.jev.key ? { authorization: `Bearer ${cfg2.jev.key}` } : {}),
          },
          body: JSON.stringify({
            model: cfg2.jev.model || 'jev-latest',
            state: context ? { task, context } : { task },
            questions: {
              skill: {
                type: 'choice',
                instructions: SKILL_INSTRUCTIONS,
                criteria,
              },
            },
          }),
          signal: link.signal,
        })
        raw = await res.text()
      } finally {
        link.dispose()
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 160)}`)
      const body = JSON.parse(raw)
      recordUsage({
        gateway: 'jev', model: cfg2.jev.model, tool: 'skill-pick', ok: true, status: res.status,
        ms: Date.now() - startedAt,
        promptTokens: Number(body?.usage?.input_tokens) || 0,
        completionTokens: Number(body?.usage?.output_tokens) || 0,
      })
      const answer = body?.answers?.skill
      const choice = answer && (answer.choice || answer.noul)
      if (choice && (choice === SKILL_NONE || skillById(choice))) {
        const confidence = Number(answer.confidence)
        return {
          id: choice,
          // #11: second skill for top-2 mounting.
          second: selectSecondSkill(choice, answer, task),
          confidence: Number.isFinite(confidence) ? confidence : 0,
          source: 'jev',
          reason: `jev ${body.model || cfg2.jev.model} choice=${choice}` +
            (Number.isFinite(confidence) ? ` (confidence ${confidence.toFixed(2)})` : ''),
        }
      }
      return { ...heuristicSkill(task), source: 'heuristic', error: 'JEV 返回了不可用的 skill' }
    } catch (err) {
      recordUsage({
        gateway: 'jev', model: cfg2.jev.model, tool: 'skill-pick', ok: false, status: 0,
        ms: Date.now() - startedAt, error: shortError(err),
      })
      const fallback = heuristicSkill(task)
      return {
        ...fallback, source: 'heuristic', error: shortError(err),
        reason: `jev skill judge failed (${shortError(err)}); ${fallback.reason}`,
      }
    }
  }

  /**
   * #38 merged judge: ONE HTTP request answers tier + skill + difficulty.
   *
   * skill candidates are slimmed locally to top-8 (slimSkills) so the request
   * body stays <12KB and does not grow with the catalog. Produces a single
   * `jev` usage record (tool 'judge'), and returns all three dimensions plus
   * confidence so the ledger writes ONE decision row.
   *
   * Falls back to heuristics for all three dimensions when JEV is unreachable
   * or returns unusable answers, marked source:'heuristic'.
   */
  async function judgeOnce(task, context, exec) {
    const heuristic = () => ({
      ...heuristicTier(task),
      skill: heuristicSkill(task).id,
      difficulty: 'normal',
      source: 'heuristic',
    })
    if (!cfg.jev.base) return { ...heuristic(), reason: 'jev not configured; used heuristic' }
    const startedAt = Date.now()
    try {
      const base = String(cfg.jev.base).replace(/\/+$/, '')
      const url = /\/v1$/.test(base) ? `${base}/systemone` : `${base}/v1/systemone`
      const skillCriteria = { [SKILL_NONE]: SKILL_NONE_CRITERIA }
      for (const skill of slimSkills(task, 8)) {
        skillCriteria[skill.id] = `${skill.description.slice(0, 240)}`
      }
      // merged 主路径同样是判定：用 judgeTimeoutMs（#39）。
      const link = combineSignal(cfg.judgeTimeoutMs, exec && exec.signal)
      let raw, res
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(cfg.jev.key ? { authorization: `Bearer ${cfg.jev.key}` } : {}),
          },
          body: JSON.stringify({
            model: cfg.jev.model || 'jev-latest',
            state: context ? { task, context } : { task },
            questions: {
              tier: { type: 'choice', instructions: TIER_INSTRUCTIONS, criteria: { ...TIER_CRITERIA } },
              skill: { type: 'choice', instructions: SKILL_INSTRUCTIONS, criteria: skillCriteria },
              difficulty: { type: 'choice', instructions: DIFFICULTY_INSTRUCTIONS, criteria: { ...DIFFICULTY_CRITERIA } },
            },
          }),
          signal: link.signal,
        })
        raw = await res.text()
      } finally {
        link.dispose()
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 200)}`)
      const body = JSON.parse(raw)
      const answers = body?.answers || {}
      const tierAns = answers.tier
      const skillAns = answers.skill
      const diffAns = answers.difficulty
      const tierChoice = tierAns && (tierAns.choice || tierAns.noul)
      const tier = tierChoice === 'decision' || tierChoice === 'execution' ? tierChoice : undefined
      const skillChoice = skillAns && (skillAns.choice || skillAns.noul)
      const skill = skillChoice && (skillChoice === SKILL_NONE || skillById(skillChoice)) ? skillChoice : SKILL_NONE
      const diffChoice = diffAns && (diffAns.choice || diffAns.noul)
      const difficulty = ['trivial', 'normal', 'hard'].includes(diffChoice) ? diffChoice : 'normal'
      const tierConf = Number(tierAns?.confidence)
      // ONE usage record for the whole merged judgement, WITH #4 audit fields
      // (choice / confidence / source) now that the answers are parsed.
      recordUsage({
        gateway: 'jev', model: cfg.jev.model, tool: 'judge', ok: true, status: res.status,
        ms: Date.now() - startedAt,
        promptTokens: Number(body?.usage?.input_tokens) || 0,
        completionTokens: Number(body?.usage?.output_tokens) || 0,
        choice: tier,
        confidence: Number.isFinite(tierConf) ? tierConf : undefined,
        source: tier ? 'jev' : 'heuristic',
      })
      if (!tier) {
        return {
          ...heuristic(), source: 'heuristic', degraded: true,
          error: 'JEV 返回了不可用的 tier',
          reason: 'jev returned no usable tier; used heuristic',
        }
      }
      return {
        tier,
        source: 'jev',
        choice: tier,
        skill,
        // #11: the second skill to mount alongside the primary (top-2).
        skill2: selectSecondSkill(skill, skillAns, task),
        difficulty,
        confidence: Number.isFinite(tierConf) ? tierConf : undefined,
        // #36: the merged judge path carries the same tier probabilities as
        // decideTier(); without this the default path would record none.
        probabilities: sanitizeProbabilities(tierAns && tierAns.probabilities),
        model: body.model || cfg.jev.model,
        reason: `jev ${body.model || cfg.jev.model} tier=${tier} skill=${skill} difficulty=${difficulty}` +
          (Number.isFinite(tierConf) ? ` (confidence ${tierConf.toFixed(2)})` : ''),
      }
    } catch (err) {
      recordUsage({
        gateway: 'jev', model: cfg.jev.model, tool: 'judge', ok: false, status: 0,
        ms: Date.now() - startedAt, error: shortError(err), source: 'heuristic',
      })
      return {
        ...heuristic(), source: 'heuristic', degraded: true,
        error: shortError(err),
        reason: `jev merged judge failed (${shortError(err)}); used heuristic`,
      }
    }
  }


  /** The block prepended to a routed call so the model actually follows the skill. */
  function skillBlock(skill, body, maxChars) {
    const text = String(body || '').trim()
    const clipped = text.length > maxChars ? text.slice(0, maxChars) + '\n\n[skill body truncated]' : text
    return `## Skill: ${skill.name} (${skill.id})\nSource: ${skillRawUrl(skill, cfg)}` +
      (skill.siblings?.length ? `\nBundled references: ${skill.siblings.join(', ')}` : '') +
      `\n\n${clipped}`
  }

  /** The DSH model service (in-process gateway), when this Host provides one. */
  function dshLlm() {
    try { return ctx.get('llm') || null } catch { return null }
  }

  /** Provider routes this Host actually has registered (no hard-coded ids). */
  function dshProviders() {
    const llm = dshLlm()
    if (!llm || typeof llm.listProviders !== 'function') return []
    let list = []
    try { list = llm.listProviders() } catch { return [] }
    return (Array.isArray(list) ? list : []).map((p) => {
      const id = String((p && (p.id || p.provider)) || p || '')
      const name = String((p && (p.name || p.label || p.title)) || id)
      return { id, name }
    }).filter((p) => p.id !== '')
  }

  /** Models the Host's own gateway serves for one provider. */
  async function dshModels(provider) {
    const llm = dshLlm()
    if (!llm || typeof llm.listModels !== 'function') return []
    let list = []
    try { list = await llm.listModels(provider) } catch { return [] }
    return (Array.isArray(list) ? list : []).map((m) => ({
      id: String((m && (m.id || m.model)) || m || ''),
      name: String((m && (m.name || m.displayName)) || (m && m.id) || m || ''),
    })).filter((m) => m.id !== '')
  }

  /**
   * Everything this DSH install can route to: providers, each with its model ids.
   * This is the source of truth for the panel's pickers — the plugin never
   * assumes a provider name, because another user's gateway is not this one's.
   */
  async function dshCatalog() {
    const providers = []
    for (const provider of dshProviders()) {
      const models = await dshModels(provider.id)
      providers.push({ ...provider, models })
    }
    return { ok: providers.length > 0, providers }
  }

  /**
   * The provider/model the user picked in DSH's own model selector. The plugin
   * follows that provider when it has to pick a tier model itself, so "auto"
   * always stays inside what this user actually configured.
   */
  function dshDefaultSelection() {
    try {
      const svc = ctx.get('agentDefaultModel')
      if (svc && typeof svc.currentSelection === 'function') {
        const sel = svc.currentSelection()
        if (sel && sel.provider && sel.model) {
          return { provider: String(sel.provider), model: String(sel.model) }
        }
      }
    } catch { /* no default-model service on this Host */ }
    return null
  }

  const DECISION_HINT = /(kimi|k3|opus|claude|gpt[-_ ]?5|o3|pro(?!mpt)|max|reason|think|sonnet|qwen[-_ ]?max)/i
  const EXECUTION_HINT = /(flash|mini|lite|fast|small|turbo|haiku|air|spark|instant|cheap)/i

  /**
   * Decide which real (provider, model) pair handles a tier.
   *
   * An explicit choice from the panel always wins. When the panel is left on
   * "auto", the pair is picked from the Host's own catalog: the first model id
   * that looks like a strong judge for the decision tier, or like a fast worker
   * for the execution tier, with a stable fallback to the first pair available.
   */
  async function dshResolve(selected, options = {}) {
    const exclude = new Set(Array.isArray(options.exclude) ? options.exclude : [])
    const tierCfg = selected === 'kimi' ? cfg.decision : cfg.execution
    const chosen = { key: selected, provider: tierCfg.provider, model: tierCfg.model, auto: false }
    if (chosen.provider && chosen.model && !exclude.has(chosen.provider)) return chosen

    const catalog = await dshCatalog()
    const pairs = []
    for (const provider of catalog.providers) {
      if (exclude.has(provider.id)) continue
      for (const model of provider.models) pairs.push({ provider: provider.id, model: model.id })
    }
    if (pairs.length === 0) return chosen

    // Stay inside the provider the user already chose in DSH when we can.
    const hostDefault = dshDefaultSelection()

    // Honour a half-filled panel: a provider without a model still narrows the pool.
    const pool = chosen.provider ? pairs.filter((p) => p.provider === chosen.provider) : pairs
    const usable = pool.length > 0 ? pool : pairs

    const hint = selected === 'kimi' ? DECISION_HINT : EXECUTION_HINT
    const opposite = selected === 'kimi' ? EXECUTION_HINT : DECISION_HINT
    const ranked = usable
      .map((pair) => {
        let score = 0
        if (hint.test(pair.model)) score += 10
        if (opposite.test(pair.model)) score -= 6
        if (chosen.model && pair.model === chosen.model) score += 20
        if (hostDefault && pair.provider === hostDefault.provider) score += 8
        return { ...pair, score }
      })
      .sort((a, b) => b.score - a.score)

    const best = ranked[0]
    return { key: selected, provider: best.provider, model: best.model, auto: true, pool: usable.length }
  }

  /**
   * Mirror "who is actually working" into DSH's own model selector.
   *
   * DSH keeps the visible selection in the agentDefaultModel service; writing it
   * makes the composer chip show the model that just ran, instead of whatever
   * was selected before. Failures are swallowed: the selector is cosmetic, the
   * routed call already succeeded.
   */
  async function dshFollowModel(binding) {
    if (!cfg.followModel || !binding || !binding.provider || !binding.model) return false
    try {
      const svc = ctx.get('agentDefaultModel')
      if (!svc || typeof svc.saveSelection !== 'function') return false
      const current = typeof svc.currentSelection === 'function' ? svc.currentSelection() : null
      if (current && current.provider === binding.provider && current.model === binding.model) return true
      await svc.saveSelection({ provider: binding.provider, model: binding.model })
      return true
    } catch {
      return false
    }
  }

  const dshReady = () => cfg.routeMode === 'dsh' && dshLlm() !== null

  const tools = [
    {
      name: 'harness_call',
      description: 'Route work through the JEV tiered harness. While the harness switch is ON this is the ONLY way to produce an answer in the session: always call it with tier=auto — the JEV judge reads the task and picks the tier, then the work runs on Kimi (decision: judgment, evaluation, architecture, risk, quality) or DeepSeek Flash (execution: implementation, transformation, formatting, extraction, generation). Never ask the user to choose a tier. tier=decision / tier=execution exist for diagnostics and internal checks; provider forces a specific model. Returns the model answer plus token usage, and reasoningTokens when the model is a reasoning model. #2: the host gives this tool NO conversation messages, so for a follow-up (继续 / 改一下) pass the recent turns explicitly in `context`; otherwise the call is stateless by design.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task'],
        properties: {
          task: { type: 'string', description: 'The full task or question to send to the selected model.' },
          tier: { type: 'string', enum: ['auto', 'decision', 'execution'], description: 'Defaults to auto — JEV decides the tier and the user never picks one. Only override for diagnostics.' },
          context: { type: 'string', description: 'Optional supporting context, constraints, or background.' },
          maxTokens: { type: 'integer', description: 'Optional max completion tokens.' },
          temperature: { type: 'number', description: 'Optional sampling temperature; defaults to 0.2.' },
          provider: { type: 'string', enum: ['auto', 'kimi', 'dsf'], description: 'Force a specific model regardless of tier. Defaults to auto.' },
          skill: { type: 'string', description: 'Skill to mount into the call. Default auto = the JEV judge picks the best-fitting skill from mattpocock/skills and its instructions are prepended. Use "off" to skip, or an explicit id such as "engineering/tdd".' },
        },
      },
      output: { schema: RESULT_SCHEMA, render: render('Harness call') },
      isConcurrencySafe: true,
      timeoutMs: cfg.timeoutMs + 5000,
      async execute(args, exec) {
        refresh()
        if (!cfg.enabled) return result({ note: DISABLED_NOTE })
        const task = String(args.task || '').trim()
        if (!task) return result({ note: 'task must be a non-empty string' })
        const askedTier = args.tier === 'decision' || args.tier === 'execution' ? args.tier : 'auto'
        let tier = askedTier
        let note = ''
        let judged = null
        // Mount the best-fitting skill into the call so the routed model follows it.
        let mounted = ''
        let skillNote = ''
        let skillId = ''
        let skillBytes = 0  // #11: total bytes of mounted skill bodies
        let skill1Bytes = 0  // #11 fix: bytes of the PRIMARY skill only
        let skill2Bytes = 0  // #11 fix: bytes of the SECOND skill only
        let skillSource = 'off'
        let skillError = ''
        const asked = typeof args.skill === 'string' ? args.skill.trim() : ''
        const wantSkill = asked === '' || asked === 'auto' ? (cfg.skills.auto ? 'auto' : 'off') : asked
        // #38: when BOTH tier and skill are auto, do a single merged judge request
        // (tier + skill + difficulty) instead of two separate JEV round-trips.
        const merged = tier === 'auto' && wantSkill === 'auto'
        if (merged) {
          judged = await judgeOnce(task, args.context, exec)
          tier = judged.tier
          note = `auto-classified as ${tier}: ${judged.reason}`
        } else if (tier === 'auto') {
          judged = await decideTier(task, args.context)
          tier = judged.tier
          note = `auto-classified as ${tier}: ${judged.reason}`
        }
        if (merged) {
          // skill already decided by the merged judge; mount it without a 2nd request.
          skillSource = judged.source === 'jev' ? 'jev' : 'heuristic'
          // #11: mount top-1 AND top-2 (second at a lower confidence bar).
          const mountOne = async (id) => {
            const sk = skillById(id)
            if (!sk) return { block: '', bytes: 0, cached: false }
            const loaded = await skillBody(sk, cfg, exec)
            return { block: skillBlock(sk, loaded.text, cfg.skills.maxChars), bytes: String(loaded.text || '').length, cached: loaded.cached }
          }
          const blocks = []
          try {
            if (judged.skill && judged.skill !== SKILL_NONE) {
              const first = await mountOne(judged.skill)
              if (first.block) { blocks.push(first.block); skillBytes += first.bytes; skill1Bytes = first.bytes; skillId = judged.skill }
            }
            if (judged.skill2) {
              const second = await mountOne(judged.skill2)
              if (second.block) { blocks.push(second.block); skillBytes += second.bytes; skill2Bytes = second.bytes }
            }
            mounted = blocks.join('\n\n')
            if (blocks.length) {
              skillNote = ` · skill=${[judged.skill, judged.skill2].filter(Boolean).join(' + ')} (merged)`
            } else {
              skillNote = ' · skill=none'
            }
          } catch (err) {
            skillNote = ` · skill mount failed: ${shortError(err)}`
          }
        } else if (wantSkill !== 'off') {
          try {
            const chosen = wantSkill === 'auto'
              ? await pickSkill(task, args.context, cfg, exec)
              : { id: wantSkill, confidence: 0, source: 'explicit', reason: 'explicit skill' }
            skillSource = chosen.source || (wantSkill === 'auto' ? 'heuristic' : 'explicit')
            skillError = chosen.error ? String(chosen.error) : ''
            if (chosen.id && chosen.id !== SKILL_NONE) {
              const skill = skillById(chosen.id)
              if (skill) {
                const loaded = await skillBody(skill, cfg, exec)
                mounted = skillBlock(skill, loaded.text, cfg.skills.maxChars)
                skillId = skill.id
                skillNote = ` · skill=${skill.id}${loaded.cached ? ' (cached)' : ''}`
              } else {
                skillNote = ` · skill=${chosen.id} not in catalog, ignored`
              }
            } else {
              skillNote = ' · skill=none'
            }
          } catch (err) {
            skillNote = ` · skill lookup failed: ${shortError(err)}`
          }
        }

        // #4: low-confidence escalation. If the JEV judge picked a tier but was
        // not confident enough, upgrade to the decision tier (Kimi) — pay for a
        // correct answer rather than save on a likely-wrong one. Only applies to
        // auto-judged tiers (an explicit user/provider choice is respected).
        let escalated = false
        if (judged && askedTier === 'auto' && Number.isFinite(judged.confidence)
            && judged.confidence < cfg.lowConfidenceThreshold && tier !== 'decision') {
          escalated = true
          tier = 'decision'
          note += ` · low confidence ${judged.confidence.toFixed(2)} < ${cfg.lowConfidenceThreshold}: escalated to decision (Kimi)`
        }

        const forced = args.provider === 'kimi' || args.provider === 'dsf'
        const primaryProvider = forced ? args.provider : routeFor(tier).key
        // #3: the failover chain. decision (kimi) degrades to dsf, execution (dsf) to kimi.
        const backupProvider = primaryProvider === 'kimi' ? 'dsf' : 'kimi'
        // Two ways to run the routed work:
        //   dsh  — through DSH's own gateway, so the kimi/dsf keys here are unused
        //   direct — the plugin calls its own OpenAI-compatible gateway
        const useDsh = dshReady()
        const systemText = 'You are executing a task delegated by a chief-of-staff agent. Follow the task precisely and return a complete, self-contained answer.'
          + (mounted ? `\n\nWhere they apply, follow the skill instructions below. They are reference material, not a script to quote back.\n\n${mounted}` : '')
        const userText = args.context ? `Task:\n${task}\n\nContext:\n${args.context}` : task
        // #3: one attempt against a specific provider; returns everything we need.
        const makeCall = async (provider) => {
          const route = provider === 'kimi' ? cfg.kimi : cfg.dsf
          const binding = useDsh ? await dshResolve(provider) : null
          const servedModel = useDsh ? `${binding.provider}/${binding.model}` : route.model
          const degraded = provider !== primaryProvider ? primaryProvider : ''
          const answer = useDsh
            ? await dshChat(dshLlm(), binding, { system: systemText, user: userText, temperature: args.temperature, maxTokens: args.maxTokens, tool: 'call', degraded }, cfg, exec)
            : await chat(route, [
              { role: 'system', content: systemText },
              { role: 'user', content: userText },
            ], { provider, tool: 'call', temperature: args.temperature, maxTokens: args.maxTokens, degraded }, cfg, exec)
          return { answer, binding, servedModel, provider }
        }
        // #3: pre-declare safe fallbacks so the catch block never hits a TDZ when
        // the failover itself throws before these are assigned.
        let selected = primaryProvider
        let binding = null
        let servedModel = (primaryProvider === 'kimi' ? cfg.kimi : cfg.dsf).model
        const routedAt = Date.now()
        try {
          // #3: circuit-breaker + failover. A cooling-down provider is skipped
          // WITHOUT spending a timeout; a failed primary degrades to the backup.
          const failover = await executeWithFailover({
            primary: primaryProvider,
            backup: backupProvider,
            makeCall,
            onCooldown: (provider, ms) => {
              recordUsage({
                gateway: provider, model: '', tool: 'call', ok: false, sent: false, kind: 'cooldown',
                status: 0, ms: 0, error: `冷却中，跳过（剩 ${Math.ceil(ms / 60000)} 分钟）`,
              })
            },
          })
          if (failover.error || !failover.outcome) throw failover.error || new Error('both providers failed')
          const answer = failover.outcome.answer
          binding = failover.outcome.binding
          servedModel = failover.outcome.servedModel
          selected = failover.outcome.provider
          const degradedFrom = failover.degradedFrom
          const cooldownSkip = failover.cooldownSkip
          const emptyHint = answer.emptyNote || ''
          const followed = useDsh ? await dshFollowModel(binding) : false
          recordDecision({
            session: String((exec && (exec.sessionId || (exec.session && exec.session.id))) || 'unknown'),
            task, tier, asked: askedTier, provider: selected, model: servedModel, skill: skillId, ok: true,
            host: useDsh ? { provider: binding.provider, model: binding.model } : null,
            source: judged ? judged.source : 'explicit',
            choice: judged ? judged.choice : tier,
            confidence: judged ? judged.confidence : undefined,
            probabilities: judged ? judged.probabilities : undefined,
            difficulty: judged ? judged.difficulty : undefined,
            escalated,
            skillSource,
            skillError,
            skillBytes,
            skill1Bytes,
            skill2Bytes,
            skill2: judged && judged.skill2 ? judged.skill2 : '',
            // #3: degraded is true for a judge-layer fallback (#39) OR an
            // execution-layer failover away from the primary provider.
            degraded: Boolean((judged && judged.degraded) || degradedFrom),
            degradedFrom: degradedFrom || '',
            cooldownSkip: cooldownSkip || '',
            error: judged && judged.degraded ? String(judged.error || '').slice(0, 160) : '',
            ms: Date.now() - routedAt,
            pt: answer.promptTokens || 0,
            ct: answer.completionTokens || 0,
          })
          return result({
            ok: true,
            tier,
            provider: selected,
            model: servedModel,
            ...answer,
            note: (note || `${tier} tier via ${selected}`) + (useDsh ? ' · via DSH gateway' : ' · via plugin gateway')
              + (degradedFrom ? ` · ${degradedFrom} 失败已降级到 ${selected}` : '')
              + (cooldownSkip ? ` · ${cooldownSkip} 冷却中，直接走 ${selected}` : '')
              + (followed ? ` · DSH 选择器已切到 ${binding.model}` : '') + skillNote + emptyHint,
          })
        } catch (err) {
          recordDecision({
            session: String((exec && (exec.sessionId || (exec.session && exec.session.id))) || 'unknown'),
            task, tier, asked: askedTier, provider: selected, model: servedModel, skill: skillId, ok: false,
            host: useDsh ? { provider: binding.provider, model: binding.model } : null,
            source: judged ? judged.source : 'explicit',
            choice: judged ? judged.choice : tier,
            confidence: judged ? judged.confidence : undefined,
            probabilities: judged ? judged.probabilities : undefined,
            difficulty: judged ? judged.difficulty : undefined,
            escalated,
            skillSource,
            skillError,
            skillBytes,
            skill1Bytes,
            skill2Bytes,
            skill2: judged && judged.skill2 ? judged.skill2 : '',
            degraded: Boolean(judged && judged.degraded),
            ms: Date.now() - routedAt,
            error: shortError(err),
          })
          return result({ tier, provider: selected, model: servedModel, note: `call failed: ${shortError(err)}` })
        }
      },
    },
    {
      name: 'harness_classify',
      description: 'Ask the JEV judge what tier a task would get, without running it (diagnostics; normal work goes through harness_call with tier=auto). Returns decision (quality) or execution. decision = judgment, choice, evaluation, architecture, risk, quality. execution = mechanical implementation, transformation, formatting, extraction, generation. When JEV router is configured it is consulted; otherwise a local cue-based heuristic is used and ties default to the quality tier.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task'],
        properties: {
          task: { type: 'string', description: 'Task description to classify.' },
          context: { type: 'string', description: 'Optional background that affects the tier.' },
        },
      },
      output: { schema: RESULT_SCHEMA, render: render('Tier classification') },
      isConcurrencySafe: true,
      timeoutMs: cfg.timeoutMs + 5000,
      async execute(args) {
        refresh()
        if (!cfg.enabled) return result({ note: DISABLED_NOTE })
        const task = String(args.task || '').trim()
        if (!task) return result({ note: 'task must be a non-empty string' })
        const decided = await decideTier(task, args.context)
        return result({
          ok: true,
          tier: decided.tier,
          provider: 'jev',
          model: cfg.jev.base ? cfg.jev.model : 'local-heuristic',
          text: decided.tier,
          note: decided.reason,
        })
      },
    },
    {
      name: 'harness_review',
      description: 'Quality gate: send a draft to the OTHER model for an independent review before commit or delivery. By default a decision-tier draft is reviewed by DeepSeek4.1Flash101 and an execution-tier draft is reviewed by Kimi K3.1Pro. The reviewer returns a verdict plus concrete issues. Use this when a decision is high-stakes or when output correctness matters.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['task', 'draft'],
        properties: {
          task: { type: 'string', description: 'The original task or decision the draft addresses.' },
          draft: { type: 'string', description: 'The answer, plan, or decision to review.' },
          primaryTier: { type: 'string', enum: ['auto', 'decision', 'execution'], description: 'Tier of the model that produced the draft. Defaults to auto.' },
          reviewer: { type: 'string', enum: ['auto', 'kimi', 'dsf'], description: 'Force a specific reviewer. Defaults to the opposite model.' },
          criteria: { type: 'string', description: 'Optional specific review criteria.' },
        },
      },
      output: { schema: RESULT_SCHEMA, render: render('Quality review') },
      isConcurrencySafe: true,
      timeoutMs: cfg.timeoutMs + 5000,
      async execute(args, exec) {
        refresh()
        if (!cfg.enabled) return result({ note: DISABLED_NOTE })
        const task = String(args.task || '').trim()
        const draft = String(args.draft || '').trim()
        if (!task || !draft) return result({ note: 'task and draft must be non-empty strings' })
        let primary = args.primaryTier === 'decision' || args.primaryTier === 'execution' ? args.primaryTier : 'auto'
        let note = ''
        if (primary === 'auto') {
          const decided = await decideTier(task, '')
          primary = decided.tier
          note = `draft tier inferred as ${primary}: ${decided.reason}`
        }
        const reviewer = args.reviewer === 'kimi' || args.reviewer === 'dsf'
          ? args.reviewer
          : (primary === 'decision' ? 'dsf' : 'kimi')
        const route = reviewer === 'kimi' ? cfg.kimi : cfg.dsf
        const useDsh = dshReady()
        const binding = useDsh ? await dshResolve(reviewer) : null
        const servedModel = useDsh ? `${binding.provider}/${binding.model}` : route.model
        const systemText = 'You are an independent reviewer. Assess the draft against the task. State a verdict (PASS or CHANGE), then list concrete issues and fixes. Be concise and specific.'
        const userText = `Task:\n${task}\n\n${args.criteria ? `Criteria:\n${args.criteria}\n\n` : ''}Draft to review:\n${draft}`
        try {
          const answer = useDsh
            ? await dshChat(dshLlm(), binding, { system: systemText, user: userText, temperature: 0.1, tool: 'review' }, cfg, exec)
            : await chat(route, [
              { role: 'system', content: systemText },
              { role: 'user', content: userText },
            ], { provider: reviewer, tool: 'review', temperature: 0.1 }, cfg, exec)
          const followed = useDsh ? await dshFollowModel(binding) : false
          return result({
            ok: true,
            tier: primary,
            provider: reviewer,
            model: servedModel,
            text: answer.text,
            note: (note || `reviewed ${primary}-tier draft with ${reviewer}`) + (useDsh ? ' · via DSH gateway' : ' · via plugin gateway')
              + (followed ? ` · DSH 选择器已切到 ${binding.model}` : '') + (answer.emptyNote || ''),
            ...answer,
          })
        } catch (err) {
          return result({ tier: primary, provider: reviewer, model: servedModel, note: `review failed: ${shortError(err)}` })
        }
      },
    },
    {
      name: 'harness_dsh',
      description: 'Report whether this harness can route through DSH\'s own model gateway (the in-process llm service) instead of carrying its own API keys, and list the models DSH already knows about. Use it when the user asks "is the plugin using my DSH models?" or to pick the provider/model ids for the strategy (decision) and execution tiers.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['status', 'models'], description: 'status (default) reports capability; models lists the models for one DSH provider.' },
          provider: { type: 'string', description: 'DSH provider id to enumerate when action=models (e.g. titigate).' },
        },
      },
      output: { schema: RESULT_SCHEMA, render: render('DSH mode') },
      isConcurrencySafe: true,
      timeoutMs: cfg.timeoutMs + 5000,
      async execute(args) {
        refresh()
        const action = args.action === 'models' ? 'models' : 'status'
        const lines = []
        let llm = null
        try {
          llm = ctx.get('llm') || null
        } catch { llm = null }
        lines.push(`llm service: ${llm ? 'available' : 'missing'}`)
        let api = null
        let importError = ''
        try {
          api = await import('@deepseek-ai/dsh-llm')
        } catch (err) {
          importError = shortError(err)
        }
        lines.push(api ? `dsh-llm import: ok (${Object.keys(api).slice(0, 8).join(', ')}${Object.keys(api).length > 8 ? ', …' : ''})` : `dsh-llm import: FAILED — ${importError}`)
        if (llm && typeof llm.listModels === 'function') {
          const provider = typeof args.provider === 'string' ? args.provider.trim() : ''
          if (action === 'models') {
            if (!provider) {
              const catalog = await dshCatalog()
              lines.push(`catalog: ${catalog.providers.length} provider(s), ${catalog.providers.reduce((n, p) => n + p.models.length, 0)} model(s)`)
              for (const p of catalog.providers) {
                lines.push(`  ${p.id}${p.name && p.name !== p.id ? ` (${p.name})` : ''}: ${p.models.length} model(s)`)
                for (const m of p.models.slice(0, 12)) lines.push(`    - ${m.id}`)
              }
              const d = await dshResolve('kimi')
              const x = await dshResolve('dsf')
              lines.push(`auto decision  → ${d.provider}/${d.model}${d.auto ? ' (picked)' : ' (from settings)'}`)
              lines.push(`auto execution → ${x.provider}/${x.model}${x.auto ? ' (picked)' : ' (from settings)'}`)
            } else {
              try {
                const models = await llm.listModels(provider)
                const ids = (Array.isArray(models) ? models : []).map((m) => (m && (m.id || m.model)) || String(m))
                lines.push(`provider ${provider}: ${ids.length} model(s)`)
                for (const id of ids.slice(0, 40)) lines.push(`  - ${id}`)
              } catch (err) {
                lines.push(`provider ${provider}: listModels failed — ${shortError(err)}`)
              }
            }
          } else {
            const sel = dshDefaultSelection()
            lines.push(`DSH 模型选择器现在指向：${sel ? `${sel.provider}/${sel.model}` : '(读不到)'}`)
            lines.push(`跟随切换 followModel: ${cfg.followModel ? 'on' : 'off'}`)
            lines.push('tip: action=models with a provider id lists its exact ids; without one it dumps the whole catalog')
          }
        } else if (llm) {
          lines.push('llm service has no listModels — model ids must be typed manually')
        }
        return result({ ok: Boolean(llm && api), note: lines.join('\n') })
      },
    },
    {
      name: 'harness_probe',
      description: 'Check connectivity and discover the exact model IDs served by a gateway. Uses the OpenAI-compatible GET /models endpoint. Call this once after configuring a base URL and key, especially when the configured marketing model name may not match the gateway model ID. #33: this probe is ALLOWED even when the harness switch is OFF — it is 仅探测，不接管 (a diagnostic for why the switch cannot be turned on); it never routes work.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', enum: ['jev', 'kimi', 'dsf'], description: 'Which gateway to probe. Defaults to all three.' },
        },
      },
      output: { schema: RESULT_SCHEMA, render: render('Gateway probe') },
      isConcurrencySafe: true,
      timeoutMs: cfg.timeoutMs + 5000,
      async execute(args, exec) {
        refresh()
        const which = args.provider === 'jev' || args.provider === 'kimi' || args.provider === 'dsf'
          ? [args.provider]
          : ['jev', 'kimi', 'dsf']
        // In DSH mode the kimi/dsf hops are served by the Host itself, so the
        // honest check is "does the Host resolve these provider/model pairs".
        if (dshReady()) {
          const lines = []
          const picked = {}
          let okCount = 0
          for (const selected of ['kimi', 'dsf']) {
            if (args.provider && args.provider !== selected) continue
            const binding = await dshResolve(selected)
            picked[selected] = binding
            try {
              const models = await dshModels(binding.provider)
              const hit = models.some((m) => m.id === binding.model)
              okCount += 1
              lines.push(`${selected}: DSH ${binding.provider}/${binding.model} — ${hit ? 'OK' : `model id NOT in list (${models.length} served)`}${models.length && !hit ? `: ${models.slice(0, 20).map((m) => m.id).join(', ')}` : ''}`)
            } catch (err) {
              lines.push(`${selected}: DSH ${binding.provider}/${binding.model} — ERROR ${shortError(err)}`)
            }
          }
          if (args.provider === 'jev' || !args.provider) {
            const jevUrl = modelsUrl(cfg.jev.base)
            if (!jevUrl) lines.push('jev: NOT CONFIGURED (no base URL)')
            else {
              const link = combineSignal(timeoutFor('probe', cfg), exec?.signal)
              try {
                const res = await fetch(jevUrl, { headers: cfg.jev.key ? { authorization: `Bearer ${cfg.jev.key}` } : {}, signal: link.signal })
                lines.push(`jev: HTTP ${res.status}`)
                if (res.ok) okCount += 1
              } catch (err) {
                lines.push(`jev: ERROR ${shortError(err)}`)
              } finally { link.dispose() }
            }
          }
          return result({
            ok: okCount > 0,
            provider: args.provider || 'dsh',
            text: lines.join('\n'),
            note: `route mode: DSH gateway (decision ${picked.kimi ? `${picked.kimi.provider}/${picked.kimi.model}${picked.kimi.auto ? ' auto' : ''}` : '—'} · execution ${picked.dsf ? `${picked.dsf.provider}/${picked.dsf.model}${picked.dsf.auto ? ' auto' : ''}` : '—'})`,
          })
        }
        const lines = []
        let okCount = 0
        for (const key of which) {
          const route = cfg[key]
          const url = modelsUrl(route.base)
          if (!url) {
            lines.push(`${key}: NOT CONFIGURED (no base URL)`)
            continue
          }
          const link = combineSignal(timeoutFor('probe', cfg), exec?.signal)
          const probeStartedAt = Date.now()
          try {
            const res = await fetch(url, {
              headers: route.key ? { authorization: `Bearer ${route.key}` } : {},
              signal: link.signal,
            })
            const raw = await res.text()
            if (!res.ok) {
              recordUsage({ gateway: key, model: route.model, tool: 'probe', ok: false, status: res.status, ms: Date.now() - probeStartedAt, error: raw.slice(0, 120) })
              lines.push(`${key}: HTTP ${res.status} ${raw.slice(0, 200)}`)
              continue
            }
            let ids = []
            try {
              const body = JSON.parse(raw)
              ids = (Array.isArray(body?.data) ? body.data : []).map(m => m?.id).filter(Boolean)
            } catch {
              ids = []
            }
            okCount += 1
            recordUsage({ gateway: key, model: route.model, tool: 'probe', ok: true, status: res.status, ms: Date.now() - probeStartedAt })
            lines.push(`${key}: OK (configured model "${route.model}")${ids.length ? ` — served: ${ids.slice(0, 30).join(', ')}` : ''}`)
          } catch (err) {
            recordUsage({ gateway: key, model: route.model, tool: 'probe', ok: false, status: 0, ms: Date.now() - probeStartedAt, error: shortError(err) })
            lines.push(`${key}: ERROR ${shortError(err)}`)
          } finally {
            link.dispose()
          }
        }
        return result({
          ok: okCount > 0,
          provider: which.join(','),
          text: lines.join('\n'),
          note: `${okCount}/${which.length} gateways reachable${cfg.enabled ? '' : ' · 仅探测，不接管：总开关已关闭，本次仅做连通探测，不路由任何任务；harness_call/classify/review 已让位'}`,
        })
      },
    },
    {
      name: 'harness_skill',
      description: 'Work with the mattpocock/skills catalog that harness_call mounts automatically. action=list returns every skill id with its description; action=pick asks the JEV judge which skill fits a task (no skill body is fetched); action=read returns one skill\'s SKILL.md; action=refresh re-reads the live GitHub repo and rewrites the local catalog; action=status reports catalog size, snapshot commit and cache usage. Editing skills is not supported — this is read-only reference material.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['list', 'pick', 'read', 'refresh', 'status'], description: 'Defaults to list.' },
          task: { type: 'string', description: 'The task to route, for action=pick.' },
          context: { type: 'string', description: 'Optional background for action=pick.' },
          id: { type: 'string', description: 'Skill id such as "engineering/tdd", for action=read.' },
          sibling: { type: 'string', description: 'Optional sibling document name (e.g. "mocking.md") for action=read — returns that sibling instead of SKILL.md (#11).' },
        },
      },
      output: { schema: RESULT_SCHEMA, render: render('Harness skill') },
      isConcurrencySafe: true,
      timeoutMs: cfg.timeoutMs + 5000,
      async execute(args, exec) {
        refresh()
        const action = typeof args.action === 'string' ? args.action : 'list'
        try {
          if (action === 'list') {
            const catalog = skillCatalog()
            const lines = catalog.skills.map(skill => `${skill.id} — ${skill.description.slice(0, 200)}`)
            return result({
              ok: true,
              provider: 'skills',
              model: `${catalog.snapshot?.repo || cfg.skills.repo}@${catalog.snapshot?.commit || cfg.skills.ref}`,
              text: lines.join('\n'),
              note: `${catalog.skills.length} skills (${catalog.source}); bodies are cached in ${skillsDir()}`,
            })
          }
          if (action === 'pick') {
            const task = String(args.task || '').trim()
            if (!task) return result({ note: 'task must be a non-empty string' })
            const chosen = await pickSkill(task, args.context, cfg, exec)
            return result({
              ok: chosen.id !== SKILL_NONE,
              provider: 'skills',
              model: chosen.id,
              text: chosen.id,
              note: chosen.reason,
            })
          }
          if (action === 'read') {
            const id = String(args.id || '').trim()
            const skill = skillById(id)
            if (!skill) return result({ note: `unknown skill id "${id}" — call harness_skill action=list` })
            // #11: `sibling` reads a bundled sibling document instead of SKILL.md.
            const sibling = typeof args.sibling === 'string' && args.sibling.trim() ? args.sibling.trim() : ''
            if (sibling) {
              const link = combineSignal(cfg.timeoutMs, exec && exec.signal)
              let raw, res
              try {
                res = await fetch(siblingRawUrl(skill, sibling, cfg), { signal: link.signal })
                raw = await res.text()
              } finally {
                link.dispose()
              }
              if (!res.ok) return result({ note: `HTTP ${res.status} fetching sibling "${sibling}" of ${id}` })
              return result({
                ok: true,
                provider: 'skills',
                model: `${skill.id}/${sibling}`,
                text: raw,
                note: `sibling ${sibling} of ${skill.id} · ${raw.length} bytes · ${siblingRawUrl(skill, sibling, cfg)}`,
              })
            }
            const loaded = await skillBody(skill, cfg, exec)
            return result({
              ok: true,
              provider: 'skills',
              model: skill.id,
              text: loaded.text,
              note: `${skill.bytes} bytes on disk${loaded.cached ? ', served from cache' : ', fetched and cached'}` +
                `${loaded.complete === false ? ' · 正文未通过完整性检查（未缓存，下次会重取）' : ''} · ${skillRawUrl(skill, cfg)}`,
            })
          }
          if (action === 'status') {
            const catalog = skillCatalog()
            return result({
              ok: true,
              provider: 'skills',
              model: `${catalog.snapshot?.repo || cfg.skills.repo}@${catalog.snapshot?.commit || cfg.skills.ref}`,
              text: JSON.stringify({
                count: catalog.skills.length,
                source: catalog.source,
                snapshot: catalog.snapshot,
                autoMount: cfg.skills.auto,
                cached: countCachedSkills(cfg),
                dir: skillsDir(),
              }, null, 2),
              note: `auto-mount is ${cfg.skills.auto ? 'ON' : 'OFF'}`,
            })
          }
          if (action === 'refresh') {
            const synced = await refreshSkills(cfg)
            return result({
              ok: true,
              provider: 'skills',
              model: `${synced.repo}@${synced.commit}`,
              text: `catalog rebuilt: ${synced.count} skills`,
              note: `added ${synced.added}, removed ${synced.removed}; saved to ${skillsCatalogFile()}`,
            })
          }
          return result({ note: `unknown action "${action}"` })
        } catch (err) {
          return result({ provider: 'skills', note: `skill action failed: ${shortError(err)}` })
        }
      },
    },
  ]

  /* ------------------------------------------------------- settings bridge */

  /** One gateway's reachability and the model ids it actually serves. */
  async function probeRoute(key) {
    const route = cfg[key]
    const url = modelsUrl(route.base)
    if (!url) return { key, ok: false, detail: 'NOT CONFIGURED (no base URL)', models: [] }
    const startedAt = Date.now()
    const link = combineSignal(cfg.timeoutMs, undefined)
    try {
      const res = await fetch(url, {
        headers: route.key ? { authorization: `Bearer ${route.key}` } : {},
        signal: link.signal,
      })
      const raw = await res.text()
      if (!res.ok) {
        recordUsage({ gateway: key, model: route.model, tool: 'probe', ok: false, status: res.status, ms: Date.now() - startedAt, error: raw.slice(0, 120) })
        return { key, ok: false, detail: `HTTP ${res.status} ${raw.slice(0, 200)}`, models: [] }
      }
      let models = []
      try {
        const body = JSON.parse(raw)
        models = (Array.isArray(body?.data) ? body.data : []).map(model => model?.id).filter(Boolean)
      } catch { models = [] }
      recordUsage({ gateway: key, model: route.model, tool: 'probe', ok: true, status: res.status, ms: Date.now() - startedAt })
      return { key, ok: true, detail: `configured model "${route.model}"`, models }
    } catch (err) {
      recordUsage({ gateway: key, model: route.model, tool: 'probe', ok: false, status: 0, ms: Date.now() - startedAt, error: shortError(err) })
      return { key, ok: false, detail: shortError(err), models: [] }
    } finally {
      link.dispose()
    }
  }

  /** Only the local desktop page may talk to these routes. */
  /**
   * Only the desktop page served by this Host may talk to these routes.
   *
   * Threat model (#26): any local process — or any other plugin on this Host —
   * can send whatever headers it likes, so this gate is a stopgap until the
   * bridge token lands, not real authentication. What it must stop is the
   * naive caller: a request with no Origin (curl, a stray script, a page from
   * another site) must never reach a route that can rewrite base URLs or keys.
   *
   * Rules:
   *  - Host must be a loopback name, optionally with a port.
   *  - A present Origin must equal `http://<host>` exactly — not `null`, not a
   *    foreign origin, not a suffix match like `http://127.0.0.1:1.evil.example`.
   *  - An absent Origin is only allowed for a browser-issued GET/HEAD, proven
   *    by Fetch metadata (`Sec-Fetch-Site: same-origin|same-site|none`). The
   *    panel's same-origin GET carries no Origin header at all, so rejecting
   *    every Origin-less request outright would break the settings page.
   *    Every write (POST) must carry the exact Origin.
   */
  function bridgeAllowed(req) {
    const host = String(req.headers?.host || '').trim()
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)) return false
    const origin = String(req.headers?.origin || '').trim()
    if (origin !== '') return origin === `http://${host}`
    const method = String(req.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return false
    const site = String(req.headers?.['sec-fetch-site'] || '').trim().toLowerCase()
    return site === 'same-origin' || site === 'same-site' || site === 'none'
  }

  function writeJson(res, status, body) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    res.end(JSON.stringify(body))
  }

  async function readJsonBody(req, limit = 65536) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > limit) return undefined
      chunks.push(chunk)
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return undefined }
  }

  /** Current effective settings, with keys reduced to a set/unset flag. */
  async function statusPayload() {
    const live = refresh()
    const saved = readStore()
    const view = (key) => ({
      baseUrl: live[key].base,
      model: live[key].model,
      keySet: live[key].key !== '',
      baseFromSettings: Boolean(saved[`${key}BaseUrl`]),
      keyFromSettings: Boolean(saved[`${key}ApiKey`]),
    })
    // Honest state for the client (#13). The client must render this, never
    // infer from `enabled`: a fresh install is enabled but cannot serve.
    const recent = readUsage().recent
    const lastCall = recent.length ? recent[recent.length - 1] : null
    const state = computeBridgeState(live, lastCall)

    return {
      ok: true,
      version: PACKAGE_VERSION,
      enabled: live.enabled,
      state,
      // #4: echo the judge escalation threshold so the panel input shows the real value.
      lowConfidenceThreshold: live.lowConfidenceThreshold,
      // #2: history config surfaced for the panel's auto-context switch + turn cap.
      history: { auto: live.history.auto, turns: live.history.turns, maxChars: live.history.maxChars },
      // #39: judge timeout is separate from the 120s generation timeout.
      judgeTimeoutMs: live.judgeTimeoutMs,
      timeoutMs: live.timeoutMs,
      file: storePath(),
      gateways: { jev: view('jev'), kimi: view('kimi'), dsf: view('dsf') },
      tiers: { decision: 'kimi', execution: 'dsf' },
      route: {
        mode: live.routeMode,
        dshAvailable: dshLlm() !== null,
        // True when calls actually go through DSH right now.
        active: live.routeMode === 'dsh' && dshLlm() !== null,
        // What the panel shows in its pickers, plus what "auto" currently
        // resolves to on THIS DSH install (no hard-coded provider anywhere).
        decision: { provider: live.decision.provider, model: live.decision.model },
        execution: { provider: live.execution.provider, model: live.execution.model },
        catalog: live.routeMode === 'dsh' && dshLlm() !== null ? await dshCatalog() : { ok: false, providers: [] },
        follow: dshDefaultSelection(),
        followModel: live.followModel,
        resolved: live.routeMode === 'dsh' && dshLlm() !== null
          ? { decision: await dshResolve('kimi'), execution: await dshResolve('dsf') }
          : null,
      },
      decisions: readUsage().decisions.slice(-5).reverse(),
      skills: {
        auto: live.skills.auto,
        count: skillCatalog().skills.length,
        source: skillCatalog().source,
        snapshot: skillCatalog().snapshot,
        cached: countCachedSkills(cfg),
        dir: skillsDir(),
        repo: `https://github.com/${live.skills.repo}`,
      },
    }
  }

  /** Minimal tar reader: enough for a GitHub source tarball (ustar, 512-byte blocks). */
  /**
   * Minimal tar reader for a GitHub source tarball.
   *
   * A malformed header must THROW, never silently truncate the catalogue (#28):
   * one bad size field used to produce `NaN`, the loop exited quietly, and the
   * refresh replaced 39 skills with 3 while reporting success.
   */
  function readTar(buf) {
    const files = new Map()
    let offset = 0
    while (offset + 512 <= buf.length) {
      const header = buf.subarray(offset, offset + 512)
      if (header.every(byte => byte === 0)) break
      const magic = header.subarray(257, 262).toString('ascii')
      if (magic !== 'ustar') {
        throw new Error(`tar: 头部 magic 非法（偏移 ${offset}: ${JSON.stringify(magic)}），拒绝解析`)
      }
      const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '')
      const prefix = field(345, 155)
      const rawName = field(0, 100)
      const name = prefix ? `${prefix}/${rawName}` : rawName
      const rawSize = field(124, 12).trim() || '0'
      if (!/^[0-7]+$/.test(rawSize)) {
        throw new Error(`tar: 条目 ${JSON.stringify(name)} 的 size 字段非法（${JSON.stringify(rawSize)}），拒绝解析`)
      }
      const size = parseInt(rawSize, 8)
      if (!Number.isFinite(size) || size < 0) {
        throw new Error(`tar: 条目 ${JSON.stringify(name)} 的 size 无法解析，拒绝解析`)
      }
      const type = field(156, 1)
      const dataStart = offset + 512
      if (dataStart + size > buf.length) {
        throw new Error(`tar: 条目 ${JSON.stringify(name)} 声明 ${size} 字节，超出归档长度，归档被截断`)
      }
      if (type === '0' || type === '') {
        files.set(name, buf.subarray(dataStart, dataStart + size))
      }
      offset = dataStart + Math.ceil(size / 512) * 512
    }
    return files
  }

  function parseFrontmatter(source) {
    const meta = {}
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return meta
    for (const line of match[1].split(/\r?\n/)) {
      const index = line.indexOf(':')
      if (index <= 0) continue
      const key = line.slice(0, index).trim()
      const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, '')
      if (key) meta[key] = value
    }
    return meta
  }

  /**
   * Rebuild the catalog from the live repo in ONE request: download the source
   * tarball, parse it, read every SKILL.md frontmatter, cache the bodies, then
   * write catalog.json (which then wins over the bundled snapshot).
   */
  async function refreshSkills(cfg2) {
    const repo = cfg2.skills.repo || SKILLS_URL_REPO
    const ref = cfg2.skills.ref || 'main'
    const url = `https://codeload.github.com/${repo}/tar.gz/refs/heads/${ref}`
    // #30：整个 refresh 共用一份总预算，第二个请求（commit）不许无限挂起。
    const budgetMs = Math.max(100, Number(cfg2.timeoutMs) || 120000)
    const deadline = Date.now() + budgetMs
    const link = combineSignal(cfg2.timeoutMs, undefined)
    let buf
    try {
      const res = await fetch(url, { signal: link.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`)
      buf = Buffer.from(await res.arrayBuffer())
    } finally {
      link.dispose()
    }
    // 当前用户实际看到的目录（可能是内置快照，也可能是上一次刷新结果）。
    const previousSkills = skillCatalog().skills
    const previousIds = previousSkills.map(skill => skill.id)

    const files = readTar(zlib.gunzipSync(buf))
    const skills = []
    const bodies = []
    for (const [fullPath, data] of files) {
      const match = fullPath.match(/(?:^|\/)skills\/([^/]+)\/([^/]+)\/SKILL\.md$/)
      if (!match) continue
      const [, category, dir] = match
      const source = data.toString('utf8')
      const meta = parseFrontmatter(source)
      const siblings = []
      const siblingPrefix = fullPath.slice(0, fullPath.length - 'SKILL.md'.length)
      for (const other of files.keys()) {
        if (!other.startsWith(siblingPrefix)) continue
        const rest = other.slice(siblingPrefix.length)
        if (!rest || rest.includes('/')) continue
        if (other.endsWith('/SKILL.md')) continue
        siblings.push(rest)
      }
      const id = `${category}/${dir}`
      skills.push({
        id,
        category,
        name: meta.name || dir,
        description: meta.description || '',
        path: `skills/${category}/${dir}/SKILL.md`,
        bytes: data.length,
        siblings: siblings.sort(),
      })
      bodies.push({ id, source })
    }
    if (skills.length === 0) throw new Error('no skills found in the tarball — check skillsRepo / skillsRef')
    skills.sort((a, b) => a.id.localeCompare(b.id))

    // 完整性：每个 SKILL.md 都要有 frontmatter 的 name 与 description，
    // 缺一个就整体拒绝，绝不落盘半套目录（#28）。
    const incomplete = skills.filter(skill => !skill.name || !skill.description).map(skill => skill.id)
    if (incomplete.length > 0) {
      throw new Error(`技能目录不完整：${incomplete.slice(0, 5).join(', ')}${incomplete.length > 5 ? ` 等 ${incomplete.length} 条` : ''} 缺少 frontmatter name/description`)
    }

    // 数量护栏：一次刷新不许把目录砍到「不足 10 条」或「不足原来的一半」，
    // 宁可保留旧目录并报错，也不许把 39 条静默换成 3 条（#28）。
    const minimum = Math.max(10, Math.ceil(previousSkills.length / 2))
    if (skills.length < minimum) {
      throw new Error(`拒绝用 ${skills.length} 条覆盖现有 ${previousSkills.length} 条技能目录（下限 ${minimum} 条）；原目录保留`)
    }

    // 只有全部校验通过后才写正文缓存。
    const cachedNames = []
    for (const body of bodies) {
      // 与 skillBody 用同一套命名（含 repo@ref 短哈希）和原子写（#32）。
      const cacheFile = skillCacheFile({ id: body.id }, cfg2)
      try {
        writeSkillCacheAtomic(cacheFile, body.source)
        cachedNames.push(cacheFile)
      } catch { /* cache is optional */ }
    }

    let commit = ''
    const remaining = deadline - Date.now()
    if (remaining > 0) {
      // commit 只是展示信息：拿不到就记 null，不让整次刷新挂住或失败（#30）。
      const commitLink = combineSignal(remaining, undefined)
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/commits/${ref}`, {
          headers: { accept: 'application/vnd.github+json' },
          signal: commitLink.signal,
        })
        if (res.ok) {
          const body = await res.json()
          commit = String(body?.sha || '').slice(0, 7)
        }
      } catch { /* informational only */ } finally {
        commitLink.dispose()
      }
    }

    const snapshot = {
      repo,
      ref,
      commit: commit || null,
      takenAt: new Date().toISOString(),
      count: skills.length,
    }
    // 原子替换：先写同目录临时文件再 rename，写一半不会顶掉旧 catalog。
    fs.mkdirSync(skillsDir(), { recursive: true, mode: 0o700 })
    const catalogFile = skillsCatalogFile()
    const tempFile = `${catalogFile}.${process.pid}-${randomUUID().slice(0, 8)}.tmp`
    try {
      fs.writeFileSync(tempFile, JSON.stringify({ snapshot, skills }, null, 2), { mode: 0o600 })
      fs.renameSync(tempFile, catalogFile)
    } catch (err) {
      try { fs.unlinkSync(tempFile) } catch { /* 已被 rename 或本来就没写成 */ }
      throw new Error(`写入技能目录失败，原目录保留：${shortError(err)}`)
    }

    const now = new Set(skills.map(skill => skill.id))
    const before = new Set(previousIds)
    return {
      repo,
      // 没取到 commit 时返回 null，而不是拿 ref 冒充一个 sha（#30）。
      commit: commit || null,
      count: skills.length,
      added: skills.filter(skill => !before.has(skill.id)).length,
      removed: previousIds.filter(id => !now.has(id)).length,
      cached: cachedNames.length,
    }
  }

  /** 只数当前 repo@ref 的缓存，旧分支的残留不算「已缓存」（#32）。 */
  function countCachedSkills(cfg2) {
    try {
      const suffix = `.${skillCacheTag(cfg2)}.md`
      return fs.readdirSync(skillsDir()).filter(f => f.endsWith(suffix)).length
    } catch {
      return 0
    }
  }

  const bridgeRoutes = [
    {
      kind: 'exact',
      path: '/api/jev-harness/token',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, LOCAL_ONLY); return }
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        // Bootstrap 是整条链路唯一的软点：拿得到它的进程也就拿得到 token。
        // 见 BRIDGE_TOKEN 注释里的诚实边界。
        writeJson(res, 200, { ok: true, token: BRIDGE_TOKEN })
      },
    },
    {
      kind: 'exact',
      path: '/api/jev-harness/status',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, LOCAL_ONLY); return }
        if (!bridgeAuthorized(req)) { writeJson(res, 401, { ok: false, error: 'bridge token required' }); return }
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        const payload = await statusPayload()
        payload.selfCheck = selfCheckPayload()
        writeJson(res, 200, payload)
      },
    },
    {
      kind: 'exact',
      path: '/api/jev-harness/selfcheck',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, LOCAL_ONLY); return }
        if (!bridgeAuthorized(req)) { writeJson(res, 401, { ok: false, error: 'bridge token required' }); return }
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        // #7: 客户端 apply() 把 slot 注册结果上报到这里；面板白屏时 /status 仍能说出哪一格坏了。
        const body = await readJsonBody(req, 16384)
        if (!body || typeof body !== 'object' || !body.slots || typeof body.slots !== 'object') {
          writeJson(res, 400, { ok: false, error: 'slots object is required' })
          return
        }
        reportSlotsSelfCheck(body.slots)
        writeJson(res, 200, { ok: true, selfCheck: selfCheckPayload() })
      },
    },
    {
      kind: 'exact',
      path: '/api/jev-harness/save',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, LOCAL_ONLY); return }
        if (!bridgeAuthorized(req)) { writeJson(res, 401, { ok: false, error: 'bridge token required' }); return }
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = await readJsonBody(req)
        if (!body || typeof body !== 'object') { writeJson(res, 400, { ok: false, error: 'malformed JSON body' }); return }
        const patch = {}
        if (Object.prototype.hasOwnProperty.call(body, 'enabled')) patch.enabled = body.enabled
        if (Object.prototype.hasOwnProperty.call(body, 'skillsAuto')) patch.skillsAuto = body.skillsAuto
        if (typeof body.followModel === 'boolean') patch.followModel = body.followModel
        // #4: accept the judge escalation threshold (0-1 number).
        if (body.lowConfidenceThreshold !== undefined) {
          const v = Number(body.lowConfidenceThreshold)
          if (!Number.isFinite(v) || v < 0 || v > 1) { writeJson(res, 400, { ok: false, error: 'lowConfidenceThreshold must be a number between 0 and 1' }); return }
          patch.lowConfidenceThreshold = v
        }
        // #39: judge timeout must stay in a sane band; reject instead of silently clamping.
        if (body.judgeTimeoutMs !== undefined) {
          const v = Number(body.judgeTimeoutMs)
          if (!Number.isFinite(v) || v < 100 || v > 60000) {
            writeJson(res, 400, { ok: false, error: 'judgeTimeoutMs must be a number between 100 and 60000' })
            return
          }
          patch.judgeTimeoutMs = Math.round(v)
        }
        // #33: generation timeout. Gateway calls pick it up on the next call via
        // refresh(), but the tool-REGISTRATION timeout was fixed at apply() — so we
        // must tell the user a reload is needed for the tool layer.
        if (body.timeoutMs !== undefined) {
          const v = Number(body.timeoutMs)
          if (!Number.isFinite(v) || v <= 0) {
            writeJson(res, 400, { ok: false, error: 'timeoutMs must be a positive number' })
            return
          }
          patch.timeoutMs = Math.round(v)
        }
        // #3: per-operation timeout overrides (probe / execution / decision / review).
        for (const key of ['timeoutProbe', 'timeoutExecution', 'timeoutDecision', 'timeoutReview']) {
          if (body[key] === undefined) continue
          const v = Number(body[key])
          if (!Number.isFinite(v) || v <= 0) { writeJson(res, 400, { ok: false, error: `${key} must be a positive number` }); return }
          patch[key] = Math.round(v)
        }
        if (typeof body.routeMode === 'string') {
          const mode = body.routeMode.trim().toLowerCase()
          if (mode !== 'dsh' && mode !== 'direct') { writeJson(res, 400, { ok: false, error: 'routeMode must be dsh or direct' }); return }
          patch.routeMode = mode
        }
        for (const [tierKey, prefix] of [['decision', 'decision'], ['execution', 'execution']]) {
          const tier = body[tierKey]
          if (!tier || typeof tier !== 'object') continue
          if (typeof tier.provider === 'string') patch[`${prefix}Provider`] = tier.provider
          if (typeof tier.model === 'string') patch[`${prefix}Model`] = tier.model
        }
        for (const key of ['jev', 'kimi', 'dsf']) {
          const entry = body[key]
          if (!entry || typeof entry !== 'object') continue
          if (typeof entry.baseUrl === 'string') patch[`${key}BaseUrl`] = entry.baseUrl
          if (typeof entry.model === 'string') patch[`${key}Model`] = entry.model
          // A blank key field means "keep the stored key"; only an explicit null clears it.
          if (entry.apiKey === null) patch[`${key}ApiKey`] = ''
          else if (typeof entry.apiKey === 'string' && entry.apiKey.trim() !== '') patch[`${key}ApiKey`] = entry.apiKey
        }
        try {
          writeStore(patch)
        } catch (err) {
          writeJson(res, 500, { ok: false, error: `could not save: ${shortError(err)}` })
          return
        }
        const payload = await statusPayload()
        if (patch.timeoutMs !== undefined) {
          // #33: honest about the registration-snapshot. The gateway-call timeout is
          // already live; the tool-registration timeout only re-reads on plugin reload.
          payload.notice = `timeoutMs 已保存为 ${patch.timeoutMs}ms：网关调用即刻按新值生效；但工具注册时的超时是注册期快照，需重载插件后工具层才按 ${patch.timeoutMs}ms 生效。`
        }
        writeJson(res, 200, payload)
      },
    },
    {
      kind: 'exact',
      path: '/api/jev-harness/toggle',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, LOCAL_ONLY); return }
        if (!bridgeAuthorized(req)) { writeJson(res, 401, { ok: false, error: 'bridge token required' }); return }
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        const body = await readJsonBody(req)
        if (!body || typeof body !== 'object') { writeJson(res, 400, { ok: false, error: 'malformed JSON body' }); return }
        const flag = truthy(body.enabled, undefined)
        if (flag === undefined) { writeJson(res, 400, { ok: false, error: 'enabled must be a boolean' }); return }
        try {
          writeStore({ enabled: flag })
        } catch (err) {
          writeJson(res, 500, { ok: false, error: `could not save: ${shortError(err)}` })
          return
        }
        writeJson(res, 200, await statusPayload())
      },
    },
    {
      kind: 'exact',
      path: '/api/jev-harness/skills/refresh',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, LOCAL_ONLY); return }
        if (!bridgeAuthorized(req)) { writeJson(res, 401, { ok: false, error: 'bridge token required' }); return }
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        refresh()
        try {
          const synced = await refreshSkills(cfg)
          writeJson(res, 200, { ok: true, ...synced, status: await statusPayload() })
        } catch (err) {
          writeJson(res, 500, { ok: false, error: shortError(err) })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/jev-harness/stats',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, LOCAL_ONLY); return }
        if (!bridgeAuthorized(req)) { writeJson(res, 401, { ok: false, error: 'bridge token required' }); return }
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        const params = new URL(req.url || '/api/jev-harness/stats', 'http://127.0.0.1').searchParams
        const asked = Number(params.get('hours'))
        const report = usageReport(Number.isFinite(asked) && asked > 0 ? Math.min(168, asked) : 24)
        // 看板的空态卡按 off/setup/ready 分流；unknown 由客户端在请求失败时自己产生。
        report.state = computeBridgeState(refresh(), report.recent[0])
        // #3: expose each gateway's circuit-breaker cooldown so the panel can show
        // a grey "cooling down · N min left" badge on the traffic card.
        report.breakers = Object.fromEntries(['jev', 'kimi', 'dsf'].map((g) => {
          const ms = breakerCooldownMs(g)
          return [g, { coolingDown: ms > 0, cooldownMs: ms, minutesLeft: ms > 0 ? Math.ceil(ms / 60000) : 0 }]
        }))
        // #41: judge-quality metrics — always for the whole machine, and for one
        // session when ?session= is given (panel shows "this session" vs "all").
        const usage = readUsage()
        const allDecisions = usage.decisions || []
        const allRecent = usage.recent || []
        report.judgeQuality = judgeQuality(allDecisions, allRecent)
        // #11: skill mount statistics — how often each skill was mounted and the
        // total bytes mounted (top-1 + top-2), so the panel can show skill usage.
        const mountMap = new Map()
        for (const d of allDecisions) {
          // #11 fix: bytes are attributed per skill (skill1Bytes to the primary,
          // skill2Bytes to the second) — NOT the shared total to both.
          if (d.skill && d.skill !== 'none') {
            if (!mountMap.has(d.skill)) mountMap.set(d.skill, { id: d.skill, mounts: 0, bytes: 0 })
            const m = mountMap.get(d.skill)
            m.mounts += 1
            m.bytes += Math.round(d.skill1Bytes || 0)
          }
          if (d.skill2) {
            if (!mountMap.has(d.skill2)) mountMap.set(d.skill2, { id: d.skill2, mounts: 0, bytes: 0 })
            const m = mountMap.get(d.skill2)
            m.mounts += 1
            m.bytes += Math.round(d.skill2Bytes || 0)
          }
        }
        report.skillMounts = [...mountMap.values()].sort((a, b) => b.mounts - a.mounts)
        // #41 follow-up: the full session list (decisions + recent), so the panel
        // dropdown is not limited to the 40-row recent ring.
        report.sessions = usageSessions(usage)
        const wantSession = params.get('session')
        if (wantSession) {
          const sd = allDecisions.filter(d => d.session === wantSession)
          const sr = allRecent.filter(r => r.session === wantSession)
          report.session = {
            id: wantSession,
            judgeQuality: judgeQuality(sd, sr),
            decisions: sd.slice(-50).reverse(),
            recent: sr.slice(-50).reverse(),
          }
        }
        // #41: latest golden-set accuracy from the #10 eval runner (if it has run
        // and written <DSH_HOME>/jev-harness-eval.json). Includes its timestamp.
        try {
          const evalRaw = fs.readFileSync(path.join(dshHome(), 'jev-harness-eval.json'), 'utf8')
          const evalData = JSON.parse(evalRaw)
          if (evalData && typeof evalData === 'object') {
            report.judgeAccuracy = {
              tierAccuracy: evalData.tierAccuracy ?? null,
              skillAccuracy: evalData.skillAccuracy ?? null,
              cases: evalData.cases ?? null,
              criteriaVersion: evalData.criteriaVersion ?? null,
              at: evalData.at ?? null,
              source: 'golden-set (#10)',
            }
          }
        } catch { /* no eval run yet — judgeAccuracy stays absent */ }
        writeJson(res, 200, report)
      },
    },
    {
      kind: 'exact',
      path: '/api/jev-harness/dsh/catalog',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, LOCAL_ONLY); return }
        if (!bridgeAuthorized(req)) { writeJson(res, 401, { ok: false, error: 'bridge token required' }); return }
        const catalog = dshLlm() === null ? { ok: false, providers: [] } : await dshCatalog()
        const resolved = dshLlm() === null
          ? null
          : { decision: await dshResolve('kimi'), execution: await dshResolve('dsf') }
        writeJson(res, 200, { ok: catalog.ok, catalog, resolved, file: storePath() })
      },
    },
    {
      kind: 'exact',
      path: '/api/jev-harness/dsh/models',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, LOCAL_ONLY); return }
        if (!bridgeAuthorized(req)) { writeJson(res, 401, { ok: false, error: 'bridge token required' }); return }
        if (req.method !== 'GET') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        const url = new URL(req.url || '/', 'http://127.0.0.1')
        const provider = String(url.searchParams.get('provider') || '').trim()
        const llm = dshLlm()
        if (!llm) { writeJson(res, 200, { ok: false, error: 'this Host exposes no llm service', models: [] }); return }
        if (!provider) { writeJson(res, 400, { ok: false, error: 'provider is required', models: [] }); return }
        try {
          const list = await llm.listModels(provider)
          const models = (Array.isArray(list) ? list : []).map((m) => ({
            id: String((m && (m.id || m.model)) || m || ''),
            name: String((m && (m.name || m.displayName)) || (m && m.id) || m || ''),
          })).filter((m) => m.id !== '')
          writeJson(res, 200, { ok: true, provider, models })
        } catch (err) {
          writeJson(res, 200, { ok: false, error: shortError(err), models: [] })
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/jev-harness/test',
      handler: async (req, res) => {
        if (!bridgeAllowed(req)) { writeJson(res, 403, LOCAL_ONLY); return }
        if (!bridgeAuthorized(req)) { writeJson(res, 401, { ok: false, error: 'bridge token required' }); return }
        if (req.method !== 'POST') { writeJson(res, 405, { ok: false, error: 'method not allowed' }); return }
        refresh()
        const results = []
        for (const key of ['jev', 'kimi', 'dsf']) results.push(await probeRoute(key))
        writeJson(res, 200, { ok: results.some(entry => entry.ok), results })
      },
    },
  ]

  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => {
      const server = sctx.get('webServer')
      if (!server || typeof server.register !== 'function') return () => {}
      const disposers = bridgeRoutes.map(route => server.register(route))
      return () => {
        for (const dispose of disposers) {
          try { dispose() } catch { /* best effort during teardown */ }
        }
      }
    }, 'jev-harness: settings bridge')
  })

  /** 默认模型：优先用户当前选择，其次执行层/决策层白名单（永不选 jev）。 */
  async function fallbackBinding() {
    const host = dshDefaultSelection()
    if (host && host.provider && host.model && host.provider !== 'jev') {
      return { key: host.provider, provider: host.provider, model: host.model }
    }
    for (const which of ['dsf', 'kimi']) {
      const binding = await dshResolve(which, { exclude: ['jev'] })
      if (binding && binding.provider && binding.model && binding.provider !== 'jev') return binding
    }
    return null
  }

  /**
   * 注册 `jev/auto` provider（#37）。宿主没有 registerAdapter（或它抛错）时
   * 只退化到 L1 工具，不改其它行为；递归防护与降级都在 adapter 内部。
   */
  function registerJevProvider(providedLlm) {
    const llm = providedLlm || dshLlm()
    if (!llm || typeof llm.registerAdapter !== 'function') return false
    try {
      const adapter = createJevAdapter({
        getConfig: () => cfg,
        llm,
        decide: (task) => decideTier(task),
        resolveBinding: (which, options) => dshResolve(which, options),
        fallbackBinding,
        recordUsage,
        recordDecision,
      })
      ctx.effect(() => {
        const handle = llm.registerAdapter(['jev'], adapter)
        return () => { try { if (typeof handle === 'function') handle() } catch { /* 卸载竞态 */ } }
      }, 'jev-harness: jev/auto provider adapter')
      return true
    } catch (err) {
      try { ctx.logger?.warn?.(`jev-harness: registerAdapter failed, L1 tools only: ${shortError(err)}`) } catch { /* 日志可选 */ }
      return false
    }
  }

  // llm 服务可能与 webServer 分开到达；adapter 只依赖 llm，所以单独等它，
  // headless 宿主（有 llm 无 webServer）也能注册（Verifier 提的限制）。
  ctx.inject(['llm'], (sctx) => {
    registerJevProvider(sctx.get('llm'))
  })

  ctx.effect(() => {
    // #7: 逐个注册、逐个记录。失败不许静默：/status.selfCheck 要能说出「哪个工具没注册上、为什么」。
    const disposers = []
    const toolReport = { ok: true, total: tools.length, registered: [], failures: [] }
    for (const definition of tools) {
      try {
        disposers.push(ctx.tools.register(definition))
        toolReport.registered.push(String(definition && definition.name ? definition.name : 'unknown'))
      } catch (err) {
        toolReport.ok = false
        toolReport.failures.push({
          name: String(definition && definition.name ? definition.name : 'unknown'),
          error: shortError(err),
        })
      }
    }
    reportToolsSelfCheck(toolReport)

    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt) {
      disposers.push(systemPrompt.section({
        name: 'jev-harness:tiers',
        order: 700,
        text: [
          'JEV tiered harness (`jev-harness`) is installed and exposes ONE master switch (top of its settings panel, plus the small JEV switch in the composer). That switch decides who does the work in this session.',
          '',
          'WHILE THE SWITCH IS ON — the harness owns routing for EVERY user instruction in this session:',
          '1. Never answer a substantive instruction with your own model. Route it through `harness_call` with tier=auto.',
          '2. With tier=auto the JEV judge (`jev`) reads the task and returns a tier, then the work runs on Kimi (decision tier, `kimi`) or DeepSeek Flash (execution tier, `dsf`). Relay that returned text as the answer; you may format or trim it, never rewrite its substance or add claims of its own.',
          '3. Never ask the user to choose a tier or a provider. The tier is the JEV judge decision, not a user setting, and the user must not see tier selection anywhere.',
          '4. Do not skip the call because a task looks small or because you could answer it yourself. Only ask the user for clarification when the request itself is ambiguous.',
          '5. DeepSeek Flash is a reasoning model: if a result comes back with empty text and reasoningTokens, retry that call once with a larger maxTokens (600-1200) rather than answering yourself.',
          '',
          'Helper tools: `harness_classify` shows what the JEV judge would decide without executing (diagnostics only); `harness_review` runs a second-model quality gate on a finished draft; `harness_probe` verifies gateway wiring and the real served model ids.',
          'Skills: `harness_call` asks the JEV judge which skill from mattpocock/skills fits the task and mounts that skill instructions into the call (skill="off" skips it, an explicit id such as "engineering/tdd" forces one). `harness_skill` lists the catalog, picks for a task, reads one skill body, refreshes from GitHub, or reports status.',
          '',
          'WHILE THE SWITCH IS OFF — these tools return a note instead of routing. That note means the harness has stepped aside: answer with the DSH model gateway and never retry the harness against it.',
        ].join('\n'),
      }))
    }

    return () => {
      for (const dispose of disposers) {
        try { dispose() } catch { /* best effort during teardown */ }
      }
    }
  })
}
