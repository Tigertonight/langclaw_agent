import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const articleDir = path.join(root, "docs/cloud-commodity-workbook-article");
const sourcePath = path.join(articleDir, "source/source.md");
const outPath = path.join(articleDir, "article/article.html");

const source = fs.readFileSync(sourcePath, "utf8");

const glossary = new Map([
  ["Metering Record", "计量记录"],
  ["Product", "商品主对象"],
  ["Offer", "售卖方案"],
  ["SKU", "可购买规格"],
  ["Meter", "计量项"],
  ["Price", "价格规则"],
  ["Entitlement", "权益规则"],
  ["Region", "可售地域"],
  ["Subscription", "订阅关系"],
  ["Marketplace", "云市场"],
  ["GTM", "上市打法"],
  ["SRE", "稳定性保障"],
  ["PM", "产品经理"],
  ["PRD", "产品需求文档"],
  ["SLA", "服务等级承诺"],
  ["SLO", "服务稳定性目标"],
  ["GMV", "成交规模"],
  ["ARR", "年度经常性收入"],
  ["MRR", "月度经常性收入"],
  ["Pipeline", "销售机会池"],
  ["ready", "具备技术条件"],
  ["readiness review", "就绪评审"],
  ["FAQ", "常见问题说明"],
  ["Domain Pack", "领域能力包"],
  ["OpenUI", "结构化展示界面"],
  ["Eval", "评测"],
]);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function inlineMd(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return out;
}

function businessText(text) {
  let out = text;
  for (const [from, to] of glossary) {
    out = out.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), to);
  }
  out = out
    .replaceAll("readiness", "就绪")
    .replaceAll("mock", "演示")
    .replaceAll("demo", "演示")
    .replaceAll("Subagent", "专项审查")
    .replaceAll("subagent", "专项审查")
    .replaceAll("TODO", "待办");
  return out;
}

function markdownToHtml(md, { appendix = false } = {}) {
  const lines = businessText(md).split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let list = null;
  let code = false;
  let table = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inlineMd(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((row) => !/^\s*\|?\s*-{3,}/.test(row));
    if (rows.length) {
      html.push("<div class=\"table-wrap\"><table>");
      rows.forEach((row, index) => {
        const cells = row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim());
        html.push(index === 0 ? "<thead><tr>" : index === 1 ? "<tbody><tr>" : "<tr>");
        for (const cell of cells) {
          html.push(index === 0 ? `<th>${inlineMd(cell)}</th>` : `<td>${inlineMd(cell)}</td>`);
        }
        html.push(index === 0 ? "</tr></thead>" : "</tr>");
      });
      if (rows.length > 1) html.push("</tbody>");
      html.push("</table></div>");
    }
    table = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      flushTable();
      if (!code) {
        code = true;
        html.push("<pre><code>");
      } else {
        code = false;
        html.push("</code></pre>");
      }
      continue;
    }
    if (code) {
      html.push(escapeHtml(line) + "\n");
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }
    if (/^\s*\|.+\|\s*$/.test(line)) {
      flushParagraph();
      flushList();
      table.push(line);
      continue;
    }
    flushTable();
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(6, appendix ? heading[1].length + 2 : heading[1].length + 1);
      html.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${inlineMd(line.replace(/^\s*>\s?/, ""))}</blockquote>`);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      if (list !== "ul") {
        flushList();
        list = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${inlineMd(bullet[1])}</li>`);
      continue;
    }
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      flushParagraph();
      if (list !== "ol") {
        flushList();
        list = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${inlineMd(ordered[1])}</li>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  flushTable();
  return html.join("\n");
}

