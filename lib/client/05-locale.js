    /* ──────────────────────────── 文案 ──────────────────────────── */

    /**
     * 中英文字典。
     *
     * 界面文案归 `ctx.locale` 所有（核心的既定分工：primitives 是零 locale 的原子组件，
     * 每段面向用户的文案都由渲染点通过 label prop 提供）。视图组件从插槽 kit 拿到的 `t`
     * 就是绑定到 {@link NS} 的这个字典。
     *
     * 值必须是**字符串模板**：`translate` 用 `/\{(\w+)\}/g` 做插值，函数值不会被调用。
     * 插值参数写成单花括号，缺键时 `t` 回落成键名本身（因此键名也要能看懂）。
     */
    const ZH = {
      'view.flow': '任务',
      'flow.empty': '这个会话还没有可显示的内容。',
      'flow.loadOlder': '加载更早的历史',
      'flow.plan': '规划过程',
      'flow.planDraft': '计划初稿',
      'flow.tasks': '任务列表',
      'flow.tasksSummary': '{total} 项 · {done} 已完成',
      'flow.status.pending': '未开始',
      'flow.status.in_progress': '进行中',
      'flow.status.completed': '已完成',
      'flow.category.editFile': '编辑文件',
      'flow.category.command': '命令',
      'flow.category.question': '提问',
      'flow.category.mcp': 'MCP',
      'flow.category.plugin': '插件',
      'flow.category.core': '其他',
      'flow.processing': '正在处理',
      'flow.noOps': '无操作',
      'flow.ops': '{count} 个操作',
      'flow.thinking': '思考',
      'flow.rail': '回合导航',
      'flow.rail.jump': '跳到第 {turn} 轮',
      'flow.args': '入参',
      'flow.output': '结果',
      'flow.planUpdate': '计划更新',
      'flow.copy': '复制',
      'flow.copied': '已复制',
      'flow.footnotes': '脚注',
      'flow.collapse': '收起',
      'flow.expandRest': '展开其余 {count} 行',
      'flow.collapseAria': '收起',
      'flow.expandAria': '展开其余 {count} 行',
      'flow.noOutput': '（无输出）',
      'flow.running': '运行中',
      'flow.failed': '失败',
      'flow.done': '已完成',
      'flow.exitCode': '退出码 {code}',
      'flow.signal': '信号 {signal}',
    }

    const EN = {
      'view.flow': 'Tasks',
      'flow.empty': 'Nothing to show in this session yet.',
      'flow.loadOlder': 'Load earlier history',
      'flow.plan': 'Planning',
      'flow.planDraft': 'Initial plan',
      'flow.tasks': 'Tasks',
      'flow.tasksSummary': '{total} tasks · {done} done',
      'flow.status.pending': 'Not started',
      'flow.status.in_progress': 'In progress',
      'flow.status.completed': 'Done',
      'flow.category.editFile': 'Files edited',
      'flow.category.command': 'Commands',
      'flow.category.question': 'Questions',
      'flow.category.mcp': 'MCP',
      'flow.category.plugin': 'Plugins',
      'flow.category.core': 'Other',
      'flow.processing': 'Working',
      'flow.noOps': 'No operations',
      'flow.ops': '{count} operations',
      'flow.thinking': 'Thought',
      'flow.rail': 'Turn navigation',
      'flow.rail.jump': 'Jump to turn {turn}',
      'flow.args': 'Input',
      'flow.output': 'Result',
      'flow.planUpdate': 'Plan updated',
      'flow.copy': 'Copy',
      'flow.copied': 'Copied',
      'flow.footnotes': 'Footnotes',
      'flow.collapse': 'Collapse',
      'flow.expandRest': 'Show {count} more lines',
      'flow.collapseAria': 'Collapse',
      'flow.expandAria': 'Show {count} more lines',
      'flow.noOutput': '(no output)',
      'flow.running': 'Running',
      'flow.failed': 'Failed',
      'flow.done': 'Done',
      'flow.exitCode': 'exit code {code}',
      'flow.signal': 'signal {signal}',
    }

    /** Markdown 原子组件要的 chrome 文案（primitives 自己不持有语言回退）。 */
    function markdownLabels(t) {
      return {
        code: { copyLabel: t('flow.copy'), copiedLabel: t('flow.copied') },
        footnotes: t('flow.footnotes'),
      }
    }

    /** 终端卡片要的 chrome 文案，键名与 `TerminalBlock` 的 labels 契约一一对应。 */
    function terminalLabels(t) {
      return {
        signal: (signal) => t('flow.signal', { signal }),
        exitCode: (code) => t('flow.exitCode', { code }),
        running: t('flow.running'),
        failed: t('flow.failed'),
        done: t('flow.done'),
        copy: t('flow.copy'),
        copied: t('flow.copied'),
        noOutput: t('flow.noOutput'),
        collapseAria: t('flow.collapseAria'),
        collapse: t('flow.collapse'),
        expandAria: (count) => t('flow.expandAria', { count }),
        expand: (count) => t('flow.expandRest', { count }),
      }
    }
