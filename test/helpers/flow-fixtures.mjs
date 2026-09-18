/**
 * 派生测试用的节点夹具。
 *
 * 形状严格照抄核心 `dsh-client-ui-chat` 产出的 chat 节点（字段名与嵌套层级都来自源码，
 * 见 `docs/references/core-seams.md`），因为这一层的全部价值就是「正确读懂核心给的数据」——
 * 夹具一旦宽松，测试就失去意义。
 *
 * @module test/helpers/flow-fixtures
 */

/** 把节点数组包成 `useChat` 快照里 `nodes` 的形状。 */
export function makeSnapshot(nodes) {
  const map = new Map(nodes.map((node) => [node.key, node]))
  return {
    order: nodes.map((node) => node.key),
    nodes: {
      get: (key) => map.get(key),
      values: () => [...map.values()],
    },
  }
}

/** 节点信封的公共字段（核心 `chatNode()` 的产物形状）。 */
function envelope(key, turn, step, kind, data) {
  return {
    key,
    kind,
    id: `${turn}:${step}`,
    target: 'chat',
    anchorSeq: Number(`${turn}${String(step).padStart(3, '0')}`),
    location: { kind: 'step', turn: { turn, status: 'open' }, step: { turn, step, status: 'open' } },
    visibility: 'visible',
    data,
  }
}

/** 用户消息节点。 */
export function userNode(key, turn, text) {
  return envelope(key, turn, 0, 'user', {
    kind: 'user',
    seq: 1,
    time: 0,
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

/** 助手节点。`blocks` 传 `{kind:'text'|'reasoning', text}`。 */
export function assistantNode(key, turn, step, blocks) {
  return envelope(key, turn, step, 'assistant-step', {
    status: 'settled',
    turn,
    step,
    blocks,
    time: 0,
  })
}

/**
 * 工具调用节点。
 *
 * @param result - 省略表示「还在跑」；给出 `{content, isError}` 表示已落定
 *   （核心在落定时把 `root` 换成 `{kind:'tool-result', call:{name,argsRaw}, …}`）。
 */
export function toolNode(key, turn, step, name, args, result) {
  const argsRaw = JSON.stringify(args)
  const root =
    result === undefined
      ? { callId: key, name, argsRaw, turn, step, time: 0, subCalls: [] }
      : {
          kind: 'tool-result',
          seq: 100,
          time: 0,
          callId: key,
          call: { name, argsRaw },
          callTime: 0,
          content: [{ type: 'text', text: result.content ?? '' }],
          isError: result.isError === true,
          subCalls: [],
        }
  return envelope(key, turn, step, 'tool-call', { root })
}

/** `pwsh` 工具调用节点（最常用的动作类工具）。 */
export function pwshNode(key, turn, step, command, output = 'ok') {
  return toolNode(key, turn, step, 'pwsh', { command }, { content: output })
}

/** `write` 工具调用节点。 */
export function writeNode(key, turn, step, path) {
  return toolNode(key, turn, step, 'write', { file_path: path, content: 'x' }, { content: 'written' })
}

/** `todo_write` 工具调用节点。 */
export function todoNode(key, turn, step, todos) {
  return toolNode(key, turn, step, 'todo_write', { todos }, { content: 'updated' })
}
