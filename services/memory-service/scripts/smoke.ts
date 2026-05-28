/**
 * scripts/smoke.ts — Phase 1.1 boot smoke
 *
 * Boots the HTTP server with an inject-only request flow (no real port binding,
 * no real DB needed for the public-route assertions) and exercises:
 *   - GET /healthz   → 200
 *   - GET /v1/whoami without identity → 401
 *   - GET /v1/whoami with valid identity → 200, echoes identity
 *
 * Skips /readyz unless SMOKE_REQUIRE_DB=1 (which expects DB to be running).
 */

import { buildServer } from "../src/http/server.js";
import { signIdentity } from "../src/http/identity.js";
import { loadConfig } from "../src/config/env.js";
import { pool } from "../src/db/pool.js";

async function main(): Promise<void> {
  loadConfig();
  const app = await buildServer();
  let failed = 0;

  const expect = (label: string, ok: boolean, detail?: unknown) => {
    if (ok) {
      console.log(`  ✓ ${label}`);
    } else {
      console.log(`  ✗ ${label}`, detail ?? "");
      failed += 1;
    }
  };

  // 1. healthz public
  {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect("healthz returns 200", res.statusCode === 200, res.statusCode);
    expect("healthz body ok=true", res.json().ok === true);
  }

  // 2. whoami without identity → 401
  {
    const res = await app.inject({ method: "GET", url: "/v1/whoami" });
    expect("whoami without identity → 401", res.statusCode === 401, res.statusCode);
    expect("error code unauthorized", res.json().error === "unauthorized", res.json());
  }

  // 3. whoami with valid identity → 200
  {
    const token = signIdentity({
      business_id: "dealer_001",
      user_id: "u_42",
      agent_id: "openclaw",
      issued_at: Math.floor(Date.now() / 1000),
      scope: []
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/whoami",
      headers: { "x-memory-identity": token }
    });
    expect("whoami with identity → 200", res.statusCode === 200, res.body);
    const body = res.json();
    expect("identity.business_id echoed", body.identity?.business_id === "dealer_001", body);
    expect("identity.user_id echoed", body.identity?.user_id === "u_42", body);
  }

  // 4. tampered signature → 401
  {
    const token = signIdentity({
      business_id: "dealer_001",
      user_id: "u_42",
      issued_at: Math.floor(Date.now() / 1000),
      scope: []
    });
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    const res = await app.inject({
      method: "GET",
      url: "/v1/whoami",
      headers: { "x-memory-identity": tampered }
    });
    expect("tampered identity → 401", res.statusCode === 401, res.body);
  }

  // 5. readyz only if explicitly requested
  if (process.env.SMOKE_REQUIRE_DB === "1") {
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect("readyz returns 200 (DB up)", res.statusCode === 200, res.body);
  }

  await app.close();
  await pool.end().catch(() => undefined);

  if (failed > 0) {
    console.error(`\n${failed} smoke check(s) failed`);
    process.exit(1);
  }
  console.log("\nall smoke checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
