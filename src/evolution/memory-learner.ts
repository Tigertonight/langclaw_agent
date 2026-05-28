import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject, UserContext } from "../types/agent-contracts.js";
import type { MemoryAction } from "./types.js";
import { loadDisabledEvolutionTargets } from "./governance.js";
import { MemoryIndex } from "../memory/memory-index.js";
import { getMemoryClient, resolveBusinessId } from "../memory/service-client.js";
import type { ExtractionResult, ExtractedEntity, ExtractedRelation } from "./structured-output.js";
import type { CallContext } from "../../packages/memory-sdk/src/index.js";

interface MemoryFile extends JsonObject {
  owner_user_id: string;
  scope: "user";
  readonly_for_users: boolean;
  items: MemoryItem[];
  updated_at?: string;
}

interface MemoryItem extends JsonObject {
  key: string;
  type: string;
  value: string;
  confidence?: number;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

export class MemoryLearner {
  private readonly memoryIndex = new MemoryIndex();

  async apply({ workspace, actions, user }: { workspace: WorkspaceContext; actions?: MemoryAction[]; user?: UserContext }): Promise<number> {
    const normalized = Array.isArray(actions) ? actions : [];
    if (!normalized.length) return 0;
    const disabled = await loadDisabledEvolutionTargets(workspace);
    const memory = await this.load(workspace);
    let changed = 0;

    for (const action of normalized) {
      const key = action.key.trim();
      if (disabled.has(key) || disabled.has(`memory:${key}`)) continue;
      if (action.op === "remove") {
        const before = memory.items.length;
        memory.items = memory.items.filter((item) => item.key !== key);
        if (memory.items.length !== before) changed += 1;
        continue;
      }
      if (typeof action.value !== "string" || !action.value.trim()) continue;
      const now = new Date().toISOString();
      const existing = memory.items.find((item) => item.key === key);
      if (existing) {
        existing.type = action.type;
        existing.value = action.value.trim();
        existing.confidence = action.confidence;
        existing.source = action.source ?? "evolution";
        existing.updated_at = now;
      } else {
        memory.items.push({
          key,
          type: action.type,
          value: action.value.trim(),
          confidence: action.confidence,
          source: action.source ?? "evolution",
          created_at: now,
          updated_at: now
        });
      }
      changed += 1;
    }

    if (changed) {
      memory.items = compactMemoryItems(memory.items).slice(-100);
      memory.updated_at = new Date().toISOString();
      await this.save(workspace, memory);
      // Phase 2: 写入后重建 MEMORY.md 索引（异步，不阻塞返回）
      this.memoryIndex.rebuild(workspace, memory.items).catch(() => undefined);
      // Phase 1.12: 镜像到 memory-service（仅当配置可用，失败不影响主路径）
      void this.mirrorToService(workspace, user, normalized).catch(() => undefined);
    }
    return changed;
  }

  private async mirrorToService(
    workspace: WorkspaceContext,
    user: UserContext | undefined,
    actions: MemoryAction[]
  ): Promise<void> {
    const client = getMemoryClient();
    if (!client) return;
    const ctx = {
      business_id: workspace.business_id ?? resolveBusinessId(user as { business_id?: unknown } | undefined),
      user_id: workspace.user_id,
      agent_id: typeof user?.agent_id === "string" ? user.agent_id : undefined
    };
    for (const action of actions) {
      if (action.op === "upsert" && typeof action.value === "string" && action.value.trim()) {
        await client.createMemory(ctx, {
          category: mapMemoryCategory(action.type),
          name: action.key,
          content: action.value.trim(),
          source: action.source ?? "evolution",
          confidence: typeof action.confidence === "number" ? action.confidence : undefined
        }).catch(() => undefined);
      }
      // Note: remove → memory-service uses UUID-based delete; we don't have the
      // remote id here, so remote retention is best-effort additive in Phase 1.
      // Cleanup will be reconciled in Phase 2's sync job.
    }
  }

