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
window.__ModuleLoader__.load({
  id: '@zrxparley/dsh-jev-harness',
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

    async function request(path, init) {
      const response = await fetch(`${API}${path}`, {
        credentials: 'same-origin',
        ...init,
        headers: { 'content-type': 'application/json', ...(init && init.headers ? init.headers : {}) },
      })
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

    function HarnessConfig() {
      const [form, setForm] = react.useState(emptyForm)
      const [file, setFile] = react.useState('')
      const [loading, setLoading] = react.useState(true)
      const [busy, setBusy] = react.useState('')
      const [message, setMessage] = react.useState(null)
      const [results, setResults] = react.useState(null)
      const [enabled, setEnabled] = react.useState(true)

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
        setFile(status.file || '')
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

      return h('div', { style: styles.wrap },
        switchCard,
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

    // Runtime seat control for that single slot: claim it only while ON.
    const modelSeat = { register: null, release: null }

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

    function ComposerChip() {
      const [status, setStatus] = react.useState(null)
      const [busy, setBusy] = react.useState(false)
      // null = not read yet, so the switch never claims a state it has not seen.
      const enabled = status === null ? null : status.enabled !== false

      const load = react.useCallback(() => {
        request('/status', { method: 'GET' })
          .then((next) => { setStatus(next); syncModelSeat(next.enabled !== false) })
          .catch(() => setStatus({ enabled: false }))
      }, [])

      react.useEffect(() => { load() }, [load])

      const toggle = async () => {
        if (busy) return
        if (enabled === null) { load(); return }
        setBusy(true)
        const next = !enabled
        setStatus({ enabled: next })
        syncModelSeat(next)
        try {
          const confirmed = await request('/toggle', { method: 'POST', body: JSON.stringify({ enabled: next }) })
          setStatus(confirmed)
          syncModelSeat(confirmed.enabled !== false)
        } catch {
          setStatus({ enabled })
          syncModelSeat(enabled)
        } finally {
          setBusy(false)
        }
      }

      const title = enabled === null
        ? 'JEV 分级调度：正在读取状态…'
        : enabled
          ? '已开启：接下来必须走 JEV（Kimi 决策 / Flash 执行），DSH 模型不可选。点击关闭。'
          : '已关闭：走 DSH 自身的模型网关。点击开启。'

      const on = enabled === true
      return h('button', {
        type: 'button',
        'aria-pressed': on ? 'true' : 'false',
        'aria-label': enabled === null
          ? 'JEV 分级调度状态读取中'
          : on ? 'JEV 分级调度已开启，点击关闭' : 'JEV 分级调度已关闭，点击开启',
        title,
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
    }

    function renderConfigSeat(slotProps) {
      if (slotProps && slotProps.view === 'summary') {
        return h('span', { style: { fontSize: '12px', opacity: 0.7 } },
          'JEV 判定 · Kimi/Flash 自动分流 · 可在此填写网关与密钥')
      }
      return h(HarnessConfig, null)
    }

    function apply(ctx) {
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
            { name: 'conversation.input.left', id: LOCALE_NS, order: 30 },
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
    return module.exports
  },
})
