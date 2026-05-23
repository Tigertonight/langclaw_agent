import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { SkillRegistryStore } from "../skills/registry-store.js";
import { FileSystemSkillLoader } from "../runtime/skill-loader.js";
import { AgenticSkillView } from "../skills/agentic-skill-view.js";

// 项目根（dist/eval/.. 回到项目根）。SkillRegistryStore / AgenticSkillView 内部用 path.join(projectRoot, x)
// 来锚定路径——传 /tmp 这种绝对路径不会胜出（path.join 会拼接而不是 resolve），所以测试必须把 fixture
// 放到项目根之下，再传相对路径。
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * 端到端验证 skill 创建→使用：
 *   workflow 侧（RegistryStore + FileSystemSkillLoader）：
 *     1. installFromLocalDir 把临时目录里的 skill 安装进 workspace/skills/installed
 *     2. registry.json 记录条目
 *     3. FileSystemSkillLoader.list() 能看到安装的 skill（合并 builtin + installed）
 *     4. setEnabled(false) 后 list() 反映禁用
 *
 *   agentic 侧（AgenticSkillView）：
 *     5. 准备 skills/agentic/<id>/SKILL.md，listForAgent 返回 tool 视图
 *     6. loadForInjection 拿到 SKILL.md body 注入文本
 *
 *   HTTP 侧：
 *     7. POST /api/skills/install 真正写盘 + 返回 installed 条目
 *
 * 全程用绝对临时路径作为 workspaceDir，避免污染真实 workspace/skills/。
 */
async function main(): Promise<void> {
  // 项目根下的 .tmp/skill-e2e-XXXX，便于 SkillRegistryStore/AgenticSkillView 用相对路径锚定
  const tmpRootHost = path.join(PROJECT_ROOT, ".tmp");
  await mkdir(tmpRootHost, { recursive: true });
  const tmpRoot = await mkdtemp(path.join(tmpRootHost, "skill-e2e-"));
  // 相对项目根的子路径，传给 store/view
  const tmpRel = path.relative(PROJECT_ROOT, tmpRoot);
  try {
    await runWorkflowSide(tmpRoot, tmpRel);
    await runAgenticSide(tmpRoot, tmpRel);
    await runHttpSide(tmpRoot);
    console.log("PASS skill install→使用 e2e (workflow registry / agentic view / http install)");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

async function runWorkflowSide(tmpRoot: string, tmpRel: string): Promise<void> {
  const sourceDir = path.join(tmpRoot, "source-skill");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "SKILL.md"), [
    "---",
    "name: smoke-fixture-skill",
    "description: e2e fixture for install smoke",
    "intents: [smoke_test]",
    "triggers: [冒烟, smoke]",
    "planning_style: guided",
    "---",
    "",
    "# Smoke Fixture",
    "",
    "Use this skill only in the install→use e2e smoke."
  ].join("\n"), "utf8");
  await writeFile(path.join(sourceDir, "manifest.json"), JSON.stringify({
    id: "smoke-fixture-skill",
    name: "smoke-fixture-skill",
    version: "0.0.1"
  }), "utf8");

  // workspaceDir 用相对项目根的路径，否则 resolveProjectPath 会 path.join 把绝对路径拼坏
  const workspaceRel = path.join(tmpRel, "ws-skills");
  const workspaceAbs = path.join(PROJECT_ROOT, workspaceRel);
  const registry = new SkillRegistryStore({ workspaceDir: workspaceRel });
  const installed = await registry.installFromLocalDir(sourceDir);
  assert(installed.id === "smoke-fixture-skill", `installed.id wrong: ${installed.id}`);
  assert(installed.local_path.startsWith(workspaceAbs), `installed.local_path should live under tmp ws, got ${installed.local_path}`);
  assert(installed.enabled === true, "freshly installed skill should be enabled");

  const registryJson = JSON.parse(await readFile(path.join(workspaceAbs, "registry.json"), "utf8")) as { installed: Array<{ id: string }> };
  assert(registryJson.installed.length === 1, `registry.json should have 1 entry, got ${registryJson.installed.length}`);

  // FileSystemSkillLoader 把 installed + builtin 合并；用真 builtin dir 没问题，只要我们的 fixture 出现就行
  const loader = new FileSystemSkillLoader({ registryStore: registry });
  const list1 = await loader.list();
  const found = list1.find((s) => s.id === "smoke-fixture-skill");
  assert(!!found, `loader.list() should include smoke-fixture-skill, got ${list1.map((s) => s.id).join(",")}`);
  assert(found!.enabled === true, "loader should reflect enabled=true");
  assert((found!.instructions ?? "").includes("Smoke Fixture"), "loader should carry SKILL.md body");

  await registry.setEnabled("smoke-fixture-skill", false);
  loader.invalidate();
  const list2 = await loader.list();
  const found2 = list2.find((s) => s.id === "smoke-fixture-skill");
  assert(found2 && found2.enabled === false, "after setEnabled(false) loader should reflect disabled");
}