  async load(workspace: WorkspaceContext): Promise<MemoryFile> {
    const file = this.filePath(workspace);
    if (!existsSync(file)) return createMemoryFile(workspace.user_id);
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<MemoryFile>;
      return {
        owner_user_id: typeof parsed.owner_user_id === "string" ? parsed.owner_user_id : workspace.user_id,
        scope: "user",
        readonly_for_users: false,
        items: Array.isArray(parsed.items) ? parsed.items.filter(isMemoryItem) : [],
        updated_at: parsed.updated_at
      };
    } catch {
      return createMemoryFile(workspace.user_id);
    }
  }

  async save(workspace: WorkspaceContext, memory: MemoryFile): Promise<void> {
    await mkdir(workspace.memory_dir, { recursive: true });
    await writeFile(this.filePath(workspace), JSON.stringify(memory, null, 2), "utf8");
    // 注意：rebuild 已在 apply() 的 changed 分支中触发，save() 是 apply() 的内部调用，
    // 无需再次触发以避免重复 IO。若外部直接调用 save()（如测试/迁移脚本），
    // 调用方应自行决定是否需要 rebuild。
  }

  filePath(workspace: WorkspaceContext): string {
    return path.join(workspace.memory_dir, "memory.json");
  }

  /**
   * Phase 2.5 — 把结构化抽取结果写入 memory-service。
   *
   * 流程：
   *   1) 应用 memory_actions → 走原 apply() 路径（写 memory.json + 镜像 memory-service）。
   *   2) 对每个 entity：先 resolveEntity，没匹配则 upsertEntity，得到正式 full_id，
   *      建立 local_id → full_id 的映射。
   *   3) 对每个 relation：把 subject/object 的 local_id 替换成 full_id，
   *      调用 createRelation。
   *
   * 当 memory-service 未配置（getMemoryClient 返回 null）时，第 2/3 步降级为 no-op，
   * 仅 memory_actions 走本地 memory.json 路径，与 Phase 1 保持兼容。
   */
  async applyExtraction({
    workspace,
    user,
    extraction,
    traceId,
    runId
  }: {
    workspace: WorkspaceContext;
    user?: UserContext;
    extraction: ExtractionResult;
    /** 上游传入的 trace 上下文，会通过 SDK 注入到 memory-service HTTP 头部 */
    traceId?: string;
    runId?: string;
  }): Promise<{ memory_changed: number; entities_written: number; relations_written: number; errors: string[] }> {
    const errors: string[] = [];
    let memory_changed = 0;
    let entities_written = 0;
    let relations_written = 0;

    if (extraction.memory_actions?.length) {
      memory_changed = await this.apply({ workspace, user, actions: extraction.memory_actions as MemoryAction[] });
    }

    const client = getMemoryClient();
    if (!client) {
      return { memory_changed, entities_written, relations_written, errors };
    }
    const ctx: CallContext = {
      business_id: workspace.business_id ?? resolveBusinessId(user as { business_id?: unknown } | undefined),
      user_id: workspace.user_id,
      agent_id: typeof user?.agent_id === "string" ? user.agent_id : undefined,
      trace_id: traceId,
      run_id: runId
    };

    const localIdToFullId = new Map<string, string>();
    for (const entity of extraction.entities ?? []) {
      try {
        const fullId = await this.resolveOrUpsertEntity(client, ctx, entity);
        localIdToFullId.set(entity.local_id, fullId);
        entities_written += 1;
      } catch (err) {
        errors.push(`entity:${entity.local_id}:${err instanceof Error ? err.message : "unknown"}`);
      }
    }

    for (const relation of extraction.relations ?? []) {
      const subjectId = resolveRef(relation.subject, localIdToFullId);
      if (!subjectId) {
        errors.push(`relation_subject_unresolved:${refLabel(relation.subject)}`);
        continue;
      }
      let objectId: string | undefined;
      if (relation.object) {
        const oid = resolveRef(relation.object, localIdToFullId);
        if (!oid) {
          errors.push(`relation_object_unresolved:${refLabel(relation.object)}`);
          continue;
        }
        objectId = oid;
      }
      try {
        await client.createRelation(ctx, {
          subject_id: subjectId,
          predicate: relation.predicate,
          object_id: objectId ?? null,
          object_value: relation.object_value,
          occurred_at: relation.occurred_at ?? null,
          confidence: relation.confidence,
          metadata: relation.metadata
        });
        relations_written += 1;
      } catch (err) {
        errors.push(`relation:${relation.predicate}:${err instanceof Error ? err.message : "unknown"}`);
      }
    }

    return { memory_changed, entities_written, relations_written, errors };
  }

