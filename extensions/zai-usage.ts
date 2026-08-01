/**
 * zai-usage.ts — 在 footer 状态行内联显示智谱 GLM / Z.ai Coding Plan 的「真实服务端配额」。
 *
 * 关键突破（参考 cc-switch 的 coding_plan 实现）：
 * 智谱/Z.ai 其实【开放】配额查询接口，我先前「不开放」的判断是错的。
 *   GET {base}/api/monitor/usage/quota/limit
 *   Authorization: Bearer <api_key>   ← 实测：国内站裸 key/Bearer 都接受；国际站用 Bearer（参考 cc-switch / pi-glm-usage）。统一用 Bearer 最通用。
 *   Content-Type: application/json
 *   Accept-Language: en-US,en
 * 响应 data.limits[]（unit 含义来自 z.ai 前端源码）：
 *   - TOKENS_LIMIT unit=3：5 小时滚动 token 窗口（徽标主显示）
 *   - TOKENS_LIMIT unit=6：周配额（部分套餐/国际站才有，有则 /usage 展示）
 *   - TIME_LIMIT   unit=5：工具/搜索类（月度）
 * 本扩展取 TOKENS_LIMIT(unit=3) 作为主徽标，跨设备准确、带重置倒计时。
 * 当 API 不可达时，回退到扫描本机会话 JSONL 做本地近似（带 ~ 前缀区分）。
 *
 * 渲染：用 ctx.ui.setFooter() 接管 footer，**单行布局** `pwd  stats ···· model`，
 * 徽标注入 stats 的「上下文窗口」与「(auto)」之间：
 *   `~/proj (main)  ↑1k ↓227 0.6%/200K zeda 5h 28% (auto)        glm-5.1`
 * setStatus() 的徽标会被固定到单独的「扩展状态行」，无法并入 stats 行，故用 setFooter。
 *
 * 环境变量：
 *   PI_USAGE_BASE      配额端点 host（默认按 provider 自动：zai-coding-cn→bigmodel.cn，否则 z.ai）
 *   PI_USAGE_WINDOW_H  本地回退的滚动窗口小时数（默认 5）
 *   PI_USAGE_PROVIDER  本地回退的 provider 匹配子串
 *
 * 命令：
 *   /usage   弹出配额明细（套餐档位 / 5h token / 工具额度 / 重置时间），再次执行关闭
 */
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const WIDGET_KEY = "zai-usage-detail";

// ── 紧凑数字格式 ────────────────────────────────────────────
function fmt(n: number): string {
	if (n < 1000) return `${Math.round(n)}`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
	return `${(n / 1_000_000).toFixed(2)}M`;
}
/** footer token 格式（忠实复刻 pi 默认 footer 的 formatTokens） */
function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}
/** cwd → footer 显示（~ 替换 home） */
function formatCwdForFooter(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const resolvedCwd = path.resolve(cwd);
	const resolvedHome = path.resolve(home);
	const rel = path.relative(resolvedHome, resolvedCwd);
	const inside =
		rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
	if (!inside) return cwd;
	return rel === "" ? "~" : `~${path.sep}${rel}`;
}

// ── 服务端配额 ──────────────────────────────────────────────
interface LimitTier {
	percentage: number;
	resetMs: number | null;
}
interface Quota {
	level: string | null; // 套餐档位: lite / pro / ...
	tokens: LimitTier | null; // TOKENS_LIMIT, unit=3（5h token 窗口）— 徽标主显示
	weekly: LimitTier | null; // TOKENS_LIMIT, unit=6（周配额，部分套餐/国际站才有）
	time: LimitTier | null; // TIME_LIMIT, unit=5（工具/搜索类，月度）
	timeDetails?: { model: string; usage: number }[];
	queriedAt: number;
}

