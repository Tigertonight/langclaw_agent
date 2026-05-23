import type { JsonObject } from "../../types/agent-contracts.js";
import type { A2UIComponentInstance } from "../types.js";

export function card(id: string, children: string[]): A2UIComponentInstance {
  return { id, component: { Card: { children } } };
}

export function row(id: string, children: string[]): A2UIComponentInstance {
  return { id, component: { Row: { children } } };
}

export function list(id: string, children: string[]): A2UIComponentInstance {
  return { id, component: { List: { children } } };
}

export function text(id: string, value: string): A2UIComponentInstance {
  return { id, component: { Text: { text: { literalString: value } } } };
}

export function button(id: string, label: string, actionName: string, context: JsonObject): A2UIComponentInstance {
  return {
    id,
    component: {
      Button: {
        text: { literalString: label },
        action: {
          event: {
            name: actionName,
            context
          }
        }
      }
    }
  };
}

export function formatCurrency(value: unknown): string {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return "-";
  return `${Math.round(amount).toLocaleString("zh-CN")} 元`;
}

export function toRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

export function readArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(toRecord).filter((item): item is JsonObject => Boolean(item)) : [];
}

export function readArrayLike(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")).filter(Boolean) : [];
}

export function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

/** 安全的链式取值：任意一段 undefined/null/非 object 都返回 undefined，不抛错。 */
export function readPath(value: unknown, path: (string | number)[]): unknown {
  let cursor: unknown = value;
  for (const key of path) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof key === "number") {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[key];
    } else {
      const record = toRecord(cursor);
      if (!record) return undefined;
      cursor = record[key];
    }
  }
  return cursor;
}

/** 任意路径取一组数组项，路径不通时返回 []，避免 undefined 崩溃。 */
export function readPathArray(value: unknown, path: (string | number)[]): JsonObject[] {
  return readArray(readPath(value, path));
}

export function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
