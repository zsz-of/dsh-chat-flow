/**
 * 滚动行为测试：触顶自动加载更早的历史 + 当前位置锚定 + 当前回合跟踪。
 *
 * 这段逻辑全在 effect 与 scroll 回调里，真机上出错的表现是「滚上去不加载」或
 * 「一路把所有历史拉完」。用 hook 探针（`test/helpers/probe-react.mjs`）在 node 里把它拉进单测，
 * 比等到真机上肉眼判断便宜得多。
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { loadBundle } from './helpers/load-bundle.mjs'
import { createFakeScroller, createProbeReact } from './helpers/probe-react.mjs'

const { react, mount } = createProbeReact()
const { exports } = await loadBundle({ react })
const { useScroller, TOP_LOAD_THRESHOLD_PX } = exports.__internals

/**
 * 挂载探针：跑一次 `useScroller` 并把调用记录收下来。
 *
 * @param options - `turns`、`hasMore`、`loadingOlder`、`loadOlder`。
 * @param scrollerOptions - 假滚动宿主的初始状态。
 * @returns `{harness, fake, calls}`。
 */
function probeScroller(options, scrollerOptions = {}) {
  const fake = createFakeScroller(scrollerOptions)
  const rootRef = { current: fake.root }
  const calls = []
  const state = {
    hasMore: options.hasMore ?? true,
    loadingOlder: options.loadingOlder ?? false,
    loadOlder: () => calls.push(fake.scroller.scrollTop),
    turns: options.turns ?? [1, 2],
    /** 窗口头 seq：加载历史时它会变小，锚定补偿只在「真的前插了」时发生。 */
    firstSeq: options.firstSeq ?? 100,
  }
  const harness = mount(function Probe() {
    return useScroller(rootRef, state)
  })
  return { harness, fake, calls, state }
}

test('触顶（进入阈值内）时自动加载更早的历史', () => {
  const { fake, calls } = probeScroller({}, { scrollTop: 500 })
  assert.equal(calls.length, 0)
  fake.setTop(TOP_LOAD_THRESHOLD_PX)
  fake.fire()
  assert.equal(calls.length, 1, '触顶应该触发一次 loadOlder')
  fake.unmount?.()
})

test('停在顶部不会自己反复触发（否则会把全部历史一次拉完）', () => {
  const { fake, calls } = probeScroller({}, { scrollTop: 500 })
  fake.setTop(10)
  fake.fire()
  assert.equal(calls.length, 1)
  // 加载会改变滚动位置并再派发滚动事件；没有闸门时这里会连成一条链。
  fake.setTop(10)
  fake.fire()
  fake.setTop(0)
  fake.fire()
  assert.equal(calls.length, 1, '未离开顶部就不算新的触顶')
})

test('锚点滚出视口再回来可以再次加载（防重复触发的闸门）', () => {
  const { fake, calls } = probeScroller({}, { scrollTop: 500, anchorBottom: 400, withAnchor: true })
  fake.fire()
  assert.equal(calls.length, 1)
  // 用户往下读：加载锚点被推出视口上方 → 重新武装，但**不**立刻加载。
  fake.setAnchorBottom(-120)
  fake.fire()
  assert.equal(calls.length, 1)
  // 用户再滚回最上面：锚点重新可见 → 加载一次。
  fake.setAnchorBottom(400)
  fake.fire()
  assert.equal(calls.length, 2)
})

test('没有更早的历史时不触发', () => {
  const { fake, calls } = probeScroller({ hasMore: false }, { scrollTop: 500 })
  fake.setTop(10)
  fake.fire()
  assert.equal(calls.length, 0)
})

test('上一次加载还没结束时不重复触发', () => {
  const { fake, calls, state } = probeScroller({ loadingOlder: true }, { scrollTop: 500 })
  fake.setTop(10)
  fake.fire()
  assert.equal(calls.length, 0, '正在加载中不能再发一次')
  state.loadingOlder = false
  fake.setTop(300)
  fake.fire()
  fake.setTop(10)
  fake.fire()
  assert.equal(calls.length, 1, '加载结束后恢复可触发')
})

