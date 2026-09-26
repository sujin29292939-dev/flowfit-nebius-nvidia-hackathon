// devices/store.ts
// 기기 레지스트리 · 기기 토큰 · 명령 큐 저장소.
// DB(Neon)가 있으면 영속, 없으면 메모리 폴백(개발/테스트용).

import { randomUUID } from "node:crypto";

import { isDatabaseConfigured, sql } from "../db/client.js";
import { evaluateCommandGate } from "./commandGate.js";
import { verifyReportedResult, type ReportedEvidence } from "./resultVerification.js";
import {
  generateNonce,
  generatePairingCode,
  generateToken,
  hashCommandBody,
  hashToken,
  safeEqualHex,
  signCommand,
} from "./signing.js";
import type {
  DeviceAutonomyStage,
  DeviceCommandRecord,
  DeviceCommandStep,
  DeviceRecord,
  SignedCommandEnvelope,
} from "./types.js";

const DEFAULT_TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const DEFAULT_COMMAND_TTL_MS = 1000 * 60 * 15; // 15m
const DEFAULT_DEVICE_OFFLINE_AFTER_MS = positiveIntFromEnv("DEVICE_OFFLINE_AFTER_MS", 45_000);
const DEFAULT_DEVICE_RECOVERING_AFTER_MS = positiveIntFromEnv("DEVICE_RECOVERING_AFTER_MS", DEFAULT_DEVICE_OFFLINE_AFTER_MS * 4);
const DEFAULT_DEVICE_OFFLINE_MISS_THRESHOLD = positiveIntFromEnv("DEVICE_OFFLINE_MISS_THRESHOLD", 3);
const DEFAULT_DEVICE_CAPABILITY_SCOPE = [
  "inventory.read",
  "shipment.track",
  "payment.check",
  "inquiry.read",
];

// ── 메모리 폴백 저장소 ─────────────────────────────
const memPairingCodes = new Map<string, { code: string; companyId: string; maxUses: number; useCount: number; expiresAt?: string }>();
const memDevices = new Map<string, DeviceRecord>();
const memTokens = new Map<string, { id: string; deviceId: string; companyId: string; tokenHash: string; status: string; expiresAt: string }>();
const memCommands = new Map<string, DeviceCommandRecord>();
const memNonces = new Set<string>();

export type DeviceOperationMode = "ONLINE" | "OFFLINE" | "RECOVERING";

export interface CompanyDeviceOperationStatus {
  companyId: string;
  mode: DeviceOperationMode;
  activeDeviceCount: number;
  onlineDeviceCount: number;
  latestLastSeenAt?: string;
  offlineAfterMs: number;
  recoveringAfterMs: number;
  offlineMissThreshold: number;
}

export function deriveDeviceOperationMode(
  lastSeenAt: string | undefined,
  nowMs = Date.now(),
  offlineAfterMs = DEFAULT_DEVICE_OFFLINE_AFTER_MS,
  recoveringAfterMs = DEFAULT_DEVICE_RECOVERING_AFTER_MS,
): DeviceOperationMode {
  if (!lastSeenAt) return "OFFLINE";
  const lastSeenMs = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) return "OFFLINE";
  const ageMs = nowMs - lastSeenMs;
  if (ageMs <= offlineAfterMs) return "ONLINE";
  if (ageMs <= recoveringAfterMs) return "RECOVERING";
  return "OFFLINE";
}

// ══════════════════════════════════════════════════
// 페어링 코드
// ══════════════════════════════════════════════════
export async function createPairingCode(input: {
  companyId: string;
  label?: string;
  maxUses?: number;
  expiresInHours?: number;
}): Promise<{ code: string; expiresAt: string | null }> {
  const code = generatePairingCode();
  const maxUses = input.maxUses ?? 1;
  const expiresAt = input.expiresInHours
    ? new Date(Date.now() + input.expiresInHours * 3_600_000).toISOString()
    : new Date(Date.now() + 24 * 3_600_000).toISOString();

  if (!isDatabaseConfigured()) {
    memPairingCodes.set(code, { code, companyId: input.companyId, maxUses, useCount: 0, expiresAt });
    return { code, expiresAt };
  }

  await sql`
    INSERT INTO device_pairing_codes (code, company_id, label, max_uses, expires_at)
    VALUES (${code}, ${input.companyId}, ${input.label ?? null}, ${maxUses}, ${expiresAt})
  `;
  return { code, expiresAt };
}

