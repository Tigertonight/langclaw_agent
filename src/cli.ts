import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { attachMcpServers, createApp } from "./app.js";

interface CliRunResult {
  answer?: string;
  sources?: Array<{ title?: string; heading?: string; score?: number }>;
  debug?: unknown;
  trace?: unknown;
  context_budget?: unknown;
}

const app = createApp();
await app.init();
const mcp = await attachMcpServers(app.toolRegistry);
const { queryEngine } = app;
const [, , userArg, ...messageParts] = process.argv;

if (userArg && messageParts.length > 0) {
  const result = await queryEngine.submitMessage({
    userId: userArg,
    message: messageParts.join(" "),
    sessionId: `${userArg}:cli`,
    debug: true
  });
  printResult(result as CliRunResult);
  await mcp.registry.stop();
  process.exit(0);
}

const rl = createInterface({ input, output });
const userId = userArg || (await rl.question("user_id: "));
const sessionId = `${userId}:cli`;

output.write("输入问题开始对话，输入 exit 退出。\n");
while (true) {
  const message = await rl.question("> ");
  if (["exit", "quit"].includes(message.trim().toLowerCase())) break;
  const result = await queryEngine.submitMessage({ userId, message, sessionId, debug: true });
  printResult(result as CliRunResult);
}
rl.close();
await mcp.registry.stop();

function printResult(result: CliRunResult): void {
  output.write(`\n${result.answer}\n`);
  if (result.sources?.length) {
    output.write(`\nSources:\n`);
    for (const source of result.sources) {
      output.write(`- ${source.title} / ${source.heading} (${source.score})\n`);
    }
  }
  if (result.debug) {
    output.write(`\nDebug:\n${JSON.stringify(result.debug, null, 2)}\n`);
  }
  if (result.context_budget) {
    output.write(`\nContext budget:\n${JSON.stringify(result.context_budget, null, 2)}\n`);
  }
  if (result.trace) {
    output.write(`\nTrace:\n${JSON.stringify(result.trace, null, 2)}\n`);
  }
  output.write("\n");
}