/** GET 配额接口，解析 TOKENS_LIMIT(unit=3) 与 TIME_LIMIT。Authorization 不加 Bearer。 */
async function fetchQuota(base: string, apiKey: string): Promise<Quota | null> {
	let resp: Response;
	try {
		resp = await fetch(`${base}/api/monitor/usage/quota/limit`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				"Accept-Language": "en-US,en",
			},
			signal: AbortSignal.timeout(15000),
		});
	} catch {
		return null;
	}
	if (resp.status === 401 || resp.status === 403) return null;
	if (!resp.ok) return null;
	let body: any;
	try {
		body = await resp.json();
	} catch {
		return null;
	}
	if (body?.success === false) return null;
	const data = body?.data;
	if (!data) return null;

	let tokens: LimitTier | null = null;
	let weekly: LimitTier | null = null;
	let time: LimitTier | null = null;
	let timeDetails: { model: string; usage: number }[] | undefined;
	for (const lim of data.limits ?? []) {
		if (lim.type === "TOKENS_LIMIT" && lim.unit === 3 && !tokens) {
			tokens = { percentage: Number(lim.percentage) || 0, resetMs: lim.nextResetTime ?? null };
		} else if (lim.type === "TOKENS_LIMIT" && lim.unit === 6 && !weekly) {
			weekly = { percentage: Number(lim.percentage) || 0, resetMs: lim.nextResetTime ?? null };
		} else if (lim.type === "TIME_LIMIT" && !time) {
			time = { percentage: Number(lim.percentage) || 0, resetMs: lim.nextResetTime ?? null };
			timeDetails = (lim.usageDetails ?? []).map((d: any) => ({
				model: String(d.modelCode ?? "?"),
				usage: Number(d.usage) || 0,
			}));
		}
	}
	return {
		level: data.level ? String(data.level) : null,
		tokens,
		weekly,
		time,
		timeDetails,
		queriedAt: Date.now(),
	};
}

