/**
 * Evolution Loop Dashboard
 *
 * 数据来源：
 *   - listTraces() 拿到最近 N 条，从 observations 里聚合 evolution.* span
 *     · evolution.judge / evolution.apply / evolution.applied
 *     · 抽取 metadata: extracted_memories / extracted_entities / extracted_relations
 *   - listScores() 拿人工分数 < 3 的 trace，作为 bad cases
 *
 * 第一版只算最近 100 条（后端代理已加 admin auth），不做分页/缓存。
 * 真上量后再换 ClickHouse 直查 + 物化视图。
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listScores, listTraces, TraceListItem, ApiError } from "../lib/langfuse-api";

interface EvolutionStats {
  totalTraces: number;
  withJudge: number;
  withApply: number;
  extractedMemories: number;
  extractedEntities: number;
  extractedRelations: number;
}

const EMPTY_STATS: EvolutionStats = {
  totalTraces: 0,
  withJudge: 0,
  withApply: 0,
  extractedMemories: 0,
  extractedEntities: 0,
  extractedRelations: 0
};

export function EvolutionPage(): JSX.Element {
  const [stats, setStats] = useState<EvolutionStats>(EMPTY_STATS);
  const [badCases, setBadCases] = useState<TraceListItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll(): Promise<void> {
    setLoading(true);
    setErr(null);
    try {
      // 简版：只统计最近 100 条 trace 的 evolution 指标
      const traces = await listTraces({ limit: 100 });
      const aggregated = aggregate(traces.data);
      setStats(aggregated);

      // bad cases: score < 3
      try {
        const scores = await listScores({ limit: 100 });
        const lowIds = new Set(
          (scores.data ?? [])
            .filter((s) => typeof s.value === "number" && s.value < 3)
            .map((s) => s.traceId)
        );
        setBadCases(traces.data.filter((t) => lowIds.has(t.id)));
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) {
          // scores API 不一定存在/有数据；忽略
          console.warn("scores fetch failed", e);
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>Evolution Loop</h2>
      {err && <div className="error">{err}</div>}
      {loading && <div className="muted">加载中…</div>}

      <div className="card">
        <h2>抽取速率（最近 100 trace）</h2>
        <div className="row" style={{ gap: 32 }}>
          <Stat label="总 trace" value={stats.totalTraces} />
          <Stat label="带 judge" value={stats.withJudge} />
          <Stat label="带 apply" value={stats.withApply} />
          <Stat label="抽取 memory" value={stats.extractedMemories} />
          <Stat label="抽取 entity" value={stats.extractedEntities} />
          <Stat label="抽取 relation" value={stats.extractedRelations} />
        </div>
        <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          注：这些数字来自 trace.tags / metadata 聚合，是粗估；上量后改 ClickHouse 直查
        </div>
      </div>

      <div className="card">
        <h2>Bad cases（人工 score &lt; 3）</h2>
        {badCases.length === 0 && (
          <div className="muted">无人工标注的低分 trace</div>
        )}
        {badCases.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>名称</th>
                <th>tags</th>
                <th>查看</th>
              </tr>
            </thead>
            <tbody>
              {badCases.map((t) => (
                <tr key={t.id}>
                  <td className="muted">{t.timestamp?.replace("T", " ").slice(0, 19) ?? "-"}</td>
                  <td>{t.name ?? "-"}</td>
                  <td>
                    {(t.tags ?? []).slice(0, 3).map((tag) => (
                      <span className="tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </td>
                  <td>
                    <Link to={`/rag-recall/${t.id}`}>查看</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Memory 引用足迹（待 Phase 2）</h2>
        <div className="muted">
          等 evolution_applied span 稳定上报 memory_id 后接入。当前先看 trace 详情里的
          metadata 即可。
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function aggregate(traces: TraceListItem[]): EvolutionStats {
  // 一阶估算：从 trace tags 里看 evolution_applied 标志，
  // 真正的抽取数量得拉每条 trace 详情才能拿到。第一版省掉详情拉取（太慢），
  // 等 Phase 2 改 ClickHouse 物化。
  let withJudge = 0;
  let withApply = 0;
  for (const t of traces) {
    const tags = t.tags ?? [];
    if (tags.some((x) => x.startsWith("evolution_judge"))) withJudge += 1;
    if (tags.some((x) => x.startsWith("evolution_applied"))) withApply += 1;
  }
  return {
    totalTraces: traces.length,
    withJudge,
    withApply,
    // 第一版置 0，等数据上来后再细化
    extractedMemories: 0,
    extractedEntities: 0,
    extractedRelations: 0
  };
}
