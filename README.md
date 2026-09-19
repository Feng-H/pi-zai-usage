# pi-zai-usage

[![npm version](https://img.shields.io/npm/v/pi-zai-usage.svg?color=blue)](https://www.npmjs.com/package/pi-zai-usage)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**[English](#what-it-is) | [简体中文](#中文说明)**

> A [pi](https://pi.dev) extension that shows your **real server-side quota** for Zhipu GLM / Z.ai Coding Plans inline in the footer status bar.

## What it is

Displays Zhipu/Z.ai Coding Plan quotas directly in pi's footer — accurate across devices, with reset countdown. No more switching to a web page to check "how much am I down to".

```
~/proj (main)  ↑1k ↓227 0.6%/200K zeda 5h 28% (auto)        glm-5.1
                                              └──── badge
```

- `zeda 5h 28%` — 28% of the 5-hour rolling token window used, colored green/yellow/red by usage
- When the server API is unreachable, falls back to scanning local session JSONLs for a **local approximation** (distinguished by a `~` prefix)
- `/usage` toggles a detail popup: plan tier / 5h tokens / weekly quota / tool quotas / reset times

## Data source

Zhipu/Z.ai actually exposes a quota endpoint (per cc-switch's coding_plan implementation):

```
GET {base}/api/monitor/usage/quota/limit
Authorization: Bearer <api_key>
```

Response `data.limits[]` (unit semantics from the z.ai frontend source):

| type           | unit | meaning                                                |
| -------------- | ---- | ------------------------------------------------------ |
| `TOKENS_LIMIT` | 3    | 5-hour rolling token window (main badge)               |
| `TOKENS_LIMIT` | 6    | weekly quota (some plans / international site only)    |
| `TIME_LIMIT`   | 5    | tools/search (monthly, shown in `/usage`)              |

`base` is auto-selected per provider (`zai-coding-cn` / containing `bigmodel` → `open.bigmodel.cn`, else `api.z.ai`).

## Install

Install via **npm** (recommended):

```bash
pi install npm:pi-zai-usage
```

Or install directly from **GitHub**:

```bash
pi install git:github.com/Feng-H/pi-zai-usage
```

## Environment variables (optional)

| Variable           | Default              | Meaning                                    |
| ------------------ | -------------------- | ------------------------------------------ |
| `PI_USAGE_BASE`    | auto per provider    | quota endpoint host                        |
| `PI_USAGE_WINDOW_H`| `5`                  | rolling window hours for the local fallback|
| `PI_USAGE_PROVIDER`| provider or `zai`    | provider substring match for local fallback|

## Rendering notes

Uses `ctx.ui.setFooter()` with a single-line layout `pwd  stats ···· model`; the badge is injected into stats between the context-window % and `(auto)`. On narrow terminals it trims progressively (provider prefix → pwd → model name) while keeping stats (badge / context %) intact.

> `setStatus()` pins badges to a separate extension status row that can't merge into the stats line — hence `setFooter`.

---

## 中文说明

[![npm version](https://img.shields.io/npm/v/pi-zai-usage.svg?color=blue)](https://www.npmjs.com/package/pi-zai-usage)

> pi coding agent 扩展：在 footer 状态行内联显示智谱 GLM / Z.ai Coding Plan 的**真实服务端配额**。

### 这是什么

把智谱/Z.ai Coding Plan 的服务端配额，直接显示在 pi 的底部状态行（footer）里，跨设备准确、带重置倒计时。不再需要切到网页查「我还剩多少额度」。

```
~/proj (main)  ↑1k ↓227 0.6%/200K zeda 5h 28% (auto)        glm-5.1
                                              └──── 徽标
```

- `zeda 5h 28%` — 5 小时滚动 token 窗口已用 28%，绿/黄/红按用量着色
- 当服务端 API 不可达时，回退到扫描本机会话 JSONL 做**本地近似**（`~` 前缀区分）
- `/usage` 命令弹出配额明细：套餐档位 / 5h token / 周配额 / 工具额度 / 重置时间，再次执行关闭

### 数据源

智谱/Z.ai 其实开放了配额查询接口（参考 cc-switch 的 coding_plan 实现）：

```
GET {base}/api/monitor/usage/quota/limit
Authorization: Bearer <api_key>
```

响应 `data.limits[]`（unit 含义来自 z.ai 前端源码）：

| type           | unit | 含义                                       |
| -------------- | ---- | ------------------------------------------ |
| `TOKENS_LIMIT` | 3    | 5 小时滚动 token 窗口（徽标主显示）        |
| `TOKENS_LIMIT` | 6    | 周配额（部分套餐/国际站才有，`/usage` 展示）|
| `TIME_LIMIT`   | 5    | 工具/搜索类（月度，`/usage` 展示）          |

`base` 按 provider 自动选择（`zai-coding-cn`/含 `bigmodel` → `open.bigmodel.cn`，否则 `api.z.ai`）。

### 安装方式

通过 **npm 官方镜像** 安装（推荐）：

```bash
pi install npm:pi-zai-usage
```

或者直接从 **GitHub** 安装：

```bash
pi install git:github.com/Feng-H/pi-zai-usage
```

- npm 官方包页面：[https://www.npmjs.com/package/pi-zai-usage](https://www.npmjs.com/package/pi-zai-usage)

### 环境变量（可选）

| 变量               | 默认                              | 说明                                       |
| ------------------ | --------------------------------- | ------------------------------------------ |
| `PI_USAGE_BASE`    | 按 provider 自动                  | 配额端点 host                              |
| `PI_USAGE_WINDOW_H`| `5`                               | 本地回退的滚动窗口小时数                   |
| `PI_USAGE_PROVIDER`| provider 或 `zai`                 | 本地回退的 provider 匹配子串               |

### 渲染说明

用 `ctx.ui.setFooter()` 接管 footer，采用**单行布局** `pwd  stats ···· model`，徽标注入 stats 的「上下文窗口」与「(auto)」之间。窄终端按 provider 前缀 → pwd → 模型名 逐级裁剪，stats（含徽标 / 上下文%）核心信息尽量保完整。

> `setStatus()` 的徽标会被固定到单独的「扩展状态行」，无法并入 stats 行，故用 `setFooter`。

## License

MIT
