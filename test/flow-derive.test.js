/**
 * 派生层测试：工具名分类、工具摘要、任务归属与统计。
 *
 * 这一层是验收标准第 3、4、5、8、10 条的实现处，所以断言必须能逐条对上：
 * 任务列表从哪来、状态怎么变、节点归到哪个任务、5 项统计各是多少。
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { loadBundle } from './helpers/load-bundle.mjs'
import {
  assistantNode,
  makeSnapshot,
  pwshNode,
  todoNode,
  toolNode,
  userNode,
  writeNode,
} from './helpers/flow-fixtures.mjs'

const { exports } = await loadBundle()
const {
  categoryOfTool,
  summarizeToolCall,
  statsOfNodes,
  statsSummary,
  describeStats,
  deriveFlow,
  processEntries,
  todosOfToolCall,
} = exports.__internals

/** 测试用的文案座位：与真实 `ctx.locale.bind` 同一套插值规则。 */
const t = (key, params) => {
  const template = exports.__internals.ZH[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

test('工具名分类：5 类统计 + 不参与统计的内置工具', () => {
  assert.equal(categoryOfTool('pwsh'), 'command')
  assert.equal(categoryOfTool('bash'), 'command')
  assert.equal(categoryOfTool('write'), 'editFile')
  assert.equal(categoryOfTool('edit'), 'editFile')
  assert.equal(categoryOfTool('str_replace_editor'), 'editFile')
  assert.equal(categoryOfTool('ask_user_question'), 'question')
  assert.equal(categoryOfTool('mcp__playwright__click'), 'mcp')
  assert.equal(categoryOfTool('read'), 'core')
  assert.equal(categoryOfTool('grep'), 'core')
  assert.equal(categoryOfTool('todo_write'), 'core')
  // 非核心自带的工具按「插件提供」计——包括内置只读工具之外的第三方工具。
  assert.equal(categoryOfTool('ppt_create'), 'plugin')
  assert.equal(categoryOfTool('pdf-edit-document'), 'plugin')
  // 名字缺失或非字符串时不能抛：节点数据来自日志，可能不完整。
  assert.equal(categoryOfTool(''), 'plugin')
  assert.equal(categoryOfTool(undefined), 'plugin')
})

test('工具摘要：挑最能代表这次操作的参数', () => {
  assert.equal(summarizeToolCall('pwsh', { command: 'node --test\n第二行' }), 'node --test')
  assert.equal(summarizeToolCall('write', { file_path: 'a/b.js', content: 'x' }), 'a/b.js')
  assert.equal(summarizeToolCall('grep', { pattern: 'deriveFlow' }), 'deriveFlow')
  assert.equal(summarizeToolCall('todo_write', { todos: [{ status: 'completed' }, { status: 'pending' }] }), '2 项 · 1 已完成')
  assert.equal(summarizeToolCall('mcp__x__y', {}), '')
})

test('统计与格式：只显示非零类别，全零时退化成操作数', () => {
  const nodes = [
    pwshNode('t1', 1, 1, 'echo 1'),
    pwshNode('t2', 1, 2, 'echo 2'),
    writeNode('t3', 1, 3, 'a.js'),
    toolNode('t4', 1, 4, 'ask_user_question', { id: 'q' }, { content: 'answer' }),
    toolNode('t5', 1, 5, 'mcp__github__create_issue', { title: 'x' }, { content: 'ok' }),
    toolNode('t6', 1, 6, 'ppt_create', { title: 'deck' }, { content: 'ok' }),
    toolNode('t7', 1, 7, 'read', { file_path: 'a.js' }, { content: 'body' }),
  ]
  const stats = statsOfNodes(nodes)
  assert.equal(stats.counts.command, 2)
  assert.equal(stats.counts.editFile, 1)
  assert.equal(stats.counts.question, 1)
  assert.equal(stats.counts.mcp, 1)
  assert.equal(stats.counts.plugin, 1)
  assert.equal(stats.counts.core, 1)
  assert.equal(stats.total, 7)
  assert.equal(stats.listed, 7, '只读内置工具也要逐条出现在明细里')

  // 派生层只给类别键与计数，文案在渲染层组装（这样英文界面不会漏中文）。
  assert.deepEqual(statsSummary(stats).segments, [
    { category: 'editFile', count: 1 },
    { category: 'command', count: 2 },
    { category: 'question', count: 1 },
    { category: 'mcp', count: 1 },
    { category: 'plugin', count: 1 },
  ])
  assert.equal(describeStats(stats, t), '编辑文件 1 · 命令 2 · 提问 1 · MCP 1 · 插件 1')
  // 英文座位下不出现中文：派生层只给类别键，文案由渲染层组装。
  const en = (key, params) => {
    const template = exports.__internals.EN[key] ?? key
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
  assert.equal(describeStats(stats, en), 'Files edited 1 · Commands 2 · Questions 1 · MCP 1 · Plugins 1')
  assert.equal(describeStats({ counts: { editFile: 0, command: 0, question: 0, mcp: 0, plugin: 0, core: 3 }, total: 3, listed: 3 }, t), '3 个操作')
  assert.equal(describeStats({ counts: { editFile: 0, command: 0, question: 0, mcp: 0, plugin: 0, core: 0 }, total: 0, listed: 0 }, t), '无操作')
})

test('未落定的工具调用也要计数，并标明仍在运行', () => {
  const running = toolNode('t1', 1, 1, 'pwsh', { command: 'sleep 1' })
  const stats = statsOfNodes([running])
  assert.equal(stats.counts.command, 1)
  const entries = processEntries([running])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].settled, false)
  assert.equal(entries[0].summary, 'sleep 1')
})

test('计划回合：计划分组 / 任务列表 / 状态流转 / 子对话归属', () => {
  const nodes = [
    userNode('u1', 1, '把 A 和 B 都做掉'),
    assistantNode('a1', 1, 1, [{ kind: 'text', text: '先规划一下。' }]),
    todoNode('p1', 1, 1, [
      { content: '任务A', status: 'in_progress' },
      { content: '任务B', status: 'pending' },
    ]),
    pwshNode('t1', 1, 2, 'node --test', '3 tests passed'),
    todoNode('p2', 1, 3, [
      { content: '任务A', status: 'completed' },
      { content: '任务B', status: 'in_progress' },
    ]),
    writeNode('t2', 1, 4, 'a.js'),
    todoNode('p3', 1, 5, [
      { content: '任务A', status: 'completed' },
      { content: '任务B', status: 'completed' },
    ]),
    assistantNode('a2', 1, 6, [{ kind: 'text', text: '两件事都做完了。' }]),
  ]
  const flow = deriveFlow(makeSnapshot(nodes))
  assert.equal(flow.turns.length, 1)
  const group = flow.turns[0]
  assert.equal(group.planned, true)
  assert.equal(group.inputText, '把 A 和 B 都做掉')
  assert.equal(group.tasks.length, 2)
  assert.equal(group.tasks[0].content, '任务A')
  assert.equal(group.tasks[0].status, 'completed')
  assert.equal(group.tasks[1].status, 'completed')
  assert.equal(group.completedCount, 2)
  assert.equal(group.activeIndex, -1, '全部完成后不再有进行中的任务')

  // 子对话归属：A 期间是 node --test；B 期间是写文件。
  assert.deepEqual(group.tasks[0].nodes.map((node) => node.key), ['t1', 'p2'])
  assert.deepEqual(group.tasks[1].nodes.map((node) => node.key), ['t2', 'p3'])

  // 统计口径：计划写入（todo_write）归 core，不算任务执行动作。
  assert.equal(group.tasks[0].stats.counts.command, 1)
  assert.equal(group.tasks[0].stats.counts.core, 1, '任务A 里的那次计划更新归 core，不进 5 项统计')
  assert.equal(group.tasks[1].stats.counts.editFile, 1)
  assert.equal(describeStats(group.tasks[0].stats, t), '命令 1')

  // 计划分组：首个 todo 之前的助手文本 + 首个 todo 本身；随后是收尾。
  assert.deepEqual(group.planNodes.map((node) => node.key), ['a1', 'p1'])
  assert.equal(group.planCallKey, 'p1')
  assert.deepEqual(group.plan.todos.map((todo) => todo.content), ['任务A', '任务B'])
  assert.deepEqual(group.closing.map((node) => node.key), ['a2'])
})

test('无计划回合：全部节点留在计划桶里，按紧凑形态渲染', () => {
  const nodes = [
    userNode('u1', 2, '看下这个函数'),
    assistantNode('a1', 2, 1, [
      { kind: 'reasoning', text: '先定位文件' },
      { kind: 'text', text: '在读代码。' },
    ]),
    toolNode('t1', 2, 1, 'read', { file_path: 'a.js' }, { content: 'body' }),
    assistantNode('a2', 2, 2, [{ kind: 'text', text: '它是一个纯函数。' }]),
  ]
  const flow = deriveFlow(makeSnapshot(nodes))
  const group = flow.turns[0]
  assert.equal(group.planned, false)
  assert.equal(group.tasks.length, 0)
  assert.deepEqual(group.planNodes.map((node) => node.key), ['a1', 't1', 'a2'])
  assert.deepEqual(group.closing, [])
  // 明细里有「思考」与「读取」两条，正文另算。
  const entries = processEntries(group.planNodes)
  assert.deepEqual(entries.map((entry) => entry.kind), ['thinking', 'tool'])
})

test('多个用户输入切成多个回合分组', () => {
  const nodes = [
    userNode('u1', 1, '第一件事'),
    pwshNode('t1', 1, 1, 'echo 1'),
    userNode('u2', 2, '第二件事'),
    pwshNode('t2', 2, 1, 'echo 2'),
  ]
  const flow = deriveFlow(makeSnapshot(nodes))
  assert.equal(flow.turns.length, 2)
  assert.equal(flow.turns[0].turn, 1)
  assert.equal(flow.turns[1].turn, 2)
  assert.equal(flow.turns[1].inputText, '第二件事')
  assert.deepEqual(flow.turns[1].planNodes.map((node) => node.key), ['t2'])
})

test('整表覆盖：被删掉的任务把节点交给收尾区，不丢对话', () => {
  const nodes = [
    userNode('u1', 1, '做两件事'),
    todoNode('p1', 1, 1, [
      { content: '任务A', status: 'in_progress' },
      { content: '任务B', status: 'pending' },
    ]),
    pwshNode('t1', 1, 2, 'echo a'),
    // 模型改主意：整表只剩 A（B 被删除）。
    todoNode('p2', 1, 3, [{ content: '任务A', status: 'completed' }]),
    assistantNode('a1', 1, 4, [{ kind: 'text', text: '只做了 A。' }]),
  ]
  const flow = deriveFlow(makeSnapshot(nodes))
  const group = flow.turns[0]
  assert.equal(group.tasks.length, 1)
  assert.equal(group.tasks[0].content, '任务A')
  assert.deepEqual(group.tasks[0].nodes.map((node) => node.key), ['t1', 'p2'])
  assert.deepEqual(group.closing.map((node) => node.key), ['a1'])
})

test('损坏的 todo 参数不会被当成任务列表', () => {
  const broken = toolNode('p1', 1, 1, 'todo_write', { todos: 'not-an-array' }, { content: 'error', isError: true })
  assert.equal(todosOfToolCall(broken), null)
  const nodes = [userNode('u1', 1, '做点事'), broken, pwshNode('t1', 1, 2, 'echo 1')]
  const group = deriveFlow(makeSnapshot(nodes)).turns[0]
  assert.equal(group.planned, false)
  assert.deepEqual(group.planNodes.map((node) => node.key), ['p1', 't1'])
})

test('未知/损坏的节点不抛异常', () => {
  const flow = deriveFlow({ order: [], nodes: { get: () => undefined, values: () => [null, { key: 'x', kind: 'unknown-surface' }] } })
  assert.equal(flow.turns.length, 1)
  assert.equal(flow.turns[0].planned, false)
})
