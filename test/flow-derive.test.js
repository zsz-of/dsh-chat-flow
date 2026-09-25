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
  blankAssistantNode,
  contextNode,
  editNode,
  interruptedPwshNode,
  makeSnapshot,
  mcpNode,
  pwshNode,
  steeringNode,
  subagentCallNode,
  systemPromptNode,
  todoNode,
  toolNode,
  turnProcessNode,
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
  nodeRunsOf,
  seatNodesOf,
  cutOffOf,
  observedRpcIdsOf,
  pendingSeatsOf,
  orderedNodes,
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

test('统计口径：思考 / 命令 / 读取文件 / 编辑文件 / MCP / 提问，0 值不显示', () => {
  const nodes = [
    assistantNode('a1', 1, 1, [{ kind: 'reasoning', text: '想想' }, { kind: 'text', text: '在做' }]),
    assistantNode('a2', 1, 2, [{ kind: 'reasoning', text: '再想想' }]),
    pwshNode('c1', 1, 3, 'echo 1'),
    pwshNode('c2', 1, 4, 'echo 2'),
    writeNode('f1', 1, 5, 'a.js'),
    mcpNode('m1', 1, 6, 'mcp__github__create_issue', {}),
    askNode('q1', 1, 7, [{ id: 'q', question: '?' }], [{ id: 'q', selected: [] }]),
    toolNode('r1', 1, 8, 'read', { file_path: 'a.js' }, { content: 'body' }),
    toolNode('r2', 1, 9, 'read_image', { file_path: 'b.png' }, { content: 'img' }),
    toolNode('r3', 1, 10, 'grep', { pattern: 'x' }, { content: 'Found 1 match' }),
    subagentCallNode('s1', 1, 11, '去查'),
  ]
  const stats = statsOfNodes(nodes)
  assert.equal(stats.counts.thinking, 2)
  assert.equal(stats.counts.command, 2)
  assert.equal(stats.counts.read, 2, 'read / read_image 才算「读取文件」')
  assert.equal(stats.counts.file, 1)
  assert.equal(stats.counts.mcp, 1)
  assert.equal(stats.counts.question, 1)
  // 检索类（grep）与子 agent 都不进这些项，但都在明细里。
  assert.equal(stats.listed, 11)
  // 每一项都是完整句子（用户要求「思考 x 次 执行 y 条命令 读取 w 个文件 编辑 z 个文件 这种说法」）。
  assert.equal(
    describeStats(stats, t),
    '思考 2 次 · 执行 2 条命令 · 读取 2 个文件 · 编辑 1 个文件 · 调用 1 个 MCP 工具 · 提问 1 次',
  )
  assert.equal(
    describeStats(
      { counts: { thinking: 0, command: 1, read: 0, file: 0, mcp: 0, question: 0 }, listed: 1 },
      t,
    ),
    '执行 1 条命令',
    '为 0 的类别完全不出现',
  )
  assert.equal(
    describeStats(
      { counts: { thinking: 0, command: 0, read: 0, file: 0, mcp: 0, question: 0 }, listed: 3 },
      t,
    ),
    '3 个操作',
  )
  assert.deepEqual(statsSummary(stats).segments.map((item) => item.category), [
    'thinking',
    'command',
    'read',
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
  // turn-tail 交给原生渲染（复制/点赞/点踩/分支按钮在它里面），但**不进任何折叠体**：
  // 派生层把它摘进 footerNodes，渲染层固定在「总结之后」渲染它。
  assert.deepEqual(
    seatNodesOf([...group.segments[0].nodes, ...group.closing]).map((node) => node.kind),
    ['tool-call'],
  )
  assert.deepEqual(group.footerNodes.map((node) => node.kind), ['turn-tail'])
  // `liveKey` 指向本回合最后一个**参与折叠**的节点（收尾节点不算）：渲染层用它判定「哪一块还在写」。
  assert.equal(group.liveKey, 't1')
})

test('第一个用户输入之前的节点不单独成组（最前端那个「无操作」的残留）', () => {
  // 真实顺序：核心为回合合成的 `turn-process` 排在回合开始处，早于第一条 user/message。
  // 它自成一组时会渲染成「任务耗时 + 无操作」的折叠头，而它的 turn 与第一回合同号，
  // 时间线也一样——看起来就像第一回合的思考被复制了一份留在最前面。
  const withPhantom = deriveFlow(
    makeSnapshot([
      turnProcessNode('tp1', 1, 1),
      userNode('u1', 1, '干活'),
      assistantNode('a1', 1, 1, [{ kind: 'reasoning', text: '想一下' }]),
      pwshNode('t1', 1, 2, 'echo a', 'a'),
      turnTailNode('tt1', 1, 3),
    ]),
  )
  assert.equal(withPhantom.turns.length, 1, '最前面不该多出一个分组')
  assert.equal(withPhantom.turns[0].input?.key, 'u1', '唯一的那一组就是第一回合')

  // 空助手步（没有正文也没有推理）同理：它不该让最前面多出一组。
  const withBlankStep = deriveFlow(
    makeSnapshot([
      blankAssistantNode('b1', 1, 1),
      userNode('u2', 1, '干活'),
      assistantNode('a2', 1, 1, [{ kind: 'reasoning', text: '想一下' }]),
    ]),
  )
  assert.equal(withBlankStep.turns.length, 1)

  // ⚠️ 但**有内容**的孤儿节点必须保留：历史分页后窗口正好从回合中间开始，
  // 那些节点本身是要看的，只是没有输入气泡。
  const orphan = deriveFlow(makeSnapshot([pwshNode('t9', 9, 1, 'echo orphan', 'ok'), userNode('u3', 9, '下一个')]))
  assert.equal(orphan.turns.length, 2, '没有输入气泡但有内容的组要保留')
  assert.equal(orphan.turns[0].input, undefined)
  assert.equal(orphan.turns[0].blank, false)
})

test('第一条用户消息之前的系统提示词/注入上下文并进第一回合（不再自成一个「无操作」块）', () => {
  // 用户报告的现场：新对话最上面是一个「任务过程 · 无操作」的折叠头，展开后只有
  // 「思考已完成 · 无操作」＋「上下文准备 → 注入系统提示词」——整组的内容就是一个
  // `system-prompt` 节点。核心把它的 anchorSeq 排在第一条 `user/message` **之前**
  // （本机实测 `turn/start` 是 seq 5、第一条用户消息是 seq 8）。
  //
  // 第十六轮只挡住了 `turn-process`（`isBlankNode` 认它），`system-prompt` 不认，
  // 于是那一组「有内容」→ 不被过滤 → 幽灵块又回来了。
  const merged = deriveFlow(
    makeSnapshot([
      systemPromptNode('sp1', 1, 1, '你是 DSH'),
      turnProcessNode('tp1', 1, 2),
      userNode('u1', 1, '干活'),
      assistantNode('a1', 1, 1, [{ kind: 'reasoning', text: '想一下' }]),
      pwshNode('t1', 1, 2, 'echo a', 'a'),
    ]),
  )
  assert.equal(merged.turns.length, 1, '最前面不再多出一组')
  assert.equal(merged.turns[0].input?.key, 'u1', '唯一的那一组就是第一回合')
  assert.equal(merged.turns[0].blank, false)
  // 并入的节点保持原有先后顺序，排在用户消息那一组的最前面：
  // 系统提示词与它后面的注入上下文会被 `groupProcessNodes` 合成同一个「上下文准备」折叠体。
  assert.deepEqual(
    merged.turns[0].looseNodes.map((node) => node.key),
    ['sp1', 'tp1', 'a1', 't1'],
  )

  // 注入上下文（`context`）同理：它本来就随第一回合的请求发出去。
  const injected = deriveFlow(
    makeSnapshot([
      contextNode('c1', 1, 1, '工作区指令'),
      userNode('u2', 2, '继续'),
      assistantNode('a2', 2, 1, [{ kind: 'reasoning', text: '想一下' }]),
    ]),
  )
  assert.equal(injected.turns.length, 1, '注入上下文也并进第一回合')
  assert.deepEqual(injected.turns[0].looseNodes.map((node) => node.key), ['c1', 'a2'])

  // ⚠️ 全窗口都没有用户发言时（历史分页正好从回合中间开始）仍要留住那一组，
  // 否则并入逻辑会把攒下的节点整个吞掉。
  const noUser = deriveFlow(makeSnapshot([systemPromptNode('sp9', 9, 1, '你是 DSH')]))
  assert.equal(noUser.turns.length, 1, '没有用户发言的窗口退化成原来那个头组')
  assert.equal(noUser.turns[0].input, undefined)
  assert.equal(noUser.turns[0].blank, false)
})

test('「被打断」只看最后一个任务列表的状态（用户裁决）', () => {
  // 第一版列表把任务A点成进行中；后续每一次列表都会把它冻结在「进行中」。
  // 若拿「任一版本里有进行中」当判据，任何跑过两步以上的回合都会恒定显示「被打断」。
  const advanced = deriveFlow(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, [
        { content: '任务A', status: 'in_progress' },
        { content: '任务B', status: 'pending' },
      ]),
      pwshNode('t1', 1, 2, 'echo a', 'a'),
      todoNode('p2', 1, 3, [
        { content: '任务A', status: 'completed' },
        { content: '任务B', status: 'completed' },
      ]),
      turnTailNode('tt1', 1, 4),
    ]),
  ).turns[0]
  assert.equal(advanced.closed, true)
  assert.equal(
    advanced.segments[0].todos.some((todo) => todo.status === 'in_progress'),
    true,
    '第一版快照永远冻结在「进行中」（这正是误报的来源）',
  )
  assert.equal(advanced.unfinished, false, '最后一个列表已全部完成 → 这个回合没有被「打断」')

  // 最后一个列表里仍留着进行中的那一项：这才叫没善终。
  const stuck = deriveFlow(
    makeSnapshot([
      userNode('u2', 2, '干活'),
      todoNode('q1', 2, 1, [{ content: '任务A', status: 'in_progress' }]),
      todoNode('q2', 2, 2, [{ content: '任务A', status: 'in_progress' }]),
      turnTailNode('tt2', 2, 3),
    ]),
  ).turns[0]
  assert.equal(stuck.unfinished, true, '最后一个列表里那一项还在进行中 → 被打断')
})

