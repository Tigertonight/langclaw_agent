import { bg, title, visual, card, pill, foot, C } from "./helpers.mjs";

export async function slide02(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  await visual(slide, ctx, "02-positioning.png", 662, 90, 570, 484);

  title(
    slide,
    ctx,
    "02 / 产品对比：定位维度",
    "对手是横向工具，我们是垂类交付平台",
    "GBrain、OpenClaw、Claude Code、Hermes 都解决一类通用能力；EnterpriseAgent 把这些能力组合进企业场景。"
  );

  const rows = [
    ["GBrain", "个人/团队记忆大脑", "强在知识图谱与检索层，不是完整 Agent"],
    ["OpenClaw", "个人多渠道 AI 助手", "强在跨 IM 与本地优先，偏个人助手"],
    ["Claude Code", "开发者终端编码助手", "强在代码场景，不覆盖业务流程"],
    ["Hermes Agent", "个人自学习 Agent", "强在 self-improving loop，偏通用学习"],
  ];

  ctx.addShape(slide, { geometry: "roundRect", x: 54, y: 188, w: 560, h: 338, fill: "#FFFFFFE8", line: ctx.line(C.line, 1) });
  rows.forEach((r, i) => {
    const y = 210 + i * 76;
    ctx.addText(slide, { text: r[0], x: 82, y, w: 150, h: 22, fontSize: 18, bold: true, color: C.ink, typeface: "PingFang SC" });
    ctx.addText(slide, { text: r[1], x: 236, y: y + 1, w: 178, h: 20, fontSize: 13, bold: true, color: C.tealDark, typeface: "PingFang SC" });
    ctx.addText(slide, { text: r[2], x: 82, y: y + 28, w: 500, h: 26, fontSize: 12, color: C.muted, typeface: "PingFang SC" });
    if (i < rows.length - 1) ctx.addShape(slide, { geometry: "rect", x: 82, y: y + 62, w: 500, h: 1, fill: C.line });
  });

  card(slide, ctx, { x: 54, y: 548, w: 560, h: 88, fill: C.softTeal, line: "#B9DFDD" });
  ctx.addText(slide, {
    text: "关键差异：我们不是再做一个通用助手，而是把 Runtime、记忆、渠道、自演化和企业权限包装成可交付产品。",
    x: 80,
    y: 570,
    w: 506,
    h: 42,
    fontSize: 17,
    bold: true,
    color: C.tealDark,
    typeface: "PingFang SC",
  });
  pill(slide, ctx, "垂类场景化", 705, 596, 122, C.teal, C.softTeal);
  pill(slide, ctx, "企业接入", 840, 596, 110, C.blue, C.softBlue);
  pill(slide, ctx, "私有化部署", 964, 596, 130, C.amber, C.softAmber);
  foot(slide, ctx);
  return slide;
}
