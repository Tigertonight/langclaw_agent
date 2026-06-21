import fs from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const root = process.cwd();
const outDir = path.join(root, "docs/cloud-commodity-workbook-solution-ppt");
const slideDir = path.join(outDir, "slides");
fs.mkdirSync(slideDir, { recursive: true });

GlobalFonts.registerFromPath("/System/Library/Fonts/Hiragino Sans GB.ttc", "DeckSans");
GlobalFonts.registerFromPath("/System/Library/Fonts/STHeiti Medium.ttc", "DeckHei");

const W = 1920;
const H = 1080;
const palette = {
  bg: "#f7f9fb",
  paper: "#ffffff",
  ink: "#17202a",
  muted: "#5f6b7a",
  line: "#d9e1ea",
  cyan: "#1677a8",
  blue: "#244f91",
  green: "#3f8f5b",
  amber: "#b67611",
  red: "#b3483e",
  slate: "#34495e",
};

const slides = [
  {
    title: "云商品平台产品工作手册",
    subtitle: "从技术能力、商品主数据到经营闭环的产品方法论",
    section: "总览",
    type: "cover",
    bullets: ["面向云厂商商品平台建设", "覆盖产品化、商品化、发布、销售、交付、经营治理", "沉淀为可复用的 PM 工作手册"],
    diagram: "loop",
  },
  {
    title: "为什么需要一套云商品工作手册",
    subtitle: "云商品不是页面上架，而是跨系统、跨角色、跨经营口径的协同工程",
    section: "业务背景",
    bullets: ["研发能力需要被定义为可售产品", "商品主数据要连接渠道、订单、账单和合同", "财务、稳定性、销售和客户成功需要同一套事实"],
    diagram: "problem",
  },
  {
    title: "能力、产品、商品的边界",
    subtitle: "先分清三层对象，再谈商品化和规模化经营",
    section: "基础概念",
    bullets: ["能力：底层资源、模型或服务能力", "产品：面向客户场景的边界和承诺", "商品：可订购、计量、定价、开票和续约的商业对象"],
    diagram: "layers",
  },
  {
    title: "产品化定义前置",
    subtitle: "判断一个能力是否具备进入商品化流程的条件",
    section: "产品化",
    bullets: ["明确目标客户和核心场景", "定义能力边界和不可承诺项", "准备成本输入、服务等级承诺和交付物"],
    diagram: "gate",
  },
  {
    title: "商品主数据模型",
    subtitle: "把商品、售卖方案、规格、计量、价格和权益连成交易骨架",
    section: "主数据",
    bullets: ["商品主对象回答“卖什么”", "售卖方案回答“怎么卖”", "计量和价格把使用事实转成金额"],
    diagram: "hub",
  },
  {
    title: "主数据治理与血缘",
    subtitle: "字段从哪里来、谁维护、谁消费、变更影响谁",
    section: "主数据治理",
    bullets: ["高风险字段需要归属、审批和留痕", "官网、控制台、销售、账单消费同一事实源", "字段变更先做影响分析，再做渠道同步"],
    diagram: "lineage",
  },
  {
    title: "售卖方案、规格、计量、价格",
    subtitle: "商业包装必须和可计量、可结算、可解释的规则一致",
    section: "商业包装",
    bullets: ["售卖方案定义购买方式", "可购买规格定义客户选择", "计量项和价格规则支撑账单解释"],
    diagram: "chain",
  },
  {
    title: "套餐型产品与权益治理",
    subtitle: "额度发放、消耗顺序、过期、退订和超额确认是核心风险点",
    section: "权益治理",
    bullets: ["权益规则影响客户体验和毛利", "超额付费需要二次确认和账单解释", "退订、退款、过期必须提前定义"],
    diagram: "entitlement",
  },
  {
    title: "产品生命周期全流程",
    subtitle: "从产品化到发布、交付、巡检、续约和复盘",
    section: "生命周期",
    bullets: ["产品化：定义客户、边界、成本和承诺", "商品化：补齐主数据、价格和权益", "经营闭环：巡检、续约、复盘和模板沉淀"],
    diagram: "swimlane",
  },
  {
    title: "渠道发布与上下游协同",
    subtitle: "一套商品主数据，投射到官网、控制台、云市场、销售和客服",
    section: "渠道发布",
    bullets: ["不同渠道展示不同字段，但必须来自同一事实源", "禁展示项和禁承诺项要前置控制", "渠道发布后要做一致性巡检"],
    diagram: "channels",
  },
  {
    title: "上市打法与销售方案",
    subtitle: "把商品带到目标行业、预算结构和客户成交路径中",
    section: "上市与销售",
    bullets: ["明确目标客户、行业场景和预算", "组合计算、存储、数据库、网络和 AI 服务", "正式报价前确认价格、容量、服务承诺和合同边界"],
    diagram: "solution",
  },
  {
    title: "财务商业化与经营口径",
    subtitle: "成交规模不等于健康收入，毛利和收入确认要同步看",
    section: "财务经营",
    bullets: ["成交规模、净收入、毛利率、递延收入分开看", "免费额度、资源包和折扣可能影响毛利", "财务审批边界要进入报价前检查"],
    diagram: "finance",
  },
  {
    title: "稳定性上架门禁",
    subtitle: "容量、限流、告警、灰度、回滚和服务承诺是上架前条件",
    section: "稳定性",
    bullets: ["资源池和地域容量决定可售范围", "大促、队列和失败率需要监控阈值", "灰度发布和回滚方案必须提前准备"],
    diagram: "sre",
  },
  {
    title: "客户自助购买与售后解释",
    subtitle: "把估算、正式报价、额度、超额、账单差异说清楚",
    section: "客户体验",
    bullets: ["买前确认购买内容、权益额度和有效期", "买后解释用量、抵扣、超额和合同价差异", "客户可见字段要做权限过滤"],
    diagram: "customer",
  },
  {
    title: "异常链路与反向治理",
    subtitle: "调价、退款、退订、规格变更比新上架更复杂",
    section: "异常治理",
    bullets: ["变更影响客户、合同、权益、账单和渠道", "存量客户保护和版本兼容要提前设计", "高风险变更只生成审批摘要和回滚方案"],
    diagram: "risk",
  },
  {
    title: "发布后巡检与续约经营",
    subtitle: "上架成功只是开始，业务健康要靠闭环巡检",
    section: "运营健康",
    bullets: ["24 小时巡检官网、控制台、订单、计量、账单和告警", "续约雷达关注用量、争议、服务事件和扩容机会", "客户成功动作要回流到商品规则"],
    diagram: "radar",
  },
  {
    title: "组织层级与角色关注点",
    subtitle: "同一套事实，不同角色做不同决策",
    section: "组织协同",
    bullets: ["老板看目标达成、毛利和风险负责人", "产品看覆盖率、能力边界和渠道一致性", "销售、财务、稳定性、客服各看自己的行动清单"],
    diagram: "roles",
  },
  {
    title: "平台实现视角",
    subtitle: "领域能力包、资源注册、权限、路由、工具、展示和评测共同构成 Agent 系统",
    section: "平台实现",
    bullets: ["领域隔离避免云商品和其他业务混淆", "工具链承接查询、估算、评审、审批摘要和模拟", "结构化展示优先给结论、风险、负责人和下一步动作"],
    diagram: "platform",
  },
  {
    title: "三条演示案例主线",
    subtitle: "ECS GPU、Seedance Mini、Agent Plan 覆盖三类典型云商品",
    section: "案例",
    bullets: ["资源型商品：容量、地域、交付和服务承诺", "资源包型商品：自助购买、促销和大促稳定性", "套餐权益型商品：额度、超额、毛利和客户体验"],
    diagram: "cases",
  },
  {
    title: "售前呈现的核心结论",
    subtitle: "这套手册把云商品平台从“能上架”升级为“可治理、可销售、可经营”",
    section: "总结",
    bullets: ["建立产品化到经营闭环的方法论", "沉淀跨角色协同的检查清单和模板", "支撑云厂商商品平台 Agent 的高标准演示"],
    diagram: "summary",
  },
];