test('分段被后续列表接管：superseded 标记与「已停止」的判据', () => {
  const group = deriveFlow(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, [
        { content: '任务A', status: 'in_progress' },
        { content: '任务B', status: 'pending' },
      ]),
      pwshNode('t1', 1, 2, 'echo a', 'a'),
      todoNode('p2', 1, 3, [
        { content: '任务A', status: 'completed' },
        { content: '任务B', status: 'in_progress' },
      ]),
    ]),
  ).turns[0]
  assert.deepEqual(
    group.segments.map((segment) => segment.superseded),
    [true, false],
    '后面还有更新的列表 → 旧分段被接管；最后一个不是',
  )

  const single = deriveFlow(
    makeSnapshot([userNode('u2', 2, '干活'), todoNode('q1', 2, 1, [{ content: '任务A', status: 'in_progress' }])]),
  ).turns[0]
  assert.deepEqual(single.segments.map((segment) => segment.superseded), [false], '只有一版列表时它就是当前那一版')
})

test('收尾节点不进过程折叠：单独成组，插不进任何段', () => {
  const group = deriveFlow(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      todoNode('p1', 1, 1, [{ content: '任务A', status: 'completed' }]),
      assistantNode('a1', 1, 2, [{ kind: 'text', text: '做完了' }]),
      turnTailNode('tt1', 1, 3),
    ]),
  ).turns[0]
  assert.equal(group.planned, true)
  assert.deepEqual(group.footerNodes.map((node) => node.key), ['tt1'])
  assert.equal(
    group.closing.some((node) => node.kind === 'turn-tail'),
    false,
    '收尾节点必须从 closing 里摘出去，否则会被折进「任务过程」',
  )
  assert.equal(
    group.segments.some((segment) => segment.nodes.some((node) => node.kind === 'turn-tail')),
    false,
  )
  assert.equal(group.looseNodes.some((node) => node.kind === 'turn-tail'), false)
})

