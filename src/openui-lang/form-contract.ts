import type { JsonObject } from "../types/agent-contracts.js";

export interface OpenUILangFormField extends JsonObject {
  name: string;
  label: string;
  component: "Input" | "TextArea" | "Select" | "DateTime" | "Hidden";
  required?: boolean;
  options?: Array<{ label: string; value: string }>;
}

export interface OpenUILangFormContract extends JsonObject {
  fields: OpenUILangFormField[];
  initialValues: JsonObject;
  submitAction: {
    name: string;
    label?: string;
    context?: JsonObject;
  };
}

export function createFormContract(input: OpenUILangFormContract): OpenUILangFormContract {
  return {
    fields: input.fields,
    initialValues: input.initialValues,
    submitAction: input.submitAction
  };
}