function font(size, weight = 400, family = "DeckSans") {
  return `${weight} ${size}px ${family}`;
}

function roundRect(ctx, x, y, w, h, r = 18) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fillRound(ctx, x, y, w, h, r, fill, stroke = null) {
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function line(ctx, x1, y1, x2, y2, color = palette.cyan, width = 3) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function arrow(ctx, x1, y1, x2, y2, color = palette.cyan) {
  line(ctx, x1, y1, x2, y2, color, 3);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 16 * Math.cos(angle - 0.45), y2 - 16 * Math.sin(angle - 0.45));
  ctx.lineTo(x2 - 16 * Math.cos(angle + 0.45), y2 - 16 * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 10) {
  const chars = [...text];
  let lineText = "";
  let lines = [];
  for (const ch of chars) {
    const test = lineText + ch;
    if (ctx.measureText(test).width > maxWidth && lineText) {
      lines.push(lineText);
      lineText = ch;
      if (lines.length >= maxLines - 1) break;
    } else {
      lineText = test;
    }
  }
  if (lineText && lines.length < maxLines) lines.push(lineText);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return y + lines.length * lineHeight;
}

function drawBackground(ctx, i) {
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#edf2f6";
  ctx.lineWidth = 1;
  for (let x = 80; x < W; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 80; y < H; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.fillStyle = i % 3 === 0 ? "rgba(22,119,168,.07)" : i % 3 === 1 ? "rgba(63,143,91,.07)" : "rgba(182,118,17,.07)";
  ctx.beginPath();
  ctx.ellipse(1570, 120, 380, 160, -0.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawHeader(ctx, slide, index) {
  ctx.fillStyle = palette.cyan;
  ctx.font = font(24, 600);
  ctx.fillText(slide.section, 92, 86);
  ctx.fillStyle = palette.ink;
  ctx.font = font(56, 700, "DeckHei");
  wrapText(ctx, slide.title, 92, 170, 760, 68, 2);
  ctx.fillStyle = palette.muted;
  ctx.font = font(27, 400);
  wrapText(ctx, slide.subtitle, 92, 300, 780, 40, 3);
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(92, 390);
  ctx.lineTo(820, 390);
  ctx.stroke();
  ctx.fillStyle = palette.muted;
  ctx.font = font(20, 400);
  ctx.fillText(`云商品平台产品工作手册  /  ${String(index + 1).padStart(2, "0")} / 20`, 92, 1010);
}

function drawBullets(ctx, bullets) {
  ctx.font = font(25, 400);
  let y = 462;
  for (const b of bullets) {
    ctx.fillStyle = palette.cyan;
    ctx.beginPath();
    ctx.arc(106, y - 9, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.ink;
    y = wrapText(ctx, b, 132, y, 720, 38, 2) + 28;
  }
}

function drawNode(ctx, x, y, w, h, title, sub = "", color = palette.cyan) {
  fillRound(ctx, x, y, w, h, 20, palette.paper, palette.line);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 6, h);
  ctx.fillStyle = palette.ink;
  ctx.font = font(24, 700);
  ctx.fillText(title, x + 24, y + 40);
  if (sub) {
    ctx.fillStyle = palette.muted;
    ctx.font = font(18, 400);
    wrapText(ctx, sub, x + 24, y + 72, w - 48, 26, 2);
  }
}

function drawVisual(ctx, slide) {
  const x = 980;
  const y = 150;
  const w = 810;
  const h = 760;
  fillRound(ctx, x, y, w, h, 28, "rgba(255,255,255,.82)", palette.line);

  const cx = x + w / 2;
  const cy = y + h / 2;
  if (["loop", "summary"].includes(slide.diagram)) {
    const labels = ["产品化", "主数据", "渠道销售", "交付账单", "经营复盘"];
    for (let i = 0; i < labels.length; i++) {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / labels.length;
      const px = cx + Math.cos(a) * 250;
      const py = cy + Math.sin(a) * 230;
      drawNode(ctx, px - 82, py - 40, 164, 80, labels[i], "", [palette.cyan, palette.green, palette.blue, palette.amber, palette.red][i]);
      const b = -Math.PI / 2 + (Math.PI * 2 * ((i + 1) % labels.length)) / labels.length;
      arrow(ctx, px + Math.cos(a) * 82, py + Math.sin(a) * 40, cx + Math.cos(b) * 168, cy + Math.sin(b) * 154, palette.cyan);
    }
    drawNode(ctx, cx - 110, cy - 44, 220, 88, "云商品平台", "统一事实源");
    return;
  }

  if (slide.diagram === "layers") {
    drawNode(ctx, x + 90, y + 120, 210, 130, "技术能力", "资源 / 模型 / 服务");
    drawNode(ctx, x + 300, y + 270, 210, 130, "产品定义", "客户 / 场景 / 边界", palette.green);
    drawNode(ctx, x + 510, y + 420, 210, 130, "可售商品", "订购 / 计量 / 结算", palette.amber);
    arrow(ctx, x + 300, y + 190, x + 330, y + 300);
    arrow(ctx, x + 510, y + 340, x + 540, y + 450);
    return;
  }

  if (slide.diagram === "hub" || slide.diagram === "platform") {
    drawNode(ctx, cx - 120, cy - 55, 240, 110, slide.diagram === "hub" ? "商品主对象" : "领域 Agent", "统一事实与工具");
    const items = slide.diagram === "hub" ? ["售卖方案", "规格", "计量项", "价格规则", "权益规则", "订单账单"] : ["资源注册", "权限", "路由", "工具", "展示", "评测审计"];
    items.forEach((it, i) => {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / items.length;
      const px = cx + Math.cos(a) * 285;
      const py = cy + Math.sin(a) * 235;
      drawNode(ctx, px - 78, py - 36, 156, 72, it, "", i % 2 ? palette.green : palette.cyan);
      arrow(ctx, px - Math.cos(a) * 78, py - Math.sin(a) * 36, cx + Math.cos(a) * 125, cy + Math.sin(a) * 58, palette.cyan);
    });
    return;
  }

  if (["gate", "chain", "entitlement", "sre"].includes(slide.diagram)) {
    const items = {
      gate: ["客户", "边界", "成本", "承诺", "交付"],
      chain: ["售卖方案", "规格", "计量", "价格", "账单"],
      entitlement: ["发放", "消耗", "过期", "超额确认", "账单解释"],
      sre: ["容量", "限流", "告警", "灰度", "回滚"],
    }[slide.diagram];
    items.forEach((it, i) => {
      const px = x + 80 + i * 140;
      drawNode(ctx, px, cy - 60, 118, 120, it, "", i === items.length - 1 ? palette.amber : palette.cyan);
      if (i < items.length - 1) arrow(ctx, px + 118, cy, px + 138, cy);
    });
    return;
  }

  if (["swimlane", "channels", "solution", "finance", "customer", "risk", "radar", "roles", "cases", "lineage", "problem"].includes(slide.diagram)) {
    const rows = {
      swimlane: [["产品", "产品化", "商品化", "发布", "复盘"], ["财务", "成本", "毛利", "收入", "健康"], ["稳定性", "容量", "告警", "灰度", "事件"]],
      channels: [["主数据", "官网", "控制台", "云市场", "销售"], ["交易", "订单", "合同", "账单", "客服"]],
      solution: [["客户", "预算", "场景", "方案", "报价"], ["组合", "计算", "存储", "数据库", "网络"]],
      finance: [["规模", "成交", "净收入", "毛利", "风险"], ["口径", "资源包", "折扣", "递延", "争议"]],
      customer: [["买前", "估算", "权益", "超额", "确认"], ["买后", "用量", "抵扣", "账单", "解释"]],
      risk: [["变更", "客户", "合同", "权益", "账单"], ["治理", "影响分析", "审批", "回滚", "复盘"]],
      radar: [["巡检", "官网", "订单", "计量", "账单"], ["续约", "用量", "争议", "事件", "机会"]],
      roles: [["老板", "目标", "毛利", "风险", "负责人"], ["团队", "产品", "财务", "销售", "客服"]],
      cases: [["ECS GPU", "容量", "地域", "交付", "经营"], ["视频生成", "资源包", "促销", "队列", "账单"], ["智能体套餐", "权益", "超额", "毛利", "体验"]],
      lineage: [["字段", "源头", "维护", "消费", "变更"], ["下游", "官网", "订单", "账单", "客服"]],
      problem: [["断点", "能力", "页面", "订单", "经营"], ["目标", "定义", "主数据", "交付", "复盘"]],
    }[slide.diagram];
    rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        drawNode(ctx, x + 70 + c * 140, y + 120 + r * 160, 120, 78, cell, "", c === 0 ? palette.blue : palette.cyan);
        if (c > 0) line(ctx, x + 70 + (c - 1) * 140 + 120, y + 159 + r * 160, x + 70 + c * 140, y + 159 + r * 160, palette.line, 2);
      });
    });
    return;
  }
}