async function runAgenticSide(tmpRoot: string, tmpRel: string): Promise<void> {
  // AgenticSkillView 走自己的目录，不读 RegistryStore
  const agenticRel = path.join(tmpRel, "agentic-skills-root");
  const agenticRoot = path.join(tmpRoot, "agentic-skills-root");
  const skillId = "smoke-agentic-skill";
  const skillDir = path.join(agenticRoot, skillId);
  await mkdir(skillDir, { recursive: true });
  // 注意：parseSimpleYaml 是手写极简实现，不支持 inline {} 对象，所以用 ## Inputs 章节软解析
  await writeFile(path.join(skillDir, "SKILL.md"), [
    "---",
    `name: ${skillId}`,
    "description: agentic-side fixture for e2e smoke",
    "---",
    "",
    "## When to use",
    "",
    "- 用户问冒烟测试相关问题",
    "",
    "## Inputs",
    "",
    "- `question` (string, 必填)：用户原始问题"
  ].join("\n"), "utf8");

  // rootDir 同样要走相对路径（见 resolveProjectPath 的 path.join 行为说明）
  const view = new AgenticSkillView({ rootDir: agenticRel });
  const tools = view.listForAgent({ user: { id: "smoke_user" } });
  const tool = tools.find((t) => t.id === skillId);
  assert(!!tool, `listForAgent should expose ${skillId}, got ${tools.map((t) => t.id).join(",")}`);
  assert(tool!.name === `skill.${skillId}`, `tool.name should be skill.${skillId}, got ${tool!.name}`);
  assert(tool!.kind === "skill", `tool.kind should be "skill"`);

  const injected = await view.loadForInjection({ id: skillId, args: { question: "冒烟问题" }, user: { id: "smoke_user" } });
  assert(injected.ok === true, `loadForInjection should succeed, got ${JSON.stringify(injected)}`);
  const text = String(injected.injection_text ?? "");
  assert(text.includes("Skill 注入"), "injection_text should carry header");
  assert(text.includes("When to use") || text.includes("当用户问"), `injection_text should include SKILL.md body, got ${text.slice(0, 200)}`);
}

async function runHttpSide(tmpRoot: string): Promise<void> {
  // 真起一次 http server，但用环境变量改不了 workspaceDir（构造时硬编码 "workspace/skills"）。
  // 所以 HTTP 这条路径会写真实 workspace/skills/installed/smoke-http-install-skill —
  // 跑完手工删目录 + 从 registry.json 移除条目（installFromLocalDir 没有对偶的 uninstall API，
  // 这也是该 smoke 暴露出的能力缺口之一）。
  const sourceDir = path.join(tmpRoot, "source-http-skill");
  await mkdir(sourceDir, { recursive: true });
  await writeFile(path.join(sourceDir, "SKILL.md"), [
    "---",
    "name: smoke-http-install-skill",
    "description: http install smoke fixture",
    "---",
    "",
    "# Body"
  ].join("\n"), "utf8");

  const port = 3914;
  const server = spawn("node", ["dist/server/http.js"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServerReady(server, port);
  try {
    const r1 = await fetch(`http://localhost:${port}/api/skills/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: sourceDir })
    });
    assert(r1.status === 200, `install should be 200, got ${r1.status}`);
    const body1 = await r1.json() as { ok: boolean; installed: { id: string } };
    assert(body1.ok === true && body1.installed.id === "smoke-http-install-skill", `install body wrong: ${JSON.stringify(body1)}`);

    const r2 = await fetch(`http://localhost:${port}/api/skills`);
    assert(r2.status === 200, `list should be 200, got ${r2.status}`);
    const body2 = await r2.json() as { skills: Array<{ id: string; install_type?: string }> };
    const found = body2.skills.find((s) => s.id === "smoke-http-install-skill");
    assert(!!found, `installed skill should appear in /api/skills, got ${body2.skills.map((s) => s.id).join(",")}`);
    assert(found!.install_type === "installed", `install_type should be "installed", got ${found!.install_type}`);

    // 收尾：先禁用，停 server 后再手工删目录 + 改 registry.json（避免和正在跑的 server 抢文件）
    const r3 = await fetch(`http://localhost:${port}/api/skills/smoke-http-install-skill/enabled`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false })
    });
    assert(r3.status === 200, `disable should be 200, got ${r3.status}`);
  } finally {
    server.kill("SIGTERM");
    await delay(200);
    if (!server.killed) server.kill("SIGKILL");
    await cleanupHttpInstall("smoke-http-install-skill");
  }
}

async function cleanupHttpInstall(skillId: string): Promise<void> {
  const installedDir = path.join(PROJECT_ROOT, "workspace", "skills", "installed", skillId);
  await rm(installedDir, { recursive: true, force: true });
  const registryFile = path.join(PROJECT_ROOT, "workspace", "skills", "registry.json");
  try {
    const raw = await readFile(registryFile, "utf8");
    const cfg = JSON.parse(raw) as { installed?: Array<{ id: string }>; overrides?: Record<string, unknown> };
    const next = {
      ...cfg,
      installed: (cfg.installed ?? []).filter((entry) => entry.id !== skillId),
      overrides: Object.fromEntries(Object.entries(cfg.overrides ?? {}).filter(([key]) => key !== skillId))
    };
    await writeFile(registryFile, JSON.stringify(next, null, 2), "utf8");
  } catch {
    // registry.json 不存在或损坏：既然目录已删，就当清干净了
  }
}

async function waitForServerReady(server: ChildProcess, port: number): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await delay(200);
  }
  server.kill("SIGKILL");
  throw new Error(`server did not become ready on port ${port}`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
