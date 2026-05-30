/**
 * POST /api/attachments — multipart 文件上传 + 即时解析。
 *
 * 流程：
 *   1. busboy 解 multipart 流；每个 file part 边读边累积 buffer，超过 size limit 直接终止
 *   2. fields 收齐 user_id / business_id / session_id（用于鉴权 + storage key 命名）
 *   3. 全部读完后跑 auth.authenticate（同 /api/chat 一致）
 *   4. 对每个文件：put 到 MinIO → parseAttachment → 入内存 store
 *   5. 返 attachment_id 列表给前端
 *
 * 不持久化、不入 RAG；session 结束 / 30 分钟后自动失效。
 *
 * 限额：单文件 <= ATTACHMENTS_MAX_FILE_SIZE_MB（默认 20）；单次 <= ATTACHMENTS_MAX_FILES_PER_REQUEST（默认 5）。
 * 任何超限直接 400 中止整个请求，已上传到 storage 的对象会留在 bucket（依赖 lifecycle policy 清理；本地 dev 可忽略）。
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import Busboy from "busboy";
import {
  StorageClient,
  resolveStorageConfig
} from "../../packages/storage-sdk/src/index.js";
import { parseAttachment, getAttachmentStore } from "../attachments/index.js";
import type { AttachmentContext } from "../attachments/index.js";

export interface AttachmentRouteDeps {
  storage?: StorageClient;
  authenticate: (req: IncomingMessage, body: Record<string, unknown>) => {
    userId: string;
    tenantId: string;
  };
  /** 可选：钩入 logging / metrics。省略走 console.warn。 */
  log?: (level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>) => void;
}

interface ParsedFile {
  filename: string;
  mime_type: string;
  buffer: Buffer;
}

interface UploadConfig {
  maxFiles: number;
  maxFileSizeBytes: number;
  maxTextChars: number;
  enabled: boolean;
}

function loadUploadConfig(): UploadConfig {
  const env = process.env;
  const explicitlyDisabled = env.ATTACHMENTS_ENABLED === "false";
  // 没配 S3 也视为禁用 — 避免上传报 500，前端能拿到清晰的 503
  const s3Configured = !!(env.S3_ENDPOINT && env.S3_BUCKET);
  return {
    enabled: !explicitlyDisabled && s3Configured,
    maxFiles: parsePositiveInt(env.ATTACHMENTS_MAX_FILES_PER_REQUEST, 5),
    maxFileSizeBytes: parsePositiveInt(env.ATTACHMENTS_MAX_FILE_SIZE_MB, 20) * 1024 * 1024,
    maxTextChars: parsePositiveInt(env.ATTACHMENTS_MAX_TEXT_CHARS, 20000)
  };
}

