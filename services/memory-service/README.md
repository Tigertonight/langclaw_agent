# memory-service

Multi-tenant memory + RAG service for OpenClaw and other agent frameworks.

See `docs/memory-service-tech-spec.md` and `docs/memory-architecture-decision.md`
in the repo root for design background.

## Local development

```bash
cd services/memory-service
cp .env.example .env

# 1. PostgreSQL with pgvector + pg_trgm
docker compose up -d

# 2. Install deps
npm install

# 3. Run migrations
npm run migrate

# 4. Start the service in dev mode
npm run dev
```

The service listens on `HTTP_PORT` (default `4310`).

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /healthz` | public | liveness |
| `GET /readyz` | public | readiness (pings DB) |
| `GET /v1/whoami` | identity | echo decoded identity, smoke-test the auth header |

## Identity header

Every authenticated route requires an `X-Memory-Identity` header. The header is
`<base64url(payload)>.<base64url(hmac-sha256(payload))>`, where payload is:

```json
{ "business_id": "dealer_001", "user_id": "u_42", "agent_id": "openclaw", "issued_at": 1714000000, "scope": [] }
```

The shared secret lives in `SERVICE_TOKEN_SECRET`. SDK signs and rotates this
header on every request; tokens older than 5 minutes are rejected.

## Embedding

Default provider is `bge-m3-ollama`, which calls a locally running Ollama
instance. To bring up Ollama for development:

```bash
ollama serve            # in a separate terminal
ollama pull bge-m3
```

Set `EMBEDDING_PROVIDER=hash-fallback` to skip Ollama (local CI / smoke tests).
