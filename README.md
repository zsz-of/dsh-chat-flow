# dsh-chat-flow

把 TRAE / Cline 那种**「计划 → 任务列表 → 子对话折叠 + 活动折叠统计」**的对话体验带进 DSH。

- **任务主视图**：接管对话视图，把扁平的对话重组成「计划分组 → 任务列表 → 每个任务的子对话」。
  任务状态实时跟随模型的 `todo_write`，每完成一项界面就更新一次。
- **「正在处理」折叠统计**：任务执行期间的命令、文件编辑、提问、MCP 与插件调用被折进一块，
  折叠时只显示统计（编辑文件 / 命令 / 提问 / MCP / 插件 各多少次），展开才逐条看明细。
- **「对用户输出」协议**：模型只在四个时机对用户说话——任务开始、输出任务计划、需要审批、任务结束；
  其余动作一律不产生正文，而是进入「正在处理」。
- **先规划后执行**：多步任务在动手前先写任务列表；只值一步的琐事不会被强制写计划。

## 安装

```powershell
cd Source
node scripts/install.mjs            # 构建客户端 + 安装进 web profile + 组合校验
# 然后重启 DSH Desktop（host 只在启动时组合 profile，客户端 bundle 的 URL 带内容哈希）
```

脚本做三件事：把 `Source/` 以 junction 链接进 `<harness>/profiles/web/node_modules/dsh-chat-flow`、
在 profile 的 `package.json` 里加入依赖与 `dsh.profile.bundles` 条目、最后跑
`dsh --profile web --dump-config` 断言插件行真的进了组合结果。

```powershell
node scripts/install.mjs --dry-run   # 只打印将要做什么
node scripts/install.mjs --revert    # 卸载（保留客户端 bundle 与依赖链接）
```

## 目录结构

```text
lib/index.js                host 入口：系统提示协议 + 规划提醒
lib/protocol.js             两段模型可见文本
lib/client/*.js             客户端源码分片
lib/client.js               生成的单文件 bundle（勿直接改）
scripts/build-client.mjs    分片 → 单文件 + 语法自检
scripts/install.mjs         安装 / 回滚 / 组合校验
test/                       node --test 测试
cordis.patch.yml            bundle patch 层（安装即插入插件行）
```

## 数据与配置

本插件**不写任何宿主数据**：唯一的持久化是浏览器 localStorage 里的折叠状态
（键名 `dsh-chat-flow.collapse.<sessionId>`），用于「刷新后展开/收起状态不还原」。
localStorage 不可用时自动降级为当前页面内存。

## 开发

```powershell
node scripts/build-client.mjs            # 改完 lib/client/*.js 必跑
node scripts/build-client.mjs --check    # 校验产物与分片同步
node --test                              # 全部测试
```

客户端只能是单文件 bundle（DSH 只按 `exports["./client"]` 提供一个 URL），
所以源码按 `lib/client/00-…99-` 分片、由脚本按文件名顺序拼接；没有转译、没有依赖解析。

## 依赖

host 半侧只用 Node 内置模块与 `@deepseek-ai/*` peer（`dsh-llm`、`dsh-agent`、`dsh-system-prompt`、`cordis`）。
客户端只用平台提供的模块表里的 `react` 与 `@deepseek-ai/dsh-client-ui-primitives`。
**没有任何第三方运行时依赖。**

## 许可证

MIT
