import { bg, title, visual, foot, C } from "./helpers.mjs";

export async function slide03(presentation, ctx) {
  const slide = presentation.slides.add();
  bg(slide, ctx);
  await visual(slide, ctx, "03-matrix.png", 862, 126, 300, 310);

  title(
    slide,
    ctx,
    "03 / 能力矩阵：客户与投资人视角",
    "核心卖点是“能力合集 + 企业化封装”",
    "单点能力有人更强，但很少有产品同时具备 Runtime、企业治理、垂类工作流、生成式 UI 与自演化。"
  );

  const x0 = 54;
  const y0 = 190;
  const rowH = 42;
  const colW = [210, 126, 108, 116, 116, 108];
  const heads = ["能力", "EnterpriseAgent", "GBrain", "OpenClaw", "Claude Code", "Hermes"];
  const rows = [
    ["Agent Runtime", "完整", "仅记忆层", "完整", "编码场景", "完整"],
    ["多租户/企业权限", "business_id 隔离", "团队偏弱", "单用户", "单开发者", "单用户"],
    ["企业 IM 渠道", "6 渠道适配", "无", "海外为主", "无", "海外为主"],
    ["垂类工具/工作流", "DomainPack", "无", "无", "无", "无"],
    ["长期记忆+图谱", "memory-service", "强项", "弱", "弱", "中"],
    ["Plan Mode/门禁", "三级策略", "N/A", "沙箱", "强", "中"],
    ["A2UI 流式 UI", "6 Surface", "无", "Live Canvas", "无", "无"],
    ["私有化部署", "企业私有化", "自托管", "本地", "本地 CLI", "VPS"],
  ];

  let x = x0;
  heads.forEach((h, i) => {
    ctx.addShape(slide, { geometry: "rect", x, y: y0, w: colW[i], h: 36, fill: i === 1 ? C.tealDark : "#E8ECF2", line: ctx.line("#D7DDE7", 1) });
    ctx.addText(slide, { text: h, x: x + 8, y: y0 + 9, w: colW[i] - 16, h: 16, fontSize: 10.5, bold: true, color: i === 1 ? "#FFFFFF" : C.ink, align: "center", typeface: "PingFang SC" });
    x += colW[i];
  });

  rows.forEach((r, ri) => {
    x = x0;
    const y = y0 + 36 + ri * rowH;
    r.forEach((v, ci) => {
      const isOurs = ci === 1;
      const fill = ci === 0 ? "#F3F5F8" : isOurs ? "#E6F4F3" : "#FFFFFF";
      ctx.addShape(slide, { geometry: "rect", x, y, w: colW[ci], h: rowH, fill, line: ctx.line("#D7DDE7", 1) });
      const text = isOurs ? `✓ ${v}` : v;
      ctx.addText(slide, {
        text,
        x: x + 7,
        y: y + 10,
        w: colW[ci] - 14,
        h: 22,
        fontSize: ci === 0 ? 10.5 : 9.6,
        bold: ci === 0 || isOurs,
        color: isOurs ? C.tealDark : ci === 0 ? C.ink : C.muted,
        align: ci === 0 ? "left" : "center",
        typeface: "PingFang SC",
      });
      x += colW[ci];
    });
  });

  ctx.addShape(slide, { geometry: "roundRect", x: 842, y: 508, w: 330, h: 112, fill: "#FFFFFFE6", line: ctx.line(C.line, 1) });
  ctx.addText(slide, {
    text: "结论：我们的优势不是单项跑分，而是把四类能力工程化为企业可上线的闭环。",
    x: 864,
    y: 536,
    w: 286,
    h: 58,
    fontSize: 15,
    bold: true,
    color: C.ink,
    typeface: "PingFang SC",
  });
  foot(slide, ctx);
  return slide;
}
