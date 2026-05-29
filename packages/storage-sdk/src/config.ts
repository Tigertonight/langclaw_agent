import type { StorageConfig } from "./types.js";

/**
 * 从 process.env 读取配置。缺关键字段直接抛错（fail-fast，不静默 fallback）。
 *
 * 必填：S3_ENDPOINT / S3_REGION / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
 * 选填：S3_FORCE_PATH_STYLE（默认 true，兼容 MinIO/OSS） / S3_PUBLIC_BASE_URL
 */
export function resolveStorageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const required = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`storage-sdk: missing env ${name}`);
    return v;
  };
  const forcePathStyle = env.S3_FORCE_PATH_STYLE === "false" ? false : true;
  return {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    forcePathStyle,
    publicBaseUrl: env.S3_PUBLIC_BASE_URL
  };
}