const sections = [
  {
    id: "01",
    title: "阅读地图与最小产出包",
    lead: "先建立读法，再开始学习。产品经理需要知道本手册适合速读、入门和项目实战三种路径，并在第一周交付一组能被上下游评审的工作件。",
    points: [
      ["30 分钟速读", "术语速查、主数据关系、生命周期作业卡和三条案例。"],
      ["2 小时入门", "精读主数据、产品化、财务、稳定性保障、客户解释，并试填一个虚拟商品。"],
      ["项目实战", "围绕真实商品查阅产品化、建模、渠道、报价、巡检和复盘模板。"],
      ["最小产出", "产品化定义、商品模型图、报价前检查、发布后巡检表和客户解释话术。"],
    ],
  },
  {
    id: "02",
    title: "概念边界：能力、产品、商品",
    lead: "技术能力解决“能不能做”，产品定义解决“面向谁、解决什么问题”，云商品解决“如何售卖、交付、计量、结算和解释”。这三个层次必须分清。",
    points: [
      ["能力", "底层技术或资源，例如模型、算力、存储、网络能力。"],
      ["产品", "面向目标客户和场景的能力组合，有边界、承诺、交付物和验收标准。"],
      ["商品", "可被订购、计量、定价、开票、续约和治理的商业对象。"],
      ["判断标准", "研发具备技术条件之后，还要通过产品化定义、成本、服务承诺和交付能力评审。"],
    ],
  },
  {
    id: "03",
    title: "产品化定义与就绪评审",
    lead: "商品化之前先做产品化定义。评审要回答目标客户、核心场景、能力边界、不可承诺项、成本输入、服务等级承诺初稿和交付物是否清楚。",
    points: [
      ["交付物", "一页产品定义、能力边界清单、不可承诺项、成本输入、服务等级承诺草案。"],
      ["负责人", "产品经理牵头，研发、稳定性保障、财务、法务和销售方案共同校准。"],
      ["阻塞点", "目标客户不清、成本不可测、服务承诺过满、交付链路没有责任人。"],
      ["案例", "Seedance Mini 这类模型能力，需要先定义自助购买边界，再进入商品建模。"],
    ],
  },
  {
    id: "04",
    title: "商品主数据模型",
    lead: "商品主数据是交易和账单的共同语言。它把商品主对象、售卖方案、可购买规格、计量项、价格规则、权益规则、地域、订阅、订单、账单和发票连接在一起。",
    points: [
      ["主对象", "回答卖的是什么。"],
      ["售卖方案", "回答怎么卖，例如按量、包月、资源包、企业套餐。"],
      ["可购买规格", "回答客户买哪一档、哪种配置、哪组能力。"],
      ["计量与价格", "记录用量事实，并在合同、地域、生效时间等上下文中转成金额。"],
    ],
  },
  {
    id: "05",
    title: "主数据治理与血缘",
    lead: "主数据治理关注字段源头、维护责任、消费系统、变更影响和审计记录。官网、控制台、销售报价、订单、合同、账单和客服解释都应该消费同一套事实。",
    points: [
      ["治理五问", "字段是谁维护、谁消费、何时生效、影响谁、如何回滚。"],
      ["高风险字段", "价格、地域、服务承诺、权益额度、资源包抵扣、合同折扣和计量单位。"],
      ["变更步骤", "先做影响分析，再出审批摘要，最后同步渠道和客户解释。"],
      ["输出", "主数据血缘图、字段归属表、下游消费清单和变更审计记录。"],
    ],
  },
  {
    id: "06",
    title: "售卖方案、规格、计量和价格设计",
    lead: "售卖方案决定商业包装，可购买规格决定客户选择，计量项记录使用事实，价格规则把使用事实转成金额。四者不一致时，订单、账单和客户解释都会出问题。",
    points: [
      ["售卖方案类型", "按量、包月、资源包、试用包、企业套餐、超额付费。"],
      ["设计步骤", "先确定客户购买方式，再定义规格和计量口径，最后补价格和互斥规则。"],
      ["冲突检查", "免费额度、资源包、促销价、合同折扣和超额付费是否能叠加。"],
      ["风险", "销售承诺和系统规则不一致，账单解释会变成售后争议。"],
    ],
  },
  {
    id: "07",
    title: "套餐型产品与权益治理",
    lead: "套餐型产品的难点在权益规则。每天发多少额度、怎么消耗、何时过期、退订后如何处理、超额是否二次确认，都会影响毛利、法务和客户体验。",
    points: [
      ["额度发放", "明确发放周期、额度单位、适用地域和有效期。"],
      ["消耗顺序", "先消耗赠送额度、资源包还是合同额度，需要可解释。"],
      ["超额规则", "客户是否需要二次确认，是否自动扣费，账单如何展示。"],
      ["客户解释", "权益过期、退订、退款和失败扣费都要提前准备话术。"],
    ],
  },
  {
    id: "08",
    title: "产品生命周期全流程",
    lead: "云商品生命周期从产品化定义开始，经过商品建模、渠道发布、上市准备、销售报价、订单交付、计量账单、发布后巡检、续约和复盘。",
    points: [
      ["产品化", "定义目标客户、能力边界、成本和服务承诺。"],
      ["商品化", "补齐主数据、售卖方案、规格、计量、价格和权益。"],
      ["发布与销售", "同步官网、控制台、云市场、销售方案和禁承诺项。"],
      ["运营闭环", "巡检订单、计量、账单、客户反馈、续约和经营健康度。"],
    ],
  },
  {
    id: "09",
    title: "渠道发布与上下游协同",
    lead: "官网、控制台、云市场、销售报价、客服和账单是不同渠道和消费方。渠道发布不是复制文案，而是把同一套主数据转换成不同角色可理解的视图。",
    points: [
      ["上游", "研发、成本、容量、法务、稳定性保障提供能力和边界。"],
      ["下游", "官网、控制台、销售、客服、订单、账单消费字段。"],
      ["一致性原则", "价格、地域、规格、权益和服务承诺需要统一来源。"],
      ["最低标准", "渠道字段可见性、禁展示项、发布状态、责任人和回滚口径清楚。"],
    ],
  },
  {
    id: "10",
    title: "上市打法、销售方案与报价前检查",
    lead: "上市打法把商品带到目标客户、行业场景和销售动作里。正式报价前必须确认价格、容量、服务承诺、折扣权限、合同边界和客户解释。",
    points: [
      ["目标客户", "明确行业、规模、预算、合规要求和购买路径。"],
      ["方案组合", "计算、存储、数据库、网络和 AI 服务按场景组合。"],
      ["报价检查", "估算、草稿和正式报价要分清，价格和合同边界要可追溯。"],
      ["禁承诺项", "不可承诺固定产能、无限容量、未审批折扣或未确认服务等级。"],
    ],
  },
  {
    id: "11",
    title: "财务商业化与经营口径",
    lead: "成交规模不等于健康收入。产品经理需要理解净收入、毛利、收入确认、递延收入、资源包消耗、免费额度成本和折扣叠加风险。",
    points: [
      ["经营指标", "成交规模、净收入、毛利率、活跃客户、争议金额、续约风险。"],
      ["收入确认", "按量、包月、资源包和权益型产品的确认方式不同。"],
      ["毛利风险", "免费额度、高成本模型、促销和合同折扣可能击穿毛利底线。"],
      ["财务问题", "价格是否覆盖成本、折扣是否审批、发票和税务口径是否清楚。"],
    ],
  },
  {
    id: "12",
    title: "稳定性上架门禁",
    lead: "稳定性保障不是发布后的补救动作，而是云商品上架前的门禁。容量、限流、告警、灰度、回滚、客户通知和服务承诺边界都要前置确认。",
    points: [
      ["容量", "地域、资源池、峰值、排队和扩容计划。"],
      ["监控", "失败率、延迟、队列深度、用量异常、资源池健康度。"],
      ["灰度和回滚", "发布比例、触发阈值、回滚步骤、客户沟通。"],
      ["销售同步", "容量不足时调整可售地域、交付窗口和销售话术。"],
    ],
  },
  {
    id: "13",
    title: "客户自助购买与售后解释",
    lead: "自助购买场景要把估算、正式报价、额度、超额、过期、失败扣费和账单差异讲清楚。客户能理解，售后争议才会少。",
    points: [
      ["买前确认", "购买内容、权益额度、有效期、计量单位、超额规则。"],
      ["买后解释", "为什么账单高于估算、为什么额度过期、为什么某地域不可售。"],
      ["权限边界", "客户只能看到自己的订单、账单、发票和权益。"],
      ["话术原则", "用客户语言解释，不暴露系统字段和内部表名。"],
    ],
  },
  {
    id: "14",
    title: "异常链路、反向链路与治理",
    lead: "真实平台里大量工作来自变更和异常：调价、规格下线、权益调整、退款、退订、合同变更、计量异常和账单争议。反向链路需要更强的影响分析。",
    points: [
      ["影响对象", "客户、合同、订单、权益、账单、发票、渠道展示和客服话术。"],
      ["保护策略", "存量客户保护、灰度变更、版本兼容和回滚窗口。"],
      ["审批摘要", "变更原因、影响范围、风险等级、负责人、回滚方案。"],
      ["治理记录", "所有高风险变更都需要审计和复盘。"],
    ],
  },
  {
    id: "15",
    title: "发布后巡检、续约与客户成功",
    lead: "上架成功只代表按钮可见，业务健康需要看订单、交付、计量、账单、客户反馈、告警、续约概率和扩容机会。",
    points: [
      ["24 小时巡检", "官网、控制台、订单、交付、计量、账单、客服、告警。"],
      ["健康日报", "成交、交付、失败、争议、容量、客户反馈和待办。"],
      ["续约雷达", "用量健康、账单争议、服务事件、满意度、续约概率。"],
      ["增长机会", "扩容、升级、行业方案复用和客户成功动作。"],
    ],
  },
  {
    id: "16",
    title: "组织层级、指标与外部客户场景",
    lead: "同一套数据在不同角色眼里代表不同决策。老板看目标达成和风险，财务看收入和毛利，稳定性团队看容量和告警，销售看客户和报价，客户看购买和账单解释。",
    points: [
      ["老板", "成交规模、净收入、毛利、风险、目标达成和负责人。"],
      ["产品", "覆盖率、能力边界、渠道一致性、商品健康度。"],
      ["销售", "机会池、报价、合同、客户风险和下一步动作。"],
      ["客户", "预算、购买、用量、账单、发票、续费和售后解释。"],
    ],
  },
  {
    id: "17",
    title: "平台实现视角：领域化的 Agent 系统",
    lead: "平台实现不是写死案例答案，而是用领域能力包、资源注册、权限、路由、工具、结构化展示、评测和审计，把云商品业务事实接入 Agent 工作流。",
    points: [
      ["领域隔离", "云商品和其他业务域有独立数据、意图、权限和展示策略。"],
      ["查询与工具", "通用查询承接数据问答，专用工具承接估算、评审、审批摘要和模拟。"],
      ["展示契约", "优先输出业务结论、关键指标、风险、负责人、后续动作和证据。"],
      ["安全边界", "写入类动作只生成草稿、审批摘要和模拟计划。"],
    ],
  },
  {
    id: "18",
    title: "三条完整案例",
    lead: "ECS GPU、Seedance Mini 和 Agent Plan 分别代表资源型商品、AI 视频资源包和套餐权益型产品。三条案例帮助读者把概念、主数据、渠道、销售、交付和经营串起来。",
    points: [
      ["ECS GPU", "重点看容量、地域、包月价格、金融客户方案和交付延期影响。"],
      ["Seedance Mini", "重点看模型能力产品化、自助购买、资源包、促销和大促稳定性。"],
      ["Agent Plan", "重点看套餐承诺、权益发放、超额确认、毛利和客户体验。"],
      ["复盘", "每条案例都沉淀为下一次商品上架模板。"],
    ],
  },
  {
    id: "19",
    title: "学习成果验收与可复制模板",
    lead: "学习成果要能被验收：概念说得清，流程画得出，案例讲得完整，模板能落地填写。模板包是把学习转为项目推进的工具。",
    points: [
      ["概念验收", "解释主数据实体、售卖方案、计量、价格、权益和渠道关系。"],
      ["流程验收", "从能力到商品，从发布到经营，从异常到复盘。"],
      ["产出物", "产品化定义、商品模型、报价检查、巡检表、变更分析、经营简报。"],
      ["通过标准", "能带着模板组织一次跨角色评审。"],
    ],
  },
  {
    id: "20",
    title: "附录：详细章节与可复制模板",
    lead: "附录保留详细章节和可复制模板。正文用于建立学习路径，附录用于查阅具体清单、模板和案例。",
    points: [
      ["详细章节", "保留主数据、生命周期、财务治理和平台案例的展开内容。"],
      ["模板", "保留可复制模板和填写样例，便于真实项目直接套用。"],
      ["查阅方式", "先看正文判断阶段，再到附录找对应模板和清单。"],
      ["用法", "真实项目中把附录作为评审材料和复盘基线。"],
    ],
  },
];

