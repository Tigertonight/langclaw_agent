#!/usr/bin/env node
/**
 * npm start 入口。
 *
 * 行为：
 *   1. 跑 preflight（自检 Node / .env / 端口 / 目录 / S3）
 *   2. 如果 dist/ 不存在 → 自动 npm run build:ts
 *   3. 用 node --env-file=.env dist/src/server/http.js 启动（生产姿势）
 *
 * 开发时如果想跳过编译走 tsx 热路径，用 npm run server。
 */

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

await runStep("npm", ["run", "preflight", "--silent"]);

const distEntry = path.join(root, "dist", "src", "server", "http.js");
if (!existsSync(distEntry)) {
  console.log("dist/ 不存在，先编译 TypeScript（首次启动较慢，约 20s）…\n");
  await runStep("npm", ["run", "build:ts", "--silent"]);
}

console.log("启动 enterprise-agent …\n");
const child = spawn(
  process.execPath,
  ["--env-file=.env", distEntry],
  { stdio: "inherit", cwd: root, env: { ...process.env, A2UI_AUTH_DISABLED: process.env.A2UI_AUTH_DISABLED ?? "1" } }
);

const forwardSignal = (sig) => () => { try { child.kill(sig); } catch {} };
process.on("SIGTERM", forwardSignal("SIGTERM"));
process.on("SIGINT", forwardSignal("SIGINT"));
child.on("exit", (code) => process.exit(code ?? 0));

function runStep(cmd, args) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: "inherit", cwd: root, shell: process.platform === "win32" });
    c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
    c.on("error", reject);
  });
}
