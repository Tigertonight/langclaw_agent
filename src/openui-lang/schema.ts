import type { JsonObject } from "../types/agent-contracts.js";
import type { OpenUILangCompatComponent } from "./types.js";

export interface OpenUILangComponentSchema {
  id: string;
  componentName: string;
  props?: JsonObject;
  children?: Array<OpenUILangComponentSchema | string>;
}

const CHILDREN_COMPONENTS = new Set(["Card", "Row", "Column", "List", "Tabs"]);

export function basicComponentToSchema(component: OpenUILangCompatComponent): OpenUILangComponentSchema {
  const [componentName, rawProps] = Object.entries(component.component ?? {})[0] ?? ["Unknown", {}];
  const props = isJsonObject(rawProps) ? { ...rawProps } : {};
  const rawChildren = Array.isArray(props.children) ? props.children : undefined;
  if (rawChildren) delete props.children;
  return {
    id: component.id,
    componentName,
    props,
    ...(rawChildren ? { children: rawChildren.map((child) => String(child)) } : {})
  };
}

export function schemaToBasicComponent(schema: OpenUILangComponentSchema): OpenUILangCompatComponent {
  const props: JsonObject = { ...(schema.props ?? {}) };
  if (schema.children?.length && CHILDREN_COMPONENTS.has(schema.componentName)) {
    props.children = schema.children.map((child) => typeof child === "string" ? child : child.id);
  }
  return {
    id: schema.id,
    component: {
      [schema.componentName]: props
    }
  };
}

export function basicComponentsToSchemas(components: OpenUILangCompatComponent[]): OpenUILangComponentSchema[] {
  return components.map(basicComponentToSchema);
}

export function schemasToBasicComponents(schemas: OpenUILangComponentSchema[]): OpenUILangCompatComponent[] {
  return schemas.map(schemaToBasicComponent);
}

export function getBasicComponentName(component: OpenUILangCompatComponent): string {
  const explicit = (component as { componentName?: unknown }).componentName;
  if (typeof explicit === "string" && explicit) return explicit;
  return Object.keys(component.component ?? {})[0] ?? "";
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