test('加载更早内容后把阅读位置补偿回去（锚定）', () => {
  const { harness, fake, state } = probeScroller(
    { firstSeq: 100 },
    { scrollTop: 20, nodeRows: [{ key: 'n1', top: -40 }, { key: 'n2', top: 300 }] },
  )
  fake.fire()
  // 前插落地：窗口头 seq 变小，并且原有内容被整体往下推 200px。
  fake.setNodeRowTop('n1', 160)
  fake.setNodeRowTop('n2', 500)
  state.firstSeq = 60
  const before = fake.scroller.scrollTop
  harness.render()
  assert.equal(fake.scroller.scrollTop, before + 200, 'scrollTop 应加上被推下的距离，读者停在原处')
})

test('锚定：窗口头没往前挪时不做补偿（否则每次渲染都会抖）', () => {
  const { harness, fake } = probeScroller(
    { firstSeq: 100 },
    { scrollTop: 20, nodeRows: [{ key: 'n1', top: -40 }, { key: 'n2', top: 300 }] },
  )
  fake.fire()
  // 只是重渲染（流式追加、折叠状态变化…）：位置没变 → 不动滚动位置。
  const before = fake.scroller.scrollTop
  harness.render()
  assert.equal(fake.scroller.scrollTop, before)
  // 就算 firstSeq 变了，只要锚点行没被推动，仍然是零补偿。
  fake.setNodeRowTop('n1', 160)
  const again = fake.scroller.scrollTop
  harness.render()
  assert.equal(fake.scroller.scrollTop, again)
})

test('锚定：一次加载里的多批前插都持续钉住同一个节点', () => {
  const { harness, fake, state } = probeScroller(
    { firstSeq: 100 },
    { scrollTop: 20, nodeRows: [{ key: 'n1', top: -40 }, { key: 'n2', top: 300 }] },
  )
  fake.fire()
  assert.equal(fake.scroller.scrollTop, 20, '触发时不动位置（只记录锚点）')
  state.loadingOlder = true
  // 第一批前插：窗口头 100 → 80，内容整体下移 100。
  fake.setNodeRowTop('n1', 60)
  fake.setNodeRowTop('n2', 400)
  state.firstSeq = 80
  harness.render()
  assert.equal(fake.scroller.scrollTop, 120, '第一批前插后读者仍停在原处')
  // 还在加载中 → 锚点按新位置重新记录；第二批前插（80 → 60，再下移 100）继续补偿。
  fake.setNodeRowTop('n1', 160)
  fake.setNodeRowTop('n2', 500)
  state.firstSeq = 60
  harness.render()
  assert.equal(fake.scroller.scrollTop, 220, '第二批前插也要补偿（同一节点继续钉住）')
  // 加载结束：锚点消费掉，之后再渲染不动滚动位置。
  state.loadingOlder = false
  harness.render()
  fake.setNodeRowTop('n2', 900)
  const settled = fake.scroller.scrollTop
  harness.render()
  assert.equal(fake.scroller.scrollTop, settled)
})

test('滚动时跟踪视口顶部所在的回合', () => {
  const { harness, fake } = probeScroller({}, { scrollTop: 500, anchorTops: { 1: -600, 2: 120 } })
  fake.fire()
  harness.render()
  // 阈值内最后一个满足条件的锚点：-600 在阈值内，120 超出 → 当前是第 1 回合。
  assert.equal(harness.value.activeTurn, 1)
  fake.setAnchorTop(2, 20)
  fake.fire()
  harness.render()
  assert.equal(harness.value.activeTurn, 2, '第二个回合进入顶部阈值后应成为当前回合')
})

test('挂载时注册、卸载时移除滚动监听', () => {
  const { harness, fake } = probeScroller({})
  assert.equal(fake.listenerCount(), 1)
  harness.unmount()
  assert.equal(fake.listenerCount(), 0)
})

test('加载锚点在视口内才触发；锚点滚出视口后重新武装', () => {
  // 锚点在视口内（bottom 400 > 宿主 top 0）= 用户滚到了最上面。
  const inside = probeScroller({}, { scrollTop: 10, anchorBottom: 400, withAnchor: true })
  inside.fake.fire()
  assert.equal(inside.calls.length, 1, '锚点可见时触发加载')

  // 锚点在视口上方（bottom -50）= 用户读下面的内容 → 不加载，但重新武装。
  const outside = probeScroller({}, { scrollTop: 10, anchorBottom: -50, withAnchor: true })
  outside.fake.fire()
  assert.equal(outside.calls.length, 0, '锚点不可见时不加载')
  outside.fake.setAnchorBottom(400)
  outside.fake.fire()
  assert.equal(outside.calls.length, 1, '锚点回到视口后加载一次')
})