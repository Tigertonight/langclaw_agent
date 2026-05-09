export function renderChatPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>企业助手</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f0f2f5;
      --panel: #ffffff;
      --surface: #f8fafc;
      --text: #1e293b;
      --text-2: #4a5568;
      --muted: #94a3b8;
      --border: #e2e8f0;
      --border-2: #cbd5e1;
      --accent: #2563eb;
      --accent-hover: #1d4ed8;
      --accent-soft: #eff6ff;
      --accent-border: #bfdbfe;
      --success: #16a34a;
      --success-soft: #f0fdf4;
      --danger: #dc2626;
      --danger-soft: #fef2f2;
      --warning: #d97706;
      /* Radius scale — B2B sharp style */
      --r-xs: 3px;
      --r-sm: 4px;
      --r-md: 6px;
      --r-circle: 999px;
      font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body { margin: 0; background: var(--bg); color: var(--text); }

    /* ─── Topbar ─────────────────────────────────────── */
    main { height: 100vh; height: 100dvh; overflow: hidden; display: flex; flex-direction: column; }

    .topbar {
      height: 52px;
      flex: 0 0 52px;
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      display: grid;
      grid-template-columns: auto auto 1fr auto;
      align-items: center;
      padding: 0 12px 0 8px;
      gap: 0;
      position: relative;
      z-index: 10;
    }

    .topbar-menu-btn {
      width: 36px; height: 36px;
      border-radius: var(--r-sm);
      border: none;
      background: transparent;
      color: var(--text-2);
      cursor: pointer;
      display: grid; place-items: center;
      flex-shrink: 0;
      transition: background 0.12s, color 0.12s;
      touch-action: manipulation;
    }
    .topbar-menu-btn:hover { background: var(--surface); color: var(--text); }

    .topbar-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 14px 0 6px;
      margin-right: 12px;
      border-right: 1px solid var(--border);
      height: 28px;
      flex-shrink: 0;
    }
    .brand-mark {
      width: 22px; height: 22px;
      background: var(--accent);
      border-radius: var(--r-sm);
      display: grid; place-items: center;
      color: white;
      font-size: 11px; font-weight: 800;
      letter-spacing: -0.5px;
      flex-shrink: 0;
    }
    .brand-name {
      font-size: 13px; font-weight: 600;
      color: var(--text);
      letter-spacing: -0.1px;
      white-space: nowrap;
    }

    .session-title-inline {
      min-width: 0;
      display: grid;
      gap: 1px;
      padding: 0 8px;
    }
    .session-title-inline strong {
      font-size: 13px; font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--text);
    }
    .session-title-inline small {
      color: var(--muted); font-size: 11px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }

    .topbar-actions {
      display: flex; align-items: center; gap: 6px;
      flex-shrink: 0;
    }

    .debug-control {
      display: flex; align-items: center; gap: 5px;
      color: var(--muted); font-size: 11px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: var(--r-sm);
      border: 1px solid var(--border);
      background: var(--surface);
      user-select: none;
      transition: border-color 0.12s;
      touch-action: manipulation;
    }
    .debug-control:hover { border-color: var(--border-2); color: var(--text-2); }
    .debug-control input { width: 13px; height: 13px; margin: 0; cursor: pointer; accent-color: var(--accent); }

    .topbar-action-btn {
      width: 32px; height: 32px;
      border-radius: var(--r-sm);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-2);
      cursor: pointer;
      display: grid; place-items: center;
      font-size: 17px; line-height: 1;
      transition: background 0.12s, border-color 0.12s, color 0.12s;
      touch-action: manipulation;
    }
    .topbar-action-btn:hover {
      background: var(--panel);
      border-color: var(--border-2);
      color: var(--text);
    }
    .topbar-action-btn:disabled { opacity: 0.45; cursor: not-allowed; }

    /* User chip — square corners, not pill */
    .user-chip {
      display: flex; align-items: center; gap: 7px;
      height: 32px; padding: 0 9px 0 4px;
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s;
      max-width: 200px;
      touch-action: manipulation;
    }
    .user-chip:hover {
      background: var(--panel);
      border-color: var(--border-2);
    }
    .user-chip-avatar {
      width: 22px; height: 22px;
      border-radius: var(--r-circle);
      background: var(--accent);
      color: white;
      font-size: 10px; font-weight: 700;
      display: grid; place-items: center;
      flex-shrink: 0;
      line-height: 1;
    }
    .user-chip-info {
      display: grid; gap: 0;
      text-align: left; min-width: 0; overflow: hidden;
    }
    .user-chip-name {
      display: block;
      font-size: 12px; font-weight: 600;
      color: var(--text); line-height: 1.25;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .user-chip-role {
      display: block;
      font-size: 10px; color: var(--muted);
      line-height: 1.25; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }

    /* ─── Messages ───────────────────────────────────── */
    .messages {
      flex: 1 1 auto; min-height: 0; overflow-y: auto;
      padding: 20px 24px;
      display: flex; flex-direction: column; gap: 12px;
      scroll-behavior: smooth;
    }
    .messages::-webkit-scrollbar { width: 5px; }
    .messages::-webkit-scrollbar-track { background: transparent; }
    .messages::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: var(--r-circle); }

    .msg {
      max-width: min(700px, 88vw);
      line-height: 1.65;
      font-size: 14px;
    }

    /* Flat rectangular bubbles — not chat-app bubbly */
    .user {
      align-self: flex-end;
      background: var(--accent);
      color: white;
      padding: 9px 13px;
      border-radius: var(--r-sm);
      font-size: 14px;
    }

    .assistant {
      align-self: flex-start;
      background: var(--panel);
      border: 1px solid var(--border);
      padding: 12px 16px;
      border-radius: var(--r-sm);
      box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    }

    .msg-text:empty::after { content: "正在生成..."; color: var(--muted); font-style: italic; }

    /* ─── Markdown ───────────────────────────────────── */
    .markdown { white-space: normal; }
    .markdown > *:first-child { margin-top: 0; }
    .markdown > *:last-child { margin-bottom: 0; }
    .markdown h1, .markdown h2, .markdown h3 {
      margin: 14px 0 6px;
      line-height: 1.3; font-weight: 700;
      color: var(--text);
    }
    .markdown h1 { font-size: 20px; }
    .markdown h2 { font-size: 16px; border-bottom: 1px solid var(--border); padding-bottom: 4px; }
    .markdown h3 { font-size: 14px; }
    .markdown p { margin: 6px 0; }
    .markdown ul, .markdown ol { margin: 6px 0; padding-left: 20px; }
    .markdown li { margin: 3px 0; }
    .markdown blockquote {
      margin: 8px 0; padding: 8px 12px;
      border-left: 3px solid var(--accent-border);
      background: var(--accent-soft);
      color: var(--text-2);
      border-radius: 0;
      font-size: 13px;
    }
    .markdown code {
      padding: 1px 5px; border-radius: var(--r-xs);
      background: #f1f4f8;
      border: 1px solid var(--border);
      font-family: "SF Mono", "Cascadia Code", ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px; color: #be185d;
    }
    .markdown pre {
      overflow: auto; margin: 8px 0; padding: 11px 13px;
      border-radius: var(--r-sm);
      background: #0f172a;
      color: #e2e8f0;
      white-space: pre;
      border: 1px solid #1e293b;
    }
    .markdown pre code {
      padding: 0; background: transparent;
      border: none; color: inherit; font-size: 12px;
    }
    .markdown table {
      width: 100%; border-collapse: collapse;
      margin: 10px 0; font-size: 13px;
      display: block; overflow-x: auto;
    }
    .markdown th, .markdown td {
      border: 1px solid var(--border);
      padding: 6px 10px;
      text-align: left; vertical-align: top;
    }
    .markdown th {
      background: var(--surface);
      font-weight: 600; color: var(--text-2);
      font-size: 12px; white-space: nowrap;
    }
    .markdown tr:hover td { background: #fafbfd; }

    /* ─── Composer ───────────────────────────────────── */
    .composer {
      flex: 0 0 auto;
      padding: 10px 16px 14px;
      background: var(--panel);
      border-top: 1px solid var(--border);
    }
    .composer-inner {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      border: 1px solid var(--border-2);
      border-radius: var(--r-sm);
      padding: 6px 8px 6px 12px;
      background: white;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .composer-inner:focus-within {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12);
    }
    textarea {
      flex: 1; border: none; outline: none;
      background: transparent; color: var(--text);
      resize: none; min-height: 38px; max-height: 160px;
      padding: 6px 0; font: inherit; font-size: 14px; line-height: 1.6;
      caret-color: var(--accent);
    }
    textarea::placeholder { color: var(--muted); }
    .composer-send {
      flex-shrink: 0; height: 32px; padding: 0 13px;
      background: var(--accent); color: white;
      border: none; border-radius: var(--r-xs);
      font-family: inherit; font-size: 13px; font-weight: 600;
      cursor: pointer;
      transition: background 0.12s;
      white-space: nowrap;
      touch-action: manipulation;
    }
    .composer-send:hover:not(:disabled) { background: var(--accent-hover); }
    .composer-send:disabled { opacity: 0.45; cursor: wait; }
    .composer-hint {
      text-align: right; font-size: 11px; color: var(--muted);
      margin-top: 4px; user-select: none;
    }

    /* ─── Debug / Sources ────────────────────────────── */
    .debug { margin-top: 8px; font-size: 12px; color: var(--muted); }
    .raw-debug summary {
      cursor: pointer; color: var(--muted); font-size: 12px;
      padding: 4px 0; user-select: none;
    }
    .raw-debug summary:hover { color: var(--text-2); }
    details pre {
      overflow: auto; background: var(--surface);
      border: 1px solid var(--border);
      padding: 10px 12px; border-radius: var(--r-sm);
      font-size: 12px; margin-top: 4px;
      font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
    }

    /* ─── Run Panel ──────────────────────────────────── */
    .run-panel {
      margin-bottom: 10px;
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      background: var(--surface);
      overflow: hidden;
      color: var(--text);
    }
    .run-panel[open] { background: var(--panel); }
    .run-panel summary {
      list-style: none; cursor: pointer;
      padding: 8px 12px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
      transition: background 0.12s;
    }
    .run-panel summary:hover { background: var(--surface); }
    .run-panel summary::-webkit-details-marker { display: none; }
    .run-title { display: flex; align-items: center; gap: 7px; min-width: 0; }
    .run-title strong { font-size: 12px; font-weight: 600; color: var(--text-2); }
    .run-subtitle {
      grid-column: 1 / -1;
      color: var(--muted); font-size: 11px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      margin-top: 1px;
    }
    /* Badge — flat tag, not pill */
    .run-badge {
      display: inline-flex; align-items: center;
      border: 1px solid var(--border);
      background: var(--panel);
      color: var(--text-2);
      border-radius: var(--r-xs);
      padding: 2px 6px;
      font-size: 11px; white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .run-dot {
      width: 7px; height: 7px; border-radius: var(--r-circle);
      background: var(--muted);
      flex-shrink: 0;
    }
    .run-dot.running {
      background: var(--accent);
      animation: pulseDot 1.2s ease-in-out infinite;
    }
    .run-dot.completed { background: var(--success); }
    .run-dot.error { background: var(--danger); }
    @keyframes pulseDot {
      0%, 100% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.45); opacity: 1; }
    }
    .run-body {
      border-top: 1px solid var(--border);
      padding: 10px 12px 12px;
      display: grid; gap: 10px;
    }
    .run-metadata { display: flex; flex-wrap: wrap; gap: 4px; }
    .run-chip {
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text-2);
      border-radius: var(--r-xs);
      padding: 2px 6px;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .run-timeline { position: relative; display: grid; gap: 7px; }
    .run-step { display: grid; grid-template-columns: 18px 1fr; gap: 8px; align-items: start; }
    /* Step marker — keep circle for semantic meaning */
    .run-step-marker {
      width: 18px; height: 18px; border-radius: var(--r-circle);
      display: grid; place-items: center;
      margin-top: 2px;
      background: var(--border);
      color: var(--muted);
      font-size: 9px; font-weight: 700;
    }
    .run-step.running .run-step-marker {
      background: var(--accent-soft);
      color: var(--accent);
    }
    .run-step.completed .run-step-marker { background: var(--success-soft); color: var(--success); }
    .run-step.error .run-step-marker { background: var(--danger-soft); color: var(--danger); }
    .run-step-card {
      min-width: 0;
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: var(--r-xs);
      padding: 7px 10px;
    }
    .run-step-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .run-step-title { font-weight: 600; font-size: 12px; color: var(--text); }
    .run-step-phase {
      color: var(--muted); font-size: 10px;
      text-transform: uppercase; letter-spacing: .04em; white-space: nowrap;
    }
    .run-step-detail { color: var(--text-2); font-size: 12px; line-height: 1.55; margin-top: 3px; white-space: pre-wrap; }
    .run-extra { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .run-extra code {
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text-2);
      border-radius: var(--r-xs); padding: 1px 5px;
      font-family: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
      font-size: 11px;
    }

    /* ─── Artifact Card ──────────────────────────────── */
    .artifact-card {
      margin-top: 10px;
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      background: var(--panel);
      overflow: hidden;
    }
    .artifact-head {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      display: grid; gap: 2px;
    }
    .artifact-kicker {
      color: var(--accent);
      font-size: 10px; font-weight: 700;
      letter-spacing: .06em; text-transform: uppercase;
    }
    .artifact-title { font-size: 14px; font-weight: 700; color: var(--text); }
    .artifact-summary { color: var(--text-2); font-size: 12px; line-height: 1.5; }
    .artifact-section { padding: 10px 14px; border-top: 1px solid var(--border); }
    .artifact-section:first-of-type { border-top: 0; }
    .artifact-section h4 { margin: 0 0 8px; font-size: 12px; color: var(--text-2); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .artifact-table {
      width: 100%; border-collapse: collapse;
      font-size: 12px; display: block; overflow-x: auto;
    }
    .artifact-table th, .artifact-table td {
      border-bottom: 1px solid var(--border);
      padding: 6px 9px; text-align: left; vertical-align: top; white-space: nowrap;
    }
    .artifact-table th {
      color: var(--muted); font-weight: 600;
      background: var(--surface); font-size: 11px;
      text-transform: uppercase; letter-spacing: .03em;
    }
    .artifact-table tr:last-child td { border-bottom: none; }

    /* ─── Session Sidebar ────────────────────────────── */
    .session-sidebar-layer, .modal-backdrop {
      position: fixed; inset: 0; display: none; z-index: 40;
    }
    .session-sidebar-layer.open, .modal-backdrop.open { display: block; }

    .session-sidebar-backdrop, .modal-dim {
      position: absolute; inset: 0; border: 0; border-radius: 0;
      background: rgba(15, 23, 42, 0.4);
    }

    .session-sidebar {
      position: absolute; left: 0; top: 0; bottom: 0;
      width: min(300px, 85vw);
      background: var(--panel);
      border-right: 1px solid var(--border);
      box-shadow: 8px 0 32px rgba(15, 23, 42, 0.12);
      display: flex; flex-direction: column;
    }

    .session-sidebar-head {
      height: 52px;
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 14px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      flex-shrink: 0;
    }
    .session-sidebar-head strong { font-size: 13px; font-weight: 600; color: var(--text); }

    .session-create-row {
      margin: 10px 10px 4px;
      padding: 7px 11px;
      border: 1px solid var(--accent-border);
      background: var(--accent-soft);
      color: var(--accent);
      text-align: left;
      border-radius: var(--r-sm);
      cursor: pointer;
      font-family: inherit; font-size: 13px; font-weight: 600;
      display: flex; align-items: center; gap: 6px;
      transition: background 0.12s, border-color 0.12s;
      touch-action: manipulation;
    }
    .session-create-row:hover {
      background: #dbeafe; border-color: var(--accent);
    }
    .session-create-row:disabled { opacity: 0.5; cursor: not-allowed; }

    .session-list { overflow-y: auto; padding: 4px 6px 12px; display: grid; gap: 1px; }
    .session-list::-webkit-scrollbar { width: 4px; }
    .session-list::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: var(--r-circle); }

    .session-item {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px; align-items: center;
      padding: 7px 7px;
      border-radius: var(--r-sm);
      transition: background 0.1s;
    }
    .session-item:hover { background: var(--surface); }
    .session-item.active { background: var(--accent-soft); }

    .session-open {
      border: 0; background: transparent;
      color: var(--text); text-align: left; padding: 0;
      min-width: 0; cursor: pointer; font: inherit;
    }
    .session-open strong, .session-open small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-open strong { font-size: 13px; font-weight: 600; color: var(--text); }
    .session-open small { color: var(--muted); font-size: 11px; margin-top: 2px; }
    .session-item.active .session-open strong { color: var(--accent); }

    .session-actions { display: flex; gap: 2px; flex-shrink: 0; }
    .session-icon-btn {
      width: 26px; height: 26px;
      border: none; background: transparent;
      color: var(--muted); padding: 0;
      border-radius: var(--r-xs); cursor: pointer;
      display: grid; place-items: center;
      transition: background 0.1s, color 0.1s;
      touch-action: manipulation;
    }
    .session-icon-btn:hover { background: var(--border); color: var(--text-2); }
    .session-icon-btn.danger:hover { background: var(--danger-soft); color: var(--danger); }

    .session-rename-form { grid-column: 1 / -1; display: flex; gap: 6px; }
    .session-rename-form input {
      flex: 1; min-width: 0; padding: 6px 8px;
      border: 1px solid var(--accent-border); border-radius: var(--r-xs);
      font: inherit; font-size: 13px; outline: none;
      background: white; color: var(--text);
    }
    .session-rename-form input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(37,99,235,0.1); }
    .session-rename-form button {
      padding: 6px 10px; border-radius: var(--r-xs);
      background: var(--accent); color: white;
      border: none; font: inherit; font-size: 12px; font-weight: 600;
      cursor: pointer; touch-action: manipulation;
    }

    /* ─── Icon Button ──────────────────────────────────── */
    .icon-button {
      width: 30px; height: 30px; border-radius: var(--r-sm);
      border: none; color: var(--muted); background: transparent;
      line-height: 1; padding: 0; cursor: pointer;
      display: grid; place-items: center;
      transition: background 0.1s, color 0.1s;
      touch-action: manipulation;
    }
    .icon-button:hover { background: var(--border); color: var(--text-2); }

    /* ─── User Modal ─────────────────────────────────── */
    .user-modal {
      position: absolute;
      left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      width: min(460px, calc(100vw - 32px));
      max-height: min(600px, calc(100vh - 64px));
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      overflow: hidden;
      box-shadow: 0 16px 48px rgba(15, 23, 42, 0.2), 0 2px 8px rgba(15, 23, 42, 0.08);
      display: flex; flex-direction: column;
    }

    .modal-head {
      height: 48px;
      display: grid; grid-template-columns: 32px 1fr 32px;
      align-items: center; padding: 0 10px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      flex-shrink: 0;
    }
    .modal-head h2 {
      margin: 0; text-align: center;
      font-size: 14px; font-weight: 600; color: var(--text);
    }

    .search-row {
      position: relative; padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .search-row input {
      width: 100%; height: 34px;
      border: 1px solid var(--border); border-radius: var(--r-sm);
      padding: 0 34px 0 10px;
      font: inherit; font-size: 13px;
      outline: none; background: white; color: var(--text);
      transition: border-color 0.12s, box-shadow 0.12s;
    }
    .search-row input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(37,99,235,0.1);
    }
    .search-row input::placeholder { color: var(--muted); }
    .clear-search {
      position: absolute; right: 18px; top: 50%;
      transform: translateY(-50%);
      width: 24px; height: 24px;
      border: none; background: transparent;
      color: var(--muted); font-size: 18px; padding: 0;
      cursor: pointer; display: grid; place-items: center;
      border-radius: var(--r-xs); transition: color 0.1s;
    }
    .clear-search:hover { color: var(--text-2); }

    .user-list { overflow-y: auto; padding: 4px 8px 8px; flex: 1; min-height: 0; }
    .user-list::-webkit-scrollbar { width: 4px; }
    .user-list::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: var(--r-circle); }

    .user-row {
      width: 100%;
      display: grid; grid-template-columns: 36px 1fr;
      gap: 10px; align-items: center; min-height: 56px;
      border: 0; border-radius: var(--r-sm);
      background: transparent; color: var(--text);
      text-align: left; padding: 7px 8px;
      cursor: pointer; font: inherit;
      transition: background 0.1s;
      touch-action: manipulation;
    }
    .user-row:hover { background: var(--surface); }
    .user-row.active { background: var(--accent-soft); }

    /* Avatars keep circle — they're semantic */
    .avatar {
      width: 34px; height: 34px; border-radius: var(--r-circle);
      display: grid; place-items: center;
      background: #e2e8f0; color: var(--text-2);
      font-weight: 700; font-size: 14px; flex-shrink: 0;
    }
    .user-row.active .avatar {
      background: var(--accent); color: white;
    }

    .user-main { min-width: 0; }
    .user-title { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
    .user-title strong {
      font-size: 13px; font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .user-sub {
      color: var(--muted); font-size: 12px; margin-top: 2px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .selected-mark {
      margin-left: auto; color: var(--accent);
      font-size: 11px; font-weight: 600;
      flex-shrink: 0; white-space: nowrap;
      border: 1px solid var(--accent-border);
      background: var(--accent-soft);
      border-radius: var(--r-xs);
      padding: 1px 5px;
    }

    .empty { color: var(--muted); padding: 32px 0; text-align: center; font-size: 13px; }

    /* ─── Responsive: Tablet (≤768px) ───────────────── */
    @media (max-width: 768px) {
      .brand-name { display: none; }
      .topbar-brand { padding-right: 10px; margin-right: 8px; }
      .user-chip-info { display: none; }
      .user-chip { padding: 0 6px; }
      .messages { padding: 16px 16px; }
      .msg { max-width: calc(100vw - 40px); }
    }

    /* ─── Responsive: Mobile (≤480px) ───────────────── */
    @media (max-width: 480px) {
      .topbar { padding: 0 6px; height: 48px; flex: 0 0 48px; }
      .topbar-brand { display: none; }
      .debug-control { display: none; }
      .topbar-action-btn { width: 36px; height: 36px; }
      .user-chip { height: 36px; width: 36px; padding: 0; justify-content: center; }
      .user-chip-avatar { width: 26px; height: 26px; font-size: 12px; }

      .messages { padding: 12px 12px; gap: 10px; }
      .msg { max-width: calc(100vw - 24px); font-size: 15px; }
      .user { padding: 10px 13px; }
      .assistant { padding: 11px 13px; }

      .composer { padding: 8px 10px 12px; }
      .composer-inner { padding: 5px 6px 5px 10px; }
      .composer-send { height: 38px; padding: 0 14px; font-size: 14px; }
      textarea { min-height: 36px; font-size: 15px; }
      .composer-hint { display: none; }

      .session-sidebar { width: min(280px, 90vw); }

      /* Modal slides up from bottom on mobile */
      .user-modal {
        top: auto; bottom: 0;
        left: 0; right: 0;
        transform: none;
        width: 100%;
        max-width: 100%;
        max-height: 80vh;
        border-radius: var(--r-md) var(--r-md) 0 0;
        border-left: none; border-right: none; border-bottom: none;
      }

      .run-panel summary { padding: 8px 10px; }
      .run-body { padding: 8px 10px 10px; }
      .run-step-card { padding: 6px 8px; }
    }

    /* ─── Responsive: Very small (≤360px) ───────────── */
    @media (max-width: 360px) {
      .topbar-actions { gap: 4px; }
      .topbar-action-btn { width: 32px; height: 32px; }
      .messages { padding: 10px 10px; }
    }
  </style>
</head>
<body>
  <main>
    <!-- Topbar -->
    <div class="topbar">
      <button id="openSessions" class="topbar-menu-btn" type="button" aria-label="会话管理">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
          <line x1="2" y1="4.5" x2="14" y2="4.5"/>
          <line x1="2" y1="8" x2="14" y2="8"/>
          <line x1="2" y1="11.5" x2="14" y2="11.5"/>
        </svg>
      </button>
      <div class="topbar-brand">
        <div class="brand-mark">A</div>
        <span class="brand-name">Enterprise Agent</span>
      </div>
      <div class="session-title-inline">
        <strong id="activeSessionTitle">新会话</strong>
        <small id="activeSessionMeta">session</small>
      </div>
      <div class="topbar-actions">
        <label class="debug-control" title="开启后在回答下方显示调试信息">
          <input id="debugMode" type="checkbox" checked />
          <span>Debug</span>
        </label>
        <button id="newSessionTop" class="topbar-action-btn" type="button" aria-label="新建会话" title="新建会话">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="7" y1="1" x2="7" y2="13"/>
            <line x1="1" y1="7" x2="13" y2="7"/>
          </svg>
        </button>
        <button id="identityFab" class="user-chip" type="button" title="切换登录用户">
          <span id="identityInitial" class="user-chip-avatar">员</span>
          <div id="identityBadge" class="user-chip-info"></div>
        </button>
      </div>
    </div>

    <div id="messages" class="messages"></div>

    <!-- Composer -->
    <form id="form" class="composer">
      <div class="composer-inner">
        <textarea id="message" placeholder="输入问题或业务指令…" rows="1"></textarea>
        <button id="send" class="composer-send" type="submit">发送</button>
      </div>
      <div class="composer-hint">Enter 发送 · Shift+Enter 换行</div>
    </form>
  </main>

  <!-- Session Sidebar -->
  <div id="sessionLayer" class="session-sidebar-layer" aria-hidden="true">
    <button id="sessionBackdrop" class="session-sidebar-backdrop" type="button" aria-label="关闭会话面板"></button>
    <aside class="session-sidebar" aria-label="会话管理">
      <div class="session-sidebar-head">
        <strong>会话记录</strong>
        <button id="closeSessions" class="icon-button" type="button" aria-label="关闭">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/>
          </svg>
        </button>
      </div>
      <button id="createSession" class="session-create-row" type="button">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="6.5" y1="1" x2="6.5" y2="12"/><line x1="1" y1="6.5" x2="12" y2="6.5"/>
        </svg>
        新建会话
      </button>
      <div id="sessionList" class="session-list"></div>
    </aside>
  </div>

  <!-- User Modal -->
  <div id="userModal" class="modal-backdrop" aria-hidden="true">
    <button id="modalDim" class="modal-dim" type="button" aria-label="关闭"></button>
    <div class="user-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-head">
        <span></span>
        <h2 id="modalTitle">切换登录用户</h2>
        <button id="closeModal" class="icon-button" type="button" aria-label="关闭">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="1" y1="1" x2="12" y2="12"/><line x1="12" y1="1" x2="1" y2="12"/>
          </svg>
        </button>
      </div>
      <div class="search-row">
        <input id="userSearch" autocomplete="off" placeholder="搜索姓名、岗位、部门、userid…" />
        <button id="clearSearch" class="clear-search" type="button" aria-label="清空搜索">×</button>
      </div>
      <div id="userList" class="user-list"></div>
    </div>
  </div>

  <script>
    const STORAGE_KEY = "enterprise_agent_sessions_v2";
    const LEGACY_STORAGE_KEY = "enterprise_agent_sessions_v1";
    const INITIAL_MESSAGES = [{
      id: createMessageId(),
      role: "assistant",
      text: "你好，我是企业 Agent，本地 demo 已接入 mock 企微通讯录。你可以切换员工身份后测试权限、知识库和业务场景。"
    }];

    const form = document.querySelector("#form");
    const messages = document.querySelector("#messages");
    const send = document.querySelector("#send");
    const textarea = document.querySelector("#message");
    const debugMode = document.querySelector("#debugMode");
    const activeSessionTitle = document.querySelector("#activeSessionTitle");
    const activeSessionMeta = document.querySelector("#activeSessionMeta");
    const openSessions = document.querySelector("#openSessions");
    const closeSessions = document.querySelector("#closeSessions");
    const sessionBackdrop = document.querySelector("#sessionBackdrop");
    const sessionLayer = document.querySelector("#sessionLayer");
    const sessionList = document.querySelector("#sessionList");
    const createSession = document.querySelector("#createSession");
    const newSessionTop = document.querySelector("#newSessionTop");
    const identityFab = document.querySelector("#identityFab");
    const identityInitial = document.querySelector("#identityInitial");
    const identityBadge = document.querySelector("#identityBadge");
    const userModal = document.querySelector("#userModal");
    const modalDim = document.querySelector("#modalDim");
    const closeModal = document.querySelector("#closeModal");
    const userSearch = document.querySelector("#userSearch");
    const clearSearch = document.querySelector("#clearSearch");
    const userList = document.querySelector("#userList");

    let users = [];
    let chatLoading = false;
    let editingSessionId = null;
    let editingSessionTitle = "";
    let currentUser = {
      userid: "sales_001",
      name: "林悦",
      department_name: "展厅销售组",
      position: "销售顾问"
    };
    let sessionState = loadSessionState(currentUser.userid);

    loadUsers();
    renderIdentity();
    renderAll();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (chatLoading) return;
      const text = textarea.value.trim();
      if (!text) return;

      const userMessage = { id: createMessageId(), role: "user", text };
      const assistantMessage = {
        id: createMessageId(),
        role: "assistant",
        text: "",
        thinkingText: "",
        streaming: true
      };
      updateActiveSession((session) => {
        const messages = session.messages.concat(userMessage, assistantMessage);
        return {
          ...session,
          title: inferSessionTitle(session, messages),
          messages,
          updatedAt: Date.now()
        };
      });
      textarea.value = "";
      autoResizeTextarea();
      setChatLoading(true);
      renderAll();

      try {
        const payload = {
          user_id: currentUser.userid,
          wecom_userid: currentUser.userid,
          session_id: getActiveSession().id,
          message: text,
          debug: debugMode.checked
        };
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        await readEventStream(response, assistantMessage.id);
      } catch (error) {
        patchMessage(assistantMessage.id, {
          text: "请求失败：" + error.message,
          error: true,
          processStatus: "error",
          streaming: false,
          thinking: false
        });
      } finally {
        setChatLoading(false);
        renderAll();
        textarea.focus();
      }
    });

    textarea.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      form.requestSubmit();
    });

    textarea.addEventListener("input", autoResizeTextarea);

    function autoResizeTextarea() {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
    }

    openSessions.addEventListener("click", openSessionSidebar);
    closeSessions.addEventListener("click", closeSessionSidebar);
    sessionBackdrop.addEventListener("click", closeSessionSidebar);
    createSession.addEventListener("click", createNewSession);
    newSessionTop.addEventListener("click", createNewSession);
    identityFab.addEventListener("click", openUserModal);
    closeModal.addEventListener("click", closeUserModal);
    modalDim.addEventListener("click", closeUserModal);
    userSearch.addEventListener("input", renderUserList);
    clearSearch.addEventListener("click", () => {
      userSearch.value = "";
      renderUserList();
      userSearch.focus();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeUserModal();
        closeSessionSidebar();
      }
    });

    async function loadUsers() {
      const response = await fetch("/api/wecom-users");
      const payload = await response.json();
      users = payload.users || [];
      currentUser = users.find((user) => user.userid === currentUser.userid) || currentUser;
      sessionState = loadSessionState(currentUser.userid);
      renderIdentity();
      renderUserList();
      renderAll();
    }

    async function readEventStream(response, assistantMessageId) {
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || payload.error || "流式请求失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let boundary = buffer.indexOf("\\n\\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          handleStreamEvent(block, assistantMessageId);
          boundary = buffer.indexOf("\\n\\n");
        }
      }
      if (buffer.trim()) handleStreamEvent(buffer, assistantMessageId);
    }

    function handleStreamEvent(block, assistantMessageId) {
      const lines = block.split(/\\r?\\n/);
      let event = "message";
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) return;
      const payload = JSON.parse(dataLines.join("\\n"));

      if (event === "thinking") {
        appendProcessStep(assistantMessageId, payload.step, normalizeStreamText(payload.text || ""));
        renderMessages();
        return;
      }
      if (event === "delta") {
        const delta = normalizeStreamText(payload.text || "");
        appendMessageText(assistantMessageId, delta);
        renderMessages();
        return;
      }
      if (event === "done") {
        const debugSteps = Array.isArray(payload.debug?.steps) ? payload.debug.steps : null;
        patchMessage(assistantMessageId, {
          text: payload.answer || getMessage(assistantMessageId)?.text || "",
          sources: payload.sources || [],
          artifacts: payload.artifacts || [],
          debug: payload.debug,
          processSteps: debugSteps || getMessage(assistantMessageId)?.processSteps || [],
          processStatus: "completed",
          streaming: false,
          thinking: false,
          streamed: true
        });
        updateActiveSession((session) => ({
          ...session,
          title: inferSessionTitle(session, session.messages),
          updatedAt: Date.now()
        }));
        renderAll();
        return;
      }
      if (event === "error") {
        patchMessage(assistantMessageId, {
          text: "请求失败：" + (payload.message || "unknown error"),
          error: true,
          processStatus: "error",
          streaming: false,
          thinking: false
        });
        renderMessages();
      }
    }

    function renderAll() {
      renderSessionHeader();
      renderSessionList();
      renderMessages();
      saveSessionState();
    }

    function renderSessionHeader() {
      const session = getActiveSession();
      activeSessionTitle.textContent = session.title || "新会话";
      activeSessionMeta.textContent = session.id + " · " + formatTime(session.updatedAt);
    }

    function renderMessages() {
      const session = getActiveSession();
      messages.innerHTML = "";
      for (const item of session.messages) {
        const div = document.createElement("div");
        div.className = "msg " + item.role;

        if (item.role === "assistant" && shouldShowRunPanel(item)) {
          div.appendChild(createRunPanel(item));
        }

        const text = document.createElement("div");
        text.className = "msg-text" + (item.role === "assistant" ? " markdown" : "");
        if (item.role === "assistant") {
          text.innerHTML = renderMarkdown(item.text || "");
        } else {
          text.textContent = item.text || "";
        }
        div.appendChild(text);

        if (item.artifacts?.length) {
          for (const artifact of item.artifacts) {
            div.appendChild(createArtifactCard(artifact));
          }
        }

        if (item.sources?.length) {
          const source = document.createElement("div");
          source.className = "debug";
          source.textContent = "来源：" + item.sources.map((s) => s.title + " / " + s.heading).join("；");
          div.appendChild(source);
        }
        attachDebug(div, item);
        messages.appendChild(div);
      }
      messages.scrollTop = messages.scrollHeight;
    }

    function renderSessionList() {
      const sorted = sessionState.sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt);
      sessionList.innerHTML = "";
      for (const session of sorted) {
        const item = document.createElement("div");
        item.className = "session-item" + (session.id === sessionState.activeSessionId ? " active" : "");

        if (editingSessionId === session.id) {
          const form = document.createElement("form");
          form.className = "session-rename-form";
          const input = document.createElement("input");
          input.value = editingSessionTitle;
          const save = document.createElement("button");
          save.type = "submit";
          save.textContent = "保存";
          form.append(input, save);
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            commitRenamingSession(session.id, input.value);
          });
          item.appendChild(form);
          sessionList.appendChild(item);
          setTimeout(() => input.focus(), 0);
          continue;
        }

        const open = document.createElement("button");
        open.className = "session-open";
        open.type = "button";
        open.disabled = chatLoading;
        open.innerHTML = "<strong></strong><small></small>";
        open.querySelector("strong").textContent = session.title || "新会话";
        open.querySelector("small").textContent = formatTime(session.updatedAt) + " · " + session.messages.length + " 条";
        open.addEventListener("click", () => applySession(session.id));

        const actions = document.createElement("div");
        actions.className = "session-actions";
        const rename = document.createElement("button");
        rename.className = "session-icon-btn";
        rename.type = "button";
        rename.title = "重命名";
        rename.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z"/></svg>';
        rename.disabled = chatLoading;
        rename.addEventListener("click", () => startRenamingSession(session));
        const del = document.createElement("button");
        del.className = "session-icon-btn danger";
        del.type = "button";
        del.title = "删除会话";
        del.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="1,3 11,3"/><path d="M4 3V2h4v1"/><path d="M2 3l.8 7.2a1 1 0 001 .8h4.4a1 1 0 001-.8L10 3"/></svg>';
        del.disabled = chatLoading;
        del.addEventListener("click", () => deleteSession(session.id));
        actions.append(rename, del);
        item.append(open, actions);
        sessionList.appendChild(item);
      }
    }

    function openSessionSidebar() {
      sessionLayer.classList.add("open");
      sessionLayer.setAttribute("aria-hidden", "false");
    }

    function closeSessionSidebar() {
      editingSessionId = null;
      editingSessionTitle = "";
      sessionLayer.classList.remove("open");
      sessionLayer.setAttribute("aria-hidden", "true");
      renderSessionList();
    }

    function createNewSession() {
      if (chatLoading) return;
      const session = createEmptySession();
      sessionState.sessions = [session].concat(sessionState.sessions);
      sessionState.activeSessionId = session.id;
      closeSessionSidebar();
      renderAll();
      textarea.focus();
    }

    function applySession(sessionId) {
      if (chatLoading) return;
      const session = sessionState.sessions.find((item) => item.id === sessionId);
      if (!session) return;
      sessionState.activeSessionId = session.id;
      closeSessionSidebar();
      renderAll();
    }

    function startRenamingSession(session) {
      if (chatLoading) return;
      editingSessionId = session.id;
      editingSessionTitle = session.title || "新会话";
      renderSessionList();
    }

    function commitRenamingSession(sessionId, value) {
      const title = value.trim();
      if (!title) {
        editingSessionId = null;
        editingSessionTitle = "";
        renderSessionList();
        return;
      }
      sessionState.sessions = sessionState.sessions.map((session) => (
        session.id === sessionId
          ? { ...session, title: title.slice(0, 24), manualTitle: true, updatedAt: Date.now() }
          : session
      ));
      editingSessionId = null;
      editingSessionTitle = "";
      renderAll();
    }

    function deleteSession(sessionId) {
      if (chatLoading) return;
      const session = sessionState.sessions.find((item) => item.id === sessionId);
      if (!session) return;
      const ok = window.confirm("删除会话「" + (session.title || "新会话") + "」？");
      if (!ok) return;
      const nextSessions = sessionState.sessions.filter((item) => item.id !== sessionId);
      if (!nextSessions.length) {
        const fallback = createEmptySession();
        sessionState.sessions = [fallback];
        sessionState.activeSessionId = fallback.id;
      } else {
        sessionState.sessions = nextSessions;
        if (sessionState.activeSessionId === sessionId) {
          sessionState.activeSessionId = nextSessions.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
        }
      }
      renderAll();
    }

    function openUserModal() {
      userModal.classList.add("open");
      userModal.setAttribute("aria-hidden", "false");
      userSearch.value = "";
      renderUserList();
      setTimeout(() => userSearch.focus(), 0);
    }

    function closeUserModal() {
      userModal.classList.remove("open");
      userModal.setAttribute("aria-hidden", "true");
      textarea.focus();
    }

    function selectUser(user) {
      if (chatLoading) return;
      currentUser = user;
      sessionState = loadSessionState(currentUser.userid);
      editingSessionId = null;
      editingSessionTitle = "";
      renderIdentity();
      closeUserModal();
      closeSessionSidebar();
      renderAll();
    }

    function renderIdentity() {
      identityInitial.textContent = currentUser.name?.slice(-1) || "员";
      const name = escapeHtml(currentUser.name || currentUser.userid);
      const dept = escapeHtml((currentUser.department_name || "未知部门") + " · " + (currentUser.position || "员工"));
      identityBadge.innerHTML =
        "<span class='user-chip-name'>" + name + "</span>" +
        "<span class='user-chip-role'>" + dept + "</span>";
    }

    function renderUserList() {
      const keyword = userSearch.value.trim().toLowerCase();
      const filtered = users.filter((user) => {
        const haystack = [
          user.userid,
          user.name,
          user.alias,
          user.department_name,
          user.position,
          user.mobile,
          user.email
        ].filter(Boolean).join(" ").toLowerCase();
        return !keyword || haystack.includes(keyword);
      });

      userList.innerHTML = "";
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "没有匹配的员工";
        userList.appendChild(empty);
        return;
      }

      for (const user of filtered) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "user-row" + (user.userid === currentUser.userid ? " active" : "");
        row.addEventListener("click", () => selectUser(user));

        const avatar = document.createElement("div");
        avatar.className = "avatar";
        avatar.textContent = user.name?.slice(-1) || "员";

        const main = document.createElement("div");
        main.className = "user-main";
        const title = document.createElement("div");
        title.className = "user-title";
        const name = document.createElement("strong");
        name.textContent = (user.name || user.userid) + "  " + (user.department_name || "未知部门");
        title.append(name);
        if (user.userid === currentUser.userid) {
          const selected = document.createElement("span");
          selected.className = "selected-mark";
          selected.textContent = "当前";
          title.appendChild(selected);
        }

        const sub = document.createElement("div");
        sub.className = "user-sub";
        sub.textContent = (user.position || "员工") + " · " + user.userid;
        main.append(title, sub);
        row.append(avatar, main);
        userList.appendChild(row);
      }
    }

    function loadSessionState(userid = currentUser.userid) {
      const store = loadSessionStore();
      if (!store.users[userid]) {
        store.users[userid] = createUserSessionState(userid);
        saveSessionStore(store);
      }
      return store.users[userid];
    }

    function loadSessionStore() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        if (parsed?.version === 2 && parsed.users && typeof parsed.users === "object") {
          return normalizeSessionStore(parsed);
        }
      } catch {}
      return migrateLegacySessionStore();
    }

    function saveSessionState() {
      const userid = currentUser.userid;
      try {
        const store = loadSessionStore();
        store.users[userid] = normalizeUserSessionState(sessionState, userid);
        saveSessionStore(store);
      } catch {}
    }

    function saveSessionStore(store) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSessionStore(store)));
    }

    function migrateLegacySessionStore() {
      const store = { version: 2, users: {} };
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
        if (Array.isArray(legacy?.sessions) && legacy.sessions.length) {
          store.users[currentUser.userid] = normalizeUserSessionState(legacy, currentUser.userid);
          saveSessionStore(store);
          return store;
        }
      } catch {}
      return store;
    }

    function normalizeSessionStore(raw) {
      const users = {};
      for (const [userid, state] of Object.entries(raw?.users || {})) {
        users[userid] = normalizeUserSessionState(state, userid);
      }
      return { version: 2, users };
    }

    function normalizeUserSessionState(raw, userid = currentUser.userid) {
      const sessions = Array.isArray(raw?.sessions)
        ? raw.sessions.map((session) => normalizeSession(session, userid))
        : [];
      if (!sessions.length) return createUserSessionState(userid);
      const activeSessionId = sessions.some((session) => session.id === raw?.activeSessionId)
        ? raw.activeSessionId
        : sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
      return { sessions, activeSessionId };
    }

    function createUserSessionState(userid = currentUser.userid) {
      const initial = createEmptySession({}, userid);
      return { sessions: [initial], activeSessionId: initial.id };
    }

    function createEmptySession(overrides, userid = currentUser.userid) {
      const now = Date.now();
      const id = createSessionId(userid);
      return {
        id,
        ownerUserId: userid,
        title: "新会话",
        manualTitle: false,
        createdAt: now,
        updatedAt: now,
        messages: INITIAL_MESSAGES.map((message) => ({ ...message, id: createMessageId() })),
        ...(overrides || {})
      };
    }

    function normalizeSession(raw, userid = currentUser.userid) {
      const session = raw || {};
      const normalized = createEmptySession({}, userid);
      return {
        ...normalized,
        ...session,
        id: normalizeSessionId(session.id, userid) || normalized.id,
        ownerUserId: userid,
        title: session.title || "新会话",
        createdAt: Number(session.createdAt || session.updatedAt || Date.now()),
        updatedAt: Number(session.updatedAt || Date.now()),
        messages: Array.isArray(session.messages) ? session.messages : normalized.messages
      };
    }

    function getActiveSession() {
      let session = sessionState.sessions.find((item) => item.id === sessionState.activeSessionId);
      if (!session) {
        session = sessionState.sessions[0] || createEmptySession();
        sessionState.activeSessionId = session.id;
        if (!sessionState.sessions.length) sessionState.sessions = [session];
      }
      return session;
    }

    function updateActiveSession(updater) {
      const activeId = sessionState.activeSessionId;
      sessionState.sessions = sessionState.sessions.map((session) => (
        session.id === activeId ? updater(session) : session
      ));
      saveSessionState();
    }

    function getMessage(messageId) {
      return getActiveSession().messages.find((message) => message.id === messageId);
    }

    function patchMessage(messageId, patch) {
      updateActiveSession((session) => ({
        ...session,
        messages: session.messages.map((message) => (
          message.id === messageId ? { ...message, ...patch } : message
        )),
        updatedAt: Date.now()
      }));
    }

    function appendMessageText(messageId, delta) {
      updateActiveSession((session) => ({
        ...session,
        messages: session.messages.map((message) => (
          message.id === messageId ? { ...message, text: (message.text || "") + delta } : message
        )),
        updatedAt: Date.now()
      }));
    }

    function appendProcessStep(messageId, rawStep, thinkingText) {
      updateActiveSession((session) => ({
        ...session,
        messages: session.messages.map((message) => {
          if (message.id !== messageId) return message;
          const nextSteps = Array.isArray(message.processSteps) ? message.processSteps.slice() : [];
          if (rawStep && typeof rawStep === "object") {
            const normalized = {
              phase: rawStep.phase,
              title: rawStep.title,
              detail: rawStep.detail,
              status: rawStep.status || "completed",
              action: rawStep.action,
              observation: rawStep.observation,
              at: rawStep.at
            };
            const previous = nextSteps[nextSteps.length - 1];
            if (!previous || previous.phase !== normalized.phase || previous.detail !== normalized.detail) {
              nextSteps.push(normalized);
            }
          }
          return {
            ...message,
            thinkingText,
            thinking: true,
            processStatus: "running",
            processSteps: nextSteps
          };
        }),
        updatedAt: Date.now()
      }));
    }

    function inferSessionTitle(session, messages) {
      if (session.manualTitle && session.title) return session.title;
      const firstUser = (messages || []).find((message) => message.role === "user" && message.text);
      if (firstUser?.text) return firstUser.text.replace(/\\s+/g, " ").trim().slice(0, 16) || "新会话";
      return "新会话";
    }

    function setChatLoading(value) {
      chatLoading = value;
      send.disabled = value;
      createSession.disabled = value;
      newSessionTop.disabled = value;
      openSessions.disabled = false;
    }

    function attachDebug(div, item) {
      if (!item?.debug) return;
      const details = document.createElement("details");
      details.className = "debug raw-debug";
      const summary = document.createElement("summary");
      summary.textContent = "原始 debug 数据";
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(item.debug, null, 2);
      details.append(summary, pre);
      div.appendChild(details);
    }

    function createArtifactCard(artifact) {
      const card = document.createElement("section");
      card.className = "artifact-card";

      const head = document.createElement("div");
      head.className = "artifact-head";
      const kicker = document.createElement("div");
      kicker.className = "artifact-kicker";
      kicker.textContent = artifact.type === "dealer_report" ? "经营报告" : "结构化产物";
      const title = document.createElement("div");
      title.className = "artifact-title";
      title.textContent = artifact.title || "结构化产物";
      const summary = document.createElement("div");
      summary.className = "artifact-summary";
      summary.textContent = artifact.summary || "";
      head.append(kicker, title, summary);
      card.appendChild(head);

      for (const section of artifact.sections || []) {
        const block = document.createElement("div");
        block.className = "artifact-section";
        const heading = document.createElement("h4");
        heading.textContent = section.title || "明细";
        block.appendChild(heading);
        block.appendChild(createArtifactTable(section.rows || []));
        card.appendChild(block);
      }
      return card;
    }

    function createArtifactTable(rows) {
      const table = document.createElement("table");
      table.className = "artifact-table";
      if (!rows.length) {
        const tbody = document.createElement("tbody");
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.textContent = "暂无数据";
        tr.appendChild(td);
        tbody.appendChild(tr);
        table.appendChild(tbody);
        return table;
      }

      const columns = Object.keys(rows[0]);
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      columns.forEach((column) => {
        const th = document.createElement("th");
        th.textContent = artifactColumnName(column);
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);

      const tbody = document.createElement("tbody");
      rows.forEach((row) => {
        const tr = document.createElement("tr");
        columns.forEach((column) => {
          const td = document.createElement("td");
          td.textContent = row[column] ?? "";
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.append(thead, tbody);
      return table;
    }

    function artifactColumnName(column) {
      return {
        store_name: "门店",
        critical: "严重",
        warning: "警示",
        score: "风险分",
        top_risk: "首要风险",
        item: "证据",
        owner: "负责人",
        action: "动作"
      }[column] || column;
    }

    function shouldShowRunPanel(item) {
      return Boolean(item.streaming || item.thinking || item.processSteps?.length || item.debug?.steps?.length || item.debug?.route || item.debug?.tool_calls?.length);
    }

    function createRunPanel(item) {
      const steps = normalizeRunSteps(item);
      const details = document.createElement("details");
      details.className = "run-panel";
      details.open = item.streaming || item.thinking || !item.streamed;

      const summary = document.createElement("summary");
      const title = document.createElement("div");
      title.className = "run-title";
      const dot = document.createElement("span");
      dot.className = "run-dot " + runStatusClass(item);
      const label = document.createElement("strong");
      label.textContent = item.streaming || item.thinking ? "正在执行任务" : "执行过程已完成";
      title.append(dot, label);

      const badge = document.createElement("span");
      badge.className = "run-badge";
      badge.textContent = buildRunBadgeText(item, steps);
      summary.append(title, badge);

      const subtitle = document.createElement("div");
      subtitle.className = "run-subtitle";
      subtitle.textContent = buildRunSubtitle(item);
      summary.appendChild(subtitle);

      const body = document.createElement("div");
      body.className = "run-body";
      const metadata = createRunMetadata(item);
      if (metadata) body.appendChild(metadata);

      const timeline = document.createElement("div");
      timeline.className = "run-timeline";
      if (!steps.length) {
        timeline.appendChild(createRunPlaceholder(item));
      } else {
        steps.forEach((step, index) => timeline.appendChild(createRunStep(step, index, item)));
      }
      body.appendChild(timeline);
      details.append(summary, body);
      return details;
    }

    function normalizeRunSteps(item) {
      const source = item.processSteps?.length ? item.processSteps : item.debug?.steps || [];
      return source.map((step, index) => ({
        phase: step.phase || step.id || "step_" + (index + 1),
        title: step.title || step.phase || "执行步骤",
        detail: step.detail || step.text || "",
        status: step.status || (item.streaming && index === source.length - 1 ? "running" : "completed"),
        action: step.action,
        observation: step.observation,
        at: step.at
      }));
    }

    function createRunMetadata(item) {
      const debug = item.debug || {};
      const chips = [];
      if (debug.route?.intent_code) chips.push("意图 " + debug.route.intent_code);
      if (debug.state?.task_mode) chips.push("模式 " + debug.state.task_mode);
      if (Number.isFinite(Number(debug.state?.round)) && Number(debug.state.round) > 1) chips.push("Loop " + debug.state.round + " 轮");
      if (debug.selected_skill) chips.push("Skill " + debug.selected_skill);
      if (debug.selected_tools?.length) chips.push("工具 " + debug.selected_tools.join(", "));
      if (debug.latency_ms) chips.push("耗时 " + formatDuration(debug.latency_ms));
      if (!chips.length && item.processSteps?.length) chips.push("实时步骤 " + item.processSteps.length + " 步");
      if (!chips.length) return null;
      const row = document.createElement("div");
      row.className = "run-metadata";
      chips.forEach((text) => {
        const chip = document.createElement("span");
        chip.className = "run-chip";
        chip.textContent = text;
        row.appendChild(chip);
      });
      return row;
    }

    function createRunStep(step, index, item) {
      const row = document.createElement("div");
      const status = normalizeStepStatus(step, index, item);
      row.className = "run-step " + status;

      const marker = document.createElement("div");
      marker.className = "run-step-marker";
      marker.textContent = status === "completed" ? "✓" : status === "error" ? "!" : index + 1;

      const card = document.createElement("div");
      card.className = "run-step-card";

      const head = document.createElement("div");
      head.className = "run-step-head";
      const title = document.createElement("div");
      title.className = "run-step-title";
      title.textContent = step.title;
      const phase = document.createElement("div");
      phase.className = "run-step-phase";
      phase.textContent = phaseLabel(step.phase);
      head.append(title, phase);

      const detail = document.createElement("div");
      detail.className = "run-step-detail";
      detail.textContent = step.detail || "正在处理...";

      card.append(head, detail);
      const extra = createRunStepExtra(step);
      if (extra) card.appendChild(extra);
      row.append(marker, card);
      return row;
    }

    function createRunStepExtra(step) {
      const values = [];
      if (step.action?.tool) values.push("tool: " + step.action.tool);
      if (step.action?.tools?.length) values.push("tools: " + step.action.tools.join(", "));
      if (step.action?.args?.resource) values.push("resource: " + step.action.args.resource);
      if (step.action?.args?.operation) values.push("operation: " + step.action.args.operation);
      if (step.observation?.resource) values.push("resource: " + step.observation.resource);
      if (Number.isFinite(Number(step.observation?.row_count))) values.push("rows: " + step.observation.row_count);
      if (Number.isFinite(Number(step.observation?.total))) values.push("total: " + step.observation.total);
      if (!values.length) return null;
      const extra = document.createElement("div");
      extra.className = "run-extra";
      values.slice(0, 6).forEach((value) => {
        const code = document.createElement("code");
        code.textContent = value;
        extra.appendChild(code);
      });
      return extra;
    }

    function createRunPlaceholder(item) {
      return createRunStep({
        phase: "running",
        title: item.streaming ? "等待执行事件" : "执行完成",
        detail: item.thinkingText || "暂未收到结构化执行步骤。",
        status: item.streaming ? "running" : "completed"
      }, 0, item);
    }

    function runStatusClass(item) {
      if (item.error) return "error";
      if (item.streaming || item.thinking) return "running";
      return "completed";
    }

    function normalizeStepStatus(step, index, item) {
      if (step.status === "failed" || step.status === "error") return "error";
      if ((item.streaming || item.thinking) && index === normalizeRunSteps(item).length - 1) return "running";
      return step.status === "running" ? "running" : "completed";
    }

    function buildRunBadgeText(item, steps) {
      if (item.streaming || item.thinking) return steps.length ? "第 " + steps.length + " 步" : "启动中";
      const round = Number(item.debug?.state?.round);
      if (Number.isFinite(round) && round > 1) return round + " 轮 Loop";
      return steps.length ? steps.length + " 步完成" : "已完成";
    }

    function buildRunSubtitle(item) {
      const debug = item.debug || {};
      if (item.streaming || item.thinking) {
        const steps = normalizeRunSteps(item);
        const last = steps[steps.length - 1];
        return last ? last.detail : "正在建立上下文、选择技能并执行工具。";
      }
      if (debug.route?.reason) return debug.route.reason;
      if (debug.state?.next_action?.reason) return debug.state.next_action.reason;
      return "已完成上下文理解、技能选择、工具执行和答复生成。";
    }

    function phaseLabel(phase) {
      const labels = {
        identify_user: "identity",
        classify_intent: "intent",
        select_skill: "skill",
        load_skill: "skill",
        retrieve_knowledge: "retrieve",
        plan_action: "plan",
        tool_round: "loop round",
        execute_tool: "tool",
        observe_result: "observe",
        plan_follow_up: "loop",
        plan_evidence: "evidence loop",
        final_answer: "answer",
        ask_user: "clarify"
      };
      return labels[phase] || phase || "step";
    }

    function formatDuration(ms) {
      const value = Number(ms);
      if (!Number.isFinite(value)) return "";
      if (value < 1000) return value + "ms";
      return (value / 1000).toFixed(value > 10000 ? 0 : 1) + "s";
    }

    function createSessionId(userid = currentUser.userid) {
      return userid + ":session-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    }

    function normalizeSessionId(id, userid = currentUser.userid) {
      if (!id) return null;
      const text = String(id);
      return text.startsWith(userid + ":") ? text : userid + ":" + text;
    }

    function createMessageId() {
      return "msg-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    }

    function formatTime(value) {
      const date = new Date(value || Date.now());
      return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }

    function normalizeStreamText(text) {
      return String(text || "")
        .replace(/\\\\n/g, "\\n")
        .replace(/\\\\r/g, "\\r")
        .replace(/\\\\t/g, "\\t")
        .replace(/\\\\"/g, '"');
    }

    function renderMarkdown(source) {
      const lines = String(source || "").replace(/\\r\\n/g, "\\n").split("\\n");
      const html = [];
      let paragraph = [];
      let listType = null;
      let listItems = [];
      let inCode = false;
      let codeLines = [];

      const flushParagraph = () => {
        if (!paragraph.length) return;
        html.push("<p>" + renderInlineMarkdown(paragraph.join(" ")) + "</p>");
        paragraph = [];
      };
      const flushList = () => {
        if (!listType) return;
        html.push("<" + listType + ">" + listItems.map((item) => "<li>" + renderInlineMarkdown(item) + "</li>").join("") + "</" + listType + ">");
        listType = null;
        listItems = [];
      };
      const flushCode = () => {
        if (!inCode) return;
        html.push("<pre><code>" + escapeHtml(codeLines.join("\\n")) + "</code></pre>");
        inCode = false;
        codeLines = [];
      };
      const fence = String.fromCharCode(96) + String.fromCharCode(96) + String.fromCharCode(96);

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const trimmed = line.trim();

        if (trimmed.startsWith(fence)) {
          if (inCode) {
            flushCode();
          } else {
            flushParagraph();
            flushList();
            inCode = true;
            codeLines = [];
          }
          continue;
        }
        if (inCode) {
          codeLines.push(line);
          continue;
        }

        if (!trimmed) {
          flushParagraph();
          flushList();
          continue;
        }

        if (isTableStart(lines, index)) {
          flushParagraph();
          flushList();
          const table = collectTable(lines, index);
          html.push(renderTable(table.rows));
          index = table.nextIndex - 1;
          continue;
        }

        const heading = trimmed.match(/^(#{1,3})\\s+(.+)$/);
        if (heading) {
          flushParagraph();
          flushList();
          const level = heading[1].length;
          html.push("<h" + level + ">" + renderInlineMarkdown(heading[2]) + "</h" + level + ">");
          continue;
        }

        if (trimmed.startsWith(">")) {
          flushParagraph();
          flushList();
          html.push("<blockquote>" + renderInlineMarkdown(trimmed.replace(/^>\\s?/, "")) + "</blockquote>");
          continue;
        }

        const unordered = trimmed.match(/^[-*]\\s+(.+)$/);
        const ordered = trimmed.match(/^\\d+[.)]\\s+(.+)$/);
        if (unordered || ordered) {
          flushParagraph();
          const nextType = unordered ? "ul" : "ol";
          if (listType && listType !== nextType) flushList();
          listType = nextType;
          listItems.push((unordered || ordered)[1]);
          continue;
        }

        paragraph.push(trimmed);
      }

      flushCode();
      flushParagraph();
      flushList();
      return html.join("");
    }

    function renderInlineMarkdown(source) {
      let output = escapeHtml(source);
      const tick = String.fromCharCode(96);
      const codePattern = new RegExp(tick + "([^" + tick + "]+)" + tick, "g");
      output = output.replace(codePattern, "<code>$1</code>");
      output = output.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
      output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
      output = output.replace(/\\*([^*]+)\\*/g, "<em>$1</em>");
      return output;
    }

    function isTableStart(lines, index) {
      const current = lines[index]?.trim();
      const next = lines[index + 1]?.trim();
      return Boolean(current?.includes("|") && /^\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)+\\|?$/.test(next || ""));
    }

    function collectTable(lines, startIndex) {
      const rows = [];
      let index = startIndex;
      while (index < lines.length && lines[index].trim().includes("|")) {
        if (index !== startIndex + 1) rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      return { rows, nextIndex: index };
    }

    function splitTableRow(line) {
      return line.trim().replace(/^\\|/, "").replace(/\\|$/, "").split("|").map((cell) => cell.trim());
    }

    function renderTable(rows) {
      if (!rows.length) return "";
      const head = rows[0];
      const body = rows.slice(1);
      return "<table><thead><tr>"
        + head.map((cell) => "<th>" + renderInlineMarkdown(cell) + "</th>").join("")
        + "</tr></thead><tbody>"
        + body.map((row) => "<tr>" + row.map((cell) => "<td>" + renderInlineMarkdown(cell) + "</td>").join("") + "</tr>").join("")
        + "</tbody></table>";
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]);
    }
  </script>
</body>
</html>`;
}
