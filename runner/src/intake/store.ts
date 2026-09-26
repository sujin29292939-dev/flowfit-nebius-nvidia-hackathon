// intake/store.ts
// 문자·메일·사이트 입력을 intakes 테이블에 저장하는 영속화 계층.

import { createHash, randomUUID } from "node:crypto";
import { isDatabaseConfigured, sql } from "../db/client.js";
import { DEFAULT_COMPANY_ID, DEFAULT_COMPANY_NAME } from "./config.js";
import type { CreateIntakeInput, StoredIntake } from "./types.js";

const memoryIntakes = new Map<string, StoredIntake>();

export async function createIntake(input: CreateIntakeInput): Promise<StoredIntake> {
  const companyId = input.companyId || DEFAULT_COMPANY_ID;
  const dedupeKey = input.dedupeKey ?? buildDedupeKey(input);

  if (!isDatabaseConfigured()) {
    if (dedupeKey) {
      const existing = [...memoryIntakes.values()].find(
        (item) => item.companyId === companyId && item.dedupeKey === dedupeKey,
      );
      if (existing) return { ...existing, duplicate: true };
    }

    const id = `intake_${randomUUID()}`;
    const now = new Date().toISOString();
    const intake: StoredIntake = {
      id,
      companyId,
      sourceType: input.sourceType,
      sourceName: input.sourceName,
      rawText: input.rawText,
      status: input.status ?? "pending_classification",
      receivedAt: input.receivedAt?.toISOString() ?? now,
      createdAt: now,
      dedupeKey: dedupeKey ?? undefined,
      duplicate: false,
    };
    memoryIntakes.set(id, intake);
    return intake;
  }

  await ensureCompany(companyId, input.companyName ?? DEFAULT_COMPANY_NAME);

  if (dedupeKey) {
    const existing = await sql`
      SELECT id, company_id, source_type, source_name, raw_text, status, received_at, created_at, dedupe_key
      FROM intakes
      WHERE company_id = ${companyId} AND dedupe_key = ${dedupeKey}
      LIMIT 1
    `;
    if (existing.length > 0) return rowToStoredIntake(existing[0], true);
  }

  const id = `intake_${randomUUID()}`;
  const status = input.status ?? "pending_classification";
  const receivedAt = input.receivedAt ?? new Date();

  const rows = await sql`
    INSERT INTO intakes (
      id,
      company_id,
      source_type,
      source_name,
      raw_text,
      attachment_refs_json,
      metadata_json,
      status,
      received_at,
      dedupe_key
    )
    VALUES (
      ${id},
      ${companyId},
      ${input.sourceType},
      ${input.sourceName ?? null},
      ${input.rawText ?? null},
      ${JSON.stringify(input.attachmentRefs ?? [])},
      ${JSON.stringify(input.metadata ?? {})},
      ${status},
      ${receivedAt.toISOString()},
      ${dedupeKey}
    )
    RETURNING id, company_id, source_type, source_name, raw_text, status, received_at, created_at, dedupe_key
  `;

  await writeAuditLog(companyId, "system", "work_intake_created", "intake", id, {
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    dedupeKey,
  });

  return rowToStoredIntake(rows[0], false);
}

export async function listIntakes(input: { companyId?: string; status?: string; limit?: number }) {
  const companyId = input.companyId ?? DEFAULT_COMPANY_ID;
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

  if (!isDatabaseConfigured()) {
    return [...memoryIntakes.values()]
      .filter((item) => item.companyId === companyId)
      .filter((item) => !input.status || item.status === input.status)
      .sort((a, b) => +(new Date(b.receivedAt ?? b.createdAt)) - +(new Date(a.receivedAt ?? a.createdAt)))
      .slice(0, limit)
      .map(storedIntakeToRow);
  }

  if (input.status) {
    return await sql`
      SELECT id, company_id, source_type, source_name, raw_text, status, received_at, created_at, dedupe_key
      FROM intakes
      WHERE company_id = ${companyId} AND status = ${input.status}
      ORDER BY received_at DESC NULLS LAST, created_at DESC
      LIMIT ${limit}
    `;
  }

  return await sql`
    SELECT id, company_id, source_type, source_name, raw_text, status, received_at, created_at, dedupe_key
    FROM intakes
    WHERE company_id = ${companyId}
    ORDER BY received_at DESC NULLS LAST, created_at DESC
    LIMIT ${limit}
  `;
}

export function getMemoryIntakeForUnderstanding(intakeId: string) {
  return memoryIntakes.get(intakeId) ?? null;
}

export function setMemoryIntakeStatus(intakeId: string, status: string) {
  const intake = memoryIntakes.get(intakeId);
  if (intake) memoryIntakes.set(intakeId, { ...intake, status });
}

async function ensureCompany(companyId: string, companyName: string) {
  await sql`
    INSERT INTO companies (id, name)
    VALUES (${companyId}, ${companyName})
    ON CONFLICT (id) DO NOTHING
  `;
}

async function writeAuditLog(
  companyId: string,
  actorType: string,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    VALUES (${companyId}, ${actorType}, ${action}, ${targetType}, ${targetId}, ${JSON.stringify(metadata)})
  `;
}

function buildDedupeKey(input: CreateIntakeInput) {
  const metadata = input.metadata ?? {};
  const externalId = typeof metadata.externalId === "string" ? metadata.externalId : "";
  const stableText = [
    input.companyId,
    input.sourceType,
    input.sourceName ?? "",
    externalId,
    normalizeText(input.rawText ?? ""),
    input.receivedAt?.toISOString().slice(0, 16) ?? "",
  ].join("|");

  if (!externalId && !input.rawText) return null;
  return createHash("sha256").update(stableText).digest("hex");
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 4000);
}

function rowToStoredIntake(row: Record<string, unknown>, duplicate: boolean): StoredIntake {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    sourceType: row.source_type as StoredIntake["sourceType"],
    sourceName: row.source_name ? String(row.source_name) : undefined,
    rawText: row.raw_text ? String(row.raw_text) : undefined,
    status: String(row.status),
    receivedAt: row.received_at ? new Date(row.received_at as string).toISOString() : undefined,
    createdAt: new Date(row.created_at as string).toISOString(),
    dedupeKey: row.dedupe_key ? String(row.dedupe_key) : undefined,
    duplicate,
  };
}

function storedIntakeToRow(intake: StoredIntake) {
  return {
    id: intake.id,
    company_id: intake.companyId,
    source_type: intake.sourceType,
    source_name: intake.sourceName ?? null,
    raw_text: intake.rawText ?? null,
    status: intake.status,
    received_at: intake.receivedAt ?? intake.createdAt,
    created_at: intake.createdAt,
    dedupe_key: intake.dedupeKey ?? null,
  };
}
