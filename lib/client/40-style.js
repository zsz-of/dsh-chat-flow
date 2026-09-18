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
     * 若把导轨与内容放进同一个限宽列，它就只能贴内容右缘而不是窗口右缘，宽窗口下会显得很怪
     * （核心的 TurnNavigator 也是把槽放在限宽列外面的）。
     */
    const FLOW_CSS = `
.dcf-root{display:block;width:100%;padding:14px 0 8px;box-sizing:border-box;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary)}
.dcf-main{display:flex;flex-direction:column;gap:14px;width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;padding:0 30px;box-sizing:border-box}
.dcf-empty{color:var(--dsw-alias-label-tertiary);padding:8px 2px}
.dcf-hint{color:var(--dsw-alias-label-tertiary);font-size:13px;background:0 0;border:none;cursor:pointer;text-align:left;padding:4px 2px}
.dcf-hint:hover{color:var(--dsw-alias-label-secondary)}
.dcf-turn{display:flex;flex-direction:column;gap:10px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:12px;scroll-margin-top:12px}
.dcf-turn:first-child{border-top:none;padding-top:0}
.dcf-ask{display:flex;justify-content:flex-end}
.dcf-ask .dcf-bubble{background:var(--dsw-specific-bubble);border-radius:18px;padding:9px 14px;max-width:min(82%,640px);white-space:pre-wrap;word-break:break-word}
.dcf-block{display:flex;flex-direction:column;gap:6px}
.dcf-row{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:6px;padding:3px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-row:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:1px}
.dcf-row[data-static=true]{cursor:default}
.dcf-row[data-static=true]:hover{background:0 0}
.dcf-chev{flex:none;width:14px;height:14px;margin-top:4px;color:var(--dsw-alias-label-caption);transition:transform .22s cubic-bezier(.2,.8,.2,1)}
.dcf-chev[data-open=true]{transform:rotate(90deg)}
.dcf-title{flex:none;color:var(--dsw-alias-label-secondary)}
.dcf-summary{min-width:0;flex:1 1 auto;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcf-count{flex:none;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.dcf-body{display:flex;flex-direction:column;gap:6px;padding:2px 0 4px 22px}
.dcf-panel{border-left:2px solid var(--dsw-alias-border-l2);padding-left:10px;display:flex;flex-direction:column;gap:6px}
.dcf-plan-head{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary)}
.dcf-tasks{display:flex;flex-direction:column;gap:2px}
.dcf-task{display:flex;flex-direction:column;gap:2px}
.dcf-taskrow{display:flex;align-items:flex-start;gap:8px;width:100%;min-width:0;background:0 0;border:none;border-radius:6px;padding:3px 6px;font:inherit;color:inherit;text-align:left;cursor:pointer}
.dcf-taskrow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dcf-taskrow[data-status=completed] .dcf-tasktitle{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.dcf-taskrow[data-status=in_progress] .dcf-tasktitle{color:var(--dsw-alias-label-primary);font-weight:500}
.dcf-taskrow[data-status=pending] .dcf-tasktitle{color:var(--dsw-alias-label-secondary)}
.dcf-dot{flex:none;margin-top:6px}
.dcf-dot-pending{width:10px;height:10px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);display:inline-block}
.dcf-tasktitle{min-width:0;flex:1 1 auto;overflow-wrap:anywhere}
.dcf-badge{flex:none;color:var(--dsw-alias-label-caption);font-size:12px;font-variant-numeric:tabular-nums}
.dcf-text{overflow-wrap:anywhere}
.dcf-text p{margin:0 0 8px}
.dcf-text p:last-child{margin-bottom:0}
.dcf-pre{margin:0;padding:8px 10px;background:var(--dsw-alias-bg-secondary,rgba(127,127,127,.08));border-radius:6px;overflow:auto;max-height:280px;white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dcf-foot{color:var(--dsw-alias-label-caption);font-size:12px;padding-top:2px}

/* 折叠动画：grid-template-rows 0fr ↔ 1fr 是不需要 JS 量高度的平滑方案。
   子树**保持挂载**（与核心的稳定 seat 同思路）：卸载会丢掉嵌套块的展开状态，
   进出也会退化成「瞬间替换」。收起时用 visibility 把子树的 Tab 焦点一并摘掉，
   并把这一步推迟到动画结束（0s 延迟 + 动画时长）。 */
.dcf-fold{display:grid;grid-template-rows:0fr;visibility:hidden;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear .22s}
.dcf-fold[data-open=true]{grid-template-rows:1fr;visibility:visible;transition:grid-template-rows .22s cubic-bezier(.2,.8,.2,1),visibility 0s linear 0s}
.dcf-fold>*{min-height:0;overflow:hidden}

/* 右侧回合导轨：粘在滚动视口顶部的零高槽里，绝对定位出竖向刻度条。 */
.dcf-rail-slot{position:sticky;top:0;z-index:7;height:0;pointer-events:none}
.dcf-rail{--dcf-rail-band:calc(var(--dsh-conversation-viewport-height,100dvh) - var(--dsh-composer-height,152px));position:absolute;right:6px;top:calc(var(--dcf-rail-band) / 2);transform:translateY(-50%);display:flex;flex-direction:column;gap:8px;padding:6px 0;max-height:min(420px,max(0px,calc(var(--dcf-rail-band) - 80px)));overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;pointer-events:auto}
.dcf-rail::-webkit-scrollbar{display:none}
.dcf-mark{position:relative;flex:none;width:22px;height:10px;padding:0;border:0;background:0 0;cursor:pointer}
.dcf-mark::before{content:'';position:absolute;top:50%;right:0;transform:translateY(-50%);width:12px;height:2px;border-radius:2px;background:var(--dsw-alias-border-l4);transition:width .14s ease,background-color .14s ease}
.dcf-mark:hover::before{background:var(--dsw-alias-label-tertiary);width:18px}
.dcf-mark[data-active=true]::before{background:var(--dsw-alias-label-primary);width:20px}
.dcf-mark[data-live=true]::before{animation:dcf-mark-live 1s ease-in-out infinite}
.dcf-mark:focus-visible{outline:2px solid var(--dsw-alias-label-secondary);outline-offset:2px;border-radius:4px}
@keyframes dcf-mark-live{0%,100%{opacity:1}50%{opacity:.35}}

/* 动效收敛：尊重系统的「减少动态效果」。 */
@media (prefers-reduced-motion:reduce){
.dcf-fold,.dcf-fold[data-open=true],.dcf-chev,.dcf-mark::before{transition:none}
.dcf-mark[data-live=true]::before{animation:none}
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
