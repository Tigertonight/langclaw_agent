import { RuntimeHooks } from "../runtime/hooks.js";
import { createPromptAuthorityAlertPlugin, type PromptAuthorityAlert } from "../runtime/prompt-authority-alert-plugin.js";
import { TranscriptStore } from "../transcript/transcript-store.js";

/**
 * 验证 prompt-authority-alert 插件：
 *   - 当 context_assembly 事件携带 prompt_authority="preassembly_may_overflow" 时，
 *     插件必须触发 onAlert 回调；
 *   - 当 prompt_authority="assembled" 时，必须保持沉默；
 *   - alert 内容应携带 dropped_count / dropped_sections / used_chars / max_chars。
 */
async function main(): Promise<void> {
  const hooks = new RuntimeHooks();
  const transcriptStore = new TranscriptStore();
  const captured: PromptAuthorityAlert[] = [];
  hooks.use(createPromptAuthorityAlertPlugin({
    transcriptStore,
    onAlert: (alert) => { captured.push(alert); }
  }));

  const originalWarn = console.warn;
  let warnCount = 0;
  console.warn = (..._args: unknown[]) => { warnCount += 1; };

  try {
    // case 1: 正常装配，不应触发告警
    await hooks.emit("context_assembly", {
      user_id: "u1",
      session_id: "s1",
      run_id: "r1",
      prompt_authority: "assembled",
      budget: { used_chars: 1000, max_chars: 18000, pre_trim_chars: 1000 },
      dropped: [],
      sections: []
    });
    assert(captured.length === 0, "assembled status should not trigger alert");
    assert(warnCount === 0, "assembled status should not emit console.warn");

    // case 2: 超预算被裁剪，必须触发告警
    await hooks.emit("context_assembly", {
      user_id: "u2",
      session_id: "s2",
      run_id: "r2",
      prompt_authority: "preassembly_may_overflow",
      budget: { used_chars: 18000, max_chars: 18000, pre_trim_chars: 25000 },
      dropped: [
        { section: "memory", reason: "section_budget", original_chars: 6000, kept_chars: 4500 },
        { section: "memory", reason: "global_budget", chars: 1500 },
        { section: "conversation", reason: "global_budget", chars: 1000 }
      ],
      sections: []
    });
    assert(captured.length === 1, `overflow status should trigger 1 alert, got ${captured.length}`);
    const alert = captured[0];
    assert(alert.user_id === "u2", "alert should carry user_id");
    assert(alert.session_id === "s2", "alert should carry session_id");
    assert(alert.dropped_count === 3, `alert should report 3 dropped entries, got ${alert.dropped_count}`);
    const sections = new Set(alert.dropped_sections);
    assert(sections.has("memory") && sections.has("conversation"), `alert sections should include memory & conversation, got ${alert.dropped_sections.join(",")}`);
    assert(alert.pre_trim_chars === 25000, `alert pre_trim_chars expected 25000, got ${alert.pre_trim_chars}`);
    assert(alert.max_chars === 18000, `alert max_chars expected 18000, got ${alert.max_chars}`);
    assert(warnCount === 1, `overflow should emit exactly 1 console.warn, got ${warnCount}`);

    // case 3: 缺少 user_id 应被静默跳过（防御）
    await hooks.emit("context_assembly", {
      session_id: "s3",
      prompt_authority: "preassembly_may_overflow",
      budget: { used_chars: 18000, max_chars: 18000, pre_trim_chars: 20000 },
      dropped: [{ section: "tasks", reason: "section_budget" }]
    });
    assert(captured.length === 1, "missing user_id should be skipped silently");

    console.log("PASS prompt-authority-alert (3 cases: silent / fires / defensive-skip)");
  } finally {
    console.warn = originalWarn;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
