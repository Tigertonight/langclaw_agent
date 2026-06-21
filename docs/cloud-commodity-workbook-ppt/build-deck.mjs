import fs from 'node:fs';
import path from 'node:path';

const root = '/Users/yuanzexiang/Documents/Codex/2026-05-08/agent-openclaw-langchain-workflow-toolcall-agent';
const skill = '/Users/yuanzexiang/.codex/skills/guizang-ppt-skill';
const outDir = path.join(root, 'docs/cloud-commodity-workbook-ppt');
const templatePath = path.join(skill, 'assets/template-swiss.html');
const outPath = path.join(outDir, 'index.html');

fs.mkdirSync(outDir, { recursive: true });

const total = 20;
const pad = (n) => String(n).padStart(2, '0');

function chrome(n, label) {
  return `<div class="chrome-min"><div class="l">云商品工作手册 · ${label}</div><div class="r">${pad(n)} / ${total}</div></div>`;
}

function head(n, eyebrow, title, lead) {
  return `
    ${chrome(n, eyebrow)}
    <div data-anim="head" style="display:flex;flex-direction:column;gap:1.4vh;margin-bottom:2.8vh">
      <div class="t-meta">${eyebrow}</div>
      <h2 class="h-xl-zh" style="font-size:min(4.8vw,8.8vh);max-width:18ch">${title}</h2>
      ${lead ? `<p class="lead" style="max-width:52ch">${lead}</p>` : ''}
    </div>`;
}

function bullets(items) {
  return `<div style="display:flex;flex-direction:column;gap:1.2vh">
    ${items.map((it, i) => `<div class="card-fill" data-anim="card" style="padding:1.8vh 1.4vw;display:grid;grid-template-columns:2.2em 1fr;gap:1vw;align-items:start">
      <div class="t-meta" style="color:var(--text-helper);font-weight:600">${pad(i + 1)}</div>
      <div class="t-body">${it}</div>
    </div>`).join('')}
  </div>`;
}

function cells(items) {
  return `<div class="sub-grid-3-2" data-anim="grid">
    ${items.map((it, i) => `<div class="sub-card" data-anim="card" style="border-top:${it.key ? '3px solid var(--accent)' : '1px solid transparent'}">
      <div class="nb-corner">${pad(i + 1)}</div>
      <div class="ttl">${it.title}</div>
      <div class="desc">${it.desc}</div>
    </div>`).join('')}
  </div>`;
}

function stack(items) {
  return `<div class="stack-row" data-anim="stack">
    ${items.map((it, i) => `<div class="stack-block ${it.dark ? 'b-ink' : 'b-grey'}" data-anim="block" style="${it.key ? 'border-top:4px solid var(--accent)' : ''}">
      <div class="layer-nb">${pad(i + 1)}</div>
      <div class="layer-ttl">${it.title}</div>
      <div class="layer-desc">${it.desc}</div>
      <div class="layer-tag">${it.tag}</div>
    </div>`).join('')}
  </div>`;
}

