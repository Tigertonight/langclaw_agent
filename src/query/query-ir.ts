import type {
  QueryEntity,
  QueryFilter,
  QueryIR,
  QueryMetric,
  QuerySort
} from "../types/agent-contracts.js";

export interface CreateQueryIRInput {
  domain: string;
  target: string;
  operation: string;
  entity?: QueryEntity | string | null;
  filters?: QueryFilter[];
  metrics?: QueryMetric[];
  fields?: string[];
  sort?: QuerySort[];
  limit?: number;
  needsClarification?: string | null;
  reason?: string;
}

export function createQueryIR({
  domain,
  target,
  operation,
  entity = null,
  filters = [],
  metrics = [],
  fields = [],
  sort = [],
  limit = 20,
  needsClarification = null,
  reason = ""
}: CreateQueryIRInput): QueryIR {
  return {
    kind: "business_query_ir",
    version: 1,
    domain,
    target,
    operation,
    entity,
    filters,
    metrics,
    fields,
    sort,
    limit,
    needsClarification,
    reason
  };
}
