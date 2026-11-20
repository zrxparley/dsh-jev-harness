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
 * 渲染用例的环境闸门。
 *
 * 缺 react 时**默认让整个测试文件失败**，而不是安静 skip —— 否则一份装不上依赖的
 * CI 会显示全绿，而渲染断言其实一条都没跑。只有在确实没有 react 的环境里
 * （例如离线手工排查）显式设 JEV_ALLOW_NO_REACT=1 才降级成 skip，并打印原因。
 */
export function requireReactOrSkip() {
  const pkgs = resolveReact()
  if (pkgs) return { pkgs, skip: false }
  if (process.env.JEV_ALLOW_NO_REACT === '1') return { pkgs: null, skip: REACT_MISSING }
  throw new Error(
    `${REACT_MISSING}。渲染用例不允许静默跳过：用 JEV_REACT_DIR 指向含 react 的 node_modules，` +
    '或在确实取不到 react 的环境里显式设 JEV_ALLOW_NO_REACT=1（会打印 skip 原因）',
  )
}

/**
 * 在沙箱里执行 lib/client.js，返回 { id, exports }。
 * 沙箱只给 window.__ModuleLoader__ / console / fetch / 定时器；
 * fetch 必须是测试已装好的 stub，否则会走真网络。
 */
export function loadClient(reactPkgs, { fetch = globalThis.fetch, boot, clientPath = CLIENT } = {}) {
  const source = fs.readFileSync(clientPath, 'utf8')
  const captured = { id: null, exports: null }
  const fakeRequire = (name) => {
    if (name === 'react') return reactPkgs.react
    if (name === 'react/jsx-runtime') return reactPkgs.jsx
    if (name === 'react-dom') return reactPkgs.reactDom || {}
    throw new Error(`unexpected require: ${name}`)
  }
  const sandbox = {
    window: {
      ...(boot === undefined ? {} : { __DSH_BOOT__: boot }),
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
  vm.runInContext(source, sandbox, { filename: clientPath })
  if (!captured.exports) throw new Error('ModuleLoader.load was never called')
  if (typeof captured.exports.apply !== 'function') throw new Error('client exports.apply is missing')
  return captured
}

/**
 * 假 slots 宿主。
 * 注意 register(def, comp)：第二个参数才是组件本体。只取 def 会让渲染报
 * "Element type is invalid" —— issue #1 专门点名了这个坑。
 */
export function applyClient(loaded, { messages = {}, services = {} } = {}) {
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
    get(name) { return services[name] },
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