function timeline(items) {
  return `<div class="timeline-h nav-safe-bottom-tight" data-anim="timeline" style="min-height:48vh">
    <div class="tl-row" style="grid-template-columns:repeat(${items.length},1fr)">
      ${items.map((it, i) => `<div class="th-node ${i % 2 ? 'down' : 'up'}">
        <div class="dot"></div>
        <div class="label">
          <div class="yr">${pad(i + 1)}</div>
          <div class="name">${it.name}</div>
          <div class="desc">${it.desc}</div>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

function bars(items) {
  return `<div class="h-bar-chart" data-anim="bars">
    ${items.map((it) => `<div class="row-lbl">${it.name}</div>
      <div class="row-track"><div class="row-fill" style="width:${it.value}%"></div></div>
      <div class="row-val">${it.value}<span class="unit">%</span></div>`).join('')}
  </div>`;
}

function matrix(items) {
  return `<div class="matrix-fill" style="display:grid;grid-template-columns:repeat(4,1fr);gap:1.2vw 1.2vh;margin-top:2vh" data-anim="matrix">
    ${items.map((it, i) => `<div class="card-fill" data-anim="cell" style="padding:1.5vh 1vw;min-height:12vh;border-top:${it.key ? '3px solid var(--accent)' : '1px solid var(--border-subtle)'}">
      <div class="t-meta" style="margin-bottom:.8vh">${pad(i + 1)}</div>
      <div class="t-h-prod">${it.title}</div>
      <div class="t-body-sm" style="margin-top:.7vh">${it.desc}</div>
    </div>`).join('')}
  </div>`;
}

function pmStrip(items) {
  return `<div data-anim="strip" style="display:grid;grid-template-columns:repeat(${items.length},1fr);gap:1.2vw;margin-top:1.8vh;border-top:1px solid var(--border-subtle);padding-top:1.4vh;padding-bottom:5.2vh">
    ${items.map((it) => `<div><div class="t-meta" style="margin-bottom:.6vh">${it.label}</div><div class="t-body-sm">${it.value}</div></div>`).join('')}
  </div>`;
}

function slide(n, layout, title, eyebrow, lead, body, cls = 'slide') {
  return `<section class="${cls}" data-layout="${layout}" data-animate="grid-reveal">
  <div class="canvas-card">
    ${head(n, eyebrow, title, lead)}
    <div style="flex:1;padding:0;min-height:0">${body}</div>
  </div>
</section>`;
}

const slides = [];

slides.push(`<section class="slide accent" data-layout="S01" data-animate="hero">
  <div class="canvas-card">
    <canvas class="ascii-bg" aria-hidden="true"></canvas>
    <div class="chrome-min"><div class="l">云商品平台产品经理学习成果</div><div class="r">01 / ${total}</div></div>
    <div style="flex:1;padding:0;display:grid;grid-template-rows:auto 1fr auto;gap:2.6vh">
      <div data-anim="kicker" class="t-meta" style="color:rgba(255,255,255,.78);letter-spacing:.22em">CLOUD COMMODITY · LEARNING OUTCOME</div>
      <h1 data-anim="title" style="align-self:start;font-family:var(--sans),var(--sans-zh);font-weight:200;font-size:min(10.2vw,18vh);line-height:.94;letter-spacing:-.025em;color:#fff">云商品<br/>学习地图</h1>
      <div data-anim="bottom" style="display:grid;grid-template-rows:auto auto;gap:1.6vh;border-top:1px solid rgba(255,255,255,.22);padding-top:2vh">
        <div class="lead" style="max-width:56ch;color:rgba(255,255,255,.86)">从技术能力到可售商品，再到交付、计费、治理和经营目标达成。</div>
        <div style="display:flex;justify-content:space-between;align-items:end">
          <div class="t-meta" style="color:rgba(255,255,255,.6)">Product · Commerce · Operation</div>
          <div class="t-meta" style="color:rgba(255,255,255,.6)">20 Topics / 4 Modules</div>
        </div>
      </div>
    </div>
  </div>
</section>`);

slides.push(slide(2, 'S05', '能力、产品、商品', 'FOUNDATION · 02', '能力解决“能不能做”，产品解决“为谁解决什么问题”，商品解决“如何被购买、交付和计费”。', stack([
  { title: '能力', desc: '技术、模型、资源或服务能力，是商业化之前的原材料。', tag: '研发 / 资源团队' },
  { title: '产品', desc: '明确目标客户、核心场景、价值边界、交付物和不可承诺项。', tag: '商品 PM' },
  { title: '商品', desc: '进入交易系统，具备 Offer、SKU、计量、价格、权益和履约规则。', tag: '商品中台 / 商业化', dark: true }
]) + pmStrip([
  { label: 'PM 产出', value: '产品定义、商品模型、边界清单' },
  { label: '协作对象', value: '研发、SRE、财务、法务、GTM' },
  { label: '常见误区', value: '把官网介绍页当作商品主数据' }
])));

slides.push(slide(3, 'S11', '产品化定义门禁', 'PRODUCTIZATION · 03', '商品上架前，先判断这个能力是否已经被定义成一个合格产品。', timeline([
  { name: '目标客户', desc: '客户画像、行业场景、购买动机' },
  { name: '能力边界', desc: '支持范围、不可承诺项、版本范围' },
  { name: '成本模型', desc: '单位成本、峰值成本、免费额度' },
  { name: 'SLA 初稿', desc: 'SLO、故障响应、交付窗口' },
  { name: '交付物', desc: 'PRD、FAQ、定价输入、门禁表' }
]) + pmStrip([
  { label: '负责人', value: '商品 PM 牵头，研发/SRE/财务/法务会签' },
  { label: '通过条件', value: '目标客户、边界、成本、SLA、交付物可被下游消费' },
  { label: '阻塞信号', value: '只有 demo 能力，缺少成本、容量或禁承诺项' }
])));

slides.push(slide(4, 'S17', '商品主数据模型', 'MASTER DATA · 04', 'Product、Offer、SKU、Meter、Price、Entitlement 是云商品平台的业务骨架。', `<div class="grid-12" data-anim="system">
  <div class="span-4 card-ink" style="padding:3vh 2vw;min-height:48vh;display:flex;flex-direction:column;justify-content:space-between">
    <div class="t-meta" style="color:rgba(255,255,255,.65)">CENTER</div>
    <div style="font-size:min(4.4vw,8vh);font-weight:200;line-height:1">Product</div>
    <div class="t-body-sm" style="color:rgba(255,255,255,.78)">回答“卖的是什么”，是所有交易、展示和经营分析的主对象。</div>
  </div>
  <div class="span-8">${matrix([
    { title: 'Offer', desc: '怎么卖' }, { title: 'SKU', desc: '买哪档' }, { title: 'Meter', desc: '怎么计量' }, { title: 'Price', desc: '怎么算钱' },
    { title: 'Entitlement', desc: '买后有什么' }, { title: 'Region', desc: '哪里可售' }, { title: 'Customer', desc: '谁有权限' }, { title: 'Contract', desc: '合同边界' },
    { title: 'Order', desc: '订购事实' }, { title: 'Subscription', desc: '生效关系' }, { title: 'Bill', desc: '账单解释' }, { title: 'Invoice', desc: '开票状态' }
  ])}</div>
</div>`));

slides.push(slide(5, 'S08', '主数据治理与字段归属', 'GOVERNANCE · 05', '知道谁维护字段、谁消费字段、字段变化会影响哪些下游，是主数据治理的核心。', `<div class="duo-compare" data-anim="compare">
  <div class="col">
    <div class="col-tag"><span class="num">01</span> SOURCE</div>
    <div class="col-ttl">一个源头</div>
    <div class="col-desc">商品中台维护主数据、字段 owner、状态、生效时间和审计记录。</div>
    <ul class="col-list"><li>字段归属清楚</li><li>变更有审批和版本</li><li>对外展示用业务语言</li></ul>
  </div>
  <div class="vrule"></div>
  <div class="col accent">
    <div class="col-tag"><span class="num">02</span> PROJECTION</div>
    <div class="col-ttl">多个投影</div>
    <div class="col-desc">官网、控制台、销售、Marketplace、账单和客服消费不同字段。</div>
    <ul class="col-list"><li>渠道口径一致</li><li>下游影响可追溯</li><li>避免暴露内部 key</li></ul>
  </div>
</div>${pmStrip([
  { label: 'PM 产出', value: '字段归属表、渠道消费矩阵、变更影响分析' },
  { label: '治理重点', value: '主数据源唯一、字段 owner 明确、下游同步可追溯' },
  { label: '风险', value: '官网/控制台/报价/账单口径不一致' }
])}`));

slides.push(slide(6, 'S19', 'Offer / SKU / Meter / Price', 'COMMERCIAL MODEL · 06', '这四个对象把“销售包装”连接到“真实出账”。', `<div class="grid-4" data-anim="cards">
  ${[
    ['Offer', '售卖方案', '按量、包月、资源包、企业套餐。'],
    ['SKU', '规格档位', '客户真正选择购买的规格组合。'],
    ['Meter', '用量事实', 'Token、实例小时、GB、请求次数。'],
    ['Price', '计价规则', '目录价、合同价、促销价和阶梯价。']
  ].map((x) => `<div class="card-fill" style="padding:3vh 2vw;display:flex;flex-direction:column;gap:2vh">
    <div class="t-meta">${x[0]}</div><div class="h-md">${x[1]}</div><div class="t-body-sm">${x[2]}</div>
  </div>`).join('')}
</div>${pmStrip([
  { label: '校验关系', value: 'Offer 绑定 SKU，SKU 绑定 Meter，Price 解释 Meter' },
  { label: '审批重点', value: '价格、折扣、资源包、合同价、促销互斥' },
  { label: '常见争议', value: '报价单位和账单单位不一致' }
])}`));

slides.push(slide(7, 'S14', 'Plan 型产品权益治理', 'ENTITLEMENT · 07', 'Plan 型产品的难点不是“给额度”，而是额度如何发放、消耗、过期、退款、超额和解释。', `<div class="grid-2-7-5" data-anim="loop">
  <div>${bullets(['发放周期和有效期要清楚', '消耗顺序要能解释', '超额付费要二次确认', '退款退订要联动权益', '账单里要能讲明白'])}</div>
  <div class="card-ink" style="padding:4vh 3vw;min-height:48vh;display:flex;flex-direction:column;justify-content:space-between">
    <div class="t-meta" style="color:rgba(255,255,255,.62)">RULE ENGINE</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.2vw">
      ${['Grant','Use','Expire','Refund','Overage','Bill'].map((x,i)=>`<div style="border-top:2px solid rgba(255,255,255,.32);padding-top:1.2vh;color:#fff"><div class="t-meta" style="color:rgba(255,255,255,.62)">${pad(i+1)}</div><div class="t-body" style="color:#fff">${x}</div></div>`).join('')}
    </div>
    <div class="lead" style="color:rgba(255,255,255,.82)">客户安全感来自规则可见，而不是后台复杂度。</div>
  </div>
</div>${pmStrip([
  { label: 'PM 产出', value: '权益规则表、超额确认页、账单解释模板' },
  { label: '关键协作', value: '财务定成本，法务定退订，研发定扣减顺序' },
  { label: '风险', value: '免费额度成本、静默超额、过期争议、退款冲正' }
])}`));

slides.push(slide(8, 'S11', '产品生命周期全流程', 'LIFECYCLE · 08', '云商品不是上架即结束，而是从产品化到巡检、续约、复盘的闭环。', timeline([
  { name: '产品化', desc: '定义客户、边界、交付物' },
  { name: '商品化', desc: '建模 Offer/SKU/Price' },
  { name: '发布', desc: '渠道、审批、灰度' },
  { name: '经营', desc: '交付、计量、账单' },
  { name: '复盘', desc: '续约、扩容、下线' }
]) + pmStrip([
  { label: '每阶段判断', value: '输入是否齐、输出能否消费、负责人是否确认' },
  { label: '跨部门门禁', value: '财务、SRE、法务、GTM、销售、客服都要进入链路' },
  { label: '学习重点', value: '不是流程图背诵，而是知道每步交付什么' }
])));

slides.push(slide(9, 'S15', '渠道发布矩阵', 'CHANNEL · 09', '官网、控制台、Marketplace、销售方案和客服话术，都是同一套主数据的不同业务投影。', matrix([
  { title: '工作台', desc: '主数据、风险、审批、经营指标' },
  { title: '官网', desc: '定位、卖点、公开入口、FAQ' },
  { title: '控制台', desc: '购买、配置、用量、账单' },
  { title: 'Marketplace', desc: '生态上架、接口、伙伴责任' },
  { title: '销售方案', desc: '组合、预算、报价假设' },
  { title: '客服', desc: '账单解释、争议处理' },
  { title: '账单系统', desc: '计量、抵扣、发票状态' },
  { title: '合同系统', desc: '价格、SLA、有效期' }
]) + pmStrip([
  { label: '核心原则', value: '官网不是主数据源，商品中台才是源头' },
  { label: '发布前检查', value: '字段来源、审批状态、禁展示项、渠道 owner' },
  { label: '发布后检查', value: '官网、控制台、报价、客服、账单口径一致' }
])));

slides.push(slide(10, 'S16', 'GTM 与销售方案', 'GTM · 10', 'GTM 的本质，是把“商品能卖”变成“客户愿意买、销售知道怎么卖”。', cells([
  { title: '目标客户', desc: '大客户、中型客户、自助客户、行业客户和生态伙伴。' },
  { title: '行业场景', desc: '把技术能力翻译成金融、内容、电商、制造等业务问题。' },
  { title: '产品组合', desc: '主商品、配套商品、服务支持和预算拆分。' },
  { title: '报价边界', desc: '估算、草稿、正式报价必须分清。' },
  { title: '禁承诺项', desc: '容量、SLA、折扣、合规、交付日期不能越界。' },
  { title: '下一步', desc: '谁确认需求、谁出报价、谁拉审批、谁跟客户。' }
]) + pmStrip([
  { label: 'PM 产出', value: '行业包、FAQ、销售话术、报价前检查清单' },
  { label: '协作对象', value: 'GTM、销售、售前、财务、SRE、法务' },
  { label: '风险', value: '销售承诺超过商品、财务或 SRE 边界' }
])));

slides.push(slide(11, 'S20', '财务商业化与经营口径', 'FINANCE · 11', 'GMV 不等于健康收入，云商品必须同时看净收入、毛利、递延、退款和账单争议。', bars([
  { name: 'GMV 规模', value: 88, accent: true },
  { name: '净收入质量', value: 72, accent: false },
  { name: '毛利健康', value: 64, accent: false },
  { name: '递延风险', value: 42, accent: false },
  { name: '争议暴露', value: 28, accent: false }
]) + pmStrip([
  { label: 'PM 必问', value: '何时确认收入、免费额度成本、折扣能否叠加' },
  { label: '财务边界', value: '合同履约义务、服务交付方式、财务政策最终确认' },
  { label: '经营风险', value: 'GMV 达成但净收入和毛利不健康' }
])));

slides.push(slide(12, 'S05', 'SRE 上架门禁', 'SRE · 12', 'SRE 不是上线后救火，而是在商品可售前判断承诺是否可交付。', stack([
  { title: '承诺前', desc: '容量、压测、限流、告警、灰度和回滚先通过。', tag: 'GATE' },
  { title: '发布中', desc: '分客户、分地域、分流量开放，阻塞可升级。', tag: 'CANARY' },
  { title: '发布后', desc: '验证购买、交付、计量、账单、告警和客户反馈。', tag: 'HEALTH', dark: true }
]) + pmStrip([
  { label: 'SRE 确认', value: '技术可达性、容量、SLO、告警、回滚' },
  { label: '对外承诺', value: '仍需合同、法务、财务和业务负责人共同确认' },
  { label: '失败处理', value: '限流、降级、暂停新购、客户通知和补偿口径' }
])));

slides.push(slide(13, 'S08', '客户自助购买与售后解释', 'CUSTOMER · 13', '客户体验的核心，是买前知道规则，买后解释得清账单、权益和超额。', `<div class="duo-compare" data-anim="compare">
  <div class="col">
    <div class="col-tag"><span class="num">BUY</span> BEFORE</div>
    <div class="col-ttl">买前确认</div>
    <div class="col-desc">买的是什么、多少钱、能用多久、用完怎么办、是否自动扣费。</div>
    <ul class="col-list"><li>价格属性</li><li>权益有效期</li><li>超额二次确认</li></ul>
  </div>
  <div class="vrule"></div>
  <div class="col accent">
    <div class="col-tag"><span class="num">AFTER</span> AFTER-SALES</div>
    <div class="col-ttl">售后解释</div>
    <div class="col-desc">账单高于估算、赠送额度过期、失败是否扣费、合同价差异。</div>
    <ul class="col-list"><li>用客户语言解释</li><li>回连可核验数据</li><li>不暴露内部字段</li></ul>
  </div>
</div>${pmStrip([
  { label: '买前页面', value: '价格属性、权益有效期、超额规则、退款退订' },
  { label: '售后依据', value: '订单、用量、计量、价格、账单、合同版本' },
  { label: '客户友好', value: '不说内部 key，不把估算说成正式报价' }
])}`));

slides.push(slide(14, 'S17', '异常链路与反向治理', 'EXCEPTION · 14', '真实平台的大量工作不是新上架，而是调价、改规格、退款、退订、下线和回滚。', `<div class="grid-12">
  <div class="span-5">${bullets(['改 SKU 或新增规格', '调价和促销结束', '权益调整与退订退款', '计量异常和账单重算', '渠道同步和回滚'])}</div>
  <div class="span-7 card-fill" style="padding:3vh 2vw;min-height:50vh;display:flex;flex-direction:column;justify-content:space-between">
    <div class="t-meta">IMPACT MAP</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1.2vw">
      ${['客户','合同','账单','权益','渠道','回滚'].map((x)=>`<div style="border-top:1px solid var(--border-subtle);padding-top:1.6vh;min-height:11vh"><div class="t-h-prod">${x}</div><div class="t-body-sm">先分析影响，再审批变更。</div></div>`).join('')}
    </div>
    <div class="t-body-emp">任何反向动作都不能只改一个字段。</div>
  </div>
</div>${pmStrip([
  { label: 'PM 产出', value: '变更影响分析、审批摘要、客户沟通和回滚方案' },
  { label: '存量保护', value: '沿用旧规则、到期切换、可选迁移、替代补偿' },
  { label: '治理底线', value: '高风险动作先草稿和灰度，不直接生产变更' }
])}`));

slides.push(slide(15, 'S15', '发布后巡检', 'POST LAUNCH · 15', '商品显示已发布，不代表业务健康；必须验证端到端闭环。', matrix([
  { title: '官网展示', desc: '卖点、价格入口、FAQ' },
  { title: '控制台购买', desc: '配置、下单、确认页' },
  { title: '订单创建', desc: '状态流转和失败处理' },
  { title: '权益交付', desc: '额度、实例、服务开通' },
  { title: 'Meter 写入', desc: '计量事实可追溯' },
  { title: '账单展示', desc: '金额、抵扣、发票' },
  { title: '客服解释', desc: '话术与合同一致' },
  { title: '告警健康', desc: '容量、错误率、SLA' }
]) + pmStrip([
  { label: '巡检窗口', value: '发布后 24 小时是发现配置错误的黄金窗口' },
  { label: '最小闭环', value: '官网入口 → 购买 → 交付 → 计量 → 账单 → 客服解释' },
  { label: '复盘沉淀', value: '问题进入模板、监控、审批规则和话术' }
])));

slides.push(slide(16, 'S20', '续约与客户成功', 'RENEWAL · 16', '云商品是持续经营业务，续约风险通常在账单争议、SLA 事故和用量异常时已经出现。', bars([
  { name: '用量健康', value: 82, accent: true },
  { name: '账单健康', value: 66, accent: false },
  { name: '稳定性满意', value: 74, accent: false },
  { name: '商务健康', value: 58, accent: false },
  { name: '增长机会', value: 69, accent: false }
]) + pmStrip([
  { label: '续约雷达', value: '到期时间、ARR、用量、账单、SLA、满意度、竞品风险' },
  { label: '客户成功动作', value: '建档、监控、识别风险、制定动作、沟通、复盘' },
  { label: '关键判断', value: '用量高不一定健康，账单争议会直接影响续约' }
])));

slides.push(slide(17, 'S16', '组织层级关注指标', 'ORGANIZATION · 17', '同一套云商品数据，在不同角色眼中代表不同决策。', cells([
  { title: '商品 PM', desc: '定义完整性、主数据、上架阻塞、客户解释。' },
  { title: '财务 BP', desc: '毛利、折扣、收入确认、退款冲正。' },
  { title: 'SRE', desc: '容量、告警、灰度、回滚和 SLA 边界。' },
  { title: '销售/GTM', desc: '目标客户、行业方案、报价边界和禁承诺项。' },
  { title: '客户成功', desc: '用量健康、账单争议、续约概率和扩容机会。' },
  { title: '老板', desc: 'GMV、净收入、目标达成、最大风险和负责人。' }
]) + pmStrip([
  { label: '老板视角', value: '目标达成、最大风险、影响金额、负责人、下一步' },
  { label: '组织协同', value: '同一事实，不同角色做不同决策' },
  { label: '经营指标', value: '营收、稳定性、覆盖率、竞争力、留存和客户结构' }
])));

slides.push(slide(18, 'S04', '外部客户场景', 'CUSTOMER SEGMENTS · 18', '大客户、小客户、采购、管理员和续约客户，关注的不是同一套问题。', cells([
  { title: '大客户', desc: '合同价、SLA、容量预约、审计和专属支持。' },
  { title: '小客户', desc: '价格透明、购买简单、额度清楚、用完提醒。' },
  { title: '采购', desc: '正式报价、合同、发票、付款条件和验收依据。' },
  { title: '管理员', desc: '账号权限、额度分配、预算告警和用量控制。' },
  { title: '续约客户', desc: '稳定性、账单争议、价值证明和升级空间。' },
  { title: '生态伙伴', desc: '接口稳定、渠道分佣、客户归属和售后责任。' }
]) + pmStrip([
  { label: '客户分层', value: '同一个商品要给不同客户层级不同解释和流程' },
  { label: '对外材料', value: '正式报价、合同、发票、SLA、FAQ、账单说明' },
  { label: '权限边界', value: '客户只能看自己的合同、账单、用量和权益' }
])));

slides.push(slide(19, 'S17', 'Agent 平台实现视角', 'AGENT PLATFORM · 19', '云商品 Agent 不能是写死 demo，而要基于领域数据、工具、权限、展示、评测和审计形成可治理系统。', `<div class="grid-12">
  <div class="span-4 card-ink" style="padding:3vh 2vw;min-height:48vh;display:flex;flex-direction:column;justify-content:space-between">
    <div class="t-meta" style="color:rgba(255,255,255,.65)">OPERATING SYSTEM</div>
    <div style="font-size:min(4.2vw,7.8vh);font-weight:200;line-height:1">Agentic<br/>Cloud<br/>Platform</div>
    <div class="t-body-sm" style="color:rgba(255,255,255,.78)">不是场景硬编码，而是有领域、数据、权限和验收的业务系统。</div>
  </div>
  <div class="span-8">${matrix([
    { title: 'Domain Pack', desc: '领域隔离' }, { title: 'Resource', desc: '表与字段说明' }, { title: 'Tools', desc: '查询、估算、草稿' }, { title: 'Permissions', desc: '客户与角色范围' },
    { title: 'Router', desc: '场景识别' }, { title: 'OpenUI', desc: '结构化展示' }, { title: 'Eval', desc: '回归验收' }, { title: 'Audit', desc: '来源和边界' }
  ])}</div>
</div>${pmStrip([
  { label: 'Agentic loop', value: '路由、取数、工具、展示、追问、审计都走链路' },
  { label: '售卖级安全', value: '权限隔离、草稿动作、人审确认、来源追溯' },
  { label: '演示可靠性', value: 'OpenUI 覆盖、评测回归、mock 边界清楚' }
])}`));

slides.push(`<section class="slide split" data-layout="S10" data-animate="split-statement">
  <div class="canvas-card">
    <div class="split-half">
      <div class="half b-accent" style="padding:5.6vh 3.6vw 4.4vh;justify-content:space-between;position:relative;overflow:hidden">
        <canvas class="ascii-bg" aria-hidden="true"></canvas>
        <div class="chrome-min" style="margin-bottom:0;position:relative;z-index:1"><div class="l">20 / ${total}</div><div class="r">SYNTHESIS</div></div>
        <div data-anim="manifesto" style="display:flex;flex-direction:column;gap:2vh;position:relative;z-index:1">
          <div class="t-meta" style="color:rgba(255,255,255,.78);letter-spacing:.22em;margin-bottom:1.6vh">THREE STORYLINES</div>
          <h2 style="font-family:var(--sans),var(--sans-zh);font-size:min(7.4vw,13vh);line-height:.94;letter-spacing:-.025em;font-weight:200;color:#fff">三条案例<br/>一套能力</h2>
          <div style="font-size:max(16px,1vw);line-height:1.6;color:rgba(255,255,255,.82);font-weight:400;max-width:36ch;margin-top:1.4vh">ECS GPU、Seedance Mini、Agent Plan 分别代表资源型、AI 内容型和订阅权益型云商品。</div>
        </div>
        <div class="t-meta" style="color:rgba(255,255,255,.62);border-top:1px solid rgba(255,255,255,.22);padding-top:2vh;position:relative;z-index:1">END OF LEARNING DECK</div>
      </div>
      <div class="half" style="padding:5.6vh 3.6vw 4.4vh;justify-content:space-between">
        <div class="chrome-min"><div class="l">TAKEAWAYS</div><div class="r">03 RULES</div></div>
        <div data-anim="rules" style="display:flex;flex-direction:column;gap:0">
          ${[
            ['ECS GPU', '容量、地域、SLA、交付，是资源型云商品的核心挑战。'],
            ['Seedance Mini', '模型能力、生成队列、价格、渠道，是 AI 内容商品的典型难点。'],
            ['Agent Plan', '权益、超额、毛利、客户解释，是订阅型产品的关键治理。']
          ].map((x,i)=>`<div style="display:grid;grid-template-columns:auto 1fr;gap:2vw;align-items:start;padding:2.6vh 0;border-top:1px solid var(--border-subtle);${i===2?'border-bottom:2px solid var(--accent)':''}">
            <div style="font-family:var(--sans);font-weight:200;font-size:min(4.4vw,7.8vh);line-height:.9;color:${i===2?'var(--accent)':'var(--text-primary)'}">${pad(i+1)}</div>
            <div><h3 style="font-weight:400;font-size:max(18px,1.8vw);line-height:1.2;color:${i===2?'var(--accent)':'var(--text-primary)'};margin-bottom:1vh">${x[0]}</h3><p style="font-size:max(16px,.94vw);line-height:1.6;color:var(--text-secondary);font-weight:400">${x[1]}</p></div>
          </div>`).join('')}
        </div>
        <div class="t-meta" style="text-align:right">云商品平台产品经理 · 学习成果展示</div>
      </div>
    </div>
  </div>
</section>`);

let html = fs.readFileSync(templatePath, 'utf8');
html = html.replace('<title>[必填] 替换为 PPT 标题 · Deck Title</title>', '<title>云商品平台产品经理学习成果 · Web PPT</title>');
const start = html.indexOf('<!-- ============================================================\n     SLIDES 插入区');
const end = html.indexOf('\n</div>\n\n<div id="nav"></div>', start);
if (start < 0 || end < 0) throw new Error('Cannot locate slide insertion region');
html = html.slice(0, start) + slides.join('\n\n') + html.slice(end);
html = html.replaceAll('[必填]', '');
html = html.replace('</head>', `<style>
  #hint{display:none!important}
  #nav{bottom:1.1vh!important}
</style>
</head>`);
fs.writeFileSync(outPath, html);
console.log(outPath);
