/**
 * Dealer 域 zod schema 定义。
 * OpenUI Lang domain surface schema.
 */

import { z } from "zod";

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
