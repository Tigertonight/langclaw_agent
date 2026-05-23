import { mkdir, rm, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { buildSandboxProfile, escapeSbpl } from "../sandbox/sandbox-profile.js";
import { checkCommandBlacklist } from "../sandbox/command-blacklist.js";
import { runTerminal } from "../sandbox/terminal-runner.js";
import { createTerminalTools } from "../tools/terminal-tools.js";
import type { UserContext } from "../types/agent-contracts.js";

/**
 * §5 terminal sandbox smoke。
 *   §1 profile 生成 + escapeSbpl
 *   §2 黑名单：curl / wget / sudo / rm -rf / / pipe-to-shell
 *   §3 runTerminal 正常路径：echo / pwd / 写工作区文件
 *   §4 沙箱兜底：网络被禁；写工作区外被拒
 *   §5 timeout：sleep 10 但 timeout 500ms
 *   §6 cwd 越界拒绝
 *   §7 工具集成：terminal.exec via ToolDefinition
 *   §8 非 darwin 平台优雅降级（mock platform）
 *
 * 仅 macOS 真跑沙箱；其他平台只跑 §1/§2/§7-platform 检查。
 */

const TEST_USER_ID = "terminal_smoke_user";

async function main(): Promise<void> {
  const ws = resolveUserWorkspace(TEST_USER_ID);
  await rm(ws.root, { recursive: true, force: true });
  await mkdir(ws.root, { recursive: true });
  await mkdir(ws.logs_dir, { recursive: true });
  try {
    await section1Profile();
    await section2Blacklist();
    if (process.platform !== "darwin") {
      console.log(`[skip] non-darwin platform (${process.platform})；只跑 profile + 黑名单 + 平台守卫`);
      await section8PlatformGuard();
      console.log("terminal:smoke OK (partial)");
      return;
    }
    await section3HappyPath();
    await section4SandboxIsolation();
    await section5Timeout();
    await section6CwdBoundary();
    await section7ToolIntegration();
    console.log("terminal:smoke OK");
  } finally {
    await rm(ws.root, { recursive: true, force: true });
  }
}

async function section1Profile(): Promise<void> {
  const profile = buildSandboxProfile({ workspaceRoot: "/Users/x/work" });
  expect(profile.includes("(version 1)"), "profile should declare version");
  expect(profile.includes("(allow default)"), "should start with allow default");
  expect(profile.includes("(deny network*)"), "should deny network by default");
  expect(profile.includes("/Users/x/work"), "should embed workspace root");

  // extraWritable
  const profile2 = buildSandboxProfile({ workspaceRoot: "/a", extraWritableSubpaths: ["/b"] });
  expect(profile2.includes("(any-of"), "multiple writables should use any-of");
  expect(profile2.includes("/a") && profile2.includes("/b"), "both writables in profile");

  // 网络可关
  const profile3 = buildSandboxProfile({ workspaceRoot: "/a", denyNetwork: false });
  expect(!profile3.includes("(deny network*)"), "denyNetwork=false should not emit deny network");

  // escapeSbpl
  expect(escapeSbpl(`a"b\\c`) === `a\\"b\\\\c`, `escape failed: ${escapeSbpl(`a"b\\c`)}`);
  let threw = false;
  try { escapeSbpl("a\nb"); } catch { threw = true; }
  expect(threw, "control char should throw");

  console.log(`§1 profile: 生成 + escape + 控制字符拦截 OK`);
}

async function section2Blacklist(): Promise<void> {
  const cases: Array<{ cmd: string; ok: boolean; label: string }> = [
    { cmd: "ls -la", ok: true, label: "ls 允许" },
    { cmd: "echo hello | head -3", ok: true, label: "echo|head 允许" },
    { cmd: "grep ERROR app.log", ok: true, label: "grep 允许" },
    { cmd: "python3 -c 'print(1)'", ok: true, label: "python -c 允许" },
    { cmd: "curl https://example.com", ok: false, label: "curl 拒绝" },
    { cmd: "/usr/bin/curl https://x", ok: false, label: "curl 绝对路径拒绝" },
    { cmd: "wget -q file", ok: false, label: "wget 拒绝" },
    { cmd: "sudo ls", ok: false, label: "sudo 拒绝" },
    { cmd: "ssh user@host", ok: false, label: "ssh 拒绝" },
    { cmd: "rm -rf /", ok: false, label: "rm -rf / 拒绝" },
    { cmd: "rm -rf ~", ok: false, label: "rm -rf ~ 拒绝" },
    { cmd: "rm -rf $HOME/x", ok: false, label: "rm -rf $HOME 拒绝" },
    { cmd: "echo hi | bash", ok: false, label: "pipe-to-bash 拒绝" },
    { cmd: "echo hi | sh", ok: false, label: "pipe-to-sh 拒绝" },
    { cmd: "kill -9 1", ok: false, label: "kill 1 拒绝" },
    { cmd: "chmod 777 /etc", ok: false, label: "chmod 777 / 拒绝" },
    { cmd: "dd if=/dev/zero of=/dev/sda", ok: false, label: "dd of=/dev/ 拒绝" },
    // 不应误伤：
    { cmd: "echo my-curl-script.sh", ok: true, label: "字符串里包含 curl 字样不应误伤" }
  ];
  for (const c of cases) {
    const r = checkCommandBlacklist(c.cmd);
    expect(r.ok === c.ok, `[${c.label}] cmd='${c.cmd}' expected ok=${c.ok}, got ${r.ok} (${r.reason ?? ""})`);
  }
  console.log(`§2 blacklist: ${cases.length} 条用例（含拒绝/允许/避免误伤）全部正确`);
}

async function section3HappyPath(): Promise<void> {
  const ws = resolveUserWorkspace(TEST_USER_ID);
  // 简单 echo
  const r1 = await runTerminal({ command: "echo hello-sandbox", workspace: ws });
  expect(r1.ok && r1.status === "ok", `echo failed: ${JSON.stringify(r1)}`);
  expect(r1.stdout.includes("hello-sandbox"), `echo stdout: ${r1.stdout}`);

  // pwd 应该是 workspace.root
  const r2 = await runTerminal({ command: "pwd", workspace: ws });
  expect(r2.ok, `pwd failed: ${JSON.stringify(r2)}`);
  expect(r2.stdout.trim() === path.resolve(ws.root), `pwd should be workspace.root, got ${r2.stdout.trim()} vs ${path.resolve(ws.root)}`);

  // 写一个工作区内的文件，再读出来
  const r3 = await runTerminal({
    command: `echo content-from-sandbox > out.txt && cat out.txt`,
    workspace: ws
  });
  expect(r3.ok, `write+read failed: ${JSON.stringify(r3)}`);
  expect(r3.stdout.includes("content-from-sandbox"), `cat output: ${r3.stdout}`);
  // 验证文件确实落到了 workspace
  const stats = await stat(path.join(ws.root, "out.txt"));
  expect(stats.isFile(), "out.txt should exist in workspace");

  console.log(`§3 happy path: echo / pwd / write+read 全 OK`);
}

async function section4SandboxIsolation(): Promise<void> {
  const ws = resolveUserWorkspace(TEST_USER_ID);

  // 网络应该被禁：curl 是黑名单（被静态拒），换成 python 测 socket
  // 但 python -c 这种参数里有 import socket 还是能跑 —— 只是 connect 会失败
  const r1 = await runTerminal({
    command: `python3 -c "import socket; s=socket.socket(); s.settimeout(2);
try:
    s.connect(('1.1.1.1',80))
    print('CONNECTED')
except Exception as e:
    print('blocked:', type(e).__name__)"`,
    workspace: ws,
    timeout_ms: 5000
  });
  // 如果机器上没有 python3，就跳过这条
  if (r1.status === "exec_unavailable" || r1.stderr.includes("command not found")) {
    console.log(`§4 [skip network test] python3 not available`);
  } else {
    expect(!r1.stdout.includes("CONNECTED"), `network should be blocked but got: ${r1.stdout}`);
  }

  // 写工作区外的文件应失败
  const targetOutside = path.join(path.dirname(ws.root), "escape-attempt.txt");
  const r2 = await runTerminal({
    command: `echo escaped > "${targetOutside}"`,
    workspace: ws
  });
  // 期望非 0 退出 / Operation not permitted
  expect(!r2.ok, `outside-write should fail, got: ${JSON.stringify({ status: r2.status, exit: r2.exit_code, err: r2.stderr.slice(0, 200) })}`);
  // 确认文件没真创建
  let leaked = false;
  try { await stat(targetOutside); leaked = true; } catch { /* ok */ }
  expect(!leaked, "escape file should not exist");

  console.log(`§4 sandbox: 网络被拦 + 工作区外写被拦`);
}

async function section5Timeout(): Promise<void> {
  const ws = resolveUserWorkspace(TEST_USER_ID);
  const r = await runTerminal({
    command: "sleep 10",
    workspace: ws,
    timeout_ms: 500
  });
  expect(r.status === "timeout", `should timeout, got ${r.status}`);
  expect(r.duration_ms < 3000, `should kill quickly, got ${r.duration_ms}ms`);
  console.log(`§5 timeout: 500ms 触发 SIGKILL，实际耗时 ${r.duration_ms}ms`);
}

async function section6CwdBoundary(): Promise<void> {
  const ws = resolveUserWorkspace(TEST_USER_ID);
  // cwd 指向工作区外
  const r = await runTerminal({
    command: "echo x",
    workspace: ws,
    cwd: "../../../../../tmp"
  });
  expect(!r.ok && r.status === "blacklisted" && r.reason === "cwd_outside_workspace",
    `cwd-escape should be rejected, got ${JSON.stringify({ status: r.status, reason: r.reason })}`);

  // workspace 内子目录 OK
  await mkdir(path.join(ws.root, "sub"), { recursive: true });
  const r2 = await runTerminal({
    command: "pwd",
    workspace: ws,
    cwd: "sub"
  });
  expect(r2.ok && r2.stdout.trim().endsWith("/sub"), `subdir cwd: ${r2.stdout}`);

  console.log(`§6 cwd: 越界拒绝 + 子目录允许`);
}

async function section7ToolIntegration(): Promise<void> {
  const tools = createTerminalTools();
  const exec = tools.find((t) => t.name === "terminal.exec");
  expect(!!exec, "terminal.exec should exist");

  const ws = resolveUserWorkspace(TEST_USER_ID);
  const ctx = {
    user: { id: TEST_USER_ID, name: TEST_USER_ID, role: "user", department: "" } as UserContext,
    workspace: ws
  };

  // 跑一条
  const r1 = (await exec!.execute({ command: "echo via-tool" }, ctx)) as {
    ok: boolean;
    data?: { stdout: string; exit_code: number };
  };
  expect(r1.ok === true, `tool exec ok, got ${JSON.stringify(r1)}`);
  expect(r1.data!.stdout.includes("via-tool"), `tool stdout: ${r1.data!.stdout}`);

  // 黑名单
  const r2 = (await exec!.execute({ command: "curl https://example.com" }, ctx)) as {
    ok: boolean; error?: string;
  };
  expect(r2.ok === false && r2.error === "blacklisted", `tool blacklist: ${JSON.stringify(r2)}`);

  // 审计文件落地
  const auditFile = path.join(ws.logs_dir, "terminal", "exec.jsonl");
  const auditRaw = await readFile(auditFile, "utf8");
  const lines = auditRaw.trim().split(/\n/).filter(Boolean);
  expect(lines.length >= 1, `audit lines: ${lines.length}`);
  // 黑名单的也应该审计 —— 当前实现里黑名单 early-return 不写审计；这是可接受的（被拒不算 exec），
  // 留给后续：如果产品要"所有调用都审计"，把审计移到 runTerminal 入口
  // 至少 happy path 那条要在
  const parsed = lines.map((l) => JSON.parse(l));
  expect(parsed.some((p) => p.status === "ok"), "audit should contain ok entry");

  console.log(`§7 tool integration: terminal.exec 跑通 + 审计落地`);
}

async function section8PlatformGuard(): Promise<void> {
  // 在非 darwin 上调用应得到 platform_unsupported
  const ws = resolveUserWorkspace(TEST_USER_ID);
  const r = await runTerminal({ command: "echo x", workspace: ws });
  expect(r.status === "platform_unsupported", `non-darwin should refuse, got ${r.status}`);
  console.log(`§8 platform guard: non-darwin 优雅拒绝`);
}

function expect(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