// ── 本地兜底：扫描会话 JSONL ────────────────────────────────
interface LocalTotals {
	total: number;
	input: number;
	output: number;
	cache: number;
}
function computeWindowLocal(globalRoot: string, windowMs: number, providerMatch: string): LocalTotals {
	const cutoff = Date.now() - windowMs;
	let total = 0,
		input = 0,
		output = 0,
		cache = 0;
	let projectDirs: string[] = [];
	try {
		projectDirs = fs
			.readdirSync(globalRoot, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => path.join(globalRoot, d.name));
	} catch {
		return { total, input, output, cache };
	}
	for (const dir of projectDirs) {
		let files: string[] = [];
		try {
			files = fs
				.readdirSync(dir)
				.filter((f) => f.endsWith(".jsonl"))
				.map((f) => path.join(dir, f));
		} catch {
			continue;
		}
		for (const file of files) {
			let stat;
			try {
				stat = fs.statSync(file);
			} catch {
				continue;
			}
			if (stat.mtimeMs < cutoff) continue;
			let content: string;
			try {
				content = fs.readFileSync(file, "utf8");
			} catch {
				continue;
			}
			for (const line of content.split("\n")) {
				const t = line.trim();
				if (!t) continue;
				let e: any;
				try {
					e = JSON.parse(t);
				} catch {
					continue;
				}
				if (e.type !== "message") continue;
				const m = e.message;
				if (!m || m.role !== "assistant") continue;
				if (!(typeof m.provider === "string" && m.provider.includes(providerMatch))) continue;
				const ts =
					typeof e.timestamp === "string"
						? Date.parse(e.timestamp)
						: typeof m.timestamp === "number"
							? m.timestamp
							: 0;
				if (!ts || ts < cutoff) continue;
				const u = m.usage || {};
				input += u.input || 0;
				output += u.output || 0;
				cache += (u.cacheRead || 0) + (u.cacheWrite || 0);
				total += u.totalTokens ?? (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
			}
		}
	}
	return { total, input, output, cache };
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let widgetOpen = false;
	let capturedTui: any;

	const windowH = Number(process.env.PI_USAGE_WINDOW_H ?? 5) || 5;
	const windowMs = windowH * 3600 * 1000;

	let quota: Quota | null = null;
	let local: LocalTotals | null = null; // 本地兜底
	let lastFetch = 0;
	let fetching = false;
	let autoCompact: boolean | undefined;

	function providerMatch(ctx: any): string {
		return process.env.PI_USAGE_PROVIDER ?? ctx?.model?.provider ?? "zai";
	}
	function globalRoot(ctx: any): string {
		return path.dirname(ctx.sessionManager.getSessionDir());
	}
	function quotaBase(ctx: any): string {
		if (process.env.PI_USAGE_BASE) return process.env.PI_USAGE_BASE;
		const prov = String(ctx?.model?.provider ?? "");
		// zai-coding-cn / 含 bigmodel → 国内站；其余 → 国际站
		if (prov.includes("cn") || prov.includes("bigmodel")) return "https://open.bigmodel.cn";
		return "https://api.z.ai";
	}

	async function refreshQuota(ctx: any): Promise<void> {
		if (fetching) return;
		// 最小间隔 30s，避免 message_end 频繁打 API
		if (Date.now() - lastFetch < 30_000 && quota) return;
		fetching = true;
		lastFetch = Date.now();
		try {
			const provider = ctx?.model?.provider;
			let key: string | undefined;
			try {
				key = await ctx.modelRegistry?.getApiKeyForProvider?.(provider);
			} catch {
				/* ignore */
			}
			if (!key) {
				// 兜底：直接读 auth.json
				try {
					const auth = JSON.parse(
						fs.readFileSync(path.join(path.dirname(globalRoot(ctx)), "auth.json"), "utf8"),
					);
					key = auth?.[provider]?.key;
				} catch {
					/* ignore */
				}
			}
			if (key) {
				const q = await fetchQuota(quotaBase(ctx), key);
				if (q) quota = q;
			}
			// 本地兜底数据始终刷新一次（用于 /usage 明细与 API 失败徽标）
			local = computeWindowLocal(globalRoot(ctx), windowMs, providerMatch(ctx));
		} catch {
			/* ignore */
		} finally {
			fetching = false;
			capturedTui?.requestRender();
			if (widgetOpen) renderWidget(ctx);
		}
	}

	function readAutoCompact(ctx: any): boolean {
		if (autoCompact !== undefined) return autoCompact;
		let enabled = true;
		try {
			const agentDir = path.dirname(globalRoot(ctx));
			for (const f of [path.join(agentDir, "settings.json"), path.join(ctx.cwd, ".pi", "settings.json")]) {
				if (fs.existsSync(f)) {
					const s = JSON.parse(fs.readFileSync(f, "utf8"));
					if (s?.compaction?.enabled !== undefined) enabled = !!s.compaction.enabled;
				}
			}
		} catch {
			/* 默认 true */
		}
		autoCompact = enabled;
		return enabled;
	}

	/** 徽标（含颜色），注入 stats 行；quota 未就绪返回 undefined 表示省略 */
	function zedaBadge(ctx: any, theme: any): string | undefined {
		if (quota?.tokens) {
			const pct = quota.tokens.percentage;
			const color = pct >= 90 ? "error" : pct >= 70 ? "warning" : "success";
			return theme.fg(color, `zeda ${windowH}h ${Math.round(pct)}%`);
		}
		if (local && local.total > 0) return `zeda ${windowH}h ~${fmt(local.total)}`; // ~ 表示本地近似
		return undefined; // 加载中/失败，省略徽标
	}

	/** 单行 footer：`pwd  stats ···· model`，zeda 徽标注入「窗口」与「(auto)」之间（不再拆两行） */
	function renderFooter(ctx: any, theme: any, footerData: any, width: number): string[] {
		const state: any = { model: ctx.model, thinkingLevel: ctx.thinkingLevel };
		let inT = 0,
			outT = 0,
			cacheRead = 0,
			cacheWrite = 0,
			cost = 0;
		let latestCacheHitRate: number | undefined;
		try {
			for (const e of ctx.sessionManager.getEntries()) {
				if (e.type === "message" && e.message?.role === "assistant") {
					const u = e.message.usage || {};
					inT += u.input || 0;
					outT += u.output || 0;
					cacheRead += u.cacheRead || 0;
					cacheWrite += u.cacheWrite || 0;
					cost += u.cost?.total || 0;
					const p = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
					latestCacheHitRate = p > 0 ? ((u.cacheRead || 0) / p) * 100 : undefined;
				} else if (e.type === "message" && e.message?.role === "toolResult" && e.message?.usage) {
					const u = e.message.usage;
					inT += u.input || 0;
					outT += u.output || 0;
					cacheRead += u.cacheRead || 0;
					cacheWrite += u.cacheWrite || 0;
					cost += u.cost?.total || 0;
				} else if ((e.type === "branch_summary" || e.type === "compaction") && e.usage) {
					const u = e.usage;
					inT += u.input || 0;
					outT += u.output || 0;
					cacheRead += u.cacheRead || 0;
					cacheWrite += u.cacheWrite || 0;
					cost += u.cost?.total || 0;
				}
			}
		} catch {
			/* ignore */
		}
		const contextUsage = ctx.getContextUsage?.();
		const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
		const contextPercentValue = contextUsage?.percent ?? 0;
		const contextPercent =
			contextUsage?.percent !== null && contextUsage?.percent !== undefined
				? contextPercentValue.toFixed(1)
				: "?";

		let pwd = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
		const branch = footerData.getGitBranch();
		if (branch) pwd = `${pwd} (${branch})`;
		const sessionName = ctx.sessionManager.getSessionName?.();
		if (sessionName) pwd = `${pwd} • ${sessionName}`;

		const statsParts: string[] = [];
		if (inT) statsParts.push(`↑${formatTokens(inT)}`);
		if (outT) statsParts.push(`↓${formatTokens(outT)}`);
		if (cacheRead) statsParts.push(`R${formatTokens(cacheRead)}`);
		if (cacheWrite) statsParts.push(`W${formatTokens(cacheWrite)}`);
		if ((cacheRead > 0 || cacheWrite > 0) && latestCacheHitRate !== undefined) {
			statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
		}
		const usingSubscription = state.model ? state.model.provider === "kimi-coding" : false;
		if (cost || usingSubscription) statsParts.push(`$${cost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);

		// 上下文百分比：`pct/window [zeda] (auto)`
		const autoIndicator = readAutoCompact(ctx) ? " (auto)" : "";
		const windowStr =
			contextPercent === "?"
				? `?/${formatTokens(contextWindow)}`
				: `${contextPercent}%/${formatTokens(contextWindow)}`;
		const badge = zedaBadge(ctx, theme);
		const contextPercentDisplay = badge ? `${windowStr} ${badge}${autoIndicator}` : `${windowStr}${autoIndicator}`;

		let contextPercentStr: string;
		if (contextPercentValue > 90) contextPercentStr = theme.fg("error", contextPercentDisplay);
		else if (contextPercentValue > 70) contextPercentStr = theme.fg("warning", contextPercentDisplay);
		else contextPercentStr = contextPercentDisplay;
		statsParts.push(contextPercentStr);
		if (process.env.PI_EXPERIMENTAL === "1") {
			statsParts.push(`${theme.fg("dim", "•")} ${theme.bold(theme.fg("warning", "xp"))}`);
		}
		let statsLeft = statsParts.join(" ");

		// 右侧模型名（+ thinking / provider）
		const modelName = state.model?.id || "no-model";
		let rightSideWithoutProvider = modelName;
		if (state.model?.reasoning) {
			const thinkingLevel = state.thinkingLevel || "off";
			rightSideWithoutProvider =
				thinkingLevel === "off" ? `${modelName} • thinking off` : `${modelName} • ${thinkingLevel}`;
		}
		let rightSide = rightSideWithoutProvider;
		if (footerData.getAvailableProviderCount() > 1 && state.model) {
			rightSide = `(${state.model.provider}) ${rightSideWithoutProvider}`;
		}

		// ── 单行 footer：`pwd  stats ···· model`（不再拆两行换行） ──
		// 宽度不足时按可舍弃程度逐级裁剪：provider 前缀 → pwd → 右侧模型名；
		// stats（含 zeda 徽标 / 上下文%）是核心信息，尽量保完整
		const sep = "  ";
		const minPad = 2;
		const statsW = visibleWidth(statsLeft);

		// 1) 去掉 provider 前缀
		if (
			rightSide !== rightSideWithoutProvider &&
			visibleWidth(pwd) + sep.length + statsW + minPad + visibleWidth(rightSide) > width
		) {
			rightSide = rightSideWithoutProvider;
		}
		// 2) 截断/舍弃 pwd
		let pwdStr = pwd;
		if (visibleWidth(pwdStr) + sep.length + statsW + minPad + visibleWidth(rightSide) > width) {
			const availForPwd = width - minPad - visibleWidth(rightSide) - sep.length - statsW;
			pwdStr = availForPwd >= 3 ? truncateToWidth(pwd, availForPwd, "...") : "";
		}
		const leftW = pwdStr === "" ? statsW : visibleWidth(pwdStr) + sep.length + statsW;
		// 3) 右侧模型名仍放不下 → 截断
		if (leftW + minPad + visibleWidth(rightSide) > width) {
			const availForRight = width - leftW - minPad;
			rightSide = availForRight > 4 ? truncateToWidth(rightSide, availForRight, "") : "";
		}
		const rightW = visibleWidth(rightSide);

		// 着色：pwd / token 统计用 dim，上下文百分比保留自身颜色
		const pwdColored = pwdStr === "" ? "" : theme.fg("dim", pwdStr) + sep;
		const statsColored = theme.fg("dim", statsLeft);
		const rightColored = rightW === 0 ? "" : theme.fg("dim", rightSide);
		const pad = " ".repeat(Math.max(minPad, width - leftW - rightW));
		const lines = [pwdColored + statsColored + pad + rightColored];

		const extensionStatuses = footerData.getExtensionStatuses();
		if (extensionStatuses.size > 0) {
			const others = Array.from(extensionStatuses.entries())
				.filter(([key]) => key !== "zai-usage")
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([, text]) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim());
			if (others.length > 0) lines.push(truncateToWidth(others.join(" "), width, theme.fg("dim", "...")));
		}
		return lines;
	}

	function setupFooter(ctx: any): void {
		ctx.ui.setFooter((tui: any, theme: any, footerData: any) => {
			capturedTui = tui;
			const unsub = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: unsub,
				invalidate() {},
				render: (width: number) => renderFooter(ctx, theme, footerData, width),
			};
		});
	}

	function renderWidget(ctx: any): void {
		if (!quota && !local) return;
		const th = ctx.ui.theme;
		const lines: string[] = [];
		lines.push(th.fg("accent", `zeda · 智谱 GLM Coding Plan 配额（${quotaBase(ctx)}）`));
		if (quota?.level) lines.push(th.fg("dim", `套餐档位: ${quota.level}`));
		if (quota?.tokens) {
			const color = quota.tokens.percentage >= 90 ? "error" : quota.tokens.percentage >= 70 ? "warning" : "success";
			lines.push(th.fg(color, `5h Token 窗口: ${Math.round(quota.tokens.percentage)}% 已用`));
			if (quota.tokens.resetMs) {
				const mins = Math.max(0, Math.round((quota.tokens.resetMs - Date.now()) / 60000));
				lines.push(th.fg("dim", `  重置: ${new Date(quota.tokens.resetMs).toLocaleString()}（约 ${mins} 分钟后）`));
			}
		} else {
			lines.push(th.fg("warning", "5h Token 窗口: 接口未返回（仅本地近似）"));
		}
		if (quota?.weekly) {
			const color = quota.weekly.percentage >= 90 ? "error" : quota.weekly.percentage >= 70 ? "warning" : "success";
			lines.push(th.fg(color, `周配额: ${Math.round(quota.weekly.percentage)}% 已用`));
			if (quota.weekly.resetMs) {
				const days = Math.max(0, Math.round((quota.weekly.resetMs - Date.now()) / 86400000));
				lines.push(th.fg("dim", `  重置: ${new Date(quota.weekly.resetMs).toLocaleString()}（约 ${days} 天后）`));
			}
		}
		if (quota?.time) {
			const color = quota.time.percentage >= 90 ? "error" : quota.time.percentage >= 70 ? "warning" : "success";
			lines.push(th.fg(color, `工具/搜索额度: ${Math.round(quota.time.percentage)}% 已用`));
			if (quota.timeDetails?.length) {
				lines.push(th.fg("dim", "  " + quota.timeDetails.map((d) => `${d.model} ${d.usage}`).join(" · ")));
			}
		}
		if (local && local.total > 0) {
			lines.push(
				th.fg(
					"dim",
					`本地近似(~): ${fmt(local.total)} tok  输入 ${fmt(local.input)} 输出 ${fmt(local.output)} 缓存 ${fmt(local.cache)}`,
				),
			);
		}
		lines.push(th.fg("muted", "数据源: 智谱 /api/monitor/usage/quota/limit · /usage 关闭"));
		ctx.ui.setWidget(WIDGET_KEY, lines);
	}

	let lastCtx: any;

	pi.on("session_start", (_e, ctx) => {
		lastCtx = ctx;
		if (ctx.mode !== "tui") return;
		setupFooter(ctx);
		refreshQuota(ctx);
		if (!timer) {
			// 周期刷新：窗口滑动 / 配额随时间变化
			timer = setInterval(() => {
				if (lastCtx) refreshQuota(lastCtx);
			}, 60_000);
		}
	});

	pi.on("message_end", (_e, ctx) => {
		lastCtx = ctx;
		refreshQuota(ctx);
	});

	pi.on("session_shutdown", () => {
		if (timer) {
			clearInterval(timer);
			timer = undefined;
		}
		widgetOpen = false;
	});

	pi.registerCommand("usage", {
		description: "显示/关闭智谱 Coding Plan 配额明细",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("此命令仅在交互式 TUI 下可用", "info");
				return;
			}
			widgetOpen = !widgetOpen;
			if (!widgetOpen) {
				ctx.ui.setWidget(WIDGET_KEY, undefined);
				ctx.ui.notify("已关闭配额明细", "info");
				return;
			}
			await refreshQuota(ctx);
			renderWidget(ctx);
		},
	});
}
