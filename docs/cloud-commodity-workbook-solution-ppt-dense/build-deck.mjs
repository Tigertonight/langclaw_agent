import fs from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const root = process.cwd();
const outDir = path.join(root, "docs/cloud-commodity-workbook-solution-ppt-dense");
const slideDir = path.join(outDir, "slides");
fs.mkdirSync(slideDir, { recursive: true });

GlobalFonts.registerFromPath("/System/Library/Fonts/Hiragino Sans GB.ttc", "DeckSans");
GlobalFonts.registerFromPath("/System/Library/Fonts/STHeiti Medium.ttc", "DeckHei");

const W = 1920;
const H = 1080;
const C = {
  bg: "#06101a",
  bg2: "#091a29",
  ink: "#f7fbff",
  muted: "#a8bacb",
  dim: "#6f8498",
  cyan: "#27d9ff",
  blue: "#1689d4",
  red: "#ff3b3f",
  red2: "#8f171d",
  amber: "#ffb13b",
  green: "#30d782",
  panel: "rgba(10,27,43,.82)",
  panel2: "rgba(16,40,60,.86)",
  line: "rgba(75,205,255,.42)",
};

const slides = [
  ["总览", "云商品平台产品工作手册", "从技术能力到可售云商品，再到经营闭环", ["技术能力先产品化定义", "商品主数据驱动全渠道交易", "用经营指标、稳定性和客户续约验证业务健康"], "loop", "产品化 → 商品化 → 渠道发布 → 交易交付 → 经营复盘"],
  ["业务背景", "云商品不是页面上架", "它是一套跨系统、跨角色、跨经营口径的协同机制", ["能力没有产品边界，销售就会过度承诺", "主数据不统一，官网、控制台、报价和账单会割裂", "只看成交规模，容易忽略毛利、交付和续约风险"], "problem", "核心矛盾：能卖 ≠ 卖得稳、算得清、续得上"],
  ["基础概念", "能力、产品、商品的三层边界", "先把对象定义清楚，后续流程才不会混乱", ["能力：资源、模型、算法或服务能力", "产品：目标客户、场景、边界、服务承诺", "商品：可订购、可计量、可定价、可开票的商业对象"], "layers", "判断标准：客户是否能理解、购买、使用、续约"],
  ["产品化前置", "产品定义截断点", "决定一个能力能否进入商品化流程", ["目标客户和核心场景是否明确", "不可承诺项、成本输入和服务等级是否可解释", "PRD、商业测算、SRE、法务和 GTM 交付物是否就绪"], "gate", "门禁结论：缺定义不上架，缺成本不报价，缺稳定性不放量"],
  ["主数据", "商品主数据模型", "一切交易、账单、合同和渠道展示的事实源", ["Product 回答卖什么", "Offer 回答怎么卖", "SKU、Meter、Price 回答买什么、怎么算、收多少"], "hub", "主数据骨架：商品 / 售卖方案 / 规格 / 计量 / 价格 / 权益"],
  ["主数据治理", "字段血缘与变更影响", "任何关键字段变更，都要知道谁维护、谁消费、影响谁", ["官网、控制台、销售报价、订单、账单消费同一事实", "价格、权益、服务承诺属于高风险字段", "变更前做影响分析，发布后做一致性巡检"], "lineage", "治理原则：一处维护，多处消费，全链路可追溯"],
  ["商业包装", "Offer、SKU、计量、价格如何协同", "把售卖设计落到可购买、可计量、可结算", ["Offer 是面向客户的售卖方案", "SKU 是客户可选择的规格", "Meter 和 Price 把使用事实转成账单金额"], "chain", "常见冲突：套餐、资源包、合同折扣、促销叠加后毛利穿透"],
  ["权益治理", "Plan 型产品的核心难点", "套餐额度不是一句营销话术，而是一套权益规则", ["额度何时发放、如何消耗、是否过期", "退订、退款、超额付费如何处理", "账单里如何解释赠送、抵扣和超额"], "entitlement", "风险底线：超额付费必须确认，权益成本必须入毛利"],
  ["生命周期", "云商品全流程泳道", "产品、财务、SRE、法务、GTM、销售、客户成功同步推进", ["产品化定义先行", "商品化和渠道发布并行治理", "交付、账单、续约、复盘形成闭环"], "swimlane", "流程目标：每个阶段都有负责人、交付物、门禁和异常出口"],
  ["渠道发布", "一套主数据，多种渠道视图", "官网、控制台、云市场、销售方案、客服解释各有边界", ["官网是营销销售渠道，不是主数据来源", "控制台关注购买字段和可用范围", "销售方案关注报价边界、不可承诺项和审批要求"], "channels", "渠道矩阵：展示什么、禁止展示什么、从哪里取数"],
  ["上市与销售", "GTM 与解决方案包", "把商品放进客户行业、预算和成交路径中", ["目标客户、行业场景、竞品边界先定义", "组合计算、存储、网络、数据库和 AI 能力", "正式报价前检查价格、容量、合同和服务承诺"], "solution", "售前口径：推荐方案 + 预算拆分 + 假设边界 + 下一步动作"],
  ["财务经营", "成交规模不等于健康收入", "GMV、净收入、毛利、递延收入要分开看", ["免费额度和资源包会带来成本归集问题", "折扣、促销、合同价叠加要过毛利底线", "收入确认口径必须进入商品规则"], "finance", "老板看目标，财务看口径，销售看可承诺边界"],
  ["稳定性", "SRE 上架门禁", "可售商品必须能被稳定交付和解释", ["容量池、地域可售范围和队列健康度", "限流、告警、灰度和回滚触发条件", "SLA 能承诺什么，不能承诺什么"], "sre", "稳定性不是上线后的事情，是商品上架前置条件"],
  ["客户体验", "客户自助购买与售后解释", "客户需要看懂自己买了什么、用了什么、为什么多收费", ["买前确认套餐、资源包、权益和有效期", "买后解释用量、抵扣、超额和发票", "估算、报价、合同价要清楚区分"], "customer", "客户友好原则：不暴露底层字段，只解释业务事实"],
  ["异常治理", "反向链路比新上架更复杂", "调价、退款、退订、规格变更都会穿透客户和财务", ["影响存量合同、订单、权益、账单和渠道展示", "需要审批摘要、客户通知和回滚检查点", "高风险动作只生成草稿，人工确认后生效"], "risk", "典型异常：改规格 / 调价格 / 下 SKU / 退款 / 退订 / 促销结束"],
  ["运营健康", "发布后巡检与续约经营", "商品上线后 24 小时和续约周期都要闭环观察", ["巡检官网、控制台、订单、计量、账单和告警", "续约看用量健康、账单争议、SLA 事件和扩容机会", "客户成功动作反哺商品规则和销售方案"], "radar", "业务健康：卖得出去、交付稳定、账单清楚、客户愿意续"],
  ["组织协同", "不同层级看同一套事实", "同一数据，不同角色形成不同决策", ["老板看目标达成、毛利、风险和负责人", "产品看覆盖率、上架质量和渠道一致性", "销售、财务、SRE、客服各有行动清单"], "roles", "组织价值：把口径对齐变成可执行的跨团队协作"],
  ["平台实现", "Agent 如何承接工作手册", "领域隔离、工具链、权限、OpenUI 和评测组成可演示系统", ["云商品域和其他业务域隔离", "工具承接查询、估算、评审、审批摘要和模拟", "展示优先给结论、风险、负责人和动作"], "platform", "演示要求：走 agentic loop，不写死答案，结果可追溯"],
  ["案例主线", "三类云商品覆盖典型难点", "ECS GPU、Seedance Mini、Agent Plan 组成完整案例包", ["资源型：容量、地域、交付、服务等级", "资源包型：自助购买、大促、队列、账单", "套餐型：权益、超额、毛利、客户解释"], "cases", "案例目标：从单点问答升级为多角色协同闭环"],
  ["总结", "售前呈现的核心结论", "这套手册展示了对云商品平台业务的纵深理解和横向覆盖", ["建立产品化到经营闭环的方法论", "沉淀跨角色检查清单、模板和演示剧本", "支撑云厂商商品平台 Agent 的高标准售卖"], "summary", "最终价值：可治理、可销售、可经营、可持续优化"],
].map(([section, title, subtitle, bullets, kind, footer], i) => ({ section, title, subtitle, bullets, kind, footer, no: i + 1 }));