async function consumePairingCode(code: string): Promise<{ companyId: string } | null> {
  if (!isDatabaseConfigured()) {
    const entry = memPairingCodes.get(code);
    if (!entry) return null;
    if (entry.expiresAt && Date.parse(entry.expiresAt) < Date.now()) return null;
    if (entry.useCount >= entry.maxUses) return null;
    entry.useCount += 1;
    return { companyId: entry.companyId };
  }

  const rows = await sql`
    SELECT code, company_id, max_uses, use_count, expires_at
    FROM device_pairing_codes
    WHERE code = ${code}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) return null;
  if (Number(row.use_count) >= Number(row.max_uses)) return null;

  await sql`
    UPDATE device_pairing_codes
    SET use_count = use_count + 1, used_at = NOW()
    WHERE code = ${code}
  `;
  return { companyId: String(row.company_id) };
}

// ══════════════════════════════════════════════════
// 페어링 → 기기 등록 + 기기 토큰 발급
// ══════════════════════════════════════════════════
export async function pairDevice(input: {
  pairingCode: string;
  label?: string;
  platform?: string;
  agentVersion?: string;
  capabilityScope?: string[];
}): Promise<{ device: DeviceRecord; deviceToken: string; tokenExpiresAt: string } | { error: string }> {
  const consumed = await consumePairingCode(input.pairingCode);
  if (!consumed) return { error: "pairing_code_invalid" };

  const deviceId = randomUUID();
  const now = new Date().toISOString();
  const scope = input.capabilityScope && input.capabilityScope.length > 0
    ? input.capabilityScope
    : DEFAULT_DEVICE_CAPABILITY_SCOPE;
  const device: DeviceRecord = {
    id: deviceId,
    companyId: consumed.companyId,
    label: input.label,
    platform: input.platform,
    agentVersion: input.agentVersion,
    capabilityScope: scope,
    autonomyStage: "SHADOW",
    status: "active",
    operationMode: "ONLINE",
    pollMissCount: 0,
    lastSeenAt: now,
    lastPollAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const token = generateToken();
  const tokenHash = hashToken(token);
  const tokenId = randomUUID();
  const tokenExpiresAt = new Date(Date.now() + DEFAULT_TOKEN_TTL_MS).toISOString();

  if (!isDatabaseConfigured()) {
    memDevices.set(deviceId, device);
    memTokens.set(tokenHash, { id: tokenId, deviceId, companyId: consumed.companyId, tokenHash, status: "active", expiresAt: tokenExpiresAt });
    return { device, deviceToken: token, tokenExpiresAt };
  }

  await sql`
    INSERT INTO devices (
      id, company_id, label, platform, agent_version, capability_scope_json,
      autonomy_stage, status, operation_mode, poll_miss_count, last_seen_at, last_poll_at
    )
    VALUES (${deviceId}, ${consumed.companyId}, ${input.label ?? null}, ${input.platform ?? null},
            ${input.agentVersion ?? null}, ${JSON.stringify(scope)}, 'SHADOW', 'active', 'ONLINE', 0, ${now}, ${now})
  `;
  await sql`
    INSERT INTO device_tokens (id, device_id, company_id, token_hash, status, expires_at)
    VALUES (${tokenId}, ${deviceId}, ${consumed.companyId}, ${tokenHash}, 'active', ${tokenExpiresAt})
  `;
  return { device, deviceToken: token, tokenExpiresAt };
}

// ══════════════════════════════════════════════════
// 기기 토큰 인증 (교신 시 매 요청 검증)
// ══════════════════════════════════════════════════
export async function authenticateDevice(deviceId: string, token: string): Promise<DeviceRecord | null> {
  const tokenHash = hashToken(token);

  if (!isDatabaseConfigured()) {
    const t = memTokens.get(tokenHash);
    if (!t || t.deviceId !== deviceId || t.status !== "active") return null;
    if (Date.parse(t.expiresAt) < Date.now()) return null;
    const device = memDevices.get(deviceId);
    if (!device || device.status !== "active") return null;
    const nowMs = Date.now();
    const wasOffline = deriveDeviceOperationMode(device.lastSeenAt, nowMs) === "OFFLINE";
    device.operationMode = wasOffline ? "RECOVERING" : "ONLINE";
    device.pollMissCount = 0;
    device.lastSeenAt = new Date().toISOString();
    device.lastPollAt = device.lastSeenAt;
    return device;
  }

  const rows = await sql`
    SELECT d.id, d.company_id, d.label, d.platform, d.agent_version,
           d.capability_scope_json, d.autonomy_stage, d.status,
           d.operation_mode, d.poll_miss_count, d.last_seen_at, d.last_poll_at,
           d.snapshot_verified_at, d.created_at, d.updated_at,
           t.status AS token_status, t.expires_at AS token_expires_at
    FROM device_tokens t
    JOIN devices d ON d.id = t.device_id
    WHERE t.token_hash = ${tokenHash} AND t.device_id = ${deviceId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (row.token_status !== "active" || row.status !== "active") return null;
  if (Date.parse(row.token_expires_at) < Date.now()) return null;

  const updatedRows = await sql`
    UPDATE devices
    SET last_seen_at = NOW(),
        last_poll_at = NOW(),
        poll_miss_count = 0,
        operation_mode = CASE
          WHEN last_seen_at IS NOT NULL
            AND last_seen_at < NOW() - (${Math.ceil(DEFAULT_DEVICE_OFFLINE_AFTER_MS / 1000)} * INTERVAL '1 second')
            THEN 'RECOVERING'
          ELSE 'ONLINE'
        END,
        updated_at = NOW()
    WHERE id = ${deviceId}
    RETURNING *
  `;
  return updatedRows[0] ? rowToDevice(updatedRows[0]) : rowToDevice(row);
}

export async function refreshDeviceToken(deviceId: string): Promise<{ deviceToken: string; tokenExpiresAt: string } | null> {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const tokenId = randomUUID();
  const tokenExpiresAt = new Date(Date.now() + DEFAULT_TOKEN_TTL_MS).toISOString();

  if (!isDatabaseConfigured()) {
    const device = memDevices.get(deviceId);
    if (!device || device.status !== "active") return null;
    // 기존 토큰 만료 처리
    for (const [hash, t] of memTokens) {
      if (t.deviceId === deviceId) memTokens.delete(hash);
    }
    memTokens.set(tokenHash, { id: tokenId, deviceId, companyId: device.companyId, tokenHash, status: "active", expiresAt: tokenExpiresAt });
    return { deviceToken: token, tokenExpiresAt };
  }

  const rows = await sql`SELECT company_id, status FROM devices WHERE id = ${deviceId} LIMIT 1`;
  const row = rows[0];
  if (!row || row.status !== "active") return null;

  await sql`UPDATE device_tokens SET status = 'expired' WHERE device_id = ${deviceId} AND status = 'active'`;
  await sql`
    INSERT INTO device_tokens (id, device_id, company_id, token_hash, status, expires_at)
    VALUES (${tokenId}, ${deviceId}, ${String(row.company_id)}, ${tokenHash}, 'active', ${tokenExpiresAt})
  `;
  return { deviceToken: token, tokenExpiresAt };
}

export async function revokeDevice(deviceId: string): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    const device = memDevices.get(deviceId);
    if (!device) return false;
    device.status = "revoked";
    device.updatedAt = new Date().toISOString();
    for (const [hash, t] of memTokens) {
      if (t.deviceId === deviceId) memTokens.delete(hash);
    }
    return true;
  }

  await sql`UPDATE device_tokens SET status = 'revoked', revoked_at = NOW() WHERE device_id = ${deviceId} AND status = 'active'`;
  const rows = await sql`UPDATE devices SET status = 'revoked', updated_at = NOW() WHERE id = ${deviceId} RETURNING id`;
  return rows.length > 0;
}

