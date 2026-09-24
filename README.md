# DSH Chat Flow

> 把 TRAE / Cline 那种**「计划 → 任务列表 → 子对话折叠 + 活动折叠统计」**的对话体验带进 DSH：
> 一个与原生「对话」并列的「任务」主视图 + 一段写进系统提示的「对用户输出」协议（DSH 双面孔包插件）。

**开发者**：zsz
**版本**：v0.1.0

## 许可证

本程序基于 **GNU General Public License v3.0 (GPLv3)** 开源协议发布。

Copyright (C) 2026 zsz

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

本程序分发时附带希望其有用的保证，但不提供任何担保；甚至不提供适销性或特定用途适用性的默示担保。详见 [LICENSE](LICENSE)。

---

## 系统要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 / 11（64 位） |
| 宿主 | [DSH Desktop](https://www.deepseek.com)（插件体系按 0.1.2-rc.1 核实） |
| 开发环境 | Node.js ≥ 20（仅安装与开发时需要） |

## 下载安装

本插件不发布安装包，安装即「从源码装进本机的 DSH」：

1. 克隆本仓库；
2. 在仓库目录执行 `node scripts/install.mjs`；
3. 重启 DSH Desktop，标签栏出现「任务」视图。

```powershell
git clone <本仓库地址>
cd dsh-chat-flow
node scripts/install.mjs            # 构建客户端 + 安装进 web profile + 组合校验
node scripts/install.mjs --dry-run  # 只打印将要做什么
node scripts/install.mjs --revert   # 卸载
```

脚本做三件事：把仓库目录以 junction 链接进 `<harness>/profiles/web/node_modules/dsh-chat-flow`、
在 profile 的 `package.json` 里加入依赖与 `dsh.profile.bundles` 条目、最后跑
`dsh --profile web --dump-config` 断言插件行真的进了组合结果。
host 只在启动时组合 profile，客户端 bundle 的 URL 带内容哈希，所以**装完要重启 DSH Desktop**。

## 功能特性

| 功能 | 说明 | 依赖 |
|---|---|---|
| 任务主视图 | 与原生「对话」并列的独立视图，把扁平对话重组为「回合 → 任务阶段 → 任务列表快照 → 子任务 → 处理过程」 | DSH 会话存储（只读） |
| 任务列表快照 | 每次 `todo_write` 冻结一份列表；最新一版默认展开，被接管的旧版自动折叠并显示「已停止」 | 模型的 `todo_write` 调用 |
| 原生叶子 | 命令卡 / 文件差异 / 读取搜索 / 提问卡 / 思考行全部经 `conversation.chat.node` 交给核心渲染，本插件只画层级 | DSH 原生节点条目 |
| 过程折叠统计 | 「思考中 / 思考完成」块折叠时显示「思考 x 次 · 执行 y 条命令 · 读取 w 个文件 · 编辑 z 个文件…」，0 值不显示 | 工具调用事件 |
| 对用户输出协议 | 模型只在四个时机说话：任务开始、输出计划、需要审批、任务结束 | 系统提示分区 + 回合首步提醒 |
| 回合导轨与分页 | 右侧刻度跳转（未加载刻度点击即加载），触顶自动加载更早历史且不跳动 | 会话时间线 |
| 折叠状态记忆 | 展开收起按会话记进 localStorage，刷新后不还原；不可用时降级为页面内存 | 浏览器 localStorage |

## 项目简介

这是一个 **DSH 双面孔包插件**（host + client）：

- **host 半侧**（`lib/index.js` + `lib/protocol.js`）只做两件事——把「对用户输出」协议注册成系统提示分区、
  在每个回合的第一步注入一次规划提醒；
- **client 半侧**（`lib/client/*.js`）是一个独立视图：**层级自己画，叶子交给核心**。
  派生层（`20-derive.js`）从 `useChat` 快照纯函数地推导出回合分组、任务快照分段、子任务归属与统计，
  渲染层把每一行节点经插槽交给核心的原生条目，原生条目缺席或渲染失败时退化成自绘卡片。

技术栈：纯 JavaScript（ESM）、React（DSH 平台内置）、Node 内置模块；无构建工具、无转译、无第三方运行时依赖。
客户端必须交付成单文件 bundle（DSH 只按 `exports["./client"]` 提供一个 URL），
源码按 `lib/client/00-…99-` 分片、由脚本按文件名顺序拼接。

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

## 从源码恢复开发环境

前提：Windows + 已安装 DSH Desktop + Node.js ≥ 20。无需 `npm install`（没有第三方依赖），
`scripts/install.mjs` 会把所需的 `@deepseek-ai/*` 链接进本机 DSH 的 profile。

```powershell
node scripts/build-client.mjs            # 改完 lib/client/*.js 必跑
node scripts/build-client.mjs --check    # 校验产物与分片同步
node --test                              # 全部测试（当前 112 条）
node scripts/install.mjs                 # 装进本机 DSH 并做组合校验
```

## 运行方式

装好后打开 DSH Desktop，用顶部标签切到「任务」即可；原生「对话」视图保持不动，两者并行。
协议与提醒由 host 在会话装配时注入，对用户不可见。

## 配置位置

本插件**不写任何宿主数据**：唯一的持久化是浏览器 localStorage 里的折叠状态
（键名 `dsh-chat-flow.collapse.<sessionId>`），用于「刷新后展开/收起状态不还原」；
localStorage 不可用时自动降级为当前页面内存。卸载用 `node scripts/install.mjs --revert`。

## 开源引用

| 项目 | 用途 | 链接 |
|---|---|---|
| DeepSeek DSH | 宿主与插件体系（`@deepseek-ai/*`） | https://www.deepseek.com |
| Cline | 「计划 → 任务列表 → 折叠」交互形态参考 | https://github.com/cline/cline |
| TRAE | 对话任务化体验参考 | https://www.trae.ai |
