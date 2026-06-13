import { bg, title, visual, card, cardText, pill, foot, C } from "./helpers.mjs";

export async function slide01(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  await visual(slide, ctx, "01-runtime-overview.png", 708, 80, 510, 520);

  title(
    slide,
    ctx,
    "01 / 一句话定位",
    "EnterpriseAgent 是垂类企业 Agent Runtime",
    "不是单点聊天机器人，而是从渠道接入、上下文、工具治理、生成式 UI 到记忆演化的端到端平台。"
  );

  card(slide, ctx, { x: 54, y: 184, w: 590, h: 90 });
  cardText(slide, ctx, {
    x: 54,
    y: 184,
    w: 590,
    h: 90,
    head: "定位：把通用 Agent 能力产品化成交付平台",
    body: "首个验证场景是汽车 4S 店，但真正资产是可复用 Runtime：路由、工具、权限、记忆、A2UI、DomainPack。",
    accent: C.teal,
  });

  const items = [
    ["Agent Runtime", "路由 + 工具 + 决策 + 子 Agent"],
    ["Enterprise Controls", "多租户、权限、确认、审计、私有化"],
    ["Self Evolution", "从对话抽取记忆、实体、关系与业务词表"],
  ];
  items.forEach((item, i) => {
    const y = 304 + i * 82;
    card(slide, ctx, { x: 54, y, w: 520, h: 58, fill: "#FFFFFFD9" });
    ctx.addText(slide, {
      text: item[0],
      x: 78,
      y: y + 12,
      w: 190,
      h: 24,
      fontSize: 17,
      bold: true,
      color: C.ink,
      typeface: "PingFang SC",
    });
    ctx.addText(slide, {
      text: item[1],
      x: 270,
      y: y + 14,
      w: 280,
      h: 22,
      fontSize: 13,
      color: C.muted,
      typeface: "PingFang SC",
    });
  });

  pill(slide, ctx, "客户：拿来即用", 54, 572, 136, C.teal, C.softTeal);
  pill(slide, ctx, "投资人：垂类可复制", 202, 572, 156, C.amber, C.softAmber);
  pill(slide, ctx, "工程：Runtime 可扩展", 370, 572, 176, C.blue, C.softBlue);
  foot(slide, ctx);
  return slide;
}
