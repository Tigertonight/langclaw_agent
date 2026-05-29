/**
 * Attachment 在系统里的统一形态。从前端上传到 LLM context 全程用这个结构。
 *
 * - kind 决定下游怎么处理：text 直接拼 prompt，image 仅展示不入 prompt（本期），
 *   failed 走 system note 告知 LLM"用户上传了 X 但解析失败"
 * - text 是已截断后的内容（见 ATTACHMENTS_MAX_TEXT_CHARS）
 * - storage_key 是 MinIO/OSS 里的 object key，可用来生成下载链接
 */
export type AttachmentKind = "text" | "image" | "failed";

export interface AttachmentContext {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  kind: AttachmentKind;
  /** 解析后的纯文本，已按 max_chars 截断。kind=image/failed 时为空 */
  text: string;
  /** 字符数（截断前的总量），用于前端展示和 audit */
  text_chars_total?: number;
  /** 截断了多少字符（0 表示未截断） */
  text_chars_truncated?: number;
  storage_key: string;
  /** 失败时的原因（kind=failed） */
  failure_reason?: string;
  /** 解析器额外信息（pages/sheets 数等） */
  meta?: Record<string, string | number>;
}

export interface ParseInput {
  filename: string;
  mime_type: string;
  buffer: Buffer;
  /** 单 attachment 文本字符上限，超过截断 */
  max_chars: number;
}

export interface ParseOutcome {
  kind: AttachmentKind;
  text: string;
  text_chars_total: number;
  text_chars_truncated: number;
  failure_reason?: string;
  meta?: Record<string, string | number>;
}
