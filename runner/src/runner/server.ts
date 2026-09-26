// runner/server.ts
import http            from "node:http";
import { randomUUID, timingSafeEqual }  from "node:crypto";
import { broadcaster } from "./sse.js";
import { requireAuth } from "./auth.js";
import { queue }       from "./queue.js";
import * as db         from "../db/client.js";
import type { ExecutionBrief } from "../agent/executionBrief.js";
import { createIntake, listIntakes } from "../intake/store.js";
import { parseEmailPayload, parseMessengerPayload, parseSitePayload, parseSmsPayload } from "../intake/webhookParsers.js";
import { listSiteSessions, storeEncryptedSiteSession } from "../security/sessionVault.js";
import { scheduleUnderstanding, understandAndStoreIntake, understandAndStoreRaw, understandPendingIntakes } from "../understanding/runner.js";
import { groqGeneralChat } from "../understanding/generalChat.js";
import { listTasks } from "../understanding/taskStore.js";
import { listContextCatalog } from "../context/store.js";
import { matchAndStoreTaskContext, matchPendingTaskContexts, matchRawTaskContext } from "../context/runner.js";
import type { CompanyContextCatalog, TaskForContext } from "../context/types.js";
import { decideAndStoreTask } from "../decision/runner.js";
import { ApprovalAlreadyResolvedError, ApprovalExpiredError, createApprovalRequest, listApprovalRequests, resolveApprovalRequest } from "../approvals/store.js";
import { findApplicableRulesForTask, listRuleMemory, setRuleOfflineServerSafe } from "../memory/ruleMemory.js";
import { getAutonomyGateSnapshot, listAutonomyCriteria, upsertAutonomyCriterion } from "../autonomyGate/runtime.js";
import {
  listConnectorDefinitions,
  listConnectorRuntimeStatus,
  registerConnectorConnection,
  runConnectorHealthChecks,
  runTaskViaConnectors,
} from "../connectors/runtime.js";
import { retryPendingConnectorTasks } from "../connectors/retryWorker.js";
import { scanDueTasks } from "../sla/dueScanner.js";
import { getTaskTimeline } from "../timeline/taskTimeline.js";
import { getOperationsMetrics } from "../metrics/operationsMetrics.js";
import {
  createStaffConfirmationRequest,
  listStaffConfirmationRequests,
  markStaffConfirmationSent,
  respondStaffConfirmationRequest,
} from "../staffConfirmations/store.js";
import { provisionFirstRunSession } from "../provisioning/sessionProvisioning.js";
import {
  authenticateDevice,
  confirmDeviceSnapshotVerified,
  createPairingCode,
  enqueueCommand,
  listDevices,
  pairDevice,
  pollCommands,
  refreshDeviceToken,
  reportCommandResult,
  revokeDevice,
  setDeviceStage,
} from "../devices/store.js";
import { evaluateCommandGate, exportGateSnapshot } from "../devices/commandGate.js";
import { dispatchTaskToDevice } from "../devices/taskDispatch.js";
import { listProcedureCandidates, promoteProcedureCandidate, recordObservationBatch } from "../procedures/store.js";
import { getAiRuntimeTelemetry } from "../llm/runtimeTelemetry.js";

const PORT = Number(process.env.PORT ?? 3001);

