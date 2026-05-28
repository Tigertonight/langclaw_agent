/**
 * Phase 2.5 — 结构化抽取 prompt 骨架。
 *
 * Engine 拥有 prompt 形态、JSON 契约说明、占位符约定；DomainPack 通过
 * EvolutionExtractionContract 注入业务词表（实体类型 / 谓词 / few-shot）。
 *
 * Prompt 中**完全不硬编码**任何业务词。空词表也能跑通，只是抽取覆盖率会下降。
 */

import type { EvolutionExtractionContract } from "../engine/contracts/evolution-extraction-contract.js";

const BASE_RULES = [
  "你是企业 agent 的 evolution 抽取器，从一段会话 trace 中抽出三类信息：",
  "  1) memory_actions：稳定的用户偏好 / 项目状态 / 反馈 / 程序性知识。",
  "  2) entities：会话里出现的业务实体（客户 / 产品 / 订单等）。",
  "  3) relations：实体之间的事实三元组（subject-predicate-object）。",
  "",
  "硬规则：",
  "- entities[].local_id 是本次 payload 内部的临时占位符，必须唯一；不要带业务系统前缀。",
  "- relations[].subject 和 relations[].object 用 { local_id: \"...\" } 引用本批新实体，",
  "  或用 { full_id: \"...\" } 引用已知实体（id 已包含 business_id 前缀）。",
  "- 一个 relation 必须且只能填 object 或 object_value 之一；object_value 用于字面量（如品牌名）。",
  "- 不要伪造没有证据的实体或关系；不要把一次性查询结果当 memory。",
  "- 不要保存秘钥、口令、个人证件号等敏感信息。",
  "- 仅输出符合下方 JSON schema 的 JSON 对象，不要任何额外解释。"
].join("\n");

const OUTPUT_CONTRACT_HINT = JSON.stringify({
  should_evolve: "boolean",
  confidence: "number 0..1",
  reason: "short string",
  memory_actions: [
    { op: "upsert|remove", type: "preference|fact|procedure|episode|feedback|project|reference|user", key: "stable_snake_case", value: "string", confidence: 0.8 }
  ],
  entities: [
    {
      local_id: "scoped placeholder, e.g. c001",
      type: "from contract.entityTypes (or free-form if empty)",
      name: "string",
      aliases: ["string"],
      external_ids: { crm_id: "C-1001" },
      strong_attributes: { phone: "13800001234" },
      attributes: { city: "Beijing" },
      confidence: 0.8
    }
  ],
  relations: [
    {
      subject: { local_id: "c001" },
      predicate: "from contract.predicates (or free-form if empty)",
      object: { local_id: "p_han_ev" },
      occurred_at: "ISO-8601 datetime, optional",
      confidence: 0.8
    },
    {
      subject: { full_id: "biz1:customer:existing" },
      predicate: "prefers",
      object_value: { brand: "Toyota" }
    }
  ]
}, null, 2);

export interface BuildExtractionPromptOptions {
  contract: EvolutionExtractionContract;
}

/**
 * 拼装 system prompt。Engine 内部使用——上层只需把 contract 传进来。
 */
export function buildExtractionSystemPrompt({ contract }: BuildExtractionPromptOptions): string {
  const sections: string[] = [BASE_RULES];

  if (contract.domainLabel) {
    sections.push(`领域：${contract.domainLabel}`);
  }

  if (contract.entityTypes.length) {
    sections.push(`允许的实体 type 白名单（必须从中选）：\n${listLines(contract.entityTypes)}`);
  } else {
    sections.push("实体 type 白名单未提供，可用通用类型；尽量保持 token 简短稳定。");
  }

  if (contract.predicates.length) {
    sections.push(`允许的 predicate 白名单（必须从中选）：\n${listLines(contract.predicates)}`);
  } else {
    sections.push("predicate 白名单未提供，可用通用动词，但同一会话内保持一致。");
  }

  if (contract.strongAttributeKeys.length) {
    sections.push(
      "实体的 strong_attributes 优先填这些键（用于后续合并去重）："
        + `\n${listLines(contract.strongAttributeKeys)}`
    );
  }

  sections.push(`输出 JSON 形态参考（只是契约说明，不是模板）：\n${OUTPUT_CONTRACT_HINT}`);

  if (contract.fewShotExamples.length) {
    sections.push("Few-shot 示例（仅作风格参考，不要照抄）：");
    for (const ex of contract.fewShotExamples) {
      sections.push(
        `### ${ex.label}\n用户消息：${ex.userMessage}\n助手回答：${ex.assistantAnswer}\n期望抽取：\n${ex.expectedJson}`
      );
    }
  }

  return sections.join("\n\n");
}

function listLines(items: string[]): string {
  return items.map((s) => `- ${s}`).join("\n");
}
