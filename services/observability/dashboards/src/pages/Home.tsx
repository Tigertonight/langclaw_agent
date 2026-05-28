import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listTraces, TraceListItem } from "../lib/langfuse-api";

export function HomePage(): JSX.Element {
  const [traces, setTraces] = useState<TraceListItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listTraces({ limit: 20 })
      .then((r) => setTraces(r.data))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div>
      <h2>最近 Trace</h2>
      <div className="card">
        {err && <div className="error">{err}</div>}
        {!traces && !err && <div className="muted">加载中…</div>}
        {traces && traces.length === 0 && (
          <div className="muted">暂无 trace。先跑一次 dealer-smoke 试试。</div>
        )}
        {traces && traces.length > 0 && (
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
              {traces.map((t) => (
                <tr key={t.id}>
                  <td className="muted">{t.timestamp?.replace("T", " ").slice(0, 19) ?? "-"}</td>
                  <td>{t.name ?? "-"}</td>
                  <td>
                    {(t.tags ?? []).slice(0, 4).map((tag) => (
                      <span className="tag" key={tag}>
                        {tag}
                      </span>
                    ))}
                  </td>
                  <td>
                    <Link to={`/rag-recall/${t.id}`}>RAG 召回</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
