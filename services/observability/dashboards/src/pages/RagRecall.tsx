/**
 * RAG Recall Inspector
 *
 * 输入：traceId（URL 参数 / 表单）
 * 数据来源：Langfuse trace.observations，按 name 前缀 memory.search.* 过滤；
 *   - memory.search.vector / memory.search.lex / memory.search.rrf
 *   - 期望 metadata 含 hits[]（chunk_id + score）
 *
 * 这一层不假设 memory-service 的 schema 一定和 v1 期望一致；如果字段不对，
 * 优雅展示原始 metadata 让人能看到细节再去补 memory-service 的 span 输出。
 */

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getTrace, TraceDetail, TraceObservation } from "../lib/langfuse-api";

interface Hit {
  chunk_id?: string;
  score?: number;
  [k: string]: unknown;
}

function toHits(metadata: unknown): Hit[] {
  if (!metadata || typeof metadata !== "object") return [];
  const m = metadata as Record<string, unknown>;
  const raw = m.hits ?? m.results ?? m.candidates;
  if (!Array.isArray(raw)) return [];
  return raw as Hit[];
}

function findRecallSpans(obs: TraceObservation[]): {
  vector?: TraceObservation;
  lex?: TraceObservation;
  rrf?: TraceObservation;
  others: TraceObservation[];
} {
  const out: ReturnType<typeof findRecallSpans> = { others: [] };
  for (const o of obs) {
    if (!o.name) continue;
    if (o.name.includes("memory.search.vector") || o.name.includes("recall.vector")) {
      out.vector = o;
    } else if (o.name.includes("memory.search.lex") || o.name.includes("recall.lex")) {
      out.lex = o;
    } else if (o.name.includes("memory.search.rrf") || o.name.includes("recall.rrf")) {
      out.rrf = o;
    } else if (o.name.startsWith("memory.search") || o.name.startsWith("recall")) {
      out.others.push(o);
    }
  }
  return out;
}

function HitsList({ obs, label }: { obs: TraceObservation | undefined; label: string }): JSX.Element {
  if (!obs) {
    return (
      <div className="card">
        <h2>{label}</h2>
        <div className="muted">本 trace 未上报对应 span</div>
      </div>
    );
  }
  const hits = toHits(obs.metadata);
  return (
    <div className="card">
      <h2>{label}</h2>
      {hits.length === 0 && (
        <>
          <div className="muted">未识别到 hits 字段，原始 metadata：</div>
          <pre>{JSON.stringify(obs.metadata, null, 2)}</pre>
        </>
      )}
      {hits.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>chunk_id</th>
              <th>score</th>
            </tr>
          </thead>
          <tbody>
            {hits.slice(0, 10).map((h, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td style={{ fontFamily: "monospace" }}>{h.chunk_id ?? "-"}</td>
                <td>{typeof h.score === "number" ? h.score.toFixed(3) : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function RagRecallPage(): JSX.Element {
  const params = useParams<{ traceId?: string }>();
  const navigate = useNavigate();
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [input, setInput] = useState(params.traceId ?? "");

  useEffect(() => {
    if (!params.traceId) return;
    setTrace(null);
    setErr(null);
    getTrace(params.traceId)
      .then(setTrace)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [params.traceId]);

  const recall = trace?.observations ? findRecallSpans(trace.observations) : null;

  return (
    <div>
      <h2>RAG Recall Inspector</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (input) navigate(`/rag-recall/${input}`);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="trace id"
          style={{ flex: 1 }}
        />
        <button type="submit">查询</button>
      </form>

      {err && <div className="error" style={{ margin: "16px 0" }}>{err}</div>}

      {trace && (
        <>
          <div className="card">
            <h2>Trace 概览</h2>
            <div className="muted">id: {trace.id}</div>
            <div className="muted">name: {trace.name ?? "-"}</div>
            <div style={{ marginTop: 8 }}>
              {(trace.tags ?? []).map((t) => (
                <span className="tag" key={t}>
                  {t}
                </span>
              ))}
            </div>
            {trace.input != null && (
              <>
                <div className="muted" style={{ marginTop: 12 }}>用户消息：</div>
                <pre>{typeof trace.input === "string" ? trace.input : JSON.stringify(trace.input, null, 2)}</pre>
              </>
            )}
          </div>

          {recall && (
            <>
              <HitsList obs={recall.vector} label="向量检索 (top 10)" />
              <HitsList obs={recall.lex} label="Lex 检索 (top 10)" />
              <HitsList obs={recall.rrf} label="RRF 融合 (top → LLM)" />
              {recall.others.length > 0 && (
                <div className="card">
                  <h2>其它 memory.search 子 span</h2>
                  <ul>
                    {recall.others.map((o) => (
                      <li key={o.id} className="muted">
                        {o.name}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
