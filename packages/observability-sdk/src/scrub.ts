/**
 * PII scrubber.
 *
 * 在 trace 上报前对 input/output/metadata 做脱敏。规则集中在这里方便：
 *   1. 各服务（agent/memory-service/...）共用同一套规则
 *   2. 演化（新增车牌格式 / 新增 PII 类型）只改一处
 *   3. 测试集中
 *
 * 默认规则（v1）：
 *   - 手机号（中国大陆 11 位 1\d{10}）
 *   - 身份证（18 位含 X）
 *   - 邮箱
 *   - 中国大陆车牌（含新能源）
 *   - 银行卡（13-19 位连续数字，宽松匹配）
 *
 * 可通过 ScrubConfig.disabledRules 关闭某项；可通过 customRules 增加自定义规则。
 */

export type ScrubRuleName =
  | "phone"
  | "id_card"
  | "email"
  | "plate"
  | "bank_card";

interface ScrubRule {
  name: ScrubRuleName;
  pattern: RegExp;
  replacer: (match: string) => string;
}

const RULES: ScrubRule[] = [
  {
    name: "phone",
    pattern: /\b1[3-9]\d{9}\b/g,
    replacer: (m) => `[REDACTED:phone:${m.slice(0, 3)}***${m.slice(-2)}]`
  },
  {
    name: "id_card",
    pattern: /\b\d{17}[\dXx]\b/g,
    replacer: () => "[REDACTED:id_card]"
  },
  {
    name: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacer: (m) => {
      const [user, domain] = m.split("@");
      if (!user || !domain) return "[REDACTED:email]";
      const head = user.slice(0, Math.min(2, user.length));
      return `[REDACTED:email:${head}***@${domain}]`;
    }
  },
  {
    name: "plate",
    // 普通车牌 + 新能源（8 位）
    // \b 对中文边界不可靠，靠正则本身的字符类约束做边界
    pattern: /[一-龥][A-Z][A-Z0-9]{4,6}/g,
    // 保留省份汉字 + 字母（前 2 个 code unit），剩余替换为 ***
    replacer: (m) => `${m.slice(0, 2)}***`
  }
];

/**
 * 默认未启用的可选规则。会误伤 VIN 码（17 位）、订单号等长数字串，
 * 业务确认需要时通过 ScrubConfig.customRules 注入。
 */
export const OPTIONAL_RULES: Record<"bank_card", ScrubRule> = {
  bank_card: {
    name: "bank_card",
    pattern: /\b\d{13,19}\b/g,
    replacer: () => "[REDACTED:bank_card]"
  }
};

export interface ScrubConfig {
  enabled: boolean;
  disabledRules?: ScrubRuleName[];
  /** 自定义规则会在内置规则之后跑 */
  customRules?: Array<{ pattern: RegExp; replacement: string | ((m: string) => string) }>;
}

export function scrubString(s: string, config: ScrubConfig): string {
  if (!config.enabled) return s;
  let out = s;
  for (const rule of RULES) {
    if (config.disabledRules?.includes(rule.name)) continue;
    out = out.replace(rule.pattern, rule.replacer);
  }
  if (config.customRules) {
    for (const r of config.customRules) {
      if (typeof r.replacement === "string") {
        out = out.replace(r.pattern, r.replacement);
      } else {
        out = out.replace(r.pattern, r.replacement);
      }
    }
  }
  return out;
}

/**
 * 递归 scrub 任意值。
 *   - string  → scrubString
 *   - array   → 元素递归
 *   - object  → 值递归（key 不动）
 *   - 其它原子值原样返回
 *
 * 不改原对象。如果不开启 scrub 直接 return value 引用，避免 deep clone 开销。
 */
export function scrubValue<T>(value: T, config: ScrubConfig): T {
  if (!config.enabled) return value;
  return scrubInner(value, config) as T;
}

function scrubInner(v: unknown, config: ScrubConfig): unknown {
  if (typeof v === "string") return scrubString(v, config);
  if (Array.isArray(v)) return v.map((x) => scrubInner(x, config));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = scrubInner(val, config);
    }
    return out;
  }
  return v;
}

/**
 * 从环境变量解析 ScrubConfig。
 *   OBS_SCRUB_ENABLED=true|false  默认 true
 *   OBS_SCRUB_DISABLED_RULES=plate,bank_card  逗号分隔
 */
export function loadScrubConfigFromEnv(env = process.env): ScrubConfig {
  const enabled = (env.OBS_SCRUB_ENABLED ?? "true").toLowerCase() !== "false";
  const disabled = (env.OBS_SCRUB_DISABLED_RULES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as ScrubRuleName[];
  return { enabled, disabledRules: disabled };
}