export async function listDevices(companyId?: string): Promise<DeviceRecord[]> {
  if (!isDatabaseConfigured()) {
    return Array.from(memDevices.values()).filter((d) => !companyId || d.companyId === companyId);
  }
  const rows = companyId
    ? await sql`SELECT * FROM devices WHERE company_id = ${companyId} ORDER BY created_at DESC`
    : await sql`SELECT * FROM devices ORDER BY created_at DESC`;
  return rows.map(rowToDevice);
}

export async function getDevice(deviceId: string): Promise<DeviceRecord | null> {
  if (!isDatabaseConfigured()) {
    return memDevices.get(deviceId) ?? null;
  }

  const rows = await sql`SELECT * FROM devices WHERE id = ${deviceId} LIMIT 1`;
  const row = rows[0];
  return row ? rowToDevice(row) : null;
}

export async function setDeviceStage(deviceId: string, stage: DeviceAutonomyStage): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    const device = memDevices.get(deviceId);
    if (!device) return false;
    device.autonomyStage = stage;
    device.updatedAt = new Date().toISOString();
    return true;
  }
  const rows = await sql`UPDATE devices SET autonomy_stage = ${stage}, updated_at = NOW() WHERE id = ${deviceId} RETURNING id`;
  return rows.length > 0;
}

