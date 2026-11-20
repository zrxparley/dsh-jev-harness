/**
 * JEV tiered harness — client half.
 *
 * Adds a real LEFT SIDEBAR ENTRY (a main panel + its sidebar.panellist row) that
 * opens this plugin's own configuration page. The page writes through the host
 * bridge registered by index.js (/api/jev-harness/status | save | test); values
 * land in <DSH_HOME>/jev-harness.json, so no profile patch editing is involved
 * and no restart is needed.
 *
 * The same form is also contributed to the two Plugin-Manager config seats
 * (plugins.bundle.config) so the settings stay reachable
 * from 设置 -> 插件 as well.
 */
/**
 * Which id to register this bundle under (issue #27).
 *
 * DSH's client loader keys factories by the boot-manifest row id, which is the
 * installed package name — '@local/jev-harness' for a local bundle,
 * '@zrxparley/dsh-jev-harness' from npm/tarball. Registering under the other name
 * leaves the manifest row without a factory ("no registered factory"), and the
 * panel silently never mounts. So derive the id from the manifest row that is
 * this plugin, and fall back to the local bundle id when there is no manifest
 * (unit tests, older hosts).
 */
const JEV_BUNDLE_IDS = ['@local/jev-harness', '@zrxparley/dsh-jev-harness']

function jevBundleId(fallback) {
  try {
    const boot = window.__DSH_BOOT__
    const entries = boot && Array.isArray(boot.entries) ? boot.entries : []
    for (const entry of entries) {
      if (!entry || typeof entry.id !== 'string') continue
      const id = entry.id.replace(/\/client$/, '')
      // 只认这两个确切包名：宽后缀匹配会误选第三方 `@other/fake-jev-harness`。
      if (JEV_BUNDLE_IDS.includes(id)) return id
    }
  } catch { /* no manifest: keep the local id */ }
  return fallback
}

