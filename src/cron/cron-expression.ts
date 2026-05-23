/**
 * 极简 cron 表达式解析器，覆盖 5 字段标准 cron：
 *   分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-6, 0=Sun)
 *
 * 支持：
 *   - 数字：5
 *   - 通配：*
 *   - 列表：1,15,30
 *   - 步长：*\/5（每 5 单位） / 0-30/10
 *   - 范围：8-18
 *
 * 不支持（明确不实现，避免半吊子兼容性陷阱）：
 *   - 6 字段（秒级）—— cron 场景下没必要
 *   - 7 字段 quartz —— 没必要
 *   - 命名缩写（@daily / @hourly）—— 不要语法糖
 *   - 月份/星期名缩写（MON、JAN）—— 不要语法糖
 *   - 星期与日同时给（cron OR 语义太坑，本期一律 AND）
 *
 * 复杂场景请用 6 字段 / quartz 风格的库；本项目 cover 90% 用例就够。
 */

interface ParsedField {
  values: Set<number>;
}

export interface CronExpression {
  raw: string;
  minute: ParsedField;
  hour: ParsedField;
  day: ParsedField;
  month: ParsedField;
  weekday: ParsedField;
}

const FIELD_BOUNDS: Array<{ name: keyof CronExpression; min: number; max: number }> = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "weekday", min: 0, max: 6 }
];

export function parseCronExpression(raw: string): CronExpression {
  if (typeof raw !== "string") throw new Error("cron expression must be string");
  const tokens = raw.trim().split(/\s+/);
  if (tokens.length !== 5) {
    throw new Error(`cron expression must have 5 fields (分 时 日 月 周), got ${tokens.length}: ${raw}`);
  }
  const [m, h, d, mo, w] = tokens;
  return {
    raw: raw.trim(),
    minute: parseField(m, FIELD_BOUNDS[0]),
    hour: parseField(h, FIELD_BOUNDS[1]),
    day: parseField(d, FIELD_BOUNDS[2]),
    month: parseField(mo, FIELD_BOUNDS[3]),
    weekday: parseField(w, FIELD_BOUNDS[4])
  };
}

function parseField(token: string, bound: { name: string; min: number; max: number }): ParsedField {
  const values = new Set<number>();
  for (const part of token.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) throw new Error(`empty cron sub-field in ${bound.name}: ${token}`);
    const [rangePart, stepPart] = trimmed.split("/");
    const step = stepPart === undefined ? 1 : parseInt(stepPart, 10);
    if (!Number.isFinite(step) || step <= 0) throw new Error(`invalid step in ${bound.name}: ${trimmed}`);

    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = bound.min;
      end = bound.max;
    } else if (rangePart.includes("-")) {
      const [s, e] = rangePart.split("-");
      start = parseInt(s, 10);
      end = parseInt(e, 10);
    } else {
      start = parseInt(rangePart, 10);
      end = start;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error(`invalid range in ${bound.name}: ${trimmed}`);
    }
    if (start < bound.min || end > bound.max || start > end) {
      throw new Error(`${bound.name} value out of range [${bound.min}-${bound.max}]: ${trimmed}`);
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return { values };
}

/** 判断某一时刻是否匹配该 cron 表达式（精度到分钟） */
export function matchesCron(expr: CronExpression, when: Date): boolean {
  return (
    expr.minute.values.has(when.getMinutes()) &&
    expr.hour.values.has(when.getHours()) &&
    expr.day.values.has(when.getDate()) &&
    expr.month.values.has(when.getMonth() + 1) &&
    expr.weekday.values.has(when.getDay())
  );
}

/**
 * 计算 from 之后（不含）下一次匹配的时刻。
 * 简单实现：从 from+1min 起，逐分钟试探，最多试 366 天 * 24h * 60min = 527040 次。
 * 性能 OK——单次 cron next_run 计算只走十几次或几百次，命中后 break。
 */
export function nextOccurrence(expr: CronExpression, from: Date): Date | null {
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);
  const limit = candidate.getTime() + 366 * 24 * 60 * 60 * 1000;
  while (candidate.getTime() <= limit) {
    if (matchesCron(expr, candidate)) return new Date(candidate.getTime());
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}