  private async resolveOrUpsertEntity(
    client: NonNullable<ReturnType<typeof getMemoryClient>>,
    ctx: CallContext,
    entity: ExtractedEntity
  ): Promise<string> {
    const resolved = await client.resolveEntity(ctx, {
      type: entity.type,
      external_ids: entity.external_ids,
      strong_attributes: entity.strong_attributes,
      name_hint: entity.name
    }).catch(() => null);

    if (resolved?.matched) return resolved.matched.id;

    const upserted = await client.upsertEntity(ctx, {
      local_id: entity.local_id,
      type: entity.type,
      name: entity.name,
      aliases: entity.aliases,
      external_ids: entity.external_ids,
      attributes: mergeAttrs(entity.attributes, entity.strong_attributes)
    });
    return upserted.id;
  }
}

function resolveRef(
  ref: { local_id: string } | { full_id: string },
  map: Map<string, string>
): string | undefined {
  if ("full_id" in ref) return ref.full_id;
  return map.get(ref.local_id);
}

function refLabel(ref: { local_id: string } | { full_id: string }): string {
  return "full_id" in ref ? ref.full_id : ref.local_id;
}

function mergeAttrs(
  attrs: Record<string, unknown> | undefined,
  strong: Record<string, string> | undefined
): Record<string, unknown> | undefined {
  if (!attrs && !strong) return undefined;
  return { ...(attrs ?? {}), ...(strong ?? {}) };
}

/** Map evolution-side type to memory-service 7-class category. */
function mapMemoryCategory(type: MemoryAction["type"]): "user" | "feedback" | "project" | "reference" | "procedure" | "fact" | "episode" {
  switch (type) {
    case "preference": return "user";
    case "feedback": return "feedback";
    case "project": return "project";
    case "reference": return "reference";
    case "procedure": return "procedure";
    case "fact": return "fact";
    case "episode": return "episode";
    case "user": return "user";
    default: return "fact";
  }
}

function compactMemoryItems(items: MemoryItem[]): MemoryItem[] {
  const byKey = new Map<string, MemoryItem>();
  for (const item of items) {
    const existing = byKey.get(item.key);
    if (!existing || String(item.updated_at ?? item.created_at ?? "").localeCompare(String(existing.updated_at ?? existing.created_at ?? "")) >= 0) {
      byKey.set(item.key, {
        ...item,
        confidence: decayConfidence(item.confidence, item.updated_at ?? item.created_at)
      });
    }
  }
  const byValue = new Map<string, MemoryItem>();
  for (const item of byKey.values()) {
    const signature = `${item.type}:${item.value.trim().toLowerCase()}`;
    const existing = byValue.get(signature);
    if (!existing || Number(item.confidence ?? 0) >= Number(existing.confidence ?? 0)) {
      byValue.set(signature, item);
    }
  }
  return Array.from(byValue.values()).sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
}

function decayConfidence(confidence: unknown, lastSeen: unknown): number | undefined {
  if (typeof confidence !== "number") return undefined;
  const ts = Date.parse(String(lastSeen ?? ""));
  if (!Number.isFinite(ts)) return confidence;
  const ageDays = (Date.now() - ts) / (24 * 60 * 60 * 1000);
  if (ageDays <= 30) return confidence;
  return Math.max(0.2, Number((confidence * Math.pow(0.98, Math.floor(ageDays / 30))).toFixed(3)));
}

function createMemoryFile(userId: string): MemoryFile {
  return {
    owner_user_id: userId,
    scope: "user",
    readonly_for_users: false,
    items: []
  };
}

function isMemoryItem(value: unknown): value is MemoryItem {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as { key?: unknown }).key === "string"
    && typeof (value as { value?: unknown }).value === "string";
}
