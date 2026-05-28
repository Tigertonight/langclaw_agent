import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const EnvSchema = z.object({
  HTTP_HOST: z.string().default("0.0.0.0"),
  HTTP_PORT: z.coerce.number().int().positive().default(4310),

  DATABASE_URL: z.string().url(),
  DATABASE_SCHEMA: z.string().default("app_memory"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  EMBEDDING_PROVIDER: z.enum(["bge-m3-ollama", "hash-fallback"]).default("bge-m3-ollama"),
  EMBEDDING_MODEL_TAG: z.string().default("bge-m3:v1"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1024),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_EMBED_MODEL: z.string().default("bge-m3"),

  SERVICE_TOKEN_SECRET: z.string().min(8),
  SERVICE_TOKEN_HEADER: z.string().default("X-Memory-Identity"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development")
});

export type AppConfig = z.infer<typeof EnvSchema>;

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid memory-service configuration:\n  ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
