/**
 * Shared DB-row shapes. These mirror the columns of the underlying tables 1:1
 * so SQL → TS conversion stays trivial. Domain-level shapes live in domain/*.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface MemoryRow {
  id: string;
  business_id: string;
  user_id: string;
  agent_id: string | null;
  category: string;
  name: string;
  description: string | null;
  content: string;
  source: string | null;
  confidence: number;
  tags: string[] | null;
  metadata: Record<string, Json>;
  embedding: number[] | null;
  embedding_model: string | null;
  embedded_at: Date | null;
  created_at: Date;
  updated_at: Date;
  expired_at: Date | null;
  deleted_at: Date | null;
}

export type MemoryCategory =
  | "user"
  | "feedback"
  | "project"
  | "reference"
  | "procedure"
  | "fact"
  | "episode";

export const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
  "user",
  "feedback",
  "project",
  "reference",
  "procedure",
  "fact",
  "episode"
];

export interface EntityRow {
  id: string;
  business_id: string;
  type: string;
  name: string;
  aliases: string[] | null;
  external_ids: Record<string, string>;
  attributes: Record<string, Json>;
  embedding: number[] | null;
  embedding_model: string | null;
  embedded_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  merged_into: string | null;
}

export interface RelationRow {
  id: string;
  business_id: string;
  subject_id: string;
  predicate: string;
  object_id: string | null;
  object_value: Json | null;
  occurred_at: Date | null;
  source_memory_id: string | null;
  confidence: number;
  metadata: Record<string, Json>;
  created_at: Date;
  deleted_at: Date | null;
}
