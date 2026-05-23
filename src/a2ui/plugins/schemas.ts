import { z } from "zod";

/**
 * Plugin extract 用的 zod schema：用 safeParse + .filter(success) 容错单条数据，
 * 这样上游（agent / tool）字段抖动不会让整个 plugin 失败。
 */

export const VehicleOrderSchema = z.object({
  id: z.string(),
  customer_name: z.string().optional(),
  series: z.string().optional(),
  model: z.string().optional(),
  order_status: z.string().optional(),
  payment_status: z.string().optional(),
  invoice_status: z.string().optional(),
  delivery_status: z.string().optional(),
  final_price: z.number().optional(),
  paid_amount: z.number().optional(),
  expected_delivery_date: z.string().optional()
}).passthrough();

export type VehicleOrder = z.infer<typeof VehicleOrderSchema>;

export const LeaveScenarioSchema = z.object({
  scenario: z.string().optional(),
  step: z.string().optional(),
  missing_slots: z.array(z.string()).optional(),
  slots: z.object({
    leave_type: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    reason: z.string().optional()
  }).passthrough().optional()
}).passthrough();

export type LeaveScenario = z.infer<typeof LeaveScenarioSchema>;

export const ExpenseScenarioSchema = z.object({
  claimed_amount: z.number().nonnegative().optional(),
  city: z.string().optional(),
  policy_basis: z.string().optional(),
  category: z.enum(["accommodation", "meal", "transport", "other"]).optional()
}).passthrough();

export type ExpenseScenario = z.infer<typeof ExpenseScenarioSchema>;

export const PendingActionDataSchema = z.object({
  pending_action_id: z.string(),
  tool: z.string().optional(),
  risk_level: z.string().optional(),
  expires_at: z.string().optional(),
  call: z.object({
    name: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional()
  }).passthrough().optional()
}).passthrough();

export type PendingActionData = z.infer<typeof PendingActionDataSchema>;
