export function renderChatPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LangClaw Agent</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #ffffff;
      --sidebar: #f7f7f8;
      --text: #111111;
      --muted: #737373;
      --faint: #9b9b9b;
      --border: #e7e7e7;
      --soft: #f4f4f5;
      --hover: #eeeeef;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; overflow: hidden; background: var(--bg); color: var(--text); }
    body { font-size: 14px; }
    main { height: 100%; min-height: 0; display: grid; grid-template-columns: 278px 1fr; }
    .sidebar {
      min-width: 0; height: 100%; display: grid; grid-template-rows: auto auto 1fr auto; gap: 12px;
      padding: 12px; border-right: 1px solid var(--border); background: var(--sidebar);
    }
    .sidebar-backdrop { display: none; }
    .side-head { display: flex; align-items: center; justify-content: space-between; min-height: 36px; gap: 10px; }
    .brand { display: flex; align-items: center; gap: 10px; min-width: 0; font-weight: 650; }
    .brand span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mark { width: 28px; height: 28px; flex: 0 0 auto; border-radius: 6px; background: #111; position: relative; overflow: hidden; }
    .mark::before, .mark::after { content: ""; position: absolute; left: 8px; right: 8px; height: 2px; border-radius: 2px; background: #fff; transform: rotate(-24deg); }
    .mark::before { top: 10px; }
    .mark::after { top: 16px; opacity: .72; }
    .side-actions { display: grid; gap: 8px; }
    .new-chat-btn {
      width: 100%; height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
      border: 1px solid #dadada; background: #fff; color: #111; border-radius: 8px; padding: 0 11px;
      font: inherit; font-weight: 500; cursor: pointer; transition: background .14s ease, border-color .14s ease;
    }
    .new-chat-btn:hover { background: var(--soft); border-color: #cfcfcf; }
    .new-chat-btn:disabled { opacity: .5; cursor: not-allowed; }
    .session-search {
      width: 100%; height: 36px; border: 1px solid transparent; background: #fff; border-radius: 8px;
      padding: 0 10px; color: #111; font: inherit; outline: none;
    }
    .session-search { border-color: #ededed; }
    .session-search:focus { border-color: #cfcfcf; }
    .session-list { min-height: 0; overflow-y: auto; display: grid; align-content: start; gap: 2px; padding: 2px 0; }
    .session-section-label { padding: 8px 8px 5px; color: var(--faint); font-size: 12px; }
    .session-item {
      width: 100%; min-height: 34px; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 6px;
      background: transparent; color: #333; border-radius: 8px; padding: 5px 6px; position: relative;
    }
    .session-item:hover { background: var(--hover); }
    .session-item.active { background: #e9e9ea; color: #111; }
    .session-open {
      min-width: 0; min-height: 24px; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px;
      border: 0; background: transparent; color: inherit; padding: 0 2px; font: inherit; text-align: left; cursor: pointer;
    }
    .session-open:disabled { opacity: .55; cursor: not-allowed; }
    .session-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
    .session-time { color: var(--faint); font-size: 11px; font-variant-numeric: tabular-nums; }
    .session-actions { display: inline-flex; align-items: center; gap: 2px; opacity: 0; pointer-events: none; }
    .session-item:hover .session-actions, .session-item.active .session-actions, .session-item:focus-within .session-actions { opacity: 1; pointer-events: auto; }
    .session-item:hover .session-time, .session-item.active .session-time, .session-item:focus-within .session-time { display: none; }
    .session-action {
      width: 24px; height: 24px; display: grid; place-items: center; border: 0; border-radius: 5px;
      background: transparent; color: #747474; cursor: pointer; padding: 0;
    }
    .session-action:hover { background: #dedede; color: #111; }
    .session-action:disabled { opacity: .45; cursor: not-allowed; }
    .session-rename {
      width: 100%; min-width: 0; height: 24px; border: 1px solid #cfcfcf; border-radius: 5px;
      padding: 0 6px; font: inherit; font-size: 13px; outline: none; background: #fff;
    }
    .empty-sessions { padding: 12px 8px; color: var(--muted); font-size: 13px; line-height: 1.5; }
    .side-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-top: 1px solid var(--border); padding-top: 10px; }
    .side-user { min-width: 0; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .iconbtn {
      height: 32px; border: 1px solid var(--border); background: #fff; border-radius: 6px; padding: 0 10px; color: #111;
      font: inherit; cursor: pointer; transition: background .14s ease, border-color .14s ease;
    }
    .iconbtn:hover { background: var(--soft); border-color: #d4d4d4; }
    .iconbtn:disabled { opacity: .45; cursor: not-allowed; }
    .dangerbtn { color: var(--muted); }
    .dangerbtn:hover { color: #111; }
    .chat-shell { min-width: 0; min-height: 0; height: 100%; display: grid; grid-template-rows: 56px minmax(0, 1fr) auto; background: #fff; }
    .topbar {
      display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 20px; border-bottom: 1px solid var(--border);
      background: rgba(255,255,255,.92); backdrop-filter: blur(16px);
    }
    .top-left { min-width: 0; display: flex; align-items: center; gap: 12px; flex: 1 1 auto; }
    .top-controls { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
    .person-picker { position: relative; }
    .person-trigger {
      height: 36px; min-width: 156px; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 6px;
      border: 1px solid var(--border); border-radius: 8px; background: #fff; color: #111; font: inherit;
      cursor: pointer; transition: background .14s ease, border-color .14s ease;
    }
    .person-trigger:hover { background: var(--soft); border-color: #d4d4d4; }
    .person-trigger:disabled { opacity: .55; cursor: not-allowed; }
    .person-avatar {
      width: 24px; height: 24px; border-radius: 99px; background: #111; color: #fff; display: grid; place-items: center;
      font-size: 12px; font-weight: 650; flex: 0 0 auto;
    }
    .person-meta { min-width: 0; display: grid; line-height: 1.18; text-align: left; }
    .person-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 550; }
    .person-role { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11px; }
    .person-caret { margin-left: auto; color: var(--faint); font-size: 12px; }
    .person-modal-backdrop {
      display: none; position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,.22);
      align-items: center; justify-content: center; padding: 24px;
    }
    body.person-modal-open .person-modal-backdrop { display: flex; }
    .person-modal {
      width: min(520px, calc(100vw - 32px)); max-height: min(680px, calc(100vh - 48px));
      display: grid; grid-template-rows: auto auto 1fr; background: #fff; border: 1px solid var(--border);
      border-radius: 10px; box-shadow: 0 24px 70px rgba(0,0,0,.22); overflow: hidden;
    }
    .person-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .person-modal-title { font-weight: 650; font-size: 15px; }
    .person-close { width: 30px; height: 30px; border: 1px solid var(--border); background: #fff; border-radius: 6px; cursor: pointer; }
    .person-search-wrap { padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .person-search {
      width: 100%; height: 38px; border: 1px solid var(--border); border-radius: 8px; padding: 0 11px;
      font: inherit; outline: none; background: #fff;
    }
    .person-search:focus { border-color: #c8c8c8; }
    .person-menu { min-height: 0; overflow-y: auto; padding: 6px; display: grid; align-content: start; gap: 2px; }
    .person-option {
      width: 100%; border: 0; background: transparent; border-radius: 6px; padding: 8px; display: flex; align-items: center; gap: 8px;
      font: inherit; color: #111; text-align: left; cursor: pointer;
    }
    .person-option:hover, .person-option.active { background: var(--soft); }
    .person-option .person-avatar { width: 26px; height: 26px; }
    .person-empty { padding: 18px 10px; color: var(--muted); font-size: 13px; text-align: center; }
    .debug-toggle {
      height: 32px; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px;
      border: 1px solid var(--border); border-radius: 6px; background: #fff; color: var(--muted);
      font-size: 13px; user-select: none; cursor: pointer;
    }
    .debug-toggle input { width: 13px; height: 13px; margin: 0; accent-color: #111; }
    .sidebar-toggle { display: none; }
    .top-title { min-width: 0; display: grid; gap: 1px; }
    .top-title strong { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .top-title span { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .messages {
      min-height: 0; overflow-x: hidden; overflow-y: auto; padding: 28px 20px; display: flex; flex-direction: column; gap: 22px; align-items: center;
    }
    .msg { width: min(820px, 100%); line-height: 1.72; font-size: 15px; }
    .msg.user { display: flex; justify-content: flex-end; }
    .bubble { max-width: min(640px, 100%); background: var(--soft); border: 1px solid #ededed; border-radius: 8px; padding: 11px 15px; }
    .assistant-body { padding: 0 4px; }
    .composer { flex: 0 0 auto; padding: 16px 20px 22px; background: linear-gradient(to top, #fff 80%, rgba(255,255,255,0)); }
    .composer-inner {
      width: min(820px, 100%); margin: 0 auto; display: flex; gap: 10px; align-items: center;
      border: 1px solid #d4d4d4; border-radius: 8px; padding: 9px 9px 9px 14px; background: #fff;
      box-shadow: 0 16px 44px rgba(0,0,0,.09);
    }
    textarea {
      flex: 1; border: 0; outline: 0; resize: none; min-height: 36px; max-height: 180px;
      font: inherit; line-height: 24px; padding: 6px 0; overflow-y: hidden;
    }
    .send { height: 36px; min-width: 72px; border: 0; border-radius: 6px; background: #111; color: #fff; font-weight: 600; cursor: pointer; }
    .send:disabled { background: #cfcfcf; cursor: not-allowed; }
    .hint { width: min(820px, calc(100vw - 40px)); margin: 7px auto 0; color: var(--faint); font-size: 12px; }
    .run-panel { margin: 0 0 12px; border: 0; background: transparent; }
    .run-panel summary {
      min-height: 28px; padding: 0 0 10px; display: flex; align-items: center; gap: 8px;
      border-bottom: 1px solid #eeeeee; list-style: none; cursor: pointer; color: #8a8a8a;
    }
    .run-panel summary::-webkit-details-marker { display: none; }
    .run-title { display: flex; align-items: center; gap: 6px; }
    .run-title strong { font-size: 14px; font-weight: 400; color: #8a8a8a; }
    .run-dot { width: 6px; height: 6px; border-radius: 99px; background: #c7c7c7; }
    .run-dot.running { background: #111; animation: pulseDot 1.25s ease-in-out infinite; }
    .run-panel:has(.run-dot.running) .run-title strong {
      color: transparent;
      background-image: linear-gradient(100deg, #737373 0%, #737373 35%, #111 50%, #737373 65%, #737373 100%);
      background-size: 240% 100%; background-position: 120% 0; -webkit-background-clip: text; background-clip: text;
      animation: runTextSweep 1.7s ease-in-out infinite;
    }
    @keyframes runTextSweep { from { background-position: 120% 0; } to { background-position: -120% 0; } }
    @keyframes pulseDot { 0%,100% { opacity:.65; transform:scale(1); } 50% { opacity:1; transform:scale(1.35); } }
    .run-duration { color: #8a8a8a; font-size: 14px; font-variant-numeric: tabular-nums; }
    .run-chevron { color: #9ca3af; transition: transform .16s ease; display: grid; place-items: center; }
    .run-panel[open] .run-chevron { transform: rotate(90deg); }
    .run-body { padding: 10px 0 2px; display: grid; gap: 10px; }
    .thought { color: #303030; font-size: 15px; line-height: 1.72; white-space: pre-wrap; }
    .tool-line { color: #8a8a8a; font-size: 13px; display: flex; align-items: center; gap: 6px; }
    .tool-icon { width: 14px; height: 14px; border: 1px solid #bdbdbd; border-radius: 3px; display: inline-grid; place-items: center; font-size: 10px; color: #8a8a8a; }
    .sources { margin-top: 12px; color: var(--muted); font-size: 12px; }
    .error { color: #dc2626; }
    .markdown p { margin: 0 0 12px; }
    .markdown h1, .markdown h2, .markdown h3 { margin: 16px 0 8px; line-height: 1.35; }
    .markdown ul, .markdown ol { padding-left: 22px; }
    .markdown code { background: var(--soft); padding: 2px 5px; border-radius: 4px; }
    .markdown table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 14px; }
    .markdown th, .markdown td { border: 1px solid var(--border); padding: 7px 9px; text-align: left; }
    @media (max-width: 760px) {
      main { grid-template-columns: 1fr; }
      .sidebar {
        position: fixed; inset: 0 auto 0 0; width: min(86vw, 312px); z-index: 20; transform: translateX(-100%);
        transition: transform .18s ease; box-shadow: 18px 0 40px rgba(0,0,0,.12);
      }
      body.sidebar-open .sidebar { transform: translateX(0); }
      .sidebar-backdrop { display: none; position: fixed; inset: 0; z-index: 10; background: rgba(0,0,0,.18); }
      body.sidebar-open .sidebar-backdrop { display: block; }
      .sidebar-toggle { display: inline-grid; place-items: center; width: 34px; height: 34px; border: 1px solid var(--border); background: #fff; border-radius: 6px; }
      .chat-shell { grid-template-rows: 52px 1fr auto; }
      .topbar { padding: 0 14px; }
      .person-trigger { min-width: 132px; max-width: 154px; padding: 0 8px 0 6px; }
      .person-trigger .person-role { display: none; }
      .person-trigger .person-caret { display: inline; }
      .person-modal-backdrop { padding: 14px; align-items: flex-start; }
      .person-modal { margin-top: 42px; max-height: calc(100vh - 84px); }
      .debug-toggle span { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <aside class="sidebar" aria-label="&#x4F1A;&#x8BDD;&#x7BA1;&#x7406;">
      <div class="side-head">
        <div class="brand"><div class="mark" aria-hidden="true"></div><span>LangClaw</span></div>
      </div>
      <div class="side-actions">
        <button id="newChat" class="new-chat-btn" type="button"><span>&#x65B0;&#x4F1A;&#x8BDD;</span><span aria-hidden="true">+</span></button>
        <input id="sessionSearch" class="session-search" type="search" placeholder="&#x641C;&#x7D22;&#x4F1A;&#x8BDD;" autocomplete="off" />
      </div>
      <nav id="sessionList" class="session-list" aria-label="&#x5386;&#x53F2;&#x4F1A;&#x8BDD;"></nav>
      <div class="side-foot">
        <div id="sideUser" class="side-user"></div>
        <button id="deleteChat" class="iconbtn dangerbtn" type="button">&#x5220;&#x9664;</button>
      </div>
    </aside>
    <div id="sidebarBackdrop" class="sidebar-backdrop" aria-hidden="true"></div>
    <section class="chat-shell">
      <div class="topbar">
        <div class="top-left">
          <button id="sidebarToggle" class="sidebar-toggle" type="button" aria-label="&#x6253;&#x5F00;&#x4F1A;&#x8BDD;&#x5217;&#x8868;">&#9776;</button>
          <div class="top-title">
            <strong id="chatTitle"></strong>
            <span id="chatSubtitle"></span>
          </div>
        </div>
        <div class="top-controls">
          <div id="personPicker" class="person-picker">
            <button id="personTrigger" class="person-trigger" type="button" aria-haspopup="dialog" aria-expanded="false">
              <span id="personAvatar" class="person-avatar" aria-hidden="true"></span>
              <span class="person-meta">
                <span id="personName" class="person-name"></span>
                <span id="personRole" class="person-role"></span>
              </span>
              <span class="person-caret" aria-hidden="true">⌄</span>
            </button>
          </div>
          <label class="debug-toggle" title="Debug">
            <input id="debugToggle" type="checkbox" checked />
            <span>Debug</span>
          </label>
        </div>
      </div>
      <div id="messages" class="messages"></div>
      <form id="form" class="composer">
        <div class="composer-inner">
          <textarea id="input" rows="1" placeholder="&#x8F93;&#x5165;&#x95EE;&#x9898;&#x6216;&#x4E1A;&#x52A1;&#x6307;&#x4EE4;"></textarea>
          <button id="send" class="send" type="submit">&#x53D1;&#x9001;</button>
        </div>
        <div class="hint">Enter &#x53D1;&#x9001; &#183; Shift+Enter &#x6362;&#x884C;</div>
      </form>
    </section>
    <div id="personModalBackdrop" class="person-modal-backdrop" aria-hidden="true">
      <div class="person-modal" role="dialog" aria-modal="true" aria-labelledby="personModalTitle">
        <div class="person-modal-head">
          <div id="personModalTitle" class="person-modal-title">&#x9009;&#x62E9;&#x4EBA;&#x5458;</div>
          <button id="personClose" class="person-close" type="button" aria-label="&#x5173;&#x95ED;">×</button>
        </div>
        <div class="person-search-wrap">
          <input id="personSearch" class="person-search" type="search" placeholder="&#x641C;&#x7D22;&#x59D3;&#x540D;&#x3001;&#x5C97;&#x4F4D;&#x6216;&#x90E8;&#x95E8;" autocomplete="off" />
        </div>
        <div id="personMenu" class="person-menu" role="listbox" aria-label="&#x9009;&#x62E9;&#x4EBA;&#x5458;"></div>
      </div>
    </div>
  </main>
  <script>
    const STR = {
      welcome: "\\u4f60\\u597d\\uff0c\\u6211\\u662f\\u4f01\\u4e1a Agent\\u3002\\u4f60\\u53ef\\u4ee5\\u8be2\\u95ee\\u4e1a\\u52a1\\u6570\\u636e\\u3001\\u77e5\\u8bc6\\u5e93\\u6216\\u9700\\u8981\\u5b89\\u5168\\u6c99\\u7bb1\\u5904\\u7406\\u7684\\u8ba1\\u7b97\\u4efb\\u52a1\\u3002",
      running: "\\u6b63\\u5728\\u5904\\u7406",
      done: "\\u5df2\\u5904\\u7406",
      thinking: "\\u6211\\u5148\\u7406\\u89e3\\u4f60\\u7684\\u95ee\\u9898\\uff0c\\u518d\\u5224\\u65ad\\u9700\\u8981\\u54ea\\u4e9b\\u80fd\\u529b\\u6765\\u56de\\u7b54\\u3002",
      failed: "\\u8bf7\\u6c42\\u5931\\u8d25\\uff1a",
      requestTimeout: "\\u8bf7\\u6c42\\u8d85\\u65f6\\uff0c\\u5df2\\u7ec8\\u6b62\\u672c\\u6b21\\u751f\\u6210\\u3002",
      untitled: "\\u65b0\\u4f1a\\u8bdd",
      recent: "\\u6700\\u8fd1\\u4f1a\\u8bdd",
      searchResults: "\\u641c\\u7d22\\u7ed3\\u679c",
      noMatched: "\\u6ca1\\u6709\\u5339\\u914d\\u7684\\u4f1a\\u8bdd",
      confirmDelete: "\\u5220\\u9664\\u5f53\\u524d\\u4f1a\\u8bdd\\uff1f",
      confirmDeleteSession: "\\u5220\\u9664\\u8fd9\\u4e2a\\u4f1a\\u8bdd\\uff1f",
      ranCommands: "\\u5df2\\u8fd0\\u884c",
      loadingPeople: "\\u6b63\\u5728\\u8bfb\\u53d6\\u5458\\u5de5",
      unknownRole: "\\u5458\\u5de5"
    };
    const FALLBACK_USERS = [
      { id: "sales_001", name: "\\u6797\\u60a6", role: "\\u9500\\u552e\\u987e\\u95ee" },
      { id: "store_gm_001", name: "\\u987e\\u660e\\u8fdc", role: "\\u95e8\\u5e97\\u603b\\u7ecf\\u7406" },
      { id: "sales_manager_001", name: "\\u5468\\u666f\\u884c", role: "\\u9500\\u552e\\u7ecf\\u7406" },
      { id: "finance_001", name: "\\u5510\\u82e5\\u6eaa", role: "\\u8d22\\u52a1\\u4e13\\u5458" }
    ];
    let people = [...FALLBACK_USERS];
    const STORAGE_KEY = "langclaw.web.sessions.v5";
    const els = {
      messages: document.querySelector("#messages"),
      form: document.querySelector("#form"),
      input: document.querySelector("#input"),
      send: document.querySelector("#send"),
      personPicker: document.querySelector("#personPicker"),
      personTrigger: document.querySelector("#personTrigger"),
      personAvatar: document.querySelector("#personAvatar"),
      personName: document.querySelector("#personName"),
      personRole: document.querySelector("#personRole"),
      personModalBackdrop: document.querySelector("#personModalBackdrop"),
      personClose: document.querySelector("#personClose"),
      personSearch: document.querySelector("#personSearch"),
      personMenu: document.querySelector("#personMenu"),
      newChat: document.querySelector("#newChat"),
      deleteChat: document.querySelector("#deleteChat"),
      sessionList: document.querySelector("#sessionList"),
      sessionSearch: document.querySelector("#sessionSearch"),
      sideUser: document.querySelector("#sideUser"),
      sidebarToggle: document.querySelector("#sidebarToggle"),
      sidebarBackdrop: document.querySelector("#sidebarBackdrop"),
      debug: document.querySelector("#debugToggle"),
      chatTitle: document.querySelector("#chatTitle"),
      chatSubtitle: document.querySelector("#chatSubtitle")
    };
    let sessions = loadSessions();
    let activeSessionId = "";
    let messages = [];
    let userContextCache = new Map();
    let currentUserId = people[0].id;
    let loading = false;
    let renamingSessionId = "";

    initUsers();
    openInitialSession();
    render();
    loadPeople();

    function initUsers() {
      renderPeopleList();
    }
    function renderPeopleList() {
      const query = (els.personSearch?.value || "").trim().toLowerCase();
      const shown = query
        ? people.filter((user) => personSearchText(user).includes(query))
        : people;
      els.personMenu.innerHTML = "";
      if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "person-empty";
        empty.textContent = "\\u6ca1\\u6709\\u5339\\u914d\\u7684\\u5458\\u5de5";
        els.personMenu.appendChild(empty);
        return;
      }
      shown.forEach((user) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "person-option";
        button.dataset.userId = user.id;
        button.setAttribute("role", "option");
        button.innerHTML = '<span class="person-avatar" aria-hidden="true">' + escapeHtml(user.name.slice(0, 1)) + '</span><span class="person-meta"><span class="person-name">' + escapeHtml(user.name) + '</span><span class="person-role">' + escapeHtml(userRoleLabel(user.id)) + '</span></span>';
        button.addEventListener("click", () => selectUser(user.id));
        els.personMenu.appendChild(button);
      });
    }
    function personSearchText(user) {
      return [user.name, user.role, user.department, user.email, user.mobile].filter(Boolean).join(" ").toLowerCase();
    }
    async function loadPeople() {
      try {
        const res = await fetch("/api/wecom-users");
        if (!res.ok) throw new Error("load_people_failed");
        const data = await res.json();
        const loaded = (data.users || []).map(normalizePerson).filter((user) => user.id && user.name);
        if (!loaded.length) return;
        people = loaded;
        if (!people.some((user) => user.id === currentUserId)) currentUserId = people[0].id;
        initUsers();
        const active = latestSessionForUser(currentUserId) || createSession(currentUserId, false);
        activeSessionId = active.id;
        messages = active.messages;
        saveSessions();
        render();
      } catch {
        initUsers();
        render();
      }
    }
    function normalizePerson(user) {
      return {
        id: user.userid || user.id,
        name: user.name || user.alias || user.userid || "",
        role: user.position || user.department_name || STR.unknownRole,
        department: user.department_name || "",
        email: user.email || "",
        mobile: user.mobile || ""
      };
    }
    function openInitialSession() {
      const preferred = localStorage.getItem("langclaw.web.activeUser") || people[0].id;
      currentUserId = people.some((user) => user.id === preferred) ? preferred : people[0].id;
      const active = latestSessionForUser(currentUserId) || createSession(currentUserId, false);
      activeSessionId = active.id;
      messages = active.messages;
      saveSessions();
      ensureUserContext(currentUserId).catch(() => {});
    }
    function createSession(userId, activate) {
      const now = Date.now();
      const session = {
        id: userId + ":web-" + now + "-" + Math.random().toString(36).slice(2),
        userId,
        title: STR.untitled,
        createdAt: now,
        updatedAt: now,
        messages: [createWelcomeMessage()]
      };
      sessions.unshift(session);
      if (activate) {
        activeSessionId = session.id;
        messages = session.messages;
      }
      return session;
    }
    function createWelcomeMessage() {
      return { id: id(), role: "assistant", text: STR.welcome, steps: [], sources: [] };
    }
    function loadSessions() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((session) => session && session.id && session.userId && Array.isArray(session.messages)).slice(0, 80);
      } catch {
        return [];
      }
    }
    function saveSessions() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 80)));
      localStorage.setItem("langclaw.web.activeUser", currentUserId);
    }
    function sessionsForUser(userId) {
      return sessions.filter((session) => session.userId === userId).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    }
    function latestSessionForUser(userId) {
      return sessionsForUser(userId)[0];
    }
    function getActiveSession() {
      return sessions.find((session) => session.id === activeSessionId);
    }
    function getCurrentUser() {
      return people.find((user) => user.id === currentUserId) || FALLBACK_USERS.find((user) => user.id === currentUserId);
    }
    function touchActiveSession(firstUserText) {
      const session = getActiveSession();
      if (!session) return;
      session.messages = messages;
      session.updatedAt = Date.now();
      if (firstUserText && session.title === STR.untitled) session.title = firstUserText.slice(0, 24);
      saveSessions();
    }
    function openSession(sessionId) {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) return;
      renamingSessionId = "";
      activeSessionId = session.id;
      currentUserId = session.userId;
      messages = session.messages;
      saveSessions();
      render();
    }
    function selectUser(userId) {
      if (loading || userId === currentUserId) {
        closePersonModal();
        return;
      }
      currentUserId = userId;
      const next = latestSessionForUser(currentUserId) || createSession(currentUserId, false);
      activeSessionId = next.id;
      messages = next.messages;
      closePersonModal();
      saveSessions();
      render();
      ensureUserContext(currentUserId).catch(() => {});
    }
    function renameSession(sessionId, title) {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) return;
      const nextTitle = clean(title).slice(0, 48);
      session.title = nextTitle || STR.untitled;
      session.updatedAt = Date.now();
      renamingSessionId = "";
      saveSessions();
      render();
    }
    function deleteSession(sessionId) {
      if (loading) return;
      const session = sessions.find((item) => item.id === sessionId);
      if (!session || !confirm(STR.confirmDeleteSession)) return;
      const userId = session.userId;
      sessions = sessions.filter((item) => item.id !== sessionId);
      if (!sessionsForUser(userId).length) createSession(userId, false);
      if (activeSessionId === sessionId) {
        const next = latestSessionForUser(userId);
        activeSessionId = next.id;
        currentUserId = next.userId;
        messages = next.messages;
      }
      renamingSessionId = "";
      saveSessions();
      render();
    }

    els.newChat.addEventListener("click", () => {
      createSession(currentUserId, true);
      saveSessions();
      render();
    });
    els.deleteChat.addEventListener("click", () => {
      if (loading || !activeSessionId) return;
      if (sessionsForUser(currentUserId).length > 1 && !confirm(STR.confirmDelete)) return;
      const userId = currentUserId;
      sessions = sessions.filter((session) => session.id !== activeSessionId);
      const next = latestSessionForUser(userId) || createSession(userId, false);
      activeSessionId = next.id;
      messages = next.messages;
      saveSessions();
      render();
    });
    els.personTrigger.addEventListener("click", () => openPersonModal());
    els.personClose.addEventListener("click", () => closePersonModal());
    els.personModalBackdrop.addEventListener("click", (event) => {
      if (event.target === els.personModalBackdrop) closePersonModal();
    });
    els.personSearch.addEventListener("input", renderPeopleList);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePersonModal();
    });
    els.sessionSearch.addEventListener("input", render);
    els.sessionList.addEventListener("click", (event) => {
      const action = event.target.closest(".session-action");
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      const sessionId = action.dataset.sessionId;
      if (action.dataset.action === "rename") {
        renamingSessionId = sessionId;
        render();
      }
      if (action.dataset.action === "delete") {
        deleteSession(sessionId);
      }
    });
    els.sidebarToggle.addEventListener("click", () => document.body.classList.toggle("sidebar-open"));
    els.sidebarBackdrop.addEventListener("click", () => document.body.classList.remove("sidebar-open"));
    els.input.addEventListener("input", () => {
      els.input.style.height = "auto";
      els.input.style.height = Math.max(36, Math.min(180, els.input.scrollHeight)) + "px";
    });
    els.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        els.form.requestSubmit();
      }
    });
    els.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = els.input.value.trim();
      if (!text || loading) return;
      els.input.value = "";
      els.input.style.height = "auto";
      const assistantId = id();
      messages.push({ id: id(), role: "user", text });
      messages.push({ id: assistantId, role: "assistant", text: "", steps: [], sources: [], streaming: true, thinking: true, startedAt: Date.now() });
      touchActiveSession(text);
      render();
      await sendMessage(text, assistantId);
    });

    async function sendMessage(text, assistantId) {
      loading = true;
      setBusy(true);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 70000);
      try {
        const userId = currentUserId;
        const userContext = await ensureUserContext(userId);
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            user_id: userId,
            user_context: userContext,
            message: text,
            session_id: activeSessionId,
            debug: els.debug.checked
          })
        });
        await readSse(response, assistantId);
      } catch (error) {
        const message = error.name === "AbortError" ? STR.requestTimeout : STR.failed + (error.message || "unknown error");
        patch(assistantId, { text: message, error: true, streaming: false, thinking: false });
        touchActiveSession();
      } finally {
        window.clearTimeout(timeout);
        loading = false;
        setBusy(false);
        render();
      }
    }
    function setBusy(value) {
      els.send.disabled = value;
      els.personTrigger.disabled = value;
      els.newChat.disabled = value;
      els.deleteChat.disabled = value || sessionsForUser(currentUserId).length <= 1;
    }
    async function ensureUserContext(userId) {
      if (userContextCache.has(userId)) return userContextCache.get(userId);
      const res = await fetch("/api/user-context?user_id=" + encodeURIComponent(userId));
      const data = await res.json();
      const ctx = data.user_context;
      userContextCache.set(userId, ctx);
      return ctx;
    }
    async function readSse(response, assistantId) {
      if (!response.ok || !response.body) throw new Error("stream failed");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\\n\\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          handleEvent(block, assistantId);
        }
      }
      if (buffer.trim()) handleEvent(buffer, assistantId);
    }
    function handleEvent(block, assistantId) {
      const lines = block.split(/\\r?\\n/);
      let event = "message";
      const data = [];
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (!data.length) return;
      const payload = JSON.parse(data.join("\\n"));
      if (event === "thinking") {
        if (payload.model_thinking) {
          appendThinking(assistantId, payload.delta || "", payload.text || "");
        } else {
          addStep(assistantId, payload.step);
        }
      } else if (event === "delta") {
        appendText(assistantId, payload.text || "");
      } else if (event === "done") {
        const msg = getMsg(assistantId);
        patch(assistantId, {
          text: payload.answer || msg.text,
          steps: msg.steps.length ? msg.steps : (payload.debug?.steps || []),
          sources: payload.sources || [],
          debug: payload.debug || {},
          latency: payload.debug?.latency_ms,
          streaming: false,
          thinking: false,
          streamed: true
        });
        touchActiveSession();
      } else if (event === "error") {
        patch(assistantId, { text: STR.failed + (payload.message || "unknown error"), error: true, streaming: false, thinking: false });
        touchActiveSession();
      }
      render();
    }
    function render() {
      renderPersonPicker();
      renderSessionList();
      const active = getActiveSession();
      const user = getCurrentUser();
      els.chatTitle.textContent = active?.title || STR.untitled;
      els.chatSubtitle.textContent = user?.name || "";
      els.messages.innerHTML = "";
      for (const msg of messages) {
        const row = document.createElement("div");
        row.className = "msg " + msg.role + (msg.error ? " error" : "");
        if (msg.role === "user") {
          const bubble = document.createElement("div");
          bubble.className = "bubble";
          bubble.textContent = msg.text;
          row.appendChild(bubble);
        } else {
          const body = document.createElement("div");
          body.className = "assistant-body";
          if (shouldShowRun(msg)) body.appendChild(createRunPanel(msg));
          const text = document.createElement("div");
          text.className = "markdown";
          text.innerHTML = renderMarkdown(msg.text || "");
          body.appendChild(text);
          if (msg.sources?.length) {
            const sources = document.createElement("div");
            sources.className = "sources";
            sources.textContent = "\\u6765\\u6e90\\uff1a" + msg.sources.map((s) => clean(s.title + " / " + s.heading)).join("\\uff1b");
            body.appendChild(sources);
          }
          row.appendChild(body);
        }
        els.messages.appendChild(row);
      }
      els.messages.scrollTop = els.messages.scrollHeight;
      setBusy(loading);
    }
    function renderPersonPicker() {
      const user = getCurrentUser() || people[0];
      els.personAvatar.textContent = user.name.slice(0, 1);
      els.personName.textContent = user.name;
      els.personRole.textContent = user.role || "";
      for (const option of els.personMenu.querySelectorAll(".person-option")) {
        const active = option.dataset.userId === currentUserId;
        option.classList.toggle("active", active);
        option.setAttribute("aria-selected", String(active));
      }
    }
    function openPersonModal() {
      if (loading) return;
      document.body.classList.add("person-modal-open");
      els.personTrigger.setAttribute("aria-expanded", "true");
      els.personModalBackdrop.setAttribute("aria-hidden", "false");
      els.personSearch.value = "";
      renderPeopleList();
      window.setTimeout(() => els.personSearch.focus(), 0);
    }
    function closePersonModal() {
      document.body.classList.remove("person-modal-open");
      els.personTrigger.setAttribute("aria-expanded", "false");
      els.personModalBackdrop.setAttribute("aria-hidden", "true");
    }
    function renderSessionList() {
      const all = sessionsForUser(currentUserId);
      const query = (els.sessionSearch.value || "").trim().toLowerCase();
      const shown = query ? all.filter((session) => (session.title || STR.untitled).toLowerCase().includes(query)) : all;
      els.sideUser.textContent = getCurrentUser()?.name || "";
      els.sessionList.innerHTML = "";
      const label = document.createElement("div");
      label.className = "session-section-label";
      label.textContent = query ? STR.searchResults : STR.recent;
      els.sessionList.appendChild(label);
      if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "empty-sessions";
        empty.textContent = STR.noMatched;
        els.sessionList.appendChild(empty);
      }
      shown.forEach((session) => {
        const item = document.createElement("div");
        item.className = "session-item" + (session.id === activeSessionId ? " active" : "");
        let mainControl;
        if (renamingSessionId === session.id) {
          const input = document.createElement("input");
          input.className = "session-rename";
          input.value = session.title || STR.untitled;
          input.maxLength = 48;
          input.addEventListener("click", (event) => event.stopPropagation());
          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              renameSession(session.id, input.value);
            }
            if (event.key === "Escape") {
              renamingSessionId = "";
              render();
            }
          });
          input.addEventListener("blur", () => renameSession(session.id, input.value));
          mainControl = input;
          queueMicrotask(() => {
            input.focus();
            input.select();
          });
        } else {
          const open = document.createElement("button");
          open.type = "button";
          open.className = "session-open";
          open.disabled = loading;
          const title = document.createElement("span");
          title.className = "session-title";
          title.textContent = session.title || STR.untitled;
          open.appendChild(title);
          const time = document.createElement("span");
          time.className = "session-time";
          time.textContent = formatSessionTime(session.updatedAt);
          open.appendChild(time);
          open.addEventListener("click", () => {
            openSession(session.id);
            document.body.classList.remove("sidebar-open");
          });
          mainControl = open;
        }
        const actions = document.createElement("span");
        actions.className = "session-actions";
        const rename = document.createElement("button");
        rename.type = "button";
        rename.className = "session-action";
        rename.dataset.action = "rename";
        rename.dataset.sessionId = session.id;
        rename.title = "\\u91cd\\u547d\\u540d";
        rename.setAttribute("aria-label", "\\u91cd\\u547d\\u540d\\u4f1a\\u8bdd");
        rename.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9.8 3.2l3 3L6 13H3v-3z"/><path d="M8.7 4.3l3 3"/></svg>';
        rename.disabled = loading;
        rename.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          renamingSessionId = session.id;
          render();
        };
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "session-action";
        remove.dataset.action = "delete";
        remove.dataset.sessionId = session.id;
        remove.title = "\\u5220\\u9664";
        remove.setAttribute("aria-label", "\\u5220\\u9664\\u4f1a\\u8bdd");
        remove.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h10"/><path d="M6 4V2.8h4V4"/><path d="M5 6v7"/><path d="M8 6v7"/><path d="M11 6v7"/><path d="M4.5 4l.5 10h6l.5-10"/></svg>';
        remove.disabled = loading;
        remove.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          deleteSession(session.id);
        };
        actions.append(rename, remove);
        item.append(mainControl, actions);
        els.sessionList.appendChild(item);
      });
      els.deleteChat.disabled = loading || all.length <= 1;
    }
    function shouldShowRun(msg) {
      return msg.streaming || msg.thinking || msg.steps?.length || msg.debug?.steps?.length;
    }
    function createRunPanel(msg) {
      const details = document.createElement("details");
      details.className = "run-panel";
      details.open = Boolean(msg.streaming || msg.thinking);
      const summary = document.createElement("summary");
      const title = document.createElement("div");
      title.className = "run-title";
      const dot = document.createElement("span");
      dot.className = "run-dot " + (msg.streaming || msg.thinking ? "running" : "completed");
      const label = document.createElement("strong");
      label.textContent = msg.streaming || msg.thinking ? STR.running : STR.done;
      title.append(dot, label);
      summary.appendChild(title);
      if (!(msg.streaming || msg.thinking)) {
        const duration = document.createElement("span");
        duration.className = "run-duration";
        duration.textContent = formatDuration(msg.latency || (Date.now() - (msg.startedAt || Date.now())));
        summary.appendChild(duration);
      }
      const chevron = document.createElement("span");
      chevron.className = "run-chevron";
      chevron.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
      summary.appendChild(chevron);
      const body = document.createElement("div");
      body.className = "run-body";
      body.appendChild(createThought(msg));
      const toolCount = countToolSteps(msg);
      if (toolCount) {
        const toolLine = document.createElement("div");
        toolLine.className = "tool-line";
        toolLine.innerHTML = '<span class="tool-icon">></span><span>' + STR.ranCommands + " " + toolCount + " " + "\\u6761\\u547d\\u4ee4" + "</span>";
        body.appendChild(toolLine);
      }
      details.append(summary, body);
      return details;
    }
    function createThought(msg) {
      const thought = document.createElement("div");
      thought.className = "thought";
      if (msg.modelThinking) {
        thought.textContent = msg.modelThinking;
        return thought;
      }
      const steps = normalizeSteps(msg);
      if (!steps.length) {
        thought.textContent = STR.thinking;
      } else {
        thought.textContent = steps.slice(-3).map((step) => step.text).join("\\n\\n");
      }
      return thought;
    }
    function normalizeSteps(msg) {
      const raw = msg.steps?.length ? msg.steps : msg.debug?.steps || [];
      const mapped = [];
      for (const step of raw) {
        const phase = step.phase || "";
        if (["identify_user", "select_skill", "load_skill"].includes(phase)) continue;
        const text = stepToNaturalText(step);
        if (text) mapped.push({ phase, text });
      }
      return dedupeByText(mapped);
    }
    function stepToNaturalText(step) {
      const phase = step.phase || "";
      const detail = clean(step.detail || step.text || "");
      if (phase === "classify_intent") return detail || "\\u6211\\u5728\\u5224\\u65ad\\u8fd9\\u662f\\u4ec0\\u4e48\\u7c7b\\u578b\\u7684\\u95ee\\u9898\\uff0c\\u4ee5\\u53ca\\u662f\\u5426\\u9700\\u8981\\u8c03\\u7528\\u5de5\\u5177\\u3002";
      if (phase === "plan_action" || phase === "plan_follow_up" || phase === "plan_evidence") return detail || "\\u6211\\u5728\\u6839\\u636e\\u5f53\\u524d\\u7ebf\\u7d22\\u89c4\\u5212\\u4e0b\\u4e00\\u6b65\\uff0c\\u5fc5\\u8981\\u65f6\\u624d\\u4f1a\\u8c03\\u7528\\u8d44\\u6599\\u6216\\u5de5\\u5177\\u3002";
      if (phase === "execute_tool" || phase === "tool_round") return detail || "\\u6211\\u5df2\\u7ecf\\u8c03\\u7528\\u4e86\\u548c\\u8fd9\\u4e2a\\u95ee\\u9898\\u76f8\\u5173\\u7684\\u80fd\\u529b\\uff0c\\u6b63\\u5728\\u6574\\u7406\\u7ed3\\u679c\\u3002";
      if (phase === "observe_result") return detail || "\\u6211\\u5728\\u5224\\u65ad\\u5df2\\u83b7\\u5f97\\u7684\\u4fe1\\u606f\\u662f\\u5426\\u8db3\\u591f\\u76f4\\u63a5\\u56de\\u7b54\\u3002";
      if (phase === "model_thinking") return detail;
      if (phase === "final_answer") return detail || "\\u4fe1\\u606f\\u5df2\\u7ecf\\u8db3\\u591f\\uff0c\\u6211\\u5728\\u628a\\u7ed3\\u679c\\u7ec4\\u7ec7\\u6210\\u81ea\\u7136\\u8bed\\u8a00\\u3002";
      return detail;
    }
    function countToolSteps(msg) {
      const raw = msg.steps?.length ? msg.steps : msg.debug?.steps || [];
      return raw.filter((step) => ["execute_tool", "tool_round"].includes(step.phase)).length;
    }
    function addStep(id, step) {
      const msg = getMsg(id);
      if (!msg || !step) return;
      const last = msg.steps[msg.steps.length - 1];
      if (!last || last.phase !== step.phase || last.detail !== step.detail) msg.steps.push(step);
      msg.thinking = true;
      touchActiveSession();
    }
    function appendText(id, text) {
      const msg = getMsg(id);
      if (msg) msg.text = (msg.text || "") + normalize(text);
    }
    function appendThinking(id, delta, fullText) {
      const msg = getMsg(id);
      if (!msg) return;
      const next = fullText ? normalize(fullText) : (msg.modelThinking || "") + normalize(delta);
      msg.modelThinking = cleanThinking(next).slice(-2400);
      msg.thinking = true;
      touchActiveSession();
    }
    function patch(id, data) { Object.assign(getMsg(id) || {}, data); }
    function getMsg(id) { return messages.find((msg) => msg.id === id); }
    function id() { return "m_" + Date.now() + "_" + Math.random().toString(36).slice(2); }
    function clean(text) {
      return String(text || "")
        .replace(/\\b[a-z]+_[a-z0-9_]+\\b/gi, "")
        .replace(/[<>]/g, "")
        .replace(/\\s+/g, " ")
        .trim();
    }
    function cleanThinking(text) {
      return String(text || "")
        .replace(/<\\/?think>/gi, "")
        .replace(/\\n{3,}/g, "\\n\\n")
        .trim();
    }
    function normalize(text) { return String(text || "").replace(/\\\\n/g, "\\n").replace(/\\\\t/g, "\\t").replace(/\\\\r/g, "\\r"); }
    function dedupeByText(items) {
      const seen = new Set();
      return items.filter((item) => {
        if (!item.text || seen.has(item.text)) return false;
        seen.add(item.text);
        return true;
      });
    }
    function escapeHtml(text) {
      return String(text || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }
    function renderMarkdown(text) {
      const escaped = escapeHtml(text || "");
      const tick = String.fromCharCode(96);
      const inlineCode = new RegExp(tick + "([^" + tick + "]+)" + tick, "g");
      return escaped
        .replace(/^### (.*)$/gm, "<h3>$1</h3>")
        .replace(/^## (.*)$/gm, "<h2>$1</h2>")
        .replace(/^# (.*)$/gm, "<h1>$1</h1>")
        .replace(/\\*\\*(.*?)\\*\\*/g, "<strong>$1</strong>")
        .replace(inlineCode, "<code>$1</code>")
        .split(/\\n{2,}/).map((block) => "<p>" + block.replace(/\\n/g, "<br>") + "</p>").join("");
    }
    function formatDuration(ms) {
      const value = Number(ms);
      if (!Number.isFinite(value) || value <= 0) return "";
      if (value < 1000) return value + "ms";
      return (value / 1000).toFixed(value > 10000 ? 0 : 1) + "s";
    }
    function formatSessionTime(value) {
      const date = new Date(Number(value) || Date.now());
      const now = new Date();
      if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      }
      return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
    }
    function userRoleLabel(userId) {
      return people.find((user) => user.id === userId)?.role
        || FALLBACK_USERS.find((user) => user.id === userId)?.role
        || STR.unknownRole;
    }
  </script>
</body>
</html>`;
}
