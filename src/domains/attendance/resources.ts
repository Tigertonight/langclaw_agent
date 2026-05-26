/**
 * Attendance 业务域资源定义。
 *
 * Attendance 域资源配置（leave_requests）。
 * 数据文件路径保持不变（兼容期不迁移数据目录）。
 */

import type { ResourceConfig } from "../../resources/types.js";
import type { FieldLabels } from "../../resources/types.js";
import { normalizeLeaveRequestRecord } from "./tools.js";

type DataRow = Record<string, unknown>;

/**
 * Attendance 域资源配置。
 */
export const ATTENDANCE_RESOURCES: Record<string, ResourceConfig> = {
  leave_requests: {
    file: "data/leave-requests.json",
    scopeType: "self_user",
    selfUserIdField: "applicant_user_id",
    selfUserNameField: "applicant_name",
    factKey: "business_status",
    fields: [
      "id",
      "applicant_user_id",
      "applicant_name",
      "department",
      "leave_type",
      "leave_duration",
      "start_time",
      "end_time",
      "reason",
      "status",
      "submitted_at",
    ],
    domain: "attendance",
    label: "请假记录",
    displayColumns: [
      ["applicant_name", "员工"],
      ["leave_type", "类型"],
      ["leave_duration", "时长"],
      ["start_time", "开始时间"],
      ["end_time", "结束时间"],
      ["status", "状态"],
      ["reason", "事由"],
    ],
    debugFields: ["id", "applicant_name", "leave_type", "leave_duration", "start_time", "end_time", "status"],
    rowTemplate: (row: DataRow) => {
      return `- ${row.applicant_name ?? "未知员工"}：${row.leave_type ?? "请假"} ${row.leave_duration ?? ""}，${row.start_time ?? ""} 至 ${row.end_time ?? ""}（${row.status ?? "未知状态"}，${row.reason ?? "未填写事由"}）`;
    },
    normalizer: normalizeLeaveRequestRecord,
    schema: {
      id: "请假单号",
      applicant_user_id: "申请人工号",
      applicant_name: "申请人",
      department: "部门",
      leave_type: { type: "string", description: "请假类型", enum: ["年假", "事假", "病假", "调休", "婚假", "产假", "陪产假"] },
      leave_duration: "请假时长",
      start_time: { type: "date", description: "开始时间" },
      end_time: { type: "date", description: "结束时间" },
      reason: "请假理由",
      status: { type: "string", description: "状态", enum: ["待审批", "已批准", "已拒绝", "已撤回"] },
      submitted_at: { type: "date", description: "提交时间" },
    },
  },
};

/**
 * Attendance 域字段标签。
 */
export const ATTENDANCE_FIELD_LABELS: FieldLabels = {
  applicant_user_id: "申请人工号",
  applicant_name: "申请人",
  leave_type: "请假类型",
  leave_duration: "请假时长",
  start_time: "开始时间",
  end_time: "结束时间",
  reason: "请假理由",
  submitted_at: "提交时间",
};