test('子 agent 卡片：结果文本是 `started subagent <uuid>` 时不再抛（历史里的真实形状）', () => {
  const childId = '11111111-2222-3333-4444-555555555555'
  const group = deriveFlow(
    makeSnapshot([
      userNode('u1', 1, '干活'),
      subagentCallNode('s1', 1, 1, '去研究一下', `started subagent ${childId}`),
      contextNode('c1', 1, 2, '子 agent 报告正文', {
        kind: 'subagent-settled',
        senderSessionId: childId,
        summary: '完成了',
      }),
    ]),
  ).turns[0]

  const entry = processEntries(group.looseNodes, group.subagents).find((item) => item.kind === 'tool')
  assert.ok(entry !== undefined, '子 agent 调用应有一条明细')
  assert.equal(entry.card.childId, childId)
  assert.equal(entry.card.status, 'done', '拿到结算通知 → 已结算')
  assert.equal(entry.card.report.text, '子 agent 报告正文')

  // 报告还没到的情形（后台派发）：只带 uuid、没有通知，也不能抛。
  const alone = deriveFlow(
    makeSnapshot([userNode('u2', 2, '再干'), subagentCallNode('s2', 2, 1, '再去', `started subagent ${childId}`)]),
  ).turns[0]
  const lonely = processEntries(alone.looseNodes, alone.subagents).find((item) => item.kind === 'tool')
  assert.equal(lonely.card.status, 'started')
  assert.equal(lonely.card.report, undefined)
})

