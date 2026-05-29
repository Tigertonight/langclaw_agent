/**
 * 按 mime + 文件后缀双重判断 parser 类型。
 *
 * 只用 mime 不靠谱：浏览器 / curl 上来的 mime 经常错（zip 报 application/octet-stream），
 * 必须用后缀兜底。
 */
export type ParserKind =
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "zip"
  | "image"
  | "text"
  | "json"
  | "unsupported";

const EXT_MAP: Record<string, ParserKind> = {
  pdf: "pdf",
  doc: "docx",  // 老 .doc 二进制走不通，但先映射；parser 会软失败
  docx: "docx",
  xls: "xlsx",
  xlsx: "xlsx",
  csv: "xlsx",  // 用 xlsx 库统一处理 csv（自动识别）
  ppt: "pptx",
  pptx: "pptx",
  zip: "zip",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  bmp: "image",
  txt: "text",
  md: "text",
  log: "text",
  json: "json"
};

export function detectParserKind(filename: string, mime: string): ParserKind {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const byExt = EXT_MAP[ext];
  if (byExt) return byExt;
  // mime 兜底（少数没扩展名的情况）
  if (mime.startsWith("text/")) return "text";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/json") return "json";
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/zip") return "zip";
  return "unsupported";
}
