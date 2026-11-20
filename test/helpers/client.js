/**
 * 客户端半边（lib/client.js）的离线装载器。
 *
 * lib/client.js 是浏览器脚本：它调用 window.__ModuleLoader__.load({ id, factory })，
 * 由宿主注入 react。这里用 vm 造一个等价沙箱，把组件拿出来做真渲染。
 *
 * react 解析顺序（不写死绝对路径）：
 *   1. JEV_REACT_DIR（显式指定时）
 *   2. 本机 DSH desktop profile：<home>/.dsh/profiles/desktop/node_modules
 *   3. 仓库自己的 node_modules（CI 里由 devDependencies 提供）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { CLIENT, REPO } from './harness.js'

export function resolveReact() {
  const dirs = []
  if (process.env.JEV_REACT_DIR) dirs.push(process.env.JEV_REACT_DIR)
  dirs.push(path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'node_modules'))
  dirs.push(path.join(REPO, 'node_modules'))
  for (const dir of dirs) {
    try {
      const req = createRequire(path.join(dir, 'noop.js'))
      const react = req('react')
      const server = req('react-dom/server')
      const jsx = req('react/jsx-runtime')
      return { react, server, jsx, dir }
    } catch { /* 试下一个候选目录 */ }
  }
  return null
}

export const REACT_MISSING =
  'react / react-dom 未解析到：本机应存在 <home>/.dsh/profiles/desktop/node_modules，CI 里由 devDependencies 提供'

/**
 * 在沙箱里执行 lib/client.js，返回 { id, exports }。
 * 沙箱只给 window.__ModuleLoader__ / console / fetch / 定时器；
 * fetch 必须是测试已装好的 stub，否则会走真网络。
 */
export function loadClient(reactPkgs, { fetch = globalThis.fetch } = {}) {
  const source = fs.readFileSync(CLIENT, 'utf8')
  const captured = { id: null, exports: null }
  const fakeRequire = (name) => {
    if (name === 'react') return reactPkgs.react
    if (name === 'react/jsx-runtime') return reactPkgs.jsx
    if (name === 'react-dom') return reactPkgs.reactDom || {}
    throw new Error(`unexpected require: ${name}`)
  }
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load({ id, factory }) {
          captured.id = id
          captured.exports = factory(fakeRequire)
        },
      },
    },
    console,
    fetch,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: CLIENT })
  if (!captured.exports) throw new Error('ModuleLoader.load was never called')
  if (typeof captured.exports.apply !== 'function') throw new Error('client exports.apply is missing')
  return captured
}

/**
 * 假 slots 宿主。
 * 注意 register(def, comp)：第二个参数才是组件本体。只取 def 会让渲染报
 * "Element type is invalid" —— issue #1 专门点名了这个坑。
 */
export function applyClient(loaded, { messages = {} } = {}) {
  const registrations = []
  const injections = []
  const ctx = {
    slots: {
      inject(name, run) {
        injections.push(name)
        const off = run && run()
        return typeof off === 'function' ? off : () => {}
      },
      register(def, comp) {
        registrations.push({ def, comp })
        return () => {}
      },
    },
    locale: { bind: () => (key) => messages[key] || key },
  }
  const dispose = loaded.exports.apply(ctx)
  return { ctx, registrations, injections, dispose }
}

/** 找某个 slot 的注册项。 */
export function findSlot(registrations, name) {
  return registrations.find((entry) => entry.def && entry.def.name === name) || null
}

/** 静态渲染一个组件，返回 HTML 字符串。 */
export function render(reactPkgs, component, props = {}) {
  return reactPkgs.server.renderToStaticMarkup(reactPkgs.react.createElement(component, props))
}

/** 去掉标签后的可见文本，用来断言「页面上真能看见这些字」。 */
export function visibleText(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}