const sectionGroups = [
  {
    id: "part-1",
    title: "第一篇：从技术能力到可售产品",
    brief: "先判断能力是否能产品化，再定义客户、边界、成本和服务承诺。",
    sections: ["01", "02", "03"],
  },
  {
    id: "part-2",
    title: "第二篇：从商品主数据到多渠道交易",
    brief: "用统一主数据承接售卖方案、规格、计量、价格、权益和渠道发布。",
    sections: ["04", "05", "06", "07", "08", "09"],
  },
  {
    id: "part-3",
    title: "第三篇：从销售交付到经营治理",
    brief: "把上市、报价、财务、稳定性、客户解释、异常和续约串成经营闭环。",
    sections: ["10", "11", "12", "13", "14", "15"],
  },
  {
    id: "part-4",
    title: "第四篇：从组织协同到平台化 Agent",
    brief: "让不同角色围绕同一套事实协作，并沉淀为 Agent 工作台能力。",
    sections: ["16", "17", "18", "19", "20"],
  },
];

const groupBySection = Object.fromEntries(
  sectionGroups.flatMap((group) => group.sections.map((id) => [id, group]))
);

const toc = sectionGroups
  .map(
    (group) => `<li class="toc-group"><span>${escapeHtml(group.title)}</span><ol>${group.sections
      .map((id) => {
        const section = sections.find((s) => s.id === id);
        return `<li><a href="#s${id}">${id} ${escapeHtml(section?.title ?? "")}</a></li>`;
      })
      .join("")}</ol></li>`
  )
  .join("\n");

const pmWorkCards = {
  "01": ["建立学习路径和最小产出包", "阅读路径、阶段清单、第一周产出包", "产品经理、导师、业务负责人", "只读概念不形成可评审材料", "能用 5 个产出物组织一次启动评审"],
  "02": ["分清能力、产品、商品的边界", "三层边界说明、判断标准", "产品经理、研发、销售方案", "把技术能力直接包装成商品", "能解释为什么“能做”不等于“可售”"],
  "03": ["判断能力是否具备产品化条件", "产品化定义、边界清单、服务承诺草案", "产品经理、研发、财务、法务、SRE", "目标客户不清、成本不可测、服务承诺过满", "产品化交付物齐备后再进入商品建模"],
  "04": ["搭建交易和账单共同语言", "商品主数据表、实体关系图", "产品经理、商品中台、订单、账单", "商品、售卖方案、规格、计量和价格口径不一致", "下游渠道和账单能引用同一事实源"],
  "05": ["明确字段源头、归属和变更影响", "字段归属表、血缘图、变更影响清单", "产品经理、数据治理、渠道、财务", "价格、地域、权益、服务承诺变更无审批", "关键字段有维护方、消费方和回滚方案"],
  "06": ["设计可购买、可计量、可结算的售卖规则", "Offer 设计、SKU 清单、计量和价格规则", "产品经理、商业化、财务、订单账单", "促销、资源包、合同折扣和超额付费冲突", "客户可购买，后台可结算，客服可解释"],
  "07": ["定义套餐权益的发放、消耗和超额规则", "权益规则表、超额确认说明、账单解释话术", "产品经理、财务、法务、客服", "赠送额度成本失控或客户误解自动扣费", "权益、过期、退订、退款、超额规则可解释"],
  "08": ["把产品、财务、SRE、销售动作串成生命周期", "生命周期泳道、阶段门禁、责任人表", "产品经理、财务、SRE、销售、客户成功", "阶段交付物缺失导致上线后返工", "每阶段有负责人、交付物和异常出口"],
  "09": ["把同一套主数据发布为多渠道视图", "渠道发布矩阵、禁展示项、巡检清单", "产品经理、官网、控制台、销售、客服", "官网、控制台、销售报价和账单口径不一致", "各渠道字段来源、可见性和发布状态清楚"],
  "10": ["把商品转化为行业方案和销售动作", "GTM 包、报价前检查清单、禁承诺项", "产品经理、GTM、销售、财务、SRE", "销售承诺未审批折扣、容量或服务等级", "正式报价前完成价格、容量、合同边界检查"],
  "11": ["用经营口径判断收入健康", "经营指标口径、毛利风险清单、收入确认说明", "产品经理、财务、业务负责人", "只看 GMV 忽略净收入、毛利和递延收入", "能解释规模、收入、毛利和风险差异"],
  "12": ["把稳定性作为上架前置门禁", "SRE 门禁清单、灰度和回滚方案", "产品经理、SRE、客服、销售", "容量不足或告警缺失导致交付事故", "容量、限流、告警、灰度、回滚均已确认"],
  "13": ["让客户看懂购买、权益、超额和账单", "买前确认页、售后解释话术、权限过滤规则", "产品经理、客服、账单、法务", "估算被误认为正式报价，超额扣费引发争议", "客户可理解买了什么、用了什么、为什么收费"],
  "14": ["治理调价、退款、退订和规格变更", "变更影响分析、审批摘要、回滚和通知方案", "产品经理、财务、法务、客服、渠道", "存量合同、权益、账单和渠道展示被误伤", "变更影响对象、风险、审批和回滚清楚"],
  "15": ["用巡检和续约验证业务健康", "24 小时巡检表、续约风险雷达、客户成功动作", "产品经理、SRE、销售、客户成功", "上线后无人闭环订单、计量、账单和客户反馈", "发布后健康日报能驱动续约和复盘动作"],
  "16": ["让不同层级基于同一事实决策", "角色关注矩阵、指标口径、权限边界", "产品经理、老板、财务、销售、客户", "不同角色看到不同口径导致决策偏差", "每类角色有清楚指标、风险和下一步动作"],
  "17": ["把手册沉淀为领域化 Agent 能力", "领域能力包、工具清单、展示契约、评测样例", "产品经理、研发、算法、数据、评测", "写死演示答案或跨业务域混淆", "查询、评审、估算、审批摘要均走领域链路"],
  "18": ["用三类商品验证方法论可落地", "ECS GPU、Seedance Mini、Agent Plan 演示链路", "产品经理、销售、财务、SRE、客户成功", "案例只是点状问题，没有串成闭环", "每条案例能跑通产品化到经营复盘"],
  "19": ["把学习成果转为可复制模板", "验收清单、模板包、复盘材料", "产品经理、导师、评审人", "只有知识总结，没有可复用作业资产", "能用模板组织跨角色评审和复盘"],
  "20": ["保留详细资料和项目落地模板", "附录章节、模板索引、查阅说明", "产品经理、项目团队", "附录过重影响主线阅读", "正文看主线，附录查细节"],
};

