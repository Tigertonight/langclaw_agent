/**
 * Attendance 考勤域 DomainPack。
 *
 * 聚合 attendance 域的所有声明式配置：资源、确定性规则、extractors、
 * filter transforms、字段标签、查询适配器、intent code 映射、工具标签、
 * 场景注册、权限规则等。
 */

import type { DomainPack, SkillMappingDefinition, IntentCodeInferenceFn } from "../types.js";
import { ATTENDANCE_RESOURCES, ATTENDANCE_FIELD_LABELS } from "./resources.js";
import { ATTENDANCE_DETERMINISTIC_RULES, ATTENDANCE_EXTRACTORS } from "./deterministic-rules.js";
import { ATTENDANCE_FILTER_TRANSFORMS } from "./filter-transforms.js";
import { attendanceQueryAdapter } from "./query-adapter.js";
import { LeaveRequestScenario } from "./leave-request-scenario.js";
import { createLeaveRequestTools } from "./tools.js";
import { registerComponentMapping } from "../../openui-lang/compat.js";
import { leaveRecordsSkillContractEnforcer } from "./skill-contracts.js";
import { leaveRequestPlugin } from "./surfaces/leave-request.js";

export const attendancePack: DomainPack = {
  id: "attendance",
  name: "考勤域",
  version: "1.0.0",
  conflictPolicy: "error",
  description: "请假申请、请假记录查询等考勤相关业务。",

  resources: ATTENDANCE_RESOURCES,
  deterministicRules: ATTENDANCE_DETERMINISTIC_RULES,
  extractors: ATTENDANCE_EXTRACTORS,
  filterTransforms: ATTENDANCE_FILTER_TRANSFORMS,
  fieldLabels: ATTENDANCE_FIELD_LABELS,
  queryAdapters: [attendanceQueryAdapter],
  tools: createLeaveRequestTools(),
  intentDir: "data/domains/attendance/intent-codes",

  // ── intent code 映射 ──
  intentCodeMappings: {
    leave_requests: "attendance.leave_query",
  },

  // ── intent ↔ intentCode 双向映射 ──
  intentMappings: {
    leave_request: "workflow.leave_request",
  },

  // ── 工具标签 ──
  toolLabels: {
    submit_leave_request: "提交请假",
  },

  // ── 取消请假流程的领域专属短语 ──
  cancellationPhrases: ["不请假了", "先不请假了", "不用请假了"],

  // ── fact key 映射 ──
  factKeyMappings: {},

  // ── 查询 schema ──
  querySchemas: {
    leave_requests: {
      entity: "leave_request",
      fields: ["id", "applicant_user_id", "applicant_name", "department", "leave_type", "leave_duration", "start_time", "end_time", "reason", "status", "submitted_at"],
      defaultFields: ["id", "applicant_name", "leave_type", "leave_duration", "start_time", "end_time", "reason", "status", "submitted_at"],
      defaultSort: [{ field: "submitted_at", direction: "desc" }],
    },
  },

  // ── skill mappings ──
  skillMappings: [
    {
      matches: (intentCode) => intentCode === "attendance.leave_query",
      skillId: "leave-records",
    } satisfies SkillMappingDefinition,
  ],

  // ── slot update 检测器 ──
  slotUpdateDetectors: {
    leave_request: (message: string) => {
      if (/(怎么|如何|制度|政策|流程|规则|标准|说明|问下|了解)/.test(message)) return false;
      return /(年假|病假|事假|调休|前天|昨天|明天|后天|今天|上午|下午|晚上|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./月]\d{1,2}(?:日|号)?|半天|一天|两天|三天|四天|五天|小时|因为|原因是|事由是|家里有事|身体不舒服|去医院|去看了医生|去看医生|看医生)/.test(message);
    },
  },

  // ── skill contract enforcers ──
  skillContractEnforcers: [leaveRecordsSkillContractEnforcer],

  // ── intent code 推断函数 ──
  intentCodeInferenceFns: [
    ((message: string) => {
      if (/(请假记录|请假历史|请假情况|请假数据|请假统计|休假记录|休假历史|休假情况|休假数据|休假统计|多少次假|我的请假|最近.*请假|谁请假|哪些人请假|哪些员工请假|团队请假|部门请假)/.test(message)) return "attendance.leave_query";
      return null;
    }) satisfies IntentCodeInferenceFn,
  ],

  // ── 路由提示词片段 ──
  routerPromptHints: [
    "leave_request 表示用户想办理/提交/发起请假申请，例如：我要请个假、帮我请假、明天休假、想走个假勤。",
    "如果用户是查看请假记录、请假历史、我的请假、我请了几次假、谁请假了、最近请假的同学，这些都走 attendance.leave_query，不要走 workflow.leave_request。",
    "如果用户是在查询自己的请假记录、请假历史、请假次数，例如：查看我的请假记录、我这个月请了几次假，这属于 data_query，不是 leave_request。",
  ],

  // ── 分类器意图声明 ──
  classifierIntents: {
    leave_request: "表示用户想办理/提交/发起请假申请，例如：我要请个假、帮我请假、明天休假。",
  },

  // ── data_query 描述关键词 ──
  dataQueryKeywords: ["请假记录", "休假记录", "请假历史"],

  // ── 本地分类关键词 ──
  classificationKeywords: {
    leave_request: ["请假", "休假", "年假", "病假", "事假", "调休"],
  },

  // ── 本地分类正则模式 ──
  classificationPatterns: {
    leave_request: [/(请|休|申请|办)(个|一下|一会儿|半天|一天|几天)?假/],
  },

  // ── 能力描述 ──
  capabilityDescriptions: ["办理请假申请", "查询请假记录"],

  // ── 独立任务关键词 ──
  standaloneTaskKeywords: ["请假", "休假", "年假", "病假", "事假", "调休"],

  // ── OpenUI Lang surface 插件 ──
  surfacePlugins: [leaveRequestPlugin],

  // ── 前端组件渲染器 ──
  chatPageRenderers: [
    {
      name: "LeaveRequestForm",
      code: `(function(surface, props) {
      var missing = Array.isArray(props.missing_slots) ? props.missing_slots : [];
      var subtitle = props.step === "completed" ? "已提交"
        : props.step === "awaiting_confirmation" ? "确认以下请假信息后提交"
        : missing.length ? "请补全以下信息" : "信息已完整，可继续确认提交";
      var card = materialCard("请假申请", subtitle);
      var form = renderOpenUILangForm(props.form, surface);
      if (form) card.appendChild(form);
      return card;
    })`,
    },
  ],

  // ── 权限规则 ──
  permissionRules: [
    (input) => {
      if (input.resource !== "leave_requests") return null;
      if (input.userPermissions.has("leave:submit") || input.userPermissions.has("leave:read")) return { ok: true };
      return null;
    },
  ],

  // ── 本地 LLM 启发式：MIXED 意图下触发知识检索的考勤相关关键词 ──
  knowledgeRetrievalKeywords: ["报销", "试用期", "年假", "病假"],

  // ── 本地 LLM 启发式：知识库重要句关键词（考勤/HR 类） ──
  importantSentenceKeywords: ["报销", "试用期", "年假", "审批"],

  // ── 本地 LLM 启发式：知识库 chunk heading 命中规则（考勤/HR 类） ──
  knowledgeChunkHeadingHints: [
    { questionKeyword: "标准", matchHeadings: ["标准", "住宿标准", "交通标准"] },
    { questionKeyword: "时限", matchHeadings: ["时限", "提交时限"] },
    { questionKeyword: "审批", matchHeadings: ["审批", "合同审批"] },
    { questionKeyword: "试用期", matchHeadings: ["试用期"] },
    { questionKeyword: "年假", matchHeadings: ["年假"] },
  ],

  // ── 本地 LLM 启发式：把"请假制度/规则"类问题归到 KNOWLEDGE_QA ──
  localPolicyQuestionPatterns: [
    {
      id: "attendance.leave_policy",
      reason: "询问请假制度或办理规则",
      matches(question: string): boolean {
        const text = String(question ?? "");
        const mentionsLeave = /(请假|休假|事假|病假|年假|调休|产假)/.test(text);
        const asksAboutPolicy = /(制度|政策|规定|流程|怎么办|如何|多少天|几天|审批|批准|可以请|能请|申请条件|条件|资格|规则)/.test(text);
        return mentionsLeave && asksAboutPolicy;
      },
    },
  ],

  // ── 场景注册（通过 register() 逃生口） ──
  register(ctx) {
    ctx.scenarioRouter.register("leave_request", new LeaveRequestScenario({ toolRegistry: ctx.toolRegistry }));
    // 注册 Surface 组件映射
    registerComponentMapping("leave_request_form", "LeaveRequestForm");
  },
};
