export const C = {
  bg: "#F7F8FA",
  ink: "#111827",
  muted: "#667085",
  line: "#D9DEE7",
  panel: "#FFFFFFE8",
  teal: "#0F8B8D",
  tealDark: "#0B5F62",
  blue: "#2563EB",
  amber: "#D9861C",
  green: "#198754",
  red: "#C2410C",
  violet: "#6D5BD0",
  softTeal: "#E6F4F3",
  softBlue: "#EAF1FF",
  softAmber: "#FFF2DD",
  softGray: "#EEF1F5",
};

export function bg(slide, ctx) {
  ctx.addShape(slide, { x: 0, y: 0, w: ctx.W, h: ctx.H, fill: C.bg });
}

export function title(slide, ctx, kicker, heading, sub) {
  ctx.addText(slide, {
    text: kicker,
    x: 54,
    y: 34,
    w: 360,
    h: 24,
    fontSize: 13,
    color: C.tealDark,
    bold: true,
    typeface: "PingFang SC",
  });
  ctx.addText(slide, {
    text: heading,
    x: 52,
    y: 62,
    w: 626,
    h: 66,
    fontSize: 32,
    color: C.ink,
    bold: true,
    typeface: "PingFang SC",
  });
  if (sub) {
    ctx.addText(slide, {
      text: sub,
      x: 54,
      y: 132,
      w: 586,
      h: 42,
      fontSize: 16,
      color: C.muted,
      typeface: "PingFang SC",
    });
  }
}

export async function visual(slide, ctx, name, x = 704, y = 62, w = 520, h = 590) {
  await ctx.addImage(slide, {
    path: `${ctx.assetDir}/${name}`,
    x,
    y,
    w,
    h,
    fit: "contain",
    alt: name,
  });
}

export function card(slide, ctx, { x, y, w, h, fill = C.panel, line = C.line, radius = "roundRect" }) {
  return ctx.addShape(slide, {
    geometry: radius,
    x,
    y,
    w,
    h,
    fill,
    line: ctx.line(line, 1),
  });
}

export function cardText(slide, ctx, { x, y, w, h, head, body, color = C.ink, accent = C.teal }) {
  ctx.addShape(slide, { geometry: "rect", x, y, w: 4, h, fill: accent });
  ctx.addText(slide, {
    text: head,
    x: x + 16,
    y: y + 12,
    w: w - 24,
    h: 28,
    fontSize: 17,
    color,
    bold: true,
    typeface: "PingFang SC",
  });
  ctx.addText(slide, {
    text: body,
    x: x + 16,
    y: y + 46,
    w: w - 26,
    h: h - 44,
    fontSize: 13,
    color: C.muted,
    typeface: "PingFang SC",
  });
}

export function pill(slide, ctx, text, x, y, w, color = C.teal, fill = C.softTeal) {
  ctx.addShape(slide, {
    geometry: "roundRect",
    x,
    y,
    w,
    h: 30,
    fill,
    line: ctx.line(color, 1),
  });
  ctx.addText(slide, {
    text,
    x: x + 12,
    y: y + 6,
    w: w - 24,
    h: 18,
    fontSize: 11,
    bold: true,
    color,
    align: "center",
    typeface: "PingFang SC",
  });
}

export function foot(slide, ctx, text = "资料口径：基于当前分支实现与用户提供的竞品对比材料整理") {
  ctx.addText(slide, {
    text,
    x: 54,
    y: 686,
    w: 920,
    h: 18,
    fontSize: 9,
    color: "#98A2B3",
    typeface: "PingFang SC",
  });
}
