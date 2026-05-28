import { useState, FormEvent } from "react";
import { login, ApiError } from "../lib/langfuse-api";

export function LoginPage({ onLogin }: { onLogin: () => void }): JSX.Element {
  const [secret, setSecret] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(secret);
      onLogin();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setErr("密码错误");
      else setErr("登录失败：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="main" style={{ maxWidth: 360, margin: "10vh auto" }}>
      <h2>Observability Admin</h2>
      <form onSubmit={submit}>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="DASHBOARD_ADMIN_SECRET"
          style={{ width: "100%", marginBottom: 12 }}
          autoFocus
        />
        <button type="submit" disabled={busy || !secret}>
          {busy ? "..." : "登录"}
        </button>
        {err && (
          <div className="error" style={{ marginTop: 12 }}>
            {err}
          </div>
        )}
      </form>
      <p className="muted" style={{ marginTop: 24, fontSize: 12 }}>
        密码即环境变量 DASHBOARD_ADMIN_SECRET。仅运维使用，不公开开放。
      </p>
    </div>
  );
}