const caseApplicability = {
  default: [
    ["ECS GPU", "资源型商品，重点看容量、地域、交付、服务等级和合同价。"],
    ["Seedance Mini", "资源包/能力型商品，重点看自助购买、促销、大促队列和账单解释。"],
    ["Agent Plan", "套餐权益型商品，重点看额度、过期、超额、退款退订和毛利。"],
  ],
  "03": [
    ["ECS GPU", "先确认 GPU 资源池、地域和交付窗口能否支撑产品承诺。"],
    ["Seedance Mini", "先定义模型能力边界、自助购买范围和不可承诺项。"],
    ["Agent Plan", "先定义套餐承诺、权益口径和高成本能力边界。"],
  ],
  "04": [
    ["ECS GPU", "主数据重点是地域、规格、资源池、包月价和服务等级。"],
    ["Seedance Mini", "主数据重点是资源包、生成计量、促销和购买页字段。"],
    ["Agent Plan", "主数据重点是套餐、权益、消耗顺序、超额确认和续费。"],
  ],
  "11": [
    ["ECS GPU", "关注包月收入、GPU 成本、折扣审批和交付延期影响。"],
    ["Seedance Mini", "关注资源包收入、促销抵扣、生成成本和账单争议。"],
    ["Agent Plan", "关注免费额度、高成本模型调用、超额收入和毛利底线。"],
  ],
  "18": [
    ["ECS GPU", "从容量评审到金融客户方案，再到交付延期经营影响。"],
    ["Seedance Mini", "从模型能力产品化到自助购买、大促、账单解释。"],
    ["Agent Plan", "从套餐权益设计到超额确认、毛利和续约风险。"],
  ],
};

function pointsTable(section) {
  return `<div class="table-wrap"><table><thead><tr><th>关注点</th><th>业务含义</th></tr></thead><tbody>${section.points
    .map(([a, b]) => `<tr><td>${escapeHtml(a)}</td><td>${escapeHtml(b)}</td></tr>`)
    .join("")}</tbody></table></div>`;
}

