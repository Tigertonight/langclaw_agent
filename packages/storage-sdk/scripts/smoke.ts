/**
 * storage-sdk smoke：往配置好的 bucket put / get / delete 一份测试对象。
 *
 * 前置：MinIO 已起（docker compose -f docker-compose.attachments.yml up -d）
 *      .env 已配好 S3_*
 *
 * 跑法：cd packages/storage-sdk && npm run smoke
 */
import { resolveStorageConfig, StorageClient } from "../src/index.js";

async function main(): Promise<void> {
  const cfg = resolveStorageConfig();
  const client = new StorageClient(cfg);

  console.log(`[smoke] healthCheck bucket=${cfg.bucket} endpoint=${cfg.endpoint}`);
  await client.healthCheck();
  console.log("  ✓ bucket reachable");

  const key = `_smoke/${Date.now()}-storage-sdk.txt`;
  const body = Buffer.from("hello from storage-sdk smoke");
  const put = await client.putObject({
    key,
    body,
    contentType: "text/plain"
  });
  console.log(`  ✓ put ${put.key} size=${put.size}`);

  const fetched = await client.getObject(key);
  if (fetched.toString("utf8") !== body.toString("utf8")) {
    throw new Error("get returned wrong content");
  }
  console.log("  ✓ get round-trips identical bytes");

  const url = await client.getPresignedDownloadUrl({ key, expiresIn: 60 });
  console.log(`  ✓ presigned url: ${url.slice(0, 80)}...`);

  await client.deleteObject(key);
  console.log(`  ✓ delete ${key}`);

  console.log("PASS storage-sdk smoke");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
