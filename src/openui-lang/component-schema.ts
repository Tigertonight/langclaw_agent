import type { OpenUILangCompatComponent } from "./types.js";

export function getOpenUILangBasicComponentName(component: OpenUILangCompatComponent): string | null {
  const keys = component?.component && typeof component.component === "object" && !Array.isArray(component.component)
    ? Object.keys(component.component)
    : [];
  return typeof keys[0] === "string" ? keys[0] : null;
}