function executiveSummaryBlock() {
  const items = [
    ["产品定义清楚", "先判断技术能力是否具备产品化条件，明确客户、边界、成本和服务承诺。"],
    ["商品主数据统一", "用商品、售卖方案、规格、计量、价格和权益规则支撑全渠道交易。"],
    ["交易经营闭环", "从渠道发布、销售报价、订单交付、计量账单到续约复盘形成闭环。"],
    ["组织协同可治理", "产品、财务、SRE、销售、客服和老板基于同一套事实做不同决策。"],
  ];
  return `<div class="executive-summary" aria-label="执行摘要">
    <div class="block-kicker">执行摘要 / 一页看懂</div>
    <h2>云商品平台解决的是从技术能力到收入、交付、账单和续约的经营闭环</h2>
    <div class="executive-grid">${items
      .map(([title, desc]) => `<div class="executive-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(desc)}</span></div>`)
      .join("")}</div>
    <div class="reading-path"><strong>阅读路径</strong><span>30 分钟看执行摘要和 4 大篇章；2 小时看主数据、生命周期和经营治理；项目落地时按章节作业卡补交付物。</span></div>
  </div>`;
}

function groupDivider(group) {
  return `<div class="chapter-group" id="${group.id}"><div class="chapter-group-index">${escapeHtml(group.title.split("：")[0])}</div><h2>${escapeHtml(group.title.split("：")[1])}</h2><p>${escapeHtml(group.brief)}</p></div>`;
}

function pmWorkCard(section) {
  const [problem, deliverable, collaborators, risk, acceptance] = pmWorkCards[section.id];
  const items = [
    ["解决问题", problem],
    ["PM 交付物", deliverable],
    ["协作方", collaborators],
    ["关键风险", risk],
    ["验收标准", acceptance],
  ];
  return `<div class="pm-work-card"><div class="block-kicker">产品经理作业卡</div><div class="pm-work-grid">${items
    .map(([label, value]) => `<div class="pm-work-item ${label === "关键风险" ? "is-risk" : ""}"><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></div>`)
    .join("")}</div></div>`;
}

function caseThreadStrip(section) {
  const items = caseApplicability[section.id] ?? caseApplicability.default;
  return `<div class="case-thread-strip"><div class="block-kicker">三类商品差异</div><div class="case-thread-grid">${items
    .map(([name, desc]) => `<div class="case-thread-card"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(desc)}</span></div>`)
    .join("")}</div></div>`;
}

function diagramCard(title, body, kind = "") {
  return `<div class="raw diagram-card ${kind}"><div class="raw-title">${escapeHtml(title)}</div>${body}</div>`;
}

function step(items) {
  return `<div class="diagram-step">${items
    .map(([title, desc], i) => `<div class="diagram-node"><i>${String(i + 1).padStart(2, "0")}</i><strong>${escapeHtml(title)}</strong><span>${escapeHtml(desc)}</span></div>`)
    .join("")}</div>`;
}

function matrix(rows) {
  return `<div class="diagram-matrix">${rows
    .map((row) => `<div class="matrix-row">${row.map((cell, i) => `<div class="matrix-cell ${i === 0 ? "matrix-head" : ""}">${escapeHtml(cell)}</div>`).join("")}</div>`)
    .join("")}</div>`;
}

const htmlBlocks = {
  "02": diagramCard(
    "能力、产品、商品三层边界",
    step([
      ["技术能力", "资源、模型、算法或服务能力。"],
      ["产品定义", "目标客户、核心场景、能力边界和服务承诺。"],
      ["可售商品", "可订购、可计量、可定价、可开票和可续约。"],
    ]),
    "flow"
  ),
  "04": diagramCard(
    "商品主数据如何驱动交易、账单和渠道",
    `<div class="source-map">
      <div class="source-center"><strong>商品主数据</strong><span>商品 / 售卖方案 / 规格 / 计量 / 价格 / 权益</span></div>
      ${[
        ["官网", "营销介绍、价格提示、购买入口"],
        ["控制台", "购买字段、可售地域、订阅状态"],
        ["销售报价", "方案组合、折扣边界、合同价"],
        ["订单合同", "订购关系、生效时间、客户主体"],
        ["计量账单", "用量、抵扣、应收、发票"],
        ["客服解释", "客户可见口径、争议处理话术"],
      ].map(([a, b]) => `<div class="source-node"><strong>${escapeHtml(a)}</strong><span>${escapeHtml(b)}</span></div>`).join("")}
    </div>`,
    "entity"
  ),
  "08": diagramCard(
    "产品生命周期：横向流程 + 角色泳道",
    matrix([
      ["角色", "产品化", "商品建模", "渠道发布", "销售交付", "巡检复盘"],
      ["产品", "客户/边界", "主数据", "购买页", "交付反馈", "模板沉淀"],
      ["财务", "成本输入", "毛利底线", "折扣边界", "收入确认", "健康解释"],
      ["稳定性", "容量判断", "告警阈值", "灰度方案", "事件处理", "门禁优化"],
      ["销售", "目标客群", "方案包", "报价检查", "合同推进", "续约动作"],
    ]),
    "swimlane"
  ),
  "09": diagramCard(
    "渠道发布矩阵：展示、禁展示和巡检",
    `<div class="publication-map">
      ${[
        ["官网", "展示卖点、适用场景、公开价格提示", "不展示未审批折扣、固定产能承诺"],
        ["控制台", "展示购买字段、地域、规格、订阅状态", "不展示客户不可见的内部成本和审批流"],
        ["云市场", "展示套餐、服务说明、合同入口", "不展示未生效 SKU 或灰度能力"],
        ["销售报价", "展示方案组合、折扣边界、正式报价前检查", "不承诺未确认容量和服务等级"],
        ["客服解释", "展示用量、抵扣、账单差异和发票状态", "不暴露内部表名和工程字段"],
      ].map(([channel, show, hide]) => `<div class="publication-card"><strong>${escapeHtml(channel)}</strong><span><b>可展示：</b>${escapeHtml(show)}</span><span class="risk"><b>禁展示：</b>${escapeHtml(hide)}</span></div>`).join("")}
      <div class="publication-footer">发布后巡检：官网、控制台、报价、订单、账单和客服口径必须一致。</div>
    </div>`,
    "channels"
  ),
  "11": diagramCard(
    "财务经营口径：成交规模只是起点",
    `<div class="finance-flow">
      ${[
        ["GMV", "客户成交和 pipeline 进度"],
        ["净收入", "扣除资源包、抵扣、促销和合同折扣"],
        ["毛利", "叠加资源成本、免费额度和高成本能力调用"],
        ["递延收入", "资源包、包月和权益消耗的确认节奏"],
        ["经营风险", "账单争议、容量阻塞、续约流失和折扣越权"],
      ].map(([a, b], i) => `<div class="finance-node ${i === 4 ? "risk" : ""}"><strong>${escapeHtml(a)}</strong><span>${escapeHtml(b)}</span></div>`).join("")}
    </div>`,
    "health"
  ),
  "12": diagramCard(
    "稳定性上架门禁",
    step([
      ["容量", "地域资源池和可售范围。"],
      ["限流", "峰值保护和大促策略。"],
      ["告警", "失败率、队列、延迟阈值。"],
      ["灰度", "按客户、地域和渠道放量。"],
      ["回滚", "触发条件、客户通知和止损动作。"],
    ]),
    "flow"
  ),
  "14": diagramCard(
    "异常治理：从变更触发到回滚通知",
    `<div class="exception-flow">
      ${[
        ["变更触发", "调价、退款、退订、规格下线、权益调整"],
        ["影响对象", "客户、合同、订单、权益、账单、发票、渠道"],
        ["风险判断", "存量客户保护、毛利、合规、客户体验"],
        ["审批摘要", "原因、范围、负责人、风险等级、时间窗口"],
        ["回滚通知", "回滚步骤、客户沟通、客服话术、复盘记录"],
      ].map(([a, b], i) => `<div class="exception-node ${i === 2 ? "is-risk" : ""}"><i>${String(i + 1).padStart(2, "0")}</i><strong>${escapeHtml(a)}</strong><span>${escapeHtml(b)}</span></div>`).join("")}
    </div>`,
    "impact"
  ),
  "18": diagramCard(
    "三条完整演示链路",
    `<div class="storyline-grid">
      ${[
        ["ECS GPU", "产品化：GPU 资源和地域边界", "商品化：规格、包月价、SLA", "经营：容量风险、交付延期、金融客户方案"],
        ["Seedance Mini", "产品化：模型能力和不可承诺项", "商品化：资源包、促销、购买页字段", "经营：大促队列、账单解释、客户反馈"],
        ["Agent Plan", "产品化：套餐承诺和能力边界", "商品化：权益发放、消耗、超额确认", "经营：毛利、退款退订、续约风险"],
      ].map(([name, a, b, c]) => `<div class="storyline-card"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(a)}</span><span>${escapeHtml(b)}</span><span>${escapeHtml(c)}</span></div>`).join("")}
    </div>`,
    "case-matrix"
  ),
};

function rawFor(section) {
  if (htmlBlocks[section.id]) return htmlBlocks[section.id];
  if (["01", "08", "18"].includes(section.id)) {
    return `<div class="raw"><div class="raw-title">本节阅读路径</div><div class="rail">${section.points
      .map(([a, b], i) => `<div class="rail-card"><i>${String(i + 1).padStart(2, "0")}</i><strong>${escapeHtml(a)}</strong><span>${escapeHtml(b)}</span></div>`)
      .join("")}</div></div>`;
  }
  if (["04", "05", "09", "17"].includes(section.id)) {
    return `<div class="raw"><div class="raw-title">关系图</div><div class="node-map">${section.points
      .map(([a, b]) => `<div class="node"><strong>${escapeHtml(a)}</strong><span>${escapeHtml(b)}</span></div>`)
      .join("")}</div></div>`;
  }
  return "";
}

const sectionHtml = sections
  .map((section, index) => {
    const group = groupBySection[section.id];
    const shouldShowGroup = index === 0 || groupBySection[sections[index - 1]?.id]?.id !== group.id;
    return `${shouldShowGroup ? groupDivider(group) : ""}<section id="s${section.id}">
  <div class="section-head"><div class="index">${section.id}</div><div><div class="section-part">${escapeHtml(group.title)}</div><h2>${escapeHtml(section.title)}</h2></div></div>
  <p class="section-lead">${escapeHtml(section.lead)}</p>
  ${pmWorkCard(section)}
  ${rawFor(section)}
  ${section.id !== "20" ? caseThreadStrip(section) : ""}
  ${pointsTable(section)}
