import { LocalMarkdownDocumentSource } from "./document-sources.js";

export interface KnowledgeDocument {
  id: string;
  provider: string;
  external_id: string;
  path: string;
  title: string;
  audience: string;
  updated_at: string | null;
  body: string;
}

export interface KnowledgeChunk {
  id: string;
  text: string;
  metadata: {
    title: string;
    heading: string;
    source: string;
    audience: string;
  };
}

export interface FrontmatterResult {
  metadata: Record<string, string>;
  body: string;
}

export async function loadKnowledgeDocuments(): Promise<KnowledgeDocument[]> {
  return new LocalMarkdownDocumentSource().loadDocuments();
}

export function chunkDocument(document: KnowledgeDocument): KnowledgeChunk[] {
  const sections = document.body.split(/\n(?=##\s+)/g);
  return sections
    .map((section, index) => {
      const heading = section.match(/^##\s+(.+)$/m)?.[1] ?? document.title;
      const content = section.replace(/^#{1,6}\s+.+$/gm, "").trim();
      return {
        id: `${document.id}#${index}`,
        text: content,
        metadata: {
          title: document.title,
          heading,
          source: document.path,
          audience: document.audience
        }
      };
    })
    .filter((chunk) => chunk.text.length > 20);
}

export function parseFrontmatter(raw: string): FrontmatterResult {
  if (!raw.startsWith("---")) {
    return { metadata: {}, body: raw };
  }

  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    return { metadata: {}, body: raw };
  }

  const block = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const metadata: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length > 0) {
      metadata[key.trim()] = rest.join(":").trim();
    }
  }
  return { metadata, body };
}
