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
    // #20: module-level translator. The locale bundle is bound once in apply().
    // Code passes an ENGLISH fallback only — Chinese lives ONLY in locale/zh.json,
    // so grepping the source for hardcoded Chinese finds nothing but comments.
    // #20: the default (unbound) locale reads an injected default table
    // (window.__JEV_DEFAULT_LOCALE__), so pure functions called outside apply()
    // and module-level constants evaluated at load time still resolve to real
    // text. Production overrides this via ctx.locale.bind in apply(); tests
    // inject locale/zh.json (or en.json) as that table. No Chinese in source.
    let __jevLocale = (key) => {
      try {
        const table = (typeof window !== 'undefined' && window.__JEV_DEFAULT_LOCALE__) || {}
        return table[key] || key
      } catch { return key }
    }
    function T(key, fallback, params) {
      let text
      try {
        const v = __jevLocale(key)
        text = (typeof v === 'string' && v && v !== key) ? v : (fallback !== undefined ? fallback : key)
      } catch {
        text = fallback !== undefined ? fallback : key
      }
      // #20: {param} interpolation for templates that mix text and values.
      if (params && typeof params === 'object') {
        for (const [name, value] of Object.entries(params)) {
          text = String(text).split(`{${name}}`).join(String(value))
        }
      }
      return text
    }


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
        title: T('jev.k001', "Kimi · decision tier (auto-judged by JEV, not user-selected)"),
        hint: T('jev.k002', "Judgment, trade-offs, review, architecture and risk work goes here. K3.1Pro recommended."),
      },
      {
        key: 'dsf',
        title: T('jev.k003', "DeepSeek · execution tier (auto-judged by JEV, not user-selected)"),
        hint: T('jev.k004', "Implementation, transformation, formatting, extraction and bulk generation go here. 4.1Flash101 recommended."),
      },
      {
        key: 'jev',
        title: T('jev.k005', "JEV · auto judge (required, decides every route)"),
        hint: T('jev.k006', "Leave blank to use local keyword heuristics for the tier; fill it to ask JEV first."),
      },
    ]

    const tierStyles = {
  block: { marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(128,128,128,0.18)' },
  head: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' },
  hint: { fontSize: '12px', opacity: 0.7 },
}

/**
 * #22：统一 :focus-visible 焦点环。内联 style 写不了伪类，所以注入一次 <style>。
 * 只作用于标了 data-jev-a11y 的我们的根节点，不污染宿主界面；
 * 测试环境没有 document 时直接跳过（返回 false，不抛）。
 */
const A11Y_CSS = '[data-jev-a11y] :is(button,input,select,textarea,a,[role="button"],[role="switch"],[tabindex]):focus-visible{outline:2px solid var(--dsw-specific-accent,#4084ff);outline-offset:2px}[data-jev-a11y]:focus-visible{outline:2px solid var(--dsw-specific-accent,#4084ff);outline-offset:2px}'

function ensureA11yStyles() {
  try {
    if (typeof document === 'undefined' || !document.head) return false
    if (document.querySelector('style[data-jev-a11y]')) return true
    const el = document.createElement('style')
    el.setAttribute('data-jev-a11y', '1')
    el.textContent = A11Y_CSS
    document.head.appendChild(el)
    return true
  } catch { return false }
}

/** #22：所有可点控件的下限，至少 32×32（触摸场景建议 44，这里先兜住 32）。 */
const MIN_TARGET = { minHeight: '32px', minWidth: '32px', boxSizing: 'border-box' }

const styles = {
      page: {
        boxSizing: 'border-box', height: '100%', minHeight: 0, overflowY: 'auto',
        padding: '28px clamp(20px,4vw,48px) 48px',
      },
      pageInner: { width: '100%', maxWidth: '880px', margin: '0 auto' },
      pageTitle: { fontSize: '20px', fontWeight: 600, margin: '0 0 6px' },
      pageSub: { fontSize: '13px', opacity: 0.7, margin: '0 0 20px', lineHeight: 1.6 },
      wrap: { display: 'grid', gap: '14px', padding: '2px 0' },
      lead: { margin: 0, fontSize: '13px', lineHeight: 1.6, opacity: 0.75 },
      card: {
        border: '1px solid rgba(127,127,127,.28)',
        borderRadius: '10px',
        padding: '12px 14px',
        display: 'grid',
        gap: '8px',
      },
      fieldset: {
        border: '1px solid rgba(127,127,127,.28)',
        borderRadius: '10px',
        padding: '10px 14px 12px',
        margin: 0,
        display: 'grid',
        gap: '8px',
      },
      head: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
      title: { fontSize: '13px', fontWeight: 600 },
      hint: { fontSize: '12px', opacity: 0.6 },
      row: { display: 'grid', gridTemplateColumns: '92px 1fr', alignItems: 'center', gap: '10px' },
      label: { fontSize: '12px', opacity: 0.7 },
      input: {
        ...MIN_TARGET,
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
      // #22: 这两个键之前根本不存在，路由卡的三个按钮既没样式也没有 32×32 约束。
      chip: {
        ...MIN_TARGET,
        padding: '3px 10px',
        borderRadius: '999px',
        border: '1px solid rgba(127,127,127,.35)',
        background: 'transparent',
        color: 'inherit',
        fontSize: '12px',
        cursor: 'pointer',
      },
      chipOn: { background: 'rgba(64,132,255,.9)', color: '#fff', borderColor: 'transparent' },
      button: {
        ...MIN_TARGET,
        padding: '6px 14px',
        borderRadius: '6px',
        border: '1px solid rgba(127,127,127,.4)',
        background: 'rgba(127,127,127,.12)',
        color: 'inherit',
        fontSize: '13px',
        cursor: 'pointer',
      },
      buttonPrimary: {
        ...MIN_TARGET,
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
        ...MIN_TARGET,
        position: 'relative',
        width: '52px',
        height: '32px',
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
      tileSub: { fontSize: '11px', opacity: 0.7, lineHeight: 1.5 },
      dot: (color) => ({ width: '8px', height: '8px', borderRadius: '50%', background: color, display: 'inline-block', flex: '0 0 auto' }),
      chartBox: { width: '100%', overflow: 'hidden' },
      legend: { display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '11px', opacity: 0.75, alignItems: 'center' },
      recentHead: { display: 'grid', gridTemplateColumns: '62px 56px 82px 54px 58px 1fr', gap: '6px', fontSize: '11px', opacity: 0.7, paddingBottom: '2px' },
      recentRow: { display: 'grid', gridTemplateColumns: '62px 56px 82px 54px 58px 1fr', gap: '6px', fontSize: '11px', padding: '3px 0', borderTop: '1px solid rgba(127,127,127,.14)' },
      chipRow: { display: 'flex', gap: '6px', alignItems: 'center' },
      chip: (on) => ({
        ...MIN_TARGET, padding: '3px 10px', borderRadius: '999px', fontSize: '11px', cursor: 'pointer',
        border: '1px solid rgba(127,127,127,.35)',
        background: on ? 'rgba(64,132,255,.9)' : 'transparent',
        color: on ? '#fff' : 'inherit',
      }),
    }
    const TRAFFIC_COLORS = { jev: '#a371f7', kimi: '#4084ff', dsf: '#3fb950' }
    // #20 F1: these label maps are assigned in apply() AFTER the locale is bound,
    // so production never freezes them to the English fallback at load time.
    let TRAFFIC_NAMES = {}

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

    /** 「好看」的刻度上限：1/2/5×10^n，让左侧刻度是整数而不是 37。 */
    function niceCeil(value) {
      const v = Math.max(1, Math.ceil(value))
      const pow = Math.pow(10, Math.floor(Math.log10(v)))
      for (const step of [1, 2, 5, 10]) {
        const candidate = step * pow
        if (v <= candidate) return candidate
      }
      return 10 * pow
    }

    /** 刻度值：0 起、步长取 1/2/5×10^n，落在 max 上的最后一格永远保留。 */
    function axisTicks(max) {
      if (max <= 4) return Array.from({ length: max + 1 }, (_, index) => index)
      const rawStep = max / 5
      const pow = Math.pow(10, Math.floor(Math.log10(rawStep)))
      const step = [1, 2, 5, 10].map((k) => k * pow).find((k) => k >= rawStep) || rawStep
      const ticks = []
      for (let value = 0; value <= max + 1e-9; value += step) ticks.push(Math.round(value * 100) / 100)
      if (ticks[ticks.length - 1] < max) ticks.push(max)
      return ticks
    }

    /**
     * Hand-rolled grouped bar chart: no chart library, one svg.
     * #18 三个被 Verifier 抓到的缺口全在这里补：左侧 y 刻度、跨午夜竖虚线+日期、
     * 最右「现在」标记。柱子不再只按峰值归一化（1 次调用顶满图）——上限取 nice 数，
     * 刻度写着真实数量，读者不会把「1 次」误读成「很多次」。
     */
    function TrafficChart({ rows, summaryId }) {
      const width = 720
      const height = 176
      const padTop = 10
      const padBottom = 18
      const padLeft = 34
      const padRight = 26
      const plotHeight = height - padTop - padBottom
      const plotWidth = width - padLeft - padRight
      if (!rows.length) return h('p', { style: styles.note }, T('jev.k010', "No data yet."))
      let peak = 1
      for (const row of rows) {
        for (const gateway of ['jev', 'kimi', 'dsf']) {
          peak = Math.max(peak, (row.gateways[gateway] && row.gateways[gateway].calls) || 0)
        }
      }
      // 刻度上限：nice 数，且下限 2 —— 峰值只有 1 时柱子占半格，不再「1 次调用顶满全图」
      // （issue #18 的原始抱怨）。读数看左边的刻度，不靠猜归一化。
      const axisMax = niceCeil(Math.max(2, peak))
      const slot = plotWidth / rows.length
      const groupWidth = Math.max(3, slot * 0.74)
      const barWidth = Math.max(1, groupWidth / 3)
      // 左侧刻度：5 条以内横向网格 + 数值标签（0 在底、axisMax 在顶）。
      const gridLines = []
      const tickLabels = []
      for (const [index, tick] of axisTicks(axisMax).entries()) {
        const y = padTop + plotHeight * (1 - tick / axisMax)
        gridLines.push(h('line', {
          key: `grid${index}`, x1: padLeft, x2: padLeft + plotWidth, y1: y, y2: y,
          stroke: 'rgba(127,127,127,.18)', strokeWidth: 1,
        }))
        tickLabels.push(h('text', {
          key: `tick${index}`, x: padLeft - 6, y: y + 3, textAnchor: 'end',
          fontSize: 9, fill: 'currentColor', opacity: 0.7,
        }, String(tick)))
      }
      const yAxis = h('line', {
        key: 'y-axis', x1: padLeft, x2: padLeft, y1: padTop, y2: padTop + plotHeight,
        stroke: 'rgba(127,127,127,.35)', strokeWidth: 1,
      })
      const baseline = h('line', {
        key: 'baseline', x1: padLeft, x2: padLeft + plotWidth, y1: padTop + plotHeight, y2: padTop + plotHeight,
        stroke: 'rgba(127,127,127,.35)', strokeWidth: 1,
      })
      // 跨午夜：日粒度的 day 变了就在那条边界上画竖虚线，并把日期写在顶部（#18）。
      // 只在小时粒度（>12 桶）画，日粒度每行都换日，画满会变成噪声。
      const midnight = []
      if (rows.length > 12) {
        for (let index = 1; index < rows.length; index++) {
          const prevDay = rows[index - 1] && rows[index - 1].sub
          const day = rows[index] && rows[index].sub
          if (!day || !prevDay || day === prevDay) continue
          const x = padLeft + index * slot
          midnight.push(h('line', {
            key: `midnight${index}`, x1: x, x2: x, y1: padTop, y2: padTop + plotHeight,
            stroke: 'rgba(127,127,127,.45)', strokeWidth: 1, strokeDasharray: '3 3',
          }))
          midnight.push(h('text', {
            key: `midnight-label${index}`, x: x + 3, y: padTop + 8,
            fontSize: 9, fill: 'currentColor', opacity: 0.7,
          }, day))
        }
      }
      // 「现在」标记：最右边界就是当前小时（#18）。
      const nowX = padLeft + plotWidth
      const nowMark = [
        h('line', {
          key: 'now-line', x1: nowX, x2: nowX, y1: padTop, y2: padTop + plotHeight,
          stroke: 'rgba(64,132,255,.55)', strokeWidth: 1, strokeDasharray: '2 3',
        }),
        h('text', {
          key: 'now-label', x: nowX - 2, y: padTop + 8, textAnchor: 'end',
          fontSize: 9, fill: 'currentColor', opacity: 0.7,
        }, T('jev.k011', "now")),
      ]
      const bars = []
      const labels = []
      rows.forEach((row, rowIndex) => {
        const groupStart = padLeft + rowIndex * slot + (slot - groupWidth) / 2
        ;['jev', 'kimi', 'dsf'].forEach((gateway, gatewayIndex) => {
          const entry = row.gateways[gateway] || { calls: 0, tokens: 0, fail: 0 }
          const x = groupStart + gatewayIndex * barWidth
          const totalHeight = entry.calls > 0 ? Math.max(2, (entry.calls / axisMax) * plotHeight) : 0
          if (!totalHeight) {
            // 零调用也要有悬停反馈（#18）
            return bars.push(h('rect', {
              key: `${rowIndex}-${gateway}-zero`, x, y: padTop + plotHeight - 2,
              width: Math.max(1, barWidth - 1), height: 2, fill: 'transparent',
            }, h('title', null, T('jev.t00', "{p0} · {p1}: 0 calls", { p0: (row.label), p1: (TRAFFIC_NAMES[gateway]) }))))
          }
          const failHeight = entry.fail > 0 ? Math.max(2, (entry.fail / axisMax) * plotHeight) : 0
          const okHeight = Math.max(0, totalHeight - failHeight)
          const y = padTop + plotHeight - totalHeight
          bars.push(h('rect', {
            key: `${rowIndex}-${gateway}`,
            x, y: y + failHeight, width: Math.max(1, barWidth - 1), height: okHeight,
            fill: TRAFFIC_COLORS[gateway],
            rx: barWidth > 3 ? 1.5 : 0,
          }, h('title', null, `${row.label} · ${TRAFFIC_NAMES[gateway]}: ${entry.calls}${T('jev.f01a', " calls / ")}${entry.tokens} tokens${entry.fail ? ` / ${entry.fail}${T('jev.f01b', " failed")}` : ''}`)))
          if (failHeight > 0) {
            // 失败不是「淡一点」，是柱顶一块实心红（#18）。
            bars.push(h('rect', {
              key: `${rowIndex}-${gateway}-fail`,
              x, y, width: Math.max(1, barWidth - 1), height: failHeight,
              fill: '#f85149', rx: barWidth > 3 ? 1.5 : 0,
            }, h('title', null, T('jev.t02', "{p0} · {p1}: {p2} failed", { p0: (row.label), p1: (TRAFFIC_NAMES[gateway]), p2: (entry.fail) }))))
          }
        })
        const every = Math.max(1, Math.ceil(rows.length / 8))
        if (rowIndex % every === 0) {
          labels.push(h('text', {
            key: `label${rowIndex}`, x: padLeft + rowIndex * slot + slot / 2, y: height - 5,
            textAnchor: 'middle', fontSize: 10, fill: 'currentColor', opacity: 0.7,
          }, row.label))
        }
      })
      return h('div', { style: trafficStyles.chartBox },
        h('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height: `${height}px`, role: 'img', 'aria-label': T('jev.k012', "Calls per gateway"), 'aria-describedby': summaryId || undefined },
          ...gridLines, yAxis, baseline, ...tickLabels, ...midnight, ...nowMark, ...bars, ...labels),
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
      // #41: '' = whole machine; otherwise one sessionId. 'unknown'/'legacy' are
      // shown as such, NEVER relabelled as "this session" (the panel cannot know it).
      const [sessionFilter, setSessionFilter] = react.useState('')
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
            const res = await bridgeFetch(`/stats?hours=${hours}${sessionFilter ? `&session=${encodeURIComponent(sessionFilter)}` : ''}`, {
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
      }, [hours, nonce, sessionFilter])

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
        sessionFilter, onSessionChange: setSessionFilter,
      })
    }

    function totalCalls(payload) {
      const totals = (payload && payload.totals) || {}
      return ['jev', 'kimi', 'dsf'].reduce((sum, gateway) => sum + (((totals[gateway] || {}).calls) || 0), 0)
    }


    /** 「触发」列的任务语言（#18）：不把内部枚举直接甩给用户。 */
    let TOOL_LABELS = {}

    let SOURCE_LABELS = {}

    function toolLabel(tool) {
      return TOOL_LABELS[tool] || (tool ? T('jev.k022', "other") : '—')
    }

    /** 首屏第一行：几次、谁做的、坏没坏、多少用量（#18）。 */
    function taskSummary(data) {
      const totals = (data && data.totals) || {}
      const pick = (key) => totals[key] || { calls: 0, fail: 0, tokens: 0, unanswered: 0, notSent: 0, probeCalls: 0 }
      const jev = pick('jev')
      const kimi = pick('kimi')
      const dsf = pick('dsf')
      const requests = Math.max(0, (jev.calls || 0) + (kimi.calls || 0) + (dsf.calls || 0))
      const fails = (jev.fail || 0) + (kimi.fail || 0) + (dsf.fail || 0)
      const unanswered = (jev.unanswered || 0) + (kimi.unanswered || 0) + (dsf.unanswered || 0)
      const tokens = (jev.tokens || 0) + (kimi.tokens || 0) + (dsf.tokens || 0)
      const usage = tokens > 0 ? `${tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens` : T('jev.k023', "— (gateway returned no usage)")
      return T('jev.t03', "{p0} requests in this window · Kimi {p1} judgements / Flash {p2} executions · failed {p3} · no answer {p4}", { p0: (requests), p1: (kimi.calls || 0), p2: (dsf.calls || 0), p3: (fails), p4: (unanswered), p5: (usage) })
    }

    /** 稀疏数据：调用少时不画 24 根柱，按时间列点（#18）。 */
    function TrafficTimeline({ data, summaryId }) {
      const recent = ((data && data.recent) || []).slice().reverse()
      const width = 720
      const height = 54
      if (!recent.length) return h('p', { style: styles.note }, T('jev.k024', "No calls yet."))
      const span = Math.max(1, recent.length - 1)
      const dots = recent.map((entry, index) => {
        const x = 16 + (width - 32) * (index / (recent.length === 1 ? 1 : span))
        const y = 30
        const failed = entry.ok === false || entry.kind === 'fail' || entry.kind === 'no-answer' || entry.kind === 'not-sent'
        return h('g', { key: `dot${index}` },
          h('circle', { cx: x, cy: y, r: 5, fill: failed ? '#f85149' : (TRAFFIC_COLORS[entry.g] || '#3fb950') },
            h('title', null, `${new Date(entry.t).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })} · ${toolLabel(entry.tool)} · ${failed ? T('jev.k025', "failed") : T('jev.k026', "succeeded")}${entry.error ? ` · ${entry.error}` : ''}`)),
          h('title', null, `${toolLabel(entry.tool)}: ${failed ? T('jev.k025', "failed") : T('jev.k026', "succeeded")}`),
        )
      })
      return h('div', { style: trafficStyles.chartBox },
        h('p', { style: styles.note }, T('jev.t04', "Call timeline · only {p0} calls in this window, listed by time (bar chart at ≥13)", { p0: (recent.length) })),
        h('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height: `${height}px`, role: 'img', 'aria-label': T('jev.k027', "Call timeline"), 'aria-describedby': summaryId || undefined },
          h('line', { x1: 0, x2: width, y1: 30, y2: 30, stroke: 'rgba(127,127,127,.35)', strokeWidth: 1 }),
          // #18：右端就是「现在」，画一条竖虚线并写出来，而不是让用户猜最后一个点的位置。
          h('line', { x1: width - 16, x2: width - 16, y1: 14, y2: 42, stroke: 'rgba(64,132,255,.55)', strokeWidth: 1, strokeDasharray: '2 3' }),
          h('text', { x: width - 18, y: 10, textAnchor: 'end', fontSize: 9, fill: 'currentColor', opacity: 0.7 }, T('jev.k011', "now")),
          ...dots),
      )
    }

    // One line that proves the poll is alive: last poll time, poll count, and how many
    // calls arrived since the panel opened (that is what users actually want to see).
    /** 「HH:mm（N${T('jev.f07b', " min")}前）」——有历史但本轮没有新调用时的锚点行（#15）。 */
    function lastCallLine(payload) {
      const recent = (payload && Array.isArray(payload.recent)) ? payload.recent : []
      const entry = recent[0]
      if (!entry || !entry.t) return ''
      const at = new Date(entry.t)
      if (Number.isNaN(at.getTime())) return ''
      const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
      const minutes = Math.max(0, Math.round((Date.now() - at.getTime()) / 60000))
      return T('jev.t05', "Last call · {p0} ({p1} min ago)", { p0: (hhmm), p1: (minutes) })
    }

    function liveLine({ data, rows, updatedAt, polls, baseline }) {
      if (!updatedAt) return T('jev.t06', "Auto-refresh every {p0}s · reading…", { p0: (POLL_MS / 1000) })
      const clock = new Date(updatedAt).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })
      const now = totalCalls(data)
      const delta = baseline === null || baseline === undefined ? null : Math.max(0, now - baseline)
      let fresh = ''
      if (delta !== null && delta > 0) fresh = T('jev.t07', " · {p0} new since opened", { p0: (delta) })
      else if (delta !== null) fresh = lastCallLine(data) ? ` · ${lastCallLine(data)}` : ''
      return T('jev.t08', "Updated {p0} · refreshed {p1}×{p2} · auto-refresh every {p3}s · {p4} buckets", { p0: (clock), p1: (polls), p2: (fresh), p3: (POLL_MS / 1000), p4: (rows.length) })
    }

    /** 空态三选一：按宿主 state 分流，unknown 不套卡片（#15）。 */
    function emptyState(data) {
      const state = (data && data.state) || 'ready'
      if (state === 'off') {
        return {
          kind: 'off',
          title: T('jev.k028', "JEV has stepped aside"),
          body: T('jev.k029', "Requests are handled by the DSH model now and are not recorded here. Turn JEV on and requests through it will appear here."),
          action: T('jev.k030', "Turn on JEV"),
        }
      }
      if (state === 'setup' || state === 'degraded') {
        return {
          kind: 'setup',
          title: T('jev.k031', "Request not sent yet"),
          body: T('jev.k032', "The Kimi or Flash gateway address is incomplete. Fill it in first; unsent attempts are recorded as 'not sent'."),
          action: T('jev.k033', "Go fill in the gateway"),
        }
      }
      return {
        kind: 'ready',
        title: T('jev.k034', "No call records yet"),
        body: T('jev.k035', "The switch is on. The first request through JEV will appear here; unsent or unanswered attempts are also marked."),
        action: T('jev.k036', "Test connectivity"),
      }
    }

    // Pure view over one /stats payload — no fetching, so it is testable.
    // #41: distinct session ids seen in the ledger rows, most-recent first.
    // 'unknown' (L1 tools could not supply one) and 'legacy' (pre-partition rows)
    // are labelled honestly — they are NOT "this session".
    function sessionsOf(data) {
      const seen = new Map()
      // #41 follow-up: prefer the backend aggregate (`/stats.sessions`), built from
      // decisions + recent, so the dropdown is not limited to the 40-row ring.
      // Fall back to the rows for older bridges.
      if (Array.isArray(data && data.sessions)) {
        for (const row of data.sessions) {
          const id = row && row.id
          if (!id) continue
          seen.set(id, Number(row.decisions || 0) + Number(row.recent || 0))
        }
        return [...seen.entries()].map(([id, count]) => ({ id, count }))
      }
      const rows = [...((data && data.recent) || []), ...((data && data.decisions) || [])]
      for (const r of rows) {
        const id = r && r.session
        if (!id) continue
        seen.set(id, (seen.get(id) || 0) + 1)
      }
      return [...seen.entries()].map(([id, count]) => ({ id, count }))
    }
    function sessionLabel(id) {
      if (id === 'unknown') return T('jev.k037', "Unknown session (no sessionId carried)")
      if (id === 'legacy') return T('jev.k038', "History (pre-partition records)")
      return id
    }

    function TrafficBoardView({ data, hours, error, onRange, onRefresh, updatedAt, polls, baseline, onAction, sessionFilter, onSessionChange }) {
      // 首帧/错误态：只要 data 还没回来就只给骨架，绝不显示假的 0${T('jev.f01a', " calls / ")}0 tokens（#15）。
      if (!data) {
        return h('div', { style: styles.card },
          h('div', { style: styles.head },
            h('span', { style: styles.title }, T('jev.k039', "Traffic dashboard")),
            h('span', { style: styles.hint }, T('jev.k040', "Reading stats…"))),
          h('div', { style: trafficStyles.grid3 },
            ...['jev', 'kimi', 'dsf'].map((gateway) => h('div', { key: gateway, style: trafficStyles.tile },
              h('span', { style: { ...trafficStyles.tileValue, opacity: 0.25 } }, '— — —'),
              h('span', { style: { ...trafficStyles.tileSub, opacity: 0.7 } }, T('jev.k041', "Counting")),
            ))),
          h('div', { style: { ...styles.note, opacity: 0.7 } }, T('jev.k042', "Skeleton placeholder: real numbers appear once /stats returns")),
          error ? h('p', { style: styles.bad }, T('jev.t17', "Failed to read stats: {p0}", { p0: (error) })) : null,
        )
      }

      const rows = trafficRows(data, hours)
      // #41 judge quality: when a session is selected use ITS metrics, else the
      // whole-machine ones. Accuracy comes from the #10 golden-set eval result.
      const jq = (sessionFilter && data.session && data.session.judgeQuality)
        ? data.session.judgeQuality
        : (data.judgeQuality || null)
      const sessionList = sessionsOf(data)
      const accuracy = data.judgeAccuracy || null
      const pct = (x) => `${Math.round((x || 0) * 100)}%`
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
            TRAFFIC_NAMES[gateway],
            // #3: grey cooling-down badge with the minutes left on this gateway.
            (data.breakers && data.breakers[gateway] && data.breakers[gateway].coolingDown)
              ? h('span', { style: { marginLeft: 6, fontSize: 10, opacity: 0.7 }, title: T('jev.k043', "Consecutive failures trip the breaker; the gateway is skipped during cooldown") },
                `${T('jev.f07a', "⚪ cooling ")}${data.breakers[gateway].minutesLeft}${T('jev.f07b', " min")}`)
              : null),
          h('span', { style: trafficStyles.tileValue }, T('jev.t09', "{p0} calls", { p0: (total.calls) })),
          h('span', { style: trafficStyles.tileSub },
            `${total.tokens > 0 ? `${total.tokens.toLocaleString()} tokens` : T('jev.k044', "— tokens (gateway returned no usage)")}${rate === null ? '' : `${T('jev.f10', " · success rate ")}${rate}%`}${total.avgMs ? `${T('jev.f11', " · avg ")}${total.avgMs}ms` : ''}`),
          unanswered > 0 || notSent > 0
            ? h('span', { style: trafficStyles.tileSub },
              `${unanswered > 0 ? `${T('jev.f05a', "no answer ")}${unanswered}` : ''}${unanswered > 0 && notSent > 0 ? ' · ' : ''}${notSent > 0 ? `${T('jev.f05b', "not sent ")}${notSent}` : ''}`)
            : null,
          h('span', { style: trafficStyles.tileSub }, T('jev.t14', "Today {p0} calls · {p1} tokens", { p0: (todayEntry.calls), p1: (todayEntry.tokens.toLocaleString()) })),
        )
      })

      const recent = (data && data.recent) || []
      // 账本损坏时后端会带回 warning；这里必须让它可见，不能只在 totals 上显示 0。
      const warning = data && data.warning
      const warningLine = warning
        ? h('p', { style: styles.bad, role: 'alert' },
          `${T('jev.f15a', "Ledger corrupt: ")}${warning.backup ? `${T('jev.f15b', "old file quarantined as ")}${warning.backup}` : T('jev.k045', "Old file could not be quarantined (permissions or read-only disk)")}${T('jev.f15c', "; stats restart from here.")}`)
        : null
      const recentHead = h('div', { style: trafficStyles.recentHead, role: 'row' },
        h('span', { role: 'columnheader' }, T('jev.k046', "Time")), h('span', { role: 'columnheader' }, T('jev.k047', "Gateway")),
        h('span', { role: 'columnheader' }, T('jev.k048', "Trigger")),
        h('span', { role: 'columnheader' }, T('jev.k049', "Result")), h('span', { role: 'columnheader' }, T('jev.k050', "Latency")),
        h('span', { role: 'columnheader' }, 'tokens'))
      const recentRows = recent.slice(0, 10).flatMap((entry, index) => {
        const row = h('div', { key: `r${index}`, style: trafficStyles.recentRow, role: 'row' },
        h('span', { style: { opacity: 0.7 } }, new Date(entry.t).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })),
        h('span', null, (entry.g || '').toUpperCase()),
        h('span', { style: { opacity: 0.8 } },
          // #4/#18: 内部枚举翻成人话；judge 行额外带置信度与来源。
          toolLabel(entry.tool) + (typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
            ? ` · ${entry.confidence.toFixed(2)}` : '') + (entry.source ? ` · ${SOURCE_LABELS[entry.source] || entry.source}` : '')),
        h('span', {
          style: entry.kind === 'no-answer' ? styles.bad : entry.kind === 'not-sent' ? styles.bad : entry.ok ? styles.good : styles.bad,
        }, entry.kind === 'no-answer' ? T('jev.k051', "No answer") : entry.kind === 'not-sent' ? T('jev.k052', "Not sent") : entry.ok ? 'OK' : 'FAIL'),
        h('span', { style: { opacity: 0.7 } }, entry.ms ? `${entry.ms}ms` : '—'),
        h('span', { style: { opacity: 0.7 } }, `${(entry.pt || 0) + (entry.ct || 0)}`),
        )
        if (!entry.error) return [row]
        return [row, h('div', {
          key: `e${index}`,
          style: { fontSize: 11, color: '#f85149', padding: '0 0 4px', wordBreak: 'break-all' },
          title: entry.error,
        }, T('jev.t16', "Reason: {p0}", { p0: (String(entry.error).slice(0, 160)) }))]
      })

      // 0 调用：三选一空态卡，不画 24 根空柱（#15）。
      if (data && totalCalls(data) === 0) {
        const card = emptyState(data)
        return h('div', { style: styles.card },
          h('div', { style: styles.head },
            h('span', { style: styles.title }, card.title),
            h('span', { style: styles.hint }, liveLine({ data, rows, updatedAt, polls, baseline }))),
          warningLine,
          h('div', { style: trafficStyles.chipRow },
            h('button', { type: 'button', style: trafficStyles.chip(hours === 24), onClick: () => onRange && onRange(24) }, T('jev.k053', "Last 24 hours")),
            h('button', { type: 'button', style: trafficStyles.chip(hours === 168), onClick: () => onRange && onRange(168) }, T('jev.k054', "Last 7 days")),
          ),
          h('p', { style: styles.note }, card.body),
          h('div', { style: styles.actions },
            h('button', { type: 'button', style: styles.button, onClick: () => onAction && onAction(card.kind) }, card.action)),
          error ? h('p', { style: styles.bad }, T('jev.t17', "Failed to read stats: {p0}", { p0: (error) })) : null,
        )
      }

      return h('div', { style: styles.card },
        h('div', { style: styles.head },
          h('span', { style: styles.title }, T('jev.k039', "Traffic dashboard")),
          h('span', { style: styles.hint }, liveLine({ data, rows, updatedAt, polls, baseline })),
        ),
        warningLine,
        data ? h('p', { style: { ...styles.hint, fontSize: 12 } }, taskSummary(data)) : null,
        h('div', { style: trafficStyles.chipRow },
          h('button', { type: 'button', style: trafficStyles.chip(hours === 24), onClick: () => onRange && onRange(24) }, T('jev.k053', "Last 24 hours")),
          h('button', { type: 'button', style: trafficStyles.chip(hours === 168), onClick: () => onRange && onRange(168) }, T('jev.k054', "Last 7 days")),
          h('button', { type: 'button', style: trafficStyles.chip(false), onClick: () => onRefresh && onRefresh(), title: T('jev.k055', "Fetch stats now, without waiting for the next 10s tick") }, T('jev.k056', "Refresh now")),
        ),
        h('div', { style: trafficStyles.grid3 }, ...tiles),
        // #41: judge-quality section — session filter + 4 metric cards + accuracy.
        h('div', { style: { marginTop: 10, borderTop: '1px solid rgba(127,127,127,.14)', paddingTop: 8 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', { style: styles.title }, T('jev.k057', "Judge quality")),
            h('select', {
              value: sessionFilter || '',
              onChange: (e) => onSessionChange && onSessionChange(e.target.value),
              'aria-label': T('jev.k058', "Filter judge quality by session"),
              style: { ...MIN_TARGET, fontSize: 12 },
            },
              h('option', { value: '' }, T('jev.k059', "Whole machine (all sessions)")),
              ...sessionList.map((s) => h('option', { key: s.id, value: s.id }, `${sessionLabel(s.id)}（${s.count}）`)),
            ),
            sessionFilter ? h('span', { style: styles.hint }, T('jev.t18', "Viewing: {p0}", { p0: (sessionLabel(sessionFilter)) })) : null,
          ),
          jq ? h('div', { style: trafficStyles.grid3 },
            h('div', { style: trafficStyles.tile },
              h('span', { style: trafficStyles.tileName }, T('jev.k060', "Judge count")),
              h('span', { style: trafficStyles.tileValue }, `${jq.judgedCount || 0}`),
              h('span', { style: trafficStyles.tileSub }, T('jev.t19', "decision {p0} / execution {p1}", { p0: (jq.tierDistribution?.decision || 0), p1: (jq.tierDistribution?.execution || 0) })),
            ),
            h('div', { style: trafficStyles.tile },
              h('span', { style: trafficStyles.tileName }, T('jev.k061', "Heuristic share")),
              h('span', { style: trafficStyles.tileValue }, pct(jq.heuristicShare)),
              h('span', { style: trafficStyles.tileSub }, T('jev.k062', "Fallback share when JEV is unreachable")),
            ),
            h('div', { style: trafficStyles.tile },
              h('span', { style: trafficStyles.tileName }, T('jev.k063', "Low-confidence share")),
              h('span', { style: trafficStyles.tileValue }, pct(jq.lowConfidenceShare)),
              h('span', { style: trafficStyles.tileSub }, T('jev.k064', "confidence < 0.5 (a criteria dimension may be missing)")),
            ),
            h('div', { style: trafficStyles.tile },
              h('span', { style: trafficStyles.tileName }, T('jev.k065', "Avg judge latency")),
              h('span', { style: trafficStyles.tileValue }, `${jq.avgJudgeMs || 0}ms`),
              h('span', { style: trafficStyles.tileSub }, jq.judgeToExecutionMsRatio != null ? T('jev.t20', "judge/execution {p0}", { p0: (jq.judgeToExecutionMsRatio) }) : '—'),
            ),
          ) : h('p', { style: styles.note }, T('jev.k066', "No judge records yet.")),
          accuracy
            ? h('p', { style: styles.note },
              T('jev.t21', "Golden-set accuracy (#10): tier {p0}% · skill {p1}%", { p0: (Math.round((accuracy.tierAccuracy || 0) * 100)), p1: (Math.round((accuracy.skillAccuracy || 0) * 100)) })
              + T('jev.t22', "({p0} cases · criteria {p1} · measured {p2})", { p0: (accuracy.cases), p1: (accuracy.criteriaVersion), p2: (accuracy.at ? new Date(accuracy.at).toLocaleString() : T('jev.k067', "unknown time")) }))
            : h('p', { style: styles.note }, T('jev.k068', "Golden-set accuracy: not measured (needs JEV_API_KEY to run eval:judge once).")),
        ),
        // #22: 图表的可读文字摘要 —— 不靠悬停也能知道窗口内有多少次、谁做的。
        h('p', { id: 'jev-chart-summary', style: styles.note },
          T('jev.t60', "In this window: {p0} calls — JEV {p1} · Kimi {p2} · Flash {p3}", {
            p0: String(totalCalls(data)),
            p1: String((totals.jev && totals.jev.calls) || 0),
            p2: String((totals.kimi && totals.kimi.calls) || 0),
            p3: String((totals.dsf && totals.dsf.calls) || 0),
          })),
        totalCalls(data) > 12
          ? h(TrafficChart, { rows, summaryId: 'jev-chart-summary' })
          : h(TrafficTimeline, { data, summaryId: 'jev-chart-summary' }),
        h('div', { style: trafficStyles.legend },
          ...['jev', 'kimi', 'dsf'].map((gateway) => h('span', { key: gateway, style: { display: 'inline-flex', alignItems: 'center', gap: '5px' } },
            h('span', { style: trafficStyles.dot(TRAFFIC_COLORS[gateway]) }),
            `${TRAFFIC_NAMES[gateway]}（${(totals[gateway] && totals[gateway].calls) || 0}）`)),
        ),
        error ? h('p', { style: styles.bad }, T('jev.t17', "Failed to read stats: {p0}", { p0: (error) })) : null,
        recent.length
          ? h('div', { role: 'table', 'aria-label': T('jev.k205', "Recent calls") }, recentHead, ...recentRows)
          : null,
        h('p', { style: styles.note },
          T('jev.k069', "Counting: each HTTP request actually sent to a gateway counts once (judge = JEV, decision = Kimi, execution = DeepSeek Flash), including probes and failures; tokens come from the gateway's usage field, failed requests count 0.")),
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
      const [historyAuto, setHistoryAuto] = react.useState(true)  // #2: auto conversation history on/off
      const [historyTurns, setHistoryTurns] = react.useState('6')  // #2: max turns of history to mount
      const [routeMode, setRouteMode] = react.useState('dsh')
      const [route, setRoute] = react.useState({
        dshAvailable: false,
        decision: { provider: 'titigate', model: 'kimi-k3.1-pro' },
        execution: { provider: 'titigate', model: 'deepseek-v4.1-flash-1017' },
      })
      const [dshModels, setDshModels] = react.useState({ decision: [], execution: [] })
      // #36: which decision row is expanded (task 摘要 + probabilities). '' = none.
      const [openDecision, setOpenDecision] = react.useState('')

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
        if (status.history) {
          if (status.history.auto !== undefined) setHistoryAuto(status.history.auto !== false)
          if (typeof status.history.turns === 'number') setHistoryTurns(String(status.history.turns))
        }
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
            setMessage({ kind: 'bad', text: T('jev.t23', "Status unknown · click to retry ({p0})", { p0: (error.message) }) })
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
          setMessage({ kind: status.ok ? 'good' : 'bad', text: status.ok ? T('jev.k070', "Saved. Takes effect on the next call.") : T('jev.t24', "Save failed: {p0}", { p0: (status.error || T('jev.k071', "Unknown error")) }) })
        } catch (error) {
          setMessage({ kind: 'bad', text: T('jev.t25', "Save failed: {p0}", { p0: (error.message) }) })
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
              ? T('jev.k072', "On, but one step left: fill in the Kimi / DeepSeek gateway addresses before it actually takes over.")
              : next
                ? T('jev.k073', "On: decision/execution tasks are routed by JEV to Kimi / DeepSeek Flash.")
                : T('jev.k074', "Off: the plugin steps aside and tasks go back to DSH's own model gateway."),
          })
        } catch (error) {
          setEnabled(previous)
          syncModelSeat(state === 'ready')
          setMessage({ kind: 'bad', text: T('jev.t26', "Toggle failed: {p0}. The switch itself is the retry — click again.", { p0: (error.message) }) })
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
              ? T('jev.k075', "Follow on: after each successful route, the DSH model selector switches to the model that just did the work.")
              : T('jev.k076', "Follow off: the DSH model selector keeps the model you picked manually."),
          })
        } catch (error) {
          setFollowModel(previous)
          setMessage({ kind: 'bad', text: T('jev.t27', "Toggle failed: {p0}", { p0: (error.message) }) })
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
          setMessage({ kind: 'bad', text: T('jev.k077', "The confidence threshold must be a number between 0 and 1, e.g. 0.6.") })
          return
        }
        setBusy('lowConfidenceThreshold')
        try {
          const status = await request('/save', { method: 'POST', body: JSON.stringify({ lowConfidenceThreshold: value }) })
          applyStatus(status)
          setMessage({ kind: 'good', text: T('jev.t28', "Saved: judgements below {p0} confidence now escalate to the decision tier (Kimi). Takes effect on the next call.", { p0: (value) }) })
        } catch (error) {
          setMessage({ kind: 'bad', text: T('jev.t25', "Save failed: {p0}", { p0: (error.message) }) })
        } finally {
          setBusy('')
        }
      }

      // #2: toggle auto conversation history on/off.
      const toggleHistoryAuto = async (next) => {
        setBusy('historyAuto')
        setMessage(null)
        const previous = historyAuto
        setHistoryAuto(next)
        try {
          const status = await request('/save', { method: 'POST', body: JSON.stringify({ historyAuto: next }) })
          applyStatus(status)
          setMessage({ kind: 'good', text: next ? T('jev.h006', 'Auto-history ON: mounts the last few turns (bounded, never logged).') : T('jev.h007', 'Auto-history OFF: only your task/context.') })
        } catch (error) {
          setHistoryAuto(previous)
          setMessage({ kind: 'bad', text: T('jev.t27', 'Toggle failed: {p0}', { p0: error.message }) })
        } finally {
          setBusy('')
        }
      }

      // #2: save the turn cap for auto history.
      const saveHistoryTurns = async () => {
        setMessage(null)
        const value = Number(historyTurns)
        if (!Number.isFinite(value) || value < 1 || value > 50) {
          setMessage({ kind: 'bad', text: T('jev.h008', 'Turn cap must be an integer between 1 and 50, e.g. 6.') })
          return
        }
        setBusy('historyTurns')
        try {
          const status = await request('/save', { method: 'POST', body: JSON.stringify({ historyTurns: Math.round(value) }) })
          applyStatus(status)
          setMessage({ kind: 'good', text: T('jev.h009', 'Saved: mounts the last {n} turns. Takes effect on the next call.', { n: Math.round(value) }) })
        } catch (error) {
          setMessage({ kind: 'bad', text: T('jev.t25', 'Save failed: {p0}', { p0: error.message }) })
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
              ? T('jev.k078', "Auto-mount on: before each task JEV picks the best-fitting mattpocock skill and prepends its instructions to the call.")
              : T('jev.k079', "Auto-mount off: calls no longer attach a skill; routing continues as usual."),
          })
        } catch (error) {
          setSkillsAuto(previous)
          setMessage({ kind: 'bad', text: T('jev.t27', "Toggle failed: {p0}", { p0: (error.message) }) })
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
              ? T('jev.t29', "Skill catalog refreshed: {p0} (added {p1}, removed {p2}) · {p3}@{p4}", { p0: (body.count), p1: (body.added), p2: (body.removed), p3: (body.repo), p4: (body.commit) })
              : T('jev.t30', "Refresh failed: {p0}", { p0: (body.error || T('jev.k071', "Unknown error")) }),
          })
        } catch (error) {
          setMessage({ kind: 'bad', text: T('jev.t31', "Refresh failed: {p0}", { p0: (error.message) }) })
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
          setMessage({ kind: body.ok ? 'good' : 'bad', text: body.ok ? T('jev.k080', "At least one gateway is reachable.") : T('jev.k081', "No gateway is reachable; check the addresses and keys.") })
        } catch (error) {
          setMessage({ kind: 'bad', text: T('jev.t32', "Test failed: {p0}", { p0: (error.message) }) })
        } finally {
          setBusy('')
        }
      }

      // #22: 表单语义 —— 每个输入都有 id，标签是 <label for>，点标签能聚焦；
      // 三张网关卡用 fieldset/legend，读屏会念出「JEV 判定 / 决策层 / 执行层」。
      const fieldId = (key, field) => `jev-gw-${key}-${field}`
      const fieldLabel = (key, field, text) => h('label', { style: styles.label, htmlFor: fieldId(key, field) }, text)
      const cards = GATEWAYS.map((gateway) => {
        const entry = form[gateway.key] || { baseUrl: '', apiKey: '', model: '', keySet: false }
        return h('fieldset', { key: gateway.key, style: styles.fieldset },
          h('legend', { style: styles.title },
            gateway.title,
            h('span', { style: styles.hint }, ` — ${gateway.hint}`)),
          h('div', { style: styles.row },
            fieldLabel(gateway.key, 'baseUrl', T('jev.k200', "Base URL")),
            h('input', {
              id: fieldId(gateway.key, 'baseUrl'),
              'aria-label': `${gateway.title} ${T('jev.k200', "Base URL")}`,
              style: styles.input,
              type: 'text',
              spellCheck: false,
              value: entry.baseUrl,
              placeholder: 'https://gateway.example.com/v1',
              onChange: edit(gateway.key, 'baseUrl'),
            }),
          ),
          h('div', { style: styles.row },
            fieldLabel(gateway.key, 'apiKey', T('jev.k201', "API Key")),
            h('input', {
              id: fieldId(gateway.key, 'apiKey'),
              'aria-label': `${gateway.title} ${T('jev.k201', "API Key")}`,
              style: styles.input,
              type: 'password',
              autoComplete: 'off',
              spellCheck: false,
              value: entry.apiKey,
              placeholder: entry.keySet ? T('jev.k082', "Saved (leave blank = unchanged)") : T('jev.k083', "Not set yet"),
              onChange: edit(gateway.key, 'apiKey'),
            }),
          ),
          h('div', { style: styles.row },
            fieldLabel(gateway.key, 'model', T('jev.k202', "Model")),
            h('input', {
              id: fieldId(gateway.key, 'model'),
              'aria-label': `${gateway.title} ${T('jev.k202', "Model")}`,
              style: styles.input,
              type: 'text',
              spellCheck: false,
              value: entry.model,
              placeholder: gateway.key === 'kimi' ? 'kimi-k3.1-pro' : gateway.key === 'dsf' ? 'deepseek-v4.1-flash-1017' : T('jev.k084', "(optional)"),
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
          if (!body.ok) throw new Error(body.error || T('jev.k085', "Read failed"))
          setRoute((previous) => ({
            ...previous,
            catalog: body.catalog,
            resolved: body.resolved,
            dshAvailable: Boolean(body.catalog && body.catalog.ok),
          }))
          const total = (body.catalog && body.catalog.providers || []).reduce((n, p) => n + (p.models || []).length, 0)
          setMessage({ kind: 'good', text: T('jev.t33', "Read {p0} providers / {p1} models", { p0: ((body.catalog && body.catalog.providers || []).length), p1: (total) }) })
        } catch (error) {
          setMessage({ kind: 'bad', text: T('jev.t34', "Failed to read the DSH model list: {p0}", { p0: (error.message) }) })
        } finally { setBusy('') }
      }

      const tierRow = (tierKey, title, hint) => {
        const entry = route[tierKey] || { provider: '', model: '' }
        const models = modelsFor(tierKey)
        const resolved = resolvedFor(tierKey)
        const picked = resolved
          ? `${resolved.provider}/${resolved.model}`
          : T('jev.k086', "(no models available yet)")
        const auto = !entry.provider && !entry.model
        return h('div', { key: tierKey, style: tierStyles.block },
          h('div', { style: tierStyles.head },
            h('span', { style: styles.label }, title),
            h('span', { style: tierStyles.hint }, hint),
          ),
          h('div', { style: styles.row },
            h('label', { style: styles.label, htmlFor: `jev-route-${tierKey}-provider` }, T('jev.k203', "provider")),
            h('select', {
              id: `jev-route-${tierKey}-provider`,
              'aria-label': `${title} ${T('jev.k203', "provider")}`,
              style: styles.input,
              value: entry.provider || '',
              onChange: editRoute(tierKey, 'provider'),
            },
              h('option', { value: '' }, T('jev.k087', "Auto (picked from your DSH gateway)")),
              ...providers.map((p) => h('option', { key: p.id, value: p.id },
                `${p.id}${p.name && p.name !== p.id ? ` (${p.name})` : ''} · ${(p.models || []).length}${T('jev.f03', " models")}`)),
            ),
          ),
          h('div', { style: styles.row },
            h('label', { style: styles.label, htmlFor: `jev-route-${tierKey}-model` }, T('jev.k204', "model")),
            h('select', {
              id: `jev-route-${tierKey}-model`,
              'aria-label': `${title} ${T('jev.k204', "model")}`,
              style: styles.input,
              value: entry.model || '',
              onChange: editRoute(tierKey, 'model'),
            },
              h('option', { value: '' }, entry.provider ? T('jev.k088', "Auto (picked within this provider)") : T('jev.k089', "Auto (pick a suitable one by model name)")),
              ...models.map((m) => h('option', { key: m.id, value: m.id },
                `${m.name && m.name !== m.id ? m.name + ' — ' : ''}${m.id}`)),
            ),
          ),
          h('p', { style: auto ? styles.note : styles.good },
            auto
              ? T('jev.t36', "Will use: {p0}{p1}", { p0: (picked), p1: (resolved && resolved.auto ? T('jev.k090', "(auto-picked; pin it above)") : '') })
              : T('jev.t37', "Will use: {p0}/{p1}", { p0: (entry.provider), p1: (entry.model) })),
        )
      }

      const routeCard = h('div', { style: styles.card },
        h('div', { style: styles.cardHead },
          h('span', { style: styles.cardTitle }, T('jev.k091', "Route · who runs this call")),
          h('button', { type: 'button', style: styles.chip, disabled: Boolean(busy), onClick: refreshCatalog },
            busy === 'catalog' ? T('jev.k092', "Reading…") : T('jev.k093', "Refresh model list")),
        ),
        h('div', { style: styles.actions },
          h('button', {
            type: 'button',
            style: { ...styles.chip, ...(routeMode === 'dsh' ? styles.chipOn : null) },
            onClick: () => setRouteMode('dsh'),
          }, T('jev.k094', "Via DSH gateway (recommended)")),
          h('button', {
            type: 'button',
            style: { ...styles.chip, ...(routeMode === 'direct' ? styles.chipOn : null) },
            onClick: () => setRouteMode('direct'),
          }, T('jev.k095', "Direct to this plugin's gateway")),
        ),
        routeMode === 'dsh'
          ? h('div', null,
            h('p', { style: styles.note },
              T('jev.k096', "JEV only decides who does the work; the actual run uses the providers and keys already in your DSH 'models', and the kimi/dsf keys on this page are not used. The two dropdowns below list the models installed in YOUR DSH — other people have different models, each picks their own.")),
            !route.dshAvailable ? h('p', { style: styles.bad }, T('jev.k097', "This host exposes no llm service, so the DSH gateway cannot be used — switch to direct instead.")) : null,
            tierRow('decision', T('jev.k098', "Decision model (decision tier)"), T('jev.k099', "Judgment, review, architecture, risk")),
            tierRow('execution', T('jev.k100', "Execution model (execution tier)"), T('jev.k101', "Implementation, rewriting, extraction, bulk generation")),
            h('div', { style: styles.switchHead },
              h('div', { style: styles.switchTitleRow },
                h('span', { style: styles.switchTitle }, T('jev.k102', "Let the DSH selector follow")),
                h('span', { style: styles.switchState },
                  followModel
                    ? T('jev.k103', "Current: on — after each successful route, the model name above the composer switches to the one that just worked")
                    : T('jev.k104', "Current: off — the selector keeps the model you picked manually")),
              ),
              h('button', {
                type: 'button',
                role: 'switch',
                'aria-checked': followModel ? 'true' : 'false',
                'aria-label': T('jev.k105', "Let the DSH model selector follow the model that actually ran"),
                title: followModel ? T('jev.k106', "Click to turn off") : T('jev.k107', "Click to turn on"),
                disabled: Boolean(busy) || loading,
                style: styles.track(followModel),
                onClick: () => toggleFollowModel(!followModel),
              }, h('span', { style: styles.knob(followModel) })),
            ),
            h('div', { style: styles.switchHead },
              h('div', { style: styles.switchTitleRow },
                h('span', { style: styles.switchTitle }, T('jev.k108', "Judge confidence threshold")),
                h('span', { style: styles.switchState }, T('jev.k109', "Judgements below this confidence escalate to the decision tier (Kimi), 0–1")),
              ),
              h('span', null,
                h('input', {
                  type: 'number', min: '0', max: '1', step: '0.05',
                  value: lowConfThreshold,
                  'aria-label': T('jev.k108', "Judge confidence threshold"),
                  disabled: Boolean(busy) || loading,
                  onChange: (e) => setLowConfThreshold(e.target.value),
                  style: { ...MIN_TARGET, width: '72px', marginRight: '8px' },
                }),
                h('button', {
                  type: 'button', style: styles.button,
                  disabled: Boolean(busy) || loading,
                  onClick: saveThreshold,
                }, busy === 'lowConfidenceThreshold' ? T('jev.k110', "Saving…") : T('jev.k111', "Save threshold")),
              ),
            ),
            h('div', { style: styles.switchHead },
              h('div', { style: styles.switchTitleRow },
                h('span', { style: styles.switchTitle }, T('jev.h001', 'Auto conversation history')),
                h('span', { style: styles.switchState },
                  historyAuto
                    ? T('jev.h002', 'On — mounts the last few turns (bounded, never logged)')
                    : T('jev.h003', 'Off — only your task/context')),
              ),
              h('button', {
                type: 'button', role: 'switch',
                'aria-checked': historyAuto ? 'true' : 'false',
                'aria-label': T('jev.h001', 'Auto conversation history'),
                disabled: Boolean(busy) || loading,
                style: { ...styles.track(historyAuto), minHeight: 32, minWidth: 32 },
                onClick: () => toggleHistoryAuto(!historyAuto),
              }, h('span', { style: styles.knob(historyAuto) })),
            ),
            historyAuto ? h('div', { style: styles.switchHead },
              h('span', { style: styles.switchTitle }, T('jev.h004', 'Turn cap')),
              h('span', null,
                h('input', {
                  type: 'number', min: '1', max: '50', step: '1',
                  value: historyTurns,
                  'aria-label': T('jev.h004', 'Turn cap'),
                  disabled: Boolean(busy) || loading,
                  onChange: (e) => setHistoryTurns(e.target.value),
                  style: { width: '64px', marginRight: '8px', minHeight: 32 },
                }),
                h('button', {
                  type: 'button', style: { ...styles.button, minHeight: 32, minWidth: 32 },
                  disabled: Boolean(busy) || loading,
                  onClick: saveHistoryTurns,
                }, busy === 'historyTurns' ? T('jev.k110', 'Saving…') : T('jev.h005', 'Save turns')),
              ),
            ) : null,
            route.follow
              ? h('p', { style: styles.note }, T('jev.t38', "DSH selector now points at: {p0}/{p1} (auto prefers this provider)", { p0: (route.follow.provider), p1: (route.follow.model) }))
              : null,
            !providers.length
              ? h('p', { style: styles.note }, T('jev.k112', "No model list yet: click 'Refresh model list' top-right to pull it from your DSH gateway."))
              : null,
          )
          : h('p', { style: styles.note },
            T('jev.k113', "This plugin calls the gateways below with its own base URLs and keys; DSH model settings are not involved. Use this when DSH lacks the model you want.")),
      )

      const resultLines = results === null ? null : h('div', {
        style: styles.card,
        // #22: 探测结果是异步到达的，读屏要能听到。
        role: 'status', 'aria-live': 'polite',
      },
        h('span', { style: styles.title }, T('jev.k114', "Connectivity probe")),
        ...results.map((entry) => h('p', { key: entry.key, role: entry.ok ? 'status' : 'alert', style: entry.ok ? styles.good : styles.bad },
          `${entry.key}: ${entry.ok ? 'OK' : 'FAIL'} — ${entry.detail}` +
          (entry.ok && entry.models && entry.models.length
            ? T('jev.t39', "\n    Models served: {p0}", { p0: (entry.models.slice(0, 12).join(', ')) })
            : ''),
        )),
      )

      const badge = stateBadge(state)
      const switchCard = h('div', { style: styles.switchCard },
        h('div', { style: styles.switchHead },
          h('div', { style: styles.switchTitleRow },
            h('span', { style: styles.switchTitle }, T('jev.k115', "Master switch")),
            h('span', { style: styles.switchState },
              `${badge.label} — ${badge.hint}`),
          ),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': enabled ? 'true' : 'false',
            'aria-label': T('jev.k116', "Enable or disable JEV tiered routing"),
            title: enabled ? T('jev.k106', "Click to turn off") : T('jev.k107', "Click to turn on"),
            disabled: Boolean(busy) || loading,
            style: styles.track(enabled),
            onClick: () => toggle(!enabled),
          }, h('span', { style: styles.knob(enabled) })),
        ),
        h('p', { style: styles.switchBody },
          enabled
            ? T('jev.k117', "On: decision/quality tasks go to Kimi, routine execution to DeepSeek Flash. This is routing intent; any round that did not go through JEV is honestly marked on the board and decision card.")
            : T('jev.k118', "Off: the plugin steps aside entirely. Tasks use DSH's own configured model gateway; harness_call and friends just return an 'OFF' note."),
        ),
        state !== 'ready'
          ? h('p', { style: styles.hint }, T('jev.t40', "JEV not ready; model selection temporarily restored ({p0})", { p0: (badge.label) }))
          : null,
      )

      const skillsInfo = skills || { count: 0, cached: 0, source: 'bundled', repo: '' }
      const skillsCard = h('div', { style: styles.card },
        h('div', { style: styles.head },
          h('span', { style: styles.title }, T('jev.k119', "Skill library · mattpocock/skills")),
          h('span', { style: styles.hint },
            T('jev.t41', "{p0} skills · {p1} bodies cached · catalog source {p2}", { p0: (skillsInfo.count || 0), p1: (skillsInfo.cached || 0), p2: (skillsInfo.source === 'refreshed' ? T('jev.k120', "Refreshed") : T('jev.k121', "Bundled with the plugin")) })),
        ),
        h('div', { style: styles.switchHead },
          h('div', { style: styles.switchTitleRow },
            h('span', { style: styles.switchTitle }, T('jev.k122', "Auto-mount skill")),
            h('span', { style: styles.switchState },
              skillsAuto
                ? T('jev.k123', "Current: on — before each task JEV picks which skill to use and sends its instructions to the model")
                : T('jev.k124', "Current: off — no skill attached, tiered routing only")),
          ),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': skillsAuto ? 'true' : 'false',
            'aria-label': T('jev.k125', "Auto-mount mattpocock skill"),
            title: skillsAuto ? T('jev.k106', "Click to turn off") : T('jev.k107', "Click to turn on"),
            disabled: Boolean(busy) || loading,
            style: styles.track(skillsAuto),
            onClick: () => toggleSkillsAuto(!skillsAuto),
          }, h('span', { style: styles.knob(skillsAuto) })),
        ),
        h('p', { style: styles.switchBody },
          T('jev.k126', "Candidates from "),
          h('code', null, 'github.com/mattpocock/skills'),
          T('jev.k127', "'s 39 skills (TDD, code-review, diagnosing-bugs, wayfinder, to-spec, etc.). The same JEV judge picks; none means no skill is needed."),
        ),
        h('div', { style: styles.actions },
          state === 'ready'
            ? h('button', { style: styles.button, disabled: Boolean(busy), onClick: refreshSkills },
              busy === 'skillsRefresh' ? T('jev.k128', "Refreshing…") : T('jev.k129', "Refresh skill catalog"))
            : null,
        ),
      )

      const decisionsCard = h('div', { style: styles.card },
        h('div', { style: styles.cardHead },
          h('span', { style: styles.cardTitle }, T('jev.k130', "Recent decisions · who did the work")),
          h('span', { style: styles.note }, decisions.length ? T('jev.t42', "last {p0}", { p0: (decisions.length) }) : ''),
        ),
        decisions.length === 0
          ? h('p', { style: styles.note }, T('jev.k131', "Nothing has gone through JEV yet. Once the switch is on, every judgement is recorded here: result, confidence, actual model, latency."))
          : decisions.map((d, i) => {
            const key = `${String(d && d.t) || ''}|${i}`
            return h(DecisionRow, {
              key,
              d,
              index: i,
              expanded: openDecision === key,
              onToggle: () => setOpenDecision((previous) => (previous === key ? '' : key)),
            })
          }),
      )

      return h('div', { style: styles.wrap, 'data-jev-a11y': '1' },
        switchCard,
        routeCard,
        decisionsCard,
        h(TrafficBoard),
        state === 'setup' ? null : skillsCard,
        h('p', { style: styles.lead },
          T('jev.k132', "After filling each tier's gateway address and key, click 'Save'. Values are stored in a local file "),
          h('code', null, file || '<DSH_HOME>/jev-harness.json'),
          T('jev.k133', ", are NOT written into DSH's provider config, and need no restart."),
        ),
        h('div', { id: 'jev-settings' }, ...cards),
        h('div', { style: styles.actions },
          h('button', { style: styles.buttonPrimary, disabled: Boolean(busy) || loading, onClick: save },
            busy === 'save' ? T('jev.k110', "Saving…") : T('jev.k134', "Save")),
          h('button', { style: styles.button, disabled: Boolean(busy), onClick: test },
            busy === 'test' ? T('jev.k135', "Probing…") : T('jev.k036', "Test connectivity")),
          loading ? h('span', { style: styles.note }, T('jev.k092', "Reading…")) : null,
        ),
        // #22: live region 常驻（空着也渲染），读屏才有稳定的节点可播报；
        // 只有 message 到达时才换文案与 role。
        h('p', {
          role: message && message.kind === 'bad' ? 'alert' : 'status',
          'aria-live': message && message.kind === 'bad' ? 'assertive' : 'polite',
          style: message
            ? (message.kind === 'bad' ? styles.bad : message.kind === 'good' ? styles.good : styles.note)
            : { ...styles.note, opacity: 0.7 },
        }, message ? message.text : ''),
        resultLines,
        h('p', { style: styles.note },
          T('jev.k136', "The model name must be the gateway's real id: if unsure, click 'Test connectivity' and the probe lists the models the gateway actually serves."),
        ),
      )
    }

    // Full-page body for the sidebar entry: a title plus the same config form.
    function HarnessPage(pageProps) {
      if (pageProps && pageProps.__throwForTest) throw new Error('panel exploded (test seam)')
      return h('div', { style: styles.page, 'data-jev-a11y': '1' },
        h('div', { style: styles.pageInner },
          h('h1', { style: styles.pageTitle }, T('jev.k137', "JEV tiered harness")),
          h('p', { style: styles.pageSub },
            T('jev.k138', "Decision/quality tasks to Kimi, routine execution to DeepSeek Flash. Fill each gateway's address, key and real model id here.")),
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
        title: T('jev.k139', "JEV auto-routing: every instruction is first judged by JEV, then sent to Kimi or DeepSeek Flash — no tier to pick, and the DSH model is not selectable. Turn off the JEV switch in the composer to restore it."),
        style: {
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          padding: '2px 8px', borderRadius: '999px',
          border: '1px solid rgba(63,185,80,.55)', background: 'rgba(63,185,80,.12)',
          fontSize: '12px', lineHeight: 1.2, whiteSpace: 'nowrap',
        },
      },
        h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: '#3fb950', flex: 'none' } }),
        T('jev.k140', "JEV auto-route"),
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
      dim: { opacity: 0.7 },
      task: { opacity: 0.7, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      hint: { opacity: 0.7 },
      badge: (color) => ({
        display: 'inline-block', padding: '0 6px', borderRadius: '999px',
        border: '1px solid ' + color, color, fontSize: '10px', lineHeight: '16px',
      }),
    }

    /**
     * #36：悬停到浮层出现的延迟。验收要求「300ms 内出现」——鼠标扫过就弹会闪，
     * 所以取 120ms：既快于 300ms 的上限，也不会因为划过而闪一下。
     */
    const HOVER_OPEN_DELAY_MS = 120

    function shortClock(iso) {
      try {
        const d = new Date(iso)
        const pad = (n) => String(n).padStart(2, '0')
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`
      } catch { return '--:--' }
    }

    /** One decision row: who judged, what it chose, who actually answered. */
    function decisionDetail(d) {
      if (!d || typeof d !== 'object') return { judge: T('jev.k141', "unknown"), model: T('jev.k141', "unknown"), usage: '', tone: '#8b949e' }
      const source = d.source || 'explicit'
      const tierText = d.choice || d.tier || '?'
      let judge
      let tone = '#8b949e'
      if (source === 'jev') {
        const conf = typeof d.confidence === 'number' && Number.isFinite(d.confidence)
          ? ` (${d.confidence.toFixed(2)})`
          : ''
        judge = T('jev.t43', "JEV judge {p0}{p1}", { p0: (tierText), p1: (conf) })
        tone = d.tier === 'decision' ? '#a371f7' : '#3fb950'
      } else if (source === 'heuristic') {
        judge = T('jev.t44', "heuristic {p0} (JEV not involved){p1}", { p0: (tierText), p1: (d.degraded ? T('jev.k142', " · degraded") : '') })
        tone = '#d29922'
      } else if (source === 'fallback') {
        judge = T('jev.k143', "JEV not involved · degraded")
        tone = '#d29922'
      } else {
        judge = T('jev.t45', "manual {p0}", { p0: (tierText) })
      }
      if (d.ok === false) tone = '#f85149'
      const model = d.provider ? `${d.provider} · ${d.model || '?'}` : T('jev.k144', "Model not called")
      const tokens = (Number(d.pt) || 0) + (Number(d.ct) || 0)
      const usage = [
        `${tokens} tokens`,
        `${d.ms || 0}ms`,
        d.skill ? `skill=${d.skill}` : '',
        d.ok === false ? T('jev.k145', "Call failed") : '',
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
            T('jev.k146', "Nothing through JEV yet: once on, every judgement is recorded here (result / confidence / actual model / latency)."))]
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
      return h('div', { style: { ...tipStyles.panel, pointerEvents: 'none' }, role: 'tooltip', 'aria-label': T('jev.k147', "Recent decisions") },
        h('div', { style: tipStyles.head },
          h('span', null, T('jev.k130', "Recent decisions · who did the work")),
          h('span', { style: { marginLeft: 'auto' } }, decisions.length ? T('jev.t42', "last {p0}", { p0: (decisions.length) }) : ''),
        ),
        rows,
      )
    }

    /**
     * 面板「最近决策」的一行（#36）：收起时只有三行摘要，点开才显示 task 摘要
     * 与完整的 probabilities。纯组件 + 受控 expanded，所以两种状态都能直接渲染测试。
     */
    function DecisionRow({ d, index, expanded, onToggle }) {
      const info = decisionDetail(d)
      const probabilities = d && d.probabilities && typeof d.probabilities === 'object'
        ? Object.entries(d.probabilities)
        : []
      const base = index === 0 ? tipStyles.rowFirst : tipStyles.row
      return h('div', {
        style: onToggle ? { ...base, cursor: 'pointer' } : base,
        onClick: onToggle || undefined,
        role: onToggle ? 'button' : undefined,
        tabIndex: onToggle ? 0 : undefined,
        'aria-expanded': onToggle ? (expanded ? 'true' : 'false') : undefined,
        title: onToggle ? (expanded ? T('jev.k148', "Click to collapse") : T('jev.k149', "Click to expand task summary and full probabilities")) : undefined,
      },
        h('div', { style: tipStyles.line1 },
          h('span', { style: tipStyles.dim }, shortClock(info.at)),
          h('span', { style: { ...tipStyles.judge, color: info.tone } }, info.judge),
          h('span', { style: tipStyles.dim }, '→'),
          h('span', null, info.model),
          info.usage ? h('span', { style: tipStyles.dim }, `· ${info.usage}`) : null,
        ),
        expanded
          ? h('div', null,
            info.task ? h('div', { style: tipStyles.task, title: info.task }, T('jev.t46', "Task: {p0}", { p0: (info.task) })) : null,
            probabilities.length
              ? h('div', { style: tipStyles.dim }, `${T('jev.f47', "Criteria: ")}${probabilities.map(([k, v]) => `${k} ${v}`).join(' · ')}`)
              : h('div', { style: tipStyles.dim }, T('jev.k150', "Criteria: the judge returned no probabilities this time")),
            info.error ? h('div', { style: { color: '#f85149' } }, info.error) : null,
          )
          : null,
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
        case 'ready': return { label: T('jev.k151', "JEV in control"), hint: T('jev.k152', "Kimi judges / Flash executes"), color: '#3fb950' }
        case 'setup': return { label: T('jev.k153', "JEV needs one more step"), hint: T('jev.k154', "Fill in the gateway address"), color: '#d29922' }
        case 'off': return { label: T('jev.k028', "JEV has stepped aside"), hint: T('jev.k155', "Handled by the DSH model"), color: 'rgba(127,127,127,.9)' }
        case 'degraded': return { label: T('jev.k156', "JEV error"), hint: T('jev.k157', "Last call failed"), color: '#f85149' }
        default: return { label: T('jev.k158', "Status unknown"), hint: T('jev.k159', "Click to retry"), color: 'rgba(127,127,127,.65)' }
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
      const hoverTimer = react.useRef(null)
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

      // #36：悬停 120ms 后弹浮层并立刻刷新一次 /status，保证看到的是刚刚那条。
      const openHover = react.useCallback(() => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current)
        hoverTimer.current = setTimeout(() => {
          hoverTimer.current = null
          setHover(true)
          load()
        }, HOVER_OPEN_DELAY_MS)
      }, [load])

      const closeHover = react.useCallback(() => {
        if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null }
        setHover(false)
      }, [])

      // 卸载时清掉未触发的定时器，避免对已卸载组件 setState。
      react.useEffect(() => () => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current)
      }, [])

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
        ? T('jev.k160', "JEV harness: reading status… (hover for recent decisions)")
        : `${badge.label} · ${badge.hint}${toggleError ? `\n${T('jev.f48a', "Last toggle failed: ")}${toggleError}${T('jev.f48b', " — click to retry")}` : ''}`

      const on = state === 'ready'
      const button = h('button', {
        type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        'aria-label': state === null
          ? T('jev.k161', "Reading JEV harness status")
          : state === 'unknown'
            ? T('jev.k162', "Status unknown, click to retry")
            : T('jev.t49', "{p0}, click to turn {p1}", { p0: (badge.label), p1: (enabled ? T('jev.k163', "Off") : T('jev.k164', "On")) }),
        disabled: busy,
        onClick: toggle,
        style: {
          ...MIN_TARGET,
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
        'data-jev-a11y': '1',
        onMouseEnter: openHover,
        onMouseLeave: closeHover,
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
          next.version = status.version || T('jev.k165', "Not provided")
          next.state = status.state || 'unknown'
          next.status = 'ok'
        } catch (error) {
          next.status = `fail: ${String((error && error.message) || error)}`
          next.version = next.version || T('jev.k165', "Not provided")
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
          this.setState({ copied: T('jev.k166', "Diagnostics copied") })
        } catch {
          this.setState({ copied: T('jev.k167', "Copy failed; please select the diagnostics manually") })
        }
        return text
      }

      render() {
        if (!this.state.error) return this.props.children
        const diag = this.state.diag || {}
        return h('div', { style: styles.card, role: 'alert' },
          h('div', { style: styles.head },
            h('span', { style: styles.title }, T('jev.k168', "Panel failed to load")),
            h('span', { style: styles.hint }, T('jev.t50', "Version: {p0}", { p0: (diag.version || T('jev.k092', "Reading…")) }))),
          h('p', { style: styles.switchBody }, T('jev.k169', "The panel threw during render; the rest of the plugin is unaffected. Reload the panel, or copy the diagnostics to investigate.")),
          h('p', { style: styles.note }, T('jev.t51', "Last error: {p0}", { p0: (diag.message || String((this.state.error && this.state.error.message) || '')) })),
          h('p', { style: styles.note }, T('jev.t52', "Status API: {p0} · stats API: {p1}", { p0: (diag.status || T('jev.k170', "Checking")), p1: (diag.stats || T('jev.k170', "Checking")) })),
          h('p', { style: styles.note }, T('jev.t53', "slot registration: {p0}", { p0: ((diag.slots && diag.slots.length ? diag.slots.join(', ') : T('jev.k171', "Not recorded"))) })),
          h('div', { style: styles.actions },
            h('button', { type: 'button', style: styles.button, onClick: this.reload }, T('jev.k172', "Reload panel")),
            h('button', { type: 'button', style: styles.button, onClick: this.copyDiagnostics }, T('jev.k173', "Copy diagnostics"))),
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
          h('span', { style: styles.title }, T('jev.k174', "JEV harness")),
          h('span', { style: styles.hint }, `${badge.label} · ${badge.hint}`)),
        h('p', { style: styles.switchBody }, T('jev.k175', "Full settings (gateways, keys, model ids, skill library) live in the sidebar JEV panel; only the entry and master switch are kept here.")),
        h('div', { style: styles.actions },
          h('button', { type: 'button', style: styles.button, onClick: () => openPanel() }, T('jev.k176', "Open JEV panel")),
          h('button', {
            type: 'button', role: 'switch', 'aria-checked': state !== 'off' ? 'true' : 'false',
            'aria-label': T('jev.k116', "Enable or disable JEV tiered routing"), disabled: busy,
            onClick: toggle,
          }, state === 'off' ? T('jev.k030', "Turn on JEV") : T('jev.k177', "Turn off JEV"))),
      )
    }

    function renderConfigSeat() {
      return h(PanelBoundary, null, h(SettingsSeat, null))
    }

    function apply(ctx) {
      ensureA11yStyles()
      hostCtx = ctx
      // #20: bind the locale bundle once for the whole module.
      try { if (ctx.locale && typeof ctx.locale.bind === 'function') __jevLocale = ctx.locale.bind(LOCALE_NS) } catch { /* keep key-echo fallback */ }
      // #20 F1: fill the label maps NOW that the locale is bound (production never
      // evaluates them at load time, so they can no longer freeze to English).
      TRAFFIC_NAMES = { jev: T('jev.k007', "JEV judge"), kimi: T('jev.k008', "Kimi decision"), dsf: T('jev.k009', "Flash execution") }
      SOURCE_LABELS = { jev: T('jev.k007', "JEV judge"), heuristic: T('jev.k019', "heuristic"), fallback: T('jev.k020', "degraded"), explicit: T('jev.k021', "manual") }
      TOOL_LABELS = {
        call: T('jev.k013', "answer"), judge: T('jev.k014', "judge"), classify: T('jev.k014', "judge"), probe: T('jev.k015', "connectivity test"),
        review: T('jev.k016', "review"), 'skill-pick': T('jev.k017', "pick skill"), adapter: T('jev.k018', "adapter route"),
      }
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
            label: () => label(ctx, 'jev.panel', T('jev.k174', "JEV harness")),
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
    exports.__test = { TrafficBoard, TrafficBoardView, TrafficChart, TrafficTimeline, trafficRows, liveLine, totalCalls, lastCallLine, emptyState, trafficWindowState, PanelBoundary, HarnessPage, HarnessConfig, SettingsSeat, openPanel, shouldFollowDecision, publishBridgeState, publishIfUnchanged, bridgeStateSeqNow, subscribeBridgeState, setBridgeEnabled, HarnessConfig, ComposerChip, ModelLock, DecisionTip, DecisionRow, decisionDetail, decisionsOf, HOVER_OPEN_DELAY_MS, A11Y_CSS, ensureA11yStyles, MIN_TARGET, stateBadge }
    return module.exports
  },
})
