/**
 * S3 兼容对象存储 client。同一份代码兼容 MinIO（开发）/ 阿里云 OSS / AWS S3（生产）。
 *
 * 切换 provider 只需改环境变量：
 *   S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
 *
 * MinIO/OSS 必须 forcePathStyle=true（路径式寻址，不依赖 DNS 子域名）。
 */

export { StorageClient } from "./client.js";
export type {
  StorageConfig,
  PutObjectInput,
  PutObjectResult,
  PresignedUrlInput
} from "./types.js";
export { resolveStorageConfig } from "./config.js";
