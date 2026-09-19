/**
 * 派生层测试：卡片模型（状态 / 退出码 / 差异 / 提问 / 子 agent）、统计口径、以及
 * 「每次列表更新冻结一份快照并分段」的核心语义。
 *
 * 这一层是验收第 3、4、5、8、10 条与用户当轮「任务列表不能全局调用、必须按当时状态显示」
 * 的实现处，所以断言必须能逐条对上。
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { loadBundle } from './helpers/load-bundle.mjs'
import {
  askNode,
  assistantNode,
  contextNode,
  editNode,
  interruptedPwshNode,
  makeSnapshot,
  mcpNode,
  pwshNode,
  subagentCallNode,
  todoNode,
  toolNode,
  turnTailNode,
  userNode,
  writeNode,
} from './helpers/flow-fixtures.mjs'

const { exports } = await loadBundle()
const {
  ZH,
  cardKindOfTool,
  categoryOfTool,
  statsOfNodes,
  statsSummary,
  describeStats,
  parseCommandOutcome,
  toolCardOf,
  diffCountsOf,
  processEntries,
  nodeRowOf,
  groupProcessNodes,
  seatNodesOf,
  deriveFlow,
  todosOfToolCall,
  diffTodos,
} = exports.__internals

/** 测试用的文案座位：与真实 `ctx.locale.bind` 同一套插值规则。 */
const t = (key, params) => {
  const template = ZH[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

/** 取一个节点的卡片模型。 */
function cardOf(node) {
  return toolCardOf(node.data.root)
}

test('工具名 → 卡片类型', () => {
  assert.equal(cardKindOfTool('pwsh'), 'command')
  assert.equal(cardKindOfTool('bash'), 'command')
  assert.equal(cardKindOfTool('write'), 'file')
  assert.equal(cardKindOfTool('edit'), 'file')
  assert.equal(cardKindOfTool('str_replace_editor'), 'file')
  assert.equal(cardKindOfTool('mcp__playwright__click'), 'mcp')
  assert.equal(cardKindOfTool('ask_user_question'), 'question')
  assert.equal(cardKindOfTool('subagent'), 'subagent')
  assert.equal(cardKindOfTool('subagent_fork'), 'subagent')
  assert.equal(cardKindOfTool('read'), 'plain')
  assert.equal(cardKindOfTool('ppt_create'), 'plain')
  // 归类保留给图标与调试；专属卡片不会被归成 core/plugin。
  assert.equal(categoryOfTool('read'), 'core')
  assert.equal(categoryOfTool('ppt_create'), 'plugin')
  assert.equal(categoryOfTool('pwsh'), 'command')
})

test('命令结果的尾部标记：退出码与信号从文本解析并剥离', () => {
  assert.deepEqual(parseCommandOutcome('ok\n[exit code: 3]'), {
    output: 'ok',
    exitCode: 3,
    signal: undefined,
    timedOut: false,
  })
  const killed = parseCommandOutcome('boom\n[killed by signal: SIGTERM]')
  assert.equal(killed.signal, 'SIGTERM')
  assert.equal(killed.output, 'boom')
  // 没有标记 = 退出码 0（与核心的解析一致）。
  assert.deepEqual(parseCommandOutcome('plain'), {
    output: 'plain',
    exitCode: 0,
    signal: undefined,
    timedOut: false,
  })
  assert.equal(parseCommandOutcome('slow\n[timed out after 5000ms]').timedOut, true)
})

test('命令卡四态：运行中 / 已完成运行 / 运行失败 / 已取消', () => {
  assert.equal(cardOf(toolNode('r', 1, 1, 'pwsh', { command: 'sleep 9' })).status, 'running')
  assert.equal(cardOf(pwshNode('b', 1, 2, 'false', 'oops', 1)).status, 'failed')
  assert.equal(cardOf(interruptedPwshNode('c', 1, 3, 'sleep 9')).status, 'cancelled', '被中断 ≠ 运行失败')
  const timeout = cardOf(
    toolNode('d', 1, 4, 'pwsh', { command: 'x' }, {
      content: 'x',
      isError: true,
      error: { name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' },
    }),
  )
  assert.equal(timeout.status, 'cancelled')
  assert.equal(cardOf(toolNode('e', 1, 5, 'pwsh', { command: 'x' }, { content: 'x', isError: true })).status, 'failed')

  const done = cardOf(pwshNode('f', 1, 6, 'echo hi', 'hi'))
  assert.equal(done.status, 'done')
  assert.equal(done.command, 'echo hi')
  assert.equal(done.exitCode, 0)
  assert.equal(done.output, 'hi', '退出码标记要从输出里剥掉')
})

test('文件编辑卡：−N / +N，无法判断时给 null（不编数字）', () => {
  assert.deepEqual(diffCountsOf('write', { content: 'a\nb\nc' }), { added: 3, removed: 0 })
  assert.deepEqual(diffCountsOf('edit', { old_string: 'a\nb', new_string: 'a\nb\nc' }), { added: 3, removed: 2 })
  assert.deepEqual(diffCountsOf('str_replace_editor', { old_str: 'x', new_str: '' }), { added: 0, removed: 1 })
  assert.equal(diffCountsOf('str_replace_editor', { command: 'insert', insert_line: 3 }), null)

  const write = cardOf(writeNode('w', 1, 1, 'a.js'))
  assert.equal(write.kind, 'file')
  assert.equal(write.path, 'a.js')
  assert.deepEqual(write.diff, { added: 1, removed: 0 })

  const edit = cardOf(editNode('e', 1, 2, 'b.js', 'one\ntwo', 'one\ntwo\nthree'))
  assert.deepEqual(edit.diff, { added: 3, removed: 2 })
})

test('MCP 卡：尽力还原服务器与函数名', () => {
  const card = cardOf(mcpNode('m', 1, 1, 'mcp__github__create_issue', { title: 'x' }))
  assert.equal(card.kind, 'mcp')
  assert.equal(card.server, 'github')
  assert.equal(card.mcpTool, 'create_issue')
  // 被截断/加过哈希的公开名反解不出来：不丢信息，整串当作函数名。
  const hashed = cardOf(mcpNode('m2', 1, 2, 'mcp__srv__abcdef_0123456789ab', {}))
  assert.equal(hashed.server, 'srv')
  assert.equal(hashed.mcpTool, 'abcdef_0123456789ab')
})

test('提问卡：按问题 id 回配回答，取消时给出取消状态', () => {
  const questions = [
    { id: 'q1', header: '范围', question: '要不要一起改？', options: [{ label: '要' }, { label: '不要' }] },
    { id: 'q2', header: '风格', question: '用哪种风格？', options: [{ label: '简洁' }] },
  ]
  const answered = cardOf(
    askNode('a1', 1, 1, questions, [
      { id: 'q1', selected: ['要'] },
      { id: 'q2', selected: ['简洁'], custom: '偏保守' },
    ]),
  )
  assert.equal(answered.answered, true)
  assert.deepEqual(answered.prompts.map((prompt) => prompt.selected), [['要'], ['简洁']])
  assert.equal(answered.prompts[1].custom, '偏保守')

  // 还没落定 = 正在等用户回答。
  const waiting = cardOf(toolNode('a2', 1, 2, 'ask_user_question', { questions }))
  assert.equal(waiting.answered, false)
  assert.equal(waiting.status, 'running')

  const cancelled = cardOf(
    toolNode('a3', 1, 3, 'ask_user_question', { questions }, {
      content: '',
      isError: true,
      error: { name: 'UserQuestionError', code: 'ASK_CANCELLED' },
    }),
  )
  assert.equal(cancelled.status, 'cancelled')
})

test('子 agent 卡：提示词与输出都可拿；运行中状态为 running', () => {
  const card = cardOf(subagentCallNode('s1', 1, 1, '去查一下 X'))
  assert.equal(card.kind, 'subagent')
  assert.equal(card.prompt, '去查一下 X')
  assert.equal(card.output, '子 agent 的报告')
  assert.equal(card.status, 'done')
  assert.equal(cardOf(toolNode('s2', 1, 2, 'subagent', { prompt: '跑着' })).status, 'running')
})

test('嵌套子调用降级为通用卡（子结果没有退出码/差异可解析）', () => {
  const nested = cardOf(toolNode('n1', 1, 1, 'pwsh', { command: 'echo x' }, { content: 'x', parentCallId: 'root' }))
  assert.equal(nested.kind, 'plain')
  assert.equal(nested.isChild, true)
})

test('统计口径：思考 / 命令 / 编辑文件 / MCP / 提问，0 值不显示', () => {
  const nodes = [
    assistantNode('a1', 1, 1, [{ kind: 'reasoning', text: '想想' }, { kind: 'text', text: '在做' }]),
    assistantNode('a2', 1, 2, [{ kind: 'reasoning', text: '再想想' }]),
    pwshNode('c1', 1, 3, 'echo 1'),
    pwshNode('c2', 1, 4, 'echo 2'),
    writeNode('f1', 1, 5, 'a.js'),
    mcpNode('m1', 1, 6, 'mcp__github__create_issue', {}),
    askNode('q1', 1, 7, [{ id: 'q', question: '?' }], [{ id: 'q', selected: [] }]),
    toolNode('r1', 1, 8, 'read', { file_path: 'a.js' }, { content: 'body' }),
    subagentCallNode('s1', 1, 9, '去查'),
  ]
  const stats = statsOfNodes(nodes)
  assert.equal(stats.counts.thinking, 2)
  assert.equal(stats.counts.command, 2)
  assert.equal(stats.counts.file, 1)
  assert.equal(stats.counts.mcp, 1)
  assert.equal(stats.counts.question, 1)
  // 只读内置与子 agent 都不进这 5 项，但都在明细里。
  assert.equal(stats.listed, 9)
  assert.equal(describeStats(stats, t), '思考 2 · 命令 2 · 编辑文件 1 · MCP 1 · 提问 1')
  assert.equal(
    describeStats({ counts: { thinking: 0, command: 1, file: 0, mcp: 0, question: 0 }, listed: 1 }, t),
    '命令 1',
    '为 0 的类别完全不出现',
  )
  assert.equal(
    describeStats({ counts: { thinking: 0, command: 0, file: 0, mcp: 0, question: 0 }, listed: 3 }, t),
    '3 个操作',
  )
  assert.deepEqual(statsSummary(stats).segments.map((item) => item.category), [
    'thinking',
    'command',
    'file',
    'mcp',
    'question',
  ])
})

test('分段：每次列表更新冻结一份快照，下一个任务只在下一段出现', () => {
  const nodes = [
    userNode('u1', 1, '把 A 和 B 都做掉'),
    assistantNode('a1', 1, 1, [{ kind: 'text', text: '先规划。' }]),
    todoNode('p1', 1, 2, [
      { content: '任务A', status: 'in_progress' },
      { content: '任务B', status: 'pending' },
    ]),
    pwshNode('t1', 1, 3, 'echo a'),
    todoNode('p2', 1, 4, [
      { content: '任务A', status: 'completed' },
      { content: '任务B', status: 'in_progress' },
    ]),
    writeNode('t2', 1, 5, 'b.js'),
    todoNode('p3', 1, 6, [
      { content: '任务A', status: 'completed' },
      { content: '任务B', status: 'completed' },
    ]),
    assistantNode('a2', 1, 7, [{ kind: 'text', text: '都做完了。' }]),
  ]
  const group = deriveFlow(makeSnapshot(nodes)).turns[0]
  assert.equal(group.planned, true)
  assert.equal(group.segments.length, 3, '每次 todo_write 一段')

  // 第 1 段：快照冻结在「A 进行中 / B 未开始」，活动任务是 A，节点是那条命令。
  const first = group.segments[0]
  assert.deepEqual(first.todos.map((todo) => todo.status), ['in_progress', 'pending'])
  assert.equal(first.activeTask, '任务A')
  assert.deepEqual(first.nodes.map((node) => node.key), ['t1'])
  assert.equal(first.completedCount, 0)
  // 首个快照里每一项都是新的：只记 added（started 会与 added 重复，渲染层也不显示这一行）。
  assert.deepEqual(first.changed, { added: ['任务A', '任务B'], started: [], finished: [], removed: [] })
  assert.equal(first.isPlan, true)

  // 第 2 段：快照冻结在「A 完成 / B 进行中」——A 的完成状态出现在**这一块**里。
  const second = group.segments[1]
  assert.deepEqual(second.todos.map((todo) => todo.status), ['completed', 'in_progress'])
  assert.equal(second.activeTask, '任务B', '第二个任务节点由这次更新点名后才出现')
  assert.deepEqual(second.nodes.map((node) => node.key), ['t2'])
  assert.equal(second.completedCount, 1)
  assert.deepEqual(second.changed.finished, ['任务A'])
  assert.deepEqual(second.changed.started, ['任务B'])

  // 第 3 段全部完成：没有活动任务，节点落进收尾区。
  const third = group.segments[2]
  assert.equal(third.activeTask, null)
  assert.deepEqual(third.nodes, [])
  assert.equal(third.completedCount, 2)
  assert.deepEqual(group.closing.map((node) => node.key), ['a2'])
  assert.deepEqual(group.planNodes.map((node) => node.key), ['a1'])
})

test('已标记完成的任务不再参与后续比较（「完成了就不管了」）', () => {
  const previous = [
    { content: '任务A', status: 'completed' },
    { content: '任务B', status: 'in_progress' },
  ]
  // 这一版把已完成的 A 删掉了：不算变化，也不该冒出 removed。
  assert.deepEqual(diffTodos(previous, [{ content: '任务B', status: 'completed' }]), {
    added: [],
    started: [],
    finished: ['任务B'],
    removed: [],
  })
})

test('任务列表被整表改写：新增项算 added，未完成的被删算 removed', () => {
  const changed = diffTodos(
    [
      { content: 'A', status: 'in_progress' },
      { content: 'B', status: 'pending' },
    ],
    [
      { content: 'A', status: 'in_progress' },
      { content: 'C', status: 'pending' },
    ],
  )
  assert.deepEqual(changed.added, ['C'])
  assert.deepEqual(changed.removed, ['B'])
})

test('没有 todolist 的回合：全部节点留在 looseNodes，按操作折叠', () => {
  const nodes = [
    userNode('u1', 2, '看下这个函数'),
    assistantNode('a1', 2, 1, [{ kind: 'reasoning', text: '定位' }, { kind: 'text', text: '在读代码。' }]),
    toolNode('r1', 2, 2, 'read', { file_path: 'a.js' }, { content: 'body' }),
    assistantNode('a2', 2, 3, [{ kind: 'text', text: '它是纯函数。' }]),
  ]
  const group = deriveFlow(makeSnapshot(nodes)).turns[0]
  assert.equal(group.planned, false)
  assert.deepEqual(group.segments, [])
  assert.deepEqual(group.looseNodes.map((node) => node.key), ['a1', 'r1', 'a2'])
  assert.deepEqual(processEntries(group.looseNodes).map((entry) => entry.kind), ['thinking', 'tool'])
})

test('损坏的 todo 参数不会被当成列表更新', () => {
  const broken = toolNode('p1', 1, 1, 'todo_write', { todos: 'nope' }, { content: 'err', isError: true })
  assert.equal(todosOfToolCall(broken), null)
  const group = deriveFlow(makeSnapshot([userNode('u1', 1, '做事'), broken, pwshNode('t1', 1, 2, 'echo 1')])).turns[0]
  assert.equal(group.planned, false)
  // 整回合退化成「无计划」：连那次损坏的 todo_write 调用也只是普通节点（会渲染成通用卡）。
  assert.deepEqual(group.looseNodes.map((node) => node.key), ['p1', 't1'])
})

test('未知/损坏的节点不抛异常', () => {
  const flow = deriveFlow({
    order: [],
    nodes: { get: () => undefined, values: () => [null, { key: 'x', kind: 'unknown-surface' }] },
  })
  assert.equal(flow.turns.length, 1)
  assert.equal(flow.turns[0].planned, false)
})

/* ──────────────────────────── 原生座位的派生契约 ──────────────────────────── */

test('单节点回退模型：一个节点一条，且不做跨节点合并', () => {
  const tool = pwshNode('t1', 1, 3, 'echo a', 'a')
  const text = assistantNode('a1', 1, 4, [{ kind: 'text', text: '说完了' }])
  const reasoning = assistantNode('a2', 1, 5, [{ kind: 'reasoning', text: '先想一下' }])

  assert.equal(nodeRowOf(contextNode('c1', 1, 1, '规则')).kind, 'context')
  assert.equal(nodeRowOf(contextNode('c1', 1, 1, '规则')).text, '规则')
  assert.equal(nodeRowOf(userNode('u1', 1, '问题')).kind, 'message')
  assert.equal(nodeRowOf(tool).kind, 'tool')
  assert.equal(nodeRowOf(tool).card.kind, 'command')
  assert.equal(nodeRowOf(text).kind, 'assistant')
  assert.equal(nodeRowOf(text).text, '说完了')
  // 只有推理的助手步 → 「思考」行；没有任何可渲染内容 → null。
  assert.equal(nodeRowOf(reasoning).kind, 'thinking')
  assert.equal(nodeRowOf(reasoning).text, '先想一下')
  assert.equal(nodeRowOf({ key: 'x', kind: 'turn-process', data: {} }), null)
  assert.equal(nodeRowOf(null), null)
})

test('上下文注入合并成一行，位置取第一次注入出现的地方', () => {
  const rows = groupProcessNodes([
    pwshNode('t1', 1, 1, 'echo a', 'a'),
    contextNode('c1', 1, 2, '规则'),
    contextNode('c2', 1, 3, '记忆'),
    pwshNode('t2', 1, 4, 'echo b', 'b'),
    contextNode('c3', 1, 5, '时间'),
  ])
  assert.deepEqual(rows.map((row) => row.kind), ['node', 'contexts', 'node'], '这一段只出一个上下文折叠点')
  assert.deepEqual(rows[1].nodes.map((node) => node.key), ['c1', 'c2', 'c3'], '全部注入合进同一个折叠点')
  assert.equal(rows[0].node.key, 't1')
  assert.equal(rows[2].node.key, 't2', '折叠点落在第一次注入的位置，后面的动作仍按原顺序跟在它后面')
  assert.deepEqual(groupProcessNodes([]), [])
})

test('「此刻正在做的那一项」：被后续列表更新完成或删除后不再默认展开', () => {
  const plan = [
    { content: '任务A', status: 'in_progress' },
    { content: '任务B', status: 'pending' },
  ]
  const live = deriveFlow(
    makeSnapshot([userNode('u1', 1, '干活'), todoNode('p1', 1, 1, plan), pwshNode('t1', 1, 2, 'echo a', 'a')]),
  ).turns[0]
  assert.deepEqual(live.segments.map((segment) => segment.isCurrentTask), [true], '只有一次更新 → 它就是在做的那一项')

  const advanced = deriveFlow(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, plan),
      pwshNode('t1', 1, 2, 'echo a', 'a'),
      todoNode('p2', 1, 3, [
        { content: '任务A', status: 'completed' },
        { content: '任务B', status: 'in_progress' },
      ]),
    ]),
  ).turns[0]
  assert.deepEqual(
    advanced.segments.map((segment) => segment.isCurrentTask),
    [false, true],
    'A 已被后续更新标成完成 → 历史分段收起；B 才是当前的',
  )

  const allDone = deriveFlow(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, plan),
      todoNode('p2', 1, 2, [
        { content: '任务A', status: 'completed' },
        { content: '任务B', status: 'completed' },
      ]),
    ]),
  ).turns[0]
  assert.equal(
    allDone.segments.some((segment) => segment.isCurrentTask),
    false,
    '全部完成 → 没有任何一项是「正在做」',
  )
})

test('回合已结束时，未完成的任务仍被标记为 unfinished', () => {
  const group = deriveFlow(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
      pwshNode('t1', 1, 2, 'echo a', 'a'),
      turnTailNode('tt1', 1, 3),
    ]),
  ).turns[0]
  assert.equal(group.closed, true)
  assert.equal(group.unfinished, true)
  // turn-tail 是核心的收尾控制器，本插件用阶段折叠替代它，节点本身不进渲染序列。
  assert.deepEqual(seatNodesOf([...group.segments[0].nodes, ...group.closing]).map((node) => node.kind), ['tool-call'])
})
