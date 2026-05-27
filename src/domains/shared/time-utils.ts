/**
 * 共享时间工具函数。
 *
 * 统一 translateTimeRangeToIso / formatLocalDate / extractMonthToken，
 * 消除 intent-query-handler.ts / dealer/query-adapter.ts / attendance/query-adapter.ts 中的重复实现。
 */

/**
 * 将中文时间范围描述转换为 ISO 日期字符串（YYYY-MM-DD）。
 * 返回 null 表示无法识别。
 */
export function translateTimeRangeToIso(text: unknown): string | null {
  const input = String(text ?? "");
  const now = new Date();
  if (/本月|这个月/.test(input)) {
    return formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1));
  }
  if (/上月|上个月/.test(input)) {
    return formatLocalDate(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  }
  if (/本周|这周/.test(input)) {
    const d = new Date(now);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return formatLocalDate(d);
  }
  if (/今天|今日/.test(input)) {
    return formatLocalDate(now);
  }
  if (/昨天|昨日/.test(input)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return formatLocalDate(d);
  }
  if (/最近|近期|近来/.test(input)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return formatLocalDate(d);
  }
  if (/近一个月|最近一个月|过去一个月/.test(input)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return formatLocalDate(d);
  }
  if (/近三个月|最近三个月|过去三个月/.test(input)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    return formatLocalDate(d);
  }
  if (/近半年|最近半年/.test(input)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
  }
  const quarterMatch = input.match(/Q([1-4])/i);
  if (quarterMatch) {
    const q = Number(quarterMatch[1]);
    const startMonth = (q - 1) * 3;
    return formatLocalDate(new Date(now.getFullYear(), startMonth, 1));
  }
  return null;
}

/**
 * 将 Date 格式化为本地日期字符串 YYYY-MM-DD。
 */
export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * 从文本中提取月份 token（YYYY-MM 格式）。
 * 支持"本月"、"2025年5月"、"5月"等表达。
 */
export function extractMonthToken(text: unknown): string | null {
  const input = String(text ?? "");
  if (/本月|这个月/.test(input)) return new Date().toISOString().slice(0, 7);
  const explicit = input.match(/(20\d{2})[-年/.](\d{1,2})/);
  if (explicit) return `${explicit[1]}-${String(Number(explicit[2])).padStart(2, "0")}`;
  const monthOnly = input.match(/(\d{1,2})月/);
  if (monthOnly) return `${new Date().getFullYear()}-${String(Number(monthOnly[1])).padStart(2, "0")}`;
  return null;
}
