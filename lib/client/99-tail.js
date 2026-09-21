    /* ──────────────────────────── 插件接线 ──────────────────────────── */

    /**
     * 注册任务视图。
     *
     * **视图内容分两层**：
     * - **层级是插槽的**：回合分组 / 任务阶段折叠 / 任务列表快照 / 子任务 / 右侧导轨，全部由本插件画；
     * - **叶子是核心的**：每一行节点都经 `renderSlot('conversation.chat.node', …)` 交给核心的原生
     *   条目渲染（命令卡、差异块、读取块、搜索块、提问卡、思考行…），只有座位缺席或渲染失败时才
     *   退化成自绘叶子（见 `lib/client/55-native.js`）。
     *
     * 声明 `children` 有两层作用：一是渲染器**只有看到 children 才会给出 `renderSlot`**
     * （`dsh-client-ui-renderer/lib/client.js:613-621`），二是顺带拿到会话作用域的 `SessionProvider`。
     * 详见 {@link nativeViewChildren} 里的注释（含核心行号依据）。
     *
     * **为什么用独立 id（不再遮蔽核心「对话」）**：视图选择的 fallback 硬编码为
     * 「存储的偏好 → `id === 'chat'` → 否则不渲染」。遮蔽（同 id + 更低 priority）能让本视图
     * 成为默认，但核心条目仍在账本里，而标签栏读的正是账本 → 两个标签、两个都带激活下划线。
     * 核心**不允许注销别人的条目**，所以遮蔽必然留下重复标签；改用独立 id 后标签栏只有一个高亮，
     * 原生「对话」仍是默认，需要任务流时点「任务」标签（选择持久化）。
     *
     * @param ctx - 客户端插件上下文。
     * @returns 无。
     */function apply(ctx) {
      installStyles()
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'chat-flow: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register(
          {
            name: 'conversation.view',
            id: TAB_VIEW_ID,
            order: TAB_VIEW_ORDER,
            label: () => t('view.flow'),
            locale: NS,
            children: nativeViewChildren(),
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
              /**
               * 翻页加载到指定 seq（导轨点未加载回合用）。
               *
               * 与 `loadOlder` 的差别：它内部**循环**加载直到窗口覆盖该 seq（每页 200 条），
               * 全程把 `loadingOlder` 置真，且返回的 promise **永不 reject**（失败也 resolve）。
               * 因此调用方不能拿「promise 完成」当成功，必须回看目标回合是否已加载。
               */
              loadThrough: (seq) => {
                try {
                  return ctx.sessions.binding(sessionId)?.session.loadThrough(seq) ?? Promise.resolve()
                } catch {
                  // 会话已释放：立即 resolve，调用方按「没加载到」处理。
                  return Promise.resolve()
                }
              },
              // 原生叶子需要的主人/注入能力（openFile / loadImage / fileMentions / forkAt）。
              ...nativeSeatFace(ctx, sessionId),
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
      TAB_VIEW_ID,
      TAB_VIEW_ORDER,
      NS,
      ZH,
      EN,
      NATIVE_NODE_SLOT,
      NATIVE_IMAGES_SLOT,
      OWN_SEAT_SLOT,
      OWNED_NODE_KINDS,
      nativeViewChildren,
      nativeSeatFace,
      resolveSeatPath,
      turnDataOfNode,
      turnOfChatNode,
      seatNodesOf,
      rowModelsOf,
      categoryOfTool,
      cardKindOfTool,
      statsOfNodes,
      statsSummary,
      describeStats,
      summarizeToolCall,
      diffCountsOf,
      parseCommandOutcome,
      toolStatusOf,
      toolCardOf,
      processEntries,
      nodeRowOf,
      groupProcessNodes,
      cutOffOf,
      observedRpcIdsOf,
      pendingSeatsOf,
      nodeRunsOf,
      isTopLevelNode,
      deriveFlow,
      orderedNodes,
      todosOfToolCall,
      diffTodos,
      assistantTextOf,
      formatDuration,
      markdownLabels,
      terminalLabels,
      installStyles,
      jumpToTurn,
      TOP_LOAD_THRESHOLD_PX,
      useScroller,
      useTick,
      mergeRailItems,
      FLOW_CSS,
      views: {
        TaskFlowView,
        FlowBody,
        ViewBodyBoundary,
        TurnGroup,
        TurnRail,
        SnapshotPlate,
        TaskFold,
        ThinkingBlock,
        NodeSequence,
        PendingBubble,
        NativeSeat,
        NativeNodeRow,
        ChatFlowLeaf,
        ContextFold,
        Fold,
        ToolCard,
        Card,
        DisclosureLine,
        UserBubble,
        AssistantText,
      },
    }
    return module.exports
  },
})
