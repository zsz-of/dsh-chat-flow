    /* ──────────────────────────── 样式 ──────────────────────────── */

    /**
     * 一次性注入样式表。
     *
     * 颜色与字号全部走主题 token（`--dsw-*` / `--dsh-*`），不写死色值，
     * 这样浅色/深色主题与用户字号设置都会自动跟随。
     * 类名前缀 `dcf-` 是本插件私有（DSH 里各插件的 `<style>` 是全局的，前缀撞车会互相污染）。
     *
     * 布局分三层，这是右侧导轨能工作的前提：
     * - `.dcf-root` 是块级满宽容器（**不带** max-width）；
     * - `.dcf-rail-slot` 是**零高 sticky 槽**，占满宽度、钉在滚动视口顶部，只在里面绝对定位出导轨；
     * - `.dcf-main` 才是阅读列（限宽 + 居中 + 左右留白让开导轨）。
     *
     * 视觉层次（用户要求「分出主次、该加背景板就加」）：
     * 背景板 = 任务列表快照 `.dcf-plate`；卡片 = 一次操作 `.dcf-card`；
     * 「思考中/思考完成」是容器的标题行，不加板，只靠左侧竖线与缩进表达从属关系。
     */
    const FLOW_CSS = `
.dcf-root{display:block;width:100%;padding:14px 0 8px;box-sizing:border-box;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}
.dcf-main{display:flex;flex-direction:column;gap:14px;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:0 30px;box-sizing:border-box}
.dcf-empty{color:var(--dsw-alias-label-tertiary);padding:8px 2px}
.dcf-hint{color:var(--dsw-alias-label-tertiary);font-size:13px;background:0 0;border:none;cursor:pointer;text-align:left;padding:4px 2px}
.dcf-hint:hover{color:var(--dsw-alias-label-secondary)}
.dcf-loading{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:13px;padding:6px 2px}
.dcf-spinner{flex:none;width:12px;height:12px;border-radius:50%;border:2px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-label-secondary);animation:dcf-spin .8s linear infinite}
@keyframes dcf-spin{to{transform:rotate(360deg)}}
.dcf-turn{display:flex;flex-direction:column;gap:10px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px;scroll-margin-top:12px}
.dcf-turn:first-child{border-top:none;padding-top:0}
.dcf-ask{display:flex;flex-direction:column;align-items:flex-end;gap:2px}
.dcf-askactions{display:flex;justify-content:flex-end}
.dcf-askbuttons{display:flex;align-items:center;gap:6px;min-height:20px}
.dcf-mini{background:0 0;border:none;color:var(--dsw-alias-label-caption);font:inherit;font-size:12px;line-height:18px;padding:0 4px;cursor:pointer;border-radius:4px}
.dcf-mini:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}
.dcf-ask .dcf-bubble{background:var(--dsw-specific-bubble);border-radius:18px;padding:9px 14px;max-width:min(82%,640px);white-space:pre-wrap;word-break:break-word}
.dcf-block{display:flex;flex-direction:column;gap:6px}

/* 原生叶子行：内容 100% 由核心的原生组件渲染，本插件只给行容器与行距。
   核心的阅读列靠 flowItem 兄弟选择器给出行距（dsh-client-ui-chat/lib/client.js:1440），
   而本视图的列是 .dcf-main，所以要自己补上同一条间距（模板里不能出现反引号）。
   折叠体内部比正文行紧一档（8px）：那里是一串动作行，用同一档间距会显得散。 */
.dcf-leaf{display:block;min-width:0}
.dcf-leaf:empty{display:none}
.dcf-leaf+.dcf-leaf{margin-top:var(--dsh-chat-flow-gap,16px)}
.dcf-body>.dcf-leaf+.dcf-leaf,.dcf-platebody>.dcf-leaf+.dcf-leaf{margin-top:8px}
.dcf-leaf+.dcf-thinking,.dcf-thinking+.dcf-leaf,.dcf-leaf+.dcf-block,.dcf-block+.dcf-leaf{margin-top:var(--dsh-chat-flow-gap,16px)}
.dcf-body>.dcf-block,.dcf-body>.dcf-thinking{margin-top:0}
.dcf-note{color:var(--dsw-alias-label-caption);font-size:12px}
.dcf-text{overflow-wrap:anywhere}
.dcf-text p{margin:0 0 8px}
.dcf-text p:last-child{margin-bottom:0}
.dcf-pre{margin:0;padding:8px 10px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08));border-radius:6px;overflow:auto;max-height:280px;white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-secondary)}

/* 行：可折叠的一行标题。整行是按钮（触摸目标 ≥ 32px），hover 才给底色。 */
.dcf-row{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:6px;padding:3px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-row:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:1px}
.dcf-row[data-static=true]{cursor:default}
.dcf-row[data-static=true]:hover{background:0 0}
/* 锁住的折叠行（任务还在跑时的「任务过程」）：点不动，因此也不给 hover 反馈。 */
.dcf-row[data-locked=true]:hover{background:0 0}
/* 展开箭头：**必须让包裹盒恰好等于图标盒**，否则旋转中心不是箭头的几何中心。
   svg 默认是 inline，行高（本视图 22px 左右）会把包裹盒撑高、图标掉到基线上——
   于是在 14×14 的盒子里，旋转中心（盒中心）与箭头中心差了半个行高，看起来就是「绕着角转」。
   用 flex 居中 + svg 的 display:block 把两者对齐，并显式写 transform-origin:center 兜底。
   （注意：本文件是模板字符串，注释里不能出现反引号。） */
.dcf-chev{flex:none;width:14px;height:14px;margin-top:4px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-caption);transition:transform .22s cubic-bezier(.2,.8,.2,1);transform-origin:center}
.dcf-chev>svg{display:block}
.dcf-chev[data-open=true]{transform:rotate(90deg)}
.dcf-title{flex:none;color:var(--dsw-alias-label-secondary)}
.dcf-summary{min-width:0;flex:1 1 auto;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcf-count{flex:none;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.dcf-badge{flex:none;color:var(--dsw-alias-label-caption);font-size:12px;font-variant-numeric:tabular-nums}
.dcf-body{display:flex;flex-direction:column;gap:6px;padding:2px 0 4px 22px}

/* 折叠动画：grid-template-rows 0fr ↔ 1fr，不需要 JS 量高度。
   子树**保持挂载**（与核心的稳定 seat 同思路）：卸载会丢掉嵌套块的展开状态，
   进出也会退化成「瞬间替换」。收起时用 visibility 把子树的 Tab 焦点一并摘掉。 */
.dcf-fold{display:grid;grid-template-rows:0fr;visibility:hidden;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear .22s}
.dcf-fold[data-open=true]{grid-template-rows:1fr;visibility:visible;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear 0s}
.dcf-fold>*{min-height:0;overflow:hidden}

/* 任务列表快照面板：**思考块以外的任务列表要有背景板**（用户要求）——
   它是这一轮任务的「状态板」，与一行行动作明细不是同一层级，用底色 + 描边把它托起来。 */
.dcf-plate{background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08));border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;padding:2px 4px;margin:2px 0}
.dcf-platehead{display:flex;align-items:center;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:8px;padding:4px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-platehead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-platetitle{flex:none;color:var(--dsw-alias-label-primary)}
.dcf-platebody{display:flex;flex-direction:column;gap:1px;padding:2px 6px 4px 22px}
.dcf-change{color:var(--dsw-alias-label-caption);font-size:12px;padding:2px 0 4px}

/* 任务行：快照里的项与「子任务」折叠体共用一套状态样式。 */
.dcf-tasks{display:flex;flex-direction:column;gap:2px}
.dcf-task{display:flex;flex-direction:column;gap:2px}
.dcf-taskrow{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:6px;padding:3px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
button.dcf-taskrow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-taskrow[data-status=completed] .dcf-tasktitle{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.dcf-taskrow[data-status=in_progress] .dcf-tasktitle{color:var(--dsw-alias-label-primary);font-weight:500}
.dcf-taskrow[data-status=pending] .dcf-tasktitle{color:var(--dsw-alias-label-secondary)}
.dcf-dot{flex:none;margin-top:6px}
.dcf-dot-pending{width:10px;height:10px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);display:inline-block}
.dcf-tasktitle{min-width:0;flex:1 1 auto;overflow-wrap:anywhere}

/* 「思考中 / 思考完成」：容器的标题行 + 左侧竖线表达从属，不加背景板（不与卡片抢层级）。 */
.dcf-thinking{display:flex;flex-direction:column;gap:2px}
.dcf-thinkinghead{border-left:2px solid var(--dsw-alias-border-l2)}
.dcf-thinking[data-live=true] .dcf-thinkinghead{border-left-color:var(--dsw-alias-label-primary)}
.dcf-thinkingtitle{flex:none;color:var(--dsw-alias-label-tertiary)}
/* 浮动光效：一道高光在文字上循环扫过，用来表达「还在处理」。 */
.dcf-thinkingtitle[data-shimmer=true]{background-image:linear-gradient(100deg,var(--dsw-alias-label-tertiary) 0%,var(--dsw-alias-label-tertiary) 38%,var(--dsw-alias-label-primary) 50%,var(--dsw-alias-label-tertiary) 62%,var(--dsw-alias-label-tertiary) 100%);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:dcf-shimmer 1.8s linear infinite}
@keyframes dcf-shimmer{from{background-position:120% 0}to{background-position:-120% 0}}

/* 卡片：一次操作的背景板。头部一行，展开体在里面。 */
.dcf-card{background:0 0;border:0;border-radius:0;overflow:visible}
.dcf-card[data-live=true]{}
.dcf-cardhead{display:flex;align-items:center;gap:8px;width:100%;min-width:0;background:0 0;border:none;padding:4px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-cardhead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-cardhead:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:-2px}
.dcf-cardicon{flex:none;width:14px;height:14px;color:var(--dsw-alias-label-secondary)}
.dcf-cardtitle{flex:none;color:var(--dsw-alias-label-tertiary)}
.dcf-cardsummary{min-width:0;flex:1 1 auto;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,Consolas,monospace;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcf-cardbody{display:flex;flex-direction:column;gap:6px;padding:0 6px 6px 22px}

/* 状态徽标：同一套色调语义给所有卡片复用。 */
.dcf-chip{flex:none;border-radius:999px;padding:1px 8px;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.12));color:var(--dsw-alias-label-tertiary)}
.dcf-chip[data-tone=ok]{color:var(--dsw-alias-state-success-label,var(--dsw-alias-label-secondary))}
.dcf-chip[data-tone=err]{color:var(--dsw-alias-state-error-label,var(--dsw-alias-label-primary))}
.dcf-chip[data-tone=warn]{color:var(--dsw-alias-state-warn-label,var(--dsw-alias-label-secondary))}
.dcf-chip[data-tone=live]{color:var(--dsw-alias-label-primary)}
.dcf-chip[data-tone=add]{color:var(--dsw-alias-state-success-label,var(--dsw-alias-label-secondary))}
.dcf-chip[data-tone=del]{color:var(--dsw-alias-state-error-label,var(--dsw-alias-label-primary))}
.dcf-chip[data-tone=muted]{opacity:.7}

/* 提问卡：问题 + 选项（被选中的那项高亮）。 */
.dcf-question{display:flex;flex-direction:column;gap:2px}
.dcf-questiontext{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.dcf-option{color:var(--dsw-alias-label-tertiary);font-size:13px;padding-left:14px;position:relative}
.dcf-option::before{content:'·';position:absolute;left:4px}
.dcf-option[data-chosen=true]{color:var(--dsw-alias-label-primary);font-weight:500}
.dcf-option[data-chosen=true]::before{content:'✓'}

/* 右侧回合导轨：粘在滚动视口顶部的零高槽里，绝对定位出竖向刻度条。 */
.dcf-rail-slot{position:sticky;top:0;z-index:7;height:0;pointer-events:none}
.dcf-rail{--dcf-rail-band:calc(var(--dsh-conversation-viewport-height,100dvh) - var(--dsh-composer-height,152px));position:absolute;right:6px;top:calc(var(--dcf-rail-band) / 2);transform:translateY(-50%);display:flex;flex-direction:column;gap:8px;padding:6px 0;max-height:min(420px,max(0px,calc(var(--dcf-rail-band) - 80px)));overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;pointer-events:auto}
.dcf-rail::-webkit-scrollbar{display:none}
.dcf-mark{position:relative;flex:none;width:22px;height:10px;padding:0;border:0;background:0 0;cursor:pointer}
.dcf-mark::before{content:'';position:absolute;top:50%;right:0;transform:translateY(-50%);width:12px;height:2px;border-radius:2px;background:var(--dsw-alias-border-l4);transition:width .14s ease,background-color .14s ease}
.dcf-mark:hover::before{background:var(--dsw-alias-label-tertiary);width:18px}
.dcf-mark[data-active=true]::before{background:var(--dsw-alias-label-primary);width:20px}
.dcf-mark[data-loaded=false]::before{width:8px;opacity:.55}
.dcf-mark[data-busy=true]::before{animation:dcf-mark-live 1s ease-in-out infinite}
.dcf-mark .dcf-spinner{position:absolute;top:50%;right:2px;transform:translateY(-50%);width:10px;height:10px}
.dcf-mark[data-live=true]::before{animation:dcf-mark-live 1s ease-in-out infinite}
.dcf-mark:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:2px;border-radius:4px}
.dcf-scroll-bottom-btn{position:fixed;bottom:56px;right:28px;z-index:8;display:flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:50%;border:1px solid var(--dsw-alias-border-l2,#444);background:var(--dsw-alias-surface-secondary,rgba(30,30,30,.85));color:var(--dsw-alias-label-secondary,#ccc);cursor:pointer;backdrop-filter:blur(4px);box-shadow:0 2px 12px rgba(0,0,0,.35);transition:opacity .18s ease,transform .14s ease}
.dcf-scroll-bottom-btn:hover{background:var(--dsw-alias-surface-tertiary,rgba(50,50,50,.9));transform:translateY(-1px)}
.dcf-scroll-bottom-btn:active{transform:translateY(0)}
.dcf-scroll-bottom-btn:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:2px}

@keyframes dcf-mark-live{0%,100%{opacity:1}50%{opacity:.35}}

/* 窄屏 / 手机：阅读列收窄内边距、导轨变细并让位、触摸目标加大、避开安全区。
   导轨**不隐藏**——它是这个视图的主要导航；只把它压细并给内容留出右侧空间。 */
@media (max-width:720px){
.dcf-root{padding:10px 0 8px}
.dcf-main{gap:12px;padding:0 20px 0 12px}
.dcf-rail{right:2px;gap:10px;max-height:min(320px,max(0px,calc(var(--dcf-rail-band) - 48px)))}
.dcf-mark{width:24px;height:20px}
.dcf-mark::before{width:12px;height:3px;border-radius:2px}
.dcf-mark[data-active=true]::before{width:14px}
.dcf-ask .dcf-bubble{max-width:100%}
.dcf-summary{max-width:42vw}
.dcf-cardhead,.dcf-platehead{padding:9px 10px}
button.dcf-row,button.dcf-taskrow{min-height:34px;align-items:center}
.dcf-chev{margin-top:0}
.dcf-dot{margin-top:0}
.dcf-cardsummary{font-size:12px}
.dcf-pre{max-height:220px;font-size:11px}
.dcf-cardbody{padding:0 10px 10px 10px}
.dcf-body{padding:2px 0 4px 14px}
.dcf-platebody{padding:2px 8px 6px 16px}
.dcf-leaf+.dcf-leaf{margin-top:12px}
}

/* 行首状态标记（目前只有插队消息用）：贴在气泡上方，说明这条消息是怎么进来的。 */
.dcf-leaf-marked{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.dcf-leafmarker{align-self:flex-end;margin-right:4px}

/* 待发送 / 插队的消息：坐在列表末尾，一眼看出「我发的消息去哪了」。 */
.dcf-pending{display:flex;flex-direction:column;align-items:flex-end;gap:4px;opacity:.92}
.dcf-pendingstate{display:flex;justify-content:flex-end;padding-right:4px}

/* 视图层错误摘要：不白屏、可读、可反馈（正常情况永远看不到它）。 */
.dcf-error{display:flex;flex-direction:column;gap:8px;margin:10px 0;padding:12px 14px;border:.5px solid var(--dsw-alias-state-error-primary,var(--dsw-alias-border-l1));border-radius:10px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08))}
.dcf-errortitle{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-primary));font-weight:500}

/* 触屏设备：去掉只对鼠标有意义的悬浮反馈，避免点击后残留 hover 态。 */
@media (hover:none){
.dcf-rail{right:0;gap:12px}
.dcf-mark{width:34px;height:24px}
.dcf-mark::before{width:16px;height:3px}
.dcf-mark[data-active=true]::before{width:20px}
.dcf-row:hover,button.dcf-taskrow:hover,.dcf-cardhead:hover,.dcf-platehead:hover{background:0 0}
.dcf-mark:hover::before{width:12px;background:var(--dsw-alias-border-l4)}
}

/* 动效收敛：尊重系统的「减少动态效果」。 */
@media (prefers-reduced-motion:reduce){
.dcf-fold,.dcf-fold[data-open=true],.dcf-chev,.dcf-mark::before{transition:none}
.dcf-mark[data-live=true]::before{animation:none}
.dcf-thinkingtitle[data-shimmer=true]{animation:none;background-image:none;color:inherit}
}
`

    /** 注入样式：按固定 id 去重，重复调用不会堆 `<style>`。 */
    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = FLOW_CSS
      document.head.appendChild(style)
    }
