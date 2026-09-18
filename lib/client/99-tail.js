    /* ──────────────────────────── 插件接线 ──────────────────────────── */

    /**
     * 注册任务视图。
     *
     * **为什么是 `id: 'chat'` + `priority: -1`**：视图选择的 fallback 在核心里硬编码为
     * 「存储的偏好 → id === 'chat' → 否则不渲染」，`order` 再小都不会成为默认
     * （见 `docs/references/core-seams.md`）。插槽对「同 id 同 priority」判冲突，对
     * 「同 id 不同 priority」判遮蔽——**最小 priority 渲染**，所以 -1 就能接管这个单元格：
     * 默认视图天然落在任务视图上，用户点过「轨迹」等其它视图后仍可用标签切回来。
     *
     * 代价（已在执行计划里记录）：核心条目无法注销，标签栏会多出一个同样指向本视图的
     * 「对话」标签。
     *
     * @param ctx - 客户端插件上下文。
     * @returns 无。
     */
    function apply(ctx) {
      installStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'chat-flow: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: CHAT_VIEW_ID,
            order: CHAT_VIEW_ORDER,
            priority: SHADOW_PRIORITY,
            label: () => t('view.flow'),
            locale: NS,
            inject: (sessionId) => ({
              sessionId,
              /**
               * 拉更早的历史页。
               *
               * 会话 binding 可能已经释放（切走会话的竞态），因此取不到时静默返回——
               * 按钮点一下没反应，比抛异常把整块视图打成错误态要好。
               */
              loadOlder: () => {
                try {
                  ctx.sessions.binding(sessionId)?.session.loadOlder()
                } catch {
                  // 会话已释放：忽略这次点击。
                }
              },
            }),
          },
          TaskFlowView,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    /**
     * 测试接缝：纯函数与常量直接暴露，node 侧测试不必模拟整套插槽就能验证派生逻辑，
     * 也能逐字断言注册参数（id / priority / order）。
     */
    exports.__internals = {
      CHAT_VIEW_ID,
      CHAT_VIEW_ORDER,
      SHADOW_PRIORITY,
      NS,
      ZH,
      EN,
      categoryOfTool,
      statsOfNodes,
      statsSummary,
      describeStats,
      summarizeToolCall,
      processEntries,
      deriveFlow,
      orderedNodes,
      todosOfToolCall,
      assistantTextOf,
      markdownLabels,
      terminalLabels,
      installStyles,
      views: { TaskFlowView, FlowBody, TurnGroup, TaskList, TaskRow, PlanGroup, ProcessingBlock, NodeSequence },
    }
    return module.exports
  },
})