function font(size, weight = 400, family = "DeckSans") {
  return `${weight} ${size}px ${family}`;
}

function rr(ctx, x, y, w, h, r = 12) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function panel(ctx, x, y, w, h, color = C.panel, stroke = C.line, r = 14) {
  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function text(ctx, s, x, y, size, color = C.ink, weight = 500, maxW = 9999, lh = size * 1.35, maxLines = 3) {
  ctx.font = font(size, weight, size >= 46 ? "DeckHei" : "DeckSans");
  ctx.fillStyle = color;
  const chars = [...s];
  let line = "";
  let lines = [];
  for (const ch of chars) {
    const t = line + ch;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = ch;
      if (lines.length >= maxLines - 1) break;
    } else line = t;
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  return y + lines.length * lh;
}

function arrow(ctx, x1, y1, x2, y2, color = C.cyan, dashed = false) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  if (dashed) ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - 18 * Math.cos(a - 0.45), y2 - 18 * Math.sin(a - 0.45));
  ctx.lineTo(x2 - 18 * Math.cos(a + 0.45), y2 - 18 * Math.sin(a + 0.45));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function bg(ctx) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#03070d");
  g.addColorStop(0.48, C.bg);
  g.addColorStop(1, "#020508");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(39,217,255,.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 48) {
    ctx.beginPath(); ctx.moveTo(x, H * 0.22); ctx.lineTo(x + 180, H); ctx.stroke();
  }
  for (let y = 40; y < H; y += 56) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y + 30); ctx.stroke();
  }
  const rg = ctx.createRadialGradient(920, 520, 40, 920, 520, 650);
  rg.addColorStop(0, "rgba(39,217,255,.16)");
  rg.addColorStop(1, "rgba(39,217,255,0)");
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
}

