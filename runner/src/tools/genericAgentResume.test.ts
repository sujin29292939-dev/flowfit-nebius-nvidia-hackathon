import type { Tier } from "../connectors/offlinePolicy.js";
import {
  GenericAgentResumeCoordinator,
  buildGenericAgentResumeMetadata,
  hashPayload,
  type ResumeDeps,
} from "./genericAgentResume.js";

const H = 60 * 60 * 1000;
const payload = { to: "namdo-nongsan@example.com", subject: "교환 안내", body: "파손 3박스 교환 처리" };

function check(name: string, condition: boolean) {
  if (!condition) throw new Error(`FAIL: ${name}`);
  console.log(`PASS: ${name}`);
}

function makeCoordinator(policyTier: Tier = "ASSIST") {
  const calls = {
    recheck: [] as string[],
    executed: [] as { action: string; token: string }[],
  };
  const deps: ResumeDeps = {
    recheckPolicy: (action) => {
      calls.recheck.push(action);
      return policyTier;
    },
    issueToken: (action, at) => ({ token: `tok-${action}-${at}`, issuedAt: at }),
    execute: (action, _payload, token) => calls.executed.push({ action, token }),
    rejudge: () => {},
  };
  return { coordinator: new GenericAgentResumeCoordinator(deps), calls };
}

{
  const { coordinator, calls } = makeCoordinator();
  const card = coordinator.createGuardCard({
    runId: "run-1",
    taskId: "task-1",
    actionName: "send_email",
    payload,
    contextDependency: "none",
    now: 0,
  });
  coordinator.approve(card.id);
  check(
    "Generic Agent resume: standalone action executes with a new token",
    coordinator.resume(card.id, payload, 2 * H) === "executed-standalone" && calls.executed.length === 1,
  );
}

{
  const { coordinator } = makeCoordinator();
  const card = coordinator.createGuardCard({
    runId: "run-1",
    taskId: "task-1",
    actionName: "send_email",
    payload,
    contextDependency: "none",
    now: 0,
  });
  coordinator.approve(card.id);
  coordinator.resume(card.id, payload, 5 * H);
  check("Generic Agent resume: token is issued at resume time", coordinator.issuedTokens[0]?.issuedAt === 5 * H);
}

{
  const { coordinator, calls } = makeCoordinator();
  const card = coordinator.createGuardCard({
    runId: "run-1",
    taskId: "task-1",
    actionName: "send_email",
    payload,
    contextDependency: "none",
    now: 0,
  });
  coordinator.approve(card.id);
  const mutated = { ...payload, to: "attacker@example.com" };
  check(
    "Generic Agent resume: payload hash mismatch blocks execution",
    coordinator.resume(card.id, mutated, H) === "rejected-hash-mismatch" && calls.executed.length === 0,
  );
}

{
  const { coordinator } = makeCoordinator();
  const card = coordinator.createGuardCard({
    runId: "run-1",
    taskId: "task-1",
    actionName: "send_email",
    payload,
    contextDependency: "none",
    now: 0,
  });
  coordinator.approve(card.id);
  check("Generic Agent resume: first resume executes", coordinator.resume(card.id, payload, H) === "executed-standalone");
  check("Generic Agent resume: second resume is ignored", coordinator.resume(card.id, payload, H + 1) === "already-resumed");
  check("Generic Agent resume: external execution remains once", coordinator.executions.length === 1);
}

{
  const { coordinator, calls } = makeCoordinator();
  const card = coordinator.createGuardCard({
    runId: "run-1",
    taskId: "task-1",
    actionName: "write_report_file",
    payload: { path: "/sandbox/out.md" },
    contextDependency: "run-context",
    now: 0,
  });
  coordinator.approve(card.id);
  check(
    "Generic Agent resume: run-context action routes to rejudge",
    coordinator.resume(card.id, { path: "/sandbox/out.md" }, H) === "routed-to-rejudge"
      && calls.executed.length === 0
      && coordinator.rejudged[0]?.taskId === "task-1",
  );
}

{
  const { coordinator, calls } = makeCoordinator();
  const card = coordinator.createGuardCard({
    runId: "run-1",
    taskId: "task-1",
    actionName: "custom_tool_x",
    payload,
    contextDependency: "unknown",
    now: 0,
  });
  coordinator.approve(card.id);
  check(
    "Generic Agent resume: unknown dependency routes to rejudge",
    coordinator.resume(card.id, payload, H) === "routed-to-rejudge" && calls.executed.length === 0,
  );
}

{
  const { coordinator, calls } = makeCoordinator("BLOCK");
  const card = coordinator.createGuardCard({
    runId: "run-1",
    taskId: "task-1",
    actionName: "send_email",
    payload,
    contextDependency: "none",
    now: 0,
  });
  coordinator.approve(card.id);
  check(
    "Generic Agent resume: hard block wins over approval",
    coordinator.resume(card.id, payload, H) === "rejected-hard-block" && calls.executed.length === 0,
  );
}

{
  const { coordinator, calls } = makeCoordinator();
  const card = coordinator.createGuardCard({
    runId: "run-1",
    taskId: "task-1",
    actionName: "send_email",
    payload,
    contextDependency: "none",
    now: 0,
  });
  coordinator.approve(card.id);
  check(
    "Generic Agent resume: expired card is rejected and rejudged",
    coordinator.resume(card.id, payload, 25 * H) === "rejected-expired"
      && calls.executed.length === 0
      && coordinator.rejudged.length === 1,
  );
}

{
  const { coordinator, calls } = makeCoordinator();
  const card = coordinator.createGuardCard({
    runId: "run-1",
    taskId: "task-1",
    actionName: "send_email",
    payload,
    contextDependency: "none",
    now: 0,
  });
  coordinator.approve(card.id);
  coordinator.resume(card.id, payload, H);
  check("Generic Agent resume: policy is rechecked", calls.recheck.join(",") === "send_email");
}

check("Generic Agent resume: stable hash ignores object key order", hashPayload({ b: 2, a: 1 }) === hashPayload({ a: 1, b: 2 }));

{
  const metadata = buildGenericAgentResumeMetadata({
    actionName: "send_email",
    hasPayload: true,
    payload,
    contextDependency: "none",
  });
  check(
    "Generic Agent resume metadata: captured payload stores hash",
    metadata.payloadCaptured === true && metadata.payloadHash === hashPayload(payload) && metadata.contextDependency === "none",
  );
}

{
  const metadata = buildGenericAgentResumeMetadata({
    actionName: "send_email",
    hasPayload: false,
    contextDependency: "none",
  });
  check(
    "Generic Agent resume metadata: missing payload fails closed as unknown",
    metadata.payloadCaptured === false && metadata.payloadHash === undefined && metadata.contextDependency === "unknown",
  );
}
