import type { JsonObject } from "../../types/agent-contracts.js";
import { card, list, readArray, text, toRecord } from "../builders.js";
import type { SurfacePlugin } from "../plugin-types.js";
import type { OpenUILangCompatComponent } from "../types.js";
import { businessSurface } from "../view-bridge.js";

export const sourcesPlugin: SurfacePlugin<JsonObject[]> = {
  kind: "sources",
  extract: (ctx) => {
    const sources = readArray(ctx.record.sources).length ? readArray(ctx.record.sources) : readArray(toRecord(ctx.record.output)?.sources);
    return sources.length ? sources : null;
  },
  build: (sources, ctx) => ({
    surfaceId: `${ctx.surfacePrefix}_${ctx.runId}_sources`,
    root: "sources_root",
    data: {
      sources,
      ...businessSurface("source_citation", "引用来源", { sources })
    },
    components: sourceComponents(sources)
  })
};

function sourceComponents(sources: JsonObject[]): OpenUILangCompatComponent[] {
  return [
    card("sources_root", ["sources_title", "sources_list"]),
    text("sources_title", "### 引用来源"),
    list("sources_list", sources.map((_, index) => `source_${index}`)),
    ...sources.map((source, index) => text(
      `source_${index}`,
      [
        `**${String(source.title ?? "来源")} / ${String(source.heading ?? "")}**`,
        source.source ? `来源：${String(source.source)}` : "",
        typeof source.score === "number" ? `相关度：${source.score.toFixed(2)}` : "",
        String(source.quote ?? "").slice(0, 260)
      ].filter(Boolean).join("\n\n")
    ))
  ];
}
