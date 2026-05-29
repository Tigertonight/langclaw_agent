/**
 * smoke：直接构造各种 buffer 跑解析层，不接 LLM、不接 storage。
 *
 * 跑法：npx tsx src/eval/attachments-parser-smoke.ts
 */
import { parseAttachment } from "../attachments/parser.js";

async function main(): Promise<void> {
  console.log("[1] 纯文本 .txt");
  const r1 = await parseAttachment({
    filename: "hello.txt",
    mime_type: "text/plain",
    buffer: Buffer.from("hello world\n第二行中文"),
    max_chars: 1000
  });
  assertEq(r1.kind, "text");
  assertEq(r1.text.includes("第二行中文"), true);
  console.log("  ✓");

  console.log("[2] JSON");
  const r2 = await parseAttachment({
    filename: "data.json",
    mime_type: "application/json",
    buffer: Buffer.from(JSON.stringify({ a: 1 })),
    max_chars: 100
  });
  assertEq(r2.kind, "text");
  assertEq(r2.text, '{"a":1}');
  console.log("  ✓");

  console.log("[3] 截断行为");
  const big = "x".repeat(2000);
  const r3 = await parseAttachment({
    filename: "big.txt",
    mime_type: "text/plain",
    buffer: Buffer.from(big),
    max_chars: 100
  });
  assertEq(r3.text.length, 100);
  assertEq(r3.text_chars_total, 2000);
  assertEq(r3.text_chars_truncated, 1900);
  console.log("  ✓");

  console.log("[4] image 占位");
  const r4 = await parseAttachment({
    filename: "photo.jpg",
    mime_type: "image/jpeg",
    buffer: Buffer.from([0xff, 0xd8, 0xff]),
    max_chars: 1000
  });
  assertEq(r4.kind, "image");
  assertEq(r4.text, "");
  console.log("  ✓");

  console.log("[5] 不支持的类型走 failed");
  const r5 = await parseAttachment({
    filename: "bin.dat",
    mime_type: "application/x-binary",
    buffer: Buffer.from([0x00, 0x01]),
    max_chars: 1000
  });
  assertEq(r5.kind, "failed");
  console.log("  ✓");

  console.log("[6] 损坏 docx 软失败");
  const r6 = await parseAttachment({
    filename: "broken.docx",
    mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("not a real docx"),
    max_chars: 1000
  });
  assertEq(r6.kind, "failed");
  console.log("  ✓");

  console.log("PASS attachments parser smoke");
}

function assertEq<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
