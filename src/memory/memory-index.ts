/**
 * MemoryIndex — Phase 2 新增
 *
 * 维护用户 workspace 下的 MEMORY.md 索引文件。
 * 每次 memory 写入后（由 MemoryLearner 触发）调用 rebuild()，
 * 将 memory.json 里的所有条目按类型分类写成 Markdown frontmatter + 正文格式，
 * 供 MemoryRetriever 做轻量扫描，减少全量 JSON 加载。
 *
 * 文件格式：
 * ---
 * updated_at: ISO8601
 * user_id: xxx
 * item_count: N
 * categories:
 *   user: N
 *   feedback: N
 *   project: N
 *   reference: N
 *   procedure: N
 *   fact: N
 *   episode: N
 * ---
 *
 * ## user（偏好与角色）
 * - [key] type: value (confidence: 0.9)
 *
 * ## feedback（对 Agent 行为的正/负反馈）
 * - ...
 *
 * ## project（非代码可推导的业务上下文）
 * - ...
 *
 * ## reference（外部系统/指标/文档指针）
 * - ...
 *
 * ## procedure（操作流程与最佳实践）
 * - ...
 *
 * ## fact（业务事实）
 * - ...
 *
 * ## episode（重要会话事件摘要）
 * - ...
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { safeJoinWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";

export type MemoryCategory = "user" | "feedback" | "project" | "reference" | "procedure" | "fact" | "episode";

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  "user", "feedback", "project", "reference", "procedure", "fact", "episode"
];

/** memory.json 里的单条 item，与 MemoryLearner 里的 MemoryItem 对齐 */
export interface IndexedMemoryItem extends JsonObject {
  key: string;
  type: string;
  value: string;
  confidence?: number;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

export interface MemoryIndexSummary extends JsonObject {
  updated_at: string;
  user_id: string;
  item_count: number;
  categories: Record<MemoryCategory, number>;
}

export class MemoryIndex {
  /**
   * rebuild() — 在 memory.json 写入后调用，增量重建 MEMORY.md 索引。
   *
   * 增量优化：先用 item_count + content hash 做快速 diff，
   * 内容未变时跳过 writeFile，避免不必要的磁盘 IO。
   *
   * 设计：永不抛错（catch 内 warn），避免索引重建失败中断主流程。
   */
  async rebuild(workspace: WorkspaceContext, items: IndexedMemoryItem[]): Promise<MemoryIndexSummary | null> {
    try {
      const summary = buildSummary(workspace.user_id, items);
      const content = renderMarkdown(summary, items);
      const filePath = this.filePath(workspace);
      await mkdir(workspace.memory_dir, { recursive: true });

      // 增量检查：若文件已存在且内容哈希相同，跳过写入
      if (existsSync(filePath)) {
        try {
          const existing = await readFile(filePath, "utf8");
          if (contentHash(existing) === contentHash(content)) {
            // 内容无变化，直接返回已解析的 summary，避免写盘
            return summary;
          }
        } catch {
          // 读取失败则继续写入
        }
      }

      await writeFile(filePath, content, "utf8");
      return summary;
    } catch (error) {
      console.warn(`[memory-index] rebuild failed for user=${workspace.user_id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * load() — 读取 MEMORY.md，解析 frontmatter 返回索引摘要。
   *
   * 供 MemoryRetriever 在 retrieve() 之前快速判断哪些分类有内容，
   * 避免每次都全量加载 memory.json。
   */
  async load(workspace: WorkspaceContext): Promise<MemoryIndexSummary | null> {
    const file = this.filePath(workspace);
    if (!existsSync(file)) return null;
    try {
      const content = await readFile(file, "utf8");
      return parseFrontmatter(content);
    } catch {
      return null;
    }
  }

  /**
   * scanCategories() — 从 MEMORY.md 正文里按分类提取 item 文本摘要。
   *
   * 返回 Map<category, text[]>，供 MemoryRetriever 按类型做轻量文本匹配，
   * 不需要加载完整 memory.json。
   */
  async scanCategories(workspace: WorkspaceContext): Promise<Map<MemoryCategory, string[]>> {
    const file = this.filePath(workspace);
    if (!existsSync(file)) return new Map();
    try {
      const content = await readFile(file, "utf8");
      return parseCategoryBlocks(content);
    } catch {
      return new Map();
    }
  }

  filePath(workspace: WorkspaceContext): string {
    return safeJoinWorkspace(workspace.root, "memory", "MEMORY.md");
  }
}

// ---- 内部函数 ----

function categoryOf(type: string): MemoryCategory {
  const normalized = type.toLowerCase().trim();
  if (normalized === "preference" || normalized === "user") return "user";
  if (normalized === "feedback") return "feedback";
  if (normalized === "project") return "project";
  if (normalized === "reference") return "reference";
  if (normalized === "procedure") return "procedure";
  if (normalized === "episode") return "episode";
  // fact / other -> fact
  return "fact";
}

function buildSummary(userId: string, items: IndexedMemoryItem[]): MemoryIndexSummary {
  const counts: Record<MemoryCategory, number> = {
    user: 0, feedback: 0, project: 0, reference: 0, procedure: 0, fact: 0, episode: 0
  };
  for (const item of items) {
    const cat = categoryOf(item.type);
    counts[cat] += 1;
  }
  return {
    updated_at: new Date().toISOString(),
    user_id: userId,
    item_count: items.length,
    categories: counts
  };
}

function renderMarkdown(summary: MemoryIndexSummary, items: IndexedMemoryItem[]): string {
  const grouped = new Map<MemoryCategory, IndexedMemoryItem[]>();
  for (const cat of MEMORY_CATEGORIES) grouped.set(cat, []);
  for (const item of items) {
    const cat = categoryOf(item.type);
    grouped.get(cat)?.push(item);
  }

  const frontmatter = [
    "---",
    `updated_at: ${summary.updated_at}`,
    `user_id: ${summary.user_id}`,
    `item_count: ${summary.item_count}`,
    "categories:",
    ...MEMORY_CATEGORIES.map((cat) => `  ${cat}: ${summary.categories[cat]}`)
  ];

  const sections: string[] = [];
  const CATEGORY_LABELS: Record<MemoryCategory, string> = {
    user: "user（偏好与角色）",
    feedback: "feedback（对 Agent 行为的正/负反馈）",
    project: "project（业务上下文）",
    reference: "reference（外部系统/指标/文档指针）",
    procedure: "procedure（操作流程与最佳实践）",
    fact: "fact（业务事实）",
    episode: "episode（重要会话摘要）"
  };

  for (const cat of MEMORY_CATEGORIES) {
    const catItems = grouped.get(cat) ?? [];
    if (!catItems.length) continue;
    sections.push(`\n## ${CATEGORY_LABELS[cat]}`);
    for (const item of catItems) {
      const conf = typeof item.confidence === "number" ? ` (conf: ${item.confidence.toFixed(2)})` : "";
      const src = item.source ? ` [${item.source}]` : "";
      sections.push(`- **${item.key}**: ${item.value.trim().slice(0, 200)}${conf}${src}`);
    }
  }

  return [
    ...frontmatter,
    "---",
    "",
    "# MEMORY INDEX",
    "",
    `> 此文件由 MemoryIndex.rebuild() 自动生成，请勿手动修改。`,
    `> 上次更新：${summary.updated_at}，共 ${summary.item_count} 条记忆。`,
    "",
    ...sections
  ].join("\n") + "\n";
}

function parseFrontmatter(content: string): MemoryIndexSummary | null {
  const match = /^---\n([\s\S]*?)\n---/m.exec(content);
  if (!match) return null;
  const raw = match[1];
  const updatedAt = extractYamlString(raw, "updated_at");
  const userId = extractYamlString(raw, "user_id");
  const itemCount = extractYamlNumber(raw, "item_count");
  if (!updatedAt || !userId) return null;

  const catBlock = /categories:\n((?:  \w+: \d+\n?)+)/m.exec(raw);
  const categories: Record<MemoryCategory, number> = {
    user: 0, feedback: 0, project: 0, reference: 0, procedure: 0, fact: 0, episode: 0
  };
  if (catBlock) {
    for (const line of catBlock[1].split("\n")) {
      const lineMatch = /^\s+(\w+): (\d+)/.exec(line);
      if (lineMatch) {
        const cat = lineMatch[1] as MemoryCategory;
        if (MEMORY_CATEGORIES.includes(cat)) categories[cat] = Number(lineMatch[2]);
      }
    }
  }
  return {
    updated_at: updatedAt,
    user_id: userId,
    item_count: itemCount ?? 0,
    categories
  };
}

function parseCategoryBlocks(content: string): Map<MemoryCategory, string[]> {
  const result = new Map<MemoryCategory, string[]>();
  // 跳过 frontmatter
  const bodyStart = content.indexOf("---\n", 4);
  const body = bodyStart >= 0 ? content.slice(bodyStart + 4) : content;

  // 按 ## 分割 section
  const sectionPattern = /^## (\w+)/m;
  const chunks = body.split(/^## /m).slice(1);
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    const header = lines[0] ?? "";
    const catMatch = /^(\w+)/.exec(header);
    if (!catMatch) continue;
    const cat = catMatch[1].toLowerCase() as MemoryCategory;
    if (!MEMORY_CATEGORIES.includes(cat)) continue;
    const items = lines
      .slice(1)
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
    result.set(cat, items);
  }
  // 消除未使用变量警告
  void sectionPattern;
  return result;
}

function extractYamlString(raw: string, key: string): string | null {
  const match = new RegExp(`^${key}: (.+)$`, "m").exec(raw);
  return match ? match[1].trim() : null;
}

function extractYamlNumber(raw: string, key: string): number | null {
  const match = new RegExp(`^${key}: (\\d+)$`, "m").exec(raw);
  return match ? Number(match[1]) : null;
}

/**
 * 快速内容哈希（SHA-256 前 16 字节 hex）。
 * 用于增量 rebuild 时检测 MEMORY.md 内容是否真正变化，避免不必要的 writeFile。
 * 注意：frontmatter 里的 updated_at 每次都不同，所以先去掉再做哈希比较，
 * 即：只比较 item_count + categories + 正文 sections 的内容是否等价。
 */
function contentHash(content: string): string {
  // 去掉 frontmatter 中的 updated_at 行，避免时间戳变化导致误判为内容变化
  const normalized = content.replace(/^updated_at: .+$/m, "updated_at: __stripped__");
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}
