import type { JsonObject } from "../types/agent-contracts.js";
import { OpenUILangSurfaceManager } from "./core.js";
import type { SurfaceBuildOutput } from "./plugin-types.js";
import { OPENUI_LANG_BASIC_CATALOG, OPENUI_LANG_PROTOCOL, OPENUI_LANG_VIEW_PROTOCOL, type OpenUILangCompatComponent, type OpenUILangCompatEnvelope, type OpenUILangDocument, type OpenUILangNode, type OpenUILangSurface, type OpenUILangWireEvent } from "./types.js";

const LEGACY_COMPAT_VERSION = "v0.9";
const LEGACY_COMPAT_BASIC_CATALOG_ID = "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json";

export function surfaceOutputToOpenUILang(output: SurfaceBuildOutput): OpenUILangSurface {
  const view = readOpenUIView(output.data);
  return {
    protocol: OPENUI_LANG_PROTOCOL,
    id: output.surfaceId,
    root: output.root,
    catalog: OPENUI_LANG_BASIC_CATALOG,
    data: output.data,
    nodes: output.components.map(legacyComponentToOpenUILangNode),
    view: view ? {
      protocol: OPENUI_LANG_PROTOCOL,
      component: view.component,
      props: view.props,
      actions: view.actions
    } : undefined
  };
}

export function openUILangSurfaceToLegacyEnvelopes(surface: OpenUILangSurface): OpenUILangCompatEnvelope[] {
  const data = surface.view
    ? {
        ...(surface.data ?? {}),
        openui: {
          protocol: OPENUI_LANG_VIEW_PROTOCOL,
          component: surface.view.component,
          props: surface.view.props ?? {},
          actions: surface.view.actions ?? []
        }
      }
    : surface.data ?? {};
  const components = surface.nodes.map(openUILangNodeToLegacyComponent);
  return [
    {
      version: LEGACY_COMPAT_VERSION,
      createSurface: {
        surfaceId: surface.id,
        catalogId: LEGACY_COMPAT_BASIC_CATALOG_ID,
        root: surface.root,
        sendDataModel: true,
        theme: {
          primaryColor: "#111111",
          agentDisplayName: "LangClaw"
        }
      }
    },
    {
      version: LEGACY_COMPAT_VERSION,
      updateDataModel: {
        surfaceId: surface.id,
        value: data
      }
    },
    {
      version: LEGACY_COMPAT_VERSION,
      updateComponents: {
        surfaceId: surface.id,
        components
      }
    }
  ];
}

export function legacyEnvelopesToOpenUILangDocument(envelopes: readonly OpenUILangCompatEnvelope[]): OpenUILangDocument {
  const manager = new OpenUILangSurfaceManager();
  for (const envelope of envelopes) applyLegacyEnvelope(manager, envelope);
  return {
    protocol: OPENUI_LANG_PROTOCOL,
    version: "1.0",
    surfaces: manager.snapshot().map((snapshot) => {
      const view = readOpenUIView(snapshot.data);
      return {
        protocol: OPENUI_LANG_PROTOCOL,
        id: snapshot.surfaceId,
        root: snapshot.root,
        catalog: OPENUI_LANG_BASIC_CATALOG,
        data: stripLegacyOpenUIView(snapshot.data),
        nodes: snapshot.components.map(legacyComponentToOpenUILangNode),
        view: view ? {
          protocol: OPENUI_LANG_PROTOCOL,
          component: view.component,
          props: view.props,
          actions: view.actions
        } : undefined
      };
    })
  };
}

export function legacyEnvelopeToOpenUILangEvent(envelope: OpenUILangCompatEnvelope): OpenUILangWireEvent | null {
  if (envelope.createSurface) {
    return {
      protocol: OPENUI_LANG_PROTOCOL,
      type: "createSurface",
      surfaceId: envelope.createSurface.surfaceId,
      root: envelope.createSurface.root,
      catalog: OPENUI_LANG_BASIC_CATALOG,
      compatibilityCatalogId: envelope.createSurface.catalogId,
      sendDataModel: envelope.createSurface.sendDataModel,
      theme: envelope.createSurface.theme
    };
  }
  if (envelope.updateDataModel) {
    return {
      protocol: OPENUI_LANG_PROTOCOL,
      type: "updateDataModel",
      surfaceId: envelope.updateDataModel.surfaceId,
      path: envelope.updateDataModel.path,
      value: envelope.updateDataModel.value
    };
  }
  if (envelope.updateComponents) {
    return {
      protocol: OPENUI_LANG_PROTOCOL,
      type: "updateComponents",
      surfaceId: envelope.updateComponents.surfaceId,
      nodes: envelope.updateComponents.components.map(legacyComponentToOpenUILangNode)
    };
  }
  if (envelope.deleteSurface) {
    return {
      protocol: OPENUI_LANG_PROTOCOL,
      type: "deleteSurface",
      surfaceId: envelope.deleteSurface.surfaceId
    };
  }
  return null;
}

export function legacyComponentToOpenUILangNode(component: OpenUILangCompatComponent): OpenUILangNode {
  const [componentName, rawProps] = Object.entries(component.component ?? {})[0] ?? ["Text", {}];
  const props = isJsonObject(rawProps) ? { ...rawProps } : {};
  const rawChildren = Array.isArray(props.children) ? props.children : [];
  delete props.children;
  return {
    id: component.id,
    componentName,
    props,
    children: rawChildren.map((child) => String(child))
  };
}

export function openUILangNodeToLegacyComponent(node: OpenUILangNode): OpenUILangCompatComponent {
  const props: JsonObject = { ...(node.props ?? {}) };
  if (Array.isArray(node.children) && node.children.length) {
    props.children = node.children.map((child) => typeof child === "string" ? child : child.id);
  }
  return {
    id: node.id,
    component: {
      [node.componentName]: props
    }
  };
}

function readOpenUIView(data: JsonObject): { component: string; props?: JsonObject; actions?: JsonObject[] } | null {
  const raw = data.openui;
  if (!isJsonObject(raw)) return null;
  if (raw.protocol !== OPENUI_LANG_VIEW_PROTOCOL || typeof raw.component !== "string") return null;
  return {
    component: raw.component,
    props: isJsonObject(raw.props) ? raw.props : {},
    actions: Array.isArray(raw.actions) ? raw.actions.filter(isJsonObject) : []
  };
}

function applyLegacyEnvelope(manager: OpenUILangSurfaceManager, envelope: OpenUILangCompatEnvelope): void {
  if (envelope.createSurface) {
    manager.create({
      surfaceId: envelope.createSurface.surfaceId,
      root: envelope.createSurface.root,
      catalogId: envelope.createSurface.catalogId
    });
    return;
  }
  if (envelope.updateDataModel) {
    manager.updateDataModel(envelope.updateDataModel.surfaceId, envelope.updateDataModel.path, envelope.updateDataModel.value);
    return;
  }
  if (envelope.updateComponents) {
    manager.updateComponents(envelope.updateComponents.surfaceId, envelope.updateComponents.components);
    return;
  }
  if (envelope.deleteSurface) manager.delete(envelope.deleteSurface.surfaceId);
}

function stripLegacyOpenUIView(data: JsonObject): JsonObject {
  if (!isJsonObject(data.openui)) return data;
  const { openui: _legacyOpenUIView, ...rest } = data;
  return rest as JsonObject;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