</section>`;
  })
  .join("\n");

function extractSource(fileName, title) {
  const marker = `# 来源文件：${fileName}`;
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const contentStart = source.indexOf("\n\n", start);
  if (contentStart < 0) return "";
  const next = source.indexOf("\n# 来源文件：", contentStart + 2);
  const raw = source.slice(contentStart + 2, next < 0 ? source.length : next);
  const cleaned = raw.replace(/\n---\s*$/m, "").trim();
  return `## ${title}\n\n${cleaned}\n`;
}

const sourceForAppendix = [
  extractSource("chapters/01-foundation-and-master-data.md", "详细章节：基础概念与商品主数据"),
  extractSource("chapters/02-lifecycle-channel-gtm.md", "详细章节：生命周期、渠道发布与上市打法"),
  extractSource("chapters/03-commercial-operations-governance.md", "详细章节：财务商业化与运营治理"),
  extractSource("chapters/04-cases-platform-and-templates.md", "详细章节：平台视角、案例与模板"),
  extractSource("templates/pm-copyable-templates.md", "附录模板：产品经理可复制模板"),
]
  .filter(Boolean)
  .join("\n\n");

const appendixHtml = markdownToHtml(sourceForAppendix, { appendix: true });

const css = fs.readFileSync(path.join(articleDir, "article/first-spread.html"), "utf8").match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

