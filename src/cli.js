import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createApp } from "./app.js";

const { agent } = createApp();
const [, , userArg, ...messageParts] = process.argv;

if (userArg && messageParts.length > 0) {
  const result = await agent.run({
    userId: userArg,
    message: messageParts.join(" "),
    sessionId: `${userArg}:cli`,
    debug: true
  });
  printResult(result);
  process.exit(0);
}

const rl = createInterface({ input, output });
const userId = userArg || (await rl.question("user_id: "));
const sessionId = `${userId}:cli`;

output.write("输入问题开始对话，输入 exit 退出。\n");
while (true) {
  const message = await rl.question("> ");
  if (["exit", "quit"].includes(message.trim().toLowerCase())) break;
  const result = await agent.run({ userId, message, sessionId, debug: true });
  printResult(result);
}
rl.close();

function printResult(result) {
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
  output.write("\n");
}
