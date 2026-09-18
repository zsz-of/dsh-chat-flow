/**
 * 测试用的客户端 bundle 装载器与替身。
 *
 * bundle 是 `window.__ModuleLoader__.load({...})` 形式的手写 CJS 注册，所以测试里把它当
 * **脚本文本**用 `new Function` 求值，再手动调 `factory(require)` —— 这样不需要浏览器、
 * 不需要打包器，而且 `require` 由测试自己控制（既能塞真 React，也能塞能抓错的手写替身）。
 *
 * @module test/helpers/load-bundle
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** 生成的客户端 bundle 路径。 */
export const BUNDLE = join(HERE, '..', '..', 'lib', 'client.js')

/** 覆盖 Node 的全局对象（Node 24 的 `navigator` 是只读访问器，必须用 defineProperty）。 */
function defineGlobal(key, value) {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}

/** 一个最小的 localStorage 替身，可注入失败以验证降级路径。 */
export function createStorage({ fail = false } = {}) {
  const map = new Map()
  return {
    getItem(key) {
      if (fail) throw new Error('storage disabled')
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      if (fail) throw new Error('storage disabled')
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
    /** 测试读取用。 */
    raw: map,
  }
}

/**
 * 手写 React 替身：`createElement` **直接调用函数组件**。
 *
 * 这么做能在 node 里跑完整渲染而不需要 DOM，而且能抓到「组件是 undefined」这类错误
 * （真实 React 的表现是整块白屏，很难定位）。
 *
 * @returns React 替身。
 */
export function createFakeReact() {
  const react = {
    createElement(type, props, ...children) {
      if (type === undefined || type === null) throw new Error('createElement 收到了未定义的组件（拼写错误或未导出）')
      const merged = { ...(props ?? {}) }
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      if (typeof type === 'function') return type(merged)
      return { type, props: merged }
    },
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (initial) => ({ current: initial ?? null }),
    memo: (component) => component,
  }
  return react
}

/**
 * primitives 替身：取任何名字都得到一个「渲染 children 或 text」的组件。
 *
 * 之所以连 `text` 也渲染：`MarkdownText` / `MessageText` 都是**用 prop 传正文**的
 * （没有 children），纯 children 替身会让正文在断言里凭空消失。
 */
export function createPrimitivesStub() {
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'then' || typeof key === 'symbol') return undefined
        return function Stub(props) {
          const given = props ?? {}
          const children =
            given.children !== undefined
              ? given.children
              : typeof given.text === 'string'
                ? given.text
                : undefined
          return { type: 'primitive', props: { name: String(key), children } }
        }
      },
    },
  )
}

/**
 * 装载 bundle 并返回它的导出对象。
 *
 * @param options - `react` / `primitives` 替身，`storage` 与 `document` 覆盖。
 * @returns `{exports, registration, requireCount}`。
 */
export async function loadBundle(options = {}) {
  const source = await readFile(BUNDLE, 'utf8')
  const react = options.react ?? createFakeReact()
  const primitives = options.primitives ?? createPrimitivesStub()
  const storage = options.storage ?? createStorage()
  const appendedStyles = []
  const elements = new Map()
  let registration
  const requested = []

  defineGlobal('window', {
    __ModuleLoader__: {
      load(entry) {
        registration = entry
      },
    },
    localStorage: storage,
  })
  /* 极简 DOM：`getElementById` 认识 `head.appendChild` 过的带 id 节点，
     这样「按 id 去重注入样式」这类行为能被真实断言，而不是永远返回 null。 */
  defineGlobal('document', {
    getElementById: (id) => elements.get(id) ?? null,
    createElement: () => ({ id: '', style: {}, dataset: {}, appendChild() {}, remove() {} }),
    head: {
      appendChild(node) {
        if (typeof node.id === 'string' && node.id !== '') elements.set(node.id, node)
        appendedStyles.push(node)
      },
    },
    body: { appendChild() {}, removeChild() {} },
    querySelector: () => null,
  })
  defineGlobal('navigator', { userAgent: 'node-test' })

  new Function('window', 'document', 'navigator', source)(globalThis.window, globalThis.document, globalThis.navigator)

  if (registration === undefined) throw new Error('bundle 没有调用 window.__ModuleLoader__.load')
  const requireImpl = (id) => {
    requested.push(id)
    if (id === 'react') return react
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`测试未提供模块：${id}`)
  }
  return { exports: registration.factory(requireImpl), registration, requested, appendedStyles, storage }
}

/**
 * 遍历手写渲染器产出的元素树，收集所有文本。
 *
 * @param element - `createElement` 的返回值。
 * @returns 拼接后的文本。
 */
export function collectText(element) {
  const parts = []
  const walk = (value) => {
    if (value === null || value === undefined || value === false || value === true) return
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value))
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (typeof value === 'object' && value.props !== undefined) walk(value.props.children)
  }
  walk(element)
  return parts.join(' ')
}
