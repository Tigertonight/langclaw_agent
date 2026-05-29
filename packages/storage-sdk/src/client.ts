import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  PresignedUrlInput,
  PutObjectInput,
  PutObjectResult,
  StorageConfig
} from "./types.js";

/**
 * 薄封 aws-sdk v3 S3 client，只暴露我们用到的能力：put / get / delete / presign。
 *
 * 不在 client 内部做 retry / 限流，依赖 aws-sdk 默认中间件（3 次指数回退）。
 * 业务层（路由）需要自己处理"上传失败"的用户提示。
 */
export class StorageClient {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string | undefined;

  constructor(private readonly config: StorageConfig) {
    this.s3 = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
    this.bucket = config.bucket;
    this.publicBaseUrl = config.publicBaseUrl;
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const out = await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata
      })
    );
    return {
      key: input.key,
      size: input.body.byteLength,
      etag: out.ETag
    };
  }

  async getObject(key: string): Promise<Buffer> {
    const out = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    if (!out.Body) throw new Error(`storage: empty body for ${key}`);
    const chunks: Buffer[] = [];
    // aws-sdk v3 返回 Web ReadableStream（Node 18+）；用 for-await 兼容
    for await (const chunk of out.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async getPresignedDownloadUrl(input: PresignedUrlInput): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: input.key
    });
    return getSignedUrl(this.s3, cmd, { expiresIn: input.expiresIn ?? 3600 });
  }

  /** 公开 URL（无签名）。需要 bucket 是公共读 + 配 publicBaseUrl 才有效。 */
  publicUrl(key: string): string | null {
    if (!this.publicBaseUrl) return null;
    return `${this.publicBaseUrl.replace(/\/$/, "")}/${key}`;
  }

  async healthCheck(): Promise<void> {
    await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
