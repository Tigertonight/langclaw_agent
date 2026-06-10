/**
 * Attendance 域 zod schema 定义。
 * OpenUI Lang domain surface schema.
 */

import { z } from "zod";

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
