import pino from "pino";
import { loadConfig } from "../config/env.js";

const cfg = loadConfig();

export const logger = pino({
  level: cfg.LOG_LEVEL,
  base: { service: "memory-service" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label })
  }
});
