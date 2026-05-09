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
}) {
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