function renderSlide(slide, index) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, index);
  drawHeader(ctx, slide, index);
  drawBullets(ctx, slide.bullets);
  drawVisual(ctx, slide);
  const file = `slide-${String(index + 1).padStart(2, "0")}.png`;
  fs.writeFileSync(path.join(slideDir, file), canvas.toBuffer("image/png"));
  return { ...slide, file, imagegenPrompt: `Use case: productivity-visual. Asset type: 16:9 presales solution deck slide. Topic: ${slide.title}. Style: premium enterprise cloud SaaS consulting deck, white soft-gray background, thin blue-green business diagrams, clear negative space, no logos, no watermark.` };
}

const manifest = slides.map(renderSlide);
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>云商品平台产品工作手册 · 售前方案PPT</title><style>body{margin:0;background:#101820;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#fff}.wrap{max-width:1280px;margin:0 auto;padding:40px 24px}h1{font-size:28px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:22px}.card{background:#172331;border:1px solid #2d3d4f;border-radius:14px;padding:12px}.card img{width:100%;display:block;border-radius:8px}.card p{margin:10px 4px 0;color:#b8c6d6;font-size:14px}</style></head><body><div class="wrap"><h1>云商品平台产品工作手册 · 售前方案PPT</h1><div class="grid">${manifest.map((s, i) => `<div class="card"><img src="./slides/${s.file}" alt="${s.title}"/><p>${String(i + 1).padStart(2, "0")} · ${s.title}</p></div>`).join("")}</div></div></body></html>`;
fs.writeFileSync(path.join(outDir, "index.html"), html);

console.log(`generated ${manifest.length} slides in ${slideDir}`);