export async function getCompanyDeviceOperationStatus(input: {
  companyId: string;
  nowMs?: number;
  offlineAfterMs?: number;
  recoveringAfterMs?: number;
  offlineMissThreshold?: number;
}): Promise<CompanyDeviceOperationStatus> {
  const nowMs = input.nowMs ?? Date.now();
  const offlineAfterMs = input.offlineAfterMs ?? DEFAULT_DEVICE_OFFLINE_AFTER_MS;
  const recoveringAfterMs = input.recoveringAfterMs ?? DEFAULT_DEVICE_RECOVERING_AFTER_MS;
  const offlineMissThreshold = input.offlineMissThreshold ?? DEFAULT_DEVICE_OFFLINE_MISS_THRESHOLD;

  const devices = await listDevices(input.companyId);
  const activeDevices = devices.filter((device) => device.status === "active");
  const seenDevices = activeDevices
    .map((device) => ({ device, lastSeenMs: device.lastSeenAt ? Date.parse(device.lastSeenAt) : Number.NaN }))
    .filter((entry) => Number.isFinite(entry.lastSeenMs));

  const onlineDevices = seenDevices.filter((entry) =>
    nowMs - entry.lastSeenMs <= offlineAfterMs,
  );
  const recoveringDevices = seenDevices.filter((entry) =>
    nowMs - entry.lastSeenMs > offlineAfterMs && nowMs - entry.lastSeenMs <= recoveringAfterMs,
  );
  const latest = seenDevices.sort((a, b) => b.lastSeenMs - a.lastSeenMs)[0];
  const latestLastSeenAt = latest?.device.lastSeenAt;

  let mode: DeviceOperationMode = "OFFLINE";
  if (onlineDevices.length > 0) {
    mode = "ONLINE";
  } else if (recoveringDevices.length > 0 || (latest && nowMs - latest.lastSeenMs <= recoveringAfterMs)) {
    mode = "RECOVERING";
  }

  return {
    companyId: input.companyId,
    mode,
    activeDeviceCount: activeDevices.length,
    onlineDeviceCount: onlineDevices.length,
    latestLastSeenAt,
    offlineAfterMs,
    recoveringAfterMs,
    offlineMissThreshold,
  };
}

export async function recordDevicePollMiss(deviceId: string, at = new Date()): Promise<DeviceOperationMode | null> {
  if (!isDatabaseConfigured()) {
    const device = memDevices.get(deviceId);
    if (!device || device.status !== "active") return null;
    const nextCount = (device.pollMissCount ?? 0) + 1;
    device.pollMissCount = nextCount;
    device.lastPollAt = at.toISOString();
    device.operationMode = deriveDeviceOperationMode(device.lastSeenAt, at.getTime());
    device.updatedAt = at.toISOString();
    return device.operationMode ?? "ONLINE";
  }

  const rows = await sql`
    UPDATE devices
    SET poll_miss_count = COALESCE(poll_miss_count, 0) + 1,
        last_poll_at = ${at.toISOString()},
        operation_mode = CASE
          WHEN last_seen_at IS NULL THEN 'OFFLINE'
          WHEN last_seen_at < ${at.toISOString()}::timestamptz - (${Math.ceil(DEFAULT_DEVICE_RECOVERING_AFTER_MS / 1000)} * INTERVAL '1 second') THEN 'OFFLINE'
          WHEN last_seen_at < ${at.toISOString()}::timestamptz - (${Math.ceil(DEFAULT_DEVICE_OFFLINE_AFTER_MS / 1000)} * INTERVAL '1 second') THEN 'RECOVERING'
          ELSE 'ONLINE'
        END,
        updated_at = NOW()
    WHERE id = ${deviceId}
      AND status = 'active'
    RETURNING operation_mode
  `;
  return rows[0] ? String(rows[0].operation_mode) as DeviceOperationMode : null;
}

