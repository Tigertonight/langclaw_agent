/**
 * Attachment 解析分发器：按文件类型调对应库，统一输出 ParseOutcome。
 *
 * 设计取舍：
 * - 任何解析异常 / 损坏 / 加密 都软失败为 kind:"failed"，不抛出。这样前端展示
 *   "⚠️ 这个文件解析失败"，但消息发送不被阻塞。
 * - text 输出按 max_chars 截断；记录原始字符数和截断量，UI/audit 用得着。
 * - zip 递归解一层（不递归套娃，防 zip bomb），把内部每个支持的文件解析后拼起来。
 */
import { detectParserKind, type ParserKind } from "./mime.js";
import type { ParseInput, ParseOutcome } from "./types.js";

export async function parseAttachment(input: ParseInput): Promise<ParseOutcome> {
  const kind = detectParserKind(input.filename, input.mime_type);
  try {
    return await dispatch(kind, input);
  } catch (err) {
    return failed(err instanceof Error ? err.message : String(err));
  }
}

async function dispatch(kind: ParserKind, input: ParseInput): Promise<ParseOutcome> {
  switch (kind) {
    case "image":
      // 本期：图片不入 prompt，仅记 meta，前端展示用
      return {
        kind: "image",
        text: "",
        text_chars_total: 0,
        text_chars_truncated: 0,
        meta: { mime: input.mime_type }
      };
    case "text":
    case "json":
      return clipText(input.buffer.toString("utf8"), input.max_chars);
    case "pdf":
      return clipText(await parsePdf(input.buffer), input.max_chars);
    case "docx":
      return clipText(await parseDocx(input.buffer), input.max_chars);
    case "xlsx":
      return clipText(await parseXlsx(input.buffer), input.max_chars);
    case "pptx":
      return clipText(await parsePptx(input.buffer), input.max_chars);
    case "zip":
      return clipText(await parseZip(input.buffer, input.max_chars), input.max_chars);
    case "unsupported":
    default:
      return failed(`unsupported file type for ${input.filename}`);
  }
}

function clipText(text: string, max: number): ParseOutcome {
  const total = text.length;
  if (total <= max) {
    return { kind: "text", text, text_chars_total: total, text_chars_truncated: 0 };
  }
  return {
    kind: "text",
    text: text.slice(0, max),
    text_chars_total: total,
    text_chars_truncated: total - max
  };
}

function failed(reason: string): ParseOutcome {
  return {
    kind: "failed",
    text: "",
    text_chars_total: 0,
    text_chars_truncated: 0,
    failure_reason: reason
  };
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const mod = await import("pdf-parse");
  const fn = (mod as { default?: (b: Buffer) => Promise<{ text: string }> }).default
    ?? (mod as unknown as (b: Buffer) => Promise<{ text: string }>);
  const out = await fn(buffer);
  return out.text ?? "";
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const out = await mammoth.extractRawText({ buffer });
  return out.value ?? "";
}

async function parseXlsx(buffer: Buffer): Promise<string> {
  const xlsx = await import("xlsx");
  const wb = xlsx.read(buffer, { type: "buffer" });
  const blocks: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = xlsx.utils.sheet_to_csv(sheet);
    blocks.push(`# Sheet: ${name}\n${csv}`);
  }
  return blocks.join("\n\n");
}

/**
 * pptx 没有现成轻量库；自己解 zip 取 ppt/slides/slide*.xml，正则扒 <a:t> 文本节点。
 * 不追求完美还原（图片/嵌入对象忽略），只要把"幻灯片里看得见的字"拿出来给 LLM 用就够。
 */
async function parsePptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort();
  const out: string[] = [];
  for (const path of slides) {
    const file = zip.file(path);
    if (!file) continue;
    const xml = await file.async("string");
    // <a:t>text</a:t> 是文本节点；直接正则提取，比挂 xml-parser 轻
    const matches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) ?? [];
    const texts = matches
      .map((m) => m.replace(/<[^>]+>/g, ""))
      .filter((s) => s.trim().length > 0);
    if (texts.length) {
      out.push(`# ${path.replace("ppt/slides/", "").replace(".xml", "")}\n${texts.join("\n")}`);
    }
  }
  return out.join("\n\n");
}

/**
 * zip 解一层：枚举内部文件，对支持的类型递归 parseAttachment（max_chars 共享）。
 * 不递归到 zip 套 zip（避免炸弹）；超过 max_chars 即停止枚举后续文件。
 */
async function parseZip(buffer: Buffer, maxChars: number): Promise<string> {
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const blocks: string[] = [];
  let used = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (used >= maxChars) break;
    const remaining = maxChars - used;
    const content = entry.getData();
    const inner = await parseAttachment({
      filename: entry.entryName,
      mime_type: "application/octet-stream",
      buffer: content,
      max_chars: remaining
    });
    if (inner.kind === "text" && inner.text) {
      const block = `# ${entry.entryName}\n${inner.text}`;
      blocks.push(block);
      used += block.length;
    } else if (inner.kind === "image") {
      blocks.push(`# ${entry.entryName} (image, skipped)`);
    } else if (inner.kind === "failed") {
      blocks.push(`# ${entry.entryName} (parse failed: ${inner.failure_reason ?? "unknown"})`);
    }
  }
  return blocks.join("\n\n");
}
