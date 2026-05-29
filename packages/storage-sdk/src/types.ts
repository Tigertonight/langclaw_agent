export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * MinIO / OSS 必须 true。AWS S3 默认 false（用 virtual-hosted-style）。
   */
  forcePathStyle?: boolean;
  /**
   * 公网访问 base url，用于生成下载链接（可选）。
   * 若不配置，下载链路只能走预签名 URL。
   */
  publicBaseUrl?: string;
}

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface PutObjectResult {
  key: string;
  size: number;
  etag?: string;
}

export interface PresignedUrlInput {
  key: string;
  /** 过期秒数，默认 3600 */
  expiresIn?: number;
}