export async function confirmDeviceSnapshotVerified(deviceId: string, at = new Date()): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    const device = memDevices.get(deviceId);
    if (!device || device.status !== "active") return false;
    device.operationMode = "ONLINE";
    device.lastSeenAt = at.toISOString();
    device.lastPollAt = at.toISOString();
    device.snapshotVerifiedAt = at.toISOString();
    device.updatedAt = at.toISOString();
    return true;
  }

  const rows = await sql`
    UPDATE devices
    SET operation_mode = 'ONLINE',
        last_seen_at = ${at.toISOString()},
        last_poll_at = ${at.toISOString()},
        snapshot_verified_at = ${at.toISOString()},
        updated_at = NOW()
    WHERE id = ${deviceId}
      AND status = 'active'
    RETURNING id
  `;
  return rows.length > 0;
}

// ══════════════════════════════════════════════════
// 명령 큐: 등록(서명) · 폴링 · 결과 보고
// ══════════════════════════════════════════════════
export async function enqueueCommand(input: {
  deviceId: string;
  companyId: string;
  capability: string;
  steps: DeviceCommandStep[];
  taskId?: string;
  approvalId?: string;
  idempotencyKey?: string;
  ttlMs?: number;
}): Promise<{ commandId: string } | { error: string }> {
  const device = await getDevice(input.deviceId);
  if (!device) {
    return { error: "device_not_found" };
  }
  if (device.status !== "active") {
    return { error: "device_not_active" };
  }
  if (device.companyId !== input.companyId) {
    return { error: "device_company_mismatch" };
  }
  if (!isCapabilityAllowed(device.capabilityScope, input.capability)) {
    return { error: `capability_not_allowed_for_device: ${input.capability}` };
  }

  // 게이트 정책 검증(서버 = 정책 단일 출처).
  // BLOCK step이 있으면 큐에 넣지 않는다. CONFIRM step은 승인(approvalId) 없이는 거부한다.
  const gate = evaluateCommandGate(input.steps, { approved: Boolean(input.approvalId) });
  if (gate.blocked) {
    return { error: `command_blocked_by_gate: ${gate.reasons.join(" / ")}` };
  }
  if (gate.requiresApproval) {
    return { error: `command_requires_approval: ${gate.reasons.join(" / ")}` };
  }

  const commandId = randomUUID();
  const nonce = generateNonce();
  const idempotencyKey = input.idempotencyKey ?? commandId;
  const bodyHash = hashCommandBody(input.steps);
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? DEFAULT_COMMAND_TTL_MS)).toISOString();
  const signature = signCommand({
    commandId,
    deviceId: input.deviceId,
    companyId: input.companyId,
    capability: input.capability,
    idempotencyKey,
    nonce,
    bodyHash,
    expiresAt,
  });
  const now = new Date().toISOString();

  const record: DeviceCommandRecord = {
    id: commandId,
    deviceId: input.deviceId,
    companyId: input.companyId,
    taskId: input.taskId,
    approvalId: input.approvalId,
    capability: input.capability,
    idempotencyKey,
    nonce,
    bodyHash,
    signature,
    steps: input.steps,
    status: "queued",
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };

  if (!isDatabaseConfigured()) {
    // 멱등: 같은 회사+키가 이미 있으면 재사용
    for (const existing of memCommands.values()) {
      if (existing.companyId === input.companyId && existing.idempotencyKey === idempotencyKey) {
        return { commandId: existing.id };
      }
    }
    memCommands.set(commandId, record);
    return { commandId };
  }

  try {
    await sql`
      INSERT INTO device_commands (
        id, device_id, company_id, task_id, approval_id, capability,
        idempotency_key, nonce, body_hash, signature, steps_json, status, expires_at
      )
      VALUES (
        ${commandId}, ${input.deviceId}, ${input.companyId}, ${input.taskId ?? null},
        ${input.approvalId ?? null}, ${input.capability}, ${idempotencyKey}, ${nonce},
        ${bodyHash}, ${signature}, ${JSON.stringify(input.steps)}, 'queued', ${expiresAt}
      )
    `;
  } catch (error) {
    // 멱등 유니크 충돌: 기존 명령 반환
    const existing = await sql`
      SELECT id FROM device_commands WHERE company_id = ${input.companyId} AND idempotency_key = ${idempotencyKey} LIMIT 1
    `;
    if (existing[0]) return { commandId: String(existing[0].id) };
    return { error: `command_enqueue_failed: ${String(error)}` };
  }
  return { commandId };
}

