/**
 * ResourceRegistry：业务数据资源的注册中心。
 *
 * 管理所有已注册的 ResourceConfig 和 FieldLabels，
 * 供 BusinessDataTool（query_business_data）在运行时查找资源配置。
 *
 * 设计原则：
 * - DomainPack 通过 resources / fieldLabels 声明式字段注册资源
 * - DomainRegistry.initialize() 收集后注入本 Registry
 * - 支持运行时动态注册（register / registerMany）
 */

import type { ResourceConfig, FieldLabels } from "./types.js";

export class ResourceRegistry {
  private readonly resources = new Map<string, ResourceConfig>();
  private readonly fieldLabels: Record<string, string> = {};

  /**
   * 注册单个资源配置。
   * 重复 id 会覆盖（warn 日志）。
   */
  register(id: string, config: ResourceConfig): void {
    if (this.resources.has(id)) {
      console.warn(`[ResourceRegistry] 资源 '${id}' 已注册，将被覆盖。`);
    }
    this.resources.set(id, config);
  }

  /**
   * 批量注册资源配置。
   * entries 格式：Record<string, ResourceConfig>
   */
  registerMany(entries: Record<string, ResourceConfig>): void {
    for (const [id, config] of Object.entries(entries)) {
      this.register(id, config);
    }
  }

  /**
   * 注册字段标签映射。
   * 新标签会合并到已有标签中（同名覆盖）。
   */
  registerFieldLabels(labels: FieldLabels): void {
    Object.assign(this.fieldLabels, labels);
  }

  /**
   * 获取资源配置。
   * 返回 undefined 表示资源不存在。
   */
  get(id: string): ResourceConfig | undefined {
    return this.resources.get(id);
  }

  /**
   * 检查资源是否已注册。
   */
  has(id: string): boolean {
    return this.resources.has(id);
  }

  /**
   * 列出所有已注册的资源 id。
   */
  listIds(): string[] {
    return [...this.resources.keys()];
  }

  /**
   * 列出所有已注册的资源配置。
   */
  listAll(): Array<[string, ResourceConfig]> {
    return [...this.resources.entries()];
  }

  /**
   * 获取所有字段标签。
   */
  getFieldLabels(): Readonly<Record<string, string>> {
    return this.fieldLabels;
  }

  /**
   * 资源总数。
   */
  get size(): number {
    return this.resources.size;
  }
}
