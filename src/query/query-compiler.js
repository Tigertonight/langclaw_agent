import { getDepartmentTreeIds, resolveEntities } from "./entity-resolver.js";
import { QUERY_OPERATIONS, RESOURCE_SCHEMAS } from "./schema-catalog.js";

export async function compileBusinessQueryIR(ir, { question } = {}) {
  if (!ir) return { calls: [] };
  if (ir.needsClarification) {
    return { calls: [], clarification: ir.needsClarification, ir };
  }

  const normalizedIR = await normalizeIRForCompilation(ir, { question });
  const args = await compileArgs(normalizedIR);
  return {
    calls: [{ name: "query_business_data", args }],
    ir: normalizedIR
  };
}

async function normalizeIRForCompilation(ir, { question } = {}) {
  const operation = normalizeOperationForQuestion(ir.operation, question);
  const entityName = typeof ir.entity === "string" ? ir.entity : ir.entity?.name;
  if (ir.target === "employees" && entityName) {
    const entities = await resolveEntities(entityName);
    if (entities.department) {
      return {
        ...ir,
        operation,
        entity: {
          ...entities.department,
          include_children: true
        },
        filters: hasDepartmentFilter(ir.filters)
          ? ir.filters
          : [{ field: "department", op: "in_department_tree", value: entities.department.id }],
        limit: ir.limit && ir.limit > 0 ? ir.limit : 100
      };
    }
  }
  if (ir.target === "employees" && !hasDepartmentFilter(ir.filters) && question) {
    const entities = await resolveEntities(question);
    if (entities.department) {
      return {
        ...ir,
        operation,
        entity: {
          ...entities.department,
          include_children: true
        },
        filters: [{ field: "department", op: "in_department_tree", value: entities.department.id }],
        limit: ir.limit && ir.limit > 0 ? ir.limit : 100
      };
    }
  }
  return {
    ...ir,
    operation,
    limit: ir.limit && ir.limit > 0 ? ir.limit : defaultLimitForTarget(ir.target, ir.operation)
  };
}

async function compileArgs(ir) {
  const schema = RESOURCE_SCHEMAS[ir.target];
  if (!schema) {
    throw new Error(`Unknown query target: ${ir.target}`);
  }

  const filters = await compileFilters(ir);
  const operation = ir.operation === QUERY_OPERATIONS.AGGREGATE ? QUERY_OPERATIONS.AGGREGATE : QUERY_OPERATIONS.SEARCH;
  return {
    resource: ir.target,
    operation,
    filters,
    metrics: operation === QUERY_OPERATIONS.AGGREGATE ? normalizeMetrics(ir, schema) : [],
    fields: ir.fields?.length ? ir.fields : schema.defaultFields,
    sort: ir.sort?.length ? ir.sort : schema.defaultSort,
    limit: ir.limit ?? 20,
    display: compileDisplay(ir)
  };
}

async function compileFilters(ir) {
  const compiled = [];
  const filters = ir.filters ?? [];
  for (const filter of filters) {
    if (filter.op === "in_department_tree") {
      compiled.push({
        field: filter.field,
        op: "in",
        value: await getDepartmentTreeIds(filter.value)
      });
      continue;
    }
    compiled.push(filter);
  }
  if (ir.target === "employees" && compiled.length === 0 && ir.entity?.type === "department" && ir.entity?.name) {
    const entities = await resolveEntities(ir.entity.name);
    if (entities.department) {
      compiled.push({
        field: "department",
        op: "in",
        value: await getDepartmentTreeIds(entities.department.id)
      });
    }
  }
  return compiled;
}

function normalizeMetrics(ir, schema) {
  if (ir.metrics?.length) return ir.metrics;
  if (schema.entity === "leave_request") {
    return [{ type: "count", field: "id", as: "leave_request_count" }];
  }
  if (schema.entity === "dealer_metric") {
    return [{ type: "count", field: "id", as: "dealer_metric_count" }];
  }
  const field = schema.entity === "employee" ? "userid" : "id";
  return [{ type: "count", field, as: `${schema.entity}_count` }];
}

function hasDepartmentFilter(filters = []) {
  return filters.some((filter) => filter.field === "department" || filter.field === "department_name" || filter.op === "in_department_tree");
}

function defaultLimitForTarget(target, operation) {
  if (operation === QUERY_OPERATIONS.AGGREGATE) return 20;
  if (target === "dealer_metrics") return 50;
  if (target === "employees" || target === "departments") return 100;
  return 20;
}

function normalizeOperationForQuestion(operation, question) {
  const text = String(question ?? "");
  if (/(都谁|谁在|哪些人|有哪些人|都有谁|名单|列表)/.test(text)) return QUERY_OPERATIONS.SEARCH;
  if (operation !== QUERY_OPERATIONS.SEARCH && /(多少|几个|人数|数量|总数|统计)/.test(text)) return QUERY_OPERATIONS.AGGREGATE;
  return operation;
}

function compileDisplay(ir) {
  return {
    domain: ir.domain,
    target: ir.target,
    operation: ir.operation,
    entity_type: ir.entity?.type,
    entity_name: ir.entity?.name,
    include_children: ir.entity?.include_children === true,
    reason: ir.reason
  };
}
