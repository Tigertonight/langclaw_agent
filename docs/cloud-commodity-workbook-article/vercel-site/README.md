# 云商品工作手册 Vercel 发布包

这个目录是单独整理出的静态站点发布包，只包含工作手册页面和 Vercel 配置，避免把工程源码、环境变量或开发文件一起发布。

发布入口：

- `index.html`：完整工作手册
- `first-spread.html`：封面预览页

发布命令：

```bash
cd /Users/yuanzexiang/Documents/Codex/2026-05-08/agent-openclaw-langchain-workflow-toolcall-agent/docs/cloud-commodity-workbook-article/vercel-site
npx vercel deploy --prod --yes
```

如果使用 token：

```bash
cd /Users/yuanzexiang/Documents/Codex/2026-05-08/agent-openclaw-langchain-workflow-toolcall-agent/docs/cloud-commodity-workbook-article/vercel-site
VERCEL_TOKEN=你的_token npx vercel deploy --prod --yes --token "$VERCEL_TOKEN"
```
