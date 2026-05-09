export const RESOURCE_SCHEMAS = {
  customers: {
    entity: "customer",
    fields: [
      "id",
      "name",
      "owner_user_id",
      "department",
      "tier",
      "industry",
      "industry_category",
      "annual_revenue",
      "deal_status",
      "follow_status",
      "renewal_status",
      "last_contacted_at",
      "next_follow_up_at",
      "contract_expire_at"
    ],
    defaultFields: [
      "id",
      "name",
      "tier",
      "industry",
      "industry_category",
      "deal_status",
      "follow_status",
      "renewal_status",
      "annual_revenue",
      "next_follow_up_at",
      "contract_expire_at"
    ],
    defaultSort: [{ field: "next_follow_up_at", direction: "asc" }]
  },
  orders: {
    entity: "order",
    fields: ["id", "customer_id", "customer_name", "status", "amount", "created_at", "expected_delivery"],
    defaultFields: ["id", "customer_name", "status", "amount", "created_at", "expected_delivery"],
    defaultSort: [{ field: "created_at", direction: "desc" }]
  },
  sales_reports: {
    entity: "sales_report",
    fields: ["department", "period", "revenue", "pipeline", "top_customers"],
    defaultFields: ["department", "period", "revenue", "pipeline", "top_customers"],
    defaultSort: []
  },
  employees: {
    entity: "employee",
    fields: ["userid", "name", "department_name", "position", "role", "direct_leader", "reporting", "main_department", "department"],
    defaultFields: ["userid", "name", "department_name", "position", "role", "direct_leader", "reporting", "main_department", "department"],
    defaultSort: [{ field: "main_department", direction: "asc" }, { field: "userid", direction: "asc" }]
  },
  departments: {
    entity: "department",
    fields: ["id", "name", "parentid", "leader_userid", "vertical_relation", "vertical_department", "relation"],
    defaultFields: ["id", "name", "parentid", "leader_userid", "vertical_relation", "vertical_department", "relation"],
    defaultSort: [{ field: "order", direction: "asc" }]
  },
  leave_requests: {
    entity: "leave_request",
    fields: ["id", "applicant_user_id", "applicant_name", "department", "leave_type", "leave_duration", "start_time", "end_time", "reason", "status", "submitted_at"],
    defaultFields: ["id", "applicant_name", "leave_type", "leave_duration", "start_time", "end_time", "reason", "status", "submitted_at"],
    defaultSort: [{ field: "submitted_at", direction: "desc" }]
  }
};

export const QUERY_OPERATIONS = {
  SEARCH: "search",
  AGGREGATE: "aggregate"
};
