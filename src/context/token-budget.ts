/**
 * TokenBudget — Phase 3 新增
 *
 * 集中管理单次上下文拼装的 token/char 预算分配，
 * 提供运行时预算检查和动态缩减能力。
 *
 * 设计原则（对标 Claude Code token budget 机制）：
 * 1. char 预算：各分区按上限截断，优先保留 runtime/admin，
 *    其次 task/memory/episode，最后 conversation/transcript。
 * 2. token 估算：保守取 chars / 2（中英混排），不依赖外部 tokenizer。
 * 3. 预算超出时优先压缩低优先级分区，而不是直接截断高优先级分区。
 * 4. compaction_needed 信号：当 estimated_tokens > soft_limit 时触发 compaction 建议。
 */

import type { JsonObject } from "../types/agent-contracts.js";

export interface SectionBudget {
  name: string;
  /** 本分区最大允许字符数 */
  maxChars: number;
  /** 分区优先级（越大越优先保留），默认 50 */
  priority: number;
}

export interface TokenBudgetConfig {
  /** 全局最大 char 预算（粗估 token = chars / 2） */
  maxChars: number;
  /** 当 estimated_tokens 超过此值时，返回 compaction_needed = true */
  softTokenLimit: number;
  /** 每个分区的预算配置 */
  sections: SectionBudget[];
}

export interface BudgetAllocation {
  /** 各分区的分配 char 上限 */
  allocations: Record<string, number>;
  /** 全局 char 上限 */
  maxChars: number;
  /** 粗估 token 上限（= maxChars / 2） */
  maxTokens: number;
  /** soft token 限制（触发 compaction 建议） */
  softTokenLimit: number;
}

export interface BudgetUsage extends JsonObject {
  max_chars: number;
  used_chars: number;
  estimated_tokens: number;
  soft_token_limit: number;
  compaction_needed: boolean;
  sections: JsonObject[];
  overflow_chars: number;
}

export interface BudgetedSection {
  name: string;
  content: string;
  original_chars: number;
  used_chars: number;
  truncated: boolean;
  priority: number;
}

/** 默认企业 Agent 上下文预算（适配企业垂类业务场景） */
export const DEFAULT_BUDGET_CONFIG: TokenBudgetConfig = {
  maxChars: 24_000,
  softTokenLimit: 8_000,
  sections: [
    { name: "runtime",      maxChars: 3_000,  priority: 100 },
    { name: "admin",        maxChars: 5_000,  priority: 90  },
    { name: "tasks",        maxChars: 4_000,  priority: 80  },
    { name: "memory",       maxChars: 5_000,  priority: 70  },
    { name: "episode",      maxChars: 2_000,  priority: 60  },
    { name: "conversation", maxChars: 4_000,  priority: 55  },
    { name: "tools",        maxChars: 2_000,  priority: 50  }
  ]
};

export class TokenBudget {
  private readonly config: TokenBudgetConfig;

  constructor(config: Partial<TokenBudgetConfig> = {}) {
    this.config = {
      maxChars: config.maxChars ?? DEFAULT_BUDGET_CONFIG.maxChars,
      softTokenLimit: config.softTokenLimit ?? DEFAULT_BUDGET_CONFIG.softTokenLimit,
      sections: config.sections ?? DEFAULT_BUDGET_CONFIG.sections
    };
  }

  /** 返回各分区的预算分配对象 */
  allocate(overrides: Partial<Record<string, number>> = {}): BudgetAllocation {
    const allocations: Record<string, number> = {};
    for (const section of this.config.sections) {
      allocations[section.name] = overrides[section.name] ?? section.maxChars;
    }
    return {
      allocations,
      maxChars: this.config.maxChars,
      maxTokens: Math.ceil(this.config.maxChars / 2),
      softTokenLimit: this.config.softTokenLimit
    };
  }

