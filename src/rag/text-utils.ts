const STOPWORDS = new Set([
  "的",
  "了",
  "和",
  "是",
  "我",
  "你",
  "他",
  "她",
  "它",
  "一下",
  "帮我",
  "请",
  "查询",
  "查看",
  "什么",
  "怎么",
  "是否",
  "可以"
]);

export function tokenize(text: unknown): string[] {
  const source = String(text ?? "").toLowerCase();
  const latin = source.match(/[a-z0-9_]+/g) ?? [];
  const chinese = Array.from(source.matchAll(/[\u4e00-\u9fa5]{2,}/g)).flatMap((match) => {
    const segment = match[0];
    const tokens = [segment];
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= segment.length - size; index += 1) {
        tokens.push(segment.slice(index, index + size));
      }
    }
    return tokens;
  });

  return [...latin, ...chinese].filter((token) => !STOPWORDS.has(token));
}

export function cosineSimilarity(leftTokens: string[], rightTokens: string[]): number {
  const left = toCounts(leftTokens);
  const right = toCounts(rightTokens);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [token, value] of left) {
    dot += value * (right.get(token) ?? 0);
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function keywordOverlap(queryTokens: string[], docTokens: string[]): number {
  const docSet = new Set(docTokens);
  const uniqueQuery = [...new Set(queryTokens)];
  if (uniqueQuery.length === 0) return 0;
  const hits = uniqueQuery.filter((token) => docSet.has(token)).length;
  return hits / uniqueQuery.length;
}

function toCounts(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}
