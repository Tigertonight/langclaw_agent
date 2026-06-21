import type { FieldLabels, ResourceConfig } from "./types.js";
import type { JsonObject } from "../types/agent-contracts.js";

type FieldSchema = NonNullable<ResourceConfig["schema"]>[string];

export interface ResourceFieldMetadata extends JsonObject {
  key: string;
  label: string;
  description: string;
  type?: string;
  enum?: string[];
}

function schemaDescription(schema: FieldSchema | undefined): string {
  if (!schema) return "";
  if (typeof schema === "string") return schema;
  return schema.description ?? "";
}

function schemaType(schema: FieldSchema | undefined): string | undefined {
  if (!schema || typeof schema === "string") return undefined;
  return schema.type;
}

function schemaEnum(schema: FieldSchema | undefined): string[] | undefined {
  if (!schema || typeof schema === "string") return undefined;
  return schema.enum;
}

export function getFieldMetadata(
  config: ResourceConfig,
  fieldLabels: Readonly<FieldLabels> = {},
  fields: string[] = config.fields,
): ResourceFieldMetadata[] {
  return fields.map((field) => {
    const schema = config.schema?.[field];
    const label = fieldLabels[field] ?? field;
    return {
      key: field,
      label,
      description: schemaDescription(schema) || `${label}字段。`,
      ...(schemaType(schema) ? { type: schemaType(schema) } : {}),
      ...(schemaEnum(schema) ? { enum: schemaEnum(schema) } : {}),
    };
  });
}

export function getResourceMetadata(
  resource: string,
  config: ResourceConfig,
  fieldLabels: Readonly<FieldLabels> = {},
  fields: string[] = config.fields,
): JsonObject {
  const fieldMetadata = getFieldMetadata(config, fieldLabels, fields);
  return {
    resource_label: config.label ?? resource,
    resource_description: config.description ?? `${config.label ?? resource}。`,
    field_metadata: fieldMetadata,
    display_field_labels: Object.fromEntries(fieldMetadata.map((field) => [field.key, field.label])),
  };
}
