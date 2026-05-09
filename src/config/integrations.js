export function getIntegrationConfig() {
  return {
    wecom: {
      mode: process.env.WECOM_MODE ?? "mock",
      corpId: process.env.WECOM_CORP_ID,
      contactSecret: process.env.WECOM_CONTACT_SECRET,
      baseUrl: (process.env.WECOM_BASE_URL ?? "https://qyapi.weixin.qq.com").replace(/\/$/, "")
    },
    tencentDocs: {
      mode: process.env.TENCENT_DOCS_MODE ?? "mock",
      baseUrl: (process.env.TENCENT_DOCS_BASE_URL ?? "").replace(/\/$/, ""),
      clientId: process.env.TENCENT_DOCS_CLIENT_ID,
      clientSecret: process.env.TENCENT_DOCS_CLIENT_SECRET,
      accessToken: process.env.TENCENT_DOCS_ACCESS_TOKEN,
      refreshToken: process.env.TENCENT_DOCS_REFRESH_TOKEN,
      docIds: parseCsv(process.env.TENCENT_DOCS_DOC_IDS),
      contentEndpointTemplate: process.env.TENCENT_DOCS_CONTENT_ENDPOINT_TEMPLATE
    }
  };
}

export function validateIntegrationConfig(config = getIntegrationConfig()) {
  const warnings = [];
  const errors = [];

  if (config.wecom.mode === "real") {
    requireValue(errors, "WECOM_CORP_ID", config.wecom.corpId);
    requireValue(errors, "WECOM_CONTACT_SECRET", config.wecom.contactSecret);
  }

  if (config.tencentDocs.mode === "real") {
    requireValue(errors, "TENCENT_DOCS_BASE_URL", config.tencentDocs.baseUrl);
    requireValue(errors, "TENCENT_DOCS_DOC_IDS", config.tencentDocs.docIds.length > 0 ? "set" : "");
    requireValue(errors, "TENCENT_DOCS_CONTENT_ENDPOINT_TEMPLATE", config.tencentDocs.contentEndpointTemplate);
    if (!config.tencentDocs.accessToken && !config.tencentDocs.refreshToken) {
      warnings.push("TENCENT_DOCS_ACCESS_TOKEN or TENCENT_DOCS_REFRESH_TOKEN is needed for real Tencent Docs calls.");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function requireValue(errors, name, value) {
  if (!value) errors.push(`${name} is required.`);
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
