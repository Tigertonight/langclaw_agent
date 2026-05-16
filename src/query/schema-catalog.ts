import type { QuerySort } from "../types/agent-contracts.js";

export interface ResourceSchema {
  entity: string;
  fields: string[];
  defaultFields: string[];
  defaultSort: QuerySort[];
}

export const RESOURCE_SCHEMAS: Record<string, ResourceSchema> = {
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
  },
  dealer_stores: {
    entity: "dealer_store",
    fields: ["id", "name", "short_name", "city", "region", "store_type", "manager_user_id", "capacity", "status"],
    defaultFields: ["id", "name", "city", "region", "store_type", "capacity", "status"],
    defaultSort: [{ field: "id", direction: "asc" }]
  },
  dealer_vehicles: {
    entity: "dealer_vehicle",
    fields: ["vin", "store_id", "store_name", "series", "model", "year", "color", "source_type", "purchase_mode", "cost", "finance_interest_accrued", "landing_cost", "min_sale_price", "inbound_date", "stock_age_days", "stock_warning_level", "status", "certificate_status", "vehicle_tag", "mileage", "sales_order_id"],
    defaultFields: ["vin", "store_name", "series", "model", "color", "status", "stock_age_days", "stock_warning_level", "landing_cost", "certificate_status", "sales_order_id"],
    defaultSort: [{ field: "stock_age_days", direction: "desc" }]
  },
  dealer_inbounds: {
    entity: "dealer_inbound",
    fields: ["id", "store_id", "store_name", "order_type", "series", "model", "color", "customer_name", "sales_consultant_id", "byd_order_no", "status", "expected_arrival_date", "customer_promised_date", "deposit_amount"],
    defaultFields: ["id", "store_name", "order_type", "series", "model", "color", "customer_name", "status", "expected_arrival_date", "customer_promised_date"],
    defaultSort: [{ field: "expected_arrival_date", direction: "asc" }]
  },
  dealer_quotas: {
    entity: "dealer_quota",
    fields: ["id", "store_id", "store_name", "month", "series", "model", "color", "quota_total", "bound_inbound_count", "available_quota"],
    defaultFields: ["id", "store_name", "month", "series", "model", "color", "quota_total", "bound_inbound_count", "available_quota"],
    defaultSort: [{ field: "available_quota", direction: "asc" }]
  },
  dealer_leads: {
    entity: "dealer_lead",
    fields: ["id", "customer_name", "phone_masked", "source", "campaign", "store_id", "store_name", "owner_user_id", "owner_name", "interested_series", "intention_level", "status", "created_at", "assigned_at", "first_contact_at", "last_followup_at", "followup_count", "visit_count", "expected_purchase_date", "lost_reason", "converted_order_id"],
    defaultFields: ["id", "customer_name", "source", "store_name", "owner_name", "interested_series", "intention_level", "status", "followup_count", "visit_count", "last_followup_at", "lost_reason", "converted_order_id"],
    defaultSort: [{ field: "created_at", direction: "desc" }]
  },
  dealer_sales_orders: {
    entity: "dealer_sales_order",
    fields: ["id", "store_id", "store_name", "customer_name", "owner_user_id", "owner_name", "vin", "series", "model", "order_type", "order_status", "payment_status", "invoice_status", "delivery_status", "list_price", "final_price", "landing_cost", "gross_profit", "deposit_amount", "paid_amount", "finance_amount", "created_at", "expected_delivery_date"],
    defaultFields: ["id", "store_name", "customer_name", "owner_name", "vin", "series", "model", "order_type", "order_status", "payment_status", "delivery_status", "final_price", "gross_profit", "expected_delivery_date"],
    defaultSort: [{ field: "created_at", direction: "desc" }]
  },
  dealer_finance: {
    entity: "dealer_finance_record",
    fields: ["id", "resource_type", "store_id", "store_name", "direction", "category", "amount", "balance_after", "related_order_id", "occurred_at", "status"],
    defaultFields: ["id", "resource_type", "store_name", "direction", "category", "amount", "balance_after", "related_order_id", "occurred_at", "status"],
    defaultSort: [{ field: "occurred_at", direction: "desc" }]
  },
  dealer_repair_orders: {
    entity: "dealer_repair_order",
    fields: ["id", "store_id", "store_name", "customer_name", "vin", "series", "service_advisor_id", "service_advisor_name", "order_type", "status", "appointment_at", "reception_at", "promised_finish_at", "labor_amount", "part_amount", "receivable_amount", "warranty_claim_id", "next_service_suggestion"],
    defaultFields: ["id", "store_name", "customer_name", "vin", "series", "service_advisor_name", "order_type", "status", "promised_finish_at", "receivable_amount", "warranty_claim_id"],
    defaultSort: [{ field: "appointment_at", direction: "desc" }]
  },
  dealer_warranty_claims: {
    entity: "dealer_warranty_claim",
    fields: ["id", "repair_order_id", "store_id", "store_name", "customer_name", "vin", "series", "fault_category", "fault_code", "claim_status", "claimed_amount", "approved_amount", "difference_amount", "submitted_at", "expected_settlement_at", "evidence_status"],
    defaultFields: ["id", "repair_order_id", "store_name", "customer_name", "vin", "series", "fault_category", "fault_code", "claim_status", "claimed_amount", "approved_amount", "difference_amount", "expected_settlement_at", "evidence_status"],
    defaultSort: [{ field: "submitted_at", direction: "desc" }]
  },
  dealer_metrics: {
    entity: "dealer_metric",
    fields: ["id", "scope", "store_name", "category", "metric", "value", "unit", "severity", "summary", "recommendation", "related_resource", "related_ids"],
    defaultFields: ["id", "store_name", "category", "metric", "value", "unit", "severity", "summary", "recommendation", "related_resource", "related_ids"],
    defaultSort: [{ field: "severity", direction: "asc" }, { field: "category", direction: "asc" }]
  }
};

export const QUERY_OPERATIONS = {
  SEARCH: "search",
  AGGREGATE: "aggregate"
} as const;