  /**
   * fitSections() — 按优先级将各分区内容截断到预算内。
   *
   * 1. 先按 sectionBudget 截断各分区到自己的 maxChars。
   * 2. 若所有分区之和超过 maxChars，再从低优先级开始削减。
   * 3. 返回截断后的 BudgetedSection 数组和 BudgetUsage 统计。
   *
   * 性能优化：
   * - 预计算 priorityOf / maxCharsOf 映射，避免循环内重复 Map 查找
   * - Step 2 削减时直接在原数组就地修改，减少 sort + 数组重建开销
   * - 用 totalUsed 累加代替 reduce 扫描，O(n) 收集统计
   */
  fitSections(sections: Array<{ name: string; content: string }>): {
    sections: BudgetedSection[];
    usage: BudgetUsage;
  } {
    const budgetMap = new Map(this.config.sections.map((s) => [s.name, s]));

    // Step 1: 按各分区上限截断，同时累加 totalUsed
    let totalUsed = 0;
    const fitted: BudgetedSection[] = sections.map((section) => {
      const cfg = budgetMap.get(section.name);
      const limit = cfg?.maxChars ?? this.config.maxChars;
      const priority = cfg?.priority ?? 10;
      const original = section.content.length;
      if (original <= limit) {
        totalUsed += original;
        return { name: section.name, content: section.content, original_chars: original, used_chars: original, truncated: false, priority };
      }
      const truncated = `${section.content.slice(0, Math.max(0, limit - 28))}\n...(section budget truncated)`;
      totalUsed += truncated.length;
      return { name: section.name, content: truncated, original_chars: original, used_chars: truncated.length, truncated: true, priority };
    });

    // Step 2: 若总量超过全局 maxChars，从低优先级开始就地削减
    if (totalUsed > this.config.maxChars) {
      // 获取低→高优先级顺序的下标列表（避免额外拷贝整个 BudgetedSection 数组）
      const indices = Array.from({ length: fitted.length }, (_, i) => i)
        .sort((a, b) => fitted[a].priority - fitted[b].priority);

      let overflow = totalUsed - this.config.maxChars;
      for (const idx of indices) {
        if (overflow <= 0) break;
        const section = fitted[idx];
        // runtime / admin（priority >= 90）不可削减
        if (section.priority >= 90) continue;
        const cut = Math.min(overflow, Math.floor(section.used_chars / 2));
        if (cut <= 0) continue;
        const newLen = Math.max(0, section.used_chars - cut);
        section.content = `${section.content.slice(0, newLen)}\n...(global budget truncated)`;
        const actualCut = section.used_chars - section.content.length;
        section.used_chars = section.content.length;
        section.truncated = true;
        overflow -= actualCut;
        totalUsed -= actualCut;
      }
    }

    const estimatedTokens = estimateTokens(totalUsed);
    const usage: BudgetUsage = {
      max_chars: this.config.maxChars,
      used_chars: totalUsed,
      estimated_tokens: estimatedTokens,
      soft_token_limit: this.config.softTokenLimit,
      compaction_needed: estimatedTokens > this.config.softTokenLimit,
      overflow_chars: Math.max(0, totalUsed - this.config.maxChars),
      sections: fitted.map((section) => ({
        name: section.name,
        used_chars: section.used_chars,
        original_chars: section.original_chars,
        truncated: section.truncated,
        priority: section.priority
      }))
    };

    return { sections: fitted, usage };
  }

  /**
   * checkUsage() — 仅计算当前各分区用量，返回预算统计（不修改 content）。
   *
   * 性能优化：一次遍历同时完成 sectionStats 构建和 totalUsed 累加，避免 reduce。
   */
  checkUsage(sections: Array<{ name: string; content: string }>): BudgetUsage {
    const budgetMap = new Map(this.config.sections.map((s) => [s.name, s]));
    let totalUsed = 0;

    const sectionStats = sections.map((section) => {
      const chars = section.content.length;
      totalUsed += chars;
      return {
        name: section.name,
        used_chars: chars,
        original_chars: chars,
        truncated: false,
        priority: budgetMap.get(section.name)?.priority ?? 10
      };
    });

    const estimatedTokens = estimateTokens(totalUsed);
    return {
      max_chars: this.config.maxChars,
      used_chars: totalUsed,
      estimated_tokens: estimatedTokens,
      soft_token_limit: this.config.softTokenLimit,
      compaction_needed: estimatedTokens > this.config.softTokenLimit,
      overflow_chars: Math.max(0, totalUsed - this.config.maxChars),
      sections: sectionStats
    };
  }

  get maxChars(): number { return this.config.maxChars; }
  get softTokenLimit(): number { return this.config.softTokenLimit; }
}

/** 粗估 token（混排保守取 chars/2） */
export function estimateTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 2);
}
