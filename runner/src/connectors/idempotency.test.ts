import http from "node:http";
import { sql } from "../db/client.js";
import { DEFAULT_COMPANY_ID } from "../intake/config.js";
import { upsertConnectorDefinition } from "./connectorStore.js";
import { registerConnectorConnection, runTaskViaConnectors } from "./runtime.js";

let failed = 0;

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
}

async function withCountingHttpServer<T>(
  handler: (baseUrl: string, getHits: () => number, getIdempotencyKeys: () => string[]) => Promise<T>,
  statusForHit: (hit: number) => number = () => 200,
): Promise<T> {
  let hits = 0;
  const idempotencyKeys: string[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/execute") {
      hits += 1;
      idempotencyKeys.push(String(req.headers["idempotency-key"] ?? ""));
      req.resume();
      const status = statusForHit(hits);
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: status >= 200 && status < 300, hit: hits }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind idempotency test server");
  }

  try {
    return await handler(`http://127.0.0.1:${address.port}`, () => hits, () => [...idempotencyKeys]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

console.log("[1] concurrent execute for one task performs one connector call");

await withCountingHttpServer(async (baseUrl, getHits, getIdempotencyKeys) => {
  const connectorKey = `flowfit_idempotency_probe_${Date.now()}`;
  const connectionId = `conn_${connectorKey}`;
  const taskId = `task_idempotency_${Date.now()}`;
  const companyId = `company_${connectorKey}`;

  await upsertConnectorDefinition({
    key: connectorKey,
    label: "FlowFit Idempotency Probe",
    kind: "webhook",
    provides: ["inventory.read"],
    supportsPush: false,
    defaultPriority: 1,
    mappingProfile: {
      baseUrl,
      authType: "none",
      endpoint: { method: "POST", path: "/execute" },
      healthPath: "/execute",
      healthMethod: "POST",
      supportsPush: false,
      idempotency: { supported: true, headerName: "Idempotency-Key" },
    },
  });

  await registerConnectorConnection({
    id: connectionId,
    companyId,
    connectorKey,
    credentialRef: "none",
    capabilitiesEnabled: ["inventory.read"],
    priorityOverride: 1,
  });

  await sql`
    INSERT INTO tasks (
      id, company_id, task_type, status, extracted_fields_json, context_json, context_status, confidence, risk_level, updated_at
    ) VALUES (
      ${taskId},
      ${companyId},
      'inventory_check',
      'pending_policy',
      ${JSON.stringify({ title: "idempotency probe", itemName: "probe item" })},
      ${JSON.stringify({ item: { id: `item_${taskId}`, name: "probe item" } })},
      'matched',
      0.96,
      'low',
      NOW()
    )
  `;

  const [first, second] = await Promise.all([
    runTaskViaConnectors(taskId),
    runTaskViaConnectors(taskId),
  ]);

  const statusRows = await sql`SELECT status FROM tasks WHERE id = ${taskId} LIMIT 1`;
  const eventRows = await sql`
    SELECT action
    FROM audit_logs
    WHERE target_type = 'task' AND target_id = ${taskId}
    ORDER BY created_at ASC
  `;
  const statuses = [first.status, second.status].sort();
  const executedEvents = eventRows.filter((row: Record<string, unknown>) => String(row.action) === "connector_Executed").length;

  check("one result executed", statuses.filter((status) => status === "executed").length === 1, statuses.join(","));
  check("one result blocked", statuses.filter((status) => status === "blocked").length === 1, statuses.join(","));
  check("final task status completed", String(statusRows[0]?.status ?? "") === "completed", String(statusRows[0]?.status ?? ""));
  check("connector HTTP call count is one", getHits() === 1, `hits=${getHits()}`);
  check("idempotency key is task id", getIdempotencyKeys()[0] === taskId, getIdempotencyKeys().join(","));
  check("connector_Executed audit event count is one", executedEvents === 1, `events=${executedEvents}`);
});

console.log("[2] retry_pending can retry, but completed stays locked");

await withCountingHttpServer(async (baseUrl, getHits, getIdempotencyKeys) => {
  const connectorKey = `flowfit_retry_probe_${Date.now()}`;
  const connectionId = `conn_${connectorKey}`;
  const taskId = `task_retry_${Date.now()}`;
  const companyId = `company_${connectorKey}`;

  await upsertConnectorDefinition({
    key: connectorKey,
    label: "FlowFit Retry Probe",
    kind: "webhook",
    provides: ["inventory.read"],
    supportsPush: false,
    defaultPriority: 1,
    mappingProfile: {
      baseUrl,
      authType: "none",
      endpoint: { method: "POST", path: "/execute" },
      healthPath: "/execute",
      healthMethod: "POST",
      supportsPush: false,
      idempotency: { supported: true, headerName: "Idempotency-Key" },
    },
  });

  await registerConnectorConnection({
    id: connectionId,
    companyId,
    connectorKey,
    credentialRef: "none",
    capabilitiesEnabled: ["inventory.read"],
    priorityOverride: 1,
  });

  await sql`
    INSERT INTO tasks (
      id, company_id, task_type, status, extracted_fields_json, context_json, context_status, confidence, risk_level, updated_at
    ) VALUES (
      ${taskId},
      ${companyId},
      'inventory_check',
      'pending_policy',
      ${JSON.stringify({ title: "retry probe", itemName: "retry item" })},
      ${JSON.stringify({ item: { id: `item_${taskId}`, name: "retry item" } })},
      'matched',
      0.96,
      'low',
      NOW()
    )
  `;

  const first = await runTaskViaConnectors(taskId);
  const afterFirst = await sql`SELECT status FROM tasks WHERE id = ${taskId} LIMIT 1`;
  const second = await runTaskViaConnectors(taskId);
  const afterSecond = await sql`SELECT status FROM tasks WHERE id = ${taskId} LIMIT 1`;
  const third = await runTaskViaConnectors(taskId);
  const eventRows = await sql`
    SELECT action
    FROM audit_logs
    WHERE target_type = 'task' AND target_id = ${taskId}
    ORDER BY created_at ASC
  `;
  const executedEvents = eventRows.filter((row: Record<string, unknown>) => String(row.action) === "connector_Executed").length;
  const keys = getIdempotencyKeys();

  check("first result executed with failed HTTP", first.status === "executed" && first.result.ok === false && first.result.status === 503);
  check("first failure becomes retry_pending", String(afterFirst[0]?.status ?? "") === "retry_pending", String(afterFirst[0]?.status ?? ""));
  check("second retry executes successfully", second.status === "executed" && second.result.ok === true && second.result.status === 200);
  check("second success becomes completed", String(afterSecond[0]?.status ?? "") === "completed", String(afterSecond[0]?.status ?? ""));
  check("third call after completed is blocked", third.status === "blocked");
  check("retry connector HTTP call count is two", getHits() === 2, `hits=${getHits()}`);
  check("retry uses stable idempotency key", keys.length === 2 && keys.every((key) => key === taskId), keys.join(","));
  check("retry connector_Executed audit event count is two", executedEvents === 2, `events=${executedEvents}`);
}, (hit) => (hit === 1 ? 503 : 200));

if (failed > 0) {
  console.error(`IDEMPOTENCY_TEST_FAIL ${failed}`);
  process.exitCode = 1;
} else {
  console.log("IDEMPOTENCY_TEST_OK");
}
