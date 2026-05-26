/**
 * Attendance 域工具定义。
 *
 * 包含 submit_leave_request 工具及其辅助函数。
 * 从 src/tools/business-tools.ts 迁移而来。
 */

import { loadJson, saveJson, resolveProjectPath } from "../../data/load-json.js";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { JsonObject, JsonValue, ToolDefinition } from "../../types/agent-contracts.js";
import { defineTool, z, ToolResultBaseSchema } from "../../tools/zod-helpers.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface LeaveTimeRange {
  startTime?: string | null;
  endTime?: string | null;
  leaveDuration?: string | null;
}

type DataRow = Record<string, unknown>;

interface BusinessToolContext {
  user: {
    id: string;
    name?: string;
    department?: string;
    permissions?: string[];
    accessible_customer_ids?: string[];
  };
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

export function createLeaveRequestTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "submit_leave_request",
      description: "提交员工请假申请，需要请假类型、开始时间、结束时间和请假事由。",
      metadata: {
        required_permissions: ["leave:submit"],
        risk_level: "write",
        requires_confirmation: true,
        scenarios: ["leave_request"],
        steps: ["awaiting_confirmation"]
      },
      inputSchema: z.object({
        leave_type: z.enum(["年假", "病假", "事假", "调休", "其他"]),
        start_time: z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/, "format YYYY-MM-DD or YYYY-MM-DD HH:MM"),
        end_time: z.string().regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/, "format YYYY-MM-DD or YYYY-MM-DD HH:MM"),
        reason: z.string().min(1).max(500)
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const user = (context as BusinessToolContext).user;
        const request = normalizeLeaveRequestRecord({
          id: `LR-${Date.now()}`,
          applicant_user_id: user.id,
          applicant_name: user.name,
          department: user.department,
          leave_duration: inferLeaveDuration(args as JsonObject),
          status: "submitted",
          ...(args as JsonObject),
          submitted_at: new Date().toISOString()
        });
        const tableFile = "data/leave-requests.json";
        const existing = await loadJson(tableFile).catch((): DataRow[] => []) as DataRow[];
        await saveJson(tableFile, existing.concat(request).map(normalizeLeaveRequestRecord) as unknown as JsonValue);
        const dir = resolveProjectPath("logs");
        await mkdir(dir, { recursive: true });
        await appendFile(path.join(dir, "leave_requests.jsonl"), `${JSON.stringify(request)}\n`, "utf8");
        return {
          ok: true,
          tool: "submit_leave_request",
          data: request as JsonObject
        };
      }
    })
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inferLeaveDuration(args: JsonObject): string {
  if (args.leave_duration) return String(args.leave_duration);
  const text = `${args.start_time ?? ""} ${args.end_time ?? ""} ${args.reason ?? ""}`;
  const matched = text.match(/(半天|一天|两天|三天|四天|五天|[一二三四五六七八九十\d]+天|[一二三四五六七八九十\d]+小时)/);
  if (matched) return matched[1];
  if (String(args.end_time ?? "").startsWith("开始后")) {
    return String(args.end_time).replace(/^开始后/, "");
  }
  return "待补充";
}

export function normalizeLeaveRequestRecord(record: DataRow): DataRow {
  const startTime = normalizeLeaveDateTime(record.start_time, { fallbackTime: "09:00" });
  const endTime = normalizeLeaveEndTime(record.end_time, { startTime, leaveDuration: record.leave_duration === undefined ? undefined : String(record.leave_duration) });
  return {
    ...record,
    leave_duration: normalizeLeaveDuration(record.leave_duration, { startTime, endTime }),
    start_time: startTime,
    end_time: endTime
  };
}

function normalizeLeaveDuration(value: unknown, { startTime, endTime }: LeaveTimeRange = {}): string {
  const text = String(value ?? "").trim();
  if (text === "半天") return "半天";
  if (["一天", "1天"].includes(text)) return "1天";
  const dayMatch = text.match(/^([一二三四五六七八九十两\d]+)天$/);
  if (dayMatch) return `${parseChineseNumber(dayMatch[1]) ?? dayMatch[1]}天`;
  const hourMatch = text.match(/^([一二三四五六七八九十两\d]+)小时$/);
  if (hourMatch) return `${parseChineseNumber(hourMatch[1]) ?? hourMatch[1]}小时`;
  if (startTime && endTime) {
    const inferred = inferDurationFromRange(startTime, endTime);
    if (inferred) return inferred;
  }
  return text || "待补充";
}

function normalizeLeaveDateTime(value: unknown, { fallbackTime = "09:00" }: { fallbackTime?: string } = {}): string {
  const text = String(value ?? "").trim();
  if (!text) return text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} ${fallbackTime}`;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}$/.test(text)) return normalizeMinutePrecision(text);
  const sameDayHalf = text.match(/^(\d{4}-\d{2}-\d{2})\s+半天$/);
  if (sameDayHalf) return `${sameDayHalf[1]} 09:00`;
  return text;
}

function normalizeLeaveEndTime(value: unknown, { startTime, leaveDuration }: LeaveTimeRange = {}): string {
  const text = String(value ?? "").trim();
  if (!text && startTime && leaveDuration) return deriveEndTimeFromDuration(startTime, leaveDuration);
  if (/^\d{4}-\d{2}-\d{2}\s+全天$/.test(text)) {
    const date = text.replace(/\s+全天$/, "");
    return `${date} 18:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 18:00`;
  if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}$/.test(text)) return normalizeMinutePrecision(text);
  if (text.startsWith("开始后") && startTime) {
    return deriveEndTimeFromDuration(startTime, text.replace(/^开始后/, ""));
  }
  return text;
}

function deriveEndTimeFromDuration(startTime: string, leaveDuration: string): string {
  const start = parseDateTime(startTime);
  if (!start) return "";
  const duration = normalizeLeaveDuration(leaveDuration);
  if (duration === "半天") {
    const end = new Date(start);
    end.setHours(start.getHours() + 4, 0, 0, 0);
    return formatDateTime(end);
  }
  const dayMatch = duration.match(/^(\d+)天$/);
  if (dayMatch) {
    const end = new Date(start);
    end.setDate(end.getDate() + Number(dayMatch[1]) - 1);
    end.setHours(18, 0, 0, 0);
    return formatDateTime(end);
  }
  const hourMatch = duration.match(/^(\d+)小时$/);
  if (hourMatch) {
    const end = new Date(start);
    end.setHours(end.getHours() + Number(hourMatch[1]), 0, 0, 0);
    return formatDateTime(end);
  }
  return "";
}

function inferDurationFromRange(startTime: string, endTime: string): string | null {
  const start = parseDateTime(startTime);
  const end = parseDateTime(endTime);
  if (!start || !end) return null;
  const diffHours = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60));
  if (diffHours === 4) return "半天";
  if (diffHours === 9) return "1天";
  if (diffHours > 0 && diffHours < 9) return `${diffHours}小时`;
  if (diffHours >= 9) {
    const days = Math.max(1, Math.round(diffHours / 9));
    return `${days}天`;
  }
  return null;
}

function parseDateTime(value: unknown): Date | null {
  const normalized = String(value ?? "").trim().replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function normalizeMinutePrecision(value: unknown): string {
  const [datePart, timePart] = String(value).trim().split(/\s+/);
  const [hour, minute] = timePart.split(":");
  return `${datePart} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseChineseNumber(text: unknown): number | null {
  if (/^\d+$/.test(String(text))) return Number(text);
  return {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10
  }[String(text)] ?? null;
}
