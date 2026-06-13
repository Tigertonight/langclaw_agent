import { bg, title, visual, card, cardText, pill, foot, C } from "./helpers.mjs";

export async function slide04(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  await visual(slide, ctx, "04-governance.png", 650, 96, 570, 500);

  title(
    slide,
    ctx,
    "04 / 企业级落地能力",
    "从 Demo 到生产，关键是治理与接入",
    "B 端不是“能回答”就够了，还要身份、权限、审计、私有化、故障恢复，以及企业 IM 和工作流入口。"
  );

  const blocks = [
    ["统一入口", "Web / 企微 / 飞书 / 钉钉 / Webhook / Cron 统一进入 Query Engine", C.blue],
    ["权限门禁", "Tool Governance：权限检查、确认动作、timeout、retry、输出校验", C.teal],
    ["租户隔离", "business_id / tenant namespace，避免跨租户记忆、surface 和工具结果混用", C.amber],
    ["运维闭环", "health / ready / metrics / token 轮换 / 备份恢复 / 离线队列", C.violet],
  ];
  blocks.forEach((b, i) => {
    const y = 190 + i * 88;
    card(slide, ctx, { x: 54, y, w: 540, h: 68, fill: "#FFFFFFE8" });
    cardText(slide, ctx, { x: 54, y, w: 540, h: 68, head: b[0], body: b[1], accent: b[2] });
  });

  card(slide, ctx, { x: 54, y: 558, w: 540, h: 72, fill: C.softAmber, line: "#EECF9A" });
  ctx.addText(slide, {
    text: "客户卖点：企业不需要先把通用 Agent 二次工程化，平台已经把安全、接入、权限和运维边界放进 Runtime。",
    x: 78,
    y: 578,
    w: 486,
    h: 34,
    fontSize: 15.5,
    bold: true,
    color: "#7A4A00",
    typeface: "PingFang SC",
  });
  pill(slide, ctx, "私有化", 752, 610, 92, C.teal, C.softTeal);
  pill(slide, ctx, "多租户", 856, 610, 92, C.blue, C.softBlue);
  pill(slide, ctx, "可审计", 960, 610, 92, C.amber, C.softAmber);
  foot(slide, ctx);
  return slide;
}
