#!/usr/bin/env node
/**
 * preflight：npm start / npm run server 之前跑的自检。
 *
 * - Node 版本
 * - .env 存在 + 关键变量
 * - 端口是否被占用
 * - 关键目录存在
 * - （可选）附件存储 S3 endpoint 可达
 *
 * 失败级别分两档：
 *   ❌ FATAL — 退出码 1，启动会被 npm-run-all 中断
 *   ⚠️  WARN  — 仅打印，不阻塞启动（让用户先把界面跑起来）
 */

import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const fatals = [];
const warns = [];
const oks = [];

// ---------- Node 版本 ----------
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (Number.isFinite(nodeMajor) && nodeMajor >= 18) {
  oks.push(`Node v${process.versions.node}`);
} else {
  fatals.push(`Node 版本过低（当前 v${process.versions.node}），需要 >= 18。建议安装 Node 20 LTS。`);
}

// ---------- .env ----------
const dotenvPath = path.join(root, ".env");
let env = { ...process.env };
if (!existsSync(dotenvPath)) {
  warns.push(".env 不存在。已从 .env.example 复制（如果有），请填 LLM_API_KEY。");
  // postinstall 应该已经复制了，这里兜底再复制一次
  const example = path.join(root, ".env.example");
  if (existsSync(example)) {
    try {
      const { copyFileSync } = await import("node:fs");
      copyFileSync(example, dotenvPath);
      warns.push("已自动复制 .env.example → .env");
    } catch {
      // ignore
    }
  }
}
if (existsSync(dotenvPath)) {
  oks.push(".env 存在");
  // 把 .env 解析进 env 对象（不污染 process.env，只用于检查）
  try {
    const text = readFileSync(dotenvPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (env[key] === undefined || env[key] === "") env[key] = val;
    }
  } catch {
    // ignore
  }
}

// ---------- LLM 必填 ----------
if (env.LLM_API_KEY && env.LLM_API_KEY.trim()) {
  oks.push(`LLM_API_KEY 已配置（${env.LLM_BASE_URL || "默认 base url"} · ${env.LLM_MODEL || "默认 model"}）`);
} else {
  warns.push(
    "LLM_API_KEY 未填。服务可启动但 LLM 调用会失败。" +
    "请在 .env 里填一个 OpenAI 兼容 key（MiniMax / DeepSeek / OpenAI）。"
  );
}

// ---------- 关键目录 ----------
const requiredDirs = ["logs", "users", "workspace", "data"];
for (const rel of requiredDirs) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) {
    try {
      mkdirSync(abs, { recursive: true });
      oks.push(`创建目录 ${rel}/`);
    } catch (err) {
      fatals.push(`目录 ${rel}/ 不存在且无法创建：${err.message}`);
    }
  }
}

// ---------- 端口 ----------
const port = Number(env.PORT || 3000);
const host = env.HOST || "127.0.0.1";
const portInUse = await checkPortInUse(host, port, 500);
if (portInUse) {
  fatals.push(`端口 ${host}:${port} 已被占用。请先停掉占用进程，或在 .env 设置不同的 PORT。`);
} else {
  oks.push(`端口 ${port} 可用`);
}

// ---------- 附件 / S3（可选）----------
const explicitlyDisabled = env.ATTACHMENTS_ENABLED === "false";
const s3EndpointSet = !!(env.S3_ENDPOINT && env.S3_BUCKET);
if (explicitlyDisabled) {
  oks.push("附件功能已显式关闭（ATTACHMENTS_ENABLED=false）");
} else if (!s3EndpointSet) {
  warns.push("附件功能将自动降级（S3_ENDPOINT/S3_BUCKET 未配置）。想启用：docker compose -f docker-compose.attachments.yml up -d");
} else if (env.S3_ENDPOINT.startsWith("http://localhost") || env.S3_ENDPOINT.startsWith("http://127.0.0.1")) {
  const url = new URL(env.S3_ENDPOINT);
  const portOpen = await checkPortInUse(url.hostname, Number(url.port || 9000), 300);
  if (!portOpen) {
    warns.push(`本地 S3 endpoint ${env.S3_ENDPOINT} 未启动。附件上传会失败。开发期请跑：docker compose -f docker-compose.attachments.yml up -d`);
  } else {
    oks.push(`本地 S3 endpoint ${env.S3_ENDPOINT} 可达`);
  }
} else {
  oks.push(`S3 endpoint 已配置：${env.S3_ENDPOINT}`);
}

// ---------- 输出 ----------
console.log("");
console.log("preflight ─ 启动前自检");
console.log("─".repeat(60));
for (const o of oks) console.log(`  [32m✓[0m ${o}`);
for (const w of warns) console.log(`  [33m⚠[0m ${w}`);
for (const f of fatals) console.log(`  [31m✗[0m ${f}`);
console.log("─".repeat(60));

if (fatals.length > 0) {
  console.log("\n启动被中断。请先解决上面 ✗ 标记的问题。\n");
  process.exit(1);
}

if (warns.length > 0) {
  console.log("\n以上 ⚠ 不阻塞启动，但建议尽快解决。\n");
} else {
  console.log("\n全部就绪，准备启动 …\n");
}

// ---------- 工具函数 ----------

function checkPortInUse(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port, timeout: timeoutMs });
    let done = false;
    const finish = (inUse) => { if (!done) { done = true; sock.destroy(); resolve(inUse); } };
    sock.on("connect", () => finish(true));
    sock.on("timeout", () => finish(false));
    sock.on("error", () => finish(false));
  });
}

function checkPortReachable(host, port, timeoutMs) {
  // 同 checkPortInUse 但语义反过来：true = 服务在听，可达
  return checkPortInUse(host, port, timeoutMs);
}