function header(ctx, s) {
  text(ctx, "CLOUD COMMODITY PLATFORM", 48, 62, 21, C.dim, 700);
  text(ctx, s.section, 48, 98, 25, C.red, 800);
  panel(ctx, 1710, 36, 150, 58, "rgba(80,14,20,.9)", "rgba(255,59,63,.85)", 8);
  text(ctx, `${String(s.no).padStart(2, "0")}/20`, 1742, 75, 28, C.ink, 800);
  text(ctx, s.title, 360, 105, 62, C.ink, 900, 1200, 70, 1);
  text(ctx, s.subtitle, 520, 154, 30, C.cyan, 700, 900, 38, 1);
  ctx.strokeStyle = "rgba(255,59,63,.58)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(420, 176); ctx.lineTo(500, 176); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(1420, 176); ctx.lineTo(1500, 176); ctx.stroke();
}

function node(ctx, x, y, w, h, title, sub = "", accent = C.cyan, idx = "") {
  panel(ctx, x, y, w, h, "rgba(9,25,40,.88)", accent === C.red ? "rgba(255,59,63,.9)" : "rgba(39,217,255,.7)", 12);
  if (idx) {
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(x + 28, y + 28, 22, 0, Math.PI * 2); ctx.fill();
    text(ctx, idx, x + 18, y + 37, 22, "#fff", 900);
  }
  text(ctx, title, x + (idx ? 60 : 20), y + 42, 26, C.ink, 800, w - 36, 32, 1);
  if (sub) text(ctx, sub, x + 20, y + 78, 18, C.muted, 500, w - 36, 24, 2);
}

function leftRisk(ctx, slide) {
  panel(ctx, 42, 255, 350, 500, "rgba(52,12,18,.78)", "rgba(255,59,63,.9)", 14);
  text(ctx, "最容易错的 3 件事", 84, 310, 30, C.ink, 900);
  const risks = slide.bullets;
  risks.forEach((r, i) => {
    const y = 365 + i * 120;
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath(); ctx.moveTo(70, y + 72); ctx.lineTo(360, y + 72); ctx.stroke();
    ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(82, y + 22, 24, 0, Math.PI * 2); ctx.fill();
    text(ctx, "×", 70, y + 34, 34, C.ink, 900);
    text(ctx, r, 126, y + 8, 22, C.ink, 800, 220, 29, 2);
  });
}

function bottomBar(ctx, slide) {
  panel(ctx, 34, 912, 1850, 94, "rgba(12,22,34,.92)", "rgba(255,255,255,.20)", 12);
  text(ctx, "关键结论", 70, 970, 34, C.ink, 900);
  text(ctx, slide.footer, 220, 968, 30, slide.footer.includes("风险") || slide.footer.includes("缺") ? C.red : C.cyan, 900, 1450, 38, 1);
}

function flow(ctx, labels, x, y, w, h, accent = C.cyan) {
  const gap = 22;
  const nw = (w - gap * (labels.length - 1)) / labels.length;
  labels.forEach((l, i) => {
    node(ctx, x + i * (nw + gap), y, nw, h, l[0], l[1] || "", i === labels.length - 1 ? C.red : accent, String(i + 1));
    if (i < labels.length - 1) arrow(ctx, x + (i + 1) * nw + i * gap + 4, y + h / 2, x + (i + 1) * (nw + gap) - 8, y + h / 2, accent);
  });
}

