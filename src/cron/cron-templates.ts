/**
 * Phase 5.2: CronTemplates —— 预置 cron 模板库。
 *
 * 模板来源：
 *   1. 各 DomainPack 通过 cronTemplates 声明式注册到 DomainRegistry.allCronTemplates
 *   2. 本模块通过 getRuntimeRegistry() 动态读取所有已注册模板
 *   3. 保留 CronTemplate 接口和辅助函数供 cron-tools / eval 使用
 *
 * 模板结构：
 *   - id            : slug，便于工具按名称查找
 *   - name          : 人类可读名称
 *   - description   : 详细说明（用于 UI 展示）
 *   - cron_expr     : 5 字段标准 cron（分 时 日 月 周）
 *   - task          : 子 agent 执行时的自然语言任务目标
 *   - domain        : 业务域（dealer_sales / dealer_inventory / dealer_aftersales / dealer_finance）
 *   - allowed_tools : 推荐工具白名单（空则走全集）
 *   - max_steps     : 推荐最大步数
 */

import { getRuntimeRegistry } from "../domains/runtime-registry.js";

export interface CronTemplate {
  id: string;
  name: string;
  description: string;
  cron_expr: string;
  task: string;
  domain: string;
  allowed_tools: string[];
  max_steps: number;
  tags: string[];
}

/**
 * 获取所有已注册的 cron 模板。
 * 优先从 DomainRegistry.allCronTemplates 读取，未初始化时返回空数组。
 */
function getAllTemplates(): CronTemplate[] {
  const registry = getRuntimeRegistry();
  if (registry) {
    // allCronTemplates 来自 DomainRegistry，类型兼容 CronTemplate
    return registry.allCronTemplates as unknown as CronTemplate[];
  }
  return [];
}

/**
 * CRON_TEMPLATES —— 向后兼容的导出。
 * 使用 Proxy 实现惰性求值，确保在 registry 初始化后能动态获取模板。
 */
export const CRON_TEMPLATES: CronTemplate[] = new Proxy([] as CronTemplate[], {
  get(target, prop, receiver) {
    const templates = getAllTemplates();
    if (prop === "length") return templates.length;
    if (prop === Symbol.iterator) return templates[Symbol.iterator].bind(templates);
    if (typeof prop === "string" && /^\d+$/.test(prop)) return templates[Number(prop)];
    // 委托数组方法到实际模板列表
    const value = Reflect.get(templates, prop, receiver);
    if (typeof value === "function") return value.bind(templates);
    return value;
  }
});

/**
 * 按 id 查找单个模板。
 */
export function findTemplate(id: string): CronTemplate | null {
  return getAllTemplates().find((t) => t.id === id) ?? null;
}

/**
 * 按 domain 或 tag 过滤模板列表。
 */
export function filterTemplates(opts: {
  domain?: string;
  tag?: string;
  q?: string;
}): CronTemplate[] {
  return getAllTemplates().filter((t) => {
    if (opts.domain && t.domain !== opts.domain) return false;
    if (opts.tag && !t.tags.includes(opts.tag)) return false;
    if (opts.q) {
      const q = opts.q.toLowerCase();
      if (
        !t.name.toLowerCase().includes(q) &&
        !t.description.toLowerCase().includes(q) &&
        !t.id.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });
}

/**
 * 将模板转换为可直接传给 UserCronStore.create() 的输入。
 * overrides 可覆盖 task / allowed_tools / max_steps 等字段。
 */
export function applyTemplate(
  template: CronTemplate,
  userId: string,
  overrides?: {
    task?: string;
    allowed_tools?: string[];
    max_steps?: number;
    total_timeout_ms?: number;
    missed_window?: "skip" | "catch_up";
  }
): {
  user_id: string;
  cron_expr: string;
  task: string;
  allowed_tools?: string[];
  max_steps?: number;
  total_timeout_ms?: number;
  missed_window?: "skip" | "catch_up";
  metadata?: Record<string, string>;
} {
  return {
    user_id: userId,
    cron_expr: template.cron_expr,
    task: overrides?.task ?? template.task,
    allowed_tools: overrides?.allowed_tools ?? (template.allowed_tools.length > 0 ? template.allowed_tools : undefined),
    max_steps: overrides?.max_steps ?? template.max_steps,
    total_timeout_ms: overrides?.total_timeout_ms,
    missed_window: overrides?.missed_window ?? "skip"
  };
}

/** 模板摘要，用于工具返回时的紧凑展示。 */
export interface CronTemplateSummary {
  id: string;
  name: string;
  description: string;
  cron_expr: string;
  domain: string;
  tags: string[];
}

export function summarizeTemplate(t: CronTemplate): CronTemplateSummary {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    cron_expr: t.cron_expr,
    domain: t.domain,
    tags: t.tags
  };
}
