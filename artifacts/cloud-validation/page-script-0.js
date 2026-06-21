
    const STR = {
      welcome: "\u4f60\u597d\uff0c\u6211\u662f\u4f01\u4e1a Agent\u3002\u4f60\u53ef\u4ee5\u8be2\u95ee\u4e1a\u52a1\u6570\u636e\u3001\u77e5\u8bc6\u5e93\u6216\u9700\u8981\u5b89\u5168\u6c99\u7bb1\u5904\u7406\u7684\u8ba1\u7b97\u4efb\u52a1\u3002",
      landingTitle: "\u4f60\u597d\uff0c\u6211\u662f\u4f01\u4e1a Agent",
      running: "\u6b63\u5728\u5904\u7406",
      done: "\u5df2\u5904\u7406",
      thinking: "\u6211\u5148\u7406\u89e3\u4f60\u7684\u95ee\u9898\uff0c\u518d\u5224\u65ad\u9700\u8981\u54ea\u4e9b\u80fd\u529b\u6765\u56de\u7b54\u3002",
      failed: "\u8bf7\u6c42\u5931\u8d25\uff1a",
      requestTimeout: "\u8bf7\u6c42\u8d85\u65f6\uff0c\u5df2\u7ec8\u6b62\u672c\u6b21\u751f\u6210\u3002",
      untitled: "\u65b0\u4f1a\u8bdd",
      recent: "\u6700\u8fd1\u4f1a\u8bdd",
      searchResults: "\u641c\u7d22\u7ed3\u679c",
      noMatched: "\u6ca1\u6709\u5339\u914d\u7684\u4f1a\u8bdd",
      confirmDelete: "\u5220\u9664\u5f53\u524d\u4f1a\u8bdd\uff1f",
      confirmDeleteSession: "\u5220\u9664\u8fd9\u4e2a\u4f1a\u8bdd\uff1f",
      ranCommands: "\u5df2\u8fd0\u884c",
      processing: "\u5904\u7406\u4e2d\u2026",
      processed: "\u5df2\u5904\u7406",
      failedRun: "\u672a\u80fd\u5b8c\u6210",
      loadingPeople: "\u6b63\u5728\u8bfb\u53d6\u5458\u5de5",
      unknownRole: "\u5458\u5de5"
    };
    const FALLBACK_USERS = [
      { id: "sales_001", name: "\u6797\u60a6", role: "\u9500\u552e\u987e\u95ee" },
      { id: "store_gm_001", name: "\u987e\u660e\u8fdc", role: "\u95e8\u5e97\u603b\u7ecf\u7406" },
      { id: "sales_manager_001", name: "\u5468\u666f\u884c", role: "\u9500\u552e\u7ecf\u7406" },
      { id: "finance_001", name: "\u5510\u82e5\u6eaa", role: "\u8d22\u52a1\u4e13\u5458" },
      { id: "cloud_pm_001", name: "\u7a0b\u4e00\u5ddd", role: "\u4e91\u5546\u54c1\u4ea7\u54c1\u7ecf\u7406", department: "\u4e91\u5546\u54c1\u5e73\u53f0" }
    ];
    const DOMAIN_PRESETS = [
      { id: "dealer", label: "\u7ecf\u9500\u5546", defaultUserId: "sales_001" },
      { id: "cloud_commodity", label: "\u4e91\u5546\u54c1", defaultUserId: "cloud_pm_001" }
    ];
    let people = [...FALLBACK_USERS];
    const LEGACY_STORAGE_KEYS = ["langclaw.web.sessions.v5"];
    const STORAGE_KEY = "langclaw.web.sessions.v6";
    const STEP_REVEAL_INTERVAL_MS = 460;
    const els = {
      messages: document.querySelector("#messages"),
      form: document.querySelector("#form"),
      input: document.querySelector("#input"),
      send: document.querySelector("#send"),
      suggestPopup: document.querySelector("#suggestPopup"),
      personPicker: document.querySelector("#personPicker"),
      personTrigger: document.querySelector("#personTrigger"),
      personAvatar: document.querySelector("#personAvatar"),
      personName: document.querySelector("#personName"),
      personRole: document.querySelector("#personRole"),
      domainSwitch: document.querySelector("#domainSwitch"),
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
      chatSubtitle: document.querySelector("#chatSubtitle"),
      attachBtn: document.querySelector("#attachBtn"),
      attachInput: document.querySelector("#attachInput"),
      attachStrip: document.querySelector("#attachStrip"),
      composerRec: document.querySelector("#composerRec"),
      cmdChips: document.querySelector("#cmdChips"),
      recToggle: document.querySelector("#recToggle"),
      landingHero: document.querySelector("#landingHero"),
      landingTitle: document.querySelector("#landingTitle"),
      landingCards: document.querySelector("#landingCards"),
      composer: document.querySelector("#form")
    };
    clearLegacySessions();
    let currentDomainId = normalizeDomainId(localStorage.getItem("langclaw.web.activeDomain") || "dealer");
    let sessions = loadSessions();
    let activeSessionId = "";
    let messages = [];
    let userContextCache = new Map();
    let currentUserId = people[0].id;
    let loading = false;
    let renamingSessionId = "";
    const stepQueues = new Map();
    const stepTimers = new Map();
    const pendingDoneEvents = new Map();

    initUsers();
    openInitialSession();
    render();
    loadPeople();

    function initUsers() {
      renderPeopleList();
    }
    function renderPeopleList() {
      const query = (els.personSearch?.value || "").trim().toLowerCase();
      const domainPeople = people.filter((user) => domainIdForUser(user) === currentDomainId);
      const shown = query
        ? domainPeople.filter((user) => personSearchText(user).includes(query))
        : domainPeople;
      els.personMenu.innerHTML = "";
      if (!shown.length) {
        const empty = document.createElement("div");
        empty.className = "person-empty";
        empty.textContent = "\u6ca1\u6709\u5339\u914d\u7684\u5458\u5de5";
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
        const activeBeforePeopleRefresh = getActiveSession();
        people = loaded;
        if (activeBeforePeopleRefresh && !isEffectivelyEmpty(activeBeforePeopleRefresh.messages)) {
          initUsers();
          messages = activeBeforePeopleRefresh.messages;
          render();
          return;
        }
        if (!people.some((user) => user.id === currentUserId && domainIdForUser(user) === currentDomainId)) {
          currentUserId = defaultUserForDomain(currentDomainId);
        }
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
      const preferredUser = people.find((user) => user.id === preferred);
      if (preferredUser && domainIdForUser(preferredUser) === currentDomainId) {
        currentUserId = preferred;
      } else {
        currentUserId = defaultUserForDomain(currentDomainId);
      }
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
        domainId: currentDomainId,
        title: STR.untitled,
        createdAt: now,
        updatedAt: now,
        messages: []
      };
      sessions.unshift(session);
      if (activate) {
        activeSessionId = session.id;
        messages = session.messages;
      }
      return session;
    }
    // 旧会话可能存有一条预置 welcome 消息——视作空会话以便走 landing 视图
    function isEffectivelyEmpty(msgs) {
      if (!Array.isArray(msgs) || msgs.length === 0) return true;
      if (msgs.length === 1) {
        const only = msgs[0];
        return only && only.role === "assistant" && only.text === STR.welcome && !only.steps?.length;
      }
      return false;
    }
    function loadSessions() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter((session) => session && session.id && session.userId && Array.isArray(session.messages))
          .map((session) => ({ ...session, domainId: inferDomainIdForSession(session) }))
          .slice(0, 80);
      } catch {
        return [];
      }
    }
    function clearLegacySessions() {
      for (const key of LEGACY_STORAGE_KEYS) {
        if (key !== STORAGE_KEY) localStorage.removeItem(key);
      }
    }
    function saveSessions() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 80)));
      localStorage.setItem("langclaw.web.activeUser", currentUserId);
      localStorage.setItem("langclaw.web.activeDomain", currentDomainId);
    }
    function sessionsForUser(userId) {
      return sessions
        .filter((session) => session.userId === userId && sessionDomainId(session) === currentDomainId)
        .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
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
    function normalizeDomainId(domainId) {
      return DOMAIN_PRESETS.some((item) => item.id === domainId) ? domainId : "dealer";
    }
    function domainIdForUser(user) {
      const text = [user?.id, user?.role, user?.department, user?.name].filter(Boolean).join(" ");
      return /cloud|\u4e91\u5546\u54c1|\u4e91\u4e1a\u52a1|\u5ba2\u6237\u81ea\u52a9/.test(text) ? "cloud_commodity" : "dealer";
    }
    function domainIdForUserId(userId) {
      return domainIdForUser(people.find((user) => user.id === userId) || FALLBACK_USERS.find((user) => user.id === userId) || { id: userId });
    }
    function sessionDomainId(session) {
      return inferDomainIdForSession(session);
    }
    function inferDomainIdForSession(session) {
      const messageText = Array.isArray(session?.messages)
        ? session.messages.slice(0, 8).map((message) => [message?.text, message?.userMessage].filter(Boolean).join(" ")).join(" ")
        : "";
      const text = [session?.title, messageText].filter(Boolean).join(" ");
      if (/(云商品|云产品|云厂商|云平台|Seedance|Agent\s*Plan|AFP|SKU|Offer|计费项|上线风险|发布申请|合同价|云账单)/i.test(text)) {
        return "cloud_commodity";
      }
      return normalizeDomainId(session?.domainId || domainIdForUserId(session?.userId));
    }
    function defaultUserForDomain(domainId) {
      const normalized = normalizeDomainId(domainId);
      const preset = DOMAIN_PRESETS.find((item) => item.id === normalized);
      const preferred = preset?.defaultUserId || "sales_001";
      return people.find((user) => user.id === preferred)?.id || people.find((user) => domainIdForUser(user) === normalized)?.id || currentUserId;
    }
    function currentDomainLabel() {
      return DOMAIN_PRESETS.find((item) => item.id === currentDomainId)?.label || "";
    }
    function selectDomain(domainId) {
      if (loading) return;
      currentDomainId = normalizeDomainId(domainId);
      currentUserId = defaultUserForDomain(currentDomainId);
      const next = latestSessionForUser(currentUserId) || createSession(currentUserId, false);
      activeSessionId = next.id;
      messages = next.messages;
      recommendedFetchedFor = "";
      closePersonModal();
      saveSessions();
      render();
      ensureUserContext(currentUserId).catch(() => {});
      loadRecommendedCommands(currentUserId);
    }
    function renderDomainSwitch() {
      if (!els.domainSwitch) return;
      const activeDomain = currentDomainId;
      for (const button of els.domainSwitch.querySelectorAll("[data-domain-id]")) {
        const active = button.dataset.domainId === activeDomain;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
        button.disabled = loading;
      }
    }
    function touchActiveSession(firstUserText) {
      const session = getActiveSession();
      if (!session) return;
      session.messages = messages.map(serializeMessageForSession);
      session.updatedAt = Date.now();
      if (firstUserText && session.title === STR.untitled) session.title = firstUserText.slice(0, 24);
      saveSessions();
    }
    function serializeMessageForSession(message) {
      const { a2uiState: _a2uiState, ...persisted } = message;
      return persisted;
    }
    function openSession(sessionId) {
      const session = sessions.find((item) => item.id === sessionId);
      if (!session) return;
      renamingSessionId = "";
      activeSessionId = session.id;
      currentDomainId = sessionDomainId(session);
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
      const nextUser = people.find((user) => user.id === userId) || FALLBACK_USERS.find((user) => user.id === userId);
      currentDomainId = domainIdForUser(nextUser || { id: userId });
      currentUserId = userId;
      const next = latestSessionForUser(currentUserId) || createSession(currentUserId, false);
      activeSessionId = next.id;
      messages = next.messages;
      closePersonModal();
      saveSessions();
      render();
      ensureUserContext(currentUserId).catch(() => {});
      recommendedFetchedFor = "";
      loadRecommendedCommands(currentUserId);
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
        currentDomainId = sessionDomainId(session);
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
    els.debug.addEventListener("change", render);
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
    // ── contenteditable 输入框：等价封装（替代 textarea.value） ──────────
    let isComposing = false; // IME 中文输入态
    function getInputValue() {
      // 把内嵌 tag 序列化成 "/cmd "，其余文本节点直接拼接，<br> 转成换行
      let out = "";
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 3) { out += child.nodeValue || ""; continue; }
          if (child.nodeType !== 1) continue;
          const el = child;
          if (el.classList && el.classList.contains("cmd-tag")) {
            const cmd = el.getAttribute("data-cmd") || "";
            out += cmd;
            continue;
          }
          if (el.tagName === "BR") { out += "\n"; continue; }
          if (el.tagName === "DIV" || el.tagName === "P") {
            if (out && !out.endsWith("\n")) out += "\n";
            walk(el);
            continue;
          }
          walk(el);
        }
      };
      walk(els.input);
      return out;
    }
    function clearInput() {
      els.input.innerHTML = "";
    }
    function setInputText(text) {
      els.input.innerHTML = "";
      if (text) els.input.appendChild(document.createTextNode(text));
    }
    function placeCaretAtEnd() {
      const range = document.createRange();
      range.selectNodeContents(els.input);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
    }
    function hasInputTag() {
      return !!els.input.querySelector(".cmd-tag");
    }
    function removeInputTag() {
      const tag = els.input.querySelector(".cmd-tag");
      if (tag) tag.remove();
    }
    function insertInputTag(label, command) {
      // 一次只允许一个 tag — 先移除旧的
      removeInputTag();
      const tag = document.createElement("span");
      tag.className = "cmd-tag";
      tag.contentEditable = "false";
      tag.setAttribute("data-cmd", command);
      // 标签里直接显示 label，data-cmd 保存完整命令（含 /）
      const cleanLabel = command.startsWith("/") ? command.slice(1) : command;
      const labelEl = document.createElement("span");
      labelEl.className = "cmd-tag-label";
      labelEl.textContent = cleanLabel;
      tag.appendChild(labelEl);
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "cmd-tag-remove";
      removeBtn.setAttribute("aria-label", "移除命令");
      removeBtn.contentEditable = "false";
      removeBtn.innerHTML = '<i data-lucide="x"></i>';
      removeBtn.addEventListener("mousedown", (e) => { e.preventDefault(); });
      removeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        removeInputTag();
        els.input.focus();
        els.input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      tag.appendChild(removeBtn);
      // 插到最前面，光标移到 tag 之后
      els.input.insertBefore(tag, els.input.firstChild);
      const space = document.createTextNode("\u00a0");
      tag.after(space);
      const range = document.createRange();
      range.setStartAfter(space);
      range.collapse(true);
      const sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      els.input.focus();
      try { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); } catch (e) {}
      els.input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    els.input.addEventListener("compositionstart", () => { isComposing = true; });
    els.input.addEventListener("compositionend", () => {
      isComposing = false;
      updateCommandSuggest();
    });
    els.input.addEventListener("input", () => {
      if (isComposing) return;
      updateCommandSuggest();
    });
    els.input.addEventListener("keydown", (event) => {
      if (isComposing) return;
      if (commandSuggest.open) {
        if (event.key === "ArrowDown") { event.preventDefault(); moveSuggest(1); return; }
        if (event.key === "ArrowUp") { event.preventDefault(); moveSuggest(-1); return; }
        if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
          event.preventDefault();
          acceptSuggest();
          return;
        }
        if (event.key === "Escape") { event.preventDefault(); closeSuggest(); return; }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        els.form.requestSubmit();
        return;
      }
      if (event.key === "Enter" && event.shiftKey) {
        // 手动插换行：默认行为在 contenteditable 里会插 <div>，体验差
        event.preventDefault();
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const br = document.createElement("br");
        range.insertNode(br);
        // 在 br 后面再加一个 zero-width 文本节点，让光标能放过去
        const zwsp = document.createTextNode("\u200b");
        br.after(zwsp);
        range.setStartAfter(zwsp);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    // 粘贴：去富文本，只保留纯文本（图片粘贴在下方专门处理）
    els.input.addEventListener("paste", (event) => {
      const cd = event.clipboardData;
      if (!cd) return;
      // 如果带文件（图片）— 让下方的 paste 监听去处理
      if (cd.files && cd.files.length) return;
      event.preventDefault();
      const text = cd.getData("text/plain");
      if (!text) return;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) {
        els.input.appendChild(document.createTextNode(text));
      } else {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      els.input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    els.input.addEventListener("blur", () => { setTimeout(closeSuggest, 120); });
    els.suggestPopup.addEventListener("mousedown", (event) => {
      // 阻止 textarea blur 抢先关闭弹层
      event.preventDefault();
    });

    // ── 推荐命令 chip 行（在 composer-shell 上方独立一行） ─────────────────
    let recommendedFetchedFor = "";

    function refreshRecVisibility() {
      const rec = els.composerRec;
      if (!rec) return;
      const hasChips = els.cmdChips && els.cmdChips.children.length > 0;
      rec.classList.toggle("has-content", hasChips);
    }
    function refreshRecOverflow() {
      // 收起态下 chip 行用 overflow:hidden，超出宽度时显示折叠按钮
      if (!els.cmdChips || !els.recToggle) return;
      if (els.cmdChips.classList.contains("expanded")) {
        els.recToggle.classList.add("visible");
        return;
      }
      const overflow = els.cmdChips.scrollWidth > els.cmdChips.clientWidth + 2;
      els.recToggle.classList.toggle("visible", overflow);
    }
    async function loadRecommendedCommands(userId) {
      if (!els.cmdChips || !userId || userId === recommendedFetchedFor) return;
      recommendedFetchedFor = userId;
      try {
        const res = await fetch("/api/recommended-commands?user_id=" + encodeURIComponent(userId) + "&domain_id=" + encodeURIComponent(currentDomainId));
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        renderRecommendedChips(Array.isArray(json.commands) ? json.commands : []);
      } catch {
        renderRecommendedChips([]);
      }
    }
    function renderRecommendedChips(list) {
      if (!els.cmdChips) return;
      els.cmdChips.innerHTML = "";
      list.slice(0, 8).forEach((cmd, index) => {
        if (!cmd || typeof cmd.label !== "string" || typeof cmd.command !== "string") return;
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "cmd-chip" + (index === 0 ? " primary" : "");
        chip.textContent = cmd.label;
        chip.title = cmd.command;
        chip.addEventListener("click", () => {
          insertInputTag(cmd.label, cmd.command);
        });
        els.cmdChips.appendChild(chip);
      });
      refreshRecVisibility();
      // 等渲染稳定后判定是否需要折叠按钮
      requestAnimationFrame(refreshRecOverflow);
      renderLandingCards(list);
    }
    function renderLandingCards(list) {
      if (!els.landingCards) return;
      els.landingCards.innerHTML = "";
      list.slice(0, 4).forEach((cmd) => {
        if (!cmd || typeof cmd.label !== "string" || typeof cmd.command !== "string") return;
        const card = document.createElement("button");
        card.type = "button";
        card.className = "landing-card";
        card.setAttribute("role", "listitem");
        card.title = cmd.command;
        const labelEl = document.createElement("span");
        labelEl.className = "card-label";
        labelEl.textContent = cmd.label;
        const hintEl = document.createElement("span");
        hintEl.className = "card-hint";
        hintEl.textContent = (typeof cmd.hint === "string" && cmd.hint.trim()) ? cmd.hint : cmd.command;
        card.appendChild(labelEl);
        card.appendChild(hintEl);
        card.addEventListener("click", () => {
          insertInputTag(cmd.label, cmd.command);
          // landing 视图下点击卡片 = 选好命令、focus 输入框，等用户补充文本/按发送
          if (els.input && typeof els.input.focus === "function") els.input.focus();
        });
        els.landingCards.appendChild(card);
      });
    }
    if (els.recToggle) {
      els.recToggle.addEventListener("click", () => {
        const expanded = els.cmdChips.classList.toggle("expanded");
        els.recToggle.classList.toggle("expanded", expanded);
        els.recToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
        refreshRecOverflow();
      });
    }
    if (els.domainSwitch) {
      els.domainSwitch.addEventListener("click", (event) => {
        const button = event.target?.closest?.("[data-domain-id]");
        if (!button) return;
        selectDomain(button.dataset.domainId || "dealer");
      });
    }
    window.addEventListener("resize", () => requestAnimationFrame(refreshRecOverflow));

    if (window.lucide) lucide.createIcons();
    loadRecommendedCommands(currentUserId);

    // ── 附件上传（参考 Claude / ChatGPT / Notion 交互） ──────────────────
    const ATTACH_MAX = 5;
    const ATTACH_MAX_BYTES = 20 * 1024 * 1024;
    const attachState = { items: [], uploading: 0 };
    const dropOverlay = document.getElementById("dropOverlay");
    const toastStack = document.getElementById("toastStack");

    function showToast(text, level) {
      if (!toastStack) return;
      const el = document.createElement("div");
      el.className = "toast" + (level === "warn" ? " warn" : level === "error" ? " error" : "");
      el.textContent = text;
      toastStack.appendChild(el);
      setTimeout(() => {
        el.style.transition = "opacity .2s";
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 220);
      }, 3200);
    }
    function fmtBytes(n) {
      if (!Number.isFinite(n) || n < 0) return "";
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
      return (n / 1024 / 1024).toFixed(1) + " MB";
    }
    // 返回 lucide 图标名 + chip 颜色分类。kind=失败时直接走 alert-circle。
    function iconForFile(filename, kind) {
      const ext = (filename.split(".").pop() || "").toLowerCase();
      if (kind === "failed") return { icon: "alert-circle", category: "failed" };
      if (kind === "image" || ["png","jpg","jpeg","gif","webp","bmp","svg"].includes(ext)) return { icon: "image", category: "image" };
      if (["pdf"].includes(ext)) return { icon: "file-text", category: "pdf" };
      if (["doc","docx"].includes(ext)) return { icon: "file-text", category: "word" };
      if (["xls","xlsx","csv"].includes(ext)) return { icon: "file-spreadsheet", category: "excel" };
      if (["ppt","pptx"].includes(ext)) return { icon: "presentation", category: "ppt" };
      if (["zip","tar","gz","rar","7z"].includes(ext)) return { icon: "file-archive", category: "zip" };
      if (["json","md","txt","log"].includes(ext)) return { icon: "file-text", category: "" };
      return { icon: "file", category: "" };
    }
    function renderAttachments() {
      const strip = els.attachStrip;
      strip.innerHTML = "";
      if (!attachState.items.length) {
        strip.classList.remove("has-items");
        return;
      }
      strip.classList.add("has-items");
      attachState.items.forEach((item) => {
        const chip = document.createElement("div");
        chip.className = "attach-chip" + (item.status === "uploading" ? " uploading" : item.status === "failed" ? " failed" : "");
        chip.title = item.filename + (item.failure ? " — " + item.failure : "");

        const iconInfo = iconForFile(item.filename, item.status === "failed" ? "failed" : item.kind);
        if (iconInfo.category) chip.setAttribute("data-kind", iconInfo.category);

        const icon = document.createElement("span");
        icon.className = "chip-icon";
        const ic = document.createElement("i");
        ic.setAttribute("data-lucide", iconInfo.icon);
        icon.appendChild(ic);
        chip.appendChild(icon);

        const body = document.createElement("span");
        body.className = "chip-body";
        const name = document.createElement("span");
        name.className = "chip-name";
        name.textContent = item.filename;
        body.appendChild(name);
        const meta = document.createElement("span");
        meta.className = "chip-meta";
        if (item.status === "uploading") {
          meta.textContent = "上传中…";
        } else if (item.status === "failed") {
          meta.textContent = item.failure || "失败";
        } else if (item.kind === "failed") {
          meta.textContent = "已上传 · 解析失败";
        } else if (item.kind === "image") {
          meta.textContent = "图片 · " + fmtBytes(item.size_bytes);
        } else {
          const chars = item.text_chars_total ? "，" + item.text_chars_total + " 字" : "";
          meta.textContent = fmtBytes(item.size_bytes) + chars;
        }
        body.appendChild(meta);
        chip.appendChild(body);

        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "chip-remove";
        rm.setAttribute("aria-label", "移除 " + item.filename);
        const rmIcon = document.createElement("i");
        rmIcon.setAttribute("data-lucide", "x");
        rm.appendChild(rmIcon);
        rm.addEventListener("click", () => {
          attachState.items = attachState.items.filter((x) => x.localId !== item.localId);
          renderAttachments();
        });
        chip.appendChild(rm);

        if (item.status === "uploading") {
          const bar = document.createElement("span");
          bar.className = "chip-progress";
          chip.appendChild(bar);
        }
        strip.appendChild(chip);
      });
      // 重新扫描注入 SVG
      if (window.lucide) lucide.createIcons();
    }
    async function uploadFiles(fileList) {
      const all = Array.from(fileList || []);
      if (!all.length) return;
      // 体积过滤
      const tooBig = all.filter((f) => f.size > ATTACH_MAX_BYTES);
      const sized = all.filter((f) => f.size <= ATTACH_MAX_BYTES);
      tooBig.forEach((f) => showToast(f.name + " 超过 20MB，已跳过", "warn"));

      const remaining = ATTACH_MAX - attachState.items.length;
      if (remaining <= 0) {
        showToast("已达 " + ATTACH_MAX + " 个附件上限", "warn");
        return;
      }
      const accepted = sized.slice(0, remaining);
      if (sized.length > remaining) {
        showToast("只接收前 " + remaining + " 个，其余已忽略", "warn");
      }
      if (!accepted.length) return;

      const localItems = accepted.map((f) => ({
        localId: id(),
        filename: f.name,
        size_bytes: f.size,
        status: "uploading"
      }));
      attachState.items.push(...localItems);
      attachState.uploading += localItems.length;
      renderAttachments();

      const fd = new FormData();
      fd.append("user_id", currentUserId);
      if (activeSessionId) fd.append("session_id", activeSessionId);
      accepted.forEach((f) => fd.append("files", f, f.name));
      try {
        const res = await fetch("/api/attachments", { method: "POST", body: fd });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error("HTTP " + res.status + " " + txt.slice(0, 160));
        }
        const json = await res.json();
        const returned = Array.isArray(json && json.attachments) ? json.attachments : [];
        localItems.forEach((local, idx) => {
          const ret = returned[idx];
          if (!ret) {
            local.status = "failed";
            local.failure = "服务端未返回";
          } else {
            local.id = ret.id;
            local.kind = ret.kind;
            local.size_bytes = ret.size_bytes ?? local.size_bytes;
            local.text_chars_total = ret.text_chars_total ?? 0;
            local.status = "ready";
            local.failure = ret.failure_reason;
          }
        });
      } catch (err) {
        const msg = (err && err.message) || "上传失败";
        localItems.forEach((local) => {
          local.status = "failed";
          local.failure = msg;
        });
        showToast("上传失败：" + msg, "error");
      } finally {
        attachState.uploading = Math.max(0, attachState.uploading - localItems.length);
        renderAttachments();
      }
    }

    // 点击 📎 → 选文件
    els.attachBtn.addEventListener("click", () => {
      if (attachState.items.length >= ATTACH_MAX) {
        showToast("已达 " + ATTACH_MAX + " 个附件上限", "warn");
        return;
      }
      els.attachInput.click();
    });
    els.attachInput.addEventListener("change", (event) => {
      const files = event.target.files;
      uploadFiles(files);
      els.attachInput.value = "";
    });

    // 全屏拖拽：监听 window，所有位置都能 drop（参考 Claude / ChatGPT）
    let dragDepth = 0;
    function hasFiles(dt) {
      if (!dt) return false;
      const types = Array.from(dt.types || []);
      return types.includes("Files");
    }
    window.addEventListener("dragenter", (event) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      dragDepth += 1;
      dropOverlay.classList.add("active");
    });
    window.addEventListener("dragover", (event) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault(); // 必须 preventDefault，否则 drop 不触发
    });
    window.addEventListener("dragleave", (event) => {
      if (!hasFiles(event.dataTransfer)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) dropOverlay.classList.remove("active");
    });
    window.addEventListener("drop", (event) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      dragDepth = 0;
      dropOverlay.classList.remove("active");
      const files = event.dataTransfer.files;
      if (files && files.length) uploadFiles(files);
    });

    // 粘贴图片（textarea 聚焦时）
    els.input.addEventListener("paste", (event) => {
      const cd = event.clipboardData;
      if (!cd || !cd.items) return;
      const files = [];
      for (let i = 0; i < cd.items.length; i++) {
        const it = cd.items[i];
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        event.preventDefault();
        uploadFiles(files);
      }
    });

    els.form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = getInputValue().trim();
      if (!text || loading) return;
      if (attachState.uploading > 0) {
        showToast("附件还在上传中，等一下再发", "warn");
        return;
      }
      const attachmentIds = attachState.items.filter((a) => a.status === "ready").map((a) => a.id);
      clearInput();
      const assistantId = id();
      messages.push({ id: id(), role: "user", text });
      messages.push({ id: assistantId, role: "assistant", text: "", userMessage: text, steps: [], sources: [], streaming: true, thinking: true, startedAt: Date.now() });
      touchActiveSession(text);
      // 发送后清空附件列表（attachment_id 在服务端 30min TTL 内仍可被后续重发引用，但这里默认本轮发完即清）
      attachState.items = [];
      renderAttachments();
      render();
      await sendMessage(text, assistantId, attachmentIds);
    });

    async function sendMessage(text, assistantId, attachmentIds) {
      loading = true;
      setBusy(true);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 180000);
      try {
        const userId = currentUserId;
        const userContext = await ensureUserContext(userId);
        const response = await fetch("/api/openui/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            user_id: userId,
            user_context: userContext,
            domain_id: currentDomainId,
            message: text,
            session_id: activeSessionId,
            debug: els.debug.checked,
            attachment_ids: Array.isArray(attachmentIds) && attachmentIds.length ? attachmentIds : undefined
          })
        });
        await readSse(response, assistantId);
        // 流正常结束后，把还没收到 end 的 item 视为"未完成"，避免 spinner 残留
        finalizeRunningItems(getMsg(assistantId), "\u6d41\u5df2\u7ed3\u675f\u4f46\u672a\u6536\u5230 end \u4e8b\u4ef6");
      } catch (error) {
        const message = error.name === "AbortError" ? STR.requestTimeout : STR.failed + (error.message || "unknown error");
        finalizeRunningItems(getMsg(assistantId), message);
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
      els.attachBtn.disabled = value;
    }
    async function ensureUserContext(userId) {
      if (userContextCache.has(userId)) return userContextCache.get(userId);
      const res = await fetch("/api/user-context?user_id=" + encodeURIComponent(userId));
      const data = await res.json();
      const ctx = data.user_context;
      userContextCache.set(userId, ctx);
      return ctx;
    }
    /**
     * /命令自动补全：当输入以 / 开头且光标在第一行时，弹出基于 /api/commands
     * 的过滤列表（按权限过滤）。Tab/Enter 接受、Esc 关闭。
     */
    const commandSuggest = { open: false, items: [], active: 0, fetched: new Map(), inflight: null };
    async function loadCommandsForUser(userId) {
      if (commandSuggest.fetched.has(userId)) return commandSuggest.fetched.get(userId);
      if (commandSuggest.inflight && commandSuggest.inflight.userId === userId) return commandSuggest.inflight.promise;
      const promise = (async () => {
        try {
          const res = await fetch("/api/commands?user_id=" + encodeURIComponent(userId) + "&domain_id=" + encodeURIComponent(currentDomainId));
          if (!res.ok) return [];
          const data = await res.json();
          const list = Array.isArray(data.commands) ? data.commands : [];
          commandSuggest.fetched.set(userId, list);
          return list;
        } catch (_err) {
          return [];
        }
      })();
      commandSuggest.inflight = { userId, promise };
      const result = await promise;
      commandSuggest.inflight = null;
      return result;
    }
    function updateCommandSuggest() {
      // 有 tag 时不触发 / 命令面板（一次只允许一个命令）
      if (hasInputTag()) { closeSuggest(); return; }
      const value = getInputValue();
      const firstLine = value.split("\n")[0] || "";
      if (!firstLine.startsWith("/")) { closeSuggest(); return; }
      loadCommandsForUser(currentUserId).then((commands) => {
        if (hasInputTag()) { closeSuggest(); return; }
        const stillFirst = (getInputValue().split("\n")[0] || "").toLowerCase();
        if (!stillFirst.startsWith("/")) { closeSuggest(); return; }
        const matches = commands.filter((cmd) => {
          const triggers = Array.isArray(cmd.triggers) && cmd.triggers.length ? cmd.triggers : ["/" + cmd.id];
          return triggers.some((trigger) => trigger.toLowerCase().startsWith(stillFirst));
        }).slice(0, 8);
        renderSuggest(matches);
      });
    }
    function renderSuggest(items) {
      commandSuggest.items = items;
      commandSuggest.active = 0;
      if (!items.length) {
        els.suggestPopup.innerHTML = '<div class="suggest-empty">没有匹配的命令</div>';
        els.suggestPopup.classList.add("open");
        commandSuggest.open = true;
        return;
      }
      const html = items.map((cmd, idx) => {
        const triggers = Array.isArray(cmd.triggers) && cmd.triggers.length ? cmd.triggers : ["/" + cmd.id];
        const primary = triggers[0];
        return '<div class="suggest-item' + (idx === 0 ? ' active' : '') + '" role="option" data-idx="' + idx + '">'
          + '<span class="suggest-trigger">' + escapeHtml(primary) + '</span>'
          + '<span class="suggest-title">' + escapeHtml(cmd.title || cmd.id) + '</span>'
          + '</div>';
      }).join("");
      els.suggestPopup.innerHTML = html;
      els.suggestPopup.classList.add("open");
      commandSuggest.open = true;
      els.suggestPopup.querySelectorAll(".suggest-item").forEach((node) => {
        node.addEventListener("click", () => {
          commandSuggest.active = Number(node.dataset.idx) || 0;
          acceptSuggest();
        });
      });
    }
    function moveSuggest(delta) {
      if (!commandSuggest.items.length) return;
      const total = commandSuggest.items.length;
      commandSuggest.active = (commandSuggest.active + delta + total) % total;
      const nodes = els.suggestPopup.querySelectorAll(".suggest-item");
      nodes.forEach((node) => node.classList.remove("active"));
      const target = nodes[commandSuggest.active];
      if (target) {
        target.classList.add("active");
        target.scrollIntoView({ block: "nearest" });
      }
    }
    function acceptSuggest() {
      const cmd = commandSuggest.items[commandSuggest.active];
      if (!cmd) { closeSuggest(); return; }
      const triggers = Array.isArray(cmd.triggers) && cmd.triggers.length ? cmd.triggers : ["/" + cmd.id];
      const trigger = triggers[0];
      // 把 / 命令面板选中的也变成 tag，跟 chip 体验一致
      const label = cmd.title || cmd.id || trigger;
      setInputText("");
      insertInputTag(label, trigger);
      closeSuggest();
    }
    function closeSuggest() {
      if (!commandSuggest.open) return;
      commandSuggest.open = false;
      commandSuggest.items = [];
      commandSuggest.active = 0;
      els.suggestPopup.classList.remove("open");
      els.suggestPopup.innerHTML = "";
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
    }
    async function readSse(response, assistantId) {
      if (!response.ok || !response.body) {
        let detail = "";
        try {
          const payload = await response.clone().json();
          detail = payload?.message || payload?.error || "";
        } catch {
          try {
            detail = await response.clone().text();
          } catch {
            detail = "";
          }
        }
        throw new Error(detail ? "stream failed: " + detail : "stream failed (" + response.status + ")");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          handleEvent(block, assistantId);
        }
      }
      if (buffer.trim()) handleEvent(buffer, assistantId);
    }
    function handleEvent(block, assistantId) {
      const lines = block.split(/\r?\n/);
      let event = "message";
      const data = [];
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (!data.length) return;
      const payload = JSON.parse(data.join("\n"));
      if (event === "thinking") {
        if (payload.model_thinking) {
          appendThinking(assistantId, payload.delta || "", payload.text || "");
        } else {
          enqueueStep(assistantId, payload.step);
        }
      } else if (event === "agentic_event") {
        // 后端 agentic-handler 的三流事件实时透传：tool_call -> 业务视角的 summary+narrative 配对
        applyAgenticEvent(assistantId, payload.event);
      } else if (event === "a2ui_envelope" || event === "openui_envelope") {
        // 流式 OpenUI Lang：streaming-translator 把 lifecycle/tool_call 实时翻译成兼容 envelope
        const msg = getMsg(assistantId);
        if (msg && payload.envelope) {
          const state = ensureOpenUILangState(msg);
          applyOpenUILangEnvelopeToState(state, payload.envelope);
          state.hasIncrement = true;
          if (typeof payload.seq === "number") {
            state.lastSeq = payload.seq;
            if (payload.run_id) state.runId = payload.run_id;
            if (payload.session_id) state.sessionId = payload.session_id;
          }
        }
      } else if (event === "a2ui_run_started" || event === "openui_run_started") {
        const msg = getMsg(assistantId);
        if (msg) {
          const state = ensureOpenUILangState(msg);
          state.runId = payload.run_id;
          state.sessionId = payload.session_id;
          state.traceId = payload.trace_id;
        }
      } else if (event === "a2ui_replay_done" || event === "a2ui_replay_empty" || event === "openui_replay_done" || event === "openui_replay_empty") {
        // 续传完成的标记，前端无需特殊处理
      } else if (event === "delta") {
        appendOpenUILangAwareText(assistantId, payload.text || "");
      } else if (event === "route") {
        patch(assistantId, { route: payload.route });
      } else if (event === "done") {
        queueDone(assistantId, payload);
      } else if (event === "error") {
        clearStepPlayback(assistantId);
        patch(assistantId, { text: STR.failed + (payload.message || "unknown error"), error: true, streaming: false, thinking: false });
        touchActiveSession();
      }
      render();
    }
    function applyView() {
      const view = isEffectivelyEmpty(messages) ? "landing" : "chat";
      if (document.body.dataset.view !== view) document.body.dataset.view = view;
      if (els.landingTitle && !els.landingTitle.textContent) els.landingTitle.textContent = STR.landingTitle;
    }
    function render() {
      renderDomainSwitch();
      renderPersonPicker();
      renderSessionList();
      const active = getActiveSession();
      if (shouldRecoverMessagesFromActiveSession(active)) messages = active.messages;
      applyView();
      const user = getCurrentUser();
      els.chatTitle.textContent = active?.title || STR.untitled;
      els.chatSubtitle.textContent = [currentDomainLabel(), user?.name || ""].filter(Boolean).join(" · ");
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
          body.className = "assistant-body" + (msg.text ? " has-answer" : "");
          if (shouldShowRun(msg)) {
            // Debug 关 = 业务视角；开 = 完整 phase 列表
            body.appendChild(els.debug.checked ? createRunPanel(msg) : createBizPanel(msg));
          }
          const hasOpenUICompatSurface = Boolean(msg.a2ui?.length || msg.a2uiState);
          const shouldPrioritizeOpenUI = hasOpenUICompatSurface && hasPrimaryOpenUILangSurface(msg);
          if (shouldPrioritizeOpenUI) body.appendChild(renderOpenUILangSurfaces(msg));
          if (shouldRenderAnswerMarkdown(msg, shouldPrioritizeOpenUI)) {
            const text = document.createElement("div");
            const textClasses = ["markdown"];
            const answerAge = msg.answerStartedAt ? Date.now() - msg.answerStartedAt : Infinity;
            if (answerAge < 460) {
              textClasses.push("answer-enter");
              text.style.animationDelay = "-" + Math.max(0, answerAge) + "ms";
            }
            if (msg.answerStreaming && msg.text) textClasses.push("answer-streaming");
            if (msg.answerFinalizing) textClasses.push("answer-finalizing");
            text.className = textClasses.join(" ");
            if (msg.answerStreaming) {
              text.innerHTML = renderStreamingMarkdown(msg.text || "");
            } else {
              text.innerHTML = renderMarkdown(msg.text || "");
            }
            body.appendChild(text);
          }
          if (msg.sources?.length && !hasOpenUILangSourceSurface(msg)) body.appendChild(renderSourceDisclosure(msg.sources));
          if (hasOpenUICompatSurface && !shouldPrioritizeOpenUI) body.appendChild(renderOpenUILangSurfaces(msg));
          row.appendChild(body);
        }
        els.messages.appendChild(row);
      }
      els.messages.scrollTop = els.messages.scrollHeight;
      setBusy(loading);
      if (window.lucide) lucide.createIcons();
    }
    function shouldRecoverMessagesFromActiveSession(active) {
      if (!active || !Array.isArray(active.messages) || messages === active.messages) return false;
      if (loading) return false;
      const activeHasAssistant = active.messages.some((message) => message?.role === "assistant");
      const currentHasAssistant = Array.isArray(messages) && messages.some((message) => message?.role === "assistant");
      return activeHasAssistant && !currentHasAssistant;
    }
    // 全局 100ms tick：只刷新 .biz-time 文本（处理中… X.Xs），不重渲整个 DOM
    setInterval(() => {
      const nodes = document.querySelectorAll(".biz.running .biz-time");
      if (!nodes.length) return;
      for (const node of nodes) {
        const wrap = node.closest(".biz");
        const id = wrap?.dataset.msgId;
        const msg = id ? messages.find((m) => m.id === id) : null;
        if (!msg || !msg.startedAt) continue;
        node.textContent = STR.processing + " " + formatBizSeconds(getDisplayLatency(msg, true)) + "s";
      }
    }, 100);
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
      els.sideUser.textContent = [currentDomainLabel(), getCurrentUser()?.name || ""].filter(Boolean).join(" · ");
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
        rename.title = "\u91cd\u547d\u540d";
        rename.setAttribute("aria-label", "\u91cd\u547d\u540d\u4f1a\u8bdd");
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
        remove.title = "\u5220\u9664";
        remove.setAttribute("aria-label", "\u5220\u9664\u4f1a\u8bdd");
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
      return msg.streaming || msg.thinking || msg.steps?.length || msg.debug?.steps?.length || msg.bizPairs?.length;
    }
    function cssEscape(value) {
      return window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/["\\]/g, "\\$&");
    }
    function bizHeadSelector(id) {
      return '.biz[data-msg-id="' + cssEscape(id) + '"] .biz-head';
    }
    function preserveMessagesAnchor(anchor, afterRenderSelector, action) {
      const beforeTop = anchor?.getBoundingClientRect?.().top;
      const beforeScrollTop = els.messages.scrollTop;
      action();
      if (typeof beforeTop !== "number") return;
      const nextAnchor = afterRenderSelector ? els.messages.querySelector(afterRenderSelector) : anchor;
      if (!nextAnchor?.getBoundingClientRect) {
        els.messages.scrollTop = beforeScrollTop;
        return;
      }
      const afterTop = nextAnchor.getBoundingClientRect().top;
      els.messages.scrollTop += afterTop - beforeTop;
    }
    function preserveNativeToggleAnchor(anchor) {
      const beforeTop = anchor?.getBoundingClientRect?.().top;
      if (typeof beforeTop !== "number") return;
      requestAnimationFrame(() => {
        const afterTop = anchor.getBoundingClientRect().top;
        els.messages.scrollTop += afterTop - beforeTop;
      });
    }
    // 业务视角面板：顶部"处理中… X.Xs" 100ms tick + summary→narrative 配对
    function createBizPanel(msg) {
      const wrap = document.createElement("div");
      wrap.className = "biz" + (msg.failed ? " failed" : (msg.streaming || msg.thinking) ? " running" : "") + (msg.bizCollapsed ? " collapsed" : "");
      wrap.dataset.msgId = msg.id;
      const head = document.createElement("div");
      head.className = "biz-head";
      head.setAttribute("role", "button");
      head.setAttribute("tabindex", "0");
      head.setAttribute("aria-expanded", String(!msg.bizCollapsed));
      head.addEventListener("click", () => toggleBizCollapsed(msg.id, head));
      head.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleBizCollapsed(msg.id, head);
        }
      });
      const dot = document.createElement("span");
      dot.className = "dotanim";
      if (msg.failed) {
        dot.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
      }
      const time = document.createElement("span");
      time.className = "biz-time";
      const dt = formatBizSeconds(getDisplayLatency(msg, msg.streaming || msg.thinking));
      const prefix = msg.failed ? STR.failedRun : (msg.streaming || msg.thinking ? STR.processing : STR.processed);
      time.textContent = prefix + " " + dt + "s";
      const chevron = document.createElement("span");
      chevron.className = "biz-chevron";
      chevron.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';
      head.append(dot, time, chevron);
      wrap.appendChild(head);
      const body = document.createElement("div");
      body.className = "biz-body";
      const pairs = msg.bizPairs?.length ? msg.bizPairs : stepsToBizPairs(msg);
      const activeIndex = !msg.failed && (msg.streaming || msg.thinking) ? pairs.length - 1 : -1;
      pairs.forEach((pair, index) => {
        const item = document.createElement("div");
        const statusClass = pair.status ? " biz-pair-status-" + pair.status : "";
        const isActive = index === activeIndex || pair.status === "running";
        item.className = "biz-pair biz-fadein" + (isActive ? " active" : "") + statusClass;
        if (pair.summary || pair.status === "running") {
          const s = document.createElement("p");
          s.className = "biz-summary-line";
          // 运行中的卡片用 loader 图标，失败的用 alert-circle，完成的用原图标
          const icon = pair.status === "running" ? "loader" : (pair.status === "failed" ? "alert-circle" : (pair.icon || "circle"));
          s.innerHTML = '<span class="glyph"><i data-lucide="' + icon + '"></i></span><span class="summary-text"></span>';
          const summaryText = pair.status === "running" && !pair.summary ? "\u8c03\u7528\u5de5\u5177\u4e2d\u2026" : (pair.summary || "");
          s.querySelector(".summary-text").textContent = summaryText;
          item.appendChild(s);
        }
        if (pair.narrative) {
          const n = document.createElement("p");
          n.className = "biz-narrative";
          n.textContent = pair.narrative;
          item.appendChild(n);
        }
        if (pair.errorMessage) {
          const e = document.createElement("p");
          e.className = "biz-narrative biz-error";
          e.textContent = pair.errorMessage;
          item.appendChild(e);
        }
        body.appendChild(item);
      });
      wrap.appendChild(body);
      return wrap;
    }
    function toggleBizCollapsed(id, anchor) {
      const msg = getMsg(id);
      if (!msg) return;
      preserveMessagesAnchor(anchor, bizHeadSelector(id), () => {
        msg.bizCollapsed = !msg.bizCollapsed;
        touchActiveSession();
        render();
      });
    }
    function createRunPanel(msg) {
      const details = document.createElement("details");
      details.className = "run-panel";
      details.open = typeof msg.runPanelOpen === "boolean" ? msg.runPanelOpen : Boolean(msg.streaming || msg.thinking);
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
        duration.textContent = formatDuration(getDisplayLatency(msg, false));
        summary.appendChild(duration);
      }
      const chevron = document.createElement("span");
      chevron.className = "run-chevron";
      chevron.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
      summary.appendChild(chevron);
      summary.addEventListener("click", () => preserveNativeToggleAnchor(summary));
      summary.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") preserveNativeToggleAnchor(summary);
      });
      const body = document.createElement("div");
      body.className = "run-body";
      body.appendChild(createDebugOverview(msg));
      body.appendChild(createDebugSteps(msg));
      appendDebugSection(body, "\u8def\u7531\u7ed3\u679c", msg.debug?.route || msg.route);
      appendDebugSection(body, "\u5de5\u5177\u8c03\u7528", msg.debug?.tool_calls);
      appendDebugSection(body, "\u5de5\u5177\u7ed3\u679c", msg.debug?.tool_results);
      appendDebugSection(body, "Agent State", msg.debug?.state);
      appendDebugSection(body, "\u4f1a\u8bdd\u4e0a\u4e0b\u6587", msg.debug?.conversation);
      appendDebugSection(body, "\u8fd0\u884c\u65f6\u95f4", msg.debug?.runtime);
      const toolCount = countToolSteps(msg);
      if (toolCount) {
        const toolLine = document.createElement("div");
        toolLine.className = "tool-line";
        toolLine.innerHTML = '<span class="tool-icon">></span><span>' + STR.ranCommands + " " + toolCount + " " + "\u6761\u547d\u4ee4" + "</span>";
        body.appendChild(toolLine);
      }
      details.append(summary, body);
      details.addEventListener("toggle", () => {
        msg.runPanelOpen = details.open;
        touchActiveSession();
      });
      return details;
    }
    function createDebugOverview(msg) {
      const wrap = document.createElement("div");
      wrap.className = "debug-overview";
      const debug = msg.debug || {};
      const route = debug.route || msg.route || {};
      const chips = [
        ["intent", route.intent_code || route.intent],
        ["class", route.execution_class],
        ["handler", route.handler_type],
        ["source", route.router_source || route.source || route.router],
        ["confidence", route.confidence],
        ["tools", debug.selected_tools?.length ? debug.selected_tools.join(", ") : null],
        ["latency", formatDuration(getDisplayLatency(msg, false) || debug.latency_ms)]
      ].filter(([, value]) => value !== undefined && value !== null && value !== "");
      if (!chips.length) {
        const chip = document.createElement("span");
        chip.className = "debug-chip";
        chip.textContent = msg.streaming || msg.thinking ? "\u6b63\u5728\u6536\u96c6\u8fd0\u884c\u4fe1\u606f" : "\u672c\u6b21\u6ca1\u6709\u8fd4\u56de debug \u660e\u7ec6";
        wrap.appendChild(chip);
        return wrap;
      }
      for (const [label, value] of chips) {
        const chip = document.createElement("span");
        chip.className = "debug-chip";
        chip.innerHTML = "<b></b><span></span>";
        chip.querySelector("b").textContent = label;
        chip.querySelector("span").textContent = String(value);
        wrap.appendChild(chip);
      }
      return wrap;
    }
    function createDebugSteps(msg) {
      const raw = msg.steps?.length ? msg.steps : msg.debug?.steps || [];
      const section = document.createElement("details");
      section.className = "debug-section";
      section.open = true;
      const summary = document.createElement("summary");
      summary.textContent = "\u6267\u884c\u6b65\u9aa4" + (raw.length ? " (" + raw.length + ")" : "");
      const body = document.createElement("div");
      body.className = "debug-section-body";
      if (!raw.length) {
        const pre = document.createElement("pre");
        pre.className = "debug-pre";
        pre.textContent = STR.thinking;
        body.appendChild(pre);
      } else {
        for (const step of raw) {
          const item = document.createElement("div");
          item.className = "debug-step";
          const phase = document.createElement("div");
          phase.className = "debug-phase";
          phase.textContent = step.phase || "-";
          const detail = document.createElement("div");
          detail.className = "debug-detail";
          const title = document.createElement("strong");
          title.textContent = step.title || "(no title)";
          const text = document.createElement("span");
          text.textContent = step.detail || step.text || "";
          detail.append(title, text);
          item.append(phase, detail);
          body.appendChild(item);
        }
      }
      section.append(summary, body);
      return section;
    }
    function appendDebugSection(parent, title, value) {
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) return;
      const section = document.createElement("details");
      section.className = "debug-section";
      const summary = document.createElement("summary");
      summary.textContent = title;
      const body = document.createElement("div");
      body.className = "debug-section-body";
      const pre = document.createElement("pre");
      pre.className = "debug-pre";
      pre.textContent = prettyJson(value);
      body.appendChild(pre);
      section.append(summary, body);
      parent.appendChild(section);
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
        thought.textContent = steps.slice(-3).map((step) => step.text).join("\n\n");
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
    function stepsToBizPairs(msg) {
      const raw = msg.steps?.length ? msg.steps : msg.debug?.steps || [];
      const pairs = [];
      for (const step of raw) {
        const pair = stepToBizPair(step);
        if (pair) pairs.push(pair);
      }
      return dedupeBizPairs(pairs);
    }
    function stepToBizPair(step) {
      const phase = step.phase || "";
      if (["identify_user", "select_skill", "load_skill", "model_thinking"].includes(phase)) return null;
      const detail = userFacingStepDetail(phase, step.detail || step.text || "");
      if (phase === "classify_intent") {
        const isInitialReceipt = step.status === "running" || /^\u6b63\u5728\u7406\u89e3\u4f60\u7684\u95ee\u9898/.test(detail);
        return {
          icon: isInitialReceipt ? "message-circle-more" : "route",
          summary: isInitialReceipt ? "\u5df2\u6536\u5230\u4f60\u7684\u6d88\u606f" : "\u6b63\u5728\u7406\u89e3\u4f60\u7684\u95ee\u9898",
          narrative: isInitialReceipt
            ? "\u6211\u5148\u770b\u4e00\u4e0b\u4f60\u8981\u95ee\u7684\u5185\u5bb9\u3001\u8303\u56f4\u548c\u65f6\u95f4\u3002"
            : detail || "\u8fd9\u4e2a\u95ee\u9898\u53ef\u4ee5\u6309\u786e\u5b9a\u7684\u4e1a\u52a1\u8def\u5f84\u6765\u5904\u7406\u3002"
        };
      }
      if (phase === "intent_query" || phase === "plan_action") {
        return {
          icon: "list-checks",
          summary: "\u51c6\u5907\u4e86\u5904\u7406\u6b65\u9aa4",
          narrative: "\u6211\u5df2\u7ecf\u628a\u8fd9\u4e2a\u95ee\u9898\u62c6\u6210\u53ef\u76f4\u63a5\u6267\u884c\u7684\u67e5\u8be2\u3002"
        };
      }
      if (phase === "execute_tool" || phase === "tool_round" || phase === "retrieve_knowledge") {
        return {
          icon: phase === "retrieve_knowledge" ? "book-open" : "database",
          summary: phase === "retrieve_knowledge" ? "\u67e5\u9605\u4e86\u77e5\u8bc6\u5e93" : "\u67e5\u8be2\u4e86\u4e1a\u52a1\u6570\u636e",
          narrative: phase === "retrieve_knowledge"
            ? detail || "\u6211\u627e\u5230\u4e86\u76f8\u5173\u7684\u5236\u5ea6\u548c\u8bf4\u660e\u3002"
            : detail || "\u76f8\u5173\u6570\u636e\u5df2\u7ecf\u62ff\u5230\uff0c\u6211\u6765\u6574\u7406\u6210\u597d\u8bfb\u7684\u7ed3\u679c\u3002"
        };
      }
      if (phase === "observe_result") {
        return {
          icon: "scan-search",
          summary: "\u6574\u7406\u4e86\u67e5\u8be2\u7ed3\u679c",
          narrative: "\u6211\u4f1a\u5148\u7ed9\u4f60\u7ed3\u8bba\uff0c\u518d\u628a\u9700\u8981\u6838\u5bf9\u7684\u660e\u7ec6\u653e\u5728\u4e0b\u9762\u3002"
        };
      }
      if (phase === "permission_denied") {
        return {
          icon: "shield-alert",
          summary: "\u6743\u9650\u5df2\u62e6\u622a",
          narrative: detail || "\u5f53\u524d\u8d26\u53f7\u6ca1\u6709\u8bbf\u95ee\u8fd9\u7c7b\u6570\u636e\u7684\u6743\u9650\u3002"
        };
      }
      if (phase === "chitchat") {
        return {
          icon: "message-circle",
          summary: "\u76f4\u63a5\u56de\u7b54",
          narrative: detail || "\u8fd9\u4e2a\u95ee\u9898\u53ef\u4ee5\u76f4\u63a5\u56de\u7b54\u3002"
        };
      }
      if (phase === "final_answer") {
        return {
          icon: "check-circle-2",
          summary: "\u751f\u6210\u4e86\u56de\u7b54",
          narrative: detail || "\u6211\u5df2\u5c06\u5904\u7406\u7ed3\u679c\u7ec4\u7ec7\u6210\u53ef\u76f4\u63a5\u9605\u8bfb\u7684\u56de\u7b54\u3002"
        };
      }
      return detail ? { icon: "circle", summary: userFacingStepTitle(step.title), narrative: detail } : null;
    }
    function stepToNaturalText(step) {
      const phase = step.phase || "";
      const detail = clean(step.detail || step.text || "");
      if (phase === "classify_intent") return detail || "\u6211\u5728\u5224\u65ad\u8fd9\u662f\u4ec0\u4e48\u7c7b\u578b\u7684\u95ee\u9898\uff0c\u4ee5\u53ca\u662f\u5426\u9700\u8981\u8c03\u7528\u5de5\u5177\u3002";
      if (phase === "plan_action" || phase === "plan_follow_up" || phase === "plan_evidence") return detail || "\u6211\u5728\u6839\u636e\u5f53\u524d\u7ebf\u7d22\u89c4\u5212\u4e0b\u4e00\u6b65\uff0c\u5fc5\u8981\u65f6\u624d\u4f1a\u8c03\u7528\u8d44\u6599\u6216\u5de5\u5177\u3002";
      if (phase === "execute_tool" || phase === "tool_round") return detail || "\u6211\u5df2\u7ecf\u8c03\u7528\u4e86\u548c\u8fd9\u4e2a\u95ee\u9898\u76f8\u5173\u7684\u80fd\u529b\uff0c\u6b63\u5728\u6574\u7406\u7ed3\u679c\u3002";
      if (phase === "observe_result") return detail || "\u6211\u5728\u5224\u65ad\u5df2\u83b7\u5f97\u7684\u4fe1\u606f\u662f\u5426\u8db3\u591f\u76f4\u63a5\u56de\u7b54\u3002";
      if (phase === "model_thinking") return detail;
      if (phase === "final_answer") return detail || "\u4fe1\u606f\u5df2\u7ecf\u8db3\u591f\uff0c\u6211\u5728\u628a\u7ed3\u679c\u7ec4\u7ec7\u6210\u81ea\u7136\u8bed\u8a00\u3002";
      return detail;
    }
    function userFacingStepTitle(title) {
      const text = clean(title);
      const titleMap = {
        "\u7406\u89e3\u4f60\u7684\u95ee\u9898": "\u7406\u89e3\u4e86\u4f60\u7684\u95ee\u9898",
        "\u8bc6\u522b\u4efb\u52a1\u7c7b\u578b": "\u7406\u89e3\u4e86\u4f60\u7684\u95ee\u9898",
        "\u8bc6\u522b\u8bf7\u6c42\u7c7b\u578b": "\u7406\u89e3\u4e86\u4f60\u7684\u95ee\u9898",
        "\u9009\u62e9\u6267\u884c\u6a21\u5f0f": "\u9009\u62e9\u4e86\u5904\u7406\u65b9\u5f0f",
        "\u89c4\u5212\u4e0b\u4e00\u6b65": "\u51c6\u5907\u4e86\u5904\u7406\u6b65\u9aa4",
        "\u6267\u884c\u7ed3\u6784\u5316\u67e5\u8be2": "\u67e5\u8be2\u4e86\u4e1a\u52a1\u6570\u636e",
        "\u8c03\u7528\u5de5\u5177": "\u67e5\u8be2\u4e86\u4e1a\u52a1\u6570\u636e",
        "\u6267\u884c\u5de5\u5177": "\u67e5\u8be2\u4e86\u4e1a\u52a1\u6570\u636e",
        "\u89c2\u5bdf\u7ed3\u679c": "\u6574\u7406\u4e86\u67e5\u8be2\u7ed3\u679c",
        "\u76f4\u63a5\u751f\u6210\u56de\u7b54": "\u76f4\u63a5\u56de\u7b54",
        "\u751f\u6210\u6700\u7ec8\u7b54\u590d": "\u751f\u6210\u4e86\u56de\u7b54",
        "\u7ee7\u7eed\u53d7\u63a7\u6d41\u7a0b": "\u7ee7\u7eed\u5904\u7406\u4e1a\u52a1\u6d41\u7a0b",
        "\u8fdb\u5165\u53d7\u63a7\u6d41\u7a0b": "\u8fdb\u5165\u4e1a\u52a1\u6d41\u7a0b",
        "\u5207\u6362\u4efb\u52a1": "\u5207\u6362\u4e86\u5904\u7406\u4efb\u52a1",
        "\u51b3\u5b9a\u4e0b\u4e00\u6b65": "\u51c6\u5907\u4e86\u5904\u7406\u6b65\u9aa4",
        "\u8de8\u610f\u56fe\u89c4\u5212": "\u8fdb\u884c\u4e86\u7efc\u5408\u5206\u6790",
        "\u9700\u8981\u8865\u5145\u4fe1\u606f": "\u9700\u8981\u8865\u5145\u4fe1\u606f"
      };
      return titleMap[text] || text || "\u5904\u7406\u4e86\u4e00\u4e2a\u6b65\u9aa4";
    }
    function userFacingStepDetail(phase, detail) {
      const raw = String(detail || "");
      if (!raw.trim()) return "";
      if (/^\u6b63\u5728\u5224\u65ad\u95ee\u9898\u7c7b\u578b/.test(raw)) return "\u6b63\u5728\u7406\u89e3\u4f60\u7684\u95ee\u9898\u548c\u9700\u8981\u7684\u4e0a\u4e0b\u6587\u3002";
      if (/Router \u5224\u5b9a\u4e3a/.test(raw)) return userFacingRouterDetail(raw);
      if (/^\u5224\u65ad\u4e3a/.test(raw)) return userFacingLegacyRouteDetail(raw);
      if (/fast[_ ]grounded/i.test(raw)) return userFacingFastGroundedDetail(phase, raw);
      if (/^\u547d\u4e2d .*\u5df2\u751f\u6210\u786e\u5b9a\u6027\u67e5\u8be2\u8ba1\u5212/.test(raw)) return "\u5df2\u51c6\u5907\u597d\u4e1a\u52a1\u67e5\u8be2\u6b65\u9aa4\u3002";
      if (/^\u547d\u4e2d .*\u5df2\u8c03\u7528/.test(raw)) return raw.replace(/^\u547d\u4e2d .*\uff0c/, "").replace(/\uff0c?\u5df2\u8c03\u7528 [^\uff0c]+\uff0c/, "\u5df2\u5b8c\u6210\u4e1a\u52a1\u67e5\u8be2\uff0c");
      if (/\u8fd9\u662f\u53d7\u63a7\u6267\u884c\u91cc\u7684\u8f7b\u91cf\u4ea4\u4e92/.test(raw)) return "\u8fd9\u4e2a\u95ee\u9898\u53ef\u4ee5\u76f4\u63a5\u56de\u7b54\u3002";
      if (/^\u65e0\u9700\u8c03\u7528\u5de5\u5177/.test(raw)) return "\u8fd9\u4e2a\u95ee\u9898\u53ef\u4ee5\u76f4\u63a5\u56de\u7b54\u3002";
      if (/^\u5f53\u524d\u95ee\u9898\u4e0d\u9700\u8981\u8c03\u7528\u4e1a\u52a1\u5de5\u5177/.test(raw)) return "\u5f53\u524d\u95ee\u9898\u4e0d\u9700\u8981\u67e5\u8be2\u4e1a\u52a1\u7cfb\u7edf\uff0c\u53ef\u4ee5\u57fa\u4e8e\u5f53\u524d\u4e0a\u4e0b\u6587\u56de\u7b54\u3002";
      if (/^\u77e5\u8bc6\u5e93\u547d\u4e2d (\d+) \u4e2a\u7247\u6bb5/.test(raw)) return raw.replace(/^\u77e5\u8bc6\u5e93\u547d\u4e2d/, "\u67e5\u9605\u5230");
      if (/^\u8c03\u7528 (intent|tool|skill)\./.test(raw)) return "\u6b63\u5728\u4f7f\u7528\u76f8\u5173\u80fd\u529b\u5904\u7406\u3002";
      return clean(raw)
        .replace(/\bRouter\b/gi, "\u7cfb\u7edf")
        .replace(/\bcontrolled execution\b|\bcontrolled_execution\b/gi, "\u53d7\u63a7\u6267\u884c")
        .replace(/\bautonomous planning\b|\bautonomous_planning\b/gi, "\u7efc\u5408\u5206\u6790")
        .replace(/\bsource=\w+\b/gi, "")
        .replace(/\bconfidence=?\s*[\w.]+\b/gi, "")
        .replace(/\uff08\s*\uff09/g, "")
        .replace(/\(\s*\)/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }
    function userFacingRouterDetail(text) {
      if (/chitchat/.test(text)) return "\u8bc6\u522b\u4e3a\u8f7b\u91cf\u95ee\u7b54\uff0c\u53ef\u4ee5\u76f4\u63a5\u5904\u7406\u3002";
      if (/intent_query/.test(text)) return "\u8bc6\u522b\u4e3a\u4e1a\u52a1\u6570\u636e\u67e5\u8be2\uff0c\u6b63\u5728\u4e3a\u4f60\u67e5\u8be2\u3002";
      if (/knowledge_lookup/.test(text)) return "\u8bc6\u522b\u4e3a\u77e5\u8bc6\u5e93\u95ee\u9898\uff0c\u5c06\u67e5\u9605\u76f8\u5173\u8d44\u6599\u540e\u56de\u7b54\u3002";
      if (/workflow/.test(text)) return "\u8bc6\u522b\u4e3a\u6d41\u7a0b\u529e\u7406\u8bf7\u6c42\uff0c\u5c06\u6309\u4e1a\u52a1\u6d41\u7a0b\u7ee7\u7eed\u5904\u7406\u3002";
      if (/agentic/.test(text)) return "\u8bc6\u522b\u4e3a\u9700\u8981\u7efc\u5408\u5206\u6790\u7684\u95ee\u9898\uff0c\u5c06\u5206\u6b65\u89c4\u5212\u548c\u67e5\u8be2\u3002";
      return "\u5df2\u8bc6\u522b\u95ee\u9898\u7c7b\u578b\uff0c\u6b63\u5728\u9009\u62e9\u5408\u9002\u7684\u5904\u7406\u65b9\u5f0f\u3002";
    }
    function userFacingLegacyRouteDetail(text) {
      if (/smalltalk|\u95ee\u5019|\u80fd\u529b\u4ecb\u7ecd/.test(text)) return "\u8bc6\u522b\u4e3a\u95ee\u5019\u6216\u80fd\u529b\u4ecb\u7ecd\u7c7b\u95ee\u9898\uff0c\u53ef\u4ee5\u76f4\u63a5\u56de\u7b54\u3002";
      if (/data_query|\u4e1a\u52a1|\u6570\u636e/.test(text)) return "\u8bc6\u522b\u4e3a\u4e1a\u52a1\u6570\u636e\u67e5\u8be2\uff0c\u6b63\u5728\u4e3a\u4f60\u67e5\u8be2\u3002";
      if (/workflow|\u6d41\u7a0b/.test(text)) return "\u8bc6\u522b\u4e3a\u6d41\u7a0b\u529e\u7406\u8bf7\u6c42\uff0c\u5c06\u7ee7\u7eed\u6536\u96c6\u548c\u786e\u8ba4\u4fe1\u606f\u3002";
      return "\u5df2\u8bc6\u522b\u95ee\u9898\u7c7b\u578b\uff0c\u6b63\u5728\u9009\u62e9\u5408\u9002\u7684\u5904\u7406\u65b9\u5f0f\u3002";
    }
    function userFacingFastGroundedDetail(phase, text) {
      if (phase === "final_answer") return "\u5df2\u6574\u7406\u51fa\u56de\u7b54\u3002";
      if (phase === "select_execution_mode") return "\u5df2\u9009\u62e9\u5feb\u901f\u5904\u7406\u65b9\u5f0f\u3002";
      if (phase === "plan_follow_up") return "\u8fd8\u9700\u8981\u8865\u5145\u4e00\u6b21\u67e5\u8be2\u6765\u5b8c\u5584\u7ed3\u679c\u3002";
      return clean(text).replace(/fast[_ ]grounded:?/ig, "\u5feb\u901f\u5904\u7406\u65b9\u5f0f");
    }
    function countToolSteps(msg) {
      const raw = msg.steps?.length ? msg.steps : msg.debug?.steps || [];
      return raw.filter((step) => ["execute_tool", "tool_round"].includes(step.phase)).length;
    }
    function enqueueStep(id, step) {
      const msg = getMsg(id);
      if (!msg || !step) return;
      if (msg.processFinalized) return;
      const queue = stepQueues.get(id) || [];
      const lastQueued = queue[queue.length - 1];
      const lastVisible = msg.steps[msg.steps.length - 1];
      if ((lastVisible && lastVisible.phase === step.phase && lastVisible.detail === step.detail)
        || (lastQueued && lastQueued.phase === step.phase && lastQueued.detail === step.detail)) {
        return;
      }
      queue.push(step);
      stepQueues.set(id, queue);
      msg.thinking = true;
      startStepPlayback(id, msg.steps.length ? STEP_REVEAL_INTERVAL_MS : 0);
    }
    function startStepPlayback(id, delay) {
      if (stepTimers.has(id)) return;
      const timer = window.setTimeout(() => {
        stepTimers.delete(id);
        const queue = stepQueues.get(id) || [];
        const step = queue.shift();
        if (step) {
          addStepNow(id, step);
          if (queue.length) {
            stepQueues.set(id, queue);
            startStepPlayback(id, STEP_REVEAL_INTERVAL_MS);
          } else {
            stepQueues.delete(id);
            flushPendingDone(id);
          }
        } else {
          stepQueues.delete(id);
          flushPendingDone(id);
        }
      }, delay);
      stepTimers.set(id, timer);
    }
    function addStepNow(id, step) {
      const msg = getMsg(id);
      if (!msg || !step) return;
      const last = msg.steps[msg.steps.length - 1];
      if (!last || last.phase !== step.phase || last.detail !== step.detail) msg.steps.push(step);
      msg.thinking = true;
      touchActiveSession();
      render();
    }
    function queueDone(id, payload) {
      pendingDoneEvents.set(id, payload);
      const queue = stepQueues.get(id);
      if (!queue?.length && !stepTimers.has(id)) flushPendingDone(id);
    }
    function flushPendingDone(id) {
      const payload = pendingDoneEvents.get(id);
      if (!payload) return;
      pendingDoneEvents.delete(id);
      const msg = getMsg(id);
      if (!msg) return;
      // 兜底：如果流式期间没有收到 openui/a2ui envelope，则把 done 全量数组喂入累积态。
      const state = ensureOpenUILangState(msg);
      const openuiPayload = readOpenUICompatEnvelopes(payload);
      if (!state.hasIncrement && Array.isArray(openuiPayload) && openuiPayload.length) {
        applyOpenUILangEnvelopesToState(state, openuiPayload);
      } else if (!state.hasIncrement && isOpenUILangDocument(payload.openui)) {
        applyOpenUILangDocumentToState(state, payload.openui);
      }
      patch(id, {
        text: resolveFinalAnswerText(msg, payload),
        steps: msg.steps.length ? msg.steps : (payload.debug?.steps || []),
        sources: payload.sources || [],
        a2ui: openuiPayload || [],
        openui: payload.openui || null,
        debug: payload.debug || {},
        backendLatency: payload.debug?.latency_ms,
        completedAt: Date.now(),
        streaming: false,
        thinking: false,
        failed: false,
        failedReason: null,
        streamed: true,
        bizCollapsed: true,
        processFinalized: true,
        answerStreaming: true,
        answerFinalizing: true
      });
      window.setTimeout(() => finalizeAnswerMarkdown(id), 520);
      touchActiveSession();
      render();
    }
    function finalizeAnswerMarkdown(id) {
      const msg = getMsg(id);
      if (!msg) return;
      msg.answerStreaming = false;
      msg.answerFinalizing = false;
      touchActiveSession();
      render();
    }
    function shouldRenderAnswerMarkdown(msg, hasPrimaryOpenUISurface) {
      const text = String(msg.text || "").trim();
      if (!text) return false;
      if (!hasPrimaryOpenUISurface) return true;
      if (isOpenUIPlaceholderText(text)) return false;
      return !looksLikeStructuredMarkdown(text);
    }
    function appendOpenUILangAwareText(id, text) {
      const msg = getMsg(id);
      if (!msg) return;
      const delta = normalize(text);
      if (!delta) return;
      if (shouldHoldForOpenUILang(msg, delta)) {
        if (!msg.openuiHoldStartedAt) msg.openuiHoldStartedAt = Date.now();
        msg.openuiPendingText = (msg.openuiPendingText || "") + delta;
        msg.answerStartedAt = msg.answerStartedAt || Date.now();
        msg.answerStreaming = true;
        touchActiveSession();
        return;
      }
      if (msg.openuiPendingText) {
        msg.text = (msg.text || "") + msg.openuiPendingText;
        msg.openuiPendingText = "";
      }
      appendText(id, delta);
    }
    function shouldHoldForOpenUILang(msg, delta) {
      if (msg.openuiDoNotHold) return false;
      if (hasPrimaryOpenUILangSurface(msg)) return true;
      const combined = [msg.userMessage, msg.text, msg.openuiPendingText, delta].map((item) => String(item || "")).join("\n");
      if (looksLikeStructuredMarkdown(combined)) return true;
      if (/(表格|列表|看板|面板|卡片|图标|进度|状态|分组|统计|指标|排行|风险|明细|汇总|日报|审批|表单|填写|提交)/.test(combined)) return true;
      if (/\b(table|list|dashboard|card|cards|chart|metric|metrics|risk|risks|form|approval|status|grouped|summary|report)\b/i.test(combined)) return true;
      return false;
    }
    function resolveFinalAnswerText(msg, payload) {
      const openuiPayload = readOpenUICompatEnvelopes(payload);
      const hasOpenUIPayload = (Array.isArray(openuiPayload) && openuiPayload.length > 0) || isOpenUILangDocument(payload.openui);
      const payloadAnswer = payload.answer || "";
      if (hasOpenUIPayload && isOpenUIPlaceholderText(payloadAnswer)) return msg.text && !isOpenUIPlaceholderText(msg.text) ? msg.text : "";
      if (hasOpenUIPayload && (looksLikeStructuredMarkdown(payloadAnswer) || msg.openuiPendingText)) {
        return payloadAnswer || msg.text || "";
      }
      if (msg.openuiPendingText) {
        const pending = msg.openuiPendingText;
        msg.openuiPendingText = "";
        msg.openuiDoNotHold = true;
        return (msg.text || "") + pending + (payloadAnswer && payloadAnswer !== pending ? payloadAnswer : "");
      }
      return payloadAnswer || msg.text;
    }
    function isOpenUIPlaceholderText(text) {
      return /^(?:openui|a2ui)\s+rendered\.?$/i.test(String(text || "").trim());
    }
    function readOpenUICompatEnvelopes(payload) {
      if (Array.isArray(payload?.openui_compat)) return payload.openui_compat;
      if (Array.isArray(payload?.a2ui)) return payload.a2ui;
      if (Array.isArray(payload?.openui)) return payload.openui;
      return [];
    }
    function isOpenUILangDocument(value) {
      return Boolean(value && value.protocol === "openui-lang/1.0" && Array.isArray(value.surfaces));
    }
    function looksLikeStructuredMarkdown(text) {
      const value = String(text || "");
      if (/^\s*\|.+\|\s*$/m.test(value) && /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/m.test(value)) return true;
      if (/^\s*#{1,3}\s+.+$/m.test(value) && /^\s*[-*]\s+/m.test(value)) return true;
      if (/^\s*#{1,3}\s+.+$/m.test(value) && /(^|\n)\s*(?:---+|___+)\s*(\n|$)/.test(value)) return true;
      return false;
    }
    function renderOpenUILangSurfaces(msg) {
      const wrap = document.createElement("div");
      wrap.className = "openui-surfaces a2ui-surfaces";
      const surfaces = collectOpenUILangSurfaces(msg);
      for (const surface of surfaces) {
        if (!els.debug.checked && isOpenUILangRuntimeSurface(surface)) continue;
        const root = renderOpenUILangProgressSurface(surface)
          || renderOpenUIView(surface)
          || (isOpenUILangSourceSurface(surface) ? renderOpenUILangSourceDisclosure(surface) : renderOpenUILangComponent(surface, surface.root));
        if (root) {
          if (surface.data && surface.data._skeleton) root.classList.add("openui-skeleton", "a2ui-skeleton");
          wrap.appendChild(root);
        }
      }
      return wrap;
    }
    function hasPrimaryOpenUILangSurface(msg) {
      return collectOpenUILangSurfaces(msg).some((surface) => !isOpenUILangRuntimeSurface(surface) && !isOpenUILangSourceSurface(surface));
    }
    
    function ensureOpenUILangState(msg) {
      const legacy = msg.a2uiState;
      const current = msg.openuiState;
      if (current && current.surfaces instanceof Map && Array.isArray(current.order)) {
        msg.a2uiState = current;
        return current;
      }
      if (legacy && legacy.surfaces instanceof Map && Array.isArray(legacy.order)) {
        msg.openuiState = legacy;
        return legacy;
      }
      msg.openuiState = { surfaces: new Map(), order: [], hasIncrement: false };
      msg.a2uiState = msg.openuiState;
      return msg.openuiState;
    }
    function collectOpenUILangSurfaces(msg) {
      const state = ensureOpenUILangState(msg);
      if (!state.hasIncrement) {
        if (msg.openui && msg.openui.protocol === "openui-lang/1.0" && Array.isArray(msg.openui.surfaces)) {
          applyOpenUILangDocumentToState(state, msg.openui);
        } else if ((msg.openui_compat || []).length) {
          applyOpenUILangEnvelopesToState(state, msg.openui_compat);
        } else if ((msg.a2ui || []).length) {
          applyOpenUILangEnvelopesToState(state, msg.a2ui);
        }
      }
      const out = [];
      for (const id of state.order) {
        const surface = state.surfaces.get(id);
        if (!surface || surface.deleted) continue;
        if (!surface.root || surface.components.size === 0) continue;
        out.push(surface);
      }
      return out;
    }
    function applyOpenUILangEnvelopesToState(state, envelopes) {
      for (const envelope of envelopes || []) applyOpenUILangEnvelopeToState(state, envelope);
    }
    function applyOpenUILangEnvelopeToState(state, envelope) {
      if (envelope.createSurface) {
        const s = envelope.createSurface;
        let surface = state.surfaces.get(s.surfaceId);
        if (!surface) {
          surface = { id: s.surfaceId, root: s.root, data: {}, components: new Map(), deleted: false };
          state.surfaces.set(s.surfaceId, surface);
          state.order.push(s.surfaceId);
        } else {
          surface.root = s.root;
          surface.deleted = false;
        }
      }
      if (envelope.updateDataModel) {
        const u = envelope.updateDataModel;
        let surface = state.surfaces.get(u.surfaceId);
        if (!surface) {
          surface = { id: u.surfaceId, root: "", data: {}, components: new Map(), deleted: false };
          state.surfaces.set(u.surfaceId, surface);
          state.order.push(u.surfaceId);
        }
        if (!u.path) {
          surface.data = u.value || {};
        } else {
          const segments = parseOpenUILangDataPath(u.path);
          let cursor = surface.data;
          for (let i = 0; i < segments.length - 1; i++) {
            const key = segments[i];
            if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {};
            cursor = cursor[key];
          }
          cursor[segments[segments.length - 1]] = u.value;
        }
      }
      if (envelope.updateComponents) {
        const u = envelope.updateComponents;
        let surface = state.surfaces.get(u.surfaceId);
        if (!surface) {
          surface = { id: u.surfaceId, root: "", data: {}, components: new Map(), deleted: false };
          state.surfaces.set(u.surfaceId, surface);
          state.order.push(u.surfaceId);
        }
        for (const item of u.components || []) {
          if (!item || !item.id) continue;
          surface.components.set(item.id, item.component || {});
        }
      }
      if (envelope.deleteSurface) {
        const surface = state.surfaces.get(envelope.deleteSurface.surfaceId);
        if (surface) surface.deleted = true;
      }
    }
    function applyOpenUILangDocumentToState(state, document) {
      if (!document || document.protocol !== "openui-lang/1.0" || !Array.isArray(document.surfaces)) return;
      for (const item of document.surfaces) {
        if (!item || !item.id) continue;
        let surface = state.surfaces.get(item.id);
        if (!surface) {
          surface = { id: item.id, root: item.root || "", data: {}, components: new Map(), deleted: false };
          state.surfaces.set(item.id, surface);
          state.order.push(item.id);
        }
        surface.root = item.root || surface.root || "";
        surface.deleted = false;
        surface.data = Object.assign({}, item.data || {});
        if (item.view && item.view.component) {
          surface.data.openui = {
            protocol: "openui-bridge/0.1",
            component: item.view.component,
            props: item.view.props || {},
            actions: item.view.actions || []
          };
        }
        surface.components = new Map();
        for (const node of item.nodes || []) {
          if (!node || !node.id || !node.componentName) continue;
          const props = Object.assign({}, node.props || {});
          if (Array.isArray(node.children) && node.children.length) {
            props.children = node.children
              .map((child) => typeof child === "string" ? child : child && child.id)
              .filter(Boolean);
          }
          surface.components.set(node.id, { [node.componentName]: props });
        }
      }
    }
    function parseOpenUILangDataPath(path) {
      const text = String(path || "");
      return text.startsWith("/")
        ? text.slice(1).split("/").filter(Boolean).map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"))
        : text.split(/[./]/).filter(Boolean);
    }

    var ensureA2UIState = ensureOpenUILangState;
    var collectA2UISurfaces = collectOpenUILangSurfaces;
    var applyA2UIEnvelopesToState = applyOpenUILangEnvelopesToState;
    var applyA2UIEnvelopeToState = applyOpenUILangEnvelopeToState;
    var parseA2UIDataPath = parseOpenUILangDataPath;
  
    
    function renderOpenUILangForm(formSpec, surface) {
      if (!formSpec || !Array.isArray(formSpec.fields) || !formSpec.submitAction?.name) return null;
      var form = document.createElement("form");
      form.className = "openui-form";
      var values = formSpec.initialValues || {};
      formSpec.fields.forEach(function(field) {
        if (!field || !field.name) return;
        var name = String(field.name);
        var wrap = document.createElement("div");
        wrap.className = "openui-form-field";
        var label = document.createElement("label");
        label.className = "openui-form-label";
        label.textContent = clean(field.label || name);
        label.htmlFor = "openui_field_" + name;
        var input;
        if (field.component === "TextArea") {
          input = document.createElement("textarea");
          input.value = String(values[name] || "");
        } else if (field.component === "Select") {
          input = document.createElement("input");
          input.type = "hidden";
          input.id = "openui_field_" + name;
          input.name = name;
          input.value = String(values[name] || "");
          var options = document.createElement("div");
          options.className = "openui-options";
          (Array.isArray(field.options) ? field.options : []).forEach(function(option) {
            var optionValue = String(option.value || "");
            var pill = document.createElement("button");
            pill.type = "button";
            pill.className = "openui-option-pill" + (optionValue === String(input.value || "") ? " selected" : "");
            pill.setAttribute("aria-pressed", optionValue === String(input.value || "") ? "true" : "false");
            var dot = document.createElement("span");
            dot.className = "openui-option-dot";
            var text = document.createElement("span");
            text.textContent = clean(option.label || option.value || "");
            pill.append(dot, text);
            pill.addEventListener("click", function() {
              input.value = optionValue;
              options.querySelectorAll(".openui-option-pill").forEach(function(item) {
                item.classList.remove("selected");
                item.setAttribute("aria-pressed", "false");
              });
              pill.classList.add("selected");
              pill.setAttribute("aria-pressed", "true");
            });
            options.appendChild(pill);
          });
          wrap.append(label, input, options);
          form.appendChild(wrap);
          return;
        } else {
          input = document.createElement("input");
          input.type = field.component === "Hidden" ? "hidden" : "text";
          input.value = String(values[name] || "");
        }
        input.id = "openui_field_" + name;
        input.name = name;
        if (field.required) input.required = true;
        if (field.component !== "Hidden") wrap.append(label);
        wrap.append(input);
        form.appendChild(wrap);
      });
      var actions = document.createElement("div");
      actions.className = "openui-form-actions";
      var skip = document.createElement("button");
      skip.type = "button";
      skip.className = "openui-button secondary";
      skip.textContent = clean(formSpec.cancelLabel || "跳过");
      skip.addEventListener("click", function() {
        form.reset();
      });
      var submit = document.createElement("button");
      submit.type = "submit";
      submit.className = "openui-button";
      submit.textContent = clean(formSpec.submitAction.label || "提交");
      actions.append(skip, submit);
      form.appendChild(actions);
      form.addEventListener("submit", function(event) {
        event.preventDefault();
        var formData = new FormData(form);
        var submitted = {};
        formData.forEach(function(value, key) { submitted[key] = String(value); });
        var context = Object.assign({}, formSpec.submitAction.context || {}, { values: submitted });
        dispatchOpenUILangAction({ event: { name: formSpec.submitAction.name, context: context } }, surface, submit);
      });
      return form;
    }
    function renderOpenUILangComponent(surface, id) {
      const component = surface.components.get(id);
      if (!component) return null;
      const [type, props] = Object.entries(component)[0] || [];
      if (!type) return null;
      if (type === "Card") {
        const node = document.createElement("div");
        node.className = "openui-card";
        for (const child of props.children || []) {
          const childNode = renderOpenUILangComponent(surface, child);
          if (childNode) node.appendChild(childNode);
        }
        return node;
      }
      if (type === "Row") {
        const node = document.createElement("div");
        node.className = "openui-row";
        for (const child of props.children || []) {
          const childNode = renderOpenUILangComponent(surface, child);
          if (childNode) node.appendChild(childNode);
        }
        return node;
      }
      if (type === "Column" || type === "List") {
        const node = document.createElement("div");
        node.className = type === "Column" ? "openui-column" : "openui-list";
        for (const child of props.children || []) {
          const childNode = renderOpenUILangComponent(surface, child);
          if (childNode) node.appendChild(childNode);
        }
        return node;
      }
      if (type === "Tabs") {
        const node = document.createElement("div");
        node.className = "openui-tabs";
        for (const child of props.children || []) {
          const childNode = renderOpenUILangComponent(surface, child);
          if (childNode) node.appendChild(childNode);
        }
        return node;
      }
      if (type === "Text") {
        const node = document.createElement("div");
        node.className = "openui-text";
        node.innerHTML = renderMarkdown(resolveOpenUILangText(props.text, surface));
        return node;
      }
      if (type === "Button") {
        const node = document.createElement("button");
        node.type = "button";
        node.className = "openui-button" + (/拒绝|取消/.test(resolveOpenUILangText(props.text, surface)) ? " secondary" : "");
        node.textContent = resolveOpenUILangText(props.text, surface);
        node.addEventListener("click", () => dispatchOpenUILangAction(props.action, surface, node));
        return node;
      }
      if (type === "Image") {
        const node = document.createElement("img");
        node.className = "openui-image";
        node.src = clean(String(props.src || ""));
        node.alt = clean(String(props.alt || ""));
        return node;
      }
      if (type === "Icon") {
        const node = document.createElement("span");
        node.className = "openui-icon";
        node.setAttribute("aria-label", clean(String(props.label || props.name || "icon")));
        node.textContent = clean(iconGlyph(props.name || props.label || ""));
        return node;
      }
      if (type === "Video") {
        const node = document.createElement("video");
        node.className = "openui-video";
        node.src = clean(String(props.src || ""));
        node.controls = true;
        return node;
      }
      if (type === "AudioPlayer") {
        const node = document.createElement("audio");
        node.className = "openui-audio";
        node.src = clean(String(props.src || ""));
        node.controls = true;
        return node;
      }
      const fallback = document.createElement("div");
      fallback.className = "openui-text";
      fallback.textContent = "不支持的组件：" + clean(type);
      return fallback;
    }
    function iconGlyph(name) {
      const key = String(name || "").toLowerCase();
      if (/warn|risk|alert|urgent|error|danger|紧急|风险|预警|异常/.test(key)) return "!";
      if (/success|ok|done|check|normal|正常|完成/.test(key)) return "✓";
      if (/pending|time|clock|wait|等待|待/.test(key)) return "…";
      if (/info|source|citation|引用|来源/.test(key)) return "i";
      return String(name || "•").slice(0, 2);
    }
    function resolveOpenUILangText(value, surface) {
      if (!value) return "";
      if (typeof value === "string") return value;
      if (typeof value.literalString === "string") return value.literalString;
      if (typeof value.path === "string") {
        const resolved = readOpenUILangDataPath(surface?.data || {}, value.path);
        return resolved === undefined || resolved === null ? "" : String(resolved);
      }
      return String(value);
    }
    function readOpenUILangDataPath(data, path) {
      const segments = parseOpenUILangDataPath(path);
      let cursor = data;
      for (const segment of segments) {
        if (!cursor || typeof cursor !== "object") return undefined;
        cursor = cursor[segment];
      }
      return cursor;
    }

    var renderA2UIForm = renderOpenUILangForm;
    var renderA2UIComponent = renderOpenUILangComponent;
    var resolveA2UIText = resolveOpenUILangText;
    var readA2UIDataPath = readOpenUILangDataPath;
  
    
    function ensureOpenUIRendererRegistry() {
      globalThis._openUILangRenderers = globalThis._openUILangRenderers || {};
      globalThis._a2uiOpenUIRenderers = globalThis._openUILangRenderers;
      return globalThis._openUILangRenderers;
    }
    var _openUILangRenderers = ensureOpenUIRendererRegistry();
    var _a2uiOpenUIRenderers = _openUILangRenderers;
    function registerRenderer(name, fn) {
      if (!name || typeof fn !== "function") return;
      ensureOpenUIRendererRegistry()[name] = fn;
    }
    function listRegisteredOpenUIRenderers() {
      return Object.keys(ensureOpenUIRendererRegistry()).sort();
    }
    function renderOpenUIView(surface) {
      const view = surface.data?.openui;
      if (!view?.component || view.protocol !== "openui-bridge/0.1") return null;
      const props = view.props || {};
      const renderer = ensureOpenUIRendererRegistry()[view.component];
      if (renderer) return renderer(surface, props, view);
      return materialCard("不支持的组件", "客户端暂不支持 " + clean(String(view.component)) + "，已降级显示。");
    }
  
    function renderOpenUILangProgressSurface(surface) {
      if (surface.root !== "progress_root") return null;
      const data = surface.data || {};
      const tone = String(data.tone || "info");
      const card = document.createElement("div");
      card.className = "openui-card openui-progress openui-progress-" + tone + " a2ui-card a2ui-progress a2ui-progress-" + tone;
      const title = document.createElement("div");
      title.className = "openui-progress-title a2ui-progress-title";
      title.textContent = String(data.title || "处理中");
      const detail = document.createElement("div");
      detail.className = "openui-progress-detail a2ui-progress-detail";
      detail.textContent = String(data.detail || "");
      card.append(title, detail);
      return card;
    }
    function hasOpenUILangSourceSurface(msg) {
      return (msg.a2ui || []).some((envelope) => {
        const surfaceId = envelope.createSurface?.surfaceId || envelope.updateComponents?.surfaceId || envelope.updateDataModel?.surfaceId || "";
        return surfaceId.includes("_sources");
      });
    }
    function isOpenUILangSourceSurface(surface) {
      return String(surface.id || "").includes("_sources") || surface.root === "sources_root";
    }
    function isOpenUILangRuntimeSurface(surface) {
      return String(surface.id || "").includes("_runtime")
        || surface.root === "runtime_root"
        || surface.data?.business_surface?.kind === "runtime_summary"
        || surface.data?.openui?.component === "RuntimeSummary";
    }
    function renderOpenUILangSourceDisclosure(surface) {
      const sources = Array.isArray(surface.data?.sources) ? surface.data.sources : [];
      return renderSourceDisclosure(sources);
    }
    /* 核心组件渲染器注册 */
    registerRenderer("CitationDisclosure", (surface, props) => renderSourceDisclosure(props.sources || surface.data?.sources || []));
    registerRenderer("ExpenseEstimate", (surface, props) => renderMaterialExpenseEstimate(surface, props));
    registerRenderer("ApprovalFlow", (surface, props, view) => renderMaterialApproval(surface, props, view.actions || []));
    registerRenderer("ApprovalCard", (surface, props, view) => renderMaterialApproval(surface, props, view.actions || []));
    registerRenderer("TaskResumeCard", (surface, props) => renderMaterialTaskResume(surface, props));
    /* Phase 4 Workbench Surface */
    registerRenderer("DataTableSurface", (surface, props) => renderDataTableSurface(surface, props));
    registerRenderer("GroupedListSurface", (surface, props) => renderGroupedListSurface(surface, props));
    registerRenderer("ToolCatalogSurface", (surface, props) => renderToolCatalogSurface(surface, props));
    registerRenderer("RiskListSurface", (surface, props) => renderRiskListSurface(surface, props));
    registerRenderer("MetricCardsSurface", (surface, props) => renderMetricCardsSurface(surface, props));
    registerRenderer("TagListSurface", (surface, props) => renderTagListSurface(surface, props));
    registerRenderer("BarChartSurface", (surface, props) => renderBarChartSurface(surface, props));
    registerRenderer("PieChartSurface", (surface, props) => renderPieChartSurface(surface, props));
    registerRenderer("LineChartSurface", (surface, props) => renderLineChartSurface(surface, props));
    registerRenderer("InsightSummarySurface", (surface, props) => renderInsightSummarySurface(surface, props));
    registerRenderer("AnalyticsDashboardSurface", (surface, props) => renderAnalyticsDashboardSurface(surface, props));
    registerRenderer("EvidenceSurface", (surface, props) => renderEvidenceSurface(surface, props));
    registerRenderer("TaskTrackingSurface", (surface, props) => renderTaskTrackingSurface(surface, props));
    registerRenderer("PendingActionSurface", (surface, props) => renderPendingActionSurface(surface, props));
    registerRenderer("RuntimeSummary", (surface, props) => renderRuntimeSummarySurface(surface, props));
    /* 域特定组件渲染器（从 DomainPack.chatPageRenderers 动态注入） */
    registerRenderer("LeaveRequestForm", (function(surface, props) {
      var missing = Array.isArray(props.missing_slots) ? props.missing_slots : [];
      var subtitle = props.step === "completed" ? "已提交"
        : props.step === "awaiting_confirmation" ? "确认以下请假信息后提交"
        : missing.length ? "请补全以下信息" : "信息已完整，可继续确认提交";
      var card = materialCard("请假申请", subtitle);
      var form = renderOpenUILangForm(props.form, surface);
      if (form) card.appendChild(form);
      return card;
    }));
    registerRenderer("DealerVehicleProgress", (function(surface, props) {
      var orders = Array.isArray(props.orders) ? props.orders : [];
      var summary = props.summary || {};
      if (!orders.length) return null;
      var card = materialCard("车辆交付进度", "由 OpenUI Bridge 映射到本地车辆进度物料");
      var metrics = document.createElement("div");
      metrics.className = "material-metrics";
      metrics.append(
        materialMetric(summary.total ?? orders.length, "相关订单"),
        materialMetric(summary.pending_delivery ?? "-", "待交付/整备"),
        materialMetric(summary.unpaid ?? "-", "未结清")
      );
      card.appendChild(metrics);
      var list = document.createElement("div");
      list.className = "material-list";
      orders.slice(0, 6).forEach(function(order) {
        var item = document.createElement("div");
        item.className = "material-item";
        var title = document.createElement("div");
        title.className = "material-item-title";
        title.textContent = clean([order.customer_name || "客户", [order.series, order.model].filter(Boolean).join(" ")].filter(Boolean).join(" · "));
        var row = document.createElement("div");
        row.className = "material-row";
        row.append(
          materialChip("订单 " + clean(order.id || "-")),
          materialChip("交付 " + clean(order.delivery_status || order.order_status || "-")),
          materialChip("收款 " + clean(order.payment_status || "-"))
        );
        var action = document.createElement("div");
        action.className = "material-action";
        var nextAction = (function(o) {
          if ((o.payment_status || "") !== "已结清") return "优先跟进尾款/金融放款到账";
          if ((o.invoice_status || "") !== "已开票") return "确认开票节点";
          if ((o.delivery_status || "") !== "已交付") return "确认整备、上牌和交付排期";
          return "已完成交付，保持客户回访";
        })(order);
        action.textContent = "下一步：" + nextAction;
        var timeline = renderMaterialTimeline(order.timeline || []);
        item.append(title, row);
        if (timeline) item.appendChild(timeline);
        item.appendChild(action);
        list.appendChild(item);
      });
      card.appendChild(list);
      return card;
    }));

    /* ──────────────────────────────────────────────────────────────
     * Phase 4 Workbench：通用 OpenUI Surface 渲染函数
     * ────────────────────────────────────────────────────────────── */

    function renderDataTableSurface(_surface, props) {
      const rows = Array.isArray(props.rows) ? props.rows : [];
      const columns = Array.isArray(props.columns) ? props.columns : [];
      const card = materialCard(props.title || "数据明细", props.description || ((props.rowCount || rows.length) + " 条记录"));
      if (!rows.length || !columns.length) {
        const empty = document.createElement("div");
        empty.className = "material-subtle";
        empty.textContent = "暂无可展示记录";
        card.appendChild(empty);
        return card;
      }
      const wrap = document.createElement("div");
      wrap.className = "material-table-wrap";
      const table = document.createElement("table");
      table.className = "material-table";
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      const visibleColumns = columns.slice(0, 8);
      const colgroup = document.createElement("colgroup");
      let minTableWidth = 0;
      visibleColumns.forEach((column) => {
        const col = document.createElement("col");
        const width = openUITableColumnWidth(column);
        col.style.width = width;
        minTableWidth += parseInt(width, 10) || 120;
        colgroup.appendChild(col);
      });
      table.style.minWidth = Math.max(760, minTableWidth) + "px";
      visibleColumns.forEach((column) => {
        const th = document.createElement("th");
        th.className = openUITableColumnClass(column);
        th.textContent = clean(column.label || column.key || "");
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      const tbody = document.createElement("tbody");
      const sortedRows = sortOpenUIRows(rows, visibleColumns);
      sortedRows.slice(0, 20).forEach((row) => {
        const tr = document.createElement("tr");
        visibleColumns.forEach((column) => {
          const td = document.createElement("td");
          td.className = openUITableColumnClass(column);
          const cell = renderOpenUITableCell(row?.[column.key], column);
          td.appendChild(cell);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.append(colgroup, thead, tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);
      if (Number(props.rowCount || rows.length) > 20) {
        const more = document.createElement("div");
        more.className = "material-subtle";
        more.textContent = "仅显示前 20 条，共 " + String(props.rowCount || rows.length) + " 条";
        card.appendChild(more);
      }
      return card;
    }

    function openUITableColumnClass(column) {
      const key = String(column.key || column.label || "");
      if (column.type === "status" || /状态|风险|等级|是否|status|risk|warning|level/i.test(key)) return "col-status";
      if (column.type === "currency") return "col-currency";
      if (column.type === "number") return "col-number";
      if (column.type === "date") return "col-date";
      return "";
    }

    function openUITableColumnWidth(column) {
      const key = String(column.key || column.label || "");
      if (/阶段|stage/i.test(key)) return "92px";
      if (/状态|status|risk|warning|level|风险|等级/i.test(key)) return "76px";
      if (/负责人|owner|assignee/i.test(key)) return "104px";
      if (/金额|预算|GMV|收入|价格|currency|amount|budget|revenue/i.test(key)) return "112px";
      if (/日期|时间|账期|date|time/i.test(key)) return "122px";
      if (/缺口|阻塞|原因|影响|内容|说明|策略|边界|gap|reason|impact|content|policy|boundary/i.test(key)) return "184px";
      if (/下一步|动作|建议|检查|next|action|recommend/i.test(key)) return "190px";
      if (/检查点|商品|客户|标题|名称|name|title|customer|product/i.test(key)) return "154px";
      return "128px";
    }
    function renderRuntimeSummarySurface(surface, props) {
      const route = props.route || surface.data?.route || {};
      const taskRetrieval = props.task_retrieval || surface.data?.task_retrieval || {};
      const card = materialCard("本轮执行摘要", "Debug 信息，仅用于确认路由和执行链路。");
      const grid = document.createElement("div");
      grid.className = "material-metrics";
      grid.append(
        materialMetric(route.intent_code || "unknown", "Intent"),
        materialMetric(route.execution_class || "-", "执行类型"),
        materialMetric(route.handler_type || "-", "Handler"),
        materialMetric(route.confidence || "-", "置信度")
      );
      card.appendChild(grid);
      const reason = route.reason || route.source || route.router_source;
      if (reason) {
        const note = document.createElement("div");
        note.className = "material-subtle";
        note.textContent = "路由依据：" + String(reason);
        card.appendChild(note);
      }
      const top = Array.isArray(taskRetrieval.top) ? taskRetrieval.top : [];
      if (top.length) {
        const list = document.createElement("div");
        list.className = "material-list";
        top.slice(0, 3).forEach((task) => {
          const item = document.createElement("div");
          item.className = "material-list-item";
          item.textContent = [task.id, task.status, task.relevance != null ? "relevance=" + task.relevance : ""].filter(Boolean).join(" · ");
          list.appendChild(item);
        });
        card.appendChild(list);
      }
      return card;
    }

    function sortOpenUIRows(rows, columns) {
      const statusColumn = columns.find((column) => column.type === "status" || /risk|warning|level|status/i.test(column.key || ""));
      if (!statusColumn) return rows;
      const rank = { critical: 0, high: 1, 紧急: 1, 预警: 1, medium: 2, 关注: 2, low: 3, 正常: 4, done: 5, 完成: 5 };
      return rows.slice().sort((a, b) => {
        const av = String(a?.[statusColumn.key] ?? "");
        const bv = String(b?.[statusColumn.key] ?? "");
        return (rank[av] ?? 9) - (rank[bv] ?? 9);
      });
    }

    function renderOpenUITableCell(value, column) {
      if (column.type === "status" || /risk|warning|level|status/i.test(column.key || "")) {
        const chip = materialChip(clean(formatTableCell(value)));
        const color = openUIStatusColor(value);
        if (color) { chip.style.color = color; chip.style.borderColor = color + "44"; }
        return chip;
      }
      const span = document.createElement("span");
      span.className = "cell-text";
      span.textContent = clean(formatOpenUIValue(value, column.type));
      if (span.textContent === "-") span.classList.add("cell-muted");
      return span;
    }

    function formatOpenUIValue(value, type) {
      if (type === "currency") return formatMoney(value);
      if (type === "number" && typeof value === "number") return value.toLocaleString("zh-CN");
      if (type === "date" && value) return String(value).slice(0, 19).replace("T", " ");
      return formatTableCell(value);
    }

    function openUIStatusColor(value) {
      const text = String(value || "").toLowerCase();
      if (/critical|high|紧急|预警|异常|逾期|失败|拒绝/.test(text)) return "#c0392b";
      if (/medium|关注|处理中|待|pending|current/.test(text)) return "#d68910";
      if (/low|正常|完成|已|done|success/.test(text)) return "#27ae60";
      return "";
    }

    function renderGroupedListSurface(_surface, props) {
      const groups = Array.isArray(props.groups) ? props.groups : [];
      if (!groups.length) return null;
      const card = materialCard(props.title || "分组列表", props.groupKey ? ("按 " + clean(props.groupKey) + " 分组") : (groups.length + " 组"));
      const list = document.createElement("div");
      list.className = "material-list";
      groups.slice(0, 8).forEach((group) => {
        const item = document.createElement("div");
        item.className = "material-item";
        const row = document.createElement("div");
        row.className = "material-row";
        row.appendChild(materialChip(clean(group.label || "未分组")));
        row.appendChild(materialChip(String(group.count ?? 0) + " 项"));
        const detail = document.createElement("div");
        detail.className = "material-subtle";
        const items = Array.isArray(group.items) ? group.items : [];
        detail.textContent = items.slice(0, 6).map((value) => clean(value)).filter(Boolean).join("；");
        item.append(row, detail);
        list.appendChild(item);
      });
      card.appendChild(list);
      return card;
    }

    /**
     * ToolCatalogSurface —— 工具目录卡片
     * props: { title?, tools: [{name, description, risk_level?, category?}] }
     */
    function renderToolCatalogSurface(_surface, props) {
      const tools = Array.isArray(props.tools) ? props.tools : [];
      if (!tools.length) return null;
      const card = materialCard(props.title || "可用工具", "已过滤当前用户权限");
      const list = document.createElement("div");
      list.className = "material-list";
      tools.slice(0, 20).forEach((tool) => {
        const item = document.createElement("div");
        item.className = "material-item";
        const title = document.createElement("div");
        title.className = "material-item-title";
        title.textContent = clean(tool.name || "-");
        const row = document.createElement("div");
        row.className = "material-row";
        if (tool.category) row.appendChild(materialChip(clean(tool.category)));
        if (tool.risk_level) {
          const riskChip = materialChip(clean(tool.risk_level));
          // 高风险用红色文字（内联 style 最轻量）
          if (/high|危|拒|reject/i.test(tool.risk_level)) riskChip.style.color = "#c0392b";
          row.appendChild(riskChip);
        }
        const desc = document.createElement("div");
        desc.className = "material-subtle";
        desc.textContent = clean(tool.description || "");
        item.append(title, row);
        if (tool.description) item.appendChild(desc);
        list.appendChild(item);
      });
      card.appendChild(list);
      return card;
    }

    /**
     * RiskListSurface —— 风险列表卡片
     * props: { title?, risks: [{id, level, message, tool?, mitigated?}] }
     */
    function renderRiskListSurface(_surface, props) {
      const risks = Array.isArray(props.risks) ? props.risks : [];
      if (!risks.length) return null;
      const unmitigated = risks.filter((r) => !r.mitigated);
      const card = materialCard(props.title || "风险提示", unmitigated.length ? unmitigated.length + " 项待处理" : "全部已处置");
      const list = document.createElement("div");
      list.className = "material-list";
      risks.slice(0, 12).forEach((risk) => {
        const item = document.createElement("div");
        item.className = "material-item";
        const row = document.createElement("div");
        row.className = "material-row";
        const levelChip = materialChip(clean(risk.level || "unknown"));
        const RISK_COLORS = { high: "#c0392b", critical: "#c0392b", medium: "#d68910", low: "#27ae60" };
        const color = RISK_COLORS[String(risk.level || "").toLowerCase()];
        if (color) { levelChip.style.color = color; levelChip.style.borderColor = color + "44"; }
        row.appendChild(levelChip);
        if (risk.tool) row.appendChild(materialChip(clean(risk.tool)));
        if (risk.mitigated) row.appendChild(materialChip("已处置"));
        const msg = document.createElement("div");
        msg.className = "material-subtle";
        msg.textContent = clean(risk.message || risk.id || "");
        item.append(row, msg);
        list.appendChild(item);
      });
      card.appendChild(list);
      return card;
    }

    /**
     * MetricCardsSurface —— 指标卡片组
     * props: { title?, metrics: [{label, value, unit?, trend?, delta?}] }
     */
    function renderMetricCardsSurface(_surface, props) {
      const metrics = Array.isArray(props.metrics) ? props.metrics : [];
      if (!metrics.length) return null;
      const card = materialCard(props.title || "关键指标", "");
      const grid = document.createElement("div");
      grid.className = "material-metrics";
      // MetricCards 支持最多 6 格
      metrics.slice(0, 6).forEach((m) => {
        const node = materialMetric(
          (m.value !== undefined && m.value !== null ? String(m.value) : "-") + (m.unit ? m.unit : ""),
          clean(m.label || "-")
        );
        // 趋势/变化量附在 label 下方
        if (m.delta !== undefined || m.trend) {
          const trend = document.createElement("span");
          trend.className = "material-chip";
          trend.style.marginTop = "4px";
          const sign = Number(m.delta) > 0 ? "+" : "";
          trend.textContent = m.trend ? clean(m.trend) : sign + String(m.delta);
          trend.style.color = Number(m.delta) >= 0 ? "#27ae60" : "#c0392b";
          node.appendChild(trend);
        }
        grid.appendChild(node);
      });
      card.appendChild(grid);
      return card;
    }

    function renderTagListSurface(_surface, props) {
      const tags = Array.isArray(props.tags) ? props.tags : [];
      if (!tags.length) return null;
      const card = materialCard(props.title || "业务标签", tags.length + " 个标签");
      card.appendChild(materialTagCloud(tags));
      return card;
    }

    function materialTagCloud(tags) {
      const cloud = document.createElement("div");
      cloud.className = "material-tag-cloud";
      tags.slice(0, 32).forEach((tag) => {
        const node = document.createElement("span");
        node.className = "material-tag " + tagToneClass(tag.tone || tag.value || tag.label);
        const label = document.createElement("span");
        label.textContent = clean(tag.label || "-");
        node.appendChild(label);
        if (tag.value !== undefined && tag.value !== null && String(tag.value) !== "") {
          const value = document.createElement("strong");
          value.textContent = clean(tag.value);
          node.appendChild(value);
        }
        cloud.appendChild(node);
      });
      return cloud;
    }

    function tagToneClass(value) {
      const text = String(value || "").toLowerCase();
      if (/danger|error|high|critical|blocked|风险|阻塞|高|失败|逾期|不足/.test(text)) return "danger";
      if (/warn|medium|pending|review|处理中|待|关注|中|复核|审批/.test(text)) return "warn";
      if (/good|success|done|ready|healthy|完成|已|正常|就绪|健康/.test(text)) return "good";
      if (/info|demo|mock|估算|样本|草稿|参考/.test(text)) return "info";
      return "";
    }

    /**
     * BarChartSurface —— 最小柱状图
     * props: { title?, xKey, yKey, series: object[] }
     */
    function renderBarChartSurface(_surface, props) {
      const series = Array.isArray(props.series) ? props.series : [];
      if (!series.length) return null;
      const xKey = String(props.xKey || "label");
      const yKey = String(props.yKey || "value");
      const values = series.map((item) => Number(item?.[yKey])).filter(Number.isFinite);
      const max = Math.max(...values, 1);
      const card = materialCard(props.title || "分布图", "");
      const chart = document.createElement("div");
      chart.className = "material-bar-chart";
      chart.setAttribute("data-chart", "bar");
      chart.setAttribute("data-x-key", xKey);
      chart.setAttribute("data-y-key", yKey);
      series.slice(0, 12).forEach((item) => {
        const value = Number(item?.[yKey]);
        const width = Number.isFinite(value) ? Math.max(2, Math.round(value / max * 100)) : 2;
        const row = document.createElement("div");
        row.className = "material-bar-row";
        const label = document.createElement("span");
        label.textContent = clean(item?.[xKey] ?? item?.key ?? "未分组");
        const track = document.createElement("div");
        track.className = "material-bar-track";
        const bar = document.createElement("i");
        bar.style.width = width + "%";
        track.appendChild(bar);
        const number = document.createElement("strong");
        number.textContent = formatChartNumber(value);
        row.append(label, track, number);
        chart.appendChild(row);
      });
      card.appendChild(chart);
      return card;
    }

    function renderPieChartSurface(_surface, props) {
      const series = Array.isArray(props.series) ? props.series : [];
      if (!series.length) return null;
      const categoryKey = String(props.categoryKey || props.xKey || "label");
      const valueKey = String(props.valueKey || props.yKey || "value");
      const colors = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#64748b"];
      const values = series.map((item) => Math.max(0, Number(item?.[valueKey]) || 0));
      const total = values.reduce((sum, value) => sum + value, 0) || 1;
      let cursor = 0;
      const segments = values.map((value, index) => {
        const start = cursor;
        const end = cursor + value / total * 360;
        cursor = end;
        return colors[index % colors.length] + " " + start.toFixed(2) + "deg " + end.toFixed(2) + "deg";
      });
      const card = materialCard(props.title || "构成分析", "");
      const layout = document.createElement("div");
      layout.className = "material-pie-layout";
      const pie = document.createElement("div");
      pie.className = "material-pie-chart";
      pie.setAttribute("data-chart", "pie");
      pie.style.background = "conic-gradient(" + segments.join(", ") + ")";
      const legend = document.createElement("div");
      legend.className = "material-legend";
      series.slice(0, 12).forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "material-legend-item";
        const dot = document.createElement("span");
        dot.className = "material-legend-dot";
        dot.style.background = colors[index % colors.length];
        const label = document.createElement("span");
        label.textContent = clean(item?.[categoryKey] ?? item?.label ?? "未分组");
        const number = document.createElement("strong");
        number.textContent = formatChartNumber(values[index] || 0);
        row.append(dot, label, number);
        legend.appendChild(row);
      });
      layout.append(pie, legend);
      card.appendChild(layout);
      return card;
    }

    function renderLineChartSurface(_surface, props) {
      const series = Array.isArray(props.series) ? props.series : [];
      if (!series.length) return null;
      const xKey = String(props.xKey || "date");
      const yKey = String(props.yKey || "value");
      const values = series.map((item) => Number(item?.[yKey])).filter(Number.isFinite);
      const min = Math.min(...values, 0);
      const max = Math.max(...values, 1);
      const width = 640, height = 180, pad = 18;
      const points = series.map((item, index) => {
        const raw = Number(item?.[yKey]);
        const value = Number.isFinite(raw) ? raw : min;
        const x = pad + (series.length <= 1 ? 0 : index / (series.length - 1) * (width - pad * 2));
        const y = height - pad - ((value - min) / Math.max(1, max - min)) * (height - pad * 2);
        return { x, y, value, label: String(item?.[xKey] ?? index + 1) };
      });
      const card = materialCard(props.title || "趋势分析", series.length + " 个时间点");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "material-line-chart");
      svg.setAttribute("data-chart", "line");
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);
      const axis = document.createElementNS("http://www.w3.org/2000/svg", "path");
      axis.setAttribute("class", "material-line-axis");
      axis.setAttribute("d", "M" + pad + " " + (height - pad) + "H" + (width - pad));
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("class", "material-line-path");
      path.setAttribute("d", points.map((point, index) => (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1)).join(" "));
      svg.append(axis, path);
      points.forEach((point) => {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("class", "material-line-point");
        circle.setAttribute("cx", point.x.toFixed(1));
        circle.setAttribute("cy", point.y.toFixed(1));
        circle.setAttribute("r", "3.5");
        svg.appendChild(circle);
      });
      card.appendChild(svg);
      return card;
    }

    function renderInsightSummarySurface(_surface, props) {
      const insights = Array.isArray(props.insights) ? props.insights : [];
      if (!insights.length) return null;
      const flow = buildInsightFlow(insights);
      if (flow) return flow;
      const card = materialCard(props.title || "分析结论", insights.length + " 条发现");
      const list = document.createElement("div");
      list.className = "material-list";
      insights.slice(0, 10).forEach((insight) => {
        const item = document.createElement("div");
        item.className = "material-item";
        const title = document.createElement("div");
        title.className = "material-item-title";
        title.textContent = clean(insight.title || insight.summary || "分析发现");
        if (insight.severity) title.appendChild(materialChip(clean(insight.severity)));
        const detail = document.createElement("div");
        detail.className = "material-subtle";
        detail.textContent = clean(insight.summary || "");
        item.appendChild(title);
        if (detail.textContent) item.appendChild(detail);
        if (insight.recommendation) {
          const rec = document.createElement("div");
          rec.className = "material-action";
          rec.textContent = "建议：" + clean(insight.recommendation);
          item.appendChild(rec);
        }
        list.appendChild(item);
      });
      card.appendChild(list);
      return card;
    }

    function buildInsightFlow(insights) {
      const steps = insights
        .map((insight, index) => ({ insight, index }))
        .filter(({ insight }) => String(insight?.title || "").trim().startsWith("下一步"));
      if (steps.length < 2) return null;
      const status = insights.find((insight) => /总体状态|状态|结论/i.test(String(insight?.title || "")));
      const boundary = insights.find((insight) => /数据边界|边界/i.test(String(insight?.title || "")));
      const card = materialCard("流程推进图", steps.length + " 个后续动作");
      const flow = document.createElement("div");
      flow.className = "material-flow";
      const track = document.createElement("div");
      track.className = "material-flow-track";
      const addFlowNode = (node) => {
        if (track.childElementCount) {
          const arrow = document.createElement("div");
          arrow.className = "material-flow-arrow";
          arrow.textContent = "→";
          track.appendChild(arrow);
        }
        track.appendChild(node);
      };
      if (status) {
        addFlowNode(materialFlowNode({
          title: clean(status.title || "当前状态"),
          detail: clean(status.summary || ""),
          status: clean(status.summary || status.title || "当前"),
          tone: /阻塞|风险|失败|异常/i.test(String(status.summary || "")) ? "blocked" : "current"
        }));
      }
      steps.slice(0, 6).forEach(({ insight }, index) => {
        addFlowNode(materialFlowNode({
          title: clean(insight.title || ("下一步 " + (index + 1))),
          detail: clean(insight.summary || insight.recommendation || ""),
          status: index === 0 ? "优先" : "待推进",
          tone: index === 0 ? "current" : ""
        }));
      });
      flow.appendChild(track);
      if (boundary?.summary) {
        const note = document.createElement("div");
        note.className = "material-subtle";
        note.textContent = "数据边界：" + clean(boundary.summary);
        flow.appendChild(note);
      }
      card.appendChild(flow);
      return card;
    }

    function materialFlowNode({ title, detail, status, tone }) {
      const node = document.createElement("div");
      node.className = "material-flow-node" + (tone ? " " + tone : "");
      const head = document.createElement("div");
      head.className = "material-flow-title";
      head.textContent = title || "步骤";
      const chip = document.createElement("span");
      chip.className = "material-flow-status";
      chip.textContent = status || "待推进";
      if (/阻塞|风险|失败|异常/.test(chip.textContent)) {
        chip.style.color = "#c0392b";
        chip.style.borderColor = "#c0392b44";
      } else if (/优先|当前|处理中/.test(chip.textContent)) {
        chip.style.color = "#d68910";
        chip.style.borderColor = "#d6891044";
      } else if (/完成|已/.test(chip.textContent)) {
        chip.style.color = "#27ae60";
        chip.style.borderColor = "#27ae6044";
      }
      const body = document.createElement("div");
      body.className = "material-flow-detail";
      body.textContent = detail || "-";
      node.append(head, chip, body);
      return node;
    }

    function renderAnalyticsDashboardSurface(surface, props) {
      const card = materialCard(props.title || "数据分析看板", "");
      card.classList.add("material-dashboard");
      const metrics = Array.isArray(props.metrics) ? props.metrics : [];
      const charts = Array.isArray(props.charts) ? props.charts : [];
      const rows = Array.isArray(props.rows) ? props.rows : [];
      const insights = Array.isArray(props.insights) ? props.insights : [];
      if (metrics.length) {
        const metricsNode = renderMetricCardsSurface(surface, { title: "关键指标", metrics });
        if (metricsNode) card.appendChild(metricsNode);
      }
      if (Array.isArray(props.tags) && props.tags.length) {
        const tagNode = renderTagListSurface(surface, { title: "业务标签", tags: props.tags });
        if (tagNode) card.appendChild(tagNode);
      }
      if (charts.length) {
        const grid = document.createElement("div");
        grid.className = "material-dashboard-grid";
        charts.slice(0, 4).forEach((chart) => {
          const kind = String(chart.kind || "").toLowerCase();
          const node = /pie|donut|doughnut/.test(kind)
            ? renderPieChartSurface(surface, chart)
            : /line|trend|timeseries|time_series/.test(kind)
              ? renderLineChartSurface(surface, chart)
              : renderBarChartSurface(surface, chart);
          if (node) grid.appendChild(node);
        });
        if (grid.childElementCount) card.appendChild(grid);
      }
      if (insights.length) {
        const insightNode = renderInsightSummarySurface(surface, { title: "分析结论", insights });
        if (insightNode) card.appendChild(insightNode);
      }
      if (rows.length) {
        const tableNode = renderDataTableSurface(surface, {
          title: "数据明细",
          columns: Array.isArray(props.columns) ? props.columns : inferColumnsForRows(rows),
          rows,
          rowCount: rows.length
        });
        if (tableNode) card.appendChild(tableNode);
      }
      return card;
    }

    /**
     * EvidenceSurface —— 证据/引用片段列表
     * props: { title?, items: [{title, source, quote, score?}] }
     */
    function renderEvidenceSurface(_surface, props) {
      const items = Array.isArray(props.items) ? props.items : [];
      if (!items.length) return null;
      // 复用 renderSourceDisclosure，注入 items
      const sources = items.map((item) => ({
        title: item.title,
        source: item.source,
        quote: item.quote,
        score: typeof item.score === "number" ? item.score : undefined
      }));
      const card = materialCard(props.title || "参考依据", sources.length + " 条证据");
      const disclosure = renderSourceDisclosure(sources);
      if (disclosure) card.appendChild(disclosure);
      return card;
    }

    /**
     * TaskTrackingSurface —— 任务追踪看板
     * props: { title?, tasks: [{id, subject, status, priority?, owner?, due_date?, progress?}] }
     */
    function renderTaskTrackingSurface(surface, props) {
      const tasks = Array.isArray(props.tasks) ? props.tasks : [];
      if (!tasks.length) return null;
      const done = tasks.filter((t) => /done|completed|closed|已完成/.test(String(t.status || ""))).length;
      const card = materialCard(props.title || "任务跟踪", done + "/" + tasks.length + " 已完成");
      // 总进度条
      const progress = document.createElement("div");
      progress.className = "material-progress";
      const bar = document.createElement("span");
      bar.style.width = (tasks.length ? Math.round(done / tasks.length * 100) : 0) + "%";
      progress.appendChild(bar);
      card.appendChild(progress);
      const list = document.createElement("div");
      list.className = "material-list";
      tasks.slice(0, 10).forEach((task) => {
        const item = document.createElement("div");
        item.className = "material-item";
        const title = document.createElement("div");
        title.className = "material-item-title";
        title.textContent = clean(task.subject || task.id || "未命名任务");
        const row = document.createElement("div");
        row.className = "material-row";
        const statusLabel = String(task.status || "unknown");
        const statusChip = materialChip(clean(statusLabel));
        if (/done|completed|已完成/i.test(statusLabel)) statusChip.style.color = "#27ae60";
        else if (/blocked|阻塞/i.test(statusLabel)) statusChip.style.color = "#c0392b";
        row.appendChild(statusChip);
        if (task.priority) row.appendChild(materialChip(clean(task.priority)));
        if (task.owner) row.appendChild(materialChip("负责人：" + clean(task.owner)));
        if (task.due_date) row.appendChild(materialChip("截止：" + clean(task.due_date)));
        item.append(title, row);
        // 单任务进度条
        if (typeof task.progress === "number") {
          const tp = document.createElement("div");
          tp.className = "material-progress";
          const tb = document.createElement("span");
          tb.style.width = Math.max(0, Math.min(100, task.progress)) + "%";
          tp.appendChild(tb);
          item.appendChild(tp);
        }
        // TaskTracking 支持继续/忽略动作按钮（可选）
        if (task.id && (task.resumable || task.allow_resume)) {
          const actionRow = document.createElement("div");
          actionRow.className = "material-actions";
          const ctx = { task_id: task.id, task_list_id: task.task_list_id || "" };
          actionRow.append(
            materialActionButton("继续", "task.resume.select", ctx, surface),
            materialActionButton("忽略", "task.resume.ignore", ctx, surface, true)
          );
          item.appendChild(actionRow);
        }
        list.appendChild(item);
      });
      card.appendChild(list);
      return card;
    }
    /**
     * PendingActionSurface —— 待确认执行动作面板（Plan Mode / Ask 权限层入口）
     * props: {
     *   title?,
     *   description?,
     *   actions: [{
     *     id, tool, args_summary?, risk_level?, reason?, expires_at?,
     *     allow_confirm?, allow_reject?, allow_modify?
     *   }]
     * }
     *
     * 对标 Claude Code 的 ask/deny 权限层：中高风险操作不直接执行，
     * 先展示在此面板，等待用户点击"确认执行"或"拒绝"。
     * 点击后通过 dispatchOpenUILangAction 发到 /api/openui/action（runtime.pending_action.*）。
     */
    function renderPendingActionSurface(surface, props) {
      const actions = Array.isArray(props.actions) ? props.actions : [];
      if (!actions.length) return null;
      const pendingCount = actions.filter((a) => !a.resolved).length;
      const card = materialCard(
        props.title || "待确认操作",
        pendingCount ? pendingCount + " 项等待确认" : "全部已处理"
      );
      // 可选：面板描述文字（解释为何需要确认）
      if (props.description) {
        const desc = document.createElement("div");
        desc.className = "material-subtle";
        desc.style.lineHeight = "1.6";
        desc.textContent = clean(String(props.description));
        card.appendChild(desc);
      }
      const list = document.createElement("div");
      list.className = "material-list";
      actions.slice(0, 10).forEach((action) => {
        const resolved = !!action.resolved;
        const item = document.createElement("div");
        item.className = "material-item";
        if (resolved) item.style.opacity = "0.55";
        // 工具名称行
        const title = document.createElement("div");
        title.className = "material-item-title";
        title.textContent = clean(action.tool || "未知操作");
        // 元信息 chip 行：risk_level + expires_at + action.id
        const row = document.createElement("div");
        row.className = "material-row";
        if (action.risk_level) {
          const riskChip = materialChip(clean(action.risk_level));
          const RISK_COLORS = { high: "#c0392b", critical: "#c0392b", medium: "#d68910", low: "#27ae60" };
          const color = RISK_COLORS[String(action.risk_level).toLowerCase()];
          if (color) { riskChip.style.color = color; riskChip.style.borderColor = color + "44"; }
          row.appendChild(riskChip);
        }
        if (action.expires_at) row.appendChild(materialChip("过期：" + clean(String(action.expires_at))));
        if (action.id) row.appendChild(materialChip("ID：" + clean(String(action.id))));
        item.append(title, row);
        // 参数摘要（可选）
        if (action.args_summary) {
          const argSummary = document.createElement("div");
          argSummary.className = "material-subtle";
          argSummary.style.fontFamily = "ui-monospace, Menlo, Consolas, monospace";
          argSummary.style.fontSize = "12px";
          argSummary.textContent = clean(String(action.args_summary).slice(0, 200));
          item.appendChild(argSummary);
        }
        // 原因说明
        if (action.reason) {
          const reasonEl = document.createElement("div");
          reasonEl.className = "material-action";
          reasonEl.textContent = "需要确认：" + clean(String(action.reason));
          item.appendChild(reasonEl);
        }
        // 操作按钮（已处理则不再显示）
        if (!resolved) {
          const actionRow = document.createElement("div");
          actionRow.className = "material-actions";
          const actionId = String(action.id || "");
          const canConfirm = action.allow_confirm !== false;
          const canReject = action.allow_reject !== false;
          if (canConfirm) {
            actionRow.appendChild(
              materialActionButton("确认执行", "runtime.pending_action.confirm", { pending_action_id: actionId }, surface)
            );
          }
          if (action.allow_modify) {
            actionRow.appendChild(
              materialActionButton("修改参数", "runtime.pending_action.modify", { pending_action_id: actionId }, surface, true)
            );
          }
          if (canReject) {
            actionRow.appendChild(
              materialActionButton("拒绝", "runtime.pending_action.reject", { pending_action_id: actionId }, surface, true)
            );
          }
          item.appendChild(actionRow);
        } else {
          // 已处理状态标记
          const resolvedBadge = document.createElement("div");
          resolvedBadge.className = "material-chip";
          resolvedBadge.style.color = "#27ae60";
          resolvedBadge.textContent = action.resolved_status === "rejected" ? "已拒绝" : "已确认";
          item.appendChild(resolvedBadge);
        }
        list.appendChild(item);
      });
      card.appendChild(list);
      // 底部提示：Plan Mode 状态
      if (props.plan_mode) {
        const hint = document.createElement("div");
        hint.className = "material-subtle";
        hint.style.marginTop = "4px";
        hint.style.fontSize = "12px";
        hint.textContent = "当前处于 Plan Mode，写操作和外部副作用需要手动确认后执行。";
        card.appendChild(hint);
      }
      return card;
    }

    function renderMaterialExpenseEstimate(_surface, props) {
      const card = materialCard("报销金额测算", props.status === "exceeded" ? "存在超标金额，需要补充说明或审批。" : "按当前制度标准测算。");
      const metrics = document.createElement("div");
      metrics.className = "material-metrics";
      metrics.append(
        materialMetric(formatMoney(props.claimed_amount), "申报金额"),
        materialMetric(formatMoney(props.eligible_amount), "预计可报"),
        materialMetric(formatMoney(props.exceeded_amount), "超标金额")
      );
      const basis = document.createElement("div");
      basis.className = "material-action";
      basis.textContent = "规则依据：" + clean(props.policy_basis || "按当前制度标准测算");
      card.append(metrics, basis);
      return card;
    }
    function renderMaterialApproval(surface, props, actions) {
      const pending = Array.isArray(props.pending_actions) ? props.pending_actions : [];
      if (!pending.length) return null;
      const card = materialCard("审批确认流程", "确认后会执行动作并返回结果。");
      const timeline = renderMaterialTimeline(props.steps || []);
      if (timeline) card.appendChild(timeline);
      const list = document.createElement("div");
      list.className = "material-list";
      pending.forEach((action) => {
        const item = document.createElement("div");
        item.className = "material-item";
        const title = document.createElement("div");
        title.className = "material-item-title";
        title.textContent = clean(action.tool || "待确认操作");
        const meta = document.createElement("div");
        meta.className = "material-subtle";
        meta.textContent = clean([action.id, action.risk_level, action.expires_at].filter(Boolean).join(" · "));
        const actionRow = document.createElement("div");
        actionRow.className = "material-actions";
        const id = action.id || "";
        actionRow.append(
          materialActionButton("确认执行", "runtime.pending_action.confirm", { pending_action_id: id }, surface),
          materialActionButton("拒绝", "runtime.pending_action.reject", { pending_action_id: id }, surface, true)
        );
        item.append(title, meta, actionRow);
        list.appendChild(item);
      });
      card.appendChild(list);
      return card;
    }
    function renderMaterialTaskResume(surface, props) {
      const tasks = Array.isArray(props.tasks) ? props.tasks : [];
      if (!tasks.length) return null;
      const card = materialCard(tasks.length > 1 ? "你想继续哪个任务？" : "继续这个任务？", "从当前消息召回相关长程任务。");
      const list = document.createElement("div");
      list.className = "material-list";
      tasks.forEach((task) => {
        const item = document.createElement("div");
        item.className = "material-item";
        const title = document.createElement("div");
        title.className = "material-item-title";
        title.textContent = clean(task.subject || task.active_form || task.id || "未命名任务");
        const meta = document.createElement("div");
        meta.className = "material-subtle";
        meta.textContent = clean([task.status, task.next_action ? "下一步：" + task.next_action : "", task.reason].filter(Boolean).join(" · "));
        const actions = document.createElement("div");
        actions.className = "material-actions";
        const context = { task_id: task.id || "", task_list_id: task.task_list_id || "" };
        actions.append(
          materialActionButton("继续这个", "task.resume.select", context, surface),
          materialActionButton("先不继续", "task.resume.ignore", context, surface, true)
        );
        item.append(title, meta, actions);
        list.appendChild(item);
      });
      card.appendChild(list);
      return card;
    }
    function materialCard(titleText, subtitleText) {
      const card = document.createElement("div");
      card.className = "material-card";
      const head = document.createElement("div");
      head.className = "material-head";
      const title = document.createElement("div");
      title.className = "material-title";
      title.textContent = titleText;
      const sub = document.createElement("div");
      sub.className = "material-subtle";
      sub.textContent = subtitleText;
      head.append(title);
      card.append(head, sub);
      return card;
    }
    function materialMetric(value, label) {
      const node = document.createElement("div");
      node.className = "material-metric";
      const strong = document.createElement("strong");
      strong.textContent = String(value ?? "-");
      const span = document.createElement("span");
      span.className = "material-subtle";
      span.textContent = label;
      node.append(strong, span);
      return node;
    }
    function materialChip(text) {
      const node = document.createElement("span");
      node.className = "material-chip";
      node.textContent = text;
      return node;
    }
    function renderMaterialTimeline(steps) {
      if (!Array.isArray(steps) || !steps.length) return null;
      const node = document.createElement("div");
      node.className = "material-timeline";
      steps.forEach((step) => {
        const item = document.createElement("div");
        item.className = "material-step " + clean(step.status || "pending");
        const dot = document.createElement("span");
        dot.className = "material-step-dot";
        const label = document.createElement("span");
        label.textContent = clean(step.label || step.key || "-");
        item.append(dot, label);
        node.appendChild(item);
      });
      return node;
    }
    function formatMoney(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return "-";
      return Math.round(n).toLocaleString("zh-CN") + " 元";
    }
    function materialActionButton(label, name, context, surface, secondary = false) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "openui-button a2ui-button" + (secondary ? " secondary" : "");
      button.textContent = label;
      button.addEventListener("click", () => dispatchOpenUILangAction({ event: { name, context } }, surface, button));
      return button;
    }
    function renderSourceDisclosure(sources) {
      const cleanSources = (sources || []).filter(Boolean);
      if (!cleanSources.length) return null;
      const details = document.createElement("details");
      details.className = "source-disclosure";
      const summary = document.createElement("summary");
      const caret = document.createElement("span");
      caret.className = "source-caret";
      const label = document.createElement("span");
      label.textContent = "引用来源 · " + cleanSources.length;
      summary.append(caret, label);
      const panel = document.createElement("div");
      panel.className = "source-panel";
      cleanSources.slice(0, 8).forEach((source) => {
        const item = document.createElement("div");
        item.className = "source-item";
        const title = document.createElement("div");
        title.className = "source-item-title";
        title.textContent = clean([source.title, source.heading].filter(Boolean).join(" / ") || "来源");
        item.appendChild(title);
        const metaParts = [];
        if (source.source) metaParts.push(source.source);
        if (typeof source.score === "number") metaParts.push("相关度 " + source.score.toFixed(2));
        if (metaParts.length) {
          const meta = document.createElement("div");
          meta.className = "source-item-meta";
          meta.textContent = clean(metaParts.join(" · "));
          item.appendChild(meta);
        }
        if (source.quote) {
          const quote = document.createElement("div");
          quote.className = "source-item-quote";
          quote.textContent = clean(String(source.quote).slice(0, 220));
          item.appendChild(quote);
        }
        panel.appendChild(item);
      });
      details.append(summary, panel);
      return details;
    }
    async function dispatchOpenUILangAction(action, surface, button) {
      const event = action?.event;
      if (!event?.name || loading) return;
      button.disabled = true;
      const original = button.textContent;
      button.textContent = "处理中";
      try {
        const response = await fetch("/api/openui/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: currentUserId,
            session_id: activeSessionId,
            action: {
              name: event.name,
              surface_id: surface.id,
              context: event.context || {}
            },
            metadata: {
              openuiClientDataModel: { surfaces: { [surface.id]: surface.data || {} } },
              a2uiClientDataModel: { surfaces: { [surface.id]: surface.data || {} } }
            }
          })
        });
        const payload = await response.json();
        button.textContent = payload.ok ? "已处理" : "失败";
        if (!payload.ok) button.disabled = false;
      } catch {
        button.textContent = original || "重试";
        button.disabled = false;
      }
    }
    var dispatchA2UIAction = dispatchOpenUILangAction;
    function finalizeProcessOnAnswerStart(id) {
      const msg = getMsg(id);
      if (!msg || msg.processFinalized) return;
      const timer = stepTimers.get(id);
      if (timer) window.clearTimeout(timer);
      stepTimers.delete(id);
      stepQueues.delete(id);
      msg.completedAt = Date.now();
      msg.streaming = false;
      msg.thinking = false;
      msg.bizCollapsed = true;
      msg.processFinalized = true;
      msg.answerStartedAt = msg.answerStartedAt || Date.now();
      msg.answerStreaming = true;
      touchActiveSession();
    }
    function clearStepPlayback(id) {
      const timer = stepTimers.get(id);
      if (timer) window.clearTimeout(timer);
      stepTimers.delete(id);
      stepQueues.delete(id);
      pendingDoneEvents.delete(id);
    }
    function applyAgenticEvent(id, ev) {
      const msg = getMsg(id);
      if (!msg || !ev) return;
      if (msg.processFinalized) return;
      msg.bizPairs = msg.bizPairs || [];
      msg.bizPairsByItemId = msg.bizPairsByItemId || Object.create(null);
      // 优先消费强类型 agentic_item 事件：按 itemId 合并 start/end，避免同一次工具
      // 调用渲染成两张卡片。旧的 agentic_tool 事件保留作 fallback。
      if (ev.kind === "agentic_item" && ev.kind === "agentic_item" && ev.stream === "tool" && ev.itemId) {
        applyToolItemEvent(msg, ev);
        return;
      }
      if (ev.kind === "agentic_tool" && ev.type === "tool_call") {
        // 后端已携带 item_id 的 tool_call，对应的 item start/end 已经处理过了，跳过避免重复。
        if (ev.item_id && msg.bizPairsByItemId[ev.item_id]) return;
        const pair = toolEventToBizPair(ev);
        if (pair) msg.bizPairs.push(pair);
      } else if (ev.kind === "agentic_lifecycle") {
        if (ev.event === "fallback" || ev.event === "total_timeout" || ev.event === "step_failed" || ev.event === "unknown_action") {
          msg.failed = true;
          msg.failedReason = ev.reason || ev.error || ev.event;
        }
      }
    }
    // 单个 item 的 end 丢包保护时长：60s。超过则标记为失败而不是永久 spinner。
    const ITEM_WATCHDOG_MS = 60000;
    function applyToolItemEvent(msg, ev) {
      const itemId = ev.itemId;
      const existing = msg.bizPairsByItemId[itemId];
      if (ev.phase === "start") {
        if (existing) return; // 重复 start，忽略
        // 用 args/tool 名构造一张"运行中"卡片，先占位，等 end 再覆盖
        const pair = toolItemToBizPair(ev) || { icon: "loader", summary: "\u8c03\u7528\u5de5\u5177\u4e2d", narrative: "" };
        pair.itemId = itemId;
        pair.status = "running";
        pair.watchdogTimer = window.setTimeout(function() {
          if (pair.status === "running") {
            pair.status = "failed";
            pair.errorMessage = "\u54cd\u5e94\u8d85\u65f6\uff08\u672a\u6536\u5230 end \u4e8b\u4ef6\uff09";
            render();
          }
        }, ITEM_WATCHDOG_MS);
        msg.bizPairs.push(pair);
        msg.bizPairsByItemId[itemId] = pair;
        return;
      }
      if (ev.phase === "end") {
        // end 阶段：清掉 watchdog；合并到已有 pair；如果没有 start 过（理论上不应该），就 push 一张
        if (existing && existing.watchdogTimer) {
          window.clearTimeout(existing.watchdogTimer);
          existing.watchdogTimer = null;
        }
        const updated = toolItemToBizPair(ev) || existing || { icon: "circle", summary: "", narrative: "" };
        if (existing) {
          existing.icon = updated.icon || existing.icon;
          existing.summary = updated.summary || existing.summary;
          existing.narrative = updated.narrative || existing.narrative;
          existing.status = ev.status || "completed";
          if (ev.error) existing.errorMessage = ev.error.message || ev.error.code;
        } else {
          updated.itemId = itemId;
          updated.status = ev.status || "completed";
          if (ev.error) updated.errorMessage = ev.error.message || ev.error.code;
          msg.bizPairs.push(updated);
          msg.bizPairsByItemId[itemId] = updated;
        }
      }
    }
    /**
     * 当 SSE 流结束/中断时，把所有还在 running 的 item 强制收尾。
     * 防御场景：后端 emit end 之前进程崩溃 / 网络断开 / SSE 提前 close。
     * 没有这层兜底，UI 会卡在 spinner 永不结束。
     */
    function finalizeRunningItems(msg, reason) {
      if (!msg || !msg.bizPairs) return;
      for (const pair of msg.bizPairs) {
        if (pair.status !== "running") continue;
        if (pair.watchdogTimer) {
          window.clearTimeout(pair.watchdogTimer);
          pair.watchdogTimer = null;
        }
        pair.status = "failed";
        pair.errorMessage = reason || "\u8fde\u63a5\u4e2d\u65ad\uff0c\u672a\u6536\u5230\u5b8c\u6574\u54cd\u5e94";
      }
    }
    // 把 agentic_item 翻译成业务 bizPair（与 toolEventToBizPair 等价但读 item 字段）
    function toolItemToBizPair(ev) {
      const tool = ev.title || "";
      const meta = ev.meta || {};
      // 复用旧的字典：构造一个伪 ev 给 toolEventToBizPair
      return toolEventToBizPair({
        tool: tool,
        observation_summary: ev.error
          ? { ok: false, message: ev.error.message }
          : (ev.phase === "end" ? { ok: ev.status !== "failed" } : null),
        args: meta.args
      });
    }
    // 把 agentic-handler 的 tool_call 事件翻译成业务视角的 {icon, summary, narrative}
    // 不改 manifest，先在前端做映射；后续 A 阶段再下放到 manifest.display
    function toolEventToBizPair(ev) {
      const tool = ev.tool || "";
      const obs = ev.observation_summary || {};
      if (tool.startsWith("intent.")) {
        const code = tool.slice("intent.".length);
        const rows = obs.row_count ?? 0;
        const isAggregate = /aggregate|stats|metrics|breakdown|compare|distribution/i.test(code);
        return {
          icon: isAggregate ? "bar-chart-3" : "database",
          summary: isAggregate ? "\u67e5\u4e86 " + rows + " \u4e2a\u5206\u7ec4\u6307\u6807" : "\u67e5\u4e86 " + rows + " \u6761\u8bb0\u5f55",
          narrative: obs.ok === false ? "\u8c03\u7528 " + code + " \u672a\u8fd4\u56de\u7ed3\u679c\u3002" : ""
        };
      }
      if (tool === "tool.safe_compute") {
        return {
          icon: "calculator",
          summary: "\u8fdb\u884c\u4e86\u7cbe\u786e\u8ba1\u7b97",
          narrative: ""
        };
      }
      if (tool.startsWith("tool.")) {
        return {
          icon: "wrench",
          summary: readableToolSummary(tool),
          narrative: ""
        };
      }
      if (tool.startsWith("skill.")) {
        return {
          icon: "file-text",
          summary: "\u4f7f\u7528\u4e86\u76f8\u5173\u6280\u80fd",
          narrative: ""
        };
      }
      return null;
    }
    function readableToolSummary(tool) {
      const name = tool.slice("tool.".length);
      const coreMap = {
        safe_compute: "\u8fdb\u884c\u4e86\u7cbe\u786e\u8ba1\u7b97",
        retrieve_knowledge: "\u67e5\u9605\u4e86\u77e5\u8bc6\u5e93",
        query_business_data: "\u67e5\u8be2\u4e86\u4e1a\u52a1\u6570\u636e",
        list_my_customers: "\u67e5\u8be2\u4e86\u5ba2\u6237\u5217\u8868",
        query_customer: "\u67e5\u8be2\u4e86\u5ba2\u6237\u4fe1\u606f",
        query_order: "\u67e5\u8be2\u4e86\u8ba2\u5355\u4fe1\u606f",
        query_sales_report: "\u67e5\u8be2\u4e86\u9500\u552e\u62a5\u8868"
      };
      // 域注册的工具标签（从 registry 动态注入）
      const domainMap = {"query_business_data":"业务数据查询","list_my_customers":"客户列表查询","query_customer":"客户详情查询","query_order":"订单查询","query_sales_report":"销售报表查询","retrieve_knowledge":"知识库检索","safe_compute":"安全计算","submit_leave_request":"提交请假","estimate_agent_plan_rounds":"Agent Plan 轮数估算","estimate_seedance_video_seconds":"Seedance 视频秒数估算","cloud_product_model_draft":"云商品配置草稿","cloud_ipd_readiness_review":"云商品 IPD 就绪评审","cloud_gtm_package_draft":"云商品 GTM 包草稿","cloud_capacity_risk_review":"云商品容量风险评审","cloud_gmv_target_briefing":"云商品 GMV 目标简报","cloud_ops_incident_business_impact":"云商品运维事件经营影响","cloud_ops_degradation_plan":"云商品降级与通知方案","cloud_agent_plan_overage_policy":"Agent Plan 超额付费说明","cloud_retrospective_template":"云商品复盘模板","cloud_executive_briefing":"云商品经营简报","cloud_solution_recommendation":"云商品方案推荐","cloud_self_service_quote":"云商品自助询价","cloud_release_risk_review":"云商品发布风险审查","create_cloud_release_draft":"创建云商品发布草稿","create_cloud_approval_summary":"生成云商品审批摘要","simulate_cloud_closed_loop":"模拟云商品闭环","dealer.query_sales_orders":"销售订单查询","dealer.query_leads":"线索查询","dealer.query_vehicles":"库存查询","dealer.query_finance":"财务查询","dealer.query_repair_orders":"售后工单查询"};
      return coreMap[name] || domainMap[name] || "\u4f7f\u7528\u4e86\u76f8\u5173\u80fd\u529b";
    }
    function appendText(id, text) {
      const msg = getMsg(id);
      if (msg) {
        if (text) finalizeProcessOnAnswerStart(id);
        msg.text = (msg.text || "") + normalize(text);
      }
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
        .replace(/\b[a-z]+_[a-z0-9_]+\b/gi, "")
        .replace(/[<>]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }
    function formatTableCell(value) {
      if (value === null || value === undefined || value === "") return "-";
      if (Array.isArray(value)) return value.map((item) => clean(formatTableCell(item))).join("、").slice(0, 120);
      if (typeof value === "object") return JSON.stringify(value).slice(0, 120);
      return String(value);
    }
    function formatChartNumber(value) {
      if (!Number.isFinite(value)) return "-";
      return Math.abs(value) >= 1000 ? Math.round(value).toLocaleString("zh-CN") : String(value);
    }
    const CLIENT_FIELD_LABELS = {
      owner_user_id: "负责人",
      owner_team: "负责团队",
      metric_id: "指标ID",
      metric_group: "指标分组",
      metric_name: "指标名称",
      metric_value: "指标值",
      period: "周期",
      as_of_date: "统计日期",
      unit: "单位",
      compare_period: "对比周期",
      compare_value: "对比值",
      change_rate: "变化率",
      source_type: "来源类型",
      mocked: "Demo假设",
      confidence: "置信度",
      billing_month: "账期",
      amount_cny: "金额",
      dispute_amount_cny: "争议金额",
      dispute_reason: "争议原因",
      step: "流程环节",
      delay_hours: "延迟小时",
      blocker_reason: "阻塞原因",
      renewal_probability: "续约概率",
      risk_level: "风险等级"
    };
    function inferColumnsForRows(rows) {
      const keys = [];
      (Array.isArray(rows) ? rows : []).slice(0, 10).forEach((row) => {
        Object.keys(row || {}).forEach((key) => {
          if (!keys.includes(key) && !/^(id|uuid|raw|payload|metadata|debug)$/i.test(key)) keys.push(key);
        });
      });
      return keys.slice(0, 8).map((key) => ({
        key,
        label: CLIENT_FIELD_LABELS[key] || key.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
        type: /(count|amount|total|rate|score|num|price|revenue)/i.test(key) ? "number" : /(status|risk|level|warning)/i.test(key) ? "status" : "text"
      }));
    }
    function cleanThinking(text) {
      return String(text || "")
        .replace(/<\/?think>/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
    function normalize(text) { return String(text || "").replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r"); }
    function dedupeByText(items) {
      const seen = new Set();
      return items.filter((item) => {
        if (!item.text || seen.has(item.text)) return false;
        seen.add(item.text);
        return true;
      });
    }
    function dedupeBizPairs(items) {
      const seen = new Set();
      return items.filter((item) => {
        const key = [item.summary, item.narrative].join("|");
        if (!key.trim() || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    function prettyJson(value) {
      if (typeof value === "string") return value;
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    function renderStreamingMarkdown(text) {
      const source = normalize(String(text || "")).replace(/\r\n/g, "\n");
      if (!source.trim()) return "";
      const blocks = splitMarkdownBlocks(source);
      const html = [];
      for (const block of blocks) {
        if (!block.text.trim()) continue;
        if (isMarkdownTableBlock(block.text)) {
          html.push(block.open
            ? '<pre class="md-stream-table">' + escapeHtml(block.text.trim()) + "</pre>"
            : renderMarkdownTable(block.text, { animate: true }));
        } else if (block.open) {
          html.push(renderActiveMarkdownBlock(block.text));
        } else {
          html.push(renderMarkdown(block.text));
        }
      }
      return html.join("");
    }
    function splitMarkdownBlocks(text) {
      const lines = String(text || "").split("\n");
      const fence = String.fromCharCode(96).repeat(3);
      const blocks = [];
      let current = [];
      let inFence = false;
      for (const line of lines) {
        if (line.trim().startsWith(fence)) inFence = !inFence;
        if (!inFence && !line.trim()) {
          if (current.length) {
            blocks.push({ text: current.join("\n"), open: false });
            current = [];
          }
          continue;
        }
        current.push(line);
      }
      if (current.length) {
        blocks.push({ text: current.join("\n"), open: !text.endsWith("\n\n") && !text.endsWith("\n\r\n") });
      }
      return blocks;
    }
    function isMarkdownTableBlock(block) {
      const rows = String(block || "").split("\n").map((line) => line.trim()).filter(Boolean);
      return rows.some((line) => /^\|.*\|$/.test(line)) || rows.some((line) => /^:?-{3,}:?(\s*\|\s*:?-{3,}:?)+$/.test(line));
    }
    function renderActiveMarkdownBlock(block) {
      const text = String(block || "");
      const fence = String.fromCharCode(96).repeat(3);
      if (/^#{1,6}\s+/.test(text.trim())) return renderMarkdown(text);
      if (/^([-*]\s+|\d+[.)]\s+)/m.test(text)) return renderMarkdown(text);
      if (/^>\s?/m.test(text)) return renderMarkdown(text);
      if (text.trim().startsWith(fence)) return "<pre><code>" + escapeHtml(text.replace(new RegExp("^" + fence + "\\w*\\n?"), "")) + "</code></pre>";
      return "<p>" + text.split("\n").map((line) => renderInline(line.trim())).join("<br>") + "</p>";
    }
    function renderMarkdown(text, { streaming = false } = {}) {
      const tick = String.fromCharCode(96);
      const fence = tick.repeat(3);
      const source = normalize(String(text || "")).replace(/\r\n/g, "\n").trim();
      if (!source) return "";
      const lines = source.split("\n");
      const html = [];
      let paragraph = [];
      let list = null;
      let quote = [];
      let table = [];
      let delimitedTable = [];
      let code = null;

      const flushParagraph = () => {
        if (!paragraph.length) return;
        html.push("<p>" + paragraph.map((line) => renderInline(line)).join("<br>") + "</p>");
        paragraph = [];
      };
      const flushList = () => {
        if (!list) return;
        html.push("<" + list.type + ">" + list.items.map((item) => "<li>" + renderInline(item) + "</li>").join("") + "</" + list.type + ">");
        list = null;
      };
      const flushQuote = () => {
        if (!quote.length) return;
        html.push("<blockquote>" + quote.map((line) => "<p>" + renderInline(line) + "</p>").join("") + "</blockquote>");
        quote = [];
      };
      const flushTable = () => {
        if (streaming) {
          html.push(renderMarkdownTable(table.join("\n"), { animate: true }));
          table = [];
          return;
        }
        if (table.length < 2 || !isMarkdownTableDivider(table[1])) {
          paragraph.push(...table);
          table = [];
          return;
        }
        html.push(renderMarkdownTable(table.join("\n"), { animate: true }));
        table = [];
      };
      const flushDelimitedTable = () => {
        if (!delimitedTable.length) return;
        if (delimitedTable.length < 2) {
          paragraph.push(...delimitedTable);
        } else {
          html.push(renderDelimitedTable(delimitedTable.join("\n"), { animate: true }));
        }
        delimitedTable = [];
      };
      const flushBlocks = () => {
        flushTable();
        flushDelimitedTable();
        flushParagraph();
        flushList();
        flushQuote();
      };

      for (const line of lines) {
        const trimmed = line.trim();
        if (code) {
          if (trimmed.startsWith(fence)) {
            html.push("<pre><code>" + escapeHtml(code.lines.join("\n")) + "</code></pre>");
            code = null;
          } else {
            code.lines.push(line);
          }
          continue;
        }
        if (trimmed.startsWith(fence)) {
          flushBlocks();
          code = { lines: [] };
          continue;
        }
        if (!trimmed) {
          flushBlocks();
          continue;
        }
        if (looksLikeDelimitedTableLine(line)) {
          flushParagraph();
          flushList();
          flushQuote();
          flushTable();
          delimitedTable.push(line.trim());
          continue;
        }
        if (delimitedTable.length) flushDelimitedTable();
        if (/^\|.+\|$/.test(trimmed)) {
          flushParagraph();
          flushList();
          flushQuote();
          table.push(trimmed);
          continue;
        }
        if (table.length) flushTable();
        const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
        if (heading) {
          flushBlocks();
          const level = heading[1].length;
          html.push("<h" + level + ">" + renderInline(heading[2]) + "</h" + level + ">");
          continue;
        }
        if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
          flushBlocks();
          html.push("<hr>");
          continue;
        }
        if (/^>\s?/.test(trimmed)) {
          flushParagraph();
          flushList();
          quote.push(trimmed.replace(/^>\s?/, ""));
          continue;
        }
        const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
        const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
        if (bullet || ordered) {
          flushParagraph();
          flushQuote();
          const type = bullet ? "ul" : "ol";
          if (!list || list.type !== type) flushList();
          if (!list) list = { type, items: [] };
          list.items.push(bullet ? bullet[1] : ordered[1]);
          continue;
        }
        flushList();
        flushQuote();
        paragraph.push(trimmed);
      }
      if (code) html.push("<pre><code>" + escapeHtml(code.lines.join("\n")) + "</code></pre>");
      flushBlocks();
      return html.join("");
    }
    function splitMarkdownTableRow(row) {
      return row.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    }
    function isMarkdownTableDivider(row) {
      return splitMarkdownTableRow(row).every((cell) => /^:?-{3,}:?$/.test(cell));
    }
    function looksLikeDelimitedTableLine(line) {
      const cells = String(line || "").split("\t").map((cell) => cell.trim()).filter(Boolean);
      if (cells.length < 2) return false;
      if (cells.length === 2 && cells.some((cell) => cell.length > 80)) return false;
      return cells.length >= 3 || /^[\u4e00-\u9fa5A-Za-z0-9（）()%/ ._-]+$/.test(cells[0]);
    }
    function renderDelimitedTable(text, { animate = false } = {}) {
      const rows = String(text || "").split("\n")
        .map((line) => line.split("\t").map((cell) => cell.trim()))
        .filter((row) => row.length >= 2);
      if (rows.length < 2) return "<p>" + rows.map((row) => row.map(renderInline).join(" ")).join("<br>") + "</p>";
      const header = rows[0];
      const bodyRows = rows.slice(1).filter((row) => row.some(Boolean));
      return (
        '<div class="md-table-wrap' + (animate ? " table-enter" : "") + '"><table><thead><tr>' +
        header.map((cell) => "<th>" + renderInline(cell) + "</th>").join("") +
        "</tr></thead><tbody>" +
        bodyRows.map((row) => "<tr>" + header.map((_, index) => "<td>" + renderInline(row[index] || "") + "</td>").join("") + "</tr>").join("") +
        "</tbody></table></div>"
      );
    }
    function renderMarkdownTable(text, { animate = false } = {}) {
      const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
      const dividerIndex = lines.findIndex((line) => isMarkdownTableDivider(line));
      if (dividerIndex < 1) {
        return '<pre class="md-stream-table">' + escapeHtml(lines.join("\n")) + "</pre>";
      }
      const header = splitMarkdownTableRow(lines[dividerIndex - 1]);
      const rows = lines.slice(dividerIndex + 1)
        .filter((line) => /^\|.*\|$/.test(line))
        .map(splitMarkdownTableRow);
      const visibleRows = rows.length ? rows : [header.map(() => "")];
      return (
        '<div class="md-table-wrap' + (animate ? " table-enter" : "") + '"><table><thead><tr>' +
        header.map((cell) => "<th>" + renderInline(cell) + "</th>").join("") +
        "</tr></thead><tbody>" +
        visibleRows.map((row) => "<tr>" + header.map((_, index) => "<td>" + renderInline(row[index] || "") + "</td>").join("") + "</tr>").join("") +
        "</tbody></table></div>"
      );
    }
    function renderInline(text) {
      const tick = String.fromCharCode(96);
      const placeholders = [];
      const escaped = escapeHtml(text || "").replace(new RegExp(tick + "([^" + tick + "]+)" + tick, "g"), (_, code) => {
        placeholders.push("<code>" + code + "</code>");
        return " MD_CODE_" + (placeholders.length - 1) + " ";
      });
      return escaped
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/__(.+?)__/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
        .replace(/ MD_CODE_(\d+) /g, (_, index) => placeholders[Number(index)] || "");
    }
    function formatDuration(ms) {
      const value = Number(ms);
      if (!Number.isFinite(value) || value <= 0) return "";
      if (value < 1000) return value + "ms";
      return (value / 1000).toFixed(value > 10000 ? 0 : 1) + "s";
    }
    function getDisplayLatency(msg, live) {
      if (live) return Math.max(0, Date.now() - (msg.startedAt || Date.now()));
      if (msg.startedAt && msg.completedAt) return Math.max(0, msg.completedAt - msg.startedAt);
      const backendLatency = Number(msg.backendLatency);
      if (Number.isFinite(backendLatency) && backendLatency > 0) return backendLatency;
      return 0;
    }
    function formatBizSeconds(ms) {
      const value = Number(ms);
      if (!Number.isFinite(value) || value <= 0) return "0.1";
      const seconds = value / 1000;
      return Math.max(0.1, seconds).toFixed(1);
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
  