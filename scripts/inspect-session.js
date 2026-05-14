#!/usr/bin/env node
/**
 * 把 agentic 三流 traces 渲染成时间轴，方便排查"卡在哪一步 / 为什么慢 / 哪步重试了"。
 *
 * 用法：
 *   node scripts/inspect-session.js --last              最近一条 agentic turn
 *   node scripts/inspect-session.js <session_id>        指定 session 的最新 turn
 *   node scripts/inspect-session.js --line N            conversations.jsonl 第 N 行
 *   node scripts/inspect-session.js --grep <文字>       消息内容里搜，命中第一条
 *
 * 数据源：logs/conversations.jsonl（orchestrator 落盘，含 debug.agentic.streams）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.resolve(__dirname, "..", "logs", "conversations.jsonl");

function usage() {
  console.error([
    "用法：",
    "  node scripts/inspect-session.js --last",
    "  node scripts/inspect-session.js <session_id>",
    "  node scripts/inspect-session.js --line N",
    "  node scripts/inspect-session.js --grep <文字>"
  ].join("\n"));
  process.exit(1);
}

function readAllTurns() {
  if (!fs.existsSync(LOG_PATH)) {
    console.error(`[inspect-session] 日志不存在：${LOG_PATH}`);
    process.exit(1);
  }
  const text = fs.readFileSync(LOG_PATH, "utf8");
  const lines = text.trim().split("\n");
  return lines.map((line, i) => {
    try {
      return { i, obj: JSON.parse(line) };
    } catch {
      return { i, obj: null };
    }
  });
}

function pickTurn(args) {
  const turns = readAllTurns();
  const isAgentic = (t) => t.obj?.debug?.agentic?.streams;

  if (args[0] === "--line") {
    const n = parseInt(args[1], 10);
    if (!Number.isFinite(n)) usage();
    const t = turns[n - 1];
    if (!t?.obj) {
      console.error(`第 ${n} 行不存在或解析失败`);
      process.exit(1);
    }
    return t;
  }
  if (args[0] === "--last") {
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      if (isAgentic(turns[i])) return turns[i];
    }
    console.error("没有 agentic turn 的日志（debug.agentic.streams 缺失）");
    process.exit(1);
  }
  if (args[0] === "--grep") {
    const kw = args.slice(1).join(" ");
    if (!kw) usage();
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const msg = turns[i].obj?.message ?? "";
      if (msg.includes(kw) && isAgentic(turns[i])) return turns[i];
    }
    console.error(`未匹配到包含「${kw}」的 agentic turn`);
    process.exit(1);
  }
  // 视为 session_id
  const sid = args[0];
  if (!sid) usage();
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].obj?.session_id === sid && isAgentic(turns[i])) return turns[i];
  }
  // session_id 没匹配到 agentic 的，再退一步看任意 turn 提示用户
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].obj?.session_id === sid) {
      console.error(`session ${sid} 找到了，但这一轮不是 agentic（没有 streams 数据）。`);
      process.exit(1);
    }
  }
  console.error(`未找到 session_id=${sid} 的日志`);
  process.exit(1);
}

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m"
};
const NO_COLOR = !process.stdout.isTTY || process.env.NO_COLOR === "1";
const c = (color, s) => (NO_COLOR ? s : `${COLORS[color]}${s}${COLORS.reset}`);

function fmtTs(ms) {
  if (typeof ms !== "number") return "    ?  ";
  if (ms < 1000) return `+${String(ms).padStart(4, " ")}ms`;
  return `+${(ms / 1000).toFixed(2).padStart(5, " ")}s`;
}

function renderLifecycle(ev) {
  const { event, step, error, attempts, action, reason } = ev;
  const stepTag = step != null ? c("dim", `step=${step}`) : "";
  switch (event) {
    case "start":
      return `${c("green", "🟢 start")}     ${c("dim", `tools=${ev.tools_count ?? "?"}, msg="${ev.message_preview ?? ""}"`)}`;
    case "decided":
      const warn = (attempts ?? 1) > 1 ? c("yellow", ` ⚠ ${attempts} attempts`) : "";
      return `${c("blue", "💭 decided")}    ${stepTag} ${c("bold", action ?? "?")}${warn}`;
    case "answered":
      return `${c("green", "✅ answered")}   ${stepTag}`;
    case "step_failed":
      return `${c("red", "❌ step_failed")} ${stepTag} ${c("red", error ?? "?")} ${c("dim", `(attempts=${attempts})`)}`;
    case "total_timeout":
      return `${c("red", "⏰ total_timeout")} ${stepTag}`;
    case "fallback":
      return `${c("red", "🛟 fallback")}   ${c("red", ev.reason ?? "?")}`;
    case "unknown_action":
      return `${c("red", "❓ unknown_action")} ${stepTag} action=${action}`;
    default:
      return `${c("dim", "⋯ " + event)}      ${JSON.stringify(ev)}`;
  }
}

function renderTool(ev) {
  const { tool, args, observation_summary, step } = ev;
  const stepTag = step != null ? c("dim", `step=${step}`) : "";
  const argsLine = args ? c("dim", "  args: " + JSON.stringify(args).slice(0, 200)) : "";
  let obsLine = "";
  if (observation_summary) {
    const o = observation_summary;
    if (o.intent_code) {
      obsLine = c("dim", `  → intent=${o.intent_code} ok=${o.ok} rows=${o.row_count}`);
    } else if (o.kind === "skill_injection") {
      obsLine = c("dim", `  → skill=${o.skill} injected=${o.injected_chars}chars`);
    } else if (o.tool === "safe_compute") {
      obsLine = c("dim", `  → safe_compute ok=${o.ok} value=${o.value_preview}`);
    } else {
      obsLine = c("dim", `  → ok=${o.ok} ${o.error ? "error=" + o.error : ""}`);
    }
  }
  return [
    `${c("cyan", "🔧 tool_call")}  ${stepTag} ${c("bold", tool)}`,
    argsLine,
    obsLine
  ].filter(Boolean).join("\n");
}

function renderAssistant(ev) {
  const { type, step, reason, action } = ev;
  const stepTag = step != null ? c("dim", `step=${step}`) : "";
  if (type === "decision") {
    return `${c("dim", "  decision     ")}${stepTag} action=${action}${reason ? c("dim", " — " + reason) : ""}`;
  }
  if (type === "answer") {
    return `${c("green", "💬 answer")}     ${stepTag} ${c("dim", (ev.answer_chars ?? 0) + " chars")}${reason ? c("dim", " — " + reason) : ""}`;
  }
  if (type === "propose_tool") {
    const p = ev.proposal ?? {};
    return [
      `${c("yellow", "💡 propose_tool")} ${stepTag} ${c("bold", p.name ?? "(unnamed)")}`,
      p.what_it_does ? c("dim", `  what: ${p.what_it_does}`) : "",
      p.why_needed ? c("dim", `  why : ${p.why_needed}`) : ""
    ].filter(Boolean).join("\n");
  }
  return `${c("dim", "  " + type)} ${JSON.stringify(ev).slice(0, 200)}`;
}

function render(turn) {
  const o = turn.obj;
  const a = o.debug.agentic;
  const streams = a.streams ?? { lifecycle: [], assistant: [], tool: [] };

  // 合并三流为时间轴：每条事件标注来源；按 ts 排
  const events = [
    ...streams.lifecycle.map((e) => ({ kind: "L", ts: e.ts, render: () => renderLifecycle(e) })),
    ...streams.tool.map((e) => ({ kind: "T", ts: e.ts, render: () => renderTool(e) })),
    ...streams.assistant.filter((e) => e.type !== "decision").map((e) => ({ kind: "A", ts: e.ts, render: () => renderAssistant(e) }))
  ].sort((x, y) => (x.ts ?? 0) - (y.ts ?? 0));

  console.log("");
  console.log(c("bold", `Session   `) + o.session_id + c("dim", `   (line ${turn.i + 1})`));
  console.log(c("bold", `User      `) + (o.user_id ?? "?"));
  console.log(c("bold", `Message   `) + (o.message ?? "").slice(0, 100));
  console.log(c("bold", `Intent    `) + (a.intent_code ?? "?") + c("dim", `   iterations=${a.iterations}   latency=${a.latency_ms}ms`));
  if (a.fallback) console.log(c("red", `Fallback: ${a.reason}`));
  console.log("");
  console.log(c("dim", "── timeline ──────────────────────────────────────────────"));
  for (const ev of events) {
    const ts = fmtTs(ev.ts);
    const line = ev.render();
    // 把首行和后续行都加上时间戳缩进
    const [first, ...rest] = line.split("\n");
    console.log(`${c("dim", ts)}  ${first}`);
    for (const r of rest) console.log(`${" ".repeat(9)} ${r}`);
  }
  console.log("");
  console.log(c("dim", "── stream sizes ──"));
  console.log(c("dim", `lifecycle=${streams.lifecycle.length}  assistant=${streams.assistant.length}  tool=${streams.tool.length}`));
  if (a.fallback || !o.answer) {
    console.log("");
    console.log(c("red", "(no final answer)"));
  } else {
    console.log("");
    console.log(c("dim", "── answer ──"));
    console.log((o.answer ?? "").slice(0, 600) + ((o.answer ?? "").length > 600 ? c("dim", "  …(truncated)") : ""));
  }
}

const args = process.argv.slice(2);
if (args.length === 0) usage();
const turn = pickTurn(args);
render(turn);
