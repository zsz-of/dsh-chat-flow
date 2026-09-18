    /* ──────────────────────────── 右侧回合导轨 ──────────────────────────── */

    /**
     * 右侧刻度条：每个回合一个刻度，点击跳到该回合（一次对话）的开头。
     *
     * 结构与核心的 `TurnNavigator` 同构但**不共用代码**（它没有任何公开导出）：
     * 一个**零高 sticky 槽**钉在滚动视口顶部，里面绝对定位出竖向刻度条。
     * 这样滚动时导轨始终停在视口里，刻度数与内容高度无关（不需要按比例定位）。
     *
     * 只画**已加载**的回合——`turns` 就是本视图自己派生出的回合号列表。
     * 核心还能用 `turnOutline` 投影把未加载的回合画成淡刻度并翻页跳过去；
     * 本项目未做（需要 `loadThrough` + 待加载后定位），记在执行计划的下一轮候选里。
     *
     * @param props - `turns`（回合号数组）、`activeTurn`、`liveTurn`、`onJump`、`t`。
     * @returns 导轨；只有一个回合时返回 `null`（没有可跳的目标）。
     */
    function TurnRail({ turns, activeTurn, liveTurn, onJump, t }) {
      if (!Array.isArray(turns) || turns.length < 2) return null
      return h(
        'div',
        { className: 'dcf-rail-slot' },
        h(
          'div',
          { className: 'dcf-rail', role: 'navigation', 'aria-label': t('flow.rail') },
          ...turns.map((turn) => {
            const label = t('flow.rail.jump', { turn })
            return h('button', {
              key: String(turn),
              type: 'button',
              className: 'dcf-mark',
              'data-active': turn === activeTurn ? 'true' : 'false',
              'data-live': turn === liveTurn ? 'true' : 'false',
              'aria-current': turn === activeTurn ? 'true' : undefined,
              title: label,
              'aria-label': label,
              onClick: () => onJump(turn),
            })
          }),
        ),
      )
    }
