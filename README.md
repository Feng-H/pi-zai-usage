# pi-zai-usage

> pi coding agent 扩展：在 footer 状态行内联显示智谱 GLM / Z.ai Coding Plan 的**真实服务端配额**。

## 这是什么

把智谱/Z.ai Coding Plan 的服务端配额，直接显示在 pi 的底部状态行（footer）里，跨设备准确、带重置倒计时。不再需要切到网页查「我还剩多少额度」。

```
~/proj (main)  ↑1k ↓227 0.6%/200K zeda 5h 28% (auto)        glm-5.1
                                              └──── 徽标
```

- `zeda 5h 28%` — 5 小时滚动 token 窗口已用 28%，绿/黄/红按用量着色
- 当服务端 API 不可达时，回退到扫描本机会话 JSONL 做**本地近似**（`~` 前缀区分）
- `/usage` 命令弹出配额明细：套餐档位 / 5h token / 周配额 / 工具额度 / 重置时间，再次执行关闭

## 数据源

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

## 安装

```bash
# npm（发布后）
pi install npm:pi-zai-usage

# git 源
pi install git:github.com/Feng-H/pi-zai-usage
```

## 环境变量（可选）

| 变量               | 默认                              | 说明                                       |
| ------------------ | --------------------------------- | ------------------------------------------ |
| `PI_USAGE_BASE`    | 按 provider 自动                  | 配额端点 host                              |
| `PI_USAGE_WINDOW_H`| `5`                               | 本地回退的滚动窗口小时数                   |
| `PI_USAGE_PROVIDER`| provider 或 `zai`                 | 本地回退的 provider 匹配子串               |

## 渲染说明

用 `ctx.ui.setFooter()` 接管 footer，采用**单行布局** `pwd  stats ···· model`，徽标注入 stats 的「上下文窗口」与「(auto)」之间。窄终端按 provider 前缀 → pwd → 模型名 逐级裁剪，stats（含徽标 / 上下文%）核心信息尽量保完整。

> `setStatus()` 的徽标会被固定到单独的「扩展状态行」，无法并入 stats 行，故用 `setFooter`。

## License

MIT
