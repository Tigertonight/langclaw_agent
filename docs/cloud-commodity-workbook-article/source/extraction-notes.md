# Extraction Notes

- 输入来源：`docs/cloud-commodity-workbook/` Markdown 手册目录。
- 输入类型：Markdown 文件夹，包含 README、4 个章节、模板包、审计记录和结构化验收日志。
- 抽取方式：按手册阅读顺序合并为 `source/source.md`，保留原始标题、表格、清单、代码块、模板、审计矩阵和验收日志。
- 目标语言：中文，跟随源材料；少量英文术语保留并在正文中解释。
- 信息保留：100%。本阶段未删除、压缩或改写源材料内容，只增加合并来源说明。
- 文件纳入范围：
  - `README.md`
  - `chapters/01-foundation-and-master-data.md`
  - `chapters/02-lifecycle-channel-gtm.md`
  - `chapters/03-commercial-operations-governance.md`
  - `chapters/04-cases-platform-and-templates.md`
  - `templates/pm-copyable-templates.md`
  - `audit/final-audit.md`
  - `audit/subagent-findings.md`
  - `audit/verification.log`
- 未纳入文件：`.DS_Store`，系统元数据文件，无业务内容。
- 低置信区域：无。源材料是结构化 Markdown，不涉及 OCR、PDF 表格抽取或图片识别。
- 备注：`verification.log` 已作为 fenced code block 保留，避免日志内容被误解析为正文结构。
