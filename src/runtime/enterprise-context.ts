import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { createRuntimeClockSnapshot } from "./runtime-clock.js";
import type { JsonObject, UserContext } from "../types/agent-contracts.js";

const ADMIN_FILES = ["AGENTS.md", "SOUL.md", "TOOLS.md", "POLICY.md"];
const DENIED_MEMORY_PATTERNS = [
  /不用管权限|忽略权限|绕过权限|查所有|全部客户|所有客户/,
  /修改.*(规则|权限|策略|tool|工具|system|soul|agent)/i,
  /以后.*(不用|不要).*(审批|授权|校验|权限)/,
  /记住.*(密码|密钥|secret|token|key|身份证|银行卡)/i
];

export class EnterpriseContextProvider {
  private readonly workspaceDir: string;
  private readonly memoryDir: string;

  constructor({ workspaceDir = "workspace" }: { workspaceDir?: string } = {}) {
    this.workspaceDir = resolveProjectPath(workspaceDir);
    this.memoryDir = path.join(this.workspaceDir, "memory");
  }

  async load({ user }: { user: UserContext }): Promise<unknown> {
    const admin = await this.loadAdminContext();
    const orgMemory = await this.loadOrgMemory();
    const userMemory = await this.loadUserMemory(user.id);
    return {
      runtime: createRuntimeClockSnapshot(),
      admin,
      org_memory: orgMemory,
      user_memory: userMemory,
      policy: {
        admin_managed: true,
        ordinary_user_can_modify_admin_context: false,
        user_memory_write_policy: "filtered_personal_preferences_only"
      }
    };
  }

  async maybeWriteUserMemory({ user, message }: { user: UserContext; message?: string }): Promise<JsonObject | null> {
    const candidate = extractUserMemoryCandidate(message);
    if (!candidate) return null;
    if (!isAllowedUserMemory(candidate, message)) {
      return {
        status: "denied",
        reason: "该内容涉及权限、策略、敏感信息或组织级规则，不能写入个人记忆。",
        candidate
      };
    }

    const memory = await this.loadUserMemory(user.id);
    const nextItem = {
      ...candidate,
      source: "chat",
      created_at: new Date().toISOString()
    };
    const filtered = memory.items.filter((item) => item.key !== nextItem.key);
    const nextMemory = {
      owner_user_id: user.id,
      scope: "user" as const,
      readonly_for_users: false,
      items: filtered.concat(nextItem).slice(-50),
      updated_at: new Date().toISOString()
    };
    await this.saveUserMemory(user.id, nextMemory);
    return {
      status: "written",
      item: nextItem
    };
  }

  async loadAdminContext(): Promise<Array<{ name: string; path: string; content: string }>> {
    const entries: Array<{ name: string; path: string; content: string }> = [];
    for (const file of ADMIN_FILES) {
      const fullPath = path.join(this.workspaceDir, file);
      if (!existsSync(fullPath)) continue;
      entries.push({
        name: file,
        path: path.relative(resolveProjectPath(), fullPath),
        content: await readFile(fullPath, "utf8")
      });
    }
    return entries;
  }

  async loadOrgMemory(): Promise<JsonObject> {
    const file = path.join(this.memoryDir, "org.json");
    if (!existsSync(file)) return { items: [] };
    try {
      return JSON.parse(await readFile(file, "utf8")) as JsonObject;
    } catch {
      return { items: [] };
    }
  }

  async loadUserMemory(userId: string): Promise<UserMemory> {
    const file = this.userMemoryPath(userId);
    if (!existsSync(file)) {
      return {
        owner_user_id: userId,
        scope: "user",
        readonly_for_users: false,
        items: []
      };
    }
    try {
      return JSON.parse(await readFile(file, "utf8")) as UserMemory;
    } catch {
      return {
        owner_user_id: userId,
        scope: "user",
        readonly_for_users: false,
        items: []
      };
    }
  }

  async saveUserMemory(userId: string, memory: UserMemory): Promise<void> {
    await mkdir(path.join(this.memoryDir, "user"), { recursive: true });
    await writeFile(this.userMemoryPath(userId), JSON.stringify(memory, null, 2), "utf8");
  }

  userMemoryPath(userId: string): string {
    const safe = String(userId).replace(/[^a-zA-Z0-9_.:-]/g, "_");
    return path.join(this.memoryDir, "user", `${safe}.json`);
  }
}

interface UserMemoryItem extends JsonObject {
  key: string;
  type: string;
  value: string;
  confidence: number;
  source?: string;
  created_at?: string;
}

interface UserMemory extends JsonObject {
  owner_user_id: string;
  scope: "user";
  readonly_for_users: boolean;
  items: UserMemoryItem[];
  updated_at?: string;
}

function extractUserMemoryCandidate(message?: string): UserMemoryItem | null {
  const text = String(message ?? "").trim();
  if (!text) return null;

  if (/以后.*(简短|简洁|短一点|详细|表格|markdown|列表)/.test(text)) {
    return {
      key: "answer_style_preference",
      type: "preference",
      value: text,
      confidence: 0.78
    };
  }

  if (/(默认|以后).*(排序|筛选|展示|显示)/.test(text)) {
    return {
      key: "query_presentation_preference",
      type: "preference",
      value: text,
      confidence: 0.72
    };
  }

  if (/^(记住|以后|默认)/.test(text)) {
    return {
      key: "general_user_preference_candidate",
      type: "preference",
      value: text,
      confidence: 0.55
    };
  }

  return null;
}

function isAllowedUserMemory(candidate: UserMemoryItem, message?: string): boolean {
  const text = `${candidate.value ?? ""}\n${message ?? ""}`;
  return !DENIED_MEMORY_PATTERNS.some((pattern) => pattern.test(text));
}
