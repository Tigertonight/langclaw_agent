/**
 * AgenticSkillView：agentic 路径使用的"注入式 skill"加载器。
 *
 * 它和 SkillRegistryStore（workflow skill 体系）是完全独立的——后者管"安装/启用/版本"，
 * 这里只管"把 skills/agentic/<id>/ 目录下的提示词包，按 Claude Code Skill 的形态读出来"。
 *
 * 协议：与 openclaw / Claude Code Skill 对齐，frontmatter 仅 name + description（超集兼容）：
 *   - name: hyphen-case 标识符，必须等于文件夹名（也是工具名后缀：skill.<name>）
 *   - description: 一句话说清"做什么 + 何时调用"
 *   旧字段（id / when_to_use / io）仍兼容读取，但建议挪到 body 章节：
 *     ## When to use     → bullet list 解析为 when_to_use[]
 *     ## Inputs          → bullet list 解析为 io.args（"`name` (type, 必填)：description" 形式）
 *
 * 一个 skill 包的形态：
 *   skills/agentic/<name>/
 *     SKILL.md           # frontmatter（name/description）+ 主体（含 ## When to use / ## Inputs）
 *     template.md        # 提示词模板，可含 {{var}} 占位
 *     examples/*.md      # （可选）few-shot 例子
 *     scripts/preprocess.js  # （可选）默认导出的纯函数，把 args 预处理成模板变量
 *
 * 调用顺序：
 *   1. listForAgent({user})  →  返回精简元数据，给 AgenticHandler.getAvailableTools 拼 tool 列表
 *   2. loadForInjection({id, args, user})  →  跑 preprocess.js + 渲染 template + 拼 examples
 *      → 返回一段可作为 user/system 消息塞回主 agentic 对话的文本块
 *
 * 这里不缓存元数据：启动时一次性扫描，运行期不再热加载。listForAgent 同步（已扫好）。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveProjectPath } from "../data/load-json.js";
import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

interface AgenticSkillArgSchema {
  type?: string;
  required?: boolean;
  description?: string;
}

interface AgenticSkillIO {
  args?: Record<string, AgenticSkillArgSchema>;
}

interface AgenticSkill {
  id: string;
  dir: string;
  name: string;
  description: string;
  when_to_use: string[];
  io: AgenticSkillIO;
  skill_md_body: string;
}

interface AgenticSkillToolView extends JsonObject {
  id: string;
  name: string;
  kind: "skill";
  description: string;
  params_schema: JsonObject;
  _dir: string;
}

interface FrontmatterResult {
  meta: JsonObject;
  body: string;
}

interface ExampleDoc {
  name: string;
  body: string;
}

type TemplateVars = Record<string, JsonValue | undefined>;
type SimpleYamlContainer = JsonObject | JsonValue[];

export class AgenticSkillView {
  private readonly rootDir: string;
  private readonly skills: AgenticSkill[];

  constructor({ rootDir = "skills/agentic" }: { rootDir?: string } = {}) {
    this.rootDir = resolveProjectPath(rootDir);
    this.skills = this.scan();
  }

  scan(): AgenticSkill[] {
    if (!existsSync(this.rootDir)) return [];
    const out: AgenticSkill[] = [];
    for (const folder of readdirSync(this.rootDir)) {
      const dir = path.join(this.rootDir, folder);
      if (!statSync(dir).isDirectory()) continue;
      const skillFile = path.join(dir, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      const raw = readFileSync(skillFile, "utf8");
      const { meta, body } = parseFrontmatter(raw);
      // id 解析优先级：frontmatter.name（openclaw 协议）→ 旧的 frontmatter.id → 文件夹名
      const id = String(meta.name ?? meta.id ?? folder);
      // when_to_use / io 优先 frontmatter（旧格式向后兼容），缺则从 body 章节软解析（新协议）
      const when_to_use = Array.isArray(meta.when_to_use) && meta.when_to_use.length
        ? meta.when_to_use.map(String)
        : extractBulletSection(body, ["When to use", "When to Use", "when_to_use"]);
      const io = (isJsonObject(meta.io) && Object.keys(meta.io).length)
        ? meta.io as AgenticSkillIO
        : { args: extractInputsSection(body) };
      out.push({
        id,
        dir,
        name: id,
        description: String(meta.description ?? ""),
        when_to_use,
        io,
        skill_md_body: body
      });
    }
    return out;
  }

  // 给 AgenticHandler.getAvailableTools 用：返回 tool 列表的精简形态
  listForAgent({ user: _user }: { user?: unknown } = {}): AgenticSkillToolView[] {
    return this.skills.map((s) => ({
      id: s.id,
      name: `skill.${s.id}`,
      kind: "skill",
      description: shortDescription(s),
      params_schema: paramsSchemaFromIO(s.io),
      // 透传 dir 让 dispatch 找回原 skill；不暴露给 LLM
      _dir: s.dir
    }));
  }

  // skill.* 被调用时跑这里：把 SKILL.md + 渲染后的 template + examples 组装成可注入的文本块
  async loadForInjection({ id, args = {}, user: _user }: { id?: string; args?: TemplateVars; user?: unknown } = {}): Promise<JsonObject> {
    const skill = this.skills.find((s) => s.id === id);
    if (!skill) {
      return { ok: false, error: "unknown_skill", message: `skill ${id} 不存在` };
    }
    const vars = await runPreprocess(skill.dir, args);
    const template = readIfExists(path.join(skill.dir, "template.md"));
    const renderedTemplate = template ? renderTemplate(template, { ...args, ...vars }) : "";
    const examples = readExamples(skill.dir);

    // 组装注入块：让主 LLM 把它当成新到的"专家说明"接着用
    const sections: string[] = [];
    sections.push(`# Skill 注入：${skill.name}（id=${skill.id}）`);
    sections.push(`说明：${skill.description}`);
    if (skill.skill_md_body?.trim()) sections.push(skill.skill_md_body.trim());
    if (renderedTemplate?.trim()) {
      sections.push("---");
      sections.push("# 写作素材（已渲染）");
      sections.push(renderedTemplate.trim());
    }
    if (examples.length) {
      sections.push("---");
      sections.push("# 参考样例");
      sections.push(examples.map((e) => `### ${e.name}\n${e.body}`).join("\n\n"));
    }
    return {
      ok: true,
      skill: skill.id,
      injection_text: sections.join("\n\n"),
      preprocess_vars: vars
    };
  }
}

// 从 markdown body 抽出某个 H2 章节里的 "- xxx" bullet list（用于 ## When to use）
function extractBulletSection(body: unknown, headingAliases: string[]): string[] {
  if (typeof body !== "string") return [];
  for (const heading of headingAliases) {
    const re = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$([\\s\\S]*?)(?=^##\\s+|\\Z)`, "im");
    const m = body.match(re);
    if (!m) continue;
    const items: string[] = [];
    for (const line of m[1].split("\n")) {
      const t = line.trim();
      if (t.startsWith("- ")) items.push(t.slice(2).trim());
    }
    if (items.length) return items;
  }
  return [];
}

// 从 ## Inputs 章节里把 "- `name` (type, 必填|选填)：description" 形式的行解析成 args schema
function extractInputsSection(body: unknown): Record<string, AgenticSkillArgSchema> {
  if (typeof body !== "string") return {};
  const re = /^##\s+Inputs\s*$([\s\S]*?)(?=^##\s+|\Z)/im;
  const m = body.match(re);
  if (!m) return {};
  const args: Record<string, AgenticSkillArgSchema> = {};
  // 兼容全角/半角冒号、括号
  const lineRe = /^-\s*`([^`]+)`\s*[（(]\s*([^,，)）]+?)\s*(?:[,，]\s*(必填|选填|required|optional))?\s*[)）]\s*[:：]\s*(.+)$/i;
  for (const line of m[1].split("\n")) {
    const t = line.trim();
    if (!t.startsWith("- ")) continue;
    const lm = t.match(lineRe);
    if (!lm) continue;
    const [, name, type, req, desc] = lm;
    args[name] = {
      type: type.trim().toLowerCase(),
      required: /^(必填|required)$/i.test(req ?? ""),
      description: desc.trim()
    };
  }
  return args;
}

function escapeRegex(s: unknown): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseFrontmatter(raw: string): FrontmatterResult {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return { meta: {}, body: raw };
  return { meta: parseSimpleYaml(m[1]), body: m[2] };
}

// 极简 YAML：只够解析我们写的 SKILL.md，不依赖第三方包。
// 支持：标量 / 数组（- item） / 一层嵌套对象
function parseSimpleYaml(text: string): JsonObject {
  const lines = text.split("\n");
  const root: JsonObject = {};
  const stack: Array<{ indent: number; container: SimpleYamlContainer; key: string | null }> = [{ indent: -1, container: root, key: null }];

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();

    if (line.startsWith("- ")) {
      const value = parseScalar(line.slice(2));
      const top = stack[stack.length - 1];
      if (Array.isArray(top.container)) top.container.push(value);
      else if (top.key && isJsonObject(top.container)) {
        const target = top.container[top.key];
        if (Array.isArray(target)) target.push(value);
      }
      continue;
    }

    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    const top = stack[stack.length - 1];
    const target = Array.isArray(top.container) ? top.container[top.container.length - 1] : top.container;
    if (!isJsonObject(target)) continue;

    if (rest === "") {
      // value 在下一行：可能是数组或对象，先放空对象，遇到 "- " 再升级为数组
      target[key] = {};
      stack.push({ indent, container: target[key], key });
      // 临时也允许它变成数组（看下一行）
    } else {
      target[key] = parseScalar(rest);
    }
  }
  return root;
}

function parseScalar(s: string): JsonValue {
  s = s.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    return s.slice(1, -1).split(",").map((x) => parseScalar(x)).filter((x) => x !== "");
  }
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === "true";
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function paramsSchemaFromIO(io: AgenticSkillIO | undefined): JsonObject {
  if (!io || typeof io !== "object") return {};
  const args = io.args ?? {};
  const schema: JsonObject = {};
  for (const [k, v] of Object.entries(args)) {
    if (!v || typeof v !== "object") continue;
    schema[k] = { type: v.type ?? "string", description: v.description ?? "" };
  }
  return schema;
}

function shortDescription(skill: AgenticSkill): string {
  const lines = [skill.description];
  if (Array.isArray(skill.when_to_use) && skill.when_to_use.length) {
    lines.push("适用：" + skill.when_to_use.slice(0, 2).join("；"));
  }
  return lines.filter(Boolean).join("。");
}

function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    if (v == null) return "（未提供）";
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  });
}

function readExamples(dir: string): ExampleDoc[] {
  const exDir = path.join(dir, "examples");
  if (!existsSync(exDir)) return [];
  return readdirSync(exDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ name: f.replace(/\.md$/, ""), body: readFileSync(path.join(exDir, f), "utf8").trim() }));
}

function readIfExists(p: string): string {
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

async function runPreprocess(dir: string, args: TemplateVars): Promise<TemplateVars> {
  const scriptPath = path.join(dir, "scripts", "preprocess.js");
  if (!existsSync(scriptPath)) return {};
  try {
    const mod = await import(pathToFileURL(scriptPath).href) as { default?: unknown; preprocess?: unknown };
    const fn = mod.default ?? mod.preprocess;
    if (typeof fn !== "function") return {};
    const out = await (fn as (input: TemplateVars) => Promise<unknown> | unknown)(args);
    return out && typeof out === "object" && !Array.isArray(out) ? out as TemplateVars : {};
  } catch (err) {
    return { _preprocess_error: err instanceof Error ? err.message : String(err) };
  }
}