function json(res: http.ServerResponse, status: number, body: unknown) {
  const origin = process.env.STUDIO_ORIGIN ?? "*";
  res.writeHead(status, {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": origin,
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage, limitBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > limitBytes) {
        reject(new Error(`Request body too large. limit=${limitBytes}`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end",  ()  => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error",    reject);
  });
}

async function readPayload(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req, 2_000_000);
  const contentType = String(req.headers["content-type"] ?? "");

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function hasValidWebhookSecret(req: http.IncomingMessage, secret?: string) {
  if (!secret) return false;
  const received =
    String(req.headers["x-flowfit-webhook-secret"] ?? "") ||
    String(req.headers["x-webhook-secret"] ?? "");
  if (!received) return false;

  const expected = Buffer.from(secret);
  const actual = Buffer.from(received);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function createServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const url    = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    const method = req.method ?? "GET";
    const origin = process.env.STUDIO_ORIGIN ?? "*";

    // CORS preflight: 인증 없이 통과
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin":  origin,
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return;
    }

    // ── External intake webhooks ───────────────────────────
    // 외부 SMS/이메일 서비스는 Bearer 대신 x-flowfit-webhook-secret을 쓸 수 있다.
    if (method === "POST" && url.pathname === "/webhook/sms") {
      if (!hasValidWebhookSecret(req, process.env.SMS_WEBHOOK_SECRET) && requireAuth(req, res, origin)) return;
      try {
        const payload = await readPayload(req);
        const provider = process.env.SMS_PROVIDER ?? String(url.searchParams.get("provider") ?? "generic");
        const intake = await createIntake(parseSmsPayload(payload, provider));
        if (!intake.duplicate) scheduleUnderstanding(intake.id);
        json(res, intake.duplicate ? 200 : 201, intake);
      } catch (err) {
        json(res, 400, { error: `Invalid SMS webhook: ${err}` });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/webhook/email") {
      if (!hasValidWebhookSecret(req, process.env.EMAIL_WEBHOOK_SECRET) && requireAuth(req, res, origin)) return;
      try {
        const payload = await readPayload(req);
        const intake = await createIntake(parseEmailPayload(payload));
        if (!intake.duplicate) scheduleUnderstanding(intake.id);
        json(res, intake.duplicate ? 200 : 201, intake);
      } catch (err) {
        json(res, 400, { error: `Invalid email webhook: ${err}` });
      }
      return;
    }

    if (method === "POST" && (url.pathname === "/webhook/messenger" || url.pathname === "/webhook/kakao")) {
      if (!hasValidWebhookSecret(req, process.env.MESSENGER_WEBHOOK_SECRET) && requireAuth(req, res, origin)) return;
      try {
        const payload = await readPayload(req);
        const provider = String(url.searchParams.get("provider") ?? payload.provider ?? process.env.MESSENGER_PROVIDER ?? "kakao_work");
        const intake = await createIntake(parseMessengerPayload(payload, provider));
        if (!intake.duplicate) scheduleUnderstanding(intake.id);
        json(res, intake.duplicate ? 200 : 201, intake);
      } catch (err) {
        json(res, 400, { error: `Invalid messenger webhook: ${err}` });
      }
      return;
    }

    // Mock connector endpoint is used by the local resolver smoke connector.
    if (method === "POST" && url.pathname === "/connectors/mock/execute") {
      try {
        const payload = await readPayload(req);
        json(res, 200, {
          ok: true,
          connector: "flowfit_mock",
          receivedAt: new Date().toISOString(),
          payload,
        });
      } catch (err) {
        json(res, 400, { error: `Mock connector failed: ${err}` });
      }
      return;
    }

    // Thin agents can register with a one-time pairing code. They must not need the Runner API key.
    if (method === "POST" && url.pathname === "/devices/pair") {
      try {
        const payload = await readPayload(req);
        const pairingCode = typeof payload.pairingCode === "string" ? payload.pairingCode : "";
        if (!pairingCode) { json(res, 400, { error: "pairingCode is required" }); return; }
        const result = await pairDevice({
          pairingCode,
          label: typeof payload.label === "string" ? payload.label : undefined,
          platform: typeof payload.platform === "string" ? payload.platform : undefined,
          agentVersion: typeof payload.agentVersion === "string" ? payload.agentVersion : undefined,
          capabilityScope: Array.isArray(payload.capabilityScope)
            ? payload.capabilityScope.filter((item): item is string => typeof item === "string")
            : undefined,
        });
        if ("error" in result) { json(res, 400, result); return; }
        json(res, 201, result);
      } catch (err) {
        json(res, 400, { error: `Device pair failed: ${err}` });
      }
      return;
    }

    // ── Device agent 교신 (기기 토큰 인증) ─────────────────
    // 관리자 Bearer가 아니라 기기 토큰으로 인증한다. requireAuth 이전에 처리한다.
    const deviceCommandsMatch = url.pathname.match(/^\/devices\/([^/]+)\/commands$/);
    if (method === "GET" && deviceCommandsMatch) {
      const device = await authenticateDeviceRequest(req, deviceCommandsMatch[1]);
      if (!device) { json(res, 401, { error: "device_auth_failed" }); return; }
      try {
        const limit = Number(url.searchParams.get("limit") ?? 5);
        const commands = await pollCommands(device.id, Number.isFinite(limit) ? limit : 5);
        json(res, 200, { count: commands.length, commands });
      } catch (err) {
        json(res, 500, { error: `Device command poll failed: ${err}` });
      }
      return;
    }

    const deviceResultsMatch = url.pathname.match(/^\/devices\/([^/]+)\/results$/);
    if (method === "POST" && deviceResultsMatch) {
      const device = await authenticateDeviceRequest(req, deviceResultsMatch[1]);
      if (!device) { json(res, 401, { error: "device_auth_failed" }); return; }
      try {
        const payload = await readPayload(req);
        const result = await reportCommandResult({
          deviceId: device.id,
          commandId: String(payload.commandId ?? ""),
          nonce: String(payload.nonce ?? ""),
          status: payload.status === "succeeded" ? "succeeded" : "failed",
          result: payload.result,
          evidence: isRecord(payload.evidence) ? payload.evidence as never : undefined,
        });
        if ("error" in result) { json(res, 400, result); return; }
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `Device result report failed: ${err}` });
      }
      return;
    }

    // SHADOW 절차 관찰 수집: 에이전트가 관찰한 사용자 조작 배치를 받는다.
    const deviceObsMatch = url.pathname.match(/^\/devices\/([^/]+)\/observations$/);
    if (method === "POST" && deviceObsMatch) {
      const device = await authenticateDeviceRequest(req, deviceObsMatch[1]);
      if (!device) { json(res, 401, { error: "device_auth_failed" }); return; }
      try {
        const payload = await readPayload(req);
        const actions = Array.isArray(payload.actions) ? payload.actions : [];
        const result = await recordObservationBatch({
          companyId: device.companyId,
          deviceId: device.id,
          capability: typeof payload.capability === "string" ? payload.capability : undefined,
          actions: actions as never,
        });
        json(res, 201, result);
      } catch (err) {
        json(res, 400, { error: `Observation record failed: ${err}` });
      }
      return;
    }

    // 로컬 안전판 캐시 동기화: 에이전트가 정책 스냅샷을 받아 마지막 검문에 쓴다.
    const deviceGateSyncMatch = url.pathname.match(/^\/devices\/([^/]+)\/gate-policy$/);
    if (method === "GET" && deviceGateSyncMatch) {
      const device = await authenticateDeviceRequest(req, deviceGateSyncMatch[1]);
      if (!device) { json(res, 401, { error: "device_auth_failed" }); return; }
      json(res, 200, exportGateSnapshot());
      return;
    }

    const deviceSnapshotVerifiedMatch = url.pathname.match(/^\/devices\/([^/]+)\/snapshot-verified$/);
    if (method === "POST" && deviceSnapshotVerifiedMatch) {
      const device = await authenticateDeviceRequest(req, deviceSnapshotVerifiedMatch[1]);
      if (!device) { json(res, 401, { error: "device_auth_failed" }); return; }
      try {
        const ok = await confirmDeviceSnapshotVerified(device.id);
        json(res, ok ? 200 : 400, ok ? { ok: true, mode: "ONLINE" } : { error: "snapshot_verify_failed" });
      } catch (err) {
        json(res, 400, { error: `Device snapshot verification failed: ${err}` });
      }
      return;
    }

    const deviceTokenRefreshMatch = url.pathname.match(/^\/devices\/([^/]+)\/token\/refresh$/);
    if (method === "POST" && deviceTokenRefreshMatch) {
      const device = await authenticateDeviceRequest(req, deviceTokenRefreshMatch[1]);
      if (!device) { json(res, 401, { error: "device_auth_failed" }); return; }
      try {
        const refreshed = await refreshDeviceToken(device.id);
        if (!refreshed) { json(res, 400, { error: "token_refresh_failed" }); return; }
        json(res, 200, refreshed);
      } catch (err) {
        json(res, 400, { error: `Device token refresh failed: ${err}` });
      }
      return;
    }

    // Bearer token validation for protected routes.
    if (requireAuth(req, res, origin)) return;

    if (method === "GET" && url.pathname === "/runtime/ai") {
      json(res, 200, getAiRuntimeTelemetry());
      return;
    }

    // ── Device 관리 (관리자 Bearer 인증) ───────────────────
    if (method === "POST" && url.pathname === "/devices/pairing-codes") {
      try {
        const payload = await readPayload(req);
        const result = await createPairingCode({
          companyId: typeof payload.companyId === "string" ? payload.companyId : "company_demo",
          label: typeof payload.label === "string" ? payload.label : undefined,
          maxUses: typeof payload.maxUses === "number" ? payload.maxUses : undefined,
          expiresInHours: typeof payload.expiresInHours === "number" ? payload.expiresInHours : undefined,
        });
        json(res, 201, result);
      } catch (err) {
        json(res, 400, { error: `Pairing code create failed: ${err}` });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/session/provision") {
      try {
        const payload = await readPayload(req);
        const token = typeof payload.token === "string" ? payload.token : "";
        if (!token.trim()) { json(res, 400, { error: "token is required" }); return; }
        const result = await provisionFirstRunSession({
          token,
          deviceLabel: typeof payload.deviceLabel === "string" ? payload.deviceLabel : undefined,
        });
        if ("error" in result) { json(res, 400, result); return; }
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `Session provision failed: ${err}` });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/devices") {
      try {
        const devices = await listDevices(url.searchParams.get("companyId") ?? undefined);
        json(res, 200, { count: devices.length, devices });
      } catch (err) {
        json(res, 500, { error: `Device list failed: ${err}` });
      }
      return;
    }

    const deviceRevokeMatch = url.pathname.match(/^\/devices\/([^/]+)\/revoke$/);
    if (method === "POST" && deviceRevokeMatch) {
      try {
        const ok = await revokeDevice(deviceRevokeMatch[1]);
        json(res, ok ? 200 : 404, { ok });
      } catch (err) {
        json(res, 400, { error: `Device revoke failed: ${err}` });
      }
      return;
    }

    const deviceStageMatch = url.pathname.match(/^\/devices\/([^/]+)\/stage$/);
    if (method === "POST" && deviceStageMatch) {
      try {
        const payload = await readPayload(req);
        const stage = payload.stage;
        if (stage !== "SHADOW" && stage !== "ASSIST" && stage !== "AUTO") {
          json(res, 400, { error: "stage must be SHADOW | ASSIST | AUTO" });
          return;
        }
        const ok = await setDeviceStage(deviceStageMatch[1], stage);
        json(res, ok ? 200 : 404, { ok });
      } catch (err) {
        json(res, 400, { error: `Device stage update failed: ${err}` });
      }
      return;
    }

    // 절차 후보 조회 (관리자): SHADOW 관찰에서 형성된 절차 후보 목록
    if (method === "GET" && url.pathname === "/procedures/candidates") {
      try {
        const candidates = await listProcedureCandidates({
          companyId: url.searchParams.get("companyId") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
        });
        json(res, 200, { count: candidates.length, candidates });
      } catch (err) {
        json(res, 500, { error: `Procedure candidate list failed: ${err}` });
      }
      return;
    }

    // 절차 후보 승격 (관리자만): 후보 → 활성. 활성화의 유일한 경로.
    const procPromoteMatch = url.pathname.match(/^\/procedures\/candidates\/([^/]+)\/promote$/);
    if (method === "POST" && procPromoteMatch) {
      try {
        const payload = await readPayload(req);
        const result = await promoteProcedureCandidate({
          candidateId: procPromoteMatch[1],
          promotedBy: typeof payload.promotedBy === "string" ? payload.promotedBy : "admin",
          isAdmin: payload.isAdmin !== false,
        });
        json(res, result.ok ? 200 : 400, result);
      } catch (err) {
        json(res, 400, { error: `Procedure promotion failed: ${err}` });
      }
      return;
    }

    // 승인된 업무 → device 명령 큐 (절차 템플릿으로 스텝 생성 후 등록)
    if (method === "POST" && url.pathname === "/devices/dispatch") {
      try {
        const payload = await readPayload(req);
        const capability = typeof payload.capability === "string" ? payload.capability : "";
        if (!capability || !isRecord(payload.fields)) {
          json(res, 400, { error: "capability and fields are required" });
          return;
        }
        const result = await dispatchTaskToDevice({
          companyId: typeof payload.companyId === "string" ? payload.companyId : "company_demo",
          capability,
          fields: payload.fields as Record<string, unknown>,
          taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
          approvalId: typeof payload.approvalId === "string" ? payload.approvalId : undefined,
          deviceId: typeof payload.deviceId === "string" ? payload.deviceId : undefined,
        });
        json(res, result.ok ? 201 : 400, result);
      } catch (err) {
        json(res, 400, { error: `Task dispatch failed: ${err}` });
      }
      return;
    }

    const deviceCommandEnqueueMatch = url.pathname.match(/^\/devices\/([^/]+)\/commands$/);
    if (method === "POST" && deviceCommandEnqueueMatch) {
      try {
        const payload = await readPayload(req);
        const capability = typeof payload.capability === "string" ? payload.capability : "";
        const steps = Array.isArray(payload.steps) ? payload.steps : [];
        if (!capability || steps.length === 0) {
          json(res, 400, { error: "capability and steps are required" });
          return;
        }
        const result = await enqueueCommand({
          deviceId: deviceCommandEnqueueMatch[1],
          companyId: typeof payload.companyId === "string" ? payload.companyId : "company_demo",
          capability,
          steps: steps as never,
          taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
          approvalId: typeof payload.approvalId === "string" ? payload.approvalId : undefined,
          idempotencyKey: typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : undefined,
          ttlMs: typeof payload.ttlMs === "number" ? payload.ttlMs : undefined,
        });
        if ("error" in result) { json(res, 400, result); return; }
        json(res, 201, result);
      } catch (err) {
        json(res, 400, { error: `Device command enqueue failed: ${err}` });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/intakes/site") {
      try {
        const payload = await readPayload(req);
        const intake = await createIntake(parseSitePayload(payload));
        if (!intake.duplicate && payload.syncUnderstanding !== true) scheduleUnderstanding(intake.id);
        json(res, intake.duplicate ? 200 : 201, intake);
      } catch (err) {
        json(res, 400, { error: `Invalid site intake: ${err}` });
      }
      return;
    }

    // ── Task Understanding Engine ──────────────────────────
    if (method === "POST" && url.pathname === "/understand") {
      try {
        const payload = await readPayload(req);
        const rawText = typeof payload.rawText === "string" ? payload.rawText : "";
        if (!rawText.trim()) {
          json(res, 400, { error: "rawText is required" });
          return;
        }
        const result = await understandAndStoreRaw({
          companyId: typeof payload.companyId === "string" ? payload.companyId : "company_demo",
          sourceType: typeof payload.sourceType === "string" ? payload.sourceType : "manual",
          sourceName: typeof payload.sourceName === "string" ? payload.sourceName : undefined,
          rawText,
          receivedAt: typeof payload.receivedAt === "string" ? payload.receivedAt : undefined,
        });
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `Understanding failed: ${err}` });
      }
      return;
    }

    // ── Chat single-entry pipeline ─────────────────────────
    // 운영 채팅 한 줄 → intake 저장 → 이해 → 맥락 → 판단까지 동기로 실행하고
    // 채팅 카드에 필요한 모든 결과를 한 번에 반환한다.
    if (method === "POST" && url.pathname === "/chat/work") {
      try {
        const payload = await readPayload(req);
        const text = typeof payload.text === "string" ? payload.text : "";
        if (!text.trim()) {
          json(res, 400, { error: "text is required" });
          return;
        }

        const intake = await createIntake(parseSitePayload({
          companyId: payload.companyId,
          text,
          sourceName: typeof payload.sourceName === "string" ? payload.sourceName : "operation_chat",
          externalId: typeof payload.externalId === "string" ? payload.externalId : undefined,
          receivedAt: typeof payload.receivedAt === "string" ? payload.receivedAt : undefined,
        }));

        if (intake.duplicate) {
          json(res, 200, { duplicate: true, intake });
          return;
        }

        const understood = await understandAndStoreIntake(intake.id);
        const taskId = String((understood.task as Record<string, unknown>)?.id ?? "");

        let context: unknown = null;
        let decision: unknown = null;
        let approval: unknown = null;
        if (taskId) {
          try {
            context = await matchAndStoreTaskContext(taskId);
          } catch (error) {
            context = { error: String(error) };
          }
          try {
            const decided = await decideAndStoreTask(taskId);
            decision = decided.decision;
            approval = decided.approval;
          } catch (error) {
            decision = { error: String(error) };
          }
        }

        json(res, 200, {
          duplicate: false,
          intakeId: intake.id,
          taskId: taskId || null,
          understanding: understood.understanding,
          context,
          decision,
          approval,
        });
      } catch (err) {
        json(res, 400, { error: `Chat work failed: ${err}` });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/chat") {
      try {
        const payload = await readPayload(req);
        const message = typeof payload.message === "string" ? payload.message : "";
        if (!message.trim()) {
          json(res, 400, { error: "message is required" });
          return;
        }
        const system = typeof payload.system === "string" ? payload.system : undefined;
        const history = Array.isArray(payload.history)
          ? payload.history
              .map((item) => {
                if (!isRecord(item)) return null;
                const role = item.role === "user" || item.role === "assistant" ? item.role : null;
                const content = typeof item.content === "string" ? item.content : "";
                return role && content.trim() ? { role, content } : null;
              })
              .filter((item): item is { role: "user" | "assistant"; content: string } => Boolean(item))
          : undefined;
        const result = await groqGeneralChat({ message, system, history });
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `Chat failed: ${err}` });
      }
      return;
    }

    const understandMatch = url.pathname.match(/^\/intakes\/([^/]+)\/understand$/);
    if (method === "POST" && understandMatch) {
      try {
        const result = await understandAndStoreIntake(understandMatch[1]);
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `Intake understanding failed: ${err}` });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/intakes/understand-pending") {
      try {
        const payload = await readPayload(req);
        const result = await understandPendingIntakes({
          companyId: typeof payload.companyId === "string" ? payload.companyId : undefined,
          limit: typeof payload.limit === "number" ? payload.limit : Number(payload.limit ?? 20),
        });
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `Pending understanding failed: ${err}` });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/metrics/operations") {
      try {
        const result = await getOperationsMetrics({
          companyId: url.searchParams.get("companyId") ?? undefined,
          windowDays: url.searchParams.get("windowDays") ? Number(url.searchParams.get("windowDays")) : undefined,
        });
        json(res, 200, result);
      } catch (err) {
        json(res, 500, { error: `Operations metrics failed: ${err}` });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/tasks") {
      try {
        const rows = await listTasks({
          companyId: url.searchParams.get("companyId") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          taskType: url.searchParams.get("taskType") ?? undefined,
          limit: Number(url.searchParams.get("limit") ?? 50),
        });
        json(res, 200, { count: rows.length, tasks: rows });
      } catch (err) {
        json(res, 500, { error: `Task list failed: ${err}` });
      }
      return;
    }

    // ── Context Engine ────────────────────────────────────
    const timelineMatch = url.pathname.match(/^\/tasks\/([^/]+)\/timeline$/);
    if (method === "GET" && timelineMatch) {
      try {
        const result = await getTaskTimeline(timelineMatch[1]);
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `Task timeline failed: ${err}` });
      }
      return;
    }

    const connectorRunMatch = url.pathname.match(/^\/tasks\/([^/]+)\/execute$/);
    if (method === "POST" && connectorRunMatch) {
      try {
        const result = await runTaskViaConnectors(connectorRunMatch[1]);
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `Connector execution failed: ${err}` });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/connectors/catalog") {
      try {
        const definitions = await listConnectorDefinitions();
        json(res, 200, { count: definitions.length, definitions });
      } catch (err) {
        json(res, 500, { error: `Connector catalog failed: ${err}` });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/connectors/status") {
      try {
        const status = await listConnectorRuntimeStatus(url.searchParams.get("companyId") ?? undefined);
        json(res, 200, status);
      } catch (err) {
        json(res, 500, { error: `Connector status failed: ${err}` });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/connectors/connections") {
      try {
        const payload = await readPayload(req);
        const result = await registerConnectorConnection({
          id: typeof payload.id === "string" ? payload.id : undefined,
          companyId: typeof payload.companyId === "string" ? payload.companyId : undefined,
          connectorKey: String(payload.connectorKey ?? ""),
          credentialRef: String(payload.credentialRef ?? ""),
          kind: typeof payload.kind === "string" ? payload.kind : undefined,
          config: isRecord(payload.config) ? payload.config : undefined,
          supportsPush: typeof payload.supportsPush === "boolean" ? payload.supportsPush : undefined,
          enabled: typeof payload.enabled === "boolean" ? payload.enabled : undefined,
          priorityOverride: typeof payload.priorityOverride === "number" ? payload.priorityOverride : null,
          capabilitiesEnabled: Array.isArray(payload.capabilitiesEnabled)
            ? payload.capabilitiesEnabled.filter((item): item is string => typeof item === "string")
            : undefined,
        });
        json(res, 201, result);
      } catch (err) {
        json(res, 400, { error: `Connector registration failed: ${err}` });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/connectors/health") {
      try {
        const payload = await readPayload(req);
        const result = await runConnectorHealthChecks(typeof payload.companyId === "string" ? payload.companyId : undefined);
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `Connector health check failed: ${err}` });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/connectors/retry-pending") {
      try {
        const payload = await readPayload(req);
        const result = await retryPendingConnectorTasks({
          limit: payload.limit === undefined ? undefined : Number(payload.limit),
          maxAttempts: payload.maxAttempts === undefined ? undefined : Number(payload.maxAttempts),
        });
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `Connector retry failed: ${err}` });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/context/match") {
      try {
        const payload = await readPayload(req);
        if (!isRecord(payload.task) || !isRecord(payload.catalog)) {
          json(res, 400, { error: "task and catalog are required" });
          return;
        }
        const context = await matchRawTaskContext(
          payload.task as unknown as TaskForContext,
          payload.catalog as unknown as CompanyContextCatalog,
        );
        json(res, 200, { context });
      } catch (err) {
        json(res, 400, { error: `Context match failed: ${err}` });
      }
      return;
    }

    const contextMatch = url.pathname.match(/^\/tasks\/([^/]+)\/context$/);
    if (method === "POST" && contextMatch) {
      try {
        const result = await matchAndStoreTaskContext(contextMatch[1]);
        const decision = await decideAndStoreTask(contextMatch[1]).catch((error) => ({
          error: String(error),
        }));
        json(res, 200, { ...result, decision });
      } catch (err) {
        json(res, 400, { error: `Task context match failed: ${err}` });
      }
      return;
    }

    const decisionMatch = url.pathname.match(/^\/tasks\/([^/]+)\/decide$/);
    if (method === "POST" && decisionMatch) {
      try {
        const result = await decideAndStoreTask(decisionMatch[1]);
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `Task decision failed: ${err}` });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/tasks/context-pending") {
      try {
        const payload = await readPayload(req);
        const result = await matchPendingTaskContexts({
          companyId: typeof payload.companyId === "string" ? payload.companyId : undefined,
          limit: typeof payload.limit === "number" ? payload.limit : Number(payload.limit ?? 20),
        });
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `Pending context match failed: ${err}` });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/context/catalog") {
      try {
        const catalog = await listContextCatalog({
          companyId: url.searchParams.get("companyId") ?? undefined,
        });
        json(res, 200, {
          customers: catalog.customers.length,
          items: catalog.items.length,
          inventory: catalog.inventory.length,
          catalog,
        });
      } catch (err) {
        json(res, 500, { error: `Context catalog failed: ${err}` });
      }
      return;
    }

    // ── Approval bridge ───────────────────────────────────
    // Runner에서 APPROVAL_REQUIRED가 생기면 approval_requests에 저장되고,
    // Studio는 이 API를 읽어 AI 작업 승인함 카드로 표시한다.
    if (method === "GET" && url.pathname === "/autonomy/criteria") {
      const criteria = listAutonomyCriteria();
      json(res, 200, { count: criteria.length, criteria });
      return;
    }

    if (method === "POST" && url.pathname === "/autonomy/criteria") {
      try {
        const payload = await readPayload(req);
        const criterionId = typeof payload.criterionId === "string" ? payload.criterionId : "";
        const criterionTitle = typeof payload.criterionTitle === "string" ? payload.criterionTitle : criterionId;
        const keywords = Array.isArray(payload.keywords)
          ? payload.keywords.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
          : [];
        if (!criterionId || !keywords.length) {
          json(res, 400, { error: "criterionId and keywords are required" });
          return;
        }
        const criterion = upsertAutonomyCriterion({
          criterionId,
          criterionTitle,
          autoAllowed: payload.autoAllowed === true,
          keywords,
          actionType: typeof payload.actionType === "string" ? payload.actionType : undefined,
        });
        json(res, 200, { criterion, criteria: listAutonomyCriteria() });
      } catch (err) {
        json(res, 400, { error: `Autonomy criterion update failed: ${err}` });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/autonomy/status") {
      json(res, 200, getAutonomyGateSnapshot());
      return;
    }

    if (method === "POST" && url.pathname === "/sla/scan") {
      try {
        const payload = await readPayload(req);
        const result = await scanDueTasks({
          horizonMinutes: payload.horizonMinutes === undefined ? undefined : Number(payload.horizonMinutes),
          approvalReminderMinutes: payload.approvalReminderMinutes === undefined ? undefined : Number(payload.approvalReminderMinutes),
          limit: payload.limit === undefined ? undefined : Number(payload.limit),
        });
        json(res, 200, result);
      } catch (err) {
        json(res, 400, { error: `SLA scan failed: ${err}` });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/staff-confirmations") {
      try {
        const requests = await listStaffConfirmationRequests({
          companyId: url.searchParams.get("companyId") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          limit: Number(url.searchParams.get("limit") ?? 50),
        });
        json(res, 200, { count: requests.length, requests });
      } catch (err) {
        json(res, 500, { error: `Staff confirmation list failed: ${err}` });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/staff-confirmations") {
      try {
        const payload = await readPayload(req);
        const staffName = typeof payload.staffName === "string" ? payload.staffName : "";
        const title = typeof payload.title === "string" ? payload.title : "";
        const question = typeof payload.question === "string" ? payload.question : "";
        const internalReason = typeof payload.internalReason === "string" ? payload.internalReason : "";
        if (!staffName || !title || !question || !internalReason) {
          json(res, 400, { error: "staffName, title, question, and internalReason are required" });
          return;
        }
        const request = await createStaffConfirmationRequest({
          id: typeof payload.id === "string" ? payload.id : undefined,
          companyId: typeof payload.companyId === "string" ? payload.companyId : undefined,
          aiWorkId: typeof payload.aiWorkId === "string" ? payload.aiWorkId : undefined,
          requestedByUserId: typeof payload.requestedByUserId === "string" ? payload.requestedByUserId : undefined,
          requestedByName: typeof payload.requestedByName === "string" ? payload.requestedByName : undefined,
          staffId: typeof payload.staffId === "string" ? payload.staffId : undefined,
          staffName,
          staffContact: typeof payload.staffContact === "string" ? payload.staffContact : undefined,
          channel: isStaffRequestChannel(payload.channel) ? payload.channel : undefined,
          status: isStaffRequestStatus(payload.status) ? payload.status : undefined,
          title,
          question,
          responseOptions: Array.isArray(payload.responseOptions)
            ? payload.responseOptions.filter((item): item is string => typeof item === "string")
            : undefined,
          messagePreview: typeof payload.messagePreview === "string" ? payload.messagePreview : undefined,
          internalReason,
        });
        json(res, 201, { request });
      } catch (err) {
        json(res, 400, { error: `Staff confirmation create failed: ${err}` });
      }
      return;
    }

    const staffSendMatch = url.pathname.match(/^\/staff-confirmations\/([^/]+)\/send$/);
    if (method === "POST" && staffSendMatch) {
      try {
        const request = await markStaffConfirmationSent(staffSendMatch[1]);
        json(res, 200, { request });
      } catch (err) {
        json(res, 400, { error: `Staff confirmation send failed: ${err}` });
      }
      return;
    }

    const staffRespondMatch = url.pathname.match(/^\/staff-confirmations\/([^/]+)\/respond$/);
    if (method === "POST" && staffRespondMatch) {
      try {
        const payload = await readPayload(req);
        const responseText = typeof payload.response === "string" ? payload.response : "";
        if (!responseText) {
          json(res, 400, { error: "response is required" });
          return;
        }
        const request = await respondStaffConfirmationRequest({
          id: staffRespondMatch[1],
          response: responseText,
          responseMemo: typeof payload.responseMemo === "string" ? payload.responseMemo : undefined,
        });
        json(res, 200, { request });
      } catch (err) {
        json(res, 400, { error: `Staff confirmation response failed: ${err}` });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/approvals") {
      try {
        const payload = await readPayload(req);
        const action = typeof payload.action === "string" ? payload.action : "";
        const reason = typeof payload.reason === "string" ? payload.reason : "";
        if (!action || !reason) {
          json(res, 400, { error: "action and reason are required" });
          return;
        }

        const approval = await createApprovalRequest({
          companyId: typeof payload.companyId === "string" ? payload.companyId : "company_demo",
          taskId: typeof payload.taskId === "string" ? payload.taskId : undefined,
          runId: typeof payload.runId === "string" ? payload.runId : undefined,
          action,
          reason,
          title: typeof payload.title === "string" ? payload.title : undefined,
          description: typeof payload.description === "string" ? payload.description : undefined,
          source: typeof payload.source === "string" ? payload.source : "policy_engine",
          riskLevel: isRiskLevel(payload.riskLevel) ? payload.riskLevel : undefined,
          approvalPolicy: isApprovalPolicy(payload.approvalPolicy) ? payload.approvalPolicy : undefined,
          expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : undefined,
          ttlMinutes: payload.ttlMinutes === undefined ? undefined : Number(payload.ttlMinutes),
          metadata: isRecord(payload.metadata) ? payload.metadata : {},
        });
        json(res, 201, { approval });
      } catch (err) {
        json(res, 400, { error: `Approval create failed: ${err}` });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/approvals") {
      try {
        const approvals = await listApprovalRequests({
          companyId: url.searchParams.get("companyId") ?? undefined,
          status: url.searchParams.get("status") ?? "pending",
          limit: Number(url.searchParams.get("limit") ?? 50),
        });
        json(res, 200, {
          count: approvals.length,
          approvals,
          aiWorkItems: approvals.map((item: { studioCard: unknown }) => item.studioCard),
        });
      } catch (err) {
        json(res, 500, { error: `Approval list failed: ${err}` });
      }
      return;
    }

    const approvalDecisionMatch = url.pathname.match(/^\/approvals\/([^/]+)\/(approve|reject)$/);
    if (method === "POST" && approvalDecisionMatch) {
      try {
        const payload = await readPayload(req);
        const approval = await resolveApprovalRequest({
          id: approvalDecisionMatch[1],
          decision: approvalDecisionMatch[2] === "approve" ? "approved" : "rejected",
          resolvedBy: typeof payload.resolvedBy === "string" ? payload.resolvedBy : "owner",
          note: typeof payload.note === "string" ? payload.note : undefined,
          deviceId: typeof payload.deviceId === "string" ? payload.deviceId : undefined,
          sessionId: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
        });
        const genericAgentResume = approvalDecisionMatch[2] === "approve"
          ? await handleGenericAgentApprovalResume(approval)
          : null;
        json(res, 200, { approval, genericAgentResume });
      } catch (err) {
        if (err instanceof ApprovalAlreadyResolvedError) {
          json(res, 409, {
            error: "approval_already_resolved",
            message: "Approval was already resolved by another device or session.",
            approval: err.approval,
          });
          return;
        }
        if (err instanceof ApprovalExpiredError) {
          let refreshed: unknown = null;
          let refreshError: string | undefined;
          if (err.taskId) {
            try {
              refreshed = await decideAndStoreTask(err.taskId);
            } catch (refreshErr) {
              refreshError = String(refreshErr);
            }
          }
          json(res, 409, {
            error: "approval_expired",
            message: "Approval expired before resolution. The task was re-evaluated when possible.",
            expiredApproval: err.approval,
            refreshed,
            refreshError,
          });
          return;
        }
        json(res, 400, { error: `Approval decision failed: ${err}` });
      }
      return;
    }

    // ── Rule memory ───────────────────────────────────────
    if (method === "GET" && url.pathname === "/rules") {
      try {
        const rules = await listRuleMemory({
          companyId: url.searchParams.get("companyId") ?? undefined,
          scopeType: url.searchParams.get("scopeType") ?? undefined,
          scopeId: url.searchParams.get("scopeId") ?? undefined,
          status: url.searchParams.get("status") ?? "active",
          limit: Number(url.searchParams.get("limit") ?? 50),
        });
        json(res, 200, { count: rules.length, rules });
      } catch (err) {
        json(res, 500, { error: `Rule memory list failed: ${err}` });
      }
      return;
    }

    const taskRulesMatch = url.pathname.match(/^\/tasks\/([^/]+)\/rules$/);
    if (method === "GET" && taskRulesMatch) {
      try {
        const rules = await findApplicableRulesForTask(taskRulesMatch[1]);
        json(res, 200, { count: rules.length, rules });
      } catch (err) {
        json(res, 400, { error: `Applicable rule lookup failed: ${err}` });
      }
      return;
    }

    // ── GET /intakes ───────────────────────────────────────
    const offlineServerSafeRuleMatch = url.pathname.match(/^\/rules\/([^/]+)\/offline-server-safe$/);
    if (method === "POST" && offlineServerSafeRuleMatch) {
      try {
        const payload = await readPayload(req);
        const rule = await setRuleOfflineServerSafe({
          ruleId: offlineServerSafeRuleMatch[1],
          enabled: payload.enabled !== false,
          actorId: typeof payload.actorId === "string" ? payload.actorId : "owner",
        });
        json(res, 200, { rule });
      } catch (err) {
        json(res, 400, { error: `Offline server-safe rule update failed: ${err}` });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/intakes") {
      try {
        const rows = await listIntakes({
          companyId: url.searchParams.get("companyId") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          limit: Number(url.searchParams.get("limit") ?? 50),
        });
        json(res, 200, { count: rows.length, intakes: rows });
      } catch (err) {
        json(res, 500, { error: `Intake list failed: ${err}` });
      }
      return;
    }

    // ── Site session vault ─────────────────────────────────
    // 비밀번호가 아니라 로그인 완료 후 세션 스냅샷만 암호화 저장한다.
    if (method === "POST" && url.pathname === "/sessions/site") {
      try {
        const payload = await readPayload(req);
        if (typeof payload.siteOrigin !== "string") {
          json(res, 400, { error: "siteOrigin is required" });
          return;
        }
        const stored = await storeEncryptedSiteSession({
          companyId: typeof payload.companyId === "string" ? payload.companyId : undefined,
          siteOrigin: payload.siteOrigin,
          payload: {
            cookies: Array.isArray(payload.cookies) ? payload.cookies : [],
            localStorage: isRecord(payload.localStorage) ? payload.localStorage as Record<string, string> : {},
            sessionStorage: isRecord(payload.sessionStorage) ? payload.sessionStorage as Record<string, string> : {},
            userLabel: typeof payload.userLabel === "string" ? payload.userLabel : undefined,
          },
          expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : undefined,
        });
        json(res, 201, stored);
      } catch (err) {
        json(res, 400, { error: `Site session store failed: ${err}` });
      }
      return;
    }

    if (method === "GET" && url.pathname === "/sessions/site") {
      try {
        const sessions = await listSiteSessions({
          companyId: url.searchParams.get("companyId") ?? undefined,
          siteOrigin: url.searchParams.get("siteOrigin") ?? undefined,
        });
        json(res, 200, { count: sessions.length, sessions });
      } catch (err) {
        json(res, 500, { error: `Site session list failed: ${err}` });
      }
      return;
    }

    // ── POST /run ──────────────────────────────────────────
    // 슬롯 있으면 즉시 실행, 없으면 대기열에 등록
    if (method === "POST" && url.pathname === "/run") {
      try {
        const body = JSON.parse(await readBody(req)) as {
          taskId?:  string;
          task:     string;
          priority?: "high" | "normal" | "low";
          executionBrief?: ExecutionBrief;
        };

        if (!body.task) {
          json(res, 400, { error: "task is required" });
          return;
        }

        const runId = body.taskId ?? randomUUID();
        const entry = queue.enqueue(runId, body.task, body.priority ?? "normal", body.executionBrief);

        if (!entry) {
          // 큐가 꽉 찬 경우
          json(res, 429, {
            error: "Queue is full. Try again later.",
            stats: queue.getStats(),
          });
          return;
        }

        const stats = queue.getStats();
        json(res, 202, {
          runId,
          status:    entry.status,    // "running" | "pending"
          position:  entry.position,  // 대기 중이면 몇 번째인지
          streamUrl: `/run/${runId}/stream`,
          statusUrl: `/run/${runId}/status`,
          queueUrl:  `/queue`,
          queueStats: stats,
        });

      } catch (err) {
        json(res, 400, { error: `Invalid request: ${err}` });
      }
      return;
    }

    // ── GET /queue ─────────────────────────────────────────
    // 전체 큐 상태 (실행 중 + 대기 수 + 슬롯 현황)
    if (method === "GET" && url.pathname === "/queue") {
      json(res, 200, queue.getStats());
      return;
    }

    // ── GET /run/:id/queue ─────────────────────────────────
    // 특정 작업의 큐 상태 (대기 위치, 시작 시각 등)
    const queueMatch = url.pathname.match(/^\/run\/([^/]+)\/queue$/);
    if (method === "GET" && queueMatch) {
      const entry = queue.getEntry(queueMatch[1]);
      if (!entry) {
        json(res, 404, { error: "Run not found in queue" });
        return;
      }
      json(res, 200, entry);
      return;
    }

    // ── GET /run/:id/stream ────────────────────────────────
    const streamMatch = url.pathname.match(/^\/run\/([^/]+)\/stream$/);
    if (method === "GET" && streamMatch) {
      broadcaster.subscribe(streamMatch[1], res);
      return;
    }

    // ── GET /run/:id/status ────────────────────────────────
    const statusMatch = url.pathname.match(/^\/run\/([^/]+)\/status$/);
    if (method === "GET" && statusMatch) {
      try {
        const events = await db.getEvents(statusMatch[1]);
        json(res, 200, { runId: statusMatch[1], eventCount: events.length, events });
      } catch (err) {
        json(res, 404, { error: String(err) });
      }
      return;
    }

    json(res, 404, { error: "Not found" });
  });

  return server;
}

/** 기기 토큰 인증: Authorization: Bearer <deviceToken> 헤더로 기기를 검증 */
async function authenticateDeviceRequest(req: http.IncomingMessage, deviceId: string) {
  const raw = String(req.headers["authorization"] ?? "");
  const token = raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : "";
  if (!token) return null;
  return authenticateDevice(deviceId, token);
}

function isRecord(value: unknown): value is Record<string, string> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isRiskLevel(value: unknown): value is "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high";
}

function isApprovalPolicy(value: unknown): value is "owner_only" | "approval_required" {
  return value === "owner_only" || value === "approval_required";
}

function isStaffRequestStatus(value: unknown): value is "draft" | "waiting_approval" | "sent" | "responded" | "expired" | "cancelled" {
  return value === "draft" || value === "waiting_approval" || value === "sent" || value === "responded" || value === "expired" || value === "cancelled";
}

function isStaffRequestChannel(value: unknown): value is "sms" | "email" | "slack" | "teams" | "kakao_work" | "telegram" | "manual" {
  return value === "sms" || value === "email" || value === "slack" || value === "teams" || value === "kakao_work" || value === "telegram" || value === "manual";
}

async function handleGenericAgentApprovalResume(approval: {
  id: string;
  companyId: string;
  taskId?: string;
  options: Record<string, unknown>;
}) {
  const source = String(approval.options.source ?? "");
  if (source !== "generic_agent_action_guard" && source !== "action_guard") return null;

  const metadata = asUnknownRecord(approval.options.metadata);
  const resume = asUnknownRecord(metadata.genericAgentResume);
  if (!Object.keys(resume).length) return null;

  const contextDependency = String(resume.contextDependency ?? "unknown");
  const payloadCaptured = resume.payloadCaptured === true && typeof resume.payloadHash === "string";
  if (payloadCaptured && contextDependency === "none") {
    if (db.isDatabaseConfigured()) {
      await db.sql`
        INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
        VALUES (
          ${approval.companyId},
          'system',
          'generic_agent_resume_evidence_stored',
          ${approval.taskId ? "task" : "approval_request"},
          ${approval.taskId ?? approval.id},
          ${JSON.stringify({
            approvalId: approval.id,
            taskId: approval.taskId,
            action: approval.options.action,
            payloadHash: resume.payloadHash,
            contextDependency,
            nextStep: "same_action_payload_can_consume_approval_once",
          })}
        )
      `;
    }
    return {
      result: "approval-evidence-stored",
      originCardId: approval.id,
      payloadHash: resume.payloadHash,
      nextStep: "same_action_payload_can_consume_approval_once",
    };
  }

  const reason = !payloadCaptured
    ? "declared_payload_missing"
    : `context_dependency_${contextDependency}`;

  let refreshed: unknown = null;
  let refreshError: string | undefined;
  if (approval.taskId) {
    try {
      refreshed = await decideAndStoreTask(approval.taskId);
    } catch (error) {
      refreshError = String(error);
    }
  }

  if (db.isDatabaseConfigured()) {
    await db.sql`
      INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
      VALUES (
        ${approval.companyId},
        'system',
        'generic_agent_resume_routed_to_rejudge',
        ${approval.taskId ? "task" : "approval_request"},
        ${approval.taskId ?? approval.id},
        ${JSON.stringify({
          approvalId: approval.id,
          taskId: approval.taskId,
          reason,
          contextDependency,
          payloadCaptured,
          payloadHash: resume.payloadHash,
        })}
      )
    `;
  }

  return {
    result: "routed-to-rejudge",
    reason,
    refreshed,
    refreshError,
  };
}

function asUnknownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function startServer() {
  const server = createServer();
  server.listen(PORT, () => {
    const stats = queue.getStats();
    console.log(`[FlowFit Runner] port=${PORT} maxConcurrent=${stats.maxConcurrent}`);
  });
  return server;
}
