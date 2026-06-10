/**
 * OpenUI Lang browser runtime.
 *
 * The browser still accepts v0.9 compatibility envelopes so persisted
 * conversations keep rendering, but the state, renderer, action dispatch names,
 * and CSS classes below are owned by OpenUI Lang.
 */

export function openUILangBrowserStateRuntimeScript(): string {
  return `
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
  `;
}

export function openUILangBrowserBasicRuntimeScript(): string {
  return `
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
  `;
}

export function openUILangBrowserOpenUIRuntimeScript(): string {
  return `
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
  `;
}
