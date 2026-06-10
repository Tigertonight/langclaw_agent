import { z } from "zod";

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
