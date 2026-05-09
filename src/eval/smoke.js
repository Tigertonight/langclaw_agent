import { createApp } from "../app.js";

const { agent } = createApp();

const samples = [
  ["sales_001", "帮我查一下星河科技最近订单状态"],
  ["sales_001", "差旅报销标准是什么？"],
  ["hr_001", "星河科技今年成交额是多少？"]
];

for (const [userId, message] of samples) {
  const result = await agent.run({ userId, message, debug: true });
  console.log(`\n[${userId}] ${message}`);
  console.log(result.answer);
  console.log(JSON.stringify(result.debug, null, 2));
}
