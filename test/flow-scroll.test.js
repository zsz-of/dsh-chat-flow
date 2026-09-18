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

test('离开顶部再回到顶部可以再次加载', () => {
  const { fake, calls } = probeScroller({}, { scrollTop: 500 })
  fake.setTop(10)
  fake.fire()
  fake.setTop(400)
  fake.fire()
  fake.setTop(20)
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
  const { harness, fake, state } = probeScroller({}, { scrollTop: 20, anchorTops: { 1: -40, 2: 300 } })
  fake.fire()
  // 前插内容会把原有内容往下推：第一个回合的锚点从 -40 被推到 160。
  fake.setAnchorTop(1, 160)
  const before = fake.scroller.scrollTop
  harness.render()
  assert.equal(fake.scroller.scrollTop, before + 200, 'scrollTop 应加上被推下的距离，读者停在原处')
  assert.equal(state.hasMore, true)
})

test('锚定在位置没变时不改滚动位置', () => {
  const { harness, fake } = probeScroller({}, { scrollTop: 20 })
  fake.fire()
  const before = fake.scroller.scrollTop
  harness.render()
  assert.equal(fake.scroller.scrollTop, before)
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
