import { loadEnvFile } from "../config/load-env.js";
import { getIntegrationConfig, validateIntegrationConfig } from "../config/integrations.js";

loadEnvFile();

const config = getIntegrationConfig();
const result = validateIntegrationConfig(config);

console.log(JSON.stringify({
  ok: result.ok,
  modes: {
    wecom: config.wecom.mode,
    tencentDocs: config.tencentDocs.mode
  },
  errors: result.errors,
  warnings: result.warnings
}, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
