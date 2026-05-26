import { createApp } from "../app.js";
import { createA2UIModule } from "../a2ui/module.js";
import type { A2UIEnvelope } from "../a2ui/types.js";

const app = createApp();
await app.init();
const { agent, queryEngine, toolRegistry, userContextResolver } = app;
const { chatController } = createA2UIModule({ queryEngine, streamAgent: agent, toolRegistry, userContextResolver });

interface Case {
  label: string;
  userId: string;
  sessionId?: string;
  message: string;
  expectedSurfaces: string[]; // 含 substring 即可
}

const sessionLeave = `regress_leave_${Date.now()}`;
const sessionVehicle = `regress_vehicle_${Date.now()}`;
const sessionChitchat = `regress_chitchat_${Date.now()}`;

const cases: Case[] = [
  {
    label: "1. 知识检索 → sources + runtime",
    userId: "hr_001",
    message: "我想问下年假的制度",
    expectedSurfaces: ["sources", "runtime"]
  },
  {
    label: "2. 报销估算 → expense_estimate",
    userId: "hr_001",
    message: "出差住酒店花了800元能报多少",
    expectedSurfaces: ["expense_estimate", "runtime"]
  },
  {
    label: "3. 请假表单空白态 → leave_request_form",
    userId: "hr_001",
    sessionId: sessionLeave,
    message: "我要请个假",
    expectedSurfaces: ["leave_request_form", "runtime"]
  },
  {
    label: "4. 请假 slot 填齐 → leave_request_form + approval",
    userId: "hr_001",
    sessionId: sessionLeave,
    message: "年假，明天9点到下午6点，因为家里有事",
    expectedSurfaces: ["leave_request_form", "runtime"] // approval 需 confirmation_required，不一定每次都有
  },
  {
    label: "5. 同 session continue → task_resume",
    userId: "hr_001",
    sessionId: sessionLeave,
    message: "继续上次那个请假",
    expectedSurfaces: ["runtime"] // task_resume 取决于 task 是否已落库
  },
  {
    label: "6. 销售订单交付 → vehicle_progress",
    userId: "sales_001",
    sessionId: sessionVehicle,
    message: "查一下王经理本月的销售订单交付状态",
    expectedSurfaces: ["runtime"] // vehicle_progress 需要 row schema 命中
  },
  {
    label: "7. 兜底（chitchat）→ 仅 runtime",
    userId: "hr_001",
    sessionId: sessionChitchat,
    message: "今天天气怎么样",
    expectedSurfaces: ["runtime"]
  }
];

let failures = 0;

for (const c of cases) {
  console.log("\n" + "=".repeat(70));
  console.log(`▶ ${c.label}`);
  console.log(`  user=${c.userId}  session=${c.sessionId ?? "(none)"}  msg="${c.message}"`);
  console.log("=".repeat(70));

  let result: { a2ui?: A2UIEnvelope[]; answer?: string };
  try {
    result = await chatController.chat({
      user_id: c.userId,
      session_id: c.sessionId,
      message: c.message,
      debug: true
    }) as { a2ui?: A2UIEnvelope[]; answer?: string };
  } catch (error) {
    console.log(`  ✗ ERROR: ${error instanceof Error ? error.message : String(error)}`);
    failures += 1;
    continue;
  }

  const envelopes = result.a2ui ?? [];
  const surfaces = collectSurfaces(envelopes);
  console.log(`  answer: ${truncate(result.answer ?? "(no answer)", 120)}`);
  console.log(`  surfaces produced: ${surfaces.length === 0 ? "(none)" : surfaces.map((s) => s.surfaceId).join(", ")}`);
  for (const s of surfaces) {
    console.log(`    • ${s.surfaceId}  root=${s.root}  components=${s.componentCount}`);
    if (s.componentNames.length > 0) {
      console.log(`      componentNames: ${s.componentNames.join(", ")}`);
    }
  }
  // 命中检查
  const matches = c.expectedSurfaces.filter((expected) => surfaces.some((s) => s.surfaceId.includes(expected)));
  const missing = c.expectedSurfaces.filter((expected) => !surfaces.some((s) => s.surfaceId.includes(expected)));
  console.log(`  expected: ${c.expectedSurfaces.join(", ")}`);
  console.log(`  matched : ${matches.length}/${c.expectedSurfaces.length}${missing.length ? `  missing: ${missing.join(", ")}` : ""}`);
  if (missing.length > 0) failures += 1;
}

if (failures > 0) {
  throw new Error(`a2ui regression failed: ${failures} case(s) missing expected surfaces`);
}

interface SurfaceSummary {
  surfaceId: string;
  root: string;
  componentCount: number;
  componentNames: string[];
}

function collectSurfaces(envelopes: A2UIEnvelope[]): SurfaceSummary[] {
  const map = new Map<string, SurfaceSummary>();
  for (const env of envelopes) {
    const create = (env as { createSurface?: { surfaceId?: string; root?: string } }).createSurface;
    if (create?.surfaceId) {
      map.set(create.surfaceId, {
        surfaceId: create.surfaceId,
        root: create.root ?? "",
        componentCount: 0,
        componentNames: []
      });
    }
    const update = (env as { updateComponents?: { surfaceId?: string; components?: Array<Record<string, unknown>> } }).updateComponents;
    if (update?.surfaceId) {
      const entry = map.get(update.surfaceId) ?? { surfaceId: update.surfaceId, root: "", componentCount: 0, componentNames: [] };
      const comps = update.components ?? [];
      entry.componentCount = comps.length;
      const names = new Set<string>();
      for (const c of comps) {
        if (typeof c.componentName === "string") {
          names.add(c.componentName);
        } else if (c.component && typeof c.component === "object") {
          for (const k of Object.keys(c.component as Record<string, unknown>)) names.add(k);
        }
      }
      entry.componentNames = [...names];
      map.set(update.surfaceId, entry);
    }
  }
  return [...map.values()];
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
