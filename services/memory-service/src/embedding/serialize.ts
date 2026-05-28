/**
 * pgvector wire format. node-postgres has no native vector type — we cast
 * with `::vector` on insert and stringify on the JS side.
 */
export function vectorToSql(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export function sqlToVector(raw: string | null): number[] | null {
  if (!raw) return null;
  const trimmed = raw.replace(/^\[/, "").replace(/\]$/, "");
  if (!trimmed) return [];
  return trimmed.split(",").map((s) => Number(s));
}
