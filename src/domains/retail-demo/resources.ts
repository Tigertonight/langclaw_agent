/**
 * retail-demo 业务域资源定义。
 *
 * 零售门店 toy domain：用于验证 DomainPack 声明式架构的解耦能力。
 * 包含三个资源：门店、销量、库存告警。
 */

import type { ResourceConfig } from "../../resources/types.js";
import type { FieldLabels } from "../../resources/types.js";

/**
 * Retail-demo 域资源配置。
 */
export const RETAIL_RESOURCES: Record<string, ResourceConfig> = {
  retail_stores: {
    file: "data/domains/retail-demo/stores.json",
    fields: ["id", "name", "short_name", "city", "region", "store_type", "manager", "area_sqm", "status"],
    domain: "retail-demo",
  },
  retail_sales: {
    file: "data/domains/retail-demo/sales.json",
    fields: ["id", "store_id", "store_name", "product", "category", "quantity", "unit_price", "total_amount", "date", "payment_method"],
    domain: "retail-demo",
  },
  retail_inventory_alerts: {
    file: "data/domains/retail-demo/inventory-alerts.json",
    fields: ["id", "store_id", "store_name", "product", "category", "current_stock", "min_stock", "unit", "alert_level", "last_restock_date", "suggested_order_qty", "supplier"],
    domain: "retail-demo",
  },
};

/**
 * Retail-demo 域字段标签。
 */
export const RETAIL_FIELD_LABELS: FieldLabels = {
  // 门店
  short_name: "门店简称",
  city: "城市",
  region: "区域",
  store_type: "门店类型",
  manager: "店长",
  area_sqm: "面积(㎡)",
  // 销量
  product: "商品",
  category: "品类",
  quantity: "数量",
  unit_price: "单价",
  total_amount: "总金额",
  date: "日期",
  payment_method: "支付方式",
  // 库存告警
  current_stock: "当前库存",
  min_stock: "最低库存",
  unit: "单位",
  alert_level: "告警级别",
  last_restock_date: "上次补货日期",
  suggested_order_qty: "建议补货量",
  supplier: "供应商",
};
