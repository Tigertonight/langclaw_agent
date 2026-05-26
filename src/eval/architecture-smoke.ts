import { createApp } from "../app.js";

const app = createApp();
await app.init();
const { userContextResolver, documentSource, knowledgeBase } = app;

const wecomUser = await userContextResolver.resolve({ wecomUserId: "sales_001" });
assertEqual(wecomUser.source, "wecom_mock", "wecom source");
assertEqual(wecomUser.id, "sales_001", "wecom user id");
assertIncludes(wecomUser.permissions, "order:read", "wecom permissions");

const documents = await documentSource.loadDocuments();
if (documents.length < 1) {
  throw new Error("document source should load at least one document");
}
assertEqual(documents[0].provider, "tencent_docs_mock", "document provider");

const docs = await knowledgeBase.search("差旅报销标准是什么？", wecomUser, { topK: 3 });
if (!docs.some((doc) => doc.metadata.source.includes("expense_policy.md"))) {
  throw new Error("knowledge search should retrieve expense policy");
}

console.log("PASS architecture smoke");

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertIncludes(items: unknown[], expected: unknown, label: string): void {
  if (!items.includes(expected)) {
    throw new Error(`${label}: expected to include ${expected}`);
  }
}
