#!/usr/bin/env node
/**
 * postinstall：npm install 之后自动跑。
 * 目标：fork 之后第一次安装就把"目录 + .env"准备好，不用手动做。
 *
 * - 创建运行时目录（logs / users / workspace / .tmp / .data）
 * - 如果项目根没有 .env，自动从 .env.example 复制一份
 * - 不写网络、不调外部命令、不改 .env 内容（只复制）
 * - 任何失败都不阻塞 install（postinstall 不能让用户装不上）
 */

import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// CI 环境下静默跳过（npm ci 在 CI 上 postinstall 噪音多）
if (process.env.CI === "true" || process.env.SKIP_POSTINSTALL === "1") {
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const dirs = [
  "logs",
  "logs/sessions",
  "users",
  "workspace",
  ".tmp",
  ".data"
];

let createdDirs = 0;
for (const rel of dirs) {
  const abs = path.join(root, rel);
  try {
    if (!existsSync(abs)) {
      mkdirSync(abs, { recursive: true });
      createdDirs++;
    }
  } catch {
    // 忽略：postinstall 不该因为目录权限失败就让 install 报错
  }
}

let copiedEnv = false;
try {
  const dotenv = path.join(root, ".env");
  const example = path.join(root, ".env.example");
  if (!existsSync(dotenv) && existsSync(example)) {
    copyFileSync(example, dotenv);
    copiedEnv = true;
  }
} catch {
  // 同上
}

if (createdDirs > 0 || copiedEnv) {
  console.log("");
  console.log("[enterprise-agent] 准备就绪：");
  if (createdDirs > 0) console.log(`  · 创建运行时目录 ${createdDirs} 个`);
  if (copiedEnv) console.log("  · 复制 .env.example → .env（请打开填入 LLM_API_KEY）");
  console.log("");
  console.log("下一步：");
  console.log("  1) 编辑 .env 填 LLM_API_KEY（最小可跑）");
  console.log("  2) npm start");
  console.log("");
}
