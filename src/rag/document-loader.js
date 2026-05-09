import { LocalMarkdownDocumentSource } from "./document-sources.js";

export async function loadKnowledgeDocuments() {
  return new LocalMarkdownDocumentSource().loadDocuments();
}

export function chunkDocument(document) {
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

export function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) {
    return { metadata: {}, body: raw };
  }

  const end = raw.indexOf("\n---", 3);
  if (end === -1) {
    return { metadata: {}, body: raw };
  }

  const block = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const metadata = {};
  for (const line of block.split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length > 0) {
      metadata[key.trim()] = rest.join(":").trim();
    }
  }
  return { metadata, body };
}