test('cutOffOf：被取消/中断的过程认得出，正常结束的认不出', () => {
  const interrupted = assistantNode('a2', 1, 3, [{ kind: 'reasoning', text: '写了一半' }])
  interrupted.data.status = 'interrupted'
  assert.equal(cutOffOf([interrupted]), true)
  assert.equal(cutOffOf([assistantNode('a1', 1, 1, [{ kind: 'text', text: '完整' }])]), false)
  assert.equal(cutOffOf([interruptedPwshNode('t9', 1, 4, 'sleep 1')]), true, '被用户取消的工具调用算被打断')
  assert.equal(cutOffOf([pwshNode('t1', 1, 2, 'echo a', 'a')]), false)
  assert.equal(cutOffOf([]), false)
  assert.equal(cutOffOf(undefined), false)
})

test('cutOffOf：超时与「结果未知」不算被打断（用户裁决），但卡片状态仍是「已取消」', () => {
  const timedOut = toolNode('tt1', 1, 1, 'pwsh', { command: 'sleep 999' }, {
    content: '',
    isError: true,
    error: { name: 'Timeout', code: 'tool_timeout' },
  })
  const unknown = toolNode('tt2', 1, 2, 'pwsh', { command: 'echo x' }, {
    content: '',
    isError: true,
    error: { name: 'Unknown', code: 'tool_outcome_unknown' },
  })
  assert.equal(cutOffOf([timedOut]), false, '超时是运行环境的问题，不是「有人把它掐了」')
  assert.equal(cutOffOf([unknown]), false, '结果未知同理')

  // 卡片状态的口径不变：这两个都不是「失败」，仍然按「已取消」展示。
  assert.equal(toolCardOf(timedOut.data.root).status, 'cancelled')
  assert.equal(toolCardOf(unknown.data.root).status, 'cancelled')
  // 真的被用户取消/中止的仍然算被打断。
  assert.equal(cutOffOf([interruptedPwshNode('tt3', 1, 3, 'sleep 1')]), true)
})

test('cutOffOf：命令执行失败 / 结果没挂回节点，都不算被打断（用户裁决）', () => {
  // ① 命令失败：宿主把退出码写进结果文本尾部，`isError` 仍是 false。
  const failed = pwshNode('f1', 1, 1, 'node --test', 'AssertionError', 1)
  assert.equal(cutOffOf([failed]), false, '命令执行失败不是「被打断」')
  assert.equal(toolCardOf(failed.data.root).status, 'failed', '失败本身照旧显示成「运行失败」')

  // ② 工具报错：`isError` + 明确的失败码（本机实测的真实形状）。
  const errored = toolNode('f2', 1, 2, 'edit', { file_path: 'a.js' }, {
    content: '',
    isError: true,
    error: { name: 'FsError', code: 'FS_NOT_OBSERVED' },
  })
  assert.equal(cutOffOf([errored]), false, '工具调用失败同样不是「被打断」')

  // ③ 结果没挂回节点（`surfaceOp: 'replace'` 的历史重放会这样，本机实测 20 例）：
  //    节点停在「未落定」上，但没有任何「有人掐了它」的证据。
  const unattached = toolNode('f3', 1, 3, 'pwsh', { command: 'git status' })
  assert.equal(cutOffOf([unattached]), false, '没落定只说明结果没挂上，不说明被掐断')
  assert.equal(toolCardOf(unattached.data.root).status, 'running')

  // ④ 唯一还算「被打断」的仍然是核心给出的中断证据。
  assert.equal(cutOffOf([interruptedPwshNode('f4', 1, 4, 'sleep 1')]), true)
})