window.__ModuleLoader__.load({
  id: jevBundleId('@local/jev-harness'),
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    let react = require('react')

    /* react.createElement, NOT react/jsx-runtime's jsx(): jsx(type, props) takes
     * exactly two arguments (its third is a key), so variadic children are
     * silently dropped and the panel renders as an empty page. createElement
     * accepts children as trailing arguments, which is what the call sites here
     * use — the same helper the in-tree bundles (dsh-im, archive-manager) use. */
    const h = react.createElement

    /* Both package names are claimed so the same client half works installed as
     * a local bundle (@local/...) or from the market (@zrxparley/...). */
    const PACKAGE_KEYS = ['@local/jev-harness', '@zrxparley/dsh-jev-harness']
    const ROW_ID = 'jev-harness'
    const PANEL_ID = 'jev-harness-workbench'   // unique main-panel id for the sidebar entry
    const LOCALE_NS = 'jev-harness'
    const API = '/api/jev-harness'

    const GATEWAYS = [
      {
        key: 'kimi',
        title: 'Kimi · 决策层（由 JEV 自动判定，用户不选）',
        hint: '判断、权衡、评审、架构、风险这类任务走这里。建议 K3.1Pro。',
      },
      {
        key: 'dsf',
        title: 'DeepSeek · 执行层（由 JEV 自动判定，用户不选）',
        hint: '实现、转换、格式化、提取、批量生成这类任务走这里。建议 4.1Flash101。',
      },
      {
        key: 'jev',
        title: 'JEV · 自动判定器（必需，负责每次分流的判决）',
        hint: '留空则用本地关键词启发式判定层级；填了就先问它。',
      },
    ]

    const tierStyles = {
  block: { marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(128,128,128,0.18)' },
  head: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' },
  hint: { fontSize: '12px', opacity: 0.6 },
}

const styles = {
      page: {
        boxSizing: 'border-box', height: '100%', minHeight: 0, overflowY: 'auto',
        padding: '28px clamp(20px,4vw,48px) 48px',
      },
      pageInner: { width: '100%', maxWidth: '880px', margin: '0 auto' },
      pageTitle: { fontSize: '20px', fontWeight: 600, margin: '0 0 6px' },
      pageSub: { fontSize: '13px', opacity: 0.65, margin: '0 0 20px', lineHeight: 1.6 },
      wrap: { display: 'grid', gap: '14px', padding: '2px 0' },
      lead: { margin: 0, fontSize: '13px', lineHeight: 1.6, opacity: 0.75 },
      card: {
        border: '1px solid rgba(127,127,127,.28)',
        borderRadius: '10px',
        padding: '12px 14px',
        display: 'grid',
        gap: '8px',
      },
      head: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
      title: { fontSize: '13px', fontWeight: 600 },
      hint: { fontSize: '12px', opacity: 0.6 },
      row: { display: 'grid', gridTemplateColumns: '92px 1fr', alignItems: 'center', gap: '10px' },
      label: { fontSize: '12px', opacity: 0.7 },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 8px',
        borderRadius: '6px',
        border: '1px solid rgba(127,127,127,.35)',
        background: 'transparent',
        color: 'inherit',
        fontSize: '13px',
        fontFamily: 'inherit',
      },
      actions: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '4px' },
      button: {
        padding: '6px 14px',
        borderRadius: '6px',
        border: '1px solid rgba(127,127,127,.4)',
        background: 'rgba(127,127,127,.12)',
        color: 'inherit',
        fontSize: '13px',
        cursor: 'pointer',
      },
      buttonPrimary: {
        padding: '6px 14px',
        borderRadius: '6px',
        border: '1px solid transparent',
        background: 'rgba(64,132,255,.9)',
        color: '#fff',
        fontSize: '13px',
        cursor: 'pointer',
      },
      note: { fontSize: '12px', lineHeight: 1.6, opacity: 0.7, margin: 0 },
      bad: { fontSize: '12px', lineHeight: 1.6, margin: 0, color: '#e5534b' },
      good: { fontSize: '12px', lineHeight: 1.6, margin: 0, color: '#3fb950' },
      result: { fontSize: '12px', lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' },
      switchCard: {
        border: '1px solid rgba(127,127,127,.28)',
        borderRadius: '10px',
        padding: '14px',
        display: 'grid',
        gap: '10px',
      },
      switchHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' },
      switchTitleRow: { display: 'grid', gap: '3px' },
      switchTitle: { fontSize: '14px', fontWeight: 600 },
      switchState: { fontSize: '12px', opacity: 0.7 },
      switchBody: { fontSize: '12px', lineHeight: 1.65, opacity: 0.72, margin: 0 },
      track: (on) => ({
        position: 'relative',
        width: '52px',
        height: '28px',
        flex: '0 0 auto',
        borderRadius: '999px',
        border: '1px solid ' + (on ? 'transparent' : 'rgba(127,127,127,.45)'),
        background: on ? 'rgba(63,185,80,.85)' : 'rgba(127,127,127,.22)',
        cursor: 'pointer',
        padding: 0,
        transition: 'background .15s ease',
      }),
      knob: (on) => ({
        position: 'absolute',
        top: '3px',
        left: on ? '27px' : '3px',
        width: '20px',
        height: '20px',
        borderRadius: '999px',
        background: '#fff',
        transition: 'left .15s ease',
        boxShadow: '0 1px 3px rgba(0,0,0,.35)',
      }),
    }

    // #26 part 2：桥路由要求 Bearer token。token 由 /token 的 bootstrap 拿到，
    // 只存在内存里，不进 URL、不进 localStorage。
    let bridgeToken = ''
    async function ensureBridgeToken(force) {
      if (bridgeToken && !force) return bridgeToken
      const response = await fetch(`${API}/token`, { method: 'GET', credentials: 'same-origin' })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body || typeof body.token !== 'string' || body.token === '') {
        throw new Error(`bridge token unavailable (HTTP ${response.status})`)
      }
      bridgeToken = body.token
      return bridgeToken
    }

    async function bridgeFetch(path, init) {
      const send = async () => fetch(`${API}${path}`, {
        credentials: 'same-origin',
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(init && init.headers ? init.headers : {}),
          authorization: `Bearer ${await ensureBridgeToken(false)}`,
        },
      })
      let response = await send()
      if (response.status === 401) {
        // 进程重启后 token 会轮换：丢掉旧的、重新 bootstrap 一次再重试。
        await ensureBridgeToken(true)
        response = await send()
      }
      return response
    }

    async function request(path, init) {
      const response = await bridgeFetch(path, init)
      let body = null
      try { body = await response.json() } catch { body = null }
      if (body === null) throw new Error(`HTTP ${response.status}`)
      return body
    }

    function emptyForm() {
      const form = {}
      for (const gateway of GATEWAYS) {
        form[gateway.key] = { baseUrl: '', apiKey: '', model: '', keySet: false }
      }
      return form
    }

    const trafficStyles = {
      grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' },
      tile: {
        border: '1px solid rgba(127,127,127,.28)', borderRadius: '10px',
        padding: '10px 12px', display: 'grid', gap: '2px',
      },
      tileName: { fontSize: '12px', opacity: 0.7, display: 'flex', alignItems: 'center', gap: '6px' },
      tileValue: { fontSize: '21px', fontWeight: 600, lineHeight: 1.15 },
      tileSub: { fontSize: '11px', opacity: 0.62, lineHeight: 1.5 },
      dot: (color) => ({ width: '8px', height: '8px', borderRadius: '50%', background: color, display: 'inline-block', flex: '0 0 auto' }),
      chartBox: { width: '100%', overflow: 'hidden' },
      legend: { display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '11px', opacity: 0.75, alignItems: 'center' },
      recentHead: { display: 'grid', gridTemplateColumns: '62px 56px 82px 54px 58px 1fr', gap: '6px', fontSize: '11px', opacity: 0.55, paddingBottom: '2px' },
      recentRow: { display: 'grid', gridTemplateColumns: '62px 56px 82px 54px 58px 1fr', gap: '6px', fontSize: '11px', padding: '3px 0', borderTop: '1px solid rgba(127,127,127,.14)' },
      chipRow: { display: 'flex', gap: '6px', alignItems: 'center' },
      chip: (on) => ({
        padding: '3px 10px', borderRadius: '999px', fontSize: '11px', cursor: 'pointer',
        border: '1px solid rgba(127,127,127,.35)',
        background: on ? 'rgba(64,132,255,.9)' : 'transparent',
        color: on ? '#fff' : 'inherit',
      }),
    }
    const TRAFFIC_COLORS = { jev: '#a371f7', kimi: '#4084ff', dsf: '#3fb950' }
    const TRAFFIC_NAMES = { jev: 'JEV 判定', kimi: 'Kimi 决策', dsf: 'DSF 执行' }

    /** Hourly buckets for 24h; the same rows collapsed into days for 7d. */
    function trafficRows(data, hours) {
      if (!data || !Array.isArray(data.buckets)) return []
      if (hours <= 48) {
        return data.buckets.map((bucket) => ({ label: bucket.label, sub: bucket.day, gateways: bucket.gateways }))
      }
      const byDay = new Map()
      for (const bucket of data.buckets) {
        const dayKey = String(bucket.key).slice(0, 10)
        if (!byDay.has(dayKey)) {
          const blank = () => ({ calls: 0, tokens: 0, fail: 0 })
          byDay.set(dayKey, { label: bucket.day, gateways: { jev: blank(), kimi: blank(), dsf: blank() } })
        }
        const target = byDay.get(dayKey)
        for (const gateway of ['jev', 'kimi', 'dsf']) {
          const source = bucket.gateways[gateway] || { calls: 0, tokens: 0, fail: 0 }
          target.gateways[gateway].calls += source.calls
          target.gateways[gateway].tokens += source.tokens
          target.gateways[gateway].fail += source.fail
        }
      }
      return [...byDay.values()]
    }

    /** Hand-rolled grouped bar chart: no chart library, one svg. */
    function TrafficChart({ rows }) {
      const width = 720
      const height = 176
      const padTop = 8
      const padBottom = 18
      const plotHeight = height - padTop - padBottom
      if (!rows.length) return h('p', { style: styles.note }, '还没有数据。')
      let peak = 1
      for (const row of rows) {
        for (const gateway of ['jev', 'kimi', 'dsf']) {
          peak = Math.max(peak, (row.gateways[gateway] && row.gateways[gateway].calls) || 0)
        }
      }
      const slot = width / rows.length
      const groupWidth = Math.max(3, slot * 0.74)
      const barWidth = Math.max(1, groupWidth / 3)
      const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio, index) => {
        const y = padTop + plotHeight * ratio
        return h('line', {
          key: `grid${index}`, x1: 0, x2: width, y1: y, y2: y,
          stroke: 'rgba(127,127,127,.18)', strokeWidth: 1,
        })
      })
      const bars = []
      const labels = []
      rows.forEach((row, rowIndex) => {
        const groupStart = rowIndex * slot + (slot - groupWidth) / 2
        ;['jev', 'kimi', 'dsf'].forEach((gateway, gatewayIndex) => {
          const entry = row.gateways[gateway] || { calls: 0, tokens: 0, fail: 0 }
          const barHeight = entry.calls > 0 ? Math.max(2, (entry.calls / peak) * plotHeight) : 0
          if (!barHeight) return
          const x = groupStart + gatewayIndex * barWidth
          const y = padTop + plotHeight - barHeight
          bars.push(h('rect', {
            key: `${rowIndex}-${gateway}`,
            x, y, width: Math.max(1, barWidth - 1), height: barHeight,
            fill: TRAFFIC_COLORS[gateway],
            rx: barWidth > 3 ? 1.5 : 0,
            opacity: entry.fail > 0 ? 0.75 : 1,
          }, h('title', null, `${row.label} · ${TRAFFIC_NAMES[gateway]}: ${entry.calls} 次 / ${entry.tokens} tokens${entry.fail ? ` / ${entry.fail} 次失败` : ''}`)))
        })
        const every = Math.max(1, Math.ceil(rows.length / 8))
        if (rowIndex % every === 0) {
          labels.push(h('text', {
            key: `label${rowIndex}`, x: rowIndex * slot + slot / 2, y: height - 5,
            textAnchor: 'middle', fontSize: 10, fill: 'currentColor', opacity: 0.5,
          }, row.label))
        }
      })
      return h('div', { style: trafficStyles.chartBox },
        h('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height: `${height}px`, role: 'img', 'aria-label': '各网关调用量' },
          ...gridLines, ...bars, ...labels),
      )
    }

    // Stateful wrapper: polls the bridge and hands a pure view its data.
    // The poll is made *visible*: every attempt stamps updatedAt / polls, and a manual
    // refresh button exists, because otherwise a quiet system looks like a frozen UI.
    const POLL_MS = 10000

    /**
     * 纯函数：换窗口（24h↔7d）时如何重置 data/baseline（#15）。
     * payload 为 null 表示「刚切过去、数据还没回来」→ 骨架 + baseline 清空；
     * 数据回来时，新窗口的 baseline 取该窗口的当前总量，因此 delta 恒为 0，
     * 不会凭空冒出「打开后新增 N 次」。
     */
    function trafficWindowState(previous, nextHours, payload) {
      const prev = previous || {}
      const switched = prev.hours !== nextHours
      if (!payload) return { hours: nextHours, data: null, baseline: null, delta: 0 }
      const total = totalCalls(payload)
      const baseline = switched || prev.baseline === null || prev.baseline === undefined ? total : prev.baseline
      return { hours: nextHours, data: payload, baseline, delta: Math.max(0, total - baseline) }
    }

    function TrafficBoard() {
      const [win, setWin] = react.useState({ hours: 24, data: null, baseline: null })
      const [error, setError] = react.useState('')
      const [updatedAt, setUpdatedAt] = react.useState(0)
      const [polls, setPolls] = react.useState(0)
      const [nonce, setNonce] = react.useState(0)
      const { hours, data, baseline } = win

      // 24h ↔ 7d 切换：交给纯函数重置窗口（数据与 baseline 一起清），避免凭空跳数（#15）。
      const setHours = react.useCallback((next) => {
        setWin((previous) => trafficWindowState(previous, next, null))
        setError('')
      }, [])

      react.useEffect(() => {
        let alive = true
        const load = async () => {
          try {
            const res = await bridgeFetch(`/stats?hours=${hours}`, {
              cache: 'no-store',
              headers: { accept: 'application/json' },
            })
            const body = await res.json().catch(() => null)
            if (!alive) return
            setUpdatedAt(Date.now())
            setPolls((n) => n + 1)
            if (res.ok && body && body.ok) {
              setWin((previous) => trafficWindowState(previous, previous.hours, body))
              setError('')
            } else {
              setError((body && body.error) || `HTTP ${res.status}`)
            }
          } catch (err) {
            if (!alive) return
            setUpdatedAt(Date.now())
            setPolls((n) => n + 1)
            setError(String((err && err.message) || err))
          }
        }
        load()
        const timer = setInterval(load, POLL_MS)
        // Coming back to the tab should not wait for the next tick.
        const onVisible = () => { if (typeof document !== 'undefined' && !document.hidden) load() }
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          clearInterval(timer)
          if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
        }
      }, [hours, nonce])

      // #17：空态卡的三个主按钮接真实动作，不做死按钮。
      const emptyAction = async (kind) => {
        try {
          if (kind === 'off') {
            await request('/toggle', { method: 'POST', body: JSON.stringify({ enabled: true }) })
            setNonce((n) => n + 1)
          } else if (kind === 'setup') {
            if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
              const target = document.getElementById('jev-settings')
              if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior: 'smooth' })
            }
          } else {
            await request('/test', { method: 'POST', body: JSON.stringify({}) })
            setNonce((n) => n + 1)
          }
        } catch { /* 失败原因由面板 toast 展示 */ }
      }

      return h(TrafficBoardView, {
        data, hours, error, updatedAt, polls, baseline,
        onRange: setHours,
        onRefresh: () => setNonce((n) => n + 1),
        onAction: emptyAction,
      })
    }

    function totalCalls(payload) {
      const totals = (payload && payload.totals) || {}
      return ['jev', 'kimi', 'dsf'].reduce((sum, gateway) => sum + (((totals[gateway] || {}).calls) || 0), 0)
    }


    // One line that proves the poll is alive: last poll time, poll count, and how many
    // calls arrived since the panel opened (that is what users actually want to see).
    /** 「HH:mm（N 分钟前）」——有历史但本轮没有新调用时的锚点行（#15）。 */
    function lastCallLine(payload) {
      const recent = (payload && Array.isArray(payload.recent)) ? payload.recent : []
      const entry = recent[0]
      if (!entry || !entry.t) return ''
      const at = new Date(entry.t)
      if (Number.isNaN(at.getTime())) return ''
      const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
      const minutes = Math.max(0, Math.round((Date.now() - at.getTime()) / 60000))
      return `最近一次调用 · ${hhmm}（${minutes} 分钟前）`
    }

    function liveLine({ data, rows, updatedAt, polls, baseline }) {
      if (!updatedAt) return `每 ${POLL_MS / 1000} 秒自动刷新 · 正在读取…`
      const clock = new Date(updatedAt).toLocaleTimeString()
      const now = totalCalls(data)
      const delta = baseline === null || baseline === undefined ? null : Math.max(0, now - baseline)
      let fresh = ''
      if (delta !== null && delta > 0) fresh = ` · 打开后新增 ${delta} 次`
      else if (delta !== null) fresh = lastCallLine(data) ? ` · ${lastCallLine(data)}` : ''
      return `更新于 ${clock} · 已刷新 ${polls} 次${fresh} · 每 ${POLL_MS / 1000} 秒自动刷新 · ${rows.length} 个时间桶`
    }

    /** 空态三选一：按宿主 state 分流，unknown 不套卡片（#15）。 */
    function emptyState(data) {
      const state = (data && data.state) || 'ready'
      if (state === 'off') {
        return {
          kind: 'off',
          title: 'JEV 已让位',
          body: '现在的请求由 DSH 模型处理，不会记在这里。打开 JEV 后，经过它的请求才会出现在这里。',
          action: '打开 JEV',
        }
      }
      if (state === 'setup' || state === 'degraded') {
        return {
          kind: 'setup',
          title: '请求还没有发出去',
          body: 'Kimi 或 Flash 的接口地址还没填完整。请先填写；未发出的尝试会记为「未发出」。',
          action: '去填写网关',
        }
      }
      return {
        kind: 'ready',
        title: '还没有调用记录',
        body: '开关已打开。第一条经过 JEV 的请求会出现在这里；如果未发出或没有回答，也会明确标记。',
        action: '测试连通',
      }
    }

    // Pure view over one /stats payload — no fetching, so it is testable.
    function TrafficBoardView({ data, hours, error, onRange, onRefresh, updatedAt, polls, baseline, onAction }) {
      // 首帧/错误态：只要 data 还没回来就只给骨架，绝不显示假的 0 次 / 0 tokens（#15）。
      if (!data) {
        return h('div', { style: styles.card },
          h('div', { style: styles.head },
            h('span', { style: styles.title }, '流量看板'),
            h('span', { style: styles.hint }, '正在读取统计…')),
          h('div', { style: trafficStyles.grid3 },
            ...['jev', 'kimi', 'dsf'].map((gateway) => h('div', { key: gateway, style: trafficStyles.tile },
              h('span', { style: { ...trafficStyles.tileValue, opacity: 0.25 } }, '— — —'),
              h('span', { style: { ...trafficStyles.tileSub, opacity: 0.25 } }, '正在统计'),
            ))),
          h('div', { style: { ...styles.note, opacity: 0.5 } }, '骨架占位：等 /stats 返回后再显示真实数字'),
          error ? h('p', { style: styles.bad }, `统计读取失败：${error}`) : null,
        )
      }

      const rows = trafficRows(data, hours)
      const totals = (data && data.totals) || {}
      const today = (data && data.today) || {}
      const tiles = ['jev', 'kimi', 'dsf'].map((gateway) => {
        const total = totals[gateway] || { calls: 0, ok: 0, fail: 0, tokens: 0, avgMs: 0 }
        const todayEntry = today[gateway] || { calls: 0, fail: 0, tokens: 0 }
        const unanswered = total.unanswered || 0
        const notSent = total.notSent || 0
        const probeCalls = total.probeCalls || 0
        // 成功率只算「真的答出内容」的调用；空正文与未发出都不算成功（#14）。
        const answeredCalls = Math.max(0, total.calls - probeCalls - notSent)
        const answeredOk = Math.max(0, total.ok - unanswered)
        const rate = answeredCalls > 0 ? Math.round((answeredOk / answeredCalls) * 100) : null
        return h('div', { key: gateway, style: trafficStyles.tile },
          h('span', { style: trafficStyles.tileName },
            h('span', { style: trafficStyles.dot(TRAFFIC_COLORS[gateway]) }),
            TRAFFIC_NAMES[gateway]),
          h('span', { style: trafficStyles.tileValue }, `${total.calls} 次`),
          h('span', { style: trafficStyles.tileSub },
            `${total.tokens.toLocaleString()} tokens${rate === null ? '' : ` · 成功率 ${rate}%`}${total.avgMs ? ` · 均 ${total.avgMs}ms` : ''}`),
          unanswered > 0 || notSent > 0
            ? h('span', { style: trafficStyles.tileSub },
              `${unanswered > 0 ? `无回答 ${unanswered}` : ''}${unanswered > 0 && notSent > 0 ? ' · ' : ''}${notSent > 0 ? `未发出 ${notSent}` : ''}`)
            : null,
          h('span', { style: trafficStyles.tileSub }, `今天 ${todayEntry.calls} 次 · ${todayEntry.tokens.toLocaleString()} tokens`),
        )
      })

      const recent = (data && data.recent) || []
      // 账本损坏时后端会带回 warning；这里必须让它可见，不能只在 totals 上显示 0。
      const warning = data && data.warning
      const warningLine = warning
        ? h('p', { style: styles.bad, role: 'alert' },
          `账本损坏：${warning.backup ? `旧文件已隔离为 ${warning.backup}` : '旧文件无法隔离（权限或只读盘）'}，统计从这一刻重新开始。`)
        : null
      const recentHead = h('div', { style: trafficStyles.recentHead },
        h('span', null, '时间'), h('span', null, '网关'), h('span', null, '触发'),
        h('span', null, '结果'), h('span', null, '耗时'), h('span', null, 'tokens'))
      const recentRows = recent.slice(0, 10).map((entry, index) => h('div', { key: `r${index}`, style: trafficStyles.recentRow },
        h('span', { style: { opacity: 0.7 } }, new Date(entry.t).toLocaleTimeString()),
        h('span', null, (entry.g || '').toUpperCase()),
        h('span', { style: { opacity: 0.8 } },
          // #4: on judge rows, show the confidence and the decision source so a
          // user can see not just what fired but how sure the judge was.
          (entry.tool || '') + (typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
            ? ` · ${entry.confidence.toFixed(2)}` : '') + (entry.source ? ` · ${entry.source}` : '')),
        h('span', {
          style: entry.kind === 'no-answer' ? styles.bad : entry.kind === 'not-sent' ? styles.bad : entry.ok ? styles.good : styles.bad,
        }, entry.kind === 'no-answer' ? '无回答' : entry.kind === 'not-sent' ? '未发出' : entry.ok ? 'OK' : 'FAIL'),
        h('span', { style: { opacity: 0.7 } }, entry.ms ? `${entry.ms}ms` : '—'),
        h('span', { style: { opacity: 0.7 } }, `${(entry.pt || 0) + (entry.ct || 0)}`),
      ))

      // 0 调用：三选一空态卡，不画 24 根空柱（#15）。
      if (data && totalCalls(data) === 0) {
        const card = emptyState(data)
        return h('div', { style: styles.card },
          h('div', { style: styles.head },
            h('span', { style: styles.title }, card.title),
            h('span', { style: styles.hint }, liveLine({ data, rows, updatedAt, polls, baseline }))),
          warningLine,
          h('div', { style: trafficStyles.chipRow },
            h('button', { type: 'button', style: trafficStyles.chip(hours === 24), onClick: () => onRange && onRange(24) }, '近 24 小时'),
            h('button', { type: 'button', style: trafficStyles.chip(hours === 168), onClick: () => onRange && onRange(168) }, '近 7 天'),
          ),
          h('p', { style: styles.note }, card.body),
          h('div', { style: styles.actions },
            h('button', { type: 'button', style: styles.button, onClick: () => onAction && onAction(card.kind) }, card.action)),
          error ? h('p', { style: styles.bad }, `统计读取失败：${error}`) : null,
        )
      }

      return h('div', { style: styles.card },
        h('div', { style: styles.head },
          h('span', { style: styles.title }, '流量看板'),
          h('span', { style: styles.hint }, liveLine({ data, rows, updatedAt, polls, baseline })),
        ),
        warningLine,
        h('div', { style: trafficStyles.chipRow },
          h('button', { type: 'button', style: trafficStyles.chip(hours === 24), onClick: () => onRange && onRange(24) }, '近 24 小时'),
          h('button', { type: 'button', style: trafficStyles.chip(hours === 168), onClick: () => onRange && onRange(168) }, '近 7 天'),
          h('button', { type: 'button', style: trafficStyles.chip(false), onClick: () => onRefresh && onRefresh(), title: '立刻拉一次统计，不等下一个 10 秒' }, '立即刷新'),
        ),
        h('div', { style: trafficStyles.grid3 }, ...tiles),
        h(TrafficChart, { rows }),
        h('div', { style: trafficStyles.legend },
          ...['jev', 'kimi', 'dsf'].map((gateway) => h('span', { key: gateway, style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } },
            h('span', { style: trafficStyles.dot(TRAFFIC_COLORS[gateway]) }),
            `${TRAFFIC_NAMES[gateway]}（${(totals[gateway] && totals[gateway].calls) || 0}）`)),
        ),
        error ? h('p', { style: styles.bad }, `统计读取失败：${error}`) : null,
        recent.length ? h('div', null, recentHead, ...recentRows) : null,
        h('p', { style: styles.note },
          '统计口径：每一次真正发往网关的 HTTP 请求记一次（判定 = JEV，决策层 = Kimi，执行层 = DeepSeek Flash），含探测与失败；token 用网关返回的 usage，失败请求记 0。'),
      )
    }

    function HarnessConfig(configProps) {
      const [form, setForm] = react.useState(emptyForm)
      const [file, setFile] = react.useState('')
      const [decisions, setDecisions] = react.useState([])
      const [loading, setLoading] = react.useState(true)
      const [busy, setBusy] = react.useState('')
      const [message, setMessage] = react.useState(null)
      const [results, setResults] = react.useState(null)
      const [enabled, setEnabled] = react.useState(true)
      const [state, setState] = react.useState((configProps && configProps.__initialState) || 'unknown')
      const [skills, setSkills] = react.useState(null)
      const [skillsAuto, setSkillsAuto] = react.useState(true)
      const [followModel, setFollowModel] = react.useState(true)
      const [lowConfThreshold, setLowConfThreshold] = react.useState('0.6')  // #4: judge escalation threshold, editable
      const [routeMode, setRouteMode] = react.useState('dsh')
      const [route, setRoute] = react.useState({
        dshAvailable: false,
        decision: { provider: 'titigate', model: 'kimi-k3.1-pro' },
        execution: { provider: 'titigate', model: 'deepseek-v4.1-flash-1017' },
      })
      const [dshModels, setDshModels] = react.useState({ decision: [], execution: [] })

      const applyStatus = react.useCallback((status) => {
        if (!status || !status.gateways) return
        const next = emptyForm()
        for (const gateway of GATEWAYS) {
          const view = status.gateways[gateway.key] || {}
          next[gateway.key] = {
            baseUrl: view.baseUrl || '',
            apiKey: '',
            model: view.model || '',
            keySet: Boolean(view.keySet),
          }
        }
        setForm(next)
        setEnabled(status.enabled !== false)
        setState(status.state || 'unknown')
        setDecisions(decisionsOf(status))
        if (status.route) {
          setRouteMode(status.route.mode === 'direct' ? 'direct' : 'dsh')
          setRoute({
            dshAvailable: Boolean(status.route.dshAvailable),
            decision: status.route.decision || { provider: '', model: '' },
            execution: status.route.execution || { provider: '', model: '' },
            catalog: status.route.catalog || { ok: false, providers: [] },
            resolved: status.route.resolved || null,
            follow: status.route.follow || null,
            followModel: status.route.followModel !== false,
          })
        }
        setFile(status.file || '')
        if (status.route && status.route.followModel !== undefined) setFollowModel(status.route.followModel !== false)
        if (typeof status.lowConfidenceThreshold === 'number') setLowConfThreshold(String(status.lowConfidenceThreshold))
        if (status.skills) {
          setSkills(status.skills)
          setSkillsAuto(status.skills.auto !== false)
        }
      }, [])

      react.useEffect(() => subscribeBridgeState((next) => {
        applyStatus(next)
        syncModelSeat(next.state === 'ready')
      }), [applyStatus])

      react.useEffect(() => {
        let cancelled = false
        const startSeq = bridgeStateSeqNow()
        request('/status', { method: 'GET' })
          .then((status) => { if (!cancelled) publishIfUnchanged(startSeq, status) })
          .catch((error) => {
            if (cancelled) return
            setState('unknown')
            setMessage({ kind: 'bad', text: `状态未知 · 点击重试（${error.message}）` })
          })
          .then(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
      }, [applyStatus])

      const edit = (key, field) => (event) => {
        const value = event && event.target ? event.target.value : ''
        setForm((previous) => ({ ...previous, [key]: { ...previous[key], [field]: value } }))
      }

      const save = async () => {
        setBusy('save')
        setMessage(null)
        try {
          const payload = {}
          for (const gateway of GATEWAYS) {
            const entry = form[gateway.key]
            payload[gateway.key] = { baseUrl: entry.baseUrl, model: entry.model, apiKey: entry.apiKey }
          }
          payload.routeMode = routeMode
          payload.decision = route.decision
          payload.execution = route.execution
          const status = await request('/save', { method: 'POST', body: JSON.stringify(payload) })
          applyStatus(status)
          setMessage({ kind: status.ok ? 'good' : 'bad', text: status.ok ? '已保存。下一次调用立即生效。' : `保存失败：${status.error || '未知错误'}` })
        } catch (error) {
          setMessage({ kind: 'bad', text: `保存失败：${error.message}` })
        } finally {
          setBusy('')
        }
      }

      const toggle = async (next) => {
        setBusy('toggle')
        setMessage(null)
        const previous = enabled
        setEnabled(next)
        try {
          const status = await setBridgeEnabled(next)
          applyStatus(status)
          syncModelSeat(status.state === 'ready')
          setMessage({
            kind: 'good',
            text: status.state === 'setup'
              ? '已开启，但还差一步：填写 Kimi / DeepSeek 的网关地址后才会真正接管。'
              : next
                ? '已开启：决策/执行任务按 JEV 判定分流到 Kimi / DeepSeek Flash。'
                : '已关闭：插件让位，任务交还给 DSH 自身的模型网关。',
          })
        } catch (error) {
          setEnabled(previous)
          syncModelSeat(state === 'ready')
          setMessage({ kind: 'bad', text: `切换失败：${error.message}。开关就是重试入口，再点一次即可。` })
        } finally {
          setBusy('')
        }
      }

      const toggleFollowModel = async (next) => {
        setBusy('followModel')
        setMessage(null)
        const previous = followModel
        setFollowModel(next)
        try {
          const status = await request('/save', { method: 'POST', body: JSON.stringify({ followModel: next }) })
          applyStatus(status)
          setMessage({
            kind: 'good',
            text: next
              ? '已开启跟随：每次路由成功后，DSH 的模型选择器会切到刚才真正干活的模型。'
              : '已关闭跟随：DSH 的模型选择器保持你手动选的那个，不再变。',
          })
        } catch (error) {
          setFollowModel(previous)
          setMessage({ kind: 'bad', text: `切换失败：${error.message}` })
        } finally {
          setBusy('')
        }
      }

      // #4: persist the judge low-confidence threshold via the existing /save
      // whitelist. Takes effect on the next call (backend re-reads the store).
      const saveThreshold = async () => {
        setMessage(null)
        const value = Number(lowConfThreshold)
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          setMessage({ kind: 'bad', text: '置信度阈值必须是 0 到 1 之间的数字，例如 0.6。' })
          return
        }
        setBusy('lowConfidenceThreshold')
        try {
          const status = await request('/save', { method: 'POST', body: JSON.stringify({ lowConfidenceThreshold: value }) })
          applyStatus(status)
          setMessage({ kind: 'good', text: `已保存：判定置信度低于 ${value} 时自动升级为决策层（Kimi）。下一次调用生效。` })
        } catch (error) {
          setMessage({ kind: 'bad', text: `保存失败：${error.message}` })
        } finally {
          setBusy('')
        }
      }

      const toggleSkillsAuto = async (next) => {
        setBusy('skillsAuto')
        setMessage(null)
        const previous = skillsAuto
        setSkillsAuto(next)
        try {
          const status = await request('/save', { method: 'POST', body: JSON.stringify({ skillsAuto: next }) })
          applyStatus(status)
          setMessage({
            kind: 'good',
            text: next
              ? '已开启自动挂载：每次派活前 JEV 会先挑一个最合适的 mattpocock skill，把它的说明挂进调用里。'
              : '已关闭自动挂载：调用不再附带 skill，路由照常。',
          })
        } catch (error) {
          setSkillsAuto(previous)
          setMessage({ kind: 'bad', text: `切换失败：${error.message}` })
        } finally {
          setBusy('')
        }
      }

      const refreshSkills = async () => {
        setBusy('skillsRefresh')
        setMessage(null)
        try {
          const body = await request('/skills/refresh', { method: 'POST', body: '{}' })
          if (body.status) applyStatus(body.status)
          setMessage({
            kind: body.ok ? 'good' : 'bad',
            text: body.ok
              ? `技能目录已刷新：${body.count} 个（新增 ${body.added}、移除 ${body.removed}）· ${body.repo}@${body.commit}`
              : `刷新失败：${body.error || '未知错误'}`,
          })
        } catch (error) {
          setMessage({ kind: 'bad', text: `刷新失败：${error.message}` })
        } finally {
          setBusy('')
        }
      }

      const test = async () => {
        setBusy('test')
        setMessage(null)
        setResults(null)
        try {
          const body = await request('/test', { method: 'POST', body: '{}' })
          setResults(Array.isArray(body.results) ? body.results : [])
          setMessage({ kind: body.ok ? 'good' : 'bad', text: body.ok ? '至少一个网关可达。' : '没有任何网关可达，请检查地址与密钥。' })
        } catch (error) {
          setMessage({ kind: 'bad', text: `测试失败：${error.message}` })
        } finally {
          setBusy('')
        }
      }

      const cards = GATEWAYS.map((gateway) => {
        const entry = form[gateway.key] || { baseUrl: '', apiKey: '', model: '', keySet: false }
        return h('div', { key: gateway.key, style: styles.card },
          h('div', { style: styles.head },
            h('span', { style: styles.title }, gateway.title),
            h('span', { style: styles.hint }, gateway.hint),
          ),
          h('div', { style: styles.row },
            h('span', { style: styles.label }, 'Base URL'),
            h('input', {
              style: styles.input,
              type: 'text',
              spellCheck: false,
              value: entry.baseUrl,
              placeholder: 'https://gateway.example.com/v1',
              onChange: edit(gateway.key, 'baseUrl'),
            }),
          ),
          h('div', { style: styles.row },
            h('span', { style: styles.label }, 'API Key'),
            h('input', {
              style: styles.input,
              type: 'password',
              autoComplete: 'off',
              spellCheck: false,
              value: entry.apiKey,
              placeholder: entry.keySet ? '已保存（留空 = 不修改）' : '尚未设置',
              onChange: edit(gateway.key, 'apiKey'),
            }),
          ),
          h('div', { style: styles.row },
            h('span', { style: styles.label }, 'Model'),
            h('input', {
              style: styles.input,
              type: 'text',
              spellCheck: false,
              value: entry.model,
              placeholder: gateway.key === 'kimi' ? 'kimi-k3.1-pro' : gateway.key === 'dsf' ? 'deepseek-v4.1-flash-1017' : '（可留空）',
              onChange: edit(gateway.key, 'model'),
            }),
          ),
        )
      })

      // ---- route pickers: the choices come from THIS Host's own model list ----
      const editRoute = (tierKey, field) => (event) => {
        const value = event && event.target ? event.target.value : ''
        setRoute((previous) => {
          const next = { ...previous, [tierKey]: { ...(previous[tierKey] || {}), [field]: value } }
          // switching provider invalidates a model picked under the old one
          if (field === 'provider') next[tierKey].model = ''
          return next
        })
      }
      const providers = (route.catalog && Array.isArray(route.catalog.providers)) ? route.catalog.providers : []
      const resolvedFor = (tierKey) => {
        const resolved = route.resolved || null
        if (!resolved) return null
        return tierKey === 'decision' ? resolved.decision : resolved.execution
      }
      const modelsFor = (tierKey) => {
        const entry = route[tierKey] || {}
        const provider = providers.find((p) => p.id === (entry.provider || ''))
        if (provider) return provider.models || []
        // no explicit provider -> offer everything, grouped by provider in the label
        return providers.flatMap((p) => (p.models || []).map((m) => ({ id: m.id, name: `${p.id} / ${m.name || m.id}` })))
      }
      const refreshCatalog = async () => {
        setBusy('catalog')
        try {
          const body = await request('/dsh/catalog')
          if (!body.ok) throw new Error(body.error || '读取失败')
          setRoute((previous) => ({
            ...previous,
            catalog: body.catalog,
            resolved: body.resolved,
            dshAvailable: Boolean(body.catalog && body.catalog.ok),
          }))
          const total = (body.catalog && body.catalog.providers || []).reduce((n, p) => n + (p.models || []).length, 0)
          setMessage({ kind: 'good', text: `读到 ${(body.catalog && body.catalog.providers || []).length} 个 provider / ${total} 个模型` })
        } catch (error) {
          setMessage({ kind: 'bad', text: `读取 DSH 模型清单失败：${error.message}` })
        } finally { setBusy('') }
      }

      const tierRow = (tierKey, title, hint) => {
        const entry = route[tierKey] || { provider: '', model: '' }
        const models = modelsFor(tierKey)
        const resolved = resolvedFor(tierKey)
        const picked = resolved
          ? `${resolved.provider}/${resolved.model}`
          : '（还没有可用的模型）'
        const auto = !entry.provider && !entry.model
        return h('div', { key: tierKey, style: tierStyles.block },
          h('div', { style: tierStyles.head },
            h('span', { style: styles.label }, title),
            h('span', { style: tierStyles.hint }, hint),
          ),
          h('div', { style: styles.row },
            h('span', { style: styles.label }, 'provider'),
            h('select', {
              style: styles.input,
              value: entry.provider || '',
              onChange: editRoute(tierKey, 'provider'),
            },
              h('option', { value: '' }, '自动（从你的 DSH 网关里挑）'),
              ...providers.map((p) => h('option', { key: p.id, value: p.id },
                `${p.id}${p.name && p.name !== p.id ? ` (${p.name})` : ''} · ${(p.models || []).length} 个模型`)),
            ),
          ),
          h('div', { style: styles.row },
            h('span', { style: styles.label }, 'model'),
            h('select', {
              style: styles.input,
              value: entry.model || '',
              onChange: editRoute(tierKey, 'model'),
            },
              h('option', { value: '' }, entry.provider ? '自动（在这个 provider 里挑）' : '自动（按模型名挑一个合适的）'),
              ...models.map((m) => h('option', { key: m.id, value: m.id },
                `${m.name && m.name !== m.id ? m.name + ' — ' : ''}${m.id}`)),
            ),
          ),
          h('p', { style: auto ? styles.note : styles.good },
            auto
              ? `现在会用到：${picked}${resolved && resolved.auto ? '（自动挑的，可在上面钉住）' : ''}`
              : `现在会用到：${entry.provider}/${entry.model}`),
        )
      }

      const routeCard = h('div', { style: styles.card },
        h('div', { style: styles.cardHead },
          h('span', { style: styles.cardTitle }, '执行方式 · 谁来跑这次调用'),
          h('button', { type: 'button', style: styles.chip, disabled: Boolean(busy), onClick: refreshCatalog },
            busy === 'catalog' ? '读取中…' : '刷新模型清单'),
        ),
        h('div', { style: styles.actions },
          h('button', {
            type: 'button',
            style: { ...styles.chip, ...(routeMode === 'dsh' ? styles.chipOn : null) },
            onClick: () => setRouteMode('dsh'),
          }, '走 DSH 网关（推荐）'),
          h('button', {
            type: 'button',
            style: { ...styles.chip, ...(routeMode === 'direct' ? styles.chipOn : null) },
            onClick: () => setRouteMode('direct'),
          }, '直连本插件网关'),
        ),
        routeMode === 'dsh'
          ? h('div', null,
            h('p', { style: styles.note },
              'JEV 只决定「这活该谁干」；真正跑的时候用你 DSH「模型」里已有的 provider 与密钥，本页的 kimi / dsf 密钥不参与。下面两个下拉里的选项就是你这个 DSH 装出来的模型，别的人装的是别的模型，各自选各自的。'),
            !route.dshAvailable ? h('p', { style: styles.bad }, '这个 Host 没有暴露 llm 服务，无法走 DSH 网关——请改用直连。') : null,
            tierRow('decision', '策略模型（决策层）', '判断、评审、架构、风险'),
            tierRow('execution', '执行模型（执行层）', '实现、改写、抽取、批量生成'),
            h('div', { style: styles.switchHead },
              h('div', { style: styles.switchTitleRow },
                h('span', { style: styles.switchTitle }, '让 DSH 选择器跟随'),
                h('span', { style: styles.switchState },
                  followModel
                    ? '当前：开 — 每次路由成功后，输入框上方那个模型名会切成刚干活的那个'
                    : '当前：关 — 选择器保持你手动选的模型'),
              ),
              h('button', {
                type: 'button',
                role: 'switch',
                'aria-checked': followModel ? 'true' : 'false',
                'aria-label': '让 DSH 模型选择器跟随实际执行的模型',
                title: followModel ? '点击关闭' : '点击开启',
                disabled: Boolean(busy) || loading,
                style: styles.track(followModel),
                onClick: () => toggleFollowModel(!followModel),
              }, h('span', { style: styles.knob(followModel) })),
            ),
            h('div', { style: styles.switchHead },
              h('div', { style: styles.switchTitleRow },
                h('span', { style: styles.switchTitle }, '判定置信度阈值'),
                h('span', { style: styles.switchState }, '低于此置信度的判定自动升级为决策层（Kimi），0–1'),
              ),
              h('span', null,
                h('input', {
                  type: 'number', min: '0', max: '1', step: '0.05',
                  value: lowConfThreshold,
                  'aria-label': '判定置信度阈值',
                  disabled: Boolean(busy) || loading,
                  onChange: (e) => setLowConfThreshold(e.target.value),
                  style: { width: '72px', marginRight: '8px' },
                }),
                h('button', {
                  type: 'button', style: styles.button,
                  disabled: Boolean(busy) || loading,
                  onClick: saveThreshold,
                }, busy === 'lowConfidenceThreshold' ? '保存中…' : '保存阈值'),
              ),
            ),
            route.follow
              ? h('p', { style: styles.note }, `DSH 选择器现在指着：${route.follow.provider}/${route.follow.model}（自动时会优先在这个 provider 里挑）`)
              : null,
            !providers.length
              ? h('p', { style: styles.note }, '还没读到模型清单：点右上角「刷新模型清单」从你的 DSH 网关拉一次。')
              : null,
          )
          : h('p', { style: styles.note },
            '本插件自己用下面的 base URL 与密钥请求网关；DSH 的模型设置不参与。适合 DSH 里没有你要的模型时使用。'),
      )

      const resultLines = results === null ? null : h('div', { style: styles.card },
        h('span', { style: styles.title }, '连通性探测'),
        ...results.map((entry) => h('p', { key: entry.key, style: entry.ok ? styles.good : styles.bad },
          `${entry.key}: ${entry.ok ? 'OK' : 'FAIL'} — ${entry.detail}` +
          (entry.ok && entry.models && entry.models.length
            ? `\n    提供模型：${entry.models.slice(0, 12).join(', ')}`
            : ''),
        )),
      )

      const badge = stateBadge(state)
      const switchCard = h('div', { style: styles.switchCard },
        h('div', { style: styles.switchHead },
          h('div', { style: styles.switchTitleRow },
            h('span', { style: styles.switchTitle }, '总开关'),
            h('span', { style: styles.switchState },
              `${badge.label} — ${badge.hint}`),
          ),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': enabled ? 'true' : 'false',
            'aria-label': '启用或关闭 JEV 分级调度',
            title: enabled ? '点击关闭' : '点击开启',
            disabled: Boolean(busy) || loading,
            style: styles.track(enabled),
            onClick: () => toggle(!enabled),
          }, h('span', { style: styles.knob(enabled) })),
        ),
        h('p', { style: styles.switchBody },
          enabled
            ? '开：派活时把决策/高质量任务交给 Kimi、常规执行交给 DeepSeek Flash。这是路由意图；若某一轮没有经过 JEV，看板与决策卡片会如实标注。'
            : '关：插件完全让位。我会直接用 DSH 自己配置的模型网关完成任务，harness_call 等工具只会返回一条“已关闭”的说明。',
        ),
        state !== 'ready'
          ? h('p', { style: styles.hint }, `JEV 未就绪，模型选择已临时恢复（${badge.label}）`)
          : null,
      )

      const skillsInfo = skills || { count: 0, cached: 0, source: 'bundled', repo: '' }
      const skillsCard = h('div', { style: styles.card },
        h('div', { style: styles.head },
          h('span', { style: styles.title }, '技能库 · mattpocock/skills'),
          h('span', { style: styles.hint },
            `${skillsInfo.count || 0} 个技能 · 已缓存 ${skillsInfo.cached || 0} 个正文 · 目录来源 ${skillsInfo.source === 'refreshed' ? '已刷新' : '随插件内置'}`),
        ),
        h('div', { style: styles.switchHead },
          h('div', { style: styles.switchTitleRow },
            h('span', { style: styles.switchTitle }, '自动挂载 skill'),
            h('span', { style: styles.switchState },
              skillsAuto
                ? '当前：开 — 每次派活前 JEV 先判断该用哪个 skill，再把该 skill 的说明一起发给模型'
                : '当前：关 — 不附带任何 skill，只做分层路由'),
          ),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': skillsAuto ? 'true' : 'false',
            'aria-label': '自动挂载 mattpocock skill',
            title: skillsAuto ? '点击关闭' : '点击开启',
            disabled: Boolean(busy) || loading,
            style: styles.track(skillsAuto),
            onClick: () => toggleSkillsAuto(!skillsAuto),
          }, h('span', { style: styles.knob(skillsAuto) })),
        ),
        h('p', { style: styles.switchBody },
          '候选来自 ',
          h('code', null, 'github.com/mattpocock/skills'),
          ' 的 39 个技能（TDD、code-review、diagnosing-bugs、wayfinder、to-spec 等）。判定用同一个 JEV 判定器，返回 none 就表示这次不需要 skill。',
        ),
        h('div', { style: styles.actions },
          state === 'ready'
            ? h('button', { style: styles.button, disabled: Boolean(busy), onClick: refreshSkills },
              busy === 'skillsRefresh' ? '刷新中…' : '刷新技能目录')
            : null,
        ),
      )

      const decisionsCard = h('div', { style: styles.card },
        h('div', { style: styles.cardHead },
          h('span', { style: styles.cardTitle }, '最近决策 · 谁在干活'),
          h('span', { style: styles.note }, decisions.length ? `最近 ${decisions.length} 条` : ''),
        ),
        decisions.length === 0
          ? h('p', { style: styles.note }, '还没有走过 JEV。开启开关后，每一次判定都会记在这里：判定结果、置信度、实际模型、耗时。')
          : decisions.map((d, i) => {
            const info = decisionDetail(d)
            return h('div', { key: String(d && d.t) + i, style: i === 0 ? tipStyles.rowFirst : tipStyles.row },
              h('div', { style: tipStyles.line1 },
                h('span', { style: tipStyles.dim }, shortClock(info.at)),
                h('span', { style: { ...tipStyles.judge, color: info.tone } }, info.judge),
                h('span', { style: tipStyles.dim }, '→'),
                h('span', null, info.model),
              ),
              info.usage ? h('div', { style: tipStyles.dim }, info.usage) : null,
              info.task ? h('div', { style: tipStyles.task, title: info.task }, info.task) : null,
              info.error ? h('div', { style: { color: '#f85149' } }, info.error) : null,
            )
          }),
      )

      return h('div', { style: styles.wrap },
        switchCard,
        routeCard,
        decisionsCard,
        h(TrafficBoard),
        state === 'setup' ? null : skillsCard,
        h('p', { style: styles.lead },
          '填好分层的网关地址与密钥后点“保存”。这里的值保存在本机文件 ',
          h('code', null, file || '<DSH_HOME>/jev-harness.json'),
          '，不会写进 DSH 的 provider 配置，也不需要重启。',
        ),
        h('div', { id: 'jev-settings' }, ...cards),
        h('div', { style: styles.actions },
          h('button', { style: styles.buttonPrimary, disabled: Boolean(busy) || loading, onClick: save },
            busy === 'save' ? '保存中…' : '保存'),
          h('button', { style: styles.button, disabled: Boolean(busy), onClick: test },
            busy === 'test' ? '探测中…' : '测试连通'),
          loading ? h('span', { style: styles.note }, '读取中…') : null,
        ),
        message === null ? null : h('p', { style: message.kind === 'bad' ? styles.bad : message.kind === 'good' ? styles.good : styles.note }, message.text),
        resultLines,
        h('p', { style: styles.note },
          '模型名要填网关真实提供的 id：不确定就点“测试连通”，探测结果会列出该网关实际提供的模型。',
        ),
      )
    }

    // Full-page body for the sidebar entry: a title plus the same config form.
    function HarnessPage(pageProps) {
      if (pageProps && pageProps.__throwForTest) throw new Error('panel exploded (test seam)')
      return h('div', { style: styles.page },
        h('div', { style: styles.pageInner },
          h('h1', { style: styles.pageTitle }, 'JEV 分级调度 Harness'),
          h('p', { style: styles.pageSub },
            '把决策/高质量任务交给 Kimi、常规执行交给 DeepSeek Flash。在这里填写各网关地址、密钥与真实模型 id。'),
          h(HarnessConfig, null),
        ),
      )
    }

    // A compact tiered-bars icon for the sidebar row.
    function HarnessIcon(ownerProps) {
      const size = ownerProps && typeof ownerProps.size === 'number' ? ownerProps.size : 18
      return h('svg', {
        'aria-hidden': true, focusable: false,
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        h('path', { d: 'M4 6h16' }),
        h('path', { d: 'M4 12h11' }),
        h('path', { d: 'M4 18h6' }),
      )
    }

    function label(ctx, key, fallback) {
      try {
        if (ctx && ctx.locale && typeof ctx.locale.bind === 'function') {
          const t = ctx.locale.bind(LOCALE_NS)
          const value = t && t(key)
          if (typeof value === 'string' && value && value !== key) return value
        }
      } catch { /* locale optional — literal fallback below */ }
      return fallback
    }

    /* ------------------------------------------------------------------ *
     * Composer entry: ONE switch in the input row (conversation.input.left),
     * next to 完全权限 / T专家 / 记忆·智能.
     *
     *   ON  — the harness owns routing: DSH's own model selector is replaced by
     *         a locked badge and work goes to Kimi / DeepSeek Flash.
     *   OFF — the harness steps aside: the normal DSH model gateway is used.
     * ------------------------------------------------------------------ */

    // A single-slot occupant that takes the model selector's seat while the
    // harness is ON, so the DSH model cannot be chosen.
    function ModelLock() {
      return h('span', {
        title: 'JEV 自动分流中：每条指令先由 JEV 判定任务性质，再决定交给 Kimi 还是 DeepSeek Flash —— 无需你选层，DSH 模型也不可选。关闭输入框里的 JEV 开关即可恢复。',
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          padding: '2px 8px', borderRadius: '999px',
          border: '1px solid rgba(63,185,80,.55)', background: 'rgba(63,185,80,.12)',
          fontSize: '12px', lineHeight: 1.2, whiteSpace: 'nowrap',
        },
      },
        h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: '#3fb950', flex: 'none' } }),
        'JEV 自动分流',
      )
    }

    // The composer model selector shows the SESSION selection. agentDefaultModel
    // only changes the default for future Sessions, so a live Session keeps
    // showing its own pick until sessions.selectModel() rewrites it — that is
    // the same call the native selector makes.
    function sessionSelectModel(sessionId, provider, model) {
      try {
        const svc = hostCtx ? hostCtx.get('sessions') : null
        if (!svc || typeof svc.selectModel !== 'function') return Promise.resolve(false)
        return Promise.resolve(svc.selectModel({ sessionId, provider, model }))
          .then((res) => !res || res.ok !== false)
          .catch(() => false)
      } catch { return Promise.resolve(false) }
    }

    // Runtime seat control for that single slot: claim it only while ON.
    const modelSeat = { register: null, release: null }

    // apply() hands its ctx to the factory-scope helpers (the chip is defined here).
    let hostCtx = null

    function syncModelSeat(enabled) {
      try {
        if (enabled) {
          if (!modelSeat.release && typeof modelSeat.register === 'function') {
            const off = modelSeat.register()
            modelSeat.release = typeof off === 'function' ? off : null
          }
        } else if (modelSeat.release) {
          modelSeat.release()
          modelSeat.release = null
        }
      } catch { /* the seat may already be occupied — never break the composer */ }
    }

    /* ------------------------------------------------ decision trace (hover) */

    const tipStyles = {
      wrap: { position: 'relative', display: 'inline-flex' },
      panel: {
        position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 900,
        width: '340px', padding: '10px 12px', borderRadius: '10px',
        background: 'var(--dsw-specific-menu, #1f2126)',
        border: '1px solid rgba(127,127,127,.28)',
        boxShadow: '0 8px 24px rgba(0,0,0,.28)',
        color: 'inherit', fontSize: '12px', lineHeight: 1.5, textAlign: 'left',
      },
      head: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', opacity: 0.75, fontSize: '11px' },
      row: { padding: '6px 0', borderTop: '1px solid rgba(127,127,127,.16)' },
      rowFirst: { padding: '6px 0' },
      line1: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
      judge: { fontWeight: 600 },
      dim: { opacity: 0.62 },
      task: { opacity: 0.55, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      hint: { opacity: 0.62 },
      badge: (color) => ({
        display: 'inline-block', padding: '0 6px', borderRadius: '999px',
        border: '1px solid ' + color, color, fontSize: '10px', lineHeight: '16px',
      }),
    }

    function shortClock(iso) {
      try {
        const d = new Date(iso)
        const pad = (n) => String(n).padStart(2, '0')
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`
      } catch { return '--:--' }
    }

    /** One decision row: who judged, what it chose, who actually answered. */
    function decisionDetail(d) {
      if (!d || typeof d !== 'object') return { judge: '未知', model: '未知', usage: '', tone: '#8b949e' }
      const source = d.source || 'explicit'
      const tierText = d.choice || d.tier || '?'
      let judge
      let tone = '#8b949e'
      if (source === 'jev') {
        const conf = typeof d.confidence === 'number' && Number.isFinite(d.confidence)
          ? ` (${d.confidence.toFixed(2)})`
          : ''
        judge = `JEV 判定 ${tierText}${conf}`
        tone = d.tier === 'decision' ? '#a371f7' : '#3fb950'
      } else if (source === 'heuristic') {
        judge = `启发式 ${tierText}（JEV 未参与）${d.degraded ? ' · 已降级' : ''}`
        tone = '#d29922'
      } else if (source === 'fallback') {
        judge = 'JEV 未参与 · 已降级'
        tone = '#d29922'
      } else {
        judge = `手动指定 ${tierText}`
      }
      if (d.ok === false) tone = '#f85149'
      const model = d.provider ? `${d.provider} · ${d.model || '?'}` : '未调用模型'
      const tokens = (Number(d.pt) || 0) + (Number(d.ct) || 0)
      const usage = [
        `${tokens} tokens`,
        `${d.ms || 0}ms`,
        d.skill ? `skill=${d.skill}` : '',
        d.ok === false ? '调用失败' : '',
      ].filter(Boolean).join(' · ')
      return { judge, model, usage, tone, task: d.task || '', at: d.t, error: d.error || '' }
    }

    function decisionsOf(status) {
      const list = status && Array.isArray(status.decisions) ? status.decisions : []
      return list.slice(0, 3)
    }

    function DecisionTip({ decisions }) {
      const rows = decisions.length === 0
        ? [h('div', { key: 'empty', style: tipStyles.hint },
            '还没有走过 JEV：开启后每次判定都会记在这里（判定 / 置信度 / 实际模型 / 耗时）。')]
        : decisions.map((d, i) => {
          const info = decisionDetail(d)
          return h('div', { key: String(d && d.t) + i, style: i === 0 ? tipStyles.rowFirst : tipStyles.row },
            h('div', { style: tipStyles.line1 },
              h('span', { style: tipStyles.dim }, shortClock(info.at)),
              h('span', { style: { ...tipStyles.judge, color: info.tone } }, info.judge),
              h('span', { style: tipStyles.dim }, '→'),
              h('span', null, info.model),
            ),
            info.usage ? h('div', { style: tipStyles.dim }, info.usage) : null,
            info.task ? h('div', { style: tipStyles.task, title: info.task }, info.task) : null,
            info.error ? h('div', { style: { color: '#f85149' } }, info.error) : null,
          )
        })
      return h('div', { style: { ...tipStyles.panel, pointerEvents: 'none' }, role: 'tooltip', 'aria-label': '最近决策' },
        h('div', { style: tipStyles.head },
          h('span', null, '最近决策 · 谁在干活'),
          h('span', { style: { marginLeft: 'auto' } }, decisions.length ? `最近 ${decisions.length} 条` : ''),
        ),
        rows,
      )
    }

    // #13：状态由宿主 /status 的 state 决定，客户端只负责渲染，不再从 enabled 推断。
    /**
     * 开关状态广播（#17）：插件卡与侧栏面板共享同一个 state。
     * 任何一处 toggle 成功都立刻 publish，订阅方在同一 tick 内更新，
     * 不再等 10 秒轮询。轮询仍然保留，用于发现别处（例如另一个窗口）的改动。
     */
    const bridgeStateListeners = new Set()
    let bridgeStateSnapshot = null
    let bridgeStateSeq = 0

    function bridgeStateSeqNow() {
      return bridgeStateSeq
    }

    function publishBridgeState(status) {
      bridgeStateSeq += 1
      bridgeStateSnapshot = { seq: bridgeStateSeq, status }
      for (const listener of [...bridgeStateListeners]) {
        try { listener(status) } catch { /* 单个订阅者失败不影响其它入口 */ }
      }
      return bridgeStateSeq
    }

    /**
     * 轮询回来的状态只有在「发请求之后没有任何更新的 publish」时才生效（#17 竞态）。
     * 否则用户刚在插件卡关掉的开关，会被一个更早发出的 /status 响应顶回去。
     */
    function publishIfUnchanged(startSeq, status) {
      if (bridgeStateSeq !== startSeq) return false
      publishBridgeState(status)
      return true
    }

    function subscribeBridgeState(listener) {
      bridgeStateListeners.add(listener)
      if (bridgeStateSnapshot) {
        try { listener(bridgeStateSnapshot.status) } catch { /* 首次回放失败忽略 */ }
      }
      return () => { bridgeStateListeners.delete(listener) }
    }

    async function setBridgeEnabled(next) {
      const status = await request('/toggle', { method: 'POST', body: JSON.stringify({ enabled: next }) })
      publishBridgeState(status)
      return status
    }

    function stateBadge(state) {
      switch (state) {
        case 'ready': return { label: 'JEV 接管中', hint: 'Kimi 判断 / Flash 执行', color: '#3fb950' }
        case 'setup': return { label: 'JEV 还差一步', hint: '填写网关地址', color: '#d29922' }
        case 'off': return { label: 'JEV 已让位', hint: '由 DSH 模型处理', color: 'rgba(127,127,127,.9)' }
        case 'degraded': return { label: 'JEV 异常', hint: '最近一次调用失败', color: '#f85149' }
        default: return { label: '状态未知', hint: '点击重试', color: 'rgba(127,127,127,.65)' }
      }
    }

    /**
     * 选择器要不要跟着「实际干活的模型」走（#37）。
     * 当用户选的是 `jev/auto` 时绝不能回写 sessions.selectModel：一旦回写，
     * 第二轮就绕过了 adapter。判定来源与真实模型只在面板/账本里展示。
     */
    function shouldFollowDecision(next) {
      if (!next) return false
      const route = next.route || {}
      if (route.mode !== 'dsh' || route.followModel === false) return false
      const follow = route.follow
      if (follow && follow.provider === 'jev') return false
      const decision = decisionsOf(next)[0]
      const host = decision && decision.host
      return Boolean(host && host.provider && host.model)
    }

    function ComposerChip(props) {
      const sessionId = props && props.sessionId
      const appliedRef = react.useRef('')
      const [status, setStatus] = react.useState(null)
      const [busy, setBusy] = react.useState(false)
      const [hover, setHover] = react.useState(false)
      // null = not read yet; 'unknown' = read failed. Both keep the model seat free.
      const state = status === null ? null : (status.state || 'unknown')
      const badge = stateBadge(state)
      const enabled = state === null ? null : state !== 'off'
      const decisions = decisionsOf(status)

      // Once a decision has been made, move the Session selector onto the model
      // that actually did the work, so the composer shows the real name.
      const followDecision = react.useCallback((next) => {
        try {
          if (!sessionId) return
          if (!shouldFollowDecision(next)) return
          const d = decisionsOf(next)[0]
          const host = d && d.host
          if (!host || !host.provider || !host.model) return
          const key = String(d.t) + '|' + host.provider + '/' + host.model
          if (appliedRef.current === key) return
          appliedRef.current = key
          sessionSelectModel(sessionId, host.provider, host.model)
        } catch { /* selector sync is cosmetic — never break the composer */ }
      }, [sessionId])

      const load = react.useCallback(() => {
        const startSeq = bridgeStateSeqNow()
        request('/status', { method: 'GET' })
          .then((next) => {
            // 请求期间若已有更新的状态（例如刚 toggle），这次响应就是旧的，丢掉。
            if (!publishIfUnchanged(startSeq, next)) return
            // 只有 ready 才占模型座；setup/off/unknown 都释放（#13）。
            syncModelSeat(next.state === 'ready')
            followDecision(next)
          })
          .catch(() => { setStatus({ state: 'unknown' }); syncModelSeat(false) })
      }, [followDecision])

      react.useEffect(() => subscribeBridgeState((next) => {
        setStatus(next)
        syncModelSeat(next.state === 'ready')
        followDecision(next)
      }), [followDecision])

      react.useEffect(() => { load() }, [load])

      const toggle = async () => {
        if (busy) return
        if (state === null || state === 'unknown') { load(); return }
        setBusy(true)
        const next = !enabled
        try {
          const confirmed = await setBridgeEnabled(next)
          setStatus(confirmed)
          syncModelSeat(confirmed.state === 'ready')
        } catch (error) {
          // 失败要留下原因，并把「再点一次」作为重试入口（#13）。
          setStatus({ ...(status || {}), state, toggleError: String((error && error.message) || error) })
          syncModelSeat(state === 'ready')
        } finally {
          setBusy(false)
        }
      }

      const toggleError = status && status.toggleError
      const title = state === null
        ? 'JEV 分级调度：正在读取状态…（悬停可看最近决策）'
        : `${badge.label} · ${badge.hint}${toggleError ? `\n上次切换失败：${toggleError}——点击重试` : ''}`

      const on = state === 'ready'
      const button = h('button', {
        type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        'aria-label': state === null
          ? 'JEV 分级调度状态读取中'
          : state === 'unknown'
            ? '状态未知，点击重试'
            : `${badge.label}，点击${enabled ? '关闭' : '开启'}`,
        disabled: busy,
        onClick: toggle,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '2px 8px 2px 6px', borderRadius: '999px',
          cursor: busy ? 'default' : 'pointer',
          border: '1px solid ' + (on ? 'rgba(63,185,80,.55)' : 'rgba(127,127,127,.4)'),
          background: on ? 'rgba(63,185,80,.12)' : 'transparent',
          color: 'inherit', fontSize: '12px', fontFamily: 'inherit', lineHeight: 1.2,
          opacity: on ? 1 : 0.72,
        },
      },
        h('span', {
          style: { ...styles.track(on), width: '28px', height: '16px', border: 'none' },
        }, h('span', {
          style: { ...styles.knob(on), width: '10px', height: '10px', top: '3px', left: on ? '15px' : '3px' },
        })),
        state === null ? 'JEV' : badge.label,
      )

      return h('span', {
        style: tipStyles.wrap,
        onMouseEnter: () => { setHover(true); load() },
        onMouseLeave: () => setHover(false),
      },
        button,
        hover ? h(DecisionTip, { decisions }) : null,
      )
    }

    /**
     * 面板错误边界（#16）：任何组件抛错都出一张可恢复的卡片，而不是白屏。
     * 诊断信息包含版本、/status 与 /stats 可用性、最近错误与 slot 注册结果。
     */
    class PanelBoundary extends react.Component {
      constructor(props) {
        super(props)
        this.state = { error: null, diag: null, copied: '' }
        this.reload = this.reload.bind(this)
        this.copyDiagnostics = this.copyDiagnostics.bind(this)
      }

      static getDerivedStateFromError(error) {
        return { error: error || new Error('unknown render error') }
      }

      componentDidCatch(error, info) {
        this.setState({
          diag: {
            message: String((error && error.message) || error),
            componentStack: String((info && info.componentStack) || '').slice(0, 800),
          },
        })
        this.loadDiagnostics()
      }

      async loadDiagnostics() {
        const next = { ...(this.state.diag || {}) }
        try {
          const status = await request('/status', { method: 'GET' })
          next.version = status.version || '未提供'
          next.state = status.state || 'unknown'
          next.status = 'ok'
        } catch (error) {
          next.status = `fail: ${String((error && error.message) || error)}`
          next.version = next.version || '未提供'
        }
        try {
          await request('/stats?hours=24', { method: 'GET' })
          next.stats = 'ok'
        } catch (error) {
          next.stats = `fail: ${String((error && error.message) || error)}`
        }
        next.slots = Array.isArray(globalThis.__jevSlotLog) ? globalThis.__jevSlotLog.slice(0, 12) : []
        this.setState({ diag: next })
        return next
      }

      reload() {
        const next = { error: null, diag: null, copied: '' }
        this.setState(next)
        return next
      }

      async copyDiagnostics() {
        const text = JSON.stringify({ error: String((this.state.error && this.state.error.message) || ''), ...(this.state.diag || {}) }, null, 2)
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text)
          }
          this.setState({ copied: '诊断信息已复制' })
        } catch {
          this.setState({ copied: '复制失败，请手动选中诊断信息' })
        }
        return text
      }

      render() {
        if (!this.state.error) return this.props.children
        const diag = this.state.diag || {}
        return h('div', { style: styles.card, role: 'alert' },
          h('div', { style: styles.head },
            h('span', { style: styles.title }, '面板加载失败'),
            h('span', { style: styles.hint }, `版本：${diag.version || '读取中…'}`)),
          h('p', { style: styles.switchBody }, '面板渲染时抛错，插件其余部分不受影响；可以先重载面板，或复制诊断信息排查。'),
          h('p', { style: styles.note }, `最近错误：${diag.message || String((this.state.error && this.state.error.message) || '')}`),
          h('p', { style: styles.note }, `状态接口：${diag.status || '检查中'} · 统计接口：${diag.stats || '检查中'}`),
          h('p', { style: styles.note }, `slot 注册：${(diag.slots && diag.slots.length ? diag.slots.join(', ') : '未记录')}`),
          h('div', { style: styles.actions },
            h('button', { type: 'button', style: styles.button, onClick: this.reload }, '重新加载面板'),
            h('button', { type: 'button', style: styles.button, onClick: this.copyDiagnostics }, '复制诊断信息')),
          this.state.copied ? h('p', { style: styles.hint }, this.state.copied) : null,
        )
      }
    }

    function withBoundary(component) {
      return function SlotWithBoundary(props) {
        return h(PanelBoundary, null, h(component, props))
      }
    }

    /** 打开侧栏主面板（#17）。缺 layout 服务时返回 false，不做假的成功。 */
    function openPanel() {
      try {
        const layout = hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('layout') : null
        if (layout && typeof layout.selectPanel === 'function') {
          layout.selectPanel(PANEL_ID)
          return true
        }
      } catch { /* 旧宿主没有 layout 服务 */ }
      return false
    }

    /**
     * 设置 → 插件卡（#17）：只放状态卡 + 一个「打开 JEV 面板」+ 总开关。
     * 完整表单只在侧栏主面板里出现一次，这里绝不内嵌。
     */
    function SettingsSeat() {
      const [status, setStatus] = react.useState(null)
      const [busy, setBusy] = react.useState(false)
      const state = status === null ? 'unknown' : (status.state || 'unknown')
      const badge = stateBadge(state)

      react.useEffect(() => subscribeBridgeState((next) => setStatus(next)), [])

      react.useEffect(() => {
        let alive = true
        const startSeq = bridgeStateSeqNow()
        request('/status', { method: 'GET' }).then((next) => {
          if (!alive) return
          publishIfUnchanged(startSeq, next)
        }).catch(() => {})
        return () => { alive = false }
      }, [])

      const toggle = async () => {
        if (busy) return
        setBusy(true)
        try {
          const next = await setBridgeEnabled(state === 'off')
          setStatus(next)
        } catch { /* 主面板会显示失败原因；卡片只做入口 */ } finally {
          setBusy(false)
        }
      }

      return h('div', { style: styles.card },
        h('div', { style: styles.head },
          h('span', { style: styles.title }, 'JEV 分级调度'),
          h('span', { style: styles.hint }, `${badge.label} · ${badge.hint}`)),
        h('p', { style: styles.switchBody }, '完整设置（网关、密钥、模型 id、技能库）都在侧栏的 JEV 面板里，这里只保留入口与总开关。'),
        h('div', { style: styles.actions },
          h('button', { type: 'button', style: styles.button, onClick: () => openPanel() }, '打开 JEV 面板'),
          h('button', {
            type: 'button', role: 'switch', 'aria-checked': state !== 'off' ? 'true' : 'false',
            'aria-label': '启用或关闭 JEV 分级调度', disabled: busy,
            onClick: toggle,
          }, state === 'off' ? '打开 JEV' : '关闭 JEV')),
      )
    }

    function renderConfigSeat() {
      return h(PanelBoundary, null, h(SettingsSeat, null))
    }

    function apply(ctx) {
      hostCtx = ctx
      const disposers = []
      // 诊断用：记录本插件注册过的 slot（错误卡片会展示，见 PanelBoundary）。
      const slotLog = []
      try { globalThis.__jevSlotLog = slotLog } catch { /* 只读环境 */ }
      const registerSlot = (def, comp) => {
        try { slotLog.push(def && def.name ? def.name : 'unknown') } catch { /* 诊断可缺 */ }
        return ctx.slots.register(def, comp)
      }

      // 1) Real left-sidebar entry: a main panel + its matching sidebar row.
      // Both must be registered together (layout.selectPanel throws if the main
      // key is missing). Pattern mirrors dsh-im / dsh-archive-manager.
      disposers.push(ctx.slots.inject('main', () => {
        const off = registerSlot(
          { name: 'main', key: PANEL_ID, locale: LOCALE_NS, inject: () => ({}) },
          withBoundary(HarnessPage),
        )
        return typeof off === 'function' ? off : () => {}
      }))
      disposers.push(ctx.slots.inject('sidebar.panellist', () => {
        const off = registerSlot(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 12,
            label: () => label(ctx, 'jev.panel', 'JEV 分级调度'),
            locale: LOCALE_NS,
          },
          HarnessIcon,
        )
        return typeof off === 'function' ? off : () => {}
      }))

      // 2) Composer entry: ONE JEV switch inside the input row.
      try {
        disposers.push(ctx.slots.inject('conversation.input.left', () => {
          const off = registerSlot(
            { name: 'conversation.input.left', id: LOCALE_NS, order: 30, inject: (sessionId) => ({ sessionId }) },
            ComposerChip,
          )
          return typeof off === 'function' ? off : () => {}
        }))
      } catch { /* older shells without the composer slot keep the panel only */ }

      // 2b) While the switch is ON, claim the single-occupant model-selector
      // seat so the DSH model cannot be chosen. The seat is released again the
      // moment the switch goes OFF.
      try {
        ctx.slots.inject('conversation.input.model', () => {
          modelSeat.register = () => registerSlot(
            { name: 'conversation.input.model', id: LOCALE_NS, order: 0 },
            ModelLock,
          )
          // Initial state comes from the host, but the composer switch is the
          // authority once it renders; fail quiet if the request cannot be made.
          request('/status', { method: 'GET' })
            .then((status) => syncModelSeat(status.state === 'ready'))
            .catch(() => { syncModelSeat(false) })
          return () => { if (modelSeat.release) { try { modelSeat.release() } catch { /* teardown */ } ; modelSeat.release = null } }
        })
      } catch { /* the seat may not exist in this shell */ }

      // 3) Keep the Plugin-Manager config seats reachable too.
      // 二选一：只保留 bundle 级配置卡（#17）。行级卡不再注册，避免同屏多个入口。
      for (const pkg of PACKAGE_KEYS) {
        disposers.push(ctx.slots.inject('plugins.bundle.config', () => registerSlot(
          { name: 'plugins.bundle.config', key: pkg },
          renderConfigSeat,
        )))
      }

      return () => {
        for (const dispose of disposers) {
          try { if (typeof dispose === 'function') dispose() } catch { /* teardown */ }
        }
      }
    }

    const inject = ['slots', 'locale', 'layout']

    exports.apply = apply
    exports.inject = inject
    // Test-only seam: lets the offline regression suite render individual pieces
    // without mounting the whole panel. Not used by the host.
    exports.__test = { TrafficBoard, TrafficBoardView, TrafficChart, trafficRows, liveLine, totalCalls, lastCallLine, emptyState, trafficWindowState, PanelBoundary, HarnessPage, HarnessConfig, SettingsSeat, openPanel, shouldFollowDecision, publishBridgeState, publishIfUnchanged, bridgeStateSeqNow, subscribeBridgeState, setBridgeEnabled, HarnessConfig, ComposerChip, ModelLock, DecisionTip, decisionDetail, decisionsOf, stateBadge }
    return module.exports
  },
})
