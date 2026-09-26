// security/sessionVault.ts
// 사이트 비밀번호가 아니라 로그인 후 세션만 암호화 저장한다.

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_COMPANY_ID } from "../intake/config.js";

const ALGORITHM = "aes-256-gcm";

export interface SiteSessionPayload {
  cookies?: unknown[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  userLabel?: string;
  capturedAt?: string;
}

export interface StoreSiteSessionInput {
  companyId?: string;
  siteOrigin: string;
  payload: SiteSessionPayload;
  expiresAt?: string;
  keyId?: string;
}

export async function storeEncryptedSiteSession(input: StoreSiteSessionInput) {
  const sql = await getSql();
  const companyId = input.companyId ?? DEFAULT_COMPANY_ID;
  const origin = normalizeOrigin(input.siteOrigin);
  const keyId = input.keyId ?? process.env.SESSION_ENCRYPTION_KEY_ID ?? "default";
  const encrypted = encryptJson({
    ...input.payload,
    capturedAt: input.payload.capturedAt ?? new Date().toISOString(),
  });

  const id = `session_${randomUUID()}`;
  const rows = await sql`
    INSERT INTO site_sessions (
      id,
      company_id,
      site_origin,
      encrypted_payload,
      key_id,
      status,
      expires_at,
      updated_at
    )
    VALUES (
      ${id},
      ${companyId},
      ${origin},
      ${encrypted},
      ${keyId},
      'active',
      ${input.expiresAt ?? null},
      NOW()
    )
    ON CONFLICT (company_id, site_origin)
    DO UPDATE SET
      encrypted_payload = EXCLUDED.encrypted_payload,
      key_id = EXCLUDED.key_id,
      status = 'active',
      expires_at = EXCLUDED.expires_at,
      updated_at = NOW()
    RETURNING id, company_id, site_origin, key_id, status, expires_at, created_at, updated_at
  `;

  await sql`
    INSERT INTO audit_logs (company_id, actor_type, action, target_type, target_id, metadata_json)
    VALUES (${companyId}, 'system', 'site_session_stored', 'site_session', ${rows[0].id}, ${JSON.stringify({ siteOrigin: origin, keyId })})
  `;

  return rows[0];
}

export async function listSiteSessions(input: { companyId?: string; siteOrigin?: string }) {
  const sql = await getSql();
  const companyId = input.companyId ?? DEFAULT_COMPANY_ID;
  if (input.siteOrigin) {
    const origin = normalizeOrigin(input.siteOrigin);
    return await sql`
      SELECT id, company_id, site_origin, key_id, status, expires_at, last_used_at, created_at, updated_at
      FROM site_sessions
      WHERE company_id = ${companyId} AND site_origin = ${origin}
      ORDER BY updated_at DESC
    `;
  }

  return await sql`
    SELECT id, company_id, site_origin, key_id, status, expires_at, last_used_at, created_at, updated_at
    FROM site_sessions
    WHERE company_id = ${companyId}
    ORDER BY updated_at DESC
  `;
}

export function encryptJson(value: unknown) {
  const key = loadSessionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptJson<T = unknown>(packed: string): T {
  const key = loadSessionKey();
  const [version, iv64, tag64, encrypted64] = packed.split(".");
  if (version !== "v1" || !iv64 || !tag64 || !encrypted64) {
    throw new Error("Invalid encrypted session payload");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv64, "base64url"));
  decipher.setAuthTag(Buffer.from(tag64, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted64, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

function loadSessionKey() {
  const raw = process.env.SESSION_ENCRYPTION_KEY_BASE64 ?? process.env.SESSION_ENCRYPTION_KEY_HEX;
  if (!raw) {
    throw new Error("SESSION_ENCRYPTION_KEY_BASE64 또는 SESSION_ENCRYPTION_KEY_HEX가 필요합니다.");
  }

  const key = process.env.SESSION_ENCRYPTION_KEY_BASE64
    ? Buffer.from(raw, "base64")
    : Buffer.from(raw, "hex");

  if (key.length !== 32) {
    throw new Error("Session encryption key must be 32 bytes.");
  }

  return key;
}

function normalizeOrigin(input: string) {
  const url = new URL(input);
  return url.origin;
}

async function getSql() {
  const db = await import("../db/client.js");
  return db.sql;
}
