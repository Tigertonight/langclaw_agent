import { getDepartmentTreeIds, resolveEntities } from "./entity-resolver.js";
import { QUERY_OPERATIONS, RESOURCE_SCHEMAS, type ResourceSchema } from "./schema-catalog.js";
import type {
  BusinessQueryArgs,
  CompiledBusinessQuery,
  QueryDisplay,
  QueryFilter,
  QueryIR,
  QueryMetric,
  QuerySort
} from "../types/agent-contracts.js";

interface CompileBusinessQueryInput {
  question?: string;
}

const resourceSchemas = RESOURCE_SCHEMAS;
const queryOperations = QUERY_OPERATIONS;

export async function compileBusinessQueryIR(
  ir: QueryIR | null | undefined,
  { question }: CompileBusinessQueryInput = {}
): Promise<CompiledBusinessQuery> {
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

async function normalizeIRForCompilation(
  ir: QueryIR,
  { question }: CompileBusinessQueryInput = {}
): Promise<QueryIR> {
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

async function compileArgs(ir: QueryIR): Promise<BusinessQueryArgs> {
  const schema = resourceSchemas[ir.target];
  if (!schema) {
    throw new Error(`Unknown query target: ${ir.target}`);
  }

  const filters = await compileFilters(ir);
  const operation = ir.operation === queryOperations.AGGREGATE ? queryOperations.AGGREGATE : queryOperations.SEARCH;
  return {
    resource: ir.target,
    operation,
    filters,
    metrics: operation === queryOperations.AGGREGATE ? normalizeMetrics(ir, schema) : [],
    fields: ir.fields?.length ? ir.fields : schema.defaultFields,
    sort: ir.sort?.length ? ir.sort : schema.defaultSort,
    limit: ir.limit ?? 20,
    display: compileDisplay(ir)
  };
}

async function compileFilters(ir: QueryIR): Promise<QueryFilter[]> {
  const compiled: QueryFilter[] = [];
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
  if (ir.target === "employees" && compiled.length === 0 && typeof ir.entity !== "string" && ir.entity?.type === "department" && ir.entity?.name) {
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

function normalizeMetrics(ir: QueryIR, schema: ResourceSchema): QueryMetric[] {
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

function hasDepartmentFilter(filters: QueryFilter[] = []): boolean {
  return filters.some((filter) => filter.field === "department" || filter.field === "department_name" || filter.op === "in_department_tree");
}

function defaultLimitForTarget(target: string, operation: string): number {
  if (operation === queryOperations.AGGREGATE) return 20;
  if (target === "dealer_metrics") return 50;
  if (target === "employees" || target === "departments") return 100;
  return 20;
}

function normalizeOperationForQuestion(operation: string, question?: string): string {
  const text = String(question ?? "");
  if (/(都谁|谁在|哪些人|有哪些人|都有谁|名单|列表)/.test(text)) return queryOperations.SEARCH;
  if (operation !== queryOperations.SEARCH && /(多少|几个|人数|数量|总数|统计)/.test(text)) return queryOperations.AGGREGATE;
  return operation;
}

function compileDisplay(ir: QueryIR): QueryDisplay {
  const entity = typeof ir.entity === "string" ? undefined : ir.entity;
  return {
    domain: ir.domain,
    target: ir.target,
    operation: ir.operation,
    entity_type: entity?.type,
    entity_name: entity?.name,
    include_children: entity?.include_children === true,
    reason: ir.reason
  };
}
