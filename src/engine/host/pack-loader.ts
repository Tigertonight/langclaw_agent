/**
 * Engine Host: Pack Loader
 *
 * DomainPack 加载与验证。
 * 负责：
 * 1. 调用 discoverDomainPacks() 自动发现 DomainPack
 * 2. 校验 engineApiVersion 兼容性
 * 3. 生成加载诊断报告
 */

import { ENGINE_API_VERSION } from "../contracts/domain-pack.js";
import type { DomainPack } from "../contracts/domain-pack.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PackLoadDiagnostic {
  packId: string;
  packName: string;
  packVersion: string;
  engineApiVersion: string | undefined;
  status: "ok" | "skipped" | "error";
  message?: string;
}

export interface PackLoadResult {
  /** 成功加载的 DomainPack 列表 */
  packs: DomainPack[];
  /** 每个 pack 的加载诊断 */
  diagnostics: PackLoadDiagnostic[];
}

// ─── Version Compatibility ───────────────────────────────────────────────────

/**
 * 简易 semver 兼容性检查。
 *
 * 支持的 range 格式：
 * - "^1.0.0" → 兼容 1.x.x（major 相同）
 * - ">=1.0.0 <2.0.0" → 范围检查
 * - "~1.2.0" → 兼容 1.2.x（major.minor 相同）
 * - "1.0.0" → 精确匹配 major.minor（patch 可以更高）
 * - undefined → 视为兼容
 */
export function isVersionCompatible(
  declaredRange: string | undefined,
  currentVersion: string,
): boolean {
  if (!declaredRange) return true;

  const current = parseSemver(currentVersion);
  if (!current) return true; // 无法解析当前版本，放行

  const trimmed = declaredRange.trim();

  // ^major.minor.patch — 同 major 即兼容
  if (trimmed.startsWith("^")) {
    const target = parseSemver(trimmed.slice(1));
    if (!target) return true;
    return current.major === target.major && compareSemver(current, target) >= 0;
  }

  // ~major.minor.patch — 同 major.minor 即兼容
  if (trimmed.startsWith("~")) {
    const target = parseSemver(trimmed.slice(1));
    if (!target) return true;
    return (
      current.major === target.major &&
      current.minor === target.minor &&
      compareSemver(current, target) >= 0
    );
  }

  // >=x.y.z <a.b.c — 范围检查
  const rangeMatch = trimmed.match(/^>=\s*(\S+)\s+<\s*(\S+)$/);
  if (rangeMatch) {
    const lower = parseSemver(rangeMatch[1]);
    const upper = parseSemver(rangeMatch[2]);
    if (!lower || !upper) return true;
    return compareSemver(current, lower) >= 0 && compareSemver(current, upper) < 0;
  }

  // 精确版本 — major.minor 匹配，patch 可以更高
  const exact = parseSemver(trimmed);
  if (exact) {
    return (
      current.major === exact.major &&
      current.minor === exact.minor &&
      current.patch >= exact.patch
    );
  }

  // 无法解析 range，放行
  return true;
}

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(version: string): SemverParts | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function compareSemver(a: SemverParts, b: SemverParts): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

// ─── Pack Loader ─────────────────────────────────────────────────────────────

/**
 * 验证并过滤 DomainPack 列表。
 *
 * 对每个 pack 检查 engineApiVersion 兼容性：
 * - 兼容 → 保留
 * - 不兼容 → 跳过并记录诊断
 * - 未声明 → 视为兼容（向后兼容）
 */
export function validateAndFilterPacks(packs: DomainPack[]): PackLoadResult {
  const diagnostics: PackLoadDiagnostic[] = [];
  const accepted: DomainPack[] = [];

  for (const pack of packs) {
    const compatible = isVersionCompatible(pack.engineApiVersion, ENGINE_API_VERSION);

    if (compatible) {
      accepted.push(pack);
      diagnostics.push({
        packId: pack.id,
        packName: pack.name,
        packVersion: pack.version ?? "0.0.0",
        engineApiVersion: pack.engineApiVersion,
        status: "ok",
      });
    } else {
      diagnostics.push({
        packId: pack.id,
        packName: pack.name,
        packVersion: pack.version ?? "0.0.0",
        engineApiVersion: pack.engineApiVersion,
        status: "skipped",
        message: `engineApiVersion '${pack.engineApiVersion}' 与当前 Engine API ${ENGINE_API_VERSION} 不兼容`,
      });
      console.warn(
        `[PackLoader] 跳过 domain '${pack.id}': engineApiVersion '${pack.engineApiVersion}' 与 Engine API ${ENGINE_API_VERSION} 不兼容。`
      );
    }
  }

  return { packs: accepted, diagnostics };
}

/**
 * 发现、验证并加载所有 DomainPack。
 *
 * 流程：
 * 1. 调用 discoverDomainPacks() 自动发现
 * 2. 校验 engineApiVersion 兼容性
 * 3. 返回加载结果和诊断
 */
export async function loadDomainPacks(): Promise<PackLoadResult> {
  const { discoverDomainPacks } = await import("../../domains/available-packs.js");
  const discovered = await discoverDomainPacks();
  return validateAndFilterPacks(discovered);
}

/**
 * 格式化加载诊断为可读字符串（用于日志/调试输出）。
 */
export function formatDiagnostics(diagnostics: PackLoadDiagnostic[]): string {
  const lines = [
    `[PackLoader] Engine API Version: ${ENGINE_API_VERSION}`,
    `[PackLoader] Loaded ${diagnostics.filter((d) => d.status === "ok").length}/${diagnostics.length} domain packs:`,
  ];
  for (const d of diagnostics) {
    const icon = d.status === "ok" ? "✓" : d.status === "skipped" ? "⊘" : "✗";
    const version = d.engineApiVersion ?? "(unset)";
    const suffix = d.message ? ` — ${d.message}` : "";
    lines.push(`  ${icon} ${d.packId} v${d.packVersion} [engine: ${version}]${suffix}`);
  }
  return lines.join("\n");
}
