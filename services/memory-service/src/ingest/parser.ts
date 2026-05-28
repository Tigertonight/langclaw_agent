import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import yaml from "yaml";

interface RawNode {
  type: string;
  value?: string;
  depth?: number;
  children?: RawNode[];
  position?: { start: { offset: number }; end: { offset: number } };
}

export interface ParsedDocument {
  frontmatter: Record<string, unknown>;
  title: string | null;
  body: string;
  chunks: ParsedChunk[];
}

export interface ParsedChunk {
  index: number;
  heading_path: string[];
  content: string;
  char_start: number;
  char_end: number;
}

interface ChunkingOptions {
  /** Hard cap per chunk (chars). Default 1200. */
  maxChars?: number;
  /** Overlap between adjacent windows when a single section exceeds maxChars. Default 150. */
  overlap?: number;
  /** Min chars to count as a chunk; smaller leaf sections get folded into the previous chunk. Default 60. */
  minChars?: number;
}

const DEFAULTS: Required<ChunkingOptions> = {
  maxChars: 1200,
  overlap: 150,
  minChars: 60
};

export function parseMarkdown(raw: string, opts: ChunkingOptions = {}): ParsedDocument {
  const config = { ...DEFAULTS, ...opts };
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .parse(raw) as RawNode;

  const frontmatter = extractFrontmatter(tree);
  const sections = collectSections(tree, raw);
  const title = (typeof frontmatter.title === "string" && frontmatter.title.trim().length > 0)
    ? (frontmatter.title as string)
    : (sections.find((s) => s.depth === 1)?.heading ?? null);

  const chunks = sectionsToChunks(sections, raw, config);
  return { frontmatter, title, body: raw, chunks };
}

function extractFrontmatter(tree: RawNode): Record<string, unknown> {
  const head = tree.children?.[0];
  if (!head || head.type !== "yaml" || typeof head.value !== "string") return {};
  try {
    const parsed = yaml.parse(head.value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

interface SectionSpan {
  depth: number;
  heading: string;
  heading_path: string[];
  body_start: number;
  body_end: number;
}

function collectSections(tree: RawNode, raw: string): SectionSpan[] {
  const headings: { depth: number; text: string; offset: number; end: number }[] = [];
  // Skip leading frontmatter so it doesn't get treated as document prologue.
  const firstChild = tree.children?.[0];
  const bodyStart = firstChild?.type === "yaml" && firstChild.position
    ? firstChild.position.end.offset
    : 0;

  for (const child of tree.children ?? []) {
    if (child.type === "heading" && typeof child.depth === "number" && child.position) {
      headings.push({
        depth: child.depth,
        text: collectText(child),
        offset: child.position.start.offset,
        end: child.position.end.offset
      });
    }
  }

  if (headings.length === 0) {
    return [{
      depth: 0,
      heading: "",
      heading_path: [],
      body_start: bodyStart,
      body_end: raw.length
    }];
  }

  const result: SectionSpan[] = [];
  const stack: { depth: number; text: string }[] = [];

  // pre-heading prologue (after frontmatter, before first heading)
  if (headings[0]!.offset > bodyStart) {
    result.push({
      depth: 0,
      heading: "",
      heading_path: [],
      body_start: bodyStart,
      body_end: headings[0]!.offset
    });
  }

  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i]!;
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= h.depth) stack.pop();
    stack.push({ depth: h.depth, text: h.text });
    const nextOffset = headings[i + 1]?.offset ?? raw.length;
    result.push({
      depth: h.depth,
      heading: h.text,
      heading_path: stack.map((s) => s.text),
      body_start: h.end,
      body_end: nextOffset
    });
  }
  return result;
}

function collectText(node: RawNode): string {
  if (typeof node.value === "string") return node.value;
  if (!node.children) return "";
  return node.children.map(collectText).join("");
}

function sectionsToChunks(sections: SectionSpan[], raw: string, cfg: Required<ChunkingOptions>): ParsedChunk[] {
  const out: ParsedChunk[] = [];
  let cursor = 0;

  for (const section of sections) {
    const body = raw.slice(section.body_start, section.body_end).trim();
    if (body.length === 0) continue;

    if (body.length <= cfg.maxChars) {
      out.push({
        index: cursor,
        heading_path: section.heading_path,
        content: body,
        char_start: section.body_start,
        char_end: section.body_end
      });
      cursor += 1;
      continue;
    }

    // Section longer than max → sliding window with overlap
    let windowStart = section.body_start;
    while (windowStart < section.body_end) {
      const windowEnd = Math.min(windowStart + cfg.maxChars, section.body_end);
      const slice = raw.slice(windowStart, windowEnd).trim();
      if (slice.length >= cfg.minChars) {
        out.push({
          index: cursor,
          heading_path: section.heading_path,
          content: slice,
          char_start: windowStart,
          char_end: windowEnd
        });
        cursor += 1;
      }
      if (windowEnd >= section.body_end) break;
      windowStart = windowEnd - cfg.overlap;
    }
  }

  // Fold trailing tiny chunk into prior
  if (out.length >= 2 && out[out.length - 1]!.content.length < cfg.minChars) {
    const tail = out.pop()!;
    const prev = out[out.length - 1]!;
    prev.content = `${prev.content}\n\n${tail.content}`;
    prev.char_end = tail.char_end;
  }
  return out;
}
