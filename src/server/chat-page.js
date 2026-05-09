export function renderChatPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Enterprise Agent MVP</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --text: #20242a;
      --muted: #68707d;
      --line: #dfe3ea;
      --accent: #2563eb;
      --accent-soft: #eef4ff;
      --danger: #b42318;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    button, input, textarea { border: 1px solid var(--line); border-radius: 6px; font: inherit; }
    input, textarea { background: white; color: var(--text); }
    button { background: var(--accent); color: white; border-color: var(--accent); cursor: pointer; }
    button:disabled { opacity: 0.55; cursor: wait; }
    main { height: 100vh; height: 100dvh; overflow: hidden; display: flex; flex-direction: column; }
    .topbar {
      height: 58px;
      flex: 0 0 58px;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 12px;
      padding: 0 18px;
    }
    .topbar h1 { font-size: 16px; margin: 0; }
    .plain-btn {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: white;
      color: var(--text);
      padding: 0;
    }
    .session-title-inline { min-width: 0; display: grid; gap: 2px; }
    .session-title-inline strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-title-inline small { color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .topbar-actions { display: flex; align-items: center; gap: 10px; }
    .debug-control { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
    .debug-control input { width: 15px; height: 15px; margin: 0; }
    .messages { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 18px; display: flex; flex-direction: column; gap: 12px; }
    .msg {
      max-width: min(860px, 86vw);
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 12px 14px;
      line-height: 1.55;
    }
    .user { align-self: flex-end; background: var(--accent-soft); border-color: #c8dafd; }
    .assistant { align-self: flex-start; }
    .msg-text:empty::after { content: "正在生成"; color: var(--muted); }
    .markdown { white-space: normal; }
    .markdown > *:first-child { margin-top: 0; }
    .markdown > *:last-child { margin-bottom: 0; }
    .markdown h1, .markdown h2, .markdown h3 {
      margin: 10px 0 8px;
      line-height: 1.3;
      font-weight: 700;
    }
    .markdown h1 { font-size: 22px; }
    .markdown h2 { font-size: 18px; }
    .markdown h3 { font-size: 16px; }
    .markdown p { margin: 8px 0; }
    .markdown ul, .markdown ol { margin: 8px 0; padding-left: 22px; }
    .markdown li { margin: 4px 0; }
    .markdown blockquote {
      margin: 10px 0;
      padding: 8px 10px;
      border-left: 3px solid #9bb8f5;
      background: #f7faff;
      color: #44536a;
      border-radius: 6px;
    }
    .markdown code {
      padding: 2px 5px;
      border-radius: 5px;
      background: #eef2f7;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
    }
    .markdown pre {
      overflow: auto;
      margin: 10px 0;
      padding: 10px;
      border-radius: 8px;
      background: #111827;
      color: #f9fafb;
      white-space: pre;
    }
    .markdown pre code { padding: 0; background: transparent; color: inherit; }
    .markdown table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 14px;
      display: block;
      overflow-x: auto;
    }
    .markdown th, .markdown td {
      border: 1px solid #d7deea;
      padding: 7px 9px;
      text-align: left;
      vertical-align: top;
    }
    .markdown th { background: #f4f7fb; font-weight: 700; }
    .composer {
      flex: 0 0 auto;
      padding: 12px 18px;
      background: var(--panel);
      border-top: 1px solid var(--line);
      display: grid;
      grid-template-columns: 1fr 96px;
      gap: 10px;
    }
    textarea { resize: vertical; min-height: 64px; max-height: 180px; padding: 10px; }
    .composer button { padding: 10px 12px; }
    .debug { margin-top: 8px; font-size: 12px; color: var(--muted); }
    details pre { overflow: auto; background: #f2f4f7; padding: 10px; border-radius: 6px; }
    .thinking-panel {
      margin-bottom: 10px;
      padding: 8px 10px;
      border: 1px solid #d8e2f7;
      border-radius: 8px;
      background: #f8fbff;
      color: #44536a;
      font-size: 13px;
      white-space: normal;
    }
    .thinking-panel summary { cursor: pointer; color: #315a9b; font-weight: 600; }
    .thinking-body { margin-top: 6px; white-space: pre-wrap; line-height: 1.5; }
    .session-sidebar-layer, .modal-backdrop {
      position: fixed;
      inset: 0;
      display: none;
      z-index: 30;
    }
    .session-sidebar-layer.open, .modal-backdrop.open { display: block; }
    .session-sidebar-backdrop, .modal-dim {
      position: absolute;
      inset: 0;
      border: 0;
      border-radius: 0;
      background: rgba(17, 24, 39, 0.42);
    }
    .session-sidebar {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: min(360px, 88vw);
      background: var(--panel);
      border-right: 1px solid var(--line);
      box-shadow: 18px 0 48px rgba(15, 23, 42, 0.18);
      display: flex;
      flex-direction: column;
    }
    .session-sidebar-head {
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      border-bottom: 1px solid var(--line);
    }
    .session-sidebar-head strong { font-size: 18px; }
    .session-create-row {
      margin: 14px 16px 8px;
      padding: 11px 12px;
      border: 1px solid var(--line);
      background: #f8fafc;
      color: var(--text);
      text-align: left;
    }
    .session-list { overflow: auto; padding: 0 12px 16px; display: grid; gap: 6px; }
    .session-item {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
      padding: 9px 8px;
      border-radius: 8px;
    }
    .session-item.active { background: #eef4ff; }
    .session-open { border: 0; background: transparent; color: var(--text); text-align: left; padding: 0; min-width: 0; }
    .session-open strong, .session-open small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-open small { color: var(--muted); font-size: 11px; margin-top: 3px; }
    .session-actions { display: flex; gap: 4px; }
    .session-icon-btn {
      width: 28px;
      height: 28px;
      border: 0;
      background: transparent;
      color: var(--muted);
      padding: 0;
    }
    .session-icon-btn.danger:hover { color: var(--danger); }
    .session-rename-form { grid-column: 1 / -1; display: flex; gap: 6px; }
    .session-rename-form input { flex: 1; min-width: 0; padding: 8px; }
    .session-rename-form button { padding: 8px 10px; }
    .identity-fab {
      position: fixed;
      right: 24px;
      bottom: 92px;
      width: 72px;
      height: 72px;
      border-radius: 999px;
      border: 0;
      background: #d1d5db;
      color: #1f2937;
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.22);
      display: grid;
      place-items: center;
      padding: 0;
      z-index: 20;
    }
    .identity-fab span { font-size: 30px; font-weight: 700; line-height: 1; }
    .identity-badge {
      position: fixed;
      right: 108px;
      bottom: 106px;
      max-width: min(320px, calc(100vw - 140px));
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 8px 10px;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.12);
      z-index: 19;
      font-size: 12px;
      color: var(--muted);
    }
    .identity-badge strong { display: block; color: var(--text); font-size: 14px; margin-bottom: 2px; }
    .user-modal {
      position: absolute;
      left: 50%;
      bottom: 0;
      transform: translateX(-50%);
      width: min(760px, 100vw);
      max-height: min(760px, 92vh);
      background: var(--panel);
      border-radius: 14px 14px 0 0;
      overflow: hidden;
      box-shadow: 0 -18px 60px rgba(15, 23, 42, 0.24);
      display: flex;
      flex-direction: column;
    }
    .modal-head {
      height: 60px;
      display: grid;
      grid-template-columns: 44px 1fr 44px;
      align-items: center;
      padding: 0 14px;
      border-bottom: 1px solid var(--line);
    }
    .modal-head h2 { margin: 0; text-align: center; font-size: 20px; font-weight: 600; }
    .icon-button {
      width: 36px;
      height: 36px;
      border-radius: 999px;
      border: 0;
      color: var(--muted);
      background: transparent;
      font-size: 28px;
      line-height: 1;
      padding: 0;
    }
    .search-row { position: relative; padding: 12px 18px; border-bottom: 1px solid var(--line); }
    .search-row input {
      width: 100%;
      height: 42px;
      border: 0;
      border-bottom: 1px solid var(--line);
      border-radius: 0;
      padding: 0 38px 0 0;
      font-size: 16px;
      outline: 0;
    }
    .clear-search {
      position: absolute;
      right: 18px;
      top: 15px;
      width: 34px;
      height: 34px;
      border: 0;
      background: transparent;
      color: #3b5f9e;
      font-size: 24px;
      padding: 0;
    }
    .user-list { overflow: auto; padding: 0 18px 18px; }
    .user-row {
      width: 100%;
      display: grid;
      grid-template-columns: 44px 1fr;
      gap: 12px;
      align-items: center;
      min-height: 72px;
      border: 0;
      border-bottom: 1px solid #edf0f4;
      border-radius: 0;
      background: white;
      color: var(--text);
      text-align: left;
      padding: 10px 0;
    }
    .user-row:hover { background: #f8fafc; }
    .user-row.active { background: #eef4ff; }
    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      background: #e5e7eb;
      color: #374151;
      font-weight: 700;
      font-size: 18px;
    }
    .user-main { min-width: 0; }
    .user-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .user-title strong { font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .user-sub { color: var(--muted); font-size: 13px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .selected-mark { margin-left: auto; color: var(--accent); font-size: 13px; flex: 0 0 auto; }
    .empty { color: var(--muted); padding: 28px 0; text-align: center; }
    @media (max-width: 760px) {
      .topbar { height: auto; min-height: 58px; grid-template-columns: auto 1fr auto; padding: 10px 12px; }
      .topbar h1 { display: none; }
      .topbar-actions { gap: 8px; }
      .composer { grid-template-columns: 1fr; padding-bottom: 20px; }
      .identity-fab { right: 18px; bottom: 112px; width: 64px; height: 64px; }
      .identity-badge { display: none; }
      .msg { max-width: 92vw; }
    }
  </style>
</head>
<body>
  <main>
    <div class="topbar">
      <button id="openSessions" class="plain-btn" type="button" aria-label="打开会话">☰</button>
      <div class="session-title-inline">
        <strong id="activeSessionTitle">新会话</strong>
        <small id="activeSessionMeta">session</small>
      </div>
      <div class="topbar-actions">
        <button id="newSessionTop" class="plain-btn" type="button" aria-label="新建会话">＋</button>
        <label class="debug-control">
          <input id="debugMode" type="checkbox" checked />
          debug
        </label>
      </div>
    </div>
    <div id="messages" class="messages"></div>
    <form id="form" class="composer">
      <textarea id="message" placeholder="输入问题或业务指令"></textarea>
      <button id="send" type="submit">发送</button>
    </form>
  </main>

  <div id="sessionLayer" class="session-sidebar-layer" aria-hidden="true">
    <button id="sessionBackdrop" class="session-sidebar-backdrop" type="button" aria-label="关闭会话侧边栏"></button>
    <aside class="session-sidebar" aria-label="会话管理">
      <div class="session-sidebar-head">
        <strong>会话</strong>
        <button id="closeSessions" class="icon-button" type="button" aria-label="关闭">×</button>
      </div>
      <button id="createSession" class="session-create-row" type="button">新建会话</button>
      <div id="sessionList" class="session-list"></div>
    </aside>
  </div>

  <div id="identityBadge" class="identity-badge"></div>
  <button id="identityFab" class="identity-fab" type="button" title="更改登录用户"><span id="identityInitial">员</span></button>

  <div id="userModal" class="modal-backdrop" aria-hidden="true">
    <button id="modalDim" class="modal-dim" type="button" aria-label="关闭"></button>
    <div class="user-modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-head">
        <span></span>
        <h2 id="modalTitle">更改登录用户</h2>
        <button id="closeModal" class="icon-button" type="button" aria-label="关闭">×</button>
      </div>
      <div class="search-row">
        <input id="userSearch" autocomplete="off" placeholder="搜索姓名、岗位、部门、userid" />
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
        patchMessage(assistantMessageId, {
          thinkingText: normalizeStreamText(payload.text || ""),
          thinking: true
        });
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
        patchMessage(assistantMessageId, {
          text: payload.answer || getMessage(assistantMessageId)?.text || "",
          sources: payload.sources || [],
          debug: payload.debug,
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

        if (item.role === "assistant" && item.thinkingText) {
          const thinking = document.createElement("details");
          thinking.className = "thinking-panel";
          if (item.thinking) thinking.open = true;
          const summary = document.createElement("summary");
          summary.textContent = item.thinking ? "执行过程" : "执行过程已完成";
          const body = document.createElement("div");
          body.className = "thinking-body";
          body.textContent = item.thinkingText;
          thinking.append(summary, body);
          div.appendChild(thinking);
        }

        const text = document.createElement("div");
        text.className = "msg-text" + (item.role === "assistant" ? " markdown" : "");
        if (item.role === "assistant") {
          text.innerHTML = renderMarkdown(item.text || "");
        } else {
          text.textContent = item.text || "";
        }
        div.appendChild(text);

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
        open.querySelector("small").textContent = formatTime(session.updatedAt) + " · " + session.messages.length + " 条消息";
        open.addEventListener("click", () => applySession(session.id));

        const actions = document.createElement("div");
        actions.className = "session-actions";
        const rename = document.createElement("button");
        rename.className = "session-icon-btn";
        rename.type = "button";
        rename.textContent = "改";
        rename.disabled = chatLoading;
        rename.addEventListener("click", () => startRenamingSession(session));
        const del = document.createElement("button");
        del.className = "session-icon-btn danger";
        del.type = "button";
        del.textContent = "删";
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
      identityBadge.innerHTML = "<strong>" + escapeHtml(currentUser.name || currentUser.userid) + "</strong>"
        + escapeHtml((currentUser.department_name || "未知部门") + " / " + (currentUser.position || "员工"));
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
        name.textContent = (user.name || user.userid) + "/" + (user.department_name || "未知部门");
        title.append(name);
        if (user.userid === currentUser.userid) {
          const selected = document.createElement("span");
          selected.className = "selected-mark";
          selected.textContent = "已选";
          title.appendChild(selected);
        }

        const sub = document.createElement("div");
        sub.className = "user-sub";
        sub.textContent = (user.position || "员工") + " / " + user.userid;
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
      details.className = "debug";
      const summary = document.createElement("summary");
      summary.textContent = "debug";
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(item.debug, null, 2);
      details.append(summary, pre);
      div.appendChild(details);
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