function visual(ctx, slide) {
  const k = slide.kind;
  const mainX = 430, mainY = 250, mainW = 1050;
  if (["loop", "summary"].includes(k)) {
    const cx = 955, cy = 520, r = 235;
    panel(ctx, cx - 170, cy - 98, 340, 196, "rgba(14,58,78,.92)", "rgba(39,217,255,.95)", 20);
    text(ctx, "云商品平台", cx - 108, cy - 20, 36, C.ink, 900);
    text(ctx, "统一事实源 + Agent 工作台", cx - 128, cy + 28, 22, C.cyan, 700);
    const items = [["产品化", "定义边界"], ["商品化", "主数据"], ["渠道销售", "可购买"], ["交付账单", "可结算"], ["经营复盘", "可续约"]];
    items.forEach((it, i) => {
      const a = -Math.PI / 2 + i * Math.PI * 2 / items.length;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      node(ctx, x - 90, y - 45, 180, 90, it[0], it[1], i === 4 ? C.red : C.cyan);
    });
    return;
  }
  if (k === "problem") {
    flow(ctx, [["技术能力", "口径不清"], ["页面上架", "字段不齐"], ["订单成交", "账单割裂"], ["经营复盘", "风险滞后"]], 460, 355, 910, 130, C.cyan);
    panel(ctx, 520, 580, 810, 170, "rgba(70,18,20,.78)", "rgba(255,59,63,.9)");
    text(ctx, "典型后果", 560, 638, 32, C.red, 900);
    text(ctx, "销售过度承诺 / 财务口径不一致 / 稳定性交付滞后 / 客户续约受损", 560, 690, 26, C.ink, 800, 710, 34, 2);
    return;
  }
  if (k === "layers") {
    [["技术能力", "资源、模型、服务能力"], ["产品定义", "客户、场景、边界、承诺"], ["可售商品", "订购、计量、定价、开票"]].forEach((it, i) => {
      node(ctx, 540 + i * 280, 350 + i * 85, 250, 120, it[0], it[1], i === 2 ? C.red : C.cyan);
      if (i < 2) arrow(ctx, 790 + i * 280, 405 + i * 85, 835 + i * 280, 465 + i * 85);
    });
    return;
  }
  if (["gate", "chain", "entitlement", "sre"].includes(k)) {
    const map = {
      gate: [["目标客户", "谁会买"], ["能力边界", "能做什么"], ["成本输入", "怎么算钱"], ["服务承诺", "能承诺什么"], ["交付物", "谁负责"]],
      chain: [["Offer", "售卖方案"], ["SKU", "可购规格"], ["Meter", "计量项"], ["Price", "价格规则"], ["Bill", "账单解释"]],
      entitlement: [["发放", "额度来源"], ["消耗", "抵扣顺序"], ["过期", "有效期"], ["超额", "二次确认"], ["解释", "账单口径"]],
      sre: [["容量", "可售范围"], ["限流", "峰值保护"], ["告警", "阈值"], ["灰度", "放量节奏"], ["回滚", "止损动作"]],
    }[k];
    flow(ctx, map, 430, 370, 1050, 140, k === "sre" ? C.amber : C.cyan);
    panel(ctx, 520, 610, 860, 120, "rgba(12,38,52,.88)", "rgba(39,217,255,.65)");
    text(ctx, k === "sre" ? "上线前必须压测，不满足门禁只允许灰度或限售" : "规则先定义清楚，前台才能销售，后台才能结算", 560, 680, 30, C.ink, 900, 780, 38, 2);
    return;
  }
  if (k === "hub" || k === "platform") {
    node(ctx, 825, 470, 270, 130, k === "hub" ? "商品主对象" : "云商品 Agent", k === "hub" ? "交易事实源" : "业务工作台", C.cyan);
    const items = k === "hub"
      ? [["产品族", ""], ["售卖方案", ""], ["规格", ""], ["计量", ""], ["价格", ""], ["权益", ""], ["订单账单", ""]]
      : [["领域隔离", ""], ["工具链", ""], ["权限", ""], ["路由", ""], ["OpenUI", ""], ["评测", ""], ["审计", ""]];
    items.forEach((it, i) => {
      const a = -Math.PI / 2 + i * Math.PI * 2 / items.length;
      const x = 960 + Math.cos(a) * 355, y = 535 + Math.sin(a) * 240;
      node(ctx, x - 74, y - 38, 148, 76, it[0], "", i % 3 === 0 ? C.green : C.cyan);
      arrow(ctx, x - Math.cos(a) * 76, y - Math.sin(a) * 40, 960 + Math.cos(a) * 140, 535 + Math.sin(a) * 72, C.line);
    });
    return;
  }
  const rows = {
    lineage: [["主数据源", "字段归属", "渠道消费", "订单账单", "变更巡检"], ["官网", "控制台", "云市场", "销售报价", "客服解释"]],
    swimlane: [["产品", "定义", "商品化", "发布", "复盘"], ["财务", "成本", "毛利", "收入", "审批"], ["SRE", "容量", "告警", "灰度", "事件"]],
    channels: [["主数据", "官网", "控制台", "云市场", "销售"], ["交易", "订单", "合同", "账单", "客服"]],
    solution: [["客户", "预算", "行业", "组合", "报价"], ["方案", "计算", "存储", "数据库", "网络"]],
    finance: [["目标", "GMV", "净收入", "毛利", "风险"], ["口径", "资源包", "折扣", "递延", "争议"]],
    customer: [["买前", "估算", "权益", "超额", "确认"], ["买后", "用量", "抵扣", "账单", "解释"]],
    risk: [["变更", "客户", "合同", "权益", "账单"], ["治理", "审批", "通知", "回滚", "复盘"]],
    radar: [["巡检", "官网", "订单", "计量", "账单"], ["续约", "用量", "争议", "事件", "扩容"]],
    roles: [["老板", "目标", "毛利", "风险", "负责人"], ["团队", "产品", "财务", "销售", "客服"]],
    cases: [["ECS GPU", "容量", "地域", "交付", "经营"], ["Seedance", "资源包", "促销", "队列", "账单"], ["Agent Plan", "权益", "超额", "毛利", "体验"]],
  }[k] || [["业务链路", "定义", "发布", "交易", "经营"]];
  rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      node(ctx, 430 + c * 205, 310 + r * 155, 175, 100, cell, c === 0 ? "业务线" : "", c === 0 ? C.red : C.cyan);
      if (c < row.length - 1) arrow(ctx, 605 + c * 205, 360 + r * 155, 630 + c * 205, 360 + r * 155, C.cyan);
    });
  });
}

