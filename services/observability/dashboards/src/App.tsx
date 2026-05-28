import { useEffect, useState } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { whoami, logout } from "./lib/langfuse-api";
import { LoginPage } from "./pages/Login";
import { HomePage } from "./pages/Home";
import { RagRecallPage } from "./pages/RagRecall";
import { EvolutionPage } from "./pages/Evolution";

type AuthState = "loading" | "anon" | "admin";

export function App(): JSX.Element {
  const [auth, setAuth] = useState<AuthState>("loading");
  const navigate = useNavigate();

  useEffect(() => {
    whoami().then((r) => setAuth(r.authenticated ? "admin" : "anon"));
  }, []);

  if (auth === "loading") return <div className="main">loading…</div>;
  if (auth === "anon") return <LoginPage onLogin={() => setAuth("admin")} />;

  const onLogout = async (): Promise<void> => {
    await logout();
    setAuth("anon");
    navigate("/");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>Observability</h1>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            首页
          </NavLink>
          <NavLink to="/rag-recall" className={({ isActive }) => (isActive ? "active" : "")}>
            RAG 召回
          </NavLink>
          <NavLink to="/evolution" className={({ isActive }) => (isActive ? "active" : "")}>
            Evolution
          </NavLink>
        </nav>
        <div style={{ marginTop: 24 }}>
          <button onClick={onLogout}>登出</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/rag-recall" element={<RagRecallPage />} />
          <Route path="/rag-recall/:traceId" element={<RagRecallPage />} />
          <Route path="/evolution" element={<EvolutionPage />} />
        </Routes>
      </main>
    </div>
  );
}