const extraCss = `
      .toc a { color: inherit; text-decoration: none; }
      .toc a:hover { color: var(--ra-color-accent); text-decoration: underline; }
      .toc > ol { padding-left: 0; list-style: none; }
      .toc-group { margin: 1rem 0 1.25rem; list-style: none; }
      .toc-group > span { display:block; color: var(--ra-color-fg); font-weight: 700; margin-bottom: .35rem; line-height:1.35; }
      .toc-group ol { padding-left: 1.1rem; }
      .toc-group li { margin: .42rem 0; }
      .section-lead { font-size: 1.08rem; color: var(--ra-color-fg); }
      .block-kicker { font-family: var(--ra-font-ui); color: var(--ra-color-accent); font-size: .82rem; font-weight: 700; margin-bottom: var(--ra-space-3); }
      .executive-summary { margin: var(--ra-space-7) 0; padding: var(--ra-space-5) 0; border-top: 1px solid var(--ra-color-line); border-bottom: 1px solid var(--ra-color-line); }
      .executive-summary h2 { font-size: clamp(1.45rem, 2.6vw, 2.1rem); max-width: 50rem; margin-bottom: var(--ra-space-5); }
      .executive-grid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: var(--ra-space-4); }
      .executive-card { border-left: 3px solid var(--ra-color-accent); padding: var(--ra-space-3); background: color-mix(in srgb, var(--ra-color-paper) 72%, transparent); }
      .executive-card strong { display:block; margin-bottom:.45rem; }
      .executive-card span { display:block; color: var(--ra-color-muted); font-family: var(--ra-font-ui); font-size:.9rem; line-height:1.6; }
      .reading-path { margin-top: var(--ra-space-5); padding: var(--ra-space-4); border: 1px solid var(--ra-color-line-soft); font-family: var(--ra-font-ui); color: var(--ra-color-muted); line-height:1.65; }
      .reading-path strong { color: var(--ra-color-fg); margin-right:.6rem; }
      .chapter-group { margin: var(--ra-space-7) 0 var(--ra-space-6); padding: var(--ra-space-5) 0; border-top: 2px solid var(--ra-color-fg); border-bottom: 1px solid var(--ra-color-line); }
      .chapter-group-index { font-family: var(--ra-font-ui); color: var(--ra-color-accent); font-size:.86rem; font-weight:700; margin-bottom:.65rem; }
      .chapter-group h2 { font-size: clamp(1.65rem, 3vw, 2.35rem); }
      .chapter-group p { max-width: 46rem; color: var(--ra-color-muted); font-family: var(--ra-font-ui); line-height:1.65; }
      .section-part { font-family: var(--ra-font-ui); color: var(--ra-color-muted); font-size:.82rem; margin-bottom:.35rem; }
      .pm-work-card { margin: var(--ra-space-5) 0; padding: var(--ra-space-4); border: 1px solid var(--ra-color-line); background: color-mix(in srgb, var(--ra-color-paper) 82%, transparent); }
      .pm-work-grid { display:grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: var(--ra-space-3); }
      .pm-work-item { border-top: 2px solid var(--ra-color-line); padding-top: var(--ra-space-3); font-family: var(--ra-font-ui); }
      .pm-work-item.is-risk { border-top-color: var(--ra-color-risk); }
      .pm-work-item b { display:block; font-size:.78rem; color: var(--ra-color-muted); margin-bottom:.4rem; }
      .pm-work-item span { display:block; font-size:.9rem; line-height:1.55; color: var(--ra-color-fg); }
      .case-thread-strip { margin: var(--ra-space-5) 0; padding: var(--ra-space-4) 0; border-top: 1px solid var(--ra-color-line-soft); border-bottom: 1px solid var(--ra-color-line-soft); }
      .case-thread-grid { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--ra-space-3); }
      .case-thread-card { padding: var(--ra-space-3); border-left: 2px solid var(--ra-color-line); font-family: var(--ra-font-ui); }
      .case-thread-card strong { display:block; color: var(--ra-color-fg); margin-bottom:.35rem; }
      .case-thread-card span { color: var(--ra-color-muted); font-size:.86rem; line-height:1.55; }
      .rail { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--ra-space-3); }
      .rail-card { border-left: 1px solid var(--ra-color-line); padding: var(--ra-space-3); min-height: 9rem; }
      .rail-card i { display:block; color: var(--ra-color-accent); font-family: var(--ra-font-ui); font-style: normal; font-size: .78rem; margin-bottom: .5rem; }
      .rail-card strong { display:block; margin-bottom: .35rem; }
      .rail-card span { color: var(--ra-color-muted); font-family: var(--ra-font-ui); font-size: .86rem; line-height: 1.6; }
      .node-map { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: var(--ra-space-3); }
      .node { border-top: 1px solid var(--ra-color-line); padding: var(--ra-space-3) 0; }
      .node strong { display:block; margin-bottom: .35rem; }
      .node span { color: var(--ra-color-muted); font-family: var(--ra-font-ui); font-size: .88rem; line-height:1.65; }
      .diagram-card { background: color-mix(in srgb, var(--ra-color-paper) 86%, transparent); }
      .diagram-step { display: grid; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr)); gap: var(--ra-space-3); align-items: stretch; }
      .diagram-node { position: relative; border: 1px solid var(--ra-color-line); background: var(--ra-color-paper); padding: var(--ra-space-4); min-height: 8.5rem; }
      .diagram-node:not(:last-child)::after { content: "→"; position: absolute; right: -.95rem; top: 50%; transform: translateY(-50%); color: var(--ra-color-accent); font-family: var(--ra-font-ui); font-weight: 700; background: var(--ra-color-paper); padding: 0 .25rem; }
      .diagram-node i { display: inline-block; font-family: var(--ra-font-ui); font-style: normal; color: var(--ra-color-accent); font-size: .78rem; margin-bottom: .45rem; }
      .diagram-node strong { display: block; font-size: 1.06rem; margin-bottom: .35rem; }
      .diagram-node span { display: block; color: var(--ra-color-muted); font-family: var(--ra-font-ui); font-size: .86rem; line-height: 1.55; }
      .entity-map, .channel-map, .impact-map { display: grid; gap: var(--ra-space-3); align-items: stretch; }
      .source-map { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: var(--ra-space-3); }
      .source-center { grid-column: 1 / -1; text-align:center; border:2px solid var(--ra-color-accent); background: color-mix(in srgb, var(--ra-color-accent) 8%, var(--ra-color-paper)); padding: var(--ra-space-4); font-family: var(--ra-font-ui); }
      .source-center strong { display:block; font-size:1.15rem; margin-bottom:.25rem; }
      .source-center span { color: var(--ra-color-muted); font-size:.86rem; }
      .source-node { border:1px solid var(--ra-color-line); background: var(--ra-color-paper); padding: var(--ra-space-3); font-family: var(--ra-font-ui); min-height:6.8rem; }
      .source-node strong { display:block; margin-bottom:.35rem; }
      .source-node span { color: var(--ra-color-muted); font-size:.84rem; line-height:1.5; }
      .entity-map { grid-template-columns: repeat(4, minmax(0, 1fr)); }
      .entity-center, .channel-source, .impact-center { border: 2px solid var(--ra-color-accent); background: color-mix(in srgb, var(--ra-color-accent) 8%, var(--ra-color-paper)); padding: var(--ra-space-4); font-family: var(--ra-font-ui); }
      .entity-center { grid-column: 2 / span 2; text-align: center; }
      .entity-center strong, .channel-source strong { display:block; font-size:1.1rem; margin-bottom:.25rem; }
      .entity-center span, .channel-source span { color: var(--ra-color-muted); font-size:.86rem; }
      .entity-node, .channel-node, .impact-node { border: 1px solid var(--ra-color-line); background: var(--ra-color-paper); padding: var(--ra-space-3); font-family: var(--ra-font-ui); text-align: center; min-height: 3.6rem; display:flex; align-items:center; justify-content:center; }
      .channel-map { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .channel-source { grid-column: 1 / -1; text-align:center; }
      .publication-map { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: var(--ra-space-3); font-family: var(--ra-font-ui); }
      .publication-card { border:1px solid var(--ra-color-line); background: var(--ra-color-paper); padding: var(--ra-space-3); min-height:8.5rem; }
      .publication-card strong { display:block; font-size:1.02rem; margin-bottom:.45rem; }
      .publication-card span { display:block; color: var(--ra-color-muted); font-size:.84rem; line-height:1.5; margin-top:.35rem; }
      .publication-card .risk { color: var(--ra-color-risk); }
      .publication-footer { grid-column:1 / -1; border-top:1px solid var(--ra-color-line); padding-top: var(--ra-space-3); color: var(--ra-color-accent); font-weight:700; }
      .diagram-matrix { border-top: 1px solid var(--ra-color-line); font-family: var(--ra-font-ui); }
      .matrix-row { display: grid; grid-template-columns: 1.05fr repeat(5, minmax(0, 1fr)); border-bottom: 1px solid var(--ra-color-line-soft); }
      .case-matrix .matrix-row { grid-template-columns: 1fr 1.2fr 1.8fr 1.7fr; }
      .matrix-cell { padding: .75rem .6rem; min-width: 0; line-height: 1.45; }
      .matrix-row:first-child .matrix-cell, .matrix-head { color: var(--ra-color-accent); font-weight: 700; }
      .health-grid { display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--ra-space-3); }
      .health-card { border-top: 4px solid var(--ra-color-accent); background: var(--ra-color-paper); padding: var(--ra-space-4); min-height: 8rem; }
      .health-card.risk { border-top-color: var(--ra-color-risk); }
      .health-card strong { display:block; font-size:1.08rem; margin-bottom:.5rem; }
      .health-card span { color: var(--ra-color-muted); font-family: var(--ra-font-ui); font-size:.88rem; line-height:1.55; }
      .finance-flow, .exception-flow { display:grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: var(--ra-space-3); }
      .finance-node, .exception-node { position:relative; border:1px solid var(--ra-color-line); background: var(--ra-color-paper); padding: var(--ra-space-3); min-height:9rem; font-family: var(--ra-font-ui); }
      .finance-node:not(:last-child)::after, .exception-node:not(:last-child)::after { content:"→"; position:absolute; right:-.95rem; top:50%; transform:translateY(-50%); color: var(--ra-color-accent); font-weight:700; background: var(--ra-color-paper); padding:0 .25rem; }
      .finance-node.risk, .exception-node.is-risk { border-color: var(--ra-color-risk); background: color-mix(in srgb, var(--ra-color-risk) 6%, var(--ra-color-paper)); }
      .finance-node strong, .exception-node strong { display:block; margin-bottom:.4rem; }
      .finance-node span, .exception-node span { color: var(--ra-color-muted); font-size:.84rem; line-height:1.5; }
      .exception-node i { display:block; font-style:normal; color: var(--ra-color-accent); font-size:.78rem; margin-bottom:.35rem; }
      .impact-map { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .impact-center { grid-column: 1 / -1; text-align:center; border-color: var(--ra-color-risk); color: var(--ra-color-risk); font-weight: 700; }
      .cover-flow { display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--ra-space-3); align-items: stretch; }
      .cover-flow-card { min-height: 6rem; border: 1px solid var(--ra-color-line); padding: var(--ra-space-3); background: var(--ra-color-paper); font-family: var(--ra-font-ui); }
      .cover-flow-card strong { display:block; font-size:1rem; margin-bottom:.35rem; color: var(--ra-color-fg); }
      .cover-flow-card span { display:block; color: var(--ra-color-muted); font-size:.8rem; line-height:1.5; }
      .cover-flow-card.is-core { border-color: var(--ra-color-accent); background: color-mix(in srgb, var(--ra-color-accent) 7%, var(--ra-color-paper)); }
      .cover-loop-note { margin-top: var(--ra-space-4); border-top: 1px solid var(--ra-color-line-soft); padding-top: var(--ra-space-4); font-family: var(--ra-font-ui); color: var(--ra-color-muted); font-size:.86rem; line-height:1.6; }
      .storyline-grid { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: var(--ra-space-3); }
      .storyline-card { border:1px solid var(--ra-color-line); background: var(--ra-color-paper); padding: var(--ra-space-4); font-family: var(--ra-font-ui); }
      .storyline-card strong { display:block; font-size:1.05rem; margin-bottom:.55rem; color: var(--ra-color-accent); }
      .storyline-card span { display:block; border-top:1px solid var(--ra-color-line-soft); padding-top:.55rem; margin-top:.55rem; color: var(--ra-color-muted); font-size:.86rem; line-height:1.5; }
      .table-wrap { overflow-x: auto; margin: var(--ra-space-5) 0; }
      details.appendix { border-top: 1px solid var(--ra-color-line); border-bottom: 1px solid var(--ra-color-line); padding: var(--ra-space-4) 0; margin: var(--ra-space-7) 0; }
      details.appendix > summary { cursor: pointer; font-family: var(--ra-font-ui); color: var(--ra-color-accent); font-weight: 650; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .9em; color: var(--ra-color-accent); }
      pre { overflow-x:auto; border-top:1px solid var(--ra-color-line); border-bottom:1px solid var(--ra-color-line); padding: var(--ra-space-4) 0; font-size: .82rem; line-height:1.55; }
      blockquote { margin: var(--ra-space-4) 0; padding-left: var(--ra-space-4); border-left: 2px solid var(--ra-color-line); color: var(--ra-color-muted); }
      @media (max-width: 1000px) {
        .rail, .node-map, .entity-map, .channel-map, .impact-map, .health-grid, .cover-flow, .executive-grid, .pm-work-grid, .case-thread-grid, .source-map, .publication-map, .finance-flow, .exception-flow, .storyline-grid { grid-template-columns: 1fr; }
        .entity-center, .channel-source, .impact-center, .source-center, .publication-footer { grid-column: auto; }
        .diagram-node:not(:last-child)::after, .finance-node:not(:last-child)::after, .exception-node:not(:last-child)::after { display: none; }
        .matrix-row, .case-matrix .matrix-row { grid-template-columns: 1fr; }
        .matrix-cell { border-bottom: 1px solid var(--ra-color-line-soft); }
      }
`;

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>云商品平台产品经理工作手册</title>
    <style>${css}
