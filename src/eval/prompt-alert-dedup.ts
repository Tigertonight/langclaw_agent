import { RuntimeHooks } from "../runtime/hooks.js";
import { createPromptAuthorityAlertPlugin, type PromptAuthorityAlert } from "../runtime/prompt-authority-alert-plugin.js";
import { TranscriptStore } from "../transcript/transcript-store.js";

/**
 * 验证 prompt-authority-alert 的"阈值 + 去重"扩展：
 *   1. dropped_count < minDroppedCount 且 ratio < minOverflowRatio → 静默
 *   2. 同一 (user,session) 在 cooldownMs 内只触发一次
 *   3. cooldownMs 过后能再次触发
 *   4. 不同 session 互不影响
 *   5. 高溢出比 (ratio ≥ minOverflowRatio) 即使 dropped_count 不到阈值也要触发
 */
async function main(): Promise<void> {
  let nowValue = 1_000_000;
  const captured: PromptAuthorityAlert[] = [];
  const hooks = new RuntimeHooks();
  hooks.use(createPromptAuthorityAlertPlugin({
    transcriptStore: new TranscriptStore(),
    onAlert: (alert) => { captured.push(alert); },
    minDroppedCount: 3,
    minOverflowRatio: 1.2,
    cooldownMs: 60_000,
    now: () => nowValue
  }));

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    // case 1: 1 个 dropped + ratio 1.05 → 不触发
    await emit("u1", "s1", { used: 1000, max: 1000, preTrim: 1050 }, ["memory"]);
    assert(captured.length === 0, `low-noise event should be muted, got ${captured.length}`);

    // case 2: 3 个 dropped → 触发一次
    await emit("u1", "s1", { used: 18000, max: 18000, preTrim: 25000 }, ["memory", "memory", "tasks"]);
    assert(captured.length === 1, `first overflow should fire, got ${captured.length}`);

    // case 3: 同 session 紧接再 emit → 被 cooldown 抑制
    nowValue += 30_000;
    await emit("u1", "s1", { used: 18000, max: 18000, preTrim: 30000 }, ["memory", "memory", "tasks", "skills"]);
    assert(captured.length === 1, `cooldown should suppress duplicate, got ${captured.length}`);

    // case 4: 不同 session → 立刻触发
    await emit("u1", "s-other", { used: 18000, max: 18000, preTrim: 25000 }, ["memory", "memory", "tasks"]);
    assert(captured.length === 2, `different session should bypass cooldown, got ${captured.length}`);

    // case 5: 越过 cooldown → 再次允许
    nowValue += 60_001;
    await emit("u1", "s1", { used: 18000, max: 18000, preTrim: 25000 }, ["memory", "memory", "tasks"]);
    assert(captured.length === 3, `after cooldown should fire again, got ${captured.length}`);

    // case 6: dropped 数不到阈值，但 ratio 极高 → 仍触发
    await emit("u2", "s2", { used: 18000, max: 10000, preTrim: 14000 }, ["memory"]);
    assert(captured.length === 4, `high ratio should fire even with dropped=1, got ${captured.length}`);

    console.log("PASS prompt-alert dedup (6 cases: low-noise / first-fire / cooldown-suppress / diff-session / cooldown-expire / high-ratio)");
  } finally {
    console.warn = originalWarn;
  }

  async function emit(userId: string, sessionId: string, budget: { used: number; max: number; preTrim: number }, sections: string[]): Promise<void> {
    await hooks.emit("context_assembly", {
      user_id: userId,
      session_id: sessionId,
      prompt_authority: "preassembly_may_overflow",
      budget: { used_chars: budget.used, max_chars: budget.max, pre_trim_chars: budget.preTrim },
      dropped: sections.map((section) => ({ section, reason: "section_budget" }))
    });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