function parsePositiveInt(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

let storageSingleton: StorageClient | null = null;
function getStorage(): StorageClient {
  if (!storageSingleton) {
    storageSingleton = new StorageClient(resolveStorageConfig());
  }
  return storageSingleton;
}

interface UploadResultItem {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  kind: AttachmentContext["kind"];
  text_chars_total: number;
  text_chars_truncated: number;
  failure_reason?: string;
}

export async function handleAttachmentUpload(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AttachmentRouteDeps
): Promise<void> {
  const config = loadUploadConfig();
  if (!config.enabled) {
    const reason = process.env.ATTACHMENTS_ENABLED === "false"
      ? "ATTACHMENTS_ENABLED=false"
      : "S3_ENDPOINT/S3_BUCKET 未配置（开发期请：docker compose -f docker-compose.attachments.yml up -d）";
    sendJson(res, 503, { error: "attachments_disabled", message: reason });
    return;
  }

  const contentType = req.headers["content-type"] ?? "";
  if (!/multipart\/form-data/i.test(contentType)) {
    sendJson(res, 415, { error: "unsupported_media_type", message: "expected multipart/form-data" });
    return;
  }

  const log = deps.log ?? ((level, event, fields) => {
    if (level === "error") console.warn(`[attachments] ${event}`, fields);
  });

  let busboy: Busboy.Busboy;
  try {
    busboy = Busboy({
      headers: req.headers,
      limits: {
        files: config.maxFiles,
        fileSize: config.maxFileSizeBytes,
        fields: 20,
        fieldSize: 4096
      }
    });
  } catch (err) {
    sendJson(res, 400, {
      error: "bad_request",
      message: err instanceof Error ? err.message : "invalid multipart"
    });
    return;
  }

  const fields = new Map<string, string>();
  const files: ParsedFile[] = [];
  let abortReason: { status: number; error: string; message: string } | null = null;
  let filesExceeded = false;

  await new Promise<void>((resolve) => {
    busboy.on("field", (name, value) => {
      fields.set(name, value);
    });

    busboy.on("file", (_name, stream, info) => {
      if (files.length >= config.maxFiles) {
        // busboy 触发 filesLimit，但此时已经在解析下一个 part；丢弃流
        filesExceeded = true;
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      let received = 0;
      let truncated = false;
      stream.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received <= config.maxFileSizeBytes) chunks.push(chunk);
      });
      stream.on("limit", () => {
        truncated = true;
      });
      stream.on("end", () => {
        if (truncated) {
          abortReason = abortReason ?? {
            status: 413,
            error: "file_too_large",
            message: `${info.filename} exceeds ${config.maxFileSizeBytes / 1024 / 1024}MB`
          };
          return;
        }
        files.push({
          filename: info.filename || "unnamed",
          mime_type: info.mimeType || "application/octet-stream",
          buffer: Buffer.concat(chunks)
        });
      });
      stream.on("error", (err) => {
        abortReason = { status: 400, error: "bad_request", message: err.message };
      });
    });

    busboy.on("filesLimit", () => {
      filesExceeded = true;
    });

    busboy.on("error", (err) => {
      abortReason = abortReason ?? {
        status: 400,
        error: "bad_request",
        message: err instanceof Error ? err.message : String(err)
      };
      resolve();
    });

    busboy.on("close", () => resolve());
    req.pipe(busboy);
  });

  if (abortReason) {
    sendJson(res, abortReason.status, abortReason);
    return;
  }
  if (filesExceeded) {
    sendJson(res, 400, {
      error: "too_many_files",
      message: `max ${config.maxFiles} files per request`
    });
    return;
  }
  if (files.length === 0) {
    sendJson(res, 400, { error: "bad_request", message: "no files in request" });
    return;
  }

  // 鉴权：从 form field 拿 user_id / token，复用主 auth
  let auth: { userId: string; tenantId: string };
  try {
    auth = deps.authenticate(req, Object.fromEntries(fields));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 401;
    sendJson(res, status, {
      error: "unauthorized",
      message: err instanceof Error ? err.message : "auth failed"
    });
    return;
  }

  const sessionId = fields.get("session_id");
  if (!sessionId) {
    sendJson(res, 400, { error: "bad_request", message: "session_id is required" });
    return;
  }
  const businessId = fields.get("business_id") || auth.tenantId;

  const storage = deps.storage ?? getStorage();
  const store = getAttachmentStore();
  const items: UploadResultItem[] = [];

  for (const file of files) {
    const id = randomUUID();
    const safeName = file.filename.replace(/[^A-Za-z0-9._\-一-龥]/g, "_");
    const key = `${businessId}/${auth.userId}/${sessionId}/${id}-${safeName}`;
    try {
      await storage.putObject({
        key,
        body: file.buffer,
        contentType: file.mime_type
      });
    } catch (err) {
      log("error", "storage_put_failed", { key, error: err instanceof Error ? err.message : String(err) });
      // storage 挂了直接 500，不软降级——上传服务不可用必须暴露
      sendJson(res, 502, { error: "storage_unavailable", message: "failed to store attachment" });
      return;
    }

    const parsed = await parseAttachment({
      filename: file.filename,
      mime_type: file.mime_type,
      buffer: file.buffer,
      max_chars: config.maxTextChars
    });

    const ctx: AttachmentContext = {
      id,
      filename: file.filename,
      mime_type: file.mime_type,
      size_bytes: file.buffer.byteLength,
      kind: parsed.kind,
      text: parsed.text,
      text_chars_total: parsed.text_chars_total,
      text_chars_truncated: parsed.text_chars_truncated,
      storage_key: key,
      failure_reason: parsed.failure_reason,
      meta: parsed.meta
    };
    store.put(businessId, auth.userId, sessionId, ctx);

    items.push({
      id,
      filename: file.filename,
      mime_type: file.mime_type,
      size_bytes: file.buffer.byteLength,
      kind: parsed.kind,
      text_chars_total: parsed.text_chars_total,
      text_chars_truncated: parsed.text_chars_truncated,
      failure_reason: parsed.failure_reason
    });
    log("info", "attachment_uploaded", {
      id,
      filename: file.filename,
      kind: parsed.kind,
      session_id: sessionId,
      user_id: auth.userId,
      business_id: businessId
    });
  }

  sendJson(res, 201, { ok: true, attachments: items });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
