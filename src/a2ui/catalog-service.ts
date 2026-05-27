import { A2UI_BASIC_CATALOG_ID, A2UI_VERSION, OPENUI_BRIDGE_VERSION } from "./types.js";
import type { JsonObject } from "../types/agent-contracts.js";

const BASIC_COMPONENTS = new Set(["Text", "Image", "Icon", "Video", "AudioPlayer", "Row", "Column", "List", "Card", "Tabs", "Button"]);

export class A2UICatalogService {
  capabilities(): JsonObject {
    return {
      version: A2UI_VERSION,
      server_capabilities: {
        supportedCatalogIds: [A2UI_BASIC_CATALOG_ID],
        supportedViewProtocols: [OPENUI_BRIDGE_VERSION],
        supportedOpenUIComponents: ["ApprovalFlow", "TaskResumeCard", "DealerVehicleProgress", "ExpenseEstimate", "LeaveRequestForm", "CitationDisclosure", "RuntimeSummary"],
        acceptsClientDataModel: true,
        actions: ["runtime.pending_action.confirm", "runtime.pending_action.reject", "task.resume.select", "task.resume.ignore"]
      }
    };
  }

  defaultCatalogId(): string {
    return A2UI_BASIC_CATALOG_ID;
  }

  isSupportedComponent(name: string): boolean {
    return BASIC_COMPONENTS.has(name);
  }
}
