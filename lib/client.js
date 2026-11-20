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
 * (plugins.bundle.config / plugins.row.config) so the settings stay reachable
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

    function TrafficBoard() {
      const [data, setData] = react.useState(null)
      const [hours, setHours] = react.useState(24)
      const [error, setError] = react.useState('')
      const [updatedAt, setUpdatedAt] = react.useState(0)
      const [polls, setPolls] = react.useState(0)
      const [baseline, setBaseline] = react.useState(null)
      const [nonce, setNonce] = react.useState(0)

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
              setData(body)
              setError('')
              setBaseline((previous) => previous === null ? totalCalls(body) : previous)
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

      return h(TrafficBoardView, {
        data, hours, error, updatedAt, polls, baseline,
        onRange: setHours,
        onRefresh: () => setNonce((n) => n + 1),
      })
    }

    function totalCalls(payload) {
      const totals = (payload && payload.totals) || {}
      return ['jev', 'kimi', 'dsf'].reduce((sum, gateway) => sum + (((totals[gateway] || {}).calls) || 0), 0)
    }


    // One line that proves the poll is alive: last poll time, poll count, and how many
    // calls arrived since the panel opened (that is what users actually want to see).
    function liveLine({ data, rows, updatedAt, polls, baseline }) {
      if (!updatedAt) return `每 ${POLL_MS / 1000} 秒自动刷新 · 正在读取…`
      const clock = new Date(updatedAt).toLocaleTimeString()
      const now = totalCalls(data)
      const delta = baseline === null || baseline === undefined ? null : Math.max(0, now - baseline)
      const fresh = delta === null ? '' : delta > 0 ? ` · 打开后新增 ${delta} 次` : ' · 打开后暂无新调用'
      return `更新于 ${clock} · 已刷新 ${polls} 次${fresh} · 每 ${POLL_MS / 1000} 秒自动刷新 · ${rows.length} 个时间桶`
    }

    // Pure view over one /stats payload — no fetching, so it is testable.
    function TrafficBoardView({ data, hours, error, onRange, onRefresh, updatedAt, polls, baseline }) {
      const rows = trafficRows(data, hours)
      const totals = (data && data.totals) || {}
      const today = (data && data.today) || {}
      const tiles = ['jev', 'kimi', 'dsf'].map((gateway) => {
        const total = totals[gateway] || { calls: 0, ok: 0, fail: 0, tokens: 0, avgMs: 0 }
        const todayEntry = today[gateway] || { calls: 0, fail: 0, tokens: 0 }
        const rate = total.calls > 0 ? Math.round((total.ok / total.calls) * 100) : null
        return h('div', { key: gateway, style: trafficStyles.tile },
          h('span', { style: trafficStyles.tileName },
            h('span', { style: trafficStyles.dot(TRAFFIC_COLORS[gateway]) }),
            TRAFFIC_NAMES[gateway]),
          h('span', { style: trafficStyles.tileValue }, `${total.calls} 次`),
          h('span', { style: trafficStyles.tileSub },
            `${total.tokens.toLocaleString()} tokens${rate === null ? '' : ` · 成功率 ${rate}%`}${total.avgMs ? ` · 均 ${total.avgMs}ms` : ''}`),
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
        h('span', { style: { opacity: 0.8 } }, entry.tool || ''),
        h('span', { style: entry.ok ? styles.good : styles.bad }, entry.ok ? 'OK' : 'FAIL'),
        h('span', { style: { opacity: 0.7 } }, entry.ms ? `${entry.ms}ms` : '—'),
        h('span', { style: { opacity: 0.7 } }, `${(entry.pt || 0) + (entry.ct || 0)}`),
      ))

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
        recent.length ? h('div', null, recentHead, ...recentRows) : h('p', { style: styles.note }, '还没有调用记录。开关打开后，任何一次 harness_call / 判定 / 探测都会记在这里。'),
        h('p', { style: styles.note },
          '统计口径：每一次真正发往网关的 HTTP 请求记一次（判定 = JEV，决策层 = Kimi，执行层 = DeepSeek Flash），含探测与失败；token 用网关返回的 usage，失败请求记 0。'),
      )
    }

    function HarnessConfig() {
      const [form, setForm] = react.useState(emptyForm)
      const [file, setFile] = react.useState('')
      const [decisions, setDecisions] = react.useState([])
      const [loading, setLoading] = react.useState(true)
      const [busy, setBusy] = react.useState('')
      const [message, setMessage] = react.useState(null)
      const [results, setResults] = react.useState(null)
      const [enabled, setEnabled] = react.useState(true)
      const [skills, setSkills] = react.useState(null)
      const [skillsAuto, setSkillsAuto] = react.useState(true)
      const [followModel, setFollowModel] = react.useState(true)
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
        if (status.skills) {
          setSkills(status.skills)
          setSkillsAuto(status.skills.auto !== false)
        }
      }, [])

      react.useEffect(() => {
        let cancelled = false
        request('/status', { method: 'GET' })
          .then((status) => { if (!cancelled) applyStatus(status) })
          .catch((error) => { if (!cancelled) setMessage({ kind: 'bad', text: `读取设置失败：${error.message}` }) })
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
          const status = await request('/toggle', { method: 'POST', body: JSON.stringify({ enabled: next }) })
          applyStatus(status)
          setMessage({
            kind: 'good',
            text: next
              ? '已开启：决策/执行任务走 Kimi / DeepSeek Flash，不再走 DSH 的模型网关。'
              : '已关闭：插件不再参与路由，任务交还给 DSH 自身的模型网关。',
          })
        } catch (error) {
          setEnabled(previous)
          setMessage({ kind: 'bad', text: `切换失败：${error.message}` })
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

      const switchCard = h('div', { style: styles.switchCard },
        h('div', { style: styles.switchHead },
          h('div', { style: styles.switchTitleRow },
            h('span', { style: styles.switchTitle }, '总开关'),
            h('span', { style: styles.switchState },
              enabled ? '当前：开 — 本会话每条指令都先交给 JEV 判定，再自动分流到 Kimi 或 DeepSeek Flash' : '当前：关 — 插件不参与，走 DSH 自身的模型网关'),
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
            ? '开：我派活时会把决策/高质量任务发给 Kimi、常规执行发给 DeepSeek Flash，不经过 DSH 的模型网关。'
            : '关：插件完全让位。我会直接用 DSH 自己配置的模型网关完成任务，harness_call 等工具只会返回一条“已关闭”的说明。',
        ),
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
          h('button', { style: styles.button, disabled: Boolean(busy), onClick: refreshSkills },
            busy === 'skillsRefresh' ? '刷新中…' : '刷新技能目录'),
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
        skillsCard,
        h('p', { style: styles.lead },
          '填好分层的网关地址与密钥后点“保存”。这里的值保存在本机文件 ',
          h('code', null, file || '<DSH_HOME>/jev-harness.json'),
          '，不会写进 DSH 的 provider 配置，也不需要重启。',
        ),
        ...cards,
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
    function HarnessPage() {
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
        judge = `启发式 ${tierText}（JEV 未参与）`
      } else {
        judge = `手动指定 ${tierText}`
      }
      const model = d.provider ? `${d.provider} · ${d.model || '?'}` : '未调用模型'
      const tokens = (Number(d.pt) || 0) + (Number(d.ct) || 0)
      const usage = [
        `${tokens} tokens`,
        `${d.ms || 0}ms`,
        d.skill ? `skill=${d.skill}` : '',
        d.ok === false ? '失败' : '',
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

    function ComposerChip(props) {
      const sessionId = props && props.sessionId
      const appliedRef = react.useRef('')
      const [status, setStatus] = react.useState(null)
      const [busy, setBusy] = react.useState(false)
      const [hover, setHover] = react.useState(false)
      // null = not read yet, so the switch never claims a state it has not seen.
      const enabled = status === null ? null : status.enabled !== false
      const decisions = decisionsOf(status)

      // Once a decision has been made, move the Session selector onto the model
      // that actually did the work, so the composer shows the real name.
      const followDecision = react.useCallback((next) => {
        try {
          if (!sessionId || !next) return
          const route = next.route || {}
          if (route.mode !== 'dsh' || route.followModel === false) return
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
        request('/status', { method: 'GET' })
          .then((next) => { setStatus(next); syncModelSeat(next.enabled !== false); followDecision(next) })
          .catch(() => setStatus({ enabled: false }))
      }, [followDecision])

      react.useEffect(() => { load() }, [load])

      const toggle = async () => {
        if (busy) return
        if (enabled === null) { load(); return }
        setBusy(true)
        const next = !enabled
        setStatus({ enabled: next, decisions })
        syncModelSeat(next)
        try {
          const confirmed = await request('/toggle', { method: 'POST', body: JSON.stringify({ enabled: next }) })
          setStatus(confirmed)
          syncModelSeat(confirmed.enabled !== false)
        } catch {
          setStatus({ enabled, decisions })
          syncModelSeat(enabled)
        } finally {
          setBusy(false)
        }
      }

      const title = enabled === null
        ? 'JEV 分级调度：正在读取状态…（悬停可看最近决策）'
        : enabled
          ? '已开启：接下来必须走 JEV（Kimi 决策 / Flash 执行）。悬停查看最近决策，点击关闭。'
          : '已关闭：走 DSH 自身的模型网关。悬停查看最近决策，点击开启。'

      const on = enabled === true
      const button = h('button', {
        type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        'aria-label': enabled === null
          ? 'JEV 分级调度状态读取中'
          : on ? 'JEV 分级调度已开启，点击关闭' : 'JEV 分级调度已关闭，点击开启',
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
        enabled === null ? 'JEV' : on ? 'JEV 开' : 'JEV 关',
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

    function renderConfigSeat(slotProps) {
      if (slotProps && slotProps.view === 'summary') {
        return h('span', { style: { fontSize: '12px', opacity: 0.7 } },
          'JEV 判定 · Kimi/Flash 自动分流 · 可在此填写网关与密钥')
      }
      return h(HarnessConfig, null)
    }

    function apply(ctx) {
      hostCtx = ctx
      const disposers = []

      // 1) Real left-sidebar entry: a main panel + its matching sidebar row.
      // Both must be registered together (layout.selectPanel throws if the main
      // key is missing). Pattern mirrors dsh-im / dsh-archive-manager.
      disposers.push(ctx.slots.inject('main', () => {
        const off = ctx.slots.register(
          { name: 'main', key: PANEL_ID, locale: LOCALE_NS, inject: () => ({}) },
          HarnessPage,
        )
        return typeof off === 'function' ? off : () => {}
      }))
      disposers.push(ctx.slots.inject('sidebar.panellist', () => {
        const off = ctx.slots.register(
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
          const off = ctx.slots.register(
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
          modelSeat.register = () => ctx.slots.register(
            { name: 'conversation.input.model', id: LOCALE_NS, order: 0 },
            ModelLock,
          )
          // Initial state comes from the host, but the composer switch is the
          // authority once it renders; fail quiet if the request cannot be made.
          request('/status', { method: 'GET' })
            .then((status) => syncModelSeat(status.enabled !== false))
            .catch(() => { /* leave the seat alone */ })
          return () => { if (modelSeat.release) { try { modelSeat.release() } catch { /* teardown */ } ; modelSeat.release = null } }
        })
      } catch { /* the seat may not exist in this shell */ }

      // 3) Keep the Plugin-Manager config seats reachable too.
      for (const pkg of PACKAGE_KEYS) {
        disposers.push(ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
          { name: 'plugins.bundle.config', key: pkg },
          renderConfigSeat,
        )))
        disposers.push(ctx.slots.inject('plugins.row.config', () => ctx.slots.register(
          { name: 'plugins.row.config', key: `${pkg}#${ROW_ID}` },
          renderConfigSeat,
        )))
      }

      return () => {
        for (const dispose of disposers) {
          try { if (typeof dispose === 'function') dispose() } catch { /* teardown */ }
        }
      }
    }

    const inject = ['slots', 'locale']

    exports.apply = apply
    exports.inject = inject
    // Test-only seam: lets the offline regression suite render individual pieces
    // without mounting the whole panel. Not used by the host.
    exports.__test = { TrafficBoard, TrafficBoardView, TrafficChart, trafficRows, liveLine, totalCalls, HarnessConfig, ComposerChip, ModelLock, DecisionTip, decisionDetail, decisionsOf }
    return module.exports
  },
})
