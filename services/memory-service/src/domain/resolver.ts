import { z } from "zod";
import type { EntityDto } from "./entity.js";

// resolve 输入：必须给 type，剩下的 external_ids / attributes / name_hint 至少一个。
export const ResolveRequestSchema = z.object({
  type: z.string().min(1).max(80),
  external_ids: z.record(z.string()).optional(),
  // 强属性（手机 / 邮箱 / 身份证等）。调用方按业务自定 key，命中即得分。
  strong_attributes: z.record(z.string()).optional(),
  name_hint: z.string().min(1).max(200).optional(),
  // 候选列表上限（默认 5），避免一次返回太多
  max_candidates: z.number().int().min(1).max(50).default(5),
  // 自动判定 matched 的最低分（默认 0.8）。低于此分但有候选 → matched=null
  match_threshold: z.number().min(0).max(2).default(0.8)
}).strict().refine(
  (v) => Boolean(v.external_ids || v.strong_attributes || v.name_hint),
  { message: "at least one of external_ids, strong_attributes, or name_hint is required" }
);

export type ResolveRequest = z.infer<typeof ResolveRequestSchema>;

export interface ResolveCandidate {
  entity: EntityDto;
  score: number;
  reasons: string[];
}

export interface ResolveResult {
  matched: EntityDto | null;
  candidates: ResolveCandidate[];
}