function sideActions(ctx, slide) {
  panel(ctx, 1510, 255, 360, 500, "rgba(8,25,38,.88)", "rgba(39,217,255,.65)", 14);
  text(ctx, "动作清单", 1550, 312, 31, C.cyan, 900);
  const actions = [
    ["定责", "负责人 / 交付物"],
    ["补口径", "数据 / 审批"],
    ["发话术", "渠道 / 客户"],
    ["做巡检", "监控 / 回滚"],
  ];
  actions.forEach((a, i) => {
    const y = 365 + i * 86;
    ctx.fillStyle = i === 0 ? C.red : C.cyan;
    ctx.beginPath(); ctx.arc(1560, y + 16, 18, 0, Math.PI * 2); ctx.fill();
    text(ctx, String(i + 1), 1551, y + 25, 18, "#fff", 900);
    text(ctx, a[0], 1592, y + 12, 24, C.ink, 850, 118, 30, 1);
    text(ctx, a[1], 1592, y + 42, 18, C.muted, 650, 180, 24, 1);
  });
}

function render(slide) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  bg(ctx);
  header(ctx, slide);
  leftRisk(ctx, slide);
  visual(ctx, slide);
  sideActions(ctx, slide);
  bottomBar(ctx, slide);
  const file = `slide-${String(slide.no).padStart(2, "0")}.png`;
  fs.writeFileSync(path.join(slideDir, file), canvas.toBuffer("image/png"));
  return {
    no: slide.no,
    title: slide.title,
    section: slide.section,
    file,
    style_reference: "dark presales solution infographic, dense workflow, cyan main flow, red risk emphasis",
  };
}

const manifest = slides.map(render);
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>云商品平台工作手册 · 高密度售前PPT</title><style>body{margin:0;background:#03070d;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.wrap{max-width:1440px;margin:0 auto;padding:38px 24px}h1{font-size:30px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:22px}.card{background:#081421;border:1px solid rgba(39,217,255,.25);border-radius:14px;padding:12px}.card img{width:100%;display:block;border-radius:8px}.card p{margin:10px 4px 0;color:#b8c6d6;font-size:14px}</style></head><body><div class="wrap"><h1>云商品平台产品工作手册 · 高密度售前方案PPT</h1><div class="grid">${manifest.map((s) => `<div class="card"><img src="./slides/${s.file}" alt="${s.title}"/><p>${String(s.no).padStart(2, "0")} · ${s.title}</p></div>`).join("")}</div></div></body></html>`;
fs.writeFileSync(path.join(outDir, "index.html"), html);
console.log(`generated ${manifest.length} dense slides in ${slideDir}`);
