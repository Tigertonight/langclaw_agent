import { loadJson } from "../data/load-json.js";
import { getResourceDataPath, getEntityAliases, getEntityAliasSuffixRules } from "../domains/runtime-registry.js";
import type { JsonObject, JsonValue, QueryEntity } from "../types/agent-contracts.js";

interface HistoryItem {
  text?: string;
}

interface CustomerRecord extends JsonObject {
  id: string;
  name: string;
}

interface EmployeeRecord extends JsonObject {
  userid: string;
  name: string;
}

interface DepartmentRecord extends JsonObject {
  id: string | number;
  name: string;
  parentid?: string | number;
}

interface ResolvedEntity extends QueryEntity {
  id?: string;
  name?: string;
  row: JsonObject;
}

export interface ResolvedEntities {
  customer: ResolvedEntity | null;
  employee: ResolvedEntity | null;
  department: ResolvedEntity | null;
}

export async function resolveEntities(question: string, history: HistoryItem[] = []): Promise<ResolvedEntities> {
  const [customers, employees, departments] = await Promise.all([
    loadJson<CustomerRecord[]>(getResourceDataPath("customers") ?? "data/customers.json"),
    loadJson<EmployeeRecord[]>(getResourceDataPath("employees") ?? "data/wecom-users.json"),
    loadJson<DepartmentRecord[]>(getResourceDataPath("departments") ?? "data/wecom-departments.json")
  ]);

  return {
    customer: resolveCustomer(question, history, customers),
    employee: resolveEmployee(question, employees),
    department: resolveDepartment(question, departments)
  };
}

export async function getDepartmentTreeIds(rootId: JsonValue | undefined): Promise<number[]> {
  const departments = await loadJson<DepartmentRecord[]>(getResourceDataPath("departments") ?? "data/wecom-departments.json");
  const ids = new Set<number>([Number(rootId)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const department of departments) {
      if (ids.has(Number(department.parentid)) && !ids.has(Number(department.id))) {
        ids.add(Number(department.id));
        changed = true;
      }
    }
  }
  return [...ids];
}

function resolveCustomer(
  question: string,
  history: HistoryItem[],
  customers: CustomerRecord[]
): ResolvedEntity | null {
  const direct = customers.find((customer) => question.includes(customer.name));
  if (direct) return { type: "customer", id: direct.id, name: direct.name, row: direct };

  if (!/(它|他|她|这个|该客户|刚才|上面|这个客户)/.test(question)) return null;
  const historyText = history
    .slice()
    .reverse()
    .map((item) => item.text)
    .filter(Boolean)
    .join("\n");
  const fromHistory = customers.find((customer) => historyText.includes(customer.name));
  return fromHistory ? { type: "customer", id: fromHistory.id, name: fromHistory.name, row: fromHistory } : null;
}

function resolveEmployee(question: string, employees: EmployeeRecord[]): ResolvedEntity | null {
  const employee = employees.find((item) => question.includes(item.name));
  return employee ? { type: "employee", id: employee.userid, name: employee.name, row: employee } : null;
}

function resolveDepartment(question: string, departments: DepartmentRecord[]): ResolvedEntity | null {
  const department = departments
    .slice()
    .sort((left, right) => String(right.name).length - String(left.name).length)
    .find((item) => question.includes(item.name)
      || question.includes(String(item.name).replace(/部$/, ""))
      || getDepartmentAliases(item).some((alias) => question.includes(alias))
      || String(item.name).includes(question));
  return department ? { type: "department", id: String(department.id), name: department.name, row: department } : null;
}

function getDepartmentAliases(department: DepartmentRecord): string[] {
  const name = String(department.name ?? "");
  const aliases = new Set<string>();

  // 从 DomainPack 声明的 entityAliases 中查找精确别名
  const registeredAliases = getEntityAliases();
  if (registeredAliases[name]) {
    for (const alias of registeredAliases[name]) {
      aliases.add(alias);
    }
  }

  // 从 DomainPack 声明的 entityAliasSuffixRules 中生成后缀变体
  for (const rule of getEntityAliasSuffixRules()) {
    if (name.endsWith(rule.suffix)) {
      aliases.add(name.replace(new RegExp(`${rule.suffix}$`), rule.replacement));
    }
  }

  return [...aliases].filter((alias) => alias.length >= 2);
}
