/**
 * QueryAdapterRegistry：DomainQueryAdapter 的运行时注册中心。
 *
 * IntentQueryHandler 在 buildFilters / buildSort / applyDefaults / postProcessAnswer
 * 时查询本 Registry，找到第一个 supports() 返回 true 的 adapter 并委托执行。
 *
 * 设计原则：
 * - DomainPack 通过 queryAdapters 声明式字段注册 adapter
 * - DomainRegistry.initialize() 收集后注入本 Registry
 * - 查找顺序 = DomainPack 注册顺序（拓扑排序后）
 */

import type {
  DomainQueryAdapter,
  QueryAdapterInput,
  DefaultsInput,
  DefaultsResult,
  FiltersInput,
  SortInput,
  AnswerPostProcessInput,
} from "./types.js";
import type { QueryFilter, QuerySort } from "../types/agent-contracts.js";

export class QueryAdapterRegistry {
  private readonly adapters: DomainQueryAdapter[] = [];

  /**
   * 注册单个 adapter。
   */
  register(adapter: DomainQueryAdapter): void {
    this.adapters.push(adapter);
  }

  /**
   * 批量注册 adapter（保持数组顺序）。
   */
  registerMany(adapters: DomainQueryAdapter[]): void {
    for (const adapter of adapters) this.register(adapter);
  }

  /**
   * 查找第一个 supports() 返回 true 的 adapter。
   */
  find(input: QueryAdapterInput): DomainQueryAdapter | undefined {
    return this.adapters.find((adapter) => adapter.supports(input));
  }

  /**
   * 委托 applyDefaults：找到匹配的 adapter 并调用其 applyDefaults。
   * 未找到或 adapter 未实现时返回 null。
   */
  applyDefaults(input: DefaultsInput): DefaultsResult | null {
    const adapter = this.find(input);
    if (!adapter?.applyDefaults) return null;
    return adapter.applyDefaults(input);
  }

  /**
   * 委托 buildFilters：找到匹配的 adapter 并调用其 buildFilters。
   * 未找到或 adapter 未实现时返回 null。
   */
  buildFilters(input: FiltersInput): QueryFilter[] | null {
    const adapter = this.find(input);
    if (!adapter?.buildFilters) return null;
    return adapter.buildFilters(input);
  }

  /**
   * 委托 buildSort：找到匹配的 adapter 并调用其 buildSort。
   * 未找到或 adapter 未实现时返回 null。
   */
  buildSort(input: SortInput): QuerySort[] | null {
    const adapter = this.find(input);
    if (!adapter?.buildSort) return null;
    return adapter.buildSort(input);
  }

  /**
   * 委托 postProcessAnswer：找到匹配的 adapter 并调用其 postProcessAnswer。
   * 未找到或 adapter 未实现时返回原始 answer。
   */
  postProcessAnswer(input: AnswerPostProcessInput): string {
    const adapter = this.find({
      intentCode: input.route?.intent_code ?? "",
      resource: input.manifest?.tool_binding?.resource ?? "",
      params: input.params,
      manifest: input.manifest,
    });
    if (!adapter?.postProcessAnswer) return input.answer;
    return adapter.postProcessAnswer(input);
  }

  get size(): number {
    return this.adapters.length;
  }
}