function isCapabilityAllowed(scope: string[], capability: string): boolean {
  if (scope.includes("*")) return true;
  if (scope.includes(capability)) return true;
  const [domain] = capability.split(".");
  return scope.includes(`${domain}.*`);
}

/** 에이전트 폴링: 큐에서 미전달 명령을 꺼내 dispatched로 바꾸고 서명 봉투로 반환 */
export async function pollCommands(deviceId: string, limit = 5): Promise<SignedCommandEnvelope[]> {
  const nowMs = Date.now();

  if (!isDatabaseConfigured()) {
    const out: SignedCommandEnvelope[] = [];
    for (const cmd of memCommands.values()) {
      if (cmd.deviceId !== deviceId || cmd.status !== "queued") continue;
      if (Date.parse(cmd.expiresAt) < nowMs) { cmd.status = "expired"; continue; }
      cmd.status = "dispatched";
      cmd.dispatchedAt = new Date().toISOString();
      out.push(toEnvelope(cmd));
      if (out.length >= limit) break;
    }
    return out;
  }

  const rows = await sql`
    UPDATE device_commands
    SET status = 'dispatched', dispatched_at = NOW(), updated_at = NOW()
    WHERE id IN (
      SELECT id FROM device_commands
      WHERE device_id = ${deviceId} AND status = 'queued' AND expires_at > NOW()
      ORDER BY created_at ASC
      LIMIT ${limit}
    )
    RETURNING id, device_id, company_id, capability, idempotency_key, nonce, body_hash, signature, expires_at, steps_json
  `;
  // 만료된 것 정리
  await sql`UPDATE device_commands SET status = 'expired', updated_at = NOW() WHERE device_id = ${deviceId} AND status = 'queued' AND expires_at <= NOW()`;

  return rows.map((row: Record<string, unknown>) => ({
    commandId: String(row.id),
    deviceId: String(row.device_id),
    companyId: String(row.company_id),
    capability: String(row.capability),
    idempotencyKey: String(row.idempotency_key),
    nonce: String(row.nonce),
    bodyHash: String(row.body_hash),
    signature: String(row.signature),
    expiresAt: new Date(row.expires_at as string).toISOString(),
    steps: parseJson(row.steps_json, []) as DeviceCommandStep[],
  }));
}

/**
 * 결과 보고: nonce 재사용 차단 + 화면 증거 교차검증 후 상태 기록.
 * 감염 PC의 거짓 성공 보고를 막는다 — 증거가 부족하면 succeeded가 아니라 needs_review로 강등.
 */
