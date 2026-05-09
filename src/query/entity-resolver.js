import { loadJson } from "../data/load-json.js";

export async function resolveEntities(question, history = []) {
  const [customers, employees, departments] = await Promise.all([
    loadJson("data/customers.json"),
    loadJson("data/wecom-users.json"),
    loadJson("data/wecom-departments.json")
  ]);

  return {
    customer: resolveCustomer(question, history, customers),
    employee: resolveEmployee(question, employees),
    department: resolveDepartment(question, departments)
  };
}

export async function getDepartmentTreeIds(rootId) {
  const departments = await loadJson("data/wecom-departments.json");
  const ids = new Set([Number(rootId)]);
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

function resolveCustomer(question, history, customers) {
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

function resolveEmployee(question, employees) {
  const employee = employees.find((item) => question.includes(item.name));
  return employee ? { type: "employee", id: employee.userid, name: employee.name, row: employee } : null;
}

function resolveDepartment(question, departments) {
  const department = departments
    .slice()
    .sort((left, right) => String(right.name).length - String(left.name).length)
    .find((item) => question.includes(item.name)
      || question.includes(String(item.name).replace(/部$/, ""))
      || getDepartmentAliases(item).some((alias) => question.includes(alias))
      || String(item.name).includes(question));
  return department ? { type: "department", id: department.id, name: department.name, row: department } : null;
}

function getDepartmentAliases(department) {
  const name = String(department.name ?? "");
  const aliases = new Set();
  if (name === "行政人事部") {
    aliases.add("行政部");
    aliases.add("人事部");
    aliases.add("HR部");
    aliases.add("HR");
  }
  if (name === "市场与新媒体部") {
    aliases.add("市场部");
    aliases.add("新媒体部");
  }
  if (name === "前台接待") aliases.add("前台");
  if (name.endsWith("组")) aliases.add(name.replace(/组$/, ""));
  if (name.endsWith("部")) aliases.add(name.replace(/部$/, ""));
  return [...aliases].filter((alias) => alias.length >= 2);
}
