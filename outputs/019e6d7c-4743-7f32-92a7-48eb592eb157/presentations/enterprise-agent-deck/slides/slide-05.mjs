import { bg, title, visual, card, cardText, pill, foot, C } from "./helpers.mjs";

export async function slide05(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  await visual(slide, ctx, "05-evolution.png", 672, 92, 548, 492);

  title(
    slide,
    ctx,
    "05 / 自演化与复制路径",
    "越用越懂业务，最终沉淀成可复制垂类引擎",
    "EvolutionRuntime 从对话中抽取 memory、entities、relations 和业务词表；DomainPack 把行业能力封装为可迁移资产。"
  );

  card(slide, ctx, { x: 54, y: 194, w: 548, h: 98, fill: "#FFFFFFE8" });
  cardText(slide, ctx, {
    x: 54,
    y: 194,
    w: 548,
    h: 98,
    head: "短期：用垂类壁垒挡住通用工具",
    body: "4 个对手都不会主动深做汽车 4S 店；我们先用场景包、企业 IM 和流程模板完成第一批落地。",
    accent: C.teal,
  });

  card(slide, ctx, { x: 54, y: 318, w: 548, h: 98, fill: "#FFFFFFE8" });
  cardText(slide, ctx, {
    x: 54,
    y: 318,
    w: 548,
    h: 98,
    head: "中期：沉淀数据与流程壁垒",
    body: "记忆、实体图谱、业务词表、审批动作和自动化模板会随客户使用持续增厚。",
    accent: C.amber,
  });

  card(slide, ctx, { x: 54, y: 442, w: 548, h: 98, fill: "#FFFFFFE8" });
  cardText(slide, ctx, {
    x: 54,
    y: 442,
    w: 548,
    h: 98,
    head: "长期：从 4S 店复制到更多门店型行业",
    body: "门店 + 导购 + CRM + 售后流程的行业，都可以通过 DomainPack 复用 Runtime。",
    accent: C.blue,
  });

  card(slide, ctx, { x: 54, y: 572, w: 548, h: 54, fill: "#FFF7ED", line: "#F1C27D" });
  ctx.addText(slide, {
    text: "诚实边界：品牌生态、检索基准、自演化深度仍需真实客户数据验证。",
    x: 76,
    y: 589,
    w: 504,
    h: 20,
    fontSize: 14,
    bold: true,
    color: "#8A4B00",
    typeface: "PingFang SC",
  });
  pill(slide, ctx, "先打透一个垂类", 744, 606, 150, C.teal, C.softTeal);
  pill(slide, ctx, "再复制到 N 个行业", 910, 606, 168, C.blue, C.softBlue);
  foot(slide, ctx);
  return slide;
}