${extraCss}
    </style>
  </head>
  <body>
    <div class="cover-shell">
      <article class="cover" aria-label="文章封面">
        <div class="cover-title">
          <div>
            <div class="cover-kicker">云商品平台学习手册 · 第一版</div>
            <h1>云商品平台<br />产品经理<br />工作手册</h1>
            <p class="cover-subtitle">云商品平台解决的是从技术能力到收入、交付、账单和续约的经营闭环。本手册面向产品经理，沉淀主数据、商品化、渠道、销售、财务、稳定性和经营治理方法。</p>
          </div>
          <div class="cover-use">建议用法：先看执行摘要建立主线，再按 4 大篇章查阅作业卡、机制图、案例差异和附录模板。</div>
        </div>
        <div class="cover-map" aria-hidden="true">
          <div class="cover-flow">
            <div class="cover-flow-card"><strong>技术能力</strong><span>资源、模型、存储、网络或平台服务。</span></div>
            <div class="cover-flow-card"><strong>产品定义</strong><span>目标客户、核心场景、能力边界和服务承诺。</span></div>
            <div class="cover-flow-card is-core"><strong>商品主数据</strong><span>售卖方案、规格、计量、价格和权益规则。</span></div>
            <div class="cover-flow-card"><strong>渠道发布</strong><span>官网、控制台、云市场、销售和客服视图。</span></div>
            <div class="cover-flow-card"><strong>交易交付</strong><span>订单、合同、计量、账单、发票和交付状态。</span></div>
            <div class="cover-flow-card"><strong>经营复盘</strong><span>目标达成、毛利、风险、续约和模板沉淀。</span></div>
          </div>
          <div class="cover-loop-note">阅读主线：先判断能力是否能产品化，再补齐商品主数据，最后通过渠道、交易、账单和经营复盘形成闭环。</div>
        </div>
      </article>
    </div>
    <div class="page">
      <nav class="toc" aria-label="目录">
        <div class="toc-title">目录</div>
        <ol>${toc}</ol>
      </nav>
      <main>
        <header class="hero">
          <div class="eyebrow">云商品平台 · 产品经理工作手册</div>
          <h1>从技术能力到可售云商品，再到经营闭环</h1>
          <p class="subtitle">本手册帮助产品经理把“能做的技术能力”转成“可购买、可交付、可计量、可结算、可续约”的云商品，并让上下游围绕同一套事实协作。</p>
          <div class="meta">资料来源：云商品工作手册 · 版本：第一版 · 生成日期：2026-06-21</div>
        </header>
        <p class="lead">云商品平台要解决一组连续问题：能力边界是否清楚，能否稳定交付，是否能准确计量和合理定价，官网、控制台、销售和账单口径是否一致，财务、销售、运维和客户能否基于同一套事实协作。本手册按项目推进顺序组织：先建立概念边界，再进入主数据和生命周期，最后回到经营、异常、续约和平台实现。</p>
        ${executiveSummaryBlock()}
        <div class="summary" aria-label="全书主线">
          <div class="summary-grid">
            <div class="summary-item"><strong>产品化</strong><span>目标客户、能力边界、不可承诺项、成本、服务等级承诺和交付能力先说清。</span></div>
            <div class="summary-item"><strong>主数据</strong><span>商品、售卖方案、规格、计量、价格和权益规则构成交易骨架。</span></div>
            <div class="summary-item"><strong>渠道与销售</strong><span>官网、控制台、云市场、销售报价和客服口径来自同一事实源。</span></div>
            <div class="summary-item"><strong>经营治理</strong><span>成交规模、毛利、稳定性、客户争议、续约风险和复盘模板共同决定健康度。</span></div>
          </div>
        </div>
        ${sectionHtml}
        <details class="appendix" open>
          <summary>附录：详细章节与可复制模板</summary>
          ${appendixHtml}
        </details>
      </main>
    </div>
  </body>
</html>`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(outPath);