export async function reportCommandResult(input: {
  deviceId: string;
  commandId: string;
  nonce: string;
  status: "succeeded" | "failed";
  result?: unknown;
  evidence?: ReportedEvidence;
}): Promise<{ ok: true; verdict: string; effectiveStatus: string; flagDevice: boolean } | { error: string }> {
  // nonce 재전송 방지
  if (!isDatabaseConfigured()) {
    if (memNonces.has(input.nonce)) return { error: "nonce_replay" };
    const cmd = memCommands.get(input.commandId);
    if (!cmd || cmd.deviceId !== input.deviceId) return { error: "command_not_found" };
    if (cmd.nonce !== input.nonce) return { error: "nonce_mismatch" };
    memNonces.add(input.nonce);

    const verification = verifyReportedResult({ steps: cmd.steps, reportedStatus: input.status, evidence: input.evidence });
    cmd.status = verification.effectiveStatus === "succeeded" ? "succeeded"
      : verification.effectiveStatus === "failed" ? "failed" : "dispatched";
    cmd.resultStatus = verification.effectiveStatus;
    cmd.result = { reported: input.result, evidence: input.evidence, verification };
    cmd.reportedAt = new Date().toISOString();
    cmd.updatedAt = cmd.reportedAt;
    if (verification.flagDevice) {
      const device = memDevices.get(input.deviceId);
      if (device) { device.status = "revoked"; device.updatedAt = new Date().toISOString(); }
    }
    return { ok: true, verdict: verification.verdict, effectiveStatus: verification.effectiveStatus, flagDevice: verification.flagDevice };
  }

  const cmdRows = await sql`SELECT nonce, steps_json FROM device_commands WHERE id = ${input.commandId} AND device_id = ${input.deviceId} LIMIT 1`;
  const cmd = cmdRows[0];
  if (!cmd) return { error: "command_not_found" };
  if (String(cmd.nonce) !== input.nonce) return { error: "nonce_mismatch" };

  try {
    await sql`INSERT INTO device_command_nonces (nonce, device_id) VALUES (${input.nonce}, ${input.deviceId})`;
  } catch {
    return { error: "nonce_replay" };
  }

  const steps = parseJson(cmd.steps_json, []) as DeviceCommandStep[];
  const verification = verifyReportedResult({ steps, reportedStatus: input.status, evidence: input.evidence });
  const storedStatus = verification.effectiveStatus === "succeeded" ? "succeeded"
    : verification.effectiveStatus === "failed" ? "failed" : "dispatched";

  await sql`
    UPDATE device_commands
    SET status = ${storedStatus}, result_status = ${verification.effectiveStatus},
        result_json = ${JSON.stringify({ reported: input.result ?? {}, evidence: input.evidence ?? {}, verification })},
        reported_at = NOW(), updated_at = NOW()
    WHERE id = ${input.commandId} AND device_id = ${input.deviceId}
  `;

  // 거짓 보고 정황이면 기기 격리
  if (verification.flagDevice) {
    await sql`UPDATE device_tokens SET status = 'revoked', revoked_at = NOW() WHERE device_id = ${input.deviceId} AND status = 'active'`;
    await sql`UPDATE devices SET status = 'revoked', updated_at = NOW() WHERE id = ${input.deviceId}`;
  }

  return { ok: true, verdict: verification.verdict, effectiveStatus: verification.effectiveStatus, flagDevice: verification.flagDevice };
}

// ── helpers ────────────────────────────────────────
function toEnvelope(cmd: DeviceCommandRecord): SignedCommandEnvelope {
  return {
    commandId: cmd.id,
    deviceId: cmd.deviceId,
    companyId: cmd.companyId,
    capability: cmd.capability,
    idempotencyKey: cmd.idempotencyKey,
    nonce: cmd.nonce,
    bodyHash: cmd.bodyHash,
    signature: cmd.signature,
    expiresAt: cmd.expiresAt,
    steps: cmd.steps,
  };
}

function rowToDevice(row: Record<string, unknown>): DeviceRecord {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    label: (row.label as string) ?? undefined,
    platform: (row.platform as string) ?? undefined,
    agentVersion: (row.agent_version as string) ?? undefined,
    capabilityScope: parseJson(row.capability_scope_json, []) as string[],
    autonomyStage: (row.autonomy_stage as DeviceAutonomyStage) ?? "SHADOW",
    status: (row.status as DeviceRecord["status"]) ?? "active",
    operationMode: (row.operation_mode as DeviceOperationMode) ?? "ONLINE",
    pollMissCount: row.poll_miss_count === undefined || row.poll_miss_count === null ? 0 : Number(row.poll_miss_count),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at as string).toISOString() : undefined,
    lastPollAt: row.last_poll_at ? new Date(row.last_poll_at as string).toISOString() : undefined,
    snapshotVerifiedAt: row.snapshot_verified_at ? new Date(row.snapshot_verified_at as string).toISOString() : undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export { safeEqualHex };