test('待发送 / 插队的消息：插队保留、本地回显落地后消失、排队的不进对话流', () => {
  const snapshot = makeSnapshot([userNode('u1', 1, '干活')])
  snapshot.nodes.get('u1').data.source = { kind: 'user', rpcId: 'rpc-landed' }

  const seats = pendingSeatsOf(
    [
      { id: 'q1', placement: 'steering', content: [{ type: 'text', text: '插一句话' }] },
      { id: 'q2', placement: 'next-turn', content: [{ type: 'text', text: '下一回合再说' }] },
    ],
    [
      { requestId: 'rpc-pending', placement: 'steering', text: '刚发出去的' },
      { requestId: 'rpc-landed', placement: 'steering', text: '已经落地了' },
      { requestId: 'rpc-queued', placement: 'queued', text: '排队里的' },
    ],
    snapshot,
  )
  assert.deepEqual(
    seats.map((seat) => [seat.kind, seat.text]),
    [
      ['steering', '插一句话'],
      ['echo', '刚发出去的'],
    ],
    '插队消息保留；已落地的回显不再重复；queued 的交给输入区显示；非插队的队列项不进对话流',
  )
  // 队列项的 rpcId 也会被算作「已观测」，避免它同时以回显形式出现两遍（核心同义，CHAT:1959）。
  const observed = observedRpcIdsOf(snapshot, [{ id: 'q3', rpcId: 'rpc-queued' }])
  assert.equal(observed.has('rpc-queued'), true)
  assert.equal(observed.has('rpc-landed'), true)
  assert.equal(observed.has('rpc-unknown'), false)
})

test('渲染序只认 order：回滚后已移出呈现序的节点不再被画出来', () => {
  const snapshot = makeSnapshot([
    userNode('u1', 1, '第一件事'),
    pwshNode('t1', 1, 1, 'echo 1', '1'),
    userNode('u2', 2, '第二件事（回滚后应当消失）'),
  ])
  // 模拟回滚：order 去掉后面两条，nodes 这个 Map 里仍然留着旧条目。
  snapshot.order = ['u1', 't1']
  const flow = deriveFlow(snapshot)
  assert.deepEqual(
    flow.turns.map((group) => group.turn),
    [1],
    '只有还在呈现序里的回合被派生出来',
  )
  assert.equal(
    orderedNodes(snapshot).map((node) => node.key).join(','),
    'u1,t1',
    '派生序与核心的 order 一致（不再补渲染 Map 里的残留节点）',
  )
})

/* ──────────────────────────── 插队消息 = 分组边界 ──────────────────────────── */

test('插队消息开一个新分组：用户内容永远在最外层，上一个节点就此结束', () => {
  const flow = deriveFlow(
    makeSnapshot([
      userNode('u1', 1, '第一件事'),
      todoNode('p1', 1, 1, [{ content: '任务A', status: 'in_progress' }]),
      pwshNode('t1', 1, 2, 'echo a', 'a'),
      steeringNode('s1', 1, 3, '顺便把这个也做了'),
      pwshNode('t2', 1, 4, 'echo b', 'b'),
    ]),
  )

  assert.equal(flow.turns.length, 2, '插队消息把同一个回合切成两组')
  assert.deepEqual(flow.turns.map((group) => group.turn), [1, 1], '两组的回合号相同')
  assert.notEqual(flow.turns[0].key, flow.turns[1].key, '分组 key 必须唯一（折叠状态按它记忆）')
  assert.equal(flow.turns[0].inputKind, 'user')
  assert.equal(flow.turns[1].inputKind, 'steering', '第二组以插队消息开头')
  assert.equal(flow.turns[1].input.key, 's1')
  assert.deepEqual(
    flow.turns[0].segments[0].nodes.map((node) => node.key),
    ['t1'],
    '插队之前的动作留在第一组的分段里',
  )
  assert.deepEqual(flow.turns[1].looseNodes.map((node) => node.key), ['t2'], '插队之后的动作属于新一组')
})

test('nodeRunsOf：最外层节点被剔除，并且切断相邻的过程块', () => {
  const runs = nodeRunsOf([
    pwshNode('t1', 1, 1, 'echo a', 'a'),
    steeringNode('s1', 1, 2, '插一句'),
    pwshNode('t2', 1, 3, 'echo b', 'b'),
    assistantNode('a1', 1, 4, [{ kind: 'text', text: '说点什么' }]),
    pwshNode('t3', 1, 5, 'echo c', 'c'),
  ])
  assert.deepEqual(
    runs.map((run) => [run.kind, run.nodes.map((node) => node.key)]),
    [
      ['process', ['t1']],
      ['process', ['t2']],
      ['inline', ['a1']],
      ['process', ['t3']],
    ],
    '插队消息本身不渲染在块里，但它让前后两块断开（用户发了消息 → 上一块结束）',
  )
})
